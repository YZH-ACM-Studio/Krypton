import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { PERM, PRIV } from '@hydrooj/common';

const Module = require('module');
const framework = require('../../../framework/framework');
const { ValidationError } = require('../../../framework/framework/error');
const attachLib = require('../../hydrooj/src/lib/user-group-attach');
const { withStudentDirectory } = require('../../hydrooj/src/service/student-directory');
const { InMemoryStudentDirectory } = require('../../hydrooj/src/lib/testing/in-memory-student-directory');

const modelPath = require.resolve('../src/model.ts');
const authPath = require.resolve('../src/auth.ts');
const errorsPath = require.resolve('../src/errors.ts');
const fileValidatePath = require.resolve('../src/file-validate.ts');
const packPath = require.resolve('../src/pack-format.ts');
const nameFormatPath = require.resolve('../src/name-format.ts');
const typesPath = require.resolve('../src/types.ts');

type AnyDoc = Record<string, unknown>;

interface FixtureActor {
    _id: number;
    hasPerm(perm: bigint): boolean;
    hasPriv(priv: number): boolean;
    parentSchoolId?: ObjectId[];
    role?: string;
}

interface DirectoryGroup {
    _id: ObjectId;
    domainId: string;
    schoolId: ObjectId;
    name: string;
    archivedAt?: Date;
    ownerUid?: number;
    teacherAttachable?: true;
}

interface BoundStudent {
    domainId: string;
    schoolId: ObjectId;
    groupIds: ObjectId[];
    boundUserId: number;
    studentId: string;
    realName: string;
}

interface AttachCall {
    actorId: number;
    field: string;
    unrestricted: boolean;
    previous: string[];
    next: string[];
}

interface Thrown {
    name?: string;
    code?: number;
    params?: unknown[];
    message?: string;
}

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
                    throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
                }
            }
            docs.push(copy);
            return { acknowledged: true, insertedId: copy._id };
        },
        async findOne(filter: Record<string, unknown>) {
            const found = query(filter)[0];
            return found ? clone(found) : null;
        },
        async updateOne(filter: Record<string, unknown>, update: { $set: AnyDoc }) {
            const index = docs.findIndex((doc) => matches(doc, filter));
            if (index < 0) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
            Object.assign(docs[index], clone(update.$set));
            return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
        },
        async countDocuments(filter: Record<string, unknown> = {}) {
            return query(filter).length;
        },
    };
}

const requestsColl = memoryCollection([['_id']]);
const submissionsColl = memoryCollection([['domainId', 'requestId', 'uid']]);
const filesColl = memoryCollection([['domainId', 'fileId']]);
const usersById = new Map<number, FixtureActor>();
const attachCalls: AttachCall[] = [];
let nanoidSeq = 0;

const directory = new InMemoryStudentDirectory();
let groups: DirectoryGroup[] = [];
let students: BoundStudent[] = [];

const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    const filename = parent?.filename || '';
    if (request === 'hydrooj' && filename.includes('krypton-collect/src')) {
        return {
            ...framework,
            ObjectId,
            PERM,
            PRIV,
            nanoid: (len = 21) => `f${String(++nanoidSeq).padStart(Math.max(len - 1, 1), '0')}`,
            StorageModel: {},
            UserModel: {
                async getById(_domainId: string, uid: number) {
                    return usersById.get(uid) ?? null;
                },
            },
            assertGroupsAttachable: async (
                domainId: string,
                attachActor: FixtureActor,
                opts: { field: string; previous: readonly ObjectId[]; next: readonly ObjectId[]; unrestricted: boolean },
            ) => {
                attachCalls.push({
                    actorId: attachActor._id,
                    field: opts.field,
                    unrestricted: opts.unrestricted,
                    previous: opts.previous.map((id) => id.toHexString()),
                    next: opts.next.map((id) => id.toHexString()),
                });
                return attachLib.assertGroupsAttachable(domainId, attachActor, opts);
            },
            describeGroupRefs: attachLib.describeGroupRefs,
            listAttachableGroups: attachLib.listAttachableGroups,
            studentDirectory: require('../../hydrooj/src/service/student-directory').studentDirectory,
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
const schoolA = new ObjectId('66c1000000000000000000a1');
const schoolB = new ObjectId('66c1000000000000000000b2');
const ownId = new ObjectId('66c100000000000000000011');
const otherId = new ObjectId('66c100000000000000000012');
const openId = new ObjectId('66c100000000000000000013');
const otherSchoolId = new ObjectId('66c100000000000000000014');
const archivedId = new ObjectId('66c100000000000000000015');
const closedId = new ObjectId('66c100000000000000000016');
const deletedId = new ObjectId('507f1f77bcf86cd799439011');
const ARCHIVED_AT = new Date('2026-03-01T00:00:00.000Z');
const CANNOT_USE = '你不能使用用户组「别人的班」，只能使用自己的用户组或管理员开放给老师的本校用户组';
const DELETED_GROUP = '所选用户组已被删除，请先移除后再保存';

function actor(id: number, flags?: { perms?: bigint[]; privs?: number[]; parentSchoolId?: ObjectId[]; role?: string }): FixtureActor {
    const perms = new Set(flags?.perms ?? []);
    const privs = new Set(flags?.privs ?? []);
    const user: FixtureActor = {
        _id: id,
        hasPerm(perm: bigint) {
            return perms.has(perm);
        },
        hasPriv(priv: number) {
            return privs.has(priv);
        },
    };
    if (flags?.parentSchoolId) user.parentSchoolId = flags.parentSchoolId;
    if (flags?.role) user.role = flags.role;
    return user;
}

const teacher = actor(10, { perms: [PERM.PERM_CREATE_COLLECT], parentSchoolId: [schoolA], role: 'teacher' });
const manager = actor(5, { perms: [PERM.PERM_MANAGE_COLLECT] });
const system = actor(8, { privs: [PRIV.PRIV_EDIT_SYSTEM] });
const collaborator = actor(20, { perms: [PERM.PERM_CREATE_COLLECT], parentSchoolId: [schoolA], role: 'teacher' });

function hex(id: ObjectId): string {
    return id.toHexString();
}

function idList(ids: readonly ObjectId[]): string[] {
    return ids.map((id) => id.toHexString());
}

function futureDate() {
    return new Date(Date.now() + 60 * 60 * 1000);
}

function payload(groupIds: Array<ObjectId | string>, extra: { schoolId?: ObjectId; title?: string } = {}) {
    return {
        schoolId: extra.schoolId ?? schoolA,
        groupIds,
        title: extra.title ?? '收集作业',
        description: '说明',
        slots: [{ title: '报告', required: true, allowedExt: ['pdf'], maxFiles: 1 }],
        dueAt: futureDate(),
    };
}

function dir<T>(fn: () => Promise<T>): Promise<T> {
    return withStudentDirectory(directory, fn);
}

async function thrown(work: () => Promise<unknown>): Promise<Thrown> {
    try {
        await work();
    } catch (error) {
        return error as Thrown;
    }
    expect.fail('expected the call to throw');
    return {};
}

async function createAs(user: FixtureActor, groupIds: Array<ObjectId | string>, extra?: { schoolId?: ObjectId; title?: string }) {
    return dir(() => model.createRequest(domainId, user._id, payload(groupIds, extra), user));
}

async function stored(id: ObjectId) {
    const doc = await requestsColl.findOne({ domainId, _id: id });
    if (!doc) throw new Error(`missing collect ${hex(id)}`);
    return doc as {
        _id: ObjectId;
        title: string;
        status: string;
        revision: number;
        groupIds: ObjectId[];
        ownerUid: number;
        collaboratorUids: number[];
    };
}

const userbind = {
    async findStudentByUserId(targetDomainId: string, uid: number) {
        return students.find((student) => student.domainId === targetDomainId && student.boundUserId === uid) || null;
    },
    async findBoundStudentsByGroupIds(targetDomainId: string, groupIds: ObjectId[]) {
        const want = new Set(groupIds.map((id) => id.toHexString()));
        return students.filter(
            (student) => student.domainId === targetDomainId
                && student.boundUserId > 1
                && student.groupIds.some((id) => want.has(id.toHexString())),
        );
    },
    async listUserGroups(targetDomainId: string, schoolId?: ObjectId) {
        return groups.filter((group) => group.domainId === targetDomainId && (!schoolId || group.schoolId.equals(schoolId)));
    },
};

beforeEach(() => {
    requestsColl.docs.length = 0;
    submissionsColl.docs.length = 0;
    filesColl.docs.length = 0;
    attachCalls.length = 0;
    nanoidSeq = 0;
    usersById.clear();
    usersById.set(teacher._id, teacher);
    usersById.set(manager._id, manager);
    usersById.set(system._id, system);
    usersById.set(collaborator._id, collaborator);
    groups = [
        { _id: ownId, domainId, schoolId: schoolA, name: '我的班', ownerUid: teacher._id },
        { _id: otherId, domainId, schoolId: schoolA, name: '别人的班', ownerUid: 30 },
        { _id: openId, domainId, schoolId: schoolA, name: '开放班', teacherAttachable: true },
        { _id: otherSchoolId, domainId, schoolId: schoolB, name: '外校班', teacherAttachable: true },
        { _id: archivedId, domainId, schoolId: schoolA, name: '归档班', teacherAttachable: true, archivedAt: ARCHIVED_AT },
        { _id: closedId, domainId, schoolId: schoolA, name: '未开放班' },
    ];
    students = [
        {
            domainId,
            schoolId: schoolA,
            groupIds: [ownId, otherId, openId],
            boundUserId: 101,
            studentId: '24000001',
            realName: '甲',
        },
    ];
    directory.schools = [
        { _id: schoolA, domainId, name: '本校' },
        { _id: schoolB, domainId, name: '外校' },
    ];
    directory.groups = groups;
    directory.students = [];
    (globalThis as { Hydro?: { model?: { userbind?: unknown } } }).Hydro = { model: { userbind } };
});

describe('krypton-collect group attach', { concurrency: false }, () => {
    it('rejects a restricted teacher creating a draft with someone else\'s group before insert', async () => {
        expect(teacher.role).to.equal('teacher');
        expect(teacher.hasPriv(PRIV.PRIV_EDIT_SYSTEM)).to.equal(false);
        expect(teacher.hasPerm(PERM.PERM_MANAGE_COLLECT)).to.equal(false);
        const error = await thrown(() => createAs(teacher, [otherId]));
        expect(error.name).to.equal('ValidationError');
        expect(error).to.be.instanceOf(ValidationError);
        expect(error.code).to.not.equal(500);
        expect(error.params?.[0]).to.equal('groupIds');
        expect(error.params?.[1]).to.equal(null);
        expect(error.params?.[2]).to.equal(CANNOT_USE);
        expect(requestsColl.docs).to.have.length(0);
        expect(attachCalls).to.deep.equal([{
            actorId: teacher._id,
            field: 'groupIds',
            unrestricted: false,
            previous: [],
            next: [hex(otherId)],
        }]);
    });

    it('rejects a restricted draft update that adds an unattachable group and leaves the document unchanged', async () => {
        const created = await createAs(teacher, [ownId]);
        attachCalls.length = 0;
        const error = await thrown(() => dir(() => model.updateRequest(domainId, created._id, teacher, created.revision, {
            title: '不该写入',
            groupIds: [ownId, otherId],
        })));
        expect(error.name).to.equal('ValidationError');
        expect(error.params?.[2]).to.equal(CANNOT_USE);
        const doc = await stored(created._id);
        expect(doc.title).to.equal('收集作业');
        expect(doc.revision).to.equal(1);
        expect(idList(doc.groupIds)).to.deep.equal([hex(ownId)]);
        expect(attachCalls[0].previous).to.deep.equal([hex(ownId)]);
        expect(attachCalls[0].next).to.deep.equal([hex(ownId), hex(otherId)]);
        expect(attachCalls[0].unrestricted).to.equal(false);
    });

    it('keeps an already attached unattachable group when the stored ids are unchanged', async () => {
        const created = await createAs(teacher, [ownId]);
        const widened = await dir(() => model.updateRequest(domainId, created._id, manager, created.revision, {
            groupIds: [ownId, otherId],
        }));
        expect(idList(widened.groupIds)).to.deep.equal([hex(ownId), hex(otherId)]);
        attachCalls.length = 0;
        const titled = await dir(() => model.updateRequest(domainId, widened._id, teacher, widened.revision, {
            title: '只改标题',
        }));
        expect(titled.title).to.equal('只改标题');
        expect(idList(titled.groupIds)).to.deep.equal([hex(ownId), hex(otherId)]);
        expect(attachCalls).to.deep.equal([{
            actorId: teacher._id,
            field: 'groupIds',
            unrestricted: false,
            previous: [hex(ownId), hex(otherId)],
            next: [hex(ownId), hex(otherId)],
        }]);
        const resent = await dir(() => model.updateRequest(domainId, titled._id, teacher, titled.revision, {
            groupIds: [ownId, otherId],
        }));
        expect(idList(resent.groupIds)).to.deep.equal([hex(ownId), hex(otherId)]);
        expect(resent.revision).to.equal(titled.revision + 1);
    });

    it('allows removing an unattachable group and an explicit empty list', async () => {
        const created = await createAs(teacher, [ownId]);
        const widened = await dir(() => model.updateRequest(domainId, created._id, manager, created.revision, {
            groupIds: [ownId, otherId],
        }));
        attachCalls.length = 0;
        const removed = await dir(() => model.updateRequest(domainId, widened._id, teacher, widened.revision, {
            groupIds: [ownId],
        }));
        expect(idList(removed.groupIds)).to.deep.equal([hex(ownId)]);
        expect(attachCalls[0].previous).to.deep.equal([hex(ownId), hex(otherId)]);
        expect(attachCalls[0].next).to.deep.equal([hex(ownId)]);
        const cleared = await dir(() => model.updateRequest(domainId, removed._id, teacher, removed.revision, {
            groupIds: [],
        }));
        expect(cleared.groupIds).to.deep.equal([]);
        expect(attachCalls[1].previous).to.deep.equal([hex(ownId)]);
        expect(attachCalls[1].next).to.deep.equal([]);
    });

    it('rejects an illegal group id with CollectFileRejectedError and does not turn it into a 500', async () => {
        const createdError = await thrown(() => createAs(teacher, ['not-a-valid-id']));
        expect(createdError.name).to.equal('CollectFileRejectedError');
        expect(createdError.code).to.equal(400);
        expect(createdError.code).to.not.equal(500);
        expect(String(createdError.params?.[0])).to.include('不合法');
        expect(createdError.name).to.not.equal('ValidationError');
        expect(requestsColl.docs).to.have.length(0);
        expect(attachCalls).to.have.length(0);

        const created = await createAs(teacher, [ownId]);
        attachCalls.length = 0;
        const updatedError = await thrown(() => dir(() => model.updateRequest(domainId, created._id, teacher, created.revision, {
            title: '不该写入',
            groupIds: ['not-a-valid-id'],
        })));
        expect(updatedError.name).to.equal('CollectFileRejectedError');
        expect(updatedError.code).to.equal(400);
        expect(String(updatedError.params?.[0])).to.include('groupIds');
        expect(String(updatedError.params?.[0])).to.include('不合法');
        expect(attachCalls).to.have.length(0);
        const doc = await stored(created._id);
        expect(doc.title).to.equal('收集作业');
        expect(idList(doc.groupIds)).to.deep.equal([hex(ownId)]);
    });

    it('rejects a missing group id on draft create and on a draft update after the group is deleted', async () => {
        const createdError = await thrown(() => createAs(teacher, [deletedId]));
        expect(createdError.name).to.equal('ValidationError');
        expect(createdError.code).to.not.equal(500);
        expect(createdError.params?.[0]).to.equal('groupIds');
        expect(createdError.params?.[2]).to.equal(DELETED_GROUP);
        expect(requestsColl.docs).to.have.length(0);

        const created = await createAs(teacher, [ownId]);
        const index = groups.findIndex((group) => group._id.equals(ownId));
        groups.splice(index, 1);
        const updatedError = await thrown(() => dir(() => model.updateRequest(domainId, created._id, teacher, created.revision, {
            title: '不该写入',
        })));
        expect(updatedError.name).to.equal('ValidationError');
        expect(updatedError.params?.[2]).to.equal(DELETED_GROUP);
        const doc = await stored(created._id);
        expect(doc.title).to.equal('收集作业');
        expect(doc.status).to.equal('draft');
        expect(idList(doc.groupIds)).to.deep.equal([hex(ownId)]);
    });

    it('still enforces the same-school check after attach, and not on draft create', async () => {
        const draft = await createAs(manager, [otherSchoolId]);
        expect(draft.status).to.equal('draft');
        expect(idList(draft.groupIds)).to.deep.equal([hex(otherSchoolId)]);
        expect(attachCalls.at(-1)?.unrestricted).to.equal(true);
        attachCalls.length = 0;
        const publishError = await thrown(() => dir(() => model.publishRequest(domainId, draft._id, manager, draft.revision)));
        expect(publishError.name).to.equal('CollectFileRejectedError');
        expect(publishError.code).to.equal(400);
        expect(String(publishError.params?.[0])).to.include('不属于该学校');
        expect(attachCalls).to.have.length(0);
        const unpublished = await stored(draft._id);
        expect(unpublished.status).to.equal('draft');

        const ownDraft = await createAs(teacher, [ownId]);
        const published = await dir(() => model.publishRequest(domainId, ownDraft._id, teacher, ownDraft.revision));
        expect(published.status).to.equal('published');
        attachCalls.length = 0;
        const updateError = await thrown(() => dir(() => model.updateRequest(domainId, published._id, teacher, published.revision, {
            groupIds: [otherSchoolId],
        })));
        expect(updateError.name).to.equal('CollectFileRejectedError');
        expect(String(updateError.params?.[0])).to.include('不属于该学校');
        expect(attachCalls).to.have.length(0);
        const doc = await stored(published._id);
        expect(doc.status).to.equal('published');
        expect(idList(doc.groupIds)).to.deep.equal([hex(ownId)]);
    });

    it('lets a restricted teacher attach an open group in parentSchoolId scope and rejects the others', async () => {
        const open = await createAs(teacher, [openId]);
        expect(idList(open.groupIds)).to.deep.equal([hex(openId)]);
        for (const [id, name] of [[closedId, '未开放班'], [archivedId, '归档班'], [otherSchoolId, '外校班']] as const) {
            const error = await thrown(() => createAs(teacher, [id]));
            expect(error.name).to.equal('ValidationError');
            expect(error.params?.[2]).to.equal(`你不能使用用户组「${name}」，只能使用自己的用户组或管理员开放给老师的本校用户组`);
        }
        expect(directory.schools.every((school) => school.staffUids === undefined)).to.equal(true);
        expect(directory.students).to.deep.equal([]);
    });

    it('does not let a collaborator write, and does not cache unrestricted from another actor', async () => {
        const created = await createAs(teacher, [ownId]);
        const shared = await model.setCollaborators(domainId, created._id, teacher, created.revision, [collaborator._id]);
        expect(shared.collaboratorUids).to.deep.equal([collaborator._id]);
        attachCalls.length = 0;
        const updateError = await thrown(() => dir(() => model.updateRequest(domainId, shared._id, collaborator, shared.revision, {
            title: '协作者改',
            groupIds: [otherId],
        })));
        expect(updateError.name).to.equal('CollectForbiddenError');
        expect(String(updateError.params?.[0])).to.include('无权编辑');
        expect(attachCalls).to.have.length(0);
        const publishError = await thrown(() => dir(() => model.publishRequest(domainId, shared._id, collaborator, shared.revision)));
        expect(publishError.name).to.equal('CollectForbiddenError');
        expect(String(publishError.params?.[0])).to.include('无权编辑');
        expect(attachCalls).to.have.length(0);
        const doc = await stored(created._id);
        expect(doc.title).to.equal('收集作业');
        expect(doc.status).to.equal('draft');
        expect(doc.revision).to.equal(shared.revision);
        expect(idList(doc.groupIds)).to.deep.equal([hex(ownId)]);

        const denied = await thrown(() => createAs(teacher, [otherId]));
        expect(denied.params?.[2]).to.equal(CANNOT_USE);
        const byManager = await createAs(manager, [otherId]);
        expect(byManager.ownerUid).to.equal(manager._id);
        expect(attachCalls.at(-1)?.unrestricted).to.equal(true);
        expect(manager.hasPriv(PRIV.PRIV_EDIT_SYSTEM)).to.equal(false);
        const deniedAgain = await thrown(() => createAs(teacher, [otherId]));
        expect(deniedAgain.params?.[2]).to.equal(CANNOT_USE);
        const bySystem = await createAs(system, [otherId, archivedId]);
        expect(idList(bySystem.groupIds)).to.deep.equal([hex(otherId), hex(archivedId)]);
        expect(system.hasPerm(PERM.PERM_MANAGE_COLLECT)).to.equal(false);
        expect(system.role).to.equal(undefined);
        expect(attachCalls.at(-1)).to.deep.include({ actorId: system._id, unrestricted: true, field: 'groupIds' });
    });

    it('builds editor rows from directory fields and appends a deleted saved id without schoolId', async () => {
        const empty = await dir(() => model.listCollectEditorGroups(domainId, teacher, []));
        expect(empty).to.deep.equal([
            { _id: hex(openId), name: '开放班', schoolId: hex(schoolA) },
            { _id: hex(ownId), name: '我的班', schoolId: hex(schoolA) },
        ]);

        const saved = await dir(() => model.listCollectEditorGroups(domainId, teacher, [otherId, archivedId, deletedId, ownId]));
        expect(saved).to.deep.equal([
            { _id: hex(openId), name: '开放班', schoolId: hex(schoolA) },
            { _id: hex(ownId), name: '我的班', schoolId: hex(schoolA) },
            { _id: hex(otherId), name: '别人的班', schoolId: hex(schoolA) },
            { _id: hex(archivedId), name: '归档班', schoolId: hex(schoolA), archivedAt: ARCHIVED_AT.toISOString() },
            { _id: hex(deletedId), name: '已删除的组' },
        ]);
        expect(saved[4]).to.not.have.property('schoolId');
        expect(saved[4]).to.not.have.property('archivedAt');

        const all = await dir(() => model.listCollectEditorGroups(domainId, manager, []));
        expect(all.map((row) => row.name)).to.deep.equal(['外校班', '别人的班', '开放班', '归档班', '我的班', '未开放班']);
        expect(all[0]).to.deep.equal({ _id: hex(otherSchoolId), name: '外校班', schoolId: hex(schoolB) });
        expect(all.every((row) => typeof row.schoolId === 'string' && row.schoolId.length === 24)).to.equal(true);
        const archived = all.find((row) => row._id === hex(archivedId));
        expect(archived?.archivedAt).to.equal(ARCHIVED_AT.toISOString());

        const withDeleted = await dir(() => model.listCollectEditorGroups(domainId, system, [deletedId]));
        expect(withDeleted.at(-1)).to.deep.equal({ _id: hex(deletedId), name: '已删除的组' });
        expect(withDeleted).to.have.length(all.length + 1);
        expect(system.hasPerm(PERM.PERM_MANAGE_COLLECT)).to.equal(false);
    });

    it('wires the edit selector through listCollectEditorGroups and leaves the list catalog unfiltered', () => {
        const handlerSource = readFileSync(resolve(__dirname, '../src/handler.ts'), 'utf8');
        function sliceClass(name: string) {
            const start = handlerSource.indexOf(`class ${name}`);
            expect(start, `missing ${name}`).to.be.at.least(0);
            const next = handlerSource.indexOf('\nclass ', start + 1);
            return handlerSource.slice(start, next === -1 ? undefined : next);
        }
        const edit = sliceClass('AdminCollectEditHandler');
        const list = sliceClass('AdminCollectListHandler');
        const actorAt = edit.indexOf('const actor = actorOf(this)');
        const savedAt = edit.indexOf('savedGroupIds = request.groupIds');
        const selector = [
            'const editorGroupIds = id',
            '            ? savedGroupIds',
            "            : parseGroupIdList('groupIds', prefill.prefillGroupIds);",
        ].join('\n');
        const selectorAt = edit.indexOf(selector);
        const groupsAt = edit.indexOf('listCollectEditorGroups(domainId, actor, editorGroupIds)');
        const hydroEnd = handlerSource.indexOf("} from 'hydrooj'");
        expect(actorAt).to.be.at.least(0);
        expect(savedAt).to.be.greaterThan(actorAt);
        expect(selectorAt).to.be.greaterThan(savedAt);
        expect(groupsAt).to.be.greaterThan(selectorAt);
        expect(hydroEnd).to.be.at.least(0);
        expect(handlerSource.slice(0, hydroEnd)).to.include('parseGroupIdList');
        expect(edit).to.include('...catalog,\n            groups,');
        expect(edit).to.include('createRequest(domainId, this.user._id, patch, actorOf(this))');
        expect(list).to.not.include('listCollectEditorGroups');
        expect(list).to.include('schools: catalog.schools');
        expect(list).to.not.include('groups:');
        expect(handlerSource).to.include('async function loadCatalog');
        expect(handlerSource).to.include('ub.listSchools(domainId)');
        const catalogAt = handlerSource.indexOf('async function loadCatalog');
        const catalogBody = handlerSource.slice(catalogAt, handlerSource.indexOf('\nfunction ', catalogAt + 1));
        expect(catalogBody).to.not.include('listAttachableGroups');
        expect(catalogBody).to.not.include('listCollectEditorGroups');
    });
});
