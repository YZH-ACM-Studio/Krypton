import { expect } from 'chai';
import { InvalidOperationError } from '@hydrooj/framework';
import { ObjectId } from 'mongodb';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module') as {
    _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
    _resolveFilename: (request: string, parent: NodeModule, isMain: boolean) => string;
};

const hydroGlobal = global as unknown as { Hydro?: { model: Record<string, unknown>; module?: Record<string, unknown> } };
if (!hydroGlobal.Hydro) hydroGlobal.Hydro = { model: {}, module: {} };

const { PERM, PRIV } = require('../src/model/builtin') as typeof import('../src/model/builtin');
const { InMemoryStudentDirectory } = require('../src/lib/testing/in-memory-student-directory') as typeof import('../src/lib/testing/in-memory-student-directory');
const { registerStudentDirectory } = require('../src/service/student-directory') as typeof import('../src/service/student-directory');

registerStudentDirectory(new InMemoryStudentDirectory());

const MERGED_MAP = '64b0000000000000000000aa';
const MERGED_ROOT = '64b000000000000000000030';
const COURSE_NODE = '64b000000000000000000031';
const OTHER_COURSE = '64b000000000000000000032';
const NODE_ARRAY = '64b000000000000000000041';
const NODE_LOOP = '64b000000000000000000042';
const NODE_WHILE = '64b000000000000000000043';
const NODE_OTHER = '64b000000000000000000044';
const PUBLIC_MAP = '64b000000000000000000001';
const NOW = new Date('2026-07-20T12:00:00.000Z');

interface CourseNodeFixture {
    id: string;
    title: string;
    order: number;
    visibility: 'public' | 'hidden';
    ownerUids: number[];
}

interface SubtreeNodeFixture {
    id: string;
    courseId: string;
    parentId: string;
    title: string;
    order: number;
    problemIds: string[];
    description?: string;
}

interface CourseNodeView {
    id: string;
    title: string;
    order: number;
    visibility: 'public' | 'hidden';
    ownerUids: number[];
}

interface TeachNode {
    id: string;
    parentId: string | null;
    title: string;
    order: number;
    pinnedDocIds: number[];
    description?: string;
}

interface ProblemFixture {
    domainId: string;
    docId: number;
    pid: string;
    owner: number;
    title: string;
    hidden: boolean;
    knowledgeNodeIds?: ObjectId[];
    managedAuthoring?: { selectedMindmapNodeIds: ObjectId[] };
}

interface ChapterFixture {
    _id: number;
    title: string;
    requireNids: number[];
    pids: number[];
    tids: ObjectId[];
    problemSetId?: ObjectId;
    content?: string;
    sourceMindmapNodeId?: string;
    sourceMindmapBody?: string;
    sections?: Array<{ _id: number; title: string; pids: number[] }>;
}

interface CourseFixture {
    domainId: string;
    docId: ObjectId;
    owner: number;
    kind: 'course';
    title: string;
    content: string;
    description: string;
    courseGroupIds: ObjectId[];
    dag: ChapterFixture[];
    knowledgeCourseNodeId?: ObjectId;
    mindmapId?: ObjectId;
}

interface SavedCall {
    set: Record<string, unknown>;
    unset: Record<string, unknown>;
}

interface MindmapActor {
    _id: number;
    hasPriv: (...privileges: number[]) => boolean;
}

interface CourseHandler {
    tdoc?: CourseFixture;
    response: { body: Record<string, unknown>; redirect?: string; template?: string };
    url: (name: string, args?: Record<string, unknown>) => string;
    post: (...args: unknown[]) => Promise<unknown>;
    postCopy: (domainId: string, tid: ObjectId) => Promise<unknown>;
    postDelete: (domainId: string, tid: ObjectId) => Promise<unknown>;
    postGenerateChapters: (domainId: string, tid: ObjectId) => Promise<unknown>;
    get: (...args: unknown[]) => Promise<unknown>;
    prepare: (domainId: string, tid: ObjectId) => Promise<unknown>;
}

let courseNodeRows: CourseNodeFixture[] = [];
let subtreeRows: SubtreeNodeFixture[] = [];
let publicMaps: Array<Record<string, unknown>> = [];
let ownedMap: Record<string, unknown> | null = null;
const problemDocs = new Map<number, ProblemFixture>();
let trainingRows: Array<Record<string, unknown>> = [];
let currentCourse: CourseFixture | null = null;
const savedEdits: SavedCall[] = [];
const savedAdds: unknown[][] = [];
const mindmapDeletes: string[] = [];

function courseView(node: CourseNodeFixture): CourseNodeView {
    return {
        id: node.id,
        title: node.title,
        order: node.order,
        visibility: node.visibility,
        ownerUids: [...node.ownerUids],
    };
}

function compareCourseNodes(left: CourseNodeFixture, right: CourseNodeFixture): number {
    if (left.order !== right.order) return left.order - right.order;
    if (left.id === right.id) return 0;
    return left.id < right.id ? -1 : 1;
}

function canEditCourseSubtree(actor: MindmapActor, course: { ownerUids: number[] }): boolean {
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || course.ownerUids.includes(actor._id);
}

async function listCourseNodes(): Promise<CourseNodeView[]> {
    return courseNodeRows.slice().sort(compareCourseNodes).map(courseView);
}

async function courseNodeOf(nodeId: unknown): Promise<CourseNodeView | null> {
    const id = nodeId instanceof ObjectId ? nodeId.toHexString() : String(nodeId || '');
    if (!id || id === MERGED_ROOT) return null;
    const course = courseNodeRows.find((node) => node.id === id);
    if (course) return courseView(course);
    const child = subtreeRows.find((node) => node.id === id);
    if (!child) return null;
    const owner = courseNodeRows.find((node) => node.id === child.courseId);
    return owner ? courseView(owner) : null;
}

async function listTeachKnowledgeSources(): Promise<Array<Record<string, unknown>>> {
    return courseNodeRows.slice().sort(compareCourseNodes).map((course) => {
        const nodes: TeachNode[] = subtreeRows
            .filter((node) => node.courseId === course.id)
            .map((node) => ({
                id: node.id,
                parentId: node.parentId === course.id ? null : node.parentId,
                title: node.title,
                order: node.order,
                pinnedDocIds: node.problemIds.map((value) => Number(value)),
                ...(node.description ? { description: node.description } : {}),
            }));
        return {
            courseId: course.id,
            title: course.title,
            hidden: course.visibility === 'hidden',
            mapId: MERGED_MAP,
            rootNodeId: course.id,
            nodes,
        };
    });
}

async function getMergedMap(): Promise<Record<string, unknown>> {
    return {
        _id: MERGED_MAP,
        title: '知识图谱',
        rootNodeId: MERGED_ROOT,
        visibility: 'public',
        layoutDirection: 'RIGHT',
        createdAt: NOW,
        updatedAt: NOW,
    };
}

const mindmapStub = {
    async getPublicMap(id: unknown) {
        return publicMaps.find((map) => String(map._id) === String(id)) || null;
    },
    async getPublicSnapshot(id: unknown) {
        void id;
        return null;
    },
    async listPublicMaps() {
        return publicMaps;
    },
    async getCourseOwnedMap() {
        return ownedMap;
    },
    async getCourseOwnedSnapshot() {
        return null;
    },
    async createCourseOwnedMap() {
        return null;
    },
    async updateCourseOwnedMap() {
        return null;
    },
    async deleteCourseOwnedMap() {
        mindmapDeletes.push('delete');
        const removed = ownedMap;
        ownedMap = null;
        return removed;
    },
    async createCourseOwnedNode() {
        return null;
    },
    async updateCourseOwnedNode() {
        return null;
    },
    async moveCourseOwnedNode() {
        return null;
    },
    async deleteCourseOwnedNode() {
        return null;
    },
    listCourseNodes,
    courseNodeOf,
    canEditCourseSubtree,
    getMergedMap,
    listTeachKnowledgeSources,
};

hydroGlobal.Hydro.model.mindmap = mindmapStub;

function getPids(dag: Array<{ pids?: number[]; sections?: Array<{ pids?: number[] }> }> = []): number[] {
    const ids: number[] = [];
    for (const node of dag) {
        ids.push(...(node.pids || []));
        for (const section of node.sections || []) ids.push(...(section.pids || []));
    }
    return Array.from(new Set(ids));
}

function problemDict(docs: ProblemFixture[]): Record<number, ProblemFixture> {
    return Object.fromEntries(docs.map((doc) => [doc.docId, doc]));
}

const problemStub = {
    PROJECTION_LIST: ['domainId', 'docId', 'pid', 'title', 'hidden', 'owner'],
    assertProblemAclDomain(user: { _problemAclLoaded?: boolean; _problemAclDomainId?: string }, domainId: string) {
        if (!user._problemAclLoaded || user._problemAclDomainId !== domainId) {
            const error = new Error('permission');
            error.name = 'PermissionError';
            throw error;
        }
    },
    canViewBy(pdoc: ProblemFixture, user: { _id: number; hasPerm: (perm: bigint) => boolean; _problemAclLoaded?: boolean; _problemAclDomainId?: string }) {
        if (!user._problemAclLoaded || user._problemAclDomainId !== pdoc.domainId) return false;
        if (!user.hasPerm(PERM.PERM_VIEW_PROBLEM)) return false;
        return !pdoc.hidden || pdoc.owner === user._id;
    },
    async getListViewableAuthorized(_domainId: string, pids: number[], user: { _id: number; hasPerm: (perm: bigint) => boolean; _problemAclLoaded?: boolean; _problemAclDomainId?: string }) {
        return problemDict(pids.map((pid) => problemDocs.get(pid)).filter((doc): doc is ProblemFixture => !!doc && this.canViewBy(doc, user)));
    },
    getMulti() {
        const value = {
            async toArray() {
                return [];
            },
        };
        return value;
    },
};

const trainingStub = {
    getPids,
    async get(_domainId: string, tid: unknown) {
        const listed = trainingRows.find((row) => String(row.docId) === String(tid));
        if (listed) return listed;
        return currentCourse;
    },
    async add(...args: unknown[]) {
        savedAdds.push(args);
        return new ObjectId();
    },
    async edit(_domainId: string, tid: unknown, set: Record<string, unknown> = {}, unset: Record<string, unknown> = {}) {
        savedEdits.push({ set, unset });
        if (currentCourse && String(currentCourse.docId) === String(tid)) {
            if (Object.hasOwn(set, 'dag')) currentCourse.dag = set.dag as ChapterFixture[];
            if (Object.hasOwn(set, 'knowledgeCourseNodeId')) currentCourse.knowledgeCourseNodeId = set.knowledgeCourseNodeId as ObjectId;
            if (unset.knowledgeCourseNodeId) delete currentCourse.knowledgeCourseNodeId;
        }
    },
    async del() {
        return undefined;
    },
    async getStatus() {
        return null;
    },
    async casCourseMindmap() {
        return true;
    },
    async casCourseKnowledgeNode() {
        return false;
    },
};

const practiceIntegrityStub = {
    practiceIntegrityService: {
        async getLatestPublished() {
            return null;
        },
    },
};

const userStub = {
    async getById() {
        return { _id: 42, uname: 'owner' };
    },
    async getList() {
        return {};
    },
};

function noopDecorator() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}

class HandlerStub {}

const serverStub = {
    Handler: HandlerStub,
    param: noopDecorator,
    post: noopDecorator,
    Types: new Proxy({}, { get: () => () => ({}) }),
};

const problemSetAccessStub = {
    canManageProblemSet() {
        return false;
    },
    problemSetAccessService: {
        async hasActiveEntitlement() {
            return false;
        },
        async evaluate() {
            return { accessible: true, stageAccess: 'all' };
        },
        stageIsAccessible() {
            return true;
        },
    },
};

const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    const fromSrc = parent?.filename?.includes('/packages/hydrooj/src/');
    if (typeof request === 'string' && request.includes('krypton-collect')) {
        return {
            async listByCourse() {
                return [];
            },
            async listByCourseChapter() {
                return [];
            },
        };
    }
    if (fromSrc && request === '../model/contest') {
        return {
            async get() {
                return null;
            },
            getMulti() {
                const value = {
                    project() {
                        return value;
                    },
                    async toArray() {
                        return [];
                    },
                };
                return value;
            },
        };
    }
    if (fromSrc && request === '../model/contextual-completion') {
        return { contextualCompletionService: { async getCompletedByScope() {
            return new Map();
        } } };
    }
    if (fromSrc && request === '../model/course-video-progress') {
        return {
            async deleteCourseVideoProgress() {
                return undefined;
            },
            async loadUserCourseProgress() {
                return [];
            },
        };
    }
    if (fromSrc && request === '../model/document') {
        return { TYPE_PROBLEM: 10 };
    }
    if (fromSrc && request === '../model/oplog') {
        return {
            async log() {
                return undefined;
            },
        };
    }
    if (fromSrc && request === '../model/practice-integrity') return practiceIntegrityStub;
    if (fromSrc && request === '../model/problem') return problemStub;
    if (fromSrc && request === '../model/problem-access') {
        return {
            async assertProblemBankSelection() {
                return undefined;
            },
        };
    }
    if (fromSrc && request === '../model/problem-set-access') return problemSetAccessStub;
    if (fromSrc && request === '../model/storage') {
        return {
            async list() {
                return [];
            },
            async del() {
                return undefined;
            },
            async copy() {
                return undefined;
            },
        };
    }
    if (fromSrc && request === '../model/system') return { get: () => 1000 };
    if (fromSrc && request === '../model/training') return trainingStub;
    if (fromSrc && request === '../model/user') return userStub;
    if (fromSrc && request === '../service/server') return serverStub;
    return originalLoad.call(this, request, parent, isMain);
};

const coursePath = require.resolve('../src/handler/course.ts');
delete require.cache[coursePath];
const courseModule = require(coursePath) as {
    apply: (ctx: { Route: (name: string, path: string, HandlerClass: new () => CourseHandler) => void }) => Promise<void> | void;
};
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (typeof request === 'string' && request.includes('krypton-collect')) {
        return {
            async listByCourse() {
                return [];
            },
            async listByCourseChapter() {
                return [];
            },
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

const courseRoutes: Record<string, new () => CourseHandler> = {};
void courseModule.apply({
    Route(name: string, _path: string, HandlerClass: new () => CourseHandler) {
        courseRoutes[name] = HandlerClass;
    },
});

interface TestUser {
    _id: number;
    _problemAclLoaded: true;
    _problemAclDomainId: string;
    hasPerm: (...wanted: bigint[]) => boolean;
    hasPriv: (...wanted: number[]) => boolean;
    own: (doc: { owner?: number }) => boolean;
}

function makeUser(admin = false): TestUser {
    const perms = new Set<bigint>([PERM.PERM_VIEW_PROBLEM, PERM.PERM_CREATE_COURSE, PERM.PERM_EDIT_COURSE]);
    return {
        _id: 42,
        _problemAclLoaded: true,
        _problemAclDomainId: 'system',
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => perms.has(perm)),
        hasPriv: (...wanted: number[]) => wanted.some((priv) => priv === PRIV.PRIV_USER_PROFILE || (admin && priv === PRIV.PRIV_EDIT_SYSTEM)),
        own: (doc) => doc?.owner === 42,
    };
}

function bindUrl(handler: CourseHandler): void {
    handler.url = (name: string, args: Record<string, unknown> = {}) => {
        const query = args.query && typeof args.query === 'object' ? args.query as Record<string, unknown> : null;
        let path = `/url/${name}`;
        if (name === 'mindmap_course_edit') path = `/mindmap/${String(args.nodeId)}/edit`;
        if (name === 'course_edit') path = `/course/${String(args.tid)}/edit`;
        if (!query) return path;
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(query)) params.set(key, String(value));
        return `${path}?${params.toString()}`;
    };
}

function makeHandler(name: string, admin = false): CourseHandler {
    const HandlerClass = courseRoutes[name];
    if (!HandlerClass) throw new Error(`missing route ${name}`);
    const handler = new HandlerClass();
    const user = makeUser(admin);
    Object.assign(handler, {
        domain: { _id: 'system' },
        user,
        args: {},
        request: { body: {}, files: {} },
        response: { body: {} },
        checkPerm() {
            return undefined;
        },
    });
    bindUrl(handler);
    return handler;
}

function chaptersJson(chapters: ChapterFixture[] = [{ _id: 1, title: '第一章', requireNids: [], pids: [], tids: [] }]): string {
    return JSON.stringify(chapters);
}

function makeCourse(overrides: Partial<CourseFixture> = {}): CourseFixture {
    return {
        domainId: 'system',
        docId: new ObjectId(),
        owner: 42,
        kind: 'course',
        title: '数据结构',
        content: '',
        description: '',
        courseGroupIds: [],
        dag: [{ _id: 1, title: '第一章', requireNids: [], pids: [], tids: [] }],
        ...overrides,
    };
}

async function captureFailure(callback: () => Promise<unknown>): Promise<Error | null> {
    try {
        await callback();
        return null;
    } catch (error) {
        return error as Error;
    }
}

function errorText(error: Error): string {
    const params = (error as Error & { params?: unknown[] }).params;
    const last = Array.isArray(params) ? params[params.length - 1] : undefined;
    return `${error.message} ${last === undefined ? '' : String(last)}`;
}

function operationMethodName(operation: string): string {
    const camel = `_${operation}`.replace(/_([a-z])/g, (_part, letter: string) => letter.toUpperCase());
    return `post${camel}`;
}

function dispatchMissingOperation(handler: CourseHandler, operation: string): void {
    const method = (handler as unknown as Record<string, unknown>)[operationMethodName(operation)];
    if (typeof method !== 'function') throw new InvalidOperationError(operation);
    throw new Error(`operation ${operation} is still implemented`);
}

function lastEdit(): SavedCall {
    const saved = savedEdits.at(-1);
    if (!saved) throw new Error('course was not written');
    return saved;
}

function shownProblemIds(body: Record<string, unknown>): number[] {
    const mindmap = body.courseMindmap;
    if (!mindmap || typeof mindmap !== 'object') return [];
    const problems = (mindmap as { problems?: unknown }).problems;
    if (!Array.isArray(problems)) return [];
    return problems.map((row) => {
        if (!row || typeof row !== 'object' || typeof (row as { docId?: unknown }).docId !== 'number') {
            throw new TypeError('course mindmap problem docId must be a number');
        }
        return (row as { docId: number }).docId;
    });
}

function sorted(ids: number[]): number[] {
    return ids.slice().sort((left, right) => left - right);
}

function problem(docId: number, title: string, extra: Partial<ProblemFixture> = {}): ProblemFixture {
    return {
        domainId: 'system',
        docId,
        pid: `P${docId}`,
        owner: 7,
        title,
        hidden: false,
        ...extra,
    };
}

beforeEach(() => {
    courseNodeRows = [];
    subtreeRows = [];
    publicMaps = [];
    ownedMap = null;
    problemDocs.clear();
    trainingRows = [];
    currentCourse = null;
    savedEdits.length = 0;
    savedAdds.length = 0;
    mindmapDeletes.length = 0;
});

describe('course binds a course node', () => {
    it('exports compare-and-set for the course node binding', () => {
        const source = readFileSync(join(__dirname, '../src/model/training.ts'), 'utf8');
        expect(/export async function casCourseKnowledgeNode\b/.test(source)).to.equal(true);
        expect(/export async function casCourseMindmap\b/.test(source)).to.equal(false);
    });

    it('writes a course node id and rejects an ordinary knowledge node', async () => {
        courseNodeRows = [
            { id: COURSE_NODE, title: '程序设计', order: 1, visibility: 'hidden', ownerUids: [42] },
            { id: OTHER_COURSE, title: '操作系统', order: 0, visibility: 'public', ownerUids: [] },
        ];
        subtreeRows = [
            { id: NODE_ARRAY, courseId: COURSE_NODE, parentId: COURSE_NODE, title: '数组', order: 0, problemIds: [] },
        ];
        const course = makeCourse();
        currentCourse = course;
        const editor = makeHandler('course_edit');
        editor.tdoc = course;
        const written = await captureFailure(() => editor.post('forged-domain', course.docId, '数据结构', '', chaptersJson(), '', '', [], COURSE_NODE));
        expect(written).to.equal(null);
        const saved = lastEdit();
        expect(saved.set.knowledgeCourseNodeId instanceof ObjectId).to.equal(true);
        expect((saved.set.knowledgeCourseNodeId as ObjectId).toHexString()).to.equal(COURSE_NODE);
        expect(Object.hasOwn(saved.set, 'mindmapId')).to.equal(false);

        savedEdits.length = 0;
        const rejected = await captureFailure(() => editor.post(
            'forged-domain',
            course.docId,
            '数据结构',
            '',
            chaptersJson(),
            '',
            '',
            [],
            NODE_ARRAY,
        ));
        expect(rejected?.name).to.equal('ValidationError');
        expect(errorText(rejected || new Error('missing')).includes('只能绑定课程节点')).to.equal(true);
        expect(savedEdits.length).to.equal(0);

        const rootRejected = await captureFailure(() => editor.post(
            'forged-domain',
            course.docId,
            '数据结构',
            '',
            chaptersJson(),
            '',
            '',
            [],
            MERGED_ROOT,
        ));
        expect(rootRejected?.name).to.equal('ValidationError');
        expect(errorText(rootRejected || new Error('missing')).includes('只能绑定课程节点')).to.equal(true);
    });

    it('clears the binding when the saved value is empty', async () => {
        const course = makeCourse({ knowledgeCourseNodeId: new ObjectId(COURSE_NODE) });
        currentCourse = course;
        const editor = makeHandler('course_edit');
        editor.tdoc = course;
        await editor.post('forged-domain', course.docId, '数据结构', '', chaptersJson(), '', '', [], '');
        const saved = lastEdit();
        expect(saved.unset.knowledgeCourseNodeId).to.equal(1);
        expect(Object.hasOwn(saved.set, 'knowledgeCourseNodeId')).to.equal(false);
    });

    it('generates chapters from the bound subtree and rejects an unbound course', async () => {
        courseNodeRows = [
            { id: COURSE_NODE, title: '程序设计', order: 0, visibility: 'hidden', ownerUids: [42] },
        ];
        subtreeRows = [
            { id: NODE_ARRAY, courseId: COURSE_NODE, parentId: COURSE_NODE, title: '数组', order: 0, problemIds: [] },
            { id: NODE_LOOP, courseId: COURSE_NODE, parentId: COURSE_NODE, title: '循环', order: 1, problemIds: [] },
            { id: NODE_WHILE, courseId: COURSE_NODE, parentId: NODE_LOOP, title: 'while', order: 0, problemIds: [] },
        ];
        const unbound = makeCourse();
        currentCourse = unbound;
        const editor = makeHandler('course_edit');
        editor.tdoc = unbound;
        const missing = await captureFailure(() => editor.postGenerateChapters('forged-domain', unbound.docId));
        expect(missing?.name).to.equal('ValidationError');
        expect(errorText(missing || new Error('missing')).includes('先绑定课程节点')).to.equal(true);
        expect(savedEdits.length).to.equal(0);

        const bound = makeCourse({ knowledgeCourseNodeId: new ObjectId(COURSE_NODE) });
        currentCourse = bound;
        editor.tdoc = bound;
        const error = await captureFailure(() => editor.postGenerateChapters('forged-domain', bound.docId));
        expect(error).to.equal(null);
        const dag = lastEdit().set.dag as ChapterFixture[];
        expect(dag.map((chapter) => chapter.title)).to.deep.equal(['数组', '循环']);
        expect(dag[1]?.sections?.map((section) => section.title)).to.deep.equal(['while']);
    });

    it('keeps a chapter body that still matches the node description', async () => {
        const body = '下标从零开始';
        courseNodeRows = [
            { id: COURSE_NODE, title: '程序设计', order: 0, visibility: 'hidden', ownerUids: [42] },
        ];
        subtreeRows = [
            {
                id: NODE_ARRAY,
                courseId: COURSE_NODE,
                parentId: COURSE_NODE,
                title: '数组',
                order: 0,
                problemIds: [],
                description: body,
            },
        ];
        const bound = makeCourse({
            knowledgeCourseNodeId: new ObjectId(COURSE_NODE),
            dag: [{
                _id: 4,
                title: '数组',
                requireNids: [],
                pids: [],
                tids: [],
                content: body,
                sourceMindmapNodeId: NODE_ARRAY,
                sourceMindmapBody: body,
            }],
        });
        currentCourse = bound;
        const editor = makeHandler('course_edit');
        editor.tdoc = bound;
        const error = await captureFailure(() => editor.postGenerateChapters('forged-domain', bound.docId));
        expect(error).to.equal(null);
        const dag = lastEdit().set.dag as ChapterFixture[];
        expect(dag[0]?.content).to.equal(body);
        expect(dag[0]?.sourceMindmapBody).to.equal(body);
    });

    it('generates sibling chapters when an order is fractional', async () => {
        courseNodeRows = [
            { id: COURSE_NODE, title: '程序设计', order: 0, visibility: 'hidden', ownerUids: [42] },
        ];
        subtreeRows = [
            { id: NODE_LOOP, courseId: COURSE_NODE, parentId: COURSE_NODE, title: '循环', order: 0.5, problemIds: [] },
            { id: NODE_ARRAY, courseId: COURSE_NODE, parentId: COURSE_NODE, title: '数组', order: 0, problemIds: [] },
        ];
        const bound = makeCourse({ knowledgeCourseNodeId: new ObjectId(COURSE_NODE) });
        currentCourse = bound;
        const editor = makeHandler('course_edit');
        editor.tdoc = bound;
        const error = await captureFailure(() => editor.postGenerateChapters('forged-domain', bound.docId));
        expect(errorText(error || new Error('missing')).includes('导图结构不完整')).to.equal(false);
        expect(error).to.equal(null);
        const dag = lastEdit().set.dag as ChapterFixture[];
        expect(dag.map((chapter) => chapter.title)).to.deep.equal(['数组', '循环']);
    });

    it('shows chapter problems on the bound subtree and hides another course', async () => {
        courseNodeRows = [
            { id: COURSE_NODE, title: '程序设计', order: 0, visibility: 'hidden', ownerUids: [] },
            { id: OTHER_COURSE, title: '操作系统', order: 1, visibility: 'public', ownerUids: [] },
        ];
        subtreeRows = [
            { id: NODE_ARRAY, courseId: COURSE_NODE, parentId: COURSE_NODE, title: '数组', order: 0, problemIds: ['12'] },
            { id: NODE_OTHER, courseId: OTHER_COURSE, parentId: OTHER_COURSE, title: '进程', order: 0, problemIds: [] },
        ];
        const setId = new ObjectId();
        trainingRows = [{
            domainId: 'system',
            docId: setId,
            kind: 'problem_set',
            dag: [{ _id: 1, title: '阶段', pids: [21] }],
        }];
        problemDocs.set(11, problem(11, '数组题', { knowledgeNodeIds: [new ObjectId(NODE_ARRAY)] }));
        problemDocs.set(12, problem(12, '收录题'));
        problemDocs.set(13, problem(13, '隐藏题', { hidden: true, knowledgeNodeIds: [new ObjectId(NODE_ARRAY)] }));
        problemDocs.set(14, problem(14, '别的课', { knowledgeNodeIds: [new ObjectId(NODE_OTHER)] }));
        problemDocs.set(15, problem(15, '托管知识点', { managedAuthoring: { selectedMindmapNodeIds: [new ObjectId(NODE_ARRAY)] } }));
        problemDocs.set(21, problem(21, '题集题', { knowledgeNodeIds: [new ObjectId(NODE_ARRAY)] }));
        const course = makeCourse({
            knowledgeCourseNodeId: new ObjectId(COURSE_NODE),
            dag: [{
                _id: 1,
                title: '第一章',
                requireNids: [],
                pids: [11, 12, 13, 14, 15],
                tids: [],
                problemSetId: setId,
            }],
        });
        currentCourse = course;
        const detail = makeHandler('course_detail');
        const viewed = await captureFailure(() => detail.get('forged-domain', course.docId, 'mindmap'));
        expect(viewed).to.equal(null);
        expect(sorted(shownProblemIds(detail.response.body))).to.deep.equal([11, 12, 15, 21]);
    });

    it('reports create_mindmap and delete_mindmap as missing operations', () => {
        const editor = makeHandler('course_edit');
        const created = captureSync(() => dispatchMissingOperation(editor, 'create_mindmap'));
        const deleted = captureSync(() => dispatchMissingOperation(editor, 'delete_mindmap'));
        expect(created?.name).to.equal('InvalidOperationError');
        expect(deleted?.name).to.equal('InvalidOperationError');
    });

    it('publishes course nodes and the bound node on the editor', async () => {
        courseNodeRows = [
            { id: OTHER_COURSE, title: '操作系统', order: 2, visibility: 'public', ownerUids: [] },
            { id: COURSE_NODE, title: '程序设计', order: 0, visibility: 'hidden', ownerUids: [42] },
        ];
        const course = makeCourse({ knowledgeCourseNodeId: new ObjectId(COURSE_NODE) });
        currentCourse = course;
        const editor = makeHandler('course_edit');
        editor.tdoc = course;
        await editor.get('forged-domain');
        expect(editor.response.body.courseNodes).to.deep.equal([
            { id: COURSE_NODE, title: '程序设计', visibility: 'hidden', canEdit: true },
            { id: OTHER_COURSE, title: '操作系统', visibility: 'public', canEdit: false },
        ]);
        expect(editor.response.body.boundCourseNode).to.deep.equal({
            id: COURSE_NODE,
            title: '程序设计',
            canEdit: true,
        });
        expect(Object.hasOwn(editor.response.body, 'courseOwnedMindmap')).to.equal(false);

        const admin = makeHandler('course_edit', true);
        admin.tdoc = course;
        await admin.get('forged-domain');
        const nodes = admin.response.body.courseNodes as Array<{ canEdit: boolean }>;
        expect(nodes.every((node) => node.canEdit === true)).to.equal(true);

        const unbound = makeHandler('course_edit');
        unbound.tdoc = makeCourse();
        currentCourse = unbound.tdoc;
        await unbound.get('forged-domain');
        expect(unbound.response.body.boundCourseNode).to.equal(null);
    });

    it('redirects the course mindmap route to the bound course node editor', async () => {
        courseNodeRows = [
            { id: COURSE_NODE, title: '程序设计', order: 0, visibility: 'hidden', ownerUids: [42] },
        ];
        const boundCourse = makeCourse({ knowledgeCourseNodeId: new ObjectId(COURSE_NODE) });
        currentCourse = boundCourse;
        const bound = makeHandler('course_mindmap_edit');
        bound.tdoc = boundCourse;
        const boundError = await captureFailure(() => bound.get());
        expect(boundError).to.equal(null);
        expect(bound.response.redirect).to.equal(`/mindmap/${COURSE_NODE}/edit`);

        const unboundCourse = makeCourse();
        currentCourse = unboundCourse;
        const unbound = makeHandler('course_mindmap_edit');
        unbound.tdoc = unboundCourse;
        const unboundError = await captureFailure(() => unbound.get());
        expect(unboundError).to.equal(null);
        expect(unbound.response.redirect).to.equal(`/course/${unboundCourse.docId.toHexString()}/edit?tab=mindmap`);
    });

    it('does not copy the course node binding', async () => {
        publicMaps = [{
            _id: PUBLIC_MAP,
            title: '算法',
            visibility: 'public',
            rootNodeId: MERGED_ROOT,
            layoutDirection: 'RIGHT',
            createdAt: NOW,
            updatedAt: NOW,
        }];
        const course = makeCourse({
            knowledgeCourseNodeId: new ObjectId(COURSE_NODE),
            mindmapId: new ObjectId(PUBLIC_MAP),
        });
        currentCourse = course;
        const editor = makeHandler('course_edit');
        editor.tdoc = course;
        await editor.postCopy('forged-domain', course.docId);
        const extra = savedAdds.at(-1)?.[7] as Record<string, unknown>;
        expect(extra.knowledgeCourseNodeId).to.equal(undefined);
        expect(extra.mindmapId).to.equal(undefined);
    });

    it('does not delete a mindmap when the course is deleted', async () => {
        ownedMap = {
            _id: new ObjectId(),
            title: '本课导图',
            visibility: 'hidden',
            ownerDomainId: 'system',
            ownerCourseId: new ObjectId(),
            updatedAt: NOW,
        };
        const course = makeCourse({ knowledgeCourseNodeId: new ObjectId(COURSE_NODE) });
        currentCourse = course;
        const editor = makeHandler('course_edit');
        editor.tdoc = course;
        await editor.postDelete('forged-domain', course.docId);
        expect(mindmapDeletes.length).to.equal(0);
    });
});

function captureSync(callback: () => void): Error | null {
    try {
        callback();
        return null;
    } catch (error) {
        return error as Error;
    }
}
