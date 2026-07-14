import { expect } from 'chai';
import { before, describe, it } from 'node:test';
import { STATUS } from '@hydrooj/common';

const defaultPath = require.resolve('../src/judge/default.ts');
const fillFunctionPath = require.resolve('../src/judge/fill_function.ts');
const hydroojPath = require.resolve('hydrooj');
const previousDefault = require.cache[defaultPath];
const previousFillFunction = require.cache[fillFunctionPath];
const previousHydrooj = require.cache[hydroojPath];
let delegated: any;
const REGION_ID = 'r_abcdefghijkl';
const problemConfig = require('../../hydrooj/src/lib/problem-config.ts');

require.cache[defaultPath] = {
    id: defaultPath,
    filename: defaultPath,
    loaded: true,
    exports: {
        async judge(ctx: any) {
            delegated = ctx;
        },
    },
} as NodeModule;
require.cache[hydroojPath] = {
    id: hydroojPath,
    filename: hydroojPath,
    loaded: true,
    exports: {
        gradeProgramFillTextSubmission: problemConfig.gradeProgramFillTextSubmission,
        parseStructuredRegionSubmission: problemConfig.parseStructuredRegionSubmission,
        spliceStructuredCodeTemplate: problemConfig.spliceStructuredCodeTemplate,
        validateStructuredCodeJudgeConfig: problemConfig.validateStructuredCodeJudgeConfig,
    },
} as NodeModule;
delete require.cache[fillFunctionPath];

const { judge } = require(fillFunctionPath) as typeof import('../src/judge/fill_function');

before(() => {
    delegated = null;
});

function context(overrides: Record<string, unknown> = {}) {
    const ended: any[] = [];
    const events: any[] = [];
    return {
        ctx: {
            config: {
                type: 'function',
                template: {
                    lang: 'cc.cc17',
                    source: 'int main() {\nreturn 0;\n}',
                    sourceHash: problemConfig.templateSourceHash('int main() {\nreturn 0;\n}'),
                    regions: [
                        {
                            id: REGION_ID,
                            startLine: 1,
                            endLine: 2,
                            order: 0,
                            signature: 'int main()',
                        },
                    ],
                },
                cases: [{ input: '1.in', output: '1.out' }],
            },
            lang: 'cc.cc17',
            code: { content: JSON.stringify({ [REGION_ID]: 'return 1;' }) },
            next(payload: any) {
                events.push(payload);
            },
            end(payload: any) {
                ended.push(payload);
            },
            ...overrides,
        } as any,
        ended,
        events,
    };
}

function textContext(answers: Record<string, string>) {
    const source = ['int total = 0;', 'total += value;', 'total *= 2;', 'std::cout << total;'].join('\n');
    const ids = ['r_abcdefghijkl', 'r_mnopqrstuvwx', 'r_yzABCDEFGHIJ'];
    return context({
        config: {
            type: 'program_fill',
            mode: 'text',
            template: {
                source,
                sourceHash: problemConfig.templateSourceHash(source),
                regions: ids.map((id, index) => ({ id, startLine: index + 1, endLine: index + 2, order: index })),
            },
        },
        lang: '_',
        code: { content: JSON.stringify(answers) },
    });
}

describe('fill-function judge integration', () => {
    it('splices the private template and delegates to the default compile judge', async () => {
        const { ctx, ended } = context();
        await judge(ctx);
        expect(ended).to.deep.equal([]);
        expect(delegated).to.equal(ctx);
        expect(delegated.lang).to.equal('cc.cc17');
        expect(delegated.code.content).to.equal('int main() {\nreturn 1;\n}');
    });

    it('fails fast before compilation when the language does not match', async () => {
        delegated = null;
        const { ctx, ended } = context({ lang: 'py.py3' });
        await judge(ctx);
        expect(delegated).to.equal(null);
        expect(ended[0]).to.deep.include({ status: STATUS.STATUS_FORMAT_ERROR, score: 0 });
        expect(ended[0].message).to.include('language mismatch');
    });

    it('fails fast when a region is missing', async () => {
        delegated = null;
        const { ctx, ended } = context({ code: { content: '{}' } });
        await judge(ctx);
        expect(delegated).to.equal(null);
        expect(ended[0]).to.deep.include({ status: STATUS.STATUS_FORMAT_ERROR, score: 0 });
        expect(ended[0].message).to.include('keys do not match');
    });
});

describe('program-fill text judge integration', () => {
    const ids = ['r_abcdefghijkl', 'r_mnopqrstuvwx', 'r_yzABCDEFGHIJ'];

    it('grades three regions independently with exact fractional scores and outer-whitespace normalization', async () => {
        delegated = null;
        const full = textContext({
            [ids[0]]: '  total += value;  ',
            [ids[1]]: 'total *= 2;',
            [ids[2]]: 'std::cout << total;',
        });
        await judge(full.ctx);
        expect(delegated).to.equal(null);
        expect(full.ended[0]).to.deep.include({ status: STATUS.STATUS_ACCEPTED, score: 100 });

        const partial = textContext({
            [ids[0]]: 'total += value;',
            [ids[1]]: 'TOTAL *= 2;',
            [ids[2]]: 'std::cout << total;',
        });
        await judge(partial.ctx);
        expect(partial.ended[0]).to.deep.include({ status: STATUS.STATUS_WRONG_ANSWER, score: 200 / 3 });
        expect(partial.events.filter((event) => event.case).map((event) => event.case.status)).to.deep.equal([
            STATUS.STATUS_ACCEPTED,
            STATUS.STATUS_WRONG_ANSWER,
            STATUS.STATUS_ACCEPTED,
        ]);
    });

    it('rejects missing, extra, and multi-line answers before grading', async () => {
        for (const answers of [
            { [ids[0]]: 'total += value;', [ids[1]]: 'total *= 2;' },
            { [ids[0]]: 'total += value;', [ids[1]]: 'total *= 2;', [ids[2]]: 'std::cout << total;', extra: 'x' },
            { [ids[0]]: 'total += value;\nreturn;', [ids[1]]: 'total *= 2;', [ids[2]]: 'std::cout << total;' },
        ]) {
            delegated = null;
            const current = textContext(answers);
            await judge(current.ctx);
            expect(delegated).to.equal(null);
            expect(current.ended[0]).to.deep.include({ status: STATUS.STATUS_FORMAT_ERROR, score: 0 });
        }
    });
});

process.on('exit', () => {
    if (previousDefault) require.cache[defaultPath] = previousDefault;
    else delete require.cache[defaultPath];
    if (previousFillFunction) require.cache[fillFunctionPath] = previousFillFunction;
    else delete require.cache[fillFunctionPath];
    if (previousHydrooj) require.cache[hydroojPath] = previousHydrooj;
    else delete require.cache[hydroojPath];
});
