import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';
import { createDraftConfig } from '@hydrooj/common';
import { answersWithManualGrades } from '../src/lib/set-judged-attempts';
import { withSetParticipantBoundary } from '../src/lib/set-participant-boundary';
import { withContestTeamBoundary } from '../src/model/contest-team-gate';

const Module = require('module');
const modelPath = require.resolve('../src/model/manual-grade.ts');
const originalLoad = Module._load;

class ConflictError extends Error {}
class TestValidationError extends Error {}

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
let setConfig: ReturnType<typeof createDraftConfig> | undefined;
let officialAnswer: { pid: number; version: number; rid: string; rawScore: number } | null = null;
let officialRound: { _id: ObjectId; roundNo: number; legacy?: { scoreLocked: boolean } } | null = null;
let answerProjectionFailure = false;
const answerProjections: unknown[][] = [];
let dirtyFailure = false;
const dirtyMarks: unknown[][] = [];
let afterRoundRead: (() => Promise<void>) | null = null;
let lockContestProjection = false;

const roundModelPath = require.resolve('../src/model/set-round.ts');
require.cache[roundModelPath] = { exports: {
    participantKey: (uid: number) => `u:${uid}`,
    readParticipantRound: async (_domainId: string, _tid: ObjectId, uid: number, _teamId: ObjectId | undefined, roundId: ObjectId) => {
        if (afterRoundRead) await afterRoundRead();
        return uid === current.uid && officialRound?._id.equals(roundId) ? officialRound : null;
    },
    getOfficialAnswers: async () => officialAnswer ? [officialAnswer] : [],
    markRoundScoreDirty: async (...args: unknown[]) => {
        dirtyMarks.push(args);
        if (dirtyFailure) throw new Error('round dirty marker unavailable');
    },
    applyManualAnswerGrade: async (...args: unknown[]) => {
        answerProjections.push(args);
        if (answerProjectionFailure) throw new Error('answer projection unavailable');
        if (!officialAnswer || officialAnswer.rid !== String(args[4]) || officialAnswer.version !== args[5]) return false;
        officialAnswer.rawScore = Number(args[6]);
        return true;
    },
} } as NodeModule;

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
        async findOne(query: any) {
            findOneCalls++;
            if (findOneCalls === findOneErrorAt) throw new Error(`findOne failure ${findOneCalls}`);
            if (query._id) {
                return current._id.equals(query._id) && current.domainId === query.domainId
                    && current.contest.equals(query.contest) && current.pid === query.pid && current.uid === query.uid ? current : null;
            }
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
        return {
            Logger: class {
                error(...args: any[]) {
                    loggedErrors.push(args);
                }
            },
        };
    }
    if (request === '../error') {
        return { ManualGradeConflictError: ConflictError, ValidationError: TestValidationError, localizedErrorText: (strings: TemplateStringsArray) => strings.join('') };
    }
    if (request === '../service/bus') {
        return { broadcast: (...args: any[]) => broadcasts.push(args) };
    }
    if (request === './builtin') return { STATUS: { STATUS_WAITING: 0, STATUS_MANUAL_GRADED: 12 } };
    if (request === './contest') {
        return {
            get: async () => ({ docId: tid, rule: setConfig ? 'contest' : 'exam', pids: [7], ...(setConfig ? { setConfig } : {}) }),
            updateStatus: async (...args: any[]) => {
                if (lockContestProjection) {
                    return withContestTeamBoundary(args[0], args[1], () =>
                        withSetParticipantBoundary(args[0], args[1], `u:${args[2]}`, async () => {
                            contestUpdates.push(args);
                            return contestProjectionResult;
                        }));
                }
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
    if (request === './oplog') {
        return {
            add: async (entry: any) => {
                oplogs.push(entry);
            },
        };
    }
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
        domainId: 'system',
        tid,
        pid: 7,
        uid: 42,
        latestRid: rid,
        expectedRevision: 0,
        score: 80,
        comment: 'Good',
        reason: '',
        actor: 1,
        ...overrides,
    } as any;
}

function queryFailureCase(stage: 'before-record-write' | 'after-record-write', call: number) {
    it(`logs full context when the latest Record query fails ${stage}`, async () => {
        findOneErrorAt = call;
        let error: unknown;
        try {
            await gradeLatestManualRecord(input());
        } catch (caught) {
            error = caught;
        }
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
        _id: rid,
        domainId: 'system',
        contest: tid,
        pid: 7,
        uid: 42,
        code: 'original answer\r\n',
        status: 0,
        score: 0,
        manualPending: true,
        judgeAt: new Date(),
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
    setConfig = undefined;
    officialAnswer = null;
    officialRound = null;
    answerProjectionFailure = false;
    answerProjections.length = 0;
    dirtyFailure = false;
    dirtyMarks.length = 0;
    afterRoundRead = null;
    lockContestProjection = false;
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
        const results = await Promise.allSettled([gradeLatestManualRecord(input({ score: 70 })), gradeLatestManualRecord(input({ score: 90 }))]);
        expect(results.filter((result) => result.status === 'fulfilled')).to.have.length(1);
        expect(results.filter((result) => result.status === 'rejected')).to.have.length(1);
        expect(current.manualGrade.revision).to.equal(1);
    });

    it('keeps a stale grade only on the old Record and never projects it after a resubmission', async () => {
        const newerRid = new ObjectId();
        replacementLatest = null;
        const originalUpdate = recordStub.coll.findOneAndUpdate;
        recordStub.coll.findOneAndUpdate = async (...args: Parameters<typeof originalUpdate>) => {
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
        } catch (caught) {
            error = caught;
        }
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
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(TestValidationError);
        expect(oplogs).to.deep.equal([]);
    });

    it('throws and logs when a pending status projection is not applied', async () => {
        contestProjectionResult = null;
        let error: unknown;
        try {
            await markManualPending({ domainId: 'system', tid, pid: 7, uid: 42, rid });
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(Error);
        expect(loggedErrors).to.have.length(1);
        expect(String(loggedErrors[0][0])).to.include('Manual pending projection failed');
    });

    it('throws and logs when a graded status projection is not applied', async () => {
        problemProjectionResult = false;
        let error: unknown;
        try {
            await gradeLatestManualRecord(input());
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(ConflictError);
        expect(loggedErrors).to.have.length(1);
        expect(String(loggedErrors[0][0])).to.include('Manual grade projection failed');
    });

    queryFailureCase('before-record-write', 1);
    queryFailureCase('after-record-write', 2);
});

function configureOfficialAnswer() {
    setConfig = { ...createDraftConfig('contest'), publication: 'published' };
    officialRound = { _id: new ObjectId(), roundNo: 1 };
    current.setRoundId = officialRound._id;
    current.setAnswerVersion = 2;
    officialAnswer = { pid: 7, version: 2, rid: rid.toHexString(), rawScore: 0 };
}

describe('formal round manual grading', () => {
    it('grades an earlier round even when a later round owns the latest problem Record', async () => {
        configureOfficialAnswer();
        replacementLatest = { ...current, _id: new ObjectId(), setRoundId: new ObjectId(), setAnswerVersion: 1 };
        problemProjectionResult = false;
        const graded = await gradeLatestManualRecord(input());
        expect(graded.manualGrade?.score).to.equal(80);
        expect(officialAnswer?.rawScore).to.equal(80);
        expect(answerProjections[0][2]).to.equal(officialRound?._id);
        expect(dirtyMarks[0]).to.deep.equal(['system', tid, officialRound?._id]);
        expect(contestUpdates).to.have.length(1);
        expect(oplogs[0]).to.include({ setRoundId: officialRound?._id, setAnswerVersion: 2 });
    });

    it('rejects a stale answer version in the same round before writing a grade', async () => {
        configureOfficialAnswer();
        officialAnswer!.version = 3;
        await expectReject(gradeLatestManualRecord(input()), ConflictError);
        expect(current.manualGrade).to.equal(undefined);
        expect(answerProjections).to.have.length(0);
        expect(oplogs).to.have.length(0);
    });

    it('does not grade a Record from another user or contest', async () => {
        configureOfficialAnswer();
        await expectReject(gradeLatestManualRecord(input({ uid: 43 })), ConflictError);
        expect(current.manualGrade).to.equal(undefined);
    });

    it('retries a partially projected grade without increasing its revision', async () => {
        configureOfficialAnswer();
        answerProjectionFailure = true;
        await expectReject(gradeLatestManualRecord(input()), Error);
        expect(current.manualGrade.revision).to.equal(1);
        expect(officialAnswer?.rawScore).to.equal(0);
        answerProjectionFailure = false;
        const recovered = await gradeLatestManualRecord(input());
        expect(recovered.manualGrade?.revision).to.equal(1);
        expect(officialAnswer?.rawScore).to.equal(80);
        expect(oplogs.at(-1).type).to.equal('problem.manual-grade-replay');
        expect(contestUpdates).to.have.length(1);
    });

    it('keeps conflicting scores from consuming an already used grading revision', async () => {
        configureOfficialAnswer();
        await gradeLatestManualRecord(input());
        await expectReject(gradeLatestManualRecord(input({ score: 90 })), ConflictError);
        expect(officialAnswer?.rawScore).to.equal(80);
        expect(current.manualGrade.revision).to.equal(1);
    });

    it('does not write the Record when its recovery marker cannot be persisted', async () => {
        configureOfficialAnswer();
        dirtyFailure = true;
        await expectReject(gradeLatestManualRecord(input()), Error);
        expect(current.manualGrade).to.equal(undefined);
        expect(answerProjections).to.have.length(0);
    });

    it('rejects edits to an incomplete migrated round before changing its Record or answer', async () => {
        configureOfficialAnswer();
        officialRound!.legacy = { scoreLocked: true };
        await expectReject(gradeLatestManualRecord(input()), TestValidationError);
        expect(current.manualGrade).to.equal(undefined);
        expect(answerProjections).to.have.length(0);
        expect(dirtyMarks).to.have.length(0);
    });

    it('sets completion time when grading a pending formal Record so canonical score recovery accepts it', async () => {
        configureOfficialAnswer();
        current.judgeAt = null;
        const updated = await gradeLatestManualRecord(input());
        expect(updated.judgeAt).to.be.instanceOf(Date);
        expect(updated.judgeAt).to.equal(updated.manualGrade?.gradedAt);
        const projected = answersWithManualGrades([{
            ...officialAnswer!, operationId: 'saved-0001', acceptedAt: new Date('2026-11-10T00:00:00Z'), body: { main: 'answer' },
        }], [updated]);
        expect(projected[0]).to.include({ rawScore: 80, status: 12 });
    });

    it('finishes grading and a concurrent judge write using the same team-to-participant lock order', async () => {
        configureOfficialAnswer();
        lockContestProjection = true;
        let entered!: () => void;
        let release!: () => void;
        const insideGrade = new Promise<void>((resolve) => { entered = resolve; });
        const resumeGrade = new Promise<void>((resolve) => { release = resolve; });
        afterRoundRead = async () => {
            entered();
            await resumeGrade;
        };
        const grading = gradeLatestManualRecord(input());
        await insideGrade;
        const judging = withContestTeamBoundary('system', tid, () =>
            withSetParticipantBoundary('system', tid, 'u:42', async () => 'judged'));
        await new Promise<void>((resolve) => setImmediate(resolve));
        release();
        let timeout: ReturnType<typeof setTimeout>;
        try {
            const finished = await Promise.race([
                Promise.all([grading, judging]),
                new Promise<never>((_resolve, reject) => {
                    timeout = setTimeout(() => reject(new Error('manual grading lock deadlock')), 1000);
                }),
            ]);
            expect(finished[0].manualGrade?.score).to.equal(80);
            expect(finished[1]).to.equal('judged');
        } finally {
            clearTimeout(timeout!);
        }
    });
});

async function expectReject(promise: Promise<unknown>, errorType: new (...args: unknown[]) => Error) {
    let caught: unknown;
    try {
        await promise;
    } catch (error) {
        caught = error;
    }
    expect(caught).to.be.instanceOf(errorType);
}
