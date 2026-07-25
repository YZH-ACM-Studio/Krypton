import { expect } from 'chai';
import { describe, it } from 'node:test';
import {
    assertLegacyProgrammingStatementFingerprint,
    assertProgrammingStatementComplete,
    assertProgrammingStatementProjection,
    compileProgrammingStatement,
    emptyProgrammingStatement,
    normalizeProgrammingStatement,
    previewLegacyProgrammingStatement,
    programmingStatementClientView,
} from '../src/lib/programming-statement';

function completeStatement() {
    return {
        ...emptyProgrammingStatement(),
        background: { state: 'absent' as const, content: '' },
        description: { state: 'present' as const, content: '计算答案。' },
        input: { state: 'present' as const, content: '输入一个整数。' },
        output: { state: 'absent' as const, content: '' },
        examples: {
            state: 'present' as const,
            items: [
                { input: '1', inputEmpty: false, output: '2', outputEmpty: false, note: '第一组。' },
                { input: '', inputEmpty: true, output: 'done', outputEmpty: false, note: '' },
            ],
        },
        hints: { state: 'absent' as const, content: '' },
    };
}

describe('programming statement canonical protocol', () => {
    it('creates a fully undecided shell without guessing author intent', () => {
        const statement = emptyProgrammingStatement();
        expect(statement.description.state).to.equal('undecided');
        expect(statement.examples).to.deep.equal({ state: 'undecided', items: [] });
    });

    it('rejects unknown schema, locale, fields, dormant absent content, and absent descriptions', () => {
        expect(() => normalizeProgrammingStatement({ ...emptyProgrammingStatement(), schemaVersion: 2 })).to.throw(/schema/);
        expect(() => normalizeProgrammingStatement({ ...emptyProgrammingStatement(), locale: 'en' })).to.throw(/locale/);
        expect(() => normalizeProgrammingStatement({ ...emptyProgrammingStatement(), order: [] })).to.throw(/unsupported fields/);
        expect(() =>
            normalizeProgrammingStatement({
                ...emptyProgrammingStatement(),
                input: { state: 'absent', content: 'hidden' },
            }),
        ).to.throw(/hidden content/);
        expect(() =>
            normalizeProgrammingStatement({
                ...emptyProgrammingStatement(),
                description: { state: 'absent', content: '' },
            }),
        ).to.throw(/description/);
    });

    it('enforces explicit sample emptiness without allowing two empty sides', () => {
        expect(() =>
            normalizeProgrammingStatement({
                ...completeStatement(),
                examples: {
                    state: 'present',
                    items: [{ input: '', inputEmpty: false, output: '1', outputEmpty: false, note: '' }],
                },
            }),
        ).to.throw(/input must have content/);
        expect(() =>
            normalizeProgrammingStatement({
                ...completeStatement(),
                examples: {
                    state: 'present',
                    items: [{ input: '', inputEmpty: true, output: '', outputEmpty: true, note: '' }],
                },
            }),
        ).to.throw(/both sides empty/);
    });

    it('compiles deterministic Hydro-compatible paired sample fences in array order', () => {
        const markdown = compileProgrammingStatement(completeStatement());
        expect(markdown).to.include('## 题目描述\n\n计算答案。');
        expect(markdown).to.include('## 输出格式\n\n本题无输出。');
        expect(markdown).to.include('```input1\n1\n```\n\n```output1\n2\n```');
        expect(markdown).to.include('```input2\n\n```\n\n```output2\ndone\n```');
        expect(markdown.indexOf('input1')).to.be.lessThan(markdown.indexOf('input2'));
    });

    it('blocks publication until every section and live time/memory config are complete', () => {
        expect(() => assertProgrammingStatementComplete(emptyProgrammingStatement(), { time: '1s', memory: '256m' })).to.throw(/unresolved/);
        expect(() => assertProgrammingStatementComplete(completeStatement(), {})).to.throw(/time and memory/);
        expect(() => assertProgrammingStatementComplete(completeStatement(), { time: '1foo', memory: '256m' })).to.throw(/time and memory/);
        expect(() => assertProgrammingStatementComplete(completeStatement(), { time: '1s', memory: '256garbage' })).to.throw(/time and memory/);
        expect(assertProgrammingStatementComplete(completeStatement(), { time: '1s', memory: '256m' })).to.deep.equal(completeStatement());
        expect(() =>
            assertProgrammingStatementProjection(completeStatement(), { time: '1s', memory: '256m' }, 'not the compiled statement'),
        ).to.throw(/projection/);
    });

    it('serializes only visible sections and live limits', () => {
        const view = programmingStatementClientView(completeStatement(), { time: '1s', memory: '256m' });
        expect(view).not.to.have.property('background');
        expect(view).not.to.have.property('hints');
        expect(view.output).to.deep.equal({ state: 'absent', content: '' });
        expect(view.examples?.items).to.have.length(2);
        expect(view.limits.complete).to.equal(true);
    });

    it('converts only exact headings and strict sequential input/output pairs', () => {
        const source = ['## 题目描述', '', '计算答案。', '', '## 样例', '', '```input1', '1', '```', '```output1', '2', '```'].join('\n');
        const preview = previewLegacyProgrammingStatement(source);
        expect(preview.unclassified).to.equal('');
        expect(preview.statement.description).to.deep.equal({ state: 'present', content: '计算答案。' });
        expect(preview.statement.examples.items[0].input).to.equal('1');
        expect(() => assertLegacyProgrammingStatementFingerprint(`${source}\nchanged`, preview.fingerprint)).to.throw(/changed/);
        expect(() => assertLegacyProgrammingStatementFingerprint(source, preview.fingerprint)).not.to.throw();
    });

    it('keeps ambiguous legacy text in the explicit unclassified bucket', () => {
        const preview = previewLegacyProgrammingStatement('前言\n\n## 输入说明\n\n猜不到');
        expect(preview.unclassified).to.include('前言');
        expect(preview.unclassified).to.include('## 输入说明');
        expect(preview.statement.input.state).to.equal('undecided');
    });

    it('never discards duplicate sections or malformed sample pairs during legacy conversion', () => {
        const duplicate = previewLegacyProgrammingStatement(['## 题目描述', '', '第一段', '', '## 题目描述', '', '第二段'].join('\n'));
        expect(duplicate.statement.description.content).to.equal('第一段');
        expect(duplicate.unclassified).to.include('## 题目描述');
        expect(duplicate.unclassified).to.include('第二段');

        const malformed = previewLegacyProgrammingStatement(['## 样例', '', '```input1', '1', '```', '```output2', '2', '```'].join('\n'));
        expect(malformed.statement.examples.state).to.equal('undecided');
        expect(malformed.unclassified).to.include('```input1');
        expect(malformed.unclassified).to.include('```output2');
    });
});
