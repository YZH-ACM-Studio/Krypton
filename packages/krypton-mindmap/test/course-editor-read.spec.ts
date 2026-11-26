import { createRequire } from 'node:module';
import { beforeEach, describe, it } from 'node:test';
import { expect } from 'chai';

// HTTP boundary for GET /mindmap/:nodeId/edit read access. Course bindings are
// ordinary training rows; listCourseNodes does not know about them.
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
}

interface NodePayload {
    _id?: string;
    topic?: string;
    problemIds?: string[];
    tags?: string[];
    parentId?: string | null;
}

interface EditorBody {
    canEdit?: boolean;
    config?: { _id?: string; title?: string; updatedAt?: string };
    courseNode?: CoursePayload;
    nodes?: NodePayload[];
    referenceCounts?: Record<string, number>;
    problems?: unknown[];
    error?: { name?: string };
}

interface StoredDocument {
    domainId: string;
    docType: number;
    kind?: string;
    owner: number;
    maintainer: number[];
    knowledgeCourseNodeId?: MindmapObjectId | string | null;
}

interface RegisteredRoute {
    name: string;
    path: string;
    Handler: new (...args: unknown[]) => unknown;
}

const TOPIC = {
    root: '知识图谱',
    course: '数据结构',
    child: '循环结构',
    otherCourse: '操作系统',
    otherChild: '进程',
} as const;

const DENIED = 'Mindmap course edit denied domain=%s actor=%d node=%s result=forbidden';
const STAMP = new Date('2026-10-21T00:00:00.000Z');
const DOMAIN_ID = 'system';
const RESPONSIBLE = 7;
const MAINTAINER = 8;
const COURSE_OWNER = 9;
const STRANGER = 11;
const PRIV_EDIT_SYSTEM = 1;
const TYPE_TRAINING = 40;
const CHILD_REFERENCE_COUNT = 17;
const COURSE_REFERENCE_COUNT = 4;

const calls = {
    createNode: [] as unknown[][],
    deleteNode: [] as unknown[][],
    loggerWarn: [] as unknown[][],
    moveNode: [] as unknown[][],
    updateNode: [] as unknown[][],
};

let graphNodes: FixtureNode[] = [];
let documents: StoredDocument[] = [];
let mapId = new ObjectId() as MindmapObjectId;
let rootId = new ObjectId() as MindmapObjectId;
let courseId = new ObjectId() as MindmapObjectId;
let childId = new ObjectId() as MindmapObjectId;
let otherCourseId = new ObjectId() as MindmapObjectId;
let otherChildId = new ObjectId() as MindmapObjectId;
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

    warn(...args: unknown[]) {
        calls.loggerWarn.push(args);
    }

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

function makeUser(uid: number) {
    return new FixtureUser(uid, 0, () => false);
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
    return graphNodes
        .filter((node) => node.parentId?.equals(rootId))
        .sort((left, right) => left.order - right.order || left._id.toHexString().localeCompare(right._id.toHexString()))
        .map((node) => courseViewOf(node));
}

async function getMergedMap(): Promise<FixtureMap> {
    return mapDoc;
}

/** The course node above a node, the way the model walks parents. */
async function courseNodeOf(nodeId: MindmapObjectId): Promise<CoursePayload | null> {
    let current = graphNodes.find((node) => node._id.equals(nodeId));
    while (current && current.parentId && !current.parentId.equals(rootId)) {
        const parentId = current.parentId;
        current = graphNodes.find((node) => node._id.equals(parentId));
    }
    return current?.parentId?.equals(rootId) ? courseViewOf(current) : null;
}

async function setCourseNodeSettings(): Promise<CoursePayload> {
    return courseViewOf(graphNodes[1]);
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
        sort() {
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
    };
    return chain;
}

function makeCollection<T extends object>(read: () => T[]) {
    return {
        find(filter: Record<string, unknown> = {}) {
            return cursor(read().filter((item) => matches(item as Record<string, unknown>, filter)));
        },
    };
}

const documentColl = makeCollection(() => documents);

const TrainingModel = {
    getMulti(domainId: string, query: Record<string, unknown> = {}) {
        return documentColl.find({ docType: TYPE_TRAINING, domainId, ...query });
    },
};

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
    async createNode(...args: unknown[]) {
        calls.createNode.push(args);
        return {};
    },
    async deleteNode(...args: unknown[]) {
        calls.deleteNode.push(args);
        return undefined;
    },
    async getKnowledgeMap() {
        return mapDoc;
    },
    async getNodeReferenceCounts() {
        const counts: Record<string, number> = {};
        for (const node of graphNodes) counts[node._id.toHexString()] = 0;
        counts[courseId.toHexString()] = COURSE_REFERENCE_COUNT;
        counts[childId.toHexString()] = CHILD_REFERENCE_COUNT;
        return counts;
    },
    listAllNodes: async (requestedMapId: MindmapObjectId) => graphNodes.filter((node) => node.mapId.equals(requestedMapId)),
    async listProblemsForNode() {
        return [];
    },
    async moveNode(...args: unknown[]) {
        calls.moveNode.push(args);
        return undefined;
    },
    async searchProblemsForAdmin() {
        return [];
    },
    async updateKnowledgeMap() {
        return mapDoc;
    },
    async updateNode(...args: unknown[]) {
        calls.updateNode.push(args);
        return undefined;
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
    ProblemModel: {
        assertProblemAclDomain(_user: unknown, _domainId: string) {},
        canBrowseProblemBank(_user: unknown) {
            return false;
        },
    },
    TrainingModel,
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

const routes = new Map<string, RegisteredRoute>();
applyHandlers({
    Route(name: string, path: string, HandlerClass: RegisteredRoute['Handler']) {
        routes.set(path, { name, path, Handler: HandlerClass });
    },
});

function binding(input: {
    owner: number;
    maintainer?: number[];
    node?: MindmapObjectId | string | null;
    domainId?: string;
    kind?: string;
    omitNode?: boolean;
}): StoredDocument {
    const row: StoredDocument = {
        domainId: input.domainId ?? DOMAIN_ID,
        docType: TYPE_TRAINING,
        owner: input.owner,
        maintainer: input.maintainer ?? [],
    };
    row.kind = input.kind ?? 'course';
    if (!input.omitNode) row.knowledgeCourseNodeId = input.node === undefined ? null : input.node;
    return row;
}

beforeEach(() => {
    for (const entries of Object.values(calls)) entries.length = 0;
    mapId = new ObjectId() as MindmapObjectId;
    rootId = new ObjectId() as MindmapObjectId;
    courseId = new ObjectId() as MindmapObjectId;
    childId = new ObjectId() as MindmapObjectId;
    otherCourseId = new ObjectId() as MindmapObjectId;
    otherChildId = new ObjectId() as MindmapObjectId;
    mapDoc = {
        _id: mapId,
        title: TOPIC.root,
        rootNodeId: rootId,
        visibility: 'public',
        layoutDirection: 'RIGHT',
        createdAt: STAMP,
        updatedAt: STAMP,
    };
    graphNodes = [
        nodeStamp(TOPIC.root, null, 0, { _id: rootId }),
        nodeStamp(TOPIC.course, rootId, 1, { _id: courseId, courseVisibility: 'public', ownerUids: [RESPONSIBLE] }),
        nodeStamp(TOPIC.child, courseId, 2, {
            _id: childId,
            description: '循环说明',
            color: 'sky',
            tags: ['循环'],
            problemIds: ['P1001'],
        }),
        nodeStamp(TOPIC.otherCourse, rootId, 3, { _id: otherCourseId, courseVisibility: 'public', ownerUids: [STRANGER] }),
        nodeStamp(TOPIC.otherChild, otherCourseId, 1, { _id: otherChildId, problemIds: ['P2002'] }),
    ];
    documents = [
        binding({ owner: COURSE_OWNER, maintainer: [MAINTAINER], node: courseId }),
        binding({ owner: STRANGER, node: courseId, domainId: 'other-domain' }),
        binding({ owner: STRANGER, node: courseId, kind: 'problem_set' }),
        binding({ owner: STRANGER, node: otherCourseId }),
        binding({ owner: STRANGER, node: null }),
        binding({ owner: STRANGER, omitNode: true }),
    ];
});

function topicsOf(body: EditorBody | undefined): string[] {
    return (body?.nodes ?? []).map((node) => node.topic ?? '').sort();
}

async function dispatchEditor(input: {
    user: FixtureUser;
    node: MindmapObjectId;
    method?: 'GET' | 'POST';
    operation?: 'create' | 'update' | 'move' | 'delete';
    payload?: Record<string, unknown>;
    problems?: boolean;
}): Promise<{ body: EditorBody; status: number }> {
    const routePath = input.problems ? '/api/mindmap/problems' : input.method === 'POST' ? '/mindmap/:nodeId/nodes' : '/mindmap/:nodeId/edit';
    const found = routes.get(routePath);
    if (!found) expect.fail(`missing route for ${input.method ?? 'GET'}`);
    const nodeHex = input.node.toHexString();
    const problemQuery = { mapId: mapId.toHexString(), nodeId: nodeHex };
    const path = input.problems ? '/api/mindmap/problems' : input.method === 'POST' ? `/mindmap/${nodeHex}/nodes` : `/mindmap/${nodeHex}/edit`;
    const body = input.operation
        ? { operation: input.operation, payload: JSON.stringify(input.payload ?? {}) }
        : {};
    const request = {
        method: (input.method ?? 'GET').toLowerCase(),
        host: 'example.test',
        hostname: 'example.test',
        ip: '127.0.0.1',
        headers: {},
        cookies: {},
        body,
        files: {},
        query: input.problems ? problemQuery : {},
        querystring: '',
        path,
        originalPath: path,
        params: input.problems ? {} : { nodeId: nodeHex },
        referer: '',
        json: true,
        websocket: false,
    };
    const response: { body: EditorBody; status: number } = {
        body: undefined as unknown as EditorBody,
        status: 200,
    };
    const koaContext = {
        method: input.method ?? 'GET',
        params: input.problems ? {} : { nodeId: nodeHex },
        request,
        session: {},
        holdFiles: [],
        HydroContext: {
            args: {
                domainId: DOMAIN_ID,
                nodeId: nodeHex,
                ...(input.problems ? problemQuery : {}),
                ...(input.operation ? { operation: input.operation, payload: JSON.stringify(input.payload ?? {}) } : {}),
            },
            request,
            response,
            UiContext: {},
        },
    };
    const service = {
        activeHandlers: new Map(),
        ctx: {
            async parallel(event: string, handler: { user?: FixtureUser; domain?: { _id: string }; onerror?: (error: { code?: number; name?: string }) => Promise<void> }) {
                if (event !== 'handler/create') return;
                handler.user = input.user;
                handler.domain = { _id: DOMAIN_ID };
                handler.onerror = async (error) => {
                    response.status = error.code || 500;
                    response.body = { error: { name: error.name } };
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
        found.Handler,
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

function openEditor(user: FixtureUser, node: MindmapObjectId = courseId) {
    return dispatchEditor({ user, node });
}

function writePayload(operation: 'create' | 'update' | 'move' | 'delete'): Record<string, unknown> {
    const stamp = STAMP.toISOString();
    const mapHex = mapId.toHexString();
    if (operation === 'create') {
        return {
            mapId: mapHex,
            expectedMapUpdatedAt: stamp,
            parentId: courseId.toHexString(),
            expectedParentUpdatedAt: stamp,
            topic: '新知识点',
            description: '',
            color: 'sky',
            tags: [],
            problemIds: [],
        };
    }
    if (operation === 'update') {
        return {
            mapId: mapHex,
            expectedMapUpdatedAt: stamp,
            id: childId.toHexString(),
            expectedUpdatedAt: stamp,
            fields: { topic: '改名' },
        };
    }
    if (operation === 'move') {
        return {
            mapId: mapHex,
            expectedMapUpdatedAt: stamp,
            id: childId.toHexString(),
            newParentId: courseId.toHexString(),
            targetIndex: 0,
            expectedUpdatedAt: stamp,
            expectedParentUpdatedAt: stamp,
        };
    }
    return {
        mapId: mapHex,
        expectedMapUpdatedAt: stamp,
        id: childId.toHexString(),
        expectedUpdatedAt: stamp,
    };
}

function expectEditorSubtree(body: EditorBody) {
    const child = body.nodes?.find((node) => node.topic === TOPIC.child);
    expect(topicsOf(body)).to.deep.equal([TOPIC.course, TOPIC.child].sort());
    expect(child?.problemIds).to.deep.equal(['P1001']);
    expect(child?.tags).to.deep.equal(['循环']);
    expect(JSON.stringify(body.nodes)).to.not.include('P2002');
    expect(body.referenceCounts?.[courseId.toHexString()]).to.equal(COURSE_REFERENCE_COUNT);
    expect(body.referenceCounts?.[childId.toHexString()]).to.equal(CHILD_REFERENCE_COUNT);
    expect(body.referenceCounts?.[otherChildId.toHexString()]).to.equal(undefined);
    expect(body.courseNode?.id).to.equal(courseId.toHexString());
    expect(body.courseNode?.ownerUids).to.deep.equal([RESPONSIBLE]);
}

function expectSameSnapshot(reader: EditorBody, teacher: EditorBody) {
    expect(reader.nodes).to.deep.equal(teacher.nodes);
    expect(reader.referenceCounts).to.deep.equal(teacher.referenceCounts);
    expect(reader.courseNode).to.deep.equal(teacher.courseNode);
    expect(reader.config).to.deep.equal(teacher.config);
}

function expectDenied(response: { body: EditorBody; status: number }, uid: number, node: MindmapObjectId) {
    expect(response.status).to.equal(403);
    expect(response.body.error?.name).to.equal('PermissionError');
    expect(response.body.nodes).to.equal(undefined);
    expect(response.body.canEdit).to.equal(undefined);
    const denial = calls.loggerWarn.at(-1);
    expect(denial).to.deep.equal([DENIED, DOMAIN_ID, uid, node.toHexString()]);
}

describe('course node editor read access', () => {
    it('returns canEdit true for the responsible teacher', async () => {
        const response = await openEditor(makeUser(RESPONSIBLE));

        expect(response.status).to.equal(200);
        expectEditorSubtree(response.body);
        expect(response.body.canEdit).to.equal(true);
        expect(calls.loggerWarn).to.deep.equal([]);
    });

    it('returns the same snapshot with canEdit false for a course maintainer', async () => {
        const teacher = await openEditor(makeUser(RESPONSIBLE));
        calls.loggerWarn.length = 0;
        const response = await openEditor(makeUser(MAINTAINER));

        expect(teacher.status).to.equal(200);
        expectEditorSubtree(teacher.body);
        expect(response.status).to.equal(200);
        expect(response.body.canEdit).to.equal(false);
        expectSameSnapshot(response.body, teacher.body);
        expectEditorSubtree(response.body);
        expect(calls.loggerWarn).to.deep.equal([]);
    });

    it('returns the same snapshot with canEdit false for the owner of the bound course', async () => {
        const teacher = await openEditor(makeUser(RESPONSIBLE));
        calls.loggerWarn.length = 0;
        const response = await openEditor(makeUser(COURSE_OWNER));

        expect(teacher.status).to.equal(200);
        expectEditorSubtree(teacher.body);
        expect(response.status).to.equal(200);
        expect(response.body.canEdit).to.equal(false);
        expectSameSnapshot(response.body, teacher.body);
        expectEditorSubtree(response.body);
        expect(calls.loggerWarn).to.deep.equal([]);
    });

    it('rejects a teacher who is not tied to this course node', async () => {
        const response = await openEditor(makeUser(STRANGER));

        expectDenied(response, STRANGER, courseId);
        expect(calls.loggerWarn).to.have.lengthOf(1);
        expect(calls.createNode).to.deep.equal([]);
        expect(calls.updateNode).to.deep.equal([]);
        expect(calls.moveNode).to.deep.equal([]);
        expect(calls.deleteNode).to.deep.equal([]);
    });

    it('rejects create update move and delete from the course maintainer', async () => {
        const operations = ['create', 'update', 'move', 'delete'] as const;
        for (const operation of operations) {
            const response = await dispatchEditor({
                user: makeUser(MAINTAINER),
                node: courseId,
                method: 'POST',
                operation,
                payload: writePayload(operation),
            });
            expectDenied(response, MAINTAINER, courseId);
        }

        expect(calls.loggerWarn).to.have.lengthOf(operations.length);
        expect(calls.createNode).to.deep.equal([]);
        expect(calls.updateNode).to.deep.equal([]);
        expect(calls.moveNode).to.deep.equal([]);
        expect(calls.deleteNode).to.deep.equal([]);
    });

    it('rejects node writes from the owner of the bound course', async () => {
        const response = await dispatchEditor({
            user: makeUser(COURSE_OWNER),
            node: courseId,
            method: 'POST',
            operation: 'update',
            payload: writePayload('update'),
        });

        expectDenied(response, COURSE_OWNER, courseId);
        expect(calls.updateNode).to.deep.equal([]);
    });

    it('returns canEdit true for an administrator', async () => {
        const response = await openEditor(makeAdmin());

        expect(response.status).to.equal(200);
        expectEditorSubtree(response.body);
        expect(response.body.canEdit).to.equal(true);
        expect(calls.loggerWarn).to.deep.equal([]);
    });

    it('keeps canEdit true and still accepts a write when the responsible teacher also owns the bound course', async () => {
        const courseBinding = documents.find((row) => row.owner === COURSE_OWNER && row.domainId === DOMAIN_ID && row.kind === 'course');
        if (!courseBinding) expect.fail('missing course binding');
        courseBinding.owner = RESPONSIBLE;
        const read = await openEditor(makeUser(RESPONSIBLE));
        const write = await dispatchEditor({
            user: makeUser(RESPONSIBLE),
            node: courseId,
            method: 'POST',
            operation: 'update',
            payload: writePayload('update'),
        });

        expect(read.status).to.equal(200);
        expect(read.body.canEdit).to.equal(true);
        expectEditorSubtree(read.body);
        expect(write.status).to.equal(200);
        expect(write.body.canEdit).to.equal(true);
        expectEditorSubtree(write.body);
        expect(calls.updateNode).to.have.lengthOf(1);
        expect(calls.loggerWarn).to.deep.equal([]);
    });

    it('returns the hidden course snapshot with canEdit true for the responsible teacher and false for its maintainer', async () => {
        const course = graphNodes.find((node) => node._id.equals(courseId));
        if (!course) expect.fail('missing course node');
        course.courseVisibility = 'hidden';
        const teacher = await openEditor(makeUser(RESPONSIBLE));
        calls.loggerWarn.length = 0;
        const reader = await openEditor(makeUser(MAINTAINER));

        expect(teacher.status).to.equal(200);
        expect(teacher.body.canEdit).to.equal(true);
        expect(teacher.body.courseNode?.visibility).to.equal('hidden');
        expectEditorSubtree(teacher.body);
        expect(reader.status).to.equal(200);
        expect(reader.body.canEdit).to.equal(false);
        expect(reader.body.courseNode?.visibility).to.equal('hidden');
        expectSameSnapshot(reader.body, teacher.body);
        expect(calls.loggerWarn).to.deep.equal([]);
    });

    it('lists problems under a hidden course node for the bound course maintainer and owner only', async () => {
        const course = graphNodes.find((node) => node._id.equals(courseId));
        if (!course) expect.fail('missing course node');
        course.courseVisibility = 'hidden';
        const maintainer = await dispatchEditor({ user: makeUser(MAINTAINER), node: childId, problems: true });
        const owner = await dispatchEditor({ user: makeUser(COURSE_OWNER), node: courseId, problems: true });
        const stranger = await dispatchEditor({ user: makeUser(STRANGER), node: childId, problems: true });

        expect(maintainer.status).to.equal(200);
        expect(maintainer.body.problems).to.deep.equal([]);
        expect(owner.status).to.equal(200);
        expect(owner.body.problems).to.deep.equal([]);
        expect(stranger.status).to.equal(404);
        expect(stranger.body.error?.name).to.equal('NotFoundError');
        expect(stranger.body.problems).to.equal(undefined);
    });

    it('reports a missing course node as not found', async () => {
        const missing = new ObjectId() as MindmapObjectId;
        const response = await openEditor(makeAdmin(), missing);

        expect(response.status).to.equal(404);
        expect(response.body.error?.name).to.equal('NotFoundError');
        expect(response.body.nodes).to.equal(undefined);
        expect(response.body.canEdit).to.equal(undefined);
        expect(calls.loggerWarn).to.deep.equal([]);
    });
});
