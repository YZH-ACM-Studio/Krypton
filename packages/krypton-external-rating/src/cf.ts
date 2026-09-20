/**
 * Official Codeforces user.info / user.rating client.
 *
 * One encoded handle per request. Timeout, non-OK, missing user, and
 * malformed payloads fail closed. Unrated user.info succeeds with rating
 * null. Unrated user.rating succeeds with an empty history. Never retries
 * and never substitutes another handle.
 * user.info query is `handles`; user.rating query is singular `handle`.
 */

export const CODEFORCES_USER_INFO_URL = 'https://codeforces.com/api/user.info';
export const CODEFORCES_USER_RATING_URL = 'https://codeforces.com/api/user.rating';
export const CODEFORCES_USER_INFO_TIMEOUT_MS = 8000;

export interface CodeforcesRatingHistoryEntry {
    ratedAt: Date;
    rating: number;
    contestKey: string;
    oldRating: number;
    rank: number;
    contestName: string;
}

export type CodeforcesFetchFailureKind = 'not_found' | 'network' | 'malformed';

export class CodeforcesFetchError extends Error {
    readonly kind: CodeforcesFetchFailureKind;
    readonly handle: string;

    constructor(kind: CodeforcesFetchFailureKind, handle: string, message: string, options?: ErrorOptions) {
        super(message, options);
        this.kind = kind;
        this.handle = handle;
        this.name = codeforcesErrorName(kind);
    }
}

export class CodeforcesUserNotFoundError extends CodeforcesFetchError {
    constructor(handle: string, message?: string, options?: ErrorOptions) {
        super('not_found', handle, message ?? `Codeforces user not found: ${handle}`, options);
    }
}

export class CodeforcesNetworkError extends CodeforcesFetchError {
    constructor(handle: string, message: string, options?: ErrorOptions) {
        super('network', handle, message, options);
    }
}

export class CodeforcesMalformedError extends CodeforcesFetchError {
    constructor(handle: string, message: string, options?: ErrorOptions) {
        super('malformed', handle, message, options);
    }
}

function codeforcesErrorName(kind: CodeforcesFetchFailureKind): string {
    if (kind === 'not_found') return 'CodeforcesUserNotFoundError';
    if (kind === 'network') return 'CodeforcesNetworkError';
    return 'CodeforcesMalformedError';
}

function logStage(level: 'info' | 'error', stage: string, handle: string, detail?: string): void {
    const line = detail
        ? `krypton-external-rating.cf stage=${stage} handle=${handle} ${detail}`
        : `krypton-external-rating.cf stage=${stage} handle=${handle}`;
    if (level === 'error') console.error(line);
    else console.info(line);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function sameCodeforcesHandle(left: string, right: string): boolean {
    return left.toLowerCase() === right.toLowerCase();
}

function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    return 'unknown network error';
}

function throwNotFound(handle: string, message?: string): never {
    const error = new CodeforcesUserNotFoundError(handle, message);
    logStage('error', 'not_found', handle, error.message);
    throw error;
}

function throwNetwork(handle: string, message: string, cause?: unknown): never {
    const error = new CodeforcesNetworkError(handle, message, cause === undefined ? undefined : { cause });
    logStage('error', 'network', handle, message);
    throw error;
}

function throwMalformed(handle: string, message: string, cause?: unknown): never {
    const error = new CodeforcesMalformedError(handle, message, cause === undefined ? undefined : { cause });
    logStage('error', 'malformed', handle, message);
    throw error;
}

function throwTimeout(handle: string, cause?: unknown): never {
    const message = `Codeforces request timed out after ${CODEFORCES_USER_INFO_TIMEOUT_MS}ms`;
    logStage('error', 'timeout', handle, `timeoutMs=${CODEFORCES_USER_INFO_TIMEOUT_MS}`);
    throw new CodeforcesNetworkError(handle, message, cause === undefined ? undefined : { cause });
}

function normalizeHandle(handle: string): string {
    if (typeof handle !== 'string') {
        throwMalformed('', 'Codeforces handle must be a string');
    }
    const normalized = handle.trim();
    if (!normalized) {
        throwMalformed(handle, 'Codeforces handle is empty');
    }
    // CF splits handles on ';' — sending one would query multiple users.
    if (normalized.includes(';')) {
        throwMalformed(normalized, 'Codeforces handle must not contain a semicolon');
    }
    return normalized;
}

async function fetchUserInfo(url: string, handle: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CODEFORCES_USER_INFO_TIMEOUT_MS);
    try {
        return await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'User-Agent': 'KryptonOJ/external-rating',
            },
            signal: controller.signal,
        });
    } catch (error: unknown) {
        if (controller.signal.aborted) throwTimeout(handle, error);
        throwNetwork(handle, `Codeforces request failed: ${errorMessage(error)}`, error);
    } finally {
        clearTimeout(timer);
    }
}

async function readCodeforcesJson(url: string, handle: string): Promise<unknown> {
    logStage('info', 'request', handle);
    const response = await fetchUserInfo(url, handle);
    logStage('info', 'http', handle, `status=${response.status}`);
    let payload: unknown;
    try {
        payload = await response.json();
    } catch (error: unknown) {
        if (response.status !== 200) {
            throwNetwork(handle, `Codeforces HTTP ${response.status}`, error);
        }
        throwMalformed(handle, 'Codeforces response is not valid JSON', error);
    }
    logStage('info', 'parse', handle);
    if (response.status !== 200) {
        if (isRecord(payload) && typeof payload.status === 'string' && payload.status !== 'OK') {
            throwFromNonOkStatus(payload, handle);
        }
        throwNetwork(handle, `Codeforces HTTP ${response.status}`);
    }
    return payload;
}

function classifyFailedComment(comment: string): CodeforcesFetchFailureKind {
    const lower = comment.toLowerCase();
    if (lower.includes('not found')) return 'not_found';
    if (lower.includes('limit exceeded') || lower.includes('too many')) return 'network';
    return 'malformed';
}

function throwFromNonOkStatus(payload: Record<string, unknown>, handle: string): never {
    const comment = typeof payload.comment === 'string' ? payload.comment : '';
    const kind = comment ? classifyFailedComment(comment) : 'malformed';
    const detail = comment ? `status=${String(payload.status)} comment=${comment}` : `status=${String(payload.status)}`;
    if (kind === 'not_found') throwNotFound(handle, comment || `Codeforces user not found: ${handle}`);
    if (kind === 'network') throwNetwork(handle, comment || 'Codeforces API rejected the request');
    throwMalformed(handle, comment || `Codeforces API status is not OK: ${detail}`);
}

function parseOkResultArray(payload: unknown, handle: string): unknown[] {
    if (!isRecord(payload)) {
        throwMalformed(handle, 'Codeforces response is not an object');
    }
    if (payload.status !== 'OK') {
        throwFromNonOkStatus(payload, handle);
    }
    if (!Array.isArray(payload.result)) {
        throwMalformed(handle, 'Codeforces result is missing or not an array');
    }
    return payload.result;
}

function parseUser(user: unknown, handle: string): { rating: number | null; rank?: string } {
    if (!isRecord(user)) {
        throwMalformed(handle, 'Codeforces user object is malformed');
    }
    let rating: number | null;
    if (user.rating === undefined || user.rating === null) {
        rating = null;
    } else if (typeof user.rating === 'number' && Number.isInteger(user.rating)) {
        rating = user.rating;
    } else {
        throwMalformed(handle, 'Codeforces rating is malformed');
    }
    if (user.rank === undefined || user.rank === null) {
        return { rating };
    }
    if (typeof user.rank !== 'string') {
        throwMalformed(handle, 'Codeforces rank is malformed');
    }
    if (!user.rank) return { rating };
    return { rating, rank: user.rank };
}

function parsePayload(payload: unknown, handle: string): { rating: number | null; rank?: string } {
    const result = parseOkResultArray(payload, handle);
    if (result.length === 0) {
        throwNotFound(handle);
    }
    if (result.length !== 1) {
        throwMalformed(handle, `Codeforces returned ${result.length} users for one handle`);
    }
    return parseUser(result[0], handle);
}

function parseRatingHistoryEntry(value: unknown, handle: string): CodeforcesRatingHistoryEntry {
    if (!isRecord(value)) {
        throwMalformed(handle, 'Codeforces rating history entry is malformed');
    }
    if (!isFiniteInteger(value.contestId)) {
        throwMalformed(handle, 'Codeforces contestId is malformed');
    }
    if (typeof value.contestName !== 'string' || !value.contestName) {
        throwMalformed(handle, 'Codeforces contestName is malformed');
    }
    if (!isFiniteInteger(value.rank)) {
        throwMalformed(handle, 'Codeforces rank is malformed');
    }
    if (!isFiniteInteger(value.ratingUpdateTimeSeconds)) {
        throwMalformed(handle, 'Codeforces ratingUpdateTimeSeconds is malformed');
    }
    if (!isFiniteInteger(value.oldRating)) {
        throwMalformed(handle, 'Codeforces oldRating is malformed');
    }
    if (!isFiniteInteger(value.newRating)) {
        throwMalformed(handle, 'Codeforces newRating is malformed');
    }
    if (value.handle !== undefined && value.handle !== null) {
        if (typeof value.handle !== 'string' || !sameCodeforcesHandle(value.handle, handle)) {
            throwMalformed(handle, 'Codeforces rating history handle does not match');
        }
    }
    const ratedAt = new Date(value.ratingUpdateTimeSeconds * 1000);
    if (Number.isNaN(ratedAt.getTime())) {
        throwMalformed(handle, 'Codeforces ratingUpdateTimeSeconds is malformed');
    }
    return {
        ratedAt,
        rating: value.newRating,
        contestKey: String(value.contestId),
        oldRating: value.oldRating,
        rank: value.rank,
        contestName: value.contestName,
    };
}

function parseRatingHistoryPayload(payload: unknown, handle: string): CodeforcesRatingHistoryEntry[] {
    const result = parseOkResultArray(payload, handle);
    const entries: CodeforcesRatingHistoryEntry[] = [];
    for (const item of result) {
        entries.push(parseRatingHistoryEntry(item, handle));
    }
    return entries;
}

export async function fetchCodeforcesRating(handle: string): Promise<{ rating: number | null; rank?: string }> {
    const normalized = normalizeHandle(handle);
    logStage('info', 'start', normalized);
    const url = `${CODEFORCES_USER_INFO_URL}?handles=${encodeURIComponent(normalized)}`;
    const payload = await readCodeforcesJson(url, normalized);
    const result = parsePayload(payload, normalized);
    logStage('info', 'success', normalized, result.rating === null ? 'rating=null' : `rating=${result.rating}`);
    return result;
}

export async function fetchCodeforcesRatingHistory(handle: string): Promise<CodeforcesRatingHistoryEntry[]> {
    const normalized = normalizeHandle(handle);
    logStage('info', 'start', normalized);
    const url = `${CODEFORCES_USER_RATING_URL}?handle=${encodeURIComponent(normalized)}`;
    const payload = await readCodeforcesJson(url, normalized);
    const result = parseRatingHistoryPayload(payload, normalized);
    logStage('info', 'success', normalized, `entries=${result.length}`);
    return result;
}
