import { localizedErrorText } from '@hydrooj/framework';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';

const Module = require('node:module') as {
    _load: (this: unknown, request: string, parent: NodeJS.Module | null, isMain: boolean) => unknown;
};
const originalLoad = Module._load;

interface MindmapMapFixture {
    _id: ObjectId;
    title: string;
    rootNodeId: ObjectId;
    visibility: 'public' | 'hidden';
}

interface MindmapNodeFixture {
    _id: ObjectId;
    mapId: ObjectId;
    parentId: ObjectId | null;
    topic: string;
    tags: string[];
    courseVisibility?: 'public' | 'hidden';
}

interface KnowledgeOption {
    id: string;
    mapId: string;
    mapTitle: string;
    label: string;
    tags: string[];
}

interface CompletionRow {
    id: string;
    title: string;
    count: number;
    href?: string;
}

interface UserDetail {
    user: { _id: number; hasPerm: (perm: bigint) => boolean };
    response: { body: { knowledgeNodeCompletions?: CompletionRow[] }; template?: string };
    UiContext: { extraTitleContent?: string };
    get(domainId: string, uid: number): Promise<void>;
}

const PERM = {
    PERM_VIEW_PROBLEM: 1n,
    PERM_VIEW_TRAINING: 2n,
    PERM_VIEW_PROBLEM_SOLUTION: 4n,
    PERM_VIEW_USER_PRIVATE_INFO: 8n,
};

const mergedMapId = new ObjectId('64c700000000000000000001');
const mergedRootId = new ObjectId('64c700000000000000000010');
const basicCourseId = new ObjectId('64c700000000000000000011');
const arrayNodeId = new ObjectId('64c700000000000000000012');
const vectorNodeId = new ObjectId('64c700000000000000000013');
const blankNodeId = new ObjectId('64c700000000000000000014');
const osCourseId = new ObjectId('64c700000000000000000015');
const processNodeId = new ObjectId('64c700000000000000000016');
const hiddenCourseId = new ObjectId('64c700000000000000000017');
const classNodeId = new ObjectId('64c700000000000000000018');
const blankHiddenId = new ObjectId('64c700000000000000000019');

const profileMapId = new ObjectId('64c710000000000000000001');
const profileRootId = new ObjectId('64c710000000000000000010');
const profileOsCourseId = new ObjectId('64c710000000000000000011');
const profileChapterId = new ObjectId('64c710000000000000000012');
const profileProcessId = new ObjectId('64c710000000000000000013');
const profileAlgoCourseId = new ObjectId('64c710000000000000000014');
const profileGraphId = new ObjectId('64c710000000000000000015');
const profileHiddenCourseId = new ObjectId('64c710000000000000000016');

let mindmapMaps: MindmapMapFixture[] = [];
let mindmapNodes: MindmapNodeFixture[] = [];
let profileProblems: Array<{
    docId: number;
    tag: string[];
    knowledgeNodeIds: string[];
    knowledgeMapId: string;
}> = [];

class TestValidationError extends Error {
    name = 'ValidationError';
}

class TestMetadataConflictError extends Error {
    name = 'ManagedProblemMetadataConflictError';
}

function isQueryOperator(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || value instanceof ObjectId || Array.isArray(value)) return false;
    return Object.keys(value).some((key) => key.startsWith('$'));
}

function matchesValue(actual: unknown, expected: unknown): boolean {
    if (isQueryOperator(expected)) {
        if ('$eq' in expected) return matchesValue(actual, expected.$eq);
        if ('$ne' in expected) return !matchesValue(actual, expected.$ne);
        if ('$in' in expected) {
            const list = expected.$in;
            return Array.isArray(list) && list.some((item) => matchesValue(actual, item));
        }
        if ('$nin' in expected) {
            const list = expected.$nin;
            return Array.isArray(list) && list.every((item) => !matchesValue(actual, item));
        }
        if ('$exists' in expected) {
            const exists = actual !== undefined && actual !== null;
            return exists === Boolean(expected.$exists);
        }
        return false;
    }
    if (actual instanceof ObjectId && expected instanceof ObjectId) return actual.equals(expected);
    if (actual instanceof ObjectId && typeof expected === 'string') return actual.toHexString() === expected;
    if (expected instanceof ObjectId && typeof actual === 'string') return expected.toHexString() === actual;
    return actual === expected;
}

function matchesDocument(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    if (Array.isArray(filter.$and)) {
        return filter.$and.every((part) => matchesDocument(doc, part as Record<string, unknown>));
    }
    if (Array.isArray(filter.$or)) {
        return filter.$or.some((part) => matchesDocument(doc, part as Record<string, unknown>));
    }
    for (const [key, expected] of Object.entries(filter)) {
        if (key.startsWith('$')) continue;
        if (!matchesValue(doc[key], expected)) return false;
    }
    return true;
}

interface FindCursor {
    sort: () => FindCursor;
    limit: (value: number) => FindCursor;
    project: () => FindCursor;
    toArray: () => Promise<Array<Record<string, unknown>>>;
}

function cursorOf(docs: readonly object[], filter: Record<string, unknown>): FindCursor {
    let limit = Number.POSITIVE_INFINITY;
    const cursor: FindCursor = {
        sort() {
            return cursor;
        },
        limit(value: number) {
            limit = value;
            return cursor;
        },
        project() {
            return cursor;
        },
        async toArray() {
            return docs
                .filter((doc) => matchesDocument(doc as Record<string, unknown>, filter))
                .slice(0, limit)
                .map((doc) => {
                    const record: Record<string, unknown> = { ...(doc as Record<string, unknown>) };
                    if (Array.isArray(record.tags)) record.tags = [...record.tags];
                    return record;
                });
        },
    };
    return cursor;
}

function collectionStub(name: string) {
    if (name === 'mindmap.nodes') {
        return { find: (filter: Record<string, unknown> = {}) => cursorOf(mindmapNodes, filter) };
    }
    if (name === 'mindmap.maps') {
        return { find: (filter: Record<string, unknown> = {}) => cursorOf(mindmapMaps, filter) };
    }
    return { find: () => cursorOf([], {}) };
}

const errorExports = {
    __esModule: true,
    localizedErrorText,
    ManagedProblemMetadataConflictError: TestMetadataConflictError,
    ValidationError: TestValidationError,
};
const errorModule = new Proxy(errorExports, {
    get(target, prop, receiver) {
        if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
        return TestValidationError;
    },
});

const dbPath = require.resolve('../src/service/db.ts');
const documentPath = require.resolve('../src/model/document.ts');
const errorPath = require.resolve('../src/error.ts');
const authoringPath = require.resolve('../src/model/managed-problem-authoring.ts');
const userPath = require.resolve('../src/handler/user.ts');

require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { __esModule: true, default: { collection: collectionStub } },
} as NodeJS.Module;
require.cache[errorPath] = {
    id: errorPath,
    filename: errorPath,
    loaded: true,
    exports: errorModule,
} as NodeJS.Module;
require.cache[documentPath] = {
    id: documentPath,
    filename: documentPath,
    loaded: true,
    exports: {
        __esModule: true,
        TYPE_PROBLEM: 10,
        TYPE_TRAINING: 40,
        coll: {
            find: () => cursorOf([], {}),
            async distinct() {
                return [];
            },
            async countDocuments() {
                return 0;
            },
            async findOne() {
                return null;
            },
        },
    },
} as NodeJS.Module;
delete require.cache[authoringPath];

const authoring = require(authoringPath) as typeof import('../src/model/managed-problem-authoring');

interface MindmapTestHooks {
    materialize?: (
        mapId: unknown,
        nodeIds: unknown,
        options?: unknown,
    ) => Promise<{ mapId: unknown; mapTitle: string; nodeIds: unknown[]; nodePaths: unknown[]; tags: string[] }>;
    listPublicMaps?: () => Promise<unknown[]>;
    getPublicSnapshot?: (id: unknown) => Promise<{ config: object; nodes: object[] } | null>;
}

function mindmapModel(): { mindmap?: MindmapTestHooks } {
    const holder = globalThis as unknown as { Hydro?: { model?: { mindmap?: MindmapTestHooks } } };
    const root = holder.Hydro || { model: {} };
    holder.Hydro = root;
    const model = root.model || {};
    root.model = model;
    return model;
}

function decorator() {
    return (_target: object, _key: string, descriptor: PropertyDescriptor) => descriptor;
}

function inertModule(): unknown {
    const fn = function inert() {
        return inertModule();
    };
    return new Proxy(fn, {
        get(_target, prop) {
            if (prop === '__esModule') return true;
            if (prop === 'then') return undefined;
            return inertModule();
        },
        apply() {
            return inertModule();
        },
    });
}

const problemModel = {
    PROJECTION_LIST: [] as string[],
    getMultiStatus() {
        return {
            async toArray() {
                return profileProblems.map((problem) => ({ docId: problem.docId }));
            },
        };
    },
    async getListViewableAuthorized() {
        const listed: Record<string, (typeof profileProblems)[number]> = {};
        for (const problem of profileProblems) listed[String(problem.docId)] = problem;
        return listed;
    },
};

const userModel = {
    async getById(_domainId: string, uid: number) {
        return { _id: uid, uname: 'student' };
    },
    deleteUserCache() {
        return undefined;
    },
};

let DetailHandler: (new () => UserDetail) | undefined;

Module._load = function load(request, parent, isMain) {
    if (parent?.filename === userPath) {
        if (request === '../lib/user-profile-progress') return originalLoad.call(this, request, parent, isMain);
        if (request === '../service/server') {
            return {
                Handler: class Handler {},
                param: decorator,
                post: decorator,
                Query: () => ({}),
                Types: new Proxy({}, { get: () => () => ({}) }),
            };
        }
        if (request === '../model/builtin') {
            return {
                PERM,
                PRIV: { PRIV_USER_PROFILE: 1, PRIV_EDIT_SYSTEM: 2, PRIV_REGISTER_USER: 4 },
                STATUS: { STATUS_ACCEPTED: 1 },
            };
        }
        if (request === '../model/problem') return problemModel;
        if (request === '../model/user') return userModel;
        if (request === '../model/token') return { async getMostRecentSessionByUid() { return null; } };
        if (request === '../model/system') return { get: () => false };
        if (request === '../model/contest') {
            return {
                getMultiStatus() {
                    return { project: () => ({ async toArray() { return []; } }) };
                },
                getMulti() {
                    return { project: () => ({ sort: () => ({ async toArray() { return []; } }) }) };
                },
            };
        }
        if (request === '../model/record') return { coll: { aggregate: () => ({ async toArray() { return []; } }) } };
        if (request.startsWith('.')) return inertModule();
    }
    return originalLoad.call(this, request, parent, isMain);
};

try {
    delete require.cache[userPath];
    const userHandlers = require(userPath) as {
        apply: (ctx: {
            Route: (name: string, path: string, HandlerClass: new () => UserDetail, priv?: number) => void;
            oauth: { provide: () => void };
            inject: () => Promise<void>;
        }) => Promise<void>;
    };
    userHandlers.apply({
        Route(name, _path, HandlerClass) {
            if (name === 'user_detail') DetailHandler = HandlerClass;
        },
        oauth: { provide() { return undefined; } },
        async inject() {
            return undefined;
        },
    });
} finally {
    Module._load = originalLoad;
}

function optionById(options: KnowledgeOption[], id: ObjectId) {
    return options.find((option) => option.id === id.toHexString());
}

function listOptions(includeHidden: boolean) {
    return authoring.listKnowledgeMindmapOptions({ includeHidden }) as Promise<KnowledgeOption[]>;
}

function mergedTree(): MindmapNodeFixture[] {
    return [
        { _id: mergedRootId, mapId: mergedMapId, parentId: null, topic: '知识图谱', tags: ['总根'] },
        {
            _id: basicCourseId,
            mapId: mergedMapId,
            parentId: mergedRootId,
            topic: '程序设计基础(I)',
            tags: ['基础'],
            courseVisibility: 'public',
        },
        { _id: arrayNodeId, mapId: mergedMapId, parentId: basicCourseId, topic: '六、数组', tags: ['数组'] },
        { _id: vectorNodeId, mapId: mergedMapId, parentId: arrayNodeId, topic: '一维数组', tags: ['一维数组'] },
        { _id: blankNodeId, mapId: mergedMapId, parentId: basicCourseId, topic: '无标签', tags: [] },
        {
            _id: osCourseId,
            mapId: mergedMapId,
            parentId: mergedRootId,
            topic: '操作系统',
            tags: [],
            courseVisibility: 'public',
        },
        { _id: processNodeId, mapId: mergedMapId, parentId: osCourseId, topic: '进程', tags: ['进程'] },
        {
            _id: hiddenCourseId,
            mapId: mergedMapId,
            parentId: mergedRootId,
            topic: '面向对象程序设计',
            tags: ['面向对象'],
            courseVisibility: 'hidden',
        },
        { _id: classNodeId, mapId: mergedMapId, parentId: hiddenCourseId, topic: '类与对象', tags: ['类'] },
        { _id: blankHiddenId, mapId: mergedMapId, parentId: hiddenCourseId, topic: '无标签隐藏', tags: [] },
    ];
}

describe('merged knowledge options', () => {
    beforeEach(() => {
        mindmapMaps = [{ _id: mergedMapId, title: '知识图谱', rootNodeId: mergedRootId, visibility: 'public' }];
        mindmapNodes = mergedTree();
    });

    it('labels a node from its course and does not start with the merged root', async () => {
        const options = await listOptions(true);
        expect(optionById(options, vectorNodeId)?.label).to.equal('程序设计基础(I) / 六、数组 / 一维数组');
        expect(optionById(options, processNodeId)?.label).to.equal('操作系统 / 进程');
        expect(optionById(options, basicCourseId)?.label).to.equal('程序设计基础(I)');
        for (const option of options) expect(option.label.startsWith('知识图谱')).to.equal(false);
        expect(options.some((option) => option.id === mergedRootId.toHexString())).to.equal(false);
        expect(options.every((option) => option.mapId === mergedMapId.toHexString())).to.equal(true);
    });

    it('keeps a tagged course node and drops untagged nodes', async () => {
        const options = await listOptions(true);
        expect(optionById(options, basicCourseId)?.label).to.equal('程序设计基础(I)');
        expect(options.some((option) => option.id === osCourseId.toHexString())).to.equal(false);
        expect(options.some((option) => option.id === blankNodeId.toHexString())).to.equal(false);
        expect(options.some((option) => option.id === blankHiddenId.toHexString())).to.equal(false);
        expect(options.some((option) => option.id === mergedRootId.toHexString())).to.equal(false);
    });

    it('drops a hidden course subtree unless includeHidden is true', async () => {
        const opened = await listOptions(true);
        const closed = await listOptions(false);
        const openedIds = opened.map((option) => option.id);
        const closedIds = closed.map((option) => option.id);
        expect(openedIds.includes(classNodeId.toHexString())).to.equal(true);
        expect(openedIds.includes(hiddenCourseId.toHexString())).to.equal(true);
        expect(closedIds.includes(classNodeId.toHexString())).to.equal(false);
        expect(closedIds.includes(hiddenCourseId.toHexString())).to.equal(false);
        expect(closedIds.includes(vectorNodeId.toHexString())).to.equal(true);
        expect(optionById(opened, classNodeId)?.label).to.equal('面向对象程序设计 / 类与对象');
    });

    it('resolves allowSolePublicMap to the single public map', async () => {
        mindmapModel().mindmap = {
            async materialize(mapId: unknown) {
                return { mapId, mapTitle: '知识图谱', nodeIds: [], nodePaths: [], tags: [] };
            },
        };
        const result = await authoring.materializeKnowledgeMindmapTags([], { allowSolePublicMap: true, required: false });
        expect(result.mapId.equals(mergedMapId)).to.equal(true);
    });
});

describe('profile knowledge progress', () => {
    it('links each public node to its course and omits the root and hidden course nodes', async () => {
        expect(DetailHandler === undefined).to.equal(false);
        const Detail = DetailHandler as new () => UserDetail;
        const map = { _id: profileMapId, title: '知识图谱', rootNodeId: profileRootId, visibility: 'public' as const };
        profileProblems = [
            { docId: 11, tag: [], knowledgeNodeIds: [profileProcessId.toHexString()], knowledgeMapId: profileMapId.toHexString() },
            { docId: 12, tag: [], knowledgeNodeIds: [profileGraphId.toHexString()], knowledgeMapId: profileMapId.toHexString() },
            { docId: 13, tag: [], knowledgeNodeIds: [profileHiddenCourseId.toHexString()], knowledgeMapId: profileMapId.toHexString() },
            { docId: 14, tag: [], knowledgeNodeIds: [profileRootId.toHexString()], knowledgeMapId: profileMapId.toHexString() },
        ];
        mindmapModel().mindmap = {
            async listPublicMaps() {
                return [map];
            },
            async getPublicSnapshot() {
                return {
                    config: map,
                    nodes: [
                        { _id: profileRootId, parentId: null, topic: '知识图谱' },
                        { _id: profileOsCourseId, parentId: profileRootId, topic: '操作系统', courseVisibility: 'public' },
                        { _id: profileChapterId, parentId: profileOsCourseId, topic: '进程管理' },
                        { _id: profileProcessId, parentId: profileChapterId, topic: '进程' },
                        { _id: profileAlgoCourseId, parentId: profileRootId, topic: '算法', courseVisibility: 'public' },
                        { _id: profileGraphId, parentId: profileAlgoCourseId, topic: '图论' },
                        { _id: profileHiddenCourseId, parentId: profileRootId, topic: '面向对象程序设计', courseVisibility: 'hidden' },
                    ],
                };
            },
        };
        const handler = new Detail();
        handler.user = { _id: 7, hasPerm: (perm) => perm === PERM.PERM_VIEW_PROBLEM };
        handler.response = { body: {} };
        handler.UiContext = {};
        await handler.get('system', 7);
        const rows = handler.response.body.knowledgeNodeCompletions || [];
        const byId = new Map(rows.map((row) => [row.id, row]));
        expect(byId.get(profileProcessId.toHexString())?.href).to.equal(`/mindmap?course=${profileOsCourseId.toHexString()}`);
        expect(byId.get(profileGraphId.toHexString())?.href).to.equal(`/mindmap?course=${profileAlgoCourseId.toHexString()}`);
        expect(byId.has(profileHiddenCourseId.toHexString())).to.equal(false);
        expect(byId.has(profileRootId.toHexString())).to.equal(false);
    });
});
