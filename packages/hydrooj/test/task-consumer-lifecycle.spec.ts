import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {} };

const taskPath = require.resolve('../src/model/task.ts');
const originalLoad = Module._load;
let fetchTask: () => Promise<Record<string, unknown> | null> = async () => null;

const taskCollection = {
    findOneAndDelete: () => fetchTask(),
};
const eventCollection = {};

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename !== taskPath) return originalLoad.call(this, request, parent, isMain);
    if (request === 'cac') {
        const createCli = () => ({ parse: () => ({ options: {} }) });
        return { __esModule: true, default: createCli };
    }
    if (request === 'nanoid') return { nanoid: () => 'consumer-test' };
    if (request === '@hydrooj/utils/lib/utils') return { sleep: async () => undefined };
    if (request === '../context') return { Context: class {} };
    if (request === '../interface') return {};
    if (request === '../logger') {
        return {
            Logger: class {
                debug() {}
                error() {}
                info() {}
            },
        };
    }
    if (request === '../service/bus') {
        const bus = { on: () => undefined, parallel: async () => undefined };
        return { __esModule: true, default: bus };
    }
    if (request === '../service/db') {
        const db = {
            collection: (name: string) => (name === 'task' ? taskCollection : eventCollection),
            ensureIndexes: async () => undefined,
        };
        return { __esModule: true, default: db };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let Consumer: typeof import('../src/model/task').Consumer;
try {
    delete require.cache[taskPath];
    ({ Consumer } = require(taskPath));
} finally {
    Module._load = originalLoad;
}

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, reject, resolve };
}

async function captureFailure(run: () => Promise<unknown>): Promise<Error | null> {
    try {
        await run();
        return null;
    } catch (error) {
        return error as Error;
    }
}

describe('task Consumer shutdown lifecycle', () => {
    it('waits for a task fetched before shutdown to finish its callback', async () => {
        const fetchStarted = deferred();
        const releaseFetch = deferred();
        const releaseCallback = deferred();
        let fetched = false;
        fetchTask = async () => {
            fetchStarted.resolve();
            await releaseFetch.promise;
            if (fetched) return null;
            fetched = true;
            return { _id: new ObjectId(), rid: new ObjectId(), type: 'judge', priority: 0 };
        };
        let callbackStarted = false;
        const consumer = new Consumer(
            {},
            async () => {
                callbackStarted = true;
                await releaseCallback.promise;
            },
            true,
        );
        await fetchStarted.promise;

        let shutdownSettled = false;
        const shutdown = consumer.destroy().then(() => {
            shutdownSettled = true;
        });
        releaseFetch.resolve();
        await new Promise((resolve) => setImmediate(resolve));
        expect(callbackStarted).to.equal(true);
        expect(shutdownSettled).to.equal(false);

        releaseCallback.resolve();
        await shutdown;
        expect(shutdownSettled).to.equal(true);
        expect(consumer.processing.size).to.equal(0);
    });

    it('propagates a fetched task callback failure through shutdown', async () => {
        const fetchStarted = deferred();
        const releaseFetch = deferred();
        const failure = new Error('requeue failed');
        let fetched = false;
        fetchTask = async () => {
            fetchStarted.resolve();
            await releaseFetch.promise;
            if (fetched) return null;
            fetched = true;
            return { _id: new ObjectId(), rid: new ObjectId(), type: 'judge', priority: 0 };
        };
        const consumer = new Consumer(
            {},
            async () => {
                throw failure;
            },
            true,
        );
        await fetchStarted.promise;
        const shutdownFailure = captureFailure(() => consumer.destroy());
        releaseFetch.resolve();

        expect(await shutdownFailure).to.equal(failure);
        expect(consumer.processing.size).to.equal(0);
    });

    it('reports every independent callback failure during concurrent shutdown', async () => {
        const firstTask = { _id: new ObjectId(), rid: new ObjectId(), type: 'judge', priority: 0 };
        const secondTask = { _id: new ObjectId(), rid: new ObjectId(), type: 'judge', priority: 0 };
        const pendingTasks = [firstTask, secondTask];
        const callbacksStarted = deferred();
        const releaseCallbacks = deferred();
        let startedCount = 0;
        fetchTask = async () => pendingTasks.shift() || null;
        const firstFailure = new Error('first callback failed');
        const secondFailure = new Error('second callback failed');
        const consumer = new Consumer(
            {},
            async (task) => {
                startedCount += 1;
                if (startedCount === 2) callbacksStarted.resolve();
                await releaseCallbacks.promise;
                throw String(task.rid) === String(firstTask.rid) ? firstFailure : secondFailure;
            },
            true,
            2,
        );
        await callbacksStarted.promise;
        const shutdownFailure = captureFailure(() => consumer.destroy());
        releaseCallbacks.resolve();

        const failure = await shutdownFailure;
        expect(failure).to.be.instanceOf(AggregateError);
        expect((failure as AggregateError).errors).to.deep.equal([firstFailure, secondFailure]);
        expect(consumer.processing.size).to.equal(0);
    });
});
