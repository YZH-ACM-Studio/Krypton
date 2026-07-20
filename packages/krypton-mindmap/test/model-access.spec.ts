import { createRequire } from 'node:module';
import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
const requireFromFramework = createRequire(require.resolve('../../../framework/framework/package.json'));
const { ObjectId } = requireFromFramework('mongodb');
const modelPath = require.resolve('../src/model.ts');
const errorPath = require.resolve('../src/error.ts');
const originalLoad = Module._load;
const previousErrorCache = require.cache[errorPath];

class MindmapRequestError extends Error {
    code = 400;
    params: unknown[];
    constructor(message: string, details?: unknown) {
        super(message);
        this.params = [message, details];
    }
}

class MindmapConflictError extends Error {
    code = 409;
    params: unknown[];
    constructor(message: string, details?: unknown) {
        super(message);
        this.params = [message, details];
    }
}

interface NodeDocument {
    _id: InstanceType<typeof ObjectId>;
    mapId: InstanceType<typeof ObjectId>;
    parentId: InstanceType<typeof ObjectId> | null;
    topic: string;
    description?: string;
    color?: string;
    layoutSide?: 'left' | 'right';
    tags: string[];
    problemIds: string[];
    order: number;
    createdAt: Date;
    updatedAt: Date;
}

interface MapDocument {
    _id: InstanceType<typeof ObjectId>;
    title: string;
    rootNodeId: InstanceType<typeof ObjectId>;
    visibility: 'hidden' | 'public';
    layoutDirection: 'RIGHT' | 'DOWN';
    createdAt: Date;
    updatedAt: Date;
}

let nodes: NodeDocument[] = [];
let maps: MapDocument[] = [];
let documentResults: any[] = [];
let config: any;
const documentCalls: Array<{ filter: any; projection?: any; limit?: number }> = [];
const logs: Array<{ level: string; args: unknown[] }> = [];
let failMapDeleteAfterWrite = false;
let failRootDeleteAfterWrite = false;

function equalValue(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId && right instanceof ObjectId) return (left as any).equals(right);
    if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
    return left === right;
}

function matchesNode(node: NodeDocument, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([key, value]) => equalValue((node as any)[key], value));
}

function nodeCursor(source: NodeDocument[]) {
    let values = source.slice();
    const cursor: any = {
        sort(spec: Record<string, number>) {
            values.sort((left, right) => {
                for (const [key, direction] of Object.entries(spec)) {
                    const a = (left as any)[key];
                    const b = (right as any)[key];
                    const compared =
                        a instanceof ObjectId && b instanceof ObjectId ? a.toHexString().localeCompare(b.toHexString()) : a > b ? 1 : a < b ? -1 : 0;
                    if (compared) return compared * direction;
                }
                return 0;
            });
            return cursor;
        },
        limit(limit: number) {
            values = values.slice(0, limit);
            return cursor;
        },
        project() {
            return cursor;
        },
        async toArray() {
            return values.slice();
        },
    };
    return cursor;
}

const nodesColl = {
    find(filter: Record<string, unknown> = {}) {
        return nodeCursor(nodes.filter((node) => matchesNode(node, filter)));
    },
    async findOne(filter: Record<string, unknown>) {
        return nodes.find((node) => matchesNode(node, filter)) || null;
    },
    async updateOne(filter: Record<string, unknown>, update: any) {
        const node = nodes.find((entry) => matchesNode(entry, filter));
        if (!node) return { matchedCount: 0, modifiedCount: 0 };
        if (update.$set) Object.assign(node, update.$set);
        if (update.$unset) for (const key of Object.keys(update.$unset)) delete (node as any)[key];
        return { matchedCount: 1, modifiedCount: 1 };
    },
    async insertOne(node: NodeDocument) {
        nodes.push(node);
        return { insertedId: node._id };
    },
    async deleteOne(filter: Record<string, unknown>) {
        const index = nodes.findIndex((node) => matchesNode(node, filter));
        if (index < 0) return { deletedCount: 0 };
        nodes.splice(index, 1);
        if (failRootDeleteAfterWrite) {
            failRootDeleteAfterWrite = false;
            throw new Error('simulated root delete acknowledgement loss');
        }
        return { deletedCount: 1 };
    },
    async countDocuments(filter: Record<string, unknown> = {}) {
        return nodes.filter((node) => matchesNode(node, filter)).length;
    },
    async bulkWrite(operations: any[]) {
        for (const operation of operations) await nodesColl.updateOne(operation.updateOne.filter, operation.updateOne.update);
        return { modifiedCount: operations.length };
    },
};

const mapsColl = {
    find(filter: Record<string, unknown> = {}) {
        const values = maps.filter((map) => matchesNode(map as any, filter));
        return nodeCursor(values as any) as any;
    },
    async findOne(filter: Record<string, unknown>) {
        return maps.find((map) => matchesNode(map as any, filter)) || null;
    },
    async updateOne(filter: Record<string, unknown>, update: any) {
        const map = maps.find((entry) => matchesNode(entry as any, filter));
        if (!map) return { matchedCount: 0, modifiedCount: 0 };
        if (update.$set) Object.assign(map, update.$set);
        return { matchedCount: 1, modifiedCount: 1 };
    },
    async insertOne(map: MapDocument) {
        maps.push(map);
        return { insertedId: map._id };
    },
    async deleteOne(filter: Record<string, unknown>) {
        const index = maps.findIndex((map) => matchesNode(map as any, filter));
        if (index < 0) return { deletedCount: 0 };
        maps.splice(index, 1);
        if (failMapDeleteAfterWrite) {
            failMapDeleteAfterWrite = false;
            throw new Error('simulated map delete acknowledgement loss');
        }
        return { deletedCount: 1 };
    },
};

const documentColl = {
    find(filter: any) {
        const call: (typeof documentCalls)[number] = { filter };
        documentCalls.push(call);
        const domainId = filter.domainId || filter.$and?.find((part: any) => part && typeof part === 'object' && part.domainId)?.domainId;
        const cursor: any = {
            project(projection: any) {
                call.projection = projection;
                return cursor;
            },
            limit(limit: number) {
                call.limit = limit;
                return cursor;
            },
            async toArray() {
                return documentResults.filter((document) => !domainId || document.domainId === domainId);
            },
        };
        return cursor;
    },
    async countDocuments(filter: any) {
        return documentResults.filter((document) => {
            if (filter.docType !== undefined && document.docType !== filter.docType) return false;
            if (filter.kind !== undefined && document.kind !== filter.kind) return false;
            if (filter.knowledgeMapId !== undefined && !equalValue(document.knowledgeMapId, filter.knowledgeMapId)) return false;
            if (filter.mindmapId !== undefined && !equalValue(document.mindmapId, filter.mindmapId)) return false;
            return true;
        }).length;
    },
};

const dbStub = {
    collection(name: string) {
        expect(name).to.equal('document');
        return documentColl;
    },
};

const mindmapDbStub = {
    nodesColl,
    mapsColl,
    async insertMapWithRoot(map: MapDocument, root: NodeDocument) {
        maps.push(map);
        nodes.push(root);
    },
};

class Logger {
    info(...args: unknown[]) {
        logs.push({ level: 'info', args });
    }

    warn(...args: unknown[]) {
        logs.push({ level: 'warn', args });
    }

    error(...args: unknown[]) {
        logs.push({ level: 'error', args });
    }
}

require.cache[errorPath] = {
    id: errorPath,
    filename: errorPath,
    loaded: true,
    exports: { MindmapRequestError, MindmapConflictError },
} as NodeModule;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === modelPath && request === 'hydrooj') return { ObjectId, db: dbStub };
    if (parent?.filename === modelPath && request === './db') return mindmapDbStub;
    if (parent?.filename === modelPath && request === '@hydrooj/utils') return { Logger };
    return originalLoad.call(this, request, parent, isMain);
};

let model: typeof import('../src/model');
try {
    delete require.cache[modelPath];
    model = require(modelPath);
} finally {
    Module._load = originalLoad;
    if (previousErrorCache) require.cache[errorPath] = previousErrorCache;
    else delete require.cache[errorPath];
}

function makeNode(
    topic: string,
    parentId: InstanceType<typeof ObjectId> | null,
    order: number,
    tags: string[] = [],
    mapId: InstanceType<typeof ObjectId> = config?._id,
): NodeDocument {
    const now = new Date(`2026-07-16T00:00:${String(nodes.length).padStart(2, '0')}.000Z`);
    return {
        _id: new ObjectId(),
        mapId,
        parentId,
        topic,
        tags,
        problemIds: [],
        order,
        createdAt: now,
        updatedAt: now,
    };
}

function resetTree() {
    nodes = [];
    maps = [];
    const mapId = new ObjectId();
    const root = makeNode('root', null, 0, [], mapId);
    config = {
        _id: mapId,
        title: 'Test map',
        rootNodeId: root._id,
        visibility: 'public',
        layoutDirection: 'RIGHT',
        createdAt: new Date('2026-07-16T00:00:00.000Z'),
        updatedAt: new Date('2026-07-16T00:00:00.000Z'),
    };
    maps.push(config);
    nodes.push(root);
    return root;
}

function nodeMutationContext() {
    return { mapId: config._id, expectedMapUpdatedAt: config.updatedAt };
}

async function expectRejected(promise: Promise<unknown>, ErrorClass: new (...args: any[]) => Error, messageFragment: string): Promise<void> {
    try {
        await promise;
        expect.fail('expected promise to reject');
    } catch (error) {
        expect(error).to.be.instanceOf(ErrorClass);
        expect((error as Error).message).to.include(messageFragment);
    }
}

beforeEach(() => {
    documentResults = [];
    documentCalls.length = 0;
    logs.length = 0;
    failMapDeleteAfterWrite = false;
    failRootDeleteAfterWrite = false;
    resetTree();
});

describe('mindmap problem query scope', () => {
    it('rejects an unknown node instead of reporting a successful empty association list', async () => {
        await expectRejected(model.listProblemsForNode('system', config._id, new ObjectId(), {}), MindmapRequestError, '节点不存在');
        expect(documentCalls).to.deep.equal([]);
    });

    it('pushes scope into Mongo and reports tag/manual sources without duplicates', async () => {
        const node = makeNode('graph', config.rootNodeId, 10, ['graph']);
        node.problemIds = ['P9'];
        nodes.push(node);
        documentResults = [
            {
                domainId: 'system',
                docId: 9,
                pid: 'P9',
                title: 'Scoped problem',
                tag: ['graph'],
                nSubmit: 10,
                nAccept: 5,
                hidden: false,
                knowledgeMapId: config._id,
            },
        ];
        const scope = { owner: 42 };

        const problems = await model.listProblemsForNode('system', config._id, node._id, scope as any);

        expect(documentCalls).to.have.lengthOf(1);
        expect(documentCalls[0].filter.$and[0]).to.deep.equal(scope);
        expect(documentCalls[0].filter.$and[1].knowledgeMapId.equals(config._id)).to.equal(true);
        expect(problems).to.deep.equal([
            {
                domainId: 'system',
                docId: 9,
                pid: 'P9',
                title: 'Scoped problem',
                hidden: false,
                nSubmit: 10,
                nAccept: 5,
                difficulty: 3,
                sources: ['tag', 'manual'],
            },
        ]);
    });

    it('keeps hidden filtering on public queries and removes it only for the admin option', async () => {
        const node = makeNode('graph', config.rootNodeId, 10, ['graph']);
        nodes.push(node);
        await model.listProblemsForNode('system', config._id, node._id, {});
        expect(documentCalls[0].filter.$and[1].hidden).to.deep.equal({ $ne: true });
        documentCalls.length = 0;
        await model.listProblemsForNode('system', config._id, node._id, {}, { includeHidden: true });
        expect(documentCalls[0].filter.$and[1]).not.to.have.property('hidden');
    });
});

describe('knowledge map lifecycle', () => {
    it('creates an independent hidden map with exactly one scoped root and only enumerates public maps publicly', async () => {
        const created = await model.createKnowledgeMap({
            domainId: 'system',
            actor: 2,
            title: ' 面向对象 ',
            rootTopic: 'root',
            layoutDirection: 'DOWN',
        });

        expect(created.title).to.equal('面向对象');
        expect(created.visibility).to.equal('hidden');
        expect(created.layoutDirection).to.equal('DOWN');
        const roots = nodes.filter((node) => node.mapId.equals(created._id) && node.parentId === null);
        expect(roots).to.have.lengthOf(1);
        expect(roots[0]._id.equals(created.rootNodeId)).to.equal(true);
        expect(roots[0].topic).to.equal('root');
        expect(nodes.find((node) => node._id.equals(config.rootNodeId))!.topic).to.equal('root');
        expect((await model.listKnowledgeMaps(false)).map((map) => map.title)).to.deep.equal(['Test map']);
        expect((await model.listKnowledgeMaps(true)).map((map) => map.title)).to.deep.equal(['Test map', '面向对象']);
    });

    it('rejects cross-map create and move parents and stale map versions before writing', async () => {
        const other = await model.createKnowledgeMap({ domainId: 'system', actor: 2, title: 'Other', rootTopic: 'Other' });
        const otherRoot = nodes.find((node) => node._id.equals(other.rootNodeId))!;
        const currentChild = makeNode('current child', config.rootNodeId, 10);
        nodes.push(currentChild);
        const before = nodes.length;

        await expectRejected(
            model.createNode({
                domainId: 'system',
                actor: 2,
                ...nodeMutationContext(),
                parentId: otherRoot._id,
                expectedParentUpdatedAt: otherRoot.updatedAt,
                topic: 'cross map',
            }),
            MindmapConflictError,
            '另一张导图',
        );
        await expectRejected(
            model.moveNode({
                domainId: 'system',
                actor: 2,
                ...nodeMutationContext(),
                id: currentChild._id,
                newParentId: otherRoot._id,
                targetIndex: 0,
                expectedUpdatedAt: currentChild.updatedAt,
                expectedParentUpdatedAt: otherRoot.updatedAt,
            }),
            MindmapConflictError,
            '另一张导图',
        );
        await expectRejected(
            model.createNode({
                domainId: 'system',
                actor: 2,
                mapId: config._id,
                expectedMapUpdatedAt: new Date('2000-01-01T00:00:00.000Z'),
                parentId: config.rootNodeId,
                expectedParentUpdatedAt: nodes[0].updatedAt,
                topic: 'stale map',
            }),
            MindmapConflictError,
            '其他操作修改',
        );
        expect(nodes).to.have.lengthOf(before);
    });

    it('publishes only a valid tree, blocks hiding a course-bound map, and deletes only an empty hidden map', async () => {
        const created = await model.createKnowledgeMap({ domainId: 'system', actor: 2, title: 'Course map', rootTopic: 'Course' });
        const published = await model.updateKnowledgeMap({
            domainId: 'system',
            actor: 2,
            id: created._id,
            expectedUpdatedAt: created.updatedAt,
            patch: { visibility: 'public' },
        });
        expect(published.visibility).to.equal('public');

        documentResults = [{ docType: 40, kind: 'course', mindmapId: created._id }];
        await expectRejected(
            model.updateKnowledgeMap({
                domainId: 'system',
                actor: 2,
                id: created._id,
                expectedUpdatedAt: published.updatedAt,
                patch: { visibility: 'hidden' },
            }),
            MindmapConflictError,
            '逐课解绑',
        );

        documentResults = [];
        const hidden = await model.updateKnowledgeMap({
            domainId: 'system',
            actor: 2,
            id: created._id,
            expectedUpdatedAt: published.updatedAt,
            patch: { visibility: 'hidden' },
        });
        documentResults = [{ docType: 10, domainId: 'system', docId: 99, knowledgeMapId: created._id }];
        await expectRejected(
            model.deleteKnowledgeMap({ domainId: 'system', actor: 2, id: created._id, expectedUpdatedAt: hidden.updatedAt }),
            MindmapConflictError,
            '1 道题',
        );
        documentResults = [];
        await model.deleteKnowledgeMap({ domainId: 'system', actor: 2, id: created._id, expectedUpdatedAt: hidden.updatedAt });
        expect(maps.some((map) => map._id.equals(created._id))).to.equal(false);
        expect(nodes.some((node) => node.mapId.equals(created._id))).to.equal(false);
    });

    it('refuses whole-map deletion when a referenced node has missing or mismatched map ownership', async () => {
        const created = await model.createKnowledgeMap({ domainId: 'system', actor: 2, title: 'Corrupt refs', rootTopic: 'Root' });
        documentResults = [{ docType: 10, domainId: 'system', docId: 100, knowledgeNodeIds: [created.rootNodeId] }];

        await expectRejected(
            model.deleteKnowledgeMap({ domainId: 'system', actor: 2, id: created._id, expectedUpdatedAt: created.updatedAt }),
            Error,
            'problem map missing',
        );
        expect(maps.some((map) => map._id.equals(created._id))).to.equal(true);
        expect(nodes.some((node) => node._id.equals(created.rootNodeId))).to.equal(true);

        documentResults[0].knowledgeMapId = new ObjectId();
        await expectRejected(
            model.deleteKnowledgeMap({ domainId: 'system', actor: 2, id: created._id, expectedUpdatedAt: created.updatedAt }),
            Error,
            'cross-map reference',
        );
        expect(maps.some((map) => map._id.equals(created._id))).to.equal(true);
        expect(nodes.some((node) => node._id.equals(created.rootNodeId))).to.equal(true);
    });

    it('restores the exact map and root when either delete commits before reporting failure', async () => {
        for (const failedWrite of ['map', 'root'] as const) {
            resetTree();
            const created = await model.createKnowledgeMap({ domainId: 'system', actor: 2, title: `Restore ${failedWrite}`, rootTopic: 'Root' });
            const originalRoot = nodes.find((node) => node._id.equals(created.rootNodeId))!;
            failMapDeleteAfterWrite = failedWrite === 'map';
            failRootDeleteAfterWrite = failedWrite === 'root';

            await expectRejected(
                model.deleteKnowledgeMap({ domainId: 'system', actor: 2, id: created._id, expectedUpdatedAt: created.updatedAt }),
                Error,
                `simulated ${failedWrite} delete acknowledgement loss`,
            );

            const restoredMap = maps.filter((map) => map._id.equals(created._id));
            const restoredNodes = nodes.filter((node) => node.mapId.equals(created._id));
            expect(restoredMap).to.have.lengthOf(1);
            expect(restoredMap[0]).to.deep.equal(created);
            expect(restoredNodes).to.have.lengthOf(1);
            expect(restoredNodes[0]).to.deep.equal(originalRoot);
        }
    });
});

describe('mindmap reference safety', () => {
    it('counts each referencing problem once per node across every domain and both reference fields', async () => {
        const child = makeNode('child', config.rootNodeId, 10, ['child']);
        nodes.push(child);
        documentResults = [
            {
                domainId: 'course-a',
                docId: 1,
                pid: 'C1',
                knowledgeMapId: config._id,
                knowledgeNodeIds: [child._id],
                managedAuthoring: { selectedMindmapNodeIds: [child._id] },
            },
            { domainId: 'system', docId: 2, pid: 'P2', knowledgeMapId: config._id, knowledgeNodeIds: [child._id] },
            { domainId: 'course-b', docId: 3, pid: 'C3', knowledgeMapId: config._id, managedAuthoring: { selectedMindmapNodeIds: [child._id] } },
        ];

        const counts = await model.getNodeReferenceCounts(config._id, nodes as any);

        expect(counts[child._id.toHexString()]).to.equal(3);
        expect(documentCalls[0].filter).not.to.have.property('domainId');
    });

    it('fails closed on malformed reference fields instead of making destructive decisions from partial data', async () => {
        const child = makeNode('child', config.rootNodeId, 10, ['child']);
        nodes.push(child);
        documentResults = [{ domainId: 'system', docId: 4, pid: 'P4', knowledgeMapId: config._id, knowledgeNodeIds: child._id }];

        await expectRejected(model.getNodeReferenceCounts(config._id, nodes as any), Error, 'field malformed');
    });

    it('fails closed when a problem references a node from a different declared map', async () => {
        const child = makeNode('child', config.rootNodeId, 10, ['child']);
        nodes.push(child);
        documentResults = [{ domainId: 'system', docId: 5, pid: 'P5', knowledgeMapId: new ObjectId(), knowledgeNodeIds: [child._id] }];

        await expectRejected(model.getNodeReferenceCounts(config._id, nodes as any), Error, 'cross-map reference');
    });

    it('fails closed when a same-map problem also names a node outside that map', async () => {
        const child = makeNode('child', config.rootNodeId, 10, ['child']);
        nodes.push(child);
        documentResults = [
            {
                domainId: 'system',
                docId: 6,
                pid: 'P6',
                knowledgeMapId: config._id,
                knowledgeNodeIds: [child._id, new ObjectId()],
            },
        ];

        await expectRejected(model.getNodeReferenceCounts(config._id, nodes as any), Error, 'outside its map');
    });

    it('locks only tags on a referenced node while allowing descriptive fields', async () => {
        const child = makeNode('child', config.rootNodeId, 10, ['old']);
        nodes.push(child);
        documentResults = [
            { domainId: 'course-a', docId: 1, pid: 'C1', title: 'Referenced', knowledgeMapId: config._id, knowledgeNodeIds: [child._id] },
        ];

        await expectRejected(
            model.updateNode({
                domainId: 'system',
                actor: 1,
                ...nodeMutationContext(),
                id: child._id,
                expectedUpdatedAt: child.updatedAt,
                patch: { tags: ['new'] },
            }),
            MindmapConflictError,
            '不能直接修改标签',
        );
        const originalVersion = child.updatedAt;
        await model.updateNode({
            domainId: 'system',
            actor: 1,
            ...nodeMutationContext(),
            id: child._id,
            expectedUpdatedAt: originalVersion,
            patch: { topic: 'renamed' },
        });
        expect(child.topic).to.equal('renamed');
    });

    it('counts descendant references on ancestors and locks ancestor tags', async () => {
        const parent = makeNode('parent', config.rootNodeId, 10, ['parent-old']);
        nodes.push(parent);
        const child = makeNode('child', parent._id, 10, ['child']);
        nodes.push(child);
        documentResults = [
            { domainId: 'course-a', docId: 5, pid: 'C5', title: 'Descendant reference', knowledgeMapId: config._id, knowledgeNodeIds: [child._id] },
        ];

        const counts = await model.getNodeReferenceCounts(config._id, nodes as any);

        expect(counts[config.rootNodeId.toHexString()]).to.equal(1);
        expect(counts[parent._id.toHexString()]).to.equal(1);
        expect(counts[child._id.toHexString()]).to.equal(1);
        await expectRejected(
            model.updateNode({
                domainId: 'system',
                actor: 1,
                ...nodeMutationContext(),
                id: parent._id,
                expectedUpdatedAt: parent.updatedAt,
                patch: { tags: ['parent-new'] },
            }),
            MindmapConflictError,
            '不能直接修改标签',
        );
        expect(parent.tags).to.deep.equal(['parent-old']);
    });

    it('blocks a referenced reparent only when the problem-wide inherited tag union changes', async () => {
        const oldParent = makeNode('old parent', config.rootNodeId, 10, ['old']);
        nodes.push(oldParent);
        const newParent = makeNode('new parent', config.rootNodeId, 20, ['new']);
        nodes.push(newParent);
        const child = makeNode('child', oldParent._id, 10, ['leaf']);
        nodes.push(child);
        documentResults = [
            { domainId: 'course-a', docId: 7, pid: 'C7', title: 'Cross-domain ref', knowledgeMapId: config._id, knowledgeNodeIds: [child._id] },
        ];

        try {
            await model.moveNode({
                domainId: 'system',
                actor: 1,
                ...nodeMutationContext(),
                id: child._id,
                newParentId: newParent._id,
                targetIndex: 0,
                expectedUpdatedAt: child.updatedAt,
                expectedParentUpdatedAt: newParent.updatedAt,
            });
            expect.fail('expected referenced reparent to be rejected');
        } catch (error) {
            expect(error).to.be.instanceOf(MindmapConflictError);
            expect((error as Error).message).to.include('继承标签');
            expect((error as any).mindmapMutationContext).to.deep.equal({
                fromParent: oldParent._id.toHexString(),
                toParent: newParent._id.toHexString(),
                fromIndex: 0,
                toIndex: 0,
                expectedUpdatedAt: child.updatedAt.toISOString(),
                expectedParentUpdatedAt: newParent.updatedAt.toISOString(),
            });
        }

        newParent.tags = ['old'];
        const moved = await model.moveNode({
            domainId: 'system',
            actor: 1,
            ...nodeMutationContext(),
            id: child._id,
            newParentId: newParent._id,
            targetIndex: 0,
            expectedUpdatedAt: child.updatedAt,
            expectedParentUpdatedAt: newParent.updatedAt,
        });
        expect(moved.parentId.equals(newParent._id)).to.equal(true);
    });

    it('allows a reparent when other selected nodes keep the complete problem-wide tag union unchanged', async () => {
        const oldParent = makeNode('old parent', config.rootNodeId, 10, ['old']);
        const newParent = makeNode('new parent', config.rootNodeId, 20, ['new']);
        nodes.push(oldParent, newParent);
        const moving = makeNode('moving', oldParent._id, 10, ['leaf']);
        const oldAnchor = makeNode('old anchor', oldParent._id, 20);
        const newAnchor = makeNode('new anchor', newParent._id, 10);
        nodes.push(moving, oldAnchor, newAnchor);
        documentResults = [
            {
                domainId: 'system',
                docId: 8,
                pid: 'P8',
                knowledgeMapId: config._id,
                knowledgeNodeIds: [moving._id, oldAnchor._id],
                managedAuthoring: { selectedMindmapNodeIds: [newAnchor._id] },
            },
        ];

        const moved = await model.moveNode({
            domainId: 'system',
            actor: 1,
            ...nodeMutationContext(),
            id: moving._id,
            newParentId: newParent._id,
            targetIndex: 1,
            expectedUpdatedAt: moving.updatedAt,
            expectedParentUpdatedAt: newParent.updatedAt,
        });

        expect(moved.parentId.equals(newParent._id)).to.equal(true);
    });

    it('allows same-parent reorder and root-side changes even when the node is referenced', async () => {
        const first = makeNode('first', config.rootNodeId, 10, ['first']);
        const second = makeNode('second', config.rootNodeId, 20, ['second']);
        nodes.push(first, second);
        documentResults = [{ domainId: 'system', docId: 1, pid: 'P1', knowledgeMapId: config._id, knowledgeNodeIds: [second._id] }];

        const moved = await model.moveNode({
            domainId: 'system',
            actor: 1,
            ...nodeMutationContext(),
            id: second._id,
            newParentId: config.rootNodeId,
            targetIndex: 0,
            layoutSide: 'left',
            expectedUpdatedAt: second.updatedAt,
            expectedParentUpdatedAt: nodes[0].updatedAt,
        });

        expect(moved.order).to.be.lessThan(first.order);
        expect(moved.layoutSide).to.equal('left');
    });

    it('preserves an implicitly-derived root side when reordering without a side command', async () => {
        const first = makeNode('first', config.rootNodeId, 10);
        const second = makeNode('second', config.rootNodeId, 20);
        const third = makeNode('third', config.rootNodeId, 30);
        nodes.push(first, second, third);

        const moved = await model.moveNode({
            domainId: 'system',
            actor: 1,
            ...nodeMutationContext(),
            id: second._id,
            newParentId: config.rootNodeId,
            targetIndex: 0,
            expectedUpdatedAt: second.updatedAt,
            expectedParentUpdatedAt: nodes[0].updatedAt,
        });

        expect(moved.order).to.be.lessThan(first.order);
        expect(moved.layoutSide).to.equal('left');
    });
});

describe('mindmap structural mutations', () => {
    it('creates at the end, chooses the lighter root side, and bumps the parent version before insert', async () => {
        const root = nodes[0];
        const left = makeNode('left', root._id, 10);
        left.layoutSide = 'left';
        nodes.push(left);
        const expectedParentUpdatedAt = root.updatedAt;

        const created = await model.createNode({
            domainId: 'system',
            actor: 1,
            ...nodeMutationContext(),
            parentId: root._id,
            expectedParentUpdatedAt,
            topic: 'new branch',
            tags: [],
            problemIds: [],
        });

        expect(created.parentId.equals(root._id)).to.equal(true);
        expect(created.order).to.equal(20);
        expect(created.layoutSide).to.equal('right');
        expect(root.updatedAt.getTime()).not.to.equal(expectedParentUpdatedAt.getTime());
        expect(logs).to.have.lengthOf(1);
        expect(logs[0].level).to.equal('info');
        expect(String(logs[0].args[0])).to.include('domain=%s actor=%d map=%s node=%s operation=create');
        expect(String(logs[0].args[0])).to.include('result=success');
    });

    it('rejects stale create versions without inserting an orphan', async () => {
        const root = nodes[0];
        const before = nodes.length;
        await expectRejected(
            model.createNode({
                domainId: 'system',
                actor: 1,
                ...nodeMutationContext(),
                parentId: root._id,
                expectedParentUpdatedAt: new Date('2000-01-01T00:00:00.000Z'),
                topic: 'stale',
                tags: [],
                problemIds: [],
            }),
            MindmapConflictError,
            '其他操作修改',
        );
        expect(nodes).to.have.lengthOf(before);
    });

    it('rejects missing/self/descendant parents, existing cycles, and every root move', async () => {
        const root = nodes[0];
        const parent = makeNode('parent', root._id, 10);
        nodes.push(parent);
        const child = makeNode('child', parent._id, 10);
        nodes.push(child);

        await expectRejected(
            model.moveNode({
                domainId: 'system',
                actor: 1,
                ...nodeMutationContext(),
                id: parent._id,
                newParentId: new ObjectId(),
                targetIndex: 0,
                expectedUpdatedAt: parent.updatedAt,
                expectedParentUpdatedAt: child.updatedAt,
            }),
            MindmapConflictError,
            '父节点不存在',
        );
        await expectRejected(
            model.moveNode({
                domainId: 'system',
                actor: 1,
                ...nodeMutationContext(),
                id: parent._id,
                newParentId: parent._id,
                targetIndex: 0,
                expectedUpdatedAt: parent.updatedAt,
                expectedParentUpdatedAt: parent.updatedAt,
            }),
            MindmapConflictError,
            '自己的父节点',
        );

        await expectRejected(
            model.moveNode({
                domainId: 'system',
                actor: 1,
                ...nodeMutationContext(),
                id: parent._id,
                newParentId: child._id,
                targetIndex: 0,
                expectedUpdatedAt: parent.updatedAt,
                expectedParentUpdatedAt: child.updatedAt,
            }),
            MindmapConflictError,
            '后代',
        );
        await expectRejected(
            model.moveNode({
                domainId: 'system',
                actor: 1,
                ...nodeMutationContext(),
                id: root._id,
                newParentId: child._id,
                targetIndex: 0,
                expectedUpdatedAt: root.updatedAt,
                expectedParentUpdatedAt: child.updatedAt,
            }),
            MindmapConflictError,
            '根节点',
        );

        await expectRejected(
            model.moveNode({
                domainId: 'system',
                actor: 1,
                ...nodeMutationContext(),
                id: child._id,
                newParentId: parent._id,
                targetIndex: 0,
                layoutSide: 'left',
                expectedUpdatedAt: child.updatedAt,
                expectedParentUpdatedAt: parent.updatedAt,
            }),
            MindmapRequestError,
            '直接分支',
        );

        parent.parentId = child._id;
        await expectRejected(
            model.moveNode({
                domainId: 'system',
                actor: 1,
                ...nodeMutationContext(),
                id: parent._id,
                newParentId: root._id,
                targetIndex: 0,
                expectedUpdatedAt: parent.updatedAt,
                expectedParentUpdatedAt: root.updatedAt,
            }),
            MindmapConflictError,
            '已经存在环',
        );
    });

    it('permits only unreferenced leaves to be deleted', async () => {
        const root = nodes[0];
        const parent = makeNode('parent', root._id, 10);
        nodes.push(parent);
        const child = makeNode('child', parent._id, 10);
        nodes.push(child);
        await expectRejected(
            model.deleteNode({ domainId: 'system', actor: 1, ...nodeMutationContext(), id: parent._id, expectedUpdatedAt: parent.updatedAt }),
            MindmapConflictError,
            '叶子',
        );

        documentResults = [{ domainId: 'course-a', docId: 3, pid: 'C3', knowledgeMapId: config._id, knowledgeNodeIds: [child._id] }];
        await expectRejected(
            model.deleteNode({ domainId: 'system', actor: 1, ...nodeMutationContext(), id: child._id, expectedUpdatedAt: child.updatedAt }),
            MindmapConflictError,
            '仍被题目引用',
        );
        documentResults = [];
        await model.deleteNode({ domainId: 'system', actor: 1, ...nodeMutationContext(), id: child._id, expectedUpdatedAt: child.updatedAt });
        expect(nodes.some((node) => node._id.equals(child._id))).to.equal(false);
    });

    it('ignores malformed cross-map parent links when deciding whether a scoped node is a leaf', async () => {
        const leaf = makeNode('current leaf', config.rootNodeId, 10);
        const foreign = makeNode('foreign child', leaf._id, 10, [], new ObjectId());
        nodes.push(leaf, foreign);

        await model.deleteNode({ domainId: 'system', actor: 1, ...nodeMutationContext(), id: leaf._id, expectedUpdatedAt: leaf.updatedAt });

        expect(nodes.some((node) => node._id.equals(leaf._id))).to.equal(false);
        expect(nodes.some((node) => node._id.equals(foreign._id))).to.equal(true);
    });

    it('validates and canonicalizes every manual problem association server-side', async () => {
        const child = makeNode('child', config.rootNodeId, 10);
        nodes.push(child);
        documentResults = [{ domainId: 'course-a', docId: 4, pid: 'C4', knowledgeMapId: config._id }];
        await expectRejected(
            model.updateNode({
                domainId: 'system',
                actor: 1,
                ...nodeMutationContext(),
                id: child._id,
                expectedUpdatedAt: child.updatedAt,
                patch: { problemIds: ['missing'] },
            }),
            MindmapRequestError,
            '不属于当前域',
        );
        expect(documentCalls[0].filter).to.include({ domainId: 'system' });

        documentResults = [{ domainId: 'system', docId: 8, pid: 'P8', knowledgeMapId: new ObjectId() }];
        await expectRejected(
            model.updateNode({
                domainId: 'system',
                actor: 1,
                ...nodeMutationContext(),
                id: child._id,
                expectedUpdatedAt: child.updatedAt,
                patch: { problemIds: ['P8'] },
            }),
            MindmapRequestError,
            '另一张导图',
        );

        documentResults = [{ domainId: 'system', docId: 9, pid: 'P9', knowledgeMapId: config._id }];
        const updated = await model.updateNode({
            domainId: 'system',
            actor: 1,
            ...nodeMutationContext(),
            id: child._id,
            expectedUpdatedAt: child.updatedAt,
            patch: { problemIds: ['9'] },
        });
        expect(updated.problemIds).to.deep.equal(['P9']);
    });

    it('always advances a CAS version even when the previous timestamp is ahead of the local clock', async () => {
        const child = makeNode('child', config.rootNodeId, 10);
        child.updatedAt = new Date(Date.now() + 60_000);
        nodes.push(child);
        const previous = child.updatedAt;

        const updated = await model.updateNode({
            domainId: 'system',
            actor: 1,
            ...nodeMutationContext(),
            id: child._id,
            expectedUpdatedAt: previous,
            patch: { topic: 'next' },
        });

        expect(updated.updatedAt.getTime()).to.equal(previous.getTime() + 1);
    });

    it('returns a 409 instead of overwriting a stale node edit', async () => {
        const child = makeNode('child', config.rootNodeId, 10);
        nodes.push(child);
        await expectRejected(
            model.updateNode({
                domainId: 'system',
                actor: 1,
                ...nodeMutationContext(),
                id: child._id,
                expectedUpdatedAt: new Date('2000-01-01T00:00:00.000Z'),
                patch: { topic: 'lost update' },
            }),
            MindmapConflictError,
            '其他操作修改',
        );
        expect(child.topic).to.equal('child');
    });
});
