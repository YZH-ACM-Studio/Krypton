import { ObjectId } from 'mongodb';
import { STATUS } from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import { ProblemConfigError, ProblemNotFoundError, ValidationError } from '../error';
import type { RecordDoc } from '../interface';
import * as document from './document';
import * as contest from './contest';
import * as oplog from './oplog';
import record from './record';

const logger = new Logger('record-score-cancellation');

const CANCELABLE_STATUSES = new Set<number>([
    STATUS.STATUS_ACCEPTED,
    STATUS.STATUS_WRONG_ANSWER,
    STATUS.STATUS_TIME_LIMIT_EXCEEDED,
    STATUS.STATUS_MEMORY_LIMIT_EXCEEDED,
    STATUS.STATUS_OUTPUT_LIMIT_EXCEEDED,
    STATUS.STATUS_RUNTIME_ERROR,
    STATUS.STATUS_COMPILE_ERROR,
    STATUS.STATUS_FORMAT_ERROR,
    STATUS.STATUS_SYSTEM_ERROR,
    STATUS.STATUS_ETC,
    STATUS.STATUS_HACKED,
]);

const PROBLEM_STATUS_STATUSES = [...CANCELABLE_STATUSES, STATUS.STATUS_MANUAL_GRADED];

export type RecordScoreAction =
    | {
          kind: 'cancel';
          expectedStatus: number;
          expectedJudgeAt: string;
          contestId?: string;
          contestTeamId?: string;
      }
    | {
          kind: 'rejudge';
          expectedCancellationAt: string;
          contestId?: string;
          contestTeamId?: string;
      };

export type ProblemStatusCandidate = Pick<RecordDoc, '_id' | 'status' | 'score'>;

function isSentinelContest(value: unknown): boolean {
    if (!(value instanceof ObjectId)) return false;
    return value.equals(record.RECORD_PRETEST) || value.equals(record.RECORD_GENERATE);
}

function hasAutomaticJudgeResult(rdoc: Pick<RecordDoc, 'judgeAt' | 'manualPending' | 'manualGrade' | 'files' | 'hackTarget' | 'contest'>): boolean {
    return (
        rdoc.judgeAt instanceof Date &&
        !Number.isNaN(rdoc.judgeAt.getTime()) &&
        !rdoc.manualPending &&
        !rdoc.manualGrade &&
        !rdoc.files?.hack &&
        !rdoc.hackTarget &&
        !isSentinelContest(rdoc.contest)
    );
}

function actionContext(rdoc: Pick<RecordDoc, 'contest' | 'contestTeamId'>) {
    return {
        ...(rdoc.contest instanceof ObjectId ? { contestId: rdoc.contest.toHexString() } : {}),
        ...(rdoc.contestTeamId instanceof ObjectId ? { contestTeamId: rdoc.contestTeamId.toHexString() } : {}),
    };
}

export function buildRecordScoreAction(rdoc: RecordDoc, authorized: boolean): RecordScoreAction | null {
    if (!authorized || !hasAutomaticJudgeResult(rdoc)) return null;
    if (rdoc.status === STATUS.STATUS_CANCELED && rdoc.scoreCancellation?.before?.judgeAt instanceof Date) {
        if (!(rdoc.scoreCancellation.at instanceof Date)) return null;
        return {
            kind: 'rejudge',
            expectedCancellationAt: rdoc.scoreCancellation.at.toISOString(),
            ...actionContext(rdoc),
        };
    }
    if (!CANCELABLE_STATUSES.has(rdoc.status)) return null;
    return {
        kind: 'cancel',
        expectedStatus: rdoc.status,
        expectedJudgeAt: rdoc.judgeAt.toISOString(),
        ...actionContext(rdoc),
    };
}

export async function getRecordScoreAction(rdoc: RecordDoc, authorized: boolean): Promise<RecordScoreAction | null> {
    const action = buildRecordScoreAction(rdoc, authorized);
    if (!action) return null;
    try {
        await record.assertRejudgeable(rdoc.domainId, [rdoc]);
        return action;
    } catch (error) {
        if (error instanceof ValidationError || error instanceof ProblemConfigError || error instanceof ProblemNotFoundError) return null;
        logger.error(
            'Record score action preflight failed unexpectedly domain=%s rid=%s pid=%d uid=%d error=%o',
            rdoc.domainId,
            rdoc._id.toHexString(),
            rdoc.pid,
            rdoc.uid,
            error,
        );
        throw error;
    }
}

export function selectProblemStatusFallback(candidates: ProblemStatusCandidate[]): ProblemStatusCandidate | null {
    const ordered = [...candidates].sort((left, right) => right._id.toHexString().localeCompare(left._id.toHexString()));
    return ordered.find((candidate) => candidate.status === STATUS.STATUS_ACCEPTED) || ordered[0] || null;
}

function sameDate(left: unknown, right: Date): boolean {
    return left instanceof Date && left.getTime() === right.getTime();
}

function projectionError(stage: string, rdoc: RecordDoc, error: unknown): Error {
    const context = [
        `stage=${stage}`,
        `domain=${rdoc.domainId}`,
        `rid=${rdoc._id.toHexString()}`,
        `pid=${rdoc.pid}`,
        `uid=${rdoc.uid}`,
        `tid=${rdoc.contest instanceof ObjectId ? rdoc.contest.toHexString() : '-'}`,
        `team=${rdoc.contestTeamId instanceof ObjectId ? rdoc.contestTeamId.toHexString() : '-'}`,
    ].join(' ');
    const wrapped = new Error(`Record score cancellation projection failed (${context}): ${error instanceof Error ? error.message : String(error)}`);
    (wrapped as any).cause = error;
    return wrapped;
}

async function projectProblemStatus(rdoc: RecordDoc) {
    const current = await document.collStatus.findOne({
        domainId: rdoc.domainId,
        docType: document.TYPE_PROBLEM,
        docId: rdoc.pid,
        uid: rdoc.uid,
    });
    if (!(current?.rid instanceof ObjectId) || !current.rid.equals(rdoc._id)) return current;

    const candidates = (await record.coll
        .find({
            domainId: rdoc.domainId,
            pid: rdoc.pid,
            uid: rdoc.uid,
            _id: { $ne: rdoc._id },
            status: { $in: PROBLEM_STATUS_STATUSES },
            contest: { $nin: [record.RECORD_PRETEST, record.RECORD_GENERATE] },
            manualPending: { $ne: true },
            'files.hack': { $exists: false },
            hackTarget: { $exists: false },
        })
        .project({ _id: 1, status: 1, score: 1 })
        .sort({ _id: -1 })
        .toArray()) as ProblemStatusCandidate[];
    const fallback = selectProblemStatusFallback(candidates);
    const update = fallback
        ? { $set: { rid: fallback._id, status: fallback.status, score: fallback.score } }
        : { $unset: { rid: '', status: '', score: '' } };
    const projected = await document.collStatus.findOneAndUpdate(
        {
            domainId: rdoc.domainId,
            docType: document.TYPE_PROBLEM,
            docId: rdoc.pid,
            uid: rdoc.uid,
            rid: rdoc._id,
        },
        update as any,
        { returnDocument: 'after' },
    );
    if (projected) return projected;
    const concurrent = await document.collStatus.findOne({
        domainId: rdoc.domainId,
        docType: document.TYPE_PROBLEM,
        docId: rdoc.pid,
        uid: rdoc.uid,
    });
    if (concurrent?.rid instanceof ObjectId && concurrent.rid.equals(rdoc._id)) throw new Error('problem status still references the canceled record');
    return concurrent;
}

async function projectContestStatus(rdoc: RecordDoc) {
    if (!(rdoc.contest instanceof ObjectId)) return null;
    return contest.updateStatus(rdoc.domainId, rdoc.contest, rdoc.uid, rdoc._id, rdoc.pid, rdoc);
}

async function runProjections(rdoc: RecordDoc, auditId: ObjectId) {
    let stage = 'problem';
    try {
        const problemStatus = await projectProblemStatus(rdoc);
        stage = 'contest';
        const contestStatus = await projectContestStatus(rdoc);
        await updateAudit(auditId, {
            outcome: 'completed',
            stage: 'complete',
            result: 'success',
            completedAt: new Date(),
            projection: {
                problem: true,
                contest: !!rdoc.contest,
            },
        });
        return { problemStatus, contestStatus };
    } catch (error) {
        const wrapped = projectionError(stage, rdoc, error);
        logger.error('%s', wrapped.message);
        await updateAudit(auditId, {
            outcome: 'projection_failed',
            stage,
            result: 'failed',
            failedAt: new Date(),
            failedStage: stage,
            error: wrapped.message,
        });
        throw wrapped;
    }
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function auditRecordContext(rdoc: RecordDoc) {
    const original = rdoc.scoreCancellation?.before || rdoc;
    return {
        pid: rdoc.pid,
        uid: rdoc.uid,
        tid: rdoc.contest,
        contestTeamId: rdoc.contestTeamId,
        cancellationAt: rdoc.scoreCancellation?.at,
        originalStatus: original.status,
        originalScore: original.score,
    };
}

async function updateAudit(auditId: ObjectId, fields: Record<string, unknown>) {
    const result = await oplog.coll.updateOne({ _id: auditId }, { $set: fields });
    if (result.matchedCount !== 1) throw new Error(`Record score audit update missed auditId=${auditId.toHexString()}`);
}

async function rejectAudit(auditId: ObjectId, stage: string, error: unknown) {
    await updateAudit(auditId, {
        outcome: 'rejected',
        stage,
        result: 'rejected',
        failedAt: new Date(),
        failedStage: stage,
        error: errorText(error),
    });
}

async function failAudit(auditId: ObjectId, stage: string, error: unknown) {
    await updateAudit(auditId, {
        outcome: 'failed',
        stage,
        result: 'failed',
        failedAt: new Date(),
        failedStage: stage,
        error: errorText(error),
    });
}

export async function auditRecordScorePermissionRejection(input: {
    rdoc: RecordDoc;
    actor: number;
    operation: string;
}) {
    await oplog.add({
        type: 'record.score.request_rejected',
        domainId: input.rdoc.domainId,
        rid: input.rdoc._id,
        ...auditRecordContext(input.rdoc),
        operator: input.actor,
        operation: input.operation,
        outcome: 'rejected',
        stage: 'permission',
        result: 'rejected',
        failedStage: 'permission',
        time: new Date(),
    });
}

export async function cancelRecordScore(input: {
    domainId: string;
    rid: ObjectId;
    actor: number;
    expectedStatus: number;
    expectedJudgeAt: Date;
    reason?: string;
}) {
    const reason = input.reason?.trim();
    const auditId = await oplog.add({
        type: 'record.score.cancel',
        domainId: input.domainId,
        rid: input.rid,
        operator: input.actor,
        operation: 'cancel',
        expectedStatus: input.expectedStatus,
        expectedJudgeAt: input.expectedJudgeAt,
        time: new Date(),
        outcome: 'started',
        stage: 'request',
        result: 'started',
    });
    if (reason && reason.length > 240) {
        const error = new ValidationError('reason');
        await rejectAudit(auditId, 'input', error);
        throw error;
    }
    let rdoc = await record.get(input.domainId, input.rid);
    if (!rdoc) {
        const error = new ValidationError('rid');
        await rejectAudit(auditId, 'load', error);
        throw error;
    }
    await updateAudit(auditId, auditRecordContext(rdoc));

    const retry =
        rdoc.status === STATUS.STATUS_CANCELED &&
        rdoc.scoreCancellation?.before?.status === input.expectedStatus &&
        sameDate(rdoc.scoreCancellation.before.judgeAt, input.expectedJudgeAt);
    if (!retry) {
        if (rdoc.status !== input.expectedStatus || !sameDate(rdoc.judgeAt, input.expectedJudgeAt) || !buildRecordScoreAction(rdoc, true)) {
            const error = new ValidationError('record', null, '提交状态已变化，请刷新后重试');
            await rejectAudit(auditId, 'eligibility', error);
            throw error;
        }
        try {
            await record.assertRejudgeable(input.domainId, [rdoc]);
        } catch (error) {
            await rejectAudit(auditId, 'rejudge_preflight', error);
            throw error;
        }
        const at = new Date();
        const updated = await record.coll.findOneAndUpdate(
            {
                _id: input.rid,
                domainId: input.domainId,
                status: input.expectedStatus,
                judgeAt: input.expectedJudgeAt,
                scoreCancellation: { $exists: false },
                manualPending: { $ne: true },
                manualGrade: { $exists: false },
            },
            {
                $set: {
                    status: STATUS.STATUS_CANCELED,
                    score: 0,
                    time: 0,
                    memory: 0,
                    testCases: [],
                    subtasks: {},
                    scoreCancellation: {
                        actor: input.actor,
                        at,
                        ...(reason ? { reason } : {}),
                        before: {
                            status: rdoc.status,
                            score: rdoc.score,
                            time: rdoc.time,
                            memory: rdoc.memory,
                            judgeAt: rdoc.judgeAt,
                        },
                    },
                },
                $unset: { progress: '' },
            },
            { returnDocument: 'after' },
        );
        if (!updated) {
            const error = new ValidationError('record', null, '提交状态已变化，请刷新后重试');
            await rejectAudit(auditId, 'cas', error);
            throw error;
        }
        rdoc = updated;
    }

    await updateAudit(auditId, {
        reason: rdoc.scoreCancellation?.reason,
        retry,
        outcome: 'projecting',
        stage: 'projection',
        result: 'started',
        before: rdoc.scoreCancellation?.before
            ? {
                  status: rdoc.scoreCancellation.before.status,
                  score: rdoc.scoreCancellation.before.score,
              }
            : undefined,
    });
    const projection = await runProjections(rdoc, auditId);
    return { rdoc, projection, recordScoreAction: await getRecordScoreAction(rdoc, true) };
}

export async function recoverCanceledRecord(input: {
    domainId: string;
    rid: ObjectId;
    actor: number;
    expectedCancellationAt: Date;
}) {
    const completed = await oplog.coll.findOne({
        type: 'record.score.rejudge_requested',
        domainId: input.domainId,
        rid: input.rid,
        operation: 'rejudge',
        cancellationAt: input.expectedCancellationAt,
        outcome: 'queued',
        result: 'accepted',
    });
    if (completed) {
        const current = await record.get(input.domainId, input.rid);
        if (!current) throw new ValidationError('rid');
        return {
            rdoc: current,
            recordScoreAction: await getRecordScoreAction(current, true),
            idempotent: true,
        };
    }
    const auditId = await oplog.add({
        type: 'record.score.rejudge_requested',
        domainId: input.domainId,
        rid: input.rid,
        operator: input.actor,
        operation: 'rejudge',
        cancellationAt: input.expectedCancellationAt,
        time: new Date(),
        outcome: 'started',
        stage: 'request',
        result: 'started',
    });
    let stage = 'load';
    let canceled: RecordDoc | null = null;
    let waiting: RecordDoc | null = null;
    let queued = false;
    try {
        let rdoc = await record.get(input.domainId, input.rid);
        if (!rdoc) throw new ValidationError('rid');
        await updateAudit(auditId, auditRecordContext(rdoc));
        stage = 'eligibility';
        const action = buildRecordScoreAction(rdoc, true);
        if (
            action?.kind !== 'rejudge' ||
            !(rdoc.scoreCancellation?.at instanceof Date) ||
            rdoc.scoreCancellation.at.getTime() !== input.expectedCancellationAt.getTime()
        ) {
            throw new ValidationError('record', null, '该记录不能通过重新评测恢复成绩');
        }
        canceled = rdoc;
        stage = 'rejudge_preflight';
        await record.assertRejudgeable(rdoc.domainId, [rdoc]);
        stage = 'priority';
        const priority = await record.submissionPriority(input.actor, -20);
        stage = 'reset';
        waiting = await record.resetCanceledScore(input.domainId, input.rid, rdoc.scoreCancellation.at);
        stage = 'queue';
        const queueResult = await record.judge(input.domainId, input.rid, priority, waiting.contest ? { detail: false } : {});
        if (!queueResult || !Object.keys(queueResult).length) throw new Error(`Rejudge queue returned no task for rid=${input.rid.toHexString()}`);
        queued = true;
        stage = 'finalize';
        rdoc = await record.finalizeCanceledScoreRecovery(input.domainId, input.rid, input.expectedCancellationAt, auditId, canceled);
        await updateAudit(auditId, {
            outcome: 'queued',
            stage: 'queue',
            result: 'accepted',
            completedAt: new Date(),
        });
        return { rdoc, recordScoreAction: null };
    } catch (error) {
        if (waiting && canceled && !queued) {
            const failedStage = stage;
            try {
                await record.rollbackCanceledScoreRecovery(input.domainId, waiting, canceled);
            } catch (rollbackError) {
                const wrapped = new Error(
                    `Record score recovery failed and rollback failed domain=${input.domainId} rid=${input.rid.toHexString()} stage=${failedStage}: ${errorText(
                        error,
                    )}; rollback=${errorText(rollbackError)}`,
                );
                await failAudit(auditId, 'rollback', wrapped);
                throw wrapped;
            }
            stage = failedStage;
        }
        if (
            (error instanceof ValidationError || error instanceof ProblemConfigError || error instanceof ProblemNotFoundError) &&
            ['load', 'eligibility', 'rejudge_preflight', 'reset'].includes(stage)
        ) {
            await rejectAudit(auditId, stage, error);
        } else {
            await failAudit(auditId, stage, error);
        }
        throw error;
    }
}
