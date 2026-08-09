import { expect } from 'chai';
import { describe, it } from 'node:test';

const Module = require('module');
const builtinPath = require.resolve('../src/hosts/builtin.ts');
const originalLoad = Module._load;

let updateStatus: () => Promise<void> = async () => undefined;
let destroyConsumer: () => Promise<void> = async () => undefined;
let consumeCalls = 0;

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename !== builtinPath) return originalLoad.call(this, request, parent, isMain);
    if (request === '@hydrooj/utils') return { fs: { ensureDir: async () => undefined } };
    if (request === '@hydrooj/utils/lib/sysinfo') return { get: async () => ({ mid: 'builtin-test' }) };
    if (request === 'hydrooj/src/model/setting') return { langs: {} };
    if (request === '../config') {
        return {
            getConfig: (key: string) => {
                if (key === 'parallelism') return 1;
                if (key === 'tmp_dir') return '/tmp';
                return undefined;
            },
        };
    }
    if (request === '../error') return { SystemError: class extends Error {} };
    if (request === '../info') return { compilerVersions: async () => ({}), stackSize: async () => 0 };
    if (request === '../log') return { __esModule: true, default: { debug() {} } };
    if (request === '../sandbox') return { versionCheck: async () => undefined };
    if (request === '../task') return { JudgeTask: class {} };
    if (request === '../tracing') return { initTracing: () => ({ shutdown: async () => undefined }) };
    if (request === 'hydrooj') {
        return {
            db: { collection: () => ({ updateOne: () => updateStatus() }) },
            JudgeHandler: { processJudgeFileCallback: async () => undefined },
            JudgeResultCallbackContext: class {},
            ObjectId: class {},
            RecordModel: { get: async () => null },
            SettingModel: { langs: {} },
            StorageModel: {},
            TaskModel: {
                consume: () => {
                    consumeCalls++;
                    return {
                        destroy: () => destroyConsumer(),
                        setConcurrency() {},
                    };
                },
            },
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let apply: (ctx: Record<string, unknown>) => Promise<void>;
try {
    delete require.cache[builtinPath];
    ({ apply } = require(builtinPath));
} finally {
    Module._load = originalLoad;
}

function deferred() {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, reject, resolve };
}

async function captureFailure(promise: Promise<unknown>) {
    try {
        await promise;
        return null;
    } catch (error) {
        return error;
    }
}

function context() {
    const effects: Array<() => Promise<void>> = [];
    let settingListener: (() => Promise<void>) | undefined;
    let listenerDisposed = false;
    const ctx = {
        effect(callback: () => (() => Promise<void>) | undefined) {
            const dispose = callback();
            if (dispose) effects.push(dispose);
        },
        inject() {},
        on(event: string, callback: () => Promise<void>) {
            if (event === 'system/setting') settingListener = callback;
            return () => {
                listenerDisposed = true;
            };
        },
    };
    return {
        ctx,
        effects,
        get listenerDisposed() {
            return listenerDisposed;
        },
        get settingListener() {
            if (!settingListener) throw new Error('setting listener not registered');
            return settingListener;
        },
    };
}

describe('builtin judge cleanup lifecycle', () => {
    it('does not finish apply before the initial status collection settles', async () => {
        const status = deferred();
        updateStatus = () => status.promise;
        consumeCalls = 0;
        const fixture = context();
        let ready = false;

        const applying = apply(fixture.ctx).then(() => {
            ready = true;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(ready).to.equal(false);
        expect(consumeCalls).to.equal(0);

        status.resolve();
        await applying;
        expect(ready).to.equal(true);
        expect(consumeCalls).to.equal(2);
    });

    it('does not start consumers when the initial status collection fails', async () => {
        const failure = new Error('initial status write failed');
        updateStatus = async () => Promise.reject(failure);
        consumeCalls = 0;

        expect(await captureFailure(apply(context().ctx))).to.equal(failure);
        expect(consumeCalls).to.equal(0);
    });

    it('waits for an in-flight setting status collection before effect cleanup completes', async () => {
        updateStatus = async () => undefined;
        destroyConsumer = async () => undefined;
        consumeCalls = 0;
        const fixture = context();
        await apply(fixture.ctx);
        const dispose = fixture.effects[0];

        const status = deferred();
        updateStatus = () => status.promise;
        const collection = fixture.settingListener();
        let cleaned = false;
        const cleanup = dispose().then(() => {
            cleaned = true;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(fixture.listenerDisposed).to.equal(true);
        expect(cleaned).to.equal(false);

        status.resolve();
        await Promise.all([collection, cleanup]);
        expect(cleaned).to.equal(true);
    });

    it('propagates an in-flight status collection failure through effect cleanup', async () => {
        updateStatus = async () => undefined;
        destroyConsumer = async () => undefined;
        consumeCalls = 0;
        const fixture = context();
        await apply(fixture.ctx);
        const dispose = fixture.effects[0];

        const status = deferred();
        const failure = new Error('status write failed');
        updateStatus = () => status.promise;
        const collectionFailure = captureFailure(fixture.settingListener());
        const cleanupFailure = captureFailure(dispose());
        status.reject(failure);

        expect(await collectionFailure).to.equal(failure);
        expect(await cleanupFailure).to.equal(failure);
    });
});
