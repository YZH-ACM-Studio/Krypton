import type { ProblemKind } from './problem-kind';

export const TEACH_TYPES = Object.freeze(['practice', 'homework', 'exam', 'acm', 'oi'] as const);
export type TeachType = (typeof TEACH_TYPES)[number];
export type TeachDocKind = 'contest' | 'training';
export type TeachStatus = 'upcoming' | 'running' | 'ended' | 'open';

export const TEACH_TABS = Object.freeze([
    'overview',
    'problems',
    'students',
    'settings',
    'grades',
    'records',
    'advanced',
] as const);
export type TeachTab = (typeof TEACH_TABS)[number];

/** Kind-tab and in-group order (P11). Same sequence as the exam paper shell after alias folding. */
export const TEACH_KIND_ORDER: readonly ProblemKind[] = Object.freeze([
    'true_false',
    'single',
    'multi',
    'blank',
    'program_fill',
    'subjective',
    'function',
    'programming',
]);

const PRACTICE_KINDS: readonly ProblemKind[] = Object.freeze(
    TEACH_KIND_ORDER.filter((kind) => kind !== 'subjective'),
);
const PROGRAMMING_KINDS: readonly ProblemKind[] = Object.freeze([
    'program_fill',
    'function',
    'programming',
] as const satisfies readonly ProblemKind[]);

/** D25 compatibility table. Each list stays in TEACH_KIND_ORDER. */
export const TEACH_ALLOWED_KINDS: Readonly<Record<TeachType, readonly ProblemKind[]>> = Object.freeze({
    practice: PRACTICE_KINDS,
    homework: TEACH_KIND_ORDER,
    exam: TEACH_KIND_ORDER,
    acm: PROGRAMMING_KINDS,
    oi: PROGRAMMING_KINDS,
});

/** Contest rules that store per-problem scores (P3). */
export const TEACH_SCORED_CONTEST_RULES: readonly string[] = Object.freeze([
    'exam',
    'oi',
    'ioi',
    'strictioi',
]);

const OI_CONTEST_RULES: readonly string[] = Object.freeze(['oi', 'ioi', 'strictioi', 'ledo']);

function isListed(list: readonly string[], value: unknown): value is string {
    return typeof value === 'string' && list.includes(value);
}

function isTeachType(value: unknown): value is TeachType {
    return isListed(TEACH_TYPES, value);
}

function isTeachTab(value: unknown): value is TeachTab {
    return isListed(TEACH_TABS, value);
}

export function parseTeachType(value: unknown): TeachType {
    if (isTeachType(value)) return value;
    throw new TypeError('teach_type_invalid');
}

export function teachDocKind(type: TeachType): TeachDocKind {
    return parseTeachType(type) === 'practice' ? 'training' : 'contest';
}

export function teachTypeOfContestRule(rule: unknown): TeachType {
    if (rule === 'homework' || rule === 'exam' || rule === 'acm') return rule;
    if (isListed(OI_CONTEST_RULES, rule)) return 'oi';
    throw new TypeError('teach_rule_unsupported');
}

export function isTeachKindAllowed(type: TeachType, kind: ProblemKind): boolean {
    return TEACH_ALLOWED_KINDS[parseTeachType(type)].includes(kind);
}

export function disallowedTeachKinds(type: TeachType): ProblemKind[] {
    const allowed = new Set<ProblemKind>(TEACH_ALLOWED_KINDS[parseTeachType(type)]);
    return TEACH_KIND_ORDER.filter((kind) => !allowed.has(kind));
}

export function isTeachGroupedByKind(type: TeachType): boolean {
    const parsed = parseTeachType(type);
    return parsed === 'homework' || parsed === 'exam';
}

export function teachTabsFor(type: TeachType): TeachTab[] {
    if (parseTeachType(type) === 'practice') return TEACH_TABS.filter((tab) => tab !== 'records');
    return [...TEACH_TABS];
}

export function parseTeachTab(value: unknown, type: TeachType): TeachTab {
    const parsed = parseTeachType(type);
    if (!isTeachTab(value)) return 'overview';
    if (parsed === 'practice' && value === 'records') return 'overview';
    return value;
}

function parseWindowInstant(value: unknown): number {
    if (value instanceof Date) {
        const time = value.getTime();
        if (Number.isNaN(time)) throw new TypeError('teach_window_invalid');
        return time;
    }
    if (typeof value === 'string') {
        const time = new Date(value).getTime();
        if (Number.isNaN(time)) throw new TypeError('teach_window_invalid');
        return time;
    }
    throw new TypeError('teach_window_invalid');
}

function parseCallerClock(now: Date): number {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('teach_window_invalid');
    return now.getTime();
}

export function teachStatusOf(
    input: { type: TeachType; beginAt?: Date | string | null; endAt?: Date | string | null },
    now: Date,
): TeachStatus {
    const type = parseTeachType(input?.type);
    // Practice has no window. Invalid dates must not change that.
    if (type === 'practice') return 'open';
    const current = parseCallerClock(now);
    const beginAt = parseWindowInstant(input.beginAt);
    const endAt = parseWindowInstant(input.endAt);
    if (beginAt > current) return 'upcoming';
    if (current < endAt) return 'running';
    return 'ended';
}

export function teachPath(type: TeachType, id: string, tab?: TeachTab): string {
    const path = `/teach/${parseTeachType(type)}/${id}`;
    if (tab === undefined || tab === 'overview') return path;
    return `${path}?tab=${tab}`;
}

export function teachComposePath(type: TeachType, id: string): string {
    return `/teach/${parseTeachType(type)}/${id}/compose`;
}
