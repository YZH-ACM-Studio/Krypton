import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId as MongoObjectId } from 'mongodb';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {} };
let homeworkGroupIds: MongoObjectId[] = [];
(global as any).Hydro.model.userbind = {
    async findStudentByUserId() { return { groupIds: homeworkGroupIds }; },
};
const homeworkAccessModule = require('../src/model/homework-access.ts');
const actualBuiltin = require('../src/model/builtin.ts');

const PERM = { PERM_VIEW_PROBLEM: 1n };
const PRIV = { PRIV_USER_PROFILE: 1 };
const calls = {
    getList: [] as any[],
    getListStatus: [] as any[],
    getMulti: [] as any[],
    getMultiStatus: [] as any[],
    getViewableAuthorized: [] as any[],
    homeworkQueries: [] as any[],
};
let recentDocs: any[] = [];
let starredDocs: Record<string, any> = {};
let starredStatuses: any[] = [];

function cursor(docs: any[]) {
    const state = { limit: Infinity };
    const value: any = {
        limit(limit: number) { state.limit = limit; return value; },
        sort() { return value; },
        async toArray() { return docs.slice(0, state.limit); },
    };
    return value;
}

const problemStub = {
    buildProblemBankScope: (user: any) => user.problemBankScope,
    canBrowseProblemBank: (user: any) => user.canBrowseProblemBank === true,
    getList(...args: any[]) {
        calls.getList.push(args);
        return Promise.resolve(starredDocs);
    },
    getListStatus(...args: any[]) {
        calls.getListStatus.push(args);
        return Promise.resolve({});
    },
    getMulti(domainId: string, query: unknown) {
        calls.getMulti.push({ domainId, query: structuredClone(query) });
        return cursor(recentDocs);
    },
    getMultiStatus(domainId: string, query: unknown) {
        calls.getMultiStatus.push({ domainId, query: structuredClone(query) });
        return cursor(starredStatuses);
    },
    async getViewableAuthorized(domainId: string, pid: number, user: any) {
        calls.getViewableAuthorized.push({ domainId, pid, user });
        return user.viewableProblemIds.has(pid) ? starredDocs[pid] || null : null;
    },
};

const contestStub = {
    getMulti(domainId: string, query: unknown) {
        calls.homeworkQueries.push({ domainId, query });
        return cursor([]);
    },
    async getListStatus() { return {}; },
};

const userStub = {
    async listGroup() { return []; },
};

function noopDecorator() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}

class HandlerStub { }
class GenericError extends Error { }
const emptyModel = new Proxy({}, { get: () => () => undefined });
const serverStub = {
    Handler: HandlerStub,
    param: noopDecorator,
    query: noopDecorator,
    requireSudo: (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
    Types: new Proxy({}, { get: () => () => ({}) }),
};
const errors = new Proxy({}, { get: () => GenericError });

const homePath = require.resolve('../src/handler/home.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (request === 'mongodb') {
        return {
            Binary: class Binary { constructor(public buffer: Buffer) { } },
            ObjectId: class ObjectId { },
        };
    }
    if (request === '../error') return errors;
    if (request === '../lib/avatar') {
        return { __esModule: true, default: () => '', validate: () => true };
    }
    if (request === '../model/builtin') return { PERM, PRIV };
    if (request === '../model/contest') return contestStub;
    if (request === '../model/homework-access') return homeworkAccessModule;
    if (request === '../model/problem') return problemStub;
    if (request === '../model/user') return userStub;
    if (request === '../service/server') return serverStub;
    if (request === '../utils') return { camelCase: (value: string) => value, md5: (value: string) => value };
    if (request.startsWith('../model/') || request.startsWith('../lib/')) return emptyModel;
    return originalLoad.call(this, request, parent, isMain);
};

// Mirrors the exported handler class name while allowing cache restoration below.
// eslint-disable-next-line ts/naming-convention
let HomeHandlerClass: any;
try {
    delete require.cache[homePath];
    ({ HomeHandler: HomeHandlerClass } = require(homePath));
} finally {
    Module._load = originalLoad;
}

function makeUser(overrides: Record<string, unknown> = {}) {
    return {
        _id: 42,
        _problemAclDomainId: 'system',
        _problemAclLoaded: true,
        canBrowseProblemBank: true,
        problemBankScope: { $or: [{ owner: 42 }, { docId: { $in: [7] } }] },
        viewableProblemIds: new Set<number>(),
        hasPerm: (...perms: bigint[]) => perms.includes(PERM.PERM_VIEW_PROBLEM),
        hasPriv: () => false,
        own: () => false,
        group: [],
        ...overrides,
    } as any;
}

function makeHandler(user: any) {
    const handler = new HomeHandlerClass();
    Object.assign(handler, {
        domain: { _id: 'system' },
        response: { body: {} },
        user,
    });
    return handler as any;
}

beforeEach(() => {
    for (const values of Object.values(calls)) values.length = 0;
    recentDocs = [];
    starredDocs = {};
    starredStatuses = [];
    homeworkGroupIds = [];
});

describe('P2.11 homepage problem enumeration', () => {
    it('returns no recent problems and performs no query without problem-bank browse capability', async () => {
        const handler = makeHandler(makeUser({ canBrowseProblemBank: false }));

        expect(await handler.getRecentProblems('system', 10)).to.deep.equal([[], {}]);
        expect(calls.getMulti).to.deep.equal([]);
        expect(calls.getListStatus).to.deep.equal([]);
    });

    it('fails closed before every problem query when the requested domain or ACL marker is forged', async () => {
        const forged = makeHandler(makeUser());
        const wrongMarker = makeHandler(makeUser({ _problemAclDomainId: 'other' }));

        expect(await forged.getRecentProblems('other', 10)).to.deep.equal([[], {}]);
        expect(await wrongMarker.getRecentProblems('system', 10)).to.deep.equal([[], {}]);
        expect(await forged.getStarredProblems('other', 10)).to.deep.equal([[], {}]);
        expect(await wrongMarker.getStarredProblems('system', 10)).to.deep.equal([[], {}]);
        expect(calls.getMulti).to.deep.equal([]);
        expect(calls.getMultiStatus).to.deep.equal([]);
        expect(calls.getList).to.deep.equal([]);
    });

    it('pushes the canonical author scope and published predicate into the recent Mongo query', async () => {
        recentDocs = [{ domainId: 'system', docId: 7, hidden: false }];
        const user = makeUser({ hasPriv: () => true });
        const handler = makeHandler(user);

        const [pdocs] = await handler.getRecentProblems('system', 10);

        expect(pdocs).to.deep.equal(recentDocs);
        expect(calls.getMulti).to.deep.equal([{
            domainId: 'system',
            query: {
                $and: [
                    user.problemBankScope,
                    { hidden: false },
                ],
            },
        }]);
        expect(calls.getListStatus).to.have.lengthOf(1);
    });

    it('resolves only known starred ids through the stable direct-read boundary', async () => {
        starredStatuses = [{ docId: 7 }, { docId: 8 }, { docId: 9 }];
        starredDocs = {
            7: { domainId: 'system', docId: 7, hidden: true },
            8: { domainId: 'system', docId: 8, hidden: true, maintainer: [42] },
            9: { domainId: 'system', docId: 9, hidden: false },
        };
        const user = makeUser({ viewableProblemIds: new Set([7]) });
        const handler = makeHandler(user);

        expect(await handler.getStarredProblems('system', 50)).to.deep.equal([[starredDocs[7]]]);
        expect(calls.getList).to.deep.equal([]);
        expect(calls.getViewableAuthorized.map(({ domainId, pid }) => ({ domainId, pid }))).to.deep.equal([
            { domainId: 'system', pid: 7 },
            { domainId: 'system', pid: 8 },
            { domainId: 'system', pid: 9 },
        ]);
    });
});

describe('P3.7 homepage homework scope', () => {
    it('pushes the bound group into the homepage query before applying the limit', async () => {
        const groupId = new MongoObjectId('aaaaaaaaaaaaaaaaaaaaaaaa');
        homeworkGroupIds = [groupId];
        const user = makeUser({
            hasPerm: (...perms: bigint[]) => perms.some((perm) => (
                perm === undefined
                || perm === PERM.PERM_VIEW_PROBLEM
                || perm === actualBuiltin.PERM.PERM_VIEW_HOMEWORK
            )),
        });
        const handler = makeHandler(user);

        await handler.getHomework('system', 5);

        const query = calls.homeworkQueries[0].query;
        const participantClause = query.$or[2].$and[1].$or[2];
        expect(participantClause.participantScopeMode).to.equal('groups');
        expect(participantClause.participantGroupIds.$in.map(String)).to.deep.equal([String(groupId)]);
    });
});
