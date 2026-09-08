import { expect } from 'chai';
import { describe, it } from 'node:test';
import { nextSolutionVote } from '../src/lib/solution-vote';

describe('solution vote toggle', () => {
    it('sets 1 from empty, then cancels the same upvote', () => {
        expect(nextSolutionVote(undefined, 1)).to.equal(1);
        expect(nextSolutionVote(0, 1)).to.equal(1);
        expect(nextSolutionVote(1, 1)).to.equal(0);
    });

    it('switches downvote to upvote and cancels a repeated downvote', () => {
        expect(nextSolutionVote(-1, 1)).to.equal(1);
        expect(nextSolutionVote(1, -1)).to.equal(-1);
        expect(nextSolutionVote(-1, -1)).to.equal(0);
    });

    it('rejects votes other than 1 or -1', () => {
        expect(() => nextSolutionVote(0, 0 as 1 | -1)).to.throw(TypeError);
    });
});
