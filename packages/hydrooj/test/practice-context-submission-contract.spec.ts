import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it } from 'node:test';

const root = resolve(__dirname, '..');

describe('practice context submission contract', () => {
    it('validates the opaque context and every target at the final ProblemSubmit entry before Record creation', () => {
        const handler = readFileSync(resolve(root, 'src/handler/problem.ts'), 'utf8');
        const submitClass = handler.slice(handler.indexOf('export class ProblemSubmitHandler'), handler.indexOf('export class ProblemHackHandler'));
        expect(submitClass).to.include("@param('practiceContextId', Types.ShortString, true)");
        expect(submitClass).to.include('practiceIntegrityService.assertSubmissionContext({');
        expect(submitClass).to.include('assertPracticeContextAccess({');
        expect(submitClass).to.include('setRejectionReason: (reason) =>');
        expect(submitClass).to.include('if (tid || this.tdoc) throw new ValidationError');
        expect(submitClass).to.include('const canonicalContextId = /^[0-9a-f]{24}$/i.test(practiceContextId)');
        const rejectionLog = submitClass.slice(
            submitClass.indexOf('Practice context rejected for submission'),
            submitClass.indexOf('this.rejectPracticeContext(error)'),
        );
        expect(rejectionLog).to.include('canonicalContextId');
        expect(rejectionLog).not.to.include('practiceContextId,');
        expect(submitClass).to.match(/record\.add\([\s\S]*practiceContext,[\s\S]*\)/);
        const finalContextCheck = submitClass.lastIndexOf('resolvePracticeContext(practiceContextId, tid)');
        expect(finalContextCheck).to.be.greaterThan(submitClass.indexOf('parseStructuredRegionSubmission('));
        expect(finalContextCheck).to.be.greaterThan(submitClass.indexOf('storage.put('));
        expect(finalContextCheck).to.be.lessThan(submitClass.indexOf('record.add('));
        expect(submitClass.match(/resolvePracticeContext\(practiceContextId, tid\)/g)).to.have.length(1);
    });

    it('canonicalizes trusted references and rejects contest or non-judge Record callers', () => {
        const record = readFileSync(resolve(root, 'src/model/record.ts'), 'utf8');
        expect(record).to.include("if (args.contest || args.contestContext || !['judge', 'pretest'].includes(args.type))");
        expect(record).to.include('data.practiceContext = assertTrustedPracticeContextBinding(args.practiceContext, { domainId, uid, pid });');
    });

    it('creates completion only from the asynchronous final judge event', () => {
        const completion = readFileSync(resolve(root, 'src/model/contextual-completion.ts'), 'utf8');
        expect(completion).to.include("ctx.on('record/judge'");
        expect(completion).to.include('rdoc.status !== STATUS.STATUS_ACCEPTED');
        expect(completion).to.include('$setOnInsert: completion');
        expect(completion).not.to.include("ctx.on('record/add'");
    });

    it('settles all judge observers, rejects observer failures, and always clears the active task slot', () => {
        const judge = readFileSync(resolve(root, 'src/handler/judge.ts'), 'utf8');
        expect(judge).to.include("await parallelAllSettled('record/judge'");
        expect(judge).to.include('this.reject(error);');
        expect(judge).to.match(/try \{[\s\S]*await context\.waitForOwnedTask\(\);[\s\S]*\} finally \{[\s\S]*delete this\.tasks\[rid\]/);
        expect(judge).to.include('await context.failOwnedTask(error);');
        expect(judge).to.include("if (msg.key === 'end') await t.end(");
    });
});
