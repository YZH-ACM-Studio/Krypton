import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { contestStatsPipeline, dashboardStatsPipeline, filterStatsRecords, normalizeContestStats, normalizeDashboardStats, statsRecordWindow } from '../src/lib/admin-stats';

let mongo: MongoMemoryServer;
let client: MongoClient;
const homework = new ObjectId();
before(async () => {
    mongo = await MongoMemoryServer.create({ binary: { version: '8.2.1' } });
    client = new MongoClient(mongo.getUri());
    await client.connect();
    await client.db('stats').collection('record').insertMany([
        { at: '2026-09-30T15:59:59Z', contest: homework },
        { at: '2026-09-30T16:00:00Z', contest: homework },
        { at: '2026-10-31T15:59:59Z', contest: homework },
        { at: '2026-10-31T16:00:00Z', contest: homework },
        { at: '2026-10-15T10:00:00Z', contest: new ObjectId() },
    ].map(({ at, contest }) => ({ _id: ObjectId.createFromTime(Date.parse(at) / 1000), domainId: 'd', uid: 7, pid: 1, status: 1, lang: 'cc', contest })));
});
after(async () => {
    await client?.close();
    await mongo?.stop();
});

it('filters homework, KPI totals, and every chart by the same inclusive Beijing window', async () => {
    const window = statsRecordWindow(0, '2026-10-01', '2026-10-31');
    const records = client.db('stats').collection('record');
    const stats = normalizeContestStats(await records.aggregate(filterStatsRecords(contestStatsPipeline('d', homework, 1), window)).toArray());
    assert.equal(stats.total, 2);
    assert.equal(stats.byHour.reduce((sum, row) => sum + row.count, 0), 2);
    assert.equal(stats.byProblem[0].total, 2);
    const dashboard = normalizeDashboardStats(await records.aggregate(filterStatsRecords(dashboardStatsPipeline('d', 1, window.since), window)).toArray(), window.days);
    assert.equal(dashboard.total, 3);
    assert.equal(dashboard.byDay.reduce((sum, row) => sum + row.total, 0), 3);
    assert.equal(dashboard.byDay.length, 31);
    const all = statsRecordWindow(0);
    const total = normalizeContestStats(await records.aggregate(filterStatsRecords(contestStatsPipeline('d', homework, 1), all)).toArray());
    assert.equal(total.total, 4);
});

it('quick ranges include today and reject invalid custom intervals', () => {
    const window = statsRecordWindow(7, '', '', new Date('2026-11-02T01:00:00Z'));
    assert.equal(window.days[0], '2026-10-27');
    assert.equal(window.days.at(-1), '2026-11-02');
    assert.throws(() => statsRecordWindow(0, '2026-10-02', '2026-10-01'));
});
