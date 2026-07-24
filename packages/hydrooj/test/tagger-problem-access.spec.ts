import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';
import { ProblemTagConflictError } from '../src/error';
import { resolveProblemKnowledgeNodeIds } from '../src/lib/problem-tag-canonical';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {} };

const PERM = {
    PERM_CREATE_PROBLEM: 1n,
    PERM_EDIT_PROBLEM: 2n,
    PERM_VIEW_PROBLEM: 4n,
    PERM_VIEW_PROBLEM_HIDDEN: 8n,
};

const MAP_A = '111111111111111111111111';
const MAP_B = '222222222222222222222222';
const ROOT_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const NODE_A = 'aaaaaaaaaaaaaaaaaaaaaaab';
const ROOT_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const NODE_B = 'bbbbbbbbbbbbbbbbbbbbbbbc';

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
    applies: [] as any[],
    aggregates: [] as any[],
    auth: [] as any[],
    edits: [] as any[],
    errors: [] as any[],
    events: [] as string[],
    gets: [] as any[],
    getMulti: [] as any[],
    loads: [] as any[],
    namespaceLoads: [] as any[],
    maintain: [] as any[],
    mindmapFinds: [] as any[],
    mindmapLists: [] as any[],
    oplogs: [] as any[],
    refresh: [] as any[],
    previews: [] as any[],
};
let aggregateRows: any[] = [];
let editError: Error | null = null;
let getDocs = new Map<number, any>();
let listDocs: any[] = [];
let mindmapDocs: any[] = [];
let mindmapMaps: any[] = [];
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
    assertProblemAclDomain(user: any, domainId: string) {
        if (
            user._problemAclLoaded !== true ||
            user._problemAclDomainId !== domainId ||
            user._pidNamespaceAclLoaded !== true ||
            user._pidNamespaceAclDomainId !== domainId
        ) {
            throw new TestPermissionError(PERM.PERM_CREATE_PROBLEM);
        }
    },
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
    canEditProblemTags(user: any, pdoc: any) {
        calls.events.push(`tag:${pdoc.docId}`);
        return (
            user._problemAclLoaded === true &&
            user._problemAclDomainId === pdoc.domainId &&
            !user._aclFencedPids.has(pdoc.docId) &&
            (user.admin || pdoc.owner === user._id || user._maintainedPids.has(pdoc.docId) || user._tagContributionPids.has(pdoc.docId))
        );
    },
    async edit(domainId: string, docId: number, _patch: unknown) {
        calls.events.push(`raw-edit:${docId}`);
        throw new Error('raw problem.edit is forbidden for tagger writes');
    },
    async editAuthorized(domainId: string, docId: number, patch: unknown, actor: any, requestedUnset: unknown = {}, options: unknown = {}) {
        calls.edits.push({ domainId, docId, patch, requestedUnset, options });
        calls.events.push(`editAuthorized:${docId}`);
        if (editError) throw editError;
        return { domainId, docId, ...(patch as any), actor };
    },
    async applyProgrammingTagNormalization(input: any) {
        calls.applies.push(input);
        if (editError) throw editError;
        const current = getDocs.get(input.pid);
        const preview = await previewProgrammingTagNormalizationStub({
            domainId: input.domainId,
            docId: input.pid,
            currentTags: current?.tag || [],
            currentKnowledgeMapId: current?.knowledgeMapId,
            currentKnowledgeNodeIds: resolveProblemKnowledgeNodeIds(current || {}, `problem ${input.pid}`),
            targetKnowledgeMapId: input.targetKnowledgeMapId,
            selectedNodeIds: input.selectedNodeIds,
        });
        if (preview.fingerprint !== input.previewFingerprint) throw new ProblemTagConflictError(input.pid);
        return { pdoc: { docId: input.pid }, preview };
    },
    previewProgrammingTagNormalization: previewProgrammingTagNormalizationStub,
    async refreshProblemAcl(user: any, domainId: string) {
        calls.refresh.push({ user, domainId });
        Object.assign(user, {
            _permitPids: new Set<number>(),
            _authoredPids: new Set<number>(),
            _maintainedPids: new Set<number>(),
            _dataContributionPids: new Set<number>(),
            _tagContributionPids: new Set<number>(),
            _aclFencedPids: new Set<number>(),
            _ownsLegacyProblems: false,
            _problemAclDomainId: undefined,
            _problemAclLoaded: false,
            _pidNamespaceAuthorIds: new Set<string>(),
            _pidNamespaceManagerIds: new Set<string>(),
            _pidNamespaceEditAllIds: new Set<string>(),
            _pidNamespaceAclDomainId: undefined,
            _pidNamespaceAclLoaded: false,
        });
        const [loaded, namespaceAcl] = await Promise.all([
            (global as any).Hydro.model.permits.loadAclForUser(domainId, user._id),
            (global as any).Hydro.model.pidNamespaces.loadAclForUser(domainId, user._id),
        ]);
        Object.assign(user, {
            _permitPids: loaded.permitPids,
            _authoredPids: loaded.authoredPids,
            _maintainedPids: loaded.maintainedPids,
            _dataContributionPids: loaded.dataContributionPids,
            _tagContributionPids: loaded.tagContributionPids,
            _aclFencedPids: loaded.fencedPids,
            _problemAclDomainId: domainId,
            _problemAclLoaded: true,
            _pidNamespaceAuthorIds: namespaceAcl.authorNamespaceIds,
            _pidNamespaceManagerIds: namespaceAcl.managerNamespaceIds,
            _pidNamespaceEditAllIds: namespaceAcl.editAllNamespaceIds,
            _pidNamespaceAclDomainId: domainId,
            _pidNamespaceAclLoaded: true,
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

async function previewProgrammingTagNormalizationStub(input: any) {
    calls.previews.push(input);
    const selected = (input.selectedNodeIds || []).map(String);
    if (selected.includes(NODE_A) && String(input.targetKnowledgeMapId) !== MAP_A) throw new Error('node does not belong to requested map');
    if (selected.includes(NODE_B) && String(input.targetKnowledgeMapId) !== MAP_B) throw new Error('node does not belong to requested map');
    const knowledgeTags = selected.includes(NODE_B) ? ['共享标签'] : ['数学'];
    const sourceTags = (input.currentTags || []).filter((tag: string) => ['L2', 'PAT甲级'].includes(tag));
    return {
        knowledgeMapId: { toString: () => String(input.targetKnowledgeMapId) },
        knowledgeMapTitle: String(input.targetKnowledgeMapId) === MAP_B ? '面向对象' : '算法',
        selectedNodeIds: selected.map((id: string) => ({ toString: () => id })),
        sourceTags,
        nextTags: [...sourceTags, ...knowledgeTags],
        retainedTags: sourceTags,
        addedTags: knowledgeTags,
        removedTags: [],
        fingerprint: JSON.stringify({ mapId: String(input.targetKnowledgeMapId), selected }),
    };
}

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
    db: {
        collection(name: string) {
            if (name === 'mindmap.nodes') {
                return {
                    find(query: unknown, options: unknown) {
                        const mapId = String((query as any)?.mapId || '');
                        calls.mindmapFinds.push({ query: { mapId }, options: structuredClone(options) });
                        return cursor(mindmapDocs.filter((node) => !mapId || String(node.mapId) === mapId));
                    },
                };
            }
            if (name === 'mindmap.maps') {
                return {
                    async findOne(query: any, options: unknown) {
                        calls.mindmapLists.push({ query: structuredClone(query), options: structuredClone(options) });
                        return mindmapMaps.find((map) => map.id === String(query?._id) && map.visibility === query?.visibility)
                            ? {
                                  _id: query._id,
                                  title: mindmapMaps.find((map) => map.id === String(query?._id))!.title,
                                  visibility: 'public',
                              }
                            : null;
                    },
                };
            }
            throw new Error(`unexpected collection: ${name}`);
        },
    },
    Handler: HandlerStub,
    OplogModel: {
        async log(...args: unknown[]) {
            calls.oplogs.push(args);
        },
    },
    param: noopDecorator,
    PERM,
    PermissionError: TestPermissionError,
    Types: { Any: () => ({}), String: () => ({}) },
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
        dataContributionPids: new Set(),
        tagContributionPids: new Set(),
        fencedPids: new Set([9]),
        ownsLegacyProblems: false,
    }),
) {
    (global as any).Hydro.model.permits = {
        async loadAclForUser(domainId: string, uid: number) {
            calls.loads.push({ domainId, uid });
            return {
                dataContributionPids: new Set(),
                tagContributionPids: new Set(),
                ...(await load(domainId, uid)),
            };
        },
    };
    (global as any).Hydro.model.pidNamespaces = {
        async loadAclForUser(domainId: string, uid: number) {
            calls.namespaceLoads.push({ domainId, uid });
            return {
                authorNamespaceIds: new Set<string>(),
                managerNamespaceIds: new Set<string>(),
                editAllNamespaceIds: new Set<string>(),
            };
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
    mindmapDocs = [];
    mindmapMaps = [
        { id: MAP_A, title: '算法', visibility: 'public' },
        { id: MAP_B, title: '面向对象', visibility: 'public' },
    ];
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
        expect(tokenUser._pidNamespaceAclLoaded).to.equal(false);
        expect([...tokenUser._permitPids]).to.deep.equal([]);
        expect([...tokenUser._maintainedPids]).to.deep.equal([]);
        expect([...tokenUser._aclFencedPids]).to.deep.equal([]);
    });

    it('replaces every stale ACL marker with one snapshot loaded for the configured tagger domain', async () => {
        const handler = makeHandler('tagger_problems');

        await handler.prepare();

        expect(handler.user).to.equal(tokenUser);
        expect(calls.loads).to.deep.equal([{ domainId: 'system', uid: 42 }]);
        expect(calls.namespaceLoads).to.deep.equal([{ domainId: 'system', uid: 42 }]);
        expect([...handler.user._permitPids]).to.deep.equal([7, 9]);
        expect([...handler.user._maintainedPids]).to.deep.equal([7]);
        expect([...handler.user._aclFencedPids]).to.deep.equal([9]);
        expect(handler.user._problemAclDomainId).to.equal('system');
        expect(handler.user._problemAclLoaded).to.equal(true);
        expect(handler.user._pidNamespaceAclLoaded).to.equal(true);
        expect(handler.user._pidNamespaceAclDomainId).to.equal('system');
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
        expect(tokenUser._pidNamespaceAclLoaded).to.equal(false);
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
        expect(tokenUser._pidNamespaceAclLoaded).to.equal(false);
        expect([...tokenUser._permitPids]).to.deep.equal([]);
        expect([...tokenUser._maintainedPids]).to.deep.equal([]);
        expect([...tokenUser._aclFencedPids]).to.deep.equal([]);
    });
});

describe('P2.11 tagger enumeration gates and scopes', () => {
    it('returns 403 before problems, vocab, audit, or retag can query when CREATE is absent', async () => {
        tokenUser = makeUser(42, [PERM.PERM_EDIT_PROBLEM, PERM.PERM_VIEW_PROBLEM, PERM.PERM_VIEW_PROBLEM_HIDDEN]);
        for (const routeName of ['tagger_problems', 'tagger_vocab', 'tagger_audit', 'tagger_mindmap', 'tagger_problem_context', 'tagger_retag']) {
            const handler = makeHandler(routeName);

            await handler.prepare();

            const error = await captureFailure(() =>
                routeName === 'tagger_retag'
                    ? handler.post({}, ['old'], 'new', false)
                    : routeName === 'tagger_mindmap'
                      ? handler.get({}, MAP_A)
                      : handler.get(),
            );
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
            ownsLegacyProblems: false,
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
                ? {
                      permitPids: new Set([7]),
                      authoredPids: new Set(),
                      maintainedPids: new Set([7]),
                      fencedPids: new Set(),
                      ownsLegacyProblems: false,
                  }
                : {
                      permitPids: new Set(),
                      authoredPids: new Set(),
                      maintainedPids: new Set(),
                      fencedPids: new Set(),
                      ownsLegacyProblems: false,
                  };
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

describe('auto tagger read context', () => {
    it('reads a legacy managed problem canonical selection in summaries, audits, and statement context', async () => {
        const managed = {
            docId: 7,
            pid: 'P7',
            title: 'Legacy managed',
            tag: ['PAT甲级'],
            hidden: false,
            content: 'statement',
            authoringMode: 'managed',
            managedAuthoring: { selectedMindmapNodeIds: [NODE_A] },
            knowledgeMapId: MAP_A,
        };
        listDocs = [managed];

        const problems = makeHandler('tagger_problems');
        await problems.prepare();
        await problems.get();
        expect(problems.response.body.problems[0].knowledgeNodeIds).to.deep.equal([NODE_A]);
        expect(calls.getMulti[0].projection).to.include.members(['authoringMode', 'managedAuthoring']);

        const audit = makeHandler('tagger_audit');
        await audit.prepare();
        await audit.get();
        expect(audit.response.body.problems[0].knowledgeNodeIds).to.deep.equal([NODE_A]);
        expect(calls.getMulti[1].projection).to.include.members(['authoringMode', 'managedAuthoring']);

        const context = makeHandler('tagger_problem_context');
        await context.prepare();
        await context.get({}, 7);
        expect(context.response.body.problem.knowledgeNodeIds).to.deep.equal([NODE_A]);
        expect(calls.getMulti[2].projection).to.include.members(['authoringMode', 'managedAuthoring']);
    });

    it('returns only the requested public map even when another map reuses the same flat tag', async () => {
        mindmapDocs = [
            { _id: ROOT_A, mapId: MAP_A, parentId: null, topic: '算法', tags: [], order: 0 },
            { _id: NODE_A, mapId: MAP_A, parentId: ROOT_A, topic: '数学', tags: ['共享标签'], order: 1 },
            { _id: ROOT_B, mapId: MAP_B, parentId: null, topic: '面向对象', tags: [], order: 0 },
            { _id: NODE_B, mapId: MAP_B, parentId: ROOT_B, topic: '类', tags: ['共享标签'], order: 1 },
        ];
        const handler = makeHandler('tagger_mindmap');
        await handler.prepare();

        await handler.get({}, MAP_A);

        expect(handler.response.body).to.deep.equal({
            domainId: 'system',
            knowledgeMap: { id: MAP_A, title: '算法', visibility: 'public' },
            nodes: [
                { id: ROOT_A, mapId: MAP_A, parentId: null, topic: '算法', tags: [] },
                { id: NODE_A, mapId: MAP_A, parentId: ROOT_A, topic: '数学', tags: ['共享标签'] },
            ],
        });
        expect(calls.mindmapFinds).to.have.lengthOf(1);
        expect(String(calls.mindmapFinds[0].query.mapId)).to.equal(MAP_A);
    });

    it('returns 404 for a hidden or unknown map without querying its nodes', async () => {
        mindmapMaps = [{ id: MAP_A, title: '算法', visibility: 'public' }];
        const handler = makeHandler('tagger_mindmap');
        await handler.prepare();

        await handler.get({}, MAP_B);

        expect(handler.response.status).to.equal(404);
        expect(handler.response.body).to.deep.equal({ error: 'mindmap_not_found' });
        expect(calls.mindmapFinds).to.deep.equal([]);
    });

    it('fails fast when a live mindmap node has malformed tag data', async () => {
        mindmapDocs = [{ _id: NODE_A, mapId: MAP_A, parentId: null, topic: '数学', tags: ['数学', 42] }];
        const handler = makeHandler('tagger_mindmap');
        await handler.prepare();

        const error = await captureFailure(() => handler.get({}, MAP_A));

        expect(error).to.be.instanceOf(TypeError);
        expect(error.message).to.match(new RegExp(`mindmap node ${NODE_A} tags`, 'i'));
    });

    it('loads one problem statement inside the token user problem-bank scope, including hidden authored problems', async () => {
        listDocs = [
            {
                docId: 7,
                pid: 'P7',
                title: '快速幂',
                tag: ['PAT甲级'],
                content: '计算 a^b。',
                knowledgeMapId: MAP_A,
                knowledgeNodeIds: [NODE_A],
            },
        ];
        const handler = makeHandler('tagger_problem_context');
        await handler.prepare();

        await handler.get({}, 7);

        expect(calls.getMulti[0].query).to.deep.equal({
            $and: [
                {
                    $and: [
                        {
                            $or: [
                                { $and: [{ owner: 42 }, { authoringMode: { $ne: 'managed' } }] },
                                { $and: [{ docId: { $in: [7] } }, { maintainer: 42 }] },
                            ],
                        },
                        { docId: { $nin: [9] } },
                        { 'aclMutationLocks.uid': { $ne: 42 } },
                    ],
                },
                { docId: 7, tag: { $in: ['L2', 'PAT甲级'] } },
            ],
        });
        expect(handler.response.body).to.deep.equal({
            domainId: 'system',
            problem: {
                docId: 7,
                pid: 'P7',
                title: '快速幂',
                tag: ['PAT甲级'],
                content: '计算 a^b。',
                knowledgeMapId: MAP_A,
                knowledgeNodeIds: [NODE_A],
            },
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
                requestedUnset: {},
                options: {},
            },
        ]);
        expect(calls.events).to.deep.equal(['maintain:7', 'editAuthorized:7']);
    });

    it('rejects a malformed expected-tag snapshot before any batch write', async () => {
        getDocs.set(7, {
            domainId: 'system',
            docId: 7,
            owner: 42,
            pid: 'P7',
            title: 'old',
            tag: ['L2'],
        });
        const handler = makeHandler('tagger_apply');
        await handler.prepare();

        await handler.post({}, [{ docId: 7, expectedTag: {}, tag: ['L2', '数学'] }]);

        expect(handler.response.status).to.equal(400);
        expect(handler.response.body).to.deep.equal({ error: 'bad_expectedTag', index: 0 });
        expect(calls.edits).to.deep.equal([]);
    });

    it('rejects the removed flat-tag compatibility flag before any batch write', async () => {
        const handler = makeHandler('tagger_apply');
        await handler.prepare();

        await handler.post({}, [{ docId: 7, expectedTag: ['L2'], tag: 'L2,数学', mindmapOnly: true }]);

        expect(handler.response.status).to.equal(400);
        expect(handler.response.body).to.deep.equal({ error: 'mindmapOnly_removed', index: 0 });
        expect(calls.edits).to.deep.equal([]);
    });

    it('passes an explicit map and node selection through canonical preview and fingerprint CAS', async () => {
        getDocs.set(7, {
            domainId: 'system',
            docId: 7,
            owner: 42,
            pid: 'P7',
            title: 'old',
            tag: ['L2'],
            problemKind: 'programming',
            structureRevision: 3,
            knowledgeMapId: MAP_A,
            knowledgeNodeIds: [],
        });
        const handler = makeHandler('tagger_apply');
        await handler.prepare();

        await handler.post({}, [
            {
                docId: 7,
                expectedTag: ['L2'],
                expectedKnowledgeMapId: MAP_A,
                expectedKnowledgeNodeIds: [],
                knowledgeMapId: MAP_A,
                knowledgeNodeIds: [NODE_A],
            },
        ]);

        expect(handler.response.body.results).to.deep.equal([{ docId: 7, ok: true }]);
        expect(calls.edits).to.deep.equal([]);
        expect(calls.applies).to.have.lengthOf(1);
        expect(calls.applies[0]).to.include({ domainId: 'system', pid: 7, targetKnowledgeMapId: MAP_A });
        expect(calls.applies[0].selectedNodeIds).to.deep.equal([NODE_A]);
        expect(calls.previews).to.have.lengthOf(2);
        expect(calls.oplogs).to.have.lengthOf(1);
        expect(calls.oplogs[0][2].changes[0].after).to.deep.equal({
            tag: ['L2', '数学'],
            knowledgeMapId: MAP_A,
            knowledgeNodeIds: [NODE_A],
        });
    });

    it('preserves a legacy managed canonical selection through preview and apply', async () => {
        getDocs.set(7, {
            domainId: 'system',
            docId: 7,
            owner: 42,
            pid: 'P7',
            title: 'old',
            tag: ['L2'],
            problemKind: 'programming',
            authoringMode: 'managed',
            managedAuthoring: { selectedMindmapNodeIds: [NODE_A] },
            structureRevision: 3,
            knowledgeMapId: MAP_A,
        });
        const handler = makeHandler('tagger_apply');
        await handler.prepare();

        await handler.post({}, [
            {
                docId: 7,
                expectedTag: ['L2'],
                expectedKnowledgeMapId: MAP_A,
                expectedKnowledgeNodeIds: [NODE_A],
                knowledgeMapId: MAP_A,
                knowledgeNodeIds: [NODE_A],
            },
        ]);

        expect(handler.response.body.results).to.deep.equal([{ docId: 7, ok: true }]);
        expect(calls.gets[0].projection).to.include.members(['authoringMode', 'managedAuthoring']);
        expect(calls.previews).to.have.lengthOf(2);
        expect(calls.previews.every((preview) => JSON.stringify(preview.currentKnowledgeNodeIds) === JSON.stringify([NODE_A]))).to.equal(true);
    });

    it('preserves the dedicated tag-contributor capability in the token ACL snapshot', async () => {
        installAclLoader(async () => ({
            permitPids: new Set([7]),
            authoredPids: new Set(),
            maintainedPids: new Set(),
            dataContributionPids: new Set(),
            tagContributionPids: new Set([7]),
            fencedPids: new Set(),
            ownsLegacyProblems: false,
        }));
        getDocs.set(7, {
            domainId: 'system',
            docId: 7,
            owner: 99,
            pid: 'P7',
            title: 'old',
            tag: ['L2'],
            knowledgeMapId: MAP_A,
            knowledgeNodeIds: [],
        });
        const handler = makeHandler('tagger_apply');
        await handler.prepare();

        await handler.post({}, [
            {
                docId: 7,
                expectedTag: ['L2'],
                expectedKnowledgeMapId: MAP_A,
                expectedKnowledgeNodeIds: [],
                knowledgeMapId: MAP_A,
                knowledgeNodeIds: [NODE_A],
            },
        ]);

        expect(handler.response.body.results).to.deep.equal([{ docId: 7, ok: true }]);
        expect([...handler.user._tagContributionPids]).to.deep.equal([7]);
        expect(calls.applies).to.have.lengthOf(1);
    });

    it('rejects a stale canonical snapshot before preview or write even when flat tags are unchanged', async () => {
        getDocs.set(7, {
            domainId: 'system',
            docId: 7,
            owner: 42,
            pid: 'P7',
            title: 'old',
            tag: ['L2'],
            knowledgeMapId: MAP_B,
            knowledgeNodeIds: [NODE_B],
        });
        const handler = makeHandler('tagger_apply');
        await handler.prepare();

        await handler.post({}, [
            {
                docId: 7,
                expectedTag: ['L2'],
                expectedKnowledgeMapId: MAP_A,
                expectedKnowledgeNodeIds: [],
                knowledgeMapId: MAP_A,
                knowledgeNodeIds: [NODE_A],
            },
        ]);

        expect(handler.response.body.results).to.deep.equal([{ docId: 7, ok: false, error: 'canonical_conflict' }]);
        expect(calls.previews).to.deep.equal([]);
        expect(calls.applies).to.deep.equal([]);
        expect(calls.edits).to.deep.equal([]);
    });

    it('rejects a node from another map instead of resolving its duplicate flat tag globally', async () => {
        getDocs.set(7, {
            domainId: 'system',
            docId: 7,
            owner: 42,
            pid: 'P7',
            title: 'old',
            tag: ['L2'],
            knowledgeMapId: MAP_A,
            knowledgeNodeIds: [],
        });
        const handler = makeHandler('tagger_apply');
        await handler.prepare();

        await handler.post({}, [
            {
                docId: 7,
                expectedTag: ['L2'],
                expectedKnowledgeMapId: MAP_A,
                expectedKnowledgeNodeIds: [],
                knowledgeMapId: MAP_A,
                knowledgeNodeIds: [NODE_B],
            },
        ]);

        expect(handler.response.body.results).to.deep.equal([{ docId: 7, ok: false, error: 'node does not belong to requested map' }]);
        expect(calls.applies).to.deep.equal([]);
    });

    it('rejects a changed flat tag request and still permits a title edit carrying an unchanged legacy tag snapshot', async () => {
        getDocs.set(7, {
            domainId: 'system',
            docId: 7,
            owner: 42,
            pid: 'P7',
            title: 'old',
            tag: ['L2'],
        });
        const handler = makeHandler('tagger_apply');
        await handler.prepare();

        await handler.post({}, [
            { docId: 7, tag: ['L2', '数学'] },
            { docId: 7, expectedTag: ['L2'], tag: ['L2'], title: 'new' },
        ]);

        expect(handler.response.body.results).to.deep.equal([
            { docId: 7, ok: false, error: 'canonical_nodes_required' },
            { docId: 7, ok: true },
        ]);
        expect(calls.edits).to.deep.equal([
            {
                domainId: 'system',
                docId: 7,
                patch: { title: 'new' },
                requestedUnset: {},
                options: {},
            },
        ]);
    });

    it('reports a canonical fingerprint race without falling back to a flat tag write', async () => {
        getDocs.set(7, {
            domainId: 'system',
            docId: 7,
            owner: 42,
            pid: 'P7',
            title: 'old',
            tag: ['L2'],
            knowledgeMapId: MAP_A,
            knowledgeNodeIds: [],
        });
        editError = new ProblemTagConflictError(7);
        const handler = makeHandler('tagger_apply');
        await handler.prepare();

        await handler.post({}, [
            {
                docId: 7,
                expectedTag: ['L2'],
                expectedKnowledgeMapId: MAP_A,
                expectedKnowledgeNodeIds: [],
                knowledgeMapId: MAP_A,
                knowledgeNodeIds: [NODE_A],
            },
        ]);

        expect(handler.response.body.results).to.deep.equal([{ docId: 7, ok: false, error: 'canonical_conflict' }]);
        expect(calls.applies).to.have.lengthOf(1);
        expect(calls.edits).to.deep.equal([]);
    });

    it('keeps retag dry-run inventory but rejects every live flat-tag rewrite before querying or writing', async () => {
        const handler = makeHandler('tagger_retag');
        await handler.prepare();

        await handler.post({}, ['old'], 'new', false);

        expect(handler.response.status).to.equal(409);
        expect(handler.response.body.error).to.equal('canonical_node_selection_required');
        expect(calls.getMulti).to.deep.equal([]);
        expect(calls.edits).to.deep.equal([]);
    });
});
