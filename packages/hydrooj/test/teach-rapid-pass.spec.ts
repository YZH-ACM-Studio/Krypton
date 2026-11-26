import { after, before, describe, it } from 'node:test';
import { deepEqual, equal, ok, throws } from 'node:assert/strict';
import { DEFAULT_RAPID_PASS_RULE as rule, parseRapidPassRule, STATUS } from '@hydrooj/common';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Tdoc } from '../src/interface';
import { analyzeRound, loadLegacyRapidPassEvidence, loadRapidPassEvidence, loadRapidPassPolicy, writeRapidPassPolicy } from '../src/lib/teach-rapid-pass';

const clock = (seconds: number) => new Date(Date.UTC(2024, 0, 1) + seconds * 1000);
const round = { roundNo: 1, startedAt: clock(0), closedAt: clock(4000), paperPids: [1, 2, 3, 4] };
const pass = (pid: number, seconds: number, individual = false) => ({ pid, at: clock(seconds), individual });
const all = { roundNo: 1, seconds: 480, passed: 4, total: 4, fromStart: true };

describe('teacher rapid pass analysis', () => {
    it('includes the exact configured boundary and deduplicates problems on the drawn paper', () => {
        deepEqual(analyzeRound(round, [pass(1, 480), pass(1, 1), pass(2, 300), pass(3, 400), pass(4, 480), pass(5, 10)], rule), all);
        equal(analyzeRound(round, [pass(1, -1), pass(2, 80), pass(3, 170), pass(4, 4001)], rule), undefined);
        equal(analyzeRound(round, [pass(1, 481), pass(2, 300), pass(3, 400), pass(4, 480)], rule), undefined);
        equal(analyzeRound(round, [pass(1, 1), pass(2, 2), pass(3, 3), pass(4, 4)], { ...rule, minProblems: 5 }), undefined);
    });

    it('checks later bursts only for individually submitted code, using the first pass per question', () => {
        const late = [1, 2, 3, 4].map((pid) => pass(pid, 1800 + 20 * pid, true));
        deepEqual(analyzeRound(round, late, rule), { ...all, seconds: 60, fromStart: false });
        equal(analyzeRound(round, late.map((p) => ({ ...p, individual: false })), rule), undefined);
        equal(analyzeRound(round, [pass(2, 100, true), ...late], rule), undefined);
        equal(analyzeRound(round, late, { ...rule, enabled: false }), undefined);
        equal(analyzeRound({ ...round, personalStart: false }, [1, 2, 3, 4].map((pid) => pass(pid, 7)), rule), undefined);
        for (const patch of [{ minutes: 0 }, { minutes: 181 }, { minProblems: 1 }, { minProblems: 2.5 }, { enabled: 'yes' }]) {
            throws(() => parseRapidPassRule({ ...rule, ...patch }));
        }
    });
});

describe('rapid pass queries on isolated MongoDB', () => {
    let server: MongoMemoryServer;
    let client: MongoClient;
    let db: Db;
    const tid = new ObjectId();
    before(async () => {
        server = await MongoMemoryServer.create();
        client = await MongoClient.connect(server.getUri());
        db = client.db('rapid_pass_test');
    });
    after(async () => {
        await client?.close();
        await server?.stop();
    });

    it('reads defaults without a write, rejects stale settings and isolates domains', async () => {
        deepEqual(await loadRapidPassPolicy(db, 'd', tid), { rule, revision: 0 });
        equal(await db.collection('contest.rapidPassPolicies').countDocuments(), 0);
        const changed = { ...rule, minProblems: 3, minutes: 7 };
        equal(await writeRapidPassPolicy(db, 'd', tid, changed, 0), true);
        equal(await writeRapidPassPolicy(db, 'd', tid, rule, 0), false);
        equal(await writeRapidPassPolicy(db, 'd', tid, rule, 2), false);
        deepEqual(await loadRapidPassPolicy(db, 'd', tid), { rule: changed, revision: 1 });
        deepEqual(await loadRapidPassPolicy(db, 'other', tid), { rule, revision: 0 });
        equal(await writeRapidPassPolicy(db, 'd', tid, rule, 1), true);
    });

    it('uses formal server receipt times and isolates rounds, teams, exams and unfinished judging', async () => {
        const addRound = async (key: string, no: number, extra = {}) => (await db.collection('contest.rounds').insertOne({
            domainId: 'd', tid, participantKey: key, ...round, roundNo: no, ...extra,
        })).insertedId;
        const addAnswers = (id: ObjectId, pids: number[]) => db.collection('contest.answers').insertMany(pids.map((pid) =>
            ({ domainId: 'd', roundId: id, pid, acceptedAt: clock(50), status: STATUS.STATUS_ACCEPTED })));
        const target = await addRound('u:7', 2);
        await addAnswers(target, [1, 2, 3]);
        const record = { domainId: 'd', contest: tid, setRoundId: target, uid: 7, pid: 4,
            status: STATUS.STATUS_ACCEPTED, setAcceptedAt: clock(480), judgeAt: clock(2700) };
        const variants = [
            { judgeAt: null }, { status: STATUS.STATUS_WRONG_ANSWER }, { pid: 8 }, { contest: new ObjectId() },
            { domainId: 'other' }, { setAnswerVersion: 2 }, { setAcceptedAt: clock(4001) },
        ];
        await db.collection('record').insertMany(variants.map((extra) => ({ ...record, ...extra })));
        await addAnswers(await addRound('u:7', 1), [4]);
        await addAnswers(await addRound('u:8', 1, { legacy: { incompleteHistory: true, scoreLocked: true } }), [1, 2, 3, 4]);
        await addAnswers(await addRound('t:example', 1), [1, 2, 3, 4]);
        deepEqual(await loadRapidPassEvidence(db, 'd', tid, rule), {});
        const result = await db.collection('record').insertOne({ ...record });
        deepEqual(await loadRapidPassEvidence(db, 'd', tid, rule), { 7: { ...all, roundNo: 2 } });
        await db.collection('record').updateOne({ _id: result.insertedId }, { $set: { status: STATUS.STATUS_WRONG_ANSWER } });
        deepEqual(await loadRapidPassEvidence(db, 'd', tid, rule), {});
        const endSave = await addRound('u:9', 1);
        await db.collection('record').insertMany([1, 2, 3, 4].map((pid) => ({
            ...record, setRoundId: endSave, uid: 9, pid, setAutoSaveId: 'end', setAcceptedAt: clock(3000),
        })));
        deepEqual(await loadRapidPassEvidence(db, 'd', tid, rule), {});
    });

    it('uses the retained legacy attempt and never treats a common homework opening time as personal', async () => {
        const old = new ObjectId();
        const doc = { docId: old, rule: 'exam', pids: [1, 2, 3, 4], beginAt: clock(0), endAt: clock(5000) } as Tdoc;
        await db.collection('document.status').insertOne({ domainId: 'd', docType: 30, docId: old, uid: 17, attend: 1,
            startAt: clock(60), examAttemptsUsed: 1, examJournalAfter: ObjectId.createFromTime(clock(59).getTime() / 1000) });
        const recordIds = [40, 70, 80, 90, 100].map((t) => ObjectId.createFromTime(clock(t).getTime() / 1000));
        await db.collection('record').insertMany(recordIds.map((_id, i) => ({
            _id, uid: 17, domainId: 'd', contest: old, pid: i || 4, lang: '_', status: STATUS.STATUS_ACCEPTED, judgeAt: clock(1000),
        })));
        deepEqual(await loadLegacyRapidPassEvidence(db, 'd', doc, 30, rule), { 17: { ...all, roundNo: 2, seconds: 40 } });
        deepEqual(await loadLegacyRapidPassEvidence(db, 'd', { ...doc, rule: 'homework' }, 30, rule), {});
        ok(await db.collection('record').findOne({ _id: recordIds[0] }));
    });
});
