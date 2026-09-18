import { PROBLEM_KINDS, parseProblemKind, type ProblemKind } from './problem-kind';

export const EXAM_PAPER_HOUR_MS = 3600_000;
export const EXAM_PAPER_FINALIZE_GRACE_MS = 60_000;

export type ExamPaperQuotas = Partial<Record<ProblemKind, number>>;

export interface ExamPaperContestClock {
    beginAt?: unknown;
    endAt?: unknown;
    duration?: unknown;
    examPaperQuotas?: unknown;
    pids?: unknown;
    rule?: unknown;
}

export interface ExamPaperStatusClock {
    startAt?: unknown;
    examPaperPids?: unknown;
    paperFinalizedAt?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidDate(value: unknown): value is Date {
    return value instanceof Date && !Number.isNaN(value.getTime());
}

export function asExamPaperDate(value: unknown): Date | null {
    if (isValidDate(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}

export function normalizeExamPaperPids(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    const out: number[] = [];
    const seen = new Set<number>();
    for (const pid of value) {
        if (typeof pid !== 'number' || !Number.isInteger(pid) || !Number.isSafeInteger(pid) || pid <= 0) continue;
        if (seen.has(pid)) continue;
        seen.add(pid);
        out.push(pid);
    }
    return out;
}

export function readExamPaperQuotas(raw: unknown): ExamPaperQuotas | null {
    if (raw === undefined || raw === null) return null;
    return parseExamPaperQuotas(raw);
}

export function parseExamPaperQuotas(raw: unknown): ExamPaperQuotas {
    if (!isPlainObject(raw)) throw new TypeError('exam_paper_quotas_invalid');
    const keys = Object.keys(raw);
    if (!keys.length) throw new TypeError('exam_paper_quotas_invalid');
    const quotas: ExamPaperQuotas = {};
    for (const key of keys) {
        const kind = parseProblemKind(key);
        const count = raw[key];
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
            throw new TypeError('exam_paper_quotas_invalid');
        }
        quotas[kind] = count;
    }
    return quotas;
}

export function examPaperQuotaTotal(quotas: ExamPaperQuotas): number {
    let total = 0;
    for (const kind of PROBLEM_KINDS) {
        total += quotas[kind] || 0;
    }
    return total;
}

export function examPaperQuotasEqual(left: ExamPaperQuotas | null, right: ExamPaperQuotas | null): boolean {
    if (left === null || right === null) return left === right;
    for (const kind of PROBLEM_KINDS) {
        if ((left[kind] || 0) !== (right[kind] || 0)) return false;
    }
    return true;
}

export function isExamPaperDrawEnabled(tdoc: ExamPaperContestClock): boolean {
    return readExamPaperQuotas(tdoc.examPaperQuotas) !== null;
}

export function examPaperDurationMs(tdoc: ExamPaperContestClock): number | null {
    const duration = tdoc.duration;
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return null;
    return Math.floor(duration * EXAM_PAPER_HOUR_MS);
}

export function canStartExamPaper(tdoc: ExamPaperContestClock, now: Date): boolean {
    const beginAt = asExamPaperDate(tdoc.beginAt);
    const endAt = asExamPaperDate(tdoc.endAt);
    if (!beginAt || !endAt) return false;
    const nowMs = now.getTime();
    if (nowMs < beginAt.getTime() || nowMs > endAt.getTime()) return false;
    const durationMs = examPaperDurationMs(tdoc);
    if (durationMs !== null && nowMs + durationMs > endAt.getTime()) return false;
    return true;
}

export function examPaperPersonalEnd(tdoc: ExamPaperContestClock, tsdoc?: ExamPaperStatusClock | null): Date {
    const endAt = asExamPaperDate(tdoc.endAt);
    if (!endAt) throw new TypeError('exam_paper_end_invalid');
    const durationMs = examPaperDurationMs(tdoc);
    const startAt = asExamPaperDate(tsdoc?.startAt);
    if (durationMs !== null && startAt) return new Date(startAt.getTime() + durationMs);
    return endAt;
}

export function isExamPaperStarted(tsdoc?: ExamPaperStatusClock | null): boolean {
    return asExamPaperDate(tsdoc?.startAt) !== null;
}

export function isExamPaperFinalized(tsdoc?: ExamPaperStatusClock | null): boolean {
    return asExamPaperDate(tsdoc?.paperFinalizedAt) !== null;
}

/** Exam-rule only. Missing or true = students see 对错. false = scores only. Other rules always show. */
export function examShowsVerdict(tdoc: { rule?: unknown; examShowVerdict?: unknown }): boolean {
    if (tdoc.rule !== 'exam') return true;
    return tdoc.examShowVerdict !== false;
}

export function isExamPaperInWindow(tdoc: ExamPaperContestClock, tsdoc: ExamPaperStatusClock | null | undefined, now: Date): boolean {
    if (isExamPaperStarted(tsdoc)) {
        const beginAt = asExamPaperDate(tdoc.beginAt);
        if (beginAt && now.getTime() < beginAt.getTime()) return false;
        return now.getTime() <= examPaperPersonalEnd(tdoc, tsdoc).getTime();
    }
    return canStartExamPaper(tdoc, now);
}

export function isExamPaperWindowClosed(tdoc: ExamPaperContestClock, tsdoc: ExamPaperStatusClock | null | undefined, now: Date): boolean {
    return now.getTime() > examPaperPersonalEnd(tdoc, tsdoc).getTime() + EXAM_PAPER_FINALIZE_GRACE_MS;
}

/** Unstarted students lose the start door after beginAt when canStartExamPaper is already false. */
export function isExamPaperUnstartedClosed(
    tdoc: ExamPaperContestClock,
    tsdoc: ExamPaperStatusClock | null | undefined,
    now: Date,
): boolean {
    if (isExamPaperStarted(tsdoc) || canStartExamPaper(tdoc, now)) return false;
    const beginAt = asExamPaperDate(tdoc.beginAt);
    if (beginAt !== null) return now.getTime() >= beginAt.getTime();
    const endAt = asExamPaperDate(tdoc.endAt);
    return endAt !== null && now.getTime() > endAt.getTime();
}

export function parseFrozenExamPaperPids(raw: unknown, quotas: ExamPaperQuotas): number[] {
    if (!Array.isArray(raw)) throw new TypeError('exam_paper_frozen_invalid');
    const pids = normalizeExamPaperPids(raw);
    if (pids.length !== raw.length) throw new TypeError('exam_paper_frozen_invalid');
    if (pids.length !== examPaperQuotaTotal(quotas)) throw new TypeError('exam_paper_frozen_invalid');
    return pids;
}

export function resolveExamPaperPids(tdoc: ExamPaperContestClock, tsdoc?: ExamPaperStatusClock | null): number[] {
    const quotas = readExamPaperQuotas(tdoc.examPaperQuotas);
    if (quotas === null) return normalizeExamPaperPids(tdoc.pids);
    if (!isExamPaperStarted(tsdoc)) throw new TypeError('exam_paper_not_frozen');
    return parseFrozenExamPaperPids(tsdoc?.examPaperPids, quotas);
}

export function examPaperPidsForCompletion(tdoc: ExamPaperContestClock, tsdoc?: ExamPaperStatusClock | null): number[] {
    const quotas = readExamPaperQuotas(tdoc.examPaperQuotas);
    if (quotas === null) return normalizeExamPaperPids(tdoc.pids);
    try {
        return parseFrozenExamPaperPids(tsdoc?.examPaperPids, quotas);
    } catch {
        return [];
    }
}

export function studentContestProblemPids(
    tdoc: ExamPaperContestClock,
    tsdoc?: ExamPaperStatusClock | null,
    canManageContest = false,
): number[] {
    const pool = Array.isArray(tdoc.pids) ? (tdoc.pids as number[]) : [];
    if (canManageContest || tdoc.rule !== 'exam' || readExamPaperQuotas(tdoc.examPaperQuotas) === null) {
        return pool;
    }
    try {
        return resolveExamPaperPids(tdoc, tsdoc);
    } catch {
        return [];
    }
}

function filterPidKeyedRecord(raw: unknown, visible: Set<number>): Record<string, unknown> | undefined {
    if (!isPlainObject(raw)) return undefined;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (visible.has(Number(key))) out[key] = value;
    }
    return out;
}

export function projectStudentContestTdoc<T extends ExamPaperContestClock>(
    tdoc: T,
    tsdoc?: ExamPaperStatusClock | null,
    canManageContest = false,
): T {
    if (canManageContest || tdoc.rule !== 'exam' || readExamPaperQuotas(tdoc.examPaperQuotas) === null) {
        return tdoc;
    }
    const pids = studentContestProblemPids(tdoc, tsdoc, false);
    const visible = new Set(pids);
    const next = { ...tdoc, pids };
    const score = filterPidKeyedRecord((tdoc as { score?: unknown }).score, visible);
    if (score !== undefined) (next as { score?: unknown }).score = score;
    const balloon = filterPidKeyedRecord((tdoc as { balloon?: unknown }).balloon, visible);
    if (balloon !== undefined) (next as { balloon?: unknown }).balloon = balloon;
    const autoHideProblemPids = (tdoc as { autoHideProblemPids?: unknown }).autoHideProblemPids;
    if (Array.isArray(autoHideProblemPids)) {
        (next as { autoHideProblemPids?: unknown }).autoHideProblemPids = autoHideProblemPids.filter((pid) => visible.has(Number(pid)));
    }
    const autoHidePendingPids = (tdoc as { autoHidePendingPids?: unknown }).autoHidePendingPids;
    if (Array.isArray(autoHidePendingPids)) {
        (next as { autoHidePendingPids?: unknown }).autoHidePendingPids = autoHidePendingPids.filter((pid) => visible.has(Number(pid)));
    }
    return next;
}

export function countExamPaperPoolByKind(
    poolPids: readonly number[],
    kinds: ReadonlyMap<number, ProblemKind>,
): Record<ProblemKind, number> {
    const counts = Object.fromEntries(PROBLEM_KINDS.map((kind) => [kind, 0])) as Record<ProblemKind, number>;
    for (const pid of poolPids) {
        const kind = kinds.get(pid);
        if (!kind) throw new TypeError('exam_paper_pool_kind_missing');
        counts[kind] += 1;
    }
    return counts;
}

export function assertExamPaperPoolSatisfiesQuotas(
    poolPids: readonly number[],
    kinds: ReadonlyMap<number, ProblemKind>,
    quotas: ExamPaperQuotas,
): void {
    const counts = countExamPaperPoolByKind(poolPids, kinds);
    for (const kind of PROBLEM_KINDS) {
        const need = quotas[kind] || 0;
        if (need > 0 && counts[kind] < need) throw new TypeError('exam_paper_pool_short');
    }
}

export function drawExamPaperPids(
    poolPids: readonly number[],
    kinds: ReadonlyMap<number, ProblemKind>,
    quotas: ExamPaperQuotas,
    randomInt: (maxExclusive: number) => number,
): number[] {
    assertExamPaperPoolSatisfiesQuotas(poolPids, kinds, quotas);
    const buckets = Object.fromEntries(PROBLEM_KINDS.map((kind) => [kind, [] as number[]])) as Record<ProblemKind, number[]>;
    for (const pid of poolPids) {
        const kind = kinds.get(pid);
        if (!kind) throw new TypeError('exam_paper_pool_kind_missing');
        buckets[kind].push(pid);
    }
    const drawn: number[] = [];
    for (const kind of PROBLEM_KINDS) {
        const need = quotas[kind] || 0;
        if (!need) continue;
        drawn.push(...pickWithoutReplacement(buckets[kind], need, randomInt));
    }
    return drawn;
}

function pickWithoutReplacement<T>(items: readonly T[], count: number, randomInt: (maxExclusive: number) => number): T[] {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = randomInt(i + 1);
        if (!Number.isInteger(j) || j < 0 || j > i) throw new TypeError('exam_paper_rng_invalid');
        const current = copy[i];
        const swap = copy[j];
        if (current === undefined || swap === undefined) throw new TypeError('exam_paper_rng_invalid');
        copy[i] = swap;
        copy[j] = current;
    }
    return copy.slice(0, count);
}
