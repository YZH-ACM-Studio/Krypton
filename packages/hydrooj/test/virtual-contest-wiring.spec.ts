import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';

function readSrc(relative: string) {
    return readFileSync(resolve(__dirname, '..', relative), 'utf8');
}

describe('P4 virtual contest wiring contracts', () => {
    it('does not send VP records into official contest status, rating, or whole-problem rejudge', () => {
        const judge = readSrc('src/handler/judge.ts');
        expect(judge).to.include('rdoc.virtualAttemptId');
        expect(judge).to.include('virtualContest.updateStatus');
        expect(judge).to.match(/if \(rdoc\.virtualAttemptId\) \{[\s\S]*\} else if \(rdoc\.contest\) await contest\.updateStatus/);
        const rejudge = readSrc('src/handler/problem.ts');
        expect(rejudge).to.include('virtualAttemptId: { $exists: false }');
        const add = readSrc('src/model/record.ts');
        expect(add).to.include('if (args.contest || args.contestContext || args.practiceContext) throw new ValidationError(\'virtualAttemptId\')');
        expect(judge).to.include('if (rdoc.contest || rdoc.virtualAttemptId) return');
        expect(judge).to.include('virtualAttemptId: { $exists: false }');
        const records = readSrc('src/handler/record.ts');
        expect(records).to.include("virtualAttemptId: { $exists: false }");
        expect(records).to.include('assertVirtualContestRecordAccess');
        expect(records).to.include('确认后才能重测虚拟参赛记录');
        const judgeops = readSrc('src/handler/judgeops.ts');
        expect(judgeops).to.include('virtualAttemptId: { $exists: false }');
        const practice = readSrc('src/lib/contest-problem-status.ts');
        expect(practice).to.include('virtualAttemptId: { $exists: false }');
    });

    it('keeps VP on ordinary browser routes without Vigil session creation', () => {
        const handler = readSrc('src/handler/virtual-contest.ts');
        expect(handler).to.include("ctx.Route('contest_virtual', '/contest/:tid/virtual'");
        expect(handler).not.to.include('vigil');
        expect(handler).not.to.include('client_required');
    });
});
