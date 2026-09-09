import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { describe, it, beforeEach } from 'node:test';
import { localizeErrorParameter, localizedErrorText, NotFoundError, SystemError, ValidationError } from '@hydrooj/framework';
import type { BindingRequest, School, StudentRecord } from '../src/types';

class FakeCollection {
    docs: Array<Record<string, unknown>> = [];

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

    async insertOne(doc: Record<string, unknown>) {
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
}

function cloneDoc<T extends Record<string, unknown>>(doc: T): T {
    const out: Record<string, unknown> = { ...doc };
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

function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
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
        if (!valuesEqual(docValue, value)) return false;
    }
    return true;
}

function applyAddToSet(doc: Record<string, unknown>, addToSet: Record<string, unknown>) {
    for (const [key, raw] of Object.entries(addToSet)) {
        const values = raw && typeof raw === 'object' && '$each' in (raw as object) ? ((raw as { $each: unknown[] }).$each ?? []) : [raw];
        if (!Array.isArray(doc[key])) doc[key] = doc[key] == null ? [] : [doc[key]];
        const arr = doc[key] as unknown[];
        for (const value of values) {
            if (!arr.some((item) => valuesEqual(item, value))) arr.push(value);
        }
    }
}

function applyUpdate(doc: Record<string, unknown>, update: Record<string, unknown>) {
    if (update.$set && typeof update.$set === 'object') Object.assign(doc, update.$set);
    if (update.$addToSet && typeof update.$addToSet === 'object') applyAddToSet(doc, update.$addToSet as Record<string, unknown>);
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

function loadBindingModule() {
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
        return require('../src/binding');
    } finally {
        Module._load = originalLoad;
    }
}

const { bindMatchedStudent, bindByRosterOrQueue } = loadBindingModule();

const domainId = 'system';
const students = collection('userbind.students');
const schools = collection('userbind.schools');
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

function pendingRequest(userId: number, overrides: Partial<BindingRequest> = {}): BindingRequest {
    return {
        _id: new ObjectId(),
        domainId,
        userId,
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

function errorDetail(error: unknown): string {
    const params = (error as { params?: unknown[] })?.params || [];
    return [String((error as Error).message || ''), ...params.map((value) => String(value))].join(' ');
}

describe('bindMatchedStudent CAS', () => {
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

    it('lets the first bind win and rejects a second uid without overwriting', async () => {
        const record = studentRecord();
        await students.insertOne(record);
        await usersColl.insertOne({ _id: 11 });
        await usersColl.insertOne({ _id: 12 });

        const first = await bindMatchedStudent(record, 11);
        expect(first.studentRecord.boundUserId).to.equal(11);
        expect(first.school._id.equals(schoolId)).to.equal(true);

        let failed: unknown;
        try {
            await bindMatchedStudent(record, 12);
        } catch (error) {
            failed = error;
        }
        expect(failed).to.be.instanceOf(ValidationError);
        expect(errorDetail(failed)).to.include('Already bound to another user');

        const stored = await students.findOne({ _id: record._id });
        expect(stored.boundUserId).to.equal(11);
        expect((await usersColl.findOne({ _id: 11 })).studentId).to.equal('240340179');
        expect((await usersColl.findOne({ _id: 12 })).studentId).to.equal(undefined);
    });

    it('does not let a profile studentId block a canonical roster bind', async () => {
        const record = studentRecord();
        await students.insertOne(record);
        await usersColl.insertOne({ _id: 11, studentId: 'spoofed', realName: '别人' });

        const bound = await bindMatchedStudent(record, 11);
        expect(bound.studentRecord.boundUserId).to.equal(11);
        expect((await usersColl.findOne({ _id: 11 })).studentId).to.equal('240340179');
        expect((await usersColl.findOne({ _id: 11 })).realName).to.equal('张三');
    });

    it('is idempotent when the same user binds again', async () => {
        const record = studentRecord({ boundUserId: 11, boundAt: new Date('2026-08-01T00:00:00Z') });
        await students.insertOne(record);
        await usersColl.insertOne({ _id: 11, studentId: '240340179', realName: '张三' });

        const again = await bindMatchedStudent(record, 11);
        expect(again.studentRecord.boundUserId).to.equal(11);
        expect((await students.findOne({ _id: record._id })).boundUserId).to.equal(11);
    });
});

describe('bindByRosterOrQueue', () => {
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

    it('binds a matched unbound roster row and rejects leftover pending requests', async () => {
        const record = studentRecord();
        await students.insertOne(record);
        await usersColl.insertOne({ _id: 11 });
        const leftover = pendingRequest(11);
        const otherPending = pendingRequest(99, { studentIdInput: '240340180', realNameInput: '李四' });
        await requests.insertOne(leftover);
        await requests.insertOne(otherPending);

        const result = await bindByRosterOrQueue(domainId, schoolId, 11, '240340179', '张三');
        expect(result.kind).to.equal('bound');
        if (result.kind !== 'bound') throw new Error('expected bound');
        expect(result.studentRecord.boundUserId).to.equal(11);
        expect(result.school._id.equals(schoolId)).to.equal(true);

        const closed = await requests.findOne({ _id: leftover._id });
        expect(closed.status).to.equal('rejected');
        expect(closed.rejectReason).to.equal('已通过花名册匹配完成绑定');
        expect(closed.reviewedBy).to.equal(null);
        expect(closed.reviewedAt).to.be.instanceOf(Date);

        const untouched = await requests.findOne({ _id: otherPending._id });
        expect(untouched.status).to.equal('pending');
        expect((await students.findOne({ _id: record._id })).boundUserId).to.equal(11);
    });

    it('queues a pending request when the roster has no match', async () => {
        await usersColl.insertOne({ _id: 11 });
        const result = await bindByRosterOrQueue(domainId, schoolId, 11, '240340179', '张三');
        expect(result.kind).to.equal('queued');
        if (result.kind !== 'queued') throw new Error('expected queued');
        expect(result.request.status).to.equal('pending');
        expect(result.request.userId).to.equal(11);
        expect(result.request.studentIdInput).to.equal('240340179');
        expect(result.request.realNameInput).to.equal('张三');
        expect(students.docs).to.have.lengthOf(0);
        expect(requests.docs).to.have.lengthOf(1);
    });

    it('throws when the identity is already bound to another account', async () => {
        await students.insertOne(studentRecord({ boundUserId: 88, boundAt: new Date('2026-08-01T00:00:00Z') }));
        await usersColl.insertOne({ _id: 11 });

        let failed: unknown;
        try {
            await bindByRosterOrQueue(domainId, schoolId, 11, '240340179', '张三');
        } catch (error) {
            failed = error;
        }
        expect(failed).to.be.instanceOf(ValidationError);
        expect(errorDetail(failed)).to.include('UID 88');
        expect(errorDetail(failed)).to.include('已被其他账号绑定');
        expect((await students.findOne({ studentId: '240340179' })).boundUserId).to.equal(88);
    });

    it('returns already_bound for self and does not rewrite boundUserId', async () => {
        const boundAt = new Date('2026-07-01T00:00:00Z');
        const record = studentRecord({ boundUserId: 11, boundAt });
        await students.insertOne(record);
        await usersColl.insertOne({ _id: 11, studentId: '240340179', realName: '张三' });

        const result = await bindByRosterOrQueue(domainId, schoolId, 11, '240340179', '张三');
        expect(result.kind).to.equal('already_bound');
        if (result.kind !== 'already_bound') throw new Error('expected already_bound');
        expect(result.studentRecord.boundUserId).to.equal(11);
        expect(result.school && result.school._id.equals(schoolId)).to.equal(true);

        const stored = await students.findOne({ _id: record._id });
        expect(stored.boundUserId).to.equal(11);
        expect(stored.boundAt.getTime()).to.equal(boundAt.getTime());
        expect((await usersColl.findOne({ _id: 11 })).studentId).to.equal('240340179');
    });
});
