import { expect } from 'chai';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    knowledgeMapId: '507f1f77bcf86cd799439010',
    knowledgeNodeIds: ['node-1'],
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
const bootstrapAuthorCalls: any[][] = [];
let currentDraft: any = draft;
let failPublicationClaimFinalization = false;
let failPersistenceSessionFinalization = false;
let failVerifierCleanup = false;
let failVerifierClaimFinalization = false;
let failFinalAudit = false;
let observerWork: (...args: any[]) => Promise<void> = async () => undefined;
let beforeAddHook: ((...args: any[]) => unknown) | null = null;
let pendingContributionRows: any[] = [];
let importedAuthorResult: any = null;

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
    if (request === './builtin') {
        return {
            PERM: {
                PERM_EDIT_PROBLEM: 1n,
                PERM_CREATE_PROBLEM: 2n,
                PERM_CREATE_PROGRAMMING_DRAFT: 4n,
            },
            STATUS: {},
        };
    }
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
                async findOne(filter: any, options?: any) {
                    if (filter?.['aclWriteClaim.operation'] === 'managed-review-publish' && options?.projection) {
                        return Object.fromEntries(
                            Object.entries(options.projection)
                                .filter(([, included]) => included)
                                .flatMap(([field]) => (Object.hasOwn(currentDraft, field) ? [[field, currentDraft[field]]] : [])),
                        );
                    }
                    return currentDraft;
                },
                async findOneAndUpdate(_filter: any, update: any) {
                    currentDraft = { ...currentDraft, ...(update.$set || {}) };
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
                isProblemBankAdmin: (user: any) => (typeof user.hasPriv === 'function' ? user.hasPriv() === true : true),
                canCreateAllProblemKinds: (user: any) =>
                    (typeof user.hasPriv === 'function' ? user.hasPriv() === true : true) || user.hasPerm?.(2n) === true,
                canCreateManagedProgrammingDraft: (user: any) =>
                    (typeof user.hasPriv === 'function' ? user.hasPriv() === true : true) ||
                    user.hasPerm?.(2n) === true ||
                    user.hasPerm?.(4n) === true,
                canImportProblems: (user: any) =>
                    (typeof user.hasPriv === 'function' ? user.hasPriv() === true : true) || user.hasPerm?.(2n) === true,
                canAssignManagedAuthor: (user: any) => (typeof user.hasPriv === 'function' ? user.hasPriv() === true : true),
                PROBLEM_ACL_INTERNAL_FIELDS: new Set(),
            },
            { get: (target, key: string) => target[key] || (() => undefined) },
        );
    }
    if (request === './user') {
        return {
            __esModule: true,
            default: {
                getById: async () => importedAuthorResult,
            },
        };
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
                    knowledgeMapId: '507f1f77bcf86cd799439010',
                    selectedMindmapNodeIds: input.mindmapNodeIds,
                    tags: ['自命题'],
                }),
                materializeKnowledgeMindmapTags: async (input: unknown, options: any) => ({
                    mapId: options.knowledgeMapId || '507f1f77bcf86cd799439010',
                    nodeIds: Array.isArray(input) ? input : [],
                    tags: [],
                }),
                reserveManagedProblemPid: async () => 'P3107',
                prepareManagedProblemPublication: async (_domainId: string, pdoc: any) => {
                    if (pdoc.knowledgeMapId !== draft.knowledgeMapId) throw new TestMetadataConflictError('knowledge map missing');
                    return {
                        knowledgeMapId: pdoc.knowledgeMapId,
                        selectedMindmapNodeIds: ['node-1'],
                        tags: ['自命题', '算法'],
                        sourceMeta: { template: 'self', year: 2026 },
                        pendingTrainingPlacement: undefined,
                    };
                },
                validateManagedTrainingPlacement: async (_domainId: string, _template: string, placement: any) => placement,
            },
            { get: (target, key: string) => target[key] || (() => undefined) },
        );
    }
    if (request === './managed-problem-publication') {
        return {
            ManagedProblemPublicationCommittedError: TestPublicationCommittedError,
            async commitManagedProblemPublication(input: any) {
                publicationCommits.push(input);
                const committed = { ...publishedDoc, hidden: input.finalHidden === true };
                if (failPersistenceSessionFinalization) throw new TestPublicationCommittedError(committed);
                return committed;
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
    bootstrapAuthorCalls.length = 0;
    currentDraft = draft;
    failPublicationClaimFinalization = false;
    failPersistenceSessionFinalization = false;
    failVerifierCleanup = false;
    failVerifierClaimFinalization = false;
    failFinalAudit = false;
    observerWork = async () => undefined;
    beforeAddHook = null;
    pendingContributionRows = [];
    importedAuthorResult = null;
    (global as any).Hydro.model.permits = {
        bootstrapManagedDraftAuthor: async (...args: any[]) => {
            bootstrapAuthorCalls.push(args);
        },
        listForProblem: async () => [
            { role: 'author', uid: 77 },
            { role: 'verifier', uid: 88 },
        ],
        clearVerifiersForProblem: async (...args: any[]) => {
            cleanupCalls.push(args);
            return 1;
        },
        listPendingContributionsForProblems: async () => pendingContributionRows,
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

    it('creates a real managed self draft for the original broad create permission', async () => {
        const result = await ProblemModel.createManagedProgrammingDraft(
            'system',
            {
                workingTitle: '工作标题',
                content: '# 题面',
                difficulty: 3,
                sourceMeta: { template: 'self', year: 2026 },
                mindmapNodeIds: ['node-1'],
            },
            2,
            { _id: 2, hasPerm: (permission: bigint) => permission === 2n, hasPriv: () => false },
        );

        expect(result.pid).to.equal('P3107');
        expect(documentAddCalls).to.have.lengthOf(1);
        expect(bootstrapAuthorCalls).to.have.lengthOf(1);
        expect(bootstrapAuthorCalls[0].slice(0, 3)).to.deep.equal(['system', result.docId, 2]);
    });

    it('imports a real Hydro fixture through the managed-draft creation boundary', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'krypton-managed-import-'));
        const create = ProblemModel.createManagedProgrammingDraft;
        const resolveMap = ProblemModel.resolveProgrammingKnowledgeMap;
        const withDataClaim = ProblemModel.withAuthorizedDataWriteClaim;
        const addTestdataWithClaim = ProblemModel.addTestdataWithClaim;
        const addAdditionalFileWithClaim = ProblemModel.addAdditionalFileWithClaim;
        const rawAddTestdata = ProblemModel.addTestdata;
        const rawAddAdditionalFile = ProblemModel.addAdditionalFile;
        const createCalls: any[][] = [];
        const dataClaimCalls: any[][] = [];
        const testdataCalls: any[][] = [];
        const additionalFileCalls: any[][] = [];
        const progress: string[] = [];
        try {
            await mkdir(join(directory, 'testdata'));
            await mkdir(join(directory, 'additional_file'));
            await writeFile(
                join(directory, 'problem.yaml'),
                ['pid: OLD100', 'owner: 77', 'title: Imported fixture', 'content: "# Statement"', 'difficulty: 3', ''].join('\n'),
            );
            await writeFile(join(directory, 'testdata', '1.in'), '1\n');
            await writeFile(join(directory, 'testdata', '1.out'), '1\n');
            await writeFile(join(directory, 'testdata', 'config.yaml'), 'cases:\n  - input: 1.in\n    output: 1.out\n');
            await writeFile(join(directory, 'additional_file', 'readme.txt'), 'fixture attachment\n');
            ProblemModel.resolveProgrammingKnowledgeMap = async () => ({ mapId: '507f1f77bcf86cd799439010' });
            ProblemModel.createManagedProgrammingDraft = async (...args: any[]) => {
                createCalls.push(args);
                return { docId: 101, pid: 'P5001' };
            };
            ProblemModel.withAuthorizedDataWriteClaim = async (...args: any[]) => {
                dataClaimCalls.push(args);
                return args[4]({
                    domainId: args[0],
                    pid: args[1],
                    actor: args[2]._id,
                    operation: args[3],
                    capability: 'data',
                    state: 'active',
                    requestId: args[5].requestId,
                });
            };
            ProblemModel.addTestdataWithClaim = async (...args: any[]) => testdataCalls.push(args);
            ProblemModel.addAdditionalFileWithClaim = async (...args: any[]) => additionalFileCalls.push(args);
            ProblemModel.addTestdata = async () => {
                throw new Error('legacy testdata writer used');
            };
            ProblemModel.addAdditionalFile = async () => {
                throw new Error('legacy additional-file writer used');
            };
            const actorUser = { _id: 42, hasPerm: (permission: bigint) => permission === 2n, hasPriv: () => false };

            const result = await ProblemModel.import('system', directory, {
                actorUser,
                knowledgeMapId: '507f1f77bcf86cd799439010',
                progress: (message: string) => progress.push(message),
            });

            expect(result).to.deep.equal({ imported: 1 });
            expect(createCalls).to.have.lengthOf(1);
            expect(createCalls[0][0]).to.equal('system');
            expect(createCalls[0][1]).to.deep.equal({
                workingTitle: 'Imported fixture',
                content: '# Statement',
                difficulty: 3,
                sourceMeta: { template: 'self', year: new Date().getFullYear() },
                knowledgeMapId: '507f1f77bcf86cd799439010',
                mindmapNodeIds: [],
            });
            expect(createCalls[0][2]).to.equal(42);
            expect(createCalls[0][3]).to.equal(actorUser);
            expect(dataClaimCalls).to.have.lengthOf(1);
            expect(dataClaimCalls[0].slice(0, 4)).to.deep.equal(['system', 101, actorUser, 'files-upload']);
            expect(testdataCalls.map((call) => call[1])).to.deep.equal(['1.in', '1.out', 'config.yaml']);
            expect(additionalFileCalls.map((call) => call[1])).to.deep.equal(['readme.txt']);
            expect(progress).to.deep.equal(['Imported problem OLD100 as P5001 (Imported fixture)']);
        } finally {
            ProblemModel.createManagedProgrammingDraft = create;
            ProblemModel.resolveProgrammingKnowledgeMap = resolveMap;
            ProblemModel.withAuthorizedDataWriteClaim = withDataClaim;
            ProblemModel.addTestdataWithClaim = addTestdataWithClaim;
            ProblemModel.addAdditionalFileWithClaim = addAdditionalFileWithClaim;
            ProblemModel.addTestdata = rawAddTestdata;
            ProblemModel.addAdditionalFile = rawAddAdditionalFile;
            await rm(directory, { recursive: true, force: true });
        }
    });

    it('rejects a nonexistent imported author before creating the managed draft', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'krypton-managed-import-owner-'));
        const create = ProblemModel.createManagedProgrammingDraft;
        const resolveMap = ProblemModel.resolveProgrammingKnowledgeMap;
        let createCalls = 0;
        try {
            await writeFile(join(directory, 'problem.yaml'), ['owner: 999', 'title: Missing owner', 'content: "# Statement"', ''].join('\n'));
            ProblemModel.resolveProgrammingKnowledgeMap = async () => ({ mapId: '507f1f77bcf86cd799439010' });
            ProblemModel.createManagedProgrammingDraft = async () => {
                createCalls++;
                return { docId: 101, pid: 'P5001' };
            };

            let failure: any;
            try {
                await ProblemModel.import('system', directory, {
                    actorUser: { _id: 2, hasPerm: () => false, hasPriv: () => true },
                    keepOriginalAuthor: true,
                    knowledgeMapId: '507f1f77bcf86cd799439010',
                });
            } catch (error) {
                failure = error;
            }

            expect(failure.message).to.equal('Failed to import problem .');
            expect(failure.cause).to.be.instanceOf(TestValidationError);
            expect(createCalls).to.equal(0);
        } finally {
            ProblemModel.createManagedProgrammingDraft = create;
            ProblemModel.resolveProgrammingKnowledgeMap = resolveMap;
            await rm(directory, { recursive: true, force: true });
        }
    });

    it('fails the complete import when any fixture cannot create a managed draft', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'krypton-managed-import-failure-'));
        const create = ProblemModel.createManagedProgrammingDraft;
        const resolveMap = ProblemModel.resolveProgrammingKnowledgeMap;
        const cause = new Error('managed draft rejected');
        const progress: string[] = [];
        try {
            await writeFile(join(directory, 'problem.yaml'), ['title: Broken fixture', 'content: "# Statement"', ''].join('\n'));
            ProblemModel.resolveProgrammingKnowledgeMap = async () => ({ mapId: '507f1f77bcf86cd799439010' });
            ProblemModel.createManagedProgrammingDraft = async () => {
                throw cause;
            };

            let failure: any;
            try {
                await ProblemModel.import('system', directory, {
                    actorUser: { _id: 42, hasPerm: (permission: bigint) => permission === 2n, hasPriv: () => false },
                    knowledgeMapId: '507f1f77bcf86cd799439010',
                    progress: (message: string) => progress.push(message),
                });
            } catch (error) {
                failure = error;
            }

            expect(failure).to.be.instanceOf(Error);
            expect(failure.message).to.equal('Failed to import problem .');
            expect(failure.cause).to.equal(cause);
            expect(progress).to.deep.equal(['Error importing problem .: managed draft rejected']);
        } finally {
            ProblemModel.createManagedProgrammingDraft = create;
            ProblemModel.resolveProgrammingKnowledgeMap = resolveMap;
            await rm(directory, { recursive: true, force: true });
        }
    });
});

describe('managed programming publication service seam', () => {
    it('requires a fresh explicit confirmation when data or tag tasks are pending', async () => {
        pendingContributionRows = [
            {
                domainId: 'system',
                pid: 7,
                uid: 42,
                scope: 'data',
                active: true,
                status: 'pending',
                lastRequestId: 'assign-data',
            },
        ];

        const missingConfirmation = await (async () => {
            try {
                await publish();
                return null;
            } catch (error) {
                return error;
            }
        })();
        expect(missingConfirmation).to.be.instanceOf(TestMetadataConflictError);
        expect(publicationCommits).to.deep.equal([]);

        const fingerprint = ProblemModel.pendingProblemContributionFingerprint(pendingContributionRows);
        const result = await publish({ pendingContributionsConfirmed: true, pendingContributionFingerprint: fingerprint });
        expect(result.state).to.equal('published');
    });

    it('rejects a stale pending-task confirmation fingerprint', async () => {
        pendingContributionRows = [
            {
                domainId: 'system',
                pid: 7,
                uid: 42,
                scope: 'tag',
                active: true,
                status: 'pending',
                lastRequestId: 'new-assignment',
            },
        ];

        const failure = await (async () => {
            try {
                await publish({ pendingContributionsConfirmed: true, pendingContributionFingerprint: 'stale' });
                return null;
            } catch (error) {
                return error;
            }
        })();

        expect(failure).to.be.instanceOf(TestMetadataConflictError);
        expect(publicationCommits).to.deep.equal([]);
    });

    it('binds a batch draft to one exact training chapter under the publish claim', async () => {
        currentDraft = {
            ...draft,
            batchImport: { identity: 'fixture:A' },
            managedAuthoring: { ...draft.managedAuthoring },
        };
        const trainingId = new (require('mongodb').ObjectId)('68486d8165edbb11e9ec9036');
        const result = await ProblemModel.setManagedProgrammingDraftTrainingPlacement({
            domainId: 'system',
            docId: 7,
            trainingId,
            chapterId: 40,
            expectedStructureRevision: 9,
            expectedBatchImportIdentity: 'fixture:A',
            actor: 2,
            user: { _id: 2 },
        });

        expect(result.managedAuthoring.pendingTrainingPlacement).to.deep.equal({ trainingId, chapterId: 40 });
        expect(oplogs).to.deep.include({
            type: 'problem.managed.batch-placement',
            domainId: 'system',
            operator: 2,
            problemId: 7,
            batchImportIdentity: 'fixture:A',
            trainingId,
            chapterId: 40,
            revision: 9,
            result: 'success',
            time: oplogs[0].time,
        });
    });

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
        expect(publicationCommits[0].knowledgeMapId).to.equal(draft.knowledgeMapId);
        expect(cleanupCalls).to.have.lengthOf(1);
        releaseObserver();

        const result = await pending;
        expect(result).to.deep.include({ state: 'published', requestId: 'publish-request', incompleteStages: [] });
        expect(result.pdoc.hidden).to.equal(false);
        expect(observerCalls[0][0]).to.equal('problem/edit');
        expect(oplogs.some((entry) => entry.result === 'success')).to.equal(true);
    });

    it('forwards an explicit hidden final state to the canonical persistence service', async () => {
        const result = await publish({ finalHidden: true });

        expect(publicationCommits[0].finalHidden).to.equal(true);
        expect(result.pdoc.hidden).to.equal(true);
        expect(result.pdoc.managedAuthoring.metadataStatus).to.equal('confirmed');
        expect(oplogs.filter((entry) => entry.type === 'problem.managed.publish').map((entry) => entry.finalHidden)).to.deep.equal([true, true]);
        expect(logs.some((entry) => entry[0] === 'info' && String(entry[1]).includes('finalHidden=%s') && entry.includes(true))).to.equal(true);
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
