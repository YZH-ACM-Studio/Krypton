import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Service } from 'cordis';
import { Logger } from '@hydrooj/utils';
import { createDraftConfig, parseSetConfig, PERM, SET_DEFAULT_PERMISSIONS, SET_EXPERIENCE_DEFAULTS, STATUS, type ContestReplayFrame } from '@hydrooj/common';
import type { Tdoc } from '../src/interface';
import { InMemoryStudentDirectory, studentRecord } from '../src/lib/testing/in-memory-student-directory';
import type { VirtualContestAttemptDoc } from '../src/model/virtual-contest';

const minute = 60_000;
const start = new Date('2026-01-02T10:00:00Z');
const vpStart = new Date('2026-02-01T10:00:00Z');
const time = (origin: Date, minutes: number) => new Date(+origin + minutes * minute);
const rid = (date: Date) => ObjectId.createFromTime(+date / 1000);
const actor = { _id: 8, hasPerm: (permission: bigint) => permission === PERM.PERM_VIEW_CONTEST_SCOREBOARD, hasPriv: () => false, own: () => false };
let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let read: typeof import('../src/model/virtual-contest-replay').readContestReplay;
let snapshot: typeof import('../src/lib/virtual-contest').buildVirtualContestSnapshot;
let handler: typeof import('../src/handler/virtual-contest').VirtualContestReplayHandler;
let support: typeof import('../src/lib/virtual-contest-replay').supportsContestReplay;

before(async () => {
    mongo = await MongoMemoryServer.create({ binary: { version: '8.2.1' } });
    client = await new MongoClient(mongo.getUri(), { monitorCommands: true }).connect();
    db = client.db('vp_replay');
    await db.collection('document').insertMany([['programming', 101], ['single', 102]].map(([kind, pid]) =>
        ({ domainId: 'test', docType: 10, docId: pid, problemKind: kind, config: {} })));
    const logger = new Logger('replay-test');
    const modules = new Proxy({} as Record<string, Record<string, unknown>>, { get: (registry, key: string) => registry[key] ??= {} });
    global.Hydro = { version: { node: process.version, hydrooj: 'test' }, model: {}, script: {}, module: modules,
        ui: {}, error: {}, locales: {}, Logger, logger } as unknown as typeof global.Hydro;
    const { Context } = require('../src/context') as typeof import('../src/context');
    global.app = new Context();
    class TestDb extends Service {
        constructor() { super(global.app, 'db'); }
        collection(name: string) { return db.collection(name); }
    }
    const service = new TestDb();
    void service;
    const User = (require('../src/model/user') as typeof import('../src/model/user')).default;
    // Rendering users is external to scoring. Account names look deliberately different from display names.
    User.getListForRender = async (_domain, uids) => Object.fromEntries(uids.map((uid) => [uid, { uname: `user${uid}`, displayName: 'private-name' }])) as Awaited<ReturnType<typeof User.getListForRender>>;
    ({ readContestReplay: read } = require('../src/model/virtual-contest-replay'));
    ({ buildVirtualContestSnapshot: snapshot } = require('../src/lib/virtual-contest'));
    ({ supportsContestReplay: support } = require('../src/lib/virtual-contest-replay'));
    ({ VirtualContestReplayHandler: handler } = require('../src/handler/virtual-contest'));
});

after(async () => {
    await client?.close();
    await mongo?.stop();
});

function contest(rule: string, configured = false): Tdoc {
    const config = createDraftConfig('contest');
    return {
        domainId: 'test', docType: 30, docId: new ObjectId(), title: 'Replay test', pids: [101, 102], rule: configured ? 'contest' : rule,
        duration: 0, beginAt: start, endAt: time(start, 180), unlocked: true,
        ...(configured ? { setConfig: parseSetConfig({ ...config, publication: 'published',
            settings: { ...config.settings, codePolicy: rule === 'acm' ? 'acm' : 'highest' } }) } : {}),
    } as Tdoc;
}
function attempt(doc: Tdoc, uid = actor._id, begin = vpStart): VirtualContestAttemptDoc {
    return { _id: new ObjectId(), domainId: doc.domainId, sourceContestId: doc.docId, uid, startAt: begin,
        endAt: time(begin, 180), endedAt: null, cancelledAt: null, voidedAt: null, firstRecordAt: null, createdAt: begin,
        snapshot: snapshot(doc), journal: [], status: 'active', rev: 1 };
}
function submission(origin: Date, mins: number, pid = 101, score = 100, status = STATUS.STATUS_ACCEPTED) {
    return { rid: rid(time(origin, mins)), pid, score, status };
}
async function officials(doc: Tdoc, rows: Record<string, unknown>[]) {
    await db.collection('document.status').insertMany(rows.map((row) => ({ domainId: doc.domainId, docType: 30, docId: doc.docId, attend: 1, ...row })));
}
const row = (frame: ContestReplayFrame, uid: number, source: 'official' | 'self' | 'virtual' = 'official') =>
    frame.rows.find((r) => r.uid === uid && r.source === source)!;

it('mixes separate entries, keeps starred ranks out, clamps future seeks and fixes the opponent roster at start', async () => {
    const doc = contest('ioi');
    const mine = attempt(doc);
    mine.journal = [submission(vpStart, 5), submission(vpStart, 25, 102)];
    await officials(doc, [
        { uid: 8, journal: [submission(start, 10)] },
        { uid: 9, unrank: true, journal: [submission(start, 2)] },
        { uid: 10, journal: [submission(start, 18)] },
    ]);
    const prior = attempt(doc, 4, time(vpStart, -200));
    prior.journal = [submission(prior.startAt, 5)];
    // Natural expiry may not yet have been settled. Early end, cancelled and another domain must stay distinct.
    const early = { ...attempt(doc, 5, time(vpStart, -10)), status: 'ended', endedAt: time(vpStart, -1) };
    await db.collection('virtual.attempts').insertMany([prior, early, { ...early, _id: new ObjectId(), uid: 6, endedAt: time(vpStart, 2) },
        { ...prior, _id: new ObjectId(), uid: 7, status: 'voided' }, { ...prior, _id: new ObjectId(), domainId: 'other', uid: 88 }]);
    const frame = await read(doc, mine, actor, 180 * minute, time(vpStart, 12));
    assert.equal(frame.atMs, 12 * minute);
    assert.deepEqual(frame.rows.map((r) => [r.uid, r.source, r.rank]), [
        [9, 'official', 0], [4, 'virtual', 1], [8, 'self', 1], [8, 'official', 3], [5, 'virtual', 4], [10, 'official', 4],
    ]);
    assert.equal(row(frame, 8, 'self').seconds, 300);
    const old = await read(doc, mine, actor, 3 * minute, time(vpStart, 12));
    assert.equal(row(old, 8, 'self').score, 0);
    assert.equal(row(frame, 10).score, 0);
    assert.doesNotMatch(JSON.stringify(frame), /private-name|journal|recordId|setRoundId/);
});

it('replays ACM freeze and original penalty, then reveals only a published final and stops the early finisher', async () => {
    const doc = contest('acm');
    doc.duration = 3;
    doc.lockAt = time(start, 120);
    const mine = attempt(doc);
    mine.journal = [submission(vpStart, 20), submission(vpStart, 100, 102)];
    const late = time(start, 30);
    await officials(doc, [{ uid: 4, startAt: late, journal: [
        submission(late, 5), submission(late, 125, 102), submission(late, 2, 101, 0, STATUS.STATUS_WRONG_ANSWER),
    ] }, { uid: 6, accept: 1, time: 2400, journal: [submission(late, 10)] }]);
    const early = await read(doc, mine, actor, 5 * minute, time(vpStart, 135));
    assert.equal(row(early, 4).score, 1);
    assert.equal(early.incomplete, 1);
    assert.equal(row(early, 6), undefined);
    assert.equal(row(early, 4).seconds, (35 + 20) * 60);
    const frozen = await read(doc, mine, actor, 130 * minute, time(vpStart, 135));
    assert.equal(frozen.frozen, true);
    assert.equal(row(frozen, 4).cells[1], '?1');
    mine.status = 'ended';
    mine.endedAt = time(vpStart, 90);
    const final = await read(doc, mine, actor, undefined, time(vpStart, 95));
    assert.equal(final.atMs, 180 * minute);
    assert.equal(row(final, 4).score, 2);
    assert.equal(row(final, 6).score, 1);
    assert.equal(row(final, 6).seconds, 2400);
    assert.equal(row(final, 8, 'self').score, 1);
    doc.unlocked = false;
    assert.equal(row(await read(doc, mine, actor, undefined, time(vpStart, 95)), 4).score, 1);
});

it('retains archived IOI scores whose problem breakdown or submission timestamps are missing', async () => {
    const doc = contest('ioi');
    const mine = attempt(doc);
    await officials(doc, [
        { uid: 4, journal: [submission(start, 10)] },
        { uid: 5, score: 100, detail: { 101: { score: 100 } } },
        { uid: 6, score: 100 },
    ]);
    const running = await read(doc, mine, actor, undefined, time(vpStart, 90));
    assert.equal(running.incomplete, 2);
    assert.deepEqual(running.rows.map((r) => r.uid), [4, 8]);
    mine.status = 'ended';
    mine.endedAt = time(vpStart, 95);
    const final = await read(doc, mine, actor, undefined, time(vpStart, 100));
    assert.deepEqual(final.rows.slice(0, 3).map((r) => [r.uid, r.score, r.passed, r.seconds, r.cells[0]]), [
        [4, 100, 1, 600, 100], [5, 100, 1, null, 100], [6, 100, null, null, null],
    ]);
});

it('scores PTA answer revisions at each cutoff, keeps locked totals for the final and redacts hidden totals', async () => {
    const doc = contest('ioi', true);
    doc.score = { 101: 50, 102: 100 };
    const mine = attempt(doc);
    mine.journal = [submission(vpStart, 3)];
    await officials(doc, [{ uid: 3 }, { uid: 4 }]);
    const base = { _id: new ObjectId(), domainId: 'test', tid: doc.docId, participantKey: 'u:3', roundNo: 1, state: 'closed',
        startedAt: start, closedAt: time(start, 145), paperPids: doc.pids, total: 150, passed: true };
    await db.collection('contest.rounds').insertMany([base, { ...base, _id: new ObjectId(), participantKey: 'u:4',
        total: 79, legacy: { incompleteHistory: true, scoreLocked: true }, detail: { 102: { pid: 102, score: 79 } } }]);
    const answer = { pid: 102, version: 1, rawScore: 42, acceptedAt: time(start, 5) };
    await db.collection('contest.answerOperations').insertOne({ domainId: 'test', tid: doc.docId, roundId: base._id, state: 'complete', planned: { changed: [answer] } });
    await db.collection('contest.answers').insertOne({ domainId: 'test', roundId: base._id, ...answer, version: 2, rawScore: 100, acceptedAt: time(start, 15) });
    await db.collection('record').insertOne({ _id: rid(time(start, 4)), domainId: 'test', setRoundId: base._id,
        pid: 101, status: STATUS.STATUS_ACCEPTED, score: 100, judgeAt: time(start, 16), setAcceptedAt: time(start, 10) });
    const frame = await read(doc, mine, actor, 9 * minute, time(vpStart, 25));
    assert.equal(frame.rule, 'highest');
    assert.deepEqual(frame.pids, [101, 102]);
    assert.equal(frame.incomplete, 1);
    assert.equal(row(frame, 3).score, 42);
    assert.equal(row(frame, 8, 'self').score, 50);
    assert.equal(row(frame, 4), undefined);
    assert.equal(row(await read(doc, mine, actor, 11 * minute, time(vpStart, 25)), 3).score, 92);
    mine.status = 'ended'; mine.endedAt = time(vpStart, 30);
    const final = await read(doc, mine, actor, undefined, time(vpStart, 35));
    assert.equal(row(final, 4).score, 79);
    assert.equal(row(final, 3).score, 150);
    const config = doc.setConfig!;
    doc.setConfig = parseSetConfig({ ...config, settings: { ...config.settings,
        experience: { ...SET_EXPERIENCE_DEFAULTS, hideTotalScore: true } } });
    const hidden = await read(doc, mine, actor, undefined, time(vpStart, 40));
    assert.deepEqual(hidden.rows.map((r) => r.uid), [3, 4, 8]);
    assert.ok(hidden.rows.every((r) => !('score' in r) && !('rank' in r) && !('seconds' in r)));
    const { withStudentDirectory } = require('../src/service/student-directory') as typeof import('../src/service/student-directory');
    const directory = new InMemoryStudentDirectory({
        students: [studentRecord({ domainId: doc.domainId, boundUserId: 3, realName: '正式选手甲' })],
    });
    doc.setConfig.settings.experience.showDisplayName = true;
    const named = await withStudentDirectory(directory, () => read(doc, mine, actor, undefined, time(vpStart, 40)));
    assert.equal(row(named, 3).name, '正式选手甲');
    assert.equal(row(named, 4).name, 'user4');
});

it('aligns staggered PTA entries while preserving native and migrated penalty clocks and the original public freeze', async () => {
    const doc = contest('acm', true);
    doc.endAt = time(start, 360);
    doc.lockAt = time(start, 90);
    const config = doc.setConfig!;
    doc.setConfig = parseSetConfig({ ...config, settings: { ...config.settings, personalLimit: { hours: 2, requireFullWindow: false } } });
    const mine = attempt(doc);
    mine.endAt = time(vpStart, 120);
    const late = time(start, 100);
    await officials(doc, [{ uid: 11 }, { uid: 12 }]);
    for (const uid of [11, 12]) {
        const roundId = new ObjectId();
        await db.collection('contest.rounds').insertOne({ domainId: 'test', tid: doc.docId, _id: roundId, participantKey: `u:${uid}`,
            startedAt: late, closedAt: time(late, 90), roundNo: 1, state: 'closed', paperPids: [101], total: 1,
            ...(uid === 12 ? { scoreStartedAt: start } : {}) });
        const accepted = time(late, uid - 6);
        await db.collection('record').insertOne({ _id: rid(accepted), domainId: 'test', setRoundId: roundId, pid: 101,
            judgeAt: accepted, setAcceptedAt: accepted, score: 100, status: STATUS.STATUS_ACCEPTED });
    }
    const now = time(vpStart, 30);
    const frame = await read(doc, mine, actor, 7 * minute, now);
    assert.equal(row(frame, 11).seconds, 5 * 60);
    assert.equal(row(frame, 12).seconds, 106 * 60);
    assert.equal(row(await read(doc, mine, actor, 4 * minute, now), 11).score, 0);
    doc.unlocked = false;
    assert.equal(row(await read(doc, mine, actor, 7 * minute, now), 11).score, 0);
});

it('keeps a VP submission inside its own window when the original global window was shorter', async () => {
    const doc = contest('ioi', true);
    doc.endAt = time(start, 60);
    const config = doc.setConfig!;
    doc.setConfig = parseSetConfig({ ...config, settings: { ...config.settings, personalLimit: { hours: 3, requireFullWindow: false } } });
    const mine = attempt(doc);
    mine.journal = [submission(vpStart, 80)];
    const frame = await read(doc, mine, actor, 90 * minute, time(vpStart, 95));
    assert.equal(row(frame, actor._id, 'self').score, 100);
    const moved = { ...doc, beginAt: time(doc.beginAt, 1), endAt: time(doc.endAt, 1) };
    const { ValidationError } = require('../src/error') as typeof import('../src/error');
    await assert.rejects(read(moved, mine, actor), (error: unknown) => error instanceof ValidationError && error.params[0] === 'snapshot');
});

it('gates the real handler by own VP, original publication and group permission', async () => {
    const doc = contest('acm', true);
    const mine = attempt(doc);
    mine.status = 'ended'; mine.endedAt = time(vpStart, 10);
    await db.collection('virtual.attempts').insertOne(mine);
    const h = Object.assign(Object.create(handler.prototype), {
        user: actor, domain: { _id: 'test' }, tdoc: doc, tsdoc: null, args: { domainId: 'test', tid: doc.docId.toHexString() },
        response: { addHeader() {} }, checkPerm() {}, checkPriv() {},
    });
    assert.equal(support(doc), true);
    assert.equal(support({ ...doc, participationMode: 'team' }), false);
    assert.equal(support(contest('strictioi')), false);
    assert.equal(support({ ...doc, setConfig: { ...doc.setConfig!, purpose: 'homework' } }), false);
    const config = doc.setConfig!;
    doc.setConfig = parseSetConfig({ ...config, settings: { ...config.settings,
        authorization: { defaults: { ...SET_DEFAULT_PERMISSIONS, scoreboard: false }, groups: [] } } });
    await assert.rejects(h.get(h.args), /scoreboard/i);
    doc.setConfig = parseSetConfig({ ...config, settings: { ...config.settings,
        authorization: { defaults: { ...SET_DEFAULT_PERMISSIONS, scoreboard: true, afterEnd: false }, groups: [] } } });
    await assert.rejects(h.get(h.args), /scoreboard/i);
    doc.setConfig = { ...config, publication: 'draft' };
    await assert.rejects(h.get(h.args), /scoreboard/i);
    doc.setConfig = config;
    h.user = { ...actor, hasPerm: () => false };
    await assert.rejects(h.get(h.args), /scoreboard/i);
    h.user = { ...actor, _id: 999 };
    await assert.rejects(h.get(h.args), /scoreboard/i);
    h.user = actor;
    await h.get(h.args);
    assert.equal(h.response.body.replay.rows[0].source, 'self');
});

it('uses the grading record of each saved answer version at the same cutoff as the official board', async () => {
    const doc = contest('ioi', true);
    await db.collection('document').insertOne({ ...doc });
    await officials(doc, [{ uid: 35 }]);
    const roundId = new ObjectId();
    const key = { domainId: doc.domainId, tid: doc.docId, participantKey: 'u:35' };
    await db.collection('contest.rounds').insertOne({ ...key, _id: roundId, roundNo: 1, state: 'closed', paperPids: [102],
        startedAt: start, closedAt: time(start, 60), passed: true, total: 100 });
    const prior = { pid: 102, rawScore: 60, version: 1, acceptedAt: time(start, 6), rid: new ObjectId().toHexString() };
    const latest = { pid: 102, rawScore: 20, version: 2, acceptedAt: time(start, 12), rid: new ObjectId().toHexString() };
    for (const answer of [prior, latest]) {
        await db.collection('contest.answerOperations').insertOne({ ...key, roundId, state: 'complete', acceptedAt: answer.acceptedAt, planned: { changed: [answer] } });
        await db.collection('record').insertOne({ _id: new ObjectId(answer.rid), domainId: doc.domainId, setRoundId: roundId, pid: 102,
            setAnswerVersion: answer.version, score: answer === prior ? 0 : 100,
            status: answer === prior ? STATUS.STATUS_WRONG_ANSWER : STATUS.STATUS_ACCEPTED, judgeAt: time(start, 30) });
    }
    await db.collection('contest.answers').insertOne({ ...key, roundId, ...latest });
    const { readParticipantScore } = require('../src/model/set-round') as typeof import('../src/model/set-round');
    for (const [minutes, expected] of [[9, 0], [15, 100]]) {
        const official = await readParticipantScore('test', doc.docId, 35, null, { cutoff: time(start, minutes) });
        assert.equal(official.score, expected);
        assert.equal(row(await read(doc, attempt(doc), actor, minutes * minute, time(vpStart, 25)), 35).score, official.score);
    }
});

it('replays an opening freeze for new and old snapshots, including submissions in the opening second', async () => {
    for (const configured of [false, true]) {
        const doc = contest('ioi', configured);
        doc.lockAt = doc.beginAt;
        const mine = attempt(doc);
        assert.equal(mine.snapshot.lockOffsetMs, 0);
        mine.snapshot.lockOffsetMs = null;
        mine.journal = [submission(vpStart, 0)];
        const prior = { ...attempt(doc, 19, time(vpStart, -200)), status: 'ended', endedAt: time(vpStart, -100) };
        prior.journal = [submission(prior.startAt, 0)];
        await db.collection('virtual.attempts').insertOne(prior);
        const frame = await read(doc, mine, actor, 10 * minute, time(vpStart, 20));
        assert.equal(frame.frozen, true);
        assert.deepEqual(frame.rows.map((entry) => entry.score), [0, 0]);
        mine.status = 'ended'; mine.endedAt = time(vpStart, 15);
        assert.equal(row(await read(doc, mine, actor, undefined, time(vpStart, 20)), 19, 'virtual').score, 100);
        doc.unlocked = false;
        assert.equal(row(await read(doc, mine, actor, undefined, time(vpStart, 20)), 19, 'virtual').score, 0);
        await db.collection('virtual.attempts').insertOne(mine);
        const { VirtualContestScoreboardHandler } = require('../src/handler/virtual-contest') as typeof import('../src/handler/virtual-contest');
        const board = Object.assign(Object.create(VirtualContestScoreboardHandler.prototype), { user: actor, tdoc: doc, domain: { _id: 'test' },
            args: { domainId: 'test', tid: doc.docId.toHexString() }, translate: (s: string) => s, response: { addHeader() {} }, checkPriv() {} });
        await board.get(board.args);
        assert.equal(board.response.body.rows.length, 3);
    }
});

it('detects truncated ACM penalties and IOI totals even when the archived winning record still exists', async () => {
    for (const rule of ['acm', 'ioi']) {
        const doc = contest(rule);
        const win = submission(start, 10);
        const totals = rule === 'acm' ? { accept: 1, time: 1800 } : { score: 200 };
        await officials(doc, [{ uid: 27, journal: [win], detail: { 101: { rid: win.rid, score: 100 } }, ...totals },
            { uid: 28, journal: [win], ...(rule === 'acm' ? { accept: 1, time: 600 } : { score: 100 }) }]);
        const mine = attempt(doc);
        const running = await read(doc, mine, actor, undefined, time(vpStart, 15));
        assert.equal(running.incomplete, 1);
        assert.equal(row(running, 27), undefined);
        assert.ok(row(running, 28));
        mine.status = 'ended'; mine.endedAt = time(vpStart, 16);
        const archived = row(await read(doc, mine, actor), 27);
        assert.equal(archived.score, rule === 'acm' ? 1 : 200);
        if (rule === 'acm') assert.equal(archived.seconds, 1800);
    }
});

it('loads only new or changed opponent journals and drops voided attempts on the next frame', async () => {
    const doc = contest('ioi');
    const mine = attempt(doc);
    const opponents = Array.from({ length: 100 }, (_, i) => {
        const entry = attempt(doc, 1000 + i, time(vpStart, -200));
        entry.journal = Array.from({ length: 60 }, (_item, m) => submission(entry.startAt, m));
        return entry;
    });
    await db.collection('virtual.attempts').insertMany(opponents);
    const sizes: number[] = [];
    const observe = (event: import('mongodb').CommandStartedEvent) => {
        if (event.command.find === 'virtual.attempts' && event.command.projection?.['journal.rid']) {
            sizes.push(event.command.filter._id.$in.length);
        }
    };
    client.on('commandStarted', observe);
    try {
        const frames = await Promise.all([5, 10, 15].map((m) => read(doc, mine, actor, m * minute, time(vpStart, 20))));
        assert.ok(frames.every((frame) => frame.rows.length === 101));
        assert.deepEqual(sizes, [100]);
        await db.collection('virtual.attempts').updateOne({ _id: opponents[0]._id },
            { $set: { journal: [submission(opponents[0].startAt, 1, 101, 23)] }, $inc: { rev: 1 } });
        await db.collection('virtual.attempts').updateOne({ _id: opponents[1]._id }, { $set: { status: 'voided' }, $inc: { rev: 1 } });
        const later = await read(doc, mine, actor, 5 * minute, time(vpStart, 20));
        assert.equal(row(later, opponents[0].uid, 'virtual').score, 23);
        assert.equal(row(later, opponents[1].uid, 'virtual'), undefined);
        assert.deepEqual(sizes, [100, 1]);
    } finally {
        client.off('commandStarted', observe);
    }
});

function serviceFor(doc: Tdoc, now: () => Date, problems: { docId: number; problemKind: string }[]) {
    const { VirtualContestService } = require('../src/model/virtual-contest') as typeof import('../src/model/virtual-contest');
    return new VirtualContestService({ attempts: db.collection<VirtualContestAttemptDoc>('virtual.attempts'), now,
        loadContest: async () => doc, loadProblems: async () => problems });
}

it('issues one comparable VP paper, authorizes only its questions and keeps the draw-pool maximum off the mixed board', async () => {
    const doc = contest('ioi', true);
    doc.pids = [501, 502, 503];
    doc.score = { 501: 60, 502: 60, 503: 60 };
    const config = doc.setConfig!;
    doc.setConfig = parseSetConfig({ ...config, settings: { ...config.settings,
        draw: { ...config.settings.draw, enabled: true, quotas: { programming: 1 } } } });
    const problems = doc.pids.map((pid) => ({ docId: pid, problemKind: 'programming' }));
    await db.collection('document').insertMany(problems.map((p) => ({ ...p, domainId: 'test', docType: 10, config: {} })));
    let now = vpStart;
    const service = serviceFor(doc, () => now, problems);
    const mine = await service.start({ domainId: 'test', sourceContestId: doc.docId, uid: actor._id });
    assert.equal(mine.snapshot.pids.length, 1);
    const [pid] = mine.snapshot.pids;
    const other = doc.pids.find((candidate) => candidate !== pid)!;
    assert.deepEqual(Object.keys(mine.snapshot.score), [String(pid)]);
    const identity = { domainId: 'test', attemptId: mine._id, uid: actor._id };
    assert.deepEqual((await service.assertActiveForUser('test', mine._id, actor._id, pid)).snapshot.pids, [pid]);
    const { ValidationError } = require('../src/error') as typeof import('../src/error');
    const fieldError = (field: string) => (error: unknown) => error instanceof ValidationError && error.params[0] === field;
    await assert.rejects(service.assertActiveForUser('test', mine._id, actor._id, other), fieldError('pid'));
    await assert.rejects(service.updateStatus({ ...identity, pid: other, rid: rid(time(vpStart, 3)),
        result: { score: 100, status: STATUS.STATUS_ACCEPTED } }), fieldError('pid'));
    const prior = attempt(doc, 77, time(vpStart, -200));
    prior.snapshot = { ...mine.snapshot, pids: [other], score: { [other]: 60 }, judgedPids: [other] };
    prior.journal = [submission(prior.startAt, 4, other)];
    const legacy = attempt(doc, 78, prior.startAt);
    delete legacy.snapshot.drawSignature;
    delete legacy.snapshot.setLate;
    await db.collection('virtual.attempts').insertMany([prior, legacy]);
    await assert.rejects(read(doc, legacy, actor), fieldError('snapshot'));
    await officials(doc, [{ uid: actor._id }]);
    await db.collection('contest.rounds').insertOne({ domainId: 'test', tid: doc.docId, participantKey: 'u:8', roundNo: 1,
        startedAt: start, closedAt: time(start, 20), state: 'closed', paperPids: [other], total: 60,
        legacy: { scoreLocked: true }, detail: { [other]: { pid: other, score: 60 } } });
    now = time(vpStart, 20);
    await service.updateStatus({ ...identity, pid, rid: rid(time(vpStart, 5)), result: { score: 100, status: STATUS.STATUS_ACCEPTED } });
    const ended = await service.end({ ...identity, actor });
    const result = await read(doc, ended, actor, undefined, now);
    assert.deepEqual(result.pids, [pid]);
    assert.equal(ended.score, 60);
    assert.deepEqual(row(result, 8, 'self').cells, [60]);
    assert.deepEqual(row(result, 77, 'virtual').cells, [null]);
    assert.ok(result.rows.every((entry) => entry.score === 60));
    assert.equal(row(result, 78, 'virtual'), undefined);
});

it('settles and replays partial judge points on the issued paper scale after a withdrawal', async () => {
    const doc = contest('ioi', true);
    doc.pids = [1101, 1102];
    doc.setPoints = { 1101: { rawMax: 10, points: 20.5 }, 1102: { rawMax: 100, points: 15, excluded: true } };
    const problems = doc.pids.map((docId) => ({ docId, problemKind: docId === 1101 ? 'programming' : 'subjective' }));
    await db.collection('document').insertMany(problems.map((problem) => ({ ...problem, domainId: 'test', docType: 10, config: {} })));
    let now = vpStart;
    const service = serviceFor(doc, () => now, problems);
    const mine = await service.start({ domainId: 'test', sourceContestId: doc.docId, uid: actor._id });
    assert.deepEqual(mine.snapshot.pids, [1101]);
    const identity = { domainId: 'test', attemptId: mine._id, uid: actor._id };
    now = time(vpStart, 8);
    await service.updateStatus({ ...identity, pid: 1101, rid: rid(time(vpStart, 5)), result: { score: 5, status: STATUS.STATUS_WRONG_ANSWER } });
    const ended = await service.end({ ...identity, actor });
    const result = await read(doc, ended, actor, undefined, now);
    const own = row(result, actor._id, 'self');
    assert.equal(ended.score, 10.25);
    assert.equal(own.score, 10.25);
    assert.equal(own.maxPoints, 20.5);
    assert.deepEqual(own.cells, [10.25]);
    const old = attempt({ ...doc, setPoints: undefined }, 42, time(vpStart, -200));
    await db.collection('virtual.attempts').insertOne({ ...old, status: 'ended', endedAt: time(old.startAt, 90) });
    const { VirtualContestScoreboardHandler } = require('../src/handler/virtual-contest') as typeof import('../src/handler/virtual-contest');
    const board = Object.assign(Object.create(VirtualContestScoreboardHandler.prototype), { user: actor, tdoc: doc, domain: { _id: 'test' },
        args: { domainId: 'test', tid: doc.docId.toHexString() }, translate: (s: string) => s, response: { addHeader() {} }, checkPriv() {} });
    await board.get(board.args);
    assert.equal(board.response.body.rows.length, 2);
    assert.deepEqual(board.response.body.rows[1].find((cell) => cell.type === 'total_score'),
        { type: 'total_score', value: '10.25/20.5', score: 10.25, scorePercentage: 50 });
});

it('settles and replays the same weighted, late and revised answers, preserving the original policy of earlier VPs', async () => {
    const doc = contest('ioi', true);
    doc.score = { 101: 80, 102: 20 };
    const config = doc.setConfig!;
    doc.setConfig = parseSetConfig({ ...config, settings: { ...config.settings,
        late: { enabled: true, onTimeAt: time(start, 10), rules: { 0: 0.5 } } } });
    await db.collection('document').insertOne({ ...doc });
    let now = vpStart;
    const service = serviceFor(doc, () => now, [{ docId: 101, problemKind: 'programming' }, { docId: 102, problemKind: 'single' }]);
    const mine = await service.start({ domainId: 'test', sourceContestId: doc.docId, uid: actor._id });
    const identity = { domainId: 'test', attemptId: mine._id, uid: actor._id };
    const journal = [submission(vpStart, 11), submission(vpStart, 13, 102), submission(vpStart, 14, 102, 0, STATUS.STATUS_WRONG_ANSWER)];
    now = time(vpStart, 20);
    for (const { rid: id, pid, score, status } of [...journal].reverse()) {
        await service.updateStatus({ ...identity, pid, rid: id, result: { score, status } });
    }
    const ended = await service.end({ ...identity, actor });
    const legacy = attempt(doc, 91, time(vpStart, -200));
    delete legacy.snapshot.setLate;
    legacy.journal = journal.map((s) => ({ ...s, rid: rid(new Date(+legacy.startAt + (+s.rid.getTimestamp() - +vpStart))) }));
    await db.collection('virtual.attempts').insertOne({ ...legacy, status: 'ended', endedAt: legacy.endAt, score: 100 });
    assert.equal(ended.score, 40);
    assert.equal(row(await read(doc, ended, actor, 13 * minute, now), 8, 'self').score, 50);
    const final = await read(doc, ended, actor, undefined, now);
    assert.equal(row(final, 8, 'self').score, ended.score);
    assert.equal(row(final, 91, 'virtual').score, 100);
    const handlers = require('../src/handler/virtual-contest') as typeof import('../src/handler/virtual-contest');
    const base = { user: actor, domain: { _id: 'test' }, tdoc: doc, tsdoc: null, args: { domainId: 'test', tid: doc.docId.toHexString() },
        translate: (s: string) => s, url: () => '/replay', checkPerm() {}, checkPriv() {} };
    const workbench = Object.assign(Object.create(handlers.VirtualContestHandler.prototype), base, { response: { addHeader() {} } });
    await workbench.get(base.args);
    assert.equal(workbench.response.body.attempt.score, ended.score);
    assert.equal(workbench.response.body.replayUrl, '/replay');
    workbench.user = { ...actor, hasPerm: () => false };
    await workbench.get(base.args);
    assert.equal(workbench.response.body.replayUrl, null);
    const board = Object.assign(Object.create(handlers.VirtualContestScoreboardHandler.prototype), base, { response: { addHeader() {} } });
    await board.get(base.args);
    const totals = board.response.body.rows.slice(1).map((cells: { type: string; value: unknown }[]) =>
        cells.find((cell) => cell.type === 'total_score')?.value);
    assert.deepEqual(totals, [100, ended.score]);
});

it('uses the same ACM solve count and penalty on settlement and replay, including a reopened judging result', async () => {
    const doc = contest('acm', true);
    doc.pids = [101];
    let elapsed = 0;
    const now = () => time(vpStart, elapsed);
    const service = serviceFor(doc, now, [{ docId: 101, problemKind: 'programming' }]);
    const mine = await service.start({ domainId: 'test', sourceContestId: doc.docId, uid: actor._id });
    const identity = { domainId: 'test', attemptId: mine._id, uid: actor._id, pid: 101 };
    elapsed = 10;
    for (const [m, status] of [[2, STATUS.STATUS_WRONG_ANSWER], [8, STATUS.STATUS_ACCEPTED]]) {
        await service.updateStatus({ ...identity, rid: rid(time(vpStart, m)), result: { score: status === STATUS.STATUS_ACCEPTED ? 100 : 0, status } });
    }
    const ended = await service.end({ ...identity, actor });
    const final = row(await read(doc, ended, actor, undefined, now()), 8, 'self');
    assert.deepEqual([ended.accept, ended.time, final.score, final.seconds], [1, 1680, 1, 1680]);
    elapsed = 12;
    const revised = await service.updateStatus({ ...identity, rid: rid(time(vpStart, 2)), result: { score: 100, status: STATUS.STATUS_ACCEPTED } });
    const rejudged = row(await read(doc, revised, actor, undefined, now()), 8, 'self');
    assert.deepEqual([revised.time, rejudged.seconds], [120, 120]);
    const { ValidationError } = require('../src/error') as typeof import('../src/error');
    await assert.rejects(service.updateStatus({ ...identity, rid: rid(now()), result: { score: 100, status: STATUS.STATUS_ACCEPTED } }),
        (error: unknown) => error instanceof ValidationError && error.params[0] === 'attempt');
});
