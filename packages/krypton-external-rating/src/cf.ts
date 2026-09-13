/**
 * Official Codeforces user.info client.
 *
 * One encoded handle per request. Timeout, non-OK, missing user, and
 * malformed payloads fail closed. Unrated users succeed with rating null.
 * Never retries and never substitutes another handle.
 */

export const CODEFORCES_USER_INFO_URL = 'https://codeforces.com/api/user.info';
export const CODEFORCES_USER_INFO_TIMEOUT_MS = 8000;

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

function classifyFailedComment(comment: string): CodeforcesFetchFailureKind {
    const lower = comment.toLowerCase();
    if (lower.includes('not found')) return 'not_found';
    if (lower.includes('limit exceeded') || lower.includes('too many')) return 'network';
    return 'malformed';
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
    if (!isRecord(payload)) {
        throwMalformed(handle, 'Codeforces response is not an object');
    }
    if (payload.status !== 'OK') {
        const comment = typeof payload.comment === 'string' ? payload.comment : '';
        const kind = comment ? classifyFailedComment(comment) : 'malformed';
        const detail = comment ? `status=${String(payload.status)} comment=${comment}` : `status=${String(payload.status)}`;
        if (kind === 'not_found') throwNotFound(handle, comment || `Codeforces user not found: ${handle}`);
        if (kind === 'network') throwNetwork(handle, comment || 'Codeforces API rejected the request');
        throwMalformed(handle, comment || `Codeforces API status is not OK: ${detail}`);
    }
    if (!Array.isArray(payload.result)) {
        throwMalformed(handle, 'Codeforces result is missing or not an array');
    }
    if (payload.result.length === 0) {
        throwNotFound(handle);
    }
    if (payload.result.length !== 1) {
        throwMalformed(handle, `Codeforces returned ${payload.result.length} users for one handle`);
    }
    return parseUser(payload.result[0], handle);
}

export async function fetchCodeforcesRating(handle: string): Promise<{ rating: number | null; rank?: string }> {
    const normalized = normalizeHandle(handle);
    logStage('info', 'start', normalized);
    const url = `${CODEFORCES_USER_INFO_URL}?handles=${encodeURIComponent(normalized)}`;
    logStage('info', 'request', normalized);
    const response = await fetchUserInfo(url, normalized);
    logStage('info', 'http', normalized, `status=${response.status}`);
    let payload: unknown;
    try {
        payload = await response.json();
    } catch (error: unknown) {
        if (response.status !== 200) {
            throwNetwork(normalized, `Codeforces HTTP ${response.status}`, error);
        }
        throwMalformed(normalized, 'Codeforces response is not valid JSON', error);
    }
    logStage('info', 'parse', normalized);
    if (response.status !== 200) {
        if (isRecord(payload) && typeof payload.status === 'string' && payload.status !== 'OK') {
            parsePayload(payload, normalized);
        }
        throwNetwork(normalized, `Codeforces HTTP ${response.status}`);
    }
    const result = parsePayload(payload, normalized);
    logStage('info', 'success', normalized, result.rating === null ? 'rating=null' : `rating=${result.rating}`);
    return result;
}
