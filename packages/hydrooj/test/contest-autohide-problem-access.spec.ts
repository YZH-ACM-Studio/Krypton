import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {} };
const { PermissionError: RealPermissionError } = require('../src/error');
const { classifyPermissionErrorRoute } = require('../src/lib/permission-error-routing');
const { PRIV: RealPriv } = require('../src/model/builtin');

const PERM = {
    PERM_EDIT_PROBLEM: 1n,
    PERM_CREATE_PROBLEM: 2n,
    PERM_EDIT_CONTEST: 4n,
    PERM_EDIT_CONTEST_SELF: 8n,
};
const PRIV = { PRIV_EDIT_SYSTEM: 1 };

class TestPermissionError extends Error {
    name = 'PermissionError';
    status = 403;
}
class TestValidationError extends Error {
    name = 'ValidationError';
}
class UnexpectedProblemWrite extends Error {}

const calls = {
    contestDeletes: [] as any[],
    contestEdits: [] as any[],
    documentSets: [] as any[],
    events: [] as string[],
    getListProjections: [] as any[],
    recalcClears: [] as any[],
    getLists: [] as any[],
    maintains: [] as any[],
    publishes: [] as any[],
    modelDomains: [] as Array<{ model: string; domainId: string }>,
    managedAutoReveals: [] as any[],
    maintenanceEvents: [] as string[],
    problemEdits: [] as any[],
    permissionChecks: [] as bigint[],
    scheduleAdds: [] as any[],
    scheduleDeletes: [] as any[],
    selections: [] as any[],
    storageDeletes: [] as any[],
};
const problemDocs = new Map<number, any>();
let scheduleTasks: any[];
let nextScheduleId: number;
let failScheduleAdd: boolean;
let currentContest: any;
let currentStatus: any;
let recalcError: Error | null;
let rejectConcurrentProblemEdits: boolean;
let activeProblemEdits: number;
let maxActiveProblemEdits: number;
let failProblemEditPid: number | null;
let failProblemEditOnce: boolean;
let allowCanonicalProblemEdit: boolean;
let failCanonicalProblemEditPid: number | null;
let contestGetError: Error | null;

const contestStub: any = {
    RULES: { acm: { hidden: false, TEXT: 'ACM' } },
    async get(domainId: string) {
        calls.modelDomains.push({ model: 'contest.get', domainId });
        if (contestGetError) throw contestGetError;
        return currentContest;
    },
    async getStatus(domainId: string) {
        calls.modelDomains.push({ model: 'contest.getStatus', domainId });
        return currentStatus;
    },
    async getMultiClarification(domainId: string) {
        calls.modelDomains.push({ model: 'contest.getMultiClarification', domainId });
        return [];
    },
    isDone: () => true,
    isNotStarted: () => false,
    isClientRequired: () => false,
    isClientFinished: () => false,
    getParticipationMode: (tdoc: any) => tdoc.participationMode || 'individual',
    canShowSelfRecord: () => false,
    async edit(...args: any[]) {
        calls.events.push('contest.edit');
        calls.contestEdits.push(args);
        Object.assign(currentContest, args[2]);
    },
    async add() {
        calls.events.push('contest.add');
        return 'new-contest';
    },
    async recalcStatus() {
        calls.events.push('contest.recalcStatus');
        if (recalcError) throw recalcError;
        return undefined;
    },
    async del(...args: any[]) {
        calls.events.push('contest.del');
        calls.contestDeletes.push(args);
        currentContest = null;
    },
};

const problemStub = {
    PROJECTION_CONTEST_LIST: ['domainId', 'docId', 'owner', 'title'],
    PROJECTION_PUBLIC: ['domainId', 'docId', 'owner', 'hidden'],
    assertProblemAclDomain(user: any, domainId: string) {
        if (!user._problemAclLoaded || user._problemAclDomainId !== domainId) throw new TestPermissionError();
    },
    async getList(domainId: string, pids: number[], ...options: any[]) {
        calls.modelDomains.push({ model: 'problem.getList', domainId });
        calls.getLists.push({ domainId, pids: [...pids] });
        calls.getListProjections.push(options[2]);
        return Object.fromEntries(
            pids
                .map((pid) => problemDocs.get(pid))
                .filter(Boolean)
                .map((doc) => [doc.docId, doc]),
        );
    },
    async get(domainId: string, pid: number) {
        calls.modelDomains.push({ model: 'problem.get', domainId });
        return problemDocs.get(pid) || null;
    },
    canMaintainProblem(user: any, pdoc: any) {
        calls.events.push(`maintain:${pdoc.docId}`);
        calls.maintains.push({ user, pdoc });
        return pdoc.allowed === true && !user._aclFencedPids.has(pdoc.docId);
    },
    canPublishProblem(user: any, pdoc: any) {
        calls.events.push(`publish:${pdoc.docId}`);
        calls.publishes.push({ user, pdoc });
        if (user._aclFencedPids.has(pdoc.docId)) return false;
        if (pdoc.pidNamespaceId && user._pidNamespaceManagerIds?.has(pdoc.pidNamespaceId)) return true;
        return pdoc.authoringMode === 'managed' ? pdoc.publishAllowed === true : pdoc.allowed === true;
    },
    async edit(...args: any[]) {
        calls.events.push(`problem.edit:${args[1]}`);
        calls.problemEdits.push(args);
        if (!allowCanonicalProblemEdit || failCanonicalProblemEditPid === args[1]) throw new UnexpectedProblemWrite();
        Object.assign(problemDocs.get(args[1]), args[2]);
    },
    async editAuthorized(...args: any[]) {
        calls.events.push(`problem.editAuthorized:${args[1]}`);
        calls.maintenanceEvents.push(`problem.editAuthorized:${args[1]}`);
        calls.problemEdits.push(args);
        activeProblemEdits += 1;
        maxActiveProblemEdits = Math.max(maxActiveProblemEdits, activeProblemEdits);
        if (failProblemEditPid === args[1]) {
            if (failProblemEditOnce) failProblemEditPid = null;
            activeProblemEdits -= 1;
            throw new TestPermissionError();
        }
        if (rejectConcurrentProblemEdits) {
            await new Promise((resolve) => setImmediate(resolve));
            const overlapped = activeProblemEdits > 1;
            activeProblemEdits -= 1;
            if (overlapped) throw new TestPermissionError();
        } else {
            activeProblemEdits -= 1;
        }
        Object.assign(problemDocs.get(args[1]), args[2]);
    },
    async autoRevealConfirmedManagedProgrammingProblem(input: any) {
        calls.events.push(`problem.autoReveal:${input.docId}`);
        calls.managedAutoReveals.push(input);
        return problemDocs.get(input.docId) || null;
    },
};

const userStub = {
    async getList(domainId: string) {
        calls.modelDomains.push({ model: 'user.getList', domainId });
        return {};
    },
};

const problemAccessStub = {
    async assertProblemBankSelection(domainId: string, pids: number[], user: any, existingPids: number[]) {
        calls.selections.push({ domainId, pids: [...pids], user, existingPids: [...existingPids] });
    },
};

function noopDecorator() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}
class HandlerStub {}
const serverStub = {
    Handler: HandlerStub,
    param: noopDecorator,
    post: noopDecorator,
    Type: class {},
    Types: new Proxy({}, { get: () => () => ({}) }),
};
class ServiceStub {
    ctx: any;
    constructor(ctx: any) {
        this.ctx = ctx;
    }
}

const genericModel = new Proxy(
    {},
    {
        get: () => async () => undefined,
    },
);
const documentStub = {
    TYPE_CONTEST: 30,
    async set(...args: any[]) {
        calls.documentSets.push(args);
        Object.assign(currentContest, args[3]);
    },
    coll: {
        async findOneAndUpdate(...args: any[]) {
            calls.recalcClears.push(args);
            return { docId: 'contest' };
        },
    },
};
const scheduleStub = {
    async deleteMany(query: any) {
        calls.maintenanceEvents.push('schedule.deleteMany');
        calls.scheduleDeletes.push(query);
        scheduleTasks = scheduleTasks.filter((task) => {
            if (task.type !== query.type || task.subType !== query.subType || task.domainId !== query.domainId || task.tid !== query.tid) return true;
            if (query._id?.$ne !== undefined && task._id === query._id.$ne) return true;
            return false;
        });
    },
    async add(task: any) {
        calls.maintenanceEvents.push('schedule.add');
        calls.scheduleAdds.push(task);
        if (failScheduleAdd) throw new Error('schedule add failed');
        const _id = `schedule-${nextScheduleId++}`;
        scheduleTasks.push({ ...task, _id });
        return _id;
    },
};
const discussionStub = {
    getMulti: () => ({
        project: () => ({
            toArray: async () => [],
        }),
    }),
    del: async () => undefined,
};
const recordStub = {
    coll: { countDocuments: async () => 0 },
    updateMulti: async () => undefined,
};
const storageStub = {
    async del(...args: any[]) {
        calls.storageDeletes.push(args);
    },
};
const errors = new Proxy(
    {
        PermissionError: TestPermissionError,
        ValidationError: TestValidationError,
    },
    {
        get(target, key: string) {
            return target[key] || class extends Error {};
        },
    },
);

const contestPath = require.resolve('../src/handler/contest.ts');
const paperPath = require.resolve('../src/handler/paper.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    const fromContest = parent?.filename === contestPath;
    if (fromContest && request === '../context') return { Context: class {}, Service: ServiceStub };
    if (fromContest && request === '../error') return errors;
    if (fromContest && request === '../model/builtin') return { PERM, PRIV, STATUS: {} };
    if (fromContest && request === '../model/contest') return contestStub;
    if (fromContest && request === '../model/problem') return problemStub;
    if (fromContest && request === '../model/problem-access') return problemAccessStub;
    if (fromContest && request === '../model/document') return documentStub;
    if (fromContest && request === '../model/discussion') return discussionStub;
    if (fromContest && request === '../model/record') return { __esModule: true, default: recordStub };
    if (fromContest && request === '../model/schedule') return scheduleStub;
    if (fromContest && request === '../model/storage') return { __esModule: true, default: storageStub };
    if (fromContest && request === '../model/user') return userStub;
    if (fromContest && request === '../service/server') return serverStub;
    if (fromContest && request.startsWith('../model/')) return genericModel;
    return originalLoad.call(this, request, parent, isMain);
};

let contestModule: typeof import('../src/handler/contest');
try {
    delete require.cache[contestPath];
    contestModule = require(contestPath);
} finally {
    Module._load = originalLoad;
}

function makeUser() {
    return {
        _id: 42,
        _problemAclLoaded: true,
        _problemAclDomainId: 'system',
        _aclFencedPids: new Set<number>(),
        _pidNamespaceManagerIds: new Set<string>(),
        timeZone: 'Asia/Shanghai',
        hasPerm: (perm: bigint) => perm === PERM.PERM_EDIT_PROBLEM,
        hasPriv: () => false,
        own: () => true,
    } as any;
}

function makeHandler() {
    const handler = new (contestModule as any).ContestEditHandler();
    Object.assign(handler, {
        domain: { _id: 'system' },
        user: makeUser(),
        tdoc: {
            domainId: 'system',
            docId: 'contest',
            owner: 42,
            rule: 'acm',
            pids: [11, 22],
            beginAt: new Date('2099-01-01T00:00:00Z'),
            endAt: new Date('2099-01-01T02:00:00Z'),
            lockAt: null,
        },
        response: { body: {} },
        url: () => '/contest/contest',
        checkPerm(perm: bigint) {
            calls.permissionChecks.push(perm);
            if (!this.user.hasPerm(perm)) throw new TestPermissionError();
        },
    });
    return handler;
}

function makeDetailHandler(HandlerClass: any) {
    const handler = new HandlerClass();
    Object.assign(handler, {
        ctx: { parallel: async () => undefined },
        domain: { _id: 'system' },
        user: makeUser(),
        response: { body: {} },
        request: { ip: '127.0.0.1', json: false },
        url: () => '/target',
        back: () => undefined,
        checkPerm: () => undefined,
    });
    return handler;
}

async function update(handler: any, pids = '11,22', beginAtDate = '2099-01-01', autoHide = true) {
    return handler.postUpdate('forged-domain', 'contest', beginAtDate, '08:00', 2, 'Contest', 'Body', 'acm', pids, false, '', autoHide);
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
    problemDocs.clear();
    currentContest = {
        domainId: 'system',
        docId: { toHexString: () => 'contest' },
        owner: 42,
        rule: 'acm',
        title: 'Contest',
        content: '',
        pids: [11],
        assign: [],
        privateFiles: [],
        files: [],
        maintainer: [],
        score: {},
    };
    currentStatus = null;
    recalcError = null;
    rejectConcurrentProblemEdits = false;
    activeProblemEdits = 0;
    maxActiveProblemEdits = 0;
    failProblemEditPid = null;
    failProblemEditOnce = false;
    allowCanonicalProblemEdit = false;
    failCanonicalProblemEditPid = null;
    contestGetError = null;
    scheduleTasks = [];
    nextScheduleId = 1;
    failScheduleAdd = false;
});

describe('contest status recalculation ordering', () => {
    async function updateLock(handler: any, lock: number = null) {
        return handler.postUpdate(
            'forged-domain',
            'contest',
            '2099-01-01',
            '08:00',
            2,
            'Contest',
            'Body',
            'acm',
            '11,22',
            false,
            '',
            false,
            [],
            lock,
        );
    }

    it('persists the lock boundary before recalculating exactly once', async () => {
        const handler = makeHandler();
        handler.tdoc.unlocked = true;

        await updateLock(handler, 30);

        expect(calls.events).to.deep.equal(['contest.edit', 'contest.edit', 'contest.recalcStatus']);
        expect(calls.contestEdits[1][2].lockAt.toISOString()).to.equal('2099-01-01T01:30:00.000Z');
        expect(calls.contestEdits[1][2].unlocked).to.equal(false);
        expect(calls.recalcClears).to.have.length(1);
        expect(handler.response.redirect).to.equal('/contest/contest');
    });

    it('does not recalculate for equivalent date objects and unchanged scoring inputs', async () => {
        const handler = makeHandler();

        await updateLock(handler);

        expect(calls.events).to.deep.equal(['contest.edit', 'contest.edit']);
        expect(calls.contestEdits[1][2]).not.to.have.property('unlocked');
        expect(calls.recalcClears).to.deep.equal([]);
    });

    it('compares problem ids without mutating the loaded contest order', async () => {
        const handler = makeHandler();
        handler.tdoc.pids = [22, 11];

        await updateLock(handler);

        expect(handler.tdoc.pids).to.deep.equal([22, 11]);
        expect(calls.events).to.deep.equal(['contest.edit', 'contest.edit']);
    });

    it('fails the save response when recalculation fails after persistence', async () => {
        const handler = makeHandler();
        recalcError = new Error('recalc failed');

        const error = await captureFailure(() => updateLock(handler, 30));

        expect(error).to.equal(recalcError);
        expect(calls.events).to.deep.equal(['contest.edit', 'contest.edit', 'contest.recalcStatus']);
        expect(calls.recalcClears).to.deep.equal([]);
        expect(handler.response.redirect).to.equal(undefined);
    });

    it('retries a previously failed recalculation even when the submitted values are unchanged', async () => {
        const handler = makeHandler();
        handler.tdoc.statusRecalcToken = 'failed-request-token';

        await updateLock(handler);

        expect(calls.events).to.deep.equal(['contest.edit', 'contest.edit', 'contest.recalcStatus']);
        expect(calls.contestEdits[0][2].statusRecalcToken).to.be.a('string').and.not.equal('failed-request-token');
        expect(calls.contestEdits[1][2].statusRecalcToken).to.equal(calls.contestEdits[0][2].statusRecalcToken);
        expect(calls.recalcClears[0][0].statusRecalcToken).to.equal(calls.contestEdits[0][2].statusRecalcToken);
    });
});

describe('contest autoHide canonical maintenance', () => {
    it('serializes multi-problem autoHide writes that refresh one request user ACL', async () => {
        rejectConcurrentProblemEdits = true;
        problemDocs.set(11, { domainId: 'system', docId: 11, owner: 42, allowed: true, hidden: false });
        problemDocs.set(22, { domainId: 'system', docId: 22, owner: 42, allowed: true, hidden: false });

        await update(makeHandler());

        expect(maxActiveProblemEdits).to.equal(1);
        expect(calls.problemEdits.map((args) => args[1])).to.deep.equal([11, 22]);
        expect([problemDocs.get(11)?.hidden, problemDocs.get(22)?.hidden]).to.deep.equal([true, true]);
    });

    it('fails visibly at the exact persisted boundary when a later autoHide write is rejected', async () => {
        failProblemEditPid = 22;
        problemDocs.set(11, { domainId: 'system', docId: 11, owner: 42, allowed: true, hidden: false });
        problemDocs.set(22, { domainId: 'system', docId: 22, owner: 42, allowed: true, hidden: false });
        const handler = makeHandler();

        const error = await captureFailure(() => update(handler));

        expect(error?.name).to.equal('PermissionError');
        expect(calls.contestEdits).to.have.length(1);
        expect(calls.contestEdits[0][2].autoHide).to.equal(true);
        expect(calls.contestEdits[0][2].autoHidePendingPids).to.deep.equal([11, 22]);
        expect(calls.maintenanceEvents.slice(0, 2)).to.deep.equal(['schedule.add', 'schedule.deleteMany']);
        expect(calls.problemEdits.map((args) => args[1])).to.deep.equal([11, 22]);
        expect([problemDocs.get(11)?.hidden, problemDocs.get(22)?.hidden]).to.deep.equal([true, false]);
        expect(scheduleTasks).to.have.length(1);
        expect(scheduleTasks[0].operation).to.deep.equal(['unhide']);
        expect(scheduleTasks[0].interval).to.deep.equal([1, 'minute']);
        expect(activeProblemEdits).to.equal(0);
        expect(handler.response.redirect).to.equal(undefined);
    });

    it('retries the durable pending set after a persisted autoHide edit fails', async () => {
        problemDocs.set(11, { domainId: 'system', docId: 11, owner: 7, allowed: false, hidden: false });
        problemDocs.set(22, { domainId: 'system', docId: 22, owner: 42, allowed: true, hidden: false });
        problemDocs.set(33, { domainId: 'system', docId: 33, owner: 42, allowed: true, hidden: false });
        const firstHandler = makeHandler();
        firstHandler.tdoc.autoHide = true;
        firstHandler.tdoc.pids = [11];
        failProblemEditPid = 33;

        const firstError = await captureFailure(() => update(firstHandler, '11,22,33'));
        const persistedContest = { ...firstHandler.tdoc, ...calls.contestEdits[0][2] };

        expect(firstError?.name).to.equal('PermissionError');
        expect(persistedContest.autoHidePendingPids).to.deep.equal([22, 33]);
        expect(persistedContest.autoHideProblemPids).to.deep.equal([11, 22, 33]);
        expect([problemDocs.get(22)?.hidden, problemDocs.get(33)?.hidden]).to.deep.equal([true, false]);
        expect(scheduleTasks).to.have.length(1);

        for (const value of Object.values(calls)) value.length = 0;
        failProblemEditPid = null;
        const retryHandler = makeHandler();
        retryHandler.tdoc = persistedContest;

        await update(retryHandler, '11,22,33');

        expect(calls.problemEdits.map((args) => args[1])).to.deep.equal([22, 33]);
        expect([problemDocs.get(22)?.hidden, problemDocs.get(33)?.hidden]).to.deep.equal([true, true]);
        expect(calls.contestEdits.at(-1)?.[2].autoHidePendingPids).to.deep.equal([]);
        expect(calls.contestEdits.at(-1)?.[2].autoHideProblemPids).to.deep.equal([11, 22, 33]);
        expect(scheduleTasks).to.have.length(1);
        expect(retryHandler.response.redirect).to.equal('/contest/contest');
    });

    it('retains the complete tracked set when a later added problem fails, then unhides all of it after expiry', async () => {
        allowCanonicalProblemEdit = true;
        problemDocs.set(11, { domainId: 'system', docId: 11, owner: 42, allowed: true, hidden: true });
        problemDocs.set(22, { domainId: 'system', docId: 22, owner: 42, allowed: true, hidden: false });
        problemDocs.set(33, { domainId: 'system', docId: 33, owner: 42, allowed: true, hidden: false });
        const firstHandler = makeHandler();
        firstHandler.tdoc.autoHide = true;
        firstHandler.tdoc.autoHideProblemPids = [11];
        firstHandler.tdoc.pids = [11];
        failProblemEditPid = 33;

        const firstError = await captureFailure(() => update(firstHandler, '11,22,33'));
        const persistedContest = { ...firstHandler.tdoc, ...calls.contestEdits[0][2] };

        expect(firstError?.name).to.equal('PermissionError');
        expect(persistedContest.autoHidePendingPids).to.deep.equal([22, 33]);
        expect(persistedContest.autoHideProblemPids).to.deep.equal([11, 22, 33]);

        for (const value of Object.values(calls)) value.length = 0;
        failProblemEditPid = null;
        const expiredHandler = makeHandler();
        expiredHandler.tdoc = persistedContest;

        await update(expiredHandler, '11,22,33', '2020-01-01');

        expect(calls.problemEdits.map((args) => [args[1], args[2]])).to.deep.equal([
            [11, { hidden: false }],
            [22, { hidden: false }],
            [33, { hidden: false }],
        ]);
        expect(currentContest.autoHideProblemPids).to.deep.equal([]);
        expect(currentContest.autoHidePendingPids).to.deep.equal([]);
    });

    it('serializes double-save recovery and refreshes the waiting request before clearing pending targets', async () => {
        failProblemEditPid = 22;
        failProblemEditOnce = true;
        problemDocs.set(11, { domainId: 'system', docId: 11, owner: 42, allowed: true, hidden: false });
        problemDocs.set(22, { domainId: 'system', docId: 22, owner: 42, allowed: true, hidden: false });
        const firstHandler = makeHandler();
        const secondHandler = makeHandler();

        const results = await Promise.allSettled([update(firstHandler), update(secondHandler)]);

        expect(results.map((result) => result.status)).to.deep.equal(['rejected', 'fulfilled']);
        expect(calls.problemEdits.map((args) => args[1])).to.deep.equal([11, 22, 11, 22]);
        expect([problemDocs.get(11)?.hidden, problemDocs.get(22)?.hidden]).to.deep.equal([true, true]);
        expect(currentContest.autoHidePendingPids).to.deep.equal([]);
        expect(scheduleTasks).to.have.length(1);
        expect(secondHandler.response.redirect).to.equal('/contest/contest');
    });

    it('keeps a stale schedule on save failure and reschedules it from authoritative contest state before unhide', async () => {
        problemDocs.set(11, { domainId: 'system', docId: 11, owner: 42, allowed: true, hidden: false });
        problemDocs.set(22, { domainId: 'system', docId: 22, owner: 42, allowed: true, hidden: false });
        const oldEndAt = new Date('2099-01-01T02:00:00Z');
        scheduleTasks.push({
            _id: 'existing-schedule',
            type: 'schedule',
            subType: 'contest',
            domainId: 'system',
            tid: 'contest',
            operation: ['unhide'],
            executeAfter: oldEndAt,
        });
        failScheduleAdd = true;

        const error = await captureFailure(() => update(makeHandler(), '11,22', '2099-01-02'));

        expect(error?.message).to.equal('schedule add failed');
        expect(scheduleTasks.map((task) => task._id)).to.deep.equal(['existing-schedule']);
        expect(calls.scheduleDeletes).to.deep.equal([]);
        expect(calls.problemEdits).to.deep.equal([]);

        failScheduleAdd = false;
        await (contestModule as any).runContestScheduleTask(scheduleTasks[0]);

        expect(scheduleTasks).to.have.length(1);
        expect(scheduleTasks[0]._id).not.to.equal('existing-schedule');
        expect(scheduleTasks[0].executeAfter.getTime()).to.equal(currentContest.endAt.getTime());
        expect(scheduleTasks[0].executeAfter.getTime()).to.be.greaterThan(oldEndAt.getTime());
        expect(calls.problemEdits).to.deep.equal([]);
    });

    it('keeps the worker-created interval retry when contest loading fails before visibility work', async () => {
        const retry = {
            _id: 'worker-interval-retry',
            type: 'schedule',
            subType: 'contest',
            domainId: 'system',
            tid: 'contest',
            operation: ['unhide'],
            pids: [11, 22],
            executeAfter: new Date(Date.now() + 60_000),
            interval: [1, 'minute'],
        };
        scheduleTasks.push(retry);
        contestGetError = new Error('contest read failed');

        const error = await captureFailure(() =>
            (contestModule as any).runContestScheduleTask({
                ...retry,
                _id: 'popped-task',
                executeAfter: new Date(),
            }),
        );

        expect(error).to.equal(contestGetError);
        expect(scheduleTasks).to.deep.equal([retry]);
        expect(calls.problemEdits).to.deep.equal([]);
    });

    it('keeps the interval retry when authoritative stale-task rescheduling fails', async () => {
        const retry = {
            _id: 'worker-interval-retry',
            type: 'schedule',
            subType: 'contest',
            domainId: 'system',
            tid: 'contest',
            operation: ['unhide'],
            pids: [11, 22],
            executeAfter: new Date(Date.now() + 60_000),
            interval: [1, 'minute'],
        };
        scheduleTasks.push(retry);
        Object.assign(currentContest, {
            autoHide: true,
            autoHideProblemPids: [11, 22],
            endAt: new Date('2099-01-01T02:00:00Z'),
        });
        failScheduleAdd = true;

        const error = await captureFailure(() =>
            (contestModule as any).runContestScheduleTask({
                ...retry,
                _id: 'popped-task',
                executeAfter: new Date('2020-01-01T02:00:00Z'),
            }),
        );

        expect(error?.message).to.equal('schedule add failed');
        expect(scheduleTasks).to.deep.equal([retry]);
        expect(calls.scheduleDeletes).to.deep.equal([]);
        expect(calls.problemEdits).to.deep.equal([]);
    });

    it('persists and retries the exact remaining problems when scheduled auto-unhide fails', async () => {
        allowCanonicalProblemEdit = true;
        failCanonicalProblemEditPid = 22;
        for (const pid of [11, 22, 33]) problemDocs.set(pid, { domainId: 'system', docId: pid, hidden: true });
        Object.assign(currentContest, {
            autoHide: true,
            autoHidePendingPids: [],
            endAt: new Date('2020-01-01T02:00:00Z'),
            pids: [11, 22, 33],
        });

        const firstError = await captureFailure(() =>
            (contestModule as any).runContestScheduleTask({
                type: 'schedule',
                subType: 'contest',
                domainId: 'system',
                tid: 'contest',
                operation: ['unhide'],
                executeAfter: new Date('2020-01-01T02:00:00Z'),
            }),
        );

        expect(firstError).to.be.instanceOf(UnexpectedProblemWrite);
        expect([problemDocs.get(11)?.hidden, problemDocs.get(22)?.hidden, problemDocs.get(33)?.hidden]).to.deep.equal([false, true, true]);
        expect(scheduleTasks).to.have.length(1);
        expect(scheduleTasks[0].pids).to.deep.equal([22, 33]);
        expect(currentContest.autoHidePendingPids).to.deep.equal([22, 33]);

        failCanonicalProblemEditPid = null;
        const retryTask = scheduleTasks.shift();
        await (contestModule as any).runContestScheduleTask(retryTask);

        expect([problemDocs.get(11)?.hidden, problemDocs.get(22)?.hidden, problemDocs.get(33)?.hidden]).to.deep.equal([false, false, false]);
        expect(currentContest.autoHidePendingPids).to.deep.equal([]);
        expect(scheduleTasks).to.deep.equal([]);
    });

    it('retains an automatic interval retry and exact marker when recovery rescheduling also fails', async () => {
        allowCanonicalProblemEdit = true;
        failCanonicalProblemEditPid = 22;
        failScheduleAdd = true;
        for (const pid of [11, 22]) problemDocs.set(pid, { domainId: 'system', docId: pid, hidden: true });
        Object.assign(currentContest, {
            autoHide: true,
            autoHidePendingPids: [],
            autoHideProblemPids: [11, 22],
            endAt: new Date('2020-01-01T02:00:00Z'),
            pids: [11, 22],
        });
        const retry = {
            _id: 'worker-interval-retry',
            type: 'schedule',
            subType: 'contest',
            domainId: 'system',
            tid: 'contest',
            operation: ['unhide'],
            pids: [11, 22],
            executeAfter: new Date(Date.now() + 60_000),
            interval: [1, 'minute'],
        };
        scheduleTasks.push(retry);

        const error = await captureFailure(() =>
            (contestModule as any).runContestScheduleTask({
                ...retry,
                _id: 'popped-task',
                executeAfter: new Date('2020-01-01T02:00:00Z'),
            }),
        );

        expect(error).to.be.instanceOf(AggregateError);
        expect(scheduleTasks).to.deep.equal([retry]);
        expect(currentContest.autoHideProblemPids).to.deep.equal([22]);
        expect(currentContest.autoHidePendingPids).to.deep.equal([22]);
    });

    it('cleans the retained retry when its contest has already been deleted', async () => {
        const retry = {
            _id: 'worker-interval-retry',
            type: 'schedule',
            subType: 'contest',
            domainId: 'system',
            tid: 'contest',
            operation: ['unhide'],
            pids: [11, 22],
            executeAfter: new Date(Date.now() + 60_000),
            interval: [1, 'minute'],
        };
        scheduleTasks.push(retry);
        contestGetError = Object.assign(new Error('contest missing'), { name: 'ContestNotFoundError' });

        const error = await captureFailure(() =>
            (contestModule as any).runContestScheduleTask({
                ...retry,
                _id: 'claimed-task',
                executeAfter: new Date(),
            }),
        );

        expect(error).to.equal(null);
        expect(scheduleTasks).to.deep.equal([]);
        expect(calls.scheduleDeletes).to.have.length(1);
        expect(calls.problemEdits).to.deep.equal([]);
    });

    async function assertExpiredAutoHideReactivation(ordering: 'worker-first' | 'edit-first') {
        allowCanonicalProblemEdit = true;
        for (const pid of [11, 22]) problemDocs.set(pid, { domainId: 'system', docId: pid, owner: 42, allowed: true, hidden: true });
        const expired = {
            autoHide: true,
            autoHidePendingPids: [],
            beginAt: new Date('2020-01-01T00:00:00Z'),
            endAt: new Date('2020-01-01T02:00:00Z'),
            pids: [11, 22],
        };
        Object.assign(currentContest, expired);
        const handler = makeHandler();
        Object.assign(handler.tdoc, expired);
        const staleTask = {
            type: 'schedule',
            subType: 'contest',
            domainId: 'system',
            tid: 'contest',
            operation: ['unhide'],
            executeAfter: expired.endAt,
        };

        if (ordering === 'worker-first') await (contestModule as any).runContestScheduleTask(staleTask);
        await update(handler);
        if (ordering === 'edit-first') await (contestModule as any).runContestScheduleTask(staleTask);

        expect(calls.problemEdits.filter((args) => args[2]?.hidden === true).map((args) => args[1])).to.deep.equal([11, 22]);
        expect([problemDocs.get(11)?.hidden, problemDocs.get(22)?.hidden]).to.deep.equal([true, true]);
    }

    it('re-hides every selected problem when an expired autoHide contest is extended after its worker ran', () =>
        assertExpiredAutoHideReactivation('worker-first'));

    it('keeps every selected problem hidden when an expired autoHide contest is extended before its worker runs', () =>
        assertExpiredAutoHideReactivation('edit-first'));

    it('unhides removed problems and hides replacements before narrowing the tracked set', async () => {
        allowCanonicalProblemEdit = true;
        problemDocs.set(11, { domainId: 'system', docId: 11, owner: 42, allowed: true, hidden: true });
        problemDocs.set(22, { domainId: 'system', docId: 22, owner: 42, allowed: true, hidden: true });
        problemDocs.set(33, { domainId: 'system', docId: 33, owner: 42, allowed: true, hidden: false });
        const handler = makeHandler();
        handler.tdoc.autoHide = true;
        handler.tdoc.autoHideProblemPids = [11, 22];

        await update(handler, '22,33');

        expect(calls.problemEdits.map((args) => [args[1], args[2]])).to.deep.equal([
            [11, { hidden: false }],
            [33, { hidden: true }],
        ]);
        expect(currentContest.autoHideProblemPids).to.deep.equal([22, 33]);
        expect(currentContest.autoHidePendingPids).to.deep.equal([]);
    });

    it('rejects removing an auto-hidden problem the actor cannot publish before any write', async () => {
        problemDocs.set(11, { domainId: 'system', docId: 11, owner: 7, allowed: false, hidden: true });
        problemDocs.set(22, { domainId: 'system', docId: 22, owner: 42, allowed: true, hidden: true });
        const handler = makeHandler();
        handler.tdoc.autoHide = true;
        handler.tdoc.autoHideProblemPids = [11, 22];

        const error = await captureFailure(() => update(handler, '22'));

        expect(error?.name).to.equal('PermissionError');
        expect(calls.contestEdits).to.deep.equal([]);
        expect(calls.scheduleAdds).to.deep.equal([]);
        expect(calls.problemEdits).to.deep.equal([]);
    });

    it('rejects disabling autoHide without problem-edit permission before any write', async () => {
        const handler = makeHandler();
        handler.tdoc.autoHide = true;
        handler.tdoc.autoHideProblemPids = [11, 22];
        handler.user.hasPerm = () => false;

        const error = await captureFailure(() => update(handler, '11,22', '2099-01-01', false));

        expect(error?.name).to.equal('PermissionError');
        expect(calls.permissionChecks).to.deep.equal([PERM.PERM_EDIT_PROBLEM]);
        expect(calls.contestEdits).to.deep.equal([]);
        expect(calls.scheduleAdds).to.deep.equal([]);
        expect(calls.scheduleDeletes).to.deep.equal([]);
        expect(calls.problemEdits).to.deep.equal([]);
    });

    it('rejects extending an active autoHide schedule without problem-edit permission', async () => {
        const handler = makeHandler();
        handler.tdoc.autoHide = true;
        handler.tdoc.autoHideProblemPids = [11, 22];
        handler.user.hasPerm = () => false;

        const error = await captureFailure(() => update(handler, '11,22', '2099-01-02', true));

        expect(error?.name).to.equal('PermissionError');
        expect(calls.permissionChecks).to.deep.equal([PERM.PERM_EDIT_PROBLEM]);
        expect(calls.contestEdits).to.deep.equal([]);
        expect(calls.scheduleAdds).to.deep.equal([]);
        expect(calls.problemEdits).to.deep.equal([]);
    });

    it('loads namespace identity and allows its manager to extend the tracked hide schedule', async () => {
        problemDocs.set(11, {
            domainId: 'system',
            docId: 11,
            owner: 7,
            allowed: false,
            hidden: true,
            pidNamespaceId: 'course-os',
        });
        problemDocs.set(22, {
            domainId: 'system',
            docId: 22,
            owner: 7,
            allowed: false,
            hidden: true,
            pidNamespaceId: 'course-os',
        });
        const handler = makeHandler();
        handler.tdoc.autoHide = true;
        handler.tdoc.autoHideProblemPids = [11, 22];
        handler.user._pidNamespaceManagerIds.add('course-os');

        await update(handler, '11,22', '2099-01-02', true);

        expect(calls.getListProjections).to.have.length(1);
        expect(calls.getListProjections[0]).to.include('pidNamespaceId');
        expect(calls.publishes.map(({ pdoc }) => pdoc.docId)).to.deep.equal([11, 22]);
        expect(handler.response.redirect).to.equal('/contest/contest');
    });

    it('canonically clears expired pending hides before deleting the schedule and marker', async () => {
        allowCanonicalProblemEdit = true;
        problemDocs.set(11, { domainId: 'system', docId: 11, owner: 42, allowed: true, hidden: true });
        problemDocs.set(22, { domainId: 'system', docId: 22, owner: 42, allowed: true, hidden: true });
        const handler = makeHandler();
        handler.tdoc.autoHide = true;
        handler.tdoc.autoHidePendingPids = [11, 22];
        scheduleTasks.push({
            _id: 'expired-schedule',
            type: 'schedule',
            subType: 'contest',
            domainId: 'system',
            tid: 'contest',
            operation: ['unhide'],
        });

        await update(handler, '11,22', '2020-01-01');

        expect(calls.problemEdits.map((args) => [args[1], args[2]])).to.deep.equal([
            [11, { hidden: false }],
            [22, { hidden: false }],
        ]);
        expect([problemDocs.get(11)?.hidden, problemDocs.get(22)?.hidden]).to.deep.equal([false, false]);
        expect(calls.contestEdits[0][2].autoHidePendingPids).to.deep.equal([11, 22]);
        expect(calls.contestEdits.at(-1)?.[2].autoHidePendingPids).to.deep.equal([]);
        expect(scheduleTasks).to.deep.equal([]);
    });

    it('preserves the expired marker and schedule when canonical cleanup fails', async () => {
        problemDocs.set(11, { domainId: 'system', docId: 11, owner: 42, allowed: true, hidden: true });
        problemDocs.set(22, { domainId: 'system', docId: 22, owner: 42, allowed: true, hidden: true });
        const handler = makeHandler();
        handler.tdoc.autoHide = true;
        handler.tdoc.autoHidePendingPids = [11];
        scheduleTasks.push({
            _id: 'expired-schedule',
            type: 'schedule',
            subType: 'contest',
            domainId: 'system',
            tid: 'contest',
            operation: ['unhide'],
        });

        const error = await captureFailure(() => update(handler, '11,22', '2020-01-01'));

        expect(error).to.be.instanceOf(UnexpectedProblemWrite);
        expect(calls.contestEdits).to.have.length(1);
        expect(calls.contestEdits[0][2].autoHidePendingPids).to.deep.equal([11, 22]);
        expect(calls.scheduleDeletes).to.deep.equal([]);
        expect(scheduleTasks.map((task) => task._id)).to.deep.equal(['expired-schedule']);
        expect(currentContest.autoHidePendingPids).to.deep.equal([11, 22]);
    });

    async function assertCompletedAutoHideCleanup(transition: 'expired' | 'disabled') {
        allowCanonicalProblemEdit = true;
        problemDocs.set(11, { domainId: 'system', docId: 11, owner: 42, allowed: true, hidden: true });
        problemDocs.set(22, { domainId: 'system', docId: 22, owner: 42, allowed: true, hidden: true });
        const handler = makeHandler();
        handler.tdoc.autoHide = true;
        handler.tdoc.autoHidePendingPids = [];
        scheduleTasks.push({
            _id: `${transition}-schedule`,
            type: 'schedule',
            subType: 'contest',
            domainId: 'system',
            tid: 'contest',
            operation: ['unhide'],
        });

        await update(handler, '11,22', transition === 'expired' ? '2020-01-01' : '2099-01-01', transition !== 'disabled');

        expect(calls.problemEdits.map((args) => [args[1], args[2]])).to.deep.equal([
            [11, { hidden: false }],
            [22, { hidden: false }],
        ]);
        expect(calls.contestEdits[0][2].autoHidePendingPids).to.deep.equal([11, 22]);
        expect(calls.contestEdits.at(-1)?.[2].autoHidePendingPids).to.deep.equal([]);
        expect(scheduleTasks).to.deep.equal([]);
    }

    it('canonically unhides a completed autoHide batch before deleting its schedule when expired', () => assertCompletedAutoHideCleanup('expired'));

    it('canonically unhides a completed autoHide batch before deleting its schedule when disabled', () => assertCompletedAutoHideCleanup('disabled'));

    it('treats an explicit empty tracked set as completed when an unprivileged owner edits ordinary fields after expiry', async () => {
        const handler = makeHandler();
        Object.assign(handler.tdoc, {
            autoHide: true,
            autoHidePendingPids: [],
            autoHideProblemPids: [],
            beginAt: new Date('2020-01-01T00:00:00Z'),
            endAt: new Date('2020-01-01T02:00:00Z'),
        });
        handler.user.hasPerm = () => false;

        await update(handler, '11,22', '2020-01-01', true);

        expect(calls.permissionChecks).to.deep.equal([]);
        expect(calls.problemEdits).to.deep.equal([]);
        expect(currentContest.autoHideProblemPids).to.deep.equal([]);
        expect(handler.response.redirect).to.equal('/contest/contest');
    });

    it('publishes every tracked problem before deleting its contest and schedule', async () => {
        allowCanonicalProblemEdit = true;
        problemDocs.set(11, { domainId: 'system', docId: 11, owner: 42, allowed: true, hidden: true });
        problemDocs.set(22, { domainId: 'system', docId: 22, owner: 42, allowed: true, hidden: true });
        scheduleTasks.push({
            _id: 'contest-unhide',
            type: 'schedule',
            subType: 'contest',
            domainId: 'system',
            tid: 'contest',
            operation: ['unhide'],
        });
        const handler = makeHandler();
        handler.tdoc.autoHide = true;
        handler.tdoc.autoHideProblemPids = [11, 22];

        await handler.postDelete('forged-domain', 'contest');

        expect(calls.events).to.deep.equal(['publish:11', 'publish:22', 'problem.edit:11', 'problem.edit:22', 'contest.del']);
        expect([problemDocs.get(11)?.hidden, problemDocs.get(22)?.hidden]).to.deep.equal([false, false]);
        expect(calls.contestDeletes).to.deep.equal([['system', 'contest']]);
        expect(scheduleTasks).to.deep.equal([]);
        expect(handler.response.redirect).to.equal('/contest/contest');
    });

    it('does not rewrite grandfathered problems when autoHide is already enabled and the selection is unchanged', async () => {
        const handler = makeHandler();
        handler.tdoc.autoHide = true;
        problemDocs.set(11, { domainId: 'system', docId: 11, owner: 7, allowed: false });
        problemDocs.set(22, { domainId: 'system', docId: 22, owner: 8, allowed: false });

        await update(handler);

        expect(calls.getLists).to.deep.equal([]);
        expect(calls.problemEdits).to.deep.equal([]);
        expect(calls.contestEdits).to.have.length(2);
    });

    it('rejects a grandfathered unauthorized target before any contest or problem write', async () => {
        problemDocs.set(11, { domainId: 'system', docId: 11, owner: 42, allowed: true });
        problemDocs.set(22, { domainId: 'system', docId: 22, owner: 7, allowed: false });
        const error = await captureFailure(() => update(makeHandler()));
        expect(error?.name).to.equal('PermissionError');
        expect(calls.selections[0].existingPids).to.deep.equal([11, 22]);
        expect(calls.getLists).to.deep.equal([{ domainId: 'system', pids: [11, 22] }]);
        expect(calls.events).to.deep.equal(['publish:11', 'publish:22']);
        expect(calls.contestEdits).to.deep.equal([]);
        expect(calls.problemEdits).to.deep.equal([]);
    });

    it('gives missing and unauthorized autoHide targets the same error and zero writes', async () => {
        const run = async (second: any) => {
            for (const value of Object.values(calls)) value.length = 0;
            problemDocs.clear();
            problemDocs.set(11, { domainId: 'system', docId: 11, owner: 42, allowed: true });
            if (second) problemDocs.set(22, second);
            return captureFailure(() => update(makeHandler()));
        };
        const missing = await run(null);
        const unauthorized = await run({ domainId: 'system', docId: 22, owner: 7, allowed: false });
        expect(missing?.name).to.equal('PermissionError');
        expect(unauthorized?.name).to.equal('PermissionError');
        expect(calls.contestEdits).to.deep.equal([]);
        expect(calls.problemEdits).to.deep.equal([]);
    });

    it('rejects managed maintainer autoHide before the contest is persisted', async () => {
        problemDocs.set(11, {
            domainId: 'system',
            docId: 11,
            owner: 7,
            allowed: true,
            authoringMode: 'managed',
            publishAllowed: false,
        });
        problemDocs.set(22, { domainId: 'system', docId: 22, owner: 42, allowed: true });

        const error = await captureFailure(() => update(makeHandler()));

        expect(error?.name).to.equal('PermissionError');
        expect(calls.events).to.deep.equal(['publish:11', 'publish:22']);
        expect(calls.contestEdits).to.deep.equal([]);
        expect(calls.problemEdits).to.deep.equal([]);
    });

    it('routes a confirmed managed contest problem through the canonical auto-reveal service', async () => {
        problemDocs.set(11, {
            domainId: 'system',
            docId: 11,
            authoringMode: 'managed',
            managedAuthoring: { metadataStatus: 'confirmed' },
            hidden: true,
            structureLockedAt: new Date('2026-07-23T04:06:16.019Z'),
        });

        await contestModule.autoUnhideContestProblem('system', 'contest-1' as any, 11);

        expect(calls.managedAutoReveals).to.deep.equal([{ domainId: 'system', docId: 11, contestId: 'contest-1' }]);
        expect(calls.problemEdits).to.deep.equal([]);
    });
});

describe('permission error domain-join routing', () => {
    const permissionError = new RealPermissionError(1n);

    it('keeps an already joined administrator on the real error path', () => {
        const route = classifyPermissionErrorRoute({ _id: 2, _dudoc: { join: true }, hasPriv: () => true }, permissionError);
        expect(route).to.equal('error');
    });

    it('sends an ordinary unjoined user to the domain join flow', () => {
        const route = classifyPermissionErrorRoute({ _id: 7, _dudoc: { join: false }, hasPriv: () => false }, permissionError);
        expect(route).to.equal('domain_join');
    });

    it('keeps an unjoined all-domain manager on the real error path', () => {
        const checkedPrivileges: bigint[][] = [];
        const route = classifyPermissionErrorRoute(
            {
                _id: 2,
                _dudoc: { join: false },
                hasPriv: (...privileges: bigint[]) => {
                    checkedPrivileges.push(privileges);
                    return true;
                },
            },
            permissionError,
        );
        expect(route).to.equal('error');
        expect(checkedPrivileges).to.deep.equal([[RealPriv.PRIV_MANAGE_ALL_DOMAIN]]);
    });
});

describe('contest detail authoritative domain', () => {
    const tid = { toHexString: () => 'contest' } as any;

    it('keeps detail owner/problem reads in the handler domain when the method domain is forged', async () => {
        problemDocs.set(11, { domainId: 'system', docId: 11, owner: 42, allowed: true });
        const handler = makeDetailHandler((contestModule as any).ContestDetailHandler);

        await handler.__prepare('forged-domain', tid);
        await handler.get('forged-domain', tid);

        expect(calls.modelDomains.map((call) => call.model)).to.include.members([
            'contest.get',
            'contest.getStatus',
            'user.getList',
            'problem.getList',
        ]);
        expect(calls.modelDomains.filter((call) => call.domainId !== 'system')).to.deep.equal([]);
        expect(handler.response.body.tdoc).to.equal(currentContest);
    });

    it('keeps problem-list problem/user/clarification reads in the handler domain for exam-mode reuse', async () => {
        problemDocs.set(11, { domainId: 'system', docId: 11, owner: 42, allowed: true });
        const handler = makeDetailHandler((contestModule as any).ContestProblemListHandler);
        handler.liveStatsEnabled = false;

        await handler.__prepare('forged-domain', tid);
        await handler.get('forged-domain', tid);

        expect(calls.modelDomains.map((call) => call.model)).to.include.members(['problem.getList', 'user.getList', 'contest.getMultiClarification']);
        expect(calls.modelDomains.filter((call) => call.domainId !== 'system')).to.deep.equal([]);
        expect(handler.response.body.pdict).to.be.an('object');
    });

    it('contains no inherited contest handler model path that consumes a raw method domain', () => {
        const source = readFileSync(contestPath, 'utf8');
        const sections = [
            ['export class ContestDetailHandler', 'export class ContestPrintHandler'],
            ['export class ContestPrintHandler', 'interface ContestLiveStat'],
            ['export class ContestProblemListHandler', 'export class ContestEditHandler'],
            ['export class ContestManagementHandler', 'class ContestClarificationHandler'],
            ['class ContestClarificationHandler', 'export class ContestFileDownloadHandler'],
            ['export class ContestFileDownloadHandler', 'export class ContestUserHandler'],
            ['export class ContestUserHandler', 'export class ContestBalloonHandler'],
            ['export class ContestBalloonHandler', 'interface BuiltinInput'],
            ['export class ContestScoreboardHandler', 'class ScoreboardService'],
        ];
        for (const [start, end] of sections) {
            const body = source.slice(source.indexOf(start), source.indexOf(end));
            expect(body, start).not.to.match(/async\s+\w+\s*\(\s*(?:\{\s*)?domainId\b/);
            expect(body, start).not.to.match(/(?:contest|problem|user|discussion|record)\.\w+\(\s*_?domainId\b/);
        }
    });

    it('keeps exam-mode contest subclasses from forwarding a raw method domain', () => {
        const source = readFileSync(paperPath, 'utf8');
        const sections = [
            ['class ExamModeProblemListHandler', 'class ExamModeAnnouncementsHandler'],
            ['class ExamModeAnnouncementsHandler', 'class ExamModeProblemDetailHandler'],
            ['class ExamModeProblemDetailHandler', 'class ExamModeScoreboardHandler'],
            ['class ExamModeScoreboardHandler', 'class ExamModePrintHandler'],
            ['class ExamModePrintHandler', 'class ExamModeRecordDetailHandler'],
        ];
        for (const [start, end] of sections) {
            const body = source.slice(source.indexOf(start), source.indexOf(end));
            expect(body, start).not.to.match(/async\s+\w+\s*\(\s*(?:\{\s*)?domainId\b/);
            expect(body, start).not.to.match(/ensureExamModeAccess\(this,\s*_?domainId\b/);
        }
    });
});
