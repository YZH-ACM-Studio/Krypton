import { STATUS } from '@hydrooj/common';
import { compareIoiRankKey, ioiBoardRankKey, ioiBoardStanding, ioiRankKeysTied, ioiTimeOrigin, type IoiBoardStatus } from './contest-ioi-standing';
import { rankSkippingUnofficial } from './contest-unrank';

/**
 * Public showcase board for one finished individual IOI contest.
 * Places come from the IOI scoreboard comparator, so they match the contest
 * scoreboard. Awards, AK and 幸运柒 are derived here and nowhere else.
 */

export interface PublicBoardTier {
    label: string;
    name: string;
    /** Number of consecutive contest problems in this tier. */
    count: number;
}

export interface PublicBoardContest {
    pids: readonly number[];
    beginAt: Date;
    duration?: number;
    score?: Record<number, number>;
}

export interface PublicBoardProblemDoc {
    /** Parsed problem config. `maxScore` is the judge's full mark. */
    config?: unknown;
}

export interface PublicBoardJournalEntry {
    pid: number;
    status: number;
}

export interface PublicBoardStatus extends IoiBoardStatus {
    uid: number;
    unrank?: unknown;
    journal?: readonly PublicBoardJournalEntry[] | null;
}

export type AwardTier = 0 | 1 | 2 | 3;
export type LuckyKind = 'big' | 'small';

export interface PublicBoardCell {
    /** Contest score for this problem, contest weight applied. */
    score: number;
    /** Elapsed seconds of the adopted submission. Null when it scored 0, as on the scoreboard. */
    seconds: number | null;
    /** Judged Accepted, i.e. full marks. */
    full: boolean;
    firstBlood: boolean;
}

export interface PublicBoardRow {
    uid: number;
    /** Official place. Null for an unofficial (打星) participant. */
    rank: number | null;
    score: number;
    /** Problems with a positive score — the scoreboard's 过题 column. */
    passed: number;
    seconds: number;
    ak: boolean;
    award: AwardTier;
    lucky: LuckyKind | null;
    cells: Array<PublicBoardCell | null>;
}

export interface PublicBoardColumn {
    pid: number;
    label: string;
    tier: number;
    maxScore: number;
    nAccept: number;
    nSubmit: number;
}

export interface PublicBoardAwards {
    /** Everyone with 过题 ≥ 1, unofficial participants included. */
    denominator: number;
    percents: number[];
    quotas: number[];
    counts: number[];
    minScores: Array<number | null>;
}

export interface PublicBoard {
    columns: PublicBoardColumn[];
    tiers: Array<PublicBoardTier & { maxScore: number }>;
    maxScore: number;
    rows: PublicBoardRow[];
    awards: PublicBoardAwards;
}

/** 一等 / 二等 / 三等奖 shares of the denominator, in percent. */
export const AWARD_PERCENTS: readonly number[] = [5, 10, 15];
export const LUCKY_BIG_RANKS: readonly number[] = [7, 77, 177];
export const LUCKY_YUAN: Readonly<Record<LuckyKind, number>> = { big: 50, small: 10 };

/** ⌈denominator × percent%⌉ in integer arithmetic, so 240 × 5% is exactly 12. */
export function awardQuota(denominator: number, percent: number): number {
    if (!Number.isSafeInteger(denominator) || denominator < 0) throw new TypeError(`Award denominator must be a non-negative integer, received ${denominator}.`);
    if (!Number.isSafeInteger(percent) || percent < 0) throw new TypeError(`Award percent must be a non-negative integer, received ${percent}.`);
    return Math.floor((denominator * percent + 99) / 100);
}

/** Cuts by place, so everyone tied on a cut line gets the higher award. */
export function awardTier(rank: number, quotas: readonly number[]): AwardTier {
    let cut = 0;
    for (let tier = 0; tier < quotas.length; tier++) {
        cut += quotas[tier];
        if (rank <= cut) return (tier + 1) as AwardTier;
    }
    return 0;
}

/** 7 / 77 / 177 are 大吉; every other place ending in 7 is 小吉. */
export function luckyKind(rank: number): LuckyKind | null {
    if (LUCKY_BIG_RANKS.includes(rank)) return 'big';
    return rank % 10 === 7 ? 'small' : null;
}

function problemMaximum(contest: PublicBoardContest, problem: PublicBoardProblemDoc | undefined, pid: number): number {
    const config = problem?.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new TypeError(`Public board problem ${pid} has no parsed config.`);
    }
    const rawMaximum = Number((config as { maxScore?: unknown }).maxScore);
    if (!Number.isFinite(rawMaximum) || rawMaximum <= 0) {
        throw new TypeError(`Public board problem ${pid} has an invalid config.maxScore ${String((config as { maxScore?: unknown }).maxScore)}.`);
    }
    return (rawMaximum * scoreWeight(contest, pid)) / 100;
}

function scoreWeight(contest: PublicBoardContest, pid: number): number {
    const raw = contest.score?.[pid] || 100;
    const weight = Number(raw);
    if (!Number.isFinite(weight) || weight <= 0) throw new TypeError(`Public board problem ${pid} has an invalid contest score weight ${String(raw)}.`);
    return weight;
}

interface DetailCell {
    score?: unknown;
    status?: unknown;
    rid?: unknown;
}

function detailCell(status: PublicBoardStatus, pid: number): DetailCell | null {
    const detail = status.detail;
    if (!detail) return null;
    const value = detail[pid] ?? detail[String(pid)];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as DetailCell;
}

function elapsedMs(contest: PublicBoardContest, status: PublicBoardStatus, pid: number, rid: unknown): number {
    const getTimestamp = rid && typeof rid === 'object' ? (rid as { getTimestamp?: unknown }).getTimestamp : undefined;
    if (typeof getTimestamp !== 'function') throw new TypeError(`Public board uid ${status.uid} problem ${pid} has no submission id.`);
    const submittedAt = (rid as { getTimestamp(): Date }).getTimestamp();
    return submittedAt.getTime() - ioiTimeOrigin(contest, status).getTime();
}

function problemLabels(tiers: readonly PublicBoardTier[], problemCount: number): Array<{ label: string; tier: number }> {
    const total = tiers.reduce((sum, tier) => sum + tier.count, 0);
    if (total !== problemCount) throw new Error(`Public board tiers cover ${total} problems but the contest has ${problemCount}.`);
    return tiers.flatMap((tier, index) => Array.from({ length: tier.count }, (_, offset) => ({ label: `${tier.label}-${offset + 1}`, tier: index })));
}

export function buildPublicBoard(
    contest: PublicBoardContest,
    problems: Readonly<Record<number, PublicBoardProblemDoc>>,
    statuses: readonly PublicBoardStatus[],
    tiers: readonly PublicBoardTier[],
): PublicBoard {
    const { pids } = contest;
    const labels = problemLabels(tiers, pids.length);
    const maxima = pids.map((pid) => problemMaximum(contest, problems[pid], pid));

    // First blood follows the scoreboard: earliest Accepted per problem in milliseconds, unofficial rows included.
    const firstMs = new Map<number, number>();
    for (const status of statuses) {
        for (const pid of pids) {
            const cell = detailCell(status, pid);
            if (cell?.status !== STATUS.STATUS_ACCEPTED) continue;
            const ms = elapsedMs(contest, status, pid, cell.rid);
            const best = firstMs.get(pid);
            if (best === undefined || ms < best) firstMs.set(pid, ms);
        }
    }

    // Header counters follow the scoreboard: every journal submission, and each person's first Accepted.
    const nSubmit = new Map<number, number>(pids.map((pid) => [pid, 0]));
    const nAccept = new Map<number, number>(pids.map((pid) => [pid, 0]));
    for (const status of statuses) {
        const accepted = new Set<number>();
        for (const entry of status.journal || []) {
            if (!nSubmit.has(entry.pid)) continue;
            nSubmit.set(entry.pid, nSubmit.get(entry.pid)! + 1);
            if (entry.status === STATUS.STATUS_ACCEPTED && !accepted.has(entry.pid)) {
                accepted.add(entry.pid);
                nAccept.set(entry.pid, nAccept.get(entry.pid)! + 1);
            }
        }
    }

    const keyed = statuses
        .map((status) => ({ status, unrank: status.unrank, key: ioiBoardRankKey(contest, status, {}) }))
        .sort((left, right) => compareIoiRankKey(left.key, right.key));
    const ranked = rankSkippingUnofficial(keyed, (left, right) => ioiRankKeysTied(left.key, right.key));

    const rows: PublicBoardRow[] = ranked.map(([rank, { status, key }]) => {
        const standing = ioiBoardStanding(contest, status, {});
        const cells = pids.map((pid): PublicBoardCell | null => {
            const cell = detailCell(status, pid);
            if (!cell || cell.score == null) return null;
            if (typeof cell.score !== 'number' || !Number.isFinite(cell.score)) {
                throw new TypeError(`Public board uid ${status.uid} problem ${pid} has a non-numeric score.`);
            }
            const full = cell.status === STATUS.STATUS_ACCEPTED;
            return {
                score: (cell.score * scoreWeight(contest, pid)) / 100,
                seconds: standing.problemSeconds.get(pid) ?? null,
                full,
                firstBlood: full && elapsedMs(contest, status, pid, cell.rid) === firstMs.get(pid),
            };
        });
        return {
            uid: status.uid,
            rank: rank === 0 ? null : rank,
            score: key.score,
            passed: standing.passed,
            seconds: standing.seconds,
            ak: cells.every((cell) => cell?.full === true),
            award: 0,
            lucky: null,
            cells,
        };
    });

    const denominator = rows.filter((row) => row.passed >= 1).length;
    const quotas = AWARD_PERCENTS.map((percent) => awardQuota(denominator, percent));
    for (const row of rows) {
        if (row.rank === null || row.passed < 1) continue;
        row.award = awardTier(row.rank, quotas);
        row.lucky = luckyKind(row.rank);
    }
    const tierRows = AWARD_PERCENTS.map((_, index) => rows.filter((row) => row.award === index + 1));

    return {
        columns: pids.map((pid, index) => ({
            pid,
            label: labels[index].label,
            tier: labels[index].tier,
            maxScore: maxima[index],
            nAccept: nAccept.get(pid)!,
            nSubmit: nSubmit.get(pid)!,
        })),
        tiers: tiers.map((tier, index) => ({
            ...tier,
            maxScore: maxima.filter((_, column) => labels[column].tier === index).reduce((sum, value) => sum + value, 0),
        })),
        maxScore: maxima.reduce((sum, value) => sum + value, 0),
        rows,
        awards: {
            denominator,
            percents: [...AWARD_PERCENTS],
            quotas,
            counts: tierRows.map((tierRow) => tierRow.length),
            minScores: tierRows.map((tierRow) => (tierRow.length ? Math.min(...tierRow.map((row) => row.score)) : null)),
        },
    };
}
