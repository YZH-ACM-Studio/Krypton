import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { Db, MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { rankingDay, type ActivityRankingPage } from '@hydrooj/common/activity-ranking';

const Module = require('node:module');
let mongo: MongoMemoryServer;
let client: MongoClient;
let database: Db;
let HandlerClass: new () => FakeHandler & { get(domainId: string, page?: number): Promise<void> };
const school = new ObjectId('111111111111111111111111');
const group = new ObjectId('222222222222222222222222');
const otherSchool = new ObjectId('333333333333333333333333');
const otherGroup = new ObjectId('444444444444444444444444');
const oldHydro = global.Hydro;
let directoryReads = 0;
let rankReads = 0;
let hydrated: number[] = [];

interface Body {
    activity?: ActivityRankingPage;
    udocs: Array<{ _id: number; rank: number }>;
    ucount: number;
    upcount: number;
    studentDict: Record<string, { studentId: string; realName: string }>;
    canFilterRanking: boolean;
    schools?: unknown;
    groups?: unknown;
    filters?: unknown;
    self: { _id: number; rank?: number } | null;
}

class FakeHandler {
    admin = false;
    args: Record<string, unknown> = {};
    user = { _id: 3, hasPriv: (priv: number) => priv === 1 ? this.admin : true };
    ctx = { setting: { get: () => 2 } };
    response: { body?: Body; template?: string; addHeader: (name: string, value: string) => void } = { addHeader() {} };
    checkPriv() { throw new Error('admin required'); }
}

before(async () => {
    mongo = await MongoMemoryServer.create({ binary: { version: '8.2.1' } });
    client = new MongoClient(mongo.getUri());
    await client.connect();
    database = client.db('ranking_handler');
    await database.collection('domain.user').insertMany([
        ...[3, 4].map((uid) => ({ domainId: 'system', uid, rp: 100 - uid, rank: uid, nAccept: uid, join: true })),
        ...[2, 8].map((uid) => ({ domainId: 'system', uid, rp: 98, rank: 1, nAccept: 2, join: true })),
        { domainId: 'system', uid: 5, rp: 1000, rank: 1, join: false },
        { domainId: 'system', uid: 6, rp: 0, rank: 0, join: true },
        { domainId: 'other', uid: 7, rp: 1000, rank: 1, join: true },
    ]);
    await database.collection<{ _id: number; uname: string }>('user').insertMany([2, 3, 4, 5, 6, 7, 8].map((uid) => ({ _id: uid, uname: `user${uid}` })));
    await database.collection('students').insertMany([
        { domainId: 'system', boundUserId: 8, studentId: '2026001', realName: '张甲', schoolId: school, groupIds: [group] },
        { domainId: 'system', boundUserId: 3, studentId: '2026002', realName: '张乙', schoolId: otherSchool, groupIds: [otherGroup] },
        { domainId: 'other', boundUserId: 4, studentId: '秘密学号', realName: '其他域姓名', schoolId: school, groupIds: [group] },
    ]);
    const originalLoad = Module._load;
    global.Hydro = { model: {} } as typeof global.Hydro;
    const rpDefinition = { hidden: false, base: 1, async run() { throw new Error('ranking must not recompute RP'); } };
    global.Hydro.model.rp = { problem: rpDefinition, contest: rpDefinition, hiddenPart: { ...rpDefinition, hidden: true } };
    try {
        Module._load = function load(request: string, parent: { filename?: string }, isMain: boolean) {
            if (parent?.filename?.endsWith('/handler/ranking.ts')) {
                if (request === '../model/activity-ranking') {
                    return { readPublicActivity: async () => {
                        const today = rankingDay(new Date());
                        return { updatedAt: new Date(), users: new Map([2, 3, 4, 5, 6, 7, 8].map((uid) => [uid, new Map([[1, today]])])) };
                    } };
                }
                if (request === '../lib/avatar') return (source: string) => source;
                if (request === '../error') return { ValidationError: Error };
                if (request === '../logger') return { Logger: class { warn(...args: unknown[]) { assert.ok(args.length); } } };
                if (request === '../model/builtin') return { PRIV: { PRIV_EDIT_SYSTEM: 1, PRIV_USER_PROFILE: 2 }, PERM: { PERM_VIEW_RANKING: 4 } };
                if (request === '../model/domain') {
 return { getMultiUserInDomain(domainId: string, filter: object) {
                    rankReads++;
                    return database.collection('domain.user').find({ domainId, ...filter });
                } };
}
                if (request === '../model/user') {
 return {
                    getMulti: (filter: object) => database.collection('user').find(filter),
                    getList: async (_domainId: string, uids: number[]) => {
                        hydrated = uids;
                        const users = await database.collection<{ _id: number }>('user').find({ _id: { $in: uids } }).toArray();
                        return Object.fromEntries(users.map((row) => [row._id, row]));
                    },
                };
}
                if (request === '../service/server') return { Handler: FakeHandler, query: () => () => undefined, Types: { PositiveInt: null } };
                if (request === '../service/student-directory') {
 return { studentDirectory: () => ({
                    findStudentsByUserIds: async (domainId: string, uids: number[]) => {
                        directoryReads++;
                        const students = await database.collection('students').find({ domainId, boundUserId: { $in: uids } }).toArray();
                        return Object.fromEntries(students.map((row) => [row.boundUserId, row]));
                    },
                    listSchools: async () => [{ _id: school, name: '学校甲' }, { _id: otherSchool, name: '学校乙' }],
                    listUserGroups: async () => [{ _id: group, schoolId: school, name: '甲班' }, { _id: otherGroup, schoolId: otherSchool, name: '乙班' }],
                }) };
}
            }
            return originalLoad.call(this, request, parent, isMain);
        };
        HandlerClass = require('../src/handler/ranking').DomainRankHandler;
    } finally {
        Module._load = originalLoad;
    }
});

after(async () => {
    global.Hydro = oldHydro;
    await client?.close();
    await mongo?.stop();
});

it('sorts eligible current-domain users across pages and hydrates only the selected page', async () => {
    const handler = new HandlerClass();
    handler.args = { sort: 'ac', order: 'desc' };
    await handler.get('system', 1);
    assert.deepEqual(handler.response.body?.udocs.map((row) => [row._id, row.rank]), [[4, 3], [3, 2]]);
    assert.deepEqual(hydrated, [4, 3]);
    assert.equal(handler.response.body?.ucount, 3);
    assert.equal(handler.response.body?.upcount, 2);
    assert.equal(handler.response.body?.self, null);
    assert.equal(directoryReads, 0);
    assert.equal(handler.response.body?.schools, undefined);
    assert.equal(handler.response.body?.filters, undefined);
    assert.deepEqual(handler.response.body?.studentDict, {});
    await handler.get('system', 2);
    assert.deepEqual(handler.response.body?.udocs.map((row) => [row._id, row.rank]), [[8, 1]]);
});

it('rejects direct private URL filters before reading ranking or roster data', async () => {
    for (const args of [{ q: '张' }, { schoolId: school.toHexString() }, { groupId: group.toHexString() }, { binding: 'unbound' }, { sort: 'student' }]) {
        const handler = new HandlerClass();
        handler.args = args;
        const beforeReads = [rankReads, directoryReads];
        await assert.rejects(handler.get('system'), /admin required/);
        assert.deepEqual([rankReads, directoryReads], beforeReads);
    }
});

it('uses canonical current-domain bindings and rejects incompatible school/group URLs', async () => {
    const handler = new HandlerClass();
    handler.admin = true;
    handler.args = { q: '张', schoolId: school.toHexString(), groupId: group.toHexString(), binding: 'bound' };
    await handler.get('system');
    assert.deepEqual(handler.response.body?.udocs.map((row) => row._id), [8]);
    assert.deepEqual(handler.response.body?.studentDict, { 8: { studentId: '2026001', realName: '张甲' } });
    assert.equal(handler.response.body?.ucount, 1);
    handler.args = { binding: 'unbound' };
    await handler.get('system');
    assert.deepEqual(handler.response.body?.udocs.map((row) => row._id), [4]);
    assert.equal(JSON.stringify(handler.response.body).includes('秘密学号'), false);
    handler.args = { schoolId: school.toHexString(), groupId: otherGroup.toHexString() };
    await assert.rejects(handler.get('system'), /groupId/);
});

it('defaults to weekly solves, includes joined newcomers with zero RP, and keeps off-page personal rank', async () => {
    const handler = new HandlerClass();
    await handler.get('system', 2);
    const activity = handler.response.body?.activity;
    assert.ok(activity);
    assert.equal(activity.board, 'solves');
    assert.equal(activity.period, 'week');
    assert.deepEqual(activity.rows.map((r) => r.uid), [6, 8]);
    assert.equal(activity.mine?.rank, 1);
    assert.equal(activity.count, 4);
    assert.equal(JSON.stringify(activity).includes('学号'), false);
    await assert.rejects(handler.get('system', 3), /page/);
    for (const args of [{ board: 'something' }, { board: 'consistency', period: 'day' }, { date: '2025-02-30' }, { date: '2180-11-22' }]) {
        handler.args = args;
        await assert.rejects(handler.get('system'));
    }
});

it('leaves root unranked across growth boards, RP standings and the personal row', async () => {
    const handler = new HandlerClass();
    handler.user._id = 2;
    handler.admin = true;
    for (const board of ['solves', 'newcomers', 'consistency']) {
        handler.args = { board };
        await handler.get('system');
        const result = handler.response.body?.activity;
        assert.ok(result);
        assert.deepEqual(result.rows.map((r) => r.uid), [3, 4]);
        assert.equal(result.count, 4);
        assert.equal(result.mine, null);
    }
    handler.args = { board: 'rp' };
    await handler.get('system');
    assert.deepEqual(handler.response.body?.udocs.map((r) => [r._id, r.rank]), [[8, 1], [3, 2]]);
    assert.equal(handler.response.body?.self, null);
    handler.args = { q: 'user2' };
    await handler.get('system');
    assert.equal(handler.response.body?.ucount, 0);
});

it('keeps rebuilt RP ranks and uses the same rank for an off-page viewer', async () => {
    const domainId = 'rebuilt';
    await database.collection('domain.user').insertMany([
        { domainId, uid: 2, rp: 99, rank: null, join: true },
        ...[3, 4, 8].map((uid, index) => ({ domainId, uid, rp: 100 - uid, rank: index + 1, join: true })),
    ]);
    const handler = new HandlerClass();
    handler.user._id = 8;
    handler.args = { board: 'rp' };
    await handler.get(domainId);
    assert.deepEqual(handler.response.body?.udocs.map((r) => r.rank), [1, 2]);
    assert.equal(handler.response.body?.self?.rank, 3);
    await handler.get(domainId, 2);
    assert.deepEqual(handler.response.body?.udocs.map((r) => [r._id, r.rank]), [[8, 3]]);
});
