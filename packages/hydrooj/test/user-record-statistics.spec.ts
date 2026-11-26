import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { getUserRecordStatistics } from '../src/lib/user-record-statistics';

const Module = require('node:module');
const excluded = [0, 1, 2].map((value) => new ObjectId(value.toString().padStart(24, '0')));
let mongo: MongoMemoryServer;
let client: MongoClient;

before(async () => {
    mongo = await MongoMemoryServer.create({ binary: { version: '8.2.1' } });
    client = new MongoClient(mongo.getUri());
    await client.connect();
});

after(async () => {
    await client?.close();
    await mongo?.stop();
});

function recordFixture() {
    const contest = new ObjectId('111111111111111111111111');
    const accepted = Array.from({ length: 26 }, (_, index) => ({ domainId: 'system', uid: 1371, pid: index + 1, status: 1, contest }));
    return [
        ...accepted,
        { ...accepted[0], contest: new ObjectId('222222222222222222222222') },
        ...Array.from({ length: 44 }, (_, index) => ({ ...accepted[index % 4], status: index % 2 ? 2 : 7 })),
        ...excluded.map((sentinel) => ({ ...accepted[0], pid: 99, contest: sentinel })),
        { ...accepted[0], pid: 98, status: 9 },
        { ...accepted[0], uid: 1372, pid: 97 },
        { ...accepted[0], domainId: 'another', pid: 96 },
    ];
}

describe('user submission statistics', () => {
    it('rebuilds submission attempts and unique accepted problems without modifying records', async () => {
        const db = client.db('profile_statistics_rebuild');
        await db.collection('record').insertMany(recordFixture());
        await db.collection('domain.user').insertOne({ domainId: 'system', uid: 1371, nSubmit: 26, nAccept: 26 });
        const beforeRecords = await db.collection('record').find().sort({ _id: 1 }).toArray();
        const originalLoad = Module._load;
        let rebuild: (report: (event: unknown) => void) => Promise<void>;
        try {
            Module._load = function load(request: string, parent: { filename?: string }, isMain: boolean) {
                if (parent?.filename?.endsWith('/script/problemStat.ts')) {
                    if (request === '../model/builtin') return { STATUS: { STATUS_ACCEPTED: 1, STATUS_CANCELED: 9 } };
                    if (request === '../model/document') return { coll: db.collection('document'), TYPE_PROBLEM_SOLUTION: 11 };
                    if (request === '../model/record') {
                        return { RECORD_PRETEST: excluded[0], RECORD_GENERATE: excluded[1], RECORD_VERIFY: excluded[2] };
                    }
                    if (request === '../service/db') return { collection: (name: string) => db.collection(name) };
                }
                return originalLoad.call(this, request, parent, isMain);
            };
            rebuild = require('../src/script/problemStat').udoc;
        } finally {
            Module._load = originalLoad;
        }
        await rebuild(() => undefined);
        const user = await db.collection('domain.user').findOne({ domainId: 'system', uid: 1371 });
        assert.equal(user?.nSubmit, 71);
        assert.equal(user?.nAccept, 26);
        assert.deepEqual(await db.collection('record').find().sort({ _id: 1 }).toArray(), beforeRecords);
    });

    it('reads authoritative counts across contests and isolates users, domains and non-submission records', async () => {
        const records = client.db('profile_statistics_read').collection('record');
        await records.insertMany(recordFixture());
        assert.deepEqual(await getUserRecordStatistics(records, excluded, { domainId: 'system', uid: 1371 }), { nSubmit: 71, nAccept: 26 });
        assert.deepEqual(await getUserRecordStatistics(records, excluded, { domainId: 'system', uid: 1372 }), { nSubmit: 1, nAccept: 1 });
        assert.deepEqual(await getUserRecordStatistics(records, excluded, { domainId: 'another', uid: 1371 }), { nSubmit: 1, nAccept: 1 });
        assert.deepEqual(await getUserRecordStatistics(records, excluded, { domainId: 'system', uid: 9999 }), { nSubmit: 0, nAccept: 0 });
    });

    it('reflects new submissions and current verdicts without double-counting rejudges', async () => {
        const records = client.db('profile_statistics_live').collection('record');
        await records.insertMany(recordFixture());
        const scope = { domainId: 'system', uid: 1371 };
        await records.updateOne({ ...scope, pid: 26 }, { $set: { status: 2 } });
        assert.deepEqual(await getUserRecordStatistics(records, excluded, scope), { nSubmit: 71, nAccept: 25 });
        const result = await records.insertOne({ ...scope, pid: 27, status: 2 });
        assert.deepEqual(await getUserRecordStatistics(records, excluded, scope), { nSubmit: 72, nAccept: 25 });
        await records.updateOne({ _id: result.insertedId }, { $set: { status: 1 } });
        assert.deepEqual(await getUserRecordStatistics(records, excluded, scope), { nSubmit: 72, nAccept: 26 });
    });

    it('propagates database failures instead of reporting zero submissions', async () => {
        const failure = new Error('statistics query failed');
        const records = { aggregate() { throw failure; } };
        await assert.rejects(getUserRecordStatistics(records, excluded, { domainId: 'system', uid: 1371 }), failure);
    });
});
