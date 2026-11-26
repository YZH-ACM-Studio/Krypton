import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { emptyRoundScore, setScoreboardRows, hideSetScoreboardTotals } from '../src/lib/set-scoreboard';

describe('emptyRoundScore', () => {
    it('treats a missing round total as zero', () => {
        assert.equal(emptyRoundScore(undefined), 0);
        assert.equal(emptyRoundScore(null), 0);
        assert.throws(
            () => emptyRoundScore('40'),
            (error: unknown) => error instanceof TypeError && error.message === 'set_scoreboard_score_missing',
        );
    });
});

describe('setScoreboardRows', () => {
    it('sorts ACM by accepted count then penalty and excludes starred teams from ranks', () => {
        const board = setScoreboardRows([1], [
            { uid: 1, uname: 'later', score: 1, accept: 1, time: 1500, detail: { 1: { score: 1 } } },
            { uid: 2, uname: 'first', score: 1, accept: 1, time: 1200,
                detail: { 1: { score: 1, rid: new ObjectId(), naccept: 1, real: 120, penalty: 1200 } } },
            { uid: 3, uname: 'star', score: 2, accept: 2, time: 100, detail: {}, unrank: true },
            { uid: 4, uname: 'tied', score: 1, accept: 1, time: 1200, detail: { 1: { score: 1 } } },
        ], { codePolicy: 'acm' });
        assert.deepEqual(board[0].map((cell) => cell.type), ['rank', 'user', 'solved', 'time', 'problem']);
        assert.equal(board[0][4].value, 'A');
        assert.equal(board[2][4].type, 'record');
        assert.match(board[2][4].value, /^\+1\n/);
        assert.equal(board[2][4].score, 100);
        assert.ok(board[2][4].raw instanceof ObjectId);
        assert.deepEqual(board.slice(1).map((row) => [row[0].value, row[1].raw, row[3].raw]), [
            ['*', 3, 100], ['1', 2, 1200], ['1', 4, 1200], ['3', 1, 1500],
        ]);
        assert.throws(() => setScoreboardRows([], [{ uid: 1, uname: 'bad', score: 1, detail: {} }], { codePolicy: 'acm' }),
            /set_scoreboard_acm_result_missing/);
    });

    it('uses the status score and ignores a journal', () => {
        const input = [
            {
                uid: 4,
                uname: 'ada',
                score: 40,
                detail: {
                    7: { score: 40, journal: [{ score: 5 }] },
                },
                journal: [
                    { pid: 7, score: 1 },
                    { pid: 8, score: 99 },
                ],
            },
        ];
        const board = setScoreboardRows([7, 8], input);
        assert.deepEqual(
            board[0].map((cell) => [cell.type, cell.value, cell.raw]),
            [
                ['rank', '#', undefined],
                ['user', 'User', undefined],
                ['total_score', 'Total Score', undefined],
                ['problem', '7', 7],
                ['problem', '8', 8],
            ],
        );
        const row = board[1];
        assert.equal(row[2].type, 'total_score');
        assert.equal(row[2].value, '40');
        assert.equal(row[2].score, 40);
        assert.equal(row[3].value, '40');
        assert.equal(row[3].score, 40);
        assert.equal(row[4].value, '-');
        assert.equal(row[4].score, null);
        assert.equal(input[0].journal[1].score, 99);
    });

    it('throws when the status score is missing', () => {
        const missing = {
            uid: 3,
            uname: 'missing',
            detail: { 1: { score: 0 } },
        };
        assert.throws(
            () => setScoreboardRows([1], [missing as { uid: number; uname: string; score: number; detail: { 1: { score: number } } }]),
            (error: unknown) => error instanceof TypeError && error.message === 'set_scoreboard_score_missing',
        );
    });

    it('shares a rank and skips the next one', () => {
        const input = [
            { uid: 1, uname: 'low', score: 8, detail: null },
            { uid: 30, uname: 'high-b', score: 10, detail: null },
            { uid: 20, uname: 'high-a', score: 10, detail: null },
        ];
        const order = input.map((row) => row.uid);
        const board = setScoreboardRows([], input);
        assert.deepEqual(input.map((row) => row.uid), order);
        assert.deepEqual(
            board.slice(1).map((row) => [row[0].value, row[1].raw]),
            [
                ['1', 20],
                ['1', 30],
                ['3', 1],
            ],
        );
    });

    it('keeps the team name and members on the user cell', () => {
        const board = setScoreboardRows(
            [1],
            [
                {
                    uid: 9,
                    uname: 'Team Alpha',
                    score: 5,
                    detail: { 1: { score: 5 } },
                    team: { name: 'Team Alpha', captainUid: 9, memberUids: [9, 10] },
                },
            ],
        );
        const user = board[1][1];
        assert.equal(user.type, 'user');
        assert.equal(user.value, 'Team Alpha');
        assert.equal(user.raw, 9);
        assert.equal(user.team?.name, 'Team Alpha');
        assert.deepEqual(user.team?.memberUids, [9, 10]);
        assert.equal(user.team?.captainUid, 9);
    });
});

it('removes total and rank cells and their original score-sorted order', () => {
    const rows = setScoreboardRows([7], [
        { uid: 9, uname: 'high', score: 90, detail: {} },
        { uid: 2, uname: 'low', score: 10, detail: {} },
    ]);
    const safe = hideSetScoreboardTotals(rows);
    assert.deepEqual(safe[0].map((cell) => cell.type), ['user', 'problem']);
    assert.deepEqual(safe.slice(1).map((row) => row[0].raw), [2, 9]);
    assert.equal(JSON.stringify(safe).includes('total_score'), false);
    assert.equal(JSON.stringify(safe).includes('90'), false);
});

it('ranks the chosen paper by rate and keeps equal rates tied across different maxima', () => {
    const board = setScoreboardRows([], [
        { uid: 1, uname: 'a', score: 75, maxPoints: 100, detail: {} },
        { uid: 2, uname: 'b', score: 72, maxPoints: 90, detail: {} },
        { uid: 3, uname: 'c', score: 80, maxPoints: 100, detail: {} },
        { uid: 4, uname: 'd', score: 1.36, maxPoints: 1.70, detail: {} },
    ]);
    assert.deepEqual(board.slice(1).map(([rank, user, total]) => [rank.value, user.raw, total.value]), [
        ['1', 2, '72/90'], ['1', 3, '80/100'], ['1', 4, '1.36/1.7'], ['4', 1, '75/100'],
    ]);
});
