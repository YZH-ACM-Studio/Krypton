import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import { STATUS } from '@hydrooj/common';

const execFileAsync = promisify(execFile);
const sandboxPath = require.resolve('../src/sandbox.ts');
const configPath = require.resolve('../src/config.ts');
const hydroojPath = require.resolve('hydrooj');
const defaultPath = require.resolve('../src/judge/default.ts');
const checkerPath = require.resolve('../src/checkers.ts');
const fillFunctionPath = require.resolve('../src/judge/fill_function.ts');
const previous = new Map<string, NodeModule | undefined>([
    [sandboxPath, require.cache[sandboxPath]],
    [configPath, require.cache[configPath]],
    [hydroojPath, require.cache[hydroojPath]],
    [defaultPath, require.cache[defaultPath]],
    [checkerPath, require.cache[checkerPath]],
    [fillFunctionPath, require.cache[fillFunctionPath]],
]);
const outputs = new Map<string, string>();
let outputId = 0;
async function fileContent(file: any): Promise<string> {
    if (file?.fileId) return outputs.get(file.fileId) || '';
    if (file?.src) return readFile(file.src, 'utf8');
    return Buffer.isBuffer(file?.content) ? file.content.toString() : String(file?.content || '');
}

function disposable<T extends object>(value: T): T & { [Symbol.asyncDispose]: () => Promise<void> } {
    return Object.assign(value, { [Symbol.asyncDispose]: async () => undefined });
}

async function runBinary(executable: string, input: string) {
    const { spawn } = await import('node:child_process');
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code: code || 0, stdout, stderr }));
        child.stdin.end(input);
    });
}

require.cache[sandboxPath] = {
    id: sandboxPath,
    filename: sandboxPath,
    loaded: true,
    exports: {
        runQueued: async (command: string, options: any) => {
            if (command.startsWith('/bin/bash compare.sh')) {
                const actual = (await fileContent(options.copyIn.usrout)).trimEnd();
                const expected = (await fileContent(options.copyIn.answer)).trimEnd();
                return disposable({
                    code: 0,
                    stdout: actual === expected ? '' : `L=1\n${actual}\n${expected}\n`,
                });
            }
            const input = await fileContent(options.stdin);
            const result = await runBinary(command, input);
            const id = `stdout-${++outputId}`;
            outputs.set(id, result.stdout);
            return disposable({
                code: result.code,
                signalled: false,
                status: result.code ? STATUS.STATUS_RUNTIME_ERROR : STATUS.STATUS_ACCEPTED,
                time: 1,
                memory: 0,
                fileIds: { stdout: id },
            });
        },
    },
} as NodeModule;
require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { getConfig: (key: string) => (key === 'singleTaskParallelism' ? 1 : 0) },
} as NodeModule;
const problemConfig = require('../../hydrooj/src/lib/problem-config.ts');
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
delete require.cache[checkerPath];
delete require.cache[defaultPath];
delete require.cache[fillFunctionPath];
const { judge } = require(fillFunctionPath) as typeof import('../src/judge/fill_function');

class LocalCompileError extends Error {}

async function runSubmission(regionCode: Record<string, string>) {
    const folder = await mkdtemp(join(tmpdir(), 'krypton-fill-function-'));
    const firstInput = join(folder, '1.in');
    const firstOutput = join(folder, '1.out');
    const secondInput = join(folder, '2.in');
    const secondOutput = join(folder, '2.out');
    await Promise.all([writeFile(firstInput, '1\n'), writeFile(firstOutput, '2\n'), writeFile(secondInput, '2\n'), writeFile(secondOutput, '4\n')]);
    let result: any;
    const source = [
        '#include <iostream>',
        'int main() {',
        'int value = 0;',
        'std::cin >> value;',
        'int doubled = value * 2;',
        'int answer = doubled;',
        'std::cout << answer;',
        '}',
    ].join('\n');
    const regionIds = ['r_abcdefghijkl', 'r_mnopqrstuvwx', 'r_yzABCDEFGHIJ'];
    const config = {
        type: 'program_fill',
        mode: 'compile',
        template: {
            lang: 'cc.cc17',
            source,
            sourceHash: problemConfig.templateSourceHash(source),
            regions: regionIds.map((id, index) => ({ id, startLine: index + 4, endLine: index + 5, order: index })),
        },
        cases: [
            { input: '1.in', output: '1.out' },
            { input: '2.in', output: '2.out' },
        ],
        count: 2,
        checker_type: 'default',
        detail: 'full',
        subtasks: [
            {
                id: 1,
                type: 'min',
                score: 50,
                cases: [{ id: 1, input: firstInput, output: firstOutput, time: 1000, memory: 256, score: 50 }],
            },
            {
                id: 2,
                type: 'min',
                score: 50,
                cases: [{ id: 2, input: secondInput, output: secondOutput, time: 1000, memory: 256, score: 50 }],
            },
        ],
    };
    const context: any = {
        config,
        lang: 'cc.cc17',
        code: { content: JSON.stringify(regionCode) },
        request: { rejudged: false },
        meta: {},
        env: {},
        session: { getLang: () => ({ address_space_limit: 0, process_limit: 1 }) },
        next() {},
        end(payload: any) {
            result = payload;
        },
        startChildSpan() {
            return { setAttributes() {}, [Symbol.dispose]() {} };
        },
        async compile(_lang: string, code: { content: string }) {
            const sourcePath = join(folder, 'main.cpp');
            const binary = join(folder, 'main');
            await writeFile(sourcePath, code.content);
            try {
                await execFileAsync('/usr/bin/g++', ['-std=c++17', sourcePath, '-o', binary]);
            } catch (error) {
                throw new LocalCompileError('compile failed', { cause: error });
            }
            return disposable({ execute: binary, copyIn: {}, clean: async () => undefined });
        },
        async compileLocalFile() {
            return disposable({ execute: '', copyIn: {}, clean: async () => undefined });
        },
        async runAnalysis() {
            return undefined;
        },
    };
    try {
        await judge(context);
    } catch (error) {
        if (error instanceof LocalCompileError) {
            result = { status: STATUS.STATUS_COMPILE_ERROR, score: 0 };
        } else throw error;
    } finally {
        await rm(folder, { recursive: true, force: true });
    }
    return result;
}

describe('program-fill compile-mode real compiler and testdata integration', () => {
    const ids = ['r_abcdefghijkl', 'r_mnopqrstuvwx', 'r_yzABCDEFGHIJ'];

    it('splices three regions once and maps AC, CE, and partial testdata scores through the default judge', async () => {
        expect(
            await runSubmission({
                [ids[0]]: 'int doubled = value * 2;',
                [ids[1]]: 'int answer = doubled;',
                [ids[2]]: 'std::cout << answer;',
            }),
        ).to.deep.include({ status: STATUS.STATUS_ACCEPTED, score: 100 });
        expect(
            await runSubmission({
                [ids[0]]: 'int doubled = ;',
                [ids[1]]: 'int answer = doubled;',
                [ids[2]]: 'std::cout << answer;',
            }),
        ).to.deep.include({ status: STATUS.STATUS_COMPILE_ERROR, score: 0 });
        expect(
            await runSubmission({
                [ids[0]]: 'int doubled = value * 2;',
                [ids[1]]: 'int answer = doubled + (value == 2);',
                [ids[2]]: 'std::cout << answer;',
            }),
        ).to.deep.include({ status: STATUS.STATUS_WRONG_ANSWER, score: 50 });
    });
});

process.on('exit', () => {
    for (const [path, cached] of previous) {
        if (cached) require.cache[path] = cached;
        else delete require.cache[path];
    }
});
