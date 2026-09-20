import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
    canStartExamPaper,
    isExamPaperUnstartedClosed,
    isExamPaperWindowClosed,
} from '../src/lib/exam-paper';
import {
    COURSE_EXAM_FINALIZE_GRACE_MS,
    buildCourseExamCompletionResolution,
    isCourseExamCompleteFromStatus,
    isCourseExamEnded,
    isCourseExamWindowClosed,
    shouldSettleCourseExam,
} from '../src/lib/course-exam-complete';

const hydroojRoot = resolve(__dirname, '..');

function readHydrooj(relative: string) {
    return readFileSync(resolve(hydroojRoot, relative), 'utf8');
}

describe('course exam completion', () => {
    it('treats a valid paperFinalizedAt as complete', () => {
        expect(isCourseExamCompleteFromStatus(
            { rule: 'exam', pids: [1, 2] },
            { paperFinalizedAt: new Date('2026-09-16T00:00:00.000Z'), journal: [] },
        )).to.equal(true);
    });

    it('requires a settled passing score when examPassScore is set', () => {
        const tdoc = { rule: 'exam', pids: [1, 2], examPassScore: 60 };
        const finalized = { paperFinalizedAt: new Date('2026-09-16T00:00:00.000Z'), journal: [], score: 60 };
        expect(isCourseExamCompleteFromStatus(tdoc, finalized)).to.equal(true);
        expect(isCourseExamCompleteFromStatus(tdoc, { ...finalized, score: 59 })).to.equal(false);
        expect(isCourseExamCompleteFromStatus(tdoc, { ...finalized, journal: [{ pid: 1, status: 20 }] })).to.equal(false);
        expect(isCourseExamCompleteFromStatus(tdoc, { ...finalized, journal: [{ pid: 1, status: 20, manual: true }] })).to.equal(true);
        expect(isCourseExamCompleteFromStatus(tdoc, { journal: [{ pid: 1 }, { pid: 2 }], score: 80 })).to.equal(false);
        expect(isCourseExamCompleteFromStatus({ rule: 'exam', pids: [1, 2] }, { ...finalized, score: 0 })).to.equal(true);
    });

    it('falls back to journal covering every exam pid when paperFinalizedAt is missing', () => {
        expect(isCourseExamCompleteFromStatus(
            { rule: 'exam', pids: [11, 12] },
            { journal: [{ pid: 12 }, { pid: 11, status: 1 }] },
        )).to.equal(true);
        expect(isCourseExamCompleteFromStatus(
            { rule: 'exam', pids: [11, 12] },
            { journal: [{ pid: 11 }] },
        )).to.equal(false);
    });

    it('fails closed for non-exam contests, empty papers, invalid dates, and missing status', () => {
        expect(isCourseExamCompleteFromStatus({ rule: 'oi', pids: [1] }, { paperFinalizedAt: new Date() })).to.equal(false);
        expect(isCourseExamCompleteFromStatus({ rule: 'exam', pids: [] }, { journal: [{ pid: 1 }] })).to.equal(false);
        expect(isCourseExamCompleteFromStatus({ rule: 'exam', pids: [] }, { paperFinalizedAt: new Date() })).to.equal(false);
        expect(isCourseExamCompleteFromStatus({ rule: 'exam', pids: [1] }, { paperFinalizedAt: new Date('invalid') })).to.equal(false);
        expect(isCourseExamCompleteFromStatus({ rule: 'exam', pids: [1] }, null)).to.equal(false);
        expect(isCourseExamCompleteFromStatus(null, { paperFinalizedAt: new Date() })).to.equal(false);
    });

    it('treats the window as closed only after endAt plus the shared grace', () => {
        const endAt = new Date('2026-09-17T00:00:00.000Z');
        expect(COURSE_EXAM_FINALIZE_GRACE_MS).to.equal(60_000);
        expect(isCourseExamWindowClosed(endAt, new Date(endAt.getTime() + COURSE_EXAM_FINALIZE_GRACE_MS))).to.equal(false);
        expect(isCourseExamWindowClosed(endAt, new Date(endAt.getTime() + COURSE_EXAM_FINALIZE_GRACE_MS + 1))).to.equal(true);
        expect(isCourseExamWindowClosed(undefined, new Date('2026-09-17T01:00:00.000Z'))).to.equal(false);
        expect(isCourseExamWindowClosed(new Date('invalid'), new Date('2026-09-17T01:00:00.000Z'))).to.equal(false);
        expect(isCourseExamEnded(endAt, endAt)).to.equal(true);
        expect(isCourseExamEnded(endAt, new Date(endAt.getTime() - 1))).to.equal(false);
    });

    it('does not treat a journal covering the pool as complete when draw is on and personal pids differ', () => {
        expect(isCourseExamCompleteFromStatus(
            { rule: 'exam', pids: [11, 12], examPaperQuotas: { single: 1 } },
            { examPaperPids: [12], journal: [{ pid: 11 }] },
        )).to.equal(false);
        expect(isCourseExamCompleteFromStatus(
            { rule: 'exam', pids: [11, 12], examPaperQuotas: { single: 1 } },
            { journal: [{ pid: 11 }, { pid: 12 }] },
        )).to.equal(false);
        expect(isCourseExamCompleteFromStatus(
            { rule: 'exam', pids: [11, 12], examPaperQuotas: { single: 1 } },
            { examPaperPids: [12], journal: [{ pid: 12 }] },
        )).to.equal(true);
        expect(isCourseExamCompleteFromStatus(
            { rule: 'exam', pids: [11, 12], examPaperQuotas: { single: 1 } },
            { examPaperPids: [12], paperFinalizedAt: new Date('2026-09-16T00:00:00.000Z'), journal: [] },
        )).to.equal(true);
    });

    it('treats duration too-late unattended as ended while the global window is still open', () => {
        const tdoc = {
            beginAt: new Date('2026-09-18T00:00:00.000Z'),
            endAt: new Date('2026-09-18T03:00:00.000Z'),
            duration: 1.5,
        };
        const now = new Date('2026-09-18T01:30:00.001Z');
        const ended = isCourseExamEnded(tdoc.endAt, now) || isExamPaperUnstartedClosed(tdoc, null, now);
        expect(canStartExamPaper(tdoc, now)).to.equal(false);
        expect(isCourseExamEnded(tdoc.endAt, now)).to.equal(false);
        expect(ended).to.equal(true);
        expect(buildCourseExamCompletionResolution({
            complete: false,
            attended: false,
            windowClosed: isExamPaperWindowClosed(tdoc, null, now),
            ended,
            contestId: '64a000000000000000000801',
        })).to.deep.equal({
            complete: false,
            attended: false,
            windowClosed: false,
            lockKind: 'never_attended_closed',
        });
        expect(isExamPaperUnstartedClosed(tdoc, null, new Date('2026-09-17T23:59:59.000Z'))).to.equal(false);
        expect(isCourseExamEnded(tdoc.endAt, tdoc.endAt) || isExamPaperUnstartedClosed(tdoc, null, tdoc.endAt)).to.equal(true);
        expect(readHydrooj('src/lib/course-exam-gate.ts')).to.include('isCourseExamEnded(tdoc.endAt, now)');
        expect(readHydrooj('src/lib/course-exam-gate.ts')).to.include('isExamPaperUnstartedClosed(tdoc, tsdoc, now)');
        expect(readHydrooj('src/lib/course-exam-gate.ts')).to.include('isExamPaperStarted(tsdoc)');
    });

    it('closes the settle window from personal end when started with duration', () => {
        const tdoc = {
            beginAt: new Date('2026-09-18T00:00:00.000Z'),
            endAt: new Date('2026-09-18T03:00:00.000Z'),
            duration: 1.5,
        };
        const tsdoc = { startAt: new Date('2026-09-18T01:00:00.000Z') };
        const personalClosed = new Date('2026-09-18T02:31:00.001Z');
        expect(isCourseExamWindowClosed(tdoc.endAt, personalClosed)).to.equal(false);
        expect(isExamPaperWindowClosed(tdoc, tsdoc, new Date('2026-09-18T02:31:00.000Z'))).to.equal(false);
        expect(isExamPaperWindowClosed(tdoc, tsdoc, personalClosed)).to.equal(true);
        expect(readHydrooj('src/lib/course-exam-gate.ts')).to.include('isExamPaperWindowClosed(tdoc, tsdoc, now)');
        expect(readHydrooj('src/lib/course-exam-gate.ts')).to.include('examPaperPidsForCompletion');
    });

    it('allows settle only when incomplete, already attended, started, exam-rule, has pids, and the window is closed', () => {
        const ready = { complete: false, attend: true, started: true, windowClosed: true, examRule: true, hasPids: true };
        expect(shouldSettleCourseExam(ready)).to.equal(true);
        expect(shouldSettleCourseExam({ ...ready, complete: true })).to.equal(false);
        expect(shouldSettleCourseExam({ ...ready, attend: false })).to.equal(false);
        expect(shouldSettleCourseExam({ ...ready, started: false })).to.equal(false);
        expect(shouldSettleCourseExam({ ...ready, windowClosed: false })).to.equal(false);
        expect(shouldSettleCourseExam({ ...ready, examRule: false })).to.equal(false);
        expect(shouldSettleCourseExam({ ...ready, hasPids: false })).to.equal(false);
        expect(shouldSettleCourseExam({ ...ready, finalized: true })).to.equal(false);
    });

    it('builds lockKind and examHref from completion facts without IO', () => {
        const contestId = '64a000000000000000000801';
        expect(buildCourseExamCompletionResolution({
            missingContest: true,
            complete: false,
            attended: false,
            windowClosed: false,
            contestId,
        })).to.deep.equal({
            complete: false,
            attended: false,
            windowClosed: false,
            lockKind: 'missing_contest',
        });
        expect(buildCourseExamCompletionResolution({
            complete: true,
            attended: true,
            windowClosed: true,
            contestId,
        })).to.deep.equal({
            complete: true,
            attended: true,
            windowClosed: true,
            lockKind: 'none',
        });
        expect(buildCourseExamCompletionResolution({
            complete: false,
            attended: true,
            windowClosed: false,
            contestId,
        })).to.deep.equal({
            complete: false,
            attended: true,
            windowClosed: false,
            examHref: `/exam-mode/${contestId}`,
            lockKind: 'open',
        });
        expect(buildCourseExamCompletionResolution({
            complete: false,
            attended: false,
            windowClosed: true,
            contestId,
        })).to.deep.equal({
            complete: false,
            attended: false,
            windowClosed: true,
            lockKind: 'never_attended_closed',
        });
        expect(buildCourseExamCompletionResolution({
            complete: false,
            attended: true,
            windowClosed: true,
            contestId,
        })).to.deep.equal({
            complete: false,
            attended: true,
            windowClosed: true,
            lockKind: 'closed_incomplete',
        });
        expect(buildCourseExamCompletionResolution({
            complete: false,
            attended: false,
            windowClosed: false,
            ended: true,
            contestId,
        })).to.deep.equal({
            complete: false,
            attended: false,
            windowClosed: false,
            lockKind: 'never_attended_closed',
        });
        expect(buildCourseExamCompletionResolution({
            complete: false,
            attended: true,
            windowClosed: false,
            ended: true,
            contestId,
        })).to.deep.equal({
            complete: false,
            attended: true,
            windowClosed: false,
            examHref: `/exam-mode/${contestId}`,
            lockKind: 'open',
        });
        expect(buildCourseExamCompletionResolution({
            complete: false,
            attended: false,
            windowClosed: false,
            contestId,
        })).to.deep.equal({
            complete: false,
            attended: false,
            windowClosed: false,
            examHref: `/exam-mode/${contestId}`,
            lockKind: 'open',
        });
    });

    it('writes paperFinalizedAt from finalizePaperForUser after creating records', () => {
        const source = readHydrooj('src/handler/paper.ts');
        const start = source.indexOf('export async function finalizePaperForUser');
        const end = source.indexOf('class PaperFinalizeHandler');
        expect(start).to.be.at.least(0);
        expect(end).to.be.greaterThan(start);
        const finalize = source.slice(start, end);
        const updateAt = finalize.indexOf('contest.updateStatus');
        const writeAt = finalize.lastIndexOf('findOneAndUpdate');
        const returnAt = finalize.lastIndexOf('return rids');
        expect(finalize, 'already-finalized papers must not mint records').to.match(/paperFinalizedAt instanceof Date[\s\S]*return \[\]/);
        expect(finalize).to.include('examAttemptsUsed');
        expect(finalize).to.include("paperFinalizedAt: { $exists: false }");
        expect(updateAt).to.be.at.least(0);
        expect(finalize).to.not.include('updateStatus(domainId, tid, uid, rid, 0)');
        expect(finalize).to.include('record.get(domainId, rid)');
        expect(finalize).to.include('updateStatus(domainId, tid, uid, rid, rdoc.pid, rdoc)');
        expect(writeAt, 'finalize must persist paperFinalizedAt').to.be.greaterThan(updateAt);
        expect(returnAt).to.be.greaterThan(writeAt);
    });

    it('exports the completion helpers used by file-collect', () => {
        const api = readHydrooj('src/plugin-api.ts');
        expect(api).to.include("export { tryReadStoredCourseExam } from './lib/course-exam'");
        expect(api).to.include('isCourseExamCompleteFromStatus');
        expect(api).to.include('isCourseExamEnded');
        expect(api).to.include("from './lib/course-exam-complete'");
        expect(api).to.include('resolveCourseExamCompletion');
        expect(api).to.include("export { hasCompletedCourseExam, resolveCourseExamCompletion } from './lib/course-exam-gate'");
        expect(readHydrooj('src/lib/course-exam.ts')).to.include('export function tryReadStoredCourseExam');
        expect(readHydrooj('src/lib/course-exam-gate.ts')).to.include('export async function hasCompletedCourseExam');
        expect(readHydrooj('src/lib/course-exam-gate.ts')).to.include('export async function resolveCourseExamCompletion');
    });
});
