import { ObjectId } from 'mongodb';
import type { roundTotal, StoredRound } from '@hydrooj/common';

export interface SetScoreDetail {
    pid: number;
    score: number;
    status: number;
    acceptedAt?: Date | null;
    rid?: ObjectId;
    penalty?: number;
    real?: number;
    naccept?: number;
}

export interface ScoredSetRound extends StoredRound {
    _id: ObjectId;
    detail?: Record<number, SetScoreDetail>;
    scoreRevision?: number;
    scoreDirty?: boolean;
    statusDirty?: boolean;
}

export function setRoundDetail(scored: ReturnType<typeof roundTotal>): Record<number, SetScoreDetail> {
    return Object.fromEntries(scored.problems.map((problem) => [problem.pid, {
        pid: problem.pid,
        score: problem.score,
        status: problem.status,
        acceptedAt: problem.acceptedAt,
        ...(problem.recordId === undefined ? {} : { rid: new ObjectId(problem.recordId) }),
        ...(problem.penaltySeconds === undefined ? {} : { penalty: problem.penaltySeconds }),
        ...(problem.elapsedSeconds === undefined ? {} : { real: problem.elapsedSeconds }),
        ...(problem.wrongAttempts === undefined ? {} : { naccept: problem.wrongAttempts }),
    }]));
}

export function setParticipantProjection(round: ScoredSetRound | null, revision: number) {
    const detail = round?.detail ?? {};
    return {
        score: round?.total ?? 0,
        ...(round?.maxPoints != null ? { maxPoints: round.maxPoints } : {}),
        accept: round?.accept ?? 0,
        time: round?.penaltySeconds ?? 0,
        detail,
        display: { ...detail },
        setRoundId: round?._id ?? null,
        setRoundNo: round?.roundNo ?? null,
        setRoundClosedAt: round?.closedAt ?? null,
        setScoreRevision: round?.scoreRevision ?? revision,
        setJudgePending: round?.judgePending === true,
    };
}

export type SetParticipantProjection = ReturnType<typeof setParticipantProjection>;
