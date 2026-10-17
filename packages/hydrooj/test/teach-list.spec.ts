import { createRequire, type Module as NodeModule } from 'node:module';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { examPaperQuotaTotal, PERM, PRIV, teachStatusOf } from '@hydrooj/common';
import { PermissionError, PrivilegeError, ValidationError } from '../src/error';
import { isProblemSetKind, problemSetKindClause, withProblemSetKind } from '../src/lib/training-kind';

// The handler module is created by the implementation lane. Load it at runtime
// so this file still typechecks before that module exists.
// This line matches @hydrooj/register's CJS strip so __filename stays defined.
const __filename = fileURLToPath(import.meta.url);
const requireFromTest = createRequire(__filename);

const DOMAIN = 'teach';
const PAGE_SIZE = 20;
const TYPE_CONTEST = 30;
const TYPE_TRAINING = 40;
const LOGIN = PRIV.PRIV_USER_PROFILE;
const NOW = Date.now();

type TeachHandlerError = typeof ValidationError | typeof PermissionError | typeof PrivilegeError;

interface TeachActor {
    _id: number;
    uname: string;
    perm: bigint;
    priv: number;
    scope: bigint;
    hasPerm: (...perms: bigint[]) => boolean;
    hasPriv: (...privs: number[]) => boolean;
    own: (doc: { owner: number; maintainer?: number[] }, exact?: boolean) => boolean;
}

interface StoredDoc extends Record<string, unknown> {
    domainId: string;
    docType: number;
    _id: ObjectId;
    docId: ObjectId;
}

interface RegisteredRoute {
    name: string;
    path: string;
    Handler: new (...args: unknown[]) => TeachListTestHandler;
    extras: unknown[];
}

interface ListQuery {
    scope?: string;
    type?: string;
    status?: string;
    q?: string;
    page?: string;
}

const groupA = new ObjectId('64b00000000000000000000a');
const groupB = new ObjectId('64b00000000000000000000b');
const groupC = new ObjectId('64b00000000000000000000c');
const groupD = new ObjectId('64b00000000000000000000d');
const schoolId = new ObjectId('64b0000000000000000000e1');
const examQuotas = { single: 2, programming: 1 };
const examDrawCount = examPaperQuotaTotal(examQuotas);

const directories = {
    groups: [
        { _id: groupA, domainId: DOMAIN, schoolId, name: 'A班' },
        { _id: groupB, domainId: DOMAIN, schoolId, name: 'B班' },
        { _id: groupC, domainId: DOMAIN, schoolId, name: 'C班' },
        { _id: groupD, domainId: DOMAIN, schoolId, name: 'D班' },
    ],
    schools: [{ _id: schoolId, domainId: DOMAIN, name: '民航大学', staffUids: [] as number[] }],
};

const userNames: Record<number, string> = {
    1: '出题人',
    2: '系统管理员',
    4: '练习老师',
    5: '比赛老师',
    6: '题集编辑',
    7: '李老师',
    8: '周老师',
    9: '王老师',
    11: '比赛编辑',
    12: '作业编辑',
    15: '翻页老师',
};

function hoursFromNow(count: number): Date {
    return new Date(NOW + count * 60 * 60 * 1000);
}

function createdId(offsetSeconds: number, nonce: number): ObjectId {
    const seconds = Math.floor(Date.parse('2026-01-01T00:00:00.000Z') / 1000) + offsetSeconds;
    return new ObjectId(`${seconds.toString(16).padStart(8, '0')}${nonce.toString(16).padStart(16, '0')}`);
}

function contestDoc(input: {
    offset: number;
    nonce: number;
    owner: number;
    maintainer?: number[];
    rule: string;
    title: string;
    beginAt: Date;
    endAt: Date;
    pids: number[];
    participantScopeMode: 'none' | 'groups' | 'schools';
    participantGroupIds?: ObjectId[];
    participantSchoolIds?: ObjectId[];
    examPaperQuotas?: Record<string, number>;
    /** Hydro stores this contest limit in hours. The list reports minutes. */
    duration?: number;
    shared?: boolean;
    domainId?: string;
}): StoredDoc {
    const id = createdId(input.offset, input.nonce);
    const doc: StoredDoc = {
        domainId: input.domainId ?? DOMAIN,
        docType: TYPE_CONTEST,
        _id: id,
        docId: id,
        owner: input.owner,
        maintainer: input.maintainer ?? [],
        rule: input.rule,
        title: input.title,
        beginAt: input.beginAt,
        endAt: input.endAt,
        pids: input.pids,
        participantScopeMode: input.participantScopeMode,
        participantGroupIds: input.participantGroupIds ?? [],
        participantSchoolIds: input.participantSchoolIds ?? [],
    };
    if (input.examPaperQuotas) doc.examPaperQuotas = input.examPaperQuotas;
    if (input.duration !== undefined) doc.duration = input.duration;
    if (input.shared) doc.schoolShared = { sharedBy: input.owner, sharedAt: new Date('2026-10-01T00:00:00.000Z') };
    return doc;
}

function practiceDoc(input: {
    offset: number;
    nonce: number;
    owner: number;
    title: string;
    dag: Array<{ _id: number; title: string; pids: number[] }>;
    audience: { public: boolean; groupIds: ObjectId[] };
    shared?: boolean;
    kind?: string;
    domainId?: string;
}): StoredDoc {
    const id = createdId(input.offset, input.nonce);
    const doc: StoredDoc = {
        domainId: input.domainId ?? DOMAIN,
        docType: TYPE_TRAINING,
        _id: id,
        docId: id,
        owner: input.owner,
        maintainer: [],
        kind: input.kind ?? 'problem_set',
        title: input.title,
        dag: input.dag.map((stage) => ({ ...stage, requireNids: [] as number[] })),
        problemSetAudience: input.audience,
    };
    if (input.shared) doc.schoolShared = { sharedBy: input.owner, sharedAt: new Date('2026-10-02T00:00:00.000Z') };
    return doc;
}

const runningBegin = hoursFromNow(-2);
const runningEnd = hoursFromNow(2);
const upcomingBegin = hoursFromNow(3);
const upcomingEnd = hoursFromNow(6);
const endedBegin = hoursFromNow(-10);
const endedEnd = hoursFromNow(-2);

const practiceA = practiceDoc({
    offset: 500,
    nonce: 1,
    owner: 9,
    title: '兑换练习',
    dag: [
        { _id: 1, title: '阶段一', pids: [31, 32] },
        { _id: 2, title: '阶段二', pids: [33] },
    ],
    audience: { public: false, groupIds: [] },
    shared: true,
});
const acmA = contestDoc({
    offset: 400,
    nonce: 2,
    owner: 1,
    maintainer: [9],
    rule: 'acm',
    title: 'ACM 维护赛',
    beginAt: runningBegin,
    endAt: runningEnd,
    pids: [21, 22],
    participantScopeMode: 'none',
});
const practiceB = practiceDoc({
    offset: 390,
    nonce: 3,
    owner: 7,
    title: 'A.B 公开练习',
    dag: [{ _id: 1, title: '阶段', pids: [41] }],
    audience: { public: true, groupIds: [] },
});
const homeworkA = contestDoc({
    offset: 380,
    nonce: 4,
    owner: 7,
    rule: 'homework',
    title: 'C++ 作业',
    beginAt: runningBegin,
    endAt: runningEnd,
    pids: [51],
    participantScopeMode: 'none',
    duration: 2,
});
const examA = contestDoc({
    offset: 370,
    nonce: 5,
    owner: 7,
    rule: 'exam',
    title: '期中考试',
    beginAt: upcomingBegin,
    endAt: upcomingEnd,
    pids: [61, 62, 63, 64],
    participantScopeMode: 'schools',
    participantSchoolIds: [schoolId],
    examPaperQuotas: examQuotas,
});
const groups4 = contestDoc({
    offset: 360,
    nonce: 6,
    owner: 7,
    rule: 'acm',
    title: '四分组赛',
    beginAt: runningBegin,
    endAt: runningEnd,
    pids: [71],
    participantScopeMode: 'groups',
    participantGroupIds: [groupA, groupB, groupC, groupD],
});
const groups3 = contestDoc({
    offset: 350,
    nonce: 7,
    owner: 7,
    rule: 'acm',
    title: '三分组赛',
    beginAt: runningBegin,
    endAt: runningEnd,
    pids: [72],
    participantScopeMode: 'groups',
    participantGroupIds: [groupA, groupB, groupC],
});
const oiA = contestDoc({
    offset: 340,
    nonce: 8,
    owner: 7,
    rule: 'ioi',
    title: 'OI 选拔',
    beginAt: endedBegin,
    endAt: endedEnd,
    pids: [81],
    participantScopeMode: 'none',
});
const homeworkShared = contestDoc({
    offset: 140,
    nonce: 9,
    owner: 8,
    rule: 'homework',
    title: '共享作业',
    beginAt: runningBegin,
    endAt: runningEnd,
    pids: [91],
    participantScopeMode: 'none',
    shared: true,
});
const acmShared = contestDoc({
    offset: 130,
    nonce: 10,
    owner: 8,
    rule: 'acm',
    title: '共享比赛',
    beginAt: runningBegin,
    endAt: runningEnd,
    pids: [92, 93],
    participantScopeMode: 'none',
    shared: true,
});
const practiceShared = practiceDoc({
    offset: 120,
    nonce: 11,
    owner: 8,
    title: '共享练习',
    dag: [{ _id: 1, title: '阶段', pids: [94] }],
    audience: { public: true, groupIds: [] },
    shared: true,
});
const practiceHidden = practiceDoc({
    offset: 110,
    nonce: 12,
    owner: 8,
    title: '未共享练习',
    dag: [{ _id: 1, title: '阶段', pids: [95] }],
    audience: { public: false, groupIds: [] },
});
const codeforces = contestDoc({
    offset: 100,
    nonce: 13,
    owner: 7,
    rule: 'codeforces',
    title: '不应出现',
    beginAt: runningBegin,
    endAt: runningEnd,
    pids: [96],
    participantScopeMode: 'none',
});
const courseA = practiceDoc({
    offset: 90,
    nonce: 14,
    owner: 7,
    title: '课程不是题集',
    dag: [{ _id: 1, title: '章', pids: [97] }],
    audience: { public: true, groupIds: [] },
    kind: 'course',
});

const PAGE_DOMAIN = 'teachpage';
const PAGE_EACH = 45;
const pageOwner = 15;

function pageWave(): StoredDoc[] {
    const total = PAGE_EACH * 2;
    const docs: StoredDoc[] = [];
    for (let rank = 0; rank < total; rank += 1) {
        const offset = 2000 + (total - 1 - rank);
        const nonce = 100 + rank;
        if (rank % 2 === 0) {
            docs.push(practiceDoc({
                offset,
                nonce,
                owner: pageOwner,
                title: `翻页练习 ${rank}`,
                dag: [{ _id: 1, title: '阶段', pids: [rank + 1] }],
                audience: { public: true, groupIds: [] },
                domainId: PAGE_DOMAIN,
            }));
            continue;
        }
        const beginAt = new Date(Date.UTC(2030, 0, 1) + rank * 60 * 60 * 1000);
        docs.push(contestDoc({
            offset,
            nonce,
            owner: pageOwner,
            rule: 'acm',
            title: `翻页比赛 ${rank}`,
            beginAt,
            endAt: new Date(beginAt.getTime() + 2 * 60 * 60 * 1000),
            pids: [rank + 1],
            participantScopeMode: 'none',
            domainId: PAGE_DOMAIN,
        }));
    }
    return docs;
}

const pageWaveDocs = pageWave();

const containers: StoredDoc[] = [
    practiceA,
    acmA,
    practiceB,
    homeworkA,
    examA,
    groups4,
    groups3,
    oiA,
    homeworkShared,
    acmShared,
    practiceShared,
    practiceHidden,
    codeforces,
    courseA,
    ...pageWaveDocs,
];

function statusDoc(doc: StoredDoc, uid: number, fields: { attend?: number; enroll?: number }): StoredDoc {
    return {
        domainId: DOMAIN,
        docType: doc.docType,
        _id: createdId(1, uid + doc.docId.getTimestamp().getTime()),
        docId: doc.docId,
        uid,
        ...fields,
    };
}

const statuses: StoredDoc[] = [
    statusDoc(acmA, 101, { attend: 1 }),
    statusDoc(acmA, 102, { attend: 1 }),
    statusDoc(acmA, 103, { attend: 1 }),
    statusDoc(acmA, 104, { attend: 0 }),
    statusDoc(examA, 111, { attend: 1 }),
    statusDoc(examA, 112, { attend: 1 }),
    statusDoc(examA, 113, { attend: 1 }),
    statusDoc(examA, 114, { attend: 1 }),
    statusDoc(examA, 115, { attend: 1 }),
    statusDoc(practiceA, 121, { enroll: 1 }),
    statusDoc(practiceA, 122, { enroll: 1 }),
    statusDoc(practiceA, 123, { enroll: 1 }),
    statusDoc(practiceA, 124, { enroll: 1 }),
    statusDoc(practiceA, 125, { enroll: 0 }),
    statusDoc(practiceB, 131, { enroll: 1 }),
];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
    if (left instanceof ObjectId && typeof right === 'string') return left.toHexString() === right;
    if (right instanceof ObjectId && typeof left === 'string') return right.toHexString() === left;
    if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
    return Object.is(left, right);
}

function compareOrder(left: unknown, right: unknown): number | null {
    if (left instanceof ObjectId && right instanceof ObjectId) {
        const leftHex = left.toHexString();
        const rightHex = right.toHexString();
        if (leftHex === rightHex) return 0;
        return leftHex < rightHex ? -1 : 1;
    }
    if (left instanceof Date || right instanceof Date) {
        const leftTime = left instanceof Date ? left.getTime() : typeof left === 'string' || typeof left === 'number' ? new Date(left).getTime() : Number.NaN;
        const rightTime = right instanceof Date ? right.getTime() : typeof right === 'string' || typeof right === 'number' ? new Date(right).getTime() : Number.NaN;
        if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) return null;
        return leftTime - rightTime;
    }
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    if (typeof left === 'string' && typeof right === 'string') {
        if (left === right) return 0;
        return left < right ? -1 : 1;
    }
    return null;
}

function getPath(doc: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = doc;
    for (const part of parts) {
        if (Array.isArray(current)) {
            current = current.map((item) => (isRecord(item) ? item[part] : undefined)).filter((item) => item !== undefined);
            if (Array.isArray(current) && current.length === 0) return undefined;
            continue;
        }
        if (!isRecord(current) || !Object.hasOwn(current, part)) return undefined;
        current = current[part];
    }
    return current;
}

function isOperatorObject(value: unknown): value is Record<string, unknown> {
    if (!isRecord(value)) return false;
    const keys = Object.keys(value);
    return keys.length > 0 && keys.every((key) => key.startsWith('$'));
}

function regexOf(pattern: unknown, options: unknown): RegExp | null {
    const extra = typeof options === 'string' ? options : '';
    if (pattern instanceof RegExp) {
        const flags = Array.from(new Set(`${pattern.flags}${extra}`)).join('');
        return new RegExp(pattern.source, flags);
    }
    if (typeof pattern === 'string') return new RegExp(pattern, extra);
    return null;
}

function matchesOperators(docValue: unknown, ops: Record<string, unknown>): boolean {
    const expression = ops.$regex === undefined ? null : regexOf(ops.$regex, ops.$options);
    for (const [op, expected] of Object.entries(ops)) {
        if (op === '$options') continue;
        if (op === '$regex') {
            const text = typeof docValue === 'string' ? docValue : docValue === undefined || docValue === null ? '' : null;
            if (text === null || !expression || !expression.test(text)) return false;
            continue;
        }
        if (op === '$eq') {
            if (!sameValue(docValue, expected)) return false;
            continue;
        }
        if (op === '$ne') {
            if (matchesElement(docValue, expected)) return false;
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
            const exists = docValue !== undefined;
            if (exists !== Boolean(expected)) return false;
            continue;
        }
        if (op === '$gt' || op === '$gte' || op === '$lt' || op === '$lte') {
            const compared = compareOrder(docValue, expected);
            if (compared === null) return false;
            if (op === '$gt' && !(compared > 0)) return false;
            if (op === '$gte' && !(compared >= 0)) return false;
            if (op === '$lt' && !(compared < 0)) return false;
            if (op === '$lte' && !(compared <= 0)) return false;
            continue;
        }
        return false;
    }
    return true;
}

function matchesElement(docValue: unknown, queryValue: unknown): boolean {
    if (Array.isArray(docValue)) return docValue.some((item) => sameValue(item, queryValue));
    return sameValue(docValue, queryValue);
}

function matchesValue(docValue: unknown, queryValue: unknown): boolean {
    if (queryValue instanceof RegExp) {
        return typeof docValue === 'string' && new RegExp(queryValue.source, queryValue.flags).test(docValue);
    }
    if (isOperatorObject(queryValue)) return matchesOperators(docValue, queryValue);
    if (Array.isArray(docValue) && !Array.isArray(queryValue)) return docValue.some((item) => sameValue(item, queryValue));
    return sameValue(docValue, queryValue);
}

function matchesQuery(doc: Record<string, unknown>, query: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(query)) {
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
        if (!matchesValue(getPath(doc, key), value)) return false;
    }
    return true;
}

class MemoryCursor {
    private sortSpec: Record<string, number> | null = null;

    private limitCount: number | null = null;

    private skipCount = 0;

    constructor(private readonly rows: StoredDoc[]) {}

    sort(spec: Record<string, number>): this {
        this.sortSpec = spec;
        return this;
    }

    limit(count: number): this {
        this.limitCount = count;
        return this;
    }

    skip(count: number): this {
        this.skipCount = count;
        return this;
    }

    project(): this {
        return this;
    }

    async count(): Promise<number> {
        return this.rows.length;
    }

    async toArray(): Promise<StoredDoc[]> {
        return this.materialize();
    }

    async *[Symbol.asyncIterator](): AsyncGenerator<StoredDoc> {
        const rows = this.materialize();
        for (const row of rows) yield row;
    }

    private materialize(): StoredDoc[] {
        const sorted = this.rows.map((row) => ({ ...row }));
        const spec = this.sortSpec;
        if (spec) {
            sorted.sort((left, right) => {
                for (const [key, direction] of Object.entries(spec)) {
                    const compared = compareOrder(getPath(left, key), getPath(right, key));
                    if (compared === null || compared === 0) continue;
                    return compared * direction;
                }
                return 0;
            });
        }
        const end = this.limitCount === null ? undefined : this.skipCount + this.limitCount;
        return sorted.slice(this.skipCount, end);
    }
}

function cursorFor(rows: StoredDoc[], query: Record<string, unknown>): MemoryCursor {
    return new MemoryCursor(rows.filter((row) => matchesQuery(row, query)));
}

function countRows(rows: StoredDoc[], query: Record<string, unknown>): number {
    return rows.filter((row) => matchesQuery(row, query)).length;
}

const documentExports = {
    __esModule: true as const,
    TYPE_CONTEST,
    TYPE_TRAINING,
    getMulti(domainId: string, docType: number, query?: Record<string, unknown>) {
        return cursorFor(containers, { docType, domainId, ...(query ?? {}) });
    },
    count(domainId: string, docType: number, query?: Record<string, unknown>) {
        return Promise.resolve(countRows(containers, { docType, domainId, ...(query ?? {}) }));
    },
    async get(domainId: string, docType: number, docId: unknown) {
        const found = containers.find((row) => matchesQuery(row, { domainId, docType, docId }));
        return found ?? null;
    },
    getMultiStatus(domainId: string, docType: number, query?: Record<string, unknown>) {
        return cursorFor(statuses, { docType, domainId, ...(query ?? {}) });
    },
    countStatus(domainId: string, docType: number, query?: Record<string, unknown>) {
        return Promise.resolve(countRows(statuses, { docType, domainId, ...(query ?? {}) }));
    },
    coll: {
        find(query: Record<string, unknown> = {}) {
            return cursorFor(containers, query);
        },
        countDocuments(query: Record<string, unknown> = {}) {
            return Promise.resolve(countRows(containers, query));
        },
    },
    collStatus: {
        find(query: Record<string, unknown> = {}) {
            return cursorFor(statuses, query);
        },
        countDocuments(query: Record<string, unknown> = {}) {
            return Promise.resolve(countRows(statuses, query));
        },
    },
};

const trainingExports = {
    __esModule: true as const,
    isProblemSetKind,
    problemSetKindClause,
    withProblemSetKind,
    getMulti(domainId: string, query: Record<string, unknown> = {}) {
        return documentExports.getMulti(domainId, TYPE_TRAINING, query).sort({ pin: -1, _id: -1 });
    },
    count(domainId: string, query: Record<string, unknown> = {}) {
        return documentExports.count(domainId, TYPE_TRAINING, query);
    },
    getMultiStatus(domainId: string, query: Record<string, unknown> = {}) {
        return documentExports.getMultiStatus(domainId, TYPE_TRAINING, query);
    },
};

const contestExports = {
    __esModule: true as const,
    RULES: {
        acm: {},
        oi: {},
        ioi: {},
        ledo: {},
        strictioi: {},
        exam: {},
        homework: { hidden: true },
    },
    getMulti(domainId: string, query: Record<string, unknown> = {}) {
        // Production contest.getMulti sorts by beginAt first. A later _id sort must replace it.
        return documentExports.getMulti(domainId, TYPE_CONTEST, query).sort({ beginAt: -1 });
    },
    count(domainId: string, query: Record<string, unknown> = {}) {
        return documentExports.count(domainId, TYPE_CONTEST, query);
    },
};

const userApi = {
    async getList(_domainId: string, uids: readonly number[]) {
        const listed: Record<string, { _id: number; uname: string }> = {};
        for (const uid of uids) listed[String(uid)] = { _id: uid, uname: userNames[uid] ?? `用户${uid}` };
        return listed;
    },
    async getById(_domainId: string, uid: number) {
        return { _id: uid, uname: userNames[uid] ?? `用户${uid}` };
    },
    async get(domainId: string, uid: number) {
        return this.getById(domainId, uid);
    },
};

const userExports = { __esModule: true as const, default: userApi, ...userApi };

function sameId(left: unknown, right: ObjectId): boolean {
    if (left instanceof ObjectId) return left.equals(right);
    return String(left) === right.toHexString();
}

const directoryApi = {
    async listSchools(domainId: string) {
        return directories.schools.filter((school) => school.domainId === domainId);
    },
    async getSchool(domainId: string, id: ObjectId) {
        return directories.schools.find((school) => school.domainId === domainId && sameId(school._id, id)) ?? null;
    },
    async listUserGroups(domainId: string, filterSchoolId?: ObjectId) {
        return directories.groups.filter((group) => group.domainId === domainId && (!filterSchoolId || sameId(group.schoolId, filterSchoolId)));
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
    async findBoundStudentsByGroupIds() {
        return [];
    },
    async loadExamRosterUserbindSnapshot() {
        throw new Error('teach list does not load an exam roster');
    },
    async lookupStudent() {
        return { found: false, eligibleContestIds: [] as ObjectId[] };
    },
};

const directoryExports = {
    __esModule: true as const,
    studentDirectory: () => directoryApi,
    registerStudentDirectory() {
        return undefined;
    },
    async withStudentDirectory(_adapter: unknown, fn: () => Promise<unknown>) {
        return fn();
    },
};

class TeachListTestHandler {
    user: TeachActor = teacher(0, [], []);

    domain = { _id: DOMAIN };

    response: { body: unknown; template: string | null; redirect?: string } = { body: null, template: null };

    request = {
        query: {} as Record<string, string>,
        json: false,
        headers: {} as Record<string, string>,
        method: 'GET',
        path: '/teach',
    };

    args: Record<string, unknown> = {};

    session: Record<string, unknown> = {};

    ctx = {
        parallel: () => Promise.resolve(),
        setting: { get: () => undefined },
    };

    checkPriv(...privs: number[]): void {
        if (!this.user.hasPriv(...privs)) throw new PrivilegeError(...privs);
    }

    checkPerm(...perms: bigint[]): void {
        if (!this.user.hasPerm(...perms)) throw new PermissionError(...perms);
    }

    async get(_args: Record<string, unknown>): Promise<unknown> {
        throw new TypeError('teach export missing: get');
    }
}

const frameworkDecorators = requireFromTest('@hydrooj/framework/decorators') as { param: unknown; query: unknown; get: unknown; post: unknown; route: unknown };
const frameworkValidator = requireFromTest('@hydrooj/framework/validator') as { Types: unknown };
const serverExports = {
    __esModule: true as const,
    Handler: TeachListTestHandler,
    param: frameworkDecorators.param,
    query: frameworkDecorators.query,
    get: frameworkDecorators.get,
    post: frameworkDecorators.post,
    route: frameworkDecorators.route,
    Types: frameworkValidator.Types,
};

const replaced: Array<{ resolved: string; previous: NodeModule | undefined }> = [];

function installStub(relativePath: string, exports: Record<string, unknown>): void {
    const resolved = requireFromTest.resolve(relativePath);
    replaced.push({ resolved, previous: requireFromTest.cache[resolved] });
    requireFromTest.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports,
    } as NodeModule;
}

installStub('../src/service/db.ts', { collection: () => ({ find: () => ({ toArray: async () => [] }) }) });
installStub('../src/model/document.ts', documentExports);
installStub('../src/model/training.ts', trainingExports);
installStub('../src/model/contest.ts', contestExports);
installStub('../src/model/user.ts', userExports);
installStub('../src/service/student-directory.ts', directoryExports);
installStub('../src/service/server.ts', serverExports);

const hydroHost = global as unknown as { Hydro?: { model?: Record<string, unknown> } };
hydroHost.Hydro ||= { model: {} };
hydroHost.Hydro.model ||= {};
hydroHost.Hydro.model.document = documentExports;
hydroHost.Hydro.model.training = trainingExports;
hydroHost.Hydro.model.contest = contestExports;
hydroHost.Hydro.model.user = userApi;

after(() => {
    for (const item of replaced) {
        if (item.previous) requireFromTest.cache[item.resolved] = item.previous;
        else delete requireFromTest.cache[item.resolved];
    }
});

function teacher(uid: number, perms: readonly bigint[], privs: readonly number[]): TeachActor {
    let permMask = 0n;
    for (const perm of perms) permMask |= perm;
    let privMask = 0;
    for (const priv of privs) privMask |= priv;
    return {
        _id: uid,
        uname: userNames[uid] ?? `用户${uid}`,
        perm: permMask,
        priv: privMask,
        scope: -1n,
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => (permMask & perm) === perm),
        hasPriv: (...wanted: number[]) => wanted.some((priv) => (privMask & priv) === priv),
        own: (doc, exact) => (exact === true ? doc.owner === uid : doc.owner === uid || (doc.maintainer ?? []).includes(uid)),
    };
}

const creators = [PERM.PERM_CREATE_CONTEST, PERM.PERM_CREATE_HOMEWORK, PERM.PERM_CREATE_TRAINING];
const user9 = teacher(9, creators, [LOGIN]);
const user7 = teacher(7, creators, [LOGIN]);
const user4 = teacher(4, [PERM.PERM_CREATE_TRAINING], [LOGIN]);
const user5 = teacher(5, [PERM.PERM_CREATE_CONTEST], [LOGIN]);
const user3 = teacher(3, [], [LOGIN]);
const user6 = teacher(6, [PERM.PERM_EDIT_TRAINING], [LOGIN]);
const user11 = teacher(11, [PERM.PERM_EDIT_CONTEST], [LOGIN]);
const user12 = teacher(12, [PERM.PERM_EDIT_HOMEWORK], [LOGIN]);
const user2 = teacher(2, [], [LOGIN, PRIV.PRIV_EDIT_SYSTEM]);
const user15 = teacher(pageOwner, creators, [LOGIN]);
const guest = teacher(0, [], []);

let loadingRoute: Promise<RegisteredRoute> | null = null;

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

async function loadRoute(): Promise<RegisteredRoute> {
    if (!loadingRoute) loadingRoute = loadRouteOnce();
    return loadingRoute;
}

async function loadRouteOnce(): Promise<RegisteredRoute> {
    const loaded: unknown = requireFromTest('../src/handler/teach-list.ts');
    if (!isRecord(loaded)) throw new TypeError('teach export missing: apply');
    const apply = readApply(loaded);
    if (!apply) throw new TypeError('teach export missing: apply');
    const routes: RegisteredRoute[] = [];
    await apply({
        Route(name: string, path: string, Handler: new (...args: unknown[]) => TeachListTestHandler, ...extras: unknown[]) {
            routes.push({ name, path, Handler, extras });
        },
    });
    const route = routes.find((item) => item.name === 'teach_main') ?? routes.find((item) => item.path === '/teach');
    if (!route) throw new TypeError('teach export missing: teach_main');
    return route;
}

function runChecks(handler: TeachListTestHandler, extras: unknown[]): void {
    for (const item of extras) {
        if (typeof item === 'number') handler.checkPriv(item);
        else if (typeof item === 'bigint') handler.checkPerm(item);
        else if (Array.isArray(item) && item.every((entry) => typeof entry === 'number')) handler.checkPriv(...item);
        else if (Array.isArray(item) && item.every((entry) => typeof entry === 'bigint')) handler.checkPerm(...item);
        else if (typeof item === 'function') item.call(handler);
    }
}

async function callList(actor: TeachActor, query: ListQuery = {}, domainId = DOMAIN): Promise<TeachListTestHandler> {
    const route = await loadRoute();
    const handler = new route.Handler();
    const args = { domainId, ...query };
    handler.user = actor;
    handler.domain = { _id: domainId };
    handler.request.query = { ...query };
    handler.args = args;
    runChecks(handler, route.extras);
    await handler.get(args);
    return handler;
}

function errorText(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function expectNamedError(run: () => Promise<unknown>, expected: TeachHandlerError): Promise<void> {
    try {
        await run();
    } catch (error) {
        if (isMissingImplementation(error)) throw error;
        expect(error instanceof expected || (error instanceof Error && error.name === expected.name), errorText(error)).to.equal(true);
        return;
    }
    throw new Error(`expected ${expected.name}`);
}

function payloadOf(handler: TeachListTestHandler): Record<string, unknown> {
    expect(handler.response.template).to.equal('teach_main.html');
    expect(isRecord(handler.response.body), 'response body').to.equal(true);
    if (!isRecord(handler.response.body)) throw new Error('teach list payload missing');
    return handler.response.body;
}

function recordRows(value: unknown, label: string): Record<string, unknown>[] {
    expect(Array.isArray(value), label).to.equal(true);
    if (!Array.isArray(value)) return [];
    for (const row of value) expect(isRecord(row), label).to.equal(true);
    return value.filter(isRecord);
}

function rowsOf(body: Record<string, unknown>): Record<string, unknown>[] {
    const shared = recordRows(body.sharedRows, 'sharedRows');
    expect(shared.length).to.equal(0);
    return recordRows(body.rows, 'rows');
}

function sharedOf(body: Record<string, unknown>): Record<string, unknown>[] {
    const rows = recordRows(body.rows, 'rows');
    expect(rows.length).to.equal(0);
    return recordRows(body.sharedRows, 'sharedRows');
}

function expectCounts(
    body: Record<string, unknown>,
    counts: { practice: number; quiz: number; acm: number; oi: number },
    total = counts.practice + counts.quiz + counts.acm + counts.oi,
): void {
    expect(isRecord(body.typeCounts), 'typeCounts').to.equal(true);
    if (!isRecord(body.typeCounts)) return;
    expect(body.typeCounts.practice).to.equal(counts.practice);
    expect(body.typeCounts.quiz).to.equal(counts.quiz);
    expect(body.typeCounts.acm).to.equal(counts.acm);
    expect(body.typeCounts.oi).to.equal(counts.oi);
    expect(body.typeCounts.all).to.equal(counts.practice + counts.quiz + counts.acm + counts.oi);
    expect(body.total).to.equal(total);
    if (total > 0) expect(body.pageCount).to.equal(Math.ceil(total / PAGE_SIZE));
}

function expectFilter(body: Record<string, unknown>, query: { scope: string; type: string; status: string; q: string; page: number; canSeeAll: boolean }): void {
    expect(body.scope).to.equal(query.scope);
    expect(body.canSeeAll).to.equal(query.canSeeAll);
    expect(body.page).to.equal(query.page);
    expect(isRecord(body.filter), 'filter').to.equal(true);
    if (!isRecord(body.filter)) return;
    expect(body.filter.type).to.equal(query.type);
    expect(body.filter.status).to.equal(query.status);
    expect(body.filter.q).to.equal(query.q);
}

function expectDescending(rows: Record<string, unknown>[]): void {
    const ids = rows.map((row) => String(row.id));
    const sorted = [...ids].sort((left, right) => (left < right ? 1 : left > right ? -1 : 0));
    expect(ids).to.deep.equal(sorted);
}

function rowById(rows: Record<string, unknown>[], doc: StoredDoc): Record<string, unknown> {
    const found = rows.find((row) => row.id === doc.docId.toHexString());
    expect(found === undefined, String(doc.title)).to.equal(false);
    if (!found) throw new Error(`missing row ${String(doc.title)}`);
    return found;
}

function typesOf(rows: Record<string, unknown>[]): string[] {
    return rows.map((row) => String(row.type));
}

describe('teach list', () => {
    it('registers get /teach as teach_main', async () => {
        const route = await loadRoute();
        expect(route.name).to.equal('teach_main');
        expect(route.path).to.equal('/teach');
    });

    it('returns the owned practice and maintained acm newest first', async () => {
        const body = payloadOf(await callList(user9, { scope: 'mine', type: 'all', status: 'all', q: '', page: '1' }));
        expectFilter(body, { scope: 'mine', type: 'all', status: 'all', q: '', page: 1, canSeeAll: false });
        expectCounts(body, { practice: 1, quiz: 0, acm: 1, oi: 0 });
        const rows = rowsOf(body);
        expect(rows.length).to.equal(2);
        expectDescending(rows);
        const practice = rowById(rows, practiceA);
        const acm = rowById(rows, acmA);
        expect(rows[0]).to.equal(practice);
        expect(rows[1]).to.equal(acm);
        expect(practice.type).to.equal('practice');
        expect(practice.rule).to.equal('problem_set');
        expect(practice.role).to.equal('owner');
        expect(practice.status).to.equal('open');
        expect(practice.shared).to.equal(true);
        expect(practice.stageCount).to.equal(2);
        expect(practice.drawCount).to.equal(null);
        expect(practice.beginAt).to.equal(null);
        expect(practice.endAt).to.equal(null);
        expect(practice.durationMinutes).to.equal(null);
        expect(practice.participantCount).to.equal(4);
        expect(practice.audience).to.equal('仅兑换码');
        expect(practice.createdAt).to.equal(practiceA._id.getTimestamp().toISOString());
        expect(acm.type).to.equal('acm');
        expect(acm.rule).to.equal('acm');
        expect(acm.role).to.equal('maintainer');
        expect(acm.status).to.equal(teachStatusOf({ type: 'acm', beginAt: runningBegin, endAt: runningEnd }, new Date()));
        expect(acm.shared).to.equal(false);
        expect(acm.problemCount).to.equal(2);
        expect(acm.stageCount).to.equal(null);
        expect(acm.drawCount).to.equal(null);
        expect(acm.durationMinutes).to.equal(null);
        expect(acm.participantCount).to.equal(3);
        expect(acm.audience).to.equal('所有人');
        expect(acm.beginAt).to.equal(runningBegin.toISOString());
        expect(acm.endAt).to.equal(runningEnd.toISOString());
        expect(acm.createdAt).to.equal(acmA._id.getTimestamp().toISOString());
        expect(body.canCreate).to.deep.equal({ practice: true, homework: true, exam: true, acm: true, oi: true });
    });

    it('returns only homework and exam for quiz and keeps the other type counts', async () => {
        const body = payloadOf(await callList(user7, { scope: 'mine', type: 'quiz', status: 'all', q: '', page: '1' }));
        expectFilter(body, { scope: 'mine', type: 'quiz', status: 'all', q: '', page: 1, canSeeAll: false });
        expectCounts(body, { practice: 1, quiz: 2, acm: 2, oi: 1 }, 2);
        const rows = rowsOf(body);
        expect(typesOf(rows).every((type) => type === 'homework' || type === 'exam')).to.equal(true);
        expect(rows.some((row) => row.type === 'homework')).to.equal(true);
        expect(rows.some((row) => row.type === 'exam')).to.equal(true);
        expect(body.typeCounts && isRecord(body.typeCounts) ? body.typeCounts.quiz : null).to.equal(
            rows.filter((row) => row.type === 'homework').length + rows.filter((row) => row.type === 'exam').length,
        );
        const homework = rowById(rows, homeworkA);
        const exam = rowById(rows, examA);
        expect(homework.drawCount).to.equal(null);
        expect(homework.audience).to.equal('所有人');
        expect(exam.drawCount).to.equal(examDrawCount);
        expect(exam.audience).to.equal('民航大学');
        expect(exam.problemCount).to.equal(4);
        expectDescending(rows);
    });

    it('hides the caller from shared rows and hides contests the caller cannot create', async () => {
        const own = payloadOf(await callList(user9, { scope: 'shared', type: 'all', status: 'all', q: '', page: '1' }));
        expectFilter(own, { scope: 'shared', type: 'all', status: 'all', q: '', page: 1, canSeeAll: false });
        const ownRows = sharedOf(own);
        expect(ownRows.map((row) => row.id)).to.deep.equal([
            homeworkShared.docId.toHexString(),
            acmShared.docId.toHexString(),
            practiceShared.docId.toHexString(),
        ]);
        expect(ownRows.some((row) => row.id === practiceA.docId.toHexString())).to.equal(false);
        expect(ownRows.some((row) => row.id === practiceHidden.docId.toHexString())).to.equal(false);
        const sharedHomework = rowById(ownRows, homeworkShared);
        expect(sharedHomework.ownerUid).to.equal(8);
        expect(sharedHomework.ownerName).to.equal('周老师');
        expect(sharedHomework.sharedAt).to.equal(new Date('2026-10-01T00:00:00.000Z').toISOString());
        expect(sharedHomework.rule).to.equal('homework');
        expectDescending(ownRows);

        const trainingOnly = payloadOf(await callList(user4, { scope: 'shared', type: 'all', status: 'all', q: '', page: '1' }));
        const trainingRows = sharedOf(trainingOnly);
        expect(typesOf(trainingRows).every((type) => type === 'practice')).to.equal(true);
        expect(trainingRows.map((row) => row.id)).to.deep.equal([practiceA.docId.toHexString(), practiceShared.docId.toHexString()]);
        expect(trainingOnly.canCreate).to.deep.equal({ practice: true, homework: false, exam: false, acm: false, oi: false });
    });

    it('rejects scope=all for a teacher who can only create contests', async () => {
        const mine = payloadOf(await callList(user5, { scope: 'mine' }));
        expect(mine.canSeeAll).to.equal(false);
        expect(mine.total).to.equal(0);
        await expectNamedError(() => callList(user5, { scope: 'all' }), PermissionError);
    });

    it('describes a private practice with no groups as redeem only', async () => {
        const body = payloadOf(await callList(user9, { scope: 'mine', type: 'practice' }));
        const rows = rowsOf(body);
        expect(rows.length).to.equal(1);
        expect(rows[0].audience).to.equal('仅兑换码');
        expect(rows[0].id).to.equal(practiceA.docId.toHexString());
    });

    it('returns only practice rows for status=open', async () => {
        const body = payloadOf(await callList(user7, { scope: 'mine', type: 'all', status: 'open', q: '', page: '1' }));
        expectFilter(body, { scope: 'mine', type: 'all', status: 'open', q: '', page: 1, canSeeAll: false });
        expectCounts(body, { practice: 1, quiz: 0, acm: 0, oi: 0 });
        const rows = rowsOf(body);
        expect(rows.map((row) => row.id)).to.deep.equal([practiceB.docId.toHexString()]);
        expect(rows[0].type).to.equal('practice');
        expect(rows[0].status).to.equal('open');
        expect(rows[0].audience).to.equal('所有人');
        expect(rows[0].stageCount).to.equal(1);
    });

    it('rejects an unknown scope, type, or status', async () => {
        await expectNamedError(() => callList(user9, { scope: 'foo' }), ValidationError);
        await expectNamedError(() => callList(user9, { type: 'homework' }), ValidationError);
        await expectNamedError(() => callList(user9, { status: 'soon' }), ValidationError);
    });

    it('sends a signed-out caller to login', async () => {
        await expectNamedError(() => callList(guest, { scope: 'mine' }), PrivilegeError);
    });

    it('rejects a signed-in teacher who cannot create or edit any type', async () => {
        await expectNamedError(() => callList(user3, { scope: 'mine' }), PermissionError);
    });

    it('limits scope=all to the container types that teacher can edit', async () => {
        const practice = payloadOf(await callList(user6, { scope: 'all', type: 'all', status: 'all', q: '', page: '1' }));
        expect(practice.canSeeAll).to.equal(true);
        expectCounts(practice, { practice: 4, quiz: 0, acm: 0, oi: 0 });
        const practiceRows = rowsOf(practice);
        expect(typesOf(practiceRows).every((type) => type === 'practice')).to.equal(true);
        expect(practiceRows.map((row) => row.id).sort()).to.deep.equal([
            practiceA.docId.toHexString(),
            practiceB.docId.toHexString(),
            practiceShared.docId.toHexString(),
            practiceHidden.docId.toHexString(),
        ].sort());
        expect(practice.canCreate).to.deep.equal({ practice: false, homework: false, exam: false, acm: false, oi: false });

        const contests = payloadOf(await callList(user11, { scope: 'all', type: 'all', status: 'all', q: '', page: '1' }));
        expectCounts(contests, { practice: 0, quiz: 1, acm: 4, oi: 1 });
        const contestRows = rowsOf(contests);
        expect(contestRows.every((row) => row.type === 'exam' || row.type === 'acm' || row.type === 'oi')).to.equal(true);
        expect(contestRows.some((row) => row.type === 'homework' || row.type === 'practice')).to.equal(false);

        const homework = payloadOf(await callList(user12, { scope: 'all', type: 'all', status: 'all', q: '', page: '1' }));
        expectCounts(homework, { practice: 0, quiz: 2, acm: 0, oi: 0 });
        expect(rowsOf(homework).every((row) => row.type === 'homework')).to.equal(true);

        const admin = payloadOf(await callList(user2, { scope: 'all', type: 'all', status: 'all', q: '', page: '1' }));
        expect(admin.canSeeAll).to.equal(true);
        expectCounts(admin, { practice: 4, quiz: 3, acm: 4, oi: 1 });
        const adminRows = rowsOf(admin);
        expect(adminRows.some((row) => row.id === codeforces.docId.toHexString() || row.id === courseA.docId.toHexString())).to.equal(false);
        expect(admin.canCreate).to.deep.equal({ practice: true, homework: true, exam: true, acm: true, oi: true });
        const adminPractice = rowById(adminRows, practiceA);
        expect(adminPractice.role).to.equal('admin');
    });

    it('summarizes three groups, four groups, and one school', async () => {
        const body = payloadOf(await callList(user7, { scope: 'mine', type: 'acm' }));
        const rows = rowsOf(body);
        expect(rowById(rows, groups3).audience).to.equal('A班、B班、C班');
        expect(rowById(rows, groups4).audience).to.equal('A班、B班、C班 等 4 个用户组');
    });

    it('searches titles with a case-insensitive escaped pattern', async () => {
        const plus = payloadOf(await callList(user7, { scope: 'mine', type: 'all', status: 'all', q: 'c++', page: '1' }));
        expectCounts(plus, { practice: 0, quiz: 1, acm: 0, oi: 0 });
        expect(rowsOf(plus).map((row) => row.id)).to.deep.equal([homeworkA.docId.toHexString()]);

        const dot = payloadOf(await callList(user7, { scope: 'mine', type: 'all', status: 'all', q: '.', page: '1' }));
        expectCounts(dot, { practice: 1, quiz: 0, acm: 0, oi: 0 });
        expect(rowsOf(dot).map((row) => row.title)).to.deep.equal(['A.B 公开练习']);
    });

    it('defaults to my sets, every type, every status, and the first page', async () => {
        const implicit = payloadOf(await callList(user9, {}));
        const explicit = payloadOf(await callList(user9, { scope: 'mine', type: 'all', status: 'all', q: '', page: '1' }));
        expectFilter(implicit, { scope: 'mine', type: 'all', status: 'all', q: '', page: 1, canSeeAll: false });
        expect(rowsOf(implicit).map((row) => row.id)).to.deep.equal(rowsOf(explicit).map((row) => row.id));
        expect(implicit.total).to.equal(explicit.total);
    });

    it('keeps the full total when the requested page is past the first one', async () => {
        const body = payloadOf(await callList(user9, { scope: 'mine', type: 'all', status: 'all', q: '', page: '2' }));
        expect(body.page).to.equal(2);
        expect(body.total).to.equal(2);
        expect(body.pageCount).to.equal(1);
        expect(rowsOf(body).length).to.equal(0);
    });

    it('merges both collections by id before slicing the second page', async () => {
        const ordered = [...pageWaveDocs].sort((left, right) => {
            const leftId = left._id.toHexString();
            const rightId = right._id.toHexString();
            if (leftId === rightId) return 0;
            return leftId < rightId ? 1 : -1;
        });
        const expected = ordered.slice(PAGE_SIZE, PAGE_SIZE * 2).map((doc) => doc.docId.toHexString());
        const body = payloadOf(await callList(user15, {
            scope: 'mine',
            type: 'all',
            status: 'all',
            q: '',
            page: '2',
        }, PAGE_DOMAIN));
        expectFilter(body, {
            scope: 'mine',
            type: 'all',
            status: 'all',
            q: '',
            page: 2,
            canSeeAll: false,
        });
        expectCounts(body, { practice: PAGE_EACH, quiz: 0, acm: PAGE_EACH, oi: 0 });
        expect(body.total).to.equal(PAGE_EACH * 2);
        expect(body.pageCount).to.equal(Math.ceil((PAGE_EACH * 2) / PAGE_SIZE));
        const rows = rowsOf(body);
        expect(rows.map((row) => row.id)).to.deep.equal(expected);
        expect(rows.some((row) => row.type === 'practice')).to.equal(true);
        expect(rows.some((row) => row.type === 'acm')).to.equal(true);
    });

    it('does not list shared contests or practices owned by the caller', async () => {
        const owner = teacher(8, creators, [LOGIN]);
        const body = payloadOf(await callList(owner, { scope: 'shared', type: 'all', status: 'all', q: '', page: '1' }));
        expectCounts(body, { practice: 1, quiz: 0, acm: 0, oi: 0 });
        const rows = sharedOf(body);
        expect(rows.map((row) => row.id)).to.deep.equal([practiceA.docId.toHexString()]);
        expect(rows.every((row) => row.ownerUid !== owner._id)).to.equal(true);
    });

    it('filters contests into upcoming, running, and ended windows', async () => {
        const upcoming = payloadOf(await callList(user7, { scope: 'mine', type: 'all', status: 'upcoming', q: '', page: '1' }));
        expectCounts(upcoming, { practice: 0, quiz: 1, acm: 0, oi: 0 });
        const upcomingRows = rowsOf(upcoming);
        expect(upcomingRows.map((row) => row.id)).to.deep.equal([examA.docId.toHexString()]);
        expect(upcomingRows[0].status).to.equal('upcoming');

        const running = payloadOf(await callList(user7, { scope: 'mine', type: 'all', status: 'running', q: '', page: '1' }));
        expectCounts(running, { practice: 0, quiz: 1, acm: 2, oi: 0 });
        expect(rowsOf(running).map((row) => row.id).sort()).to.deep.equal([
            homeworkA.docId.toHexString(),
            groups3.docId.toHexString(),
            groups4.docId.toHexString(),
        ].sort());

        const ended = payloadOf(await callList(user7, { scope: 'mine', type: 'all', status: 'ended', q: '', page: '1' }));
        expectCounts(ended, { practice: 0, quiz: 0, acm: 0, oi: 1 });
        const endedRows = rowsOf(ended);
        expect(endedRows.map((row) => row.id)).to.deep.equal([oiA.docId.toHexString()]);
        expect(endedRows[0].status).to.equal('ended');
    });

    it('reports a two-hour contest limit as 120 minutes', async () => {
        const body = payloadOf(await callList(user7, { scope: 'mine', type: 'quiz', status: 'all', q: '', page: '1' }));
        expect(rowById(rowsOf(body), homeworkA).durationMinutes).to.equal(120);
        expect(rowById(rowsOf(body), examA).durationMinutes).to.equal(null);
    });

    it('includes an ioi contest in the oi type filter', async () => {
        const body = payloadOf(await callList(user7, { scope: 'mine', type: 'oi', status: 'all', q: '', page: '1' }));
        expectCounts(body, { practice: 1, quiz: 2, acm: 2, oi: 1 }, 1);
        const rows = rowsOf(body);
        expect(rows.map((row) => row.id)).to.deep.equal([oiA.docId.toHexString()]);
        expect(rows[0].type).to.equal('oi');
        expect(rows[0].rule).to.equal('ioi');
    });
});
