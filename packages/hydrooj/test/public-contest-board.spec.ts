import { expect } from 'chai';
import { describe, it } from 'node:test';
import { STATUS } from '@hydrooj/common';
import {
    awardQuota,
    awardTier,
    buildPublicBoard,
    luckyKind,
    type PublicBoardStatus,
    type PublicBoardTier,
} from '../src/lib/public-contest-board';

const BEGIN = new Date('2026-10-11T10:20:00Z');
const AC = STATUS.STATUS_ACCEPTED;
const WA = STATUS.STATUS_WRONG_ANSWER;
const rid = (seconds: number) => ({ getTimestamp: () => new Date(BEGIN.getTime() + seconds * 1000) });

const PIDS = [101, 102, 103];
const PROBLEMS = { 101: { config: { maxScore: 10 } }, 102: { config: { maxScore: 20 } }, 103: { config: { maxScore: 30 } } };
const TIERS: PublicBoardTier[] = [
    { label: 'L1', name: '基础级', count: 2 },
    { label: 'L2', name: '进阶级', count: 1 },
];
const CONTEST = { pids: PIDS, beginAt: BEGIN };

type Cell = [score: number, status: number, seconds: number];

function person(uid: number, cells: Record<number, Cell>, extra: Partial<PublicBoardStatus> = {}): PublicBoardStatus {
    const detail: Record<string, unknown> = {};
    const journal: Array<{ pid: number; status: number }> = [];
    let score = 0;
    for (const [pid, [cellScore, status, seconds]] of Object.entries(cells)) {
        detail[pid] = { score: cellScore, status, rid: rid(seconds) };
        journal.push({ pid: Number(pid), status });
        score += cellScore;
    }
    return { uid, score, detail, journal, ...extra };
}

/** `count` people who each solved only problem 101, slower and slower so nobody ties. */
function field(count: number, firstUid: number): PublicBoardStatus[] {
    return Array.from({ length: count }, (_, index) => person(firstUid + index, { 101: [10, AC, 600 + index] }));
}

const build = (statuses: PublicBoardStatus[]) => buildPublicBoard(CONTEST, PROBLEMS, statuses, TIERS);

describe('public contest board', () => {
    it('rounds award quotas up with exact integer arithmetic', () => {
        expect(awardQuota(238, 5)).to.equal(12);
        expect(awardQuota(238, 10)).to.equal(24);
        expect(awardQuota(238, 15)).to.equal(36);
        expect(awardQuota(240, 5)).to.equal(12);
        expect(awardQuota(20, 5)).to.equal(1);
        expect(awardQuota(0, 15)).to.equal(0);
        expect(() => awardQuota(2.5, 5)).to.throw(TypeError);
    });

    it('cuts awards by place', () => {
        expect(awardTier(1, [2, 3, 4])).to.equal(1);
        expect(awardTier(2, [2, 3, 4])).to.equal(1);
        expect(awardTier(3, [2, 3, 4])).to.equal(2);
        expect(awardTier(5, [2, 3, 4])).to.equal(2);
        expect(awardTier(9, [2, 3, 4])).to.equal(3);
        expect(awardTier(10, [2, 3, 4])).to.equal(0);
    });

    it('marks 7, 77 and 177 as 大吉 and other places ending in 7 as 小吉', () => {
        expect(luckyKind(7)).to.equal('big');
        expect(luckyKind(77)).to.equal('big');
        expect(luckyKind(177)).to.equal('big');
        expect(luckyKind(17)).to.equal('small');
        expect(luckyKind(237)).to.equal('small');
        expect(luckyKind(70)).to.equal(null);
        expect(luckyKind(171)).to.equal(null);
        expect(luckyKind(1)).to.equal(null);
    });

    it('ranks like the IOI scoreboard and keeps unofficial rows out of the places', () => {
        const board = build([
            person(3, { 101: [10, AC, 300] }),
            person(1, { 101: [10, AC, 100], 102: [20, AC, 200] }),
            person(2, { 101: [10, AC, 50], 102: [15, WA, 60] }, { unrank: true }),
            // Same score as uid 3 with the same problem count but less time, so it goes first.
            person(4, { 101: [10, AC, 120] }),
        ]);
        expect(board.rows.map((row) => [row.uid, row.rank])).to.deep.equal([[1, 1], [2, null], [4, 2], [3, 3]]);
    });

    it('gives fully tied rows the same place and skips the next one', () => {
        const board = build([
            person(1, { 101: [10, AC, 100] }),
            person(2, { 101: [10, AC, 100] }),
            person(3, { 101: [10, AC, 200] }),
        ]);
        expect(board.rows.map((row) => row.rank)).to.deep.equal([1, 1, 3]);
    });

    it('counts unofficial rows with 过题 ≥ 1 in the denominator but never awards them', () => {
        // 21 with 过题 ≥ 1 (one of them a star) → quotas ⌈1.05⌉ = 2, ⌈2.1⌉ = 3, ⌈3.15⌉ = 4.
        const star = person(900, { 101: [10, AC, 1], 102: [20, AC, 2], 103: [30, AC, 3] }, { unrank: true });
        const zero = person(901, { 101: [0, WA, 30] });
        const board = build([star, zero, ...field(20, 1)]);
        expect(board.awards.denominator).to.equal(21);
        expect(board.awards.quotas).to.deep.equal([2, 3, 4]);
        expect(board.rows[0].uid).to.equal(900);
        expect(board.rows[0].award).to.equal(0);
        const awardOf = (rank: number) => board.rows.find((row) => row.rank === rank)!.award;
        expect([1, 2, 3, 5, 6, 9, 10].map(awardOf)).to.deep.equal([1, 1, 2, 2, 3, 3, 0]);
        expect(board.awards.counts).to.deep.equal([2, 3, 4]);
        expect(board.rows.find((row) => row.uid === 901)!.award).to.equal(0);
    });

    it('gives everyone tied on a cut line the higher award', () => {
        // 20 people → quotas 1 / 2 / 3. Two people tie for first.
        const tied = [person(1, { 101: [10, AC, 100] }), person(2, { 101: [10, AC, 100] })];
        const board = build([...tied, ...field(18, 10)]);
        expect(board.rows.slice(0, 2).map((row) => [row.rank, row.award])).to.deep.equal([[1, 1], [1, 1]]);
        expect(board.rows[2].rank).to.equal(3);
        expect(board.rows[2].award).to.equal(2);
        expect(board.awards.counts[0]).to.equal(2);
    });

    it('marks lucky places only for official rows that passed a problem', () => {
        const board = build([...field(18, 1), person(800, { 101: [0, WA, 10] }), person(801, { 101: [10, AC, 9999] }, { unrank: true })]);
        const byRank = (rank: number) => board.rows.filter((row) => row.rank === rank);
        expect(byRank(7).map((row) => row.lucky)).to.deep.equal(['big']);
        expect(byRank(17).map((row) => row.lucky)).to.deep.equal(['small']);
        expect(byRank(16).map((row) => row.lucky)).to.deep.equal([null]);
        // The zero-score row sits at place 19; a lucky place would still need 过题 ≥ 1.
        const zero = board.rows.find((row) => row.uid === 800)!;
        expect(zero.passed).to.equal(0);
        expect(zero.lucky).to.equal(null);
        expect(board.rows.find((row) => row.uid === 801)!.lucky).to.equal(null);
    });

    it('withholds 小吉 from a zero-score row even when its place ends in 7', () => {
        const board = build([...field(16, 1), person(800, { 101: [0, WA, 10] })]);
        const zero = board.rows.find((row) => row.uid === 800)!;
        expect(zero.rank).to.equal(17);
        expect(zero.lucky).to.equal(null);
    });

    it('marks AK only when every problem is Accepted', () => {
        const board = build([
            person(1, { 101: [10, AC, 100], 102: [20, AC, 200], 103: [30, AC, 300] }),
            person(2, { 101: [10, AC, 100], 102: [20, AC, 200], 103: [29, WA, 300] }),
            person(3, { 101: [10, AC, 100], 102: [20, AC, 200] }),
            person(4, { 101: [10, AC, 50], 102: [20, AC, 60], 103: [30, AC, 70] }, { unrank: true }),
        ]);
        const ak = Object.fromEntries(board.rows.map((row) => [row.uid, row.ak]));
        expect(ak).to.deep.equal({ 1: true, 2: false, 3: false, 4: true });
    });

    it('takes first blood from the earliest Accepted, unofficial rows included', () => {
        const board = build([
            person(1, { 101: [10, AC, 300], 102: [20, AC, 100] }),
            person(2, { 101: [9, WA, 10], 102: [20, AC, 200] }),
            person(3, { 101: [10, AC, 200] }, { unrank: true }),
        ]);
        const cell = (uid: number, column: number) => board.rows.find((row) => row.uid === uid)!.cells[column]!;
        expect(cell(3, 0).firstBlood).to.equal(true);
        expect(cell(1, 0).firstBlood).to.equal(false);
        expect(cell(2, 0).firstBlood).to.equal(false);
        expect(cell(1, 1).firstBlood).to.equal(true);
        expect(cell(2, 1).firstBlood).to.equal(false);
    });

    it('keeps the scoreboard 过题, total time and empty time for a zero-score cell', () => {
        const board = build([person(1, { 101: [10, AC, 100], 102: [5, WA, 200], 103: [0, WA, 400] })]);
        const [row] = board.rows;
        expect(row.passed).to.equal(2);
        expect(row.seconds).to.equal(300);
        expect(row.cells.map((cell) => cell && [cell.score, cell.seconds, cell.full])).to.deep.equal([
            [10, 100, true],
            [5, 200, false],
            [0, null, false],
        ]);
    });

    it('applies the contest score weight to cells and full marks', () => {
        const board = buildPublicBoard({ ...CONTEST, score: { 103: 50 } }, PROBLEMS, [person(1, { 103: [30, AC, 100] }, { score: 15 })], TIERS);
        expect(board.rows[0].cells[2]!.score).to.equal(15);
        expect(board.columns.map((column) => column.maxScore)).to.deep.equal([10, 20, 15]);
        expect(board.maxScore).to.equal(45);
        expect(board.tiers.map((tier) => tier.maxScore)).to.deep.equal([30, 15]);
    });

    it('labels problems by tier and counts submissions and accepted people', () => {
        const board = build([
            person(1, { 101: [10, AC, 100] }, { journal: [{ pid: 101, status: WA }, { pid: 101, status: AC }, { pid: 101, status: AC }] }),
            person(2, { 101: [3, WA, 100] }, { journal: [{ pid: 101, status: WA }, { pid: 999, status: AC }] }),
        ]);
        expect(board.columns.map((column) => [column.label, column.tier])).to.deep.equal([['L1-1', 0], ['L1-2', 0], ['L2-1', 1]]);
        expect(board.columns[0].nSubmit).to.equal(4);
        expect(board.columns[0].nAccept).to.equal(1);
    });

    it('reports the lowest score in each award tier', () => {
        // 20 people → quotas 1 / 2 / 3, and scores differ inside each tier.
        const board = build([
            person(1, { 101: [10, AC, 100], 102: [20, AC, 100], 103: [30, AC, 100] }),
            person(2, { 101: [10, AC, 100], 102: [20, AC, 100] }),
            person(3, { 101: [10, AC, 100], 102: [15, WA, 100] }),
            person(4, { 101: [10, AC, 100], 102: [4, WA, 100] }),
            ...field(16, 10),
        ]);
        expect(board.awards.counts).to.deep.equal([1, 2, 3]);
        expect(board.awards.minScores).to.deep.equal([60, 25, 10]);
    });

    it('fails when the tiers do not cover the contest or a problem has no full mark', () => {
        expect(() => buildPublicBoard(CONTEST, PROBLEMS, [], [{ label: 'L1', name: '基础级', count: 2 }])).to.throw(/cover 2 problems/);
        expect(() => buildPublicBoard(CONTEST, { ...PROBLEMS, 103: { config: 'Cannot parse: x' } }, [], TIERS)).to.throw(/problem 103/);
        expect(() => buildPublicBoard(CONTEST, { ...PROBLEMS, 102: { config: { maxScore: 0 } } }, [], TIERS)).to.throw(/maxScore/);
    });
});
