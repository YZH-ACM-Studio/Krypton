import type { AnswerEntry } from './types';

export type ObjectiveOutcome = 'correct' | 'partial' | 'wrong';

export interface ObjectiveGrade {
    outcome: ObjectiveOutcome;
    score: number;
}

function blankText(value: unknown): string {
    return String(value ?? '')
        .replace(/\r\n/g, '\n')
        .trim();
}

/**
 * Shared objective grading semantics for the judge and the exam draft UI.
 * Missing partialCreditPercent preserves the legacy objective-paper 50% rule;
 * every P3.9 multi problem persists the field explicitly (default 0).
 */
export function gradeObjectiveAnswer(entry: AnswerEntry | unknown, submitted: unknown): ObjectiveGrade {
    if (!Array.isArray(entry)) return { outcome: 'wrong', score: 0 };
    const expected = entry[0];
    const fullScore = Number(entry[1]) || 0;
    const meta = entry.length >= 3 && entry[2] && typeof entry[2] === 'object' ? entry[2] : {};
    if (Array.isArray(expected)) {
        const expectedSet = new Set(expected.map(String));
        const submittedValues = Array.isArray(submitted)
            ? submitted.map(String)
            : submitted === undefined || submitted === null || submitted === ''
              ? []
              : [String(submitted)];
        const submittedSet = new Set(submittedValues);
        if (submittedSet.size === expectedSet.size && expectedSet.isSupersetOf(submittedSet)) {
            return { outcome: 'correct', score: fullScore };
        }
        if (!submittedSet.size || [...submittedSet].some((value) => !expectedSet.has(value))) {
            return { outcome: 'wrong', score: 0 };
        }
        const configured = Number((meta as any).partialCreditPercent);
        const percent = Number.isSafeInteger(configured) && configured >= 0 && configured <= 100 ? configured : 50;
        return { outcome: 'partial', score: Math.floor((fullScore * percent) / 100) };
    }
    if (Array.isArray(submitted)) return { outcome: 'wrong', score: 0 };
    const got = submitted;
    const matches = ['blank', 'fill_program'].includes((meta as any).kind)
        ? blankText(expected) === blankText(got)
        : String(expected).trim() === String(got ?? '').trim();
    return matches ? { outcome: 'correct', score: fullScore } : { outcome: 'wrong', score: 0 };
}
