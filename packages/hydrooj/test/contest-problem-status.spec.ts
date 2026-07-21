import { expect } from 'chai';
import { describe, it } from 'node:test';
import { buildLatestContestProblemStatusByPid } from '../src/lib/contest-problem-status';

describe('Exam Mode contest problem status snapshots', () => {
    it('keeps an accepted result and otherwise selects the latest journal result', () => {
        const statuses = buildLatestContestProblemStatusByPid(
            [
                { pid: 1, rid: 'rid-1', status: 2 },
                { pid: 2, rid: 'rid-2', status: 3 },
                { pid: 1, rid: 'rid-3', status: 1 },
                { pid: 2, rid: 'rid-4', status: 7 },
                { pid: 1, rid: 'rid-5', status: 6 },
            ],
            [1, 2],
        );
        expect(statuses).to.deep.equal({
            1: { rid: 'rid-3', status: 1 },
            2: { rid: 'rid-4', status: 7 },
        });
    });

    it('rejects malformed canonical journal entries instead of hiding them', () => {
        expect(() => buildLatestContestProblemStatusByPid([{ pid: 1, rid: null, status: 2 }], [1])).to.throw(
            'Contest status journal entry 0 is malformed.',
        );
    });
});
