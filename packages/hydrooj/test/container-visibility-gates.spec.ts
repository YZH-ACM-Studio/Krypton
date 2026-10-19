import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { ContestNotFoundError } from '../src/error';
import { canUsePostContestPractice } from '../src/lib/contest-correction';
import { InMemoryStudentDirectory } from '../src/lib/testing/in-memory-student-directory';
import type { Tdoc } from '../src/interface';
import { registerStudentDirectory } from '../src/service/student-directory';

const requireFromTest = createRequire(__filename);
const Module = requireFromTest('node:module') as {
    _load: (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
};

const hydroHost = globalThis as unknown as {
    Hydro?: {
        model: Record<string, unknown>;
        ui?: Record<string, unknown>;
        module?: { hash: Record<string, unknown> };
    };
};
if (!hydroHost.Hydro) hydroHost.Hydro = { model: {} };
if (!hydroHost.Hydro.model) hydroHost.Hydro.model = {};
if (!hydroHost.Hydro.ui) hydroHost.Hydro.ui = {};
if (!hydroHost.Hydro.module) hydroHost.Hydro.module = { hash: {} };
if (!hydroHost.Hydro.module.hash) hydroHost.Hydro.module.hash = {};

const { PERM, PRIV } = requireFromTest('../src/model/builtin') as typeof import('../src/model/builtin');

const DOMAIN = 'system';
const TEACHER = 7;
const OTHER = 8;
const LIST_ADMIN = 1;
const HOUR = 60 * 60 * 1000;

const publicAcmId = new ObjectId('64b0000000000000000000e1');
const maintainedAcmId = new ObjectId('64b0000000000000000000e2');
const practiceAcmId = new ObjectId('64b0000000000000000000e3');
const courseHomeworkId = new ObjectId('64b0000000000000000000e4');
const outsideHomeworkId = new ObjectId('64b0000000000000000000e5');
const outsideGroupId = new ObjectId('64b0000000000000000000aa');

interface Actor {
    _id: number;
    group: string[];
    hasPerm: (...perm: bigint[]) => boolean;
    hasPriv: (...priv: number[]) => boolean;
    own: (doc: { owner: number; maintainer?: number[] }) => boolean;
}

interface ResponseBag {
    body: Record<string, unknown>;
    redirect?: string;
    template?: string;
}

interface DetailHandler {
    domain: { _id: string };
    user: Actor;
    response: ResponseBag;
    __prepare: (domainId: string, tid: ObjectId) => Promise<void>;
}

interface ContestListHandler {
    domain: { _id: string };
    user: Actor;
    response: ResponseBag;
    ctx: { parallel: (name: string, filter: unknown, caller: unknown) => Promise<void> };
    paginate: (cursor: unknown, page: number, key: string) => Promise<[unknown[], number]>;
    url: (name: string) => string;
    checkPerm: (perm: bigint) => void;
    get: (domainId: string, rule?: string, group?: string, page?: number, q?: string) => Promise<void>;
}

interface HomeworkListHandler {
    domain: { _id: string };
    user: Actor;
    response: ResponseBag;
    paginate: (cursor: unknown, page: number, key: string) => Promise<[unknown[], number]>;
    url: (name: string) => string;
    checkPerm: (perm: bigint) => void;
    get: (domainId: string, group?: string, page?: number, q?: string) => Promise<void>;
}

interface HomeworkDetailEntry {
    domain: { _id: string };
    user: Actor;
    response: ResponseBag;
    prepare: (domainId: string, tid: ObjectId) => Promise<void>;
}

interface ExamModeEntry {
    domain: { _id: string };
    user: Actor;
    response: ResponseBag;
    url: (name: string, args?: { tid?: ObjectId }) => string;
    get: (domainId: string, tid: ObjectId) => Promise<void>;
}

interface PaperModule {
    apply: (ctx: {
        Route: (name: string, path: string, HandlerClass: new () => object, perm?: bigint) => void;
        Connection: (name: string, path: string, HandlerClass: new () => object, priv?: number) => void;
        inject: (deps: string[], callback: (ctx: { Route: () => void }) => unknown) => unknown;
    }) => Promise<void>;
}

interface ContestHandlers {
    ContestDetailBaseHandler: new () => DetailHandler;
    ContestListHandler: new () => ContestListHandler;
}

interface HomeworkModule {
    apply: (ctx: {
        Route: (name: string, path: string, HandlerClass: new () => object, perm?: bigint) => void;
        inject: (deps: string[], callback: (ctx: { Route: () => void }) => unknown) => unknown;
    }) => Promise<void>;
}

interface CourseRow {
    dag?: { tids?: unknown[] }[];
    courseExam?: { contestId?: unknown };
}

interface RuleInfo {
    hidden: boolean;
    TEXT: string;
}

interface StatusDoc {
    attend?: number;
    startAt?: Date | null;
    clientFinishedAt?: Date;
}

const RULES: Record<string, RuleInfo> = {
    acm: { hidden: false, TEXT: 'ACM/ICPC' },
    oi: { hidden: false, TEXT: 'OI' },
    ioi: { hidden: false, TEXT: 'IOI' },
    strictioi: { hidden: false, TEXT: 'Strict IOI' },
    ledo: { hidden: false, TEXT: 'Ledo' },
    exam: { hidden: false, TEXT: 'Exam' },
    homework: { hidden: false, TEXT: 'Homework' },
};

registerStudentDirectory(new InMemoryStudentDirectory());

const contestPath = requireFromTest.resolve('../src/handler/contest.ts');
const homeworkPath = requireFromTest.resolve('../src/handler/homework.ts');
const paperPath = requireFromTest.resolve('../src/handler/paper.ts');
const visibilityPath = requireFromTest.resolve('../src/lib/container-visibility.ts');

let courses: CourseRow[] = [];
let currentDoc: Tdoc | null = null;
let currentStatus: StatusDoc | null = null;

function at(offset: number): Date {
    return new Date(Date.now() + offset);
}

function bitsOf(perms: readonly bigint[]): bigint {
    let bits = 0n;
    for (const perm of perms) bits |= perm;
    return bits;
}

function flagsOf(privs: readonly number[]): number {
    let flags = 0;
    for (const priv of privs) flags |= priv;
    return flags;
}

function makeUser(perms: readonly bigint[], privs: readonly number[] = [], uid = TEACHER): Actor {
    const permBits = bitsOf(perms);
    const privBits = flagsOf(privs);
    return {
        _id: uid,
        group: [],
        hasPerm(...wanted) {
            return wanted.some((item) => (permBits & item) === item);
        },
        hasPriv(...wanted) {
            return wanted.some((item) => (privBits & item) === item);
        },
        own(doc) {
            return doc.owner === uid || (doc.maintainer ?? []).includes(uid);
        },
    };
}

function teacher(): Actor {
    return makeUser([PERM.PERM_CREATE_CONTEST]);
}

function listAdmin(): Actor {
    return makeUser([], [PRIV.PRIV_EDIT_SYSTEM], LIST_ADMIN);
}

function baseDoc(partial: Pick<Tdoc, 'docId' | 'owner' | 'rule' | 'beginAt' | 'endAt'> & Partial<Tdoc>): Tdoc {
    return {
        _id: partial.docId,
        docId: partial.docId,
        docType: 30,
        domainId: DOMAIN,
        owner: partial.owner,
        beginAt: partial.beginAt,
        endAt: partial.endAt,
        attend: 0,
        title: 'container',
        content: '',
        rule: partial.rule,
        pids: [],
        duration: 0,
        maintainer: [],
        assign: [],
        entryMode: 'open',
        ...partial,
    };
}

function contestIsDone(tdoc: Tdoc, tsdoc?: StatusDoc | null): boolean {
    if (tdoc.endAt <= new Date()) return true;
    if (tsdoc?.startAt && tdoc.duration && tsdoc.startAt <= new Date(Date.now() - Math.floor(tdoc.duration * HOUR))) return true;
    return false;
}

function listCursor() {
    const cursor = {
        sort() {
            return cursor;
        },
    };
    return cursor;
}

const trainingStub = {
    getMulti() {
        const cursor = {
            project() {
                return cursor;
            },
            toArray() {
                return Promise.resolve(courses);
            },
        };
        return cursor;
    },
};

const contestStub = {
    __esModule: true as const,
    RULES,
    isDone: contestIsDone,
    isClientRequired(tdoc: Tdoc) {
        return tdoc.entryMode === 'client_required';
    },
    isClientFinished(tsdoc: StatusDoc | null | undefined) {
        return !!tsdoc?.clientFinishedAt;
    },
    isNotStarted(tdoc: Tdoc) {
        return new Date() < tdoc.beginAt;
    },
    isExtended() {
        return false;
    },
    isOngoing() {
        return false;
    },
    getParticipationMode(tdoc: { participationMode?: unknown } | null | undefined) {
        return tdoc?.participationMode === 'team' ? 'team' : 'individual';
    },
    async get() {
        return currentDoc;
    },
    async getStatus() {
        return currentStatus;
    },
    getMulti() {
        return listCursor();
    },
    async getListStatus() {
        return {};
    },
    listAccessQuery() {
        return {};
    },
    async resolveContestListParticipantScope() {
        return {};
    },
    parentSchoolIdsFromUser() {
        return [];
    },
    default: undefined as unknown,
};
contestStub.default = contestStub;

const userStub = {
    __esModule: true as const,
    async listGroup() {
        return [];
    },
    async getList() {
        return {};
    },
    default: undefined as unknown,
};
userStub.default = userStub;

const documentStub = {
    __esModule: true as const,
    TYPE_PROBLEM: 10,
    TYPE_CONTEST: 30,
    async set() {
        return undefined;
    },
    getMulti() {
        return listCursor();
    },
    default: undefined as unknown,
};
documentStub.default = documentStub;

const problemStub = {
    __esModule: true as const,
    PROJECTION_CONTEST_LIST: ['docId'],
    PROJECTION_PUBLIC: ['docId'],
    async getList() {
        return {};
    },
    canPublishProblem() {
        return true;
    },
    default: undefined as unknown,
};
problemStub.default = problemStub;

function noopDecorator() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}

const serverStub = {
    Handler: class HandlerStub {},
    param: noopDecorator,
    post: noopDecorator,
    Type: class TypeStub {},
    Types: new Proxy({}, { get: () => () => ({}) }),
};

const genericModel = new Proxy(
    {},
    {
        get: () => async () => undefined,
    },
);

function contestLoadStub(request: string): unknown {
    if (request === '../model/builtin' || request === '../model/homework-access') return undefined;
    if (request === '../context') return { Context: class ContextStub {}, Service: class ServiceStub {} };
    if (request === '../lib/course-exam-gate') return { async assertCourseExamWatchGate() { return undefined; } };
    if (request === '../model/contest') return contestStub;
    if (request === '../model/document') return documentStub;
    if (request === '../model/problem') return problemStub;
    if (request === '../model/user') return userStub;
    if (request === '../service/server') return serverStub;
    if (request.startsWith('../model/')) return genericModel;
    return undefined;
}

function homeworkLoadStub(request: string): unknown {
    if (request === '../model/contest') return contestStub;
    if (request === '../model/user') return userStub;
    if (request === '../service/server') return serverStub;
    if (request === '../model/discussion') return { getMulti: () => listCursor() };
    if (request === '../model/problem') return problemStub;
    if (request === '../model/problem-access') {
        return {
            async assertProblemBankSelection() {
                return undefined;
            },
            async readContextViewableProblems() {
                return [];
            },
        };
    }
    if (request === '../model/record') return { __esModule: true, default: genericModel };
    if (request === '../model/storage') return { __esModule: true, default: genericModel };
    if (request === '../model/system') return { __esModule: true, default: { get: () => 0 } };
    if (request === '../model/training') {
        return { async get() { return null; } };
    }
    if (request === '../lib/course-access') {
        return {
            canManageCourse() {
                return false;
            },
            async assertCourseAccessible() {
                return undefined;
            },
        };
    }
    return undefined;
}

function decoratorFactory() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}

const paperPassthrough = new Set([
    '../error',
    '../lib/contest-correction',
    '../lib/container-visibility',
    './contest',
    'mongodb',
    'js-yaml',
    '@hydrooj/common',
    '@hydrooj/utils',
]);

const paperGenericModules = new Map<string, unknown>();

function paperGenericModule(request: string): unknown {
    const existing = paperGenericModules.get(request);
    if (existing) return existing;
    const ctor = function paperImportStub() {
        return undefined;
    };
    const mod = new Proxy(ctor, {
        get(target, prop) {
            if (prop === '__esModule') return true;
            if (prop === 'default') return target;
            if (prop === 'prototype') return target.prototype;
            if (typeof prop === 'symbol') return undefined;
            return decoratorFactory;
        },
    });
    paperGenericModules.set(request, mod);
    return mod;
}

const paperHydroojStub = {
    __esModule: true as const,
    Handler: class PaperHandlerStub {},
    Context: class PaperContextStub {},
    param: noopDecorator,
    route: noopDecorator,
    Types: new Proxy({}, { get: () => () => ({}) }),
    PERM,
    PRIV,
    localizedErrorText(strings: TemplateStringsArray, ...values: unknown[]) {
        return String.raw({ raw: strings }, ...values.map((value) => String(value)));
    },
    NotFoundError: class NotFoundError extends Error {
        constructor(message?: unknown) {
            super(typeof message === 'string' ? message : 'NotFoundError');
            this.name = 'NotFoundError';
        }
    },
    PermissionError: class PermissionError extends Error {
        constructor(message?: unknown) {
            super(String(message));
            this.name = 'PermissionError';
        }
    },
    ValidationError: class ValidationError extends Error {
        constructor(...args: unknown[]) {
            super(String(args[2] ?? args[0] ?? 'ValidationError'));
            this.name = 'ValidationError';
        }
    },
    default: undefined as unknown,
};
paperHydroojStub.default = paperHydroojStub;

const paperServerStub = {
    __esModule: true as const,
    ConnectionHandler: class ConnectionHandlerStub {},
    subscribe: noopDecorator,
    Handler: class PaperServerHandlerStub {},
    param: noopDecorator,
    default: undefined as unknown,
};
paperServerStub.default = paperServerStub;

function paperLoadStub(request: string): unknown {
    if (paperPassthrough.has(request)) return undefined;
    if (request === '../model/contest') return contestStub;
    if (request === 'hydrooj') return paperHydroojStub;
    if (request === '../service/server') return paperServerStub;
    return paperGenericModule(request);
}

const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule | null | undefined, isMain: boolean) {
    if (parent?.filename === visibilityPath && request === '../model/training') return trainingStub;
    if (parent?.filename === contestPath) {
        const stub = contestLoadStub(request);
        if (stub !== undefined) return stub;
    }
    if (parent?.filename === homeworkPath) {
        const stub = homeworkLoadStub(request);
        if (stub !== undefined) return stub;
    }
    if (parent?.filename === paperPath) {
        const stub = paperLoadStub(request);
        if (stub !== undefined) return stub;
    }
    return originalLoad.call(this, request, parent, isMain);
};

const contestHandlers = requireFromTest(contestPath) as ContestHandlers;
const homeworkModule = requireFromTest(homeworkPath) as HomeworkModule;
const paperModule = requireFromTest(paperPath) as PaperModule;
const homeworkRoutes: Record<string, new () => HomeworkListHandler> = {};
const homeworkReady = homeworkModule.apply({
    Route(name, _path, HandlerClass) {
        homeworkRoutes[name] = HandlerClass as new () => HomeworkListHandler;
    },
    inject(_deps, callback) {
        return callback({
            Route() {
                return undefined;
            },
        });
    },
});
const paperRoutes: Record<string, new () => ExamModeEntry> = {};
const paperReady = paperModule.apply({
    Route(name, _path, HandlerClass) {
        paperRoutes[name] = HandlerClass as new () => ExamModeEntry;
    },
    Connection() {
        return undefined;
    },
    inject(_deps, callback) {
        return callback({
            Route() {
                return undefined;
            },
        });
    },
});

function trainingMainUrl(name: string): string {
    if (name === 'training_main') return '/problem-sets';
    return `/route/${name}`;
}

function bindDetail(user: Actor): DetailHandler {
    const handler = new contestHandlers.ContestDetailBaseHandler();
    handler.domain = { _id: DOMAIN };
    handler.user = user;
    handler.response = { body: {} };
    return handler;
}

function bindContestList(): ContestListHandler {
    const handler = new contestHandlers.ContestListHandler();
    handler.domain = { _id: DOMAIN };
    handler.user = listAdmin();
    handler.response = { body: {} };
    handler.ctx = {
        async parallel() {
            return undefined;
        },
    };
    handler.paginate = async () => [[], 1];
    handler.url = trainingMainUrl;
    handler.checkPerm = () => undefined;
    return handler;
}

function bindHomeworkList(): HomeworkListHandler {
    const HomeworkMain = homeworkRoutes.homework_main;
    const handler = new HomeworkMain();
    handler.domain = { _id: DOMAIN };
    handler.user = listAdmin();
    handler.response = { body: {} };
    handler.paginate = async () => [[], 1];
    handler.url = trainingMainUrl;
    handler.checkPerm = () => undefined;
    return handler;
}

function bindHomeworkDetail(user: Actor): HomeworkDetailEntry {
    const HomeworkDetail = homeworkRoutes.homework_detail as unknown as new () => HomeworkDetailEntry;
    const handler = new HomeworkDetail();
    handler.domain = { _id: DOMAIN };
    handler.user = user;
    handler.response = { body: {} };
    return handler;
}

function bindExamMode(user: Actor): ExamModeEntry {
    const ExamModeEntryHandler = paperRoutes.exam_mode_entry;
    const handler = new ExamModeEntryHandler();
    handler.domain = { _id: DOMAIN };
    handler.user = user;
    handler.response = { body: {} };
    handler.url = (name, args) => {
        if (name === 'contest_problemlist' && args?.tid) return `/contest/${args.tid.toHexString()}/problems`;
        return trainingMainUrl(name);
    };
    return handler;
}

async function openDetail(doc: Tdoc, status: StatusDoc | null, user: Actor): Promise<unknown> {
    currentDoc = doc;
    currentStatus = status;
    const handler = bindDetail(user);
    try {
        await handler.__prepare(DOMAIN, doc.docId);
        return undefined;
    } catch (error) {
        return error;
    }
}

async function openHomeworkDetail(doc: Tdoc, user: Actor): Promise<unknown> {
    currentDoc = doc;
    currentStatus = null;
    const handler = bindHomeworkDetail(user);
    try {
        await handler.prepare(DOMAIN, doc.docId);
        return undefined;
    } catch (error) {
        return error;
    }
}

async function openExamMode(doc: Tdoc, status: StatusDoc | null, user: Actor): Promise<{ error: unknown; redirect?: string }> {
    currentDoc = doc;
    currentStatus = status;
    const handler = bindExamMode(user);
    try {
        await handler.get(DOMAIN, doc.docId);
        return { error: undefined, redirect: handler.response.redirect };
    } catch (error) {
        return { error, redirect: handler.response.redirect };
    }
}

function describeThrown(error: unknown): string {
    if (error === undefined) return 'ok';
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    return String(error);
}

function assertNotFound(error: unknown, docId: ObjectId): void {
    expect(error instanceof ContestNotFoundError, describeThrown(error)).to.equal(true);
    if (!(error instanceof ContestNotFoundError)) return;
    expect(error.params[0], 'domain').to.equal(DOMAIN);
    const id = error.params[1];
    expect(id instanceof ObjectId, 'docId').to.equal(true);
    if (!(id instanceof ObjectId)) return;
    expect(id.toHexString(), 'docId hex').to.equal(docId.toHexString());
}

function clearVigil(): void {
    const host = globalThis as unknown as { Hydro?: { model?: Record<string, unknown> } };
    if (host.Hydro?.model && Object.hasOwn(host.Hydro.model, 'vigilguard')) {
        delete host.Hydro.model.vigilguard;
    }
}

function practiceCheckHasGate(source: string, callAt: number): boolean {
    const window = source.slice(Math.max(0, callAt - 4000), callAt);
    const decideAt = window.lastIndexOf('decideContainerVisibility(');
    if (decideAt < 0) return false;
    const between = window.slice(decideAt + 'decideContainerVisibility('.length);
    return !/\bfunction\b|\n[ \t]*async[ \t]+(?:function[ \t]+)?[A-Za-z_$][\w$]*[ \t]*\(/.test(between);
}

before(async () => {
    await homeworkReady;
    await paperReady;
});

beforeEach(() => {
    courses = [];
    currentDoc = null;
    currentStatus = null;
    clearVigil();
});

describe('detail gates and old list redirects', { concurrency: false }, () => {
    it('lets a teacher open an acm they maintain', async () => {
        const doc = baseDoc({
            docId: maintainedAcmId,
            owner: OTHER,
            maintainer: [TEACHER],
            rule: 'acm',
            beginAt: at(-HOUR),
            endAt: at(HOUR),
        });
        const thrown = await openDetail(doc, { attend: 0 }, teacher());
        expect(thrown, 'maintainer acm gate').to.equal(undefined);
    });

    it('rejects a teacher opening homework outside their course', async () => {
        const doc = baseDoc({
            docId: outsideHomeworkId,
            owner: OTHER,
            rule: 'homework',
            beginAt: at(-HOUR),
            endAt: at(HOUR),
            participantScopeMode: 'groups',
            participantGroupIds: [outsideGroupId],
        });
        courses = [];
        assertNotFound(await openDetail(doc, null, teacher()), outsideHomeworkId);
        assertNotFound(await openHomeworkDetail(doc, teacher()), outsideHomeworkId);
    });

    it('places decideContainerVisibility before each post-contest practice check in paper.ts', () => {
        const source = readFileSync(join(__dirname, '../src/handler/paper.ts'), 'utf8');
        const marker = 'canUsePostContestPractice(';
        const missing: string[] = [];
        let from = 0;
        let count = 0;
        while (from < source.length) {
            const callAt = source.indexOf(marker, from);
            if (callAt < 0) break;
            count += 1;
            if (!practiceCheckHasGate(source, callAt)) missing.push(source.slice(callAt, callAt + marker.length));
            from = callAt + marker.length;
        }
        expect(count > 0, 'paper practice checks').to.equal(true);
        expect(missing, 'practice checks missing decideContainerVisibility').to.deep.equal([]);
    });

    it('redirects get /contest to the problem set list', async () => {
        const handler = bindContestList();
        await handler.get(DOMAIN);
        expect(handler.response.redirect, 'contest list redirect').to.equal(handler.url('training_main'));
    });

    it('redirects get /homework to the problem set list', async () => {
        const handler = bindHomeworkList();
        await handler.get(DOMAIN);
        expect(handler.response.redirect, 'homework list redirect').to.equal(handler.url('training_main'));
    });

    it('lets a teacher open homework referenced by their course', async () => {
        const doc = baseDoc({
            docId: courseHomeworkId,
            owner: OTHER,
            rule: 'homework',
            beginAt: at(-HOUR),
            endAt: at(HOUR),
            participantScopeMode: 'groups',
            participantGroupIds: [outsideGroupId],
        });
        courses = [{ dag: [{ tids: [courseHomeworkId] }] }];
        const viaContest = await openDetail(doc, null, teacher());
        expect(viaContest, 'course homework contest detail').to.equal(undefined);
        const thrown = await openHomeworkDetail(doc, teacher());
        expect(thrown, `course homework detail ${describeThrown(thrown)}`).to.equal(undefined);
    });

    it('rejects a teacher opening an ended acm while post-contest practice is open', async () => {
        const doc = baseDoc({
            docId: practiceAcmId,
            owner: OTHER,
            rule: 'acm',
            beginAt: at(-2 * HOUR),
            endAt: at(-HOUR),
            allowPostContestPractice: true,
            allowPostContestView: true,
            allowPostContestSubmit: true,
        });
        const status = { attend: 1 };
        expect(canUsePostContestPractice(doc, status), 'practice is open').to.equal(true);
        assertNotFound(await openDetail(doc, status, teacher()), practiceAcmId);
        const examMode = await openExamMode(doc, status, teacher());
        expect(examMode.redirect, `exam mode redirect before gate (${describeThrown(examMode.error)})`).to.equal(undefined);
        assertNotFound(examMode.error, practiceAcmId);
    });

    it('rejects a teacher opening another person public acm', async () => {
        const doc = baseDoc({
            docId: publicAcmId,
            owner: OTHER,
            rule: 'acm',
            beginAt: at(-HOUR),
            endAt: at(HOUR),
        });
        assertNotFound(await openDetail(doc, { attend: 0 }, teacher()), publicAcmId);
    });
});
