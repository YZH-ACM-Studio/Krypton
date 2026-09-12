/**
 * In-process LRU for ordinary-browser lockout decisions.
 *
 * Public callers only need `invalidateLockoutCache` and
 * `getLockoutCacheGeneration`. Production uses this Map LRU (max 5000,
 * 120s TTL applied by the decision writer). Generation advances on every
 * invalidate so an in-flight miss cannot write a pre-mutation decision.
 */
export const LOCKOUT_CACHE_TTL_MS = 120 * 1000;
const CACHE_MAX = 5000;

export interface LockoutCacheDecision {
    contestId: string;
    blockEnd: number;
    title: string;
}

export interface LockoutCacheEntry {
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
    decision: LockoutCacheDecision | null;
}

const lockoutCache = new Map<string, LockoutCacheEntry>();
let lockoutCacheGeneration = 0;

function cacheKey(domainId: string, uid: number): string {
    return `${domainId}:${uid}`;
}

function cacheSet(key: string, computed: LockoutCacheEntry): void {
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

export function getLockoutCacheGeneration(): number {
    return lockoutCacheGeneration;
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

export function readLockoutCache(domainId: string, uid: number): LockoutCacheEntry | null {
    const key = cacheKey(domainId, uid);
    const e = lockoutCache.get(key);
    if (!e) return null;
    if (e.expiresAt <= Date.now()) {
        lockoutCache.delete(key);
        return null;
    }
    return e;
}

export function commitLockoutCache(
    domainId: string,
    uid: number,
    entry: LockoutCacheEntry,
    expectedGeneration: number,
): boolean {
    if (expectedGeneration !== lockoutCacheGeneration) return false;
    if (entry.expiresAt <= Date.now()) return false;
    cacheSet(cacheKey(domainId, uid), entry);
    return true;
}
