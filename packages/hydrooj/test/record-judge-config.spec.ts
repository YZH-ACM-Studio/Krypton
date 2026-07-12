import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';
import { parseProblemConfigObject } from '../src/lib/problem-config';

const Module = require('module');
const recordPath = require.resolve('../src/model/record.ts');
const originalLoad = Module._load;

let problemConfig: unknown;
const queuedTasks: any[] = [];

const collectionStub = {
    countDocuments: async () => 0,
    distinct: async () => [],
    estimatedDocumentCount: async () => 0,
    find: () => ({ project() { return this; }, toArray: async () => [] }),
};

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename !== recordPath) return originalLoad.call(this, request, parent, isMain);
    if (request === '@hydrooj/common') return { STATUS_TEXTS: {} };
    if (request === '@hydrooj/utils') return { Logger: class { error() {} } };
    if (request === '../context') return { Context: class {} };
    if (request === '../error') return { ProblemNotFoundError: class extends Error {} };
    if (request === '../lib/problem-config') return { parseProblemConfigObject };
    if (request === '../service/db') return { collection: () => collectionStub, ensureIndexes: async () => undefined };
    if (request === '../utils') {
        return {
            ArgMethod: (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
            buildProjection: () => ({}),
            Time: {},
        };
    }
    if (request === './builtin') return { STATUS: {} };
    if (request === './domain') return { get: async () => ({ isTrusted: true }) };
    if (request === './message') return {};
    if (request === './problem') {
        return {
            get: async () => ({
                domainId: 'system', docId: 7, owner: 1, reference: null,
                data: ['1.in', '1.out'], config: problemConfig,
            }),
        };
    }
    if (request === './system') return {};
    if (request === './task') {
        return {
            deleteMany: async () => undefined,
            addMany: async (tasks: any[]) => { queuedTasks.push(...tasks); return tasks; },
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let recordModel: typeof import('../src/model/record').default;
try {
    (global as any).Hydro = { model: {} };
    delete require.cache[recordPath];
    recordModel = require(recordPath).default;
} finally {
    Module._load = originalLoad;
}

beforeEach(() => {
    problemConfig = undefined;
    queuedTasks.length = 0;
});

describe('record judge problem config', () => {
    it('queues programming problems without config.yaml for automatic testdata discovery', async () => {
        const record = {
            _id: new ObjectId(), domainId: 'system', pid: 7, uid: 42,
            lang: 'cc', code: 'int main() {}',
        } as any;

        await recordModel.judge('system', record);

        expect(queuedTasks).to.have.length(1);
        expect(queuedTasks[0].config).to.deep.equal({});
        expect(queuedTasks[0].data).to.deep.equal(['1.in', '1.out']);
    });

    it('fails fast instead of queueing a malformed non-empty config', async () => {
        problemConfig = 'type: [invalid';
        const record = {
            _id: new ObjectId(), domainId: 'system', pid: 7, uid: 42,
            lang: 'cc', code: 'int main() {}',
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
});
