/**
 * HTTP handlers for krypton-collect.
 *
 * Templates are consumed by ui-next PAGE_MAP.
 */
import {
    Context,
    Handler,
    MessageModel,
    ObjectId,
    OplogModel,
    PERM,
    PRIV,
    PermissionError,
    StorageModel,
    Types,
    param,
} from 'hydrooj';
import { canCreateCollect, canEditCollect, canViewCollect } from './auth';
import { filesColl, submissionsColl } from './db';
import { CollectForbiddenError, CollectNotFoundError } from './errors';
import {
    archiveRequest,
    closeRequest,
    confirmSubmit,
    createRequest,
    deleteCurrentFile,
    deleteRequestIfEmpty,
    getFileForDownload,
    getRequest,
    isAudienceMember,
    listPackEntries,
    listPendingForUser,
    listProgress,
    listRequestsForStudent,
    listRequestsForTeacher,
    nudgeUnsubmitted,
    parseCollectDueAt,
    publishRequest,
    putStudentFile,
    reopenRequest,
    replaceFile,
    resolveAudience,
    setCollaborators,
    updateRequest,
    userbindOrThrow,
} from './model';
import { buildManifest, buildMissingCsv } from './pack-format';
import { requiredSlotsFilled } from './types';
import type { CollectRequestDoc } from './types';

function domainIdOf(handler: Handler): string {
    return String(handler.domain?._id || '');
}

function actorOf(handler: Handler) {
    return {
        _id: handler.user._id,
        hasPerm: (perm: bigint) => handler.user.hasPerm(perm),
        hasPriv: (priv: number) => handler.user.hasPriv(priv),
    };
}

async function assertNotBoundClient(handler: Handler): Promise<void> {
    const session = handler.session as { sid?: string; id?: string } | undefined;
    const sid = String(session?.sid || session?.id || '');
    if (!sid) return;
    try {
        const vigil = require('@hydrooj/krypton-vigilguard') as { currentClientSession?: (id: string) => Promise<unknown> };
        if (typeof vigil.currentClientSession !== 'function') return;
        const bound = await vigil.currentClientSession(sid);
        if (bound) throw new CollectForbiddenError('考试会话中不能使用文件收集');
    } catch (error) {
        if (error instanceof CollectForbiddenError) throw error;
        const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
        if (code === 'MODULE_NOT_FOUND') return;
        throw error;
    }
}

function parseObjectIdList(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.map((item) => String(item).trim()).filter(Boolean);
    if (typeof raw === 'string') {
        return raw.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
    }
    return [];
}

function parseUidList(raw: unknown): number[] {
    if (Array.isArray(raw)) {
        return raw.map((item) => Number(item)).filter((uid) => Number.isSafeInteger(uid) && uid > 1);
    }
    if (typeof raw === 'string') {
        return raw.split(/[,，\s]+/).map((item) => Number(item.trim())).filter((uid) => Number.isSafeInteger(uid) && uid > 1);
    }
    return [];
}

function parseSlotsJson(raw: unknown): unknown {
    if (raw == null || raw === '') return undefined;
    if (typeof raw !== 'string') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        throw new CollectForbiddenError('槽位格式不正确');
    }
}

function collectUrl(handler: Handler, id: ObjectId | string): string {
    return `/collect/${String(id)}`;
}

function notifyContent(title: string, path: string): string {
    return `老师发布了文件收集：${title}\n请在截止前交文件：${path}`;
}

async function notifyUids(uids: number[], title: string, path: string): Promise<void> {
    if (!uids.length) return;
    try {
        await MessageModel.send(1, uids, notifyContent(title, path), MessageModel.FLAG_UNREAD);
    } catch (error) {
        console.error('[krypton-collect] notify failed', error);
    }
}

async function loadCatalog(domainId: string) {
    const ub = await userbindOrThrow();
    const [schools, groups] = await Promise.all([
        typeof ub.listSchools === 'function' ? ub.listSchools(domainId) : Promise.resolve([]),
        typeof ub.listUserGroups === 'function' ? ub.listUserGroups(domainId) : Promise.resolve([]),
    ]);
    return {
        schools: (schools as Array<{ _id: ObjectId; name: string }>).map((row) => ({ _id: String(row._id), name: row.name })),
        groups: (groups as Array<{ _id: ObjectId; schoolId: ObjectId; name: string; archivedAt?: Date | null }>).map((row) => ({
            _id: String(row._id),
            schoolId: String(row.schoolId),
            name: row.name,
            ...(row.archivedAt ? { archivedAt: row.archivedAt.toISOString() } : {}),
        })),
        courses: [] as Array<{ _id: string; title: string; chapters: Array<{ _id: string; title: string }> }>,
    };
}

function serializeRequest(doc: CollectRequestDoc) {
    return {
        _id: String(doc._id),
        title: doc.title,
        description: doc.description,
        dueAt: doc.dueAt.toISOString(),
        status: doc.status,
        revision: doc.revision,
        schoolId: String(doc.schoolId),
        groupIds: doc.groupIds.map((id) => String(id)),
        slots: doc.slots,
        ownerUid: doc.ownerUid,
        collaboratorUids: doc.collaboratorUids,
        maxFileBytes: doc.maxFileBytes,
        maxTotalBytes: doc.maxTotalBytes,
        maxFiles: doc.maxFiles,
        courseRef: doc.courseRef
            ? { courseId: String(doc.courseRef.courseId), chapterId: doc.courseRef.chapterId }
            : null,
        hasSubmissions: false,
    };
}

class CollectBaseHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        await assertNotBoundClient(this);
    }
}

class CollectListHandler extends CollectBaseHandler {
    async get() {
        const domainId = domainIdOf(this);
        const docs = await listRequestsForStudent(domainId, this.user._id);
        const mine = await submissionsColl.find({ domainId, uid: this.user._id }).toArray();
        const byId = new Map(mine.map((row) => [String(row.requestId), row]));
        this.response.template = 'collect_main.html';
        this.response.body = {
            requests: docs.map((doc) => {
                const submission = byId.get(String(doc._id));
                const filled = requiredSlotsFilled(doc.slots, submission?.currentFiles || []);
                return {
                    _id: String(doc._id),
                    title: doc.title,
                    dueAt: doc.dueAt.toISOString(),
                    status: doc.status,
                    submitted: submission?.status === 'submitted',
                    filled,
                };
            }),
        };
    }
}

class CollectDetailHandler extends CollectBaseHandler {
    @param('id', Types.ObjectId)
    async get(_domainId: string, id: ObjectId) {
        const domainId = domainIdOf(this);
        const request = await getRequest(domainId, id);
        const member = await isAudienceMember(domainId, this.user._id, request);
        const submission = await submissionsColl.findOne({ domainId, requestId: request._id, uid: this.user._id });
        if (!member && !submission) throw new CollectForbiddenError('不在收集名单中');
        const history = await filesColl
            .find({ domainId, requestId: request._id, uid: this.user._id })
            .sort({ createdAt: -1 })
            .toArray();
        const currentFiles = (submission?.currentFiles || []).map((file) => ({
            ...file,
            url: `/collect/${String(request._id)}/file/${file.fileId}`,
        }));
        this.response.template = 'collect_detail.html';
        this.response.body = {
            _id: String(request._id),
            title: request.title,
            description: request.description,
            dueAt: request.dueAt.toISOString(),
            status: request.status,
            submitted: submission?.status === 'submitted',
            filled: requiredSlotsFilled(request.slots, submission?.currentFiles || []),
            slots: request.slots,
            currentFiles,
            history: history.map((file) => ({
                slotId: file.slotId,
                fileId: file.fileId,
                originalName: file.originalName,
                size: file.size,
                version: file.version,
                current: file.current,
                createdAt: file.createdAt.toISOString(),
                ext: file.ext,
                url: `/collect/${String(request._id)}/file/${file.fileId}`,
            })),
        };
    }

    @param('id', Types.ObjectId)
    async post(domainId: string, id: ObjectId) {
        const authoritativeDomainId = domainIdOf(this);
        if (domainId && String(domainId) !== authoritativeDomainId) {
            throw new CollectForbiddenError('域不匹配');
        }
        const request = await getRequest(authoritativeDomainId, id);
        const operation = String((this.args as { operation?: string }).operation || this.request.body?.operation || '');
        if (operation === 'upload_file' || operation === 'replace_file') {
            await this.limitRate('collect_upload', 60, 20);
            const uploaded = this.request.files?.file as { filepath?: string; size?: number; originalFilename?: string; name?: string } | undefined;
            if (!uploaded?.filepath) throw new CollectForbiddenError('缺少文件');
            const slotId = String(this.args.slotId || this.request.body?.slotId || '');
            const filename = String(this.args.filename || this.request.body?.filename || uploaded.originalFilename || uploaded.name || 'file');
            const input = {
                request,
                uid: this.user._id,
                slotId,
                originalName: filename,
                size: Number(uploaded.size || 0),
                tempPath: uploaded.filepath,
            };
            const result = operation === 'replace_file'
                ? await replaceFile({ ...input, fileId: String(this.args.fileId || this.request.body?.fileId || '') })
                : await putStudentFile(input);
            await OplogModel.log(this, operation === 'replace_file' ? 'collect.replace' : 'collect.upload', {
                requestId: String(request._id),
                fileId: result.file.fileId,
                size: result.file.size,
                sha256: result.file.sha256,
            });
            this.response.body = { ok: true, fileId: result.file.fileId, size: result.file.size };
            return;
        }
        if (operation === 'delete_file') {
            const fileId = String(this.args.fileId || this.request.body?.fileId || '');
            await deleteCurrentFile(request, this.user._id, fileId);
            await OplogModel.log(this, 'collect.delete_file', { requestId: String(request._id), fileId });
            this.response.body = { ok: true, fileId };
            return;
        }
        if (operation === 'confirm') {
            const submission = await confirmSubmit(request, this.user._id);
            await OplogModel.log(this, 'collect.confirm', {
                requestId: String(request._id),
                fileCount: submission.currentFiles.length,
            });
            this.response.body = { ok: true, submitted: true };
            return;
        }
        throw new CollectForbiddenError('未知操作');
    }
}

class CollectFileDownloadHandler extends CollectBaseHandler {
    @param('id', Types.ObjectId)
    @param('fileId', Types.String)
    async get(_domainId: string, id: ObjectId, fileId: string) {
        const request = await getRequest(domainIdOf(this), id);
        const file = await getFileForDownload(request, actorOf(this), fileId);
        this.response.addHeader('Cache-Control', 'private, no-store');
        this.response.addHeader('X-Content-Type-Options', 'nosniff');
        await OplogModel.log(this, 'collect.view_file', {
            requestId: String(request._id),
            fileId: file.fileId,
            size: file.size,
            ownerUid: file.uid,
        });
        this.response.redirect = await StorageModel.signDownloadLink(file.storagePath, 'download', false, 'user');
    }
}

class CollectPendingApiHandler extends CollectBaseHandler {
    async get() {
        if (this.user._id <= 1) {
            this.response.body = { count: 0, docs: [] };
            return;
        }
        const docs = await listPendingForUser(domainIdOf(this), this.user._id);
        this.response.body = {
            count: docs.length,
            docs: docs.map((doc) => ({ _id: String(doc._id), title: doc.title, dueAt: doc.dueAt.toISOString() })),
        };
    }
}

class AdminCollectListHandler extends CollectBaseHandler {
    async prepare() {
        await super.prepare();
        if (!canCreateCollect(this.user)) throw new PermissionError(PERM.PERM_CREATE_COLLECT);
    }

    async get() {
        const domainId = domainIdOf(this);
        const docs = await listRequestsForTeacher(domainId, actorOf(this));
        const progress = await Promise.all(docs.map(async (doc) => {
            const rows = await listProgress(doc);
            const due = rows.filter((row) => !row.leftGroup);
            const submitted = due.filter((row) => row.status === 'submitted').length;
            return { id: String(doc._id), submitted, total: due.length };
        }));
        const byId = new Map(progress.map((row) => [row.id, row]));
        this.response.template = 'admin_collect.html';
        this.response.body = {
            requests: docs.map((doc) => ({
                ...serializeRequest(doc),
                submitted: byId.get(String(doc._id))?.submitted || 0,
                total: byId.get(String(doc._id))?.total || 0,
            })),
        };
    }

    @param('id', Types.ObjectId, true)
    async post(_domainId: string, id?: ObjectId) {
        const domainId = domainIdOf(this);
        const operation = String(this.request.body?.operation || this.args.operation || '');
        if (operation === 'archive' && id) {
            await archiveRequest(domainId, id, actorOf(this), Number(this.request.body?.revision || 0) || (await getRequest(domainId, id)).revision);
            await OplogModel.log(this, 'collect.archive', { requestId: String(id) });
            this.back();
            return;
        }
        if (operation === 'delete' && id) {
            const current = await getRequest(domainId, id);
            await deleteRequestIfEmpty(domainId, id, actorOf(this), current.revision);
            await OplogModel.log(this, 'collect.delete', { requestId: String(id) });
            this.response.redirect = '/admin/collect';
            return;
        }
        throw new CollectForbiddenError('未知操作');
    }
}

class AdminCollectEditHandler extends CollectBaseHandler {
    async prepare() {
        await super.prepare();
        if (!canCreateCollect(this.user)) throw new PermissionError(PERM.PERM_CREATE_COLLECT);
    }

    @param('id', Types.ObjectId, true)
    @param('fromCourse', Types.ObjectId, true)
    @param('chapter', Types.Int, true)
    async get(_domainId: string, id?: ObjectId, fromCourse?: ObjectId, chapter?: number) {
        const domainId = domainIdOf(this);
        const catalog = await loadCatalog(domainId);
        let doc = null as ReturnType<typeof serializeRequest> | null;
        if (id) {
            const request = await getRequest(domainId, id);
            if (!canViewCollect(this.user, request)) throw new CollectForbiddenError('无权查看该收集');
            const submitted = await submissionsColl.findOne({ domainId, requestId: request._id, status: 'submitted' });
            doc = { ...serializeRequest(request), hasSubmissions: !!submitted };
        }
        this.response.template = 'admin_collect_edit.html';
        this.response.body = {
            ...catalog,
            doc,
            fromCourse: fromCourse ? String(fromCourse) : '',
            chapter: chapter != null ? String(chapter) : '',
        };
    }

    @param('id', Types.ObjectId, true)
    async post(_domainId: string, id?: ObjectId) {
        const domainId = domainIdOf(this);
        const body = this.request.body || {};
        const operation = String(body.operation || '');
        const title = String(body.title || '');
        const description = String(body.description || '');
        const dueAt = parseCollectDueAt(body.dueAt);
        const schoolId = String(body.schoolId || '');
        const groupIds = parseObjectIdList(body.groupIds);
        const slots = parseSlotsJson(body.slots);
        const maxFileBytes = Number(body.maxFileBytes);
        const maxTotalBytes = Number(body.maxTotalBytes);
        const maxFiles = Number(body.maxFiles);
        const courseId = String(body.courseId || body.fromCourse || '');
        const chapterId = Number(body.chapterId || body.chapter);
        const courseRef = courseId && Number.isInteger(chapterId)
            ? { courseId, chapterId }
            : null;
        const patch = {
            title,
            description,
            dueAt,
            schoolId,
            groupIds,
            slots,
            maxFileBytes,
            maxTotalBytes,
            maxFiles,
            courseRef,
        };

        if (operation === 'create' || (!id && operation === 'update')) {
            const created = await createRequest(domainId, this.user._id, patch);
            await OplogModel.log(this, 'collect.create', { requestId: String(created._id) });
            this.response.redirect = `/admin/collect/${String(created._id)}/edit`;
            return;
        }
        if (!id) throw new CollectNotFoundError();
        const current = await getRequest(domainId, id);
        const revision = Number(body.revision || current.revision);
        if (operation === 'update') {
            const updated = await updateRequest(domainId, id, actorOf(this), revision, patch);
            const collaborators = parseUidList(body.collaboratorUids);
            if (canEditCollect(this.user, updated)) {
                await setCollaborators(domainId, id, actorOf(this), updated.revision, collaborators);
            }
            await OplogModel.log(this, 'collect.update', { requestId: String(id), revision: updated.revision });
            this.back();
            return;
        }
        if (operation === 'publish') {
            const updated = await updateRequest(domainId, id, actorOf(this), revision, patch);
            const published = await publishRequest(domainId, id, actorOf(this), updated.revision);
            const audience = await resolveAudience(published.domainId, published.schoolId, published.groupIds);
            await notifyUids(audience.map((row) => row.boundUserId), published.title, collectUrl(this, published._id));
            await OplogModel.log(this, 'collect.publish', { requestId: String(id), assigneeCount: audience.length });
            this.response.redirect = `/admin/collect/${String(id)}`;
            return;
        }
        if (operation === 'close') {
            await closeRequest(domainId, id, actorOf(this), revision);
            await OplogModel.log(this, 'collect.close', { requestId: String(id) });
            this.back();
            return;
        }
        if (operation === 'reopen') {
            await reopenRequest(domainId, id, actorOf(this), revision, dueAt);
            await OplogModel.log(this, 'collect.reopen', { requestId: String(id) });
            this.back();
            return;
        }
        throw new CollectForbiddenError('未知操作');
    }
}

class AdminCollectStatsHandler extends CollectBaseHandler {
    async prepare() {
        await super.prepare();
        if (!canCreateCollect(this.user)) throw new PermissionError(PERM.PERM_CREATE_COLLECT);
    }

    @param('id', Types.ObjectId)
    async get(_domainId: string, id: ObjectId) {
        const request = await getRequest(domainIdOf(this), id);
        if (!canViewCollect(this.user, request)) throw new CollectForbiddenError('无权查看该收集');
        const rows = await listProgress(request);
        this.response.template = 'admin_collect_stats.html';
        this.response.body = {
            request: serializeRequest(request),
            rows: rows.map((row) => ({
                uid: row.uid,
                studentId: row.studentId,
                realName: row.realName,
                status: row.status === 'submitted' ? 'submitted' : 'missing',
                submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
                leftGroup: row.leftGroup,
                files: row.currentFiles.map((file) => ({
                    ...file,
                    url: `/admin/collect/${String(request._id)}/file/${file.fileId}`,
                })),
            })),
        };
    }

    @param('id', Types.ObjectId)
    async post(_domainId: string, id: ObjectId) {
        const request = await getRequest(domainIdOf(this), id);
        const operation = String(this.request.body?.operation || '');
        if (operation === 'nudge') {
            const uids = await nudgeUnsubmitted(request, actorOf(this));
            await notifyUids(uids, request.title, collectUrl(this, request._id));
            await OplogModel.log(this, 'collect.nudge', { requestId: String(id), count: uids.length });
            this.back();
            return;
        }
        throw new CollectForbiddenError('未知操作');
    }
}

class AdminCollectPackHandler extends CollectBaseHandler {
    @param('id', Types.ObjectId)
    async get(_domainId: string, id: ObjectId) {
        const request = await getRequest(domainIdOf(this), id);
        if (!canViewCollect(this.user, request)) throw new CollectForbiddenError('无权打包');
        const { entries, missing } = await listPackEntries(request);
        const signed = await Promise.all(entries.map(async (entry) => {
            const file = await getFileForDownload(request, actorOf(this), entry.fileId);
            const url = await StorageModel.signDownloadLink(file.storagePath, 'download', false, 'user');
            return { name: entry.name, url, sha256: entry.sha256, size: entry.size };
        }));
        await OplogModel.log(this, 'collect.pack_download', {
            requestId: String(id),
            fileCount: signed.length,
            totalSize: signed.reduce((sum, row) => sum + row.size, 0),
        });
        this.response.body = {
            entries: signed.map((row) => ({ name: row.name, url: row.url })),
            csv: buildMissingCsv(missing),
            manifest: buildManifest(signed),
        };
    }
}

class AdminCollectFileDownloadHandler extends CollectBaseHandler {
    @param('id', Types.ObjectId)
    @param('fileId', Types.String)
    async get(_domainId: string, id: ObjectId, fileId: string) {
        const request = await getRequest(domainIdOf(this), id);
        if (!canViewCollect(this.user, request)) throw new CollectForbiddenError('无权下载');
        const file = await getFileForDownload(request, actorOf(this), fileId);
        this.response.addHeader('Cache-Control', 'private, no-store');
        this.response.addHeader('X-Content-Type-Options', 'nosniff');
        await OplogModel.log(this, 'collect.view_file', {
            requestId: String(id),
            fileId: file.fileId,
            size: file.size,
            ownerUid: file.uid,
        });
        this.response.redirect = await StorageModel.signDownloadLink(file.storagePath, 'download', false, 'user');
    }
}

export function applyHandlers(ctx: Context) {
    ctx.Route('collect_pending_api', '/api/collect/pending', CollectPendingApiHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('collect_main', '/collect', CollectListHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('collect_create_admin', '/admin/collect/create', AdminCollectEditHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('admin_collect', '/admin/collect', AdminCollectListHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('admin_collect_pack', '/admin/collect/:id/pack', AdminCollectPackHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('admin_collect_file', '/admin/collect/:id/file/:fileId', AdminCollectFileDownloadHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('admin_collect_edit', '/admin/collect/:id/edit', AdminCollectEditHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('admin_collect_stats', '/admin/collect/:id', AdminCollectStatsHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('collect_file', '/collect/:id/file/:fileId', CollectFileDownloadHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('collect_detail', '/collect/:id', CollectDetailHandler, PRIV.PRIV_USER_PROFILE);
}
