import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';
import { PRIV } from '@hydrooj/common';

const { localizeError, localizedErrorText, NotFoundError, ValidationError } = require('../../hydrooj/src/error');
const { InMemoryStudentDirectory } = require('../../hydrooj/src/lib/testing/in-memory-student-directory');
const {
    assertGroupsAttachable,
    describeGroupRefs,
    listAttachableGroups,
    parseGroupIdList,
} = require('../../hydrooj/src/lib/user-group-attach');
const { withStudentDirectory } = require('../../hydrooj/src/service/student-directory');

interface StudentDirectoryGroup {
    _id: ObjectId;
    domainId: string;
    schoolId: ObjectId;
    name: string;
    ownerUid?: number;
    teacherAttachable?: boolean;
    archivedAt?: Date;
}

const Module = require('module');
const handlerPath = require.resolve('../src/handler.ts');
const originalLoad = Module._load;

const domainId = 'system';
const teacherId = 21;
const otherTeacherId = 44;
const archivedAt = new Date('2026-09-01T00:00:00.000Z');
const invalidMessage = '用户组参数无效';
const deletedMessage = '所选用户组已被删除，请先移除后再保存';

const schoolId = new ObjectId('66d220000000000000000001');
const taskId = new ObjectId('66d2200000000000000000aa');
const ownId = new ObjectId('66d220000000000000000011');
const otherId = new ObjectId('66d220000000000000000012');
const openId = new ObjectId('66d220000000000000000013');
const archivedId = new ObjectId('66d220000000000000000014');
const secretId = new ObjectId('66d220000000000000000015');
const deletedId = new ObjectId('66d220000000000000000016');

const writes = { audit: 0, create: 0, update: 0, assign: 0 };
let cloneCalls = 0;
let lastCloneGraph: any = null;
let allowModify = true;
let existingTask: any = null;
let directory = mainDirectory();
let listStudentCalls = 0;
let lastStudentDomain: string | null = null;
let lastStudentFilter: any = null;
let lastCreateData: any = null;

function cannotUse(name: string): string {
    return `你不能使用用户组「${name}」，只能使用自己的用户组或管理员开放给老师的本校用户组`;
}

function mainDirectory() {
    const groups: StudentDirectoryGroup[] = [
        { _id: ownId, domainId, schoolId, name: 'own-group', ownerUid: teacherId },
        { _id: otherId, domainId, schoolId, name: 'other-group', ownerUid: otherTeacherId },
        { _id: openId, domainId, schoolId, name: 'open-group', teacherAttachable: true },
        {
            _id: archivedId,
            domainId,
            schoolId,
            name: 'archived-group',
            teacherAttachable: true,
            archivedAt,
        },
        { _id: secretId, domainId, schoolId, name: 'secret-group', ownerUid: otherTeacherId },
    ];
    return new InMemoryStudentDirectory({
        schools: [{ _id: schoolId, domainId, name: '本校' }],
        groups,
    });
}

function publicTask(extra: Record<string, unknown> = {}) {
    return {
        _id: taskId,
        title: '已有任务',
        graph: bareGraph(),
        access: { type: 'public' },
        createdBy: teacherId,
        admissionMode: 'auto',
        quota: null,
        ...extra,
    };
}

function bareGraph() {
    return {
        nodes: [
            { id: 'start', type: 'start', position: { x: 0, y: 0 } },
            { id: 'end', type: 'end', position: { x: 0, y: 200 } },
        ],
        edges: [],
    };
}

function membershipNode(graph: { nodes: Array<{ presetId?: string; params?: { targetId?: unknown; scope?: unknown } }> }) {
    const node = graph.nodes.find((item) => item.presetId === 'group_membership');
    if (!node?.params) throw new Error('missing group_membership node');
    return node;
}

function membershipGraph(targetId: unknown, scope = 'user_group') {
    return {
        nodes: [
            { id: 'start', type: 'start', position: { x: 0, y: 0 } },
            {
                id: 'member',
                type: 'task',
                position: { x: 40, y: 80 },
                presetId: 'group_membership',
                name: '属于指定用户组',
                params: { scope, targetId },
            },
            { id: 'end', type: 'end', position: { x: 0, y: 200 } },
        ],
        edges: [],
    };
}

function directGraph(groupId: string) {
    return {
        nodes: [
            { id: 'start', type: 'start', position: { x: 0, y: 0 } },
            {
                id: 'direct',
                type: 'task',
                position: { x: 40, y: 80 },
                presetId: 'direct_group',
                name: '直接用户组',
                params: { groupId },
            },
            { id: 'end', type: 'end', position: { x: 0, y: 200 } },
        ],
        edges: [],
    };
}

function queryChain() {
    const chain = {
        project() {
            return chain;
        },
        sort() {
            return chain;
        },
        limit() {
            return chain;
        },
        async toArray() {
            return [];
        },
    };
    return chain;
}

const taskModel = {
    async getTask() {
        return existingTask;
    },
    async getTaskAssignments() {
        return [];
    },
    async writeAudit() {
        writes.audit += 1;
    },
    async createTask(_domainId: string, _uid: number, data: unknown) {
        writes.create += 1;
        lastCreateData = data;
        return new ObjectId();
    },
    async updateTask() {
        writes.update += 1;
    },
    async assignTask() {
        writes.assign += 1;
    },
    async cloneTask(_domainId: string, _sourceId: unknown, _actorUid: number, graph: unknown) {
        cloneCalls += 1;
        lastCloneGraph = graph;
        return new ObjectId();
    },
};

const userBindModel = {
    async listSchools(targetDomainId: string) {
        return directory.listSchools(targetDomainId);
    },
    async listUserGroups(targetDomainId: string) {
        return directory.listUserGroups(targetDomainId);
    },
    async listStudents(targetDomainId: string, filter: unknown) {
        listStudentCalls += 1;
        lastStudentDomain = targetDomainId;
        lastStudentFilter = filter;
        return { docs: [{ boundUserId: 8 }] };
    },
};

class FakeHandler {
    user: any;
    domain: { _id: string };
    response: Record<string, any> = {};

    url(name: string) {
        return `/${name}`;
    }
}

interface TaskHandler extends FakeHandler {
    get(domain: { domainId: string }, tid?: ObjectId): Promise<void>;
    post(
        domain: { domainId: string },
        tid: ObjectId | undefined,
        title: string,
        description: string,
        tags: string,
        graph: string,
        access: string,
        isActive: boolean,
        startDate: string,
        endDate: string,
        claimStartAt: string,
        claimEndAt: string,
        maxAssignments: number,
        countsAsStay: boolean,
        admissionMode: string,
        quota: number,
    ): Promise<void>;
    postBatch(domain: { domainId: string }, tid: ObjectId, scope: string, targetId: string, uid: number, note: string): Promise<void>;
    postClone(domain: { domainId: string }, tid: ObjectId): Promise<void>;
}

const typeToken: any = () => typeToken;
const Types = new Proxy({}, { get: () => typeToken });
const param = () => () => undefined;

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === handlerPath) {
        if (request === 'hydrooj') {
            return {
                Context: class {},
                DocumentModel: {
                    TYPE_CONTEST: 30,
                    TYPE_TRAINING: 40,
                    coll: { find: () => queryChain() },
                },
                ForbiddenError: class extends Error {},
                Handler: FakeHandler,
                NotFoundError,
                ObjectId,
                OplogModel: { log: async () => undefined },
                param,
                PRIV,
                ProblemModel: {
                    assertProblemAclDomain() {
                        return undefined;
                    },
                    async assertProblemBankSelection() {
                        return undefined;
                    },
                    async get() {
                        return null;
                    },
                },
                requireAuthToken: async () => ({}),
                Types,
                UserModel: { getList: async () => ({}) },
                ValidationError,
                assertGroupsAttachable,
                describeGroupRefs,
                listAttachableGroups,
                parseGroupIdList,
                localizeError,
                localizedErrorText,
            };
        }
        if (request === '@hydrooj/krypton-userbind') return { userBindModel };
        if (request === './auth') {
            return {
                canCreateTask: () => true,
                canManageAllTasks: () => false,
                canModifyTask: () => allowModify,
            };
        }
        if (request === './db') return { cspScoreColl: {}, gpltScoreColl: {}, patScoreColl: {} };
        if (request === './model') return { taskModel };
        if (request === './presets') {
            return {
                listTagAcCountOptions: async () => [],
                validateTagAcCountGraph: async () => undefined,
                presetSummaries: () => [
                    {
                        id: 'group_membership',
                        params: [
                            { name: 'scope', type: 'select', default: 'user_group' },
                            { name: 'targetId', type: 'user_group' },
                        ],
                    },
                    {
                        id: 'direct_group',
                        params: [{ name: 'groupId', type: 'user_group' }],
                    },
                ],
            };
        }
        if (request === './types') {
            return { emptyTaskGraph: bareGraph };
        }
    }
    return originalLoad.call(this, request, parent, isMain);
};

let AdminTasksEditHandler: any;
let AdminTasksAssignHandler: any;
let AdminTasksListHandler: any;
try {
    delete require.cache[handlerPath];
    ({ AdminTasksEditHandler, AdminTasksAssignHandler, AdminTasksListHandler } = require(handlerPath));
} finally {
    Module._load = originalLoad;
}

function actor(asSystem: boolean) {
    return {
        _id: teacherId,
        parentSchoolId: [schoolId],
        hasPriv(priv: number) {
            return asSystem && priv === PRIV.PRIV_EDIT_SYSTEM;
        },
    };
}

function handler(asSystem = false): TaskHandler {
    const instance = Reflect.construct(AdminTasksEditHandler, []) as TaskHandler;
    instance.user = actor(asSystem);
    instance.domain = { _id: domainId };
    instance.response = {};
    return instance;
}

function assignHandler(asSystem = false): TaskHandler {
    const instance = Reflect.construct(AdminTasksAssignHandler, []) as TaskHandler;
    instance.user = actor(asSystem);
    instance.domain = { _id: domainId };
    instance.response = {};
    return instance;
}

function listHandler(asSystem = false): TaskHandler {
    const instance = Reflect.construct(AdminTasksListHandler, []) as TaskHandler;
    instance.user = actor(asSystem);
    instance.domain = { _id: domainId };
    instance.response = {};
    return instance;
}

function using<T>(run: () => Promise<T>): Promise<T> {
    return withStudentDirectory(directory, run);
}

async function save(instance: TaskHandler, tid: ObjectId | undefined, access: string, graph: unknown) {
    return instance.post(
        { domainId: 'payload-ignored' },
        tid,
        '任务',
        '',
        '',
        JSON.stringify(graph),
        access,
        true,
        '',
        '',
        '',
        '',
        0,
        false,
        'auto',
        0,
    );
}

async function batch(instance: TaskHandler, scope: string, targetId: string, uid = 0) {
    return instance.postBatch({ domainId }, existingTask._id, scope, targetId, uid, '');
}

async function clone(instance: TaskHandler) {
    return instance.postClone({ domainId: 'payload-ignored' }, taskId);
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
    expect(error.name).to.equal('ValidationError');
    expect(error.code).to.equal(403);
    expect(error.params[0]).to.equal(field);
    expect(error.params[1]).to.equal(null);
    expect(error.params[2]).to.equal(detail);
}

function accessJson(type: string, targetId?: string) {
    return JSON.stringify(targetId === undefined ? { type } : { type, targetId });
}

async function editGroups(asSystem: boolean, task: ReturnType<typeof publicTask> | null) {
    existingTask = task;
    const instance = handler(asSystem);
    await using(async () => {
        await instance.get({ domainId: 'payload-ignored' }, task ? task._id : undefined);
    });
    return instance.response.body.userGroups as any[];
}

function groupNamed(name: string): StudentDirectoryGroup {
    const found = directory.groups.find((group) => group.name === name);
    if (!found) throw new Error(`missing fixture group ${name}`);
    return found;
}

function expectLive(group: any, source: StudentDirectoryGroup) {
    expect(group._id.toHexString()).to.equal(source._id.toHexString());
    expect(group.schoolId.toHexString()).to.equal(source.schoolId.toHexString());
    expect(group.name).to.equal(source.name);
    expect(group.archivedAt).to.equal(source.archivedAt);
    expect(group).to.not.have.property('attachable');
    expect(group).to.not.have.property('schoolName');
    expect(group).to.not.have.property('state');
    expect(group).to.not.have.property('kind');
}

function expectDeleted(group: any, id: ObjectId) {
    expect(group.name).to.equal('已删除的组');
    expect(group._id).to.be.instanceOf(ObjectId);
    expect(group._id.toHexString()).to.equal(id.toHexString());
    expect(group).to.not.have.property('schoolId');
    expect(group).to.not.have.property('attachable');
    expect(group).to.not.have.property('schoolName');
}

beforeEach(() => {
    allowModify = true;
    existingTask = publicTask();
    directory = mainDirectory();
    writes.audit = 0;
    writes.create = 0;
    writes.update = 0;
    writes.assign = 0;
    cloneCalls = 0;
    lastCloneGraph = null;
    listStudentCalls = 0;
    lastStudentDomain = null;
    lastStudentFilter = null;
    lastCreateData = null;
});

describe('task user-group attach', { concurrency: false }, () => {
    it('受限老师新建任务时不能把别人的组写成可见范围', async () => {
        const error = await rejection(() => using(() => save(handler(false), undefined, accessJson('user_group', otherId.toHexString()), bareGraph())));
        expectValidation(error, 'access', cannotUse('other-group'));
        expect(writes).to.deep.equal({ audit: 0, create: 0, update: 0, assign: 0 });
        expect(listStudentCalls).to.equal(0);
    });

    it('受限老师可以把自己的组写成可见范围', async () => {
        const instance = handler(false);
        await using(() => save(instance, undefined, accessJson('user_group', ownId.toHexString().toUpperCase()), bareGraph()));
        expect(instance.response.redirect).to.equal('/admin_tasks');
        expect(writes.create).to.equal(1);
        expect(writes.update).to.equal(0);
        expect(lastCreateData.access.targetId.toHexString()).to.equal(ownId.toHexString());
    });

    it('编辑时保留原来的不可挂组可以通过，ObjectId 与 hex 是同一个 id', async () => {
        existingTask = publicTask({ access: { type: 'user_group', targetId: otherId } });
        const instance = handler(false);
        await using(() => save(instance, taskId, accessJson('user_group', otherId.toHexString()), bareGraph()));
        expect(writes.update).to.equal(1);
        expect(writes.audit).to.equal(1);
        expect(instance.response.redirect).to.equal('/admin_tasks');
    });

    it('库存可见范围本来就是 hex 时，再次提交同一个 hex 不重复拦截', async () => {
        existingTask = publicTask({ access: { type: 'user_group', targetId: otherId.toHexString() } });
        await using(() => save(handler(false), taskId, accessJson('user_group', otherId.toHexString()), bareGraph()));
        expect(writes.update).to.equal(1);
    });

    it('把已保存的不可挂组从可见范围移除时不检查', async () => {
        existingTask = publicTask({ access: { type: 'user_group', targetId: otherId } });
        await using(() => save(handler(false), taskId, accessJson('public'), bareGraph()));
        expect(writes.update).to.equal(1);
        expect(writes.audit).to.equal(1);
    });

    it('继续保存已经删除的组会被拒绝', async () => {
        existingTask = publicTask({ access: { type: 'user_group', targetId: deletedId } });
        const error = await rejection(() => using(() => save(handler(false), taskId, accessJson('user_group', deletedId.toHexString()), bareGraph())));
        expectValidation(error, 'access', deletedMessage);
        expect(writes.update).to.equal(0);
    });

    it('移除已经删除的组可以通过', async () => {
        existingTask = publicTask({ access: { type: 'user_group', targetId: deletedId } });
        await using(() => save(handler(false), taskId, accessJson('public'), bareGraph()));
        expect(writes.update).to.equal(1);
    });

    it('库存里的非法可见范围 id 在换成别的组时不会被跳过', async () => {
        existingTask = publicTask({ access: { type: 'user_group', targetId: 'not-a-group' } });
        const error = await rejection(() => using(() => save(handler(false), taskId, accessJson('user_group', ownId.toHexString()), bareGraph())));
        expectValidation(error, 'access', invalidMessage);
        expect(error.name).to.not.equal('BSONError');
        expect(writes.update).to.equal(0);
    });

    it('可见范围从非法 id 改成 public 时不再解析 previous', async () => {
        existingTask = publicTask({ access: { type: 'user_group', targetId: 'not-a-group' } });
        await using(() => save(handler(false), taskId, accessJson('public'), bareGraph()));
        expect(writes.update).to.equal(1);
    });

    it('图里被删掉的非法 id 只要新图仍有用户组就不会被跳过', async () => {
        existingTask = publicTask({
            graph: {
                nodes: [
                    { id: 'start', type: 'start', position: { x: 0, y: 0 } },
                    {
                        id: 'bad',
                        type: 'task',
                        position: { x: 20, y: 40 },
                        presetId: 'group_membership',
                        name: '坏组',
                        params: { scope: 'user_group', targetId: 'not-a-group' },
                    },
                    {
                        id: 'kept',
                        type: 'task',
                        position: { x: 20, y: 100 },
                        presetId: 'group_membership',
                        name: '保留组',
                        params: { scope: 'user_group', targetId: ownId.toHexString() },
                    },
                    { id: 'end', type: 'end', position: { x: 0, y: 200 } },
                ],
                edges: [],
            },
        });
        const error = await rejection(() => using(() => save(handler(false), taskId, accessJson('public'), membershipGraph(ownId.toHexString()))));
        expectValidation(error, 'graph', invalidMessage);
        expect(writes.update).to.equal(0);
    });

    it('图里新增一个不可挂的 group_membership 目标会被拒绝', async () => {
        existingTask = publicTask({ graph: membershipGraph(ownId.toHexString()) });
        const error = await rejection(() =>
            using(() => save(handler(false), taskId, accessJson('public'), membershipGraph(otherId.toHexString()))),
        );
        expectValidation(error, 'graph', cannotUse('other-group'));
        expect(writes.update).to.equal(0);
    });

    it('图里原来的 ObjectId 与提交的 hex 是同一个组，不重复拦截', async () => {
        existingTask = publicTask({ graph: membershipGraph(otherId) });
        await using(() => save(handler(false), taskId, accessJson('public'), membershipGraph(otherId.toHexString())));
        expect(writes.update).to.equal(1);
    });

    it('图里原来的 hex 与再次提交的 hex 是同一个组，不重复拦截', async () => {
        existingTask = publicTask({ graph: membershipGraph(otherId.toHexString()) });
        await using(() => save(handler(false), taskId, accessJson('public'), membershipGraph(otherId.toHexString())));
        expect(writes.update).to.equal(1);
    });

    it('图节点 type 为 user_group 的新组同样被拒绝', async () => {
        const error = await rejection(() => using(() => save(handler(false), undefined, accessJson('public'), directGraph(otherId.toHexString()))));
        expectValidation(error, 'graph', cannotUse('other-group'));
        expect(writes.create).to.equal(0);
    });

    it('group_membership 的 scope 为 school 时不把 targetId 当作用户组', async () => {
        const instance = handler(false);
        await using(() => save(instance, undefined, accessJson('public'), membershipGraph(otherId.toHexString(), 'school')));
        expect(writes.create).to.equal(1);
        expect(instance.response.redirect).to.equal('/admin_tasks');
    });

    it('user_group 可见范围缺 targetId 时是 ValidationError，不再变成 public', async () => {
        const error = await rejection(() => using(() => save(handler(false), undefined, JSON.stringify({ type: 'user_group' }), bareGraph())));
        expectValidation(error, 'access', invalidMessage);
        expect(writes.create).to.equal(0);
    });

    it('非法用户组 id 是 ValidationError，不是 ObjectId 构造失败', async () => {
        for (const bad of ['not-a-group', '123456789012', 'zzzzzzzzzzzzzzzzzzzzzzzz']) {
            writes.create = 0;
            const error = await rejection(() =>
                using(() => save(handler(false), undefined, JSON.stringify({ type: 'user_group', targetId: bad }), bareGraph())),
            );
            expectValidation(error, 'access', invalidMessage);
            expect(error.name).to.not.equal('BSONError');
            expect(writes.create).to.equal(0);
        }
    });

    it('图里的非法用户组 id 也是 ValidationError', async () => {
        const error = await rejection(() => using(() => save(handler(false), taskId, accessJson('public'), membershipGraph('not-a-group'))));
        expectValidation(error, 'graph', invalidMessage);
        expect(error.name).to.not.equal('BSONError');
        expect(writes.update).to.equal(0);
        expect(writes.create).to.equal(0);
    });

    it('空 access 和坏掉的 JSON 仍然是 public', async () => {
        await using(() => save(handler(false), undefined, '', bareGraph()));
        expect(lastCreateData.access).to.deep.equal({ type: 'public' });
        writes.create = 0;
        lastCreateData = null;
        await using(() => save(handler(false), undefined, '{', bareGraph()));
        expect(writes.create).to.equal(1);
        expect(lastCreateData.access).to.deep.equal({ type: 'public' });
    });

    it('school 和 grade 可见范围不走用户组可挂检查', async () => {
        await using(() => save(handler(false), undefined, accessJson('school', schoolId.toHexString()), bareGraph()));
        expect(lastCreateData.access.type).to.equal('school');
        expect(lastCreateData.access.targetId.toHexString()).to.equal(schoolId.toHexString());
        writes.create = 0;
        await using(() => save(handler(false), undefined, JSON.stringify({ type: 'grade', years: [2024] }), bareGraph()));
        expect(writes.create).to.equal(1);
        expect(lastCreateData.access).to.deep.equal({ type: 'grade', years: [2024] });
    });

    it('受限老师不能新挂已归档组', async () => {
        const error = await rejection(() => using(() => save(handler(false), undefined, accessJson('user_group', archivedId.toHexString()), bareGraph())));
        expectValidation(error, 'access', cannotUse('archived-group'));
        expect(writes.create).to.equal(0);
    });

    it('PRIV_EDIT_SYSTEM 可以新挂已归档组', async () => {
        const instance = handler(true);
        await using(() => save(instance, undefined, accessJson('user_group', archivedId.toHexString()), bareGraph()));
        expect(writes.create).to.equal(1);
        expect(lastCreateData.access.targetId.toHexString()).to.equal(archivedId.toHexString());
        expect(instance.response.redirect).to.equal('/admin_tasks');
    });

    it('没有修改权限时先拒绝，不会去查用户组目录', async () => {
        allowModify = false;
        existingTask = publicTask();
        let caught: unknown;
        try {
            await save(handler(false), taskId, accessJson('user_group', ownId.toHexString()), bareGraph());
        } catch (error) {
            caught = error;
        }
        expect(caught).to.be.instanceOf(NotFoundError);
        expect((caught as InstanceType<typeof NotFoundError>).params[0]).to.equal('任务不存在');
        expect(writes.update).to.equal(0);
        expect(listStudentCalls).to.equal(0);
    });

    it('postBatch 的 user_group 目标对受限老师拒绝，且不把任务上已有的组当成 previous', async () => {
        existingTask = publicTask({ access: { type: 'user_group', targetId: otherId } });
        const instance = assignHandler(false);
        instance.domain = { _id: 'not-the-catalog-domain' };
        const error = await rejection(() => using(() => batch(instance, 'user_group', otherId.toHexString())));
        expectValidation(error, 'targetId', cannotUse('other-group'));
        expect(listStudentCalls).to.equal(0);
        expect(writes.assign).to.equal(0);
    });

    it('PRIV_EDIT_SYSTEM 的 postBatch 可以分配已归档组', async () => {
        const instance = assignHandler(true);
        instance.domain = { _id: 'not-the-catalog-domain' };
        await using(() => batch(instance, 'user_group', archivedId.toHexString()));
        expect(listStudentCalls).to.equal(1);
        expect(lastStudentDomain).to.equal(domainId);
        expect(lastStudentFilter.groupId.toHexString()).to.equal(archivedId.toHexString());
        expect(writes.assign).to.equal(1);
        expect(instance.response.redirect).to.equal('/admin_tasks_assign');
    });

    it('postBatch 的非法用户组 id 是 ValidationError，发生在拉学生之前', async () => {
        const error = await rejection(() => using(() => batch(assignHandler(false), 'user_group', 'not-a-group')));
        expectValidation(error, 'targetId', invalidMessage);
        expect(error.name).to.not.equal('BSONError');
        expect(listStudentCalls).to.equal(0);
        expect(writes.assign).to.equal(0);
    });

    it('postBatch 的 school 和 uid 不走用户组可挂检查', async () => {
        const schoolInstance = assignHandler(false);
        schoolInstance.domain = { _id: 'not-the-catalog-domain' };
        await using(() => batch(schoolInstance, 'school', otherId.toHexString()));
        expect(listStudentCalls).to.equal(1);
        expect(lastStudentDomain).to.equal(domainId);
        expect(lastStudentFilter.schoolId.toHexString()).to.equal(otherId.toHexString());
        expect(lastStudentFilter.groupId).to.equal(undefined);
        expect(writes.assign).to.equal(1);

        listStudentCalls = 0;
        writes.assign = 0;
        await using(() => batch(assignHandler(false), 'uid', '', 9));
        expect(listStudentCalls).to.equal(0);
        expect(writes.assign).to.equal(1);
    });

    it('postBatch 的空 targetId 保持不分配，空白 targetId 是 ValidationError', async () => {
        const instance = assignHandler(false);
        await using(() => batch(instance, 'user_group', ''));
        expect(listStudentCalls).to.equal(0);
        expect(writes.assign).to.equal(0);
        expect(instance.response.redirect).to.equal('/admin_tasks_assign');

        const error = await rejection(() => using(() => batch(assignHandler(false), 'user_group', '   ')));
        expectValidation(error, 'targetId', invalidMessage);
        expect(listStudentCalls).to.equal(0);
    });

    it('编辑页只下发可挂组和当前任务已经保存的组', async () => {
        const groups = await editGroups(false, publicTask({ access: { type: 'user_group', targetId: secretId } }));
        expect(groups.map((group) => group.name)).to.deep.equal(['own-group', 'open-group', 'secret-group']);
        expectLive(groups[0], groupNamed('own-group'));
        expectLive(groups[1], groupNamed('open-group'));
        expectLive(groups[2], groupNamed('secret-group'));
    });

    it('编辑页保留图里以 ObjectId 或 hex 存着的不可挂组', async () => {
        const byObjectId = await editGroups(false, publicTask({ graph: membershipGraph(secretId) }));
        expect(byObjectId.map((group) => group.name)).to.deep.equal(['own-group', 'open-group', 'secret-group']);
        expectLive(byObjectId[2], groupNamed('secret-group'));

        const byHex = await editGroups(false, publicTask({ graph: membershipGraph(secretId.toHexString()) }));
        expect(byHex.map((group) => group.name)).to.deep.equal(['own-group', 'open-group', 'secret-group']);
        expectLive(byHex[2], groupNamed('secret-group'));
    });

    it('已删除的已保存组用「已删除的组」，不编造 schoolId', async () => {
        const groups = await editGroups(false, publicTask({ access: { type: 'user_group', targetId: deletedId } }));
        expect(groups.map((group) => group.name)).to.deep.equal(['own-group', 'open-group', '已删除的组']);
        expectLive(groups[0], groupNamed('own-group'));
        expectLive(groups[1], groupNamed('open-group'));
        expectDeleted(groups[2], deletedId);
    });

    it('PRIV_EDIT_SYSTEM 的编辑页包含已归档和别人的组', async () => {
        const groups = await editGroups(true, publicTask());
        expect(groups.map((group) => group.name)).to.deep.equal(['own-group', 'other-group', 'open-group', 'archived-group', 'secret-group']);
        expectLive(groups[1], groupNamed('other-group'));
        expectLive(groups[3], groupNamed('archived-group'));
    });

    it('新建页没有已保存组时只下发可挂组', async () => {
        const groups = await editGroups(false, null);
        expect(groups.map((group) => group.name)).to.deep.equal(['own-group', 'open-group']);
        expectLive(groups[0], groupNamed('own-group'));
        expectLive(groups[1], groupNamed('open-group'));
    });

    it('分配页的 userGroups 仍是完整目录，不按可挂过滤', async () => {
        existingTask = publicTask();
        const instance = assignHandler(false);
        instance.domain = { _id: 'not-the-catalog-domain' };
        await using(() => instance.get({ domainId }, taskId));
        const groups = instance.response.body.userGroups as any[];
        expect(groups.map((group) => group.name)).to.deep.equal(['own-group', 'other-group', 'open-group', 'archived-group', 'secret-group']);
        expectLive(groups[1], groupNamed('other-group'));
        expectLive(groups[3], groupNamed('archived-group'));
    });

    it('受限老师复制 access 为别人的组时拒绝，且不创建新任务', async () => {
        existingTask = publicTask({ access: { type: 'user_group', targetId: otherId } });
        const error = await rejection(() => using(() => clone(listHandler(false))));
        expectValidation(error, 'access', cannotUse('other-group'));
        expect(cloneCalls).to.equal(0);
        expect(writes).to.deep.equal({ audit: 0, create: 0, update: 0, assign: 0 });
    });

    it('受限老师可以复制自己的组', async () => {
        existingTask = publicTask({ access: { type: 'user_group', targetId: ownId } });
        const instance = listHandler(false);
        await using(() => clone(instance));
        expect(cloneCalls).to.equal(1);
        expect(instance.response.redirect).to.equal('/admin_tasks_edit');
        expect(writes).to.deep.equal({ audit: 0, create: 0, update: 0, assign: 0 });
    });

    it('源任务上的不可挂组也算新增，不能因为本来就在源任务上而通过', async () => {
        existingTask = publicTask({
            access: { type: 'user_group', targetId: ownId },
            graph: membershipGraph(otherId),
        });
        const error = await rejection(() => using(() => clone(listHandler(false))));
        expectValidation(error, 'graph', cannotUse('other-group'));
        expect(cloneCalls).to.equal(0);
    });

    it('受限老师不能复制已归档组，PRIV_EDIT_SYSTEM 可以', async () => {
        existingTask = publicTask({ access: { type: 'user_group', targetId: archivedId } });
        const error = await rejection(() => using(() => clone(listHandler(false))));
        expectValidation(error, 'access', cannotUse('archived-group'));
        expect(cloneCalls).to.equal(0);

        const instance = listHandler(true);
        await using(() => clone(instance));
        expect(cloneCalls).to.equal(1);
        expect(instance.response.redirect).to.equal('/admin_tasks_edit');
    });

    it('源任务 access 指向已删除的组时拒绝复制', async () => {
        existingTask = publicTask({ access: { type: 'user_group', targetId: deletedId } });
        const error = await rejection(() => using(() => clone(listHandler(false))));
        expectValidation(error, 'access', deletedMessage);
        expect(cloneCalls).to.equal(0);
    });

    it('源任务 access.targetId 非法时是 ValidationError，不是 BSONError', async () => {
        existingTask = publicTask({ access: { type: 'user_group', targetId: 'not-a-group' } });
        const error = await rejection(() => using(() => clone(listHandler(false))));
        expectValidation(error, 'access', invalidMessage);
        expect(error.name).to.not.equal('BSONError');
        expect(cloneCalls).to.equal(0);
    });

    it('图里 group_membership 或 type 为 user_group 的不可挂组会拒绝复制', async () => {
        existingTask = publicTask({ graph: membershipGraph(otherId.toHexString()) });
        const membershipError = await rejection(() => using(() => clone(listHandler(false))));
        expectValidation(membershipError, 'graph', cannotUse('other-group'));
        expect(cloneCalls).to.equal(0);

        existingTask = publicTask({ graph: directGraph(otherId.toHexString()) });
        const directError = await rejection(() => using(() => clone(listHandler(false))));
        expectValidation(directError, 'graph', cannotUse('other-group'));
        expect(cloneCalls).to.equal(0);
    });

    it('group_membership 的 scope 为 school 且 access 为 public 时可以复制', async () => {
        existingTask = publicTask({
            access: { type: 'public' },
            graph: membershipGraph(otherId.toHexString(), 'school'),
        });
        await using(() => clone(listHandler(false)));
        expect(cloneCalls).to.equal(1);
    });

    it('public 加空图不检查用户组，可以复制', async () => {
        existingTask = publicTask();
        await using(() => clone(listHandler(false)));
        expect(cloneCalls).to.equal(1);
        expect(writes).to.deep.equal({ audit: 0, create: 0, update: 0, assign: 0 });
    });

    it('hex 与 ObjectId 都会先规范化再检查，非法字符串不是 BSONError', async () => {
        existingTask = publicTask({ access: { type: 'user_group', targetId: ownId.toHexString().toUpperCase() } });
        await using(() => clone(listHandler(false)));
        expect(cloneCalls).to.equal(1);

        cloneCalls = 0;
        existingTask = publicTask({ access: { type: 'user_group', targetId: otherId.toHexString() } });
        const accessError = await rejection(() => using(() => clone(listHandler(false))));
        expectValidation(accessError, 'access', cannotUse('other-group'));
        expect(accessError.name).to.not.equal('BSONError');
        expect(cloneCalls).to.equal(0);

        existingTask = publicTask({ graph: membershipGraph('zzzzzzzzzzzzzzzzzzzzzzzz') });
        const graphError = await rejection(() => using(() => clone(listHandler(false))));
        expectValidation(graphError, 'graph', invalidMessage);
        expect(graphError.name).to.not.equal('BSONError');
        expect(cloneCalls).to.equal(0);
    });

    it('新建 group_membership 时把大写用户组 id 收成小写 hex', async () => {
        const upper = ownId.toHexString().toUpperCase();
        const instance = handler(false);
        await using(() => save(instance, undefined, accessJson('public'), membershipGraph(upper, 'user_group')));
        expect(writes.create).to.equal(1);
        expect(membershipNode(lastCreateData.graph).params.targetId).to.equal(ownId.toHexString());
    });

    it('新建 group_membership 且 scope 为 school 时大写 targetId 原样保存', async () => {
        const upper = ownId.toHexString().toUpperCase();
        const instance = handler(false);
        await using(() => save(instance, undefined, accessJson('public'), membershipGraph(upper, 'school')));
        expect(writes.create).to.equal(1);
        expect(instance.response.redirect).to.equal('/admin_tasks');
        expect(membershipNode(lastCreateData.graph).params.targetId).to.equal(upper);
    });

    it('复制时把非 school 的大写 targetId 收成小写 hex 传给 cloneTask', async () => {
        const upper = ownId.toHexString().toUpperCase();
        existingTask = publicTask({ graph: membershipGraph(upper, 'user_group') });
        await using(() => clone(listHandler(false)));
        expect(cloneCalls).to.equal(1);
        const source = membershipNode(existingTask.graph);
        const copied = membershipNode(lastCloneGraph);
        expect(copied.params.targetId).to.equal(ownId.toHexString());
        expect(source.params.targetId).to.equal(upper);
        expect(copied.params).to.not.equal(source.params);
    });
});
