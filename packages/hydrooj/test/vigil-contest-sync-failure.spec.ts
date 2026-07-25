import { expect } from 'chai';
import { describe, it } from 'node:test';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {} };

describe('Vigil contest mirror failure boundary', () => {
    it('waits for every post-persist observer before propagating a contest edit failure', async () => {
        const busPath = require.resolve('../src/service/bus.ts');
        const previousApp = (global as any).app;
        const observerError = new Error('Vigil unavailable');
        let aclObserverSettled = false;
        (global as any).app = {
            events: {
                dispatch: () => [
                    async () => {
                        throw observerError;
                    },
                    async () => {
                        await new Promise((resolve) => setImmediate(resolve));
                        aclObserverSettled = true;
                    },
                ],
            },
        };

        try {
            delete require.cache[busPath];
            const { parallelAllSettled } = require(busPath);
            const error = await captureFailure(() => parallelAllSettled('contest/edit', {}));

            expect(error).to.equal(observerError);
            expect(aclObserverSettled).to.equal(true);
        } finally {
            (global as any).app = previousApp;
            delete require.cache[busPath];
        }
    });

    it('rejects through the real strict bridge when Vigil is not configured', async () => {
        const bridgePath = require.resolve('../src/service/vigil-bridge.ts');
        const originalLoad = Module._load;

        Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
            if (parent?.filename === bridgePath && request === '../model/system') {
                return { __esModule: true, default: { get: () => '' } };
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        try {
            delete require.cache[bridgePath];
            const bridge = require(bridgePath);
            const payload = {
                ojContestId: 'contest',
                ojDomainId: 'system',
                title: 'Contest',
                beginAt: new Date('2099-01-01T00:00:00Z'),
                endAt: new Date('2099-01-01T02:00:00Z'),
                approvalMode: 'strict',
                lockdownMode: false,
                pauseOnDisconnect: false,
                screenshotIntervalMs: 60_000,
                exclusive: false,
            };

            const pushError = await captureFailure(() => bridge.pushExamToVigilStrict(payload));
            const deleteError = await captureFailure(() => bridge.deleteExamFromVigilStrict('contest'));

            expect(pushError?.message).to.include('vigil.baseUrl not configured');
            expect(deleteError?.message).to.include('vigil.baseUrl not configured');
        } finally {
            Module._load = originalLoad;
            delete require.cache[bridgePath];
        }
    });

    it('propagates add and edit mirror failures to the contest save listener', async () => {
        const pluginPath = require.resolve('../../krypton-vigilguard/index.ts');
        const originalLoad = Module._load;
        const originalConsoleError = console.error;
        const listeners = new Map<string, (...args: any[]) => Promise<void>>();
        const syncError = new Error('Vigil unavailable');
        const tdoc = {
            domainId: 'system',
            docId: 'contest',
            title: 'Contest',
            beginAt: new Date('2099-01-01T00:00:00Z'),
            endAt: new Date('2099-01-01T02:00:00Z'),
            vigilEnabled: true,
        };
        let deleteCalls = 0;
        const documentSets: any[][] = [];
        const bridge = {
            async pushExamToVigilStrict() {
                throw syncError;
            },
            async deleteExamFromVigilStrict() {
                deleteCalls += 1;
                if (deleteCalls === 1 || deleteCalls === 3 || deleteCalls === 4) throw syncError;
            },
        };
        const helperProxy = new Proxy({}, { get: () => () => undefined });
        const errors: any[][] = [];

        Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
            if (parent?.filename === pluginPath) {
                if (request === 'hydrooj') return {};
                if (request === 'hydrooj/src/model/contest') return { get: async () => tdoc };
                if (request === 'hydrooj/src/model/document') {
                    return {
                        TYPE_CONTEST: 30,
                        coll: { find: () => ({ toArray: async () => [] }) },
                        set: async (...args: any[]) => documentSets.push(args),
                    };
                }
                if (request === 'hydrooj/src/model/system') return { get: () => '' };
                if (request === './src/db') return { ensureIndexes: async () => undefined };
                if (request === './src/handler') return { applyHandlers: () => undefined };
                if (request === './src/helpers') return helperProxy;
                if (request === './src/lockout') return helperProxy;
                if (request === './src/migration') return { migrationScripts: [] };
            }
            if (request === '../hydrooj/src/service/vigil-bridge') return bridge;
            return originalLoad.call(this, request, parent, isMain);
        };
        console.error = (...args: any[]) => {
            errors.push(args);
        };

        try {
            delete require.cache[pluginPath];
            const plugin = require(pluginPath);
            plugin.apply({
                on(event: string, handler: (...args: any[]) => Promise<void>) {
                    listeners.set(event, handler);
                },
                inject(dependencies: string[], callback: (services: any) => void) {
                    if (dependencies.includes('server')) callback({ server: { addHandlerLayer: () => undefined } });
                    if (dependencies.includes('migration')) callback({ migration: { registerChannel: () => undefined } });
                },
            });

            const editError = await captureFailure(() => listeners.get('contest/edit')!(tdoc, 'system', 'contest', {}, tdoc));
            const disabledTdoc = { ...tdoc, vigilEnabled: false, vigilDeletePending: true };
            const disableError = await captureFailure(() => listeners.get('contest/edit')!(disabledTdoc, 'system', 'contest', {}, tdoc));
            const disableRetryError = await captureFailure(() =>
                listeners.get('contest/edit')!(disabledTdoc, 'system', 'contest', {}, { ...tdoc, vigilEnabled: false }),
            );
            const ordinaryDisabledError = await captureFailure(() =>
                listeners.get('contest/edit')!({ ...tdoc, vigilEnabled: false }, 'system', 'contest', {}, { ...tdoc, vigilEnabled: false }),
            );
            const addError = await captureFailure(() => listeners.get('contest/add')!(tdoc, 'contest'));
            const ordinaryDeleteError = await captureFailure(() =>
                listeners.get('contest/del')!('system', 'ordinary', { vigilEnabled: false, vigilDeletePending: false }),
            );
            const deleteError = await captureFailure(() => listeners.get('contest/del')!('system', 'contest', tdoc));
            const pendingDeleteError = await captureFailure(() =>
                listeners.get('contest/del')!('system', 'pending', { vigilEnabled: false, vigilDeletePending: true }),
            );

            for (const [error, stage] of [
                [editError, 'contest-edit-push'],
                [disableError, 'contest-edit-delete'],
                [addError, 'contest-add'],
            ] as const) {
                expect(error?.name).to.equal('ContestVigilSyncCommittedError');
                expect((error as any).domainId).to.equal('system');
                expect((error as any).contestId).to.equal('contest');
                expect((error as any).stage).to.equal(stage);
                expect((error as any).cause).to.equal(syncError);
                expect(error?.message).to.include('was saved');
            }
            expect(disableRetryError).to.equal(null);
            expect(ordinaryDisabledError).to.equal(null);
            expect(ordinaryDeleteError).to.equal(null);
            expect(deleteError?.name).to.equal('ContestVigilSyncCommittedError');
            expect((deleteError as any).domainId).to.equal('system');
            expect((deleteError as any).contestId).to.equal('contest');
            expect((deleteError as any).stage).to.equal('contest-delete');
            expect((deleteError as any).cause).to.equal(syncError);
            expect(deleteError?.message).to.include('was deleted');
            expect(pendingDeleteError?.name).to.equal('ContestVigilSyncCommittedError');
            expect((pendingDeleteError as any).domainId).to.equal('system');
            expect((pendingDeleteError as any).contestId).to.equal('pending');
            expect((pendingDeleteError as any).stage).to.equal('contest-delete');
            expect((pendingDeleteError as any).cause).to.equal(syncError);
            expect(deleteCalls).to.equal(4);
            expect(documentSets).to.deep.equal([['system', 30, 'contest', { vigilDeletePending: false }]]);
            expect(errors).to.have.length(5);
            expect(errors.map((entry) => entry[1]?.stage)).to.deep.equal([
                'contest-edit-push',
                'contest-edit-delete',
                'contest-add',
                'contest-delete',
                'contest-delete',
            ]);
        } finally {
            console.error = originalConsoleError;
            Module._load = originalLoad;
            delete require.cache[pluginPath];
        }
    });
});

async function captureFailure(callback: () => Promise<unknown>) {
    try {
        await callback();
        return null;
    } catch (error) {
        return error as Error;
    }
}
