import { expect } from 'chai';
import { describe, it } from 'node:test';
import {
    inferQuestionKind, questionKindMap, spliceFillFunction, templateSourceHash,
    validateRegions, problemFingerprint,
} from '../src/lib/problem-config';

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
        expect(out).to.not.include('return 0;');
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
