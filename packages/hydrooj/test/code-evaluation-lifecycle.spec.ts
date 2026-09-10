import { expect } from 'chai';
import { describe, it } from 'node:test';
import { localizeErrorParameter, localizedErrorText } from '@hydrooj/framework';

(global as any).Hydro ||= { model: {} };

class TestValidationError extends Error {
    name = 'ValidationError';
    params: unknown[];

    constructor(...params: unknown[]) {
        super(String(params[2] ?? params[0] ?? 'ValidationError'));
        this.params = params;
    }
}

const dbPath = require.resolve('../src/service/db.ts');
const documentPath = require.resolve('../src/model/document.ts');
const errorPath = require.resolve('../src/error.ts');
const lifecyclePath = require.resolve('../src/model/problem-lifecycle.ts');
const codeEvaluationPath = require.resolve('../src/model/code-evaluation-lifecycle.ts');

require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
        collection: () => ({ countDocuments: async () => 0 }),
    },
} as NodeModule;
require.cache[documentPath] = {
    id: documentPath,
    filename: documentPath,
    loaded: true,
    exports: {
        TYPE_PROBLEM: 10,
        TYPE_PROBLEM_SOLUTION: 11,
        TYPE_DISCUSSION: 21,
        TYPE_CONTEST: 30,
        TYPE_TRAINING: 40,
        coll: { countDocuments: async () => 0, findOne: async () => null },
        collStatus: { countDocuments: async () => 0 },
    },
} as NodeModule;
require.cache[errorPath] = {
    id: errorPath,
    filename: errorPath,
    loaded: true,
    exports: { localizeErrorParameter, localizedErrorText, ValidationError: TestValidationError },
} as NodeModule;
delete require.cache[lifecyclePath];
delete require.cache[codeEvaluationPath];

const lifecycle = require(lifecyclePath) as typeof import('../src/model/problem-lifecycle');
const codeEvaluation = require(codeEvaluationPath) as typeof import('../src/model/code-evaluation-lifecycle');
const { templateSourceHash } = require('../src/lib/problem-config') as typeof import('../src/lib/problem-config');

const functionSource = ['int solve() {', '  return 1;', '}', 'int main() { return solve(); }'].join('\n');

function readyFunctionConfig() {
    return lifecycle.normalizeStructuredProblemConfig('function', {
        main: {
            mode: 'function',
            lang: 'cc.cc17',
            source: functionSource,
            sourceHash: templateSourceHash(functionSource),
            publicRanges: [{ startLine: 3, endLine: 4 }],
            regions: [{ id: '', startLine: 0, endLine: 3, title: 'solve', description: '实现 solve' }],
            cases: [{ input: '1.in', output: '1.out' }],
        },
    });
}

describe('P3.17 code evaluation lifecycle', () => {
    it('accepts only mode and language during real draft creation', () => {
        expect(codeEvaluation.normalizeCodeEvaluationCreationStatus(undefined)).to.equal(undefined);
        expect(codeEvaluation.normalizeCodeEvaluationCreationStatus('draft')).to.equal('draft');
        expect(() => codeEvaluation.normalizeCodeEvaluationCreationStatus('ready')).to.throw(/只能进入 draft/);
        expect(
            codeEvaluation.normalizeCodeEvaluationDraftCreationConfig('function', {
                main: { mode: 'function', lang: 'cc.cc17' },
            }),
        ).to.deep.equal({ main: { mode: 'function', lang: 'cc.cc17' } });
        expect(
            codeEvaluation.normalizeCodeEvaluationDraftCreationConfig('program_fill', {
                main: { mode: 'compile', lang: 'py.py3' },
            }),
        ).to.deep.equal({ main: { mode: 'compile', lang: 'py.py3' } });

        for (const [kind, config] of [
            ['function', { main: { mode: 'function', lang: '' } }],
            ['function', { main: { mode: 'compile', lang: 'cc.cc17' } }],
            ['program_fill', { main: { mode: 'text', lang: 'cc.cc17' } }],
            ['function', { main: { mode: 'function', lang: 'cc.cc17', cases: [] } }],
            ['function', { main: { mode: 'function', lang: 'cc.cc17' }, content: 'forged' }],
        ] as const) {
            expect(() => codeEvaluation.normalizeCodeEvaluationDraftCreationConfig(kind, config)).to.throw(TestValidationError);
        }
    });

    it('allows an incomplete hidden draft without inventing cases or files', () => {
        expect(
            codeEvaluation.normalizeCodeEvaluationDraftConfig('function', {
                main: { mode: 'function', lang: 'cc.cc17' },
            }),
        ).to.deep.equal({
            type: 'function',
            score: 100,
            langs: ['cc.cc17'],
            template: {
                lang: 'cc.cc17',
                source: '',
                sourceHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                publicRanges: [],
                regions: [],
            },
            cases: [],
        });

        const creationTransport = codeEvaluation.normalizeCodeEvaluationDraftCreationConfig('program_fill', {
            main: { mode: 'compile', lang: 'cc.cc17' },
        });
        const persistedDraft = codeEvaluation.normalizeCodeEvaluationDraftConfig('program_fill', creationTransport);
        expect(persistedDraft).to.deep.include({ type: 'program_fill', mode: 'compile', score: 100, langs: ['cc.cc17'] });
        expect(persistedDraft).not.to.have.property('main');
        expect(codeEvaluation.isCodeEvaluationProblem('program_fill', persistedDraft)).to.equal(true);
        expect(lifecycle.structuredProblemConfigForEditor('program_fill', persistedDraft)).to.deep.equal({
            main: {
                mode: 'compile',
                lang: 'cc.cc17',
                source: '',
                sourceHash: templateSourceHash(''),
                publicRanges: [],
                regions: [],
                cases: [],
            },
        });
    });

    it('generates stable opaque ids, accepts explicit coordinate mapping, and rejects forged ids', () => {
        const first = codeEvaluation.normalizeCodeEvaluationDraftConfig('function', {
            main: {
                mode: 'function',
                lang: 'cc.cc17',
                source: functionSource,
                publicRanges: [],
                regions: [{ id: '', startLine: 0, endLine: 3, title: 'solve' }],
                cases: [],
            },
        }) as { template: { sourceHash: string; regions: Array<{ id: string; startLine: number; endLine: number }> } };
        const id = first.template.regions[0].id;
        expect(id).to.match(/^r_[A-Za-z0-9_-]{12,32}$/);
        expect(first.template.sourceHash).to.equal(templateSourceHash(functionSource));

        const movedSource = `// header\n${functionSource}`;
        const savedAgain = codeEvaluation.normalizeCodeEvaluationDraftConfig(
            'function',
            {
                main: {
                    mode: 'function',
                    lang: 'cc.cc17',
                    source: movedSource,
                    publicRanges: [],
                    regions: [{ ...first.template.regions[0], startLine: 1, endLine: 4 }],
                    cases: [],
                    ignored: true,
                },
            },
            first,
        ) as { template: { regions: Array<{ id: string; startLine: number; endLine: number }> } };
        expect(savedAgain.template.regions[0]).to.include({ id, startLine: 1, endLine: 4 });
        expect(() =>
            codeEvaluation.normalizeCodeEvaluationDraftConfig(
                'function',
                {
                    main: {
                        mode: 'function',
                        lang: 'cc.cc17',
                        source: functionSource,
                        publicRanges: [],
                        regions: [{ ...first.template.regions[0], id: 'r_zzzzzzzzzzzz' }],
                        cases: [],
                    },
                },
                first,
            ),
        ).to.throw(/不属于当前题目/);
        const ignoredClientHash = codeEvaluation.normalizeCodeEvaluationDraftConfig(
            'function',
            {
                main: {
                    mode: 'function',
                    lang: 'cc.cc17',
                    source: functionSource,
                    sourceHash: 'forged',
                    publicRanges: [{ startLine: 3, endLine: 4, label: 'ignored' }],
                    regions: [{ ...first.template.regions[0] }],
                    cases: [],
                },
            },
            first,
        ) as { template: { sourceHash: string; publicRanges: Array<{ startLine: number; endLine: number }> } };
        expect(ignoredClientHash.template.sourceHash).to.equal(templateSourceHash(functionSource));
        expect(ignoredClientHash.template.publicRanges).to.deep.equal([{ startLine: 3, endLine: 4 }]);
    });

    it('rejects forged, incomplete, or ambiguous case filenames', () => {
        for (const cases of [
            [{ input: '../1.in', output: '1.out' }],
            [{ input: '1.in', output: '1.in' }],
            [{ input: '', output: '1.out' }],
            [{ input: '1.in' }],
            [{ input: '1.in', output: '1.out', score: 100 }],
        ]) {
            expect(() => codeEvaluation.normalizeCodeEvaluationCases(cases, false)).to.throw(TestValidationError);
        }
        expect(() => codeEvaluation.normalizeCodeEvaluationCases([], false)).to.throw(TestValidationError);
    });

    it('requires every mapped file to exist in the current physical testdata list', () => {
        const config = readyFunctionConfig();
        expect(() => codeEvaluation.assertCodeEvaluationMappingsExist(config, [{ name: '1.in' }, { name: '1.out' }], false)).not.to.throw();
        expect(() => codeEvaluation.assertCodeEvaluationMappingsExist(config, [{ name: '1.in' }], false)).to.throw(/输出文件不存在：1\.out/);
    });

    it('fails closed until a structurally valid problem is explicitly ready', () => {
        const base = {
            domainId: 'system',
            docId: 17,
            pid: 'F17',
            problemKind: 'function' as const,
            structureRevision: 3,
            config: readyFunctionConfig(),
            data: [{ name: '1.in' }, { name: '1.out' }],
        };
        expect(() => codeEvaluation.assertProblemReadyForUse({ ...base, codeEvaluationStatus: 'draft' }, { stage: 'test' })).to.throw(/草稿尚未完成/);
        expect(() =>
            codeEvaluation.assertProblemReadyForUse({ ...base, codeEvaluationStatus: 'ready', data: [{ name: '1.in' }] }, { stage: 'test' }),
        ).to.throw(/1\.out/);
        expect(() => codeEvaluation.assertProblemReadyForUse({ ...base, codeEvaluationStatus: 'ready' }, { stage: 'test' })).not.to.throw();
    });

    it('binds lifecycle status only to function and compile program-fill problems', () => {
        expect(() => codeEvaluation.assertCodeEvaluationStatusInvariant('function', { main: { mode: 'function' } }, 'draft')).not.to.throw();
        expect(() =>
            codeEvaluation.assertCodeEvaluationStatusInvariant('program_fill', { type: 'program_fill', mode: 'compile' }, 'ready'),
        ).not.to.throw();
        expect(() => codeEvaluation.assertCodeEvaluationStatusInvariant('program_fill', { type: 'program_fill', mode: 'text' }, 'draft')).to.throw(
            TestValidationError,
        );
        expect(() => codeEvaluation.assertCodeEvaluationStatusInvariant('function', { main: { mode: 'function' } }, undefined)).to.throw(
            TestValidationError,
        );
    });

    it('blocks same-name uploads and mutations that would leave dangling mappings', () => {
        const pdoc = {
            problemKind: 'function' as const,
            config: readyFunctionConfig(),
            data: [{ name: '1.in' }, { name: '1.out' }, { name: 'notes.txt' }],
        };
        expect(() => codeEvaluation.assertCodeEvaluationFileMutation(pdoc, { type: 'upload', filename: '1.in' })).to.throw(/同名测试数据已存在/);
        expect(() => codeEvaluation.assertCodeEvaluationFileMutation(pdoc, { type: 'upload', filename: '../2.in' })).to.throw(/文件名非法/);
        expect(() => codeEvaluation.assertCodeEvaluationFileMutation(pdoc, { type: 'delete', filenames: ['1.out'] })).to.throw(/测试点 1 引用/);
        expect(() =>
            codeEvaluation.assertCodeEvaluationFileMutation(pdoc, {
                type: 'rename',
                filename: '1.in',
                newFilename: '2.in',
            }),
        ).to.throw(/测试点 1 引用/);
        expect(() =>
            codeEvaluation.assertCodeEvaluationFileMutation(pdoc, {
                type: 'rename',
                filename: 'notes.txt',
                newFilename: '1.out',
            }),
        ).to.throw(/目标文件名已存在/);
        expect(() => codeEvaluation.assertCodeEvaluationFileMutation(pdoc, { type: 'delete', filenames: ['notes.txt'] })).not.to.throw();
    });

    it('permits only the completion service to atomically transition draft to ready', () => {
        expect(() =>
            codeEvaluation.assertCodeEvaluationStatusTransition('draft', { codeEvaluationStatus: 'ready' }, {}, 'code-evaluation-complete'),
        ).not.to.throw();
        for (const [current, set, unset, operation] of [
            ['draft', { codeEvaluationStatus: 'ready' }, {}, 'raw-edit'],
            ['ready', { codeEvaluationStatus: 'ready' }, {}, 'code-evaluation-complete'],
            ['draft', { codeEvaluationStatus: 'draft' }, {}, 'code-evaluation-complete'],
            ['draft', {}, { codeEvaluationStatus: '' }, 'code-evaluation-complete'],
        ] as const) {
            expect(() => codeEvaluation.assertCodeEvaluationStatusTransition(current, set, unset, operation)).to.throw(TestValidationError);
        }
    });

    it('rejects config changes that detach status from its code-evaluation kind', () => {
        const current = {
            domainId: 'system',
            docId: 9,
            problemKind: 'program_fill' as const,
            config: { type: 'program_fill', mode: 'compile' },
            codeEvaluationStatus: 'ready' as const,
            data: [{ name: '1.in' }, { name: '1.out' }],
        };
        expect(() =>
            codeEvaluation.assertCodeEvaluationLifecyclePatch(current, { config: { type: 'program_fill', mode: 'text' } }, {}, 'raw-edit'),
        ).to.throw(TestValidationError);
        expect(() => codeEvaluation.assertCodeEvaluationLifecyclePatch(current, { 'config.mode': 'text' }, {}, 'raw-edit')).to.throw(/必须整体写入/);
        expect(() => codeEvaluation.assertCodeEvaluationLifecyclePatch(current, {}, { config: '' }, 'raw-edit')).to.throw(TestValidationError);
    });

    it('allows testdata metadata changes only through the physical file services', () => {
        const draft = {
            domainId: 'system',
            docId: 9,
            problemKind: 'function' as const,
            config: { main: { mode: 'function', lang: 'cc.cc17' } },
            codeEvaluationStatus: 'draft' as const,
            data: [],
        };
        const forged = { data: [{ name: 'ghost.in' }, { name: 'ghost.out' }] };
        for (const operation of ['raw-edit', 'acl-guarded-update', 'metadata-edit']) {
            expect(() => codeEvaluation.assertCodeEvaluationLifecyclePatch(draft, forged, {}, operation)).to.throw(/只能由测试数据文件服务写入/);
        }
        expect(() => codeEvaluation.assertCodeEvaluationLifecyclePatch(draft, forged, {}, 'files-upload')).to.throw(/只能由测试数据文件服务写入/);
        expect(() =>
            codeEvaluation.assertCodeEvaluationLifecyclePatch(draft, forged, {}, 'files-upload', { physicalTestdataMutation: true }),
        ).not.to.throw();
    });
});
