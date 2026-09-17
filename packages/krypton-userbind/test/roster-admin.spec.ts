import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { Document, ObjectId } from 'mongodb';
import { describe, it, beforeEach } from 'node:test';
import { localizeErrorParameter, localizedErrorText, NotFoundError, SystemError, ValidationError } from '@hydrooj/framework';
import type { BindingRequest, School, StudentRecord, UserGroup } from '../src/types';

class FakeCollection {
    docs: Document[] = [];

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
            sort: () => cursor,
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

    async updateMany(filter: Record<string, unknown>, update: Record<string, unknown>) {
        let matchedCount = 0;
        for (const doc of this.docs) {
            if (!matchesFilter(doc, filter)) continue;
            matchedCount += 1;
            applyUpdate(doc, update);
        }
        return { matchedCount, modifiedCount: matchedCount };
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

function isOperator(value: unknown): value is Record<string, unknown> {
    if (value == null || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) return false;
    if (typeof (value as { equals?: unknown }).equals === 'function') return false;
    return Object.keys(value as object).some((key) => key.startsWith('$'));
}

function matchesFilter(doc: Document, filter: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(filter || {})) {
        if (key === '$or') {
            const clauses = value as Array<Record<string, unknown>>;
            if (!clauses.some((clause) => matchesFilter(doc, clause))) return false;
            continue;
        }
        const docValue = doc[key];
        if (isOperator(value)) {
            if ('$in' in value && !((value.$in as unknown[]) || []).some((item) => valuesEqual(docValue, item))) return false;
            if ('$ne' in value && valuesEqual(docValue, value.$ne)) return false;
            continue;
        }
        if (Array.isArray(docValue) && !Array.isArray(value)) {
            if (!docValue.some((item) => valuesEqual(item, value))) return false;
            continue;
        }
        if (!valuesEqual(docValue, value)) return false;
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
        const deny =
            raw && typeof raw === 'object' && '$in' in (raw as object)
                ? ((raw as { $in: unknown[] }).$in ?? [])
                : [raw];
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
const usersColl = new FakeCollection();

function collection(name: string): FakeCollection {
    let coll = collections.get(name);
    if (!coll) {
        coll = new FakeCollection();
        collections.set(name, coll);
    }
    return coll;
}

function loadRosterAdminModules() {
    const Module = require('module');
    const originalLoad = Module._load;
    Module._load = function load(request: string, parent: unknown, isMain: boolean) {
        if (request === 'hydrooj') {
            return {
                db: { collection: (name: string) => collection(name) },
                ObjectId,
                UserModel: { coll: usersColl, getMulti: () => ({ toArray: async () => [] }), getById: async () => null },
                ValidationError,
                NotFoundError,
                SystemError,
                localizedErrorText,
                localizeErrorParameter,
                MessageModel: { FLAG_UNREAD: 1, FLAG_I18N: 16, send: async () => undefined },
                PRIV: { PRIV_EDIT_SYSTEM: 1 },
            };
        }
        if (request === 'hydrooj/src/model/record' || String(request).includes('hydrooj/src/model/record')) {
            return { default: { coll: collection('record') }, coll: collection('record') };
        }
        const normalized = String(request).replace(/\\/g, '/');
        if (request === './binding-notification' || normalized.endsWith('/binding-notification')) {
            return { notifyBindingRequest: async () => true };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        for (const key of Object.keys(require.cache)) {
            if (key.includes(`${require('node:path').sep}krypton-userbind${require('node:path').sep}src${require('node:path').sep}`)) {
                delete require.cache[key];
            }
        }
        const model = require('../src/model');
        const binding = require('../src/binding');
        return { ...model, ...binding, userBindModel: model.userBindModel };
    } finally {
        Module._load = originalLoad;
    }
}

const {
    bindMatchedStudent,
    unbindStudent,
    diagnoseBindingRequestApproval,
    approveBindingRequest,
    updateSchool,
    updateUserGroup,
    deleteStudent,
    removeStudentsFromGroup,
    updateStudent,
} = loadRosterAdminModules();

const domainId = 'system';
const students = collection('userbind.students');
const schools = collection('userbind.schools');
const groups = collection('userbind.user_groups');
const tokens = collection('userbind.bind_tokens');
const requests = collection('userbind.binding_requests');

let schoolId: ObjectId;
let school: School;

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
        createdBy: 2,
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

describe('unbindStudent', () => {
    beforeEach(async () => {
        for (const coll of collections.values()) coll.clear();
        usersColl.clear();
        schoolId = new ObjectId();
        school = {
            _id: schoolId,
            domainId,
            name: '计算机学院',
            createdAt: new Date('2026-09-01T00:00:00Z'),
            createdBy: 2,
        };
        await schools.insertOne(school);
    });

    it('clears boundUserId/boundAt and the profile fields bindMatchedStudent wrote', async () => {
        const groupId = new ObjectId();
        const record = studentRecord({ groupIds: [groupId] });
        await students.insertOne(record);
        await usersColl.insertOne({ _id: 11 });

        await bindMatchedStudent(record, 11);
        const boundUser = await usersColl.findOne({ _id: 11 });
        expect(boundUser.studentId).to.equal('240340179');
        expect(boundUser.realName).to.equal('张三');
        expect((boundUser.parentSchoolId as ObjectId[]).some((id) => id.equals(schoolId))).to.equal(true);
        expect((boundUser.parentUserGroupId as ObjectId[]).some((id) => id.equals(groupId))).to.equal(true);

        const result = await unbindStudent(domainId, record._id, 11);
        expect(result.unboundUserId).to.equal(11);

        const stored = await students.findOne({ _id: record._id });
        expect(stored.boundUserId).to.equal(null);
        expect(stored.boundAt).to.equal(null);
        expect(stored.studentId).to.equal('240340179');
        expect(stored.groupIds.some((id: ObjectId) => id.equals(groupId))).to.equal(true);

        const unboundUser = await usersColl.findOne({ _id: 11 });
        expect(unboundUser.studentId).to.equal(undefined);
        expect(unboundUser.realName).to.equal(undefined);
        expect((unboundUser.parentSchoolId || []).some((id: ObjectId) => id.equals(schoolId))).to.equal(false);
        expect((unboundUser.parentUserGroupId || []).some((id: ObjectId) => id.equals(groupId))).to.equal(false);
    });

    it('refuses CAS when the expected bound uid does not match', async () => {
        const record = studentRecord({ boundUserId: 11, boundAt: new Date('2026-08-01T00:00:00Z') });
        await students.insertOne(record);
        await usersColl.insertOne({ _id: 11, studentId: '240340179', realName: '张三', parentSchoolId: [schoolId] });

        const failed = await captureFailure(unbindStudent(domainId, record._id, 12));
        expect(failed).to.be.instanceOf(ValidationError);
        expect(errorDetail(failed)).to.include('当前绑定的账号已变化');

        const stored = await students.findOne({ _id: record._id });
        expect(stored.boundUserId).to.equal(11);
        expect((await usersColl.findOne({ _id: 11 })).studentId).to.equal('240340179');
    });

    it('retries profile cleanup when the student row is already unbound', async () => {
        const record = studentRecord();
        await students.insertOne(record);
        await usersColl.insertOne({ _id: 11, studentId: '240340179', realName: '张三', parentSchoolId: [schoolId] });

        const result = await unbindStudent(domainId, record._id, 11);
        expect(result.unboundUserId).to.equal(11);
        expect((await students.findOne({ _id: record._id })).boundUserId).to.equal(null);
        expect((await usersColl.findOne({ _id: 11 })).studentId).to.equal(undefined);
        expect((await usersColl.findOne({ _id: 11 })).realName).to.equal(undefined);
    });

    it('does not wipe another student bind that reused the same uid', async () => {
        const record = studentRecord({ boundUserId: 11, boundAt: new Date('2026-08-01T00:00:00Z') });
        await students.insertOne(record);
        await usersColl.insertOne({
            _id: 11,
            studentId: '240340000',
            realName: '李四',
            parentSchoolId: [schoolId],
        });

        const result = await unbindStudent(domainId, record._id, 11);
        expect(result.unboundUserId).to.equal(11);
        expect((await students.findOne({ _id: record._id })).boundUserId).to.equal(null);
        const otherBind = await usersColl.findOne({ _id: 11 });
        expect(otherBind.studentId).to.equal('240340000');
        expect(otherBind.realName).to.equal('李四');
    });

    it('does not wipe a live same-studentId bind on another school', async () => {
        const otherSchoolId = new ObjectId();
        await schools.insertOne({
            _id: otherSchoolId,
            domainId,
            name: '软件学院',
            createdAt: new Date('2026-09-01T00:00:00Z'),
            createdBy: 2,
        });
        const first = studentRecord();
        const second = studentRecord({ _id: new ObjectId(), schoolId: otherSchoolId });
        await students.insertOne(first);
        await students.insertOne(second);
        await usersColl.insertOne({ _id: 11 });

        await bindMatchedStudent(first, 11);
        await unbindStudent(domainId, first._id, 11);
        await bindMatchedStudent(second, 11);

        const retry = await unbindStudent(domainId, first._id, 11);
        expect(retry.unboundUserId).to.equal(11);
        expect((await students.findOne({ _id: second._id })).boundUserId).to.equal(11);
        const liveUser = await usersColl.findOne({ _id: 11 });
        expect(liveUser.studentId).to.equal('240340179');
        expect(liveUser.realName).to.equal('张三');
        expect(liveUser.boundStudentRecordId.equals(second._id)).to.equal(true);
    });
});

describe('deleteStudent', () => {
    beforeEach(async () => {
        for (const coll of collections.values()) coll.clear();
        usersColl.clear();
        schoolId = new ObjectId();
        await schools.insertOne({
            _id: schoolId,
            domainId,
            name: '计算机学院',
            createdAt: new Date('2026-09-01T00:00:00Z'),
            createdBy: 2,
        });
    });

    it('refuses to delete a bound student record', async () => {
        const record = studentRecord({ boundUserId: 11, boundAt: new Date('2026-08-01T00:00:00Z') });
        await students.insertOne(record);
        const failed = await captureFailure(deleteStudent(domainId, record._id));
        expect(failed).to.be.instanceOf(ValidationError);
        expect(errorDetail(failed)).to.include('无法删除已绑定的学生记录');
        expect(await students.findOne({ _id: record._id })).to.not.equal(null);
    });

    it('deletes an unbound student and unused invite tokens', async () => {
        const record = studentRecord();
        await students.insertOne(record);
        await tokens.insertOne({ _id: 'token-1', studentRecordId: record._id, used: false });
        await tokens.insertOne({ _id: 'token-2', studentRecordId: record._id, used: true });
        await deleteStudent(domainId, record._id);
        expect(await students.findOne({ _id: record._id })).to.equal(null);
        expect(await tokens.findOne({ _id: 'token-1' })).to.equal(null);
        expect(await tokens.findOne({ _id: 'token-2' })).to.not.equal(null);
    });
});

describe('rename school and group', () => {
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

    it('renames a school', async () => {
        await updateSchool(domainId, schoolId, { name: ' 软件学院 ' });
        expect((await schools.findOne({ _id: schoolId })).name).to.equal('软件学院');
    });

    it('refuses an empty school name', async () => {
        const failed = await captureFailure(updateSchool(domainId, schoolId, { name: '   ' }));
        expect(failed).to.be.instanceOf(ValidationError);
        expect(errorDetail(failed)).to.include('学校名称不能为空');
        expect((await schools.findOne({ _id: schoolId })).name).to.equal('计算机学院');
    });

    it('renames a user group', async () => {
        const group: UserGroup = {
            _id: new ObjectId(),
            domainId,
            schoolId,
            name: '1班',
            createdAt: new Date('2026-09-01T00:00:00Z'),
            createdBy: 2,
        };
        await groups.insertOne(group);
        await updateUserGroup(domainId, group._id, { name: '2班' });
        expect((await groups.findOne({ _id: group._id })).name).to.equal('2班');
    });
});

describe('removeStudentsFromGroup', () => {
    beforeEach(async () => {
        for (const coll of collections.values()) coll.clear();
        usersColl.clear();
        schoolId = new ObjectId();
        await schools.insertOne({
            _id: schoolId,
            domainId,
            name: '计算机学院',
            createdAt: new Date('2026-09-01T00:00:00Z'),
            createdBy: 2,
        });
    });

    it('removes membership from the student record and the bound user profile', async () => {
        const groupId = new ObjectId();
        const keepGroupId = new ObjectId();
        const record = studentRecord({
            groupIds: [groupId, keepGroupId],
            boundUserId: 11,
            boundAt: new Date('2026-08-01T00:00:00Z'),
        });
        await students.insertOne(record);
        await usersColl.insertOne({ _id: 11, parentUserGroupId: [groupId, keepGroupId] });

        await removeStudentsFromGroup(domainId, groupId, [record._id]);
        const stored = await students.findOne({ _id: record._id });
        expect(stored.groupIds.some((id: ObjectId) => id.equals(groupId))).to.equal(false);
        expect(stored.groupIds.some((id: ObjectId) => id.equals(keepGroupId))).to.equal(true);
        const user = await usersColl.findOne({ _id: 11 });
        expect((user.parentUserGroupId as ObjectId[]).some((id) => id.equals(groupId))).to.equal(false);
        expect((user.parentUserGroupId as ObjectId[]).some((id) => id.equals(keepGroupId))).to.equal(true);
    });
});

describe('updateStudent enrollment year clear', () => {
    beforeEach(async () => {
        for (const coll of collections.values()) coll.clear();
        schoolId = new ObjectId();
    });

    it('clears enrollmentYear to null and updates realName', async () => {
        const record = studentRecord();
        await students.insertOne(record);
        await updateStudent(domainId, record._id, { realName: '李四', enrollmentYear: null });
        const stored = await students.findOne({ _id: record._id });
        expect(stored.realName).to.equal('李四');
        expect(stored.enrollmentYear).to.equal(null);
    });
});

describe('binding request approval diagnosis', () => {
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

    function pendingRequest(overrides: Partial<BindingRequest> = {}): BindingRequest {
        return {
            _id: new ObjectId(),
            domainId,
            userId: 11,
            studentIdInput: '240340179',
            realNameInput: '张三',
            schoolId,
            status: 'pending',
            createdAt: new Date('2026-09-01T00:00:00Z'),
            reviewedBy: null,
            reviewedAt: null,
            rejectReason: null,
            sourceTokenId: null,
            targetUserGroupId: null,
            claimTempUserId: null,
            ...overrides,
        };
    }

    it('reports name mismatch without rewriting the request', async () => {
        await students.insertOne(studentRecord({ realName: '李四' }));
        const req = pendingRequest();
        await requests.insertOne(req);
        const issue = await diagnoseBindingRequestApproval(req);
        expect(issue?.kind).to.equal('name_mismatch');
        if (issue?.kind !== 'name_mismatch') throw new Error('expected name_mismatch');
        expect(issue.rosterRealName).to.equal('李四');

        const failed = await captureFailure(approveBindingRequest(req._id, 2));
        expect(failed).to.be.instanceOf(ValidationError);
        expect(errorDetail(failed)).to.include('姓名与申请姓名不一致');
        const stored = await requests.findOne({ _id: req._id });
        expect(stored.status).to.equal('pending');
        expect(stored.realNameInput).to.equal('张三');
        expect(stored.studentIdInput).to.equal('240340179');
    });

    it('reports occupied binding without rewriting the request', async () => {
        await students.insertOne(studentRecord({ boundUserId: 88, boundAt: new Date('2026-08-01T00:00:00Z') }));
        const req = pendingRequest();
        await requests.insertOne(req);
        const issue = await diagnoseBindingRequestApproval(req);
        expect(issue?.kind).to.equal('occupied');
        if (issue?.kind !== 'occupied') throw new Error('expected occupied');
        expect(issue.boundUserId).to.equal(88);

        const failed = await captureFailure(approveBindingRequest(req._id, 2));
        expect(failed).to.be.instanceOf(ValidationError);
        expect(errorDetail(failed)).to.include('已绑定其他账号');
        expect((await requests.findOne({ _id: req._id })).status).to.equal('pending');
        expect((await students.findOne({ studentId: '240340179' })).boundUserId).to.equal(88);
    });
});

describe('roster admin source contracts', () => {
    const handlerSource = readFileSync(resolve(__dirname, '../src/handler.ts'), 'utf8');
    const uiSource = readFileSync(resolve(process.cwd(), 'packages/ui-next/src/pages/userbind/index.tsx'), 'utf8');
    const actionsSource = readFileSync(resolve(process.cwd(), 'packages/ui-next/src/components/userbind/roster-admin-actions.tsx'), 'utf8');

    it('exposes unbind, update, delete, rename and remove in admin UI', () => {
        expect(actionsSource).to.include("operation: 'unbind'");
        expect(actionsSource).to.include('expectedBoundUserId');
        expect(actionsSource).to.include('value="updateStudent"');
        expect(actionsSource).to.include("operation: 'deleteStudent'");
        expect(actionsSource).to.include('clearEnrollmentYear');
        expect(uiSource).to.include('RenameEntityDialog');
        expect(uiSource).to.include("operation: 'remove'");
        expect(uiSource).to.include('StudentRosterActions');
        expect(uiSource).to.include('AdminUserbindSchoolDetailPage');
        expect(uiSource).to.include('title="重命名学校"');
        expect(uiSource).to.include('title="重命名用户组"');
        expect(uiSource).to.include('{isArchived ? \'该组暂无成员。已归档用户组不能再添加人员。\' : \'该组暂无成员。使用「添加人员」分页批量加入。\'}');
        expect(uiSource).to.include('approvalIssue');
        expect(uiSource).to.include('编辑学生记录');
        expect(uiSource).to.include('解绑');
        expect(uiSource).to.not.include('PERM_USERBIND_MANAGE_STUDENTS');
    });

    it('keeps student mutations on the PRIV_EDIT_SYSTEM students handler', () => {
        const studentsHandler = handlerSource.slice(
            handlerSource.indexOf('class AdminStudentsHandler'),
            handlerSource.indexOf('class AdminStudentImportHandler'),
        );
        expect(studentsHandler).to.include('async postUnbind(');
        expect(studentsHandler).to.include('async postDeleteStudent(');
        expect(studentsHandler).to.include('async postUpdateStudent(');
        expect(studentsHandler).to.include('clearEnrollmentYear');
        expect(handlerSource).to.include('safeUserbindReturnTo');
        expect(readFileSync(resolve(__dirname, '../src/binding.ts'), 'utf8')).to.include(
            'studentsColl.findOne({ boundUserId: expectedBoundUserId })',
        );
        expect(readFileSync(resolve(__dirname, '../src/binding.ts'), 'utf8')).to.include('boundStudentRecordId: studentRecordId');
        expect(readFileSync(resolve(__dirname, '../src/binding.ts'), 'utf8')).to.include('boundStudentRecordId: claim');
        expect(readFileSync(resolve(__dirname, '../src/model.ts'), 'utf8')).to.include(
            'deleteOne({ domainId, _id: id, boundUserId: null })',
        );
    });
});
