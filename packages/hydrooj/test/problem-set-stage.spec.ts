import { expect } from 'chai';
import { describe, it } from 'node:test';
import { computePrerequisiteClosure, ProblemSetStageGraphError, prerequisitesCompleted } from '../src/lib/problem-set-stage';

const linear = [
    { _id: 1, title: 'A', requireNids: [], pids: [1] },
    { _id: 2, title: 'B', requireNids: [1], pids: [2] },
    { _id: 3, title: 'C', requireNids: [2], pids: [3] },
];

const branched = [
    { _id: 1, title: 'A', requireNids: [], pids: [1] },
    { _id: 2, title: 'B', requireNids: [], pids: [2] },
    { _id: 3, title: 'C', requireNids: [1, 2], pids: [3] },
];

describe('P3.5 problem set stage DAG closure', () => {
    it('collects a linear and multi-prerequisite closure including the target', () => {
        expect(computePrerequisiteClosure(linear, 3)).to.deep.equal([1, 2, 3]);
        expect(computePrerequisiteClosure(branched, 3).sort((a, b) => a - b)).to.deep.equal([1, 2, 3]);
        expect(computePrerequisiteClosure(linear, 1)).to.deep.equal([1]);
    });

    it('fails closed on missing stages and cycles', () => {
        expect(() => computePrerequisiteClosure(linear, 9)).to.throw(ProblemSetStageGraphError, /not in the published DAG/);
        expect(() =>
            computePrerequisiteClosure(
                [
                    { _id: 1, title: 'A', requireNids: [2], pids: [1] },
                    { _id: 2, title: 'B', requireNids: [1], pids: [2] },
                ],
                1,
            ),
        ).to.throw(ProblemSetStageGraphError, /cycle/);
    });

    it('separates access closure from completion', () => {
        expect(prerequisitesCompleted(linear[1], new Set())).to.equal(false);
        expect(prerequisitesCompleted(linear[1], new Set([1]))).to.equal(true);
        expect(prerequisitesCompleted(branched[2], new Set([1]))).to.equal(false);
        expect(prerequisitesCompleted(branched[2], new Set([1, 2]))).to.equal(true);
    });
});
