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
    manageCollaborators: [] as any[],
    manageContributions: [] as any[],
    manageMaintainers: [] as any[],
    oplog: [] as any[],
    grant: [] as any[],
    revoke: [] as any[],
    contributionAssign: [] as any[],
    contributionList: [] as any[],
    contributionRevoke: [] as any[],
    contributionStatus: [] as any[],
    contributionUserList: [] as any[],
    writeClaim: [] as any[],
    userGet: [] as any[],
    userList: [] as any[],
};

const permitId = new ObjectId();
const contestId = new ObjectId();
const pdoc = { domainId: 'system', docId: 42, pid: 42, owner: 1, title: 'P42' };
let stableProblemResults: any[] = [];
let maintainResults: boolean[] = [];
let manageCollaboratorResults: boolean[] = [];
let manageContributionResults: boolean[] = [];
let manageMaintainerResults: boolean[] = [];
let permitRow: any = null;
let permitFindOneResults: any[] = [];
let rawProblemResults: any[] = [];
let permitSourceRows: any[] = [];
let rosterProvider: () => Promise<any[]> = async () => [];
let contributionRows: any[] = [];
let contributionAssignFailures: Array<Error | null> = [];
let userGetResults: any[] = [];

function rowsMatchingTargets(rows: any[], filter: any) {
    const targetUids = filter.uid?.$in;
    return rows.filter(
        (row) => row.domainId === filter.domainId && row.pid === filter.pid && (!targetUids || targetUids.includes(row.uid)) && row.active !== false,
    );
}

const permitsColl = {
    async findOne(filter: any) {
        calls.permitFind.push(filter);
        if (permitFindOneResults.length) return permitFindOneResults.shift();
        return (
            permitRow || {
                _id: permitId,
                domainId: 'system',
                pid: 42,
                uid: 8,
                active: true,
                role: 'verifier',
            }
        );
    },
    find(filter: any) {
        calls.permitFind.push(filter);
        const defaultRow = {
            _id: permitId,
            domainId: 'system',
            pid: 42,
            uid: 8,
            active: true,
            role: 'verifier',
        };
        const rows = rowsMatchingTargets([permitRow || defaultRow], filter);
        return {
            project() {
                return {
                    async toArray() {
                        return rows;
                    },
                };
            },
        };
    },
};

const permitSourcesColl = {
    find(filter: any) {
        const rows = rowsMatchingTargets(permitSourceRows, filter);
        return {
            project() {
                return {
                    async toArray() {
                        return rows;
                    },
                };
            },
        };
    },
};

const permitsModel = {
    async grant(...args: any[]) {
        calls.grant.push(args);
        return { active: true };
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
    async assignContribution(input: any) {
        calls.contributionAssign.push(input);
        const failure = contributionAssignFailures.shift();
        if (failure) throw failure;
        return input;
    },
    async listContributionsForProblem(...args: any[]) {
        calls.contributionList.push(args);
        return contributionRows;
    },
    async listContributionsForUser(...args: any[]) {
        calls.contributionUserList.push(args);
        return contributionRows;
    },
    async revokeContribution(input: any) {
        calls.contributionRevoke.push(input);
        return input;
    },
    async setContributionStatus(input: any) {
        calls.contributionStatus.push(input);
        return input;
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
    OplogModel: {
        async log(...args: any[]) {
            calls.oplog.push(args);
        },
    },
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
            return rawProblemResults.length ? rawProblemResults.shift() : pdoc;
        },
        async getList() {
            return {};
        },
        async getViewableAuthorized(...args: any[]) {
            calls.problemGet.push(args);
            return stableProblemResults.length ? stableProblemResults.shift() : pdoc;
        },
        async refreshProblemAcl() {
            return undefined;
        },
        assertProblemAclDomain() {},
        canMaintainProblem(...args: any[]) {
            calls.maintain.push(args);
            return maintainResults.length ? maintainResults.shift() : true;
        },
        canManageProblemCollaborators(...args: any[]) {
            calls.manageCollaborators.push(args);
            return manageCollaboratorResults.length ? manageCollaboratorResults.shift() : true;
        },
        canManageProblemContributions(...args: any[]) {
            calls.manageContributions.push(args);
            return manageContributionResults.length ? manageContributionResults.shift() : true;
        },
        canManageProblemMaintainers(...args: any[]) {
            calls.manageMaintainers.push(args);
            return manageMaintainerResults.length ? manageMaintainerResults.shift() : true;
        },
        async withAuthorizedWriteClaim(...args: any[]) {
            calls.writeClaim.push(args.slice(0, 4).concat(args[5]));
            const work = args[4];
            const requestId = args[5]?.requestId || 'generated-claim';
            return work({
                domainId: args[0],
                pid: args[1],
                actor: 1,
                requestId,
                capability: args[5]?.capability || 'maintain',
                state: 'active',
            });
        },
    },
    Types: framework.Types,
    UserModel: {
        async getById(...args: any[]) {
            calls.userGet.push(args);
            return userGetResults.length ? userGetResults.shift() : { _id: args[1] };
        },
        async getList(...args: any[]) {
            calls.userList.push(args);
            return Object.fromEntries((args[1] || []).map((uid: number) => [uid, { _id: uid, uname: `u${uid}` }]));
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
    exports: { permitsColl, permitSourcesColl },
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
                info() {}
                warn() {}
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
        request: { body: {} },
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
        calls.contributionList.length +
        calls.contributionUserList.length +
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
    manageCollaboratorResults = [];
    manageContributionResults = [];
    manageMaintainerResults = [];
    permitRow = null;
    permitFindOneResults = [];
    rawProblemResults = [];
    permitSourceRows = [];
    rosterProvider = async () => [];
    contributionRows = [];
    contributionAssignFailures = [];
    userGetResults = [];
});

describe('permit handler authoritative domain boundary', () => {
    const forged = { domainId: 'evil' };
    const spoofedCalls: Array<[string, (handler: any) => Promise<unknown>]> = [
        ['problem_permit_grant GET', (handler) => handler.get(forged, 42)],
        ['problem_permit_grant POST', (handler) => handler.post(forged, 42, 8, undefined, 'verifier', '', undefined)],
        ['problem_permit_revoke POST', (handler) => handler.post(forged, 42, permitId, undefined)],
        ['problem_contribution GET', (handler) => handler.get(forged, 42)],
        ['problem_contribution POST', (handler) => handler.post(forged, 42, 8, 'data', '', 'assign-data')],
        ['problem_contribution_revoke POST', (handler) => handler.post(forged, 42, 8, 'data', 'revoke-data')],
        ['problem_contribution_bulk POST', (handler) => handler.post(forged, [42], '{"42":0}', 8, 'data', '', 'bulk-data')],
        ['problem_contribution_status POST', (handler) => handler.post(forged, 42, 'data', 'completed', undefined, 'complete-data')],
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

    it('binds contribution assignment and revocation to the exact contributions claim', async () => {
        const assign = makeHandler('problem_contribution');
        stableProblemResults = [pdoc];
        rawProblemResults = [pdoc];
        await assign.post({ domainId: 'system' }, 42, 8, 'data', 'prepare cases', 'assign-data');

        expect(calls.writeClaim[0]).to.deep.equal([
            'system',
            42,
            assign.user,
            'contribution-assign',
            { requestId: 'acl:problem-contribution-assign:system:42:8:data:assign-data', capability: 'contributions' },
        ]);
        expect(calls.contributionAssign[0]).to.deep.include({
            domainId: 'system',
            pid: 42,
            uid: 8,
            scope: 'data',
            actor: 1,
            note: 'prepare cases',
            requestId: 'acl:problem-contribution-assign:system:42:8:data:assign-data',
            writeClaimRequestId: 'acl:problem-contribution-assign:system:42:8:data:assign-data',
        });

        const revoke = makeHandler('problem_contribution_revoke');
        stableProblemResults = [pdoc];
        rawProblemResults = [pdoc];
        await revoke.post({ domainId: 'system' }, 42, 8, 'data', 'revoke-data');

        expect(calls.writeClaim[1]).to.deep.equal([
            'system',
            42,
            revoke.user,
            'contribution-revoke',
            { requestId: 'acl:problem-contribution-revoke:system:42:8:data:revoke-data', capability: 'contributions' },
        ]);
        expect(calls.contributionRevoke[0]).to.deep.include({
            domainId: 'system',
            pid: 42,
            uid: 8,
            scope: 'data',
            actor: 1,
            requestId: 'acl:problem-contribution-revoke:system:42:8:data:revoke-data',
            writeClaimRequestId: 'acl:problem-contribution-revoke:system:42:8:data:revoke-data',
        });
    });

    it('lets an active assignee complete only their own contribution without delegating', async () => {
        const status = makeHandler('problem_contribution_status');
        stableProblemResults = [pdoc];
        contributionRows = [{ domainId: 'system', pid: 42, uid: 1, scope: 'tag', active: true, status: 'pending' }];

        await status.post({ domainId: 'system' }, 42, 'tag', 'completed', undefined, 'complete-tag');

        expect(calls.writeClaim[0]).to.deep.equal([
            'system',
            42,
            status.user,
            'contribution-status',
            { requestId: 'acl:problem-contribution-status:system:42:1:tag:completed:complete-tag', capability: 'tag' },
        ]);
        expect(calls.contributionStatus[0]).to.deep.include({
            domainId: 'system',
            pid: 42,
            uid: 1,
            scope: 'tag',
            status: 'completed',
            actor: 1,
            requestId: 'acl:problem-contribution-status:system:42:1:tag:completed:complete-tag',
            writeClaimRequestId: 'acl:problem-contribution-status:system:42:1:tag:completed:complete-tag',
        });

        const contributor = makeHandler('problem_contribution');
        stableProblemResults = [pdoc];
        manageContributionResults = [false];
        const denied = await capture(() => contributor.post({ domainId: 'system' }, 42, 8, 'data', '', 'delegate-data'));
        expect(denied?.name).to.equal('PermissionError');
        expect(calls.contributionAssign).to.deep.equal([]);
        expect(calls.writeClaim).to.have.length(1);
    });

    it('preflights every selected problem before a contribution batch writes anything', async () => {
        const handler = makeHandler('problem_contribution_bulk');
        rawProblemResults = [
            { ...pdoc, structureRevision: 2 },
            { ...pdoc, docId: 43, pid: 'P43', structureRevision: 4 },
        ];
        manageContributionResults = [true, false];

        const denied = await capture(() =>
            handler.post({ domainId: 'system' }, [42, 43], '{"42":2,"43":4}', 8, 'data,tag', 'check both', 'batch-preflight'),
        );

        expect(denied?.name).to.equal('PermissionError');
        expect(calls.contributionAssign).to.deep.equal([]);
        expect(calls.writeClaim).to.deep.equal([]);
    });

    it('rejects a missing target or stale revision before a batch claim is acquired', async () => {
        const missingTarget = makeHandler('problem_contribution_bulk');
        userGetResults = [null];
        const missingError = await capture(() => missingTarget.post({ domainId: 'system' }, [42], '{"42":0}', 8, 'data', '', 'batch-missing-user'));
        expect(missingError).to.be.instanceOf(Error);
        expect(calls.problemGet).to.deep.equal([]);
        expect(calls.writeClaim).to.deep.equal([]);

        const stale = makeHandler('problem_contribution_bulk');
        rawProblemResults = [{ ...pdoc, structureRevision: 3 }];
        const staleError = await capture(() => stale.post({ domainId: 'system' }, [42], '{"42":2}', 8, 'data', '', 'batch-stale'));
        expect(staleError).to.be.instanceOf(Error);
        expect(calls.contributionAssign).to.deep.equal([]);
        expect(calls.writeClaim).to.deep.equal([]);
    });

    it('derives the same per-scope mutation id when an identical batch request is retried', async () => {
        const handler = makeHandler('problem_contribution_bulk');
        const version = { ...pdoc, structureRevision: 2 };
        rawProblemResults = [version, version, version, version];

        await handler.post({ domainId: 'system' }, [42], '{"42":2}', 8, 'data', '', 'batch-retry');
        await handler.post({ domainId: 'system' }, [42], '{"42":2}', 8, 'data', '', 'batch-retry');

        expect(calls.contributionAssign).to.have.length(2);
        expect(calls.contributionAssign[0].requestId).to.equal(calls.contributionAssign[1].requestId);
        expect(calls.contributionAssign[0].requestId).to.equal('acl:problem-contribution-assign:system:42:8:data:batch-retry');
    });

    it('returns exact per-problem results when a post-preflight batch write fails', async () => {
        const handler = makeHandler('problem_contribution_bulk');
        const p42 = { ...pdoc, structureRevision: 2 };
        const p43 = { ...pdoc, docId: 43, pid: 'P43', title: 'P43', structureRevision: 4 };
        rawProblemResults = [p42, p43, p42, p42, p43];
        contributionAssignFailures = [null, null, new Error('simulated database failure')];

        await handler.post({ domainId: 'system' }, [42, 43], '{"42":2,"43":4}', 8, 'data,tag', 'check both', 'batch-partial');

        expect(handler.response.status).to.equal(500);
        expect(handler.response.body).to.deep.include({ success: false, requestId: 'batch-partial', succeededPids: [42] });
        expect(handler.response.body.failed).to.deep.equal([
            {
                pid: 43,
                publicPid: 'P43',
                completedScopes: [],
                scope: 'data',
                message: 'simulated database failure',
            },
        ]);
        expect(calls.contributionAssign.map((input) => [input.pid, input.scope])).to.deep.equal([
            [42, 'data'],
            [42, 'tag'],
            [43, 'data'],
        ]);
    });

    it('lets a contribution manager reopen an active completed task but never complete it for someone else', async () => {
        const handler = makeHandler('problem_contribution_status');
        stableProblemResults = [pdoc, pdoc];
        rawProblemResults = [pdoc];
        contributionRows = [{ domainId: 'system', pid: 42, uid: 8, scope: 'data', active: true, status: 'completed' }];

        await handler.post({ domainId: 'system' }, 42, 'data', 'pending', 8, 'manager-reopen');

        expect(calls.writeClaim[0]).to.deep.equal([
            'system',
            42,
            handler.user,
            'contribution-status',
            { requestId: 'acl:problem-contribution-status:system:42:8:data:pending:manager-reopen', capability: 'contributions' },
        ]);
        expect(calls.contributionStatus[0]).to.deep.include({ uid: 8, status: 'pending', actor: 1 });

        const denied = await capture(() => handler.post({ domainId: 'system' }, 42, 'data', 'completed', 8, 'manager-complete'));
        expect(denied?.name).to.equal('PermissionError');
        expect(calls.contributionStatus).to.have.length(1);
    });

    it('adds active contribution tasks to the existing inbox without changing permit rows', async () => {
        const handler = makeHandler('my_verify_inbox');
        contributionRows = [
            {
                _id: 'contribution-1',
                domainId: 'system',
                pid: 42,
                uid: 1,
                scope: 'tag',
                active: true,
                status: 'pending',
                assignedBy: 8,
                updatedBy: 8,
            },
        ];
        stableProblemResults = [pdoc];

        await handler.get({ domainId: 'system' });

        expect(handler.response.body.permits).to.deep.equal([]);
        expect(handler.response.body.contributions).to.deep.equal(contributionRows);
        expect(handler.response.body.pdict[42]).to.deep.equal(pdoc);
        expect(handler.response.body.udict[8].uname).to.equal('u8');
    });

    it('uses the authoritative handler domain for a legitimate revoke', async () => {
        const handler = makeHandler('problem_permit_revoke');
        await handler.post({ domainId: 'system' }, 42, permitId, 'retry-1');

        expect(calls.problemGet).to.deep.equal([
            ['system', 42, handler.user],
            ['system', 42],
        ]);
        expect(calls.permitFind[0]).to.include({ domainId: 'system', pid: 42 });
        expect(calls.revoke[0][0]).to.equal('system');
        expect(calls.writeClaim[0]).to.deep.equal([
            'system',
            42,
            handler.user,
            'permit-revoke',
            { requestId: 'retry-1', selfRevokeUid: undefined, capability: 'collaborators' },
        ]);
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

    it('lets a managed maintainer grant author but not maintainer', async () => {
        const managed = { ...pdoc, authoringMode: 'managed' };
        const handler = makeHandler('problem_permit_grant');
        stableProblemResults = [managed];
        rawProblemResults = [managed];
        manageMaintainerResults = [false];
        manageCollaboratorResults = [true];

        await handler.post({ domainId: 'system' }, 42, 8, undefined, 'author', '', 'grant-author');

        expect(calls.grant[0].slice(0, 5)).to.deep.equal(['system', 42, 8, 'author', 1]);
        expect(calls.writeClaim[0][4]).to.include({ capability: 'collaborators' });
        expect(calls.oplog[0][1]).to.equal('problem.permit.grant');

        stableProblemResults = [managed];
        manageMaintainerResults = [false];
        manageCollaboratorResults = [true];
        const error = await capture(() => handler.post({ domainId: 'system' }, 42, 8, undefined, 'maintainer', '', 'grant-maintainer'));

        expect(error?.name).to.equal('PermissionError');
        expect(calls.grant).to.have.lengthOf(1);
        expect(calls.oplog.at(-1)?.[1]).to.equal('problem.permit.denied');
    });

    it('lets only the managed administrator grant or revoke maintainer', async () => {
        const managed = { ...pdoc, authoringMode: 'managed' };
        const grantHandler = makeHandler('problem_permit_grant');
        stableProblemResults = [managed];
        rawProblemResults = [managed];
        manageMaintainerResults = [true];

        await grantHandler.post({ domainId: 'system' }, 42, 8, undefined, 'maintainer', '', 'admin-maintainer');

        expect(calls.grant[0][3]).to.equal('maintainer');
        expect(calls.writeClaim[0][4]).to.include({ capability: 'publish' });

        const revokeHandler = makeHandler('problem_permit_revoke');
        permitRow = { _id: permitId, domainId: 'system', pid: 42, uid: 8, active: true, role: 'maintainer' };
        stableProblemResults = [managed];
        manageMaintainerResults = [false];
        const error = await capture(() => revokeHandler.post({ domainId: 'system' }, 42, permitId, 'deny-revoke'));

        expect(error?.name).to.equal('PermissionError');
        expect(calls.revoke).to.have.lengthOf(0);
        expect(calls.oplog.at(-1)?.[1]).to.equal('problem.permit.denied');

        permitRow = { _id: permitId, domainId: 'system', pid: 42, uid: 1, active: true, role: 'maintainer' };
        stableProblemResults = [managed];
        manageMaintainerResults = [false];
        const selfError = await capture(() => revokeHandler.post({ domainId: 'system' }, 42, permitId, 'deny-self-revoke'));
        expect(selfError?.name).to.equal('PermissionError');
        expect(calls.revoke).to.have.lengthOf(0);

        permitRow = { _id: permitId, domainId: 'system', pid: 42, uid: 8, active: true, role: 'maintainer' };
        stableProblemResults = [managed];
        rawProblemResults = [managed];
        manageMaintainerResults = [true];
        await revokeHandler.post({ domainId: 'system' }, 42, permitId, 'admin-revoke');
        expect(calls.revoke).to.have.lengthOf(1);
        expect(calls.writeClaim.at(-1)?.[4]).to.include({ capability: 'publish' });
        expect(calls.oplog.at(-1)?.[1]).to.equal('problem.permit.revoke');
    });

    it('rejects managed multi-user grants before acquiring a claim or changing any role', async () => {
        const managed = { ...pdoc, authoringMode: 'managed' };
        const handler = makeHandler('problem_permit_grant');
        stableProblemResults = [managed];

        const error = await capture(() => handler.post({ domainId: 'system' }, 42, 8, ['9'], 'author', '', 'managed-batch'));

        expect(error).to.be.instanceOf(Error);
        expect(calls.writeClaim).to.have.lengthOf(0);
        expect(calls.grant).to.have.lengthOf(0);
        expect(calls.oplog.at(-1)?.[1]).to.equal('problem.permit.denied');
    });

    it('lets a managed maintainer revoke author without maintainer-management authority', async () => {
        const managed = { ...pdoc, authoringMode: 'managed' };
        const handler = makeHandler('problem_permit_revoke');
        permitRow = { _id: permitId, domainId: 'system', pid: 42, uid: 8, active: true, role: 'author' };
        stableProblemResults = [managed];
        rawProblemResults = [managed];
        manageCollaboratorResults = [true];

        await handler.post({ domainId: 'system' }, 42, permitId, 'revoke-author');

        expect(calls.revoke).to.have.lengthOf(1);
        expect(calls.writeClaim[0][4]).to.include({ capability: 'collaborators' });
    });

    it('rejects attempts to overwrite any direct or sourced managed maintainer role', async () => {
        const managed = { ...pdoc, authoringMode: 'managed' };
        const handler = makeHandler('problem_permit_grant');
        stableProblemResults = [managed];
        rawProblemResults = [managed];
        permitRow = { _id: permitId, domainId: 'system', pid: 42, uid: 8, active: true, role: 'maintainer' };
        manageMaintainerResults = [false, false, false];
        manageCollaboratorResults = [true, true];

        const directError = await capture(() => handler.post({ domainId: 'system' }, 42, 8, undefined, 'author', '', 'overwrite-direct'));
        expect(directError?.name).to.equal('PermissionError');
        expect(calls.grant).to.have.lengthOf(0);

        for (const entries of Object.values(calls)) entries.length = 0;
        stableProblemResults = [managed];
        rawProblemResults = [managed];
        permitRow = { _id: permitId, domainId: 'system', pid: 42, uid: 8, active: true, role: 'verifier' };
        permitSourceRows = [{ domainId: 'system', pid: 42, uid: 8, active: true, role: 'maintainer' }];
        manageMaintainerResults = [false, false, false];
        manageCollaboratorResults = [true, true];

        const sourceError = await capture(() => handler.post({ domainId: 'system' }, 42, 8, undefined, 'author', '', 'overwrite-source'));
        expect(sourceError?.name).to.equal('PermissionError');
        expect(calls.grant).to.have.lengthOf(0);
    });

    it('rechecks a revoke row and all sources inside the claim before removing a role', async () => {
        const managed = { ...pdoc, authoringMode: 'managed' };
        const handler = makeHandler('problem_permit_revoke');
        const author = { _id: permitId, domainId: 'system', pid: 42, uid: 8, active: true, role: 'author' };
        const maintainer = { ...author, role: 'maintainer' };
        stableProblemResults = [managed];
        rawProblemResults = [managed];
        permitFindOneResults = [author, maintainer];
        permitSourceRows = [{ domainId: 'system', pid: 42, uid: 8, active: true, role: 'maintainer' }];
        manageCollaboratorResults = [true];
        manageMaintainerResults = [false];

        const error = await capture(() => handler.post({ domainId: 'system' }, 42, permitId, 'stale-revoke'));
        expect(error?.name).to.equal('PermissionError');
        expect(calls.revoke).to.have.lengthOf(0);
    });

    it('does not let self-revoke remove a hidden managed maintainer source', async () => {
        const managed = { ...pdoc, authoringMode: 'managed' };
        const handler = makeHandler('problem_permit_revoke');
        permitRow = { _id: permitId, domainId: 'system', pid: 42, uid: 1, active: true, role: 'author' };
        stableProblemResults = [managed];
        permitSourceRows = [{ domainId: 'system', pid: 42, uid: 1, active: true, role: 'maintainer' }];
        manageMaintainerResults = [false];

        const error = await capture(() => handler.post({ domainId: 'system' }, 42, permitId, 'self-with-maintainer-source'));

        expect(error?.name).to.equal('PermissionError');
        expect(calls.writeClaim).to.have.lengthOf(0);
        expect(calls.revoke).to.have.lengthOf(0);
        expect(calls.oplog.at(-1)?.[1]).to.equal('problem.permit.denied');
    });

    it('rejects mixed managed permit bodies before any role mutation', async () => {
        const managed = { ...pdoc, authoringMode: 'managed' };
        const grantHandler = makeHandler('problem_permit_grant');
        grantHandler.request.body = { uid: '8', role: 'author', tag: 'forged' };
        stableProblemResults = [managed];

        const grantError = await capture(() => grantHandler.post({ domainId: 'system' }, 42, 8, undefined, 'author', '', 'mixed-grant'));
        expect(grantError).to.be.instanceOf(Error);
        expect(calls.writeClaim).to.have.lengthOf(0);
        expect(calls.grant).to.have.lengthOf(0);

        const revokeHandler = makeHandler('problem_permit_revoke');
        revokeHandler.request.body = { permitId: permitId.toHexString(), role: 'author' };
        stableProblemResults = [managed];
        const revokeError = await capture(() => revokeHandler.post({ domainId: 'system' }, 42, permitId, 'mixed-revoke'));
        expect(revokeError).to.be.instanceOf(Error);
        expect(calls.revoke).to.have.lengthOf(0);
    });
});
