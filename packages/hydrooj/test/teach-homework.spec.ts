import { beforeEach, describe, it } from 'node:test';
import { Time } from '@hydrooj/utils/lib/utils';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { InMemoryStudentDirectory, studentRecord } from '../src/lib/testing/in-memory-student-directory';
import { registerStudentDirectory } from '../src/service/student-directory';

const Module = require('node:module') as {
    _load: (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
};

const hydroHost = globalThis as unknown as {
    Hydro?: { model: Record<string, unknown>; ui?: Record<string, unknown> };
};
if (!hydroHost.Hydro) hydroHost.Hydro = { model: {} };
if (!hydroHost.Hydro.model) hydroHost.Hydro.model = {};
if (!hydroHost.Hydro.ui) hydroHost.Hydro.ui = {};

const { PERM } = require('../src/model/builtin') as {
    PERM: { PERM_ATTEND_HOMEWORK: bigint };
};

const DOMAIN = 'system';
const UID = 42;
const homeworkId = new ObjectId('64b0000000000000000000b2');
/** Students only see homework assigned to one of their groups (student-sets-entry D3). */
const HOMEWORK_GROUP = new ObjectId('64b0000000000000000000c1');

registerStudentDirectory(
    new InMemoryStudentDirectory({
        students: [studentRecord({ domainId: DOMAIN, boundUserId: UID, groupIds: [HOMEWORK_GROUP] })],
    }),
);
const hour = Time.hour;
const RANGE_MESSAGE = '个人限时必须大于 0，且不能超过开放时间';
const EXTENSION_MESSAGE = '个人限时和允许迟交不能同时打开';
const SCORE_MESSAGE = '题目分数无效';
const START_MESSAGE = '这份作业没有个人限时，不需要开始作答';

interface TimedDoc {
    rule?: string;
    duration?: number;
    beginAt: Date;
    endAt: Date;
}

interface StatusDoc {
    attend?: number;
    startAt?: Date | null;
    journal?: unknown[];
}

interface HomeworkDoc extends TimedDoc {
    domainId: string;
    docId: ObjectId;
    owner: number;
    rule: string;
    title: string;
    content: string;
    pids: number[];
    assign: string[];
    penaltySince: Date;
    duration?: number;
    participantScopeMode?: string;
    participantGroupIds?: ObjectId[];
}

interface ProblemRow {
    docId: number;
    pid: string;
    title: string;
}

interface ErrorView {
    name: string;
    field: string;
    text: string;
}

interface SaveInput {
    tid?: ObjectId;
    extensionDays?: number;
    content?: string;
    pids?: string;
    contestDuration?: number;
    problemScores?: string;
    beginAtDate?: string;
    beginAtTime?: string;
    penaltySinceDate?: string;
    penaltySinceTime?: string;
}

interface KindCall {
    domainId: string;
    type: string;
    next: number[];
    previous: number[];
}

interface StatusWrite {
    domainId: string;
    tid: unknown;
    uid: number;
    startAt: Date | null;
}

interface TestUser {
    _id: number;
    group: string[];
    timeZone: string;
    hasPerm: (perm: bigint) => boolean;
    hasPriv: (priv: number) => boolean;
    own: (doc: { owner?: number }) => boolean;
}

interface HandlerBase {
    domain: { _id: string };
    user: TestUser;
    response: { body: Record<string, unknown>; template?: string; redirect?: string };
    request: { ip: string };
    paginate: (...args: unknown[]) => Promise<[unknown[], number, number]>;
    url: (name: string, args?: Record<string, unknown>) => string;
    back: () => void;
    checkPerm: (perm: bigint) => void;
    prepare: (domainId: string, tid: ObjectId) => Promise<void>;
    get: (domainId: string, tid: ObjectId, page?: number) => Promise<void>;
    postUpdate: (...args: unknown[]) => Promise<void>;
    postStart?: () => Promise<void>;
}

interface ContestClock {
    isOngoing: (tdoc: TimedDoc, tsdoc?: StatusDoc | null) => boolean;
    isNotStarted: (tdoc: TimedDoc) => boolean;
    isDone: (tdoc: TimedDoc, tsdoc?: StatusDoc | null) => boolean;
    homeworkStartRequired?: (tdoc: TimedDoc, tsdoc?: StatusDoc | null) => boolean;
}

const contestPath = require.resolve('../src/model/contest.ts');
const homeworkPath = require.resolve('../src/handler/homework.ts');
const adds: unknown[][] = [];
const edits: unknown[][] = [];
const kindCalls: KindCall[] = [];
const callTrace: string[] = [];
const setCalls: StatusWrite[] = [];
const attendCalls: string[] = [];
const recalcIds: string[] = [];
const infoCalls: unknown[][] = [];
const permChecks: bigint[] = [];
const backCalls: string[] = [];
let currentHomework: HomeworkDoc;
let status: StatusDoc = { attend: 1, journal: [] };
let allowAttend = true;
let visibleProblems: ProblemRow[] = [{ docId: 3, pid: 'P3', title: 'Triple' }];

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

function describeLog(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    if (value instanceof ObjectId) return value.toHexString();
    if (value && typeof value === 'object') {
        return JSON.stringify(value, (_key, item) => {
            if (item instanceof ObjectId) return item.toHexString();
            if (item instanceof Date) return item.toISOString();
            return item;
        });
    }
    return String(value);
}

function loggedText(): string {
    return infoCalls.map((args) => args.map((arg) => describeLog(arg)).join(' ')).join('\n');
}

function scoreAt(payload: unknown, pid: number): unknown {
    if (!payload || typeof payload !== 'object') return undefined;
    const score = (payload as { score?: unknown }).score;
    if (!score || typeof score !== 'object') return undefined;
    return (score as Record<string, unknown>)[String(pid)];
}

function idsOf(value: readonly number[] | undefined): number[] {
    return value ? [...value] : [];
}

function at(offset: number): Date {
    return new Date(Date.now() + offset);
}

function timedDoc(rule: string, duration: number | undefined, beginOffset: number, endOffset: number): TimedDoc {
    return {
        rule,
        duration,
        beginAt: at(beginOffset),
        endAt: at(endOffset),
    };
}

/** Pre-change isOngoing. Personal-limit homework is the only intended difference. */
function legacyOngoing(tdoc: TimedDoc, tsdoc?: StatusDoc | null): boolean {
    const now = new Date();
    if (tsdoc && tdoc.duration && tsdoc.startAt <= new Date(Date.now() - Math.floor(tdoc.duration * hour))) return false;
    return tdoc.beginAt <= now && now < tdoc.endAt;
}

function openHomework(extra: Partial<HomeworkDoc> = {}): HomeworkDoc {
    const now = Date.now();
    return {
        domainId: DOMAIN,
        docId: homeworkId,
        owner: 99,
        rule: 'homework',
        title: '作业',
        content: '',
        pids: [3],
        assign: [],
        beginAt: new Date(now - hour),
        endAt: new Date(now + 4 * hour),
        penaltySince: new Date(now + 4 * hour),
        duration: 1.5,
        participantScopeMode: 'groups',
        participantGroupIds: [HOMEWORK_GROUP],
        ...extra,
    };
}

function clearWrites(): void {
    adds.length = 0;
    edits.length = 0;
    kindCalls.length = 0;
    callTrace.length = 0;
    setCalls.length = 0;
    attendCalls.length = 0;
    recalcIds.length = 0;
    infoCalls.length = 0;
    permChecks.length = 0;
    backCalls.length = 0;
}

class HomeworkLogger {
    info(...args: unknown[]) {
        infoCalls.push(args);
    }

    error() {
        return undefined;
    }

    warn() {
        return undefined;
    }
}

function noopDecorator() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}

async function assertContainerProblemKinds(
    domainId: string,
    type: string,
    next: readonly number[],
    previous?: readonly number[],
) {
    kindCalls.push({
        domainId,
        type,
        next: [...next],
        previous: idsOf(previous),
    });
    callTrace.push('kind');
}

const kindGuardStub = {
    __esModule: true as const,
    assertContainerProblemKinds,
    default: undefined as unknown,
};
kindGuardStub.default = kindGuardStub;

const contestStub = {
    async get(domainId: string) {
        attendCalls.push(`get:${domainId}`);
        return currentHomework;
    },
    async getStatus(domainId: string) {
        attendCalls.push(`status:${domainId}`);
        return status;
    },
    async add(...args: unknown[]) {
        adds.push(args);
        return homeworkId;
    },
    async edit(...args: unknown[]) {
        edits.push(args);
        return undefined;
    },
    async del() {
        return undefined;
    },
    async attend(domainId: string, tid: unknown, uid: number) {
        attendCalls.push(`${domainId}:${String(tid)}:${uid}`);
        status.attend = 1;
    },
    async setStatus(domainId: string, tid: unknown, uid: number, update: { startAt?: Date | null }) {
        const startAt = update.startAt instanceof Date ? update.startAt : null;
        setCalls.push({ domainId, tid, uid, startAt });
        if (update.startAt instanceof Date) status.startAt = update.startAt;
    },
    async recalcStatus(domainId: string, id: unknown) {
        recalcIds.push(`${domainId}:${String(id)}`);
    },
    isOngoing(tdoc: TimedDoc, tsdoc?: StatusDoc | null) {
        return contestClock.isOngoing(tdoc, tsdoc);
    },
    isNotStarted(tdoc: TimedDoc) {
        return contestClock.isNotStarted(tdoc);
    },
    isDone(tdoc: TimedDoc, tsdoc?: StatusDoc | null) {
        return contestClock.isDone(tdoc, tsdoc);
    },
    canShowSelfRecord() {
        return true;
    },
    isExtended() {
        return false;
    },
};

const problemAccessStub = {
    async assertProblemBankSelection() {
        callTrace.push('bank');
    },
    async readContextViewableProblems() {
        return visibleProblems.map((row) => ({ ...row }));
    },
};

function cursor() {
    const value = {
        project() {
            return value;
        },
        sort() {
            return value;
        },
        async toArray() {
            return [];
        },
    };
    return value;
}

const defaultModel = new Proxy({}, { get: () => async () => undefined });

function contestLoadStub(request: string): unknown {
    if (request === '../context') return { Context: class ContextStub {}, Service: class ServiceStub {} };
    if (request === '../error') return new Proxy({}, { get: () => class extends Error {} });
    if (request === '../lib/avatar') return { __esModule: true, default: () => '' };
    if (request === '../service/bus') return { __esModule: true, default: defaultModel, parallelAllSettled: async () => undefined };
    if (request === '../service/db') {
        return {
            __esModule: true,
            default: {
                collection: () => new Proxy({}, { get: () => async () => undefined }),
            },
        };
    }
    if (request === './builtin') {
        return {
            PERM: {},
            PRIV: {},
            STATUS: { STATUS_ACCEPTED: 1, STATUS_WRONG_ANSWER: 2, STATUS_COMPILE_ERROR: 7 },
            STATUS_SHORT_TEXTS: {},
        };
    }
    if (request === './contest-participation') {
        return {
            getParticipationMode: (tdoc: { participationMode?: string }) => (tdoc?.participationMode === 'team' ? 'team' : 'individual'),
            isTeamBatchFinalizationPending: () => false,
            normalizeParticipationConfig: (tdoc: unknown) => tdoc,
            planParticipationModeTransition: () => ({}),
            teamModeClearConfirmation: () => '',
        };
    }
    if (request === './contest-team-status') return defaultModel;
    if (request === './document') return { TYPE_CONTEST: 30 };
    if (request === './message' || request === './record') return { __esModule: true, default: defaultModel };
    if (request === './problem') {
        const problemStub = { getMultiStatus: () => ({ toArray: async () => [] }), getList: async () => ({}) };
        return { __esModule: true, default: problemStub, ProblemModel: problemStub };
    }
    if (request === './user') {
        return {
            __esModule: true,
            default: { async getListForRender() { return {}; } },
            User: class UserStub {},
        };
    }
    if (request === './oplog') return defaultModel;
    if (request === './contest-team') return {};
    if (request === './contest-team-gate') {
        return { withContestTeamBoundary: async (_domainId: string, _tid: unknown, work: () => unknown) => work() };
    }
    return null;
}

function homeworkLoadStub(request: string): unknown {
    if (request === '@hydrooj/utils/lib/utils') return { sortFiles: (files: unknown[]) => files, Time };
    if (request === '@hydrooj/utils') return { Logger: HomeworkLogger };
    if (request === '../model/contest') return contestStub;
    if (request === '../model/discussion') return { getMulti: () => cursor() };
    if (request === '../model/problem') {
        return {
            PROJECTION_CONTEST_LIST: ['docId', 'title'],
            assertProblemAclDomain() {
                return undefined;
            },
            async getList() {
                return {};
            },
        };
    }
    if (request === '../model/problem-access') return problemAccessStub;
    if (request === '../model/record') return { async getList() { return {}; } };
    if (request === '../model/storage') return {};
    if (request === '../model/system') return { get: () => 1024 };
    if (request === '../model/training') {
        return {
            async get() {
                return null;
            },
            async attachContestToCourseChapter() {
                return true;
            },
        };
    }
    if (request === '../model/user') {
        return {
            async getList() {
                return {};
            },
            async listGroup() {
                return [];
            },
        };
    }
    if (request === '../lib/course-access') {
        return {
            canManageCourse(user: TestUser, doc: { owner?: number }, _perm: unknown) {
                return user.own(doc) || user.hasPriv(0);
            },
            async assertCourseAccessible() {
                return undefined;
            },
        };
    }
    if (request === '../service/server') {
        return {
            Handler: class HandlerStub {},
            param: noopDecorator,
            post: noopDecorator,
            Types: new Proxy({}, { get: () => () => ({}) }),
        };
    }
    if (request === './contest') {
        return {
            ContestCodeHandler: class ContestCodeHandler {},
            ContestFileDownloadHandler: class ContestFileDownloadHandler {},
            ContestScoreboardHandler: class ContestScoreboardHandler {},
        };
    }
    return null;
}

const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule | null | undefined, isMain: boolean) {
    // Kept for the whole file so a dynamic require of the kind guard still hits the stub.
    if (request.includes('container-problem-kinds')) return kindGuardStub;
    if (parent?.filename === contestPath) {
        const stub = contestLoadStub(request);
        if (stub) return stub;
    }
    if (parent?.filename === homeworkPath) {
        const stub = homeworkLoadStub(request);
        if (stub) return stub;
    }
    return originalLoad.call(this, request, parent, isMain);
};

let contestClock: ContestClock;
delete require.cache[contestPath];
contestClock = require(contestPath) as ContestClock;

interface HomeworkModule {
    apply: (ctx: {
        Route: (name: string, path: string, HandlerClass: new () => HandlerBase) => void;
        inject: (deps: string[], callback: (ctx: { Route: () => void }) => unknown) => unknown;
    }) => Promise<void>;
}

delete require.cache[homeworkPath];
const homeworkModule = require(homeworkPath) as HomeworkModule;
const routes: Record<string, new () => HandlerBase> = {};
void homeworkModule.apply({
    Route(name, _path, HandlerClass) {
        routes[name] = HandlerClass;
    },
    async inject(_deps, callback) {
        return callback({
            Route() {
                return undefined;
            },
        });
    },
});

function makeUser(student: boolean): TestUser {
    return {
        _id: UID,
        group: [],
        timeZone: 'UTC',
        hasPerm: () => !student,
        hasPriv: () => false,
        own: () => !student,
    };
}

function bindHandler(handler: HandlerBase, student: boolean): HandlerBase {
    handler.domain = { _id: DOMAIN };
    handler.user = makeUser(student);
    handler.response = { body: {} };
    handler.request = { ip: '127.0.0.1' };
    handler.paginate = async () => [[], 1, 0];
    handler.url = () => '/target';
    handler.back = () => {
        backCalls.push('back');
    };
    handler.checkPerm = (perm: bigint) => {
        permChecks.push(perm);
        if (perm === PERM.PERM_ATTEND_HOMEWORK && !allowAttend) {
            const error = new Error('permission');
            error.name = 'PermissionError';
            throw error;
        }
    };
    return handler;
}

function makeEditor(): HandlerBase {
    const HomeworkEditHandler = routes.homework_edit;
    return bindHandler(new HomeworkEditHandler(), false);
}

function makeDetail(): HandlerBase {
    const HomeworkDetailHandler = routes.homework_detail;
    return bindHandler(new HomeworkDetailHandler(), true);
}

function saveArgs(input: SaveInput): unknown[] {
    return [
        'forged-domain',
        input.tid,
        input.beginAtDate ?? '2026-07-13',
        input.beginAtTime ?? '00:00',
        input.penaltySinceDate ?? '2026-07-13',
        input.penaltySinceTime ?? '02:00',
        input.extensionDays ?? 0,
        { 1: 0.9 },
        '作业',
        input.content,
        input.pids ?? '',
        false,
        [],
        [],
        [],
        'none',
        [],
        undefined,
        0,
        input.contestDuration,
        input.problemScores,
    ];
}

async function trySave(input: SaveInput): Promise<ErrorView> {
    const handler = makeEditor();
    try {
        await handler.postUpdate(...saveArgs(input));
        return { name: '', field: '', text: '' };
    } catch (error) {
        return errorView(error);
    }
}

async function readDetail(): Promise<Record<string, unknown>> {
    const handler = makeDetail();
    await handler.prepare('forged-domain', homeworkId);
    await handler.get('forged-domain', homeworkId, 1);
    return handler.response.body;
}

async function tryStart(): Promise<ErrorView> {
    const handler = makeDetail();
    await handler.prepare('forged-domain', homeworkId);
    expect(typeof handler.postStart, 'HomeworkDetailHandler.postStart').to.equal('function');
    try {
        await handler.postStart();
        return { name: '', field: '', text: '' };
    } catch (error) {
        return errorView(error);
    }
}

beforeEach(() => {
    clearWrites();
    allowAttend = true;
    visibleProblems = [{ docId: 3, pid: 'P3', title: 'Triple' }];
    currentHomework = openHomework();
    status = { attend: 1, journal: [] };
});

describe('homework personal limit', { concurrency: false }, () => {
    it('closes an unstarted personal homework and keeps every other ongoing case', () => {
        const unstarted = timedDoc('homework', 1, -hour, 3 * hour);
        const started = timedDoc('homework', 1, -hour, 3 * hour);
        const acm = timedDoc('acm', 1, -hour, 3 * hour);
        expect([
            typeof contestClock.homeworkStartRequired,
            contestClock.isOngoing(unstarted, { attend: 1 }),
            contestClock.isOngoing(started, { attend: 1, startAt: new Date() }),
            contestClock.isOngoing(acm, { attend: 1 }),
            contestClock.isOngoing(unstarted),
        ]).to.deep.equal(['function', false, true, true, true]);
        const required = contestClock.homeworkStartRequired;
        expect(required(unstarted, { attend: 1 })).to.equal(true);
        expect(required(unstarted, { attend: 1, startAt: null })).to.equal(true);
        expect(required(unstarted, { attend: 1, startAt: new Date() })).to.equal(false);
        expect(required(unstarted)).to.equal(true);
        expect(required(timedDoc('homework', 0, -hour, hour), { attend: 1 })).to.equal(false);
        expect(required(timedDoc('homework', undefined, -hour, hour), { attend: 1 })).to.equal(false);
        expect(required(timedDoc('acm', 1, -hour, hour), { attend: 1 })).to.equal(false);
    });

    it('keeps acm duration and started homework on the previous ongoing rules', () => {
        const samples: Array<{ tdoc: TimedDoc; tsdoc?: StatusDoc }> = [
            { tdoc: timedDoc('acm', 1, -hour, 2 * hour) },
            { tdoc: timedDoc('acm', 1, -hour, 2 * hour), tsdoc: { attend: 1 } },
            { tdoc: timedDoc('acm', 1, -hour, 2 * hour), tsdoc: { attend: 1, startAt: new Date() } },
            { tdoc: timedDoc('acm', 1, -hour, 2 * hour), tsdoc: { attend: 1, startAt: at(-2 * hour) } },
            { tdoc: timedDoc('acm', 1, -hour, 2 * hour), tsdoc: { attend: 1, startAt: null } },
            { tdoc: timedDoc('homework', 1, -hour, 2 * hour) },
            { tdoc: timedDoc('homework', undefined, -hour, 2 * hour), tsdoc: { attend: 1 } },
            { tdoc: timedDoc('homework', 1, -hour, 2 * hour), tsdoc: { attend: 1, startAt: new Date() } },
            { tdoc: timedDoc('homework', 1, -hour, 2 * hour), tsdoc: { attend: 1, startAt: null } },
            { tdoc: timedDoc('homework', 1, -3 * hour, -hour), tsdoc: { attend: 1, startAt: new Date() } },
            { tdoc: timedDoc('homework', 1, -hour, 2 * hour), tsdoc: { attend: 1, startAt: at(-2 * hour) } },
        ];
        expect(samples.map((sample) => contestClock.isOngoing(sample.tdoc, sample.tsdoc))).to.deep.equal(
            samples.map((sample) => legacyOngoing(sample.tdoc, sample.tsdoc)),
        );
    });

    it('rejects a personal limit that is also an extension', async () => {
        const view = await trySave({
            extensionDays: 1,
            contestDuration: 1.5,
            content: '说明',
            pids: '3,4',
            penaltySinceDate: '2026-07-20',
            penaltySinceTime: '23:59',
        });
        expect([view.name, view.field, view.text, adds.length, edits.length]).to.deep.equal([
            'ValidationError',
            'contestDuration',
            EXTENSION_MESSAGE,
            0,
            0,
        ]);
    });

    it('rejects a personal limit that is outside the open window', async () => {
        for (const contestDuration of [0, -1, 3]) {
            clearWrites();
            const view = await trySave({ contestDuration, extensionDays: 0, content: '说明', pids: '' });
            expect([contestDuration, view.field, view.text, adds.length]).to.deep.equal([
                contestDuration,
                'contestDuration',
                RANGE_MESSAGE,
                0,
            ]);
        }
    });

    it('stores a personal limit equal to the open window', async () => {
        const view = await trySave({ contestDuration: 2, extensionDays: 0, content: '说明', pids: '' });
        const extra = adds[0]?.[9] as { duration?: unknown } | undefined;
        expect([view.text, adds[0]?.[0], adds[0]?.[2], adds[0]?.[7], extra?.duration]).to.deep.equal([
            '',
            DOMAIN,
            '说明',
            [],
            2,
        ]);
    });

    it('creates an empty homework when content is omitted', async () => {
        const view = await trySave({ content: undefined, pids: '', extensionDays: 0 });
        const extra = adds[0]?.[9] as { duration?: unknown } | undefined;
        expect([view.text, adds[0]?.[2], adds[0]?.[7], extra?.duration]).to.deep.equal(['', '', [], null]);
    });

    it('writes scores for the selected problems and rejects a score outside them', async () => {
        const saved = await trySave({
            content: '说明',
            pids: '3,4',
            extensionDays: 0,
            problemScores: '{"3":5}',
        });
        expect([saved.text, scoreAt(adds[0]?.[9], 3)]).to.deep.equal(['', 5]);
        clearWrites();
        const rejected = await trySave({
            content: '说明',
            pids: '3,4',
            extensionDays: 0,
            problemScores: '{"9":5}',
        });
        expect([rejected.field, rejected.text, adds.length, edits.length]).to.deep.equal([
            'problemScores',
            SCORE_MESSAGE,
            0,
            0,
        ]);
    });

    it('rejects problem scores that cannot be parsed', async () => {
        for (const problemScores of ['{', '{"3":0}', '{"3":1.5}']) {
            clearWrites();
            const view = await trySave({
                content: '说明',
                pids: '3,4',
                extensionDays: 0,
                problemScores,
            });
            expect([problemScores, view.field, view.text, adds.length]).to.deep.equal([
                problemScores,
                'problemScores',
                SCORE_MESSAGE,
                0,
            ]);
        }
    });

    it('recalculates status when edited scores change', async () => {
        currentHomework = openHomework({
            owner: UID,
            pids: [3, 4],
            beginAt: new Date('2026-07-13T00:00:00.000Z'),
            endAt: new Date('2026-07-13T02:00:00.000Z'),
            penaltySince: new Date('2026-07-13T02:00:00.000Z'),
            duration: undefined,
        });
        (currentHomework as HomeworkDoc & { score?: Record<string, number> }).score = { 3: 100, 4: 100 };
        const view = await trySave({
            tid: homeworkId,
            content: '说明',
            pids: '3,4',
            extensionDays: 0,
            problemScores: '{"3":5}',
        });
        expect([
            view.text,
            edits[0]?.[0],
            scoreAt(edits[0]?.[2], 3),
            recalcIds.length > 0,
        ]).to.deep.equal(['', DOMAIN, 5, true]);
    });

    it('checks homework problem kinds after bank selection', async () => {
        const created = await trySave({ content: '说明', pids: '3,4', extensionDays: 0 });
        const createdTrace = [...callTrace];
        const createdKind = kindCalls[0];
        expect(created.text).to.equal('');
        expect(createdTrace).to.deep.equal(['bank', 'kind']);
        expect(createdKind).to.deep.equal({
            domainId: DOMAIN,
            type: 'homework',
            next: [3, 4],
            previous: [],
        });
        clearWrites();
        currentHomework = openHomework({
            owner: UID,
            pids: [3],
            beginAt: new Date('2026-07-13T00:00:00.000Z'),
            endAt: new Date('2026-07-13T02:00:00.000Z'),
            penaltySince: new Date('2026-07-13T02:00:00.000Z'),
        });
        const edited = await trySave({ tid: homeworkId, content: '说明', pids: '3,4', extensionDays: 0 });
        const editedKind = kindCalls[0];
        expect(edited.text).to.equal('');
        expect(editedKind).to.deep.equal({
            domainId: DOMAIN,
            type: 'homework',
            next: [3, 4],
            previous: [3],
        });
    });

    it('hides problems until a student starts a personal homework', async () => {
        const body = await readDetail();
        expect([body.homeworkStart, setCalls.length, body.pdict, body.psdict, body.rdict]).to.deep.equal([
            { required: true, durationMinutes: 90, startAt: null, personalEndAt: null },
            0,
            {},
            {},
            {},
        ]);
    });

    it('reports the earlier of the personal limit and the close time', async () => {
        const now = Date.now();
        const startAt = new Date(now - 30 * 60 * 1000);
        const endAt = new Date(now + 10 * 60 * 1000);
        currentHomework = openHomework({
            duration: 2,
            beginAt: new Date(now - 2 * hour),
            endAt,
            penaltySince: endAt,
        });
        status = { attend: 1, startAt, journal: [] };
        const body = await readDetail();
        const pdict = body.pdict as Record<string, { docId?: number }> | undefined;
        expect(body.homeworkStart).to.deep.equal({
            required: false,
            durationMinutes: 120,
            startAt: startAt.toISOString(),
            personalEndAt: endAt.toISOString(),
        });
        expect(pdict?.[3]?.docId).to.equal(3);
        expect(setCalls.length).to.equal(0);
    });

    it('still writes startAt on get when the homework has no personal limit', async () => {
        currentHomework = openHomework({ duration: undefined });
        const body = await readDetail();
        const started = setCalls[0]?.startAt;
        expect(body.homeworkStart).to.deep.equal({
            required: false,
            durationMinutes: null,
            startAt: started instanceof Date ? started.toISOString() : null,
            personalEndAt: null,
        });
        expect(setCalls.length).to.equal(1);
        expect(started instanceof Date).to.equal(true);
        expect(setCalls[0]?.domainId).to.equal(DOMAIN);
    });

    it('starts a personal attempt once and leaves the clock on the next start', async () => {
        const first = await tryStart();
        const started = setCalls[0]?.startAt;
        expect(first.text).to.equal('');
        expect(setCalls.length).to.equal(1);
        expect(started instanceof Date).to.equal(true);
        expect(setCalls[0]?.domainId).to.equal(DOMAIN);
        expect(setCalls[0]?.uid).to.equal(UID);
        expect(String(setCalls[0]?.tid)).to.equal(homeworkId.toHexString());
        expect(attendCalls.some((call) => call.startsWith(`${DOMAIN}:`))).to.equal(false);
        expect(backCalls.length).to.equal(1);
        expect(loggedText().includes(DOMAIN)).to.equal(true);
        expect(loggedText().includes(String(UID))).to.equal(true);
        expect(loggedText().includes(homeworkId.toHexString())).to.equal(true);
        const handler = makeDetail();
        await handler.prepare('forged-domain', homeworkId);
        await handler.get('forged-domain', homeworkId, 1);
        const personalEnd = new Date(Math.min((started as Date).getTime() + 1.5 * hour, currentHomework.endAt.getTime()));
        expect(handler.response.body.homeworkStart).to.deep.equal({
            required: false,
            durationMinutes: 90,
            startAt: (started as Date).toISOString(),
            personalEndAt: personalEnd.toISOString(),
        });
        const pdict = handler.response.body.pdict as Record<string, { docId?: number }>;
        expect(pdict[3]?.docId).to.equal(3);
        const again = await tryStart();
        expect(again.text).to.equal('');
        expect(setCalls.length).to.equal(1);
        expect(status.startAt instanceof Date && status.startAt.getTime() === (started as Date).getTime()).to.equal(true);
    });

    it('rejects start when the homework is not open or has no personal limit', async () => {
        currentHomework = openHomework({ beginAt: at(hour), endAt: at(2 * hour) });
        const notStarted = await tryStart();
        expect([notStarted.name, setCalls.length]).to.deep.equal(['HomeworkNotLiveError', 0]);

        clearWrites();
        currentHomework = openHomework({ beginAt: at(-2 * hour), endAt: at(-hour) });
        const ended = await tryStart();
        expect([ended.name, setCalls.length]).to.deep.equal(['HomeworkNotLiveError', 0]);

        for (const duration of [undefined, 0]) {
            clearWrites();
            currentHomework = openHomework({ duration });
            const view = await tryStart();
            expect([duration ?? null, view.field, view.text, setCalls.length, attendCalls.some((call) => call.includes(`:${UID}`))]).to.deep.equal([
                duration ?? null,
                'operation',
                START_MESSAGE,
                0,
                false,
            ]);
        }
    });

    it('attends before starting when the student has not attended', async () => {
        status = { journal: [] };
        const view = await tryStart();
        expect(view.text).to.equal('');
        expect(attendCalls.includes(`${DOMAIN}:${homeworkId.toHexString()}:${UID}`)).to.equal(true);
        expect(setCalls.length).to.equal(1);
        const attendAt = attendCalls.indexOf(`${DOMAIN}:${homeworkId.toHexString()}:${UID}`);
        expect(attendAt >= 0).to.equal(true);
    });

    it('requires attend permission before starting', async () => {
        allowAttend = false;
        const view = await tryStart();
        expect([view.name, permChecks, setCalls.length, attendCalls.some((call) => call.includes(`:${UID}`))]).to.deep.equal([
            'PermissionError',
            [PERM.PERM_ATTEND_HOMEWORK],
            0,
            false,
        ]);
    });

    it('does not close the window for a non-positive personal limit', () => {
        const required = contestClock.homeworkStartRequired;
        for (const duration of [-1, Number.NaN]) {
            const doc = timedDoc('homework', duration, -hour, hour);
            expect(required(doc, { attend: 1 }), `required ${duration}`).to.equal(false);
            expect(contestClock.isOngoing(doc, { attend: 1 }), `ongoing ${duration}`).to.equal(true);
        }
    });

    it('stores a fractional personal limit unchanged', async () => {
        const view = await trySave({ contestDuration: 1.5, extensionDays: 0, content: '说明', pids: '' });
        const extra = adds[0]?.[9] as { duration?: unknown } | undefined;
        expect([view.text, extra?.duration]).to.deep.equal(['', 1.5]);
    });

    it('writes the personal limit when an existing homework is saved', async () => {
        currentHomework = openHomework({
            owner: UID,
            pids: [3],
            beginAt: new Date('2026-07-13T00:00:00.000Z'),
            endAt: new Date('2026-07-13T02:00:00.000Z'),
            penaltySince: new Date('2026-07-13T02:00:00.000Z'),
            duration: 2,
        });
        const view = await trySave({
            tid: homeworkId,
            content: '说明',
            pids: '3',
            extensionDays: 0,
            contestDuration: 1.5,
        });
        const payload = edits[0]?.[2] as { duration?: unknown } | undefined;
        expect([view.text, edits[0]?.[0], payload?.duration]).to.deep.equal(['', DOMAIN, 1.5]);
    });

    it('rejects start when the stored limit is not a positive number', async () => {
        currentHomework = openHomework({ duration: Number.NaN });
        const view = await tryStart();
        expect([view.field, view.text, setCalls.length]).to.deep.equal(['operation', START_MESSAGE, 0]);
    });

    it('does not ask for a start outside the open window', async () => {
        currentHomework = openHomework({
            beginAt: at(hour),
            endAt: at(2 * hour),
            penaltySince: at(2 * hour),
        });
        const upcoming = await readDetail();
        expect(upcoming.homeworkStart).to.deep.equal({
            required: false,
            durationMinutes: 90,
            startAt: null,
            personalEndAt: null,
        });

        clearWrites();
        const endAt = at(-hour);
        currentHomework = openHomework({
            beginAt: at(-2 * hour),
            endAt,
            penaltySince: endAt,
        });
        const ended = await readDetail();
        const pdict = ended.pdict as Record<string, { docId?: number }> | undefined;
        expect(ended.homeworkStart).to.deep.equal({
            required: false,
            durationMinutes: 90,
            startAt: null,
            personalEndAt: null,
        });
        expect(pdict?.[3]?.docId).to.equal(3);
        expect(setCalls.length).to.equal(0);
    });

    it('still writes startAt on get when the personal limit is zero', async () => {
        currentHomework = openHomework({ duration: 0 });
        const body = await readDetail();
        const started = setCalls[0]?.startAt;
        expect(body.homeworkStart).to.deep.equal({
            required: false,
            durationMinutes: null,
            startAt: started instanceof Date ? started.toISOString() : null,
            personalEndAt: null,
        });
        expect(setCalls.length).to.equal(1);
    });
});
