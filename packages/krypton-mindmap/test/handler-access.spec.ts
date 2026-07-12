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
    listProblems: [] as any[],
    loggerError: [] as any[],
};
let browseAllowed = false;
let assertFailure: Error | null = null;
let browseFailure: Error | null = null;
let scopeFailure: Error | null = null;
let canonicalScope: Record<string, unknown> = {};
let bootstrapNodes: any[] = [];

class Logger {
    name: string;

    constructor(name: string) {
        this.name = name;
    }

    error(...args: any[]) {
        calls.loggerError.push(args);
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
    clearAllPositions: async () => undefined,
    createNode: async () => ({}),
    deleteNodeRecursive: async () => 0,
    getConfig: async () => ({
        title: '公开知识导图',
        rootNodeId: bootstrapNodes[0]?._id || null,
        layoutDirection: 'RIGHT',
    }),
    listAllNodes: async () => bootstrapNodes,
    async listProblemsForNode(...args: any[]) {
        calls.listProblems.push(args);
        return sensitiveProblems;
    },
    moveNode: async () => undefined,
    setConfig: async () => undefined,
    setNodePosition: async () => undefined,
    updateNode: async () => undefined,
};

const hydroojStub = {
    ...framework,
    ForbiddenError: framework.ForbiddenError,
    Handler: framework.Handler,
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
        hasPerm: () => false,
        hasPriv: () => false,
    };
}

async function dispatchProblemsApi(user = makeUser(), argsDomainId = 'system', authoritativeDomainId = 'system') {
    const HandlerClass = routes.get('mindmap_api_problems');
    expect(HandlerClass, 'missing mindmap_api_problems route').to.be.a('function');
    const nodeId = new ObjectId();
    const request = {
        method: 'get',
        host: 'example.test',
        hostname: 'example.test',
        ip: '127.0.0.1',
        headers: {},
        cookies: {},
        body: {},
        files: {},
        query: { nodeId: nodeId.toHexString() },
        querystring: `nodeId=${nodeId.toHexString()}`,
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
    const args = { domainId: argsDomainId, nodeId: nodeId.toHexString() };
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
    return { nodeId, response };
}

async function dispatchMindmapPage(user = makeUser(), authoritativeDomainId = 'system') {
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
        query: {},
        querystring: '',
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
    const args = { domainId: authoritativeDomainId };
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
    bootstrapNodes = [
        {
            _id: new ObjectId(),
            parentId: null,
            topic: '公开根节点',
            description: '公开说明',
            color: 'sky',
            tags: ['SECRET_TAG'],
            problemIds: ['SECRET_PID'],
            order: 0,
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

    it('preserves real node tags and problem ids for a matching-domain bank browser', async () => {
        browseAllowed = true;

        const { response } = await dispatchMindmapPage();

        expect(response.status).to.equal(200);
        expect(response.body.nodes[0].tags).to.deep.equal(['SECRET_TAG']);
        expect(response.body.nodes[0].problemIds).to.deep.equal(['SECRET_PID']);
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

        const { nodeId, response } = await dispatchProblemsApi();

        expect(response.status).to.equal(200);
        expect(calls.buildScope).to.have.lengthOf(1);
        expect(calls.listProblems).to.have.lengthOf(1);
        expect(calls.listProblems[0]).to.deep.equal(['system', nodeId, canonicalScope]);
        expect(response.body).to.deep.equal({ problems: sensitiveProblems });
    });

    it('ignores a forged args domain and queries only the authoritative domain', async () => {
        browseAllowed = true;
        canonicalScope = { owner: 42 };

        const { nodeId, response } = await dispatchProblemsApi(makeUser(), 'evil', 'system');

        expect(response.status).to.equal(200);
        expect(calls.assertDomain[0][1]).to.equal('system');
        expect(calls.listProblems[0]).to.deep.equal(['system', nodeId, canonicalScope]);
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
