import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';
import { ValidationError } from '../src/error';
import { InMemoryStudentDirectory } from '../src/lib/testing/in-memory-student-directory';
import type { StudentDirectoryGroup, StudentDirectorySchool } from '../src/service/student-directory';
import { withStudentDirectory } from '../src/service/student-directory';

const Module = require('module');

const domainId = 'system';
const teacherId = 21;
const maintainerId = 33;
const otherTeacherId = 44;
const archivedAt = new Date('2026-09-01T00:00:00.000Z');
const schoolId = new ObjectId('66d200000000000000000001');
const ownId = new ObjectId('66d210000000000000000001');
const otherId = new ObjectId('66d210000000000000000002');
const openId = new ObjectId('66d210000000000000000003');
const archivedId = new ObjectId('66d210000000000000000004');
const deletedId = new ObjectId('66d210000000000000000005');
const chapters = JSON.stringify([{ _id: 1, title: '第一章', pids: [], tids: [] }]);
const deletedMessage = '所选用户组已被删除，请先移除后再保存';
const invalidMessage = '用户组参数无效';
const storedMessage = '课程可见范围无效';

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
const originalLoad = Module._load;
const writes: Array<{ op: 'add' | 'edit'; courseGroupIds: ObjectId[] }> = [];

const trainingStub = {
    async add(_domainId: string, _title: string, _content: string, _owner: number, _dag: unknown, _description: string, _pin: number, extra?: { courseGroupIds?: ObjectId[] }) {
        writes.push({ op: 'add', courseGroupIds: extra?.courseGroupIds || [] });
        return new ObjectId();
    },
    async edit(_domainId: string, _tid: ObjectId, $set?: { courseGroupIds?: ObjectId[] }) {
        writes.push({ op: 'edit', courseGroupIds: $set?.courseGroupIds || [] });
    },
    async get() {
        return { kind: 'course', dag: [], title: '算法课' };
    },
    getPids(dag: Array<{ pids?: number[]; sections?: Array<{ pids?: number[] }> }> = []) {
        const ids: number[] = [];
        for (const node of dag) {
            ids.push(...(node.pids || []));
            for (const section of node.sections || []) ids.push(...(section.pids || []));
        }
        return Array.from(new Set(ids));
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
            insertOne: async () => ({ insertedId: new ObjectId() }),
            updateOne: async () => ({ matchedCount: 0 }),
            findOneAndUpdate: async () => null,
            deleteOne: async () => ({ deletedCount: 0 }),
            deleteMany: async () => ({ deletedCount: 0 }),
            countDocuments: async () => 0,
        };
    },
};

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (typeof request === 'string') {
        try {
            const resolved = Module._resolveFilename(request, parent, isMain);
            if (resolved === busPath) return busStub;
            if (resolved === dbPath) return dbStub;
            if (resolved === trainingPath) return trainingStub;
        } catch {
            // Unresolvable optional imports keep the original loader.
        }
    }
    return originalLoad.call(this, request, parent, isMain);
};

const courseModule = require('../src/handler/course.ts') as typeof import('../src/handler/course');
const { PERM, PRIV } = require('../src/model/builtin.ts') as typeof import('../src/model/builtin');

Module._load = originalLoad;

const routes: Record<string, new (...args: unknown[]) => CourseEditor> = {};
void courseModule.apply({
    Route(name: string, _path: string, HandlerClass: new (...args: unknown[]) => CourseEditor) {
        routes[name] = HandlerClass;
    },
} as unknown as Parameters<typeof courseModule.apply>[0]);
const CourseEditHandler = routes.course_edit;

interface CourseEditor {
    user: TestUser;
    domain: { _id: string };
    tdoc?: CourseDocument;
    request: { body: Record<string, unknown>; headers: Record<string, string>; method: string; path: string; ip: string };
    response: { body: Record<string, unknown>; template?: string; redirect?: string };
    post(...args: unknown[]): Promise<unknown>;
    get(...args: unknown[]): Promise<unknown>;
    postCopy(...args: unknown[]): Promise<unknown>;
}

interface TestUser {
    _id: number;
    parentSchoolId: ObjectId[];
    _problemAclLoaded: true;
    _problemAclDomainId: string;
    _pidNamespaceAclLoaded: true;
    _pidNamespaceAclDomainId: string;
    hasPerm: (...perms: bigint[]) => boolean;
    hasPriv: (...privs: number[]) => boolean;
    own: (doc: { owner?: number; maintainer?: number[] }) => boolean;
}

interface CourseDocument {
    docId: ObjectId;
    domainId: string;
    owner: number;
    maintainer: number[];
    kind: 'course';
    title: string;
    content: string;
    description: string;
    dag: Array<{ _id: number; title: string; pids: number[]; tids: unknown[] }>;
    courseGroupIds: unknown;
}

function installMindmap() {
    (global.Hydro.model as { mindmap?: Record<string, unknown> }).mindmap = {
        async listPublicMaps() {
            return [];
        },
        async getPublicMap() {
            return null;
        },
        async getPublicSnapshot() {
            return null;
        },
        async getCourseOwnedMap() {
            return null;
        },
        async getCourseOwnedSnapshot() {
            return null;
        },
        async createCourseOwnedMap() {
            return null;
        },
        async updateCourseOwnedMap() {
            return null;
        },
        async deleteCourseOwnedMap() {
            return null;
        },
        async createCourseOwnedNode() {
            return null;
        },
        async updateCourseOwnedNode() {
            return null;
        },
        async moveCourseOwnedNode() {
            return null;
        },
        async deleteCourseOwnedNode() {
            return undefined;
        },
    };
}

installMindmap();

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

function makeUser(options: { id?: number; perms?: bigint[]; priv?: number; parentSchoolId?: ObjectId[] } = {}): TestUser {
    const id = options.id ?? teacherId;
    const perms = new Set(options.perms || []);
    const priv = options.priv || 0;
    return {
        _id: id,
        parentSchoolId: options.parentSchoolId === undefined ? [schoolId] : options.parentSchoolId,
        _problemAclLoaded: true,
        _problemAclDomainId: domainId,
        _pidNamespaceAclLoaded: true,
        _pidNamespaceAclDomainId: domainId,
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => perms.has(perm)),
        hasPriv: (...wanted: number[]) => wanted.some((flag) => (priv & flag) === flag),
        own: (doc) => doc?.owner === id || (doc?.maintainer || []).includes(id),
    };
}

function restrictedTeacher(id = teacherId, perms: bigint[] = [PERM.PERM_CREATE_COURSE, PERM.PERM_MANAGE_OWN_USER_GROUP]) {
    return makeUser({ id, perms });
}

function courseDocument(groupIds: unknown, extra: Partial<CourseDocument> = {}): CourseDocument {
    return {
        docId: new ObjectId(),
        domainId,
        owner: teacherId,
        maintainer: [],
        kind: 'course',
        title: '算法课',
        content: '',
        description: '',
        dag: [{ _id: 1, title: '第一章', pids: [], tids: [] }],
        courseGroupIds: groupIds,
        ...extra,
    };
}

function makeHandler(user = restrictedTeacher(), tdoc?: CourseDocument): CourseEditor {
    const request = { body: {} as Record<string, unknown>, headers: {}, method: 'post', path: '/course/edit', ip: '127.0.0.1' };
    const response = { body: {} as Record<string, unknown> };
    const context = {
        session: {},
        holdFiles: [],
        HydroContext: { args: {}, request, response, UiContext: {} },
    };
    const handler = new CourseEditHandler(context, { parallel: async () => undefined });
    handler.user = user;
    handler.domain = { _id: domainId };
    if (tdoc) handler.tdoc = tdoc;
    return handler;
}

function using<T>(run: () => Promise<T>): Promise<T> {
    return withStudentDirectory(directory(), run);
}

async function save(handler: CourseEditor, tid: ObjectId | null, groupIds: string[]) {
    return handler.post('forged-domain', tid, '算法课', '', chapters, '', '', groupIds);
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

function expectWritten(op: 'add' | 'edit', ids: ObjectId[]) {
    expect(writes).to.have.length(1);
    expect(writes[0].op).to.equal(op);
    expect(writes[0].courseGroupIds.map((id) => id.toHexString())).to.deep.equal(ids.map((id) => id.toHexString()));
}

beforeEach(() => {
    writes.length = 0;
    installMindmap();
});

describe('Course edit group attach', { concurrency: false }, () => {
    it('restricted actor can attach their own group when creating a course', async () => {
        await using(() => save(makeHandler(), null, [ownId.toHexString()]));
        expectWritten('add', [ownId]);
    });

    it("restricted actor adding someone else's group is rejected", async () => {
        const created = await rejection(() => using(() => save(makeHandler(), null, [otherId.toHexString()])));
        expectValidation(created, 'courseGroupIds', cannotUse('other-group'));
        expect(writes).to.deep.equal([]);

        const existing = courseDocument([ownId]);
        const edited = await rejection(() => using(() => save(makeHandler(restrictedTeacher(), existing), existing.docId, [ownId.toHexString(), otherId.toHexString()])));
        expectValidation(edited, 'courseGroupIds', cannotUse('other-group'));
        expect(writes).to.deep.equal([]);
    });

    it('create uses previous [] even when the handler already has a stored course', async () => {
        const existing = courseDocument([otherId]);
        const error = await rejection(() => using(() => save(makeHandler(restrictedTeacher(), existing), null, [otherId.toHexString()])));
        expectValidation(error, 'courseGroupIds', cannotUse('other-group'));
        expect(writes).to.deep.equal([]);
    });

    it('keeping an already-attached unattachable group is allowed', async () => {
        const existing = courseDocument([otherId]);
        await using(() => save(makeHandler(restrictedTeacher(), existing), existing.docId, [otherId.toHexString()]));
        expectWritten('edit', [otherId]);
    });

    it('removing any group is allowed', async () => {
        const partial = courseDocument([otherId, ownId]);
        await using(() => save(makeHandler(restrictedTeacher(), partial), partial.docId, [ownId.toHexString()]));
        expectWritten('edit', [ownId]);

        writes.length = 0;
        const last = courseDocument([otherId]);
        await using(() => save(makeHandler(restrictedTeacher(), last), last.docId, []));
        expectWritten('edit', []);
    });

    it('illegal format errors', async () => {
        const error = await rejection(() => using(() => save(makeHandler(), null, [ownId.toHexString(), 'not-a-group'])));
        expectValidation(error, 'courseGroupIds', invalidMessage);
        expect(writes).to.deep.equal([]);
    });

    it('deleted group errors', async () => {
        const added = await rejection(() => using(() => save(makeHandler(), null, [deletedId.toHexString()])));
        expectValidation(added, 'courseGroupIds', deletedMessage);
        expect(writes).to.deep.equal([]);

        const existing = courseDocument([deletedId]);
        const kept = await rejection(() => using(() => save(makeHandler(restrictedTeacher(), existing), existing.docId, [deletedId.toHexString()])));
        expectValidation(kept, 'courseGroupIds', deletedMessage);
        expect(writes).to.deep.equal([]);
    });

    it('unrestricted actor can attach any existing group', async () => {
        const systemActor = makeUser({ priv: PRIV.PRIV_EDIT_SYSTEM, perms: [PERM.PERM_CREATE_COURSE] });
        await using(() => save(makeHandler(systemActor), null, [archivedId.toHexString(), otherId.toHexString()]));
        expectWritten('add', [archivedId, otherId]);

        writes.length = 0;
        const editor = makeUser({ id: 99, perms: [PERM.PERM_EDIT_COURSE], parentSchoolId: [], priv: 0 });
        await using(() => save(makeHandler(editor), null, [archivedId.toHexString()]));
        expectWritten('add', [archivedId]);
    });

    it('copy fails if the source has an unattachable group', async () => {
        const source = courseDocument([otherId], { owner: otherTeacherId });
        const handler = makeHandler(restrictedTeacher(), source);
        handler.request.body.courseGroupIds = [ownId.toHexString()];
        const error = await rejection(() => using(() => handler.postCopy('forged-domain', source.docId)));
        expectValidation(error, 'courseGroupIds', cannotUse('other-group'));
        expect(writes).to.deep.equal([]);
    });

    it('copy writes the source groups and ignores client input', async () => {
        const source = courseDocument([ownId, openId]);
        const handler = makeHandler(restrictedTeacher(), source);
        handler.request.body.courseGroupIds = [otherId.toHexString()];
        await using(() => handler.postCopy('forged-domain', source.docId));
        expectWritten('add', [ownId, openId]);
    });

    it('stored ids that are not ObjectIds throw before edit, copy, or get writes', async () => {
        const stored = courseDocument([ownId.toHexString()]);
        const edited = await rejection(() => using(() => save(makeHandler(restrictedTeacher(), stored), stored.docId, [])));
        expectValidation(edited, 'courseGroupIds', storedMessage);
        expect(writes).to.deep.equal([]);

        const copied = await rejection(() => using(() => makeHandler(restrictedTeacher(), stored).postCopy('forged-domain', stored.docId)));
        expectValidation(copied, 'courseGroupIds', storedMessage);
        expect(writes).to.deep.equal([]);

        const shown = await rejection(() => using(() => makeHandler(restrictedTeacher(), stored).get('forged-domain')));
        expectValidation(shown, 'courseGroupIds', storedMessage);
        expect(writes).to.deep.equal([]);
    });

    it("maintainer saving the owner's course passes when the owner's groups are unchanged", async () => {
        const source = courseDocument([ownId], { owner: teacherId, maintainer: [maintainerId] });
        const maintainer = restrictedTeacher(maintainerId);
        await using(() => save(makeHandler(maintainer, source), source.docId, [ownId.toHexString()]));
        expectWritten('edit', [ownId]);
    });

    it('edit get does not send groups and sends groupOptions, attachedGroups, and canManageOwnGroups', async () => {
        const source = courseDocument([otherId, deletedId]);
        const allowed = makeHandler(restrictedTeacher(), source);
        await using(() => allowed.get('forged-domain'));
        const body = allowed.response.body;
        expect(body).to.not.have.property('groups');
        expect(body.canManageOwnGroups).to.equal(true);
        expect(body.groupOptions).to.deep.equal([
            { _id: openId.toHexString(), name: 'open-group', schoolName: 'Parent', state: 'active', kind: 'school', attachable: true },
            { _id: ownId.toHexString(), name: 'own-group', schoolName: 'Parent', state: 'active', kind: 'own', attachable: true },
        ]);
        expect(body.attachedGroups).to.deep.equal([
            { _id: otherId.toHexString(), name: 'other-group', schoolName: 'Parent', state: 'active', kind: 'other-teacher', attachable: false },
            { _id: deletedId.toHexString(), name: null, schoolName: null, state: 'deleted', kind: 'unknown', attachable: false },
        ]);
        expect(writes).to.deep.equal([]);

        const withoutPerm = makeHandler(makeUser({ perms: [PERM.PERM_CREATE_COURSE] }), source);
        await using(() => withoutPerm.get('forged-domain'));
        expect(withoutPerm.response.body).to.not.have.property('groups');
        expect(withoutPerm.response.body.canManageOwnGroups).to.equal(false);

        const systemWithoutGroupPerm = makeHandler(makeUser({ priv: PRIV.PRIV_EDIT_SYSTEM, perms: [] }));
        await using(() => systemWithoutGroupPerm.get('forged-domain'));
        expect(systemWithoutGroupPerm.response.body.canManageOwnGroups).to.equal(false);
        expect(systemWithoutGroupPerm.response.body.attachedGroups).to.deep.equal([]);
        expect(systemWithoutGroupPerm.response.body.groupOptions).to.deep.equal([
            { _id: archivedId.toHexString(), name: 'archived-group', schoolName: 'Parent', state: 'archived', kind: 'school', attachable: true },
            { _id: openId.toHexString(), name: 'open-group', schoolName: 'Parent', state: 'active', kind: 'school', attachable: true },
            { _id: otherId.toHexString(), name: 'other-group', schoolName: 'Parent', state: 'active', kind: 'other-teacher', attachable: true },
            { _id: ownId.toHexString(), name: 'own-group', schoolName: 'Parent', state: 'active', kind: 'own', attachable: true },
        ]);
    });

    it('unrestricted course editor sees every existing group on get', async () => {
        const editor = makeUser({ id: 99, perms: [PERM.PERM_EDIT_COURSE], parentSchoolId: [], priv: 0 });
        const handler = makeHandler(editor);
        await using(() => handler.get('forged-domain'));
        expect(handler.response.body).to.not.have.property('groups');
        expect(handler.response.body.groupOptions).to.deep.equal([
            { _id: archivedId.toHexString(), name: 'archived-group', schoolName: 'Parent', state: 'archived', kind: 'school', attachable: true },
            { _id: openId.toHexString(), name: 'open-group', schoolName: 'Parent', state: 'active', kind: 'school', attachable: true },
            { _id: otherId.toHexString(), name: 'other-group', schoolName: 'Parent', state: 'active', kind: 'other-teacher', attachable: true },
            { _id: ownId.toHexString(), name: 'own-group', schoolName: 'Parent', state: 'active', kind: 'other-teacher', attachable: true },
        ]);
        expect(handler.response.body.attachedGroups).to.deep.equal([]);
    });

    it('unrestricted actor can copy a source group a restricted actor cannot attach', async () => {
        const source = courseDocument([archivedId, otherId], { owner: otherTeacherId });
        const systemActor = makeUser({ priv: PRIV.PRIV_EDIT_SYSTEM, perms: [PERM.PERM_CREATE_COURSE] });
        const handler = makeHandler(systemActor, source);
        handler.request.body.courseGroupIds = [ownId.toHexString()];
        await using(() => handler.postCopy('forged-domain', source.docId));
        expectWritten('add', [archivedId, otherId]);
    });
});
