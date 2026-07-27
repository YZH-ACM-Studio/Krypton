/**
 * Normal-browser-login lockout for students inside the management window
 * of a client_required contest.
 *
 * Design ref: §7 of CLIENT_REQUIRED_CONTEST_DESIGN.md.
 *
 * Behavior (per-request, runs as a handler layer after `user`):
 *   1. Whitelist paths bypass entirely (login / logout / bind / claim /
 *      the notice page itself / static resources).
 *   2. Anonymous (uid===0) skip — there's no "session to invalidate" yet.
 *   3. Admin / PRIV_EDIT_SYSTEM bypass — operators can always reach the
 *      site, even during a lockout, for diagnostics.
 *   4. If the request already has a valid client session, skip — the
 *      student is inside Qt Client, this is exactly what we want.
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
import type { Tdoc } from 'hydrooj';
import { PERM, PRIV } from 'hydrooj/src/model/builtin';
import * as contest from 'hydrooj/src/model/contest';
import * as contestTeam from 'hydrooj/src/model/contest-team';
import * as document from 'hydrooj/src/model/document';
import userModel from 'hydrooj/src/model/user';
import { clientSessionKeyFromSession, currentClientSession, hitsParticipantScope } from './helpers';
import { isBrowserLockoutAudience } from './lockout-audience';

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
 * So static requests never reach us. We still whitelist `/` so that the
 * notice page's CSS bundle loads.
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

export async function getBrowserLockoutDecision(domainId: string, uid: number, session?: any): Promise<CacheEntry['decision']> {
    const sid = session ? clientSessionKeyFromSession(session) : '';
    if (sid) {
        const sess = await currentClientSession(sid);
        if (sess && sess.uid === uid && sess.domainId === domainId) return null;
    }

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
    if (matchesWhitelist(path)) {
        await next();
        return;
    }

    const hctx = (ctx as any).HydroContext;
    if (!hctx) {
        await next();
        return;
    }
    const { user, domain } = hctx;

    // Anonymous & admin bypasses
    if (!user || user._id === 0) {
        await next();
        return;
    }
    if (user.hasPriv?.(PRIV.PRIV_EDIT_SYSTEM)) {
        await next();
        return;
    }
    if (user.hasPerm?.(PERM.PERM_EDIT_CONTEST)) {
        await next();
        return;
    }

    const domainId = domain?._id || 'system';

    const decision = await getBrowserLockoutDecision(domainId, user._id, ctx.session);
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
