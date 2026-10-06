import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { problemSetIdFromSubmission } from '../src/lib/problem-set-submit-enroll';

const setId = '68c298e8b3dd84fe85f5de1f';
const courseId = '66b800000000000000000021';

describe('problem set enrollment from submission', () => {
    it('enrolls a formal submission entered from a problem set', () => {
        expect(problemSetIdFromSubmission({
            pretest: false,
            trusted: null,
            entry: { containerKind: 'problemSet', containerId: setId },
        })).to.equal(setId);
        expect(problemSetIdFromSubmission({
            pretest: false,
            trusted: { containerKind: 'problemSet', containerId: setId, mode: 'student' },
            entry: null,
        })).to.equal(setId);
    });

    it('does not enroll pretest, preview, course entry, or a bare problem submission', () => {
        const entry = { containerKind: 'problemSet' as const, containerId: setId, mode: 'student' as const };
        expect(problemSetIdFromSubmission({ pretest: true, trusted: null, entry })).to.equal(null);
        expect(problemSetIdFromSubmission({
            pretest: false,
            trusted: null,
            entry: { ...entry, mode: 'preview' },
        })).to.equal(null);
        expect(problemSetIdFromSubmission({
            pretest: false,
            trusted: { containerKind: 'course', containerId: courseId, mode: 'student' },
            entry,
        })).to.equal(null);
        expect(problemSetIdFromSubmission({ pretest: false, trusted: null, entry: null })).to.equal(null);
    });

    it('rejects a problem-set entry whose id is not canonical', () => {
        expect(() => problemSetIdFromSubmission({
            pretest: false,
            trusted: null,
            entry: { containerKind: 'problemSet', containerId: 'not-an-id' },
        })).to.throw(TypeError, /enrollment id is invalid/);
    });

    it('wires the decision into the formal submit path and keeps the set identity on the submit URL', () => {
        const handler = readFileSync(resolve(__dirname, '../src/handler/problem.ts'), 'utf8');
        const submit = handler.slice(handler.indexOf('export class ProblemSubmitHandler'), handler.indexOf('export class ProblemHackHandler'));
        const recordAdd = submit.indexOf('const rid = await record.add(');
        const enroll = submit.indexOf('await this.recordProblemSetEnrollment(pretest, practiceContext)');
        expect(recordAdd).to.be.greaterThan(0);
        expect(enroll).to.be.greaterThan(recordAdd);
        const detail = readFileSync(resolve(__dirname, '../../ui-next/src/pages/problem-detail.tsx'), 'utf8');
        const submitPage = readFileSync(resolve(__dirname, '../../ui-next/src/pages/problem-submit.tsx'), 'utf8');
        expect(detail).to.include('practiceProblemEntryUrl(`${problemUrl}/submit`, practiceIntegrity.entry, practiceIntegrity.mode === \'preview\')');
        expect(submitPage).to.include('practiceProblemEntryUrl(`${problemUrl}/submit`, practiceIntegrity.entry, practiceIntegrity.mode === \'preview\')');
    });
});
