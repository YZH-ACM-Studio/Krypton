import type { ScoreboardRow } from '../interface';
import { comparePaperScores, letterLabel, type SetCodePolicy } from '@hydrooj/common';
import { formatSeconds } from '@hydrooj/utils/lib/utils';
import { setBoardProblemCounts, type ParticipantProblemCounts, type ProblemCounts } from './set-scoreboard-stats';

/** Hidden totals cannot remain available as raw cells, percentages or score-sorted row order. */
export function hideSetScoreboardTotals(rows: ScoreboardRow[]): ScoreboardRow[] {
    if (!rows.length) return rows;
    const hidden = new Set(['total_score', 'solved', 'time', 'rank']);
    const keep = rows[0].map((cell, index) => hidden.has(cell.type) ? -1 : index).filter((index) => index >= 0);
    const body = rows.slice(1).sort((a, b) => Number(a.find((cell) => cell.type === 'user')?.raw) - Number(b.find((cell) => cell.type === 'user')?.raw));
    return [rows[0], ...body].map((row) => keep.map((index) => row[index]));
}

export interface SetScoreboardTeam {
    name: string;
    captainUid: number;
    memberUids: number[];
}

export interface SetScoreboardInputRow {
    uid: number;
    uname: string;
    score: number;
    maxPoints?: number;
    accept?: number;
    time?: number;
    unrank?: boolean;
    detail: Record<string, { score?: unknown; rid?: unknown; naccept?: unknown; real?: unknown; penalty?: unknown }> | null | undefined;
    team?: SetScoreboardTeam | null;
    problemStats?: ParticipantProblemCounts;
}

export type SetBoardParticipant = SetScoreboardInputRow & { problemStats: ParticipantProblemCounts };

export function setScoreboardWithCounts(pids: readonly number[], rows: SetBoardParticipant[],
    problems: Record<number, Partial<ProblemCounts>>, codePolicy: SetCodePolicy, showRowCounts: boolean) {
    setBoardProblemCounts(pids, problems, rows.map((row) => row.problemStats));
    return setScoreboardRows(pids, rows, { codePolicy, showRowCounts });
}

function requireFiniteScore(score: number): number {
    if (typeof score !== 'number' || !Number.isFinite(score)) {
        throw new TypeError('set_scoreboard_score_missing');
    }
    return score;
}

/** No chosen round is a zero total. Any other non-finite value is still missing. */
export function emptyRoundScore(score: unknown): number {
    if (score === null || score === undefined) return 0;
    if (typeof score === 'number' && Number.isFinite(score)) return score;
    throw new TypeError('set_scoreboard_score_missing');
}

function problemCell(pid: number, detail: SetScoreboardInputRow['detail']): ScoreboardRow[number] {
    const entry = detail?.[String(pid)];
    const raw = entry?.score;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return {
            type: 'problem', value: String(raw), raw: pid, score: raw,
        };
    }
    return {
        type: 'problem', value: '-', raw: pid, score: null,
    };
}

function userCell(row: SetScoreboardInputRow): ScoreboardRow[number] {
    const cell: ScoreboardRow[number] = {
        type: 'user',
        value: row.uname,
        raw: row.uid,
    };
    if (row.team) {
        return {
            ...cell,
            team: {
                name: row.team.name,
                captainUid: row.team.captainUid,
                memberUids: row.team.memberUids,
            },
        };
    }
    return cell;
}

function acmProblemCell(pid: number, detail: SetScoreboardInputRow['detail']): ScoreboardRow[number] {
    const entry = detail?.[String(pid)];
    if (!entry?.rid) return { type: 'record', value: '', score: null };
    const wrong = entry.naccept;
    const elapsed = entry.real;
    const penalty = entry.penalty;
    if (typeof wrong !== 'number' || !Number.isSafeInteger(wrong) || wrong < 0
        || typeof elapsed !== 'number' || !Number.isFinite(elapsed) || elapsed < 0
        || typeof penalty !== 'number' || !Number.isFinite(penalty) || penalty < 0
        || (entry.score !== 0 && entry.score !== 1)) throw new TypeError('set_scoreboard_acm_detail_missing');
    const solved = entry.score === 1;
    return { type: 'record', raw: entry.rid, score: solved ? 100 : 0,
        value: solved ? `${wrong ? `+${wrong}` : '+'}\n${formatSeconds(elapsed, false)}` : `-${wrong}`,
        ...(solved ? { hover: formatSeconds(elapsed + penalty) } : {}) };
}

/** Teacher grades scoreboard. Totals and problem cells come only from status score/detail. */
export function setScoreboardRows(
    pids: readonly number[],
    rows: readonly SetScoreboardInputRow[],
    options: { codePolicy?: SetCodePolicy; showRowCounts?: boolean } = {},
): ScoreboardRow[] {
    const acm = options.codePolicy === 'acm';
    const ranked = rows.map((row) => ({ ...row, score: requireFiniteScore(row.score) }));
    if (acm) {
        for (const row of ranked) {
            if (row.accept !== row.score || typeof row.time !== 'number' || !Number.isFinite(row.time) || row.time < 0) {
                throw new TypeError('set_scoreboard_acm_result_missing');
            }
        }
    }
    const compare = (left: SetScoreboardInputRow, right: SetScoreboardInputRow) => {
        if (acm) return right.score - left.score || left.time! - right.time!;
        return comparePaperScores(left, right);
    };
    ranked.sort((left, right) => compare(left, right) || left.uid - right.uid);

    const header: ScoreboardRow = [
        { type: 'rank', value: '#' },
        { type: 'user', value: 'User' },
        { type: acm ? 'solved' : 'total_score', value: acm ? 'Solved' : 'Total Score' },
        ...(acm ? [{ type: 'time' as const, value: 'Penalty' }] : []),
        ...pids.map((pid, index): ScoreboardRow[number] => ({
            type: 'problem',
            value: acm ? letterLabel(index) : String(pid),
            raw: pid,
        })),
    ];

    const body: ScoreboardRow[] = [];
    let rankedCount = 0;
    let previousRank = 0;
    let previousRanked: SetScoreboardInputRow | undefined;
    for (let index = 0; index < ranked.length; index++) {
        const row = ranked[index];
        let rank = '*';
        if (!row.unrank) {
            rankedCount++;
            previousRank = previousRanked && compare(row, previousRanked) === 0 ? previousRank : rankedCount;
            previousRanked = row;
            rank = String(previousRank);
        }
        body.push([
            { type: 'rank', value: rank },
            userCell(row),
            { type: acm ? 'solved' : 'total_score', value: !acm && row.maxPoints != null ? `${row.score}/${row.maxPoints}` : String(row.score), score: row.score,
                ...(!acm && row.maxPoints ? { scorePercentage: row.score / row.maxPoints * 100 } : {}) },
            ...(acm ? [{ type: 'time' as const, value: formatSeconds(row.time, false), raw: row.time }] : []),
            ...pids.map((pid) => {
                const cell = acm ? acmProblemCell(pid, row.detail) : problemCell(pid, row.detail);
                const counts = options.showRowCounts && row.problemStats?.get(pid);
                if (counts && typeof counts === 'object') cell.problemCounts = counts;
                return cell;
            }),
        ]);
    }
    return [header, ...body];
}
