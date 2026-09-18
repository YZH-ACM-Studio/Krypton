import { expect } from 'chai';
import { describe, it } from 'node:test';
import { drawExamPaperPids, readExamPaperQuotas } from '../src/lib/exam-paper';

describe('hydrooj exam-paper re-export', () => {
    it('draws with the default CSPRNG and re-exports quota reads', () => {
        expect(readExamPaperQuotas(undefined)).to.equal(null);
        const kinds = new Map([
            [1, 'single' as const],
            [2, 'single' as const],
        ]);
        const drawn = drawExamPaperPids([1, 2], kinds, { single: 1 });
        expect(drawn).to.have.length(1);
        expect([1, 2]).to.include(drawn[0]);
    });
});
