import { ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import { ManualGradeConflictError, ValidationError } from '../error';
import type { RecordDoc } from '../interface';
import bus from '../service/bus';
import { STATUS } from './builtin';
import * as contest from './contest';
import * as OplogModel from './oplog';
import problem from './problem';
import record from './record';

const logger = new Logger('manual-grade');

export const MANUAL_GRADE_RULES = Object.freeze(['exam', 'homework', 'oi'] as const);

export async function latestManualRecord(
    domainId: string, tid: ObjectId, pid: number, uid: number,
): Promise<RecordDoc | null> {
    return await record.coll.findOne(
        { domainId, contest: tid, pid, uid },
        { sort: { _id: -1 }, readPreference: 'primary' },
    );
}

async function latestManualRecordForGrade(
    input: { domainId: string, tid: ObjectId, pid: number, uid: number, latestRid: ObjectId },
    stage: 'before-record-write' | 'after-record-write',
): Promise<RecordDoc | null> {
    try {
        return await latestManualRecord(input.domainId, input.tid, input.pid, input.uid);
    } catch (error) {
        logger.error(
            'Manual grade latest record query failed stage=%s domain=%s container=%s pid=%d uid=%d rid=%s error=%o',
            stage, input.domainId, input.tid, input.pid, input.uid, input.latestRid, error,
        );
        throw error;
    }
}

export async function markManualPending(input: {
    domainId: string;
    tid: ObjectId;
    pid: number;
    uid: number;
    rid: ObjectId;
}): Promise<void> {
    try {
        const [problemStatus, contestStatus] = await Promise.all([
            problem.updateManualStatusLatest(
                input.domainId, input.pid, input.uid, input.rid, STATUS.STATUS_WAITING, 0,
            ),
            contest.updateStatus(
                input.domainId, input.tid, input.uid, input.rid, input.pid,
                { status: STATUS.STATUS_WAITING, score: 0 },
            ),
        ]);
        if (!problemStatus) throw new ManualGradeConflictError();
        if (!contestStatus) throw new Error('Manual pending contest status projection was not applied');
    } catch (error) {
        logger.error(
            'Manual pending projection failed domain=%s container=%s pid=%d uid=%d rid=%s error=%o',
            input.domainId, input.tid, input.pid, input.uid, input.rid, error,
        );
        throw error;
    }
}

export async function gradeLatestManualRecord(input: {
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
}): Promise<RecordDoc> {
    const tdoc = await contest.get(input.domainId, input.tid);
    if (!tdoc || !MANUAL_GRADE_RULES.includes(tdoc.rule as any)) throw new ValidationError('rule');
    if (!tdoc.pids?.includes(input.pid)) throw new ValidationError('pid');
    if (!Number.isFinite(input.score) || input.score < 0 || input.score > 100) {
        throw new ValidationError('score');
    }
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
        throw new ValidationError('expectedRevision');
    }
    const latest = await latestManualRecordForGrade(input, 'before-record-write');
    if (!latest || !latest._id.equals(input.latestRid)) throw new ManualGradeConflictError();
    if (!latest.manualPending && !latest.manualGrade) throw new ValidationError('latestRid');
    const currentRevision = latest.manualGrade?.revision || 0;
    if (currentRevision !== input.expectedRevision) throw new ManualGradeConflictError();
    const reason = currentRevision === 0 ? 'initial-grade' : String(input.reason || '').trim();
    if (currentRevision > 0 && !reason) throw new ValidationError('reason');
    const comment = String(input.comment || '').trim();
    const now = new Date();
    const nextGrade = {
        score: input.score,
        maxScore: 100,
        ...(comment ? { comment } : {}),
        gradedBy: input.actor,
        gradedAt: now,
        revision: currentRevision + 1,
    };
    const revisionFilter = currentRevision === 0
        ? { manualGrade: { $exists: false } }
        : { 'manualGrade.revision': currentRevision };
    let updated: RecordDoc | null;
    try {
        updated = await record.coll.findOneAndUpdate({
            domainId: input.domainId,
            _id: input.latestRid,
            contest: input.tid,
            pid: input.pid,
            uid: input.uid,
            ...revisionFilter,
        }, {
            $set: {
                manualGrade: nextGrade,
                score: input.score,
                status: STATUS.STATUS_MANUAL_GRADED,
            },
            $unset: { manualPending: '' },
        }, { returnDocument: 'after' });
    } catch (error) {
        logger.error(
            'Manual grade record write failed domain=%s container=%s pid=%d uid=%d rid=%s revision=%d error=%o',
            input.domainId, input.tid, input.pid, input.uid, input.latestRid, currentRevision, error,
        );
        throw error;
    }
    if (!updated) throw new ManualGradeConflictError();
    bus.broadcast('record/change', updated);

    const currentLatest = await latestManualRecordForGrade(input, 'after-record-write');
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
            time: now,
        } as any);
    } catch (error) {
        logger.error(
            'Manual grade audit write failed domain=%s container=%s pid=%d uid=%d rid=%s revision=%d error=%o',
            input.domainId, input.tid, input.pid, input.uid, input.latestRid, nextGrade.revision, error,
        );
        throw error;
    }
    if (!currentLatest?._id.equals(input.latestRid)) throw new ManualGradeConflictError();

    try {
        const projected = await problem.updateManualGradeStatus(
            input.domainId, input.pid, input.uid, input.latestRid, input.score,
        );
        if (!projected) throw new ManualGradeConflictError();
        const contestStatus = await contest.updateStatus(
            input.domainId,
            input.tid,
            input.uid,
            input.latestRid,
            input.pid,
            updated,
        );
        if (!contestStatus) throw new Error('Manual grade contest status projection was not applied');
        const finalLatest = await latestManualRecord(input.domainId, input.tid, input.pid, input.uid);
        if (!finalLatest?._id.equals(input.latestRid)) throw new ManualGradeConflictError();
    } catch (error) {
        logger.error(
            'Manual grade projection failed domain=%s container=%s pid=%d uid=%d rid=%s revision=%d error=%o',
            input.domainId, input.tid, input.pid, input.uid, input.latestRid, nextGrade.revision, error,
        );
        throw error;
    }
    return updated;
}
