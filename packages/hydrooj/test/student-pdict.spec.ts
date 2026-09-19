import { expect } from 'chai';
import { describe, it } from 'node:test';
import { ValidationError } from '../src/error';
import { compileProgrammingStatement, emptyProgrammingStatement } from '../src/lib/programming-statement';
import { projectStudentPdoc } from '../src/lib/student-pdict';

function completeStatement() {
    return {
        ...emptyProgrammingStatement(),
        background: { state: 'absent' as const, content: '' },
        description: { state: 'present' as const, content: '计算答案。' },
        input: { state: 'present' as const, content: '输入一个整数。' },
        output: { state: 'absent' as const, content: '' },
        examples: { state: 'absent' as const, items: [] },
        hints: { state: 'absent' as const, content: '' },
    };
}

describe('projectStudentPdoc', () => {
    it('replaces structured canonical with the client view and strips answers', () => {
        const statement = completeStatement();
        const pdoc = projectStudentPdoc({
            docId: 7,
            statementFormat: 'structured-v1',
            programmingStatement: statement,
            content: compileProgrammingStatement(statement),
            origStat: { ac: 9 },
            reactions: { like: 1 },
            antiAiMarkers: [{ id: 'm1' }],
            config: { type: 'default', answers: { q1: 'secret' }, time: '1s', memory: '256m' },
        });
        expect(pdoc.programmingStatement).to.equal(undefined);
        expect(pdoc.origStat).to.equal(undefined);
        expect(pdoc.reactions).to.equal(undefined);
        expect(pdoc.antiAiMarkers).to.equal(undefined);
        expect((pdoc.config as { answers?: unknown }).answers).to.equal(undefined);
        expect(pdoc.programmingStatementView).to.include({ schemaVersion: 1 });
        expect((pdoc.programmingStatementView as { description: { content: string } }).description.content).to.equal('计算答案。');
    });

    it('strips leftover canonical from legacy statements without inventing a view', () => {
        const pdoc = projectStudentPdoc({
            docId: 8,
            content: '# 题',
            programmingStatement: completeStatement(),
            config: { type: 'default' },
        });
        expect(pdoc.programmingStatement).to.equal(undefined);
        expect(pdoc.programmingStatementView).to.equal(undefined);
        expect(pdoc.content).to.equal('# 题');
    });

    it('fails closed when the compiled projection does not match content', () => {
        expect(() => projectStudentPdoc({
            statementFormat: 'structured-v1',
            programmingStatement: completeStatement(),
            content: 'stale markdown',
            config: { type: 'default' },
        })).to.throw(ValidationError);
    });
});
