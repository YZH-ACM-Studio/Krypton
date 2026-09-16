/**
 * Request-path CF / Nowcoder handle and public-flag validation.
 * Clients may send handles and public flags only; snapshot score fields are server-owned.
 */
import {
    CODEFORCES_HANDLE_MAX_LENGTH,
    CODEFORCES_HANDLE_MIN_LENGTH,
    CODEFORCES_HANDLE_PATTERN,
    EXTERNAL_RATING_CLIENT_HANDLE_KEY,
    EXTERNAL_RATING_PUBLIC_SHOW_DEFAULT,
    EXTERNAL_RATING_SERVER_OWNED_KEYS,
    EXTERNAL_RATING_UNSET_HANDLE,
    ExternalRatingTypeError,
    NOWCODER_USERNAME_MAX_LENGTH,
    NOWCODER_USERNAME_MIN_LENGTH,
    type ExternalRatingServerOwnedKey,
} from './types';

export class ExternalRatingSnapshotFieldError extends ExternalRatingTypeError {
    constructor(field: ExternalRatingServerOwnedKey) {
        super(field, `客户端不能设置外站快照字段 ${field}`);
        this.name = 'ExternalRatingSnapshotFieldError';
    }
}

// eslint-disable-next-line no-control-regex
const CONTROL_OR_WHITESPACE = /[\s\x00-\x1F\x7F]/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1F\x7F]/;

function reject(field: string, message: string): never {
    if (typeof ExternalRatingTypeError !== 'function') throw new Error(message);
    throw new ExternalRatingTypeError(field, message);
}

function isUnsetRaw(raw: unknown): boolean {
    return raw === undefined || raw === null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (value instanceof Date) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isServerOwnedKey(key: string): key is ExternalRatingServerOwnedKey {
    return (EXTERNAL_RATING_SERVER_OWNED_KEYS as readonly string[]).includes(key);
}

function rejectSnapshotField(field: ExternalRatingServerOwnedKey): never {
    if (typeof ExternalRatingSnapshotFieldError !== 'function') {
        throw new TypeError(`客户端不能设置外站快照字段 ${field}`);
    }
    throw new ExternalRatingSnapshotFieldError(field);
}

function assertNoServerOwnedKeys(value: unknown): void {
    if (Array.isArray(value)) {
        for (const item of value) assertNoServerOwnedKeys(item);
        return;
    }
    if (!isPlainObject(value)) return;
    for (const key of Object.keys(value)) {
        if (isServerOwnedKey(key)) rejectSnapshotField(key);
    }
    for (const nested of Object.values(value)) assertNoServerOwnedKeys(nested);
}

export function normalizeCfHandle(raw: unknown): string {
    if (isUnsetRaw(raw)) return EXTERNAL_RATING_UNSET_HANDLE;
    if (typeof raw !== 'string') {
        reject(EXTERNAL_RATING_CLIENT_HANDLE_KEY.codeforces, 'Codeforces handle 不合法');
    }
    const handle = raw.trim();
    if (!handle) return EXTERNAL_RATING_UNSET_HANDLE;
    if (CONTROL_OR_WHITESPACE.test(handle)) {
        reject(EXTERNAL_RATING_CLIENT_HANDLE_KEY.codeforces, 'Codeforces handle 含有空白或控制字符');
    }
    if (
        handle.length < CODEFORCES_HANDLE_MIN_LENGTH
        || handle.length > CODEFORCES_HANDLE_MAX_LENGTH
        || !CODEFORCES_HANDLE_PATTERN.test(handle)
    ) {
        reject(EXTERNAL_RATING_CLIENT_HANDLE_KEY.codeforces, 'Codeforces handle 格式不合法');
    }
    return handle;
}

export function normalizeNowcoderName(raw: unknown): string {
    if (isUnsetRaw(raw)) return EXTERNAL_RATING_UNSET_HANDLE;
    if (typeof raw !== 'string') {
        reject(EXTERNAL_RATING_CLIENT_HANDLE_KEY.nowcoder, '牛客用户名不合法');
    }
    const name = raw.trim();
    if (!name) return EXTERNAL_RATING_UNSET_HANDLE;
    if (
        CONTROL_CHARS.test(name)
        || name.length < NOWCODER_USERNAME_MIN_LENGTH
        || name.length > NOWCODER_USERNAME_MAX_LENGTH
    ) {
        reject(EXTERNAL_RATING_CLIENT_HANDLE_KEY.nowcoder, '牛客用户名不合法');
    }
    return name;
}

/** Missing/undefined/null is hidden (G7). Only boolean true is public. */
export function parsePublicFlag(raw: unknown): boolean {
    if (isUnsetRaw(raw)) return EXTERNAL_RATING_PUBLIC_SHOW_DEFAULT;
    if (raw === true) return true;
    if (raw === false) return false;
    reject('publicShow', '公开开关不合法');
}

export function assertClientMayNotSetSnapshotFields(body: unknown): void {
    if (isUnsetRaw(body)) return;
    if (!isPlainObject(body)) reject('body', '外站 rating 请求不合法');
    assertNoServerOwnedKeys(body);
}
