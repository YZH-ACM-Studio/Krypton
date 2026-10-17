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

const { PERM, PRIV } = require('../src/model/builtin') as {
    PERM: { PERM_EDIT_HOMEWORK: bigint; PERM_SUBMIT_PROBLEM: bigint };
    PRIV: { PRIV_EDIT_SYSTEM: number };
};

const DOMAIN = 'system';
const PID = 7;
const START_MESSAGE = '请先在作业页点「开始作答」，开始后才能看题和提交。';
const homeworkId = new ObjectId('64b0000000000000000000b2');
const hour = 60 * 60 * 1000;

const PREPARE_HANDLERS = [
    'ProblemDetailHandler',
    'ProblemSubmitHandler',
    'ProblemHackHandler',
    'ProblemManageHandler',
    'ProblemFilesHandler',
] as const;

type PrepareHandlerName = (typeof PREPARE_HANDLERS)[number];
type Role = 'student' | 'owner' | 'editor' | 'admin';

interface HomeworkDoc {
    domainId: string;
    docId: ObjectId;
    owner: number;
    rule: string;
    title: string;
    pids: number[];
    beginAt: Date;
    endAt: Date;
    duration?: number;
    participationMode?: string;
}

interface StatusDoc {
    attend?: number;
    startAt?: Date | null;
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
    nAccept: number;
    nSubmit: number;
}

interface ErrorView {
    name: string;
    field: string;
    text: string;
}

interface TestUser {
    _id: number;
    _problemAclDomainId: string;
    canBrowse: boolean;
    scope: Record<string, unknown>;
    hasPerm: (perm: bigint) => boolean;
    hasPriv: (priv: number) => boolean;
    own: (doc: { owner?: number }) => boolean;
}

interface HandlerInstance {
    domain: { _id: string };
    user: TestUser;
    tdoc?: HomeworkDoc;
    tsdoc?: StatusDoc;
    response: { body: Record<string, unknown>; template?: string; redirect?: string };
    request: { json: boolean };
    ctx: {
        parallel: () => Promise<void>;
        setting: { get: () => number };
        i18n: { langs: () => string[] };
    };
    UiContext: Record<string, unknown>;
    staffSchoolContestView: boolean;
    url: (name: string) => string;
    __prepare?: (domainId: string, tid: ObjectId) => Promise<void>;
    _prepare: (domainId: string, pid: number, tid?: ObjectId) => Promise<void>;
    prepare?: (domainId: string, tid?: ObjectId) => Promise<void>;
    post?: (
        domainId: string,
        lang: string,
        code: string,
        pretest?: boolean,
        input?: string[],
        tid?: ObjectId,
        practiceContextId?: string,
        examShell?: boolean,
    ) => Promise<void>;
    get: (...args: unknown[]) => Promise<void>;
}

interface ProblemHooksModule {
    ProblemDetailHandler: new () => HandlerInstance;
    ProblemSubmitHandler: new () => HandlerInstance;
    ProblemHackHandler: new () => HandlerInstance;
    ProblemManageHandler: new () => HandlerInstance;
    ProblemFilesHandler: new () => HandlerInstance;
    ProblemMineHandler: new () => HandlerInstance;
}

interface ClockDoc {
    rule?: string;
    duration?: number;
    beginAt: Date;
    endAt: Date;
}

interface SchoolBankCall {
    domainId: string;
    docIds: number[];
}

const problemPath = require.resolve('../src/handler/problem.ts');
const problemReads: string[] = [];
const schoolBankCalls: SchoolBankCall[] = [];
let currentProblem: ProblemRow | null = null;
let mineDocs: ProblemRow[] = [];
let schoolBankResult: number[] = [];

function errorView(error: unknown): ErrorView {
    if (!error || typeof error !== 'object') return { name: '', field: '', text: '' };
    const named = error as { name?: unknown; message?: unknown; params?: unknown };
    const params = Array.isArray(named.params) ? named.params : [];
    const field = typeof params[0] === 'string' ? params[0] : '';
    const text = params.length >= 3 ? String(params[2]) : '';
    const message = typeof named.message === 'string' ? named.message : '';
    return {
        name: typeof named.name === 'string' ? named.name : '',
        field,
        text: text || message,
    };
}

function at(offset: number): Date {
    return new Date(Date.now() + offset);
}

function homework(extra: Partial<HomeworkDoc> = {}): HomeworkDoc {
    const doc: HomeworkDoc = {
        domainId: DOMAIN,
        docId: homeworkId,
        owner: 99,
        rule: 'homework',
        title: '作业',
        pids: [PID],
        beginAt: at(-hour),
        endAt: at(4 * hour),
        duration: 1.5,
        ...extra,
    };
    if (Object.hasOwn(extra, 'duration') && typeof extra.duration !== 'number') delete doc.duration;
    return doc;
}

function problemDoc(docId = PID): ProblemRow {
    return {
        domainId: DOMAIN,
        docId,
        owner: 7,
        pid: `P${docId}`,
        title: `题目 ${docId}`,
        content: '题面',
        config: 'type: default\n',
        tag: ['math'],
        additional_file: [],
        nAccept: 0,
        nSubmit: 0,
    };
}

/** Same predicates as model/contest.ts. The real module pulls the app bus, so the handler stub keeps these copies. */
function homeworkStartRequired(tdoc: ClockDoc, tsdoc?: { startAt?: Date | null } | null): boolean {
    return tdoc.rule === 'homework' && typeof tdoc.duration === 'number' && tdoc.duration > 0 && !tsdoc?.startAt;
}

function isOngoing(tdoc: ClockDoc, tsdoc?: { startAt?: Date | null } | null): boolean {
    const now = new Date();
    if (tsdoc && homeworkStartRequired(tdoc, tsdoc)) return false;
    if (tsdoc && tdoc.duration && tsdoc.startAt && tsdoc.startAt.getTime() <= now.getTime() - Math.floor(tdoc.duration * hour)) return false;
    return tdoc.beginAt <= now && now < tdoc.endAt;
}

function isNotStarted(tdoc: ClockDoc): boolean {
    return new Date() < tdoc.beginAt;
}

function isDone(tdoc: ClockDoc, tsdoc?: { startAt?: Date | null } | null): boolean {
    if (tdoc.endAt <= new Date()) return true;
    if (tsdoc && tdoc.duration && tsdoc.startAt && tsdoc.startAt.getTime() <= Date.now() - Math.floor(tdoc.duration * hour)) return true;
    return false;
}

function cursor(docs: ProblemRow[]) {
    const value = {
        sort() {
            return value;
        },
        skip() {
            return value;
        },
        limit() {
            return value;
        },
        project() {
            return value;
        },
        hint() {
            return value;
        },
        async count() {
            return docs.length;
        },
        async toArray() {
            return docs.map((doc) => ({ ...doc, tag: [...doc.tag], additional_file: [...doc.additional_file] }));
        },
    };
    return value;
}

const contestStub = {
    __esModule: true as const,
    homeworkStartRequired,
    isOngoing,
    isNotStarted,
    isDone,
    canShowSelfRecord() {
        return false;
    },
    getParticipationMode(tdoc: { participationMode?: string } | null | undefined) {
        return tdoc?.participationMode === 'team' ? 'team' : 'individual';
    },
};

const problemStub = {
    __esModule: true as const,
    default: undefined as unknown,
    PROJECTION_PUBLIC: ['docId', 'title'],
    PROJECTION_MANAGED_BANK: ['docId', 'pid', 'title'],
    async get(domainId: string, pid: number | string) {
        problemReads.push(`${domainId}:${String(pid)}`);
        return currentProblem ? { ...currentProblem, tag: [...currentProblem.tag] } : null;
    },
    async getStatus() {
        return {};
    },
    canViewBy() {
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
    canBrowseProblemBank(user: TestUser) {
        return user.canBrowse === true;
    },
    async refreshProblemAcl() {
        return undefined;
    },
    assertProblemAclDomain() {
        return undefined;
    },
    buildProblemBankScope(user: TestUser) {
        return user.scope;
    },
    canCreateManagedProgrammingDraft() {
        return false;
    },
    getMulti() {
        return cursor(mineDocs);
    },
};
problemStub.default = problemStub;

const schoolBankStub = {
    __esModule: true as const,
    async listSchoolBankDocIds(domainId: string, docIds: number[]) {
        schoolBankCalls.push({ domainId, docIds: [...docIds] });
        return [...schoolBankResult];
    },
};

const practiceAccessStub = {
    __esModule: true as const,
    async resolveInheritedPracticeEnforcement() {
        return { prohibitExternalCodeInjection: false, removeIndependentSubmitForm: false };
    },
    canManagePracticeContainer() {
        return false;
    },
    canPreviewPracticeIntegrity() {
        return false;
    },
    async preparePracticeIssue() {
        return { primaryContainer: null };
    },
    async issuePracticeContext() {
        return { controlled: false };
    },
};

const userApi = {
    async getById(_domainId: string, uid: number) {
        return { _id: uid };
    },
};
const userStub = {
    __esModule: true as const,
    default: userApi,
    getById: userApi.getById,
};
const recordApi = {
    STAT_QUERY: {} as Record<string, unknown>,
    RECORD_GENERATE: 'generate',
    RECORD_PRETEST: 'pretest',
};
const recordStub = {
    __esModule: true as const,
    default: recordApi,
    ...recordApi,
};

const serverStub = {
    __esModule: true as const,
    Handler: class HandlerStub {},
    param: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
    post: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
    query: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
    route: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
    Query: (_schema: unknown, resolver: unknown) => resolver,
    Types: new Proxy({}, { get: () => () => ({}) }),
};

function throwingModule(label: string): Record<string, unknown> {
    const stub: Record<string, unknown> = { __esModule: true };
    const proxy = new Proxy(stub, {
        get(target, prop, receiver) {
            if (typeof prop === 'symbol' || prop in target) return Reflect.get(target, prop, receiver);
            return () => {
                throw new Error(`unstubbed ${label}.${prop}`);
            };
        },
    });
    stub.default = proxy;
    return proxy;
}

function problemHandlerStub(request: string): unknown {
    if (request === './contest') {
        return { __esModule: true, ContestDetailBaseHandler: class ContestDetailBaseHandler {}, canBrowseAssignRestrictedContests: () => false };
    }
    if (request === '../service/server') return serverStub;
    if (request === '../model/contest') return contestStub;
    if (request === '../model/problem') return problemStub;
    if (request === '../model/problem-school-bank') return schoolBankStub;
    if (request === '../model/practice-integrity-access') return practiceAccessStub;
    if (request === '../model/user') return userStub;
    if (request === '../model/record') return recordStub;
    if (request === '../model/solution') return { __esModule: true, default: { count: async () => 0 } };
    if (request === '../model/discussion') return { __esModule: true, count: async () => 0 };
    if (request === '../model/builtin') return null;
    if (request.startsWith('../model/') || request.startsWith('../service/')) return throwingModule(request);
    return null;
}

const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule | null | undefined, isMain: boolean) {
    if (request === '../model/problem-school-bank' || request.endsWith('/model/problem-school-bank')) return schoolBankStub;
    if (parent?.filename === problemPath) {
        const stub = problemHandlerStub(request);
        if (stub) return stub;
    }
    return originalLoad.call(this, request, parent, isMain);
};

delete require.cache[problemPath];
const problemHooks = require(problemPath) as ProblemHooksModule;

function makeUser(role: Role, allowSubmit = false): TestUser {
    return {
        _id: 42,
        _problemAclDomainId: DOMAIN,
        canBrowse: true,
        scope: {},
        hasPerm(perm: bigint) {
            if (allowSubmit && perm === PERM.PERM_SUBMIT_PROBLEM) return true;
            return role === 'editor' && perm === PERM.PERM_EDIT_HOMEWORK;
        },
        hasPriv(priv: number) {
            return role === 'admin' && priv === PRIV.PRIV_EDIT_SYSTEM;
        },
        own(doc: { owner?: number }) {
            return role === 'owner' && doc.owner === 99;
        },
    };
}

function bindHandler(handler: HandlerInstance, role: Role, allowSubmit = false): HandlerInstance {
    handler.domain = { _id: DOMAIN };
    handler.user = makeUser(role, allowSubmit);
    handler.response = { body: {} };
    handler.request = { json: true };
    handler.ctx = {
        parallel: async () => undefined,
        setting: { get: () => 20 },
        i18n: { langs: () => [] },
    };
    handler.UiContext = {};
    handler.staffSchoolContestView = false;
    handler.url = (name: string) => (name === 'training_main' ? '/problem-sets' : `/${name}`);
    return handler;
}

async function capture(run: () => Promise<void>): Promise<ErrorView> {
    try {
        await run();
        return { name: '', field: '', text: '' };
    } catch (error) {
        return errorView(error);
    }
}

async function prepareOnly(
    handlerName: PrepareHandlerName,
    role: Role,
    status: StatusDoc,
    extra: Partial<HomeworkDoc> = {},
): Promise<ErrorView> {
    const HandlerClass = problemHooks[handlerName];
    const handler = bindHandler(new HandlerClass(), role);
    handler.tdoc = homework(extra);
    handler.tsdoc = { ...status };
    currentProblem = problemDoc();
    problemReads.length = 0;
    try {
        if (typeof handler.__prepare === 'function') await handler.__prepare('forged', homeworkId);
        await handler._prepare('forged', PID, homeworkId);
        return { name: '', field: '', text: '' };
    } catch (error) {
        return errorView(error);
    }
}

async function openDetail(
    role: Role,
    status: StatusDoc,
    extra: Partial<HomeworkDoc> = {},
    pageName = 'homework_detail_problem',
): Promise<ErrorView> {
    const HandlerClass = problemHooks.ProblemDetailHandler;
    const handler = bindHandler(new HandlerClass(), role);
    handler.tdoc = homework(extra);
    handler.tsdoc = { ...status };
    currentProblem = problemDoc();
    problemReads.length = 0;
    try {
        if (typeof handler.__prepare === 'function') await handler.__prepare('forged', homeworkId);
        await handler._prepare('forged', PID, homeworkId);
        await handler.get();
        const actualPage = handler.response.body.page_name;
        if (handler.response.template !== 'problem_detail.html' || actualPage !== pageName) {
            return { name: 'Assertion', field: 'page', text: `${handler.response.template || ''}:${String(actualPage)}` };
        }
        return { name: '', field: '', text: '' };
    } catch (error) {
        return errorView(error);
    }
}

async function submitLive(role: Role): Promise<{ gate: ErrorView; prepare: ErrorView; post: ErrorView }> {
    const handler = bindHandler(new problemHooks.ProblemSubmitHandler(), role, true);
    handler.tdoc = homework();
    handler.tsdoc = { attend: 1 };
    currentProblem = problemDoc();
    problemReads.length = 0;
    const gate = await capture(async () => {
        if (typeof handler.__prepare === 'function') await handler.__prepare('forged', homeworkId);
        await handler._prepare('forged', PID, homeworkId);
    });
    const prepare = await capture(async () => {
        if (typeof handler.prepare !== 'function') throw new Error('submit prepare is missing');
        await handler.prepare('forged', homeworkId);
    });
    const posted = await capture(async () => {
        if (typeof handler.post !== 'function') throw new Error('submit post is missing');
        await handler.post('forged', 'cc', 'int main(){return 0;}', false, [], homeworkId, '', false);
    });
    return { gate, prepare, post: posted };
}

beforeEach(() => {
    problemReads.length = 0;
    schoolBankCalls.length = 0;
    currentProblem = problemDoc();
    mineDocs = [];
    schoolBankResult = [];
});

describe('homework problem gate and mine school bank ids', { concurrency: false }, () => {
    it('blocks an unstarted student on a timed homework before the problem is read', async () => {
        const views = [];
        for (const handlerName of PREPARE_HANDLERS) {
            const view = await prepareOnly(handlerName, 'student', { attend: 1 });
            views.push([handlerName, view.name, view.field, view.text, problemReads.slice()]);
        }
        expect(views).to.deep.equal(
            PREPARE_HANDLERS.map((handlerName) => [handlerName, 'ValidationError', 'tid', START_MESSAGE, []]),
        );
    });

    it('opens the problem after the student has started', async () => {
        const view = await openDetail('student', { attend: 1, startAt: new Date() });
        expect([view.name, view.field, view.text, problemReads.slice()]).to.deep.equal(['', '', '', [`${DOMAIN}:${PID}`]]);
    });

    it('lets the homework owner open the problem before starting', async () => {
        const view = await openDetail('owner', { attend: 1 });
        expect([view.name, view.text, problemReads.slice()]).to.deep.equal(['', '', [`${DOMAIN}:${PID}`]]);
    });

    it('lets a student open a homework that has no personal limit', async () => {
        const view = await openDetail('student', { attend: 1, startAt: new Date() }, { duration: undefined });
        expect([view.name, view.text, problemReads.slice()]).to.deep.equal(['', '', [`${DOMAIN}:${PID}`]]);
    });

    it('lets an attended student open an untimed homework before any personal start', async () => {
        const view = await openDetail('student', { attend: 1 }, { duration: undefined });
        expect([view.name, view.text, problemReads.slice()]).to.deep.equal(['', '', [`${DOMAIN}:${PID}`]]);
        expect(view.name === 'ContestNotAttendedError').to.equal(false);
        expect(view.text === START_MESSAGE).to.equal(false);
    });

    it('lets a homework editor open the problem before starting', async () => {
        const view = await openDetail('editor', { attend: 1 });
        expect([view.name, view.text, problemReads.slice()]).to.deep.equal(['', '', [`${DOMAIN}:${PID}`]]);
    });

    it('lets an owner or homework editor pass the submit live check before starting', async () => {
        const student = await capture(async () => {
            const handler = bindHandler(new problemHooks.ProblemSubmitHandler(), 'student', true);
            handler.tdoc = homework();
            handler.tsdoc = { attend: 1 };
            currentProblem = problemDoc();
            if (typeof handler.__prepare === 'function') await handler.__prepare('forged', homeworkId);
            await handler._prepare('forged', PID, homeworkId);
        });
        const managerRows = [];
        for (const role of ['owner', 'editor'] as const) {
            const stages = await submitLive(role);
            managerRows.push([role, stages.gate.name, stages.gate.text, stages.prepare.name, stages.post.name]);
        }
        expect([student.name, student.field, student.text]).to.deep.equal(['ValidationError', 'tid', START_MESSAGE]);
        expect(managerRows).to.deep.equal([
            ['owner', '', '', 'ProblemConfigError', 'ProblemConfigError'],
            ['editor', '', '', 'ProblemConfigError', 'ProblemConfigError'],
        ]);
    });

    it('does not use the start message for an admin, a closed window, or a non-homework', async () => {
        const admin = await openDetail('admin', { attend: 1 });
        const upcoming = await prepareOnly('ProblemDetailHandler', 'student', { attend: 1 }, { beginAt: at(hour), endAt: at(4 * hour) });
        const ended = await openDetail('student', { attend: 1 }, { beginAt: at(-4 * hour), endAt: at(-hour) });
        const acm = await openDetail('student', { attend: 1 }, { rule: 'acm' }, 'contest_detail_problem');
        expect([admin.name, admin.text, upcoming.text, ended.name, ended.text]).to.deep.equal([
            '',
            '',
            'This contest is not live.',
            '',
            '',
        ]);
        expect([acm.name, acm.text, problemReads.slice()]).to.deep.equal(['', '', [`${DOMAIN}:${PID}`]]);
        expect(acm.name === 'ContestNotAttendedError').to.equal(false);
        expect([admin.text, upcoming.text, ended.text, acm.text].includes(START_MESSAGE)).to.equal(false);
    });

    it('returns school bank doc ids from the stub on my problems', async () => {
        mineDocs = [problemDoc(7), problemDoc(3), problemDoc(9)];
        schoolBankResult = [9, 7];
        const handler = bindHandler(new problemHooks.ProblemMineHandler(), 'student');
        await handler.get('forged', 1);
        expect(handler.response.body.schoolBankDocIds).to.deep.equal([9, 7]);
        expect(schoolBankCalls).to.deep.equal([{ domainId: DOMAIN, docIds: [7, 3, 9] }]);
    });
});
