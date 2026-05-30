/**
 * Routes owned by krypton-vigilguard.
 *
 *   GET /client-required-notice            — the lockout landing page.
 *                                            Visitors and locked-out
 *                                            students see this when the
 *                                            lockout layer drops them
 *                                            here.
 */
import type { Context } from 'hydrooj';
import {
    Handler, NotFoundError, ObjectId, OplogModel, param, PRIV, Types,
} from 'hydrooj';
import * as contest from 'hydrooj/src/model/contest';
import system from 'hydrooj/src/model/system';

class ClientRequiredNoticeHandler extends Handler {
    /** Anyone can see the notice — there's no useful information leak
     *  here (just contest title + ETA). */
    noCheckPermView = true;

    @param('tid', Types.ObjectId, true)
    async get(domainId: string, tid?: ObjectId) {
        let tdoc = null;
        if (tid) {
            try { tdoc = await contest.get(domainId, tid); } catch { tdoc = null; }
        }
        const window = tdoc ? contest.effectiveLockoutWindow(tdoc) : null;
        this.response.body = {
            title: tdoc?.title || null,
            blockStart: window?.blockStart || null,
            blockEnd: window?.blockEnd || null,
            entryMode: tdoc?.entryMode || null,
            // The ui-next layer renders this — there's no Jinja template
            // to set here. The page-name routes to a React route in
            // ui-next's `router.tsx`.
            page_name: 'client_required_notice',
        };
        // No template for the new UI; ui-next uses the route name +
        // body to render. Legacy UI falls back to a minimal text view.
        this.response.template = 'client_required_notice.html';
    }
}

// ── Admin: re-sync a contest to Vigil ────────────────────────────────────

function vigilBridge(): any {
    return require('../../hydrooj/src/service/vigil-bridge');
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

function mediaFields(tdoc: any) {
    const processWhitelist = Array.from(new Set([
        ...parseList(system.get('vigil.processWhitelistGlobal')),
        ...parseList(tdoc.vigilProcessWhitelist),
    ]));
    return {
        liveEnabled: tdoc.liveEnabled !== false,
        recordEnabled: !!tdoc.recordEnabled,
        cameraEnabled: tdoc.cameraEnabled !== false,
        screenshotJitterMs: tdoc.screenshotJitterMs ?? 30000,
        processWhitelist,
    };
}

/**
 * Manual "push this contest to Vigil now" trigger. Used by the admin
 * Vigil page when the auto-push at save time failed (Vigil down, etc.)
 * and the operator wants to retry without re-editing the contest.
 */
class VigilGuardResyncContestHandler extends Handler {
    async prepare() { this.checkPriv(PRIV.PRIV_EDIT_SYSTEM); }

    @param('tid', Types.ObjectId)
    async post(domainId: string, tid: ObjectId) {
        // domainId comes from the URL path (`/d/:domainId/...`).
        domainId ||= (this as any).args.domainId || 'system';
        const tdoc = await contest.get(domainId, tid).catch(() => null);
        if (!tdoc) throw new NotFoundError('Contest', tid);

        try {
            if (tdoc.vigilEnabled) {
                await vigilBridge().pushExamToVigil({
                    ojContestId: tid.toString(),
                    ojDomainId: domainId,
                    title: tdoc.title,
                    rule: tdoc.rule || '',
                    beginAt: tdoc.beginAt as any,
                    endAt: tdoc.endAt as any,
                    entryMode: tdoc.entryMode || 'open',
                    approvalMode: tdoc.approvalMode || 'strict',
                    lockdownMode: !!tdoc.lockdownMode,
                    ...networkFields(tdoc),
                    pauseOnDisconnect: !!tdoc.pauseOnDisconnect,
                    screenshotIntervalMs: tdoc.screenshotIntervalMs || 60000,
                    exclusive: !!tdoc.exclusive,
                    clientLoginBlockBeforeMinutes: tdoc.clientLoginBlockBeforeMinutes ?? 60,
                    clientLoginBlockAfterMinutes: tdoc.clientLoginBlockAfterMinutes ?? 30,
                    ...mediaFields(tdoc),
                } as any);
            } else {
                await vigilBridge().deleteExamFromVigil(tid.toString());
            }
            await OplogModel.log(this as any, 'vigilguard.resync', {
                tid: tid.toString(), domainId, vigilEnabled: !!tdoc.vigilEnabled,
            });
            this.response.body = { ok: true, vigilEnabled: !!tdoc.vigilEnabled };
        } catch (e: any) {
            await OplogModel.log(this as any, 'vigilguard.resync_fail', {
                tid: tid.toString(), domainId, error: e?.message || String(e),
            });
            this.response.status = 502;
            this.response.body = { ok: false, error: e?.message || String(e) };
        }
    }
}

export function applyHandlers(ctx: Context) {
    ctx.Route('client_required_notice', '/client-required-notice', ClientRequiredNoticeHandler);
    ctx.Route(
        'vigilguard_resync',
        '/api/admin/vigilguard/resync/:tid',
        VigilGuardResyncContestHandler,
        PRIV.PRIV_EDIT_SYSTEM,
    );
}
