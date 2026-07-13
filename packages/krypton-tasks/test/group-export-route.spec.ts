import { createRequire } from 'node:module';
import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const framework = require('../../../framework/framework');
const Module = require('module');
const requireFromFramework = createRequire(require.resolve('../../../framework/framework/package.json'));
const { ObjectId } = requireFromFramework('mongodb');

const PRIV_EDIT_SYSTEM = 1;
const groupId = new ObjectId();
const schoolId = new ObjectId();
const calls = {
    assignmentFilter: null as unknown,
    createArgs: null as any,
    groups: new Set<string>(),
    studentMemberships: 0,
    userMemberships: 0,
    oplog: [] as Array<{ event: string; payload: any }>,
};
let assignmentUserIds = [7, 42, 7];
let rejectCrossSchool = false;

const taskModel = {
    async getTask() {
        return { _id: new ObjectId(), title: '任务', graph: { nodes: [], edges: [] } };
    },
    async getTaskAssignments(_domainId: string, _tid: unknown, filter: unknown) {
        calls.assignmentFilter = filter;
        return assignmentUserIds.map((userId) => ({ userId }));
    },
};

const userBindModel = {
    async createGroupFromBoundUsers(
        _domainId: string,
        name: string,
        _createdBy: number,
        targets: Array<{ userId: number; username: string }>,
        context: { taskId: string },
        recordSuccess: (result: any) => Promise<void>,
    ) {
        calls.createArgs = { name, targets, context };
        if (rejectCrossSchool) throw new framework.ValidationError('users', null, '任务成员属于多个学校');
        if (calls.groups.has(name)) throw new framework.ValidationError('name', null, 'Group name already exists in this school');
        calls.groups.add(name);
        calls.studentMemberships = targets.length;
        calls.userMemberships = targets.length;
        const result = { group: { _id: groupId, schoolId }, memberCount: targets.length };
        await recordSuccess(result);
        return result;
    },
};

const hydroojStub = {
    ...framework,
    Context: class {},
    DocumentModel: { TYPE_CONTEST: 30, TYPE_TRAINING: 40, coll: {} },
    Handler: framework.Handler,
    ObjectId,
    OplogModel: {
        async log(_handler: unknown, event: string, payload: any) {
            calls.oplog.push({ event, payload });
        },
    },
    PRIV: { PRIV_EDIT_SYSTEM, PRIV_USER_PROFILE: 2 },
    ProblemModel: {},
    requireAuthToken: async () => ({}),
    UserModel: {
        async getList() {
            return {
                7: { _id: 7, uname: 'seven' },
                42: { _id: 42, uname: 'forty-two' },
            };
        },
    },
};

const handlerPath = require.resolve('../src/handler.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === handlerPath) {
        if (request === 'hydrooj') return hydroojStub;
        if (request === '@hydrooj/krypton-userbind') return { userBindModel };
        if (request === './auth') {
            return {
                canCreateTask: () => true,
                canManageAllTasks: () => false,
                canModifyTask: () => true,
            };
        }
        if (request === './db') return { cspScoreColl: {}, gpltScoreColl: {}, patScoreColl: {} };
        if (request === './model') return { taskModel };
        if (request === './presets') return { presetSummaries: () => [] };
        if (request === './types') return { emptyTaskGraph: () => ({ nodes: [], edges: [] }) };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let applyHandlers: (ctx: any) => void;
try {
    delete require.cache[handlerPath];
    ({ applyHandlers } = require(handlerPath));
} finally {
    Module._load = originalLoad;
}

const routes = new Map<string, any>();
applyHandlers({
    Route(name: string, _path: string, HandlerClass: any) {
        routes.set(name, HandlerClass);
    },
});

function adminUser() {
    return {
        _id: 2,
        hasPriv: (priv: number) => priv === PRIV_EDIT_SYSTEM,
        hasPerm: () => false,
    };
}

async function dispatch(body: Record<string, any>, referer = '') {
    const tid = new ObjectId();
    const request = {
        method: 'post',
        host: 'example.test',
        hostname: 'example.test',
        ip: '127.0.0.1',
        headers: referer ? { referer } : {},
        cookies: {},
        body,
        files: {},
        query: {},
        querystring: '',
        path: `/admin/tasks/${tid.toHexString()}/stats`,
        originalPath: `/admin/tasks/${tid.toHexString()}/stats`,
        params: { tid },
        referer,
        json: false,
        websocket: false,
    };
    const response = {
        body: undefined as any,
        type: '',
        status: 200,
        template: undefined as string | undefined,
        redirect: undefined as string | undefined,
        attachment() {},
        addHeader() {},
    };
    const koaContext: any = {
        method: 'POST',
        params: { tid },
        request,
        session: {},
        holdFiles: [],
        HydroContext: {
            args: { domainId: 'system', tid, ...body },
            request,
            response,
            UiContext: {},
        },
    };
    const service: any = {
        activeHandlers: new Map(),
        ctx: {
            async parallel(event: string, handler: any) {
                if (event === 'handler/create') {
                    handler.user = adminUser();
                    handler.domain = { _id: 'system' };
                    handler.checkPriv = (...privileges: number[]) => {
                        if (!privileges.every((privilege) => handler.user.hasPriv(privilege))) {
                            throw new framework.ForbiddenError('Missing privilege');
                        }
                    };
                    handler.url = (name: string, params: Record<string, any>) =>
                        name === 'admin_userbind_group_detail' ? `/admin/userbind/groups/${params.groupId.toHexString()}` : '/';
                    handler.onerror = async (error: any) => {
                        response.status = error.code || 500;
                        response.body = {
                            error: {
                                name: error.name,
                                params: error.params,
                                message: error.message,
                                stack: error.stack,
                            },
                        };
                    };
                }
            },
            async serial() {
                return undefined;
            },
        },
    };
    const savedContext = {
        plugin() {
            return {
                ctx: { server: { renderers: {} } },
                async dispose() {
                    return undefined;
                },
            };
        },
    };
    const HandlerClass = routes.get('admin_tasks_stats');
    await (framework.WebService.prototype as any).handleHttp.call(service, koaContext, HandlerClass, () => {}, savedContext);
    return response;
}

beforeEach(() => {
    calls.assignmentFilter = null;
    calls.createArgs = null;
    calls.groups.clear();
    calls.studentMemberships = 0;
    calls.userMemberships = 0;
    calls.oplog.length = 0;
    assignmentUserIds = [7, 42, 7];
    rejectCrossSchool = false;
});

describe('P1.6 task group export HTTP route', () => {
    it('dispatches export_group to postExportGroup exactly once', async () => {
        const response = await dispatch({ operation: 'export_group', name: '任务组' });

        expect(response.status, JSON.stringify(response.body, null, 2)).to.equal(200);
        expect(calls.assignmentFilter).to.deep.equal({ status: { $ne: 'cancelled' } });
        expect(calls.createArgs.targets).to.deep.equal([
            { userId: 7, username: 'seven' },
            { userId: 42, username: 'forty-two' },
        ]);
        expect(calls.groups.size).to.equal(1);
        expect(calls.oplog).to.have.lengthOf(1);
        expect(response.redirect).to.equal(`/admin/userbind/groups/${groupId.toHexString()}`);
    });

    it('rejects a cross-origin POST before the operation reads assignments', async () => {
        const response = await dispatch({ operation: 'export_group', name: '任务组' }, 'https://evil.example/attack');

        expect(response.status).to.equal(403);
        expect(response.body.error.name).to.equal('CsrfTokenError');
        expect(calls.assignmentFilter).to.equal(null);
        expect(calls.groups.size).to.equal(0);
    });

    it('rejects a repeated group name without creating a second group', async () => {
        const first = await dispatch({ operation: 'export_group', name: '任务组' });
        const second = await dispatch({ operation: 'export_group', name: '任务组' });

        expect(first.status, JSON.stringify(first.body, null, 2)).to.equal(200);
        expect(second.status).to.equal(403);
        expect(second.body.error.name).to.equal('ValidationError');
        expect(calls.groups.size).to.equal(1);
        expect(calls.oplog).to.have.lengthOf(1);
    });

    it('ignores forged UID fields and leaves zero writes when assignment members are cross-school', async () => {
        rejectCrossSchool = true;
        const response = await dispatch({ operation: 'export_group', name: '任务组', userIds: '999,1000' });

        expect(response.status).to.equal(403);
        expect(calls.createArgs.targets).to.deep.equal([
            { userId: 7, username: 'seven' },
            { userId: 42, username: 'forty-two' },
        ]);
        expect(calls.groups.size).to.equal(0);
        expect(calls.studentMemberships).to.equal(0);
        expect(calls.userMemberships).to.equal(0);
        expect(calls.oplog).to.have.lengthOf(0);
    });
});
