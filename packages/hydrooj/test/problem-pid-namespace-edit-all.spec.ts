import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {}, ui: {} };

class TestValidationError extends Error {}

const problemPath = require.resolve('../src/model/problem.ts');
const originalLoad = Module._load;
let currentProblem: any;
let claimedCapability = '';
let committedSet: Record<string, unknown> = {};
let committedUnset: Record<string, unknown> = {};

const genericRelativeStub = new Proxy(
    {},
    {
        get(_target, key) {
            if (key === '__esModule') return false;
            if (key === 'default') return {};
            return () => undefined;
        },
    },
);

const documentStub = {
    TYPE_PROBLEM: 10,
    coll: {
        async findOne() {
            return currentProblem;
        },
    },
};

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename !== problemPath) return originalLoad.call(this, request, parent, isMain);
    if (request === '@hydrooj/common') {
        return {
            parseProblemKind: (value: unknown) => value,
            ProblemConfigFile: class {},
            ProblemType: {},
        };
    }
    if (request === '@hydrooj/utils/lib/utils') {
        return {
            extractZip: () => undefined,
            Logger: class {
                error() {}
                info() {}
                warn() {}
            },
            size: () => 0,
            streamToBuffer: async () => Buffer.alloc(0),
        };
    }
    if (request === '../context') return { Context: class {} };
    if (request === '../error') {
        return new Proxy({ ValidationError: TestValidationError }, { get: (target, key: string) => target[key] || Error });
    }
    if (request === '../service/bus') {
        return { __esModule: true, default: { emit: () => undefined }, parallelAllSettled: async () => [] };
    }
    if (request === '../service/db') return { __esModule: true, default: {} };
    if (request === './builtin') return { PERM: {}, STATUS: {} };
    if (request === './document') return documentStub;
    if (request === './domain') return { __esModule: true, default: {} };
    if (request === './oplog') return { add: async () => undefined };
    if (request === './problem-access') {
        return new Proxy(
            {
                canMaintainProblem: () => false,
                canUseProblemWriteCapability: (user: any, _pdoc: any, capability: string) =>
                    user.namespaceEditAll === true && ['content', 'metadata', 'data', 'tag'].includes(capability),
                PROBLEM_ACL_INTERNAL_FIELDS: new Set(),
            },
            { get: (target, key: string) => target[key] || (() => undefined) },
        );
    }
    if (request === './problem-pid-namespace') {
        return {
            ensurePidNamespaceIndexes: async () => undefined,
            withLivePidNamespaceGrant: async (_claim: any, work: () => Promise<unknown>) => work(),
        };
    }
    if (request.startsWith('.')) return genericRelativeStub;
    return originalLoad.call(this, request, parent, isMain);
};

let ProblemModel: any;
try {
    delete require.cache[problemPath];
    ProblemModel = require(problemPath).default;
} finally {
    Module._load = originalLoad;
}

ProblemModel.withAuthorizedWriteClaim = async (
    domainId: string,
    pid: number,
    user: any,
    operation: string,
    work: (claim: any) => Promise<unknown>,
    options: any,
) => {
    claimedCapability = options.capability;
    return work({
        domainId,
        pid,
        actor: user._id,
        operation,
        capability: options.capability,
        requestId: 'namespace-edit-all',
        pidNamespaceId: currentProblem.pidNamespaceId,
        pidNamespaceGrant: 'editAll',
        state: 'active',
    });
};

ProblemModel.editWithClaim = async (_claim: any, set: Record<string, unknown>, unset: Record<string, unknown>) => {
    committedSet = structuredClone(set);
    committedUnset = structuredClone(unset);
    return { ...currentProblem, ...set };
};

beforeEach(() => {
    currentProblem = {
        domainId: 'system',
        docType: 10,
        docId: 7,
        pid: 'OS1001',
        pidNamespaceId: 'custom:os',
        owner: 2,
        title: '旧标题',
        content: '# 旧题面',
        html: false,
        hidden: false,
        lockHidden: false,
        difficulty: 2,
        tag: ['模拟'],
    };
    claimedCapability = '';
    committedSet = {};
    committedUnset = {};
});

describe('P2.38 legacy namespace edit-all save path', () => {
    it('uses a namespace metadata claim and drops protected no-op form fields', async () => {
        await ProblemModel.editAuthorized(
            'system',
            7,
            {
                title: '新标题',
                content: '# 新题面',
                html: false,
                difficulty: 4,
                tag: ['模拟', 'STL'],
                pid: 'OS1001',
                hidden: false,
                lockHidden: false,
            },
            { _id: 8, namespaceEditAll: true },
        );

        expect(claimedCapability).to.equal('metadata');
        expect(committedSet).to.deep.equal({
            title: '新标题',
            content: '# 新题面',
            html: false,
            difficulty: 4,
            tag: ['模拟', 'STL'],
        });
        expect(committedUnset).to.deep.equal({});
    });

    it('does not erase changed protected fields before the claim scope can reject them', async () => {
        await ProblemModel.editAuthorized(
            'system',
            7,
            {
                content: '# 新题面',
                pid: 'OS1002',
                hidden: true,
                lockHidden: true,
            },
            { _id: 8, namespaceEditAll: true },
            { archivedAt: 1 },
        );

        expect(claimedCapability).to.equal('metadata');
        expect(committedSet).to.include({ pid: 'OS1002', hidden: true, lockHidden: true });
        expect(committedUnset).to.deep.equal({ archivedAt: 1 });
    });

    it('rejects managed authoring state on a legacy problem before acquiring a claim', async () => {
        let error: unknown;
        try {
            await ProblemModel.editAuthorized(
                'system',
                7,
                {
                    content: '# 新题面',
                    managedAuthoring: {
                        workingTitle: '伪造托管题',
                        selectedMindmapNodeIds: [],
                        metadataStatus: 'draft',
                    },
                },
                { _id: 8, namespaceEditAll: true },
            );
        } catch (caught) {
            error = caught;
        }

        expect(error).to.be.instanceOf(TestValidationError);
        expect(claimedCapability).to.equal('');
        expect(committedSet).to.deep.equal({});

        let unsetError: unknown;
        try {
            await ProblemModel.editAuthorized('system', 7, { content: '# 新题面' }, { _id: 8, namespaceEditAll: true }, { managedAuthoring: 1 });
        } catch (caught) {
            unsetError = caught;
        }
        expect(unsetError).to.be.instanceOf(TestValidationError);
        expect(claimedCapability).to.equal('');
    });
});
