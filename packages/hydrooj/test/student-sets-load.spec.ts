import { beforeEach, describe, it } from 'node:test';
import { expect } from 'chai';
import { escapeRegExp } from 'lodash';
import { ObjectId } from 'mongodb';
import { SET_DEFAULT_PERMISSIONS, SET_EXPERIENCE_DEFAULTS, type SetConfig } from '@hydrooj/common';
import { makeRound, publishedConfig, roundStore } from './helpers/student-set-rounds';
import type { StudentDirectory, StudentDirectoryStudent } from '../src/service/student-directory';

const hydroGlobal = globalThis as unknown as { Hydro?: { model: Record<string, unknown>; module: Record<string, unknown>; ui: Record<string, unknown> } };
hydroGlobal.Hydro ||= { model: {}, module: {}, ui: {} };

const { PERM, PRIV } = require('../src/model/builtin') as {
    PERM: Record<string, bigint>;
    PRIV: Record<string, number>;
};
const {
    listAccessQuery,
    parentSchoolIdsFromUser,
    resolveContestListParticipantScope,
} = require('../src/lib/contest-list-access') as {
    listAccessQuery: (uid: number, groups: string[], canBrowseRestricted: boolean, scope?: unknown) => Query;
    parentSchoolIdsFromUser: (user: unknown) => ObjectId[];
    resolveContestListParticipantScope: (
        domainId: string,
        uid: number,
        canBrowseRestricted: boolean,
        parentSchoolIds?: readonly unknown[] | null,
    ) => Promise<unknown>;
};
const { isProblemSetKind, withProblemSetKind } = require('../src/lib/training-kind') as {
    isProblemSetKind: (kind: unknown) => boolean;
    withProblemSetKind: (filter: Query) => Query;
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
const OTHER_UID = 99;
const PRACTICE_PAGE_SIZE = 20;

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
    accept?: number;
    score?: number;
    paperFinalizedAt?: Date;
    examPaperPids?: number[];
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

interface TeamDoc {
    domainId: string;
    batchId: ObjectId;
    teamId: ObjectId;
    memberUids: number[];
    active: boolean;
}

interface InviteDoc {
    domainId: string;
    batchId: ObjectId;
    inviteId: ObjectId;
    inviteeUid: number;
    status: 'pending' | 'accepted';
}

interface TrainingDoc {
    _id: ObjectId;
    docId: ObjectId;
    domainId: string;
    docType: number;
    kind: string;
    title: string;
    owner: number;
    pin: number;
    dag: Array<{ _id: number; title: string; requireNids: number[]; pids: number[] }>;
}

interface PracticeStatus {
    domainId: string;
    docId: ObjectId;
    uid: number;
    enroll?: number;
    donePids?: number[];
    contextualProgress?: { completedProblemCount?: number };
}

interface PracticeDecision {
    discoverable: boolean;
    accessible: boolean;
    enrolled: boolean;
    sources: Array<{ kind: string }>;
    stageAccess: 'all';
}

interface ScopedProgress {
    completedProblemCount: number;
    totalProblemCount: number;
    doneNids: number[];
    done: boolean;
    nsdict: Record<string, never>;
}

interface PracticeListRow {
    id: string;
    doneCount: number;
    sourceLabel: string;
    stages: { status: string }[];
}

interface PracticeListPage {
    rows: PracticeListRow[];
}

type LoadPracticeList = (domainId: string, actor: Actor, query: { q?: string; page?: number }) => Promise<PracticeListPage>;

interface LaneHandler {
    user: Actor;
    domain: { _id: string };
    ctx: {
        parallel: (...args: unknown[]) => Promise<void>;
        setting: { get: (key: string) => unknown };
    };
    request: { method: string; path: string; query: Record<string, string> };
    response: { template?: string; body?: unknown };
    url: (name: string, args?: Record<string, unknown>) => string;
    get: (domainId: string, tab?: string, page?: number, q?: string, type?: string) => Promise<void>;
}

const contests: ContestDoc[] = [];
const formal = roundStore();
const contestTeams = new Map<string, { teamId: ObjectId; memberUids: number[] }>();
const contestStatuses: ContestStatusDoc[] = [];
const drafts: DraftDoc[] = [];
const batches: BatchDoc[] = [];
const teams: TeamDoc[] = [];
const invites: InviteDoc[] = [];
const trainings: TrainingDoc[] = [];
const practiceStatuses: PracticeStatus[] = [];
const practiceVerdicts = new Map<number, number>();
const practiceDecisions = new Map<string, PracticeDecision>();
const publishedPractice = new Set<string>();
const contextualDone = new Map<string, Map<number, Set<number>>>();

const GROUP_A = oid(0xa1);
const GROUP_B = oid(0xb2);
const routes: Record<string, new () => LaneHandler> = {};

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
    teams.length = 0;
    invites.length = 0;
    trainings.length = 0;
    practiceStatuses.length = 0;
    practiceVerdicts.clear();
    practiceDecisions.clear();
    publishedPractice.clear();
    contextualDone.clear();
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
    const matched = practiceStatuses.filter((status) => (
        matchQuery(status as unknown as Record<string, unknown>, { domainId, ...query })
    ));
    return cursorOf(matched);
}

async function trainingGetList(domainId: string, tids: ObjectId[]) {
    const rows = await trainingGetMulti(domainId, { _id: { $in: tids } }).toArray();
    const result: Record<string, TrainingDoc> = {};
    for (const row of rows) result[row.docId.toHexString()] = row;
    return result;
}

function buildScopedTrainingProgress(
    tdoc: { dag?: Array<{ _id: number; pids?: number[] }> },
    doneByScope: ReadonlyMap<number, ReadonlySet<number>>,
): ScopedProgress {
    let completedProblemCount = 0;
    let totalProblemCount = 0;
    const doneNids: number[] = [];
    for (const node of tdoc.dag ?? []) {
        const pids = new Set(node.pids ?? []);
        totalProblemCount += pids.size;
        const done = doneByScope.get(node._id) ?? new Set<number>();
        let count = 0;
        for (const pid of pids) {
            if (done.has(pid)) count += 1;
        }
        completedProblemCount += count;
        if (pids.size > 0 && count === pids.size) doneNids.push(node._id);
    }
    const stageCount = tdoc.dag?.length ?? 0;
    return {
        completedProblemCount,
        totalProblemCount,
        doneNids,
        done: stageCount > 0 && doneNids.length === stageCount,
        nsdict: {},
    };
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

async function getLatestPublished(domainId: string, _kind: string, containerId: ObjectId) {
    if (domainId !== DOMAIN || !publishedPractice.has(containerId.toHexString())) return null;
    return { revision: 1, state: 'published' };
}

async function getCompletedByScope(domainId: string, uid: number, _kind: string, containerId: ObjectId) {
    if (domainId !== DOMAIN || uid !== STUDENT_UID) return new Map<number, Set<number>>();
    return contextualDone.get(containerId.toHexString()) ?? new Map<number, Set<number>>();
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

function hoursFrom(now: Date, hours: number): Date {
    return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

function minutesAgo(now: Date, minutes: number): Date {
    return new Date(now.getTime() - minutes * 60 * 1000);
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
            listAccessQuery,
            resolveContestListParticipantScope,
            parentSchoolIdsFromUser,
            getParticipationMode: (tdoc: { participationMode?: string }) => (tdoc.participationMode === 'team' ? 'team' : 'individual'),
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
        const userModel = {
            async listGroup(domainId: string, uid?: number) {
                const groups = uid === STUDENT_UID ? [{ name: 'class-a', uids: [STUDENT_UID] }] : [];
                if (typeof uid === 'number') groups.push({ name: String(uid), uids: [uid] });
                return groups.map((group) => ({ ...group, domainId, _id: oid(0xee) }));
            },
        };
        return userModel;
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
            coll: {
                find(query: Query) {
                    return cursorOf(drafts.filter((draft) => matchQuery(draft as unknown as Record<string, unknown>, query)));
                },
                async countDocuments(query: Query) {
                    return drafts.filter((draft) => matchQuery(draft as unknown as Record<string, unknown>, query)).length;
                },
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
            async listBatches(domainId: string) {
                return batches.filter((batch) => batch.domainId === domainId);
            },
            async getTeamByMember(domainId: string, batchId: ObjectId, uid: number) {
                return teams.find((team) => (
                    team.domainId === domainId && team.batchId.equals(batchId) && team.active && team.memberUids.includes(uid)
                )) ?? null;
            },
            getMultiTeam(domainId: string, batchId: ObjectId, query: Query = {}) {
                return cursorOf(teams.filter((team) => (
                    matchQuery(team as unknown as Record<string, unknown>, { ...query, domainId, batchId, active: true })
                )));
            },
            getPendingInvitesForUser(domainId: string, batchId: ObjectId, inviteeUid: number) {
                return cursorOf(invites.filter((invite) => (
                    invite.domainId === domainId
                    && invite.batchId.equals(batchId)
                    && invite.inviteeUid === inviteeUid
                    && invite.status === 'pending'
                )));
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
    if (isMod(request, 'model/problem')) {
        return {
            assertProblemAclDomain() { return undefined; },
            getListStatus: async (_domain: string, uid: number, pids: number[]) => Object.fromEntries(
                pids.filter((pid) => uid === STUDENT_UID && practiceVerdicts.has(pid)).map((pid) => [pid, { status: practiceVerdicts.get(pid) }]),
            ),
        };
    }
    if (isMod(request, 'model/problem-access')) return { assertProblemBankSelection: async () => undefined };
    if (isMod(request, 'model/storage')) return {};
    if (isMod(request, 'model/system')) return { get: () => undefined };
    if (isMod(request, 'model/oplog')) return { async log() { return undefined; } };
    if (isMod(request, 'handler/problem-reference') || isMod(request, 'problem-reference')) {
        return {
            getVisibleReferencedProblems: async (_domain: string, pids: number[]) => Object.fromEntries(pids.map((pid) => [pid, { docId: pid }])),
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
        throw new Error('exam roster is not used by student sets');
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

function addTraining(id: ObjectId, title: string, pin: number, kind: string, pids: number[]): void {
    trainings.push({
        _id: id,
        docId: id,
        domainId: DOMAIN,
        docType: 40,
        kind,
        title,
        owner: OTHER_UID,
        pin,
        dag: [{ _id: 1, title: '阶段', requireNids: [], pids }],
    });
}

function seedPractice(): { first: ObjectId; enrolled: ObjectId } {
    const first = oid(11);
    const hidden = oid(12);
    const contextual = oid(13);
    const enrolled = oid(14);
    practiceVerdicts.set(4, 1);
    practiceVerdicts.set(8, 1);
    practiceVerdicts.set(9, 2);
    const course = oid(15);
    addTraining(course, '甲乙丙课程', 50, 'course', [1]);
    addTraining(first, '甲乙丙入门', 40, 'problem_set', [8, 9]);
    addTraining(hidden, '甲乙丙提高', 30, 'problem_set', [3]);
    addTraining(contextual, '图论专题', 20, 'problem_set', [10]);
    addTraining(enrolled, '字符串基础', 10, 'problem_set', [4]);
    decide(course, true, 'course');
    decide(first, true, 'public');
    decide(hidden, false, 'public');
    decide(contextual, true, 'course');
    decide(enrolled, true, 'group');
    practiceStatuses.push(
        { domainId: DOMAIN, docId: first, uid: STUDENT_UID, enroll: 0, donePids: [8, 9, 100] },
        { domainId: DOMAIN, docId: enrolled, uid: STUDENT_UID, enroll: 1, donePids: [4, 5] },
    );
    publishedPractice.add(contextual.toHexString());
    contextualDone.set(contextual.toHexString(), new Map([[1, new Set([10])]]));
    return { first, enrolled };
}

function completedCount(status: PracticeStatus | undefined): number {
    const contextual = status?.contextualProgress;
    if (contextual) {
        const count = contextual.completedProblemCount;
        if (count !== undefined && Number.isSafeInteger(count) && count >= 0) return count;
        return 0;
    }
    return Array.isArray(status?.donePids) ? status.donePids.length : 0;
}

async function legacyPractice(actor: Actor, q: string, page: number): Promise<{ ids: string[]; doneCounts: number[] }> {
    const query = withProblemSetKind(q ? { title: { $regex: new RegExp(escapeRegExp(q), 'i') } } : {}) as Query;
    const listed = await trainingGetMulti(DOMAIN, query).toArray();
    const tsdocs: PracticeStatus[] = [];
    let extraDocs: TrainingDoc[] = [];
    if (actor.hasPriv(PRIV.PRIV_USER_PROFILE)) {
        const listedIds = new Set(listed.map((tdoc) => tdoc.docId.toHexString()));
        const found = await trainingGetMultiStatus(DOMAIN, {
            uid: actor._id,
            $or: [{ docId: { $in: listed.map((tdoc) => tdoc.docId) } }, { enroll: 1 }],
        }).toArray();
        tsdocs.push(...found);
        const extraIds = found
            .filter((status) => !listedIds.has(status.docId.toHexString()) && status.enroll === 1)
            .map((status) => status.docId);
        if (extraIds.length) {
            const listedExtras = await trainingGetList(DOMAIN, extraIds);
            extraDocs = Object.values(listedExtras).filter((tdoc) => isProblemSetKind(tdoc.kind));
        }
    }
    const decisions = await evaluateMany(DOMAIN, actor, [...listed, ...extraDocs]);
    const discoverableListed = listed.filter((tdoc) => decisions.get(tdoc.docId.toHexString())?.discoverable);
    const tdocs = discoverableListed.slice((page - 1) * PRACTICE_PAGE_SIZE, page * PRACTICE_PAGE_SIZE);
    for (const extra of extraDocs) {
        if (!decisions.get(extra.docId.toHexString())?.discoverable) continue;
        if (tdocs.some((tdoc) => tdoc.docId.equals(extra.docId))) continue;
        tdocs.push(extra);
    }
    const statusById = new Map(tsdocs.map((status) => [status.docId.toHexString(), status]));
    if (actor.hasPriv(PRIV.PRIV_USER_PROFILE)) {
        for (const tdoc of tdocs) {
            const published = await getLatestPublished(DOMAIN, 'problemSet', tdoc.docId);
            if (!published) continue;
            const doneByScope = await getCompletedByScope(DOMAIN, actor._id, 'problemSet', tdoc.docId);
            const current = statusById.get(tdoc.docId.toHexString());
            statusById.set(tdoc.docId.toHexString(), {
                domainId: DOMAIN,
                docId: tdoc.docId,
                uid: actor._id,
                enroll: current?.enroll,
                donePids: current?.donePids,
                contextualProgress: buildScopedTrainingProgress(tdoc, doneByScope),
            });
        }
    }
    return {
        ids: tdocs.map((tdoc) => tdoc.docId.toHexString()),
        doneCounts: tdocs.map((tdoc) => completedCount(statusById.get(tdoc.docId.toHexString()))),
    };
}

function loadPracticeList(): LoadPracticeList {
    let resolved = '';
    try {
        resolved = require.resolve('../src/lib/practice-list.ts');
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        expect(code, 'loadPracticeList').to.equal('');
        throw error;
    }
    const loaded: unknown = require(resolved);
    const record = asRecord(loaded, 'practice-list');
    expect(typeof record.loadPracticeList, 'loadPracticeList').to.equal('function');
    return record.loadPracticeList as LoadPracticeList;
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

async function callGet(actor: Actor, query: { tab?: string; page?: number; q?: string; type?: string }) {
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
    handler.request = { method: 'get', path: '/problem-sets', query: requestQuery };
    await handler.get(DOMAIN, query.tab, query.page ?? 1, query.q ?? '', query.type);
    return handler.response;
}

async function rejection(actor: Actor, query: { tab?: string; page?: number; q?: string; type?: string }): Promise<unknown> {
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
    invites.push(
        { domainId: DOMAIN, batchId, inviteId: oid(0xc1), inviteeUid: STUDENT_UID, status: 'pending' },
        { domainId: DOMAIN, batchId, inviteId: oid(0xc2), inviteeUid: STUDENT_UID, status: 'pending' },
        { domainId: DOMAIN, batchId, inviteId: oid(0xc3), inviteeUid: STUDENT_UID, status: 'accepted' },
    );
}

describe('student sets loader and route', { concurrency: false }, () => {
    beforeEach(() => {
        resetStores();
    });

    it('shows a student the running contests and homework in their groups', async () => {
        const now = new Date();
        const teamId = oid(301);
        const homeworkId = oid(302);
        const acmId = oid(303);
        const otherHomeworkId = oid(304);
        const unscopedHomeworkId = oid(305);
        const closedId = oid(306);
        contests.push(
            baseContest(acmId, 'acm', '公开赛', OTHER_UID, hoursFrom(now, -2), hoursFrom(now, 4)),
            visibleHomework(homeworkId, '本组作业', hoursFrom(now, -2), hoursFrom(now, 1), GROUP_A),
            visibleHomework(otherHomeworkId, '别组作业', hoursFrom(now, -2), hoursFrom(now, 1), GROUP_B),
            baseContest(unscopedHomeworkId, 'homework', '未分组作业', OTHER_UID, hoursFrom(now, -2), hoursFrom(now, 1)),
        );
        seedOpenBatch(teamId, '算法组队');
        batches.push({
            domainId: DOMAIN,
            batchId: closedId,
            _id: closedId,
            title: '已关闭组队',
            description: '已结束',
            status: 'closed',
            createdBy: OTHER_UID,
        });
        const response = await callGet(student(), { tab: 'running' });
        const body = asRecord(response.body, 'body');
        const rows = readRows(body);
        expect(readString(body, 'tab')).to.equal('running');
        expect(rows.map(rowIdentity)).to.deep.equal([
            { kind: 'team', id: teamId.toHexString() },
            { kind: 'homework', id: homeworkId.toHexString() },
            { kind: 'exam', id: acmId.toHexString() },
        ]);
        const team = rows[0];
        expect(readString(team, 'myState')).to.equal('invited');
        expect(team.inviteCount).to.equal(2);
        expect(team.memberCount).to.equal(null);
        expect(readString(team, 'href')).to.equal(`/teams/${teamId.toHexString()}`);
        expect(readString(rows[1], 'flavor')).to.equal('homework');
        expect(readString(rows[1], 'href')).to.equal(`/homework/${homeworkId.toHexString()}`);
        expect(readString(rows[2], 'flavor')).to.equal('acm');
        expect(readString(rows[2], 'href')).to.equal(`/contest/${acmId.toHexString()}`);
        expect(body.counts).to.deep.equal({ running: 3, upcoming: 0, practice: 0 });
        expect(body.practice).to.equal(null);
        expect(body.ended).to.equal(null);
        expect(response.template).to.equal('student_sets.html');
    });

    it('hides other people contests and team rows from a teacher', async () => {
        const now = new Date();
        const ownId = oid(401);
        const otherId = oid(402);
        const teamId = oid(403);
        contests.push(
            baseContest(otherId, 'acm', '别人的公开赛', OTHER_UID, hoursFrom(now, -1), hoursFrom(now, 2)),
            { ...baseContest(ownId, 'acm', '自己的赛', TEACHER_UID, hoursFrom(now, -1), hoursFrom(now, 3)) },
        );
        seedOpenBatch(teamId, '老师不看的组队');
        const response = await callGet(teacher(), { tab: 'running' });
        const body = asRecord(response.body, 'body');
        expect(readRows(body).map(rowIdentity)).to.deep.equal([{ kind: 'exam', id: ownId.toHexString() }]);
        expect(body.counts).to.deep.equal({ running: 1, upcoming: 0, practice: 0 });
    });

    it('returns the second page of ended homework', async () => {
        const now = new Date();
        const runningId = oid(1900);
        const practiceId = oid(1901);
        contests.push(baseContest(runningId, 'acm', '仍在进行', OTHER_UID, hoursFrom(now, -1), hoursFrom(now, 2)));
        contests.push(baseContest(oid(1902), 'exam', '刚结束的试卷', OTHER_UID, minutesAgo(now, 30), minutesAgo(now, 1)));
        contests.push(baseContest(oid(1903), 'exam', '更早的试卷', OTHER_UID, minutesAgo(now, 40), minutesAgo(now, 2)));
        contests.push(visibleHomework(oid(1904), '别组已结束', minutesAgo(now, 50), minutesAgo(now, 3), GROUP_B));
        contests.push(baseContest(oid(1905), 'homework', '未分组已结束', OTHER_UID, minutesAgo(now, 60), minutesAgo(now, 4)));
        for (let index = 0; index < 45; index += 1) {
            contests.push(visibleHomework(
                oid(2000 + index),
                `作业${index}`,
                minutesAgo(now, 2000 + index),
                minutesAgo(now, 10 + index),
                GROUP_A,
            ));
        }
        addTraining(practiceId, '计数练习', 1, 'problem_set', [1]);
        decide(practiceId, true, 'public');
        const response = await callGet(student(), { tab: 'ended', type: 'homework', page: 2 });
        const body = asRecord(response.body, 'body');
        const ended = asRecord(body.ended, 'ended');
        expect(readString(body, 'tab')).to.equal('ended');
        expect(body.rows).to.deep.equal([]);
        expect(ended.total).to.equal(45);
        expect(ended.page).to.equal(2);
        expect(ended.pageCount).to.equal(3);
        expect(ended.type).to.equal('homework');
        expect(ended.q).to.equal('');
        const endedRows = ended.rows;
        expect(Array.isArray(endedRows), 'ended.rows').to.equal(true);
        const rows = (endedRows as unknown[]).map((row, index) => asRecord(row, `ended.rows[${index}]`));
        expect(rows.map(rowIdentity)).to.deep.equal(Array.from({ length: 20 }, (_item, offset) => ({
            kind: 'homework',
            id: oid(2000 + 20 + offset).toHexString(),
        })));
        expect(body.counts).to.deep.equal({ running: 1, upcoming: 0, practice: 1 });
    });

    it('selects upcoming when running is empty', async () => {
        const now = new Date();
        const upcomingId = oid(501);
        contests.push(baseContest(upcomingId, 'acm', '即将开始', OTHER_UID, hoursFrom(now, 5), hoursFrom(now, 8)));
        contests.push(baseContest(oid(502), 'acm', '已经结束', OTHER_UID, hoursFrom(now, -8), hoursFrom(now, -1)));
        const response = await callGet(student(), {});
        const body = asRecord(response.body, 'body');
        expect(readString(body, 'tab')).to.equal('upcoming');
        expect(readRows(body).map(rowIdentity)).to.deep.equal([{ kind: 'exam', id: upcomingId.toHexString() }]);
        expect(body.counts).to.deep.equal({ running: 0, upcoming: 1, practice: 0 });
    });

    it('uses current problem verdicts for stage blocks despite stale enrollment snapshots', async () => {
        const seeded = seedPractice();
        const expected = await legacyPractice(student(), '甲乙丙', 1);
        expect(expected.ids).to.deep.equal([seeded.first.toHexString(), seeded.enrolled.toHexString()]);
        expect(expected.doneCounts).to.deep.equal([3, 2]);
        const page = await loadPracticeList()(DOMAIN, student(), { q: '甲乙丙', page: 1 });
        expect(page.rows.map((row) => row.id)).to.deep.equal(expected.ids);
        expect(page.rows.map((row) => row.doneCount)).to.deep.equal([1, 1]);
        expect(page.rows.map((row) => row.stages[0].status)).to.deep.equal(['progress', 'done']);
        expect(page.rows.map((row) => row.sourceLabel)).to.deep.equal(['全站公开', '用户组']);
        practiceVerdicts.set(9, 1);
        const updated = await loadPracticeList()(DOMAIN, student(), { q: '甲乙丙', page: 1 });
        expect(updated.rows[0].doneCount).to.equal(2);
        expect(updated.rows[0].stages[0].status).to.equal('done');
    });

    it('returns those practice rows from the problem set route', async () => {
        seedPractice();
        const expected = await legacyPractice(student(), '甲乙丙', 1);
        const response = await callGet(student(), { tab: 'practice', q: '甲乙丙', page: 1 });
        const body = asRecord(response.body, 'body');
        const rows = readRows(body);
        expect(readString(body, 'tab')).to.equal('practice');
        expect(rows.map((row) => row.id)).to.deep.equal(expected.ids);
        expect(rows.map((row) => row.doneCount)).to.deep.equal([1, 1]);
        expect(rows.map((row) => readString(row, 'href'))).to.deep.equal(expected.ids.map((id) => `/problem-sets/${id}`));
        expect(response.template).to.equal('student_sets.html');
    });

    it('counts only formal answers and submissions from the current paper', async () => {
        const now = new Date();
        const paperId = oid(601);
        const paper = baseContest(paperId, 'exam', '进行中的试卷', OTHER_UID, hoursFrom(now, -1), hoursFrom(now, 2));
        paper.pids = [1, 2, 3];
        contests.push(paper);
        contestStatuses.push({
            domainId: DOMAIN,
            docId: paperId,
            uid: STUDENT_UID,
            attend: 1,
            startAt: minutesAgo(now, 20),
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
        const response = await callGet(student(), { tab: 'running' });
        const rows = readRows(asRecord(response.body, 'body'));
        expect(rows.map(rowIdentity)).to.deep.equal([{ kind: 'exam', id: paperId.toHexString() }]);
        expect(readString(rows[0], 'flavor')).to.equal('paper');
        expect(rows[0].problemCount).to.equal(2);
        expect(rows[0].startAt).to.equal(paper.beginAt.toISOString());
        expect(rows[0].progress).to.deep.equal({ answered: 2 });
    });

    it('lists published native contests and uses the current retake and its own time limit', async () => {
        const now = new Date();
        const doc = baseContest(oid(610), 'contest', '新比赛', OTHER_UID, hoursFrom(now, -3), hoursFrom(now, 3));
        doc.setConfig.settings.personalLimit.hours = 1;
        const draft = baseContest(oid(611), 'contest', '草稿', OTHER_UID, doc.beginAt, doc.endAt);
        draft.setConfig.publication = 'draft';
        const old = { ...doc, docId: oid(612), setConfig: undefined };
        contests.push(doc, draft, old, { ...doc, docId: oid(613), hidden: true });
        const first = makeRound(doc, STUDENT_UID, { state: 'closed', closedAt: hoursFrom(now, -1), total: 100 });
        const second = makeRound(doc, STUDENT_UID, { roundNo: 2, startedAt: minutesAgo(now, 10), paperPids: [2, 4] });
        formal.rounds.push(first, second);
        formal.submitted.set(second._id.toHexString(), new Set([4]));
        const [row, ...rest] = readRows(asRecord((await callGet(student(), { tab: 'running' })).body, 'body'));
        expect(rest).to.have.length(0);
        expect(row).to.include({ id: doc.docId.toHexString(), purpose: 'contest', flavor: 'ioi', attended: true, finalized: false,
            startAt: second.startedAt.toISOString(), personalEndAt: hoursFrom(second.startedAt, 1).toISOString(), problemCount: 2 });
        expect(row.progress).to.deep.equal({ answered: 1 });
    });

    it('projects ended totals from the selected whole round and enforces feedback and group permissions', async () => {
        const now = new Date();
        const doc = baseContest(oid(620), 'contest', '成绩', OTHER_UID, hoursFrom(now, -3), hoursFrom(now, -1));
        contests.push(doc);
        contestStatuses.push({ domainId: DOMAIN, uid: STUDENT_UID, docId: doc.docId, attend: 1, score: 999 });
        const result = async () => {
            const { body } = await callGet(student(), { tab: 'ended', type: 'exam' });
            const ended = asRecord(asRecord(body, 'body').ended, 'ended');
            const [row] = readRows(ended);
            expect(row).to.include({ purpose: 'contest', href: `/contest/${doc.docId.toHexString()}` });
            return row.result;
        };
        expect(await result()).to.deep.equal({ kind: 'absent' });
        const first = makeRound(doc, STUDENT_UID, { state: 'closed', closedAt: hoursFrom(now, -2), total: 84 });
        const last = makeRound(doc, STUDENT_UID, { roundNo: 2, startedAt: hoursFrom(now, -2), total: 35 });
        formal.rounds.push(first, last);
        expect(await result()).to.deep.equal({ kind: 'score', score: 84 });
        doc.setConfig.settings.retake.pick = 'last_round';
        expect(await result()).to.deep.equal({ kind: 'score', score: 35 });
        expect(last.state).to.equal('open');
        last.scoreDirty = true;
        expect(await result()).to.deep.equal({ kind: 'pending' });
        last.legacy = { sourceRule: 'ioi', sourceStatusId: oid(621), missingRounds: 0, incompleteHistory: true, scoreLocked: true };
        expect(await result()).to.deep.equal({ kind: 'score', score: 35 });
        doc.setConfig.settings.experience = { ...SET_EXPERIENCE_DEFAULTS, hideTotalScore: true };
        expect(await result()).to.deep.equal({ kind: 'hidden' });
        doc.setConfig.settings.experience.hideTotalScore = false;
        doc.setConfig.settings.authorization = {
            defaults: { ...SET_DEFAULT_PERMISSIONS }, groups: [{ ...SET_DEFAULT_PERMISSIONS, groupId: GROUP_A.toHexString(), afterEnd: false }],
        };
        expect(await result()).to.deep.equal({ kind: 'hidden' });
        doc.setConfig.settings.authorization.groups[0].afterEnd = true;
        doc.setConfig.settings.authorization.groups[0].problems = 'hidden';
        expect(await result()).to.deep.equal({ kind: 'hidden' });
        doc.setConfig.settings.authorization.groups[0].problems = 'view';
        const feedback = doc.setConfig.settings.feedback;
        feedback.objective = { when: 'after_release', reveal: 'full' };
        feedback.code = { when: 'after_release', reveal: 'full', afterDeadline: 'same' };
        expect(await result()).to.deep.equal({ kind: 'hidden' });
        feedback.gradesReleased = true;
        expect(await result()).to.deep.equal({ kind: 'score', score: 35 });
        doc.setConfig.settings.codePolicy = 'acm';
        last.accept = 2;
        expect(await result()).to.deep.equal({ kind: 'accepted', accepted: 2 });
        doc.setConfig.settings.experience.hideTotalScore = true;
        expect(await result()).to.deep.equal({ kind: 'hidden' });
        doc.setConfig.purpose = 'homework';
        const { body } = await callGet(student(), { tab: 'ended', type: 'homework' });
        const [homework] = readRows(asRecord(asRecord(body, 'body').ended, 'ended'));
        expect(homework).to.include({ kind: 'homework', href: `/contest/${doc.docId.toHexString()}` });
    });

    it('reads team progress only from current finalized team membership', async () => {
        const now = new Date();
        const doc = baseContest(oid(630), 'contest', '组队赛', OTHER_UID, hoursFrom(now, -2), hoursFrom(now, 2));
        doc.participationMode = 'team';
        doc.setConfig.settings.codePolicy = 'acm';
        const teamId = oid(631);
        contestTeams.set(doc.docId.toHexString(), { teamId, memberUids: [STUDENT_UID] });
        contests.push(doc);
        const team = makeRound(doc, STUDENT_UID, { participantKey: `t:${teamId.toHexString()}`, paperPids: [2, 3] });
        formal.rounds.push(makeRound(doc, STUDENT_UID), team);
        formal.submitted.set(team._id.toHexString(), new Set([2, 3]));
        const row = async () => readRows(asRecord((await callGet(student(), { tab: 'running' })).body, 'body'))[0];
        expect((await row()).progress).to.deep.equal({ answered: 2 });
        doc.plannedTeamBatchId = oid(632);
        expect((await row()).progress).to.equal(null);
        delete doc.plannedTeamBatchId;
        contestTeams.clear();
        expect((await row()).progress).to.equal(null);
    });

    it('rejects a title search longer than 64 characters', async () => {
        const thrown = await rejection(student(), { tab: 'running', q: '题'.repeat(65) });
        expect(errorName(thrown)).to.equal('ValidationError');
        expect(errorParam(thrown)).to.equal('q');
    });

    it('accepts a 64 character title search after trim', async () => {
        const response = await callGet(student(), { tab: 'running', q: ` ${'题'.repeat(64)}` });
        expect(response.template).to.equal('student_sets.html');
        expect(readString(asRecord(response.body, 'body'), 'tab')).to.equal('running');
    });

    it('rejects an unknown tab', async () => {
        const thrown = await rejection(student(), { tab: 'later' });
        expect(errorName(thrown)).to.equal('ValidationError');
    });

    it('rejects an unknown ended type', async () => {
        const thrown = await rejection(student(), { tab: 'ended', type: 'practice' });
        expect(errorName(thrown)).to.equal('ValidationError');
    });
});
