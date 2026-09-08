/**
 * Canonical write path for file collections.
 *
 * Handlers own oplog and messaging. This module does not log filenames
 * and does not send 站内信.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { nanoid, ObjectId, StorageModel, UserModel } from 'hydrooj';
import type { Filter } from 'mongodb';
import { canCreateCollect, canEditCollect, canManageAllCollect, canViewCollect } from './auth';
import { filesColl, requestsColl, submissionsColl } from './db';
import {
    CollectAudienceEmptyError,
    CollectClosedError,
    CollectFileRejectedError,
    CollectForbiddenError,
    CollectNotFoundError,
    CollectNudgeRateError,
    CollectRevisionConflictError,
    CollectSlotLockedError,
} from './errors';
import { assertUploadAllowed } from './file-validate';
import { collectRequestLockKey, collectUserLockKey, withCollectLock } from './lock';
import {
    dedupePackNames,
    missingOriginalName,
    parseFileNameTemplate,
    parsePackLayout,
    renderAssignedFileName,
    renderPackEntryName,
    requestFileNameTemplate,
    requestPackLayout,
    slotPreviewExt,
} from './name-format';
import { zipStudentFolder } from './pack-format';
import {
    COLLECT_ALLOWED_EXTS,
    COLLECT_HARD_MAX_FILE_BYTES,
    COLLECT_HARD_MAX_FILES,
    COLLECT_HARD_MAX_TOTAL_BYTES,
    COLLECT_NUDGE_COOLDOWN_MS,
    requiredSlotsFilled,
    storagePath,
    type CollectAllowedExt,
    type CollectCourseRef,
    type CollectCurrentFileRef,
    type CollectFileDoc,
    type CollectRequestDoc,
    type CollectSlot,
    type CollectSubmissionDoc,
} from './types';

export interface CollectActor {
    _id: number;
    hasPerm(perm: bigint): boolean;
    hasPriv(priv: number): boolean;
}

export interface CollectBoundStudent {
    schoolId: ObjectId;
    groupIds: ObjectId[];
    boundUserId: number;
    studentId: string;
    realName: string;
}

interface UserbindStudentRecord {
    schoolId?: ObjectId;
    groupIds?: ObjectId[];
    boundUserId?: number | null;
    studentId?: string;
    realName?: string;
}

interface UserbindGroupRecord {
    _id: ObjectId;
    schoolId: ObjectId;
}

export interface CollectUserbind {
    findStudentByUserId(domainId: string, userId: number): Promise<UserbindStudentRecord | null>;
    findBoundStudentsByGroupIds(domainId: string, groupIds: ObjectId[]): Promise<UserbindStudentRecord[]>;
    listSchools?(domainId: string): Promise<Array<{ _id: ObjectId; name: string }>>;
    listUserGroups?(domainId: string, schoolId?: ObjectId): Promise<UserbindGroupRecord[]>;
    getUserGroup?(domainId: string, id: ObjectId): Promise<UserbindGroupRecord | null>;
    findStudentsByUserIds?(domainId: string, userIds: number[]): Promise<Record<string, { studentId?: string; realName?: string }>>;
}

export interface CreateCollectRequestInput {
    schoolId: ObjectId | string;
    groupIds?: Array<ObjectId | string>;
    title: string;
    description?: string;
    slots?: unknown;
    dueAt: Date | string;
    maxFileBytes?: number;
    maxTotalBytes?: number;
    maxFiles?: number;
    fileNameTemplate?: string;
    packLayout?: 'nested' | 'flat';
    courseRef?: { courseId: ObjectId | string; chapterId: number } | null;
}

export interface UpdateCollectRequestPatch {
    title?: string;
    description?: string;
    dueAt?: Date | string;
    slots?: unknown;
    schoolId?: ObjectId | string;
    groupIds?: Array<ObjectId | string>;
    maxFileBytes?: number;
    maxTotalBytes?: number;
    maxFiles?: number;
    fileNameTemplate?: string;
    packLayout?: 'nested' | 'flat';
    courseRef?: { courseId: ObjectId | string; chapterId: number } | null;
}

export interface PutStudentFileInput {
    request: CollectRequestDoc;
    uid: number;
    slotId: string;
    originalName: string;
    size: number;
    bytes?: Buffer | Uint8Array;
    tempPath?: string;
    sha256?: string;
}

export interface AddFileMetaInput extends PutStudentFileInput {
    fileId: string;
    storagePath: string;
}

export interface ReplaceFileInput extends PutStudentFileInput {
    fileId: string;
}

export interface CollectProgressFile extends CollectCurrentFileRef {
    duplicateCount: number;
    duplicateStudentIds: string[];
}

export interface CollectProgressRow {
    uid: number;
    studentId: string;
    realName: string;
    status: CollectSubmissionDoc['status'] | 'missing';
    submittedAt: Date | null;
    currentFiles: CollectProgressFile[];
    leftGroup: boolean;
}

export interface CollectPackFileEntry {
    name: string;
    assignedName: string;
    uid: number;
    studentId: string;
    realName: string;
    slotId: string;
    slotTitle: string;
    fileId: string;
    originalName: string;
    size: number;
    sha256: string;
    ext: CollectAllowedExt;
    leftGroup: boolean;
}

export interface CollectPackMissing {
    uid: number;
    studentId: string;
    realName: string;
}

export interface CollectExpectedMissingRow {
    studentId: string;
    realName: string;
    uid: number;
    slotTitle: string;
    assignedName: string;
}

export interface CollectSubmittedCsvRow {
    studentId: string;
    realName: string;
    uid: number;
    slotTitle: string;
    assignedName: string;
    originalName: string;
    sha256: string;
    size: number;
}

export interface CollectNameIdentity {
    uid: number;
    studentId?: string;
    realName?: string;
}

interface HydroGlobal {
    Hydro?: {
        model?: {
            userbind?: unknown;
        };
    };
}

const SLOT_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const FILE_ID_RE = /^[A-Za-z0-9_-]{8,32}$/;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 20000;
const COLLABORATOR_MAX = 50;

function rejectFile(message: string): never {
    throw new CollectFileRejectedError(message);
}

function hydroModels(): { userbind?: unknown } {
    const model = (globalThis as HydroGlobal).Hydro?.model;
    if (!model) throw new TypeError('Hydro.model is unavailable');
    return model;
}

export async function userbindOrThrow(): Promise<CollectUserbind> {
    const userbind = hydroModels().userbind;
    if (!userbind || typeof userbind !== 'object') {
        throw new TypeError('userbind.findStudentByUserId or findBoundStudentsByGroupIds is unavailable');
    }
    const bridge = userbind as CollectUserbind;
    if (typeof bridge.findStudentByUserId !== 'function' || typeof bridge.findBoundStudentsByGroupIds !== 'function') {
        throw new TypeError('userbind.findStudentByUserId or findBoundStudentsByGroupIds is unavailable');
    }
    return bridge;
}

function assertDomainId(domainId: string): void {
    if (typeof domainId !== 'string' || !domainId) throw new TypeError('domainId must be a non-empty string');
}

function oidEquals(left: ObjectId | string, right: ObjectId | string): boolean {
    return String(left) === String(right);
}

function asObjectId(value: unknown, field: string): ObjectId {
    if (value instanceof ObjectId) return value;
    if (typeof value === 'string' && OBJECT_ID_RE.test(value)) return new ObjectId(value);
    throw new CollectFileRejectedError(`${field} 不合法`);
}

function asObjectIdList(value: unknown, field: string): ObjectId[] {
    if (value == null) return [];
    if (!Array.isArray(value)) throw new CollectFileRejectedError(`${field} 不合法`);
    const out: ObjectId[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        const id = asObjectId(item, field);
        const key = String(id);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(id);
    }
    return out;
}

function asTitle(value: unknown): string {
    if (typeof value !== 'string') rejectFile('标题不合法');
    const title = value.trim();
    if (!title) rejectFile('标题不能为空');
    if (title.length > TITLE_MAX) rejectFile('标题过长');
    return title;
}

function asDescription(value: unknown): string {
    if (value == null) return '';
    if (typeof value !== 'string') rejectFile('说明不合法');
    if (value.length > DESCRIPTION_MAX) rejectFile('说明过长');
    return value;
}

export function parseCollectDueAt(value: unknown): Date {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) rejectFile('截止时间不合法');
        return value;
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const dueAt = new Date(value);
        if (Number.isNaN(dueAt.getTime())) rejectFile('截止时间不合法');
        return dueAt;
    }
    rejectFile('截止时间不合法');
}

function asQuota(value: unknown, field: string, min: number, max: number, fallback: number): number {
    if (value == null) return fallback;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        rejectFile(`${field} 超出允许范围`);
    }
    return value;
}

export function normalizeCollectQuotas(input: {
    maxFileBytes?: unknown;
    maxTotalBytes?: unknown;
    maxFiles?: unknown;
}): { maxFileBytes: number; maxTotalBytes: number; maxFiles: number } {
    const maxFileBytes = asQuota(input.maxFileBytes, 'maxFileBytes', 1, COLLECT_HARD_MAX_FILE_BYTES, COLLECT_HARD_MAX_FILE_BYTES);
    const maxTotalBytes = asQuota(input.maxTotalBytes, 'maxTotalBytes', 1, COLLECT_HARD_MAX_TOTAL_BYTES, COLLECT_HARD_MAX_TOTAL_BYTES);
    const maxFiles = asQuota(input.maxFiles, 'maxFiles', 1, COLLECT_HARD_MAX_FILES, COLLECT_HARD_MAX_FILES);
    if (maxTotalBytes < maxFileBytes) rejectFile('合计大小不能小于单文件上限');
    return { maxFileBytes, maxTotalBytes, maxFiles };
}

function newSlotId(used: Set<string>): string {
    for (let i = 0; i < 8; i += 1) {
        const id = randomBytes(4).toString('hex');
        if (!used.has(id)) return id;
    }
    throw new TypeError('failed to allocate a unique slot id');
}

function asAllowedExts(value: unknown): CollectAllowedExt[] {
    if (!Array.isArray(value) || !value.length) rejectFile('槽位扩展名不合法');
    const out: CollectAllowedExt[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (typeof item !== 'string') rejectFile('槽位扩展名不合法');
        const ext = item.trim().toLowerCase() === 'jpeg' ? 'jpg' : item.trim().toLowerCase();
        if (!(COLLECT_ALLOWED_EXTS as readonly string[]).includes(ext)) rejectFile('槽位扩展名不合法');
        if (seen.has(ext)) continue;
        seen.add(ext);
        out.push(ext as CollectAllowedExt);
    }
    if (!out.length) rejectFile('槽位扩展名不合法');
    return out;
}

export function normalizeCollectSlots(slots: unknown): CollectSlot[] {
    if (slots == null) return [];
    if (!Array.isArray(slots)) rejectFile('槽位不合法');
    const used = new Set<string>();
    const out: CollectSlot[] = [];
    for (const raw of slots) {
        if (!raw || typeof raw !== 'object') rejectFile('槽位不合法');
        const rec = raw as {
            id?: unknown;
            title?: unknown;
            required?: unknown;
            allowedExt?: unknown;
            maxFiles?: unknown;
        };
        if (typeof rec.title !== 'string') rejectFile('槽位标题不合法');
        const title = rec.title.trim();
        if (!title) rejectFile('槽位标题不能为空');
        let id: string;
        if (rec.id == null || rec.id === '') {
            id = newSlotId(used);
        } else if (typeof rec.id === 'string' && SLOT_ID_RE.test(rec.id)) {
            id = rec.id;
        } else {
            rejectFile('槽位编号不合法');
        }
        if (used.has(id)) rejectFile('槽位编号重复');
        used.add(id);
        if (rec.required != null && typeof rec.required !== 'boolean') rejectFile('槽位必填标记不合法');
        out.push({
            id,
            title,
            required: rec.required !== false,
            allowedExt: asAllowedExts(rec.allowedExt),
            maxFiles: asQuota(rec.maxFiles, 'slot.maxFiles', 1, COLLECT_HARD_MAX_FILES, 1),
        });
    }
    return out;
}

function parseCourseRef(value: unknown): CollectCourseRef | null {
    if (value == null) return null;
    if (typeof value !== 'object') rejectFile('课程引用不合法');
    const rec = value as { courseId?: unknown; chapterId?: unknown };
    if (!Number.isSafeInteger(rec.chapterId) || (rec.chapterId as number) < 0) rejectFile('课程章节不合法');
    return { courseId: asObjectId(rec.courseId, 'courseId'), chapterId: rec.chapterId as number };
}

function parseRequestId(id: ObjectId | string): ObjectId {
    if (id instanceof ObjectId) return id;
    if (typeof id === 'string' && OBJECT_ID_RE.test(id)) return new ObjectId(id);
    throw new CollectNotFoundError();
}

function sameSlotRules(left: CollectSlot[], right: CollectSlot[]): boolean {
    if (left.length !== right.length) return false;
    return left.every((slot, index) => {
        const other = right[index];
        return (
            slot.id === other.id
            && slot.title === other.title
            && slot.required === other.required
            && slot.maxFiles === other.maxFiles
            && slot.allowedExt.length === other.allowedExt.length
            && slot.allowedExt.every((ext, i) => ext === other.allowedExt[i])
        );
    });
}

function assertCanEdit(actor: CollectActor, request: CollectRequestDoc): void {
    if (!canEditCollect(actor, request)) throw new CollectForbiddenError('无权编辑此收集');
}

function assertCanView(actor: CollectActor, request: CollectRequestDoc): void {
    if (!canViewCollect(actor, request)) throw new CollectForbiddenError('无权查看此收集');
}

function assertMutable(request: CollectRequestDoc): void {
    if (request.status === 'archived') throw new CollectForbiddenError('已归档的收集不能修改');
}

function assertOpenWindow(request: CollectRequestDoc): void {
    if (request.status !== 'published' || Date.now() >= request.dueAt.getTime()) {
        throw new CollectClosedError();
    }
}

function assertSafeUid(uid: number): void {
    if (!Number.isSafeInteger(uid) || uid < 2) throw new CollectForbiddenError('不在收集名单中');
}

export function studentMatchesAudience(
    student: UserbindStudentRecord | null | undefined,
    request: Pick<CollectRequestDoc, 'schoolId' | 'groupIds'>,
): boolean {
    if (!student || student.schoolId == null) return false;
    if (student.boundUserId != null && student.boundUserId < 2) return false;
    if (!oidEquals(student.schoolId, request.schoolId)) return false;
    const want = new Set(request.groupIds.map(String));
    return (student.groupIds || []).some((id) => want.has(String(id)));
}

function boundUid(student: UserbindStudentRecord): number | null {
    if (!Number.isSafeInteger(student.boundUserId) || (student.boundUserId as number) < 2) return null;
    return student.boundUserId as number;
}

export async function resolveAudience(
    domainId: string,
    schoolId: ObjectId,
    groupIds: ObjectId[],
): Promise<CollectBoundStudent[]> {
    assertDomainId(domainId);
    const ub = await userbindOrThrow();
    if (!groupIds.length) return [];
    const bound = await ub.findBoundStudentsByGroupIds(domainId, groupIds);
    const seen = new Set<number>();
    const out: CollectBoundStudent[] = [];
    for (const student of bound) {
        const uid = boundUid(student);
        if (uid == null) continue;
        if (student.schoolId == null) {
            throw new TypeError('userbind student record is missing schoolId');
        }
        if (!oidEquals(student.schoolId, schoolId)) continue;
        if (seen.has(uid)) continue;
        seen.add(uid);
        out.push({
            schoolId: student.schoolId,
            groupIds: student.groupIds || [],
            boundUserId: uid,
            studentId: student.studentId || '',
            realName: student.realName || '',
        });
    }
    return out;
}

export async function isAudienceMember(
    domainId: string,
    uid: number,
    request: Pick<CollectRequestDoc, 'schoolId' | 'groupIds'>,
): Promise<boolean> {
    assertDomainId(domainId);
    if (!Number.isSafeInteger(uid) || uid < 2) return false;
    const ub = await userbindOrThrow();
    const student = await ub.findStudentByUserId(domainId, uid);
    return studentMatchesAudience(student, request);
}

async function assertGroupsBelongToSchool(domainId: string, schoolId: ObjectId, groupIds: ObjectId[]): Promise<void> {
    if (!groupIds.length) rejectFile('必须选择用户组');
    const ub = await userbindOrThrow();
    if (typeof ub.listUserGroups === 'function') {
        const groups = await ub.listUserGroups(domainId, schoolId);
        const allowed = new Set(groups.map((group) => String(group._id)));
        for (const id of groupIds) {
            if (!allowed.has(String(id))) rejectFile('所选用户组不属于该学校');
        }
        return;
    }
    if (typeof ub.getUserGroup !== 'function') {
        throw new TypeError('userbind.listUserGroups is unavailable');
    }
    for (const id of groupIds) {
        const group = await ub.getUserGroup(domainId, id);
        if (!group || !oidEquals(group.schoolId, schoolId)) rejectFile('所选用户组不属于该学校');
    }
}

async function loadRequest(domainId: string, id: ObjectId | string): Promise<CollectRequestDoc> {
    assertDomainId(domainId);
    const _id = parseRequestId(id);
    const doc = await requestsColl.findOne({ domainId, _id });
    if (!doc) throw new CollectNotFoundError();
    return doc;
}

async function withLockedRequest<T>(
    domainId: string,
    id: ObjectId | string,
    fn: (current: CollectRequestDoc) => Promise<T>,
): Promise<T> {
    const currentId = parseRequestId(id);
    return withCollectLock(collectRequestLockKey(domainId, String(currentId)), async () => {
        const current = await loadRequest(domainId, currentId);
        return fn(current);
    });
}

async function casRequest(
    domainId: string,
    id: ObjectId,
    expectedRevision: number,
    set: Partial<CollectRequestDoc>,
    expectedStatus?: CollectRequestDoc['status'] | CollectRequestDoc['status'][],
): Promise<CollectRequestDoc> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw new CollectRevisionConflictError();
    }
    const filter: Filter<CollectRequestDoc> = { domainId, _id: id, revision: expectedRevision };
    if (typeof expectedStatus === 'string') filter.status = expectedStatus;
    else if (Array.isArray(expectedStatus)) filter.status = { $in: expectedStatus };
    const result = await requestsColl.updateOne(
        filter,
        { $set: { ...set, revision: expectedRevision + 1, updatedAt: new Date() } },
    );
    if (result.matchedCount !== 1) {
        const existing = await requestsColl.findOne({ domainId, _id: id });
        if (!existing) throw new CollectNotFoundError();
        throw new CollectRevisionConflictError();
    }
    return loadRequest(domainId, id);
}

async function hasSubmittedRow(domainId: string, requestId: ObjectId): Promise<boolean> {
    const row = await submissionsColl.findOne({ domainId, requestId, status: 'submitted' });
    return !!row;
}

function isDuplicateKey(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 11000;
}

export async function createRequest(
    domainId: string,
    actorUid: number,
    input: CreateCollectRequestInput,
): Promise<CollectRequestDoc> {
    assertDomainId(domainId);
    if (!Number.isSafeInteger(actorUid) || actorUid < 2) throw new CollectForbiddenError('无权创建收集');
    const now = new Date();
    const quotas = normalizeCollectQuotas(input);
    const doc: CollectRequestDoc = {
        _id: new ObjectId(),
        domainId,
        ownerUid: actorUid,
        collaboratorUids: [],
        schoolId: asObjectId(input.schoolId, 'schoolId'),
        groupIds: asObjectIdList(input.groupIds, 'groupIds'),
        title: asTitle(input.title),
        description: asDescription(input.description),
        slots: normalizeCollectSlots(input.slots),
        dueAt: parseCollectDueAt(input.dueAt),
        status: 'draft',
        revision: 1,
        maxFileBytes: quotas.maxFileBytes,
        maxTotalBytes: quotas.maxTotalBytes,
        maxFiles: quotas.maxFiles,
        fileNameTemplate: parseFileNameTemplate(input.fileNameTemplate),
        packLayout: parsePackLayout(input.packLayout),
        courseRef: parseCourseRef(input.courseRef),
        createdAt: now,
        updatedAt: now,
        publishedAt: null,
        closedAt: null,
        archivedAt: null,
        lastNudgeAt: null,
        lastNudgeBy: 0,
    };
    await requestsColl.insertOne(doc);
    return doc;
}

export async function getRequest(domainId: string, id: ObjectId | string): Promise<CollectRequestDoc> {
    return loadRequest(domainId, id);
}

export async function updateRequest(
    domainId: string,
    id: ObjectId | string,
    actor: CollectActor,
    expectedRevision: number,
    patch: UpdateCollectRequestPatch,
): Promise<CollectRequestDoc> {
    return withLockedRequest(domainId, id, async (current) => {
        assertCanEdit(actor, current);
        assertMutable(current);
        const set: Partial<CollectRequestDoc> = {};
        if (patch.title !== undefined) set.title = asTitle(patch.title);
        if (patch.description !== undefined) set.description = asDescription(patch.description);
        if (patch.dueAt !== undefined) set.dueAt = parseCollectDueAt(patch.dueAt);
        if (patch.schoolId !== undefined) set.schoolId = asObjectId(patch.schoolId, 'schoolId');
        if (patch.groupIds !== undefined) set.groupIds = asObjectIdList(patch.groupIds, 'groupIds');
        if (patch.courseRef !== undefined) set.courseRef = parseCourseRef(patch.courseRef);

        const nextSlots = patch.slots !== undefined ? normalizeCollectSlots(patch.slots) : current.slots;
        const nextQuotas = normalizeCollectQuotas({
            maxFileBytes: patch.maxFileBytes !== undefined ? patch.maxFileBytes : current.maxFileBytes,
            maxTotalBytes: patch.maxTotalBytes !== undefined ? patch.maxTotalBytes : current.maxTotalBytes,
            maxFiles: patch.maxFiles !== undefined ? patch.maxFiles : current.maxFiles,
        });
        const nextFileNameTemplate = patch.fileNameTemplate !== undefined
            ? parseFileNameTemplate(patch.fileNameTemplate)
            : undefined;
        const nextPackLayout = patch.packLayout !== undefined
            ? parsePackLayout(patch.packLayout)
            : undefined;
        const currentFileNameTemplate = requestFileNameTemplate(current.fileNameTemplate);
        const currentPackLayout = requestPackLayout(current.packLayout);
        const rulesChanged =
            (patch.slots !== undefined && !sameSlotRules(current.slots, nextSlots))
            || (patch.maxFileBytes !== undefined && nextQuotas.maxFileBytes !== current.maxFileBytes)
            || (patch.maxTotalBytes !== undefined && nextQuotas.maxTotalBytes !== current.maxTotalBytes)
            || (patch.maxFiles !== undefined && nextQuotas.maxFiles !== current.maxFiles)
            || (nextFileNameTemplate !== undefined && nextFileNameTemplate !== currentFileNameTemplate)
            || (nextPackLayout !== undefined && nextPackLayout !== currentPackLayout);
        if (rulesChanged) {
            if (await hasSubmittedRow(domainId, current._id)) throw new CollectSlotLockedError();
            if (patch.slots !== undefined) set.slots = nextSlots;
            if (patch.maxFileBytes !== undefined) set.maxFileBytes = nextQuotas.maxFileBytes;
            if (patch.maxTotalBytes !== undefined) set.maxTotalBytes = nextQuotas.maxTotalBytes;
            if (patch.maxFiles !== undefined) set.maxFiles = nextQuotas.maxFiles;
            if (nextFileNameTemplate !== undefined) set.fileNameTemplate = nextFileNameTemplate;
            if (nextPackLayout !== undefined) set.packLayout = nextPackLayout;
        }

        if (current.status !== 'draft') {
            const schoolId = set.schoolId || current.schoolId;
            const groupIds = set.groupIds || current.groupIds;
            await assertGroupsBelongToSchool(domainId, schoolId, groupIds);
        }

        return casRequest(domainId, current._id, expectedRevision, set, current.status);
    });
}

export async function publishRequest(
    domainId: string,
    id: ObjectId | string,
    actor: CollectActor,
    expectedRevision: number,
): Promise<CollectRequestDoc> {
    return withLockedRequest(domainId, id, async (current) => {
        assertCanEdit(actor, current);
        if (current.status !== 'draft') throw new CollectForbiddenError('只有草稿可以发布');
        if (current.dueAt.getTime() <= Date.now()) rejectFile('截止时间必须晚于当前时间');
        if (!current.slots.some((slot) => slot.required)) rejectFile('至少需要一个必填槽位');
        const ids = new Set(current.slots.map((slot) => slot.id));
        if (ids.size !== current.slots.length) rejectFile('槽位编号重复');
        await assertGroupsBelongToSchool(domainId, current.schoolId, current.groupIds);
        const audience = await resolveAudience(domainId, current.schoolId, current.groupIds);
        if (!audience.length) throw new CollectAudienceEmptyError();
        const now = new Date();
        return casRequest(domainId, current._id, expectedRevision, {
            status: 'published',
            publishedAt: current.publishedAt || now,
            closedAt: null,
        }, 'draft');
    });
}

export async function closeRequest(
    domainId: string,
    id: ObjectId | string,
    actor: CollectActor,
    expectedRevision: number,
): Promise<CollectRequestDoc> {
    return withLockedRequest(domainId, id, async (current) => {
        assertCanEdit(actor, current);
        if (current.status !== 'published') throw new CollectForbiddenError('只有已发布的收集可以关闭');
        return casRequest(domainId, current._id, expectedRevision, {
            status: 'closed',
            closedAt: new Date(),
        }, 'published');
    });
}

export async function reopenRequest(
    domainId: string,
    id: ObjectId | string,
    actor: CollectActor,
    expectedRevision: number,
    dueAt?: Date | string,
): Promise<CollectRequestDoc> {
    return withLockedRequest(domainId, id, async (current) => {
        assertCanEdit(actor, current);
        if (current.status !== 'closed') throw new CollectForbiddenError('只有已关闭的收集可以重新开放');
        const nextDue = dueAt !== undefined ? parseCollectDueAt(dueAt) : current.dueAt;
        if (nextDue.getTime() <= Date.now()) rejectFile('截止时间必须晚于当前时间');
        return casRequest(domainId, current._id, expectedRevision, {
            status: 'published',
            dueAt: nextDue,
            closedAt: null,
        }, 'closed');
    });
}

export async function archiveRequest(
    domainId: string,
    id: ObjectId | string,
    actor: CollectActor,
    expectedRevision: number,
): Promise<CollectRequestDoc> {
    return withLockedRequest(domainId, id, async (current) => {
        assertCanEdit(actor, current);
        if (current.status === 'archived') throw new CollectForbiddenError('收集已归档');
        return casRequest(domainId, current._id, expectedRevision, {
            status: 'archived',
            archivedAt: new Date(),
        }, current.status);
    });
}

export async function deleteRequestIfEmpty(
    domainId: string,
    id: ObjectId | string,
    actor: CollectActor,
    expectedRevision: number,
): Promise<void> {
    return withLockedRequest(domainId, id, async (current) => {
        assertCanEdit(actor, current);
        if (current.revision !== expectedRevision) throw new CollectRevisionConflictError();
        const file = await filesColl.findOne({ domainId, requestId: current._id });
        if (file) throw new CollectForbiddenError('已有文件，只能归档');
        if (await hasSubmittedRow(domainId, current._id)) throw new CollectForbiddenError('已有提交，只能归档');
        const deleted = await requestsColl.deleteOne({ domainId, _id: current._id, revision: expectedRevision });
        if (deleted.deletedCount !== 1) throw new CollectRevisionConflictError();
        await submissionsColl.deleteMany({ domainId, requestId: current._id });
    });
}

export async function listRequestsForTeacher(domainId: string, actor: CollectActor): Promise<CollectRequestDoc[]> {
    assertDomainId(domainId);
    const filter: Filter<CollectRequestDoc> = canManageAllCollect(actor)
        ? { domainId }
        : { domainId, $or: [{ ownerUid: actor._id }, { collaboratorUids: actor._id }] };
    const docs = await requestsColl.find(filter).sort({ updatedAt: -1, _id: -1 }).toArray();
    return docs.filter((doc) => canViewCollect(actor, doc));
}

export async function listRequestsForStudent(domainId: string, uid: number): Promise<CollectRequestDoc[]> {
    assertDomainId(domainId);
    if (!Number.isSafeInteger(uid) || uid < 2) return [];
    const [requests, submissions, ub] = await Promise.all([
        requestsColl.find({ domainId, status: { $in: ['published', 'closed'] } }).sort({ dueAt: 1, _id: 1 }).toArray(),
        submissionsColl.find({ domainId, uid }).toArray(),
        userbindOrThrow(),
    ]);
    if (!requests.length) return [];
    const submittedIds = new Set(
        submissions.filter((row) => row.status === 'submitted').map((row) => String(row.requestId)),
    );
    const student = await ub.findStudentByUserId(domainId, uid);
    return requests.filter((request) => submittedIds.has(String(request._id)) || studentMatchesAudience(student, request));
}

export async function listPendingForUser(domainId: string, uid: number): Promise<CollectRequestDoc[]> {
    assertDomainId(domainId);
    if (!Number.isSafeInteger(uid) || uid < 2) return [];
    const now = new Date();
    const ub = await userbindOrThrow();
    const student = await ub.findStudentByUserId(domainId, uid);
    if (!student) return [];
    const requests = await requestsColl
        .find({ domainId, status: 'published', dueAt: { $gt: now } })
        .sort({ dueAt: 1, _id: 1 })
        .toArray();
    const open = requests.filter((request) => studentMatchesAudience(student, request));
    if (!open.length) return [];
    const submissions = await submissionsColl
        .find({ domainId, uid, requestId: { $in: open.map((request) => request._id) } })
        .toArray();
    const submitted = new Set(submissions.filter((row) => row.status === 'submitted').map((row) => String(row.requestId)));
    return open.filter((request) => !submitted.has(String(request._id)));
}

function asPermUser(value: unknown, uid: number): CollectActor {
    if (!value || typeof value !== 'object') rejectFile('协作者不存在');
    const rec = value as { hasPerm?: unknown; hasPriv?: unknown };
    if (typeof rec.hasPerm !== 'function' || typeof rec.hasPriv !== 'function') {
        throw new TypeError(`UserModel.getById(${uid}) returned a user without permission methods`);
    }
    return {
        _id: uid,
        hasPerm: rec.hasPerm as CollectActor['hasPerm'],
        hasPriv: rec.hasPriv as CollectActor['hasPriv'],
    };
}

export async function setCollaborators(
    domainId: string,
    id: ObjectId | string,
    actor: CollectActor,
    expectedRevision: number,
    uids: number[],
): Promise<CollectRequestDoc> {
    return withLockedRequest(domainId, id, async (current) => {
        assertCanEdit(actor, current);
        assertMutable(current);
        if (!Array.isArray(uids)) rejectFile('协作者不合法');
        const seen = new Set<number>();
        const next: number[] = [];
        for (const uid of uids) {
            if (!Number.isSafeInteger(uid) || uid < 2) throw new CollectForbiddenError('协作者必须是正式用户');
            if (uid === current.ownerUid) continue;
            if (seen.has(uid)) continue;
            seen.add(uid);
            next.push(uid);
        }
        if (next.length > COLLABORATOR_MAX) rejectFile('协作者人数超过上限');
        for (const uid of next) {
            const loaded = await UserModel.getById(domainId, uid);
            const user = asPermUser(loaded, uid);
            if (!canCreateCollect(user)) throw new CollectForbiddenError('协作者必须具有创建收集权限');
        }
        return casRequest(domainId, current._id, expectedRevision, { collaboratorUids: next }, current.status);
    });
}

function displayName(originalName: string): string {
    const trimmed = originalName.trim();
    const base = trimmed.replace(/\\/g, '/').split('/').pop() || '';
    if (!base || base === '.' || base === '..') rejectFile('文件名无效');
    return base;
}

function asFileId(value: unknown): string {
    if (typeof value !== 'string' || !FILE_ID_RE.test(value)) rejectFile('文件编号不合法');
    return value;
}

function toCurrentRef(file: CollectFileDoc): CollectCurrentFileRef {
    return {
        slotId: file.slotId,
        fileId: file.fileId,
        originalName: file.originalName,
        size: file.size,
        sha256: file.sha256,
        ext: file.ext,
    };
}

async function loadCurrentFiles(domainId: string, requestId: ObjectId, uid: number): Promise<CollectFileDoc[]> {
    return filesColl
        .find({ domainId, requestId, uid, current: true })
        .sort({ createdAt: 1, _id: 1 })
        .toArray();
}

async function loadCurrentFilesByUids(
    domainId: string,
    requestId: ObjectId,
    uids: number[],
): Promise<Map<number, CollectFileDoc[]>> {
    const out = new Map<number, CollectFileDoc[]>();
    if (!uids.length) return out;
    const docs = await filesColl
        .find({ domainId, requestId, uid: { $in: uids }, current: true })
        .sort({ createdAt: 1, _id: 1 })
        .toArray();
    for (const file of docs) {
        const list = out.get(file.uid) || [];
        list.push(file);
        out.set(file.uid, list);
    }
    return out;
}

async function nextFileVersion(domainId: string, requestId: ObjectId, uid: number, slotId: string): Promise<number> {
    const latest = await filesColl
        .find({ domainId, requestId, uid, slotId })
        .sort({ version: -1 })
        .limit(1)
        .toArray();
    return (latest[0]?.version || 0) + 1;
}

async function syncSubmissionFiles(
    request: CollectRequestDoc,
    submission: CollectSubmissionDoc,
): Promise<CollectSubmissionDoc> {
    const currentFiles = (await loadCurrentFiles(submission.domainId, submission.requestId, submission.uid)).map(toCurrentRef);
    const now = new Date();
    const set: Partial<CollectSubmissionDoc> = { currentFiles, updatedAt: now };
    if (submission.status === 'submitted' && !requiredSlotsFilled(request.slots, currentFiles)) {
        set.status = 'draft';
        set.submittedAt = null;
    }
    await submissionsColl.updateOne({ _id: submission._id, domainId: submission.domainId }, { $set: set });
    return { ...submission, ...set };
}

export async function ensureSubmission(
    domainId: string,
    request: CollectRequestDoc,
    uid: number,
): Promise<CollectSubmissionDoc> {
    assertDomainId(domainId);
    if (request.domainId !== domainId) throw new CollectNotFoundError();
    assertSafeUid(uid);
    const existing = await submissionsColl.findOne({ domainId, requestId: request._id, uid });
    if (existing) return existing;
    assertOpenWindow(request);
    if (!(await isAudienceMember(domainId, uid, request))) throw new CollectForbiddenError('不在收集名单中');
    const now = new Date();
    const doc: CollectSubmissionDoc = {
        _id: new ObjectId(),
        domainId,
        requestId: request._id,
        uid,
        status: 'draft',
        submittedAt: null,
        currentFiles: [],
        createdAt: now,
        updatedAt: now,
    };
    try {
        await submissionsColl.insertOne(doc);
        return doc;
    } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        const raced = await submissionsColl.findOne({ domainId, requestId: request._id, uid });
        if (!raced) throw error;
        return raced;
    }
}

async function loadUploadBody(
    bytes: Buffer | Uint8Array | undefined,
    tempPath: string | undefined,
): Promise<{ header: Uint8Array; sha256: string; size: number; body: Buffer | string }> {
    if (bytes) {
        const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
        return {
            header: buf.subarray(0, Math.min(8, buf.length)),
            sha256: createHash('sha256').update(buf).digest('hex'),
            size: buf.length,
            body: buf,
        };
    }
    if (typeof tempPath === 'string' && tempPath) {
        const buf = await readFile(tempPath);
        return {
            header: buf.subarray(0, Math.min(8, buf.length)),
            sha256: createHash('sha256').update(buf).digest('hex'),
            size: buf.length,
            body: tempPath,
        };
    }
    rejectFile('缺少文件内容');
}

interface PreparedUpload {
    request: CollectRequestDoc;
    uid: number;
    slot: CollectSlot;
    originalName: string;
    ext: CollectAllowedExt;
    size: number;
    sha256: string;
    fileId: string;
    storagePath: string;
    body: Buffer | string | null;
    replacing: CollectFileDoc | null;
}

async function prepareUpload(
    input: PutStudentFileInput,
    opts: { fileId?: string; storagePath?: string; replacingFileId?: string; putStorage: boolean },
): Promise<PreparedUpload> {
    const request = await loadRequest(input.request.domainId, input.request._id);
    assertOpenWindow(request);
    assertSafeUid(input.uid);
    if (!(await isAudienceMember(request.domainId, input.uid, request))) {
        throw new CollectForbiddenError('不在收集名单中');
    }
    const slot = request.slots.find((item) => item.id === input.slotId);
    if (!slot) rejectFile('槽位不存在');
    const originalName = displayName(input.originalName);
    if (!Number.isFinite(input.size) || input.size <= 0) rejectFile('空文件');
    if (input.size > COLLECT_HARD_MAX_FILE_BYTES || input.size > request.maxFileBytes) rejectFile('文件过大');
    if (typeof input.tempPath === 'string' && input.tempPath) {
        const info = await stat(input.tempPath);
        if (info.size !== input.size) rejectFile('文件大小不一致');
        if (info.size > request.maxFileBytes || info.size > COLLECT_HARD_MAX_FILE_BYTES) rejectFile('文件过大');
    }
    const loaded = await loadUploadBody(input.bytes, input.tempPath);
    assertOpenWindow(request);
    if (input.size !== loaded.size) rejectFile('文件大小不一致');
    if (input.sha256 && input.sha256 !== loaded.sha256) rejectFile('文件校验失败');
    const currentFiles = await loadCurrentFiles(request.domainId, request._id, input.uid);
    const replacing = opts.replacingFileId
        ? currentFiles.find((file) => file.fileId === opts.replacingFileId) || null
        : null;
    if (opts.replacingFileId && (!replacing || replacing.slotId !== slot.id)) {
        rejectFile('只能替换当前槽位中的文件');
    }
    const counted = replacing ? currentFiles.filter((file) => file.fileId !== replacing.fileId) : currentFiles;
    const currentCountInSlot = counted.filter((file) => file.slotId === slot.id).length;
    const currentTotalBytes = counted.reduce((sum, file) => sum + file.size, 0);
    const currentTotalFiles = counted.length;
    if (loaded.size > request.maxFileBytes) rejectFile('文件过大');
    if (currentTotalBytes + loaded.size > request.maxTotalBytes) rejectFile('合计大小超限');
    if (currentTotalFiles >= request.maxFiles) rejectFile('文件数量超限');
    const validated = assertUploadAllowed({
        filename: originalName,
        size: loaded.size,
        slot,
        currentCountInSlot,
        currentTotalBytes,
        currentTotalFiles,
        header: loaded.header,
    });
    const fileId = opts.fileId ? asFileId(opts.fileId) : nanoid(16);
    const path = opts.storagePath || storagePath(request.domainId, request._id, input.uid, fileId);
    const expected = storagePath(request.domainId, request._id, input.uid, fileId);
    if (path !== expected) rejectFile('存储路径不合法');
    return {
        request,
        uid: input.uid,
        slot,
        originalName: validated.originalName,
        ext: validated.ext,
        size: loaded.size,
        sha256: loaded.sha256,
        fileId,
        storagePath: path,
        body: opts.putStorage ? loaded.body : null,
        replacing,
    };
}

async function insertPreparedFile(prepared: PreparedUpload): Promise<{ file: CollectFileDoc; submission: CollectSubmissionDoc }> {
    const request = await loadRequest(prepared.request.domainId, prepared.request._id);
    assertOpenWindow(request);
    const slot = request.slots.find((item) => item.id === prepared.slot.id);
    if (!slot) rejectFile('槽位不存在');
    if (!slot.allowedExt.includes(prepared.ext)) rejectFile('不允许的文件类型');
    const currentFiles = await loadCurrentFiles(request.domainId, request._id, prepared.uid);
    const replacing = prepared.replacing
        ? currentFiles.find((file) => file.fileId === prepared.replacing?.fileId && file.slotId === slot.id) || null
        : null;
    if (prepared.replacing && !replacing) rejectFile('只能替换当前槽位中的文件');
    const counted = replacing ? currentFiles.filter((file) => file.fileId !== replacing.fileId) : currentFiles;
    if (counted.filter((file) => file.slotId === slot.id).length >= slot.maxFiles) rejectFile('该槽位文件数量超限');
    if (counted.reduce((sum, file) => sum + file.size, 0) + prepared.size > request.maxTotalBytes) rejectFile('合计大小超限');
    if (counted.length >= request.maxFiles) rejectFile('文件数量超限');
    if (prepared.size > request.maxFileBytes) rejectFile('文件过大');
    const submission = await ensureSubmission(request.domainId, request, prepared.uid);
    const now = new Date();
    const file: CollectFileDoc = {
        _id: new ObjectId(),
        domainId: request.domainId,
        requestId: request._id,
        submissionId: submission._id,
        uid: prepared.uid,
        slotId: slot.id,
        fileId: prepared.fileId,
        storagePath: prepared.storagePath,
        originalName: prepared.originalName,
        size: prepared.size,
        sha256: prepared.sha256,
        ext: prepared.ext,
        version: await nextFileVersion(request.domainId, request._id, prepared.uid, prepared.slot.id),
        current: true,
        createdAt: now,
    };
    await filesColl.insertOne(file);
    if (replacing) {
        const unmarked = await filesColl.updateOne(
            {
                domainId: request.domainId,
                requestId: request._id,
                uid: prepared.uid,
                fileId: replacing.fileId,
                current: true,
            },
            { $set: { current: false } },
        );
        if (unmarked.matchedCount !== 1) {
            await filesColl.updateOne(
                {
                    domainId: request.domainId,
                    requestId: request._id,
                    uid: prepared.uid,
                    fileId: file.fileId,
                    current: true,
                },
                { $set: { current: false } },
            );
            throw new CollectFileRejectedError('原文件已不是当前版本');
        }
    }
    return { file, submission: await syncSubmissionFiles(request, submission) };
}

export async function putStudentFile(input: PutStudentFileInput): Promise<{ file: CollectFileDoc; submission: CollectSubmissionDoc }> {
    return withCollectLock(collectUserLockKey(input.request.domainId, String(input.request._id), input.uid), async () => {
        const prepared = await prepareUpload(input, { putStorage: true });
        await StorageModel.put(prepared.storagePath, prepared.body as Buffer | string, input.uid);
        return withLockedRequest(prepared.request.domainId, prepared.request._id, async () => insertPreparedFile(prepared));
    });
}

export const addFile = putStudentFile;

export async function addFileMeta(input: AddFileMetaInput): Promise<{ file: CollectFileDoc; submission: CollectSubmissionDoc }> {
    return withCollectLock(collectUserLockKey(input.request.domainId, String(input.request._id), input.uid), async () => {
        const prepared = await prepareUpload(input, {
            fileId: input.fileId,
            storagePath: input.storagePath,
            putStorage: false,
        });
        return withLockedRequest(prepared.request.domainId, prepared.request._id, async () => insertPreparedFile(prepared));
    });
}

export async function replaceFile(input: ReplaceFileInput): Promise<{ file: CollectFileDoc; submission: CollectSubmissionDoc }> {
    return withCollectLock(collectUserLockKey(input.request.domainId, String(input.request._id), input.uid), async () => {
        const prepared = await prepareUpload(input, { putStorage: true, replacingFileId: input.fileId });
        await StorageModel.put(prepared.storagePath, prepared.body as Buffer | string, input.uid);
        return withLockedRequest(prepared.request.domainId, prepared.request._id, async () => insertPreparedFile(prepared));
    });
}

export async function deleteCurrentFile(
    requestInput: CollectRequestDoc,
    uid: number,
    fileId: string,
): Promise<CollectSubmissionDoc> {
    return withLockedRequest(requestInput.domainId, requestInput._id, async (request) => {
        assertOpenWindow(request);
        assertSafeUid(uid);
        if (!(await isAudienceMember(request.domainId, uid, request))) throw new CollectForbiddenError('不在收集名单中');
        const unmarked = await filesColl.updateOne(
            { domainId: request.domainId, requestId: request._id, uid, fileId, current: true },
            { $set: { current: false } },
        );
        if (unmarked.matchedCount !== 1) rejectFile('文件不是当前版本');
        const submission = await submissionsColl.findOne({ domainId: request.domainId, requestId: request._id, uid });
        if (!submission) throw new CollectNotFoundError();
        return syncSubmissionFiles(request, submission);
    });
}

export async function confirmSubmit(requestInput: CollectRequestDoc, uid: number): Promise<CollectSubmissionDoc> {
    return withLockedRequest(requestInput.domainId, requestInput._id, async (request) => {
    assertOpenWindow(request);
    assertSafeUid(uid);
    if (!(await isAudienceMember(request.domainId, uid, request))) throw new CollectForbiddenError('不在收集名单中');
    const submission = await submissionsColl.findOne({ domainId: request.domainId, requestId: request._id, uid });
    if (!submission) rejectFile('尚未上传文件');
    const currentFiles = (await loadCurrentFiles(request.domainId, request._id, uid)).map(toCurrentRef);
    if (!requiredSlotsFilled(request.slots, currentFiles)) rejectFile('必填槽位尚未交齐');
    if (submission.status === 'submitted') {
        await submissionsColl.updateOne(
            { _id: submission._id, domainId: request.domainId },
            { $set: { currentFiles, updatedAt: new Date() } },
        );
        return { ...submission, currentFiles, updatedAt: new Date() };
    }
    const now = new Date();
    const result = await submissionsColl.updateOne(
        { _id: submission._id, domainId: request.domainId, status: 'draft' },
        { $set: { status: 'submitted', submittedAt: now, currentFiles, updatedAt: now } },
    );
    if (result.matchedCount !== 1) {
        const raced = await submissionsColl.findOne({ domainId: request.domainId, requestId: request._id, uid });
        if (raced?.status === 'submitted') return raced;
        throw new CollectRevisionConflictError();
    }
    return { ...submission, status: 'submitted', submittedAt: now, currentFiles, updatedAt: now };
    });
}

export async function getFileForDownload(
    request: CollectRequestDoc,
    actor: CollectActor,
    fileId: string,
): Promise<CollectFileDoc> {
    const file = await filesColl.findOne({ domainId: request.domainId, requestId: request._id, fileId });
    if (!file) throw new CollectNotFoundError();
    if (file.uid === actor._id) return file;
    if (!canViewCollect(actor, request)) throw new CollectForbiddenError('无权下载该文件');
    return file;
}

async function studentNames(
    domainId: string,
    uids: number[],
): Promise<Map<number, { studentId: string; realName: string }>> {
    const out = new Map<number, { studentId: string; realName: string }>();
    if (!uids.length) return out;
    const ub = await userbindOrThrow();
    if (typeof ub.findStudentsByUserIds === 'function') {
        const docs = await ub.findStudentsByUserIds(domainId, uids);
        for (const uid of uids) {
            const row = docs[String(uid)];
            if (row) out.set(uid, { studentId: row.studentId || '', realName: row.realName || '' });
        }
        return out;
    }
    await Promise.all(uids.map(async (uid) => {
        const student = await ub.findStudentByUserId(domainId, uid);
        if (student) out.set(uid, { studentId: student.studentId || '', realName: student.realName || '' });
    }));
    return out;
}

function identityOf(uid: number, names: Map<number, { studentId: string; realName: string }>): { studentId: string; realName: string } {
    const named = names.get(uid);
    if (named?.studentId) return { studentId: named.studentId, realName: named.realName };
    return { studentId: `unbound-UID${uid}`, realName: named?.realName || '' };
}

function packIdentity(uid: number, names: Map<number, { studentId: string; realName: string }>): {
    studentId: string;
    realName: string;
    folder: string;
} {
    const named = names.get(uid);
    const folder = zipStudentFolder({ uid, studentId: named?.studentId, realName: named?.realName });
    return {
        studentId: named?.studentId || `unbound-UID${uid}`,
        realName: named?.realName || '',
        folder,
    };
}

interface CollectSlotFileIndexRef {
    fileId: string;
    slotId: string;
    createdAt?: Date;
    _id?: ObjectId | string;
}

/** 1-based index among that slot's current files. Prefers createdAt,_id from file docs; CollectCurrentFileRef has no createdAt so it sorts by fileId. */
export function fileIndexInSlot(
    currentFilesForUid: ReadonlyArray<CollectSlotFileIndexRef>,
    slotId: string,
    fileId: string,
): number {
    const inSlot = currentFilesForUid.filter((file) => file.slotId === slotId);
    const useCreatedAt = inSlot.every((file) => file.createdAt instanceof Date && !Number.isNaN(file.createdAt.getTime()));
    const sorted = inSlot.slice().sort((left, right) => {
        if (useCreatedAt) {
            const delta = (left.createdAt as Date).getTime() - (right.createdAt as Date).getTime();
            if (delta !== 0) return delta;
            return String(left._id ?? left.fileId).localeCompare(String(right._id ?? right.fileId));
        }
        return left.fileId.localeCompare(right.fileId);
    });
    const index = sorted.findIndex((file) => file.fileId === fileId);
    if (index < 0) throw new TypeError(`file ${fileId} is not among current files for slot ${slotId}`);
    return index + 1;
}

export function assignedNameForFile(
    request: { fileNameTemplate?: string | null },
    identity: CollectNameIdentity,
    slot: Pick<CollectSlot, 'title'>,
    file: { fileId: string; originalName: string; ext: string; slotId: string },
    index: number,
): string {
    return renderAssignedFileName(requestFileNameTemplate(request.fileNameTemplate), {
        uid: identity.uid,
        studentId: identity.studentId,
        realName: identity.realName,
        slotTitle: slot.title,
        index,
        ext: file.ext,
        originalName: file.originalName,
    });
}

export function annotateProgressDuplicates(
    rows: ReadonlyArray<Omit<CollectProgressRow, 'currentFiles'> & { currentFiles: readonly CollectCurrentFileRef[] }>,
): CollectProgressRow[] {
    const peopleByHash = new Map<string, Map<number, string>>();
    for (const row of rows) {
        for (const file of row.currentFiles) {
            let people = peopleByHash.get(file.sha256);
            if (!people) {
                people = new Map();
                peopleByHash.set(file.sha256, people);
            }
            people.set(row.uid, row.studentId);
        }
    }
    return rows.map((row) => ({
        ...row,
        currentFiles: row.currentFiles.map((file) => {
            const people = peopleByHash.get(file.sha256) || new Map();
            const duplicateStudentIds = [...people.entries()]
                .filter(([uid]) => uid !== row.uid)
                .map(([, studentId]) => studentId)
                .sort((left, right) => left.localeCompare(right));
            return {
                ...file,
                duplicateCount: people.size,
                duplicateStudentIds,
            };
        }),
    }));
}

export async function listProgress(request: CollectRequestDoc): Promise<CollectProgressRow[]> {
    const audience = await resolveAudience(request.domainId, request.schoolId, request.groupIds);
    const submissions = await submissionsColl.find({ domainId: request.domainId, requestId: request._id }).toArray();
    const byUid = new Map(submissions.map((row) => [row.uid, row]));
    const audienceUids = new Set(audience.map((student) => student.boundUserId));
    const rows: Array<Omit<CollectProgressRow, 'currentFiles'> & { currentFiles: CollectCurrentFileRef[] }> = audience.map((student) => {
        const submission = byUid.get(student.boundUserId);
        return {
            uid: student.boundUserId,
            studentId: student.studentId,
            realName: student.realName,
            status: submission ? submission.status : 'missing',
            submittedAt: submission?.submittedAt ?? null,
            currentFiles: submission?.currentFiles ?? [],
            leftGroup: false,
        };
    });
    const extra = submissions.filter((row) => row.status === 'submitted' && !audienceUids.has(row.uid));
    const names = await studentNames(request.domainId, extra.map((row) => row.uid));
    for (const submission of extra) {
        const ident = identityOf(submission.uid, names);
        rows.push({
            uid: submission.uid,
            studentId: ident.studentId,
            realName: ident.realName,
            status: 'submitted',
            submittedAt: submission.submittedAt,
            currentFiles: submission.currentFiles,
            leftGroup: true,
        });
    }
    return annotateProgressDuplicates(rows);
}

function slotForFile(request: CollectRequestDoc, slotId: string): Pick<CollectSlot, 'title'> {
    return request.slots.find((slot) => slot.id === slotId) || { title: slotId };
}

export async function listPackEntries(
    request: CollectRequestDoc,
): Promise<{ entries: CollectPackFileEntry[]; missing: CollectPackMissing[] }> {
    const [audience, submissions] = await Promise.all([
        resolveAudience(request.domainId, request.schoolId, request.groupIds),
        submissionsColl.find({ domainId: request.domainId, requestId: request._id, status: 'submitted' }).toArray(),
    ]);
    const byUid = new Map(submissions.map((row) => [row.uid, row]));
    const audienceByUid = new Map(audience.map((student) => [student.boundUserId, student]));
    const extraUids = submissions.map((row) => row.uid).filter((uid) => !audienceByUid.has(uid));
    const names = await studentNames(request.domainId, extraUids);
    const currentByUid = await loadCurrentFilesByUids(
        request.domainId,
        request._id,
        submissions.map((row) => row.uid),
    );
    const layout = requestPackLayout(request.packLayout);
    const entries: CollectPackFileEntry[] = [];
    for (const submission of submissions) {
        const member = audienceByUid.get(submission.uid);
        if (member) names.set(submission.uid, { studentId: member.studentId, realName: member.realName });
        const ident = packIdentity(submission.uid, names);
        const identity = { uid: submission.uid, studentId: ident.studentId, realName: ident.realName };
        const currentFiles = currentByUid.get(submission.uid) || [];
        for (const file of currentFiles) {
            const slot = slotForFile(request, file.slotId);
            const assignedName = assignedNameForFile(
                request,
                identity,
                slot,
                file,
                fileIndexInSlot(currentFiles, file.slotId, file.fileId),
            );
            entries.push({
                name: renderPackEntryName(layout, ident.folder, slot.title, assignedName),
                assignedName,
                uid: submission.uid,
                studentId: ident.studentId,
                realName: ident.realName,
                slotId: file.slotId,
                slotTitle: slot.title,
                fileId: file.fileId,
                originalName: file.originalName,
                size: file.size,
                sha256: file.sha256,
                ext: file.ext,
                leftGroup: !member,
            });
        }
    }
    entries.sort((left, right) => left.name.localeCompare(right.name) || left.fileId.localeCompare(right.fileId));
    const deduped = dedupePackNames(entries);
    deduped.sort((left, right) => left.name.localeCompare(right.name) || left.fileId.localeCompare(right.fileId));
    const missing: CollectPackMissing[] = audience
        .filter((student) => byUid.get(student.boundUserId)?.status !== 'submitted')
        .map((student) => ({ uid: student.boundUserId, studentId: student.studentId, realName: student.realName }));
    return { entries: deduped, missing };
}

export async function listExpectedMissingRows(request: CollectRequestDoc): Promise<CollectExpectedMissingRow[]> {
    const [audience, submissions] = await Promise.all([
        resolveAudience(request.domainId, request.schoolId, request.groupIds),
        submissionsColl.find({ domainId: request.domainId, requestId: request._id, status: 'submitted' }).toArray(),
    ]);
    const submitted = new Set(submissions.map((row) => row.uid));
    const requiredSlots = request.slots.filter((slot) => slot.required);
    const rows: CollectExpectedMissingRow[] = [];
    for (const student of audience) {
        if (submitted.has(student.boundUserId)) continue;
        const identity = { uid: student.boundUserId, studentId: student.studentId, realName: student.realName };
        for (const slot of requiredSlots) {
            const ext = slotPreviewExt(slot);
            rows.push({
                studentId: student.studentId,
                realName: student.realName,
                uid: student.boundUserId,
                slotTitle: slot.title,
                assignedName: assignedNameForFile(
                    request,
                    identity,
                    slot,
                    {
                        fileId: slot.id,
                        originalName: missingOriginalName(ext),
                        ext,
                        slotId: slot.id,
                    },
                    1,
                ),
            });
        }
    }
    return rows;
}

export function listSubmittedCsvRows(entries: CollectPackFileEntry[]): CollectSubmittedCsvRow[] {
    return entries.map((entry) => ({
        studentId: entry.studentId,
        realName: entry.realName,
        uid: entry.uid,
        slotTitle: entry.slotTitle,
        assignedName: entry.assignedName,
        originalName: entry.originalName,
        sha256: entry.sha256,
        size: entry.size,
    }));
}

export async function nudgeUnsubmitted(requestInput: CollectRequestDoc, actor: CollectActor): Promise<number[]> {
    const request = await loadRequest(requestInput.domainId, requestInput._id);
    assertCanView(actor, request);
    if (request.status !== 'published' && request.status !== 'closed') {
        throw new CollectForbiddenError('只有已发布或已关闭的收集可以催交');
    }
    const cutoff = new Date(Date.now() - COLLECT_NUDGE_COOLDOWN_MS);
    const result = await requestsColl.updateOne(
        {
            domainId: request.domainId,
            _id: request._id,
            $or: [{ lastNudgeAt: null }, { lastNudgeAt: { $lte: cutoff } }],
        },
        { $set: { lastNudgeAt: new Date(), lastNudgeBy: actor._id } },
    );
    if (result.matchedCount !== 1) throw new CollectNudgeRateError();
    const audience = await resolveAudience(request.domainId, request.schoolId, request.groupIds);
    if (!audience.length) return [];
    const submissions = await submissionsColl
        .find({
            domainId: request.domainId,
            requestId: request._id,
            uid: { $in: audience.map((student) => student.boundUserId) },
            status: 'submitted',
        })
        .toArray();
    const submitted = new Set(submissions.map((row) => row.uid));
    return audience.map((student) => student.boundUserId).filter((uid) => !submitted.has(uid));
}
