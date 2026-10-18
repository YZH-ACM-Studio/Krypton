import { createRequire } from 'node:module';
import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
const framework = require('../../../framework/framework');
const requireFromFramework = createRequire(require.resolve('../../../framework/framework/package.json'));
const { ObjectId } = requireFromFramework('mongodb');

const PRIV_EDIT_SYSTEM = 1;
const NOT_MERGED_MESSAGE = '知识图谱尚未合并，请先运行 mindmap:merge-courses';

type MindmapObjectId = InstanceType<typeof ObjectId>;

interface MindmapActor {
    _id: number;
    hasPriv(...privileges: number[]): boolean;
}

interface CourseNodeView {
    id: string;
    title: string;
    order: number;
    visibility: 'public' | 'hidden';
    ownerUids: number[];
}

interface CourseNodesApi {
    getMergedMap(): Promise<{ _id: MindmapObjectId; rootNodeId: MindmapObjectId; title: string; visibility: string }>;
    listCourseNodes(): Promise<CourseNodeView[]>;
    courseNodeOf(nodeId: MindmapObjectId | string): Promise<CourseNodeView | null>;
    canEditCourseSubtree(actor: MindmapActor, course: CourseNodeView): boolean;
    canSeeCourseNode(actor: MindmapActor | null, course: CourseNodeView): boolean;
    setCourseNodeSettings(input: {
        actor: MindmapActor;
        nodeId: string;
        expectedUpdatedAt: Date;
        visibility: 'public' | 'hidden';
        ownerUids: number[];
    }): Promise<CourseNodeView>;
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

interface Fixture {
    mapId: MindmapObjectId;
    rootId: MindmapObjectId;
    courseEarly: NodeDocument;
    courseLate: NodeDocument;
    tieLow: NodeDocument;
    tieHigh: NodeDocument;
    child: NodeDocument;
    grandchild: NodeDocument;
}

interface MongoUpdate {
    $set?: Record<string, unknown>;
    $unset?: Record<string, unknown>;
}

class PrivilegeError extends framework.ForbiddenError {
    name = 'PrivilegeError';
}

class PermissionError extends framework.ForbiddenError {
    name = 'PermissionError';
}

let nodes: NodeDocument[] = [];
let maps: MapDocument[] = [];
const logs: Array<{ level: string; args: unknown[] }> = [];

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
        async createIndex() {
            return 'test-index';
        },
    };
}

function applyUpdate(target: object, update: MongoUpdate): void {
    const record = target as Record<string, unknown>;
    if (update.$set) Object.assign(record, update.$set);
    if (update.$unset) {
        for (const key of Object.keys(update.$unset)) delete record[key];
    }
}

const nodesColl = makeCollection(() => nodes);
const mapsColl = makeCollection(() => maps);
const documentColl = {
    find() {
        return cursor([]);
    },
    async findOne() {
        return null;
    },
    async countDocuments() {
        return 0;
    },
    async updateOne() {
        return { matchedCount: 0, modifiedCount: 0 };
    },
    async insertOne() {
        return { insertedId: null };
    },
};
const dbStub = {
    collection(name: string) {
        if (name === 'mindmap.nodes') return nodesColl;
        if (name === 'mindmap.maps') return mapsColl;
        if (name === 'document') return documentColl;
        throw new Error(`unexpected collection ${name}`);
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
    SystemModel: {
        get() {
            return undefined;
        },
    },
    db: dbStub,
};

function isMindmapFile(parent: NodeModule | undefined): boolean {
    return typeof parent?.filename === 'string' && parent.filename.includes('/packages/krypton-mindmap/');
}

const originalLoad = Module._load;
let mindmapDb: Record<string, unknown> | undefined;
let mindmapModel: Record<string, unknown> | undefined;
let loadError: unknown;

try {
    const dbPath = require.resolve('../src/db.ts');
    const modelPath = require.resolve('../src/model.ts');
    const errorPath = require.resolve('../src/error.ts');
    const defaultMapPath = require.resolve('../src/default-map.ts');
    Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
        if (request === 'hydrooj' && isMindmapFile(parent)) return hydroojStub;
        if (request === '@hydrooj/utils' && isMindmapFile(parent)) return { Logger };
        return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[dbPath];
    delete require.cache[modelPath];
    delete require.cache[errorPath];
    delete require.cache[defaultMapPath];
    mindmapDb = require(dbPath) as Record<string, unknown>;
    mindmapModel = require(modelPath) as Record<string, unknown>;
} catch (caught) {
    loadError = caught;
} finally {
    Module._load = originalLoad;
}

function courseApi(): CourseNodesApi {
    if (!mindmapDb || !mindmapModel) {
        const reason = loadError instanceof Error ? loadError.message : String(loadError ?? 'db.ts or model.ts did not load');
        const failure = new Error(`failed to load db.ts and model.ts: ${reason}`);
        if (loadError instanceof Error) failure.cause = loadError;
        throw failure;
    }
    const required: Array<[Record<string, unknown>, string, string]> = [
        [mindmapDb, 'db.ts', 'getMergedMap'],
        [mindmapDb, 'db.ts', 'setCourseNodeSettings'],
        [mindmapModel, 'model.ts', 'listCourseNodes'],
        [mindmapModel, 'model.ts', 'courseNodeOf'],
        [mindmapModel, 'model.ts', 'canSeeCourseNode'],
        [mindmapModel, 'model.ts', 'canEditCourseSubtree'],
    ];
    const missing = required.filter(([bucket, , name]) => typeof bucket[name] !== 'function').map(([, moduleName, name]) => `${moduleName} ${name}`);
    if (missing.length) throw new Error(`missing exports: ${missing.join(', ')}`);
    return {
        getMergedMap: mindmapDb.getMergedMap as CourseNodesApi['getMergedMap'],
        setCourseNodeSettings: mindmapDb.setCourseNodeSettings as CourseNodesApi['setCourseNodeSettings'],
        listCourseNodes: mindmapModel.listCourseNodes as CourseNodesApi['listCourseNodes'],
        courseNodeOf: mindmapModel.courseNodeOf as CourseNodesApi['courseNodeOf'],
        canSeeCourseNode: mindmapModel.canSeeCourseNode as CourseNodesApi['canSeeCourseNode'],
        canEditCourseSubtree: mindmapModel.canEditCourseSubtree as CourseNodesApi['canEditCourseSubtree'],
    };
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
    courseVisibility?: 'public' | 'hidden';
    ownerUids?: number[];
}): NodeDocument {
    const now = atSecond(input.second);
    const node: NodeDocument = {
        _id: input.id,
        mapId: input.mapId,
        parentId: input.parentId,
        topic: input.topic,
        tags: [],
        problemIds: [],
        order: input.order,
        createdAt: now,
        updatedAt: now,
    };
    if (input.courseVisibility !== undefined) node.courseVisibility = input.courseVisibility;
    if (input.ownerUids !== undefined) node.ownerUids = input.ownerUids;
    return node;
}

function buildMerged(): Fixture {
    const mapId = new ObjectId();
    const rootId = new ObjectId();
    const createdAt = atSecond(0);
    const tieIds = [new ObjectId(), new ObjectId()].sort((left, right) => compareValues(left, right));
    const root = makeNode({ id: rootId, mapId, parentId: null, topic: '知识图谱', order: 0, second: 0 });
    const courseEarly = makeNode({
        id: new ObjectId(),
        mapId,
        parentId: rootId,
        topic: '操作系统',
        order: 0,
        second: 1,
        courseVisibility: 'hidden',
        ownerUids: [7],
    });
    const courseLate = makeNode({
        id: new ObjectId(),
        mapId,
        parentId: rootId,
        topic: '算法知识图谱',
        order: 2,
        second: 2,
        courseVisibility: 'public',
        ownerUids: [],
    });
    const tieLow = makeNode({
        id: tieIds[0],
        mapId,
        parentId: rootId,
        topic: '学校安全',
        order: 4,
        second: 3,
        courseVisibility: 'public',
        ownerUids: [],
    });
    const tieHigh = makeNode({
        id: tieIds[1],
        mapId,
        parentId: rootId,
        topic: '面向对象程序设计',
        order: 4,
        second: 4,
        courseVisibility: 'public',
        ownerUids: [],
    });
    const child = makeNode({ id: new ObjectId(), mapId, parentId: courseEarly._id, topic: '进程', order: 1, second: 5 });
    const grandchild = makeNode({ id: new ObjectId(), mapId, parentId: child._id, topic: '调度', order: 1, second: 6 });
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
    nodes = [root, courseLate, tieHigh, tieLow, courseEarly, child, grandchild];
    return { mapId, rootId, courseEarly, courseLate, tieLow, tieHigh, child, grandchild };
}

function extraMap(): MapDocument {
    const createdAt = new Date('2026-09-01T00:00:00.000Z');
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

function snapshot(node: NodeDocument) {
    return {
        courseVisibility: node.courseVisibility,
        ownerUids: node.ownerUids ? [...node.ownerUids] : undefined,
        updatedAt: node.updatedAt.getTime(),
        coursePins: node.coursePins ? [...node.coursePins] : undefined,
    };
}

function courseView(node: NodeDocument): CourseNodeView {
    if (node.courseVisibility !== 'public' && node.courseVisibility !== 'hidden') {
        throw new Error(`fixture ${node.topic} is missing courseVisibility`);
    }
    return {
        id: node._id.toHexString(),
        title: node.topic,
        order: node.order,
        visibility: node.courseVisibility,
        ownerUids: [...(node.ownerUids || [])],
    };
}

async function rejected(run: () => Promise<unknown>): Promise<Error> {
    try {
        await run();
    } catch (caught) {
        if (caught instanceof Error) return caught;
        throw new Error(`rejected with a non-error: ${String(caught)}`);
    }
    throw new Error('expected the call to reject');
}

async function expectNotMerged(run: () => Promise<unknown>, label: string): Promise<void> {
    const error = await rejected(run);
    expect(error.name, label).to.equal('MindmapNotMergedError');
    expect(error.message, label).to.equal(NOT_MERGED_MESSAGE);
}

function expectCourse(actual: CourseNodeView | null, node: NodeDocument): void {
    expect(actual?.id).to.equal(node._id.toHexString());
    expect(actual?.title).to.equal(node.topic);
    expect(actual?.order).to.equal(node.order);
    expect(actual?.visibility).to.equal(node.courseVisibility);
    expect(actual?.ownerUids).to.deep.equal(node.ownerUids || []);
}

function scrubIds(value: unknown): unknown {
    if (typeof value === 'string') return value.replace(/[0-9a-f]{24}/gi, '');
    if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return value;
    if (value instanceof ObjectId || value instanceof Date) return '';
    if (Array.isArray(value)) return value.map((item) => scrubIds(item));
    if (typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, scrubIds(item)]));
    }
    return '';
}

let fixture = buildMerged();

beforeEach(() => {
    logs.length = 0;
    fixture = buildMerged();
});

describe('merged knowledge graph course nodes', () => {
    it('throws MindmapNotMergedError when the knowledge graph is not merged', async () => {
        const api = courseApi();
        const admin = actor(1, true);
        const cases: Array<{ label: string; arrange: () => void }> = [
            {
                label: 'two maps',
                arrange: () => {
                    maps.push(extraMap());
                },
            },
            {
                label: 'zero maps',
                arrange: () => {
                    maps = [];
                    nodes = [];
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
                    maps[0].ownerDomainId = 'system';
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
                    fixture.courseEarly.coursePins = [11];
                },
            },
        ];
        for (const entry of cases) {
            fixture = buildMerged();
            entry.arrange();
            const courseEarly = fixture.courseEarly;
            const grandchildId = fixture.grandchild._id;
            const before = snapshot(courseEarly);
            const nodeId = courseEarly._id.toHexString();
            const expectedUpdatedAt = new Date(courseEarly.updatedAt.getTime());
            await expectNotMerged(() => api.getMergedMap(), entry.label);
            await expectNotMerged(() => api.listCourseNodes(), entry.label);
            await expectNotMerged(() => api.courseNodeOf(grandchildId), entry.label);
            await expectNotMerged(
                () =>
                    api.setCourseNodeSettings({
                        actor: admin,
                        nodeId,
                        expectedUpdatedAt,
                        visibility: 'public',
                        ownerUids: [9],
                    }),
                entry.label,
            );
            expect(snapshot(courseEarly), entry.label).to.deep.equal(before);
        }
    });

    it('rechecks the merged-map preconditions on every getMergedMap call', async () => {
        const api = courseApi();
        const first = await api.getMergedMap();
        expect(first._id.equals(fixture.mapId)).to.equal(true);
        expect(first.rootNodeId.equals(fixture.rootId)).to.equal(true);
        expect(first.visibility).to.equal('public');
        maps.push(extraMap());
        const missed = await rejected(() => api.getMergedMap());
        expect(missed.name).to.equal('MindmapNotMergedError');
        expect(missed.message).to.equal(NOT_MERGED_MESSAGE);
        maps.pop();
        const second = await api.getMergedMap();
        expect(second._id.equals(fixture.mapId)).to.equal(true);
    });

    it('lists course nodes by order then id and resolves a grandchild to its course node', async () => {
        const api = courseApi();
        const listed = await api.listCourseNodes();
        expect(listed.map((course) => course.id)).to.deep.equal([
            fixture.courseEarly._id.toHexString(),
            fixture.courseLate._id.toHexString(),
            fixture.tieLow._id.toHexString(),
            fixture.tieHigh._id.toHexString(),
        ]);
        expect(listed.map((course) => course.order)).to.deep.equal([0, 2, 4, 4]);
        expectCourse(listed[0], fixture.courseEarly);
        expectCourse(listed[1], fixture.courseLate);
        expectCourse(await api.courseNodeOf(fixture.grandchild._id), fixture.courseEarly);
        expectCourse(await api.courseNodeOf(fixture.grandchild._id.toHexString()), fixture.courseEarly);
        expectCourse(await api.courseNodeOf(fixture.child._id), fixture.courseEarly);
        expectCourse(await api.courseNodeOf(fixture.courseEarly._id.toHexString()), fixture.courseEarly);
        expect(await api.courseNodeOf(fixture.rootId)).to.equal(null);
        expect(await api.courseNodeOf(fixture.rootId.toHexString())).to.equal(null);
    });

    it('rejects course node settings without system privilege or with a stale version', async () => {
        const api = courseApi();
        const teacher = actor(7, false);
        const admin = actor(424242, true);
        const teacherBefore = snapshot(fixture.courseEarly);
        const denied = await rejected(() =>
            api.setCourseNodeSettings({
                actor: teacher,
                nodeId: fixture.courseEarly._id.toHexString(),
                expectedUpdatedAt: new Date(fixture.courseEarly.updatedAt.getTime()),
                visibility: 'public',
                ownerUids: [7, 8],
            }),
        );
        expect(denied.name === 'PrivilegeError' || denied.name === 'PermissionError').to.equal(true);
        expect(snapshot(fixture.courseEarly)).to.deep.equal(teacherBefore);

        const staleBefore = snapshot(fixture.courseLate);
        const conflict = await rejected(() =>
            api.setCourseNodeSettings({
                actor: admin,
                nodeId: fixture.courseLate._id.toHexString(),
                expectedUpdatedAt: new Date(fixture.courseLate.updatedAt.getTime() - 1000),
                visibility: 'hidden',
                ownerUids: [4],
            }),
        );
        expect(conflict.name).to.equal('MindmapConflictError');
        expect(snapshot(fixture.courseLate)).to.deep.equal(staleBefore);
    });

    it('saves course node settings with compare-and-swap and normalized owner uids', async () => {
        const api = courseApi();
        const admin = actor(424242, true);
        const nodeId = fixture.courseLate._id.toHexString();
        const originalUpdatedAt = new Date(fixture.courseLate.updatedAt.getTime());
        const mark = logs.length;
        const saved = await api.setCourseNodeSettings({
            actor: admin,
            nodeId,
            expectedUpdatedAt: originalUpdatedAt,
            visibility: 'hidden',
            ownerUids: [3, 1, 1, 2],
        });
        expect(saved.id).to.equal(nodeId);
        expect(saved.title).to.equal(fixture.courseLate.topic);
        expect(saved.order).to.equal(fixture.courseLate.order);
        expect(saved.visibility).to.equal('hidden');
        expect(saved.ownerUids).to.deep.equal([1, 2, 3]);
        expect(fixture.courseLate.courseVisibility).to.equal('hidden');
        expect(fixture.courseLate.ownerUids).to.deep.equal([1, 2, 3]);
        const fresh = logs.slice(mark).filter((entry) => entry.level === 'info');
        const raw = JSON.stringify(fresh.map((entry) => entry.args));
        const scrubbed = JSON.stringify(scrubIds(fresh.map((entry) => entry.args)));
        expect(fresh.length > 0).to.equal(true);
        expect(raw.includes(nodeId)).to.equal(true);
        expect(scrubbed.includes(String(admin._id))).to.equal(true);
        expect(scrubbed.includes('hidden')).to.equal(true);
        const conflict = await rejected(() =>
            api.setCourseNodeSettings({
                actor: admin,
                nodeId,
                expectedUpdatedAt: originalUpdatedAt,
                visibility: 'public',
                ownerUids: [5],
            }),
        );
        expect(conflict.name).to.equal('MindmapConflictError');
        expect(fixture.courseLate.ownerUids).to.deep.equal([1, 2, 3]);
        expect(fixture.courseLate.courseVisibility).to.equal('hidden');

        const owners = Array.from({ length: 50 }, (_value, index) => 50 - index);
        const capped = await api.setCourseNodeSettings({
            actor: admin,
            nodeId: fixture.tieLow._id.toHexString(),
            expectedUpdatedAt: new Date(fixture.tieLow.updatedAt.getTime()),
            visibility: 'public',
            ownerUids: owners,
        });
        expect(capped.ownerUids).to.deep.equal(Array.from({ length: 50 }, (_value, index) => index + 1));
        expect(fixture.tieLow.ownerUids).to.deep.equal(capped.ownerUids);

        const cleared = await api.setCourseNodeSettings({
            actor: admin,
            nodeId: fixture.courseEarly._id.toHexString(),
            expectedUpdatedAt: new Date(fixture.courseEarly.updatedAt.getTime()),
            visibility: 'hidden',
            ownerUids: [],
        });
        expect(cleared.ownerUids).to.deep.equal([]);
        expect(fixture.courseEarly.ownerUids).to.deep.equal([]);
        expect(fixture.courseEarly.courseVisibility).to.equal('hidden');
    });

    it('rejects settings on a non-course node or with invalid owner uids', async () => {
        const api = courseApi();
        const admin = actor(1, true);
        const courseLate = fixture.courseLate;
        const nodeId = courseLate._id.toHexString();
        const expectedUpdatedAt = new Date(courseLate.updatedAt.getTime());
        const invalidCases: Array<{ ownerUids: number[]; message: string }> = [
            { ownerUids: [1, 0], message: '负责教师必须是正整数' },
            { ownerUids: [-3], message: '负责教师必须是正整数' },
            { ownerUids: [1.5], message: '负责教师必须是正整数' },
            { ownerUids: Array.from({ length: 51 }, (_value, index) => index + 1), message: '负责教师最多 50 人' },
        ];
        for (const entry of invalidCases) {
            const before = snapshot(courseLate);
            const error = await rejected(() =>
                api.setCourseNodeSettings({
                    actor: admin,
                    nodeId,
                    expectedUpdatedAt,
                    visibility: 'hidden',
                    ownerUids: entry.ownerUids,
                }),
            );
            expect(error.name, entry.message).to.equal('MindmapRequestError');
            expect(error.message, entry.message).to.equal(entry.message);
            expect(snapshot(courseLate)).to.deep.equal(before);
        }
        const grandchildBefore = snapshot(fixture.grandchild);
        const grandchildError = await rejected(() =>
            api.setCourseNodeSettings({
                actor: admin,
                nodeId: fixture.grandchild._id.toHexString(),
                expectedUpdatedAt: new Date(fixture.grandchild.updatedAt.getTime()),
                visibility: 'hidden',
                ownerUids: [1],
            }),
        );
        expect(grandchildError.name).to.equal('MindmapRequestError');
        expect(grandchildError.message).to.equal('只能修改课程节点');
        expect(snapshot(fixture.grandchild)).to.deep.equal(grandchildBefore);
        expect(fixture.grandchild.courseVisibility).to.equal(undefined);
    });

    it('hides a hidden course node from anonymous viewers and shows it to a responsible teacher', () => {
        const api = courseApi();
        const hidden = courseView(fixture.courseEarly);
        const visible = courseView(fixture.courseLate);
        const teacher = actor(7, false);
        const stranger = actor(8, false);
        const admin = actor(1, true);
        expect(api.canSeeCourseNode(null, hidden)).to.equal(false);
        expect(api.canSeeCourseNode(teacher, hidden)).to.equal(true);
        expect(api.canSeeCourseNode(stranger, hidden)).to.equal(false);
        expect(api.canSeeCourseNode(admin, hidden)).to.equal(true);
        expect(api.canSeeCourseNode(null, visible)).to.equal(true);
        expect(api.canEditCourseSubtree(teacher, hidden)).to.equal(true);
        expect(api.canEditCourseSubtree(teacher, visible)).to.equal(false);
        expect(api.canEditCourseSubtree(stranger, hidden)).to.equal(false);
        expect(api.canEditCourseSubtree(admin, visible)).to.equal(true);
    });
});
