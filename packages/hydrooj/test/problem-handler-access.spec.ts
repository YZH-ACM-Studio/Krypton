import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {} };
(global as any).Hydro.module ||= {};

const PERM = {
    PERM_CREATE_PROBLEM: 1n,
    PERM_VIEW_PROBLEM: 2n,
    PERM_VIEW_PROBLEM_HIDDEN: 4n,
    PERM_EDIT_PROBLEM_SELF: 8n,
    PERM_EDIT_PROBLEM: 16n,
    PERM_READ_PROBLEM_DATA: 32n,
};
const PRIV = {
    PRIV_EDIT_SYSTEM: 1,
    PRIV_USER_PROFILE: 2,
    PRIV_READ_PROBLEM_DATA: 4,
};

class TestPermissionError extends Error {
    name = 'PermissionError';
    params: unknown[];

    constructor(...params: unknown[]) {
        super('permission denied');
        this.params = params;
    }
}

class GenericError extends Error { }

const errors = new Proxy({ PermissionError: TestPermissionError }, {
    get(target, key: string) {
        return target[key] || GenericError;
    },
});

const calls = {
    add: [] as any[],
    count: [] as any[],
    claims: [] as any[],
    edit: [] as any[],
    get: [] as any[],
    getMaintainableAuthorized: [] as any[],
    getViewableAuthorized: [] as any[],
    getMulti: [] as any[],
    inc: [] as any[],
    maintain: [] as any[],
    manualStatus: [] as any[],
    provider: [] as any[],
    random: [] as any[],
    refresh: [] as any[],
    recordAdd: [] as any[],
    renameFile: [] as any[],
    status: [] as any[],
    structuredMetadataSaves: [] as any[],
    structuredSaves: [] as any[],
    contestUpdates: [] as any[],
    storageGet: [] as any[],
    storageGetMeta: [] as any[],
    storageSign: [] as any[],
};
let getMultiResults: any[][] = [];
let getResults: any[] = [];
let maintainableResults: any[] = [];
let countResult = 0;
let maintainResult = false;
let claimAllowed = true;
const createKinds: string[] = [];

function cursor(docs: any[] = []) {
    const state = { skip: 0, limit: Infinity };
    const value: any = {
        hint() { return value; },
        limit(limit: number) { state.limit = limit; return value; },
        project() { return value; },
        skip(skip: number) { state.skip = skip; return value; },
        sort() { return value; },
        async count() { return countResult; },
        async toArray() { return docs.slice(state.skip, state.skip + state.limit); },
    };
    return value;
}

const problemStub = {
    PROJECTION_PUBLIC: ['domainId', 'docId', 'pid'],
    assertProblemAclDomain(user: any, domainId: string) {
        if (user._problemAclDomainId !== domainId) throw new TestPermissionError(PERM.PERM_CREATE_PROBLEM);
    },
    assertProblemBankSelection: async () => undefined,
    buildProblemBankScope: (user: any) => user.scope || { docId: { $in: [] } },
    canBrowseProblemBank: (user: any) => user.canBrowse === true,
    canMaintainProblem(user: any, pdoc: any) {
        calls.maintain.push({ user, pdoc });
        return maintainResult;
    },
    count: async (domainId: string, query: unknown) => {
        calls.count.push({ domainId, query });
        return countResult;
    },
    async add(...args: any[]) {
        calls.add.push(args);
        return 7;
    },
    async createProblemByKind(_kind: string, ...args: any[]) {
        createKinds.push(_kind);
        calls.add.push(args);
        return 7;
    },
    async addAdditionalFile(...args: any[]) {
        calls.renameFile.push(args);
    },
    async addTestdata(...args: any[]) {
        calls.renameFile.push(args);
    },
    async addTestdataWithClaim(claim: any, ...args: any[]) {
        calls.renameFile.push([claim.domainId, claim.pid, ...args]);
    },
    async addAdditionalFileWithClaim(claim: any, ...args: any[]) {
        calls.renameFile.push([claim.domainId, claim.pid, ...args]);
    },
    canViewBy: () => true,
    async edit(...args: any[]) {
        calls.edit.push(args);
        return { domainId: args[0], docId: args[1] };
    },
    async editAuthorized(...args: any[]) {
        calls.edit.push(args);
        return { domainId: args[0], docId: args[1] };
    },
    async get(...args: any[]) {
        calls.get.push(args);
        return getResults.shift() || null;
    },
    async getMaintainableAuthorized(...args: any[]) {
        calls.getMaintainableAuthorized.push(args);
        return maintainableResults.shift() || null;
    },
    async getViewableAuthorized(...args: any[]) {
        calls.getViewableAuthorized.push(args);
        return getResults.shift() || null;
    },
    async getStatus(...args: any[]) {
        calls.status.push(args);
        return null;
    },
    async withAuthorizedWriteClaim(
        domainId: string, pid: number, user: any, operation: string, work: (claim: any) => Promise<any>,
    ) {
        calls.claims.push({ domainId, pid, user, operation });
        if (!claimAllowed) throw new TestPermissionError(PERM.PERM_EDIT_PROBLEM_SELF);
        return work({ domainId, pid, operation, requestId: 'test-claim' });
    },
    async withAuthorizedStructuralWriteClaim(
        domainId: string,
        pid: number,
        user: any,
        operation: string,
        work: (claim: any) => Promise<any>,
    ) {
        return problemStub.withAuthorizedWriteClaim(domainId, pid, user, operation, work);
    },
    async inc(...args: any[]) {
        calls.inc.push(args);
    },
    getListStatus: async () => ({}),
    getMulti(domainId: string, query: unknown, projection?: unknown) {
        calls.getMulti.push({ domainId, query, querySnapshot: structuredClone(query), projection });
        return cursor(getMultiResults.shift() || []);
    },
    isProblemBankAdmin: (user: any) => user.admin === true,
    async random(domainId: string, query: unknown) {
        calls.random.push({ domainId, query });
        return 123;
    },
    async refreshProblemAcl(user: any, domainId: string) {
        calls.refresh.push({ user, domainId });
    },
    async saveStructuredProblem(input: any) {
        calls.structuredSaves.push(input);
        return { domainId: input.domainId, docId: input.pid, structureRevision: input.expectedStructureRevision + 1 };
    },
    async saveStructuredProblemMetadata(input: any) {
        calls.structuredMetadataSaves.push(input);
        return { domainId: input.domainId, docId: input.pid, structureRevision: 5 };
    },
    async updateManualStatusLatest(...args: any[]) {
        calls.manualStatus.push(args);
        return true;
    },
    async renameAdditionalFile(...args: any[]) {
        calls.renameFile.push(args);
    },
    async renameTestdataWithClaim(claim: any, ...args: any[]) {
        calls.renameFile.push([claim.domainId, claim.pid, ...args]);
    },
    async renameAdditionalFileWithClaim(claim: any, ...args: any[]) {
        calls.renameFile.push([claim.domainId, claim.pid, ...args]);
    },
    async delTestdataWithClaim(claim: any, ...args: any[]) {
        calls.renameFile.push([claim.domainId, claim.pid, ...args]);
    },
    async delAdditionalFileWithClaim(claim: any, ...args: any[]) {
        calls.renameFile.push([claim.domainId, claim.pid, ...args]);
    },
};

function noopDecorator() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}

class HandlerStub { }
const serverStub = {
    Handler: HandlerStub,
    param: noopDecorator,
    post: noopDecorator,
    query: noopDecorator,
    route: noopDecorator,
    Query: (_schema: unknown, resolver: unknown) => resolver,
    Types: new Proxy({}, { get: () => () => ({}) }),
};

const systemStub = { get: () => false };
const builtinStub = { PERM, PRIV, STATUS: {} };
const contestHandlerStub = { ContestDetailBaseHandler: class { } };
const emptyModel = {
    async updateStatus(...args: any[]) { calls.contestUpdates.push(args); },
    canShowSelfRecord() { return true; },
};
const discussionStub = { count: async () => 0 };
const domainStub = {
    async get() { return { _id: 'system' }; },
    async incUserInDomain() { return undefined; },
};
const recordStub = {
    STAT_QUERY: {},
    async add(...args: any[]) {
        calls.recordAdd.push(args);
        return 'rid';
    },
};
const settingStub = { langs: { cpp: { disabled: false } }, SETTINGS_BY_KEY: { codeLang: { range: {} } } };
const solutionStub = { count: async () => 0 };
const storageStub = {
    async get(...args: any[]) { calls.storageGet.push(args); return Buffer.from('secret'); },
    async getMeta(...args: any[]) { calls.storageGetMeta.push(args); return { size: 6 }; },
    async put() { return undefined; },
    async signDownloadLink(...args: any[]) { calls.storageSign.push(args); return '/signed-secret'; },
};
const oplogStub = { async log() { return undefined; } };
const userStub = {
    async getById() { return { _id: 42 }; },
    async setById() { return undefined; },
};

const handlerPath = require.resolve('../src/handler/problem.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (request === '../error') return errors;
    if (request === '../model/builtin') return builtinStub;
    if (request === '../model/problem') return problemStub;
    if (request === '../model/system') return systemStub;
    if (request === '../service/server') return serverStub;
    if (request === './contest') return contestHandlerStub;
    if (request === '../model/contest') return emptyModel;
    if (request === '../model/oplog') return oplogStub;
    if (request === '../model/discussion') return discussionStub;
    if (request === '../model/domain') return domainStub;
    if (request === '../model/manual-grade') {
        return {
            async markManualPending(input: any) {
                calls.manualStatus.push(input);
                calls.contestUpdates.push(input);
            },
        };
    }
    if (request === '../model/record') return recordStub;
    if (request === '../model/setting') return settingStub;
    if (request === '../model/solution') return solutionStub;
    if (request === '../model/storage') return storageStub;
    if (request === '../model/user') return userStub;
    return originalLoad.call(this, request, parent, isMain);
};

let handlerModule: typeof import('../src/handler/problem');
try {
    delete require.cache[handlerPath];
    handlerModule = require(handlerPath);
} finally {
    Module._load = originalLoad;
}

const {
    defaultSearch,
    ProblemApi,
    ProblemCreateHandler,
    ProblemCreateSingleHandler,
    ProblemCreateSubjectiveHandler,
    ProblemDetailHandler,
    ProblemEditHandler,
    ProblemConfigHandler,
    ProblemFileDownloadHandler,
    ProblemFilesHandler,
    ProblemHackHandler,
    ProblemMainHandler,
    ProblemManageHandler,
    ProblemMineHandler,
    ProblemRandomHandler,
    ProblemSubmitHandler,
} = handlerModule as any;

function makeHandler(HandlerClass: any, user: Record<string, unknown>) {
    const instance = new HandlerClass();
    Object.assign(instance, {
        user: {
            _files: [], _id: 42, _problemAclDomainId: 'system',
            hasPerm: () => false, hasPriv: () => false, ...user,
        },
        response: { body: {} },
        request: { json: false },
        domain: { _id: 'system', namespaces: {} },
        UiContext: {},
        args: {},
        ctx: {
            i18n: { langs: () => [] },
            setting: { get: () => 20 },
            parallel: async () => undefined,
        },
        url: (name: string) => name === 'training_main' ? '/training' : `/${name}`,
        paginate: async (source: any) => [await source.toArray(), 1, countResult],
        back: () => undefined,
        progress: () => undefined,
        limitRate: async () => undefined,
        checkPerm: (permission: bigint) => { throw new TestPermissionError(permission); },
    });
    return instance as any;
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
    getMultiResults = [];
    getResults = [];
    maintainableResults = [];
    countResult = 0;
    maintainResult = false;
    claimAllowed = true;
    createKinds.length = 0;
    (global as any).Hydro.module.problemSearch = {};
});

describe('P2.11 enumeration entry gates', () => {
    it('redirects the page before any query when the user cannot browse', async () => {
        const handler = makeHandler(ProblemMainHandler, { canBrowse: false });
        await handler.get('system', 1, '', 20, false, false);
        expect(handler.response.redirect).to.equal('/training');
        expect(calls.getMulti).to.deep.equal([]);
        expect(calls.count).to.deep.equal([]);
    });

    it('returns 403 for quick mode before rendering counts or tags', async () => {
        const handler = makeHandler(ProblemMainHandler, { canBrowse: false });
        const error = await captureFailure(() => handler.get('system', 1, '', 20, false, true));
        expect(error).to.be.instanceOf(TestPermissionError);
        expect(error.params).to.deep.equal([PERM.PERM_CREATE_PROBLEM]);
        expect(calls.getMulti).to.deep.equal([]);
    });

    it('redirects random and mine before either endpoint can enumerate', async () => {
        const random = makeHandler(ProblemRandomHandler, { canBrowse: false });
        const mine = makeHandler(ProblemMineHandler, { canBrowse: false });
        await random.get('system', '');
        await mine.get('system', 1);
        expect(random.response.redirect).to.equal('/training');
        expect(mine.response.redirect).to.equal('/training');
        expect(calls.random).to.deep.equal([]);
        expect(calls.getMulti).to.deep.equal([]);
    });

    it('passes the same canonical scope to main find and mine find/count', async () => {
        const scope = { $or: [{ owner: 42 }, { docId: { $in: [7] } }] };
        const user = {
            canBrowse: true, scope, hasPriv: () => false, hasPerm: () => false, _id: 42,
        };
        getMultiResults = [[], [], []];
        const main = makeHandler(ProblemMainHandler, user);
        await main.get('system', 1, '', 20, false, false);
        const mine = makeHandler(ProblemMineHandler, user);
        await mine.get('system', 1);
        expect(calls.getMulti[0].query).to.deep.equal(scope);
        expect(calls.getMulti[1].query).to.deep.equal(scope);
        expect(calls.getMulti[2].query).to.deep.equal(scope);
        expect(calls.refresh.map(({ domainId }) => domainId)).to.deep.equal(['system', 'system']);
    });

    it('ignores a forged method domainId and queries only the authoritative handler domain', async () => {
        const scope = { owner: 42 };
        const user = {
            canBrowse: true, scope, hasPriv: () => false, hasPerm: () => false, _id: 42,
        };
        getMultiResults = [[], [], []];
        await makeHandler(ProblemMainHandler, user).get('forged', 1, '', 20, false, false);
        await makeHandler(ProblemMineHandler, user).get('forged', 1);
        await makeHandler(ProblemRandomHandler, user).get('forged', '');
        expect(calls.getMulti.every((call) => call.domainId === 'system')).to.equal(true);
        expect(calls.random).to.deep.equal([{ domainId: 'system', query: scope }]);
    });
});

describe('P2.11 authoritative problem route domain', () => {
    it('loads a public detail and all dependent data from the handler domain, not an injected argument', async () => {
        const handler = makeHandler(ProblemDetailHandler, {});
        getResults = [{
            domainId: 'system', docId: 7, owner: 42, hidden: false,
            title: 'P7', content: 'statement', config: '', additional_file: [], tag: [],
        }];
        await handler._prepare('forged', 7);
        expect(calls.getViewableAuthorized[0][0]).to.equal('system');
        expect(calls.get).to.deep.equal([]);
        expect(calls.status[0][0]).to.equal('system');
    });

    it('creates a problem only in the authoritative handler domain', async () => {
        const handler = makeHandler(ProblemCreateHandler, {});
        await handler.post('forged', 'Title', 'Statement', '', false, 0, []);
        expect(calls.add[0][0]).to.equal('system');
    });

    it('submits and hacks against the loaded problem domain', async () => {
        const submit = makeHandler(ProblemSubmitHandler, {});
        submit.pdoc = { domainId: 'system', docId: 7, config: { type: 'default' } };
        await submit.post('forged', 'cpp', 'code', false, [], undefined);
        expect(calls.recordAdd[0][0]).to.equal('system');
        expect(calls.inc[0][0]).to.equal('system');

        calls.recordAdd.length = 0;
        const hack = makeHandler(ProblemHackHandler, {});
        hack.pdoc = { domainId: 'system', docId: 7 };
        hack.rdoc = { _id: 'target', lang: 'cpp', code: 'code' };
        await hack.post('forged', '1 2', false, undefined);
        expect(calls.recordAdd[0][0]).to.equal('system');
    });

    it('edits problem metadata and config/files only in the loaded problem domain', async () => {
        const edit = makeHandler(ProblemEditHandler, {});
        edit.pdoc = { domainId: 'system', docId: 7, pid: 'P7' };
        await edit.post('forged', 'P7', 'Title', 'Statement', 'P7', false, [], 0, false);
        expect(calls.edit[0][0]).to.equal('system');
        expect(calls.edit[0][3]).to.equal(edit.user);

        const files = makeHandler(ProblemFilesHandler, {});
        files.pdoc = { domainId: 'system', docId: 7, data: [], additional_file: [] };
        files.request.files = {
            file: { filepath: '/tmp/config.yaml', originalFilename: 'config.yaml', size: 1 },
        };
        await files.postUploadFile('forged', 'config.yaml', 'testdata');
        expect(calls.renameFile[0][0]).to.equal('system');
    });
});

describe('P3.9 basic objective HTTP boundaries', () => {
    it('creates a hidden single problem in the authoritative domain with a fixed URL kind', async () => {
        const handler = makeHandler(ProblemCreateSingleHandler, {});
        await handler.post(
            'forged', 'Single', 'Statement', '', 3, ['tag'], 'single',
            JSON.stringify({ main: { options: ['A text', 'B text'], answerIndex: 1 } }),
        );
        expect(createKinds).to.deep.equal(['single']);
        expect(calls.add[0][0]).to.equal('system');
        expect(calls.add[0][6].structuredConfig).to.deep.equal({
            main: { options: ['A text', 'B text'], answerIndex: 1 },
        });
        expect(handler.response.body.hidden).to.equal(true);
    });

    it('rejects a create-route kind mismatch before creating anything', async () => {
        const handler = makeHandler(ProblemCreateSingleHandler, {});
        const error = await captureFailure(() => handler.post(
            'forged', 'Single', 'Statement', '', 0, [], 'multi',
            JSON.stringify({ main: { options: ['A', 'B'], answerIndex: 0 } }),
        ));
        expect(error).to.be.instanceOf(GenericError);
        expect(calls.add).to.deep.equal([]);
    });

    it('saves metadata, content, and config through one revision-checked structured write', async () => {
        const handler = makeHandler(ProblemEditHandler, {});
        handler.pdoc = {
            domainId: 'system', docId: 7, pid: 'P7', problemKind: 'multi', structureRevision: 4,
        };
        await handler.post(
            'forged', 'P7', 'Multi', 'Statement', 'P7', false, ['tag'], 2,
            false, 4, 'multi',
            JSON.stringify({
                main: { options: ['A', 'B'], answerIndexes: [0], partialCreditPercent: 25 },
            }),
        );
        expect(calls.structuredSaves).to.have.length(1);
        expect(calls.structuredSaves[0]).to.deep.include({
            domainId: 'system', pid: 7, problemKind: 'multi', expectedStructureRevision: 4,
        });
        expect(calls.structuredSaves[0].metadata).to.deep.include({ title: 'Multi', hidden: false });
        expect(calls.edit).to.deep.equal([]);
    });

    it('updates only title, tags, and visibility after an objective problem is structurally locked', async () => {
        const handler = makeHandler(ProblemEditHandler, {});
        handler.pdoc = {
            domainId: 'system', docId: 7, pid: 'P7', problemKind: 'multi',
            structureRevision: 5, structureLockedAt: new Date(), content: 'Original statement',
        };
        await handler.post(
            'forged', 'P7', 'Renamed', undefined, undefined, true, ['new-tag'],
            undefined, undefined, undefined, '', '', true,
        );
        expect(calls.structuredMetadataSaves).to.have.length(1);
        expect(calls.structuredMetadataSaves[0]).to.deep.include({
            domainId: 'system', pid: 7, actor: 42, problemKind: 'multi',
            metadata: { title: 'Renamed', hidden: true, tag: ['new-tag'] },
        });
        expect(calls.edit).to.deep.equal([]);
        expect(calls.structuredSaves).to.deep.equal([]);
    });

    it('rejects structural fields smuggled into an objective metadata-only save', async () => {
        const handler = makeHandler(ProblemEditHandler, {});
        handler.pdoc = {
            domainId: 'system', docId: 7, pid: 'P7', problemKind: 'multi',
            structureRevision: 5, structureLockedAt: new Date(), content: 'Original statement',
        };
        const error = await captureFailure(() => handler.post(
            'forged', 'P7', 'Renamed', 'Changed statement', undefined, true, ['new-tag'],
            undefined, undefined, undefined, '', '', true,
        ));
        expect(error).to.be.instanceOf(GenericError);
        expect(calls.edit).to.deep.equal([]);
        expect(calls.structuredMetadataSaves).to.deep.equal([]);
        expect(calls.structuredSaves).to.deep.equal([]);
    });

    it('serves the dedicated editor from stable raw config without returning derived answers', async () => {
        const handler = makeHandler(ProblemEditHandler, {});
        handler.pdoc = {
            domainId: 'system', docId: 7, pid: 'P7', owner: 42, problemKind: 'blank',
            data: [], additional_file: [], tag: [], content: '',
        };
        maintainableResults = [{
            config: {
                type: 'objective', main: { answer: 'Case' },
                answers: { main: ['Case', 100, { kind: 'blank' }] },
            },
        }];
        await handler.get();
        expect(handler.response.template).to.equal('problem_edit_blank.html');
        expect(handler.response.body.structuredConfig).to.deep.equal({ main: { answer: 'Case' } });
        expect(handler.response.body.structuredConfig).not.to.have.property('answers');
    });
});

describe('P3.10 subjective problem HTTP boundaries', () => {
    it('creates a hidden subjective problem through its fixed-kind route', async () => {
        const handler = makeHandler(ProblemCreateSubjectiveHandler, {});
        await handler.post(
            'forged', 'Essay', 'Explain why.', '', 0, ['reasoning'], 'subjective',
            JSON.stringify({ main: { gradingInstructions: 'Look for invariants.' } }),
        );
        expect(createKinds.at(-1)).to.equal('subjective');
        expect(calls.add.at(-1)[6].structuredConfig).to.deep.equal({
            main: { gradingInstructions: 'Look for invariants.' },
        });
        expect(handler.response.body.hidden).to.equal(true);
    });

    it('rejects subjective submission outside an allowed scoring container', async () => {
        const handler = makeHandler(ProblemSubmitHandler, {});
        handler.pdoc = {
            domainId: 'system', docId: 7, problemKind: 'subjective', config: { type: 'objective' },
        };
        handler.tdoc = { docId: 'contest', rule: 'acm' };
        const error = await captureFailure(() => handler.post(
            'forged', '_', 'answer', false, [], 'contest' as any,
        ));
        expect(error).to.be.instanceOf(GenericError);
        expect(calls.recordAdd).to.deep.equal([]);
    });

    it('stores the raw answer as a manual pending record in homework', async () => {
        const handler = makeHandler(ProblemSubmitHandler, {});
        handler.pdoc = {
            domainId: 'system', docId: 7, problemKind: 'subjective', config: { type: 'objective' },
        };
        handler.tdoc = { docId: 'homework', rule: 'homework' };
        await handler.post('forged', '_', 'line one\r\nline two', false, [], 'homework' as any);
        expect(calls.recordAdd.at(-1)[4]).to.equal('line one\r\nline two');
        expect(calls.recordAdd.at(-1)[6]).to.deep.include({ contest: 'homework', type: 'manual' });
        expect(calls.manualStatus).to.have.length(1);
        expect(calls.contestUpdates).to.have.length(1);
    });
});

describe('P2.11 scoped Mongo search', () => {
    it('pushes scope into text find and count before pagination', async () => {
        const scope = { $or: [{ owner: 42 }, { docId: { $in: [7] } }] };
        getMultiResults = [[
            ...Array.from({ length: 20 }, (_, i) => ({ domainId: 'system', docId: 100 + i, pid: `P${100 + i}` })),
            { domainId: 'system', docId: 7, pid: 'P7' },
        ]];
        countResult = 31;
        const result = await defaultSearch('system', 'alpha', { skip: 20, limit: 10 }, scope);
        expect(calls.getMulti).to.have.lengthOf(1);
        expect(calls.getMulti[0].query.$and[0]).to.deep.equal(scope);
        expect(calls.count).to.have.lengthOf(1);
        expect(calls.count[0].query).to.deep.equal(calls.getMulti[0].query);
        expect(result.total).to.equal(31);
        expect(result.hits).to.deep.equal(['system/7']);
    });

    it('includes exact pid lookup in the same scoped Mongo query', async () => {
        const scope = { owner: 42 };
        getMultiResults = [[{ domainId: 'system', docId: 42, pid: 'P42' }]];
        countResult = 1;
        const result = await defaultSearch('system', 'P42', { skip: 0, limit: 10 }, scope);
        expect(calls.getMulti).to.have.lengthOf(1);
        expect(calls.getMulti.every((call) => call.query.$and[0] === scope)).to.equal(true);
        expect(calls.get).to.deep.equal([]);
        expect(result.hits).to.deep.equal(['system/42']);
        expect(result.total).to.equal(1);
    });

    it('forces non-admin text search to Mongo even when a global provider is registered', async () => {
        (global as any).Hydro.module.problemSearch = {
            elastic: async (...args: any[]) => {
                calls.provider.push(args);
                return { hits: [], total: 0, countRelation: 'eq' };
            },
        };
        getMultiResults = [[]];
        const handler = makeHandler(ProblemMainHandler, {
            _id: 42,
            canBrowse: true,
            admin: false,
            scope: { owner: 42 },
            hasPriv: () => false,
        });
        await handler.get('system', 1, 'alpha', 20, false, false);
        expect(calls.provider).to.deep.equal([]);
        expect(calls.getMulti.length).to.be.greaterThan(0);
    });

    it('allows an administrator to retain the registered search provider', async () => {
        (global as any).Hydro.module.problemSearch = {
            elastic: async (...args: any[]) => {
                calls.provider.push(args);
                return { hits: [], total: 0, countRelation: 'eq' };
            },
        };
        const handler = makeHandler(ProblemMainHandler, {
            _id: 1,
            canBrowse: true,
            admin: true,
            scope: {},
            hasPriv: () => false,
        });
        await handler.get('system', 1, 'alpha', 20, false, false);
        expect(calls.provider).to.have.lengthOf(1);
    });

    it('falls back to scoped Mongo when an administrator has a fenced exclusion', async () => {
        (global as any).Hydro.module.problemSearch = {
            elastic: async (...args: any[]) => {
                calls.provider.push(args);
                return { hits: [], total: 0, countRelation: 'eq' };
            },
        };
        getMultiResults = [[]];
        const handler = makeHandler(ProblemMainHandler, {
            _id: 1,
            canBrowse: true,
            admin: true,
            scope: { docId: { $nin: [7] } },
            hasPriv: () => false,
        });
        await handler.get('system', 1, 'alpha', 20, false, false);
        expect(calls.provider).to.deep.equal([]);
        expect(calls.getMulti[0].querySnapshot.$and[0]).to.deep.equal({ docId: { $nin: [7] } });
    });
});

describe('P2.11 Problem API gates', () => {
    it('returns 403 before exact or batch API queries for users without browse ability', async () => {
        const ctx = {
            args: { domainId: 'system' },
            domain: { _id: 'system' },
            user: { _problemAclDomainId: 'system', canBrowse: false },
        } as any;
        const exact = await captureFailure(() => ProblemApi.problem(ctx, { domainId: 'system', id: 7 }));
        const batch = await captureFailure(() => ProblemApi.problems(ctx, { domainId: 'system', ids: [7] }));
        expect(exact).to.be.instanceOf(TestPermissionError);
        expect(batch).to.be.instanceOf(TestPermissionError);
        expect(calls.getMulti).to.deep.equal([]);
        expect(calls.get).to.deep.equal([]);
    });

    it('pushes canonical scope into exact and batch API Mongo queries', async () => {
        const scope = { owner: 42 };
        const ctx = {
            args: { domainId: 'system' },
            domain: { _id: 'system' },
            user: { _problemAclDomainId: 'system', canBrowse: true, scope },
        } as any;
        getMultiResults = [
            [{ domainId: 'system', docId: 7, pid: 'P7' }],
            [{ domainId: 'system', docId: 7, pid: 'P7' }],
        ];
        expect(await ProblemApi.problem(ctx, { domainId: 'system', id: 7 })).to.have.property('docId', 7);
        expect(await ProblemApi.problems(ctx, { domainId: 'system', ids: [7] })).to.have.lengthOf(1);
        expect(calls.getMulti).to.have.lengthOf(2);
        expect(calls.getMulti.every((call) => call.query.$and[0] === scope)).to.equal(true);
    });

    it('rejects a forged args domain that agrees with the API payload but not the authoritative domain', async () => {
        const ctx = {
            args: { domainId: 'other' },
            domain: { _id: 'system' },
            user: {
                _problemAclDomainId: 'system',
                canBrowse: true,
                scope: { docId: { $in: [7] } },
            },
        } as any;
        const exact = await captureFailure(() => ProblemApi.problem(ctx, { domainId: 'other', id: 7 }));
        const batch = await captureFailure(() => ProblemApi.problems(ctx, { domainId: 'other', ids: [7] }));
        expect(exact).to.be.instanceOf(TestPermissionError);
        expect(batch).to.be.instanceOf(TestPermissionError);
        expect(calls.getMulti).to.deep.equal([]);
    });

    it('uses the authoritative domain even when merged args contains a different forged value', async () => {
        const scope = { owner: 42 };
        const ctx = {
            args: { domainId: 'forged' },
            domain: { _id: 'other' },
            user: { _problemAclDomainId: 'other', canBrowse: true, scope },
        } as any;
        getMultiResults = [
            [{ domainId: 'other', docId: 7, pid: 'P7' }],
            [{ domainId: 'other', docId: 7, pid: 'P7' }],
        ];
        expect(await ProblemApi.problem(ctx, { domainId: 'other', id: 7 })).to.have.property('docId', 7);
        expect(await ProblemApi.problems(ctx, { domainId: 'other', ids: [7] })).to.have.lengthOf(1);
    });

    it('rejects when preload state belongs to a different domain than the authoritative request', async () => {
        const ctx = {
            args: { domainId: 'other' },
            domain: { _id: 'other' },
            user: {
                _problemAclDomainId: 'system',
                canBrowse: true,
                scope: { docId: { $in: [7] } },
            },
        } as any;
        const exact = await captureFailure(() => ProblemApi.problem(ctx, { domainId: 'other', id: 7 }));
        const batch = await captureFailure(() => ProblemApi.problems(ctx, { domainId: 'other', ids: [7] }));
        expect(exact).to.be.instanceOf(TestPermissionError);
        expect(batch).to.be.instanceOf(TestPermissionError);
        expect(calls.getMulti).to.deep.equal([]);
    });
});

describe('P2.11 canonical ProblemDoc maintenance gate', () => {
    it('uses a stable maintainer read for manage preparation and the canonical gate for file mutations', async () => {
        const pdoc = { domainId: 'system', docId: 7, owner: 42 };
        const manage = makeHandler(ProblemManageHandler, { _id: 42 });
        manage.pdoc = pdoc;
        maintainableResults = [null];
        const manageError = await captureFailure(() => manage.prepare());
        expect(manageError).to.be.instanceOf(TestPermissionError);
        expect(calls.getMaintainableAuthorized[0].slice(0, 2)).to.deep.equal(['system', 7]);

        const files = makeHandler(ProblemFilesHandler, { _id: 42 });
        files.pdoc = pdoc;
        files.args = { operation: 'upload_file' };
        maintainResult = false;
        const filesError = await captureFailure(() => files.post());
        expect(filesError).to.be.instanceOf(TestPermissionError);
        expect(calls.maintain.at(-1)?.pdoc).to.equal(pdoc);
    });

    it('contains no legacy ProblemDoc own-or-wide-edit fallback in this handler', () => {
        const source = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/handler/problem.ts'), 'utf8');
        expect(source).not.to.match(/\.own\((?:this\.)?pdoc\b/);
        expect(source).not.to.match(/\.own\(this\.pdoc\b/);
        expect(source).not.to.match(/checkPerm\(PERM\.PERM_EDIT_PROBLEM\)/);
        expect(source).to.include('problem.getMaintainableAuthorized(');
        expect(source).to.include('assertCanMaintainProblem(this.user, this.pdoc)');
    });

    it('never resolves referenced-problem testdata links through wrapper-domain maintenance', async () => {
        const handler = makeHandler(ProblemFilesHandler, { _id: 42 });
        handler.pdoc = {
            domainId: 'system', docId: 7, owner: 42,
            reference: { domainId: 'source-domain', pid: 7 },
        };
        maintainResult = true;
        const error = await captureFailure(() => handler.postGetLinks(
            'system', new Set(['config.yaml']), 'testdata',
        ));
        expect(error).to.be.instanceOf(GenericError);
        expect(calls.get).to.deep.equal([]);
    });

    it('does not let a contest tid turn stale preload state into maintenance authority', async () => {
        const handler = makeHandler(ProblemManageHandler, { _id: 42 });
        handler.pdoc = { domainId: 'system', docId: 7, owner: 9, config: { type: 'default' } };
        handler.tdoc = { docId: 'contest' };
        handler.response.body.pdoc = handler.pdoc;
        maintainResult = true; // request preload still says maintainer
        maintainableResults = [null]; // stable final read sees completed downgrade

        const error = await captureFailure(() => handler.prepare());

        expect(error).to.be.instanceOf(TestPermissionError);
        expect(calls.getMaintainableAuthorized).to.have.length(1);
        expect(calls.getMaintainableAuthorized[0].slice(0, 2)).to.deep.equal(['system', 7]);
    });

    it('loads editor raw config only through the stable maintainer read', async () => {
        const handler = makeHandler(ProblemEditHandler, { _id: 42 });
        handler.pdoc = {
            domainId: 'system', docId: 7, pid: 'P7', owner: 42,
            data: [], additional_file: [], tag: [], content: '',
        };
        maintainableResults = [{ config: 'type: default\n' }];

        await handler.get();

        expect(handler.response.body.configRaw).to.equal('type: default\n');
        expect(calls.get).to.deep.equal([]);
        expect(calls.getMaintainableAuthorized[0][0]).to.equal('system');
        expect(calls.getMaintainableAuthorized[0][1]).to.equal(7);
        expect(calls.getMaintainableAuthorized[0][3]).to.deep.equal(['config']);
        expect(calls.getMaintainableAuthorized[0][4]).to.equal(true);
    });

    it('performs no raw config storage read after the stable maintainer read rejects', async () => {
        const handler = makeHandler(ProblemConfigHandler, { _id: 42 });
        handler.pdoc = {
            domainId: 'system', docId: 7, owner: 9,
            data: [{ name: 'config.yaml' }], additional_file: [],
        };
        maintainResult = true;
        maintainableResults = [null];

        const error = await captureFailure(() => handler.get());

        expect(error).to.be.instanceOf(TestPermissionError);
        expect(calls.storageGet).to.deep.equal([]);
    });

    it('signs no bulk testdata links after downgrade wins the stable final read', async () => {
        const handler = makeHandler(ProblemFilesHandler, { _id: 42 });
        handler.pdoc = {
            domainId: 'system', docId: 7, owner: 9,
            data: [{ name: 'config.yaml', size: 6 }], additional_file: [],
        };
        maintainResult = true;
        maintainableResults = [null];

        const error = await captureFailure(() => handler.postGetLinks(
            'forged', new Set(['config.yaml']), 'testdata',
        ));

        expect(error).to.be.instanceOf(TestPermissionError);
        expect(calls.storageSign).to.deep.equal([]);
    });

    it('signs no single testdata link when tid only authorizes the statement', async () => {
        const handler = makeHandler(ProblemFileDownloadHandler, { _id: 42 });
        handler.pdoc = { domainId: 'system', docId: 7, owner: 9, data: [], additional_file: [] };
        handler.tdoc = { domainId: 'system', docId: 'contest' };
        maintainResult = true;
        maintainableResults = [null];

        const error = await captureFailure(() => handler.get(
            {}, 'testdata', 'config.yaml', false, {} as any,
        ));

        expect(error).to.be.instanceOf(TestPermissionError);
        expect(calls.storageGetMeta).to.deep.equal([]);
        expect(calls.storageSign).to.deep.equal([]);
    });
});

describe('P2.11 generated-testdata request authorization', () => {
    it('takes a fresh write claim before enqueueing generation and writes no record if revoke won', async () => {
        const handler = makeHandler(ProblemFilesHandler, {});
        handler.pdoc = {
            domainId: 'system', docId: 7,
            data: [{ name: 'std.cpp' }, { name: 'gen.cpp' }],
        };

        claimAllowed = false;
        const denied = await captureFailure(() => handler.postGenerateTestdata('forged', 'std.cpp', 'gen.cpp'));
        expect(denied).to.be.instanceOf(TestPermissionError);
        expect(calls.recordAdd).to.deep.equal([]);

        claimAllowed = true;
        getResults = [handler.pdoc];
        await handler.postGenerateTestdata('forged', 'std.cpp', 'gen.cpp');
        expect(calls.claims.at(-1)).to.deep.include({
            domainId: 'system', pid: 7, operation: 'generate-testdata-request',
        });
        expect(calls.recordAdd).to.have.length(1);
        expect(calls.recordAdd[0][0]).to.equal('system');
    });

    it('rechecks std and generator files inside the claim and enqueues nothing after a concurrent delete', async () => {
        const handler = makeHandler(ProblemFilesHandler, {});
        handler.pdoc = {
            domainId: 'system', docId: 7, reference: null,
            data: [{ name: 'std.cpp' }, { name: 'gen.cpp' }],
        };
        getResults = [{
            domainId: 'system', docId: 7, reference: null,
            data: [{ name: 'std.cpp' }],
        }];

        const error = await captureFailure(() => handler.postGenerateTestdata(
            'forged', 'std.cpp', 'gen.cpp',
        ));

        expect(error).to.be.instanceOf(GenericError);
        expect(calls.claims.at(-1)).to.deep.include({
            domainId: 'system', pid: 7, operation: 'generate-testdata-request',
        });
        expect(calls.get).to.deep.equal([['system', 7]]);
        expect(calls.recordAdd).to.deep.equal([]);
    });

    it('rechecks reference state inside the claim and enqueues nothing after a concurrent conversion', async () => {
        const handler = makeHandler(ProblemFilesHandler, {});
        handler.pdoc = {
            domainId: 'system', docId: 7, reference: null,
            data: [{ name: 'std.cpp' }, { name: 'gen.cpp' }],
        };
        getResults = [{
            domainId: 'system', docId: 7,
            reference: { domainId: 'source', pid: 9 },
            data: [{ name: 'std.cpp' }, { name: 'gen.cpp' }],
        }];

        const error = await captureFailure(() => handler.postGenerateTestdata(
            'forged', 'std.cpp', 'gen.cpp',
        ));

        expect(error).to.be.instanceOf(GenericError);
        expect(calls.get).to.deep.equal([['system', 7]]);
        expect(calls.recordAdd).to.deep.equal([]);
    });
});
