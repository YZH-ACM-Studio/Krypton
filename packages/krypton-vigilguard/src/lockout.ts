/**
 * Normal-browser-login lockout for students inside the management window
 * of a client_required contest.
 *
 * Design ref: §7 of CLIENT_REQUIRED_CONTEST_DESIGN.md.
 *
 * Behavior (per-request, runs as a handler layer after `user`):
 *   1. A valid client session is marked as a contest-bound authority. A
 *      `handler/before-prepare` hook then confines it before route-specific
 *      preparation or business logic can run.
 *   2. Ordinary-browser recovery paths bypass the audience lockout.
 *   3. Anonymous (uid===0) ordinary-browser requests skip.
 *   4. Admin / PRIV_EDIT_SYSTEM bypass — ordinary operator sessions can
 *      always reach the site for diagnostics; a Vigil-bound operator session
 *      deliberately remains inside its exam workspace.
 *   5. Otherwise, compute the set of client_required contests whose
 *      lockout window contains `now` AND that this student is eligible
 *      for (legacy assign + Krypton scope). If non-empty, drop the
 *      session (`uid=0`) and redirect to `/client-required-notice`.
 *
 * Caching: step 5 is the expensive one — it reads the contest collection
 * plus only the canonical scope/status/team facts required by each contest.
 * Result is keyed by uid and lives for at most 120s in an in-process LRU
 * (`CACHE_TTL_MS`). An entry expires earlier at the next relevant lockout
 * window boundary, so a cached allow/deny never crosses blockStart/blockEnd.
 * Mutation paths (contest save, scope edit) call `invalidateLockoutCache()`
 * to bust affected entries.
 */
import type { KoaContext } from '@hydrooj/framework';
import { Logger } from '@hydrooj/utils';
import type { Tdoc } from 'hydrooj';
import { PERM, PRIV } from 'hydrooj/src/model/builtin';
import * as contest from 'hydrooj/src/model/contest';
import * as contestTeam from 'hydrooj/src/model/contest-team';
import * as document from 'hydrooj/src/model/document';
import userModel from 'hydrooj/src/model/user';
import { clientSessionKeyFromSession, currentClientSession, hitsParticipantScope } from './helpers';
import { isBrowserLockoutAudience } from './lockout-audience';
import type { ClientSessionDoc } from './types';

const logger = new Logger('vigilguard.lockout');
const BOUND_CLIENT_AUTHORITY = Symbol('krypton.vigilguard.bound-client-authority');

interface BoundClientAuthority {
    contestId: string;
    domainId: string;
    uid: number;
}

// ── Whitelist ─────────────────────────────────────────────────────────────

/**
 * Paths that bypass the lockout. Anything not matching here gets the
 * full check.
 *
 * Pattern: each entry is either an exact path or a `path*` prefix match.
 * The check is path-only (no query string), case-sensitive.
 *
 * NOTE: static asset prefixes are excluded here because the static
 * server is configured *before* this layer in the chain (see
 * `server.addServerLayer(addon_public, ...)` in `service/server.ts`).
 * So static requests never reach us.
 */
const WHITELIST_PATHS = [
    '/client-required-notice',
    '/login',
    '/logout',
    '/register',
    '/lostpass',
    '/bind*',
    '/claim*',
    '/oauth*',
    '/d/system/login',
    '/d/system/logout',
    '/d/system/bind*',
    '/d/system/claim*',
];

function matchesWhitelist(path: string): boolean {
    for (const pat of WHITELIST_PATHS) {
        if (pat.endsWith('*')) {
            if (path === pat.slice(0, -1) || path.startsWith(pat.slice(0, -1))) return true;
        } else if (path === pat) return true;
    }
    return false;
}

// ── Cache ─────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 120 * 1000;
const CACHE_MAX = 5000;

interface CacheEntry {
    /** wall-clock cache expiry */
    expiresAt: number;
    /**
     * The lockout decision at cache time:
     *   - `null` ⇒ not locked
     *   - `{ contestId, blockEnd, title }` ⇒ locked; the picked contest
     *     is the one whose window the user is hitting (the one with the
     *     soonest `blockEnd` — that's the most relevant "ETA" for the
     *     notice page).
     */
    decision: null | { contestId: string; blockEnd: number; title: string };
}

interface ComputedDecision {
    decision: CacheEntry['decision'];
    expiresAt: number;
}

const lockoutCache = new Map<string, CacheEntry>();
let lockoutCacheGeneration = 0;

function cacheKey(domainId: string, uid: number): string {
    return `${domainId}:${uid}`;
}

function cacheGet(key: string): CacheEntry | null {
    const e = lockoutCache.get(key);
    if (!e) return null;
    if (e.expiresAt <= Date.now()) {
        lockoutCache.delete(key);
        return null;
    }
    return e;
}

function cacheSet(key: string, computed: ComputedDecision): void {
    if (lockoutCache.size >= CACHE_MAX) {
        // Evict ~20% oldest entries. Cheap heuristic; we keep ordering by
        // insertion via Map's iteration order.
        const toEvict = Math.floor(CACHE_MAX * 0.2);
        let i = 0;
        for (const k of lockoutCache.keys()) {
            lockoutCache.delete(k);
            if (++i >= toEvict) break;
        }
    }
    lockoutCache.set(key, computed);
}

/**
 * Bust the lockout cache. Call this from contest save / scope edit
 * mutation paths so the next request sees the new state.
 *
 * If `domainId` and `uid` are both given, only that entry is dropped.
 * If only `domainId` is given, all entries in that domain are dropped.
 * No args ⇒ flush everything (e.g., system-wide policy change).
 */
export function invalidateLockoutCache(domainId?: string, uid?: number): void {
    // Advance before deleting entries so an in-flight cache miss cannot
    // repopulate a decision computed from state that predates this mutation.
    lockoutCacheGeneration += 1;
    if (domainId && uid) {
        lockoutCache.delete(cacheKey(domainId, uid));
        return;
    }
    if (domainId) {
        const prefix = `${domainId}:`;
        for (const k of lockoutCache.keys()) {
            if (k.startsWith(prefix)) lockoutCache.delete(k);
        }
        return;
    }
    lockoutCache.clear();
}

export async function getBrowserLockoutDecision(domainId: string, uid: number): Promise<CacheEntry['decision']> {
    const key = cacheKey(domainId, uid);
    for (;;) {
        const entry = cacheGet(key);
        if (entry) return entry.decision;
        const generation = lockoutCacheGeneration;
        const computed = await computeLockoutDecision(domainId, uid);
        if (generation !== lockoutCacheGeneration) continue;
        if (computed.expiresAt <= Date.now()) continue;
        cacheSet(key, computed);
        return computed.decision;
    }
}

function requestPathInsideDomain(path: string, domainId: string): string {
    const prefix = `/d/${encodeURIComponent(domainId)}`;
    if (path === prefix) return '/';
    if (path.startsWith(`${prefix}/`)) return path.slice(prefix.length);
    return path;
}

function requestQueryValue(ctx: KoaContext, key: string): string {
    const value = (ctx.query as Record<string, unknown> | undefined)?.[key] ?? (ctx.request?.query as Record<string, unknown> | undefined)?.[key];
    if (Array.isArray(value)) return value.length === 1 ? String(value[0]) : '';
    return value === undefined || value === null ? '' : String(value);
}

function isBoundClientWorkspacePath(path: string, contestId: string): boolean {
    const examPrefix = `/exam-mode/${contestId}`;
    const paperPrefix = `/paper/${contestId}`;
    return path === examPrefix || path.startsWith(`${examPrefix}/`) || path === paperPrefix || path.startsWith(`${paperPrefix}/`);
}

/**
 * A Vigil-bound Hydro session is authority for one exam workspace, not a
 * general OJ login. Keep the few legacy support endpoints explicit because
 * the exam UI still submits code and polls pretests through their canonical
 * handlers; each of those handlers independently verifies the same `tid`.
 */
function isBoundClientRequestAllowed(ctx: KoaContext, domainId: string, contestId: string): boolean {
    const requestDomainId = String((ctx as any).HydroContext?.domain?._id || '');
    if (requestDomainId !== domainId) return false;
    const path = requestPathInsideDomain(ctx.request?.path || '', domainId);
    if (isBoundClientWorkspacePath(path, contestId)) return true;

    const method = String(ctx.request?.method || 'GET').toUpperCase();
    const requestedContestId = requestQueryValue(ctx, 'tid');
    if (requestedContestId !== contestId) return false;

    if (method === 'POST' && /^\/p\/[^/]+\/submit$/.test(path)) return true;
    if (method === 'GET' && /^\/p\/[^/]+\/file\/[^/]+$/.test(path)) return true;
    if (
        method === 'GET'
        && (ctx as any).HydroContext?.request?.json === true
        && (path === '/record' || /^\/record\/[0-9a-f]{24}$/i.test(path))
    ) return true;
    return false;
}

function domainPath(domainId: string, path: string): string {
    return `/d/${encodeURIComponent(domainId)}${path}`;
}

function boundExamEntry(domainId: string, contestId: string): string {
    return domainPath(domainId, `/exam-mode/${contestId}`);
}

function safeClientFormReturnPath(path: string, domainId: string, contestId: string): string {
    const normalized = requestPathInsideDomain(path, domainId);
    if (isBoundClientWorkspacePath(normalized, contestId)) return domainPath(domainId, normalized);
    const submit = /^\/p\/([^/]+)\/submit$/.exec(normalized);
    if (submit) return `${boundExamEntry(domainId, contestId)}/problem/${encodeURIComponent(submit[1])}`;
    return boundExamEntry(domainId, contestId);
}

function clientAuthority(session: ClientSessionDoc): BoundClientAuthority {
    const contestId = session.contestId?.toHexString?.() || '';
    if (!contestId || !session.domainId || !Number.isSafeInteger(session.uid)) {
        throw new TypeError('Active Vigil client session has an invalid contest binding.');
    }
    return { contestId, domainId: session.domainId, uid: session.uid };
}

/**
 * Stop a bound Client request after Hydro has selected its handler but before
 * that handler can prepare data or run business logic. Returning `cleanup`
 * uses Hydro's supported short-circuit path and keeps response serialization
 * intact; returning directly from the earlier Koa layer would leave Hydro
 * without a handler and turn the intended redirect into a 500 response.
 */
export function enforceBoundClientHandler(handler: any): 'cleanup' | undefined {
    const context = handler?.context as (KoaContext & { [BOUND_CLIENT_AUTHORITY]?: BoundClientAuthority }) | undefined;
    const authority = context?.[BOUND_CLIENT_AUTHORITY];
    if (!context || !authority || isBoundClientRequestAllowed(context, authority.domainId, authority.contestId)) return undefined;

    const target = boundExamEntry(authority.domainId, authority.contestId);
    logger.warn(
        'Client route confinement denied domain=%s contest=%s actor=%d method=%s path=%s result=redirected target=%s',
        authority.domainId,
        authority.contestId,
        authority.uid,
        context.request?.method || '-',
        context.request?.path || '-',
        target,
    );
    handler.response.status = 302;
    handler.response.template = null;
    handler.response.body = {};
    handler.response.redirect = target;
    return 'cleanup';
}

// ── Lockout decision ──────────────────────────────────────────────────────

async function resolveLegacyAssignMatch(domainId: string, tdoc: Tdoc, uid: number): Promise<boolean> {
    if ((tdoc as any).assign?.length) {
        const groups = await userModel.listGroup(domainId, uid);
        const groupNames = groups.map((g: any) => g.name);
        return (tdoc as any).assign.some((name: string) => groupNames.includes(name));
    }
    return true;
}

/**
 * Compute whether `uid` is currently locked out of normal-browser access
 * in `domainId`. Returns the picked contest (soonest blockEnd) when
 * locked, else `null`.
 */
async function computeLockoutDecision(domainId: string, uid: number): Promise<ComputedDecision> {
    // Pull every client_required contest in the domain that's currently
    // in its lockout window. The condition is:
    //   tdoc.entryMode === 'client_required'
    //   tdoc.beginAt - beforeMin <= now <= tdoc.endAt + afterMin
    //
    // We can't directly express the beforeMin/afterMin offsets in the
    // query because they're per-contest fields, so we use a broad cut
    // (beginAt - 24h <= now <= endAt + 24h) and filter in JS.
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const cursor = document.coll.find({
        domainId,
        docType: document.TYPE_CONTEST,
        entryMode: 'client_required',
        beginAt: { $lte: new Date(now + dayMs) },
        endAt: { $gte: new Date(now - dayMs) },
    } as any);

    let best: CacheEntry['decision'] = null;
    let expiresAt = now + CACHE_TTL_MS;
    for await (const t of cursor) {
        const tdoc = t as any as Tdoc;
        if (tdoc.owner === uid || (tdoc.maintainer || []).includes(uid)) continue;

        const window = contest.effectiveLockoutWindow(tdoc);
        if (!window) continue;
        const blockStart = window.blockStart.getTime();
        const blockEnd = window.blockEnd.getTime();
        if (now >= blockEnd) continue;

        const participationMode = contest.getParticipationMode(tdoc);
        const teamFinalizationPending = participationMode === 'team' && contest.isTeamBatchFinalizationPending(tdoc);
        const team = participationMode === 'team' && !teamFinalizationPending ? await contestTeam.getTeamByMember(domainId, tdoc.docId, uid) : null;
        const hasExplicitParticipantScope = contest.hasParticipantScope(tdoc);
        const participantScopeMatches =
            participationMode === 'team' || !hasExplicitParticipantScope ? true : await hitsParticipantScope(domainId, tdoc, uid);
        const hasLegacyAssign = !!(tdoc as any).assign?.length;
        const legacyAssignMatches = participationMode === 'team' || !hasLegacyAssign ? true : await resolveLegacyAssignMatch(domainId, tdoc, uid);
        const hasInviteCode = !!(tdoc as any)._code;
        const needsAttendance = participationMode === 'individual' && (hasInviteCode || (!hasExplicitParticipantScope && !hasLegacyAssign));
        const attended = needsAttendance ? !!(await contest.getStatus(domainId, tdoc.docId, uid))?.attend : false;

        if (
            !isBrowserLockoutAudience({
                participationMode,
                hasFinalizedTeamRoster: participationMode === 'team' && !teamFinalizationPending,
                isActiveTeamMember: !!team,
                hasExplicitParticipantScope,
                participantScopeMatches,
                hasLegacyAssign,
                legacyAssignMatches,
                hasInviteCode,
                attended,
            })
        ) {
            continue;
        }

        if (now < blockStart) {
            expiresAt = Math.min(expiresAt, blockStart);
            continue;
        }

        expiresAt = Math.min(expiresAt, blockEnd);
        if (!best || blockEnd < best.blockEnd) {
            best = {
                contestId: (tdoc as any)._id?.toString() || tdoc.docId.toString(),
                blockEnd,
                title: tdoc.title,
            };
        }
    }
    return { decision: best, expiresAt };
}

// ── Layer ─────────────────────────────────────────────────────────────────

export const vigilGuardLockoutLayer = async (ctx: KoaContext, next: () => Promise<void>) => {
    // Only check on plain HTTP routes — WebSocket has a different lifecycle
    // and admins close those independently. (We also skip if HydroContext
    // isn't ready yet — e.g., the setup wizard before db is online.)
    const path = ctx.request?.path || '';
    const hctx = (ctx as any).HydroContext;
    if (!hctx) {
        await next();
        return;
    }
    const { user, domain } = hctx;
    const sid = clientSessionKeyFromSession((ctx as any).session);
    const clientSession = sid ? await currentClientSession(sid) : null;
    if (clientSession && user && clientSession.uid === user._id) {
        const authority = clientAuthority(clientSession);
        (ctx as KoaContext & { [BOUND_CLIENT_AUTHORITY]?: BoundClientAuthority })[BOUND_CLIENT_AUTHORITY] = authority;

        await next();

        // Parameter validation for a plain HTML form used to replace the
        // exam shell with Hydro's generic error chrome. Keep user-facing POST
        // errors inside the bound workspace; JSON callers retain the original
        // structured error response.
        const request = (ctx as any).HydroContext?.request;
        const response = (ctx as any).HydroContext?.response;
        if (
            request?.method === 'post' &&
            request?.json !== true &&
            response?.template === 'error.html' &&
            Number(response?.status) >= 400 &&
            Number(response?.status) < 500
        ) {
            const target = safeClientFormReturnPath(ctx.request?.path || '', authority.domainId, authority.contestId);
            logger.warn(
                'Client form error contained domain=%s contest=%s actor=%d path=%s status=%d result=redirected target=%s',
                authority.domainId,
                authority.contestId,
                authority.uid,
                ctx.request?.path || '-',
                response.status,
                target,
            );
            response.status = 302;
            response.template = null;
            response.body = {};
            response.redirect = target;
        }
        return;
    }

    // Anonymous requests do not carry an exam authority to confine.
    if (!user || user._id === 0) {
        await next();
        return;
    }

    const domainId = domain?._id || 'system';

    // Login/binding recovery routes bypass only the ordinary-browser
    // lockout. A live Client session must not turn `/logout`, `/bind`, or an
    // OAuth page into a route out of the bound exam workspace.
    if (matchesWhitelist(path)) {
        await next();
        return;
    }

    // Operator bypass applies only to ordinary browser sessions. Entering
    // through Vigil deliberately opts even an operator into the exam shell.
    if (user.hasPriv?.(PRIV.PRIV_EDIT_SYSTEM)) {
        await next();
        return;
    }
    if (user.hasPerm?.(PERM.PERM_EDIT_CONTEST)) {
        await next();
        return;
    }

    const decision = await getBrowserLockoutDecision(domainId, user._id);
    if (!decision) {
        await next();
        return;
    }

    // Locked out: drop the session and redirect. Koa's `ctx.redirect()`
    // takes a URL string; we also set status 302 explicitly so the chain
    // doesn't continue calling `next()`.
    if (ctx.session) {
        ctx.session.uid = 0;
        ctx.session.scope = undefined;
    }
    const notice = `/client-required-notice?tid=${encodeURIComponent(decision.contestId)}`;
    (ctx as any).status = 302;
    (ctx as any).redirect(notice);
};
