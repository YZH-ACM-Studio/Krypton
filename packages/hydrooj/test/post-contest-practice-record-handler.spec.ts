import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {} };

class TestPermissionError extends Error {
    name = 'PermissionError';
}

class TestNotFoundError extends Error {}

const PERM = {
    PERM_VIEW_RECORD: 1n,
    PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD: 2n,
    PERM_EDIT_CONTEST: 4n,
    PERM_VIEW_PROBLEM: 8n,
    PERM_READ_RECORD_CODE: 16n,
    PERM_READ_RECORD_CODE_ACCEPT: 32n,
    PERM_REJUDGE: 64n,
};
const PRIV = {
    PRIV_EDIT_SYSTEM: 1,
    PRIV_MANAGE_ALL_DOMAIN: 2,
    PRIV_VIEW_JUDGE_STATISTICS: 3,
    PRIV_READ_RECORD_CODE: 4,
};
const STATUS = {
    STATUS_ACCEPTED: 1,
    STATUS_WAITING: 20,
    STATUS_JUDGING: 21,
    STATUS_COMPILING: 22,
    STATUS_FETCHED: 23,
};

const tid = new ObjectId('687000000000000000000024');
const rid = new ObjectId('687000010000000000000024');
const beginAt = new Date('2026-07-23T00:00:00.000Z');
const endAt = new Date('2026-07-23T02:00:00.000Z');
const tdoc = {
    domainId: 'd',
    docId: tid,
    rule: 'acm',
    entryMode: 'open',
    beginAt,
    endAt,
    pids: [7],
};
const hiddenProblem = {
    domainId: 'd',
    docId: 7,
    pid: 'H7',
    title: 'Hidden',
    hidden: true,
    config: {},
};
const ordinaryRecord = {
    _id: rid,
    domainId: 'd',
    uid: 42,
    pid: 7,
    lang: 'cc.cc17',
    status: STATUS.STATUS_ACCEPTED,
    score: 100,
    time: 1,
    memory: 1,
    code: 'int main() {}',
    files: {},
    compilerTexts: [],
    judgeTexts: [],
    testCases: [],
    subtasks: {},
};

const calls = {
    recordQueries: [] as any[],
    rawProblems: [] as number[],
    viewableProblems: [] as number[],
    ongoingArgs: [] as any[][],
    studentQueries: [] as Array<{ domainId: string; uids: number[] }>,
    sent: [] as any[],
};
let currentRecord: any = ordinaryRecord;
let clientRequired = false;
let ongoing = false;
let viewableProblemAvailable = false;

function cursor(rows: any[]) {
    const value: any = {
        sort() {
            return value;
        },
        project() {
            return value;
        },
        skip() {
            return value;
        },
        limit() {
            return value;
        },
        async toArray() {
            return rows;
        },
    };
    return value;
}

const recordStub: any = {
    RECORD_PRETEST: new ObjectId('000000000000000000000000'),
    RECORD_GENERATE: new ObjectId('000000000000000000000001'),
    PROJECTION_LIST: ['_id', 'domainId', 'uid', 'pid', 'contest', 'contestTeamId', 'hackTarget', 'status'],
    getMulti(_domainId: string, query: any) {
        calls.recordQueries.push(query);
        return cursor([currentRecord]);
    },
    async get() {
        return currentRecord;
    },
    collHistory: {
        find() {
            return cursor([]);
        },
        async findOne() {
            return null;
        },
    },
};

const contestStub: any = {
    async get() {
        return tdoc;
    },
    async getStatus() {
        return { attend: 1 };
    },
    getParticipationMode() {
        return 'individual';
    },
    canShowScoreboard() {
        return true;
    },
    canShowSelfRecord() {
        return true;
    },
    canShowRecord() {
        return true;
    },
    applyProjection(_tdoc: unknown, rdoc: unknown) {
        return rdoc;
    },
    isDone() {
        return true;
    },
    isClientRequired() {
        return clientRequired;
    },
    isOngoing(...args: any[]) {
        calls.ongoingArgs.push(args);
        return ongoing;
    },
};

const problemStub: any = {
    PROJECTION_LIST: ['domainId', 'docId', 'pid', 'title', 'hidden'],
    PROJECTION_PUBLIC: ['domainId', 'docId', 'pid', 'title', 'hidden'],
    PROJECTION_CONTEST_LIST: ['domainId', 'docId', 'pid', 'title'],
    default: {},
    async get(_domainId: string, pid: number) {
        calls.rawProblems.push(Number(pid));
        return Number(pid) === 7 ? hiddenProblem : { ...hiddenProblem, docId: Number(pid) };
    },
    getMulti() {
        const value: any = {
            limit() {
                return value;
            },
            async toArray() {
                return [hiddenProblem];
            },
        };
        return value;
    },
    async getViewableAuthorized(_domainId: string, pid: number) {
        calls.viewableProblems.push(Number(pid));
        return viewableProblemAvailable ? hiddenProblem : null;
    },
    async getStatus() {
        return null;
    },
};

const userStub: any = {
    async getById(_domainId: string, uid: number) {
        return { _id: uid, uname: `u${uid}` };
    },
    async getByUname(_domainId: string, uname: string) {
        return uname === 'u42' ? { _id: 42, uname } : null;
    },
    async getByEmail() {
        return null;
    },
    async getList() {
        return {};
    },
};

function noopDecorator() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}

class HandlerStub {
    args: any = {};
    response: any = { body: {} };
    user: any;
    tdoc?: any;
    tsdoc?: any;

    checkPerm(permission: bigint) {
        if (!this.user.hasPerm(permission)) throw new TestPermissionError(String(permission));
    }

    checkPriv() {
        throw new TestPermissionError('privilege');
    }
}

class ConnectionHandlerStub extends HandlerStub {
    send(payload: unknown) {
        calls.sent.push(payload);
    }

    close() {}

    async renderHTML() {
        return '';
    }
}

const serverStub = {
    ConnectionHandler: ConnectionHandlerStub,
    param: noopDecorator,
    subscribe: noopDecorator,
    Types: new Proxy({}, { get: () => () => ({}) }),
};

const errors = new Proxy(
    {
        PermissionError: TestPermissionError,
        ContestNotFoundError: TestNotFoundError,
        ProblemNotFoundError: TestNotFoundError,
        RecordNotFoundError: TestNotFoundError,
    },
    {
        get(target, key: string) {
            return target[key] || TestNotFoundError;
        },
    },
);

const recordHandlerPath = require.resolve('../src/handler/record.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    const fromRecordHandler = parent?.filename === recordHandlerPath;
    if (fromRecordHandler && request === '@hydrooj/common') return { normalizeSubtasks: (subtasks: unknown[]) => subtasks };
    if (fromRecordHandler && request === '@hydrooj/common/cases') return { readYamlCases: async () => ({ subtasks: [] }) };
    if (fromRecordHandler && request === 'js-yaml') return { load: (value: unknown) => value };
    if (fromRecordHandler && request === '../error') return errors;
    if (fromRecordHandler && request === '../model/builtin') return { PERM, PRIV, STATUS, STATUS_TEXTS: {} };
    if (fromRecordHandler && request === '../model/contest') return contestStub;
    if (fromRecordHandler && request === '../model/contest-team') {
        return {
            async getTeamByMember() {
                return null;
            },
            async getTeam() {
                return null;
            },
        };
    }
    if (fromRecordHandler && request === '../lib/testdataConfig') {
        return {
            parseConfig: async (config: unknown) => config,
        };
    }
    if (fromRecordHandler && request === '../model/problem') return { default: problemStub, ...problemStub };
    if (fromRecordHandler && request === '../model/problem-access') {
        return {
            PROBLEM_ACL_INTERNAL_FIELDS: new Set(['aclMutationRevision', 'aclMutationLocks', 'aclWriteClaim']),
            async readContextViewableProblem(_domainId: string, user: any, context: any, adapters: any) {
                const face =
                    context.kind === 'record-detail'
                        ? !context.contextualProblemAccess &&
                          !context.virtualAttemptId &&
                          (!context.tdoc || (!context.teamRecordAccess && !context.tsdoc?.attend))
                            ? 'direct-stable'
                            : 'container'
                        : context.kind === 'record-detail-connection'
                          ? !context.contextualProblemAccess &&
                            !context.virtualAttemptId &&
                            (!context.contest || (!context.teamRecordAccess && user._id !== context.recordUid))
                              ? 'direct-stable'
                              : 'container'
                          : (() => {
                                throw new TypeError(context.kind);
                            })();
                if (face === 'container') return adapters.readContainer();
                const pdoc = await adapters.readDirectStable();
                calls.viewableProblems.push(Number(pdoc?.docId));
                return viewableProblemAvailable ? pdoc : null;
            },
        };
    }
    if (fromRecordHandler && request === '../model/record') return { default: recordStub, ...recordStub };
    if (fromRecordHandler && request === '../model/setting') return { langs: { 'cc.cc17': { display: 'C++ 17' } } };
    if (fromRecordHandler && request === '../model/storage') return { default: {} };
    if (fromRecordHandler && request === '../model/system') return { default: { get: () => 20 } };
    if (fromRecordHandler && request === '../model/task') return { default: { deleteMany: async () => undefined } };
    if (fromRecordHandler && request === '../model/user') return { default: userStub, ...userStub };
    if (fromRecordHandler && request === '../service/server') return serverStub;
    if (fromRecordHandler && request === '../utils') {
        return {
            buildProjection(keys: string[]) {
                return Object.fromEntries(keys.map((key) => [key, 1]));
            },
            Time: { week: 7 * 24 * 60 * 60 * 1000, getObjectID: () => rid },
        };
    }
    if (fromRecordHandler && request === './contest') return { ContestDetailBaseHandler: HandlerStub };
    if (fromRecordHandler && request === './judge') return { postJudge: async () => undefined };
    if (fromRecordHandler && request === '../model/record-score-cancellation') {
        return {
            auditRecordScorePermissionRejection: async () => undefined,
            cancelRecordScore: async () => ({ rdoc: {} }),
            async getRecordScoreAction() {
                return null;
            },
            recoverCanceledRecord: async () => ({ rdoc: {} }),
        };
    }
    if (fromRecordHandler && request === '../model/virtual-contest') {
        return {
            canManageVirtualContest: () => false,
            virtualContestService: {
                async getAttempt() {
                    return null;
                },
                async getOfficialAttempt() {
                    return null;
                },
            },
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let recordHandlerModule: typeof import('../src/handler/record');
try {
    delete require.cache[recordHandlerPath];
    recordHandlerModule = require(recordHandlerPath);
} finally {
    Module._load = originalLoad;
}

function makeUser(uid = 42) {
    return {
        _id: uid,
        own: () => false,
        hasPerm: () => false,
        hasPriv: () => false,
    };
}

function makeHandler(Ctor: any): any {
    const handler = new Ctor() as HandlerStub;
    handler.user = makeUser();
    handler.response = { body: {} };
    handler.args = {};
    (handler as any).translate = (value: string) => value;
    return handler as any;
}

beforeEach(() => {
    calls.recordQueries.length = 0;
    calls.rawProblems.length = 0;
    calls.viewableProblems.length = 0;
    calls.ongoingArgs.length = 0;
    calls.studentQueries.length = 0;
    calls.sent.length = 0;
    currentRecord = { ...ordinaryRecord };
    clientRequired = false;
    ongoing = false;
    viewableProblemAvailable = false;
    (global as any).Hydro.model.userbind = {
        async findStudentsByUserIds(domainId: string, uids: number[]) {
            calls.studentQueries.push({ domainId, uids });
            return { 42: { studentId: '240000042', realName: '学生甲' } };
        },
    };
});

describe('post-contest practice record handlers', () => {
    it('queries only the current user ordinary records under an explicit practice scope', async () => {
        const handler = makeHandler(recordHandlerModule.RecordListHandler);
        handler.tsdoc = { attend: 1 };
        await handler.get('d', 1, 7, tid, true, false, '42', undefined, undefined, true);

        expect(calls.recordQueries[0]).to.deep.equal({
            uid: 42,
            pid: 7,
            contest: { $exists: false },
            contestTeamId: { $exists: false },
            virtualAttemptId: { $exists: false },
            hackTarget: { $exists: false },
            input: { $exists: false },
        });
        expect(handler.response.body.postContestPracticeActive).to.equal(true);
        expect(calls.viewableProblems).to.deep.equal([]);
    });

    it('keeps an ordinary tid list on immutable contest records', async () => {
        const handler = makeHandler(recordHandlerModule.RecordListHandler);
        handler.tsdoc = { attend: 1 };
        await handler.get('d', 1, 7, tid, false, false, '42', undefined, undefined, true);

        expect(calls.recordQueries[0]).to.deep.include({ contest: tid, uid: 42, pid: 7 });
        expect(handler.response.body.postContestPracticeActive).to.equal(false);
    });

    it('rejects a forged problem outside the contest practice context', async () => {
        const handler = makeHandler(recordHandlerModule.RecordListHandler);
        handler.tsdoc = { attend: 1 };
        await assert.rejects(handler.get('d', 1, 8, tid, true, false, '42', undefined, undefined, true), TestPermissionError);
    });

    it('opens an owner hidden record through the validated practice context', async () => {
        const handler = makeHandler(recordHandlerModule.RecordDetailHandler);
        handler.args = { tid, practice: true };
        handler.tdoc = tdoc;
        handler.tsdoc = { attend: 1 };

        await handler.prepare('d', rid, true);
        await handler.get('d', rid, false);

        expect(handler.response.body.postContestPracticeRecordAccess).to.equal(true);
        expect(handler.response.body.pdoc).to.equal(hiddenProblem);
        expect(calls.viewableProblems).to.deep.equal([]);
    });

    it('rejects another user record even when the practice tid is valid', async () => {
        currentRecord = { ...ordinaryRecord, uid: 43 };
        const handler = makeHandler(recordHandlerModule.RecordDetailHandler);
        handler.args = { tid, practice: true };
        handler.tdoc = tdoc;
        handler.tsdoc = { attend: 1 };

        await assert.rejects(handler.prepare('d', rid, true), TestPermissionError);
    });

    it('rejects a nonparticipant hidden record practice context', async () => {
        const handler = makeHandler(recordHandlerModule.RecordDetailHandler);
        handler.args = { tid, practice: true };
        handler.tdoc = tdoc;
        handler.tsdoc = { attend: 0 };

        await assert.rejects(handler.prepare('d', rid, true), TestPermissionError);
    });

    it('keeps the practice websocket on ordinary current-user records', async () => {
        const handler = makeHandler(recordHandlerModule.RecordMainConnectionHandler) as any;
        handler.args = { domainId: 'd' };
        await handler.prepare('d', tid, true, false, 7, '42', undefined, undefined, false, false, false, true);
        expect(handler.practice).to.equal(true);
        expect(handler.tid).to.equal(undefined);

        await handler.onRecordChange(currentRecord);
        expect(handler.queue.size).to.equal(1);
        const payload = await [...handler.queue.values()][0]();
        handler.throttleQueueClear.cancel();
        expect(payload.rdoc._id).to.deep.equal(rid);
    });

    it('opens the hidden record detail websocket only through the validated practice context', async () => {
        const handler = makeHandler(recordHandlerModule.RecordDetailConnectionHandler) as any;
        handler.args = { domainId: 'd', tid, practice: true };

        await handler.prepare('d', rid, tid, true, true);
        handler.throttleSend.cancel();
        clearTimeout(handler.disconnectTimeout);

        expect(handler.postContestPracticeRecordAccess).to.equal(true);
        expect(handler.pdoc).to.equal(hiddenProblem);
        expect(calls.viewableProblems).to.deep.equal([]);
    });

    it('declares distinct record-detail and record-detail-connection contexts', () => {
        const source = readFileSync(recordHandlerPath, 'utf8');
        expect(source).to.include("kind: 'record-detail' as const");
        expect(source).to.include("kind: 'record-detail-connection' as const");
        expect(source).to.include('readContextViewableProblem(');
        expect(source).to.include('readContainer: () => problem.get(');
        expect(source).not.to.include('loadManagedContainerPids');
        const detailIdx = source.indexOf("kind: 'record-detail' as const");
        const connectionIdx = source.indexOf("kind: 'record-detail-connection' as const");
        expect(connectionIdx).to.be.greaterThan(detailIdx);
        expect(source.slice(detailIdx, detailIdx + 280)).to.include('tsdoc: this.tsdoc');
        expect(source.slice(connectionIdx, connectionIdx + 280)).to.include('recordUid: rdoc.uid');
        expect(source.slice(connectionIdx, connectionIdx + 280)).to.include('contest: rdoc.contest');
    });
});

describe('live client-required record detail boundary', () => {
    beforeEach(() => {
        clientRequired = true;
        ongoing = true;
        currentRecord = {
            ...ordinaryRecord,
            contest: tid,
            files: { code: '42/private-storage-key#main.cpp' },
            compilerTexts: ['private compiler output'],
            judgeTexts: ['private judge output'],
            testCases: [{ status: STATUS.STATUS_ACCEPTED }],
        };
    });

    it('returns only the current participant source through the ordinary HTTP route', async () => {
        const handler = makeHandler(recordHandlerModule.RecordDetailHandler);

        await handler.prepare('d', rid);
        await handler.get('d', rid, false);

        expect(handler.response.body.examRecordCodeOnly).to.equal(true);
        expect(handler.response.body.rdoc).to.deep.equal({
            _id: rid,
            uid: 42,
            pid: 7,
            lang: 'cc.cc17',
            code: 'int main() {}',
        });
        expect(handler.response.body).not.to.have.property('allRevs');
        expect(handler.response.body).not.to.have.property('recordStudent');
        expect(JSON.stringify(handler.response.body)).not.to.include('private');
        expect(calls.ongoingArgs.at(-1)).to.deep.equal([tdoc]);
    });

    it('rejects historical revisions while the client-required contest is live', async () => {
        const handler = makeHandler(recordHandlerModule.RecordDetailHandler);

        await handler.prepare('d', rid);
        await assert.rejects(handler.get('d', rid, false, new ObjectId()), TestPermissionError);
    });

    it('keeps the ordinary record detail after the contest ends or for a system admin', async () => {
        ongoing = false;
        const endedHandler = makeHandler(recordHandlerModule.RecordDetailHandler);
        await endedHandler.prepare('d', rid);
        await endedHandler.get('d', rid, false);
        expect(endedHandler.response.body.examRecordCodeOnly).to.equal(undefined);
        expect(endedHandler.response.body.rdoc.status).to.equal(STATUS.STATUS_ACCEPTED);

        ongoing = true;
        const adminHandler = makeHandler(recordHandlerModule.RecordDetailHandler);
        adminHandler.user.hasPriv = (privilege: number) => privilege === PRIV.PRIV_EDIT_SYSTEM;
        await adminHandler.prepare('d', rid);
        await adminHandler.get('d', rid, false);
        expect(adminHandler.response.body.examRecordCodeOnly).to.equal(undefined);
        expect(adminHandler.response.body.rdoc.compilerTexts).to.deep.equal(['private compiler output']);
        expect(adminHandler.response.body.recordStudent).to.deep.equal({ studentId: '240000042', realName: '学生甲' });
        expect(calls.studentQueries).to.deep.equal([{ domainId: 'd', uids: [42] }]);
    });

    it('never pushes status, diagnostics, or storage keys through the ordinary detail websocket', async () => {
        const handler = makeHandler(recordHandlerModule.RecordDetailConnectionHandler) as any;
        handler.args = { domainId: 'd' };

        await handler.prepare('d', rid, undefined, false, true);
        handler.throttleSend.cancel();
        clearTimeout(handler.disconnectTimeout);
        calls.sent.length = 0;
        await handler.sendUpdate(currentRecord);

        expect(calls.sent).to.deep.equal([
            {
                rdoc: {
                    _id: rid,
                    uid: 42,
                    pid: 7,
                    lang: 'cc.cc17',
                    code: 'int main() {}',
                },
            },
        ]);
        expect(JSON.stringify(calls.sent)).not.to.include('private');
        expect(JSON.stringify(calls.sent)).not.to.include('status');
        expect(calls.ongoingArgs.at(-1)).to.deep.equal([tdoc]);
    });

    it('does not push source to a record viewer without code permission', async () => {
        viewableProblemAvailable = true;
        const handler = makeHandler(recordHandlerModule.RecordDetailConnectionHandler) as any;
        handler.user = makeUser(43);
        handler.args = { domainId: 'd' };

        await handler.prepare('d', rid, undefined, false, true);
        handler.throttleSend.cancel();
        clearTimeout(handler.disconnectTimeout);
        calls.sent.length = 0;
        await handler.sendUpdate(currentRecord);

        expect(handler.canViewCode).to.equal(false);
        expect(calls.sent).to.deep.equal([
            {
                rdoc: {
                    _id: rid,
                    uid: 42,
                    pid: 7,
                    lang: 'cc.cc17',
                    code: '',
                },
            },
        ]);
    });
});
