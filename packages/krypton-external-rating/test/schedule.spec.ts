import { expect } from 'chai';
import { describe, it } from 'node:test';
import { emptyUserExternalRatingState } from '../src/types';
import { refreshExternalRatingBatch } from '../src/schedule';

function stateWithHandle(handle: string) {
    const state = emptyUserExternalRatingState();
    state.codeforces = { ...state.codeforces, handle };
    return state;
}

describe('scheduled external rating refresh', () => {
    it('continues after one user fails and waits between users', async () => {
        const saved: number[] = [];
        const slept: number[] = [];
        const now = new Date('2026-10-07T03:00:00+08:00');
        const result = await refreshExternalRatingBatch([
            { uid: 7, state: stateWithHandle('tourist') },
            { uid: 8, state: stateWithHandle('jiangly') },
        ], now, {
            gapMs: 25,
            sleep: async (ms) => {
                slept.push(ms);
            },
            async fetch(state, at, uid) {
                expect(at).to.equal(now);
                if (uid === 7) throw new Error('codeforces down');
                return { ...state, codeforces: { ...state.codeforces, rating: 1800, fetchedAt: at, lastError: null } };
            },
            async save(uid) {
                saved.push(uid);
            },
        });
        expect(result).to.deep.equal({ users: 2, saved: 1, failed: 1 });
        expect(saved).to.deep.equal([8]);
        expect(slept).to.deep.equal([25]);
    });

    it('does not sleep when there is nobody to refresh', async () => {
        let slept = 0;
        const result = await refreshExternalRatingBatch([], new Date(), {
            sleep: async () => {
                slept += 1;
            },
            async fetch() {
                throw new Error('fetch should not run');
            },
            async save() {
                throw new Error('save should not run');
            },
        });
        expect(result).to.deep.equal({ users: 0, saved: 0, failed: 0 });
        expect(slept).to.equal(0);
    });

    it('rejects an invalid timestamp before fetching', async () => {
        let called = 0;
        try {
            await refreshExternalRatingBatch([], new Date('not-a-date'), {
                async fetch() {
                    called += 1;
                    return emptyUserExternalRatingState();
                },
                async save() {
                    called += 1;
                },
            });
            expect.fail('invalid timestamp should throw');
        } catch (error) {
            expect(error).to.be.instanceOf(TypeError);
            expect((error as Error).message).to.match(/valid timestamp/);
        }
        expect(called).to.equal(0);
    });
});
