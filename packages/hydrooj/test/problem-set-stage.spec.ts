import { expect } from 'chai';
import { describe, it } from 'node:test';
import {
    computePrerequisiteClosure,
    ProblemSetStageGraphError,
    problemSetIntroPids,
    problemSetStageIsAccessible,
    prerequisitesCompleted,
    serializeProblemSetIntro,
} from '../src/lib/problem-set-stage';

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

const emptyProgress = {
    psdict: {},
    publishedIntegrity: null,
    contextualDoneByScope: null,
    selfContextualDoneByScope: null,
};

describe('problem set intro serializer', () => {
    it('dumps every published stage title and pid when stageAccess is partial', () => {
        const tdoc = {
            dag: [
                { _id: 1, title: 'Open', requireNids: [], pids: [11] },
                { _id: 2, title: 'Locked', requireNids: [1], pids: [12, 13] },
            ],
        };
        const intro = serializeProblemSetIntro(tdoc, { accessible: true, stageAccess: [1] }, emptyProgress);
        expect(problemSetIntroPids(tdoc)).to.deep.equal([11, 12, 13]);
        expect(intro.pids).to.deep.equal([11, 12, 13]);
        expect(intro.ndict[1]).to.include({ title: 'Open' });
        expect(intro.ndict[2]).to.deep.include({ title: 'Locked', pids: [12, 13] });
        expect(intro.nsdict[1]).to.include({ hasAccess: true, isOpen: true });
        expect(intro.nsdict[2]).to.include({ hasAccess: false, lockReason: 'no_access', isInvalid: true });
        expect(intro.totalProblemCount).to.equal(3);
        expect(problemSetStageIsAccessible({ accessible: true, stageAccess: [1] }, 2)).to.equal(false);
    });

    it('counts scoped completion independently per stage and ignores global AC while controlled', () => {
        const tdoc = {
            dag: [
                { _id: 1, title: 'Stage one', requireNids: [], pids: [11, 12] },
                { _id: 2, title: 'Stage two', requireNids: [1], pids: [11] },
            ],
        };
        const intro = serializeProblemSetIntro(
            tdoc,
            { accessible: true, stageAccess: 'all' },
            {
                psdict: { 11: { status: 1 }, 12: { status: 1 } },
                publishedIntegrity: { revision: 1 },
                contextualDoneByScope: new Map([[1, new Set([11])]]),
                selfContextualDoneByScope: null,
            },
        );
        expect(intro.nsdict[1]).to.include({ progress: 50, isDone: false });
        expect(intro.nsdict[1].donePids).to.deep.equal([11]);
        expect(intro.nsdict[2].donePids).to.deep.equal([]);
        expect(intro).to.include({ completedProblemCount: 1, totalProblemCount: 3, done: false });
    });

    it('uses global AC only when the set is not integrity-controlled', () => {
        const tdoc = { dag: [{ _id: 1, title: 'Stage', requireNids: [], pids: [11, 12] }] };
        const intro = serializeProblemSetIntro(
            tdoc,
            { accessible: true, stageAccess: 'all' },
            {
                psdict: { 11: { status: 2 }, 12: { status: 1 } },
                publishedIntegrity: null,
                contextualDoneByScope: null,
                selfContextualDoneByScope: null,
            },
        );
        expect(intro.nsdict[1]).to.include({ progress: 50, isDone: false, isProgress: 2, isOpen: false });
        expect(intro.donePids).to.deep.equal([12]);
    });
});
