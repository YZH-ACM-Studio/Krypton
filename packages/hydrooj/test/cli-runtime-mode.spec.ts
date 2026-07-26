import { expect } from 'chai';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { shouldLoadHydroRuntime } from '../src/commands/runtime-mode';

describe('Hydro CLI runtime routing', () => {
    it('starts Hydro only for the server and explicit cli modes', () => {
        expect(shouldLoadHydroRuntime([], { '--': [] })).to.equal(true);
        expect(shouldLoadHydroRuntime(['cli'], { '--': [] })).to.equal(true);
        expect(shouldLoadHydroRuntime(['db'], { '--': [] })).to.equal(false);
    });

    it('never starts Hydro for top-level help flags', () => {
        expect(shouldLoadHydroRuntime([], { '--': [], help: true })).to.equal(false);
        expect(shouldLoadHydroRuntime([], { '--': [], h: true })).to.equal(false);
    });

    it('prints help and exits instead of leaving a Hydro server process behind', () => {
        const bin = resolve(__dirname, '../bin/hydrooj.js');
        const result = spawnSync(process.execPath, [bin, '--help'], {
            cwd: resolve(__dirname, '../../..'),
            encoding: 'utf8',
            timeout: 10_000,
        });

        expect(result.error?.message).not.to.match(/timed out/i);
        expect(result.status, result.stderr).to.equal(0);
        expect(result.stdout).to.include('Usage:');
    });
});
