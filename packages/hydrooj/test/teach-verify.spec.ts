import { createRequire, type Module as NodeModule } from 'node:module';
import { after, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gradeObjectiveAnswer } from '@hydrooj/common';
import { gradeProgramFillTextSubmission, parseStructuredRegionSubmission, templateSourceHash } from '../src/lib/problem-config';
import { param, post, query, route } from '@hydrooj/framework/decorators';
import { Types } from '@hydrooj/framework/validator';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { PERM } from '@hydrooj/common/permission';
import {
    ContestNotFoundError,
    type HydroError,
    NotFoundError,
    PermissionError,
    ProblemNotAllowLanguageError,
    TrainingNotFoundError,
    ValidationError,
} from '../src/error';

// The handler is loaded at runtime. A static import fails this lane's tsc gate
// while packages/hydrooj/src/handler/teach-verify.ts is still absent.
const __filename = fileURLToPath(import.meta.url);
const requireFromTest = createRequire(__filename);

const domainId = 'school-domain';
const forgedDomainId = 'forged-domain';
const ownerUid = 42;
const studentUid = 9;
const singlePid = 101;
const otherPid = 102;
const multiPid = 201;
const mixedPid = 301;
const programPid = 401;
const outsidePid = 909009;
const fixedRid = '64b0000000000000000000aa';
const singleEntry = ['B', 100, { kind: 'single' }];
const multiEntry = [['A', 'C'], 100, { kind: 'multi', partialCreditPercent: 35 }];
const subjectiveEntry = ['', 20, { kind: 'subjective' }];
const spareEntry = ['C', 100, { kind: 'single' }];
const subjectiveSecret = 'verify-secret-answer-9f3a';
const sourceSecret = 'verify-secret-source-9f3a';
const sourceDomainId = 'upstream-domain';
const sourcePid = 501;
const verifyLog = 'teach verify domain=%s uid=%d type=%s id=%s pid=%d kind=%s result=%s';

interface TeachActor {
    _id: number;
    hasPerm: (...perm: bigint[]) => boolean;
    hasPriv: (...priv: number[]) => boolean;
    own: (doc: { owner: number; maintainer?: number[] }, exact?: boolean) => boolean;
}

interface PageResponse {
    body?: unknown;
    template?: string | null;
}

interface PageRequest {
    method: string;
    host: string;
    path: string;
    headers: Record<string, string>;
    query: Record<string, unknown>;
    params: Record<string, string>;
    body: Record<string, unknown>;
    json: boolean;
}

interface PageHandler {
    post: (args: Record<string, unknown>) => Promise<unknown>;
    user: TeachActor;
    domain: { _id: string };
    response: PageResponse;
    request: PageRequest;
    args: Record<string, unknown>;
    session: Record<string, unknown>;
    checkPerm: (...perm: bigint[]) => void;
    checkPriv: (...priv: number[]) => void;
    limitRate: (op: string, periodSecs: number, maxOperations: number, defaultKey?: string) => Promise<void>;
}

interface RouteCall {
    name: string;
    path: string;
    HandlerClass: new (...ctorArgs: unknown[]) => PageHandler;
}

interface ObjectiveBody {
    results: Record<string, { outcome: string; score: number }>;
    skipped: string[];
}

interface ModuleLoader {
    _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
    _cache: Record<string, NodeModule | undefined>;
}

type RouteName = 'teach_verify_objective' | 'teach_verify_submit';

const hydroHost = globalThis as unknown as {
    Hydro?: { model?: Record<string, unknown>; locales?: Record<string, unknown> };
};
if (!hydroHost.Hydro) hydroHost.Hydro = { model: {}, locales: {} };
if (!hydroHost.Hydro.model) hydroHost.Hydro.model = {};
if (!hydroHost.Hydro.locales) hydroHost.Hydro.locales = {};

const Module = requireFromTest('module') as ModuleLoader;
const contestDocs = new Map<string, Record<string, unknown>>();
const trainingDocs = new Map<string, Record<string, unknown>>();
const problems = new Map<number, Record<string, unknown>>();
const domainDocs = new Map<string, { _id: string; langs?: string }>();
const contestGets: string[] = [];
const trainingGets: string[] = [];
const attendCalls: unknown[][] = [];
const setStatusCalls: unknown[][] = [];
const updateStatusCalls: unknown[][] = [];
const enrollCalls: unknown[][] = [];
const draftWrites: unknown[][] = [];
const statusWrites: unknown[][] = [];
const recordAdds: unknown[][] = [];
const infoLogs: unknown[][] = [];
const replaced: Array<{ resolved: string; previous: NodeModule | undefined }> = [];
let statusDoc: Record<string, unknown> | null = null;
let routes: RouteCall[] | undefined;
let loadError: unknown;
const originalLoad = Module._load;

class CapturingLogger {
    info(...args: unknown[]) {
        infoLogs.push(args);
    }

    warn() {}

    error() {}

    debug() {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function idText(value: unknown): string {
    if (value instanceof ObjectId) return value.toHexString();
    if (typeof value === 'string') return value.toLowerCase();
    return '';
}

function teachActor(uid: number, perms: readonly bigint[] = []): TeachActor {
    const permSet = new Set<bigint>(perms);
    return {
        _id: uid,
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => permSet.has(perm)),
        hasPriv: () => false,
        own: (doc, exact) => (exact === true ? doc.owner === uid : doc.owner === uid || (doc.maintainer || []).includes(uid)),
    };
}

function copyContainer(doc: Record<string, unknown>): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...doc };
    if (Array.isArray(doc.pids)) copy.pids = [...doc.pids];
    if (Array.isArray(doc.maintainer)) copy.maintainer = [...doc.maintainer];
    if (isRecord(doc.score)) copy.score = { ...doc.score };
    if (isRecord(doc.examPaperQuotas)) copy.examPaperQuotas = { ...doc.examPaperQuotas };
    if (!Array.isArray(doc.dag)) return copy;
    copy.dag = doc.dag.map((node) => {
        if (!isRecord(node)) return node;
        const stage: Record<string, unknown> = { ...node };
        if (Array.isArray(node.pids)) stage.pids = [...node.pids];
        if (Array.isArray(node.requireNids)) stage.requireNids = [...node.requireNids];
        return stage;
    });
    return copy;
}

function copyProblem(doc: Record<string, unknown>): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...doc };
    if (isRecord(doc.config)) copy.config = structuredClone(doc.config);
    return copy;
}

function problemDocId(pid: unknown): number {
    if (typeof pid === 'number' && Number.isSafeInteger(pid)) return pid;
    if (typeof pid === 'string' && /^[1-9]\d*$/.test(pid)) return Number(pid);
    return Number.NaN;
}

function problemById(pid: unknown): Record<string, unknown> | undefined {
    const docId = problemDocId(pid);
    if (!Number.isSafeInteger(docId)) return undefined;
    const doc = problems.get(docId);
    return doc ? copyProblem(doc) : undefined;
}

const contestExports = {
    RULES: {
        acm: {},
        oi: {},
        ioi: {},
        ledo: {},
        strictioi: {},
        exam: {},
        homework: { hidden: true },
    },
    async get(nextDomainId: string, id: unknown) {
        contestGets.push(nextDomainId);
        const doc = contestDocs.get(idText(id));
        if (!doc || nextDomainId !== domainId) throw new ContestNotFoundError(nextDomainId, id);
        return copyContainer(doc);
    },
    async getStatus() {
        return statusDoc ? { ...statusDoc, examPaperPids: Array.isArray(statusDoc.examPaperPids) ? [...statusDoc.examPaperPids] : statusDoc.examPaperPids } : null;
    },
    async attend(...args: unknown[]) {
        attendCalls.push(args);
    },
    async setStatus(...args: unknown[]) {
        setStatusCalls.push(args);
    },
    async updateStatus(...args: unknown[]) {
        updateStatusCalls.push(args);
    },
};

const trainingExports = {
    async get(nextDomainId: string, id: unknown) {
        trainingGets.push(nextDomainId);
        const doc = trainingDocs.get(idText(id));
        if (!doc || nextDomainId !== domainId) throw new TrainingNotFoundError(nextDomainId, id);
        return copyContainer(doc);
    },
    async enroll(...args: unknown[]) {
        enrollCalls.push(args);
    },
    async setStatus(...args: unknown[]) {
        statusWrites.push(args);
    },
};

const problemExports = {
    async get(nextDomainId: string, pid: unknown) {
        const doc = problemById(pid);
        if (!doc) return null;
        const owner = typeof doc.domainId === 'string' ? doc.domainId : domainId;
        if (owner !== nextDomainId) return null;
        return doc;
    },
    async getList(nextDomainId: string, pids: unknown) {
        const found: Record<number, Record<string, unknown>> = {};
        if (nextDomainId !== domainId || !Array.isArray(pids)) return found;
        for (const pid of pids) {
            const doc = problemById(pid);
            if (!doc || typeof doc.docId !== 'number') continue;
            found[doc.docId] = doc;
        }
        return found;
    },
    async inc(..._args: unknown[]) {
        return undefined;
    },
};

const recordExports = {
    RECORD_VERIFY: new ObjectId('000000000000000000000002'),
    async add(...args: unknown[]) {
        const code = args[4];
        const doc = problemById(args[1]);
        const config = doc && isRecord(doc.config) ? doc.config : undefined;
        const kind = doc && typeof doc.problemKind === 'string' ? doc.problemKind : '';
        const type = config && typeof config.type === 'string' ? config.type : '';
        if (config && (type === 'function' || type === 'program_fill') && (kind === type)) {
            parseStructuredRegionSubmission(
                type === 'function' ? 'function' : 'program_fill',
                isRecord(config.template) ? config.template : undefined,
                typeof code === 'string' ? code : '',
            );
        }
        recordAdds.push(args);
        return new ObjectId(fixedRid);
    },
};

const paperDraftExports = {
    async upsertDraft(...args: unknown[]) {
        draftWrites.push(['upsert', ...args]);
        return null;
    },
    async setJudgeResults(...args: unknown[]) {
        draftWrites.push(['judge', ...args]);
    },
    async markDraftSubmitted(...args: unknown[]) {
        draftWrites.push(['mark', ...args]);
    },
    async getDraft() {
        return null;
    },
    async getDraftsForUser() {
        return [];
    },
    async getDraftsForContest() {
        return [];
    },
};

const settingExports = {
    langs: {
        cc: { disabled: false, hidden: false, remote: false, display: 'C', validAs: {} },
        py: { disabled: false, hidden: false, remote: false, display: 'Python', validAs: {} },
        'hduoj.cpp': { disabled: false, hidden: false, remote: true, display: 'HDU C++', validAs: {} },
    },
    get() {
        return undefined;
    },
};

const systemExports = {
    get(key: unknown) {
        if (key === 'limit.codelength') return 128 * 1024;
        return 0;
    },
};

const domainExports = {
    async get(id: unknown) {
        if (typeof id !== 'string') return null;
        const doc = domainDocs.get(id);
        return doc ? { ...doc } : null;
    },
    async incUserInDomain() {
        return undefined;
    },
};

const documentExports = {
    async setStatus(...args: unknown[]) {
        statusWrites.push(args);
    },
    collStatus: {
        async updateOne(...args: unknown[]) {
            statusWrites.push(['updateOne', ...args]);
            return {};
        },
        async findOneAndUpdate(...args: unknown[]) {
            statusWrites.push(['findOneAndUpdate', ...args]);
            return null;
        },
    },
};

const oplogExports = {
    async log() {
        return new ObjectId();
    },
};

function withModuleShape(exportsValue: Record<string, unknown>): Record<string, unknown> {
    return { ...exportsValue, __esModule: true, default: exportsValue };
}

const contestModule = withModuleShape(contestExports);
const trainingModule = withModuleShape(trainingExports);
const problemModule = withModuleShape(problemExports);
const recordModule = withModuleShape(recordExports);
const paperDraftModule = withModuleShape(paperDraftExports);
const settingModule = withModuleShape(settingExports);
const systemModule = withModuleShape(systemExports);
const domainModule = withModuleShape(domainExports);
const documentModule = withModuleShape(documentExports);
const oplogModule = withModuleShape(oplogExports);
const serverModule = {
    Handler: class Handler {},
    param,
    post,
    query,
    route,
    Types,
    __esModule: true,
};

function installStub(relativePath: string, exportsValue: Record<string, unknown>): void {
    const resolved = requireFromTest.resolve(relativePath);
    replaced.push({ resolved, previous: Module._cache[resolved] });
    const entry = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports: exportsValue,
        children: [],
        paths: [],
    } as NodeModule;
    Module._cache[resolved] = entry;
    requireFromTest.cache[resolved] = entry;
}

installStub('../src/model/contest.ts', contestModule);
installStub('../src/model/training.ts', trainingModule);
installStub('../src/model/problem.ts', problemModule);
installStub('../src/model/record.ts', recordModule);
installStub('../src/model/paper-draft.ts', paperDraftModule);
installStub('../src/model/setting.ts', settingModule);
installStub('../src/model/system.ts', systemModule);
installStub('../src/model/domain.ts', domainModule);
installStub('../src/model/document.ts', documentModule);
installStub('../src/model/oplog.ts', oplogModule);

function isVerifyModule(filename: string | undefined): boolean {
    if (!filename) return false;
    const normalized = filename.replaceAll('\\', '/');
    return normalized.endsWith('/src/handler/teach-verify.ts')
        || normalized.endsWith('/src/lib/teach-verify.ts')
        || normalized.endsWith('/src/handler/teach-verify.js')
        || normalized.endsWith('/src/lib/teach-verify.js');
}

function stubFor(request: string): Record<string, unknown> | undefined {
    const normalized = request.replaceAll('\\', '/').replace(/\.(ts|js)$/, '');
    if (normalized.endsWith('/model/contest')) return contestModule;
    if (normalized.endsWith('/model/training')) return trainingModule;
    if (normalized.endsWith('/model/problem')) return problemModule;
    if (normalized.endsWith('/model/record')) return recordModule;
    if (normalized.endsWith('/model/paper-draft')) return paperDraftModule;
    if (normalized.endsWith('/model/setting')) return settingModule;
    if (normalized.endsWith('/model/system')) return systemModule;
    if (normalized.endsWith('/model/domain')) return domainModule;
    if (normalized.endsWith('/model/document')) return documentModule;
    if (normalized.endsWith('/model/oplog')) return oplogModule;
    if (normalized === '../service/server' || normalized.endsWith('/service/server')) return serverModule;
    return undefined;
}

function isLoggerRequest(request: string): boolean {
    return request === '@hydrooj/utils'
        || request === '@hydrooj/utils/lib/utils'
        || request === '../logger'
        || request.endsWith('/logger')
        || request.endsWith('/logger.ts')
        || request.endsWith('/logger.js');
}

Module._load = function load(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (!isVerifyModule(parent?.filename)) return originalLoad.call(this, request, parent, isMain);
    const stub = stubFor(request);
    if (stub) return stub;
    if (!isLoggerRequest(request)) return originalLoad.call(this, request, parent, isMain);
    const real: unknown = originalLoad.call(this, request, parent, isMain);
    if (!isRecord(real)) return { Logger: CapturingLogger, logger: new CapturingLogger(), default: CapturingLogger };
    return { ...real, Logger: CapturingLogger, logger: new CapturingLogger(), default: CapturingLogger };
};

function resetFixtures(): void {
    contestDocs.clear();
    trainingDocs.clear();
    problems.clear();
    domainDocs.clear();
    contestGets.length = 0;
    trainingGets.length = 0;
    attendCalls.length = 0;
    setStatusCalls.length = 0;
    updateStatusCalls.length = 0;
    enrollCalls.length = 0;
    draftWrites.length = 0;
    statusWrites.length = 0;
    recordAdds.length = 0;
    infoLogs.length = 0;
    statusDoc = null;
}

function putContest(fields: Record<string, unknown>): ObjectId {
    const docId = fields.docId instanceof ObjectId ? fields.docId : new ObjectId();
    contestDocs.set(docId.toHexString(), {
        domainId,
        owner: ownerUid,
        maintainer: [],
        title: '题目集',
        rule: 'homework',
        pids: [],
        beginAt: new Date('2020-01-01T00:00:00.000Z'),
        endAt: new Date('2099-01-01T00:00:00.000Z'),
        ...fields,
        docId,
        _id: docId,
    });
    return docId;
}

function putTraining(fields: Record<string, unknown>): ObjectId {
    const docId = fields.docId instanceof ObjectId ? fields.docId : new ObjectId();
    trainingDocs.set(docId.toHexString(), {
        domainId,
        owner: ownerUid,
        maintainer: [],
        title: '练习一',
        kind: 'problem_set',
        dag: [],
        ...fields,
        docId,
        _id: docId,
    });
    return docId;
}

function putProblem(docId: number, fields: Record<string, unknown>): void {
    problems.set(docId, {
        docId,
        pid: `H${docId}`,
        domainId,
        title: `题目${docId}`,
        problemKind: 'single',
        content: '',
        hidden: false,
        owner: ownerUid,
        ...fields,
    });
}

function objectiveConfig(answers: Record<string, unknown>): Record<string, unknown> {
    return { type: 'objective', answers };
}

function loadHandlerModule(): Record<string, unknown> {
    try {
        const loaded: unknown = requireFromTest('../src/handler/teach-verify.ts');
        if (!isRecord(loaded)) throw new TypeError('teach export missing: handler');
        return loaded;
    } catch (error) {
        if (error instanceof TypeError && error.message.startsWith('teach export missing:')) throw error;
        const detail = error instanceof Error ? error.message : String(error);
        throw new TypeError(`teach export missing: ${detail}`);
    }
}

async function captureRoutes(loaded: Record<string, unknown>): Promise<RouteCall[]> {
    const apply = loaded.apply ?? (isRecord(loaded.default) ? loaded.default.apply : undefined);
    if (typeof apply !== 'function') throw new TypeError('teach export missing: apply');
    const found: RouteCall[] = [];
    const ctx = {
        Route(name: unknown, routePath: unknown, HandlerClass: unknown) {
            if (typeof name !== 'string' || typeof routePath !== 'string' || typeof HandlerClass !== 'function') {
                throw new TypeError(`teach export missing: route ${String(name)}`);
            }
            found.push({ name, path: routePath, HandlerClass: HandlerClass as new (...ctorArgs: unknown[]) => PageHandler });
        },
        inject(_deps: unknown, callback: (context: object) => unknown) {
            return callback(ctx);
        },
    };
    await (apply as (context: typeof ctx) => unknown)(ctx);
    return found;
}

async function ensureRoutes(): Promise<RouteCall[]> {
    if (routes) return routes;
    if (loadError) throw loadError;
    try {
        routes = await captureRoutes(loadHandlerModule());
        return routes;
    } catch (error) {
        loadError = error;
        throw error;
    }
}

async function routeNamed(name: RouteName): Promise<RouteCall> {
    const found = (await ensureRoutes()).find((item) => item.name === name);
    if (!found) throw new TypeError(`teach export missing: ${name}`);
    return found;
}

function createHandler(
    HandlerClass: new (...ctorArgs: unknown[]) => PageHandler,
    actor: TeachActor,
    request: PageRequest,
    response: PageResponse,
    args: Record<string, unknown>,
): PageHandler {
    const context = {
        session: {},
        holdFiles: [],
        HydroContext: {
            args,
            request,
            response,
            UiContext: {},
            domain: { _id: domainId },
        },
    };
    let handler: PageHandler;
    try {
        handler = new HandlerClass();
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (!message.includes('session') && !message.includes('HydroContext') && !message.includes('context') && !message.includes('undefined')) {
            throw error;
        }
        handler = new HandlerClass(context, {});
    }
    handler.user = actor;
    handler.domain = { _id: domainId };
    handler.request = request;
    handler.response = response;
    handler.args = args;
    handler.session = {};
    handler.checkPerm = (...perms: bigint[]) => {
        if (!actor.hasPerm(...perms)) throw new PermissionError(...perms);
    };
    handler.checkPriv = (...privs: number[]) => {
        if (!actor.hasPriv(...privs)) throw new PermissionError(...privs);
    };
    handler.limitRate = async () => undefined;
    return handler;
}

async function invoke(actor: TeachActor, name: RouteName, type: string, id: string, fields: Record<string, string | number>): Promise<unknown> {
    const target = await routeNamed(name);
    const args: Record<string, unknown> = { domainId: forgedDomainId, type, id, ...fields };
    const body: Record<string, unknown> = { ...fields };
    const action = name === 'teach_verify_objective' ? 'objective' : 'submit';
    const request: PageRequest = {
        method: 'post',
        host: 'localhost',
        path: `/teach/${type}/${id}/verify/${action}`,
        headers: {},
        query: { ...body },
        params: { type, id },
        body,
        json: false,
    };
    const response: PageResponse = {};
    const handler = createHandler(target.HandlerClass, actor, request, response, args);
    if (typeof handler.post !== 'function') throw new TypeError(`teach export missing: ${name} post`);
    const returned = await handler.post(args);
    return response.body !== undefined ? response.body : returned;
}

async function rejectionOf(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run();
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('teach export missing:')) throw error;
        return error;
    }
    throw new Error('expected the call to reject');
}

function errorName(error: unknown): string {
    return error instanceof Error ? error.name : '';
}

function errorField(error: unknown): unknown {
    if (!(error instanceof ValidationError)) return undefined;
    const params = (error as HydroError).params;
    return Array.isArray(params) ? params[0] : undefined;
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function readGrade(value: unknown, label: string): { outcome: string; score: number } {
    expect(isRecord(value), label).to.equal(true);
    if (!isRecord(value)) throw new TypeError(label);
    expect(Object.keys(value).sort(), label).to.deep.equal(['outcome', 'score']);
    expect(typeof value.outcome, `${label}.outcome`).to.equal('string');
    expect(typeof value.score, `${label}.score`).to.equal('number');
    if (typeof value.outcome !== 'string' || typeof value.score !== 'number') throw new TypeError(label);
    return { outcome: value.outcome, score: value.score };
}

function readObjective(value: unknown): ObjectiveBody {
    expect(isRecord(value), 'response body').to.equal(true);
    if (!isRecord(value)) throw new TypeError('objective verify');
    expect(Object.keys(value).sort()).to.deep.equal(['results', 'skipped']);
    expect(isRecord(value.results), 'results').to.equal(true);
    if (!isRecord(value.results)) throw new TypeError('results');
    const results: ObjectiveBody['results'] = {};
    for (const [key, grade] of Object.entries(value.results)) results[key] = readGrade(grade, key);
    expect(isStringArray(value.skipped), 'skipped').to.equal(true);
    if (!isStringArray(value.skipped)) throw new TypeError('skipped');
    return { results, skipped: value.skipped };
}

function readRid(value: unknown): string {
    expect(isRecord(value), 'response body').to.equal(true);
    if (!isRecord(value)) throw new TypeError('verify submit');
    expect(Object.keys(value).sort()).to.deep.equal(['rid']);
    expect(typeof value.rid).to.equal('string');
    if (typeof value.rid !== 'string') throw new TypeError('rid');
    return value.rid;
}

function sameLoggedId(value: unknown, id: string): boolean {
    if (value instanceof ObjectId) return value.toHexString() === id;
    return value === id;
}

function expectVerifyInfo(type: string, id: string, pid: number, secret: string): void {
    const hit = infoLogs.find((args) => args[0] === verifyLog
        && args[1] === domainId
        && args[2] === ownerUid
        && args[3] === type
        && sameLoggedId(args[4], id)
        && args[5] === pid);
    expect(hit === undefined, 'verify log').to.equal(false);
    if (!hit) throw new TypeError('verify log');
    expect(typeof hit[6]).to.equal('string');
    expect(typeof hit[7]).to.equal('string');
    expect(JSON.stringify(infoLogs).includes(secret)).to.equal(false);
}

function expectNoContainerMutation(): void {
    expect(attendCalls.length, 'contest.attend').to.equal(0);
    expect(setStatusCalls.length, 'contest.setStatus').to.equal(0);
    expect(updateStatusCalls.length, 'contest.updateStatus').to.equal(0);
    expect(draftWrites.length, 'paper draft writes').to.equal(0);
    expect(enrollCalls.length, 'training.enroll').to.equal(0);
    expect(statusWrites.length, 'contest status writes').to.equal(0);
}

function homeworkOwner(): TeachActor {
    return teachActor(ownerUid, [PERM.PERM_EDIT_HOMEWORK_SELF]);
}

function contestOwner(): TeachActor {
    return teachActor(ownerUid, [PERM.PERM_EDIT_CONTEST_SELF]);
}

function practiceOwner(): TeachActor {
    return teachActor(ownerUid, [PERM.PERM_EDIT_TRAINING_SELF]);
}

function student(): TeachActor {
    return teachActor(studentUid, []);
}

after(() => {
    Module._load = originalLoad;
    for (const item of replaced) {
        if (item.previous) {
            Module._cache[item.resolved] = item.previous;
            requireFromTest.cache[item.resolved] = item.previous;
        } else {
            delete Module._cache[item.resolved];
            delete requireFromTest.cache[item.resolved];
        }
    }
});

beforeEach(() => {
    resetFixtures();
});

describe('teach verify endpoints', { concurrency: false }, () => {
    it('registers the objective and submit routes', async () => {
        const found = await ensureRoutes();
        expect(found.find((item) => item.name === 'teach_verify_objective')?.path).to.equal('/teach/:type/:id/verify/objective');
        expect(found.find((item) => item.name === 'teach_verify_submit')?.path).to.equal('/teach/:type/:id/verify/submit');
    });

    it('grades a single-choice answer as full marks or wrong', async () => {
        const tid = putContest({ rule: 'homework', title: '单选作业', pids: [singlePid] });
        putProblem(singlePid, {
            problemKind: 'single',
            config: objectiveConfig({ main: singleEntry }),
        });
        const correctAnswers = JSON.stringify({ main: 'B' });
        const correct = readObjective(await invoke(homeworkOwner(), 'teach_verify_objective', 'homework', tid.toHexString(), {
            pid: singlePid,
            answers: correctAnswers,
        }));
        const expectedCorrect = gradeObjectiveAnswer(singleEntry, 'B');
        expect(expectedCorrect).to.deep.equal({ outcome: 'correct', score: 100 });
        expect(correct.results.main).to.deep.equal(expectedCorrect);
        expect(correct.skipped).to.deep.equal([]);
        expect(recordAdds.length).to.equal(0);
        expectVerifyInfo('homework', tid.toHexString(), singlePid, correctAnswers);
        expectNoContainerMutation();

        infoLogs.length = 0;
        const wrongAnswers = JSON.stringify({ main: 'A' });
        const wrong = readObjective(await invoke(homeworkOwner(), 'teach_verify_objective', 'homework', tid.toHexString(), {
            pid: singlePid,
            answers: wrongAnswers,
        }));
        expect(wrong.results.main).to.deep.equal(gradeObjectiveAnswer(singleEntry, 'A'));
        expect(wrong.results.main.outcome).to.equal('wrong');
        expect(wrong.skipped).to.deep.equal([]);
        expectVerifyInfo('homework', tid.toHexString(), singlePid, wrongAnswers);
        expectNoContainerMutation();
    });

    it('grades a partial multi-select the same way as gradeObjectiveAnswer', async () => {
        const tid = putContest({ rule: 'homework', title: '多选作业', pids: [multiPid] });
        putProblem(multiPid, {
            problemKind: 'multi',
            config: objectiveConfig({ main: multiEntry }),
        });
        const answers = JSON.stringify({ main: ['A'] });
        const body = readObjective(await invoke(homeworkOwner(), 'teach_verify_objective', 'homework', tid.toHexString(), {
            pid: multiPid,
            answers,
        }));
        const expected = gradeObjectiveAnswer(multiEntry, ['A']);
        expect(expected.outcome).to.equal('partial');
        expect(body.results.main).to.deep.equal(expected);
        expect(body.skipped).to.deep.equal([]);
        expect(recordAdds.length).to.equal(0);
        expectVerifyInfo('homework', tid.toHexString(), multiPid, answers);
        expectNoContainerMutation();
    });

    it('skips a subjective key and omits an unanswered key', async () => {
        const tid = putContest({ rule: 'homework', title: '混合客观题', pids: [mixedPid] });
        putProblem(mixedPid, {
            problemKind: 'single',
            config: objectiveConfig({
                main: singleEntry,
                essay: subjectiveEntry,
                spare: spareEntry,
            }),
        });
        const answers = JSON.stringify({ main: 'B', essay: subjectiveSecret });
        const body = readObjective(await invoke(homeworkOwner(), 'teach_verify_objective', 'homework', tid.toHexString(), {
            pid: mixedPid,
            answers,
        }));
        expect(Object.keys(body.results)).to.deep.equal(['main']);
        expect(body.results.main).to.deep.equal(gradeObjectiveAnswer(singleEntry, 'B'));
        expect(body.skipped).to.deep.equal(['essay']);
        expect(Object.hasOwn(body.results, 'essay')).to.equal(false);
        expect(Object.hasOwn(body.results, 'spare')).to.equal(false);
        expect(body.skipped.includes('spare')).to.equal(false);
        expect(recordAdds.length).to.equal(0);
        expectVerifyInfo('homework', tid.toHexString(), mixedPid, subjectiveSecret);
        expectNoContainerMutation();
    });

    it('rejects a student, an outside pid, a mismatched type, and a missing container', async () => {
        const tid = putContest({ rule: 'homework', title: '单选作业', pids: [singlePid] });
        putProblem(singlePid, {
            problemKind: 'single',
            config: objectiveConfig({ main: singleEntry }),
        });
        const id = tid.toHexString();
        const answers = JSON.stringify({ main: 'B' });
        const studentObjective = await rejectionOf(() => invoke(student(), 'teach_verify_objective', 'homework', id, {
            pid: singlePid,
            answers,
        }));
        expect(errorName(studentObjective)).to.equal('PermissionError');
        expect(studentObjective instanceof PermissionError).to.equal(true);

        const studentSubmit = await rejectionOf(() => invoke(student(), 'teach_verify_submit', 'homework', id, {
            pid: singlePid,
            lang: 'cc',
            code: sourceSecret,
        }));
        expect(errorName(studentSubmit)).to.equal('PermissionError');
        expect(recordAdds.length).to.equal(0);

        const outside = await rejectionOf(() => invoke(homeworkOwner(), 'teach_verify_objective', 'homework', id, {
            pid: outsidePid,
            answers,
        }));
        expect(errorName(outside)).to.equal('ValidationError');
        expect(outside instanceof ValidationError).to.equal(true);
        expect(errorField(outside)).to.equal('pid');

        const outsideSubmit = await rejectionOf(() => invoke(homeworkOwner(), 'teach_verify_submit', 'homework', id, {
            pid: outsidePid,
            lang: 'cc',
            code: sourceSecret,
        }));
        expect(errorName(outsideSubmit)).to.equal('ValidationError');
        expect(errorField(outsideSubmit)).to.equal('pid');
        expect(recordAdds.length).to.equal(0);

        const mismatched = await rejectionOf(() => invoke(
            teachActor(ownerUid, [PERM.PERM_EDIT_HOMEWORK_SELF, PERM.PERM_EDIT_CONTEST_SELF]),
            'teach_verify_objective',
            'exam',
            id,
            { pid: singlePid, answers },
        ));
        expect(errorName(mismatched)).to.equal('NotFoundError');
        expect(mismatched instanceof NotFoundError).to.equal(true);

        const missing = await rejectionOf(() => invoke(homeworkOwner(), 'teach_verify_submit', 'homework', new ObjectId().toHexString(), {
            pid: singlePid,
            lang: 'cc',
            code: sourceSecret,
        }));
        expect(errorName(missing)).to.equal('NotFoundError');
        expect(missing instanceof NotFoundError).to.equal(true);
        expectNoContainerMutation();
    });

    it('creates a verify record and rejects a language the problem does not allow', async () => {
        const tid = putContest({ rule: 'acm', title: '校赛', pids: [programPid] });
        putProblem(programPid, {
            problemKind: 'programming',
            config: { type: 'default', langs: ['cc'] },
        });
        const id = tid.toHexString();
        const denied = await rejectionOf(() => invoke(contestOwner(), 'teach_verify_submit', 'acm', id, {
            pid: programPid,
            lang: 'py',
            code: sourceSecret,
        }));
        expect(denied instanceof ProblemNotAllowLanguageError).to.equal(true);
        expect(errorName(denied)).to.equal('ProblemNotAllowSubmitError');
        expect(recordAdds.length).to.equal(0);
        expectNoContainerMutation();

        const rid = readRid(await invoke(contestOwner(), 'teach_verify_submit', 'acm', id, {
            pid: programPid,
            lang: 'cc',
            code: sourceSecret,
        }));
        expect(rid).to.equal(fixedRid);
        expect(recordAdds.length).to.equal(1);
        const args = recordAdds[0];
        expect(args[0]).to.equal(domainId);
        expect(args[1]).to.equal(programPid);
        expect(args[2]).to.equal(ownerUid);
        expect(args[3]).to.equal('cc');
        expect(args[4]).to.equal(sourceSecret);
        expect(args[5]).to.equal(true);
        expect(isRecord(args[6]), 'record.add options').to.equal(true);
        if (!isRecord(args[6])) throw new TypeError('record.add options');
        expect(args[6].type).to.equal('verify');
        expect(Object.hasOwn(args[6], 'contest')).to.equal(false);
        expect(Object.hasOwn(args[6], 'contestContext')).to.equal(false);
        expect(Object.hasOwn(args[6], 'input')).to.equal(false);
        expect(Object.hasOwn(args[6], 'practiceContext')).to.equal(false);
        expect(Object.hasOwn(args[6], 'virtualAttemptId')).to.equal(false);
        expect(Object.hasOwn(args[6], 'sourceContestId')).to.equal(false);
        expectVerifyInfo('acm', id, programPid, sourceSecret);
        expectNoContainerMutation();
    });

    it('accepts cc when the contest language list is empty and the problem sets no langs', async () => {
        const tid = putContest({
            rule: 'acm',
            title: '空语言列表',
            pids: [programPid],
            langs: [],
        });
        putProblem(programPid, {
            problemKind: 'programming',
            config: { type: 'default' },
        });
        const id = tid.toHexString();
        const rid = readRid(await invoke(contestOwner(), 'teach_verify_submit', 'acm', id, {
            pid: programPid,
            lang: 'cc',
            code: sourceSecret,
        }));
        expect(rid).to.equal(fixedRid);
        expect(recordAdds.length).to.equal(1);
        const args = recordAdds[0];
        expect(args?.[0]).to.equal(domainId);
        expect(args?.[1]).to.equal(programPid);
        expect(args?.[2]).to.equal(ownerUid);
        expect(args?.[3]).to.equal('cc');
        expect(args?.[4]).to.equal(sourceSecret);
        expect(args?.[5]).to.equal(true);
        expect(isRecord(args?.[6]), 'record.add options').to.equal(true);
        if (!isRecord(args?.[6])) throw new TypeError('record.add options');
        expect(args[6].type).to.equal('verify');
        expect(Object.hasOwn(args[6], 'contest')).to.equal(false);
        expect(Object.hasOwn(args[6], 'input')).to.equal(false);
        expect(Object.hasOwn(args[6], 'practiceContext')).to.equal(false);
        expectVerifyInfo('acm', id, programPid, sourceSecret);
        expectNoContainerMutation();
    });

    it('rejects py when the referenced problem source domain only allows cc', async () => {
        const tid = putContest({ rule: 'acm', title: '引用题', pids: [programPid] });
        putProblem(programPid, {
            problemKind: 'programming',
            reference: { domainId: sourceDomainId, pid: sourcePid },
            config: { type: 'default' },
        });
        putProblem(sourcePid, {
            domainId: sourceDomainId,
            problemKind: 'programming',
            config: { type: 'default' },
        });
        domainDocs.set(domainId, { _id: domainId });
        domainDocs.set(sourceDomainId, { _id: sourceDomainId, langs: 'cc' });
        const denied = await rejectionOf(() => invoke(contestOwner(), 'teach_verify_submit', 'acm', tid.toHexString(), {
            pid: programPid,
            lang: 'py',
            code: sourceSecret,
        }));
        expect(denied instanceof ProblemNotAllowLanguageError).to.equal(true);
        expect(errorName(denied)).to.equal('ProblemNotAllowSubmitError');
        expect(recordAdds.length).to.equal(0);
        expectNoContainerMutation();
    });

    it('accepts the remote judge language hduoj.cpp', async () => {
        const tid = putContest({ rule: 'acm', title: '远程题', pids: [programPid] });
        putProblem(programPid, {
            problemKind: 'programming',
            config: { type: 'remote_judge', subType: 'hduoj', target: '1000' },
        });
        const id = tid.toHexString();
        const rid = readRid(await invoke(contestOwner(), 'teach_verify_submit', 'acm', id, {
            pid: programPid,
            lang: 'hduoj.cpp',
            code: sourceSecret,
        }));
        expect(rid).to.equal(fixedRid);
        expect(recordAdds.length).to.equal(1);
        const args = recordAdds[0];
        expect(args?.[0]).to.equal(domainId);
        expect(args?.[1]).to.equal(programPid);
        expect(args?.[2]).to.equal(ownerUid);
        expect(args?.[3]).to.equal('hduoj.cpp');
        expect(args?.[4]).to.equal(sourceSecret);
        expect(args?.[5]).to.equal(true);
        expect(isRecord(args?.[6]), 'record.add options').to.equal(true);
        if (!isRecord(args?.[6])) throw new TypeError('record.add options');
        expect(args[6].type).to.equal('verify');
        expect(Object.hasOwn(args[6], 'contest')).to.equal(false);
        expect(Object.hasOwn(args[6], 'input')).to.equal(false);
        expect(Object.hasOwn(args[6], 'practiceContext')).to.equal(false);
        expectNoContainerMutation();
    });

    it('does not write a draft, attend, or contest status', async () => {
        const tid = putContest({ rule: 'homework', title: '单选作业', pids: [singlePid, programPid] });
        putProblem(singlePid, {
            problemKind: 'single',
            config: objectiveConfig({ main: singleEntry }),
        });
        putProblem(programPid, {
            problemKind: 'programming',
            config: { type: 'default', langs: ['cc'] },
        });
        const id = tid.toHexString();
        await invoke(homeworkOwner(), 'teach_verify_objective', 'homework', id, {
            pid: singlePid,
            answers: JSON.stringify({ main: 'B' }),
        });
        await invoke(homeworkOwner(), 'teach_verify_submit', 'homework', id, {
            pid: programPid,
            lang: 'cc',
            code: 'int main(){return 0;}',
        });
        expect(recordAdds.length).to.equal(1);
        expectNoContainerMutation();
    });

    it('grades a practice stage problem and an exam problem outside the personal paper', async () => {
        const practiceId = putTraining({
            title: '阶段练习',
            dag: [{ _id: 1, title: '第一章', requireNids: [], pids: [singlePid] }],
        });
        putProblem(singlePid, {
            problemKind: 'single',
            config: objectiveConfig({ main: singleEntry }),
        });
        const practice = readObjective(await invoke(practiceOwner(), 'teach_verify_objective', 'practice', practiceId.toHexString(), {
            pid: singlePid,
            answers: JSON.stringify({ main: 'B' }),
        }));
        expect(practice.results.main).to.deep.equal(gradeObjectiveAnswer(singleEntry, 'B'));
        expectNoContainerMutation();

        const examId = putContest({
            rule: 'exam',
            title: '抽卷考试',
            pids: [singlePid, otherPid],
            examPaperQuotas: { single: 1 },
        });
        putProblem(otherPid, {
            problemKind: 'single',
            config: objectiveConfig({ main: ['A', 100, { kind: 'single' }] }),
        });
        statusDoc = { attend: 0, examPaperPids: [otherPid] };
        const pooled = readObjective(await invoke(contestOwner(), 'teach_verify_objective', 'exam', examId.toHexString(), {
            pid: singlePid,
            answers: JSON.stringify({ main: 'B' }),
        }));
        expect(pooled.results.main.outcome).to.equal('correct');
        expect(pooled.results.main.score).to.equal(100);
        const notInPool = await rejectionOf(() => invoke(contestOwner(), 'teach_verify_objective', 'exam', examId.toHexString(), {
            pid: outsidePid,
            answers: JSON.stringify({ main: 'B' }),
        }));
        expect(errorName(notInPool)).to.equal('ValidationError');
        expect(errorField(notInPool)).to.equal('pid');
        expect(recordAdds.length).to.equal(0);
        expectNoContainerMutation();
    });

    it('grades a text-mode program fill the same way as gradeProgramFillTextSubmission', async () => {
        const firstRegion = 'r_fillregion01';
        const secondRegion = 'r_fillregion02';
        const source = ['keep this', 'expected line', 'other line'].join('\n');
        const config = {
            type: 'program_fill',
            mode: 'text',
            template: {
                source,
                sourceHash: templateSourceHash(source),
                publicRanges: [],
                regions: [
                    { id: firstRegion, startLine: 1, endLine: 2 },
                    { id: secondRegion, startLine: 2, endLine: 3 },
                ],
            },
        };
        const tid = putContest({ rule: 'homework', title: '程序填空', pids: [programPid] });
        putProblem(programPid, { problemKind: 'program_fill', config });
        const wrongAnswers = JSON.stringify({ [firstRegion]: 'not the line' });
        const wrongPayload = JSON.stringify({ [firstRegion]: 'not the line', [secondRegion]: '\u0000' });
        const wrongGrade = gradeProgramFillTextSubmission(config, wrongPayload);
        const wrongRegion = wrongGrade.regions.find((region) => region.id === firstRegion);
        expect(wrongRegion?.correct).to.equal(false);
        const wrong = readObjective(await invoke(homeworkOwner(), 'teach_verify_objective', 'homework', tid.toHexString(), {
            pid: programPid,
            answers: wrongAnswers,
        }));
        expect(Object.keys(wrong.results)).to.deep.equal([firstRegion]);
        expect(wrong.results[firstRegion]).to.deep.equal({
            outcome: wrongRegion?.correct ? 'correct' : 'wrong',
            score: wrongRegion?.score,
        });
        expect(wrong.skipped).to.deep.equal([]);
        expect(recordAdds.length).to.equal(0);

        const rightAnswers = JSON.stringify({
            [firstRegion]: 'expected line',
            [secondRegion]: 'other line',
        });
        const rightPayload = JSON.stringify({
            [firstRegion]: 'expected line',
            [secondRegion]: 'other line',
        });
        const rightGrade = gradeProgramFillTextSubmission(config, rightPayload);
        const right = readObjective(await invoke(homeworkOwner(), 'teach_verify_objective', 'homework', tid.toHexString(), {
            pid: programPid,
            answers: rightAnswers,
        }));
        expect(Object.keys(right.results)).to.deep.equal([firstRegion, secondRegion]);
        for (const region of rightGrade.regions) {
            expect(region.correct).to.equal(true);
            expect(right.results[region.id]).to.deep.equal({ outcome: 'correct', score: region.score });
        }
        expect(right.skipped).to.deep.equal([]);
        expectNoContainerMutation();
    });

    it('grades a problem that only sits in a practice section', async () => {
        const practiceId = putTraining({
            title: '小节练习',
            dag: [{
                _id: 1,
                title: '第一章',
                requireNids: [],
                pids: [],
                sections: [{ _id: 11, title: '第一节', pids: [singlePid] }],
            }],
        });
        putProblem(singlePid, {
            problemKind: 'single',
            config: objectiveConfig({ main: singleEntry }),
        });
        const graded = readObjective(await invoke(practiceOwner(), 'teach_verify_objective', 'practice', practiceId.toHexString(), {
            pid: singlePid,
            answers: JSON.stringify({ main: 'B' }),
        }));
        expect(graded.results.main).to.deep.equal(gradeObjectiveAnswer(singleEntry, 'B'));
        const outside = await rejectionOf(() => invoke(practiceOwner(), 'teach_verify_objective', 'practice', practiceId.toHexString(), {
            pid: outsidePid,
            answers: JSON.stringify({ main: 'B' }),
        }));
        expect(errorName(outside)).to.equal('ValidationError');
        expect(errorField(outside)).to.equal('pid');
        expect(recordAdds.length).to.equal(0);
        expectNoContainerMutation();
    });

    it('rejects verify code longer than the submission length limit', async () => {
        const limit = 128 * 1024;
        const tid = putContest({ rule: 'acm', title: '校赛', pids: [programPid] });
        putProblem(programPid, {
            problemKind: 'programming',
            config: { type: 'default', langs: ['cc'] },
        });
        const id = tid.toHexString();
        const exact = 'a'.repeat(limit);
        const rid = readRid(await invoke(contestOwner(), 'teach_verify_submit', 'acm', id, {
            pid: programPid,
            lang: 'cc',
            code: exact,
        }));
        expect(rid).to.equal(fixedRid);
        expect(recordAdds.length).to.equal(1);
        expect(recordAdds[0]?.[4]).to.equal(exact);

        const over = await rejectionOf(() => invoke(contestOwner(), 'teach_verify_submit', 'acm', id, {
            pid: programPid,
            lang: 'cc',
            code: 'a'.repeat(limit + 1),
        }));
        expect(errorName(over)).to.equal('ValidationError');
        expect(over instanceof ValidationError).to.equal(true);
        expect(errorField(over)).to.equal('code');
        expect(recordAdds.length).to.equal(1);
        expectNoContainerMutation();
    });

    it('submits a function problem in the template language', async () => {
        const regionId = 'r_verifyfn0001';
        const source = ['int solve() {', '    return 0;', '}'].join('\n');
        const template = {
            lang: 'cc',
            source,
            sourceHash: templateSourceHash(source),
            publicRanges: [
                { startLine: 0, endLine: 1 },
                { startLine: 2, endLine: 3 },
            ],
            regions: [{ id: regionId, startLine: 1, endLine: 2 }],
        };
        const tid = putContest({ rule: 'acm', title: '函数赛', pids: [programPid] });
        putProblem(programPid, {
            problemKind: 'function',
            config: { type: 'function', template },
        });
        const id = tid.toHexString();
        const plain = 'int solve(){return 1;}';
        let plainRejected = false;
        try {
            parseStructuredRegionSubmission('function', template, plain);
        } catch (error) {
            plainRejected = error instanceof Error;
        }
        expect(plainRejected).to.equal(true);
        const rejected = await rejectionOf(() => invoke(contestOwner(), 'teach_verify_submit', 'acm', id, {
            pid: programPid,
            lang: 'py',
            code: plain,
        }));
        expect(errorName(rejected)).to.equal('ValidationError');
        expect(rejected instanceof ValidationError).to.equal(true);
        expect(errorField(rejected)).to.equal('code');
        expect(recordAdds.length).to.equal(0);
        expectNoContainerMutation();

        const code = JSON.stringify({ [regionId]: 'return 1;' });
        expect(parseStructuredRegionSubmission('function', template, code)[regionId]).to.equal('return 1;');
        const rid = readRid(await invoke(contestOwner(), 'teach_verify_submit', 'acm', id, {
            pid: programPid,
            lang: 'py',
            code,
        }));
        expect(rid).to.equal(fixedRid);
        expect(recordAdds.length).to.equal(1);
        const args = recordAdds[0];
        expect(args?.[3]).to.equal('cc');
        expect(args?.[4]).to.equal(code);
        expect(isRecord(args?.[6]), 'record.add options').to.equal(true);
        if (!isRecord(args?.[6])) throw new TypeError('record.add options');
        expect(args[6].type).to.equal('verify');
        expectNoContainerMutation();
    });
});
