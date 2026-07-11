import { createRequire } from 'node:module';
import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const Module = require('module');
const handlerPath = require.resolve('../../hydrooj/src/handler/paper-center.ts');
const originalLoad = Module._load;

const operations: Array<{ name: string, domainId: string }> = [];
let maintainableResult: any;
let listProjection: string[] = [];
let maintainableArgs: any[][] = [];

const pdoc = {
    _id: { getTimestamp: () => new Date(0) },
    docId: 7,
    pid: 'P7',
    title: '题目',
    content: '',
    config: 'type: objective\nanswers: {}\n',
    hidden: true,
    owner: 42,
};

function record(name: string, domainId: string) {
    operations.push({ name, domainId });
}

const problem = {
    assertProblemAclDomain(user: any, domainId: string) {
        record('assertDomain', domainId);
        if (domainId !== user._problemAclDomainId) throw new Error('ACL domain mismatch');
    },
    getMulti(domainId: string, _query: unknown, projection: string[]) {
        record('getMulti', domainId);
        listProjection = projection;
        return { sort: () => ({}) };
    },
    async get(domainId: string) { record('get', domainId); return pdoc; },
    async getMaintainableAuthorized(...args: any[]) {
        const [domainId] = args;
        record('getMaintainable', domainId);
        maintainableArgs.push(args);
        return maintainableResult;
    },
    async add(domainId: string) { record('add', domainId); return 7; },
    async addTestdata(domainId: string) { record('addTestdata', domainId); },
    async withAuthorizedWriteClaim(domainId: string, docId: number, actor: any, _operation: string, work: any) {
        return work({ domainId, pid: docId, actor: actor._id, requestId: 'test-claim', state: 'active' });
    },
    async editWithClaim(claim: any) { record('edit', claim.domainId); },
    async addTestdataWithClaim(claim: any) { record('addTestdata', claim.domainId); },
};

class FakeHandler {
    user: any;
    domain: any;
    response: Record<string, any> = {};
    async paginate() { return [[pdoc], 1, 1]; }
    url() { return '/paper-center/7/edit'; }
}

class FakeValidationError extends Error {}
const typeToken: any = () => typeToken;
const Types = new Proxy({}, { get: () => typeToken });
const param = () => () => undefined;

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === handlerPath) {
        if (request === 'hydrooj') {
            return {
                Context: class {},
                Handler: FakeHandler,
                NotFoundError: class extends Error {},
                OplogModel: { log: async () => undefined },
                param,
                PermissionError: class extends Error {},
                Types,
                ValidationError: FakeValidationError,
            };
        }
        if (request === '@hydrooj/common') return { STATUS: {} };
        if (request === '../lib/problem-config') {
            return {
                parseProblemConfigObject: () => ({ type: 'objective', answers: {} }),
                questionKindMap: () => ({}),
                subjectiveKeysOf: () => ({}),
            };
        }
        if (request === '../model/builtin') return { PERM: { PERM_EDIT_PROBLEM_SELF: 1n }, PRIV: {} };
        if (request === '../model/contest') return {};
        if (request === '../model/problem') return { default: problem, __esModule: true };
        if (request === '../model/problem-access') {
            return { buildProblemBankScope: () => ({}), canMaintainProblem: () => true };
        }
        if (request === '../model/record') return { default: {}, __esModule: true };
        if (request === '../model/user') {
            return {
                default: {
                    async getList(domainId: string) { record('userList', domainId); return { 42: { uname: 'teacher' } }; },
                },
                __esModule: true,
            };
        }
    }
    return originalLoad.call(this, request, parent, isMain);
};

let paperCenterHandlerClass: any;
let paperCenterCreateHandlerClass: any;
let paperCenterEditHandlerClass: any;
try {
    delete require.cache[handlerPath];
    ({
        PaperCenterHandler: paperCenterHandlerClass,
        PaperCenterCreateHandler: paperCenterCreateHandlerClass,
        PaperCenterEditHandler: paperCenterEditHandlerClass,
    } = require(handlerPath));
} finally {
    Module._load = originalLoad;
}

function handler(handlerClass: any) {
    const instance = Reflect.construct(handlerClass, []);
    instance.domain = { _id: 'system' };
    instance.user = { _id: 42, _problemAclDomainId: 'system' };
    instance.response = {};
    return instance;
}

async function captureFailure(run: () => Promise<unknown>) {
    try {
        await run();
        return null;
    } catch (error) {
        return error as Error;
    }
}

beforeEach(() => {
    operations.splice(0);
    maintainableResult = pdoc;
    listProjection = [];
    maintainableArgs = [];
});

describe('paper-center authoritative domain', () => {
    it('lists only from the handler domain when the method argument is forged', async () => {
        await handler(paperCenterHandlerClass).get('forged-domain', 1, '');
        expect(operations).to.deep.equal([
            { name: 'assertDomain', domainId: 'system' },
            { name: 'getMulti', domainId: 'system' },
            { name: 'getMaintainable', domainId: 'system' },
            { name: 'userList', domainId: 'system' },
        ]);
        expect(listProjection).not.to.include('config');
        expect(maintainableArgs[0].slice(0, 2)).to.deep.equal(['system', 7]);
        expect(maintainableArgs[0][3]).to.deep.equal(['config']);
        expect(maintainableArgs[0][4]).to.equal(true);
    });

    it('emits no raw-derived row when downgrade wins the stable list read', async () => {
        maintainableResult = null;
        const instance = handler(paperCenterHandlerClass);

        await instance.get('forged-domain', 1, '');

        expect(instance.response.body.rows).to.deep.equal([]);
        expect(listProjection).not.to.include('config');
        expect(operations).to.deep.equal([
            { name: 'assertDomain', domainId: 'system' },
            { name: 'getMulti', domainId: 'system' },
            { name: 'getMaintainable', domainId: 'system' },
            { name: 'userList', domainId: 'system' },
        ]);
    });

    it('creates only in the handler domain when the method argument is forged', async () => {
        await handler(paperCenterCreateHandlerClass).post('forged-domain', '新题', 'objective');
        expect(operations).to.deep.equal([
            { name: 'assertDomain', domainId: 'system' },
            { name: 'add', domainId: 'system' },
            { name: 'addTestdata', domainId: 'system' },
        ]);
    });

    it('reads and edits only in the handler domain when method arguments are forged', async () => {
        const instance = handler(paperCenterEditHandlerClass);
        await instance._prepare('forged-domain', 7);
        await instance.post('forged-domain', '题目', '', '', true, '[]');
        expect(operations).to.deep.equal([
            { name: 'assertDomain', domainId: 'system' },
            { name: 'getMaintainable', domainId: 'system' },
            { name: 'assertDomain', domainId: 'system' },
            { name: 'edit', domainId: 'system' },
            { name: 'addTestdata', domainId: 'system' },
        ]);
    });

    it('rejects raw editor config when the stable maintainer read loses the downgrade race', async () => {
        maintainableResult = null;
        const instance = handler(paperCenterEditHandlerClass);

        const error = await captureFailure(() => instance._prepare('forged-domain', 7));
        expect(error).to.be.instanceOf(Error);
        expect(operations).to.deep.equal([
            { name: 'assertDomain', domainId: 'system' },
            { name: 'getMaintainable', domainId: 'system' },
        ]);
    });
});
