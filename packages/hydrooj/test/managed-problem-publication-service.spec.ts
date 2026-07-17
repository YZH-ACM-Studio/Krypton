import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {}, ui: {} };
(global as any).Hydro.model ||= {};

class TestValidationError extends Error {}
class TestPermissionError extends Error {}
class TestMetadataConflictError extends Error {}
class TestStructureConflictError extends Error {}
class TestPublicationCommittedError extends Error {
    constructor(readonly pdoc: any) {
        super('publication committed but session finalization failed');
    }
}

const draft = {
    domainId: 'system',
    docId: 7,
    pid: 'P3107',
    problemKind: 'programming',
    authoringMode: 'managed',
    hidden: true,
    sourceMeta: { template: 'self', year: 2026 },
    managedAuthoring: { workingTitle: '工作标题', selectedMindmapNodeIds: ['node-1'], metadataStatus: 'draft' },
    content: '# 题面',
    config: { cases: [{ input: '1.in', output: '1.out' }] },
    data: [{ name: '1.in' }, { name: '1.out' }],
    structureRevision: 9,
};
const publishedDoc = {
    ...draft,
    title: '正式标题',
    hidden: false,
    managedAuthoring: { ...draft.managedAuthoring, metadataStatus: 'confirmed' },
};

const logs: any[][] = [];
const oplogs: any[] = [];
const publicationCommits: any[] = [];
const observerCalls: any[][] = [];
const cleanupCalls: any[][] = [];
const documentAddCalls: any[][] = [];
let currentDraft: any = draft;
let failPublicationClaimFinalization = false;
let failPersistenceSessionFinalization = false;
let failVerifierCleanup = false;
let failVerifierClaimFinalization = false;
let failFinalAudit = false;
let observerWork: (...args: any[]) => Promise<void> = async () => undefined;
let beforeAddHook: ((...args: any[]) => unknown) | null = null;

const problemPath = require.resolve('../src/model/problem.ts');
const originalLoad = Module._load;
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
                error(...args: any[]) {
                    logs.push(['error', ...args]);
                }

                info(...args: any[]) {
                    logs.push(['info', ...args]);
                }

                warn(...args: any[]) {
                    logs.push(['warn', ...args]);
                }
            },
            size: () => 0,
            streamToBuffer: async () => Buffer.alloc(0),
        };
    }
    if (request === '../context') return { Context: class {} };
    if (request === '../error') {
        return new Proxy(
            {
                ManagedProblemMetadataConflictError: TestMetadataConflictError,
                PermissionError: TestPermissionError,
                ProblemStructureConflictError: TestStructureConflictError,
                ValidationError: TestValidationError,
            },
            { get: (target, key: string) => target[key] || Error },
        );
    }
    if (request === '../lib/problem-config') {
        return {
            isProblemConfigFilename: () => false,
            parseProblemConfigObject: (pdoc: any) => pdoc?.config || null,
        };
    }
    if (request === '../service/bus') {
        return {
            __esModule: true,
            default: {
                emit: () => undefined,
                async parallel(event: string, ...args: any[]) {
                    if (event === 'problem/before-add' && beforeAddHook) await beforeAddHook(...args);
                },
            },
            parallelAllSettled: async (...args: any[]) => {
                observerCalls.push(args);
                await observerWork(...args);
            },
        };
    }
    if (request === '../service/db') return { __esModule: true, default: {} };
    if (request === './builtin') return { PERM: { PERM_EDIT_PROBLEM: 1n }, STATUS: {} };
    if (request === './domain') return { __esModule: true, default: { get: async () => ({ namespaces: {} }) } };
    if (request === './document') {
        const emptyCursor: any = {
            withReadPreference() {
                return this;
            },
            sort() {
                return this;
            },
            limit() {
                return this;
            },
            project() {
                return this;
            },
            async toArray() {
                return [];
            },
        };
        return {
            TYPE_PROBLEM: 1,
            getMulti: () => emptyCursor,
            async add(...args: any[]) {
                documentAddCalls.push(args);
                return 1;
            },
            coll: {
                async findOne() {
                    return currentDraft;
                },
            },
        };
    }
    if (request === './oplog') {
        return {
            async add(entry: any) {
                if (failFinalAudit && entry.type === 'problem.managed.publish' && entry.result !== 'attempt') {
                    throw new Error('final audit failed');
                }
                oplogs.push(entry);
            },
        };
    }
    if (request === './problem-access') {
        return new Proxy(
            {
                isProblemBankAdmin: () => true,
                PROBLEM_ACL_INTERNAL_FIELDS: new Set(),
            },
            { get: (target, key: string) => target[key] || (() => undefined) },
        );
    }
    if (request === './problem-lifecycle') {
        return new Proxy(
            {
                assertStructureRevision: (value: unknown) => {
                    if (!Number.isSafeInteger(value) || Number(value) < 1) throw new TestValidationError('revision');
                },
                assertProgrammingTestcasesConfigured: () => undefined,
            },
            { get: (target, key: string) => target[key] || (() => undefined) },
        );
    }
    if (request === './managed-problem-authoring') {
        return new Proxy(
            {
                prepareManagedProblemDraft: async (input: any) => ({
                    workingTitle: input.workingTitle,
                    content: input.content,
                    difficulty: input.difficulty,
                    sourceMeta: { template: 'self', year: 2026 },
                    selectedMindmapNodeIds: ['node-1'],
                    tags: ['自命题'],
                }),
                reserveManagedProblemPid: async () => 'P3107',
                prepareManagedProblemPublication: async () => ({
                    selectedMindmapNodeIds: ['node-1'],
                    tags: ['自命题', '算法'],
                    sourceMeta: { template: 'self', year: 2026 },
                    pendingTrainingPlacement: undefined,
                }),
            },
            { get: (target, key: string) => target[key] || (() => undefined) },
        );
    }
    if (request === './managed-problem-publication') {
        return {
            ManagedProblemPublicationCommittedError: TestPublicationCommittedError,
            async commitManagedProblemPublication(input: any) {
                publicationCommits.push(input);
                if (failPersistenceSessionFinalization) throw new TestPublicationCommittedError(publishedDoc);
                return publishedDoc;
            },
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

function installClaimSeam() {
    ProblemModel.withAuthorizedWriteClaim = async (
        domainId: string,
        pid: number,
        user: any,
        operation: string,
        work: (claim: any) => Promise<any>,
        options: any = {},
    ) => {
        const claim = {
            domainId,
            pid,
            actor: user._id,
            operation,
            capability: options.capability,
            requestId: options.requestId || 'publish-request',
            state: 'active',
        };
        if (operation === 'managed-publish-verifier-cleanup' && failVerifierCleanup) throw new Error('verifier cleanup failed');
        const result = await work(claim);
        if (operation === 'managed-review-publish' && failPublicationClaimFinalization) {
            throw new Error('publication claim clear failed');
        }
        if (operation === 'managed-publish-verifier-cleanup' && failVerifierClaimFinalization) {
            throw new Error('verifier cleanup claim clear failed');
        }
        return result;
    };
}

function publish(overrides: Record<string, unknown> = {}) {
    return ProblemModel.publishManagedProgrammingProblem({
        domainId: 'system',
        docId: 7,
        formalTitle: '正式标题',
        difficulty: 4,
        expectedStructureRevision: 9,
        actor: 2,
        user: { _id: 2 },
        ...overrides,
    });
}

beforeEach(() => {
    logs.length = 0;
    oplogs.length = 0;
    publicationCommits.length = 0;
    observerCalls.length = 0;
    cleanupCalls.length = 0;
    documentAddCalls.length = 0;
    currentDraft = draft;
    failPublicationClaimFinalization = false;
    failPersistenceSessionFinalization = false;
    failVerifierCleanup = false;
    failVerifierClaimFinalization = false;
    failFinalAudit = false;
    observerWork = async () => undefined;
    beforeAddHook = null;
    (global as any).Hydro.model.permits = {
        listForProblem: async () => [
            { role: 'author', uid: 77 },
            { role: 'verifier', uid: 88 },
        ],
        clearVerifiersForProblem: async (...args: any[]) => {
            cleanupCalls.push(args);
            return 1;
        },
    };
    installClaimSeam();
});

describe('managed programming creation boundary', () => {
    it('rejects every public legacy programming creation primitive before allocation', async () => {
        const attempts = [
            () => ProblemModel.add('system', 'LEGACY1', 'Legacy', '# statement', 2, [], { problemKind: 'programming' }),
            () => ProblemModel.addWithId('system', 8, 'LEGACY2', 'Legacy', '# statement', 2, [], { problemKind: 'programming' }),
            () => ProblemModel.createProblemByKind('programming', 'system', 'LEGACY3', 'Legacy', '# statement', 2),
        ];

        for (const attempt of attempts) {
            let failure: unknown;
            try {
                await attempt();
            } catch (error) {
                failure = error;
            }
            expect(failure).to.be.instanceOf(TestValidationError);
        }
    });

    it('rejects a before-add hook that mutates managed server-derived creation fields', async () => {
        beforeAddHook = (_domainId, _content, _owner, _docId, args) => {
            args.pid = 'FORGED';
            args.tag.push('forged');
            args.sourceMeta.year = 1999;
            args.managedAuthoring.workingTitle = 'forged';
        };

        let failure: unknown;
        try {
            await ProblemModel.createManagedProgrammingDraft(
                'system',
                {
                    workingTitle: '工作标题',
                    content: '# 题面',
                    difficulty: 3,
                    sourceMeta: { template: 'self', year: 2026 },
                    mindmapNodeIds: ['node-1'],
                },
                2,
                { _id: 2, hasPerm: () => false, hasPriv: () => true },
            );
        } catch (error) {
            failure = error;
        }

        expect(failure).to.be.instanceOf(TestValidationError);
        expect(documentAddCalls).to.deep.equal([]);
        expect(logs.some((entry) => entry[0] === 'warn' && String(entry[1]).includes('changed-by-hook'))).to.equal(true);
    });
});

describe('managed programming publication service seam', () => {
    it('binds the reviewed revision and reports success only after verifier cleanup and observers finish', async () => {
        let releaseObserver!: () => void;
        observerWork = () => new Promise<void>((resolve) => (releaseObserver = resolve));
        let settled = false;
        const pending = publish().then((result: any) => {
            settled = true;
            return result;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(settled).to.equal(false);
        expect(publicationCommits[0].expectedStructureRevision).to.equal(9);
        expect(cleanupCalls).to.have.lengthOf(1);
        releaseObserver();

        const result = await pending;
        expect(result).to.deep.include({ state: 'published', requestId: 'publish-request', incompleteStages: [] });
        expect(result.pdoc.hidden).to.equal(false);
        expect(observerCalls[0][0]).to.equal('problem/edit');
        expect(oplogs.some((entry) => entry.result === 'success')).to.equal(true);
    });

    it('returns the committed problem with explicit incomplete stages when the publication claim cannot finalize', async () => {
        failPublicationClaimFinalization = true;

        const result = await publish();

        expect(result.state).to.equal('committed_with_error');
        expect(result.pdoc.hidden).to.equal(false);
        expect(result.incompleteStages).to.deep.equal(['publication-claim-finalization', 'verifier-cleanup']);
        expect(cleanupCalls).to.deep.equal([]);
        expect(oplogs.some((entry) => entry.result === 'incomplete')).to.equal(true);
    });

    it('continues claim and verifier finalization after a committed transaction session cleanup error', async () => {
        failPersistenceSessionFinalization = true;

        const result = await publish();

        expect(result.state).to.equal('committed_with_error');
        expect(result.pdoc.hidden).to.equal(false);
        expect(result.incompleteStages).to.deep.equal(['persistence-session-finalization']);
        expect(cleanupCalls).to.have.lengthOf(1);
        expect(observerCalls).to.have.lengthOf(1);
        expect(oplogs.some((entry) => entry.result === 'incomplete')).to.equal(true);
    });

    it('never reports full success when verifier cleanup or its claim finalization fails', async () => {
        failVerifierCleanup = true;
        const cleanupFailure = await publish();
        expect(cleanupFailure.state).to.equal('committed_with_error');
        expect(cleanupFailure.incompleteStages).to.deep.equal(['verifier-cleanup']);

        failVerifierCleanup = false;
        failVerifierClaimFinalization = true;
        const claimFailure = await publish();
        expect(claimFailure.state).to.equal('committed_with_error');
        expect(claimFailure.incompleteStages).to.deep.equal(['verifier-cleanup']);
    });

    it('returns the actual committed state when observers or the final audit fail', async () => {
        observerWork = async () => {
            throw new Error('observer failed');
        };
        const observerFailure = await publish();
        expect(observerFailure.state).to.equal('committed_with_error');
        expect(observerFailure.incompleteStages).to.deep.equal(['edit-observers']);

        observerWork = async () => undefined;
        failFinalAudit = true;
        const auditFailure = await publish();
        expect(auditFailure.state).to.equal('committed_with_error');
        expect(auditFailure.incompleteStages).to.deep.equal(['success-audit']);
    });

    it('rejects a stale reviewed revision before publication commit', async () => {
        currentDraft = { ...draft, structureRevision: 10 };
        let failure: unknown;
        try {
            await publish();
        } catch (error) {
            failure = error;
        }

        expect(failure).to.be.instanceOf(TestStructureConflictError);
        expect(publicationCommits).to.deep.equal([]);
        expect(cleanupCalls).to.deep.equal([]);
    });
});
