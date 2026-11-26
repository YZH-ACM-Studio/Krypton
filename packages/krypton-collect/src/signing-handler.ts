import { readFile } from 'node:fs/promises';
import { Context, Handler, MessageModel, ObjectId, OplogModel, param, PERM, PRIV, StorageModel, Types } from 'hydrooj';
import { parseCollectSigningReturn, withCollectSigningReturn } from 'hydrooj/src/lib/collect-signing-return';
import { canViewCollect } from './auth';
import { CollectFileRejectedError, CollectForbiddenError, CollectNotFoundError } from './errors';
import { assertNotBoundClient } from './handler';
import {
    closeRequest,
    createRequest,
    getRequest,
    listCollectEditorGroups,
    nudgeUnsubmitted,
    publishRequest,
    reopenRequest,
    setCollaborators,
    studentMatchesAudience,
    updateRequest,
    userbindOrThrow,
} from './model';
import {
    acceptedSigningFile,
    confirmSigningFields,
    copySigningDocument,
    ownSigningSubmission,
    readSigningAsset,
    reopenStudentSigning,
    signingProgress,
    signingRequest,
    signingStudent,
    submitSignature,
    uploadSigningSource,
} from './signing-model';
import { cleanSignature, renderSignedPdf, withSigningWorker } from './signing-pdf';
import { parseSigningFields, signingRoundOpen } from './signing-protocol';
import { collectKind } from './types';

class CollectSigningHandler extends Handler {
    noCheckPermView = true;

    @param('id', Types.ObjectId)
    async get(domainId: string, id: ObjectId) {
        const destination = parseCollectSigningReturn(this.url('collect_sign', { id }), domainId);
        if (!this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) {
            this.response.redirect = withCollectSigningReturn(this.url('user_login'), destination.path);
            return;
        }
        this.checkPerm(PERM.PERM_VIEW);
        await assertNotBoundClient(this);
        const request = await getRequest(domainId, id);
        if (collectKind(request) !== 'signing') throw new CollectNotFoundError();
        this.response.template = 'collect_sign.html';
        this.response.body = {
            request: { id: String(request._id), title: request.title, status: request.status, dueAt: request.dueAt },
            sourceUrl: request.signing ? this.url('collect_sign_source', { id }) : null,
        };
        if (this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
            this.response.body.mode = 'preview';
            this.response.body.manageUrl = this.url('admin_collect_sign', { id });
            return;
        }
        if (canViewCollect(this.user, request)) {
            this.response.redirect = this.url('admin_collect_sign', { id });
            return;
        }
        const submission = await ownSigningSubmission(request, this.user._id);
        if (submission?.currentFiles.length && submission.signing?.acceptedFileIds?.includes(submission.currentFiles[0].fileId)
            && (!signingRoundOpen(submission.signing) || request.status !== 'published' || request.dueAt.getTime() <= Date.now())) {
            this.response.body.mode = 'signed';
            this.response.body.signedAt = submission.submittedAt;
            delete this.response.body.sourceUrl;
            return;
        }
        if (request.status !== 'published' || request.dueAt.getTime() <= Date.now()) {
            this.response.body.mode = 'closed';
            return;
        }
        const student = await (await userbindOrThrow()).findStudentByUserId(domainId, this.user._id);
        if (!student) {
            this.response.redirect = withCollectSigningReturn(this.url('user_bind'), destination.path);
            return;
        }
        if (!studentMatchesAudience(student, request)) {
            this.response.body.mode = 'outside';
            return;
        }
        if (!student.studentId?.trim() || !student.realName?.trim()) throw new TypeError('签署学生缺少学号或姓名');
        this.response.body.mode = 'ready';
        this.response.body.identity = { studentId: student.studentId, realName: student.realName };
        this.response.body.pendingAttemptId = submission?.signing?.attempt?.attemptId || null;
        this.response.body.generation = submission?.signing?.generation ?? 0;
        this.response.body.reopened = !!submission?.currentFiles.length;
    }

    @param('id', Types.ObjectId)
    async post(domainId: string, id: ObjectId) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        await assertNotBoundClient(this);
        try {
            this.response.body = await submitSignature(domainId, id, this.user, this.request.body.attemptId, this.request.body.signature, this.request.body.generation);
        } catch (error) {
            console.error('[collect-signing] submit-failed', {
                domainId,
                requestId: String(id),
                uid: this.user._id,
                error: error instanceof Error ? error.message : 'unknown',
            });
            throw error;
        }
    }
}

class SigningPrivateHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        await assertNotBoundClient(this);
    }
}

class SigningSourceHandler extends SigningPrivateHandler {
    @param('id', Types.ObjectId)
    async get(domainId: string, id: ObjectId) {
        const request = await signingRequest(domainId, id);
        if (!canViewCollect(this.user, request)) await signingStudent(request, this.user);
        if (!request.signing) throw new CollectNotFoundError();
        this.response.type = 'application/pdf';
        this.response.addHeader('Cache-Control', 'private, no-store');
        this.response.body = await readSigningAsset(request.signing.pdf);
    }
}

class SigningFileHandler extends SigningPrivateHandler {
    @param('id', Types.ObjectId)
    @param('fileId', Types.String)
    async get(domainId: string, id: ObjectId, fileId: string) {
        const file = await acceptedSigningFile(domainId, id, this.user, fileId);
        this.response.redirect = await StorageModel.signDownloadLink(file.storagePath, file.originalName);
    }
}

function fieldsValue(value: unknown) {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        throw new CollectFileRejectedError('签署位置格式不正确');
    }
}

function groupIds(value: unknown) {
    return Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(/[,，\s]+/).filter(Boolean) : [];
}

class AdminSigningHandler extends SigningPrivateHandler {
    @param('id', Types.ObjectId, true)
    async get(domainId: string, id?: ObjectId) {
        const canEdit = this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        const request = id ? await signingRequest(domainId, id) : null;
        if (request ? !canViewCollect(this.user, request) : !canEdit) throw new CollectForbiddenError('无权管理文档签署');
        const ub = await userbindOrThrow();
        const [schools, availableGroups] = await Promise.all([
            canEdit ? ub.listSchools(domainId) : [],
            listCollectEditorGroups(domainId, this.user, request?.groupIds || []),
        ]);
        const selectedGroups = new Set(request?.groupIds.map(String));
        const groups = canEdit ? availableGroups : availableGroups.filter((group) => selectedGroups.has(group._id));
        this.response.template = 'admin_collect_sign.html';
        this.response.body = {
            canEdit,
            schools: schools.map((school) => ({ id: String(school._id), name: school.name })),
            groups: groups.map((group) => ({ id: group._id, schoolId: group.schoolId || String(request?.schoolId || ''),
                name: `${group.name}${group.archivedAt ? '（已归档）' : ''}` })),
            request: request
                ? {
                      id: String(id),
                      title: request.title,
                      description: request.description,
                      dueAt: request.dueAt,
                      status: request.status,
                      publishedAt: request.publishedAt,
                      revision: request.revision,
                      schoolId: String(request.schoolId),
                      groupIds: request.groupIds.map(String),
                      collaboratorUids: request.collaboratorUids,
                  }
                : null,
            document: request?.signing
                ? {
                      fields: request.signing.fields,
                      pages: request.signing.pages,
                      confirmed: request.signing.confirmedFingerprint === request.signing.fingerprint,
                      name: request.signing.source.originalName,
                  }
                : null,
            signUrl: id ? this.url('collect_sign', { id }) : null,
            sourceUrl: id && request?.signing ? this.url('collect_sign_source', { id }) : null,
            fileBaseUrl: id ? `${this.url('admin_collect_sign', { id })}/file/` : null,
            progress: request ? await signingProgress(request) : { rows: [], files: [] },
        };
    }

    @param('id', Types.ObjectId, true)
    async postSave(domainId: string, id?: ObjectId) {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        const body = this.request.body;
        const input = {
            title: body.title,
            description: body.description,
            dueAt: body.dueAt,
            schoolId: body.schoolId,
            groupIds: groupIds(body.groupIds),
        };
        const current = id ? await signingRequest(domainId, id) : null;
        const request = current
            ? await updateRequest(domainId, id, this.user, Number(body.revision), {
                  title: input.title,
                  dueAt: input.dueAt,
                  groupIds: input.groupIds,
                  ...(!current.publishedAt ? { schoolId: input.schoolId, description: input.description } : {}),
              })
            : await createRequest(domainId, this.user._id, { ...input, kind: 'signing' }, this.user);
        const uids = String(body.collaboratorUids || '')
            .split(/[,，\s]+/)
            .filter(Boolean)
            .map(Number);
        await setCollaborators(domainId, request._id, this.user, request.revision, uids);
        await OplogModel.log(this, 'collect.signing.save', { requestId: String(request._id) });
        this.response.redirect = this.url('admin_collect_sign', { id: request._id });
    }

    @param('id', Types.ObjectId)
    async postSource(domainId: string, id: ObjectId) {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        const file = this.request.files?.file;
        if (!file || file.size > 32 * 1024 * 1024) throw new CollectFileRejectedError('请选择 32 MB 以内的 PDF 或 DOCX');
        try {
            await uploadSigningSource(
                domainId,
                id,
                this.user,
                Number(this.request.body.revision),
                await readFile(file.filepath),
                file.originalFilename || '',
            );
            await OplogModel.log(this, 'collect.signing.source', { requestId: String(id) });
            this.response.body = { ok: true };
        } catch (error) {
            console.error('[collect-signing] source-failed', {
                domainId,
                requestId: String(id),
                error: error instanceof Error ? error.message : 'unknown',
            });
            throw error;
        }
    }

    @param('id', Types.ObjectId)
    async postFields(domainId: string, id: ObjectId) {
        await confirmSigningFields(domainId, id, this.user, Number(this.request.body.revision), fieldsValue(this.request.body.fields));
        await OplogModel.log(this, 'collect.signing.confirm', { requestId: String(id) });
        this.response.body = { ok: true };
    }

    @param('id', Types.ObjectId)
    async postPublish(domainId: string, id: ObjectId) {
        await publishRequest(domainId, id, this.user, Number(this.request.body.revision));
        await OplogModel.log(this, 'collect.signing.publish', { requestId: String(id) });
        this.response.body = { ok: true };
    }

    @param('id', Types.ObjectId)
    async postClose(domainId: string, id: ObjectId) {
        await closeRequest(domainId, id, this.user, Number(this.request.body.revision));
        await OplogModel.log(this, 'collect.signing.close', { requestId: String(id) });
        this.response.body = { ok: true };
    }

    @param('id', Types.ObjectId)
    async postOpen(domainId: string, id: ObjectId) {
        await reopenRequest(domainId, id, this.user, Number(this.request.body.revision));
        await OplogModel.log(this, 'collect.signing.open', { requestId: String(id) });
        this.response.body = { ok: true };
    }

    @param('id', Types.ObjectId)
    @param('studentRecordId', Types.ObjectId)
    async postReopen(domainId: string, id: ObjectId, studentRecordId: ObjectId) {
        await reopenStudentSigning(domainId, id, this.user, studentRecordId);
        await OplogModel.log(this, 'collect.signing.reopen-student', { requestId: String(id), studentRecordId: String(studentRecordId) });
        this.response.body = { ok: true };
    }

    @param('id', Types.ObjectId)
    async postCopy(domainId: string, id: ObjectId) {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        const source = await signingRequest(domainId, id);
        const created = await createRequest(
            domainId,
            this.user._id,
            {
                kind: 'signing',
                title: `${source.title}（副本）`,
                description: source.description,
                schoolId: String(source.schoolId),
                groupIds: source.groupIds.map(String),
                dueAt: new Date(Date.now() + 7 * 86400000),
            },
            this.user,
        );
        const configured = await setCollaborators(domainId, created._id, this.user, created.revision, source.collaboratorUids);
        if (source.signing) await copySigningDocument(domainId, created._id, this.user, configured.revision, source.signing);
        await OplogModel.log(this, 'collect.signing.copy', { requestId: String(id), copyId: String(created._id) });
        this.response.body = { redirect: this.url('admin_collect_sign', { id: created._id }) };
    }

    @param('id', Types.ObjectId)
    async postNudge(domainId: string, id: ObjectId) {
        const request = await signingRequest(domainId, id);
        const uids = await nudgeUnsubmitted(request, this.user);
        if (uids.length) {
 await MessageModel.send(
                this.user._id,
                uids,
                `请完成知情书签署：${request.title}\n${this.url('collect_sign', { id })}`,
                MessageModel.FLAG_UNREAD,
            );
}
        await OplogModel.log(this, 'collect.signing.nudge', { requestId: String(id), recipients: uids.length });
        this.response.body = { ok: true };
    }
}

class SigningPreviewHandler extends SigningPrivateHandler {
    @param('id', Types.ObjectId)
    async post(domainId: string, id: ObjectId) {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        const request = await signingRequest(domainId, id);
        if (!request.signing) throw new CollectNotFoundError();
        const fields = parseSigningFields(fieldsValue(this.request.body.fields) || request.signing.fields, request.signing.pages);
        const signature = cleanSignature(this.request.body.signature);
        this.response.type = 'application/pdf';
        this.response.addHeader('Cache-Control', 'private, no-store');
        this.response.body = await withSigningWorker(async () =>
            renderSignedPdf(
                await readSigningAsset(request.signing.pdf),
                await readSigningAsset(request.signing.font),
                fields,
                { studentId: '202600000001', realName: '签署示例' },
                new Date(),
                signature,
            ),
        );
    }
}

export function applySigningHandlers(ctx: Context) {
    ctx.Route('collect_sign', '/collect/:id/sign', CollectSigningHandler);
    ctx.Route('collect_sign_source', '/collect/:id/sign/source', SigningSourceHandler);
    ctx.Route('admin_collect_sign_new', '/admin/collect/sign/new', AdminSigningHandler);
    ctx.Route('admin_collect_sign', '/admin/collect/:id/sign', AdminSigningHandler);
    ctx.Route('admin_collect_sign_file', '/admin/collect/:id/sign/file/:fileId', SigningFileHandler);
    ctx.Route('admin_collect_sign_preview', '/admin/collect/:id/sign/preview', SigningPreviewHandler);
}
