import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createDraftConfig } from '@hydrooj/common/set-config';
import { rankingDay, rankingWindow } from '@hydrooj/common/activity-ranking';
import { STATUS } from '@hydrooj/common/status';
import { activityStandings, publicFirstSolves } from '../src/lib/activity-ranking';

const day = (s: string) => new Date(`${s}T00:00:00+08:00`);
const num = (s: string) => rankingDay(day(s));

it('uses Beijing calendar boundaries for midnight, Monday, leap months and year changes', () => {
    assert.equal(rankingDay(new Date('2026-11-22T15:59:59.999Z')) + 1, num('2026-11-23'));
    assert.deepEqual([rankingWindow('week', '2027-01-03').from, rankingWindow('week', '2027-01-03').through], ['2026-12-28', '2027-01-03']);
    assert.equal(rankingWindow('month', '2024-02-29').next, '2024-03-01');
    assert.throws(() => rankingWindow('day', '2026-02-29'), /date_invalid/);
});

it('credits a problem once, keeps day 30, and ties by the chosen metric before pagination', () => {
    const first = num('2026-10-28');
    const users = publicFirstSolves([
        { uid: 2, pid: 1, day: first + 30 }, { uid: 2, pid: 1, day: first },
        { uid: 2, pid: 2, day: first + 29 }, { uid: 2, pid: 3, day: first + 30 },
        { uid: 3, pid: 1, day: first + 29 }, { uid: 3, pid: 2, day: first + 29 },
        { uid: 4, pid: 1, day: first + 29 }, { uid: 9, pid: 1, day: first - 50 },
    ]);
    const members = new Set([2, 3, 4]);
    const window = rankingWindow('week', '2026-11-27');
    assert.deepEqual(activityStandings(users, 'solves', window, members).rows.map((x) => [x.uid, x.rank]), [[2, 1], [3, 1], [4, 3]]);
    assert.deepEqual(activityStandings(users, 'newcomers', window, members).rows.map((x) => [x.uid, x.solves, x.rank]), [[3, 2, 1], [2, 1, 2], [4, 1, 2]]);
    assert.deepEqual(activityStandings(users, 'consistency', window, members).rows.map((x) => [x.uid, x.activeDays, x.rank]), [[2, 2, 1], [3, 1, 2], [4, 1, 2]]);
    assert.equal(activityStandings(users, 'solves', window, members).earliest, first);
});

let mongo: MongoMemoryServer;
let client: MongoClient;
let database: Db;
let model: typeof import('../src/model/activity-ranking');
const sentinels = [new ObjectId(), new ObjectId(), new ObjectId()];
before(async () => {
    mongo = await MongoMemoryServer.create({ binary: { version: '8.2.1' } });
    client = await new MongoClient(mongo.getUri()).connect();
    database = client.db('activity');
    const mod = require('node:module');
    const prior = mod._load;
    try {
        mod._load = function load(name: string, parent: { filename?: string }, main: boolean) {
            if (parent?.filename?.endsWith('/model/activity-ranking.ts')) {
                if (name === './contest') return { RULES: { acm: { showScoreboard: () => true } } };
                if (name === './document') return { TYPE_CONTEST: 30, TYPE_PROBLEM: 10, TYPE_TRAINING: 40 };
                if (name === './record') {
                    return { coll: database.collection('record'), RECORD_PRETEST: sentinels[0],
                        RECORD_GENERATE: sentinels[1], RECORD_VERIFY: sentinels[2] };
                }
                if (name === '../service/db') return database;
            }
            return prior.call(this, name, parent, main);
        };
        model = require('../src/model/activity-ranking');
    } finally { mod._load = prior; }
});
after(async () => {
    await client?.close();
    await mongo?.stop();
});

it('counts public individual evidence across origins, and immediately rechecks publication on cached ACs', async () => {
    const domainId = 'privacy';
    const docs = database.collection('document');
    const records = database.collection('record');
    const contest = new ObjectId();
    const privateSet = new ObjectId();
    const round = new ObjectId();
    let serial = 0;
    const rid = (s: string) => new ObjectId((+day(s) / 1000).toString(16).padStart(8, '0') + (++serial).toString(16).padStart(16, '0'));
    const ac = (pid: number, date: string, extra: object = {}) => ({ _id: rid(date), domainId, uid: 8, pid, status: STATUS.STATUS_ACCEPTED, ...extra });
    await docs.insertMany([1, 2, 3, 4, 5, 6, 7, 8].map((docId) => ({ domainId, docId, docType: 10,
        problemKind: docId === 2 ? 'single' : docId === 4 ? 'program_fill' : 'function', config: { mode: 'text' }, hidden: docId === 3 })));
    await docs.insertMany([{ domainId, docId: contest, docType: 30, rule: 'acm', pids: [1, 4, 5], hidden: true,
        beginAt: day('2026-01-01'), endAt: day('2026-01-20') },
    { domainId, docId: privateSet, docType: 40, kind: 'problem_set', problemSetAudience: { public: false }, dag: [{ _id: 1, requireNids: [] }] }]);
    await records.insertMany([ac(1, '2026-01-01', { uid: 2 }), ac(1, '2026-01-10', { contest }), ac(1, '2026-01-21'), ac(1, '2026-01-22'),
        ac(2, '2026-01-21'), ac(3, '2026-01-21'), ac(5, '2026-01-15', { contest, contestTeamId: new ObjectId() }),
        ac(6, '2026-01-17', { virtualAttemptId: new ObjectId(), sourceContestId: contest }),
        ac(6, '2026-01-17', { contest: sentinels[0] }), ac(6, '2026-01-17', { contest: sentinels[1] }), ac(6, '2026-01-17', { contest: sentinels[2] }),
        ac(7, '2026-01-14', { practiceContext: { mode: 'student', containerId: privateSet, targets: [{ containerId: privateSet, scopeId: 1 }] } }),
        ac(8, '2026-01-10', { status: STATUS.STATUS_CANCELED }), ac(8, '2026-01-11', { domainId: 'other' })]);
    await database.collection('contest.rounds').insertOne({ _id: round, tid: contest, domainId, participantKey: 'u:8', closedAt: day('2026-01-20') });
    const operations = database.collection('contest.answerOperations');
    await operations.insertMany([2, 8].map((uid) => ({ domainId, uid, tid: contest, roundId: round,
        kind: 'program_fill', state: 'complete', planned: { changed: [{ pid: 4, status: STATUS.STATUS_ACCEPTED, acceptedAt: day('2026-01-18') }] } })));
    const candidates = await model.firstAcceptedCandidates(domainId, records, operations, sentinels);
    assert.ok(candidates.every((item) => item.uid !== 2));
    async function days() {
        const { users } = await model.readPublicActivity(domainId);
        return [...users.get(8)!].sort((a, b) => a[0] - b[0]);
    }
    assert.deepEqual(await days(), [[1, num('2026-01-21')]]);
    await docs.updateOne({ docId: contest }, { $set: { hidden: false } });
    await docs.updateOne({ docId: privateSet }, { $set: { 'problemSetAudience.public': true } });
    assert.deepEqual(await days(), [[1, num('2026-01-10')], [4, num('2026-01-18')], [7, num('2026-01-14')]]);
    await docs.updateOne({ docId: contest }, { $set: { participantScopeMode: 'groups' } });
    assert.deepEqual(await days(), [[1, num('2026-01-21')], [7, num('2026-01-14')]]);
    await records.updateMany({ domainId, pid: 1, contest: null }, { $set: { status: STATUS.STATUS_WRONG_ANSWER } });
    const fresh = await model.firstAcceptedCandidates(domainId, records, database.collection('contest.answerOperations'), sentinels);
    const corrected = await model.resolvePublicActivity(domainId, fresh, day('2026-02-01'), docs, database.collection('contest.rounds'));
    assert.equal(corrected.get(8)?.has(1), false);
});

it('respects grade release, the least privileged group, paper ownership and freeze before crediting an exam', async () => {
    const domainId = 'exam-release';
    const docs = database.collection('document');
    const rounds = database.collection('contest.rounds');
    const contest = new ObjectId();
    const round = new ObjectId();
    const config = createDraftConfig('exam');
    config.publication = 'published';
    const defaults = { problems: 'view', records: 'list', afterEnd: true, scoreboard: true } as const;
    config.settings.authorization = { defaults, groups: [] };
    config.settings.feedback.code = { when: 'after_release', reveal: 'full', afterDeadline: 'same' };
    config.settings.scoreboard = 'live';
    const at = day('2026-02-08');
    const items = [{ uid: 8, pid: 10, contest, round, at }, { uid: 3, pid: 10, contest, round, at }];
    await docs.insertMany([{ domainId, docType: 10, docId: 10, problemKind: 'programming' },
        { domainId, docType: 30, docId: contest, rule: 'exam', setConfig: config, pids: [10], beginAt: day('2026-02-01'),
            endAt: day('2026-02-10'), lockAt: day('2026-02-07') }]);
    await rounds.insertOne({ _id: round, tid: contest, domainId, participantKey: 'u:8', startedAt: day('2026-02-02') });
    const result = () => model.resolvePublicActivity(domainId, items, day('2026-02-15'), docs, rounds);
    const edit = (values: Record<string, unknown>) => docs.updateOne({ domainId, docId: contest }, { $set: values });
    assert.equal((await result()).size, 0);
    await edit({ unlocked: true });
    assert.equal((await result()).size, 0);
    await edit({ 'setConfig.settings.feedback.gradesReleased': true });
    assert.deepEqual([...(await result()).keys()], [8]);
    const group = { ...defaults, groupId: new ObjectId().toHexString(), records: 'self' };
    await edit({ 'setConfig.settings.authorization.groups': [group] });
    assert.equal((await result()).size, 0);
    await edit({ 'setConfig.settings.authorization.groups': [], 'setConfig.settings.feedback.code.when': 'after_round' });
    assert.deepEqual([...(await result()).keys()], [8]);
    await edit({ 'setConfig.settings.authorization.defaults.afterEnd': false });
    assert.equal((await result()).size, 0);
    await edit({ 'setConfig.settings.authorization.defaults.afterEnd': true });
    await docs.updateOne({ domainId, docId: 10 }, { $set: { problemKind: 'program_fill', config: { mode: 'text' } } });
    const saved = [{ uid: 8, pid: 10, contest, round, at, savedAnswer: true }];
    const textResults = () => model.resolvePublicActivity(domainId, saved, day('2026-02-15'), docs, rounds);
    assert.deepEqual([...(await textResults()).keys()], [8]);
    await edit({ 'setConfig.settings.scoreboard': 'off' });
    assert.equal((await textResults()).size, 0);
});

it('credits the next surviving public AC at submission time after a rejudge, with no credit for VP-only users', async () => {
    const domainId = 'rejudged';
    const records = database.collection('record');
    const docs = database.collection('document');
    const operations = database.collection('contest.answerOperations');
    const rounds = database.collection('contest.rounds');
    const pid = 12;
    await docs.insertOne({ domainId, docType: 10, docId: pid });
    const first = ObjectId.createFromTime(+day('2026-11-22') / 1000);
    const second = ObjectId.createFromTime(+day('2026-11-24') / 1000);
    await records.insertMany([{ _id: first, pid, uid: 7, domainId, status: STATUS.STATUS_ACCEPTED, judgeAt: day('2026-11-25') },
        { _id: second, pid, uid: 7, domainId, status: STATUS.STATUS_ACCEPTED },
        { pid, uid: 8, domainId, status: STATUS.STATUS_ACCEPTED, virtualAttemptId: new ObjectId() },
        { pid, uid: 9, domainId, status: STATUS.STATUS_ACCEPTED, sourceContestId: new ObjectId() }]);
    async function collect() {
        const facts = await model.firstAcceptedCandidates(domainId, records, operations, sentinels);
        return model.resolvePublicActivity(domainId, facts, day('2026-11-26'), docs, rounds);
    }
    assert.deepEqual([...(await collect())], [[7, new Map([[pid, num('2026-11-22')]])]]);
    await records.updateOne({ _id: first }, { $set: { status: STATUS.STATUS_WRONG_ANSWER } });
    assert.deepEqual([...(await collect())], [[7, new Map([[pid, num('2026-11-24')]])]]);
});
