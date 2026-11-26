import { ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import { localizedErrorText, ManualGradeConflictError, ValidationError } from '../error';
import type { RecordDoc } from '../interface';
import { withSetParticipantBoundary } from '../lib/set-participant-boundary';
import { storedSetConfigOrNull } from '../lib/set-publication';
import bus from '../service/bus';
import { STATUS } from './builtin';
import * as contest from './contest';
import { withContestTeamBoundary } from './contest-team-gate';
import * as OplogModel from './oplog';
import problem from './problem';
import record from './record';

const logger = new Logger('manual-grade');

export const MANUAL_GRADE_RULES = Object.freeze(['exam', 'homework', 'oi'] as const);

export async function latestManualRecord(domainId: string, tid: ObjectId, pid: number, uid: number): Promise<RecordDoc | null> {
    return await record.coll.findOne({ domainId, contest: tid, pid, uid }, { sort: { _id: -1 }, readPreference: 'primary' });
}

async function latestManualRecordForGrade(
    input: { domainId: string; tid: ObjectId; pid: number; uid: number; latestRid: ObjectId },
    stage: 'before-record-write' | 'after-record-write',
    configured = false,
): Promise<RecordDoc | null> {
    try {
        if (configured) {
            return await record.coll.findOne({
                domainId: input.domainId, contest: input.tid, pid: input.pid, uid: input.uid, _id: input.latestRid,
            }, { readPreference: 'primary' });
        }
        return await latestManualRecord(input.domainId, input.tid, input.pid, input.uid);
    } catch (error) {
        logger.error(
            'Manual grade latest record query failed stage=%s domain=%s container=%s pid=%d uid=%d rid=%s error=%o',
            stage,
            input.domainId,
            input.tid,
            input.pid,
            input.uid,
            input.latestRid,
            error,
        );
        throw error;
    }
}

export async function markManualPending(input: { domainId: string; tid: ObjectId; pid: number; uid: number; rid: ObjectId }): Promise<void> {
    try {
        const [problemStatus, contestStatus] = await Promise.all([
            problem.updateManualStatusLatest(input.domainId, input.pid, input.uid, input.rid, STATUS.STATUS_WAITING, 0),
            contest.updateStatus(input.domainId, input.tid, input.uid, input.rid, input.pid, {
                status: STATUS.STATUS_WAITING,
                score: 0,
                manual: true,
            }),
        ]);
        if (!problemStatus) throw new ManualGradeConflictError();
        if (!contestStatus) throw new Error('Manual pending contest status projection was not applied');
    } catch (error) {
        logger.error(
            'Manual pending projection failed domain=%s container=%s pid=%d uid=%d rid=%s error=%o',
            input.domainId,
            input.tid,
            input.pid,
            input.uid,
            input.rid,
            error,
        );
        throw error;
    }
}

export interface ManualGradeInput {
    domainId: string;
    tid: ObjectId;
    pid: number;
    uid: number;
    latestRid: ObjectId;
    expectedRevision: number;
    score: number;
    comment?: string;
    reason?: string;
    actor: number;
}

export async function gradeLatestManualRecord(input: ManualGradeInput): Promise<RecordDoc> {
    const tdoc = await contest.get(input.domainId, input.tid);
    const configured = tdoc && storedSetConfigOrNull(tdoc) !== null;
    if (!tdoc || (!configured && !MANUAL_GRADE_RULES.includes(tdoc.rule as any))) throw new ValidationError('rule');
    if (!tdoc.pids?.includes(input.pid)) throw new ValidationError('pid');
    if (!Number.isFinite(input.score) || input.score < 0 || input.score > 100) {
        throw new ValidationError('score');
    }
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
        throw new ValidationError('expectedRevision');
    }
    if (configured) {
        const target = await latestManualRecordForGrade(input, 'before-record-write', true);
        if (!target || !(target.setRoundId instanceof ObjectId) || !Number.isSafeInteger(target.setAnswerVersion)
            || target.setAnswerVersion < 1) throw new ManualGradeConflictError();
        const { participantKey } = require('./set-round') as typeof import('./set-round');
        return withContestTeamBoundary(input.domainId, input.tid, () =>
            withSetParticipantBoundary(input.domainId, input.tid, participantKey(input.uid, target.contestTeamId),
                () => gradeManualRecordInside(input, true)));
    }
    return gradeManualRecordInside(input, false);
}

async function assertCurrentOfficialAnswer(input: ManualGradeInput, target: RecordDoc): Promise<void> {
    if (!(target.setRoundId instanceof ObjectId) || !Number.isSafeInteger(target.setAnswerVersion)
        || target.setAnswerVersion < 1) throw new ManualGradeConflictError();
    const { readParticipantRound, getOfficialAnswers } = require('./set-round') as typeof import('./set-round');
    const round = await readParticipantRound(input.domainId, input.tid, input.uid, target.contestTeamId, target.setRoundId);
    if (!round) throw new ManualGradeConflictError();
    if (round.legacy?.scoreLocked) {
        throw new ValidationError('round', null, localizedErrorText`历史轮次记录不完整，不能修改评分。`);
    }
    const answers = await getOfficialAnswers(input.domainId, round);
    if (!answers.some((answer) => answer.pid === input.pid && answer.version === target.setAnswerVersion
        && answer.rid === target._id.toHexString())) throw new ManualGradeConflictError();
}

async function gradeManualRecordInside(input: ManualGradeInput, configured: boolean): Promise<RecordDoc> {
    const latest = await latestManualRecordForGrade(input, 'before-record-write', configured);
    if (!latest || !latest._id.equals(input.latestRid)) throw new ManualGradeConflictError();
    if (!latest.manualPending && !latest.manualGrade) throw new ValidationError('latestRid');
    if (configured) await assertCurrentOfficialAnswer(input, latest);
    const currentRevision = latest.manualGrade?.revision || 0;
    const comment = String(input.comment || '').trim();
    if (configured && latest.manualGrade && currentRevision === input.expectedRevision + 1
        && latest.manualGrade.score === input.score && latest.manualGrade.gradedBy === input.actor
        && (latest.manualGrade.comment ?? '') === comment) {
        // A lost response or failed projection can be retried without creating another grading revision.
        await OplogModel.add({
            type: 'problem.manual-grade-replay', domainId: input.domainId, operator: input.actor,
            contestId: input.tid, problemId: input.pid, uid: input.uid, rid: input.latestRid,
            setRoundId: latest.setRoundId, setAnswerVersion: latest.setAnswerVersion,
            newScore: input.score, newComment: comment, newRevision: currentRevision,
            reason: String(input.reason || '').trim() || 'initial-grade', time: new Date(),
        } as any);
        await projectOfficialManualGrade(input, latest);
        bus.broadcast('record/change', latest);
        return latest;
    }
    if (currentRevision !== input.expectedRevision) throw new ManualGradeConflictError();
    const reason = currentRevision === 0 ? 'initial-grade' : String(input.reason || '').trim();
    if (currentRevision > 0 && !reason) throw new ValidationError('reason');
    const now = new Date();
    const nextGrade = {
        score: input.score,
        maxScore: 100,
        ...(comment ? { comment } : {}),
        gradedBy: input.actor,
        gradedAt: now,
        revision: currentRevision + 1,
    };
    const revisionFilter = currentRevision === 0 ? { manualGrade: { $exists: false } } : { 'manualGrade.revision': currentRevision };
    let updated: RecordDoc | null;
    try {
        if (configured) {
            const { markRoundScoreDirty } = require('./set-round') as typeof import('./set-round');
            await markRoundScoreDirty(input.domainId, input.tid, latest.setRoundId);
        }
        updated = await record.coll.findOneAndUpdate(
            {
                domainId: input.domainId,
                _id: input.latestRid,
                contest: input.tid,
                pid: input.pid,
                uid: input.uid,
                ...revisionFilter,
            },
            {
                $set: {
                    manualGrade: nextGrade,
                    score: input.score,
                    status: STATUS.STATUS_MANUAL_GRADED,
                    judgeAt: now,
                },
                $unset: { manualPending: '' },
            },
            { returnDocument: 'after' },
        );
    } catch (error) {
        logger.error(
            'Manual grade record write failed domain=%s container=%s pid=%d uid=%d rid=%s revision=%d error=%o',
            input.domainId,
            input.tid,
            input.pid,
            input.uid,
            input.latestRid,
            currentRevision,
            error,
        );
        throw error;
    }
    if (!updated) throw new ManualGradeConflictError();
    bus.broadcast('record/change', updated);

    const currentLatest = await latestManualRecordForGrade(input, 'after-record-write', configured);
    try {
        await OplogModel.add({
            type: 'problem.manual-grade',
            domainId: input.domainId,
            operator: input.actor,
            contestId: input.tid,
            problemId: input.pid,
            uid: input.uid,
            rid: input.latestRid,
            reason,
            oldScore: latest.manualGrade?.score,
            newScore: input.score,
            oldComment: latest.manualGrade?.comment,
            newComment: comment,
            oldRevision: currentRevision,
            newRevision: nextGrade.revision,
            ...(configured ? { setRoundId: updated.setRoundId, setAnswerVersion: updated.setAnswerVersion } : {}),
            time: now,
        } as any);
    } catch (error) {
        logger.error(
            'Manual grade audit write failed domain=%s container=%s pid=%d uid=%d rid=%s revision=%d error=%o',
            input.domainId,
            input.tid,
            input.pid,
            input.uid,
            input.latestRid,
            nextGrade.revision,
            error,
        );
        throw error;
    }
    if (!currentLatest?._id.equals(input.latestRid)) throw new ManualGradeConflictError();

    try {
        if (configured) {
            await projectOfficialManualGrade(input, updated);
            return updated;
        }
        const projected = await problem.updateManualGradeStatus(input.domainId, input.pid, input.uid, input.latestRid, input.score);
        if (!projected) throw new ManualGradeConflictError();
        const contestStatus = await contest.updateStatus(input.domainId, input.tid, input.uid, input.latestRid, input.pid, updated);
        if (!contestStatus) throw new Error('Manual grade contest status projection was not applied');
        const finalLatest = await latestManualRecord(input.domainId, input.tid, input.pid, input.uid);
        if (!finalLatest?._id.equals(input.latestRid)) throw new ManualGradeConflictError();
    } catch (error) {
        logger.error(
            'Manual grade projection failed domain=%s container=%s pid=%d uid=%d rid=%s revision=%d error=%o',
            input.domainId,
            input.tid,
            input.pid,
            input.uid,
            input.latestRid,
            nextGrade.revision,
            error,
        );
        throw error;
    }
    return updated;
}

async function projectOfficialManualGrade(input: ManualGradeInput, updated: RecordDoc): Promise<void> {
    const { applyManualAnswerGrade } = require('./set-round') as typeof import('./set-round');
    const applied = await applyManualAnswerGrade(input.domainId, input.tid, updated.setRoundId, input.pid,
        updated._id, updated.setAnswerVersion, input.score, STATUS.STATUS_MANUAL_GRADED);
    if (!applied) throw new ManualGradeConflictError();
    // Older rounds remain gradeable while the problem's latest Record belongs to another round.
    await problem.updateManualGradeStatus(input.domainId, input.pid, input.uid, input.latestRid, input.score);
    const projected = await contest.updateStatus(input.domainId, input.tid, input.uid, input.latestRid, input.pid, updated);
    if (!projected) throw new Error('Manual grade contest status projection was not applied');
}
