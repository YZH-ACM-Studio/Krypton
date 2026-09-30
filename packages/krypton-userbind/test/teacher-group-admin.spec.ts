import { createRequire } from 'node:module';
import path, { sep } from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { expect } from 'chai';
import { Document, ObjectId } from 'mongodb';
import {
    BadRequestError,
    CreateError,
    ForbiddenError,
    localizedErrorText,
    localizeError,
    localizeErrorParameter,
    NotFoundError,
    SystemError,
    ValidationError,
} from '@hydrooj/framework';
import { param } from '@hydrooj/framework/decorators';
import { Types } from '@hydrooj/framework/validator';

const nodeRequire = createRequire(__filename);
const hydroojPackageJson = nodeRequire.resolve('hydrooj/package.json');
const hydroojSrc = path.join(path.dirname(hydroojPackageJson), 'src');
const { isSchoolInStaffScope: realIsSchoolInStaffScope } = nodeRequire(path.join(hydroojSrc, 'lib/staff-school-scope.ts'));
const { withStudentDirectory } = nodeRequire(path.join(hydroojSrc, 'service/student-directory.ts'));
const { InMemoryStudentDirectory, studentRecord: directoryStudent } = nodeRequire(path.join(hydroojSrc, 'lib/testing/in-memory-student-directory.ts'));

const domainId = 'lab';
const adminUid = 2;
const createdByUid = 7;

class FakeCollection {
    docs: Document[] = [];
    updates: Array<Record<string, unknown>> = [];

    clear() {
        this.docs.length = 0;
        this.updates.length = 0;
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

    aggregate(pipeline: Array<Record<string, any>>) {
        let rows = this.docs.map((doc) => cloneDoc(doc));
        for (const stage of pipeline) {
            if (stage.$match) {
                rows = rows.filter((doc) => matchesFilter(doc, stage.$match));
                continue;
            }
            if (typeof stage.$unwind === 'string') {
                const field = stage.$unwind.replace(/^\$/, '');
                const next: Document[] = [];
                for (const doc of rows) {
                    const value = doc[field];
                    if (!Array.isArray(value)) continue;
                    for (const item of value) next.push({ ...doc, [field]: item });
                }
                rows = next;
                continue;
            }
            if (stage.$group) {
                const spec = stage.$group as { _id?: unknown; count?: { $sum?: unknown } };
                if (typeof spec._id !== 'string' || !spec._id.startsWith('$') || spec.count?.$sum !== 1) {
                    throw new Error('unsupported aggregate $group');
                }
                const idField = spec._id.slice(1);
                const grouped = new Map<string, Document>();
                for (const doc of rows) {
                    const id = doc[idField];
                    const key = id && typeof (id as { toHexString?: () => string }).toHexString === 'function' ? (id as { toHexString: () => string }).toHexString() : String(id);
                    const existing = grouped.get(key);
                    if (existing) existing.count = (existing.count as number) + 1;
                    else grouped.set(key, { _id: id, count: 1 });
                }
                rows = [...grouped.values()];
                continue;
            }
            throw new Error(`unsupported aggregate stage: ${Object.keys(stage).join(',')}`);
        }
        return { toArray: async () => rows };
    }

    async insertOne(doc: Document) {
        this.docs.push(cloneDoc(doc));
        return { insertedId: doc._id };
    }

    async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>) {
        this.updates.push(update);
        const index = this.docs.findIndex((doc) => matchesFilter(doc, filter));
        if (index < 0) return { matchedCount: 0, modifiedCount: 0 };
        applyUpdate(this.docs[index], update);
        return { matchedCount: 1, modifiedCount: 1 };
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

function valuesEqual(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (left == null && right == null) return true;
    if (left == null || right == null) return false;
    if (typeof (left as { equals?: unknown }).equals === 'function') {
        return Boolean((left as { equals: (other: unknown) => boolean }).equals(right));
    }
    if (typeof (right as { equals?: unknown }).equals === 'function') {
        return Boolean((right as { equals: (other: unknown) => boolean }).equals(left));
    }
    if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
    return false;
}

function isOperator(value: unknown): value is Record<string, unknown> {
    if (value == null || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) return false;
    if (typeof (value as { equals?: unknown }).equals === 'function') return false;
    return Object.keys(value as object).some((key) => key.startsWith('$'));
}

function matchesValue(docValue: unknown, expected: unknown): boolean {
    if (Array.isArray(docValue) && !Array.isArray(expected) && !isOperator(expected)) {
        return docValue.some((item) => valuesEqual(item, expected));
    }
    return valuesEqual(docValue, expected);
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
            if ('$exists' in value) {
                const exists = value.$exists !== false && value.$exists !== 0 && value.$exists !== null;
                if (exists !== (docValue !== undefined)) return false;
            }
            if ('$gt' in value) {
                const bound = value.$gt;
                if (typeof docValue !== 'number' || typeof bound !== 'number' || docValue <= bound) return false;
            }
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
        const list = doc[key] as unknown[];
        for (const value of values) {
            if (!list.some((item) => valuesEqual(item, value))) list.push(value);
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

interface FixtureUser {
    _id: number;
    uname?: string;
    realName?: string;
    studentId?: string;
    parentSchoolId?: ObjectId[];
}

interface ScopeCall {
    domainId: string;
    schoolHex: string;
    actorId: unknown;
    actorKeys: string[];
}

interface OplogEntry {
    type: string;
    data: Record<string, any>;
}

interface AdminGroupListRow {
    name: string;
    ownerUid: number | null;
    ownerName: string | null;
    teacherAttachable: boolean;
}

interface AdminInstance {
    user: { _id: number; hasPriv: (priv: number) => boolean };
    response: { template?: string; body?: any; redirect?: string };
    request: Record<string, unknown>;
    args: { domainId: string };
    prepare: () => Promise<void>;
    postSetTeacherAttachable: (args: Record<string, unknown>) => Promise<void>;
    postTransferOwner: (args: Record<string, unknown>) => Promise<void>;
    postClearOwner: (args: Record<string, unknown>) => Promise<void>;
    postAddStaff: (args: Record<string, unknown>) => Promise<void>;
    postRemoveStaff: (args: Record<string, unknown>) => Promise<void>;
    get: (args: Record<string, unknown>) => Promise<void>;
}

const collections = new Map<string, FakeCollection>();
const users = new Map<number, FixtureUser>();
const warnings: unknown[][] = [];
const oplogs: OplogEntry[] = [];
const lookups: Array<{ domainId: string; uid: number }> = [];
const scopeCalls: ScopeCall[] = [];
const modelCalls: Record<string, unknown[][]> = {
    setGroupTeacherAttachable: [],
    setGroupOwner: [],
    clearGroupOwner: [],
    addSchoolStaff: [],
    removeSchoolStaff: [],
};

function collection(name: string): FakeCollection {
    let coll = collections.get(name);
    if (!coll) {
        coll = new FakeCollection();
        collections.set(name, coll);
    }
    return coll;
}

const schools = collection('userbind.schools');
const groups = collection('userbind.user_groups');

class RecordingLogger {
    constructor(public name: string) {}

    warn(format: string, ...args: unknown[]) {
        warnings.push([format, ...args]);
    }

    info() {}

    error() {}

    debug() {}

    success() {}
}

class RecordingHandler {
    user: AdminInstance['user'] = { _id: 0, hasPriv: () => false };
    response: AdminInstance['response'] = {};
    request: Record<string, unknown> = { body: {}, query: {}, params: {}, headers: {} };
    args: { domainId: string } = { domainId };
    session: Record<string, unknown> = {};

    checkPriv(priv: number) {
        if (!this.user?.hasPriv?.(priv)) {
            const error = new Error('Permission denied');
            error.name = 'PermissionError';
            throw error;
        }
    }

    url(name: string, params: Record<string, unknown> = {}) {
        const bits = Object.entries(params).map(([key, value]) => {
            const rendered = value && typeof (value as { toHexString?: () => string }).toHexString === 'function' ? (value as { toHexString: () => string }).toHexString() : String(value);
            return `${key}=${rendered}`;
        });
        return `/${name}?${bits.join('&')}`;
    }
}

function loadHandlers() {
    const Module = require('module');
    const originalLoad = Module._load;
    const utils = require('@hydrooj/utils');
    const utilsProxy = new Proxy(utils, {
        get(target, prop, receiver) {
            if (prop === 'Logger') return RecordingLogger;
            return Reflect.get(target, prop, receiver);
        },
    });
    const hydrooj = {
        db: { collection: (name: string) => collection(name) },
        ObjectId,
        UserModel: {
            async getById(requestedDomain: string, uid: number) {
                lookups.push({ domainId: requestedDomain, uid });
                const user = users.get(uid);
                if (!user) return null;
                return { ...user, parentSchoolId: user.parentSchoolId ? [...user.parentSchoolId] : undefined };
            },
            coll: collection('user'),
        },
        OplogModel: {
            async log(_handler: unknown, type: string, data: Record<string, any>) {
                oplogs.push({ type, data });
            },
        },
        ValidationError,
        NotFoundError,
        localizedErrorText,
        localizeError,
        localizeErrorParameter,
        SystemError,
        BadRequestError,
        ForbiddenError,
        CreateError,
        Context: class Context {},
        Handler: RecordingHandler,
        param,
        Types,
        PRIV: { PRIV_EDIT_SYSTEM: 1, PRIV_USER_PROFILE: 2 },
        async isSchoolInStaffScope(requestedDomain: string, actor: { _id?: unknown } | null, schoolId: { toHexString?: () => string }) {
            scopeCalls.push({
                domainId: requestedDomain,
                schoolHex: typeof schoolId?.toHexString === 'function' ? schoolId.toHexString() : String(schoolId),
                actorId: actor?._id,
                actorKeys: actor && typeof actor === 'object' ? Object.keys(actor).sort() : [],
            });
            return realIsSchoolInStaffScope(requestedDomain, actor as { _id: number }, schoolId as ObjectId);
        },
    };
    Module._load = function load(request: string, parent: unknown, isMain: boolean) {
        if (request === 'hydrooj') return hydrooj;
        if (request === '@hydrooj/utils') return utilsProxy;
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        for (const key of Object.keys(require.cache)) {
            if (key.includes(`${sep}krypton-userbind${sep}src${sep}`)) delete require.cache[key];
        }
        return require('../src/handler');
    } finally {
        Module._load = originalLoad;
    }
}

let AdminGroupsHandler: new () => AdminInstance;
let AdminGroupDetailHandler: new () => AdminInstance;
let AdminSchoolDetailHandler: new () => AdminInstance;
let userBindModel: Record<string, (...args: any[]) => Promise<any>>;

function rememberUser(uid: number, extra: Partial<FixtureUser> = {}) {
    users.set(uid, {
        uname: 'alice',
        realName: '不该出现的姓名',
        studentId: '240340179',
        ...extra,
        _id: uid,
    });
}

async function insertSchool(overrides: Record<string, unknown> = {}) {
    const doc = {
        _id: new ObjectId(),
        domainId,
        name: '民航大学',
        createdAt: new Date('2026-09-01T00:00:00Z'),
        createdBy: adminUid,
        ...overrides,
    };
    await schools.insertOne(doc);
    return doc;
}

async function insertGroup(schoolId: ObjectId, overrides: Record<string, unknown> = {}) {
    const doc = {
        _id: new ObjectId(),
        domainId,
        schoolId,
        name: '一班',
        createdAt: new Date('2026-09-02T00:00:00Z'),
        createdBy: createdByUid,
        ...overrides,
    };
    await groups.insertOne(doc);
    return doc;
}

function admin(kind: 'groups' | 'group' | 'school'): AdminInstance {
    const Ctor = kind === 'groups' ? AdminGroupsHandler : kind === 'group' ? AdminGroupDetailHandler : AdminSchoolDetailHandler;
    const instance = new Ctor();
    instance.user = { _id: adminUid, hasPriv: () => true };
    instance.response = {};
    instance.request = { body: {}, query: {}, params: {}, headers: {} };
    instance.args = { domainId };
    return instance;
}

function scopeDirectory(
    schoolId: ObjectId,
    options: {
        staffUids?: number[];
        students?: Array<{ uid: number; schoolId: ObjectId; domainId?: string }>;
        extraSchools?: Array<{ _id: ObjectId; domainId: string; staffUids?: number[] }>;
    } = {},
) {
    return new InMemoryStudentDirectory({
        schools: [
            {
                _id: schoolId,
                domainId,
                name: '民航大学',
                ...(options.staffUids ? { staffUids: [...options.staffUids] } : {}),
            },
            ...(options.extraSchools || []).map((school) => ({
                _id: school._id,
                domainId: school.domainId,
                name: '其他学校',
                ...(school.staffUids ? { staffUids: [...school.staffUids] } : {}),
            })),
        ],
        students: (options.students || []).map((student) =>
            directoryStudent({
                domainId: student.domainId || domainId,
                schoolId: student.schoolId,
                boundUserId: student.uid,
                studentId: '240340179',
                realName: '不该出现的姓名',
            }),
        ),
    });
}

async function rejectionOf(run: () => Promise<unknown>): Promise<Error & { params?: unknown[] }> {
    try {
        await run();
    } catch (error) {
        return error as Error & { params?: unknown[] };
    }
    throw new Error('expected rejection');
}

function errorDetail(error: { message?: string; params?: unknown[] }): string {
    const params = error.params || [];
    return [String(error.message || ''), ...params.map((value) => String(value))].join(' ');
}

function assertNoPii(payload: Record<string, unknown>) {
    expect(payload).to.not.have.any.keys('uname', 'realName', 'studentId', 'ownerName', 'name', 'members', 'staff');
    for (const value of Object.values(payload)) {
        if (typeof value !== 'string') continue;
        expect(value).to.not.include('alice');
        expect(value).to.not.include('不该出现的姓名');
        expect(value).to.not.include('240340179');
        expect(value).to.not.include('民航大学');
        expect(value).to.not.include('一班');
        expect(value).to.not.include('created-by-carol');
    }
}

function assertWarn(stage: string, reason: string) {
    expect(warnings).to.deep.equal([['domain=%s uid=%s stage=%s reason=%s', domainId, adminUid, stage, reason]]);
}

function assertScope(actorId: number, schoolId: ObjectId) {
    expect(scopeCalls).to.deep.equal([
        {
            domainId,
            schoolHex: schoolId.toHexString(),
            actorId,
            actorKeys: ['_id'],
        },
    ]);
}

describe('admin teacher group operations', { concurrency: false }, () => {
    before(() => {
        const loaded = loadHandlers();
        AdminGroupsHandler = loaded.AdminGroupsHandler;
        AdminGroupDetailHandler = loaded.AdminGroupDetailHandler;
        AdminSchoolDetailHandler = loaded.AdminSchoolDetailHandler;
        userBindModel = require('../src/model').userBindModel;
        userBindModel.listInviteTokens = async () => [];
        const originals = {
            setGroupTeacherAttachable: userBindModel.setGroupTeacherAttachable,
            setGroupOwner: userBindModel.setGroupOwner,
            clearGroupOwner: userBindModel.clearGroupOwner,
            addSchoolStaff: userBindModel.addSchoolStaff,
            removeSchoolStaff: userBindModel.removeSchoolStaff,
        };
        for (const name of Object.keys(originals) as Array<keyof typeof originals>) {
            userBindModel[name] = async (...args: unknown[]) => {
                modelCalls[name].push(args);
                return originals[name](...args);
            };
        }
    });

    beforeEach(() => {
        for (const coll of collections.values()) coll.clear();
        users.clear();
        warnings.length = 0;
        oplogs.length = 0;
        lookups.length = 0;
        scopeCalls.length = 0;
        for (const key of Object.keys(modelCalls)) modelCalls[key].length = 0;
        users.set(createdByUid, { _id: createdByUid, uname: 'created-by-carol', realName: '不该出现的姓名' });
    });

    it('prepare 只放行 PRIV_EDIT_SYSTEM，写操作不在另一类 handler 上', async () => {
        expect(Object.getPrototypeOf(AdminGroupDetailHandler.prototype).constructor.name).to.equal('UserbindAdminHandler');
        expect(Object.getPrototypeOf(AdminSchoolDetailHandler.prototype).constructor.name).to.equal('UserbindAdminHandler');
        expect(Object.getPrototypeOf(AdminGroupsHandler.prototype).constructor.name).to.equal('UserbindAdminHandler');
        expect(AdminGroupDetailHandler.prototype.postSetTeacherAttachable).to.be.a('function');
        expect(AdminGroupDetailHandler.prototype.postTransferOwner).to.be.a('function');
        expect(AdminGroupDetailHandler.prototype.postClearOwner).to.be.a('function');
        expect(AdminSchoolDetailHandler.prototype.postAddStaff).to.be.a('function');
        expect(AdminSchoolDetailHandler.prototype.postRemoveStaff).to.be.a('function');
        expect(AdminGroupDetailHandler.prototype).to.not.have.property('postAddStaff');
        expect(AdminSchoolDetailHandler.prototype).to.not.have.property('postTransferOwner');
        expect(AdminGroupsHandler.prototype).to.not.have.property('postClearOwner');
        for (const Ctor of [AdminGroupsHandler, AdminGroupDetailHandler, AdminSchoolDetailHandler]) {
            const seen: number[] = [];
            const denied = new Ctor();
            denied.user = {
                _id: adminUid,
                hasPriv: (priv: number) => {
                    seen.push(priv);
                    return false;
                },
            };
            const error = await rejectionOf(() => denied.prepare());
            expect(error.name).to.equal('PermissionError');
            expect(seen).to.deep.equal([1]);
            seen.length = 0;
            const allowed = new Ctor();
            allowed.user = {
                _id: adminUid,
                hasPriv: (priv: number) => {
                    seen.push(priv);
                    return priv === 1;
                },
            };
            await allowed.prepare();
            expect(seen).to.deep.equal([1]);
        }
    });

    it('组列表投影 owner 与 teacherAttachable，并且不回填数据库', async () => {
        const school = await insertSchool();
        const otherSchool = await insertSchool({ name: '另一所' });
        rememberUser(42);
        users.set(43, { _id: 43, realName: '不该出现的姓名' });
        const plain = await insertGroup(school._id, { name: '普通组', createdAt: new Date('2026-09-03T00:00:00Z') });
        const owned = await insertGroup(school._id, { name: '老师组', ownerUid: 42, createdAt: new Date('2026-09-04T00:00:00Z') });
        const missingOwner = await insertGroup(school._id, { name: '缺用户', ownerUid: 99, createdAt: new Date('2026-09-05T00:00:00Z') });
        const nameless = await insertGroup(school._id, { name: '无用户名', ownerUid: 43, createdAt: new Date('2026-09-06T00:00:00Z') });
        const opened = await insertGroup(school._id, { name: '已开放', teacherAttachable: true, createdAt: new Date('2026-09-07T00:00:00Z') });
        const explicitFalse = await insertGroup(school._id, { name: '显式关闭', teacherAttachable: false, createdAt: new Date('2026-09-01T00:00:00Z') });
        await insertGroup(otherSchool._id, { name: '另一校' });
        await insertGroup(school._id, { name: '别的域', domainId: 'other' });
        await insertGroup(school._id, { name: '系统域', domainId: 'system' });
        const beforePlain = await groups.findOne({ _id: plain._id });

        const page = admin('groups');
        await page.get({ domainId, schoolId: school._id.toHexString() });
        const body = page.response.body;
        expect(page.response.template).to.equal('admin_userbind_groups.html');
        expect(body.filterSchoolId.equals(school._id)).to.equal(true);
        expect(body.schools).to.have.length(2);
        const names = body.groups.map((group: { name: string }) => group.name);
        expect(names).to.not.include('另一校');
        expect(names).to.not.include('别的域');
        expect(names).to.not.include('系统域');
        const byName = new Map<string, AdminGroupListRow>(body.groups.map((group: AdminGroupListRow) => [group.name, group]));

        const plainRow = byName.get('普通组');
        expect(plainRow.ownerUid).to.equal(null);
        expect(plainRow.ownerName).to.equal(null);
        expect(plainRow.teacherAttachable).to.equal(false);
        expect(plainRow.teacherAttachable).to.be.a('boolean');
        expect(lookups.map((item) => item.uid)).to.not.include(createdByUid);

        const ownedRow = byName.get('老师组');
        expect(ownedRow.ownerUid).to.equal(42);
        expect(ownedRow.ownerName).to.equal('alice');
        expect(ownedRow.ownerName).to.not.equal('不该出现的姓名');
        expect(ownedRow.teacherAttachable).to.equal(false);
        expect(lookups).to.deep.include({ domainId, uid: 42 });

        expect(byName.get('缺用户').ownerUid).to.equal(99);
        expect(byName.get('缺用户').ownerName).to.equal(null);
        expect(byName.get('无用户名').ownerUid).to.equal(43);
        expect(byName.get('无用户名').ownerName).to.equal(null);
        expect(byName.get('已开放').teacherAttachable).to.equal(true);
        expect(byName.get('显式关闭').teacherAttachable).to.equal(false);

        expect(groups.updates).to.eql([]);
        const storedPlain = await groups.findOne({ _id: plain._id });
        expect(storedPlain).to.deep.equal(beforePlain);
        expect(Object.hasOwn(storedPlain, 'ownerUid')).to.equal(false);
        expect(Object.hasOwn(storedPlain, 'ownerName')).to.equal(false);
        expect(Object.hasOwn(storedPlain, 'teacherAttachable')).to.equal(false);
        expect(Object.hasOwn(await groups.findOne({ _id: owned._id }), 'ownerName')).to.equal(false);
        expect(Object.hasOwn(await groups.findOne({ _id: missingOwner._id }), 'ownerName')).to.equal(false);
        expect(Object.hasOwn(await groups.findOne({ _id: nameless._id }), 'ownerName')).to.equal(false);
        expect((await groups.findOne({ _id: explicitFalse._id })).teacherAttachable).to.equal(false);
        expect((await groups.findOne({ _id: opened._id })).teacherAttachable).to.equal(true);

        const unfiltered = admin('groups');
        await unfiltered.get({ domainId });
        expect(unfiltered.response.body.filterSchoolId).to.equal(undefined);
        expect(unfiltered.response.body.groups.map((group: { name: string }) => group.name)).to.include('另一校');
    });

    it('组详情 group 带同样三个投影字段，学校详情里的组摘要不带', async () => {
        const school = await insertSchool();
        rememberUser(42);
        const group = await insertGroup(school._id, { ownerUid: 42, teacherAttachable: true });
        const detail = admin('group');
        await detail.get({ domainId, groupId: group._id.toHexString() });
        expect(detail.response.template).to.equal('admin_userbind_group_detail.html');
        const projected = detail.response.body.group;
        expect(projected.name).to.equal('一班');
        expect(projected.ownerUid).to.equal(42);
        expect(projected.ownerName).to.equal('alice');
        expect(projected.teacherAttachable).to.equal(true);
        expect(projected.teacherAttachable).to.be.a('boolean');
        expect(detail.response.body.members).to.eql([]);
        expect(Object.hasOwn(await groups.findOne({ _id: group._id }), 'ownerName')).to.equal(false);
        expect(groups.updates).to.eql([]);

        const schoolPage = admin('school');
        await schoolPage.get({ domainId, schoolId: school._id.toHexString() });
        expect(schoolPage.response.template).to.equal('admin_userbind_school_detail.html');
        expect(schoolPage.response.body.groups).to.have.length(1);
        expect(schoolPage.response.body.groups[0]).to.have.keys('_id', 'name', 'memberCount');
        expect(schoolPage.response.body.groups[0].memberCount).to.equal(0);
        expect(schoolPage.response.body.groups[0]).to.not.have.any.keys('ownerUid', 'ownerName', 'teacherAttachable');
    });

    it('学校详情 staff 按原顺序投影，缺字段是空数组且不回填', async () => {
        const missing = await insertSchool({ name: '无教师' });
        const listed = await insertSchool({ name: '有教师', staffUids: [7, 42] });
        const empty = await insertSchool({ name: '空数组', staffUids: [] });
        rememberUser(42, { uname: 'bob' });
        const page = admin('school');
        await page.get({ domainId, schoolId: missing._id.toHexString() });
        expect(page.response.body.staff).to.eql([]);
        expect(page.response.body.school).to.not.have.property('staff');
        expect(Object.hasOwn(await schools.findOne({ _id: missing._id }), 'staffUids')).to.equal(false);
        expect(schools.updates).to.eql([]);

        const ordered = admin('school');
        await ordered.get({ domainId, schoolId: listed._id.toHexString() });
        expect(ordered.response.body.staff).to.deep.equal([
            { uid: 7, uname: 'created-by-carol' },
            { uid: 42, uname: 'bob' },
        ]);
        expect(ordered.response.body.staff[0].uname).to.be.a('string');
        expect((await schools.findOne({ _id: listed._id })).staffUids).to.deep.equal([7, 42]);

        users.delete(7);
        const stale = admin('school');
        await stale.get({ domainId, schoolId: listed._id.toHexString() });
        expect(stale.response.body.staff).to.deep.equal([
            { uid: 7, uname: '' },
            { uid: 42, uname: 'bob' },
        ]);

        const blank = admin('school');
        await blank.get({ domainId, schoolId: empty._id.toHexString() });
        expect(blank.response.body.staff).to.eql([]);
        expect((await schools.findOne({ _id: empty._id })).staffUids).to.eql([]);
    });

    it('setTeacherAttachable 接受布尔和表单字符串，拒绝其它值、老师组和缺组', async () => {
        const school = await insertSchool();
        const group = await insertGroup(school._id);
        const detail = admin('group');
        await detail.postSetTeacherAttachable({ domainId, groupId: group._id.toHexString(), value: 'true' });
        expect((await groups.findOne({ _id: group._id })).teacherAttachable).to.equal(true);
        expect(detail.response.redirect).to.equal(`/admin_userbind_group_detail?groupId=${group._id.toHexString()}`);
        expect(warnings).to.eql([]);
        expect(oplogs).to.have.length(1);
        expect(oplogs[0].type).to.equal('userbind.admin.set_teacher_attachable');
        expect(oplogs[0].data).to.have.keys('uid', 'groupId', 'schoolId', 'value');
        expect(oplogs[0].data.uid).to.equal(adminUid);
        expect(oplogs[0].data.value).to.equal(true);
        expect(oplogs[0].data.groupId.equals(group._id)).to.equal(true);
        expect(oplogs[0].data.schoolId.equals(school._id)).to.equal(true);
        assertNoPii(oplogs[0].data);
        expect(modelCalls.setGroupTeacherAttachable).to.have.length(1);

        oplogs.length = 0;
        const turnOff = admin('group');
        await turnOff.postSetTeacherAttachable({ domainId, groupId: group._id.toHexString(), value: false });
        expect(Object.hasOwn(await groups.findOne({ _id: group._id }), 'teacherAttachable')).to.equal(false);
        expect(oplogs[0].data.value).to.equal(false);
        expect(warnings).to.eql([]);

        oplogs.length = 0;
        const stringOff = admin('group');
        await stringOff.postSetTeacherAttachable({ domainId, groupId: group._id.toHexString(), value: 'false' });
        expect(Object.hasOwn(await groups.findOne({ _id: group._id }), 'teacherAttachable')).to.equal(false);

        const teacherGroup = await insertGroup(school._id, { name: '老师的组', ownerUid: 42 });
        const rejectedOwner = await rejectionOf(() => admin('group').postSetTeacherAttachable({ domainId, groupId: teacherGroup._id.toHexString(), value: true }));
        expect(rejectedOwner.name).to.equal('ValidationError');
        expect(errorDetail(rejectedOwner)).to.include('老师的用户组不需要开放给老师使用');
        assertWarn('set_teacher_attachable', 'model_rejected');
        expect(oplogs.map((entry) => entry.data.groupId?.toHexString?.())).to.not.include(teacherGroup._id.toHexString());
        expect(Object.hasOwn(await groups.findOne({ _id: teacherGroup._id }), 'teacherAttachable')).to.equal(false);

        warnings.length = 0;
        const missing = await rejectionOf(() => admin('group').postSetTeacherAttachable({ domainId, groupId: new ObjectId().toHexString(), value: true }));
        expect(errorDetail(missing)).to.include('用户组不存在');
        assertWarn('set_teacher_attachable', 'model_rejected');

        warnings.length = 0;
        const beforeCalls = modelCalls.setGroupTeacherAttachable.length;
        const invalid = await rejectionOf(() => admin('group').postSetTeacherAttachable({ domainId, groupId: group._id.toHexString(), value: 'yes' }));
        expect(invalid.name).to.equal('ValidationError');
        expect(errorDetail(invalid)).to.include('value');
        expect(errorDetail(invalid)).to.not.include('用户不存在');
        assertWarn('set_teacher_attachable', 'invalid_value');
        expect(modelCalls.setGroupTeacherAttachable).to.have.length(beforeCalls);
        expect((await groups.findOne({ _id: group._id })).teacherAttachable).to.equal(undefined);

        warnings.length = 0;
        const wordNo = await rejectionOf(() => admin('group').postSetTeacherAttachable({ domainId, groupId: group._id.toHexString(), value: 'no' }));
        expect(errorDetail(wordNo)).to.include('value');
        assertWarn('set_teacher_attachable', 'invalid_value');
        expect(Object.hasOwn(await groups.findOne({ _id: group._id }), 'teacherAttachable')).to.equal(false);

        warnings.length = 0;
        const omitted = await rejectionOf(() => admin('group').postSetTeacherAttachable({ domainId, groupId: group._id.toHexString() }));
        expect(errorDetail(omitted)).to.include('value');
        expect(warnings).to.eql([]);
        expect(modelCalls.setGroupTeacherAttachable).to.have.length(beforeCalls);
    });

    it('transferOwner 用目标用户的 _id 做学校范围，拒绝缺用户、越权和缺组', async () => {
        const school = await insertSchool();
        const group = await insertGroup(school._id, { teacherAttachable: true, archivedAt: new Date('2026-09-08T00:00:00Z') });
        rememberUser(42);
        const detail = admin('group');
        await withStudentDirectory(scopeDirectory(school._id, { staffUids: [42] }), async () => {
            await detail.postTransferOwner({ domainId, groupId: group._id.toHexString(), ownerUid: 42 });
        });
        const stored = await groups.findOne({ _id: group._id });
        expect(stored.ownerUid).to.equal(42);
        expect(Object.hasOwn(stored, 'teacherAttachable')).to.equal(false);
        expect(stored.archivedAt).to.be.instanceOf(Date);
        assertScope(42, school._id);
        expect(detail.response.redirect).to.equal(`/admin_userbind_group_detail?groupId=${group._id.toHexString()}`);
        expect(warnings).to.eql([]);
        expect(modelCalls.setGroupOwner).to.have.length(1);
        expect(modelCalls.setGroupTeacherAttachable).to.eql([]);
        expect(oplogs[0].type).to.equal('userbind.admin.transfer_owner');
        expect(oplogs[0].data).to.have.keys('uid', 'groupId', 'schoolId', 'ownerUid');
        expect(oplogs[0].data.uid).to.equal(adminUid);
        expect(oplogs[0].data.ownerUid).to.equal(42);
        expect(oplogs[0].data.groupId.equals(group._id)).to.equal(true);
        expect(oplogs[0].data.schoolId.equals(school._id)).to.equal(true);
        assertNoPii(oplogs[0].data);

        scopeCalls.length = 0;
        oplogs.length = 0;
        warnings.length = 0;
        modelCalls.setGroupOwner.length = 0;
        const viaStudent = await insertGroup(school._id, { name: '学生记录范围' });
        await withStudentDirectory(scopeDirectory(school._id, { students: [{ uid: 42, schoolId: school._id }] }), async () => {
            await admin('group').postTransferOwner({ domainId, groupId: viaStudent._id.toHexString(), ownerUid: 42 });
        });
        expect((await groups.findOne({ _id: viaStudent._id })).ownerUid).to.equal(42);
        assertScope(42, school._id);

        scopeCalls.length = 0;
        oplogs.length = 0;
        modelCalls.setGroupOwner.length = 0;
        const outside = await insertGroup(school._id, { name: '越权' });
        users.set(99, {
            _id: 99,
            uname: 'alice',
            realName: '不该出现的姓名',
            studentId: '240340179',
            parentSchoolId: [school._id],
        });
        const outOfScope = await rejectionOf(() =>
            withStudentDirectory(scopeDirectory(school._id, { staffUids: [adminUid] }), async () => {
                await admin('group').postTransferOwner({ domainId, groupId: outside._id.toHexString(), ownerUid: 99 });
            }),
        );
        expect(errorDetail(outOfScope)).to.include('目标用户不在该学校的教师范围内');
        assertWarn('transfer_owner', 'school_out_of_scope');
        assertScope(99, school._id);
        expect(Object.hasOwn(await groups.findOne({ _id: outside._id }), 'ownerUid')).to.equal(false);
        expect(modelCalls.setGroupOwner).to.eql([]);
        expect(oplogs.map((entry) => entry.type)).to.not.include('userbind.admin.transfer_owner');

        warnings.length = 0;
        scopeCalls.length = 0;
        lookups.length = 0;
        const otherSchool = new ObjectId();
        const wrongStudentSchool = await insertGroup(school._id, { name: '学生在别校' });
        const wrongSchool = await rejectionOf(() =>
            withStudentDirectory(
                scopeDirectory(school._id, {
                    students: [{ uid: 42, schoolId: otherSchool }],
                    extraSchools: [{ _id: otherSchool, domainId, staffUids: [42] }],
                }),
                async () => {
                    await admin('group').postTransferOwner({ domainId, groupId: wrongStudentSchool._id.toHexString(), ownerUid: 42 });
                },
            ),
        );
        expect(errorDetail(wrongSchool)).to.include('目标用户不在该学校的教师范围内');
        assertScope(42, school._id);

        warnings.length = 0;
        scopeCalls.length = 0;
        lookups.length = 0;
        oplogs.length = 0;
        const absentUser = await insertGroup(school._id, { name: '用户不存在' });
        const missingUser = await rejectionOf(() =>
            withStudentDirectory(scopeDirectory(school._id, { staffUids: [77] }), async () => {
                await admin('group').postTransferOwner({ domainId, groupId: absentUser._id.toHexString(), ownerUid: 77 });
            }),
        );
        expect(errorDetail(missingUser)).to.include('用户不存在');
        expect(errorDetail(missingUser)).to.not.include('目标用户不在该学校的教师范围内');
        assertWarn('transfer_owner', 'user_not_found');
        expect(scopeCalls).to.eql([]);
        expect(lookups).to.deep.equal([{ domainId, uid: 77 }]);
        expect(Object.hasOwn(await groups.findOne({ _id: absentUser._id }), 'ownerUid')).to.equal(false);
        expect(oplogs).to.eql([]);

        warnings.length = 0;
        lookups.length = 0;
        const missingGroup = await rejectionOf(() => admin('group').postTransferOwner({ domainId, groupId: new ObjectId().toHexString(), ownerUid: 42 }));
        expect(errorDetail(missingGroup)).to.include('用户组不存在');
        assertWarn('transfer_owner', 'group_not_found');
        expect(lookups).to.eql([]);
        expect(scopeCalls).to.eql([]);
        expect(oplogs).to.eql([]);
    });

    it('clearOwner 只去掉 ownerUid，已有 teacherAttachable 保持原值', async () => {
        const school = await insertSchool();
        const kept = await insertGroup(school._id, { ownerUid: 42, teacherAttachable: true });
        const detail = admin('group');
        await detail.postClearOwner({ domainId, groupId: kept._id.toHexString() });
        const stored = await groups.findOne({ _id: kept._id });
        expect(Object.hasOwn(stored, 'ownerUid')).to.equal(false);
        expect(stored.teacherAttachable).to.equal(true);
        expect(modelCalls.clearGroupOwner).to.have.length(1);
        expect(modelCalls.setGroupTeacherAttachable).to.eql([]);
        expect(scopeCalls).to.eql([]);
        expect(warnings).to.eql([]);
        expect(detail.response.redirect).to.equal(`/admin_userbind_group_detail?groupId=${kept._id.toHexString()}`);
        expect(oplogs[0].type).to.equal('userbind.admin.clear_owner');
        expect(oplogs[0].data).to.have.keys('uid', 'groupId', 'schoolId');
        expect(oplogs[0].data.uid).to.equal(adminUid);
        expect(oplogs[0].data.groupId.equals(kept._id)).to.equal(true);
        expect(oplogs[0].data.schoolId.equals(school._id)).to.equal(true);
        assertNoPii(oplogs[0].data);

        const normal = await insertGroup(school._id, { name: '只有所有者', ownerUid: 42 });
        await admin('group').postClearOwner({ domainId, groupId: normal._id.toHexString() });
        const cleared = await groups.findOne({ _id: normal._id });
        expect(Object.hasOwn(cleared, 'ownerUid')).to.equal(false);
        expect(Object.hasOwn(cleared, 'teacherAttachable')).to.equal(false);

        oplogs.length = 0;
        const missing = await rejectionOf(() => admin('group').postClearOwner({ domainId, groupId: new ObjectId().toHexString() }));
        expect(errorDetail(missing)).to.include('用户组不存在');
        assertWarn('clear_owner', 'group_not_found');
        expect(oplogs).to.eql([]);
        expect(modelCalls.clearGroupOwner).to.have.length(2);
    });

    it('addStaff 要求用户存在，重复添加不产生第二个 uid', async () => {
        const school = await insertSchool();
        rememberUser(42, { uname: 'bob' });
        const page = admin('school');
        await page.postAddStaff({ domainId, schoolId: school._id.toHexString(), uid: 42 });
        expect((await schools.findOne({ _id: school._id })).staffUids).to.deep.equal([42]);
        expect(page.response.redirect).to.equal(`/admin_userbind_school_detail?schoolId=${school._id.toHexString()}`);
        expect(warnings).to.eql([]);
        expect(scopeCalls).to.eql([]);
        expect(oplogs[0].type).to.equal('userbind.admin.add_staff');
        expect(oplogs[0].data).to.have.keys('uid', 'schoolId', 'staffUid');
        expect(oplogs[0].data.uid).to.equal(adminUid);
        expect(oplogs[0].data.staffUid).to.equal(42);
        expect(oplogs[0].data.schoolId.equals(school._id)).to.equal(true);
        assertNoPii(oplogs[0].data);

        await admin('school').postAddStaff({ domainId, schoolId: school._id.toHexString(), uid: 42 });
        expect((await schools.findOne({ _id: school._id })).staffUids).to.deep.equal([42]);

        const viewed = admin('school');
        await viewed.get({ domainId, schoolId: school._id.toHexString() });
        expect(viewed.response.body.staff).to.deep.equal([{ uid: 42, uname: 'bob' }]);

        warnings.length = 0;
        oplogs.length = 0;
        const missingUser = await rejectionOf(() => admin('school').postAddStaff({ domainId, schoolId: school._id.toHexString(), uid: 77 }));
        expect(errorDetail(missingUser)).to.include('用户不存在');
        assertWarn('add_staff', 'user_not_found');
        expect(modelCalls.addSchoolStaff).to.have.length(2);
        expect((await schools.findOne({ _id: school._id })).staffUids).to.deep.equal([42]);
        expect(oplogs).to.eql([]);

        warnings.length = 0;
        const missingSchool = await rejectionOf(() => admin('school').postAddStaff({ domainId, schoolId: new ObjectId().toHexString(), uid: 42 }));
        expect(errorDetail(missingSchool)).to.include('School not found');
        assertWarn('add_staff', 'model_rejected');
        expect(oplogs).to.eql([]);
        expect(schools.docs).to.have.length(1);
    });

    it('removeStaff 不要求用户仍存在，学校不存在时拒绝且不改其它学校', async () => {
        const school = await insertSchool({ staffUids: [7, 42] });
        const other = await insertSchool({ name: '保持不动', staffUids: [42] });
        const beforeLookups = lookups.length;
        const page = admin('school');
        await page.postRemoveStaff({ domainId, schoolId: school._id.toHexString(), uid: 7 });
        expect((await schools.findOne({ _id: school._id })).staffUids).to.deep.equal([42]);
        expect((await schools.findOne({ _id: other._id })).staffUids).to.deep.equal([42]);
        expect(lookups).to.have.length(beforeLookups);
        expect(page.response.redirect).to.equal(`/admin_userbind_school_detail?schoolId=${school._id.toHexString()}`);
        expect(warnings).to.eql([]);
        expect(oplogs[0].type).to.equal('userbind.admin.remove_staff');
        expect(oplogs[0].data).to.have.keys('uid', 'schoolId', 'staffUid');
        expect(oplogs[0].data.staffUid).to.equal(7);
        expect(oplogs[0].data.uid).to.equal(adminUid);
        assertNoPii(oplogs[0].data);
        expect(modelCalls.removeSchoolStaff).to.have.length(1);

        oplogs.length = 0;
        const missing = await rejectionOf(() => admin('school').postRemoveStaff({ domainId, schoolId: new ObjectId().toHexString(), uid: 42 }));
        expect(errorDetail(missing)).to.include('School not found');
        assertWarn('remove_staff', 'school_not_found');
        expect(modelCalls.removeSchoolStaff).to.have.length(1);
        expect((await schools.findOne({ _id: other._id })).staffUids).to.deep.equal([42]);
        expect(oplogs).to.eql([]);
    });
});
