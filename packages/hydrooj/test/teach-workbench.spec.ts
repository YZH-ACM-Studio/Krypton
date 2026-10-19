import { createRequire, type Module as NodeModule } from 'node:module';
import { after, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { STATUS } from '@hydrooj/common';
import { param } from '@hydrooj/framework/decorators';
import { Types } from '@hydrooj/framework/validator';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { ContestNotFoundError, getLocalizedErrorMetadata, TrainingNotFoundError, type HydroError } from '../src/error';
import { registerStudentDirectory, type StudentDirectory, type StudentDirectoryStudent } from '../src/service/student-directory';

// Workbench modules are required at runtime so this file typechecks before they exist.
const __filename = fileURLToPath(import.meta.url);
const requireFromTest = createRequire(__filename);

const domainId = 'teach-domain';
const forgedDomainId = 'forged-domain';
const ownerUid = 7;
const maintainerUid = 8;
const sharerUid = 9;
const strangerUid = 4;
const groupId = new ObjectId('64b0000000000000000000c1');
const schoolId = new ObjectId('64b0000000000000000000d1');
const beginAt = new Date('2020-01-01T00:00:00.000Z');
const endAt = new Date('2099-01-01T00:00:00.000Z');
const sharedAt = new Date('2026-10-02T03:04:05.000Z');
const copiedAt = new Date('2026-10-03T06:07:08.000Z');
const lockAt = new Date('2026-10-16T08:30:00.000Z');
const penaltySince = new Date('2026-10-18T12:00:00.000Z');
const secretStudent = 'SECRET-STUDENT-2026';
const secretStudentId = 'SID-SECRET';
const missingDocId = 905001;
const TYPE_CONTEST = 30;
const TYPE_TRAINING = 40;

interface TeachActor {
    _id: number;
    uname: string;
    timeZone: string;
    own: (doc: { owner: number; maintainer?: number[] }, exact?: boolean) => boolean;
    hasPerm: (...perm: bigint[]) => boolean;
    hasPriv: (...priv: number[]) => boolean;
}

interface PageResponse {
    body: Record<string, unknown>;
    template: string | null;
}

interface PageHandler {
    get: (args: { domainId: string; type: string; id: string }) => Promise<unknown>;
    user: TeachActor;
    domain: { _id: string };
    response: PageResponse;
    request: {
        method: string;
        params: Record<string, string>;
        query: Record<string, unknown>;
        body: Record<string, unknown>;
        headers: Record<string, string>;
    };
    args: Record<string, unknown>;
}

interface RouteCall {
    name: string;
    path: string;
    HandlerClass: new () => PageHandler;
}

interface ModelCall {
    domainId: string;
    id: unknown;
}

interface StatusDoc {
    domainId: string;
    docType: number;
    docId: ObjectId;
    uid: number;
    attend?: number;
    enroll?: number;
    startAt?: Date;
    paperFinalizedAt?: Date;
    journal?: Array<{ pid: number; status: number }>;
}

interface ModuleLoader {
    _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
    _cache: Record<string, NodeModule | undefined>;
}

type RouteName = 'teach_workbench' | 'teach_compose';

const hydroHost = global as unknown as { Hydro?: { model?: Record<string, unknown> } };
if (!hydroHost.Hydro) hydroHost.Hydro = { model: {} };
if (!hydroHost.Hydro.model) hydroHost.Hydro.model = {};
const { PERM, PRIV } = requireFromTest('../src/model/builtin.ts') as typeof import('../src/model/builtin');
const Module = requireFromTest('module') as ModuleLoader;

const users = new Map<number, { _id: number; uname: string }>([
    [ownerUid, { _id: ownerUid, uname: '林老师' }],
    [maintainerUid, { _id: maintainerUid, uname: '周老师' }],
    [sharerUid, { _id: sharerUid, uname: '共享人' }],
]);
const knowledgeFixture = [
    {
        id: '64b0000000000000000000a1',
        mapId: '64b0000000000000000000b1',
        mapTitle: '算法',
        label: '二分',
        tags: ['binary'],
    },
    {
        id: '64b0000000000000000000a2',
        mapId: '64b0000000000000000000b1',
        mapTitle: '算法',
        label: '图论',
        tags: ['graph'],
    },
];

const contestCalls: ModelCall[] = [];
const trainingCalls: ModelCall[] = [];
const getListCalls: unknown[][] = [];
const loggerErrors: unknown[][] = [];
const boundQueries: Array<{ domainId: string; groupIds: string[] }> = [];
const contestDocs = new Map<string, Record<string, unknown>>();
const trainingDocs = new Map<string, Record<string, unknown>>();
const problems = new Map<number, Record<string, unknown>>();
const statusDocs: StatusDoc[] = [];
const teamStatusDocs: Record<string, unknown>[] = [];
const teamDocs: Record<string, unknown>[] = [];
const recordCounts = new Map<string, number>();
const teamMemberA = 880011;
const teamMemberB = 880012;
let routes: RouteCall[] | undefined;
let loadError: unknown;

const replaced: Array<{ resolved: string; previous: NodeModule | undefined }> = [];
const originalLoad = Module._load;

class CapturingLogger {
    error(...args: unknown[]) {
        loggerErrors.push(args);
    }

    info() {}

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

function sameId(left: unknown, right: unknown): boolean {
    const leftText = idText(left);
    const rightText = idText(right);
    return leftText !== '' && leftText === rightText;
}

function teachActor(uid: number, perms: readonly bigint[] = [], privs: readonly number[] = []): TeachActor {
    const permSet = new Set<bigint>(perms);
    const privSet = new Set<number>(privs);
    return {
        _id: uid,
        uname: users.get(uid)?.uname ?? 'user',
        timeZone: 'Asia/Shanghai',
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => permSet.has(perm)),
        hasPriv: (...wanted: number[]) => wanted.some((priv) => privSet.has(priv)),
        own: (doc, exact) => (exact === true ? doc.owner === uid : doc.owner === uid || (doc.maintainer || []).includes(uid)),
    };
}

function canCreateAllProblemKinds(user: { hasPerm: (...perm: bigint[]) => boolean; hasPriv: (...priv: number[]) => boolean }): boolean {
    return user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || user.hasPerm(PERM.PERM_CREATE_PROBLEM);
}

function canManageTeamBatches(user: { hasPerm: (...perm: bigint[]) => boolean; hasPriv: (...priv: number[]) => boolean }): boolean {
    return user.hasPerm(PERM.PERM_CREATE_CONTEST) || user.hasPerm(PERM.PERM_EDIT_CONTEST) || user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
}

function userOf(uid: unknown): { _id: number; uname: string } | null {
    const key = typeof uid === 'number' ? uid : typeof uid === 'string' && /^[1-9]\d*$/.test(uid) ? Number(uid) : Number.NaN;
    if (!Number.isSafeInteger(key)) return null;
    const found = users.get(key);
    return found ? { ...found } : null;
}

function matchesQuery(doc: Record<string, unknown>, query: unknown): boolean {
    if (!isRecord(query)) return true;
    for (const [key, expected] of Object.entries(query)) {
        if (key === 'docType') {
            if (doc.docType !== expected) return false;
            continue;
        }
        const actual = doc[key];
        if (expected instanceof ObjectId || typeof expected === 'string') {
            if (!sameId(actual, expected) && actual !== expected) return false;
            continue;
        }
        if (isRecord(expected) && Array.isArray(expected.$in)) {
            const found = expected.$in.some((item) => (item instanceof ObjectId || typeof item === 'string' ? sameId(actual, item) : actual === item));
            if (!found) return false;
            continue;
        }
        if (actual !== expected) return false;
    }
    return true;
}

function statusCursor(forcedDomain: string | null, query: unknown) {
    const rows = statusDocs.filter((doc) => {
        if (forcedDomain && doc.domainId !== forcedDomain) return false;
        return matchesQuery(doc as unknown as Record<string, unknown>, query);
    });
    const cursor = {
        project() {
            return cursor;
        },
        sort() {
            return cursor;
        },
        async toArray() {
            return rows.map((doc) => ({
                ...doc,
                journal: doc.journal?.map((row) => ({ ...row })),
            }));
        },
    };
    return cursor;
}

function countRecords(query: unknown): number {
    if (!isRecord(query) || query.domainId !== domainId) return 0;
    return recordCounts.get(idText(query.contest)) ?? 0;
}

function rowCursor(rows: readonly Record<string, unknown>[], query: unknown) {
    const matched = rows.filter((doc) => matchesQuery(doc, query));
    const cursor = {
        project() {
            return cursor;
        },
        sort() {
            return cursor;
        },
        async toArray() {
            return matched.map((doc) => ({
                ...doc,
                journal: Array.isArray(doc.journal) ? doc.journal.map((entry) => (isRecord(entry) ? { ...entry } : entry)) : doc.journal,
                memberUids: Array.isArray(doc.memberUids) ? [...doc.memberUids] : doc.memberUids,
            }));
        },
    };
    return cursor;
}

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

function isWorkbench(filename: string | undefined): boolean {
    if (!filename) return false;
    const normalized = filename.replaceAll('\\', '/');
    return normalized.endsWith('/src/lib/teach-workbench.ts')
        || normalized.endsWith('/src/handler/teach-workbench.ts')
        || normalized.endsWith('/src/lib/teach-workbench.js')
        || normalized.endsWith('/src/handler/teach-workbench.js');
}

function loggerModule(): Record<string, unknown> {
    return { Logger: CapturingLogger, logger: new CapturingLogger(), default: CapturingLogger };
}

installStub('../src/model/contest.ts', {
    RULES: {
        acm: {},
        oi: {},
        ioi: {},
        ledo: {},
        strictioi: {},
        exam: {},
        homework: { hidden: true },
    },
    getParticipationMode(doc: { participationMode?: unknown }) {
        return doc?.participationMode === 'team' ? 'team' : 'individual';
    },
    async get(nextDomainId: string, id: unknown) {
        contestCalls.push({ domainId: nextDomainId, id });
        const doc = contestDocs.get(idText(id));
        if (!doc || nextDomainId !== domainId) throw new ContestNotFoundError(nextDomainId, id);
        return doc;
    },
    getMultiStatus(nextDomainId: string, query: unknown) {
        return statusCursor(nextDomainId, query);
    },
});
installStub('../src/model/training.ts', {
    async get(nextDomainId: string, id: unknown) {
        trainingCalls.push({ domainId: nextDomainId, id });
        const doc = trainingDocs.get(idText(id));
        if (!doc || nextDomainId !== domainId) throw new TrainingNotFoundError(nextDomainId, id);
        return doc;
    },
    getMultiStatus(nextDomainId: string, query: unknown) {
        return statusCursor(nextDomainId, query);
    },
});

Module._load = function load(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (!isWorkbench(parent?.filename)) return originalLoad.call(this, request, parent, isMain);
    if (request === '@hydrooj/utils' || request === '@hydrooj/utils/lib/utils') {
        const real = originalLoad.call(this, request, parent, isMain);
        return isRecord(real) ? { ...real, Logger: CapturingLogger } : loggerModule();
    }
    if (request === '../logger') return loggerModule();
    if (request === '../service/server') {
        return {
            Handler: class Handler {},
            param,
            Types,
        };
    }
    if (request === '../service/db') {
        return {
            collection(name: string) {
                if (name === 'document.status') return { find: (query: unknown) => statusCursor(null, query) };
                if (name === 'contest.teamStatuses') return { find: (query: unknown) => rowCursor(teamStatusDocs, query) };
                if (name === 'contest.teams') return { find: (query: unknown) => rowCursor(teamDocs, query) };
                if (name === 'record') return { countDocuments: async (query: unknown) => countRecords(query) };
                return { find: () => statusCursor(null, { domainId: '__none__' }) };
            },
        };
    }
    if (request === '../model/document') {
        return {
            TYPE_CONTEST,
            TYPE_TRAINING,
            collStatus: { find: (query: unknown) => statusCursor(null, query) },
            getMultiStatus(nextDomainId: string, docType: number, query: unknown) {
                const scoped = isRecord(query) ? { ...query, docType } : { docType };
                return statusCursor(nextDomainId, scoped);
            },
            async get(nextDomainId: string, docType: number, id: unknown) {
                if (nextDomainId !== domainId) return null;
                const table = docType === TYPE_TRAINING ? trainingDocs : contestDocs;
                return table.get(idText(id)) ?? null;
            },
        };
    }
    if (request === '../model/problem' || request === '../model/problem-access') {
        const problemApi = {
            PROJECTION_CONTEST_LIST: ['docId', 'pid', 'title', 'config'],
            canCreateAllProblemKinds,
            async getList(...args: unknown[]) {
                getListCalls.push(args);
                const nextDomainId = args[0];
                const pids = args[1];
                const found: Record<number, Record<string, unknown>> = {};
                if (nextDomainId !== domainId || !Array.isArray(pids)) return found;
                for (const pid of pids) {
                    if (typeof pid !== 'number') continue;
                    const doc = problems.get(pid);
                    if (doc) found[pid] = { ...doc };
                }
                return found;
            },
        };
        return { ...problemApi, __esModule: true, default: problemApi };
    }
    if (request === '../model/contest-team-status') {
        return { coll: { find: (query: unknown) => rowCursor(teamStatusDocs, query) } };
    }
    if (request === '../model/contest-team') {
        return { coll: { find: (query: unknown) => rowCursor(teamDocs, query) } };
    }
    if (request === '../model/record') {
        const recordApi = { coll: { countDocuments: async (query: unknown) => countRecords(query) } };
        return { ...recordApi, __esModule: true, default: recordApi };
    }
    if (request === '../model/user') {
        const userApi = {
            async getById(_nextDomainId: string, uid: unknown) {
                return userOf(uid);
            },
            async getList(_nextDomainId: string, uids: unknown) {
                const out: Record<number, { _id: number; uname: string }> = {};
                if (!Array.isArray(uids)) return out;
                for (const uid of uids) {
                    const key = typeof uid === 'number' ? uid : typeof uid === 'string' && /^[1-9]\d*$/.test(uid) ? Number(uid) : Number.NaN;
                    if (!Number.isSafeInteger(key)) continue;
                    // UserModel.getList keys the requested uid and fills defaultUser when getById misses.
                    out[key] = userOf(key) ?? { _id: 0, uname: 'Unknown User' };
                }
                return out;
            },
        };
        return { ...userApi, __esModule: true, default: userApi };
    }
    if (request === '../model/managed-problem-authoring') {
        return {
            async listKnowledgeMindmapOptions() {
                return knowledgeFixture.map((item) => ({ ...item, tags: [...item.tags] }));
            },
        };
    }
    if (request === '../model/contest-team-batch') {
        return { canManageTeamBatches };
    }
    return originalLoad.call(this, request, parent, isMain);
};

const directory: StudentDirectory = {
    async listSchools() {
        return [{ _id: schoolId, domainId, name: '第一中学' }];
    },
    async getSchool(nextDomainId: string, id: ObjectId) {
        if (nextDomainId !== domainId || !id.equals(schoolId)) return null;
        return { _id: schoolId, domainId, name: '第一中学' };
    },
    async listUserGroups() {
        return [{ _id: groupId, domainId, schoolId, name: '一班' }];
    },
    async findStudentByUserId() {
        return null;
    },
    async findStudentsByUserIds() {
        return {};
    },
    async searchBoundStudents() {
        return [];
    },
    async findBoundStudentsByGroupIds(nextDomainId: string, groupIds: ObjectId[]) {
        const texts = groupIds.map((id) => idText(id));
        boundQueries.push({ domainId: nextDomainId, groupIds: texts });
        if (nextDomainId !== domainId || !texts.includes(groupId.toHexString())) return [];
        const first: StudentDirectoryStudent = {
            _id: new ObjectId(),
            domainId,
            schoolId,
            studentId: secretStudentId,
            realName: secretStudent,
            groupIds: [groupId],
            boundUserId: 21,
            boundAt: beginAt,
        };
        const second: StudentDirectoryStudent = { ...first, _id: new ObjectId(), boundUserId: 22, studentId: 'SID-SECRET-2' };
        return [first, second];
    },
    async loadExamRosterUserbindSnapshot() {
        return {
            domainId,
            schoolId,
            schoolName: '第一中学',
            selectionKind: 'groups',
            selectedGroupIds: [],
            groups: [],
            students: [],
            fingerprint: 'unused',
        };
    },
    async lookupStudent() {
        return { found: false, eligibleContestIds: [] };
    },
};
registerStudentDirectory(directory);

function resetFixtures(): void {
    contestCalls.length = 0;
    trainingCalls.length = 0;
    getListCalls.length = 0;
    loggerErrors.length = 0;
    boundQueries.length = 0;
    contestDocs.clear();
    trainingDocs.clear();
    problems.clear();
    statusDocs.length = 0;
    teamStatusDocs.length = 0;
    teamDocs.length = 0;
    recordCounts.clear();
}

function expectPaperGetList(pids: readonly number[]): void {
    const call = getListCalls.find((args) => {
        const listed = args[1];
        return Array.isArray(listed) && listed.length === pids.length && pids.every((pid, index) => listed[index] === pid);
    });
    expect(call === undefined).to.equal(false);
    if (!call) return;
    expect(call[0]).to.equal(domainId);
    expect(call[2]).to.equal(true);
    expect(call[3]).to.equal(false);
    expect(call[5]).to.equal(true);
}

function putContest(fields: Record<string, unknown>): ObjectId {
    const docId = fields.docId instanceof ObjectId ? fields.docId : new ObjectId();
    contestDocs.set(docId.toHexString(), {
        domainId,
        owner: ownerUid,
        maintainer: [],
        title: '题目集',
        pids: [],
        beginAt,
        endAt,
        duration: 0,
        participantScopeMode: 'none',
        participationMode: 'individual',
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
        title: '练习',
        kind: 'problem_set',
        dag: [],
        problemSetAudience: { public: true },
        ...fields,
        docId,
        _id: docId,
    });
    return docId;
}

function putProblem(docId: number, fields: Record<string, unknown> = {}): void {
    problems.set(docId, {
        docId,
        pid: `P${docId}`,
        title: `题目${docId}`,
        problemKind: 'programming',
        hidden: false,
        owner: ownerUid,
        difficulty: 1,
        ...fields,
    });
}

function loadHandlerModule(): Record<string, unknown> {
    try {
        const loaded: unknown = requireFromTest('../src/handler/teach-workbench.ts');
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
    await (apply as (ctx: { Route: (...args: unknown[]) => void }) => unknown)({
        Route(name: unknown, path: unknown, HandlerClass: unknown) {
            if (typeof name !== 'string' || typeof path !== 'string' || typeof HandlerClass !== 'function') {
                throw new TypeError(`teach export missing: route ${String(name)}`);
            }
            found.push({ name, path, HandlerClass: HandlerClass as new () => PageHandler });
        },
    });
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

function errorText(error: unknown): string {
    if (!(error instanceof Error)) return '';
    const withParams = error as Error & { params?: unknown };
    const params = Array.isArray(withParams.params) ? withParams.params : [];
    const metadata = getLocalizedErrorMetadata(error as HydroError);
    const templates = [metadata?.message?.template ?? '', ...[...(metadata?.parameters.values() ?? [])].map((item) => item.template)];
    return [error.message, ...params.map((item) => String(item)), ...templates].join('\n');
}

async function readResponse(name: RouteName, actor: TeachActor, type: string, id: string): Promise<PageResponse> {
    const handler = new (await routeNamed(name)).HandlerClass();
    const args = { domainId: forgedDomainId, type, id };
    handler.user = actor;
    handler.domain = { _id: domainId };
    handler.response = { body: {}, template: null };
    handler.request = { method: 'get', params: { type, id }, query: {}, body: {}, headers: {} };
    handler.args = { ...args };
    await handler.get(args);
    return handler.response;
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
    expect(isRecord(value), label).to.equal(true);
    if (!isRecord(value)) throw new Error(label);
    return value;
}

function bodyOf(response: PageResponse): Record<string, unknown> {
    return expectRecord(response.body, 'response body');
}

function containerOf(response: PageResponse): Record<string, unknown> {
    return expectRecord(bodyOf(response).container, 'container');
}

function paperOf(response: PageResponse): Record<string, unknown> {
    return expectRecord(bodyOf(response).paper, 'paper');
}

function statsOf(response: PageResponse): Record<string, unknown> {
    return expectRecord(bodyOf(response).stats, 'stats');
}

function problemsOf(response: PageResponse): Record<string, unknown>[] {
    const problemsValue = paperOf(response).problems;
    expect(Array.isArray(problemsValue), 'paper.problems').to.equal(true);
    if (!Array.isArray(problemsValue)) throw new Error('paper.problems');
    return problemsValue.map((item, index) => expectRecord(item, `problems[${index}]`));
}

function expectAuthoritative(id: ObjectId): void {
    const hit = [...contestCalls, ...trainingCalls].some((call) => call.domainId === domainId && sameId(call.id, id));
    const forged = [...contestCalls, ...trainingCalls].some((call) => call.domainId === forgedDomainId);
    expect(hit).to.equal(true);
    expect(forged).to.equal(false);
}

function expectNoStudentIdentity(response: PageResponse): void {
    const text = JSON.stringify(response.body);
    expect(text.includes(secretStudent)).to.equal(false);
    expect(text.includes(secretStudentId)).to.equal(false);
}

function loggedText(): string {
    return loggerErrors.map((args) => args.map((item) => {
        try {
            return JSON.stringify(item);
        } catch {
            return String(item);
        }
    }).join(' ')).join('\n');
}

function projectionTexts(): string[] {
    const texts: string[] = [];
    for (const args of getListCalls) {
        for (const arg of args) {
            if (Array.isArray(arg) && arg.every((item) => typeof item === 'string')) texts.push(...arg);
        }
    }
    return texts;
}

const contestOwner = () => teachActor(ownerUid, [PERM.PERM_EDIT_CONTEST_SELF]);
const homeworkOwner = () => teachActor(ownerUid, [PERM.PERM_EDIT_HOMEWORK_SELF]);
const homeworkMaintainer = () => teachActor(maintainerUid, [PERM.PERM_EDIT_HOMEWORK_SELF]);
const practiceOwner = () => teachActor(ownerUid, [PERM.PERM_EDIT_TRAINING_SELF, PERM.PERM_PIN_TRAINING, PERM.PERM_CREATE_REDEMPTION_CODE]);

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

describe('teach workbench and compose payloads', { concurrency: false }, () => {
    it('registers the workbench and compose get routes', async () => {
        const found = await ensureRoutes();
        expect(found.find((item) => item.name === 'teach_workbench')?.path).to.equal('/teach/:type/:id');
        expect(found.find((item) => item.name === 'teach_compose')?.path).to.equal('/teach/:type/:id/compose');
    });

    it('rejects a teacher who cannot manage the container on both pages', async () => {
        const tid = putContest({ rule: 'exam', title: '期中考试' });
        for (const name of ['teach_workbench', 'teach_compose'] as const) {
            const error = await rejectionOf(() => readResponse(name, teachActor(strangerUid), 'exam', tid.toHexString()));
            expect(errorName(error)).to.equal('PermissionError');
            expect(errorText(error)).to.include('你不能管理这个题目集。');
        }
    });

    it('rejects a mismatched type, a missing container, a course, and an id that is not an object id', async () => {
        const examId = putContest({ rule: 'exam', title: '期中考试' });
        const courseId = putTraining({ kind: 'course', title: '课程' });
        const mismatch = await rejectionOf(() => readResponse('teach_workbench', contestOwner(), 'acm', examId.toHexString()));
        const missing = await rejectionOf(() => readResponse('teach_compose', contestOwner(), 'exam', new ObjectId().toHexString()));
        const course = await rejectionOf(() => readResponse('teach_workbench', practiceOwner(), 'practice', courseId.toHexString()));
        const badType = await rejectionOf(() => readResponse('teach_workbench', contestOwner(), 'quiz', examId.toHexString()));
        const badId = await rejectionOf(() => readResponse('teach_compose', contestOwner(), 'exam', 'not-an-object-id'));
        for (const error of [mismatch, missing, course, badType, badId]) {
            expect(errorName(error)).to.equal('NotFoundError');
            expect(errorText(error)).to.include('题目集不存在');
        }
    });

    it('keeps exam scores and gives every acm score as null', async () => {
        const sourceId = new ObjectId();
        const examId = putContest({
            rule: 'exam',
            title: '期中考试',
            pids: [5, 6],
            score: { 5: 10 },
            examPaperQuotas: { single: 2 },
            examPassScore: 60,
            examAttemptLimit: 3,
            maintainer: [maintainerUid],
            schoolShared: { sharedBy: sharerUid, sharedAt },
            copiedFrom: { type: 'exam', id: sourceId, title: '期中', ownerUid: sharerUid, copiedBy: ownerUid, copiedAt },
        });
        putProblem(5, { problemKind: 'single', title: '判断', hidden: false, owner: ownerUid, difficulty: 4 });
        putProblem(6, { problemKind: 'programming', title: '编程', hidden: true, owner: maintainerUid, difficulty: null });
        const response = await readResponse('teach_workbench', contestOwner(), 'exam', examId.toHexString());
        expect(response.template).to.equal('teach_workbench.html');
        expectAuthoritative(examId);
        const projection = projectionTexts();
        expect(projection.includes('problemKind')).to.equal(true);
        expect(projection.includes('hidden')).to.equal(true);
        expect(projection.includes('owner')).to.equal(true);
        expect(projection.includes('difficulty')).to.equal(true);
        expectPaperGetList([5, 6]);
        const rows = problemsOf(response);
        expect(rows.map((row) => row.docId)).to.deep.equal([5, 6]);
        expect(rows[0]).to.include({ pid: 'P5', title: '判断', kind: 'single', score: 10, hidden: false, mine: true, difficulty: 4 });
        expect(rows[1]).to.include({ pid: 'P6', title: '编程', kind: 'programming', score: 100, hidden: true, mine: false, difficulty: null });
        expect(paperOf(response).stages).to.equal(null);
        expect(paperOf(response).examPaperQuotas).to.deep.equal({ single: 2 });
        const container = containerOf(response);
        expect(container.type).to.equal('exam');
        expect(container.id).to.equal(examId.toHexString());
        expect(container.rule).to.equal('exam');
        expect(container.title).to.equal('期中考试');
        expect(container.status).to.equal('running');
        expect(container.beginAt).to.equal(beginAt.toISOString());
        expect(container.endAt).to.equal(endAt.toISOString());
        expect(container.createdAt).to.equal(examId.getTimestamp().toISOString());
        expect(container.penaltySince).to.equal(null);
        expect(container.lockAt).to.equal(null);
        expect(container.participationMode).to.equal('individual');
        expect(container.vigilEnabled).to.equal(false);
        expect(container.entryMode).to.equal('open');
        expect(container.examPassScore).to.equal(60);
        expect(container.examAttemptLimit).to.equal(3);
        expect(container.owner).to.deep.equal({ uid: ownerUid, name: '林老师' });
        expect(container.maintainers).to.deep.equal([{ uid: maintainerUid, name: '周老师' }]);
        expect(container.schoolShared).to.deep.equal({ sharedAt: sharedAt.toISOString(), sharedByName: '共享人' });
        expect(container.copiedFrom).to.deep.equal({ type: 'exam', id: sourceId.toHexString(), title: '期中', ownerName: '共享人' });
        expect(container.audience).to.deep.equal({ mode: 'all', groupNames: [], schoolNames: [], boundStudentCount: null });
        expect(container.links).to.deep.equal({
            studentView: `/contest/${examId.toHexString()}`,
            scoreboard: `/contest/${examId.toHexString()}/scoreboard`,
            manage: `/contest/${examId.toHexString()}/management`,
            users: `/contest/${examId.toHexString()}/user`,
            clarification: `/contest/${examId.toHexString()}/clarification`,
            grading: `/manage/grading/${examId.toHexString()}`,
            teams: null,
            balloon: null,
            print: null,
            code: null,
            files: `/contest/${examId.toHexString()}/management`,
            redemption: null,
        });
        expect(bodyOf(response).capabilities).to.deep.equal({
            canDelete: true,
            canShare: true,
            canGrade: true,
            canManageTeamBatches: false,
            isSystemAdmin: false,
            canPin: false,
        });
        expectNoStudentIdentity(response);

        const acmId = putContest({
            rule: 'acm',
            title: '校赛',
            pids: [5, 6],
            score: { 5: 10 },
            participationMode: 'team',
            lockAt,
        });
        recordCounts.set(acmId.toHexString(), 3);
        const acm = await readResponse('teach_workbench', teachActor(ownerUid, [PERM.PERM_EDIT_CONTEST_SELF, PERM.PERM_CREATE_CONTEST]), 'acm', acmId.toHexString());
        const acmRows = problemsOf(acm);
        expect(acmRows.map((row) => row.score)).to.deep.equal([null, null]);
        expect(paperOf(acm).examPaperQuotas).to.equal(null);
        expect(paperOf(acm).stages).to.equal(null);
        const acmContainer = containerOf(acm);
        expect(acmContainer.participationMode).to.equal('team');
        expect(acmContainer.lockAt).to.equal(lockAt.toISOString());
        expect(acmContainer.examPassScore).to.equal(null);
        expect(acmContainer.examAttemptLimit).to.equal(null);
        expect(acmContainer.schoolShared).to.equal(null);
        expect(acmContainer.copiedFrom).to.equal(null);
        expect(acmContainer.links).to.deep.equal({
            studentView: `/contest/${acmId.toHexString()}`,
            scoreboard: `/contest/${acmId.toHexString()}/scoreboard`,
            manage: `/contest/${acmId.toHexString()}/management`,
            users: `/contest/${acmId.toHexString()}/user`,
            clarification: `/contest/${acmId.toHexString()}/clarification`,
            grading: null,
            teams: `/contest/${acmId.toHexString()}/teams`,
            balloon: `/contest/${acmId.toHexString()}/balloon`,
            print: `/contest/${acmId.toHexString()}/print`,
            code: `/contest/${acmId.toHexString()}/code`,
            files: `/contest/${acmId.toHexString()}/management`,
            redemption: null,
        });
        expect(bodyOf(acm).capabilities).to.deep.equal({
            canDelete: true,
            canShare: true,
            canGrade: false,
            canManageTeamBatches: true,
            isSystemAdmin: false,
            canPin: false,
        });
        const acmStats = statsOf(acm);
        expect(acmStats.startedCount).to.equal(null);
        expect(acmStats.finalizedCount).to.equal(null);
        expect(acmStats.participantCount).to.equal(0);
        expect(acmStats.submittedCount).to.equal(0);
        expect(acmStats.recordCount).to.equal(3);
        expect(Array.isArray(acmStats.problemStats)).to.equal(true);
    });

    it('counts started, finalized, and attending status documents', async () => {
        const examId = putContest({ rule: 'exam', title: '期末考试', pids: [5] });
        putProblem(5, { title: '单选' });
        statusDocs.push(
            { domainId, docType: TYPE_CONTEST, docId: examId, uid: 11, attend: 1, startAt: new Date('2026-10-16T01:00:00.000Z'), paperFinalizedAt: new Date('2026-10-16T02:00:00.000Z') },
            { domainId, docType: TYPE_CONTEST, docId: examId, uid: 12, attend: 1, startAt: new Date('2026-10-16T01:30:00.000Z') },
            { domainId, docType: TYPE_CONTEST, docId: examId, uid: 13, attend: 1 },
        );
        const response = await readResponse('teach_workbench', contestOwner(), 'exam', examId.toHexString());
        const stats = statsOf(response);
        expect(stats.startedCount).to.equal(2);
        expect(stats.finalizedCount).to.equal(1);
        expect(stats.participantCount).to.equal(3);
        expect(stats.audienceCount).to.equal(null);
        const compose = await readResponse('teach_compose', teachActor(ownerUid, [PERM.PERM_EDIT_CONTEST_SELF, PERM.PERM_CREATE_PROBLEM]), 'exam', examId.toHexString());
        expect(compose.template).to.equal('teach_compose.html');
        expect(bodyOf(compose).examStartedCount).to.equal(2);
        expect(bodyOf(compose).canCreateObjective).to.equal(true);
        expect(bodyOf(compose).knowledgeOptions).to.deep.equal([
            { id: knowledgeFixture[0]?.id, mapId: knowledgeFixture[0]?.mapId, label: '二分' },
            { id: knowledgeFixture[1]?.id, mapId: knowledgeFixture[1]?.mapId, label: '图论' },
        ]);
        const withoutCreate = await readResponse('teach_compose', contestOwner(), 'exam', examId.toHexString());
        expect(bodyOf(withoutCreate).canCreateObjective).to.equal(false);
    });

    it('counts an accepted user once and every user who attempted the problem', async () => {
        const examId = putContest({ rule: 'exam', title: '随堂', pids: [5] });
        putProblem(5);
        statusDocs.push(
            {
                domainId,
                docType: TYPE_CONTEST,
                docId: examId,
                uid: 1,
                attend: 1,
                journal: [
                    { pid: 5, status: STATUS.STATUS_WRONG_ANSWER },
                    { pid: 5, status: STATUS.STATUS_ACCEPTED },
                ],
            },
            {
                domainId,
                docType: TYPE_CONTEST,
                docId: examId,
                uid: 2,
                attend: 1,
                journal: [{ pid: 5, status: STATUS.STATUS_WRONG_ANSWER }],
            },
        );
        const response = await readResponse('teach_workbench', contestOwner(), 'exam', examId.toHexString());
        const problemStats = statsOf(response).problemStats;
        expect(Array.isArray(problemStats), 'problemStats').to.equal(true);
        if (!Array.isArray(problemStats)) return;
        const row = problemStats.map((item) => expectRecord(item, 'problemStat')).find((item) => item.docId === 5);
        expect(row).to.deep.equal({ docId: 5, accepted: 1, attempted: 2 });
    });

    it('shows the internal number when a problem has no public pid', async () => {
        const examId = putContest({ rule: 'homework', title: '无题号', pids: [9] });
        putProblem(9, { pid: undefined, title: '选择题' });
        const response = await readResponse('teach_workbench', homeworkOwner(), 'homework', examId.toHexString());
        const rows = problemsOf(response);
        expect(rows.map((row) => row.docId)).to.deep.equal([9]);
        expect(rows[0]?.pid).to.equal('P9');
        expect(rows[0]?.title).to.equal('选择题');
    });

    it('keeps a deleted problem as a visible placeholder and logs it', async () => {
        const examId = putContest({ rule: 'exam', title: '缺题', pids: [8, missingDocId] });
        putProblem(8, { title: '还在' });
        const response = await readResponse('teach_workbench', contestOwner(), 'exam', examId.toHexString());
        const rows = problemsOf(response);
        expect(rows.map((row) => row.docId)).to.deep.equal([8, missingDocId]);
        expect(rows[0]?.title).to.equal('还在');
        expect(rows[0]?.score).to.equal(100);
        expect(rows[1]).to.include({ docId: missingDocId, title: '（题目已删除）', kind: 'programming', hidden: true });
        expect(loggedText().includes(String(missingDocId))).to.equal(true);
        expectPaperGetList([8, missingDocId]);
    });

    it('counts one team journal and does not return member uids', async () => {
        const contestId = putContest({ rule: 'acm', title: '团队赛', pids: [5], participationMode: 'team' });
        putProblem(5, { title: '团队题' });
        const teamId = new ObjectId();
        const members = [teamMemberA, teamMemberB];
        teamDocs.push({ domainId, contestId, teamId, memberUids: members, active: true });
        teamStatusDocs.push({
            domainId,
            contestId,
            teamId,
            memberUids: members,
            journal: [
                { pid: 5, status: STATUS.STATUS_WRONG_ANSWER },
                { pid: 5, status: STATUS.STATUS_ACCEPTED },
            ],
        });
        const response = await readResponse('teach_workbench', contestOwner(), 'acm', contestId.toHexString());
        const stats = statsOf(response);
        expect(stats.submittedCount).to.equal(1);
        const problemStats = stats.problemStats;
        expect(Array.isArray(problemStats), 'problemStats').to.equal(true);
        if (!Array.isArray(problemStats)) return;
        const row = problemStats.map((item) => expectRecord(item, 'problemStat')).find((item) => item.docId === 5);
        expect(row).to.deep.equal({ docId: 5, accepted: 1, attempted: 1 });
        const text = JSON.stringify(response.body);
        expect(text.includes(String(teamMemberA))).to.equal(false);
        expect(text.includes(String(teamMemberB))).to.equal(false);
    });

    it('reads a public practice as everyone, without a scoreboard or contest stats', async () => {
        putProblem(6, { title: '先做' });
        putProblem(5, { title: '后做' });
        const practiceId = putTraining({
            title: '热身练习',
            problemSetAudience: { public: true },
            dag: [{ _id: 4, title: '热身', requireNids: [2], pids: [6, 5] }],
        });
        const response = await readResponse('teach_workbench', practiceOwner(), 'practice', practiceId.toHexString());
        expect(response.template).to.equal('teach_workbench.html');
        const container = containerOf(response);
        expect(container.status).to.equal('open');
        expect(container.rule).to.equal('problem_set');
        expect(container.audience).to.deep.equal({ mode: 'all', groupNames: [], schoolNames: [], boundStudentCount: null });
        expect(container.links).to.deep.equal({
            studentView: `/problem-sets/${practiceId.toHexString()}`,
            scoreboard: null,
            manage: null,
            users: null,
            clarification: null,
            grading: null,
            teams: null,
            balloon: null,
            print: null,
            code: null,
            files: `/problem-sets/${practiceId.toHexString()}/file`,
            redemption: '/manage/redemption-codes',
        });
        expect(container.penaltySince).to.equal(null);
        expect(container.lockAt).to.equal(null);
        expect(container.examPassScore).to.equal(null);
        expect(container.examAttemptLimit).to.equal(null);
        expect(paperOf(response).stages).to.deep.equal([{ id: 4, title: '热身', requireIds: [2], pids: [6, 5] }]);
        expect(paperOf(response).examPaperQuotas).to.equal(null);
        const rows = problemsOf(response);
        expect(rows.map((row) => row.docId)).to.deep.equal([6, 5]);
        expect(rows.map((row) => row.score)).to.deep.equal([null, null]);
        const stats = statsOf(response);
        expect(stats.startedCount).to.equal(null);
        expect(stats.finalizedCount).to.equal(null);
        expect(stats.submittedCount).to.equal(null);
        expect(stats.recordCount).to.equal(null);
        expect(stats.problemStats).to.equal(null);
        expect(stats.audienceCount).to.equal(null);
        expect(bodyOf(response).capabilities).to.deep.equal({
            canDelete: true,
            canShare: true,
            canGrade: false,
            canManageTeamBatches: false,
            isSystemAdmin: false,
            canPin: true,
        });
        const plain = await readResponse('teach_workbench', teachActor(ownerUid, [PERM.PERM_EDIT_TRAINING_SELF]), 'practice', practiceId.toHexString());
        expect(expectRecord(containerOf(plain).links, 'plain links').redemption).to.equal(null);
        expect(expectRecord(bodyOf(plain).capabilities, 'plain capabilities').canPin).to.equal(false);
        const compose = await readResponse('teach_compose', practiceOwner(), 'practice', practiceId.toHexString());
        expect(compose.template).to.equal('teach_compose.html');
        expect(bodyOf(compose).examStartedCount).to.equal(0);
    });

    it('treats a practice without a public audience or groups as redeem only', async () => {
        const practiceId = putTraining({ problemSetAudience: { public: false, groupIds: [] }, dag: [{ _id: 1, title: '阶段', requireNids: [], pids: [] }] });
        const response = await readResponse('teach_workbench', practiceOwner(), 'practice', practiceId.toHexString());
        expect(containerOf(response).audience).to.deep.equal({ mode: 'redeem_only', groupNames: [], schoolNames: [], boundStudentCount: null });
        expect(expectRecord(containerOf(response).links, 'links').scoreboard).to.equal(null);
    });

    it('counts bound students for group audience and leaves other audience modes uncounted', async () => {
        const grouped = putContest({
            rule: 'exam',
            title: '分组考',
            participantScopeMode: 'groups',
            participantGroupIds: [groupId],
        });
        const groupedResponse = await readResponse('teach_workbench', contestOwner(), 'exam', grouped.toHexString());
        const groupedAudience = expectRecord(containerOf(groupedResponse).audience, 'grouped audience');
        expect(groupedAudience.mode).to.equal('groups');
        expect(groupedAudience.boundStudentCount).to.equal(2);
        expect(statsOf(groupedResponse).audienceCount).to.equal(2);
        expect(boundQueries.some((query) => query.domainId === domainId && query.groupIds.includes(groupId.toHexString()))).to.equal(true);
        expectNoStudentIdentity(groupedResponse);

        const schools = putContest({
            rule: 'acm',
            title: '学校赛',
            participantScopeMode: 'schools',
            participantSchoolIds: [schoolId],
        });
        const schoolResponse = await readResponse('teach_workbench', contestOwner(), 'acm', schools.toHexString());
        expect(containerOf(schoolResponse).audience).to.deep.equal({ mode: 'schools', groupNames: [], schoolNames: ['第一中学'], boundStudentCount: null });
        expect(statsOf(schoolResponse).audienceCount).to.equal(null);
    });

    it('lets a homework owner grade and does not let a maintainer grade', async () => {
        const homeworkId = putContest({
            rule: 'homework',
            title: '第一次作业',
            pids: [5],
            maintainer: [maintainerUid],
            penaltySince,
            participantScopeMode: 'none',
        });
        putProblem(5, { title: '作业题' });
        const ownerResponse = await readResponse('teach_workbench', homeworkOwner(), 'homework', homeworkId.toHexString());
        const ownerContainer = containerOf(ownerResponse);
        expect(ownerContainer.penaltySince).to.equal(penaltySince.toISOString());
        expect(ownerContainer.lockAt).to.equal(null);
        expect(ownerContainer.examPassScore).to.equal(null);
        expect(ownerContainer.examAttemptLimit).to.equal(null);
        expect(ownerContainer.audience).to.deep.equal({ mode: 'all', groupNames: [], schoolNames: [], boundStudentCount: null });
        expect(ownerContainer.links).to.deep.equal({
            studentView: `/homework/${homeworkId.toHexString()}`,
            scoreboard: `/homework/${homeworkId.toHexString()}/scoreboard`,
            manage: null,
            users: null,
            clarification: null,
            grading: `/manage/grading/${homeworkId.toHexString()}`,
            teams: null,
            balloon: null,
            print: null,
            code: null,
            files: `/homework/${homeworkId.toHexString()}/file`,
            redemption: null,
        });
        expect(bodyOf(ownerResponse).capabilities).to.deep.equal({
            canDelete: true,
            canShare: true,
            canGrade: true,
            canManageTeamBatches: false,
            isSystemAdmin: false,
            canPin: false,
        });
        const stats = statsOf(ownerResponse);
        expect(stats.startedCount).to.equal(null);
        expect(stats.finalizedCount).to.equal(null);
        const compose = await readResponse('teach_compose', homeworkOwner(), 'homework', homeworkId.toHexString());
        expect(bodyOf(compose).examStartedCount).to.equal(0);

        const maintainerResponse = await readResponse('teach_workbench', homeworkMaintainer(), 'homework', homeworkId.toHexString());
        expect(expectRecord(containerOf(maintainerResponse).links, 'maintainer links').grading).to.equal(null);
        expect(bodyOf(maintainerResponse).capabilities).to.deep.equal({
            canDelete: true,
            canShare: false,
            canGrade: false,
            canManageTeamBatches: false,
            isSystemAdmin: false,
            canPin: false,
        });
    });

    it('gives an oi rule a grading link and keeps ioi off that page', async () => {
        const oiId = putContest({ rule: 'oi', title: 'OI 赛' });
        const oi = await readResponse('teach_workbench', contestOwner(), 'oi', oiId.toHexString());
        const oiLinks = expectRecord(containerOf(oi).links, 'oi links');
        expect(oiLinks.grading).to.equal(`/manage/grading/${oiId.toHexString()}`);
        expect(oiLinks.balloon).to.equal(`/contest/${oiId.toHexString()}/balloon`);
        expect(oiLinks.print).to.equal(`/contest/${oiId.toHexString()}/print`);
        expect(oiLinks.code).to.equal(`/contest/${oiId.toHexString()}/code`);
        expect(oiLinks.teams).to.equal(null);
        expect(expectRecord(bodyOf(oi).capabilities, 'oi capabilities').canGrade).to.equal(true);

        const ioiId = putContest({ rule: 'ioi', title: 'IOI 赛' });
        const ioi = await readResponse('teach_workbench', contestOwner(), 'oi', ioiId.toHexString());
        expect(expectRecord(containerOf(ioi).links, 'ioi links').grading).to.equal(null);
        expect(expectRecord(bodyOf(ioi).capabilities, 'ioi capabilities').canGrade).to.equal(false);
    });

    it('counts homework starters only when a personal limit is set', async () => {
        const homeworkId = putContest({
            rule: 'homework',
            title: '限时作业',
            duration: 1.5,
            pids: [5],
        });
        putProblem(5, { title: '限时题' });
        statusDocs.push(
            { domainId, docType: TYPE_CONTEST, docId: homeworkId, uid: 41, attend: 1, startAt: new Date('2026-10-16T01:00:00.000Z') },
            { domainId, docType: TYPE_CONTEST, docId: homeworkId, uid: 42, attend: 1, startAt: new Date('2026-10-16T01:10:00.000Z') },
            { domainId, docType: TYPE_CONTEST, docId: homeworkId, uid: 43, attend: 1 },
        );
        const response = await readResponse('teach_workbench', homeworkOwner(), 'homework', homeworkId.toHexString());
        expect(containerOf(response).durationMinutes).to.equal(90);
        expect(statsOf(response).startedCount).to.equal(2);
        expect(statsOf(response).participantCount).to.equal(3);
        const compose = await readResponse('teach_compose', homeworkOwner(), 'homework', homeworkId.toHexString());
        expect(bodyOf(compose).examStartedCount).to.equal(0);
    });

    it('counts practice participants from enroll and ignores attend-only rows', async () => {
        const practiceId = putTraining({
            title: '报名练习',
            dag: [{ _id: 1, title: '阶段', requireNids: [], pids: [] }],
        });
        statusDocs.push(
            { domainId, docType: TYPE_TRAINING, docId: practiceId, uid: 51, enroll: 1 },
            { domainId, docType: TYPE_TRAINING, docId: practiceId, uid: 52, enroll: 1 },
            { domainId, docType: TYPE_TRAINING, docId: practiceId, uid: 53, attend: 1 },
        );
        const response = await readResponse('teach_workbench', practiceOwner(), 'practice', practiceId.toHexString());
        expect(statsOf(response).participantCount).to.equal(2);
    });

    it('lets a system administrator share a contest they do not own', async () => {
        const examId = putContest({ rule: 'exam', title: '管理员考试' });
        const admin = teachActor(strangerUid, [], [PRIV.PRIV_EDIT_SYSTEM]);
        const response = await readResponse('teach_workbench', admin, 'exam', examId.toHexString());
        expect(bodyOf(response).capabilities).to.deep.equal({
            canDelete: true,
            canShare: true,
            canGrade: true,
            canManageTeamBatches: true,
            isSystemAdmin: true,
            canPin: false,
        });
        expect(expectRecord(containerOf(response).links, 'admin links').grading).to.equal(`/manage/grading/${examId.toHexString()}`);
    });

    it('shows the lock time on an oi contest', async () => {
        const oiId = putContest({ rule: 'oi', title: '封榜 OI', lockAt });
        const response = await readResponse('teach_workbench', contestOwner(), 'oi', oiId.toHexString());
        expect(containerOf(response).lockAt).to.equal(lockAt.toISOString());
    });

    it('lists the group names for a group audience', async () => {
        const grouped = putContest({
            rule: 'exam',
            title: '分组名',
            participantScopeMode: 'groups',
            participantGroupIds: [groupId],
        });
        const response = await readResponse('teach_workbench', contestOwner(), 'exam', grouped.toHexString());
        expect(containerOf(response).audience).to.deep.equal({
            mode: 'groups',
            groupNames: ['一班'],
            schoolNames: [],
            boundStudentCount: 2,
        });
    });

    it('keeps homework problem scores from the contest score weight', async () => {
        const homeworkId = putContest({
            rule: 'homework',
            title: '计分作业',
            pids: [5, 6],
            score: { 5: 8 },
        });
        putProblem(5, { title: '八分' });
        putProblem(6, { title: '默认分' });
        const response = await readResponse('teach_workbench', homeworkOwner(), 'homework', homeworkId.toHexString());
        expect(problemsOf(response).map((row) => row.score)).to.deep.equal([8, 100]);
    });

    it('labels a missing maintainer as a deleted user and hides the default account name', async () => {
        const deletedMaintainerUid = 424242;
        const examId = putContest({
            rule: 'exam',
            title: '缺维护者',
            maintainer: [deletedMaintainerUid],
        });
        const response = await readResponse('teach_workbench', contestOwner(), 'exam', examId.toHexString());
        const container = containerOf(response);
        expect(container.maintainers).to.deep.equal([{ uid: deletedMaintainerUid, name: '已删除的用户' }]);
        expect(JSON.stringify(response.body).includes('Unknown User')).to.equal(false);
    });
});
