import { createRequire } from 'node:module';
import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const framework = require('../../../framework/framework');
const Module = require('module');
const requireFromFramework = createRequire(require.resolve('../../../framework/framework/package.json'));
const { ObjectId } = requireFromFramework('mongodb');

class TestPermissionError extends Error {
    name = 'PermissionError';
}

const calls = {
    contestGet: [] as any[],
    permitFind: [] as any[],
    permitList: [] as any[],
    problemGet: [] as any[],
    maintain: [] as any[],
    revoke: [] as any[],
    writeClaim: [] as any[],
    userGet: [] as any[],
    userList: [] as any[],
};

const permitId = new ObjectId();
const contestId = new ObjectId();
const pdoc = { domainId: 'system', docId: 42, pid: 42, owner: 1, title: 'P42' };
let stableProblemResults: any[] = [];
let maintainResults: boolean[] = [];
let rosterProvider: () => Promise<any[]> = async () => [];

const permitsColl = {
    async findOne(filter: any) {
        calls.permitFind.push(filter);
        return {
            _id: permitId,
            domainId: 'system',
            pid: 42,
            uid: 8,
            active: true,
            role: 'verifier',
        };
    },
};

const permitsModel = {
    async grant() {
        throw new Error('unexpected grant');
    },
    async grantBulkViaContest() {
        throw new Error('unexpected contest grant');
    },
    async listForProblem(...args: any[]) {
        calls.permitList.push(args);
        return rosterProvider();
    },
    async listForUser(...args: any[]) {
        calls.permitList.push(args);
        return [];
    },
    async revoke(...args: any[]) {
        calls.revoke.push(args);
        return true;
    },
    async revokeContestUser() {
        throw new Error('unexpected contest revoke');
    },
    async syncContestCurrentPids() {
        throw new Error('unexpected contest sync');
    },
};

const hydroojStub = {
    ...framework,
    ContestModel: {
        async get(...args: any[]) {
            calls.contestGet.push(args);
            return {
                _id: contestId,
                domainId: 'system',
                owner: 1,
                pids: [42],
                title: 'C',
                verifiers: [],
            };
        },
        async edit() {
            throw new Error('unexpected contest edit');
        },
    },
    Handler: framework.Handler,
    NotFoundError: Error,
    ObjectId,
    param: framework.param,
    PERM: {
        PERM_EDIT_CONTEST: 1n,
        PERM_VIEW_CONTEST: 2n,
        PERM_VIEW_PROBLEM: 4n,
    },
    PermissionError: TestPermissionError,
    PRIV: { PRIV_USER_PROFILE: 1 },
    PrivilegeError: Error,
    ProblemModel: {
        PROJECTION_LIST: {},
        async get(...args: any[]) {
            calls.problemGet.push(args);
            return pdoc;
        },
        async getList() {
            return {};
        },
        async getViewableAuthorized(...args: any[]) {
            calls.problemGet.push(args);
            return stableProblemResults.length ? stableProblemResults.shift() : pdoc;
        },
        async withAuthorizedWriteClaim(...args: any[]) {
            calls.writeClaim.push(args.slice(0, 4).concat(args[5]));
            const work = args[4];
            const requestId = args[5]?.requestId || 'generated-claim';
            return work({ domainId: args[0], pid: args[1], actor: 1, requestId, state: 'active' });
        },
    },
    Types: framework.Types,
    UserModel: {
        async getById(...args: any[]) {
            calls.userGet.push(args);
            return { _id: args[1] };
        },
        async getList(...args: any[]) {
            calls.userList.push(args);
            return {};
        },
    },
    ValidationError: Error,
};

const handlerPath = require.resolve('../src/handler.ts');
const dbPath = require.resolve('../src/db.ts');
const modelPath = require.resolve('../src/model.ts');
const previousDbCache = require.cache[dbPath];
const previousModelCache = require.cache[modelPath];
const originalLoad = Module._load;
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { permitsColl },
} as NodeModule;
require.cache[modelPath] = {
    id: modelPath,
    filename: modelPath,
    loaded: true,
    exports: { permitsModel },
} as NodeModule;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (request === 'hydrooj') return hydroojStub;
    if (request === '@hydrooj/utils') {
        return {
            Logger: class {
                error() {}
            },
        };
    }
    if (request === 'hydrooj/src/model/message') {
        return {
            default: {
                FLAG_UNREAD: 1,
                async send() {
                    return undefined;
                },
            },
        };
    }
    if (request === 'hydrooj/src/model/problem-access') {
        return {
            canMaintainProblem: (...args: any[]) => {
                calls.maintain.push(args);
                return maintainResults.length ? maintainResults.shift() : true;
            },
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let applyHandlers: (ctx: any) => void;
try {
    delete require.cache[handlerPath];
    ({ applyHandlers } = require(handlerPath));
} finally {
    Module._load = originalLoad;
    if (previousDbCache) require.cache[dbPath] = previousDbCache;
    else delete require.cache[dbPath];
    if (previousModelCache) require.cache[modelPath] = previousModelCache;
    else delete require.cache[modelPath];
}

const routes = new Map<string, any>();
applyHandlers({
    Route(name: string, _path: string, HandlerClass: any) {
        routes.set(name, HandlerClass);
    },
});

function makeHandler(route: string) {
    const HandlerClass = routes.get(route);
    const handler = Object.create(HandlerClass.prototype);
    Object.assign(handler, {
        domain: { _id: 'system' },
        response: { body: undefined },
        user: {
            _id: 1,
            uname: 'root',
            hasPerm: () => true,
            hasPriv: () => true,
            own: () => true,
        },
    });
    return handler as any;
}

function readCount() {
    return (
        calls.contestGet.length +
        calls.permitFind.length +
        calls.permitList.length +
        calls.problemGet.length +
        calls.userGet.length +
        calls.userList.length
    );
}

async function capture(run: () => Promise<unknown>) {
    try {
        await run();
        return null;
    } catch (error) {
        return error as Error;
    }
}

beforeEach(() => {
    for (const entries of Object.values(calls)) entries.length = 0;
    stableProblemResults = [];
    maintainResults = [];
    rosterProvider = async () => [];
});

describe('permit handler authoritative domain boundary', () => {
    const forged = { domainId: 'evil' };
    const spoofedCalls: Array<[string, (handler: any) => Promise<unknown>]> = [
        ['problem_permit_grant GET', (handler) => handler.get(forged, 42)],
        ['problem_permit_grant POST', (handler) => handler.post(forged, 42, 8, undefined, 'verifier', '', undefined)],
        ['problem_permit_revoke POST', (handler) => handler.post(forged, 42, permitId, undefined)],
        ['contest_verifier_add POST', (handler) => handler.post(forged, contestId, 8, 'verifier', '', undefined)],
        ['contest_verifier_remove POST', (handler) => handler.post(forged, contestId, 8, undefined)],
        ['my_verify_inbox GET', (handler) => handler.get(forged)],
    ];

    for (const [name, invoke] of spoofedCalls) {
        it(`rejects forged domain before reads or writes: ${name}`, async () => {
            const route = name.split(' ')[0];
            const error = await capture(() => invoke(makeHandler(route)));
            expect(error?.name).to.equal('PermissionError');
            expect(readCount()).to.equal(0);
            expect(calls.revoke).to.have.lengthOf(0);
        });
    }

    it('uses the authoritative handler domain for a legitimate revoke', async () => {
        const handler = makeHandler('problem_permit_revoke');
        await handler.post({ domainId: 'system' }, 42, permitId, 'retry-1');

        expect(calls.problemGet).to.deep.equal([['system', 42, handler.user]]);
        expect(calls.permitFind[0]).to.include({ domainId: 'system', pid: 42 });
        expect(calls.revoke[0][0]).to.equal('system');
        expect(calls.writeClaim[0]).to.deep.equal(['system', 42, handler.user, 'permit-revoke', { requestId: 'retry-1', selfRevokeUid: undefined }]);
        expect(calls.revoke[0][2]).to.include({
            requestId: 'retry-1',
            actor: 1,
            writeClaimRequestId: 'retry-1',
        });
    });

    it('discards a loaded roster when maintainer access is revoked before the final stable check', async () => {
        const handler = makeHandler('problem_permit_grant');
        const secretRow = { uid: 8, grantedBy: 1, role: 'verifier' };
        stableProblemResults = [pdoc, null];
        rosterProvider = async () => [secretRow];

        const error = await capture(() => handler.get({ domainId: 'system' }, 42));

        expect(error?.name).to.equal('PermissionError');
        expect(handler.response.body).to.equal(undefined);
        expect(calls.permitList).to.deep.equal([['system', 42]]);
        expect(calls.problemGet).to.deep.equal([
            ['system', 42, handler.user],
            ['system', 42, handler.user],
        ]);
    });

    it('returns a concurrently granted roster row only after a second stable maintainer check', async () => {
        const handler = makeHandler('problem_permit_grant');
        const granted = { uid: 9, grantedBy: 1, role: 'maintainer' };
        stableProblemResults = [pdoc, pdoc];
        maintainResults = [true, true];
        rosterProvider = async () => [granted];

        await handler.get({ domainId: 'system' }, 42);

        expect(handler.response.body.permits).to.deep.equal([granted]);
        expect(calls.problemGet).to.have.lengthOf(2);
        expect(calls.maintain).to.have.lengthOf(2);
    });

    it('rejects when the problem remains viewable but the final maintainer capability was downgraded', async () => {
        const handler = makeHandler('problem_permit_grant');
        stableProblemResults = [pdoc, pdoc];
        maintainResults = [true, false];
        rosterProvider = async () => [{ uid: 10, grantedBy: 1, role: 'verifier' }];

        const error = await capture(() => handler.get({ domainId: 'system' }, 42));

        expect(error?.name).to.equal('PermissionError');
        expect(handler.response.body).to.equal(undefined);
        expect(calls.maintain).to.have.lengthOf(2);
    });
});
