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
});
