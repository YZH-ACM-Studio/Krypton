import { expect } from 'chai';
import { after, before, describe, it } from 'node:test';

const Module = require('module');
const commonPath = require.resolve('../src/entry/common.ts');
const originalLoad = Module._load;
const modelPathSuffix = '/model/endpoint-seat-binding.ts';
let builtinModel: typeof import('../src/entry/common').builtinModel;

describe('built-in model readiness', () => {
    before(() => {
        Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
            if (request === '../lib/index') return {};
            if (request === 'fs-extra') {
                return {
                    readdir: async () => ['endpoint-seat-binding.ts'],
                };
            }
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
            builtinModel = require(commonPath).builtinModel;
        } finally {
            Module._load = originalLoad;
        }
    });

    after(() => {
        delete require.cache[commonPath];
        Module._load = originalLoad;
    });

    async function withBuiltInModule(run: () => Promise<void>) {
        Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
            if (request.endsWith(modelPathSuffix)) return { apply: async () => {} };
            return originalLoad.call(this, request, parent, isMain);
        };
        try {
            await run();
        } finally {
            Module._load = originalLoad;
        }
    }

    it('does not return until asynchronous model activation is complete', async () => {
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

        await withBuiltInModule(async () => {
            await builtinModel(ctx as never);
        });
        events.push('returned');

        expect(events).to.deep.equal(['registered', 'active', 'returned']);
    });

    it('propagates asynchronous model activation failure', async () => {
        const failure = new Error('endpoint seat indexes unavailable');
        let caught: unknown;
        const ctx = {
            loader: {
                async reloadPlugin() {
                    return {
                        async await() {
                            throw failure;
                        },
                    };
                },
            },
        };

        await withBuiltInModule(async () => {
            try {
                await builtinModel(ctx as never);
            } catch (error) {
                caught = error;
            }
        });

        expect(caught).to.equal(failure);
    });
});
