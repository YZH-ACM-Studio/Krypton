import { CST_OFFSET_MS } from './datetime';

export type ActivityBoard = 'solves' | 'newcomers' | 'consistency';
export type RankingBoard = ActivityBoard | 'rp';
export type RankingPeriod = 'day' | 'week' | 'month';
const RANKING_DAY_MS = 86_400_000;
export const NEWCOMER_DAYS = 30;

export function rankingDay(at: Date): number {
    return Math.floor((at.getTime() + CST_OFFSET_MS) / RANKING_DAY_MS);
}

export function rankingDate(day: number): string {
    return new Date(day * RANKING_DAY_MS).toISOString().slice(0, 10);
}

/** The anchor and both labels are Beijing calendar dates. The numeric end is exclusive. */
export function rankingWindow(period: RankingPeriod, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError('ranking_date_invalid');
    const anchor = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(+anchor) || anchor.toISOString().slice(0, 10) !== date) throw new RangeError('ranking_date_invalid');
    const index = +anchor / RANKING_DAY_MS;
    let start = index;
    let end = index + 1;
    if (period === 'week') {
        start -= (anchor.getUTCDay() + 6) % 7;
        end = start + 7;
    } else if (period === 'month') {
        anchor.setUTCDate(1);
        start = +anchor / RANKING_DAY_MS;
        anchor.setUTCMonth(anchor.getUTCMonth() + 1);
        end = +anchor / RANKING_DAY_MS;
    }
    return { start, end, from: rankingDate(start), through: rankingDate(end - 1), previous: rankingDate(start - 1), next: rankingDate(end) };
}

export interface ActivityStanding {
    uid: number;
    rank: number;
    solves: number;
    activeDays: number;
}

export interface ActivityRankingPage {
    board: ActivityBoard;
    period: RankingPeriod;
    date: string;
    window: ReturnType<typeof rankingWindow>;
    today: string;
    earliest: string | null;
    updatedAt: string;
    count: number;
    page: number;
    pages: number;
    rows: (ActivityStanding & { uname: string; avatarUrl?: string })[];
    mine: ActivityStanding | null;
}
