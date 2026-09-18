import { randomInt } from 'node:crypto';
import {
    drawExamPaperPids as drawExamPaperPidsWithRng,
    type ExamPaperQuotas,
    type ProblemKind,
} from '@hydrooj/common';

export {
    EXAM_PAPER_FINALIZE_GRACE_MS,
    EXAM_PAPER_HOUR_MS,
    asExamPaperDate,
    assertExamPaperPoolSatisfiesQuotas,
    canStartExamPaper,
    countExamPaperPoolByKind,
    examPaperDurationMs,
    examPaperPidsForCompletion,
    examShowsVerdict,
    examPaperPersonalEnd,
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

export function drawExamPaperPids(
    poolPids: readonly number[],
    kinds: ReadonlyMap<number, ProblemKind>,
    quotas: ExamPaperQuotas,
    randomIntFn: (maxExclusive: number) => number = (maxExclusive) => randomInt(maxExclusive),
): number[] {
    return drawExamPaperPidsWithRng(poolPids, kinds, quotas, randomIntFn);
}
