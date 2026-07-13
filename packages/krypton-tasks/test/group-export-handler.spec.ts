import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
const handlerPath = require.resolve('../src/handler.ts');
const originalLoad = Module._load;

const groupId = new ObjectId();
const schoolId = new ObjectId();
const calls = {
    getTask: 0,
    assignmentFilter: null as unknown,
    groupArgs: null as any,
    oplog: null as any,
};

const taskModel = {
    async getTask() {
        calls.getTask++;
        return { _id: new ObjectId(), title: '任务', graph: { nodes: [], edges: [] } };
    },
    async getTaskAssignments(_domainId: string, _tid: ObjectId, filter: unknown) {
        calls.assignmentFilter = filter;
        return [{ userId: 42 }, { userId: 7 }, { userId: 42 }];
    },
};

const userBindModel = {
    async createGroupFromBoundUsers(...args: any[]) {
        calls.groupArgs = args;
        const result = {
            group: { _id: groupId, schoolId },
            memberCount: 2,
        };
        await args[5](result);
        return result;
    },
};

class FakeForbiddenError extends Error {
    code = 403;
}

class FakeHandler {
    user: any;
    response: Record<string, any> = {};

    checkPriv(priv: number) {
        if (!this.user.hasPriv(priv)) throw new FakeForbiddenError('forbidden');
    }

    url(name: string, params: Record<string, any>) {
        if (name === 'admin_userbind_group_detail') return `/admin/userbind/groups/${params.groupId.toHexString()}`;
        return '/';
    }
}

const typeToken: any = () => typeToken;
const Types = new Proxy({}, { get: () => typeToken });
const param = () => () => undefined;

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === handlerPath) {
        if (request === 'hydrooj') {
            return {
                Context: class {},
                DocumentModel: { TYPE_CONTEST: 30, TYPE_TRAINING: 40, coll: {} },
                ForbiddenError: FakeForbiddenError,
                Handler: FakeHandler,
                NotFoundError: class extends Error {},
                ObjectId,
                OplogModel: {
                    log: async (_handler: unknown, event: string, payload: unknown) => {
                        calls.oplog = { event, payload };
                    },
                },
                param,
                PRIV: { PRIV_EDIT_SYSTEM: 1, PRIV_USER_PROFILE: 2 },
                ProblemModel: {},
                requireAuthToken: async () => ({}),
                Types,
                UserModel: {
                    getList: async () => ({
                        7: { _id: 7, uname: 'seven' },
                        42: { _id: 42, uname: 'forty-two' },
                    }),
                },
                ValidationError: class extends Error {},
            };
        }
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

let AdminTasksStatsHandler: any;
try {
    delete require.cache[handlerPath];
    ({ AdminTasksStatsHandler } = require(handlerPath));
} finally {
    Module._load = originalLoad;
}

function handler(isAdmin: boolean) {
    const instance = Reflect.construct(AdminTasksStatsHandler, []) as FakeHandler;
    instance.user = { _id: 2, hasPriv: (priv: number) => isAdmin && priv === 1 };
    instance.response = {};
    return instance as any;
}

async function captureFailure(run: Promise<unknown>): Promise<any> {
    try {
        await run;
        return null;
    } catch (error) {
        return error;
    }
}

beforeEach(() => {
    calls.getTask = 0;
    calls.assignmentFilter = null;
    calls.groupArgs = null;
    calls.oplog = null;
});

describe('P1.6 task group export route', () => {
    it('rejects a task manager without PRIV_EDIT_SYSTEM before reading or writing', async () => {
        const error = await captureFailure(handler(false).postExportGroup({ domainId: 'system' }, new ObjectId(), '任务组'));

        expect(error).to.be.instanceOf(FakeForbiddenError);
        expect(calls.getTask).to.equal(0);
        expect(calls.groupArgs).to.equal(null);
    });

    it('derives and deduplicates members from non-cancelled assignments', async () => {
        const instance = handler(true);
        const tid = new ObjectId();
        await instance.postExportGroup({ domainId: 'system' }, tid, '任务组');

        expect(calls.assignmentFilter).to.deep.equal({ status: { $ne: 'cancelled' } });
        expect(calls.groupArgs[0]).to.equal('system');
        expect(calls.groupArgs[1]).to.equal('任务组');
        expect(calls.groupArgs[2]).to.equal(2);
        expect(calls.groupArgs[3]).to.deep.equal([
            { userId: 42, username: 'forty-two' },
            { userId: 7, username: 'seven' },
        ]);
        expect(calls.groupArgs[4]).to.deep.equal({ taskId: tid.toHexString() });
        expect(calls.groupArgs[5]).to.be.a('function');
        expect(calls.oplog).to.deep.equal({
            event: 'tasks.export_user_group',
            payload: {
                taskId: tid.toHexString(),
                groupId: groupId.toHexString(),
                schoolId: schoolId.toHexString(),
                memberCount: 2,
            },
        });
        expect(instance.response.redirect).to.equal(`/admin/userbind/groups/${groupId.toHexString()}`);
    });
});
