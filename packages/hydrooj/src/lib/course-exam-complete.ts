/**
 * Course-exam completion facts used by file-collect's optional 考完 gate.
 *
 * Canonical: ContestStatus.paperFinalizedAt written ONLY by finalizePaperForUser.
 * After endAt + COURSE_EXAM_FINALIZE_GRACE_MS, the read path may settle an
 * already-attended incomplete paper by calling that same function.
 * Fallback: exam-rule journal covers every pid on the contest (pre-field students).
 */

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
    endAt?: unknown;
}

export interface CourseExamCompleteStatus {
    paperFinalizedAt?: unknown;
    journal?: unknown;
    attend?: unknown;
    startAt?: unknown;
}

function isValidDate(value: unknown): value is Date {
    return value instanceof Date && !Number.isNaN(value.getTime());
}

function contestPids(tdoc: CourseExamCompleteContest): number[] {
    if (!Array.isArray(tdoc.pids)) return [];
    const out: number[] = [];
    const seen = new Set<number>();
    for (const pid of tdoc.pids) {
        if (typeof pid !== 'number' || !Number.isInteger(pid) || !Number.isSafeInteger(pid)) continue;
        if (seen.has(pid)) continue;
        seen.add(pid);
        out.push(pid);
    }
    return out;
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
    const pids = contestPids(tdoc);
    if (pids.length === 0) return false;
    if (isValidDate(tsdoc.paperFinalizedAt)) return true;
    const seen = journalPids(tsdoc);
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
}): boolean {
    return !params.complete && params.examRule && params.attend && params.started && params.hasPids && params.windowClosed;
}

export function buildCourseExamCompletionResolution(params: {
    missingContest?: boolean;
    complete: boolean;
    attended: boolean;
    windowClosed: boolean;
    ended?: boolean;
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
    const examHref = !params.complete && !enterClosed
        ? `/exam-mode/${params.contestId}`
        : undefined;
    const lockKind: CourseExamCompletionLockKind = params.complete
        ? 'none'
        : !enterClosed
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
