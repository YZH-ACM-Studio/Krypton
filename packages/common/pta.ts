import type { ProblemKind } from './problem-kind';

/** Fixed kind numbers: 1 判断 … 8 主观. */
export const PTA_KIND_ORDER: readonly ProblemKind[] = Object.freeze([
    'true_false',
    'single',
    'multi',
    'blank',
    'program_fill',
    'function',
    'programming',
    'subjective',
]);

const PTA_KIND_NAMES = Object.freeze({
    true_false: '判断题',
    single: '单选题',
    multi: '多选题',
    blank: '填空题',
    program_fill: '程序填空题',
    function: '函数题',
    programming: '编程题',
    subjective: '主观题',
} as const satisfies Record<ProblemKind, string>);

const ONE_PER_PAGE_KINDS: ReadonlySet<ProblemKind> = new Set<ProblemKind>([
    'program_fill',
    'function',
    'programming',
]);

function requireKind(kind: ProblemKind): ProblemKind {
    if (!PTA_KIND_ORDER.includes(kind)) throw new TypeError(`Unknown problem kind: ${String(kind)}`);
    return kind;
}

function requireNonNegativeInteger(value: number, name: string): void {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new TypeError(`${name} must be a non-negative integer`);
    }
}

export function ptaNo(kind: ProblemKind): number {
    return PTA_KIND_ORDER.indexOf(requireKind(kind)) + 1;
}

export function ptaKindName(kind: ProblemKind): string {
    return PTA_KIND_NAMES[requireKind(kind)];
}

/** Zero-based index inside the kind: ptaLabel('single', 2) === '2-3'. */
export function ptaLabel(kind: ProblemKind, indexInKind: number): string {
    requireNonNegativeInteger(indexInKind, 'indexInKind');
    return `${ptaNo(kind)}-${indexInKind + 1}`;
}

/** Spreadsheet letters: 0 → A, 25 → Z, 26 → AA. */
export function letterLabel(index: number): string {
    requireNonNegativeInteger(index, 'index');
    let value = index + 1;
    let label = '';
    while (value > 0) {
        value -= 1;
        label = String.fromCharCode(65 + (value % 26)) + label;
        value = Math.floor(value / 26);
    }
    return label;
}

export function isOnePerPageKind(kind: ProblemKind): boolean {
    return ONE_PER_PAGE_KINDS.has(requireKind(kind));
}

export interface PtaItem {
    pid: number;
    kind: ProblemKind;
}

/** Kinds that appear, in PTA_KIND_ORDER; items inside a kind keep input order. */
export function groupByPta<T extends PtaItem>(items: readonly T[]): Array<{ kind: ProblemKind; no: number; items: T[] }> {
    const buckets = new Map<ProblemKind, T[]>();
    for (const item of items) {
        const kind = requireKind(item.kind);
        const bucket = buckets.get(kind);
        if (bucket) bucket.push(item);
        else buckets.set(kind, [item]);
    }
    const groups: Array<{ kind: ProblemKind; no: number; items: T[] }> = [];
    for (const kind of PTA_KIND_ORDER) {
        const grouped = buckets.get(kind);
        if (!grouped) continue;
        groups.push({ kind, no: ptaNo(kind), items: grouped });
    }
    return groups;
}
