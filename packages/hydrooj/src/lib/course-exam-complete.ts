/**
 * Course-exam completion facts used by file-collect's optional 心得 gate.
 *
 * Canonical: ContestStatus.paperFinalizedAt written by paper finalize.
 * Fallback: exam-rule journal covers every pid on the contest (pre-field students).
 */

export interface CourseExamCompleteContest {
    rule?: unknown;
    pids?: unknown;
}

export interface CourseExamCompleteStatus {
    paperFinalizedAt?: unknown;
    journal?: unknown;
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
    if (isValidDate(tsdoc.paperFinalizedAt)) return true;
    const pids = contestPids(tdoc);
    if (pids.length === 0) return false;
    const seen = journalPids(tsdoc);
    return pids.every((pid) => seen.has(pid));
}
