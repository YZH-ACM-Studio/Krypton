/**
 * Exam create/edit defaults and persisted hidden flags.
 * Wall-clock window POSTs as `duration`. Personal clock POSTs as `contestDuration`
 * and is stored on `tdoc.duration` (already used by exam-paper).
 */

export const EXAM_CREATE_WALL_CLOCK_HOURS = 2;

export const EXAM_CREATE_DEFAULTS = {
    rated: false,
    autoHide: false,
    allowViewCode: false,
    allowVirtual: false,
    keepScoreboardHidden: false,
    allowPrint: false,
    vigilEnabled: false,
    entryMode: 'open' as const,
    participationMode: 'individual' as const,
};

export type ExamHiddenFlags = {
    rated: boolean;
    autoHide: boolean;
    allowViewCode: boolean;
    allowVirtual: boolean | null;
    keepScoreboardHidden: boolean;
    allowPrint: boolean;
    vigilEnabled: boolean;
    entryMode: 'open' | 'client_required';
    participationMode: 'individual';
};

export function readCreateExamRuleQuery(search: string = typeof window === 'undefined' ? '' : window.location.search): boolean {
    return new URLSearchParams(search).get('rule') === 'exam';
}

export function initialContestEditRule(tdocRule: unknown, search?: string): string {
    if (typeof tdocRule === 'string' && tdocRule) return tdocRule;
    return readCreateExamRuleQuery(search) ? 'exam' : 'acm';
}

export function examHiddenFlags(
    tdoc: {
        rated?: boolean;
        autoHide?: boolean;
        allowViewCode?: boolean;
        allowVirtual?: boolean;
        keepScoreboardHidden?: boolean;
        allowPrint?: boolean;
        vigilEnabled?: boolean;
        entryMode?: 'open' | 'client_required';
    },
    isEdit: boolean,
): ExamHiddenFlags {
    if (!isEdit) {
        return {
            ...EXAM_CREATE_DEFAULTS,
            allowVirtual: false,
        };
    }
    return {
        rated: !!tdoc.rated,
        autoHide: !!tdoc.autoHide,
        allowViewCode: !!tdoc.allowViewCode,
        allowVirtual: tdoc.allowVirtual == null ? null : !!tdoc.allowVirtual,
        keepScoreboardHidden: !!tdoc.keepScoreboardHidden,
        allowPrint: !!tdoc.allowPrint,
        vigilEnabled: !!tdoc.vigilEnabled,
        entryMode: tdoc.entryMode === 'client_required' ? 'client_required' : 'open',
        participationMode: 'individual',
    };
}
