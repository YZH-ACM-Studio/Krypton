import { examShowsVerdict, homeworkKindRevealsVerdict, type ProblemKind } from '@hydrooj/common';
import { concealObjectiveRecord } from './homework-objective-verdict';
import { storedSetConfigOrNull } from './set-publication';

interface ExamClock { rule?: unknown; endAt?: unknown; examShowVerdict?: unknown }

function examStillRunning(tdoc: ExamClock): boolean {
    if (storedSetConfigOrNull(tdoc)) return false;
    if (tdoc.rule !== 'exam') return false;
    if (!(tdoc.endAt instanceof Date) || Number.isNaN(tdoc.endAt.getTime())) return true;
    return Date.now() < tdoc.endAt.getTime();
}

/**
 * Whole-paper hiding applies to objective kinds only.
 * Function and programming records keep status, score, and test points while the exam is open.
 */
export function projectLiveExamRecord<T extends { status?: number; score?: number }>(
    tdoc: ExamClock,
    rdoc: T,
    kind: ProblemKind | null,
): T {
    if (!examStillRunning(tdoc) || examShowsVerdict(tdoc)) return rdoc;
    if (kind && homeworkKindRevealsVerdict(kind)) return rdoc;
    return concealObjectiveRecord(rdoc);
}
