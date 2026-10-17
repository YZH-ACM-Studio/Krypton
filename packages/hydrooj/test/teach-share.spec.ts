import { createRequire, type Module as NodeModule } from 'node:module';
import { after, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveErrorTransport } from '@hydrooj/framework';
import { get, param, post, route as routeParam } from '@hydrooj/framework/decorators';
import { Types } from '@hydrooj/framework/validator';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import {
    ContestNotFoundError,
    getLocalizedErrorMetadata,
    PermissionError,
    PrivilegeError,
    TrainingNotFoundError,
    type HydroError,
} from '../src/error';
import { readProblemSchoolBank } from '../src/lib/teach-fields';

// Share modules are required at runtime so this file typechecks before they exist.
const __filename = fileURLToPath(import.meta.url);
const requireFromTest = createRequire(__filename);

const domainId = 'teach-domain';
const forgedDomainId = 'forged-domain';
const ownerUid = 7;
const maintainerUid = 8;
const otherUid = 9;
const adminUid = 3;
const TYPE_PROBLEM = 10;
const TYPE_CONTEST = 30;
const TYPE_TRAINING = 40;
const storedSharedAt = new Date('2026-10-02T03:04:05.000Z');
const ownHiddenTitle = '自己的隐藏题甲';
const otherHiddenTitle = '别人的隐藏题';
const otherHiddenPid = 'H43';

interface TeachActor {
    _id: number;
    uname: string;
    own: (doc: { owner: number; maintainer?: number[] }, exact?: boolean) => boolean;
    hasPerm: (...perm: bigint[]) => boolean;
    hasPriv: (...priv: number[]) => boolean;
}

interface ShareHandler {
    get: (args: Record<string, unknown>) => Promise<unknown>;
    post: (args: Record<string, unknown>) => Promise<unknown>;
    user: TeachActor;
    domain: { _id: string };
    response: { body?: unknown; template: string | null };
    request: {
        json: boolean;
        method: string;
        body: Record<string, unknown>;
        query: Record<string, unknown>;
        params: Record<string, string>;
        headers: Record<string, string>;
    };
    args: Record<string, unknown>;
    session: Record<string, unknown>;
    ctx: Record<string, unknown>;
    checkPerm: (...perms: bigint[]) => void;
    checkPriv: (...privs: number[]) => void;
}

interface RouteCall {
    name: string;
    path: string;
    Handler: new () => ShareHandler;
    extras: unknown[];
}

interface TraceItem {
    kind: 'bank' | 'set' | 'unset' | 'rollback';
    domainId: string;
    docType: number;
    id: string;
    actorId?: number;
    docIds?: number[];
    shared?: boolean;
    value?: unknown;
}

interface ModuleLoader {
    _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
    _cache: Record<string, NodeModule | undefined>;
}

const hydroHost = global as unknown as { Hydro?: { model?: Record<string, unknown> } };
if (!hydroHost.Hydro) hydroHost.Hydro = { model: {} };
if (!hydroHost.Hydro.model) hydroHost.Hydro.model = {};
const { PERM, PRIV } = requireFromTest('../src/model/builtin.ts') as {
    PERM: { PERM_EDIT_HOMEWORK_SELF: bigint; PERM_EDIT_TRAINING_SELF: bigint };
    PRIV: { PRIV_EDIT_SYSTEM: number };
};
const Module = requireFromTest('module') as ModuleLoader;
const names = new Map<number, string>([
    [ownerUid, '林老师'],
    [maintainerUid, '周维护'],
    [otherUid, '周老师'],
    [adminUid, '管理员'],
]);

const trace: TraceItem[] = [];
const infoLines: unknown[][] = [];
const errorLines: unknown[][] = [];
const contestDocs = new Map<string, Record<string, unknown>>();
const trainingDocs = new Map<string, Record<string, unknown>>();
const problems = new Map<number, Record<string, unknown>>();
let shareWriteFailure: Error | null = null;
let routes: RouteCall[] | undefined;

const replaced: Array<{ resolved: string; previous: NodeModule | undefined }> = [];
const originalLoad = Module._load;
const bodyMissing = Symbol('body-missing');

class CapturingLogger {
    info(...args: unknown[]) {
        infoLines.push(args);
    }

    error(...args: unknown[]) {
        errorLines.push(args);
    }

    warn() {}

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

function teachActor(uid: number, perms: readonly bigint[], privs: readonly number[]): TeachActor {
    let permMask = 0n;
    for (const perm of perms) permMask |= perm;
    let privMask = 0;
    for (const priv of privs) privMask |= priv;
    return {
        _id: uid,
        uname: names.get(uid) ?? `用户${uid}`,
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => (permMask & perm) === perm),
        hasPriv: (...wanted: number[]) => wanted.some((priv) => (privMask & priv) === priv),
        own: (doc, exact) => (exact === true ? doc.owner === uid : doc.owner === uid || (doc.maintainer ?? []).includes(uid)),
    };
}

const homeworkOwner = teachActor(ownerUid, [PERM.PERM_EDIT_HOMEWORK_SELF], []);
const homeworkMaintainer = teachActor(maintainerUid, [PERM.PERM_EDIT_HOMEWORK_SELF], []);
const practiceOwner = teachActor(ownerUid, [PERM.PERM_EDIT_TRAINING_SELF], []);
const systemAdmin = teachActor(adminUid, [], [PRIV.PRIV_EDIT_SYSTEM]);

function queryIds(query: unknown): number[] | null {
    if (!isRecord(query) || !Object.hasOwn(query, 'docId')) return null;
    const docId = query.docId;
    if (typeof docId === 'number') return [docId];
    if (isRecord(docId) && Array.isArray(docId.$in)) return docId.$in.filter((id): id is number => typeof id === 'number');
    return [];
}

function rollbackIds(docId: unknown): number[] {
    if (typeof docId === 'number') return [docId];
    if (isRecord(docId) && Array.isArray(docId.$in)) return docId.$in.filter((id): id is number => typeof id === 'number');
    return [];
}

function storedDoc(docType: number, id: string): Record<string, unknown> | undefined {
    if (docType === TYPE_TRAINING) return trainingDocs.get(id);
    if (docType === TYPE_CONTEST) return contestDocs.get(id);
    return undefined;
}

function noteContainerWrite(nextDomainId: string, docType: number, id: unknown, $set: unknown, $unset: unknown): void {
    const set = isRecord($set) ? $set : undefined;
    const unset = isRecord($unset) ? $unset : undefined;
    const setsShare = !!set && Object.hasOwn(set, 'schoolShared');
    const unsetsShare = !!unset && Object.hasOwn(unset, 'schoolShared');
    if (!setsShare && !unsetsShare) return;
    if (setsShare && shareWriteFailure) {
        const error = shareWriteFailure;
        shareWriteFailure = null;
        throw error;
    }
    const key = idText(id);
    if (setsShare) trace.push({ kind: 'set', domainId: nextDomainId, docType, id: key, value: set.schoolShared });
    if (unsetsShare) trace.push({ kind: 'unset', domainId: nextDomainId, docType, id: key });
    const doc = storedDoc(docType, key);
    if (!doc) return;
    if (unsetsShare) delete doc.schoolShared;
    if (setsShare) doc.schoolShared = set.schoolShared;
}

function noteUpdate(filter: unknown, update: unknown): void {
    if (!isRecord(filter) || !isRecord(update)) return;
    const docType = typeof filter.docType === 'number' ? filter.docType : 0;
    const nextDomainId = typeof filter.domainId === 'string' ? filter.domainId : '';
    if (isRecord(update.$unset) && Object.hasOwn(update.$unset, 'schoolBank')) {
        trace.push({ kind: 'rollback', domainId: nextDomainId, docType, id: idText(filter.docId) });
        for (const id of rollbackIds(filter.docId)) {
            const problem = problems.get(id);
            if (problem) delete problem.schoolBank;
        }
    }
    noteContainerWrite(nextDomainId, docType, filter.docId ?? filter._id, update.$set, update.$unset);
}

function problemCopy(doc: Record<string, unknown>): Record<string, unknown> {
    return { ...doc };
}

function problemCursor(nextDomainId: string, query: unknown) {
    const ids = queryIds(query);
    const rows = [...problems.values()].filter((doc) => {
        if (nextDomainId !== domainId) return false;
        return !ids || ids.includes(Number(doc.docId));
    }).map((doc) => problemCopy(doc));
    const cursor = {
        project() {
            return cursor;
        },
        sort() {
            return cursor;
        },
        limit() {
            return cursor;
        },
        async toArray() {
            return rows.map((row) => problemCopy(row));
        },
    };
    return cursor;
}

const contestApi = {
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
        if (nextDomainId !== domainId) throw new ContestNotFoundError(nextDomainId, id);
        const doc = contestDocs.get(idText(id));
        if (!doc) throw new ContestNotFoundError(nextDomainId, id);
        return doc;
    },
    async edit(nextDomainId: string, id: unknown, $set?: unknown, options?: unknown) {
        const unset = isRecord(options) && isRecord(options.unset)
            ? options.unset
            : isRecord(options) && Object.hasOwn(options, 'schoolShared')
                ? options
                : undefined;
        noteContainerWrite(nextDomainId, TYPE_CONTEST, id, $set, unset);
        return contestDocs.get(idText(id)) ?? null;
    },
};

const trainingApi = {
    async get(nextDomainId: string, id: unknown) {
        if (nextDomainId !== domainId) throw new TrainingNotFoundError(nextDomainId, id);
        const doc = trainingDocs.get(idText(id));
        if (!doc) throw new TrainingNotFoundError(nextDomainId, id);
        return doc;
    },
    async edit(nextDomainId: string, id: unknown, $set?: unknown, $unset?: unknown) {
        noteContainerWrite(nextDomainId, TYPE_TRAINING, id, $set, $unset);
        return trainingDocs.get(idText(id)) ?? null;
    },
};

const documentApi = {
    TYPE_PROBLEM,
    TYPE_CONTEST,
    TYPE_TRAINING,
    async get(nextDomainId: string, docType: number, id: unknown) {
        if (docType === TYPE_PROBLEM) {
            if (nextDomainId !== domainId || typeof id !== 'number') return null;
            const doc = problems.get(id);
            return doc ? problemCopy(doc) : null;
        }
        if (nextDomainId !== domainId) return null;
        return storedDoc(docType, idText(id)) ?? null;
    },
    getMulti(nextDomainId: string, docType: number, query: unknown) {
        if (docType === TYPE_PROBLEM) return problemCursor(nextDomainId, query);
        const table = docType === TYPE_TRAINING ? trainingDocs : contestDocs;
        const ids = queryIds(query);
        const rows = [...table.values()].filter((doc) => {
            if (nextDomainId !== domainId) return false;
            return !ids || ids.includes(Number(doc.docId));
        });
        const cursor = {
            project() {
                return cursor;
            },
            sort() {
                return cursor;
            },
            async toArray() {
                return rows;
            },
        };
        return cursor;
    },
    async set(nextDomainId: string, docType: number, id: unknown, $set?: unknown, $unset?: unknown) {
        noteContainerWrite(nextDomainId, docType, id, $set, $unset);
        return storedDoc(docType, idText(id)) ?? null;
    },
    coll: {
        async updateOne(filter: unknown, update: unknown) {
            noteUpdate(filter, update);
            return { matchedCount: 1, modifiedCount: 1 };
        },
        async updateMany(filter: unknown, update: unknown) {
            noteUpdate(filter, update);
            return { matchedCount: 1, modifiedCount: 1 };
        },
        async findOneAndUpdate(filter: unknown, update: unknown) {
            noteUpdate(filter, update);
            return null;
        },
    },
};

const problemApi = {
    PROJECTION_CONTEST_LIST: ['docId', 'pid', 'title', 'config'],
    async getList(nextDomainId: string, pids: unknown, canViewHidden: unknown = false) {
        const found: Record<string, Record<string, unknown>> = {};
        if (nextDomainId !== domainId || !Array.isArray(pids)) return found;
        for (const pid of pids) {
            if (typeof pid !== 'number') continue;
            const doc = problems.get(pid);
            if (!doc) continue;
            if (canViewHidden !== true && doc.hidden === true && doc.owner !== canViewHidden) continue;
            const copy = problemCopy(doc);
            found[pid] = copy;
            if (typeof doc.pid === 'string') found[doc.pid] = copy;
        }
        return found;
    },
    async get(nextDomainId: string, id: unknown) {
        if (nextDomainId !== domainId || typeof id !== 'number') return null;
        const doc = problems.get(id);
        return doc ? problemCopy(doc) : null;
    },
};

const userApi = {
    async getById(nextDomainId: string, uid: unknown) {
        if (nextDomainId !== domainId || typeof uid !== 'number') return null;
        const uname = names.get(uid);
        return uname ? { _id: uid, uname } : null;
    },
    async getList(nextDomainId: string, uids: unknown) {
        const out: Record<number, { _id: number; uname: string }> = {};
        if (nextDomainId !== domainId || !Array.isArray(uids)) return out;
        for (const uid of uids) {
            if (typeof uid !== 'number') continue;
            const uname = names.get(uid);
            if (uname) out[uid] = { _id: uid, uname };
        }
        return out;
    },
};

function canToggleProblemSchoolBank(
    actor: { _id: number; hasPriv: (...priv: number[]) => boolean },
    pdoc: { owner?: unknown; authoringMode?: unknown },
): boolean {
    if (actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return true;
    return pdoc.owner === actor._id && pdoc.authoringMode !== 'managed';
}

const schoolBankApi = {
    isProblemInSchoolBank(pdoc: { schoolBank?: unknown }) {
        return readProblemSchoolBank(pdoc.schoolBank) !== null;
    },
    canToggleProblemSchoolBank,
    async setProblemSchoolBank(
        nextDomainId: string,
        actor: { _id: number },
        docIds: unknown,
        shared: unknown,
    ) {
        const ids = Array.isArray(docIds) ? docIds.filter((id): id is number => typeof id === 'number') : [];
        trace.push({
            kind: 'bank',
            domainId: nextDomainId,
            docType: TYPE_PROBLEM,
            id: '',
            actorId: actor._id,
            docIds: [...ids],
            shared: shared === true,
        });
        for (const id of ids) {
            const problem = problems.get(id);
            if (!problem) continue;
            if (shared === true) problem.schoolBank = { sharedBy: actor._id, sharedAt: new Date() };
            else if (shared === false) delete problem.schoolBank;
        }
        return { changed: [...ids], unchanged: [] as number[] };
    },
    async listSchoolBankDocIds() {
        return [];
    },
};

class ShareTestHandler {
    user: TeachActor = homeworkOwner;

    domain = { _id: domainId };

    response: { body?: unknown; template: string | null } = { body: bodyMissing, template: null };

    request = {
        json: true,
        method: 'GET',
        body: {} as Record<string, unknown>,
        query: {} as Record<string, unknown>,
        params: {} as Record<string, string>,
        headers: {} as Record<string, string>,
    };

    args: Record<string, unknown> = {};

    session: Record<string, unknown> = {};

    ctx: Record<string, unknown> = {};

    checkPerm(...perms: bigint[]) {
        if (!this.user.hasPerm(...perms)) throw new PermissionError(...perms);
    }

    checkPriv(...privs: number[]) {
        if (!this.user.hasPriv(...privs)) throw new PrivilegeError(...privs);
    }
}

const serverApi = {
    Handler: ShareTestHandler,
    param,
    post,
    get,
    route: routeParam,
    Types,
};

function installStub(relativePath: string, exports: Record<string, unknown>): void {
    const resolved = requireFromTest.resolve(relativePath);
    replaced.push({ resolved, previous: Module._cache[resolved] });
    const entry = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports,
        children: [],
        paths: [],
    } as NodeModule;
    Module._cache[resolved] = entry;
    requireFromTest.cache[resolved] = entry;
}

function published(api: Record<string, unknown>): Record<string, unknown> {
    return { ...api, __esModule: true, default: api };
}

installStub('../src/model/contest.ts', published(contestApi));
installStub('../src/model/training.ts', published(trainingApi));
installStub('../src/model/document.ts', published(documentApi));
installStub('../src/model/problem.ts', published(problemApi));
installStub('../src/model/problem-school-bank.ts', published(schoolBankApi));
installStub('../src/model/user.ts', published(userApi));
installStub('../src/logger.ts', { Logger: CapturingLogger, logger: new CapturingLogger(), __esModule: true, default: CapturingLogger });
installStub('../src/service/server.ts', serverApi);

hydroHost.Hydro.model.contest = contestApi;
hydroHost.Hydro.model.training = trainingApi;
hydroHost.Hydro.model.document = documentApi;
hydroHost.Hydro.model.problem = problemApi;
hydroHost.Hydro.model.user = userApi;

function isTeachShare(filename: string | undefined): boolean {
    if (!filename) return false;
    const normalized = filename.replaceAll('\\', '/');
    return normalized.endsWith('/src/model/teach-share.ts')
        || normalized.endsWith('/src/handler/teach-share.ts')
        || normalized.endsWith('/src/model/teach-share.js')
        || normalized.endsWith('/src/handler/teach-share.js');
}

Module._load = function load(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (isTeachShare(parent?.filename) && (request === '@hydrooj/utils' || request === '@hydrooj/utils/lib/utils')) {
        const real: unknown = originalLoad.call(this, request, parent, isMain);
        if (isRecord(real)) return { ...real, Logger: CapturingLogger };
        return { Logger: CapturingLogger };
    }
    return originalLoad.call(this, request, parent, isMain);
};

function resetFixtures(): void {
    trace.length = 0;
    infoLines.length = 0;
    errorLines.length = 0;
    contestDocs.clear();
    trainingDocs.clear();
    problems.clear();
    shareWriteFailure = null;
}

function putProblem(docId: number, fields: Record<string, unknown>): void {
    problems.set(docId, {
        domainId,
        pid: `P${docId}`,
        title: `题目${docId}`,
        owner: ownerUid,
        hidden: false,
        problemKind: 'programming',
        ...fields,
        docId,
    });
}

function putHomework(pids: number[], fields: Record<string, unknown> = {}): ObjectId {
    const docId = new ObjectId();
    contestDocs.set(docId.toHexString(), {
        domainId,
        owner: ownerUid,
        maintainer: [maintainerUid],
        rule: 'homework',
        title: '共享作业',
        pids,
        beginAt: new Date('2026-10-01T00:00:00.000Z'),
        endAt: new Date('2026-10-31T00:00:00.000Z'),
        ...fields,
        docId,
        _id: docId,
    });
    return docId;
}

function putPractice(dag: Record<string, unknown>[]): ObjectId {
    const docId = new ObjectId();
    trainingDocs.set(docId.toHexString(), {
        domainId,
        docId,
        _id: docId,
        owner: ownerUid,
        maintainer: [],
        kind: 'problem_set',
        title: '共享练习',
        dag,
    });
    return docId;
}

function missingExport(error: unknown): Error {
    if (error instanceof Error && error.message.startsWith('teach export missing:')) return error;
    const detail = error instanceof Error ? error.message : String(error);
    return new TypeError(`teach export missing: ${detail}`);
}

function readApply(loaded: Record<string, unknown>): ((ctx: unknown) => unknown) | null {
    if (typeof loaded.apply === 'function') return loaded.apply as (ctx: unknown) => unknown;
    if (isRecord(loaded.default) && typeof loaded.default.apply === 'function') return loaded.default.apply as (ctx: unknown) => unknown;
    return null;
}

async function ensureRoutes(): Promise<RouteCall[]> {
    if (routes) return routes;
    let loaded: unknown;
    try {
        loaded = requireFromTest('../src/handler/teach-share.ts');
    } catch (error) {
        throw missingExport(error);
    }
    if (!isRecord(loaded)) throw new TypeError('teach export missing: apply');
    const apply = readApply(loaded);
    if (!apply) throw new TypeError('teach export missing: apply');
    const found: RouteCall[] = [];
    await apply({
        Route(name: unknown, path: unknown, Handler: unknown, ...extras: unknown[]) {
            if (typeof name !== 'string' || typeof path !== 'string' || typeof Handler !== 'function') {
                throw new TypeError(`teach export missing: route ${String(name)}`);
            }
            found.push({ name, path, Handler: Handler as new () => ShareHandler, extras });
        },
    });
    const route = found.find((item) => item.name === 'teach_share') ?? found.find((item) => item.path === '/teach/:type/:id/share');
    if (!route) throw new TypeError('teach export missing: teach_share');
    routes = found;
    return found;
}

async function shareRoute(): Promise<RouteCall> {
    const found = await ensureRoutes();
    const route = found.find((item) => item.name === 'teach_share');
    if (!route || route.path !== '/teach/:type/:id/share') throw new TypeError('teach export missing: teach_share');
    return route;
}

function runChecks(handler: ShareHandler, extras: unknown[]): void {
    for (const item of extras) {
        if (typeof item === 'number') handler.checkPriv(item);
        else if (typeof item === 'bigint') handler.checkPerm(item);
        else if (Array.isArray(item) && item.every((entry) => typeof entry === 'number')) handler.checkPriv(...item);
        else if (Array.isArray(item) && item.every((entry) => typeof entry === 'bigint')) handler.checkPerm(...item);
        else if (typeof item === 'function') item.call(handler);
    }
}

async function callShare(
    method: 'get' | 'post',
    actor: TeachActor,
    type: string,
    id: ObjectId,
    body?: Record<string, unknown>,
): Promise<unknown> {
    const route = await shareRoute();
    const handler = new route.Handler();
    const idHex = id.toHexString();
    const args: Record<string, unknown> = { domainId: forgedDomainId, type, id: idHex, ...(body ?? {}) };
    handler.user = actor;
    handler.domain = { _id: domainId };
    handler.response = { body: bodyMissing, template: null };
    handler.request = {
        json: true,
        method: method === 'post' ? 'POST' : 'GET',
        body: { ...(body ?? {}) },
        query: {},
        params: { type, id: idHex },
        headers: {},
    };
    handler.args = args;
    runChecks(handler, route.extras);
    const returned = await handler[method](args);
    return handler.response.body !== bodyMissing ? handler.response.body : returned;
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

function errorText(error: unknown): string {
    if (!(error instanceof Error)) return '';
    const withParams = error as Error & { params?: unknown };
    const params = Array.isArray(withParams.params) ? withParams.params : [];
    const metadata = getLocalizedErrorMetadata(error as HydroError);
    const templates = [metadata?.message?.template ?? '', ...[...(metadata?.parameters.values() ?? [])].map((item) => item.template)];
    return [error.message, ...params.map((item) => String(item)), ...templates].join('\n');
}

function errorField(error: unknown): string {
    if (!isRecord(error) || !Array.isArray(error.params)) return '';
    return typeof error.params[0] === 'string' ? error.params[0] : '';
}

function expectNoWrites(): void {
    expect(trace.length).to.equal(0);
}

function expectOthersHiddenRejected(error: unknown, listed: string): void {
    expect(error instanceof Error ? error.name : '').to.equal('ValidationError');
    expect(errorField(error)).to.equal('shared');
    const transport = resolveErrorTransport(error, { locale: 'zh-CN', lookup: () => null });
    const message = transport.error.message;
    expect(transport.status).to.equal(403);
    expect(message).to.equal(`题目集里有别人的隐藏题还没共享，不能共享：${listed}`);
    expect(message.includes('Unexpected server error')).to.equal(false);
    expect(message.includes('{0}')).to.equal(false);
    expectNoWrites();
}

function loggedText(lines: unknown[][]): string {
    return lines.map((args) => args.map((item) => {
        if (item instanceof Date) return item.toISOString();
        if (item instanceof ObjectId) return item.toHexString();
        if (item && typeof item === 'object') {
            try {
                return JSON.stringify(item, (_key, value) => {
                    if (value instanceof ObjectId) return value.toHexString();
                    if (value instanceof Date) return value.toISOString();
                    return value;
                });
            } catch {
                return String(item);
            }
        }
        return String(item);
    }).join(' ')).join('\n');
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
    expect(isRecord(value), label).to.equal(true);
    if (!isRecord(value)) throw new Error(label);
    return value;
}

function rowsOf(value: unknown, label: string): Record<string, unknown>[] {
    expect(Array.isArray(value), label).to.equal(true);
    if (!Array.isArray(value)) return [];
    return value.map((item, index) => expectRecord(item, `${label}[${index}]`));
}

function stateOf(value: unknown): Record<string, unknown> {
    const state = expectRecord(value, 'TeachShareState');
    expect(typeof state.canShare).to.equal('boolean');
    expect(state.shared === null || isRecord(state.shared), 'shared').to.equal(true);
    rowsOf(state.ownHiddenUnshared, 'ownHiddenUnshared');
    rowsOf(state.othersHiddenUnshared, 'othersHiddenUnshared');
    return state;
}

function docIdsOf(rows: Record<string, unknown>[]): number[] {
    return rows.map((row) => Number(row.docId)).sort((left, right) => left - right);
}

function bankCalls(): TraceItem[] {
    return trace.filter((item) => item.kind === 'bank');
}

function shareSets(): TraceItem[] {
    return trace.filter((item) => item.kind === 'set');
}

function shareUnsets(): TraceItem[] {
    return trace.filter((item) => item.kind === 'unset');
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

describe('school sharing of problem sets', { concurrency: false }, () => {
    it('registers get and post /teach/:type/:id/share as teach_share', async () => {
        const found = await ensureRoutes();
        const route = found.find((item) => item.name === 'teach_share');
        expect(route?.path).to.equal('/teach/:type/:id/share');
        expect(found.filter((item) => item.path === '/teach/:type/:id/share').length).to.equal(1);
    });

    it('lets a maintainer read canShare false and rejects the maintainer post', async () => {
        const tid = putHomework([]);
        const state = stateOf(await callShare('get', homeworkMaintainer, 'homework', tid));
        expect(state.canShare).to.equal(false);
        expect(state.shared).to.equal(null);
        expectNoWrites();

        const error = await rejectionOf(() => callShare('post', homeworkMaintainer, 'homework', tid, { shared: true }));
        expect(error instanceof Error ? error.name : '').to.equal('PermissionError');
        expect(errorText(error)).to.include('只有所有者能共享这个题目集。');
        expectNoWrites();
    });

    it('rejects sharing when another teacher has a hidden problem outside the school bank', async () => {
        putProblem(41, { pid: 'V41', title: '公开题', owner: otherUid, hidden: false });
        putProblem(42, {
            pid: 'S42',
            title: '已共享隐藏题',
            owner: otherUid,
            hidden: true,
            schoolBank: { sharedBy: otherUid, sharedAt: storedSharedAt },
        });
        putProblem(43, { pid: otherHiddenPid, title: otherHiddenTitle, owner: otherUid, hidden: true });
        putProblem(44, { pid: 'V44', title: '自己的公开题', owner: ownerUid, hidden: false });
        const tid = putHomework([41, 42, 43, 44]);

        const state = stateOf(await callShare('get', homeworkOwner, 'homework', tid));
        expect(state.canShare).to.equal(true);
        expect(docIdsOf(rowsOf(state.ownHiddenUnshared, 'ownHiddenUnshared'))).to.deep.equal([]);
        const others = rowsOf(state.othersHiddenUnshared, 'othersHiddenUnshared');
        expect(others.length).to.equal(1);
        expect(others[0]?.docId).to.equal(43);
        expect(others[0]?.pid).to.equal(otherHiddenPid);
        expect(others[0]?.title).to.equal(otherHiddenTitle);
        expect(others[0]?.ownerName).to.equal('周老师');
        expectNoWrites();

        const error = await rejectionOf(() => callShare('post', homeworkOwner, 'homework', tid, { shared: true }));
        expectOthersHiddenRejected(error, `${otherHiddenPid} ${otherHiddenTitle}`);

        const bracedTitle = '集合{1}';
        putProblem(46, { pid: 'H46', title: bracedTitle, owner: otherUid, hidden: true });
        const braced = putHomework([46]);
        const bracedError = await rejectionOf(() => callShare('post', homeworkOwner, 'homework', braced, { shared: true }));
        expectOthersHiddenRejected(bracedError, `H46 ${bracedTitle}`);
    });

    it('shares the owner hidden problems before writing the container share', async () => {
        putProblem(51, { pid: 'H51', title: ownHiddenTitle, owner: ownerUid, hidden: true });
        putProblem(52, { pid: 'H52', title: '自己的隐藏题乙', owner: ownerUid, hidden: true });
        putProblem(53, { pid: 'V53', title: '自己的公开题', owner: ownerUid, hidden: false });
        const tid = putHomework([53, 51, 52]);

        const missingFlag = await rejectionOf(() => callShare('post', homeworkOwner, 'homework', tid, { shared: true }));
        expect(missingFlag instanceof Error ? missingFlag.name : '').to.equal('ValidationError');
        expect(errorField(missingFlag)).to.equal('shareOwnProblems');
        expect(errorText(missingFlag)).to.include('需要先把你自己的 2 道隐藏题共享到学校题库');
        expectNoWrites();

        const explicitFalse = await rejectionOf(() => callShare('post', homeworkOwner, 'homework', tid, { shared: true, shareOwnProblems: false }));
        expect(errorField(explicitFalse)).to.equal('shareOwnProblems');
        expect(errorText(explicitFalse)).to.include('需要先把你自己的 2 道隐藏题共享到学校题库');
        expectNoWrites();

        const state = stateOf(await callShare('post', homeworkOwner, 'homework', tid, {
            shared: true,
            shareOwnProblems: true,
            expectedOwnDocIds: [52, 51],
        }));
        expect(trace.map((item) => item.kind)).to.deep.equal(['bank', 'set']);
        const bank = bankCalls()[0];
        const written = shareSets()[0];
        expect(bank?.domainId).to.equal(domainId);
        expect(bank?.actorId).to.equal(ownerUid);
        expect(bank?.shared).to.equal(true);
        expect([...(bank?.docIds ?? [])].sort((left, right) => left - right)).to.deep.equal([51, 52]);
        expect(written?.domainId).to.equal(domainId);
        expect(written?.docType).to.equal(TYPE_CONTEST);
        expect(written?.id).to.equal(tid.toHexString());
        const value = expectRecord(written?.value, 'schoolShared');
        expect(value.sharedBy).to.equal(ownerUid);
        expect(value.sharedAt instanceof Date).to.equal(true);
        expect(Object.keys(value).sort()).to.deep.equal(['sharedAt', 'sharedBy']);
        expect(state.canShare).to.equal(true);
        expect(docIdsOf(rowsOf(state.ownHiddenUnshared, 'ownHiddenUnshared'))).to.deep.equal([]);
        expect(docIdsOf(rowsOf(state.othersHiddenUnshared, 'othersHiddenUnshared'))).to.deep.equal([]);
        const shared = expectRecord(state.shared, 'shared');
        expect(shared.sharedByName).to.equal('林老师');
        expect(shared.sharedAt).to.equal(value.sharedAt instanceof Date ? value.sharedAt.toISOString() : '');
        const info = loggedText(infoLines);
        expect(info.includes(domainId)).to.equal(true);
        expect(info.includes(String(ownerUid))).to.equal(true);
        expect(info.includes(tid.toHexString())).to.equal(true);
        expect(info.includes(ownHiddenTitle)).to.equal(false);
    });

    it('rejects a share when the expected problem ids do not match', async () => {
        putProblem(51, { pid: 'H51', title: ownHiddenTitle, owner: ownerUid, hidden: true });
        putProblem(52, { pid: 'H52', title: '自己的隐藏题乙', owner: ownerUid, hidden: true });
        const tid = putHomework([51, 52]);
        const shortList = await rejectionOf(() => callShare('post', homeworkOwner, 'homework', tid, {
            shared: true,
            shareOwnProblems: true,
            expectedOwnDocIds: [51],
        }));
        expect(shortList instanceof Error ? shortList.name : '').to.equal('ValidationError');
        expect(errorField(shortList)).to.equal('expectedOwnDocIds');
        expect(errorText(shortList)).to.include('题目集里的题刚刚有变化，请重新打开共享');
        expectNoWrites();

        const extra = await rejectionOf(() => callShare('post', homeworkOwner, 'homework', tid, {
            shared: true,
            shareOwnProblems: true,
            expectedOwnDocIds: [51, 52, 99],
        }));
        expect(errorField(extra)).to.equal('expectedOwnDocIds');
        expect(errorText(extra)).to.include('题目集里的题刚刚有变化，请重新打开共享');
        expectNoWrites();
    });

    it('unsets schoolShared once and does not write the second cancel', async () => {
        putProblem(43, { pid: otherHiddenPid, title: otherHiddenTitle, owner: otherUid, hidden: true });
        const tid = putHomework([43], {
            schoolShared: { sharedBy: ownerUid, sharedAt: storedSharedAt },
        });
        const first = stateOf(await callShare('post', homeworkOwner, 'homework', tid, { shared: false }));
        expect(shareUnsets().length).to.equal(1);
        expect(shareSets().length).to.equal(0);
        expect(bankCalls().length).to.equal(0);
        expect(shareUnsets()[0]?.domainId).to.equal(domainId);
        expect(shareUnsets()[0]?.docType).to.equal(TYPE_CONTEST);
        expect(shareUnsets()[0]?.id).to.equal(tid.toHexString());
        expect(first.shared).to.equal(null);
        expect(first.canShare).to.equal(true);
        const info = loggedText(infoLines);
        expect(info.includes(domainId)).to.equal(true);
        expect(info.includes(tid.toHexString())).to.equal(true);
        expect(info.includes(otherHiddenTitle)).to.equal(false);

        const second = stateOf(await callShare('post', homeworkOwner, 'homework', tid, { shared: false }));
        expect(shareUnsets().length).to.equal(1);
        expect(shareSets().length).to.equal(0);
        expect(second.shared).to.equal(null);
    });

    it('does not rewrite schoolShared when the container is already shared', async () => {
        putProblem(61, { pid: 'H61', title: ownHiddenTitle, owner: ownerUid, hidden: true });
        const tid = putHomework([61], {
            schoolShared: { sharedBy: ownerUid, sharedAt: storedSharedAt },
        });
        const state = stateOf(await callShare('post', homeworkOwner, 'homework', tid, {
            shared: true,
            shareOwnProblems: true,
            expectedOwnDocIds: [61],
        }));
        expect(bankCalls().length).to.equal(1);
        expect(bankCalls()[0]?.shared).to.equal(true);
        expect(bankCalls()[0]?.docIds).to.deep.equal([61]);
        expect(shareSets().length).to.equal(0);
        expect(shareUnsets().length).to.equal(0);
        const shared = expectRecord(state.shared, 'shared');
        expect(shared.sharedAt).to.equal(storedSharedAt.toISOString());
        expect(shared.sharedByName).to.equal('林老师');
        expect(docIdsOf(rowsOf(state.ownHiddenUnshared, 'ownHiddenUnshared'))).to.deep.equal([]);
        expect(problems.get(61)?.schoolBank !== undefined).to.equal(true);
    });

    it('puts a managed hidden problem with the other teachers and lets an admin share any hidden problem', async () => {
        putProblem(71, { pid: 'M71', title: '托管隐藏题', owner: ownerUid, hidden: true, authoringMode: 'managed' });
        const owned = putHomework([71]);
        const ownerState = stateOf(await callShare('get', homeworkOwner, 'homework', owned));
        const others = rowsOf(ownerState.othersHiddenUnshared, 'othersHiddenUnshared');
        expect(docIdsOf(rowsOf(ownerState.ownHiddenUnshared, 'ownHiddenUnshared'))).to.deep.equal([]);
        expect(others.length).to.equal(1);
        expect(others[0]?.docId).to.equal(71);
        expect(others[0]?.ownerName).to.equal('林老师');
        const blocked = await rejectionOf(() => callShare('post', homeworkOwner, 'homework', owned, { shared: true }));
        expect(errorField(blocked)).to.equal('shared');
        expect(errorText(blocked)).to.include('题目集里有别人的隐藏题还没共享，不能共享：');
        expectNoWrites();

        problems.clear();
        putProblem(72, { pid: 'H72', title: otherHiddenTitle, owner: otherUid, hidden: true });
        const foreign = putHomework([72]);
        const adminState = stateOf(await callShare('get', systemAdmin, 'homework', foreign));
        expect(adminState.canShare).to.equal(true);
        expect(docIdsOf(rowsOf(adminState.ownHiddenUnshared, 'ownHiddenUnshared'))).to.deep.equal([72]);
        expect(docIdsOf(rowsOf(adminState.othersHiddenUnshared, 'othersHiddenUnshared'))).to.deep.equal([]);
    });

    it('reads a hidden problem from a practice stage', async () => {
        putProblem(81, { pid: 'H81', title: ownHiddenTitle, owner: ownerUid, hidden: true });
        const tid = putPractice([
            { _id: 1, title: '阶段一', requireNids: [], pids: [] },
            { _id: 2, title: '阶段二', requireNids: [1], pids: [81] },
        ]);
        const error = await rejectionOf(() => callShare('post', practiceOwner, 'practice', tid, { shared: true }));
        expect(errorField(error)).to.equal('shareOwnProblems');
        expect(errorText(error)).to.include('需要先把你自己的 1 道隐藏题共享到学校题库');
        expectNoWrites();

        const state = stateOf(await callShare('post', practiceOwner, 'practice', tid, {
            shared: true,
            shareOwnProblems: true,
            expectedOwnDocIds: [81],
        }));
        expect(trace.map((item) => item.kind)).to.deep.equal(['bank', 'set']);
        expect(shareSets()[0]?.docType).to.equal(TYPE_TRAINING);
        expect(shareSets()[0]?.id).to.equal(tid.toHexString());
        expect(state.canShare).to.equal(true);
        expect(docIdsOf(rowsOf(state.ownHiddenUnshared, 'ownHiddenUnshared'))).to.deep.equal([]);
    });

    it('rethrows the container write error and does not roll back the school bank', async () => {
        putProblem(51, { pid: 'H51', title: ownHiddenTitle, owner: ownerUid, hidden: true });
        putProblem(52, { pid: 'H52', title: '自己的隐藏题乙', owner: ownerUid, hidden: true });
        const tid = putHomework([51, 52]);
        const failure = new Error('share-write-failed');
        shareWriteFailure = failure;
        const error = await rejectionOf(() => callShare('post', homeworkOwner, 'homework', tid, {
            shared: true,
            shareOwnProblems: true,
            expectedOwnDocIds: [51, 52],
        }));
        expect(error).to.equal(failure);
        expect(bankCalls().length).to.equal(1);
        expect(bankCalls()[0]?.shared).to.equal(true);
        expect([...(bankCalls()[0]?.docIds ?? [])].sort((left, right) => left - right)).to.deep.equal([51, 52]);
        expect(shareSets().length).to.equal(0);
        expect(shareUnsets().length).to.equal(0);
        expect(trace.some((item) => item.kind === 'rollback' || (item.kind === 'bank' && item.shared === false))).to.equal(false);
        expect(problems.get(51)?.schoolBank !== undefined).to.equal(true);
        expect(problems.get(52)?.schoolBank !== undefined).to.equal(true);
        const errors = loggedText(errorLines);
        expect(errors.includes('51') || errors.includes('H51')).to.equal(true);
        expect(errors.includes('52') || errors.includes('H52')).to.equal(true);
        expect(errors.includes(ownHiddenTitle)).to.equal(false);
    });
});
