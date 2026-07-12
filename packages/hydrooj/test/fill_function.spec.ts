import { expect } from 'chai';
import { describe, it } from 'node:test';
import {
    clientProblemConfig, inferQuestionKind, isProblemConfigFilename,
    parseRegionMarkers, parseStructuredRegionSubmission,
    problemFingerprint, questionKindMap, spliceFillFunction, templateSourceHash,
    validateCompiledStructuredConfig, validateFillFunctionJudgeConfig,
    validateFillFunctionTestdataFiles, validateRegions, validateTextProgramFillSubmission,
} from '../src/lib/problem-config';
import { parseConfig } from '../src/lib/testdataConfig';

// ─── inferQuestionKind ────────────────────────────────────────────────────

describe('inferQuestionKind', () => {
    it('returns multi when stdAns is an array', () => {
        expect(inferQuestionKind([['A', 'C'], 5])).to.equal('multi');
    });
    it('returns single when stdAns is a single non-whitespace string', () => {
        expect(inferQuestionKind(['B', 3])).to.equal('single');
    });
    it('returns blank when stdAns contains whitespace', () => {
        expect(inferQuestionKind(['Hello World', 3])).to.equal('blank');
    });
    it('respects explicit kind override in meta', () => {
        expect(inferQuestionKind(['x++', 5, { kind: 'fill_program' }])).to.equal('fill_program');
        expect(inferQuestionKind([['A'], 1, { kind: 'single' }])).to.equal('single');
    });
});

describe('questionKindMap', () => {
    it('returns empty object for undefined answers', () => {
        expect(questionKindMap(undefined)).to.deep.equal({});
    });
    it('maps each key to its inferred kind', () => {
        const result = questionKindMap({
            q1: ['A', 1],
            q2: [['A', 'C'], 2],
            q3: ['hello world', 3],
            q4: ['i++', 5, { kind: 'fill_program' }],
        });
        expect(result).to.deep.equal({
            q1: 'single', q2: 'multi', q3: 'blank', q4: 'fill_program',
        });
    });
});

describe('objective client config', () => {
    it('exposes render data but never the canonical main answer or partial-credit config', () => {
        const client = clientProblemConfig({
            type: 'objective',
            main: { options: ['Yes', 'No'], answerIndexes: [0], partialCreditPercent: 40 },
            answers: {
                main: [['A'], 100, {
                    kind: 'multi', choices: ['Yes', 'No'], partialCreditPercent: 40,
                }],
            },
            options: { main: ['Yes', 'No'] },
        });
        expect(client.questions).to.deep.equal([{
            key: 'main', kind: 'multi', choices: ['Yes', 'No'], score: 100,
        }]);
        expect(client).not.to.have.property('answers');
        expect(client).not.to.have.property('main');
        expect(JSON.stringify(client)).not.to.include('partialCreditPercent');
    });

    it('only exposes sanitized fill-function region descriptions', () => {
        const client = clientProblemConfig({
            type: 'fill_function',
            subType: 'function',
            template: {
                lang: 'cc.cc17',
                source: 'private source',
                sourceHash: 'private hash',
                regions: [{
                    id: 'solve', prompt: '实现 solve',
                    start: { line: 0, col: 0 }, end: { line: 0, col: 14 },
                }],
            },
        });
        expect(client).to.deep.equal({
            type: 'fill_function',
            subType: 'function',
            template: { lang: 'cc.cc17', regions: [{ id: 'solve', prompt: '实现 solve' }] },
        });
        expect(JSON.stringify(client)).not.to.include('private source');
        expect(JSON.stringify(client)).not.to.include('private hash');
    });
});

describe('parsed problem config', () => {
    it('keeps sanitized regions for direct submission without leaking source', async () => {
        const parsed = await parseConfig({
            type: 'fill_function',
            subType: 'function',
            langs: ['cc.cc17'],
            template: {
                lang: 'cc.cc17', source: 'private source', sourceHash: 'private hash',
                regions: [{
                    id: 'solve', prompt: '实现 solve',
                    start: { line: 0, col: 0 }, end: { line: 0, col: 14 },
                }],
            },
        }, []);
        expect(parsed.template).to.deep.equal({
            lang: 'cc.cc17', regions: [{ id: 'solve', prompt: '实现 solve' }],
        });
        expect(JSON.stringify(parsed)).not.to.include('private source');
        expect(JSON.stringify(parsed)).not.to.include('private hash');
    });
});

describe('problem config filename', () => {
    it('recognizes every supported yaml alias case-insensitively', () => {
        for (const name of ['config.yaml', 'config.yml', 'Config.yaml', 'CONFIG.YML']) {
            expect(isProblemConfigFilename(name), name).to.equal(true);
        }
        expect(isProblemConfigFilename('config.yaml.bak')).to.equal(false);
    });
});

describe('text program-fill submission', () => {
    const config = { type: 'objective', subType: 'program_fill_text' };

    it('accepts only the single string-valued main line', () => {
        expect(validateTextProgramFillSubmission('program_fill', config, { main: 'i++' })).to.equal(true);
        expect(() => validateTextProgramFillSubmission('program_fill', config, { main: 'i++\nj++' }))
            .to.throw(/one line/);
        expect(() => validateTextProgramFillSubmission('program_fill', config, { main: 'i++', extra: '' }))
            .to.throw(/only main/);
        expect(() => validateTextProgramFillSubmission('program_fill', config, { main: ['i++'] }))
            .to.throw(/must be a string/);
    });

    it('does not affect other objective or programming problem types', () => {
        expect(validateTextProgramFillSubmission('programming', config, 'arbitrary source')).to.equal(false);
        expect(validateTextProgramFillSubmission('program_fill', { type: 'fill_function' }, null)).to.equal(false);
    });
});

// ─── spliceFillFunction ──────────────────────────────────────────────────

describe('spliceFillFunction', () => {
    const template = {
        lang: 'cpp',
        source: [
            '#include <iostream>',
            'using namespace std;',
            '',
            'int max3(int a, int b, int c) {',
            '    return 0;',
            '}',
            '',
            'int main() { return 0; }',
        ].join('\n'),
        regions: [
            { id: 'r1', start: { line: 4, col: 4 }, end: { line: 4, col: 13 } }, // 'return 0;'
        ],
        sourceHash: 'placeholder',
    };

    it('replaces a single-line region with single-line content', () => {
        const out = spliceFillFunction(template, { r1: 'return max(a, max(b, c));' });
        expect(out).to.include('return max(a, max(b, c));');
        const max3Body = out.slice(out.indexOf('int max3'), out.indexOf('int main'));
        expect(max3Body).to.not.include('return 0;');
        // Ensure rest of source is preserved.
        expect(out).to.include('int main() { return 0; }');
    });

    it('replaces region with multi-line content', () => {
        const out = spliceFillFunction(template, {
            r1: 'int m = a;\n    if (b > m) m = b;\n    if (c > m) m = c;\n    return m;',
        });
        expect(out).to.include('int m = a;');
        expect(out).to.include('return m;');
        expect(out).to.include('int main() { return 0; }');
    });

    it('throws on missing region id', () => {
        expect(() => spliceFillFunction(template, {})).to.throw(/missing region/);
    });

    it('throws on unknown region id', () => {
        expect(() => spliceFillFunction(template, { r1: 'return 1;', extra: 'x' })).to.throw(/unknown region/);
    });

    it('handles multiple regions correctly', () => {
        const multi = {
            lang: 'cpp',
            source: [
                'int f1() {',
                '    return 0;',
                '}',
                'int f2() {',
                '    return 0;',
                '}',
            ].join('\n'),
            regions: [
                { id: 'a', start: { line: 1, col: 4 }, end: { line: 1, col: 13 } },
                { id: 'b', start: { line: 4, col: 4 }, end: { line: 4, col: 13 } },
            ],
            sourceHash: 'p',
        };
        const out = spliceFillFunction(multi, { a: 'return 1;', b: 'return 2;' });
        expect(out).to.include('return 1;');
        expect(out).to.include('return 2;');
        expect(out).to.not.include('return 0;');
    });
});

describe('parseRegionMarkers', () => {
    it('strips marker lines and builds stable multi-line function regions', () => {
        const template = parseRegionMarkers([
            '#include <iostream>',
            '// @krypton-region solve',
            'int solve(int value) {',
            '    return value;',
            '}',
            '// @krypton-endregion solve',
            'int main() { return solve(1); }',
        ].join('\n'), [{ id: 'solve', prompt: '实现 solve' }]);
        expect(template.source).not.to.include('@krypton');
        expect(template.regions).to.deep.equal([{
            id: 'solve', prompt: '实现 solve',
            start: { line: 1, col: 0 }, end: { line: 3, col: 1 },
        }]);
        expect(template.sourceHash).to.equal(templateSourceHash(template.source));
    });

    it('rejects missing, duplicate, nested, and mismatched markers', () => {
        expect(() => parseRegionMarkers('int main() {}', [{ id: 'main' }])).to.throw(/do not match/);
        expect(() => parseRegionMarkers([
            '// @krypton-region main', 'x', '// @krypton-endregion main',
            '// @krypton-region main', 'y', '// @krypton-endregion main',
        ].join('\n'), [{ id: 'main' }])).to.throw(/duplicate marker/);
        expect(() => parseRegionMarkers([
            '// @krypton-region a', '// @krypton-region b', 'x',
        ].join('\n'), [{ id: 'a' }, { id: 'b' }])).to.throw(/nested region/);
        expect(() => parseRegionMarkers([
            '// @krypton-region a', 'x', '// @krypton-endregion b',
        ].join('\n'), [{ id: 'a' }])).to.throw(/unmatched end marker/);
    });
});

describe('validateCompiledStructuredConfig', () => {
    const valid = {
        type: 'fill_function', subType: 'program_fill_compile',
        main: { mode: 'compile', lang: 'cc.cc17' }, langs: ['cc.cc17'],
        template: {
            lang: 'cc.cc17', source: 'i++;', sourceHash: templateSourceHash('i++;'),
            regions: [{ id: 'main', start: { line: 0, col: 0 }, end: { line: 0, col: 4 } }],
        },
        cases: [{ input: '1.in', output: '1.out' }],
    };

    it('accepts one-line program-fill compile configuration', () => {
        expect(() => validateCompiledStructuredConfig('program_fill', valid)).not.to.throw();
    });

    it('rejects language mismatch and multi-line program-fill regions', () => {
        expect(() => validateCompiledStructuredConfig('program_fill', {
            ...valid, langs: ['py.py3'],
        })).to.throw(/language mismatch/);
        expect(() => validateCompiledStructuredConfig('program_fill', {
            ...valid,
            template: {
                ...valid.template, source: 'a\nb',
                regions: [{ id: 'main', start: { line: 0, col: 0 }, end: { line: 1, col: 1 } }],
            },
        })).to.throw(/one line/);
    });
});

describe('validateFillFunctionJudgeConfig', () => {
    it('rejects the old fake type-only configuration before publication or judging', () => {
        expect(() => validateFillFunctionJudgeConfig({ type: 'fill_function' }))
            .to.throw(/missing template/);
        expect(() => validateFillFunctionJudgeConfig({
            type: 'fill_function',
            template: {
                lang: 'cc.cc17', source: 'int main() {}',
                regions: [{ id: 'main', start: { line: 0, col: 0 }, end: { line: 0, col: 13 } }],
            },
        })).to.throw(/testdata cases/);
    });

    it('rejects publication until every declared physical input/output file exists', () => {
        const config = {
            type: 'fill_function',
            template: {
                lang: 'cc.cc17', source: 'int main() {}',
                regions: [{ id: 'main', start: { line: 0, col: 0 }, end: { line: 0, col: 13 } }],
            },
            cases: [{ input: '1.in', output: '1.out' }],
        };
        expect(() => validateFillFunctionTestdataFiles(config, [{ name: '1.in' }]))
            .to.throw(/missing testdata file 1\.out/);
        expect(() => validateFillFunctionTestdataFiles(config, [{ name: '1.in' }, { name: '1.out' }]))
            .not.to.throw();
    });
});

describe('parseStructuredRegionSubmission', () => {
    const template = {
        lang: 'cc.cc17',
        regions: [{ id: 'first' }, { id: 'second' }],
    } as any;

    it('accepts only the exact string-valued region map', () => {
        expect(parseStructuredRegionSubmission(
            'function', template, JSON.stringify({ first: 'a', second: 'b\nc' }),
        )).to.deep.equal({ first: 'a', second: 'b\nc' });
        expect(() => parseStructuredRegionSubmission(
            'function', template, JSON.stringify({ first: 'a', extra: 'b' }),
        )).to.throw(/keys do not match/);
        expect(() => parseStructuredRegionSubmission(
            'function', template, JSON.stringify({ first: 'a', second: 2 }),
        )).to.throw(/must be a string/);
    });

    it('rejects multi-line compile program-fill while allowing an empty attempted line', () => {
        const one = { lang: 'cc.cc17', regions: [{ id: 'main' }] } as any;
        expect(parseStructuredRegionSubmission('program_fill', one, JSON.stringify({ main: '' })))
            .to.deep.equal({ main: '' });
        expect(() => parseStructuredRegionSubmission(
            'program_fill', one, JSON.stringify({ main: 'i++\nj++' }),
        )).to.throw(/one line/);
    });
});

// ─── validateRegions ──────────────────────────────────────────────────────

describe('validateRegions', () => {
    it('accepts non-overlapping regions', () => {
        expect(() => validateRegions({
            source: 'line0\nline1\nline2\nline3',
            regions: [
                { id: 'r1', start: { line: 0, col: 0 }, end: { line: 0, col: 5 } },
                { id: 'r2', start: { line: 2, col: 0 }, end: { line: 2, col: 5 } },
            ],
        })).to.not.throw();
    });
    it('rejects overlapping regions', () => {
        expect(() => validateRegions({
            source: 'line0\nline1\nline2',
            regions: [
                { id: 'r1', start: { line: 0, col: 0 }, end: { line: 1, col: 2 } },
                { id: 'r2', start: { line: 1, col: 0 }, end: { line: 2, col: 0 } },
            ],
        })).to.throw(/overlap/);
    });
    it('rejects duplicate region ids', () => {
        expect(() => validateRegions({
            source: 'line0\nline1',
            regions: [
                { id: 'r1', start: { line: 0, col: 0 }, end: { line: 0, col: 1 } },
                { id: 'r1', start: { line: 1, col: 0 }, end: { line: 1, col: 1 } },
            ],
        })).to.throw(/duplicate region id/);
    });
    it('rejects out-of-bounds regions', () => {
        expect(() => validateRegions({
            source: 'only one line',
            regions: [
                { id: 'r1', start: { line: 5, col: 0 }, end: { line: 5, col: 5 } },
            ],
        })).to.throw(/out of bounds/);
    });
});

// ─── templateSourceHash + problemFingerprint ─────────────────────────────

describe('templateSourceHash', () => {
    it('produces deterministic hex output of length 64', () => {
        const h1 = templateSourceHash('hello world');
        const h2 = templateSourceHash('hello world');
        expect(h1).to.equal(h2);
        expect(h1).to.match(/^[0-9a-f]{64}$/);
    });
    it('produces different hashes for different inputs', () => {
        expect(templateSourceHash('a')).to.not.equal(templateSourceHash('b'));
    });
});

describe('problemFingerprint', () => {
    it('only considers judging-affecting fields', () => {
        const a = { type: 'default', cases: [{ input: 'a' }], title: 'T1' };
        const b = { type: 'default', cases: [{ input: 'a' }], title: 'CHANGED' };
        // Title is not judging-affecting → same fingerprint.
        expect(problemFingerprint(a)).to.equal(problemFingerprint(b));
    });
    it('changes when answers change', () => {
        const a = { type: 'objective', answers: { q1: ['A', 1] } };
        const b = { type: 'objective', answers: { q1: ['B', 1] } };
        expect(problemFingerprint(a)).to.not.equal(problemFingerprint(b));
    });
    it('changes when template source changes', () => {
        const a = { type: 'fill_function', template: { source: 'x', regions: [] } };
        const b = { type: 'fill_function', template: { source: 'y', regions: [] } };
        expect(problemFingerprint(a)).to.not.equal(problemFingerprint(b));
    });
});
