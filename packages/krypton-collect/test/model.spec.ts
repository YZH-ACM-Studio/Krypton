import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import { PERM, PRIV } from '@hydrooj/common';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
const framework = require('../../../framework/framework');

const modelPath = require.resolve('../src/model.ts');
const authPath = require.resolve('../src/auth.ts');
const errorsPath = require.resolve('../src/errors.ts');
const fileValidatePath = require.resolve('../src/file-validate.ts');
const packPath = require.resolve('../src/pack-format.ts');
const nameFormatPath = require.resolve('../src/name-format.ts');
const typesPath = require.resolve('../src/types.ts');

type AnyDoc = Record<string, unknown>;

function idsEqual(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId || right instanceof ObjectId) return String(left) === String(right);
    if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
    return left === right;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !(value instanceof ObjectId) && !(value instanceof Date) && !Array.isArray(value);
}

function clone<T>(value: T): T {
    if (value instanceof ObjectId) return value;
    if (value instanceof Date) return new Date(value.getTime()) as T;
    if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
    if (isPlainObject(value)) {
        const out: Record<string, unknown> = {};
        for (const [key, nested] of Object.entries(value)) out[key] = clone(nested);
        return out as T;
    }
    return value;
}

function matches(doc: AnyDoc, query: Record<string, unknown>): boolean {
    return Object.entries(query).every(([key, expected]) => {
        if (key === '$or') {
            return (expected as Record<string, unknown>[]).some((candidate) => matches(doc, candidate));
        }
        const actual = doc[key];
        if (isPlainObject(expected)) {
            if ('$in' in expected) {
                const list = expected.$in as unknown[];
                if (Array.isArray(actual)) return actual.some((item) => list.some((itemExpected) => idsEqual(item, itemExpected)));
                return list.some((itemExpected) => idsEqual(actual, itemExpected));
            }
            if ('$gt' in expected) return actual != null && (actual as Date | number) > (expected.$gt as Date | number);
            if ('$lte' in expected) return actual != null && (actual as Date | number) <= (expected.$lte as Date | number);
        }
        if (expected === null) return actual == null;
        if (Array.isArray(actual) && !Array.isArray(expected)) return actual.some((item) => idsEqual(item, expected));
        return idsEqual(actual, expected);
    });
}

function sortRows(rows: AnyDoc[], spec: Record<string, number>): AnyDoc[] {
    const entries = Object.entries(spec);
    return [...rows].sort((left, right) => {
        for (const [key, dir] of entries) {
            const av = left[key];
            const bv = right[key];
            let cmp = 0;
            if (av instanceof Date && bv instanceof Date) cmp = av.getTime() - bv.getTime();
            else if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
            else cmp = String(av).localeCompare(String(bv));
            if (cmp !== 0) return dir < 0 ? -cmp : cmp;
        }
        return 0;
    });
}

function memoryCollection(uniqueKeys: string[][]) {
    const docs: AnyDoc[] = [];
    function keyOf(doc: AnyDoc, keys: string[]) {
        return keys.map((key) => String(doc[key])).join('\0');
    }
    function query(filter: Record<string, unknown>) {
        return docs.filter((doc) => matches(doc, filter));
    }
    return {
        docs,
        async insertOne(doc: AnyDoc) {
            const copy = clone(doc);
            for (const keys of uniqueKeys) {
                const key = keyOf(copy, keys);
                if (docs.some((existing) => keyOf(existing, keys) === key)) {
                    const error = new Error('E11000 duplicate key');
                    (error as { code: number }).code = 11000;
                    throw error;
                }
            }
            docs.push(copy);
            return { acknowledged: true, insertedId: copy._id };
        },
        async findOne(filter: Record<string, unknown>) {
            const found = query(filter)[0];
            return found ? clone(found) : null;
        },
        find(filter: Record<string, unknown> = {}) {
            let rows = query(filter).map((doc) => clone(doc));
            const cursor = {
                sort(spec: Record<string, number>) {
                    rows = sortRows(rows, spec);
                    return cursor;
                },
                limit(count: number) {
                    rows = rows.slice(0, count);
                    return cursor;
                },
                async toArray() {
                    return rows;
                },
            };
            return cursor;
        },
        async updateOne(filter: Record<string, unknown>, update: { $set: AnyDoc }) {
            const index = docs.findIndex((doc) => matches(doc, filter));
            if (index < 0) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
            Object.assign(docs[index], clone(update.$set));
            return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
        },
        async deleteOne(filter: Record<string, unknown>) {
            const index = docs.findIndex((doc) => matches(doc, filter));
            if (index < 0) return { acknowledged: true, deletedCount: 0 };
            docs.splice(index, 1);
            return { acknowledged: true, deletedCount: 1 };
        },
        async deleteMany(filter: Record<string, unknown>) {
            const before = docs.length;
            for (let i = docs.length - 1; i >= 0; i -= 1) {
                if (matches(docs[i], filter)) docs.splice(i, 1);
            }
            return { acknowledged: true, deletedCount: before - docs.length };
        },
        async countDocuments(filter: Record<string, unknown> = {}) {
            return query(filter).length;
        },
    };
}

const requestsColl = memoryCollection([['_id']]);
const submissionsColl = memoryCollection([['domainId', 'requestId', 'uid']]);
const filesColl = memoryCollection([
    ['domainId', 'fileId'],
    ['storagePath'],
    ['domainId', 'requestId', 'uid', 'slotId', 'version'],
]);
const stored = new Map<string, Buffer | string>();
const usersById = new Map<number, { _id: number; hasPerm(perm: bigint): boolean; hasPriv(priv: number): boolean }>();
let nanoidSeq = 0;
let students: Array<{
    domainId: string;
    schoolId: ObjectId;
    groupIds: ObjectId[];
    boundUserId: number;
    studentId: string;
    realName: string;
}> = [];
let groups: Array<{ _id: ObjectId; domainId: string; schoolId: ObjectId }> = [];
let userbindMissing = false;
let userbindNoGroups = false;

function actor(id: number, flags?: { perms?: bigint[]; privs?: number[] }) {
    const perms = new Set(flags?.perms ?? []);
    const privs = new Set(flags?.privs ?? []);
    return {
        _id: id,
        hasPerm(perm: bigint) {
            return perms.has(perm);
        },
        hasPriv(priv: number) {
            return privs.has(priv);
        },
    };
}

const userbind = {
    async findStudentByUserId(domainId: string, uid: number) {
        return students.find((student) => student.domainId === domainId && student.boundUserId === uid) || null;
    },
    async findBoundStudentsByGroupIds(domainId: string, groupIds: ObjectId[]) {
        const want = new Set(groupIds.map(String));
        return students.filter(
            (student) => student.domainId === domainId && student.boundUserId > 1 && student.groupIds.some((id) => want.has(String(id))),
        );
    },
    async listUserGroups(domainId: string, schoolId?: ObjectId) {
        return groups.filter((group) => group.domainId === domainId && (!schoolId || String(group.schoolId) === String(schoolId)));
    },
    async findStudentsByUserIds(domainId: string, uids: number[]) {
        const want = new Set(uids);
        const out: Record<string, { studentId: string; realName: string }> = {};
        for (const student of students) {
            if (student.domainId === domainId && want.has(student.boundUserId)) {
                out[String(student.boundUserId)] = { studentId: student.studentId, realName: student.realName };
            }
        }
        return out;
    },
};

const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    const filename = parent?.filename || '';
    if (request === 'hydrooj' && filename.includes('krypton-collect/src')) {
        return {
            CreateError: framework.CreateError,
            ForbiddenError: framework.ForbiddenError,
            NotFoundError: framework.NotFoundError,
            UserFacingError: framework.UserFacingError,
            ObjectId,
            PERM,
            PRIV,
            nanoid: (len = 21) => `f${String(++nanoidSeq).padStart(Math.max(len - 1, 1), '0')}`,
            StorageModel: {
                async put(path: string, file: Buffer | string) {
                    stored.set(path, file);
                    return path;
                },
            },
            UserModel: {
                async getById(_domainId: string, uid: number) {
                    return usersById.get(uid) ?? null;
                },
            },
        };
    }
    if (request === './db' && filename === modelPath) {
        return { requestsColl, submissionsColl, filesColl };
    }
    return originalLoad.call(this, request, parent, isMain);
};

for (const path of [modelPath, authPath, errorsPath, fileValidatePath, packPath, nameFormatPath, typesPath]) {
    delete require.cache[path];
}

let model: typeof import('../src/model.ts');
try {
    model = require(modelPath);
} finally {
    Module._load = originalLoad;
}

const domainId = 'system';
const schoolId = new ObjectId();
const otherSchoolId = new ObjectId();
const groupId = new ObjectId();
const extraGroupId = new ObjectId();
const otherGroupId = new ObjectId();
const teacher = actor(10, { perms: [PERM.PERM_CREATE_COLLECT] });
const manager = actor(5, { perms: [PERM.PERM_MANAGE_COLLECT] });
const collaborator = actor(20, { perms: [PERM.PERM_CREATE_COLLECT] });
const studentActor = actor(101);
const otherStudent = actor(102);

function pdf(extra = 'body') {
    return Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(extra)]);
}
function zip() {
    return Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 1, 2, 3, 4, 5]);
}
function jpg() {
    return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
}

function sha256(buf: Buffer) {
    return createHash('sha256').update(buf).digest('hex');
}

async function expectReject(work: () => Promise<unknown>, name: string, needle?: string) {
    try {
        await work();
    } catch (error) {
        expect((error as { name?: string }).name).to.equal(name);
        if (needle) {
            const params = (error as { params?: unknown[] }).params;
            const text = Array.isArray(params) && params.length ? String(params[0]) : error instanceof Error ? error.message : String(error);
            expect(text).to.include(needle);
        }
        return;
    }
    expect.fail(`expected ${name}`);
}

function futureDate(ms = 60 * 60 * 1000) {
    return new Date(Date.now() + ms);
}

async function createDraft(overrides: Record<string, unknown> = {}) {
    return model.createRequest(domainId, teacher._id, {
        schoolId,
        groupIds: [groupId],
        title: '收集作业',
        description: '说明',
        slots: [{ title: '报告', required: true, allowedExt: ['pdf', 'zip', 'jpg'], maxFiles: 2 }],
        dueAt: futureDate(),
        ...overrides,
    });
}

async function createPublished(overrides: Record<string, unknown> = {}) {
    const draft = await createDraft(overrides);
    return model.publishRequest(domainId, draft._id, teacher, draft.revision);
}

async function submitPdf(
    request: Awaited<ReturnType<typeof model.getRequest>>,
    uid: number,
    originalName: string,
    body: Buffer,
    slotId = request.slots[0].id,
) {
    await model.putStudentFile({
        request,
        uid,
        slotId,
        originalName,
        size: body.length,
        bytes: body,
    });
    return model.confirmSubmit(request, uid);
}

beforeEach(() => {
    requestsColl.docs.length = 0;
    submissionsColl.docs.length = 0;
    filesColl.docs.length = 0;
    stored.clear();
    usersById.clear();
    usersById.set(collaborator._id, collaborator);
    usersById.set(teacher._id, teacher);
    nanoidSeq = 0;
    userbindMissing = false;
    userbindNoGroups = false;
    groups = [
        { _id: groupId, domainId, schoolId },
        { _id: extraGroupId, domainId, schoolId },
        { _id: otherGroupId, domainId, schoolId: otherSchoolId },
    ];
    students = [
        { domainId, schoolId, groupIds: [groupId], boundUserId: 101, studentId: '24000001', realName: '甲' },
        { domainId, schoolId, groupIds: [groupId], boundUserId: 102, studentId: '24000002', realName: '乙' },
        { domainId, schoolId: otherSchoolId, groupIds: [otherGroupId], boundUserId: 201, studentId: '99000001', realName: '丙' },
    ];
    (globalThis as { Hydro?: { model?: { userbind?: unknown } } }).Hydro = {
        model: {
            get userbind() {
                if (userbindMissing) return {};
                if (userbindNoGroups) {
                    return {
                        findStudentByUserId: userbind.findStudentByUserId,
                        findBoundStudentsByGroupIds: userbind.findBoundStudentsByGroupIds,
                    };
                }
                return userbind;
            },
        },
    };
});

describe('krypton-collect model helpers', () => {
    it('generates slot ids, maps jpeg, and rejects illegal quotas or extensions', () => {
        const slots = model.normalizeCollectSlots([
            { title: ' 附件 ', allowedExt: ['jpeg', 'PDF', 'jpeg'], maxFiles: 3 },
        ]);
        expect(slots).to.have.length(1);
        expect(slots[0].id).to.match(/^[a-f0-9]{8}$/);
        expect(slots[0].title).to.equal('附件');
        expect(slots[0].required).to.equal(true);
        expect(slots[0].allowedExt).to.deep.equal(['jpg', 'pdf']);
        expect(slots[0].maxFiles).to.equal(3);

        expect(() => model.normalizeCollectSlots([{ title: 'x', allowedExt: ['exe'] }])).to.throw();
        expect(() => model.normalizeCollectQuotas({ maxFileBytes: 32 * 1024 * 1024 + 1 })).to.throw();
        expect(() => model.parseCollectDueAt('not-a-date')).to.throw();
    });
});

describe('krypton-collect audience', () => {
    it('fails closed when userbind resolvers are missing', async () => {
        userbindMissing = true;
        await expectReject(() => model.userbindOrThrow(), 'TypeError');
    });

    it('filters by school and dedups boundUserId', async () => {
        students.push({ domainId, schoolId, groupIds: [groupId], boundUserId: 101, studentId: '24000001', realName: '甲-重复' });
        const audience = await model.resolveAudience(domainId, schoolId, [groupId, extraGroupId]);
        expect(audience.map((row) => row.boundUserId).sort()).to.deep.equal([101, 102]);
        expect(audience.every((row) => String(row.schoolId) === String(schoolId))).to.equal(true);
        expect(await model.isAudienceMember(domainId, 101, { schoolId, groupIds: [groupId] })).to.equal(true);
        expect(await model.isAudienceMember(domainId, 201, { schoolId, groupIds: [groupId] })).to.equal(false);
        expect(await model.isAudienceMember(domainId, 1, { schoolId, groupIds: [groupId] })).to.equal(false);
    });
});

describe('krypton-collect requests', () => {
    it('creates a draft and CASes updates', async () => {
        const created = await createDraft();
        expect(created.status).to.equal('draft');
        expect(created.revision).to.equal(1);
        expect(created.slots[0].id).to.match(/^[a-f0-9]{8}$/);
        const updated = await model.updateRequest(domainId, created._id, teacher, 1, { title: '新标题', dueAt: futureDate(7200000) });
        expect(updated.title).to.equal('新标题');
        expect(updated.revision).to.equal(2);
        await expectReject(() => model.updateRequest(domainId, created._id, teacher, 1, { title: '冲突' }), 'CollectRevisionConflictError');
        await expectReject(
            () => model.updateRequest(domainId, created._id, teacher, updated.revision, { description: 'x'.repeat(20001) }),
            'CollectFileRejectedError',
            '说明过长',
        );
    });

    it('rejects publish without bound audience or when groups are from another school', async () => {
        const empty = await createDraft({ groupIds: [extraGroupId] });
        await expectReject(() => model.publishRequest(domainId, empty._id, teacher, empty.revision), 'CollectAudienceEmptyError');

        const cross = await createDraft({ groupIds: [otherGroupId] });
        await expectReject(() => model.publishRequest(domainId, cross._id, teacher, cross.revision), 'CollectFileRejectedError', '学校');

        userbindNoGroups = true;
        const noResolver = await createDraft();
        await expectReject(() => model.publishRequest(domainId, noResolver._id, teacher, noResolver.revision), 'TypeError');
    });

    it('publishes, closes, reopens, and archives', async () => {
        const published = await createPublished();
        expect(published.status).to.equal('published');
        expect(published.publishedAt).to.be.instanceOf(Date);

        const closed = await model.closeRequest(domainId, published._id, teacher, published.revision);
        expect(closed.status).to.equal('closed');
        await expectReject(() => model.reopenRequest(domainId, closed._id, teacher, closed.revision, new Date(Date.now() - 1000)), 'CollectFileRejectedError', '截止');

        const reopened = await model.reopenRequest(domainId, closed._id, teacher, closed.revision, futureDate());
        expect(reopened.status).to.equal('published');
        const archived = await model.archiveRequest(domainId, reopened._id, teacher, reopened.revision);
        expect(archived.status).to.equal('archived');
        await expectReject(() => model.updateRequest(domainId, archived._id, teacher, archived.revision, { title: 'x' }), 'CollectForbiddenError');
    });

    it('deletes only empty drafts and locks slots after a submitted row', async () => {
        const empty = await createDraft();
        await model.deleteRequestIfEmpty(domainId, empty._id, teacher, empty.revision);
        expect(requestsColl.docs).to.have.length(0);

        const published = await createPublished();
        const body = pdf();
        await model.putStudentFile({
            request: published,
            uid: 101,
            slotId: published.slots[0].id,
            originalName: 'a.pdf',
            size: body.length,
            bytes: body,
        });
        await model.confirmSubmit(published, 101);
        await expectReject(
            () => model.updateRequest(domainId, published._id, teacher, published.revision, {
                slots: [{ id: published.slots[0].id, title: '改槽', required: true, allowedExt: ['pdf'], maxFiles: 1 }],
            }),
            'CollectSlotLockedError',
        );
        const renamed = await model.updateRequest(domainId, published._id, teacher, published.revision, { title: '仍可改标题' });
        expect(renamed.title).to.equal('仍可改标题');
        await expectReject(() => model.deleteRequestIfEmpty(domainId, renamed._id, teacher, renamed.revision), 'CollectForbiddenError', '文件');
    });

    it('sets collaborators after stripping the owner and rejecting students', async () => {
        const draft = await createDraft();
        await expectReject(
            () => model.setCollaborators(domainId, draft._id, teacher, draft.revision, [1]),
            'CollectForbiddenError',
        );
        const student = actor(103);
        usersById.set(103, student);
        await expectReject(
            () => model.setCollaborators(domainId, draft._id, teacher, draft.revision, [103]),
            'CollectForbiddenError',
            '创建',
        );
        const updated = await model.setCollaborators(domainId, draft._id, teacher, draft.revision, [teacher._id, collaborator._id, collaborator._id]);
        expect(updated.collaboratorUids).to.deep.equal([collaborator._id]);
    });
});

describe('krypton-collect lists', () => {
    it('lists teacher/student/pending views and treats left-group submitted rows as history', async () => {
        const published = await createPublished();
        const body = pdf();
        await model.putStudentFile({
            request: published,
            uid: 101,
            slotId: published.slots[0].id,
            originalName: 'a.pdf',
            size: body.length,
            bytes: body,
        });
        await model.confirmSubmit(published, 101);

        const teacherList = await model.listRequestsForTeacher(domainId, teacher);
        expect(teacherList.map((row) => String(row._id))).to.deep.equal([String(published._id)]);
        const current = await model.getRequest(domainId, published._id);
        const afterCollab = await model.setCollaborators(domainId, current._id, teacher, current.revision, [collaborator._id]);
        expect(afterCollab.collaboratorUids).to.include(collaborator._id);
        expect((await model.listRequestsForTeacher(domainId, collaborator)).length).to.equal(1);
        expect((await model.listRequestsForTeacher(domainId, manager)).length).to.equal(1);
        const demoted = actor(20);
        usersById.set(20, demoted);
        expect((await model.listRequestsForTeacher(domainId, demoted)).length).to.equal(0);
        usersById.set(20, collaborator);

        expect((await model.listPendingForUser(domainId, 101)).length).to.equal(0);
        expect((await model.listPendingForUser(domainId, 102)).map((row) => String(row._id))).to.deep.equal([String(published._id)]);

        students = students.map((student) => (student.boundUserId === 101 ? { ...student, groupIds: [] } : student));
        const studentList = await model.listRequestsForStudent(domainId, 101);
        expect(studentList.map((row) => String(row._id))).to.deep.equal([String(published._id)]);
        const progress = await model.listProgress(await model.getRequest(domainId, published._id));
        expect(progress.find((row) => row.uid === 101)?.leftGroup).to.equal(true);
        expect(progress.find((row) => row.uid === 102)?.status).to.equal('missing');
        const pack = await model.listPackEntries(await model.getRequest(domainId, published._id));
        expect(pack.entries.some((entry) => entry.uid === 101 && entry.leftGroup)).to.equal(true);
        expect(pack.missing.map((row) => row.uid)).to.deep.equal([102]);
        expect(pack.entries[0].name).to.include('24000001');
    });

    it('drops leavers who only uploaded a draft from the student list', async () => {
        const published = await createPublished();
        const body = pdf();
        await model.putStudentFile({
            request: published,
            uid: 102,
            slotId: published.slots[0].id,
            originalName: 'draft.pdf',
            size: body.length,
            bytes: body,
        });
        students = students.map((student) => (student.boundUserId === 102 ? { ...student, groupIds: [] } : student));
        expect((await model.listRequestsForStudent(domainId, 102)).map((row) => String(row._id))).to.deep.equal([]);
        expect((await model.listPendingForUser(domainId, 102)).map((row) => String(row._id))).to.deep.equal([]);
        expect((await model.listRequestsForStudent(domainId, 101)).map((row) => String(row._id))).to.deep.equal([String(published._id)]);
    });
});

describe('krypton-collect files', () => {
    it('rejects empty, mismatched magic, and over-quota uploads', async () => {
        const published = await createPublished({ maxFiles: 1, slots: [{ title: '报告', required: true, allowedExt: ['pdf'], maxFiles: 1 }] });
        await expectReject(
            () => model.putStudentFile({
                request: published,
                uid: 101,
                slotId: published.slots[0].id,
                originalName: 'a.pdf',
                size: 0,
                bytes: Buffer.alloc(0),
            }),
            'CollectFileRejectedError',
            '空文件',
        );
        await expectReject(
            () => model.putStudentFile({
                request: published,
                uid: 101,
                slotId: published.slots[0].id,
                originalName: 'a.pdf',
                size: zip().length,
                bytes: zip(),
            }),
            'CollectFileRejectedError',
            '扩展名',
        );
        const body = pdf();
        await model.putStudentFile({
            request: published,
            uid: 101,
            slotId: published.slots[0].id,
            originalName: 'a.pdf',
            size: body.length,
            bytes: body,
            sha256: sha256(body),
        });
        await expectReject(
            () => model.putStudentFile({
                request: published,
                uid: 101,
                slotId: published.slots[0].id,
                originalName: 'b.pdf',
                size: body.length,
                bytes: body,
            }),
            'CollectFileRejectedError',
            '数量',
        );
    });

    it('stores files, replaces, deletes, confirms, and authorizes downloads', async () => {
        const published = await createPublished();
        const body = pdf('first');
        const added = await model.putStudentFile({
            request: published,
            uid: 101,
            slotId: published.slots[0].id,
            originalName: 'dir/a.pdf',
            size: body.length,
            bytes: body,
        });
        expect(added.file.current).to.equal(true);
        expect(added.file.originalName).to.equal('a.pdf');
        expect(added.file.storagePath).to.equal(`collect/${domainId}/${String(published._id)}/101/${added.file.fileId}`);
        expect(stored.has(added.file.storagePath)).to.equal(true);

        const dir = await mkdtemp(join(tmpdir(), 'collect-'));
        const tempPath = join(dir, 'photo.jpg');
        const image = jpg();
        await writeFile(tempPath, image);
        const replaced = await model.replaceFile({
            request: published,
            uid: 101,
            fileId: added.file.fileId,
            slotId: published.slots[0].id,
            originalName: 'photo.jpeg',
            size: image.length,
            tempPath,
        });
        expect(replaced.file.ext).to.equal('jpg');
        expect(replaced.submission.currentFiles).to.have.length(1);
        expect(replaced.submission.currentFiles[0].fileId).to.equal(replaced.file.fileId);
        expect(filesColl.docs.filter((doc) => doc.current === false)).to.have.length(1);

        await model.confirmSubmit(published, 101);
        const confirmed = await submissionsColl.findOne({ uid: 101 });
        expect(confirmed?.status).to.equal('submitted');

        await model.deleteCurrentFile(published, 101, replaced.file.fileId);
        const afterDelete = await submissionsColl.findOne({ uid: 101 });
        expect(afterDelete?.status).to.equal('draft');
        await expectReject(() => model.confirmSubmit(published, 101), 'CollectFileRejectedError', '必填');

        const restored = pdf('restored');
        const metaId = 'metafile00000001';
        const metaPath = `collect/${domainId}/${String(published._id)}/101/${metaId}`;
        await model.addFileMeta({
            request: published,
            uid: 101,
            slotId: published.slots[0].id,
            originalName: 'c.pdf',
            size: restored.length,
            bytes: restored,
            fileId: metaId,
            storagePath: metaPath,
        });
        const submitted = await model.confirmSubmit(published, 101);
        expect(submitted.status).to.equal('submitted');

        const own = await model.getFileForDownload(published, studentActor, metaId);
        expect(own.fileId).to.equal(metaId);
        await expectReject(() => model.getFileForDownload(published, otherStudent, metaId), 'CollectForbiddenError');
        const teacherFile = await model.getFileForDownload(published, teacher, metaId);
        expect(teacherFile.uid).to.equal(101);
    });

    it('closes the student write window at dueAt and after close', async () => {
        const published = await createPublished();
        const closed = await model.closeRequest(domainId, published._id, teacher, published.revision);
        await expectReject(
            () => model.putStudentFile({
                request: closed,
                uid: 101,
                slotId: closed.slots[0].id,
                originalName: 'a.pdf',
                size: pdf().length,
                bytes: pdf(),
            }),
            'CollectClosedError',
        );

        const open = await createPublished();
        await model.updateRequest(domainId, open._id, teacher, open.revision, { dueAt: new Date(Date.now() - 1000) });
        const stale = await model.getRequest(domainId, open._id);
        await expectReject(
            () => model.putStudentFile({
                request: stale,
                uid: 101,
                slotId: stale.slots[0].id,
                originalName: 'a.pdf',
                size: pdf().length,
                bytes: pdf(),
            }),
            'CollectClosedError',
        );
    });
});

describe('krypton-collect nudge', () => {
    it('returns unsubmitted audience uids and enforces cooldown', async () => {
        const published = await createPublished();
        const body = pdf();
        await model.putStudentFile({
            request: published,
            uid: 101,
            slotId: published.slots[0].id,
            originalName: 'a.pdf',
            size: body.length,
            bytes: body,
        });
        await model.confirmSubmit(published, 101);

        const uids = await model.nudgeUnsubmitted(published, teacher);
        expect(uids).to.deep.equal([102]);
        await expectReject(() => model.nudgeUnsubmitted(published, teacher), 'CollectNudgeRateError');
        await expectReject(() => model.nudgeUnsubmitted(published, studentActor), 'CollectForbiddenError');

        const storedRequest = requestsColl.docs[0];
        storedRequest.lastNudgeAt = new Date(Date.now() - 11 * 60 * 1000);
        const again = await model.nudgeUnsubmitted(await model.getRequest(domainId, published._id), teacher);
        expect(again).to.deep.equal([102]);
    });
});

describe('krypton-collect naming Rev.2', () => {
    it('keeps the default pack path as 学号-姓名/槽/原名', async () => {
        const published = await createPublished({
            slots: [{ title: '实验报告', required: true, allowedExt: ['pdf'], maxFiles: 1 }],
        });
        await submitPdf(published, 101, 'lab.pdf', pdf('lab-101'));
        const pack = await model.listPackEntries(await model.getRequest(domainId, published._id));
        expect(pack.entries.map((entry) => entry.name)).to.deep.equal(['24000001-甲/实验报告/lab.pdf']);
        expect(pack.missing.map((row) => row.uid)).to.deep.equal([102]);
    });

    it('uses a flat assigned name after updating fileNameTemplate and packLayout', async () => {
        const published = await createPublished({
            slots: [{ title: '实验报告', required: true, allowedExt: ['pdf'], maxFiles: 1 }],
        });
        const updated = await model.updateRequest(domainId, published._id, teacher, published.revision, {
            fileNameTemplate: '{studentId}_{realName}_{slotTitle}',
            packLayout: 'flat',
        });
        await submitPdf(updated, 101, 'lab.pdf', pdf('lab-flat'));
        const pack = await model.listPackEntries(await model.getRequest(domainId, published._id));
        expect(pack.entries).to.have.length(1);
        expect(pack.entries[0].name).to.equal('24000001_甲_实验报告.pdf');
        expect(pack.entries[0].name).to.not.include('/');
    });

    it('locks fileNameTemplate after confirmSubmit', async () => {
        const published = await createPublished();
        await submitPdf(published, 101, 'a.pdf', pdf('locked'));
        const current = await model.getRequest(domainId, published._id);
        await expectReject(
            () => model.updateRequest(domainId, current._id, teacher, current.revision, {
                fileNameTemplate: '{studentId}_{realName}_{slotTitle}',
            }),
            'CollectSlotLockedError',
        );
        await expectReject(
            () => model.updateRequest(domainId, current._id, teacher, current.revision, {
                packLayout: 'flat',
            }),
            'CollectSlotLockedError',
        );
    });

    it('lists 预期 names for required slots of unsubmitted audience', async () => {
        const published = await createPublished({
            slots: [
                { title: '实验报告', required: true, allowedExt: ['pdf'], maxFiles: 1 },
                { title: '附件', required: true, allowedExt: ['zip'], maxFiles: 1 },
                { title: '选交', required: false, allowedExt: ['jpg'], maxFiles: 1 },
            ],
        });
        const defaultRows = await model.listExpectedMissingRows(published);
        expect(defaultRows.map((row) => row.uid).sort((left, right) => left - right)).to.deep.equal([101, 101, 102, 102]);
        expect(defaultRows.every((row) => row.slotTitle !== '选交')).to.equal(true);
        expect(defaultRows.every((row) => row.assignedName.includes('未交'))).to.equal(true);

        const updated = await model.updateRequest(domainId, published._id, teacher, published.revision, {
            fileNameTemplate: '{studentId}_{realName}_{slotTitle}',
            packLayout: 'flat',
        });
        const report = updated.slots.find((slot) => slot.title === '实验报告');
        const attachment = updated.slots.find((slot) => slot.title === '附件');
        if (!report || !attachment) expect.fail('expected required slots 实验报告 and 附件');
        const reportBody = pdf('report-101');
        const zipBody = zip();
        await model.putStudentFile({
            request: updated,
            uid: 101,
            slotId: report.id,
            originalName: 'lab.pdf',
            size: reportBody.length,
            bytes: reportBody,
        });
        await model.putStudentFile({
            request: updated,
            uid: 101,
            slotId: attachment.id,
            originalName: 'extra.zip',
            size: zipBody.length,
            bytes: zipBody,
        });
        await model.confirmSubmit(updated, 101);

        const missing = await model.listExpectedMissingRows(await model.getRequest(domainId, published._id));
        expect(missing).to.have.length(2);
        expect(missing.every((row) => row.uid === 102)).to.equal(true);
        const bySlot = new Map(missing.map((row) => [row.slotTitle, row.assignedName]));
        expect(bySlot.get('实验报告')).to.equal('24000002_乙_实验报告.pdf');
        expect(bySlot.get('附件')).to.equal('24000002_乙_附件.zip');
        expect(bySlot.has('选交')).to.equal(false);
    });

    it('annotates progress duplicateCount when two students share sha256', async () => {
        const published = await createPublished();
        const body = pdf('same-bytes');
        const digest = sha256(body);
        await submitPdf(published, 101, 'a.pdf', body);
        await submitPdf(published, 102, 'b.pdf', body);
        const progress = await model.listProgress(await model.getRequest(domainId, published._id));
        const files = progress
            .filter((row) => row.uid === 101 || row.uid === 102)
            .flatMap((row) => row.currentFiles)
            .filter((file) => file.sha256 === digest);
        expect(files).to.have.length(2);
        expect(files.every((file) => file.duplicateCount >= 2)).to.equal(true);
    });
});
