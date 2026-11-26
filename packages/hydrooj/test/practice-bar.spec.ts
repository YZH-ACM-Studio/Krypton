import { beforeEach, describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';

const Module = require('node:module') as {
    _load: (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
};

const host = globalThis as unknown as {
    Hydro?: {
        model: Record<string, unknown>;
        ui: Record<string, unknown>;
        module: { hash: Record<string, unknown> };
    };
};
host.Hydro ||= { model: {}, ui: {}, module: { hash: {} } };
if (!host.Hydro.model) host.Hydro.model = {};
if (!host.Hydro.ui) host.Hydro.ui = {};
if (!host.Hydro.module) host.Hydro.module = { hash: {} };
if (!host.Hydro.module.hash) host.Hydro.module.hash = {};
host.Hydro.model.permits = {
    async listCompletedDataContributorUids() {
        return [] as number[];
    },
};

const DOMAIN = 'system';
const TRAINING_ID = new ObjectId('66d100000000000000000001');
const COURSE_ID = new ObjectId('66d100000000000000000002');
const TID = TRAINING_ID.toHexString();
const STAGE_ID = 4;
const STAGE_PIDS = [1001, 1002, 1003];
// Same accepted code serializeProblemSetIntro counts, and STATUS.STATUS_ACCEPTED.
const ACCEPTED = 1;

interface PracticeBarStage {
    _id: number;
    title: string;
    pids: number[];
}

interface PracticeBarInput {
    title: string;
    tid: string;
    stage: PracticeBarStage;
    pid: number;
    visiblePids: ReadonlySet<number>;
    doneCount: number;
    totalCount: number;
    detailUrl: string;
    problemUrl: (pid: number) => string;
}

interface PracticeBar {
    title: string;
    href: string;
    stageTitle: string;
    index: number;
    total: number;
    prevHref: string | null;
    nextHref: string | null;
    doneCount: number;
    totalCount: number;
}

type BuildPracticeBar = (input: PracticeBarInput) => PracticeBar | null;

interface Fixture {
    allowPreview: boolean;
    publishedIntegrity: unknown;
    statusByPid: Record<string, { status?: number }>;
    stageVisiblePids: Set<number>;
    contextualDone: Map<number, ReadonlySet<number>> | null;
}

interface TrainingDocument {
    domainId: string;
    docId: ObjectId;
    owner: number;
    title: string;
    description: string;
    kind: string;
    dag: Array<{ _id: number; title: string; requireNids: number[]; pids: number[] }>;
}

interface ProblemRow {
    domainId: string;
    docId: number;
    owner: number;
    pid: string;
    title: string;
    content: string;
    config: string;
    tag: string[];
    additional_file: unknown[];
}

interface Actor {
    _id: number;
    _problemAclDomainId: string;
    group: string[];
    hasPerm: (perm: bigint) => boolean;
    hasPriv: (priv: number) => boolean;
    own: (doc: { owner?: number }) => boolean;
}

interface DetailHandler {
    domain: { _id: string };
    user: Actor;
    response: { body: Record<string, unknown>; template?: string };
    request: { json: boolean };
    ctx: {
        parallel: (...args: unknown[]) => Promise<void>;
        setting: { get: (key: string) => unknown };
        i18n: { langs: () => string[] };
    };
    UiContext: Record<string, unknown>;
    checkPriv: (...privs: number[]) => void;
    url: (name: string, args?: Record<string, unknown>) => string;
    _prepare: (
        domainId: string,
        pid: number,
        tid?: ObjectId,
        practiceContainerKind?: string,
        practiceContainerId?: ObjectId,
        practiceScopeKind?: string,
        practiceScopeId?: number,
        practicePreview?: boolean,
        virtual?: boolean,
    ) => Promise<void>;
    get: (...args: unknown[]) => Promise<void>;
}

interface TrainingDetail {
    domain: { _id: string };
    user: Actor;
    response: { body: Record<string, unknown>; template?: string };
    request: { json: boolean };
    ctx: DetailHandler['ctx'];
    UiContext: Record<string, unknown>;
    url: (name: string, args?: Record<string, unknown>) => string;
    get: (domainId: string, tid: ObjectId, uid?: number) => Promise<void>;
}

function freshFixture(): Fixture {
    return {
        allowPreview: false,
        publishedIntegrity: null,
        statusByPid: { 1001: { status: ACCEPTED } },
        stageVisiblePids: new Set(STAGE_PIDS),
        contextualDone: null,
    };
}

let fixture = freshFixture();

function trainingDocument(): TrainingDocument {
    return {
        domainId: DOMAIN,
        docId: TRAINING_ID,
        owner: 7,
        title: '入门练习',
        description: '练习说明',
        kind: 'problem_set',
        dag: [
            {
                _id: STAGE_ID,
                title: '阶段 A',
                requireNids: [],
                pids: [...STAGE_PIDS],
            },
        ],
    };
}

function problemRow(docId: number): ProblemRow {
    return {
        domainId: DOMAIN,
        docId,
        owner: 7,
        pid: `P${docId}`,
        title: `题目 ${docId}`,
        content: '题面',
        config: '',
        tag: [],
        additional_file: [],
    };
}

function stage(pids: number[] = [...STAGE_PIDS]): PracticeBarStage {
    return { _id: STAGE_ID, title: '阶段 A', pids };
}

function linkedProblem(pid: number): string {
    return `/p/${pid}?practiceContainerKind=problemSet&practiceContainerId=${TID}&practiceScopeKind=stage&practiceScopeId=${STAGE_ID}`;
}

function detailUrl(): string {
    return `/problem-sets/${TID}`;
}

function barInput(pid: number, visiblePids: ReadonlySet<number>, pids: number[] = [...STAGE_PIDS]): PracticeBarInput {
    return {
        title: '入门练习',
        tid: TID,
        stage: stage(pids),
        pid,
        visiblePids,
        doneCount: 4,
        totalCount: 9,
        detailUrl: detailUrl(),
        problemUrl: linkedProblem,
    };
}

function loadBuildPracticeBar(): BuildPracticeBar {
    let loaded: { buildPracticeBar?: unknown };
    try {
        loaded = require('../src/lib/practice-bar') as { buildPracticeBar?: unknown };
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        if (code === 'MODULE_NOT_FOUND') {
            throw new Error('buildPracticeBar is not exported from packages/hydrooj/src/lib/practice-bar.ts');
        }
        throw error;
    }
    if (typeof loaded.buildPracticeBar !== 'function') {
        throw new TypeError('buildPracticeBar is not exported from packages/hydrooj/src/lib/practice-bar.ts');
    }
    return loaded.buildPracticeBar as BuildPracticeBar;
}

function requireBar(bar: PracticeBar | null): PracticeBar {
    expect(bar).to.not.equal(null);
    if (!bar) throw new TypeError('practice bar missing');
    return bar;
}

function requireString(value: string | null, label: string): string {
    expect(value).to.be.a('string');
    if (typeof value !== 'string') throw new TypeError(`${label} missing`);
    return value;
}

function visibleProblems(_domainId: string, pids: readonly number[]) {
    const visible: Record<number, { docId: number; title: string; pid: string }> = {};
    for (const pid of pids) {
        if (!fixture.stageVisiblePids.has(pid)) continue;
        visible[pid] = { docId: pid, title: `题目 ${pid}`, pid: `P${pid}` };
    }
    return visible;
}

const problemApi = {
    PROJECTION_PUBLIC: ['docId', 'title', 'pid'],
    assertProblemAclDomain() {
        return undefined;
    },
    async refreshProblemAcl() {
        return undefined;
    },
    async get(_domainId: string, pid: number | string) {
        return problemRow(Number(pid));
    },
    async getViewableAuthorized(_domainId: string, pid: number | string) {
        return problemRow(Number(pid));
    },
    async getStatus() {
        return {};
    },
    async getListStatus(_domainId: string, _uid: number, pids: readonly number[]) {
        const rows: Record<string, { status?: number }> = {};
        for (const pid of pids) {
            const row = fixture.statusByPid[String(pid)];
            if (row) rows[String(pid)] = { status: row.status };
        }
        return rows;
    },
    canSubmitProblem() {
        return false;
    },
    canEditProblemContent() {
        return false;
    },
    canEditProblemData() {
        return false;
    },
    canEditProblemTags() {
        return false;
    },
    canManageProblemContributions() {
        return false;
    },
    canMaintainProblem() {
        return false;
    },
    canArchiveProblem() {
        return false;
    },
    canViewBy() {
        return true;
    },
    canOpenProblemWorkspace() {
        return false;
    },
    canBrowseProblemBank() {
        return false;
    },
};

const problemStub = {
    __esModule: true as const,
    ...problemApi,
    default: undefined as unknown,
};
problemStub.default = problemStub;

const trainingApi = {
    async get() {
        return trainingDocument();
    },
    async getStatus() {
        return {};
    },
    getMultiStatus() {
        const cursor = {
            project() {
                return cursor;
            },
            limit() {
                return cursor;
            },
            async toArray() {
                return [];
            },
        };
        return cursor;
    },
};

const trainingStub = {
    __esModule: true as const,
    ...trainingApi,
};

const userApi = {
    async getById(_domainId: string, uid: number) {
        return { _id: uid, uname: `user-${uid}` };
    },
    async getList(_domainId: string, _uids: number[]) {
        return {};
    },
    async getListForRender() {
        return {};
    },
    async listGroup() {
        return [];
    },
};

const userStub = {
    __esModule: true as const,
    ...userApi,
    default: userApi,
};

const practiceIntegrityStub = {
    __esModule: true as const,
    PracticeIntegrityContextError: class PracticeIntegrityContextError extends Error {
        constructor(reason: string) {
            super(reason);
            this.name = 'PracticeIntegrityContextError';
        }
    },
    practiceIntegrityService: {
        async getLatestPublished() {
            if (fixture.allowPreview) return { state: 'published', revision: 1 };
            return fixture.publishedIntegrity;
        },
    },
    trustedPracticeContextReference() {
        return undefined;
    },
};

const practiceAccessStub = {
    __esModule: true as const,
    async assertPracticeContextAccess() {
        return undefined;
    },
    canManagePracticeContainer() {
        return false;
    },
    canPreviewPracticeIntegrity() {
        return fixture.allowPreview;
    },
    async loadPracticeContainer(_domainId: string, kind: string, id: ObjectId) {
        if (kind === 'course') {
            return {
                docId: id,
                kind: 'course',
                owner: 7,
                title: '课程甲',
                description: '',
            };
        }
        return trainingDocument();
    },
    async preparePracticeIssue() {
        return { primaryContainer: trainingDocument() };
    },
    async issuePracticeContext() {
        return { controlled: false };
    },
    async resolveInheritedPracticeEnforcement() {
        return { prohibitExternalCodeInjection: false, removeIndependentSubmitForm: false };
    },
};

const contextualStub = {
    __esModule: true as const,
    contextualCompletionService: {
        async getCompletedByScope() {
            return fixture.contextualDone ?? new Map<number, ReadonlySet<number>>();
        },
    },
};

const problemSetAccessStub = {
    __esModule: true as const,
    problemSetAccessService: {
        async assertAccessible() {
            return { accessible: true, stageAccess: 'all' as const };
        },
    },
    canManageProblemSet() {
        return false;
    },
};

const discussionStub = {
    __esModule: true as const,
    async count() {
        return 0;
    },
};

const solutionApi = {
    async count() {
        return 0;
    },
};

const solutionStub = {
    __esModule: true as const,
    ...solutionApi,
    default: solutionApi,
};

const recordApi = {
    STAT_QUERY: {} as Record<string, unknown>,
    RECORD_GENERATE: 'generate',
    RECORD_PRETEST: 'pretest',
    async get() {
        return null;
    },
};

const recordStub = {
    __esModule: true as const,
    ...recordApi,
    default: recordApi,
};

const contestStub = {
    __esModule: true as const,
    homeworkStartRequired() {
        return false;
    },
    isOngoing() {
        return false;
    },
    isNotStarted() {
        return false;
    },
    isDone() {
        return false;
    },
    canShowSelfRecord() {
        return false;
    },
    getParticipationMode() {
        return 'individual';
    },
    async getRelated() {
        return [];
    },
    async resolveContestListParticipantScope() {
        return null;
    },
    parentSchoolIdsFromUser() {
        return [] as string[];
    },
    async getListStatus() {
        return {};
    },
    isListVisibleToUser() {
        return false;
    },
};

const contestHandlerStub = {
    __esModule: true as const,
    ContestDetailBaseHandler: class ContestDetailBaseHandler {},
    canBrowseAssignRestrictedContests() {
        return false;
    },
};

const serverStub = {
    __esModule: true as const,
    Handler: class HandlerStub {},
    param: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
    post: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
    query: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
    route: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
    Query: (_schema: unknown, resolver: unknown) => resolver,
    Types: new Proxy(
        {},
        {
            get: () => () => ({}),
        },
    ),
};

const problemReferenceStub = {
    __esModule: true as const,
    getVisibleReferencedProblems: visibleProblems,
    normalizeProblemDocIds(values: unknown) {
        if (!Array.isArray(values)) throw new TypeError('pids');
        return values.map((value) => Number(value));
    },
};

const rosterLoadStub = {
    __esModule: true as const,
    async loadCompletedPidsByUid() {
        return new Map<number, Set<number>>();
    },
};

const containerKindsStub = {
    __esModule: true as const,
    async assertContainerProblemKinds() {
        return undefined;
    },
};

const studentDirectoryStub = {
    __esModule: true as const,
    studentDirectory() {
        return {
            async listUserGroups() {
                return [];
            },
        };
    },
};

function throwingModule(label: string): Record<string, unknown> {
    const stub: Record<string, unknown> = { __esModule: true };
    const proxy: Record<string, unknown> = new Proxy(stub, {
        get(target, prop, receiver) {
            if (typeof prop === 'symbol' || prop in target) return Reflect.get(target, prop, receiver);
            return () => {
                throw new Error(`unstubbed ${label}.${String(prop)}`);
            };
        },
    });
    stub.default = proxy;
    return proxy;
}

function handlerStub(request: string): unknown {
    if (request === '../service/server') return serverStub;
    if (request === './contest') return contestHandlerStub;
    if (request === '../model/contest') return contestStub;
    if (request === '../model/problem') return problemStub;
    if (request === '../model/training') return trainingStub;
    if (request === '../model/user') return userStub;
    if (request === '../model/practice-integrity') return practiceIntegrityStub;
    if (request === '../model/practice-integrity-access') return practiceAccessStub;
    if (request === '../model/contextual-completion') return contextualStub;
    if (request === '../model/problem-set-access') return problemSetAccessStub;
    if (request === '../model/discussion') return discussionStub;
    if (request === '../model/solution') return solutionStub;
    if (request === '../model/record') return recordStub;
    if (request === '../model/builtin') return null;
    if (request === './problem-reference') return problemReferenceStub;
    if (request === '../lib/practice-roster-load') return rosterLoadStub;
    if (request === '../lib/container-problem-kinds') return containerKindsStub;
    if (request === '../service/student-directory') return studentDirectoryStub;
    if (request.startsWith('../model/') || request.startsWith('../service/')) return throwingModule(request);
    return null;
}

const problemPath = require.resolve('../src/handler/problem.ts');
const trainingPath = require.resolve('../src/handler/training.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule | null | undefined, isMain: boolean) {
    if (parent?.filename === problemPath || parent?.filename === trainingPath) {
        const stub = handlerStub(request);
        if (stub) return stub;
    }
    return originalLoad.call(this, request, parent, isMain);
};

interface ProblemHooksModule {
    ProblemDetailHandler: new () => DetailHandler;
}

interface TrainingModule {
    apply: (ctx: {
        Route: (name: string, routePath: string, HandlerClass: new () => TrainingDetail) => void;
    }) => Promise<void>;
}

let problemHooks: ProblemHooksModule;
let TrainingDetailHandler: new () => TrainingDetail;
try {
    delete require.cache[problemPath];
    delete require.cache[trainingPath];
    problemHooks = require(problemPath) as ProblemHooksModule;
    const trainingModule = require(trainingPath) as TrainingModule;
    const routes = new Map<string, new () => TrainingDetail>();
    void trainingModule.apply({
        Route(name, _routePath, HandlerClass) {
            routes.set(name, HandlerClass);
        },
    });
    const registered = routes.get('training_detail');
    if (!registered) throw new Error('TrainingDetailHandler was not registered');
    TrainingDetailHandler = registered;
} finally {
    Module._load = originalLoad;
}

function actor(): Actor {
    return {
        _id: 42,
        _problemAclDomainId: DOMAIN,
        group: [],
        hasPerm() {
            return false;
        },
        hasPriv() {
            return false;
        },
        own() {
            return false;
        },
    };
}

function bindContext<T extends { domain: { _id: string }; user: Actor; response: DetailHandler['response']; request: { json: boolean }; ctx: DetailHandler['ctx']; UiContext: Record<string, unknown>; url: DetailHandler['url'] }>(
    handler: T,
): T {
    handler.domain = { _id: DOMAIN };
    handler.user = actor();
    handler.response = { body: {} };
    handler.request = { json: true };
    handler.ctx = {
        parallel: async () => undefined,
        setting: { get: () => undefined },
        i18n: { langs: () => [] },
    };
    handler.UiContext = {};
    handler.url = (name: string, args?: Record<string, unknown>) => {
        if (name === 'training_detail') return `/problem-sets/${String(args?.tid ?? TID)}`;
        if (name === 'problem_detail') return `/p/${String(args?.pid ?? '')}`;
        return `/${name}`;
    };
    return handler;
}

interface PracticeEntry {
    practiceContainerKind?: string;
    practiceContainerId?: ObjectId;
    practiceScopeKind?: string;
    practiceScopeId?: number;
}

async function openProblem(pid: number, entry: PracticeEntry = {}): Promise<DetailHandler> {
    const handler = bindContext(new problemHooks.ProblemDetailHandler());
    handler.checkPriv = () => undefined;
    await handler._prepare(
        'forged',
        pid,
        undefined,
        entry.practiceContainerKind ?? '',
        entry.practiceContainerId,
        entry.practiceScopeKind ?? '',
        entry.practiceScopeId,
        false,
        false,
    );
    await handler.get();
    return handler;
}

async function openTraining(): Promise<TrainingDetail> {
    const handler = bindContext(new TrainingDetailHandler());
    await handler.get('forged', TRAINING_ID);
    return handler;
}

function readCount(body: Record<string, unknown>, key: string): number {
    const value = body[key];
    expect(value).to.be.a('number');
    if (typeof value !== 'number') throw new TypeError(`${key} missing`);
    return value;
}

beforeEach(() => {
    fixture = freshFixture();
});

describe('practice bar payload', { concurrency: false }, () => {
    describe('buildPracticeBar', () => {
        it('places problem 1002 at index 2 with neighbor links', () => {
            const buildPracticeBar = loadBuildPracticeBar();
            const bar = requireBar(buildPracticeBar(barInput(1002, new Set(STAGE_PIDS))));
            expect(bar.index).to.equal(2);
            expect(bar.total).to.equal(3);
            expect(bar.title).to.equal('入门练习');
            expect(bar.stageTitle).to.equal('阶段 A');
            expect(bar.href).to.equal(`${detailUrl()}?chapter=${STAGE_ID}`);
            expect(bar.doneCount).to.equal(4);
            expect(bar.totalCount).to.equal(9);
            const prevHref = requireString(bar.prevHref, 'prevHref');
            expect(prevHref).to.include('/p/1001');
            expect(prevHref).to.include('practiceScopeId=');
            const nextHref = requireString(bar.nextHref, 'nextHref');
            expect(nextHref).to.include('/p/1003');
            expect(nextHref).to.include('practiceScopeId=');
        });

        it('leaves the first problem without a previous link and the last without a next link', () => {
            const buildPracticeBar = loadBuildPracticeBar();
            const visible = new Set(STAGE_PIDS);
            const first = requireBar(buildPracticeBar(barInput(1001, visible)));
            expect(first.prevHref).to.equal(null);
            const firstNext = requireString(first.nextHref, 'nextHref');
            expect(firstNext).to.include('/p/1002');
            const last = requireBar(buildPracticeBar(barInput(1003, visible)));
            expect(last.nextHref).to.equal(null);
            const lastPrev = requireString(last.prevHref, 'prevHref');
            expect(lastPrev).to.include('/p/1002');
        });

        it('renumbers a later problem when an earlier problem is hidden', () => {
            const buildPracticeBar = loadBuildPracticeBar();
            const bar = requireBar(buildPracticeBar(barInput(1003, new Set([1001, 1003]))));
            expect(bar.index).to.equal(2);
            expect(bar.total).to.equal(2);
            const prevHref = requireString(bar.prevHref, 'prevHref');
            expect(prevHref).to.include('/p/1001');
            expect(bar.nextHref).to.equal(null);
        });

        it('returns null when the problem is outside the visible stage', () => {
            const buildPracticeBar = loadBuildPracticeBar();
            expect(buildPracticeBar(barInput(1099, new Set([1099, ...STAGE_PIDS])))).to.equal(null);
            expect(buildPracticeBar(barInput(1002, new Set([1001, 1003])))).to.equal(null);
        });
    });

    describe('problem detail practiceBar', () => {
        it('omits practiceBar on a course entry', async () => {
            const handler = await openProblem(1002, {
                practiceContainerKind: 'course',
                practiceContainerId: COURSE_ID,
                practiceScopeKind: 'chapter',
                practiceScopeId: 2,
            });
            expect(handler.response.body).to.not.have.property('practiceBar');
        });

        it('omits practiceBar on an ordinary problem page', async () => {
            const handler = await openProblem(1002);
            expect(handler.response.body).to.not.have.property('practiceBar');
        });

        it('omits practiceBar when the practice context bypasses integrity', async () => {
            fixture.allowPreview = true;
            const handler = await openProblem(1002, {
                practiceContainerKind: 'problemSet',
                practiceContainerId: TRAINING_ID,
                practiceScopeKind: 'stage',
                practiceScopeId: STAGE_ID,
            });
            expect(handler.response.body.practiceIntegrity).to.include({ bypassed: true });
            expect(handler.response.body).to.not.have.property('practiceBar');
        });

        it('omits practiceBar when the problem is not in the stage', async () => {
            const handler = await openProblem(1099, {
                practiceContainerKind: 'problemSet',
                practiceContainerId: TRAINING_ID,
                practiceScopeKind: 'stage',
                practiceScopeId: STAGE_ID,
            });
            expect(handler.response.body).to.not.have.property('practiceBar');
        });

        it('returns a problem-set practiceBar whose doneCount matches the training detail', async () => {
            const training = await openTraining();
            const completed = readCount(training.response.body, 'completedProblemCount');
            const total = readCount(training.response.body, 'totalProblemCount');
            expect(completed).to.equal(1);
            expect(total).to.equal(3);
            const handler = await openProblem(1002, {
                practiceContainerKind: 'problemSet',
                practiceContainerId: TRAINING_ID,
                practiceScopeKind: 'stage',
                practiceScopeId: STAGE_ID,
            });
            expect(handler.response.body).to.have.property('practiceBar');
            expect(handler.response.body.practiceBar).to.include({
                doneCount: completed,
                totalCount: total,
            });
        });
    });
});
