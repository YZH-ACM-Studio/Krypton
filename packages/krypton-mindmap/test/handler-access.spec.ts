import { createRequire } from 'node:module';
import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

// Load only the HTTP framework. Importing the full `hydrooj` plugin API would
// boot database-backed model singletons, which is outside this focused route
// boundary test.
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
    description?: string;
    color?: string;
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
    layoutDirection: 'RIGHT' | 'DOWN';
    createdAt: Date;
    updatedAt: Date;
}

interface CoursePayload {
    id: string;
    title: string;
    order: number;
    visibility: 'public' | 'hidden';
    ownerUids: number[];
}

interface NodePayload {
    _id?: string;
    mapId?: string;
    topic?: string;
    description?: string;
    color?: string;
    tags?: string[];
    problemIds?: string[];
    parentId?: string | null;
    courseVisibility?: 'public' | 'hidden';
    ownerUids?: number[];
}

interface ResponseBody {
    config?: {
        _id?: string;
        title?: string;
        rootNodeId?: string;
        visibility?: string;
        layoutDirection?: string;
        updatedAt?: string;
        isDefault?: boolean;
    };
    courses?: CoursePayload[];
    course?: string;
    nodes?: NodePayload[];
    maps?: Array<{ _id?: string; usage?: { nodes: number; problems: number; courses: number } }>;
    referenceCounts?: Record<string, number>;
    courseNode?: CoursePayload;
    ok?: boolean;
    error?: { name?: string; params?: unknown };
    staleMapId?: string;
}

interface Dispatched {
    response: {
        body: ResponseBody;
        status: number;
        template?: string;
        redirect?: string;
    };
}

interface RegisteredRoute {
    name: string;
    path: string;
    Handler: new (...args: unknown[]) => unknown;
}

interface ActorLike {
    _id?: number;
    hasPriv?: (...privileges: number[]) => boolean;
}

const TOPIC = {
    root: '知识图谱',
    hidden: '隐藏课',
    early: '公开早',
    late: '公开晚',
    earlyChild: '早子节点',
    hiddenChild: '隐子节点',
    lateChild: '晚子节点',
} as const;

const STAMP = new Date('2026-07-16T00:00:00.000Z');
const TEACHER_ID = 7;
const PRIV_EDIT_SYSTEM = 1;

const calls: Record<string, unknown[][]> = {
    assertDomain: [],
    canBrowse: [],
    createMap: [],
    createNode: [],
    deleteMap: [],
    deleteNode: [],
    getMap: [],
    getMapUsage: [],
    getReferenceCounts: [],
    listProblems: [],
    loggerError: [],
    loggerWarn: [],
    moveNode: [],
    searchProblems: [],
    setCourseNodeSettings: [],
    updateMap: [],
    updateNode: [],
};
let browseAllowed = false;
let assertFailure: Error | null = null;
let browseFailure: Error | null = null;
let bootstrapMaps: FixtureMap[] = [];
let bootstrapNodes: FixtureNode[] = [];
let mapId = new ObjectId() as MindmapObjectId;
let rootId = new ObjectId() as MindmapObjectId;
let hiddenCourseId = new ObjectId() as MindmapObjectId;
let earlyCourseId = new ObjectId() as MindmapObjectId;
let lateCourseId = new ObjectId() as MindmapObjectId;
let earlyChildId = new ObjectId() as MindmapObjectId;
let hiddenChildId = new ObjectId() as MindmapObjectId;
let lateChildId = new ObjectId() as MindmapObjectId;
let mutationFailure:
    | (Error & {
        code?: number;
        params?: unknown[];
        mindmapMutationContext?: Record<string, unknown>;
    })
    | null = null;

class Logger {
    name: string;

    constructor(name: string) {
        this.name = name;
    }

    error(...args: unknown[]) {
        calls.loggerError.push(args);
    }

    warn(...args: unknown[]) {
        calls.loggerWarn.push(args);
    }
}

const ProblemModel = {
    assertProblemAclDomain(user: unknown, domainId: string) {
        calls.assertDomain.push([user, domainId]);
        if (assertFailure) throw assertFailure;
        if (domainId !== 'system') throw new framework.ForbiddenError();
    },
    canBrowseProblemBank(user: unknown) {
        calls.canBrowse.push([user]);
        if (browseFailure) throw browseFailure;
        return browseAllowed;
    },
};

const sensitiveProblems = [
    {
        pid: 'SECRET_PID',
        title: 'SECRET_TITLE',
        tag: ['SECRET_TAG'],
        nSubmit: 987654,
    },
];

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

function canEditCourseSubtree(actor: ActorLike | null, course: { ownerUids?: number[] }): boolean {
    if (!actor) return false;
    if (actor.hasPriv?.(PRIV_EDIT_SYSTEM)) return true;
    return (course.ownerUids ?? []).includes(actor._id ?? -1);
}

function canSeeCourseNode(actor: ActorLike | null, course: { visibility?: string; ownerUids?: number[] }): boolean {
    if (course.visibility === 'public') return true;
    return canEditCourseSubtree(actor, course);
}

async function courseNodeOf(nodeId: MindmapObjectId | string): Promise<CoursePayload | null> {
    const hex = typeof nodeId === 'string' ? nodeId : nodeId.toHexString();
    if (hex === rootId.toHexString()) return null;
    const byId = new Map(bootstrapNodes.map((node) => [node._id.toHexString(), node]));
    let current = byId.get(hex);
    const seen = new Set<string>();
    while (current) {
        const currentId = current._id.toHexString();
        if (seen.has(currentId)) return null;
        seen.add(currentId);
        if (current.parentId?.equals(rootId)) return courseViewOf(current);
        if (!current.parentId) return null;
        current = byId.get(current.parentId.toHexString());
    }
    return null;
}

async function listCourseNodes(): Promise<CoursePayload[]> {
    return bootstrapNodes
        .filter((node) => node.parentId?.equals(rootId))
        .sort((left, right) => left.order - right.order || left._id.toHexString().localeCompare(right._id.toHexString()))
        .map((node) => courseViewOf(node));
}

async function getMergedMap(): Promise<FixtureMap> {
    if (bootstrapMaps.length !== 1) throw Object.assign(new Error('知识图谱尚未合并，请先运行 mindmap:merge-courses'), { code: 400 });
    return bootstrapMaps[0];
}

async function setCourseNodeSettings(input: Record<string, unknown>): Promise<CoursePayload> {
    calls.setCourseNodeSettings.push([input]);
    return {
        id: String(input.nodeId),
        title: TOPIC.hidden,
        order: 0,
        visibility: input.visibility === 'public' ? 'public' : 'hidden',
        ownerUids: Array.isArray(input.ownerUids) ? input.ownerUids.filter((uid): uid is number => typeof uid === 'number') : [],
    };
}

const courseApi = {
    canEditCourseSubtree,
    canSeeCourseNode,
    courseNodeOf,
    getMergedMap,
    listCourseNodes,
    setCourseNodeSettings,
};

const modelStub = {
    ...courseApi,
    pickDefaultKnowledgeMap(maps: FixtureMap[]) {
        return maps[0] ?? null;
    },
    async createKnowledgeMap(...args: unknown[]) {
        calls.createMap.push(args);
        if (mutationFailure) throw mutationFailure;
        return bootstrapMaps[0];
    },
    async createNode(...args: unknown[]) {
        calls.createNode.push(args);
        if (mutationFailure) throw mutationFailure;
        return {};
    },
    async deleteKnowledgeMap(...args: unknown[]) {
        calls.deleteMap.push(args);
        if (mutationFailure) throw mutationFailure;
        return undefined;
    },
    async deleteNode(...args: unknown[]) {
        calls.deleteNode.push(args);
        if (mutationFailure) throw mutationFailure;
        return undefined;
    },
    async getKnowledgeMap(id: MindmapObjectId) {
        calls.getMap.push([id]);
        return bootstrapMaps.find((map) => map._id.equals(id)) || null;
    },
    async getKnowledgeMapUsage(...args: unknown[]) {
        calls.getMapUsage.push(args);
        return { nodes: bootstrapNodes.length, problems: 0, courses: 0 };
    },
    async getNodeReferenceCounts(...args: unknown[]) {
        calls.getReferenceCounts.push(args);
        return Object.fromEntries(bootstrapNodes.map((node) => [node._id.toHexString(), 0]));
    },
    listAllNodes: async (requestedMapId: MindmapObjectId) => bootstrapNodes.filter((node) => node.mapId.equals(requestedMapId)),
    listKnowledgeMaps: async () => bootstrapMaps.slice(),
    async listProblemsForNode(...args: unknown[]) {
        calls.listProblems.push(args);
        return sensitiveProblems;
    },
    async moveNode(...args: unknown[]) {
        calls.moveNode.push(args);
        if (mutationFailure) throw mutationFailure;
        return undefined;
    },
    async searchProblemsForAdmin(...args: unknown[]) {
        calls.searchProblems.push(args);
        return sensitiveProblems;
    },
    async updateNode(...args: unknown[]) {
        calls.updateNode.push(args);
        if (mutationFailure) throw mutationFailure;
        return undefined;
    },
    async updateKnowledgeMap(...args: unknown[]) {
        calls.updateMap.push(args);
        if (mutationFailure) throw mutationFailure;
        return bootstrapMaps[0];
    },
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
    Types: framework.Types,
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

let applyHandlers: (ctx: { Route: (name: string, path: string, HandlerClass: RegisteredRoute['Handler']) => void }) => void;
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

const routes = new Map<string, RegisteredRoute['Handler']>();
const registered: RegisteredRoute[] = [];
applyHandlers({
    Route(name: string, path: string, HandlerClass: RegisteredRoute['Handler']) {
        routes.set(name, HandlerClass);
        registered.push({ name, path, Handler: HandlerClass });
    },
});

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

function makeUser() {
    return new FixtureUser(42, 0, () => false);
}

function makeTeacher() {
    return new FixtureUser(TEACHER_ID, 0, () => false);
}

function makeAdminUser() {
    return new FixtureUser(42, PRIV_EDIT_SYSTEM, () => true);
}

function requireHandler(route: string, routePath?: string) {
    if (routePath) {
        const found = registered.find((entry) => entry.path === routePath);
        if (!found) expect.fail(`missing route ${routePath}`);
        return found;
    }
    const HandlerClass = routes.get(route);
    if (typeof HandlerClass !== 'function') expect.fail(`missing ${route} route`);
    return { name: route, path: route, Handler: HandlerClass };
}

function passedActorId(actor: unknown): unknown {
    if (typeof actor === 'number') return actor;
    if (actor && typeof actor === 'object' && '_id' in actor) return (actor as { _id?: unknown })._id;
    return undefined;
}

function topicsOf(body: ResponseBody | undefined): string[] {
    return (body?.nodes ?? []).map((node) => node.topic ?? '').sort();
}

function courseIdsOf(body: ResponseBody | undefined): string[] {
    return (body?.courses ?? []).map((course) => course.id).sort();
}

async function dispatchHttp({
    route,
    routePath,
    method = 'GET',
    path,
    user = makeUser(),
    authoritativeDomainId = 'system',
    args = {},
    body = {},
    query = {},
    params = {},
    json = true,
}: {
    route: string;
    routePath?: string;
    method?: 'GET' | 'POST';
    path: string;
    user?: ReturnType<typeof makeUser>;
    authoritativeDomainId?: string;
    args?: Record<string, unknown>;
    body?: Record<string, unknown>;
    query?: Record<string, string>;
    params?: Record<string, string>;
    json?: boolean;
}): Promise<Dispatched['response']> {
    const found = requireHandler(route, routePath);
    const request = {
        method: method.toLowerCase(),
        host: 'example.test',
        hostname: 'example.test',
        ip: '127.0.0.1',
        headers: {},
        cookies: {},
        body,
        files: {},
        query,
        querystring: new URLSearchParams(query).toString(),
        path,
        originalPath: path,
        params,
        referer: '',
        json,
        websocket: false,
    };
    const response: Dispatched['response'] = {
        body: undefined as unknown as ResponseBody,
        status: 200,
        template: undefined,
        redirect: undefined,
    };
    const koaContext = {
        method,
        params,
        request,
        session: {},
        holdFiles: [],
        HydroContext: {
            args: { domainId: authoritativeDomainId, ...query, ...params, ...args },
            request,
            response,
            UiContext: {},
        },
    };
    const service = {
        activeHandlers: new Map(),
        ctx: {
            async parallel(event: string, handler: { user?: unknown; domain?: { _id: string }; onerror?: (error: { code?: number; name?: string; params?: unknown }) => Promise<void> }) {
                if (event !== 'handler/create') return;
                handler.user = user;
                handler.domain = { _id: authoritativeDomainId };
                handler.onerror = async (error) => {
                    response.status = error.code || 500;
                    response.body = { error: { name: error.name, params: error.params } };
                };
            },
            async serial() {
                return undefined;
            },
        },
    };
    const savedContext = {
        plugin() {
            return {
                ctx: { server: { renderers: {} } },
                async dispose() {
                    return undefined;
                },
            };
        },
    };
    await (framework.WebService.prototype as { handleHttp: (...args: unknown[]) => Promise<void> }).handleHttp.call(
        service,
        koaContext,
        found.Handler,
        () => {},
        savedContext,
    );
    return response;
}

async function dispatchProblemsApi(
    user = makeUser(),
    argsDomainId = 'system',
    authoritativeDomainId = 'system',
    nodeId: MindmapObjectId = earlyChildId,
) {
    const requestedMapId = bootstrapMaps[0]._id;
    const response = await dispatchHttp({
        route: 'mindmap_api_problems',
        path: '/api/mindmap/problems',
        user,
        authoritativeDomainId,
        query: { mapId: requestedMapId.toHexString(), nodeId: nodeId.toHexString() },
        args: { domainId: argsDomainId, mapId: requestedMapId.toHexString(), nodeId: nodeId.toHexString() },
    });
    return { mapId: requestedMapId, nodeId, response };
}

async function dispatchMindmapPage(user = makeUser(), authoritativeDomainId = 'system', query: Record<string, string> = {}) {
    const response = await dispatchHttp({
        route: 'mindmap_main',
        method: 'GET',
        path: '/mindmap',
        user,
        authoritativeDomainId,
        query,
        json: false,
    });
    return { response };
}

function expectNoProblemDisclosure(body: unknown) {
    const serialized = JSON.stringify(body);
    expect(serialized).not.to.include('SECRET_PID');
    expect(serialized).not.to.include('SECRET_TITLE');
    expect(serialized).not.to.include('SECRET_TAG');
    expect(serialized).not.to.include('987654');
}

beforeEach(() => {
    for (const entries of Object.values(calls)) entries.length = 0;
    browseAllowed = false;
    assertFailure = null;
    browseFailure = null;
    mutationFailure = null;
    mapId = new ObjectId() as MindmapObjectId;
    rootId = new ObjectId() as MindmapObjectId;
    hiddenCourseId = new ObjectId() as MindmapObjectId;
    earlyCourseId = new ObjectId() as MindmapObjectId;
    lateCourseId = new ObjectId() as MindmapObjectId;
    earlyChildId = new ObjectId() as MindmapObjectId;
    hiddenChildId = new ObjectId() as MindmapObjectId;
    lateChildId = new ObjectId() as MindmapObjectId;
    bootstrapMaps = [
        {
            _id: mapId,
            title: TOPIC.root,
            rootNodeId: rootId,
            visibility: 'public',
            layoutDirection: 'RIGHT',
            createdAt: STAMP,
            updatedAt: STAMP,
        },
    ];
    bootstrapNodes = [
        nodeStamp(TOPIC.root, null, 0, { _id: rootId }),
        nodeStamp(TOPIC.hidden, rootId, 0, { _id: hiddenCourseId, courseVisibility: 'hidden', ownerUids: [TEACHER_ID] }),
        nodeStamp(TOPIC.early, rootId, 1, { _id: earlyCourseId, courseVisibility: 'public', ownerUids: [] }),
        nodeStamp(TOPIC.late, rootId, 5, { _id: lateCourseId, courseVisibility: 'public', ownerUids: [] }),
        nodeStamp(TOPIC.earlyChild, earlyCourseId, 1, {
            _id: earlyChildId,
            description: '公开说明',
            color: 'sky',
            tags: ['SECRET_TAG'],
            problemIds: ['SECRET_PID'],
        }),
        nodeStamp(TOPIC.hiddenChild, hiddenCourseId, 1, { _id: hiddenChildId }),
        nodeStamp(TOPIC.lateChild, lateCourseId, 1, { _id: lateChildId }),
    ];
});

describe('mindmap page bootstrap metadata boundary', () => {
    it('shows the merged root and the lowest-order public course without problem metadata', async () => {
        const { response } = await dispatchMindmapPage();
        const earlyChild = response.body.nodes?.find((node) => node.topic === TOPIC.earlyChild);

        expect(response.status).to.equal(200);
        expect(response.template).to.equal('mindmap_main.html');
        expect(topicsOf(response.body)).to.deep.equal([TOPIC.root, TOPIC.early, TOPIC.earlyChild].sort());
        expect(response.body.course).to.equal(earlyCourseId.toHexString());
        expect(courseIdsOf(response.body)).to.deep.equal([earlyCourseId.toHexString(), lateCourseId.toHexString()].sort());
        expect(response.body.config?._id).to.equal(mapId.toHexString());
        expect(response.body.config?.title).to.equal(TOPIC.root);
        expect(response.body.config?.rootNodeId).to.equal(rootId.toHexString());
        expect(response.body.config?.visibility).to.equal('public');
        expect(response.body.config?.layoutDirection).to.equal('RIGHT');
        expect(Object.hasOwn(response.body.config ?? {}, 'isDefault')).to.equal(false);
        expect(earlyChild).to.include({ topic: TOPIC.earlyChild, description: '公开说明', color: 'sky', parentId: earlyCourseId.toHexString() });
        expect(earlyChild?.tags).to.deep.equal([]);
        expect(earlyChild?.problemIds).to.deep.equal([]);
        expectNoProblemDisclosure(response.body);
        expect(calls.loggerError).to.deep.equal([]);
    });

    it('preserves visible tags but never exposes manual problem ids in the public bootstrap', async () => {
        browseAllowed = true;
        const { response } = await dispatchMindmapPage();
        const earlyChild = response.body.nodes?.find((node) => node.topic === TOPIC.earlyChild);

        expect(response.status).to.equal(200);
        expect(earlyChild?.tags).to.deep.equal(['SECRET_TAG']);
        expect(earlyChild?.problemIds).to.deep.equal([]);
        expect(JSON.stringify(response.body)).not.to.include('SECRET_PID');
        expect(calls.loggerError).to.deep.equal([]);
    });

    it('keeps the public tree redacted and logs when ACL preload evaluation fails', async () => {
        browseAllowed = true;
        assertFailure = new Error('ACL preload unavailable');
        const { response } = await dispatchMindmapPage();
        const earlyChild = response.body.nodes?.find((node) => node.topic === TOPIC.earlyChild);

        expect(response.status).to.equal(200);
        expect(earlyChild).to.include({ topic: TOPIC.earlyChild, color: 'sky' });
        expect(earlyChild?.tags).to.deep.equal([]);
        expect(earlyChild?.problemIds).to.deep.equal([]);
        expectNoProblemDisclosure(response.body);
        expect(calls.loggerError).to.have.lengthOf(1);
        expect(calls.loggerError[0].join(' ')).to.include('ACL preload unavailable');
    });

    it('keeps the public tree redacted and logs when the ACL marker belongs to another domain', async () => {
        browseAllowed = true;
        const { response } = await dispatchMindmapPage(makeUser(), 'course-domain');
        const earlyChild = response.body.nodes?.find((node) => node.topic === TOPIC.earlyChild);

        expect(response.status).to.equal(200);
        expect(earlyChild).to.include({ topic: TOPIC.earlyChild, color: 'sky' });
        expect(earlyChild?.tags).to.deep.equal([]);
        expect(earlyChild?.problemIds).to.deep.equal([]);
        expectNoProblemDisclosure(response.body);
        expect(calls.loggerError).to.have.lengthOf(1);
    });

    it('returns 404 when a student requests a hidden course', async () => {
        const { response } = await dispatchMindmapPage(makeUser(), 'system', { course: hiddenCourseId.toHexString() });

        expect(response.status).to.equal(404);
        expectNoProblemDisclosure(response.body);
    });

    it('lets a responsible teacher open a hidden course subtree', async () => {
        const { response } = await dispatchMindmapPage(makeTeacher(), 'system', { course: hiddenCourseId.toHexString() });

        expect(response.status).to.equal(200);
        expect(response.body.course).to.equal(hiddenCourseId.toHexString());
        expect(topicsOf(response.body)).to.deep.equal([TOPIC.root, TOPIC.hidden, TOPIC.hiddenChild].sort());
    });

    it('includes hidden courses for an administrator and a responsible teacher', async () => {
        const admin = await dispatchMindmapPage(makeAdminUser());
        const teacher = await dispatchMindmapPage(makeTeacher());
        const hidden = hiddenCourseId.toHexString();
        const early = earlyCourseId.toHexString();

        expect(courseIdsOf(admin.response.body)).to.include(hidden);
        expect(courseIdsOf(teacher.response.body)).to.include(hidden);
        expect(admin.response.body.course).to.equal(early);
        expect(teacher.response.body.course).to.equal(early);
        expect(topicsOf(admin.response.body)).to.not.include(TOPIC.hidden);
        expect(topicsOf(admin.response.body)).to.not.include(TOPIC.hiddenChild);
        expect(topicsOf(teacher.response.body)).to.not.include(TOPIC.hidden);
        expect(topicsOf(teacher.response.body)).to.not.include(TOPIC.hiddenChild);
    });

    it('selects the requested public course subtree', async () => {
        const { response } = await dispatchMindmapPage(makeUser(), 'system', { course: lateCourseId.toHexString() });

        expect(response.status).to.equal(200);
        expect(response.body.course).to.equal(lateCourseId.toHexString());
        expect(topicsOf(response.body)).to.deep.equal([TOPIC.root, TOPIC.late, TOPIC.lateChild].sort());
    });

    it('ignores a map query that names the merged map', async () => {
        const { response } = await dispatchMindmapPage(makeUser(), 'system', { map: mapId.toHexString() });

        expect(response.status).to.equal(200);
        expect(response.redirect).to.equal(undefined);
        expect(response.body.course).to.equal(earlyCourseId.toHexString());
        expect(topicsOf(response.body)).to.deep.equal([TOPIC.root, TOPIC.early, TOPIC.earlyChild].sort());
    });

    it('redirects to /mindmap when the map query is not the merged map', async () => {
        const { response } = await dispatchMindmapPage(makeUser(), 'system', { map: (new ObjectId() as MindmapObjectId).toHexString() });

        expect(response.redirect).to.equal('/mindmap');
    });
});

describe('mindmap problem enumeration HTTP boundary', () => {
    it('enumerates every published node problem without applying the caller problem-bank scope', async () => {
        const { mapId: requestedMapId, nodeId, response } = await dispatchProblemsApi();

        expect(response.status).to.equal(200);
        expect(calls.canBrowse).to.deep.equal([]);
        expect(calls.listProblems).to.have.lengthOf(1);
        expect(calls.listProblems[0]).to.deep.equal(['system', requestedMapId, nodeId, {}]);
        expect(response.body).to.deep.equal({ problems: sensitiveProblems });
    });

    it('ignores a forged args domain and queries only the authoritative domain', async () => {
        const { mapId: requestedMapId, nodeId, response } = await dispatchProblemsApi(makeUser(), 'evil', 'system');

        expect(response.status).to.equal(200);
        expect(calls.assertDomain).to.deep.equal([]);
        expect(calls.listProblems[0]).to.deep.equal(['system', requestedMapId, nodeId, {}]);
    });

    it('does not list problems on a hidden course the caller cannot see', async () => {
        const { response } = await dispatchProblemsApi(makeUser(), 'system', 'system', hiddenChildId);

        expect(response.status).to.equal(404);
        expect(calls.listProblems).to.deep.equal([]);
        expectNoProblemDisclosure(response.body);
    });

    it('lists problems on a hidden course the responsible teacher can see', async () => {
        const { mapId: requestedMapId, nodeId, response } = await dispatchProblemsApi(makeTeacher(), 'system', 'system', hiddenChildId);

        expect(response.status).to.equal(200);
        expect(calls.listProblems[0]).to.deep.equal(['system', requestedMapId, nodeId, {}]);
    });
});

describe('mindmap course editor HTTP boundary', () => {
    async function openEditor(user: ReturnType<typeof makeUser>, node: MindmapObjectId) {
        return dispatchHttp({
            route: 'mindmap_course_edit',
            routePath: '/mindmap/:nodeId/edit',
            path: `/mindmap/${node.toHexString()}/edit`,
            user,
            params: { nodeId: node.toHexString() },
            args: { nodeId: node.toHexString() },
            json: false,
        });
    }

    it('opens the course editor for a responsible teacher or administrator and rejects anyone else', async () => {
        const edit = registered.find((entry) => entry.path === '/mindmap/:nodeId/edit');
        if (!edit) expect.fail('missing route /mindmap/:nodeId/edit');
        expect(edit.name).to.equal('mindmap_course_edit');

        const own = await openEditor(makeTeacher(), hiddenCourseId);
        const admin = await openEditor(makeAdminUser(), earlyCourseId);
        const other = await openEditor(makeTeacher(), earlyCourseId);
        const student = await openEditor(makeUser(), earlyCourseId);

        expect(own.status).to.equal(200);
        expect(own.body.config?._id).to.equal(bootstrapMaps[0]._id.toHexString());
        expect(own.body.config?.updatedAt).to.equal(bootstrapMaps[0].updatedAt.toISOString());
        expect(own.template).to.equal('mindmap_course_edit.html');
        expect(own.body.courseNode?.id).to.equal(hiddenCourseId.toHexString());
        expect(own.body.courseNode?.visibility).to.equal('hidden');
        expect(own.body.courseNode?.ownerUids).to.deep.equal([TEACHER_ID]);
        expect(topicsOf(own.body)).to.include(TOPIC.hiddenChild);
        expect(topicsOf(own.body)).to.not.include(TOPIC.root);
        expect(topicsOf(own.body)).to.not.include(TOPIC.earlyChild);
        expect(own.body.referenceCounts?.[hiddenChildId.toHexString()]).to.equal(0);
        expect(admin.status).to.equal(200);
        expect(admin.body.config?._id).to.equal(bootstrapMaps[0]._id.toHexString());
        expect(admin.body.config?.updatedAt).to.equal(bootstrapMaps[0].updatedAt.toISOString());
        expect(admin.template).to.equal('mindmap_course_edit.html');
        expect(admin.body.courseNode?.id).to.equal(earlyCourseId.toHexString());
        expect(other.status).to.equal(403);
        expect(other.body.error?.name).to.equal('PermissionError');
        expect(student.status).to.equal(403);
        expect(student.body.error?.name).to.equal('PermissionError');
    });

    it('creates a course-subtree node with the administrator envelope and the actor', async () => {
        const parent = bootstrapNodes.find((node) => node._id.equals(hiddenCourseId));
        if (!parent) expect.fail('missing hidden course');
        const payload = {
            mapId: mapId.toHexString(),
            expectedMapUpdatedAt: STAMP.toISOString(),
            parentId: parent._id.toHexString(),
            expectedParentUpdatedAt: parent.updatedAt.toISOString(),
            topic: '新节点',
            description: '',
            color: 'sky',
            tags: [],
            problemIds: [],
        };
        const response = await dispatchHttp({
            route: 'mindmap_course_nodes',
            routePath: '/mindmap/:nodeId/nodes',
            method: 'POST',
            path: `/mindmap/${hiddenCourseId.toHexString()}/nodes`,
            user: makeTeacher(),
            params: { nodeId: hiddenCourseId.toHexString() },
            args: { nodeId: hiddenCourseId.toHexString(), operation: 'create', payload: JSON.stringify(payload) },
            body: { operation: 'create', payload: JSON.stringify(payload) },
        });
        const denied = await dispatchHttp({
            route: 'mindmap_course_nodes',
            routePath: '/mindmap/:nodeId/nodes',
            method: 'POST',
            path: `/mindmap/${earlyCourseId.toHexString()}/nodes`,
            user: makeTeacher(),
            params: { nodeId: earlyCourseId.toHexString() },
            args: { nodeId: earlyCourseId.toHexString(), operation: 'create', payload: JSON.stringify(payload) },
            body: { operation: 'create', payload: JSON.stringify(payload) },
        });

        expect(response.status, JSON.stringify(response.body)).to.equal(200);
        expect(response.body.config?._id).to.equal(bootstrapMaps[0]._id.toHexString());
        expect(response.body.config?.updatedAt).to.equal(bootstrapMaps[0].updatedAt.toISOString());
        expect(calls.createNode).to.have.lengthOf(1);
        expect(passedActorId((calls.createNode[0][0] as { actor?: unknown }).actor)).to.equal(TEACHER_ID);
        expect((calls.createNode[0][0] as { domainId?: string }).domainId).to.equal('system');
        expect((calls.createNode[0][0] as { topic?: string }).topic).to.equal('新节点');
        expect(denied.status).to.equal(403);
        expect(denied.body.error?.name).to.equal('PermissionError');
        expect(calls.createNode).to.have.lengthOf(1);
    });
});

describe('mindmap administrator HTTP boundary', () => {
    it('gates the page, search, association API, and writes with PRIV_EDIT_SYSTEM', async () => {
        const nodeId = bootstrapNodes[0]._id.toHexString();
        const requestedMapId = bootstrapMaps[0]._id.toHexString();
        const page = await dispatchHttp({ route: 'admin_mindmap', path: '/admin/mindmap', json: false });
        const search = await dispatchHttp({
            route: 'admin_mindmap_problem_search',
            path: '/api/mindmap/admin/problems',
            args: { mapId: requestedMapId, q: 'P1' },
            query: { mapId: requestedMapId, q: 'P1' },
        });
        const associations = await dispatchHttp({
            route: 'admin_mindmap_node_problems',
            path: '/api/mindmap/admin/node-problems',
            args: { mapId: requestedMapId, nodeId },
            query: { mapId: requestedMapId, nodeId },
        });
        const write = await dispatchHttp({
            route: 'admin_mindmap_nodes',
            method: 'POST',
            path: '/admin/mindmap/nodes',
            args: { operation: 'delete', payload: JSON.stringify({ id: nodeId, expectedUpdatedAt: STAMP.toISOString() }) },
            body: { operation: 'delete', payload: JSON.stringify({ id: nodeId, expectedUpdatedAt: STAMP.toISOString() }) },
        });
        const mapWrite = await dispatchHttp({
            route: 'admin_mindmap_maps',
            method: 'POST',
            path: '/admin/mindmap/maps',
            args: { operation: 'update', payload: JSON.stringify({ id: requestedMapId, expectedUpdatedAt: STAMP.toISOString(), fields: { title: 'Map' } }) },
            body: { operation: 'update', payload: JSON.stringify({ id: requestedMapId, expectedUpdatedAt: STAMP.toISOString(), fields: { title: 'Map' } }) },
        });

        expect([page.status, search.status, associations.status, write.status, mapWrite.status]).to.deep.equal([403, 403, 403, 403, 403]);
        expect(calls.searchProblems).to.deep.equal([]);
        expect(calls.listProblems).to.deep.equal([]);
        expect(calls.deleteNode).to.deep.equal([]);
        expect(calls.updateMap).to.deep.equal([]);
        expect(calls.loggerWarn).to.have.lengthOf(5);
        for (const warning of calls.loggerWarn) expect(warning.join(' ')).to.include('result=forbidden');
    });

    it('renders the dedicated admin template with the whole tree, course settings, and reference counts', async () => {
        const response = await dispatchHttp({
            route: 'admin_mindmap',
            path: '/admin/mindmap',
            user: makeAdminUser(),
            json: false,
        });
        const hidden = response.body.nodes?.find((node) => node._id === hiddenCourseId.toHexString());

        expect(response.status).to.equal(200);
        expect(response.template).to.equal('admin_mindmap.html');
        expect(response.body.nodes).to.have.lengthOf(bootstrapNodes.length);
        expect(response.body.nodes?.find((node) => node.topic === TOPIC.root)).to.include({ topic: TOPIC.root, parentId: null });
        expect(hidden?.mapId).to.equal(mapId.toHexString());
        expect(hidden?.courseVisibility).to.equal('hidden');
        expect(hidden?.ownerUids).to.deep.equal([TEACHER_ID]);
        expect(response.body.referenceCounts).to.deep.equal(Object.fromEntries(bootstrapNodes.map((node) => [node._id.toHexString(), 0])));
        expect(calls.getReferenceCounts).to.have.lengthOf(1);
    });

    it('keeps the admin workspace open when the requested map id is gone', async () => {
        const staleMapId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
        const response = await dispatchHttp({
            route: 'admin_mindmap',
            path: '/admin/mindmap',
            user: makeAdminUser(),
            json: false,
            args: { map: staleMapId },
            query: { map: staleMapId },
        });

        expect(response.status).to.equal(200);
        expect(response.template).to.equal('admin_mindmap.html');
        expect(response.body.config?._id).to.equal(mapId.toHexString());
        expect(response.body.nodes).to.have.lengthOf(bootstrapNodes.length);
    });

    it('uses the authoritative domain for administrator problem search and association queries', async () => {
        const nodeId = bootstrapNodes[0]._id.toHexString();
        const requestedMapId = bootstrapMaps[0]._id.toHexString();
        const search = await dispatchHttp({
            route: 'admin_mindmap_problem_search',
            path: '/api/mindmap/admin/problems',
            user: makeAdminUser(),
            authoritativeDomainId: 'course-a',
            args: { mapId: requestedMapId, q: 'graph' },
            query: { mapId: requestedMapId, q: 'graph' },
        });
        const associations = await dispatchHttp({
            route: 'admin_mindmap_node_problems',
            path: '/api/mindmap/admin/node-problems',
            user: makeAdminUser(),
            authoritativeDomainId: 'course-a',
            args: { mapId: requestedMapId, nodeId },
            query: { mapId: requestedMapId, nodeId },
        });

        expect(search.status, JSON.stringify(search.body)).to.equal(200);
        expect(associations.status, JSON.stringify(associations.body)).to.equal(200);
        expect(calls.searchProblems[0]).to.deep.equal(['course-a', new ObjectId(requestedMapId), 'graph']);
        expect(calls.listProblems[0]).to.deep.equal(['course-a', new ObjectId(requestedMapId), new ObjectId(nodeId), {}, { includeHidden: true }]);
    });

    it('rejects legacy write fields and removed operations before calling the model', async () => {
        const base = {
            mapId: bootstrapMaps[0]._id.toHexString(),
            expectedMapUpdatedAt: STAMP.toISOString(),
            id: bootstrapNodes[0]._id.toHexString(),
            expectedUpdatedAt: STAMP.toISOString(),
        };
        const legacy = await dispatchHttp({
            route: 'admin_mindmap_nodes',
            method: 'POST',
            path: '/admin/mindmap/nodes',
            user: makeAdminUser(),
            args: { operation: 'update', payload: JSON.stringify({ ...base, fields: { topic: 'x' } }) },
            body: { operation: 'update', payload: JSON.stringify({ ...base, fields: { topic: 'x' } }), tagsCsv: 'forged' },
        });
        const removed = await dispatchHttp({
            route: 'admin_mindmap_nodes',
            method: 'POST',
            path: '/admin/mindmap/nodes',
            user: makeAdminUser(),
            args: { operation: 'setPosition', payload: JSON.stringify(base) },
            body: { operation: 'setPosition', payload: JSON.stringify(base) },
        });

        expect(legacy.status, JSON.stringify(legacy.body)).to.equal(400);
        expect(removed.status).to.equal(405);
        expect(calls.updateNode).to.deep.equal([]);
        expect(calls.loggerWarn).to.have.lengthOf(1);
        expect(routes.has('admin_mindmap_config')).to.equal(false);
    });

    it('parses a strict mutation envelope and returns a complete fresh snapshot', async () => {
        const parent = bootstrapNodes[0];
        const payload = {
            mapId: bootstrapMaps[0]._id.toHexString(),
            expectedMapUpdatedAt: bootstrapMaps[0].updatedAt.toISOString(),
            parentId: parent._id.toHexString(),
            expectedParentUpdatedAt: parent.updatedAt.toISOString(),
            topic: '新节点',
            description: '',
            color: 'sky',
            tags: [],
            problemIds: [],
        };
        const response = await dispatchHttp({
            route: 'admin_mindmap_nodes',
            method: 'POST',
            path: '/admin/mindmap/nodes',
            user: makeAdminUser(),
            authoritativeDomainId: 'course-a',
            args: { operation: 'create', payload: JSON.stringify(payload) },
            body: { operation: 'create', payload: JSON.stringify(payload) },
        });

        expect(response.status, JSON.stringify(response.body)).to.equal(200);
        expect(response.body.ok).to.equal(true);
        expect(response.body.nodes).to.have.lengthOf(bootstrapNodes.length);
        expect(response.body.referenceCounts).to.have.property(parent._id.toHexString(), 0);
        expect(calls.createNode).to.have.lengthOf(1);
        expect(passedActorId((calls.createNode[0][0] as { actor?: unknown }).actor)).to.equal(42);
        expect((calls.createNode[0][0] as { domainId?: string; topic?: string; color?: string }).domainId).to.equal('course-a');
        expect((calls.createNode[0][0] as { topic?: string }).topic).to.equal('新节点');
        expect((calls.createNode[0][0] as { color?: string }).color).to.equal('sky');
        expect((calls.createNode[0][0] as { mapId?: string }).mapId).to.equal(bootstrapMaps[0]._id.toHexString());
        expect((calls.createNode[0][0] as { expectedMapUpdatedAt?: Date }).expectedMapUpdatedAt).to.deep.equal(bootstrapMaps[0].updatedAt);
        expect((calls.createNode[0][0] as { parentId?: string }).parentId).to.equal(parent._id.toHexString());
        expect((calls.createNode[0][0] as { expectedParentUpdatedAt?: Date }).expectedParentUpdatedAt).to.deep.equal(parent.updatedAt);
    });

    it('updates only the merged map title and layout direction', async () => {
        const payload = {
            id: mapId.toHexString(),
            expectedUpdatedAt: STAMP.toISOString(),
            fields: { title: '新知识图谱', layoutDirection: 'DOWN' },
        };
        const response = await dispatchHttp({
            route: 'admin_mindmap_maps',
            method: 'POST',
            path: '/admin/mindmap/maps',
            user: makeAdminUser(),
            authoritativeDomainId: 'course-a',
            args: { operation: 'update', payload: JSON.stringify(payload) },
            body: { operation: 'update', payload: JSON.stringify(payload) },
        });
        const forged = await dispatchHttp({
            route: 'admin_mindmap_maps',
            method: 'POST',
            path: '/admin/mindmap/maps',
            user: makeAdminUser(),
            args: { operation: 'update', payload: JSON.stringify(payload) },
            body: { operation: 'update', payload: JSON.stringify(payload), visibility: 'public' },
        });

        expect(response.status, JSON.stringify(response.body)).to.equal(200);
        expect(calls.updateMap).to.have.lengthOf(1);
        expect((calls.updateMap[0][0] as { patch?: unknown }).patch).to.deep.equal({ title: '新知识图谱', layoutDirection: 'DOWN' });
        expect(passedActorId((calls.updateMap[0][0] as { actor?: unknown }).actor)).to.equal(42);
        expect((calls.updateMap[0][0] as { domainId?: string }).domainId).to.equal('course-a');
        expect(forged.status, JSON.stringify(forged.body)).to.equal(400);
        expect(calls.updateMap).to.have.lengthOf(1);
    });

    it('does not create or delete knowledge maps', async () => {
        const createPayload = { title: '面向对象', rootTopic: 'OOP', layoutDirection: 'DOWN' };
        const deletePayload = { id: mapId.toHexString(), expectedUpdatedAt: STAMP.toISOString() };
        await dispatchHttp({
            route: 'admin_mindmap_maps',
            method: 'POST',
            path: '/admin/mindmap/maps',
            user: makeAdminUser(),
            args: { operation: 'create', payload: JSON.stringify(createPayload) },
            body: { operation: 'create', payload: JSON.stringify(createPayload) },
        });
        await dispatchHttp({
            route: 'admin_mindmap_maps',
            method: 'POST',
            path: '/admin/mindmap/maps',
            user: makeAdminUser(),
            args: { operation: 'delete', payload: JSON.stringify(deletePayload) },
            body: { operation: 'delete', payload: JSON.stringify(deletePayload) },
        });

        expect(calls.createMap).to.deep.equal([]);
        expect(calls.deleteMap).to.deep.equal([]);
    });

    it('saves course node settings for an administrator and rejects everyone else', async () => {
        const payload = {
            nodeId: hiddenCourseId.toHexString(),
            expectedUpdatedAt: STAMP.toISOString(),
            visibility: 'hidden',
            ownerUids: [3, 9],
        };
        const saved = await dispatchHttp({
            route: 'admin_mindmap_course_nodes',
            routePath: '/admin/mindmap/course-nodes',
            method: 'POST',
            path: '/admin/mindmap/course-nodes',
            user: makeAdminUser(),
            args: { operation: 'settings', payload: JSON.stringify(payload) },
            body: { operation: 'settings', payload: JSON.stringify(payload) },
        });
        const denied = await dispatchHttp({
            route: 'admin_mindmap_course_nodes',
            routePath: '/admin/mindmap/course-nodes',
            method: 'POST',
            path: '/admin/mindmap/course-nodes',
            args: { operation: 'settings', payload: JSON.stringify(payload) },
            body: { operation: 'settings', payload: JSON.stringify(payload) },
        });
        const input = calls.setCourseNodeSettings[0]?.[0] as {
            actor?: unknown;
            nodeId?: string;
            visibility?: string;
            ownerUids?: number[];
            expectedUpdatedAt?: Date;
        } | undefined;

        expect(saved.status, JSON.stringify(saved.body)).to.equal(200);
        expect(input?.nodeId).to.equal(hiddenCourseId.toHexString());
        expect(input?.visibility).to.equal('hidden');
        expect(input?.ownerUids).to.deep.equal([3, 9]);
        expect(input?.expectedUpdatedAt).to.deep.equal(STAMP);
        expect(passedActorId(input?.actor)).to.equal(42);
        expect(denied.status).to.equal(403);
        expect(calls.setCourseNodeSettings).to.have.lengthOf(1);
    });

    it('logs a blocked mutation with domain, actor, operation, node, result, and affected count', async () => {
        const node = bootstrapNodes[0];
        mutationFailure = Object.assign(new Error('引用保护阻断'), {
            code: 409,
            mindmapMutationContext: {
                fromParent: 'old-parent',
                toParent: 'new-parent',
                fromIndex: 2,
                toIndex: 0,
                expectedUpdatedAt: node.updatedAt.toISOString(),
                expectedParentUpdatedAt: node.updatedAt.toISOString(),
            },
            params: [
                '引用保护阻断',
                {
                    reason: 'inherited-tags-change',
                    problems: [
                        { domainId: 'system', docId: 1, pid: 'P1' },
                        { domainId: 'course-a', docId: 2, pid: 'C2' },
                    ],
                },
            ],
        });
        const payload = {
            mapId: bootstrapMaps[0]._id.toHexString(),
            expectedMapUpdatedAt: bootstrapMaps[0].updatedAt.toISOString(),
            id: node._id.toHexString(),
            newParentId: node._id.toHexString(),
            targetIndex: 0,
            expectedUpdatedAt: node.updatedAt.toISOString(),
            expectedParentUpdatedAt: node.updatedAt.toISOString(),
        };
        const response = await dispatchHttp({
            route: 'admin_mindmap_nodes',
            method: 'POST',
            path: '/admin/mindmap/nodes',
            user: makeAdminUser(),
            args: { operation: 'move', payload: JSON.stringify(payload) },
            body: { operation: 'move', payload: JSON.stringify(payload) },
        });

        expect(response.status).to.equal(409);
        expect(calls.loggerWarn).to.have.lengthOf(1);
        const serialized = calls.loggerWarn[0].join(' ');
        expect(serialized).to.include('domain=%s');
        expect(serialized).to.include('actor=%d');
        expect(serialized).to.include('map=%s');
        expect(serialized).to.include('operation=%s');
        expect(serialized).to.include('node=%s');
        expect(serialized).to.include('fromParent=%s');
        expect(serialized).to.include('toParent=%s');
        expect(serialized).to.include('fromIndex=%s');
        expect(serialized).to.include('toIndex=%s');
        expect(serialized).to.include('expectedUpdatedAt=%s');
        expect(serialized).to.include('expectedParentUpdatedAt=%s');
        expect(serialized).to.include('result=error');
        expect(serialized).to.include('committed=%s');
        expect(serialized).to.include('affectedProblems=%d');
        expect(calls.loggerWarn[0]).to.include('old-parent');
        expect(calls.loggerWarn[0]).to.include('new-parent');
        expect(calls.loggerWarn[0]).to.include('2');
        expect(calls.loggerWarn[0]).to.include('0');
        expect(calls.loggerWarn[0]).to.include(2);
    });
});
