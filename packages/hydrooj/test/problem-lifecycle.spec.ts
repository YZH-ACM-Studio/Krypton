import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

(global as any).Hydro ||= { model: {} };

class TestValidationError extends Error {
    name = 'ValidationError';
}

const counts = new Map<string, number>();
const collectionQueries: Array<{ name: string; query: any }> = [];
const documentQueries: any[] = [];
let failingCollection = '';

const dbStub = {
    collection(name: string) {
        return {
            async countDocuments(query: any) {
                collectionQueries.push({ name, query: structuredClone(query) });
                if (name === failingCollection) throw new Error(`query failed: ${name}`);
                return counts.get(name) || 0;
            },
        };
    },
};

const documentStub = {
    TYPE_PROBLEM: 10,
    TYPE_PROBLEM_SOLUTION: 11,
    TYPE_DISCUSSION: 21,
    TYPE_CONTEST: 30,
    TYPE_TRAINING: 40,
    coll: {
        async countDocuments(query: any) {
            documentQueries.push(structuredClone(query));
            return counts.get(`document:${query.docType}:${query.parentType || ''}`) || 0;
        },
        async findOne() {
            return null;
        },
    },
    collStatus: {
        async countDocuments(query: any) {
            documentQueries.push(structuredClone(query));
            return counts.get('document.status') || 0;
        },
    },
};

const dbPath = require.resolve('../src/service/db.ts');
const documentPath = require.resolve('../src/model/document.ts');
const errorPath = require.resolve('../src/error.ts');
const lifecyclePath = require.resolve('../src/model/problem-lifecycle.ts');
const previous = new Map<string, NodeModule | undefined>([
    [dbPath, require.cache[dbPath]],
    [documentPath, require.cache[documentPath]],
    [errorPath, require.cache[errorPath]],
    [lifecyclePath, require.cache[lifecyclePath]],
]);

require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { __esModule: true, default: dbStub },
} as NodeModule;
require.cache[documentPath] = {
    id: documentPath,
    filename: documentPath,
    loaded: true,
    exports: documentStub,
} as NodeModule;
require.cache[errorPath] = {
    id: errorPath,
    filename: errorPath,
    loaded: true,
    exports: { ValidationError: TestValidationError },
} as NodeModule;
delete require.cache[lifecyclePath];

const lifecycle = require(lifecyclePath) as typeof import('../src/model/problem-lifecycle');

beforeEach(() => {
    counts.clear();
    collectionQueries.length = 0;
    documentQueries.length = 0;
    failingCollection = '';
});

describe('P2.12 minimal problem lifecycle', () => {
    for (const failureStage of ['problem/add', 'problem.create audit'] as const) {
        it(`captures the exact inserted docId before a ${failureStage} failure`, async () => {
            let persistedDocId: number | null = null;
            let emitted = false;
            let audited = false;
            let caught: Error | null = null;
            try {
                await lifecycle.completePersistedProblemCreate(
                    3101,
                    (docId) => {
                        persistedDocId = docId;
                    },
                    async () => {
                        emitted = true;
                        if (failureStage === 'problem/add') throw new Error('injected problem/add failure');
                    },
                    async () => {
                        audited = true;
                        if (failureStage === 'problem.create audit') throw new Error('injected problem.create audit failure');
                    },
                );
            } catch (error) {
                caught = error as Error;
            }
            expect(caught?.message).to.include(`injected ${failureStage} failure`);
            expect(persistedDocId).to.equal(3101);
            expect(emitted).to.equal(true);
            expect(audited).to.equal(failureStage === 'problem.create audit');
        });
    }

    it('records every created problem field that varies by create input', () => {
        expect(lifecycle.problemCreateChangedFields('programming', {})).not.to.include('config');
        expect(
            lifecycle.problemCreateChangedFields('multi', {
                pid: 'M1',
                difficulty: 3,
                reference: { domainId: 'system', pid: 1 },
            }),
        ).to.include.members(['pid', 'difficulty', 'reference', 'config']);
        expect(lifecycle.problemCreateChangedFields('blank', {})).to.include('config');
        expect(
            lifecycle.problemCreateChangedFields('programming', {
                authoringMode: 'managed',
                sourceMeta: { template: 'self' },
                managedAuthoring: { metadataStatus: 'draft' },
            }),
        ).to.include.members(['authoringMode', 'sourceMeta', 'managedAuthoring']);
    });

    it('audits the sort key derived when a custom problem id is set or cleared', () => {
        expect(lifecycle.problemEditAuditedFields({ pid: 'NEW-ID' })).to.deep.equal(['pid', 'sort']);
        expect(lifecycle.problemEditAuditedFields({ pid: '' })).to.deep.equal(['pid', 'sort']);
        expect(lifecycle.problemEditAuditedFields({ title: 'Only metadata' })).to.deep.equal(['title']);
    });

    it('treats managed review metadata as revision-bound structure', () => {
        expect(lifecycle.PROBLEM_STRUCTURAL_FIELDS.has('managedAuthoring')).to.equal(true);
    });

    it('keeps editorial fields revision-bound without freezing them after historical submissions', () => {
        expect(lifecycle.PROBLEM_STRUCTURAL_FIELDS.has('content')).to.equal(true);
        expect(lifecycle.PROBLEM_STRUCTURAL_FIELDS.has('additional_file')).to.equal(true);
        expect(lifecycle.PROBLEM_SUBMISSION_LOCKED_FIELDS.has('content')).to.equal(false);
        expect(lifecycle.PROBLEM_SUBMISSION_LOCKED_FIELDS.has('additional_file')).to.equal(false);
        expect(lifecycle.PROBLEM_SUBMISSION_LOCKED_FIELDS.has('config')).to.equal(true);
        expect(lifecycle.PROBLEM_SUBMISSION_LOCKED_FIELDS.has('problemKind')).to.equal(true);
        expect(lifecycle.PROBLEM_SUBMISSION_LOCKED_FIELDS.has('managedAuthoring')).to.equal(true);
    });

    it('keeps an exact hidden managed draft editable while its author validates submissions', () => {
        const draft = {
            problemKind: 'programming' as const,
            hidden: true,
            authoringMode: 'managed' as const,
            managedAuthoring: { metadataStatus: 'draft' as const },
            structureRevision: 7,
        };

        expect(lifecycle.shouldClaimSubmissionStructureLock(draft, true)).to.equal(false);
        expect(lifecycle.shouldClaimSubmissionStructureLock({ ...draft, hidden: false }, true)).to.equal(true);
        expect(lifecycle.shouldClaimSubmissionStructureLock({ ...draft, managedAuthoring: { metadataStatus: 'confirmed' as const } }, true)).to.equal(
            true,
        );
        expect(lifecycle.shouldClaimSubmissionStructureLock({ ...draft, authoringMode: undefined }, true)).to.equal(true);
        expect(lifecycle.shouldClaimSubmissionStructureLock({ ...draft, managedAuthoring: undefined }, true)).to.equal(true);
        expect(lifecycle.shouldClaimSubmissionStructureLock({ ...draft, structureLockedAt: new Date() }, true)).to.equal(false);
        expect(lifecycle.shouldClaimSubmissionStructureLock(draft, false)).to.equal(false);
    });

    it('accepts explicit flat or subtask programming test points and verifies their files', () => {
        expect(() =>
            lifecycle.assertProgrammingTestcasesConfigured({ cases: [{ input: '1.in', output: '1.out' }] }, [{ name: '1.in' }, { name: '1.out' }]),
        ).not.to.throw();
        expect(() =>
            lifecycle.assertProgrammingTestcasesConfigured(
                {
                    subtasks: [
                        { id: 1, cases: [{ input: '1.in', output: '1.out' }] },
                        { id: 2, cases: [{ input: '2.in', output: '2.out' }] },
                    ],
                },
                [{ name: '1.in' }, { name: '1.out' }, { name: '2.in' }, { name: '2.out' }],
            ),
        ).not.to.throw();
    });

    it('does not infer publishable programming test points from uploaded files', () => {
        expect(() =>
            lifecycle.assertProgrammingTestcasesConfigured('time: 1s\nmemory: 256m\n', [
                { name: 'config.yaml' },
                { name: '1.in' },
                { name: '1.out' },
            ]),
        ).to.throw(TestValidationError);
        expect(() =>
            lifecycle.assertProgrammingTestcasesConfigured({ subtasks: [{ id: 1, cases: [{ input: 'missing.in', output: '1.out' }] }] }, [
                { name: '1.out' },
            ]),
        ).to.throw(TestValidationError);
    });

    it('keeps content as the only statement and fixes the structured score at 100', () => {
        expect(
            lifecycle.normalizeStructuredProblemConfig('single', {
                main: { options: ['Alpha', 'Beta'], answerIndex: 1 },
                score: 1,
            }),
        ).to.deep.equal({
            type: 'objective',
            score: 100,
            main: { options: ['Alpha', 'Beta'], answerIndex: 1 },
            answers: { main: ['B', 100, { kind: 'single', choices: ['Alpha', 'Beta'] }] },
            options: { main: ['Alpha', 'Beta'] },
        });
        for (const config of [{}, { main: {}, meta: { prompt: 'duplicate' } }, { main: {}, testdataSourcePid: 8 }]) {
            expect(() => lifecycle.normalizeStructuredProblemConfig('single', config)).to.throw(TestValidationError);
        }
    });

    it('normalizes all basic single-problem objective kinds and validates on the server', () => {
        expect(lifecycle.normalizeStructuredProblemConfig('true_false', { main: { answer: false } })).to.have.nested.property('answers.main[0]', 'B');
        expect(lifecycle.normalizeStructuredProblemConfig('blank', { main: { answer: 'CaseSensitive' } })).to.have.nested.property(
            'answers.main[0]',
            'CaseSensitive',
        );
        const multi = lifecycle.normalizeStructuredProblemConfig('multi', {
            main: { options: ['A1', 'B1', 'C1'], answerIndexes: [2, 0], partialCreditPercent: 35 },
        });
        expect(multi).to.have.nested.property('answers.main[2].partialCreditPercent', 35);
        expect(multi).to.have.nested.property('answers.main[0]').that.deep.equals(['A', 'C']);
        expect(
            lifecycle.normalizeStructuredProblemConfig('multi', {
                main: { options: ['A1', 'B1'], answerIndexes: [0] },
            }),
        ).to.have.nested.property('main.partialCreditPercent', 0);

        for (const [kind, config] of [
            ['single', { main: { options: ['same', 'same'], answerIndex: 0 } }],
            ['single', { main: { options: ['a', 'b'], answerIndex: 3 } }],
            ['multi', { main: { options: ['a', 'b'], answerIndexes: [], partialCreditPercent: 0 } }],
            ['multi', { main: { options: ['a', 'b'], answerIndexes: [0], partialCreditPercent: 1.5 } }],
            ['true_false', { main: { answer: 'true' } }],
            ['blank', { main: { answer: '   ' } }],
        ] as const) {
            expect(() => lifecycle.normalizeStructuredProblemConfig(kind, config)).to.throw(TestValidationError);
        }
    });

    it('normalizes a single subjective problem without an automatic answer', () => {
        expect(
            lifecycle.normalizeStructuredProblemConfig('subjective', {
                main: { gradingInstructions: 'Award for reasoning.' },
            }),
        ).to.deep.equal({
            type: 'objective',
            score: 100,
            main: { gradingInstructions: 'Award for reasoning.' },
            answers: { main: ['', 100, { kind: 'subjective' }] },
        });
        expect(() =>
            lifecycle.normalizeStructuredProblemConfig('subjective', {
                main: { gradingInstructions: 42 },
            }),
        ).to.throw(TestValidationError);
    });

    it('normalizes text and compile program-fill modes without sharing schemas', () => {
        const text = lifecycle.normalizeStructuredProblemConfig('program_fill', {
            main: {
                mode: 'text',
                lang: '',
                source: ['for (;;) {', 'i++;', 'j++;', '}'].join('\n'),
                regions: [
                    { id: '', startLine: 1, endLine: 2, order: 1 },
                    { id: '', startLine: 2, endLine: 3, order: 0, prompt: '第二空' },
                ],
            },
        });
        expect(text).to.include({ type: 'program_fill', mode: 'text', score: 100 });
        expect(text).not.to.have.property('main');
        expect(text).not.to.have.property('answers');
        expect(text).not.to.have.property('cases');
        expect(text).to.have.nested.property('template.regions').with.length(2);
        expect(() =>
            lifecycle.normalizeStructuredProblemConfig('program_fill', {
                main: {
                    mode: 'text',
                    lang: '',
                    source: 'i++;\nj++;',
                    regions: [{ id: '', startLine: 0, endLine: 2, order: 0 }],
                },
            }),
        ).to.throw(TestValidationError);

        const compiled = lifecycle.normalizeStructuredProblemConfig('program_fill', {
            main: {
                mode: 'compile',
                lang: 'cc.cc17',
                source: ['int main() {', 'i++;', '}'].join('\n'),
                regions: [
                    { id: '', startLine: 1, endLine: 2, order: 1, prompt: '填写一行' },
                    { id: '', startLine: 2, endLine: 3, order: 0 },
                ],
                cases: [{ input: '1.in', output: '1.out' }],
            },
        });
        expect(compiled).to.include({
            type: 'program_fill',
            mode: 'compile',
            score: 100,
        });
        expect(compiled).to.have.nested.property('template.lang', 'cc.cc17');
        expect(compiled)
            .to.have.nested.property('template.regions[0].id')
            .that.matches(/^r_[A-Za-z0-9_-]{12,32}$/);
        expect(lifecycle.structuredProblemUsesTestdata('program_fill', compiled)).to.equal(true);
        expect(
            lifecycle.structuredProblemUsesTestdata('program_fill', {
                type: 'program_fill',
                mode: 'text',
            }),
        ).to.equal(false);
        expect(
            lifecycle.structuredProblemUsesTestdata('program_fill', {
                type: 'program_fill',
                mode: 'compile',
            }),
        ).to.equal(true);
    });

    it('normalizes function problems with multiple multi-line regions', () => {
        const compiled = lifecycle.normalizeStructuredProblemConfig('function', {
            main: {
                mode: 'function',
                lang: 'cc.cc17',
                source: ['int first() {', '  return 1;', '}', 'int second() {', '  return 2;', '}'].join('\n'),
                regions: [
                    { id: '', startLine: 0, endLine: 3, order: 1, signature: 'int first()' },
                    { id: '', startLine: 3, endLine: 6, order: 0, signature: 'int second()', description: '第二个函数' },
                ],
                cases: [{ input: '1.in', output: '1.out' }],
            },
        });
        expect(compiled).to.include({ type: 'function', score: 100 });
        expect(compiled).to.have.nested.property('template.regions').with.length(2);
        expect(compiled).to.have.nested.property('template.regions[0].description', '第二个函数');
        expect(lifecycle.structuredProblemUsesTestdata('function', compiled)).to.equal(true);
    });

    it('creates an immutable different-language clone config with the same private source hash', () => {
        const source = lifecycle.normalizeStructuredProblemConfig('function', {
            main: {
                mode: 'function',
                lang: 'cc.cc17',
                source: 'int solve() { return 1; }',
                regions: [{ id: '', startLine: 0, endLine: 1, order: 0, signature: 'int solve()' }],
                cases: [{ input: '1.in', output: '1.out' }],
            },
        });
        const clone = lifecycle.cloneStructuredProblemForLanguage('function', source, 'py.py3');
        expect(clone).to.have.nested.property('template.lang', 'py.py3');
        expect(clone).to.have.nested.property('langs[0]', 'py.py3');
        expect(clone).to.have.nested.property('template.source', (source as any).template.source);
        expect(clone).to.have.nested.property('template.sourceHash', (source as any).template.sourceHash);
        expect(() => lifecycle.cloneStructuredProblemForLanguage('function', source, 'cc.cc17')).to.throw(TestValidationError);
    });

    it('runs the fixed reference scan and reports every reference class', async () => {
        counts.set('document:30:', 1);
        counts.set('document:40:', 2);
        counts.set('record', 3);
        counts.set('record.stat', 4);
        counts.set('document.status', 5);
        counts.set('document:10:', 6);
        counts.set('document:11:10', 7);
        counts.set('document:21:10', 8);
        counts.set('mindmap.nodes', 9);
        counts.set('tasks.tasks', 10);
        counts.set('vigil.paper_draft', 11);
        counts.set('problem.permits', 12);
        counts.set('problem.permitSources', 13);

        const report = await lifecycle.findProblemReferences('system', 42, 'P42');
        expect(report).to.deep.equal({
            containers: 1,
            trainingCourses: 2,
            records: 7,
            statuses: 5,
            problemReferences: 6,
            solutionsDiscussions: 15,
            mindmap: 9,
            tasks: 10,
            paperDrafts: 11,
            permits: 25,
            testdataSources: 6,
        });
        expect(lifecycle.problemReferenceCount(report)).to.equal(97);
        expect(collectionQueries.map((item) => item.name)).to.include.members([
            'record',
            'record.stat',
            'mindmap.nodes',
            'tasks.tasks',
            'vigil.paper_draft',
            'problem.permits',
            'problem.permitSources',
        ]);
        const reverseReferenceQuery = documentQueries.find((query) => query['reference.domainId']);
        expect(reverseReferenceQuery).to.deep.equal({
            docType: 10,
            'reference.domainId': 'system',
            'reference.pid': 42,
        });
    });

    it('fails closed when any fixed reference query fails', async () => {
        failingCollection = 'tasks.tasks';
        const error = await lifecycle.findProblemReferences('system', 42, 'P42').catch((caught) => caught);
        expect(error).to.be.instanceOf(Error);
        expect(error.message).to.equal('query failed: tasks.tasks');
    });
});

process.on('exit', () => {
    for (const [path, cached] of previous) {
        if (cached) require.cache[path] = cached;
        else delete require.cache[path];
    }
});
