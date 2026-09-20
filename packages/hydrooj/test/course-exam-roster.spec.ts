import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { STATUS } from '@hydrooj/common';
import {
    courseExamRosterFact,
    courseExamRosterFactsByUid,
    courseExamRosterMeta,
} from '../src/lib/course-exam-roster';
import { assemblePracticeRosterMembers } from '../src/lib/practice-roster';

const hydroojRoot = resolve(__dirname, '..');

function readHydrooj(relative: string) {
    return readFileSync(resolve(hydroojRoot, relative), 'utf8');
}

const finalizedAt = new Date('2026-09-20T12:00:00.000Z');

describe('course exam roster facts', () => {
    it('does not invent a score before the paper is submitted', () => {
        expect(courseExamRosterFact({ rule: 'exam', examPassScore: 60 }, null)).to.deep.equal({
            state: 'not_started',
            attemptsUsed: 0,
        });
        expect(courseExamRosterFact({ rule: 'exam' }, { startAt: new Date('2026-09-20T11:00:00.000Z'), score: 0 })).to.deep.equal({
            state: 'in_progress',
            attemptsUsed: 0,
        });
    });

    it('exposes the stored attempt score only after finalize and does not use the pool', () => {
        const tdoc = { rule: 'exam', pids: [1, 2, 3], examPaperQuotas: { single: 1 }, examPassScore: 60 };
        expect(courseExamRosterFact(tdoc, {
            startAt: new Date('2026-09-20T11:00:00.000Z'),
            paperFinalizedAt: finalizedAt,
            examPaperPids: [2],
            score: 92,
        })).to.deep.equal({
            state: 'finalized',
            attemptsUsed: 1,
            score: 92,
            passed: true,
        });
        expect(courseExamRosterFact(tdoc, {
            paperFinalizedAt: finalizedAt,
            score: 50,
        })).to.include({ state: 'finalized', score: 50, passed: false });
    });

    it('keeps judging separate from pass/fail and omits passed without a pass line', () => {
        expect(courseExamRosterFact({ rule: 'exam', examPassScore: 60 }, {
            paperFinalizedAt: finalizedAt,
            score: 80,
            journal: [{ pid: 1, status: STATUS.STATUS_JUDGING }],
        })).to.deep.equal({
            state: 'judging',
            attemptsUsed: 1,
            score: 80,
        });
        expect(courseExamRosterFact({ rule: 'exam' }, {
            paperFinalizedAt: finalizedAt,
            score: 40,
        })).to.deep.equal({
            state: 'finalized',
            attemptsUsed: 1,
            score: 40,
        });
    });

    it('projects every roster member and rejects malformed status uids', () => {
        const facts = courseExamRosterFactsByUid(
            { rule: 'exam', examPassScore: 60, title: '实验室安全准入考试' },
            [8, 9],
            [{ uid: 8, paperFinalizedAt: finalizedAt, score: 98 }],
        );
        expect(facts.get(8)).to.include({ state: 'finalized', score: 98, passed: true });
        expect(facts.get(9)).to.deep.equal({ state: 'not_started', attemptsUsed: 0 });
        expect(() => courseExamRosterFactsByUid({ rule: 'exam' }, [8], [{ uid: 1, score: 10 }])).to.throw(TypeError, 'invalid course exam roster status uid');
        expect(courseExamRosterMeta({ title: '实验室安全准入考试', examPassScore: 60, examAttemptLimit: 2 })).to.deep.equal({
            title: '实验室安全准入考试',
            passScore: 60,
            attemptLimit: 2,
        });
    });

    it('attaches exam facts to the practice roster without filling missing members', () => {
        const members = assemblePracticeRosterMembers({
            memberUids: [8],
            udict: { 8: { uname: 'alice' } },
            students: { 8: { realName: '爱丽丝', studentId: '20260001', groupIds: [] } },
            groupNameById: new Map(),
            completedPidsByUid: new Map(),
            total: 0,
            examFactsByUid: new Map([[8, { state: 'finalized', attemptsUsed: 1, score: 94, passed: true }]]),
        });
        expect(members[0].done).to.equal(0);
        expect(members[0].total).to.equal(0);
        expect(members[0].exam).to.deep.equal({ state: 'finalized', attemptsUsed: 1, score: 94, passed: true });
        expect(() => assemblePracticeRosterMembers({
            memberUids: [8, 9],
            udict: {},
            students: {},
            groupNameById: new Map(),
            completedPidsByUid: new Map(),
            total: 0,
            examFactsByUid: new Map([[8, { state: 'not_started', attemptsUsed: 0 }]]),
        })).to.throw(TypeError, 'missing course exam roster fact for uid=9');
    });

    it('loads exam statuses for the course roster and never uses the exam pool as chapter problems', () => {
        const handler = readHydrooj('src/handler/course.ts');
        expect(handler).to.include('loadCourseExamRoster');
        expect(handler).to.include('courseExamRosterFactsByUid');
        expect(handler).to.include('examFactsByUid');
        expect(handler).to.include('rosterExam');
        expect(handler).to.include('getMultiStatus(domainId, { docId: examDoc.docId, uid: { $in: [...memberUids] } })');
        expect(handler).to.match(/const rosterPids = pids\.filter/);
        expect(handler).not.to.match(/rosterPids[\s\S]{0,80}examPaperPids|rosterPids[\s\S]{0,80}examDoc\.pids/);
    });
});
