import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
const modelPath = require.resolve('../src/model.ts');
const originalLoad = Module._load;

const nodeId = { toString: () => 'mindmap-node' };
let currentNode: any = null;
let resultDocs: any[] = [];
const documentCalls: Array<{
    filter: unknown;
    limit?: number;
    projection?: unknown;
}> = [];

const documentColl = {
    find(filter: unknown) {
        const call: (typeof documentCalls)[number] = { filter };
        documentCalls.push(call);
        const cursor: any = {
            project(projection: unknown) {
                call.projection = projection;
                return cursor;
            },
            limit(limit: number) {
                call.limit = limit;
                return cursor;
            },
            async toArray() {
                return resultDocs;
            },
        };
        return cursor;
    },
};

const nodesColl = {
    async findOne(filter: unknown) {
        expect(filter).to.deep.equal({ _id: nodeId });
        return currentNode;
    },
};

const dbStub = {
    collection(name: string) {
        expect(name).to.equal('document');
        return documentColl;
    },
};

const mindmapDbStub = {
    configColl: {},
    getConfig: async () => ({}),
    nodesColl,
    setConfig: async () => undefined,
};

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === modelPath && request === 'hydrooj') {
        return { ObjectId: class {}, db: dbStub };
    }
    if (parent?.filename === modelPath && request === './db') return mindmapDbStub;
    return originalLoad.call(this, request, parent, isMain);
};

let listProblemsForNode: typeof import('../src/model').listProblemsForNode;
try {
    delete require.cache[modelPath];
    ({ listProblemsForNode } = require(modelPath));
} finally {
    Module._load = originalLoad;
}

beforeEach(() => {
    currentNode = null;
    resultDocs = [];
    documentCalls.length = 0;
});

describe('mindmap problem query scope', () => {
    it('pushes the caller scope into Mongo while preserving clauses, projection, and limit', async () => {
        currentNode = {
            _id: nodeId,
            tags: ['dynamic-programming'],
            problemIds: ['P9', '10'],
        };
        resultDocs = [
            {
                pid: 'P9',
                title: 'Scoped problem',
                nSubmit: 10,
                nAccept: 5,
            },
        ];
        const scope = { $or: [{ owner: 42 }, { docId: { $in: [9] } }] };

        const problems = await listProblemsForNode('system', nodeId as any, scope as any);

        expect(documentCalls).to.have.lengthOf(1);
        expect(documentCalls[0]).to.deep.equal({
            filter: {
                $and: [
                    scope,
                    {
                        docType: 10,
                        domainId: 'system',
                        hidden: { $ne: true },
                        $or: [{ tag: { $in: ['dynamic-programming'] } }, { pid: { $in: ['P9', '10'] } }, { docId: { $in: [10] } }],
                    },
                ],
            },
            projection: { pid: 1, docId: 1, title: 1, nSubmit: 1, nAccept: 1 },
            limit: 500,
        });
        expect(problems).to.deep.equal([
            {
                pid: 'P9',
                title: 'Scoped problem',
                nSubmit: 10,
                nAccept: 5,
                difficulty: 3,
            },
        ]);
    });

    it('keeps the administrator empty scope global inside the existing domain query', async () => {
        currentNode = { _id: nodeId, tags: ['graph'], problemIds: [] };

        await listProblemsForNode('system', nodeId as any, {});

        expect(documentCalls).to.have.lengthOf(1);
        expect((documentCalls[0].filter as any).$and[0]).to.deep.equal({});
        expect((documentCalls[0].filter as any).$and[1]).to.include({
            docType: 10,
            domainId: 'system',
        });
    });

    it('returns an empty list without querying documents for a missing or clause-less node', async () => {
        expect(await listProblemsForNode('system', nodeId as any, {})).to.deep.equal([]);
        currentNode = { _id: nodeId, tags: [], problemIds: [] };
        expect(await listProblemsForNode('system', nodeId as any, {})).to.deep.equal([]);
        expect(documentCalls).to.deep.equal([]);
    });
});
