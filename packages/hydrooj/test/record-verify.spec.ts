import { expect } from 'chai';
import { STATUS } from '@hydrooj/common';
import { ObjectId } from 'mongodb';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import type { RecordDoc } from '../src/interface';

const Module = require('node:module');
const recordModelPath = require.resolve('../src/model/record.ts');
const judgePath = require.resolve('../src/handler/judge.ts');
const cancellationPath = require.resolve('../src/model/record-score-cancellation.ts');
const recordHandlerPath = require.resolve('../src/handler/record.ts');
const sourceRoot = dirname(dirname(recordModelPath));
const originalLoad = Module._load;

const VERIFY_ID = '000000000000000000000002';
const PRETEST_ID = '000000000000000000000000';
const GENERATE_ID = '000000000000000000000001';
const verifySentinel = new ObjectId(VERIFY_ID);
const pretestSentinel = new ObjectId(PRETEST_ID);
const generateSentinel = new ObjectId(GENERATE_ID);

class TestValidationError extends Error {
    params: unknown[];

    constructor(...params: unknown[]) {
        super(String(params[0] ?? 'ValidationError'));
        this.name = 'ValidationError';
        this.params = params;
    }
}

class TestPermissionError extends Error {
    params: unknown[];

    constructor(...params: unknown[]) {
        super('PermissionError');
        this.name = 'PermissionError';
        this.params = params;
    }
}

interface RuntimeGlobal {
    Hydro?: {
        model?: Record<string, unknown>;
        ui?: Record<string, unknown>;
        module?: Record<string, unknown>;
        script?: Record<string, unknown>;
        locale?: Record<string, unknown>;
    };
    app?: { parallel: (...args: unknown[]) => Promise<unknown> };
    bus?: { broadcast: (...args: unknown[]) => void };
}

interface VerifyAddArgs {
    type: 'verify';
    contest?: ObjectId;
    contestContext?: ObjectId;
    practiceContext?: { domainId: string; uid: number; pid: number };
    virtualAttemptId?: ObjectId;
    sourceContestId?: ObjectId;
}

interface QueuedTask {
    type?: string;
    rid?: ObjectId;
    input?: unknown;
    config?: { detail?: boolean };
}

interface RecordQuery {
    contest?: { $nin?: unknown[] };
}

interface DetailBody {
    tdoc?: unknown;
    rdoc?: { code?: string; compilerTexts?: string[]; testCases?: unknown[] };
    testHints?: Record<string, { hint?: string }>;
    postContestPracticeRecordAccess?: boolean;
}

interface ConnectionPush {
    rdoc?: { code?: string; compilerTexts?: string[] };
}

interface TestUser {
    _id: number;
    own: (doc?: { owner?: number }) => boolean;
    hasPerm: (...perm: bigint[]) => boolean;
    hasPriv: (priv: number) => boolean;
}

interface TestHandler {
    args: Record<string, unknown>;
    response: { body: DetailBody & Record<string, unknown> };
    user: TestUser;
    tdoc?: unknown;
    tsdoc?: unknown;
    postContestPracticeRecordAccess?: boolean;
    translate: (value: string) => string;
    __prepare: (...args: unknown[]) => Promise<void>;
    prepare: (...args: unknown[]) => Promise<void>;
    get: (...args: unknown[]) => Promise<void>;
    send?: (payload: ConnectionPush) => void;
    close?: (...args: unknown[]) => void;
    disconnectTimeout?: ReturnType<typeof setTimeout> | null;
    throttleSend?: { cancel: () => void };
}

const PERM = {
    PERM_VIEW_RECORD: 1n,
    PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD: 2n,
    PERM_VIEW_HOMEWORK_HIDDEN_SCOREBOARD: 4n,
    PERM_READ_RECORD_CODE: 8n,
    PERM_EDIT_CONTEST: 16n,
    PERM_REJUDGE: 32n,
    PERM_VIEW_PROBLEM_HIDDEN: 64n,
};
const PRIV = {
    PRIV_EDIT_SYSTEM: 1,
    PRIV_MANAGE_ALL_DOMAIN: 2,
    PRIV_READ_RECORD_CODE: 3,
    PRIV_VIEW_JUDGE_STATISTICS: 4,
};

const insertedRecords: Array<{ contest?: ObjectId; input?: unknown; _id?: ObjectId }> = [];
const queuedTasks: QueuedTask[] = [];
const judgeCalls = {
    updateStatus: [] as unknown[][],
    contestUpdate: [] as unknown[][],
    inc: [] as unknown[][],
};
const recordQueries: RecordQuery[] = [];
const contestGets: unknown[][] = [];

let problemConfig: { type: string } = { type: 'default' };
let currentRecord: Record<string, unknown> = {};
let viewableProblemAvailable = true;

const hiddenProblem: {
    domainId: string;
    docId: number;
    pid: string;
    title: string;
    hidden: boolean;
    problemKind?: string;
    config: unknown;
} = {
    domainId: 'd',
    docId: 7,
    pid: 'P7',
    title: 'Verify',
    hidden: false,
    problemKind: 'function',
    config: {},
};

function runtime(): RuntimeGlobal {
    return globalThis as typeof globalThis & RuntimeGlobal;
}

function cursor(rows: unknown[]) {
    const value = {
        sort() {
            return value;
        },
        project() {
            return value;
        },
        skip() {
            return value;
        },
        limit() {
            return value;
        },
        async toArray() {
            return rows;
        },
    };
    return value;
}

function grant(...perms: bigint[]) {
    const allowed = new Set(perms.map((perm) => perm.toString()));
    return (...requested: bigint[]) => requested.every((perm) => allowed.has(perm.toString()));
}

function makeUser(uid: number, hasPerm: (...perm: bigint[]) => boolean, hasPriv: (priv: number) => boolean): TestUser {
    return {
        _id: uid,
        own: () => false,
        hasPerm,
        hasPriv,
    };
}

const recordCollectionStub = {
    countDocuments: async () => 0,
    distinct: async () => [],
    estimatedDocumentCount: async () => 0,
    find: () => ({
        project() {
            return this;
        },
        async toArray() {
            return [];
        },
    }),
    insertOne: async (doc: { contest?: ObjectId; input?: unknown; _id?: ObjectId }) => {
        insertedRecords.push(doc);
        return { insertedId: doc._id };
    },
};

runtime().Hydro = { model: {}, ui: {}, module: {}, script: {}, locale: {} };
runtime().bus = { broadcast() {} };
runtime().app = { async parallel() { return undefined; } };

function loadModule(modulePath: string, hook: (request: string) => unknown) {
    Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
        if (parent?.filename !== modulePath) return originalLoad.call(this, request, parent, isMain);
        const stub = hook(request);
        if (stub !== undefined) return stub;
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[modulePath];
        return require(modulePath);
    } finally {
        Module._load = originalLoad;
    }
}

const recordModelModule = loadModule(recordModelPath, (request) => {
    if (request === '@hydrooj/utils') {
        return {
            Logger: class {
                error() {}
                info() {}
                warn() {}
            },
        };
    }
    if (request === '../context') return { Context: class {} };
    if (request === '../error') {
        return {
            localizedErrorText: (text: TemplateStringsArray) => text.join(''),
            ProblemConfigError: class extends Error {},
            ProblemNotFoundError: class extends Error {},
            ValidationError: TestValidationError,
        };
    }
    if (request === '../service/db') {
        return { collection: () => recordCollectionStub };
    }
    if (request === '../utils') {
        return {
            ArgMethod: (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
            buildProjection: () => ({}),
            Time: { getObjectID: () => new ObjectId() },
        };
    }
    if (request === './builtin') return { STATUS: { STATUS_WAITING: 0 } };
    if (request === './domain') return { get: async () => ({ isTrusted: true }) };
    if (request === './message') return {};
    if (request === './practice-integrity') {
        return {
            assertTrustedPracticeContextBinding() {
                throw new Error('verify fixtures do not bind a practice context');
            },
        };
    }
    if (request === './problem') {
        return {
            claimStructureLockForSubmission: async () => ({
                domainId: 'system',
                docId: 7,
                structureRevision: 1,
                config: problemConfig,
                data: [{ name: '1.in' }, { name: '1.out' }],
            }),
            assertProblemReadyForUse() {},
            get: async () => ({
                domainId: 'system',
                docId: 7,
                owner: 1,
                reference: null,
                data: ['1.in', '1.out'],
                config: problemConfig,
            }),
        };
    }
    if (request === './system') return { get: () => 128 * 1024 };
    if (request === './task') {
        return {
            deleteMany: async () => undefined,
            addMany: async (tasks: QueuedTask[]) => {
                queuedTasks.push(...tasks);
                return tasks;
            },
        };
    }
    return undefined;
});
const recordModel = recordModelModule.default as {
    RECORD_VERIFY?: ObjectId;
    add: (
        domainId: string,
        pid: number,
        uid: number,
        lang: string,
        code: string,
        addTask: boolean,
        args: VerifyAddArgs,
    ) => Promise<ObjectId>;
};

const judgeModule = loadModule(judgePath, (request) => {
    if (request === 'fs-extra') return { stat: async () => ({ size: 1 }), createReadStream: (filePath: string) => ({ filePath }) };
    if (request === '@hydrooj/utils') return { sleep: async () => undefined };
    if (request === '../context') return { Context: class {} };
    if (request === '../error') return { ForbiddenError: class extends Error {}, BadRequestError: class extends Error {} };
    if (request === '../interface') return {};
    if (request === '../lib/problem-config') return { mergeSubjectiveScores: () => null, parseProblemConfigObject: () => ({}) };
    if (request === '../logger') {
        return {
            Logger: class {
                info() {}
                warn() {}
            },
        };
    }
    if (request === '../model/builtin') {
        return {
            PERM: {},
            PRIV: {},
            STATUS: {
                STATUS_ACCEPTED: STATUS.STATUS_ACCEPTED,
                STATUS_ETC: STATUS.STATUS_ETC,
                STATUS_HACK_SUCCESSFUL: STATUS.STATUS_HACK_SUCCESSFUL,
                STATUS_HACK_UNSUCCESSFUL: STATUS.STATUS_HACK_UNSUCCESSFUL,
                STATUS_FORMAT_ERROR: STATUS.STATUS_FORMAT_ERROR,
                STATUS_SYSTEM_ERROR: STATUS.STATUS_SYSTEM_ERROR,
                STATUS_CANCELED: STATUS.STATUS_CANCELED,
            },
            STATUS_SHORT_TEXTS: {},
        };
    }
    if (request === '../model/contest') {
        return {
            async updateStatus(...args: unknown[]) {
                judgeCalls.contestUpdate.push(args);
            },
        };
    }
    if (request === '../model/domain') return { incUserInDomain: async () => undefined };
    if (request === '../model/problem') {
        return {
            async updateStatus(...args: unknown[]) {
                judgeCalls.updateStatus.push(args);
                return true;
            },
            async inc(...args: unknown[]) {
                judgeCalls.inc.push(args);
                return { domainId: 'system', docId: 7 };
            },
            async get() {
                return { domainId: 'system', docId: 7 };
            },
        };
    }
    if (request === '../model/record') return { default: { RECORD_PRETEST: pretestSentinel, RECORD_GENERATE: generateSentinel, RECORD_VERIFY: verifySentinel } };
    if (request === '../model/setting') return { langs: {} };
    if (request === '../model/storage') return {};
    if (request === '../model/system') return { get: () => 100 };
    if (request === '../model/task') return { default: {}, Consumer: class {} };
    if (request === '../model/user') return { getById: async () => ({ _id: 42 }) };
    if (request === '../service/bus') return { default: {} };
    if (request === '../service/monitor') return { updateJudge: () => undefined };
    if (request === '../service/server') {
        const noop = () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
        return {
            ConnectionHandler: class {},
            Handler: class {},
            post: noop,
            subscribe: noop,
            Types: new Proxy({}, { get: () => () => ({}) }),
        };
    }
    return undefined;
}) as { postJudge: (rdoc: RecordDoc) => Promise<void> };

const cancellationModule = loadModule(cancellationPath, (request) => {
    if (request === './record') {
        const scoreRecord = {
            RECORD_PRETEST: pretestSentinel,
            RECORD_GENERATE: generateSentinel,
            RECORD_VERIFY: verifySentinel,
        };
        return { __esModule: true, default: scoreRecord };
    }
    if (request === './document') return { TYPE_PROBLEM: 10, collStatus: {} };
    if (request === './contest') return {};
    if (request === './oplog') return {};
    return undefined;
}) as { buildRecordScoreAction: (rdoc: RecordDoc, authorized: boolean) => { kind: string } | null };

const recordStub = {
    RECORD_PRETEST: pretestSentinel,
    RECORD_GENERATE: generateSentinel,
    RECORD_VERIFY: verifySentinel,
    PROJECTION_LIST: ['_id', 'domainId', 'uid', 'pid', 'contest', 'status', 'compilerTexts', 'testCases'],
    getMulti(_domainId: string, query: RecordQuery) {
        recordQueries.push(query);
        return cursor([currentRecord]);
    },
    async get() {
        return currentRecord;
    },
    collHistory: {
        find() {
            return cursor([]);
        },
        async findOne() {
            return null;
        },
    },
};

const contestStub = {
    async get(...args: unknown[]) {
        contestGets.push(args);
        return {
            domainId: 'd',
            docId: args[1],
            rule: 'homework',
            pids: [7],
        };
    },
    async getStatus() {
        return { attend: 1 };
    },
    getParticipationMode() {
        return 'individual';
    },
    canShowScoreboard() {
        return true;
    },
    canShowSelfRecord() {
        return true;
    },
    canShowRecord() {
        return true;
    },
    applyProjection(_tdoc: unknown, rdoc: unknown) {
        return rdoc;
    },
    isDone() {
        return true;
    },
    isClientRequired() {
        return false;
    },
    isOngoing() {
        return false;
    },
};

const problemStub = {
    PROJECTION_LIST: ['domainId', 'docId', 'pid', 'title', 'hidden', 'config', 'problemKind'],
    PROJECTION_PUBLIC: ['domainId', 'docId', 'pid', 'title', 'hidden', 'config', 'problemKind'],
    PROJECTION_CONTEST_LIST: ['domainId', 'docId', 'pid', 'title'],
    async get() {
        return hiddenProblem;
    },
    getMulti() {
        return cursor([hiddenProblem]);
    },
    async getViewableAuthorized() {
        return viewableProblemAvailable ? hiddenProblem : null;
    },
    async getListViewableAuthorized() {
        return { 7: hiddenProblem };
    },
    async getList() {
        return { 7: hiddenProblem };
    },
    async getStatus() {
        return null;
    },
};

const userStub = {
    async getById(_domainId: string, uid: number) {
        return { _id: uid, uname: `u${uid}` };
    },
    async getByUname() {
        return null;
    },
    async getByEmail() {
        return null;
    },
    async getList() {
        return {};
    },
};

class HandlerStub {
    args: Record<string, unknown> = {};
    response: { body: DetailBody & Record<string, unknown> } = { body: {} };
    user: TestUser = makeUser(0, () => false, () => false);
    tdoc?: unknown;
    tsdoc?: unknown;

    checkPerm(permission: bigint) {
        if (!this.user.hasPerm(permission)) throw new TestPermissionError(permission);
    }

    checkPriv(privilege: number) {
        if (!this.user.hasPriv(privilege)) throw new TestPermissionError(privilege);
    }
}

// Contest detail base loads a contest whenever tid is passed, as (domainId, tid) or (domainId, rid, tid).
class ContestDetailBaseStub extends HandlerStub {
    async __prepare(domainId: string, ...rest: unknown[]) {
        const tid = rest.length > 1 ? rest[1] : rest[0];
        if (tid) await contestStub.get(domainId, tid);
    }
}

const recordHandlerModule = loadModule(recordHandlerPath, (request) => {
    if (request === '../error') {
        return new Proxy(
            {
                PermissionError: TestPermissionError,
                ContestNotFoundError: class extends Error {},
                ProblemNotFoundError: class extends Error {},
                RecordNotFoundError: class extends Error {},
                ValidationError: TestValidationError,
            },
            { get: (target, key: string) => target[key as keyof typeof target] || class extends Error {} },
        );
    }
    if (request === '../model/builtin') return { PERM, PRIV, STATUS: { STATUS_ACCEPTED: 1 }, STATUS_TEXTS: {} };
    if (request === '../model/contest') return contestStub;
    if (request === '../model/contest-team') return { getTeamByMember: async () => null, getTeam: async () => null };
    if (request === '../lib/testdataConfig') return { parseConfig: async (config: unknown) => config };
    if (request === '../lib/teach-access') return { canManageTeachContainer: () => false };
    if (request === '../model/problem') return { default: problemStub, ...problemStub };
    if (request === '../model/problem-access') {
        return {
            PROBLEM_ACL_INTERNAL_FIELDS: new Set(['aclMutationRevision', 'aclMutationLocks', 'aclWriteClaim']),
            async readContextViewableProblem(_domainId: string, _user: TestUser, context: { kind?: string }, adapters: {
                readDirectStable: () => Promise<typeof hiddenProblem | null>;
                readContainer: () => Promise<typeof hiddenProblem | null>;
            }) {
                if (context.kind !== 'record-detail' && context.kind !== 'record-detail-connection') {
                    throw new TypeError(String(context.kind));
                }
                const pdoc = await adapters.readDirectStable();
                return viewableProblemAvailable ? pdoc : null;
            },
        };
    }
    if (request === '../model/record') return { default: recordStub, ...recordStub };
    if (request === '../model/setting') return { langs: { 'cc.cc17': { display: 'C++ 17' } } };
    if (request === '../model/storage') return { default: {} };
    if (request === '../model/system') {
        const systemStub = { get: () => 20 };
        return { default: systemStub, ...systemStub };
    }
    if (request === '../model/user') return { default: userStub, ...userStub };
    if (request === '../service/server') {
        const noop = () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
        return {
            ConnectionHandler: class extends HandlerStub {},
            param: noop,
            subscribe: noop,
            Types: new Proxy({}, { get: () => () => ({}) }),
        };
    }
    if (request === '../service/student-directory') {
        return { studentDirectory: () => ({ findStudentsByUserIds: async () => ({}) }) };
    }
    if (request === '../utils') {
        return {
            buildProjection(keys: string[]) {
                return Object.fromEntries(keys.map((key) => [key, 1]));
            },
            Time: { week: 7 * 24 * 60 * 60 * 1000, getObjectID: () => new ObjectId() },
        };
    }
    if (request === './contest') {
        return {
            ContestDetailBaseHandler: ContestDetailBaseStub,
            hideAssignRestrictedContest: async () => undefined,
            assertHomeworkAccessOrHide: async () => undefined,
        };
    }
    if (request === '../model/record-score-cancellation') {
        return {
            auditRecordScorePermissionRejection: async () => undefined,
            cancelRecordScore: async () => ({ rdoc: {} }),
            getRecordScoreAction: async () => null,
            recoverCanceledRecord: async () => ({ rdoc: {} }),
        };
    }
    if (request === '../model/virtual-contest') {
        return {
            canManageVirtualContest: () => false,
            virtualContestService: { getAttempt: async () => null, getOfficialAttempt: async () => null },
        };
    }
    return undefined;
}) as {
    RecordListHandler: new () => TestHandler;
    RecordDetailHandler: new () => TestHandler;
    RecordDetailConnectionHandler: new () => TestHandler;
};

function makeHandler(Ctor: new () => TestHandler, user: TestUser): TestHandler {
    const handler = new Ctor();
    handler.user = user;
    handler.response = { body: {} };
    handler.args = {};
    handler.translate = (value: string) => value;
    return handler;
}

function verifyRecord(uid = 42) {
    return {
        _id: new ObjectId('6870000100000000000000a2'),
        domainId: 'd',
        uid,
        pid: 7,
        lang: 'cc.cc17',
        code: 'int main() {}',
        status: 1,
        score: 100,
        time: 1,
        memory: 1,
        contest: new ObjectId(VERIFY_ID),
        compilerTexts: ['compile ok'],
        judgeTexts: [],
        testCases: [{ id: 1, subtaskId: 1, score: 100 }],
        files: {},
        subtasks: {},
    };
}

function judgedRecord(contest: ObjectId): RecordDoc {
    return {
        _id: new ObjectId(),
        domainId: 'system',
        uid: 42,
        pid: 7,
        status: STATUS.STATUS_ACCEPTED,
        score: 100,
        judgeAt: new Date('2026-10-21T00:00:00.000Z'),
        contest,
    } as RecordDoc;
}

async function catchError(work: () => Promise<unknown>): Promise<unknown> {
    try {
        await work();
        return undefined;
    } catch (caught) {
        return caught;
    }
}

function addVerify(addTask: boolean, args: VerifyAddArgs) {
    return recordModel.add('system', 7, 42, 'cc', 'int main() {}', addTask, args);
}

function hexIds(values: unknown[] | undefined) {
    return (values ?? []).map((value) => (value instanceof ObjectId ? value.toHexString() : String(value)));
}

function expectVerifyNin(query: RecordQuery) {
    const hex = hexIds(query.contest?.$nin);
    expect(hex).to.include(PRETEST_ID);
    expect(hex).to.include(GENERATE_ID);
    expect(hex).to.include(VERIFY_ID);
}

function walkTypeScript(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
            if (entry === 'node_modules') continue;
            files.push(...walkTypeScript(path));
        } else if (entry.endsWith('.ts')) files.push(path);
    }
    return files;
}

function matchingBracket(source: string, start: number): number {
    let depth = 0;
    let i = start;
    while (i < source.length) {
        const ch = source[i];
        if (ch === "'" || ch === '"') {
            i = skipQuoted(source, i);
            continue;
        }
        if (ch === '`') {
            i = skipTemplate(source, i);
            continue;
        }
        if (ch === '/' && source[i + 1] === '/') {
            const next = source.indexOf('\n', i);
            i = next < 0 ? source.length : next + 1;
            continue;
        }
        if (ch === '/' && source[i + 1] === '*') {
            const next = source.indexOf('*/', i + 2);
            i = next < 0 ? source.length : next + 2;
            continue;
        }
        if (ch === '[') depth += 1;
        if (ch === ']') {
            depth -= 1;
            if (depth === 0) return i;
        }
        i += 1;
    }
    return source.length - 1;
}

function skipQuoted(source: string, start: number) {
    const quote = source[start];
    let i = start + 1;
    while (i < source.length) {
        if (source[i] === '\\') {
            i += 2;
            continue;
        }
        if (source[i] === quote) return i + 1;
        if (source[i] === '\n') return i;
        i += 1;
    }
    return i;
}

function skipTemplate(source: string, start: number) {
    let i = start + 1;
    while (i < source.length) {
        if (source[i] === '\\') {
            i += 2;
            continue;
        }
        if (source[i] === '`') return i + 1;
        if (source[i] === '$' && source[i + 1] === '{') {
            i = skipBlock(source, i + 1);
            continue;
        }
        i += 1;
    }
    return i;
}

function skipBlock(source: string, start: number) {
    let depth = 0;
    let i = start;
    while (i < source.length) {
        const ch = source[i];
        if (ch === "'" || ch === '"') {
            i = skipQuoted(source, i);
            continue;
        }
        if (ch === '`') {
            i = skipTemplate(source, i);
            continue;
        }
        if (ch === '{') depth += 1;
        if (ch === '}') {
            depth -= 1;
            if (depth === 0) return i + 1;
        }
        i += 1;
    }
    return i;
}

function arrayLiterals(source: string) {
    const ranges: string[] = [];
    let i = 0;
    while (i < source.length) {
        const ch = source[i];
        if (ch === "'" || ch === '"') {
            i = skipQuoted(source, i);
            continue;
        }
        if (ch === '`') {
            i = skipTemplate(source, i);
            continue;
        }
        if (ch === '/' && source[i + 1] === '/') {
            const next = source.indexOf('\n', i);
            i = next < 0 ? source.length : next + 1;
            continue;
        }
        if (ch === '/' && source[i + 1] === '*') {
            const next = source.indexOf('*/', i + 2);
            i = next < 0 ? source.length : next + 2;
            continue;
        }
        if (ch === '[') {
            const end = matchingBracket(source, i);
            ranges.push(source.slice(i, end + 1));
            i += 1;
            continue;
        }
        i += 1;
    }
    return ranges;
}

function hasWord(text: string, word: string) {
    return new RegExp(`\\b${word}\\b`).test(text);
}

function sentinelArrayKind(text: string): 'objectId' | 'contestId' | '' {
    if (hasWord(text, 'RECORD_PRETEST') && hasWord(text, 'RECORD_GENERATE')) return 'objectId';
    if (text.includes('RECORD_PRETEST_CONTEST_ID') && text.includes('RECORD_GENERATE_CONTEST_ID')) return 'contestId';
    return '';
}

const scope = require('../src/lib/record-connection-scope') as {
    matchesRecordConnectionScope: (
        candidate: { domainId: string; contestId?: string },
        next: { domainId: string; tid?: string; pretest: boolean; all: boolean; allDomain: boolean },
    ) => boolean;
    RECORD_VERIFY_CONTEST_ID?: string;
};

const practiceScope = { domainId: 'system', pretest: false, all: false, allDomain: false };
const contestTid = '64b000000000000000000001';

beforeEach(() => {
    insertedRecords.length = 0;
    queuedTasks.length = 0;
    judgeCalls.updateStatus.length = 0;
    judgeCalls.contestUpdate.length = 0;
    judgeCalls.inc.length = 0;
    recordQueries.length = 0;
    contestGets.length = 0;
    problemConfig = { type: 'default' };
    viewableProblemAvailable = true;
    hiddenProblem.problemKind = 'function';
    hiddenProblem.config = {
        type: 'function',
        cases: [
            { input: 'a.in', output: 'a.out', hint: '检查零值。', hintPublic: true },
            { input: 'b.in', output: 'b.out', hint: 'private', hintPublic: false },
        ],
    };
    currentRecord = verifyRecord();
    runtime().bus = { broadcast() {} };
    runtime().Hydro = { model: {}, ui: {}, module: {}, script: {}, locale: {} };
    runtime().app = { async parallel() { return undefined; } };
});

describe('verify record sentinel', () => {
    it('exposes the verify contest id on the record model and connection scope', () => {
        expect(recordModel.RECORD_VERIFY).to.be.instanceOf(ObjectId);
        expect(recordModel.RECORD_VERIFY?.equals(verifySentinel)).to.equal(true);
        expect(scope.RECORD_VERIFY_CONTEST_ID).to.equal(VERIFY_ID);
    });

    it('writes a verify record without input and queues a normal judge task', async () => {
        await addVerify(true, { type: 'verify' });

        expect(insertedRecords).to.have.length(1);
        expect(insertedRecords[0].contest?.equals(verifySentinel)).to.equal(true);
        expect(insertedRecords[0].input).to.equal(undefined);
        expect(queuedTasks).to.have.length(1);
        expect(queuedTasks[0].type).to.equal('judge');
        expect(queuedTasks[0].input).to.equal(undefined);
        expect(queuedTasks[0].config?.detail).to.equal(undefined);
        expect(String(queuedTasks[0].rid)).to.equal(String(insertedRecords[0]._id));
    });

    it('rejects verify together with a contest context', async () => {
        const error = await catchError(() => addVerify(true, { type: 'verify', contestContext: new ObjectId() }));

        expect(error).to.be.instanceOf(TestValidationError);
        expect((error as TestValidationError).params[0]).to.equal('type');
        expect(insertedRecords).to.deep.equal([]);
        expect(queuedTasks).to.deep.equal([]);
    });

    it('rejects verify together with a practice context', async () => {
        const error = await catchError(() => addVerify(true, {
            type: 'verify',
            practiceContext: { domainId: 'system', uid: 42, pid: 7 },
        }));

        expect(error).to.be.instanceOf(TestValidationError);
        expect((error as TestValidationError).params[0]).to.equal('type');
        expect(insertedRecords).to.deep.equal([]);
    });

    it('rejects verify together with a virtual attempt', async () => {
        const error = await catchError(() => addVerify(true, {
            type: 'verify',
            virtualAttemptId: new ObjectId(),
            sourceContestId: new ObjectId(),
        }));

        expect(error).to.be.instanceOf(TestValidationError);
        expect((error as TestValidationError).params[0]).to.equal('type');
        expect(insertedRecords).to.deep.equal([]);
    });

    it('rejects verify together with a contest id', async () => {
        const error = await catchError(() => addVerify(true, { type: 'verify', contest: new ObjectId() }));

        expect(error).to.be.instanceOf(TestValidationError);
        expect((error as TestValidationError).params[0]).to.equal('type');
        expect(insertedRecords).to.deep.equal([]);
        expect(queuedTasks).to.deep.equal([]);
    });

    it('rejects verify together with only a source contest id', async () => {
        const error = await catchError(() => addVerify(true, {
            type: 'verify',
            sourceContestId: new ObjectId(),
        }));

        expect(error).to.be.instanceOf(TestValidationError);
        expect((error as TestValidationError).params[0]).to.equal('type');
        expect(insertedRecords).to.deep.equal([]);
        expect(queuedTasks).to.deep.equal([]);
    });

    it('rejects verify together with only a virtual attempt id', async () => {
        const error = await catchError(() => addVerify(true, {
            type: 'verify',
            virtualAttemptId: new ObjectId(),
        }));

        expect(error).to.be.instanceOf(TestValidationError);
        expect((error as TestValidationError).params[0]).to.equal('type');
        expect(insertedRecords).to.deep.equal([]);
        expect(queuedTasks).to.deep.equal([]);
    });
});

describe('verify record post-judge', () => {
    it('does not update problem or contest statistics for a verify record', async () => {
        await judgeModule.postJudge({
            _id: new ObjectId(),
            domainId: 'system',
            uid: 42,
            pid: 7,
            status: STATUS.STATUS_ACCEPTED,
            score: 100,
            contest: verifySentinel,
        } as RecordDoc);

        expect(judgeCalls.updateStatus).to.deep.equal([]);
        expect(judgeCalls.contestUpdate).to.deep.equal([]);
        expect(judgeCalls.inc).to.deep.equal([]);
    });
});

describe('verify record list exclusion', () => {
    it('excludes verify records from the all-contest record query', async () => {
        const handler = makeHandler(
            recordHandlerModule.RecordListHandler,
            makeUser(7, grant(PERM.PERM_VIEW_RECORD, PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD, PERM.PERM_VIEW_HOMEWORK_HIDDEN_SCOREBOARD), () => false),
        );

        await handler.get('d', 1, undefined, undefined, false, false, undefined, undefined, undefined, false, true, false, false);

        expect(recordQueries).to.have.length(1);
        expectVerifyNin(recordQueries[0]);
    });

    it('excludes verify records from the all-domain record query', async () => {
        const handler = makeHandler(
            recordHandlerModule.RecordListHandler,
            makeUser(1, grant(PERM.PERM_VIEW_RECORD), (privilege) => privilege === PRIV.PRIV_MANAGE_ALL_DOMAIN),
        );

        await handler.get('d', 1, undefined, undefined, false, false, undefined, undefined, undefined, false, false, true, false);

        expect(recordQueries).to.have.length(1);
        expectVerifyNin(recordQueries[0]);
    });
});

describe('verify record detail access', () => {
    it('shows the submitter test points, compiler output, and public hints without loading a contest', async () => {
        const handler = makeHandler(recordHandlerModule.RecordDetailHandler, makeUser(42, () => false, () => false));

        await handler.prepare('d', currentRecord._id, false);
        await handler.get('d', currentRecord._id, false);

        expect(handler.response.body.rdoc?.compilerTexts).to.deep.equal(['compile ok']);
        expect(handler.response.body.rdoc?.testCases).to.have.length(1);
        expect(handler.response.body.testHints).to.deep.equal({ '1-1': { hint: '检查零值。' } });
        expect(handler.response.body.tdoc ?? null).to.equal(null);
        expect(handler.postContestPracticeRecordAccess ?? false).to.equal(false);
        expect(contestGets).to.deep.equal([]);
    });

    it('rejects another teacher in the same domain', async () => {
        const handler = makeHandler(
            recordHandlerModule.RecordDetailHandler,
            makeUser(99, grant(PERM.PERM_VIEW_RECORD, PERM.PERM_READ_RECORD_CODE), () => false),
        );
        const error = await catchError(async () => {
            await handler.prepare('d', currentRecord._id, false);
            await handler.get('d', currentRecord._id, false);
        });

        expect(error).to.be.instanceOf(TestPermissionError);
        expect((error as TestPermissionError).params[0]).to.equal(PERM.PERM_VIEW_RECORD);
        expect(contestGets).to.deep.equal([]);
    });

    it('lets a system administrator open the verify record without loading a contest', async () => {
        const handler = makeHandler(
            recordHandlerModule.RecordDetailHandler,
            makeUser(1, grant(PERM.PERM_VIEW_RECORD), (privilege) => privilege === PRIV.PRIV_EDIT_SYSTEM),
        );

        await handler.prepare('d', currentRecord._id, false);
        await handler.get('d', currentRecord._id, false);

        expect(handler.response.body.rdoc?.testCases).to.have.length(1);
        expect(handler.response.body.rdoc?.compilerTexts).to.deep.equal(['compile ok']);
        expect(handler.response.body.rdoc?.code).to.equal('int main() {}');
        expect(handler.response.body.testHints).to.deep.equal({ '1-1': { hint: '检查零值。' } });
        expect(handler.response.body.tdoc ?? null).to.equal(null);
        expect(contestGets).to.deep.equal([]);
    });

    it('lets a system administrator without record permission open the verify record', async () => {
        const handler = makeHandler(
            recordHandlerModule.RecordDetailHandler,
            makeUser(1, () => false, (privilege) => privilege === PRIV.PRIV_EDIT_SYSTEM),
        );

        await handler.prepare('d', currentRecord._id, false);
        await handler.get('d', currentRecord._id, false);

        expect(handler.response.body.rdoc?.compilerTexts).to.deep.equal(['compile ok']);
        expect(handler.response.body.rdoc?.code).to.equal('int main() {}');
        expect(handler.response.body.tdoc ?? null).to.equal(null);
        expect(contestGets).to.deep.equal([]);
    });

    it('shows compiler output to a system administrator on the detail connection', async () => {
        const sent: ConnectionPush[] = [];
        const handler = makeHandler(
            recordHandlerModule.RecordDetailConnectionHandler,
            makeUser(1, () => false, (privilege) => privilege === PRIV.PRIV_EDIT_SYSTEM),
        );
        handler.send = (payload) => {
            sent.push(payload);
        };
        handler.close = () => undefined;

        await handler.prepare('d', currentRecord._id, undefined, false, true);
        handler.throttleSend?.cancel();
        if (handler.disconnectTimeout) clearTimeout(handler.disconnectTimeout);

        expect(sent).to.have.length(1);
        expect(sent[0].rdoc?.compilerTexts).to.deep.equal(['compile ok']);
        expect(sent[0].rdoc?.code).to.equal('int main() {}');
        expect(contestGets).to.deep.equal([]);
    });

    it('does not load a contest when the detail url carries tid', async () => {
        const handler = makeHandler(recordHandlerModule.RecordDetailHandler, makeUser(42, () => false, () => false));
        const rid = String(currentRecord._id);
        const tid = new ObjectId(contestTid);
        // @param invokes __prepare(domainId, tid). The route rid stays a string on args.
        handler.args = { rid, tid: String(tid) };

        await handler.__prepare('d', tid);
        expect(contestGets).to.deep.equal([]);

        await handler.prepare('d', currentRecord._id, false);
        await handler.get('d', currentRecord._id, false);

        expect(contestGets).to.deep.equal([]);
        expect(handler.tdoc ?? null).to.equal(null);
        expect(handler.response.body.tdoc ?? null).to.equal(null);
        expect(handler.response.body.rdoc?.compilerTexts).to.deep.equal(['compile ok']);
    });

    it('does not open a verify record through the post-contest practice bypass', async () => {
        const handler = makeHandler(recordHandlerModule.RecordDetailHandler, makeUser(42, () => false, () => false));
        const tid = new ObjectId(contestTid);
        handler.args = { tid, practice: true };
        handler.tdoc = { domainId: 'd', docId: tid, rule: 'acm', pids: [7] };
        handler.tsdoc = { attend: 1 };
        const error = await catchError(() => handler.prepare('d', currentRecord._id, true));

        expect(error).to.be.instanceOf(TestPermissionError);
        expect((error as TestPermissionError).params[0]).to.equal(PERM.PERM_VIEW_RECORD);
        expect(handler.postContestPracticeRecordAccess ?? false).to.equal(false);
    });
});

describe('verify record connection scope', () => {
    it('does not push a verify record to a contest-scoped connection', () => {
        expect(scope.matchesRecordConnectionScope(
            { domainId: 'system', contestId: VERIFY_ID },
            { ...practiceScope, tid: contestTid },
        )).to.equal(false);
    });

    it('keeps verify records out of expanded and pretest connections', () => {
        expect(scope.matchesRecordConnectionScope(
            { domainId: 'system', contestId: VERIFY_ID },
            { ...practiceScope, all: true },
        )).to.equal(false);
        expect(scope.matchesRecordConnectionScope(
            { domainId: 'system', contestId: VERIFY_ID },
            { ...practiceScope, allDomain: true },
        )).to.equal(false);
        expect(scope.matchesRecordConnectionScope(
            { domainId: 'system', contestId: VERIFY_ID },
            { ...practiceScope, pretest: true },
        )).to.equal(false);
        expect(scope.matchesRecordConnectionScope(
            { domainId: 'system', contestId: VERIFY_ID },
            practiceScope,
        )).to.equal(false);
    });
});

describe('verify record score cancellation', () => {
    it('excludes a verify record from score cancellation the same way as the other sentinels', () => {
        expect(cancellationModule.buildRecordScoreAction(judgedRecord(new ObjectId()), true)?.kind).to.equal('cancel');
        expect(cancellationModule.buildRecordScoreAction(judgedRecord(pretestSentinel), true)).to.equal(null);
        expect(cancellationModule.buildRecordScoreAction(judgedRecord(verifySentinel), true)).to.equal(null);
    });
});

describe('verify record source contract', () => {
    it('adds the verify sentinel to every pretest and generate sentinel array except scheduled cleanup', () => {
        const found: Array<{ path: string; array: string; kind: 'objectId' | 'contestId' }> = [];
        for (const file of walkTypeScript(sourceRoot)) {
            const path = relative(sourceRoot, file).split(sep).join('/');
            const source = readFileSync(file, 'utf8');
            for (const array of arrayLiterals(source)) {
                const kind = sentinelArrayKind(array);
                if (kind) found.push({ path, array, kind });
            }
        }
        const minimal = found.filter((entry) => !found.some((other) => other.array.length < entry.array.length && entry.array.includes(other.array)));
        const violations: string[] = [];
        const cleanups: string[] = [];
        for (const entry of minimal) {
            const compact = entry.array.replace(/\s+/g, ' ');
            if (entry.path === 'model/schedule.ts') {
                cleanups.push(compact);
                if (hasWord(entry.array, 'RECORD_VERIFY') || entry.array.includes('RECORD_VERIFY_CONTEST_ID')) {
                    violations.push(`${entry.path} must not delete verify records: ${compact}`);
                }
                continue;
            }
            if (entry.kind === 'objectId' && !hasWord(entry.array, 'RECORD_VERIFY')) {
                violations.push(`${entry.path} missing RECORD_VERIFY: ${compact}`);
            }
            if (entry.kind === 'contestId' && !entry.array.includes('RECORD_VERIFY_CONTEST_ID')) {
                violations.push(`${entry.path} missing RECORD_VERIFY_CONTEST_ID: ${compact}`);
            }
        }
        expect(cleanups.length).to.be.greaterThan(0);
        expect(violations).to.deep.equal([]);
    });
});
