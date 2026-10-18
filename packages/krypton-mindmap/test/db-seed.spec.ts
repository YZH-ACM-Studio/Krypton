import { createRequire } from 'node:module';
import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
const requireFromFramework = createRequire(require.resolve('../../../framework/framework/package.json'));
const { ObjectId } = requireFromFramework('mongodb');
const dbPath = require.resolve('../src/db.ts');
const originalLoad = Module._load;

interface RecordedIndex {
    collection: string;
    keys: Record<string, unknown>;
    options: Record<string, unknown>;
}

let nodes: any[] = [];
let maps: any[] = [];
let failDescendantInsert = true;
let failMapInsertAfterWrite = false;
let failRootInsertAfterWrite = false;
const indexCalls: RecordedIndex[] = [];

function recordIndex(collection: string, keys: Record<string, unknown>, options?: Record<string, unknown>) {
    indexCalls.push({ collection, keys, options: options || {} });
    return 'test-index';
}

function same(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId && right instanceof ObjectId) return (left as any).equals(right);
    if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
    return left === right;
}

function isExistsOperator(value: unknown): value is { $exists: unknown } {
    return Boolean(value)
        && typeof value === 'object'
        && !Array.isArray(value)
        && !(value instanceof ObjectId)
        && !(value instanceof Date)
        && Object.hasOwn(value, '$exists');
}

function matches(document: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([key, value]) => {
        if (!isExistsOperator(value)) return same(document[key], value);
        const exists = Object.hasOwn(document, key);
        return value.$exists ? exists : !exists;
    });
}

const nodesColl = {
    async createIndex(keys: Record<string, unknown>, options?: Record<string, unknown>) {
        return recordIndex('mindmap.nodes', keys, options);
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
    async createIndex(keys: Record<string, unknown>, options?: Record<string, unknown>) {
        return recordIndex('mindmap.maps', keys, options);
    },
    async estimatedDocumentCount() {
        return maps.length;
    },
    async countDocuments(filter: Record<string, unknown> = {}) {
        return maps.filter((map) => matches(map, filter)).length;
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
    indexCalls.length = 0;
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

    it('seeds an empty library as one merged map and one root', async () => {
        failDescendantInsert = false;
        await mindmapDb.seedDefaultMapIfEmpty();
        expect(maps.length).to.equal(1);
        expect(nodes.length).to.equal(1);
        const map = maps[0];
        const root = nodes[0];
        expect(root.parentId).to.equal(null);
        expect(root.topic).to.equal('知识图谱');
        expect(Object.hasOwn(root, 'coursePins')).to.equal(false);
        expect(root.mapId.equals(map._id)).to.equal(true);
        expect(Object.hasOwn(map, 'isDefault')).to.equal(false);
        expect(Object.hasOwn(map, 'ownerDomainId')).to.equal(false);
        expect(Object.hasOwn(map, 'ownerCourseId')).to.equal(false);
        const merged = await (mindmapDb as typeof mindmapDb & {
            getMergedMap(): Promise<{ _id: { equals(other: unknown): boolean }; rootNodeId: { equals(other: unknown): boolean } }>;
        }).getMergedMap();
        expect(merged._id.equals(map._id)).to.equal(true);
        expect(merged.rootNodeId.equals(root._id)).to.equal(true);
    });
});

function recordedName(call: RecordedIndex): string {
    return typeof call.options.name === 'string' ? call.options.name : '';
}

function hasKeys(call: RecordedIndex, keys: Record<string, number>): boolean {
    return JSON.stringify(call.keys) === JSON.stringify(keys);
}

describe('mindmap indexes for the merged knowledge graph', () => {
    it('stops creating the retired default-map and per-course indexes', async () => {
        await mindmapDb.ensureIndexes();
        const retired = indexCalls.map(recordedName).filter((name) => name === 'mindmap_one_default_map' || name === 'mindmap_one_map_per_course');
        expect(retired).to.deep.equal([]);
        expect(indexCalls.some((call) => hasKeys(call, { isDefault: 1 }))).to.equal(false);
        expect(indexCalls.some((call) => hasKeys(call, { ownerDomainId: 1, ownerCourseId: 1 }))).to.equal(false);
        expect(indexCalls.some((call) => call.collection === 'mindmap.nodes' && hasKeys(call, { mapId: 1, parentId: 1, order: 1, _id: 1 }))).to.equal(true);
        expect(indexCalls.some((call) => call.collection === 'mindmap.nodes' && hasKeys(call, { mapId: 1, tags: 1 }))).to.equal(true);
        const rootIndex = indexCalls.find((call) => recordedName(call) === 'mindmap_one_root_per_map');
        expect(rootIndex?.collection).to.equal('mindmap.nodes');
        expect(rootIndex?.options.unique).to.equal(true);
        const partial = rootIndex?.options.partialFilterExpression as { parentId?: unknown } | undefined;
        expect(partial?.parentId).to.equal(null);
        expect(indexCalls.some((call) => call.collection === 'mindmap.maps' && hasKeys(call, { visibility: 1, title: 1, _id: 1 }))).to.equal(true);
    });
});
