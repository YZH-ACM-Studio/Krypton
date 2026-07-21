import { expect } from 'chai';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { withContestTeamBoundary } from '../src/model/contest-team-gate';

describe('P1.17 contest team visibility boundary', () => {
    it('serializes readers and writers for the same contest', async () => {
        const contestId = new ObjectId();
        const order: string[] = [];
        let releaseFirst!: () => void;
        const blocked = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const first = withContestTeamBoundary('system', contestId, async () => {
            order.push('write-start');
            await blocked;
            order.push('write-end');
        });
        await Promise.resolve();
        const reader = withContestTeamBoundary('system', contestId, async () => {
            order.push('read');
        });
        await Promise.resolve();
        expect(order).to.deep.equal(['write-start']);
        releaseFirst();
        await Promise.all([first, reader]);
        expect(order).to.deep.equal(['write-start', 'write-end', 'read']);
    });

    it('does not serialize independent contests', async () => {
        const firstContestId = new ObjectId();
        const secondContestId = new ObjectId();
        let releaseFirst!: () => void;
        const blocked = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const first = withContestTeamBoundary('system', firstContestId, () => blocked);
        let secondCompleted = false;
        await withContestTeamBoundary('system', secondContestId, async () => {
            secondCompleted = true;
        });
        expect(secondCompleted).to.equal(true);
        releaseFirst();
        await first;
    });
});
