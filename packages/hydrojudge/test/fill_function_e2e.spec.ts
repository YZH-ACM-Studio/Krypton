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
const runPath = require.resolve('../src/judge/run.ts');
const checkerPath = require.resolve('../src/checkers.ts');
const fillFunctionPath = require.resolve('../src/judge/fill_function.ts');
const previous = new Map<string, NodeModule | undefined>([
    [sandboxPath, require.cache[sandboxPath]],
    [configPath, require.cache[configPath]],
    [hydroojPath, require.cache[hydroojPath]],
    [defaultPath, require.cache[defaultPath]],
    [runPath, require.cache[runPath]],
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
                stdout: result.stdout,
                stderr: result.stderr,
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
delete require.cache[runPath];
delete require.cache[fillFunctionPath];
const { judge } = require(fillFunctionPath) as typeof import('../src/judge/fill_function');

class LocalCompileError extends Error {}

async function runConfiguredSubmission(baseConfig: Record<string, any>, regionCode: Record<string, string>, pretestInputs?: string[]) {
    const folder = await mkdtemp(join(tmpdir(), 'krypton-fill-function-'));
    const firstInput = join(folder, '1.in');
    const firstOutput = join(folder, '1.out');
    const secondInput = join(folder, '2.in');
    const secondOutput = join(folder, '2.out');
    await Promise.all([writeFile(firstInput, '1\n'), writeFile(firstOutput, '2\n'), writeFile(secondInput, '2\n'), writeFile(secondOutput, '4\n')]);
    let result: any;
    const emittedCases: any[] = [];
    const config = {
        ...baseConfig,
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
        request: { rejudged: false, ...(pretestInputs ? { contest: '000000000000000000000000' } : {}) },
        input: pretestInputs || [],
        meta: {},
        env: {},
        session: { getLang: () => ({ address_space_limit: 0, process_limit: 1 }) },
        next(payload: any) {
            if (payload.case) emittedCases.push(payload.case);
        },
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
    return { ...result, emittedCases };
}

async function runSubmission(regionCode: Record<string, string>, pretestInputs?: string[]) {
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
    return runConfiguredSubmission(
        {
            type: 'program_fill',
            mode: 'compile',
            template: {
                lang: 'cc.cc17',
                source,
                sourceHash: problemConfig.templateSourceHash(source),
                publicRanges: [],
                regions: regionIds.map((id, index) => ({ id, startLine: index + 4, endLine: index + 5 })),
            },
            cases: [
                { input: '1.in', output: '1.out' },
                { input: '2.in', output: '2.out' },
            ],
        },
        regionCode,
        pretestInputs,
    );
}

const functionFixtures = [
    {
        name: 'function body',
        source: [
            '#include <iostream>',
            'int twice(int x) {',
            '  return x * 2;',
            '}',
            'int main() { int x; std::cin >> x; std::cout << twice(x); }',
        ].join('\n'),
        publicRanges: [
            { startLine: 0, endLine: 2 },
            { startLine: 3, endLine: 4 },
        ],
        regions: [{ id: 'r_bodyabcdefgh', startLine: 2, endLine: 3, title: '函数体' }],
        answers: { r_bodyabcdefgh: '  return x * 2;' },
    },
    {
        name: 'complete function',
        source: [
            '#include <iostream>',
            'int twice(int x) {',
            '  return x * 2;',
            '}',
            'int main() { int x; std::cin >> x; std::cout << twice(x); }',
        ].join('\n'),
        publicRanges: [{ startLine: 0, endLine: 1 }],
        regions: [{ id: 'r_fullabcdefgh', startLine: 1, endLine: 4, title: '完整函数' }],
        answers: { r_fullabcdefgh: ['int twice(int x) {', '  return x * 2;', '}'].join('\n') },
    },
    {
        name: 'class definition',
        source: [
            '#include <iostream>',
            'class Doubler {',
            'public:',
            '  int run(int x) const {',
            '    return x * 2;',
            '  }',
            '};',
            'int main() { int x; std::cin >> x; std::cout << Doubler{}.run(x); }',
        ].join('\n'),
        publicRanges: [{ startLine: 0, endLine: 1 }],
        regions: [{ id: 'r_classabcdefg', startLine: 1, endLine: 7, title: '类定义' }],
        answers: {
            r_classabcdefg: ['class Doubler {', 'public:', '  int run(int x) const {', '    return x * 2;', '  }', '};'].join('\n'),
        },
    },
    {
        name: 'multiple regions',
        source: [
            '#include <iostream>',
            'int identity(int x) {',
            '  return x;',
            '}',
            'int twice(int x) {',
            '  return identity(x) * 2;',
            '}',
            'int main() { int x; std::cin >> x; std::cout << twice(x); }',
        ].join('\n'),
        publicRanges: [{ startLine: 0, endLine: 1 }],
        regions: [
            { id: 'r_firstabcdefg', startLine: 1, endLine: 4, title: '辅助函数' },
            { id: 'r_secondabcdef', startLine: 4, endLine: 7, description: '完成主逻辑' },
        ],
        answers: {
            r_firstabcdefg: ['int identity(int x) {', '  return x;', '}'].join('\n'),
            r_secondabcdef: ['int twice(int x) {', '  return identity(x) * 2;', '}'].join('\n'),
        },
    },
] as const;

async function runFunctionFixture(fixture: (typeof functionFixtures)[number], answers: Record<string, string>, pretestInputs?: string[]) {
    return runConfiguredSubmission(
        {
            type: 'function',
            langs: ['cc.cc17'],
            template: {
                lang: 'cc.cc17',
                source: fixture.source,
                sourceHash: problemConfig.templateSourceHash(fixture.source),
                publicRanges: fixture.publicRanges,
                regions: fixture.regions,
            },
            cases: [
                { input: '1.in', output: '1.out' },
                { input: '2.in', output: '2.out' },
            ],
        },
        answers,
        pretestInputs,
    );
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

    it('splices the structured answer before running custom pretest input', async () => {
        const result = await runSubmission(
            {
                [ids[0]]: 'int doubled = value * 2;',
                [ids[1]]: 'int answer = doubled;',
                [ids[2]]: 'std::cout << answer;',
            },
            ['21\n'],
        );

        expect(result).to.deep.include({ status: STATUS.STATUS_ACCEPTED, score: 1 });
        expect(result.emittedCases).to.have.length(1);
        expect(result.emittedCases[0].message).to.include('42');
    });
});

describe('P3.22 code implementation real compiler fixtures', () => {
    it('accepts a function body, a complete function, a class definition, and multiple source-ordered regions', async () => {
        for (const fixture of functionFixtures) {
            expect(await runFunctionFixture(fixture, fixture.answers)).to.deep.include({ status: STATUS.STATUS_ACCEPTED, score: 100 }, fixture.name);
        }
    });

    it('maps wrong and non-compiling multi-region implementations to WA and CE', async () => {
        const fixture = functionFixtures[3];
        expect(
            await runFunctionFixture(fixture, {
                ...fixture.answers,
                r_secondabcdef: ['int twice(int x) {', '  return identity(x);', '}'].join('\n'),
            }),
        ).to.deep.include({ status: STATUS.STATUS_WRONG_ANSWER, score: 0 });
        expect(
            await runFunctionFixture(fixture, {
                ...fixture.answers,
                r_secondabcdef: 'int twice(int x) { return ; }',
            }),
        ).to.deep.include({ status: STATUS.STATUS_COMPILE_ERROR, score: 0 });
    });

    it('splices a multi-line implementation before running custom pretest input', async () => {
        const fixture = functionFixtures[0];
        const result = await runFunctionFixture(fixture, fixture.answers, ['9\n']);

        expect(result).to.deep.include({ status: STATUS.STATUS_ACCEPTED, score: 1 });
        expect(result.emittedCases).to.have.length(1);
        expect(result.emittedCases[0].message).to.include('18');
    });
});

process.on('exit', () => {
    for (const [path, cached] of previous) {
        if (cached) require.cache[path] = cached;
        else delete require.cache[path];
    }
});
