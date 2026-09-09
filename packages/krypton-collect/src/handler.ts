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
    TrainingModel,
    Types,
    param,
} from 'hydrooj';
import { canCreateCollect, canEditCollect, canViewCollect } from './auth';
import { filesColl, submissionsColl } from './db';
import { CollectForbiddenError, CollectNotFoundError } from './errors';
import {
    archiveRequest,
    assignedNameForFile,
    closeRequest,
    confirmSubmit,
    createRequest,
    deleteCurrentFile,
    deleteRequestIfEmpty,
    getFileForDownload,
    getRequest,
    isAudienceMember,
    listExpectedMissingRows,
    listPackEntries,
    listPendingForUser,
    listProgress,
    listRequestsForStudent,
    listRequestsForTeacher,
    listSubmittedCsvRows,
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
    type CreateCollectRequestInput,
    type UpdateCollectRequestPatch,
} from './model';
import { requestFileNameTemplate, requestPackLayout } from './name-format';
import { buildManifest, buildMissingCsv, buildSubmittedCsv } from './pack-format';
import { requiredSlotsFilled } from './types';
import type { CollectFileDoc, CollectRequestDoc } from './types';

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
    const session = handler.session as { sessionId?: string; _id?: string; sid?: string } | undefined;
    const sid = String(session?.sessionId || session?._id || session?.sid || '');
    let vigil: {
        clientSessionKeyFromSession?: (value: unknown) => string;
        currentClientSession?: (id: string) => Promise<unknown>;
    };
    try {
        vigil = require('@hydrooj/krypton-vigilguard');
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
        if (code === 'MODULE_NOT_FOUND') {
            throw new CollectForbiddenError('无法确认考试会话，拒绝访问文件收集');
        }
        throw error;
    }
    const key = typeof vigil.clientSessionKeyFromSession === 'function'
        ? String(vigil.clientSessionKeyFromSession(handler.session) || sid)
        : sid;
    if (!key) return;
    if (typeof vigil.currentClientSession !== 'function') {
        throw new CollectForbiddenError('无法确认考试会话，拒绝访问文件收集');
    }
    const bound = await vigil.currentClientSession(key);
    if (bound) throw new CollectForbiddenError('考试会话中不能使用文件收集');
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
    const [schools, groups, courseDocs] = await Promise.all([
        typeof ub.listSchools === 'function' ? ub.listSchools(domainId) : Promise.resolve([]),
        typeof ub.listUserGroups === 'function' ? ub.listUserGroups(domainId) : Promise.resolve([]),
        TrainingModel.getMulti(domainId, { kind: 'course' }).limit(100).toArray(),
    ]);
    return {
        schools: (schools as Array<{ _id: ObjectId; name: string }>).map((row) => ({ _id: String(row._id), name: row.name })),
        groups: (groups as Array<{ _id: ObjectId; schoolId: ObjectId; name: string; archivedAt?: Date | null }>).map((row) => ({
            _id: String(row._id),
            schoolId: String(row.schoolId),
            name: row.name,
            ...(row.archivedAt ? { archivedAt: row.archivedAt.toISOString() } : {}),
        })),
        courses: courseDocs.map((doc) => ({
            _id: String(doc.docId || doc._id),
            title: String(doc.title || '未命名课程'),
            chapters: Array.isArray(doc.dag)
                ? doc.dag.map((node) => ({ _id: String(node._id), title: String(node.title || '未命名章节') }))
                : [],
        })),
    };
}

async function coursePrefill(domainId: string, courseId: string, chapter: string) {
    if (!courseId) return { prefillGroupIds: [] as string[], prefillSchoolId: '', fromCourse: '', chapter: '' };
    const tdoc = await TrainingModel.get(domainId, new ObjectId(courseId));
    if (tdoc.kind !== 'course') {
        return { prefillGroupIds: [] as string[], prefillSchoolId: '', fromCourse: '', chapter: '' };
    }
    const groupIds = Array.isArray(tdoc.courseGroupIds) ? tdoc.courseGroupIds.map((id: ObjectId) => String(id)) : [];
    const ub = await userbindOrThrow();
    let prefillSchoolId = '';
    if (groupIds[0] && typeof ub.getUserGroup === 'function') {
        const group = await ub.getUserGroup(domainId, new ObjectId(groupIds[0]));
        if (group?.schoolId) prefillSchoolId = String(group.schoolId);
    }
    return {
        prefillGroupIds: groupIds,
        prefillSchoolId,
        fromCourse: courseId,
        chapter,
    };
}

interface CollectIdentity {
    studentId: string;
    realName: string;
}

function slotTitleOf(request: CollectRequestDoc, slotId: string): string {
    return request.slots.find((slot) => slot.id === slotId)?.title || slotId;
}

function currentFileIndex(files: Array<{ slotId: string; fileId: string }>, file: { slotId: string; fileId: string }): number {
    const sameSlot = files.filter((row) => row.slotId === file.slotId);
    const pos = sameSlot.findIndex((row) => row.fileId === file.fileId);
    return pos >= 0 ? pos + 1 : 1;
}

function assignedNameFor(
    request: CollectRequestDoc,
    identity: { uid: number; studentId?: string; realName?: string },
    file: { slotId: string; fileId: string; originalName: string; ext: string },
    index: number,
): string {
    return assignedNameForFile(request, identity, { title: slotTitleOf(request, file.slotId) }, file, index);
}

async function lookupStudentIdentity(domainId: string, uid: number): Promise<CollectIdentity> {
    const ub = await userbindOrThrow();
    const student = await ub.findStudentByUserId(domainId, uid);
    return {
        studentId: student?.studentId?.trim() || '',
        realName: student?.realName?.trim() || '',
    };
}

async function assignedDownloadName(
    request: CollectRequestDoc,
    file: CollectFileDoc,
    identity: CollectIdentity,
): Promise<string> {
    if (!file.current) return file.originalName;
    const submission = await submissionsColl.findOne({
        domainId: request.domainId,
        requestId: request._id,
        uid: file.uid,
    });
    const currentFiles = submission?.currentFiles || [];
    return assignedNameFor(request, { uid: file.uid, ...identity }, file, currentFileIndex(currentFiles, file));
}

function serializeRequest(doc: CollectRequestDoc, extras: {
    hasSubmissions?: boolean;
    hasFiles?: boolean;
    canEdit?: boolean;
    schoolName?: string;
} = {}) {
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
        fileNameTemplate: requestFileNameTemplate(doc.fileNameTemplate),
        packLayout: requestPackLayout(doc.packLayout),
        courseRef: doc.courseRef
            ? { courseId: String(doc.courseRef.courseId), chapterId: doc.courseRef.chapterId }
            : null,
        hasSubmissions: extras.hasSubmissions === true,
        hasFiles: extras.hasFiles === true,
        canEdit: extras.canEdit === true,
        ...(extras.schoolName ? { schoolName: extras.schoolName } : {}),
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
        if (request.status === 'draft' || request.status === 'archived') throw new CollectNotFoundError();
        const member = await isAudienceMember(domainId, this.user._id, request);
        const submission = await submissionsColl.findOne({ domainId, requestId: request._id, uid: this.user._id });
        if (!member && !submission) throw new CollectForbiddenError('不在收集名单中');
        const history = await filesColl
            .find({ domainId, requestId: request._id, uid: this.user._id })
            .sort({ createdAt: -1 })
            .toArray();
        const identity = await lookupStudentIdentity(domainId, this.user._id);
        const files = submission?.currentFiles || [];
        const currentFiles = files.map((file) => ({
            ...file,
            assignedName: assignedNameFor(
                request,
                { uid: this.user._id, ...identity },
                file,
                currentFileIndex(files, file),
            ),
            url: `/collect/${String(request._id)}/file/${file.fileId}`,
        }));
        this.response.template = 'collect_detail.html';
        this.response.body = {
            _id: String(request._id),
            title: request.title,
            description: request.description,
            dueAt: request.dueAt.toISOString(),
            status: request.status,
            member,
            submitted: submission?.status === 'submitted',
            filled: requiredSlotsFilled(request.slots, files),
            slots: request.slots,
            fileNameTemplate: requestFileNameTemplate(request.fileNameTemplate),
            packLayout: requestPackLayout(request.packLayout),
            identity: { uid: this.user._id, ...identity },
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
    async postUploadFile(domainId: string, id: ObjectId) {
        return this.applyStudentPost(domainId, id, 'upload_file');
    }

    @param('id', Types.ObjectId)
    async postReplaceFile(domainId: string, id: ObjectId) {
        return this.applyStudentPost(domainId, id, 'replace_file');
    }

    @param('id', Types.ObjectId)
    async postDeleteFile(domainId: string, id: ObjectId) {
        return this.applyStudentPost(domainId, id, 'delete_file');
    }

    @param('id', Types.ObjectId)
    async postConfirm(domainId: string, id: ObjectId) {
        return this.applyStudentPost(domainId, id, 'confirm');
    }

    async applyStudentPost(domainId: string, id: ObjectId, operation: string) {
        const authoritativeDomainId = domainIdOf(this);
        if (domainId && String(domainId) !== authoritativeDomainId) {
            throw new CollectForbiddenError('域不匹配');
        }
        const request = await getRequest(authoritativeDomainId, id);
        if (request.status === 'draft' || request.status === 'archived') throw new CollectNotFoundError();
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
        if (request.status === 'draft' || request.status === 'archived') throw new CollectNotFoundError();
        const file = await getFileForDownload(request, actorOf(this), fileId);
        const identity = await lookupStudentIdentity(request.domainId, this.user._id);
        const assignedName = await assignedDownloadName(request, file, identity);
        this.response.addHeader('Cache-Control', 'private, no-store');
        this.response.addHeader('X-Content-Type-Options', 'nosniff');
        await OplogModel.log(this, 'collect.view_file', {
            requestId: String(request._id),
            fileId: file.fileId,
            size: file.size,
            ownerUid: file.uid,
        });
        this.response.redirect = await StorageModel.signDownloadLink(file.storagePath, assignedName, false, 'user');
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
        const actor = actorOf(this);
        const catalog = await loadCatalog(domainId);
        const docs = await listRequestsForTeacher(domainId, actor);
        const schoolName = new Map(catalog.schools.map((row) => [row._id, row.name]));
        const extras = await Promise.all(docs.map(async (doc) => {
            const [rows, file] = await Promise.all([
                listProgress(doc),
                filesColl.findOne({ domainId, requestId: doc._id }),
            ]);
            const due = rows.filter((row) => !row.leftGroup);
            const submitted = due.filter((row) => row.status === 'submitted').length;
            const leftSubmitted = rows.some((row) => row.leftGroup && row.status === 'submitted');
            return {
                id: String(doc._id),
                submitted,
                total: due.length,
                hasSubmissions: submitted > 0 || leftSubmitted,
                hasFiles: !!file || submitted > 0 || leftSubmitted,
            };
        }));
        const byId = new Map(extras.map((row) => [row.id, row]));
        this.response.template = 'admin_collect.html';
        this.response.body = {
            schools: catalog.schools,
            canCreate: canCreateCollect(this.user),
            requests: docs.map((doc) => {
                const extra = byId.get(String(doc._id));
                return {
                    ...serializeRequest(doc, {
                        hasSubmissions: extra?.hasSubmissions === true,
                        hasFiles: extra?.hasFiles === true,
                        canEdit: canEditCollect(actor, doc),
                        schoolName: schoolName.get(String(doc.schoolId)),
                    }),
                    submitted: extra?.submitted || 0,
                    total: extra?.total || 0,
                };
            }),
        };
    }

    @param('id', Types.ObjectId, true)
    async postPublish(_domainId: string, id?: ObjectId) {
        return this.applyListPost(id, 'publish');
    }

    @param('id', Types.ObjectId, true)
    async postClose(_domainId: string, id?: ObjectId) {
        return this.applyListPost(id, 'close');
    }

    @param('id', Types.ObjectId, true)
    async postReopen(_domainId: string, id?: ObjectId) {
        return this.applyListPost(id, 'reopen');
    }

    @param('id', Types.ObjectId, true)
    async postArchive(_domainId: string, id?: ObjectId) {
        return this.applyListPost(id, 'archive');
    }

    @param('id', Types.ObjectId, true)
    async postDelete(_domainId: string, id?: ObjectId) {
        return this.applyListPost(id, 'delete');
    }

    async applyListPost(id: ObjectId | undefined, operation: string) {
        const domainId = domainIdOf(this);
        const actor = actorOf(this);
        if (!id) throw new CollectNotFoundError();
        const current = await getRequest(domainId, id);
        if (operation === 'publish') {
            const published = await publishRequest(domainId, id, actor, current.revision);
            const audience = await resolveAudience(published.domainId, published.schoolId, published.groupIds);
            await notifyUids(audience.map((row) => row.boundUserId), published.title, collectUrl(this, published._id));
            await OplogModel.log(this, 'collect.publish', { requestId: String(id), assigneeCount: audience.length });
            this.back();
            return;
        }
        if (operation === 'close') {
            await closeRequest(domainId, id, actor, current.revision);
            await OplogModel.log(this, 'collect.close', { requestId: String(id) });
            this.back();
            return;
        }
        if (operation === 'reopen') {
            await reopenRequest(domainId, id, actor, current.revision);
            await OplogModel.log(this, 'collect.reopen', { requestId: String(id) });
            this.back();
            return;
        }
        if (operation === 'archive') {
            await archiveRequest(domainId, id, actor, current.revision);
            await OplogModel.log(this, 'collect.archive', { requestId: String(id) });
            this.back();
            return;
        }
        if (operation === 'delete') {
            await deleteRequestIfEmpty(domainId, id, actor, current.revision);
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
        const prefill = await coursePrefill(domainId, fromCourse ? String(fromCourse) : '', chapter != null ? String(chapter) : '');
        let requestView = null as ReturnType<typeof serializeRequest> | null;
        let hasSubmissions = false;
        let hasFiles = false;
        if (id) {
            const request = await getRequest(domainId, id);
            if (!canViewCollect(this.user, request)) throw new CollectForbiddenError('无权查看该收集');
            const [submitted, file] = await Promise.all([
                submissionsColl.findOne({ domainId, requestId: request._id, status: 'submitted' }),
                filesColl.findOne({ domainId, requestId: request._id }),
            ]);
            hasSubmissions = !!submitted;
            hasFiles = !!file || !!submitted;
            requestView = serializeRequest(request, {
                hasSubmissions,
                hasFiles,
                canEdit: canEditCollect(actorOf(this), request),
            });
        }
        this.response.template = 'admin_collect_edit.html';
        this.response.body = {
            ...catalog,
            request: requestView,
            hasSubmissions,
            hasFiles,
            canEdit: requestView ? requestView.canEdit : canCreateCollect(this.user),
            ...prefill,
        };
    }

    @param('id', Types.ObjectId, true)
    async postCreate(_domainId: string, id?: ObjectId) {
        return this.applyEditPost(id, 'create');
    }

    @param('id', Types.ObjectId, true)
    async postUpdate(_domainId: string, id?: ObjectId) {
        return this.applyEditPost(id, 'update');
    }

    @param('id', Types.ObjectId, true)
    async postPublish(_domainId: string, id?: ObjectId) {
        return this.applyEditPost(id, 'publish');
    }

    @param('id', Types.ObjectId, true)
    async postClose(_domainId: string, id?: ObjectId) {
        return this.applyEditPost(id, 'close');
    }

    @param('id', Types.ObjectId, true)
    async postReopen(_domainId: string, id?: ObjectId) {
        return this.applyEditPost(id, 'reopen');
    }

    async applyEditPost(id: ObjectId | undefined, operation: string) {
        const domainId = domainIdOf(this);
        const body = this.request.body || {};
        const title = String(body.title || '');
        const description = String(body.description || '');
        const dueAt = parseCollectDueAt(body.dueAt);
        const schoolId = String(body.schoolId || '');
        const groupIds = parseObjectIdList(body.groupIds);
        const slots = parseSlotsJson(body.slots);
        const maxFileBytes = Number(body.maxFileBytes);
        const maxTotalBytes = Number(body.maxTotalBytes);
        const maxFiles = Number(body.maxFiles);
        const courseId = String(body.courseId || '').trim();
        const chapterToken = body.chapterId;
        const chapterId = chapterToken === '' || chapterToken == null ? Number.NaN : Number(chapterToken);
        const courseRef = courseId && Number.isInteger(chapterId) && chapterId >= 0
            ? { courseId, chapterId }
            : null;
        const patch: CreateCollectRequestInput & UpdateCollectRequestPatch = {
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
            fileNameTemplate: body.fileNameTemplate,
            packLayout: body.packLayout,
        };

        if (operation === 'create' || operation === 'publish' || (!id && operation === 'update')) {
            if (!id) {
                const created = await createRequest(domainId, this.user._id, patch);
                const collaborators = parseUidList(body.collaboratorUids);
                const withCollab = collaborators.length
                    ? await setCollaborators(domainId, created._id, actorOf(this), created.revision, collaborators)
                    : created;
                await OplogModel.log(this, 'collect.create', { requestId: String(created._id) });
                if (operation === 'publish') {
                    const published = await publishRequest(domainId, created._id, actorOf(this), withCollab.revision);
                    const audience = await resolveAudience(published.domainId, published.schoolId, published.groupIds);
                    await notifyUids(audience.map((row) => row.boundUserId), published.title, collectUrl(this, published._id));
                    await OplogModel.log(this, 'collect.publish', { requestId: String(created._id), assigneeCount: audience.length });
                    this.response.redirect = `/admin/collect/${String(created._id)}`;
                    return;
                }
                this.response.redirect = `/admin/collect/${String(created._id)}/edit`;
                return;
            }
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
        const canEdit = canEditCollect(this.user, request);
        const historyDocs = await filesColl
            .find({ domainId: request.domainId, requestId: request._id, current: false })
            .sort({ createdAt: -1, _id: -1 })
            .toArray();
        const historyByUid = new Map<number, typeof historyDocs>();
        for (const file of historyDocs) {
            const list = historyByUid.get(file.uid) || [];
            list.push(file);
            historyByUid.set(file.uid, list);
        }
        this.response.template = 'admin_collect_stats.html';
        this.response.body = {
            request: serializeRequest(request, { canEdit }),
            canEdit,
            canNudge: request.status === 'published' || request.status === 'closed',
            canPack: true,
            rows: rows.map((row) => ({
                uid: row.uid,
                studentId: row.studentId,
                realName: row.realName,
                status: row.status === 'submitted' ? 'submitted' : 'missing',
                submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
                leftGroup: row.leftGroup,
                files: row.currentFiles.map((file) => ({
                    ...file,
                    originalName: file.originalName,
                    assignedName: assignedNameFor(
                        request,
                        { uid: row.uid, studentId: row.studentId, realName: row.realName },
                        file,
                        currentFileIndex(row.currentFiles, file),
                    ),
                    duplicateCount: file.duplicateCount,
                    duplicateStudentIds: file.duplicateStudentIds,
                    url: `/admin/collect/${String(request._id)}/file/${file.fileId}`,
                })),
                history: (historyByUid.get(row.uid) || []).map((file) => ({
                    slotId: file.slotId,
                    fileId: file.fileId,
                    originalName: file.originalName,
                    size: file.size,
                    version: file.version,
                    url: `/admin/collect/${String(request._id)}/file/${file.fileId}`,
                })),
            })),
        };
    }

    @param('id', Types.ObjectId)
    async postNudge(_domainId: string, id: ObjectId) {
        const request = await getRequest(domainIdOf(this), id);
        const uids = await nudgeUnsubmitted(request, actorOf(this));
        await notifyUids(uids, request.title, collectUrl(this, request._id));
        await OplogModel.log(this, 'collect.nudge', { requestId: String(id), count: uids.length });
        this.back();
    }
}

class AdminCollectPackHandler extends CollectBaseHandler {
    @param('id', Types.ObjectId)
    async get(_domainId: string, id: ObjectId) {
        const request = await getRequest(domainIdOf(this), id);
        if (!canViewCollect(this.user, request)) throw new CollectForbiddenError('无权打包');
        const { entries } = await listPackEntries(request);
        const [signed, csvRows] = await Promise.all([
            Promise.all(entries.map(async (entry) => {
                const file = await getFileForDownload(request, actorOf(this), entry.fileId);
                const url = await StorageModel.signDownloadLink(file.storagePath, entry.assignedName, false, 'user');
                return { name: entry.name, url, sha256: entry.sha256, size: entry.size };
            })),
            listExpectedMissingRows(request),
        ]);
        const submittedRows = listSubmittedCsvRows(entries);
        await OplogModel.log(this, 'collect.pack_download', {
            requestId: String(id),
            fileCount: signed.length,
            totalSize: signed.reduce((sum, row) => sum + row.size, 0),
        });
        this.response.body = {
            entries: signed.map((row) => ({ name: row.name, url: row.url })),
            csv: buildMissingCsv(csvRows),
            submittedCsv: buildSubmittedCsv(submittedRows),
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
        const identity = await lookupStudentIdentity(request.domainId, file.uid);
        const assignedName = await assignedDownloadName(request, file, identity);
        this.response.addHeader('Cache-Control', 'private, no-store');
        this.response.addHeader('X-Content-Type-Options', 'nosniff');
        await OplogModel.log(this, 'collect.view_file', {
            requestId: String(id),
            fileId: file.fileId,
            size: file.size,
            ownerUid: file.uid,
        });
        this.response.redirect = await StorageModel.signDownloadLink(file.storagePath, assignedName, false, 'user');
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
