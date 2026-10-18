import { beforeEach, describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';

const Module = require('node:module') as {
    _load: (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
};

interface ContestTeamGlobal {
    normalizeMemberUids?: (uids: number[]) => number[];
}

const globalHost = globalThis as unknown as {
    Hydro?: { model?: { contestTeam?: ContestTeamGlobal } };
};
const hydro = globalHost.Hydro ?? { model: {} };
globalHost.Hydro = hydro;
const hydroModel = hydro.model ?? {};
hydro.model = hydroModel;

const builtin = require('../src/model/builtin') as typeof import('../src/model/builtin');
const { PERM, PRIV } = builtin;

const DOMAIN = 'system';
const TEACHER_A = 21;
const TEACHER_B = 22;
const EDITOR = 23;
const ADMIN = 2;
const STUDENT = 30;
const BATCH_A = '64b10000000000000000000a';
const BATCH_B = '64b10000000000000000000b';
const TEAM_ALGO = '64b2000000000000000000a1';
const TEAM_DATA = '64b2000000000000000000a2';
const TEAM_INACTIVE = '64b2000000000000000000a3';

class TestPermissionError extends Error {
    readonly params: readonly unknown[];

    constructor(...params: unknown[]) {
        super('permission');
        this.name = 'PermissionError';
        this.params = params;
    }
}

class TestUserNotFoundError extends Error {
    constructor(uid: number) {
        super(`user ${uid}`);
        this.name = 'UserNotFoundError';
    }
}

class TestValidationError extends Error {
    constructor(field: string) {
        super(field);
        this.name = 'ValidationError';
    }
}

interface Actor {
    _id: number;
    uname: string;
    hasPerm: (perm: bigint) => boolean;
    hasPriv: (priv: number) => boolean;
}

interface BatchDoc {
    _id: ObjectId;
    batchId: ObjectId;
    domainId: string;
    name: string;
    nameKey: string;
    description: string;
    status: 'open' | 'closed';
    revision: number;
    createdBy: number;
    createdAt: Date;
    updatedAt: Date;
}

interface TeamDoc {
    _id: ObjectId;
    teamId: ObjectId;
    batchId: ObjectId;
    domainId: string;
    name: string;
    nameKey: string;
    description: string;
    captainUid: number;
    memberUids: number[];
    managementMode: 'self' | 'admin';
    revision: number;
    active: boolean;
    createdBy: number;
    createdAt: Date;
    updatedAt: Date;
}

interface PublicUser {
    _id: number;
    uname: string;
    displayName: string;
}

interface ListedBatch {
    name: string;
    createdBy: number;
    creatorName: string;
}

interface QueryCursor<T> {
    sort: () => QueryCursor<T>;
    project: () => QueryCursor<T>;
    toArray: () => Promise<T[]>;
}

interface HandlerResponse {
    body: Record<string, unknown>;
    template?: string;
    redirect?: string;
}

interface HandlerBase {
    domain: { _id: string };
    user: Actor;
    response: HandlerResponse;
    request: { json?: boolean };
    paginate: (cursor: QueryCursor<unknown>, page?: number, pageSize?: number) => Promise<[unknown[], number, number]>;
    url: (name: string, args?: Record<string, unknown>) => string;
    checkPerm: (perm: bigint) => void;
    canManage: boolean;
    prepare: (domainId: string, batchId: ObjectId) => Promise<void>;
    get: (domainId: string, pageOrBatch: number | ObjectId, page?: number, search?: string, teamSearch?: string) => Promise<void>;
    postCreate: (domainId: string, name: string, description?: string) => Promise<void>;
    postClose: (domainId: string, batchId: ObjectId, expectedRevision: number) => Promise<void>;
    postCopy: (domainId: string, batchId: ObjectId, name: string, description?: string) => Promise<void>;
    postReopen: (domainId: string, batchId: ObjectId, expectedRevision: number) => Promise<void>;
    postCreateSelf: (domainId: string, batchId: ObjectId, name: string, description?: string) => Promise<void>;
    postCreateAdmin: (
        domainId: string,
        batchId: ObjectId,
        name: string,
        description: string,
        memberUids: string,
        captainUid: number,
    ) => Promise<void>;
    postUpdateAdmin: (
        domainId: string,
        batchId: ObjectId,
        teamId: ObjectId,
        expectedRevision: number,
        memberUids: string,
        captainUid: number,
        name?: string,
        description?: string,
        managementMode?: 'self' | 'admin',
    ) => Promise<void>;
    postDeactivate: (domainId: string, batchId: ObjectId, teamId: ObjectId, expectedRevision: number) => Promise<void>;
    postUpdateInfo: (
        domainId: string,
        batchId: ObjectId,
        teamId: ObjectId,
        expectedRevision: number,
        name: string,
        description?: string,
    ) => Promise<void>;
    postTransferCaptain: (
        domainId: string,
        batchId: ObjectId,
        teamId: ObjectId,
        expectedRevision: number,
        captainUid: number,
    ) => Promise<void>;
    postRemoveMember: (
        domainId: string,
        batchId: ObjectId,
        teamId: ObjectId,
        expectedRevision: number,
        memberUid: number,
    ) => Promise<void>;
}

interface HandlerModule {
    TeamBatchListHandler: new () => HandlerBase;
    TeamBatchDetailHandler: new () => HandlerBase;
    apply: (ctx: {
        Route: (name: string, path: string, HandlerClass: new () => HandlerBase) => void;
    }) => Promise<void> | void;
}

interface RegisteredRoute {
    path: string;
    Handler: new () => HandlerBase;
}

interface TeamUpdateCall {
    actor: Actor;
    batchId: ObjectId;
    teamId: ObjectId;
}

const batches: BatchDoc[] = [];
const teams: TeamDoc[] = [];
const closedBatchIds: string[] = [];
const teamUpdateCalls: TeamUpdateCall[] = [];
const publicUsers = new Map<number, PublicUser>();
let copiedBatchId = new ObjectId();

const contestTeamGlobal: ContestTeamGlobal = hydroModel.contestTeam ?? {};
contestTeamGlobal.normalizeMemberUids = (uids: number[]) => [...new Set(uids)].sort((left, right) => left - right);
hydroModel.contestTeam = contestTeamGlobal;

function sameValue(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
    return left === right;
}

function matchesFilter(doc: object, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([key, value]) => {
        const actual = (doc as Record<string, unknown>)[key];
        if (value instanceof RegExp) return value.test(String(actual ?? ''));
        if (value && typeof value === 'object' && !(value instanceof ObjectId) && !(value instanceof Date)) {
            const spec = value as { $regex?: RegExp; $in?: unknown[] };
            if (spec.$regex instanceof RegExp) return spec.$regex.test(String(actual ?? ''));
            if (Array.isArray(spec.$in)) {
                if (Array.isArray(actual)) return actual.some((entry) => spec.$in?.some((item) => sameValue(entry, item)));
                return spec.$in.some((item) => sameValue(actual, item));
            }
            return false;
        }
        return sameValue(actual, value);
    });
}

function cursorOf<T>(rows: T[]): QueryCursor<T> {
    const api: QueryCursor<T> = {
        sort() {
            return api;
        },
        project() {
            return api;
        },
        async toArray() {
            return rows;
        },
    };
    return api;
}

function makeBatch(name: string, createdBy: number, idHex: string): BatchDoc {
    const batchId = new ObjectId(idHex);
    const now = new Date('2026-10-18T00:00:00Z');
    return {
        _id: batchId,
        batchId,
        domainId: DOMAIN,
        name,
        nameKey: name.toLowerCase(),
        description: '',
        status: 'open',
        revision: 3,
        createdBy,
        createdAt: now,
        updatedAt: now,
    };
}

function makeTeam(
    name: string,
    idHex: string,
    batchId: ObjectId,
    captainUid: number,
    memberUids: number[],
    active: boolean,
): TeamDoc {
    const teamId = new ObjectId(idHex);
    const now = new Date('2026-10-18T00:00:00Z');
    return {
        _id: teamId,
        teamId,
        batchId,
        domainId: DOMAIN,
        name,
        nameKey: name.toLowerCase(),
        description: '',
        captainUid,
        memberUids,
        managementMode: 'self',
        revision: 1,
        active,
        createdBy: captainUid,
        createdAt: now,
        updatedAt: now,
    };
}

function rememberUser(uid: number, uname: string, displayName: string) {
    publicUsers.set(uid, { _id: uid, uname, displayName });
}

function makeUser(uid: number, perms: readonly bigint[], privs: readonly number[], uname: string): Actor {
    return {
        _id: uid,
        uname,
        hasPerm: (perm: bigint) => perms.includes(perm),
        hasPriv: (priv: number) => privs.includes(priv),
    };
}

function teacherA(): Actor {
    return makeUser(TEACHER_A, [PERM.PERM_CREATE_CONTEST, PERM.PERM_VIEW_CONTEST, PERM.PERM_ATTEND_CONTEST], [], 'teacher-a');
}

function editor(): Actor {
    return makeUser(EDITOR, [PERM.PERM_EDIT_CONTEST, PERM.PERM_VIEW_CONTEST], [], 'editor');
}

function admin(): Actor {
    return makeUser(ADMIN, [PERM.PERM_VIEW_CONTEST], [PRIV.PRIV_EDIT_SYSTEM], 'admin');
}

function student(): Actor {
    return makeUser(STUDENT, [PERM.PERM_VIEW_CONTEST, PERM.PERM_ATTEND_CONTEST], [], 'student');
}

function canManageTeamBatches(user: Actor): boolean {
    return user.hasPerm(PERM.PERM_CREATE_CONTEST) || user.hasPerm(PERM.PERM_EDIT_CONTEST) || user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
}

async function getPublicTeamUsers(_domainId: string, userIds: number[]): Promise<Record<string, PublicUser>> {
    const result: Record<string, PublicUser> = {};
    for (const uid of userIds) {
        const known = publicUsers.get(uid);
        if (known) result[String(uid)] = known;
    }
    return result;
}

function getMultiBatch(domainId: string, query: Record<string, unknown> = {}) {
    const rows = batches.filter((batch) => batch.domainId === domainId && matchesFilter(batch, query));
    return cursorOf(rows);
}

function getMultiTeam(domainId: string, batchId: ObjectId, query: Record<string, unknown> = {}) {
    const rows = teams.filter((team) => (
        team.domainId === domainId
        && team.batchId.equals(batchId)
        && team.active
        && matchesFilter(team, query)
    ));
    rows.sort((left, right) => left.nameKey.localeCompare(right.nameKey) || left.teamId.toHexString().localeCompare(right.teamId.toHexString()));
    return cursorOf(rows);
}

async function countBatchTeams(domainId: string, batchId: ObjectId): Promise<number> {
    return teams.filter((team) => team.domainId === domainId && team.batchId.equals(batchId) && team.active).length;
}

async function countBatchMembers(domainId: string, batchId: ObjectId): Promise<number> {
    return teams
        .filter((team) => team.domainId === domainId && team.batchId.equals(batchId) && team.active)
        .reduce((sum, team) => sum + team.memberUids.length, 0);
}

async function getBatch(domainId: string, batchId: ObjectId): Promise<BatchDoc | null> {
    return batches.find((batch) => batch.domainId === domainId && batch.batchId.equals(batchId)) ?? null;
}

async function createBatch(domainId: string, actor: { user: Actor }, input: { name: string; description?: string }): Promise<BatchDoc> {
    const batch = makeBatch(input.name, actor.user._id, new ObjectId().toHexString());
    batch.domainId = domainId;
    batch.description = input.description ?? '';
    batches.push(batch);
    return batch;
}

async function copyBatch(_domainId: string, _batchId: ObjectId, actor: { user: Actor }, input: { name: string }): Promise<{ batch: BatchDoc }> {
    copiedBatchId = new ObjectId();
    return { batch: makeBatch(input.name, actor.user._id, copiedBatchId.toHexString()) };
}

async function closeBatch(_domainId: string, batchId: ObjectId): Promise<void> {
    closedBatchIds.push(batchId.toHexString());
}

async function getTeam(domainId: string, batchId: ObjectId, teamId: ObjectId): Promise<TeamDoc | null> {
    return teams.find((team) => (
        team.domainId === domainId
        && team.batchId.equals(batchId)
        && team.teamId.equals(teamId)
        && team.active
    )) ?? null;
}

async function updateTeam(
    _domainId: string,
    batchId: ObjectId,
    teamId: ObjectId,
    actor: { user: Actor },
): Promise<void> {
    teamUpdateCalls.push({ actor: actor.user, batchId, teamId });
    if (canManageTeamBatches(actor.user)) return;
    throw new TestPermissionError(PERM.PERM_EDIT_CONTEST_SELF);
}

function noopDecorator() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}

const batchModelStub = {
    __esModule: true as const,
    canManageTeamBatches,
    getMultiBatch,
    getMultiTeam,
    countBatchTeams,
    countBatchMembers,
    getBatch,
    createBatch,
    copyBatch,
    closeBatch,
    async reopenBatch() {
        return undefined;
    },
    async createTeam() {
        return undefined;
    },
    updateTeam,
    async getTeamByMember() {
        return null;
    },
    getTeam,
    getPendingInvitesForUser() {
        return cursorOf([]);
    },
    async assertTeamBatchMemberEligibility() {
        return undefined;
    },
    async canReopenBatch() {
        return false;
    },
    inviteColl: {
        async countDocuments() {
            return 0;
        },
    },
};

const teamUserStub = {
    __esModule: true as const,
    getPublicTeamUsers,
    async searchPublicTeamUsers() {
        return [];
    },
};

const messageStub = {
    __esModule: true as const,
    FLAG_I18N: 1,
    FLAG_UNREAD: 2,
    async send() {
        return undefined;
    },
    default: undefined as unknown,
};
messageStub.default = messageStub;

const errorStub = {
    __esModule: true as const,
    PermissionError: TestPermissionError,
    UserNotFoundError: TestUserNotFoundError,
    ValidationError: TestValidationError,
};

const serverStub = {
    __esModule: true as const,
    Handler: class HandlerStub {},
    param: noopDecorator,
    Types: new Proxy({}, { get: () => () => ({}) }),
};

const contextStub = {
    __esModule: true as const,
    Context: class ContextStub {},
};

function handlerDependency(request: string): unknown {
    if (request === '../context') return contextStub;
    if (request === '../error') return errorStub;
    if (request === '../lib/team-user') return teamUserStub;
    if (request === '../model/builtin') return builtin;
    if (request === '../model/contest-team-batch') return batchModelStub;
    if (request === '../model/message') return messageStub;
    if (request === '../service/server') return serverStub;
    return null;
}

const handlerPath = require.resolve('../src/handler/contest-team-batch.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule | null | undefined, isMain: boolean) {
    if (parent?.filename === handlerPath) {
        const stub = handlerDependency(request);
        if (stub) return stub;
    }
    return originalLoad.call(this, request, parent, isMain);
};

const routes: Partial<Record<string, RegisteredRoute>> = {};
let handlerModule: HandlerModule;
try {
    delete require.cache[handlerPath];
    handlerModule = require(handlerPath) as HandlerModule;
    void handlerModule.apply({
        Route(name, routePath, HandlerClass) {
            routes[name] = { path: routePath, Handler: HandlerClass };
        },
    });
} finally {
    Module._load = originalLoad;
}

const ListHandler = handlerModule.TeamBatchListHandler;
const DetailHandler = handlerModule.TeamBatchDetailHandler;

function idText(value: unknown): string {
    if (value instanceof ObjectId) return value.toHexString();
    return String(value ?? '');
}

function routeUrl(name: string, args?: Record<string, unknown>): string {
    if (name === 'training_main') return '/problem-sets';
    const id = idText(args?.batchId);
    if (name === 'team_batch_detail') return `/teams/${id}`;
    if (name === 'team_batch_manage') return `/teams/${id}/manage`;
    return `/${name}`;
}

async function paginate(cursor: QueryCursor<unknown>, page = 1, pageSize = 20): Promise<[unknown[], number, number]> {
    const all = await cursor.toArray();
    const size = pageSize > 0 ? pageSize : 20;
    const start = (page - 1) * size;
    const total = all.length;
    const pageCount = Math.max(1, Math.ceil(total / size));
    return [all.slice(start, start + size), pageCount, total];
}

function bind(handler: HandlerBase, user: Actor): HandlerBase {
    handler.domain = { _id: DOMAIN };
    handler.user = user;
    handler.response = { body: {} };
    handler.request = { json: false };
    handler.paginate = paginate;
    handler.url = routeUrl;
    handler.checkPerm = (perm: bigint) => {
        if (!user.hasPerm(perm)) throw new TestPermissionError(perm);
    };
    return handler;
}

function listedBatches(body: Record<string, unknown>): ListedBatch[] {
    const value = body.batches;
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
        const row = item as Record<string, unknown>;
        return {
            name: typeof row.name === 'string' ? row.name : '',
            createdBy: typeof row.createdBy === 'number' ? row.createdBy : -1,
            creatorName: typeof row.creatorName === 'string' ? row.creatorName : '',
        };
    }).sort((left, right) => left.name.localeCompare(right.name, 'zh'));
}

function failureKind(error: unknown): string {
    if (error instanceof TestPermissionError) return 'permission';
    if (error === null) return 'resolved';
    return 'other';
}

async function capture(work: () => Promise<void>): Promise<unknown> {
    try {
        await work();
        return null;
    } catch (error) {
        return error;
    }
}

function manageRoute(): RegisteredRoute {
    const route = routes.team_batch_manage;
    expect(route?.path).to.equal('/teams/:batchId/manage');
    expect(typeof route?.Handler).to.equal('function');
    return route as RegisteredRoute;
}

function batchUrl(batchId: ObjectId, manage: boolean): string {
    const id = batchId.toHexString();
    return manage ? `/teams/${id}/manage` : `/teams/${id}`;
}

beforeEach(() => {
    batches.length = 0;
    teams.length = 0;
    closedBatchIds.length = 0;
    teamUpdateCalls.length = 0;
    publicUsers.clear();
    copiedBatchId = new ObjectId();
    batches.push(makeBatch('甲的批次', TEACHER_A, BATCH_A), makeBatch('乙的批次', TEACHER_B, BATCH_B));
    const batchA = batches[0].batchId;
    teams.push(
        makeTeam('算法一队', TEAM_ALGO, batchA, 10, [10, 11], true),
        makeTeam('数据结构队', TEAM_DATA, batchA, 12, [12], true),
        makeTeam('算法停用队', TEAM_INACTIVE, batchA, 13, [13], false),
    );
    rememberUser(TEACHER_A, 'teacher-a', '老师甲');
    rememberUser(TEACHER_B, 'teacher-b', '老师乙');
    rememberUser(10, 'u10', '学生十');
    rememberUser(11, 'u11', '学生十一');
    rememberUser(12, 'u12', '学生十二');
    rememberUser(13, 'u13', '学生十三');
});

describe('team batch manage scope and student directory', { concurrency: false }, () => {
    it('shows a create-contest teacher only batches they created, with creator fields', async () => {
        const handler = bind(new ListHandler(), teacherA());
        await handler.get(DOMAIN, 1);
        const body = handler.response.body;
        const capabilities = body.capabilities as { canManage?: boolean } | undefined;
        expect(handler.response.redirect).to.equal(undefined);
        expect(body.page).to.equal(1);
        expect(body.total).to.equal(1);
        expect(capabilities?.canManage).to.equal(true);
        expect(listedBatches(body)).to.deep.equal([
            { name: '甲的批次', createdBy: TEACHER_A, creatorName: '老师甲' },
        ]);
    });

    it('shows every batch to an edit-contest user and to a system editor', async () => {
        const expected = [
            { name: '甲的批次', createdBy: TEACHER_A, creatorName: '老师甲' },
            { name: '乙的批次', createdBy: TEACHER_B, creatorName: '老师乙' },
        ];
        for (const user of [editor(), admin()]) {
            const handler = bind(new ListHandler(), user);
            await handler.get(DOMAIN, 1);
            expect(handler.response.body.total).to.equal(2);
            expect(listedBatches(handler.response.body)).to.deep.equal(expected);
        }
    });

    it('redirects a student away from the batch list to problem sets', async () => {
        const handler = bind(new ListHandler(), student());
        await handler.get(DOMAIN, 1);
        expect(handler.response.redirect).to.equal('/problem-sets');
    });

    it('keeps batch creation on the student batch page', async () => {
        const handler = bind(new ListHandler(), teacherA());
        await handler.postCreate(DOMAIN, '新批次', '');
        const created = batches.find((batch) => batch.name === '新批次');
        expect(created?.createdBy).to.equal(TEACHER_A);
        expect(handler.response.redirect).to.equal(batchUrl(created?.batchId ?? new ObjectId(), false));
    });

    it('rejects closing a batch created by someone else', async () => {
        const handler = bind(new DetailHandler(), teacherA());
        const foreign = batches[1];
        await handler.prepare(DOMAIN, foreign.batchId);
        const outcome = await capture(() => handler.postClose(DOMAIN, foreign.batchId, foreign.revision));
        expect(failureKind(outcome)).to.equal('permission');
        if (outcome instanceof TestPermissionError) expect(outcome.params[0]).to.equal(PERM.PERM_EDIT_CONTEST);
        expect(closedBatchIds).to.deep.equal([]);
    });

    it('rejects team edits on another teachers batch without forwarding create contest', async () => {
        const foreign = batches[1];
        const foreignTeam = makeTeam('乙的队伍', '64b2000000000000000000b1', foreign.batchId, 12, [12], true);
        teams.push(foreignTeam);
        const edits: Array<(handler: HandlerBase) => Promise<void>> = [
            (handler) => handler.postUpdateInfo(DOMAIN, foreign.batchId, foreignTeam.teamId, foreignTeam.revision, '改名', ''),
            (handler) => handler.postTransferCaptain(DOMAIN, foreign.batchId, foreignTeam.teamId, foreignTeam.revision, 12),
            (handler) => handler.postRemoveMember(DOMAIN, foreign.batchId, foreignTeam.teamId, foreignTeam.revision, 12),
        ];
        const outcomes: string[] = [];
        for (const edit of edits) {
            const handler = bind(new DetailHandler(), teacherA());
            await handler.prepare(DOMAIN, foreign.batchId);
            outcomes.push(failureKind(await capture(() => edit(handler))));
        }
        const privilegedActors = teamUpdateCalls.filter((call) => call.actor.hasPerm(PERM.PERM_CREATE_CONTEST)).length;
        expect({ outcomes, privilegedActors }).to.deep.equal({
            outcomes: ['permission', 'permission', 'permission'],
            privilegedActors: 0,
        });
    });

    it('lets the batch creator edit another persons team as a manager', async () => {
        const own = batches[0];
        const team = teams[0];
        const handler = bind(new DetailHandler(), teacherA());
        await handler.prepare(DOMAIN, own.batchId);
        const outcome = await capture(() => handler.postUpdateInfo(DOMAIN, own.batchId, team.teamId, team.revision, '甲改名', ''));
        expect(failureKind(outcome)).to.equal('resolved');
        expect(teamUpdateCalls.length).to.equal(1);
        expect(canManageTeamBatches(teamUpdateCalls[0].actor)).to.equal(true);
        expect(teamUpdateCalls[0].actor.hasPerm(PERM.PERM_CREATE_CONTEST)).to.equal(true);
    });

    it('redirects a successful close of the caller batch to the manage page', async () => {
        const handler = bind(new DetailHandler(), teacherA());
        const own = batches[0];
        await handler.prepare(DOMAIN, own.batchId);
        const outcome = await capture(() => handler.postClose(DOMAIN, own.batchId, own.revision));
        expect(failureKind(outcome)).to.equal('resolved');
        expect(handler.response.redirect).to.equal(batchUrl(own.batchId, true));
    });

    it('redirects management writes to manage and a student write to the batch page', async () => {
        const own = batches[0];
        const teamId = teams[0].teamId;
        const management: Array<(handler: HandlerBase) => Promise<void>> = [
            (handler) => handler.postCopy(DOMAIN, own.batchId, '副本', ''),
            (handler) => handler.postReopen(DOMAIN, own.batchId, own.revision),
            (handler) => handler.postCreateAdmin(DOMAIN, own.batchId, '代建队', '', '10', 10),
            (handler) => handler.postUpdateAdmin(DOMAIN, own.batchId, teamId, 1, '10,11', 10, '算法一队', '', 'self'),
            (handler) => handler.postDeactivate(DOMAIN, own.batchId, teamId, 1),
        ];
        const redirects: string[] = [];
        for (const run of management) {
            const handler = bind(new DetailHandler(), teacherA());
            await handler.prepare(DOMAIN, own.batchId);
            await run(handler);
            redirects.push(handler.response.redirect ?? '');
        }
        const copyHandlerRedirect = redirects[0];
        expect(copyHandlerRedirect).to.equal(batchUrl(copiedBatchId, true));
        expect(redirects.slice(1)).to.deep.equal([
            batchUrl(own.batchId, true),
            batchUrl(own.batchId, true),
            batchUrl(own.batchId, true),
            batchUrl(own.batchId, true),
        ]);

        const studentHandler = bind(new DetailHandler(), student());
        await studentHandler.prepare(DOMAIN, own.batchId);
        await studentHandler.postCreateSelf(DOMAIN, own.batchId, '自建队', '');
        expect(studentHandler.response.redirect).to.equal(batchUrl(own.batchId, false));
    });

    it('returns searched active directory rows to a student without the full team list', async () => {
        const handler = bind(new DetailHandler(), student());
        const batchId = batches[0].batchId;
        await handler.prepare(DOMAIN, batchId);
        const outcome = await capture(() => handler.get(DOMAIN, batchId, 1, '', '算法'));
        expect(failureKind(outcome)).to.equal('resolved');
        const body = handler.response.body;
        const directory = body.directory;
        expect(directory !== null && typeof directory === 'object' && !Array.isArray(directory)).to.equal(true);
        const view = directory as {
            rows: Array<Record<string, unknown>>;
            page: number;
            pageCount: number;
            total: number;
            search: string;
        };
        expect(view.search).to.equal('算法');
        expect(view.page).to.equal(1);
        expect(view.pageCount).to.equal(1);
        expect(view.total).to.equal(1);
        expect(view.rows.length).to.equal(1);
        expect(Object.keys(view.rows[0]).sort()).to.deep.equal(['captainUid', 'memberCount', 'name', 'teamId']);
        expect(view.rows[0]).to.deep.equal({
            teamId: TEAM_ALGO,
            name: '算法一队',
            captainUid: 10,
            memberCount: 2,
        });
        const users = body.users as Record<string, { _id?: number }> | undefined;
        expect(users?.['10']?._id).to.equal(10);
        expect(Object.hasOwn(body, 'teams')).to.equal(false);
        expect(body.manageUrl).to.equal(null);
        const capabilities = body.capabilities as { canManage?: boolean } | undefined;
        expect(capabilities?.canManage).to.equal(false);
    });

    it('pages the student directory at twenty matching active teams', async () => {
        const batchId = batches[0].batchId;
        teams.length = 0;
        for (let index = 1; index <= 21; index += 1) {
            const suffix = String(index).padStart(2, '0');
            teams.push(makeTeam(`算法${suffix}`, new ObjectId().toHexString(), batchId, 10, [10], true));
        }
        teams.push(makeTeam('算法停用队', TEAM_INACTIVE, batchId, 13, [13], false));
        teams.push(makeTeam('数据结构队', TEAM_DATA, batchId, 12, [12], true));
        const handler = bind(new DetailHandler(), student());
        await handler.prepare(DOMAIN, batchId);
        const first = await capture(() => handler.get(DOMAIN, batchId, 1, '', '算法'));
        expect(failureKind(first)).to.equal('resolved');
        const firstView = handler.response.body.directory as { rows: unknown[]; total: number; pageCount: number };
        expect(firstView.rows.length).to.equal(20);
        expect(firstView.total).to.equal(21);
        expect(firstView.pageCount).to.equal(2);
        const secondHandler = bind(new DetailHandler(), student());
        await secondHandler.prepare(DOMAIN, batchId);
        await secondHandler.get(DOMAIN, batchId, 2, '', '算法');
        const secondView = secondHandler.response.body.directory as { rows: Array<{ name: string }>; page: number };
        expect(secondView.page).to.equal(2);
        expect(secondView.rows.length).to.equal(1);
        expect(secondView.rows[0].name.includes('算法')).to.equal(true);
    });

    it('rejects a manage read from a student and from a teacher on another batch', async () => {
        const ManageHandler = manageRoute().Handler;
        const studentHandler = bind(new ManageHandler(), student());
        const studentOutcome = await capture(async () => {
            await studentHandler.prepare(DOMAIN, batches[0].batchId);
            await studentHandler.get(DOMAIN, batches[0].batchId, 1, '', '');
        });
        expect(failureKind(studentOutcome)).to.equal('permission');
        if (studentOutcome instanceof TestPermissionError) expect(studentOutcome.params[0]).to.equal(PERM.PERM_EDIT_CONTEST);

        const teacherHandler = bind(new ManageHandler(), teacherA());
        const teacherOutcome = await capture(async () => {
            await teacherHandler.prepare(DOMAIN, batches[1].batchId);
            await teacherHandler.get(DOMAIN, batches[1].batchId, 1, '', '');
        });
        expect(failureKind(teacherOutcome)).to.equal('permission');
        if (teacherOutcome instanceof TestPermissionError) expect(teacherOutcome.params[0]).to.equal(PERM.PERM_EDIT_CONTEST);
    });

    it('renders the manage template for an admin and for the batch creator', async () => {
        const ManageHandler = manageRoute().Handler;
        expect(new ManageHandler() instanceof DetailHandler).to.equal(true);
        for (const [user, batch] of [[admin(), batches[1]], [teacherA(), batches[0]]] as const) {
            const handler = bind(new ManageHandler(), user);
            const outcome = await capture(async () => {
                await handler.prepare(DOMAIN, batch.batchId);
                await handler.get(DOMAIN, batch.batchId, 1, '', '');
            });
            expect(failureKind(outcome)).to.equal('resolved');
            expect(handler.response.template).to.equal('team_batch_manage.html');
            expect(handler.response.body.workspaceUrl).to.equal(batchUrl(batch.batchId, true));
            const teamRows = handler.response.body.teams;
            expect(Array.isArray(teamRows)).to.equal(true);
        }
        const adminHandler = bind(new ManageHandler(), admin());
        await adminHandler.prepare(DOMAIN, batches[0].batchId);
        await adminHandler.get(DOMAIN, batches[0].batchId, 1, '', '');
        const names = (adminHandler.response.body.teams as Array<{ name?: string }>)
            .map((team) => team.name ?? '')
            .sort((left, right) => left.localeCompare(right, 'zh'));
        expect(names).to.deep.equal(['数据结构队', '算法一队']);
    });
});
