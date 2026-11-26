import { describe, it } from 'node:test';
import { expect } from 'chai';
import { setProblemFact } from '../src/lib/set-problem-fact';

function codeOf(run: () => void): string {
    try {
        run();
    } catch (error) {
        if (error instanceof TypeError) return error.message;
        throw error;
    }
    throw new Error('expected a TypeError');
}

describe('problem set problem facts', () => {
    it('treats compile program-fill as judged and text program-fill as objective', () => {
        expect(setProblemFact({ problemKind: 'program_fill', config: { mode: 'compile' } })).to.deep.equal({
            kind: 'program_fill',
            judged: true,
        });
        expect(setProblemFact({ problemKind: 'program_fill', config: { mode: 'text' } })).to.deep.equal({
            kind: 'program_fill',
            judged: false,
        });
        expect(setProblemFact({ problemKind: 'programming' }).judged).to.equal(true);
        expect(setProblemFact({}).kind).to.equal('programming');
        expect(setProblemFact({ problemKind: 'blank' }).judged).to.equal(false);
        expect(codeOf(() => setProblemFact({ problemKind: 'program_fill' }))).to.equal('set_problem_mode_invalid');
        expect(codeOf(() => setProblemFact({ problemKind: 'nope' }))).to.equal('Unknown problem kind: nope');
    });
});
