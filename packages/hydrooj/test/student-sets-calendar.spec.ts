import { beforeEach, describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { SET_DEFAULT_PERMISSIONS, type SetConfig } from '@hydrooj/common';
import { makeRound, publishedConfig, roundStore } from './helpers/student-set-rounds';
import type { StudentDirectory, StudentDirectoryStudent } from '../src/service/student-directory';

const hydroGlobal = globalThis as unknown as { Hydro?: { model: Record<string, unknown>; module: Record<string, unknown>; ui: Record<string, unknown> } };
hydroGlobal.Hydro ||= { model: {}, module: {}, ui: {} };

const { PERM, PRIV } = require('../src/model/builtin') as {
    PERM: Record<string, bigint>;
    PRIV: Record<string, number>;
};
const { registerStudentDirectory } = require('../src/service/student-directory') as {
    registerStudentDirectory: (adapter: StudentDirectory) => void;
};

const Module = require('module') as {
    _load: (
        request: string,
        parent: { filename?: string } | null | undefined,
        isMain: boolean,
    ) => unknown;
};

const DOMAIN = 'system';
const STUDENT_UID = 42;
const TEACHER_UID = 7;
const EDITOR_UID = 8;
const OTHER_UID = 99;
const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_FROM = new Date('2026-10-19T00:00:00.000Z');
const RANGE_TO = new Date('2026-10-26T00:00:00.000Z');
const RANGE_NOW = new Date('2026-10-21T04:00:00.000Z');

type Query = Record<string, unknown>;

interface Actor {
    _id: number;
    group: string[];
    hasPerm: (...perm: bigint[]) => boolean;
    hasPriv: (...priv: number[]) => boolean;
    own: (doc: { owner: number; maintainer?: number[] }) => boolean;
}

interface ContestDoc {
    setConfig?: SetConfig;
    participationMode?: 'team';
    plannedTeamBatchId?: ObjectId;
    _id: ObjectId;
    docId: ObjectId;
    domainId: string;
    docType: number;
    rule: string;
    title: string;
    owner: number;
    maintainer: number[];
    beginAt: Date;
    endAt: Date;
    pids: number[];
    duration: number;
    assign: string[];
    hidden: boolean;
    participantScopeMode?: string;
    participantGroupIds?: ObjectId[];
}

interface ContestStatusDoc {
    domainId: string;
    docId: ObjectId;
    uid: number;
    attend?: number;
    startAt?: Date;
    detail?: Record<string, unknown>;
    paperFinalizedAt?: Date;
}

interface DraftDoc {
    domainId: string;
    tid: ObjectId;
    uid: number;
    pid: number;
}

interface BatchDoc {
    domainId: string;
    batchId: ObjectId;
    _id: ObjectId;
    title: string;
    description: string;
    status: 'open' | 'closed';
    createdBy: number;
}

interface TrainingDoc {
    _id: ObjectId;
    docId: ObjectId;
    domainId: string;
    docType: number;
    kind: string;
    title: string;
    owner: number;
    maintainer?: number[];
    pin: number;
    dag: Array<{ _id: number; title: string; requireNids: number[]; pids: number[]; tids?: ObjectId[] }>;
}

interface PracticeDecision {
    discoverable: boolean;
    accessible: boolean;
    enrolled: boolean;
    sources: Array<{ kind: string }>;
    stageAccess: 'all';
}

interface CalendarRange {
    from: Date;
    to: Date;
}

interface CalendarHrefs {
    contest: (tid: string) => string;
    homework: (tid: string) => string;
    practice: (tid: string) => string;
    team: (batchId: string) => string;
}

type LoadStudentCalendar = (
    domainId: string,
    actor: Actor,
    range: CalendarRange,
    hrefs: CalendarHrefs,
    now: Date,
) => Promise<unknown>;

interface CalendarCall {
    tab?: string;
    page?: number;
    q?: string;
    type?: string;
    view?: string;
    from?: string;
    to?: string;
    json?: boolean;
}

interface LaneHandler {
    user: Actor;
    domain: { _id: string };
    ctx: {
        parallel: (...args: unknown[]) => Promise<void>;
        setting: { get: (key: string) => unknown };
    };
    request: { method: string; path: string; query: Record<string, string>; json?: boolean };
    response: { template?: string; body?: unknown; redirect?: string };
    url: (name: string, args?: Record<string, unknown>) => string;
    get: (
        domainId: string,
        tab?: string,
        page?: number,
        q?: string,
        type?: string,
        view?: string,
        from?: string,
        to?: string,
    ) => Promise<void>;
}

const contests: ContestDoc[] = [];
const formal = roundStore();
const contestTeams = new Map<string, { teamId: ObjectId; memberUids: number[] }>();
const contestStatuses: ContestStatusDoc[] = [];
const drafts: DraftDoc[] = [];
const batches: BatchDoc[] = [];
const trainings: TrainingDoc[] = [];
const practiceDecisions = new Map<string, PracticeDecision>();
const routes: Record<string, new () => LaneHandler> = {};

const GROUP_A = oid(0xa1);
const GROUP_B = oid(0xb2);

function oid(n: number): ObjectId {
    return new ObjectId(n.toString(16).padStart(24, '0'));
}

function resetStores(): void {
    contests.length = 0;
    formal.reset();
    contestTeams.clear();
    contestStatuses.length = 0;
    drafts.length = 0;
    batches.length = 0;
    trainings.length = 0;
    practiceDecisions.clear();
}

function isOperator(value: unknown): value is Query {
    return Boolean(value)
        && typeof value === 'object'
        && !Array.isArray(value)
        && !(value instanceof ObjectId)
        && !(value instanceof Date)
        && !(value instanceof RegExp);
}

function sameValue(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
    if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
    return left === right;
}

function containsValue(field: unknown, expected: unknown): boolean {
    if (Array.isArray(field)) return field.some((item) => sameValue(item, expected));
    return sameValue(field, expected);
}

function compareValues(left: unknown, right: unknown): number | null {
    if (left == null || right == null) return null;
    if (left instanceof ObjectId && right instanceof ObjectId) {
        const leftHex = left.toHexString();
        const rightHex = right.toHexString();
        if (leftHex === rightHex) return 0;
        return leftHex < rightHex ? -1 : 1;
    }
    if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    if (typeof left === 'string' && typeof right === 'string') {
        if (left === right) return 0;
        return left < right ? -1 : 1;
    }
    return null;
}

function matchesOrdered(field: unknown, op: string, expected: unknown): boolean {
    const delta = compareValues(field, expected);
    if (delta === null) return false;
    if (op === '$gt') return delta > 0;
    if (op === '$gte') return delta >= 0;
    if (op === '$lt') return delta < 0;
    return delta <= 0;
}

function matchesRegex(field: unknown, pattern: unknown, options: unknown): boolean {
    if (typeof field !== 'string') return false;
    const flags = typeof options === 'string' ? options : '';
    const expression = pattern instanceof RegExp ? pattern : new RegExp(String(pattern), flags);
    expression.lastIndex = 0;
    return expression.test(field);
}

function matchField(field: unknown, expected: unknown): boolean {
    if (expected instanceof RegExp) return matchesRegex(field, expected, '');
    if (!isOperator(expected)) return containsValue(field, expected);
    if ('$exists' in expected) {
        const exists = field !== undefined;
        if (expected.$exists === true && !exists) return false;
        if (expected.$exists === false && exists) return false;
    }
    if ('$ne' in expected && containsValue(field, expected.$ne)) return false;
    if ('$in' in expected) {
        const list = expected.$in;
        if (!Array.isArray(list) || field === undefined) return false;
        const values = Array.isArray(field) ? field : [field];
        const found = values.some((item) => list.some((candidate) => sameValue(item, candidate)));
        if (!found) return false;
    }
    if ('$size' in expected && (!Array.isArray(field) || field.length !== expected.$size)) return false;
    if ('$regex' in expected && !matchesRegex(field, expected.$regex, expected.$options)) return false;
    if ('$gt' in expected && !matchesOrdered(field, '$gt', expected.$gt)) return false;
    if ('$gte' in expected && !matchesOrdered(field, '$gte', expected.$gte)) return false;
    if ('$lt' in expected && !matchesOrdered(field, '$lt', expected.$lt)) return false;
    if ('$lte' in expected && !matchesOrdered(field, '$lte', expected.$lte)) return false;
    return true;
}

function matchQuery(doc: Record<string, unknown>, query: Query): boolean {
    for (const [key, expected] of Object.entries(query)) {
        if (key === '$or') {
            if (!Array.isArray(expected) || !expected.some((item) => isOperator(item) && matchQuery(doc, item))) return false;
            continue;
        }
        if (key === '$and') {
            if (!Array.isArray(expected) || !expected.every((item) => isOperator(item) && matchQuery(doc, item))) return false;
            continue;
        }
        const field = key.split('.').reduce<unknown>((value, part) => isOperator(value) ? value[part] : undefined, doc);
        if (!matchField(field, expected)) return false;
    }
    return true;
}

function sortRows<T>(rows: T[], spec: Record<string, number>): T[] {
    const keys = Object.keys(spec);
    return rows.slice().sort((left, right) => {
        const leftRow = left as Record<string, unknown>;
        const rightRow = right as Record<string, unknown>;
        for (const key of keys) {
            const delta = compareValues(leftRow[key], rightRow[key]);
            if (delta) return delta * spec[key];
        }
        return 0;
    });
}

function cursorOf<T>(rows: T[], defaultSort?: Record<string, number>) {
    let spec = defaultSort ?? null;
    let skipCount = 0;
    let limitCount = Number.POSITIVE_INFINITY;
    const api = {
        sort(next: Record<string, number>) {
            spec = next;
            return api;
        },
        skip(count: number) {
            skipCount = count;
            return api;
        },
        limit(count: number) {
            limitCount = count;
            return api;
        },
        project(_fields: Record<string, number>) {
            return api;
        },
        async toArray() {
            const sorted = spec ? sortRows(rows, spec) : rows.slice();
            return sorted.slice(skipCount, skipCount + limitCount);
        },
    };
    return api;
}

function contestGetMulti(domainId: string, query: Query = {}) {
    const matched = contests.filter((doc) => matchQuery(doc as unknown as Record<string, unknown>, { domainId, ...query }));
    return cursorOf(matched);
}

function contestGetMultiStatus(domainId: string, query: Query) {
    return cursorOf(contestStatuses.filter((status) => matchQuery({ ...status }, { domainId, ...query })));
}

function trainingGetMulti(domainId: string, query: Query = {}) {
    const matched = trainings.filter((doc) => matchQuery(doc as unknown as Record<string, unknown>, { domainId, ...query }));
    return cursorOf(matched, { pin: -1, _id: -1 });
}

function trainingGetMultiStatus(domainId: string, query: Query) {
    const matched: unknown[] = [];
    return cursorOf(matched.filter((status) => matchQuery(status as Record<string, unknown>, { domainId, ...query })));
}

async function trainingGetList(domainId: string, tids: ObjectId[]) {
    const rows = await trainingGetMulti(domainId, { _id: { $in: tids } }).toArray();
    const result: Record<string, TrainingDoc> = {};
    for (const row of rows) result[row.docId.toHexString()] = row;
    return result;
}

function buildScopedTrainingProgress() {
    return { completedProblemCount: 0 };
}

async function evaluateMany(_domainId: string, _actor: unknown, tdocs: Array<{ docId?: ObjectId }>) {
    const result = new Map<string, PracticeDecision>();
    for (const tdoc of tdocs) {
        const id = tdoc.docId ? tdoc.docId.toHexString() : '';
        result.set(id, practiceDecisions.get(id) ?? {
            discoverable: false,
            accessible: false,
            enrolled: false,
            sources: [],
            stageAccess: 'all',
        });
    }
    return result;
}

async function getLatestPublished() {
    return null;
}

async function getCompletedByScope() {
    return new Map<number, Set<number>>();
}

function makeActor(uid: number, permBits: bigint, groups: string[]): Actor {
    return {
        _id: uid,
        group: groups,
        hasPerm: (...perms: bigint[]) => perms.some((perm) => (permBits & perm) === perm),
        hasPriv: (...privs: number[]) => privs.some((priv) => (PRIV.PRIV_USER_PROFILE & priv) === priv),
        own: (doc) => doc.owner === uid || (doc.maintainer ?? []).includes(uid),
    };
}

function student(): Actor {
    return makeActor(
        STUDENT_UID,
        PERM.PERM_VIEW_CONTEST | PERM.PERM_VIEW_HOMEWORK | PERM.PERM_VIEW_TRAINING | PERM.PERM_ATTEND_CONTEST | PERM.PERM_ATTEND_HOMEWORK,
        ['class-a'],
    );
}

function teacher(): Actor {
    return makeActor(TEACHER_UID, PERM.PERM_CREATE_CONTEST, []);
}

function homeworkEditor(): Actor {
    return makeActor(EDITOR_UID, PERM.PERM_EDIT_HOMEWORK, []);
}

function hoursFrom(now: Date, hours: number): Date {
    return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

function baseContest(id: ObjectId, rule: string, title: string, owner: number, beginAt: Date, endAt: Date): ContestDoc {
    return {
        _id: id,
        docId: id,
        domainId: DOMAIN,
        docType: 30,
        setConfig: publishedConfig(rule),
        rule,
        title,
        owner,
        maintainer: [],
        beginAt,
        endAt,
        pids: [1],
        duration: 0,
        assign: [],
        hidden: false,
    };
}

function visibleHomework(id: ObjectId, title: string, beginAt: Date, endAt: Date, groupId: ObjectId): ContestDoc {
    return {
        ...baseContest(id, 'homework', title, OTHER_UID, beginAt, endAt),
        participantScopeMode: 'groups',
        participantGroupIds: [groupId],
    };
}

function isMod(request: string, suffix: string): boolean {
    const normalized = request.replace(/\\/g, '/').replace(/\.(ts|js)$/, '');
    return normalized === suffix || normalized.endsWith(`/${suffix}`);
}

function loadedFromLane(filename: string | undefined): boolean {
    if (!filename) return false;
    const normalized = filename.replace(/\\/g, '/');
    return normalized.includes('/handler/training.')
        || normalized.includes('/lib/student-sets-load.')
        || normalized.includes('/lib/set-round-score-visible.')
        || normalized.includes('/lib/practice-list.')
        || normalized.includes('/lib/container-visibility.');
}

function laneStub(request: string): unknown {
    if (isMod(request, 'model/contest')) {
        return {
            RULES: {
                acm: { hidden: false },
                oi: { hidden: false },
                homework: { hidden: true },
                ioi: { hidden: false },
                ledo: { hidden: false },
                strictioi: { hidden: false },
                exam: { hidden: false },
            },
            getMulti: contestGetMulti,
            getMultiStatus: contestGetMultiStatus,
        };
    }
    if (isMod(request, 'model/training')) {
        return {
            getMulti: trainingGetMulti,
            getMultiStatus: trainingGetMultiStatus,
            getList: trainingGetList,
            buildScopedTrainingProgress,
        };
    }
    if (isMod(request, 'model/user')) {
        return {
            async listGroup(domainId: string, uid?: number) {
                const groups = uid === STUDENT_UID ? [{ name: 'class-a', uids: [STUDENT_UID] }] : [];
                if (typeof uid === 'number') groups.push({ name: String(uid), uids: [uid] });
                return groups.map((group) => ({ ...group, domainId, _id: oid(0xee) }));
            },
        };
    }
    if (isMod(request, 'model/problem-set-access')) {
        return {
            canManageProblemSet: () => false,
            problemSetAccessService: { evaluateMany },
        };
    }
    if (isMod(request, 'model/practice-integrity')) {
        return { practiceIntegrityService: { getLatestPublished } };
    }
    if (isMod(request, 'model/contextual-completion')) {
        return { contextualCompletionService: { getCompletedByScope } };
    }
    if (isMod(request, 'model/paper-draft')) {
        return {
            async getDraftsForUser(domainId: string, tid: ObjectId, uid: number) {
                return drafts.filter((draft) => draft.domainId === domainId && draft.tid.equals(tid) && draft.uid === uid);
            },
        };
    }
    if (isMod(request, 'model/set-round')) return formal.model;
    if (isMod(request, 'model/contest-team')) {
        return {
            async getTeamByMember(_domain: string, tid: ObjectId, uid: number) {
                const team = contestTeams.get(tid.toHexString());
                return team?.memberUids.includes(uid) ? team : null;
            },
        };
    }
    if (isMod(request, 'model/contest-team-batch')) {
        return {
            getMultiBatch(domainId: string, query: Query = {}) {
                return cursorOf(batches.filter((batch) => matchQuery(batch as unknown as Record<string, unknown>, { domainId, ...query })));
            },
            async getTeamByMember() {
                return null;
            },
            getPendingInvitesForUser() {
                return cursorOf([]);
            },
        };
    }
    if (isMod(request, 'handler/contest')) {
        return {
            canBrowseAssignRestrictedContests(actor: { hasPerm: (...perm: bigint[]) => boolean }) {
                return actor.hasPerm(PERM.PERM_EDIT_CONTEST) || actor.hasPerm(PERM.PERM_VIEW_HIDDEN_CONTEST);
            },
        };
    }
    if (isMod(request, 'service/server')) {
        class Handler {
            user!: Actor;

            domain = { _id: DOMAIN };

            ctx = {
                parallel: async () => undefined,
                setting: { get: () => undefined },
            };

            request: LaneHandler['request'] = { method: 'get', path: '', query: {} };

            response: LaneHandler['response'] = {};

            url(name: string, args: Record<string, unknown> = {}) {
                const id = args.tid ?? args.batchId ?? '';
                const text = String(id);
                if (name === 'contest_detail') return `/contest/${text}`;
                if (name === 'homework_detail') return `/homework/${text}`;
                if (name === 'training_detail') return `/problem-sets/${text}`;
                if (name === 'training_main') return '/problem-sets';
                if (name === 'team_batch_detail') return `/teams/${text}`;
                return `/${name}`;
            }
        }
        return {
            Handler,
            param: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
            post: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
            Types: {
                ObjectId: {},
                Filename: {},
                PositiveInt: {},
                String: {},
                Title: {},
                Content: {},
                UnsignedInt: {},
                Boolean: {},
                ArrayOf: () => ({}),
            },
        };
    }
    if (isMod(request, 'model/problem')) return { assertProblemAclDomain() { return undefined; } };
    if (isMod(request, 'model/problem-access')) return { assertProblemBankSelection: async () => undefined };
    if (isMod(request, 'model/storage')) return {};
    if (isMod(request, 'model/system')) return { get: () => undefined };
    if (isMod(request, 'model/oplog')) return { async log() { return undefined; } };
    if (isMod(request, 'handler/problem-reference') || isMod(request, 'problem-reference')) {
        return {
            getVisibleReferencedProblems: async () => ({}),
            normalizeProblemDocIds: (pids: unknown) => pids,
        };
    }
    if (isMod(request, 'lib/practice-roster-load')) return { loadCompletedPidsByUid: async () => [] };
    if (isMod(request, 'lib/practice-roster')) {
        return {
            assemblePracticeRosterMembers: () => [],
            PRACTICE_ROSTER_ENROLL_LIMIT: 500,
            serializePracticeRosterProblems: () => [],
        };
    }
    if (isMod(request, 'lib/container-problem-kinds')) return { assertContainerProblemKinds: async () => undefined };
    return undefined;
}

const originalLoad = Module._load;
Module._load = function load(request: string, parent: { filename?: string } | null | undefined, isMain: boolean) {
    if (loadedFromLane(parent?.filename)) {
        const stub = laneStub(request);
        if (stub !== undefined) return stub;
    }
    return originalLoad.call(this, request, parent, isMain);
};

const trainingPath = require.resolve('../src/handler/training.ts');
delete require.cache[trainingPath];
const trainingModule = require(trainingPath) as {
    apply: (ctx: { Route: (name: string, path: string, HandlerClass: new () => LaneHandler) => void }) => Promise<void>;
};
void trainingModule.apply({
    Route(name, _path, HandlerClass) {
        routes[name] = HandlerClass;
    },
});

const studentRecord: StudentDirectoryStudent = {
    _id: oid(0x5d),
    domainId: DOMAIN,
    schoolId: oid(0x5c),
    studentId: 's42',
    realName: '学生甲',
    groupIds: [GROUP_A],
    boundUserId: STUDENT_UID,
    boundAt: new Date('2026-01-01T00:00:00Z'),
};

const directory: StudentDirectory = {
    async listSchools() {
        return [];
    },
    async getSchool() {
        return null;
    },
    async listUserGroups() {
        return [];
    },
    async findStudentByUserId(_domainId: string, userId: number) {
        return userId === STUDENT_UID ? studentRecord : null;
    },
    async findStudentsByUserIds() {
        return {};
    },
    async searchBoundStudents() {
        return [];
    },
    async findBoundStudentsByGroupIds() {
        return [];
    },
    async findStudentsByGroupIds() {
        return [];
    },
    async loadExamRosterUserbindSnapshot() {
        throw new Error('exam roster is not used by the student calendar');
    },
    async lookupStudent() {
        return { found: false, eligibleContestIds: [] };
    },
};
registerStudentDirectory(directory);

function decide(id: ObjectId, discoverable: boolean, source: string): void {
    practiceDecisions.set(id.toHexString(), {
        discoverable,
        accessible: discoverable,
        enrolled: false,
        sources: [{ kind: source }],
        stageAccess: 'all',
    });
}

function addTraining(id: ObjectId, title: string, pin: number, kind: string, pids: number[], tids: ObjectId[] = []): void {
    trainings.push({
        _id: id,
        docId: id,
        domainId: DOMAIN,
        docType: 40,
        kind,
        title,
        owner: TEACHER_UID,
        maintainer: [],
        pin,
        dag: [{ _id: 1, title: '阶段', requireNids: [], pids, tids }],
    });
}

function seedOpenBatch(batchId: ObjectId, title: string): void {
    batches.push({
        domainId: DOMAIN,
        batchId,
        _id: batchId,
        title,
        description: '周六下午',
        status: 'open',
        createdBy: OTHER_UID,
    });
}

function hrefs(): CalendarHrefs {
    return {
        contest: (tid) => `/contest/${tid}`,
        homework: (tid) => `/homework/${tid}`,
        practice: (tid) => `/problem-sets/${tid}`,
        team: (batchId) => `/teams/${batchId}`,
    };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
    expect(value !== null && typeof value === 'object' && !Array.isArray(value), label).to.equal(true);
    return value as Record<string, unknown>;
}

function readString(row: Record<string, unknown>, key: string): string {
    expect(typeof row[key], key).to.equal('string');
    return row[key] as string;
}

function readRows(body: Record<string, unknown>): Record<string, unknown>[] {
    expect(Array.isArray(body.rows), 'body.rows').to.equal(true);
    return (body.rows as unknown[]).map((row, index) => asRecord(row, `rows[${index}]`));
}

function rowIdentity(row: Record<string, unknown>): { kind: string; id: string } {
    return { kind: readString(row, 'kind'), id: readString(row, 'id') };
}

function loadCalendar(): LoadStudentCalendar {
    const loaded: unknown = require('../src/lib/student-sets-load');
    const record = asRecord(loaded, 'student-sets-load');
    expect(typeof record.loadStudentCalendar, 'loadStudentCalendar').to.equal('function');
    return record.loadStudentCalendar as LoadStudentCalendar;
}

async function calendarFromLoader(actor: Actor, from: Date, to: Date, now: Date = RANGE_NOW): Promise<Record<string, unknown>> {
    const body = await loadCalendar()(DOMAIN, actor, { from, to }, hrefs(), now);
    return asRecord(body, 'calendar');
}

function expectCalendar(body: Record<string, unknown>, from: Date, to: Date): Record<string, unknown>[] {
    expect(body.view, 'view').to.equal('calendar');
    expect(body.from, 'from').to.equal(from.toISOString());
    expect(body.to, 'to').to.equal(to.toISOString());
    const rows = readRows(body);
    expect(rows.every((row) => row.kind === 'exam' || row.kind === 'homework'), 'row kinds').to.equal(true);
    return rows;
}

async function callGet(actor: Actor, query: CalendarCall) {
    const HandlerClass = routes.training_main;
    expect(typeof HandlerClass, 'training_main').to.equal('function');
    const handler = new HandlerClass();
    handler.user = actor;
    handler.domain = { _id: DOMAIN };
    handler.response = {};
    const requestQuery: Record<string, string> = {};
    if (query.tab !== undefined) requestQuery.tab = query.tab;
    if (query.page !== undefined) requestQuery.page = String(query.page);
    if (query.q !== undefined) requestQuery.q = query.q;
    if (query.type !== undefined) requestQuery.type = query.type;
    if (query.view !== undefined) requestQuery.view = query.view;
    if (query.from !== undefined) requestQuery.from = query.from;
    if (query.to !== undefined) requestQuery.to = query.to;
    handler.request = {
        method: 'get',
        path: '/problem-sets',
        query: requestQuery,
        json: query.json === true,
    };
    // view/from/to stay after the existing optional args so the current positional get() still matches.
    await handler.get(DOMAIN, query.tab, query.page ?? 1, query.q ?? '', query.type, query.view, query.from, query.to);
    return handler.response;
}

async function calendarFromHandler(actor: Actor, from: Date, to: Date): Promise<Record<string, unknown>> {
    const response = await callGet(actor, {
        view: 'calendar',
        from: from.toISOString(),
        to: to.toISOString(),
        json: true,
    });
    return asRecord(response.body, 'body');
}

async function rejection(actor: Actor, query: CalendarCall): Promise<unknown> {
    try {
        await callGet(actor, query);
        return undefined;
    } catch (error) {
        return error;
    }
}

function errorName(error: unknown): string {
    if (!error || typeof error !== 'object' || !('name' in error)) return '';
    return typeof error.name === 'string' ? error.name : '';
}

function errorParam(error: unknown): string {
    if (!error || typeof error !== 'object' || !('params' in error) || !Array.isArray(error.params)) return '';
    return typeof error.params[0] === 'string' ? error.params[0] : '';
}

function expectRangeError(error: unknown): void {
    expect(errorName(error), 'error name').to.equal('ValidationError');
    const field = errorParam(error);
    expect(field === 'from' || field === 'to', field).to.equal(true);
}

function expectFieldError(error: unknown, field: string): void {
    expect(errorName(error), 'error name').to.equal('ValidationError');
    expect(errorParam(error), 'error field').to.equal(field);
}

interface CalendarLogger {
    info: (...args: unknown[]) => void;
}

interface RejectionLog {
    domainId: string;
    uid: string;
    field: string;
    reason: string;
}

function calendarLogger(): CalendarLogger {
    const loaded: unknown = require('../src/logger');
    const record = asRecord(loaded, 'logger');
    const candidate = record.logger;
    if (!candidate || typeof candidate !== 'object' || !('info' in candidate)) {
        throw new TypeError('logger.info is missing');
    }
    const info = (candidate as { info?: unknown }).info;
    if (typeof info !== 'function') throw new TypeError('logger.info is missing');
    return candidate as CalendarLogger;
}

function readRejectionLog(args: readonly unknown[]): RejectionLog | null {
    const joined = args.map((part) => String(part)).join(' ');
    if (!joined.includes('student calendar rejected') || args.length < 5) return null;
    return {
        domainId: String(args[1]),
        uid: String(args[2]),
        field: String(args[3]),
        reason: String(args[4]),
    };
}

function requireLog(log: RejectionLog | null, label: string): RejectionLog {
    expect(log, label).to.not.equal(null);
    if (!log) throw new TypeError(label);
    return log;
}

async function loggedRejection(actor: Actor, query: CalendarCall): Promise<{ error: unknown; log: RejectionLog | null }> {
    const target = calendarLogger();
    const original = target.info;
    let log: RejectionLog | null = null;
    target.info = (...args: unknown[]) => {
        const next = readRejectionLog(args);
        if (next) log = next;
    };
    try {
        return { error: await rejection(actor, query), log };
    } finally {
        target.info = original;
    }
}

describe('student calendar api', { concurrency: false }, () => {
    beforeEach(() => {
        resetStores();
    });

    it('returns visible homework and the paper exam in begin order', async () => {
        const homeworkId = oid(0x11);
        const paperId = oid(0x12);
        const hiddenHomeworkId = oid(0x13);
        const practiceId = oid(0x14);
        const batchId = oid(0x15);
        const homeworkBegin = new Date('2026-10-14T00:00:00.000Z');
        const homeworkEnd = new Date('2026-10-22T00:00:00.000Z');
        const paperBegin = new Date('2026-10-23T19:00:00+08:00');
        const paperEnd = new Date('2026-10-23T21:00:00+08:00');
        contests.push(
            baseContest(paperId, 'exam', '试卷B', OTHER_UID, paperBegin, paperEnd),
            visibleHomework(hiddenHomeworkId, '作业C', homeworkBegin, homeworkEnd, GROUP_B),
            visibleHomework(homeworkId, '作业A', homeworkBegin, homeworkEnd, GROUP_A),
        );
        addTraining(practiceId, '不应出现的练习', 1, 'problem_set', [1]);
        decide(practiceId, true, 'public');
        seedOpenBatch(batchId, '不应出现的组队');
        const loaded = await calendarFromLoader(student(), RANGE_FROM, RANGE_TO);
        const rows = expectCalendar(loaded, RANGE_FROM, RANGE_TO);
        expect(rows.map(rowIdentity)).to.deep.equal([
            { kind: 'homework', id: homeworkId.toHexString() },
            { kind: 'exam', id: paperId.toHexString() },
        ]);
        expect(readString(rows[0], 'flavor')).to.equal('homework');
        expect(readString(rows[0], 'title')).to.equal('作业A');
        expect(readString(rows[0], 'href')).to.equal(`/homework/${homeworkId.toHexString()}`);
        expect(readString(rows[0], 'beginAt')).to.equal(homeworkBegin.toISOString());
        expect(readString(rows[1], 'flavor')).to.equal('paper');
        expect(readString(rows[1], 'title')).to.equal('试卷B');
        expect(readString(rows[1], 'href')).to.equal(`/contest/${paperId.toHexString()}`);
        expect(readString(rows[1], 'beginAt')).to.equal(paperBegin.toISOString());
        const handled = await calendarFromHandler(student(), RANGE_FROM, RANGE_TO);
        expect(expectCalendar(handled, RANGE_FROM, RANGE_TO).map(rowIdentity)).to.deep.equal(rows.map(rowIdentity));
    });

    it('returns the ended homework round and distinguishes a student who never started', async () => {
        const answeredId = oid(0x21);
        const unansweredId = oid(0x22);
        const answered = visibleHomework(
            answeredId,
            '作业D',
            new Date('2026-10-07T00:00:00.000Z'),
            new Date('2026-10-19T23:59:00+08:00'),
            GROUP_A,
        );
        answered.pids = [1];
        const unanswered = visibleHomework(
            unansweredId,
            '作业未交',
            new Date('2026-10-08T00:00:00.000Z'),
            new Date('2026-10-20T00:00:00.000Z'),
            GROUP_A,
        );
        unanswered.pids = [1];
        contests.push(unanswered, answered);
        const round = makeRound(answered, STUDENT_UID, { state: 'closed', closedAt: answered.endAt });
        formal.rounds.push(round);
        formal.submitted.set(round._id.toHexString(), new Set([1]));
        contestStatuses.push({
            domainId: DOMAIN,
            docId: answeredId,
            uid: STUDENT_UID,
            detail: { 1: { score: 1 } },
        });
        const rows = expectCalendar(await calendarFromLoader(student(), RANGE_FROM, RANGE_TO), RANGE_FROM, RANGE_TO);
        expect(rows.map(rowIdentity)).to.deep.equal([
            { kind: 'homework', id: answeredId.toHexString() },
            { kind: 'homework', id: unansweredId.toHexString() },
        ]);
        expect(rows[0].done, 'answered done').to.equal(true);
        expect(rows[0].progress).to.deep.equal({ answered: 1 });
        expect(rows[1].done, 'unanswered done').to.equal(false);
        expect(rows[1].progress).to.deep.equal({ answered: 0 });
    });

    it('omits contests outside the open interval', async () => {
        const includedId = oid(0x31);
        const endsAtFromId = oid(0x32);
        const beginsAtToId = oid(0x33);
        const afterNovemberId = oid(0x34);
        contests.push(
            baseContest(endsAtFromId, 'exam', '刚好结束', OTHER_UID, new Date('2026-10-01T00:00:00.000Z'), RANGE_FROM),
            baseContest(beginsAtToId, 'exam', '刚好开始', OTHER_UID, RANGE_TO, new Date('2026-11-02T00:00:00.000Z')),
            baseContest(afterNovemberId, 'exam', '十一月考试', OTHER_UID, new Date('2026-11-02T00:00:00.000Z'), new Date('2026-11-02T02:00:00.000Z')),
            visibleHomework(includedId, '范围内作业', new Date('2026-10-20T00:00:00.000Z'), new Date('2026-10-21T00:00:00.000Z'), GROUP_A),
        );
        const rows = expectCalendar(await calendarFromLoader(student(), RANGE_FROM, RANGE_TO), RANGE_FROM, RANGE_TO);
        expect(rows.map(rowIdentity)).to.deep.equal([{ kind: 'homework', id: includedId.toHexString() }]);
    });

    it('limits a teacher to the same contest scope as the list', async () => {
        const ownedId = oid(0x41);
        const maintainedId = oid(0x42);
        const courseLinkedId = oid(0x43);
        const otherId = oid(0x44);
        const courseId = oid(0x45);
        const owned = baseContest(ownedId, 'exam', '自己的赛', TEACHER_UID, new Date('2026-10-20T00:00:00.000Z'), new Date('2026-10-20T02:00:00.000Z'));
        const maintained = baseContest(maintainedId, 'homework', '共同维护', OTHER_UID, new Date('2026-10-22T00:00:00.000Z'), new Date('2026-10-22T02:00:00.000Z'));
        maintained.maintainer = [TEACHER_UID];
        const linked = visibleHomework(courseLinkedId, '课程里的作业', new Date('2026-10-21T00:00:00.000Z'), new Date('2026-10-21T02:00:00.000Z'), GROUP_A);
        contests.push(
            baseContest(otherId, 'exam', '别人的赛', OTHER_UID, new Date('2026-10-19T01:00:00.000Z'), new Date('2026-10-19T03:00:00.000Z')),
            linked,
            owned,
            maintained,
        );
        addTraining(courseId, '老师的课程', 1, 'course', [], [courseLinkedId]);
        const rows = expectCalendar(await calendarFromLoader(teacher(), RANGE_FROM, RANGE_TO), RANGE_FROM, RANGE_TO);
        expect(rows.map(rowIdentity)).to.deep.equal([
            { kind: 'exam', id: ownedId.toHexString() },
            { kind: 'homework', id: courseLinkedId.toHexString() },
            { kind: 'homework', id: maintainedId.toHexString() },
        ]);
        const handled = await calendarFromHandler(teacher(), RANGE_FROM, RANGE_TO);
        expect(expectCalendar(handled, RANGE_FROM, RANGE_TO).map(rowIdentity)).to.deep.equal(rows.map(rowIdentity));
    });

    it('returns an in-range programming contest', async () => {
        const acmId = oid(0x51);
        contests.push(baseContest(
            acmId,
            'acm',
            '公开赛',
            OTHER_UID,
            new Date('2026-10-20T00:00:00.000Z'),
            new Date('2026-10-20T03:00:00.000Z'),
        ));
        const rows = expectCalendar(await calendarFromLoader(student(), RANGE_FROM, RANGE_TO), RANGE_FROM, RANGE_TO);
        expect(rows.map(rowIdentity)).to.deep.equal([{ kind: 'exam', id: acmId.toHexString() }]);
        expect(readString(rows[0], 'flavor')).to.equal('acm');
    });

    it('includes published native contests and withholds progress when group access ends', async () => {
        const begin = RANGE_FROM;
        const end = new Date('2026-10-20T00:00:00Z');
        const doc = baseContest(oid(0x52), 'contest', '比赛', OTHER_UID, begin, end);
        doc.setConfig.settings.authorization = { defaults: { ...SET_DEFAULT_PERMISSIONS, afterEnd: false }, groups: [] };
        const draft = { ...doc, docId: oid(0x53), setConfig: { ...doc.setConfig, publication: 'draft' as const } };
        contests.push(doc, draft, { ...doc, docId: oid(0x54), setConfig: undefined });
        formal.rounds.push(makeRound(doc, STUDENT_UID, { state: 'closed', closedAt: end, total: 100 }));
        const rows = expectCalendar(await calendarFromLoader(student(), RANGE_FROM, RANGE_TO), RANGE_FROM, RANGE_TO);
        expect(rows.map(rowIdentity)).to.deep.equal([{ kind: 'exam', id: doc.docId.toHexString() }]);
        expect(rows[0]).to.include({ purpose: 'contest', problemAccess: 'hidden', progress: null });
    });

    it('sorts contests with the same begin time by title', async () => {
        const laterTitleId = oid(0x61);
        const earlierTitleId = oid(0x62);
        const beginAt = new Date('2026-10-20T00:00:00.000Z');
        const endAt = new Date('2026-10-21T00:00:00.000Z');
        contests.push(
            visibleHomework(laterTitleId, 'B场', beginAt, endAt, GROUP_A),
            visibleHomework(earlierTitleId, 'A场', beginAt, endAt, GROUP_A),
        );
        const rows = expectCalendar(await calendarFromLoader(student(), RANGE_FROM, RANGE_TO), RANGE_FROM, RANGE_TO);
        expect(rows.map((row) => readString(row, 'title'))).to.deep.equal(['A场', 'B场']);
        expect(rows.map(rowIdentity)).to.deep.equal([
            { kind: 'homework', id: earlierTitleId.toHexString() },
            { kind: 'homework', id: laterTitleId.toHexString() },
        ]);
    });

    it('counts formal answers and submissions on the same paper as the list', async () => {
        const paperId = oid(0x71);
        const paper = baseContest(
            paperId,
            'exam',
            '进行中的试卷',
            OTHER_UID,
            new Date('2026-10-20T00:00:00.000Z'),
            new Date('2026-10-22T00:00:00.000Z'),
        );
        paper.pids = [1, 2, 3];
        contests.push(paper);
        contestStatuses.push({
            domainId: DOMAIN,
            docId: paperId,
            uid: STUDENT_UID,
            attend: 1,
            startAt: new Date('2026-10-20T01:00:00.000Z'),
        });
        const round = makeRound(paper, STUDENT_UID, { paperPids: [1, 3], detail: {
            1: { pid: 1, score: 0, status: 1, acceptedAt: paper.beginAt },
        } });
        formal.rounds.push(round);
        formal.submitted.set(round._id.toHexString(), new Set([1, 3]));
        drafts.push(
            { domainId: DOMAIN, tid: paperId, uid: STUDENT_UID, pid: 1 },
            { domainId: DOMAIN, tid: paperId, uid: STUDENT_UID, pid: 2 },
            { domainId: DOMAIN, tid: paperId, uid: STUDENT_UID, pid: 99 },
        );
        const rows = expectCalendar(await calendarFromLoader(student(), RANGE_FROM, RANGE_TO), RANGE_FROM, RANGE_TO);
        expect(rows.map(rowIdentity)).to.deep.equal([{ kind: 'exam', id: paperId.toHexString() }]);
        expect(readString(rows[0], 'flavor')).to.equal('paper');
        expect(rows[0].problemCount).to.equal(2);
        expect(rows[0].startAt).to.equal(paper.beginAt.toISOString());
        expect(rows[0].progress).to.deep.equal({ answered: 2 });
    });

    it('rejects an inverted range, a 43 day span, a bad from, and a missing to', async () => {
        const from = RANGE_FROM.toISOString();
        const sameInstant = await rejection(student(), { view: 'calendar', from, to: from, json: true });
        expectRangeError(sameInstant);
        const earlierTo = new Date(RANGE_FROM.getTime() - DAY_MS).toISOString();
        expectRangeError(await rejection(student(), { view: 'calendar', from, to: earlierTo, json: true }));
        const tooWide = new Date(RANGE_FROM.getTime() + 43 * DAY_MS).toISOString();
        expectRangeError(await rejection(student(), { view: 'calendar', from, to: tooWide, json: true }));
        expectFieldError(await rejection(student(), {
            view: 'calendar',
            from: 'not-a-date',
            to: RANGE_TO.toISOString(),
            json: true,
        }), 'from');
        expectFieldError(await rejection(student(), {
            view: 'calendar',
            from,
            json: true,
        }), 'to');
    });

    it('rejects a missing from', async () => {
        expectFieldError(await rejection(student(), {
            view: 'calendar',
            to: RANGE_TO.toISOString(),
            json: true,
        }), 'from');
    });

    it('accepts a span of exactly 42 days', async () => {
        const from = new Date('2026-10-01T00:00:00.000Z');
        const to = new Date(from.getTime() + 42 * DAY_MS);
        const homeworkId = oid(0x81);
        contests.push(visibleHomework(
            homeworkId,
            '四十二天里的作业',
            new Date('2026-10-02T00:00:00.000Z'),
            new Date('2026-10-03T00:00:00.000Z'),
            GROUP_A,
        ));
        const rows = expectCalendar(await calendarFromHandler(student(), from, to), from, to);
        expect(rows.map(rowIdentity)).to.deep.equal([{ kind: 'homework', id: homeworkId.toHexString() }]);
    });

    it('redirects a browser calendar request', async () => {
        const response = await callGet(student(), {
            view: 'calendar',
            from: RANGE_FROM.toISOString(),
            to: RANGE_TO.toISOString(),
        });
        expect(response.redirect, 'redirect').to.equal('/problem-sets');
    });

    it('rejects a view other than calendar', async () => {
        expectFieldError(await rejection(student(), { view: 'list' }), 'view');
    });

    it('keeps the four tab body when view is absent', async () => {
        const now = new Date();
        const homeworkId = oid(0x91);
        contests.push(visibleHomework(homeworkId, '本组作业', hoursFrom(now, -2), hoursFrom(now, 1), GROUP_A));
        const response = await callGet(student(), {});
        const body = asRecord(response.body, 'body');
        expect(response.template, 'template').to.equal('student_sets.html');
        expect(body.view, 'view').to.equal(undefined);
        expect(readString(body, 'tab')).to.equal('running');
        expect(readRows(body).map(rowIdentity)).to.deep.equal([{ kind: 'homework', id: homeworkId.toHexString() }]);
        expect(body.counts).to.deep.equal({ running: 1, upcoming: 0, practice: 0 });
        expect(body.practice).to.equal(null);
        expect(body.ended).to.equal(null);
    });

    it('keeps the four tab body when view is empty', async () => {
        const now = new Date();
        const homeworkId = oid(0x92);
        contests.push(visibleHomework(homeworkId, '本组作业', hoursFrom(now, -2), hoursFrom(now, 1), GROUP_A));
        const response = await callGet(student(), { view: '' });
        const body = asRecord(response.body, 'body');
        expect(response.template, 'template').to.equal('student_sets.html');
        expect(body.view, 'view').to.equal(undefined);
        expect(readString(body, 'tab')).to.equal('running');
        expect(readRows(body).map(rowIdentity)).to.deep.equal([{ kind: 'homework', id: homeworkId.toHexString() }]);
    });

    it('rejects a view that is not exactly calendar', async () => {
        expectFieldError(await rejection(student(), {
            view: 'Calendar',
            from: RANGE_FROM.toISOString(),
            to: RANGE_TO.toISOString(),
            json: true,
        }), 'view');
    });

    it('redirects a browser calendar request without building the calendar body', async () => {
        const response = await callGet(student(), {
            view: 'calendar',
            from: RANGE_FROM.toISOString(),
            to: RANGE_TO.toISOString(),
        });
        expect(response.redirect, 'redirect').to.equal('/problem-sets');
        expect(response.body, 'body').to.equal(undefined);
    });

    it('logs the domain, the uid, and a different reason for a blank bound than for an unparseable bound', async () => {
        const missing = await loggedRejection(student(), {
            view: 'calendar',
            from: RANGE_FROM.toISOString(),
            json: true,
        });
        expectFieldError(missing.error, 'to');
        const missingLog = requireLog(missing.log, 'missing log');
        expect(missingLog.domainId, 'domain').to.equal(DOMAIN);
        expect(missingLog.uid, 'uid').to.equal(String(STUDENT_UID));
        expect(missingLog.field, 'field').to.equal('to');
        expect(missingLog.reason.length > 0, 'reason').to.equal(true);

        const blank = await loggedRejection(student(), {
            view: 'calendar',
            from: '   ',
            to: RANGE_TO.toISOString(),
            json: true,
        });
        expectFieldError(blank.error, 'from');
        const blankLog = requireLog(blank.log, 'blank log');
        expect(blankLog.domainId, 'blank domain').to.equal(DOMAIN);
        expect(blankLog.uid, 'blank uid').to.equal(String(STUDENT_UID));
        expect(blankLog.field, 'blank field').to.equal('from');
        expect(blankLog.reason, 'blank reason').to.equal(missingLog.reason);

        const unparsed = await loggedRejection(student(), {
            view: 'calendar',
            from: 'not-a-date',
            to: RANGE_TO.toISOString(),
            json: true,
        });
        expectFieldError(unparsed.error, 'from');
        const unparsedLog = requireLog(unparsed.log, 'unparsed log');
        expect(unparsedLog.field, 'unparsed field').to.equal('from');
        expect(unparsedLog.reason, 'unparsed reason').to.not.equal(blankLog.reason);
    });

    it('lets a homework editor see homework outside their groups without seeing a hidden contest', async () => {
        const homeworkId = oid(0xc3);
        const hiddenContestId = oid(0xc4);
        const hidden = baseContest(
            hiddenContestId,
            'exam',
            '隐藏考试',
            OTHER_UID,
            new Date('2026-10-20T00:00:00.000Z'),
            new Date('2026-10-21T00:00:00.000Z'),
        );
        hidden.hidden = true;
        contests.push(
            hidden,
            visibleHomework(
                homeworkId,
                '别组作业',
                new Date('2026-10-20T01:00:00.000Z'),
                new Date('2026-10-21T00:00:00.000Z'),
                GROUP_B,
            ),
        );
        const rows = expectCalendar(await calendarFromLoader(homeworkEditor(), RANGE_FROM, RANGE_TO), RANGE_FROM, RANGE_TO);
        expect(rows.map(rowIdentity)).to.deep.equal([{ kind: 'homework', id: homeworkId.toHexString() }]);
    });
});
