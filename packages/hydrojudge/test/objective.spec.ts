import { expect } from 'chai';
import { describe, it } from 'node:test';
import { STATUS } from '@hydrooj/common';
import { yaml } from '@hydrooj/utils';
import { judge } from '../src/judge/objective';

async function run(config: any, answers: Record<string, unknown>) {
    let result: any;
    const cases: any[] = [];
    await judge({
        config,
        code: { content: Buffer.from(yaml.dump(answers)) },
        next(payload: any) { cases.push(payload); },
        end(payload: any) { result = payload; },
    } as any);
    return { result, cases };
}

describe('objective judge integration', () => {
    const multiConfig = {
        answers: {
            main: [['A', 'C'], 100, { kind: 'multi', partialCreditPercent: 35 }],
        },
    };

    it('uses configured multi credit and rejects empty or wrong selections', async () => {
        expect((await run(multiConfig, { main: ['A'] })).result)
            .to.deep.include({ status: STATUS.STATUS_WRONG_ANSWER, score: 35 });
        expect((await run(multiConfig, { main: ['A', 'C'] })).result)
            .to.deep.include({ status: STATUS.STATUS_ACCEPTED, score: 100 });
        expect((await run(multiConfig, { main: ['A', 'B'] })).result)
            .to.deep.include({ status: STATUS.STATUS_WRONG_ANSWER, score: 0 });
        expect((await run(multiConfig, { main: [] })).result)
            .to.deep.include({ status: STATUS.STATUS_WRONG_ANSWER, score: 0 });
    });

    it('normalizes only blank CRLF and outer whitespace while preserving case', async () => {
        const config = { answers: { main: ['Answer\nLine', 100, { kind: 'blank' }] } };
        expect((await run(config, { main: '  Answer\r\nLine\n' })).result)
            .to.deep.include({ status: STATUS.STATUS_ACCEPTED, score: 100 });
        expect((await run(config, { main: 'answer\nLine' })).result)
            .to.deep.include({ status: STATUS.STATUS_WRONG_ANSWER, score: 0 });
    });

    it('rejects array-shaped submissions for scalar objective problems', async () => {
        const results = await Promise.all([
            ['single', 'B'], ['true_false', 'A'], ['blank', 'Answer'],
        ].map(([kind, expected]) => {
            const config = { answers: { main: [expected, 100, { kind }] } };
            return run(config, { main: [expected, 'ignored'] });
        }));
        for (const result of results) {
            expect(result.result)
                .to.deep.include({ status: STATUS.STATUS_WRONG_ANSWER, score: 0 });
        }
    });
});
