import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';
import { createDraftConfig, SET_DEFAULT_PERMISSIONS, SET_EXPERIENCE_DEFAULTS, type SetConfig } from '@hydrooj/common';
import type { Tdoc } from '../src/interface';
import { InMemoryStudentDirectory, studentRecord } from '../src/lib/testing/in-memory-student-directory';
import { registerStudentDirectory } from '../src/service/student-directory';

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
    PERM_ATTEND_CONTEST: 128n,
    PERM_ATTEND_HOMEWORK: 256n,
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
const tdoc: Pick<Tdoc, 'domainId' | 'docId' | 'rule' | 'entryMode' | 'beginAt' | 'endAt' | 'pids' | '_code'> & { setConfig?: SetConfig } = {
    domainId: 'd',
    docId: tid,
    rule: 'acm',
    entryMode: 'open',
    beginAt,
    endAt,
    pids: [7],
};
let virtualAttempt: { _id: ObjectId; uid: number; status: 'ended'; snapshot: { pids: number[] } } | null = null;
const hiddenProblem = {
    domainId: 'd',
    docId: 7,
    pid: 'H7',
    title: 'Hidden',
    hidden: true,
    difficulty: 7,
    problemKind: undefined as 'function' | 'single' | undefined,
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
let allowRecordDetails = true;
let allowRecordList = true;
let concealScore = false;
let listedProblems: Record<string, unknown> = {};
let inAudience = true;
let validClient = false;
let attended = true;

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
    RECORD_VERIFY: new ObjectId('000000000000000000000002'),
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
    requirePublishedForStudent(doc: Tdoc, manager: boolean) {
        if (!manager && doc.setConfig?.publication !== 'published') throw new TestNotFoundError('unpublished');
    },
    studentRecordHitsContestScope: async () => inAudience,
    isClientFinished: () => false,
    async get() {
        return tdoc;
    },
    async getStatus() {
        return { attend: attended ? 1 : 0 };
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
    async canShowRecordForUser(_tdoc: unknown, _allowPerm?: boolean, scope?: string) {
        return scope === 'list' ? allowRecordList : allowRecordDetails;
    },
    async canShowSelfRecordForUser() {
        return true;
    },
    async canShowScoreboardForUser() {
        return true;
    },
    canFilterRecordStatus() {
        return true;
    },
    applyProjection(_tdoc: unknown, rdoc: unknown) {
        if (concealScore) return { ...(rdoc as object), score: null, testCases: [] };
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
    async getList() { return listedProblems; },
    PROJECTION_LIST: ['domainId', 'docId', 'pid', 'title', 'hidden'],
    PROJECTION_PUBLIC: ['domainId', 'docId', 'pid', 'title', 'hidden'],
    PROJECTION_CONTEST_LIST: ['domainId', 'docId', 'pid', 'title'],
    default: {},
    async get(_domainId: string, pid: number, projection?: string[]) {
        calls.rawProblems.push(Number(pid));
        if (projection?.length === 1 && projection[0] === 'config') return { config: structuredClone(hiddenProblem.config) };
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
const participationPath = require.resolve('../src/lib/set-participation-access.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    const fromRecordHandler = parent?.filename === recordHandlerPath;
    if (parent?.filename === participationPath) {
        if (request === '../model/contest') return contestStub;
        if (request === '../model/builtin') return { PERM, PRIV, STATUS };
        if (request === '../error') return errors;
        if (request === './container-visibility') return { decideContainerVisibility: async () => undefined };
        if (request === './course-exam-gate') return { assertCourseExamWatchGate: async () => undefined };
        if (request === '../model/homework-access') {
 return { assertHomeworkAccess: async () => {
            if (!inAudience) throw new TestNotFoundError('homework audience');
        } };
}
    }
    if (fromRecordHandler && request === 'js-yaml') return { load: (value: unknown) => value };
    if (fromRecordHandler && request === '../error') return errors;
    if (fromRecordHandler && request === '../lib/teach-access') return { canManageTeachContainer: (actor: ReturnType<typeof makeUser>) => actor.hasPerm() };
    if (fromRecordHandler && request === '../lib/set-problem-access') {
 return {
        currentSetProblemPids: async () => null,
        projectCurrentSetTdoc: async (doc: Tdoc) => doc,
    };
}
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
                        ? !context.authorizedSetRecord && !context.contextualProblemAccess &&
                          !context.virtualAttemptId &&
                          (!context.tdoc || (!context.teamRecordAccess && !context.tsdoc?.attend))
                            ? 'direct-stable'
                            : 'container'
                        : context.kind === 'record-detail-connection'
                          ? !context.authorizedSetRecord && !context.contextualProblemAccess &&
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
    if (fromRecordHandler && request === '../model/system') return { get: () => 20, default: { get: () => 20 } };
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
    if (fromRecordHandler && request === './contest') {
        return {
            ContestDetailBaseHandler: HandlerStub,
            async hideAssignRestrictedContest() { return undefined; },
            async assertHomeworkAccessOrHide() { return undefined; },
        };
    }
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
                    return virtualAttempt;
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
        group: [],
        own: () => false,
        hasPerm: (perm?: bigint) => perm === PERM.PERM_ATTEND_CONTEST || perm === PERM.PERM_ATTEND_HOMEWORK,
        hasPriv: () => false,
    };
}

function makeHandler(Ctor: any): any {
    const handler = new Ctor() as HandlerStub;
    handler.user = makeUser();
    handler.response = { body: {} };
    handler.args = {};
    (handler as any).domain = { _id: 'd' };
    (handler as any).session = {};
    (handler as any).translate = (value: string) => value;
    return handler as any;
}

class RecordingStudentDirectory extends InMemoryStudentDirectory {
    async findStudentsByUserIds(domainId: string, uids: number[]) {
        calls.studentQueries.push({ domainId, uids });
        return super.findStudentsByUserIds(domainId, uids);
    }
}
registerStudentDirectory(
    new RecordingStudentDirectory({ students: [studentRecord({ domainId: 'd', boundUserId: 42, studentId: '240000042', realName: '学生甲' })] }),
);

beforeEach(() => {
    virtualAttempt = null;
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
    hiddenProblem.problemKind = undefined;
    hiddenProblem.config = {};
    delete tdoc.setConfig;
    allowRecordDetails = true;
    allowRecordList = true;
    concealScore = false;
    listedProblems = {};
    inAudience = true;
    validClient = false;
    attended = true;
    delete tdoc._code;
    tdoc.beginAt = beginAt;
    tdoc.endAt = endAt;
    (global.Hydro.model as unknown as Record<string, unknown>).vigilguard = {
        clientSessionKeyFromSession: () => 'test-session',
        isValidClientSessionForContest: async () => validClient,
    };
});

describe('configured record socket permissions', () => {
    function configureRecord(purpose: 'exam' | 'homework' = 'exam') {
        tdoc.setConfig = { ...createDraftConfig(purpose), publication: 'published' };
        tdoc.setConfig.settings.authorization = { defaults: { ...SET_DEFAULT_PERMISSIONS, records: 'details' }, groups: [] };
        tdoc.beginAt = new Date(Date.now() - 60_000);
        tdoc.endAt = new Date(Date.now() + 60_000);
        currentRecord = { ...ordinaryRecord, uid: 43, contest: tid };
    }

    it('checks the record own set audience without a tid query for HTTP and WebSocket', async () => {
        for (const purpose of ['exam', 'homework'] as const) {
            configureRecord(purpose);
            inAudience = false;
            for (const Ctor of [recordHandlerModule.RecordDetailHandler, recordHandlerModule.RecordDetailConnectionHandler]) {
                const handler = makeHandler(Ctor);
                await assert.rejects(() => handler.prepare('d', rid), TestNotFoundError);
            }
        }
        assert.equal(calls.sent.length, 0);
    });

    it('requires a live bound client for a configured record, even without tid', async () => {
        configureRecord();
        clientRequired = true;
        for (const Ctor of [recordHandlerModule.RecordDetailHandler, recordHandlerModule.RecordDetailConnectionHandler]) {
            const handler = makeHandler(Ctor);
            await assert.rejects(() => handler.prepare('d', rid), TestPermissionError);
        }
    });

    it('requires invitation attendance before granting record list or detail access', async () => {
        configureRecord();
        tdoc._code = 'invitation';
        attended = false;
        for (const Ctor of [recordHandlerModule.RecordDetailHandler, recordHandlerModule.RecordDetailConnectionHandler]) {
            await assert.rejects(() => makeHandler(Ctor).prepare('d', rid), TestPermissionError);
        }
        await assert.rejects(() => makeHandler(recordHandlerModule.RecordListHandler).get('d', 1, undefined, tid), TestPermissionError);
        await assert.rejects(() => makeHandler(recordHandlerModule.RecordMainConnectionHandler).prepare('d', tid), TestPermissionError);
        attended = true;
        await makeHandler(recordHandlerModule.RecordDetailHandler).prepare('d', rid);
    });

    it('uses the authorized set for hidden problem details in HTTP and the live socket', async () => {
        configureRecord();
        const page = makeHandler(recordHandlerModule.RecordDetailHandler);
        await page.prepare('d', rid);
        await page.get('d', rid);
        assert.equal(page.response.body.pdoc.docId, hiddenProblem.docId);
        const socket = makeHandler(recordHandlerModule.RecordDetailConnectionHandler);
        socket.onRecordChange = async (rdoc: unknown) => { await socket.sendUpdate(rdoc); };
        await socket.prepare('d', rid, undefined, false, true);
        assert.equal(calls.sent[0].rdoc.code, ordinaryRecord.code);
        assert.deepEqual(calls.viewableProblems, []);
    });

    it('stops queued record updates after audience removal', async () => {
        configureRecord();
        const handler = makeHandler(recordHandlerModule.RecordDetailConnectionHandler);
        handler.tdoc = tdoc;
        handler.noTemplate = true;
        const closed: number[] = [];
        handler.close = (code: number) => closed.push(code);
        await handler.sendUpdate(currentRecord);
        inAudience = false;
        await handler.sendUpdate(currentRecord);
        assert.equal(calls.sent.length, 1);
        assert.deepEqual(closed, [4003]);
    });

    it('only exposes difficulty in a student record when enabled', async () => {
        configureRecord();
        for (const showDifficulty of [false, true]) {
            tdoc.setConfig!.settings.experience = { ...SET_EXPERIENCE_DEFAULTS, showDifficulty };
            const page = makeHandler(recordHandlerModule.RecordDetailHandler);
            await page.prepare('d', rid);
            await page.get('d', rid);
            assert.equal(page.response.body.pdoc.difficulty, showDifficulty ? 7 : undefined);
        }
    });

    it('retains answers but removes question text and choices when problem viewing is disabled', async () => {
        configureRecord();
        hiddenProblem.problemKind = 'single';
        currentRecord.code = 'q1: A';
        for (const problems of ['hidden', 'view'] as const) {
            hiddenProblem.config = { type: 'objective', answers: { q1: ['A', 10, { kind: 'single', prompt: 'private prompt', choices: ['first', 'second'] }] } };
            tdoc.setConfig!.settings.authorization!.defaults.problems = problems;
            const page = makeHandler(recordHandlerModule.RecordDetailHandler);
            await page.prepare('d', rid);
            await page.get('d', rid);
            const response = page.response.body;
            assert.equal(response.rdoc.code, 'q1: A');
            assert.equal(response.pdoc.config.questions[0].prompt, problems === 'view' ? 'private prompt' : undefined);
            assert.equal(response.pdoc.config.questions[0].choices?.[0], problems === 'view' ? 'first' : undefined);
            assert.equal(response.pdoc.config.options?.q1?.[0], problems === 'view' ? 'first' : undefined);
            assert.equal(response.pdoc.title, problems === 'view' ? 'Hidden' : '题目不可见');
        }
    });

    it('preserves manager record viewing when student access and difficulty are disabled', async () => {
        configureRecord();
        tdoc.setConfig!.settings.authorization!.defaults.problems = 'hidden';
        inAudience = false;
        clientRequired = true;
        const page = makeHandler(recordHandlerModule.RecordDetailHandler);
        page.user.hasPriv = () => true;
        await page.prepare('d', rid);
        await page.get('d', rid);
        assert.equal(page.response.body.pdoc.difficulty, 7);
        assert.equal(page.response.body.pdoc.title, 'Hidden');
    });

    it('also strips hidden question content from record list problem metadata', async () => {
        configureRecord();
        tdoc.setConfig!.settings.authorization!.defaults.problems = 'hidden';
        listedProblems = { 7: { ...hiddenProblem, problemKind: 'single', config: {
            type: 'objective', questions: [{ key: 'q1', kind: 'single', score: 10, prompt: 'private prompt', choices: ['first'] }],
            options: { q1: ['first'] },
        } } };
        const page = makeHandler(recordHandlerModule.RecordListHandler);
        await page.get('d', 1, undefined, tid);
        assert.deepEqual(page.response.body.pdict[7].config, { type: 'objective', questions: [{ key: 'q1', kind: 'single', score: 10 }] });
        assert.equal(page.response.body.pdict[7].title, '题目不可见');
    });

    it('checks the same audience in HTTP record lists and list socket connections', async () => {
        configureRecord();
        inAudience = false;
        const page = makeHandler(recordHandlerModule.RecordListHandler);
        await assert.rejects(() => page.get('d', 1, undefined, tid), TestNotFoundError);
        const socket = makeHandler(recordHandlerModule.RecordMainConnectionHandler);
        await assert.rejects(() => socket.prepare('d', tid), TestNotFoundError);
    });

    it('checks audience, client and list permission again after an update was queued', async () => {
        const revocations = [
            () => { inAudience = false; },
            () => { clientRequired = true; },
            () => { allowRecordList = false; },
        ];
        for (const revoke of revocations) {
            configureRecord();
            inAudience = true;
            clientRequired = false;
            allowRecordList = true;
            const socket = makeHandler(recordHandlerModule.RecordMainConnectionHandler);
            socket.tdoc = tdoc;
            socket.args = { domainId: 'd' };
            socket.throttleQueueClear = () => undefined;
            const closed: number[] = [];
            socket.close = (code: number) => closed.push(code);
            socket.queueSend(rid.toHexString(), async (rdoc: unknown) => ({ rdoc }), currentRecord);
            revoke();
            await socket.queueClear();
            assert.deepEqual(closed, [4003]);
        }
        assert.equal(calls.sent.length, 0);
    });

    it('projects queued list results with the latest feedback settings', async () => {
        configureRecord();
        const socket = makeHandler(recordHandlerModule.RecordMainConnectionHandler);
        socket.tdoc = tdoc;
        socket.throttleQueueClear = () => undefined;
        socket.queueSend(rid.toHexString(), async (rdoc: unknown) => ({ rdoc }), currentRecord);
        concealScore = true;
        await socket.queueClear();
        assert.equal(calls.sent[0].rdoc.score, null);
    });

    it('rechecks detail permission at the final send, including an already queued update', async () => {
        tdoc.setConfig = { ...createDraftConfig('exam'), publication: 'published' };
        const handler = makeHandler(recordHandlerModule.RecordDetailConnectionHandler);
        handler.args = { domainId: 'd' };
        handler.tdoc = tdoc;
        handler.pdoc = hiddenProblem;
        handler.noTemplate = true;
        handler.canViewCode = true;
        const closed: number[] = [];
        handler.close = (code: number) => closed.push(code);
        const queuedRecord = { ...ordinaryRecord, uid: 43, contest: tid };
        await handler.sendUpdate(queuedRecord);
        assert.equal(calls.sent[0].rdoc.code, ordinaryRecord.code);
        allowRecordDetails = false;
        await handler.sendUpdate(queuedRecord);
        assert.equal(calls.sent.length, 1);
        assert.deepEqual(closed, [4003]);
    });

    it('never includes code or private diagnostics in a list socket update', async () => {
        const handler = makeHandler(recordHandlerModule.RecordMainConnectionHandler);
        handler.args = { domainId: 'd' };
        handler.tid = tid.toHexString();
        handler.tdoc = tdoc;
        handler.noTemplate = true;
        let payload: unknown;
        handler.queueSend = async (_id: string, read: () => Promise<unknown>) => { payload = await read(); };
        await handler.onRecordChange({
            ...ordinaryRecord, uid: 43, contest: tid,
            compilerTexts: ['private diagnostic'], files: { code: 'private source key' },
        });
        assert.deepEqual(payload, { rdoc: {
            _id: rid, domainId: 'd', uid: 43, pid: 7, contest: tid, status: STATUS.STATUS_ACCEPTED,
        }, recordScoreAction: null });
    });
});

describe('post-contest practice record handlers', () => {
    it('maps VP letter filters through its immutable paper instead of the formal contest pool', async () => {
        virtualAttempt = { _id: new ObjectId(), uid: 42, status: 'ended', snapshot: { pids: [8] } };
        const handler = makeHandler(recordHandlerModule.RecordListHandler);
        handler.tdoc = tdoc;
        await handler.get('d', 1, 'A', tid, false, true, '42');
        expect(calls.recordQueries[0].pid).to.equal(8);
        expect(calls.recordQueries[0].virtualAttemptId.equals(virtualAttempt._id)).to.equal(true);
    });

    it('applies authorized name and inclusive calendar filters before pagination', async () => {
        const handler = makeHandler(recordHandlerModule.RecordListHandler);
        handler.user.hasPriv = (priv: number) => priv === PRIV.PRIV_EDIT_SYSTEM;
        handler.tdoc = tdoc;
        await handler.get('d', 2, undefined, tid, false, false, '学生甲', 'cc.cc17', 1, false, false, false, false, '2026-10-01', '2026-10-31');
        const query = calls.recordQueries[0];
        expect(query.uid).to.equal(42);
        expect(query.lang).to.equal('cc.cc17');
        expect(query.status).to.equal(1);
        expect(query.$and[0]._id.$gte.getTimestamp().toISOString()).to.equal('2026-09-30T16:00:00.000Z');
        expect(query.$and[0]._id.$lt.getTimestamp().toISOString()).to.equal('2026-10-31T16:00:00.000Z');
    });

    it('keeps live record updates inside the selected user and date interval', async () => {
        const handler = makeHandler(recordHandlerModule.RecordMainConnectionHandler);
        handler.args.domainId = 'd';
        handler.user.hasPriv = (priv: number) => priv === PRIV.PRIV_EDIT_SYSTEM;
        await handler.prepare('d', tid, false, false, undefined, '学生甲', undefined, undefined, false, false, false, true, '2026-10-01', '2026-10-31');
        const queued: string[] = [];
        handler.queueSend = (id: string) => queued.push(id);
        const within = ObjectId.createFromTime(Date.parse('2026-10-31T15:59:59Z') / 1000);
        await handler.onRecordChange({ ...ordinaryRecord, contest: tid, _id: ObjectId.createFromTime(Date.parse('2026-10-31T16:00:00Z') / 1000) });
        await handler.onRecordChange({ ...ordinaryRecord, contest: tid, _id: within, uid: 99 });
        expect(queued).to.deep.equal([]);
        await handler.onRecordChange({ ...ordinaryRecord, contest: tid, _id: within });
        expect(queued).to.deep.equal([within.toHexString()]);
    });

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

    it('adds bound student identity to the ordinary record list only for a system admin', async () => {
        const handler = makeHandler(recordHandlerModule.RecordListHandler);
        await handler.get('d', 1, undefined, undefined, false, false, '42', undefined, undefined, true);
        expect(handler.response.body.studentDict).to.deep.equal({});
        expect(calls.studentQueries).to.deep.equal([]);

        const adminHandler = makeHandler(recordHandlerModule.RecordListHandler);
        adminHandler.user.hasPriv = (privilege: number) => privilege === PRIV.PRIV_EDIT_SYSTEM;
        await adminHandler.get('d', 1, undefined, undefined, false, false, '42', undefined, undefined, true);
        expect(adminHandler.response.body.studentDict).to.deep.equal({ 42: { studentId: '240000042', realName: '学生甲' } });
        expect(calls.studentQueries).to.deep.equal([{ domainId: 'd', uids: [42] }]);
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

    it('maps public function case hints to judge case ids without exposing private hints', async () => {
        hiddenProblem.problemKind = 'function';
        hiddenProblem.config = {
            type: 'function',
            cases: [
                { input: 'a.in', output: 'a.out', hint: '检查零值。', hintPublic: true },
                { input: 'b.in', output: 'b.out', hint: 'private', hintPublic: false },
                { input: 'c.in', output: 'c.out', hint: '检查最大值。', hintPublic: true },
            ],
        };
        const handler = makeHandler(recordHandlerModule.RecordDetailHandler);
        handler.args = { tid, practice: true };
        handler.tdoc = tdoc;
        handler.tsdoc = { attend: 1 };
        await handler.prepare('d', rid, true);
        await handler.get('d', rid, false);
        expect(handler.response.body.testHints).to.deep.equal({
            '1-1': { hint: '检查零值。' },
            '1-3': { hint: '检查最大值。' },
        });
    });

    it('shows public function hints while the homework is still open', async () => {
        const saved = { rule: tdoc.rule, endAt: tdoc.endAt };
        tdoc.rule = 'homework';
        tdoc.endAt = new Date('2027-01-01T00:00:00.000Z');
        hiddenProblem.problemKind = 'function';
        hiddenProblem.config = {
            type: 'function',
            cases: [
                { input: 'a.in', output: 'a.out', hint: '检查零值。', hintPublic: true },
                { input: 'b.in', output: 'b.out', hint: 'private', hintPublic: false },
            ],
        };
        try {
            const handler = makeHandler(recordHandlerModule.RecordDetailHandler);
            handler.args = { tid };
            handler.tdoc = tdoc;
            handler.tsdoc = { attend: 1 };
            currentRecord.contest = tid;
            await handler.prepare('d', rid, false);
            await handler.get('d', rid, false);
            expect(handler.response.body.testHints).to.deep.equal({
                '1-1': { hint: '检查零值。' },
            });
        } finally {
            tdoc.rule = saved.rule;
            tdoc.endAt = saved.endAt;
        }
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
        expect(source.slice(detailIdx, source.indexOf('};', detailIdx))).to.include('tsdoc: this.tsdoc');
        expect(source.slice(connectionIdx, source.indexOf('};', connectionIdx))).to.include('recordUid: rdoc.uid');
        expect(source.slice(connectionIdx, source.indexOf('};', connectionIdx))).to.include('contest: rdoc.contest');
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

    it('keeps a score-only judging socket open until the published progress finishes', async () => {
        const handler = makeHandler(recordHandlerModule.RecordDetailConnectionHandler) as any;
        handler.args = { domainId: 'd' };
        await handler.prepare('d', rid, undefined, false, true);
        handler.throttleSend.cancel();
        await handler.onRecordChange({ ...currentRecord, status: undefined, score: 0, judging: true });
        expect(handler.disconnectTimeout).to.equal(null);
        await handler.onRecordChange({ ...currentRecord, status: undefined, score: 60, judging: false });
        expect(handler.disconnectTimeout).not.to.equal(null);
        clearTimeout(handler.disconnectTimeout);
        handler.throttleSend.cancel();
    });

    it('returns the participant source and overall verdict without private diagnostics', async () => {
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
            status: STATUS.STATUS_ACCEPTED, score: 100, time: 1, memory: 1,
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

    it('pushes the overall verdict without diagnostics or storage keys through the detail websocket', async () => {
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
                    status: STATUS.STATUS_ACCEPTED, score: 100, time: 1, memory: 1,
                },
            },
        ]);
        expect(JSON.stringify(calls.sent)).not.to.include('private');
        expect(JSON.stringify(calls.sent)).not.to.include('testCases');
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
                    status: STATUS.STATUS_ACCEPTED, score: 100, time: 1, memory: 1,
                },
            },
        ]);
    });
});
