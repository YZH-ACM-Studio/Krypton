import { Time } from '@hydrooj/utils/lib/utils';
import { expect } from 'chai';
import yaml from 'js-yaml';
import { ObjectId } from 'mongodb';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';

const hydroHost = globalThis as unknown as {
    Hydro?: { model: Record<string, unknown> };
};
if (!hydroHost.Hydro) hydroHost.Hydro = { model: {} };
if (!hydroHost.Hydro.model) hydroHost.Hydro.model = {};

const Module = require('node:module') as {
    _load: (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
};
const { PERM } = require('../src/model/builtin') as {
    PERM: { PERM_ATTEND_HOMEWORK: bigint };
};
const { ContestNotFoundError } = require('../src/error') as {
    ContestNotFoundError: new (domainId: string, contestId: ObjectId) => Error;
};

const DOMAIN = 'system';
const FORGED_DOMAIN = 'forged-domain';
const UID = 42;
const tid = new ObjectId('64b0000000000000000000d3');
const HOUR = Time.hour;
const CLOSED_MESSAGE = '现在不能作答这份作业。';
const workspacePath = path.resolve(__dirname, '../src/handler/homework-workspace.ts');
const kindPath = path.resolve(__dirname, '../src/lib/homework-kind-submit.ts');
const paperDraftPath = path.resolve(__dirname, '../src/model/paper-draft.ts');

interface ClockDoc {
    domainId: string;
    docId: ObjectId;
    owner: number;
    rule: string;
    title: string;
    pids: number[];
    beginAt: Date;
    endAt: Date;
    duration?: number;
}

interface StatusDoc {
    attend?: number;
    startAt?: Date | null;
}

interface ProblemFixture {
    docId: number;
    pid: number;
    domainId: string;
    title: string;
    problemKind: string;
    config: { type: string };
}

interface StoredDraft {
    pid: number;
    answers: Record<string, string | string[]> | null;
    submittedAnswers: Record<string, string | string[]> | null;
    updatedAt: Date;
}

interface TestUser {
    _id: number;
    hasPerm: (perm: bigint) => boolean;
    hasPriv: (priv: number) => boolean;
    own: (doc: { owner?: number }) => boolean;
}

interface BoundHandler {
    domain: { _id: string };
    user: TestUser;
    response: { body: Record<string, unknown> };
    request: { ip: string; body: Record<string, unknown>; query: Record<string, unknown> };
    args: Record<string, unknown>;
    checkPerm: (perm: bigint) => void;
    prepare: (domainId: string, id: ObjectId) => Promise<unknown>;
    get: (domainId: string, id: ObjectId) => Promise<unknown>;
    post: (domainId: string, id: ObjectId, third: string | number, fourth?: string) => Promise<unknown>;
}

interface RouteEntry {
    path: string;
    Handler: new () => BoundHandler;
}

interface WorkspaceModule {
    apply: (ctx: {
        Route: (name: string, routePath: string, HandlerClass: new () => BoundHandler, perm?: unknown) => void;
        inject?: (
            deps: unknown,
            callback: (ctx: { Route: (name: string, routePath: string, HandlerClass: new () => BoundHandler) => void }) => unknown,
        ) => unknown;
    }) => unknown;
}

interface KindDraft {
    answers: Record<string, string | string[]> | null;
    submittedAnswers: Record<string, string | string[]> | null;
}

interface KindSubmission {
    pid: number;
    answers: Record<string, string | string[]>;
    code: string;
    manual: boolean;
}

interface KindModule {
    selectKindSubmissions: (input: {
        pids: readonly number[];
        kindOf: (pid: number) => string;
        drafts: ReadonlyMap<number, KindDraft>;
        kind: string;
    }) => KindSubmission[];
    canonicalJson: (value: unknown) => string;
}

interface IdCall {
    domainId: string;
    tid: ObjectId;
    uid?: number;
}

interface RecordAdd {
    domainId: string;
    pid: number;
    uid: number;
    lang: string;
    code: string;
    addTask: boolean;
    contest?: ObjectId;
    type?: string;
}

interface MarkCall {
    domainId: string;
    tid: ObjectId;
    uid: number;
    pid: number;
    answers: unknown;
}

interface ManualCall {
    domainId: string;
    tid: ObjectId;
    pid: number;
    uid: number;
    rid: ObjectId;
}

interface UpsertCall {
    domainId: string;
    tid: ObjectId;
    pid: number;
    uid: number;
    answers: unknown;
}

interface DraftWrite {
    name: string;
    filter: unknown;
    update: unknown;
}

interface ErrorView {
    name: string;
    field: string;
    text: string;
}

const problems = new Map<number, ProblemFixture>([
    [11, problem(11, 'single', 'objective', '单选一')],
    [12, problem(12, 'single', 'objective', '单选二')],
    [13, problem(13, 'programming', 'default', '编程')],
    [14, problem(14, 'subjective', 'objective', '主观')],
    [15, problem(15, 'multi', 'objective', '多选')],
    [16, problem(16, 'single', 'objective', '单选空')],
]);

let current: ClockDoc | null = null;
let status: StatusDoc = { attend: 1 };
let hideHomework = false;
let draftRows: StoredDraft[] = [];
const contestGets: IdCall[] = [];
const statusGets: IdCall[] = [];
const accessCalls: IdCall[] = [];
const attendCalls: IdCall[] = [];
const statusUpdates: Array<{ domainId: string; tid: ObjectId; uid: number; rid: ObjectId; pid: number }> = [];
const draftReads: IdCall[] = [];
const upsertCalls: UpsertCall[] = [];
const markCalls: MarkCall[] = [];
const manualCalls: ManualCall[] = [];
const recordAdds: RecordAdd[] = [];
const recordRids: ObjectId[] = [];
const permChecks: bigint[] = [];
const infoCalls: unknown[][] = [];
const trace: string[] = [];
const draftWrites: DraftWrite[] = [];

function problem(pid: number, problemKind: string, type: string, title: string): ProblemFixture {
    return {
        docId: pid,
        pid,
        domainId: DOMAIN,
        title,
        problemKind,
        config: { type },
    };
}

function openHomework(extra: Partial<ClockDoc> = {}): ClockDoc {
    const now = Date.now();
    return {
        domainId: DOMAIN,
        docId: tid,
        owner: 7,
        rule: 'homework',
        title: '作业',
        pids: [11, 12, 13, 14, 15, 16],
        beginAt: new Date(now - HOUR),
        endAt: new Date(now + 4 * HOUR),
        ...extra,
    };
}

function homeworkStartRequired(tdoc: ClockDoc, tsdoc?: StatusDoc | null): boolean {
    return tdoc.rule === 'homework' && typeof tdoc.duration === 'number' && tdoc.duration > 0 && !tsdoc?.startAt;
}

function isOngoing(tdoc: ClockDoc, tsdoc?: StatusDoc | null): boolean {
    const now = new Date();
    if (tsdoc && homeworkStartRequired(tdoc, tsdoc)) return false;
    if (
        tsdoc &&
        tdoc.duration &&
        tsdoc.startAt instanceof Date &&
        tsdoc.startAt <= new Date(Date.now() - Math.floor(tdoc.duration * HOUR))
    ) {
        return false;
    }
    return tdoc.beginAt <= now && now < tdoc.endAt;
}

function sameFile(filename: string | undefined, expected: string): boolean {
    if (!filename) return false;
    return path.resolve(filename) === path.resolve(expected);
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function errorView(error: unknown): ErrorView {
    if (!error || typeof error !== 'object') return { name: '', field: '', text: '' };
    const named = error as { name?: unknown; params?: unknown };
    const params = Array.isArray(named.params) ? named.params : [];
    const field = typeof params[0] === 'string' ? params[0] : '';
    const text = params.length >= 3 ? String(params[2]) : '';
    return {
        name: typeof named.name === 'string' ? named.name : '',
        field,
        text,
    };
}

function seen(value: unknown, expected: unknown): boolean {
    if (expected instanceof ObjectId) {
        if (value instanceof ObjectId && value.equals(expected)) return true;
        if (typeof value === 'string' && value.includes(expected.toHexString())) return true;
    } else if (typeof expected === 'number') {
        if (value === expected) return true;
        if (typeof value === 'string' && value.split(/[^0-9]+/).includes(String(expected))) return true;
    } else if (typeof expected === 'string') {
        if (value === expected || (typeof value === 'string' && value.includes(expected))) return true;
    } else if (value === expected) {
        return true;
    }
    if (Array.isArray(value)) return value.some((item) => seen(item, expected));
    if (value instanceof ObjectId || value instanceof Date) return false;
    if (value && typeof value === 'object') {
        const entries: unknown[] = Object.values(value as Record<string, unknown>);
        return entries.some((item) => seen(item, expected));
    }
    return false;
}

function clearWrites(): void {
    contestGets.length = 0;
    statusGets.length = 0;
    accessCalls.length = 0;
    attendCalls.length = 0;
    statusUpdates.length = 0;
    draftReads.length = 0;
    upsertCalls.length = 0;
    markCalls.length = 0;
    manualCalls.length = 0;
    recordAdds.length = 0;
    recordRids.length = 0;
    permChecks.length = 0;
    infoCalls.length = 0;
    trace.length = 0;
    draftWrites.length = 0;
}

function noopDecorator() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}

class CapturingLogger {
    info(...args: unknown[]) {
        infoCalls.push(args);
    }

    error() {
        return undefined;
    }

    warn() {
        return undefined;
    }

    debug() {
        return undefined;
    }
}

const contestStub = {
    async get(domainId: string, id: ObjectId) {
        contestGets.push({ domainId, tid: id });
        trace.push('get');
        if (!current || !id.equals(current.docId)) return null;
        return current;
    },
    async getStatus(domainId: string, id: ObjectId, uid: number) {
        statusGets.push({ domainId, tid: id, uid });
        trace.push('getStatus');
        return status;
    },
    isOngoing,
    async attend(domainId: string, id: ObjectId, uid: number) {
        attendCalls.push({ domainId, tid: id, uid });
        trace.push('attend');
    },
    async updateStatus(domainId: string, id: ObjectId, uid: number, rid: ObjectId, pid: number) {
        statusUpdates.push({ domainId, tid: id, uid, rid, pid });
        trace.push('updateStatus');
    },
};

const paperDraftStub = {
    async getDraftsForUser(domainId: string, id: ObjectId, uid: number) {
        draftReads.push({ domainId, tid: id, uid });
        if (uid !== UID || !id.equals(tid)) return [];
        return draftRows.map((row) => ({
            domainId,
            tid: id,
            uid,
            pid: row.pid,
            answers: row.answers,
            submittedAnswers: row.submittedAnswers,
            updatedAt: row.updatedAt,
            createdAt: row.updatedAt,
            lockedKinds: [],
            problemFingerprint: 'fp',
        }));
    },
    async upsertDraft(domainId: string, id: ObjectId, pid: number, uid: number, payload: unknown) {
        const record = asRecord(payload);
        upsertCalls.push({
            domainId,
            tid: id,
            pid,
            uid,
            answers: record ? record.answers : undefined,
        });
        return { updatedAt: new Date() };
    },
    async markDraftSubmitted(domainId: string, id: ObjectId, uid: number, pid: number, answers: unknown) {
        markCalls.push({ domainId, tid: id, uid, pid, answers });
        trace.push('mark');
    },
};

const recordStub = {
    async add(
        domainId: string,
        pid: number,
        uid: number,
        lang: string,
        code: string,
        addTask: boolean,
        extra?: { contest?: ObjectId; type?: string },
    ) {
        recordAdds.push({
            domainId,
            pid,
            uid,
            lang,
            code,
            addTask,
            contest: extra?.contest,
            type: extra?.type,
        });
        const rid = new ObjectId();
        recordRids.push(rid);
        trace.push('record');
        return rid;
    },
};

const problemStub = {
    async get(domainId: string, pid: number) {
        const found = domainId === DOMAIN ? problems.get(pid) : undefined;
        return found ?? null;
    },
    async getList(domainId: string, pids: readonly number[]) {
        const dict: Record<number, ProblemFixture> = {};
        if (domainId !== DOMAIN) return dict;
        for (const pid of pids) {
            const found = problems.get(pid);
            if (found) dict[pid] = found;
        }
        return dict;
    },
};

const problemAccessStub = {
    async readContextViewableProblems(
        domainId: string,
        _user: unknown,
        pids: readonly number[],
        _context?: unknown,
        adapters?: { readContainer?: (ids: readonly number[]) => Promise<unknown> },
    ) {
        if (adapters && typeof adapters.readContainer === 'function') return await adapters.readContainer(pids);
        if (domainId !== DOMAIN) return [];
        return pids.flatMap((pid) => {
            const found = problems.get(pid);
            return found ? [found] : [];
        });
    },
};

const manualGradeStub = {
    async markManualPending(input: ManualCall) {
        manualCalls.push(input);
        trace.push('manual');
    },
};

const contestHandlerStub = {
    async assertHomeworkAccessOrHide(domainId: string, tdoc: { docId: ObjectId }, user: { _id: number }) {
        accessCalls.push({ domainId, tid: tdoc.docId, uid: user._id });
        trace.push('access');
        if (hideHomework) throw new ContestNotFoundError(domainId, tdoc.docId);
    },
};

const serverStub = {
    Handler: class Handler {},
    param: noopDecorator,
    post: noopDecorator,
    route: noopDecorator,
    get: noopDecorator,
    query: noopDecorator,
    Types: new Proxy({}, { get: () => () => ({}) }),
};

function workspaceStub(request: string): unknown {
    if (request === '../service/server' || request === '../service/server.ts') return serverStub;
    if (request === '../model/contest' || request === '../model/contest.ts') return contestStub;
    if (request === '../model/paper-draft' || request === '../model/paper-draft.ts') return paperDraftStub;
    if (request === '../model/record' || request === '../model/record.ts') return recordStub;
    if (request === '../model/problem' || request === '../model/problem.ts') return problemStub;
    if (request === '../model/problem-access' || request === '../model/problem-access.ts') return problemAccessStub;
    if (request === '../model/manual-grade' || request === '../model/manual-grade.ts') return manualGradeStub;
    if (request === './contest' || request === './contest.ts' || request === '../handler/contest' || request === '../handler/contest.ts') {
        return contestHandlerStub;
    }
    if (request === '@hydrooj/utils') return { Logger: CapturingLogger, Time };
    if (request === '../logger' || request === '../logger.ts') return { Logger: CapturingLogger };
    return null;
}

function makeColl(name: string) {
    return {
        async createIndex() {
            return name;
        },
        async updateOne(filter: unknown, update: unknown) {
            draftWrites.push({ name, filter, update });
        },
        async findOneAndUpdate(filter: unknown, update: unknown) {
            draftWrites.push({ name, filter, update });
            return null;
        },
        async findOne() {
            return null;
        },
        find() {
            return { toArray: async () => [] };
        },
        async updateMany() {
            return { matchedCount: 0 };
        },
        async deleteMany() {
            return { deletedCount: 0 };
        },
    };
}

const draftDb = {
    collection(name: string) {
        return makeColl(name);
    },
};

const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule | null | undefined, isMain: boolean) {
    if (sameFile(parent?.filename, workspacePath)) {
        const stub = workspaceStub(request);
        if (stub) return stub;
    }
    if (sameFile(parent?.filename, paperDraftPath) && (request === '../service/db' || request === '../service/db.ts')) return draftDb;
    return originalLoad.call(this, request, parent, isMain);
};

function loadKind(): KindModule {
    const loaded: unknown = require(kindPath);
    if (!loaded || typeof loaded !== 'object') throw new TypeError('homework-kind-submit.ts must export selectKindSubmissions');
    return loaded as KindModule;
}

function loadWorkspace(): WorkspaceModule {
    delete require.cache[workspacePath];
    const loaded: unknown = require(workspacePath);
    if (!loaded || typeof loaded !== 'object') throw new TypeError('homework-workspace.ts must export apply');
    return loaded as WorkspaceModule;
}

function loadDraftModel(): { markDraftSubmitted?: unknown } {
    delete require.cache[paperDraftPath];
    const loaded: unknown = require(paperDraftPath);
    if (!loaded || typeof loaded !== 'object') throw new TypeError('paper-draft.ts must export markDraftSubmitted');
    return loaded as { markDraftSubmitted?: unknown };
}

async function registeredRoutes(): Promise<Record<string, RouteEntry>> {
    const workspace = loadWorkspace();
    if (typeof workspace.apply !== 'function') throw new TypeError('homework-workspace.ts must export apply');
    const found: Record<string, RouteEntry> = {};
    const note = (name: string, routePath: string, HandlerClass: new () => BoundHandler) => {
        found[name] = { path: routePath, Handler: HandlerClass };
    };
    await workspace.apply({
        Route: note,
        async inject(_deps, callback) {
            await callback({ Route: note });
        },
    });
    return found;
}

function bind(handler: BoundHandler): BoundHandler {
    handler.domain = { _id: DOMAIN };
    handler.user = {
        _id: UID,
        hasPerm: () => true,
        hasPriv: () => false,
        own: () => false,
    };
    handler.response = { body: {} };
    handler.request = { ip: '127.0.0.1', body: {}, query: {} };
    handler.args = {};
    handler.checkPerm = (perm: bigint) => {
        permChecks.push(perm);
        trace.push('perm');
    };
    return handler;
}

async function openHandler(routeName: string): Promise<BoundHandler> {
    const routes = await registeredRoutes();
    const entry = routes[routeName];
    if (!entry) throw new TypeError(`missing route ${routeName}`);
    return bind(new entry.Handler());
}

async function handlerFor(routeName: string): Promise<BoundHandler> {
    const handler = await openHandler(routeName);
    await handler.prepare(FORGED_DOMAIN, tid);
    return handler;
}

async function catchError(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run();
        return undefined;
    } catch (error) {
        return error;
    }
}

function expectLogged(kindName: string, count: number) {
    expect(infoCalls).to.have.length(1);
    const args = infoCalls[0];
    expect(seen(args, DOMAIN)).to.equal(true);
    expect(seen(args, UID)).to.equal(true);
    expect(seen(args, tid)).to.equal(true);
    expect(seen(args, kindName)).to.equal(true);
    expect(seen(args, count)).to.equal(true);
}

function expectNoWrites() {
    expect(recordAdds).to.have.length(0);
    expect(markCalls).to.have.length(0);
    expect(manualCalls).to.have.length(0);
    expect(upsertCalls).to.have.length(0);
    expect(attendCalls).to.have.length(0);
}

beforeEach(() => {
    clearWrites();
    hideHomework = false;
    current = openHomework();
    status = { attend: 1 };
    draftRows = [];
});

describe('homework kind submit', { concurrency: false, timeout: 60_000 }, () => {
    it('canonicalizes keys and treats reordered array answers as the same submission', () => {
        const kind = loadKind();
        expect(typeof kind.canonicalJson).to.equal('function');
        expect(typeof kind.selectKindSubmissions).to.equal('function');
        expect(kind.canonicalJson({ b: '1', a: ['B', 'A'] })).to.equal(kind.canonicalJson({ a: ['A', 'B'], b: '1' }));
        expect(kind.canonicalJson({ a: 'B' })).to.not.equal(kind.canonicalJson(null));
        const sameArrays = new Map<number, KindDraft>([
            [15, { answers: { picks: ['B', 'A'] }, submittedAnswers: { picks: ['A', 'B'] } }],
        ]);
        expect(kind.selectKindSubmissions({
            pids: [15],
            kindOf: () => 'multi',
            drafts: sameArrays,
            kind: 'multi',
        })).to.deep.equal([]);
        const sameKeys = new Map<number, KindDraft>([
            [11, { answers: { b: '1', a: '2' }, submittedAnswers: { a: '2', b: '1' } }],
        ]);
        expect(kind.selectKindSubmissions({
            pids: [11],
            kindOf: () => 'single',
            drafts: sameKeys,
            kind: 'single',
        })).to.deep.equal([]);
        const selected = kind.selectKindSubmissions({
            pids: [13, 11, 15, 16],
            kindOf: (pid) => problems.get(pid)?.problemKind ?? 'programming',
            drafts: new Map<number, KindDraft>([
                [11, { answers: { z: '1', a: '2' }, submittedAnswers: null }],
                [15, { answers: { picks: ['B', 'A'] }, submittedAnswers: null }],
                [16, { answers: {}, submittedAnswers: null }],
            ]),
            kind: 'single',
        });
        expect(selected).to.deep.equal([
            {
                pid: 11,
                answers: { z: '1', a: '2' },
                code: yaml.dump({ z: '1', a: '2' }),
                manual: false,
            },
        ]);
        const subjective = kind.selectKindSubmissions({
            pids: [14],
            kindOf: () => 'subjective',
            drafts: new Map<number, KindDraft>([
                [14, { answers: { main: '第一行\r\n第二行' }, submittedAnswers: null }],
            ]),
            kind: 'subjective',
        });
        expect(subjective).to.deep.equal([
            {
                pid: 14,
                answers: { main: '第一行\r\n第二行' },
                code: '第一行\r\n第二行',
                manual: true,
            },
        ]);
    });

    it('sets submittedAnswers and updatedAt when a draft is marked submitted', async () => {
        const started = Date.now();
        const draft = loadDraftModel();
        expect(typeof draft.markDraftSubmitted).to.equal('function');
        const mark = draft.markDraftSubmitted as (
            domainId: string,
            id: ObjectId,
            uid: number,
            pid: number,
            answers: Record<string, string | string[]>,
        ) => Promise<unknown>;
        await mark(DOMAIN, tid, UID, 11, { choice: 'B' });
        expect(draftWrites).to.have.length(1);
        expect(draftWrites[0].name).to.equal('vigil.paper_draft');
        const filter = asRecord(draftWrites[0].filter);
        const update = asRecord(draftWrites[0].update);
        const set = update ? asRecord(update.$set) : null;
        expect(filter?.domainId).to.equal(DOMAIN);
        expect(filter?.tid instanceof ObjectId && filter.tid.equals(tid)).to.equal(true);
        expect(filter?.uid).to.equal(UID);
        expect(filter?.pid).to.equal(11);
        expect(set?.submittedAnswers).to.deep.equal({ choice: 'B' });
        expect(set?.updatedAt).to.be.instanceOf(Date);
        const updatedAt = set?.updatedAt instanceof Date ? set.updatedAt.getTime() : Number.NaN;
        expect(updatedAt).to.be.at.least(started);
        expect(updatedAt).to.be.at.most(Date.now() + 1000);
    });

    it('registers draft list, draft upsert, and kind submit routes', async () => {
        const routes = await registeredRoutes();
        expect(routes.homework_draft_list?.path).to.equal('/homework/:tid/draft');
        expect(routes.homework_draft_upsert?.path).to.equal('/homework/:tid/draft/:pid');
        expect(routes.homework_submit_kind?.path).to.equal('/homework/:tid/submit-kind');
    });

    it('reports contest not found for an acm contest, a missing contest, and a hidden homework', async () => {
        current = openHomework({ rule: 'acm', title: '比赛' });
        const acmHandler = await openHandler('homework_submit_kind');
        const acmError = await catchError(() => acmHandler.prepare(FORGED_DOMAIN, tid));
        expect(acmError).to.be.instanceOf(ContestNotFoundError);
        expect(contestGets.map((call) => call.domainId)).to.deep.equal([DOMAIN]);
        expect(accessCalls).to.have.length(0);
        expect(permChecks).to.have.length(0);

        clearWrites();
        current = null;
        const missingHandler = await openHandler('homework_draft_list');
        const missing = await catchError(() => missingHandler.prepare(FORGED_DOMAIN, tid));
        expect(missing).to.be.instanceOf(ContestNotFoundError);
        expect(accessCalls).to.have.length(0);

        clearWrites();
        current = openHomework();
        hideHomework = true;
        const hiddenHandler = await openHandler('homework_draft_upsert');
        const hidden = await catchError(() => hiddenHandler.prepare(FORGED_DOMAIN, tid));
        expect(hidden).to.be.instanceOf(ContestNotFoundError);
        expect(accessCalls).to.deep.equal([{ domainId: DOMAIN, tid, uid: UID }]);
        expect(permChecks).to.have.length(0);
        expectNoWrites();
    });

    it('rejects kind submit and draft save after the deadline without writing a record', async () => {
        current = openHomework({
            beginAt: new Date(Date.now() - 2 * HOUR),
            endAt: new Date(Date.now() - 1000),
        });
        status = { attend: 0 };
        draftRows = [{ pid: 11, answers: { choice: 'B' }, submittedAnswers: null, updatedAt: new Date() }];
        const submit = await handlerFor('homework_submit_kind');
        const submitError = errorView(await catchError(() => submit.post(FORGED_DOMAIN, tid, 'single')));
        expect(submitError).to.deep.equal({ name: 'ValidationError', field: 'tid', text: CLOSED_MESSAGE });

        clearWrites();
        const save = await handlerFor('homework_draft_upsert');
        const saveError = errorView(await catchError(() => save.post(FORGED_DOMAIN, tid, 11, JSON.stringify({ choice: 'B' }))));
        expect(saveError).to.deep.equal({ name: 'ValidationError', field: 'tid', text: CLOSED_MESSAGE });
        expectNoWrites();
    });

    it('rejects kind submit before a personal timer starts', async () => {
        current = openHomework({ duration: 1 });
        status = { attend: 1 };
        draftRows = [{ pid: 11, answers: { choice: 'B' }, submittedAnswers: null, updatedAt: new Date() }];
        const handler = await handlerFor('homework_submit_kind');
        const error = errorView(await catchError(() => handler.post(FORGED_DOMAIN, tid, 'single')));
        expect(error).to.deep.equal({ name: 'ValidationError', field: 'tid', text: CLOSED_MESSAGE });
        expectNoWrites();
    });

    it('submits only the changed single-choice draft and stores those answers', async () => {
        status = { attend: 0 };
        draftRows = [
            { pid: 11, answers: { choice: 'B' }, submittedAnswers: { choice: 'A' }, updatedAt: new Date() },
            { pid: 12, answers: { choice: 'C' }, submittedAnswers: { choice: 'C' }, updatedAt: new Date() },
            { pid: 15, answers: { picks: ['A'] }, submittedAnswers: null, updatedAt: new Date() },
            { pid: 16, answers: {}, submittedAnswers: null, updatedAt: new Date() },
        ];
        const handler = await handlerFor('homework_submit_kind');
        await handler.post(FORGED_DOMAIN, tid, 'single');
        expect(contestGets[0]).to.deep.equal({ domainId: DOMAIN, tid });
        expect(accessCalls[0]).to.deep.equal({ domainId: DOMAIN, tid, uid: UID });
        expect(permChecks[0]).to.equal(PERM.PERM_ATTEND_HOMEWORK);
        expect(statusGets[0]).to.deep.equal({ domainId: DOMAIN, tid, uid: UID });
        expect(trace.indexOf('get')).to.be.at.least(0);
        expect(trace.indexOf('get')).to.be.lessThan(trace.indexOf('access'));
        expect(trace.indexOf('access')).to.be.lessThan(trace.indexOf('perm'));
        expect(trace.indexOf('perm')).to.be.lessThan(trace.indexOf('getStatus'));
        expect(attendCalls).to.deep.equal([{ domainId: DOMAIN, tid, uid: UID }]);
        expect(trace.indexOf('attend')).to.be.lessThan(trace.indexOf('record'));
        expect(recordAdds).to.deep.equal([
            {
                domainId: DOMAIN,
                pid: 11,
                uid: UID,
                lang: '_',
                code: yaml.dump({ choice: 'B' }),
                addTask: true,
                contest: tid,
                type: 'judge',
            },
        ]);
        expect(trace.indexOf('record')).to.be.lessThan(trace.indexOf('updateStatus'));
        expect(trace.indexOf('updateStatus')).to.be.lessThan(trace.indexOf('mark'));
        expect(statusUpdates).to.have.length(1);
        expect(statusUpdates[0].domainId).to.equal(DOMAIN);
        expect(statusUpdates[0].tid.equals(tid)).to.equal(true);
        expect(statusUpdates[0].uid).to.equal(UID);
        expect(statusUpdates[0].pid).to.equal(11);
        expect(statusUpdates[0].rid.equals(recordRids[0])).to.equal(true);
        expect(markCalls).to.deep.equal([{ domainId: DOMAIN, tid, uid: UID, pid: 11, answers: { choice: 'B' } }]);
        expect(manualCalls).to.have.length(0);
        expect(handler.response.body).to.deep.equal({ rids: [recordRids[0].toHexString()], count: 1 });
        expectLogged('single', 1);
    });

    it('does not create a record when multi answers are only reordered', async () => {
        draftRows = [{ pid: 15, answers: { picks: ['B', 'A'] }, submittedAnswers: { picks: ['A', 'B'] }, updatedAt: new Date() }];
        const handler = await handlerFor('homework_submit_kind');
        await handler.post(FORGED_DOMAIN, tid, 'multi');
        expect(handler.response.body).to.deep.equal({ rids: [], count: 0 });
        expect(recordAdds).to.have.length(0);
        expect(markCalls).to.have.length(0);
        expect(manualCalls).to.have.length(0);
        expectLogged('multi', 0);
    });

    it('rejects programming, program fill, and function as a kind', async () => {
        const handler = await handlerFor('homework_submit_kind');
        for (const kindName of ['programming', 'program_fill', 'function']) {
            const error = errorView(await catchError(() => handler.post(FORGED_DOMAIN, tid, kindName)));
            expect(error.name).to.equal('ValidationError');
            expect(error.field).to.equal('kind');
        }
        expectNoWrites();
    });

    it('rejects a programming pid, an outside pid, and answers that are not a string record', async () => {
        const handler = await handlerFor('homework_draft_upsert');
        const programming = errorView(await catchError(() => handler.post(FORGED_DOMAIN, tid, 13, JSON.stringify({ choice: 'B' }))));
        expect(programming.name).to.equal('ValidationError');
        expect(programming.field).to.equal('pid');
        const outside = errorView(await catchError(() => handler.post(FORGED_DOMAIN, tid, 99, JSON.stringify({ choice: 'B' }))));
        expect(outside.name).to.equal('ValidationError');
        expect(outside.field).to.equal('pid');
        for (const payload of ['[]', 'null', '"B"', '1', '{"choice":1}', '{"picks":["A",1]}']) {
            const error = errorView(await catchError(() => handler.post(FORGED_DOMAIN, tid, 11, payload)));
            expect(error.name).to.equal('ValidationError');
            expect(error.field).to.equal('answers');
        }
        expect(upsertCalls).to.have.length(0);
        expectNoWrites();
    });

    it('saves an objective draft and returns ok', async () => {
        const handler = await handlerFor('homework_draft_upsert');
        await handler.post(FORGED_DOMAIN, tid, 15, JSON.stringify({ picks: ['B', 'A'] }));
        expect(upsertCalls).to.deep.equal([
            {
                domainId: DOMAIN,
                tid,
                pid: 15,
                uid: UID,
                answers: { picks: ['B', 'A'] },
            },
        ]);
        expect(handler.response.body.ok).to.equal(true);
        const updatedAt = handler.response.body.updatedAt;
        const stamp = updatedAt instanceof Date ? updatedAt.getTime() : Date.parse(String(updatedAt));
        expect(Number.isNaN(stamp)).to.equal(false);
    });

    it('lists only this user drafts for pids in the homework', async () => {
        const listedAt = new Date('2026-04-01T00:00:00.000Z');
        draftRows = [
            { pid: 11, answers: { choice: 'B' }, submittedAnswers: null, updatedAt: listedAt },
            { pid: 99, answers: { choice: 'Z' }, submittedAnswers: { choice: 'Z' }, updatedAt: listedAt },
        ];
        const handler = await handlerFor('homework_draft_list');
        await handler.get(FORGED_DOMAIN, tid);
        expect(draftReads).to.deep.equal([{ domainId: DOMAIN, tid, uid: UID }]);
        const drafts = handler.response.body.drafts;
        expect(Array.isArray(drafts)).to.equal(true);
        const rows = Array.isArray(drafts) ? drafts : [];
        expect(rows).to.have.length(1);
        const row = asRecord(rows[0]);
        expect(row?.pid).to.equal(11);
        expect(row?.answers).to.deep.equal({ choice: 'B' });
        expect(row?.submittedAnswers).to.equal(null);
        expect(row?.updatedAt).to.be.a('string');
        expect(new Date(String(row?.updatedAt)).getTime()).to.equal(listedAt.getTime());
    });

    it('submits a subjective answer as a manual record and marks it pending', async () => {
        draftRows = [{ pid: 14, answers: { main: '第一行\r\n第二行' }, submittedAnswers: null, updatedAt: new Date() }];
        const handler = await handlerFor('homework_submit_kind');
        await handler.post(FORGED_DOMAIN, tid, 'subjective');
        expect(attendCalls).to.have.length(0);
        expect(recordAdds).to.deep.equal([
            {
                domainId: DOMAIN,
                pid: 14,
                uid: UID,
                lang: '_',
                code: '第一行\r\n第二行',
                addTask: true,
                contest: tid,
                type: 'manual',
            },
        ]);
        expect(manualCalls).to.have.length(1);
        expect(manualCalls[0].domainId).to.equal(DOMAIN);
        expect(manualCalls[0].tid.equals(tid)).to.equal(true);
        expect(manualCalls[0].pid).to.equal(14);
        expect(manualCalls[0].uid).to.equal(UID);
        expect(manualCalls[0].rid.equals(recordRids[0])).to.equal(true);
        expect(trace.indexOf('record')).to.be.at.least(0);
        expect(trace.indexOf('record')).to.be.lessThan(trace.indexOf('manual'));
        expect(markCalls).to.deep.equal([
            { domainId: DOMAIN, tid, uid: UID, pid: 14, answers: { main: '第一行\r\n第二行' } },
        ]);
        expect(handler.response.body).to.deep.equal({ rids: [recordRids[0].toHexString()], count: 1 });
        expectLogged('subjective', 1);
    });
});
