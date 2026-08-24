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
        const cancellation = readSrc('src/model/record-score-cancellation.ts');
        expect(cancellation).to.include('if (rdoc.virtualAttemptId)');
        expect(cancellation).to.include('virtualContest.updateStatus');
        expect(cancellation).to.include('if (rdoc.virtualAttemptId) return null');
        const model = readSrc('src/model/virtual-contest.ts');
        expect(model).to.include('const current = await this.loadAttempt(input.domainId, input.attemptId)');
        expect(model).to.include('ridCreatedDuringVirtualAttempt');
        expect(model).to.include("status: 'ended' as const, endedAt: now");
        expect(model).to.include('left.createdAt.getTime() - right.createdAt.getTime()');
        expect(records).to.include('virtualContestActive: true');
        expect(records).to.include('virtualAttemptOpen');
        const submit = readSrc('src/handler/problem.ts');
        expect(submit).to.include('!this.virtualAttempt && (!Array.isArray(this.tdoc.pids) || !this.tdoc.pids.includes(this.pdoc.docId))');
        const board = readSrc('src/handler/virtual-contest.ts');
        expect(board).to.include('virtualContestSnapshotFingerprint');
        expect(board).to.include('虚拟参赛快照不一致');
    });

    it('keeps VP on ordinary browser routes without Vigil session creation', () => {
        const handler = readSrc('src/handler/virtual-contest.ts');
        expect(handler).to.include("ctx.Route('contest_virtual', '/contest/:tid/virtual'");
        expect(handler).not.to.include('vigil');
        expect(handler).not.to.include('client_required');
    });
});
