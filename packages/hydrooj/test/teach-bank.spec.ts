import { createRequire, type Module as NodeModule } from 'node:module';
import { after, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PERM, PRIV } from '@hydrooj/common/permission';
import { parseMemoryMB, parseTimeMS } from '@hydrooj/utils';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import {
    NotFoundError,
    PermissionError,
    PrivilegeError,
    ValidationError,
} from '../src/error';

// The handler is loaded at runtime. A static import fails this lane's tsc gate
// while packages/hydrooj/src/handler/teach-bank.ts is still absent.
const __filename = fileURLToPath(import.meta.url);
const requireFromTest = createRequire(__filename);

const DOMAIN = 'school-domain';
const FORGED = 'forged-domain';
const TEACHER = 42;
const OTHER = 7;
const ADMIN = 3;
const STUDENT = 9;
const VIEWER = 8;
const PAGE_SIZE = 30;
const TYPE_PROBLEM = 10;
const UNREGISTERED = 'krypton-mindmap listTeachKnowledgeSources is not registered';
const ITEM_KEYS = [
    'courseId',
    'difficulty',
    'docId',
    'hidden',
    'kind',
    'mine',
    'nAccept',
    'nSubmit',
    'nodePath',
    'ownerName',
    'pid',
    'schoolShared',
    'tags',
    'title',
];
const TREE_FIELDS = ['docId', 'knowledgeMapId', 'knowledgeNodeIds', 'managedAuthoring.selectedMindmapNodeIds'];

interface TeachActor {
    _id: number;
    uname: string;
    hasPerm: (...perm: bigint[]) => boolean;
    hasPriv: (...priv: number[]) => boolean;
    own: (doc: { owner: number; maintainer?: number[] }, exact?: boolean) => boolean;
    _problemAclLoaded?: boolean;
    _pidNamespaceAclLoaded?: boolean;
    _problemAclDomainId?: string;
    _pidNamespaceAclDomainId?: string;
    _permitPids?: Set<number>;
    _authoredPids?: Set<number>;
    _maintainedPids?: Set<number>;
    _dataContributionPids?: Set<number>;
    _tagContributionPids?: Set<number>;
    _aclFencedPids?: Set<number>;
    _ownsLegacyProblems?: boolean;
    _managedContainerPids?: Set<number>;
    _pidNamespaceAuthorIds?: Set<string>;
    _pidNamespaceManagerIds?: Set<string>;
    _pidNamespaceEditAllIds?: Set<string>;
}

interface SourceNode {
    id: string;
    parentId: string | null;
    title: string;
    order: number;
    pinnedDocIds: number[];
}

interface Source {
    courseId: string;
    title: string;
    hidden: boolean;
    mapId: string;
    rootNodeId: string;
    nodes: SourceNode[];
}

interface Item {
    docId: number;
    pid: string;
    title: string;
    kind: string;
    difficulty: number | null;
    tags: string[];
    nSubmit: number;
    nAccept: number;
    hidden: boolean;
    mine: boolean;
    schoolShared: boolean;
    ownerName: string;
    courseId: string | null;
    nodePath: string[];
}

interface Page {
    items: Item[];
    page: number;
    pageCount: number;
    total: number;
}

interface NodeView {
    id: string;
    title: string;
    count: number;
    children: NodeView[];
}

interface CourseView {
    id: string;
    title: string;
    hidden: boolean;
    total: number;
    nodes: NodeView[];
}

interface Preview {
    item: Item;
    content: string;
    objective: unknown;
    limits: { timeMs: number | null; memoryMb: number | null };
}

interface TeachHandler {
    domain: { _id: string };
    user: TeachActor;
    response: { body?: unknown; template?: string | null };
    request: { query: Record<string, unknown>; params: Record<string, unknown> };
    args: Record<string, unknown>;
    init?: () => Promise<unknown> | unknown;
    prepare?: (raw: unknown) => Promise<unknown> | unknown;
    get?: (raw: unknown) => Promise<unknown> | unknown;
    checkPerm: (...perms: bigint[]) => void;
    checkPriv: (...privs: number[]) => void;
}

type HandlerConstructor = new (...ctorArgs: unknown[]) => TeachHandler;

interface Route {
    name: string;
    path: string;
    Handler: HandlerConstructor;
}

interface ProblemRead {
    op: string;
    domainId: string;
    projections: unknown[];
    query: unknown;
}

interface AclCall {
    fn: 'refresh' | 'assert';
    domainId: string;
    uid: number;
}

interface UserRead {
    domainId: string;
    uids: number[];
}

interface AccessModule {
    canBrowseProblemBank: (user: TeachActor) => boolean;
    buildProblemContainerSelectionScope: (user: TeachActor) => Record<string, unknown>;
    assertProblemAclDomain: (user: TeachActor, domainId: string) => void;
    refreshProblemAcl: (user: TeachActor, domainId: string) => Promise<void>;
}

const problems: Record<string, unknown>[] = [];
const sources: Source[] = [];
const names = new Map<number, string>([
    [TEACHER, '老师甲'],
    [OTHER, '老师乙'],
    [ADMIN, '管理员'],
    [STUDENT, '学生'],
    [VIEWER, '浏览者'],
]);
const problemReads: ProblemRead[] = [];
const aclCalls: AclCall[] = [];
const userReads: UserRead[] = [];
const replaced: Array<{ resolved: string; previous: NodeModule | undefined }> = [];
const hydroHost = global as unknown as { Hydro?: { model: Record<string, unknown> } };
if (!hydroHost.Hydro) hydroHost.Hydro = { model: {} };
const hydroRoot = hydroHost.Hydro as { model: Record<string, unknown>; ui?: Record<string, unknown> };
if (!hydroRoot.ui) hydroRoot.ui = {};
const hydroModel = hydroRoot.model;
const mindmapModel: Record<string, unknown> = {};
hydroModel.mindmap = mindmapModel;

let cachedRoutes: Route[] | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function moduleExports(loaded: unknown): Record<string, unknown> {
    if (!isRecord(loaded)) throw new TypeError('module exports are not an object');
    return { ...(isRecord(loaded.default) ? loaded.default : {}), ...loaded };
}

let access: AccessModule;

async function stubRefresh(user: TeachActor, domainId: string): Promise<void> {
    aclCalls.push({ fn: 'refresh', domainId: String(domainId), uid: user._id });
    await access.refreshProblemAcl(user, domainId);
}

function stubAssert(assertDomain: AccessModule['assertProblemAclDomain'], user: TeachActor, domainId: string): void {
    aclCalls.push({ fn: 'assert', domainId: String(domainId), uid: user._id });
    assertDomain(user, domainId);
}

function readPath(row: Record<string, unknown>, path: string): { found: boolean; value: unknown } {
    const parts = path.split('.');
    let current: unknown = row;
    for (const part of parts) {
        if (!isRecord(current) || !Object.hasOwn(current, part)) return { found: false, value: undefined };
        current = current[part];
    }
    return { found: true, value: current };
}

function valueEquals(actual: unknown, expected: unknown): boolean {
    if (expected instanceof RegExp) {
        const pattern = new RegExp(expected.source, expected.flags);
        if (Array.isArray(actual)) return actual.some((item) => typeof item === 'string' && pattern.test(item));
        return typeof actual === 'string' && pattern.test(actual);
    }
    if (expected === null || expected === undefined) return actual === null || actual === undefined;
    if (expected instanceof ObjectId || actual instanceof ObjectId) {
        return expected instanceof ObjectId && actual instanceof ObjectId && expected.toHexString() === actual.toHexString();
    }
    if (expected instanceof Date || actual instanceof Date) {
        return expected instanceof Date && actual instanceof Date && expected.getTime() === actual.getTime();
    }
    if (Array.isArray(actual)) {
        if (Array.isArray(expected)) {
            return actual.length === expected.length && actual.every((item, index) => valueEquals(item, expected[index]));
        }
        return actual.some((item) => valueEquals(item, expected));
    }
    return Object.is(actual, expected);
}

function isOperator(expected: unknown): expected is Record<string, unknown> {
    if (!isRecord(expected) || expected instanceof Date || expected instanceof ObjectId) return false;
    const keys = Object.keys(expected);
    return keys.length > 0 && keys.every((key) => key.startsWith('$'));
}

function regexMatches(actual: unknown, pattern: unknown, options: unknown): boolean {
    const patternSource = pattern instanceof RegExp ? pattern.source : String(pattern);
    const flags = pattern instanceof RegExp ? pattern.flags : typeof options === 'string' ? options : '';
    const compiled = new RegExp(patternSource, flags);
    if (Array.isArray(actual)) return actual.some((item) => typeof item === 'string' && compiled.test(item));
    return typeof actual === 'string' && compiled.test(actual);
}

function operatorMatches(actual: unknown, expected: Record<string, unknown>, found: boolean): boolean {
    if ('$regex' in expected) return regexMatches(actual, expected.$regex, expected.$options);
    for (const [op, value] of Object.entries(expected)) {
        if (op === '$exists') {
            if (found !== Boolean(value)) return false;
            continue;
        }
        if (op === '$eq') {
            if (!valueEquals(actual, value)) return false;
            continue;
        }
        if (op === '$ne') {
            if (valueEquals(actual, value)) return false;
            continue;
        }
        if (op === '$in') {
            if (!Array.isArray(value) || !value.some((candidate) => valueEquals(actual, candidate))) return false;
            continue;
        }
        if (op === '$nin') {
            if (!Array.isArray(value) || value.some((candidate) => valueEquals(actual, candidate))) return false;
            continue;
        }
        const left = typeof actual === 'number' ? actual : actual instanceof Date ? actual.getTime() : null;
        const right = typeof value === 'number' ? value : value instanceof Date ? value.getTime() : null;
        if (left === null || right === null) return false;
        if (op === '$gt' && !(left > right)) return false;
        else if (op === '$gte' && !(left >= right)) return false;
        else if (op === '$lt' && !(left < right)) return false;
        else if (op === '$lte' && !(left <= right)) return false;
        else if (!op.startsWith('$gt') && !op.startsWith('$lt')) return false;
    }
    return true;
}

function fieldMatches(row: Record<string, unknown>, key: string, expected: unknown): boolean {
    const read = readPath(row, key);
    if (isOperator(expected)) return operatorMatches(read.found ? read.value : undefined, expected, read.found);
    return valueEquals(read.found ? read.value : undefined, expected);
}

function matches(row: Record<string, unknown>, query: Record<string, unknown>): boolean {
    if (Array.isArray(query.$and) && !query.$and.every((part) => isRecord(part) && matches(row, part))) return false;
    if (Array.isArray(query.$or) && !query.$or.some((part) => isRecord(part) && matches(row, part))) return false;
    if (Array.isArray(query.$nor) && query.$nor.some((part) => isRecord(part) && matches(row, part))) return false;
    for (const [key, expected] of Object.entries(query)) {
        if (key === '$and' || key === '$or' || key === '$nor') continue;
        if (key.startsWith('$')) return false;
        if (!fieldMatches(row, key, expected)) return false;
    }
    return true;
}

function asQuery(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

function cloneRow(row: Record<string, unknown>): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...row };
    if (Array.isArray(row.tag)) copy.tag = [...row.tag];
    if (Array.isArray(row.knowledgeNodeIds)) copy.knowledgeNodeIds = [...row.knowledgeNodeIds];
    if (isRecord(row.managedAuthoring)) {
        const managed: Record<string, unknown> = { ...row.managedAuthoring };
        if (Array.isArray(managed.selectedMindmapNodeIds)) managed.selectedMindmapNodeIds = [...managed.selectedMindmapNodeIds];
        copy.managedAuthoring = managed;
    }
    if (isRecord(row.schoolBank)) copy.schoolBank = { ...row.schoolBank };
    if (isRecord(row.config)) {
        const config: Record<string, unknown> = { ...row.config };
        if (isRecord(config.main)) config.main = { ...config.main };
        copy.config = config;
    }
    return copy;
}

function compareValues(left: unknown, right: unknown, direction: number): number {
    if (Object.is(left, right)) return 0;
    if (left === undefined || left === null) return -direction;
    if (right === undefined || right === null) return direction;
    if (typeof left === 'number' && typeof right === 'number') {
        if (left === right) return 0;
        return left < right ? -direction : direction;
    }
    const textLeft = String(left);
    const textRight = String(right);
    if (textLeft === textRight) return 0;
    return textLeft < textRight ? -direction : direction;
}

function compareRows(left: Record<string, unknown>, right: Record<string, unknown>, spec: Record<string, unknown>): number {
    for (const [key, rawDirection] of Object.entries(spec)) {
        const direction = rawDirection === -1 ? -1 : 1;
        const compared = compareValues(readPath(left, key).value, readPath(right, key).value, direction);
        if (compared !== 0) return compared;
    }
    return 0;
}

function cursor(rows: Record<string, unknown>[], read: ProblemRead) {
    let skipped = 0;
    let limited: number | null = null;
    let sortSpec: Record<string, unknown> | null = null;
    const api = {
        project(projection: unknown) {
            read.projections.push(projection);
            return api;
        },
        sort(spec: unknown) {
            if (isRecord(spec)) sortSpec = spec;
            return api;
        },
        skip(count: number) {
            skipped = count;
            return api;
        },
        limit(count: number) {
            limited = count;
            return api;
        },
        hint() {
            return api;
        },
        count() {
            return Promise.resolve(rows.length);
        },
        async toArray() {
            const sorted = rows.map((row) => cloneRow(row));
            if (sortSpec) sorted.sort((left, right) => compareRows(left, right, sortSpec as Record<string, unknown>));
            const end = limited === null ? sorted.length : skipped + limited;
            return sorted.slice(skipped, end);
        },
        async next() {
            const page = await api.toArray();
            return page[0] ?? null;
        },
        async *[Symbol.asyncIterator]() {
            const page = await api.toArray();
            for (const row of page) yield row;
        },
    };
    return api;
}

function selectProblems(domainId: string, query: unknown, extra: Record<string, unknown> = {}): Record<string, unknown>[] {
    const filter = { ...extra, ...asQuery(query) };
    return problems.filter((row) => row.domainId === domainId && matches(row, filter));
}

function beginRead(op: string, domainId: string, query: unknown, projection?: unknown): ProblemRead {
    const read: ProblemRead = {
        op,
        domainId,
        projections: projection === undefined ? [] : [projection],
        query,
    };
    problemReads.push(read);
    return read;
}

function stubGet(domainId: string, pid: string | number, projection?: unknown): Promise<Record<string, unknown> | null> {
    beginRead('get', String(domainId), { pid }, projection);
    const numeric = typeof pid === 'number' ? pid : /^\d+$/.test(String(pid)) ? Number(pid) : null;
    const found = problems.find((row) => {
        if (row.domainId !== String(domainId)) return false;
        if (numeric !== null && row.docId === numeric) return true;
        return row.pid === pid;
    });
    return Promise.resolve(found ? cloneRow(found) : null);
}

function stubGetMulti(domainId: string, query: unknown, projection?: unknown) {
    const read = beginRead('getMulti', String(domainId), query, projection);
    return cursor(selectProblems(String(domainId), query), read);
}

function stubCount(domainId: string, query: unknown): Promise<number> {
    beginRead('count', String(domainId), query);
    return Promise.resolve(selectProblems(String(domainId), query).length);
}

function stubDocGet(domainId: string, docType: number, docId: unknown, projection?: unknown): Promise<Record<string, unknown> | null> {
    beginRead('document.get', String(domainId), { docType, docId }, projection);
    const found = problems.find((row) => row.domainId === String(domainId) && row.docType === docType && row.docId === docId);
    return Promise.resolve(found ? cloneRow(found) : null);
}

function stubDocGetMulti(domainId: string, docType: number, query: unknown, projection?: unknown) {
    const read = beginRead('document.getMulti', String(domainId), query, projection);
    return cursor(selectProblems(String(domainId), query, { docType }), read);
}

function stubDocCount(domainId: string, docType: number, query: unknown): Promise<number> {
    beginRead('document.count', String(domainId), query);
    return Promise.resolve(selectProblems(String(domainId), query, { docType }).length);
}

function stubFind(filter: unknown) {
    const query = asQuery(filter);
    const domainId = typeof query.domainId === 'string' ? query.domainId : '';
    const read = beginRead('coll.find', domainId, query);
    return cursor(problems.filter((row) => matches(row, query)), read);
}

function stubCountDocuments(filter: unknown): Promise<number> {
    const query = asQuery(filter);
    const domainId = typeof query.domainId === 'string' ? query.domainId : '';
    beginRead('coll.countDocuments', domainId, query);
    return Promise.resolve(problems.filter((row) => matches(row, query)).length);
}

async function stubGetList(domainId: string, uids: readonly number[]): Promise<Record<number, { _id: number; uname: string }>> {
    userReads.push({ domainId: String(domainId), uids: [...uids] });
    const result: Record<number, { _id: number; uname: string }> = {};
    for (const uid of uids) result[uid] = { _id: uid, uname: names.get(uid) ?? '' };
    return result;
}

function overlay(real: object, extra: Record<string, unknown>): object {
    return new Proxy(real, {
        get(target, prop, receiver) {
            if (typeof prop === 'string' && Object.hasOwn(extra, prop)) return extra[prop];
            return Reflect.get(target, prop, receiver);
        },
    });
}

function installStub(relativePath: string, exportsValue: object): void {
    const resolved = requireFromTest.resolve(relativePath);
    replaced.push({ resolved, previous: requireFromTest.cache[resolved] });
    requireFromTest.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports: exportsValue,
        children: [],
        paths: [],
    } as NodeModule;
}

const documentProxy = {
    __esModule: true,
    TYPE_PROBLEM,
    TYPE_CONTEST: 30,
    TYPE_TRAINING: 40,
    get: stubDocGet,
    getMulti: stubDocGetMulti,
    count: stubDocCount,
    coll: { find: stubFind, countDocuments: stubCountDocuments },
};
installStub('../src/model/document.ts', documentProxy);
hydroModel.permits = {
    async loadAclForUser() {
        return {
            permitPids: new Set<number>(),
            authoredPids: new Set<number>(),
            maintainedPids: new Set<number>(),
            dataContributionPids: new Set<number>(),
            tagContributionPids: new Set<number>(),
            fencedPids: new Set<number>(),
            ownsLegacyProblems: false,
        };
    },
};
hydroModel.pidNamespaces = {
    async loadAclForUser() {
        return {
            authorNamespaceIds: new Set<string>(),
            managerNamespaceIds: new Set<string>(),
            editAllNamespaceIds: new Set<string>(),
        };
    },
};
type ModuleLoad = (this: unknown, request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;

const managedAuthoringStub = {
    async materializeKnowledgeMindmapTags() {
        return { mapId: '', nodeIds: [], tags: [] };
    },
    async canonicalizeManagedDraftMindmapPatch() {
        return null;
    },
};
const pidNamespaceStub = {
    async loadPidNamespaceAclForUser() {
        return {
            authorNamespaceIds: new Set<string>(),
            managerNamespaceIds: new Set<string>(),
            editAllNamespaceIds: new Set<string>(),
        };
    },
    pidNamespaceCapabilityForProblem() {
        return null;
    },
    async withPidNamespaceBoundary(_domainId: string, _namespaceId: string, work: () => Promise<unknown>) {
        return work();
    },
};
const moduleNamespace = requireFromTest('module') as { _load: ModuleLoad };
const originalLoad = moduleNamespace._load;
moduleNamespace._load = function load(this: unknown, request: string, parent: NodeModule | null | undefined, isMain: boolean) {
    if (request === './managed-problem-authoring' || request === './managed-problem-authoring.ts') return managedAuthoringStub;
    if (request === './problem-pid-namespace' || request === './problem-pid-namespace.ts') return pidNamespaceStub;
    if (parent?.filename && (request.startsWith('.') || request.includes('/model/'))) {
        try {
            const resolved = createRequire(parent.filename).resolve(request);
            const stub = stubForResolved(resolved);
            if (stub) return stub;
        } catch {
            // Fall through when the request is not one of the bank models.
        }
    }
    return originalLoad.call(this, request, parent, isMain);
};
access = moduleExports(requireFromTest('../src/model/problem-access.ts')) as unknown as AccessModule;

class ProblemModel {
    static get = stubGet;

    static getMulti = stubGetMulti;

    static count = stubCount;

    static refreshProblemAcl = stubRefresh;

    static assertProblemAclDomain(user: TeachActor, domainId: string) {
        return stubAssert(access.assertProblemAclDomain, user, domainId);
    }

    static canBrowseProblemBank(user: TeachActor) {
        return access.canBrowseProblemBank(user);
    }
}

class UserModel {
    static getList = stubGetList;
}

const problemModule = { __esModule: true, default: ProblemModel, ProblemModel };
const userModule = { __esModule: true, default: UserModel, UserModel };
const accessModule = overlay(access as unknown as object, {
    refreshProblemAcl: stubRefresh,
    assertProblemAclDomain: (user: TeachActor, domainId: string) => stubAssert(access.assertProblemAclDomain, user, domainId),
});
installStub('../src/model/problem-access.ts', accessModule);
installStub('../src/model/problem.ts', problemModule);
installStub('../src/model/user.ts', userModule);
hydroModel.problem = ProblemModel;
hydroModel.document = documentProxy;
hydroModel.user = UserModel;

function stubForResolved(resolved: string): object | null {
    if (resolved.endsWith('/model/problem-access.ts')) return accessModule;
    if (resolved.endsWith('/model/problem.ts')) return problemModule;
    if (resolved.endsWith('/model/document.ts')) return documentProxy;
    if (resolved.endsWith('/model/user.ts')) return userModule;
    return null;
}

after(() => {
    moduleNamespace._load = originalLoad;
    for (const item of replaced) {
        if (item.previous) requireFromTest.cache[item.resolved] = item.previous;
        else delete requireFromTest.cache[item.resolved];
    }
});

function cloneSources(): Source[] {
    return sources.map((course) => ({
        ...course,
        nodes: course.nodes.map((knowledgeNode) => ({ ...knowledgeNode, pinnedDocIds: [...knowledgeNode.pinnedDocIds] })),
    }));
}

beforeEach(() => {
    problems.length = 0;
    sources.length = 0;
    problemReads.length = 0;
    aclCalls.length = 0;
    userReads.length = 0;
    mindmapModel.listTeachKnowledgeSources = () => Promise.resolve(cloneSources());
});

function actor(uid: number, perms: readonly bigint[], privs: readonly number[]): TeachActor {
    const permSet = new Set<bigint>(perms);
    const privSet = new Set<number>(privs);
    return {
        _id: uid,
        uname: names.get(uid) ?? '',
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => permSet.has(perm)),
        hasPriv: (...wanted: number[]) => wanted.some((priv) => privSet.has(priv)),
        own: (doc, exact) => (exact === true ? doc.owner === uid : doc.owner === uid || (doc.maintainer || []).includes(uid)),
    };
}

function teacher(): TeachActor {
    return actor(TEACHER, [PERM.PERM_VIEW, PERM.PERM_CREATE_PROBLEM, PERM.PERM_VIEW_PROBLEM_BANK], [PRIV.PRIV_USER_PROFILE]);
}

function admin(): TeachActor {
    return actor(ADMIN, [PERM.PERM_VIEW], [PRIV.PRIV_USER_PROFILE, PRIV.PRIV_EDIT_SYSTEM]);
}

function student(): TeachActor {
    return actor(STUDENT, [PERM.PERM_VIEW, PERM.PERM_VIEW_PROBLEM], [PRIV.PRIV_USER_PROFILE]);
}

function viewer(): TeachActor {
    return actor(VIEWER, [PERM.PERM_VIEW, PERM.PERM_VIEW_PROBLEM_BANK], [PRIV.PRIV_USER_PROFILE]);
}

function guest(): TeachActor {
    return actor(0, [], []);
}

function problem(docId: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        domainId: DOMAIN,
        docType: TYPE_PROBLEM,
        docId,
        pid: `P${docId}`,
        title: `题目${docId}`,
        owner: TEACHER,
        tag: ['algo'],
        nSubmit: 4,
        nAccept: 2,
        hidden: false,
        difficulty: 1,
        problemKind: 'programming',
        content: `题面${docId}`,
        ...extra,
    };
}

function share(owner = OTHER): Record<string, unknown> {
    return { sharedBy: owner, sharedAt: new Date('2026-10-16T00:00:00.000Z') };
}

function omit(row: Record<string, unknown>, key: string): Record<string, unknown> {
    const copy = { ...row };
    delete copy[key];
    return copy;
}

function source(id: string, title: string, nodes: SourceNode[], hidden = false): Source {
    return {
        courseId: id,
        title,
        hidden,
        mapId: id,
        rootNodeId: new ObjectId().toHexString(),
        nodes,
    };
}

function node(id: string, title: string, order: number, parentId: string | null, pinnedDocIds: number[] = []): SourceNode {
    return { id, parentId, title, order, pinnedDocIds };
}

async function loadRoutes(): Promise<Route[]> {
    if (cachedRoutes) return cachedRoutes;
    const loaded: unknown = requireFromTest('../src/handler/teach-bank.ts');
    if (!isRecord(loaded) || typeof loaded.apply !== 'function') throw new TypeError('teach export missing: apply');
    const found: Route[] = [];
    const ctx = {
        Route(name: string, routePath: string, Handler: HandlerConstructor) {
            found.push({ name, path: routePath, Handler });
        },
        inject(_deps: unknown, callback: (context: object) => unknown) {
            return callback(ctx);
        },
    };
    await loaded.apply(ctx);
    const expected = new Map([
        ['teach_knowledge_tree', '/teach-api/knowledge-tree'],
        ['teach_bank', '/teach-api/bank'],
        ['teach_bank_preview', '/teach-api/bank/:docId'],
    ]);
    for (const [name, routePath] of expected) {
        const route = found.find((item) => item.name === name);
        if (!route) throw new TypeError(`teach export missing: ${name}`);
        expect(route.path).to.equal(routePath);
    }
    cachedRoutes = found;
    return found;
}

function createHandler(HandlerClass: HandlerConstructor, query: Record<string, unknown>, params: Record<string, unknown>): TeachHandler {
    const request = {
        method: 'get',
        host: 'localhost',
        headers: {},
        query,
        params,
        body: {},
        path: '/teach-api/bank',
        json: null,
    };
    const response: { body?: unknown; template?: string | null } = {};
    const context = {
        session: {},
        holdFiles: [],
        HydroContext: {
            args: { domainId: FORGED },
            request,
            response,
            UiContext: {},
            domain: { _id: DOMAIN },
        },
    };
    const handler = new HandlerClass(context, {});
    handler.domain = { _id: DOMAIN };
    handler.request = request;
    handler.response = response;
    handler.args = { domainId: FORGED };
    return handler;
}

async function invoke(routeName: string, user: TeachActor, query: Record<string, unknown>, params: Record<string, unknown> = {}): Promise<unknown> {
    const routes = await loadRoutes();
    const route = routes.find((item) => item.name === routeName);
    if (!route) throw new TypeError(`teach export missing: ${routeName}`);
    problemReads.length = 0;
    aclCalls.length = 0;
    userReads.length = 0;
    const payload: Record<string, unknown> = { domainId: FORGED, ...params, ...query };
    const handler = createHandler(route.Handler, { ...query, ...params }, { ...params });
    handler.user = user;
    handler.checkPerm = (...perms: bigint[]) => {
        if (!user.hasPerm(...perms)) throw new PermissionError(...perms);
    };
    handler.checkPriv = (...privs: number[]) => {
        if (!user.hasPriv(...privs)) throw new PrivilegeError(...privs);
    };
    if (typeof handler.init === 'function') await handler.init();
    if (typeof handler.prepare === 'function') await handler.prepare(payload);
    if (typeof handler.get !== 'function') throw new TypeError('teach export missing: get');
    const returned = await handler.get(payload);
    return handler.response.body !== undefined ? handler.response.body : returned;
}

async function rejectionOf(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run();
    } catch (error) {
        if (isRecord(error) && error.code === 'MODULE_NOT_FOUND') throw error;
        return error;
    }
    throw new Error('expected the call to reject');
}

function errorName(error: unknown): string {
    return error instanceof Error ? error.name : '';
}

function projectionIncludes(projection: unknown, field: string): boolean {
    if (Array.isArray(projection)) {
        return projection.includes(field) || projection.includes(field.split('.')[0]);
    }
    if (!isRecord(projection)) return false;
    if (projection[field] === 1 || projection[field] === true) return true;
    let current: unknown = projection;
    for (const part of field.split('.')) {
        if (current === 1 || current === true) return true;
        if (!isRecord(current) || !Object.hasOwn(current, part)) return false;
        current = current[part];
    }
    return current === 1 || current === true;
}

function expectTreeQuery(): void {
    expect(problemReads.length).to.equal(1);
    expect(problemReads[0].domainId).to.equal(DOMAIN);
    const projections = problemReads[0].projections;
    for (const field of TREE_FIELDS) {
        expect(projections.some((projection) => projectionIncludes(projection, field))).to.equal(true);
    }
}

function expectAcl(user: TeachActor): void {
    expect(aclCalls.some((call) => call.fn === 'refresh' && call.domainId === DOMAIN && call.uid === user._id)).to.equal(true);
    expect(aclCalls.some((call) => call.fn === 'assert' && call.domainId === DOMAIN && call.uid === user._id)).to.equal(true);
    expect(aclCalls.some((call) => call.domainId === FORGED)).to.equal(false);
    expect(problemReads.some((read) => read.domainId === FORGED)).to.equal(false);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNullableNumber(value: unknown): value is number | null {
    return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function readItem(value: unknown): Item {
    expect(isRecord(value)).to.equal(true);
    if (!isRecord(value)) throw new TypeError('bank item');
    expect(Object.keys(value).sort()).to.deep.equal(ITEM_KEYS);
    expect(typeof value.docId).to.equal('number');
    expect(typeof value.pid).to.equal('string');
    expect(typeof value.title).to.equal('string');
    expect(typeof value.kind).to.equal('string');
    expect(isNullableNumber(value.difficulty)).to.equal(true);
    expect(isStringArray(value.tags)).to.equal(true);
    expect(typeof value.nSubmit).to.equal('number');
    expect(typeof value.nAccept).to.equal('number');
    expect(typeof value.hidden).to.equal('boolean');
    expect(typeof value.mine).to.equal('boolean');
    expect(typeof value.schoolShared).to.equal('boolean');
    expect(typeof value.ownerName).to.equal('string');
    expect(value.courseId === null || typeof value.courseId === 'string').to.equal(true);
    expect(isStringArray(value.nodePath)).to.equal(true);
    if (
        typeof value.docId !== 'number'
        || typeof value.pid !== 'string'
        || typeof value.title !== 'string'
        || typeof value.kind !== 'string'
        || !isNullableNumber(value.difficulty)
        || !isStringArray(value.tags)
        || typeof value.nSubmit !== 'number'
        || typeof value.nAccept !== 'number'
        || typeof value.hidden !== 'boolean'
        || typeof value.mine !== 'boolean'
        || typeof value.schoolShared !== 'boolean'
        || typeof value.ownerName !== 'string'
        || (value.courseId !== null && typeof value.courseId !== 'string')
        || !isStringArray(value.nodePath)
    ) throw new TypeError('bank item');
    let courseId: string | null;
    if (typeof value.courseId === 'string') courseId = value.courseId;
    else if (value.courseId === null) courseId = null;
    else throw new TypeError('bank item');
    return {
        docId: value.docId,
        pid: value.pid,
        title: value.title,
        kind: value.kind,
        difficulty: value.difficulty,
        tags: value.tags,
        nSubmit: value.nSubmit,
        nAccept: value.nAccept,
        hidden: value.hidden,
        mine: value.mine,
        schoolShared: value.schoolShared,
        ownerName: value.ownerName,
        courseId,
        nodePath: value.nodePath,
    };
}

function readPage(value: unknown): Page {
    expect(isRecord(value)).to.equal(true);
    if (!isRecord(value)) throw new TypeError('bank page');
    expect(Object.keys(value).sort()).to.deep.equal(['items', 'page', 'pageCount', 'total']);
    expect(Array.isArray(value.items)).to.equal(true);
    expect(typeof value.page).to.equal('number');
    expect(typeof value.pageCount).to.equal('number');
    expect(typeof value.total).to.equal('number');
    if (!Array.isArray(value.items) || typeof value.page !== 'number' || typeof value.pageCount !== 'number' || typeof value.total !== 'number') {
        throw new TypeError('bank page');
    }
    const items = value.items.map((item) => readItem(item));
    expect(items.length <= PAGE_SIZE).to.equal(true);
    if (value.total > 0) expect(value.pageCount).to.equal(Math.ceil(value.total / PAGE_SIZE));
    for (let index = 1; index < items.length; index += 1) {
        expect(items[index - 1].docId > items[index].docId).to.equal(true);
    }
    return { items, page: value.page, pageCount: value.pageCount, total: value.total };
}

function readNode(value: unknown): NodeView {
    expect(isRecord(value)).to.equal(true);
    if (!isRecord(value)) throw new TypeError('knowledge node');
    expect(Object.keys(value).sort()).to.deep.equal(['children', 'count', 'id', 'title']);
    expect(typeof value.id).to.equal('string');
    expect(typeof value.title).to.equal('string');
    expect(typeof value.count).to.equal('number');
    expect(Array.isArray(value.children)).to.equal(true);
    if (typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.count !== 'number' || !Array.isArray(value.children)) {
        throw new TypeError('knowledge node');
    }
    return {
        id: value.id,
        title: value.title,
        count: value.count,
        children: value.children.map((child) => readNode(child)),
    };
}

function readTree(value: unknown): CourseView[] {
    expect(isRecord(value)).to.equal(true);
    if (!isRecord(value)) throw new TypeError('knowledge tree');
    expect(Object.keys(value).sort()).to.deep.equal(['courses']);
    expect(Array.isArray(value.courses)).to.equal(true);
    if (!Array.isArray(value.courses)) throw new TypeError('knowledge tree');
    return value.courses.map((course) => {
        expect(isRecord(course)).to.equal(true);
        if (!isRecord(course)) throw new TypeError('knowledge course');
        expect(Object.keys(course).sort()).to.deep.equal(['hidden', 'id', 'nodes', 'title', 'total']);
        expect(typeof course.id).to.equal('string');
        expect(typeof course.title).to.equal('string');
        expect(typeof course.hidden).to.equal('boolean');
        expect(typeof course.total).to.equal('number');
        expect(Array.isArray(course.nodes)).to.equal(true);
        if (
            typeof course.id !== 'string'
            || typeof course.title !== 'string'
            || typeof course.hidden !== 'boolean'
            || typeof course.total !== 'number'
            || !Array.isArray(course.nodes)
        ) throw new TypeError('knowledge course');
        return {
            id: course.id,
            title: course.title,
            hidden: course.hidden,
            total: course.total,
            nodes: course.nodes.map((item) => readNode(item)),
        };
    });
}

function readPreview(value: unknown): Preview {
    expect(isRecord(value)).to.equal(true);
    if (!isRecord(value)) throw new TypeError('bank preview');
    expect(Object.keys(value).sort()).to.deep.equal(['content', 'item', 'limits', 'objective']);
    expect(typeof value.content).to.equal('string');
    expect(isRecord(value.limits)).to.equal(true);
    if (!isRecord(value.limits) || typeof value.content !== 'string') throw new TypeError('bank preview');
    expect(Object.keys(value.limits).sort()).to.deep.equal(['memoryMb', 'timeMs']);
    expect(isNullableNumber(value.limits.timeMs)).to.equal(true);
    expect(isNullableNumber(value.limits.memoryMb)).to.equal(true);
    if (!isNullableNumber(value.limits.timeMs) || !isNullableNumber(value.limits.memoryMb)) throw new TypeError('bank preview');
    return {
        item: readItem(value.item),
        content: value.content,
        objective: value.objective,
        limits: { timeMs: value.limits.timeMs, memoryMb: value.limits.memoryMb },
    };
}

function docIds(page: Page): number[] {
    return page.items.map((item) => item.docId);
}

function expectOwners(uids: readonly number[]): void {
    expect(userReads.length).to.equal(1);
    expect(userReads[0].domainId).to.equal(DOMAIN);
    for (const uid of uids) expect(userReads[0].uids.includes(uid)).to.equal(true);
}

async function bank(user: TeachActor, query: Record<string, unknown>): Promise<Page> {
    const page = readPage(await invoke('teach_bank', user, query));
    expectAcl(user);
    return page;
}

async function tree(user: TeachActor, type: string, checkQuery = true): Promise<CourseView[]> {
    const courses = readTree(await invoke('teach_knowledge_tree', user, { type }));
    expectAcl(user);
    if (checkQuery) expectTreeQuery();
    return courses;
}

async function preview(user: TeachActor, docId: number, type: string): Promise<Preview> {
    const body = readPreview(await invoke('teach_bank_preview', user, { type }, { docId: String(docId) }));
    expectAcl(user);
    return body;
}

describe('teach bank', () => {
    it('matches container selection scope membership', async () => {
        const scopeUser = teacher();
        await access.refreshProblemAcl(scopeUser, DOMAIN);
        const scope = access.buildProblemContainerSelectionScope(scopeUser);
        expect(matches(problem(1, { hidden: true }), scope)).to.equal(true);
        expect(matches(problem(2, { owner: OTHER, hidden: false }), scope)).to.equal(true);
        expect(matches(problem(3, { owner: OTHER, hidden: true, schoolBank: share() }), scope)).to.equal(true);
        expect(matches(problem(4, { owner: OTHER, hidden: true }), scope)).to.equal(false);
        expect(matches(problem(5, { hidden: true, authoringMode: 'managed' }), scope)).to.equal(false);
        expect(matches(problem(6, { aclMutationLocks: { uid: TEACHER } }), scope)).to.equal(false);
    });

    it('registers knowledge tree, bank, and preview routes', async () => {
        const routes = await loadRoutes();
        expect(routes.map((route) => route.name).sort()).to.deep.equal(['teach_bank', 'teach_bank_preview', 'teach_knowledge_tree']);
    });

    it('rejects a student, a bank viewer, and a guest on every route', async () => {
        const calls: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
            ['teach_knowledge_tree', { type: 'exam' }, {}],
            ['teach_bank', { type: 'exam' }, {}],
            ['teach_bank_preview', { type: 'exam' }, { docId: '1' }],
        ];
        for (const user of [student(), viewer()]) {
            for (const [routeName, query, params] of calls) {
                const error = await rejectionOf(() => invoke(routeName, user, query, params));
                expect(errorName(error)).to.equal('PermissionError');
            }
        }
        for (const [routeName, query, params] of calls) {
            const error = await rejectionOf(() => invoke(routeName, guest(), query, params));
            expect(errorName(error) === 'PermissionError' || errorName(error) === 'PrivilegeError').to.equal(true);
        }
    });

    it('allows a problem creator and a system admin to read an empty bank', async () => {
        for (const user of [teacher(), admin()]) {
            const courses = await tree(user, 'exam', false);
            expect(courses).to.deep.equal([]);
            const page = await bank(user, { type: 'homework' });
            expect(page.total).to.equal(0);
            expect(page.page).to.equal(1);
            expect(page.items).to.deep.equal([]);
        }
    });

    it('omits single and archived problems from an acm tree and list', async () => {
        const mapId = new ObjectId('66b900000000000000000010').toHexString();
        const nodeId = new ObjectId('66b900000000000000000011').toHexString();
        sources.push(source(mapId, '算法', [node(nodeId, '动态规划', 1, null, [5])]));
        const attached = { knowledgeMapId: new ObjectId(mapId), knowledgeNodeIds: [new ObjectId(nodeId)] };
        problems.push(
            problem(1, attached),
            omit(problem(2, attached), 'problemKind'),
            problem(3, { ...attached, problemKind: 'program_fill' }),
            problem(4, { ...attached, problemKind: 'single' }),
            problem(5, { ...attached, archivedAt: new Date('2026-10-01T00:00:00.000Z') }),
        );
        const acm = await tree(teacher(), 'acm');
        expect(acm.length).to.equal(1);
        expect(acm[0].total).to.equal(3);
        expect(acm[0].nodes[0].count).to.equal(3);
        const acmPage = await bank(teacher(), { type: 'acm' });
        expect(docIds(acmPage)).to.deep.equal([3, 2, 1]);
        expect(acmPage.items.map((item) => item.kind)).to.deep.equal(['program_fill', 'programming', 'programming']);
        const exam = await tree(teacher(), 'exam');
        expect(exam[0].total).to.equal(4);
        expect(docIds(await bank(teacher(), { type: 'exam' }))).to.deep.equal([4, 3, 2, 1]);
        const hiddenSingle = await rejectionOf(() => preview(teacher(), 4, 'acm'));
        expect(hiddenSingle instanceof NotFoundError).to.equal(true);
        const visibleSingle = await preview(teacher(), 4, 'exam');
        expect(visibleSingle.item.kind).to.equal('single');
    });

    it('counts a node, its descendants, and its pins once', async () => {
        // Node ids belong only when knowledgeMapId matches this source.
        const mapId = new ObjectId('66b900000000000000000020');
        const otherMap = new ObjectId('66b900000000000000000021');
        const secondRoot = new ObjectId('66b900000000000000000023');
        const nodeA = new ObjectId('66b90000000000000000002a');
        const nodeB = new ObjectId('66b90000000000000000002b');
        const nodeC = new ObjectId('66b90000000000000000002c');
        sources.push({
            courseId: mapId.toHexString(),
            title: '算法',
            hidden: false,
            mapId: mapId.toHexString(),
            rootNodeId: new ObjectId('66b900000000000000000022').toHexString(),
            nodes: [
                node(nodeA.toHexString(), '树', 1, null, [3, 98]),
                node(nodeB.toHexString(), '二叉树', 1, nodeA.toHexString(), [1]),
            ],
        });
        sources.push({
            courseId: otherMap.toHexString(),
            title: '空课',
            hidden: true,
            mapId: otherMap.toHexString(),
            rootNodeId: secondRoot.toHexString(),
            nodes: [node(nodeC.toHexString(), '未挂题', 1, null)],
        });
        problems.push(
            problem(1, { knowledgeMapId: mapId, knowledgeNodeIds: [nodeB] }),
            problem(2, { knowledgeMapId: mapId, managedAuthoring: { selectedMindmapNodeIds: [nodeA] } }),
            problem(3, { knowledgeMapId: mapId }),
            problem(4, { knowledgeMapId: otherMap, knowledgeNodeIds: [secondRoot] }),
            problem(98, { knowledgeMapId: mapId, archivedAt: new Date('2026-10-02T00:00:00.000Z') }),
            problem(99, { knowledgeMapId: otherMap, knowledgeNodeIds: [nodeA] }),
        );
        const courses = await tree(teacher(), 'exam');
        expect(courses.map((course) => course.title)).to.deep.equal(['算法', '空课']);
        expect(courses[0].id).to.equal(mapId.toHexString());
        expect(courses[0].hidden).to.equal(false);
        expect(courses[0].total).to.equal(3);
        expect(courses[0].nodes.length).to.equal(1);
        expect(courses[0].nodes[0].id).to.equal(nodeA.toHexString());
        expect(courses[0].nodes[0].count).to.equal(3);
        expect(courses[0].nodes[0].children.map((child) => [child.id, child.count, child.children.length])).to.deep.equal([
            [nodeB.toHexString(), 1, 0],
        ]);
        expect(courses[1].hidden).to.equal(true);
        expect(courses[1].total).to.equal(1);
        expect(courses[1].nodes[0].count).to.equal(0);
        const underA = await bank(teacher(), { type: 'exam', course: mapId.toHexString(), node: nodeA.toHexString() });
        expect(docIds(underA)).to.deep.equal([3, 2, 1]);
        const underB = await bank(teacher(), { type: 'exam', course: mapId.toHexString(), node: nodeB.toHexString() });
        expect(docIds(underB)).to.deep.equal([1]);
        const rootCourse = await bank(teacher(), { type: 'exam', course: otherMap.toHexString(), node: 'all' });
        expect(docIds(rootCourse)).to.deep.equal([4]);
        expect(rootCourse.items[0].courseId).to.equal(otherMap.toHexString());
        expect(rootCourse.items[0].nodePath).to.deep.equal([]);
        const all = await bank(teacher(), { type: 'exam', course: 'all', node: nodeB.toHexString() });
        expect(docIds(all).includes(99)).to.equal(true);
        const byId = new Map(all.items.map((item) => [item.docId, item]));
        expect(byId.get(1)?.nodePath).to.deep.equal(['树', '二叉树']);
        expect(byId.get(2)?.nodePath).to.deep.equal(['树']);
        expect(byId.get(3)?.nodePath).to.deep.equal(['树']);
        expect(byId.get(99)?.courseId).to.equal(null);
        expect(byId.get(99)?.nodePath).to.deep.equal([]);
    });

    it('counts a pinned problem that has no knowledge map', async () => {
        const mapId = new ObjectId('66b900000000000000000040');
        const parentId = new ObjectId('66b900000000000000000041');
        const nodeA = new ObjectId('66b900000000000000000042');
        sources.push({
            courseId: mapId.toHexString(),
            title: '钉选课',
            hidden: false,
            mapId: mapId.toHexString(),
            rootNodeId: new ObjectId('66b900000000000000000043').toHexString(),
            nodes: [
                node(parentId.toHexString(), '章', 0, null),
                node(nodeA.toHexString(), '节', 0, parentId.toHexString(), [7]),
            ],
        });
        problems.push(problem(7, { title: '只被收录' }));
        const courses = await tree(teacher(), 'exam');
        expect(courses.length).to.equal(1);
        expect(courses[0].total).to.equal(1);
        expect(courses[0].nodes.map((item) => [item.id, item.count])).to.deep.equal([[parentId.toHexString(), 1]]);
        expect(courses[0].nodes[0].children.map((item) => [item.id, item.count, item.children.length])).to.deep.equal([
            [nodeA.toHexString(), 1, 0],
        ]);
        const underA = await bank(teacher(), { type: 'exam', course: mapId.toHexString(), node: nodeA.toHexString() });
        expect(underA.total).to.equal(1);
        expect(docIds(underA)).to.deep.equal([7]);
        expect(underA.items[0].courseId).to.equal(mapId.toHexString());
        expect(underA.items[0].nodePath).to.deep.equal(['章', '节']);
        const underParent = await bank(teacher(), { type: 'exam', course: mapId.toHexString(), node: parentId.toHexString() });
        expect(underParent.total).to.equal(1);
        expect(docIds(underParent)).to.deep.equal([7]);
        expect(underParent.items[0].nodePath).to.deep.equal(['章', '节']);
    });

    it('hides another teachers unshared problem until it is shared', async () => {
        const hidden = problem(11, {
            owner: OTHER,
            hidden: true,
            problemKind: 'single',
            title: '共享单选',
            content: '单选**题干**',
            tag: ['choice'],
            nSubmit: 8,
            nAccept: 3,
            difficulty: 2,
            config: { type: 'objective', main: { options: ['甲', '乙', '丙'], answerIndex: 1 } },
        });
        problems.push(hidden);
        const before = await bank(teacher(), { type: 'exam' });
        expect(docIds(before).includes(11)).to.equal(false);
        const missing = await rejectionOf(() => preview(teacher(), 11, 'exam'));
        expect(missing instanceof NotFoundError).to.equal(true);
        hidden.schoolBank = share();
        const sharedPage = await bank(teacher(), { type: 'exam' });
        expect(docIds(sharedPage)).to.deep.equal([11]);
        expect(sharedPage.items[0].mine).to.equal(false);
        expect(sharedPage.items[0].hidden).to.equal(true);
        expect(sharedPage.items[0].schoolShared).to.equal(true);
        expect(sharedPage.items[0].ownerName).to.equal('老师乙');
        expect(sharedPage.items[0].difficulty).to.equal(2);
        expectOwners([OTHER]);
        const body = await preview(teacher(), 11, 'homework');
        expect(body.content).to.equal('单选**题干**');
        expect(body.item.schoolShared).to.equal(true);
        expect(body.objective).to.deep.equal({ kind: 'single', options: ['甲', '乙', '丙'], answerIndex: 1 });
        expect(body.limits).to.deep.equal({ timeMs: null, memoryMb: null });
    });

    it('keeps school results to other people and mine results to the caller', async () => {
        problems.push(
            problem(1, { title: '自己的公开题' }),
            problem(2, { hidden: true, title: '自己的隐藏题' }),
            problem(3, { owner: OTHER, title: '别人的公开题' }),
            problem(4, { owner: OTHER, hidden: true, schoolBank: share(), title: '别人的共享题' }),
            problem(5, { owner: OTHER, hidden: true, title: '别人的未共享题' }),
        );
        expect(docIds(await bank(teacher(), { type: 'exam', source: 'school' }))).to.deep.equal([4, 3]);
        expect(docIds(await bank(teacher(), { type: 'exam', source: 'mine' }))).to.deep.equal([2, 1]);
        expect(docIds(await bank(teacher(), { type: 'exam', source: 'all' }))).to.deep.equal([4, 3, 2, 1]);
        const mine = await bank(teacher(), { type: 'exam', source: 'mine' });
        expect(mine.items.every((item) => item.mine)).to.equal(true);
        expectOwners([TEACHER]);
    });

    it('filters difficulty, text, kind, and excluded ids', async () => {
        problems.push(
            problem(5, { difficulty: 3, title: '动态规划' }),
            problem(6, { difficulty: 0, title: '普通题' }),
            problem(7, { difficulty: 3, title: 'Binary Search' }),
            omit(problem(8, { title: '未标难度' }), 'difficulty'),
            problem(9, { difficulty: 4, title: 'a.b 题' }),
            problem(10, { title: 'axb 题', tag: ['raretag'], problemKind: 'single' }),
            problem(15, { title: '另一道题', problemKind: 'program_fill' }),
        );
        expect(docIds(await bank(teacher(), { type: 'exam', difficulty: '3' }))).to.deep.equal([7, 5]);
        expect(docIds(await bank(teacher(), { type: 'exam', difficulty: '0' }))).to.deep.equal([8, 6]);
        expect(docIds(await bank(teacher(), { type: 'acm', exclude: '5,6' }))).to.deep.equal([15, 9, 8, 7]);
        expect(docIds(await bank(teacher(), { type: 'exam', difficulty: '3', exclude: '5' }))).to.deep.equal([7]);
        expect(docIds(await bank(teacher(), { type: 'exam', q: '规划' }))).to.deep.equal([5]);
        expect(docIds(await bank(teacher(), { type: 'exam', q: 'binary' }))).to.deep.equal([7]);
        expect(docIds(await bank(teacher(), { type: 'exam', q: 'a.b' }))).to.deep.equal([9]);
        expect(docIds(await bank(teacher(), { type: 'exam', q: 'raretag' }))).to.deep.equal([10]);
        expect(docIds(await bank(teacher(), { type: 'exam', kind: 'single' }))).to.deep.equal([10]);
        expect(docIds(await bank(teacher(), { type: 'acm', kind: 'program_fill' }))).to.deep.equal([15]);
        const untouched = await bank(teacher(), { type: 'exam' });
        expect(untouched.page).to.equal(1);
        expect(untouched.total).to.equal(7);
    });

    it('rejects incompatible and illegal bank filters', async () => {
        const cases: Record<string, unknown>[] = [
            { type: 'acm', kind: 'multi' },
            { type: 'acm', kind: 'single' },
            { type: 'practice', kind: 'subjective' },
            { type: 'exam', source: 'classroom' },
            { type: 'exam', difficulty: '11' },
            { type: 'exam', difficulty: '-1' },
            { type: 'exam', page: '0' },
            { type: 'exam', kind: 'nope' },
            { type: 'exam', exclude: '5,x' },
            { type: 'exam', exclude: Array.from({ length: 501 }, (_item, index) => String(index + 1)).join(',') },
        ];
        for (const query of cases) {
            const error = await rejectionOf(() => invoke('teach_bank', teacher(), query));
            expect(error instanceof ValidationError).to.equal(true);
        }
        const fiveHundred = Array.from({ length: 500 }, (_item, index) => String(index + 1)).join(',');
        const accepted = await bank(teacher(), { type: 'exam', exclude: fiveHundred });
        expect(accepted.total).to.equal(0);
        for (const routeName of ['teach_knowledge_tree', 'teach_bank', 'teach_bank_preview']) {
            const params = routeName === 'teach_bank_preview' ? { docId: '1' } : {};
            const error = await rejectionOf(() => invoke(routeName, teacher(), { type: 'quiz' }, params));
            expect(error instanceof ValidationError).to.equal(true);
        }
    });

    it('pages thirty problems at a time by descending docId', async () => {
        for (let docId = 1; docId <= 31; docId += 1) problems.push(problem(docId, { nSubmit: docId, nAccept: 1 }));
        const first = await bank(teacher(), { type: 'oi' });
        expect(first.page).to.equal(1);
        expect(first.total).to.equal(31);
        expect(first.pageCount).to.equal(2);
        expect(docIds(first)).to.deep.equal(Array.from({ length: 30 }, (_item, index) => 31 - index));
        expect(first.items[0]).to.deep.equal({
            docId: 31,
            pid: 'P31',
            title: '题目31',
            kind: 'programming',
            difficulty: 1,
            tags: ['algo'],
            nSubmit: 31,
            nAccept: 1,
            hidden: false,
            mine: true,
            schoolShared: false,
            ownerName: '老师甲',
            courseId: null,
            nodePath: [],
        });
        expectOwners([TEACHER]);
        const second = await bank(teacher(), { type: 'oi', page: '2' });
        expect(second.page).to.equal(2);
        expect(docIds(second)).to.deep.equal([1]);
    });

    it('picks the first source and the first preorder node', async () => {
        const firstMap = new ObjectId('66b900000000000000000031').toHexString();
        const secondMap = new ObjectId('66b900000000000000000032').toHexString();
        const later = new ObjectId('66b900000000000000000033').toHexString();
        const earlier = new ObjectId('66b900000000000000000034').toHexString();
        const child = new ObjectId('66b900000000000000000035').toHexString();
        const otherNode = new ObjectId('66b900000000000000000036').toHexString();
        sources.push(source(firstMap, '课程乙', [
            node(later, '甲节点', 1, null),
            node(earlier, '乙节点', 0, null),
            node(child, '子节点', 0, earlier),
        ]));
        sources.push(source(secondMap, '课程甲', [node(otherNode, '图', 0, null)]));
        problems.push(
            problem(1, { knowledgeMapId: new ObjectId(firstMap), knowledgeNodeIds: [new ObjectId(later), new ObjectId(earlier)] }),
            problem(2, { knowledgeMapId: new ObjectId(firstMap), knowledgeNodeIds: [new ObjectId(child)] }),
            problem(3, { knowledgeMapId: new ObjectId(secondMap), knowledgeNodeIds: [new ObjectId(otherNode)] }),
        );
        const courses = await tree(teacher(), 'acm');
        expect(courses.map((course) => course.title)).to.deep.equal(['课程乙', '课程甲']);
        expect(courses[0].nodes.map((item) => item.title)).to.deep.equal(['乙节点', '甲节点']);
        expect(courses[0].nodes[0].children.map((item) => item.title)).to.deep.equal(['子节点']);
        const page = await bank(teacher(), { type: 'acm' });
        const byId = new Map(page.items.map((item) => [item.docId, item]));
        expect(byId.get(1)?.courseId).to.equal(firstMap);
        expect(byId.get(1)?.nodePath).to.deep.equal(['乙节点']);
        expect(byId.get(2)?.nodePath).to.deep.equal(['乙节点', '子节点']);
        expect(byId.get(3)?.courseId).to.equal(secondMap);
        expect(byId.get(3)?.nodePath).to.deep.equal(['图']);
    });

    it('returns objective answers and limits from the raw config', async () => {
        problems.push(
            problem(21, {
                problemKind: 'multi',
                content: '多选正文',
                config: { type: 'objective', main: { options: ['甲', '乙', '丙'], answerIndexes: [0, 2] } },
            }),
            problem(22, {
                problemKind: 'true_false',
                content: '判断正文',
                config: { type: 'objective', main: { answer: false } },
            }),
            problem(23, {
                problemKind: 'blank',
                content: '填空正文',
                config: { type: 'objective', main: { answer: '42' } },
            }),
            problem(24, {
                content: '编程正文',
                config: { time: '1s', memory: '256m' },
            }),
            problem(25, { problemKind: 'function', content: '函数正文' }),
        );
        const multi = await preview(teacher(), 21, 'exam');
        expect(multi.content).to.equal('多选正文');
        expect(multi.objective).to.deep.equal({ kind: 'multi', options: ['甲', '乙', '丙'], answerIndexes: [0, 2] });
        expect(multi.limits).to.deep.equal({ timeMs: null, memoryMb: null });
        const truth = await preview(teacher(), 22, 'practice');
        expect(truth.objective).to.deep.equal({ kind: 'true_false', answer: false });
        const blank = await preview(teacher(), 23, 'homework');
        expect(blank.objective).to.deep.equal({ kind: 'blank', answer: '42' });
        const programming = await preview(teacher(), 24, 'acm');
        expect(programming.objective).to.equal(null);
        expect(programming.limits.timeMs).to.equal(parseTimeMS('1s'));
        expect(programming.limits.memoryMb).to.equal(parseMemoryMB('256m'));
        const fn = await preview(teacher(), 25, 'oi');
        expect(fn.objective).to.equal(null);
        expect(fn.limits).to.deep.equal({ timeMs: null, memoryMb: null });
        const absent = await rejectionOf(() => preview(teacher(), 99, 'exam'));
        expect(absent instanceof NotFoundError).to.equal(true);
    });

    it('fails when the knowledge source provider is not registered', async () => {
        delete mindmapModel.listTeachKnowledgeSources;
        const error = await rejectionOf(() => invoke('teach_knowledge_tree', teacher(), { type: 'exam' }));
        expect(error instanceof TypeError).to.equal(true);
        expect(error instanceof Error ? error.message : '').to.equal(UNREGISTERED);
    });
});
