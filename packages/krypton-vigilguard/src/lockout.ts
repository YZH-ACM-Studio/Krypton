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
 * Caching: step 5 is the expensive one — we look up `userbind.students`
 * and `document` (contest collection). Result is keyed by uid and lives
 * for 120s in an in-process LRU (`CACHE_TTL_MS`). Mutation paths
 * (contest save, scope edit) call `invalidateLockoutCache()` to bust
 * affected entries.
 */
import type { KoaContext } from '@hydrooj/framework';
import type { Tdoc } from 'hydrooj';
import { PRIV } from 'hydrooj/src/model/builtin';
import * as contest from 'hydrooj/src/model/contest';
import * as document from 'hydrooj/src/model/document';
import userModel from 'hydrooj/src/model/user';
import { clientSessionKeyFromSession, currentClientSession } from './helpers';

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

const lockoutCache = new Map<string, CacheEntry>();

function cacheKey(domainId: string, uid: number): string {
    return `${domainId}:${uid}`;
}

function cacheGet(key: string): CacheEntry | null {
    const e = lockoutCache.get(key);
    if (!e) return null;
    if (e.expiresAt < Date.now()) {
        lockoutCache.delete(key);
        return null;
    }
    return e;
}

function cacheSet(key: string, decision: CacheEntry['decision']): void {
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
    lockoutCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, decision });
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

export async function getBrowserLockoutDecision(
    domainId: string, uid: number, session?: any,
): Promise<CacheEntry['decision']> {
    const sid = session ? clientSessionKeyFromSession(session) : '';
    if (sid) {
        const sess = await currentClientSession(sid);
        if (sess && sess.uid === uid && sess.domainId === domainId) return null;
    }

    const key = cacheKey(domainId, uid);
    let entry = cacheGet(key);
    if (!entry) {
        const decision = await computeLockoutDecision(domainId, uid);
        cacheSet(key, decision);
        entry = { expiresAt: Date.now() + CACHE_TTL_MS, decision };
    }
    return entry.decision;
}

// ── Lockout decision ──────────────────────────────────────────────────────

async function hitsLegacyHydroAccess(domainId: string, tdoc: Tdoc, uid: number): Promise<boolean> {
    if ((tdoc as any).assign?.length) {
        const groups = await userModel.listGroup(domainId, uid);
        const groupNames = groups.map((g: any) => g.name);
        if (!(tdoc as any).assign.some((name: string) => groupNames.includes(name))) return false;
    }
    if ((tdoc as any)._code) {
        const tsdoc = await contest.getStatus(domainId, tdoc.docId, uid);
        if (!tsdoc?.attend) return false;
    }
    return true;
}

/**
 * Compute whether `uid` is currently locked out of normal-browser access
 * in `domainId`. Returns the picked contest (soonest blockEnd) when
 * locked, else `null`.
 */
async function computeLockoutDecision(
    domainId: string, uid: number,
): Promise<CacheEntry['decision']> {
    const userbind = (global as any).Hydro?.model?.userbind;
    if (!userbind?.findStudentsByUserIds) return null; // userbind not loaded

    const studentDict = await userbind.findStudentsByUserIds(domainId, [uid]);
    const record = studentDict[String(uid)];
    // If the user has no StudentRecord we cannot determine scope — by
    // design (§7.1) we do NOT lock unbound users out of the whole site
    // just because some contest has a school/group restriction. They'll
    // still bounce when they try to enter the contest itself.
    if (!record) return null;

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
    for await (const t of cursor) {
        const tdoc = t as any as Tdoc;
        if (!contest.isInLockoutWindow(tdoc, new Date(now))) continue;

        // Krypton scope match
        if (tdoc.participantScopeMode === 'schools') {
            const wantIds = (tdoc.participantSchoolIds || []).map((o: any) => o.toString());
            const have = record.schoolId?.toString();
            if (!have || !wantIds.includes(have)) continue;
        } else if (tdoc.participantScopeMode === 'groups') {
            const wantIds = (tdoc.participantGroupIds || []).map((o: any) => o.toString());
            const have: any[] = record.groupIds || [];
            if (!have.some((g: any) => wantIds.includes(g.toString()))) continue;
        }
        // (mode 'none' falls through — every bound student in the
        // domain hits the lockout)
        if (!(await hitsLegacyHydroAccess(domainId, tdoc, uid))) continue;

        const w = contest.effectiveLockoutWindow(tdoc);
        if (!w) continue;
        if (!best || w.blockEnd.getTime() < best.blockEnd) {
            best = {
                contestId: (tdoc as any)._id?.toString() || tdoc.docId.toString(),
                blockEnd: w.blockEnd.getTime(),
                title: tdoc.title,
            };
        }
    }
    return best;
}

// ── Layer ─────────────────────────────────────────────────────────────────

export const vigilGuardLockoutLayer = async (ctx: KoaContext, next: () => Promise<void>) => {
    // Only check on plain HTTP routes — WebSocket has a different lifecycle
    // and admins close those independently. (We also skip if HydroContext
    // isn't ready yet — e.g., the setup wizard before db is online.)
    const path = ctx.request?.path || '';
    if (matchesWhitelist(path)) { await next(); return; }

    const hctx = (ctx as any).HydroContext;
    if (!hctx) { await next(); return; }
    const { user, domain } = hctx;

    // Anonymous & admin bypasses
    if (!user || user._id === 0) { await next(); return; }
    if (user.hasPriv?.(PRIV.PRIV_EDIT_SYSTEM)) { await next(); return; }

    const domainId = domain?._id || 'system';

    const decision = await getBrowserLockoutDecision(domainId, user._id, ctx.session);
    if (!decision) { await next(); return; }

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
