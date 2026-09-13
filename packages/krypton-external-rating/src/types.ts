/**
 * Canonical CF / Nowcoder rating snapshots on a bound Hydro user document.
 *
 * Empty handle means unset. publicShow defaults to false and is never inferred as true.
 * Snapshot score fields are server-owned. Do not store this on domain.user.rp / rpInfo.
 */

export const EXTERNAL_RATING_SITES = ['codeforces', 'nowcoder'] as const;
export type ExternalRatingSiteId = (typeof EXTERNAL_RATING_SITES)[number];

/** Codeforces handle. Empty string means unset. */
export type CodeforcesHandle = string;
/** Nowcoder username. Empty string means unset. */
export type NowcoderUsername = string;

export const USER_EXTERNAL_RATING_KEY = 'externalRating' as const;

export const EXTERNAL_RATING_UNSET_HANDLE = '' as const;
export const EXTERNAL_RATING_PUBLIC_SHOW_DEFAULT = false as const;

export const EXTERNAL_RATING_SITE_SNAPSHOT_KEYS = ['handle', 'rating', 'fetchedAt', 'lastError', 'publicShow'] as const;
export type ExternalRatingSiteSnapshotKey = (typeof EXTERNAL_RATING_SITE_SNAPSHOT_KEYS)[number];

export const EXTERNAL_RATING_CLIENT_WRITABLE_KEYS = ['handle', 'publicShow'] as const;
export type ExternalRatingClientWritableKey = (typeof EXTERNAL_RATING_CLIENT_WRITABLE_KEYS)[number];

export const EXTERNAL_RATING_SERVER_OWNED_KEYS = ['rating', 'fetchedAt', 'lastError'] as const;
export type ExternalRatingServerOwnedKey = (typeof EXTERNAL_RATING_SERVER_OWNED_KEYS)[number];

export const HYDRO_RP_FIELD_KEYS = ['rp', 'rpInfo', 'rpdelta'] as const;

export const CODEFORCES_HANDLE_MIN_LENGTH = 3;
export const CODEFORCES_HANDLE_MAX_LENGTH = 24;
export const CODEFORCES_HANDLE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{2,23}$/;

export const NOWCODER_USERNAME_MIN_LENGTH = 1;
export const NOWCODER_USERNAME_MAX_LENGTH = 64;

export const EXTERNAL_RATING_MIN = 0;
export const EXTERNAL_RATING_MAX = 99999;

export const CODEFORCES_USER_INFO_URL = 'https://codeforces.com/api/user.info';
export const EXTERNAL_RATING_FETCH_TIMEOUT_MS = 10_000;
export const EXTERNAL_RATING_MANUAL_REFRESH_COOLDOWN_MS = 60_000;

export const EXTERNAL_RATING_SITE_LABEL: Record<ExternalRatingSiteId, string> = {
    codeforces: 'Codeforces',
    nowcoder: '牛客',
};

export const EXTERNAL_RATING_CLIENT_HANDLE_KEY = {
    codeforces: 'codeforcesHandle',
    nowcoder: 'nowcoderUsername',
} as const;

export const EXTERNAL_RATING_CLIENT_PUBLIC_SHOW_KEY = {
    codeforces: 'codeforcesPublicShow',
    nowcoder: 'nowcoderPublicShow',
} as const;

export const EXTERNAL_RATING_ERROR_CODES = [
    'not_found',
    'timeout',
    'http_error',
    'api_error',
    'parse_failed',
    'network_error',
    'rate_limited',
    'invalid_handle',
] as const;
export type ExternalRatingErrorCode = (typeof EXTERNAL_RATING_ERROR_CODES)[number];

export type ExternalRatingFetchTrigger = 'save_handle' | 'manual_refresh';
export type ExternalRatingViewerRole = 'owner' | 'teacher' | 'admin' | 'other';

export class ExternalRatingTypeError extends TypeError {
    readonly field: string;

    constructor(field: string, message: string) {
        super(message);
        this.name = 'ExternalRatingTypeError';
        this.field = field;
    }
}

export interface ExternalRatingSiteSnapshot {
    handle: string;
    rating: number | null;
    fetchedAt: Date | null;
    lastError: ExternalRatingErrorCode | null;
    publicShow: boolean;
}

export interface UserExternalRatingState {
    codeforces: ExternalRatingSiteSnapshot;
    nowcoder: ExternalRatingSiteSnapshot;
}

export interface ExternalRatingSiteClientWrite {
    handle: string;
    publicShow: boolean;
}

export interface UserExternalRatingClientWrite {
    codeforces: ExternalRatingSiteClientWrite;
    nowcoder: ExternalRatingSiteClientWrite;
}

export type ExternalRatingClientPatch = {
    [K in ExternalRatingSiteId]?: Partial<ExternalRatingSiteClientWrite>;
};

export interface ExternalRatingFetchSuccess {
    ok: true;
    site: ExternalRatingSiteId;
    handle: string;
    rating: number | null;
    fetchedAt: Date;
}

export interface ExternalRatingFetchFailure {
    ok: false;
    site: ExternalRatingSiteId;
    handle: string;
    error: ExternalRatingErrorCode;
}

export type ExternalRatingFetchResult = ExternalRatingFetchSuccess | ExternalRatingFetchFailure;

export interface ExternalRatingSitePrivilegedView {
    handle: string;
    rating: number | null;
    fetchedAt: string | null;
    lastError: ExternalRatingErrorCode | null;
    publicShow: boolean;
}

export interface ExternalRatingSitePublicView {
    handle: string;
    rating: number | null;
    fetchedAt: string | null;
}

export interface ExternalRatingRankingCell {
    handle: string;
    rating: number | null;
}

export interface UserExternalRatingPrivilegedView {
    codeforces: ExternalRatingSitePrivilegedView;
    nowcoder: ExternalRatingSitePrivilegedView;
}

export interface UserExternalRatingPublicView {
    codeforces: ExternalRatingSitePublicView | null;
    nowcoder: ExternalRatingSitePublicView | null;
}

export interface UserExternalRatingRankingView {
    codeforces: ExternalRatingRankingCell | null;
    nowcoder: ExternalRatingRankingCell | null;
}

export function emptyExternalRatingSiteSnapshot(): ExternalRatingSiteSnapshot {
    return {
        handle: EXTERNAL_RATING_UNSET_HANDLE,
        rating: null,
        fetchedAt: null,
        lastError: null,
        publicShow: EXTERNAL_RATING_PUBLIC_SHOW_DEFAULT,
    };
}

export function emptyUserExternalRatingState(): UserExternalRatingState {
    return {
        codeforces: emptyExternalRatingSiteSnapshot(),
        nowcoder: emptyExternalRatingSiteSnapshot(),
    };
}

export function isExternalRatingSiteId(value: unknown): value is ExternalRatingSiteId {
    return value === 'codeforces' || value === 'nowcoder';
}

export function isExternalRatingErrorCode(value: unknown): value is ExternalRatingErrorCode {
    if (typeof value !== 'string') return false;
    for (const code of EXTERNAL_RATING_ERROR_CODES) {
        if (code === value) return true;
    }
    return false;
}

export function isHandleUnset(handle: string): boolean {
    return handle.trim() === EXTERNAL_RATING_UNSET_HANDLE;
}

export function isPrivilegedExternalRatingViewer(role: ExternalRatingViewerRole): boolean {
    return role === 'owner' || role === 'teacher' || role === 'admin';
}

export function canMutateExternalRatingHandle(role: ExternalRatingViewerRole): boolean {
    return isPrivilegedExternalRatingViewer(role);
}

export function canSeeExternalRatingSite(
    snapshot: Pick<ExternalRatingSiteSnapshot, 'handle' | 'publicShow'>,
    role: ExternalRatingViewerRole,
): boolean {
    if (isHandleUnset(snapshot.handle)) return false;
    if (isPrivilegedExternalRatingViewer(role)) return true;
    return snapshot.publicShow === true;
}

export function sameExternalRatingHandle(site: ExternalRatingSiteId, left: string, right: string): boolean {
    const a = left.trim();
    const b = right.trim();
    if (site === 'codeforces') return a.toLowerCase() === b.toLowerCase();
    return a === b;
}

export function normalizeExternalRatingHandle(value: unknown, field: string): string {
    if (typeof value !== 'string') fail(field, `${field} must be a string`);
    return value.trim();
}

export function withSiteSnapshot(
    state: UserExternalRatingState,
    site: ExternalRatingSiteId,
    snapshot: ExternalRatingSiteSnapshot,
): UserExternalRatingState {
    if (site === 'codeforces') return { codeforces: snapshot, nowcoder: state.nowcoder };
    return { codeforces: state.codeforces, nowcoder: snapshot };
}

export function snapshotAfterHandleChange(
    previous: ExternalRatingSiteSnapshot,
    site: ExternalRatingSiteId,
    nextHandle: string,
): ExternalRatingSiteSnapshot {
    const handle = nextHandle.trim();
    if (isHandleUnset(handle)) return emptyExternalRatingSiteSnapshot();
    if (sameExternalRatingHandle(site, previous.handle, handle)) {
        return { ...previous, handle };
    }
    return {
        handle,
        rating: null,
        fetchedAt: null,
        lastError: null,
        publicShow: previous.publicShow === true,
    };
}

export function snapshotAfterFetchSuccess(
    snapshot: ExternalRatingSiteSnapshot,
    rating: number | null,
    fetchedAt: Date,
): ExternalRatingSiteSnapshot {
    if (isHandleUnset(snapshot.handle)) fail('handle', 'cannot store a fetch result on an unset handle');
    assertRating(rating, 'rating');
    assertTimestamp(fetchedAt, 'fetchedAt');
    return {
        ...snapshot,
        rating,
        fetchedAt,
        lastError: null,
    };
}

export function snapshotAfterFetchFailure(
    snapshot: ExternalRatingSiteSnapshot,
    error: ExternalRatingErrorCode,
): ExternalRatingSiteSnapshot {
    if (isHandleUnset(snapshot.handle)) fail('handle', 'cannot store a fetch error on an unset handle');
    if (!isExternalRatingErrorCode(error)) fail('lastError', 'unknown external rating error code');
    return {
        ...snapshot,
        lastError: error,
    };
}

export function applyFetchResult(snapshot: ExternalRatingSiteSnapshot, result: ExternalRatingFetchResult): ExternalRatingSiteSnapshot {
    if (!sameExternalRatingHandle(result.site, snapshot.handle, result.handle)) {
        fail('handle', 'fetch result handle does not match snapshot handle');
    }
    if (result.ok) return snapshotAfterFetchSuccess(snapshot, result.rating, result.fetchedAt);
    return snapshotAfterFetchFailure(snapshot, result.error);
}

export function parseUserExternalRatingState(value: unknown): UserExternalRatingState {
    if (value == null) return emptyUserExternalRatingState();
    const record = asPlainObject(value, USER_EXTERNAL_RATING_KEY);
    assertNoHydroRpFields(record, USER_EXTERNAL_RATING_KEY);
    assertAllowedKeys(record, EXTERNAL_RATING_SITES, USER_EXTERNAL_RATING_KEY);
    assertRequiredKeys(record, EXTERNAL_RATING_SITES, USER_EXTERNAL_RATING_KEY);
    return {
        codeforces: parseExternalRatingSiteSnapshot(record.codeforces, 'codeforces'),
        nowcoder: parseExternalRatingSiteSnapshot(record.nowcoder, 'nowcoder'),
    };
}

export function parseExternalRatingSiteSnapshot(value: unknown, field: string): ExternalRatingSiteSnapshot {
    const record = asPlainObject(value, field);
    assertNoHydroRpFields(record, field);
    assertAllowedKeys(record, EXTERNAL_RATING_SITE_SNAPSHOT_KEYS, field);
    assertRequiredKeys(record, ['handle', 'rating', 'fetchedAt', 'lastError'], field);
    const snapshot: ExternalRatingSiteSnapshot = {
        handle: normalizeExternalRatingHandle(record.handle, `${field}.handle`),
        rating: parseRating(record.rating, `${field}.rating`),
        fetchedAt: parseTimestamp(record.fetchedAt, `${field}.fetchedAt`),
        lastError: parseLastError(record.lastError, `${field}.lastError`),
        publicShow: parseExternalRatingPublicShow(record.publicShow, `${field}.publicShow`),
    };
    assertExternalRatingSiteSnapshot(snapshot, field);
    return snapshot;
}

export function assertExternalRatingSiteSnapshot(snapshot: ExternalRatingSiteSnapshot, field: string): void {
    if (snapshot.handle !== snapshot.handle.trim()) fail(`${field}.handle`, 'handle must be trimmed');
    if (isHandleUnset(snapshot.handle)) {
        if (snapshot.rating !== null) fail(`${field}.rating`, 'unset handle cannot keep a rating');
        if (snapshot.fetchedAt !== null) fail(`${field}.fetchedAt`, 'unset handle cannot keep a fetch time');
        if (snapshot.lastError !== null) fail(`${field}.lastError`, 'unset handle cannot keep a fetch error');
        if (snapshot.publicShow !== false) fail(`${field}.publicShow`, 'unset handle cannot be public');
        return;
    }
    assertRating(snapshot.rating, `${field}.rating`);
    if (snapshot.fetchedAt !== null) assertTimestamp(snapshot.fetchedAt, `${field}.fetchedAt`);
    if (snapshot.rating !== null && snapshot.fetchedAt === null) {
        fail(`${field}.fetchedAt`, 'rating requires a successful fetch time');
    }
    if (snapshot.lastError !== null && !isExternalRatingErrorCode(snapshot.lastError)) {
        fail(`${field}.lastError`, 'unknown external rating error code');
    }
    if (typeof snapshot.publicShow !== 'boolean') fail(`${field}.publicShow`, 'publicShow must be boolean');
}

export function assertNoClientSnapshotWrite(input: unknown, field: string): void {
    const record = asPlainObject(input, field);
    assertNoHydroRpFields(record, field);
    for (const key of EXTERNAL_RATING_SERVER_OWNED_KEYS) {
        if (Object.prototype.hasOwnProperty.call(record, key)) {
            fail(`${field}.${key}`, `${key} is server-owned and is not client-writable`);
        }
    }
    for (const site of EXTERNAL_RATING_SITES) {
        if (!Object.prototype.hasOwnProperty.call(record, site) || record[site] == null) continue;
        assertNoClientSnapshotWrite(record[site], `${field}.${site}`);
    }
}

export function parseExternalRatingPublicShow(value: unknown, field: string): boolean {
    if (value === undefined) return EXTERNAL_RATING_PUBLIC_SHOW_DEFAULT;
    if (typeof value !== 'boolean') fail(field, 'publicShow must be boolean');
    return value;
}

function fail(field: string, message: string): never {
    throw new ExternalRatingTypeError(field, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (value instanceof Date) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function asPlainObject(value: unknown, field: string): Record<string, unknown> {
    if (!isPlainObject(value)) fail(field, `${field} must be an object`);
    return value;
}

function assertAllowedKeys(record: Record<string, unknown>, allowed: readonly string[], field: string): void {
    const allowedSet = new Set<string>(allowed);
    for (const key of Object.keys(record)) {
        if (!allowedSet.has(key)) fail(`${field}.${key}`, `unknown field ${key}`);
    }
}

function assertRequiredKeys(record: Record<string, unknown>, required: readonly string[], field: string): void {
    for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) fail(`${field}.${key}`, `${key} is required`);
    }
}

function assertNoHydroRpFields(record: Record<string, unknown>, field: string): void {
    for (const key of HYDRO_RP_FIELD_KEYS) {
        if (Object.prototype.hasOwnProperty.call(record, key)) {
            fail(`${field}.${key}`, 'Hydro RP fields are not part of external rating');
        }
    }
}

function parseRating(value: unknown, field: string): number | null {
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(field, 'rating must be an integer or null');
    if (value < EXTERNAL_RATING_MIN || value > EXTERNAL_RATING_MAX) fail(field, 'rating is out of range');
    return value;
}

function assertRating(value: number | null, field: string): void {
    if (value === null) return;
    if (!Number.isSafeInteger(value) || value < EXTERNAL_RATING_MIN || value > EXTERNAL_RATING_MAX) {
        fail(field, 'rating must be an integer or null');
    }
}

function parseTimestamp(value: unknown, field: string): Date | null {
    if (value === null) return null;
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) fail(field, 'fetchedAt must be a Date or null');
    return value;
}

function assertTimestamp(value: Date, field: string): void {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) fail(field, 'fetchedAt must be a Date');
}

function parseLastError(value: unknown, field: string): ExternalRatingErrorCode | null {
    if (value === null) return null;
    if (!isExternalRatingErrorCode(value)) fail(field, 'lastError must be a known error code or null');
    return value;
}
