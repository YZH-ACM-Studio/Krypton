import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
const handlerPath = require.resolve('../src/handler.ts');
const originalLoad = Module._load;

const assertionCalls: Array<{
    domainId: string;
    pids: number[];
    user: any;
    grandfatheredPids?: number[];
}> = [];
const aclDomainCalls: string[] = [];
const dbDomains: string[] = [];
const writes = { audit: 0, create: 0, update: 0 };
let assertionFailure: Error | null = null;
let existingTask: any = null;

const ProblemModel = {
    assertProblemAclDomain(user: any, domainId: string) {
        aclDomainCalls.push(domainId);
        if (domainId !== user._problemAclDomainId) throw new Error('ACL domain mismatch');
    },
    async assertProblemBankSelection(
        domainId: string, pids: number[], user: any, grandfatheredPids?: number[],
    ) {
        assertionCalls.push({ domainId, pids, user, grandfatheredPids });
        if (assertionFailure) throw assertionFailure;
    },
    buildProblemBankScope: () => ({}),
    canBrowseProblemBank: () => true,
    getMulti: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
};

const taskModel = {
    async getTask(domainId: string) { dbDomains.push(domainId); return existingTask; },
    async writeAudit() { writes.audit++; },
    async createTask(domainId: string) { dbDomains.push(domainId); writes.create++; return 'new-task'; },
    async updateTask(domainId: string) { dbDomains.push(domainId); writes.update++; },
};

class FakeHandler {
    user: any;
    response: Record<string, any> = {};
    request = { headers: {} };
    url() { return '/admin/tasks'; }
}

class FakeObjectId {
    constructor(private readonly value = '000000000000000000000001') {}
    static isValid() { return true; }
    toHexString() { return this.value; }
}

class FakeValidationError extends Error {}

const typeToken: any = () => typeToken;
const Types = new Proxy({}, { get: () => typeToken });
const param = () => () => undefined;

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === handlerPath) {
        if (request === 'hydrooj') {
            return {
                Context: class {},
                DocumentModel: { TYPE_CONTEST: 30, TYPE_TRAINING: 40, coll: {} },
                ForbiddenError: class extends Error {},
                Handler: FakeHandler,
                NotFoundError: class extends Error {},
                ObjectId: FakeObjectId,
                OplogModel: { log: async () => undefined },
                param,
                PRIV: { PRIV_EDIT_SYSTEM: 1, PRIV_USER_PROFILE: 2 },
                ProblemModel,
                requireAuthToken: async () => ({}),
                Types,
                UserModel: {},
                ValidationError: FakeValidationError,
            };
        }
        if (request === '@hydrooj/krypton-userbind') return { userBindModel: {} };
        if (request === './auth') {
            return {
                canCreateTask: () => true,
                canManageAllTasks: () => false,
                canModifyTask: () => true,
            };
        }
        if (request === './db') return { cspScoreColl: {}, gpltScoreColl: {}, patScoreColl: {} };
        if (request === './model') return { taskModel };
        if (request === './presets') {
            return {
                presetSummaries: () => [{
                    id: 'specific_problem',
                    params: [{ name: 'problemId', type: 'problem' }],
                }],
            };
        }
        if (request === './types') {
            return {
                emptyTaskGraph: () => ({
                    nodes: [
                        { id: 'start', type: 'start', position: { x: 0, y: 0 } },
                        { id: 'end', type: 'end', position: { x: 0, y: 200 } },
                    ],
                    edges: [],
                }),
            };
        }
    }
    return originalLoad.call(this, request, parent, isMain);
};

let adminTasksEditHandlerClass: any;
try {
    delete require.cache[handlerPath];
    ({ AdminTasksEditHandler: adminTasksEditHandlerClass } = require(handlerPath));
} finally {
    Module._load = originalLoad;
}

function graph(...pids: number[]) {
    return {
        nodes: [
            { id: 'start', type: 'start', position: { x: 0, y: 0 } },
            ...pids.map((pid, index) => ({
                id: `problem-${index}`,
                type: 'task',
                position: { x: 0, y: 50 + index * 50 },
                presetId: 'specific_problem',
                name: '特定题目',
                params: { problemId: pid },
            })),
            { id: 'end', type: 'end', position: { x: 0, y: 200 } },
        ],
        edges: [],
    };
}

function task(graphValue: ReturnType<typeof graph>) {
    return {
        _id: new FakeObjectId(),
        graph: graphValue,
        createdBy: 42,
        admissionMode: 'auto',
        quota: null,
    };
}

function handler() {
    const instance = Reflect.construct(adminTasksEditHandlerClass, []);
    instance.user = { _id: 42, _problemAclDomainId: 'system' };
    instance.domain = { _id: 'system' };
    instance.response = {};
    return instance;
}

async function post(
    instance: any,
    tid: any,
    graphValue: ReturnType<typeof graph>,
    payloadDomainId = 'system',
) {
    return instance.post(
        { domainId: payloadDomainId }, tid, '任务', '', '', JSON.stringify(graphValue),
        JSON.stringify({ type: 'public' }), true, '', '', '', '', 0, false, 'auto', 0,
    );
}

async function captureFailure(run: Promise<unknown>) {
    try {
        await run;
        return null;
    } catch (error) {
        return error as Error;
    }
}

beforeEach(() => {
    assertionCalls.length = 0;
    aclDomainCalls.length = 0;
    dbDomains.length = 0;
    writes.audit = 0;
    writes.create = 0;
    writes.update = 0;
    assertionFailure = null;
    existingTask = null;
});

describe('task problem-selection write gate', () => {
    it('rejects a newly selected pid before create performs any write', async () => {
        assertionFailure = new Error('selection denied');
        const error = await captureFailure(post(handler(), undefined, graph(20)));

        expect(error?.message).to.equal('selection denied');
        expect(assertionCalls).to.have.length(1);
        expect(assertionCalls[0].pids).to.deep.equal([20]);
        expect(assertionCalls[0].grandfatheredPids).to.equal(undefined);
        expect(writes).to.deep.equal({ audit: 0, create: 0, update: 0 });
    });

    it('rejects a newly added pid before an edit audit or update is written', async () => {
        const tid = new FakeObjectId();
        existingTask = task(graph(10));
        assertionFailure = new Error('selection denied');
        const error = await captureFailure(post(handler(), tid, graph(10, 20)));

        expect(error?.message).to.equal('selection denied');
        expect(assertionCalls[0].pids).to.deep.equal([10, 20]);
        expect(assertionCalls[0].grandfatheredPids).to.deep.equal([10]);
        expect(writes).to.deep.equal({ audit: 0, create: 0, update: 0 });
    });

    it('passes the old graph union as grandfathered and preserves an unchanged legacy pid', async () => {
        const tid = new FakeObjectId();
        existingTask = task(graph(10));
        await post(handler(), tid, graph(10));

        expect(assertionCalls[0].pids).to.deep.equal([10]);
        expect(assertionCalls[0].grandfatheredPids).to.deep.equal([10]);
        expect(writes).to.deep.equal({ audit: 1, create: 0, update: 1 });
    });

    it('ignores a forged method domain and performs every edit read/write in the handler domain', async () => {
        const tid = new FakeObjectId();
        existingTask = task(graph(10));
        await post(handler(), tid, graph(10), 'forged-domain');

        expect(aclDomainCalls).to.deep.equal(['system']);
        expect(assertionCalls[0].domainId).to.equal('system');
        expect(dbDomains).to.deep.equal(['system', 'system']);
        expect(dbDomains).not.to.include('forged-domain');
    });
});
