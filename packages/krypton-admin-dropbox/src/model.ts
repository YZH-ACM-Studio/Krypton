/**
 * Canonical write path for the admin temporary dropbox.
 *
 * Blob prefix is `admin-dropbox/{domain}/{id}`. Never `collect/` or testdata.
 * Expired rows delete blob then metadata together; leftover of either is an error.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Logger } from '@hydrooj/utils';
import { ObjectId, PRIV, StorageModel, SystemModel, UserModel } from 'hydrooj';
import { canUseAdminDropbox } from './auth';
import { dropboxFilesColl } from './db';
import {
    AdminDropboxExpiredError,
    AdminDropboxFileRejectedError,
    AdminDropboxForbiddenError,
    AdminDropboxNotFoundError,
} from './errors';
import {
    ADMIN_DROPBOX_DEFAULT_MAX_FILE_BYTES,
    ADMIN_DROPBOX_HARD_MAX_FILE_BYTES,
    defaultExpireAt,
    dropboxStoragePath,
    isAdminDropboxStoragePath,
    isExpired,
    isRejectedExt,
    isSha256Hex,
    isValidFileSize,
    isValidMaxFileBytes,
    isValidNote,
    normalizeExt,
    type AdminDropboxFileDoc,
} from './types';

const logger = new Logger('admin-dropbox.model');
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const HEADER_LEN = 512;
export const ADMIN_DROPBOX_MAX_FILE_BYTES_SETTING = 'admin-dropbox.maxFileBytes';

const PDF_MAGIC = Uint8Array.of(0x25, 0x50, 0x44, 0x46);
const PNG_MAGIC = Uint8Array.of(0x89, 0x50, 0x4e, 0x47);
const JPG_MAGIC = Uint8Array.of(0xff, 0xd8);
const GZIP_MAGIC = Uint8Array.of(0x1f, 0x8b);
const SEVEN_Z_MAGIC = Uint8Array.of(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c);
const XZ_MAGIC = Uint8Array.of(0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00);
const BZ2_MAGIC = Uint8Array.of(0x42, 0x5a, 0x68);
const ZIP_MAGICS = [
    Uint8Array.of(0x50, 0x4b, 0x03, 0x04),
    Uint8Array.of(0x50, 0x4b, 0x05, 0x06),
    Uint8Array.of(0x50, 0x4b, 0x07, 0x08),
];
const MZ_MAGIC = Uint8Array.of(0x4d, 0x5a);
const ELF_MAGIC = Uint8Array.of(0x7f, 0x45, 0x4c, 0x46);
const SHEBANG_MAGIC = Uint8Array.of(0x23, 0x21);
const WASM_MAGIC = Uint8Array.of(0x00, 0x61, 0x73, 0x6d);
const CAFEBABE_MAGIC = Uint8Array.of(0xca, 0xfe, 0xba, 0xbe);
const MACHO_MAGICS = [
    Uint8Array.of(0xfe, 0xed, 0xfa, 0xce),
    Uint8Array.of(0xfe, 0xed, 0xfa, 0xcf),
    Uint8Array.of(0xce, 0xfa, 0xed, 0xfe),
    Uint8Array.of(0xcf, 0xfa, 0xed, 0xfe),
];
const RAR_MAGIC = Uint8Array.of(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07);
const USTAR = Uint8Array.of(0x75, 0x73, 0x74, 0x61, 0x72);

const tails = new Map<string, Promise<unknown>>();

export interface AdminDropboxActor {
    _id: number;
    domainId: string;
    hasPriv(priv: number): boolean;
}

export type AdminDropboxFileInput =
    | Buffer
    | Uint8Array
    | Readable
    | {
        bytes?: Buffer | Uint8Array;
        stream?: Readable;
        tempPath?: string;
        filepath?: string;
        size?: number;
    };

export interface AdminDropboxDownload {
    url: string;
    file: AdminDropboxFileDoc;
}

export interface PutAdminDropboxFileInput {
    domainId: string;
    ownerUid: number;
    originalName: string;
    size: number;
    tempPath?: string;
    filepath?: string;
    bytes?: Buffer | Uint8Array;
    stream?: Readable;
    expireAt: Date | 'default';
    note?: string | null;
}

interface InspectedUpload {
    header: Uint8Array<ArrayBufferLike>;
    sha256: string;
    size: number;
    body: Buffer | string;
    ownedTempPath: string | null;
}

function rejectFile(message: string): never {
    throw new AdminDropboxFileRejectedError(message);
}

function logStage(stage: string, actor: number, id?: ObjectId | string, size?: number): void {
    logger.info(
        'id=%s size=%s actor=%s stage=%s',
        id == null ? '-' : String(id),
        size ?? '-',
        actor,
        stage,
    );
}

function logStageError(stage: string, actor: number, id?: ObjectId | string, size?: number): void {
    logger.error(
        'id=%s size=%s actor=%s stage=%s',
        id == null ? '-' : String(id),
        size ?? '-',
        actor,
        stage,
    );
}

async function withDropboxLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) || Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const next = previous.then(() => gate, () => gate);
    tails.set(key, next);
    await previous.catch(() => undefined);
    try {
        return await fn();
    } finally {
        release();
        if (tails.get(key) === next) tails.delete(key);
    }
}

function dropboxFileLockKey(domainId: string, fileId: string): string {
    return `admin-dropbox:${domainId}:${fileId}`;
}

function assertDomainId(domainId: string): void {
    if (typeof domainId !== 'string' || !domainId) {
        throw new TypeError('domainId must be a non-empty string');
    }
}

function assertActor(actor: AdminDropboxActor): void {
    if (!actor || typeof actor.hasPriv !== 'function') {
        throw new TypeError('admin dropbox actor is missing hasPriv');
    }
    if (!Number.isSafeInteger(actor._id) || actor._id < 2) {
        throw new AdminDropboxForbiddenError();
    }
    assertDomainId(actor.domainId);
    if (!actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || !canUseAdminDropbox(actor)) {
        throw new AdminDropboxForbiddenError();
    }
}

async function actorFromUid(domainId: string, uid: number): Promise<AdminDropboxActor> {
    assertDomainId(domainId);
    if (!Number.isSafeInteger(uid) || uid < 2) throw new AdminDropboxForbiddenError();
    if (!UserModel || typeof UserModel.getById !== 'function') {
        throw new TypeError('UserModel.getById is unavailable');
    }
    const loaded = await UserModel.getById(domainId, uid);
    if (!loaded || typeof loaded !== 'object') throw new AdminDropboxForbiddenError();
    const rec = loaded as { hasPriv?: unknown };
    if (typeof rec.hasPriv !== 'function') {
        throw new TypeError(`UserModel.getById(${uid}) returned a user without privilege methods`);
    }
    const actor: AdminDropboxActor = {
        _id: uid,
        domainId,
        hasPriv: rec.hasPriv as AdminDropboxActor['hasPriv'],
    };
    assertActor(actor);
    return actor;
}

function parseFileId(id: ObjectId | string): ObjectId {
    if (id instanceof ObjectId) return id;
    if (typeof id === 'string' && OBJECT_ID_RE.test(id)) return new ObjectId(id);
    throw new AdminDropboxNotFoundError();
}

function resolveExpireAt(expireAt: Date | 'default', now: Date): Date {
    if (expireAt === 'default') return defaultExpireAt(now);
    if (!(expireAt instanceof Date) || Number.isNaN(expireAt.getTime())) rejectFile('过期时间不合法');
    if (expireAt.getTime() <= now.getTime()) rejectFile('过期时间必须晚于当前时间');
    return expireAt;
}

function configuredMaxFileBytes(): number {
    if (!SystemModel || typeof SystemModel.get !== 'function') {
        throw new TypeError('SystemModel.get is unavailable');
    }
    const raw = SystemModel.get(ADMIN_DROPBOX_MAX_FILE_BYTES_SETTING);
    if (raw == null || raw === '') return ADMIN_DROPBOX_DEFAULT_MAX_FILE_BYTES;
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' && /^-?\d+$/.test(raw) ? Number(raw) : Number.NaN;
    if (!isValidMaxFileBytes(value)) {
        throw new TypeError('admin-dropbox.maxFileBytes is invalid');
    }
    return value;
}

function displayName(originalName: string): string {
    if (typeof originalName !== 'string') rejectFile('文件名无效');
    const trimmed = originalName.trim();
    const base = trimmed.replace(/\\/g, '/').split('/').pop() || '';
    if (!base || base === '.' || base === '..' || base.includes('\0')) rejectFile('文件名无效');
    return base;
}

function headerStartsWith(header: ArrayLike<number>, magic: Uint8Array): boolean {
    if (header.length < magic.length) return false;
    for (let i = 0; i < magic.length; i += 1) {
        if (header[i] !== magic[i]) return false;
    }
    return true;
}

function headerEqualsAt(header: ArrayLike<number>, offset: number, magic: Uint8Array): boolean {
    if (header.length < offset + magic.length) return false;
    for (let i = 0; i < magic.length; i += 1) {
        if (header[offset + i] !== magic[i]) return false;
    }
    return true;
}

function isZipMagic(header: ArrayLike<number>): boolean {
    return ZIP_MAGICS.some((magic) => headerStartsWith(header, magic));
}

function isTarMagic(header: ArrayLike<number>): boolean {
    return headerEqualsAt(header, 257, USTAR);
}

function isRarMagic(header: ArrayLike<number>): boolean {
    return headerStartsWith(header, RAR_MAGIC);
}

function isDangerousMagic(header: ArrayLike<number>): boolean {
    if (headerStartsWith(header, MZ_MAGIC)) return true;
    if (headerStartsWith(header, ELF_MAGIC)) return true;
    if (headerStartsWith(header, SHEBANG_MAGIC)) return true;
    if (headerStartsWith(header, WASM_MAGIC)) return true;
    if (headerStartsWith(header, CAFEBABE_MAGIC)) return true;
    return MACHO_MAGICS.some((magic) => headerStartsWith(header, magic));
}

function claimedExtMagicMatches(header: ArrayLike<number>, ext: string): boolean {
    if (ext === 'pdf') return headerStartsWith(header, PDF_MAGIC);
    if (ext === 'png') return headerStartsWith(header, PNG_MAGIC);
    if (ext === 'jpg') return headerStartsWith(header, JPG_MAGIC);
    if (ext === 'zip' || ext === 'docx' || ext === 'xlsx' || ext === 'pptx') return isZipMagic(header);
    if (ext === 'gz' || ext === 'tgz') return headerStartsWith(header, GZIP_MAGIC);
    if (ext === '7z') return headerStartsWith(header, SEVEN_Z_MAGIC);
    if (ext === 'xz') return headerStartsWith(header, XZ_MAGIC);
    if (ext === 'bz2') return headerStartsWith(header, BZ2_MAGIC);
    if (ext === 'rar') return isRarMagic(header);
    if (ext === 'tar') return isTarMagic(header);
    return true;
}

function hasKnownExtMagic(ext: string): boolean {
    return [
        'pdf', 'png', 'jpg', 'zip', 'docx', 'xlsx', 'pptx',
        'gz', 'tgz', '7z', 'xz', 'bz2', 'rar', 'tar',
    ].includes(ext);
}

function assertUploadAllowed(filename: string, size: number, maxFileBytes: number, header: ArrayLike<number>): string {
    const originalName = displayName(filename);
    const ext = normalizeExt(originalName);
    if (ext && isRejectedExt(ext)) rejectFile('不允许的文件类型');
    if (!isValidFileSize(size, maxFileBytes)) {
        if (!Number.isInteger(size) || size <= 0) rejectFile('空文件');
        rejectFile('文件过大');
    }
    if (isDangerousMagic(header)) rejectFile('不允许的文件类型');
    if (hasKnownExtMagic(ext) && !claimedExtMagicMatches(header, ext)) rejectFile('文件内容与扩展名不符');
    return originalName;
}

function asBuffer(bytes: Buffer | Uint8Array): Buffer {
    return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}

function isNodeErrno(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === code;
}

async function unlinkQuiet(path: string, actor: number, id?: ObjectId, size?: number): Promise<void> {
    try {
        await unlink(path);
    } catch (error) {
        if (isNodeErrno(error, 'ENOENT')) return;
        logStageError('temp_cleanup_failed', actor, id, size);
        throw error;
    }
}

function takeHeader(chunk: Uint8Array, header: number[]): number[] {
    if (header.length >= HEADER_LEN) return header;
    const limit = Math.min(chunk.length, HEADER_LEN - header.length);
    for (let i = 0; i < limit; i += 1) header.push(chunk[i]);
    return header;
}

async function inspectPath(path: string, maxFileBytes: number): Promise<{ header: Uint8Array<ArrayBufferLike>; sha256: string; size: number }> {
    const info = await stat(path);
    if (!info.isFile()) rejectFile('缺少文件内容');
    if (!Number.isInteger(info.size) || info.size <= 0) rejectFile('空文件');
    if (info.size > maxFileBytes || info.size > ADMIN_DROPBOX_HARD_MAX_FILE_BYTES) rejectFile('文件过大');
    const hash = createHash('sha256');
    const headerBytes: number[] = [];
    let size = 0;
    const stream = createReadStream(path);
    try {
        for await (const chunk of stream) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            takeHeader(buf, headerBytes);
            hash.update(buf);
            size += buf.length;
            if (size > maxFileBytes || size > ADMIN_DROPBOX_HARD_MAX_FILE_BYTES) rejectFile('文件过大');
        }
    } finally {
        stream.destroy();
    }
    if (size !== info.size) rejectFile('文件大小不一致');
    return { header: Uint8Array.from(headerBytes), sha256: hash.digest('hex'), size };
}

async function materializeStream(stream: Readable, maxFileBytes: number): Promise<string> {
    const path = join(tmpdir(), `krypton-admin-dropbox-${randomBytes(16).toString('hex')}`);
    let size = 0;
    const limiter = new Transform({
        transform(chunk, _enc, cb) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buf.length;
            if (size > maxFileBytes || size > ADMIN_DROPBOX_HARD_MAX_FILE_BYTES) {
                cb(new AdminDropboxFileRejectedError('文件过大'));
                return;
            }
            cb(null, buf);
        },
    });
    try {
        await pipeline(stream, limiter, createWriteStream(path));
    } catch (error) {
        await unlink(path).catch((cleanupError) => {
            if (!isNodeErrno(cleanupError, 'ENOENT')) throw cleanupError;
        });
        throw error;
    }
    return path;
}

function normalizeInput(file: AdminDropboxFileInput): {
    bytes?: Buffer;
    stream?: Readable;
    tempPath?: string;
    claimedSize?: number;
} {
    if (Buffer.isBuffer(file) || file instanceof Uint8Array) {
        const bytes = asBuffer(file);
        return { bytes, claimedSize: bytes.byteLength };
    }
    if (file instanceof Readable) return { stream: file };
    if (!file || typeof file !== 'object') rejectFile('缺少文件内容');
    const rec = file as {
        bytes?: Buffer | Uint8Array;
        stream?: Readable;
        tempPath?: string;
        filepath?: string;
        size?: number;
    };
    const bytes = rec.bytes ? asBuffer(rec.bytes) : undefined;
    const stream = rec.stream instanceof Readable ? rec.stream : undefined;
    const tempPath = typeof rec.tempPath === 'string' && rec.tempPath
        ? rec.tempPath
        : typeof rec.filepath === 'string' && rec.filepath
            ? rec.filepath
            : undefined;
    const sources = [bytes ? 1 : 0, stream ? 1 : 0, tempPath ? 1 : 0].reduce((sum, item) => sum + item, 0);
    if (sources !== 1) rejectFile('缺少文件内容');
    const claimedSize = rec.size ?? undefined;
    if (claimedSize != null && (!Number.isInteger(claimedSize) || claimedSize <= 0)) rejectFile('空文件');
    return { bytes, stream, tempPath, claimedSize };
}

async function inspectUpload(file: AdminDropboxFileInput, maxFileBytes: number): Promise<InspectedUpload> {
    const input = normalizeInput(file);
    if (input.bytes) {
        const buf = input.bytes;
        if (input.claimedSize != null && input.claimedSize !== buf.byteLength) rejectFile('文件大小不一致');
        if (!isValidFileSize(buf.byteLength, maxFileBytes)) {
            if (!Number.isInteger(buf.byteLength) || buf.byteLength <= 0) rejectFile('空文件');
            rejectFile('文件过大');
        }
        return {
            header: buf.subarray(0, Math.min(HEADER_LEN, buf.length)),
            sha256: createHash('sha256').update(buf).digest('hex'),
            size: buf.byteLength,
            body: buf,
            ownedTempPath: null,
        };
    }
    if (input.tempPath) {
        const inspected = await inspectPath(input.tempPath, maxFileBytes);
        if (input.claimedSize != null && input.claimedSize !== inspected.size) rejectFile('文件大小不一致');
        return { ...inspected, body: input.tempPath, ownedTempPath: null };
    }
    if (input.stream) {
        const ownedTempPath = await materializeStream(input.stream, maxFileBytes);
        try {
            const inspected = await inspectPath(ownedTempPath, maxFileBytes);
            if (input.claimedSize != null && input.claimedSize !== inspected.size) rejectFile('文件大小不一致');
            return { ...inspected, body: ownedTempPath, ownedTempPath };
        } catch (error) {
            await unlink(ownedTempPath).catch((cleanupError) => {
                if (!isNodeErrno(cleanupError, 'ENOENT')) throw cleanupError;
            });
            throw error;
        }
    }
    rejectFile('缺少文件内容');
}

function expectedStoragePath(domainId: string, fileId: ObjectId | string): string {
    try {
        return dropboxStoragePath(domainId, String(fileId));
    } catch {
        rejectFile('存储路径不合法');
    }
}

function assertCanonicalPath(doc: Pick<AdminDropboxFileDoc, '_id' | 'domainId' | 'storagePath'>): string {
    let expected: string;
    try {
        expected = dropboxStoragePath(doc.domainId, String(doc._id));
    } catch {
        throw new TypeError('admin dropbox storage path is invalid');
    }
    if (doc.storagePath !== expected || !isAdminDropboxStoragePath(doc.storagePath)) {
        throw new TypeError('admin dropbox storage path is invalid');
    }
    if (doc.storagePath.startsWith('collect/') || doc.storagePath.includes('..')) {
        throw new TypeError('admin dropbox storage path is invalid');
    }
    return expected;
}

async function loadFile(domainId: string, id: ObjectId | string): Promise<AdminDropboxFileDoc> {
    const _id = parseFileId(id);
    const doc = await dropboxFilesColl.findOne({ domainId, _id });
    if (!doc) throw new AdminDropboxNotFoundError();
    return doc;
}

async function deleteBlobAndDoc(
    doc: AdminDropboxFileDoc,
    stage: string,
    operatorUid: number,
): Promise<void> {
    await withDropboxLock(dropboxFileLockKey(doc.domainId, String(doc._id)), async () => {
        const current = await dropboxFilesColl.findOne({ domainId: doc.domainId, _id: doc._id });
        if (!current) return;
        let path: string;
        try {
            path = assertCanonicalPath(current);
        } catch (error) {
            logStageError('path_invalid', operatorUid, current._id, current.size);
            throw error;
        }
        await StorageModel.del([path], operatorUid);
        const deleted = await dropboxFilesColl.deleteOne({
            domainId: current.domainId,
            _id: current._id,
            storagePath: path,
        });
        if (deleted.deletedCount !== 1) {
            logStageError(`${stage}_meta_leftover`, operatorUid, current._id, current.size);
            throw new TypeError('admin dropbox metadata delete did not match');
        }
        logStage(stage, operatorUid, current._id, current.size);
    });
}

export async function create(
    actor: AdminDropboxActor,
    file: AdminDropboxFileInput,
    originalName: string,
    expireAt: Date | 'default',
    note?: string | null,
): Promise<AdminDropboxFileDoc> {
    assertActor(actor);
    const now = new Date();
    const resolvedExpireAt = resolveExpireAt(expireAt, now);
    const resolvedNote = note === undefined ? null : note;
    if (!isValidNote(resolvedNote)) rejectFile('备注过长');
    const maxFileBytes = configuredMaxFileBytes();
    const inspected = await inspectUpload(file, maxFileBytes);
    const name = assertUploadAllowed(originalName, inspected.size, maxFileBytes, inspected.header);
    if (!isSha256Hex(inspected.sha256)) {
        throw new TypeError('admin dropbox sha256 is invalid');
    }
    const _id = new ObjectId();
    const storagePath = expectedStoragePath(actor.domainId, _id);
    const doc: AdminDropboxFileDoc = {
        _id,
        domainId: actor.domainId,
        ownerUid: actor._id,
        originalName: name,
        storagePath,
        size: inspected.size,
        sha256: inspected.sha256,
        createdAt: now,
        expireAt: resolvedExpireAt,
        note: resolvedNote,
    };
    let inserted = false;
    let cleanupError: unknown = null;
    try {
        await withDropboxLock(dropboxFileLockKey(actor.domainId, String(_id)), async () => {
            logStage('put', actor._id, _id, inspected.size);
            await StorageModel.put(storagePath, inspected.body, actor._id);
            const meta = await StorageModel.getMeta(storagePath);
            if (!meta || meta.size !== inspected.size) {
                logStageError('put_size_mismatch', actor._id, _id, inspected.size);
                await StorageModel.del([storagePath], actor._id);
                rejectFile('存储写入大小不一致');
            }
            try {
                await dropboxFilesColl.insertOne(doc);
                inserted = true;
            } catch (error) {
                logStageError('insert_failed', actor._id, _id, inspected.size);
                await StorageModel.del([storagePath], actor._id);
                throw error;
            }
            logStage('insert', actor._id, _id, inspected.size);
        });
    } finally {
        if (inspected.ownedTempPath) {
            try {
                await unlinkQuiet(inspected.ownedTempPath, actor._id, _id, inspected.size);
            } catch (error) {
                // A cleanup failure must not mask the upload failure that caused it,
                // and must not fail a request whose document was already stored.
                cleanupError = error;
            }
        }
    }
    if (cleanupError && !inserted) throw cleanupError;
    return doc;
}

export async function list(
    actor: AdminDropboxActor,
    opts?: { purgeExpired?: boolean },
): Promise<AdminDropboxFileDoc[]> {
    assertActor(actor);
    if (opts?.purgeExpired !== false) await purgeExpired(actor.domainId);
    const files = await listFiles(actor.domainId);
    logStage('list', actor._id);
    return files;
}

async function getFileForDownload(domainId: string, id: ObjectId | string): Promise<AdminDropboxFileDoc> {
    assertDomainId(domainId);
    const file = await loadFile(domainId, id);
    if (isExpired(file)) {
        await deleteBlobAndDoc(file, 'expire', file.ownerUid);
        throw new AdminDropboxExpiredError();
    }
    const path = assertCanonicalPath(file);
    if (!(await StorageModel.exists(path))) {
        logStageError('blob_missing', file.ownerUid, file._id, file.size);
        throw new TypeError('admin dropbox blob is missing');
    }
    logStage('download', file.ownerUid, file._id, file.size);
    return file;
}

export async function download(
    actor: AdminDropboxActor,
    id: ObjectId | string,
): Promise<AdminDropboxDownload> {
    assertActor(actor);
    const file = await getFileForDownload(actor.domainId, id);
    const url = await StorageModel.signDownloadLink(file.storagePath, file.originalName, false, 'user');
    return { url, file };
}

async function deleteFile(domainId: string, id: ObjectId | string): Promise<void> {
    assertDomainId(domainId);
    const file = await loadFile(domainId, id);
    await deleteBlobAndDoc(file, 'remove', file.ownerUid);
}

export async function remove(actor: AdminDropboxActor, id: ObjectId | string): Promise<void> {
    assertActor(actor);
    await deleteFile(actor.domainId, id);
}

export async function putFile(input: PutAdminDropboxFileInput): Promise<AdminDropboxFileDoc> {
    const actor = await actorFromUid(input.domainId, input.ownerUid);
    const file: AdminDropboxFileInput = input.bytes
        ? { bytes: input.bytes, size: input.size }
        : input.stream
            ? { stream: input.stream, size: input.size }
            : { tempPath: input.tempPath, filepath: input.filepath, size: input.size };
    return create(actor, file, input.originalName, input.expireAt, input.note);
}

async function listFiles(domainId: string): Promise<AdminDropboxFileDoc[]> {
    assertDomainId(domainId);
    const now = new Date();
    const docs = await dropboxFilesColl
        .find({ domainId })
        .sort({ createdAt: -1, _id: -1 })
        .toArray();
    const live: AdminDropboxFileDoc[] = [];
    for (const doc of docs) {
        if (isExpired(doc, now)) continue;
        try {
            assertCanonicalPath(doc);
        } catch (error) {
            logStageError('path_invalid', doc.ownerUid, doc._id, doc.size);
            throw error;
        }
        live.push(doc);
    }
    return live;
}

async function purgeExpired(domainId?: string): Promise<number> {
    if (domainId !== undefined) assertDomainId(domainId);
    const now = new Date();
    const filter = domainId ? { domainId, expireAt: { $lte: now } } : { expireAt: { $lte: now } };
    const expired = await dropboxFilesColl.find(filter).toArray();
    for (const doc of expired) {
        await deleteBlobAndDoc(doc, 'expire', doc.ownerUid);
    }
    return expired.length;
}
