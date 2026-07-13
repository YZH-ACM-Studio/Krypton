import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {} };

const PERM = {
    PERM_CREATE_PROBLEM: 1n,
    PERM_EDIT_PROBLEM: 2n,
    PERM_VIEW_PROBLEM: 4n,
    PERM_VIEW_PROBLEM_HIDDEN: 8n,
};

class TestPermissionError extends Error {
    name = 'PermissionError';
    params: unknown[];
    status = 403;

    constructor(...params: unknown[]) {
        super('permission denied');
        this.params = params;
    }
}

const calls = {
    aggregates: [] as any[],
    auth: [] as any[],
    edits: [] as any[],
    errors: [] as any[],
    events: [] as string[],
    gets: [] as any[],
    getMulti: [] as any[],
    loads: [] as any[],
    maintain: [] as any[],
    oplogs: [] as any[],
    refresh: [] as any[],
};
let aggregateRows: any[] = [];
let editError: Error | null = null;
let getDocs = new Map<number, any>();
let listDocs: any[] = [];
let tokenUser: any;
let tokenDocDomainId = 'system';

function cursor(docs: any[]) {
    return {
        async toArray() {
            return docs;
        },
    };
}

function buildScope(user: any) {
    const liveLock = { 'aclMutationLocks.uid': { $ne: user._id } };
    if (user.admin) {
        return user._aclFencedPids.size ? { $and: [{ docId: { $nin: [...user._aclFencedPids].sort((a, b) => a - b) } }, liveLock] } : liveLock;
    }
    const maintained = [...user._maintainedPids].filter((pid: number) => !user._aclFencedPids.has(pid)).sort((a: number, b: number) => a - b);
    const ownerScope = { $and: [{ owner: user._id }, { authoringMode: { $ne: 'managed' } }] };
    const authorScope = maintained.length
        ? {
              $or: [ownerScope, { $and: [{ docId: { $in: maintained } }, { maintainer: user._id }] }],
          }
        : ownerScope;
    return user._aclFencedPids.size
        ? { $and: [authorScope, { docId: { $nin: [...user._aclFencedPids].sort((a, b) => a - b) } }, liveLock] }
        : { $and: [authorScope, liveLock] };
}

const problemStub = {
    buildProblemBankScope: buildScope,
    canBrowseProblemBank: (user: any) => user._problemAclLoaded === true && user.hasPerm(PERM.PERM_CREATE_PROBLEM),
    canMaintainProblem(user: any, pdoc: any) {
        calls.maintain.push({ user, pdoc });
        calls.events.push(`maintain:${pdoc.docId}`);
        return (
            user._problemAclLoaded === true &&
            user._problemAclDomainId === pdoc.domainId &&
            !user._aclFencedPids.has(pdoc.docId) &&
            (user.admin || pdoc.owner === user._id || user._maintainedPids.has(pdoc.docId))
        );
    },
    async edit(domainId: string, docId: number, _patch: unknown) {
        calls.events.push(`raw-edit:${docId}`);
        throw new Error('raw problem.edit is forbidden for tagger writes');
    },
    async editAuthorized(domainId: string, docId: number, patch: unknown, actor: any) {
        calls.edits.push({ domainId, docId, patch });
        calls.events.push(`editAuthorized:${docId}`);
        if (editError) throw editError;
        return { domainId, docId, ...(patch as any), actor };
    },
    async refreshProblemAcl(user: any, domainId: string) {
        calls.refresh.push({ user, domainId });
        const loaded = await (global as any).Hydro.model.permits.loadAclForUser(domainId, user._id);
        Object.assign(user, {
            _permitPids: loaded.permitPids,
            _authoredPids: loaded.authoredPids,
            _maintainedPids: loaded.maintainedPids,
            _aclFencedPids: loaded.fencedPids,
            _problemAclDomainId: domainId,
            _problemAclLoaded: true,
        });
    },
    async get(domainId: string, docId: number, projection: unknown) {
        calls.gets.push({ domainId, docId, projection });
        return getDocs.get(docId) || null;
    },
    getMulti(domainId: string, query: unknown, projection: unknown) {
        calls.getMulti.push({ domainId, query: structuredClone(query), projection });
        return cursor(listDocs);
    },
};

const documentStub = {
    TYPE_PROBLEM: 10,
    coll: {
        aggregate(pipeline: unknown[]) {
            calls.aggregates.push(structuredClone(pipeline));
            return cursor(aggregateRows);
        },
    },
};

function noopDecorator() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}

class HandlerStub {}
class TestLogger {
    error(...args: unknown[]) {
        calls.errors.push(args);
    }
}

const hydroojStub = {
    Handler: HandlerStub,
    OplogModel: {
        async log(...args: unknown[]) {
            calls.oplogs.push(args);
        },
    },
    param: noopDecorator,
    PERM,
    PermissionError: TestPermissionError,
    Types: { Any: () => ({}) },
};

async function requireAuthTokenStub(handler: any, channel: string) {
    calls.auth.push({ handler, channel });
    handler.user = tokenUser;
    return { channels: [channel], doc: { uid: tokenUser._id, domainId: tokenDocDomainId } };
}

const taggerPath = require.resolve('../src/handler/tagger.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (request === 'hydrooj') return hydroojStub;
    if (request === '../lib/auth-token') return { requireAuthToken: requireAuthTokenStub };
    if (request === '../logger') return { Logger: TestLogger };
    if (request === '../model/document') return documentStub;
    if (request === '../model/problem') return problemStub;
    if (request === '../model/system') {
        return { get: (key: string) => (key === 'serviceToken.tagger.domain' ? 'system' : {}) };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let taggerModule: typeof import('../src/handler/tagger');
try {
    delete require.cache[taggerPath];
    taggerModule = require(taggerPath);
} finally {
    Module._load = originalLoad;
}

const routes: Record<string, any> = {};
void taggerModule.apply({
    Route(name: string, _path: string, HandlerClass: any) {
        routes[name] = HandlerClass;
    },
} as any);

function makeUser(
    uid: number,
    perms: bigint[] = [PERM.PERM_CREATE_PROBLEM, PERM.PERM_EDIT_PROBLEM, PERM.PERM_VIEW_PROBLEM, PERM.PERM_VIEW_PROBLEM_HIDDEN],
    overrides: Record<string, unknown> = {},
) {
    const allowed = new Set(perms);
    return {
        _id: uid,
        uname: `user-${uid}`,
        admin: false,
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => allowed.has(perm)),
        ...overrides,
    } as any;
}

function makeHandler(routeName: string) {
    const handler = new routes[routeName]();
    Object.assign(handler, {
        domain: { _id: 'forged-http-domain' },
        request: { headers: { 'x-service-token': 'kat_test' } },
        response: { body: {} },
        user: makeUser(0, [], {
            _permitPids: new Set([999]),
            _authoredPids: new Set([999]),
            _maintainedPids: new Set([999]),
            _aclFencedPids: new Set([999]),
            _problemAclDomainId: 'forged-http-domain',
            _problemAclLoaded: true,
        }),
        checkPerm(permission: bigint) {
            if (!this.user.hasPerm(permission)) throw new TestPermissionError(permission);
        },
    });
    return handler as any;
}

function installAclLoader(
    load: (domainId: string, uid: number) => Promise<any> = async () => ({
        permitPids: new Set([7, 9]),
        authoredPids: new Set(),
        maintainedPids: new Set([7]),
        fencedPids: new Set([9]),
    }),
) {
    (global as any).Hydro.model.permits = {
        async loadAclForUser(domainId: string, uid: number) {
            calls.loads.push({ domainId, uid });
            return load(domainId, uid);
        },
    };
}

async function captureFailure(run: () => Promise<unknown>) {
    try {
        await run();
        return null;
    } catch (error) {
        return error as any;
    }
}

beforeEach(() => {
    for (const values of Object.values(calls)) values.length = 0;
    aggregateRows = [];
    editError = null;
    getDocs = new Map();
    listDocs = [];
    tokenDocDomainId = 'system';
    tokenUser = makeUser(42, undefined, {
        _permitPids: new Set([999]),
        _authoredPids: new Set([999]),
        _maintainedPids: new Set([999]),
        _aclFencedPids: new Set([999]),
        _problemAclDomainId: 'stale-domain',
        _problemAclLoaded: true,
    });
    installAclLoader();
});

describe('P2.11 tagger token-user ACL preload', () => {
    it('logs and returns 403 before ACL load or data access when the token domain differs from the configured domain', async () => {
        tokenDocDomainId = 'other-domain';
        const handler = makeHandler('tagger_problems');

        const error = await captureFailure(() => handler.prepare());

        expect(error).to.be.instanceOf(TestPermissionError);
        expect(error.status).to.equal(403);
        expect(calls.errors).to.have.lengthOf(1);
        expect(calls.loads).to.deep.equal([]);
        expect(calls.gets).to.deep.equal([]);
        expect(calls.getMulti).to.deep.equal([]);
        expect(calls.aggregates).to.deep.equal([]);
        expect(calls.edits).to.deep.equal([]);
        expect(tokenUser._problemAclLoaded).to.equal(false);
        expect([...tokenUser._permitPids]).to.deep.equal([]);
        expect([...tokenUser._maintainedPids]).to.deep.equal([]);
        expect([...tokenUser._aclFencedPids]).to.deep.equal([]);
    });

    it('replaces every stale ACL marker with one snapshot loaded for the configured tagger domain', async () => {
        const handler = makeHandler('tagger_problems');

        await handler.prepare();

        expect(handler.user).to.equal(tokenUser);
        expect(calls.loads).to.deep.equal([{ domainId: 'system', uid: 42 }]);
        expect([...handler.user._permitPids]).to.deep.equal([7, 9]);
        expect([...handler.user._maintainedPids]).to.deep.equal([7]);
        expect([...handler.user._aclFencedPids]).to.deep.equal([9]);
        expect(handler.user._problemAclDomainId).to.equal('system');
        expect(handler.user._problemAclLoaded).to.equal(true);
    });

    it('logs ERROR, clears stale state, and returns 403 when the permits model is missing', async () => {
        delete (global as any).Hydro.model.permits;
        const handler = makeHandler('tagger_problems');

        const error = await captureFailure(() => handler.prepare());

        expect(error).to.be.instanceOf(TestPermissionError);
        expect(error.status).to.equal(403);
        expect(calls.errors).to.have.lengthOf(1);
        expect([...tokenUser._permitPids]).to.deep.equal([]);
        expect([...tokenUser._maintainedPids]).to.deep.equal([]);
        expect([...tokenUser._aclFencedPids]).to.deep.equal([]);
        expect(tokenUser._problemAclDomainId).to.equal(undefined);
        expect(tokenUser._problemAclLoaded).to.equal(false);
    });

    it('logs ERROR, keeps a deny snapshot, and returns 403 when ACL loading fails', async () => {
        installAclLoader(async () => {
            throw new Error('acl database unavailable');
        });
        const handler = makeHandler('tagger_problems');

        const error = await captureFailure(() => handler.prepare());

        expect(error).to.be.instanceOf(TestPermissionError);
        expect(error.status).to.equal(403);
        expect(calls.errors).to.have.lengthOf(1);
        expect(tokenUser._problemAclLoaded).to.equal(false);
        expect([...tokenUser._permitPids]).to.deep.equal([]);
        expect([...tokenUser._maintainedPids]).to.deep.equal([]);
        expect([...tokenUser._aclFencedPids]).to.deep.equal([]);
    });
});

describe('P2.11 tagger enumeration gates and scopes', () => {
    it('returns 403 before problems, vocab, audit, or retag can query when CREATE is absent', async () => {
        tokenUser = makeUser(42, [PERM.PERM_EDIT_PROBLEM, PERM.PERM_VIEW_PROBLEM, PERM.PERM_VIEW_PROBLEM_HIDDEN]);
        for (const routeName of ['tagger_problems', 'tagger_vocab', 'tagger_audit', 'tagger_retag']) {
            const handler = makeHandler(routeName);

            await handler.prepare();

            const error = await captureFailure(() => (routeName === 'tagger_retag' ? handler.post({}, ['old'], 'new', false) : handler.get()));
            expect(error).to.be.instanceOf(TestPermissionError);
            expect(error.params).to.deep.equal([PERM.PERM_CREATE_PROBLEM]);
        }
        expect(calls.getMulti).to.deep.equal([]);
        expect(calls.aggregates).to.deep.equal([]);
        expect(calls.edits).to.deep.equal([]);
    });

    it('pushes owner plus active-maintainer scope into every list and aggregate query', async () => {
        const scope = {
            $and: [
                {
                    $or: [{ $and: [{ owner: 42 }, { authoringMode: { $ne: 'managed' } }] }, { $and: [{ docId: { $in: [7] } }, { maintainer: 42 }] }],
                },
                { docId: { $nin: [9] } },
                { 'aclMutationLocks.uid': { $ne: 42 } },
            ],
        };

        const problems = makeHandler('tagger_problems');
        await problems.prepare();
        await problems.get();
        const vocab = makeHandler('tagger_vocab');
        await vocab.prepare();
        await vocab.get();
        const audit = makeHandler('tagger_audit');
        await audit.prepare();
        await audit.get();
        const retag = makeHandler('tagger_retag');
        await retag.prepare();
        await retag.post({}, ['old'], 'new', true);

        expect(calls.getMulti.map(({ query }) => query)).to.deep.equal([
            { $and: [scope, { hidden: { $ne: true } }] },
            scope,
            { $and: [scope, { tag: { $in: ['old'] }, hidden: { $ne: true } }] },
        ]);
        expect(calls.aggregates[0][0]).to.deep.equal({
            $match: {
                domainId: 'system',
                docType: documentStub.TYPE_PROBLEM,
                $and: [scope, { hidden: { $ne: true } }],
            },
        });
    });

    it('lets an administrator retain an all-domain scope', async () => {
        tokenUser = makeUser(1, undefined, { admin: true });
        installAclLoader(async () => ({
            permitPids: new Set(),
            authoredPids: new Set(),
            maintainedPids: new Set(),
            fencedPids: new Set(),
        }));
        const handler = makeHandler('tagger_audit');
        await handler.prepare();

        await handler.get();

        expect(calls.getMulti[0].query).to.deep.equal({
            'aclMutationLocks.uid': { $ne: 1 },
        });
    });

    it('reloads durable ACL immediately before an enumeration query instead of using the prepare snapshot', async () => {
        let load = 0;
        installAclLoader(async () => {
            load++;
            return load === 1
                ? { permitPids: new Set([7]), authoredPids: new Set(), maintainedPids: new Set([7]), fencedPids: new Set() }
                : { permitPids: new Set(), authoredPids: new Set(), maintainedPids: new Set(), fencedPids: new Set() };
        });
        const handler = makeHandler('tagger_problems');
        await handler.prepare();

        await handler.get();

        expect(calls.loads).to.have.lengthOf(2);
        expect(calls.getMulti[0].query).to.deep.equal({
            $and: [
                {
                    $and: [{ $and: [{ owner: 42 }, { authoringMode: { $ne: 'managed' } }] }, { 'aclMutationLocks.uid': { $ne: 42 } }],
                },
                { hidden: { $ne: true } },
            ],
        });
    });
});

describe('P2.11 tagger mutation gates', () => {
    it('makes missing and unauthorized apply items indistinguishable and performs zero writes', async () => {
        getDocs.set(8, {
            domainId: 'system',
            docId: 8,
            owner: 99,
            pid: 'P8',
            title: 'old',
            tag: [],
            maintainer: [42],
        });
        const handler = makeHandler('tagger_apply');
        await handler.prepare();

        await handler.post({}, [
            { docId: 404, title: 'missing' },
            { docId: 8, title: 'legacy maintainer must not authorize' },
        ]);

        expect(handler.response.body.results).to.deep.equal([
            { docId: 404, ok: false, error: 'not_found' },
            { docId: 8, ok: false, error: 'not_found' },
        ]);
        expect(calls.edits).to.deep.equal([]);
    });

    it('uses the atomic authorized edit entrypoint for an allowed apply item', async () => {
        getDocs.set(7, {
            domainId: 'system',
            docId: 7,
            owner: 42,
            pid: 'P7',
            title: 'old',
            tag: [],
        });
        const handler = makeHandler('tagger_apply');
        await handler.prepare();

        await handler.post({}, [{ docId: 7, title: 'new' }]);

        expect(calls.edits).to.deep.equal([
            {
                domainId: 'system',
                docId: 7,
                patch: { title: 'new' },
            },
        ]);
        expect(calls.events).to.deep.equal(['maintain:7', 'editAuthorized:7']);
    });

    it('uses the atomic authorized edit entrypoint for every retag write', async () => {
        listDocs = [
            { domainId: 'system', docId: 7, owner: 99, pid: 'P7', tag: ['old'] },
            { domainId: 'system', docId: 10, owner: 42, pid: 'P10', tag: ['old'] },
        ];
        installAclLoader(async () => ({
            permitPids: new Set([7]),
            authoredPids: new Set(),
            maintainedPids: new Set([7]),
            fencedPids: new Set(),
        }));
        const handler = makeHandler('tagger_retag');
        await handler.prepare();

        await handler.post({}, ['old'], 'new', false);

        expect(calls.events).to.deep.equal(['editAuthorized:7', 'editAuthorized:10']);
    });

    it('logs and propagates a retag database write failure instead of reporting partial success', async () => {
        listDocs = [{ domainId: 'system', docId: 7, owner: 42, pid: 'P7', tag: ['old'] }];
        editError = new Error('mongo write failed');
        const handler = makeHandler('tagger_retag');
        await handler.prepare();

        const error = await captureFailure(() => handler.post({}, ['old'], 'new', false));

        expect(error).to.equal(editError);
        expect(calls.errors).to.have.lengthOf(1);
        expect(calls.oplogs).to.deep.equal([]);
        expect(handler.response.body).to.deep.equal({});
    });
});
