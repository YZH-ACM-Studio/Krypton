/**
 * Save/refresh orchestration for CF / Nowcoder snapshots (P2.2 G8).
 *
 * Called only from save and manual refresh — never from profile GET.
 * Same-handle fetch failures keep the last successful rating+fetchedAt and
 * record lastError. A handle change clears that site's rating first so a
 * failed new account cannot show the previous account's score.
 */
import { CodeforcesFetchError, fetchCodeforcesRating } from './cf';
import { fetchNowcoderRating, NowcoderFetchError } from './nowcoder';
import {
    emptyExternalRatingSiteSnapshot,
    EXTERNAL_RATING_MANUAL_REFRESH_COOLDOWN_MS,
    EXTERNAL_RATING_SITES,
    isExternalRatingSiteId,
    isHandleUnset,
    sameExternalRatingHandle,
    snapshotAfterFetchFailure,
    snapshotAfterFetchSuccess,
    snapshotAfterHandleChange,
    withSiteSnapshot,
    type ExternalRatingErrorCode,
    type ExternalRatingSiteId,
    type ExternalRatingSiteSnapshot,
    type UserExternalRatingState,
} from './types';
import { normalizeCfHandle, normalizeNowcoderName } from './validate';

export const MANUAL_REFRESH_MIN_INTERVAL_MS = EXTERNAL_RATING_MANUAL_REFRESH_COOLDOWN_MS;

export class ExternalRatingRefreshRateLimitError extends Error {
    constructor(message = 'External rating manual refresh is rate-limited') {
        super(message);
        this.name = 'ExternalRatingRefreshRateLimitError';
    }
}

export class ExternalRatingUnknownSiteError extends Error {
    constructor(site: string) {
        super(`Unknown external rating site: ${site}`);
        this.name = 'ExternalRatingUnknownSiteError';
    }
}

function logStage(stage: string, site: string, handle: string, detail?: string): void {
    const line = detail
        ? `krypton-external-rating.fetch stage=${stage} site=${site} handle=${handle} ${detail}`
        : `krypton-external-rating.fetch stage=${stage} site=${site} handle=${handle}`;
    if (stage === 'fetch_fail' || stage === 'rate_limited') console.error(line);
    else console.info(line);
}

function siteSnapshot(state: UserExternalRatingState, site: ExternalRatingSiteId): ExternalRatingSiteSnapshot {
    const raw = state[site];
    return raw == null ? emptyExternalRatingSiteSnapshot() : { ...raw };
}

function cloneState(state: UserExternalRatingState): UserExternalRatingState {
    return {
        codeforces: siteSnapshot(state, 'codeforces'),
        nowcoder: siteSnapshot(state, 'nowcoder'),
    };
}

function toDate(now: Date | number): Date {
    if (now instanceof Date) {
        if (Number.isNaN(now.getTime())) throw new TypeError('now is an invalid Date');
        return now;
    }
    if (typeof now === 'number' && Number.isFinite(now)) {
        const date = new Date(now);
        if (Number.isNaN(date.getTime())) throw new TypeError('now is not a valid timestamp');
        return date;
    }
    throw new TypeError('now must be a Date or epoch milliseconds');
}

function timestampMs(value: Date | number): number {
    if (value instanceof Date) return value.getTime();
    return value;
}

function normalizeHandleForSite(site: ExternalRatingSiteId, raw: unknown): string {
    if (site === 'codeforces') return normalizeCfHandle(raw);
    if (site === 'nowcoder') return normalizeNowcoderName(raw);
    throw new ExternalRatingUnknownSiteError(site);
}

function isTimeoutMessage(message: string): boolean {
    return /timed out|timeout/i.test(message);
}

function isHttpMessage(message: string): boolean {
    return /HTTP \d+/.test(message);
}

function classifyFetchError(error: unknown): ExternalRatingErrorCode {
    if (error instanceof CodeforcesFetchError || error instanceof NowcoderFetchError) {
        if (error.kind === 'not_found') return 'not_found';
        if (error.kind === 'malformed') return 'parse_failed';
        if (error.kind === 'network') {
            if (isTimeoutMessage(error.message)) return 'timeout';
            if (isHttpMessage(error.message)) return 'http_error';
            return 'network_error';
        }
    }
    if (error instanceof Error) {
        if (error.name === 'CodeforcesUserNotFoundError' || error.name === 'NowcoderUserNotFoundError') return 'not_found';
        if (error.name === 'CodeforcesMalformedError' || error.name === 'NowcoderMalformedError') return 'parse_failed';
        if (error.name === 'AbortError' || error.name === 'TimeoutError' || isTimeoutMessage(error.message)) return 'timeout';
        if (error.name === 'CodeforcesNetworkError' || error.name === 'NowcoderNetworkError') {
            if (isHttpMessage(error.message)) return 'http_error';
            return 'network_error';
        }
    }
    return 'network_error';
}

async function fetchSiteRating(site: ExternalRatingSiteId, handle: string): Promise<number | null> {
    if (site === 'codeforces') {
        const result = await fetchCodeforcesRating(handle);
        return result.rating;
    }
    if (site === 'nowcoder') {
        const result = await fetchNowcoderRating(handle);
        return result.rating;
    }
    throw new ExternalRatingUnknownSiteError(site);
}

export function shouldAllowManualRefresh(
    lastAttemptAt: Date | number | null | undefined,
    now: Date | number,
): boolean {
    if (lastAttemptAt == null) return true;
    const lastMs = timestampMs(lastAttemptAt);
    const nowMs = timestampMs(now);
    if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs)) return false;
    return nowMs - lastMs >= MANUAL_REFRESH_MIN_INTERVAL_MS;
}

export function assertManualRefreshAllowed(
    lastAttemptAt: Date | number | null | undefined,
    now: Date | number,
): void {
    if (!shouldAllowManualRefresh(lastAttemptAt, now)) {
        logStage('rate_limited', '-', '', `intervalMs=${MANUAL_REFRESH_MIN_INTERVAL_MS}`);
        throw new ExternalRatingRefreshRateLimitError();
    }
}

/**
 * Apply a new handle (or clear) to one site and fetch if non-empty.
 * Fetch failures never invent a rating.
 */
export async function applyFetch(
    state: UserExternalRatingState,
    site: ExternalRatingSiteId,
    newHandle: string,
    now: Date | number,
): Promise<UserExternalRatingState> {
    if (!isExternalRatingSiteId(site)) {
        throw new ExternalRatingUnknownSiteError(String(site));
    }
    const fetchedAt = toDate(now);
    const previous = siteSnapshot(state, site);
    const normalizedNew = normalizeHandleForSite(site, newHandle);

    if (isHandleUnset(normalizedNew)) {
        logStage('clear', site, '');
        // Unset handle cannot stay public (types invariant); G8 allows publicShow false.
        return withSiteSnapshot(cloneState(state), site, emptyExternalRatingSiteSnapshot());
    }

    const handleChanged = !sameExternalRatingHandle(site, previous.handle, normalizedNew);
    let working = snapshotAfterHandleChange(previous, site, normalizedNew);
    if (handleChanged) {
        logStage('handle_changed', site, normalizedNew, `from=${previous.handle || '-'}`);
    }

    logStage(handleChanged ? 'fetch_new' : 'fetch_same', site, normalizedNew);
    try {
        const rating = await fetchSiteRating(site, normalizedNew);
        working = snapshotAfterFetchSuccess(working, rating, fetchedAt);
        logStage('fetch_ok', site, normalizedNew, rating === null ? 'rating=null' : `rating=${rating}`);
    } catch (error: unknown) {
        const lastError = classifyFetchError(error);
        logStage('fetch_fail', site, normalizedNew, lastError);
        working = snapshotAfterFetchFailure(working, lastError);
    }
    return withSiteSnapshot(cloneState(state), site, working);
}

/**
 * Save-time dual fetch: independently fetch each site whose handle is
 * non-empty. One site's failure does not skip the other.
 *
 * When `newHandles` is passed, empty strings clear that site (G8). Omitted
 * sites keep their current snapshot and are fetched only if already set.
 */
export async function fetchBoth(
    state: UserExternalRatingState,
    now: Date | number,
    newHandles?: Partial<Record<ExternalRatingSiteId, string>>,
): Promise<UserExternalRatingState> {
    const updates = await Promise.all(EXTERNAL_RATING_SITES.map(async (site) => {
        if (newHandles && Object.prototype.hasOwnProperty.call(newHandles, site)) {
            const next = await applyFetch(state, site, newHandles[site] ?? '', now);
            return { site, snapshot: next[site] };
        }
        const current = state[site]?.handle ?? '';
        if (isHandleUnset(current) || newHandles) {
            return { site, snapshot: siteSnapshot(state, site) };
        }
        const next = await applyFetch(state, site, current, now);
        return { site, snapshot: next[site] };
    }));
    let result = cloneState(state);
    for (const { site, snapshot } of updates) {
        result = withSiteSnapshot(result, site, snapshot);
    }
    return result;
}

export async function refreshSite(
    state: UserExternalRatingState,
    site: ExternalRatingSiteId,
    now: Date | number,
    lastAttemptAt: Date | number | null | undefined,
): Promise<UserExternalRatingState> {
    assertManualRefreshAllowed(lastAttemptAt, now);
    const handle = state[site]?.handle ?? '';
    return applyFetch(state, site, handle, now);
}

export async function refreshBoth(
    state: UserExternalRatingState,
    now: Date | number,
    lastAttemptAt: Date | number | null | undefined,
): Promise<UserExternalRatingState> {
    assertManualRefreshAllowed(lastAttemptAt, now);
    return fetchBoth(state, now);
}
