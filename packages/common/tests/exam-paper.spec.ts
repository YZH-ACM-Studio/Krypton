import { expect } from 'chai';
import { describe, it } from 'node:test';
import {
    EXAM_PAPER_FINALIZE_GRACE_MS,
    assertExamPaperPoolSatisfiesQuotas,
    canStartExamPaper,
    drawExamPaperPids,
    examPaperPidsForCompletion,
    examPaperPersonalEnd,
    examPaperQuotasEqual,
    examShowsVerdict,
    assignContestProblemScores,
    contestProblemScoreWeight,
    examScoresForPool,
    parseContestProblemScores,
    parseExamAttemptLimit,
    parseExamPassScore,
    canOpenExamPaperAfterFail,
    canRetakeExamPaper,
    examAttemptsUsed,
    examDefinitePaperMax,
    isExamAttemptJudgePending,
    isExamAttemptPassed,
    minProblemsToPass,
    scaleByContestProblemScore,
    isExamPaperFinalized,
    isExamPaperInWindow,
    isExamPaperUnstartedClosed,
    isExamPaperWindowClosed,
    parseExamPaperQuotas,
    projectStudentContestTdoc,
    readExamPaperQuotas,
    resolveExamPaperPids,
    studentContestProblemPids,
} from '../exam-paper';
import type { ProblemKind } from '../problem-kind';

function date(iso: string): Date {
    return new Date(iso);
}

describe('exam paper quotas', () => {
    it('treats a missing field as draw-off and parses exact-key positive quotas', () => {
        expect(readExamPaperQuotas(undefined)).to.equal(null);
        expect(readExamPaperQuotas(null)).to.equal(null);
        expect(parseExamPaperQuotas({ single: 2, multi: 1 })).to.deep.equal({ single: 2, multi: 1 });
        expect(examPaperQuotasEqual({ single: 2 }, { single: 2, multi: undefined })).to.equal(true);
    });

    it('rejects empty, unknown, or non-positive quota objects', () => {
        expect(() => parseExamPaperQuotas({})).to.throw(TypeError, 'exam_paper_quotas_invalid');
        expect(() => parseExamPaperQuotas({ single: 0 })).to.throw(TypeError, 'exam_paper_quotas_invalid');
        expect(() => parseExamPaperQuotas({ single: 1.5 })).to.throw(TypeError, 'exam_paper_quotas_invalid');
        expect(() => parseExamPaperQuotas({ nope: 1 })).to.throw(TypeError);
        expect(() => parseExamPaperQuotas(['single'])).to.throw(TypeError, 'exam_paper_quotas_invalid');
    });

    it('fails closed when a present quota object is illegal instead of treating draw as off', () => {
        expect(() => readExamPaperQuotas({})).to.throw(TypeError, 'exam_paper_quotas_invalid');
        expect(() => resolveExamPaperPids({ pids: [1, 2], examPaperQuotas: { single: 0 } }, null)).to.throw(
            TypeError,
            'exam_paper_quotas_invalid',
        );
    });
});

describe('exam paper clock', () => {
    const window = {
        beginAt: date('2026-09-18T00:00:00.000Z'),
        endAt: date('2026-09-18T03:00:00.000Z'),
    };

    it('matches the inclusive global window when duration is off', () => {
        expect(canStartExamPaper(window, date('2026-09-18T00:00:00.000Z'))).to.equal(true);
        expect(canStartExamPaper(window, date('2026-09-18T03:00:00.000Z'))).to.equal(true);
        expect(canStartExamPaper({ ...window, duration: 0 }, date('2026-09-18T02:00:00.000Z'))).to.equal(true);
        expect(canStartExamPaper(window, date('2026-09-17T23:59:59.000Z'))).to.equal(false);
        expect(canStartExamPaper(window, date('2026-09-18T03:00:00.001Z'))).to.equal(false);
        expect(isExamPaperInWindow(window, null, date('2026-09-18T02:00:00.000Z'))).to.equal(true);
        expect(isExamPaperWindowClosed(window, null, date('2026-09-18T03:01:00.000Z'))).to.equal(false);
        expect(isExamPaperWindowClosed(window, null, date('2026-09-18T03:01:00.001Z'))).to.equal(true);
        expect(EXAM_PAPER_FINALIZE_GRACE_MS).to.equal(60_000);
    });

    it('refuses a start that cannot get a full duration and uses startAt plus duration after start', () => {
        const tdoc = { ...window, duration: 1.5 };
        expect(canStartExamPaper(tdoc, date('2026-09-18T01:30:00.000Z'))).to.equal(true);
        expect(canStartExamPaper(tdoc, date('2026-09-18T01:30:00.001Z'))).to.equal(false);
        const tsdoc = { startAt: date('2026-09-18T01:00:00.000Z') };
        expect(examPaperPersonalEnd(tdoc, tsdoc).toISOString()).to.equal('2026-09-18T02:30:00.000Z');
        expect(isExamPaperInWindow(tdoc, tsdoc, date('2026-09-18T01:30:00.001Z'))).to.equal(true);
        expect(isExamPaperInWindow(tdoc, tsdoc, date('2026-09-18T02:30:00.000Z'))).to.equal(true);
        expect(isExamPaperInWindow(tdoc, tsdoc, date('2026-09-18T02:30:00.001Z'))).to.equal(false);
    });

    it('closes an unstarted paper after begin when a full duration no longer fits', () => {
        const tdoc = { ...window, duration: 1.5 };
        expect(isExamPaperUnstartedClosed(tdoc, null, date('2026-09-17T23:59:59.000Z'))).to.equal(false);
        expect(isExamPaperUnstartedClosed(tdoc, null, date('2026-09-18T01:30:00.000Z'))).to.equal(false);
        expect(isExamPaperUnstartedClosed(tdoc, null, date('2026-09-18T01:30:00.001Z'))).to.equal(true);
        expect(isExamPaperUnstartedClosed(tdoc, { startAt: date('2026-09-18T01:00:00.000Z') }, date('2026-09-18T01:30:00.001Z'))).to.equal(false);
        expect(isExamPaperUnstartedClosed(window, null, date('2026-09-18T03:00:00.000Z'))).to.equal(false);
        expect(isExamPaperUnstartedClosed(window, null, date('2026-09-18T03:00:00.001Z'))).to.equal(true);
    });

    it('treats a valid paperFinalizedAt as finalized', () => {
        expect(isExamPaperFinalized(null)).to.equal(false);
        expect(isExamPaperFinalized({})).to.equal(false);
        expect(isExamPaperFinalized({ paperFinalizedAt: date('invalid') })).to.equal(false);
        expect(isExamPaperFinalized({ paperFinalizedAt: date('2026-09-18T01:00:00.000Z') })).to.equal(true);
        expect(isExamPaperFinalized({ paperFinalizedAt: '2026-09-18T01:00:00.000Z' })).to.equal(true);
    });

    it('hides exam verdicts only when examShowVerdict is false', () => {
        expect(examShowsVerdict({})).to.equal(true);
        expect(examShowsVerdict({ rule: 'acm' })).to.equal(true);
        expect(examShowsVerdict({ rule: 'acm', examShowVerdict: false })).to.equal(true);
        expect(examShowsVerdict({ rule: 'exam' })).to.equal(true);
        expect(examShowsVerdict({ rule: 'exam', examShowVerdict: true })).to.equal(true);
        expect(examShowsVerdict({ rule: 'exam', examShowVerdict: false })).to.equal(false);
    });
});

describe('exam paper draw and resolve', () => {
    const kinds = new Map<number, ProblemKind>([
        [1, 'single'],
        [2, 'single'],
        [3, 'single'],
        [10, 'multi'],
        [11, 'multi'],
    ]);

    it('draws per-kind without replacement and concatenates PROBLEM_KINDS order', () => {
        const drawn = drawExamPaperPids([1, 10, 2, 11, 3], kinds, { single: 2, multi: 1 }, () => 0);
        expect(drawn).to.deep.equal([2, 3, 11]);
    });

    it('refuses a short pool instead of drawing fewer', () => {
        expect(() => assertExamPaperPoolSatisfiesQuotas([1, 10], kinds, { single: 2 })).to.throw(TypeError, 'exam_paper_pool_short');
        expect(() => drawExamPaperPids([1, 99], kinds, { single: 1 }, () => 0)).to.throw(TypeError, 'exam_paper_pool_kind_missing');
    });

    it('resolves the shared pids when draw is off and the frozen paper when draw is on', () => {
        expect(resolveExamPaperPids({ pids: [1, 2, 2] }, null)).to.deep.equal([1, 2]);
        expect(resolveExamPaperPids(
            { pids: [1, 2, 10], examPaperQuotas: { single: 1 } },
            { startAt: date('2026-09-18T01:00:00.000Z'), examPaperPids: [2] },
        )).to.deep.equal([2]);
        expect(() => resolveExamPaperPids({ pids: [1, 2], examPaperQuotas: { single: 1 } }, null)).to.throw(TypeError, 'exam_paper_not_frozen');
        expect(examPaperPidsForCompletion({ pids: [1, 2], examPaperQuotas: { single: 1 } }, { startAt: date('2026-09-18T01:00:00.000Z') })).to.deep.equal([]);
    });

    it('does not treat a started status without a valid frozen paper as a shared pool', () => {
        const tdoc = { pids: [1, 2], examPaperQuotas: { single: 1 } };
        const started = { startAt: date('2026-09-18T01:00:00.000Z') };
        expect(() => resolveExamPaperPids(tdoc, started)).to.throw(TypeError, 'exam_paper_frozen_invalid');
        expect(() => resolveExamPaperPids(tdoc, { ...started, examPaperPids: [1, 2] })).to.throw(TypeError, 'exam_paper_frozen_invalid');
    });

    it('projects student contest tdoc.pids to the frozen paper and hides pool pid keys', () => {
        const tdoc = {
            rule: 'exam',
            pids: [1, 2, 10],
            examPaperQuotas: { single: 1 },
            score: { 1: 5, 2: 5, 10: 5 },
            autoHideProblemPids: [1, 2, 10],
        };
        const frozen = { startAt: date('2026-09-18T01:00:00.000Z'), examPaperPids: [2] };
        expect(studentContestProblemPids(tdoc, null)).to.deep.equal([]);
        expect(projectStudentContestTdoc(tdoc, frozen).pids).to.deep.equal([2]);
        expect(projectStudentContestTdoc(tdoc, frozen).score).to.deep.equal({ 2: 5 });
        expect(projectStudentContestTdoc(tdoc, frozen).autoHideProblemPids).to.deep.equal([2]);
        expect(projectStudentContestTdoc(tdoc, frozen, true)).to.equal(tdoc);
        expect(projectStudentContestTdoc({ rule: 'acm', pids: [1, 2] }, null).pids).to.deep.equal([1, 2]);
    });

    it('reads contest-scoped scores and rejects scores for problems outside the pool', () => {
        expect(contestProblemScoreWeight({}, 12)).to.equal(100);
        expect(contestProblemScoreWeight({ score: { 12: 2 } }, 12)).to.equal(2);
        expect(scaleByContestProblemScore({ score: { 12: 2 } }, 12, 100)).to.equal(2);
        expect(parseContestProblemScores({ 12: 2, 13: 3 })).to.deep.equal({ 12: 2, 13: 3 });
        expect(examScoresForPool({ 12: 2 }, [12, 13])).to.deep.equal({ 12: 2, 13: 100 });
        expect(() => examScoresForPool({ 99: 2 }, [12])).to.throw(TypeError, 'contest_score_pids');
        expect(assignContestProblemScores({ 12: 5 }, [12, 13], [13, 13], 2)).to.deep.equal({ 12: 5, 13: 2 });
        expect(() => assignContestProblemScores({}, [12], [99], 2)).to.throw(TypeError, 'contest_score_pids');
        expect(() => assignContestProblemScores({}, [12], [], 2)).to.throw(TypeError, 'contest_score_pids');
        expect(() => assignContestProblemScores({}, [12], [12], 0)).to.throw(TypeError, 'contest_score_value');
    });
});

describe('exam pass and retake', () => {
    const window = {
        beginAt: date('2026-09-18T00:00:00.000Z'),
        endAt: date('2026-09-18T06:00:00.000Z'),
        duration: 1,
        examPassScore: 60,
        examAttemptLimit: 3,
        pids: [11, 12],
        score: { 11: 40, 12: 30 },
        rule: 'exam',
    };

    it('treats missing pass score as off and missing limit as one attempt', () => {
        expect(parseExamPassScore(undefined)).to.equal(null);
        expect(parseExamPassScore('')).to.equal(null);
        expect(parseExamPassScore(0)).to.equal(null);
        expect(parseExamPassScore(60)).to.equal(60);
        expect(parseExamAttemptLimit(undefined)).to.equal(1);
        expect(parseExamAttemptLimit('')).to.equal(1);
        expect(parseExamAttemptLimit(2)).to.equal(2);
        expect(() => parseExamPassScore(-1)).to.throw(TypeError, 'exam_pass_score_invalid');
        expect(() => parseExamAttemptLimit(0)).to.throw(TypeError, 'exam_attempt_limit_invalid');
    });

    it('counts a legacy finalized paper as one used attempt', () => {
        expect(examAttemptsUsed({})).to.equal(0);
        expect(examAttemptsUsed({ paperFinalizedAt: date('2026-09-18T01:00:00.000Z') })).to.equal(1);
        expect(examAttemptsUsed({ paperFinalizedAt: date('2026-09-18T01:00:00.000Z'), examAttemptsUsed: 2 })).to.equal(2);
    });

    it('passes only after finalize, settled judging, and the weighted score', () => {
        const tsdoc = { startAt: date('2026-09-18T01:00:00.000Z'), paperFinalizedAt: date('2026-09-18T01:30:00.000Z'), score: 60 };
        expect(isExamAttemptPassed(window, tsdoc)).to.equal(true);
        expect(isExamAttemptPassed(window, { ...tsdoc, score: 59 })).to.equal(false);
        expect(isExamAttemptJudgePending({ journal: [{ pid: 11, status: 20 }] })).to.equal(true);
        expect(isExamAttemptJudgePending({ journal: [{ pid: 11, status: 20, manual: true }] })).to.equal(false);
        expect(isExamAttemptPassed(window, { ...tsdoc, journal: [{ pid: 11, status: 20 }] })).to.equal(false);
        expect(isExamAttemptPassed(window, { ...tsdoc, journal: [{ pid: 11, status: 20, manual: true }] })).to.equal(true);
        expect(isExamAttemptPassed({ ...window, examPassScore: undefined }, tsdoc)).to.equal(false);
    });

    it('allows an immediate retake when failed, attempts remain, and a full duration still fits', () => {
        const failed = {
            startAt: date('2026-09-18T01:00:00.000Z'),
            paperFinalizedAt: date('2026-09-18T01:20:00.000Z'),
            score: 40,
            examAttemptsUsed: 1,
        };
        expect(canRetakeExamPaper(window, failed, date('2026-09-18T01:21:00.000Z'))).to.equal(true);
        expect(canRetakeExamPaper(window, { ...failed, score: 60 }, date('2026-09-18T01:21:00.000Z'))).to.equal(false);
        expect(canRetakeExamPaper(window, { ...failed, examAttemptsUsed: 3 }, date('2026-09-18T01:21:00.000Z'))).to.equal(false);
        expect(canRetakeExamPaper(window, failed, date('2026-09-18T05:00:00.001Z'))).to.equal(false);
        expect(canRetakeExamPaper({ ...window, examPassScore: undefined, examAttemptLimit: 3 }, failed, date('2026-09-18T01:21:00.000Z'))).to.equal(false);
        expect(canOpenExamPaperAfterFail({ ...window, examPassScore: undefined, examAttemptLimit: 3 }, failed, date('2026-09-18T01:21:00.000Z'))).to.equal(false);
        const judging = { ...failed, journal: [{ pid: 11, status: 20 }] };
        expect(canRetakeExamPaper(window, judging, date('2026-09-18T01:21:00.000Z'))).to.equal(false);
        expect(canOpenExamPaperAfterFail(window, judging, date('2026-09-18T01:21:00.000Z'))).to.equal(true);
    });

    it('computes the greedy minimum full-score count and a definite paper max', () => {
        expect(minProblemsToPass(60, [40, 30, 20])).to.equal(2);
        expect(minProblemsToPass(90, [40, 30, 20])).to.equal(3);
        expect(minProblemsToPass(100, [40, 30, 20])).to.equal(null);
        expect(examDefinitePaperMax(window, [11, 12])).to.equal(70);
        expect(examDefinitePaperMax(
            { score: { 11: 2, 12: 2, 13: 4 }, examPaperQuotas: { single: 2 } },
            [11, 12, 13],
            new Map([[11, 'single'], [12, 'single'], [13, 'multi']]),
        )).to.equal(4);
        expect(examDefinitePaperMax(
            { score: { 11: 2, 12: 3 }, examPaperQuotas: { single: 1 } },
            [11, 12],
            new Map([[11, 'single'], [12, 'single']]),
        )).to.equal(null);
    });
});
