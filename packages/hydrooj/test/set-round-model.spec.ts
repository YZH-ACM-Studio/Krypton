import assert from 'node:assert/strict';
import { after, beforeEach, it } from 'node:test';
import { ObjectId, type Document } from 'mongodb';
import { createDraftConfig, STATUS } from '@hydrooj/common';
import type { RoundDoc } from '../src/model/set-round';

function clone<T>(value: T): T {
    if (value instanceof Date) return new Date(value) as T;
    if (value instanceof ObjectId) return new ObjectId(value) as T;
    if (Array.isArray(value)) return value.map(clone) as T;
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
    return value;
}

function same(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
    if (left instanceof Date && right instanceof Date) return +left === +right;
    return left === right;
}

function matches(doc: Document, filter: Document): boolean {
    return Object.entries(filter).every(([key, expected]) => {
        if (expected && typeof expected === 'object' && !(expected instanceof ObjectId) && !(expected instanceof Date)) {
            return Object.entries(expected).every(([operator, value]) => {
                if (operator === '$lte') return +doc[key] <= +(value as Date);
                if (operator === '$in') return (value as unknown[]).some((item) => same(item, doc[key]));
                throw new Error(`unexpected filter ${operator}`);
            });
        }
        return same(doc[key], expected);
    });
}

class Collection {
    docs: Document[] = [];
    reads: Document[] = [];
    oneReads: { filter: Document; options?: { projection: Document } }[] = [];
    beforeInsert?: (doc: Document) => void;
    beforeFindOne?: () => void;

    find(filter: Document) {
        this.reads.push(filter);
        let sort: Document = {};
        const cursor = {
            sort(value: Document) { sort = value; return cursor; },
            toArray: async () => this.docs.filter((doc) => matches(doc, filter)).map(clone).sort((left, right) => {
                for (const [key, direction] of Object.entries(sort)) {
                    const delta = (+left[key] - +right[key]) * direction;
                    if (delta) return delta;
                }
                return 0;
            }),
        };
        return cursor;
    }

    async findOne(filter: Document, options?: { projection: Document }) {
        this.beforeFindOne?.();
        this.oneReads.push({ filter, options });
        const doc = this.docs.find((item) => matches(item, filter));
        if (!doc) return null;
        if (!options?.projection) return clone(doc);
        return clone(Object.fromEntries(Object.entries(options.projection).filter(([, include]) => include)
            .map(([key]) => [key, doc[key]])));
    }

    async insertOne(doc: Document) {
        this.beforeInsert?.(doc);
        this.docs.push(clone(doc));
        return { insertedId: doc._id ?? new ObjectId() };
    }

    async updateOne(filter: Document, update: Document) {
        const doc = this.docs.find((item) => matches(item, filter));
        if (!doc) return { matchedCount: 0 };
        Object.assign(doc, clone(update.$set));
        for (const key of Object.keys(update.$unset ?? {})) delete doc[key];
        return { matchedCount: 1 };
    }
}

const collections = new Map<string, Collection>();
const coll = (name: string) => {
    if (!collections.has(name)) collections.set(name, new Collection());
    return collections.get(name)!;
};
const domainId = 'test-only-set-round';
const tid = new ObjectId();
const baseTime = new Date();
let config = createDraftConfig('homework');
let contestDoc: Document;
const problems = new Map<number, Document>();
const problemReads: number[] = [];
let failManual = false;
let failStatus = false;
let claimOverride: Document | undefined;
const manualIds: string[] = [];
const persisted: Document[] = [];
const claimed: number[] = [];

const original = new Map<string, NodeModule | undefined>();
function stub(path: string, exports: unknown) {
    const id = require.resolve(path);
    original.set(id, require.cache[id]);
    require.cache[id] = { id, filename: id, loaded: true, exports } as NodeModule;
}
stub('../src/service/db.ts', { __esModule: true, default: { collection: coll } });
stub('../src/model/contest.ts', { persistSetParticipantStatus: async (_domain: string, _tid: ObjectId, _uid: number,
    _teamId: ObjectId | null | undefined, projection: Document) => {
    if (failStatus) {
        failStatus = false;
        throw new Error('status interrupted');
    }
    persisted.push(clone(projection));
},
get: async (domain: string, contestId: ObjectId) => {
    assert.equal(domain, domainId);
    assert.ok(contestId.equals(tid));
    return clone(contestDoc);
} });
stub('../src/model/contest-participation.ts', { isTeamBatchFinalizationPending: () => false });
stub('../src/model/problem.ts', { __esModule: true, default: {
    claimStructureLockForSubmission: async (domain: string, pid: number, locking: boolean, actor: number) => {
        assert.equal(domain, domainId);
        assert.equal(locking, true);
        assert.equal(actor, 1);
        claimed.push(pid);
        return clone(claimOverride ?? problems.get(pid));
    },
    getList: async (domain: string, pids: number[]) => {
        assert.equal(domain, domainId);
        problemReads.push(...pids);
        return Object.fromEntries(pids.map((pid) => {
            const problem = problems.get(pid)!;
            return [pid, { ...clone(problem), docId: pid, config: { ...problem.config, maxScore: problem.config.answers?.main?.[1] ?? 100 } }];
        }));
    },
    get: async (domain: string, pid: number) => {
        assert.equal(domain, domainId);
        problemReads.push(pid);
        return clone(problems.get(pid));
    },
} });
stub('../src/model/record.ts', { __esModule: true, default: {
    coll: coll('record'),
    ensureManualSetAnswerRecord: async (input: { rid: ObjectId; pid: number; roundId: ObjectId; answerVersion: number; acceptedAt: Date }) => {
        manualIds.push(input.rid.toHexString());
        if (failManual) {
            failManual = false;
            throw new Error('manual record interrupted');
        }
        if (!coll('record').docs.some((doc) => same(doc._id, input.rid))) {
            coll('record').docs.push({ _id: input.rid, domainId, pid: input.pid, setRoundId: input.roundId,
                setAnswerVersion: input.answerVersion, setAcceptedAt: input.acceptedAt,
                status: STATUS.STATUS_WAITING, judgeAt: input.acceptedAt, score: 0 });
        }
    },
} });
const model = require('../src/model/set-round.ts') as typeof import('../src/model/set-round');
after(() => {
    for (const [id, previous] of original) {
        if (previous) require.cache[id] = previous;
        else delete require.cache[id];
    }
});

beforeEach(() => {
    for (const collection of collections.values()) {
        collection.docs = [];
        collection.reads = [];
        collection.oneReads = [];
        collection.beforeInsert = undefined;
        collection.beforeFindOne = undefined;
    }
    config = createDraftConfig('homework');
    config.publication = 'published';
    config.settings.retake.extra = 3;
    config.settings.earlyHandIn = true;
    contestDoc = { domainId, docId: tid, beginAt: new Date(+baseTime - 10_000), endAt: new Date(+baseTime + 3_600_000),
        pids: [1, 2, 3], setConfig: config, score: { 1: 100, 2: 100, 3: 100 } };
    problems.clear();
    problemReads.length = 0;
    problems.set(1, { problemKind: 'single', config: { type: 'objective', answers: { main: ['A', 100, { kind: 'single' }] } } });
    problems.set(2, { problemKind: 'programming', config: {} });
    problems.set(3, { problemKind: 'single', config: { type: 'objective', answers: { main: ['B', 50, { kind: 'single' }] } } });
    manualIds.length = 0;
    persisted.length = 0;
    failManual = false;
    failStatus = false;
    claimOverride = undefined;
    claimed.length = 0;
});

function round(roundNo = 1, state: 'open' | 'closed' = 'open', pids = [1, 2, 3]): RoundDoc {
    const doc: RoundDoc = { _id: new ObjectId(), domainId, tid, participantKey: 'u:1', roundNo, state,
        startedAt: new Date(+baseTime - 1000), closedAt: state === 'closed' ? baseTime : null,
        paperPids: pids, total: 0, passed: false, detail: {}, scoreRevision: config.revision,
        ...(state === 'open' ? { openSlot: 'u:1' } : {}) };
    coll('contest.rounds').docs.push(doc);
    return doc;
}

function answer(target: RoundDoc, pid: number, rawScore: number, acceptedAt = baseTime) {
    const doc = { domainId, roundId: target._id, pid, rawScore, acceptedAt, body: { main: 'A' }, version: 1, operationId: 'initial' };
    coll('contest.answers').docs.push(doc);
    return doc;
}

function save(target: RoundDoc, operationId = 'op', now = baseTime) {
    return { domainId, tid, round: target, roundId: target._id, kind: 'single' as const,
        uid: 1, settings: config.settings, operationId, now, finalEnd: contestDoc.endAt,
        items: [{ pid: 1, body: { main: 'A' }, baseVersion: 0 }] };
}

it('scores every candidate before selecting the highest whole round and keeps another participant out', async () => {
    const first = round(1, 'closed');
    const second = round(2, 'closed');
    answer(first, 1, 60);
    answer(second, 1, 100);
    const other = round(1, 'closed');
    other.participantKey = 'u:2';
    answer(other, 1, 200);
    const result = await model.projectParticipantStatus(domainId, tid, 1);
    assert.equal(result.score, 100);
    assert.ok(result.setRoundId.equals(second._id));
    assert.equal(result.detail[1].score, 100);
    assert.equal(first.total, 60);
    assert.equal(other.total, 0);
});

it('recomputes an older round on late judging before choosing a different existing round', async () => {
    const first = round(1, 'closed', [2]);
    first.total = 100;
    const second = round(2, 'closed', [1]);
    second.total = 70;
    second.detail = { 1: { pid: 1, score: 70, status: STATUS.STATUS_WRONG_ANSWER, acceptedAt: baseTime } };
    coll('record').docs.push({ _id: new ObjectId(), domainId, setRoundId: first._id, pid: 2, score: 0,
        status: STATUS.STATUS_WRONG_ANSWER, judgeAt: baseTime, setAcceptedAt: baseTime });
    const result = await model.projectParticipantStatus(domainId, tid, 1, undefined, first._id);
    assert.equal(result.score, 70);
    assert.ok(result.setRoundId.equals(second._id));
    assert.equal(first.total, 0);
    assert.equal(coll('record').reads.length, 1);
    assert.ok(coll('record').reads[0].setRoundId.equals(first._id));
});

it('settles a personal deadline and rejects a stale save or code binding', async () => {
    const opened = round();
    config.settings.personalLimit.hours = 1;
    opened.startedAt = new Date(+baseTime - 3_600_000);
    const existing = await model.settleParticipantRounds(domainId, tid, 1, undefined, baseTime);
    assert.equal(existing[0].state, 'closed');
    assert.equal(+existing[0].closedAt, +baseTime);
    assert.equal(opened.openSlot, undefined);
    assert.ok(persisted.at(-1)?.setRoundId.equals(opened._id));
    assert.equal(+persisted.at(-1)?.setRoundClosedAt, +baseTime);
    await assert.rejects(model.saveOfficialKind(save(opened)));
    await assert.rejects(model.bindCodeSubmitToRound(domainId, tid, 1, 2, undefined, baseTime));
});

it('settle resumes an interrupted accepted operation and synchronizes answer, round and selected status', async () => {
    const opened = round();
    const request = save(opened);
    request.items.push({ pid: 3, body: { main: 'B' }, baseVersion: 0 });
    coll('contest.answers').beforeInsert = (doc) => {
        if (doc.pid !== 3) return;
        coll('contest.answers').beforeInsert = undefined;
        throw new Error('save interrupted');
    };
    await assert.rejects(model.saveOfficialKind(request), /save interrupted/);
    const existing = await model.settleParticipantRounds(domainId, tid, 1);
    assert.equal((await model.getOfficialAnswers(domainId, opened)).length, 2);
    assert.equal(existing[0].total, 150);
    assert.equal(existing[0].scoreDirty, false);
    assert.equal(persisted.at(-1)?.score, 150);
    assert.equal(persisted.at(-1)?.detail[3].score, 50);
    coll('record').reads = [];
    assert.equal((await model.readSettledParticipantStatus(domainId, tid, 1)).score, 150);
    assert.equal(coll('record').reads.length, 0);
});

it('repairs an accepted Record and later judge result whose status projection was interrupted', async () => {
    const opened = round(1, 'open', [2]);
    await model.markRoundScoreDirty(domainId, tid, opened._id);
    const accepted = { _id: new ObjectId(), domainId, setRoundId: opened._id, pid: 2, score: 0,
        status: STATUS.STATUS_WAITING, judgeAt: null, setAcceptedAt: baseTime };
    coll('record').docs.push(accepted);
    assert.equal((await model.readSettledParticipantStatus(domainId, tid, 1)).setJudgePending, true);
    await model.markRoundScoreDirty(domainId, tid, opened._id);
    Object.assign(accepted, { status: STATUS.STATUS_ACCEPTED, score: 100, judgeAt: baseTime });
    const judged = await model.readSettledParticipantStatus(domainId, tid, 1);
    assert.equal(judged.score, 100);
    assert.equal(judged.setJudgePending, false);
    assert.equal(persisted.at(-1)?.score, 100);
    assert.equal(persisted.at(-1)?.detail[2].score, 100);
});

it('repairs a completed manual Record when the answer projection was interrupted', async () => {
    problems.set(1, subjectiveProblem());
    const opened = round(1, 'open', [1]);
    await model.saveOfficialKind({ ...save(opened), kind: 'subjective' });
    await model.readSettledParticipantStatus(domainId, tid, 1);
    await model.markRoundScoreDirty(domainId, tid, opened._id);
    Object.assign(coll('record').docs[0], { score: 80, status: STATUS.STATUS_WRONG_ANSWER, judgeAt: baseTime });
    const state = await model.readSettledParticipantStatus(domainId, tid, 1);
    assert.equal((await model.getOfficialAnswers(domainId, opened))[0].rawScore, 80);
    assert.equal(state.score, 80);
    assert.equal(state.setJudgePending, false);
    assert.equal(persisted.at(-1)?.score, 80);
});

it('retries a failed participant-status projection without rescanning judging facts', async () => {
    const opened = round();
    await model.saveOfficialKind(save(opened));
    failStatus = true;
    await assert.rejects(model.settleParticipantRounds(domainId, tid, 1), /status interrupted/);
    assert.equal(opened.total, 100);
    assert.equal(opened.scoreDirty, false);
    assert.equal(opened.statusDirty, true);
    coll('record').reads = [];
    await model.settleParticipantRounds(domainId, tid, 1);
    assert.equal(persisted.at(-1)?.score, 100);
    assert.equal(opened.statusDirty, false);
    assert.equal(coll('record').reads.length, 0);
});

it('claims the canonical problem structure before grading and never regrades an accepted replay', async () => {
    const opened = round();
    claimOverride = { problemKind: 'single', config: { type: 'objective', answers: { main: ['B', 100, { kind: 'single' }] } } };
    await model.saveOfficialKind(save(opened));
    assert.deepEqual(claimed, [1]);
    assert.equal((await model.getOfficialAnswers(domainId, opened))[0].rawScore, 0);
    assert.deepEqual((await model.getOfficialAnswers(domainId, opened))[0].judgeResult, { main: 'wrong' });
    problems.clear();
    await model.saveOfficialKind(save(opened));
    assert.deepEqual(claimed, [1]);
});

it('confirms pending and complete acceptance without completing the operation or reading its answers', async () => {
    const opened = round();
    const request = save(opened);
    assert.equal(await model.wasOfficialSaveAccepted(request), false);
    coll('contest.answers').beforeInsert = () => {
        coll('contest.answers').beforeInsert = undefined;
        throw new Error('answer interrupted');
    };
    await assert.rejects(model.saveOfficialKind(request), /answer interrupted/);
    coll('contest.answers').oneReads = [];
    const before = clone(coll('contest.answerOperations').docs);
    assert.equal(await model.wasOfficialSaveAccepted(request), true);
    assert.deepEqual(coll('contest.answerOperations').docs, before);
    assert.equal(coll('contest.answers').docs.length, 0);
    assert.equal(coll('contest.answers').oneReads.length, 0);
    assert.deepEqual(coll('contest.answerOperations').oneReads.at(-1)?.options, { projection: { _id: 0, state: 1 } });
    await model.saveOfficialKind(request);
    assert.equal(coll('contest.answerOperations').docs[0].state, 'complete');
    assert.equal(await model.wasOfficialSaveAccepted(request), true);
});

it('does not claim acceptance for another scope, kind, body or base version using the same operation ID', async () => {
    const request = save(round());
    await model.saveOfficialKind(request);
    const variants: Partial<Parameters<typeof model.wasOfficialSaveAccepted>[0]>[] = [
        { domainId: 'other' }, { tid: new ObjectId() }, { roundId: new ObjectId() }, { uid: 2 },
        { contestTeamId: new ObjectId() }, { kind: 'multi' }, { operationId: 'other' },
        { items: [{ ...request.items[0], body: { main: 'B' } }] },
        { items: [{ ...request.items[0], baseVersion: 1 }] },
    ];
    for (const variant of variants) assert.equal(await model.wasOfficialSaveAccepted({ ...request, ...variant }), false);
    assert.equal(await model.wasOfficialSaveAccepted(request), true);
});

it('propagates failed acceptance lookups and malformed accepted state instead of declaring rejection', async () => {
    const request = save(round());
    await model.saveOfficialKind(request);
    coll('contest.answerOperations').beforeFindOne = () => { throw new Error('operation lookup unavailable'); };
    await assert.rejects(model.wasOfficialSaveAccepted(request), /operation lookup unavailable/);
    coll('contest.answerOperations').beforeFindOne = undefined;
    coll('contest.answerOperations').docs[0].state = 'broken';
    await assert.rejects(model.wasOfficialSaveAccepted(request), /set_answer_operation_invalid/);
});

it('rejects stale pre-validation timestamps when the final acceptance boundary has passed', async () => {
    const opened = round();
    contestDoc.endAt = new Date(+baseTime - 10);
    const request = save(opened, 'stale-time', new Date(+baseTime - 100));
    await assert.rejects(model.saveOfficialKind(request));
    assert.deepEqual(claimed, [1]);
    assert.equal(coll('contest.answerOperations').docs.length, 0);
    await assert.rejects(model.bindCodeSubmitToRound(domainId, tid, 1, 2, undefined, new Date(+baseTime - 100)));
});

it('retries a partially accepted multi-answer operation after the deadline with one version per answer', async () => {
    const opened = round();
    const request = save(opened);
    request.items.push({ pid: 3, body: { main: 'B' }, baseVersion: 0 });
    coll('contest.answers').beforeInsert = (doc) => {
        if (doc.pid === 3) {
            coll('contest.answers').beforeInsert = undefined;
            throw new Error('second answer interrupted');
        }
    };
    await assert.rejects(model.saveOfficialKind(request), /second answer interrupted/);
    assert.equal(coll('contest.answers').docs.length, 1);
    const result = await model.saveOfficialKind({ ...request, now: new Date(+contestDoc.endAt + 1000) });
    assert.deepEqual(result.versions, { 1: 1, 3: 1 });
    assert.deepEqual(coll('contest.answers').docs.map((doc) => doc.version), [1, 1]);
    assert.equal(coll('contest.answerOperations').docs[0].state, 'complete');
    await model.handInRound(opened, config.settings, baseTime, contestDoc.endAt);
    assert.deepEqual(await model.saveOfficialKind(request), result);
    await assert.rejects(model.saveOfficialKind({ ...request, items: [{ ...request.items[0], body: { main: 'changed' } }] }));
    await assert.rejects(model.saveOfficialKind({ ...request, operationId: 'different' }));
});

it('rejects a wrong participant and a mismatched requested round before accepting a save', async () => {
    const opened = round();
    await assert.rejects(model.saveOfficialKind({ ...save(opened), uid: 2 }));
    await assert.rejects(model.saveOfficialKind({ ...save(opened), roundId: new ObjectId() }));
    assert.equal(coll('contest.answerOperations').docs.length, 0);
    await model.saveOfficialKind(save(opened));
    const second = round(2);
    await assert.rejects(model.saveOfficialKind(save(second)));
    assert.equal(coll('contest.answers').docs.length, 1);
});

it('keeps one manual Record identity on retry and prevents an old grade from changing a later answer', async () => {
    problems.set(1, subjectiveProblem());
    const opened = round();
    const request = { ...save(opened), kind: 'subjective' as const };
    failManual = true;
    await assert.rejects(model.saveOfficialKind(request), /manual record interrupted/);
    await model.saveOfficialKind(request);
    assert.equal(new Set(manualIds).size, 1);
    const [first] = await model.getOfficialAnswers(domainId, opened);
    assert.equal(first.status, STATUS.STATUS_WAITING);
    assert.equal((await model.projectParticipantStatus(domainId, tid, 1)).setJudgePending, true);
    await model.saveOfficialKind({ ...request, operationId: 'second', items: [{ pid: 1, body: { main: 'B' }, baseVersion: 1 }] });
    const [second] = await model.getOfficialAnswers(domainId, opened);
    assert.notEqual(second.rid, first.rid);
    assert.equal(await model.applyManualAnswerGrade(domainId, tid, opened._id, 1, new ObjectId(first.rid), 1, 100, STATUS.STATUS_ACCEPTED), false);
    assert.equal(await model.applyManualAnswerGrade(domainId, tid, opened._id, 1, new ObjectId(second.rid), 2, 60, STATUS.STATUS_WRONG_ANSWER), true);
    assert.equal((await model.getOfficialAnswers(domainId, opened))[0].rawScore, 60);
    assert.deepEqual((await model.readParticipantScore(domainId, tid, 1)).problemStats.get(1), { nSubmit: 2, nAccept: 0 });
});

it('filters scores before round selection and reconstructs the accepted answer at a frozen cutoff', async () => {
    const first = round(1, 'closed');
    answer(first, 1, 1);
    answer(first, 3, 99);
    const second = round(2, 'closed');
    answer(second, 1, 60);
    const visible = await model.readParticipantScore(domainId, tid, 1, undefined, { visibility: (_round, pid) => ({ score: pid === 1, verdict: pid === 1 }) });
    assert.equal(visible.score, 60);
    assert.ok(visible.setRoundId.equals(second._id));
    assert.equal(visible.detail[3], undefined);
    coll('contest.rounds').docs = [];
    coll('contest.answers').docs = [];
    const opened = round();
    await model.saveOfficialKind(save(opened));
    const [firstSave] = await model.getOfficialAnswers(domainId, opened);
    await model.saveOfficialKind({ ...save(opened, 'second', new Date(+firstSave.acceptedAt + 2000)),
        items: [{ pid: 1, body: { main: 'B' }, baseVersion: 1 }] });
    const frozen = await model.readParticipantScore(domainId, tid, 1, undefined, { cutoff: firstSave.acceptedAt });
    assert.equal(frozen.score, 100);
    assert.deepEqual(frozen.problemStats.get(1), { nSubmit: 1, nAccept: 1 });
    const live = await model.readParticipantScore(domainId, tid, 1);
    assert.equal(live.score, 0);
    assert.deepEqual(live.problemStats.get(1), { nSubmit: 2, nAccept: 1 });
});

it('shares only paper metadata across concurrent scoreboard rows and reads fresh scores and rules', async () => {
    contestDoc.pids = [1, 2];
    const first = round(1, 'closed', [1, 2]);
    const team = new ObjectId();
    const second = round(1, 'closed', [2, 1]);
    second.participantKey = model.participantKey(1, team);
    const saved = answer(first, 1, 30);
    answer(second, 1, 80);
    const contest = require('../src/model/contest.ts') as typeof import('../src/model/contest');
    const tdoc = await contest.get(domainId, tid);
    const read = model.createParticipantScoreReader(tdoc);
    const rows = await Promise.all([read(1), read(1, team), read(2)]);
    assert.deepEqual(rows.map((row) => row.score), [30, 80, 0]);
    assert.deepEqual(problemReads.slice().sort(), [1, 2]);

    saved.rawScore = 60;
    assert.equal((await read(1)).score, 60);
    assert.equal(problemReads.length, 2);
    problems.set(1, { problemKind: 'programming', config: {} });
    assert.equal((await model.createParticipantScoreReader(tdoc)(1)).score, 0);
    assert.equal(problemReads.length, 4);
});

it('does not let a hand-in after the frozen cutoff change the selected frozen round', async () => {
    const first = round(1, 'closed', [1]);
    answer(first, 1, 50);
    const second = round(2, 'open', [1]);
    answer(second, 1, 100);
    const cutoff = new Date(+baseTime + 1000);
    assert.equal((await model.readParticipantScore(domainId, tid, 1, undefined, { cutoff })).score, 50);
    await model.handInRound(second, config.settings, new Date(+baseTime + 2000), contestDoc.endAt);
    assert.equal((await model.readParticipantScore(domainId, tid, 1, undefined, { cutoff })).score, 50);
    assert.equal((await model.readParticipantScore(domainId, tid, 1, undefined, { cutoff: new Date(+baseTime + 3000) })).score, 100);
});

function subjectiveProblem() {
    return { problemKind: 'subjective', config: { type: 'objective', answers: { main: ['', 100, { kind: 'subjective' }] } } };
}

it('parses YAML program-fill mode before scoring and keeps a proven locked legacy result', async () => {
    problems.set(2, { problemKind: 'program_fill', config: 'type: fill\nmode: compile\n' });
    const closed = round(1, 'closed', [2]);
    coll('record').docs.push({ _id: new ObjectId(), domainId, setRoundId: closed._id, pid: 2, score: 80,
        status: STATUS.STATUS_ACCEPTED, judgeAt: baseTime, setAcceptedAt: baseTime });
    assert.equal((await model.projectParticipantStatus(domainId, tid, 1)).score, 80);
    closed.legacy = { sourceRule: 'exam', sourceStatusId: new ObjectId(), missingRounds: 2, incompleteHistory: true, scoreLocked: true };
    closed.roundNo = 3;
    coll('record').docs = [];
    problems.clear();
    assert.equal((await model.projectParticipantStatus(domainId, tid, 1)).score, 80);
    await assert.rejects(model.projectParticipantStatus(domainId, tid, 1, undefined, closed._id), /legacy_score_locked/);
});
