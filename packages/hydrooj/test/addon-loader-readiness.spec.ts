import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'chai';
import { after, before, describe, it } from 'node:test';

const Module = require('module');
const commonPath = require.resolve('../src/entry/common.ts');
const originalLoad = Module._load;
let addon: typeof import('../src/entry/common').addon;
let fixtureDir: string;

describe('addon loader readiness', () => {
    before(() => {
        Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
            if (request === '../lib/index') return {};
            if (request === '../context') return {};
            if (request === '../logger') {
                return {
                    Logger: class {
                        info() {}
                        error() {}
                    },
                };
            }
            if (request === '../model/builtin') return { PRIV: { PRIV_VIEW_SYSTEM_NOTIFICATION: 0 } };
            if (request === '../utils') {
                return {
                    isClass: () => false,
                    unwrapExports: (module: unknown) => module,
                };
            }
            return originalLoad.call(this, request, parent, isMain);
        };
        try {
            delete require.cache[commonPath];
            addon = require(commonPath).addon;
        } finally {
            Module._load = originalLoad;
        }

        fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydro-addon-readiness-'));
        fs.writeFileSync(path.join(fixtureDir, 'index.js'), 'exports.apply = async () => {};');
    });

    after(() => {
        delete require.cache[commonPath];
        fs.rmSync(fixtureDir, { recursive: true, force: true });
    });

    it('does not return until asynchronous addon activation is complete', async () => {
        const events: string[] = [];
        const fiber = {
            async await() {
                await new Promise<void>((resolve) => {
                    setImmediate(() => {
                        events.push('active');
                        resolve();
                    });
                });
            },
        };
        const ctx = {
            loader: {
                async reloadPlugin() {
                    events.push('registered');
                    return fiber;
                },
            },
        };

        await addon({ fixture: fixtureDir }, [], ctx as never);
        events.push('returned');

        expect(events).to.deep.equal(['registered', 'active', 'returned']);
    });
});
