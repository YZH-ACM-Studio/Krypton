import { expect } from 'chai';
import { describe, it } from 'node:test';

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
    exports: { ValidationError: TestValidationError },
} as NodeModule;
delete require.cache[lifecyclePath];
delete require.cache[codeEvaluationPath];

const lifecycle = require(lifecyclePath) as typeof import('../src/model/problem-lifecycle');
const codeEvaluation = require(codeEvaluationPath) as typeof import('../src/model/code-evaluation-lifecycle');

const functionSource = ['// @krypton-region solve', 'int solve() {', '  return 1;', '}', '// @krypton-endregion solve'].join('\n');

function readyFunctionConfig() {
    return lifecycle.normalizeStructuredProblemConfig('function', {
        main: {
            mode: 'function',
            lang: 'cc.cc17',
            markerSource: functionSource,
            regions: [{ id: 'solve', prompt: '实现 solve' }],
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
            type: 'fill_function',
            subType: 'function',
            score: 100,
            langs: ['cc.cc17'],
            main: { mode: 'function', lang: 'cc.cc17', markerSource: '', regions: [], cases: [] },
        });
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
        expect(() => codeEvaluation.assertCodeEvaluationStatusInvariant('program_fill', { main: { mode: 'compile' } }, 'ready')).not.to.throw();
        expect(() => codeEvaluation.assertCodeEvaluationStatusInvariant('program_fill', { main: { mode: 'text' } }, 'draft')).to.throw(
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
            config: { main: { mode: 'compile', lang: 'cc.cc17' } },
            codeEvaluationStatus: 'ready' as const,
            data: [{ name: '1.in' }, { name: '1.out' }],
        };
        expect(() =>
            codeEvaluation.assertCodeEvaluationLifecyclePatch(current, { config: { main: { mode: 'text', answer: 'i++' } } }, {}, 'raw-edit'),
        ).to.throw(TestValidationError);
        expect(() => codeEvaluation.assertCodeEvaluationLifecyclePatch(current, { 'config.main.mode': 'text' }, {}, 'raw-edit')).to.throw(
            /必须整体写入/,
        );
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
