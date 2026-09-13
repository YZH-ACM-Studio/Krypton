/**
 * HTTP handlers for krypton-admin-dropbox.
 *
 * Templates are consumed by ui-next PAGE_MAP.
 * Routes stay under /admin/dropbox — never /collect or exam-mode.
 */
import {
    Context,
    Handler,
    ObjectId,
    OplogModel,
    PRIV,
    Types,
    ValidationError,
    param,
} from 'hydrooj';
import { AdminDropboxFileRejectedError } from './errors';
import {
    create,
    download,
    list,
    remove,
    type AdminDropboxActor,
} from './model';
import {
    ADMIN_DROPBOX_DEFAULT_MAX_FILE_BYTES,
    ADMIN_DROPBOX_DEFAULT_TTL_MS,
    expireAtFromTtlMs,
    isValidTtlMs,
    type AdminDropboxFileDoc,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

function domainIdOf(handler: Handler): string {
    return String(handler.domain?._id || '');
}

function actorOf(handler: Handler): AdminDropboxActor {
    return {
        _id: handler.user._id,
        domainId: domainIdOf(handler),
        hasPriv: (priv: number) => handler.user.hasPriv(priv),
    };
}

function uploadedFile(handler: Handler): { filepath?: string; size?: number; originalFilename?: string; name?: string } | undefined {
    return handler.request.files?.file as { filepath?: string; size?: number; originalFilename?: string; name?: string } | undefined;
}

function expireAtFromForm(expireDays?: number, expire?: string): Date | 'default' {
    if (expireDays == null && !(expire || '').trim()) return 'default';
    if (expireDays != null) {
        if (!Number.isInteger(expireDays) || expireDays <= 0) {
            throw new AdminDropboxFileRejectedError('过期时间不合法');
        }
        const ttlMs = expireDays * DAY_MS;
        if (!isValidTtlMs(ttlMs)) throw new AdminDropboxFileRejectedError('过期时间不合法');
        return expireAtFromTtlMs(ttlMs);
    }
    const raw = (expire || '').trim();
    if (/^[1-9]\d*$/.test(raw)) {
        const ttlMs = Number(raw) * DAY_MS;
        if (!isValidTtlMs(ttlMs)) throw new AdminDropboxFileRejectedError('过期时间不合法');
        return expireAtFromTtlMs(ttlMs);
    }
    const match = /^([1-9]\d*)\s*d$/i.exec(raw);
    if (!match) throw new AdminDropboxFileRejectedError('过期时间不合法');
    const ttlMs = Number(match[1]) * DAY_MS;
    if (!isValidTtlMs(ttlMs)) throw new AdminDropboxFileRejectedError('过期时间不合法');
    return expireAtFromTtlMs(ttlMs);
}

function serializeFile(doc: AdminDropboxFileDoc) {
    const id = String(doc._id);
    return {
        _id: id,
        originalName: doc.originalName,
        size: doc.size,
        sha256: doc.sha256,
        ownerUid: doc.ownerUid,
        createdAt: doc.createdAt.toISOString(),
        expireAt: doc.expireAt.toISOString(),
        note: doc.note,
        downloadUrl: `/admin/dropbox/${id}`,
    };
}

export class AdminDropboxHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
    }

    async get() {
        const files = await list(actorOf(this));
        this.response.template = 'admin_dropbox.html';
        this.response.body = {
            files: files.map(serializeFile),
            defaultExpireDays: Math.round(ADMIN_DROPBOX_DEFAULT_TTL_MS / DAY_MS),
            maxFileBytes: ADMIN_DROPBOX_DEFAULT_MAX_FILE_BYTES,
        };
    }

    @param('expireDays', Types.UnsignedInt, true)
    @param('expire', Types.String, true)
    @param('note', Types.String, true)
    async postUploadFile(_domainId: string, expireDays?: number, expire?: string, note?: string) {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        await this.limitRate('admin_dropbox_upload', 60, 20);
        const uploaded = uploadedFile(this);
        if (!uploaded?.filepath) throw new ValidationError('file');
        const filename = String(
            this.args.filename || this.request.body?.filename || uploaded.originalFilename || uploaded.name || '',
        );
        const created = await create(
            actorOf(this),
            { tempPath: uploaded.filepath, size: Number(uploaded.size || 0) },
            filename,
            expireAtFromForm(expireDays, expire),
            note ?? null,
        );
        await OplogModel.log(this, 'admin_dropbox.upload', {
            fileId: String(created._id),
            size: created.size,
            sha256: created.sha256,
        });
        this.response.body = { ok: true, fileId: String(created._id), size: created.size };
    }

    @param('id', Types.ObjectId)
    async postDelete(_domainId: string, id: ObjectId) {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        await remove(actorOf(this), id);
        await OplogModel.log(this, 'admin_dropbox.delete', { fileId: String(id) });
        this.response.body = { ok: true, fileId: String(id) };
    }
}

export class AdminDropboxDownloadHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
    }

    @param('id', Types.ObjectId)
    async get(_domainId: string, id: ObjectId) {
        const { url, file } = await download(actorOf(this), id);
        this.response.addHeader('Cache-Control', 'private, no-store');
        this.response.addHeader('X-Content-Type-Options', 'nosniff');
        await OplogModel.log(this, 'admin_dropbox.download', {
            fileId: String(file._id),
            size: file.size,
        });
        this.response.redirect = url;
    }
}

export function applyHandlers(ctx: Context) {
    ctx.Route('admin_dropbox', '/admin/dropbox', AdminDropboxHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.Route('admin_dropbox_file', '/admin/dropbox/:id', AdminDropboxDownloadHandler, PRIV.PRIV_EDIT_SYSTEM);
}
