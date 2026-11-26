import { expect } from 'chai';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { withContestTeamBoundary } from '../src/model/contest-team-gate';

describe('P1.17 contest team visibility boundary', () => {
    it('expires inherited ownership before a detached task re-enters after release', async () => {
        const tid = new ObjectId();
        const order: string[] = [];
        let startDetached!: () => void;
        const detachedStart = new Promise<void>((resolve) => { startDetached = resolve; });
        let detached!: Promise<void>;
        await withContestTeamBoundary('system', tid, async () => {
            detached = detachedStart.then(() => withContestTeamBoundary('system', tid, async () => { order.push('detached'); }));
        });
        let releaseOwner!: () => void;
        const ownerBlock = new Promise<void>((resolve) => { releaseOwner = resolve; });
        const owner = withContestTeamBoundary('system', tid, async () => {
            order.push('owner');
            await ownerBlock;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        startDetached();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(order).to.deep.equal(['owner']);
        releaseOwner();
        await Promise.all([owner, detached]);
        expect(order).to.deep.equal(['owner', 'detached']);
    });

    it('waits for reentrant work already entered before releasing the outer boundary', async () => {
        const tid = new ObjectId();
        let releaseNested!: () => void;
        const nestedBlock = new Promise<void>((resolve) => { releaseNested = resolve; });
        let nested!: Promise<void>;
        const order: string[] = [];
        const outer = withContestTeamBoundary('system', tid, async () => {
            nested = withContestTeamBoundary('system', tid, async () => {
                order.push('nested');
                await nestedBlock;
            });
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        const competitor = withContestTeamBoundary('system', tid, async () => { order.push('competitor'); });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(order).to.deep.equal(['nested']);
        releaseNested();
        await Promise.all([outer, nested, competitor]);
        expect(order).to.deep.equal(['nested', 'competitor']);
    });

    it('allows nested team reads while retaining the outer exclusion', async () => {
        const contestId = new ObjectId();
        const order: string[] = [];
        let release!: () => void;
        const blocked = new Promise<void>((resolve) => { release = resolve; });
        const owner = withContestTeamBoundary('system', contestId, async () => {
            await withContestTeamBoundary('system', contestId, async () => { order.push('nested-read'); });
            await blocked;
            order.push('write');
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        const competitor = withContestTeamBoundary('system', contestId, async () => { order.push('competitor'); });
        await Promise.resolve();
        expect(order).to.deep.equal(['nested-read']);
        release();
        await Promise.all([owner, competitor]);
        expect(order).to.deep.equal(['nested-read', 'write', 'competitor']);
    });

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
