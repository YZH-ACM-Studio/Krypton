import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';
import { ValidationError } from '../src/error';
import { InMemoryStudentDirectory } from '../src/lib/testing/in-memory-student-directory';
import type { StudentDirectoryGroup, StudentDirectorySchool } from '../src/service/student-directory';
import { withStudentDirectory } from '../src/service/student-directory';

const Module = require('module');

const domainId = 'system';
const teacherId = 21;
const otherTeacherId = 44;
const archivedAt = new Date('2026-09-01T00:00:00.000Z');
const schoolId = new ObjectId('66d200000000000000000001');
const ownId = new ObjectId('66d210000000000000000001');
const otherId = new ObjectId('66d210000000000000000002');
const openId = new ObjectId('66d210000000000000000003');
const archivedId = new ObjectId('66d210000000000000000004');
const deletedId = new ObjectId('66d210000000000000000005');
const deletedMessage = '所选用户组已被删除，请先移除后再保存';
const invalidMessage = '用户组参数无效';

function cannotUse(name: string): string {
    return `你不能使用用户组「${name}」，只能使用自己的用户组或管理员开放给老师的本校用户组`;
}

if (!global.Hydro) {
    (global as unknown as {
        Hydro: {
            version: Record<string, string>;
            model: Record<string, unknown>;
            script: Record<string, unknown>;
            module: Record<string, Record<string, unknown>>;
            ui: Record<string, unknown>;
            error: Record<string, unknown>;
            locales: Record<string, unknown>;
        };
    }).Hydro = {
        version: { node: process.version, hydrooj: 'test' },
        model: {},
        script: {},
        module: new Proxy({} as Record<string, Record<string, unknown>>, {
            get(self, key: string) {
                self[key] ||= {};
                return self[key];
            },
        }),
        ui: {},
        error: {},
        locales: {},
    };
}

const busPath = require.resolve('../src/service/bus.ts');
const dbPath = require.resolve('../src/service/db.ts');
const trainingPath = require.resolve('../src/model/training.ts');
const contestModelPath = require.resolve('../src/model/contest.ts');
const originalLoad = Module._load;
const storedDocs = new Map<string, HomeworkDocument | ContestDocument>();
const groupWrites: Array<{ op: 'add' | 'edit'; ids: ObjectId[] }> = [];
let addCount = 0;
let courseForGet: CourseDocument | null = null;

const trainingStub = {
    async get() {
        if (!courseForGet) throw new Error('training.get missing course');
        return courseForGet;
    },
    async attachContestToCourseChapter() {
        return true;
    },
    getPids() {
        return [];
    },
    async add() {
        return new ObjectId();
    },
    async edit() {
        return undefined;
    },
    async del() {
        return undefined;
    },
};

const busStub = {
    parallel() {
        return Promise.resolve();
    },
    emit() {
        return undefined;
    },
    on() {
        return () => undefined;
    },
    once() {
        return undefined;
    },
    parallelAllSettled() {
        return Promise.resolve();
    },
};

const dbStub = {
    collection() {
        const cursor = {
            toArray: async () => [],
            limit() {
                return this;
            },
            skip() {
                return this;
            },
            sort() {
                return this;
            },
            project() {
                return this;
            },
        };
        return {
            find: () => cursor,
            findOne: async () => null,
            findOneAndDelete: async () => null,
            findOneAndUpdate: async () => null,
            insertOne: async () => ({ insertedId: new ObjectId() }),
            updateOne: async () => ({ matchedCount: 0 }),
            deleteOne: async () => ({ deletedCount: 0 }),
            deleteMany: async () => ({ deletedCount: 0 }),
            countDocuments: async () => 0,
        };
    },
};

let contestFacade: object | null = null;

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (typeof request === 'string') {
        try {
            const resolved = Module._resolveFilename(request, parent, isMain);
            if (resolved === contestModelPath && contestFacade) return contestFacade;
            if (resolved === busPath) return busStub;
            if (resolved === dbPath) return dbStub;
            if (resolved === trainingPath) return trainingStub;
        } catch {
            // Unresolvable optional imports keep the original loader.
        }
    }
    return originalLoad.call(this, request, parent, isMain);
};

const contestModel = require('../src/model/contest.ts') as typeof import('../src/model/contest');
const contestOverrides = {
    async get(_domainId: string, tid: ObjectId) {
        const doc = storedDocs.get(String(tid));
        if (!doc) throw new Error(`contest.get missing ${String(tid)}`);
        return doc;
    },
    async add(...args: unknown[]) {
        addCount += 1;
        const extra = args[9] as { participantGroupIds?: ObjectId[] } | undefined;
        if (extra && Object.hasOwn(extra, 'participantGroupIds')) {
            groupWrites.push({ op: 'add', ids: extra.participantGroupIds || [] });
        }
        return new ObjectId();
    },
    async edit(...args: unknown[]) {
        const $set = args[2] as { participantGroupIds?: ObjectId[] } | undefined;
        if ($set && Object.hasOwn($set, 'participantGroupIds')) {
            groupWrites.push({ op: 'edit', ids: $set.participantGroupIds || [] });
        }
    },
    async del() {
        return undefined;
    },
    async recalcStatus() {
        return undefined;
    },
};
contestFacade = new Proxy(contestModel, {
    get(target, prop, receiver) {
        if (Object.hasOwn(contestOverrides, prop)) return contestOverrides[prop as keyof typeof contestOverrides];
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
    },
});

const homeworkModule = require('../src/handler/homework.ts') as typeof import('../src/handler/homework');
const contestHandlerModule = require('../src/handler/contest.ts') as typeof import('../src/handler/contest');
const { PERM, PRIV } = require('../src/model/builtin.ts') as typeof import('../src/model/builtin');

Module._load = originalLoad;

const routes: Record<string, new (...args: unknown[]) => Editor> = {};
void homeworkModule.apply({
    Route(name: string, _path: string, HandlerClass: new (...args: unknown[]) => Editor) {
        routes[name] = HandlerClass;
    },
    inject() {
        return Promise.resolve();
    },
} as unknown as Parameters<typeof homeworkModule.apply>[0]);
const HomeworkEditHandler = routes.homework_edit;
const ContestEditHandler = contestHandlerModule.ContestEditHandler as unknown as new (...args: unknown[]) => Editor;

interface Editor {
    user: TestUser;
    domain: { _id: string };
    tdoc?: ContestDocument;
    request: { body: Record<string, unknown>; headers: Record<string, string>; method: string; path: string; ip: string };
    response: { body: Record<string, unknown>; template?: string; redirect?: string };
    get(...args: unknown[]): Promise<unknown>;
    postUpdate(...args: unknown[]): Promise<unknown>;
}

interface TestUser {
    _id: number;
    role?: string;
    parentSchoolId: ObjectId[];
    timeZone: string;
    _problemAclLoaded: true;
    _problemAclDomainId: string;
    _pidNamespaceAclLoaded: true;
    _pidNamespaceAclDomainId: string;
    hasPerm: (...perms: bigint[]) => boolean;
    hasPriv: (...privs: number[]) => boolean;
    own: (doc: { owner?: number; maintainer?: number[] }) => boolean;
}

interface HomeworkDocument {
    docId: ObjectId;
    domainId: string;
    owner: number;
    maintainer: number[];
    rule: 'homework';
    title: string;
    content: string;
    beginAt: Date;
    endAt: Date;
    penaltySince: Date;
    penaltyRules: Record<string, number>;
    pids: number[];
    participantScopeMode: 'none' | 'groups';
    participantGroupIds: unknown;
}

interface ContestDocument {
    docId: ObjectId;
    domainId: string;
    owner: number;
    maintainer: number[];
    rule: 'acm';
    title: string;
    content: string;
    beginAt: Date;
    endAt: Date;
    pids: number[];
    files: unknown[];
    participationMode: 'individual' | 'team';
    participantScopeMode: 'none' | 'schools' | 'groups';
    participantGroupIds: unknown;
    participationRevision: number;
}

interface CourseDocument {
    docId: ObjectId;
    domainId: string;
    owner: number;
    kind: 'course';
    title: string;
    dag: Array<{ _id: number; title: string }>;
    courseGroupIds: unknown;
}

interface CatalogRow {
    _id: ObjectId;
    name: string;
    schoolId?: ObjectId;
    archivedAt?: Date | null;
    state?: unknown;
    kind?: unknown;
    attachable?: unknown;
    schoolName?: unknown;
}

function directory(): InMemoryStudentDirectory {
    const schools: StudentDirectorySchool[] = [{ _id: schoolId, domainId, name: 'Parent' }];
    const groups: StudentDirectoryGroup[] = [
        { _id: ownId, domainId, schoolId, name: 'own-group', ownerUid: teacherId },
        { _id: otherId, domainId, schoolId, name: 'other-group', ownerUid: otherTeacherId },
        { _id: openId, domainId, schoolId, name: 'open-group', teacherAttachable: true },
        { _id: archivedId, domainId, schoolId, name: 'archived-group', teacherAttachable: true, archivedAt },
    ];
    return new InMemoryStudentDirectory({ schools, groups });
}

function makeUser(options: { id?: number; perms?: bigint[]; priv?: number; parentSchoolId?: ObjectId[]; role?: string } = {}): TestUser {
    const id = options.id ?? teacherId;
    const perms = new Set(options.perms || []);
    const priv = options.priv || 0;
    return {
        _id: id,
        role: options.role,
        parentSchoolId: options.parentSchoolId === undefined ? [schoolId] : options.parentSchoolId,
        timeZone: 'Asia/Shanghai',
        _problemAclLoaded: true,
        _problemAclDomainId: domainId,
        _pidNamespaceAclLoaded: true,
        _pidNamespaceAclDomainId: domainId,
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => perms.has(perm)),
        hasPriv: (...wanted: number[]) => wanted.some((flag) => (priv & flag) === flag),
        own: (doc) => doc?.owner === id || (doc?.maintainer || []).includes(id),
    };
}

function restrictedHomeworkUser(id = teacherId) {
    return makeUser({ id, perms: [PERM.PERM_CREATE_HOMEWORK, PERM.PERM_EDIT_HOMEWORK_SELF] });
}

function restrictedContestUser(id = teacherId) {
    return makeUser({ id, perms: [PERM.PERM_CREATE_CONTEST] });
}

function homeworkDocument(groupIds: unknown, extra: Partial<HomeworkDocument> = {}): HomeworkDocument {
    const doc: HomeworkDocument = {
        docId: new ObjectId(),
        domainId,
        owner: teacherId,
        maintainer: [],
        rule: 'homework',
        title: '作业',
        content: '',
        beginAt: new Date('2099-01-01T00:00:00.000Z'),
        endAt: new Date('2099-01-09T15:59:00.000Z'),
        penaltySince: new Date('2099-01-08T15:59:00.000Z'),
        penaltyRules: {},
        pids: [],
        participantScopeMode: Array.isArray(groupIds) && groupIds.length ? 'groups' : 'none',
        participantGroupIds: groupIds,
        ...extra,
    };
    storedDocs.set(String(doc.docId), doc);
    return doc;
}

function contestDocument(groupIds: unknown, extra: Partial<ContestDocument> = {}): ContestDocument {
    return {
        docId: new ObjectId(),
        domainId,
        owner: teacherId,
        maintainer: [],
        rule: 'acm',
        title: 'Contest',
        content: 'Body',
        beginAt: new Date('2099-01-01T00:00:00.000Z'),
        endAt: new Date('2099-01-01T02:00:00.000Z'),
        pids: [],
        files: [],
        participationMode: 'individual',
        participantScopeMode: 'groups',
        participantGroupIds: groupIds,
        participationRevision: 0,
        ...extra,
    };
}

function makeEditor(HandlerClass: new (...args: unknown[]) => Editor, user = restrictedHomeworkUser(), tdoc?: ContestDocument): Editor {
    const request = { body: {} as Record<string, unknown>, headers: {}, method: 'post', path: '/edit', ip: '127.0.0.1' };
    const response = { body: {} as Record<string, unknown> };
    const context = {
        session: {},
        holdFiles: [],
        HydroContext: { args: {}, request, response, UiContext: {} },
    };
    const handler = new HandlerClass(context, { parallel: async () => undefined });
    handler.user = user;
    handler.domain = { _id: domainId };
    if (tdoc) handler.tdoc = tdoc;
    return handler;
}

function using<T>(run: () => Promise<T>): Promise<T> {
    return withStudentDirectory(directory(), run);
}

function homeworkArgs(tid: ObjectId | null, mode: 'none' | 'groups', groups: string[], fromCourse?: ObjectId, chapter = 0) {
    return ['forged-domain', tid, '2099-01-01', '08:00', '2099-01-08', '23:59', 1, {}, '作业', '', '', false, [], [], [], mode, groups, fromCourse, chapter];
}

function contestArgs(tid: ObjectId | null, mode: 'none' | 'schools' | 'groups', groups: string[] = [], schools: string[] = []) {
    return [
        'forged-domain',
        tid,
        '2099-01-01',
        '08:00',
        2,
        'Contest',
        'Body',
        'acm',
        '',
        false,
        '',
        false,
        [],
        false,
        null,
        null,
        [],
        false,
        false,
        false,
        null,
        [],
        false,
        'open',
        'strict',
        false,
        false,
        'strict',
        '',
        '',
        '',
        false,
        null,
        false,
        null,
        null,
        true,
        false,
        true,
        null,
        '',
        mode,
        schools,
        groups,
        null,
        null,
        '',
        null,
    ];
}

async function saveHomework(handler: Editor, tid: ObjectId | null, mode: 'none' | 'groups', groups: string[], fromCourse?: ObjectId, chapter = 0) {
    return handler.postUpdate(...homeworkArgs(tid, mode, groups, fromCourse, chapter));
}

async function saveContest(handler: Editor, tid: ObjectId | null, mode: 'none' | 'schools' | 'groups', groups: string[] = [], schools: string[] = []) {
    return handler.postUpdate(...contestArgs(tid, mode, groups, schools));
}

async function rejection(run: () => Promise<unknown>): Promise<InstanceType<typeof ValidationError>> {
    let caught: unknown;
    try {
        await run();
    } catch (error) {
        caught = error;
    }
    expect(caught, 'expected ValidationError').to.be.instanceOf(ValidationError);
    return caught as InstanceType<typeof ValidationError>;
}

function expectValidation(error: InstanceType<typeof ValidationError>, field: string, detail: string) {
    expect(error.code).to.not.equal(500);
    expect(error.params[0]).to.equal(field);
    expect(error.params[1]).to.equal(null);
    expect(error.params[2]).to.equal(detail);
}

function expectFieldOnly(error: InstanceType<typeof ValidationError>, field: string) {
    expect(error.code).to.not.equal(500);
    expect(error.params).to.deep.equal([field]);
}

function expectGroups(op: 'add' | 'edit', ids: ObjectId[]) {
    expect(groupWrites.map((write) => ({ op: write.op, ids: write.ids.map((id) => id.toHexString()) }))).to.deep.equal([
        { op, ids: ids.map((id) => id.toHexString()) },
    ]);
}

function catalogView(row: CatalogRow) {
    return {
        keys: Object.keys(row).sort(),
        _id: row._id.toHexString(),
        name: row.name,
        schoolId: row.schoolId instanceof ObjectId ? row.schoolId.toHexString() : undefined,
        archivedAt: row.archivedAt instanceof Date ? row.archivedAt.toISOString() : undefined,
    };
}

function liveRow(id: ObjectId, name: string, archived?: Date) {
    return {
        keys: archived ? ['_id', 'archivedAt', 'name', 'schoolId'] : ['_id', 'name', 'schoolId'],
        _id: id.toHexString(),
        name,
        schoolId: schoolId.toHexString(),
        archivedAt: archived ? archived.toISOString() : undefined,
    };
}

function deletedRow(id: ObjectId) {
    return {
        keys: ['_id', 'name'],
        _id: id.toHexString(),
        name: '已删除的组',
        schoolId: undefined,
        archivedAt: undefined,
    };
}

function expectCatalog(rows: CatalogRow[], expected: ReturnType<typeof liveRow>[]) {
    expect(rows.map(catalogView)).to.deep.equal(expected);
    for (const row of rows) {
        expect(row).to.not.have.property('state');
        expect(row).to.not.have.property('kind');
        expect(row).to.not.have.property('attachable');
        expect(row).to.not.have.property('schoolName');
        expect(row.name).to.not.include('（我的）');
        expect(row.name).to.not.include('（仅可移除）');
        expect(row.name).to.not.include('（已归档）');
    }
}

beforeEach(() => {
    groupWrites.length = 0;
    addCount = 0;
    storedDocs.clear();
    courseForGet = null;
});

describe('Participant group attach', { concurrency: false }, () => {
    it('restricted homework actor can attach their own group and rejects another teacher group', async () => {
        const created = makeEditor(HomeworkEditHandler, restrictedHomeworkUser());
        await using(() => saveHomework(created, null, 'groups', [` ${ownId.toHexString().toUpperCase()} `]));
        expectGroups('add', [ownId]);
        expect(addCount).to.equal(1);

        groupWrites.length = 0;
        addCount = 0;
        const rejected = await rejection(() => using(() => saveHomework(makeEditor(HomeworkEditHandler, restrictedHomeworkUser()), null, 'groups', [otherId.toHexString()])));
        expectValidation(rejected, 'participantGroupIds', cannotUse('other-group'));
        expect(groupWrites).to.deep.equal([]);
        expect(addCount).to.equal(0);
    });

    it('restricted contest actor rejects another teacher group and create ignores a leftover tdoc', async () => {
        const leftover = contestDocument([otherId]);
        const handler = makeEditor(ContestEditHandler, restrictedContestUser(), leftover);
        const error = await rejection(() => using(() => saveContest(handler, null, 'groups', [otherId.toHexString()])));
        expectValidation(error, 'participantGroupIds', cannotUse('other-group'));
        expect(groupWrites).to.deep.equal([]);
        expect(addCount).to.equal(1);
    });

    it('keeping an already attached unattachable group is allowed', async () => {
        const homework = homeworkDocument([otherId]);
        await using(() => saveHomework(makeEditor(HomeworkEditHandler, restrictedHomeworkUser()), homework.docId, 'groups', [otherId.toHexString()]));
        expectGroups('edit', [otherId]);

        groupWrites.length = 0;
        const contest = contestDocument([otherId]);
        const contestEditor = makeEditor(ContestEditHandler, restrictedContestUser(), contest);
        await using(() => saveContest(contestEditor, contest.docId, 'groups', [otherId.toHexString()]));
        expectGroups('edit', [otherId]);
    });

    it('removing any group is allowed, including the last group and a deleted group', async () => {
        const partial = homeworkDocument([otherId, ownId]);
        await using(() => saveHomework(makeEditor(HomeworkEditHandler, restrictedHomeworkUser()), partial.docId, 'groups', [ownId.toHexString()]));
        expectGroups('edit', [ownId]);

        groupWrites.length = 0;
        const last = homeworkDocument([otherId]);
        await using(() => saveHomework(makeEditor(HomeworkEditHandler, restrictedHomeworkUser()), last.docId, 'none', ['not-a-group']));
        expectGroups('edit', []);

        groupWrites.length = 0;
        const removedDeleted = homeworkDocument([deletedId]);
        await using(() => saveHomework(makeEditor(HomeworkEditHandler, restrictedHomeworkUser()), removedDeleted.docId, 'none', []));
        expectGroups('edit', []);

        groupWrites.length = 0;
        const contest = contestDocument([otherId, ownId]);
        await using(() => saveContest(makeEditor(ContestEditHandler, restrictedContestUser(), contest), contest.docId, 'groups', [ownId.toHexString()]));
        expectGroups('edit', [ownId]);

        groupWrites.length = 0;
        const contestCleared = contestDocument([deletedId]);
        await using(() => saveContest(makeEditor(ContestEditHandler, restrictedContestUser(), contestCleared), contestCleared.docId, 'groups', []));
        expectGroups('edit', []);

        groupWrites.length = 0;
        const contestNone = contestDocument([otherId]);
        await using(() => saveContest(makeEditor(ContestEditHandler, restrictedContestUser(), contestNone), contestNone.docId, 'none', ['not-a-group']));
        expectGroups('edit', []);
    });

    it('homework groups mode rejects an empty list and blank tokens', async () => {
        const empty = await rejection(() => using(() => saveHomework(makeEditor(HomeworkEditHandler, restrictedHomeworkUser()), null, 'groups', [])));
        expectFieldOnly(empty, 'participantGroupIds');
        expect(groupWrites).to.deep.equal([]);
        expect(addCount).to.equal(0);

        const blank = await rejection(() => using(() => saveHomework(makeEditor(HomeworkEditHandler, restrictedHomeworkUser()), null, 'groups', ['', '  '])));
        expectFieldOnly(blank, 'participantGroupIds');
        expect(addCount).to.equal(0);
    });

    it('contest groups mode accepts an empty list and rejects blank tokens', async () => {
        await using(() => saveContest(makeEditor(ContestEditHandler, restrictedContestUser()), null, 'groups', []));
        expectGroups('edit', []);
        expect(addCount).to.equal(1);

        groupWrites.length = 0;
        addCount = 0;
        const blank = await rejection(() => using(() => saveContest(makeEditor(ContestEditHandler, restrictedContestUser()), null, 'groups', [''])));
        expectFieldOnly(blank, 'participantGroupIds');
        expect(groupWrites).to.deep.equal([]);
        expect(addCount).to.equal(1);

        const spaces = await rejection(() => using(() => saveContest(makeEditor(ContestEditHandler, restrictedContestUser()), null, 'groups', ['  '])));
        expectFieldOnly(spaces, 'participantGroupIds');
    });

    it('adding an archived group while keeping a stored group is rejected for a restricted actor', async () => {
        const homework = homeworkDocument([otherId]);
        const homeworkError = await rejection(() =>
            using(() => saveHomework(makeEditor(HomeworkEditHandler, restrictedHomeworkUser()), homework.docId, 'groups', [otherId.toHexString(), archivedId.toHexString()])),
        );
        expectValidation(homeworkError, 'participantGroupIds', cannotUse('archived-group'));
        expect(groupWrites).to.deep.equal([]);

        const contest = contestDocument([otherId]);
        const contestError = await rejection(() =>
            using(() => saveContest(makeEditor(ContestEditHandler, restrictedContestUser(), contest), contest.docId, 'groups', [otherId.toHexString(), archivedId.toHexString()])),
        );
        expectValidation(contestError, 'participantGroupIds', cannotUse('archived-group'));
        expect(groupWrites).to.deep.equal([]);
    });

    it('illegal format is ValidationError and not a constructor 500', async () => {
        const homeworkError = await rejection(() => using(() => saveHomework(makeEditor(HomeworkEditHandler, restrictedHomeworkUser()), null, 'groups', [ownId.toHexString(), 'not-a-group'])));
        expectValidation(homeworkError, 'participantGroupIds', invalidMessage);
        expect(homeworkError.code).to.not.equal(500);
        expect(groupWrites).to.deep.equal([]);
        expect(addCount).to.equal(0);

        const contestError = await rejection(() => using(() => saveContest(makeEditor(ContestEditHandler, restrictedContestUser()), null, 'groups', ['not-a-group'])));
        expectValidation(contestError, 'participantGroupIds', invalidMessage);
        expect(contestError.code).to.not.equal(500);
        expect(groupWrites).to.deep.equal([]);
    });

    it('stored ids that are not ObjectIds are ValidationError on save and edit get', async () => {
        const homework = homeworkDocument([ownId.toHexString()]);
        const saved = await rejection(() => using(() => saveHomework(makeEditor(HomeworkEditHandler, restrictedHomeworkUser()), homework.docId, 'none', [])));
        expectValidation(saved, 'participantGroupIds', invalidMessage);
        expect(groupWrites).to.deep.equal([]);

        const shown = await rejection(() => using(() => makeEditor(HomeworkEditHandler, restrictedHomeworkUser()).get('forged-domain', homework.docId)));
        expectValidation(shown, 'participantGroupIds', invalidMessage);

        const contest = contestDocument([ownId.toHexString()], { participantScopeMode: 'none' });
        const contestSaved = await rejection(() => using(() => saveContest(makeEditor(ContestEditHandler, restrictedContestUser(), contest), contest.docId, 'groups', [ownId.toHexString()])));
        expectValidation(contestSaved, 'participantGroupIds', invalidMessage);
        expect(groupWrites).to.deep.equal([]);

        const contestShown = await rejection(() => using(() => makeEditor(ContestEditHandler, restrictedContestUser(), contest).get('forged-domain', contest.docId)));
        expectValidation(contestShown, 'participantGroupIds', invalidMessage);
        expect(groupWrites).to.deep.equal([]);
    });

    it('adding or keeping a deleted group is rejected', async () => {
        const added = await rejection(() => using(() => saveHomework(makeEditor(HomeworkEditHandler, restrictedHomeworkUser()), null, 'groups', [deletedId.toHexString()])));
        expectValidation(added, 'participantGroupIds', deletedMessage);
        expect(groupWrites).to.deep.equal([]);

        const homework = homeworkDocument([deletedId]);
        const kept = await rejection(() => using(() => saveHomework(makeEditor(HomeworkEditHandler, restrictedHomeworkUser()), homework.docId, 'groups', [deletedId.toHexString()])));
        expectValidation(kept, 'participantGroupIds', deletedMessage);
        expect(groupWrites).to.deep.equal([]);
    });

    it('course quiz save does not parse client groups or run the attach check', async () => {
        const courseId = new ObjectId();
        courseForGet = {
            docId: courseId,
            domainId,
            owner: teacherId,
            kind: 'course',
            title: '算法课',
            dag: [{ _id: 1, title: '第一章' }],
            courseGroupIds: [otherId],
        };
        await using(() => saveHomework(makeEditor(HomeworkEditHandler, restrictedHomeworkUser()), null, 'groups', [archivedId.toHexString(), 'not-a-group'], courseId, 1));
        expectGroups('add', [otherId]);
        expect(addCount).to.equal(1);
    });

    it('unrestricted homework and contest actors can attach an archived group', async () => {
        const homeworkEditor = makeUser({ perms: [PERM.PERM_CREATE_HOMEWORK, PERM.PERM_EDIT_HOMEWORK] });
        await using(() => saveHomework(makeEditor(HomeworkEditHandler, homeworkEditor), null, 'groups', [archivedId.toHexString()]));
        expectGroups('add', [archivedId]);

        groupWrites.length = 0;
        const homeworkAdmin = makeUser({ priv: PRIV.PRIV_EDIT_SYSTEM, perms: [] });
        await using(() => saveHomework(makeEditor(HomeworkEditHandler, homeworkAdmin), null, 'groups', [archivedId.toHexString(), otherId.toHexString()]));
        expectGroups('add', [archivedId, otherId]);

        groupWrites.length = 0;
        const contestEditor = makeUser({ perms: [PERM.PERM_EDIT_CONTEST] });
        await using(() => saveContest(makeEditor(ContestEditHandler, contestEditor), null, 'groups', [archivedId.toHexString()]));
        expectGroups('edit', [archivedId]);

        groupWrites.length = 0;
        const contestAdmin = makeUser({ priv: PRIV.PRIV_EDIT_SYSTEM, perms: [] });
        await using(() => saveContest(makeEditor(ContestEditHandler, contestAdmin), null, 'groups', [otherId.toHexString()]));
        expectGroups('edit', [otherId]);
    });

    it('role root and a different edit permission stay restricted', async () => {
        const homeworkRoot = makeUser({ role: 'root', perms: [PERM.PERM_CREATE_HOMEWORK] });
        const homeworkRootError = await rejection(() => using(() => saveHomework(makeEditor(HomeworkEditHandler, homeworkRoot), null, 'groups', [otherId.toHexString()])));
        expectValidation(homeworkRootError, 'participantGroupIds', cannotUse('other-group'));

        const coursePerm = makeUser({ perms: [PERM.PERM_CREATE_HOMEWORK, PERM.PERM_EDIT_COURSE] });
        const coursePermError = await rejection(() => using(() => saveHomework(makeEditor(HomeworkEditHandler, coursePerm), null, 'groups', [archivedId.toHexString()])));
        expectValidation(coursePermError, 'participantGroupIds', cannotUse('archived-group'));

        const contestRoot = makeUser({ role: 'root', perms: [] });
        const contestRootError = await rejection(() => using(() => saveContest(makeEditor(ContestEditHandler, contestRoot), null, 'groups', [otherId.toHexString()])));
        expectValidation(contestRootError, 'participantGroupIds', cannotUse('other-group'));

        const homeworkPerm = makeUser({ perms: [PERM.PERM_EDIT_HOMEWORK] });
        const homeworkPermError = await rejection(() => using(() => saveContest(makeEditor(ContestEditHandler, homeworkPerm), null, 'groups', [archivedId.toHexString()])));
        expectValidation(homeworkPermError, 'participantGroupIds', cannotUse('archived-group'));
        expect(groupWrites).to.deep.equal([]);
    });

    it('schools mode does not parse client group ids', async () => {
        const contest = contestDocument([ownId], { participantScopeMode: 'schools' });
        await using(() => saveContest(makeEditor(ContestEditHandler, restrictedContestUser(), contest), contest.docId, 'schools', ['not-a-group']));
        expectGroups('edit', []);
    });

    it('homework edit get unions attachable groups with saved groups', async () => {
        const homework = homeworkDocument([otherId, deletedId]);
        const handler = makeEditor(HomeworkEditHandler, restrictedHomeworkUser());
        await using(() => handler.get('forged-domain', homework.docId));
        expectCatalog(handler.response.body.scopeGroups as CatalogRow[], [liveRow(openId, 'open-group'), liveRow(ownId, 'own-group'), liveRow(otherId, 'other-group'), deletedRow(deletedId)]);

        const editor = makeUser({ perms: [PERM.PERM_CREATE_HOMEWORK, PERM.PERM_EDIT_HOMEWORK] });
        const unrestricted = makeEditor(HomeworkEditHandler, editor);
        await using(() => unrestricted.get('forged-domain'));
        expectCatalog(unrestricted.response.body.scopeGroups as CatalogRow[], [
            liveRow(archivedId, 'archived-group', archivedAt),
            liveRow(openId, 'open-group'),
            liveRow(otherId, 'other-group'),
            liveRow(ownId, 'own-group'),
        ]);
    });

    it('homework quiz get resolves course groups that the teacher cannot attach', async () => {
        const courseId = new ObjectId();
        courseForGet = {
            docId: courseId,
            domainId,
            owner: teacherId,
            kind: 'course',
            title: '算法课',
            dag: [{ _id: 1, title: '第一章' }],
            courseGroupIds: [otherId],
        };
        const handler = makeEditor(HomeworkEditHandler, restrictedHomeworkUser());
        await using(() => handler.get('forged-domain', undefined, courseId, 1));
        expectCatalog(handler.response.body.scopeGroups as CatalogRow[], [liveRow(openId, 'open-group'), liveRow(ownId, 'own-group'), liveRow(otherId, 'other-group')]);
        expect(handler.response.body.participantGroupIds).to.deep.equal([otherId.toHexString()]);
    });

    it('contest edit get unions attachable groups with saved groups', async () => {
        const contest = contestDocument([otherId, deletedId]);
        const handler = makeEditor(ContestEditHandler, restrictedContestUser(), contest);
        await using(() => handler.get('forged-domain', contest.docId));
        expectCatalog(handler.response.body.scopeGroups as CatalogRow[], [liveRow(openId, 'open-group'), liveRow(ownId, 'own-group'), liveRow(otherId, 'other-group'), deletedRow(deletedId)]);
        expect((handler.response.body.scopeGroups as CatalogRow[]).map((row) => row._id.toHexString())).to.not.include(archivedId.toHexString());

        const editor = makeUser({ perms: [PERM.PERM_EDIT_CONTEST] });
        const unrestricted = makeEditor(ContestEditHandler, editor);
        await using(() => unrestricted.get('forged-domain'));
        expectCatalog(unrestricted.response.body.scopeGroups as CatalogRow[], [
            liveRow(archivedId, 'archived-group', archivedAt),
            liveRow(openId, 'open-group'),
            liveRow(otherId, 'other-group'),
            liveRow(ownId, 'own-group'),
        ]);
    });

    it('contest edit get keeps directory failure best-effort except required group contests', async () => {
        const created = makeEditor(ContestEditHandler, restrictedContestUser());
        await created.get('forged-domain');
        expect(created.response.body.scopeGroups).to.deep.equal([]);

        const schools = contestDocument([], { participantScopeMode: 'schools' });
        const schoolsHandler = makeEditor(ContestEditHandler, restrictedContestUser(), schools);
        await schoolsHandler.get('forged-domain', schools.docId);
        expect(schoolsHandler.response.body.scopeGroups).to.deep.equal([]);

        const team = contestDocument([], { participationMode: 'team', participantScopeMode: 'groups' });
        const teamHandler = makeEditor(ContestEditHandler, restrictedContestUser(), team);
        await teamHandler.get('forged-domain', team.docId);
        expect(teamHandler.response.body.scopeGroups).to.deep.equal([]);

        const required = contestDocument([], { participantScopeMode: 'groups' });
        const requiredHandler = makeEditor(ContestEditHandler, restrictedContestUser(), required);
        let caught: unknown;
        try {
            await requiredHandler.get('forged-domain', required.docId);
        } catch (error) {
            caught = error;
        }
        expect((caught as Error).name).to.equal('StudentDirectoryUnavailableError');
    });

    it('stats and seat catalog still load the full group list', () => {
        const source = readFileSync(require.resolve('../src/handler/contest.ts'), 'utf8');
        expect(source).to.include('const statsGroupDocs = await listContestScopeGroups(');
        expect(source).to.include('? await listContestScopeGroups(authoritativeDomainId, true)');
        expect(source).to.include(
            "const sids = participantScopeMode === 'schools' ? participantSchoolIds.map((s) => new ObjectId(s.trim())).filter(Boolean) : [];",
        );
        const fn = source.slice(source.indexOf('async function listContestScopeGroups'), source.indexOf('function contestGroupsUnrestricted'));
        expect(fn).to.include('studentDirectory().listUserGroups(domainId)');
        expect(fn).not.to.include('listAttachableGroups');
    });
});
