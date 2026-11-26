import yaml from 'js-yaml';
import { localizedErrorText, ValidationError } from '../error';

export interface HomeworkKindDraft {
    answers: Record<string, string | string[]> | null;
    submittedAnswers: Record<string, string | string[]> | null;
}

export interface HomeworkKindSubmission {
    pid: number;
    answers: Record<string, string | string[]>;
    code: string;
    manual: boolean;
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) {
        const items = value.map((item) => canonicalize(item));
        items.sort((left, right) => {
            const a = JSON.stringify(left);
            const b = JSON.stringify(right);
            if (a < b) return -1;
            if (a > b) return 1;
            return 0;
        });
        return items;
    }
    if (value !== null && typeof value === 'object') {
        const source = value as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(source).sort()) sorted[key] = canonicalize(source[key]);
        return sorted;
    }
    return value;
}

/** Key-sorted JSON. Array elements are sorted so reordered multi-select answers compare equal. */
export function canonicalJson(value: unknown): string {
    const text = JSON.stringify(canonicalize(value));
    if (typeof text !== 'string') throw new TypeError('canonicalJson cannot encode this value');
    return text;
}

function hasAnswers(answers: Record<string, string | string[]> | null): answers is Record<string, string | string[]> {
    return !!answers && !Array.isArray(answers) && Object.keys(answers).length > 0;
}

function subjectiveCode(answers: Record<string, string | string[]>): string {
    const main = answers.main;
    if (main !== undefined && typeof main !== 'string') {
        throw new ValidationError('answer', null, localizedErrorText`主观题答案必须是文本`);
    }
    return typeof main === 'string' ? main : '';
}

/**
 * Homework problems of `kind` whose draft differs from the last kind submit.
 * Objective code is `yaml.dump(answers)`; a subjective answer is `answers.main` unchanged.
 */
export function selectKindSubmissions(input: {
    pids: readonly number[];
    kindOf: (pid: number) => string;
    drafts: ReadonlyMap<number, HomeworkKindDraft>;
    kind: string;
}): HomeworkKindSubmission[] {
    const selected: HomeworkKindSubmission[] = [];
    for (const pid of input.pids) {
        if (input.kindOf(pid) !== input.kind) continue;
        const draft = input.drafts.get(pid);
        if (!draft || !hasAnswers(draft.answers)) continue;
        if (canonicalJson(draft.answers) === canonicalJson(draft.submittedAnswers ?? null)) continue;
        const manual = input.kind === 'subjective';
        selected.push({
            pid,
            answers: draft.answers,
            code: manual ? subjectiveCode(draft.answers) : yaml.dump(draft.answers),
            manual,
        });
    }
    return selected;
}
