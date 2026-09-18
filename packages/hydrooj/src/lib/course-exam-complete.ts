/**
 * Course-exam completion facts used by file-collect's optional 考完 gate.
 *
 * Canonical: ContestStatus.paperFinalizedAt written ONLY by finalizePaperForUser.
 * After the exam-paper window + COURSE_EXAM_FINALIZE_GRACE_MS, the read path may
 * settle an already-attended incomplete paper by calling that same function.
 * Fallback: exam-rule journal covers examPaperPidsForCompletion (shared tdoc.pids
 * when draw is off; frozen personal pids when draw is on). Draw-on without a
 * frozen paper is an empty paper and is not complete.
 *
 * If `examPassScore ≥ 1`, 考完 also requires judging to settle and the current
 * weighted total to reach that line. Missing/0 pass score keeps the finalize-only
 * meaning. Exhausted failing attempts are not complete.
 */

import {
    examAttemptScore,
    examPaperPidsForCompletion,
    isExamAttemptJudgePending,
    readExamPassScore,
} from './exam-paper';

export const COURSE_EXAM_FINALIZE_GRACE_MS = 60_000;

export type CourseExamCompletionLockKind = 'none' | 'open' | 'never_attended_closed' | 'closed_incomplete' | 'missing_contest';

export interface CourseExamCompletionResolution {
    complete: boolean;
    attended: boolean;
    windowClosed: boolean;
    examHref?: string;
    lockKind: CourseExamCompletionLockKind;
}

export interface CourseExamCompleteContest {
    rule?: unknown;
    pids?: unknown;
    beginAt?: unknown;
    endAt?: unknown;
    duration?: unknown;
    examPaperQuotas?: unknown;
    examPassScore?: unknown;
    examAttemptLimit?: unknown;
}

export interface CourseExamCompleteStatus {
    paperFinalizedAt?: unknown;
    journal?: unknown;
    attend?: unknown;
    startAt?: unknown;
    examPaperPids?: unknown;
    examAttemptsUsed?: unknown;
    score?: unknown;
}

function isValidDate(value: unknown): value is Date {
    return value instanceof Date && !Number.isNaN(value.getTime());
}

function journalPids(tsdoc: CourseExamCompleteStatus): Set<number> {
    const seen = new Set<number>();
    if (!Array.isArray(tsdoc.journal)) return seen;
    for (const row of tsdoc.journal) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        const pid = (row as { pid?: unknown }).pid;
        if (typeof pid === 'number' && Number.isInteger(pid) && Number.isSafeInteger(pid)) seen.add(pid);
    }
    return seen;
}

export function isCourseExamCompleteFromStatus(
    tdoc: CourseExamCompleteContest | null | undefined,
    tsdoc: CourseExamCompleteStatus | null | undefined,
): boolean {
    if (!tdoc || tdoc.rule !== 'exam') return false;
    if (!tsdoc) return false;
    const pids = examPaperPidsForCompletion(tdoc, tsdoc);
    if (pids.length === 0) return false;
    const seen = journalPids(tsdoc);
    const pass = readExamPassScore(tdoc);
    if (pass !== null) {
        if (!isValidDate(tsdoc.paperFinalizedAt) || isExamAttemptJudgePending(tsdoc)) return false;
        return examAttemptScore(tsdoc) >= pass;
    }
    if (isValidDate(tsdoc.paperFinalizedAt)) return true;
    return pids.every((pid) => seen.has(pid));
}

export function isCourseExamEnded(endAt: unknown, now: Date): boolean {
    if (!isValidDate(endAt) || !isValidDate(now)) return false;
    return now.getTime() >= endAt.getTime();
}

export function isCourseExamWindowClosed(endAt: unknown, now: Date): boolean {
    if (!isValidDate(endAt) || !isValidDate(now)) return false;
    return now.getTime() > endAt.getTime() + COURSE_EXAM_FINALIZE_GRACE_MS;
}

export function shouldSettleCourseExam(params: {
    complete: boolean;
    attend: boolean;
    started: boolean;
    windowClosed: boolean;
    examRule: boolean;
    hasPids: boolean;
    finalized?: boolean;
}): boolean {
    return !params.complete && params.finalized !== true && params.examRule && params.attend && params.started && params.hasPids && params.windowClosed;
}

export function buildCourseExamCompletionResolution(params: {
    missingContest?: boolean;
    complete: boolean;
    attended: boolean;
    windowClosed: boolean;
    ended?: boolean;
    canRetake?: boolean;
    contestId: { toString(): string } | string;
}): CourseExamCompletionResolution {
    if (params.missingContest) {
        return {
            complete: false,
            attended: false,
            windowClosed: false,
            lockKind: 'missing_contest',
        };
    }
    const enterClosed = params.attended
        ? params.windowClosed
        : params.ended === true || params.windowClosed;
    const openForRetake = params.canRetake === true;
    const examHref = !params.complete && (openForRetake || !enterClosed)
        ? `/exam-mode/${params.contestId}`
        : undefined;
    const lockKind: CourseExamCompletionLockKind = params.complete
        ? 'none'
        : openForRetake || !enterClosed
            ? 'open'
            : params.attended
                ? 'closed_incomplete'
                : 'never_attended_closed';
    return {
        complete: params.complete,
        attended: params.attended,
        windowClosed: params.windowClosed,
        ...(examHref === undefined ? {} : { examHref }),
        lockKind,
    };
}
