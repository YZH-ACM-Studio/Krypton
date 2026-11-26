import { randomUUID } from 'node:crypto';
import { ObjectId, PRIV, StorageModel } from 'hydrooj';
import { canViewCollect } from './auth';
import { filesColl, requestsColl, submissionsColl } from './db';
import { CollectClosedError, CollectFileRejectedError, CollectForbiddenError, CollectNotFoundError, CollectRevisionConflictError } from './errors';
import { collectRequestLockKey, withCollectLock } from './lock';
import { getRequest, resolveSigningAudience, studentMatchesAudience, userbindOrThrow, type CollectActor } from './model';
import { sanitizeZipPart } from './name-format';
import { cleanSignature, prepareSigningPdf, renderSignedPdf, sha256, signingFont, validateSigningTextLayout, withSigningWorker } from './signing-pdf';
import { assertSigningDocumentReady, parseSigningFields, signingFingerprint, signingRoundOpen } from './signing-protocol';
import { collectKind, type CollectRequestDoc, type CollectSubmissionDoc } from './types';
import type { SigningAsset, SigningDocument, SigningIdentity } from './signing-types';

function admin(actor: CollectActor) {
    if (!actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) throw new CollectForbiddenError('只有系统管理员可以管理签署文档');
}
export async function signingRequest(domainId: string, id: ObjectId | string) {
    const request = await getRequest(domainId, id);
    if (collectKind(request) !== 'signing') throw new CollectNotFoundError();
    return request;
}
const studentLock = (request: CollectRequestDoc, recordId: ObjectId) => `collect:${request.domainId}:${request._id}:student:${recordId}`;

export async function readSigningAsset(asset: SigningAsset): Promise<Buffer> {
    const stream = await StorageModel.get(asset.storagePath);
    if (!stream) throw new Error(`Signing asset missing: ${asset.storagePath}`);
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of stream) {
        const bytes = Buffer.from(chunk);
        length += bytes.length;
        if (length > asset.size) {
            stream.destroy();
            throw new Error('Signing asset size mismatch');
        }
        chunks.push(bytes);
    }
    const result = Buffer.concat(chunks);
    if (length !== asset.size || sha256(result) !== asset.sha256) throw new Error('Signing asset checksum mismatch');
    return result;
}

async function putAsset(path: string, bytes: Buffer, uid: number): Promise<SigningAsset> {
    const asset = { storagePath: path, sha256: sha256(bytes), size: bytes.length };
    if (await StorageModel.getMeta(path)) await readSigningAsset(asset);
    else {
        await StorageModel.put(path, bytes, uid);
        await readSigningAsset(asset);
    }
    return asset;
}

async function writeDocument(
    domainId: string,
    id: ObjectId,
    actor: CollectActor,
    revision: number,
    transform: (request: CollectRequestDoc) => Promise<SigningDocument>,
) {
    admin(actor);
    return withCollectLock(collectRequestLockKey(domainId, String(id)), async () => {
        const request = await signingRequest(domainId, id);
        if (request.status !== 'draft' || request.publishedAt) throw new CollectForbiddenError('已发布文档和签署位置不能修改，请复制为新活动');
        if (revision !== request.revision) throw new CollectRevisionConflictError();
        const document = await transform(request);
        const result = await requestsColl.updateOne(
            { domainId, _id: id, revision, status: 'draft' },
            {
                $set: { signing: document, updatedAt: new Date() },
                $inc: { revision: 1 },
            },
        );
        if (result.modifiedCount !== 1) throw new CollectRevisionConflictError();
        return document;
    });
}

export async function uploadSigningSource(
    domainId: string,
    id: ObjectId,
    actor: CollectActor,
    revision: number,
    source: Buffer,
    originalName: string,
) {
    return writeDocument(domainId, id, actor, revision, async () =>
        withSigningWorker(async () => {
            const ext = originalName.split('.').pop()?.toLowerCase();
            if (ext !== 'pdf' && ext !== 'docx') throw new CollectFileRejectedError('只接受 PDF 或 DOCX 文档');
            const prepared = await prepareSigningPdf(source, ext);
            const prefix = `collect/${domainId}/${id}/signing/source/${randomUUID()}`;
            const fontBytes = await signingFont();
            const font = await withCollectLock('collect:signing:font', () =>
                putAsset(`collect/signing-fonts/${sha256(fontBytes)}.ttf`, fontBytes, actor._id),
            );
            const sourceAsset = await putAsset(`${prefix}.${ext}`, source, actor._id);
            const pdf = ext === 'pdf' ? sourceAsset : await putAsset(`${prefix}.pdf`, prepared.bytes, actor._id);
            const document: SigningDocument = {
                source: { ...sourceAsset, ext, originalName },
                pdf,
                font,
                pages: prepared.pages,
                fields: [],
                fingerprint: '',
                confirmedFingerprint: null,
            };
            document.fingerprint = signingFingerprint(document);
            console.info('[collect-signing] source-prepared', {
                domainId,
                requestId: String(id),
                actorUid: actor._id,
                pages: document.pages.length,
                fingerprint: document.fingerprint,
            });
            return document;
        }),
    );
}

export async function copySigningDocument(domainId: string, id: ObjectId, actor: CollectActor, revision: number, document: SigningDocument) {
    return writeDocument(domainId, id, actor, revision, async () => ({ ...document, confirmedFingerprint: null }));
}

export async function validateSigningDocumentForAudience(document: SigningDocument, audience: Pick<SigningIdentity, 'studentId' | 'realName'>[]) {
    await withSigningWorker(async () => {
        const [source, font] = await Promise.all([readSigningAsset(document.pdf), readSigningAsset(document.font)]);
        await validateSigningTextLayout(source, font, document.fields, audience);
    });
}

export async function confirmSigningFields(domainId: string, id: ObjectId, actor: CollectActor, revision: number, fields: unknown) {
    return writeDocument(domainId, id, actor, revision, async (request) => {
        if (!request.signing) throw new CollectFileRejectedError('请先上传知情书');
        const document = { ...request.signing, fields: parseSigningFields(fields, request.signing.pages) };
        await validateSigningDocumentForAudience(document, await resolveSigningAudience(domainId, request.schoolId, request.groupIds));
        document.fingerprint = signingFingerprint(document);
        document.confirmedFingerprint = document.fingerprint;
        assertSigningDocumentReady(document);
        return document;
    });
}

export async function signingStudent(request: CollectRequestDoc, actor: CollectActor): Promise<SigningIdentity> {
    if (actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || canViewCollect(actor, request)) { throw new CollectForbiddenError('管理员和协作者只能预览，不能提交正式签名'); }
    if (request.status !== 'published' || request.dueAt.getTime() <= Date.now()) throw new CollectClosedError();
    const student = await (await userbindOrThrow()).findStudentByUserId(request.domainId, actor._id);
    if (!student || student.boundUserId !== actor._id || !studentMatchesAudience(student, request)) { throw new CollectForbiddenError('当前绑定身份不在本次签署名单内'); }
    if (!student.studentId?.trim() || !student.realName?.trim()) throw new CollectFileRejectedError('花名册缺少姓名或学号，请联系管理员');
    return { studentRecordId: student._id, schoolId: student.schoolId, uid: actor._id, studentId: student.studentId, realName: student.realName };
}

export async function ownSigningSubmission(request: CollectRequestDoc, uid: number): Promise<CollectSubmissionDoc | null> {
    const student = await (await userbindOrThrow()).findStudentByUserId(request.domainId, uid);
    return submissionsColl.findOne({
        domainId: request.domainId,
        requestId: request._id,
        kind: 'signing',
        ...(student ? { studentRecordId: student._id } : { uid }),
    });
}

async function completedSigningResult(submission: CollectSubmissionDoc, attemptId: string, png: unknown, acceptedFileId?: string) {
    const fileId = acceptedFileId || submission.currentFiles[0]?.fileId;
    const file = fileId && await filesColl.findOne({ domainId: submission.domainId, requestId: submission.requestId, fileId });
    if (!file?.signing || !submission.signing.acceptedFileIds?.includes(fileId)) throw new Error('Signed submission has no accepted file');
    if (file.signing.attemptId === attemptId && png && sha256(cleanSignature(png)) !== file.signing.inputHash) {
        throw new CollectFileRejectedError('同一签署请求不能更换笔迹');
    }
    return { signedAt: file.signing.signedAt, alreadySigned: true };
}

async function acceptedAttemptResult(submission: CollectSubmissionDoc, attemptId: string, png: unknown) {
    if (!submission.signing.acceptedFileIds?.length) return null;
    const file = await filesColl.findOne({ domainId: submission.domainId, requestId: submission.requestId,
        fileId: { $in: submission.signing.acceptedFileIds }, 'signing.attemptId': attemptId });
    return file ? completedSigningResult(submission, attemptId, png, file.fileId) : null;
}

export async function submitSignature(domainId: string, id: ObjectId, actor: CollectActor, attemptId: unknown, png: unknown, generation: unknown) {
    if (typeof attemptId !== 'string' || !/^[a-f0-9-]{36}$/.test(attemptId)) throw new CollectFileRejectedError('签署请求编号不正确');
    const request = await signingRequest(domainId, id);
    if (actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || canViewCollect(actor, request)) throw new CollectForbiddenError('管理员和协作者不能提交正式签名');
    const existing = await ownSigningSubmission(request, actor._id);
    const accepted = existing?.signing && await acceptedAttemptResult(existing, attemptId, png);
    if (accepted) return accepted;
    if (existing?.signing && !signingRoundOpen(existing.signing)) return completedSigningResult(existing, attemptId, png);
    const identity = await signingStudent(request, actor);
    return withCollectLock(studentLock(request, identity.studentRecordId), async () =>
        withSigningWorker(async () => {
            const currentRequest = await signingRequest(domainId, id);
            const currentIdentity = await signingStudent(currentRequest, actor);
            if (!currentIdentity.studentRecordId.equals(identity.studentRecordId)) { throw new CollectForbiddenError('绑定身份已变化，请重新打开签署页面'); }
            assertSigningDocumentReady(currentRequest.signing);
            let sub = await submissionsColl.findOne({ domainId, requestId: id, studentRecordId: identity.studentRecordId, kind: 'signing' });
            if (!sub) {
                if (await submissionsColl.findOne({ domainId, requestId: id, uid: actor._id })) { throw new CollectForbiddenError('本账号已有另一身份的签署记录，请联系管理员'); }
                const now = new Date();
                sub = {
                    _id: new ObjectId(),
                    domainId,
                    requestId: id,
                    kind: 'signing',
                    studentRecordId: identity.studentRecordId,
                    uid: actor._id,
                    status: 'draft',
                    submittedAt: null,
                    currentFiles: [],
                    createdAt: now,
                    updatedAt: now,
                    signing: { generation: 0, signedGeneration: null, acceptedFileIds: [] },
                };
                await submissionsColl.insertOne(sub);
            }
            const completed = await acceptedAttemptResult(sub, attemptId, png);
            if (completed) return completed;
            if (!signingRoundOpen(sub.signing)) return completedSigningResult(sub, attemptId, png);
            if (!Number.isSafeInteger(generation) || generation !== sub.signing.generation) {
                throw new CollectFileRejectedError('签署轮次已变化，请刷新页面后继续');
            }
            let attempt = sub.signing.attempt;
            if (attempt && attempt.attemptId !== attemptId) throw new CollectFileRejectedError('已有未完成的签署，请刷新后继续归档');
            const signature = png ? cleanSignature(png) : attempt ? Buffer.from(attempt.signaturePng, 'base64') : cleanSignature(png);
            const inputHash = sha256(signature);
            if (attempt) {
                if (
                    attempt.inputHash !== inputHash ||
                    attempt.documentFingerprint !== currentRequest.signing.fingerprint ||
                    attempt.identity.uid !== actor._id ||
                    attempt.identity.studentId !== currentIdentity.studentId ||
                    attempt.identity.realName !== currentIdentity.realName ||
                    attempt.generation !== sub.signing.generation
                ) {
                    throw new CollectFileRejectedError('签署内容或身份已变化，请联系管理员重新开放签署');
                }
            } else {
                attempt = {
                    attemptId,
                    inputHash,
                    fileId: randomUUID(),
                    generation: sub.signing.generation,
                    identity: currentIdentity,
                    documentFingerprint: currentRequest.signing.fingerprint,
                    signedAt: new Date(),
                    signaturePng: signature.toString('base64'),
                };
                const reserved = await submissionsColl.updateOne(
                    { _id: sub._id, 'signing.generation': attempt.generation, 'signing.attempt': { $exists: false } },
                    { $set: { 'signing.attempt': attempt } },
                );
                if (reserved.modifiedCount !== 1) throw new CollectRevisionConflictError();
            }
            console.info('[collect-signing] attempt', { domainId, requestId: String(id), uid: actor._id, attemptId, generation: attempt.generation });
            const path = `collect/${domainId}/${id}/signing/results/${attempt.fileId}.pdf`;
            let file = await filesColl.findOne({ domainId, fileId: attempt.fileId });
            let bytes: Buffer;
            const meta = await StorageModel.getMeta(path);
            if (meta && attempt.outputHash) bytes = await readSigningAsset({ storagePath: path, sha256: attempt.outputHash, size: meta.size });
            else {
                const [source, font] = await Promise.all([
                    readSigningAsset(currentRequest.signing.pdf),
                    readSigningAsset(currentRequest.signing.font),
                ]);
                bytes = await renderSignedPdf(source, font, currentRequest.signing.fields, attempt.identity, attempt.signedAt, signature);
                const hash = sha256(bytes);
                if (attempt.outputHash && attempt.outputHash !== hash) throw new Error('Signing retry produced a different PDF');
                if (!attempt.outputHash) {
                    const persisted = await submissionsColl.updateOne(
                        { _id: sub._id, 'signing.attempt.attemptId': attemptId, 'signing.generation': attempt.generation },
                        { $set: { 'signing.attempt.outputHash': hash } },
                    );
                    if (persisted.modifiedCount !== 1) throw new CollectRevisionConflictError();
                    attempt.outputHash = hash;
                }
                await putAsset(path, bytes, actor._id);
            }
            if (file && (file.sha256 !== attempt.outputHash || file.signing?.attemptId !== attemptId || file.signing?.inputHash !== inputHash)) { throw new Error('Signing file metadata conflict'); }
            if (!file) {
                const previous = await filesColl.find({ domainId, submissionId: sub._id }).sort({ version: -1 }).limit(1).toArray();
                const version = (previous[0]?.version || 0) + 1;
                const { signaturePng: _signaturePng, outputHash: _outputHash, fileId, ...snapshot } = attempt;
                file = {
                    _id: new ObjectId(),
                    domainId,
                    requestId: id,
                    submissionId: sub._id,
                    uid: sub.uid,
                    slotId: 'signature',
                    fileId,
                    storagePath: path,
                    originalName: `${sanitizeZipPart(attempt.identity.studentId)}_${sanitizeZipPart(attempt.identity.realName)}_v${version}.pdf`,
                    size: bytes.length,
                    sha256: attempt.outputHash,
                    ext: 'pdf',
                    version,
                    current: false,
                    createdAt: attempt.signedAt,
                    signing: snapshot,
                };
                await filesColl.insertOne(file);
            }
            await withCollectLock(collectRequestLockKey(domainId, String(id)), async () => {
                const latest = await signingRequest(domainId, id);
                const latestIdentity = await signingStudent(latest, actor);
                if (
                    !latestIdentity.studentRecordId.equals(identity.studentRecordId) ||
                    latestIdentity.studentId !== attempt.identity.studentId ||
                    latestIdentity.realName !== attempt.identity.realName ||
                    latest.signing?.fingerprint !== attempt.documentFingerprint
                ) { throw new CollectRevisionConflictError(); }
                const committed = await submissionsColl.updateOne(
                    { _id: sub._id, 'signing.generation': attempt.generation, 'signing.attempt.attemptId': attemptId },
                    {
                        $set: {
                            status: 'submitted',
                            submittedAt: attempt.signedAt,
                            updatedAt: new Date(),
                            'signing.signedGeneration': attempt.generation,
                            currentFiles: [
                                {
                                    slotId: file.slotId,
                                    fileId: file.fileId,
                                    originalName: file.originalName,
                                    size: file.size,
                                    sha256: file.sha256,
                                    ext: 'pdf',
                                },
                            ],
                        },
                        $addToSet: { 'signing.acceptedFileIds': file.fileId },
                        $unset: { 'signing.attempt': '' },
                    },
                );
                if (committed.modifiedCount !== 1) throw new CollectRevisionConflictError();
            });
            // Signing exports use the accepted pointers above; this flag is only for legacy collection displays.
            await filesColl.updateMany({ domainId, submissionId: sub._id }, { $set: { current: false } });
            await filesColl.updateOne({ domainId, fileId: file.fileId }, { $set: { current: true } });
            console.info('[collect-signing] committed', {
                domainId,
                requestId: String(id),
                uid: actor._id,
                attemptId,
                outputHash: attempt.outputHash,
            });
            return { signedAt: attempt.signedAt, alreadySigned: false };
        }),
    );
}

export async function reopenStudentSigning(domainId: string, id: ObjectId, actor: CollectActor, studentRecordId: ObjectId) {
    admin(actor);
    const request = await signingRequest(domainId, id);
    await withCollectLock(studentLock(request, studentRecordId), async () => {
        const sub = await submissionsColl.findOne({ domainId, requestId: id, studentRecordId, kind: 'signing' });
        if (!sub?.signing) throw new CollectNotFoundError();
        const updated = await submissionsColl.updateOne(
            { _id: sub._id, 'signing.generation': sub.signing.generation },
            {
                $inc: { 'signing.generation': 1 },
                $unset: { 'signing.attempt': '' },
                $set: { updatedAt: new Date() },
            },
        );
        if (updated.modifiedCount !== 1) throw new CollectRevisionConflictError();
    });
}

export async function signingProgress(request: CollectRequestDoc) {
    const [audience, submissions] = await Promise.all([
        resolveSigningAudience(request.domainId, request.schoolId, request.groupIds),
        submissionsColl.find({ domainId: request.domainId, requestId: request._id, kind: 'signing' }).toArray(),
    ]);
    const byStudent = new Map(submissions.map((sub) => [String(sub.studentRecordId), sub]));
    const members = new Set(audience.map((student) => String(student._id)));
    const activityGroups = new Set(request.groupIds.map(String));
    const acceptedIds = submissions.flatMap((sub) => sub.signing?.acceptedFileIds || []);
    const files = acceptedIds.length
        ? await filesColl
              .find({ domainId: request.domainId, requestId: request._id, fileId: { $in: acceptedIds } })
              .sort({ version: -1 })
              .toArray()
        : [];
    const rows = audience.map((student) => {
        const sub = byStudent.get(String(student._id));
        return {
            studentRecordId: String(student._id),
            studentId: student.studentId,
            realName: student.realName,
            uid: student.boundUserId,
            groupIds: student.groupIds.map(String).filter((id) => activityGroups.has(id)),
            status:
                sub?.currentFiles.length && sub.signing?.acceptedFileIds?.includes(sub.currentFiles[0].fileId)
                    ? 'signed'
                    : sub?.signing?.attempt
                      ? 'pending'
                      : student.boundUserId
                        ? 'unsigned'
                        : 'unbound',
            signedAt: sub?.submittedAt || null,
            resignAllowed: !!sub?.currentFiles.length && signingRoundOpen(sub.signing),
            currentFileId: sub?.currentFiles[0]?.fileId || null,
        };
    });
    return {
        rows,
        files: files.map((file) => ({
            fileId: file.fileId,
            filename: file.originalName,
            studentRecordId: String(file.signing.identity.studentRecordId),
            studentId: file.signing.identity.studentId,
            realName: file.signing.identity.realName,
            signedAt: file.signing.signedAt,
            version: file.version,
            current: submissions.some((sub) => sub.currentFiles.some((ref) => ref.fileId === file.fileId)),
            left: !members.has(String(file.signing.identity.studentRecordId)),
        })),
    };
}

export async function acceptedSigningFile(domainId: string, id: ObjectId, actor: CollectActor, fileId: string) {
    const request = await signingRequest(domainId, id);
    if (!canViewCollect(actor, request)) throw new CollectForbiddenError('无权下载签署文件');
    const file = await filesColl.findOne({ domainId, requestId: id, fileId });
    if (!file || !(await submissionsColl.findOne({ domainId, requestId: id, 'signing.acceptedFileIds': fileId }))) throw new CollectNotFoundError();
    await readSigningAsset({ storagePath: file.storagePath, sha256: file.sha256, size: file.size });
    return file;
}
