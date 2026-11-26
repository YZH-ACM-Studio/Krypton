import { describe, it } from 'node:test';
import { expect } from 'chai';
import { STATUS } from '@hydrooj/common';
import { gradeProgramFillTextSubmission, templateSourceHash } from '../src/lib/problem-config';
import { gradeSetAnswer } from '../src/lib/set-answer-grading';

describe('formal answer grading', () => {
    it('uses configured multi-select partial credit and preserves empty answers', () => {
        const pdoc = { problemKind: 'multi', config: { type: 'objective', answers: {
            main: [['A', 'C'], 100, { kind: 'multi', partialCreditPercent: 30 }],
        } } };
        expect(gradeSetAnswer(pdoc, { main: ['A'] })).to.deep.equal({
            rawScore: 30, judgeResult: { main: 'partial' }, manual: false, status: STATUS.STATUS_WRONG_ANSWER,
        });
        expect(gradeSetAnswer(pdoc, { main: [] }).rawScore).to.equal(0);
    });

    it('leaves subjective answers pending for human grading', () => {
        const pdoc = { problemKind: 'subjective', config: { type: 'objective', answers: {
            main: ['', 100, { kind: 'subjective' }],
        } } };
        expect(gradeSetAnswer(pdoc, { main: '我的推导' })).to.deep.equal({
            rawScore: 0, judgeResult: {}, manual: true, status: STATUS.STATUS_WAITING,
        });
        expect(() => gradeSetAnswer(pdoc, { main: ['a', 'b'] })).to.throw();
    });

    it('rejects forged answer keys, malformed scoring config and judged-code saves', () => {
        expect(() => gradeSetAnswer({ problemKind: 'single', config: {
            type: 'objective', answers: { main: ['A', 100] },
        } }, { unknown: 'A' })).to.throw();
        expect(() => gradeSetAnswer({ problemKind: 'single', config: {
            type: 'objective', answers: { main: ['A', '100'] },
        } }, { main: 'A' })).to.throw();
        expect(() => gradeSetAnswer({ problemKind: 'programming', config: { type: 'default' } }, { main: 'A' })).to.throw();
    });

    it('grades text program-fill with the exact existing judge and rejects malformed regions', () => {
        const first = 'r_abcdefghijkl';
        const second = 'r_mnopqrstuvwx';
        const source = ['int main() {', '  i++;', '  return 0;', '}'].join('\n');
        const config = { type: 'program_fill', mode: 'text', template: {
            source, sourceHash: templateSourceHash(source),
            publicRanges: [{ startLine: 0, endLine: 1 }, { startLine: 3, endLine: 4 }],
            regions: [{ id: first, startLine: 1, endLine: 2 }, { id: second, startLine: 2, endLine: 3 }],
        } };
        const body = { [first]: ' i++; ', [second]: '' };
        const result = gradeSetAnswer({ problemKind: 'program_fill', config }, body);
        expect(result.rawScore).to.equal(gradeProgramFillTextSubmission(config, JSON.stringify(body)).score).and.equal(50);
        expect(result.judgeResult).to.deep.equal({ [first]: 'correct', [second]: 'wrong' });
        expect(() => gradeSetAnswer({ problemKind: 'program_fill', config }, { [first]: 'i++;' })).to.throw();
        expect(() => gradeSetAnswer({ problemKind: 'program_fill', config }, { ...body, [first]: 'i++;\n' })).to.throw();
        expect(result).not.to.have.property('source');
    });
});
