import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';
import { PermissionError, TrainingNotFoundError, ValidationError } from '../src/error';

const Module = require('module');

const domainId = 'system';
const forgedDomainId = 'forged-domain';
const ownerId = 21;
const otherOwnerId = 44;
const alreadyAttached = '这一章已经引用了题集，先在课程里移除它';

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

const { PERM } = require('../src/model/builtin.ts') as typeof import('../src/model/builtin');

interface ChapterNode {
    _id: number;
    title: string;
    content?: string;
    requireNids: number[];
    pids: number[];
    tids: ObjectId[];
    problemSetId?: ObjectId;
    stageIds?: number[];
}

interface StageNode {
    _id: number;
    title: string;
    requireNids: number[];
    pids: number[];
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
    dag: ChapterNode[];
}

interface ProblemSetDocument {
    docId: ObjectId;
    domainId: string;
    owner: number;
    maintainer: number[];
    kind: 'problem_set';
    title: string;
    dag: StageNode[];
}

interface SavedEdit {
    domainId: string;
    tid: string;
    dag: ChapterNode[] | undefined;
}

interface TestUser {
    _id: number;
    _problemAclLoaded: true;
    _problemAclDomainId: string;
    _pidNamespaceAclLoaded: true;
    _pidNamespaceAclDomainId: string;
    hasPerm: (...perms: bigint[]) => boolean;
    hasPriv: (...privs: number[]) => boolean;
    own: (doc: { owner?: number; maintainer?: number[] }) => boolean;
}

interface AttachHandler {
    user: TestUser;
    domain: { _id: string };
    tdoc?: CourseDocument;
    args: Record<string, unknown>;
    request: {
        body: Record<string, unknown>;
        headers: Record<string, string>;
        method: string;
        path: string;
        json: boolean;
    };
    response: { body: Record<string, unknown>; redirect?: string };
    postAttachProblemSet(payload: Record<string, unknown>): Promise<unknown>;
}

const edits: SavedEdit[] = [];
const courses = new Map<string, CourseDocument>();
const problemSets = new Map<string, ProblemSetDocument>();

function hexOf(id: ObjectId | string): string {
    if (typeof id === 'string') return id;
    if (id instanceof ObjectId) return id.toHexString();
    throw new TypeError('training id must be an ObjectId or string');
}

function docKey(storedDomainId: string, id: ObjectId | string): string {
    return `${storedDomainId}:${hexOf(id)}`;
}

const trainingStub = {
    async get(storedDomainId: string, id: ObjectId | string) {
        const course = courses.get(docKey(storedDomainId, id));
        if (course) return course;
        const problemSet = problemSets.get(docKey(storedDomainId, id));
        if (problemSet) return problemSet;
        throw new TrainingNotFoundError(storedDomainId, id);
    },
    async edit(storedDomainId: string, id: ObjectId | string, $set?: { dag?: ChapterNode[] }) {
        edits.push({
            domainId: String(storedDomainId),
            tid: hexOf(id),
            dag: $set?.dag,
        });
    },
    getPids(dag: Array<{ pids?: number[]; sections?: Array<{ pids?: number[] }> }> = []) {
        const ids: number[] = [];
        for (const node of dag) {
            ids.push(...(node.pids || []));
            for (const section of node.sections || []) ids.push(...(section.pids || []));
        }
        return Array.from(new Set(ids));
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
            createIndex: async () => undefined,
        };
    },
};

const busPath = require.resolve('../src/service/bus.ts');
const dbPath = require.resolve('../src/service/db.ts');
const trainingPath = require.resolve('../src/model/training.ts');
const originalLoad = Module._load;
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

Module._load = originalLoad;

type HandlerCtor = new (context: unknown, ctx: unknown) => AttachHandler;
const routes: Record<string, HandlerCtor> = {};
void courseModule.apply({
    Route(name: string, _path: string, HandlerClass: HandlerCtor) {
        routes[name] = HandlerClass;
    },
} as unknown as Parameters<typeof courseModule.apply>[0]);
const CourseEditHandler = routes.course_edit;
if (!CourseEditHandler) throw new Error('course_edit route missing');

function chapter(id: number, title: string, extra: Partial<ChapterNode> = {}): ChapterNode {
    return {
        _id: id,
        title,
        content: `${title}讲义`,
        requireNids: [],
        pids: [100 + id],
        tids: [new ObjectId()],
        ...extra,
    };
}

function makeCourse(dag: ChapterNode[], owner = ownerId): CourseDocument {
    const doc: CourseDocument = {
        docId: new ObjectId(),
        domainId,
        owner,
        maintainer: [],
        kind: 'course',
        title: '算法课',
        content: '',
        description: '',
        dag,
    };
    courses.set(docKey(domainId, doc.docId), doc);
    return doc;
}

function makeSet(owner: number): ProblemSetDocument {
    const doc: ProblemSetDocument = {
        docId: new ObjectId(),
        domainId,
        owner,
        maintainer: [],
        kind: 'problem_set',
        title: '练习',
        dag: [
            { _id: 1, title: '阶段一', requireNids: [], pids: [1] },
            { _id: 2, title: '阶段二', requireNids: [1], pids: [2] },
        ],
    };
    problemSets.set(docKey(domainId, doc.docId), doc);
    return doc;
}

function makeUser(id: number, perms: bigint[]): TestUser {
    const granted = new Set(perms);
    return {
        _id: id,
        _problemAclLoaded: true,
        _problemAclDomainId: domainId,
        _pidNamespaceAclLoaded: true,
        _pidNamespaceAclDomainId: domainId,
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => granted.has(perm)),
        hasPriv: () => false,
        own: (doc) => doc?.owner === id || (doc?.maintainer || []).includes(id),
    };
}

function ownerUser(): TestUser {
    return makeUser(ownerId, [PERM.PERM_EDIT_TRAINING_SELF]);
}

function view(node: ChapterNode): Record<string, unknown> {
    const result: Record<string, unknown> = {
        _id: node._id,
        title: node.title,
        content: node.content ?? '',
        pids: [...(node.pids || [])],
        tids: (node.tids || []).map((id) => id.toHexString()),
        problemSetId: node.problemSetId instanceof ObjectId ? node.problemSetId.toHexString() : '',
    };
    if (Object.hasOwn(node, 'stageIds')) result.stageIds = [...(node.stageIds || [])];
    return result;
}

function makeHandler(user: TestUser, course: CourseDocument, transport: { json: boolean; referer?: string }): AttachHandler {
    const headers: Record<string, string> = {
        accept: transport.json ? 'application/json' : 'text/html',
    };
    if (transport.referer) headers.referer = transport.referer;
    const request = {
        body: {} as Record<string, unknown>,
        headers,
        method: 'post',
        path: `/course/${course.docId.toHexString()}/edit`,
        ip: '127.0.0.1',
        json: transport.json,
    };
    const response: { body: Record<string, unknown>; redirect?: string } = { body: {} };
    const context = {
        session: {},
        holdFiles: [] as string[],
        HydroContext: {
            args: {} as Record<string, unknown>,
            request,
            response,
            UiContext: {},
        },
    };
    const handler = new CourseEditHandler(context, { parallel: async () => undefined });
    handler.user = user;
    handler.domain = { _id: domainId };
    handler.tdoc = course;
    return handler;
}

async function attach(input: {
    handler: AttachHandler;
    course: CourseDocument;
    problemSet: ProblemSetDocument;
    chapterId: number;
    stageIds?: number[];
}): Promise<void> {
    const payload = input.handler.args;
    payload.domainId = forgedDomainId;
    payload.tid = input.course.docId.toHexString();
    payload.operation = 'attach_problem_set';
    payload.problemSetId = input.problemSet.docId.toHexString();
    payload.chapter = input.chapterId;
    if (Object.hasOwn(input, 'stageIds')) payload.stageIds = input.stageIds;
    input.handler.request.body = payload;
    await input.handler.postAttachProblemSet(payload);
}

function savedDag(course: CourseDocument): ChapterNode[] {
    expect(edits.length).to.equal(1);
    expect(edits[0].domainId).to.equal(domainId);
    expect(edits[0].tid).to.equal(course.docId.toHexString());
    const dag = edits[0].dag;
    if (!Array.isArray(dag)) throw new Error('training.edit did not save dag');
    return dag;
}

async function rejection(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run();
    } catch (error) {
        return error;
    }
    throw new Error('expected the attach call to fail');
}

function expectUntouched(before: Array<Record<string, unknown>>, course: CourseDocument) {
    expect(edits.length).to.equal(0);
    expect(course.dag.map((node) => view(node))).to.deep.equal(before);
}

beforeEach(() => {
    edits.length = 0;
    courses.clear();
    problemSets.clear();
});

describe('attach problem set to a course chapter', { concurrency: false }, () => {
    it('writes the owner problem set onto chapter 2 and returns ok for json', async () => {
        const course = makeCourse([chapter(1, '第一章'), chapter(2, '第二章'), chapter(3, '第三章')]);
        const problemSet = makeSet(ownerId);
        const before = course.dag.map((node) => view(node));
        const handler = makeHandler(ownerUser(), course, { json: true });
        await attach({ handler, course, problemSet, chapterId: 2 });
        const after = savedDag(course).map((node) => view(node));
        expect(after.length).to.equal(before.length);
        expect(after[0]).to.deep.equal(before[0]);
        expect(after[2]).to.deep.equal(before[2]);
        expect(after[1]).to.deep.equal({ ...before[1], problemSetId: problemSet.docId.toHexString() });
        expect(Object.hasOwn(after[1], 'stageIds')).to.equal(false);
        expect(handler.response.body).to.deep.equal({ ok: true });
    });

    it('writes stage ids that belong to the problem set', async () => {
        const course = makeCourse([chapter(1, '第一章'), chapter(2, '第二章'), chapter(3, '第三章')]);
        const problemSet = makeSet(ownerId);
        const before = course.dag.map((node) => view(node));
        const handler = makeHandler(ownerUser(), course, { json: true });
        await attach({ handler, course, problemSet, chapterId: 2, stageIds: [2] });
        const after = savedDag(course).map((node) => view(node));
        expect(after[0]).to.deep.equal(before[0]);
        expect(after[2]).to.deep.equal(before[2]);
        expect(after[1]).to.deep.equal({
            ...before[1],
            problemSetId: problemSet.docId.toHexString(),
            stageIds: [2],
        });
        expect(handler.response.body).to.deep.equal({ ok: true });
    });

    it('omits stage ids when the list is empty', async () => {
        const course = makeCourse([chapter(1, '第一章'), chapter(2, '第二章'), chapter(3, '第三章')]);
        const problemSet = makeSet(ownerId);
        const before = course.dag.map((node) => view(node));
        const handler = makeHandler(ownerUser(), course, { json: true });
        await attach({ handler, course, problemSet, chapterId: 2, stageIds: [] });
        const after = savedDag(course).map((node) => view(node));
        expect(after[1]).to.deep.equal({ ...before[1], problemSetId: problemSet.docId.toHexString() });
        expect(Object.hasOwn(after[1], 'stageIds')).to.equal(false);
    });

    it('rejects a chapter that already references a problem set without writing', async () => {
        const existingSetId = new ObjectId();
        const course = makeCourse([
            chapter(1, '第一章'),
            chapter(2, '第二章', { problemSetId: existingSetId, stageIds: [1] }),
            chapter(3, '第三章'),
        ]);
        const problemSet = makeSet(ownerId);
        const before = course.dag.map((node) => view(node));
        const handler = makeHandler(ownerUser(), course, { json: true });
        const error = await rejection(() => attach({ handler, course, problemSet, chapterId: 2 }));
        expect(error).to.be.instanceOf(ValidationError);
        const validation = error as InstanceType<typeof ValidationError>;
        expect(validation.params[0]).to.equal('chapter');
        expect(validation.params[1]).to.equal(null);
        expect(validation.params[2]).to.equal(alreadyAttached);
        expectUntouched(before, course);
    });

    it('rejects a problem set the current user cannot manage', async () => {
        const course = makeCourse([chapter(1, '第一章'), chapter(2, '第二章'), chapter(3, '第三章')]);
        const problemSet = makeSet(otherOwnerId);
        const before = course.dag.map((node) => view(node));
        const handler = makeHandler(ownerUser(), course, { json: true });
        const error = await rejection(() => attach({ handler, course, problemSet, chapterId: 2 }));
        expect(error).to.be.instanceOf(PermissionError);
        expectUntouched(before, course);
    });

    it('rejects stage ids that are not on the problem set', async () => {
        const course = makeCourse([chapter(1, '第一章'), chapter(2, '第二章'), chapter(3, '第三章')]);
        const problemSet = makeSet(ownerId);
        const before = course.dag.map((node) => view(node));
        const handler = makeHandler(ownerUser(), course, { json: true });
        const error = await rejection(() => attach({ handler, course, problemSet, chapterId: 2, stageIds: [2, 99] }));
        expect(error).to.be.instanceOf(ValidationError);
        expectUntouched(before, course);
    });

    it('calls back for an html request after writing the chapter', async () => {
        const referer = '/course/back';
        const course = makeCourse([chapter(1, '第一章'), chapter(2, '第二章'), chapter(3, '第三章')]);
        const problemSet = makeSet(ownerId);
        const handler = makeHandler(ownerUser(), course, { json: false, referer });
        await attach({ handler, course, problemSet, chapterId: 2 });
        const saved = savedDag(course);
        const target = saved.find((node) => node._id === 2);
        if (!target?.problemSetId) throw new Error('chapter 2 problemSetId was not saved');
        expect(target.problemSetId.toHexString()).to.equal(problemSet.docId.toHexString());
        expect(handler.response.redirect).to.equal(referer);
    });
});
