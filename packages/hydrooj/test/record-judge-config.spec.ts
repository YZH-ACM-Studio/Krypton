import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
const recordPath = require.resolve('../src/model/record.ts');
const originalLoad = Module._load;

let problemConfig: unknown;
let problemKind: string | undefined;
const queuedTasks: any[] = [];
const insertedRecords: any[] = [];

const collectionStub = {
    countDocuments: async () => 0,
    distinct: async () => [],
    estimatedDocumentCount: async () => 0,
    find: () => ({
        project() {
            return this;
        },
        toArray: async () => [],
    }),
    insertOne: async (doc: any) => {
        insertedRecords.push(doc);
        return { insertedId: doc._id };
    },
};

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename !== recordPath) return originalLoad.call(this, request, parent, isMain);
    if (request === '@hydrooj/common') {
        return { ...originalLoad.call(this, request, parent, isMain), STATUS_TEXTS: {} };
    }
    if (request === '@hydrooj/utils') {
        return {
            Logger: class {
                error() {}
            },
        };
    }
    if (request === '../context') return { Context: class {} };
    if (request === '../error') {
        return { ProblemNotFoundError: class extends Error {}, ValidationError: class extends Error {} };
    }
    if (request === '../lib/problem-config') {
        return originalLoad.call(this, request, parent, isMain);
    }
    if (request === '../service/db') return { collection: () => collectionStub, ensureIndexes: async () => undefined };
    if (request === '../utils') {
        return {
            ArgMethod: (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
            buildProjection: () => ({}),
            Time: {},
        };
    }
    if (request === './builtin') return { STATUS: { STATUS_WAITING: 0 } };
    if (request === './domain') return { get: async () => ({ isTrusted: true }) };
    if (request === './message') return {};
    if (request === './problem') {
        return {
            claimStructureLockForSubmission: async () => undefined,
            get: async () => ({
                domainId: 'system',
                docId: 7,
                owner: 1,
                reference: null,
                data: ['1.in', '1.out'],
                config: problemConfig,
                problemKind,
            }),
        };
    }
    if (request === './system') return {};
    if (request === './task') {
        return {
            deleteMany: async () => undefined,
            addMany: async (tasks: any[]) => {
                queuedTasks.push(...tasks);
                return tasks;
            },
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let recordModel: typeof import('../src/model/record').default;
try {
    (global as any).Hydro = { model: {} };
    (global as any).bus = { broadcast() {} };
    delete require.cache[recordPath];
    recordModel = require(recordPath).default;
} finally {
    Module._load = originalLoad;
}

beforeEach(() => {
    problemConfig = undefined;
    problemKind = undefined;
    queuedTasks.length = 0;
    insertedRecords.length = 0;
});

describe('record judge problem config', () => {
    it('queues programming problems without config.yaml for automatic testdata discovery', async () => {
        const record = {
            _id: new ObjectId(),
            domainId: 'system',
            pid: 7,
            uid: 42,
            lang: 'cc',
            code: 'int main() {}',
        } as any;

        await recordModel.judge('system', record);

        expect(queuedTasks).to.have.length(1);
        expect(queuedTasks[0].config).to.deep.equal({});
        expect(queuedTasks[0].data).to.deep.equal(['1.in', '1.out']);
    });

    it('fails fast instead of queueing a malformed non-empty config', async () => {
        problemConfig = 'type: [invalid';
        const record = {
            _id: new ObjectId(),
            domainId: 'system',
            pid: 7,
            uid: 42,
            lang: 'cc',
            code: 'int main() {}',
        } as any;

        let error: unknown;
        try {
            await recordModel.judge('system', record);
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.include('Cannot parse problem config');
        expect(queuedTasks).to.deep.equal([]);
    });

    it('queues a valid function problem with its private template and physical testdata', async () => {
        problemKind = 'function';
        problemConfig = {
            type: 'fill_function',
            subType: 'function',
            langs: ['cc.cc17'],
            main: { mode: 'function', lang: 'cc.cc17' },
            template: {
                lang: 'cc.cc17',
                source: 'int solve() { return 1; }',
                sourceHash: 'hash',
                regions: [
                    {
                        id: 'solve',
                        start: { line: 0, col: 0 },
                        end: { line: 0, col: 25 },
                    },
                ],
            },
            cases: [{ input: '1.in', output: '1.out' }],
        };
        const record = {
            _id: new ObjectId(),
            domainId: 'system',
            pid: 7,
            uid: 42,
            lang: 'cc.cc17',
            code: JSON.stringify({ solve: 'int solve() { return 2; }' }),
        } as any;

        await recordModel.judge('system', record);

        expect(queuedTasks).to.have.length(1);
        expect(queuedTasks[0]).to.have.nested.property('config.template.source', 'int solve() { return 1; }');
        expect(queuedTasks[0].data).to.deep.equal(['1.in', '1.out']);
    });

    it('rejects a function submission whose language differs from the immutable template', async () => {
        problemKind = 'function';
        problemConfig = {
            type: 'fill_function',
            subType: 'function',
            langs: ['cc.cc17'],
            main: { mode: 'function', lang: 'cc.cc17' },
            template: {
                lang: 'cc.cc17',
                source: 'int solve() { return 1; }',
                sourceHash: 'hash',
                regions: [
                    {
                        id: 'solve',
                        start: { line: 0, col: 0 },
                        end: { line: 0, col: 25 },
                    },
                ],
            },
            cases: [{ input: '1.in', output: '1.out' }],
        };
        const record = {
            _id: new ObjectId(),
            domainId: 'system',
            pid: 7,
            uid: 42,
            lang: 'py.py3',
            code: JSON.stringify({ solve: 'def solve(): return 2' }),
        } as any;

        const error = await recordModel.judge('system', record).catch((caught) => caught);
        expect(error).to.be.instanceOf(Error);
        expect(error.message).to.include('language mismatch');
        expect(queuedTasks).to.deep.equal([]);
    });

    it('inserts a manual submission as already-judged waiting without enqueueing a task', async () => {
        const before = new Date();
        await recordModel.add('system', 7, 42, '_', 'answer\r\nkept', true, { contest: new ObjectId(), type: 'manual' });
        expect(insertedRecords).to.have.length(1);
        expect(insertedRecords[0]).to.include({
            status: 0,
            code: 'answer\r\nkept',
            manualPending: true,
        });
        expect(insertedRecords[0].judgeAt).to.be.instanceOf(Date);
        expect(insertedRecords[0].judgeAt.getTime()).to.be.at.least(before.getTime());
        expect(queuedTasks).to.deep.equal([]);
    });
});
