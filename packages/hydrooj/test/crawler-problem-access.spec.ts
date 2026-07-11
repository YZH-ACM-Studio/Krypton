import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {} };

const PERM = { PERM_CREATE_PROBLEM: 1n };

class TestPermissionError extends Error {
    name = 'PermissionError';
    status = 403;
}
class TestForbiddenError extends Error { status = 403; }

const calls = {
    adds: [] as any[],
    addTestdata: [] as any[],
    auth: [] as any[],
    dels: [] as any[],
    delTestdata: [] as any[],
    edits: [] as any[],
    events: [] as string[],
    gets: [] as any[],
    loads: [] as any[],
    oplogs: [] as any[],
    updates: [] as any[],
};
let sourceRecord: any = null;
let keyRecord: any = null;
let winnerRecord: any = null;
let insertError: any = null;
let tokenUser: any;
let loadedAcl: any;
let loadedAclSequence: any[];
const problemDocs = new Map<number, any>();

const importColl = {
    async findOne(query: any) {
        if ('sourceUrl' in query) return winnerRecord && calls.adds.length ? winnerRecord : sourceRecord;
        return keyRecord;
    },
    async insertOne() {
        if (insertError) throw insertError;
    },
    async updateOne(...args: any[]) { calls.updates.push(args); },
};

const dbStub = {
    collection: () => importColl,
    async ensureIndexes() { return undefined; },
};

const problemStub = {
    assertProblemAclDomain(user: any, domainId: string) {
        if (!user._problemAclLoaded || user._problemAclDomainId !== domainId) throw new TestPermissionError();
    },
    canMaintainProblem(user: any, pdoc: any) {
        calls.events.push(`maintain:${pdoc?.docId || 'missing'}`);
        return !!pdoc
            && user._problemAclLoaded === true
            && user._problemAclDomainId === pdoc.domainId
            && !user._aclFencedPids.has(pdoc.docId)
            && (pdoc.owner === user._id || user._maintainedPids.has(pdoc.docId));
    },
    async get(domainId: string, docId: number) {
        calls.gets.push({ domainId, docId });
        calls.events.push(`get:${docId}`);
        return problemDocs.get(docId) || null;
    },
    async edit(domainId: string, docId: number, patch: any) {
        calls.events.push(`edit:${docId}`);
        calls.edits.push({ domainId, docId, patch });
    },
    async editAuthorized(domainId: string, docId: number, patch: any, actor: any) {
        calls.events.push(`edit:${docId}`);
        calls.edits.push({ domainId, docId, patch, actor });
    },
    async editWithClaim(claim: any, patch: any) {
        calls.events.push(`edit:${claim.pid}:claim:${claim.requestId}`);
        calls.edits.push({ domainId: claim.domainId, docId: claim.pid, patch, claim });
    },
    async withAuthorizedWriteClaim(
        domainId: string, docId: number, user: any, operation: string, work: (claim: any) => Promise<any>,
    ) {
        const loaded = await (global as any).Hydro.model.permits.loadAclForUser(domainId, user._id);
        Object.assign(user, {
            _permitPids: loaded.permitPids,
            _maintainedPids: loaded.maintainedPids,
            _aclFencedPids: loaded.fencedPids,
            _problemAclDomainId: domainId,
            _problemAclLoaded: true,
        });
        const pdoc = problemDocs.get(docId);
        if (!problemStub.canMaintainProblem(user, pdoc)) throw new TestPermissionError();
        calls.events.push(`claim:${operation}:${docId}`);
        return work({ domainId, pid: docId, actor: user._id, requestId: `claim-${docId}` });
    },
    async add(...args: any[]) {
        calls.events.push('add');
        calls.adds.push(args);
        return 500;
    },
    async del(...args: any[]) { calls.events.push('del'); calls.dels.push(args); },
    async addTestdata(...args: any[]) {
        calls.events.push(`addTestdata:${args[2]}`);
        calls.addTestdata.push(args);
    },
    async delTestdata(...args: any[]) {
        calls.events.push('delTestdata');
        calls.delTestdata.push(args);
    },
    async addTestdataWithClaim(claim: any, ...args: any[]) {
        calls.events.push(`addTestdata:${args[0]}:claim:${claim.requestId}`);
        calls.addTestdata.push([claim.domainId, claim.pid, ...args]);
    },
    async delTestdataWithClaim(claim: any, ...args: any[]) {
        calls.events.push(`delTestdata:claim:${claim.requestId}`);
        calls.delTestdata.push([claim.domainId, claim.pid, ...args]);
    },
};

function noopDecorator() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}
class HandlerStub { }
const hydroojStub = {
    Context: class { },
    Handler: HandlerStub,
    OplogModel: { async log(...args: any[]) { calls.oplogs.push(args); } },
    param: noopDecorator,
    PERM,
    PermissionError: TestPermissionError,
    Types: new Proxy({}, { get: () => () => ({}) }),
};

async function requireAuthTokenStub(handler: any, channel: string) {
    calls.auth.push(channel);
    handler.user = tokenUser;
    return { doc: { uid: tokenUser._id, domainId: 'token-domain' }, channels: [channel] };
}

class TestLogger {
    error() { return undefined; }
}

const routes: Record<string, any> = {};
const crawlerPath = require.resolve('../src/handler/crawler.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    const fromCrawler = parent?.filename === crawlerPath;
    if (fromCrawler && request === 'hydrooj') return hydroojStub;
    if (fromCrawler && request === '../error') {
        return { ForbiddenError: TestForbiddenError, PermissionError: TestPermissionError };
    }
    if (fromCrawler && request === '../lib/auth-token') return { requireAuthToken: requireAuthTokenStub };
    if (fromCrawler && request === '../logger') return { Logger: TestLogger };
    if (fromCrawler && request === '../model/problem') return problemStub;
    if (fromCrawler && request === '../service/db') return dbStub;
    return originalLoad.call(this, request, parent, isMain);
};

let crawlerModule: typeof import('../src/handler/crawler');
try {
    delete require.cache[crawlerPath];
    crawlerModule = require(crawlerPath);
} finally {
    Module._load = originalLoad;
}

void crawlerModule.apply({
    Route(name: string, _path: string, HandlerClass: any) { routes[name] = HandlerClass; },
} as any);

function makeUser(uid = 42, overrides: Record<string, unknown> = {}) {
    return {
        _id: uid,
        uname: `user-${uid}`,
        _problemAclLoaded: false,
        _problemAclDomainId: undefined,
        _permitPids: new Set<number>(),
        _maintainedPids: new Set<number>(),
        _aclFencedPids: new Set<number>(),
        hasPerm: (perm: bigint) => perm === PERM.PERM_CREATE_PROBLEM,
        ...overrides,
    } as any;
}

function makeHandler(route: string) {
    const handler = new routes[route]();
    Object.assign(handler, {
        request: { headers: { 'x-service-token': 'kat_test' } },
        response: { body: {} },
        user: makeUser(0),
        checkPerm(perm: bigint) {
            if (!this.user.hasPerm(perm)) throw new TestPermissionError();
        },
    });
    return handler;
}

async function captureFailure(callback: () => Promise<unknown>) {
    try {
        await callback();
        return null;
    } catch (error) {
        return error as Error;
    }
}

beforeEach(() => {
    for (const value of Object.values(calls)) value.length = 0;
    sourceRecord = null;
    keyRecord = null;
    winnerRecord = null;
    insertError = null;
    problemDocs.clear();
    tokenUser = makeUser();
    loadedAcl = { permitPids: new Set<number>(), maintainedPids: new Set<number>(), fencedPids: new Set<number>() };
    loadedAclSequence = [];
    (global as any).Hydro.model.permits = {
        async loadAclForUser(domainId: string, uid: number) {
            calls.loads.push({ domainId, uid });
            return loadedAclSequence.length ? loadedAclSequence.shift() : loadedAcl;
        },
    };
});

describe('crawler problem ACL', () => {
    it('reloads fail-closed ACL state for the token-bound user and token domain', async () => {
        loadedAcl = { permitPids: new Set([12]), maintainedPids: new Set([12]), fencedPids: new Set([13]) };
        const handler = makeHandler('crawler_problem');
        await handler.prepare();
        expect(calls.loads).to.deep.equal([{ domainId: 'token-domain', uid: 42 }]);
        expect(handler.user).to.equal(tokenUser);
        expect(tokenUser._problemAclLoaded).to.equal(true);
        expect(tokenUser._problemAclDomainId).to.equal('token-domain');
        expect([...tokenUser._maintainedPids]).to.deep.equal([12]);
        expect([...tokenUser._aclFencedPids]).to.deep.equal([13]);
    });

    it('fails closed and clears stale markers when token-domain ACL reload fails', async () => {
        Object.assign(tokenUser, {
            _problemAclLoaded: true,
            _problemAclDomainId: 'stale-domain',
            _permitPids: new Set([99]),
            _maintainedPids: new Set([99]),
            _aclFencedPids: new Set<number>(),
        });
        (global as any).Hydro.model.permits.loadAclForUser = async () => { throw new Error('db down'); };
        const handler = makeHandler('crawler_problem');
        const error = await captureFailure(() => handler.prepare());
        expect(error?.name).to.equal('PermissionError');
        expect(tokenUser._problemAclLoaded).to.equal(false);
        expect(tokenUser._problemAclDomainId).to.equal(undefined);
        expect([...tokenUser._permitPids]).to.deep.equal([]);
        expect(calls.edits).to.deep.equal([]);
    });

    it('makes a missing and an unauthorized existing statement target indistinguishable with zero writes', async () => {
        sourceRecord = { _id: 'row', domainId: 'token-domain', sourceUrl: 'https://source', docId: 20, pid: 'P20' };
        const run = async (pdoc: any) => {
            calls.edits.length = 0;
            calls.updates.length = 0;
            problemDocs.clear();
            if (pdoc) problemDocs.set(20, pdoc);
            const handler = makeHandler('crawler_problem');
            await handler.prepare();
            return captureFailure(() => handler.post(
                {}, 'Title', 'Content', 'https://source', 'src', '', 1, 'A', '1000ms', '256m',
            ));
        };
        const missing = await run(null);
        const unauthorized = await run({ domainId: 'token-domain', docId: 20, owner: 7, hidden: true });
        expect(missing?.name).to.equal('PermissionError');
        expect(unauthorized?.name).to.equal('PermissionError');
        expect(calls.edits).to.deep.equal([]);
        expect(calls.updates).to.deep.equal([]);
    });

    it('does not mutate testdata or publish an unauthorized target and returns the same not_found shape', async () => {
        keyRecord = { domainId: 'token-domain', cid: 1, problemId: 'A', docId: 30, timeLimit: '1s', memoryLimit: '256m' };
        problemDocs.set(30, { domainId: 'token-domain', docId: 30, owner: 7, hidden: true, data: [] });
        const handler = makeHandler('crawler_testdata');
        await handler.prepare();
        await handler.post({}, [{ cid: 1, problemId: 'A', cases: [{ input: '1', output: '2' }] }]);
        expect(handler.response.body.results).to.deep.equal([
            { cid: 1, problemId: 'A', ok: false, error: 'not_found' },
        ]);
        expect(calls.delTestdata).to.deep.equal([]);
        expect(calls.addTestdata).to.deep.equal([]);
        expect(calls.edits).to.deep.equal([]);
    });

    it('acquires one canonical write claim before testdata and retains it through publish', async () => {
        loadedAcl.maintainedPids.add(30);
        keyRecord = { domainId: 'token-domain', cid: 1, problemId: 'A', docId: 30, timeLimit: '1s', memoryLimit: '256m' };
        problemDocs.set(30, {
            domainId: 'token-domain', docId: 30, owner: 7, hidden: true,
            data: [{ name: 'old.in' }],
        });
        const handler = makeHandler('crawler_testdata');
        await handler.prepare();
        await handler.post({}, [{ cid: 1, problemId: 'A', cases: [{ input: '1', output: '2' }] }]);
        const firstMutation = calls.events.findIndex((event) => event.startsWith('delTestdata') || event.startsWith('addTestdata'));
        const claim = calls.events.indexOf('claim:crawler-testdata-replace:30');
        const publish = calls.events.findIndex((event) => event.startsWith('edit:30:claim:'));
        const maintainIndexes = calls.events
            .map((event, index) => event === 'maintain:30' ? index : -1)
            .filter((index) => index >= 0);
        expect(maintainIndexes).to.have.length.at.least(2);
        expect(maintainIndexes[0]).to.be.lessThan(firstMutation);
        expect(maintainIndexes.at(-1)).to.be.lessThan(claim);
        expect(claim).to.be.lessThan(firstMutation);
        expect(firstMutation).to.be.lessThan(publish);
        expect(calls.edits).to.have.length(1);
    });

    it('loses the write-claim race to a newly fenced target before any storage mutation', async () => {
        const maintained = {
            permitPids: new Set([30]), maintainedPids: new Set([30]), fencedPids: new Set<number>(),
        };
        const fenced = {
            permitPids: new Set([30]), maintainedPids: new Set([30]), fencedPids: new Set([30]),
        };
        // prepare, target preflight, atomic write-claim authorization
        loadedAclSequence = [maintained, maintained, fenced];
        keyRecord = { domainId: 'token-domain', cid: 1, problemId: 'A', docId: 30, timeLimit: '1s', memoryLimit: '256m' };
        problemDocs.set(30, { domainId: 'token-domain', docId: 30, owner: 7, hidden: true, data: [] });
        const handler = makeHandler('crawler_testdata');
        await handler.prepare();
        await handler.post({}, [{ cid: 1, problemId: 'A', cases: [{ input: '1', output: '2' }] }]);
        expect(calls.loads).to.have.length(3);
        expect(handler.response.body.results[0]).to.include({ ok: false, error: 'not_found' });
        expect(calls.addTestdata).to.deep.equal([]);
        expect(calls.delTestdata).to.deep.equal([]);
        expect(calls.edits).to.deep.equal([]);
    });

    it('does not overwrite an unauthorized concurrent-race winner', async () => {
        sourceRecord = null;
        winnerRecord = { _id: 'winner', domainId: 'token-domain', sourceUrl: 'https://source', docId: 40, pid: 'P40' };
        problemDocs.set(40, { domainId: 'token-domain', docId: 40, owner: 7, hidden: true });
        insertError = Object.assign(new Error('duplicate'), { code: 11000 });
        const handler = makeHandler('crawler_problem');
        await handler.prepare();
        const error = await captureFailure(() => handler.post(
            {}, 'Title', 'Content', 'https://source', 'src', '', 1, 'A', '1000ms', '256m',
        ));
        expect(error?.name).to.equal('PermissionError');
        expect(calls.edits).to.deep.equal([]);
        expect(calls.dels).to.have.length(1);
    });
});
