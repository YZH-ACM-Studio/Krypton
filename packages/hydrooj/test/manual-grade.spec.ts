import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
const modelPath = require.resolve('../src/model/manual-grade.ts');
const originalLoad = Module._load;

class ConflictError extends Error { }
class TestValidationError extends Error { }

const tid = new ObjectId();
const rid = new ObjectId();
let current: any;
let replacementLatest: any = null;
const oplogs: any[] = [];
const projections: any[] = [];
const contestUpdates: any[] = [];
const loggedErrors: any[][] = [];
const broadcasts: any[][] = [];
let problemProjectionResult = true;
let contestProjectionResult: any = {};
let findOneCalls = 0;
let findOneErrorAt = 0;
let problemStatusState: any;
let contestStatusState: any;
let afterManualGradeProblemProjection: null | (() => Promise<void>) = null;

function isLatest(candidate: ObjectId, state: any) {
    return !state?.rid || candidate.toHexString() >= state.rid.toHexString();
}

function matchesRevision(query: any) {
    if (query.manualGrade?.$exists === false) return current.manualGrade === undefined;
    if (query['manualGrade.revision'] !== undefined) {
        return current.manualGrade?.revision === query['manualGrade.revision'];
    }
    return true;
}

const recordStub = {
    coll: {
        async findOne() {
            findOneCalls++;
            if (findOneCalls === findOneErrorAt) throw new Error(`findOne failure ${findOneCalls}`);
            return replacementLatest || current;
        },
        async findOneAndUpdate(query: any, update: any) {
            if (!current._id.equals(query._id) || !matchesRevision(query)) return null;
            current = { ...current, ...update.$set };
            delete current.manualPending;
            return current;
        },
    },
};

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename !== modelPath) return originalLoad.call(this, request, parent, isMain);
    if (request === '@hydrooj/utils') {
        return { Logger: class { error(...args: any[]) { loggedErrors.push(args); } } };
    }
    if (request === '../error') {
        return { ManualGradeConflictError: ConflictError, ValidationError: TestValidationError };
    }
    if (request === '../service/bus') {
        return { broadcast: (...args: any[]) => broadcasts.push(args) };
    }
    if (request === './builtin') return { STATUS: { STATUS_WAITING: 0, STATUS_MANUAL_GRADED: 12 } };
    if (request === './contest') {
        return {
            get: async () => ({ docId: tid, rule: 'exam', pids: [7] }),
            updateStatus: async (...args: any[]) => {
                contestUpdates.push(args);
                if (!contestProjectionResult) return contestProjectionResult;
                const projectedRid = args[3] as ObjectId;
                const payload = args[5] || {};
                if (isLatest(projectedRid, contestStatusState)) {
                    contestStatusState = {
                        rid: projectedRid,
                        status: payload.status ?? 0,
                        score: payload.score ?? 0,
                    };
                }
                return contestProjectionResult;
            },
        };
    }
    if (request === './oplog') return { add: async (entry: any) => { oplogs.push(entry); } };
    if (request === './problem') {
        return {
            updateManualStatusLatest: async (...args: any[]) => {
                projections.push(args);
                if (!problemProjectionResult) return false;
                const projectedRid = args[3] as ObjectId;
                if (isLatest(projectedRid, problemStatusState)) {
                    problemStatusState = { rid: projectedRid, status: args[4], score: args[5] };
                }
                return true;
            },
            updateManualGradeStatus: async (...args: any[]) => {
                projections.push(args);
                if (!problemProjectionResult) return false;
                const projectedRid = args[3] as ObjectId;
                if (!problemStatusState?.rid.equals(projectedRid)) return false;
                problemStatusState = { rid: projectedRid, status: 12, score: args[4] };
                if (afterManualGradeProblemProjection) await afterManualGradeProblemProjection();
                return true;
            },
        };
    }
    if (request === './record') return recordStub;
    return originalLoad.call(this, request, parent, isMain);
};

let gradeLatestManualRecord: typeof import('../src/model/manual-grade').gradeLatestManualRecord;
let markManualPending: typeof import('../src/model/manual-grade').markManualPending;
try {
    delete require.cache[modelPath];
    ({ gradeLatestManualRecord, markManualPending } = require(modelPath));
} finally {
    Module._load = originalLoad;
}

function input(overrides: Record<string, unknown> = {}) {
    return {
        domainId: 'system', tid, pid: 7, uid: 42, latestRid: rid,
        expectedRevision: 0, score: 80, comment: 'Good', reason: '', actor: 1,
        ...overrides,
    } as any;
}

function queryFailureCase(stage: 'before-record-write' | 'after-record-write', call: number) {
    it(`logs full context when the latest Record query fails ${stage}`, async () => {
        findOneErrorAt = call;
        let error: unknown;
        try {
            await gradeLatestManualRecord(input());
        } catch (caught) { error = caught; }
        expect(error).to.be.instanceOf(Error);
        expect(loggedErrors).to.have.length(1);
        expect(String(loggedErrors[0][0])).to.include('Manual grade latest record query failed');
        expect(loggedErrors[0]).to.include(stage);
        expect(loggedErrors[0]).to.include('system');
        expect(loggedErrors[0]).to.include(tid);
        expect(loggedErrors[0]).to.include(7);
        expect(loggedErrors[0]).to.include(42);
        expect(loggedErrors[0]).to.include(rid);
    });
}

beforeEach(() => {
    current = {
        _id: rid, domainId: 'system', contest: tid, pid: 7, uid: 42,
        code: 'original answer\r\n', status: 0, score: 0,
        manualPending: true, judgeAt: new Date(),
    };
    replacementLatest = null;
    oplogs.length = 0;
    projections.length = 0;
    contestUpdates.length = 0;
    loggedErrors.length = 0;
    broadcasts.length = 0;
    problemProjectionResult = true;
    contestProjectionResult = {};
    findOneCalls = 0;
    findOneErrorAt = 0;
    problemStatusState = { rid, status: 0, score: 0 };
    contestStatusState = { rid, status: 0, score: 0 };
    afterManualGradeProblemProjection = null;
});

describe('single-problem manual grading', () => {
    it('projects manual pending to problem and container status through one service call', async () => {
        await markManualPending({ domainId: 'system', tid, pid: 7, uid: 42, rid });
        expect(projections).to.have.length(1);
        expect(contestUpdates).to.have.length(1);
    });

    it('grades the latest pending record with revision 1 and status 12', async () => {
        const updated = await gradeLatestManualRecord(input());
        expect(updated.manualPending).to.equal(undefined);
        expect(updated.manualGrade).to.include({ score: 80, maxScore: 100, revision: 1, gradedBy: 1 });
        expect(updated.status).to.equal(12);
        expect(oplogs[0]).to.include({ reason: 'initial-grade', oldRevision: 0, newRevision: 1 });
        expect(projections).to.have.length(1);
        expect(contestUpdates).to.have.length(1);
        expect(broadcasts).to.have.length(1);
        expect(broadcasts[0][0]).to.equal('record/change');
        expect(broadcasts[0][1]).to.equal(updated);
    });

    it('allows only one of two concurrent windows to consume the same revision', async () => {
        const results = await Promise.allSettled([
            gradeLatestManualRecord(input({ score: 70 })),
            gradeLatestManualRecord(input({ score: 90 })),
        ]);
        expect(results.filter((result) => result.status === 'fulfilled')).to.have.length(1);
        expect(results.filter((result) => result.status === 'rejected')).to.have.length(1);
        expect(current.manualGrade.revision).to.equal(1);
    });

    it('keeps a stale grade only on the old Record and never projects it after a resubmission', async () => {
        const newerRid = new ObjectId();
        replacementLatest = null;
        const originalUpdate = recordStub.coll.findOneAndUpdate;
        recordStub.coll.findOneAndUpdate = async (...args: any[]) => {
            const result = await originalUpdate(...args);
            replacementLatest = { ...current, _id: newerRid, manualGrade: undefined, manualPending: true };
            return result;
        };
        try {
            let error: unknown;
            try {
                await gradeLatestManualRecord(input());
            } catch (caught) {
                error = caught;
            }
            expect(error).to.be.instanceOf(ConflictError);
            expect(current.manualGrade.score).to.equal(80);
            expect(projections).to.deep.equal([]);
            expect(contestUpdates).to.deep.equal([]);
            expect(oplogs).to.have.length(1);
        } finally {
            recordStub.coll.findOneAndUpdate = originalUpdate;
        }
    });

    it('keeps a resubmission active when it lands during grade projection', async () => {
        const newerRid = new ObjectId();
        afterManualGradeProblemProjection = async () => {
            replacementLatest = {
                ...current,
                _id: newerRid,
                status: 0,
                score: 0,
                manualGrade: undefined,
                manualPending: true,
            };
            await markManualPending({ domainId: 'system', tid, pid: 7, uid: 42, rid: newerRid });
        };
        let error: unknown;
        try {
            await gradeLatestManualRecord(input());
        } catch (caught) { error = caught; }
        expect(error).to.be.instanceOf(ConflictError);
        expect(problemStatusState).to.deep.include({ rid: newerRid, status: 0, score: 0 });
        expect(contestStatusState).to.deep.include({ rid: newerRid, status: 0, score: 0 });
        expect(oplogs).to.have.length(1);
    });

    it('requires a reason for every revision after the initial grade', async () => {
        current.manualPending = undefined;
        current.manualGrade = { score: 60, maxScore: 100, revision: 1, gradedBy: 1, gradedAt: new Date() };
        let error: unknown;
        try {
            await gradeLatestManualRecord(input({ expectedRevision: 1, score: 70, reason: '' }));
        } catch (caught) { error = caught; }
        expect(error).to.be.instanceOf(TestValidationError);
        expect(oplogs).to.deep.equal([]);
    });

    it('throws and logs when a pending status projection is not applied', async () => {
        contestProjectionResult = null;
        let error: unknown;
        try {
            await markManualPending({ domainId: 'system', tid, pid: 7, uid: 42, rid });
        } catch (caught) { error = caught; }
        expect(error).to.be.instanceOf(Error);
        expect(loggedErrors).to.have.length(1);
        expect(String(loggedErrors[0][0])).to.include('Manual pending projection failed');
    });

    it('throws and logs when a graded status projection is not applied', async () => {
        problemProjectionResult = false;
        let error: unknown;
        try {
            await gradeLatestManualRecord(input());
        } catch (caught) { error = caught; }
        expect(error).to.be.instanceOf(ConflictError);
        expect(loggedErrors).to.have.length(1);
        expect(String(loggedErrors[0][0])).to.include('Manual grade projection failed');
    });

    queryFailureCase('before-record-write', 1);
    queryFailureCase('after-record-write', 2);
});
