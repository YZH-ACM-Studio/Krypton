import { createRequire, type Module as NodeModule } from 'node:module';
import { after, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PERM, PRIV } from '@hydrooj/common/permission';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import {
    ContestNotFoundError,
    getLocalizedErrorMetadata,
    PermissionError,
    TrainingNotFoundError,
    type HydroError,
} from '../src/error';
import { InMemoryStudentDirectory, studentRecord } from '../src/lib/testing/in-memory-student-directory';
import {
    withStudentDirectory,
    type StudentDirectoryGroup,
    type StudentDirectoryStudent,
} from '../src/service/student-directory';

// PLAN shows a static import. The handler does not exist yet, and a static import
// would fail this lane's tsc gate inside the test file. Load it at runtime.
// This line matches @hydrooj/register's CJS strip so __filename stays defined.
const __filename = fileURLToPath(import.meta.url);
const requireFromTest = createRequire(__filename);

type TeachType = 'practice' | 'homework' | 'exam' | 'acm' | 'oi';

interface TeachActor {
    _id: number;
    own: (doc: { owner: number; maintainer?: number[] }, exact?: boolean) => boolean;
    hasPerm: (...perm: bigint[]) => boolean;
    hasPriv: (...priv: number[]) => boolean;
}

interface StatusRow {
    domainId: string;
    docType: number;
    docId: ObjectId;
    uid: number;
    attend?: number;
    enroll?: number;
    startAt?: Date | null;
    paperFinalizedAt?: Date | null;
    journal?: Array<{ rid: ObjectId; pid?: number }>;
}

interface Participant {
    uid: number;
    uname: string;
    studentId: string;
    realName: string;
    groupIds: string[];
    attended: boolean;
    startAt: string | null;
    finalizedAt: string | null;
    lastSubmitAt: string | null;
    late: boolean;
}

interface GroupRow {
    id: string;
    name: string;
}

interface Payload {
    participants: Participant[];
    groups: GroupRow[];
}

interface TeachHandler {
    domain: { _id: string };
    user: TeachActor;
    response: { body?: unknown };
    request: Record<string, unknown>;
    args: Record<string, unknown>;
    prepare?: (...methodArgs: unknown[]) => Promise<unknown> | unknown;
    get?: (...methodArgs: unknown[]) => Promise<unknown> | unknown;
    checkPerm: (...perms: bigint[]) => void;
    checkPriv: (...privs: number[]) => void;
}

type HandlerConstructor = new (...ctorArgs: unknown[]) => TeachHandler;

interface StatusCursor {
    project: (fields?: Record<string, unknown>) => StatusCursor;
    sort: (spec?: unknown) => StatusCursor;
    limit: (count: number) => StatusCursor;
    count: () => Promise<number>;
    toArray: () => Promise<Record<string, unknown>[]>;
    [Symbol.asyncIterator]: () => AsyncGenerator<Record<string, unknown>>;
}

interface ReadCall {
    model: string;
    domainId: string;
}

interface ManageCase {
    type: TeachType;
    rule: string;
    perm: bigint;
}

const TYPE_CONTEST = 30;
const TYPE_TRAINING = 40;
const domainId = 'teach-domain';
const ownerUid = 4;
const maintainerUid = 7;
const adminUid = 3;
const strangerUid = 9;
const schoolId = new ObjectId('66c200000000000000000001');
const overCapMessage = '参与人数超过 2000，请到排行榜导出';
const participantKeys = [
    'attended',
    'finalizedAt',
    'groupIds',
    'lastSubmitAt',
    'late',
    'realName',
    'startAt',
    'studentId',
    'uid',
    'uname',
];

const calls: ReadCall[] = [];
const logLines: unknown[][] = [];
const statuses: StatusRow[] = [];
const names = new Map<number, string>();
let contestDoc: Record<string, unknown> | null = null;
let trainingDoc: Record<string, unknown> | null = null;
let directory: RecordingDirectory;
let cachedHandler: HandlerConstructor | null = null;

class RecordingDirectory extends InMemoryStudentDirectory {
    override async findStudentsByUserIds(nextDomainId: string, userIds: number[]): Promise<Record<string, StudentDirectoryStudent>> {
        calls.push({ model: 'student.findStudentsByUserIds', domainId: nextDomainId });
        return super.findStudentsByUserIds(nextDomainId, userIds);
    }

    override async findBoundStudentsByGroupIds(nextDomainId: string, groupIds: ObjectId[]): Promise<StudentDirectoryStudent[]> {
        calls.push({ model: 'student.findBoundStudentsByGroupIds', domainId: nextDomainId });
        return super.findBoundStudentsByGroupIds(nextDomainId, groupIds);
    }

    override async listUserGroups(nextDomainId: string, nextSchoolId?: ObjectId): Promise<StudentDirectoryGroup[]> {
        calls.push({ model: 'student.listUserGroups', domainId: nextDomainId });
        return super.listUserGroups(nextDomainId, nextSchoolId);
    }
}

// The fixture directory already drops uid <= 1. These extras reach the loader unchanged.
class LeakyGroupDirectory extends RecordingDirectory {
    extras: StudentDirectoryStudent[];

    constructor(
        options: { students?: StudentDirectoryStudent[]; groups?: StudentDirectoryGroup[] },
        extras: StudentDirectoryStudent[],
    ) {
        super(options);
        this.extras = extras;
    }

    override async findBoundStudentsByGroupIds(nextDomainId: string, groupIds: ObjectId[]): Promise<StudentDirectoryStudent[]> {
        const rows = await super.findBoundStudentsByGroupIds(nextDomainId, groupIds);
        return [...this.extras, ...rows];
    }
}

directory = new RecordingDirectory();

const hydroHost = global as unknown as {
    Hydro?: { model: Record<string, unknown> };
};
if (!hydroHost.Hydro) hydroHost.Hydro = { model: {} };
const hydroModel = hydroHost.Hydro.model;

class CapturingLogger {
    info(...args: unknown[]) {
        logLines.push(args);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameId(left: unknown, right: unknown): boolean {
    const leftHex = left instanceof ObjectId ? left.toHexString() : typeof left === 'string' ? left : '';
    const rightHex = right instanceof ObjectId ? right.toHexString() : typeof right === 'string' ? right : '';
    if (leftHex && rightHex) return leftHex === rightHex;
    return Object.is(left, right);
}

function asQuery(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

function asNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value instanceof Date) return value.getTime();
    return null;
}

function operatorMatches(operator: string, actual: unknown, expected: unknown): boolean {
    if (operator === '$eq') return valueMatches(actual, expected);
    if (operator === '$in' && Array.isArray(expected)) return expected.some((item) => valueMatches(actual, item));
    const left = asNumber(actual);
    const right = asNumber(expected);
    if (left === null || right === null) return false;
    if (operator === '$gt') return left > right;
    if (operator === '$gte') return left >= right;
    return false;
}

function valueMatches(actual: unknown, expected: unknown): boolean {
    if (expected instanceof ObjectId || actual instanceof ObjectId) return sameId(actual, expected);
    if (isRecord(expected)) {
        const keys = Object.keys(expected);
        if (keys.length > 0 && keys.every((key) => key.startsWith('$'))) {
            return keys.every((key) => operatorMatches(key, actual, expected[key]));
        }
    }
    return Object.is(actual, expected);
}

function rowMatches(row: StatusRow, query: Record<string, unknown>): boolean {
    const record = row as unknown as Record<string, unknown>;
    if (Array.isArray(query.$and) && !query.$and.every((part) => isRecord(part) && rowMatches(row, part))) return false;
    if (Array.isArray(query.$or) && !query.$or.some((part) => isRecord(part) && rowMatches(row, part))) return false;
    for (const [key, expected] of Object.entries(query)) {
        if (key === '$and' || key === '$or') continue;
        if (!valueMatches(record[key], expected)) return false;
    }
    return true;
}

function projectRow(row: StatusRow, projection: Record<string, unknown> | null): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...row };
    if (Array.isArray(row.journal)) copy.journal = [...row.journal];
    if (!projection) return copy;
    const included = Object.entries(projection).filter(([key, value]) => key !== '_id' && value);
    if (!included.length) return copy;
    const selected: Record<string, unknown> = {};
    if (projection._id !== 0 && '_id' in copy) selected._id = copy._id;
    for (const [key] of included) {
        if (key in copy) selected[key] = copy[key];
    }
    return selected;
}

function cursor(rows: StatusRow[]): StatusCursor {
    let projection: Record<string, unknown> | null = null;
    let limited = rows.length;
    const api: StatusCursor = {
        project(fields) {
            if (isRecord(fields)) projection = fields;
            return api;
        },
        sort() {
            return api;
        },
        limit(count) {
            if (Number.isFinite(count) && count >= 0) limited = count;
            return api;
        },
        async count() {
            return rows.length;
        },
        async toArray() {
            return rows.slice(0, limited).map((row) => projectRow(row, projection));
        },
        async *[Symbol.asyncIterator]() {
            const list = await api.toArray();
            for (const row of list) yield row;
        },
    };
    return api;
}

function matchStatuses(docType: number, nextDomainId: string, query: unknown): StatusRow[] {
    const filter = asQuery(query);
    return statuses.filter((row) => row.docType === docType && row.domainId === nextDomainId && rowMatches(row, filter));
}

function installStub(relativePath: string, exports: Record<string, unknown>): void {
    const resolved = requireFromTest.resolve(relativePath);
    const previous = requireFromTest.cache[resolved];
    replaced.push({ resolved, previous });
    requireFromTest.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports,
        children: [],
        paths: [],
    } as NodeModule;
}

const replaced: Array<{ resolved: string; previous: NodeModule | undefined }> = [];

const contestRules: Record<string, { hidden?: boolean }> = {
    acm: {},
    oi: {},
    ioi: {},
    ledo: {},
    strictioi: {},
    exam: {},
    homework: { hidden: true },
};

const contestExports = {
    RULES: contestRules,
    async get(nextDomainId: string, id: unknown) {
        calls.push({ model: 'contest.get', domainId: nextDomainId });
        if (!contestDoc || !sameId(contestDoc.docId, id)) throw new ContestNotFoundError(nextDomainId, id);
        return contestDoc;
    },
    getMultiStatus(nextDomainId: string, query: unknown) {
        calls.push({ model: 'contest.getMultiStatus', domainId: nextDomainId });
        return cursor(matchStatuses(TYPE_CONTEST, nextDomainId, query));
    },
    async getAndListStatus(nextDomainId: string, id: unknown) {
        calls.push({ model: 'contest.getAndListStatus', domainId: nextDomainId });
        const doc = await contestExports.get(nextDomainId, id);
        return [doc, matchStatuses(TYPE_CONTEST, nextDomainId, { docId: id }).map((row) => projectRow(row, null))];
    },
    async countStatus(nextDomainId: string, query: unknown) {
        calls.push({ model: 'contest.countStatus', domainId: nextDomainId });
        return matchStatuses(TYPE_CONTEST, nextDomainId, query).length;
    },
};
const contestModule = { ...contestExports, __esModule: true, default: contestExports };

const trainingExports = {
    async get(nextDomainId: string, id: unknown) {
        calls.push({ model: 'training.get', domainId: nextDomainId });
        if (!trainingDoc || !sameId(trainingDoc.docId, id)) throw new TrainingNotFoundError(nextDomainId, id);
        return trainingDoc;
    },
    getMultiStatus(nextDomainId: string, query: unknown) {
        calls.push({ model: 'training.getMultiStatus', domainId: nextDomainId });
        return cursor(matchStatuses(TYPE_TRAINING, nextDomainId, query));
    },
    async countStatus(nextDomainId: string, query: unknown) {
        calls.push({ model: 'training.countStatus', domainId: nextDomainId });
        return matchStatuses(TYPE_TRAINING, nextDomainId, query).length;
    },
};
const trainingModule = { ...trainingExports, __esModule: true, default: trainingExports };

const documentExports = {
    TYPE_CONTEST,
    TYPE_TRAINING,
    async get(nextDomainId: string, docType: number, id: unknown) {
        calls.push({ model: 'document.get', domainId: nextDomainId });
        if (docType === TYPE_CONTEST) return contestExports.get(nextDomainId, id);
        if (docType === TYPE_TRAINING) return trainingExports.get(nextDomainId, id);
        return null;
    },
    getMultiStatus(nextDomainId: string, docType: number, query: unknown) {
        calls.push({ model: 'document.getMultiStatus', domainId: nextDomainId });
        return cursor(matchStatuses(docType, nextDomainId, query));
    },
    async countStatus(nextDomainId: string, docType: number, query: unknown) {
        calls.push({ model: 'document.countStatus', domainId: nextDomainId });
        return matchStatuses(docType, nextDomainId, query).length;
    },
};
const documentModule = { ...documentExports, __esModule: true, default: documentExports };

const userExports = {
    async getList(nextDomainId: string, uids: readonly number[]) {
        calls.push({ model: 'user.getList', domainId: nextDomainId });
        const result: Record<number, { _id: number; uname: string }> = {};
        for (const uid of uids) result[uid] = { _id: uid, uname: names.get(uid) ?? '' };
        return result;
    },
    async getListForRender(nextDomainId: string, uids: readonly number[]) {
        calls.push({ model: 'user.getListForRender', domainId: nextDomainId });
        return userExports.getList(nextDomainId, uids);
    },
};
const userModule = { ...userExports, __esModule: true, default: userExports };

installStub('../src/model/contest.ts', contestModule);
installStub('../src/model/training.ts', trainingModule);
installStub('../src/model/document.ts', documentModule);
installStub('../src/model/user.ts', userModule);
Object.assign(hydroModel, {
    contest: contestModule,
    training: trainingModule,
    document: documentModule,
    user: userModule,
});

const hydroLogger = requireFromTest('../src/logger.ts') as { logger: { info: (...args: unknown[]) => unknown } };
const originalInfo = hydroLogger.logger.info.bind(hydroLogger.logger);
hydroLogger.logger.info = (...args: unknown[]) => {
    logLines.push(args);
    return originalInfo(...args);
};
const loggerFacade = {
    __esModule: true,
    logger: hydroLogger.logger,
    Logger: CapturingLogger,
    default: hydroLogger.logger,
};

type ModuleLoad = (this: unknown, request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
const moduleNamespace = requireFromTest('module') as { _load: ModuleLoad };
const originalLoad = moduleNamespace._load;

function isParticipants(filename: string | undefined): boolean {
    if (!filename) return false;
    const normalized = filename.replaceAll('\\', '/');
    return normalized.endsWith('/src/handler/teach-participants.ts') || normalized.endsWith('/src/lib/teach-participants.ts');
}

function isUtilsRequest(request: string): boolean {
    return request === '@hydrooj/utils' || request === '@hydrooj/utils/lib/utils' || request === '@hydrooj/utils/lib/utils.ts';
}

function serverStub(): Record<string, unknown> {
    function noopDecorator() {
        return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
    }
    class HandlerStub {}
    const Types = new Proxy({}, { get: () => () => ({}) });
    return {
        __esModule: true,
        Handler: HandlerStub,
        ConnectionHandler: HandlerStub,
        param: noopDecorator,
        post: noopDecorator,
        route: noopDecorator,
        query: noopDecorator,
        get: noopDecorator,
        Types,
        default: HandlerStub,
    };
}

function wrapUtils(real: unknown): unknown {
    if (typeof real !== 'object' || real === null) return real;
    return new Proxy(real, {
        get(target, prop, receiver) {
            if (prop === 'Logger') return CapturingLogger;
            return Reflect.get(target, prop, receiver);
        },
    });
}

moduleNamespace._load = function load(this: unknown, request: string, parent: NodeModule | null | undefined, isMain: boolean) {
    if (isParticipants(parent?.filename) && (request === '../service/server' || request === '../service/server.ts')) {
        return serverStub();
    }
    if (isParticipants(parent?.filename) && (request === '../logger' || request === '../logger.ts')) return loggerFacade;
    if (isParticipants(parent?.filename) && isUtilsRequest(request)) {
        return wrapUtils(originalLoad.call(this, request, parent, isMain));
    }
    return originalLoad.call(this, request, parent, isMain);
};

after(() => {
    moduleNamespace._load = originalLoad;
    hydroLogger.logger.info = originalInfo;
    for (const item of replaced) {
        if (item.previous) requireFromTest.cache[item.resolved] = item.previous;
        else delete requireFromTest.cache[item.resolved];
    }
});

beforeEach(() => {
    calls.length = 0;
    logLines.length = 0;
    statuses.length = 0;
    names.clear();
    contestDoc = null;
    trainingDoc = null;
    directory = new RecordingDirectory();
});

function actor(uid: number, perms: readonly bigint[] = [], privs: readonly number[] = []): TeachActor {
    const permSet = new Set<bigint>(perms);
    const privSet = new Set<number>(privs);
    return {
        _id: uid,
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => permSet.has(perm)),
        hasPriv: (...wanted: number[]) => wanted.some((priv) => privSet.has(priv)),
        own: (doc, exact) => (exact === true ? doc.owner === uid : doc.owner === uid || (doc.maintainer || []).includes(uid)),
    };
}

function manager(type: TeachType): TeachActor {
    const perms = [PERM.PERM_USERBIND_MANAGE_STUDENTS];
    if (type === 'homework') perms.push(PERM.PERM_EDIT_HOMEWORK_SELF);
    else if (type === 'practice') perms.push(PERM.PERM_EDIT_TRAINING_SELF);
    else perms.push(PERM.PERM_EDIT_CONTEST_SELF);
    return actor(maintainerUid, perms);
}

function contestDocument(id: ObjectId, rule: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        domainId,
        docId: id,
        owner: ownerUid,
        maintainer: [maintainerUid],
        rule,
        title: '题目集',
        ...extra,
    };
}

function practiceDocument(id: ObjectId): Record<string, unknown> {
    return {
        domainId,
        docId: id,
        owner: ownerUid,
        maintainer: [maintainerUid],
        kind: 'problem_set',
        title: '练习一',
    };
}

function useContest(doc: Record<string, unknown>): void {
    contestDoc = doc;
    trainingDoc = null;
}

function usePractice(doc: Record<string, unknown>): void {
    trainingDoc = doc;
    contestDoc = null;
}

function attend(id: ObjectId, uid: number, extra: Partial<StatusRow> = {}): void {
    statuses.push({
        domainId,
        docType: TYPE_CONTEST,
        docId: id,
        uid,
        attend: 1,
        ...extra,
    });
}

function enroll(id: ObjectId, uid: number, extra: Partial<StatusRow> = {}): void {
    statuses.push({
        domainId,
        docType: TYPE_TRAINING,
        docId: id,
        uid,
        enroll: 1,
        ...extra,
    });
}

function boundStudent(uid: number, studentId: string, realName: string, groupIds: ObjectId[] = []): StudentDirectoryStudent {
    names.set(uid, `user-${uid}`);
    return studentRecord({
        domainId,
        schoolId,
        studentId,
        realName,
        groupIds,
        boundUserId: uid,
        boundAt: new Date('2026-10-01T00:00:00.000Z'),
    });
}

function groupRow(id: ObjectId, name: string, archivedAt?: Date | null): StudentDirectoryGroup {
    return {
        _id: id,
        domainId,
        schoolId,
        name,
        ...(archivedAt === undefined ? {} : { archivedAt }),
    };
}

async function rejectionOf(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run();
    } catch (error) {
        if (isRecord(error) && error.code === 'MODULE_NOT_FOUND') throw error;
        return error;
    }
    throw new Error('expected the call to reject');
}

function errorText(error: unknown): string {
    if (!(error instanceof Error)) return '';
    const params = isRecord(error) && Array.isArray(error.params) ? error.params : [];
    const metadata = getLocalizedErrorMetadata(error as HydroError);
    const templates = [metadata?.message?.template ?? '', ...[...(metadata?.parameters.values() ?? [])].map((item) => item.template)];
    return [error.message, ...params.map((item) => String(item)), ...templates].join('\n');
}

function errorParams(error: unknown): unknown[] {
    if (!isRecord(error) || !Array.isArray(error.params)) return [];
    return error.params;
}

function flatten(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    if (value instanceof ObjectId) return value.toHexString();
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) return `${value.name} ${value.message}`;
    const encoded = JSON.stringify(value, (_key, item) => {
        if (item instanceof ObjectId) return item.toHexString();
        if (item instanceof Date) return item.toISOString();
        if (typeof item === 'bigint') return item.toString();
        return item;
    });
    return encoded ?? '';
}

function containsCount(value: unknown, count: number): boolean {
    if (value === count || value === String(count)) return true;
    if (typeof value === 'string') return new RegExp(`(?:count|人数|participants)[^\\d]{0,12}${count}(?!\\d)`).test(value);
    if (!isRecord(value)) return false;
    return Object.values(value).some((item) => containsCount(item, count));
}

function expectLogged(id: ObjectId, count: number, secrets: readonly string[]): void {
    const text = logLines.map((line) => line.map((part) => flatten(part)).join(' ')).join('\n');
    expect(text.includes(domainId)).to.equal(true);
    expect(text.includes(id.toHexString())).to.equal(true);
    expect(logLines.some((line) => line.some((part) => containsCount(part, count)))).to.equal(true);
    for (const secret of secrets) expect(text.includes(secret)).to.equal(false);
}

function expectAuthoritativeReads(): void {
    expect(calls.length > 0).to.equal(true);
    expect(calls.filter((call) => call.domainId !== domainId)).to.deep.equal([]);
}

function isParticipant(value: unknown): value is Participant {
    if (!isRecord(value)) return false;
    return typeof value.uid === 'number'
        && typeof value.uname === 'string'
        && typeof value.studentId === 'string'
        && typeof value.realName === 'string'
        && Array.isArray(value.groupIds)
        && typeof value.attended === 'boolean'
        && (typeof value.startAt === 'string' || value.startAt === null)
        && (typeof value.finalizedAt === 'string' || value.finalizedAt === null)
        && (typeof value.lastSubmitAt === 'string' || value.lastSubmitAt === null)
        && typeof value.late === 'boolean';
}

function readPayload(body: unknown): Payload {
    expect(isRecord(body)).to.equal(true);
    if (!isRecord(body)) throw new TypeError('participants payload');
    expect(Object.keys(body).sort()).to.deep.equal(['groups', 'participants']);
    expect(Array.isArray(body.participants)).to.equal(true);
    expect(Array.isArray(body.groups)).to.equal(true);
    if (!Array.isArray(body.participants) || !Array.isArray(body.groups)) throw new TypeError('participants payload');
    const participants: Participant[] = [];
    for (const item of body.participants) {
        expect(isRecord(item)).to.equal(true);
        if (!isRecord(item)) throw new TypeError('participant');
        expect(Object.keys(item).sort()).to.deep.equal(participantKeys);
        expect(JSON.stringify(item).includes('score')).to.equal(false);
        expect(isParticipant(item)).to.equal(true);
        if (!isParticipant(item)) throw new TypeError('participant');
        expect(item.groupIds.every((groupId) => typeof groupId === 'string')).to.equal(true);
        participants.push(item);
    }
    const groups: GroupRow[] = [];
    for (const item of body.groups) {
        expect(isRecord(item)).to.equal(true);
        if (!isRecord(item)) throw new TypeError('group');
        expect(Object.keys(item).sort()).to.deep.equal(['id', 'name']);
        expect(typeof item.id).to.equal('string');
        expect(typeof item.name).to.equal('string');
        if (typeof item.id !== 'string' || typeof item.name !== 'string') throw new TypeError('group');
        groups.push({ id: item.id, name: item.name });
    }
    return { participants, groups };
}

function createHandler(HandlerClass: HandlerConstructor): TeachHandler {
    try {
        return new HandlerClass();
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (!message.includes('session') && !message.includes('HydroContext') && !message.includes('context')) throw error;
        const context = {
            session: {},
            HydroContext: {
                args: {},
                request: { query: {}, params: {}, body: {} },
                response: {},
                UiContext: {},
            },
        };
        return new HandlerClass(context, {});
    }
}

async function loadHandler(): Promise<HandlerConstructor> {
    if (cachedHandler) return cachedHandler;
    const loaded: unknown = requireFromTest('../src/handler/teach-participants.ts');
    if (!isRecord(loaded) || typeof loaded.apply !== 'function') throw new TypeError('teach export missing: apply');
    const found: Array<{ name: string; path: string; Handler: HandlerConstructor }> = [];
    const ctx = {
        Route(name: string, routePath: string, Handler: HandlerConstructor) {
            found.push({ name, path: routePath, Handler });
        },
        inject(_deps: unknown, callback: (context: object) => unknown) {
            return callback(ctx);
        },
    };
    await loaded.apply(ctx);
    const route = found.find((item) => item.name === 'teach_participants');
    if (!route || typeof route.Handler !== 'function') throw new TypeError('teach export missing: teach_participants');
    expect(route.path).to.equal('/teach/:type/:id/participants');
    cachedHandler = route.Handler;
    return route.Handler;
}

async function invoke(user: TeachActor, type: string, id: ObjectId): Promise<unknown> {
    const HandlerClass = await loadHandler();
    calls.length = 0;
    logLines.length = 0;
    const handler = createHandler(HandlerClass);
    handler.domain = { _id: domainId };
    handler.user = user;
    handler.response = {};
    handler.request = { query: {}, params: {}, body: {}, json: null };
    handler.args = { domainId: 'forged-domain' };
    handler.checkPerm = (...perms: bigint[]) => {
        if (!user.hasPerm(...perms)) throw new PermissionError(...perms);
    };
    handler.checkPriv = (...privs: number[]) => {
        if (!user.hasPriv(...privs)) throw new PermissionError(...privs);
    };
    const methodArgs: [string, string, ObjectId] = ['forged-domain', type, id];
    return withStudentDirectory(directory, async () => {
        if (typeof handler.prepare === 'function') await handler.prepare(...methodArgs);
        if (typeof handler.get !== 'function') throw new TypeError('teach export missing: get');
        await handler.get(...methodArgs);
        return handler.response.body;
    });
}

async function readParticipants(user: TeachActor, type: TeachType, id: ObjectId): Promise<Payload> {
    const body = await invoke(user, type, id);
    expectAuthoritativeReads();
    return readPayload(body);
}

function byUid(payload: Payload, uid: number): Participant {
    const found = payload.participants.find((person) => person.uid === uid);
    expect(found === undefined).to.equal(false);
    if (!found) throw new TypeError(`missing participant ${uid}`);
    return found;
}

function sortedCopy(values: readonly string[]): string[] {
    return [...values].sort();
}

describe('teach participants', () => {
    it('registers the participants route', async () => {
        await loadHandler();
        expect(cachedHandler === null).to.equal(false);
    });

    it('rejects a maintainer who cannot manage student records', async () => {
        const id = new ObjectId();
        const cases: ManageCase[] = [
            { type: 'homework', rule: 'homework', perm: PERM.PERM_EDIT_HOMEWORK_SELF },
            { type: 'exam', rule: 'exam', perm: PERM.PERM_EDIT_CONTEST_SELF },
            { type: 'acm', rule: 'acm', perm: PERM.PERM_EDIT_CONTEST_SELF },
            { type: 'oi', rule: 'oi', perm: PERM.PERM_EDIT_CONTEST_SELF },
        ];
        for (const item of cases) {
            statuses.length = 0;
            useContest(contestDocument(id, item.rule));
            const error = await rejectionOf(() => invoke(actor(maintainerUid, [item.perm]), item.type, id));
            expect(error instanceof Error ? error.name : '').to.equal('PermissionError');
            expect(errorText(error).includes('你不能管理这个题目集')).to.equal(false);
        }
        statuses.length = 0;
        usePractice(practiceDocument(id));
        const practiceError = await rejectionOf(() => invoke(actor(maintainerUid, [PERM.PERM_EDIT_TRAINING_SELF]), 'practice', id));
        expect(practiceError instanceof Error ? practiceError.name : '').to.equal('PermissionError');
        expect(errorText(practiceError).includes('你不能管理这个题目集')).to.equal(false);
    });

    it('rejects a caller who cannot manage the container', async () => {
        const id = new ObjectId();
        useContest(contestDocument(id, 'homework'));
        const error = await rejectionOf(() => invoke(actor(strangerUid, [PERM.PERM_USERBIND_MANAGE_STUDENTS]), 'homework', id));
        expect(error instanceof Error ? error.name : '').to.equal('PermissionError');
        expect(errorText(error).includes('你不能管理这个题目集。')).to.equal(true);
    });

    it('lets a system administrator read participants without the student-record permission', async () => {
        const id = new ObjectId();
        const admin = actor(adminUid, [], [PRIV.PRIV_EDIT_SYSTEM]);
        for (const type of ['homework', 'exam', 'acm'] as const) {
            statuses.length = 0;
            names.clear();
            useContest(contestDocument(id, type === 'acm' ? 'acm' : type));
            names.set(8, 'admin-visible');
            attend(id, 8);
            const payload = await readParticipants(admin, type, id);
            expect(payload.participants.map((person) => person.uid)).to.deep.equal([8]);
            expect(byUid(payload, 8).uname).to.equal('admin-visible');
        }
        statuses.length = 0;
        names.clear();
        useContest(contestDocument(id, 'oi'));
        names.set(8, 'oi-visible');
        attend(id, 8);
        const oi = await readParticipants(admin, 'oi', id);
        expect(oi.participants.map((person) => person.uid)).to.deep.equal([8]);

        statuses.length = 0;
        names.clear();
        usePractice(practiceDocument(id));
        names.set(8, 'practice-visible');
        enroll(id, 8);
        const practice = await readParticipants(admin, 'practice', id);
        expect(practice.participants.map((person) => person.uid)).to.deep.equal([8]);
    });

    it('includes students from the audience groups who have not attended', async () => {
        const id = new ObjectId();
        const groupA = new ObjectId('66c10000000000000000000a');
        useContest(contestDocument(id, 'homework', {
            participantScopeMode: 'groups',
            participantGroupIds: [groupA],
        }));
        attend(id, 10);
        attend(id, 13);
        attend(id, 1);
        attend(id, 0);
        directory = new RecordingDirectory({
            students: [
                boundStudent(13, 'A000', '已在组里', [groupA]),
                boundStudent(11, 'A001-SECRET', '未参加', [groupA]),
                boundStudent(10, 'B002', '已参加', []),
                boundStudent(12, 'C003', '无关学生', []),
            ],
            groups: [groupRow(groupA, 'alpha')],
        });
        const payload = await readParticipants(manager('homework'), 'homework', id);
        expect(payload.participants.map((person) => person.uid)).to.deep.equal([13, 11, 10]);
        expect(byUid(payload, 11).attended).to.equal(false);
        expect(byUid(payload, 11).studentId).to.equal('A001-SECRET');
        expect(byUid(payload, 11).realName).to.equal('未参加');
        expect(byUid(payload, 11).late).to.equal(false);
        expect(byUid(payload, 11).startAt).to.equal(null);
        expect(byUid(payload, 11).finalizedAt).to.equal(null);
        expect(byUid(payload, 11).lastSubmitAt).to.equal(null);
        expect(byUid(payload, 13).attended).to.equal(true);
        expect(byUid(payload, 10).attended).to.equal(true);
        expect(payload.participants.filter((person) => person.uid === 13).length).to.equal(1);
        expect(payload.groups).to.deep.equal([{ id: groupA.toHexString(), name: 'alpha' }]);
        expectLogged(id, 3, ['A001-SECRET', '未参加', '已参加', '无关学生']);
    });

    it('marks a homework submission after the penalty time as late', async () => {
        const id = new ObjectId();
        const penaltySince = new Date('2026-10-16T08:00:00.000Z');
        const started = new Date('2026-10-16T07:00:00.000Z');
        const penaltySeconds = Math.floor(penaltySince.getTime() / 1000);
        const earlierRid = ObjectId.createFromTime(penaltySeconds - 120);
        const equalRid = ObjectId.createFromTime(penaltySeconds);
        const laterRid = ObjectId.createFromTime(penaltySeconds + 120);
        expect(equalRid.getTimestamp().getTime()).to.equal(penaltySince.getTime());
        useContest(contestDocument(id, 'homework', { penaltySince }));
        attend(id, 21, {
            startAt: started,
            journal: [{ rid: earlierRid, pid: 1 }, { rid: laterRid, pid: 1 }],
        });
        attend(id, 22, { journal: [{ rid: equalRid, pid: 1 }] });
        attend(id, 23, { journal: [{ rid: earlierRid, pid: 1 }] });
        attend(id, 25);
        directory = new RecordingDirectory({
            students: [
                boundStudent(21, 'S021', '迟交', []),
                boundStudent(22, 'S022', '刚好', []),
                boundStudent(23, 'S023', '准时', []),
                boundStudent(25, 'S025', '未交', []),
            ],
            groups: [],
        });
        const payload = await readParticipants(manager('homework'), 'homework', id);
        const late = byUid(payload, 21);
        expect(late.late).to.equal(true);
        expect(late.lastSubmitAt).to.equal(laterRid.getTimestamp().toISOString());
        expect(late.startAt).to.equal(started.toISOString());
        expect(late.finalizedAt).to.equal(null);
        expect(byUid(payload, 22).late).to.equal(false);
        expect(byUid(payload, 22).lastSubmitAt).to.equal(equalRid.getTimestamp().toISOString());
        expect(byUid(payload, 23).late).to.equal(false);
        expect(byUid(payload, 23).lastSubmitAt).to.equal(earlierRid.getTimestamp().toISOString());
        expect(byUid(payload, 25).late).to.equal(false);
        expect(byUid(payload, 25).lastSubmitAt).to.equal(null);
    });

    it('maps an exam final time and does not treat the journal as late', async () => {
        const id = new ObjectId();
        const started = new Date('2026-10-16T01:00:00.000Z');
        const finalized = new Date('2026-10-16T02:00:00.000Z');
        const submitted = ObjectId.createFromTime(Math.floor(finalized.getTime() / 1000));
        useContest(contestDocument(id, 'exam'));
        attend(id, 61, { startAt: started, paperFinalizedAt: finalized, journal: [{ rid: submitted, pid: 3 }] });
        attend(id, 62);
        directory = new RecordingDirectory({
            students: [boundStudent(61, 'E061', '考生', []), boundStudent(62, 'E062', '未交卷', [])],
            groups: [],
        });
        const payload = await readParticipants(manager('exam'), 'exam', id);
        const finished = byUid(payload, 61);
        expect(finished.late).to.equal(false);
        expect(finished.startAt).to.equal(started.toISOString());
        expect(finished.finalizedAt).to.equal(finalized.toISOString());
        expect(finished.lastSubmitAt).to.equal(submitted.getTimestamp().toISOString());
        expect(byUid(payload, 62).finalizedAt).to.equal(null);
        expect(byUid(payload, 62).startAt).to.equal(null);
        expect(byUid(payload, 62).lastSubmitAt).to.equal(null);
        expect(byUid(payload, 62).late).to.equal(false);
    });

    it('returns an empty student id and no groups for an unbound user', async () => {
        const id = new ObjectId();
        useContest(contestDocument(id, 'acm'));
        names.set(8, 'ghost');
        attend(id, 8);
        const payload = await readParticipants(manager('acm'), 'acm', id);
        const person = byUid(payload, 8);
        expect(person.uname).to.equal('ghost');
        expect(person.studentId).to.equal('');
        expect(person.realName).to.equal('');
        expect(person.groupIds).to.deep.equal([]);
        expect(person.attended).to.equal(true);
        expect(payload.groups).to.deep.equal([]);
    });

    it('sorts numbered student ids first and drops archived groups', async () => {
        const id = new ObjectId();
        const groupAlpha = new ObjectId('66c100000000000000000002');
        const groupBeta = new ObjectId('66c100000000000000000001');
        const groupArchived = new ObjectId('66c100000000000000000003');
        useContest(contestDocument(id, 'exam', {
            participantScopeMode: 'groups',
            participantGroupIds: [groupBeta, groupAlpha, groupArchived],
        }));
        attend(id, 30);
        attend(id, 20);
        attend(id, 35);
        names.set(40, 'blank-40');
        names.set(50, 'blank-50');
        attend(id, 40);
        attend(id, 50);
        directory = new RecordingDirectory({
            students: [
                boundStudent(30, 'S200', '李二', [groupBeta, groupAlpha]),
                boundStudent(20, 'S100', '张一', [groupAlpha]),
                boundStudent(35, 'S300', '只剩归档', [groupArchived]),
            ],
            groups: [
                groupRow(groupBeta, 'beta'),
                groupRow(groupAlpha, 'alpha'),
                groupRow(groupArchived, 'zeta', new Date('2020-01-01T00:00:00.000Z')),
            ],
        });
        const payload = await readParticipants(manager('exam'), 'exam', id);
        expect(payload.participants.map((person) => person.uid)).to.deep.equal([20, 30, 35, 40, 50]);
        expect(payload.participants.map((person) => person.studentId)).to.deep.equal(['S100', 'S200', 'S300', '', '']);
        expect(sortedCopy(byUid(payload, 30).groupIds)).to.deep.equal(sortedCopy([groupAlpha.toHexString(), groupBeta.toHexString()]));
        expect(byUid(payload, 20).groupIds).to.deep.equal([groupAlpha.toHexString()]);
        expect(byUid(payload, 35).groupIds).to.deep.equal([]);
        expect(byUid(payload, 40).studentId).to.equal('');
        expect(byUid(payload, 40).realName).to.equal('');
        expect(byUid(payload, 40).groupIds).to.deep.equal([]);
        expect(byUid(payload, 50).studentId).to.equal('');
        expect(payload.groups).to.deep.equal([
            { id: groupAlpha.toHexString(), name: 'alpha' },
            { id: groupBeta.toHexString(), name: 'beta' },
        ]);
    });

    it('lists practice members from enrollment rather than attendance', async () => {
        const id = new ObjectId();
        usePractice(practiceDocument(id));
        enroll(id, 8);
        statuses.push({ domainId, docType: TYPE_TRAINING, docId: id, uid: 9, attend: 1 });
        enroll(id, 1);
        statuses.push({ domainId, docType: TYPE_TRAINING, docId: id, uid: 4, enroll: 0 });
        directory = new RecordingDirectory({
            students: [boundStudent(8, 'P008', '已报名', []), boundStudent(9, 'P009', '只签到', [])],
            groups: [],
        });
        const payload = await readParticipants(manager('practice'), 'practice', id);
        expect(payload.participants.map((person) => person.uid)).to.deep.equal([8]);
        expect(byUid(payload, 8).studentId).to.equal('P008');
        expect(byUid(payload, 8).realName).to.equal('已报名');
    });

    it('does not add group members unless the audience mode is groups', async () => {
        const id = new ObjectId();
        const groupA = new ObjectId('66c10000000000000000000b');
        useContest(contestDocument(id, 'homework', {
            participantScopeMode: 'schools',
            participantGroupIds: [groupA],
        }));
        attend(id, 13);
        attend(id, 10);
        directory = new RecordingDirectory({
            students: [
                boundStudent(13, 'A000', '已参加甲', [groupA]),
                boundStudent(11, 'A001', '未参加甲', [groupA]),
                boundStudent(10, 'B002', '已参加乙', []),
            ],
            groups: [groupRow(groupA, 'alpha')],
        });
        const payload = await readParticipants(manager('homework'), 'homework', id);
        expect(payload.participants.map((person) => person.uid)).to.deep.equal([13, 10]);
        expect(payload.participants.some((person) => person.uid === 11)).to.equal(false);
    });

    it('returns exactly 2000 participants', async () => {
        const id = new ObjectId();
        useContest(contestDocument(id, 'homework'));
        for (let uid = 2; uid < 2002; uid += 1) attend(id, uid);
        const payload = await readParticipants(manager('homework'), 'homework', id);
        const uids = payload.participants.map((person) => person.uid);
        expect(uids.length).to.equal(2000);
        expect(new Set(uids).size).to.equal(2000);
        expect(Math.min(...uids)).to.equal(2);
        expect(Math.max(...uids)).to.equal(2001);
        expectLogged(id, 2000, []);
    });

    it('rejects more than 2000 participants', async () => {
        const id = new ObjectId();
        useContest(contestDocument(id, 'homework'));
        for (let uid = 2; uid < 2003; uid += 1) attend(id, uid);
        const attendedError = await rejectionOf(() => invoke(manager('homework'), 'homework', id));
        expect(attendedError instanceof Error ? attendedError.name : '').to.equal('ValidationError');
        expect(errorParams(attendedError)[0]).to.equal('participants');
        expect(errorParams(attendedError)[1]).to.equal(null);
        expect(String(errorParams(attendedError)[2])).to.equal(overCapMessage);

        const groupA = new ObjectId('66c10000000000000000000c');
        statuses.length = 0;
        useContest(contestDocument(id, 'exam', {
            participantScopeMode: 'groups',
            participantGroupIds: [groupA],
        }));
        for (let uid = 2; uid < 2002; uid += 1) attend(id, uid);
        directory = new RecordingDirectory({
            students: [boundStudent(9000, 'OVER', '超出', [groupA])],
            groups: [groupRow(groupA, 'alpha')],
        });
        const unionError = await rejectionOf(() => invoke(manager('exam'), 'exam', id));
        expect(unionError instanceof Error ? unionError.name : '').to.equal('ValidationError');
        expect(String(errorParams(unionError)[2])).to.equal(overCapMessage);

        statuses.length = 0;
        names.clear();
        usePractice(practiceDocument(id));
        for (let uid = 2; uid < 2003; uid += 1) enroll(id, uid);
        const practiceError = await rejectionOf(() => invoke(manager('practice'), 'practice', id));
        expect(practiceError instanceof Error ? practiceError.name : '').to.equal('ValidationError');
        expect(errorParams(practiceError)[0]).to.equal('participants');
        expect(String(errorParams(practiceError)[2])).to.equal(overCapMessage);
    });

    it('reports a finalized time only for an exam', async () => {
        const id = new ObjectId();
        const finalized = new Date('2026-10-16T03:00:00.000Z');
        const cases: ManageCase[] = [
            { type: 'homework', rule: 'homework', perm: PERM.PERM_EDIT_HOMEWORK_SELF },
            { type: 'acm', rule: 'acm', perm: PERM.PERM_EDIT_CONTEST_SELF },
            { type: 'oi', rule: 'oi', perm: PERM.PERM_EDIT_CONTEST_SELF },
        ];
        for (const item of cases) {
            statuses.length = 0;
            names.clear();
            useContest(contestDocument(id, item.rule));
            attend(id, 71, { paperFinalizedAt: finalized });
            directory = new RecordingDirectory({
                students: [boundStudent(71, 'N071', '非考试', [])],
                groups: [],
            });
            const payload = await readParticipants(manager(item.type), item.type, id);
            expect(byUid(payload, 71).finalizedAt).to.equal(null);
            expect(byUid(payload, 71).attended).to.equal(true);
        }
        statuses.length = 0;
        names.clear();
        usePractice(practiceDocument(id));
        enroll(id, 71, { paperFinalizedAt: finalized });
        directory = new RecordingDirectory({
            students: [boundStudent(71, 'P071', '练习学生', [])],
            groups: [],
        });
        const practice = await readParticipants(manager('practice'), 'practice', id);
        expect(byUid(practice, 71).finalizedAt).to.equal(null);
    });

    it('does not mark a non-homework submission after the penalty time as late', async () => {
        const id = new ObjectId();
        const penaltySince = new Date('2026-10-16T08:00:00.000Z');
        const laterRid = ObjectId.createFromTime(Math.floor(penaltySince.getTime() / 1000) + 120);
        const cases: ManageCase[] = [
            { type: 'exam', rule: 'exam', perm: PERM.PERM_EDIT_CONTEST_SELF },
            { type: 'acm', rule: 'acm', perm: PERM.PERM_EDIT_CONTEST_SELF },
            { type: 'oi', rule: 'oi', perm: PERM.PERM_EDIT_CONTEST_SELF },
        ];
        for (const item of cases) {
            statuses.length = 0;
            names.clear();
            useContest(contestDocument(id, item.rule, { penaltySince }));
            attend(id, 81, { journal: [{ rid: laterRid, pid: 1 }] });
            directory = new RecordingDirectory({
                students: [boundStudent(81, 'N081', '非作业', [])],
                groups: [],
            });
            const payload = await readParticipants(manager(item.type), item.type, id);
            const person = byUid(payload, 81);
            expect(person.late).to.equal(false);
            expect(person.lastSubmitAt).to.equal(laterRid.getTimestamp().toISOString());
        }
    });

    it('accepts exactly 2000 participants when the last one only belongs to the audience group', async () => {
        const id = new ObjectId();
        const groupA = new ObjectId('66c10000000000000000000d');
        useContest(contestDocument(id, 'exam', {
            participantScopeMode: 'groups',
            participantGroupIds: [groupA],
        }));
        for (let uid = 2; uid <= 2000; uid += 1) attend(id, uid);
        expect(statuses.length).to.equal(1999);
        directory = new RecordingDirectory({
            students: [boundStudent(9001, 'EDGE', '组内未参加', [groupA])],
            groups: [groupRow(groupA, 'alpha')],
        });
        const payload = await readParticipants(manager('exam'), 'exam', id);
        expect(payload.participants.length).to.equal(2000);
        expect(byUid(payload, 9001).attended).to.equal(false);
        expect(byUid(payload, 9001).studentId).to.equal('EDGE');
    });

    it('omits audience members whose user id is below 2', async () => {
        const id = new ObjectId();
        const groupA = new ObjectId('66c10000000000000000000e');
        useContest(contestDocument(id, 'homework', {
            participantScopeMode: 'groups',
            participantGroupIds: [groupA],
        }));
        attend(id, 15);
        directory = new LeakyGroupDirectory(
            {
                students: [boundStudent(15, 'S015', '正常学生', [groupA])],
                groups: [groupRow(groupA, 'alpha')],
            },
            [
                boundStudent(1, 'U0001', '系统用户', [groupA]),
                boundStudent(0, 'U0000', '访客', [groupA]),
            ],
        );
        const payload = await readParticipants(manager('homework'), 'homework', id);
        expect(payload.participants.map((person) => person.uid)).to.deep.equal([15]);
        expect(byUid(payload, 15).studentId).to.equal('S015');
        expect(byUid(payload, 15).attended).to.equal(true);
    });
});
