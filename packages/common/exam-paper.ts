import { PROBLEM_KINDS, parseProblemKind, type ProblemKind } from './problem-kind';
import { STATUS } from './status';

export const EXAM_PAPER_HOUR_MS = 3600_000;
export const EXAM_PAPER_FINALIZE_GRACE_MS = 60_000;

export type ExamPaperQuotas = Partial<Record<ProblemKind, number>>;

export interface ExamPaperContestClock {
    beginAt?: unknown;
    endAt?: unknown;
    duration?: unknown;
    examPaperQuotas?: unknown;
    examPassScore?: unknown;
    examAttemptLimit?: unknown;
    pids?: unknown;
    rule?: unknown;
    score?: unknown;
}

export interface ExamPaperStatusClock {
    startAt?: unknown;
    examPaperPids?: unknown;
    paperFinalizedAt?: unknown;
    examAttemptsUsed?: unknown;
    journal?: unknown;
    score?: unknown;
}

export const EXAM_ATTEMPT_PENDING_STATUSES = [
    STATUS.STATUS_WAITING,
    STATUS.STATUS_JUDGING,
    STATUS.STATUS_COMPILING,
    STATUS.STATUS_FETCHED,
] as const;

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

/** Contest-scoped weight. Missing or invalid = 100. Does not read the problem bank. */
export function contestProblemScoreWeight(tdoc: { score?: unknown }, pid: number): number {
    if (!Number.isInteger(pid) || pid <= 0) return 100;
    if (!isPlainObject(tdoc.score)) return 100;
    const raw = tdoc.score[String(pid)];
    const weight = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(weight) || weight <= 0) return 100;
    return weight;
}

export function scaleByContestProblemScore(tdoc: { score?: unknown }, pid: number, baseScore: number): number {
    if (typeof baseScore !== 'number' || !Number.isFinite(baseScore)) return 0;
    return (contestProblemScoreWeight(tdoc, pid) * baseScore) / 100;
}

export function parseContestProblemScores(raw: unknown): Record<number, number> {
    if (!isPlainObject(raw)) throw new TypeError('contest_score_map');
    const out: Record<number, number> = {};
    for (const [key, value] of Object.entries(raw)) {
        const pid = Number(key);
        if (!Number.isInteger(pid) || pid <= 0 || String(pid) !== key) throw new TypeError('contest_score_map');
        if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isSafeInteger(value) || value < 1) {
            throw new TypeError('contest_score_value');
        }
        out[pid] = value;
    }
    return out;
}

export function examScoresForPool(map: Record<number, number>, poolPids: readonly number[]): Record<number, number> {
    const allowed = new Set(normalizeExamPaperPids(poolPids));
    for (const pid of Object.keys(map).map(Number)) {
        if (!allowed.has(pid)) throw new TypeError('contest_score_pids');
    }
    const next: Record<number, number> = {};
    for (const pid of normalizeExamPaperPids(poolPids)) {
        next[pid] = map[pid] ?? 100;
    }
    return next;
}

export function assignContestProblemScores(
    existing: unknown,
    contestPids: readonly number[],
    selected: readonly number[],
    score: number,
): Record<number, number> {
    if (!Number.isInteger(score) || !Number.isSafeInteger(score) || score < 1) {
        throw new TypeError('contest_score_value');
    }
    const allowed = new Set(normalizeExamPaperPids(contestPids));
    if (!Array.isArray(selected) || !selected.length) throw new TypeError('contest_score_pids');
    const unique: number[] = [];
    const seen = new Set<number>();
    for (const pid of selected) {
        if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0 || !allowed.has(pid)) {
            throw new TypeError('contest_score_pids');
        }
        if (seen.has(pid)) continue;
        seen.add(pid);
        unique.push(pid);
    }
    const next: Record<number, number> = {};
    for (const pid of normalizeExamPaperPids(contestPids)) {
        next[pid] = contestProblemScoreWeight({ score: existing }, pid);
    }
    for (const pid of unique) next[pid] = score;
    return next;
}

function optionalPostedNumber(raw: unknown): unknown {
    if (raw === undefined || raw === null) return raw;
    if (typeof raw === 'string' && !raw.trim()) return undefined;
    return raw;
}

function postedInteger(raw: unknown): number {
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string' && raw.trim()) {
        const parsed = Number(raw);
        if (String(parsed) === raw.trim()) return parsed;
    }
    throw new TypeError('exam_pass_score_invalid');
}

/** Missing, empty, or 0 = no pass line. Integer ≥1 is the contest-weighted pass score. */
export function parseExamPassScore(raw: unknown): number | null {
    const value = optionalPostedNumber(raw);
    if (value === undefined || value === null) return null;
    const score = postedInteger(value);
    if (score === 0) return null;
    if (!Number.isInteger(score) || !Number.isSafeInteger(score) || score < 1) {
        throw new TypeError('exam_pass_score_invalid');
    }
    return score;
}

export function readExamPassScore(tdoc: { examPassScore?: unknown }): number | null {
    return parseExamPassScore(tdoc.examPassScore);
}

/** Missing or empty = 1. Integer ≥1 is the max finalize count. */
export function parseExamAttemptLimit(raw: unknown): number {
    const value = optionalPostedNumber(raw);
    if (value === undefined || value === null) return 1;
    const limit = postedInteger(value);
    if (!Number.isInteger(limit) || !Number.isSafeInteger(limit) || limit < 1) {
        throw new TypeError('exam_attempt_limit_invalid');
    }
    return limit;
}

export function readExamAttemptLimit(tdoc: { examAttemptLimit?: unknown }): number {
    return parseExamAttemptLimit(tdoc.examAttemptLimit);
}

export function examAttemptsUsed(tsdoc?: ExamPaperStatusClock | null): number {
    const raw = tsdoc?.examAttemptsUsed;
    if (typeof raw === 'number' && Number.isInteger(raw) && Number.isSafeInteger(raw) && raw >= 0) return raw;
    return isExamPaperFinalized(tsdoc) ? 1 : 0;
}

export function examAttemptScore(tsdoc?: ExamPaperStatusClock | null): number {
    const raw = tsdoc?.score;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

function journalRows(tsdoc?: ExamPaperStatusClock | null): Record<string, unknown>[] {
    if (!Array.isArray(tsdoc?.journal)) return [];
    return tsdoc.journal.filter((row): row is Record<string, unknown> => isPlainObject(row));
}

export function isExamAttemptJudgePending(tsdoc?: ExamPaperStatusClock | null): boolean {
    for (const row of journalRows(tsdoc)) {
        if (row.manual === true) continue;
        const raw = row.status;
        const status = raw === undefined ? STATUS.STATUS_WAITING : typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isInteger(status)) continue;
        if ((EXAM_ATTEMPT_PENDING_STATUSES as readonly number[]).includes(status)) return true;
    }
    return false;
}

export function isExamAttemptPassed(tdoc: ExamPaperContestClock, tsdoc?: ExamPaperStatusClock | null): boolean {
    const pass = readExamPassScore(tdoc);
    if (pass === null || !isExamPaperFinalized(tsdoc) || isExamAttemptJudgePending(tsdoc)) return false;
    return examAttemptScore(tsdoc) >= pass;
}

export function canRetakeExamPaper(tdoc: ExamPaperContestClock, tsdoc: ExamPaperStatusClock | null | undefined, now: Date): boolean {
    if (isExamAttemptJudgePending(tsdoc)) return false;
    return canOpenExamPaperAfterFail(tdoc, tsdoc, now);
}

/** Failed (or still judging) with attempts and a full window left. Used for 去考试 / 评测中, not for starting the next paper. */
export function canOpenExamPaperAfterFail(tdoc: ExamPaperContestClock, tsdoc: ExamPaperStatusClock | null | undefined, now: Date): boolean {
    if (readExamPassScore(tdoc) === null || !isExamPaperFinalized(tsdoc)) return false;
    if (isExamAttemptPassed(tdoc, tsdoc)) return false;
    if (examAttemptsUsed(tsdoc) >= readExamAttemptLimit(tdoc)) return false;
    return canStartExamPaper(tdoc, now);
}

export function minContributionsToReach(target: number, contributions: readonly number[]): number | null {
    if (typeof target !== 'number' || !Number.isFinite(target)) throw new TypeError('exam_pass_score_invalid');
    if (target <= 0) return 0;
    const sorted = contributions
        .filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
        .slice()
        .sort((left, right) => right - left);
    let acc = 0;
    for (let i = 0; i < sorted.length; i += 1) {
        acc += sorted[i] as number;
        if (acc >= target) return i + 1;
    }
    return null;
}

export function minProblemsToPass(passScore: number, contributions: readonly number[]): number | null {
    if (!Number.isInteger(passScore) || !Number.isSafeInteger(passScore) || passScore < 1) {
        throw new TypeError('exam_pass_score_invalid');
    }
    return minContributionsToReach(passScore, contributions);
}

export function examPaperContributions(tdoc: { score?: unknown }, pids: readonly number[]): number[] {
    return normalizeExamPaperPids(pids).map((pid) => contestProblemScoreWeight(tdoc, pid));
}

export function examDrawUnitContributions(
    tdoc: { score?: unknown; examPaperQuotas?: unknown },
    poolPids: readonly number[],
    kinds: ReadonlyMap<number, ProblemKind>,
): number[] | null {
    const quotas = readExamPaperQuotas(tdoc.examPaperQuotas);
    if (quotas === null) return examPaperContributions(tdoc, poolPids);
    const byKind = Object.fromEntries(PROBLEM_KINDS.map((kind) => [kind, [] as number[]])) as Record<ProblemKind, number[]>;
    for (const pid of normalizeExamPaperPids(poolPids)) {
        const kind = kinds.get(pid);
        if (!kind) throw new TypeError('exam_paper_pool_kind_missing');
        byKind[kind].push(contestProblemScoreWeight(tdoc, pid));
    }
    const units: number[] = [];
    for (const kind of PROBLEM_KINDS) {
        const need = quotas[kind] || 0;
        if (!need) continue;
        const weights = byKind[kind];
        if (!weights.length) throw new TypeError('exam_paper_pool_short');
        const first = weights[0];
        if (typeof first !== 'number' || weights.some((weight) => weight !== first)) return null;
        for (let i = 0; i < need; i += 1) units.push(first);
    }
    return units;
}

export function examDefinitePaperMax(
    tdoc: { score?: unknown; examPaperQuotas?: unknown },
    poolPids: readonly number[],
    kinds?: ReadonlyMap<number, ProblemKind>,
): number | null {
    if (readExamPaperQuotas(tdoc.examPaperQuotas) === null) {
        return examPaperContributions(tdoc, poolPids).reduce((sum, value) => sum + value, 0);
    }
    if (!kinds) return null;
    const units = examDrawUnitContributions(tdoc, poolPids, kinds);
    if (units === null) return null;
    return units.reduce((sum, value) => sum + value, 0);
}

export function assertExamPassScoreFitsPaper(passScore: number, paperMax: number | null): void {
    if (paperMax !== null && passScore > paperMax) throw new TypeError('exam_pass_score_above_max');
}

export function minRemainingProblemsToPass(
    passScore: number,
    items: readonly { max: number; earned?: number | null }[],
): number | null {
    if (!Number.isInteger(passScore) || !Number.isSafeInteger(passScore) || passScore < 1) {
        throw new TypeError('exam_pass_score_invalid');
    }
    let earned = 0;
    const remain: number[] = [];
    for (const item of items) {
        if (typeof item.max !== 'number' || !Number.isFinite(item.max) || item.max <= 0) continue;
        const got = typeof item.earned === 'number' && Number.isFinite(item.earned) ? item.earned : 0;
        earned += got;
        if (got < item.max) remain.push(item.max - got);
    }
    return minContributionsToReach(passScore - earned, remain);
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
