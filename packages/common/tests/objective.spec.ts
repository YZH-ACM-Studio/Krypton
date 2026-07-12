import { expect } from 'chai';
import { describe, it } from 'node:test';
import { gradeObjectiveAnswer } from '../objective';

describe('single-problem objective grading', () => {
    it('grades single and case-sensitive blank answers exactly', () => {
        expect(gradeObjectiveAnswer(['B', 100, { kind: 'single' }], 'B')).to.deep.equal({ outcome: 'correct', score: 100 });
        expect(gradeObjectiveAnswer(['B', 100, { kind: 'single' }], 'A').score).to.equal(0);
        const blank = ['Answer\nLine', 100, { kind: 'blank' }] as any;
        expect(gradeObjectiveAnswer(blank, '  Answer\r\nLine\n')).to.deep.equal({ outcome: 'correct', score: 100 });
        expect(gradeObjectiveAnswer(blank, 'answer\nLine').score).to.equal(0);
    });

    it('rejects array-shaped submissions for every scalar objective kind', () => {
        for (const entry of [
            ['B', 100, { kind: 'single' }],
            ['A', 100, { kind: 'true_false' }],
            ['Answer', 100, { kind: 'blank' }],
        ] as any[]) {
            expect(gradeObjectiveAnswer(entry, [entry[0], 'ignored'])).to.deep.equal({ outcome: 'wrong', score: 0 });
        }
    });

    it('applies configured multi partial credit only to non-empty correct proper subsets', () => {
        const entry = [['A', 'C'], 100, { kind: 'multi', partialCreditPercent: 35 }] as any;
        expect(gradeObjectiveAnswer(entry, ['A'])).to.deep.equal({ outcome: 'partial', score: 35 });
        expect(gradeObjectiveAnswer(entry, ['A', 'C'])).to.deep.equal({ outcome: 'correct', score: 100 });
        expect(gradeObjectiveAnswer(entry, ['A', 'B'])).to.deep.equal({ outcome: 'wrong', score: 0 });
        expect(gradeObjectiveAnswer(entry, [])).to.deep.equal({ outcome: 'wrong', score: 0 });
        expect(gradeObjectiveAnswer([['A', 'C'], 100, { kind: 'multi', partialCreditPercent: 0 }], ['A']).score).to.equal(0);
        expect(gradeObjectiveAnswer([['A', 'C'], 100, { kind: 'multi', partialCreditPercent: 100 }], ['A'])).to.deep.equal({
            outcome: 'partial',
            score: 100,
        });
    });

    it('preserves the legacy half-credit rule when no percentage is stored', () => {
        expect(gradeObjectiveAnswer([['A', 'C'], 80, { kind: 'multi' }], ['A'])).to.deep.equal({ outcome: 'partial', score: 40 });
    });
});
