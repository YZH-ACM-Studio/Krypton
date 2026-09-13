import type { ObjectId } from 'mongodb';

/**
 * Admin temporary dropbox. Independent of krypton-collect:
 * collection `admin.dropbox_files`, blob prefix `admin-dropbox/`.
 * Do not write `collect.*` or `collect/`.
 */
export const ADMIN_DROPBOX_COLLECTION = 'admin.dropbox_files';
export const ADMIN_DROPBOX_STORAGE_PREFIX = 'admin-dropbox/';

export const ADMIN_DROPBOX_REJECTED_EXTS = [
    'exe', 'dll', 'bat', 'cmd', 'ps1', 'sh', 'msi', 'apk', 'app',
    'html', 'htm', 'js', 'svg', 'docm', 'xlsm', 'pptm',
] as const;

export const ADMIN_DROPBOX_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ADMIN_DROPBOX_DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024 * 1024;
export const ADMIN_DROPBOX_HARD_MAX_FILE_BYTES = 10 * 1024 * 1024 * 1024;
export const ADMIN_DROPBOX_NOTE_MAX_LENGTH = 500;

const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface AdminDropboxFileDoc {
    _id: ObjectId;
    domainId: string;
    ownerUid: number;
    originalName: string;
    storagePath: string;
    size: number;
    sha256: string;
    createdAt: Date;
    expireAt: Date;
    note: string | null;
}

export function normalizeExt(filename: string): string {
    const base = filename.trim().toLowerCase();
    const dot = base.lastIndexOf('.');
    if (dot < 0 || dot === base.length - 1) return '';
    const ext = base.slice(dot + 1);
    return ext === 'jpeg' ? 'jpg' : ext;
}

export function isRejectedExt(ext: string): boolean {
    return (ADMIN_DROPBOX_REJECTED_EXTS as readonly string[]).includes(ext);
}

export function isRejectedFilename(filename: string): boolean {
    const ext = normalizeExt(filename);
    return ext !== '' && isRejectedExt(ext);
}

export function isSha256Hex(value: string): boolean {
    return SHA256_HEX.test(value);
}

export function isValidMaxFileBytes(value: number): boolean {
    return Number.isInteger(value) && value > 0 && value <= ADMIN_DROPBOX_HARD_MAX_FILE_BYTES;
}

export function isValidFileSize(size: number, maxFileBytes: number): boolean {
    return isValidMaxFileBytes(maxFileBytes)
        && Number.isInteger(size)
        && size > 0
        && size <= maxFileBytes;
}

export function isValidTtlMs(value: number): boolean {
    return Number.isInteger(value) && value > 0;
}

export function isValidNote(note: string | null): boolean {
    if (note === null) return true;
    if (typeof note !== 'string') return false;
    return note.length <= ADMIN_DROPBOX_NOTE_MAX_LENGTH;
}

export function defaultExpireAt(now: Date = new Date()): Date {
    return expireAtFromTtlMs(ADMIN_DROPBOX_DEFAULT_TTL_MS, now);
}

export function expireAtFromTtlMs(ttlMs: number, now: Date = new Date()): Date {
    return new Date(now.getTime() + ttlMs);
}

export function isExpired(doc: Pick<AdminDropboxFileDoc, 'expireAt'>, now: Date = new Date()): boolean {
    return doc.expireAt.getTime() <= now.getTime();
}

function isSafePathSegment(value: string): boolean {
    if (!value) return false;
    if (value === '.' || value === '..') return false;
    if (value.includes('/') || value.includes('\\') || value.includes('\0')) return false;
    if (value.includes('..')) return false;
    return true;
}

export function dropboxStoragePath(domainId: string, fileId: string): string {
    if (!isSafePathSegment(domainId) || !isSafePathSegment(fileId)) {
        throw new Error('admin dropbox storage path segments must be exact and stay under admin-dropbox/');
    }
    return `${ADMIN_DROPBOX_STORAGE_PREFIX}${domainId}/${fileId}`;
}

export function isAdminDropboxStoragePath(path: string): boolean {
    if (path.startsWith('collect/')) return false;
    if (!path.startsWith(ADMIN_DROPBOX_STORAGE_PREFIX)) return false;
    if (path.includes('..') || path.includes('\\') || path.includes('\0')) return false;
    const rest = path.slice(ADMIN_DROPBOX_STORAGE_PREFIX.length);
    const parts = rest.split('/');
    return parts.length === 2 && isSafePathSegment(parts[0]) && isSafePathSegment(parts[1]);
}

declare module 'hydrooj' {
    interface Collections {
        'admin.dropbox_files': AdminDropboxFileDoc;
    }
}
