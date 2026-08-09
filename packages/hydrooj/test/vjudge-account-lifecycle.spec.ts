import { expect } from 'chai';
import { describe, it } from 'node:test';

const Module = require('module');
const indexPath = require.resolve('../../vjudge/src/index.ts');
const originalLoad = Module._load;

const STATUS = {
    STATUS_ACCEPTED: 4,
    STATUS_COMPILE_ERROR: 2,
    STATUS_FETCHED: 1,
    STATUS_JUDGING: 3,
    STATUS_SYSTEM_ERROR: 5,
};

class FakeJudgeResultCallbackContext {
    static instances: FakeJudgeResultCallbackContext[] = [];
    messages: Record<string, unknown>[] = [];
    terminal?: Record<string, unknown>;
    waited = false;

    constructor() {
        FakeJudgeResultCallbackContext.instances.push(this);
    }

    async next(payload: Record<string, unknown>) {
        this.messages.push(payload);
    }

    async end(payload: Record<string, unknown>) {
        this.terminal ||= payload;
    }

    async waitForOwnedTask() {
        this.waited = true;
    }
}

let consume: () => { destroy(): Promise<void> } = () => ({ destroy: async () => undefined });
let findRows: () => Promise<Record<string, unknown>[]> = async () => [];

const collection = {
    find: () => ({ toArray: () => findRows() }),
    updateOne: async () => undefined,
};

class FakeService {
    static init = Symbol('init');
    ctx: unknown;

    constructor(ctx: unknown) {
        this.ctx = ctx;
    }
}

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename !== indexPath) return originalLoad.call(this, request, parent, isMain);
    if (request === '@hydrooj/common') return { STATUS };
    if (request === './fetch') return { BasicFetcher: class {} };
    if (request === './providers/index') return { __esModule: true, default: {} };
    if (request === './verdict') return { VERDICT: {} };
    if (request === 'hydrooj') {
        return {
            Context: class {},
            db: { collection: () => collection },
            DomainModel: { coll: collection },
            JudgeResultCallbackContext: FakeJudgeResultCallbackContext,
            Logger: class {
                error() {}
                info() {}
                warn() {}
            },
            ProblemModel: {},
            RecordModel: { coll: collection },
            Service: FakeService,
            SettingModel: { langs: { cc: {} } },
            sleep: async () => undefined,
            SolutionModel: {},
            SystemModel: { get: () => '', set: async () => undefined },
            TaskModel: { consume: () => consume() },
            Time: { hour: 60_000, week: 604_800_000 },
            yaml: { dump: () => '', load: () => ({}) },
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

interface AccountServiceInstance {
    login(): Promise<boolean>;
    judge(task: Record<string, unknown>): Promise<void>;
    stop(): Promise<void>;
}

interface RemoteAccountFixture {
    _id: string;
    type: string;
    handle: string;
    password: string;
}

type AccountServiceConstructor = new (provider: unknown, account: RemoteAccountFixture, ctx: unknown) => AccountServiceInstance;

let AccountService: AccountServiceConstructor;
try {
    delete require.cache[indexPath];
    ({ AccountService } = require(indexPath));
} finally {
    Module._load = originalLoad;
}

function provider(overrides: Record<string, unknown> = {}) {
    return class {
        ensureLogin = async () => false;
        getProblem = async () => undefined;
        listProblem = async () => [];
        submitProblem = async () => undefined;
        waitForSubmission = async () => undefined;

        constructor() {
            Object.assign(this, overrides);
        }
    };
}

function account(): RemoteAccountFixture {
    return { _id: 'account', type: 'fake', handle: 'judge', password: 'secret' };
}

function task() {
    return { code: 'int main() {}', config: {}, lang: 'cc', rid: 'record', target: '1000' };
}

function context() {
    return {};
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

async function turn() {
    await new Promise<void>((resolve) => setImmediate(resolve));
}

async function captureFailure(promise: Promise<unknown>) {
    try {
        await promise;
        return null;
    } catch (error) {
        return error;
    }
}

describe('remote judge account lifecycle', () => {
    it('ends with a system error when the provider returns no submission ID', async () => {
        FakeJudgeResultCallbackContext.instances = [];
        const service = new AccountService(provider() as never, account(), context());

        await service.judge(task());

        const callback = FakeJudgeResultCallbackContext.instances[0];
        expect(callback.terminal).to.deep.equal({
            status: STATUS.STATUS_SYSTEM_ERROR,
            message: 'Remote judge did not return a submission ID',
        });
        expect(callback.waited).to.equal(true);
    });

    it('ends with a system error when polling returns without a terminal result', async () => {
        FakeJudgeResultCallbackContext.instances = [];
        const service = new AccountService(
            provider({ submitProblem: async () => 'remote-id', waitForSubmission: async () => undefined }) as never,
            account(),
            context(),
        );

        await service.judge(task());

        expect(FakeJudgeResultCallbackContext.instances[0].terminal).to.deep.equal({
            status: STATUS.STATUS_SYSTEM_ERROR,
            message: 'Remote judge returned without a terminal result',
        });
    });

    it('does not overwrite a provider terminal result with the fallback', async () => {
        FakeJudgeResultCallbackContext.instances = [];
        const service = new AccountService(
            provider({
                submitProblem: async () => 'remote-id',
                waitForSubmission: async (_rid: string, _next: unknown, end: (payload: Record<string, unknown>) => Promise<void>) =>
                    end({ status: STATUS.STATUS_ACCEPTED }),
            }) as never,
            account(),
            context(),
        );

        await service.judge(task());

        expect(FakeJudgeResultCallbackContext.instances[0].terminal).to.deep.equal({ status: STATUS.STATUS_ACCEPTED });
    });

    it('waits for the owned consumer and provider cleanup', async () => {
        const destroy = deferred();
        let providerStopped = false;
        consume = () => ({ destroy: () => destroy.promise });
        const service = new AccountService(
            provider({
                ensureLogin: async () => true,
                stop: async () => {
                    providerStopped = true;
                },
            }) as never,
            account(),
            context(),
        );
        await turn();

        let stopped = false;
        const stop = service.stop().then(() => {
            stopped = true;
        });
        await turn();
        expect(providerStopped).to.equal(false);
        expect(stopped).to.equal(false);

        destroy.resolve();
        await stop;
        expect(providerStopped).to.equal(true);
        expect(stopped).to.equal(true);
    });

    it('does not start a consumer after cleanup begins during login', async () => {
        const login = deferred();
        let consumersStarted = 0;
        let providerStopped = false;
        consume = () => {
            consumersStarted++;
            return { destroy: async () => undefined };
        };
        const service = new AccountService(
            provider({
                ensureLogin: () => login.promise.then(() => true),
                stop: async () => {
                    providerStopped = true;
                },
            }) as never,
            account(),
            context(),
        );

        const stop = service.stop();
        login.resolve();
        await stop;

        expect(consumersStarted).to.equal(0);
        expect(providerStopped).to.equal(true);
    });

    it('waits for an in-flight problem sync before stopping the provider', async () => {
        const sync = deferred();
        let providerStopped = false;
        findRows = () => sync.promise.then(() => []);
        consume = () => ({ destroy: async () => undefined });
        const service = new AccountService(
            provider({
                ensureLogin: async () => true,
                stop: async () => {
                    providerStopped = true;
                },
            }) as never,
            account(),
            context(),
        );
        await turn();

        let stopped = false;
        const stop = service.stop().then(() => {
            stopped = true;
        });
        await turn();
        expect(providerStopped).to.equal(false);
        expect(stopped).to.equal(false);

        sync.resolve();
        await stop;
        findRows = async () => [];
        expect(providerStopped).to.equal(true);
        expect(stopped).to.equal(true);
    });

    it('waits for an in-flight periodic login before stopping the provider', async () => {
        const periodicLogin = deferred();
        let loginCalls = 0;
        let providerStopped = false;
        consume = () => ({ destroy: async () => undefined });
        const service = new AccountService(
            provider({
                ensureLogin: async () => {
                    loginCalls++;
                    if (loginCalls === 1) return true;
                    await periodicLogin.promise;
                    return true;
                },
                stop: async () => {
                    providerStopped = true;
                },
            }) as never,
            account(),
            context(),
        );
        await turn();
        const login = service.login();
        await turn();

        let stopped = false;
        const stop = service.stop().then(() => {
            stopped = true;
        });
        await turn();
        expect(providerStopped).to.equal(false);
        expect(stopped).to.equal(false);

        periodicLogin.resolve();
        await Promise.all([login, stop]);
        expect(providerStopped).to.equal(true);
        expect(stopped).to.equal(true);
    });

    it('observes an immediate consumer failure while waiting for background work', async () => {
        const sync = deferred();
        const consumerFailure = new Error('consumer failed early');
        const unhandled: unknown[] = [];
        let providerStopped = false;
        findRows = () => sync.promise.then(() => []);
        consume = () => ({ destroy: async () => Promise.reject(consumerFailure) });
        const service = new AccountService(
            provider({
                ensureLogin: async () => true,
                stop: async () => {
                    providerStopped = true;
                },
            }) as never,
            account(),
            context(),
        );
        await turn();
        const onUnhandled = (error: unknown) => unhandled.push(error);
        process.on('unhandledRejection', onUnhandled);
        try {
            const stopping = captureFailure(service.stop());
            await turn();
            expect(unhandled).to.deep.equal([]);
            expect(providerStopped).to.equal(false);

            sync.resolve();
            expect(await stopping).to.equal(consumerFailure);
            expect(providerStopped).to.equal(true);
            expect(unhandled).to.deep.equal([]);
        } finally {
            process.off('unhandledRejection', onUnhandled);
            findRows = async () => [];
        }
    });

    it('attempts every cleanup and aggregates independent failures', async () => {
        const consumerFailure = new Error('consumer failed');
        const providerFailure = new Error('provider failed');
        let providerStopped = false;
        consume = () => ({ destroy: async () => Promise.reject(consumerFailure) });
        const service = new AccountService(
            provider({
                ensureLogin: async () => true,
                stop: async () => {
                    providerStopped = true;
                    throw providerFailure;
                },
            }) as never,
            account(),
            context(),
        );
        await turn();

        let actual: unknown;
        try {
            await service.stop();
        } catch (error) {
            actual = error;
        }

        expect(providerStopped).to.equal(true);
        expect(actual).to.be.instanceOf(AggregateError);
        expect((actual as AggregateError).errors).to.deep.equal([consumerFailure, providerFailure]);
    });
});
