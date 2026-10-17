import { createRequire } from 'node:module';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const Module = require('module');
const requireFromFramework = createRequire(require.resolve('../../../framework/framework/package.json'));
const { ObjectId } = requireFromFramework('mongodb');

/** Smaller _id but later title, so only title-then-id order puts the hidden course map second. */
const id = {
    courseMap: '64f0a1000000000000000001',
    publicMap: '64f0a1000000000000000002',
    publicRoot: '64f0a1000000000000000010',
    graph: '64f0a1000000000000000020',
    linear: '64f0a1000000000000000021',
    knapsack: '64f0a1000000000000000022',
    dp: '64f0a1000000000000000030',
    shortest: '64f0a1000000000000000040',
    courseRoot: '64f0a1000000000000000090',
    ownerCourse: '64f0a10000000000000000c0',
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
}

interface NodeDocument {
    _id: InstanceType<typeof ObjectId>;
    mapId: InstanceType<typeof ObjectId>;
    parentId: InstanceType<typeof ObjectId> | null;
    topic: string;
    tags: string[];
    problemIds: string[];
    coursePins?: number[];
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

const mapsColl = collectionOf(maps);
const nodesColl = collectionOf(nodes);
const mindmapDbStub = { mapsColl, nodesColl };

const hydroStub = {
    ObjectId,
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
    coursePins?: number[],
): NodeDocument {
    const stamp = now();
    return {
        _id: oid(hex),
        mapId: oid(mapHex),
        parentId: parentHex ? oid(parentHex) : null,
        topic,
        tags: [],
        problemIds,
        ...(coursePins ? { coursePins } : {}),
        order,
        createdAt: stamp,
        updatedAt: stamp,
    };
}

function makeMap(
    hex: string,
    title: string,
    rootHex: string,
    visibility: 'hidden' | 'public',
    owner?: { domainId: string; courseHex: string },
): MapDocument {
    const stamp = now();
    return {
        _id: oid(hex),
        title,
        rootNodeId: oid(rootHex),
        visibility,
        layoutDirection: 'RIGHT',
        ...(owner ? { ownerDomainId: owner.domainId, ownerCourseId: oid(owner.courseHex) } : {}),
        createdAt: stamp,
        updatedAt: stamp,
    };
}

function seed() {
    maps.length = 0;
    nodes.length = 0;
    maps.push(
        makeMap(id.courseMap, '课程专属导图', id.courseRoot, 'hidden', { domainId: 'school-a', courseHex: id.ownerCourse }),
        makeMap(id.publicMap, '公开导图', id.publicRoot, 'public'),
    );
    nodes.push(
        makeNode(id.knapsack, id.publicMap, id.dp, '背包', 4),
        makeNode(id.graph, id.publicMap, id.publicRoot, '图论', 2, ['12', 'P1001'], [7]),
        makeNode(id.shortest, id.publicMap, id.graph, '最短路', 1),
        makeNode(id.publicRoot, id.publicMap, null, '算法', 0),
        makeNode(id.courseRoot, id.courseMap, null, '课程根', 0),
        makeNode(id.dp, id.publicMap, id.publicRoot, '动态规划', 1),
        makeNode(id.linear, id.publicMap, id.dp, '线性', 4),
    );
}

function requireNode(hex: string): NodeDocument {
    const node = nodes.find((entry) => entry._id.toHexString() === hex);
    if (!node) expect.fail(`missing node ${hex}`);
    return node;
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

describe('teach knowledge sources', { concurrency: 1 }, () => {
    it('lists a public map and a hidden course-owned map sorted by title', async () => {
        const sources = await listedSources();
        expect(sources.map((source) => source.title)).to.deep.equal(['公开导图', '课程专属导图']);
        expect(sources.map((source) => source.hidden)).to.deep.equal([false, true]);
        expect(sources.map((source) => source.courseId)).to.deep.equal([id.publicMap, id.courseMap]);
        expect(sources.map((source) => source.mapId)).to.deep.equal([id.publicMap, id.courseMap]);
        expect(sources.map((source) => source.rootNodeId)).to.deep.equal([id.publicRoot, id.courseRoot]);
        expect(sources[1].nodes).to.deep.equal([]);
    });

    it('omits the root and keeps siblings ordered by order then id', async () => {
        const sources = await listedSources();
        const publicSource = sourceByTitle(sources, '公开导图');
        const sourceNodes = publicSource.nodes;
        expect(sourceNodes.map((node) => node.id).sort()).to.deep.equal(
            [id.dp, id.graph, id.knapsack, id.linear, id.shortest].sort(),
        );
        expect(sourceNodes.some((node) => node.id === id.publicRoot || node.parentId === id.publicRoot)).to.equal(false);
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

    it('pins positive problem doc ids and course pins in ascending order', async () => {
        const sources = await listedSources();
        const publicSource = sourceByTitle(sources, '公开导图');
        const graph = publicSource.nodes.find((node) => node.id === id.graph);
        const dp = publicSource.nodes.find((node) => node.id === id.dp);
        expect(graph?.pinnedDocIds).to.deep.equal([7, 12]);
        expect(dp?.pinnedDocIds).to.deep.equal([]);
    });

    it('orders maps that share a title by map id', async () => {
        maps.length = 0;
        nodes.length = 0;
        maps.push(
            makeMap(id.publicMap, '同名导图', id.publicRoot, 'public'),
            makeMap(id.courseMap, '同名导图', id.courseRoot, 'hidden', {
                domainId: 'school-a',
                courseHex: id.ownerCourse,
            }),
        );
        nodes.push(
            makeNode(id.publicRoot, id.publicMap, null, '算法', 0),
            makeNode(id.courseRoot, id.courseMap, null, '课程根', 0),
        );
        const sources = await readSources();
        expect(sources.map((source) => source.mapId)).to.deep.equal([id.courseMap, id.publicMap]);
        expect(sources.map((source) => source.courseId)).to.deep.equal([id.courseMap, id.publicMap]);
        expect(sources.map((source) => source.title)).to.deep.equal(['同名导图', '同名导图']);
        expect(sources.map((source) => source.hidden)).to.deep.equal([true, false]);
    });

    it('lists child nodes of a hidden course-owned map', async () => {
        seed();
        const chapter = '64f0a1000000000000000091';
        nodes.push(makeNode(chapter, id.courseMap, id.courseRoot, '专属章', 2, [], [9, 4]));
        const sources = await readSources();
        const course = sourceByTitle(sources, '课程专属导图');
        expect(course.hidden).to.equal(true);
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

    it('deduplicates problem doc ids and course pins', async () => {
        seed();
        const graph = requireNode(id.graph);
        graph.problemIds = ['12', '7', '12', 'P1001'];
        graph.coursePins = [7, 12, 7];
        const sources = await readSources();
        const node = sourceByTitle(sources, '公开导图').nodes.find((entry) => entry.id === id.graph);
        expect(node?.pinnedDocIds).to.deep.equal([7, 12]);
    });

    it('drops problem ids that are not positive integers', async () => {
        seed();
        const graph = requireNode(id.graph);
        graph.problemIds = ['0', '00', '-1', '1.5', 'P1001', '', '12', ' 12'];
        graph.coursePins = [7];
        const sources = await readSources();
        const node = sourceByTitle(sources, '公开导图').nodes.find((entry) => entry.id === id.graph);
        expect(node?.pinnedDocIds).to.deep.equal([7, 12]);
    });
});
