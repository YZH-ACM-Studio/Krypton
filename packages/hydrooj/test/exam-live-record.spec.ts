import { describe, it } from 'node:test';
import { expect } from 'chai';
import { STATUS } from '@hydrooj/common';
import { projectLiveExamRecord } from '../src/lib/exam-live-record';

const end = new Date(Date.now() + 60 * 60 * 1000);
const exam = { rule: 'exam' as const, endAt: end, examShowVerdict: false };

describe('live exam record projection', () => {
    it('keeps programming test points while objective verdicts are hidden', () => {
        const record = {
            status: STATUS.STATUS_WRONG_ANSWER,
            score: 0,
            testCases: [{ id: 1, status: STATUS.STATUS_WRONG_ANSWER }],
            compilerTexts: ['ok'],
        };
        const visible = projectLiveExamRecord(exam, record, 'programming');
        expect(visible.status).to.equal(STATUS.STATUS_WRONG_ANSWER);
        expect(visible.testCases).to.have.length(1);
        const hidden = projectLiveExamRecord(exam, record, 'single');
        expect(hidden.status).to.equal(STATUS.STATUS_WAITING);
        expect(hidden.testCases).to.equal(undefined);
        expect(hidden.score).to.equal(undefined);
    });

    it('shows every kind when the exam allows verdicts', () => {
        const record = { status: STATUS.STATUS_WRONG_ANSWER, score: 0, testCases: [{ id: 1 }] };
        const visible = projectLiveExamRecord({ ...exam, examShowVerdict: true }, record, 'single');
        expect(visible.status).to.equal(STATUS.STATUS_WRONG_ANSWER);
        expect(visible.testCases).to.have.length(1);
    });
});
