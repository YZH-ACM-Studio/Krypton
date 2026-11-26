import assert from 'node:assert/strict';
import { it } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { ObjectId, type Document } from 'mongodb';
import { createDraftConfig, RECALC_CONCURRENCY, STATUS } from '@hydrooj/common';
import { recalcSetScores, type RecalcCollection, type SetRecalcInput } from '../src/lib/set-recalc';
import { withSetParticipantBoundary } from '../src/lib/set-participant-boundary';

const tid = new ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa');
const unrelatedTid = new ObjectId('bbbbbbbbbbbbbbbbbbbbbbbb');
const domainId = 'system';
const at = (seconds: number) => new Date(seconds * 1000);
const idAt = (seconds: number) => ObjectId.createFromTime(seconds);

function equal(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
    if (left instanceof Date && right instanceof Date) return +left === +right;
    return left === right;
}

function comparable(value: unknown): number | string {
    if (value instanceof ObjectId) return value.toHexString();
    if (value instanceof Date) return +value;
    if (typeof value === 'number' || typeof value === 'string') return value;
    throw new Error('unsupported comparison');
}

function matches(doc: Document, filter: Document): boolean {
    return Object.entries(filter).every(([key, value]: [string, unknown]) => {
        const actual: unknown = doc[key];
        if (value && typeof value === 'object' && !(value instanceof ObjectId) && !(value instanceof Date)) {
            return Object.entries(value).every(([operator, expected]: [string, unknown]) => {
                if (operator === '$in') {
                    assert.ok(Array.isArray(expected));
                    const values: unknown[] = Array.isArray(actual) ? actual : [actual];
                    return values.some((item) => expected.some((candidate: unknown) => equal(item, candidate)));
                }
                if (operator === '$gte') return comparable(actual) >= comparable(expected);
                if (operator === '$lt') return comparable(actual) < comparable(expected);
                throw new Error(`unsupported operator ${operator}`);
            });
        }
        return equal(actual, value);
    });
}

class Activity {
    active = 0;
    peak = 0;

    async call<T>(operation: () => T): Promise<T> {
        this.active++;
        this.peak = Math.max(this.peak, this.active);
        try {
            await setTimeout(2);
            return operation();
        } finally {
            this.active--;
        }
    }
}

class Collection implements RecalcCollection {
    filters: Document[] = [];
    before?: (filter: Document, update?: Document) => void;

    constructor(public docs: Document[], private activity: Activity, private scope: (filter: Document) => void) {}

    check(filter: Document) {
        this.scope(filter);
        this.filters.push(filter);
    }

    find(filter: Document) {
        this.check(filter);
        return { toArray: () => this.activity.call(() => {
            this.before?.(filter);
            return this.docs.filter((doc) => matches(doc, filter)).map((doc) => structuredCloneDoc(doc));
        }) };
    }

    async updateOne(filter: Document, update: Document) {
        this.check(filter);
        return this.activity.call(() => {
            this.before?.(filter, update);
            const doc = this.docs.find((item) => matches(item, filter));
            if (!doc) return { matchedCount: 0 };
            Object.assign(doc, update.$set);
            for (const key of Object.keys(update.$unset ?? {})) delete doc[key];
            return { matchedCount: 1 };
        });
    }
}

function structuredCloneDoc(doc: Document): Document {
    // Retain BSON/Date instances while preventing writes through returned documents.
    return { ...doc };
}

function fixture(count = 1) {
    const activity = new Activity();
    const config = createDraftConfig('homework');
    config.settings.retake.passScore = 60;
    const contest = { domainId, docType: 30, docId: tid, setConfig: config };
    const rounds: Document[] = Array.from({ length: count }, (_, index) => ({
        _id: new ObjectId(), domainId, tid, participantKey: `u:${index + 1}`, roundNo: 1,
        state: 'closed', startedAt: at(100), closedAt: at(200), paperPids: [1, 2], total: 0, passed: false,
        scoreRevision: config.revision,
    }));
    const otherRound = { ...rounds[0], _id: new ObjectId(), tid: unrelatedTid, total: 777 };
    const statuses = rounds.map((round, index) => ({
        domainId, docType: 30, docId: tid, uid: index + 1, score: 0, startAt: at(100), journal: ['preserved'],
    }));
    const otherStatus = { ...statuses[0], docId: unrelatedTid, score: 777 };
    const check = (field: string) => (filter: Document) => {
        assert.equal(filter.domainId, domainId);
        assert.ok(equal(filter[field], tid), `unscoped ${field}`);
    };
    const collections = {
        contests: new Collection([contest, { ...contest, docId: unrelatedTid }], activity, check('docId')),
        statuses: new Collection([...statuses, otherStatus], activity, check('docId')),
        rounds: new Collection([...rounds, otherRound], activity, check('tid')),
        // Answers are stored by roundId, without tid. Enforce the target round identity.
        answers: new Collection(rounds.map((round) => ({
            domainId, roundId: round._id, pid: 1, rawScore: 100, acceptedAt: at(110),
        })), activity, (filter) => {
            assert.equal(filter.domainId, domainId);
            assert.ok(rounds.some((round) => equal(round._id, filter.roundId)));
        }),
        records: new Collection([], activity, (filter) => {
            assert.equal(filter.domainId, domainId);
            assert.ok(rounds.some((round) => equal(round._id, filter.setRoundId)), 'unscoped setRoundId');
        }),
    };
    const logs: string[] = [];
    const input: SetRecalcInput = {
        domainId, tid, changedPids: [1], score: { 1: 50, 2: 100 }, codePids: new Set([2]), collections,
        now: at(300), logger: { info: (message) => logs.push(message), error: (message) => logs.push(message) },
    };
    return { input, collections, activity, rounds, statuses, otherRound, otherStatus, logs, config };
}

it('recalculates affected participants concurrently with a pool bounded by eight and preserves unrelated data', async () => {
    const f = fixture(19);
    await recalcSetScores(f.input);
    assert.ok(f.activity.peak >= 2);
    assert.ok(f.activity.peak <= RECALC_CONCURRENCY);
    assert.equal(RECALC_CONCURRENCY, 8);
    for (const status of f.statuses) {
        assert.equal(status.score, 50);
        assert.deepEqual(status.journal, ['preserved']);
        assert.deepEqual(status.startAt, at(100));
    }
    assert.equal(f.otherRound.total, 777);
    assert.equal(f.otherStatus.score, 777);
    assert.equal(f.collections.contests.docs[0].statusRecalcToken, undefined);
    assert.match(f.logs[0], /changedPids=1 rounds=19 durationMs=\d+/);
});

it('counts a judged attempt outside the id window and ignores an unjudged score', async () => {
    const f = fixture();
    f.input.changedPids = [2];
    f.collections.records.docs = [
        {
            domainId, setRoundId: f.rounds[0]._id, pid: 2, _id: idAt(150), score: 100, status: STATUS.STATUS_ACCEPTED,
        },
        {
            domainId, setRoundId: f.rounds[0]._id, pid: 2, _id: idAt(50), score: 40, status: STATUS.STATUS_ACCEPTED, judgeAt: at(150),
        },
    ];
    await recalcSetScores(f.input);
    assert.equal(f.rounds[0].total, 90);
    assert.equal(f.statuses[0].score, 90);
});

it('rescales paper points and preserves locked scores and the grade release setting', async () => {
    for (const released of [false, true]) {
        const f = fixture(2);
        f.config.publication = 'published';
        f.config.settings.feedback.gradesReleased = released;
        f.config.settings.retake.passScore = 15;
        const [current, locked] = f.rounds;
        Object.assign(locked, { legacy: { scoreLocked: true }, total: 85, maxPoints: 100, passed: true });
        const original = { ...locked };
        f.collections.answers.docs[0].rawScore = 60;
        f.input.points = { 1: { rawMax: 100, points: 30 }, 2: { rawMax: 100, points: 50, excluded: true } };
        f.input.changedPids = [1, 2];
        await recalcSetScores(f.input);
        assert.equal(current.total, 18);
        assert.equal(current.maxPoints, 30);
        assert.equal(current.passed, true);
        assert.equal(current.detail[1].score, 18);
        assert.equal(current.detail[2], undefined);
        assert.deepEqual(locked, original);
        assert.deepEqual(f.statuses.map((row) => row.score), [18, 85]);
        assert.equal(f.collections.contests.docs[0].setConfig.settings.feedback.gradesReleased, released);
    }
});

for (const pick of ['highest_total', 'last_round'] as const) {
    it(`preserves locked scores and completes other rounds and participants with ${pick}`, async () => {
        const f = fixture(10);
        f.config.settings.retake.pick = pick;
        const locked = f.rounds[0];
        Object.assign(locked, {
            legacy: { scoreLocked: true }, total: 85, passed: true, accept: 1, penaltySeconds: 123,
            detail: { 9: { pid: 9, score: 85, status: STATUS.STATUS_ACCEPTED } },
            scoreRevision: f.config.revision - 1, scoreDirty: true, statusDirty: false,
        });
        const original = { ...locked };
        const fresh: Document = { ...f.rounds[1], _id: new ObjectId(), participantKey: locked.participantKey, roundNo: 2 };
        f.rounds.push(fresh);
        f.collections.rounds.docs.push(fresh);
        f.collections.answers.docs.push({ domainId, roundId: fresh._id, pid: 1, rawScore: 100, acceptedAt: at(110) });
        f.collections.rounds.before = (filter, update) => {
            if (update) assert.ok(!equal(filter._id, locked._id), 'locked round must retain its stored grading facts');
        };

        await recalcSetScores(f.input);

        assert.deepEqual(locked, original);
        for (const round of f.rounds.slice(1)) {
            assert.equal(round.total, 50);
            assert.equal(round.scoreDirty, false);
            assert.equal(round.statusDirty, false);
        }
        for (const status of f.statuses.slice(1)) assert.equal(status.score, 50);
        const selected = pick === 'highest_total' ? locked : fresh;
        const status: Document = f.statuses[0];
        assert.equal(status.score, selected.total);
        assert.ok(equal(status.setRoundId, selected._id));
        assert.deepEqual(status.detail, selected.detail);
        assert.equal(status.setScoreRevision, selected.scoreRevision);
        assert.ok(f.collections.answers.filters.every((filter) => !equal(filter.roundId, locked._id)));
        assert.ok(f.collections.records.filters.every((filter) => !equal(filter.setRoundId, locked._id)));
        assert.equal(f.collections.contests.docs[0].statusRecalcToken, undefined);
        assert.match(f.logs[0], /set score recalc complete lockedRounds=1 /);
    });
}

it('completes an entirely locked set using its original scores without reading incomplete grading records', async () => {
    const f = fixture();
    Object.assign(f.rounds[0], { legacy: { scoreLocked: true }, total: 85 });
    const original = { ...f.rounds[0] };
    await recalcSetScores(f.input);
    assert.deepEqual(f.rounds[0], original);
    assert.equal(f.statuses[0].score, 85);
    assert.equal(f.collections.answers.filters.length, 0);
    assert.equal(f.collections.records.filters.length, 0);
    assert.equal(f.collections.contests.docs[0].statusRecalcToken, undefined);
    assert.match(f.logs[0], /set score recalc complete lockedRounds=1 /);
});

it('rejects malformed subtask scores instead of committing a partial total', async () => {
    const f = fixture();
    f.config.settings.codePolicy = 'subtask_best';
    f.input.changedPids = [2];
    f.collections.records.docs = [
        {
            domainId, setRoundId: f.rounds[0]._id, pid: 2, _id: idAt(150), score: 7, status: STATUS.STATUS_ACCEPTED, judgeAt: at(150),
            subtasks: { bad: { score: 'x', status: 1 }, good: { score: 30, status: 2 }, drop: 5 },
        },
        {
            domainId, setRoundId: f.rounds[0]._id, pid: 2, _id: idAt(160), score: 9, status: STATUS.STATUS_ACCEPTED, judgeAt: at(160),
            subtasks: 12,
        },
    ];
    await assert.rejects(recalcSetScores(f.input), /set_record_subtasks_invalid/);
    assert.equal(f.rounds[0].total, 0);
    assert.equal(f.statuses[0].score, 0);
});

it('selects among the same participant other rounds without changing unaffected rounds', async () => {
    const f = fixture();
    const other = { ...f.rounds[0], _id: new ObjectId(), roundNo: 2, paperPids: [3], total: 85 };
    f.collections.rounds.docs.push(other);
    await recalcSetScores(f.input);
    assert.equal(f.statuses[0].score, 85);
    assert.equal(other.total, 85);
});

it('refreshes a dirty candidate outside the changed problems before selecting the highest whole round', async () => {
    const f = fixture();
    const other = { ...f.rounds[0], _id: new ObjectId(), roundNo: 2, paperPids: [2], total: 25, scoreDirty: true };
    f.rounds.push(other);
    f.collections.rounds.docs.push(other);
    f.collections.records.docs.push({
        domainId, setRoundId: other._id, pid: 2, _id: idAt(180), score: 100, status: STATUS.STATUS_ACCEPTED, judgeAt: at(250),
    });
    await recalcSetScores(f.input);
    assert.equal(f.statuses[0].score, 100);
    assert.ok((f.statuses[0] as Document).setRoundId.equals(other._id));
    assert.equal(other.total, 100);
    assert.equal(other.scoreDirty, false);
});

it('stops writes when a newer token and totals appear', async () => {
    const f = fixture();
    f.collections.answers.before = () => {
        f.collections.contests.docs[0].statusRecalcToken = 'newer';
        f.statuses[0].score = 999;
        f.rounds[0].total = 999;
    };
    await assert.rejects(recalcSetScores(f.input), /superseded/);
    assert.equal(f.collections.contests.docs[0].statusRecalcToken, 'newer');
    assert.equal(f.statuses[0].score, 999);
    assert.equal(f.rounds[0].total, 999);
});

it('clears only its own token even when a newer task arrives between the final read and clear', async () => {
    const f = fixture();
    f.collections.contests.before = (_filter, update) => {
        if (update?.$unset) f.collections.contests.docs[0].statusRecalcToken = 'newer';
    };
    await assert.rejects(recalcSetScores(f.input), /superseded/);
    assert.equal(f.collections.contests.docs[0].statusRecalcToken, 'newer');
});

it('propagates a thrown collection failure, retains the token and logs context', async () => {
    const f = fixture();
    f.collections.records.before = () => { throw new Error('record read failed'); };
    await assert.rejects(recalcSetScores(f.input), /record read failed/);
    assert.equal(typeof f.collections.contests.docs[0].statusRecalcToken, 'string');
    assert.equal(f.statuses[0].score, 0);
    assert.match(f.logs[0], /domain=system tid=aaaaaaaaaaaaaaaaaaaaaaaa changedPids=1 rounds=1 durationMs=\d+ error=record read failed/);
});

it('rejects unsupported participant keys visibly without clearing the token', async () => {
    const f = fixture();
    f.rounds[0].participantKey = 't:unknown';
    await assert.rejects(recalcSetScores(f.input), /participant_invalid/);
    assert.equal(typeof f.collections.contests.docs[0].statusRecalcToken, 'string');
    assert.equal(f.statuses[0].score, 0);
});

it('recalculates a team round onto the team status', async () => {
    const f = fixture();
    const key = `t:${new ObjectId().toHexString()}`;
    f.rounds[0].participantKey = key;
    f.rounds[0].paperPids = [1];
    const teamStatus = { domainId, contestId: tid, teamId: new ObjectId(key.slice(2)), score: 0 };
    f.input.collections.teamStatuses = new Collection([teamStatus], f.activity, (filter) => {
        assert.equal(filter.domainId, domainId);
        assert.ok(equal(filter.contestId, tid), 'unscoped contestId');
    });
    await recalcSetScores(f.input);
    assert.equal(teamStatus.score, 50);
    assert.equal(f.collections.contests.docs[0].statusRecalcToken, undefined);
});

it('retains code scores for unchanged problems when recomputing the full round total', async () => {
    const f = fixture();
    f.collections.records.docs.push({
        domainId, setRoundId: f.rounds[0]._id, pid: 2, _id: idAt(150), score: 25, status: STATUS.STATUS_ACCEPTED, judgeAt: at(150),
    });
    await recalcSetScores(f.input);
    assert.equal(f.statuses[0].score, 75);
    assert.equal((f.statuses[0] as Document).detail[1].score, 50);
    assert.equal((f.statuses[0] as Document).detail[2].score, 25);
    assert.ok((f.statuses[0] as Document).setRoundId.equals(f.rounds[0]._id));
});

it('serializes a judging write behind recalculation so the accepted newer score wins', async () => {
    const f = fixture();
    // Acquire the same boundary from a separate async origin while recalculation is inside it.
    let notify!: () => void;
    const started = new Promise<void>((resolve) => { notify = resolve; });
    f.collections.answers.before = () => {
        f.collections.answers.before = undefined;
        notify();
    };
    const recalc = recalcSetScores(f.input);
    await started;
    const callback = withSetParticipantBoundary(domainId, tid, 'u:1', async () => {
        f.rounds[0].total = 100;
        f.statuses[0].score = 100;
    });
    await Promise.all([recalc, callback]);
    assert.equal(f.rounds[0].total, 100);
    assert.equal(f.statuses[0].score, 100);
});

it('rejects a recalculation for an obsolete settings revision before changing scores', async () => {
    const f = fixture();
    f.input.expectedRevision = f.config.revision + 1;
    await assert.rejects(recalcSetScores(f.input), /set_recalc_superseded/);
    assert.equal(f.rounds[0].total, 0);
    assert.equal(f.statuses[0].score, 0);
});

it('rechecks the token before writing participant status', async () => {
    const f = fixture();
    f.collections.rounds.before = (_filter, update) => {
        if (update) {
            f.collections.contests.docs[0].statusRecalcToken = 'newer';
            f.statuses[0].score = 999;
        }
    };
    await assert.rejects(recalcSetScores(f.input), /superseded/);
    assert.equal(f.statuses[0].score, 999);
    assert.equal(f.collections.contests.docs[0].statusRecalcToken, 'newer');
});

it('sets the token before loading problem scoring facts and retains it if that work fails', async () => {
    const f = fixture();
    f.input.codePids = async () => {
        assert.equal(typeof f.collections.contests.docs[0].statusRecalcToken, 'string');
        throw new Error('problem facts unavailable');
    };
    await assert.rejects(recalcSetScores(f.input), /problem facts unavailable/);
    assert.equal(typeof f.collections.contests.docs[0].statusRecalcToken, 'string');
});
