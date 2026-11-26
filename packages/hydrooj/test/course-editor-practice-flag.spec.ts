import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';
import { InMemoryStudentDirectory } from '../src/lib/testing/in-memory-student-directory';
import { withStudentDirectory } from '../src/service/student-directory';

const Module = require('module');

const domainId = 'system';
const teacherId = 21;

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

const trainingStub = {
    async add() {
        return new ObjectId();
    },
    async edit() {
        return undefined;
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
};

const userModel = (global.Hydro.model as {
    user: { getList: (domainId: string, uids: number[]) => Promise<Record<string, unknown>> };
}).user;
userModel.getList = async () => ({});

const routes: Record<string, new (...args: unknown[]) => CourseEditor> = {};
void courseModule.apply({
    Route(name: string, _path: string, HandlerClass: new (...args: unknown[]) => CourseEditor) {
        routes[name] = HandlerClass;
    },
} as unknown as Parameters<typeof courseModule.apply>[0]);
const CourseEditHandler = routes.course_edit;
if (!CourseEditHandler) throw new Error('course_edit route missing');

interface CourseEditor {
    user: TestUser;
    domain: { _id: string };
    tdoc?: CourseDocument;
    response: { body: Record<string, unknown>; template?: string };
    get(domainId: string): Promise<unknown>;
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
    courseGroupIds: ObjectId[];
}

function makeUser(perm: bigint, priv = 0): TestUser {
    return {
        _id: teacherId,
        parentSchoolId: [],
        _problemAclLoaded: true,
        _problemAclDomainId: domainId,
        _pidNamespaceAclLoaded: true,
        _pidNamespaceAclDomainId: domainId,
        hasPerm: (...wanted: bigint[]) => wanted.some((bit) => (perm & bit) === bit),
        hasPriv: (...wanted: number[]) => wanted.some((flag) => (priv & flag) === flag),
        own: (doc) => doc?.owner === teacherId || (doc?.maintainer || []).includes(teacherId),
    };
}

function courseDocument(): CourseDocument {
    return {
        docId: new ObjectId(),
        domainId,
        owner: teacherId,
        maintainer: [],
        kind: 'course',
        title: '算法课',
        content: '',
        description: '',
        dag: [],
        courseGroupIds: [],
    };
}

function makeHandler(user: TestUser, savedCourse = true): CourseEditor {
    const request = { body: {} as Record<string, unknown>, headers: {}, method: 'get', path: '/course/edit', ip: '127.0.0.1' };
    const response = { body: {} as Record<string, unknown> };
    const context = {
        session: {},
        holdFiles: [],
        HydroContext: { args: {}, request, response, UiContext: {} },
    };
    const handler = new CourseEditHandler(context, { parallel: async () => undefined });
    handler.user = user;
    handler.domain = { _id: domainId };
    if (savedCourse) handler.tdoc = courseDocument();
    return handler;
}

function editBody(user: TestUser, savedCourse = true): Promise<Record<string, unknown>> {
    const handler = makeHandler(user, savedCourse);
    return withStudentDirectory(new InMemoryStudentDirectory(), async () => {
        await handler.get(domainId);
        return handler.response.body;
    });
}

describe('course editor practice creation flag', { concurrency: false }, () => {
    it('sets canCreatePractice from training permission, the teacher role, and system admin', async () => {
        const training = await editBody(makeUser(PERM.PERM_CREATE_TRAINING));
        expect(training.page_name).to.equal('course_edit');
        expect(training.canCreatePractice).to.equal(true);

        const teacher = await editBody(makeUser(PERM.PERM_TEACHER));
        expect(teacher.canCreatePractice).to.equal(false);

        const admin = await editBody(makeUser(0n, PRIV.PRIV_EDIT_SYSTEM));
        expect(admin.canCreatePractice).to.equal(true);
    });

    it('sets canCreatePractice from permission before the course document exists', async () => {
        const training = await editBody(makeUser(PERM.PERM_CREATE_TRAINING), false);
        expect(training.page_name).to.equal('course_create');
        expect(training.tdoc).to.equal(undefined);
        expect(training.canCreatePractice).to.equal(true);

        const teacher = await editBody(makeUser(PERM.PERM_TEACHER), false);
        expect(teacher.page_name).to.equal('course_create');
        expect(teacher.canCreatePractice).to.equal(false);

        const admin = await editBody(makeUser(0n, PRIV.PRIV_EDIT_SYSTEM), false);
        expect(admin.page_name).to.equal('course_create');
        expect(admin.canCreatePractice).to.equal(true);
    });
});
