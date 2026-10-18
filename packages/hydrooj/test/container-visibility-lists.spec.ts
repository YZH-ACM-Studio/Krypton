import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { PERM } from '@hydrooj/common';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import {
    isListVisibleToUser,
    listAccessQuery,
    parentSchoolIdsFromUser,
    resolveContestListParticipantScope,
} from '../src/lib/contest-list-access';
import { InMemoryStudentDirectory } from '../src/lib/testing/in-memory-student-directory';
import { registerStudentDirectory } from '../src/service/student-directory';

const requireFromTest = createRequire(__filename);
const Module = requireFromTest('node:module') as {
    _load: (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
};

const hydroHost = globalThis as unknown as { Hydro?: { model: Record<string, unknown> } };
if (!hydroHost.Hydro) hydroHost.Hydro = { model: {} };
if (!hydroHost.Hydro.model) hydroHost.Hydro.model = {};

try {
    registerStudentDirectory(new InMemoryStudentDirectory());
} catch (error) {
    if (!(error instanceof Error) || !error.message.includes('already registered')) throw error;
}

const DOMAIN = 'system';
const TEACHER = 7;
const STUDENT = 9;
const OTHER = 8;
const PROBLEM_ID = 11;
const HOME_CONTEST_SORT = { endAt: -1, beginAt: -1, _id: -1 };
const GROUP_ID = new ObjectId('64b0000000000000000000aa');

const RULES: Record<string, { hidden: boolean }> = {
    acm: { hidden: false },
    oi: { hidden: false },
    ioi: { hidden: false },
    ledo: { hidden: false },
    strictioi: { hidden: false },
    exam: { hidden: false },
    homework: { hidden: true },
};
const listedRules = Object.keys(RULES).filter((name) => !RULES[name].hidden);

interface ContestDoc {
    domainId: string;
    docId: ObjectId;
    _id: ObjectId;
    owner: number;
    maintainer: number[];
    rule: string;
    title: string;
    assign: string[];
    pids: number[];
    beginAt: Date;
    endAt: Date;
    hidden?: boolean;
    penaltySince?: Date;
    participantScopeMode?: 'none' | 'groups' | 'schools';
    participantGroupIds?: ObjectId[];
}

interface ContestInput {
    docId: ObjectId;
    owner: number;
    rule: string;
    title: string;
    endAt: Date;
    maintainer?: number[];
    assign?: string[];
    pids?: number[];
    beginAt?: Date;
    hidden?: boolean;
    penaltySince?: Date;
    participantScopeMode?: 'none' | 'groups' | 'schools';
    participantGroupIds?: ObjectId[];
}

interface Actor {
    _id: number;
    group: string[];
    canBrowse: boolean;
    _problemAclDomainId: string;
    hasPerm(...perm: bigint[]): boolean;
    hasPriv(...priv: number[]): boolean;
    own(doc: { owner: number; maintainer?: number[] }): boolean;
}

interface QueryCursor {
    hint(): QueryCursor;
    limit(limit: number): QueryCursor;
    project(): QueryCursor;
    skip(skip: number): QueryCursor;
    sort(spec: Record<string, number>): QueryCursor;
    next(): Promise<ContestDoc | null>;
    toArray(): Promise<ContestDoc[]>;
}

interface ProblemListHandler {
    get(...args: unknown[]): Promise<void>;
    response: { body: { filters?: { contest?: string } } };
}

interface ProblemDetailHandler {
    get(...args: unknown[]): Promise<void>;
    response: { body: { ctdocs?: ContestDoc[]; htdocs?: ContestDoc[] } };
}

interface HomeListHandler {
    getContest(domainId: string, limit?: number): Promise<unknown>;
    getHomework(domainId: string, limit?: number): Promise<unknown>;
}

interface HandlerCtor {
    new (): object;
}

interface CourseRow {
    dag?: { tids?: unknown[] }[];
    courseExam?: { contestId?: unknown };
}

function at(hour: number): Date {
    return new Date(Date.UTC(2026, 9, 18, hour, 0, 0));
}

function contest(input: ContestInput): ContestDoc {
    const doc: ContestDoc = {
        domainId: DOMAIN,
        docId: input.docId,
        _id: input.docId,
        owner: input.owner,
        maintainer: input.maintainer ?? [],
        rule: input.rule,
        title: input.title,
        assign: input.assign ?? [],
        pids: input.pids ?? [],
        beginAt: input.beginAt ?? at(1),
        endAt: input.endAt,
    };
    if (input.hidden !== undefined) doc.hidden = input.hidden;
    if (input.penaltySince !== undefined) doc.penaltySince = input.penaltySince;
    if (input.participantScopeMode !== undefined) doc.participantScopeMode = input.participantScopeMode;
    if (input.participantGroupIds !== undefined) doc.participantGroupIds = input.participantGroupIds;
    return doc;
}

const publicAcmId = new ObjectId('64b000000000000000000011');
const hiddenAcmId = new ObjectId('64b000000000000000000012');
const studentOwnedId = new ObjectId('64b000000000000000000013');
const teacherOwnedId = new ObjectId('64b000000000000000000014');
const teacherKeptId = new ObjectId('64b000000000000000000015');
const assignedAwayId = new ObjectId('64b000000000000000000016');
const groupedExamId = new ObjectId('64b000000000000000000017');
const ownedHomeworkId = new ObjectId('64b000000000000000000021');
const keptHomeworkId = new ObjectId('64b000000000000000000022');
const courseHomeworkId = new ObjectId('64b000000000000000000023');
const foreignHomeworkId = new ObjectId('64b000000000000000000024');

const contests: ContestDoc[] = [
    contest({ docId: publicAcmId, owner: OTHER, rule: 'acm', title: 'public acm', endAt: at(10), pids: [PROBLEM_ID] }),
    contest({ docId: hiddenAcmId, owner: OTHER, rule: 'acm', title: 'hidden acm', endAt: at(12), hidden: true }),
    contest({ docId: studentOwnedId, owner: STUDENT, rule: 'oi', title: 'student oi', endAt: at(8), hidden: true }),
    contest({ docId: teacherOwnedId, owner: TEACHER, rule: 'acm', title: 'teacher acm', endAt: at(6), pids: [PROBLEM_ID] }),
    contest({
        docId: teacherKeptId,
        owner: OTHER,
        maintainer: [TEACHER],
        rule: 'ioi',
        title: 'teacher ioi',
        endAt: at(4),
        pids: [PROBLEM_ID],
    }),
    contest({ docId: assignedAwayId, owner: OTHER, rule: 'acm', title: 'assigned acm', endAt: at(11), assign: ['other-class'] }),
    contest({
        docId: groupedExamId,
        owner: OTHER,
        rule: 'exam',
        title: 'grouped exam',
        endAt: at(9),
        participantScopeMode: 'groups',
        participantGroupIds: [GROUP_ID],
    }),
    contest({
        docId: ownedHomeworkId,
        owner: TEACHER,
        rule: 'homework',
        title: 'owned homework',
        endAt: at(7),
        penaltySince: at(7),
        pids: [PROBLEM_ID],
    }),
    contest({
        docId: keptHomeworkId,
        owner: OTHER,
        maintainer: [TEACHER],
        rule: 'homework',
        title: 'kept homework',
        endAt: at(5),
        penaltySince: at(5),
        pids: [PROBLEM_ID],
    }),
    contest({
        docId: courseHomeworkId,
        owner: OTHER,
        rule: 'homework',
        title: 'course homework',
        endAt: at(3),
        penaltySince: at(3),
    }),
    contest({
        docId: foreignHomeworkId,
        owner: OTHER,
        rule: 'homework',
        title: 'foreign homework',
        endAt: at(2),
        penaltySince: at(2),
        pids: [PROBLEM_ID],
    }),
];

const courses: CourseRow[] = [{ dag: [{ tids: [courseHomeworkId, 'not-an-object-id'] }] }];

function sameValue(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
    return left === right;
}

function listIncludes(list: readonly unknown[], value: unknown): boolean {
    return list.some((item) => sameValue(item, value));
}

function isOperator(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof ObjectId || value instanceof Date) return false;
    return Object.keys(value).some((key) => key.startsWith('$'));
}

function matchValue(actual: unknown, expected: unknown): boolean {
    if (!isOperator(expected)) {
        if (Array.isArray(actual)) return listIncludes(actual, expected);
        return sameValue(actual, expected);
    }
    if ('$ne' in expected) {
        if (Array.isArray(actual)) return !listIncludes(actual, expected.$ne);
        return !sameValue(actual, expected.$ne);
    }
    if ('$in' in expected && Array.isArray(expected.$in)) {
        const choices = expected.$in;
        if (Array.isArray(actual)) return actual.some((item) => listIncludes(choices, item));
        return listIncludes(choices, actual);
    }
    if ('$exists' in expected) {
        const exists = actual !== undefined;
        return expected.$exists === true ? exists : !exists;
    }
    if ('$size' in expected) return Array.isArray(actual) && actual.length === expected.$size;
    return false;
}

function matches(doc: ContestDoc, query: unknown): boolean {
    if (!query || typeof query !== 'object' || Array.isArray(query)) return false;
    const record = query as Record<string, unknown>;
    for (const key of Object.keys(record)) {
        if (key === '$or') {
            const clauses = record.$or;
            if (!Array.isArray(clauses) || !clauses.some((clause) => matches(doc, clause))) return false;
            continue;
        }
        if (key === '$and') {
            const clauses = record.$and;
            if (!Array.isArray(clauses) || !clauses.every((clause) => matches(doc, clause))) return false;
            continue;
        }
        if (!matchValue(doc[key as keyof ContestDoc], record[key])) return false;
    }
    return true;
}

function compareField(left: unknown, right: unknown): number {
    if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
    if (left instanceof ObjectId && right instanceof ObjectId) {
        const leftHex = left.toHexString();
        const rightHex = right.toHexString();
        if (leftHex < rightHex) return -1;
        if (leftHex > rightHex) return 1;
        return 0;
    }
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    if (typeof left === 'string' && typeof right === 'string') {
        if (left < right) return -1;
        if (left > right) return 1;
        return 0;
    }
    return 0;
}

function sortDocs(docs: readonly ContestDoc[], spec: Record<string, number>): ContestDoc[] {
    return [...docs].sort((left, right) => {
        for (const [key, direction] of Object.entries(spec)) {
            const order = compareField(left[key as keyof ContestDoc], right[key as keyof ContestDoc]);
            if (order !== 0) return order * direction;
        }
        return 0;
    });
}

function cursor(docs: ContestDoc[]): QueryCursor {
    const state = { limit: Number.POSITIVE_INFINITY, skip: 0, sort: null as Record<string, number> | null };
    const api: QueryCursor = {
        hint() {
            return api;
        },
        limit(limit: number) {
            state.limit = limit;
            return api;
        },
        project() {
            return api;
        },
        skip(skip: number) {
            state.skip = skip;
            return api;
        },
        sort(spec: Record<string, number>) {
            state.sort = spec;
            return api;
        },
        async next() {
            const rows = materialize();
            return rows[0] ?? null;
        },
        async toArray() {
            return materialize();
        },
    };
    function materialize(): ContestDoc[] {
        const rows = state.sort ? sortDocs(docs, state.sort) : [...docs];
        return rows.slice(state.skip, state.skip + state.limit);
    }
    return api;
}

function emptyExports(): unknown {
    const target: Record<string, unknown> = {};
    return new Proxy(target, {
        get(current, key) {
            if (key === '__esModule' || key === 'then' || typeof key !== 'string') return undefined;
            if (!(key in current)) current[key] = () => undefined;
            return current[key];
        },
    });
}

const trainingStub = {
    getMulti(domainId: string, _query: unknown) {
        const rows = domainId === DOMAIN ? courses : [];
        const courseCursor = {
            project() {
                return courseCursor;
            },
            toArray() {
                return Promise.resolve(rows);
            },
        };
        return courseCursor;
    },
};

const contestStub = {
    RULES,
    listAccessQuery,
    isListVisibleToUser,
    parentSchoolIdsFromUser,
    resolveContestListParticipantScope,
    getMulti(domainId: string, query: unknown) {
        return cursor(contests.filter((doc) => doc.domainId === domainId && matches(doc, query)));
    },
    async getRelated(domainId: string, pid: number, rule?: string) {
        return contests.filter((doc) => {
            if (doc.domainId !== domainId || !doc.pids.includes(pid)) return false;
            if (rule) return doc.rule === rule;
            return listedRules.includes(doc.rule);
        });
    },
    async getListStatus() {
        return {};
    },
};

const userStub = {
    async listGroup() {
        return [];
    },
    async getList() {
        return {};
    },
    async getById(_domainId: string, uid: number) {
        return { _id: uid };
    },
};

const problemStub = {
    PROJECTION_MANAGED_BANK: ['docId'],
    PROJECTION_PUBLIC: ['docId'],
    async refreshProblemAcl() {
        return undefined;
    },
    assertProblemAclDomain() {
        return undefined;
    },
    canBrowseProblemBank(user: { canBrowse?: boolean }) {
        return user.canBrowse === true;
    },
    buildProblemBankScope() {
        return {};
    },
    isProblemBankAdmin() {
        return false;
    },
    getMulti() {
        return cursor([]);
    },
    async getListStatus() {
        return {};
    },
    canOpenProblemWorkspace() {
        return false;
    },
    canArchiveProblem() {
        return false;
    },
    canCloneProblem() {
        return false;
    },
    canPublishProblem() {
        return false;
    },
    canManageProblemContributions() {
        return false;
    },
    canCreateManagedProgrammingDraft() {
        return false;
    },
    canImportProblems() {
        return false;
    },
};

function canBrowseAssignRestrictedContests(actor: { hasPerm(...perm: bigint[]): boolean }): boolean {
    return actor.hasPerm(PERM.PERM_EDIT_CONTEST) || actor.hasPerm(PERM.PERM_VIEW_HIDDEN_CONTEST);
}

function decoratorFactory() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}

function requireSudo(_target: unknown, _key: string, descriptor: PropertyDescriptor) {
    return descriptor;
}

class HandlerBase {}
class ContestDetailBaseHandler {}

const serverStub = {
    Handler: HandlerBase,
    param: decoratorFactory,
    post: decoratorFactory,
    query: decoratorFactory,
    route: decoratorFactory,
    Query: decoratorFactory,
    requireSudo,
    Types: new Proxy(
        {},
        {
            get() {
                return () => ({});
            },
        },
    ),
};

const contestHandlerStub = {
    canBrowseAssignRestrictedContests,
    ContestDetailBaseHandler,
};

const pidNamespaceStub = {
    canReviewPidNamespaceProblems() {
        return false;
    },
    canManagePidNamespaces() {
        return false;
    },
    async listPidNamespaces() {
        return [];
    },
};

function fromFile(parent: NodeModule | null | undefined, suffix: string): boolean {
    return parent?.filename?.endsWith(suffix) === true;
}

const problemPath = requireFromTest.resolve('../src/handler/problem.ts');
const homePath = requireFromTest.resolve('../src/handler/home.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule | null | undefined, isMain: boolean) {
    const fromVisibility = fromFile(parent, '/src/lib/container-visibility.ts');
    if (fromVisibility && request === '../model/training') return trainingStub;
    const fromHandler = fromFile(parent, '/src/handler/problem.ts') || fromFile(parent, '/src/handler/home.ts');
    if (!fromHandler) return originalLoad.call(this, request, parent, isMain);
    if (request === './contest') return contestHandlerStub;
    if (request === '../service/server') return serverStub;
    if (request === '../model/contest') return contestStub;
    if (request === '../model/training') return trainingStub;
    if (request === '../model/user') return userStub;
    if (request === '../model/problem') return problemStub;
    if (request === '../model/problem-pid-namespace') return pidNamespaceStub;
    if (request === '../model/builtin' || request === '../model/homework-access' || request === '../error' || request === '../lib/exam-paper' || request === '../lib/container-visibility') {
        return originalLoad.call(this, request, parent, isMain);
    }
    if (request.startsWith('../model/') || request.startsWith('../lib/') || request === '../context' || request === '../utils' || request === '../service/bus' || request === '../service/db') {
        return emptyExports();
    }
    return originalLoad.call(this, request, parent, isMain);
};

function readCtor(loaded: unknown, name: string): HandlerCtor {
    if (!loaded || typeof loaded !== 'object') throw new TypeError(`${name} module did not load`);
    const record = loaded as Record<string, unknown>;
    const direct = record[name];
    if (typeof direct === 'function') return direct as HandlerCtor;
    const nested = record.default;
    if (nested && typeof nested === 'object') {
        const inner = (nested as Record<string, unknown>)[name];
        if (typeof inner === 'function') return inner as HandlerCtor;
    }
    throw new TypeError(`${name} is not exported`);
}

let ProblemMainHandler: HandlerCtor;
let ProblemDetailHandler: HandlerCtor;
let HomeHandler: HandlerCtor;
try {
    delete requireFromTest.cache[problemPath];
    delete requireFromTest.cache[homePath];
    ProblemMainHandler = readCtor(requireFromTest(problemPath), 'ProblemMainHandler');
    ProblemDetailHandler = readCtor(requireFromTest(problemPath), 'ProblemDetailHandler');
    HomeHandler = readCtor(requireFromTest(homePath), 'HomeHandler');
} finally {
    Module._load = originalLoad;
}

function makeUser(uid: number, perms: readonly bigint[]): Actor {
    const perm = perms.reduce((bits, item) => bits | item, 0n);
    return {
        _id: uid,
        group: [],
        canBrowse: true,
        _problemAclDomainId: DOMAIN,
        hasPerm(...wanted) {
            return wanted.some((item) => (perm & item) === item);
        },
        hasPriv() {
            return false;
        },
        own(doc) {
            return doc.owner === uid || (doc.maintainer ?? []).includes(uid);
        },
    };
}

const teacher = makeUser(TEACHER, [PERM.PERM_CREATE_CONTEST, PERM.PERM_CREATE_HOMEWORK, PERM.PERM_VIEW_CONTEST, PERM.PERM_VIEW_HOMEWORK]);
const student = makeUser(STUDENT, [PERM.PERM_VIEW_CONTEST, PERM.PERM_VIEW_HOMEWORK]);

function bind(handler: object, user: Actor): void {
    Object.assign(handler, {
        user,
        domain: { _id: DOMAIN },
        request: { json: true },
        response: { body: {} },
        session: {},
        args: {},
        UiContext: {},
        ctx: {
            setting: { get: () => 50 },
            parallel: async () => undefined,
        },
        url: () => '/unused',
        paginate: async (source: QueryCursor, page: number, limit: number) => {
            const rows = await source.skip((page - 1) * limit).limit(limit).toArray();
            return [rows, 0, rows.length];
        },
    });
}

function problemList(user: Actor): ProblemListHandler {
    const handler = new ProblemMainHandler();
    bind(handler, user);
    return handler as ProblemListHandler;
}

function problemDetail(user: Actor): ProblemDetailHandler {
    const handler = new ProblemDetailHandler();
    bind(handler, user);
    Object.assign(handler, {
        pdoc: { domainId: DOMAIN, docId: PROBLEM_ID, title: 'linked problem' },
        psdoc: {},
        response: { body: { pdoc: {} } },
    });
    return handler as ProblemDetailHandler;
}

function home(user: Actor): HomeListHandler {
    const handler = new HomeHandler();
    bind(handler, user);
    return handler as HomeListHandler;
}

function hexIds(docs: readonly { docId: ObjectId }[]): string[] {
    return docs.map((doc) => doc.docId.toHexString());
}

function sortedHex(docs: readonly { docId: ObjectId }[]): string[] {
    return hexIds(docs).sort();
}

function rowsOf(value: unknown): ContestDoc[] {
    if (!Array.isArray(value) || !Array.isArray(value[0])) throw new TypeError('homepage payload is not a row list');
    return value[0].filter((row): row is ContestDoc => !!row && typeof row === 'object' && row.docId instanceof ObjectId);
}

async function errorName(body: () => Promise<unknown>): Promise<string> {
    try {
        await body();
        return '';
    } catch (error) {
        return error instanceof Error ? error.name : 'unknown';
    }
}

async function openProblemBank(user: Actor, contestId: ObjectId): Promise<ProblemListHandler> {
    const handler = problemList(user);
    await handler.get(DOMAIN, 1, '', 20, false, true, 'default', '', '', 0, 'all', 'active', 'all', '', contestId);
    return handler;
}

function teacherOwns(doc: ContestDoc, uid: number): boolean {
    return doc.owner === uid || doc.maintainer.includes(uid);
}

describe('problem bank contest filter', () => {
    it("rejects a teacher filter for someone else's acm", async () => {
        const name = await errorName(() => openProblemBank(teacher, publicAcmId));
        expect(name).to.equal('ContestNotFoundError');
    });

    it('keeps a teacher filter for an acm the teacher owns', async () => {
        const handler = await openProblemBank(teacher, teacherOwnedId);
        expect(handler.response.body.filters?.contest).to.equal(teacherOwnedId.toHexString());
    });
});

describe('problem page related contests', () => {
    it('keeps only contests the teacher owns', async () => {
        const handler = problemDetail(teacher);
        await handler.get();
        const ownedContests = contests.filter((doc) => doc.pids.includes(PROBLEM_ID) && listedRules.includes(doc.rule) && teacherOwns(doc, TEACHER));
        const ownedHomework = contests.filter((doc) => doc.pids.includes(PROBLEM_ID) && doc.rule === 'homework' && teacherOwns(doc, TEACHER));
        expect(sortedHex(handler.response.body.ctdocs ?? [])).to.deep.equal(sortedHex(ownedContests));
        expect(sortedHex(handler.response.body.htdocs ?? [])).to.deep.equal(sortedHex(ownedHomework));
    });
});

describe('homepage contest list', () => {
    it('returns the pre-change rows for a student on the same fixture', async () => {
        const scope = await resolveContestListParticipantScope(DOMAIN, student._id, false, parentSchoolIdsFromUser(student));
        const query = { rule: { $in: listedRules }, ...listAccessQuery(student._id, [], false, scope) };
        const expected = sortDocs(
            contests.filter((doc) => matches(doc, query)),
            HOME_CONTEST_SORT,
        );
        const visible = contests.filter(
            (doc) => listedRules.includes(doc.rule) && isListVisibleToUser(doc, student._id, [], false, scope),
        );
        expect(hexIds(sortDocs(visible, HOME_CONTEST_SORT))).to.deep.equal(hexIds(expected));
        const rows = rowsOf(await home(student).getContest(DOMAIN, 10));
        expect(hexIds(rows)).to.deep.equal(hexIds(expected));
    });

    it('returns only contests the teacher owns', async () => {
        const expected = contests.filter((doc) => listedRules.includes(doc.rule) && teacherOwns(doc, TEACHER));
        const rows = rowsOf(await home(teacher).getContest(DOMAIN, 10));
        expect(sortedHex(rows)).to.deep.equal(sortedHex(expected));
    });
});

describe('homepage homework list', () => {
    it('returns only homework the teacher owns or a course references', async () => {
        const expected = contests.filter((doc) => doc.rule === 'homework' && (teacherOwns(doc, TEACHER) || doc.docId.equals(courseHomeworkId)));
        const rows = rowsOf(await home(teacher).getHomework(DOMAIN, 5));
        expect(sortedHex(rows)).to.deep.equal(sortedHex(expected));
    });
});
