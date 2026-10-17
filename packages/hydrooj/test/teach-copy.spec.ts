import { createRequire, type Module as NodeModule } from 'node:module';
import { after, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PERM, PRIV } from '@hydrooj/common';
import { get, param, post, query, route } from '@hydrooj/framework/decorators';
import { Types } from '@hydrooj/framework/validator';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import {
    getLocalizedErrorMetadata,
    PermissionError,
    PrivilegeError,
    ProblemNotFoundError,
    type HydroError,
} from '../src/error';
import { readCopiedFrom } from '../src/lib/teach-fields';

// Handler and copy modules are created by the implementation lane. Load them at
// runtime so this file still typechecks before those modules exist.
// This line matches @hydrooj/register's CJS strip so __filename stays defined.
const __filename = fileURLToPath(import.meta.url);
const requireFromTest = createRequire(__filename);

const DOMAIN = 'teach-domain';
const FORGED = 'forged-domain';
const TYPE_PROBLEM = 10;
const TYPE_CONTEST = 30;
const TYPE_TRAINING = 40;
const OWNER = 7;
const COPIER = 9;
const MAINTAINER = 8;
const PRACTICE_ONLY = 4;
const NO_CREATE = 3;
const SECRET_UID = 880099;
const COURSE_ID = '64b0000000000000000000aa';
const HOMEWORK_BEGIN = new Date('2026-10-16T00:00:00.000Z');
const HOMEWORK_PENALTY = new Date('2026-10-18T00:00:00.000Z');
const HOMEWORK_END = new Date('2026-10-20T00:00:00.000Z');
const EXAM_BEGIN = new Date('2026-11-01T01:00:00.000Z');
const EXAM_END = new Date('2026-11-01T04:00:00.000Z');
const EXAM_LOCK = new Date('2026-11-01T03:30:00.000Z');
const SHARED_AT = new Date('2026-10-02T03:04:05.000Z');
const COPY_KEYS = [
    'beginAt', 'content', 'description', 'durationMinutes', 'endAt', 'examPaperQuotas', 'id', 'mine',
    'ownerName', 'ownerUid', 'pids', 'problems', 'rule', 'scores', 'settings', 'stages', 'title', 'type', 'unusablePids',
];
const HOMEWORK_SETTING_KEYS = ['extensionDays', 'kind', 'langs', 'penaltyRules', 'rated'];
const CONTEST_SETTING_KEYS = [
    'allowPostContestPractice', 'allowPostContestSubmit', 'allowPostContestView', 'allowPrint', 'allowViewCode',
    'allowVirtual', 'autoHide', 'examAttemptLimit', 'examPassScore', 'examShowVerdict', 'hidden',
    'keepScoreboardHidden', 'kind', 'langs', 'lockMinutes', 'rated',
];
const PROBLEM_KEYS = ['docId', 'kind', 'pid', 'title'];
const NEW_KEYS = ['canCreate', 'copy', 'fromCourse', 'initialType'];
const CREATE_KEYS = ['acm', 'exam', 'homework', 'oi', 'practice'];
const SECRETS = [
    'ASSIGN-SECRET',
    'CODE-SECRET-88',
    'VIGIL-HOST-SECRET',
    'BATCH-SECRET-PLANNED',
    'TEAM-BATCH-SECRET',
    'PARTICIPANT-SECRET',
    String(SECRET_UID),
];
const BANNED_KEYS = new Set([
    'assign', 'maintainer', '_code', 'inviteCode', 'vigilEnabled', 'entryMode', 'approvalMode', 'lockdownMode',
    'networkLockdownMode', 'networkLockdownFailurePolicy', 'networkWhitelistHosts', 'networkWhitelistIps',
    'networkWhitelistPorts', 'pauseOnDisconnect', 'screenshotIntervalMs', 'exclusive',
    'clientLoginBlockBeforeMinutes', 'clientLoginBlockAfterMinutes', 'liveEnabled', 'recordEnabled',
    'cameraEnabled', 'screenshotJitterMs', 'vigilProcessWhitelist', 'plannedTeamBatchId', 'teamBatchId',
    'participantScopeMode', 'participantSchoolIds', 'participantGroupIds', 'participationMode', 'participationRevision',
]);

type TeachType = 'practice' | 'homework' | 'exam' | 'acm' | 'oi';
type RouteName = 'teach_new' | 'teach_copyable' | 'teach_provenance';

interface TeachActor {
    _id: number;
    uname: string;
    timeZone: string;
    own: (doc: { owner: number; maintainer?: number[] }, exact?: boolean) => boolean;
    hasPerm: (...perm: bigint[]) => boolean;
    hasPriv: (...priv: number[]) => boolean;
    _problemAclLoaded: boolean;
    _pidNamespaceAclLoaded: boolean;
    _problemAclDomainId: string;
    _pidNamespaceAclDomainId: string;
    _aclFencedPids: Set<number>;
    _maintainedPids: Set<number>;
    _authoredPids: Set<number>;
    _dataContributionPids: Set<number>;
    _tagContributionPids: Set<number>;
    _pidNamespaceManagerIds: Set<string>;
    _pidNamespaceEditAllIds: Set<string>;
    _ownsLegacyProblems: boolean;
}

interface PageResponse {
    body: unknown;
    template: string | null;
}

interface PageHandler {
    get: (args: Record<string, unknown>) => Promise<unknown>;
    post: (args: Record<string, unknown>) => Promise<unknown>;
    user: TeachActor;
    domain: { _id: string };
    response: PageResponse;
    request: {
        method: string;
        params: Record<string, string>;
        query: Record<string, string>;
        body: Record<string, unknown>;
        json: boolean;
        headers: Record<string, string>;
        path: string;
    };
    args: Record<string, unknown>;
    session: Record<string, unknown>;
    checkPriv: (...priv: number[]) => void;
    checkPerm: (...perm: bigint[]) => void;
}

interface RouteCall {
    name: string;
    path: string;
    HandlerClass: new () => PageHandler;
}

interface ModuleLoader {
    _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
    _cache: Record<string, NodeModule | undefined>;
}

interface CallInput {
    method: 'get' | 'post';
    type?: string;
    id?: string;
    query?: Record<string, string>;
    body?: Record<string, unknown>;
}

const userNames: Record<number, string> = {
    [OWNER]: '李老师',
    [COPIER]: '王老师',
    [MAINTAINER]: '周老师',
    [PRACTICE_ONLY]: '赵老师',
    [NO_CREATE]: '钱老师',
};

const contests = new Map<string, Record<string, unknown>>();
const trainings = new Map<string, Record<string, unknown>>();
const problemDocs = new Map<number, Record<string, unknown>>();
const readDomains: string[] = [];
const infoLogs: unknown[][] = [];
const errorLogs: unknown[][] = [];
const writes: string[] = [];
let problemReads = 0;
let routes: RouteCall[] | undefined;
let loadError: unknown;

const hydroHost = global as unknown as { Hydro?: { model?: Record<string, unknown> } };
if (!hydroHost.Hydro) hydroHost.Hydro = { model: {} };
if (!hydroHost.Hydro.model) hydroHost.Hydro.model = {};
const Module = requireFromTest('module') as ModuleLoader;
const originalLoad = Module._load;
const replaced: Array<{ resolved: string; previous: NodeModule | undefined }> = [];

class CapturingLogger {
    info(...args: unknown[]) {
        infoLogs.push(args);
    }

    error(...args: unknown[]) {
        errorLogs.push(args);
    }

    warn() {}

    debug() {}
}

const sharedLogger = new CapturingLogger();

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function idText(value: unknown): string {
    if (value instanceof ObjectId) return value.toHexString();
    if (typeof value === 'string') return value.toLowerCase();
    return '';
}

function sameValue(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
    if (left instanceof ObjectId && typeof right === 'string') return left.toHexString() === right.toLowerCase();
    if (typeof left === 'string' && right instanceof ObjectId) return left.toLowerCase() === right.toHexString();
    if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
    return Object.is(left, right);
}

function getPath(doc: Record<string, unknown>, path: string): unknown {
    let current: unknown = doc;
    for (const part of path.split('.')) {
        if (Array.isArray(current)) {
            current = current
                .map((item) => (isRecord(item) ? item[part] : undefined))
                .filter((item) => item !== undefined);
            if (Array.isArray(current) && current.length === 0) return undefined;
            continue;
        }
        if (!isRecord(current) || !Object.hasOwn(current, part)) return undefined;
        current = current[part];
    }
    return current;
}

function isOperator(value: unknown): value is Record<string, unknown> {
    if (!isRecord(value)) return false;
    const keys = Object.keys(value);
    return keys.length > 0 && keys.every((key) => key.startsWith('$'));
}

function matchesOperators(docValue: unknown, ops: Record<string, unknown>): boolean {
    for (const [op, expected] of Object.entries(ops)) {
        if (op === '$eq') {
            if (!sameValue(docValue, expected)) return false;
            continue;
        }
        if (op === '$ne') {
            if (sameValue(docValue, expected)) return false;
            continue;
        }
        if (op === '$in' || op === '$nin') {
            if (!Array.isArray(expected)) return false;
            const values = Array.isArray(docValue) ? docValue : [docValue];
            const hit = values.some((item) => expected.some((candidate) => sameValue(item, candidate)));
            if (op === '$in' ? !hit : hit) return false;
            continue;
        }
        if (op === '$exists') {
            if ((docValue !== undefined) !== Boolean(expected)) return false;
            continue;
        }
        return false;
    }
    return true;
}

function matchesQuery(doc: Record<string, unknown>, queryValue: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(queryValue)) {
        if (key === '$or') {
            if (!Array.isArray(value) || !value.some((item) => isRecord(item) && matchesQuery(doc, item))) return false;
            continue;
        }
        if (key === '$and') {
            if (!Array.isArray(value) || !value.every((item) => isRecord(item) && matchesQuery(doc, item))) return false;
            continue;
        }
        if (key === '$nor') {
            if (!Array.isArray(value) || value.some((item) => isRecord(item) && matchesQuery(doc, item))) return false;
            continue;
        }
        const actual = getPath(doc, key);
        if (isOperator(value)) {
            if (!matchesOperators(actual, value)) return false;
            continue;
        }
        if (!sameValue(actual, value)) return false;
    }
    return true;
}

class MemoryCursor {
    constructor(private readonly rows: Record<string, unknown>[]) {}

    project() {
        return this;
    }

    sort() {
        return this;
    }

    limit() {
        return this;
    }

    skip() {
        return this;
    }

    async toArray(): Promise<Record<string, unknown>[]> {
        return this.rows.map((row) => ({ ...row }));
    }

    async *[Symbol.asyncIterator](): AsyncGenerator<Record<string, unknown>> {
        const rows = await this.toArray();
        for (const row of rows) yield row;
    }
}

function allStored(): Record<string, unknown>[] {
    return [...contests.values(), ...trainings.values(), ...problemDocs.values()];
}

function isProblemQuery(queryValue: Record<string, unknown>): boolean {
    if (queryValue.docType === TYPE_PROBLEM) return true;
    if (queryValue.docType !== undefined) return false;
    const docId = queryValue.docId;
    if (typeof docId === 'number') return true;
    return isRecord(docId) && Array.isArray(docId.$in);
}

function noteRead(queryValue: Record<string, unknown>): void {
    if (typeof queryValue.domainId === 'string') readDomains.push(queryValue.domainId);
    if (isProblemQuery(queryValue)) problemReads += 1;
}

function noteWrite(domainId: string): void {
    writes.push(domainId);
    readDomains.push(domainId);
}

function matching(queryValue: Record<string, unknown>, record: boolean): Record<string, unknown>[] {
    if (record) noteRead(queryValue);
    return allStored().filter((doc) => matchesQuery(doc, queryValue));
}

function cursorFor(queryValue: unknown): MemoryCursor {
    if (!isRecord(queryValue)) return new MemoryCursor([]);
    return new MemoryCursor(matching(queryValue, true));
}

function applySet(doc: Record<string, unknown>, $set: unknown, $unset?: unknown): void {
    if (isRecord($set)) Object.assign(doc, $set);
    if (!isRecord($unset)) return;
    for (const key of Object.keys($unset)) delete doc[key];
}

function storedContest(id: unknown): Record<string, unknown> | null {
    return contests.get(idText(id)) ?? null;
}

function storedTraining(id: unknown): Record<string, unknown> | null {
    return trainings.get(idText(id)) ?? null;
}

const contestRules: Record<string, { hidden?: boolean }> = {
    acm: {},
    oi: {},
    ioi: {},
    ledo: {},
    strictioi: {},
    exam: {},
    homework: { hidden: true },
};

const contestApi = {
    RULES: contestRules,
    getParticipationMode(doc: { participationMode?: unknown }) {
        return doc?.participationMode === 'team' ? 'team' : 'individual';
    },
    async get(domainId: string, id: unknown) {
        readDomains.push(domainId);
        if (domainId !== DOMAIN) return null;
        return storedContest(id);
    },
    async edit(domainId: string, id: unknown, $set: unknown) {
        noteWrite(domainId);
        const doc = domainId === DOMAIN ? storedContest(id) : null;
        if (!doc) return null;
        applySet(doc, $set);
        return doc;
    },
};

const trainingApi = {
    async get(domainId: string, id: unknown) {
        readDomains.push(domainId);
        if (domainId !== DOMAIN) return null;
        return storedTraining(id);
    },
    async edit(domainId: string, id: unknown, $set: unknown, $unset?: unknown) {
        noteWrite(domainId);
        const doc = domainId === DOMAIN ? storedTraining(id) : null;
        if (!doc) return null;
        applySet(doc, $set, $unset);
        return doc;
    },
};

const documentApi = {
    TYPE_PROBLEM,
    TYPE_CONTEST,
    TYPE_TRAINING,
    getMulti(domainId: string, docType: number, queryValue?: unknown) {
        return cursorFor({ domainId, docType, ...(isRecord(queryValue) ? queryValue : {}) });
    },
    async get(domainId: string, docType: number, id: unknown) {
        const found = matching({ domainId, docType, docId: id }, true);
        return found[0] ?? null;
    },
    async set(domainId: string, docType: number, id: unknown, $set?: unknown, $unset?: unknown) {
        noteWrite(domainId);
        const found = matching({ domainId, docType, docId: id }, false);
        const doc = found[0];
        if (!doc) return null;
        applySet(doc, $set, $unset);
        return doc;
    },
    coll: {
        find(queryValue: unknown) {
            return cursorFor(queryValue);
        },
        async findOne(queryValue: unknown) {
            if (!isRecord(queryValue)) return null;
            return matching(queryValue, true)[0] ?? null;
        },
        async findOneAndUpdate(filter: unknown, update: unknown) {
            if (!isRecord(filter)) return null;
            if (typeof filter.domainId === 'string') noteWrite(filter.domainId);
            const doc = matching(filter, false)[0];
            if (!doc || !isRecord(update)) return doc ?? null;
            applySet(doc, update.$set, update.$unset);
            return doc;
        },
        async updateOne(filter: unknown, update: unknown) {
            const doc = await this.findOneAndUpdate(filter, update);
            return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
        },
    },
};

const userApi = {
    async getById(domainId: string, uid: unknown) {
        readDomains.push(domainId);
        const key = typeof uid === 'number' ? uid : Number(uid);
        const uname = userNames[key];
        if (!uname) return null;
        return { _id: key, uname };
    },
    async get(domainId: string, uid: unknown) {
        return this.getById(domainId, uid);
    },
    async getList(domainId: string, uids: unknown) {
        readDomains.push(domainId);
        const listed: Record<number, { _id: number; uname: string }> = {};
        if (!Array.isArray(uids)) return listed;
        for (const uid of uids) {
            const key = typeof uid === 'number' ? uid : Number(uid);
            const uname = userNames[key];
            if (uname) listed[key] = { _id: key, uname };
        }
        return listed;
    },
};

function visibleProblem(doc: Record<string, unknown>, canViewHidden: unknown): boolean {
    if (canViewHidden === true) return true;
    if (doc.hidden !== true) return true;
    return doc.owner === canViewHidden;
}

const problemApi = {
    PROJECTION_CONTEST_LIST: ['docId', 'pid', 'title', 'problemKind', 'hidden', 'owner'],
    async getList(domainId: string, pids: unknown, canViewHidden: unknown = false, doThrow = true) {
        const out: Record<number, Record<string, unknown>> = {};
        if (!Array.isArray(pids)) return out;
        for (const pid of pids) {
            if (typeof pid !== 'number') continue;
            const doc = problemDocs.get(pid);
            if (!doc || doc.domainId !== domainId || !visibleProblem(doc, canViewHidden)) continue;
            out[pid] = { ...doc };
        }
        if (doThrow !== false && Object.keys(out).length !== pids.length) {
            const missing = pids.find((pid) => typeof pid === 'number' && !out[pid]);
            throw new ProblemNotFoundError(domainId, missing);
        }
        return out;
    },
    getMulti(domainId: string, queryValue: unknown) {
        return cursorFor({ domainId, docType: TYPE_PROBLEM, ...(isRecord(queryValue) ? queryValue : {}) });
    },
    async get(domainId: string, id: unknown) {
        const docId = typeof id === 'number' ? id : Number(id);
        noteRead({ domainId, docType: TYPE_PROBLEM, docId });
        const doc = problemDocs.get(docId);
        if (!doc || doc.domainId !== domainId) return null;
        return { ...doc };
    },
};

function loggerModule(): Record<string, unknown> {
    return {
        __esModule: true,
        Logger: CapturingLogger,
        logger: sharedLogger,
        default: CapturingLogger,
    };
}

function isTeachCopy(filename: string | undefined): boolean {
    if (!filename) return false;
    const normalized = filename.replaceAll('\\', '/');
    return normalized.endsWith('/src/lib/teach-copy.ts')
        || normalized.endsWith('/src/handler/teach-new.ts')
        || normalized.endsWith('/src/lib/teach-copy.js')
        || normalized.endsWith('/src/handler/teach-new.js');
}

function installStub(relativePath: string, exports: Record<string, unknown>): void {
    const resolved = requireFromTest.resolve(relativePath);
    replaced.push({ resolved, previous: requireFromTest.cache[resolved] });
    const entry = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports,
        children: [],
        paths: [],
    } as NodeModule;
    requireFromTest.cache[resolved] = entry;
    Module._cache[resolved] = entry;
}

class TeachHandlerBase {
    user: TeachActor = teacher(0, [], [PRIV.PRIV_USER_PROFILE]);

    domain = { _id: DOMAIN };

    response: PageResponse = { body: null, template: null };

    request: PageHandler['request'] = {
        method: 'GET',
        params: {},
        query: {},
        body: {},
        json: false,
        headers: {},
        path: '',
    };

    args: Record<string, unknown> = {};

    session: Record<string, unknown> = {};

    checkPriv(...privs: number[]): void {
        if (!this.user.hasPriv(...privs)) throw new PrivilegeError(...privs);
    }

    checkPerm(...perms: bigint[]): void {
        if (!this.user.hasPerm(...perms)) throw new PermissionError(...perms);
    }

    async get(_args: Record<string, unknown>): Promise<unknown> {
        throw new TypeError('teach export missing: get');
    }

    async post(_args: Record<string, unknown>): Promise<unknown> {
        throw new TypeError('teach export missing: post');
    }
}

installStub('../src/model/contest.ts', { __esModule: true, ...contestApi, default: contestApi });
installStub('../src/model/training.ts', { __esModule: true, ...trainingApi, default: trainingApi });
installStub('../src/model/document.ts', { __esModule: true, ...documentApi, default: documentApi });
installStub('../src/model/user.ts', { __esModule: true, ...userApi, default: userApi });
installStub('../src/model/problem.ts', { __esModule: true, ...problemApi, default: problemApi });
installStub('../src/service/server.ts', {
    __esModule: true,
    Handler: TeachHandlerBase,
    param,
    post,
    query,
    get,
    route,
    Types,
});
installStub('../src/logger.ts', loggerModule());
hydroHost.Hydro!.model!.contest = contestApi;
hydroHost.Hydro!.model!.training = trainingApi;
hydroHost.Hydro!.model!.document = documentApi;
hydroHost.Hydro!.model!.user = userApi;
hydroHost.Hydro!.model!.problem = problemApi;

Module._load = function load(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (!isTeachCopy(parent?.filename)) return originalLoad.call(this, request, parent, isMain);
    if (request === '../logger' || request === './logger') return loggerModule();
    if (request === '@hydrooj/utils' || request === '@hydrooj/utils/lib/utils') {
        const real = originalLoad.call(this, request, parent, isMain);
        if (!isRecord(real)) return loggerModule();
        return { ...real, Logger: CapturingLogger, logger: sharedLogger };
    }
    return originalLoad.call(this, request, parent, isMain);
};

after(() => {
    Module._load = originalLoad;
    for (const item of replaced) {
        if (item.previous) requireFromTest.cache[item.resolved] = item.previous;
        else delete requireFromTest.cache[item.resolved];
    }
});

function teacher(uid: number, perms: readonly bigint[], privs: readonly number[], bank = false): TeachActor {
    let permMask = 0n;
    for (const perm of perms) permMask |= perm;
    let privMask = 0;
    for (const priv of privs) privMask |= priv;
    return {
        _id: uid,
        uname: userNames[uid] ?? `用户${uid}`,
        timeZone: 'Asia/Shanghai',
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => (permMask & perm) === perm),
        hasPriv: (...wanted: number[]) => wanted.some((priv) => (privMask & priv) === priv),
        own: (doc, exact) => (exact === true ? doc.owner === uid : doc.owner === uid || (doc.maintainer ?? []).includes(uid)),
        _problemAclLoaded: bank,
        _pidNamespaceAclLoaded: bank,
        _problemAclDomainId: DOMAIN,
        _pidNamespaceAclDomainId: DOMAIN,
        _aclFencedPids: new Set<number>(),
        _maintainedPids: new Set<number>(),
        _authoredPids: new Set<number>(),
        _dataContributionPids: new Set<number>(),
        _tagContributionPids: new Set<number>(),
        _pidNamespaceManagerIds: new Set<string>(),
        _pidNamespaceEditAllIds: new Set<string>(),
        _ownsLegacyProblems: false,
    };
}

const owner = teacher(OWNER, [PERM.PERM_EDIT_HOMEWORK_SELF, PERM.PERM_EDIT_CONTEST_SELF, PERM.PERM_EDIT_TRAINING_SELF], [PRIV.PRIV_USER_PROFILE], true);
const copier = teacher(
    COPIER,
    [PERM.PERM_CREATE_HOMEWORK, PERM.PERM_CREATE_CONTEST, PERM.PERM_CREATE_PROBLEM, PERM.PERM_VIEW_PROBLEM_BANK],
    [PRIV.PRIV_USER_PROFILE],
    true,
);
const maintainer = teacher(MAINTAINER, [PERM.PERM_EDIT_HOMEWORK_SELF], [PRIV.PRIV_USER_PROFILE]);
const practiceOnly = teacher(PRACTICE_ONLY, [PERM.PERM_CREATE_TRAINING], [PRIV.PRIV_USER_PROFILE]);
const practiceOwner = teacher(
    COPIER,
    [PERM.PERM_CREATE_TRAINING, PERM.PERM_EDIT_TRAINING_SELF, PERM.PERM_CREATE_PROBLEM, PERM.PERM_VIEW_PROBLEM_BANK],
    [PRIV.PRIV_USER_PROFILE],
    true,
);
const noCreate = teacher(NO_CREATE, [], [PRIV.PRIV_USER_PROFILE]);
const homeworkCreator = teacher(COPIER, [PERM.PERM_CREATE_HOMEWORK], [PRIV.PRIV_USER_PROFILE]);
const homeworkOwner = teacher(COPIER, [PERM.PERM_CREATE_HOMEWORK, PERM.PERM_EDIT_HOMEWORK_SELF], [PRIV.PRIV_USER_PROFILE]);

function resetFixtures(): void {
    contests.clear();
    trainings.clear();
    problemDocs.clear();
    readDomains.length = 0;
    infoLogs.length = 0;
    errorLogs.length = 0;
    writes.length = 0;
    problemReads = 0;
}

beforeEach(() => {
    resetFixtures();
});

function privateFields(maintainerIds: number[] = [SECRET_UID]): Record<string, unknown> {
    return {
        assign: ['ASSIGN-SECRET'],
        maintainer: maintainerIds,
        _code: 'CODE-SECRET-88',
        inviteCode: 'CODE-SECRET-88',
        vigilEnabled: true,
        entryMode: 'client_required',
        networkWhitelistHosts: 'VIGIL-HOST-SECRET',
        plannedTeamBatchId: 'BATCH-SECRET-PLANNED',
        teamBatchId: 'TEAM-BATCH-SECRET',
        participantScopeMode: 'groups',
        participantGroupIds: ['PARTICIPANT-SECRET'],
        clientLoginBlockBeforeMinutes: 15,
    };
}

function share(doc: Record<string, unknown>): void {
    doc.schoolShared = { sharedBy: doc.owner, sharedAt: SHARED_AT };
}

function putContest(fields: Record<string, unknown>): ObjectId {
    const docId = new ObjectId();
    const doc: Record<string, unknown> = {
        owner: OWNER,
        maintainer: [],
        title: '题目集',
        content: '',
        pids: [],
        beginAt: EXAM_BEGIN,
        endAt: EXAM_END,
        ...fields,
    };
    doc.domainId = DOMAIN;
    doc.docType = TYPE_CONTEST;
    doc.docId = docId;
    doc._id = docId;
    contests.set(docId.toHexString(), doc);
    return docId;
}

function putTraining(fields: Record<string, unknown>): ObjectId {
    const docId = new ObjectId();
    const doc: Record<string, unknown> = {
        owner: COPIER,
        maintainer: [],
        kind: 'problem_set',
        title: '练习',
        content: '',
        description: '',
        dag: [],
        ...fields,
    };
    doc.domainId = DOMAIN;
    doc.docType = TYPE_TRAINING;
    doc.docId = docId;
    doc._id = docId;
    trainings.set(docId.toHexString(), doc);
    return docId;
}

function putProblem(docId: number, fields: Record<string, unknown>): void {
    const doc: Record<string, unknown> = {
        pid: `P${docId}`,
        title: `题目${docId}`,
        problemKind: 'programming',
        hidden: false,
        owner: OWNER,
        ...fields,
    };
    doc.domainId = DOMAIN;
    doc.docType = TYPE_PROBLEM;
    doc.docId = docId;
    problemDocs.set(docId, doc);
}

function isMissingImplementation(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const code = 'code' in error ? String(error.code) : '';
    return code === 'MODULE_NOT_FOUND' || error.message.startsWith('teach export missing:');
}

function readApply(loaded: Record<string, unknown>): ((ctx: unknown) => unknown) | null {
    if (typeof loaded.apply === 'function') return loaded.apply as (ctx: unknown) => unknown;
    if (isRecord(loaded.default) && typeof loaded.default.apply === 'function') return loaded.default.apply as (ctx: unknown) => unknown;
    return null;
}

function loadHandlerModule(): Record<string, unknown> {
    let loaded: unknown;
    try {
        loaded = requireFromTest('../src/handler/teach-new.ts');
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new TypeError(`teach export missing: ${detail}`);
    }
    if (!isRecord(loaded)) throw new TypeError('teach export missing: apply');
    return loaded;
}

async function captureRoutes(loaded: Record<string, unknown>): Promise<RouteCall[]> {
    const apply = readApply(loaded);
    if (!apply) throw new TypeError('teach export missing: apply');
    const found: RouteCall[] = [];
    await apply({
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

async function callRoute(name: RouteName, actor: TeachActor, input: CallInput): Promise<PageResponse> {
    const found = await routeNamed(name);
    const handler = new found.HandlerClass();
    const queryValue = input.query ?? {};
    const body = input.body ?? {};
    const args: Record<string, unknown> = { domainId: FORGED, ...queryValue, ...body };
    if (input.type !== undefined) args.type = input.type;
    if (input.id !== undefined) args.id = input.id;
    handler.user = actor;
    handler.domain = { _id: DOMAIN };
    handler.response = { body: null, template: null };
    handler.request = {
        method: input.method,
        params: {
            ...(input.type !== undefined ? { type: input.type } : {}),
            ...(input.id !== undefined ? { id: input.id } : {}),
        },
        query: queryValue,
        body,
        json: input.method === 'post',
        headers: { accept: 'application/json' },
        path: found.path,
    };
    handler.args = { ...args };
    await handler[input.method](args);
    return handler.response;
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

async function rejectionOf(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run();
    } catch (error) {
        if (isMissingImplementation(error)) throw error;
        return error;
    }
    throw new Error('expected the call to reject');
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
    expect(isRecord(value), label).to.equal(true);
    if (!isRecord(value)) throw new Error(label);
    return value;
}

function expectKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
    expect(Object.keys(value).sort(), label).to.deep.equal([...keys].sort());
}

function expectAuthoritative(): void {
    expect(readDomains.includes(FORGED), `domains ${readDomains.join(',')}`).to.equal(false);
    expect(readDomains.includes(DOMAIN)).to.equal(true);
}

function logged(calls: unknown[][]): string {
    return calls.map((args) => args.map((item) => {
        try {
            return JSON.stringify(item);
        } catch {
            return String(item);
        }
    }).join(' ')).join('\n');
}

function assertNoPrivate(value: unknown): void {
    const text = JSON.stringify(value) ?? '';
    for (const secret of SECRETS) expect(text.includes(secret), secret).to.equal(false);
    const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
            for (const item of node) walk(item);
            return;
        }
        if (!isRecord(node)) return;
        for (const [key, item] of Object.entries(node)) {
            expect(BANNED_KEYS.has(key), key).to.equal(false);
            expect(key.startsWith('participant') || key.startsWith('vigil') || key.startsWith('network') || key.startsWith('client'), key).to.equal(false);
            walk(item);
        }
    };
    walk(value);
}

function expectProblem(value: unknown, expected: { docId: number; title: string; pid?: string; kind?: string }): void {
    const problem = expectRecord(value, 'problem');
    expectKeys(problem, PROBLEM_KEYS, 'problem');
    expect(problem.docId).to.equal(expected.docId);
    expect(problem.title).to.equal(expected.title);
    expect(typeof problem.pid).to.equal('string');
    expect(typeof problem.kind).to.equal('string');
    if (expected.pid !== undefined) expect(problem.pid).to.equal(expected.pid);
    if (expected.kind !== undefined) expect(problem.kind).to.equal(expected.kind);
}

function expectCopy(value: unknown, expected: {
    type: TeachType;
    id: ObjectId;
    title: string;
    mine: boolean;
    ownerUid: number;
    ownerName: string;
}): Record<string, unknown> {
    const copy = expectRecord(value, 'copy source');
    expectKeys(copy, COPY_KEYS, 'copy source');
    expect(copy.type).to.equal(expected.type);
    expect(copy.id).to.equal(expected.id.toHexString());
    expect(copy.title).to.equal(expected.title);
    expect(copy.mine).to.equal(expected.mine);
    expect(copy.ownerUid).to.equal(expected.ownerUid);
    expect(copy.ownerName).to.equal(expected.ownerName);
    assertNoPrivate(copy);
    return copy;
}

function expectNumberSet(value: unknown, expected: readonly number[], label: string): void {
    expect(Array.isArray(value), label).to.equal(true);
    if (!Array.isArray(value)) return;
    expect(value.every((item) => typeof item === 'number'), label).to.equal(true);
    const actual = value.map((item) => Number(item)).sort((left, right) => left - right);
    expect(actual).to.deep.equal([...expected].sort((left, right) => left - right));
}

function expectCreate(value: unknown, expected: Record<TeachType, boolean>): void {
    const canCreate = expectRecord(value, 'canCreate');
    expectKeys(canCreate, CREATE_KEYS, 'canCreate');
    for (const key of CREATE_KEYS) expect(canCreate[key], key).to.equal(expected[key as TeachType]);
}

function expectNewPage(response: PageResponse): Record<string, unknown> {
    expect(response.template).to.equal('teach_new.html');
    const body = expectRecord(response.body, 'new payload');
    expectKeys(body, NEW_KEYS, 'new payload');
    return body;
}

async function readCopyable(actor: TeachActor, type: TeachType, id: ObjectId): Promise<Record<string, unknown>> {
    const response = await callRoute('teach_copyable', actor, { method: 'get', type, id: id.toHexString() });
    return expectRecord(response.body, 'copyable body');
}

describe('teach copy', () => {
    it('registers the new, copyable, and provenance routes', async () => {
        const found = await ensureRoutes();
        const byName = new Map(found.map((item) => [item.name, item.path]));
        expect(byName.get('teach_new')).to.equal('/teach/new');
        expect(byName.get('teach_copyable')).to.equal('/teach/:type/:id/copyable');
        expect(byName.get('teach_provenance')).to.equal('/teach/:type/:id/provenance');
    });

    it('hides an unshared homework and returns it after sharing without private fields', async () => {
        putProblem(11, { pid: 'H11', title: '判断一', problemKind: 'single' });
        putProblem(12, { pid: 'H12', title: '填空一', problemKind: 'blank' });
        const id = putContest({
            ...privateFields([MAINTAINER, SECRET_UID]),
            rule: 'homework',
            title: '共享作业',
            content: '作业正文',
            description: '作业说明不应下发',
            pids: [11, 12],
            score: { 11: 5, 12: 6, 77: 9 },
            beginAt: HOMEWORK_BEGIN,
            endAt: HOMEWORK_END,
            penaltySince: HOMEWORK_PENALTY,
            penaltyRules: { 24: 0.5 },
            duration: 1.5,
            rated: true,
            langs: ['cc', 'py'],
        });
        const hidden = await rejectionOf(() => readCopyable(copier, 'homework', id));
        expect(errorName(hidden)).to.equal('NotFoundError');
        expectAuthoritative();

        expectCopy(await readCopyable(owner, 'homework', id), {
            type: 'homework',
            id,
            title: '共享作业',
            mine: true,
            ownerUid: OWNER,
            ownerName: '李老师',
        });
        const maintained = await readCopyable(maintainer, 'homework', id);
        expect(maintained.title).to.equal('共享作业');

        const doc = storedContest(id);
        if (!doc) throw new Error('homework fixture missing');
        share(doc);

        const wrongCreate = await rejectionOf(() => readCopyable(practiceOnly, 'homework', id));
        expect(errorName(wrongCreate)).to.equal('NotFoundError');
        const body = expectCopy(await readCopyable(copier, 'homework', id), {
            type: 'homework',
            id,
            title: '共享作业',
            mine: false,
            ownerUid: OWNER,
            ownerName: '李老师',
        });
        expect(body.rule).to.equal('homework');
        expect(body.content).to.equal('作业正文');
        expect(body.description).to.equal('');
        expect(body.beginAt).to.equal(HOMEWORK_BEGIN.toISOString());
        expect(body.endAt).to.equal(HOMEWORK_END.toISOString());
        expect(body.durationMinutes).to.equal(90);
        expect(body.pids).to.deep.equal([11, 12]);
        expect(body.scores).to.deep.equal({ 11: 5, 12: 6 });
        expect(body.examPaperQuotas).to.equal(null);
        expect(body.stages).to.equal(null);
        expectNumberSet(body.unusablePids, [], 'unusablePids');
        const problems = body.problems;
        expect(Array.isArray(problems)).to.equal(true);
        if (!Array.isArray(problems)) return;
        expectProblem(problems[0], { docId: 11, pid: 'H11', title: '判断一', kind: 'single' });
        expectProblem(problems[1], { docId: 12, pid: 'H12', title: '填空一', kind: 'blank' });
        const settings = expectRecord(body.settings, 'settings');
        expectKeys(settings, HOMEWORK_SETTING_KEYS, 'homework settings');
        expect(settings.kind).to.equal('homework');
        expect(settings.rated).to.equal(true);
        expect(settings.langs).to.deep.equal(['cc', 'py']);
        expect(settings.extensionDays).to.equal(2);
        expect(settings.penaltyRules).to.deep.equal({ 24: 0.5 });
        expect(writes.length).to.equal(0);
        expectAuthoritative();
    });

    it('returns shared exam quotas, contest settings, and unusable problems', async () => {
        putProblem(101, { pid: 'E101', title: '公开单选', problemKind: 'single', hidden: false, owner: OWNER });
        putProblem(102, { pid: 'E102', title: '隐藏未共享', problemKind: 'programming', hidden: true, owner: OWNER });
        putProblem(103, {
            pid: 'E103',
            title: '隐藏已共享',
            problemKind: 'single',
            hidden: true,
            owner: OWNER,
            schoolBank: { sharedBy: OWNER, sharedAt: SHARED_AT },
        });
        putProblem(104, { pid: 'E104', title: '自己的隐藏题', problemKind: 'function', hidden: true, owner: COPIER });
        const id = putContest({
            ...privateFields(),
            rule: 'exam',
            title: '期中考试',
            content: '考试说明',
            description: '不应下发',
            pids: [101, 102, 103, 104, 105],
            score: { 101: 10, 102: 20, 999: 7 },
            examPaperQuotas: { single: 2 },
            beginAt: EXAM_BEGIN,
            endAt: EXAM_END,
            lockAt: EXAM_LOCK,
            duration: 2,
            rated: false,
            autoHide: true,
            hidden: true,
            allowViewCode: true,
            allowPrint: false,
            keepScoreboardHidden: true,
            allowPostContestPractice: false,
            allowPostContestView: true,
            langs: ['py'],
            examShowVerdict: false,
            examPassScore: 60,
            examAttemptLimit: 3,
            schoolShared: { sharedBy: OWNER, sharedAt: SHARED_AT },
        });
        const body = expectCopy(await readCopyable(copier, 'exam', id), {
            type: 'exam',
            id,
            title: '期中考试',
            mine: false,
            ownerUid: OWNER,
            ownerName: '李老师',
        });
        expect(body.rule).to.equal('exam');
        expect(body.content).to.equal('考试说明');
        expect(body.description).to.equal('');
        expect(body.beginAt).to.equal(EXAM_BEGIN.toISOString());
        expect(body.endAt).to.equal(EXAM_END.toISOString());
        expect(body.durationMinutes).to.equal(120);
        expect(body.pids).to.deep.equal([101, 102, 103, 104, 105]);
        expect(body.scores).to.deep.equal({ 101: 10, 102: 20 });
        expect(body.examPaperQuotas).to.deep.equal({ single: 2 });
        expect(body.stages).to.equal(null);
        expectNumberSet(body.unusablePids, [102, 105], 'unusablePids');
        const problems = body.problems;
        expect(Array.isArray(problems)).to.equal(true);
        if (!Array.isArray(problems)) return;
        expect(problems.length).to.equal(5);
        expectProblem(problems[0], { docId: 101, pid: 'E101', title: '公开单选', kind: 'single' });
        expectProblem(problems[1], { docId: 102, pid: 'E102', title: '隐藏未共享', kind: 'programming' });
        expectProblem(problems[2], { docId: 103, pid: 'E103', title: '隐藏已共享', kind: 'single' });
        expectProblem(problems[3], { docId: 104, pid: 'E104', title: '自己的隐藏题', kind: 'function' });
        expectProblem(problems[4], { docId: 105, title: '（题目已删除）' });
        const settings = expectRecord(body.settings, 'settings');
        expectKeys(settings, CONTEST_SETTING_KEYS, 'contest settings');
        expect(settings).to.deep.equal({
            kind: 'contest',
            rated: false,
            autoHide: true,
            hidden: true,
            lockMinutes: 30,
            allowViewCode: true,
            allowPrint: false,
            keepScoreboardHidden: true,
            allowVirtual: null,
            allowPostContestPractice: false,
            allowPostContestView: true,
            allowPostContestSubmit: null,
            langs: ['py'],
            examShowVerdict: false,
            examPassScore: 60,
            examAttemptLimit: 3,
        });
        expect(problemReads >= 1 && problemReads <= 2, `problem reads ${problemReads}`).to.equal(true);
        expect(logged(errorLogs).includes('105')).to.equal(true);
        expect(writes.length).to.equal(0);
        expectAuthoritative();
    });

    it('returns practice stages in source order and no contest settings', async () => {
        putProblem(21, { pid: 'T21', title: '入门题', problemKind: 'programming', owner: COPIER });
        putProblem(22, { pid: 'T22', title: '第二题', problemKind: 'true_false', owner: COPIER });
        putProblem(23, { pid: 'T23', title: '进阶题', problemKind: 'single', owner: OWNER });
        const id = putTraining({
            ...privateFields(),
            owner: COPIER,
            title: '自己的练习',
            content: '练习正文',
            description: '练习说明',
            dag: [
                { _id: 1, title: '入门', requireNids: [], pids: [21, 22] },
                { _id: 2, title: '进阶', requireNids: [1], pids: [23] },
            ],
        });
        const body = expectCopy(await readCopyable(practiceOwner, 'practice', id), {
            type: 'practice',
            id,
            title: '自己的练习',
            mine: true,
            ownerUid: COPIER,
            ownerName: '王老师',
        });
        expect(body.rule).to.equal('problem_set');
        expect(body.content).to.equal('练习正文');
        expect(body.description).to.equal('练习说明');
        expect(body.beginAt).to.equal(null);
        expect(body.endAt).to.equal(null);
        expect(body.durationMinutes).to.equal(null);
        expect(body.examPaperQuotas).to.equal(null);
        expect(body.pids).to.deep.equal([21, 22, 23]);
        expect(body.scores).to.deep.equal({});
        expect(body.stages).to.deep.equal([
            { id: 1, title: '入门', requireIds: [], pids: [21, 22] },
            { id: 2, title: '进阶', requireIds: [1], pids: [23] },
        ]);
        expect(body.settings).to.deep.equal({ kind: 'practice' });
        const problems = body.problems;
        expect(Array.isArray(problems)).to.equal(true);
        if (!Array.isArray(problems)) return;
        expectProblem(problems[0], { docId: 21, pid: 'T21', title: '入门题', kind: 'programming' });
        expectProblem(problems[2], { docId: 23, pid: 'T23', title: '进阶题', kind: 'single' });
        expectAuthoritative();
    });

    it('records provenance once and rejects a second write', async () => {
        const sourceId = putContest({
            rule: 'homework',
            title: '来源作业',
            owner: OWNER,
            schoolShared: { sharedBy: OWNER, sharedAt: SHARED_AT },
        });
        const targetId = putContest({
            rule: 'homework',
            title: '新作业',
            owner: COPIER,
        });
        const started = Date.now();
        const response = await callRoute('teach_provenance', homeworkOwner, {
            method: 'post',
            type: 'homework',
            id: targetId.toHexString(),
            body: { sourceType: 'homework', sourceId: sourceId.toHexString() },
        });
        expect(response.body).to.deep.equal({ ok: true });
        const stored = storedContest(targetId);
        const copied = readCopiedFrom(stored?.copiedFrom);
        expect(copied === null).to.equal(false);
        if (!copied) return;
        expect(copied.type).to.equal('homework');
        expect(copied.id.equals(sourceId)).to.equal(true);
        expect(copied.title).to.equal('来源作业');
        expect(copied.ownerUid).to.equal(OWNER);
        expect(copied.copiedBy).to.equal(COPIER);
        expect(copied.copiedAt.getTime() >= started - 1000).to.equal(true);
        expect(copied.copiedAt.getTime() <= Date.now() + 1000).to.equal(true);
        expect(stored?.title).to.equal('新作业');
        const text = logged(infoLogs);
        expect(text.includes(DOMAIN)).to.equal(true);
        expect(text.includes(String(COPIER))).to.equal(true);
        expect(text.includes(targetId.toHexString())).to.equal(true);
        const writesBefore = writes.length;
        expect(writesBefore > 0).to.equal(true);
        const again = await rejectionOf(() => callRoute('teach_provenance', homeworkOwner, {
            method: 'post',
            type: 'homework',
            id: targetId.toHexString(),
            body: { sourceType: 'homework', sourceId: sourceId.toHexString() },
        }));
        expect(errorName(again)).to.equal('ValidationError');
        expect(errorText(again).includes('copiedFrom')).to.equal(true);
        expect(errorText(again).includes('这个题目集已经记录过来源')).to.equal(true);
        expect(writes.length).to.equal(writesBefore);
        expect(readCopiedFrom(storedContest(targetId)?.copiedFrom)?.copiedAt.getTime()).to.equal(copied.copiedAt.getTime());
        expectAuthoritative();
    });

    it('rejects provenance when the source type differs', async () => {
        const sourceId = putContest({
            rule: 'exam',
            title: '来源考试',
            owner: OWNER,
            schoolShared: { sharedBy: OWNER, sharedAt: SHARED_AT },
        });
        const targetId = putContest({ rule: 'homework', title: '新作业', owner: COPIER });
        const error = await rejectionOf(() => callRoute('teach_provenance', homeworkOwner, {
            method: 'post',
            type: 'homework',
            id: targetId.toHexString(),
            body: { sourceType: 'exam', sourceId: sourceId.toHexString() },
        }));
        expect(errorName(error)).to.equal('ValidationError');
        expect(errorText(error).includes('这个题目集已经记录过来源')).to.equal(false);
        expect(writes.length).to.equal(0);
        expect(storedContest(targetId)?.copiedFrom).to.equal(undefined);
    });

    it('rejects provenance when the source is not copyable', async () => {
        const sourceId = putContest({ rule: 'homework', title: '未共享作业', owner: OWNER });
        const targetId = putContest({ rule: 'homework', title: '新作业', owner: COPIER });
        const error = await rejectionOf(() => callRoute('teach_provenance', homeworkOwner, {
            method: 'post',
            type: 'homework',
            id: targetId.toHexString(),
            body: { sourceType: 'homework', sourceId: sourceId.toHexString() },
        }));
        expect(errorName(error)).to.equal('NotFoundError');
        expect(writes.length).to.equal(0);
    });

    it('rejects provenance when the caller cannot manage the target', async () => {
        const sourceId = putContest({
            rule: 'homework',
            title: '来源作业',
            owner: OWNER,
            schoolShared: { sharedBy: OWNER, sharedAt: SHARED_AT },
        });
        const targetId = putContest({ rule: 'homework', title: '别人的作业', owner: OWNER });
        const error = await rejectionOf(() => callRoute('teach_provenance', copier, {
            method: 'post',
            type: 'homework',
            id: targetId.toHexString(),
            body: { sourceType: 'homework', sourceId: sourceId.toHexString() },
        }));
        expect(errorName(error)).to.equal('PermissionError');
        expect(errorText(error).includes('你不能管理这个题目集。')).to.equal(true);
        expect(writes.length).to.equal(0);
    });

    it('rejects provenance when the target owner lacks homework edit permission', async () => {
        const sourceId = putContest({
            rule: 'homework',
            title: '来源作业',
            owner: OWNER,
            schoolShared: { sharedBy: OWNER, sharedAt: SHARED_AT },
        });
        const targetId = putContest({ rule: 'homework', title: '无编辑权的作业', owner: COPIER });
        const error = await rejectionOf(() => callRoute('teach_provenance', homeworkCreator, {
            method: 'post',
            type: 'homework',
            id: targetId.toHexString(),
            body: { sourceType: 'homework', sourceId: sourceId.toHexString() },
        }));
        expect(errorName(error)).to.equal('PermissionError');
        expect(errorText(error).includes('你不能管理这个题目集。')).to.equal(true);
        expect(writes.length).to.equal(0);
        expect(storedContest(targetId)?.copiedFrom).to.equal(undefined);
    });

    it('records practice provenance on the training document', async () => {
        const sourceId = putTraining({
            owner: OWNER,
            title: '来源练习',
            schoolShared: { sharedBy: OWNER, sharedAt: SHARED_AT },
            dag: [{ _id: 1, title: '阶段', requireNids: [], pids: [] }],
        });
        const targetId = putTraining({ owner: COPIER, title: '新练习', dag: [{ _id: 1, title: '空阶段', requireNids: [], pids: [] }] });
        const response = await callRoute('teach_provenance', practiceOwner, {
            method: 'post',
            type: 'practice',
            id: targetId.toHexString(),
            body: { sourceType: 'practice', sourceId: sourceId.toHexString() },
        });
        expect(response.body).to.deep.equal({ ok: true });
        const copied = readCopiedFrom(storedTraining(targetId)?.copiedFrom);
        expect(copied === null).to.equal(false);
        if (!copied) return;
        expect(copied.type).to.equal('practice');
        expect(copied.id.equals(sourceId)).to.equal(true);
        expect(copied.title).to.equal('来源练习');
        expect(copied.ownerUid).to.equal(OWNER);
        expect(copied.copiedBy).to.equal(COPIER);
        expect(storedTraining(targetId)?.title).to.equal('新练习');
    });

    it('builds the new page from type, course, and copy query', async () => {
        const denied = await rejectionOf(() => callRoute('teach_new', noCreate, { method: 'get' }));
        expect(errorName(denied)).to.equal('PermissionError');

        const practice = expectNewPage(await callRoute('teach_new', homeworkCreator, {
            method: 'get',
            query: { type: 'practice' },
        }));
        expect(practice.initialType).to.equal(null);
        expect(practice.fromCourse).to.equal(null);
        expect(practice.copy).to.equal(null);
        expectCreate(practice.canCreate, { practice: false, homework: true, exam: false, acm: false, oi: false });

        const linked = expectNewPage(await callRoute('teach_new', homeworkCreator, {
            method: 'get',
            query: { type: 'homework', fromCourse: COURSE_ID, chapter: '2' },
        }));
        expect(linked.initialType).to.equal('homework');
        expect(linked.fromCourse).to.deep.equal({ courseId: COURSE_ID, chapterId: 2 });
        expect(linked.copy).to.equal(null);

        const badCourse = await rejectionOf(() => callRoute('teach_new', homeworkCreator, {
            method: 'get',
            query: { type: 'homework', fromCourse: 'not-a-course', chapter: '2' },
        }));
        expect(errorName(badCourse)).to.equal('ValidationError');
        const badChapter = await rejectionOf(() => callRoute('teach_new', homeworkCreator, {
            method: 'get',
            query: { type: 'homework', fromCourse: COURSE_ID, chapter: '1.5' },
        }));
        expect(errorName(badChapter)).to.equal('ValidationError');
        const badChapterText = await rejectionOf(() => callRoute('teach_new', homeworkCreator, {
            method: 'get',
            query: { type: 'homework', fromCourse: COURSE_ID, chapter: 'abc' },
        }));
        expect(errorName(badChapterText)).to.equal('ValidationError');

        const ignored = expectNewPage(await callRoute('teach_new', practiceOnly, {
            method: 'get',
            query: { type: 'practice', fromCourse: COURSE_ID, chapter: '2' },
        }));
        expect(ignored.initialType).to.equal('practice');
        expect(ignored.fromCourse).to.equal(null);
        const omitted = expectNewPage(await callRoute('teach_new', homeworkCreator, {
            method: 'get',
            query: { fromCourse: COURSE_ID, chapter: '2' },
        }));
        expect(omitted.initialType).to.equal(null);
        expect(omitted.fromCourse).to.equal(null);

        putProblem(11, { pid: 'H11', title: '判断一', problemKind: 'single' });
        const sourceId = putContest({
            ...privateFields(),
            rule: 'homework',
            title: '可复制作业',
            content: '作业正文',
            pids: [11],
            beginAt: HOMEWORK_BEGIN,
            endAt: HOMEWORK_END,
            penaltySince: HOMEWORK_END,
            duration: 0,
            rated: false,
            langs: [],
            schoolShared: { sharedBy: OWNER, sharedAt: SHARED_AT },
        });
        const copied = expectNewPage(await callRoute('teach_new', copier, {
            method: 'get',
            query: { copy: `homework:${sourceId.toHexString()}` },
        }));
        expect(copied.initialType).to.equal(null);
        const copy = expectCopy(copied.copy, {
            type: 'homework',
            id: sourceId,
            title: '可复制作业',
            mine: false,
            ownerUid: OWNER,
            ownerName: '李老师',
        });
        expect(copy.durationMinutes).to.equal(null);
        assertNoPrivate(copied);
        const blocked = await rejectionOf(() => callRoute('teach_new', copier, {
            method: 'get',
            query: { copy: `homework:${putContest({ rule: 'homework', title: '未共享', owner: OWNER }).toHexString()}` },
        }));
        expect(errorName(blocked)).to.equal('NotFoundError');
        expect(writes.length).to.equal(0);
    });
});
