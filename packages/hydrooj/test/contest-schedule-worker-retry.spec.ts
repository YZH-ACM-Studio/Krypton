import { expect } from 'chai';
import { describe, it } from 'node:test';

const Module = require('module');

describe('contest schedule worker retry claim', () => {
    it('atomically upgrades and retains a legacy unhide task before running its handler', async () => {
        const workerPath = require.resolve('../src/service/worker.ts');
        const originalLoad = Module._load;
        const legacyTask = {
            _id: 'legacy-task',
            type: 'schedule',
            subType: 'contest',
            domainId: 'system',
            tid: 'contest',
            operation: ['unhide'],
            executeAfter: new Date('2020-01-01T00:00:00Z'),
        };
        let claimArgs: any[] = [];
        let deleteCalls = 0;
        const collection = {
            async findOneAndUpdate(...args: any[]) {
                claimArgs = args;
                return legacyTask;
            },
            async findOneAndDelete() {
                deleteCalls += 1;
                return null;
            },
        };
        class ServiceStub {
            ctx: any;
            constructor(ctx: any) {
                this.ctx = ctx;
            }
        }

        Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
            if (parent?.filename === workerPath && request === '../context') return { Context: class {}, Service: ServiceStub };
            if (parent?.filename === workerPath && request === './db') {
                return { __esModule: true, default: { collection: () => collection } };
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        try {
            delete require.cache[workerPath];
            const WorkerService = require(workerPath).default;
            const worker = new WorkerService({ logger: { debug: () => undefined } });
            worker.handlers = { contest: async () => undefined };
            const before = Date.now();

            const claimed = await worker.getFirst();

            const after = Date.now();
            expect(claimed).to.equal(legacyTask);
            expect(deleteCalls).to.equal(0);
            expect(claimArgs[0]).to.include({ type: 'schedule', subType: 'contest', operation: 'unhide' });
            expect(claimArgs[1].$set.interval).to.deep.equal([1, 'minute']);
            expect(claimArgs[1].$set.executeAfter.getTime()).to.be.within(before + 60_000, after + 60_000);
            expect(claimArgs[2]).to.deep.equal({ returnDocument: 'before', sort: { executeAfter: 1 } });
        } finally {
            Module._load = originalLoad;
            delete require.cache[workerPath];
        }
    });
});
