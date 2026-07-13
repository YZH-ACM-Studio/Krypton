import { expect } from 'chai';
import { after, describe, it } from 'node:test';
import { STATUS } from '@hydrooj/common';

const sandboxPath = require.resolve('../src/sandbox.ts');
const configPath = require.resolve('../src/config.ts');
const runPath = require.resolve('../src/judge/run.ts');
const previousSandbox = require.cache[sandboxPath];
const previousConfig = require.cache[configPath];
const previousRun = require.cache[runPath];
const receivedInputs: string[] = [];

require.cache[sandboxPath] = {
    id: sandboxPath,
    filename: sandboxPath,
    loaded: true,
    exports: {
        async runQueued(_execute: string, params: any) {
            const input = params.stdin.content as string;
            receivedInputs.push(input);
            return {
                status: STATUS.STATUS_ACCEPTED,
                code: 0,
                signalled: false,
                time: 1,
                memory: 1,
                stdout: `output:${input}`,
                stderr: '',
            };
        },
    },
} as NodeModule;
require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
        getConfig(key: string) {
            if (key === 'singleTaskParallelism') return 2;
            return 0;
        },
    },
} as NodeModule;
delete require.cache[runPath];

const { judge } = require(runPath) as typeof import('../src/judge/run');

after(() => {
    if (previousSandbox) require.cache[sandboxPath] = previousSandbox;
    else delete require.cache[sandboxPath];
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
    if (previousRun) require.cache[runPath] = previousRun;
    else delete require.cache[runPath];
});

describe('pretest judge multi-case execution', () => {
    it('runs every supplied stdin independently and returns stable one-based case ids', async () => {
        receivedInputs.length = 0;
        const cases: any[] = [];
        let final: any;
        const disposableSpan = {
            setAttributes() {},
            [Symbol.dispose]() {},
        };
        const ctx: any = {
            rid: 'pretest-rid',
            lang: 'cc.cc17',
            code: { content: 'program' },
            input: ['alpha', 'beta'],
            config: { time: '1s', memory: '256m' },
            meta: {},
            session: { getLang: () => ({}) },
            compile: async () => ({ execute: 'program', copyIn: {} }),
            next(payload: any) {
                if (payload.case) cases.push(payload.case);
            },
            end(payload: any) {
                final = payload;
            },
            startChildSpan: () => disposableSpan,
            runAnalysis: async () => {},
        };

        await judge(ctx);

        expect(receivedInputs.sort()).to.deep.equal(['alpha', 'beta']);
        expect(cases.sort((a, b) => a.id - b.id)).to.deep.include.members([
            { id: 1, subtaskId: 1, status: STATUS.STATUS_ACCEPTED, score: 1, time: 1, memory: 1, message: 'output:alpha\n' },
            { id: 2, subtaskId: 1, status: STATUS.STATUS_ACCEPTED, score: 1, time: 1, memory: 1, message: 'output:beta\n' },
        ]);
        expect(final.status).to.equal(STATUS.STATUS_ACCEPTED);
    });
});
