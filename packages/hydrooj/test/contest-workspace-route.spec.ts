import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { createDraftConfig, SET_EXPERIENCE_DEFAULTS, type OfficialAnswer, type SetConfig } from '@hydrooj/common';
import { requirePublishedForStudent, storedSetConfigOrNull } from '../src/lib/set-publication';
import type { RoundDoc } from '../src/model/set-round';

const hydroHost = globalThis as unknown as {
    Hydro?: { model?: Record<string, unknown> };
};
if (!hydroHost.Hydro) hydroHost.Hydro = { model: {} };
if (!hydroHost.Hydro.model) hydroHost.Hydro.model = {};

const requireFromTest = createRequire(__filename);
const { PERM, PRIV } = requireFromTest('../src/model/builtin') as typeof import('../src/model/builtin');
const setting = requireFromTest('../src/model/setting') as typeof import('../src/model/setting');
const { parseProblemConfigObject, questionKindMap } = requireFromTest('../src/lib/problem-config') as typeof import('../src/lib/problem-config');
const Module = requireFromTest('node:module') as {
    _load: (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
};

const DOMAIN = 'system';
const CLIENT_UID = 62;
const PROBLEM_PID = 11;
const CLIENT_TID_HEX = '64b00000000000000000a5c1';
const HOUR = 60 * 60 * 1000;
const SECRET_ANSWER = 'secret-answer';

interface Actor {
    _id: number;
    uname: string;
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

interface HandlerRequest {
    json: boolean;
    ip: string;
    method: string;
    body?: Record<string, unknown>;
    params?: Record<string, string>;
}

interface StatusDoc {
    attend?: number;
    startAt?: Date | null;
    clientFinishedAt?: Date;
    paperFinalizedAt?: Date;
    journal?: Array<{ pid: number; status: number; score: number }>;
}

interface ContestDoc {
    _id: ObjectId;
    docId: ObjectId;
    domainId: string;
    owner: number;
    maintainer: number[];
    title: string;
    content: string;
    rule: string;
    pids: number[];
    score?: Record<number, number>;
    beginAt: Date;
    endAt: Date;
    duration: number;
    assign: string[];
    allowPrint: boolean;
    allowSubmitByKind: boolean;
    privateFiles: unknown[];
    entryMode?: string;
    participationMode?: string;
    keepScoreboardHidden?: boolean;
    allowPostContestView?: boolean;
    setConfig?: SetConfig;
    _code?: string;
}

interface ProblemDoc {
    domainId: string;
    docId: number;
    pid: number;
    owner: number;
    title: string;
    content: string;
    config: { type: string; answers?: Record<string, unknown>; subtasks?: Array<{ score: number; cases: Array<{ input: string; output: string }> }> };
    additional_file: Array<{ name: string }>;
    hidden?: boolean;
    problemKind?: string;
}

interface UrlArgs {
    query?: Record<string, unknown>;
    [key: string]: unknown;
}

type UrlFn = (name: string, ...kwargsList: UrlArgs[]) => string;

interface WorkspaceView {
    mode?: string;
    phase?: string;
    numbering?: string;
    description?: string;
    locked?: { reason: string } | null;
    paper?: { submitByKind?: boolean } | null;
    action?: { canAttend?: boolean; canStart?: boolean; canSubmit?: boolean; invitationRequired?: boolean };
    urls?: Record<string, string | null>;
    groups?: Array<{ scoreEach?: number | null; items?: Array<{ pid?: number; title?: string; label?: string; score?: number; lastScore?: number | null }> }>;
    kind?: string;
    clarifications?: Array<{ subject?: string }>;
    officialRound?: { id: string; roundNo: number } | null;
    totals?: { score?: number | null; maxScore?: number | null };
}

interface DetailHandler {
    domain: { _id: string };
    user: Actor;
    response: ResponseBag;
    request: HandlerRequest;
    session?: { sessionId?: string };
    tdoc: ContestDoc;
    tsdoc: StatusDoc | null;
    url: UrlFn;
    __prepare: (domainId: string, tid: ObjectId) => Promise<void>;
    get: (domainId: string, tid: ObjectId) => Promise<void>;
}

interface PaperHandler {
    domain: { _id: string };
    user: Actor;
    response: ResponseBag;
    request: HandlerRequest;
    session?: { sessionId?: string };
    tdoc: ContestDoc;
    tsdoc: StatusDoc | null;
    tid: ObjectId;
    examPaperAdminPreview: boolean;
    examPaperAllowPool: boolean;
    url: UrlFn;
    _prepare: (domainId: string, tid: ObjectId) => Promise<void>;
    get: (args: { domainId: string }) => Promise<void>;
    post: (args: { domainId: string }, pid: number) => Promise<void>;
}

interface ExamModeHandler {
    domain: { _id: string };
    user: Actor;
    response: ResponseBag;
    request: HandlerRequest;
    session?: { sessionId?: string };
    url: UrlFn;
    get: (domainId: string, tid: ObjectId) => Promise<void>;
}

interface ContestModule {
    ContestDetailHandler: new () => DetailHandler;
    ContestProblemListHandler: new () => DetailHandler;
}

interface RouteCtx {
    Route: (name: string, path: string, HandlerClass: new () => object, perm?: bigint) => void;
    Connection: (name: string, path: string, HandlerClass: new () => object, priv?: number) => void;
    inject: (deps: string[], callback: (ctx: { Route: RouteCtx['Route'] }) => void) => void;
}

interface PaperModule {
    apply: (ctx: RouteCtx) => Promise<void>;
    projectAndAbsolutizeStudentPdict?: unknown;
}

interface ClientSession {
    contestId: ObjectId;
    domainId: string;
    uid: number;
}

interface Cursor {
    sort: () => Cursor;
    limit: () => Cursor;
    project: () => Cursor;
    toArray: () => Promise<unknown[]>;
}

const problemDocs = new Map<number, ProblemDoc>();
let currentDoc: ContestDoc | null = null;
let currentStatus: StatusDoc | null = null;
let clientSession: ClientSession | null = null;
let clarificationDocs: unknown[] = [];
let attendCalls = 0;
let problemGets = 0;
let draftReads = 0;
let storedRounds: RoundDoc[] = [];
let storedAnswers: OfficialAnswer[] = [];
let storedRecords: Array<{ pid: number; status: number }> = [];
let savedCode: { _id: ObjectId; setAutoSaveHash: string } | null = null;
let codeInserts = 0;

const contestPath = requireFromTest.resolve('../src/handler/contest.ts');
const paperPath = requireFromTest.resolve('../src/handler/paper.ts');
const visibilityPath = requireFromTest.resolve('../src/lib/container-visibility.ts');
const setProblemAccessPath = requireFromTest.resolve('../src/lib/set-problem-access.ts');
const isolatedHelpers = new Set([
    '../src/lib/set-student-state.ts',
    '../src/lib/set-publish-facts.ts',
    '../src/lib/set-participation-access.ts',
    '../src/lib/teach-access.ts',
].map((request) => requireFromTest.resolve(request)));

function at(offset: number): Date {
    return new Date(Date.now() + offset);
}

function bitsOf(perms: readonly bigint[]): bigint {
    let bits = 0n;
    for (const perm of perms) bits |= perm;
    return bits;
}

function makeUser(uid: number, perms: readonly bigint[] = []): Actor {
    const permBits = bitsOf(perms);
    return {
        _id: uid,
        uname: `user-${uid}`,
        group: [],
        hasPerm(...wanted) {
            return wanted.some((item) => (permBits & item) === item);
        },
        hasPriv() {
            return false;
        },
        own(doc) {
            return doc.owner === uid || (doc.maintainer ?? []).includes(uid);
        },
    };
}

function makeContest(partial: Pick<ContestDoc, 'docId' | 'rule' | 'beginAt' | 'endAt'> & Partial<ContestDoc>): ContestDoc {
    return {
        _id: partial.docId,
        domainId: DOMAIN,
        owner: 9,
        maintainer: [],
        title: 'Workspace contest',
        content: 'See the contest.',
        pids: [],
        duration: 0,
        assign: [],
        allowPrint: false,
        allowSubmitByKind: false,
        privateFiles: [],
        ...partial,
    };
}

function statementProblem(): ProblemDoc {
    return {
        domainId: DOMAIN,
        docId: PROBLEM_PID,
        pid: PROBLEM_PID,
        owner: 4,
        title: 'Sum',
        content: 'look (file://statement.png)',
        config: { type: 'default', answers: { main: [SECRET_ANSWER, 100] } },
        additional_file: [{ name: 'statement.png' }],
    };
}

function emptyCursor(rows: unknown[] = []): Cursor {
    const cursor: Cursor = {
        sort() {
            return cursor;
        },
        limit() {
            return cursor;
        },
        project() {
            return cursor;
        },
        toArray() {
            return Promise.resolve(rows);
        },
    };
    return cursor;
}

function handlerUrl(name: string, ...kwargsList: UrlArgs[]): string {
    const args: Record<string, string> = {};
    const query: Record<string, string> = {};
    for (const kwargs of kwargsList) {
        for (const key of Object.keys(kwargs)) {
            if (key === 'query') continue;
            const value = kwargs[key];
            if (value == null) continue;
            args[key] = String(value).replace(/\//g, '%2F');
        }
        const rawQuery = kwargs.query;
        if (!rawQuery || typeof rawQuery !== 'object') continue;
        for (const key of Object.keys(rawQuery)) {
            const value = rawQuery[key];
            if (value == null) continue;
            query[key] = String(value);
        }
    }
    const routes: Record<string, (routeArgs: Record<string, string>) => string> = {
        training_main: () => '/problem-sets',
        paper_layout: (routeArgs) => `/paper/${routeArgs.tid}`,
        contest_detail: (routeArgs) => `/contest/${routeArgs.tid}`,
        exam_mode_entry: (routeArgs) => `/exam-mode/${routeArgs.tid}`,
        homework_detail: (routeArgs) => `/homework/${routeArgs.tid}`,
        problem_submit: (routeArgs) => `/p/${routeArgs.pid}/submit`,
        record_detail: (routeArgs) => `/record/${routeArgs.rid}`,
        record_main: () => '/record',
        contest_scoreboard: (routeArgs) => `/contest/${routeArgs.tid}/scoreboard`,
        exam_mode_ranking: (routeArgs) => `/exam-mode/${routeArgs.tid}/ranking`,
        contest_problemlist: (routeArgs) => `/contest/${routeArgs.tid}/problems`,
        exam_mode_announcements: (routeArgs) => `/exam-mode/${routeArgs.tid}/announcements`,
        exam_mode_print: (routeArgs) => `/exam-mode/${routeArgs.tid}/print`,
        paper_start: (routeArgs) => `/paper/${routeArgs.tid}/start`,
        paper_draft_list: (routeArgs) => `/paper/${routeArgs.tid}/draft`,
        paper_draft_upsert: (routeArgs) => `/paper/${routeArgs.tid}/draft/${routeArgs.pid}`,
        paper_lock_kind: (routeArgs) => `/paper/${routeArgs.tid}/lock-kind`,
        paper_finalize: (routeArgs) => `/paper/${routeArgs.tid}/finalize`,
        paper_submit_code: (routeArgs) => `/paper/${routeArgs.tid}/submit-code/${routeArgs.pid}`,
        set_round_start_contest: (routeArgs) => `/contest/${routeArgs.tid}/round/start`,
        set_round_answers_contest: (routeArgs) => `/contest/${routeArgs.tid}/round/answers`,
        set_round_save_contest: (routeArgs) => `/contest/${routeArgs.tid}/round/save`,
        set_round_hand_in_contest: (routeArgs) => `/contest/${routeArgs.tid}/round/hand-in`,
        set_round_start_paper: (routeArgs) => `/paper/${routeArgs.tid}/round/start`,
        set_round_answers_paper: (routeArgs) => `/paper/${routeArgs.tid}/round/answers`,
        set_round_save_paper: (routeArgs) => `/paper/${routeArgs.tid}/round/save`,
        set_round_hand_in_paper: (routeArgs) => `/paper/${routeArgs.tid}/round/hand-in`,
        contest_virtual: (routeArgs) => `/contest/${routeArgs.tid}/virtual`,
        exam_mode_problem_detail: (routeArgs) => `/exam-mode/${routeArgs.tid}/problem/${routeArgs.pid}`,
        problem_file_download: (routeArgs) => `/p/${routeArgs.pid}/file/${routeArgs.filename}`,
    };
    const build = routes[name];
    let path = build ? build(args) : `/missing/${name}`;
    const keys = Object.keys(query);
    if (keys.length) path += `?${keys.map((key) => `${key}=${query[key]}`).join('&')}`;
    return path;
}

function acmClientUrls(tid: string): Record<string, string | null> {
    return {
        back: null,
        manage: null,
        overview: `/exam-mode/${tid}`,
        problem: null,
        submit: `/p/__PID__/submit?tid=${tid}`,
        submitCode: null,
        recordDetail: `/record/__RID__?tid=${tid}`,
        records: `/record?tid=${tid}&uidOrName=${CLIENT_UID}`,
        ranking: `/exam-mode/${tid}/ranking`,
        clarify: `/exam-mode/${tid}/announcements`,
        print: `/exam-mode/${tid}/print`,
        start: null,
        attend: null,
        draftList: null,
        saveAnswers: null,
        draftUpsert: null,
        submitKind: null,
        lockKind: null,
        finalize: null,
        virtual: null,
        practice: null,
        teamProblem: null,
        verifyObjective: null,
        verifySubmit: null,
        pretest: `/p/__PID__/submit?tid=${tid}`,
    };
}

function paperClientUrls(tid: string, lockKind: boolean): Record<string, string | null> {
    return {
        back: null,
        manage: null,
        overview: `/paper/${tid}`,
        problem: null,
        submit: null,
        submitCode: `/paper/${tid}/submit-code/__PID__`,
        recordDetail: `/record/__RID__?tid=${tid}`,
        records: `/record?tid=${tid}&uidOrName=${CLIENT_UID}`,
        // A running exam inherits OI: the scoreboard stays hidden until endAt.
        ranking: null,
        clarify: `/exam-mode/${tid}/announcements`,
        print: `/exam-mode/${tid}/print`,
        start: `/paper/${tid}/start`,
        attend: null,
        draftList: `/paper/${tid}/draft`,
        saveAnswers: null,
        draftUpsert: `/paper/${tid}/draft/__PID__`,
        submitKind: null,
        lockKind: lockKind ? `/paper/${tid}/lock-kind` : null,
        finalize: `/paper/${tid}/finalize`,
        virtual: null,
        practice: null,
        teamProblem: null,
        verifyObjective: null,
        verifySubmit: null,
        pretest: `/p/__PID__/submit?tid=${tid}`,
    };
}

function isNotStarted(tdoc: ContestDoc): boolean {
    return new Date() < tdoc.beginAt;
}

function isDone(tdoc: ContestDoc, tsdoc?: StatusDoc | null): boolean {
    if (tdoc.endAt <= new Date()) return true;
    if (tsdoc?.startAt && tdoc.duration) {
        return tsdoc.startAt.getTime() <= Date.now() - tdoc.duration * HOUR;
    }
    return false;
}

function canShowScoreboard(tdoc: ContestDoc): boolean {
    const now = new Date();
    const config = storedSetConfigOrNull(tdoc);
    if (config) {
        const mode = config.settings.scoreboard;
        return mode === 'live' ? now >= tdoc.beginAt : mode === 'during_only' ? now >= tdoc.beginAt && now < tdoc.endAt
            : mode === 'after_end' && now >= tdoc.endAt;
    }
    if (tdoc.rule === 'exam' || tdoc.rule === 'oi' || tdoc.rule === 'ioi' || tdoc.rule === 'strictioi' || tdoc.rule === 'ledo') {
        return now > tdoc.endAt && tdoc.keepScoreboardHidden !== true;
    }
    return now > tdoc.beginAt;
}

const contestStub = {
    __esModule: true as const,
    RULES: {
        acm: { hidden: false, TEXT: 'ACM/ICPC' },
        oi: { hidden: false, TEXT: 'OI' },
        ioi: { hidden: false, TEXT: 'IOI' },
        strictioi: { hidden: false, TEXT: 'Strict IOI' },
        ledo: { hidden: false, TEXT: 'Ledo' },
        exam: { hidden: false, TEXT: 'Exam' },
        homework: { hidden: false, TEXT: 'Homework' },
    },
    isNotStarted,
    isDone,
    requirePublishedForStudent,
    usesAcmScoring(tdoc: ContestDoc) {
        return storedSetConfigOrNull(tdoc)?.settings.codePolicy === 'acm' || (!tdoc.setConfig && tdoc.rule === 'acm');
    },
    async studentRecordHitsContestScope() {
        return true;
    },
    isOngoing(tdoc: ContestDoc, tsdoc?: StatusDoc | null) {
        return !isNotStarted(tdoc) && !isDone(tdoc, tsdoc);
    },
    isClientRequired(tdoc: ContestDoc) {
        return tdoc.entryMode === 'client_required';
    },
    isClientFinished(tsdoc: StatusDoc | null | undefined) {
        return !!tsdoc?.clientFinishedAt;
    },
    getParticipationMode(tdoc: { participationMode?: unknown } | null | undefined) {
        return tdoc?.participationMode === 'team' ? 'team' : 'individual';
    },
    canShowScoreboard,
    async canShowScoreboardForUser(tdoc: ContestDoc) {
        return canShowScoreboard(tdoc);
    },
    canShowSelfRecord(tdoc: ContestDoc) {
        return tdoc.rule === 'acm' || canShowScoreboard(tdoc);
    },
    async canShowSelfRecordForUser(tdoc: ContestDoc) {
        return tdoc.rule === 'acm' || canShowScoreboard(tdoc);
    },
    async get() {
        return currentDoc;
    },
    async getStatus() {
        return currentStatus;
    },
    async attend() {
        attendCalls += 1;
        currentStatus = { ...(currentStatus ?? {}), attend: 1 };
    },
    async setStatus(_domainId: string, _tid: ObjectId, _uid: number, patch: StatusDoc) {
        currentStatus = { ...(currentStatus ?? {}), ...patch };
    },
    getMulti() {
        return emptyCursor();
    },
    getMultiStatus() {
        return emptyCursor();
    },
    async getMultiClarification() {
        return clarificationDocs;
    },
    default: undefined as unknown,
};
contestStub.default = contestStub;

const roundStub = {
    participantKey(uid: number, teamId?: ObjectId | null) {
        return teamId ? `t:${teamId.toHexString()}` : `u:${uid}`;
    },
    async settleParticipantRounds(domainId: string, tid: ObjectId, uid: number, teamId?: ObjectId | null) {
        return storedRounds.filter((round) => round.domainId === domainId && round.tid.equals(tid)
            && round.participantKey === roundStub.participantKey(uid, teamId));
    },
    async readParticipantRound(domainId: string, tid: ObjectId, uid: number, teamId?: ObjectId | null, roundId?: ObjectId) {
        const rows = await roundStub.settleParticipantRounds(domainId, tid, uid, teamId);
        return roundId ? rows.find((round) => round._id.equals(roundId)) ?? null
            : rows.find((round) => round.state === 'open') ?? rows[rows.length - 1] ?? null;
    },
    async readParticipantPaper(domainId: string, tid: ObjectId, uid: number, teamId?: ObjectId | null) {
        return (await roundStub.readParticipantRound(domainId, tid, uid, teamId))?.paperPids ?? [];
    },
    async getOfficialAnswers(domainId: string, round: RoundDoc) {
        if (round.domainId !== domainId) throw new Error('fixture round domain mismatch');
        return storedAnswers;
    },
};

const recordStub = {
    getMulti() {
        return emptyCursor(savedCode ? [savedCode] : []);
    },
    async add() {
        codeInserts++;
        return new ObjectId();
    },
    coll: {
        find(query: { setRoundId?: ObjectId }) {
            return emptyCursor(query.setRoundId ? storedRecords : []);
        },
    },
    async getList() { return {}; },
};

const problemStub = {
    __esModule: true as const,
    PROJECTION_CONTEST_LIST: ['docId', 'pid', 'title'],
    PROJECTION_CONTEST_DETAIL: ['docId', 'pid', 'title', 'content', 'config'],
    PROJECTION_PUBLIC: ['docId'],
    async get(_domainId: string, pid: number) {
        problemGets += 1;
        return problemDocs.get(pid) ?? null;
    },
    async getList(_domainId: string, pids: number[], _hidden?: boolean, _doThrow?: boolean, projection?: string[]) {
        const out: Record<number, object> = {};
        for (const pid of pids) {
            const doc = problemDocs.get(pid);
            if (!doc) continue;
            if (projection?.includes('config')) {
                const { parseConfig } = requireFromTest('../src/lib/testdataConfig');
                out[pid] = { ...doc, config: await parseConfig(structuredClone(doc.config), []) };
            } else out[pid] = doc;
        }
        return out;
    },
    async getListViewableAuthorized(_domainId: string, pids: number[]) {
        const out: Record<number, ProblemDoc> = {};
        for (const pid of pids) {
            const doc = problemDocs.get(pid);
            if (doc && doc.hidden !== true) out[pid] = doc;
        }
        return out;
    },
    canPublishProblem() {
        return true;
    },
    default: undefined as unknown,
};
problemStub.default = problemStub;

const userStub = {
    __esModule: true as const,
    async getList() {
        return {};
    },
    async listGroup() {
        return [];
    },
    async getById() {
        return null;
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
        return emptyCursor();
    },
    default: undefined as unknown,
};
documentStub.default = documentStub;

const problemAccessStub = {
    async assertProblemBankSelection() {
        return undefined;
    },
    problemViewReadFace() {
        return 'direct-stable';
    },
};

function studentDirectory() {
    return {
        async findStudentByUserId() {
            return null;
        },
        async findStudentsByUserIds() {
            return {};
        },
        async listUserGroups() {
            return [];
        },
    };
}

function noopDecorator() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}

class HandlerStub {}

const serverStub = {
    Handler: HandlerStub,
    param: noopDecorator,
    post: noopDecorator,
    Type: class TypeStub {},
    Types: new Proxy({}, { get: () => () => ({}) }),
};

const genericModel = new Proxy({}, { get: () => async () => undefined });

function localizedErrorText(strings: TemplateStringsArray, ...values: unknown[]): string {
    return String.raw({ raw: strings }, ...values.map((value) => String(value)));
}

class StubNotFoundError extends Error {
    constructor(message?: unknown) {
        super(typeof message === 'string' ? message : 'NotFoundError');
        this.name = 'NotFoundError';
    }
}

class StubPermissionError extends Error {
    constructor(message?: unknown) {
        super(String(message));
        this.name = 'PermissionError';
    }
}

class StubValidationError extends Error {
    constructor(...args: unknown[]) {
        super(String(args[2] ?? args[0] ?? 'ValidationError'));
        this.name = 'ValidationError';
    }
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
    localizedErrorText,
    NotFoundError: StubNotFoundError,
    PermissionError: StubPermissionError,
    ValidationError: StubValidationError,
    parseProblemConfigObject,
    questionKindMap,
    ProblemModel: problemStub,
    UserModel: {
        async getById() {
            return null;
        },
        async getListForRender() {
            return {};
        },
    },
    PaperDraftModel: {
        async getDraftsForUser() {
            draftReads += 1;
            return [];
        },
        async getDraft() {
            return null;
        },
    },
    OplogModel: {
        async log() {
            return undefined;
        },
    },
    problemFingerprint() {
        return '';
    },
    getProblemConfigErrorText() {
        return null;
    },
    parseStructuredRegionSubmission() {
        return {};
    },
    validateCompiledStructuredConfig() {
        return undefined;
    },
    validateStructuredCodeJudgeConfig() {
        return undefined;
    },
    default: undefined as unknown,
};
paperHydroojStub.default = paperHydroojStub;

const paperServerStub = {
    __esModule: true as const,
    ConnectionHandler: class ConnectionHandlerStub {},
    Handler: HandlerStub,
    param: noopDecorator,
    subscribe: noopDecorator,
    default: undefined as unknown,
};
paperServerStub.default = paperServerStub;

const contestTeamStub = {
    async getTeamByMember() {
        return null;
    },
    buildExamModeTeamContext() {
        return null;
    },
    async countActiveTeams() {
        return 0;
    },
};

class EmptyHandler {}

const paperPassthrough = new Set([
    '../error',
    '../lib/contest-correction',
    '../lib/container-visibility',
    '../lib/contest-problem-status',
    '../lib/student-pdict',
    '../lib/exam-mode-record',
    '../lib/exam-paper',
    'js-yaml',
    'mongodb',
    '@hydrooj/common',
    '@hydrooj/utils',
]);

function contestLoadStub(request: string): unknown {
    if (request === '../model/builtin') return undefined;
    if (request === '../lib/set-basic-edit') return {};
    if (request === '../context') return { Context: class ContextStub {}, Service: class ServiceStub {} };
    if (request === '../lib/course-exam-gate' || request === './course-exam-gate') return { async assertCourseExamWatchGate() { return undefined; } };
    if (request === '../model/contest') return contestStub;
    if (request === '../model/set-round') return roundStub;
    if (request === '../model/record') return recordStub;
    if (request === '../model/system') return { get: () => 128 * 1024 };
    if (request === '../model/problem') return problemStub;
    if (request === '../model/problem-access') return problemAccessStub;
    if (request === '../model/user') return userStub;
    if (request === '../model/document') return documentStub;
    if (request === '../service/server') return serverStub;
    if (request === '../service/student-directory') return { studentDirectory };
    if (request === 'hydrooj') return paperHydroojStub;
    if (request.startsWith('../model/')) return genericModel;
    return undefined;
}

function paperLoadStub(request: string): unknown {
    if (paperPassthrough.has(request)) return undefined;
    if (request === '../model/contest') return contestStub;
    if (request === '../model/set-round') return roundStub;
    if (request === '../model/system') return { get: () => 128 * 1024 };
    if (request === '../model/contest-team') return contestTeamStub;
    if (request === '../model/contest-team-status') return { async get() { return null; } };
    if (request === '../model/contest-team-code') return { async markNotified() { return true; } };
    if (request === '../model/discussion') return {};
    if (request === '../model/document') return documentStub;
    if (request === '../model/manual-grade') return { async markManualPending() { return undefined; } };
    if (request === '../model/record') return recordStub;
    if (request === '../service/server') return paperServerStub;
    if (request === '../service/vigil-bridge') return { async closeSessionOnVigil() { return undefined; } };
    if (request === '../service/student-directory') return { studentDirectory };
    if (request === '../lib/course-exam-gate') return { async assertCourseExamWatchGate() { return undefined; } };
    if (request === 'hydrooj') return paperHydroojStub;
    if (request === './discussion') return { DiscussionDetailHandler: EmptyHandler };
    if (request === './problem') {
        return { ProblemDetailHandler: EmptyHandler, ProblemSubmitHandler: EmptyHandler };
    }
    if (request === './record') return { RecordDetailHandler: EmptyHandler, RecordListHandler: EmptyHandler };
    return undefined;
}

const trainingStub = {
    getMulti() {
        return emptyCursor();
    },
};

const originalLoad = Module._load;
const cacheBefore = new Set(Object.keys(requireFromTest.cache));
Module._load = function load(request: string, parent: NodeModule | null | undefined, isMain: boolean) {
    if (parent?.filename === visibilityPath && request === '../model/training') return trainingStub;
    if (parent?.filename === setProblemAccessPath && request === '../model/set-round') return roundStub;
    if (parent?.filename === setProblemAccessPath && request === '../model/contest-team') return contestTeamStub;
    if (parent?.filename && isolatedHelpers.has(parent.filename)) {
        const stub = contestLoadStub(request);
        if (stub !== undefined) return stub;
    }
    if (parent?.filename === contestPath) {
        const stub = contestLoadStub(request);
        if (stub !== undefined) return stub;
    }
    if (parent?.filename === paperPath) {
        const stub = paperLoadStub(request);
        if (stub !== undefined) return stub;
    }
    return originalLoad.call(this, request, parent, isMain);
};

let contestModule: ContestModule;
let paperModule: PaperModule;
const paperRoutes: Record<string, new () => object> = {};
const paperRoutePaths: Record<string, string> = {};
let paperReady: Promise<void> = Promise.resolve();
try {
    delete requireFromTest.cache[contestPath];
    delete requireFromTest.cache[paperPath];
    contestModule = requireFromTest(contestPath) as ContestModule;
    paperModule = requireFromTest(paperPath) as PaperModule;
    paperReady = paperModule.apply({
        Route(name, path, HandlerClass) {
            paperRoutes[name] = HandlerClass;
            paperRoutePaths[name] = path;
        },
        Connection() {
            return undefined;
        },
        inject(_deps, callback) {
            callback({
                Route(name, path, HandlerClass) {
                    paperRoutes[name] = HandlerClass;
                    paperRoutePaths[name] = path;
                },
            });
        },
    });
} catch (error) {
    Module._load = originalLoad;
    for (const key of Object.keys(requireFromTest.cache)) {
        if (!cacheBefore.has(key)) delete requireFromTest.cache[key];
    }
    throw error;
}

function bindVigil(): void {
    if (!hydroHost.Hydro) hydroHost.Hydro = { model: {} };
    if (!hydroHost.Hydro.model) hydroHost.Hydro.model = {};
    hydroHost.Hydro.model.vigilguard = {
        clientSessionKeyFromSession(session: { sessionId?: string } | null | undefined) {
            return session?.sessionId || '';
        },
        async currentClientSession() {
            return clientSession;
        },
        async effectiveContestAccess(_domainId: string, tdoc: ContestDoc) {
            const bound = clientSession?.contestId.equals(tdoc.docId) === true;
            if (tdoc.entryMode === 'client_required' && !bound) return { ok: false, reason: 'client_only' };
            return { ok: true };
        },
        async isValidClientSessionForContest(key: string, domainId: string, tid: ObjectId, uid: number) {
            return key === 'bound-session' && clientSession?.domainId === domainId
                && clientSession?.contestId.equals(tid) === true && clientSession?.uid === uid;
        },
    };
}

function readWorkspace(body: Record<string, unknown>): WorkspaceView | undefined {
    const workspace = body.workspace;
    if (!workspace || typeof workspace !== 'object') return undefined;
    return workspace as WorkspaceView;
}

function codeLangRange(): Record<string, string> {
    const codeLang = setting.SETTINGS_BY_KEY.codeLang as { range?: Record<string, string> } | undefined;
    const range = codeLang?.range;
    if (!range || typeof range !== 'object') throw new Error('codeLang.range is missing from settings');
    return range;
}

function expectLangRange(body: Record<string, unknown>): void {
    expect(body.langRange, 'langRange').to.deep.equal(codeLangRange());
}

function errorName(error: unknown): string {
    return error instanceof Error ? error.name : String(error);
}

async function settle(work: Promise<void>): Promise<unknown> {
    try {
        await work;
        return undefined;
    } catch (error) {
        return error;
    }
}

function bindContestHandler(
    HandlerClass: new () => DetailHandler,
    user: Actor,
    doc: ContestDoc,
    status: StatusDoc | null,
): DetailHandler {
    currentDoc = doc;
    currentStatus = status;
    const handler = new HandlerClass();
    handler.domain = { _id: DOMAIN };
    handler.user = user;
    handler.response = { body: {} };
    handler.request = { json: false, ip: '127.0.0.1', method: 'get' };
    handler.tdoc = doc;
    handler.tsdoc = status;
    handler.url = handlerUrl;
    return handler;
}

function bindDetail(user: Actor, doc: ContestDoc, status: StatusDoc | null): DetailHandler {
    return bindContestHandler(contestModule.ContestDetailHandler, user, doc, status);
}

function bindPaperRoute(
    routeName: string,
    user: Actor,
    doc: ContestDoc,
    status: StatusDoc | null,
    sessionId?: string,
): PaperHandler {
    currentDoc = doc;
    currentStatus = status;
    const HandlerClass = paperRoutes[routeName] as new () => PaperHandler;
    const handler = new HandlerClass();
    handler.domain = { _id: DOMAIN };
    handler.user = user;
    handler.response = { body: {} };
    handler.request = { json: false, ip: '127.0.0.1', method: 'get' };
    handler.tdoc = doc;
    handler.tsdoc = status;
    handler.tid = doc.docId;
    handler.examPaperAdminPreview = false;
    handler.examPaperAllowPool = false;
    handler.url = handlerUrl;
    if (sessionId) handler.session = { sessionId };
    return handler;
}

function bindPaper(user: Actor, doc: ContestDoc, status: StatusDoc | null, sessionId?: string): PaperHandler {
    return bindPaperRoute('paper_layout', user, doc, status, sessionId);
}

function bindExamMode(user: Actor, doc: ContestDoc, status: StatusDoc | null): ExamModeHandler {
    currentDoc = doc;
    currentStatus = status;
    const ExamModeEntryHandler = paperRoutes.exam_mode_entry as new () => ExamModeHandler;
    const handler = new ExamModeEntryHandler();
    handler.domain = { _id: DOMAIN };
    handler.user = user;
    handler.response = { body: {} };
    handler.request = { json: false, ip: '127.0.0.1', method: 'get' };
    handler.url = handlerUrl;
    return handler;
}

function runningWindow(): { beginAt: Date; endAt: Date } {
    return { beginAt: at(-HOUR), endAt: at(2 * HOUR) };
}

function attendedStatus(): StatusDoc {
    return { attend: 1, startAt: at(-30 * 60 * 1000) };
}

async function checkConfiguredClientPaper(entryMode: string, ended: boolean) {
    const tid = new ObjectId();
    const doc = makeContest({ docId: tid, rule: 'exam', ...runningWindow(), entryMode,
        ...(ended ? { endAt: at(-1000) } : {}), allowPostContestView: true, pids: [PROBLEM_PID],
        setConfig: { ...createDraftConfig('exam'), publication: 'published' } });
    clientSession = { domainId: DOMAIN, contestId: tid, uid: CLIENT_UID };
    const page = bindPaper(makeUser(CLIENT_UID), doc, attendedStatus(), 'bound-session');
    await page._prepare(DOMAIN, tid);
    await page.get({ domainId: DOMAIN });
    expect(readWorkspace(page.response.body)?.mode).to.equal('client');
    expect(readWorkspace(page.response.body)?.urls?.draftList).to.equal(`/paper/${tid}/round/answers`);
    expect(readWorkspace(page.response.body)?.urls?.saveAnswers).to.equal(`/paper/${tid}/round/save`);
    clientSession = { domainId: DOMAIN, contestId: new ObjectId(), uid: CLIENT_UID };
    const wrong = bindPaper(makeUser(CLIENT_UID), doc, attendedStatus(), 'bound-session');
    expect(errorName(await settle(wrong._prepare(DOMAIN, tid)))).to.equal('PermissionError');
}

async function checkWeightedClientPaper(configured: boolean) {
    const tid = new ObjectId();
    const config: SetConfig = { ...createDraftConfig('exam'), publication: 'published' };
    const weight = configured ? 100 : 50;
    const doc = makeContest({ docId: tid, rule: 'exam', ...runningWindow(), pids: [PROBLEM_PID],
        score: { [PROBLEM_PID]: weight }, ...(configured ? { setConfig: config } : {}) });
    problemDocs.set(PROBLEM_PID, { ...statementProblem(), config: { type: 'default', subtasks: [
        { score: 4, cases: [{ input: '1.in', output: '1.out' }] },
        { score: 6, cases: [{ input: '2.in', output: '2.out' }] },
    ] } });
    const startedAt = at(-30 * 60 * 1000);
    if (configured) {
        storedRounds = [{
            _id: new ObjectId(), domainId: DOMAIN, tid, participantKey: `u:${CLIENT_UID}`, roundNo: 1,
            state: 'open', startedAt, closedAt: null, paperPids: [PROBLEM_PID], total: 10, passed: false,
            detail: { [PROBLEM_PID]: { pid: PROBLEM_PID, status: 1, score: 10 } }, scoreRevision: config.revision,
        }];
    }
    clientSession = { domainId: DOMAIN, contestId: tid, uid: CLIENT_UID };
    const page = bindPaper(makeUser(CLIENT_UID), doc, {
        attend: 1, startAt: startedAt, journal: [{ pid: PROBLEM_PID, status: 1, score: 10 }],
    }, 'bound-session');
    await page._prepare(DOMAIN, tid);
    await page.get({ domainId: DOMAIN });
    const workspace = readWorkspace(page.response.body);
    const maximum = configured ? 10 : 5;
    expect(workspace?.mode).to.equal('client');
    expect(workspace?.totals?.maxScore).to.equal(maximum);
    expect(workspace?.groups?.[0]?.scoreEach).to.equal(maximum);
    expect(workspace?.groups?.[0]?.items?.[0]?.score).to.equal(maximum);
    if (!configured) {
        expect(workspace?.groups?.[0]?.items?.[0]?.lastScore).to.equal(maximum);
        expect(page.response.body.cells).to.deep.include({ pid: PROBLEM_PID, questionKey: null, kind: 'default', score: maximum });
    }
}

before(async () => {
    await paperReady;
});

beforeEach(() => {
    problemDocs.clear();
    problemDocs.set(PROBLEM_PID, statementProblem());
    currentDoc = null;
    currentStatus = null;
    clientSession = null;
    clarificationDocs = [];
    attendCalls = 0;
    problemGets = 0;
    draftReads = 0;
    storedRounds = [];
    storedAnswers = [];
    storedRecords = [];
    savedCode = null;
    codeInserts = 0;
    bindVigil();
});

after(() => {
    Module._load = originalLoad;
    for (const key of Object.keys(requireFromTest.cache)) {
        if (!cacheBefore.has(key)) delete requireFromTest.cache[key];
    }
    if (hydroHost.Hydro?.model && Object.hasOwn(hydroHost.Hydro.model, 'vigilguard')) {
        delete hydroHost.Hydro.model.vigilguard;
    }
});

describe('contest and paper workspace routes', { concurrency: false }, () => {
    it('reuses the accepted code record on retry and rejects reuse of its key for changed code', async () => {
        const tid = new ObjectId();
        const config: SetConfig = { ...createDraftConfig('exam'), publication: 'published' };
        config.settings.experience = { ...SET_EXPERIENCE_DEFAULTS, autoSaveBeforeEnd: true };
        const doc = makeContest({ docId: tid, rule: 'exam', beginAt: at(-HOUR), endAt: at(HOUR), pids: [PROBLEM_PID], setConfig: config });
        const body = { roundId: new ObjectId().toHexString(), code: 'int main() {}', lang: 'cpp', autoSaveId: '81cb59d2-b927-4ea9-8512-c707a266f71c' };
        savedCode = { _id: new ObjectId(), setAutoSaveHash: createHash('sha256').update(JSON.stringify([body.roundId, PROBLEM_PID, body.lang, body.code])).digest('hex') };
        const handler = bindPaperRoute('paper_submit_code', makeUser(CLIENT_UID, [PERM.PERM_ATTEND_CONTEST]), doc, { attend: 1 });
        handler.request = { ...handler.request, method: 'post', params: { pid: String(PROBLEM_PID) }, body };
        await handler.post({ domainId: DOMAIN }, PROBLEM_PID);
        expect(handler.response.body.rid).to.deep.equal(savedCode._id);
        expect(codeInserts).to.equal(0);
        handler.request.body = { ...body, code: 'changed' };
        expect(await settle(handler.post({ domainId: DOMAIN }, PROBLEM_PID))).to.be.instanceOf(Error);
        expect(codeInserts).to.equal(0);
    });
    it('replaces configured contest legacy payloads before returning unreleased results', async () => {
        const tid = new ObjectId();
        const config: SetConfig = { ...createDraftConfig('contest'), publication: 'published' };
        config.settings.feedback.code.when = 'after_release';
        config.settings.feedback.code.afterDeadline = 'same';
        const doc = makeContest({ docId: tid, rule: 'contest', ...runningWindow(), pids: [PROBLEM_PID], setConfig: config });
        const startedAt = at(-HOUR / 2);
        storedRounds = [{ _id: new ObjectId(), domainId: DOMAIN, tid, participantKey: `u:${CLIENT_UID}`, roundNo: 1,
            state: 'open', startedAt, closedAt: null, paperPids: [PROBLEM_PID], total: 93, passed: false,
            detail: { [PROBLEM_PID]: { pid: PROBLEM_PID, score: 93, status: 1 } }, scoreRevision: config.revision }];
        storedRecords = [{ pid: PROBLEM_PID, status: 1 }];
        const legacyStatus = { attend: 1, startAt: startedAt, detail: { [PROBLEM_PID]: { score: 987654, privateLegacy: 'legacy-result' } } };
        const handler = bindDetail(makeUser(CLIENT_UID, [PERM.PERM_ATTEND_CONTEST]), doc, legacyStatus);
        await handler.__prepare(DOMAIN, tid);
        await handler.get(DOMAIN, tid);
        expect(Object.keys(handler.response.body).sort()).to.deep.equal(['langRange', 'tdoc', 'workspace', 'workspaceProblems']);
        expect(readWorkspace(handler.response.body)?.totals?.score).to.equal(null);
        expect(JSON.stringify(handler.response.body)).not.to.include('legacy-result');
        expect(JSON.stringify(handler.response.body)).not.to.include(SECRET_ANSWER);
    });

    it('rejects the registered legacy draft GET before reading any configured paper drafts', async () => {
        const tid = new ObjectId();
        const doc = makeContest({ docId: tid, rule: 'exam', ...runningWindow(), pids: [PROBLEM_PID],
            setConfig: { ...createDraftConfig('exam'), publication: 'published' } });
        const handler = bindPaperRoute('paper_draft_list', makeUser(CLIENT_UID, [PERM.PERM_ATTEND_CONTEST]), doc, attendedStatus());
        expect(paperRoutePaths.paper_draft_list).to.equal('/paper/:tid/draft');
        await handler._prepare(DOMAIN, tid);
        expect(errorName(await settle(handler.get({ domainId: DOMAIN })))).to.equal('ValidationError');
        expect(draftReads).to.equal(0);
        expect(handler.response.body).to.deep.equal({});
    });

    it('previews an unpublished configured paper for its teacher while hiding it from students', async () => {
        const tid = new ObjectId();
        const doc = makeContest({ docId: tid, rule: 'exam', ...runningWindow(), pids: [PROBLEM_PID],
            setConfig: createDraftConfig('exam') });
        const teacher = bindPaper(makeUser(doc.owner, [PERM.PERM_EDIT_CONTEST_SELF]), doc, null);
        await teacher._prepare(DOMAIN, tid);
        await teacher.get({ domainId: DOMAIN });
        expect(readWorkspace(teacher.response.body)?.mode).to.equal('preview');
        expect(readWorkspace(teacher.response.body)?.groups?.[0]?.items?.[0]?.pid).to.equal(PROBLEM_PID);
        expect(readWorkspace(teacher.response.body)?.action?.canSubmit).to.equal(false);
        expect(storedRounds).to.deep.equal([]);
        expect(attendCalls).to.equal(0);
        const student = bindPaper(makeUser(CLIENT_UID, [PERM.PERM_ATTEND_CONTEST]), doc, null);
        expect(errorName(await settle(student._prepare(DOMAIN, tid)))).to.equal('ContestNotFoundError');
    });

    it('reports unconfigured times when a teacher opens a title-only paper draft', async () => {
        const tid = new ObjectId();
        const doc = makeContest({ docId: tid, rule: 'exam', ...runningWindow(), setConfig: createDraftConfig('exam') });
        Object.assign(doc, { beginAt: undefined, endAt: undefined });
        const handler = bindPaper(makeUser(doc.owner, [PERM.PERM_EDIT_CONTEST_SELF]), doc, null);
        const error = await settle(handler._prepare(DOMAIN, tid).then(() => handler.get({ domainId: DOMAIN })));
        expect(errorName(error)).to.equal('ValidationError');
        expect(error).to.have.nested.property('params[2]', '请先设置开放时间，再预览学生作答页面。');
        expect(doc.beginAt).to.equal(undefined);
        expect(doc.endAt).to.equal(undefined);
        expect(storedRounds).to.deep.equal([]);
    });

    it('reports unconfigured times before legacy contest clock readers run for a draft preview', async () => {
        const tid = new ObjectId();
        const doc = makeContest({ docId: tid, rule: 'acm', ...runningWindow(), setConfig: createDraftConfig('contest') });
        Object.assign(doc, { beginAt: undefined, endAt: undefined });
        const handler = bindDetail(makeUser(doc.owner, [PERM.PERM_EDIT_CONTEST_SELF]), doc, null);
        const error = await settle(handler.__prepare(DOMAIN, tid).then(() => handler.get(DOMAIN, tid)));
        expect(errorName(error)).to.equal('ValidationError');
        expect(error).to.have.nested.property('params[2]', '请先设置开放时间，再预览学生作答页面。');
        expect(doc.beginAt).to.equal(undefined);
        expect(doc.endAt).to.equal(undefined);
    });

    it('keeps malformed published paper times as a data error', async () => {
        const tid = new ObjectId();
        const doc = makeContest({ docId: tid, rule: 'exam', ...runningWindow(),
            setConfig: { ...createDraftConfig('exam'), publication: 'published' } });
        Object.assign(doc, { beginAt: undefined, endAt: undefined });
        const handler = bindPaper(makeUser(doc.owner, [PERM.PERM_EDIT_CONTEST_SELF]), doc, null);
        const error = await settle(handler._prepare(DOMAIN, tid).then(() => handler.get({ domainId: DOMAIN })));
        expect(errorName(error)).to.equal('TypeError');
    });

    it('offers invitation redemption before starting a configured exam and validates the submitted code', async () => {
        const tid = new ObjectId();
        const doc = makeContest({ docId: tid, rule: 'exam', ...runningWindow(), pids: [PROBLEM_PID], _code: 'entry-code',
            setConfig: { ...createDraftConfig('exam'), publication: 'published' } });
        const actor = makeUser(CLIENT_UID, [PERM.PERM_VIEW_CONTEST, PERM.PERM_ATTEND_CONTEST]);
        const page = bindPaper(actor, doc, null);
        await page._prepare(DOMAIN, tid);
        await page.get({ domainId: DOMAIN });
        const workspace = readWorkspace(page.response.body);
        expect(workspace?.action?.invitationRequired).to.equal(true);
        expect(workspace?.action?.canAttend).to.equal(true);
        expect(workspace?.action?.canStart).to.equal(false);
        expect(workspace?.urls?.attend).to.equal(`/contest/${tid}`);
        expect(attendCalls).to.equal(0);
        const entry = bindDetail(actor, doc, null) as DetailHandler & {
            checkPerm: (permission: bigint) => void; back: () => void;
            prepare: (domainId: string, id: ObjectId) => Promise<void>;
            postAttend: (domainId: string, id: ObjectId, code: string) => Promise<void>;
        };
        entry.request.method = 'post';
        entry.checkPerm = (permission) => { expect(actor.hasPerm(permission)).to.equal(true); };
        entry.back = () => {};
        await entry.__prepare(DOMAIN, tid);
        await entry.prepare(DOMAIN, tid);
        expect(errorName(await settle(entry.postAttend(DOMAIN, tid, 'wrong-code')))).to.equal('InvalidTokenError');
        expect(attendCalls).to.equal(0);
        await entry.postAttend(DOMAIN, tid, 'entry-code');
        expect(attendCalls).to.equal(1);
        expect(storedRounds).to.deep.equal([]);
    });

    it('redeems a configured homework invitation with homework permissions alone', async () => {
        const tid = new ObjectId();
        const doc = makeContest({ docId: tid, rule: 'homework', ...runningWindow(), pids: [PROBLEM_PID], _code: 'homework-code',
            setConfig: { ...createDraftConfig('homework'), publication: 'published' } });
        const actor = makeUser(CLIENT_UID, [PERM.PERM_VIEW_HOMEWORK, PERM.PERM_ATTEND_HOMEWORK]);
        const entry = bindDetail(actor, doc, null) as DetailHandler & {
            checkPerm: (permission: bigint) => void; back: () => void;
            prepare: (domainId: string, id: ObjectId) => Promise<void>;
            postAttend: (domainId: string, id: ObjectId, code: string) => Promise<void>;
        };
        entry.request.method = 'post';
        entry.checkPerm = (permission) => { expect(actor.hasPerm(permission)).to.equal(true); };
        entry.back = () => {};
        await entry.__prepare(DOMAIN, tid);
        await entry.prepare(DOMAIN, tid);
        expect(errorName(await settle(entry.postAttend(DOMAIN, tid, 'wrong-code')))).to.equal('InvalidTokenError');
        expect(attendCalls).to.equal(0);
        await entry.postAttend(DOMAIN, tid, 'homework-code');
        expect(attendCalls).to.equal(1);
        expect(storedRounds).to.deep.equal([]);
    });

    for (const entryMode of ['open', 'client_required']) {
        for (const ended of [false, true]) {
            it(`accepts the exact bound Client session for configured ${entryMode} paper ${ended ? 'after' : 'before'} the deadline`,
                () => checkConfiguredClientPaper(entryMode, ended));
        }
    }

    it('renders a configured contest from its formal round and exposes the canonical save routes', async () => {
        const tid = new ObjectId('64b00000000000000000a601');
        const config: SetConfig = { ...createDraftConfig('contest'), publication: 'published' };
        const doc = makeContest({ docId: tid, rule: 'contest', ...runningWindow(), pids: [PROBLEM_PID], setConfig: config });
        const roundId = new ObjectId('64b00000000000000000a602');
        const startedAt = at(-30 * 60 * 1000);
        storedRounds = [{
            _id: roundId, domainId: DOMAIN, tid, participantKey: `u:${CLIENT_UID}`, roundNo: 1,
            state: 'open', startedAt, closedAt: null, paperPids: [PROBLEM_PID], total: 100, passed: false,
            detail: { [PROBLEM_PID]: { pid: PROBLEM_PID, score: 100, status: 1 } }, scoreRevision: config.revision,
        }];
        storedRecords = [{ pid: PROBLEM_PID, status: 1 }];
        const handler = bindDetail(makeUser(CLIENT_UID, [PERM.PERM_ATTEND_CONTEST]), doc, { attend: 1, startAt: startedAt });
        await handler.__prepare(DOMAIN, tid);
        await handler.get(DOMAIN, tid);
        const workspace = readWorkspace(handler.response.body);
        expect(workspace?.officialRound?.id).to.equal(roundId.toHexString());
        expect(workspace?.officialRound?.roundNo).to.equal(1);
        expect(workspace?.urls?.saveAnswers).to.equal(`/contest/${tid}/round/save`);
        expect(workspace?.urls?.draftList).to.equal(`/contest/${tid}/round/answers`);
        expect(workspace?.urls?.draftUpsert).to.equal(null);
        expect(workspace?.totals?.score).to.equal(100);
        expect(handler.response.body).not.to.have.property('tsdoc');
        expect(handler.response.body.tdoc).not.to.have.property('setConfig');
    });

    it('loads a configured paper formal answer while keeping unreleased grades out of the page', async () => {
        const tid = new ObjectId('64b00000000000000000a603');
        const config: SetConfig = { ...createDraftConfig('exam'), publication: 'published' };
        const doc = makeContest({ docId: tid, rule: 'exam', ...runningWindow(), pids: [PROBLEM_PID], setConfig: config });
        problemDocs.set(PROBLEM_PID, { ...statementProblem(), problemKind: 'subjective',
            config: { type: 'objective', answers: { main: [SECRET_ANSWER, 7, { kind: 'subjective' }] } } });
        const roundId = new ObjectId('64b00000000000000000a604');
        const startedAt = at(-30 * 60 * 1000);
        storedRounds = [{
            _id: roundId, domainId: DOMAIN, tid, participantKey: `u:${CLIENT_UID}`, roundNo: 1,
            state: 'open', startedAt, closedAt: null, paperPids: [PROBLEM_PID], total: 75, passed: false,
            detail: { [PROBLEM_PID]: { pid: PROBLEM_PID, score: 75, status: 12 } }, scoreRevision: config.revision,
        }];
        storedAnswers = [{ pid: PROBLEM_PID, version: 2, operationId: 'fixture-operation', acceptedAt: startedAt,
            body: { main: '我的答案' }, rawScore: 75, status: 12 }];
        const handler = bindPaper(makeUser(CLIENT_UID, [PERM.PERM_ATTEND_CONTEST]), doc, { attend: 1, startAt: startedAt });
        await handler._prepare(DOMAIN, tid);
        await handler.get({ domainId: DOMAIN });
        const workspace = readWorkspace(handler.response.body);
        expect(workspace?.officialRound?.id).to.equal(roundId.toHexString());
        expect(workspace?.urls?.saveAnswers).to.equal(`/paper/${tid}/round/save`);
        expect(workspace?.urls?.draftList).to.equal(`/paper/${tid}/round/answers`);
        expect(workspace?.totals?.score).to.equal(null);
        expect(workspace?.totals?.maxScore).to.equal(100);
        expect(JSON.stringify(handler.response.body)).not.to.include(SECRET_ANSWER);
        expect(handler.response.body).not.to.have.property('tsdoc');
        expect(handler.response.body.tdoc).not.to.have.property('setConfig');
    });

    for (const configured of [false, true]) {
        it(`uses the weighted judge maximum for a legacy problem on the ${configured ? 'configured' : 'legacy'} client paper`,
            () => checkWeightedClientPaper(configured));
    }

    it('redirects /contest/:tid for an exam to paper_layout', async () => {
        const tid = new ObjectId('64b00000000000000000a5c5');
        const doc = makeContest({ docId: tid, rule: 'exam', ...runningWindow(), pids: [PROBLEM_PID] });
        const handler = bindDetail(makeUser(CLIENT_UID), doc, attendedStatus());
        await handler.get(DOMAIN, tid);
        expect(handler.response.redirect, 'exam detail redirect').to.equal(handler.url('paper_layout', { tid }));
    });

    it('renders an acm contest detail with letter numbering', async () => {
        const tid = new ObjectId('64b00000000000000000a5c6');
        const doc = makeContest({
            docId: tid,
            rule: 'acm',
            ...runningWindow(),
            pids: [PROBLEM_PID],
            allowPrint: true,
        });
        const handler = bindDetail(makeUser(CLIENT_UID), doc, attendedStatus());
        await handler.get(DOMAIN, tid);
        expect(handler.response.template, 'acm detail template').to.equal('set_workspace.html');
        expect(readWorkspace(handler.response.body)?.numbering, 'acm numbering').to.equal('letter');
    });

    it('matches client exam-mode urls for a non-admin on the system domain', async () => {
        const tid = new ObjectId(CLIENT_TID_HEX);
        const doc = makeContest({
            docId: tid,
            rule: 'acm',
            ...runningWindow(),
            allowPrint: true,
        });
        const handler = bindExamMode(makeUser(CLIENT_UID), doc, attendedStatus());
        await handler.get(DOMAIN, tid);
        const workspace = readWorkspace(handler.response.body);
        expect(workspace?.mode, 'exam-mode client').to.equal('client');
        expect(workspace?.urls, 'exam-mode client urls').to.deep.equal(acmClientUrls(tid.toHexString()));
    });

    it('redirects a homework exam-mode entry to homework detail without attending', async () => {
        const tid = new ObjectId('64b00000000000000000a5d2');
        const doc = makeContest({ docId: tid, rule: 'homework', ...runningWindow(), pids: [PROBLEM_PID] });
        const handler = bindExamMode(makeUser(CLIENT_UID), doc, { attend: 0 });
        const thrown = await settle(handler.get(DOMAIN, tid));
        expect(attendCalls, 'homework exam-mode attend').to.equal(0);
        expect(handler.response.redirect, 'homework exam-mode redirect').to.equal(handler.url('homework_detail', { tid }));
        expect(thrown, 'homework exam-mode error').to.equal(undefined);
    });

    it('renders a bound client homework exam-mode entry without leaving the whitelist', async () => {
        const tid = new ObjectId('64b00000000000000000a5f1');
        const doc = makeContest({
            docId: tid,
            rule: 'homework',
            entryMode: 'client_required',
            ...runningWindow(),
            pids: [PROBLEM_PID],
        });
        clientSession = { contestId: tid, domainId: DOMAIN, uid: CLIENT_UID };
        const handler = bindExamMode(makeUser(CLIENT_UID), doc, attendedStatus());
        const thrown = await settle(handler.get(DOMAIN, tid));
        expect(thrown, `bound homework exam-mode (${errorName(thrown)})`).to.equal(undefined);
        expect(attendCalls, 'bound homework attend').to.equal(0);
        expect(handler.response.redirect, 'bound homework stays').to.equal(undefined);
        expect(handler.response.template, 'bound homework template').to.equal('set_workspace.html');
        const workspace = readWorkspace(handler.response.body);
        expect(workspace?.kind, 'bound homework kind').to.equal('homework');
        expect(workspace?.mode, 'bound homework mode').to.equal('client');
        expect(workspace?.urls?.overview, 'bound homework overview').to.equal(`/exam-mode/${tid.toHexString()}`);
    });

    it('numbers a contest clarification from the visible problem order', async () => {
        const tid = new ObjectId('64b00000000000000000a5f2');
        const hiddenPid = 12;
        const doc = makeContest({
            docId: tid,
            rule: 'acm',
            ...runningWindow(),
            pids: [hiddenPid, PROBLEM_PID],
        });
        const messageId = new ObjectId();
        clarificationDocs = [{
            _id: messageId,
            owner: CLIENT_UID,
            subject: PROBLEM_PID,
            content: '第二题',
            createdAt: messageId.getTimestamp(),
            reply: [],
        }];
        const handler = bindDetail(makeUser(CLIENT_UID), doc, attendedStatus());
        await handler.get(DOMAIN, tid);
        const workspace = readWorkspace(handler.response.body);
        expect(workspace?.groups?.[0]?.items?.map((item) => item.label), 'visible contest labels').to.deep.equal(['A']);
        expect(workspace?.clarifications?.[0]?.subject, 'visible contest subject').to.equal('A. Sum');
    });

    it('numbers a paper clarification with the delivered PTA label', async () => {
        const tid = new ObjectId('64b00000000000000000a5f3');
        const doc = makeContest({
            docId: tid,
            rule: 'exam',
            ...runningWindow(),
            pids: [1, 2, 3, 4, PROBLEM_PID],
        });
        const messageId = new ObjectId();
        clarificationDocs = [{
            _id: messageId,
            owner: CLIENT_UID,
            subject: PROBLEM_PID,
            content: '卷面题',
            createdAt: messageId.getTimestamp(),
            reply: [],
        }];
        const handler = bindPaper(makeUser(CLIENT_UID), doc, attendedStatus());
        await handler.get({ domainId: DOMAIN });
        const workspace = readWorkspace(handler.response.body);
        expect(workspace?.groups?.[0]?.items?.[0]?.label, 'delivered paper label').to.equal('7-1');
        expect(workspace?.clarifications?.[0]?.subject, 'delivered paper subject').to.equal('7-1. Sum');
    });

    it('lists blank problem titles before an acm exam-mode starts', async () => {
        const tid = new ObjectId('64b00000000000000000a5d3');
        const doc = makeContest({
            docId: tid,
            rule: 'acm',
            beginAt: at(HOUR),
            endAt: at(3 * HOUR),
            pids: [PROBLEM_PID],
        });
        const handler = bindExamMode(makeUser(CLIENT_UID), doc, { attend: 0 });
        await handler.get(DOMAIN, tid);
        const workspace = readWorkspace(handler.response.body);
        const items = workspace?.groups?.[0]?.items ?? [];
        expect(items.map((item) => item.title), 'prestart titles').to.deep.equal(doc.pids.map(() => ''));
        expect(workspace?.locked?.reason, 'prestart lock').to.equal('not_started');
        expect(handler.response.body.workspaceProblems, 'prestart statements').to.deep.equal({});
    });

    it('rewrites exam-mode description file urls onto the contest public file path', async () => {
        const tid = new ObjectId('64b00000000000000000a5d4');
        const doc = makeContest({
            docId: tid,
            rule: 'acm',
            ...runningWindow(),
            content: 'see (file://poster.png)',
            allowPrint: true,
        });
        const handler = bindExamMode(makeUser(CLIENT_UID), doc, attendedStatus());
        await handler.get(DOMAIN, tid);
        const description = readWorkspace(handler.response.body)?.description ?? '';
        expect(description, 'relative public file path').to.include(`./${tid.toHexString()}/file/public/`);
        expect(description, 'contest path').to.not.include('/contest/');
        expect(description, 'raw file url').to.not.include('file://');
        const paths = Object.values(paperRoutePaths);
        expect(paths, 'exam-mode file route').to.include('/exam-mode/:tid/file/:type/:filename');
        expect(paths, 'paper file route').to.include('/paper/:tid/file/:type/:filename');
    });

    it('lists only the public problem when an ended acm was not attended', async () => {
        const tid = new ObjectId('64b00000000000000000a5eb');
        const hiddenPid = 12;
        problemDocs.set(hiddenPid, {
            ...statementProblem(),
            docId: hiddenPid,
            pid: hiddenPid,
            title: 'Hidden sum',
            hidden: true,
        });
        const doc = makeContest({
            docId: tid,
            rule: 'acm',
            entryMode: 'open',
            beginAt: at(-2 * HOUR),
            endAt: at(-HOUR),
            pids: [PROBLEM_PID, hiddenPid],
        });
        const handler = bindDetail(makeUser(CLIENT_UID), doc, { attend: 0 });
        await handler.get(DOMAIN, tid);
        const statements = handler.response.body.workspaceProblems as Record<string, unknown>;
        expect(Object.keys(statements).sort(), 'workspace statements').to.deep.equal([String(PROBLEM_PID)]);
        expect(handler.response.body.pids, 'problem list').to.deep.equal([PROBLEM_PID]);
        const listed = (readWorkspace(handler.response.body)?.groups ?? [])
            .flatMap((group) => group.items ?? [])
            .map((item) => item.pid);
        expect(listed, 'workspace problem list').to.deep.equal([PROBLEM_PID]);
    });

    it('previews exam-mode for an admin without a bound client session', async () => {
        const tid = new ObjectId('64b00000000000000000a5d1');
        const doc = makeContest({ docId: tid, rule: 'acm', ...runningWindow(), allowPrint: true });
        const handler = bindExamMode(makeUser(7, [PERM.PERM_EDIT_CONTEST]), doc, attendedStatus());
        await handler.get(DOMAIN, tid);
        expect(readWorkspace(handler.response.body)?.mode, 'unbound admin exam-mode').to.equal('preview');
    });

    it('uses client mode and the paper url column when a paper session is bound', async () => {
        const tid = new ObjectId('64b00000000000000000a5c4');
        const doc = makeContest({
            docId: tid,
            rule: 'exam',
            ...runningWindow(),
            pids: [PROBLEM_PID],
            allowPrint: true,
            allowSubmitByKind: true,
        });
        clientSession = { contestId: tid, domainId: DOMAIN, uid: CLIENT_UID };
        const handler = bindPaper(makeUser(CLIENT_UID), doc, attendedStatus(), 'bound-paper');
        await handler.get({ domainId: DOMAIN });
        const workspace = readWorkspace(handler.response.body);
        expect(workspace?.mode, 'bound paper mode').to.equal('client');
        expect(workspace?.urls, 'bound paper urls').to.deep.equal(paperClientUrls(tid.toHexString(), true));
        expect(handler.response.body.pdict, 'paper pdict').to.be.an('object');
        expect(handler.response.body.workspaceProblems, 'paper workspaceProblems').to.equal(handler.response.body.pdict);
        expect(handler.response.template, 'paper template').to.equal('exam_paper.html');
    });

    it('sets paper submitByKind from allowSubmitByKind and fills lockKind only then', async () => {
        const openTid = new ObjectId('64b00000000000000000a5c2');
        const openDoc = makeContest({
            docId: openTid,
            rule: 'exam',
            ...runningWindow(),
            allowSubmitByKind: true,
        });
        const openHandler = bindPaper(makeUser(CLIENT_UID), openDoc, attendedStatus());
        await openHandler.get({ domainId: DOMAIN });
        const openWorkspace = readWorkspace(openHandler.response.body);
        expect(openWorkspace?.paper?.submitByKind, 'submit by kind enabled').to.equal(true);
        expect(openWorkspace?.urls?.lockKind, 'lock kind url').to.equal(`/paper/${openTid.toHexString()}/lock-kind`);
    });

    it('leaves lockKind empty when the paper does not submit by kind', async () => {
        const closedTid = new ObjectId('64b00000000000000000a5c3');
        const closedDoc = makeContest({
            docId: closedTid,
            rule: 'exam',
            ...runningWindow(),
            allowSubmitByKind: false,
        });
        const closedHandler = bindPaper(makeUser(CLIENT_UID), closedDoc, attendedStatus());
        await closedHandler.get({ domainId: DOMAIN });
        const closedWorkspace = readWorkspace(closedHandler.response.body);
        expect(closedWorkspace?.paper?.submitByKind, 'submit by kind disabled').to.equal(closedDoc.allowSubmitByKind === true);
        expect(closedWorkspace?.urls?.lockKind, 'lock kind hidden').to.equal(null);
    });

    it('ends practice urls with the problems section after acm practice opens', async () => {
        const tid = new ObjectId('64b00000000000000000a5c7');
        const doc = makeContest({
            docId: tid,
            rule: 'acm',
            beginAt: at(-2 * HOUR),
            endAt: at(-HOUR),
            pids: [PROBLEM_PID],
        });
        const handler = bindDetail(makeUser(CLIENT_UID), doc, { attend: 1, startAt: at(-2 * HOUR) });
        await handler.get(DOMAIN, tid);
        expect(readWorkspace(handler.response.body)?.urls?.practice ?? '', 'practice url').to.match(/\?section=problems$/);
    });

    it('absolutizes attended acm statements and leaves the problem url empty', async () => {
        const visibleTid = new ObjectId('64b00000000000000000a5ca');
        const visible = makeContest({
            docId: visibleTid,
            rule: 'acm',
            ...runningWindow(),
            pids: [PROBLEM_PID],
        });
        const visibleHandler = bindDetail(makeUser(CLIENT_UID), visible, attendedStatus());
        await visibleHandler.get(DOMAIN, visibleTid);
        const visibleProblems = visibleHandler.response.body.workspaceProblems as Record<string, {
            content?: string;
            config?: { answers?: unknown };
        }> | undefined;
        const visibleItem = visibleProblems?.[String(PROBLEM_PID)];
        expect(visibleItem?.content ?? '', 'absolutized statement').to.include(`/p/${PROBLEM_PID}/file/statement.png?tid=${visibleTid.toHexString()}`);
        expect(visibleItem?.content ?? '', 'raw file url').to.not.include('file://');
        expect(visibleItem?.config ?? {}, 'student config').to.not.have.property('answers');
        expect(JSON.stringify(visibleItem?.config ?? {}), 'answer text').to.not.include(SECRET_ANSWER);
        expect(readWorkspace(visibleHandler.response.body)?.urls?.problem, 'problem url').to.equal(null);
    });

    it('locks an unattended running acm and ships no statements', async () => {
        const absentTid = new ObjectId('64b00000000000000000a5c8');
        const absent = makeContest({
            docId: absentTid,
            rule: 'acm',
            ...runningWindow(),
            pids: [PROBLEM_PID],
        });
        const absentHandler = bindDetail(makeUser(CLIENT_UID), absent, { attend: 0 });
        await absentHandler.get(DOMAIN, absentTid);
        expect(readWorkspace(absentHandler.response.body)?.locked?.reason, 'need attend').to.equal('need_attend');
        expect(absentHandler.response.body.workspaceProblems, 'hidden before attend').to.deep.equal({});
        expect(readWorkspace(absentHandler.response.body)?.urls?.problem, 'problem url before attend').to.equal(null);
    });

    it('ships no statements before an acm starts', async () => {
        const earlyTid = new ObjectId('64b00000000000000000a5c9');
        const early = makeContest({
            docId: earlyTid,
            rule: 'acm',
            beginAt: at(HOUR),
            endAt: at(3 * HOUR),
            pids: [PROBLEM_PID],
        });
        const earlyHandler = bindDetail(makeUser(CLIENT_UID), early, { attend: 0 });
        await earlyHandler.get(DOMAIN, earlyTid);
        expect(earlyHandler.response.body.workspaceProblems, 'hidden before start').to.deep.equal({});
        expect(readWorkspace(earlyHandler.response.body)?.urls?.problem, 'problem url before start').to.equal(null);
    });

    it('publishes langRange from the code language setting on contest detail', async () => {
        const contestTid = new ObjectId('64b00000000000000000a5cb');
        const contestDoc = makeContest({ docId: contestTid, rule: 'acm', ...runningWindow() });
        const contestHandler = bindDetail(makeUser(CLIENT_UID), contestDoc, attendedStatus());
        await contestHandler.get(DOMAIN, contestTid);
        expectLangRange(contestHandler.response.body);
    });

    it('publishes langRange from the code language setting on paper layout', async () => {
        const paperTid = new ObjectId('64b00000000000000000a5cc');
        const paperDoc = makeContest({ docId: paperTid, rule: 'exam', ...runningWindow() });
        const paperHandler = bindPaper(makeUser(CLIENT_UID), paperDoc, attendedStatus());
        await paperHandler.get({ domainId: DOMAIN });
        expectLangRange(paperHandler.response.body);
    });

    it('publishes langRange from the code language setting on exam-mode entry', async () => {
        const examTid = new ObjectId('64b00000000000000000a5cd');
        const examDoc = makeContest({ docId: examTid, rule: 'acm', ...runningWindow() });
        const examHandler = bindExamMode(makeUser(CLIENT_UID), examDoc, attendedStatus());
        await examHandler.get(DOMAIN, examTid);
        expectLangRange(examHandler.response.body);
    });

    it('exports projectAndAbsolutizeStudentPdict for homework workspace reuse', () => {
        expect(typeof paperModule.projectAndAbsolutizeStudentPdict, 'paper export').to.equal('function');
    });

    it('renders a locked browser workspace for a client-required acm get', async () => {
        const tid = new ObjectId('64b00000000000000000a5e1');
        const doc = makeContest({
            docId: tid,
            rule: 'acm',
            entryMode: 'client_required',
            ...runningWindow(),
            pids: [PROBLEM_PID],
            privateFiles: [{ _id: 'secret.pdf', name: 'secret.pdf' }],
        });
        const handler = bindDetail(makeUser(CLIENT_UID), doc, attendedStatus());
        const thrown = await settle(handler.__prepare(DOMAIN, tid).then(() => handler.get(DOMAIN, tid)));
        expect(thrown, `client-only contest get (${errorName(thrown)})`).to.equal(undefined);
        const workspace = readWorkspace(handler.response.body);
        expect(handler.response.template, 'client-only template').to.equal('set_workspace.html');
        expect(workspace?.locked?.reason, 'client-only lock').to.equal('client_only');
        expect(handler.response.body.pdict, 'client-only pdict').to.deep.equal({});
        expect(handler.response.body.workspaceProblems, 'client-only statements').to.deep.equal({});
        expect(handler.response.body.files, 'client-only files').to.deep.equal([]);
        expect(workspace?.action?.canAttend, 'client-only attend').to.equal(false);
        expect(workspace?.urls?.attend, 'client-only attend url').to.equal(null);
        expect(workspace?.urls?.clarify, 'client-only clarify').to.equal(null);
        expect(workspace?.urls?.ranking, 'client-only ranking').to.equal(null);
    });

    it('still rejects a client-required acm post and problem list', async () => {
        const tid = new ObjectId('64b00000000000000000a5e2');
        const doc = makeContest({
            docId: tid,
            rule: 'acm',
            entryMode: 'client_required',
            ...runningWindow(),
            pids: [PROBLEM_PID],
        });
        const postHandler = bindDetail(makeUser(CLIENT_UID), doc, attendedStatus());
        postHandler.request.method = 'post';
        const posted = await settle(postHandler.__prepare(DOMAIN, tid));
        expect(errorName(posted), 'client-required post').to.equal('ContestClientRequiredError');

        const listHandler = bindContestHandler(contestModule.ContestProblemListHandler, makeUser(CLIENT_UID), doc, attendedStatus());
        const listed = await settle(listHandler.__prepare(DOMAIN, tid));
        expect(errorName(listed), 'client-required problem list').to.equal('ContestClientRequiredError');
    });

    it('renders a locked browser paper without attending or loading problems', async () => {
        const tid = new ObjectId('64b00000000000000000a5e3');
        const doc = makeContest({
            docId: tid,
            rule: 'exam',
            entryMode: 'client_required',
            ...runningWindow(),
            pids: [PROBLEM_PID],
        });
        const user = makeUser(CLIENT_UID, [PERM.PERM_ATTEND_CONTEST]);
        const started: StatusDoc = { attend: 0, startAt: at(-30 * 60 * 1000) };
        const handler = bindPaper(user, doc, started);
        const thrown = await settle(handler._prepare(DOMAIN, tid).then(() => handler.get({ domainId: DOMAIN })));
        expect(thrown, `client-only paper get (${errorName(thrown)})`).to.equal(undefined);
        const workspace = readWorkspace(handler.response.body);
        expect(workspace?.mode, 'client-only paper mode').to.equal('browser');
        expect(workspace?.locked?.reason, 'client-only paper lock').to.equal('client_only');
        expect(handler.response.body.pdict, 'client-only paper pdict').to.deep.equal({});
        expect(handler.response.body.workspaceProblems, 'client-only paper statements').to.deep.equal({});
        expect(handler.response.body.cells, 'client-only paper cells').to.deep.equal([]);
        expect(attendCalls, 'client-only paper attend').to.equal(0);
        expect(problemGets, 'client-only paper problem reads').to.equal(0);

        const draft = bindPaperRoute('paper_draft_list', user, doc, started);
        const draftThrown = await settle(draft._prepare(DOMAIN, tid));
        expect(errorName(draftThrown), 'client-only draft list').to.equal('PermissionError');
    });

    it('opens an ended client-required paper for review after the student started', async () => {
        const tid = new ObjectId('64b00000000000000000a5e4');
        const doc = makeContest({
            docId: tid,
            rule: 'exam',
            entryMode: 'client_required',
            beginAt: at(-2 * HOUR),
            endAt: at(-HOUR),
            pids: [PROBLEM_PID],
        });
        const user = makeUser(CLIENT_UID, [PERM.PERM_ATTEND_CONTEST]);
        const started: StatusDoc = { attend: 1, startAt: at(-2 * HOUR) };
        const handler = bindPaper(user, doc, started);
        const thrown = await settle(handler._prepare(DOMAIN, tid).then(() => handler.get({ domainId: DOMAIN })));
        expect(thrown, `ended client-required paper (${errorName(thrown)})`).to.equal(undefined);
        const workspace = readWorkspace(handler.response.body);
        expect(workspace?.phase, 'ended paper phase').to.equal('ended');
        expect(workspace?.locked, 'ended paper lock').to.equal(null);
        expect(handler.response.body.workspaceProblems, 'ended paper statements').to.have.property(String(PROBLEM_PID));

        const draft = bindPaperRoute('paper_draft_list', user, doc, started);
        const draftThrown = await settle(draft._prepare(DOMAIN, tid));
        expect(draftThrown, `ended draft list (${errorName(draftThrown)})`).to.equal(undefined);
    });

    it('still rejects a client-finished paper before the contest ends', async () => {
        const tid = new ObjectId('64b00000000000000000a5e5');
        const doc = makeContest({
            docId: tid,
            rule: 'exam',
            entryMode: 'client_required',
            ...runningWindow(),
            pids: [PROBLEM_PID],
        });
        const user = makeUser(CLIENT_UID, [PERM.PERM_ATTEND_CONTEST]);
        const finished: StatusDoc = { attend: 1, startAt: at(-30 * 60 * 1000), clientFinishedAt: at(-10 * 60 * 1000) };
        const live = bindPaper(user, doc, finished);
        const liveThrown = await settle(live._prepare(DOMAIN, tid));
        expect(errorName(liveThrown), 'client finished before end').to.equal('ContestClientFinishedError');

        const ended = makeContest({
            docId: tid,
            rule: 'exam',
            entryMode: 'client_required',
            beginAt: at(-2 * HOUR),
            endAt: at(-HOUR),
            pids: [PROBLEM_PID],
        });
        const review = bindPaper(user, ended, finished);
        const reviewThrown = await settle(review._prepare(DOMAIN, tid).then(() => review.get({ domainId: DOMAIN })));
        expect(errorName(reviewThrown), 'client finished after end').to.not.equal('ContestClientFinishedError');
        expect(reviewThrown, `client finished after end (${errorName(reviewThrown)})`).to.equal(undefined);
    });

    it('shows an upcoming paper and still blocks the draft list', async () => {
        const tid = new ObjectId('64b00000000000000000a5e6');
        const doc = makeContest({
            docId: tid,
            rule: 'exam',
            entryMode: 'open',
            beginAt: at(HOUR),
            endAt: at(3 * HOUR),
            pids: [PROBLEM_PID],
        });
        const user = makeUser(CLIENT_UID, [PERM.PERM_ATTEND_CONTEST]);
        const handler = bindPaper(user, doc, { attend: 0 });
        const thrown = await settle(handler._prepare(DOMAIN, tid).then(() => handler.get({ domainId: DOMAIN })));
        expect(thrown, `upcoming paper (${errorName(thrown)})`).to.equal(undefined);
        const workspace = readWorkspace(handler.response.body);
        expect(workspace?.phase, 'upcoming phase').to.equal('upcoming');
        expect(workspace?.locked?.reason, 'upcoming lock').to.equal('not_started');
        expect(handler.response.body.pdict, 'upcoming pdict').to.deep.equal({});

        const draft = bindPaperRoute('paper_draft_list', user, doc, { attend: 0 });
        const draftThrown = await settle(draft._prepare(DOMAIN, tid).then(() => draft.get({ domainId: DOMAIN })));
        expect(errorName(draftThrown), 'upcoming draft list').to.equal('ContestNotLiveError');
    });

    it('keeps a bound client on the ended acm workspace', async () => {
        const tid = new ObjectId('64b00000000000000000a5e7');
        const doc = makeContest({
            docId: tid,
            rule: 'acm',
            entryMode: 'open',
            beginAt: at(-2 * HOUR),
            endAt: at(-HOUR),
            pids: [PROBLEM_PID],
        });
        clientSession = { contestId: tid, domainId: DOMAIN, uid: CLIENT_UID };
        const handler = bindExamMode(makeUser(CLIENT_UID), doc, { attend: 1, startAt: at(-2 * HOUR) });
        const thrown = await settle(handler.get(DOMAIN, tid));
        expect(thrown, `bound ended exam mode (${errorName(thrown)})`).to.equal(undefined);
        expect(handler.response.redirect, 'bound ended redirect').to.equal(undefined);
        expect(handler.response.template, 'bound ended template').to.equal('set_workspace.html');
        const workspace = readWorkspace(handler.response.body);
        expect(workspace?.phase, 'bound ended phase').to.equal('ended');
        expect(workspace?.urls?.practice, 'bound ended practice').to.equal(null);
    });

    it('locks an ended bound client workspace when post-contest view is closed', async () => {
        const tid = new ObjectId('64b00000000000000000a5e8');
        const doc = makeContest({
            docId: tid,
            rule: 'acm',
            entryMode: 'open',
            beginAt: at(-2 * HOUR),
            endAt: at(-HOUR),
            allowPostContestView: false,
            pids: [PROBLEM_PID],
        });
        clientSession = { contestId: tid, domainId: DOMAIN, uid: CLIENT_UID };
        const handler = bindExamMode(makeUser(CLIENT_UID), doc, { attend: 1, startAt: at(-2 * HOUR) });
        const thrown = await settle(handler.get(DOMAIN, tid));
        expect(thrown, `view-closed exam mode (${errorName(thrown)})`).to.equal(undefined);
        const workspace = readWorkspace(handler.response.body);
        expect(workspace?.locked?.reason, 'view-closed lock').to.equal('view_closed');
        expect(handler.response.body.pdict, 'view-closed pdict').to.deep.equal({});
        expect(handler.response.body.workspaceProblems, 'view-closed statements').to.deep.equal({});
    });

    it('redirects an unbound ended acm exam-mode entry to the problem list', async () => {
        const tid = new ObjectId('64b00000000000000000a5e9');
        const doc = makeContest({
            docId: tid,
            rule: 'acm',
            entryMode: 'open',
            beginAt: at(-2 * HOUR),
            endAt: at(-HOUR),
            pids: [PROBLEM_PID],
        });
        const handler = bindExamMode(makeUser(CLIENT_UID), doc, { attend: 1, startAt: at(-2 * HOUR) });
        const thrown = await settle(handler.get(DOMAIN, tid));
        expect(thrown, `unbound ended exam mode (${errorName(thrown)})`).to.equal(undefined);
        expect(handler.response.redirect, 'unbound ended redirect').to.equal(`/contest/${tid.toHexString()}/problems`);
    });

    it('hides a finished paper when post-contest view is closed', async () => {
        const tid = new ObjectId('64b00000000000000000a5ea');
        const doc = makeContest({
            docId: tid,
            rule: 'exam',
            entryMode: 'open',
            beginAt: at(-2 * HOUR),
            endAt: at(-HOUR),
            allowPostContestView: false,
            pids: [PROBLEM_PID],
        });
        const handler = bindPaper(makeUser(CLIENT_UID, [PERM.PERM_ATTEND_CONTEST]), doc, { attend: 1, startAt: at(-2 * HOUR) });
        const thrown = await settle(handler._prepare(DOMAIN, tid).then(() => handler.get({ domainId: DOMAIN })));
        expect(thrown, `closed paper view (${errorName(thrown)})`).to.equal(undefined);
        const workspace = readWorkspace(handler.response.body);
        expect(workspace?.locked?.reason, 'closed paper lock').to.equal('view_closed');
        expect(handler.response.body.pdict, 'closed paper pdict').to.deep.equal({});
        expect(handler.response.body.workspaceProblems, 'closed paper statements').to.deep.equal({});
        expect(handler.response.body.cells, 'closed paper cells').to.deep.equal([]);
    });
});
