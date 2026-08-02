import { expect } from 'chai';
import { after, describe, it } from 'node:test';
import { STATUS } from '@hydrooj/common';

const configPath = require.resolve('../src/config.ts');
const hydroojPath = require.resolve('hydrooj');
const taskPath = require.resolve('../src/task.ts');
const previousConfig = require.cache[configPath];
const previousHydrooj = require.cache[hydroojPath];
const previousTask = require.cache[taskPath];
const problemConfig = require('../../hydrooj/src/lib/problem-config.ts');

require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { getConfig: (key: string) => (key === 'parallelism' || key === 'singleTaskParallelism' ? 1 : 0) },
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
delete require.cache[taskPath];
const { JudgeTask } = require(taskPath) as typeof import('../src/task');

describe('program-fill text task dispatch', () => {
    it('grades an empty-testdata submission without opening the testdata cache', async () => {
        const source = ['for (int i = 0; i < n; ) {', 'i++;', '}'].join('\n');
        const regionId = 'r_abcdefghijkl';
        let fetchedFiles = 0;
        let result: Record<string, unknown> | undefined;
        const session = {
            config: { detail: 'full' },
            getLang() {
                throw new Error('text program-fill must not resolve a compiler language');
            },
            getReporter() {
                throw new Error('reporter is not used by this direct task test');
            },
            async fetchFile() {
                fetchedFiles++;
                throw new Error('text program-fill must not fetch testdata');
            },
            async postFile() {
                return undefined;
            },
        } as any;
        const request = {
            config: {
                type: 'program_fill',
                mode: 'text',
                template: {
                    source,
                    sourceHash: problemConfig.templateSourceHash(source),
                    publicRanges: [
                        { startLine: 0, endLine: 1 },
                        { startLine: 2, endLine: 3 },
                    ],
                    regions: [{ id: regionId, startLine: 1, endLine: 2, prompt: '填写自增语句' }],
                },
            },
            type: 'judge',
        } as any;
        const task = new JudgeTask(session, request);
        task.source = 'system/3135';
        task.data = [];
        task.files = {};
        task.lang = '_';
        task.code = { content: JSON.stringify({ [regionId]: 'i++;' }) };
        task.meta = { problemOwner: 2 } as any;
        task.input = [];
        task.next = () => undefined;
        task.end = (payload) => {
            result = payload as Record<string, unknown>;
        };

        try {
            await task.doSubmission();
        } finally {
            task.span.end();
        }

        expect(fetchedFiles).to.equal(0);
        expect(result).to.deep.include({ status: STATUS.STATUS_ACCEPTED, score: 100 });
    });
});

after(() => {
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
    if (previousHydrooj) require.cache[hydroojPath] = previousHydrooj;
    else delete require.cache[hydroojPath];
    if (previousTask) require.cache[taskPath] = previousTask;
    else delete require.cache[taskPath];
});
