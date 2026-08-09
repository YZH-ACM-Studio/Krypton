import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';

const Module = require('module');
(Math as any).sum ||= (...values: unknown[]) => values.flat(Infinity).reduce((sum: number, value) => sum + Number(value || 0), 0);
const judgePath = require.resolve('../src/handler/judge.ts');
const originalLoad = Module._load;

class ForbiddenError extends Error {}
class GenericError extends Error {}

const calls = {
    add: [] as any[],
    claims: [] as any[],
    gets: [] as any[],
    requeues: [] as any[],
    recordUpdates: [] as any[],
    resets: [] as any[],
    stats: [] as any[],
    users: [] as any[],
};
let claimAllowed = true;
let judgeObserverError: Error | null = null;
let judgeObserverGate: Promise<void> | null = null;
let broadcastError: Error | null = null;
let problemUpdateStatusError: Error | null = null;
let recordResetError: Error | null = null;
const recordResetErrorsByRid = new Map<string, Error>();
let recordResetGate: Promise<void> | null = null;
let recordUpdateError: Error | null = null;
let recordUpdateErrorStatus: number | null = null;
let recordUpdateGate: Promise<void> | null = null;
let taskAddError: Error | null = null;
let taskAddGate: Promise<void> | null = null;
let sleepGate: Promise<void> | null = null;
let judgeObserverCalls = 0;
let sleepCalls = 0;

const generateSentinel = {
    toString: () => '000000000000000000000001',
    equals(value: unknown) {
        return String(value) === this.toString();
    },
};
const pretestSentinel = { toString: () => '000000000000000000000002' };
const dataWriteConfirmation = {
    requestId: 'confirmation-1',
    domainId: 'system',
    pid: 7,
    actor: 42,
    operation: 'generate-testdata-request',
    containerFingerprint: 'container-fingerprint',
    issuedAt: 1_788_000_000_000,
};
let currentRecord: any = {
    domainId: 'system',
    pid: 7,
    uid: 42,
    contest: generateSentinel,
    dataWriteActiveContainerConfirmation: dataWriteConfirmation,
};

const pdoc = {
    domainId: 'system',
    docId: 7,
    owner: 1,
    reference: null,
    data: [],
    additional_file: [],
};
const actor = {
    _id: 42,
    own() {
        throw new Error('legacy udoc.own must not authorize callback writes');
    },
    hasPerm() {
        throw new Error('legacy wide permission check must not authorize callback writes');
    },
};

const problemStub = {
    async get(...args: any[]) {
        calls.gets.push(args);
        return pdoc;
    },
    async withAuthorizedWriteClaim(
        domainId: string,
        pid: number,
        user: any,
        operation: string,
        work: (claim: any) => Promise<any>,
        options: any = {},
    ) {
        calls.claims.push({ domainId, pid, user, operation, options });
        if (!claimAllowed) throw new ForbiddenError('revoke won');
        return work({ domainId, pid, actor: user._id, requestId: 'generate-callback' });
    },
    async withAuthorizedStructuralWriteClaim(domainId: string, pid: number, user: any, operation: string, work: (claim: any) => Promise<any>) {
        return problemStub.withAuthorizedWriteClaim(domainId, pid, user, operation, work);
    },
    async withAuthorizedDataWriteClaim(
        domainId: string,
        pid: number,
        user: any,
        operation: string,
        work: (claim: any) => Promise<any>,
        options: any = {},
    ) {
        return problemStub.withAuthorizedWriteClaim(domainId, pid, user, operation, work, options);
    },
    async addTestdataWithClaim(claim: any, ...args: any[]) {
        calls.add.push({ claim, args });
    },
    async updateStatus() {
        if (problemUpdateStatusError) throw problemUpdateStatusError;
        return false;
    },
    async getForJudge() {
        return pdoc;
    },
    async inc() {
        return pdoc;
    },
};

const recordStub = {
    RECORD_GENERATE: generateSentinel,
    RECORD_PRETEST: pretestSentinel,
    collHistory: {
        async updateOne() {
            return undefined;
        },
    },
    async get() {
        return currentRecord;
    },
    async update(domainId: string, rid: ObjectId, update: Record<string, unknown>) {
        calls.recordUpdates.push({ domainId, rid, update });
        if (recordUpdateGate && update.status === recordUpdateErrorStatus) await recordUpdateGate;
        if (recordUpdateError && update.status === recordUpdateErrorStatus) throw recordUpdateError;
        return {
            _id: rid,
            domainId,
            pid: 7,
            uid: 42,
            status: update.status ?? 1,
            score: 100,
            contest: undefined,
        };
    },
    async reset(...args: unknown[]) {
        calls.resets.push(args);
        if (recordResetGate) await recordResetGate;
        const perRidError = recordResetErrorsByRid.get(String(args[1]));
        if (perRidError) throw perRidError;
        if (recordResetError) throw recordResetError;
        return { _id: args[1], domainId: args[0] };
    },
};

function noopDecorator() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename !== judgePath) return originalLoad.call(this, request, parent, isMain);
    if (request === 'fs-extra') {
        return {
            async stat(filePath: string) {
                calls.stats.push(filePath);
                return { size: 1 };
            },
            createReadStream(filePath: string) {
                return { filePath };
            },
        };
    }
    if (request === '@hydrooj/common') return {};
    if (request === '@hydrooj/utils') {
        return {
            async sleep() {
                sleepCalls += 1;
                if (sleepGate) await sleepGate;
            },
        };
    }
    if (request === '../context') return { Context: class {} };
    if (request === '../error') {
        return new Proxy({ ForbiddenError }, { get: (target, key: string) => target[key] || GenericError });
    }
    if (request === '../interface') return {};
    if (request === '../lib/problem-config') {
        return { mergeSubjectiveScores: () => null, parseProblemConfigObject: () => ({}) };
    }
    if (request === '../logger') {
        return {
            Logger: class {
                info() {}
                warn() {}
            },
        };
    }
    if (request === '../model/builtin') {
        return {
            PERM: { PERM_EDIT_PROBLEM_SELF: 1n, PERM_EDIT_PROBLEM: 2n },
            STATUS: {
                STATUS_ACCEPTED: 1,
                STATUS_SYSTEM_ERROR: 8,
                STATUS_CANCELED: 9,
                STATUS_ETC: 10,
                STATUS_FETCHED: 22,
                STATUS_FORMAT_ERROR: 31,
                STATUS_HACK_SUCCESSFUL: 32,
                STATUS_HACK_UNSUCCESSFUL: 33,
            },
            STATUS_SHORT_TEXTS: { 1: 'AC' },
            PRIV: {},
        };
    }
    if (request === '../model/contest') return {};
    if (request === '../model/domain') return { incUserInDomain: async () => undefined };
    if (request === '../model/problem') return problemStub;
    if (request === '../model/record') return recordStub;
    if (request === '../model/setting') return { langs: {} };
    if (request === '../model/storage') return {};
    if (request === '../model/system') return { get: () => 100 };
    if (request === '../model/task') {
        const taskModel = {
            async add(...args: unknown[]) {
                calls.requeues.push(args);
                if (taskAddGate) await taskAddGate;
                if (taskAddError) throw taskAddError;
            },
        };
        return {
            ...taskModel,
            default: taskModel,
            Consumer: class {},
        };
    }
    if (request === '../model/user') {
        return {
            async getById(...args: any[]) {
                calls.users.push(args);
                return actor;
            },
        };
    }
    if (request === '../service/bus') {
        return {
            __esModule: true,
            default: {
                broadcast: () => {
                    if (broadcastError) throw broadcastError;
                },
            },
            async parallelAllSettled() {
                judgeObserverCalls += 1;
                if (judgeObserverGate) await judgeObserverGate;
                if (judgeObserverError) throw judgeObserverError;
            },
        };
    }
    if (request === '../service/monitor') return { updateJudge: () => undefined };
    if (request === '../service/server') {
        return {
            ConnectionHandler: class {},
            Handler: class {},
            post: noopDecorator,
            subscribe: noopDecorator,
            Types: new Proxy({}, { get: () => () => ({}) }),
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let judgeModule: typeof import('../src/handler/judge');
let processJudgeFileCallback: typeof import('../src/handler/judge').processJudgeFileCallback;
try {
    delete require.cache[judgePath];
    judgeModule = require(judgePath);
    ({ processJudgeFileCallback } = judgeModule);
} finally {
    Module._load = originalLoad;
}

beforeEach(() => {
    for (const entries of Object.values(calls)) entries.length = 0;
    claimAllowed = true;
    judgeObserverError = null;
    judgeObserverGate = null;
    broadcastError = null;
    problemUpdateStatusError = null;
    recordResetError = null;
    recordResetErrorsByRid.clear();
    recordResetGate = null;
    recordUpdateError = null;
    recordUpdateErrorStatus = null;
    recordUpdateGate = null;
    taskAddError = null;
    taskAddGate = null;
    sleepGate = null;
    judgeObserverCalls = 0;
    sleepCalls = 0;
    currentRecord = {
        domainId: 'system',
        pid: 7,
        uid: 42,
        contest: generateSentinel,
        dataWriteActiveContainerConfirmation: dataWriteConfirmation,
    };
});

async function captureFailure(run: () => Promise<unknown>): Promise<Error | null> {
    try {
        await run();
        return null;
    } catch (error) {
        return error as Error;
    }
}

describe('generated testdata judge callback authorization', () => {
    it('writes only inside an authoritative current-actor claim', async () => {
        await processJudgeFileCallback('rid' as any, 'generated.in', '/tmp/generated.in');
        expect(calls.claims).to.deep.equal([
            {
                domainId: 'system',
                pid: 7,
                user: actor,
                operation: 'generate-testdata-callback',
                options: {
                    activeContainerConfirmation: dataWriteConfirmation,
                    confirmationOperation: 'generate-testdata-request',
                },
            },
        ]);
        expect(calls.add).to.have.length(1);
        expect(calls.add[0].claim.requestId).to.equal('generate-callback');
        expect(calls.add[0].args[0]).to.equal('generated.in');
    });

    it('performs zero filesystem/storage/metadata work when revoke wins the claim race', async () => {
        claimAllowed = false;
        let error: unknown;
        try {
            await processJudgeFileCallback('rid' as any, 'generated.in', '/tmp/generated.in');
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(ForbiddenError);
        expect(calls.stats).to.deep.equal([]);
        expect(calls.add).to.deep.equal([]);
    });

    it('rejects missing, ordinary, pretest, and hack records before user/claim/filesystem/storage work', async () => {
        const invalidRecords = [
            null,
            { domainId: 'system', pid: 7, uid: 42 },
            { domainId: 'system', pid: 7, uid: 42, contest: pretestSentinel },
            { domainId: 'system', pid: 7, uid: 42, contest: { toString: () => '507f1f77bcf86cd799439011' } },
        ];
        for (const invalid of invalidRecords) {
            currentRecord = invalid;
            let error: unknown;
            try {
                await processJudgeFileCallback('rid' as any, 'generated.in', '/tmp/generated.in');
            } catch (caught) {
                error = caught;
            }
            expect(error).to.be.instanceOf(ForbiddenError);
        }
        expect(calls.users).to.deep.equal([]);
        expect(calls.claims).to.deep.equal([]);
        expect(calls.stats).to.deep.equal([]);
        expect(calls.add).to.deep.equal([]);
    });
});

describe('judge callback settlement', () => {
    it('lets an in-flight end win over disconnect cleanup without resetting the completed record', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.request = { ip: '127.0.0.1' };
        handler.send = () => undefined;
        let releaseObserver!: () => void;
        judgeObserverGate = new Promise<void>((resolve) => {
            releaseObserver = resolve;
        });

        const activeTask = handler.newTask({ domainId: 'system', rid, type: 'judge', meta: {} });
        await new Promise((resolve) => setImmediate(resolve));
        const context = handler.tasks[rid.toHexString()];
        const ending = context.end({ status: 1 });
        await new Promise((resolve) => setImmediate(resolve));
        const cleanup = handler.cleanup();
        await new Promise((resolve) => setImmediate(resolve));
        expect(calls.resets).to.deep.equal([]);
        expect(calls.requeues).to.deep.equal([]);

        releaseObserver();
        await Promise.all([ending, cleanup, activeTask]);
        expect(calls.resets).to.deep.equal([]);
        expect(calls.requeues).to.deep.equal([]);
        expect(handler.tasks[rid.toHexString()]).to.equal(undefined);
    });

    it('runs record finalization and observers only once for concurrent duplicate end messages', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.send = () => undefined;
        const activeTask = handler.newTask({ domainId: 'system', rid, type: 'judge', meta: {} });
        await new Promise((resolve) => setImmediate(resolve));
        const context = handler.tasks[rid.toHexString()];

        await Promise.all([context.end({ status: 1 }), context.end({ status: 1 })]);
        await activeTask;

        expect(calls.recordUpdates.filter((entry) => entry.update.status === 1)).to.have.length(1);
        expect(judgeObserverCalls).to.equal(1);
    });

    it('still runs completion observers when the terminal record broadcast fails', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.send = () => undefined;
        broadcastError = new Error('record broadcast failed');

        const activeTask = handler.newTask({ domainId: 'system', rid, type: 'judge', meta: {} });
        const activeFailure = captureFailure(() => activeTask);
        await new Promise((resolve) => setImmediate(resolve));
        const endFailure = captureFailure(() => handler.tasks[rid.toHexString()].end({ status: 1 }));

        expect(await endFailure).to.equal(broadcastError);
        expect(await activeFailure).to.equal(broadcastError);
        expect(judgeObserverCalls).to.equal(1);
        expect(calls.resets).to.have.length(0);
        expect(calls.requeues).to.have.length(0);
    });

    it('still runs completion observers when global ProblemStatus maintenance fails', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.send = () => undefined;
        problemUpdateStatusError = new Error('problem status write failed');

        const activeTask = handler.newTask({ domainId: 'system', rid, type: 'judge', meta: {} });
        const activeFailure = captureFailure(() => activeTask);
        await new Promise((resolve) => setImmediate(resolve));
        const endFailure = captureFailure(() => handler.tasks[rid.toHexString()].end({ status: 1 }));

        expect(await endFailure).to.equal(problemUpdateStatusError);
        expect(await activeFailure).to.equal(problemUpdateStatusError);
        expect(judgeObserverCalls).to.equal(1);
        expect(calls.resets).to.have.length(0);
        expect(calls.requeues).to.have.length(0);
    });

    it('reports every independent terminal side-effect failure after observers run', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.send = () => undefined;
        broadcastError = new Error('record broadcast failed');
        judgeObserverError = new Error('completion write failed');

        const activeTask = handler.newTask({ domainId: 'system', rid, type: 'judge', meta: {} });
        const activeFailure = captureFailure(() => activeTask);
        await new Promise((resolve) => setImmediate(resolve));
        const endFailure = await captureFailure(() => handler.tasks[rid.toHexString()].end({ status: 1 }));

        expect(endFailure).to.be.instanceOf(AggregateError);
        expect((endFailure as AggregateError).errors).to.deep.equal([broadcastError, judgeObserverError]);
        const taskFailure = await activeFailure;
        expect(taskFailure).to.be.instanceOf(AggregateError);
        expect((taskFailure as AggregateError).errors).to.deep.equal([broadcastError, judgeObserverError]);
        expect(judgeObserverCalls).to.equal(1);
    });

    it('resets and requeues only once when cleanup is invoked repeatedly', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.request = { ip: '127.0.0.1' };
        handler.send = () => undefined;
        const activeTask = handler.newTask({ domainId: 'system', rid, type: 'judge', meta: {} });
        await new Promise((resolve) => setImmediate(resolve));

        await Promise.all([handler.cleanup(), handler.cleanup()]);
        await activeTask;
        expect(calls.resets).to.have.length(1);
        expect(calls.requeues).to.have.length(1);
    });

    it('ignores late next and end messages after disconnect reset has claimed the terminal state', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.request = { ip: '127.0.0.1' };
        handler.send = () => undefined;
        let releaseReset!: () => void;
        recordResetGate = new Promise<void>((resolve) => {
            releaseReset = resolve;
        });
        const activeTask = handler.newTask({ domainId: 'system', rid, type: 'judge', meta: {} });
        await new Promise((resolve) => setImmediate(resolve));
        const context = handler.tasks[rid.toHexString()];
        const updateCountBeforeReset = calls.recordUpdates.length;
        const cleanup = handler.cleanup();
        const lateNext = context.next({ status: 2 });
        const lateEnd = context.end({ status: 1 });

        releaseReset();
        await Promise.all([cleanup, lateNext, lateEnd, activeTask]);
        expect(calls.recordUpdates).to.have.length(updateCountBeforeReset);
        expect(judgeObserverCalls).to.equal(0);
        expect(calls.resets).to.have.length(1);
        expect(calls.requeues).to.have.length(1);
    });

    it('settles and clears an active task after disconnect reset and requeue succeed', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.request = { ip: '127.0.0.1' };
        handler.send = () => undefined;

        const activeTask = handler.newTask({ domainId: 'system', rid, type: 'judge', meta: {} });
        await new Promise((resolve) => setImmediate(resolve));
        await handler.cleanup();
        await activeTask;

        expect(calls.resets).to.have.length(1);
        expect(calls.requeues).to.have.length(1);
        expect(handler.tasks[rid.toHexString()]).to.equal(undefined);
    });

    it('rejects both cleanup and the active task when disconnect reset or requeue fails', async () => {
        for (const stage of ['reset', 'requeue'] as const) {
            const rid = new ObjectId();
            const handler = new (judgeModule.JudgeConnectionHandler as any)();
            handler.ctx = { broadcast: () => undefined };
            handler.request = { ip: '127.0.0.1' };
            handler.send = () => undefined;
            const failure = new Error(`${stage} failed`);
            recordResetError = stage === 'reset' ? failure : null;
            taskAddError = stage === 'requeue' ? failure : null;

            const activeTask = handler.newTask({ domainId: 'system', rid, type: 'judge', meta: {} });
            await new Promise((resolve) => setImmediate(resolve));
            expect(await captureFailure(() => handler.cleanup())).to.equal(failure);
            expect(await captureFailure(() => activeTask)).to.equal(failure);
            expect(handler.tasks[rid.toHexString()]).to.equal(undefined);
        }
    });

    it('reports every independent active-task failure during disconnect cleanup', async () => {
        const firstRid = new ObjectId();
        const secondRid = new ObjectId();
        const firstFailure = new Error('first reset failed');
        const secondFailure = new Error('second reset failed');
        recordResetErrorsByRid.set(firstRid.toHexString(), firstFailure);
        recordResetErrorsByRid.set(secondRid.toHexString(), secondFailure);
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.request = { ip: '127.0.0.1' };
        handler.send = () => undefined;

        const firstTask = handler.newTask({ domainId: 'system', rid: firstRid, type: 'judge', meta: {} });
        const secondTask = handler.newTask({ domainId: 'system', rid: secondRid, type: 'judge', meta: {} });
        const firstTaskFailure = captureFailure(() => firstTask);
        const secondTaskFailure = captureFailure(() => secondTask);
        await new Promise((resolve) => setImmediate(resolve));
        const cleanupFailure = await captureFailure(() => handler.cleanup());

        expect(cleanupFailure).to.be.instanceOf(AggregateError);
        expect((cleanupFailure as AggregateError).errors).to.deep.equal([firstFailure, secondFailure]);
        expect(await firstTaskFailure).to.equal(firstFailure);
        expect(await secondTaskFailure).to.equal(secondFailure);
        expect(calls.resets).to.have.length(2);
        expect(calls.requeues).to.have.length(0);
    });

    it('resets and requeues exactly once when sending the claimed task fails', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        const sendError = new Error('socket write failed');
        handler.send = () => {
            throw sendError;
        };

        expect(await captureFailure(() => handler.newTask({ domainId: 'system', rid, type: 'judge', meta: {} }))).to.equal(sendError);
        expect(handler.tasks[rid.toHexString()]).to.equal(undefined);
        expect(calls.resets).to.have.length(1);
        expect(calls.requeues).to.have.length(1);
        expect(judgeObserverCalls).to.equal(0);
    });

    it('surfaces both the dispatch and recovery failure without retrying the requeue', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        const sendError = new Error('socket write failed');
        const requeueError = new Error('requeue failed');
        handler.send = () => {
            throw sendError;
        };
        taskAddError = requeueError;

        const failure = await captureFailure(() => handler.newTask({ domainId: 'system', rid, type: 'judge', meta: {} }));
        expect(failure).to.be.instanceOf(AggregateError);
        expect((failure as AggregateError).errors).to.deep.equal([sendError, requeueError]);
        expect(calls.resets).to.have.length(1);
        expect(calls.requeues).to.have.length(1);
        expect(handler.tasks[rid.toHexString()]).to.equal(undefined);
    });

    it('shares one requeue when synchronous dispatch failure races disconnect cleanup', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.request = { ip: '127.0.0.1' };
        const sendError = new Error('socket write failed');
        handler.send = () => {
            throw sendError;
        };
        let releaseReset!: () => void;
        recordResetGate = new Promise<void>((resolve) => {
            releaseReset = resolve;
        });

        const activeTask = handler.newTask({ domainId: 'system', rid, type: 'judge', meta: {} });
        const activeFailure = captureFailure(() => activeTask);
        const cleanupFailure = captureFailure(() => handler.cleanup());
        await new Promise((resolve) => setImmediate(resolve));
        expect(calls.resets).to.have.length(1);

        releaseReset();
        expect(await activeFailure).to.equal(sendError);
        expect(await cleanupFailure).to.equal(sendError);
        expect(calls.resets).to.have.length(1);
        expect(calls.requeues).to.have.length(1);
        expect(handler.tasks[rid.toHexString()]).to.equal(undefined);
    });

    it('resets and requeues exactly once when the initial FETCHED update fails', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.send = () => undefined;
        recordUpdateError = new Error('fetched update failed');
        recordUpdateErrorStatus = 22;

        expect(await captureFailure(() => handler.newTask({ domainId: 'system', rid, type: 'judge', meta: {} }))).to.equal(recordUpdateError);
        expect(handler.tasks[rid.toHexString()]).to.equal(undefined);
        expect(calls.resets).to.have.length(1);
        expect(calls.requeues).to.have.length(1);
        expect(judgeObserverCalls).to.equal(0);
    });

    it('shares one requeue when a pending FETCHED failure races disconnect cleanup', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.request = { ip: '127.0.0.1' };
        handler.send = () => undefined;
        const fetchedError = new Error('fetched update failed');
        recordUpdateError = fetchedError;
        recordUpdateErrorStatus = 22;
        let releaseFetched!: () => void;
        recordUpdateGate = new Promise<void>((resolve) => {
            releaseFetched = resolve;
        });

        const activeTask = handler.newTask({ domainId: 'system', rid, type: 'judge', meta: {} });
        const activeFailure = captureFailure(() => activeTask);
        await new Promise((resolve) => setImmediate(resolve));
        const cleanupFailure = captureFailure(() => handler.cleanup());
        releaseFetched();

        expect(await activeFailure).to.equal(fetchedError);
        expect(await cleanupFailure).to.equal(fetchedError);
        expect(calls.resets).to.have.length(1);
        expect(calls.requeues).to.have.length(1);
        expect(handler.tasks[rid.toHexString()]).to.equal(undefined);
    });

    it('resets and requeues after a terminal Record write fails before commit', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.send = () => undefined;
        const activeTask = handler.newTask({ domainId: 'system', rid, type: 'judge', meta: {} });
        const activeFailure = captureFailure(() => activeTask);
        await new Promise((resolve) => setImmediate(resolve));
        recordUpdateError = new Error('terminal update failed');
        recordUpdateErrorStatus = 1;
        const endFailure = captureFailure(() => handler.tasks[rid.toHexString()].end({ status: 1 }));

        expect(await endFailure).to.equal(recordUpdateError);
        expect(await activeFailure).to.equal(recordUpdateError);
        expect(calls.resets).to.have.length(1);
        expect(calls.requeues).to.have.length(1);
        expect(judgeObserverCalls).to.equal(0);
        expect(handler.tasks[rid.toHexString()]).to.equal(undefined);
    });

    it('times out the active duplicate RID context exactly once and ignores its late callbacks', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.send = () => undefined;
        let releaseObserver!: () => void;
        judgeObserverGate = new Promise<void>((resolve) => {
            releaseObserver = resolve;
        });
        const taskDoc = { domainId: 'system', rid, type: 'judge', meta: {} };
        const activeTask = handler.newTask(taskDoc);
        await new Promise((resolve) => setImmediate(resolve));
        const activeContext = handler.tasks[rid.toHexString()];

        let settled = false;
        const timedOutTask = handler.newTask(taskDoc).then(() => {
            settled = true;
        });
        await new Promise((resolve) => setImmediate(resolve));
        expect(settled).to.equal(false);

        releaseObserver();
        await Promise.all([activeTask, timedOutTask]);
        expect(settled).to.equal(true);
        expect(calls.recordUpdates.filter((entry) => entry.update.status === 8)).to.have.length(1);
        expect(judgeObserverCalls).to.equal(1);

        const updateCount = calls.recordUpdates.length;
        await Promise.all([activeContext.next({ status: 1 }), activeContext.end({ status: 1 })]);
        expect(calls.recordUpdates).to.have.length(updateCount);
        expect(judgeObserverCalls).to.equal(1);
        expect(handler.tasks[rid.toHexString()]).to.equal(undefined);
    });

    it('surfaces the same duplicate RID timeout observer failure to both waiting tasks', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.send = () => undefined;
        judgeObserverError = new Error('timeout completion write failed');
        const taskDoc = { domainId: 'system', rid, type: 'judge', meta: {} };
        const activeTask = handler.newTask(taskDoc);
        const activeFailure = captureFailure(() => activeTask);
        await new Promise((resolve) => setImmediate(resolve));
        const duplicateFailure = captureFailure(() => handler.newTask(taskDoc));

        expect(await activeFailure).to.equal(judgeObserverError);
        expect(await duplicateFailure).to.equal(judgeObserverError);
        expect(calls.recordUpdates.filter((entry) => entry.update.status === 8)).to.have.length(1);
        expect(judgeObserverCalls).to.equal(1);
        expect(handler.tasks[rid.toHexString()]).to.equal(undefined);
    });

    it('reuses an active terminal result when a duplicate RID times out during finalization', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.send = () => undefined;
        let releaseObserver!: () => void;
        judgeObserverGate = new Promise<void>((resolve) => {
            releaseObserver = resolve;
        });
        const taskDoc = { domainId: 'system', rid, type: 'judge', meta: {} };
        const activeTask = handler.newTask(taskDoc);
        await new Promise((resolve) => setImmediate(resolve));
        const ending = handler.tasks[rid.toHexString()].end({ status: 1 });
        const duplicateTask = handler.newTask(taskDoc);
        await new Promise((resolve) => setImmediate(resolve));

        releaseObserver();
        await Promise.all([ending, activeTask, duplicateTask]);
        expect(calls.recordUpdates.filter((entry) => entry.update.status === 1)).to.have.length(1);
        expect(calls.recordUpdates.filter((entry) => entry.update.status === 8)).to.have.length(0);
        expect(judgeObserverCalls).to.equal(1);
    });

    it('reuses an active reset when a duplicate RID times out during requeue', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.send = () => undefined;
        let releaseReset!: () => void;
        recordResetGate = new Promise<void>((resolve) => {
            releaseReset = resolve;
        });
        const taskDoc = { domainId: 'system', rid, type: 'judge', meta: {} };
        const activeTask = handler.newTask(taskDoc);
        await new Promise((resolve) => setImmediate(resolve));
        const resetting = handler.tasks[rid.toHexString()].reset();
        const duplicateTask = handler.newTask(taskDoc);
        await new Promise((resolve) => setImmediate(resolve));

        releaseReset();
        await Promise.all([resetting, activeTask, duplicateTask]);
        expect(calls.resets).to.have.length(1);
        expect(calls.requeues).to.have.length(1);
        expect(calls.recordUpdates.filter((entry) => entry.update.status === 8)).to.have.length(0);
        expect(judgeObserverCalls).to.equal(0);
    });

    it('requeues a duplicate RID waiter instead of activating it after disconnect', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.request = { ip: '127.0.0.1' };
        const sent: unknown[] = [];
        handler.send = (message: unknown) => sent.push(message);
        let releaseSleep!: () => void;
        sleepGate = new Promise<void>((resolve) => {
            releaseSleep = resolve;
        });
        const taskDoc = { domainId: 'system', rid, type: 'judge', meta: {} };
        const activeTask = handler.newTask(taskDoc);
        await new Promise((resolve) => setImmediate(resolve));
        const duplicateTask = handler.newTask(taskDoc);
        await new Promise((resolve) => setImmediate(resolve));
        expect(sleepCalls).to.equal(1);

        const cleanup = handler.cleanup();
        await new Promise((resolve) => setImmediate(resolve));
        let cleanupSettled = false;
        cleanup.then(() => {
            cleanupSettled = true;
        });
        expect(cleanupSettled).to.equal(false);
        releaseSleep();
        await Promise.all([cleanup, activeTask, duplicateTask]);

        expect(sent).to.have.length(1);
        expect(calls.recordUpdates.filter((entry) => entry.update.status === 22)).to.have.length(1);
        expect(calls.resets).to.have.length(1);
        expect(calls.requeues).to.have.length(2);
        expect(handler.tasks[rid.toHexString()]).to.equal(undefined);
    });

    it('surfaces a duplicate RID waiter requeue failure through cleanup and newTask', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.request = { ip: '127.0.0.1' };
        handler.send = () => undefined;
        let releaseSleep!: () => void;
        sleepGate = new Promise<void>((resolve) => {
            releaseSleep = resolve;
        });
        const taskDoc = { domainId: 'system', rid, type: 'judge', meta: {} };
        const activeTask = handler.newTask(taskDoc);
        await new Promise((resolve) => setImmediate(resolve));
        const duplicateTask = handler.newTask(taskDoc);
        const duplicateFailure = captureFailure(() => duplicateTask);
        await new Promise((resolve) => setImmediate(resolve));
        const cleanupFailure = captureFailure(() => handler.cleanup());
        await new Promise((resolve) => setImmediate(resolve));

        const requeueFailure = new Error('waiting task requeue failed');
        taskAddError = requeueFailure;
        releaseSleep();
        expect(await duplicateFailure).to.equal(requeueFailure);
        expect(await cleanupFailure).to.equal(requeueFailure);
        await activeTask;
        expect(handler.tasks[rid.toHexString()]).to.equal(undefined);
    });

    it('waits for a task fetched during Consumer shutdown to enter and finish requeueing', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.request = { ip: '127.0.0.1' };
        handler.send = () => {
            throw new Error('a closing connection must not send a fetched task');
        };
        let releaseAdd!: () => void;
        taskAddGate = new Promise<void>((resolve) => {
            releaseAdd = resolve;
        });
        let resolveConsumerStop!: () => void;
        let rejectConsumerStop!: (error: unknown) => void;
        const consumerStop = new Promise<void>((resolve, reject) => {
            resolveConsumerStop = resolve;
            rejectConsumerStop = reject;
        });
        handler.consumer = { destroy: () => consumerStop };

        let cleanupSettled = false;
        const cleanup = handler.cleanup().then(() => {
            cleanupSettled = true;
        });
        const fetchedDuringShutdown = handler.newTask({ domainId: 'system', rid, type: 'judge', meta: {} });
        fetchedDuringShutdown.then(resolveConsumerStop, rejectConsumerStop);
        await new Promise((resolve) => setImmediate(resolve));
        expect(cleanupSettled).to.equal(false);
        expect(calls.requeues).to.have.length(1);

        releaseAdd();
        await Promise.all([cleanup, fetchedDuringShutdown]);
        expect(cleanupSettled).to.equal(true);
        expect(calls.recordUpdates).to.have.length(0);
        expect(handler.tasks[rid.toHexString()]).to.equal(undefined);
    });

    it('propagates a task requeue failure fetched during Consumer shutdown through cleanup', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.request = { ip: '127.0.0.1' };
        handler.send = () => undefined;
        let resolveConsumerStop!: () => void;
        let rejectConsumerStop!: (error: unknown) => void;
        const consumerStop = new Promise<void>((resolve, reject) => {
            resolveConsumerStop = resolve;
            rejectConsumerStop = reject;
        });
        handler.consumer = { destroy: () => consumerStop };
        const cleanupFailure = captureFailure(() => handler.cleanup());
        const requeueFailure = new Error('late fetched task requeue failed');
        taskAddError = requeueFailure;
        const fetchedDuringShutdown = handler.newTask({ domainId: 'system', rid, type: 'judge', meta: {} });
        const taskFailure = captureFailure(() => fetchedDuringShutdown);
        fetchedDuringShutdown.then(resolveConsumerStop, rejectConsumerStop);

        expect(await taskFailure).to.equal(requeueFailure);
        expect(await cleanupFailure).to.equal(requeueFailure);
        expect(calls.requeues).to.have.length(1);
        expect(handler.tasks[rid.toHexString()]).to.equal(undefined);
    });

    it('rejects an observer failure and clears the active task before accepting another callback', async () => {
        const rid = new ObjectId();
        const handler = new (judgeModule.JudgeConnectionHandler as any)();
        handler.ctx = { broadcast: () => undefined };
        handler.send = () => undefined;
        judgeObserverError = new Error('completion write failed');

        const firstTask = handler.newTask({ domainId: 'system', rid, type: 'judge', meta: {} });
        await new Promise((resolve) => setImmediate(resolve));
        const firstEnd = handler.tasks[rid.toHexString()].end({ status: 1 });
        expect(await captureFailure(() => firstEnd)).to.equal(judgeObserverError);
        expect(await captureFailure(() => firstTask)).to.equal(judgeObserverError);
        expect(handler.tasks[rid.toHexString()]).to.equal(undefined);
        expect(calls.resets).to.have.length(0);
        expect(calls.requeues).to.have.length(0);

        judgeObserverError = null;
        const secondTask = handler.newTask({ domainId: 'system', rid, type: 'judge', meta: {} });
        await new Promise((resolve) => setImmediate(resolve));
        await handler.tasks[rid.toHexString()].end({ status: 1 });
        await secondTask;
        expect(handler.tasks[rid.toHexString()]).to.equal(undefined);
    });
});
