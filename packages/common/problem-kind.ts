export const PROBLEM_KIND_TO_SLUG = {
    programming: 'programming',
    single: 'single',
    multi: 'multi',
    true_false: 'true-false',
    blank: 'blank',
    subjective: 'subjective',
    program_fill: 'program-fill',
    function: 'function',
} as const;

export type ProblemKind = keyof typeof PROBLEM_KIND_TO_SLUG;
export type ProblemKindSlug = typeof PROBLEM_KIND_TO_SLUG[ProblemKind];

export const PROBLEM_KINDS = Object.freeze(Object.keys(PROBLEM_KIND_TO_SLUG) as ProblemKind[]);
export const PROBLEM_KIND_SLUGS = Object.freeze(Object.values(PROBLEM_KIND_TO_SLUG) as ProblemKindSlug[]);

const PROBLEM_SLUG_TO_KIND = Object.freeze(Object.fromEntries(
    Object.entries(PROBLEM_KIND_TO_SLUG).map(([kind, slug]) => [slug, kind]),
) as Record<ProblemKindSlug, ProblemKind>);

export function parseProblemKind(value: unknown): ProblemKind {
    if (typeof value === 'string' && Object.hasOwn(PROBLEM_KIND_TO_SLUG, value)) return value as ProblemKind;
    throw new TypeError(`Unknown problem kind: ${String(value)}`);
}

export function parseProblemKindSlug(value: unknown): ProblemKind {
    if (typeof value === 'string' && Object.hasOwn(PROBLEM_SLUG_TO_KIND, value)) {
        return PROBLEM_SLUG_TO_KIND[value as ProblemKindSlug];
    }
    throw new TypeError(`Unknown problem kind slug: ${String(value)}`);
}

export function problemKindToSlug(value: ProblemKind): ProblemKindSlug {
    return PROBLEM_KIND_TO_SLUG[parseProblemKind(value)];
}

/** Missing means a legacy programming problem. Unknown explicit values are corrupt and fail fast. */
export function effectiveProblemKind(doc: { problemKind?: unknown }): ProblemKind {
    return doc.problemKind === undefined ? 'programming' : parseProblemKind(doc.problemKind);
}
