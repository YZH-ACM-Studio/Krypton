import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import {
    commitLockoutCache,
    getLockoutCacheGeneration,
    invalidateLockoutCache,
    readLockoutCache,
    type LockoutCacheEntry,
} from '../src/lockout-cache';

function liveEntry(decision: LockoutCacheEntry['decision'] = null): LockoutCacheEntry {
    return { decision, expiresAt: Date.now() + 60_000 };
}

function lockedEntry(contestId: string): LockoutCacheEntry {
    return liveEntry({ contestId, blockEnd: Date.now() + 60_000, title: contestId });
}

describe('lockout cache invalidate API', () => {
    beforeEach(() => {
        invalidateLockoutCache();
    });

    it('exports invalidate and generation from the plugin model without replacing the existing mount', () => {
        const pluginSource = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');
        expect(pluginSource).to.include("import { getLockoutCacheGeneration, invalidateLockoutCache } from './src/lockout-cache';");
        expect(pluginSource).to.include('getLockoutCacheGeneration,');
        expect(pluginSource).to.match(/export const vigilGuardModel = \{[\s\S]*invalidateLockoutCache,/);
        expect(pluginSource).to.include('(global as any).Hydro.model.vigilguard = vigilGuardModel');
        expect(pluginSource).to.not.include('contest/team-role-change');
        expect(pluginSource).to.not.include('postAttend');
    });

    it('advances generation on every invalidate, including an empty flush', () => {
        const generation = getLockoutCacheGeneration();
        invalidateLockoutCache();
        expect(getLockoutCacheGeneration()).to.equal(generation + 1);
        invalidateLockoutCache('system');
        expect(getLockoutCacheGeneration()).to.equal(generation + 2);
        invalidateLockoutCache('system', 1);
        expect(getLockoutCacheGeneration()).to.equal(generation + 3);
    });

    it('drops only the exact (domainId, uid) entry', () => {
        const generation = getLockoutCacheGeneration();
        expect(commitLockoutCache('system', 1, lockedEntry('a'), generation)).to.equal(true);
        expect(commitLockoutCache('system', 2, lockedEntry('b'), generation)).to.equal(true);
        expect(commitLockoutCache('other', 1, lockedEntry('c'), generation)).to.equal(true);

        invalidateLockoutCache('system', 1);
        expect(readLockoutCache('system', 1)).to.equal(null);
        expect(readLockoutCache('system', 2)?.decision).to.include({ contestId: 'b' });
        expect(readLockoutCache('other', 1)?.decision).to.include({ contestId: 'c' });
        expect(getLockoutCacheGeneration()).to.equal(generation + 1);
    });

    it('drops every entry in a domain and leaves other domains intact', () => {
        const generation = getLockoutCacheGeneration();
        expect(commitLockoutCache('system', 1, lockedEntry('a'), generation)).to.equal(true);
        expect(commitLockoutCache('system', 2, lockedEntry('b'), generation)).to.equal(true);
        expect(commitLockoutCache('system2', 1, lockedEntry('c'), generation)).to.equal(true);

        invalidateLockoutCache('system');
        expect(readLockoutCache('system', 1)).to.equal(null);
        expect(readLockoutCache('system', 2)).to.equal(null);
        expect(readLockoutCache('system2', 1)?.decision).to.include({ contestId: 'c' });
        expect(getLockoutCacheGeneration()).to.equal(generation + 1);
    });

    it('flushes every domain when called without arguments', () => {
        const generation = getLockoutCacheGeneration();
        expect(commitLockoutCache('system', 1, liveEntry(), generation)).to.equal(true);
        expect(commitLockoutCache('other', 2, liveEntry(), generation)).to.equal(true);

        invalidateLockoutCache();
        expect(readLockoutCache('system', 1)).to.equal(null);
        expect(readLockoutCache('other', 2)).to.equal(null);
        expect(getLockoutCacheGeneration()).to.equal(generation + 1);
    });

    it('rejects a commit that still holds a pre-invalidate generation', () => {
        const staleGeneration = getLockoutCacheGeneration();
        invalidateLockoutCache('system', 8);
        expect(commitLockoutCache('system', 8, lockedEntry('stale'), staleGeneration)).to.equal(false);
        expect(readLockoutCache('system', 8)).to.equal(null);

        const current = getLockoutCacheGeneration();
        expect(commitLockoutCache('system', 8, lockedEntry('fresh'), current)).to.equal(true);
        expect(readLockoutCache('system', 8)?.decision).to.include({ contestId: 'fresh' });
    });

    it('does not cache an already-expired decision even on the current generation', () => {
        const generation = getLockoutCacheGeneration();
        expect(commitLockoutCache('system', 9, { decision: null, expiresAt: Date.now() }, generation)).to.equal(false);
        expect(readLockoutCache('system', 9)).to.equal(null);
        expect(getLockoutCacheGeneration()).to.equal(generation);
    });

    it('treats a missing uid as a domain flush, matching the existing public signature', () => {
        const generation = getLockoutCacheGeneration();
        expect(commitLockoutCache('system', 1, liveEntry(), generation)).to.equal(true);
        expect(commitLockoutCache('system', 2, liveEntry(), generation)).to.equal(true);

        invalidateLockoutCache('system', 0);
        expect(readLockoutCache('system', 1)).to.equal(null);
        expect(readLockoutCache('system', 2)).to.equal(null);
        expect(getLockoutCacheGeneration()).to.equal(generation + 1);
    });
});
