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

const calls = {
    assertDomain: [] as any[],
    buildScope: [] as any[],
    canBrowse: [] as any[],
    createMap: [] as any[],
    createNode: [] as any[],
    deleteMap: [] as any[],
    deleteNode: [] as any[],
    getMap: [] as any[],
    getMapUsage: [] as any[],
    getReferenceCounts: [] as any[],
    listProblems: [] as any[],
    loggerError: [] as any[],
    loggerWarn: [] as any[],
    moveNode: [] as any[],
    searchProblems: [] as any[],
    updateMap: [] as any[],
    updateNode: [] as any[],
};
let browseAllowed = false;
let assertFailure: Error | null = null;
let browseFailure: Error | null = null;
let scopeFailure: Error | null = null;
let canonicalScope: Record<string, unknown> = {};
let bootstrapMaps: any[] = [];
let bootstrapNodes: any[] = [];
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

    error(...args: any[]) {
        calls.loggerError.push(args);
    }

    warn(...args: any[]) {
        calls.loggerWarn.push(args);
    }
}

const ProblemModel = {
    assertProblemAclDomain(user: any, domainId: string) {
        calls.assertDomain.push([user, domainId]);
        if (assertFailure) throw assertFailure;
        if (domainId !== 'system') throw new framework.ForbiddenError();
    },
    canBrowseProblemBank(user: any) {
        calls.canBrowse.push(user);
        if (browseFailure) throw browseFailure;
        return browseAllowed;
    },
    buildProblemBankScope(user: any) {
        calls.buildScope.push(user);
        if (scopeFailure) throw scopeFailure;
        return canonicalScope;
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

const modelStub = {
    async createKnowledgeMap(...args: any[]) {
        calls.createMap.push(args);
        if (mutationFailure) throw mutationFailure;
        return bootstrapMaps[0];
    },
    async createNode(...args: any[]) {
        calls.createNode.push(args);
        if (mutationFailure) throw mutationFailure;
        return {};
    },
    async deleteKnowledgeMap(...args: any[]) {
        calls.deleteMap.push(args);
        if (mutationFailure) throw mutationFailure;
    },
    async deleteNode(...args: any[]) {
        calls.deleteNode.push(args);
        if (mutationFailure) throw mutationFailure;
    },
    async getKnowledgeMap(id: any) {
        calls.getMap.push(id);
        return bootstrapMaps.find((map) => map._id.equals(id)) || null;
    },
    async getKnowledgeMapUsage(...args: any[]) {
        calls.getMapUsage.push(args);
        return { nodes: bootstrapNodes.length, problems: 0, courses: 0 };
    },
    async getNodeReferenceCounts(...args: any[]) {
        calls.getReferenceCounts.push(args);
        return Object.fromEntries(bootstrapNodes.map((node) => [node._id.toHexString(), 0]));
    },
    listAllNodes: async (mapId: any) => bootstrapNodes.filter((node) => node.mapId.equals(mapId)),
    listKnowledgeMaps: async (includeHidden = false) => bootstrapMaps.filter((map) => includeHidden || map.visibility === 'public'),
    async listProblemsForNode(...args: any[]) {
        calls.listProblems.push(args);
        return sensitiveProblems;
    },
    async moveNode(...args: any[]) {
        calls.moveNode.push(args);
        if (mutationFailure) throw mutationFailure;
    },
    async searchProblemsForAdmin(...args: any[]) {
        calls.searchProblems.push(args);
        return sensitiveProblems;
    },
    async updateNode(...args: any[]) {
        calls.updateNode.push(args);
        if (mutationFailure) throw mutationFailure;
    },
    async updateKnowledgeMap(...args: any[]) {
        calls.updateMap.push(args);
        if (mutationFailure) throw mutationFailure;
        return bootstrapMaps[0];
    },
};

const hydroojStub = {
    ...framework,
    ForbiddenError: framework.ForbiddenError,
    Handler: framework.Handler,
    NotFoundError: framework.NotFoundError,
    ObjectId,
    param: framework.param,
    PRIV: { PRIV_EDIT_SYSTEM: 1 },
    PrivilegeError,
    ProblemModel,
    Types: framework.Types,
};

const handlerPath = require.resolve('../src/handler.ts');
const modelPath = require.resolve('../src/model.ts');
const previousModelCache = require.cache[modelPath];
const originalLoad = Module._load;

require.cache[modelPath] = {
    id: modelPath,
    filename: modelPath,
    loaded: true,
    exports: modelStub,
} as NodeModule;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (request === 'hydrooj') return hydroojStub;
    if (request === '@hydrooj/utils') return { Logger };
    return originalLoad.call(this, request, parent, isMain);
};

let applyHandlers: (ctx: any) => void;
try {
    delete require.cache[handlerPath];
    ({ applyHandlers } = require(handlerPath));
} finally {
    Module._load = originalLoad;
    if (previousModelCache) require.cache[modelPath] = previousModelCache;
    else delete require.cache[modelPath];
}

const routes = new Map<string, any>();
applyHandlers({
    Route(name: string, _path: string, HandlerClass: any) {
        routes.set(name, HandlerClass);
    },
} as any);

function makeUser() {
    return {
        _id: 42,
        hasPerm: (_permission?: number) => false,
        hasPriv: (_privilege?: number) => false,
    };
}

async function dispatchProblemsApi(user = makeUser(), argsDomainId = 'system', authoritativeDomainId = 'system') {
    const HandlerClass = routes.get('mindmap_api_problems');
    expect(HandlerClass, 'missing mindmap_api_problems route').to.be.a('function');
    const nodeId = new ObjectId();
    const mapId = bootstrapMaps[0]._id as InstanceType<typeof ObjectId>;
    const request = {
        method: 'get',
        host: 'example.test',
        hostname: 'example.test',
        ip: '127.0.0.1',
        headers: {},
        cookies: {},
        body: {},
        files: {},
        query: { mapId: mapId.toHexString(), nodeId: nodeId.toHexString() },
        querystring: `mapId=${mapId.toHexString()}&nodeId=${nodeId.toHexString()}`,
        path: '/api/mindmap/problems',
        originalPath: '/api/mindmap/problems',
        params: {},
        referer: '',
        json: true,
        websocket: false,
    };
    const response = {
        body: undefined as any,
        type: '',
        status: 200,
        template: undefined as string | undefined,
        redirect: undefined as string | undefined,
        attachment() {},
        addHeader() {},
    };
    const args = { domainId: argsDomainId, mapId: mapId.toHexString(), nodeId: nodeId.toHexString() };
    const koaContext: any = {
        method: 'GET',
        params: {},
        request,
        session: {},
        holdFiles: [],
        HydroContext: {
            args,
            request,
            response,
            UiContext: {},
        },
    };
    const service: any = {
        activeHandlers: new Map(),
        ctx: {
            async parallel(event: string, handler: any) {
                if (event === 'handler/create') {
                    handler.user = user;
                    handler.domain = { _id: authoritativeDomainId };
                    handler.onerror = async (error: any) => {
                        response.status = error.code || 500;
                        response.body = { error: { name: error.name, params: error.params } };
                    };
                }
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
    await (framework.WebService.prototype as any).handleHttp.call(service, koaContext, HandlerClass, () => {}, savedContext);
    return { mapId, nodeId, response };
}

async function dispatchMindmapPage(user = makeUser(), authoritativeDomainId = 'system', requestedMapId?: string) {
    const HandlerClass = routes.get('mindmap_main');
    expect(HandlerClass, 'missing mindmap_main route').to.be.a('function');
    const request = {
        method: 'get',
        host: 'example.test',
        hostname: 'example.test',
        ip: '127.0.0.1',
        headers: {},
        cookies: {},
        body: {},
        files: {},
        query: requestedMapId ? { map: requestedMapId } : {},
        querystring: requestedMapId ? `map=${requestedMapId}` : '',
        path: '/mindmap',
        originalPath: '/mindmap',
        params: {},
        referer: '',
        json: false,
        websocket: false,
    };
    const response = {
        body: undefined as any,
        type: '',
        status: 200,
        template: undefined as string | undefined,
        redirect: undefined as string | undefined,
        attachment() {},
        addHeader() {},
    };
    const args = { domainId: authoritativeDomainId, ...(requestedMapId ? { map: requestedMapId } : {}) };
    const koaContext: any = {
        method: 'GET',
        params: {},
        request,
        session: {},
        holdFiles: [],
        HydroContext: {
            args,
            request,
            response,
            UiContext: {},
        },
    };
    const service: any = {
        activeHandlers: new Map(),
        ctx: {
            async parallel(event: string, handler: any) {
                if (event === 'handler/create') {
                    handler.user = user;
                    handler.domain = { _id: authoritativeDomainId };
                    handler.onerror = async (error: any) => {
                        response.status = error.code || 500;
                        response.body = { error: { name: error.name, params: error.params } };
                    };
                }
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
    await (framework.WebService.prototype as any).handleHttp.call(service, koaContext, HandlerClass, () => {}, savedContext);
    return { response };
}

async function dispatchAdminRoute({
    route,
    method = 'GET',
    path,
    user = makeUser(),
    authoritativeDomainId = 'system',
    args = {},
    body = {},
    query = {},
    json = true,
}: {
    route: string;
    method?: 'GET' | 'POST';
    path: string;
    user?: ReturnType<typeof makeUser>;
    authoritativeDomainId?: string;
    args?: Record<string, unknown>;
    body?: Record<string, unknown>;
    query?: Record<string, unknown>;
    json?: boolean;
}) {
    const HandlerClass = routes.get(route);
    expect(HandlerClass, `missing ${route} route`).to.be.a('function');
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
        querystring: new URLSearchParams(query as Record<string, string>).toString(),
        path,
        originalPath: path,
        params: {},
        referer: '',
        json,
        websocket: false,
    };
    const response = {
        body: undefined as any,
        type: '',
        status: 200,
        template: undefined as string | undefined,
        redirect: undefined as string | undefined,
        attachment() {},
        addHeader() {},
    };
    const koaContext: any = {
        method,
        params: {},
        request,
        session: {},
        holdFiles: [],
        HydroContext: { args: { domainId: authoritativeDomainId, ...args }, request, response, UiContext: {} },
    };
    const service: any = {
        activeHandlers: new Map(),
        ctx: {
            async parallel(event: string, handler: any) {
                if (event !== 'handler/create') return;
                handler.user = user;
                handler.domain = { _id: authoritativeDomainId };
                handler.onerror = async (error: any) => {
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
    await (framework.WebService.prototype as any).handleHttp.call(service, koaContext, HandlerClass, () => {}, savedContext);
    return response;
}

function makeAdminUser() {
    return {
        ...makeUser(),
        hasPerm: (_permission?: number): boolean => true,
        hasPriv: (privilege?: number): boolean => privilege === 1,
    };
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
    scopeFailure = null;
    canonicalScope = {};
    mutationFailure = null;
    const mapId = new ObjectId();
    const rootId = new ObjectId();
    bootstrapMaps = [
        {
            _id: mapId,
            title: '公开知识导图',
            rootNodeId: rootId,
            visibility: 'public',
            layoutDirection: 'RIGHT',
            createdAt: new Date('2026-07-16T00:00:00.000Z'),
            updatedAt: new Date('2026-07-16T00:00:00.000Z'),
        },
    ];
    bootstrapNodes = [
        {
            _id: rootId,
            mapId,
            parentId: null,
            topic: '公开根节点',
            description: '公开说明',
            color: 'sky',
            tags: ['SECRET_TAG'],
            problemIds: ['SECRET_PID'],
            order: 0,
            createdAt: new Date('2026-07-16T00:00:00.000Z'),
            updatedAt: new Date('2026-07-16T00:00:00.000Z'),
        },
    ];
});

describe('mindmap page bootstrap metadata boundary', () => {
    it('keeps the public tree but replaces problem metadata with empty arrays without bank capability', async () => {
        const { response } = await dispatchMindmapPage();

        expect(response.status).to.equal(200);
        expect(response.template).to.equal('mindmap_main.html');
        expect(response.body.config).to.include({
            title: '公开知识导图',
            layoutDirection: 'RIGHT',
        });
        expect(response.body.config._id).to.equal(bootstrapMaps[0]._id.toHexString());
        expect(response.body.maps).to.have.lengthOf(1);
        expect(response.body.nodes).to.have.lengthOf(1);
        expect(response.body.nodes[0]).to.include({
            topic: '公开根节点',
            description: '公开说明',
            color: 'sky',
            parentId: null,
        });
        expect(response.body.nodes[0].tags).to.deep.equal([]);
        expect(response.body.nodes[0].problemIds).to.deep.equal([]);
        expectNoProblemDisclosure(response.body);
        expect(calls.loggerError).to.deep.equal([]);
    });

    it('preserves visible tags but never exposes manual problem ids in the public bootstrap', async () => {
        browseAllowed = true;
        canonicalScope = { owner: 42 };

        const { response } = await dispatchMindmapPage();

        expect(response.status).to.equal(200);
        expect(response.body.nodes[0].tags).to.deep.equal(['SECRET_TAG']);
        expect(response.body.nodes[0].problemIds).to.deep.equal([]);
        expect(JSON.stringify(response.body)).not.to.include('SECRET_PID');
        expect(calls.loggerError).to.deep.equal([]);
    });

    it('keeps the public tree redacted and logs when ACL preload evaluation fails', async () => {
        browseAllowed = true;
        assertFailure = new Error('ACL preload unavailable');

        const { response } = await dispatchMindmapPage();

        expect(response.status).to.equal(200);
        expect(response.body.nodes[0]).to.include({ topic: '公开根节点', color: 'sky' });
        expect(response.body.nodes[0].tags).to.deep.equal([]);
        expect(response.body.nodes[0].problemIds).to.deep.equal([]);
        expectNoProblemDisclosure(response.body);
        expect(calls.loggerError).to.have.lengthOf(1);
        expect(calls.loggerError[0].join(' ')).to.include('ACL preload unavailable');
    });

    it('keeps the public tree redacted and logs when the ACL marker belongs to another domain', async () => {
        browseAllowed = true;

        const { response } = await dispatchMindmapPage(makeUser(), 'course-domain');

        expect(response.status).to.equal(200);
        expect(response.body.nodes[0]).to.include({ topic: '公开根节点', color: 'sky' });
        expect(response.body.nodes[0].tags).to.deep.equal([]);
        expect(response.body.nodes[0].problemIds).to.deep.equal([]);
        expectNoProblemDisclosure(response.body);
        expect(calls.loggerError).to.have.lengthOf(1);
    });

    it('never exposes or silently substitutes an explicitly requested hidden map', async () => {
        const hiddenId = new ObjectId();
        bootstrapMaps.push({
            ...bootstrapMaps[0],
            _id: hiddenId,
            rootNodeId: new ObjectId(),
            title: '隐藏导图',
            visibility: 'hidden',
        });

        const { response } = await dispatchMindmapPage(makeUser(), 'system', hiddenId.toHexString());

        expect(response.status).to.equal(404);
        expectNoProblemDisclosure(response.body);
    });
});

describe('mindmap problem enumeration HTTP boundary', () => {
    it('returns 403 without problem-bank capability before calling the model', async () => {
        const { response } = await dispatchProblemsApi();

        expect(response.status).to.equal(403);
        expect(calls.canBrowse).to.have.lengthOf(1);
        expect(calls.buildScope).to.deep.equal([]);
        expect(calls.listProblems).to.deep.equal([]);
        expectNoProblemDisclosure(response.body);
    });

    it('passes the canonical problem-bank scope to the model for an allowed caller', async () => {
        browseAllowed = true;
        canonicalScope = { $or: [{ owner: 42 }, { docId: { $in: [7] } }] };

        const { mapId, nodeId, response } = await dispatchProblemsApi();

        expect(response.status).to.equal(200);
        expect(calls.buildScope).to.have.lengthOf(1);
        expect(calls.listProblems).to.have.lengthOf(1);
        expect(calls.listProblems[0]).to.deep.equal(['system', mapId, nodeId, canonicalScope]);
        expect(response.body).to.deep.equal({ problems: sensitiveProblems });
    });

    it('ignores a forged args domain and queries only the authoritative domain', async () => {
        browseAllowed = true;
        canonicalScope = { owner: 42 };

        const { mapId, nodeId, response } = await dispatchProblemsApi(makeUser(), 'evil', 'system');

        expect(response.status).to.equal(200);
        expect(calls.assertDomain[0][1]).to.equal('system');
        expect(calls.listProblems[0]).to.deep.equal(['system', mapId, nodeId, canonicalScope]);
    });

    it('fails closed when the capability wrapper throws', async () => {
        browseAllowed = true;
        browseFailure = new Error('capability unavailable');

        const { response } = await dispatchProblemsApi();

        expect(response.status).to.equal(500);
        expect(calls.listProblems).to.deep.equal([]);
        expectNoProblemDisclosure(response.body);
    });

    it('fails closed when the scope wrapper throws', async () => {
        browseAllowed = true;
        scopeFailure = new Error('scope unavailable');

        const { response } = await dispatchProblemsApi();

        expect(response.status).to.equal(500);
        expect(calls.listProblems).to.deep.equal([]);
        expectNoProblemDisclosure(response.body);
    });
});

describe('mindmap administrator HTTP boundary', () => {
    it('gates the page, search, association API, and writes with PRIV_EDIT_SYSTEM', async () => {
        const nodeId = bootstrapNodes[0]._id.toHexString();
        const mapId = bootstrapMaps[0]._id.toHexString();
        const page = await dispatchAdminRoute({ route: 'admin_mindmap', path: '/admin/mindmap', json: false });
        const search = await dispatchAdminRoute({
            route: 'admin_mindmap_problem_search',
            path: '/api/mindmap/admin/problems',
            args: { mapId, q: 'P1' },
            query: { mapId, q: 'P1' },
        });
        const associations = await dispatchAdminRoute({
            route: 'admin_mindmap_node_problems',
            path: '/api/mindmap/admin/node-problems',
            args: { mapId, nodeId },
            query: { mapId, nodeId },
        });
        const write = await dispatchAdminRoute({
            route: 'admin_mindmap_nodes',
            method: 'POST',
            path: '/admin/mindmap/nodes',
            args: { operation: 'delete', payload: JSON.stringify({ id: nodeId, expectedUpdatedAt: '2026-07-16T00:00:00.000Z' }) },
            body: { operation: 'delete', payload: JSON.stringify({ id: nodeId, expectedUpdatedAt: '2026-07-16T00:00:00.000Z' }) },
        });
        const mapWrite = await dispatchAdminRoute({
            route: 'admin_mindmap_maps',
            method: 'POST',
            path: '/admin/mindmap/maps',
            args: { operation: 'create', payload: JSON.stringify({ title: 'Map', rootTopic: 'Root' }) },
            body: { operation: 'create', payload: JSON.stringify({ title: 'Map', rootTopic: 'Root' }) },
        });

        expect([page.status, search.status, associations.status, write.status, mapWrite.status]).to.deep.equal([403, 403, 403, 403, 403]);
        expect(calls.searchProblems).to.deep.equal([]);
        expect(calls.listProblems).to.deep.equal([]);
        expect(calls.deleteNode).to.deep.equal([]);
        expect(calls.loggerWarn).to.have.lengthOf(5);
        for (const warning of calls.loggerWarn) expect(warning.join(' ')).to.include('result=forbidden');
    });

    it('renders the dedicated admin template with a reference-aware snapshot', async () => {
        const response = await dispatchAdminRoute({
            route: 'admin_mindmap',
            path: '/admin/mindmap',
            user: makeAdminUser(),
            json: false,
        });

        expect(response.status).to.equal(200);
        expect(response.template).to.equal('admin_mindmap.html');
        expect(response.body.nodes[0]).to.include({ topic: '公开根节点', parentId: null });
        expect(response.body.nodes[0].mapId).to.equal(bootstrapMaps[0]._id.toHexString());
        expect(response.body.maps[0].usage).to.deep.equal({ nodes: 1, problems: 0, courses: 0 });
        expect(response.body.nodes[0]._id).to.equal(bootstrapNodes[0]._id.toHexString());
        expect(response.body.referenceCounts).to.deep.equal({ [bootstrapNodes[0]._id.toHexString()]: 0 });
        expect(calls.getReferenceCounts).to.have.lengthOf(1);
    });

    it('uses the authoritative domain for administrator problem search and association queries', async () => {
        const nodeId = bootstrapNodes[0]._id.toHexString();
        const mapId = bootstrapMaps[0]._id.toHexString();
        const search = await dispatchAdminRoute({
            route: 'admin_mindmap_problem_search',
            path: '/api/mindmap/admin/problems',
            user: makeAdminUser(),
            authoritativeDomainId: 'course-a',
            args: { mapId, q: 'graph' },
            query: { mapId, q: 'graph' },
        });
        const associations = await dispatchAdminRoute({
            route: 'admin_mindmap_node_problems',
            path: '/api/mindmap/admin/node-problems',
            user: makeAdminUser(),
            authoritativeDomainId: 'course-a',
            args: { mapId, nodeId },
            query: { mapId, nodeId },
        });

        expect(search.status, JSON.stringify(search.body)).to.equal(200);
        expect(associations.status, JSON.stringify(associations.body)).to.equal(200);
        expect(calls.searchProblems[0]).to.deep.equal(['course-a', new ObjectId(mapId), 'graph']);
        expect(calls.listProblems[0]).to.deep.equal(['course-a', new ObjectId(mapId), new ObjectId(nodeId), {}, { includeHidden: true }]);
    });

    it('rejects legacy write fields and removed operations before calling the model', async () => {
        const base = {
            mapId: bootstrapMaps[0]._id.toHexString(),
            expectedMapUpdatedAt: '2026-07-16T00:00:00.000Z',
            id: bootstrapNodes[0]._id.toHexString(),
            expectedUpdatedAt: '2026-07-16T00:00:00.000Z',
        };
        const legacy = await dispatchAdminRoute({
            route: 'admin_mindmap_nodes',
            method: 'POST',
            path: '/admin/mindmap/nodes',
            user: makeAdminUser(),
            args: { operation: 'update', payload: JSON.stringify({ ...base, fields: { topic: 'x' } }) },
            body: { operation: 'update', payload: JSON.stringify({ ...base, fields: { topic: 'x' } }), tagsCsv: 'forged' },
        });
        const removed = await dispatchAdminRoute({
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
        const response = await dispatchAdminRoute({
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
        expect(response.body.nodes).to.have.lengthOf(1);
        expect(response.body.referenceCounts).to.have.property(parent._id.toHexString(), 0);
        expect(calls.createNode).to.have.lengthOf(1);
        expect(calls.createNode[0][0]).to.deep.include({ domainId: 'course-a', actor: 42, topic: '新节点', color: 'sky' });
        expect(calls.createNode[0][0].mapId).to.equal(bootstrapMaps[0]._id.toHexString());
        expect(calls.createNode[0][0].expectedMapUpdatedAt).to.deep.equal(bootstrapMaps[0].updatedAt);
        expect(calls.createNode[0][0].parentId).to.equal(parent._id.toHexString());
        expect(calls.createNode[0][0].expectedParentUpdatedAt).to.deep.equal(parent.updatedAt);
    });

    it('creates maps through a strict administrator-only map envelope', async () => {
        const payload = { title: '面向对象', rootTopic: 'OOP', layoutDirection: 'DOWN' };
        const response = await dispatchAdminRoute({
            route: 'admin_mindmap_maps',
            method: 'POST',
            path: '/admin/mindmap/maps',
            user: makeAdminUser(),
            authoritativeDomainId: 'course-a',
            args: { operation: 'create', payload: JSON.stringify(payload) },
            body: { operation: 'create', payload: JSON.stringify(payload) },
        });

        expect(response.status, JSON.stringify(response.body)).to.equal(200);
        expect(calls.createMap).to.have.lengthOf(1);
        expect(calls.createMap[0][0]).to.deep.equal({ domainId: 'course-a', actor: 42, ...payload });
        expect(response.body.maps).to.have.lengthOf(1);

        const forged = await dispatchAdminRoute({
            route: 'admin_mindmap_maps',
            method: 'POST',
            path: '/admin/mindmap/maps',
            user: makeAdminUser(),
            args: { operation: 'create', payload: JSON.stringify(payload) },
            body: { operation: 'create', payload: JSON.stringify(payload), visibility: 'public' },
        });
        expect(forged.status, JSON.stringify(forged.body)).to.equal(400);
        expect(calls.createMap).to.have.lengthOf(1);
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

        const response = await dispatchAdminRoute({
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
