import { expect } from 'chai';
import { describe, it } from 'node:test';
import { STATUS } from '../status';
import { comparePaperScores, paperMaximum, paperProblemMaximum, pointsForIssuedRound, type SetPaperPoints } from '../set-points';
import { createDraftConfig, parseSetConfig, type SetSettings } from '../set-config';
import {
    codeScoreForProblem,
    feedbackOpen,
    planHandIn,
    planOfficialSave,
    planRoundStart,
    planRoundEntry,
    roundPassed,
    roundPersonalEnd,
    roundTotal,
    selectRound,
    type CodeAttempt,
    type StoredRound,
} from '../set-round';

const begin = new Date('2026-11-10T00:00:00.000Z');
const end = new Date('2026-11-10T10:00:00.000Z');

function settings(overrides: Partial<SetSettings> = {}): SetSettings {
    const base = createDraftConfig('homework');
    return parseSetConfig({ ...base, settings: { ...base.settings, ...overrides } }).settings;
}

function closed(roundNo: number, total: number, passed = false): StoredRound {
    return {
        roundNo,
        state: 'closed',
        startedAt: begin,
        closedAt: new Date(begin.getTime() + 60_000),
        paperPids: [1, 2],
        total,
        passed,
    };
}

describe('paper points', () => {
    it('selects the higher absolute total before comparing rates and reuses only eligible questions within the new quota', () => {
        const policy = settings({ retake: { ...settings().retake, extra: 3 },
            draw: { enabled: true, redrawEachRound: false, allowRepeatAcrossRounds: true, quotas: { programming: 1 } } });
        const previous = { ...closed(1, 72), maxPoints: 90, paperPids: [1, 2] };
        const second = { ...closed(2, 75), maxPoints: 100 };
        expect(selectRound(policy, [previous, second])).to.equal(second);
        const kinds = new Map([[1, 'programming'], [2, 'programming'], [3, 'programming']] as const);
        const clock = { beginAt: begin, endAt: end, now: new Date(+begin + 120000) };
        for (const pool of [[1, 2, 3], [2, 3]]) {
            const next = planRoundStart(policy, clock, [previous], pool, kinds, () => 0);
            expect(next.action === 'open' && next.paperPids).to.deep.equal([pool[0]]);
            expect(previous.paperPids).to.deep.equal([1, 2]);
        }
    });

    it('uses the assigned maximum for partial credit and preserves old weights until edited', () => {
        const points: SetPaperPoints = { 1: { rawMax: 10, points: 20 }, 2: { rawMax: 100, points: 30 } };
        const attempt = { pid: 1, score: 5, recordId: 'a', acceptedAt: begin, status: STATUS.STATUS_WRONG_ANSWER };
        const answer = { pid: 2, rawScore: 60, acceptedAt: begin, status: STATUS.STATUS_MANUAL_GRADED };
        const score = (plan?: SetPaperPoints) => roundTotal(settings(), [1, 2], [answer], [attempt], new Map([[1, 20]]), new Set([1]), begin, plan);
        expect(paperProblemMaximum({ score: { 1: 20 } }, 1, 10)).to.equal(2);
        expect(score().problems[0].score).to.equal(1);
        expect(score(points).problems.map((p) => p.score)).to.deep.equal([10, 18]);
        expect(score(points).total).to.equal(28);
        points[1].excluded = true;
        expect(score(points).total).to.equal(18);
        expect(paperMaximum(points, [1, 2])).to.equal(30);
        expect(paperMaximum(points, [2])).to.equal(30);
    });

    it('rounds each question to hundredths before summing', () => {
        const points = Object.fromEntries([1, 2, 3].map((pid) => [pid, { points: 2.01, rawMax: 10 }]));
        const answers = [1, 2, 3].map((pid) => ({ pid, rawScore: 5, acceptedAt: begin }));
        const result = roundTotal(settings(), [1, 2, 3], answers, [], new Map(), new Set(), begin, points);
        expect(result.problems.map((p) => p.score)).to.deep.equal([1.01, 1.01, 1.01]);
        expect(result.total).to.equal(3.03);
    });

    it('keeps the precision of an old draw unaffected by a withdrawal and rounds newly issued papers', () => {
        const points: SetPaperPoints = { 1: { points: 33, rawMax: 100, fromLegacyWeight: true }, 2: { points: 20, rawMax: 100, excluded: true } };
        const score = (round: Pick<StoredRound, 'paperPids' | 'issuedWithPaperPoints'>) => roundTotal(settings(),
            round.paperPids, [{ pid: 1, rawScore: 12.5, acceptedAt: begin }], [], new Map([[1, 33]]), new Set(), begin, pointsForIssuedRound(points, round)).total;
        expect(score({ paperPids: [1] })).to.equal(4.125);
        expect(score({ paperPids: [1, 2] })).to.equal(4.13);
        expect(score({ paperPids: [1], issuedWithPaperPoints: true })).to.equal(4.13);
        expect(comparePaperScores({ score: 4.125, maxPoints: 33 }, { score: 4.13, maxPoints: 33.04 })).to.equal(0);
    });
});

describe('formal rounds', () => {
    it('resumes the open round and keeps a short personal window startable', () => {
        const config = settings({ personalLimit: { hours: 3, requireFullWindow: false } });
        const clock = { beginAt: begin, endAt: end, now: new Date('2026-11-10T08:00:00.000Z') };
        const opened = planRoundStart(config, clock, [], [1], new Map(), () => 0);
        expect(opened.action).to.equal('open');
        if (opened.action !== 'open') return;
        expect(opened.availableMs).to.equal(2 * 3_600_000);
        const again = planRoundStart(config, clock, [{ ...closed(1, 0), startedAt: new Date('2026-11-10T07:00:00.000Z'), state: 'open', closedAt: null }], [1], new Map(), () => 0);
        expect(again).to.deep.equal({ action: 'resume', roundNo: 1, availableMs: 2 * 3_600_000 });
        const legacy = settings({ personalLimit: { hours: 3, requireFullWindow: true } });
        expect(planRoundStart(legacy, clock, [], [1], new Map(), () => 0)).to.deep.equal({
            action: 'deny',
            code: 'set_round_window_short',
        });
    });

    it('denies an expired personal round and counts missing historical round numbers as used', () => {
        const config = settings({ personalLimit: { hours: 1, requireFullWindow: false },
            retake: { extra: 3, onlyAfterFail: false, requireFullWindow: false, passScore: null, pick: 'highest_total' } });
        const clock = { beginAt: begin, endAt: end, now: new Date('2026-11-10T01:00:00.000Z') };
        expect(planRoundEntry(config, clock, [{ ...closed(1, 0), state: 'open', closedAt: null }])).to.deep.equal({
            action: 'deny', code: 'set_round_closed',
        });
        expect(planRoundEntry(config, clock, [closed(3, 50)])).to.deep.equal({ action: 'open', roundNo: 4, availableMs: 3_600_000 });
        expect(planRoundEntry(config, clock, [closed(4, 50)])).to.deep.equal({ action: 'deny', code: 'set_round_attempts_used' });
        expect(planOfficialSave({ operationId: 'late', now: end, deadline: end, paperPids: [1], current: [],
            items: [{ pid: 1, body: {}, baseVersion: 0, rawScore: 0 }] })).to.deep.equal({ code: 'set_round_closed', conflicts: [] });
    });

    it('counts ACM wrong answers by acceptance order and selects the equal-score round with lower penalty', () => {
        const config = settings({ codePolicy: 'acm' });
        const attempt = (id: string, seconds: number, status: number): CodeAttempt => ({
            pid: 1, acceptedAt: new Date(+begin + seconds * 1000), score: status === STATUS.STATUS_ACCEPTED ? 100 : 0, status, recordId: id,
        });
        const total = roundTotal(config, [1, 2], [], [
            attempt('a', 10, STATUS.STATUS_WRONG_ANSWER), attempt('b', 20, STATUS.STATUS_COMPILE_ERROR),
            attempt('c', 30, STATUS.STATUS_ACCEPTED), attempt('d', 30, STATUS.STATUS_WRONG_ANSWER),
            attempt('e', 0, STATUS.STATUS_CANCELED),
        ], new Map(), new Set([1, 2]), begin);
        expect(total.total).to.equal(1);
        expect(total.penaltySeconds).to.equal(1230);
        expect(total.problems[0]).to.include({ score: 1, recordId: 'c', wrongAttempts: 1, elapsedSeconds: 30, penaltySeconds: 1200 });
        expect(total.problems[1]).to.include({ score: 0, acceptedAt: null });
        expect(selectRound(config, [{ ...closed(1, 1), penaltySeconds: 2400 }, { ...closed(2, 1), penaltySeconds: 1230 }])?.roundNo).to.equal(2);
    });

    it('applies lateness independently when selecting subtask best results', () => {
        const config = settings({ codePolicy: 'subtask_best',
            late: { enabled: true, onTimeAt: new Date(+begin + 3600_000), rules: { 0: 0.5 } } });
        const early: CodeAttempt = { pid: 1, acceptedAt: begin, score: 60, status: 2, recordId: 'early',
            subtasks: { a: { score: 60, status: 1 }, b: { score: 0, status: 2 } } };
        const late: CodeAttempt = { pid: 1, acceptedAt: end, score: 100, status: 1, recordId: 'late',
            subtasks: { a: { score: 60, status: 1 }, b: { score: 40, status: 1 } } };
        expect(codeScoreForProblem(config, [late, early])?.score).to.equal(80);
    });

    it('lets a passed student retake unless the old exam rule is stored', () => {
        const open = settings({ retake: { extra: 1, onlyAfterFail: false, requireFullWindow: false, passScore: 60, pick: 'highest_total' } });
        const clock = { beginAt: begin, endAt: end, now: new Date('2026-11-10T01:00:00.000Z') };
        expect(planRoundStart(open, clock, [closed(1, 80, true)], [1], new Map(), () => 0).action).to.equal('open');
        const oldExam = settings({ retake: { extra: 1, onlyAfterFail: true, requireFullWindow: false, passScore: 60, pick: 'last_round' } });
        expect(planRoundStart(oldExam, clock, [closed(1, 80, true)], [1], new Map(), () => 0)).to.deep.equal({
            action: 'deny',
            code: 'set_round_need_fail',
        });
        expect(planRoundEntry(oldExam, clock, [{ ...closed(1, 0), judgePending: true }])).to.deep.equal({
            action: 'deny', code: 'set_round_grading_pending',
        });
        expect(planRoundStart(open, clock, [closed(1, 80, true), closed(2, 70, true)], [1], new Map(), () => 0)).to.deep.equal({
            action: 'deny',
            code: 'set_round_attempts_used',
        });
    });

    it('keeps the acceptance time of an unchanged answer and rejects a stale version', () => {
        const acceptedAt = new Date('2026-11-10T01:00:00.000Z');
        const current = [{ pid: 1, version: 2, operationId: 'old', acceptedAt, body: { a: '1' }, rawScore: 10 }];
        const same = planOfficialSave({
            operationId: 'new',
            now: new Date('2026-11-10T02:00:00.000Z'),
            deadline: end,
            paperPids: [1],
            current,
            items: [{ pid: 1, body: { a: '1' }, baseVersion: 2, rawScore: 10 }],
        });
        expect(same).to.deep.equal({ changed: [], unchanged: [1] });
        const conflict = planOfficialSave({
            operationId: 'new',
            now: new Date('2026-11-10T02:00:00.000Z'),
            deadline: end,
            paperPids: [1],
            current,
            items: [{ pid: 1, body: { a: '2' }, baseVersion: 1, rawScore: 0 }],
        });
        expect(conflict).to.deep.equal({ code: 'set_round_conflict', conflicts: [1] });
        const cleared = planOfficialSave({
            operationId: 'clear',
            now: new Date('2026-11-10T02:00:00.000Z'),
            deadline: end,
            paperPids: [1],
            current,
            items: [{ pid: 1, body: {}, baseVersion: 2, rawScore: 0 }],
        });
        expect('changed' in cleared && cleared.changed[0]?.acceptedAt.toISOString()).to.equal('2026-11-10T02:00:00.000Z');
    });

    it('selects a whole round and applies the late coefficient before the highest pick', () => {
        const config = settings({
            codePolicy: 'highest',
            late: { enabled: true, onTimeAt: new Date('2026-11-10T02:00:00.000Z'), rules: { 0: 0.5 } },
        });
        const early: CodeAttempt = { pid: 7, acceptedAt: new Date('2026-11-10T01:00:00.000Z'), score: 80, status: STATUS.STATUS_ACCEPTED, recordId: 'a' };
        const late: CodeAttempt = { pid: 7, acceptedAt: new Date('2026-11-10T03:00:00.000Z'), score: 100, status: STATUS.STATUS_ACCEPTED, recordId: 'b' };
        expect(codeScoreForProblem(config, [early, late])?.score).to.equal(80);
        const last = settings({ codePolicy: 'last' });
        expect(codeScoreForProblem(last, [early, { ...late, score: 0 }])?.score).to.equal(0);
        const rounds = [closed(1, 80), closed(2, 60)];
        expect(selectRound(settings(), rounds)?.roundNo).to.equal(1);
        expect(selectRound(settings({ retake: { extra: 1, onlyAfterFail: false, requireFullWindow: false, passScore: null, pick: 'last_round' } }), rounds)?.roundNo).to.equal(2);
        const mixed = roundTotal(settings(), [1, 2], [], [
            { pid: 1, acceptedAt: begin, score: 100, status: STATUS.STATUS_ACCEPTED, recordId: 'r1' },
            { pid: 2, acceptedAt: begin, score: 0, status: STATUS.STATUS_WRONG_ANSWER, recordId: 'r2' },
        ], new Map([[1, 100], [2, 100]]), new Set([1, 2]), begin);
        expect(mixed.total).to.equal(100);
        expect(roundPassed(settings({ retake: { extra: 0, onlyAfterFail: false, requireFullWindow: false, passScore: 60, pick: 'highest_total' } }), 80)).to.equal(true);
    });

    it('ends a round only by the clock when early hand-in is off', () => {
        const now = new Date('2026-11-10T01:00:00.000Z');
        expect(planHandIn(settings({ earlyHandIn: false }), 'open', now, end)).to.equal('set_round_hand_in_closed');
        expect(planHandIn(settings({ earlyHandIn: true }), 'open', now, end)).to.equal('close');
        expect(roundPersonalEnd(settings({ personalLimit: { hours: 1, requireFullWindow: false } }), end, new Date('2026-11-10T09:30:00.000Z')).toISOString()).to.equal(end.toISOString());
        expect(feedbackOpen('after_deadline', false, now, null, end)).to.equal(false);
        expect(feedbackOpen('after_release', true, now, null, end)).to.equal(true);
    });
});
