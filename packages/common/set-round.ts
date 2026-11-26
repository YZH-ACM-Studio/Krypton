import { drawExamPaperPids, type ExamPaperQuotas } from './exam-paper';
import { STATUS } from './status';
import type { SetSettings } from './set-config';
import type { ProblemKind } from './problem-kind';
import { paperAward, paperPointEntry, roundPaperPoints, type SetPaperPoints } from './set-points';

const HOUR_MS = 3_600_000;

export const SET_ROUND_TEXT = Object.freeze({
    set_round_not_open: { zh: '作答还没开始。', en: 'Answering has not started.' },
    set_round_closed: { zh: '这一轮已经结束，不能再保存。', en: 'This round is closed.' },
    set_round_attempts_used: { zh: '重做次数已经用完。', en: 'No retakes remain.' },
    set_round_window_short: { zh: '剩余时间不够完整的个人限时，不能开始。', en: 'The remaining time is shorter than the personal limit.' },
    set_round_need_fail: { zh: '已经达到及格分，不能再开一轮。', en: 'A passed round cannot be retaken.' },
    set_round_grading_pending: { zh: '上一轮还有答案等待评定，请等成绩确认后再重做。', en: 'Wait for the previous round to finish grading before retaking.' },
    set_round_problem: { zh: '这道题不在本轮试卷里。', en: 'This problem is not on the current paper.' },
    set_round_conflict: { zh: '答案已在其他页面更新，请先查看最新答案。', en: 'The answer changed in another view. Reload it before saving.' },
    set_round_hand_in_closed: { zh: '这场不能提前交卷。', en: 'Early hand-in is turned off.' },
});

export function setRoundMessage(code: string): string {
    const text = SET_ROUND_TEXT[code as keyof typeof SET_ROUND_TEXT];
    if (!text) throw new TypeError('set_round_not_open');
    return text.zh;
}

function fail(code: keyof typeof SET_ROUND_TEXT): never {
    throw new TypeError(code);
}

export interface SetClock {
    beginAt: Date;
    endAt: Date;
    now: Date;
}

export interface StoredRound {
    roundNo: number;
    state: 'open' | 'closed';
    startedAt: Date;
    closedAt: Date | null;
    paperPids: number[];
    issuedWithPaperPoints?: true;
    total: number;
    maxPoints?: number;
    passed: boolean;
    accept?: number;
    penaltySeconds?: number;
    judgePending?: boolean;
}

export interface OfficialAnswer {
    pid: number;
    version: number;
    operationId: string;
    acceptedAt: Date;
    body: unknown;
    rawScore: number;
    status?: number;
    rid?: string;
    judgeResult?: Readonly<Record<string, 'correct' | 'wrong' | 'partial'>>;
}

export interface CodeAttempt {
    pid: number;
    acceptedAt: Date;
    score: number;
    status: number;
    recordId: string;
    subtasks?: Readonly<Record<string, { score: number; status: number }>>;
}

export type RoundStart =
    | { action: 'resume'; roundNo: number; availableMs: number }
    | { action: 'open'; roundNo: number; availableMs: number; paperPids: number[] }
    | { action: 'deny'; code: keyof typeof SET_ROUND_TEXT };

export type RoundEntry = Exclude<RoundStart, { action: 'open' }>
    | { action: 'open'; roundNo: number; availableMs: number };

function liveDate(value: Date, code: keyof typeof SET_ROUND_TEXT): Date {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) fail(code);
    return value;
}

export function personalLimitMs(settings: SetSettings): number | null {
    const hours = settings.personalLimit.hours;
    if (hours === null) return null;
    return hours * HOUR_MS;
}

export function roundPersonalEnd(settings: SetSettings, finalEnd: Date, startedAt: Date): Date {
    const limit = personalLimitMs(settings);
    if (limit === null) return new Date(finalEnd.getTime());
    return new Date(Math.min(startedAt.getTime() + limit, finalEnd.getTime()));
}

export function lateCoefficient(settings: Pick<SetSettings, 'late'>, acceptedAt: Date): number {
    if (!settings.late.enabled) return 1;
    const elapsed = acceptedAt.getTime() - settings.late.onTimeAt.getTime();
    if (elapsed < 0) return 1;
    const hours = elapsed / HOUR_MS;
    const keys = Object.keys(settings.late.rules)
        .map((key) => Number(key))
        .filter((key) => Number.isFinite(key))
        .sort((left, right) => left - right);
    let coefficient = 1;
    for (const key of keys) {
        if (key <= hours) coefficient = settings.late.rules[String(key)] ?? coefficient;
        else break;
    }
    return coefficient;
}

export function effectiveScore(settings: Pick<SetSettings, 'late'>, rawScore: number, acceptedAt: Date): number {
    return rawScore * lateCoefficient(settings, acceptedAt);
}

function availableMs(settings: SetSettings, clock: SetClock): number {
    const remain = clock.endAt.getTime() - clock.now.getTime();
    const limit = personalLimitMs(settings);
    if (limit === null) return Math.max(0, remain);
    return Math.max(0, Math.min(limit, remain));
}

function fullWindowFits(settings: SetSettings, clock: SetClock): boolean {
    const limit = personalLimitMs(settings);
    if (limit === null) return true;
    return clock.now.getTime() + limit <= clock.endAt.getTime();
}

export function planRoundEntry(
    settings: SetSettings,
    clock: SetClock,
    rounds: readonly StoredRound[],
): RoundEntry {
    liveDate(clock.beginAt, 'set_round_not_open');
    liveDate(clock.endAt, 'set_round_not_open');
    liveDate(clock.now, 'set_round_not_open');
    if (clock.now.getTime() < clock.beginAt.getTime()) return { action: 'deny', code: 'set_round_not_open' };
    if (clock.now.getTime() >= clock.endAt.getTime()) return { action: 'deny', code: 'set_round_closed' };
    const open = rounds.find((round) => round.state === 'open');
    if (open) {
        const remaining = roundPersonalEnd(settings, clock.endAt, open.startedAt).getTime() - clock.now.getTime();
        if (remaining <= 0) return { action: 'deny', code: 'set_round_closed' };
        return { action: 'resume', roundNo: open.roundNo, availableMs: remaining };
    }
    const closed = rounds.filter((round) => round.state === 'closed');
    const used = closed.reduce((maximum, round) => Math.max(maximum, round.roundNo), 0);
    if (used >= settings.retake.extra + 1) return { action: 'deny', code: 'set_round_attempts_used' };
    if (used > 0) {
        const previous = closed.reduce((best, round) => (round.roundNo > best.roundNo ? round : best));
        if (settings.retake.onlyAfterFail) {
            if (previous.judgePending) return { action: 'deny', code: 'set_round_grading_pending' };
            if (settings.retake.passScore === null || previous.passed) return { action: 'deny', code: 'set_round_need_fail' };
        }
        if (settings.retake.requireFullWindow && !fullWindowFits(settings, clock)) {
            return { action: 'deny', code: 'set_round_window_short' };
        }
    } else if (settings.personalLimit.requireFullWindow && !fullWindowFits(settings, clock)) {
        return { action: 'deny', code: 'set_round_window_short' };
    }
    return { action: 'open', roundNo: used + 1, availableMs: availableMs(settings, clock) };
}

export function planRoundStart(
    settings: SetSettings,
    clock: SetClock,
    rounds: readonly StoredRound[],
    poolPids: readonly number[],
    poolKinds: ReadonlyMap<number, ProblemKind>,
    randomInt: (maxExclusive: number) => number,
): RoundStart {
    const entry = planRoundEntry(settings, clock, rounds);
    if (entry.action !== 'open') return entry;
    return { ...entry, paperPids: paperForRound(settings, entry.roundNo, rounds, poolPids, poolKinds, randomInt) };
}

function paperForRound(
    settings: SetSettings,
    roundNo: number,
    rounds: readonly StoredRound[],
    poolPids: readonly number[],
    poolKinds: ReadonlyMap<number, ProblemKind>,
    randomInt: (maxExclusive: number) => number,
): number[] {
    if (!settings.draw.enabled || !settings.draw.quotas) return [...poolPids];
    if (!settings.draw.redrawEachRound && roundNo > 1) {
        const first = rounds.reduce<StoredRound | null>((earliest, round) =>
            !earliest || round.roundNo < earliest.roundNo ? round : earliest, null);
        if (!first) fail('set_round_problem');
        // Keep eligible questions on a reused paper and fill the places withdrawn since its first issue.
        const kept = new Set(first.paperPids.filter((pid) => poolPids.includes(pid)));
        const quotas = { ...settings.draw.quotas };
        for (const pid of kept) {
            const kind = poolKinds.get(pid);
            if (!kind) fail('set_round_problem');
            const need = quotas[kind] ?? 0;
            if (need > 0) quotas[kind] = need - 1;
            else kept.delete(pid);
        }
        if (kept.size === first.paperPids.length && !Object.values(quotas).some((count) => count > 0)) return [...first.paperPids];
        const remaining = poolPids.filter((pid) => !kept.has(pid));
        const extra = Object.values(quotas).some((count) => count > 0) ? drawExamPaperPids(remaining, poolKinds, quotas, randomInt) : [];
        return poolPids.filter((pid) => kept.has(pid) || extra.includes(pid));
    }
    return drawExamPaperPids(poolPids, poolKinds, settings.draw.quotas, randomInt);
}

export function stableAnswerBody(value: unknown): string {
    return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => sortValue(item));
    if (typeof value === 'object' && value !== null) {
        const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
        return Object.fromEntries(entries.map(([key, item]) => [key, sortValue(item)]));
    }
    return value;
}

export interface SavePlanItem {
    pid: number;
    body: unknown;
    baseVersion: number;
    rawScore: number;
    status?: number;
    judgeResult?: Readonly<Record<string, 'correct' | 'wrong' | 'partial'>>;
}

export interface SavePlan {
    operationId: string;
    now: Date;
    deadline: Date;
    paperPids: readonly number[];
    current: readonly OfficialAnswer[];
    items: readonly SavePlanItem[];
}

export interface SaveApply {
    changed: OfficialAnswer[];
    unchanged: number[];
}

export function planOfficialSave(plan: SavePlan): SaveApply | { code: keyof typeof SET_ROUND_TEXT; conflicts: number[] } {
    if (plan.now.getTime() >= plan.deadline.getTime()) return { code: 'set_round_closed', conflicts: [] };
    const current = new Map(plan.current.map((answer) => [answer.pid, answer]));
    const conflicts: number[] = [];
    for (const item of plan.items) {
        if (!plan.paperPids.includes(item.pid)) return { code: 'set_round_problem', conflicts: [] };
        const existing = current.get(item.pid);
        const version = existing?.version ?? 0;
        if (item.baseVersion !== version) conflicts.push(item.pid);
    }
    if (conflicts.length) return { code: 'set_round_conflict', conflicts };
    const changed: OfficialAnswer[] = [];
    const unchanged: number[] = [];
    for (const item of plan.items) {
        const existing = current.get(item.pid);
        if (existing && stableAnswerBody(existing.body) === stableAnswerBody(item.body)) {
            unchanged.push(item.pid);
            continue;
        }
        changed.push({
            pid: item.pid,
            version: (existing?.version ?? 0) + 1,
            operationId: plan.operationId,
            acceptedAt: new Date(plan.now.getTime()),
            body: item.body,
            rawScore: item.rawScore,
            ...(item.status === undefined ? {} : { status: item.status }),
            ...(item.judgeResult === undefined ? {} : { judgeResult: item.judgeResult }),
        });
    }
    return { changed, unchanged };
}

export function planHandIn(settings: SetSettings, state: 'open' | 'closed', now: Date, deadline: Date): 'close' | keyof typeof SET_ROUND_TEXT {
    if (state !== 'open') return 'set_round_closed';
    if (!settings.earlyHandIn && now.getTime() < deadline.getTime()) return 'set_round_hand_in_closed';
    return 'close';
}

type ScoringSettings = Pick<SetSettings, 'codePolicy' | 'late'>;

function attemptEffective(settings: ScoringSettings, attempt: CodeAttempt): number {
    return effectiveScore(settings, attempt.score, attempt.acceptedAt);
}

export function compareCodeAttempts(left: CodeAttempt, right: CodeAttempt): number {
    return left.acceptedAt.getTime() - right.acceptedAt.getTime() || left.recordId.localeCompare(right.recordId);
}

export function codeScoreForProblem(settings: ScoringSettings, attempts: readonly CodeAttempt[]): { score: number; acceptedAt: Date; recordId: string; status: number } | null {
    const ordered = attempts.filter((attempt) => ![STATUS.STATUS_CANCELED, STATUS.STATUS_IGNORED].includes(attempt.status)).slice().sort(compareCodeAttempts);
    if (!ordered.length) return null;
    if (settings.codePolicy === 'last') {
        const last = ordered[ordered.length - 1] as CodeAttempt;
        return { score: attemptEffective(settings, last), acceptedAt: last.acceptedAt, recordId: last.recordId, status: last.status };
    }
    if (settings.codePolicy === 'subtask_best') {
        const subtasks = new Map<string, { score: number; status: number; acceptedAt: Date; recordId: string }>();
        for (const attempt of ordered) {
            for (const [key, subtask] of Object.entries(attempt.subtasks ?? {})) {
                const current = subtasks.get(key);
                const score = effectiveScore(settings, subtask.score, attempt.acceptedAt);
                if (!current || score > current.score) {
                    subtasks.set(key, { score, status: subtask.status, acceptedAt: attempt.acceptedAt, recordId: attempt.recordId });
                }
            }
        }
        if (!subtasks.size) {
            const best = ordered.reduce((win, attempt) => (attemptEffective(settings, attempt) > attemptEffective(settings, win) ? attempt : win));
            return { score: attemptEffective(settings, best), acceptedAt: best.acceptedAt, recordId: best.recordId, status: best.status };
        }
        let score = 0;
        let acceptedAt = ordered[0] as CodeAttempt;
        let recordId = acceptedAt.recordId;
        for (const subtask of subtasks.values()) {
            score += subtask.score;
            if (subtask.acceptedAt.getTime() >= acceptedAt.acceptedAt.getTime()) {
                acceptedAt = { ...acceptedAt, acceptedAt: subtask.acceptedAt };
                recordId = subtask.recordId;
            }
        }
        return { score, acceptedAt: acceptedAt.acceptedAt, recordId, status: Math.max(...[...subtasks.values()].map((item) => item.status)) };
    }
    if (settings.codePolicy === 'retry_decay') {
        let tries = 0;
        let best: { score: number; acceptedAt: Date; recordId: string; status: number } | null = null;
        for (const attempt of ordered) {
            const valid = attempt.status !== STATUS.STATUS_COMPILE_ERROR && attempt.status !== STATUS.STATUS_FORMAT_ERROR;
            if (valid) tries += 1;
            const decayed = valid ? Math.round(Math.max(0.7, 0.95 ** (tries - 1)) * attempt.score) : 0;
            const score = effectiveScore(settings, decayed, attempt.acceptedAt);
            if (!best || score > best.score) best = { score, acceptedAt: attempt.acceptedAt, recordId: attempt.recordId, status: attempt.status };
        }
        return best;
    }
    if (settings.codePolicy === 'acm') {
        for (const attempt of ordered) {
            if (attempt.status === STATUS.STATUS_COMPILE_ERROR || attempt.status === STATUS.STATUS_FORMAT_ERROR) continue;
            if (attempt.status === STATUS.STATUS_ACCEPTED) {
                return { score: 1, acceptedAt: attempt.acceptedAt, recordId: attempt.recordId, status: attempt.status };
            }
        }
        const last = ordered[ordered.length - 1] as CodeAttempt;
        return { score: 0, acceptedAt: last.acceptedAt, recordId: last.recordId, status: last.status };
    }
    let best: CodeAttempt | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const attempt of ordered) {
        const score = attemptEffective(settings, attempt);
        if (score > bestScore) {
            best = attempt;
            bestScore = score;
        }
    }
    if (!best) return null;
    return { score: bestScore, acceptedAt: best.acceptedAt, recordId: best.recordId, status: best.status };
}

export interface ProblemScore {
    pid: number;
    score: number;
    acceptedAt: Date | null;
    status: number;
    recordId?: string;
    penaltySeconds?: number;
    elapsedSeconds?: number;
    wrongAttempts?: number;
}

export function roundTotal(
    settings: ScoringSettings,
    paperPids: readonly number[],
    answers: readonly Pick<OfficialAnswer, 'pid' | 'rawScore' | 'acceptedAt' | 'status' | 'rid'>[],
    attempts: readonly CodeAttempt[],
    weights: ReadonlyMap<number, number>,
    codePids: ReadonlySet<number>,
    roundStartedAt: Date,
    points?: SetPaperPoints,
): { total: number; problems: ProblemScore[]; accept: number; penaltySeconds: number } {
    const problems: ProblemScore[] = [];
    let total = 0;
    let accept = 0;
    let penaltySeconds = 0;
    for (const pid of paperPids) {
        const weight = (weights.get(pid) ?? 100) / 100;
        const entry = points && settings.codePolicy !== 'acm' ? paperPointEntry(points, pid) : null;
        if (entry?.excluded) continue;
        if (settings.codePolicy === 'acm') {
            if (!codePids.has(pid)) continue;
            const problemAttempts = attempts.filter((attempt) => attempt.pid === pid
                && ![STATUS.STATUS_CANCELED, STATUS.STATUS_IGNORED].includes(attempt.status)).sort(compareCodeAttempts);
            const picked = codeScoreForProblem(settings, problemAttempts);
            const winning = picked?.score === 1 ? problemAttempts.find((attempt) => attempt.recordId === picked.recordId) : undefined;
            const wrongBefore = problemAttempts.filter((attempt) =>
                ![STATUS.STATUS_ACCEPTED, STATUS.STATUS_COMPILE_ERROR, STATUS.STATUS_FORMAT_ERROR].includes(attempt.status)
                && (!winning || compareCodeAttempts(attempt, winning) < 0)).length;
            const elapsedSeconds = picked ? Math.max(0, Math.floor((picked.acceptedAt.getTime() - roundStartedAt.getTime()) / 1000)) : 0;
            if (picked?.score === 1) {
                accept += 1;
                penaltySeconds += elapsedSeconds + wrongBefore * 20 * 60;
            }
            problems.push({ pid, score: picked?.score ?? 0, acceptedAt: picked?.acceptedAt ?? null,
                status: picked?.status ?? STATUS.STATUS_WAITING,
                ...(picked ? { recordId: picked.recordId } : {}),
                penaltySeconds: wrongBefore * 20 * 60, elapsedSeconds, wrongAttempts: wrongBefore });
            continue;
        }
        if (codePids.has(pid)) {
            const picked = codeScoreForProblem(settings, attempts.filter((attempt) => attempt.pid === pid));
            const raw = picked?.score ?? 0;
            const score = entry ? paperAward(entry, raw) : raw * weight;
            total += score;
            problems.push({ pid, score, acceptedAt: picked?.acceptedAt ?? null, status: picked?.status ?? STATUS.STATUS_WAITING,
                ...(picked ? { recordId: picked.recordId } : {}) });
            continue;
        }
        const answer = answers.find((item) => item.pid === pid);
        const raw = answer ? effectiveScore(settings, answer.rawScore, answer.acceptedAt) : 0;
        const score = entry ? paperAward(entry, raw) : raw * weight;
        total += score;
        problems.push({ pid, score, acceptedAt: answer?.acceptedAt ?? null,
            ...(answer?.rid ? { recordId: answer.rid } : {}),
            status: answer ? answer.status ?? (answer.rawScore >= 100 ? STATUS.STATUS_ACCEPTED : STATUS.STATUS_WRONG_ANSWER) : STATUS.STATUS_WAITING });
    }
    if (settings.codePolicy === 'acm') return { total: accept, problems, accept, penaltySeconds };
    return { total: points ? roundPaperPoints(total) : total, problems, accept, penaltySeconds };
}

export function selectRound<R extends StoredRound>(settings: SetSettings, rounds: readonly R[]): R | null {
    const closed = rounds.filter((round) => round.state === 'closed');
    const pool = closed.length ? closed : rounds.filter((round) => round.state === 'open');
    if (!pool.length) return null;
    if (settings.retake.pick === 'last_round') {
        return pool.reduce((best, round) => (round.roundNo > best.roundNo ? round : best));
    }
    return pool.reduce((best, round) => {
        if (round.total > best.total) return round;
        if (settings.codePolicy === 'acm' && round.total === best.total
            && (round.penaltySeconds ?? 0) < (best.penaltySeconds ?? 0)) return round;
        if (settings.codePolicy === 'acm' && round.total === best.total
            && (round.penaltySeconds ?? 0) > (best.penaltySeconds ?? 0)) return best;
        if (round.total === best.total && round.roundNo < best.roundNo) return round;
        return best;
    });
}

export function roundPassed(settings: SetSettings, total: number): boolean {
    if (settings.retake.passScore === null) return false;
    return total >= settings.retake.passScore;
}

export function feedbackOpen(
    when: SetSettings['feedback']['objective']['when'],
    gradesReleased: boolean,
    now: Date,
    roundClosedAt: Date | null,
    finalEnd: Date,
): boolean {
    if (when === 'immediate') return true;
    if (when === 'after_round') return roundClosedAt !== null && now.getTime() >= roundClosedAt.getTime();
    if (when === 'after_deadline') return now.getTime() >= finalEnd.getTime();
    return gradesReleased;
}

export const RECALC_CONCURRENCY = 8;

export function recalcChunks<T>(items: readonly T[], size = RECALC_CONCURRENCY): T[][] {
    if (!Number.isInteger(size) || size < 1) throw new TypeError('set_round_not_open');
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
    return chunks;
}

export function quotasOrNull(settings: SetSettings): ExamPaperQuotas | null {
    return settings.draw.enabled ? settings.draw.quotas : null;
}
