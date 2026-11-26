import { describe, it } from 'node:test';
import { expect } from 'chai';
import type { ScoreboardRow } from '../src/interface';
import { maskHomeworkObjectiveScoreboard } from '../src/lib/homework-objective-verdict';

function board(): ScoreboardRow[] {
    const header = [
        { type: 'rank' as const, value: 'Rank' },
        { type: 'user' as const, value: 'User' },
        { type: 'total_score' as const, value: 'Score' },
        { type: 'problem' as const, value: 'A', raw: 1 },
        { type: 'problem' as const, value: 'B', raw: 2 },
        { type: 'time' as const, value: 'Total Time' },
    ] as ScoreboardRow;
    const first = [
        { type: 'rank' as const, value: '1' },
        { type: 'user' as const, value: 'alice', raw: 2 },
        { type: 'string' as const, value: '180' },
        { type: 'record' as const, value: '100\n1:00', score: 100 },
        { type: 'record' as const, value: '80\n2:00', score: 80 },
        { type: 'time' as const, value: '9:00', raw: 32400 },
    ] as ScoreboardRow;
    const second = [
        { type: 'rank' as const, value: '2' },
        { type: 'user' as const, value: 'bob', raw: 3 },
        { type: 'string' as const, value: '100' },
        { type: 'record' as const, value: '0\n0:30', score: 0 },
        { type: 'record' as const, value: '100\n1:10', score: 100 },
        { type: 'time' as const, value: '8:00', raw: 28800 },
    ] as ScoreboardRow;
    return [header, first, second];
}

describe('homework objective scoreboard mask', () => {
    it('hides objective scores and ranks by programming scores', () => {
        const kinds = new Map<number, 'true_false' | 'programming'>([[1, 'true_false'], [2, 'programming']]);
        const rows = maskHomeworkObjectiveScoreboard(board(), kinds);
        expect(rows[1]?.[0]?.value).to.equal('1');
        expect(rows[1]?.[1]?.value).to.equal('bob');
        expect(rows[1]?.[2]?.value).to.equal('100');
        expect(rows[1]?.[3]?.value).to.equal('待评测');
        expect(rows[1]?.[3]?.score).to.equal(undefined);
        expect(rows[1]?.[4]?.value).to.equal('100\n1:10');
        expect(rows[1]?.[5]?.value).to.equal('1:10');
        expect(rows[2]?.[1]?.value).to.equal('alice');
        expect(rows[2]?.[2]?.value).to.equal('80');
        expect(rows[2]?.[3]?.value).to.equal('待评测');
        expect(rows[2]?.[5]?.value).to.equal('2:00');
    });
});
