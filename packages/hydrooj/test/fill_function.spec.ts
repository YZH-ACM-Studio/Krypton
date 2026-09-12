import { expect } from 'chai';
import { describe, it } from 'node:test';
import { ProblemType } from '@hydrooj/common';
import {
    clientProblemConfig,
    gradeProgramFillTextSubmission,
    inferQuestionKind,
    isProblemConfigFilename,
    parseStructuredRegionSubmission,
    problemFingerprint,
    questionKindMap,
    spliceStructuredCodeTemplate,
    templateSourceHash,
    validateCompiledStructuredConfig,
    validateStructuredCodeJudgeConfig,
    validateStructuredCodeTemplate,
    validateStructuredCodeTestdataFiles,
} from '../src/lib/problem-config';
import { parseConfig } from '../src/lib/testdataConfig';

const FIRST_ID = 'r_abcdefghijkl';
const SECOND_ID = 'r_mnopqrstuvwx';
const THIRD_ID = 'r_yzABCDEFGHIJ';

function functionTemplate() {
    const source = ['int first() {', '    return 0;', '}', 'int second() {', '    return 0;', '}'].join('\n');
    return {
        lang: 'cc.cc17',
        source,
        sourceHash: templateSourceHash(source),
        publicRanges: [
            { startLine: 0, endLine: 1 },
            { startLine: 2, endLine: 4 },
            { startLine: 5, endLine: 6 },
        ],
        regions: [
            { id: FIRST_ID, startLine: 1, endLine: 2, title: 'First implementation' },
            { id: SECOND_ID, startLine: 4, endLine: 5, title: 'Second implementation', description: 'Return two.' },
        ],
    };
}

describe('objective config helpers', () => {
    it('infers kinds and honors explicit metadata', () => {
        expect(inferQuestionKind([['A', 'C'], 5])).to.equal('multi');
        expect(inferQuestionKind(['B', 3])).to.equal('single');
        expect(inferQuestionKind(['Hello World', 3])).to.equal('blank');
        expect(inferQuestionKind(['x++', 5, { kind: 'fill_program' }])).to.equal('fill_program');
    });

    it('maps question kinds and omits malformed/absent answers', () => {
        expect(questionKindMap(undefined)).to.deep.equal({});
        expect(
            questionKindMap({ q1: ['A', 1], q2: [['A', 'C'], 2], q3: ['hello world', 3], q4: ['i++', 5, { kind: 'fill_program' }] }),
        ).to.deep.equal({ q1: 'single', q2: 'multi', q3: 'blank', q4: 'fill_program' });
    });

    it('exposes objective render data without canonical answers', () => {
        const client = clientProblemConfig({
            type: 'objective',
            main: { options: ['Yes', 'No'], answerIndexes: [0], partialCreditPercent: 40 },
            answers: { main: [['A'], 100, { kind: 'multi', choices: ['Yes', 'No'], partialCreditPercent: 40 }] },
            options: { main: ['Yes', 'No'] },
        });
        expect(client.questions).to.deep.equal([{ key: 'main', kind: 'multi', choices: ['Yes', 'No'], score: 100 }]);
        expect(JSON.stringify(client)).not.to.include('partialCreditPercent');
        expect(client).not.to.have.property('answers');
        expect(client).not.to.have.property('main');
    });
});

describe('function client config', () => {
    it('returns only the ordered safe code surface', () => {
        const client = clientProblemConfig({
            type: 'function',
            langs: ['cc.cc17'],
            template: functionTemplate(),
            cases: [{ input: '1.in', output: '1.out' }],
        });
        expect(client).to.deep.equal({
            type: 'function',
            langs: ['cc.cc17'],
            template: {
                lang: 'cc.cc17',
                surface: [
                    { type: 'code', code: 'int first() {' },
                    { type: 'region', id: FIRST_ID, title: 'First implementation' },
                    { type: 'code', code: '}\nint second() {' },
                    { type: 'region', id: SECOND_ID, title: 'Second implementation', description: 'Return two.' },
                    { type: 'code', code: '}' },
                ],
            },
        });
        const payload = JSON.stringify(client);
        for (const secret of ['return 0', 'sourceHash', 'startLine', 'endLine', '1.in', '1.out']) expect(payload).not.to.include(secret);
    });

    it('keeps the same safe contract through testdata config parsing', async () => {
        const parsed = await parseConfig(
            {
                type: ProblemType.Function,
                langs: ['cc.cc17'],
                template: functionTemplate(),
                cases: [{ input: '1.in', output: '1.out' }],
            },
            ['1.in', '1.out'],
        );
        expect(parsed.template?.surface).to.deep.equal([
            { type: 'code', code: 'int first() {' },
            { type: 'region', id: FIRST_ID, title: 'First implementation' },
            { type: 'code', code: '}\nint second() {' },
            { type: 'region', id: SECOND_ID, title: 'Second implementation', description: 'Return two.' },
            { type: 'code', code: '}' },
        ]);
        expect(JSON.stringify(parsed)).not.to.include('return 0');
    });
});

describe('problem config filename', () => {
    it('recognizes yaml aliases case-insensitively', () => {
        for (const name of ['config.yaml', 'config.yml', 'Config.yaml', 'CONFIG.YML']) expect(isProblemConfigFilename(name), name).to.equal(true);
        expect(isProblemConfigFilename('config.yaml.bak')).to.equal(false);
    });
});

describe('canonical text program-fill', () => {
    const source = ['for (int i = 0; i < n; i++) {', '    total += i;', '}', 'std::cout << total;', 'return 0;'].join('\n');
    const config = {
        type: 'program_fill',
        mode: 'text',
        score: 100,
        template: {
            source,
            sourceHash: templateSourceHash(source),
            publicRanges: [
                { startLine: 0, endLine: 1 },
                { startLine: 2, endLine: 3 },
            ],
            regions: [
                { id: FIRST_ID, startLine: 1, endLine: 2, prompt: '累加' },
                { id: SECOND_ID, startLine: 3, endLine: 4 },
                { id: THIRD_ID, startLine: 4, endLine: 5 },
            ],
        },
    };

    it('grades any number of single-line regions independently without rounding', () => {
        const grade = gradeProgramFillTextSubmission(
            config,
            JSON.stringify({ [FIRST_ID]: ' total += i; ', [SECOND_ID]: 'std::cout << total;', [THIRD_ID]: 'RETURN 0;' }),
        );
        expect(grade.correctCount).to.equal(2);
        expect(grade.score).to.equal((100 * 2) / 3);
        expect(grade.regions.map((region) => region.correct)).to.deep.equal([true, true, false]);

        const none = gradeProgramFillTextSubmission(
            config,
            JSON.stringify({ [FIRST_ID]: 'TOTAL += I;', [SECOND_ID]: 'STD::COUT << TOTAL;', [THIRD_ID]: 'RETURN 1;' }),
        );
        expect(none).to.include({ correctCount: 0, score: 0 });

        const all = gradeProgramFillTextSubmission(
            config,
            JSON.stringify({ [FIRST_ID]: '\t total += i;\t', [SECOND_ID]: 'std::cout << total;', [THIRD_ID]: 'return 0;' }),
        );
        expect(all).to.include({ correctCount: 3, score: 100 });
    });

    it('serializes explicit public lines and regions without private lines or coordinates', () => {
        const client = clientProblemConfig(config);
        expect(client.template.surface).to.deep.equal([
            { type: 'code', code: 'for (int i = 0; i < n; i++) {' },
            { type: 'region', id: FIRST_ID, prompt: '累加' },
            { type: 'code', code: '}' },
            { type: 'region', id: SECOND_ID },
            { type: 'region', id: THIRD_ID },
        ]);
        const payload = JSON.stringify(client);
        for (const secret of ['total += i', 'std::cout << total', 'return 0', 'sourceHash', 'startLine', 'endLine']) {
            expect(payload).not.to.include(secret);
        }
    });

    it('supports one or three inline blanks while omitting every unmarked driver and helper line', () => {
        const oneBlankSource = ['#include <iostream>', 'int main() {', 'int value = 0;', 'hidden_helper(value);', '}'].join('\n');
        const oneBlank = clientProblemConfig({
            type: 'program_fill',
            mode: 'compile',
            langs: ['cc.cc17'],
            template: {
                lang: 'cc.cc17',
                source: oneBlankSource,
                sourceHash: templateSourceHash(oneBlankSource),
                publicRanges: [
                    { startLine: 1, endLine: 2 },
                    { startLine: 4, endLine: 5 },
                ],
                regions: [{ id: FIRST_ID, startLine: 2, endLine: 3, prompt: '初始化' }],
            },
            cases: [{ input: '1.in', output: '1.out' }],
        });
        expect(oneBlank.template.surface).to.deep.equal([
            { type: 'code', code: 'int main() {' },
            { type: 'region', id: FIRST_ID, prompt: '初始化' },
            { type: 'code', code: '}' },
        ]);

        const threeBlankSource = [
            'private_driver();',
            'begin();',
            'first();',
            'private_gap_one();',
            'middle();',
            'second();',
            'private_gap_two();',
            'third();',
            'end();',
        ].join('\n');
        const threeBlank = clientProblemConfig({
            type: 'program_fill',
            mode: 'text',
            template: {
                source: threeBlankSource,
                sourceHash: templateSourceHash(threeBlankSource),
                publicRanges: [
                    { startLine: 1, endLine: 2 },
                    { startLine: 4, endLine: 5 },
                    { startLine: 8, endLine: 9 },
                ],
                regions: [
                    { id: FIRST_ID, startLine: 2, endLine: 3 },
                    { id: SECOND_ID, startLine: 5, endLine: 6 },
                    { id: THIRD_ID, startLine: 7, endLine: 8 },
                ],
            },
        });
        expect(threeBlank.template.surface).to.deep.equal([
            { type: 'code', code: 'begin();' },
            { type: 'region', id: FIRST_ID },
            { type: 'code', code: 'middle();' },
            { type: 'region', id: SECOND_ID },
            { type: 'region', id: THIRD_ID },
            { type: 'code', code: 'end();' },
        ]);
        const payload = JSON.stringify({ oneBlank, threeBlank });
        for (const secret of [
            '#include <iostream>',
            'int value = 0',
            'hidden_helper',
            'private_driver',
            'private_gap_one',
            'private_gap_two',
            'first();',
            'second();',
            'third();',
            'sourceHash',
            'startLine',
            'endLine',
            '1.in',
            '1.out',
        ]) {
            expect(payload).not.to.include(secret);
        }
    });
});

describe('whole-line structured templates', () => {
    it('validates canonical ids, bounds, source order, and source hash', () => {
        expect(() => validateStructuredCodeTemplate(functionTemplate(), 'function')).not.to.throw();
        expect(() => validateStructuredCodeTemplate({ ...functionTemplate(), sourceHash: 'forged' }, 'function')).to.throw(/hash mismatch/);
        expect(() =>
            validateStructuredCodeTemplate({ ...functionTemplate(), regions: [...functionTemplate().regions].reverse() }, 'function'),
        ).to.throw(/canonical source order/);
    });

    it('defaults every unmarked line to private and rejects CRLF or public-answer overlap', () => {
        const base = functionTemplate();
        const client = clientProblemConfig({
            type: 'function',
            langs: ['cc.cc17'],
            template: { ...base, publicRanges: [] },
            cases: [{ input: '1.in', output: '1.out' }],
        });
        expect(client.template.surface).to.deep.equal([
            { type: 'region', id: FIRST_ID, title: 'First implementation' },
            { type: 'region', id: SECOND_ID, title: 'Second implementation', description: 'Return two.' },
        ]);
        const payload = JSON.stringify(client);
        for (const privateValue of ['int first()', 'int second()', 'return 0', 'sourceHash', 'startLine', 'endLine', 'hiddenLineCount']) {
            expect(payload).not.to.include(privateValue);
        }
        const crlfSource = base.source.replace(/\n/g, '\r\n');
        expect(() =>
            validateStructuredCodeTemplate({ ...base, source: crlfSource, sourceHash: templateSourceHash(crlfSource) }, 'function'),
        ).to.throw(/LF line endings/);
        expect(() => validateStructuredCodeTemplate({ ...base, publicRanges: [{ startLine: 0, endLine: 2 }] }, 'function')).to.throw(/overlap/);
    });

    it('rejects overlap, nesting, duplicate ids, and out-of-bounds ranges', () => {
        const base = functionTemplate();
        expect(() =>
            validateStructuredCodeTemplate(
                {
                    ...base,
                    regions: [{ ...base.regions[0], endLine: 5 }, base.regions[1]],
                },
                'function',
            ),
        ).to.throw(/overlap/);
        expect(() =>
            validateStructuredCodeTemplate(
                {
                    ...base,
                    regions: [base.regions[0], { ...base.regions[1], id: FIRST_ID }],
                },
                'function',
            ),
        ).to.throw(/duplicate region id/);
        expect(() =>
            validateStructuredCodeTemplate({ ...base, regions: [{ ...base.regions[0], startLine: 99, endLine: 100 }] }, 'function'),
        ).to.throw(/out of bounds/);
    });

    it('splices multiple answers by source position while preserving answer order independence', () => {
        const output = spliceStructuredCodeTemplate(
            functionTemplate(),
            { [FIRST_ID]: '    return 1;', [SECOND_ID]: '    int value = 2;\n    return value;' },
            'function',
        );
        expect(output).to.include('return 1;');
        expect(output).to.include('int value = 2;');
        expect(output).not.to.include('return 0;');
        expect(() => spliceStructuredCodeTemplate(functionTemplate(), { [FIRST_ID]: 'x' }, 'function')).to.throw(/missing region/);
        expect(() => spliceStructuredCodeTemplate(functionTemplate(), { [FIRST_ID]: 'x', [SECOND_ID]: 'y', extra: 'z' }, 'function')).to.throw(
            /unknown region/,
        );
    });
});

describe('structured judge config', () => {
    const functionConfig = {
        type: 'function',
        langs: ['cc.cc17'],
        template: functionTemplate(),
        cases: [{ input: '1.in', output: '1.out' }],
    };

    it('requires a complete function template, cases, and matching physical files', () => {
        expect(() => validateStructuredCodeJudgeConfig(functionConfig, 'function')).not.to.throw();
        expect(() => validateStructuredCodeJudgeConfig({ type: 'function' }, 'function')).to.throw(/missing private template/);
        expect(() => validateStructuredCodeJudgeConfig({ ...functionConfig, cases: [] }, 'function')).to.throw(/testdata cases/);
        expect(() => validateStructuredCodeTestdataFiles(functionConfig, [{ name: '1.in' }], 'function')).to.throw(/1\.out/);
        expect(() => validateStructuredCodeTestdataFiles(functionConfig, [{ name: '1.in' }, { name: '1.out' }], 'function')).not.to.throw();
    });

    it('accepts multiple whole-line compile program-fill regions', () => {
        const source = 'i++;\nj++;';
        const config = {
            type: 'program_fill',
            mode: 'compile',
            langs: ['cc.cc17'],
            template: {
                lang: 'cc.cc17',
                source,
                sourceHash: templateSourceHash(source),
                publicRanges: [],
                regions: [
                    { id: FIRST_ID, startLine: 0, endLine: 1 },
                    { id: SECOND_ID, startLine: 1, endLine: 2 },
                ],
            },
            cases: [{ input: '1.in', output: '1.out' }],
        };
        expect(() => validateCompiledStructuredConfig('program_fill', config)).not.to.throw();
        expect(() => validateStructuredCodeTestdataFiles(config, [{ name: '1.in' }], 'program_fill')).to.throw(/1\.out/);
        expect(() => validateCompiledStructuredConfig('program_fill', { ...config, langs: ['py.py3'] })).to.throw(/language mismatch/);
        expect(() =>
            validateCompiledStructuredConfig('program_fill', {
                ...config,
                template: {
                    ...config.template,
                    source: 'a\nb',
                    sourceHash: templateSourceHash('a\nb'),
                    regions: [{ id: FIRST_ID, startLine: 0, endLine: 2 }],
                },
            }),
        ).to.throw(/exactly one line/);
    });
});

describe('structured region submission', () => {
    const template = { lang: 'cc.cc17', regions: [{ id: FIRST_ID }, { id: SECOND_ID }] };

    it('accepts only the exact string-valued region map', () => {
        expect(parseStructuredRegionSubmission('function', template, JSON.stringify({ [FIRST_ID]: 'a', [SECOND_ID]: 'b\nc' }))).to.deep.equal({
            [FIRST_ID]: 'a',
            [SECOND_ID]: 'b\nc',
        });
        expect(() => parseStructuredRegionSubmission('function', template, JSON.stringify({ [FIRST_ID]: 'a', extra: 'b' }))).to.throw(
            /keys do not match/,
        );
        expect(() => parseStructuredRegionSubmission('function', template, JSON.stringify({ [FIRST_ID]: 'a', [SECOND_ID]: 2 }))).to.throw(
            /must be a string/,
        );
        expect(() => parseStructuredRegionSubmission('function', template, `{"${FIRST_ID}":"a","${SECOND_ID}":"b","__proto__":"forged"}`)).to.throw(
            /keys do not match/,
        );
    });

    it('rejects newlines in every compile program-fill region value', () => {
        const one = { lang: 'cc.cc17', regions: [{ id: FIRST_ID }] };
        expect(parseStructuredRegionSubmission('program_fill', one, JSON.stringify({ [FIRST_ID]: '' }))).to.deep.equal({ [FIRST_ID]: '' });
        expect(() => parseStructuredRegionSubmission('program_fill', one, JSON.stringify({ [FIRST_ID]: 'i++\nj++' }))).to.throw(/one line/);
    });

    it('does not treat client surface as the private region-id source', () => {
        const surfaceOnly = {
            lang: 'cc.cc17',
            surface: [{ type: 'region' as const, id: FIRST_ID }],
        };
        expect(() => parseStructuredRegionSubmission('function', surfaceOnly as any, JSON.stringify({ [FIRST_ID]: 'a' }))).to.throw(
            /missing template region description/,
        );
        const both = { lang: 'cc.cc17', regions: [{ id: FIRST_ID }], surface: [{ type: 'region' as const, id: SECOND_ID }] };
        expect(parseStructuredRegionSubmission('function', both as any, JSON.stringify({ [FIRST_ID]: 'a' }))).to.deep.equal({ [FIRST_ID]: 'a' });
        expect(() => parseStructuredRegionSubmission('function', both as any, JSON.stringify({ [SECOND_ID]: 'a' }))).to.throw(/keys do not match/);
    });
});

describe('hashes and fingerprints', () => {
    it('produces deterministic source hashes', () => {
        expect(templateSourceHash('hello world')).to.equal(templateSourceHash('hello world'));
        expect(templateSourceHash('hello world')).to.match(/^[0-9a-f]{64}$/);
        expect(templateSourceHash('a')).not.to.equal(templateSourceHash('b'));
    });

    it('fingerprints judging fields but not presentation fields', () => {
        expect(problemFingerprint({ type: 'default', cases: [{ input: 'a' }], title: 'A' })).to.equal(
            problemFingerprint({ type: 'default', cases: [{ input: 'a' }], title: 'B' }),
        );
        expect(problemFingerprint({ type: 'function', template: { source: 'x', regions: [] } })).not.to.equal(
            problemFingerprint({ type: 'function', template: { source: 'y', regions: [] } }),
        );
    });
});
