import { expect } from 'chai';
import { describe, it } from 'node:test';
import { cacheKeyMatchesIdentity, loadAndCommitWhenGenerationIsStable, UserCacheGenerationTracker } from '../src/lib/user-cache-generation';

async function captureError(work: () => Promise<unknown>) {
    try {
        await work();
    } catch (error) {
        return error as Error;
    }
    throw new Error('Expected operation to fail');
}

describe('user cache generation guard', () => {
    it('matches the complete identity when a legal username contains a slash', () => {
        const identities = ['id/42', 'name/team/a', 'mail/team@example.com'];

        expect(cacheKeyMatchesIdentity('name/team/a/system', identities)).to.equal(true);
        expect(cacheKeyMatchesIdentity('name/team/system', identities)).to.equal(false);
        expect(cacheKeyMatchesIdentity('name/team/a/another-domain', identities)).to.equal(true);
    });

    it('discards a late old-name lookup that resumes after the final invalidation', async () => {
        const tracker = new UserCacheGenerationTracker();
        let attempt = 0;
        let releaseFirst: () => void = () => undefined;
        let firstStarted: () => void = () => undefined;
        const started = new Promise<void>((resolve) => {
            firstStarted = resolve;
        });
        const release = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const cached: string[] = [];

        const resultPromise = loadAndCommitWhenGenerationIsStable(
            () => tracker.snapshot('name/old-name', 'system'),
            async () => {
                attempt++;
                if (attempt === 1) {
                    firstStarted();
                    await release;
                    return 'old-name';
                }
                return null;
            },
            (candidate) => {
                if (candidate) cached.push(candidate);
                return candidate;
            },
        );

        await started;
        tracker.invalidateIdentities(['name/old-name']);
        releaseFirst();
        const result = await resultPromise;

        expect(result).to.equal(null);
        expect(attempt).to.equal(2);
        expect(cached).to.deep.equal([]);
    });

    it('ignores repeated invalidations for unrelated users', async () => {
        const tracker = new UserCacheGenerationTracker();
        let attempts = 0;

        const result = await loadAndCommitWhenGenerationIsStable(
            () => tracker.snapshot('id/42', 'system'),
            async () => {
                attempts++;
                tracker.invalidateIdentities([`id/${100 + attempts}`]);
                return 'real-user';
            },
            (candidate) => candidate,
        );

        expect(result).to.equal('real-user');
        expect(attempts).to.equal(1);
    });

    it('raises an explicit conflict instead of returning not-found after repeated same-identity churn', async () => {
        const tracker = new UserCacheGenerationTracker();
        let attempts = 0;

        const error = await captureError(() =>
            loadAndCommitWhenGenerationIsStable(
                () => tracker.snapshot('id/42', 'system'),
                async () => {
                    attempts++;
                    tracker.invalidateIdentities(['id/42']);
                    return 'real-user';
                },
                (candidate) => candidate,
            ),
        );

        expect(attempts).to.equal(2);
        expect(`${error.message} ${((error as any).params || []).join(' ')}`).to.match(/changed|retry|变化|重试/i);
    });
});
