import { randomInt } from 'node:crypto';
import { ObjectId } from 'mongodb';
import {
    drawExamPaperPids as drawExamPaperPidsWithRng,
    type ExamPaperQuotas,
    type ProblemKind,
} from '@hydrooj/common';

export {
    EXAM_ATTEMPT_PENDING_STATUSES,
    EXAM_PAPER_FINALIZE_GRACE_MS,
    EXAM_PAPER_HOUR_MS,
    asExamPaperDate,
    assertExamPaperPoolSatisfiesQuotas,
    assertExamPassScoreFitsPaper,
    canOpenExamPaperAfterFail,
    canRetakeExamPaper,
    canStartExamPaper,
    countExamPaperPoolByKind,
    examAttemptScore,
    examAttemptsUsed,
    examDefinitePaperMax,
    examDrawUnitContributions,
    examPaperContributions,
    examPaperDurationMs,
    examPaperPidsForCompletion,
    assignContestProblemScores,
    contestProblemScoreWeight,
    examScoresForPool,
    examShowsVerdict,
    examPaperPersonalEnd,
    isExamAttemptJudgePending,
    isExamAttemptPassed,
    minContributionsToReach,
    minProblemsToPass,
    minRemainingProblemsToPass,
    parseContestProblemScores,
    parseExamAttemptLimit,
    parseExamPassScore,
    readExamAttemptLimit,
    readExamPassScore,
    scaleByContestProblemScore,
    examPaperQuotaTotal,
    examPaperQuotasEqual,
    isExamPaperDrawEnabled,
    isExamPaperFinalized,
    isExamPaperInWindow,
    isExamPaperStarted,
    isExamPaperUnstartedClosed,
    isExamPaperWindowClosed,
    normalizeExamPaperPids,
    parseExamPaperQuotas,
    parseFrozenExamPaperPids,
    projectStudentContestTdoc,
    readExamPaperQuotas,
    resolveExamPaperPids,
    studentContestProblemPids,
} from '@hydrooj/common';
export type { ExamPaperContestClock, ExamPaperQuotas, ExamPaperStatusClock } from '@hydrooj/common';

export function examStatusAcceptsJournalRid(tsdoc: { examJournalAfter?: unknown } | null | undefined, rid: ObjectId): boolean {
    const floor = tsdoc?.examJournalAfter;
    if (!(floor instanceof ObjectId)) return true;
    return rid.toHexString() > floor.toHexString();
}

export function examJournalFloorFilter(tsdoc: { examJournalAfter?: unknown } | null | undefined): Record<string, unknown> {
    const floor = tsdoc?.examJournalAfter;
    if (floor instanceof ObjectId) return { examJournalAfter: floor };
    return { examJournalAfter: { $exists: false } };
}

export function drawExamPaperPids(
    poolPids: readonly number[],
    kinds: ReadonlyMap<number, ProblemKind>,
    quotas: ExamPaperQuotas,
    randomIntFn: (maxExclusive: number) => number = (maxExclusive) => randomInt(maxExclusive),
): number[] {
    return drawExamPaperPidsWithRng(poolPids, kinds, quotas, randomIntFn);
}
