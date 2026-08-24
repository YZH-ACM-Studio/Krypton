import { expect } from 'chai';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { STATUS } from '@hydrooj/common';
import { ValidationError } from '../src/error';

const Module = require('module');
const modulePath = require.resolve('../src/model/record-score-cancellation.ts');
const originalLoad = Module._load;
const pretest = new ObjectId('000000000000000000000000');
const generate = new ObjectId('000000000000000000000001');
const records: any[] = [];
const statuses: any[] = [];
const audits: any[] = [];
const contestCalls: any[] = [];
let raceOnWrite = false;
let contestFailures = 0;
let rejudgePreflightError: Error | null = null;
let recoveryRace = false;
let judgeFailure: Error | null = null;
let judgeCalls = 0;

function clone<T>(value: T): T {
    if (!value || typeof value !== 'object') return value;
    if (value instanceof Date) return new Date(value) as T;
    if (value instanceof ObjectId) return new ObjectId(value) as T;
    if (Array.isArray(value)) return value.map(clone) as T;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
}

function same(left: unknown, right: unknown) {
    if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
    if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
    return left === right;
}

function applyUpdate(target: any, update: any) {
    Object.assign(target, clone(update.$set || {}));
    for (const key of Object.keys(update.$unset || {})) delete target[key];
}

const fakeRecord = {
    RECORD_PRETEST: pretest,
    RECORD_GENERATE: generate,
    coll: {
        async findOneAndUpdate(filter: any, update: any) {
            if (raceOnWrite) {
                raceOnWrite = false;
                return null;
            }
            const found = records.find(
                (item) =>
                    same(item._id, filter._id) &&
                    item.domainId === filter.domainId &&
                    item.status === filter.status &&
                    same(item.judgeAt, filter.judgeAt) &&
                    !item.scoreCancellation &&
                    !item.manualPending &&
                    !item.manualGrade,
            );
            if (!found) return null;
            applyUpdate(found, update);
            return clone(found);
        },
        find(query: any) {
            let projection: any = null;
            return {
                project(value: any) {
                    projection = value;
                    return this;
                },
                sort() {
                    return this;
                },
                async toArray() {
                    return records
                        .filter(
                            (item) =>
                                item.domainId === query.domainId &&
                                item.pid === query.pid &&
                                item.uid === query.uid &&
                                !same(item._id, query._id.$ne) &&
                                query.status.$in.includes(item.status) &&
                                ![pretest, generate].some((sentinel) => same(item.contest, sentinel)) &&
                                !item.manualPending &&
                                !item.files?.hack &&
                                !item.hackTarget,
                        )
                        .map((item) =>
                            projection
                                ? Object.fromEntries(Object.keys(projection).filter((key) => projection[key]).map((key) => [key, clone(item[key])]))
                                : clone(item),
                        );
                },
            };
        },
    },
    async get(domainId: string, rid: ObjectId) {
        return clone(records.find((item) => item.domainId === domainId && same(item._id, rid)) || null);
    },
    async assertRejudgeable() {
        if (rejudgePreflightError) throw rejudgePreflightError;
    },
    async submissionPriority() {
        return -20;
    },
    async resetCanceledScore(domainId: string, rid: ObjectId, expectedCancellationAt: Date) {
        if (recoveryRace) {
            recoveryRace = false;
            throw new ValidationError('record', null, '提交状态已变化，请刷新后重试');
        }
        const found = records.find(
            (item) =>
                item.domainId === domainId &&
                same(item._id, rid) &&
                item.status === STATUS.STATUS_CANCELED &&
                same(item.scoreCancellation?.at, expectedCancellationAt),
        );
        if (!found) throw new ValidationError('record', null, '提交状态已变化，请刷新后重试');
        Object.assign(found, {
            status: STATUS.STATUS_WAITING,
            score: 0,
            time: 0,
            memory: 0,
            judgeAt: null,
            rejudged: true,
        });
        return clone(found);
    },
    async finalizeCanceledScoreRecovery(domainId: string, rid: ObjectId, expectedCancellationAt: Date) {
        const found = records.find(
            (item) => item.domainId === domainId && same(item._id, rid) && same(item.scoreCancellation?.at, expectedCancellationAt),
        );
        if (!found) throw new ValidationError('record');
        delete found.scoreCancellation;
        return clone(found);
    },
    async rollbackCanceledScoreRecovery(domainId: string, waiting: any, canceled: any) {
        const index = records.findIndex((item) => item.domainId === domainId && same(item._id, waiting._id));
        if (index < 0) throw new Error('rollback target missing');
        records[index] = clone(canceled);
        return clone(records[index]);
    },
    async judge() {
        judgeCalls += 1;
        if (judgeFailure) throw judgeFailure;
        return { 0: new ObjectId() };
    },
};

const fakeDocument = {
    TYPE_PROBLEM: 10,
    collStatus: {
        async findOne(filter: any) {
            return clone(
                statuses.find(
                    (item) =>
                        item.domainId === filter.domainId &&
                        item.docType === filter.docType &&
                        item.docId === filter.docId &&
                        item.uid === filter.uid,
                ) || null,
            );
        },
        async findOneAndUpdate(filter: any, update: any) {
            const found = statuses.find(
                (item) =>
                    item.domainId === filter.domainId &&
                    item.docType === filter.docType &&
                    item.docId === filter.docId &&
                    item.uid === filter.uid &&
                    same(item.rid, filter.rid),
            );
            if (!found) return null;
            applyUpdate(found, update);
            return clone(found);
        },
    },
};

const fakeContest = {
    async updateStatus(...args: any[]) {
        contestCalls.push(args.map(clone));
        if (contestFailures > 0) {
            contestFailures -= 1;
            throw new Error('contest projection failed');
        }
        return { projected: true };
    },
};

const fakeOplog = {
    async add(doc: any) {
        const stored = { _id: new ObjectId(), ...clone(doc) };
        audits.push(stored);
        return stored._id;
    },
    coll: {
        async findOne(query: any) {
            return clone(
                audits.find(
                    (item) =>
                        item.type === query.type &&
                        item.domainId === query.domainId &&
                        same(item.rid, query.rid) &&
                        item.operation === query.operation &&
                        same(item.cancellationAt, query.cancellationAt) &&
                        item.outcome === query.outcome &&
                        item.result === query.result,
                ) || null,
            );
        },
        async updateOne(filter: any, update: any) {
            const found = audits.find((item) => same(item._id, filter._id));
            if (found) applyUpdate(found, update);
            return { matchedCount: found ? 1 : 0, modifiedCount: found ? 1 : 0 };
        },
    },
};

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === modulePath) {
        if (request === './document') return fakeDocument;
        if (request === './contest') return fakeContest;
        if (request === './oplog') return fakeOplog;
        if (request === './record') {
            return {
                __esModule: true,
                default: fakeRecord,
            };
        }
    }
    return originalLoad.call(this, request, parent, isMain);
};

let cancellation: typeof import('../src/model/record-score-cancellation');
try {
    (global as any).Hydro ||= { model: {} };
    delete require.cache[modulePath];
    cancellation = require(modulePath);
} finally {
    Module._load = originalLoad;
}

const { buildRecordScoreAction, selectProblemStatusFallback } = cancellation;
type ProblemStatusCandidate = import('../src/model/record-score-cancellation').ProblemStatusCandidate;

function record(overrides: Record<string, unknown> = {}) {
    return {
        _id: new ObjectId(),
        domainId: 'system',
        pid: 100,
        uid: 8,
        status: STATUS.STATUS_ACCEPTED,
        score: 100,
        time: 10,
        memory: 1024,
        judgeAt: new Date('2026-07-25T00:00:00.000Z'),
        ...overrides,
    } as any;
}

beforeEach(() => {
    records.length = 0;
    statuses.length = 0;
    audits.length = 0;
    contestCalls.length = 0;
    raceOnWrite = false;
    contestFailures = 0;
    rejudgePreflightError = null;
    recoveryRace = false;
    judgeFailure = null;
    judgeCalls = 0;
    if ((global as any).Hydro?.model) delete (global as any).Hydro.model.virtualContest;
});

describe('P2.40 record score cancellation', () => {
    it('exposes cancellation only for finished automatic records', () => {
        expect(buildRecordScoreAction(record(), true)?.kind).to.equal('cancel');
        expect(buildRecordScoreAction(record({ status: STATUS.STATUS_FORMAT_ERROR }), true)?.kind).to.equal('cancel');
        expect(buildRecordScoreAction(record({ status: STATUS.STATUS_JUDGING, judgeAt: null }), true)).to.equal(null);
        expect(buildRecordScoreAction(record({ manualPending: true }), true)).to.equal(null);
        expect(buildRecordScoreAction(record({ manualGrade: { score: 50 } }), true)).to.equal(null);
        expect(buildRecordScoreAction(record({ files: { hack: 'hack.in' } }), true)).to.equal(null);
        expect(buildRecordScoreAction(record(), false)).to.equal(null);
        expect(buildRecordScoreAction(record({ virtualAttemptId: new ObjectId() }), true)?.kind).to.equal('cancel');
        expect(
            buildRecordScoreAction(
                record({
                    virtualAttemptId: new ObjectId(),
                    status: STATUS.STATUS_CANCELED,
                    scoreCancellation: {
                        actor: 2,
                        at: new Date('2026-07-25T01:00:00.000Z'),
                        before: { judgeAt: new Date('2026-07-25T00:00:00.000Z') },
                    },
                }),
                true,
            ),
        ).to.equal(null);
    });

    it('withholds the server capability when current rejudge preflight fails', async () => {
        const target = record();
        expect((await cancellation.getRecordScoreAction(target, true))?.kind).to.equal('cancel');
        rejudgePreflightError = new ValidationError('rid', null, 'current problem configuration is invalid');
        expect(await cancellation.getRecordScoreAction(target, true)).to.equal(null);
    });

    it('does not hide unexpected capability preflight failures', async () => {
        const target = record();
        rejudgePreflightError = new Error('database unavailable');
        await assert.rejects(() => cancellation.getRecordScoreAction(target, true), /database unavailable/);
    });

    it('exposes rejudge recovery for a canceled automatic record', () => {
        const before = record();
        const canceled = record({
            status: STATUS.STATUS_CANCELED,
            score: 0,
            time: 0,
            memory: 0,
            scoreCancellation: {
                actor: 2,
                at: new Date('2026-07-25T01:00:00.000Z'),
                before: {
                    status: before.status,
                    score: before.score,
                    time: before.time,
                    memory: before.memory,
                    judgeAt: before.judgeAt,
                },
            },
        });
        expect(buildRecordScoreAction(canceled, true)?.kind).to.equal('rejudge');
    });

    it('keeps an accepted fallback even when a newer failed record exists', () => {
        const accepted = {
            _id: ObjectId.createFromTime(100),
            status: STATUS.STATUS_ACCEPTED,
            score: 100,
        } as ProblemStatusCandidate;
        const newerWrong = {
            _id: ObjectId.createFromTime(200),
            status: STATUS.STATUS_WRONG_ANSWER,
            score: 0,
        } as ProblemStatusCandidate;
        expect(selectProblemStatusFallback([newerWrong, accepted])?._id.equals(accepted._id)).to.equal(true);
    });

    it('uses the newest terminal record when no accepted fallback remains', () => {
        const older = {
            _id: ObjectId.createFromTime(100),
            status: STATUS.STATUS_COMPILE_ERROR,
            score: 0,
        } as ProblemStatusCandidate;
        const newer = {
            _id: ObjectId.createFromTime(200),
            status: STATUS.STATUS_WRONG_ANSWER,
            score: 0,
        } as ProblemStatusCandidate;
        expect(selectProblemStatusFallback([older, newer])?._id.equals(newer._id)).to.equal(true);
        expect(selectProblemStatusFallback([])).to.equal(null);
    });

    it('cancels with CAS and replaces the current problem status with an accepted fallback', async () => {
        const target = record({ _id: ObjectId.createFromTime(300), contest: new ObjectId(), contestTeamId: new ObjectId() });
        const fallback = record({ _id: ObjectId.createFromTime(100), score: 100 });
        const newerWrong = record({ _id: ObjectId.createFromTime(200), status: STATUS.STATUS_WRONG_ANSWER, score: 0 });
        records.push(target, fallback, newerWrong);
        statuses.push({ domainId: 'system', docType: 10, docId: 100, uid: 8, rid: target._id, status: target.status, score: target.score, star: true });

        const result = await cancellation.cancelRecordScore({
            domainId: 'system',
            rid: target._id,
            actor: 2,
            expectedStatus: target.status,
            expectedJudgeAt: target.judgeAt,
            reason: 'duplicate',
        });

        expect(result.rdoc).to.include({ status: STATUS.STATUS_CANCELED, score: 0, time: 0, memory: 0 });
        expect(result.rdoc.scoreCancellation.reason).to.equal('duplicate');
        expect(statuses[0].rid.equals(fallback._id)).to.equal(true);
        expect(statuses[0]).to.include({ status: STATUS.STATUS_ACCEPTED, score: 100, star: true });
        expect(contestCalls).to.have.length(1);
        expect(contestCalls[0][5].contestTeamId.equals(target.contestTeamId)).to.equal(true);
        expect(audits[0]).to.include({ type: 'record.score.cancel', outcome: 'completed' });
        expect(audits[0].before).to.deep.equal({ status: STATUS.STATUS_ACCEPTED, score: 100 });
        expect(audits[0]).not.to.have.property('testCases');
    });

    it('rejects a stale cancellation request without changing the record', async () => {
        const target = record();
        records.push(target);
        raceOnWrite = true;
        let error: any;
        try {
            await cancellation.cancelRecordScore({
                domainId: 'system',
                rid: target._id,
                actor: 2,
                expectedStatus: target.status,
                expectedJudgeAt: target.judgeAt,
            });
        } catch (cause) {
            error = cause;
        }
        expect(error).to.be.instanceOf(Error);
        expect(records[0].status).to.equal(STATUS.STATUS_ACCEPTED);
        expect(audits).to.have.length(1);
        expect(audits[0]).to.include({ outcome: 'rejected', failedStage: 'cas' });
    });

    it('rejects cancellation before CAS when the current record cannot enter the rejudge chain', async () => {
        const target = record();
        records.push(target);
        rejudgePreflightError = new Error('current problem configuration is invalid');
        let error: any;
        try {
            await cancellation.cancelRecordScore({
                domainId: 'system',
                rid: target._id,
                actor: 2,
                expectedStatus: target.status,
                expectedJudgeAt: target.judgeAt,
            });
        } catch (cause) {
            error = cause;
        }
        expect(error).to.be.instanceOf(Error);
        expect(records[0].status).to.equal(STATUS.STATUS_ACCEPTED);
        expect(audits[0]).to.include({ outcome: 'rejected', failedStage: 'rejudge_preflight' });
    });

    it('retries only the failed projection without overwriting original cancellation metadata', async () => {
        const target = record({ _id: ObjectId.createFromTime(300), contest: new ObjectId() });
        records.push(target);
        statuses.push({ domainId: 'system', docType: 10, docId: 100, uid: 8, rid: target._id, status: target.status, score: target.score });
        contestFailures = 1;
        const input = {
            domainId: 'system',
            rid: target._id,
            actor: 2,
            expectedStatus: target.status,
            expectedJudgeAt: target.judgeAt,
            reason: 'first reason',
        };
        let projectionError: any;
        try {
            await cancellation.cancelRecordScore(input);
        } catch (cause) {
            projectionError = cause;
        }
        expect(projectionError?.message).to.include('stage=contest');
        const firstMetadata = clone(records[0].scoreCancellation);

        const retried = await cancellation.cancelRecordScore({ ...input, actor: 9, reason: 'replacement reason' });

        expect(retried.rdoc.status).to.equal(STATUS.STATUS_CANCELED);
        expect(records[0].scoreCancellation).to.deep.equal(firstMetadata);
        expect(audits).to.have.length(2);
        expect(audits[0].outcome).to.equal('projection_failed');
        expect(audits[1]).to.include({ retry: true, outcome: 'completed' });
        expect(contestCalls).to.have.length(2);
    });

    it('audits permission rejection and recovery preflight failure without mutating the record', async () => {
        const target = record({
            status: STATUS.STATUS_CANCELED,
            score: 0,
            time: 0,
            memory: 0,
            scoreCancellation: {
                actor: 2,
                at: new Date('2026-07-25T01:00:00.000Z'),
                before: {
                    status: STATUS.STATUS_ACCEPTED,
                    score: 100,
                    time: 10,
                    memory: 1024,
                    judgeAt: new Date('2026-07-25T00:00:00.000Z'),
                },
            },
        });
        await cancellation.auditRecordScorePermissionRejection({
            rdoc: target,
            actor: 9,
            operation: 'cancel',
        });
        records.push(clone(target));
        rejudgePreflightError = new ValidationError('rid', null, 'current problem configuration is invalid');
        let error: any;
        try {
            await cancellation.recoverCanceledRecord({
                domainId: target.domainId,
                rid: target._id,
                actor: 2,
                expectedCancellationAt: target.scoreCancellation.at,
            });
        } catch (cause) {
            error = cause;
        }
        expect(error).to.be.instanceOf(ValidationError);
        expect(audits[0]).to.include({
            type: 'record.score.request_rejected',
            operation: 'cancel',
            pid: target.pid,
            uid: target.uid,
            originalStatus: STATUS.STATUS_ACCEPTED,
            originalScore: 100,
            stage: 'permission',
            result: 'rejected',
            failedStage: 'permission',
        });
        expect(audits[1]).to.include({
            type: 'record.score.rejudge_requested',
            operation: 'rejudge',
            pid: target.pid,
            uid: target.uid,
            originalStatus: STATUS.STATUS_ACCEPTED,
            originalScore: 100,
            outcome: 'rejected',
            stage: 'rejudge_preflight',
            result: 'rejected',
            failedStage: 'rejudge_preflight',
        });
        expect(judgeCalls).to.equal(0);
    });

    it('marks recovery accepted only after the current canceled record is reset and queued', async () => {
        const target = record({
            status: STATUS.STATUS_CANCELED,
            score: 0,
            time: 0,
            memory: 0,
            scoreCancellation: {
                actor: 2,
                at: new Date('2026-07-25T01:00:00.000Z'),
                before: {
                    status: STATUS.STATUS_ACCEPTED,
                    score: 100,
                    time: 10,
                    memory: 1024,
                    judgeAt: new Date('2026-07-25T00:00:00.000Z'),
                },
            },
        });
        records.push(clone(target));

        const result = await cancellation.recoverCanceledRecord({
            domainId: target.domainId,
            rid: target._id,
            actor: 2,
            expectedCancellationAt: target.scoreCancellation.at,
        });

        expect(result.rdoc.status).to.equal(STATUS.STATUS_WAITING);
        expect(judgeCalls).to.equal(1);
        expect(audits[0]).to.include({
            type: 'record.score.rejudge_requested',
            outcome: 'queued',
            stage: 'queue',
            result: 'accepted',
        });
        Object.assign(records[0], {
            status: STATUS.STATUS_ACCEPTED,
            score: 100,
            judgeAt: new Date('2026-07-25T02:00:00.000Z'),
        });
        const retried = await cancellation.recoverCanceledRecord({
            domainId: target.domainId,
            rid: target._id,
            actor: 2,
            expectedCancellationAt: target.scoreCancellation.at,
        });
        expect(retried.idempotent).to.equal(true);
        expect(retried.recordScoreAction?.kind).to.equal('cancel');
        expect(judgeCalls).to.equal(1);

        records[0] = record({
            _id: target._id,
            status: STATUS.STATUS_CANCELED,
            score: 0,
            scoreCancellation: {
                actor: 3,
                at: new Date('2026-07-25T03:00:00.000Z'),
                before: {
                    status: STATUS.STATUS_WRONG_ANSWER,
                    score: 0,
                    time: 12,
                    memory: 2048,
                    judgeAt: new Date('2026-07-25T02:30:00.000Z'),
                },
            },
        });
        const staleRevisionRetry = await cancellation.recoverCanceledRecord({
            domainId: target.domainId,
            rid: target._id,
            actor: 2,
            expectedCancellationAt: target.scoreCancellation.at,
        });
        expect(staleRevisionRetry.recordScoreAction).to.include({
            kind: 'rejudge',
            expectedCancellationAt: '2026-07-25T03:00:00.000Z',
        });
        expect(judgeCalls).to.equal(1);
    });

    it('fails recovery audit when queueing fails and rejects a concurrent second reset', async () => {
        const target = record({
            status: STATUS.STATUS_CANCELED,
            score: 0,
            scoreCancellation: {
                actor: 2,
                at: new Date('2026-07-25T01:00:00.000Z'),
                before: {
                    status: STATUS.STATUS_ACCEPTED,
                    score: 100,
                    time: 10,
                    memory: 1024,
                    judgeAt: new Date('2026-07-25T00:00:00.000Z'),
                },
            },
        });
        records.push(clone(target));
        judgeFailure = new Error('queue unavailable');
        await assert.rejects(
            () =>
                cancellation.recoverCanceledRecord({
                    domainId: target.domainId,
                    rid: target._id,
                    actor: 2,
                    expectedCancellationAt: target.scoreCancellation.at,
                }),
            /queue unavailable/,
        );
        expect(audits[0]).to.include({ outcome: 'failed', stage: 'queue', result: 'failed' });
        expect(records[0].status).to.equal(STATUS.STATUS_CANCELED);
        expect(records[0].scoreCancellation.at).to.deep.equal(target.scoreCancellation.at);

        records[0] = clone(target);
        judgeFailure = null;
        recoveryRace = true;
        await assert.rejects(() =>
                cancellation.recoverCanceledRecord({
                    domainId: target.domainId,
                    rid: target._id,
                    actor: 2,
                    expectedCancellationAt: target.scoreCancellation.at,
                }),
        );
        expect(judgeCalls).to.equal(1);
        expect(audits[1]).to.include({ outcome: 'rejected', stage: 'reset', result: 'rejected' });
    });

    it('restats virtual contest attempts after cancel instead of official contest status', async () => {
        const vpCalls: any[] = [];
        (global as any).Hydro.model.virtualContest = {
            virtualContestService: {
                async updateStatus(input: any) {
                    vpCalls.push(clone(input));
                    return { projected: true };
                },
            },
        };
        const target = record({
            virtualAttemptId: new ObjectId(),
            sourceContestId: new ObjectId(),
        });
        records.push(clone(target));
        statuses.push({
            domainId: 'system',
            docType: 10,
            docId: 100,
            uid: 8,
            rid: target._id,
            status: target.status,
            score: target.score,
        });
        const result = await cancellation.cancelRecordScore({
            domainId: 'system',
            rid: target._id,
            actor: 2,
            expectedStatus: target.status,
            expectedJudgeAt: target.judgeAt,
        });
        expect(result.rdoc.status).to.equal(STATUS.STATUS_CANCELED);
        expect(contestCalls).to.have.length(0);
        expect(vpCalls).to.have.length(1);
        expect(String(vpCalls[0].attemptId)).to.equal(String(target.virtualAttemptId));
        expect(vpCalls[0].result.status).to.equal(STATUS.STATUS_CANCELED);
    });
});
