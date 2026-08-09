import { expect } from 'chai';
import { describe, it } from 'node:test';

const Module = require('module');
const commonPath = require.resolve('../src/entry/common.ts');
const originalLoad = Module._load;

let builtinModel: typeof import('../src/entry/common').builtinModel;

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (request === '../lib/index') return {};
    if (request === 'fs-extra') return { readdir: async () => ['delayed.ts'] };
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
    if (request === '../utils') return { isClass: () => false, unwrapExports: (value: unknown) => value };
    return originalLoad.call(this, request, parent, isMain);
};
try {
    delete require.cache[commonPath];
    builtinModel = require(commonPath).builtinModel;
} finally {
    Module._load = originalLoad;
}

async function runWithFixture(ctx: unknown) {
    Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
        if (request.endsWith('/model/delayed.ts')) return { apply() {} };
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        await builtinModel(ctx as never);
    } finally {
        Module._load = originalLoad;
    }
}

describe('builtin model readiness', () => {
    it('does not return until asynchronous builtin model activation is complete', async () => {
        const events: string[] = [];
        const ctx = {
            loader: {
                async reloadPlugin() {
                    events.push('registered');
                    return {
                        async await() {
                            await new Promise<void>((resolve) => {
                                setImmediate(() => {
                                    events.push('active');
                                    resolve();
                                });
                            });
                        },
                    };
                },
            },
        };

        await runWithFixture(ctx);
        events.push('returned');

        expect(events).to.deep.equal(['registered', 'active', 'returned']);
    });

    it('rejects readiness when builtin model activation fails', async () => {
        const failure = new Error('index creation failed');
        const ctx = {
            loader: {
                async reloadPlugin() {
                    return { await: async () => Promise.reject(failure) };
                },
            },
        };

        let actual: unknown;
        try {
            await runWithFixture(ctx);
        } catch (error) {
            actual = error;
        }
        expect(actual).to.equal(failure);
    });
});
