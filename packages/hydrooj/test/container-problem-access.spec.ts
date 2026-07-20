import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {} };
let boundGroupIds: string[] = [];
let boundGroupError: Error | null = null;
let publicMindmaps: any[] = [];
const publicMindmapSnapshots = new Map<string, any>();
(global as any).Hydro.model.userbind = {
    async findStudentByUserId() {
        if (boundGroupError) throw boundGroupError;
        return { groupIds: boundGroupIds };
    },
};
(global as any).Hydro.model.mindmap = {
    async getPublicMap(id: unknown) {
        return publicMindmaps.find((map) => String(map._id) === String(id)) || null;
    },
    async getPublicSnapshot(id: unknown) {
        calls.mindmapSnapshots.push(String(id));
        return publicMindmapSnapshots.get(String(id)) || null;
    },
    async listPublicMaps() {
        return publicMindmaps;
    },
};

const PERM = {
    PERM_CREATE_COURSE: 1n,
    PERM_EDIT_COURSE: 2n,
    PERM_CREATE_TRAINING: 4n,
    PERM_EDIT_TRAINING: 8n,
    PERM_EDIT_TRAINING_SELF: 16n,
    PERM_PIN_TRAINING: 32n,
    PERM_VIEW_PROBLEM_HIDDEN: 64n,
    PERM_EDIT_DOMAIN: 128n,
    PERM_USERBIND_MANAGE_STUDENTS: 256n,
    PERM_VIEW_USER_PRIVATE_INFO: 512n,
    PERM_VIEW_TRAINING: 1024n,
    PERM_VIEW_PROBLEM: 2048n,
    PERM_CREATE_HOMEWORK: 4096n,
};
const PRIV = { PRIV_EDIT_SYSTEM: 1, PRIV_USER_PROFILE: 2 };
const STATUS = { STATUS_ACCEPTED: 1 };

class TestPermissionError extends Error {
    name = 'PermissionError';
    status = 403;
}

class TestValidationError extends Error {
    name = 'ValidationError';
    status = 400;

    constructor(...args: any[]) {
        super(args.at(-1) instanceof Error ? args.at(-1).message : String(args.at(-1) || 'validation failed'));
    }
}

class TestProblemNotFoundError extends Error {
    name = 'ProblemNotFoundError';
}

class TestNotFoundError extends Error {
    name = 'NotFoundError';
}

const calls = {
    add: [] as any[],
    edit: [] as any[],
    events: [] as string[],
    containerGets: [] as any[],
    get: [] as any[],
    getList: [] as any[],
    getListViewableAuthorized: [] as any[],
    getViewableAuthorized: [] as any[],
    selections: [] as any[],
    storageDeletes: [] as any[],
    storagePuts: [] as any[],
    storageSigns: [] as any[],
    trainingQueries: [] as any[],
    mindmapSnapshots: [] as string[],
};
let denySelection = false;
let currentContainer: any;
let currentTrainingStatus: any;
let trainingRows: any[] = [];
const problemDocs = new Map<number, any>();

function problemDict(docs: any[]) {
    return Object.fromEntries(docs.map((doc) => [doc.docId, doc]));
}

const problemStub = {
    PROJECTION_LIST: ['domainId', 'docId', 'pid', 'title', 'hidden', 'owner'],
    PROJECTION_PUBLIC: ['domainId', 'docId', 'pid', 'title', 'hidden', 'owner'],
    assertProblemAclDomain(user: any, domainId: string) {
        if (!user._problemAclLoaded || user._problemAclDomainId !== domainId) throw new TestPermissionError();
    },
    async get(domainId: string, rawPid: unknown) {
        calls.events.push(`get:${String(rawPid)}`);
        calls.get.push({ domainId, rawPid });
        return problemDocs.get(Number(rawPid)) || null;
    },
    async getList(domainId: string, pids: number[], canViewHidden: number | boolean) {
        calls.getList.push({ domainId, pids: [...pids], canViewHidden });
        const docs = pids.map((pid) => problemDocs.get(pid)).filter(Boolean);
        const visible = canViewHidden === true ? docs : docs.filter((doc) => !doc.hidden || doc.owner === canViewHidden);
        return problemDict(visible);
    },
    async getListStatus() {
        return {};
    },
    canViewBy(pdoc: any, user: any) {
        if (!user._problemAclLoaded || user._problemAclDomainId !== pdoc.domainId) return false;
        if (user._aclFencedPids?.has(pdoc.docId)) return false;
        if (!user.hasPerm(PERM.PERM_VIEW_PROBLEM)) return false;
        return !pdoc.hidden || pdoc.owner === user._id || user.hasPerm(PERM.PERM_VIEW_PROBLEM_HIDDEN) || user._permitPids?.has(pdoc.docId);
    },
    async getViewableAuthorized(domainId: string, rawPid: unknown, user: any) {
        calls.getViewableAuthorized.push({ domainId, rawPid });
        const pdoc = problemDocs.get(Number(rawPid)) || null;
        return pdoc && this.canViewBy(pdoc, user) ? pdoc : null;
    },
    async getListViewableAuthorized(domainId: string, pids: number[], user: any, projection: string[]) {
        calls.getListViewableAuthorized.push({ domainId, pids: [...pids], projection: [...projection] });
        return problemDict(pids.map((pid) => problemDocs.get(pid)).filter((pdoc) => pdoc && this.canViewBy(pdoc, user)));
    },
};

const problemAccessStub = {
    async assertProblemBankSelection(domainId: string, pids: number[], user: any, existingPids: number[]) {
        calls.events.push(`selection:${pids.join(',')}`);
        calls.selections.push({ domainId, pids: [...pids], user, existingPids: [...existingPids] });
        if (denySelection) throw new TestPermissionError();
    },
};

function getPids(dag: any[]) {
    return Array.from(new Set(dag.flatMap((node) => node.pids || [])));
}

function cursor(rows: any[] = []) {
    const value: any = {
        limit() {
            return value;
        },
        project() {
            return value;
        },
        async toArray() {
            return rows;
        },
    };
    return value;
}

const trainingStub = {
    getPids,
    isDone: () => false,
    isProgress: () => false,
    isOpen: () => true,
    isInvalid: () => false,
    async get(domainId: string, tid: unknown) {
        calls.containerGets.push({ domainId, tid });
        return currentContainer;
    },
    async add(...args: any[]) {
        calls.add.push(args);
        return 'new-container';
    },
    async edit(...args: any[]) {
        calls.edit.push(args);
    },
    async setStatus() {
        return {};
    },
    async getStatus() {
        return currentTrainingStatus;
    },
    getMulti(domainId: string, query: any) {
        calls.trainingQueries.push({ domainId, query: structuredClone(query) });
        return cursor(trainingRows);
    },
    getMultiStatus() {
        return cursor();
    },
};

const contestStub = {
    async get() {
        return { docId: 'contest' };
    },
    getMulti() {
        return cursor();
    },
};

const storageStub = {
    async put(...args: any[]) {
        calls.storagePuts.push(args);
    },
    async getMeta() {
        return { size: 12, lastModified: new Date('2026-07-12'), etag: 'etag' };
    },
    async del(...args: any[]) {
        calls.storageDeletes.push(args);
    },
    async signDownloadLink(...args: any[]) {
        calls.storageSigns.push(args);
        return '/signed';
    },
};

const userStub = {
    async getById() {
        return { _id: 7, uname: 'owner' };
    },
    async getListForRender() {
        return {};
    },
    async listGroup() {
        return [];
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

const errors = {
    FileLimitExceededError: class extends Error {},
    FileUploadError: class extends Error {},
    NotFoundError: TestNotFoundError,
    ProblemNotFoundError: TestProblemNotFoundError,
    ValidationError: TestValidationError,
    PermissionError: TestPermissionError,
};

const trainingRoutes: Record<string, any> = {};
const courseRoutes: Record<string, any> = {};
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    const fromHandler = parent?.filename?.includes('/packages/hydrooj/src/handler/');
    if (fromHandler && request === '../error') return errors;
    if (fromHandler && request === '../model/builtin') return { PERM, PRIV, STATUS };
    if (fromHandler && request === '../model/contest') return contestStub;
    if (fromHandler && request === '../model/document') return { getMultiStatus: () => cursor(), TYPE_PROBLEM: 10 };
    if (fromHandler && request === '../model/oplog') {
        return {
            async log() {
                return undefined;
            },
        };
    }
    if (fromHandler && request === '../model/problem') return problemStub;
    if (fromHandler && request === '../model/problem-access') return problemAccessStub;
    if (fromHandler && request === '../model/storage') return storageStub;
    if (fromHandler && request === '../model/system') return { get: () => 1000 };
    if (fromHandler && request === '../model/training') return trainingStub;
    if (fromHandler && request === '../model/user') return userStub;
    if (fromHandler && request === '../service/server') return serverStub;
    return originalLoad.call(this, request, parent, isMain);
};

let trainingModule: typeof import('../src/handler/training');
let courseModule: typeof import('../src/handler/course');
try {
    const trainingPath = require.resolve('../src/handler/training.ts');
    const coursePath = require.resolve('../src/handler/course.ts');
    delete require.cache[trainingPath];
    delete require.cache[coursePath];
    trainingModule = require(trainingPath);
    courseModule = require(coursePath);
} finally {
    Module._load = originalLoad;
}

void trainingModule.apply({
    Route(name: string, _path: string, HandlerClass: any) {
        trainingRoutes[name] = HandlerClass;
    },
} as any);
void courseModule.apply({
    Route(name: string, _path: string, HandlerClass: any) {
        courseRoutes[name] = HandlerClass;
    },
} as any);

function makeUser(overrides: Record<string, unknown> = {}) {
    const perms = new Set<bigint>([PERM.PERM_VIEW_PROBLEM, PERM.PERM_CREATE_TRAINING, PERM.PERM_CREATE_COURSE]);
    return {
        _id: 42,
        _problemAclLoaded: true,
        _problemAclDomainId: 'system',
        _permitPids: new Set<number>(),
        _authoredPids: new Set<number>(),
        _maintainedPids: new Set<number>(),
        _aclFencedPids: new Set<number>(),
        timeZone: 'Asia/Shanghai',
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => perms.has(perm)),
        hasPriv: (wanted: number) => wanted === PRIV.PRIV_USER_PROFILE,
        own: (doc: any) => doc?.owner === 42,
        ...overrides,
    } as any;
}

function makeHandler(HandlerClass: any, user = makeUser()) {
    const handler = new HandlerClass();
    Object.assign(handler, {
        ctx: { parallel: async () => undefined, setting: { get: () => false } },
        domain: { _id: 'system' },
        user,
        url: () => '/target',
        checkPerm: () => undefined,
        checkPriv(priv: number) {
            if (!user.hasPriv(priv)) throw new TestPermissionError();
        },
        request: { files: {} },
        response: {
            body: {},
            addHeader() {
                return undefined;
            },
        },
        async paginate(value: any) {
            const docs = await value.toArray();
            return [docs, 1, docs.length];
        },
    });
    return handler;
}

async function captureFailure(callback: () => Promise<unknown>) {
    try {
        await callback();
        return null;
    } catch (error) {
        return error as Error;
    }
}

beforeEach(() => {
    calls.add.length = 0;
    calls.edit.length = 0;
    calls.events.length = 0;
    calls.containerGets.length = 0;
    calls.get.length = 0;
    calls.getList.length = 0;
    calls.getListViewableAuthorized.length = 0;
    calls.getViewableAuthorized.length = 0;
    calls.selections.length = 0;
    calls.storageDeletes.length = 0;
    calls.storagePuts.length = 0;
    calls.storageSigns.length = 0;
    calls.trainingQueries.length = 0;
    calls.mindmapSnapshots.length = 0;
    denySelection = false;
    problemDocs.clear();
    currentContainer = null;
    currentTrainingStatus = null;
    trainingRows = [];
    boundGroupIds = [];
    boundGroupError = null;
    publicMindmaps = [];
    publicMindmapSnapshots.clear();
});

const MAP_A = '64b000000000000000000001';
const MAP_B = '64b000000000000000000002';
const ROOT_A = '64b000000000000000000011';
const NODE_A = '64b000000000000000000012';
const NOW = new Date('2026-07-20T12:00:00.000Z');

function publicMap(id = MAP_A) {
    return {
        _id: id,
        title: id === MAP_A ? '算法' : '面向对象',
        rootNodeId: id === MAP_A ? ROOT_A : '64b000000000000000000021',
        visibility: 'public',
        layoutDirection: 'RIGHT',
        createdAt: NOW,
        updatedAt: NOW,
    };
}

function publicSnapshot() {
    return {
        config: publicMap(),
        nodes: [
            {
                _id: ROOT_A,
                mapId: MAP_A,
                parentId: null,
                topic: '算法',
                tags: ['internal-root'],
                problemIds: ['SECRET'],
                order: 0,
                createdAt: NOW,
                updatedAt: NOW,
            },
            {
                _id: NODE_A,
                mapId: MAP_A,
                parentId: ROOT_A,
                topic: '模拟',
                tags: ['simulation'],
                problemIds: ['SECRET'],
                order: 1,
                createdAt: NOW,
                updatedAt: NOW,
            },
        ],
    };
}

describe('P3.20 course mindmap binding and projection', () => {
    it('returns an explicit unbound state and fails when a persisted binding is unavailable', async () => {
        currentContainer = {
            domainId: 'system',
            docId: 'course',
            owner: 7,
            kind: 'course',
            title: 'Course',
            content: '',
            description: '',
            courseGroupIds: [],
            dag: [],
        };
        const unbound = makeHandler(courseRoutes.course_detail);
        await unbound.get('forged-domain', 'course', 'mindmap');
        expect(unbound.response.body.view).to.equal('mindmap');
        expect(unbound.response.body.courseMindmap).to.equal(null);
        expect(calls.mindmapSnapshots).to.deep.equal([]);

        currentContainer = { ...currentContainer, mindmapId: MAP_A };
        const unavailable = makeHandler(courseRoutes.course_detail);
        const error = await captureFailure(() => unavailable.get('forged-domain', 'course', 'mindmap'));
        expect(error).to.be.instanceOf(TypeError);
        expect(error?.message).to.include('unavailable public mindmap');
        expect(calls.mindmapSnapshots).to.deep.equal([MAP_A]);
    });

    it('does not load a bound mindmap during the ordinary chapter view', async () => {
        publicMindmaps = [publicMap()];
        publicMindmapSnapshots.set(MAP_A, publicSnapshot());
        currentContainer = {
            domainId: 'system',
            docId: 'course',
            owner: 7,
            kind: 'course',
            title: 'Course',
            content: '',
            description: '',
            courseGroupIds: [],
            mindmapId: MAP_A,
            dag: [],
        };
        const handler = makeHandler(courseRoutes.course_detail);
        await handler.get('forged-domain', 'course');
        expect(handler.response.body.view).to.equal('overview');
        expect(handler.response.body.courseMindmap).to.equal(null);
        expect(calls.mindmapSnapshots).to.deep.equal([]);
    });

    it('projects only visible in-course problems with direct nodes from the bound map', async () => {
        publicMindmaps = [publicMap()];
        publicMindmapSnapshots.set(MAP_A, publicSnapshot());
        problemDocs.set(11, {
            domainId: 'system',
            docId: 11,
            pid: 'P11',
            owner: 7,
            title: 'Visible',
            hidden: false,
            knowledgeMapId: MAP_A,
            knowledgeNodeIds: [NODE_A],
        });
        problemDocs.set(12, {
            domainId: 'system',
            docId: 12,
            pid: 'P12',
            owner: 7,
            title: 'Other map',
            hidden: false,
            knowledgeMapId: MAP_B,
            knowledgeNodeIds: ['64b000000000000000000022'],
        });
        problemDocs.set(13, {
            domainId: 'system',
            docId: 13,
            pid: 'P13',
            owner: 7,
            title: 'Hidden',
            hidden: true,
            knowledgeMapId: MAP_A,
            knowledgeNodeIds: [NODE_A],
        });
        currentContainer = {
            domainId: 'system',
            docId: 'course',
            owner: 7,
            kind: 'course',
            title: 'Course',
            content: '',
            description: '',
            courseGroupIds: [],
            mindmapId: MAP_A,
            dag: [{ _id: 1, title: '第一章', requireNids: [], pids: [11, 12, 13], tids: [] }],
        };
        const handler = makeHandler(courseRoutes.course_detail);
        await handler.get('forged-domain', 'course', 'mindmap');
        const view = handler.response.body.courseMindmap;
        expect(handler.response.body.view).to.equal('mindmap');
        expect(view.usedNodeIds).to.deep.equal([NODE_A]);
        expect(view.problems).to.deep.equal([
            {
                domainId: 'system',
                docId: 11,
                pid: 'P11',
                title: 'Visible',
                nodeIds: [NODE_A],
                chapters: [{ id: 1, title: '第一章' }],
            },
        ]);
        expect(view.nodes.every((node: any) => node.tags.length === 0 && node.problemIds.length === 0)).to.equal(true);
        expect(JSON.stringify(view)).not.to.include('managedAuthoring');
        expect(handler.response.body.tdoc).to.deep.equal({ docId: 'course', title: 'Course', term: '' });
        expect(handler.response.body.chapters).to.deep.equal([]);
        expect(handler.response.body.pdict).to.deep.equal({});
        expect(handler.response.body.psdict).to.deep.equal({});
        expect(handler.response.body.cdict).to.deep.equal({});
        expect(JSON.stringify(handler.response.body)).not.to.include('P13');
        expect(calls.getListViewableAuthorized).to.have.length(1);
        expect(calls.mindmapSnapshots).to.deep.equal([MAP_A]);
    });

    it('lists public maps for settings and validates bindings before any course write', async () => {
        publicMindmaps = [publicMap()];
        const editor = makeHandler(courseRoutes.course_create);
        await editor.get('forged-domain');
        expect(editor.response.body.mindmaps).to.deep.equal([{ _id: MAP_A, title: '算法', visibility: 'public' }]);

        await editor.post('forged-domain', null, 'Course', '', JSON.stringify([{ _id: 1, title: '第一章', pids: [], tids: [] }]), '', '', [], MAP_A);
        expect(calls.add.at(-1)[7].mindmapId.toHexString()).to.equal(MAP_A);

        calls.add.length = 0;
        const rejected = await captureFailure(() =>
            editor.post('forged-domain', null, 'Course', '', JSON.stringify([{ _id: 1, title: '第一章', pids: [], tids: [] }]), '', '', [], MAP_B),
        );
        expect(rejected?.name).to.equal('ValidationError');
        expect(calls.add).to.have.length(0);
    });

    it('unsets an existing binding without changing chapter semantics', async () => {
        const editor = makeHandler(courseRoutes.course_edit);
        editor.tdoc = {
            docId: 'course',
            kind: 'course',
            title: 'Course',
            content: '',
            description: '',
            courseGroupIds: [],
            mindmapId: MAP_A,
            dag: [{ _id: 1, title: '第一章', requireNids: [], pids: [], tids: [] }],
        };
        await editor.post('forged-domain', 'course', 'Course', '', JSON.stringify([{ _id: 1, title: '第一章', pids: [], tids: [] }]), '', '', [], '');
        expect(calls.edit.at(-1)[2].dag[0].title).to.equal('第一章');
        expect(calls.edit.at(-1)[3]).to.deep.equal({ mindmapId: 1 });
    });
});

describe('P3.8 course workspace capabilities', () => {
    it('keeps the advertised system-admin create capability through handler prepare', async () => {
        const adminUser = makeUser({
            hasPerm: () => false,
            hasPriv: (priv: number) => priv === PRIV.PRIV_USER_PROFILE || priv === PRIV.PRIV_EDIT_SYSTEM,
        });
        const listHandler = makeHandler(courseRoutes.course_main, adminUser);
        await listHandler.get('forged-domain', 1, '');
        expect(listHandler.response.body.canCreate).to.equal(true);

        const createHandler = makeHandler(courseRoutes.course_create, adminUser);
        createHandler.checkPerm = (perm: bigint) => {
            if (!adminUser.hasPerm(perm)) throw new TestPermissionError();
        };
        const error = await captureFailure(() => createHandler.prepare('forged-domain', null));
        expect(error).to.equal(null);
    });

    it('does not treat create permission as edit-all permission', async () => {
        trainingRows = [
            { docId: 'own', owner: 42, kind: 'course', title: 'Own', dag: [] },
            { docId: 'other', owner: 7, kind: 'course', title: 'Other', dag: [] },
        ];
        const handler = makeHandler(courseRoutes.course_main);
        await handler.get('forged-domain', 1, '');
        expect(handler.response.body.canCreate).to.equal(true);
        expect(handler.response.body.managedIds).to.deep.equal(['own']);
        expect(handler.response.body.tcount).to.equal(2);
        expect(calls.trainingQueries[0].domainId).to.equal('system');
        expect(calls.trainingQueries[0].query.$or).to.deep.include({ owner: 42 });
    });

    it('passes the real enrollment status to course detail', async () => {
        currentTrainingStatus = { enroll: 1, donePids: [11] };
        currentContainer = {
            domainId: 'system',
            docId: 'course',
            owner: 7,
            kind: 'course',
            title: 'Course',
            content: '',
            description: '',
            courseGroupIds: [],
            dag: [],
        };
        const handler = makeHandler(courseRoutes.course_detail);
        await handler.get('forged-domain', 'course');
        expect(handler.response.body.tsdoc).to.equal(currentTrainingStatus);
        expect(handler.response.body.canEnroll).to.equal(false);
    });

    it('publishes quiz creation only when a course manager can also create homework', async () => {
        currentContainer = {
            domainId: 'system',
            docId: 'course',
            owner: 42,
            kind: 'course',
            title: 'Course',
            content: '',
            description: '',
            courseGroupIds: [],
            dag: [],
        };
        const denied = makeHandler(courseRoutes.course_detail);
        await denied.get('forged-domain', 'course');
        expect(denied.response.body.canCreateQuiz).to.equal(false);

        const allowedUser = makeUser({
            hasPerm: (permission: bigint) => permission === PERM.PERM_CREATE_HOMEWORK,
        });
        const allowed = makeHandler(courseRoutes.course_detail, allowedUser);
        await allowed.get('forged-domain', 'course');
        expect(allowed.response.body.canCreateQuiz).to.equal(true);
    });
});

describe('P3.5 course chapter content', () => {
    it('persists chapter markdown and serializes it back to the editor', async () => {
        const markdown = '# 指针\n\n```c\nint *p;\n```';
        const createHandler = makeHandler(courseRoutes.course_create);
        await createHandler.post(
            'forged-domain',
            null,
            'Course',
            'Overview',
            JSON.stringify([{ _id: 1, title: 'Pointers', content: markdown, pids: [], tids: [] }]),
            '',
            '',
            [],
        );
        expect(calls.add.at(-1)[4][0].content).to.equal(markdown);

        const editHandler = makeHandler(courseRoutes.course_edit);
        editHandler.tdoc = {
            docId: 'course',
            kind: 'course',
            title: 'Course',
            content: 'Overview',
            description: '',
            courseGroupIds: [],
            dag: [calls.add.at(-1)[4][0]],
        };
        await editHandler.get('forged-domain');
        const chapters = JSON.parse(editHandler.response.body.chapters);
        expect(chapters[0].content).to.equal(markdown);
    });

    it('rejects non-string chapter content before writing', async () => {
        const handler = makeHandler(courseRoutes.course_create);
        const error = await captureFailure(() =>
            handler.post(
                'forged-domain',
                null,
                'Course',
                'Overview',
                JSON.stringify([{ _id: 1, title: 'Pointers', content: { nested: true }, pids: [], tids: [] }]),
                '',
                '',
                [],
            ),
        );
        expect(error?.name).to.equal('ValidationError');
        expect(calls.add).to.have.length(0);
    });
});

describe('P3.6 protected course files', () => {
    const courseWithFile = (overrides: Record<string, unknown> = {}) => ({
        domainId: 'system',
        docId: 'course',
        owner: 7,
        kind: 'course',
        title: 'Course',
        content: '',
        description: '',
        courseGroupIds: ['group-a'],
        dag: [],
        files: [{ _id: 'slides.pdf', name: 'slides.pdf', size: 12 }],
        ...overrides,
    });

    it('stores uploads under the isolated course prefix and updates the declared file list', async () => {
        currentContainer = courseWithFile({ owner: 42, files: [] });
        const handler = makeHandler(courseRoutes.course_files);
        await handler.prepare('forged-domain', 'course');
        handler.request.files.file = { filepath: '/tmp/slides.pdf', size: 12 };
        await handler.postUploadFile('forged-domain', 'course', 'slides.pdf');

        expect(calls.containerGets.at(-1)?.domainId).to.equal('system');
        expect(calls.storagePuts.at(-1)?.[0]).to.equal('course/system/course/slides.pdf');
        expect(calls.edit.at(-1)?.[0]).to.equal('system');
        expect(calls.edit.at(-1)?.[2].files.map((file: any) => file.name)).to.deep.equal(['slides.pdf']);
    });

    it('allows only the owner or a system administrator to manage files', async () => {
        currentContainer = courseWithFile();
        const regular = makeHandler(courseRoutes.course_files);
        expect((await captureFailure(() => regular.prepare('forged-domain', 'course')))?.name).to.equal('PermissionError');

        const admin = makeHandler(
            courseRoutes.course_files,
            makeUser({
                hasPriv: (priv: number) => priv === PRIV.PRIV_USER_PROFILE || priv === PRIV.PRIV_EDIT_SYSTEM,
            }),
        );
        await admin.prepare('forged-domain', 'course');
    });

    it('allows an in-scope student to download only a file declared by that course', async () => {
        currentContainer = courseWithFile();
        boundGroupIds = ['group-a'];
        const handler = makeHandler(courseRoutes.course_file_download);
        await handler.get('forged-domain', 'course', 'slides.pdf');

        expect(calls.containerGets.at(-1)?.domainId).to.equal('system');
        expect(calls.storageSigns.at(-1)?.[0]).to.equal('course/system/course/slides.pdf');
        expect(handler.response.redirect).to.equal('/signed');
    });

    it('rejects an out-of-scope student before signing any storage URL', async () => {
        currentContainer = courseWithFile();
        boundGroupIds = ['group-b'];
        const handler = makeHandler(courseRoutes.course_file_download);
        const error = await captureFailure(() => handler.get('forged-domain', 'course', 'slides.pdf'));

        expect(error?.name).to.equal('PermissionError');
        expect(calls.storageSigns).to.have.length(0);
    });

    it('rejects anonymous downloads and propagates membership lookup failures', async () => {
        currentContainer = courseWithFile();
        const anonymous = makeHandler(courseRoutes.course_file_download, makeUser({ hasPriv: () => false }));
        expect((await captureFailure(() => anonymous.get('forged-domain', 'course', 'slides.pdf')))?.name).to.equal('PermissionError');

        boundGroupError = new Error('userbind unavailable');
        const lookupFailure = makeHandler(courseRoutes.course_file_download);
        const error = await captureFailure(() => lookupFailure.get('forged-domain', 'course', 'slides.pdf'));
        expect(error?.message).to.equal('userbind unavailable');
        expect(calls.storageSigns).to.have.length(0);
    });

    it('validates the complete delete list before deleting storage or metadata', async () => {
        currentContainer = courseWithFile({ owner: 42 });
        const handler = makeHandler(courseRoutes.course_files);
        await handler.prepare('forged-domain', 'course');
        const error = await captureFailure(() => handler.postDeleteFiles('forged-domain', 'course', ['slides.pdf', 'secret.pdf']));
        expect(error?.name).to.equal('NotFoundError');
        expect(calls.storageDeletes).to.have.length(0);
        expect(calls.edit).to.have.length(0);
    });

    it('rejects undeclared filenames and non-course tids before signing', async () => {
        currentContainer = courseWithFile({ courseGroupIds: [] });
        const missing = makeHandler(courseRoutes.course_file_download);
        expect((await captureFailure(() => missing.get('forged-domain', 'course', 'secret.pdf')))?.name).to.equal('NotFoundError');
        expect(calls.storageSigns).to.have.length(0);

        currentContainer = courseWithFile({ kind: undefined });
        const swapped = makeHandler(courseRoutes.course_file_download);
        expect((await captureFailure(() => swapped.get('forged-domain', 'training', 'slides.pdf')))?.name).to.equal('NotFoundError');
        expect(calls.storageSigns).to.have.length(0);
    });

    it('blocks a course tid through the legacy training download route', async () => {
        currentContainer = courseWithFile();
        const handler = makeHandler(trainingRoutes.training_file_download);
        const error = await captureFailure(() => handler.get('forged-domain', 'course', 'slides.pdf'));

        expect(error?.name).to.equal('NotFoundError');
        expect(calls.containerGets.at(-1)?.domainId).to.equal('system');
        expect(calls.storageSigns).to.have.length(0);
    });
});

describe('training/course problem selection', () => {
    it('training validates canonical scope before lookup and gives missing/out-of-scope the same error with zero writes', async () => {
        const HandlerClass = trainingRoutes.training_create;
        const run = async (hasDocument: boolean) => {
            calls.events.length = 0;
            calls.get.length = 0;
            calls.add.length = 0;
            if (hasDocument) problemDocs.set(77, { domainId: 'system', docId: 77, owner: 7, hidden: true });
            else problemDocs.delete(77);
            denySelection = true;
            const handler = makeHandler(HandlerClass);
            const error = await captureFailure(() =>
                handler.post('forged', null, 'Training', 'Body', JSON.stringify([{ _id: 1, title: 'N', requireNids: [], pids: [77] }]), 0, ''),
            );
            return error;
        };
        const missing = await run(false);
        const unauthorized = await run(true);
        expect(missing?.name).to.equal('PermissionError');
        expect(unauthorized?.name).to.equal('PermissionError');
        expect(calls.get).to.deep.equal([]);
        expect(calls.add).to.deep.equal([]);
        expect(calls.edit).to.deep.equal([]);
    });

    it('course validates canonical scope before lookup and gives missing/out-of-scope the same error with zero writes', async () => {
        const HandlerClass = courseRoutes.course_create;
        const run = async (hasDocument: boolean) => {
            calls.events.length = 0;
            calls.get.length = 0;
            calls.add.length = 0;
            if (hasDocument) problemDocs.set(88, { domainId: 'system', docId: 88, owner: 7, hidden: true });
            else problemDocs.delete(88);
            denySelection = true;
            const handler = makeHandler(HandlerClass);
            const error = await captureFailure(() =>
                handler.post('forged', null, 'Course', 'Body', JSON.stringify([{ _id: 1, title: 'C', pids: [88], tids: [] }]), '', '', []),
            );
            return error;
        };
        const missing = await run(false);
        const unauthorized = await run(true);
        expect(missing?.name).to.equal('PermissionError');
        expect(unauthorized?.name).to.equal('PermissionError');
        expect(calls.get).to.deep.equal([]);
        expect(calls.add).to.deep.equal([]);
        expect(calls.edit).to.deep.equal([]);
    });

    it('normalizes valid training/course problem ids to deduplicated numeric docIds', async () => {
        problemDocs.set(11, { domainId: 'system', docId: 11, owner: 42, hidden: true });
        const trainingHandler = makeHandler(trainingRoutes.training_create);
        await trainingHandler.post(
            'forged',
            null,
            'Training',
            'Body',
            JSON.stringify([{ _id: 1, title: 'N', requireNids: [], pids: ['11', 11] }]),
            0,
            '',
        );
        const courseHandler = makeHandler(courseRoutes.course_create);
        await courseHandler.post('forged', null, 'Course', 'Body', JSON.stringify([{ _id: 1, title: 'C', pids: ['11', 11], tids: [] }]), '', '', []);
        expect(calls.selections.map((call) => call.pids)).to.deep.equal([[11], [11]]);
        expect(calls.add[0][4][0].pids).to.deep.equal([11]);
        expect(calls.add[1][4][0].pids).to.deep.equal([11]);
        expect(calls.get).to.deep.equal([]);
    });

    it('keeps unchanged grandfathered training references without a pre-scope lookup', async () => {
        currentContainer = {
            domainId: 'system',
            docId: 'training',
            owner: 42,
            pin: 0,
            dag: [{ _id: 1, title: 'N', requireNids: [], pids: [11] }],
        };
        const handler = makeHandler(trainingRoutes.training_edit);
        handler.tdoc = currentContainer;
        await handler.post('forged', 'training', 'Training', 'Body', JSON.stringify([{ _id: 1, title: 'N', requireNids: [], pids: ['11'] }]), 0, '');
        expect(calls.selections[0].existingPids).to.deep.equal([11]);
        expect(calls.get).to.deep.equal([]);
        expect(calls.edit).to.have.length(1);
    });
});

function registerReferencedProblemVisibilitySuite(label: 'training' | 'course', routeMap: Record<string, any>, routeName: string) {
    describe(`${label} referenced problem visibility`, () => {
        async function render(user: any) {
            currentContainer = {
                domainId: 'system',
                docId: 'container',
                owner: 7,
                kind: label === 'course' ? 'course' : undefined,
                title: label,
                description: '',
                courseGroupIds: [],
                dag: [{ _id: 1, title: 'N', requireNids: [], pids: [11], tids: [] }],
            };
            const handler = makeHandler(routeMap[routeName], user);
            await handler.get('system', 'container');
            return handler.response.body.pdict;
        }

        it('shows an active verifier the referenced hidden problem', async () => {
            problemDocs.set(11, { domainId: 'system', docId: 11, owner: 7, hidden: true, title: 'Hidden' });
            const user = makeUser({ _permitPids: new Set([11]) });
            expect(await render(user)).to.have.property('11');
        });

        it('hides the referenced hidden problem immediately when fenced or revoked', async () => {
            problemDocs.set(11, { domainId: 'system', docId: 11, owner: 7, hidden: true, title: 'Hidden' });
            const fenced = makeUser({ _permitPids: new Set([11]), _aclFencedPids: new Set([11]) });
            const revoked = makeUser({ _permitPids: new Set<number>() });
            expect(await render(fenced)).not.to.have.property('11');
            expect(await render(revoked)).not.to.have.property('11');
        });

        it('ignores a forged method domain and binds container/problem reads to the request domain', async () => {
            problemDocs.set(11, { domainId: 'system', docId: 11, owner: 7, hidden: false, title: 'Public' });
            currentContainer = {
                domainId: 'system',
                docId: 'container',
                owner: 7,
                kind: label === 'course' ? 'course' : undefined,
                title: label,
                description: '',
                courseGroupIds: [],
                dag: [{ _id: 1, title: 'N', requireNids: [], pids: [11], tids: [] }],
            };
            const handler = makeHandler(routeMap[routeName], makeUser());
            await handler.get('forged-domain', 'container');
            expect(calls.containerGets.at(-1)?.domainId).to.equal('system');
            expect(calls.getListViewableAuthorized.at(-1)?.domainId).to.equal('system');
        });
    });
}

registerReferencedProblemVisibilitySuite('training', trainingRoutes, 'training_detail');
registerReferencedProblemVisibilitySuite('course', courseRoutes, 'course_detail');
