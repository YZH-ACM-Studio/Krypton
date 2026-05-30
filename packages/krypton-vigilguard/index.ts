/**
 * @hydrooj/krypton-vigilguard — client-required contest enforcement
 *
 * Owns:
 *   - `vigil.client_sessions` collection (single-contest binding for Vigil
 *     sessions; consulted by handler/before lockout middleware)
 *   - normal-browser-login lazy lockout for students in eligible
 *     client_required contests' control windows
 *   - `/client-required-notice` info page (whitelisted target of the lockout)
 *   - contest-scope helpers + client-session helpers (shared by the
 *     contest handler, problem handler, submit handler, exam-mode, …)
 *
 * Loaded as a built-in addon via the loader's BUILTIN_ADDONS list. Depends
 * on krypton-userbind (StudentRecord lookup for the scope-hit check).
 *
 * See /Users/motricseven/Krypton/CLIENT_REQUIRED_CONTEST_DESIGN.md.
 */
import type { Context } from 'hydrooj';
import * as contestModel from 'hydrooj/src/model/contest';
import * as documentModel from 'hydrooj/src/model/document';
import system from 'hydrooj/src/model/system';
import { ensureIndexes } from './src/db';
import { applyHandlers } from './src/handler';
import {
    currentClientSession,
    clientSessionKeyFromSession,
    deleteClientSessionByVigilSessionId,
    effectiveContestAccess,
    hitsParticipantScope,
    isValidClientSessionForContest,
    listActiveSessionsForContest,
} from './src/helpers';
import { getBrowserLockoutDecision, invalidateLockoutCache, vigilGuardLockoutLayer } from './src/lockout';
import { migrationScripts } from './src/migration';

export * from './src/types';
export {
    currentClientSession,
    clientSessionKeyFromSession,
    deleteClientSessionByVigilSessionId,
    effectiveContestAccess,
    getBrowserLockoutDecision,
    hitsParticipantScope,
    invalidateLockoutCache,
    isValidClientSessionForContest,
    listActiveSessionsForContest,
};

/**
 * Public face of the module — exposed on `global.Hydro.model.vigilguard`
 * so other hydrooj handlers (contest, problem, submit, exam-mode) can
 * gate on participant scope + client session without taking a hard
 * import dependency on this plugin.
 */
export const vigilGuardModel = {
    hitsParticipantScope,
    currentClientSession,
    clientSessionKeyFromSession,
    deleteClientSessionByVigilSessionId,
    isValidClientSessionForContest,
    listActiveSessionsForContest,
    effectiveContestAccess,
    getBrowserLockoutDecision,
    invalidateLockoutCache,
};

export function apply(ctx: Context) {
    if ((global as any).Hydro?.model) (global as any).Hydro.model.vigilguard = vigilGuardModel;

    ensureIndexes().catch((e) => {
        console.error('[krypton-vigilguard] ensureIndexes failed:', e);
    });

    applyHandlers(ctx);

    // Install the lockout layer AFTER the `user` layer (which populates
    // `ctx.HydroContext.user`). The framework runs layers in registration
    // order; `user` is registered in `service/server.ts` during hydrooj
    // startup, so plugin `apply()` always runs after it.
    ctx.inject(['server'], ({ server }) => {
        server.addHandlerLayer('vigilguard:lockout', vigilGuardLockoutLayer);
    });

    ctx.inject(['migration'], (c) => {
        c.migration.registerChannel('vigilguard', migrationScripts);
    });

    // Bust the lockout cache when contests change. We can't be more
    // surgical than "per-domain flush" because the affected user set
    // depends on the contest's scope which the bus event doesn't carry.
    // Per-domain flush is cheap because the LRU eviction runs first.
    (ctx.on as any)('contest/add', async (data: any, docId: any) => {
        invalidateLockoutCache(data?.domainId);
        await pushContestToVigilIfEnabled(data?.domainId, docId);
    });
    (ctx.on as any)('contest/edit', async (tdoc: any, domainId: string, tid: any) => {
        invalidateLockoutCache(domainId);
        await pushContestToVigilFromTdoc(domainId, tid, tdoc);
    });
    (ctx.on as any)('contest/del', async (domainId: string, tid: any) => {
        invalidateLockoutCache(domainId);
        try {
            await vigilBridge().deleteExamFromVigil(tid.toString());
        } catch (e: any) {
            console.error('[krypton-vigilguard] vigil delete push failed:', e?.message || e);
        }
    });

    ctx.on('app/started', async () => {
        await syncEnabledContestsToVigil();
    });
}

function vigilBridge(): any {
    // `hydrooj/src/service/vigil-bridge` is not exported as a package
    // subpath in production. Resolve it from the monorepo source path.
    return require('../hydrooj/src/service/vigil-bridge');
}

function parseList(value: any): string[] {
    return String(value || '')
        .split(/[\s,;]+/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function parsePorts(value: any): number[] {
    return parseList(value)
        .map((item) => Number(item))
        .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
}

function networkFields(tdoc: any) {
    const defaultPolicy = system.get('vigil.networkLockFailurePolicy') || 'strict';
    return {
        networkLockdownMode: !!tdoc.networkLockdownMode,
        networkLockdownFailurePolicy: tdoc.networkLockdownFailurePolicy
            || (tdoc.networkLockdownMode ? defaultPolicy : 'off'),
        networkWhitelistHosts: [
            ...parseList(system.get('vigil.networkLockDefaultHosts')),
            ...(tdoc.networkWhitelistHosts || []),
        ],
        networkWhitelistIps: [
            ...parseList(system.get('vigil.networkLockDefaultIps')),
            ...(tdoc.networkWhitelistIps || []),
        ],
        networkWhitelistPorts: [
            ...parsePorts(system.get('vigil.networkLockDefaultPorts')),
            ...(tdoc.networkWhitelistPorts || []),
        ],
    };
}

/** Internal: build the OjContestPayload from a tdoc. */
function buildExamPayload(domainId: string, tid: any, tdoc: any): any {
    // Merge OJ-global process whitelist with the contest-specific list so
    // admins have one place to add machine-shared safe processes (Windows
    // Update / Defender / WebView2 etc.) without touching every contest.
    //
    // The system setting is a comma/whitespace-separated string. Edit via:
    //   db.system.update(
    //     {_id: 'vigil.processWhitelistGlobal'},
    //     {$set: {value: 'msedge.exe, code.exe, python.exe, ...'}},
    //     {upsert: true}
    //   )
    // then `pm2 restart hydrooj` to pick up the new value.
    const globalWhitelist = parseList(system.get('vigil.processWhitelistGlobal'));
    const contestWhitelist = tdoc.vigilProcessWhitelist || [];
    const mergedWhitelist = Array.from(new Set([...globalWhitelist, ...contestWhitelist]));

    return {
        ojContestId: tid.toString(),
        ojDomainId: domainId,
        title: tdoc.title,
        rule: tdoc.rule || '',
        beginAt: tdoc.beginAt,
        endAt: tdoc.endAt,
        entryMode: tdoc.entryMode || 'open',
        approvalMode: tdoc.approvalMode || 'strict',
        lockdownMode: !!tdoc.lockdownMode,
        ...networkFields(tdoc),
        pauseOnDisconnect: !!tdoc.pauseOnDisconnect,
        screenshotIntervalMs: tdoc.screenshotIntervalMs || 60000,
        exclusive: !!tdoc.exclusive,
        clientLoginBlockBeforeMinutes: tdoc.clientLoginBlockBeforeMinutes ?? 60,
        clientLoginBlockAfterMinutes: tdoc.clientLoginBlockAfterMinutes ?? 30,
        // Krypton: live media + 8-class event detection
        liveEnabled: tdoc.liveEnabled !== false,
        recordEnabled: !!tdoc.recordEnabled,
        cameraEnabled: tdoc.cameraEnabled !== false,
        screenshotJitterMs: tdoc.screenshotJitterMs ?? 30000,
        processWhitelist: mergedWhitelist,
    };
}

/** Internal: push a contest payload to Vigil if vigilEnabled. */
async function pushContestToVigilIfEnabled(domainId: string, tid: any): Promise<void> {
    if (!domainId || !tid) return;
    try {
        const tdoc = await contestModel.get(domainId, tid);
        if (!tdoc?.vigilEnabled) return;
        await vigilBridge().pushExamToVigil(buildExamPayload(domainId, tid, tdoc));
    } catch (e: any) {
        console.error('[krypton-vigilguard] vigil push (add) failed:', e?.message || e);
    }
}

/**
 * Push `tdoc` to Vigil if `vigilEnabled`, or delete its mirror if it
 * just transitioned to `vigilEnabled=false`. Without the pre-edit
 * snapshot we can't distinguish "stays disabled" from "newly disabled"
 * cleanly — but DELETE is idempotent on Vigil's side and the cost of a
 * spurious 404 is negligible, so we always issue DELETE on disabled.
 */
async function pushContestToVigilFromTdoc(
    domainId: string, tid: any, tdoc: any,
): Promise<void> {
    if (!domainId || !tid || !tdoc) return;
    try {
        if (tdoc.vigilEnabled) {
            await vigilBridge().pushExamToVigil(buildExamPayload(domainId, tid, tdoc));
        } else {
            await vigilBridge().deleteExamFromVigil(tid.toString());
        }
    } catch (e: any) {
        console.error('[krypton-vigilguard] vigil push (edit) failed:', e?.message || e);
    }
}

async function syncEnabledContestsToVigil(): Promise<void> {
    try {
        const docs = await documentModel.coll.find({
            docType: documentModel.TYPE_CONTEST,
            vigilEnabled: true,
        }).toArray();
        for (const tdoc of docs) {
            await pushContestToVigilFromTdoc(tdoc.domainId || 'system', tdoc.docId, tdoc);
        }
        if (docs.length) console.log(`[krypton-vigilguard] synced ${docs.length} enabled contest(s) to Vigil`);
    } catch (e: any) {
        console.error('[krypton-vigilguard] startup Vigil sync failed:', e?.message || e);
    }
}
