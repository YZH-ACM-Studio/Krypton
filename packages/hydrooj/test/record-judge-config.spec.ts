import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';
import { templateSourceHash } from '../src/lib/problem-config';

const Module = require('module');
const recordPath = require.resolve('../src/model/record.ts');
const originalLoad = Module._load;

let problemConfig: unknown;
let problemKind: string | undefined;
let codeEvaluationStatus: 'draft' | 'ready' | undefined;
const queuedTasks: any[] = [];
const insertedRecords: any[] = [];
const deletedTaskQueries: any[] = [];
const structureLockRequests: boolean[] = [];
const storedRecords: any[] = [];
const resetUpdates: any[] = [];
const deletedStatQueries: any[] = [];
const historyInserts: any[] = [];
const REGION_ID = 'r_abcdefghijkl';

function assertReady(pdoc: any) {
    const codeEvaluation =
        pdoc.problemKind === 'function' ||
        (pdoc.problemKind === 'program_fill' && pdoc.config?.type === 'program_fill' && pdoc.config?.mode === 'compile');
    if (codeEvaluation && pdoc.codeEvaluationStatus !== 'ready') throw new Error('code evaluation draft is not ready');
}

const recordCollectionStub = {
    countDocuments: async () => 0,
    distinct: async () => [],
    estimatedDocumentCount: async () => 0,
    find: (query: any) => ({
        project() {
            return this;
        },
        toArray: async () => {
            const ids = query?._id?.$in;
            if (!Array.isArray(ids)) return [];
            return storedRecords.filter((record) => ids.some((id: ObjectId) => id.equals(record._id)));
        },
    }),
    findOne: async (query: any) => {
        const ids = query?._id?.$in;
        if (!Array.isArray(ids)) return null;
        return (
            storedRecords.find(
                (record) =>
                    ids.some((id: ObjectId) => id.equals(record._id)) && (record.manualPending === true || Object.hasOwn(record, 'manualGrade')),
            ) || null
        );
    },
    insertOne: async (doc: any) => {
        insertedRecords.push(doc);
        return { insertedId: doc._id };
    },
    updateMany: async (query: any, update: any) => {
        resetUpdates.push({ query, update });
        return { modifiedCount: 0 };
    },
    findOneAndUpdate: async (query: any, update: any) => {
        resetUpdates.push({ query, update });
        return null;
    },
};

const statCollectionStub = {
    deleteMany: async (query: any) => {
        deletedStatQueries.push(query);
        return { deletedCount: 0 };
    },
};

const historyCollectionStub = {
    insertMany: async (docs: any[]) => {
        historyInserts.push(...docs);
        return { insertedCount: docs.length };
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
    if (request === '../service/db') {
        return {
            collection: (name: string) =>
                name === 'record.stat' ? statCollectionStub : name === 'record.history' ? historyCollectionStub : recordCollectionStub,
            ensureIndexes: async () => undefined,
        };
    }
    if (request === '../utils') {
        return {
            ArgMethod: (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
            buildProjection: () => ({}),
            Time: { getObjectID: () => new ObjectId() },
        };
    }
    if (request === './builtin') return { STATUS: { STATUS_WAITING: 0 } };
    if (request === './domain') return { get: async () => ({ isTrusted: true }) };
    if (request === './message') return {};
    if (request === './problem') {
        return {
            claimStructureLockForSubmission: async (_domainId: string, _pid: number, lockStructure = true) => {
                structureLockRequests.push(lockStructure);
                assertReady({ problemKind, config: problemConfig, codeEvaluationStatus });
                return {
                    domainId: 'system',
                    docId: 7,
                    structureRevision: 3,
                    problemKind,
                    config: problemConfig,
                    codeEvaluationStatus,
                    data: [{ name: '1.in' }, { name: '1.out' }],
                };
            },
            assertProblemReadyForUse: assertReady,
            get: async () => ({
                domainId: 'system',
                docId: 7,
                owner: 1,
                reference: null,
                data: ['1.in', '1.out'],
                config: problemConfig,
                problemKind,
                codeEvaluationStatus,
            }),
        };
    }
    if (request === './system') return { get: () => 128 * 1024 };
    if (request === './task') {
        return {
            deleteMany: async (query: any) => {
                deletedTaskQueries.push(query);
            },
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
    codeEvaluationStatus = undefined;
    queuedTasks.length = 0;
    insertedRecords.length = 0;
    deletedTaskQueries.length = 0;
    structureLockRequests.length = 0;
    storedRecords.length = 0;
    resetUpdates.length = 0;
    deletedStatQueries.length = 0;
    historyInserts.length = 0;
    (global as any).Hydro.model.contest = {
        resolveTeamSubmissionCapability: async (_domainId: string, contestId: ObjectId) => ({
            mode: 'individual',
            contestId,
            vigilSessionCheck: 'not_applicable',
        }),
    };
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
        codeEvaluationStatus = 'ready';
        problemConfig = {
            type: 'function',
            langs: ['cc.cc17'],
            template: {
                lang: 'cc.cc17',
                source: 'int solve() { return 1; }',
                sourceHash: templateSourceHash('int solve() { return 1; }'),
                publicRanges: [],
                regions: [
                    {
                        id: REGION_ID,
                        startLine: 0,
                        endLine: 1,
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
            code: JSON.stringify({ [REGION_ID]: 'int solve() { return 2; }' }),
        } as any;

        await recordModel.judge('system', record);

        expect(queuedTasks).to.have.length(1);
        expect(queuedTasks[0]).to.have.nested.property('config.template.source', 'int solve() { return 1; }');
        expect(queuedTasks[0].data).to.deep.equal(['1.in', '1.out']);
    });

    it('inserts and queues an exact multi-region text program-fill payload with the internal text language', async () => {
        problemKind = 'program_fill';
        const secondRegionId = 'r_mnopqrstuvwx';
        const source = ['int total = 0;', 'total += value;', 'std::cout << total;'].join('\n');
        problemConfig = {
            type: 'program_fill',
            mode: 'text',
            template: {
                source,
                sourceHash: templateSourceHash(source),
                publicRanges: [],
                regions: [
                    { id: REGION_ID, startLine: 1, endLine: 2 },
                    { id: secondRegionId, startLine: 2, endLine: 3 },
                ],
            },
        };
        const code = JSON.stringify({ [REGION_ID]: 'total += value;', [secondRegionId]: 'std::cout << total;' });

        await recordModel.add('system', 7, 42, '_', code, true, { type: 'judge' });

        expect(insertedRecords).to.have.length(1);
        expect(insertedRecords[0]).to.include({ lang: '_', code });
        expect(queuedTasks).to.have.length(1);
        expect(queuedTasks[0]).to.have.nested.property('config.mode', 'text');
        expect(queuedTasks[0]).to.have.nested.property('config.template.source', source);
    });

    it('rejects a text program-fill newline before inserting a record', async () => {
        problemKind = 'program_fill';
        const source = 'total += value;';
        problemConfig = {
            type: 'program_fill',
            mode: 'text',
            template: {
                source,
                sourceHash: templateSourceHash(source),
                publicRanges: [],
                regions: [{ id: REGION_ID, startLine: 0, endLine: 1 }],
            },
        };

        const error = await recordModel
            .add('system', 7, 42, '_', JSON.stringify({ [REGION_ID]: 'total += value;\nreturn;' }), false, { type: 'judge' })
            .catch((caught) => caught);

        expect(error).to.be.instanceOf(Error);
        expect(error.message).to.include('must be one line');
        expect(insertedRecords).to.deep.equal([]);
    });

    it('rejects a function submission whose language differs from the immutable template', async () => {
        problemKind = 'function';
        codeEvaluationStatus = 'ready';
        problemConfig = {
            type: 'function',
            langs: ['cc.cc17'],
            template: {
                lang: 'cc.cc17',
                source: 'int solve() { return 1; }',
                sourceHash: templateSourceHash('int solve() { return 1; }'),
                publicRanges: [],
                regions: [
                    {
                        id: REGION_ID,
                        startLine: 0,
                        endLine: 1,
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
            code: JSON.stringify({ [REGION_ID]: 'def solve(): return 2' }),
        } as any;

        const error = await recordModel.judge('system', record).catch((caught) => caught);
        expect(error).to.be.instanceOf(Error);
        expect(error.message).to.include('language mismatch');
        expect(queuedTasks).to.deep.equal([]);
    });

    it('rejects malformed stored function payloads before deleting an old task during rejudge', async () => {
        problemKind = 'function';
        codeEvaluationStatus = 'ready';
        const source = 'int solve() { return 1; }';
        problemConfig = {
            type: 'function',
            langs: ['cc.cc17'],
            template: {
                lang: 'cc.cc17',
                source,
                sourceHash: templateSourceHash(source),
                publicRanges: [],
                regions: [{ id: REGION_ID, startLine: 0, endLine: 1 }],
            },
            cases: [{ input: '1.in', output: '1.out' }],
        };
        const record = {
            _id: new ObjectId(),
            domainId: 'system',
            pid: 7,
            uid: 42,
            lang: 'cc.cc17',
            code: JSON.stringify({ [REGION_ID]: 'int solve() { return 2; }', forged: 'extra' }),
        } as any;

        const error = await recordModel.judge('system', record, 0, {}, { rejudge: true }).catch((caught) => caught);

        expect(error).to.be.instanceOf(Error);
        expect(error.message).to.include('keys do not match');
        expect(deletedTaskQueries).to.deep.equal([]);
        expect(queuedTasks).to.deep.equal([]);
    });

    it('rejects malformed stored function payloads before reset mutates rejudge history or statistics', async () => {
        problemKind = 'function';
        codeEvaluationStatus = 'ready';
        const source = 'int solve() { return 1; }';
        problemConfig = {
            type: 'function',
            langs: ['cc.cc17'],
            template: {
                lang: 'cc.cc17',
                source,
                sourceHash: templateSourceHash(source),
                publicRanges: [],
                regions: [{ id: REGION_ID, startLine: 0, endLine: 1 }],
            },
            cases: [{ input: '1.in', output: '1.out' }],
        };
        const rid = new ObjectId();
        storedRecords.push({
            _id: rid,
            domainId: 'system',
            pid: 7,
            uid: 42,
            lang: 'cc.cc17',
            code: JSON.stringify({ [REGION_ID]: 'int solve() { return 2; }', forged: 'extra' }),
            score: 100,
            status: 1,
            time: 10,
            memory: 1024,
            judgeAt: new Date(),
        });

        const error = await recordModel.reset('system', rid, true).catch((caught) => caught);

        expect(error).to.be.instanceOf(Error);
        expect(error.message).to.include('keys do not match');
        expect(deletedTaskQueries).to.deep.equal([]);
        expect(deletedStatQueries).to.deep.equal([]);
        expect(historyInserts).to.deep.equal([]);
        expect(resetUpdates).to.deep.equal([]);
    });

    it('rejects stale or extra function-region keys before inserting the record', async () => {
        problemKind = 'function';
        codeEvaluationStatus = 'ready';
        const source = 'int solve() { return 1; }';
        problemConfig = {
            type: 'function',
            langs: ['cc.cc17'],
            template: {
                lang: 'cc.cc17',
                source,
                sourceHash: templateSourceHash(source),
                publicRanges: [],
                regions: [{ id: REGION_ID, startLine: 0, endLine: 1 }],
            },
            cases: [{ input: '1.in', output: '1.out' }],
        };

        const error = await recordModel
            .add('system', 7, 42, 'cc.cc17', JSON.stringify({ [REGION_ID]: 'return 2;', extra: 'forged' }), false, { type: 'judge' })
            .catch((caught) => caught);

        expect(error).to.be.instanceOf(Error);
        expect(error.message).to.include('keys do not match');
        expect(insertedRecords).to.deep.equal([]);
    });

    it('rejects a code evaluation draft before deleting or enqueueing judge tasks', async () => {
        problemKind = 'function';
        codeEvaluationStatus = 'draft';
        problemConfig = {
            type: 'function',
        };
        const record = {
            _id: new ObjectId(),
            domainId: 'system',
            pid: 7,
            uid: 42,
            lang: 'cc.cc17',
            code: '{}',
        } as any;

        const error = await recordModel.judge('system', record).catch((caught) => caught);

        expect(error).to.be.instanceOf(Error);
        expect(error.message).to.include('not ready');
        expect(deletedTaskQueries).to.deep.equal([]);
        expect(queuedTasks).to.deep.equal([]);
    });

    it('rejects testdata generation for a draft before inserting its record', async () => {
        problemKind = 'program_fill';
        codeEvaluationStatus = 'draft';
        problemConfig = { type: 'program_fill', mode: 'compile' };

        const error = await recordModel.add('system', 7, 42, '_', 'gen.cpp\nstd.cpp', true, { type: 'generate' }).catch((caught) => caught);

        expect(error).to.be.instanceOf(Error);
        expect(error.message).to.include('not ready');
        expect(structureLockRequests).to.deep.equal([false]);
        expect(insertedRecords).to.deep.equal([]);
        expect(queuedTasks).to.deep.equal([]);
    });

    it('queues testdata generation for a ready function problem without treating generator filenames as a region submission', async () => {
        problemKind = 'function';
        codeEvaluationStatus = 'ready';
        const source = 'int solve() { return 1; }';
        problemConfig = {
            type: 'function',
            langs: ['cc.cc17'],
            template: {
                lang: 'cc.cc17',
                source,
                sourceHash: templateSourceHash(source),
                publicRanges: [],
                regions: [{ id: REGION_ID, startLine: 0, endLine: 1 }],
            },
            cases: [{ input: '1.in', output: '1.out' }],
        };

        await recordModel.add('system', 7, 42, '_', 'gen.cpp\nstd.cpp', true, { type: 'generate' });

        expect(structureLockRequests).to.deep.equal([false]);
        expect(insertedRecords).to.have.length(1);
        expect(insertedRecords[0].code).to.equal('gen.cpp\nstd.cpp');
        expect(queuedTasks).to.have.length(1);
        expect(queuedTasks[0].type).to.equal('generate');
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

    it('derives and persists the stable team identity before inserting a contest record', async () => {
        problemConfig = { type: 'default' };
        const contestId = new ObjectId();
        const teamId = new ObjectId();
        const calls: any[] = [];
        (global as any).Hydro.model.contest.resolveTeamSubmissionCapability = async (
            domainId: string,
            tid: ObjectId,
            uid: number,
            options: { vigilSessionKey?: string },
        ) => {
            calls.push({ domainId, tid, uid, options });
            return { mode: 'team', contestId: tid, teamId, captainUid: uid, memberUids: [uid], vigilSessionCheck: 'verified' };
        };

        await recordModel.add('system', 7, 42, 'cc', 'int main() {}', false, {
            contest: contestId,
            type: 'judge',
            vigilSessionKey: 'hydro-session-42',
        });

        expect(calls).to.have.length(1);
        expect(calls[0]).to.include({ domainId: 'system', uid: 42 });
        expect(calls[0].options).to.deep.equal({ vigilSessionKey: 'hydro-session-42' });
        expect(calls[0].tid.equals(contestId)).to.equal(true);
        expect(insertedRecords).to.have.length(1);
        expect(insertedRecords[0].contest.equals(contestId)).to.equal(true);
        expect(insertedRecords[0].contestTeamId.equals(teamId)).to.equal(true);
        expect(insertedRecords[0].uid).to.equal(42);
    });

    it('uses the original team contest context for pretests while retaining the pretest sentinel', async () => {
        problemConfig = { type: 'default' };
        const contestId = new ObjectId();
        const teamId = new ObjectId();
        (global as any).Hydro.model.contest.resolveTeamSubmissionCapability = async () => ({
            mode: 'team',
            contestId,
            teamId,
            captainUid: 42,
            memberUids: [42],
            vigilSessionCheck: 'verified',
        });

        await recordModel.add('system', 7, 42, 'cc', 'int main() {}', false, {
            type: 'pretest',
            input: ['1'],
            contestContext: contestId,
        });

        expect(insertedRecords).to.have.length(1);
        expect(insertedRecords[0].contest.equals(recordModel.RECORD_PRETEST)).to.equal(true);
        expect(insertedRecords[0].contestTeamId.equals(teamId)).to.equal(true);
    });

    it('does not insert any record when the unified team capability rejects the actor', async () => {
        problemConfig = { type: 'default' };
        const contestId = new ObjectId();
        (global as any).Hydro.model.contest.resolveTeamSubmissionCapability = async () => {
            throw new Error('captain_required');
        };

        const error = await recordModel
            .add('system', 7, 43, 'cc', 'int main() {}', false, { contest: contestId, type: 'judge' })
            .catch((caught) => caught);

        expect(error).to.be.instanceOf(Error);
        expect(error.message).to.equal('captain_required');
        expect(insertedRecords).to.deep.equal([]);
    });
});
