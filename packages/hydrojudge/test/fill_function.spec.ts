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
            next() {},
            end(payload: any) {
                ended.push(payload);
            },
            ...overrides,
        } as any,
        ended,
    };
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

process.on('exit', () => {
    if (previousDefault) require.cache[defaultPath] = previousDefault;
    else delete require.cache[defaultPath];
    if (previousFillFunction) require.cache[fillFunctionPath] = previousFillFunction;
    else delete require.cache[fillFunctionPath];
    if (previousHydrooj) require.cache[hydroojPath] = previousHydrooj;
    else delete require.cache[hydroojPath];
});
