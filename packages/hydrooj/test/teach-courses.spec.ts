import { readdirSync, readFileSync } from 'node:fs';
import { createRequire, type Module as NodeModule } from 'node:module';
import nodePath from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { PERM, PRIV } from '@hydrooj/common';
import { PermissionError } from '../src/error';

// This line matches @hydrooj/register's CJS strip so __filename stays defined.
const __filename = fileURLToPath(import.meta.url);
const requireFromTest = createRequire(__filename);

const DOMAIN = 'teach';
const BULK_DOMAIN = 'bulk';
const BULK_TOTAL = 201;
const TYPE_TRAINING = 40;
const LOGIN = PRIV.PRIV_USER_PROFILE;

type TeachHandlerError = typeof PermissionError;

interface TeachActor {
    _id: number;
    uname: string;
    perm: bigint;
    priv: number;
    scope: bigint;
    hasPerm: (...perms: bigint[]) => boolean;
    hasPriv: (...privs: number[]) => boolean;
    own: (doc: { owner: number; maintainer?: number[] }, exact?: boolean) => boolean;
}

interface StoredDoc extends Record<string, unknown> {
    domainId: string;
    docType: number;
    _id: ObjectId;
    docId: ObjectId;
    kind: string;
    owner: number;
    maintainer: number[];
    title: string;
    term: string;
}

interface BoundStudent {
    _id: ObjectId;
    domainId: string;
    groupIds: ObjectId[];
    boundUserId: number;
}

interface RegisteredRoute {
    name: string;
    path: string;
    Handler: new () => TeachCoursesTestHandler;
    extras: unknown[];
}

interface ListQuery {
    scope?: string;
    q?: string;
}

const groupA = new ObjectId('64b00000000000000000000a');
const groupB = new ObjectId('64b00000000000000000000b');
const schoolId = new ObjectId('64b0000000000000000000e1');

const directories = {
    groups: [
        { _id: groupA, domainId: DOMAIN, schoolId, name: 'A班' },
        { _id: groupB, domainId: DOMAIN, schoolId, name: 'B班' },
    ],
};

const boundStudents: BoundStudent[] = [
    { _id: new ObjectId('64b000000000000000000101'), domainId: DOMAIN, groupIds: [groupA], boundUserId: 101 },
    { _id: new ObjectId('64b000000000000000000102'), domainId: DOMAIN, groupIds: [groupA, groupB], boundUserId: 102 },
    { _id: new ObjectId('64b000000000000000000103'), domainId: DOMAIN, groupIds: [groupB], boundUserId: 103 },
];

function createdId(offsetSeconds: number): ObjectId {
    const seconds = Math.floor(Date.parse('2026-01-01T00:00:00.000Z') / 1000) + offsetSeconds;
    return new ObjectId(`${seconds.toString(16).padStart(8, '0')}${offsetSeconds.toString(16).padStart(16, '0')}`);
}

function clip(serial: number, confirmed: boolean): Record<string, unknown> {
    return {
        id: `cv_${serial.toString().padStart(16, '0')}`,
        title: confirmed ? '已确认' : '待确认',
        filename: 'clip.mp4',
        ext: 'mp4',
        size: 2048,
        sha256: 'ab'.repeat(32),
        durationMs: confirmed ? 3000 : 0,
        confirmed,
        contentRevision: 1,
    };
}

function courseDoc(input: {
    offset: number;
    domainId?: string;
    owner: number;
    maintainer?: number[];
    title: string;
    term?: string;
    kind?: string;
    hidden?: boolean;
    groupIds?: ObjectId[];
    dag?: Record<string, unknown>[];
}): StoredDoc {
    const id = createdId(input.offset);
    const doc: StoredDoc = {
        domainId: input.domainId ?? DOMAIN,
        docType: TYPE_TRAINING,
        _id: id,
        docId: id,
        kind: input.kind ?? 'course',
        owner: input.owner,
        maintainer: input.maintainer ?? [],
        title: input.title,
        term: input.term ?? '',
        dag: input.dag ?? [{ _id: 1, title: '第一章', requireNids: [], pids: [] }],
    };
    if (input.hidden) doc.courseHidden = true;
    if (input.groupIds) doc.courseGroupIds = input.groupIds;
    return doc;
}

const circuitDag: Record<string, unknown>[] = [
    {
        _id: 1,
        title: '第一章',
        requireNids: [],
        pids: [11, 12],
        tids: [new ObjectId('64b0000000000000000000c1')],
        videos: [clip(1, true), clip(2, false)],
        sections: [
            {
                _id: 1,
                title: '1.1',
                pids: [12, 13],
                videos: [clip(3, true), clip(4, false)],
            },
        ],
    },
    {
        _id: 2,
        title: '第二章',
        requireNids: [],
        pids: [11, 14],
        videos: [clip(5, true)],
    },
];

const circuit = courseDoc({
    offset: 1500,
    owner: 7,
    maintainer: [9],
    title: '电路实验',
    term: '2026 秋',
    groupIds: [groupA, groupB],
    dag: circuitDag,
});
const termCpp = courseDoc({
    offset: 1450,
    owner: 7,
    title: '普通标题',
    term: 'C++ 学期',
});
const cppCourse = courseDoc({
    offset: 1400,
    owner: 7,
    title: 'C++ 数据结构',
    term: '2025 春',
    hidden: true,
});
const linear = courseDoc({
    offset: 1300,
    owner: 7,
    title: '线性代数',
    term: '2026.秋',
});
const dotted = courseDoc({
    offset: 1200,
    owner: 7,
    title: '点号课程',
    term: '2026X秋',
});
const paren = courseDoc({
    offset: 1100,
    owner: 7,
    title: '函数(入门)',
    term: '2024',
});
const maintainerOwned = courseDoc({
    offset: 1600,
    owner: 9,
    title: '我的课程',
    term: '2026 春',
});
const foreign = courseDoc({
    offset: 1550,
    owner: 8,
    title: '别人的课',
    term: '2026 夏',
});
const problemSet = courseDoc({
    offset: 1350,
    owner: 7,
    title: 'C++ 题集',
    term: '2026 秋',
    kind: 'problem_set',
    dag: [{ _id: 1, title: '阶段', requireNids: [], pids: [1] }],
});
const legacyTraining = courseDoc({
    offset: 1320,
    owner: 7,
    title: 'C++ 旧训练',
    term: '2026 秋',
    kind: 'training',
    dag: [{ _id: 1, title: '阶段', requireNids: [], pids: [2] }],
});
const user7Courses = [circuit, termCpp, cppCourse, linear, dotted, paren];
const visibleCourses = [maintainerOwned, foreign, ...user7Courses];
const bulkCourses = Array.from({ length: BULK_TOTAL }, (_, index) => courseDoc({
    offset: index + 1,
    domainId: BULK_DOMAIN,
    owner: 50,
    title: `批量课程 ${index + 1}`,
    term: '2026',
}));
const courses: StoredDoc[] = [...visibleCourses, problemSet, legacyTraining, ...bulkCourses];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
    if (left instanceof ObjectId && typeof right === 'string') return left.toHexString() === right;
    if (right instanceof ObjectId && typeof left === 'string') return right.toHexString() === left;
    if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
    return Object.is(left, right);
}

function compareOrder(left: unknown, right: unknown): number | null {
    if (left instanceof ObjectId && right instanceof ObjectId) {
        const leftHex = left.toHexString();
        const rightHex = right.toHexString();
        if (leftHex === rightHex) return 0;
        return leftHex < rightHex ? -1 : 1;
    }
    if (left instanceof Date || right instanceof Date) {
        const leftTime = left instanceof Date ? left.getTime() : typeof left === 'string' || typeof left === 'number' ? new Date(left).getTime() : Number.NaN;
        const rightTime = right instanceof Date ? right.getTime() : typeof right === 'string' || typeof right === 'number' ? new Date(right).getTime() : Number.NaN;
        if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) return null;
        return leftTime - rightTime;
    }
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    if (typeof left === 'string' && typeof right === 'string') {
        if (left === right) return 0;
        return left < right ? -1 : 1;
    }
    return null;
}

function getPath(doc: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = doc;
    for (const part of parts) {
        if (Array.isArray(current)) {
            current = current.map((item) => (isRecord(item) ? item[part] : undefined)).filter((item) => item !== undefined);
            if (Array.isArray(current) && current.length === 0) return undefined;
            continue;
        }
        if (!isRecord(current) || !Object.hasOwn(current, part)) return undefined;
        current = current[part];
    }
    return current;
}

function isOperatorObject(value: unknown): value is Record<string, unknown> {
    if (!isRecord(value)) return false;
    const keys = Object.keys(value);
    return keys.length > 0 && keys.every((key) => key.startsWith('$'));
}

function regexOf(pattern: unknown, options: unknown): RegExp | null {
    const extra = typeof options === 'string' ? options : '';
    if (pattern instanceof RegExp) {
        const flags = Array.from(new Set(`${pattern.flags}${extra}`)).join('');
        return new RegExp(pattern.source, flags);
    }
    if (typeof pattern === 'string') return new RegExp(pattern, extra);
    return null;
}

function matchesOperators(docValue: unknown, ops: Record<string, unknown>): boolean {
    const expression = ops.$regex === undefined ? null : regexOf(ops.$regex, ops.$options);
    for (const [op, expected] of Object.entries(ops)) {
        if (op === '$options') continue;
        if (op === '$regex') {
            const text = typeof docValue === 'string' ? docValue : docValue === undefined || docValue === null ? '' : null;
            if (text === null || !expression || !expression.test(text)) return false;
            continue;
        }
        if (op === '$eq') {
            if (!sameValue(docValue, expected)) return false;
            continue;
        }
        if (op === '$ne') {
            if (matchesElement(docValue, expected)) return false;
            continue;
        }
        if (op === '$in' || op === '$nin') {
            if (!Array.isArray(expected)) return false;
            const values = Array.isArray(docValue) ? docValue : [docValue];
            const hit = values.some((item) => expected.some((candidate) => sameValue(item, candidate)));
            if (op === '$in' ? !hit : hit) return false;
            continue;
        }
        if (op === '$exists') {
            const exists = docValue !== undefined;
            if (exists !== Boolean(expected)) return false;
            continue;
        }
        if (op === '$gt' || op === '$gte' || op === '$lt' || op === '$lte') {
            const compared = compareOrder(docValue, expected);
            if (compared === null) return false;
            if (op === '$gt' && !(compared > 0)) return false;
            if (op === '$gte' && !(compared >= 0)) return false;
            if (op === '$lt' && !(compared < 0)) return false;
            if (op === '$lte' && !(compared <= 0)) return false;
            continue;
        }
        return false;
    }
    return true;
}

function matchesElement(docValue: unknown, queryValue: unknown): boolean {
    if (Array.isArray(docValue)) return docValue.some((item) => sameValue(item, queryValue));
    return sameValue(docValue, queryValue);
}

function matchesValue(docValue: unknown, queryValue: unknown): boolean {
    if (queryValue instanceof RegExp) {
        return typeof docValue === 'string' && new RegExp(queryValue.source, queryValue.flags).test(docValue);
    }
    if (isOperatorObject(queryValue)) return matchesOperators(docValue, queryValue);
    if (Array.isArray(docValue) && !Array.isArray(queryValue)) return docValue.some((item) => sameValue(item, queryValue));
    return sameValue(docValue, queryValue);
}

function matchesQuery(doc: Record<string, unknown>, query: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(query)) {
        if (key === '$or') {
            if (!Array.isArray(value) || !value.some((item) => isRecord(item) && matchesQuery(doc, item))) return false;
            continue;
        }
        if (key === '$and') {
            if (!Array.isArray(value) || !value.every((item) => isRecord(item) && matchesQuery(doc, item))) return false;
            continue;
        }
        if (key === '$nor') {
            if (!Array.isArray(value) || value.some((item) => isRecord(item) && matchesQuery(doc, item))) return false;
            continue;
        }
        if (!matchesValue(getPath(doc, key), value)) return false;
    }
    return true;
}

class MemoryCursor {
    private sortSpec: Record<string, number> | null = null;

    private limitCount: number | null = null;

    private skipCount = 0;

    constructor(private readonly rows: StoredDoc[]) {}

    sort(spec: Record<string, number>): this {
        this.sortSpec = spec;
        return this;
    }

    limit(count: number): this {
        this.limitCount = count;
        return this;
    }

    skip(count: number): this {
        this.skipCount = count;
        return this;
    }

    project(): this {
        return this;
    }

    async count(): Promise<number> {
        return this.rows.length;
    }

    async toArray(): Promise<StoredDoc[]> {
        return this.materialize();
    }

    async *[Symbol.asyncIterator](): AsyncGenerator<StoredDoc> {
        const rows = this.materialize();
        for (const row of rows) yield row;
    }

    private materialize(): StoredDoc[] {
        const sorted = this.rows.map((row) => ({ ...row }));
        const spec = this.sortSpec;
        if (spec) {
            sorted.sort((left, right) => {
                for (const [key, direction] of Object.entries(spec)) {
                    const compared = compareOrder(getPath(left, key), getPath(right, key));
                    if (compared === null || compared === 0) continue;
                    return compared * direction;
                }
                return 0;
            });
        }
        const end = this.limitCount === null ? undefined : this.skipCount + this.limitCount;
        return sorted.slice(this.skipCount, end);
    }
}

function cursorFor(rows: StoredDoc[], query: Record<string, unknown>): MemoryCursor {
    return new MemoryCursor(rows.filter((row) => matchesQuery(row, query)));
}

function countRows(rows: StoredDoc[], query: Record<string, unknown>): number {
    return rows.filter((row) => matchesQuery(row, query)).length;
}

function hexOf(id: unknown): string {
    if (id instanceof ObjectId) return id.toHexString();
    return String(id);
}

function boundStudentsFor(domainId: string, groupIds: readonly unknown[]): BoundStudent[] {
    const wanted = new Set(groupIds.map((id) => hexOf(id)));
    return boundStudents.filter((student) => student.domainId === domainId && student.groupIds.some((id) => wanted.has(id.toHexString())));
}

const documentExports = {
    __esModule: true as const,
    TYPE_TRAINING,
    getMulti(domainId: string, docType: number, query?: Record<string, unknown>) {
        return cursorFor(courses, { docType, domainId, ...(query ?? {}) });
    },
    count(domainId: string, docType: number, query?: Record<string, unknown>) {
        return Promise.resolve(countRows(courses, { docType, domainId, ...(query ?? {}) }));
    },
    async get(domainId: string, docType: number, docId: unknown) {
        const found = courses.find((row) => matchesQuery(row, { domainId, docType, docId }));
        return found ?? null;
    },
    coll: {
        find(query: Record<string, unknown> = {}) {
            return cursorFor(courses, query);
        },
        countDocuments(query: Record<string, unknown> = {}) {
            return Promise.resolve(countRows(courses, query));
        },
    },
};

const trainingExports = {
    __esModule: true as const,
    getMulti(domainId: string, query: Record<string, unknown> = {}) {
        return documentExports.getMulti(domainId, TYPE_TRAINING, query).sort({ pin: -1, _id: -1 });
    },
    count(domainId: string, query: Record<string, unknown> = {}) {
        return documentExports.count(domainId, TYPE_TRAINING, query);
    },
    async get(domainId: string, docId: unknown) {
        return documentExports.get(domainId, TYPE_TRAINING, docId);
    },
};

const userApi = {
    async getList(_domainId: string, uids: readonly number[]) {
        const listed: Record<string, { _id: number; uname: string }> = {};
        for (const uid of uids) listed[String(uid)] = { _id: uid, uname: `用户${uid}` };
        return listed;
    },
    async getById(_domainId: string, uid: number) {
        return { _id: uid, uname: `用户${uid}` };
    },
};

const directoryApi = {
    async listSchools() {
        return [];
    },
    async getSchool() {
        return null;
    },
    async listUserGroups(domainId: string) {
        return directories.groups.filter((group) => group.domainId === domainId);
    },
    async findStudentByUserId() {
        return null;
    },
    async findStudentsByUserIds() {
        return {};
    },
    async searchBoundStudents() {
        return [];
    },
    async findBoundStudentsByGroupIds(domainId: string, groupIds: readonly unknown[]) {
        return boundStudentsFor(domainId, groupIds);
    },
    async loadExamRosterUserbindSnapshot() {
        throw new Error('teach courses does not load an exam roster');
    },
    async lookupStudent() {
        return { found: false, eligibleContestIds: [] as ObjectId[] };
    },
};

const directoryExports = {
    __esModule: true as const,
    studentDirectory: () => directoryApi,
    registerStudentDirectory() {
        return undefined;
    },
    async withStudentDirectory(_adapter: unknown, fn: () => Promise<unknown>) {
        return fn();
    },
};

class TeachCoursesTestHandler {
    user: TeachActor = teacher(0, [], []);

    domain = { _id: DOMAIN };

    response: { body: unknown; template: string | null } = { body: null, template: null };

    request = {
        query: {} as Record<string, string>,
        json: false,
        headers: {} as Record<string, string>,
        method: 'get',
        path: '/teach/courses',
        body: {} as Record<string, unknown>,
        params: {} as Record<string, string>,
    };

    args: Record<string, unknown> = {};

    session: Record<string, unknown> = {};

    ctx = {
        parallel: () => Promise.resolve(),
        setting: { get: () => undefined },
    };

    checkPriv(...privs: number[]): void {
        if (!this.user.hasPriv(...privs)) throw new Error(`missing priv ${privs.join(',')}`);
    }

    checkPerm(...perms: bigint[]): void {
        if (!this.user.hasPerm(...perms)) throw new PermissionError(...perms);
    }

    async get(_args: Record<string, unknown>): Promise<unknown> {
        throw new TypeError('teach courses export missing: get');
    }
}

const frameworkDecorators = requireFromTest('@hydrooj/framework/decorators') as {
    param: unknown;
    query: unknown;
    get: unknown;
    post: unknown;
    route: unknown;
};
const frameworkValidator = requireFromTest('@hydrooj/framework/validator') as { Types: unknown };
const serverExports = {
    __esModule: true as const,
    Handler: TeachCoursesTestHandler,
    param: frameworkDecorators.param,
    query: frameworkDecorators.query,
    get: frameworkDecorators.get,
    post: frameworkDecorators.post,
    route: frameworkDecorators.route,
    Types: frameworkValidator.Types,
};

const replaced: Array<{ resolved: string; previous: NodeModule | undefined }> = [];

function installStub(relativePath: string, exports: Record<string, unknown>): void {
    const resolved = requireFromTest.resolve(relativePath);
    replaced.push({ resolved, previous: requireFromTest.cache[resolved] });
    requireFromTest.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports,
    } as NodeModule;
}

installStub('../src/service/db.ts', { collection: () => ({ find: () => ({ toArray: async () => [] }) }) });
installStub('../src/model/document.ts', documentExports);
installStub('../src/model/training.ts', trainingExports);
installStub('../src/model/user.ts', { __esModule: true as const, default: userApi, ...userApi });
installStub('../src/service/student-directory.ts', directoryExports);
installStub('../src/service/server.ts', serverExports);

const hydroHost = global as unknown as { Hydro?: { model?: Record<string, unknown> } };
hydroHost.Hydro ||= { model: {} };
hydroHost.Hydro.model ||= {};
hydroHost.Hydro.model.document = documentExports;
hydroHost.Hydro.model.training = trainingExports;
hydroHost.Hydro.model.user = userApi;

after(() => {
    for (const item of replaced) {
        if (item.previous) requireFromTest.cache[item.resolved] = item.previous;
        else delete requireFromTest.cache[item.resolved];
    }
});

function teacher(uid: number, perms: readonly bigint[], privs: readonly number[]): TeachActor {
    let permMask = 0n;
    for (const perm of perms) permMask |= perm;
    let privMask = 0;
    for (const priv of privs) privMask |= priv;
    return {
        _id: uid,
        uname: `用户${uid}`,
        perm: permMask,
        priv: privMask,
        scope: -1n,
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => (permMask & perm) === perm),
        hasPriv: (...wanted: number[]) => wanted.some((priv) => (privMask & priv) === priv),
        own: (doc, exact) => (exact === true ? doc.owner === uid : doc.owner === uid || (doc.maintainer ?? []).includes(uid)),
    };
}

const user9 = teacher(9, [], [LOGIN]);
const user7 = teacher(7, [PERM.PERM_CREATE_COURSE], [LOGIN]);
const user4 = teacher(4, [], [LOGIN]);
const user3 = teacher(3, [PERM.PERM_CREATE_COURSE], [LOGIN]);
const user6 = teacher(6, [PERM.PERM_EDIT_COURSE], [LOGIN]);
const user2 = teacher(2, [], [LOGIN, PRIV.PRIV_EDIT_SYSTEM]);
const user50 = teacher(50, [], [LOGIN]);

let loadingRoute: Promise<RegisteredRoute> | null = null;

function isAssertion(error: unknown): boolean {
    return error instanceof Error && error.name === 'AssertionError';
}

function readApply(loaded: Record<string, unknown>): ((ctx: unknown) => unknown) | null {
    if (typeof loaded.apply === 'function') return loaded.apply as (ctx: unknown) => unknown;
    if (isRecord(loaded.default) && typeof loaded.default.apply === 'function') return loaded.default.apply as (ctx: unknown) => unknown;
    return null;
}

function teachCourseHandlerFiles(): string[] {
    const handlerDir = nodePath.resolve(nodePath.dirname(__filename), '../src/handler');
    const hits: string[] = [];
    for (const name of readdirSync(handlerDir)) {
        if (!name.endsWith('.ts') || name.endsWith('.d.ts')) continue;
        const full = nodePath.join(handlerDir, name);
        const text = readFileSync(full, 'utf8');
        if (text.includes("'/teach/courses'") || text.includes('"/teach/courses"') || text.includes('`/teach/courses`')) hits.push(full);
    }
    return hits;
}

async function loadRoute(): Promise<RegisteredRoute> {
    if (!loadingRoute) loadingRoute = loadRouteOnce();
    return loadingRoute;
}

async function loadRouteOnce(): Promise<RegisteredRoute> {
    const files = teachCourseHandlerFiles();
    expect(files.length > 0, 'GET /teach/courses').to.equal(true);
    const routes: RegisteredRoute[] = [];
    for (const file of files) {
        const loaded: unknown = requireFromTest(file);
        expect(isRecord(loaded), 'GET /teach/courses apply').to.equal(true);
        if (!isRecord(loaded)) continue;
        const apply = readApply(loaded);
        expect(apply === null, 'GET /teach/courses apply').to.equal(false);
        if (!apply) continue;
        await apply({
            Route(name: string, routePath: string, Handler: new () => TeachCoursesTestHandler, ...extras: unknown[]) {
                routes.push({ name, path: routePath, Handler, extras });
            },
        });
    }
    const route = routes.find((item) => item.path === '/teach/courses');
    expect(route === undefined, 'GET /teach/courses').to.equal(false);
    if (!route) throw new Error('GET /teach/courses');
    return route;
}

function runChecks(handler: TeachCoursesTestHandler, extras: unknown[]): void {
    for (const item of extras) {
        if (typeof item === 'number') handler.checkPriv(item);
        else if (typeof item === 'bigint') handler.checkPerm(item);
        else if (Array.isArray(item) && item.every((entry) => typeof entry === 'number')) handler.checkPriv(...item);
        else if (Array.isArray(item) && item.every((entry) => typeof entry === 'bigint')) handler.checkPerm(...item);
        else if (typeof item === 'function') item.call(handler);
    }
}

async function callList(actor: TeachActor, query: ListQuery = {}, domainId = DOMAIN, argumentDomainId = domainId): Promise<TeachCoursesTestHandler> {
    const route = await loadRoute();
    const handler = new route.Handler();
    const args: Record<string, unknown> = { domainId: argumentDomainId, ...query };
    handler.user = actor;
    handler.domain = { _id: domainId };
    handler.request.query = {};
    if (query.scope !== undefined) handler.request.query.scope = query.scope;
    if (query.q !== undefined) handler.request.query.q = query.q;
    handler.request.path = '/teach/courses';
    handler.args = args;
    runChecks(handler, route.extras);
    await handler.get(args);
    return handler;
}

function errorText(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function expectNamedError(run: () => Promise<unknown>, expected: TeachHandlerError): Promise<void> {
    try {
        await run();
    } catch (error) {
        if (isAssertion(error)) throw error;
        expect(error instanceof expected || (error instanceof Error && error.name === expected.name), errorText(error)).to.equal(true);
        return;
    }
    throw new Error(`expected ${expected.name}`);
}

function payloadOf(handler: TeachCoursesTestHandler): Record<string, unknown> {
    expect(handler.response.template).to.equal('teach_courses.html');
    expect(isRecord(handler.response.body), 'response body').to.equal(true);
    if (!isRecord(handler.response.body)) throw new Error('teach courses payload missing');
    return handler.response.body;
}

function rowsOf(body: Record<string, unknown>): Record<string, unknown>[] {
    expect(Array.isArray(body.rows), 'rows').to.equal(true);
    if (!Array.isArray(body.rows)) return [];
    for (const row of body.rows) expect(isRecord(row), 'rows').to.equal(true);
    return body.rows.filter(isRecord);
}

function stringField(row: Record<string, unknown>, key: string): string {
    const value = row[key];
    expect(typeof value, key).to.equal('string');
    if (typeof value !== 'string') throw new Error(key);
    return value;
}

function numberField(row: Record<string, unknown>, key: string): number {
    const value = row[key];
    expect(typeof value, key).to.equal('number');
    if (typeof value !== 'number') throw new Error(key);
    return value;
}

function stringList(value: unknown, label: string): string[] {
    expect(Array.isArray(value), label).to.equal(true);
    if (!Array.isArray(value)) return [];
    for (const item of value) expect(typeof item, label).to.equal('string');
    return value.map((item) => String(item));
}

function idsOf(rows: Record<string, unknown>[]): string[] {
    return rows.map((row) => stringField(row, 'id'));
}

function byNewest(docs: StoredDoc[]): StoredDoc[] {
    return [...docs].sort((left, right) => {
        const leftId = left._id.toHexString();
        const rightId = right._id.toHexString();
        if (leftId === rightId) return 0;
        return leftId < rightId ? 1 : -1;
    });
}

function expectIds(rows: Record<string, unknown>[], docs: StoredDoc[]): void {
    expect(idsOf(rows)).to.deep.equal(docs.map((doc) => doc.docId.toHexString()));
}

function expectMeta(body: Record<string, unknown>, meta: { scope: string; canSeeAll: boolean; canCreate: boolean; q: string }): void {
    expect(body.scope).to.equal(meta.scope);
    expect(body.canSeeAll).to.equal(meta.canSeeAll);
    expect(body.canCreate).to.equal(meta.canCreate);
    expect(body.q).to.equal(meta.q);
}

function rowById(rows: Record<string, unknown>[], doc: StoredDoc): Record<string, unknown> {
    const found = rows.find((row) => row.id === doc.docId.toHexString());
    expect(found === undefined, String(doc.title)).to.equal(false);
    if (!found) throw new Error(`missing row ${String(doc.title)}`);
    return found;
}

describe('teach courses', () => {
    it('registers get /teach/courses', async () => {
        const route = await loadRoute();
        expect(route.path).to.equal('/teach/courses');
    });

    it('returns a maintainer row with two classes and the stubbed student count', async () => {
        const body = payloadOf(await callList(user9, { scope: 'mine', q: '' }));
        expectMeta(body, { scope: 'mine', canSeeAll: false, canCreate: false, q: '' });
        const rows = rowsOf(body);
        expectIds(rows, byNewest([maintainerOwned, circuit]));
        const owned = rowById(rows, maintainerOwned);
        expect(owned.role).to.equal('owner');
        const row = rowById(rows, circuit);
        expect(row.role).to.equal('maintainer');
        expect(stringField(row, 'id')).to.equal(circuit.docId.toHexString());
        expect(stringField(row, 'title')).to.equal('电路实验');
        expect(stringField(row, 'term')).to.equal('2026 秋');
        expect(row.hidden).to.equal(false);
        expect(stringField(row, 'createdAt')).to.equal(circuit._id.getTimestamp().toISOString());
        const names = stringList(row.groupNames, 'groupNames');
        expect(names.length).to.equal(2);
        expect(names.includes('A班')).to.equal(true);
        expect(names.includes('B班')).to.equal(true);
        expect(numberField(row, 'boundStudentCount')).to.equal(boundStudentsFor(DOMAIN, [groupA, groupB]).length);
        expect(numberField(row, 'chapterCount')).to.equal(2);
        expect(numberField(row, 'videoCount')).to.equal(3);
        expect(numberField(row, 'problemCount')).to.equal(4);
    });

    it('returns the owner role and a null student count when the course has no classes', async () => {
        const body = payloadOf(await callList(user7, { scope: 'mine', q: '' }));
        expectMeta(body, { scope: 'mine', canSeeAll: false, canCreate: true, q: '' });
        const rows = rowsOf(body);
        expectIds(rows, byNewest(user7Courses));
        const owned = rowById(rows, circuit);
        expect(owned.role).to.equal('owner');
        expect(numberField(owned, 'videoCount')).to.equal(3);
        expect(numberField(owned, 'problemCount')).to.equal(4);
        const hidden = rowById(rows, cppCourse);
        expect(hidden.hidden).to.equal(true);
        expect(stringList(hidden.groupNames, 'groupNames').length).to.equal(0);
        expect(hidden.boundStudentCount).to.equal(null);
    });

    it('rejects scope=all for an ordinary teacher', async () => {
        const mine = payloadOf(await callList(user7, { scope: 'mine', q: '' }));
        expect(rowsOf(mine).length).to.equal(user7Courses.length);
        await expectNamedError(() => callList(user7, { scope: 'all', q: '' }), PermissionError);
        await expectNamedError(() => callList(user9, { scope: 'all', q: '' }), PermissionError);
        await expectNamedError(() => callList(user3, { scope: 'all', q: '' }), PermissionError);
    });

    it('rejects a teacher who cannot create and manages no course', async () => {
        await expectNamedError(() => callList(user4, { scope: 'mine', q: '' }), PermissionError);
        const body = payloadOf(await callList(user3, { scope: 'mine', q: '' }));
        expectMeta(body, { scope: 'mine', canSeeAll: false, canCreate: true, q: '' });
        expect(rowsOf(body).length).to.equal(0);
    });

    it('lets an editor list every course and marks a foreign course admin', async () => {
        const body = payloadOf(await callList(user6, { scope: 'all', q: '' }));
        expectMeta(body, { scope: 'all', canSeeAll: true, canCreate: false, q: '' });
        const rows = rowsOf(body);
        expectIds(rows, byNewest(visibleCourses));
        expect(rowById(rows, foreign).role).to.equal('admin');
        expect(rowById(rows, circuit).role).to.equal('admin');
        expect(idsOf(rows).includes(problemSet.docId.toHexString())).to.equal(false);
        expect(idsOf(rows).includes(legacyTraining.docId.toHexString())).to.equal(false);
        const admin = payloadOf(await callList(user2, { scope: 'all', q: '' }));
        expectMeta(admin, { scope: 'all', canSeeAll: true, canCreate: true, q: '' });
        expectIds(rowsOf(admin), byNewest(visibleCourses));
    });

    it('searches titles and terms with an escaped pattern', async () => {
        const plus = payloadOf(await callList(user7, { scope: 'mine', q: 'C++' }));
        expectMeta(plus, { scope: 'mine', canSeeAll: false, canCreate: true, q: 'C++' });
        expectIds(rowsOf(plus), byNewest([termCpp, cppCourse]));
        const term = payloadOf(await callList(user7, { scope: 'mine', q: '2026.秋' }));
        expectMeta(term, { scope: 'mine', canSeeAll: false, canCreate: true, q: '2026.秋' });
        expectIds(rowsOf(term), [linear]);
        const dot = payloadOf(await callList(user7, { scope: 'mine', q: '.' }));
        expectMeta(dot, { scope: 'mine', canSeeAll: false, canCreate: true, q: '.' });
        expectIds(rowsOf(dot), [linear]);
        const opening = payloadOf(await callList(user7, { scope: 'mine', q: '(' }));
        expectMeta(opening, { scope: 'mine', canSeeAll: false, canCreate: true, q: '(' });
        expectIds(rowsOf(opening), [paren]);
    });

    it('returns at most 200 courses newest id first', async () => {
        const body = payloadOf(await callList(user50, { scope: 'mine', q: '' }, BULK_DOMAIN));
        expectMeta(body, { scope: 'mine', canSeeAll: false, canCreate: false, q: '' });
        const rows = rowsOf(body);
        const newest = byNewest(bulkCourses);
        expect(rows.length).to.equal(200);
        expectIds(rows, newest.slice(0, 200));
        expect(idsOf(rows).includes(newest[200].docId.toHexString())).to.equal(false);
    });

    it('reads courses from the handler domain when the argument domain differs', async () => {
        const body = payloadOf(await callList(user7, { scope: 'mine', q: '' }, DOMAIN, 'forged'));
        expectIds(rowsOf(body), byNewest(user7Courses));
    });
});
