import { createRequire } from 'node:module';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const Module = require('module');
const requireFromFramework = createRequire(require.resolve('../../../framework/framework/package.json'));
const { ObjectId } = requireFromFramework('mongodb');

const NOT_MERGED = '知识图谱尚未合并，请先运行 mindmap:merge-courses';

/** Course node ids sort a1 before a2. Content ids stay stable for sibling assertions. */
const id = {
    map: '64f0a1000000000000000002',
    root: '64f0a1000000000000000010',
    courseHidden: '64f0a10000000000000000a1',
    coursePublic: '64f0a10000000000000000a2',
    graph: '64f0a1000000000000000020',
    linear: '64f0a1000000000000000021',
    knapsack: '64f0a1000000000000000022',
    dp: '64f0a1000000000000000030',
    shortest: '64f0a1000000000000000040',
} as const;

interface TeachKnowledgeSourceNode {
    id: string;
    parentId: string | null;
    title: string;
    order: number;
    pinnedDocIds: number[];
}

interface TeachKnowledgeSource {
    courseId: string;
    title: string;
    hidden: boolean;
    mapId: string;
    rootNodeId: string;
    nodes: TeachKnowledgeSourceNode[];
}

interface MindmapModelFacade {
    listTeachKnowledgeSources?: () => Promise<unknown>;
    listCourseNodes?: unknown;
    courseNodeOf?: unknown;
    canEditCourseSubtree?: unknown;
    getMergedMap?: unknown;
}

interface NodeDocument {
    _id: InstanceType<typeof ObjectId>;
    mapId: InstanceType<typeof ObjectId>;
    parentId: InstanceType<typeof ObjectId> | null;
    topic: string;
    tags: string[];
    problemIds: string[];
    coursePins?: number[];
    courseVisibility?: 'public' | 'hidden';
    ownerUids?: number[];
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
    ownerDomainId?: string;
    ownerCourseId?: InstanceType<typeof ObjectId>;
    isDefault?: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const nodes: NodeDocument[] = [];
const maps: MapDocument[] = [];

class MindmapRequestError extends Error {
    readonly code = 400;

    readonly params: unknown[];

    constructor(message: string) {
        super(message);
        this.params = [message];
    }
}

class MindmapConflictError extends Error {
    readonly code = 409;

    readonly params: unknown[];

    constructor(message: string) {
        super(message);
        this.params = [message];
    }
}

class PrivilegeError extends Error {
    readonly code = 403;

    constructor(privilege: number) {
        super(String(privilege));
        this.name = 'PrivilegeError';
    }
}

class Logger {
    readonly name: string;

    constructor(name: string) {
        this.name = name;
    }

    info() {
        return this.name;
    }

    warn() {
        return this.name;
    }

    error() {
        return this.name;
    }
}

interface ObjectIdLike {
    equals(other: ObjectIdLike): boolean;
    toHexString(): string;
}

function isObjectId(value: unknown): value is ObjectIdLike {
    return value instanceof ObjectId;
}

function oid(hex: string): ObjectIdLike {
    return new ObjectId(hex);
}

function readField(document: object, key: string): unknown {
    return (document as Record<string, unknown>)[key];
}

function equalValue(left: unknown, right: unknown): boolean {
    if (isObjectId(left) && isObjectId(right)) return left.equals(right);
    if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
    return left === right;
}

function matches(document: object, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([key, value]) => equalValue(readField(document, key), value));
}

function compareValues(left: unknown, right: unknown): number {
    if (isObjectId(left) && isObjectId(right)) return left.toHexString().localeCompare(right.toHexString());
    if (typeof left === 'number' && typeof right === 'number') {
        if (left === right) return 0;
        return left < right ? -1 : 1;
    }
    if (typeof left === 'string' && typeof right === 'string') {
        if (left === right) return 0;
        return left < right ? -1 : 1;
    }
    if (Object.is(left, right)) return 0;
    if (left === null || left === undefined) return right === null || right === undefined ? 0 : -1;
    if (right === null || right === undefined) return 1;
    return 0;
}

function sortedCursor<T extends object>(source: T[]) {
    let values = source.slice();
    const cursor = {
        sort(spec: Record<string, number>) {
            values.sort((left, right) => {
                for (const [key, direction] of Object.entries(spec)) {
                    const compared = compareValues(readField(left, key), readField(right, key));
                    if (compared !== 0) return compared * direction;
                }
                return 0;
            });
            return cursor;
        },
        limit(count: number) {
            values = values.slice(0, count);
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

function collectionOf<T extends object>(source: T[]) {
    return {
        find(filter: Record<string, unknown> = {}) {
            return sortedCursor(source.filter((entry) => matches(entry, filter)));
        },
        async findOne(filter: Record<string, unknown> = {}) {
            return source.find((entry) => matches(entry, filter)) ?? null;
        },
        async createIndex() {
            return 'test-index';
        },
    };
}

function mergedMapOrThrow(): MapDocument {
    const map = maps[0];
    const pinned = nodes.some((node) => Object.hasOwn(node, 'coursePins'));
    const dirty = maps.length !== 1
        || pinned
        || !map
        || Object.hasOwn(map, 'isDefault')
        || Boolean(map.ownerDomainId)
        || Boolean(map.ownerCourseId)
        || map.visibility !== 'public';
    if (dirty) throw new MindmapRequestError(NOT_MERGED);
    return map;
}

const mapsColl = collectionOf(maps);
const nodesColl = collectionOf(nodes);
const mindmapDbStub = {
    mapsColl,
    nodesColl,
    async getMergedMap() {
        return mergedMapOrThrow();
    },
};

const hydroStub = {
    ObjectId,
    PRIV: { PRIV_EDIT_SYSTEM: 1 },
    PrivilegeError,
    Context: class Context {},
    localizeError(text: unknown) {
        return text;
    },
    localizedErrorText(strings: TemplateStringsArray, ...values: unknown[]) {
        return String.raw({ raw: strings }, ...values.map((value) => String(value)));
    },
    db: {
        collection(name: string) {
            if (name === 'mindmap.maps') return mapsColl;
            if (name === 'mindmap.nodes') return nodesColl;
            if (name === 'document') return collectionOf([]);
            throw new Error(`unexpected collection ${name}`);
        },
    },
};

function inMindmap(filename: string): boolean {
    return filename.includes('/krypton-mindmap/');
}

function isIndex(filename: string): boolean {
    return filename.endsWith('/krypton-mindmap/index.ts');
}

function stubFor(filename: string, request: string): unknown {
    if (!inMindmap(filename)) return null;
    if (isIndex(filename)) {
        if (request === './src/db') return { async ensureIndexes() { return undefined; } };
        if (request === './src/handler') return { applyHandlers() { return undefined; } };
        if (request === './src/migration') return { migrationScripts: [] as unknown[] };
        if (request === './src/model') return {};
    }
    if (request === 'hydrooj') return hydroStub;
    if (request === './db' || request === './db.ts') return mindmapDbStub;
    if (request === '@hydrooj/utils') return { Logger };
    if (request === './error' || request === './error.ts') return { MindmapRequestError, MindmapConflictError };
    return null;
}

let mindmapModel: MindmapModelFacade | undefined;
let loadError: Error | undefined;

function loadMindmapModel(): MindmapModelFacade {
    if (mindmapModel) return mindmapModel;
    if (loadError) throw loadError;
    const indexPath = require.resolve('../index.ts');
    const originalLoad = Module._load;
    Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
        const stub = stubFor(parent?.filename ?? '', request);
        if (stub !== null) return stub;
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[indexPath];
        const loaded: unknown = require(indexPath);
        if (!loaded || typeof loaded !== 'object' || !('mindmapModel' in loaded)) {
            throw new Error('listTeachKnowledgeSources is not exported');
        }
        mindmapModel = (loaded as { mindmapModel: MindmapModelFacade }).mindmapModel;
        return mindmapModel;
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        loadError = new Error(
            detail.includes('listTeachKnowledgeSources') ? detail : `listTeachKnowledgeSources is not exported: ${detail}`,
        );
        throw loadError;
    } finally {
        Module._load = originalLoad;
    }
}

function teachList(): () => Promise<unknown> {
    let model: MindmapModelFacade;
    try {
        model = loadMindmapModel();
    } catch (error) {
        expect.fail(error instanceof Error ? error.message : String(error));
    }
    if (typeof model.listTeachKnowledgeSources !== 'function') expect.fail('listTeachKnowledgeSources is not exported');
    return model.listTeachKnowledgeSources;
}

function isTeachKnowledgeSourceNode(value: unknown): value is TeachKnowledgeSourceNode {
    if (!value || typeof value !== 'object') return false;
    const node = value as Record<string, unknown>;
    return typeof node.id === 'string'
        && (typeof node.parentId === 'string' || node.parentId === null)
        && typeof node.title === 'string'
        && typeof node.order === 'number'
        && Array.isArray(node.pinnedDocIds)
        && node.pinnedDocIds.every((entry) => typeof entry === 'number');
}

function isTeachKnowledgeSource(value: unknown): value is TeachKnowledgeSource {
    if (!value || typeof value !== 'object') return false;
    const source = value as Record<string, unknown>;
    return typeof source.courseId === 'string'
        && typeof source.title === 'string'
        && typeof source.hidden === 'boolean'
        && typeof source.mapId === 'string'
        && typeof source.rootNodeId === 'string'
        && Array.isArray(source.nodes)
        && source.nodes.every(isTeachKnowledgeSourceNode);
}

function now() {
    return new Date('2026-07-16T00:00:00.000Z');
}

function makeNode(
    hex: string,
    mapHex: string,
    parentHex: string | null,
    topic: string,
    order: number,
    problemIds: string[] = [],
): NodeDocument {
    const stamp = now();
    return {
        _id: oid(hex),
        mapId: oid(mapHex),
        parentId: parentHex ? oid(parentHex) : null,
        topic,
        tags: [],
        problemIds,
        order,
        createdAt: stamp,
        updatedAt: stamp,
    };
}

function makeCourse(hex: string, topic: string, order: number, visibility: 'public' | 'hidden', ownerUids: number[]): NodeDocument {
    return {
        ...makeNode(hex, id.map, id.root, topic, order),
        courseVisibility: visibility,
        ownerUids,
    };
}

function makeMap(hex: string, title: string, rootHex: string, visibility: 'hidden' | 'public' = 'public'): MapDocument {
    const stamp = now();
    return {
        _id: oid(hex),
        title,
        rootNodeId: oid(rootHex),
        visibility,
        layoutDirection: 'RIGHT',
        createdAt: stamp,
        updatedAt: stamp,
    };
}

function seed() {
    maps.length = 0;
    nodes.length = 0;
    maps.push(makeMap(id.map, '知识图谱', id.root));
    nodes.push(
        makeNode(id.root, id.map, null, '知识图谱', 0),
        makeCourse(id.courseHidden, '课程专属导图', 1, 'hidden', [4]),
        makeCourse(id.coursePublic, '公开导图', 2, 'public', []),
        makeNode(id.knapsack, id.map, id.dp, '背包', 4),
        makeNode(id.graph, id.map, id.coursePublic, '图论', 2, ['12', '7', 'P1001']),
        makeNode(id.shortest, id.map, id.graph, '最短路', 1),
        makeNode(id.dp, id.map, id.coursePublic, '动态规划', 1),
        makeNode(id.linear, id.map, id.dp, '线性', 4),
    );
}

function requireNode(hex: string): NodeDocument {
    const node = nodes.find((entry) => entry._id.toHexString() === hex);
    if (!node) expect.fail(`missing node ${hex}`);
    return node;
}

function errorText(error: unknown): string {
    if (!error || typeof error !== 'object') return String(error ?? '');
    const record = error as { message?: unknown; params?: unknown };
    const params = Array.isArray(record.params) ? record.params.map((value) => String(value)).join(' ') : '';
    return `${String(record.message ?? '')} ${params}`;
}

async function readSources(): Promise<TeachKnowledgeSource[]> {
    const list = teachList();
    const value: unknown = await list();
    if (!Array.isArray(value) || !value.every(isTeachKnowledgeSource)) {
        expect.fail(`listTeachKnowledgeSources returned an unexpected shape: ${JSON.stringify(value)}`);
    }
    return value;
}

async function listedSources(): Promise<TeachKnowledgeSource[]> {
    seed();
    return readSources();
}

function sourceByTitle(sources: TeachKnowledgeSource[], title: string): TeachKnowledgeSource {
    const source = sources.find((entry) => entry.title === title);
    if (!source) expect.fail(`missing knowledge source ${title}`);
    return source;
}

function siblingFields(sourceNodes: TeachKnowledgeSourceNode[], parentId: string | null) {
    return sourceNodes
        .filter((node) => node.parentId === parentId)
        .map((node) => ({
            id: node.id,
            parentId: node.parentId,
            title: node.title,
            order: node.order,
        }));
}

function identityOf(source: TeachKnowledgeSource) {
    return {
        courseId: source.courseId,
        title: source.title,
        hidden: source.hidden,
        mapId: source.mapId,
        rootNodeId: source.rootNodeId,
    };
}

describe('teach knowledge sources', { concurrency: 1 }, () => {
    it('publishes course-node helpers on mindmapModel and drops course-owned operations', () => {
        const model = loadMindmapModel() as MindmapModelFacade & Record<string, unknown>;
        expect(typeof model.listCourseNodes).to.equal('function');
        expect(typeof model.courseNodeOf).to.equal('function');
        expect(typeof model.canEditCourseSubtree).to.equal('function');
        expect(typeof model.getMergedMap).to.equal('function');
        expect(Object.keys(model).filter((key) => key.includes('CourseOwned'))).to.deep.equal([]);
    });

    it('lists one source per course node on the merged map', async () => {
        const sources = await listedSources();
        const summary = sources.map(identityOf).sort((left, right) => (left.courseId < right.courseId ? -1 : 1));
        expect(summary).to.deep.equal([
            {
                courseId: id.courseHidden,
                title: '课程专属导图',
                hidden: true,
                mapId: id.map,
                rootNodeId: id.courseHidden,
            },
            {
                courseId: id.coursePublic,
                title: '公开导图',
                hidden: false,
                mapId: id.map,
                rootNodeId: id.coursePublic,
            },
        ]);
        expect(sources.some((source) => source.courseId === id.root || source.rootNodeId === id.root)).to.equal(false);
    });

    it('omits the course node and keeps siblings ordered by order then id', async () => {
        const sources = await listedSources();
        const publicSource = sourceByTitle(sources, '公开导图');
        const sourceNodes = publicSource.nodes;
        expect(sourceNodes.map((node) => node.id).sort()).to.deep.equal(
            [id.dp, id.graph, id.knapsack, id.linear, id.shortest].sort(),
        );
        expect(sourceNodes.some((node) => node.id === id.coursePublic || node.id === id.root || node.parentId === id.coursePublic)).to.equal(false);
        expect(siblingFields(sourceNodes, null)).to.deep.equal([
            {
                id: id.dp, parentId: null, title: '动态规划', order: 1,
            },
            {
                id: id.graph, parentId: null, title: '图论', order: 2,
            },
        ]);
        expect(siblingFields(sourceNodes, id.dp)).to.deep.equal([
            {
                id: id.linear, parentId: id.dp, title: '线性', order: 4,
            },
            {
                id: id.knapsack, parentId: id.dp, title: '背包', order: 4,
            },
        ]);
        expect(siblingFields(sourceNodes, id.graph)).to.deep.equal([
            {
                id: id.shortest, parentId: id.graph, title: '最短路', order: 1,
            },
        ]);
        expect(sourceByTitle(sources, '课程专属导图').nodes).to.deep.equal([]);
    });

    it('pins positive problem doc ids in ascending order', async () => {
        const sources = await listedSources();
        const publicSource = sourceByTitle(sources, '公开导图');
        const graph = publicSource.nodes.find((node) => node.id === id.graph);
        const dp = publicSource.nodes.find((node) => node.id === id.dp);
        expect(graph?.pinnedDocIds).to.deep.equal([7, 12]);
        expect(dp?.pinnedDocIds).to.deep.equal([]);
    });

    it('keeps two course nodes that share a title distinct on the merged map', async () => {
        maps.length = 0;
        nodes.length = 0;
        maps.push(makeMap(id.map, '知识图谱', id.root));
        nodes.push(
            makeNode(id.root, id.map, null, '知识图谱', 0),
            makeCourse(id.courseHidden, '同名导图', 1, 'hidden', []),
            makeCourse(id.coursePublic, '同名导图', 2, 'public', []),
        );
        const sources = await readSources();
        const summary = sources.map(identityOf).sort((left, right) => (left.courseId < right.courseId ? -1 : 1));
        expect(summary).to.deep.equal([
            {
                courseId: id.courseHidden,
                title: '同名导图',
                hidden: true,
                mapId: id.map,
                rootNodeId: id.courseHidden,
            },
            {
                courseId: id.coursePublic,
                title: '同名导图',
                hidden: false,
                mapId: id.map,
                rootNodeId: id.coursePublic,
            },
        ]);
    });

    it('lists child nodes of a hidden course node', async () => {
        seed();
        const chapter = '64f0a1000000000000000091';
        nodes.push(makeNode(chapter, id.map, id.courseHidden, '专属章', 2, ['9', '4']));
        const sources = await readSources();
        const course = sourceByTitle(sources, '课程专属导图');
        expect(course.hidden).to.equal(true);
        expect(course.mapId).to.equal(id.map);
        expect(course.rootNodeId).to.equal(id.courseHidden);
        expect(course.nodes).to.deep.equal([
            {
                id: chapter,
                parentId: null,
                title: '专属章',
                order: 2,
                pinnedDocIds: [4, 9],
            },
        ]);
    });

    it('deduplicates problem doc ids', async () => {
        seed();
        const graph = requireNode(id.graph);
        graph.problemIds = ['12', '7', '12', 'P1001'];
        const sources = await readSources();
        const node = sourceByTitle(sources, '公开导图').nodes.find((entry) => entry.id === id.graph);
        expect(node?.pinnedDocIds).to.deep.equal([7, 12]);
    });

    it('drops problem ids that are not positive integers', async () => {
        seed();
        const graph = requireNode(id.graph);
        graph.problemIds = ['0', '00', '-1', '1.5', 'P1001', '', '12', ' 12'];
        const sources = await readSources();
        const node = sourceByTitle(sources, '公开导图').nodes.find((entry) => entry.id === id.graph);
        expect(node?.pinnedDocIds).to.deep.equal([12]);
    });

    it('rejects sources when more than one map exists', async () => {
        maps.length = 0;
        nodes.length = 0;
        maps.push(makeMap(id.map, '知识图谱', id.root), makeMap(id.coursePublic, '另一张', id.root));
        nodes.push(makeNode(id.root, id.map, null, '知识图谱', 0));
        let thrown = '';
        try {
            await teachList()();
        } catch (error) {
            thrown = errorText(error);
        }
        expect(thrown).to.include(NOT_MERGED);
    });

    it('rejects sources when a node still has course pins', async () => {
        seed();
        requireNode(id.graph).coursePins = [7];
        let thrown = '';
        try {
            await teachList()();
        } catch (error) {
            thrown = errorText(error);
        }
        expect(thrown).to.include(NOT_MERGED);
    });
});
