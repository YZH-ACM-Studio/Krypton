import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

(global as any).Hydro ||= { model: {} };

class TestValidationError extends Error {
    name = 'ValidationError';
}

const counts = new Map<string, number>();
const collectionQueries: Array<{ name: string, query: any }> = [];
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
        async findOne() { return null; },
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
    id: dbPath, filename: dbPath, loaded: true, exports: { __esModule: true, default: dbStub },
} as NodeModule;
require.cache[documentPath] = {
    id: documentPath, filename: documentPath, loaded: true, exports: documentStub,
} as NodeModule;
require.cache[errorPath] = {
    id: errorPath, filename: errorPath, loaded: true,
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
    it('keeps content as the only statement and fixes the structured score at 100', () => {
        expect(lifecycle.normalizeStructuredProblemConfig('single', {
            main: { options: ['A', 'B'] }, score: 1,
        })).to.deep.equal({ main: { options: ['A', 'B'] }, score: 100 });
        for (const config of [
            {},
            { main: {}, meta: { prompt: 'duplicate' } },
            { main: {}, testdataSourcePid: 8 },
        ]) {
            expect(() => lifecycle.normalizeStructuredProblemConfig('single', config))
                .to.throw(TestValidationError);
        }
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
            'record', 'record.stat', 'mindmap.nodes', 'tasks.tasks',
            'vigil.paper_draft', 'problem.permits', 'problem.permitSources',
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
