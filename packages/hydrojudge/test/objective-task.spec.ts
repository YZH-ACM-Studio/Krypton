import { expect } from 'chai';
import { after, describe, it } from 'node:test';
import { STATUS } from '@hydrooj/common';

const configPath = require.resolve('../src/config.ts');
const hydroojPath = require.resolve('hydrooj');
const taskPath = require.resolve('../src/task.ts');
const previousConfig = require.cache[configPath];
const previousHydrooj = require.cache[hydroojPath];
const previousTask = require.cache[taskPath];

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
    exports: {},
} as NodeModule;
delete require.cache[taskPath];
const { JudgeTask, usesConfigOnlyJudgeData } = require(taskPath) as typeof import('../src/task');

describe('objective task dispatch', () => {
    it('treats objective configs as testdata-free', () => {
        expect(usesConfigOnlyJudgeData({ type: 'objective' })).to.equal(true);
        expect(usesConfigOnlyJudgeData({ type: 'default' })).to.equal(false);
        expect(usesConfigOnlyJudgeData({ type: 'program_fill', mode: 'text' })).to.equal(true);
        expect(usesConfigOnlyJudgeData({ type: 'program_fill', mode: 'compile' })).to.equal(false);
    });

    it('grades an empty-testdata objective submission without opening the testdata cache', async () => {
        let fetchedFiles = 0;
        let result: Record<string, unknown> | undefined;
        const session = {
            config: { detail: 'full' },
            getLang() {
                throw new Error('objective must not resolve a compiler language');
            },
            getReporter() {
                throw new Error('reporter is not used by this direct task test');
            },
            async fetchFile() {
                fetchedFiles++;
                throw new Error('objective must not fetch testdata');
            },
            async postFile() {
                return undefined;
            },
        } as any;
        const request = {
            config: {
                type: 'objective',
                answers: { main: ['C', 100, { kind: 'single', choices: ['A', 'B', 'C'] }] },
            },
            type: 'judge',
        } as any;
        const task = new JudgeTask(session, request);
        task.source = 'system/3272';
        task.data = [];
        task.files = {};
        task.lang = '_';
        task.code = { content: Buffer.from('main: C\n') };
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
