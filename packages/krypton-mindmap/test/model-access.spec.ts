import { createRequire } from 'node:module';
import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
const framework = require('../../../framework/framework');
const requireFromFramework = createRequire(require.resolve('../../../framework/framework/package.json'));
const { ObjectId } = requireFromFramework('mongodb');

const PRIV_EDIT_SYSTEM = 1;
const NOT_MERGED_MESSAGE = '知识图谱尚未合并，请先运行 mindmap:merge-courses';
const DOMAIN_ID = 'system';

type MindmapObjectId = InstanceType<typeof ObjectId>;

interface MindmapActor {
    _id: number;
    hasPriv(...privileges: number[]): boolean;
}

interface NodeDocument {
    _id: MindmapObjectId;
    mapId: MindmapObjectId;
    parentId: MindmapObjectId | null;
    topic: string;
    tags: string[];
    problemIds: string[];
    order: number;
    createdAt: Date;
    updatedAt: Date;
    courseVisibility?: 'public' | 'hidden';
    ownerUids?: number[];
    coursePins?: number[];
}

interface MapDocument {
    _id: MindmapObjectId;
    title: string;
    rootNodeId: MindmapObjectId;
    visibility: 'public' | 'hidden';
    layoutDirection: 'RIGHT' | 'DOWN';
    createdAt: Date;
    updatedAt: Date;
    isDefault?: boolean;
    ownerDomainId?: string;
    ownerCourseId?: MindmapObjectId;
}

interface StoredDocument {
    domainId: string;
    docType: number;
    docId?: number;
    kind?: string;
    title?: string;
    knowledgeMapId?: MindmapObjectId;
    knowledgeCourseNodeId?: MindmapObjectId;
    archivedAt?: Date;
}

interface Fixture {
    mapId: MindmapObjectId;
    rootId: MindmapObjectId;
    publicCourse: NodeDocument;
    publicChild: NodeDocument;
    hiddenCourse: NodeDocument;
    hiddenChild: NodeDocument;
    hiddenGrand: NodeDocument;
    boundCourse: NodeDocument;
}

interface MongoUpdate {
    $set?: Record<string, unknown>;
    $unset?: Record<string, unknown>;
}

interface ModelApi {
    listKnowledgeMaps(includeHidden?: boolean): Promise<MapDocument[]>;
    getPublicKnowledgeMapSnapshot(id: MindmapObjectId | string): Promise<{ config: MapDocument; nodes: NodeDocument[] } | null>;
    materialize(
        mapId: MindmapObjectId | string,
        nodeIds: Array<MindmapObjectId | string>,
        options?: { requirePublicMap?: boolean },
    ): Promise<{ nodePaths: Array<{ id: string; label: string }>; tags: string[] }>;
    createNode(input: {
        domainId: string;
        actor: MindmapActor;
        mapId: MindmapObjectId;
        expectedMapUpdatedAt: Date;
        parentId: MindmapObjectId;
        expectedParentUpdatedAt: Date;
        topic: string;
    }): Promise<NodeDocument>;
    updateNode(input: {
        domainId: string;
        actor: MindmapActor;
        mapId: MindmapObjectId;
        expectedMapUpdatedAt: Date;
        id: MindmapObjectId;
        expectedUpdatedAt: Date;
        patch: Record<string, unknown>;
    }): Promise<NodeDocument>;
    moveNode(input: {
        domainId: string;
        actor: MindmapActor;
        mapId: MindmapObjectId;
        expectedMapUpdatedAt: Date;
        id: MindmapObjectId;
        newParentId: MindmapObjectId;
        targetIndex: number;
        expectedUpdatedAt: Date;
        expectedParentUpdatedAt: Date;
    }): Promise<NodeDocument>;
    deleteNode(input: {
        domainId: string;
        actor: MindmapActor;
        mapId: MindmapObjectId;
        expectedMapUpdatedAt: Date;
        id: MindmapObjectId;
        expectedUpdatedAt: Date;
    }): Promise<void>;
    listProblemsForNode(
        domainId: string,
        mapId: MindmapObjectId | string,
        nodeId: MindmapObjectId | string,
        scope: Record<string, unknown>,
    ): Promise<Array<{ docId: number; sources: Array<'canonical' | 'manual'> }>>;
    getNodeReferenceCounts(mapId: MindmapObjectId | string, counted: NodeDocument[]): Promise<Record<string, number>>;
}

class PrivilegeError extends framework.ForbiddenError {
    name = 'PrivilegeError';
}

class PermissionError extends framework.ForbiddenError {
    name = 'PermissionError';
}

let nodes: NodeDocument[] = [];
let maps: MapDocument[] = [];
let documents: StoredDocument[] = [];

function atSecond(second: number): Date {
    return new Date(Date.UTC(2026, 7, 1, 0, 0, second));
}

function isId(value: unknown): value is MindmapObjectId {
    return value instanceof ObjectId;
}

function same(left: unknown, right: unknown): boolean {
    const leftId = isId(left) ? left : undefined;
    const rightId = isId(right) ? right : undefined;
    if (leftId && rightId) return leftId.equals(rightId);
    if (leftId && typeof right === 'string') return leftId.toHexString() === right;
    if (typeof left === 'string' && rightId) return left === rightId.toHexString();
    if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
    return left === right;
}

function isOperator(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !isId(value);
}

function matchesField(document: object, key: string, expected: unknown): boolean {
    const actual = (document as Record<string, unknown>)[key];
    if (!isOperator(expected)) return same(actual, expected);
    if ('$exists' in expected) {
        const exists = Object.hasOwn(document, key);
        return expected.$exists ? exists : !exists;
    }
    if ('$in' in expected && Array.isArray(expected.$in)) return expected.$in.some((item) => same(actual, item));
    if ('$ne' in expected) return !same(actual, expected.$ne);
    if ('$eq' in expected) return same(actual, expected.$eq);
    return same(actual, expected);
}

function matches(document: object, filter: Record<string, unknown>): boolean {
    if (Array.isArray(filter.$and) && !filter.$and.every((part) => matches(document, part as Record<string, unknown>))) return false;
    if (Array.isArray(filter.$or) && !filter.$or.some((part) => matches(document, part as Record<string, unknown>))) return false;
    return Object.entries(filter).every(([key, value]) => key === '$and' || key === '$or' || matchesField(document, key, value));
}

function compareValues(left: unknown, right: unknown): number {
    if (isId(left) && isId(right)) {
        const leftHex = left.toHexString();
        const rightHex = right.toHexString();
        if (leftHex < rightHex) return -1;
        if (leftHex > rightHex) return 1;
        return 0;
    }
    if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    if (typeof left === 'string' && typeof right === 'string') {
        if (left < right) return -1;
        if (left > right) return 1;
        return 0;
    }
    return 0;
}

function cursor<T extends object>(source: T[]) {
    let values = source.slice();
    const chain = {
        sort(spec: Record<string, number>) {
            values.sort((left, right) => {
                const recordLeft = left as Record<string, unknown>;
                const recordRight = right as Record<string, unknown>;
                for (const [key, direction] of Object.entries(spec)) {
                    const compared = compareValues(recordLeft[key], recordRight[key]);
                    if (compared !== 0) return compared * (direction < 0 ? -1 : 1);
                }
                return 0;
            });
            return chain;
        },
        limit(count: number) {
            values = values.slice(0, count);
            return chain;
        },
        project() {
            return chain;
        },
        async toArray() {
            return values.slice();
        },
    };
    return chain;
}

function applyUpdate(target: object, update: MongoUpdate): void {
    const record = target as Record<string, unknown>;
    if (update.$set) Object.assign(record, update.$set);
    if (update.$unset) {
        for (const key of Object.keys(update.$unset)) delete record[key];
    }
}

function makeCollection<T extends object>(read: () => T[]) {
    return {
        find(filter: Record<string, unknown> = {}, options?: { sort?: Record<string, number>; limit?: number }) {
            const chain = cursor(read().filter((item) => matches(item, filter)));
            if (options?.sort) chain.sort(options.sort);
            if (typeof options?.limit === 'number') chain.limit(options.limit);
            return chain;
        },
        async findOne(filter: Record<string, unknown> = {}) {
            return read().find((item) => matches(item, filter)) || null;
        },
        async countDocuments(filter: Record<string, unknown> = {}) {
            return read().filter((item) => matches(item, filter)).length;
        },
        async estimatedDocumentCount() {
            return read().length;
        },
        async updateOne(filter: Record<string, unknown>, update: MongoUpdate) {
            const found = read().find((item) => matches(item, filter));
            if (!found) return { matchedCount: 0, modifiedCount: 0 };
            applyUpdate(found, update);
            return { matchedCount: 1, modifiedCount: 1 };
        },
        async findOneAndUpdate(filter: Record<string, unknown>, update: MongoUpdate, options?: { returnDocument?: string }) {
            const found = read().find((item) => matches(item, filter));
            if (!found) return null;
            const before = { ...found };
            applyUpdate(found, update);
            return options?.returnDocument === 'after' ? found : before;
        },
        async insertOne(document: T) {
            read().push(document);
            return { insertedId: (document as { _id?: MindmapObjectId })._id };
        },
        async deleteOne(filter: Record<string, unknown>) {
            const list = read();
            const index = list.findIndex((item) => matches(item, filter));
            if (index < 0) return { deletedCount: 0 };
            list.splice(index, 1);
            return { deletedCount: 1 };
        },
        async createIndex() {
            return 'test-index';
        },
    };
}

const nodesColl = makeCollection(() => nodes);
const mapsColl = makeCollection(() => maps);
const documentColl = makeCollection(() => documents);
const dbStub = {
    collection(name: string) {
        if (name === 'mindmap.nodes') return nodesColl;
        if (name === 'mindmap.maps') return mapsColl;
        if (name === 'document') return documentColl;
        throw new Error(`unexpected collection ${name}`);
    },
};

class Logger {
    info(..._args: unknown[]) {}

    warn(..._args: unknown[]) {}

    error(..._args: unknown[]) {}
}

const hydroojStub = {
    CreateError: framework.CreateError,
    UserFacingError: framework.UserFacingError,
    ForbiddenError: framework.ForbiddenError,
    ValidationError: framework.ValidationError,
    NotFoundError: framework.NotFoundError,
    localizedErrorText: framework.localizedErrorText,
    localizeError: framework.localizeError,
    ObjectId,
    PRIV: { PRIV_EDIT_SYSTEM },
    PrivilegeError,
    PermissionError,
    db: dbStub,
};

function isMindmapFile(parent: NodeModule | undefined): boolean {
    return typeof parent?.filename === 'string' && parent.filename.includes('/packages/krypton-mindmap/');
}

const originalLoad = Module._load;
let mindmapModel: Record<string, unknown> | undefined;
let loadError: unknown;

try {
    const dbPath = require.resolve('../src/db.ts');
    const modelPath = require.resolve('../src/model.ts');
    const errorPath = require.resolve('../src/error.ts');
    const courseNodesPath = require.resolve('../src/course-nodes.ts');
    Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
        if (request === 'hydrooj' && isMindmapFile(parent)) return hydroojStub;
        if (request === '@hydrooj/utils' && isMindmapFile(parent)) return { Logger };
        return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[dbPath];
    delete require.cache[modelPath];
    delete require.cache[errorPath];
    delete require.cache[courseNodesPath];
    require(dbPath);
    mindmapModel = require(modelPath) as Record<string, unknown>;
} catch (caught) {
    loadError = caught;
} finally {
    Module._load = originalLoad;
}

function modelApi(): ModelApi {
    if (!mindmapModel) {
        const reason = loadError instanceof Error ? loadError.message : String(loadError ?? 'model.ts did not load');
        const failure = new Error(`failed to load model.ts: ${reason}`);
        if (loadError instanceof Error) failure.cause = loadError;
        throw failure;
    }
    const required = [
        'listKnowledgeMaps',
        'getPublicKnowledgeMapSnapshot',
        'materialize',
        'createNode',
        'updateNode',
        'moveNode',
        'deleteNode',
        'listProblemsForNode',
        'getNodeReferenceCounts',
    ];
    const missing = required.filter((name) => typeof mindmapModel?.[name] !== 'function');
    if (missing.length) throw new Error(`missing exports: ${missing.join(', ')}`);
    return mindmapModel as unknown as ModelApi;
}

function actor(id: number, admin: boolean): MindmapActor {
    return {
        _id: id,
        hasPriv(...privileges: number[]) {
            return admin && privileges.includes(PRIV_EDIT_SYSTEM);
        },
    };
}

function makeNode(input: {
    id: MindmapObjectId;
    mapId: MindmapObjectId;
    parentId: MindmapObjectId | null;
    topic: string;
    order: number;
    second: number;
    tags?: string[];
    courseVisibility?: 'public' | 'hidden';
    ownerUids?: number[];
}): NodeDocument {
    const now = atSecond(input.second);
    const node: NodeDocument = {
        _id: input.id,
        mapId: input.mapId,
        parentId: input.parentId,
        topic: input.topic,
        tags: input.tags ? input.tags.slice() : [],
        problemIds: [],
        order: input.order,
        createdAt: now,
        updatedAt: now,
    };
    if (input.courseVisibility !== undefined) node.courseVisibility = input.courseVisibility;
    if (input.ownerUids !== undefined) node.ownerUids = input.ownerUids.slice();
    return node;
}

function buildMerged(): Fixture {
    const mapId = new ObjectId();
    const rootId = new ObjectId();
    const createdAt = atSecond(0);
    const root = makeNode({ id: rootId, mapId, parentId: null, topic: '知识图谱', order: 0, second: 0 });
    const publicCourse = makeNode({
        id: new ObjectId(),
        mapId,
        parentId: rootId,
        topic: '程序设计基础',
        order: 0,
        second: 1,
        courseVisibility: 'public',
        ownerUids: [7],
    });
    const publicChild = makeNode({
        id: new ObjectId(),
        mapId,
        parentId: publicCourse._id,
        topic: '数组',
        order: 1,
        second: 2,
        tags: ['数组'],
    });
    const hiddenCourse = makeNode({
        id: new ObjectId(),
        mapId,
        parentId: rootId,
        topic: '操作系统',
        order: 1,
        second: 3,
        tags: ['操作系统'],
        courseVisibility: 'hidden',
        ownerUids: [8],
    });
    const hiddenChild = makeNode({
        id: new ObjectId(),
        mapId,
        parentId: hiddenCourse._id,
        topic: '进程',
        order: 1,
        second: 4,
        tags: ['进程'],
    });
    const hiddenGrand = makeNode({
        id: new ObjectId(),
        mapId,
        parentId: hiddenChild._id,
        topic: '调度',
        order: 1,
        second: 5,
    });
    const boundCourse = makeNode({
        id: new ObjectId(),
        mapId,
        parentId: rootId,
        topic: '学校安全',
        order: 2,
        second: 6,
        courseVisibility: 'public',
        ownerUids: [],
    });
    maps = [
        {
            _id: mapId,
            title: '知识图谱',
            rootNodeId: rootId,
            visibility: 'public',
            layoutDirection: 'RIGHT',
            createdAt,
            updatedAt: createdAt,
        },
    ];
    nodes = [root, publicCourse, publicChild, hiddenCourse, hiddenChild, hiddenGrand, boundCourse];
    documents = [
        {
            domainId: DOMAIN_ID,
            docType: 10,
            docId: 12,
            title: '题十二',
            knowledgeMapId: mapId,
        },
        {
            domainId: DOMAIN_ID,
            docType: 10,
            docId: 13,
            title: '题十三',
        },
        {
            domainId: DOMAIN_ID,
            docType: 40,
            kind: 'course',
            title: '程序设计基础(I)',
            knowledgeCourseNodeId: boundCourse._id,
        },
    ];
    return { mapId, rootId, publicCourse, publicChild, hiddenCourse, hiddenChild, hiddenGrand, boundCourse };
}

function extraMap(): MapDocument {
    const createdAt = atSecond(30);
    return {
        _id: new ObjectId(),
        title: '第二张图',
        rootNodeId: new ObjectId(),
        visibility: 'public',
        layoutDirection: 'DOWN',
        createdAt,
        updatedAt: createdAt,
    };
}

function mergedMap(): MapDocument {
    const map = maps.find((item) => item._id.equals(fixture.mapId));
    if (!map) throw new Error('merged map missing from the fixture');
    return map;
}

function liveDate(date: Date): Date {
    return new Date(date.getTime());
}

function context(actorValue: MindmapActor) {
    return {
        domainId: DOMAIN_ID,
        actor: actorValue,
        mapId: fixture.mapId,
        expectedMapUpdatedAt: liveDate(mergedMap().updatedAt),
    };
}

async function callError(run: () => Promise<unknown>): Promise<Error | undefined> {
    try {
        await run();
    } catch (caught) {
        if (caught instanceof Error) return caught;
        throw new Error(`rejected with a non-error: ${String(caught)}`);
    }
    return undefined;
}

function isPermissionError(error: Error): boolean {
    return error.name === 'PrivilegeError' || error.name === 'PermissionError';
}

let fixture = buildMerged();

beforeEach(() => {
    fixture = buildMerged();
});

describe('merged knowledge graph model', () => {
    it('lets a responsible teacher create inside their course and rejects another course', async () => {
        const api = modelApi();
        const teacher = actor(7, false);
        const created = await api.createNode({
            ...context(teacher),
            parentId: fixture.publicChild._id,
            expectedParentUpdatedAt: liveDate(fixture.publicChild.updatedAt),
            topic: '新知识点',
        });
        expect(created.topic).to.equal('新知识点');
        expect(created.parentId?.equals(fixture.publicChild._id)).to.equal(true);
        expect(nodes.some((node) => node._id.equals(created._id))).to.equal(true);

        const before = nodes.length;
        const denied = await callError(() =>
            api.createNode({
                ...context(teacher),
                parentId: fixture.hiddenChild._id,
                expectedParentUpdatedAt: liveDate(fixture.hiddenChild.updatedAt),
                topic: '越权知识点',
            }),
        );
        expect(denied instanceof Error, 'create in another course resolved').to.equal(true);
        if (!(denied instanceof Error)) return;
        expect(isPermissionError(denied)).to.equal(true);
        expect(nodes.length).to.equal(before);
        expect(nodes.some((node) => node.topic === '越权知识点')).to.equal(false);
    });

    it('rejects a responsible teacher moving a node into another course', async () => {
        const api = modelApi();
        const teacher = actor(7, false);
        const parentBefore = fixture.publicChild.parentId;
        const denied = await callError(() =>
            api.moveNode({
                ...context(teacher),
                id: fixture.publicChild._id,
                newParentId: fixture.hiddenCourse._id,
                targetIndex: 0,
                expectedUpdatedAt: liveDate(fixture.publicChild.updatedAt),
                expectedParentUpdatedAt: liveDate(fixture.hiddenCourse.updatedAt),
            }),
        );
        expect(denied instanceof Error, 'move into another course resolved').to.equal(true);
        if (!(denied instanceof Error)) return;
        expect(isPermissionError(denied)).to.equal(true);
        expect(fixture.publicChild.parentId?.equals(parentBefore)).to.equal(true);
    });

    it('lets an administrator move a node into another course', async () => {
        const api = modelApi();
        const admin = actor(1, true);
        const moved = await api.moveNode({
            ...context(admin),
            id: fixture.publicChild._id,
            newParentId: fixture.hiddenCourse._id,
            targetIndex: 0,
            expectedUpdatedAt: liveDate(fixture.publicChild.updatedAt),
            expectedParentUpdatedAt: liveDate(fixture.hiddenCourse.updatedAt),
        });
        expect(moved.parentId?.equals(fixture.hiddenCourse._id)).to.equal(true);
        expect(fixture.publicChild.parentId?.equals(fixture.hiddenCourse._id)).to.equal(true);
    });

    it('rejects deleting a course node that a course still binds', async () => {
        const api = modelApi();
        const admin = actor(1, true);
        const boundId = fixture.boundCourse._id;
        const denied = await callError(() =>
            api.deleteNode({
                ...context(admin),
                id: boundId,
                expectedUpdatedAt: liveDate(fixture.boundCourse.updatedAt),
            }),
        );
        expect(denied instanceof Error, 'delete of a bound course node resolved').to.equal(true);
        if (!(denied instanceof Error)) return;
        expect(denied.name).to.equal('MindmapConflictError');
        expect(nodes.some((node) => node._id.equals(boundId))).to.equal(true);
    });

    it('rejects coursePins and stores an existing problem doc id', async () => {
        const api = modelApi();
        const teacher = actor(7, false);
        const node = fixture.publicChild;
        const pinned = await callError(() =>
            api.updateNode({
                ...context(teacher),
                id: node._id,
                expectedUpdatedAt: liveDate(node.updatedAt),
                patch: { coursePins: [12] },
            }),
        );
        expect(pinned instanceof Error, 'coursePins update resolved').to.equal(true);
        if (!(pinned instanceof Error)) return;
        expect(pinned.name).to.equal('MindmapRequestError');
        expect(Object.hasOwn(node, 'coursePins')).to.equal(false);

        const visibility = await callError(() =>
            api.updateNode({
                ...context(teacher),
                id: node._id,
                expectedUpdatedAt: liveDate(node.updatedAt),
                patch: { courseVisibility: 'hidden', ownerUids: [7] },
            }),
        );
        expect(visibility instanceof Error, 'course node fields update resolved').to.equal(true);
        if (!(visibility instanceof Error)) return;
        expect(visibility.name).to.equal('MindmapRequestError');
        expect(node.courseVisibility).to.equal(undefined);
        expect(node.ownerUids).to.equal(undefined);

        async function rejectProblemIds(problemIds: unknown, label: string): Promise<void> {
            const denied = await callError(() =>
                api.updateNode({
                    ...context(teacher),
                    id: node._id,
                    expectedUpdatedAt: liveDate(node.updatedAt),
                    patch: { problemIds },
                }),
            );
            expect(denied instanceof Error, `${label} resolved`).to.equal(true);
            if (!(denied instanceof Error)) return;
            expect(denied.name, label).to.equal('MindmapRequestError');
            expect(node.problemIds, label).to.deep.equal([]);
        }

        await rejectProblemIds(['99'], 'missing docId');
        await rejectProblemIds(['P12'], 'non-decimal doc id');
        await rejectProblemIds([12], 'numeric doc id');
        const storedProblem = documents.find((doc) => doc.docId === 12);
        if (!storedProblem) throw new Error('problem 12 missing from the fixture');
        storedProblem.archivedAt = atSecond(40);
        await rejectProblemIds(['12'], 'archived problem');
        delete storedProblem.archivedAt;

        const updated = await api.updateNode({
            ...context(teacher),
            id: node._id,
            expectedUpdatedAt: liveDate(node.updatedAt),
            patch: { problemIds: ['12'] },
        });
        expect(updated.problemIds).to.deep.equal(['12']);
        expect(node.problemIds).to.deep.equal(['12']);
    });

    it('stores an unarchived problem without a knowledge map and counts it on the node and its ancestors', async () => {
        const api = modelApi();
        const teacher = actor(7, false);
        const node = fixture.publicChild;
        const denied = await callError(() =>
            api.updateNode({
                ...context(teacher),
                id: node._id,
                expectedUpdatedAt: liveDate(node.updatedAt),
                patch: { problemIds: ['13'] },
            }),
        );
        const deniedMessage = denied instanceof Error ? denied.message : 'unmapped problem update';
        expect(denied === undefined, `unmapped problem update rejected: ${deniedMessage}`).to.equal(true);
        if (denied) return;
        expect(node.problemIds).to.deep.equal(['13']);

        const listed = await api.listProblemsForNode(DOMAIN_ID, fixture.mapId, node._id, {});
        const panel = listed.find((item) => item.docId === 13);
        expect(panel === undefined, 'unmapped problem missing from the node panel').to.equal(false);
        if (!panel) return;
        expect(panel.sources).to.deep.equal(['manual']);

        let counts: Record<string, number> | undefined;
        const countError = await callError(async () => {
            counts = await api.getNodeReferenceCounts(fixture.mapId, nodes);
        });
        const countMessage = countError instanceof Error ? countError.message : 'reference counts';
        expect(countError === undefined, `reference count rejected an unmapped problem: ${countMessage}`).to.equal(true);
        if (!counts) return;
        expect(counts[node._id.toHexString()]).to.equal(1);
        expect(counts[fixture.publicCourse._id.toHexString()]).to.equal(1);
        expect(counts[fixture.rootId.toHexString()]).to.equal(1);
        expect(counts[fixture.hiddenChild._id.toHexString()]).to.equal(0);
    });

    it('materializes a node under a hidden course without the merged root in the path label', async () => {
        const api = modelApi();
        const result = await api.materialize(fixture.mapId, [fixture.hiddenChild._id], { requirePublicMap: true });
        expect(result.nodePaths.length).to.equal(1);
        const label = result.nodePaths[0].label;
        expect(label.includes('操作系统'), label).to.equal(true);
        expect(label.includes('进程'), label).to.equal(true);
        expect(result.tags).to.deep.equal(['操作系统', '进程']);
        expect(label.includes('知识图谱'), label).to.equal(false);
    });

    it('omits a hidden course node and its descendants from the public snapshot', async () => {
        const api = modelApi();
        const snapshot = await api.getPublicKnowledgeMapSnapshot(fixture.mapId);
        expect(snapshot === null).to.equal(false);
        if (!snapshot) return;
        const ids = snapshot.nodes.map((node) => node._id.toHexString());
        expect(ids.includes(fixture.rootId.toHexString())).to.equal(true);
        expect(ids.includes(fixture.publicCourse._id.toHexString())).to.equal(true);
        expect(ids.includes(fixture.publicChild._id.toHexString())).to.equal(true);
        expect(ids.includes(fixture.boundCourse._id.toHexString())).to.equal(true);
        expect(ids.includes(fixture.hiddenCourse._id.toHexString()), 'hidden course node').to.equal(false);
        expect(ids.includes(fixture.hiddenChild._id.toHexString()), 'hidden descendant').to.equal(false);
        expect(ids.includes(fixture.hiddenGrand._id.toHexString()), 'hidden grandchild').to.equal(false);
    });

    it('throws MindmapNotMergedError from model entry points when the graph is not merged', async () => {
        const api = modelApi();
        const admin = actor(1, true);
        const arrangements: Array<{ label: string; arrange: () => void }> = [
            {
                label: 'two maps',
                arrange: () => {
                    maps.push(extraMap());
                },
            },
            {
                label: 'isDefault',
                arrange: () => {
                    maps[0].isDefault = true;
                },
            },
            {
                label: 'ownerDomainId',
                arrange: () => {
                    maps[0].ownerDomainId = DOMAIN_ID;
                },
            },
            {
                label: 'ownerCourseId',
                arrange: () => {
                    maps[0].ownerCourseId = new ObjectId();
                },
            },
            {
                label: 'coursePins',
                arrange: () => {
                    fixture.publicChild.coursePins = [12];
                },
            },
        ];
        const probes: Array<{ label: string; run: () => Promise<unknown> }> = [
            { label: 'listKnowledgeMaps', run: () => api.listKnowledgeMaps() },
            { label: 'getPublicKnowledgeMapSnapshot', run: () => api.getPublicKnowledgeMapSnapshot(fixture.mapId) },
            {
                label: 'materialize',
                run: () => api.materialize(fixture.mapId, [fixture.hiddenChild._id], { requirePublicMap: true }),
            },
            {
                label: 'createNode',
                run: () =>
                    api.createNode({
                        ...context(admin),
                        parentId: fixture.publicChild._id,
                        expectedParentUpdatedAt: liveDate(fixture.publicChild.updatedAt),
                        topic: '探针',
                    }),
            },
            {
                label: 'updateNode',
                run: () =>
                    api.updateNode({
                        ...context(admin),
                        id: fixture.publicChild._id,
                        expectedUpdatedAt: liveDate(fixture.publicChild.updatedAt),
                        patch: { topic: '探针' },
                    }),
            },
            {
                label: 'deleteNode',
                run: () =>
                    api.deleteNode({
                        ...context(admin),
                        id: fixture.publicChild._id,
                        expectedUpdatedAt: liveDate(fixture.publicChild.updatedAt),
                    }),
            },
        ];
        for (const arrangement of arrangements) {
            for (const probe of probes) {
                fixture = buildMerged();
                arrangement.arrange();
                const label = `${arrangement.label} ${probe.label}`;
                const error = await callError(probe.run);
                expect(error instanceof Error, `${label} resolved`).to.equal(true);
                if (!(error instanceof Error)) return;
                expect(error.name, label).to.equal('MindmapNotMergedError');
                expect(error.message, label).to.equal(NOT_MERGED_MESSAGE);
            }
        }
    });
});
