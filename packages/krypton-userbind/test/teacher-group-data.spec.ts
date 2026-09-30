import { sep } from 'node:path';
import { expect } from 'chai';
import { Document, ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';
import { localizedErrorText, localizeErrorParameter, SystemError, ValidationError } from '@hydrooj/framework';
import type { StudentRecord, UserGroup } from '../src/types';

class FakeCollection {
    docs: Document[] = [];
    indexes: Array<{ key: Record<string, number>; options?: Record<string, unknown> }> = [];

    clear() {
        this.docs.length = 0;
    }

    async findOne(filter: Record<string, unknown> = {}) {
        const found = this.docs.find((doc) => matchesFilter(doc, filter));
        return found ? cloneDoc(found) : null;
    }

    find(filter: Record<string, unknown> = {}) {
        const matched = this.docs.filter((doc) => matchesFilter(doc, filter)).map(cloneDoc);
        const cursor = {
            toArray: async () => matched,
            sort: (spec?: Record<string, number>) => {
                if (spec) {
                    const keys = Object.entries(spec);
                    matched.sort((left, right) => {
                        for (const [key, direction] of keys) {
                            if (direction !== 1 && direction !== -1) continue;
                            const av = left[key];
                            const bv = right[key];
                            if (av === bv) continue;
                            if (av < bv) return direction === 1 ? -1 : 1;
                            if (av > bv) return direction === 1 ? 1 : -1;
                        }
                        return 0;
                    });
                }
                return cursor;
            },
            skip: () => cursor,
            limit: () => cursor,
        };
        return cursor;
    }

    async insertOne(doc: Document) {
        this.docs.push(cloneDoc(doc));
        return { insertedId: doc._id };
    }

    async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>) {
        const index = this.docs.findIndex((doc) => matchesFilter(doc, filter));
        if (index < 0) return { matchedCount: 0, modifiedCount: 0 };
        applyUpdate(this.docs[index], update);
        return { matchedCount: 1, modifiedCount: 1 };
    }

    async deleteOne(filter: Record<string, unknown>) {
        const index = this.docs.findIndex((doc) => matchesFilter(doc, filter));
        if (index < 0) return { deletedCount: 0 };
        this.docs.splice(index, 1);
        return { deletedCount: 1 };
    }

    async deleteMany(filter: Record<string, unknown>) {
        const before = this.docs.length;
        this.docs = this.docs.filter((doc) => !matchesFilter(doc, filter));
        return { deletedCount: before - this.docs.length };
    }

    async countDocuments(filter: Record<string, unknown> = {}) {
        return this.docs.filter((doc) => matchesFilter(doc, filter)).length;
    }

    async createIndex(key: Record<string, number>, options?: Record<string, unknown>) {
        this.indexes.push({ key: { ...key }, options });
        return 'index';
    }
}

function cloneDoc<T extends Document>(doc: T): T {
    const out: Document = { ...doc };
    for (const key of Object.keys(out)) {
        if (Array.isArray(out[key])) out[key] = [...(out[key] as unknown[])];
    }
    return out as T;
}

function valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    if (typeof (a as { equals?: unknown }).equals === 'function') {
        return Boolean((a as { equals: (other: unknown) => boolean }).equals(b));
    }
    if (typeof (b as { equals?: unknown }).equals === 'function') {
        return Boolean((b as { equals: (other: unknown) => boolean }).equals(a));
    }
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    return false;
}

function arraysEqual(left: unknown[], right: unknown[]): boolean {
    return left.length === right.length && left.every((item, index) => valuesEqual(item, right[index]));
}

function isOperator(value: unknown): value is Record<string, unknown> {
    if (value == null || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) return false;
    if (typeof (value as { equals?: unknown }).equals === 'function') return false;
    return Object.keys(value as object).some((key) => key.startsWith('$'));
}

function valuesAt(value: unknown, parts: string[]): unknown[] {
    if (parts.length === 0) return [value];
    if (Array.isArray(value)) return value.flatMap((item) => valuesAt(item, parts));
    if (value == null || typeof value !== 'object') return [];
    const [head, ...rest] = parts;
    if (!Object.hasOwn(value, head)) return [];
    return valuesAt((value as Record<string, unknown>)[head], rest);
}

function matchesValue(docValue: unknown, expected: unknown): boolean {
    if (Array.isArray(docValue) && Array.isArray(expected)) return arraysEqual(docValue, expected);
    if (Array.isArray(docValue) && !Array.isArray(expected)) return docValue.some((item) => valuesEqual(item, expected));
    return valuesEqual(docValue, expected);
}

function matchesFilter(doc: Document, filter: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(filter || {})) {
        if (key === '$or') {
            const clauses = value as Array<Record<string, unknown>>;
            if (!clauses.some((clause) => matchesFilter(doc, clause))) return false;
            continue;
        }
        const docValue = key.includes('.') ? valuesAt(doc, key.split('.')) : doc[key];
        if (key.includes('.')) {
            const found = docValue as unknown[];
            if (!found.some((item) => matchesValue(item, value))) return false;
            continue;
        }
        if (isOperator(value)) {
            if ('$in' in value && !((value.$in as unknown[]) || []).some((item) => valuesEqual(docValue, item))) return false;
            if ('$ne' in value && valuesEqual(docValue, value.$ne)) return false;
            continue;
        }
        if (!matchesValue(docValue, value)) return false;
    }
    return true;
}

function applyAddToSet(doc: Document, addToSet: Record<string, unknown>) {
    for (const [key, raw] of Object.entries(addToSet)) {
        const values = raw && typeof raw === 'object' && '$each' in (raw as object) ? ((raw as { $each: unknown[] }).$each ?? []) : [raw];
        if (!Array.isArray(doc[key])) doc[key] = doc[key] == null ? [] : [doc[key]];
        const arr = doc[key] as unknown[];
        for (const value of values) {
            if (!arr.some((item) => valuesEqual(item, value))) arr.push(value);
        }
    }
}

function applyPull(doc: Document, pull: Record<string, unknown>) {
    for (const [key, raw] of Object.entries(pull)) {
        if (!Array.isArray(doc[key])) continue;
        const deny = raw && typeof raw === 'object' && '$in' in (raw as object) ? ((raw as { $in: unknown[] }).$in ?? []) : [raw];
        doc[key] = (doc[key] as unknown[]).filter((item) => !deny.some((value) => valuesEqual(item, value)));
    }
}

function applyUpdate(doc: Document, update: Record<string, unknown>) {
    if (update.$set && typeof update.$set === 'object') Object.assign(doc, update.$set);
    if (update.$unset && typeof update.$unset === 'object') {
        for (const key of Object.keys(update.$unset as object)) delete doc[key];
    }
    if (update.$addToSet && typeof update.$addToSet === 'object') applyAddToSet(doc, update.$addToSet as Record<string, unknown>);
    if (update.$pull && typeof update.$pull === 'object') applyPull(doc, update.$pull as Record<string, unknown>);
}

const collections = new Map<string, FakeCollection>();

function collection(name: string): FakeCollection {
    let coll = collections.get(name);
    if (!coll) {
        coll = new FakeCollection();
        collections.set(name, coll);
    }
    return coll;
}

function loadModel() {
    const Module = require('module');
    const originalLoad = Module._load;
    Module._load = function load(request: string, parent: unknown, isMain: boolean) {
        if (request === 'hydrooj') {
            return {
                db: { collection: (name: string) => collection(name) },
                ObjectId,
                UserModel: { coll: new FakeCollection() },
                ValidationError,
                localizedErrorText,
                localizeErrorParameter,
                SystemError,
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        for (const key of Object.keys(require.cache)) {
            if (key.includes(`${sep}krypton-userbind${sep}src${sep}`)) delete require.cache[key];
        }
        return require('../src/model');
    } finally {
        Module._load = originalLoad;
    }
}

const {
    addSchoolStaff,
    clearGroupOwner,
    createUserGroup,
    deleteTeacherCreatedStudent,
    deleteUserGroup,
    ensureIndexes,
    listTeacherGroups,
    removeSchoolStaff,
    setGroupOwner,
    setGroupTeacherAttachable,
    userBindModel,
} = loadModel();

const domainId = 'system';
const actorUid = 7;
const schools = collection('userbind.schools');
const groups = collection('userbind.user_groups');
const students = collection('userbind.students');
const tokens = collection('userbind.bind_tokens');
const documents = collection('document');
const tasks = collection('tasks.tasks');
const collects = collection('collect.requests');

let schoolId: ObjectId;

function userGroup(overrides: Partial<UserGroup> = {}): UserGroup {
    return {
        _id: new ObjectId(),
        domainId,
        schoolId,
        name: '一班',
        createdAt: new Date('2026-09-01T00:00:00Z'),
        createdBy: 2,
        ...overrides,
    };
}

function studentRecord(overrides: Partial<StudentRecord> = {}): StudentRecord {
    return {
        _id: new ObjectId(),
        domainId,
        schoolId,
        studentId: '240340179',
        realName: '张三',
        groupIds: [],
        boundUserId: null,
        boundAt: null,
        enrollmentYear: 2024,
        createdAt: new Date('2026-09-01T00:00:00Z'),
        createdBy: actorUid,
        ...overrides,
    };
}

function errorDetail(error: unknown): string {
    const params = (error as { params?: unknown[] })?.params || [];
    return [String((error as Error).message || ''), ...params.map((value) => String(value))].join(' ');
}

async function captureFailure(run: Promise<unknown>): Promise<unknown> {
    try {
        await run;
        return null;
    } catch (error) {
        return error;
    }
}

function copyId(id: ObjectId): ObjectId {
    return new ObjectId(id.toHexString());
}

describe('teacher group data layer', { concurrency: false }, () => {
    beforeEach(async () => {
        for (const coll of collections.values()) coll.clear();
        schoolId = new ObjectId();
        await schools.insertOne({
            _id: schoolId,
            domainId,
            name: '计算机学院',
            createdAt: new Date('2026-09-01T00:00:00Z'),
            createdBy: 2,
        });
    });

    it('exposes the new model functions on userBindModel', () => {
        expect(userBindModel.createUserGroup).to.equal(createUserGroup);
        expect(userBindModel.deleteUserGroup).to.equal(deleteUserGroup);
        expect(userBindModel.addSchoolStaff).to.equal(addSchoolStaff);
        expect(userBindModel.removeSchoolStaff).to.equal(removeSchoolStaff);
        expect(userBindModel.setGroupTeacherAttachable).to.equal(setGroupTeacherAttachable);
        expect(userBindModel.setGroupOwner).to.equal(setGroupOwner);
        expect(userBindModel.clearGroupOwner).to.equal(clearGroupOwner);
        expect(userBindModel.listTeacherGroups).to.equal(listTeacherGroups);
        expect(userBindModel.deleteTeacherCreatedStudent).to.equal(deleteTeacherCreatedStudent);
    });

    it('creates a normal ownerUid index without a partial filter', async () => {
        await ensureIndexes();
        const ownerIndexes = groups.indexes.filter((index) => Object.hasOwn(index.key, 'ownerUid'));
        expect(ownerIndexes).to.have.length(1);
        expect(ownerIndexes[0].key).to.deep.equal({ domainId: 1, ownerUid: 1 });
        expect(ownerIndexes[0].options?.partialFilterExpression).to.equal(undefined);
        expect(ownerIndexes[0].options?.unique).to.not.equal(true);
    });

    it('writes ownerUid only when createUserGroup is given one', async () => {
        const ownedId = new ObjectId();
        const plainId = new ObjectId();
        const zeroId = new ObjectId();
        const owned = await createUserGroup(domainId, schoolId, '老师班', 2, ownedId, { ownerUid: 8 });
        const plain = await createUserGroup(domainId, schoolId, '学校班', 2, plainId);
        const zero = await createUserGroup(domainId, schoolId, '零号', 2, zeroId, { ownerUid: 0 });
        expect(owned.ownerUid).to.equal(8);
        expect(Object.hasOwn(owned, 'ownerUid')).to.equal(true);
        expect(Object.hasOwn(await groups.findOne({ _id: ownedId }), 'ownerUid')).to.equal(true);
        expect((await groups.findOne({ _id: ownedId })).ownerUid).to.equal(8);
        expect(Object.hasOwn(plain, 'ownerUid')).to.equal(false);
        expect(Object.hasOwn(await groups.findOne({ _id: plainId }), 'ownerUid')).to.equal(false);
        expect(zero.ownerUid).to.equal(0);
        expect(Object.hasOwn(await groups.findOne({ _id: zeroId }), 'ownerUid')).to.equal(true);
    });

    it('returns without deleting when the user group is already gone', async () => {
        await deleteUserGroup(domainId, new ObjectId());
    });

    it('refuses to delete a user group that is not archived', async () => {
        const group = userGroup();
        await groups.insertOne(group);
        const failed = await captureFailure(deleteUserGroup(domainId, group._id));
        expect(failed).to.be.instanceOf(ValidationError);
        expect(errorDetail(failed)).to.include('请先归档该用户组，只有已归档的用户组才能永久删除');
        expect(await groups.findOne({ _id: group._id })).to.not.equal(null);
    });

    it('refuses to delete a user group that still has members', async () => {
        const group = userGroup({ archivedAt: new Date('2026-09-02T00:00:00Z') });
        await groups.insertOne(group);
        await students.insertOne(studentRecord({ groupIds: [group._id] }));
        await students.insertOne(studentRecord({ domainId: 'other', schoolId: new ObjectId(), groupIds: [group._id] }));
        const failed = await captureFailure(deleteUserGroup(domainId, group._id));
        expect(failed).to.be.instanceOf(ValidationError);
        expect(errorDetail(failed)).to.include('该用户组仍有 1 名成员，请先移除全部成员');
        expect(await groups.findOne({ _id: group._id })).to.not.equal(null);
    });

    it('refuses to delete a user group referenced by courseGroupIds', async () => {
        const group = userGroup({ archivedAt: new Date('2026-09-02T00:00:00Z') });
        await groups.insertOne(group);
        await documents.insertOne({ domainId, docType: 40, courseGroupIds: [group._id] });
        await documents.insertOne({ domainId, docType: 40, courseGroupIds: [group._id] });
        await documents.insertOne({ domainId: 'other', docType: 40, courseGroupIds: [group._id] });
        await documents.insertOne({ domainId, docType: 30, courseGroupIds: [group._id] });
        const failed = await captureFailure(deleteUserGroup(domainId, group._id));
        expect(failed).to.be.instanceOf(ValidationError);
        expect(errorDetail(failed)).to.include('该用户组被 2 门课程引用，请先在课程中移除');
        expect(await groups.findOne({ _id: group._id })).to.not.equal(null);
    });

    it('does not treat legacy document.groupIds as a course reference', async () => {
        const group = userGroup({ archivedAt: new Date('2026-09-02T00:00:00Z') });
        await groups.insertOne(group);
        await documents.insertOne({ domainId, docType: 40, groupIds: [group._id] });
        await deleteUserGroup(domainId, group._id);
        expect(await groups.findOne({ _id: group._id })).to.equal(null);
    });

    it('refuses to delete a user group referenced by a file collection', async () => {
        const group = userGroup({ archivedAt: new Date('2026-09-02T00:00:00Z') });
        await groups.insertOne(group);
        await documents.insertOne({ domainId, docType: 40, groupIds: [group._id] });
        await collects.insertOne({ domainId, groupIds: [group._id] });
        await collects.insertOne({ domainId, groupIds: [group._id] });
        await collects.insertOne({ domainId: 'other', groupIds: [group._id] });
        const failed = await captureFailure(deleteUserGroup(domainId, group._id));
        expect(failed).to.be.instanceOf(ValidationError);
        expect(errorDetail(failed)).to.include('该用户组被 2 个文件收集引用，请先在其中移除');
        expect(await groups.findOne({ _id: group._id })).to.not.equal(null);
    });

    it('refuses to delete a user group referenced by a task graph node', async () => {
        const group = userGroup({ archivedAt: new Date('2026-09-02T00:00:00Z') });
        await groups.insertOne(group);
        await tasks.insertOne({
            domainId,
            graph: { nodes: [{ params: { targetId: group._id.toHexString() } }] },
        });
        await tasks.insertOne({
            domainId: 'other',
            graph: { nodes: [{ params: { targetId: group._id.toHexString() } }] },
        });
        const failed = await captureFailure(deleteUserGroup(domainId, group._id));
        expect(failed).to.be.instanceOf(ValidationError);
        expect(errorDetail(failed)).to.include('该用户组被 1 个任务引用（图节点或可见范围），请先在任务中移除');
        expect(await groups.findOne({ _id: group._id })).to.not.equal(null);
    });

    it('refuses to delete a user group referenced by task access', async () => {
        const group = userGroup({ archivedAt: new Date('2026-09-02T00:00:00Z') });
        await groups.insertOne(group);
        await tasks.insertOne({
            domainId,
            access: { type: 'user_group', targetId: group._id },
        });
        const failed = await captureFailure(deleteUserGroup(domainId, group._id));
        expect(failed).to.be.instanceOf(ValidationError);
        expect(errorDetail(failed)).to.include('该用户组被 1 个任务引用（图节点或可见范围），请先在任务中移除');
        expect(await groups.findOne({ _id: group._id })).to.not.equal(null);
    });

    it('refuses to delete a user group referenced by a contest or homework', async () => {
        const group = userGroup({ archivedAt: new Date('2026-09-02T00:00:00Z') });
        await groups.insertOne(group);
        await documents.insertOne({ domainId, docType: 30, participantGroupIds: [group._id] });
        await documents.insertOne({ domainId, docType: 40, participantGroupIds: [group._id] });
        const failed = await captureFailure(deleteUserGroup(domainId, group._id));
        expect(failed).to.be.instanceOf(ValidationError);
        expect(errorDetail(failed)).to.include('该用户组被 1 个比赛/作业的参赛范围引用，请先在其中移除');
        expect(await groups.findOne({ _id: group._id })).to.not.equal(null);
    });

    it('deletes an archived group with no members or live references and drops its invite tokens', async () => {
        const group = userGroup({ archivedAt: new Date('2026-09-02T00:00:00Z') });
        await groups.insertOne(group);
        await tokens.insertOne({ _id: 'drop-group', domainId, kind: 'user_group', userGroupId: group._id });
        await tokens.insertOne({ _id: 'keep-student', domainId, kind: 'student', studentRecordId: new ObjectId() });
        await tokens.insertOne({ _id: 'other-domain', domainId: 'other', kind: 'user_group', userGroupId: group._id });
        await tokens.insertOne({ _id: 'other-group', domainId, kind: 'user_group', userGroupId: new ObjectId() });
        await deleteUserGroup(domainId, group._id);
        expect(await groups.findOne({ _id: group._id })).to.equal(null);
        expect(await tokens.findOne({ _id: 'drop-group' })).to.equal(null);
        expect(await tokens.findOne({ _id: 'keep-student' })).to.not.equal(null);
        expect(await tokens.findOne({ _id: 'other-domain' })).to.not.equal(null);
        expect(await tokens.findOne({ _id: 'other-group' })).to.not.equal(null);
    });

    it('rejects opening a teacher-owned group and unsets teacherAttachable when the value is false', async () => {
        const missing = await captureFailure(setGroupTeacherAttachable(domainId, new ObjectId(), true));
        expect(missing).to.be.instanceOf(ValidationError);
        expect(errorDetail(missing)).to.include('用户组不存在');

        const teacherGroup = userGroup({ ownerUid: 8 });
        await groups.insertOne(teacherGroup);
        const rejected = await captureFailure(setGroupTeacherAttachable(domainId, teacherGroup._id, true));
        expect(rejected).to.be.instanceOf(ValidationError);
        expect(errorDetail(rejected)).to.include('老师的用户组不需要开放给老师使用');
        expect(Object.hasOwn(await groups.findOne({ _id: teacherGroup._id }), 'teacherAttachable')).to.equal(false);

        const schoolGroup = userGroup({ name: '学校班' });
        await groups.insertOne(schoolGroup);
        await setGroupTeacherAttachable(domainId, schoolGroup._id, true);
        expect((await groups.findOne({ _id: schoolGroup._id })).teacherAttachable).to.equal(true);
        await setGroupTeacherAttachable(domainId, schoolGroup._id, false);
        expect(Object.hasOwn(await groups.findOne({ _id: schoolGroup._id }), 'teacherAttachable')).to.equal(false);
    });

    it('sets the owner and clears teacherAttachable without looking up the user', async () => {
        const group = userGroup({ teacherAttachable: true });
        await groups.insertOne(group);
        await setGroupOwner(domainId, group._id, 9);
        const stored = await groups.findOne({ _id: group._id });
        expect(stored.ownerUid).to.equal(9);
        expect(Object.hasOwn(stored, 'teacherAttachable')).to.equal(false);
        await setGroupOwner(domainId, new ObjectId(), 9);
    });

    it('clears ownerUid and leaves teacherAttachable untouched', async () => {
        const group = userGroup({ ownerUid: 4, teacherAttachable: true });
        await groups.insertOne(group);
        await clearGroupOwner(domainId, group._id);
        const stored = await groups.findOne({ _id: group._id });
        expect(Object.hasOwn(stored, 'ownerUid')).to.equal(false);
        expect(stored.teacherAttachable).to.equal(true);
        await clearGroupOwner(domainId, new ObjectId());
    });

    it('adds school staff once and can remove them', async () => {
        const missing = await captureFailure(addSchoolStaff(domainId, new ObjectId(), 3));
        expect(missing).to.be.instanceOf(ValidationError);
        expect(errorDetail(missing)).to.include('School not found');

        await addSchoolStaff(domainId, schoolId, 7);
        await addSchoolStaff(domainId, schoolId, 8);
        await addSchoolStaff(domainId, schoolId, 7);
        expect((await schools.findOne({ _id: schoolId })).staffUids).to.deep.equal([7, 8]);

        await removeSchoolStaff(domainId, schoolId, 7);
        expect((await schools.findOne({ _id: schoolId })).staffUids).to.deep.equal([8]);
        await removeSchoolStaff(domainId, new ObjectId(), 8);
    });

    it('lists only that owner’s groups in name order', async () => {
        const ownB = userGroup({ name: 'b', ownerUid: 5 });
        const ownA = userGroup({ name: 'a', ownerUid: 5 });
        await groups.insertOne(ownB);
        await groups.insertOne(ownA);
        await groups.insertOne(userGroup({ name: 'c', ownerUid: 6 }));
        await groups.insertOne(userGroup({ name: 'd' }));
        await groups.insertOne(userGroup({ name: 'e', ownerUid: 5, domainId: 'other' }));
        const listed = await listTeacherGroups(domainId, 5);
        expect(listed.map((group) => group.name)).to.deep.equal(['a', 'b']);
    });

    it('refuses to delete a student record the actor did not create', async () => {
        const record = studentRecord({ createdBy: actorUid + 1, boundUserId: 11, groupIds: [new ObjectId()] });
        await students.insertOne(record);
        await tokens.insertOne({ _id: 'keep', domainId, kind: 'student', studentRecordId: record._id, used: false });
        const failed = await captureFailure(deleteTeacherCreatedStudent(domainId, record._id, actorUid, []));
        expect(failed).to.be.instanceOf(ValidationError);
        expect(errorDetail(failed)).to.include('这条学生记录不是你新建的，请联系管理员处理');
        expect(await students.findOne({ _id: record._id })).to.not.equal(null);
        expect(await tokens.findOne({ _id: 'keep' })).to.not.equal(null);
    });

    it('refuses to delete a student record that is already bound', async () => {
        const foreign = new ObjectId();
        const record = studentRecord({ boundUserId: 11, groupIds: [foreign] });
        await students.insertOne(record);
        await tokens.insertOne({ _id: 'keep', domainId, kind: 'student', studentRecordId: record._id, used: false });
        const failed = await captureFailure(deleteTeacherCreatedStudent(domainId, record._id, actorUid, []));
        expect(failed).to.be.instanceOf(ValidationError);
        expect(errorDetail(failed)).to.include('这条学生记录已绑定账号，请联系管理员处理');
        expect(await students.findOne({ _id: record._id })).to.not.equal(null);
        expect(await tokens.findOne({ _id: 'keep' })).to.not.equal(null);
    });

    it('refuses to delete a student record that still belongs to someone else’s group', async () => {
        const owned = new ObjectId();
        const foreign = new ObjectId();
        const record = studentRecord({ groupIds: [owned, foreign] });
        await students.insertOne(record);
        await tokens.insertOne({ _id: 'keep', domainId, kind: 'student', studentRecordId: record._id, used: false });
        const failed = await captureFailure(deleteTeacherCreatedStudent(domainId, record._id, actorUid, [copyId(owned)]));
        expect(failed).to.be.instanceOf(ValidationError);
        expect(errorDetail(failed)).to.include('这条学生记录还在其他用户组中，请联系管理员处理');
        expect(await students.findOne({ _id: record._id })).to.not.equal(null);
        expect(await tokens.findOne({ _id: 'keep' })).to.not.equal(null);
    });

    it('deletes the actor’s unbound student record when every group is owned, using the read groupIds array', async () => {
        const idA = new ObjectId();
        const idB = new ObjectId();
        const record = studentRecord({ groupIds: [idB, idA] });
        await students.insertOne(record);
        await tokens.insertOne({ _id: 'unused', domainId, kind: 'student', studentRecordId: record._id, used: false });
        await tokens.insertOne({ _id: 'used', domainId, kind: 'student', studentRecordId: record._id, used: true });
        await tokens.insertOne({ _id: 'other-domain', domainId: 'other', kind: 'student', studentRecordId: record._id, used: false });
        await tokens.insertOne({ _id: 'other-kind', domainId, kind: 'user_group', studentRecordId: record._id, userGroupId: idA });
        await tokens.insertOne({ _id: 'other-record', domainId, kind: 'student', studentRecordId: new ObjectId(), used: false });
        await deleteTeacherCreatedStudent(domainId, record._id, actorUid, [copyId(idA), copyId(idB)]);
        expect(await students.findOne({ _id: record._id })).to.equal(null);
        expect(await tokens.findOne({ _id: 'unused' })).to.equal(null);
        expect(await tokens.findOne({ _id: 'used' })).to.equal(null);
        expect(await tokens.findOne({ _id: 'other-domain' })).to.not.equal(null);
        expect(await tokens.findOne({ _id: 'other-kind' })).to.not.equal(null);
        expect(await tokens.findOne({ _id: 'other-record' })).to.not.equal(null);
    });

    it('deletes an unbound student record that belongs to no group', async () => {
        const record = studentRecord({ groupIds: [] });
        await students.insertOne(record);
        await deleteTeacherCreatedStudent(domainId, record._id, actorUid, [new ObjectId()]);
        expect(await students.findOne({ _id: record._id })).to.equal(null);
    });

    it('rejects the delete when groupIds change after the record was read', async () => {
        const owned = new ObjectId();
        const record = studentRecord({ groupIds: [owned] });
        await students.insertOne(record);
        await tokens.insertOne({ _id: 'cas-token', domainId, kind: 'student', studentRecordId: record._id, used: false });
        const original = students.findOne;
        let armed = true;
        students.findOne = async (filter: Record<string, unknown> = {}) => {
            const found = await original.call(students, filter);
            if (armed && found && valuesEqual(found._id, record._id)) {
                armed = false;
                const stored = students.docs.find((item) => valuesEqual(item._id, record._id));
                if (!stored) throw new Error('stored student missing');
                stored.groupIds = [new ObjectId()];
            }
            return found;
        };
        try {
            const failed = await captureFailure(deleteTeacherCreatedStudent(domainId, record._id, actorUid, [copyId(owned)]));
            expect(failed).to.be.instanceOf(ValidationError);
            expect(errorDetail(failed)).to.include('学生记录刚刚被修改，请刷新后重试');
            expect(await students.findOne({ _id: record._id })).to.not.equal(null);
            expect(await tokens.findOne({ _id: 'cas-token' })).to.not.equal(null);
        } finally {
            delete (students as { findOne?: unknown }).findOne;
        }
    });

    it('returns without throwing when the student record is already gone', async () => {
        await tokens.insertOne({ _id: 'keep', domainId, kind: 'student', studentRecordId: new ObjectId(), used: false });
        await deleteTeacherCreatedStudent(domainId, new ObjectId(), actorUid, []);
        expect(await tokens.findOne({ _id: 'keep' })).to.not.equal(null);
    });
});
