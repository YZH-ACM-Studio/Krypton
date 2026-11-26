import { createRequire } from 'node:module';
import { beforeEach, describe, it } from 'node:test';
import { expect } from 'chai';

// HTTP boundary for /mindmap mine and canEdit. Course bindings are ordinary
// document rows; the handler must query them, listCourseNodes does not.
const framework = require('../../../framework/framework');
const Module = require('module');
const requireFromFramework = createRequire(require.resolve('../../../framework/framework/package.json'));
const { ObjectId } = requireFromFramework('mongodb');

class PrivilegeError extends framework.ForbiddenError {
    name = 'PrivilegeError';
}

class PermissionError extends framework.ForbiddenError {
    name = 'PermissionError';
}

interface MindmapObjectId {
    equals(other: MindmapObjectId): boolean;
    toHexString(): string;
}

interface FixtureNode {
    _id: MindmapObjectId;
    mapId: MindmapObjectId;
    parentId: MindmapObjectId | null;
    topic: string;
    tags: string[];
    problemIds: string[];
    order: number;
    createdAt: Date;
    updatedAt: Date;
    courseVisibility?: 'public' | 'hidden';
    ownerUids?: number[];
}

interface FixtureMap {
    _id: MindmapObjectId;
    title: string;
    rootNodeId: MindmapObjectId;
    visibility: 'public';
    layoutDirection: 'RIGHT';
    createdAt: Date;
    updatedAt: Date;
}

interface CoursePayload {
    id: string;
    title: string;
    order: number;
    visibility: 'public' | 'hidden';
    ownerUids: number[];
    mine?: boolean;
    canEdit?: boolean;
}

interface StoredDocument {
    domainId: string;
    docType: number;
    kind?: string;
    owner: number;
    maintainer: number[];
    knowledgeCourseNodeId?: MindmapObjectId | string | null;
}

interface PublicBody {
    courses?: CoursePayload[];
    course?: string | null;
    nodes?: Array<{ topic?: string }>;
    template?: string;
}

interface Dispatched {
    body: PublicBody;
    status: number;
    template?: string;
    redirect?: string;
}

const TOPIC = {
    root: '知识图谱',
    courseA: '课程甲',
    courseB: '课程乙',
    courseC: '课程丙',
    childA: '甲知识点',
    childB: '乙知识点',
    childC: '丙知识点',
} as const;

const STAMP = new Date('2026-10-21T00:00:00.000Z');
const DOMAIN_ID = 'system';
const TEACHER_B = 7;
const TEACHER_MAINTAINER = 8;
const TEACHER_OWNER = 9;
const STUDENT_ID = 42;
const PRIV_EDIT_SYSTEM = 1;
const TYPE_TRAINING = 40;

let nodes: FixtureNode[] = [];
let documents: StoredDocument[] = [];
let mapId = new ObjectId() as MindmapObjectId;
let rootId = new ObjectId() as MindmapObjectId;
let courseA = new ObjectId() as MindmapObjectId;
let courseB = new ObjectId() as MindmapObjectId;
let courseC = new ObjectId() as MindmapObjectId;
let childA = new ObjectId() as MindmapObjectId;
let childB = new ObjectId() as MindmapObjectId;
let childC = new ObjectId() as MindmapObjectId;
let mapDoc: FixtureMap = {
    _id: mapId,
    title: TOPIC.root,
    rootNodeId: rootId,
    visibility: 'public',
    layoutDirection: 'RIGHT',
    createdAt: STAMP,
    updatedAt: STAMP,
};

class Logger {
    constructor(name: string) {
        this.info(name);
    }

    info(..._args: unknown[]) {}

    warn(..._args: unknown[]) {}

    error(..._args: unknown[]) {}
}

class FixtureUser {
    _id: number;

    priv: number;

    hasPerm: (permission?: number) => boolean;

    constructor(id: number, privilege: number, hasPerm: (permission?: number) => boolean) {
        this._id = id;
        this.priv = privilege;
        this.hasPerm = hasPerm;
    }

    hasPriv(priv: number) {
        return (this.priv & priv) === priv;
    }
}

function makeStudent() {
    return new FixtureUser(STUDENT_ID, 0, () => false);
}

function makeTeacher(uid: number) {
    return new FixtureUser(uid, 0, () => false);
}

function makeGuest() {
    return new FixtureUser(0, 0, () => false);
}

function makeAdmin() {
    return new FixtureUser(3, PRIV_EDIT_SYSTEM, () => false);
}

function nodeStamp(topic: string, parent: MindmapObjectId | null, order: number, extra: Partial<FixtureNode> = {}): FixtureNode {
    return {
        ...extra,
        _id: extra._id ?? (new ObjectId() as MindmapObjectId),
        mapId,
        parentId: parent,
        topic,
        tags: extra.tags ?? [],
        problemIds: extra.problemIds ?? [],
        order,
        createdAt: STAMP,
        updatedAt: STAMP,
    };
}

function courseViewOf(node: FixtureNode): CoursePayload {
    return {
        id: node._id.toHexString(),
        title: node.topic,
        order: node.order,
        visibility: node.courseVisibility === 'hidden' ? 'hidden' : 'public',
        ownerUids: [...(node.ownerUids ?? [])],
    };
}

function canEditCourseSubtree(actor: { _id?: number; hasPriv?: (priv: number) => boolean } | null, course: { ownerUids?: number[] }): boolean {
    if (!actor) return false;
    if (actor.hasPriv?.(PRIV_EDIT_SYSTEM)) return true;
    return (course.ownerUids ?? []).includes(actor._id ?? -1);
}

function canSeeCourseNode(actor: { _id?: number; hasPriv?: (priv: number) => boolean } | null, course: { visibility?: string; ownerUids?: number[] }): boolean {
    if (course.visibility === 'public') return true;
    return canEditCourseSubtree(actor, course);
}

async function listCourseNodes(): Promise<CoursePayload[]> {
    return nodes
        .filter((node) => node.parentId?.equals(rootId))
        .sort((left, right) => left.order - right.order || left._id.toHexString().localeCompare(right._id.toHexString()))
        .map((node) => courseViewOf(node));
}

async function getMergedMap(): Promise<FixtureMap> {
    return mapDoc;
}

function isObjectId(value: unknown): value is MindmapObjectId {
    return value instanceof ObjectId;
}

function sameValue(left: unknown, right: unknown): boolean {
    if (isObjectId(left) && isObjectId(right)) return left.equals(right);
    if (isObjectId(left) && typeof right === 'string') return left.toHexString() === right;
    if (typeof left === 'string' && isObjectId(right)) return left === right.toHexString();
    if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
    return left === right;
}

function fieldEquals(actual: unknown, expected: unknown): boolean {
    if (Array.isArray(actual)) {
        if (Array.isArray(expected)) {
            return actual.length === expected.length && actual.every((item, index) => sameValue(item, expected[index]));
        }
        return actual.some((item) => fieldEquals(item, expected));
    }
    return sameValue(actual, expected);
}

function isOperator(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !isObjectId(value);
}

function matchesField(row: Record<string, unknown>, key: string, expected: unknown): boolean {
    const actual = row[key];
    if (!isOperator(expected)) return fieldEquals(actual, expected);
    if ('$exists' in expected) {
        const exists = Object.hasOwn(row, key);
        if (Boolean(expected.$exists) !== exists) return false;
    }
    if ('$in' in expected) {
        if (!Array.isArray(expected.$in) || !expected.$in.some((item) => fieldEquals(actual, item))) return false;
    }
    if ('$nin' in expected) {
        if (!Array.isArray(expected.$nin) || expected.$nin.some((item) => fieldEquals(actual, item))) return false;
    }
    if ('$ne' in expected && fieldEquals(actual, expected.$ne)) return false;
    if ('$eq' in expected && !fieldEquals(actual, expected.$eq)) return false;
    const known = new Set(['$exists', '$in', '$nin', '$ne', '$eq']);
    return Object.keys(expected).filter((name) => name.startsWith('$')).every((name) => known.has(name));
}

function matches(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    if (Array.isArray(filter.$and) && !filter.$and.every((part) => isOperator(part) && matches(row, part))) return false;
    if (Array.isArray(filter.$or) && (filter.$or.length === 0 || !filter.$or.some((part) => isOperator(part) && matches(row, part)))) return false;
    return Object.entries(filter).every(([key, value]) => key === '$and' || key === '$or' || matchesField(row, key, value));
}

function cursor<T extends object>(source: T[]) {
    let values = source.slice();
    const chain = {
        sort(spec: Record<string, number>) {
            values.sort((left, right) => {
                const recordLeft = left as Record<string, unknown>;
                const recordRight = right as Record<string, unknown>;
                for (const [key, direction] of Object.entries(spec)) {
                    const leftValue = recordLeft[key];
                    const rightValue = recordRight[key];
                    if (leftValue === rightValue) continue;
                    if (typeof leftValue === 'number' && typeof rightValue === 'number') return (leftValue - rightValue) * (direction < 0 ? -1 : 1);
                    const leftText = String(leftValue);
                    const rightText = String(rightValue);
                    if (leftText === rightText) continue;
                    return (leftText < rightText ? -1 : 1) * (direction < 0 ? -1 : 1);
                }
                return 0;
            });
            return chain;
        },
        limit(count: number) {
            values = values.slice(0, count);
            return chain;
        },
        project(_fields?: Record<string, unknown>) {
            return chain;
        },
        async toArray() {
            return values.slice();
        },
        async *[Symbol.asyncIterator]() {
            yield* values;
        },
    };
    return chain;
}

function makeCollection<T extends object>(read: () => T[]) {
    return {
        find(filter: Record<string, unknown> = {}, options?: { sort?: Record<string, number>; limit?: number }) {
            const chain = cursor(read().filter((item) => matches(item as Record<string, unknown>, filter)));
            if (options?.sort) chain.sort(options.sort);
            if (typeof options?.limit === 'number') chain.limit(options.limit);
            return chain;
        },
        async findOne(filter: Record<string, unknown> = {}) {
            return read().find((item) => matches(item as Record<string, unknown>, filter)) ?? null;
        },
        async countDocuments(filter: Record<string, unknown> = {}) {
            return read().filter((item) => matches(item as Record<string, unknown>, filter)).length;
        },
    };
}

const documentColl = makeCollection(() => documents);
const dbStub = {
    collection(name: string) {
        if (name === 'document') return documentColl;
        throw new Error(`unexpected collection ${name}`);
    },
};

const DocumentModel = {
    TYPE_TRAINING,
    getMulti(domainId: string, docType: number, query: Record<string, unknown> = {}) {
        return documentColl.find({ docType, domainId, ...query });
    },
};

const TrainingModel = {
    getMulti(domainId: string, query: Record<string, unknown> = {}) {
        return DocumentModel.getMulti(domainId, TYPE_TRAINING, query);
    },
};

const ProblemModel = {
    assertProblemAclDomain(_user: unknown, _domainId: string) {},
    canBrowseProblemBank(_user: unknown) {
        return false;
    },
};

const courseApi = {
    canEditCourseSubtree,
    canSeeCourseNode,
    getMergedMap,
    listCourseNodes,
};

const modelStub = {
    ...courseApi,
    listAllNodes: async (requestedMapId: MindmapObjectId) => nodes.filter((node) => node.mapId.equals(requestedMapId)),
};

const hydroojStub = {
    ...framework,
    Handler: framework.Handler,
    NotFoundError: framework.NotFoundError,
    ObjectId,
    param: framework.param,
    PermissionError,
    PRIV: { PRIV_EDIT_SYSTEM },
    PrivilegeError,
    ProblemModel,
    DocumentModel,
    TrainingModel,
    Types: framework.Types,
    db: dbStub,
};

const handlerPath = require.resolve('../src/handler.ts');
const modelPath = require.resolve('../src/model.ts');
const courseNodesPath = require.resolve('../src/course-nodes.ts');
const dbPath = require.resolve('../src/db.ts');
const previousModelCache = require.cache[modelPath];
const previousCourseCache = require.cache[courseNodesPath];
const previousDbCache = require.cache[dbPath];
const originalLoad = Module._load;

function cacheModule(filename: string, exports: unknown) {
    require.cache[filename] = {
        id: filename,
        filename,
        loaded: true,
        exports,
    } as NodeModule;
}

cacheModule(modelPath, modelStub);
cacheModule(courseNodesPath, courseApi);
cacheModule(dbPath, { ...courseApi, async ensureIndexes() { return undefined; } });
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (request === 'hydrooj') return hydroojStub;
    if (request === '@hydrooj/utils') return { Logger };
    return originalLoad.call(this, request, parent, isMain);
};

let applyHandlers: (ctx: { Route: (name: string, path: string, HandlerClass: new (...args: unknown[]) => unknown) => void }) => void;
try {
    delete require.cache[handlerPath];
    ({ applyHandlers } = require(handlerPath));
} finally {
    Module._load = originalLoad;
    if (previousModelCache) require.cache[modelPath] = previousModelCache;
    else delete require.cache[modelPath];
    if (previousCourseCache) require.cache[courseNodesPath] = previousCourseCache;
    else delete require.cache[courseNodesPath];
    if (previousDbCache) require.cache[dbPath] = previousDbCache;
    else delete require.cache[dbPath];
}

const routes = new Map<string, new (...args: unknown[]) => unknown>();
applyHandlers({
    Route(name: string, _path: string, HandlerClass: new (...args: unknown[]) => unknown) {
        routes.set(name, HandlerClass);
    },
});

function binding(input: {
    owner: number;
    maintainer?: number[];
    node?: MindmapObjectId | string | null;
    domainId?: string;
    kind?: string;
    docType?: number;
    omitKind?: boolean;
    omitNode?: boolean;
}): StoredDocument {
    const row: StoredDocument = {
        domainId: input.domainId ?? DOMAIN_ID,
        docType: input.docType ?? TYPE_TRAINING,
        owner: input.owner,
        maintainer: input.maintainer ?? [],
    };
    if (!input.omitKind) row.kind = input.kind ?? 'course';
    if (!input.omitNode) row.knowledgeCourseNodeId = input.node === undefined ? null : input.node;
    return row;
}

beforeEach(() => {
    mapId = new ObjectId() as MindmapObjectId;
    rootId = new ObjectId() as MindmapObjectId;
    courseA = new ObjectId() as MindmapObjectId;
    courseB = new ObjectId() as MindmapObjectId;
    courseC = new ObjectId() as MindmapObjectId;
    childA = new ObjectId() as MindmapObjectId;
    childB = new ObjectId() as MindmapObjectId;
    childC = new ObjectId() as MindmapObjectId;
    mapDoc = {
        _id: mapId,
        title: TOPIC.root,
        rootNodeId: rootId,
        visibility: 'public',
        layoutDirection: 'RIGHT',
        createdAt: STAMP,
        updatedAt: STAMP,
    };
    nodes = [
        nodeStamp(TOPIC.root, null, 0, { _id: rootId }),
        nodeStamp(TOPIC.courseA, rootId, 1, { _id: courseA, courseVisibility: 'public', ownerUids: [] }),
        nodeStamp(TOPIC.courseB, rootId, 2, { _id: courseB, courseVisibility: 'public', ownerUids: [TEACHER_B] }),
        nodeStamp(TOPIC.courseC, rootId, 3, { _id: courseC, courseVisibility: 'public', ownerUids: [] }),
        nodeStamp(TOPIC.childA, courseA, 1, { _id: childA }),
        nodeStamp(TOPIC.childB, courseB, 1, { _id: childB }),
        nodeStamp(TOPIC.childC, courseC, 1, { _id: childC }),
    ];
    documents = [
        binding({ owner: 100, maintainer: [TEACHER_MAINTAINER], node: courseC }),
        binding({ owner: TEACHER_OWNER, maintainer: [], node: courseC }),
        binding({ owner: TEACHER_MAINTAINER, node: courseA, domainId: 'other-domain' }),
        binding({ owner: TEACHER_MAINTAINER, node: courseA, kind: 'problem_set' }),
        binding({ owner: TEACHER_MAINTAINER, node: courseA, docType: 10 }),
        binding({ owner: TEACHER_MAINTAINER, node: courseA, omitKind: true }),
        binding({ owner: TEACHER_MAINTAINER, omitNode: true }),
        binding({ owner: TEACHER_MAINTAINER, node: null }),
    ];
});

function coursesOf(body: PublicBody | undefined): CoursePayload[] {
    return body?.courses ?? [];
}

function courseById(body: PublicBody | undefined, id: MindmapObjectId): CoursePayload | undefined {
    return coursesOf(body).find((course) => course.id === id.toHexString());
}

function topicsOf(body: PublicBody | undefined): string[] {
    return (body?.nodes ?? []).map((node) => node.topic ?? '');
}

async function dispatchMindmapPage(user: FixtureUser = makeStudent(), query: Record<string, string> = {}): Promise<Dispatched> {
    const HandlerClass = routes.get('mindmap_main');
    if (typeof HandlerClass !== 'function') expect.fail('missing mindmap_main route');
    const request = {
        method: 'get',
        host: 'example.test',
        hostname: 'example.test',
        ip: '127.0.0.1',
        headers: {},
        cookies: {},
        body: {},
        files: {},
        query,
        querystring: new URLSearchParams(query).toString(),
        path: '/mindmap',
        originalPath: '/mindmap',
        params: {},
        referer: '',
        json: false,
        websocket: false,
    };
    const response: Dispatched = {
        body: undefined as unknown as PublicBody,
        status: 200,
        template: undefined,
        redirect: undefined,
    };
    const koaContext = {
        method: 'GET',
        params: {},
        request,
        session: {},
        holdFiles: [],
        HydroContext: {
            args: { domainId: DOMAIN_ID, ...query },
            request,
            response,
            UiContext: {},
        },
    };
    const service = {
        activeHandlers: new Map(),
        ctx: {
            async parallel(event: string, handler: { user?: FixtureUser; domain?: { _id: string }; onerror?: (error: { code?: number }) => Promise<void> }) {
                if (event !== 'handler/create') return;
                handler.user = user;
                handler.domain = { _id: DOMAIN_ID };
                handler.onerror = async (error) => {
                    response.status = error.code || 500;
                };
            },
            async serial() {
                return undefined;
            },
        },
    };
    await (framework.WebService.prototype as { handleHttp: (...args: unknown[]) => Promise<void> }).handleHttp.call(
        service,
        koaContext,
        HandlerClass,
        () => {},
        {
            plugin() {
                return {
                    ctx: { server: { renderers: {} } },
                    async dispose() {
                        return undefined;
                    },
                };
            },
        },
    );
    return response;
}

describe('mindmap public page mine courses', () => {
    for (const title of ['算法', '算法知识图谱']) {
        it(`opens the visible ${title} course by default and respects an explicit course and visibility`, async () => {
            const algorithm = nodes.find((node) => node._id.equals(courseC));
            if (!algorithm) throw new Error('missing course fixture');
            algorithm.topic = title;
            expect((await dispatchMindmapPage(makeGuest())).body.course).to.equal(courseC.toHexString());
            expect((await dispatchMindmapPage(makeStudent())).body.course).to.equal(courseC.toHexString());
            expect((await dispatchMindmapPage(makeTeacher(TEACHER_B))).body.course).to.equal(courseC.toHexString());
            expect((await dispatchMindmapPage(makeStudent(), { course: courseA.toHexString() })).body.course).to.equal(courseA.toHexString());
            algorithm.courseVisibility = 'hidden';
            expect((await dispatchMindmapPage(makeStudent())).body.course).to.equal(courseA.toHexString());
        });
    }

    it('marks the responsible teacher and selects that course ahead of an earlier public course', async () => {
        const response = await dispatchMindmapPage(makeTeacher(TEACHER_B));
        const early = courseById(response.body, courseA);
        const owned = courseById(response.body, courseB);
        const later = courseById(response.body, courseC);

        expect(response.status).to.equal(200);
        expect(response.template).to.equal('mindmap_main.html');
        expect(coursesOf(response.body).map((course) => course.id)).to.deep.equal([
            courseA.toHexString(),
            courseB.toHexString(),
            courseC.toHexString(),
        ]);
        expect(owned?.mine).to.equal(true);
        expect(owned?.canEdit).to.equal(true);
        expect(owned?.ownerUids).to.deep.equal([TEACHER_B]);
        expect(early?.mine).to.equal(false);
        expect(early?.canEdit).to.equal(false);
        expect(later?.mine).to.equal(false);
        expect(later?.canEdit).to.equal(false);
        expect(response.body.course).to.equal(courseB.toHexString());
        expect(topicsOf(response.body)).to.include(TOPIC.childB);
        expect(topicsOf(response.body)).to.not.include(TOPIC.childA);
        expect(topicsOf(response.body)).to.not.include(TOPIC.childC);
    });

    it('marks a maintained course binding without edit and selects it', async () => {
        const response = await dispatchMindmapPage(makeTeacher(TEACHER_MAINTAINER));
        const bound = courseById(response.body, courseC);
        const early = courseById(response.body, courseA);

        expect(response.status).to.equal(200);
        expect(bound?.mine).to.equal(true);
        expect(bound?.canEdit).to.equal(false);
        expect(early?.mine).to.equal(false);
        expect(courseById(response.body, courseB)?.mine).to.equal(false);
        expect(coursesOf(response.body).every((course) => course.canEdit === false)).to.equal(true);
        expect(response.body.course).to.equal(courseC.toHexString());
        expect(topicsOf(response.body)).to.include(TOPIC.childC);
        expect(topicsOf(response.body)).to.not.include(TOPIC.childA);
    });

    it('marks an owned course binding without edit and selects it', async () => {
        const response = await dispatchMindmapPage(makeTeacher(TEACHER_OWNER));
        const bound = courseById(response.body, courseC);

        expect(response.status).to.equal(200);
        expect(bound?.mine).to.equal(true);
        expect(bound?.canEdit).to.equal(false);
        expect(courseById(response.body, courseA)?.mine).to.equal(false);
        expect(courseById(response.body, courseB)?.mine).to.equal(false);
        expect(response.body.course).to.equal(courseC.toHexString());
    });

    it('leaves every course unmarked for a student and selects the earliest public course', async () => {
        const response = await dispatchMindmapPage(makeStudent());

        expect(response.status).to.equal(200);
        expect(coursesOf(response.body)).to.have.lengthOf(3);
        for (const course of coursesOf(response.body)) {
            expect(course.mine).to.equal(false);
            expect(course.canEdit).to.equal(false);
        }
        expect(response.body.course).to.equal(courseA.toHexString());
        expect(topicsOf(response.body)).to.include(TOPIC.childA);
        expect(topicsOf(response.body)).to.not.include(TOPIC.childB);
    });

    it('leaves every course unmarked for a signed-out user', async () => {
        const response = await dispatchMindmapPage(makeGuest());

        expect(response.status).to.equal(200);
        expect(coursesOf(response.body)).to.have.lengthOf(3);
        for (const course of coursesOf(response.body)) {
            expect(course.mine).to.equal(false);
            expect(course.canEdit).to.equal(false);
        }
        expect(response.body.course).to.equal(courseA.toHexString());
    });

    it('keeps the requested course selected when another course is mine', async () => {
        const response = await dispatchMindmapPage(makeTeacher(TEACHER_B), { course: courseA.toHexString() });

        expect(response.status).to.equal(200);
        expect(response.body.course).to.equal(courseA.toHexString());
        expect(courseById(response.body, courseB)?.mine).to.equal(true);
        expect(courseById(response.body, courseB)?.canEdit).to.equal(true);
        expect(courseById(response.body, courseA)?.mine).to.equal(false);
        expect(topicsOf(response.body)).to.include(TOPIC.childA);
        expect(topicsOf(response.body)).to.not.include(TOPIC.childB);
    });

    it('lets an administrator edit visible courses without marking them as mine', async () => {
        const response = await dispatchMindmapPage(makeAdmin());

        expect(response.status).to.equal(200);
        expect(coursesOf(response.body)).to.have.lengthOf(3);
        for (const course of coursesOf(response.body)) {
            expect(course.mine).to.equal(false);
            expect(course.canEdit).to.equal(true);
        }
        expect(response.body.course).to.equal(courseA.toHexString());
    });

    it('selects an owned hidden course when that is the only visible course', async () => {
        for (const node of nodes) {
            if (node.parentId?.equals(rootId)) node.courseVisibility = 'hidden';
        }
        const response = await dispatchMindmapPage(makeTeacher(TEACHER_B));
        const owned = courseById(response.body, courseB);

        expect(response.status).to.equal(200);
        expect(coursesOf(response.body).map((course) => course.id)).to.deep.equal([courseB.toHexString()]);
        expect(owned?.mine).to.equal(true);
        expect(owned?.canEdit).to.equal(true);
        expect(response.body.course).to.equal(courseB.toHexString());
        expect(topicsOf(response.body)).to.include(TOPIC.childB);
        expect(topicsOf(response.body)).to.not.include(TOPIC.childA);
    });

    it('selects an earlier hidden course of mine ahead of a later public course of mine', async () => {
        const hidden = nodes.find((node) => node._id.equals(courseA));
        if (!hidden) expect.fail('missing course A');
        hidden.courseVisibility = 'hidden';
        hidden.ownerUids = [TEACHER_B];
        const response = await dispatchMindmapPage(makeTeacher(TEACHER_B));

        expect(response.status).to.equal(200);
        expect(courseById(response.body, courseA)?.mine).to.equal(true);
        expect(courseById(response.body, courseB)?.mine).to.equal(true);
        expect(response.body.course).to.equal(courseA.toHexString());
        expect(topicsOf(response.body)).to.include(TOPIC.childA);
        expect(topicsOf(response.body)).to.not.include(TOPIC.childB);
    });

    it('selects the earliest mine course when several public courses are mine', async () => {
        const first = nodes.find((node) => node._id.equals(courseA));
        if (!first) expect.fail('missing course A');
        first.ownerUids = [TEACHER_B];
        const response = await dispatchMindmapPage(makeTeacher(TEACHER_B));

        expect(response.status).to.equal(200);
        expect(coursesOf(response.body).map((course) => course.id)).to.deep.equal([
            courseA.toHexString(),
            courseB.toHexString(),
            courseC.toHexString(),
        ]);
        expect(courseById(response.body, courseA)?.mine).to.equal(true);
        expect(courseById(response.body, courseB)?.mine).to.equal(true);
        expect(courseById(response.body, courseC)?.mine).to.equal(false);
        expect(response.body.course).to.equal(courseA.toHexString());
        expect(topicsOf(response.body)).to.include(TOPIC.childA);
        expect(topicsOf(response.body)).to.not.include(TOPIC.childB);
    });

    it('does not mark a course mine for a signed-out user listed as a responsible teacher', async () => {
        const listed = nodes.find((node) => node._id.equals(courseB));
        if (!listed) expect.fail('missing course B');
        listed.ownerUids = [0];
        const response = await dispatchMindmapPage(makeGuest());

        expect(response.status).to.equal(200);
        expect(courseById(response.body, courseA)?.mine).to.equal(false);
        expect(courseById(response.body, courseB)?.mine).to.equal(false);
        expect(courseById(response.body, courseC)?.mine).to.equal(false);
        expect(response.body.course).to.equal(courseA.toHexString());
    });

    it('marks a course mine when the teacher is a later responsible teacher', async () => {
        const owned = nodes.find((node) => node._id.equals(courseB));
        if (!owned) expect.fail('missing course B');
        owned.ownerUids = [99, TEACHER_B];
        const response = await dispatchMindmapPage(makeTeacher(TEACHER_B));
        const course = courseById(response.body, courseB);

        expect(response.status).to.equal(200);
        expect(course?.mine).to.equal(true);
        expect(course?.canEdit).to.equal(true);
        expect(course?.ownerUids).to.deep.equal([99, TEACHER_B]);
        expect(courseById(response.body, courseA)?.mine).to.equal(false);
        expect(response.body.course).to.equal(courseB.toHexString());
    });

    it('marks a course mine when the teacher is one of several maintainers', async () => {
        documents = [binding({ owner: 100, maintainer: [1, TEACHER_MAINTAINER], node: courseC })];
        const response = await dispatchMindmapPage(makeTeacher(TEACHER_MAINTAINER));
        const bound = courseById(response.body, courseC);

        expect(response.status).to.equal(200);
        expect(bound?.mine).to.equal(true);
        expect(bound?.canEdit).to.equal(false);
        expect(courseById(response.body, courseA)?.mine).to.equal(false);
        expect(courseById(response.body, courseB)?.mine).to.equal(false);
        expect(response.body.course).to.equal(courseC.toHexString());
    });

    it('marks every course the teacher owns or maintains and selects the earliest', async () => {
        documents = [
            binding({ owner: 100, maintainer: [TEACHER_MAINTAINER], node: courseC }),
            binding({ owner: TEACHER_MAINTAINER, node: courseA }),
        ];
        const response = await dispatchMindmapPage(makeTeacher(TEACHER_MAINTAINER));

        expect(response.status).to.equal(200);
        expect(courseById(response.body, courseA)?.mine).to.equal(true);
        expect(courseById(response.body, courseA)?.canEdit).to.equal(false);
        expect(courseById(response.body, courseC)?.mine).to.equal(true);
        expect(courseById(response.body, courseC)?.canEdit).to.equal(false);
        expect(courseById(response.body, courseB)?.mine).to.equal(false);
        expect(response.body.course).to.equal(courseA.toHexString());
        expect(topicsOf(response.body)).to.include(TOPIC.childA);
        expect(topicsOf(response.body)).to.not.include(TOPIC.childC);
    });

    it('fails closed when a course binding node id is not an object id', async () => {
        documents = [
            binding({ owner: 100, maintainer: [TEACHER_MAINTAINER], node: courseC }),
            binding({ owner: TEACHER_MAINTAINER, node: courseA.toHexString() }),
        ];
        const response = await dispatchMindmapPage(makeTeacher(TEACHER_MAINTAINER));

        expect(response.status).to.equal(500);
        expect(response.body?.course).to.equal(undefined);
        expect(courseById(response.body, courseA)?.mine).to.equal(undefined);
        expect(courseById(response.body, courseC)?.mine).to.equal(undefined);
    });
});
