import { createRequire } from 'node:module';
import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
const requireFromFramework = createRequire(require.resolve('../../../framework/framework/package.json'));
const { ObjectId } = requireFromFramework('mongodb');
const dbPath = require.resolve('../src/db.ts');
const originalLoad = Module._load;

let nodes: any[] = [];
let maps: any[] = [];
let failDescendantInsert = true;
let failMapInsertAfterWrite = false;
let failRootInsertAfterWrite = false;

function same(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId && right instanceof ObjectId) return (left as any).equals(right);
    if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
    return left === right;
}

function matches(document: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([key, value]) => same(document[key], value));
}

const nodesColl = {
    async createIndex() {
        return 'test-index';
    },
    async estimatedDocumentCount() {
        return nodes.length;
    },
    async countDocuments(filter: Record<string, unknown>) {
        return nodes.filter((node) => matches(node, filter)).length;
    },
    async insertOne(node: any) {
        nodes.push(node);
        if (failRootInsertAfterWrite) throw new Error('simulated root insert acknowledgement loss');
        return { insertedId: node._id };
    },
    async insertMany(documents: any[]) {
        if (failDescendantInsert) {
            if (documents[0]) nodes.push(documents[0]);
            throw new Error('simulated partial descendant insert');
        }
        nodes.push(...documents);
        return { insertedCount: documents.length };
    },
    async deleteMany(filter: Record<string, unknown>) {
        const before = nodes.length;
        nodes = nodes.filter((node) => !matches(node, filter));
        return { deletedCount: before - nodes.length };
    },
};

const mapsColl = {
    async createIndex() {
        return 'test-index';
    },
    async estimatedDocumentCount() {
        return maps.length;
    },
    async findOne(filter: Record<string, unknown>) {
        return maps.find((map) => matches(map, filter)) || null;
    },
    async insertOne(map: any) {
        maps.push(map);
        if (failMapInsertAfterWrite) throw new Error('simulated map insert acknowledgement loss');
        return { insertedId: map._id };
    },
    async deleteOne(filter: Record<string, unknown>) {
        const index = maps.findIndex((map) => matches(map, filter));
        if (index < 0) return { deletedCount: 0 };
        maps.splice(index, 1);
        return { deletedCount: 1 };
    },
};

const dbStub = {
    collection(name: string) {
        if (name === 'mindmap.nodes') return nodesColl;
        if (name === 'mindmap.maps') return mapsColl;
        throw new Error(`unexpected collection ${name}`);
    },
};

class Logger {
    info() {}
    warn() {}
}

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === dbPath && request === 'hydrooj') {
        return {
            db: dbStub,
            ObjectId,
            SystemModel: { get: () => ({ 基础算法: ['二分'] }) },
        };
    }
    if (parent?.filename === dbPath && request === '@hydrooj/utils') return { Logger };
    return originalLoad.call(this, request, parent, isMain);
};

let mindmapDb: typeof import('../src/db');
try {
    delete require.cache[dbPath];
    mindmapDb = require(dbPath);
} finally {
    Module._load = originalLoad;
}

beforeEach(() => {
    nodes = [];
    maps = [];
    failDescendantInsert = true;
    failMapInsertAfterWrite = false;
    failRootInsertAfterWrite = false;
});

describe('mindmap fresh-install seed compensation', () => {
    it('cleans both collections when either initial insert commits before reporting failure', async () => {
        for (const failedWrite of ['map', 'root'] as const) {
            nodes = [];
            maps = [];
            failMapInsertAfterWrite = failedWrite === 'map';
            failRootInsertAfterWrite = failedWrite === 'root';
            const now = new Date('2026-07-20T00:00:00.000Z');
            const mapId = new ObjectId();
            const rootId = new ObjectId();
            const map = {
                _id: mapId,
                title: 'Test',
                rootNodeId: rootId,
                visibility: 'hidden',
                layoutDirection: 'RIGHT',
                createdAt: now,
                updatedAt: now,
            };
            const root = {
                _id: rootId,
                mapId,
                parentId: null,
                topic: 'Root',
                tags: [],
                problemIds: [],
                order: 0,
                createdAt: now,
                updatedAt: now,
            };

            let failure: unknown;
            try {
                await mindmapDb.insertMapWithRoot(map as any, root as any);
            } catch (error) {
                failure = error;
            }
            expect(failure).to.be.instanceOf(Error);
            expect((failure as Error).message).to.include(`simulated ${failedWrite} insert acknowledgement loss`);
            expect(nodes).to.deep.equal([]);
            expect(maps).to.deep.equal([]);
        }
    });

    it('removes a partially inserted tree so a clean retry can complete', async () => {
        let failure: unknown;
        try {
            await mindmapDb.seedDefaultMapIfEmpty();
        } catch (error) {
            failure = error;
        }
        expect(failure).to.be.instanceOf(Error);
        expect((failure as Error).message).to.include('simulated partial descendant insert');
        expect(nodes).to.deep.equal([]);
        expect(maps).to.deep.equal([]);

        failDescendantInsert = false;
        await mindmapDb.seedDefaultMapIfEmpty();
        expect(maps).to.have.lengthOf(1);
        expect(nodes).to.have.lengthOf(3);
        expect(nodes.every((node) => node.mapId.equals(maps[0]._id))).to.equal(true);
    });
});
