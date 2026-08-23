/**
 * Shared TrainingDoc kind helpers for docType 40.
 *
 * New problem sets write `problem_set`. Legacy documents with no kind or
 * `kind:'training'` are read as problem sets. `kind:'course'` is courses only.
 * Unknown kinds fail closed and must not be guessed as either type.
 */
export const COURSE_KIND = 'course' as const;
export const PROBLEM_SET_KIND = 'problem_set' as const;
export const LEGACY_TRAINING_KIND = 'training' as const;

export type WritableTrainingKind = typeof COURSE_KIND | typeof PROBLEM_SET_KIND;
export type StoredTrainingKind = WritableTrainingKind | typeof LEGACY_TRAINING_KIND;

export const PROBLEM_SET_KIND_VALUES = [LEGACY_TRAINING_KIND, PROBLEM_SET_KIND] as const;

export function isCourseKind(kind: unknown): boolean {
    return kind === COURSE_KIND;
}

export function isProblemSetKind(kind: unknown): boolean {
    return kind === undefined || kind === null || kind === LEGACY_TRAINING_KIND || kind === PROBLEM_SET_KIND;
}

export function isKnownTrainingKind(kind: unknown): boolean {
    return isCourseKind(kind) || isProblemSetKind(kind);
}

export function practiceContainerKindOf(kind: unknown): 'course' | 'problemSet' {
    if (isCourseKind(kind)) return 'course';
    if (isProblemSetKind(kind)) return 'problemSet';
    throw new TypeError(`unknown training document kind: ${String(kind)}`);
}

export function resolveWritableTrainingKind(kind: unknown): WritableTrainingKind {
    if (kind === undefined || kind === PROBLEM_SET_KIND) return PROBLEM_SET_KIND;
    if (kind === COURSE_KIND) return COURSE_KIND;
    throw new TypeError(`training document kind cannot be written: ${String(kind)}`);
}

export function problemSetKindClause(): {
    $or: Array<{ kind: { $exists: false } } | { kind: null } | { kind: { $in: readonly ['training', 'problem_set'] } }>;
} {
    return {
        $or: [{ kind: { $exists: false } }, { kind: null }, { kind: { $in: PROBLEM_SET_KIND_VALUES } }],
    };
}

export function courseKindClause(): { kind: typeof COURSE_KIND } {
    return { kind: COURSE_KIND };
}

export function withProblemSetKind<T extends Record<string, unknown>>(filter: T): Record<string, unknown> {
    const clause = problemSetKindClause();
    const keys = Object.keys(filter);
    if (!keys.length) return clause;
    if (keys.some((key) => key.startsWith('$'))) return { $and: [clause, filter] };
    return { ...filter, ...clause };
}
