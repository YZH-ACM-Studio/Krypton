import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { expect } from 'chai';
import { Document, ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';
import { PERM, PRIV } from '@hydrooj/common';
import { localizedErrorText, param, Types, ValidationError } from '@hydrooj/framework';
import type { School, StudentRecord, UserGroup } from '../src/types';

const nodeRequire = createRequire(__filename);
const hydroojPackageJson = nodeRequire.resolve('hydrooj/package.json');
const scopeFile = join(dirname(hydroojPackageJson), 'src/lib/staff-school-scope.ts');
const directoryFile = join(dirname(hydroojPackageJson), 'src/service/student-directory.ts');
const { resolveStaffSchoolScope } = nodeRequire(scopeFile);
const { registerStudentDirectory } = nodeRequire(directoryFile);

const domainId = 'system';
const teacherUid = 7;
const otherUid = 8;
const warns: string[] = [];
const oplogs: Array<{ type: string; data: Record<string, unknown>; args: Record<string, unknown> }> = [];
let beforeNextStudentDelete: (() => void) | null = null;

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
        const state = {
            rows: this.docs.filter((doc) => matchesFilter(doc, filter)).map(cloneDoc),
            skip: 0,
            limit: Number.POSITIVE_INFINITY,
        };
        const cursor = {
            sort(spec?: Record<string, number>) {
                if (spec) state.rows.sort((left, right) => compareDocs(left, right, spec));
                return cursor;
            },
            skip(value: number) {
                state.skip = value;
                return cursor;
            },
            limit(value: number) {
                state.limit = value;
                return cursor;
            },
            async toArray() {
                const end = state.skip + state.limit;
                return state.rows.slice(state.skip, end);
            },
        };
        return cursor;
    }

    async insertOne(doc: Document) {
        this.docs.push(cloneDoc(doc));
        return { insertedId: doc._id };
    }

    async insertMany(docs: Document[]) {
        for (const doc of docs) this.docs.push(cloneDoc(doc));
        return { insertedCount: docs.length };
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
        if (beforeNextStudentDelete && this === students) {
            const hook = beforeNextStudentDelete;
            beforeNextStudentDelete = null;
            hook();
        }
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

    async createIndex() {
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

function arraysEqual(left: unknown[], right: unknown[]): boolean {
    return left.length === right.length && left.every((item, index) => valuesEqual(item, right[index]));
}

function isOperator(value: unknown): value is Record<string, unknown> {
    if (value == null || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) return false;
    if (typeof (value as { equals?: unknown }).equals === 'function') return false;
    return Object.keys(value as object).some((key) => key.startsWith('$'));
}

function matchesIn(docValue: unknown, items: unknown[]): boolean {
    if (Array.isArray(docValue)) return docValue.some((item) => items.some((candidate) => valuesEqual(item, candidate)));
    return items.some((item) => valuesEqual(docValue, item));
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
            if ('$in' in value && !matchesIn(docValue, (value.$in as unknown[]) || [])) return false;
            if ('$ne' in value && valuesEqual(docValue, value.$ne)) return false;
            if ('$regex' in value) {
                const pattern = value.$regex instanceof RegExp ? value.$regex : new RegExp(String(value.$regex), String(value.$options || ''));
                if (!pattern.test(String(docValue ?? ''))) return false;
            }
            continue;
        }
        if (Array.isArray(docValue) && Array.isArray(value)) {
            if (!arraysEqual(docValue, value)) return false;
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

function sortKey(value: unknown): string | number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.getTime();
    if (value && typeof (value as { toHexString?: unknown }).toHexString === 'function') {
        return (value as { toHexString: () => string }).toHexString();
    }
    if (value == null) return '';
    return String(value);
}

function compareDocs(left: Document, right: Document, spec: Record<string, number>): number {
    for (const [key, direction] of Object.entries(spec)) {
        if (direction !== 1 && direction !== -1) continue;
        const av = sortKey(left[key]);
        const bv = sortKey(right[key]);
        if (av === bv) continue;
        if (av < bv) return direction === 1 ? -1 : 1;
        return direction === 1 ? 1 : -1;
    }
    return 0;
}

function formatWarn(args: unknown[]): string {
    const [template, ...rest] = args;
    if (typeof template !== 'string') return args.map((item) => String(item)).join(' ');
    let index = 0;
    return template.replace(/%[sdifoO]/g, () => String(rest[index++]));
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

class TestHandler {
    user: { _id: number; perm?: bigint; parentSchoolId?: ObjectId[] } = { _id: 0 };

    args: Record<string, unknown> = {};

    response: { template?: string; body?: Record<string, unknown>; redirect?: string } = {};

    checkPerm(bit: bigint) {
        const perm = this.user?.perm;
        if (typeof perm !== 'bigint' || (perm & bit) !== bit) {
            const error = new Error('Permission denied');
            error.name = 'PermissionError';
            throw error;
        }
    }

    url(name: string, kwargs?: Record<string, unknown>) {
        const parts = Object.entries(kwargs || {}).map(([key, value]) => {
            const text =
                value && typeof (value as { toHexString?: unknown }).toHexString === 'function'
                    ? (value as { toHexString: () => string }).toHexString()
                    : String(value);
            return `${key}=${text}`;
        });
        return parts.length ? `${name}?${parts.join('&')}` : name;
    }
}

interface TeacherRouteHandler extends TestHandler {
    prepare(): Promise<void>;
    get(args: { domainId: string; groupId?: string; q?: string }): Promise<void>;
    postCreate(args: { domainId: string; schoolId: string; name: string }): Promise<void>;
    postRename(args: { domainId: string; groupId: string; name: string }): Promise<void>;
    postArchive(args: { domainId: string; groupId: string }): Promise<void>;
    postUnarchive(args: { domainId: string; groupId: string }): Promise<void>;
    postClearMembers(args: { domainId: string; groupId: string }): Promise<void>;
    postAdd(args: { domainId: string; groupId: string; studentRecordIds: string[] }): Promise<void>;
    postRemove(args: { domainId: string; groupId: string; studentRecordIds: string[] }): Promise<void>;
    postImportText(args: { domainId: string; groupId: string; text: string }): Promise<void>;
    postDeleteStudent(args: { domainId: string; groupId: string; studentRecordId: string }): Promise<void>;
    postDelete(args: { domainId: string; groupId: string }): Promise<void>;
}

interface TeacherGroupMemberRow {
    _id: string;
    studentId: string;
    realName: string;
    bound: boolean;
    deletable: boolean;
}

interface RouteSpec {
    name: string;
    path: string;
    Handler: new () => TeacherRouteHandler;
    priv: number;
}

function loadModules() {
    const Module = require('module');
    const originalLoad = Module._load;
    const utilsId = require.resolve('@hydrooj/utils');
    const cachedUtils = require.cache[utilsId];
    delete require.cache[utilsId];
    Module._load = function load(request: string, parent: unknown, isMain: boolean) {
        if (request === '@hydrooj/utils') {
            return {
                Logger: class RecordingLogger {
                    constructor(public name: string) {}

                    warn(...args: unknown[]) {
                        warns.push(formatWarn(args));
                    }

                    info() {}

                    debug() {}

                    error(...args: unknown[]) {
                        warns.push(formatWarn(args));
                    }
                },
            };
        }
        if (request === 'hydrooj') {
            return {
                db: { collection: (name: string) => collection(name) },
                ObjectId,
                UserModel: { coll: usersColl },
                ValidationError,
                localizedErrorText,
                resolveStaffSchoolScope,
                Handler: TestHandler,
                OplogModel: {
                    log: async (handler: { args?: Record<string, unknown> }, type: string, data: Record<string, unknown>) => {
                        oplogs.push({
                            type,
                            data: { ...data },
                            args: handler.args ? { ...handler.args } : {},
                        });
                    },
                },
                PERM,
                PRIV,
                Types,
                param,
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        for (const key of Object.keys(require.cache)) {
            if (key.includes(`${sep}krypton-userbind${sep}src${sep}`)) delete require.cache[key];
        }
        const handlers = require('../src/teacher-handler');
        const groupsApi = require('../src/teacher-groups');
        return { ...groupsApi, ...handlers };
    } finally {
        Module._load = originalLoad;
        if (cachedUtils) require.cache[utilsId] = cachedUtils;
        else delete require.cache[utilsId];
    }
}

const api = loadModules();
const { userBindModel } = require('../src/model');
registerStudentDirectory(userBindModel);

const schools = collection('userbind.schools');
const groups = collection('userbind.user_groups');
const students = collection('userbind.students');

const routes: RouteSpec[] = [];
api.applyTeacherGroupHandlers({
    Route(name: string, path: string, HandlerClass: new () => TeacherRouteHandler, priv: number) {
        routes.push({ name, path, Handler: HandlerClass, priv });
    },
});

function actor(parentSchoolId?: ObjectId[]) {
    return parentSchoolId ? { _id: teacherUid, parentSchoolId } : { _id: teacherUid };
}

function addSchool(name: string, staffUids: number[] = [], domain = domainId): School {
    const doc: School = {
        _id: new ObjectId(),
        domainId: domain,
        name,
        createdAt: new Date('2026-09-01T00:00:00Z'),
        createdBy: 1,
        staffUids,
    };
    schools.docs.push(doc);
    return doc;
}

function addGroup(schoolId: ObjectId, overrides: Partial<UserGroup> = {}): UserGroup {
    const doc: UserGroup = {
        _id: new ObjectId(),
        domainId,
        schoolId,
        name: '一班',
        createdAt: new Date('2026-09-01T00:00:00Z'),
        createdBy: teacherUid,
        ownerUid: teacherUid,
        ...overrides,
    };
    groups.docs.push(doc);
    return doc;
}

function addStudent(schoolId: ObjectId, overrides: Partial<StudentRecord> = {}): StudentRecord {
    const doc: StudentRecord = {
        _id: new ObjectId(),
        domainId,
        schoolId,
        studentId: `s${new ObjectId().toHexString().slice(0, 8)}`,
        realName: '张三',
        groupIds: [],
        boundUserId: null,
        boundAt: null,
        enrollmentYear: 2024,
        createdAt: new Date('2026-09-01T00:00:00Z'),
        createdBy: teacherUid,
        ...overrides,
    };
    students.docs.push(doc);
    return doc;
}

function errorDetail(error: unknown): string {
    const params = (error as { params?: unknown[] })?.params || [];
    return [String((error as Error)?.message || ''), ...params.map((value) => String(value))].join(' ');
}

async function capture(run: Promise<unknown>): Promise<unknown> {
    try {
        await run;
        return null;
    } catch (error) {
        return error;
    }
}

function handlerFor(name: string, user: { _id: number; perm?: bigint; parentSchoolId?: ObjectId[] }): TeacherRouteHandler {
    const route = routes.find((item) => item.name === name);
    if (!route) throw new Error(`missing route ${name}`);
    const handler = new route.Handler();
    handler.user = user;
    handler.args = { domainId };
    handler.response = {};
    return handler;
}

function teacherUser(perm: bigint = PERM.PERM_MANAGE_OWN_USER_GROUP, parentSchoolId?: ObjectId[]) {
    return { _id: teacherUid, perm, parentSchoolId };
}

function storedGroup(groupId: ObjectId): Document | undefined {
    return groups.docs.find((doc) => valuesEqual(doc._id, groupId));
}

function storedStudent(recordId: ObjectId): Document | undefined {
    return students.docs.find((doc) => valuesEqual(doc._id, recordId));
}

describe('teacher groups', { concurrency: false }, () => {
    beforeEach(() => {
        warns.length = 0;
        oplogs.length = 0;
        beforeNextStudentDelete = null;
        for (const coll of collections.values()) coll.clear();
        usersColl.clear();
    });

    it('registers teacher routes and wires them from the plugin entry', () => {
        expect(routes.map((route) => [route.name, route.path, route.priv])).to.deep.equal([
            ['teacher_user_groups', '/user-groups', PRIV.PRIV_USER_PROFILE],
            ['teacher_user_group_detail', '/user-groups/:groupId', PRIV.PRIV_USER_PROFILE],
        ]);
        const indexSource = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');
        expect(indexSource).to.include("import { applyTeacherGroupHandlers } from './src/teacher-handler';");
        expect(indexSource).to.include('applyTeacherGroupHandlers(ctx);');
        const source = readFileSync(resolve(__dirname, '../src/teacher-groups.ts'), 'utf8');
        expect(source).to.not.match(/updateStudent/);
        expect(source).to.not.match(/\bdeleteStudent\s*\(/);
    });

    it('没有权限位时拒绝进入', async () => {
        const handler = handlerFor('teacher_user_groups', teacherUser(PERM.PERM_CREATE_COLLECT));
        const error = await capture(handler.prepare());
        expect(error, 'missing permission').to.not.equal(null);
        expect((error as Error).name).to.equal('PermissionError');
        expect(warns.at(-1)).to.include('stage=prepare');
        expect(warns.at(-1)).to.include('reason=missing_permission');
        const allowed = handlerFor('teacher_user_group_detail', teacherUser(PERM.PERM_MANAGE_OWN_USER_GROUP));
        await allowed.prepare();
        expect(warns.filter((line) => line.includes('missing_permission'))).to.have.length(1);
    });

    it('没有学校范围时不能建组', async () => {
        const school = addSchool('外校');
        const error = await capture(api.createTeacherGroup(domainId, actor(), school._id, '一班'));
        expect(errorDetail(error), 'out of scope').to.include('你不能在这所学校建用户组');
        expect(groups.docs).to.have.length(0);
        expect(warns.at(-1)).to.include('stage=create');
        expect(warns.at(-1)).to.include('reason=school_out_of_scope');
        const missing = await capture(api.createTeacherGroup(domainId, actor(), new ObjectId(), '一班'));
        expect(errorDetail(missing), 'missing school').to.include('你不能在这所学校建用户组');
        expect(errorDetail(missing)).to.not.include('School not found');
        expect(groups.docs).to.have.length(0);
    });

    it('staffUids 或 parentSchoolId 范围内可以建自己的组', async () => {
        const school = addSchool('本校', [teacherUid]);
        const created = await api.createTeacherGroup(domainId, actor(), school._id, '  一班  ');
        expect(created.ownerUid).to.equal(teacherUid);
        expect(created.createdBy).to.equal(teacherUid);
        expect(created.name).to.equal('一班');
        expect(storedGroup(created._id)?.ownerUid).to.equal(teacherUid);

        const parentSchool = addSchool('家长学校');
        const fromParent = await api.createTeacherGroup(domainId, actor([parentSchool._id]), parentSchool._id, '家长班');
        expect(fromParent.ownerUid).to.equal(teacherUid);
        const handler = handlerFor('teacher_user_groups', teacherUser(PERM.PERM_MANAGE_OWN_USER_GROUP, [parentSchool._id]));
        await handler.prepare();
        await handler.postCreate({ domainId, schoolId: parentSchool._id.toHexString(), name: '页面班' });
        expect(handler.response.redirect).to.include('teacher_user_group_detail?groupId=');
        expect(handler.response.template).to.equal(undefined);
        const createdByPage = oplogs.at(-1);
        expect(createdByPage?.type).to.equal('userbind.teacher_group.create');
        expect(Object.keys(createdByPage?.data || {}).sort()).to.deep.equal(['groupId', 'schoolId', 'uid']);
        expect(JSON.stringify(createdByPage?.data)).to.not.include('页面班');
    });

    it('操作别人的组、范围外的组或不存在的组时不泄露', async () => {
        const school = addSchool('本校', [teacherUid]);
        const outside = addSchool('范围外');
        const foreign = addGroup(school._id, { ownerUid: otherUid, name: '别人的组', createdBy: otherUid });
        const outsideGroup = addGroup(outside._id, { name: '范围外的组' });
        const member = addStudent(school._id, { groupIds: [foreign._id], realName: '组内学生' });
        const candidate = addStudent(school._id, { realName: '待加入' });

        const renamed = await capture(api.renameTeacherGroup(domainId, actor(), foreign._id, '改名'));
        expect(errorDetail(renamed), 'rename foreign').to.include('用户组不存在或不属于你');
        expect(storedGroup(foreign._id)?.name).to.equal('别人的组');
        expect(warns.at(-1)).to.include('stage=rename');
        expect(warns.at(-1)).to.include('reason=not_owner');

        const scoped = await capture(api.renameTeacherGroup(domainId, actor(), outsideGroup._id, '改名'));
        expect(errorDetail(scoped), 'rename outside scope').to.include('用户组不存在或不属于你');
        expect(storedGroup(outsideGroup._id)?.name).to.equal('范围外的组');
        expect(warns.at(-1)).to.include('reason=school_out_of_scope');

        const missing = await capture(api.renameTeacherGroup(domainId, actor(), new ObjectId(), '改名'));
        expect(errorDetail(missing), 'rename missing').to.include('用户组不存在或不属于你');
        expect(errorDetail(missing)).to.not.include('别人的组');
        expect(warns.at(-1)).to.include('reason=group_missing');

        const archived = await capture(api.archiveTeacherGroup(domainId, actor(), foreign._id));
        expect(errorDetail(archived), 'archive foreign').to.include('用户组不存在或不属于你');
        expect(storedGroup(foreign._id)?.archivedAt).to.equal(undefined);

        const unarchived = await capture(api.unarchiveTeacherGroup(domainId, actor(), foreign._id));
        expect(errorDetail(unarchived), 'unarchive foreign').to.include('用户组不存在或不属于你');

        const deleted = await capture(api.deleteTeacherGroup(domainId, actor(), foreign._id));
        expect(errorDetail(deleted), 'delete foreign').to.include('用户组不存在或不属于你');
        expect(storedGroup(foreign._id)?.name).to.equal('别人的组');

        const cleared = await capture(api.clearTeacherGroupMembers(domainId, actor(), foreign._id));
        expect(errorDetail(cleared), 'clear foreign').to.include('用户组不存在或不属于你');
        expect((storedStudent(member._id)?.groupIds as ObjectId[]).map((id) => id.toHexString())).to.deep.equal([foreign._id.toHexString()]);

        const added = await capture(api.addToTeacherGroup(domainId, actor(), foreign._id, [candidate._id]));
        expect(errorDetail(added), 'add foreign').to.include('用户组不存在或不属于你');
        expect(storedStudent(candidate._id)?.groupIds).to.deep.equal([]);

        const removed = await capture(api.removeFromTeacherGroup(domainId, actor(), foreign._id, [member._id]));
        expect(errorDetail(removed), 'remove foreign').to.include('用户组不存在或不属于你');
        expect((storedStudent(member._id)?.groupIds as ObjectId[]).length).to.equal(1);

        const imported = await capture(api.importToTeacherGroup(domainId, actor(), foreign._id, '240340180 王五'));
        expect(errorDetail(imported), 'import foreign').to.include('用户组不存在或不属于你');
        expect(students.docs.some((doc) => doc.studentId === '240340180')).to.equal(false);

        const detail = await capture(api.buildTeacherGroupDetail(domainId, actor(), foreign._id, '', null));
        expect(errorDetail(detail), 'detail foreign').to.include('用户组不存在或不属于你');
        expect(errorDetail(detail)).to.not.include('别人的组');

        const searched = await capture(api.searchSchoolStudents(domainId, actor(), foreign._id, '组内'));
        expect(errorDetail(searched), 'search foreign').to.include('用户组不存在或不属于你');
    });

    it('add 混入别校记录时整批拒绝', async () => {
        const school = addSchool('本校', [teacherUid]);
        const other = addSchool('别校');
        const group = addGroup(school._id);
        const local = addStudent(school._id, { realName: '本校学生' });
        const foreign = addStudent(other._id, { realName: '别校学生' });
        const error = await capture(api.addToTeacherGroup(domainId, actor(), group._id, [local._id, foreign._id]));
        expect(errorDetail(error)).to.include('部分学生不属于该用户组所在学校，请刷新后重试');
        expect(storedStudent(local._id)?.groupIds).to.deep.equal([]);
        expect(storedStudent(foreign._id)?.groupIds).to.deep.equal([]);
        expect(warns.at(-1)).to.include('reason=student_school_mismatch');
        await api.addToTeacherGroup(domainId, actor(), group._id, [local._id]);
        expect((storedStudent(local._id)?.groupIds as ObjectId[]).map((id) => id.toHexString())).to.deep.equal([group._id.toHexString()]);
        await api.addToTeacherGroup(domainId, actor(), group._id, []);
        expect((storedStudent(local._id)?.groupIds as ObjectId[]).length).to.equal(1);
    });

    it('deleteOwnStudent 只删除本人新建、未绑定、且只在本人组里的记录', async () => {
        const school = addSchool('本校', [teacherUid]);
        const outside = addSchool('范围外');
        const mine = addGroup(school._id, { name: '我的组' });
        const alsoMine = addGroup(outside._id, { name: '范围外仍属于我' });
        const schoolGroup = addGroup(school._id, { name: '学校组', ownerUid: undefined, createdBy: 1 });
        delete storedGroup(schoolGroup._id)?.ownerUid;

        const notMine = addStudent(school._id, { createdBy: otherUid, groupIds: [mine._id] });
        const notCreator = await capture(api.deleteOwnStudent(domainId, actor(), notMine._id));
        expect(errorDetail(notCreator)).to.include('这条学生记录不是你新建的，请联系管理员处理');
        expect(storedStudent(notMine._id)?.studentId).to.equal(notMine.studentId);
        expect(warns.at(-1)).to.include('reason=delete_student_rejected');

        const bound = addStudent(school._id, { boundUserId: 20, boundAt: new Date(), groupIds: [mine._id] });
        const boundError = await capture(api.deleteOwnStudent(domainId, actor(), bound._id));
        expect(errorDetail(boundError)).to.include('这条学生记录已绑定账号，请联系管理员处理');
        expect(storedStudent(bound._id)).to.not.equal(undefined);

        const shared = addStudent(school._id, { groupIds: [mine._id, schoolGroup._id] });
        const sharedError = await capture(api.deleteOwnStudent(domainId, actor(), shared._id));
        expect(errorDetail(sharedError)).to.include('这条学生记录还在其他用户组中，请联系管理员处理');
        expect(storedStudent(shared._id)).to.not.equal(undefined);

        const ownedOnly = addStudent(school._id, { groupIds: [mine._id, alsoMine._id], realName: '可删学生' });
        await api.deleteOwnStudent(domainId, actor(), ownedOnly._id);
        expect(storedStudent(ownedOnly._id)).to.equal(undefined);

        const emptyGroups = addStudent(school._id, { groupIds: [], realName: '空组学生' });
        await api.deleteOwnStudent(domainId, actor(), emptyGroups._id);
        expect(storedStudent(emptyGroups._id)).to.equal(undefined);

        const racing = addStudent(school._id, { groupIds: [mine._id] });
        beforeNextStudentDelete = () => {
            const doc = storedStudent(racing._id);
            if (!doc) return;
            doc.groupIds = [...(doc.groupIds as ObjectId[]), new ObjectId()];
        };
        const raced = await capture(api.deleteOwnStudent(domainId, actor(), racing._id));
        expect(errorDetail(raced)).to.include('学生记录刚刚被修改，请刷新后重试');
        expect(storedStudent(racing._id)).to.not.equal(undefined);
    });

    it('清空全部成员后可以删除已归档的组', async () => {
        const school = addSchool('本校', [teacherUid]);
        const group = addGroup(school._id);
        for (let index = 0; index < 101; index += 1) {
            addStudent(school._id, {
                studentId: `s${String(index).padStart(3, '0')}`,
                realName: `学生${index}`,
                groupIds: [group._id],
            });
        }
        await api.archiveTeacherGroup(domainId, actor(), group._id);
        const removed = await api.clearTeacherGroupMembers(domainId, actor(), group._id);
        expect(removed, 'all 101 members cleared').to.equal(101);
        const left = students.docs.filter((doc) => ((doc.groupIds as ObjectId[]) || []).some((id) => id.equals(group._id)));
        expect(left.map((doc) => doc.studentId)).to.deep.equal([]);
        await api.deleteTeacherGroup(domainId, actor(), group._id);
        expect(storedGroup(group._id)).to.equal(undefined);
    });

    it('未清空成员时删除组沿用原有报错', async () => {
        const school = addSchool('本校', [teacherUid]);
        const group = addGroup(school._id);
        addStudent(school._id, { groupIds: [group._id] });
        await api.archiveTeacherGroup(domainId, actor(), group._id);
        const error = await capture(api.deleteTeacherGroup(domainId, actor(), group._id));
        expect(errorDetail(error)).to.include('该用户组仍有 1 名成员，请先移除全部成员');
        expect(storedGroup(group._id)?.name).to.equal('一班');
        const fresh = addGroup(school._id, { name: '未归档' });
        const notArchived = await capture(api.deleteTeacherGroup(domainId, actor(), fresh._id));
        expect(errorDetail(notArchived)).to.include('请先归档该用户组，只有已归档的用户组才能永久删除');
    });

    it('列表只投影范围内的本人组', async () => {
        const first = addSchool('甲校', [teacherUid]);
        const second = addSchool('乙校', [teacherUid]);
        const outside = addSchool('丙校');
        const hexOrder = [first, second].slice().sort((left, right) => left._id.toHexString().localeCompare(right._id.toHexString()));
        hexOrder[0].createdAt = new Date('2020-01-01T00:00:00Z');
        hexOrder[1].createdAt = new Date('2026-01-01T00:00:00Z');
        const inScope = addGroup(first._id, { name: 'b-group' });
        const inScopeLater = addGroup(second._id, { name: 'a-group' });
        addGroup(outside._id, { name: '范围外组' });
        addGroup(first._id, { name: '学校组', ownerUid: undefined, createdBy: 1 });
        const schoolGroup = groups.docs.find((doc) => doc.name === '学校组');
        if (schoolGroup) delete schoolGroup.ownerUid;
        addGroup(first._id, { name: '别域组', domainId: 'other', ownerUid: teacherUid });
        const counted = addStudent(first._id, { groupIds: [inScope._id] });
        addStudent(first._id, { domainId: 'other', groupIds: [inScope._id], studentId: 'other-domain' });
        addStudent(first._id, { groupIds: [inScope._id, inScope._id], studentId: 'dup-group' });
        const archived = addGroup(first._id, { name: '已归档', archivedAt: new Date('2026-09-02T00:00:00Z') });
        void counted;
        void archived;

        const payload = await api.buildTeacherGroupList(domainId, actor());
        expect(payload.noScopeMessage).to.equal(null);
        expect(payload.schools.map((item: { _id: string }) => item._id)).to.deep.equal(hexOrder.map((item) => item._id.toHexString()));
        expect(payload.schools.map((item: { name: string }) => item.name)).to.deep.equal(hexOrder.map((item) => item.name));
        expect(Object.keys(payload).sort()).to.deep.equal(['groups', 'noScopeMessage', 'schools']);
        expect(payload.groups.map((item: { name: string }) => item.name)).to.deep.equal(['a-group', 'b-group', '已归档']);
        const countedRow = payload.groups.find((item: { _id: string }) => item._id === inScope._id.toHexString());
        expect(countedRow.memberCount).to.equal(2);
        expect(countedRow.schoolName).to.equal('甲校');
        expect(Object.keys(countedRow).sort()).to.deep.equal(['_id', 'archived', 'memberCount', 'name', 'schoolId', 'schoolName']);
        expect(payload.groups.find((item: { _id: string }) => item._id === inScopeLater._id.toHexString()).memberCount).to.equal(0);
        expect(payload.groups.find((item: { name: string }) => item.name === '已归档').archived).to.equal(true);
        expect(payload.groups.some((item: { name: string }) => item.name === '范围外组' || item.name === '学校组' || item.name === '别域组')).to.equal(false);

        schools.docs.forEach((doc) => {
            doc.staffUids = [];
        });
        const empty = await api.buildTeacherGroupList(domainId, actor());
        expect(empty.schools).to.deep.equal([]);
        expect(empty.groups).to.deep.equal([]);
        expect(empty.noScopeMessage).to.equal('你还没有被加入任何学校的教师名单，请联系管理员');
    });

    it('详情按 Q3b 计算 deletable，搜索排除本组并最多 50 条', async () => {
        const school = addSchool('本校', [teacherUid]);
        const outside = addSchool('范围外');
        const group = addGroup(school._id, { name: '详情组' });
        const outsideGroup = addGroup(outside._id, { name: '范围外的我的组' });
        const schoolGroup = addGroup(school._id, { name: '学校组', createdBy: 1 });
        delete storedGroup(schoolGroup._id)?.ownerUid;
        const deletable = addStudent(school._id, {
            studentId: 'd-own',
            realName: '可删除',
            groupIds: [group._id, outsideGroup._id],
        });
        const bound = addStudent(school._id, {
            studentId: 'd-bound',
            realName: '已绑定',
            groupIds: [group._id],
            boundUserId: 30,
            boundAt: new Date(),
        });
        const foreignOwner = addStudent(school._id, {
            studentId: 'd-other',
            realName: '别人建的',
            groupIds: [group._id],
            createdBy: otherUid,
        });
        const shared = addStudent(school._id, {
            studentId: 'd-shared',
            realName: '还在学校组',
            groupIds: [group._id, schoolGroup._id],
        });
        const detail = await api.buildTeacherGroupDetail(domainId, actor(), group._id, '   ', null);
        expect(Object.keys(detail).sort()).to.deep.equal(['candidates', 'group', 'importReport', 'members', 'q']);
        expect(Object.keys(detail.group).sort()).to.deep.equal(['_id', 'archived', 'name', 'schoolId', 'schoolName']);
        expect(detail.group).to.not.have.property('ownerUid');
        expect(detail.q).to.equal('');
        expect(detail.candidates).to.deep.equal([]);
        expect(detail.importReport).to.equal(null);
        expect(detail.members.map((item: { studentId: string }) => item.studentId)).to.deep.equal(['d-bound', 'd-other', 'd-own', 'd-shared']);
        const byId = new Map<string, TeacherGroupMemberRow>(
            detail.members.map((item: TeacherGroupMemberRow): [string, TeacherGroupMemberRow] => [item.studentId, item]),
        );
        expect(byId.get('d-own').deletable).to.equal(true);
        expect(byId.get('d-own').bound).to.equal(false);
        expect(byId.get('d-bound').deletable).to.equal(false);
        expect(byId.get('d-bound').bound).to.equal(true);
        expect(byId.get('d-other').deletable).to.equal(false);
        expect(byId.get('d-shared').deletable).to.equal(false);
        expect(Object.keys(byId.get('d-own')).sort()).to.deep.equal(['_id', 'bound', 'deletable', 'realName', 'studentId']);
        void deletable;
        void bound;
        void foreignOwner;
        void shared;

        addStudent(school._id, { studentId: 'find-keep', realName: '候选甲', groupIds: [] });
        addStudent(school._id, { studentId: 'find-member', realName: '候选成员', groupIds: [group._id] });
        const found = await api.searchSchoolStudents(domainId, actor(), group._id, '候选');
        expect(found.map((item: StudentRecord) => item.studentId)).to.deep.equal(['find-keep']);
        expect(await api.searchSchoolStudents(domainId, actor(), group._id, '   ')).to.deep.equal([]);

        for (let index = 0; index < 51; index += 1) {
            addStudent(school._id, {
                studentId: `c${String(index).padStart(3, '0')}`,
                realName: '批量候选',
                groupIds: [],
            });
        }
        const page = await api.searchSchoolStudents(domainId, actor(), group._id, '批量候选');
        expect(page).to.have.length(50);
        expect(page.map((item: StudentRecord) => item.studentId)).to.deep.equal(
            Array.from({ length: 50 }, (_item, index) => `c${String(index).padStart(3, '0')}`),
        );
    });

    it('详情页导入会新建 createdBy 为老师的记录并原样返回报告', async () => {
        const school = addSchool('本校', [teacherUid]);
        const group = addGroup(school._id, { name: '导入组' });
        addStudent(school._id, { studentId: '240340179', realName: '张三', groupIds: [] });
        const handler = handlerFor('teacher_user_group_detail', teacherUser());
        await handler.prepare();
        const roster = '240340180 王五\n240340179 李四\n!!! 坏行';
        const requestBody = {
            groupId: group._id.toHexString(),
            text: roster,
        };
        handler.args = {
            domainId,
            ...requestBody,
        };
        await handler.postImportText({
            domainId,
            ...requestBody,
        });
        expect(handler.response.redirect).to.equal(undefined);
        expect(handler.response.template).to.equal('teacher_user_group_detail.html');
        const body = handler.response.body as {
            importReport: {
                created: number;
                attached: number;
                alreadyMember: number;
                autoBound: number;
                alreadyBound: number;
                failed: Array<{ studentId: string; reason: string }>;
                autoBindSkipped: Array<{ studentId: string; reason: string }>;
            };
            members: Array<{ studentId: string }>;
        };
        expect(Object.keys(body.importReport).sort()).to.deep.equal([
            'alreadyBound',
            'alreadyMember',
            'attached',
            'autoBindSkipped',
            'autoBound',
            'created',
            'failed',
        ]);
        expect(body.importReport.created).to.equal(1);
        expect(body.importReport.failed.map((item) => item.studentId).sort()).to.deep.equal(['!!!', '240340179']);
        expect(body.members.map((item) => item.studentId)).to.include('240340180');
        const created = storedStudentByStudentId('240340180');
        expect(created?.createdBy).to.equal(teacherUid);
        expect(created?.realName).to.equal('王五');
        expect((created?.groupIds as ObjectId[]).map((id) => id.toHexString())).to.deep.equal([group._id.toHexString()]);
        expect(storedStudentByStudentId('240340179')?.realName).to.equal('张三');
        const entry = oplogs.at(-1);
        expect(entry?.type).to.equal('userbind.teacher_group.import');
        expect(entry?.data.failed).to.equal(2);
        expect(entry?.data.autoBindSkipped).to.equal(0);
        expect(typeof entry?.data.failed).to.equal('number');
        const blob = JSON.stringify(entry?.data);
        expect(blob).to.not.include('王五');
        expect(blob).to.not.include('240340180');
        expect(blob).to.not.include('!!!');
        expect(entry?.data.created).to.equal(1);
        expect(entry?.args.domainId).to.equal(domainId);
        const storedArgs = JSON.stringify(entry?.args);
        expect(storedArgs).to.not.include('240340180 王五');
        expect(storedArgs).to.not.include('240340180');
        expect(storedArgs).to.not.include('王五');
    });

    it('详情页写操作重定向，失败不记 oplog', async () => {
        const school = addSchool('本校', [teacherUid]);
        const group = addGroup(school._id, { name: '操作组' });
        const record = addStudent(school._id, { groupIds: [], studentId: 'keep-id', realName: '秘名甲' });
        const foreign = addGroup(school._id, { ownerUid: otherUid, name: '别人的组', createdBy: otherUid });
        const deletable = addStudent(school._id, { groupIds: [group._id], studentId: 'del-id', realName: '待删' });
        const handler = handlerFor('teacher_user_group_detail', teacherUser());
        await handler.prepare();

        const before = oplogs.length;
        const rejected = await capture(handler.postDeleteStudent({ domainId, groupId: foreign._id.toHexString(), studentRecordId: deletable._id.toHexString() }));
        expect(errorDetail(rejected)).to.include('用户组不存在或不属于你');
        expect(storedStudent(deletable._id)).to.not.equal(undefined);
        expect(oplogs).to.have.length(before);

        const badId = await capture(handler.postAdd({ domainId, groupId: group._id.toHexString(), studentRecordIds: ['zzzzzzzzzzzz'] }));
        expect(errorDetail(badId)).to.include('学生记录参数无效');
        expect(oplogs).to.have.length(before);
        expect(warns.at(-1)).to.include('reason=bad_student_record_id');

        await handler.postRename({ domainId, groupId: group._id.toHexString(), name: '机密组名' });
        expect(handler.response.redirect).to.equal(`teacher_user_group_detail?groupId=${group._id.toHexString()}`);
        expect(oplogs.at(-1)?.type).to.equal('userbind.teacher_group.rename');
        expect(JSON.stringify(oplogs.at(-1)?.data)).to.not.include('机密组名');

        await handler.postAdd({ domainId, groupId: group._id.toHexString(), studentRecordIds: [record._id.toHexString()] });
        expect(oplogs.at(-1)?.type).to.equal('userbind.teacher_group.add');
        expect(oplogs.at(-1)?.data.count).to.equal(1);
        expect(JSON.stringify(oplogs.at(-1)?.data)).to.not.include('秘名甲');
        expect(JSON.stringify(oplogs.at(-1)?.data)).to.not.include('keep-id');

        await handler.postRemove({ domainId, groupId: group._id.toHexString(), studentRecordIds: [record._id.toHexString()] });
        expect(oplogs.at(-1)?.type).to.equal('userbind.teacher_group.remove');
        expect((storedStudent(record._id)?.groupIds as ObjectId[]).length).to.equal(0);

        await handler.postArchive({ domainId, groupId: group._id.toHexString() });
        expect(oplogs.at(-1)?.type).to.equal('userbind.teacher_group.archive');
        await handler.postClearMembers({ domainId, groupId: group._id.toHexString() });
        expect(oplogs.at(-1)?.type).to.equal('userbind.teacher_group.clear');
        expect(oplogs.at(-1)?.data.count).to.equal(1);
        await handler.postUnarchive({ domainId, groupId: group._id.toHexString() });
        expect(oplogs.at(-1)?.type).to.equal('userbind.teacher_group.unarchive');
        expect(storedGroup(group._id)?.archivedAt).to.equal(undefined);

        await handler.postDeleteStudent({ domainId, groupId: group._id.toHexString(), studentRecordId: deletable._id.toHexString() });
        expect(handler.response.redirect).to.equal(`teacher_user_group_detail?groupId=${group._id.toHexString()}`);
        expect(oplogs.at(-1)?.type).to.equal('userbind.teacher_group.delete_student');
        expect(oplogs.at(-1)?.data.recordId).to.equal(deletable._id.toHexString());
        expect(JSON.stringify(oplogs.at(-1)?.data)).to.not.include('del-id');
        expect(storedStudent(deletable._id)).to.equal(undefined);

        await handler.postArchive({ domainId, groupId: group._id.toHexString() });
        await handler.postDelete({ domainId, groupId: group._id.toHexString() });
        expect(handler.response.redirect).to.equal('teacher_user_groups');
        expect(oplogs.at(-1)?.type).to.equal('userbind.teacher_group.delete');
        expect(storedGroup(group._id)).to.equal(undefined);
    });

    it('列表页和详情页使用约定模板', async () => {
        const list = handlerFor('teacher_user_groups', teacherUser());
        await list.prepare();
        await list.get({ domainId });
        expect(list.response.template).to.equal('teacher_user_groups.html');
        expect(list.response.body?.noScopeMessage).to.equal('你还没有被加入任何学校的教师名单，请联系管理员');

        const school = addSchool('本校', [teacherUid]);
        const group = addGroup(school._id);
        const detail = handlerFor('teacher_user_group_detail', teacherUser());
        await detail.prepare();
        await detail.get({ domainId, groupId: group._id.toHexString(), q: '张' });
        expect(detail.response.template).to.equal('teacher_user_group_detail.html');
        expect(detail.response.body?.q).to.equal('张');
        expect(detail.response.body?.importReport).to.equal(null);
    });
});

function storedStudentByStudentId(studentId: string): Document | undefined {
    return students.docs.find((doc) => doc.studentId === studentId);
}
