import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { isCourseExamCompleteFromStatus } from '../src/lib/course-exam-complete';

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
        expect(isCourseExamCompleteFromStatus({ rule: 'exam', pids: [1] }, { paperFinalizedAt: new Date('invalid') })).to.equal(false);
        expect(isCourseExamCompleteFromStatus({ rule: 'exam', pids: [1] }, null)).to.equal(false);
        expect(isCourseExamCompleteFromStatus(null, { paperFinalizedAt: new Date() })).to.equal(false);
    });

    it('writes paperFinalizedAt from finalizePaperForUser after creating records', () => {
        const source = readHydrooj('src/handler/paper.ts');
        const start = source.indexOf('export async function finalizePaperForUser');
        const end = source.indexOf('class PaperFinalizeHandler');
        expect(start).to.be.at.least(0);
        expect(end).to.be.greaterThan(start);
        const finalize = source.slice(start, end);
        const setAt = finalize.indexOf('paperFinalizedAt');
        const updateAt = finalize.indexOf('contest.updateStatus');
        const returnAt = finalize.lastIndexOf('return rids');
        expect(setAt, 'finalize must persist paperFinalizedAt').to.be.at.least(0);
        expect(finalize).to.include('contest.setStatus');
        expect(updateAt).to.be.at.least(0);
        expect(setAt).to.be.greaterThan(updateAt);
        expect(returnAt).to.be.greaterThan(setAt);
    });

    it('exports the completion helpers used by file-collect', () => {
        const api = readHydrooj('src/plugin-api.ts');
        expect(api).to.include("export { tryReadStoredCourseExam } from './lib/course-exam'");
        expect(api).to.include("export { isCourseExamCompleteFromStatus } from './lib/course-exam-complete'");
        expect(api).to.include("export { hasCompletedCourseExam } from './lib/course-exam-gate'");
        expect(readHydrooj('src/lib/course-exam.ts')).to.include('export function tryReadStoredCourseExam');
        expect(readHydrooj('src/lib/course-exam-gate.ts')).to.include('export async function hasCompletedCourseExam');
    });
});
