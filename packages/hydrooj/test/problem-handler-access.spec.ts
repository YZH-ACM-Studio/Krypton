import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {} };
(global as any).Hydro.module ||= {};

const PERM = {
    PERM_CREATE_PROBLEM: 1n,
    PERM_VIEW_PROBLEM: 2n,
    PERM_VIEW_PROBLEM_HIDDEN: 4n,
    PERM_EDIT_PROBLEM_SELF: 8n,
    PERM_EDIT_PROBLEM: 16n,
    PERM_READ_PROBLEM_DATA: 32n,
    PERM_CREATE_PROGRAMMING_DRAFT: 64n,
};
const PRIV = {
    PRIV_EDIT_SYSTEM: 1,
    PRIV_USER_PROFILE: 2,
    PRIV_READ_PROBLEM_DATA: 4,
};

class TestPermissionError extends Error {
    name = 'PermissionError';
    params: unknown[];

    constructor(...params: unknown[]) {
        super('permission denied');
        this.params = params;
    }
}

class GenericError extends Error {}

const errors = new Proxy(
    { PermissionError: TestPermissionError },
    {
        get(target, key: string) {
            return target[key] || GenericError;
        },
    },
);

const calls = {
    add: [] as any[],
    archive: [] as any[],
    count: [] as any[],
    claims: [] as any[],
    copy: [] as any[],
    edit: [] as any[],
    get: [] as any[],
    getCapabilityAuthorized: [] as any[],
    getEditableAuthorized: [] as any[],
    getMaintainableAuthorized: [] as any[],
    getViewableAuthorized: [] as any[],
    getMulti: [] as any[],
    inc: [] as any[],
    knowledgeMaterializations: [] as any[],
    maintain: [] as any[],
    manualStatus: [] as any[],
    oplog: [] as any[],
    provider: [] as any[],
    permits: [] as any[],
    publish: [] as any[],
    random: [] as any[],
    refresh: [] as any[],
    recordAdd: [] as any[],
    renameFile: [] as any[],
    status: [] as any[],
    structuredMetadataSaves: [] as any[],
    structuredSaves: [] as any[],
    tagNormalizations: [] as any[],
    tagUnlocks: [] as any[],
    contestUpdates: [] as any[],
    storageGet: [] as any[],
    storageGetMeta: [] as any[],
    storageSign: [] as any[],
};
let getMultiResults: any[][] = [];
let getResults: any[] = [];
let maintainableResults: any[] = [];
let countResult = 0;
let maintainResult = false;
let claimAllowed = true;
let permitResults: any[] = [];
let completedDataContributorUids: number[] = [];
let missingUserIds = new Set<number>();
let managedTrainingPlacementResults: any[] = [];
let managedPublishResult: any = null;
let managedPublicationPreviewError: Error | null = null;
let activeDataWriteContainers: any[] = [];
let pendingContributionRows: any[] = [];
const createKinds: string[] = [];

function cursor(docs: any[] = []) {
    const state: { skip: number; limit: number; sort: Record<string, 1 | -1> | null } = {
        skip: 0,
        limit: Infinity,
        sort: null,
    };
    const value: any = {
        hint() {
            return value;
        },
        limit(limit: number) {
            state.limit = limit;
            return value;
        },
        project() {
            return value;
        },
        skip(skip: number) {
            state.skip = skip;
            return value;
        },
        sort(sort: Record<string, 1 | -1>) {
            state.sort = sort;
            return value;
        },
        async count() {
            return countResult;
        },
        async toArray() {
            const sorted = state.sort
                ? [...docs].sort((left, right) => {
                      for (const [key, direction] of Object.entries(state.sort)) {
                          if (left[key] < right[key]) return -direction;
                          if (left[key] > right[key]) return direction;
                      }
                      return 0;
                  })
                : docs;
            return sorted.slice(state.skip, state.skip + state.limit);
        },
    };
    return value;
}

const problemStub = {
    PROJECTION_PUBLIC: ['domainId', 'docId', 'pid'],
    PROJECTION_MANAGED_BANK: ['domainId', 'docId', 'pid', 'sourceMeta', 'managedAuthoring'],
    PROJECTION_MANAGED_EDITOR: ['domainId', 'docId', 'pid', 'sourceMeta', 'managedAuthoring'],
    assertProblemAclDomain(user: any, domainId: string) {
        if (user._problemAclDomainId !== domainId) throw new TestPermissionError(PERM.PERM_CREATE_PROBLEM);
    },
    assertProblemBankSelection: async () => undefined,
    buildProblemBankScope: (user: any) => user.scope || { docId: { $in: [] } },
    canBrowseProblemBank: (user: any) => user.canBrowse === true,
    canMaintainProblem(user: any, pdoc: any) {
        calls.maintain.push({ user, pdoc });
        return maintainResult;
    },
    canEditProblemContent(user: any, pdoc: any) {
        calls.maintain.push({ user, pdoc, capability: 'content' });
        return user.canEditContent ?? maintainResult;
    },
    canEditProblemData: (user: any) => user.canEditData ?? user.canEditContent ?? maintainResult,
    canEditProblemTags: (user: any) => user.canEditTags ?? user.canEditContent ?? maintainResult,
    canEditProblemMetadata: (user: any) => user.canEditMetadata ?? maintainResult,
    canManageProblemCollaborators: (user: any) => user.canManageCollaborators ?? maintainResult,
    canManageProblemContributions: (user: any) => user.canManageContributions ?? maintainResult,
    pendingProblemContributionFingerprint: () => 'pending-fingerprint',
    canManageProblemMaintainers: (user: any) => user.canManageMaintainers ?? maintainResult,
    canPublishProblem: (user: any) => user.canPublish ?? maintainResult,
    canArchiveProblem: (user: any) => user.canArchive ?? maintainResult,
    canDeleteProblem: (user: any) => user.canDelete ?? maintainResult,
    canCloneProblem: (user: any) => user.canClone ?? maintainResult,
    count: async (domainId: string, query: unknown) => {
        calls.count.push({ domainId, query });
        return countResult;
    },
    async add(...args: any[]) {
        calls.add.push(args);
        return 7;
    },
    async createProblemByKind(_kind: string, ...args: any[]) {
        createKinds.push(_kind);
        calls.add.push(args);
        return 7;
    },
    async createManagedProgrammingDraft(...args: any[]) {
        createKinds.push('managed-programming');
        calls.add.push(args);
        return { docId: 7, pid: 'P3101' };
    },
    async assertProgrammingTagNormalizationUnlocked(...args: any[]) {
        calls.tagUnlocks.push(args);
    },
    async applyProgrammingTagNormalization(input: any) {
        calls.tagNormalizations.push(input);
        return {
            pdoc: { domainId: input.domainId, docId: input.pid, pid: 'P7', structureRevision: 5 },
            preview: {
                sourceTags: ['PAT乙级'],
                selectedNodeIds: input.selectedNodeIds,
            },
        };
    },
    async addAdditionalFile(...args: any[]) {
        calls.renameFile.push(args);
    },
    async addTestdata(...args: any[]) {
        calls.renameFile.push(args);
    },
    async addTestdataWithClaim(claim: any, ...args: any[]) {
        calls.renameFile.push([claim.domainId, claim.pid, ...args]);
    },
    async copy(...args: any[]) {
        calls.copy.push(args);
        return 8;
    },
    async archiveProblem(...args: any[]) {
        calls.archive.push(args);
        return { domainId: args[0], docId: args[1], archivedAt: new Date() };
    },
    async publishManagedProgrammingProblem(input: any) {
        calls.publish.push(input);
        return (
            managedPublishResult || {
                state: 'published',
                pdoc: { domainId: input.domainId, docId: input.docId, pid: `P${input.docId}`, hidden: false },
                requestId: 'publish-test',
                incompleteStages: [],
            }
        );
    },
    async addAdditionalFileWithClaim(claim: any, ...args: any[]) {
        calls.renameFile.push([claim.domainId, claim.pid, ...args]);
    },
    canViewBy: () => true,
    async edit(...args: any[]) {
        calls.edit.push(args);
        return { domainId: args[0], docId: args[1] };
    },
    async editAuthorized(...args: any[]) {
        calls.edit.push(args);
        return { domainId: args[0], docId: args[1] };
    },
    async get(...args: any[]) {
        calls.get.push(args);
        return getResults.shift() || null;
    },
    async getMaintainableAuthorized(...args: any[]) {
        calls.getMaintainableAuthorized.push(args);
        return maintainableResults.shift() || null;
    },
    async getEditableAuthorized(...args: any[]) {
        calls.getEditableAuthorized.push(args);
        return maintainableResults.shift() || null;
    },
    async getCapabilityAuthorized(...args: any[]) {
        calls.getCapabilityAuthorized.push(args);
        return maintainableResults.shift() || null;
    },
    async getViewableAuthorized(...args: any[]) {
        calls.getViewableAuthorized.push(args);
        return getResults.shift() || null;
    },
    async getStatus(...args: any[]) {
        calls.status.push(args);
        return null;
    },
    async withAuthorizedWriteClaim(
        domainId: string,
        pid: number,
        user: any,
        operation: string,
        work: (claim: any) => Promise<any>,
        options: any = {},
    ) {
        calls.claims.push({ domainId, pid, user, operation, options });
        if (!claimAllowed) throw new TestPermissionError(PERM.PERM_EDIT_PROBLEM_SELF);
        return work({ domainId, pid, operation, requestId: 'test-claim' });
    },
    async withAuthorizedStructuralWriteClaim(
        domainId: string,
        pid: number,
        user: any,
        operation: string,
        work: (claim: any) => Promise<any>,
        options: any = {},
    ) {
        return problemStub.withAuthorizedWriteClaim(domainId, pid, user, operation, work, options);
    },
    async withAuthorizedDataWriteClaim(
        domainId: string,
        pid: number,
        user: any,
        operation: string,
        work: (claim: any) => Promise<any>,
        options: any = {},
    ) {
        return problemStub.withAuthorizedWriteClaim(domainId, pid, user, operation, work, { ...options, capability: 'data' });
    },
    async inc(...args: any[]) {
        calls.inc.push(args);
    },
    getListStatus: async () => ({}),
    getMulti(domainId: string, query: unknown, projection?: unknown) {
        calls.getMulti.push({ domainId, query, querySnapshot: structuredClone(query), projection });
        return cursor(getMultiResults.shift() || []);
    },
    isProblemBankAdmin: (user: any) => user.admin === true,
    PROBLEM_DATA_WRITE_CONFIRMATION_TTL_MS: 10 * 60 * 1000,
    activeDataWriteContainerFacts: (items: any[]) =>
        items.map((item) => ({
            id: String(item.docId),
            title: item.title,
            rule: item.rule,
            beginAt: item.beginAt,
            endAt: item.endAt,
        })),
    activeDataWriteContainerFingerprint: (_domainId: string, _pid: number, facts: any[]) => `fingerprint:${facts.map((item) => item.id).join(',')}`,
    listActiveDataWriteContainers: async () => activeDataWriteContainers,
    async random(domainId: string, query: unknown) {
        calls.random.push({ domainId, query });
        return 123;
    },
    async refreshProblemAcl(user: any, domainId: string) {
        calls.refresh.push({ user, domainId });
    },
    async saveStructuredProblem(input: any) {
        calls.structuredSaves.push(input);
        return { domainId: input.domainId, docId: input.pid, structureRevision: input.expectedStructureRevision + 1 };
    },
    async saveStructuredProblemMetadata(input: any) {
        calls.structuredMetadataSaves.push(input);
        return { domainId: input.domainId, docId: input.pid, structureRevision: 5 };
    },
    async updateManualStatusLatest(...args: any[]) {
        calls.manualStatus.push(args);
        return true;
    },
    async renameAdditionalFile(...args: any[]) {
        calls.renameFile.push(args);
    },
    async renameTestdataWithClaim(claim: any, ...args: any[]) {
        calls.renameFile.push([claim.domainId, claim.pid, ...args]);
    },
    async renameAdditionalFileWithClaim(claim: any, ...args: any[]) {
        calls.renameFile.push([claim.domainId, claim.pid, ...args]);
    },
    async delTestdataWithClaim(claim: any, ...args: any[]) {
        calls.renameFile.push([claim.domainId, claim.pid, ...args]);
    },
    async delAdditionalFileWithClaim(claim: any, ...args: any[]) {
        calls.renameFile.push([claim.domainId, claim.pid, ...args]);
    },
};

function noopDecorator() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}

class HandlerStub {}
const serverStub = {
    Handler: HandlerStub,
    param: noopDecorator,
    post: noopDecorator,
    query: noopDecorator,
    route: noopDecorator,
    Query: (_schema: unknown, resolver: unknown) => resolver,
    Types: new Proxy({}, { get: () => () => ({}) }),
};

const systemStub = { get: () => false };
const builtinStub = { PERM, PRIV, STATUS: {} };
const contestHandlerStub = { ContestDetailBaseHandler: class {} };
const emptyModel = {
    async updateStatus(...args: any[]) {
        calls.contestUpdates.push(args);
    },
    canShowSelfRecord() {
        return true;
    },
    isDone() {
        return false;
    },
    isNotStarted() {
        return false;
    },
};
const discussionStub = { count: async () => 0 };
const domainStub = {
    async get() {
        return { _id: 'system' };
    },
    async incUserInDomain() {
        return undefined;
    },
};
const recordStub = {
    STAT_QUERY: {},
    async add(...args: any[]) {
        calls.recordAdd.push(args);
        return 'rid';
    },
};
const settingStub = { langs: { cpp: { disabled: false } }, SETTINGS_BY_KEY: { codeLang: { range: {} } } };
const solutionStub = { count: async () => 0 };
const storageStub = {
    async get(...args: any[]) {
        calls.storageGet.push(args);
        return Buffer.from('secret');
    },
    async getMeta(...args: any[]) {
        calls.storageGetMeta.push(args);
        return { size: 6 };
    },
    async put() {
        return undefined;
    },
    async signDownloadLink(...args: any[]) {
        calls.storageSign.push(args);
        return '/signed-secret';
    },
};
const oplogStub = {
    async log(...args: any[]) {
        calls.oplog.push(args);
        return undefined;
    },
};
const userStub = {
    async getById(_domainId: string, uid: number) {
        return { _id: uid };
    },
    async getList(_domainId: string, ownerIds: number[]) {
        return Object.fromEntries(
            ownerIds.map((ownerId) => [
                ownerId,
                missingUserIds.has(ownerId) ? { _id: 0, uname: 'Unknown User' } : { _id: ownerId, uname: `user-${ownerId}` },
            ]),
        );
    },
    async setById() {
        return undefined;
    },
};

const handlerPath = require.resolve('../src/handler/problem.ts');
const originalLoad = Module._load;
const managedAuthoringStub = {
    MANAGED_SOURCE_TEMPLATES: [
        { id: 'pat_basic', label: 'PAT 乙级', fields: ['year', 'season'] },
        { id: 'self', label: '自命题', fields: ['year'] },
    ],
    listKnowledgeMindmapOptions: async () => [{ id: 'node-1', label: '数据结构 / 线段树', tags: ['线段树'] }],
    listManagedMindmapOptions: async () => [{ id: 'node-1', label: '数据结构 / 线段树', tags: ['线段树'] }],
    listManagedProblemTrainingPlacements: async () => managedTrainingPlacementResults,
    listManagedTrainingOptions: async () => [],
    classifyLegacyProgrammingTags: (tags: string[]) => ({
        sourceTags: tags.filter((tag) => tag === 'PAT乙级'),
        suggestions: tags.includes('二分') ? [{ tag: '二分', nodeId: 'node-1', label: '数据结构 / 线段树' }] : [],
        suggestedNodeIds: tags.includes('二分') ? ['node-1'] : [],
        ambiguousTags: [],
        unknownTags: tags.filter((tag) => !['PAT乙级', '二分'].includes(tag)),
    }),
    materializeKnowledgeMindmapTags: async (nodeIds: string[], options: { required?: boolean } = {}) => {
        calls.knowledgeMaterializations.push([...nodeIds]);
        if (options.required && !nodeIds.length) throw new GenericError('knowledge node required');
        if (nodeIds.includes('stale-node')) throw new GenericError('stale knowledge node');
        return {
            nodeIds: [...nodeIds],
            tags: nodeIds.map((nodeId) => `derived:${nodeId}`),
        };
    },
    prepareManagedProblemPublication: async (_domainId: string, pdoc: any) => {
        if (managedPublicationPreviewError) throw managedPublicationPreviewError;
        return {
            sourceMeta: pdoc.sourceMeta,
            selectedMindmapNodeIds: pdoc.managedAuthoring.selectedMindmapNodeIds,
            tags: ['自命题', 'derived:node-1'],
        };
    },
    previewProgrammingTagNormalization: async (input: any) => ({
        sourceTags: (input.currentTags || []).filter((tag: string) => tag === 'PAT乙级'),
        selectedNodeIds: [...input.selectedNodeIds],
        nextTags: ['PAT乙级', ...input.selectedNodeIds.map((nodeId: string) => `derived:${nodeId}`)],
        retainedTags: ['PAT乙级'],
        addedTags: input.selectedNodeIds.map((nodeId: string) => `derived:${nodeId}`),
        removedTags: (input.currentTags || []).filter((tag: string) => tag !== 'PAT乙级'),
        fingerprint: 'preview-fingerprint',
    }),
};
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (request === '../error') return errors;
    if (request === '../lib/problem-config') {
        return {
            isProblemConfigFilename: (name: string) => name.toLowerCase() === 'config.yaml',
            parseProblemConfigObject: (pdoc: any) => (pdoc?.config && typeof pdoc.config === 'object' ? pdoc.config : null),
            parseStructuredRegionSubmission: (kind: string, template: any, rawCode: string) => {
                const parsed = JSON.parse(rawCode);
                const expected = template.regions.map((region: any) => region.id).sort();
                const actual = Object.keys(parsed).sort();
                if (
                    expected.join('\0') !== actual.join('\0') ||
                    actual.some((id) => typeof parsed[id] !== 'string') ||
                    (kind === 'program_fill' && actual.some((id) => /[\r\n]/.test(parsed[id])))
                ) {
                    throw new Error('invalid regions');
                }
                return parsed;
            },
            validateCompiledStructuredConfig: () => undefined,
        };
    }
    if (request === '../model/builtin') return builtinStub;
    if (request === '../model/problem') return problemStub;
    if (request === '../model/problem-lifecycle') {
        return {
            structuredProblemConfigForEditor: (kind: string, config: any) =>
                kind === 'function' || config?.type === 'program_fill'
                    ? {
                          main: {
                              mode: kind === 'function' ? 'function' : config.mode,
                              lang: config.template.lang,
                              source: config.template.source,
                              regions: config.template.regions,
                              ...(config.mode === 'compile' || kind === 'function' ? { cases: config.cases } : {}),
                          },
                      }
                    : { main: config.main },
            structuredProblemUsesTestdata: (kind: string, config: any) =>
                kind === 'function' || (kind === 'program_fill' && config?.type === 'program_fill' && config?.mode === 'compile'),
        };
    }
    if (request === '../model/system') return systemStub;
    if (request === '../service/server') return serverStub;
    if (request === './contest') return contestHandlerStub;
    if (request === '../model/contest') return emptyModel;
    if (request === '../model/oplog') return oplogStub;
    if (request === '../model/managed-problem-authoring') return managedAuthoringStub;
    if (request === '../model/discussion') return discussionStub;
    if (request === '../model/domain') return domainStub;
    if (request === '../model/manual-grade') {
        return {
            async markManualPending(input: any) {
                calls.manualStatus.push(input);
                calls.contestUpdates.push(input);
            },
        };
    }
    if (request === '../model/record') return recordStub;
    if (request === '../model/setting') return settingStub;
    if (request === '../model/solution') return solutionStub;
    if (request === '../model/storage') return storageStub;
    if (request === '../model/user') return userStub;
    return originalLoad.call(this, request, parent, isMain);
};

let handlerModule: typeof import('../src/handler/problem');
try {
    delete require.cache[handlerPath];
    handlerModule = require(handlerPath);
} finally {
    Module._load = originalLoad;
}

const {
    ProblemApi,
    ProblemCreateHubHandler,
    ProblemCreateProgrammingHandler,
    ProblemCreateFunctionHandler,
    ProblemCreateProgramFillHandler,
    ProblemCreateSingleHandler,
    ProblemCreateSubjectiveHandler,
    ProblemDetailHandler,
    ProblemEditHandler,
    ProblemProgrammingTagApplyHandler,
    ProblemProgrammingTagPreviewHandler,
    ProblemConfigHandler,
    ProblemFileDownloadHandler,
    ProblemFilesHandler,
    ProblemHackHandler,
    ProblemMainHandler,
    ProblemManageHandler,
    ProblemMineHandler,
    ProblemRandomHandler,
    ProblemSubmitHandler,
} = handlerModule as any;

function makeHandler(HandlerClass: any, user: Record<string, unknown>) {
    const instance = new HandlerClass();
    Object.assign(instance, {
        user: {
            _files: [],
            _id: 42,
            _problemAclDomainId: 'system',
            hasPerm: () => false,
            hasPriv: () => false,
            own: () => false,
            ...user,
        },
        response: { body: {} },
        request: { json: false },
        session: {},
        domain: { _id: 'system', namespaces: {} },
        UiContext: {},
        args: {},
        ctx: {
            i18n: { langs: () => [] },
            setting: { get: () => 20 },
            parallel: async () => undefined,
        },
        url: (name: string) => (name === 'training_main' ? '/training' : `/${name}`),
        paginate: async (source: any, page: number, limit: number) => [
            await source
                .skip((page - 1) * limit)
                .limit(limit)
                .toArray(),
            Math.ceil(countResult / limit),
            countResult,
        ],
        back: () => undefined,
        progress: () => undefined,
        limitRate: async () => undefined,
        checkPerm: (permission: bigint) => {
            throw new TestPermissionError(permission);
        },
    });
    return instance as any;
}

async function captureFailure(run: () => Promise<unknown>) {
    try {
        await run();
        return null;
    } catch (error) {
        return error as any;
    }
}

beforeEach(() => {
    for (const values of Object.values(calls)) values.length = 0;
    getMultiResults = [];
    getResults = [];
    maintainableResults = [];
    countResult = 0;
    maintainResult = false;
    claimAllowed = true;
    permitResults = [];
    completedDataContributorUids = [];
    missingUserIds = new Set();
    managedTrainingPlacementResults = [];
    managedPublishResult = null;
    managedPublicationPreviewError = null;
    activeDataWriteContainers = [];
    pendingContributionRows = [];
    createKinds.length = 0;
    (global as any).Hydro.module.problemSearch = {};
    (global as any).Hydro.model.permits = {
        listForProblem: async (...args: any[]) => {
            calls.permits.push(args);
            return permitResults;
        },
        listCompletedDataContributorUids: async () => completedDataContributorUids,
        listPendingContributionsForProblems: async () => pendingContributionRows,
    };
});

describe('P2.11 enumeration entry gates', () => {
    it('redirects the page before any query when the user cannot browse', async () => {
        const handler = makeHandler(ProblemMainHandler, { canBrowse: false });
        await handler.get('system', 1, '', 20, false, false);
        expect(handler.response.redirect).to.equal('/training');
        expect(calls.getMulti).to.deep.equal([]);
        expect(calls.count).to.deep.equal([]);
    });

    it('returns 403 for quick mode before rendering counts or tags', async () => {
        const handler = makeHandler(ProblemMainHandler, { canBrowse: false });
        const error = await captureFailure(() => handler.get('system', 1, '', 20, false, true));
        expect(error).to.be.instanceOf(TestPermissionError);
        expect(error.params).to.deep.equal([PERM.PERM_CREATE_PROBLEM]);
        expect(calls.getMulti).to.deep.equal([]);
    });

    it('redirects random and mine before either endpoint can enumerate', async () => {
        const random = makeHandler(ProblemRandomHandler, { canBrowse: false });
        const mine = makeHandler(ProblemMineHandler, { canBrowse: false });
        await random.get('system', '');
        await mine.get('system', 1);
        expect(random.response.redirect).to.equal('/training');
        expect(mine.response.redirect).to.equal('/training');
        expect(calls.random).to.deep.equal([]);
        expect(calls.getMulti).to.deep.equal([]);
    });

    it('passes the same canonical scope to main find and mine find/count', async () => {
        const scope = { $or: [{ owner: 42 }, { docId: { $in: [7] } }] };
        const user = {
            canBrowse: true,
            scope,
            hasPriv: () => false,
            hasPerm: () => false,
            _id: 42,
        };
        getMultiResults = [[], [], []];
        const main = makeHandler(ProblemMainHandler, user);
        await main.get('system', 1, '', 20, false, false);
        const mine = makeHandler(ProblemMineHandler, user);
        await mine.get('system', 1);
        expect(calls.getMulti[0].query.$and).to.deep.equal([scope, { archivedAt: { $exists: false } }]);
        expect(calls.getMulti[1].query).to.deep.equal(scope);
        expect(calls.getMulti[2].query).to.deep.equal(scope);
        expect(calls.refresh.map(({ domainId }) => domainId)).to.deep.equal(['system', 'system']);
    });

    it('shows the create entry only when the unified managed-create route will accept the user', async () => {
        for (const [user, expected] of [
            [
                {
                    canBrowse: true,
                    scope: {},
                    hasPerm: (permission: bigint) => permission === PERM.PERM_CREATE_PROBLEM,
                },
                false,
            ],
            [
                {
                    canBrowse: true,
                    scope: {},
                    hasPerm: (permission: bigint) => permission === PERM.PERM_CREATE_PROGRAMMING_DRAFT,
                },
                true,
            ],
            [{ canBrowse: true, scope: {}, admin: true, hasPerm: () => false }, true],
        ] as const) {
            getMultiResults = [[], []];
            const handler = makeHandler(ProblemMineHandler, user);
            await handler.get('system', 1);
            expect(handler.response.body.canCreate).to.equal(expected);
            expect(handler.response.body).not.to.have.property('canCreateProgrammingDraft');
        }
    });

    it('combines every unified-bank filter before find and count', async () => {
        const scope = { docId: { $nin: [99] } };
        const handler = makeHandler(ProblemMainHandler, {
            canBrowse: true,
            admin: true,
            scope,
            hasPriv: () => false,
        });
        getMultiResults = [[]];
        await handler.get('system', 1, '', 20, false, false, 'title', 'multi', 'arrays', 7, 'hidden', 'archived');
        expect(calls.getMulti[0].query).to.deep.equal({
            $and: [scope, { problemKind: 'multi' }, { tag: 'arrays' }, { owner: 7 }, { hidden: true }, { archivedAt: { $exists: true } }],
        });
    });

    it('treats missing kind as programming and rejects owner filtering for teachers', async () => {
        const admin = makeHandler(ProblemMainHandler, {
            canBrowse: true,
            admin: true,
            scope: {},
            hasPriv: () => false,
        });
        getMultiResults = [[]];
        await admin.get('system', 1, '', 20, false, false, 'default', 'programming', '', 0, 'all', 'all');
        expect(calls.getMulti[0].query.$and[1]).to.deep.equal({
            $or: [{ problemKind: 'programming' }, { problemKind: { $exists: false } }],
        });

        calls.getMulti.length = 0;
        const teacher = makeHandler(ProblemMainHandler, {
            canBrowse: true,
            admin: false,
            scope: { owner: 42 },
            hasPriv: () => false,
        });
        const error = await captureFailure(() => teacher.get('system', 1, '', 20, false, false, 'default', '', '', 7, 'all', 'active'));
        expect(error).to.be.instanceOf(TestPermissionError);
        expect(calls.getMulti).to.deep.equal([]);
    });

    it('gates row clone and archive through canonical maintenance', async () => {
        maintainResult = true;
        const clone = makeHandler(ProblemMainHandler, { canBrowse: true });
        getResults = [{ domainId: 'system', docId: 7, owner: 42 }];
        await clone.postClone('forged', 7);
        expect(calls.copy).to.have.lengthOf(1);
        expect(calls.copy[0].slice(0, 6)).to.deep.equal(['system', 7, 'system', undefined, true, undefined]);
        expect(calls.copy[0][6]).to.deep.include({ owner: 42, actor: 42 });
        expect(calls.copy[0][6].claim).to.deep.include({ domainId: 'system', pid: 7, operation: 'clone-revision' });
        expect(calls.claims[0]).to.deep.include({
            domainId: 'system',
            pid: 7,
            operation: 'clone-revision',
        });

        const archive = makeHandler(ProblemMainHandler, { canBrowse: true });
        getResults = [{ domainId: 'system', docId: 7, owner: 42 }];
        await archive.postArchive('forged', 7, 'retired');
        expect(calls.archive[0].slice(0, 4)).to.deep.equal(['system', 7, 42, 'retired']);
    });

    it('shows the managed metadata review scope only to administrators', async () => {
        pendingContributionRows = [
            {
                domainId: 'system',
                pid: 7,
                uid: 88,
                scope: 'data',
                active: true,
                status: 'pending',
                lastRequestId: 'assign-88',
            },
        ];
        getMultiResults = [
            [{ domainId: 'system', docId: 7, owner: 42, authoringMode: 'managed', hidden: true, managedAuthoring: { metadataStatus: 'draft' } }],
        ];
        countResult = 1;
        const admin = makeHandler(ProblemMainHandler, { canBrowse: true, admin: true, hasPriv: () => false });
        await admin.get('system', 1, '', 20, false, false, 'default', '', '', 0, 'all', 'active', 'pending');
        expect(calls.getMulti[0].querySnapshot.$and).to.deep.include({
            authoringMode: 'managed',
            hidden: true,
            'managedAuthoring.metadataStatus': 'draft',
        });
        expect(admin.response.body.canReviewManaged).to.equal(true);
        expect(admin.response.body.managedReviewableByDocId[7]).to.equal(true);
        expect(admin.response.body.pendingContributionsByDocId[7]).to.deep.equal([{ uid: 88, scope: 'data' }]);
        expect(admin.response.body.pendingContributionFingerprintByDocId[7]).to.equal('pending-fingerprint');
        expect(admin.response.body.contributionUdict[88].uname).to.equal('user-88');

        calls.getMulti.length = 0;
        const author = makeHandler(ProblemMainHandler, { canBrowse: true, admin: false, hasPriv: () => false });
        const error = await captureFailure(() => author.get('system', 1, '', 20, false, false, 'default', '', '', 0, 'all', 'active', 'pending'));
        expect(error).to.be.instanceOf(TestPermissionError);
        expect(calls.getMulti).to.deep.equal([]);
    });

    it('publishes managed drafts only through the administrator review service', async () => {
        const admin = makeHandler(ProblemMainHandler, { canBrowse: true, admin: true });
        await admin.postManagedPublish('forged', 7, '正式标题', 4, 9, true, 'pending-fingerprint');
        expect(calls.publish).to.have.lengthOf(1);
        expect(calls.publish[0]).to.deep.include({
            domainId: 'system',
            docId: 7,
            formalTitle: '正式标题',
            difficulty: 4,
            expectedStructureRevision: 9,
            actor: 42,
            pendingContributionsConfirmed: true,
            pendingContributionFingerprint: 'pending-fingerprint',
        });

        const author = makeHandler(ProblemMainHandler, { canBrowse: true, admin: false });
        const denied = await captureFailure(() => author.postManagedPublish('forged', 7, '正式标题', 4, 9));
        expect(denied).to.be.instanceOf(TestPermissionError);
        expect(calls.publish).to.have.lengthOf(1);

        getResults = [{ domainId: 'system', docId: 7, authoringMode: 'managed', hidden: true }];
        const bypass = await captureFailure(() => admin.postUnhide('forged', [7]));
        expect(bypass).to.be.instanceOf(GenericError);
        expect(calls.publish).to.have.lengthOf(1);
    });

    it('reports the actual committed state instead of redirecting when publication finalization is incomplete', async () => {
        managedPublishResult = {
            state: 'committed_with_error',
            pdoc: { domainId: 'system', docId: 7, pid: 'P3107', hidden: false },
            requestId: 'publish-partial-test',
            incompleteStages: ['verifier-cleanup', 'edit-observers'],
        };
        const admin = makeHandler(ProblemMainHandler, { canBrowse: true, admin: true });

        await admin.postManagedPublish('forged', 7, '正式标题', 4, 9);

        expect(admin.response.status).to.equal(500);
        expect(admin.response.redirect).to.equal(undefined);
        expect(admin.response.body).to.deep.include({
            publicationState: 'committed_with_error',
            requestId: 'publish-partial-test',
            incompleteStages: ['verifier-cleanup', 'edit-observers'],
        });
        expect(admin.response.body.error.message).to.include('题目已经公开');
        expect(admin.response.body.error.message).to.include('验题人权限清理、发布事件通知');
        expect(admin.response.body.url).to.equal('/problem_detail');
    });

    it('ignores a forged method domainId and queries only the authoritative handler domain', async () => {
        const scope = { owner: 42 };
        const user = {
            canBrowse: true,
            scope,
            hasPriv: () => false,
            hasPerm: () => false,
            _id: 42,
        };
        getMultiResults = [[], [], []];
        await makeHandler(ProblemMainHandler, user).get('forged', 1, '', 20, false, false);
        await makeHandler(ProblemMineHandler, user).get('forged', 1);
        await makeHandler(ProblemRandomHandler, user).get('forged', '');
        expect(calls.getMulti.every((call) => call.domainId === 'system')).to.equal(true);
        expect(calls.random).to.deep.equal([
            {
                domainId: 'system',
                query: { $and: [scope, { archivedAt: { $exists: false } }] },
            },
        ]);
    });
});

describe('P2.11 authoritative problem route domain', () => {
    it('loads a public detail and all dependent data from the handler domain, not an injected argument', async () => {
        const handler = makeHandler(ProblemDetailHandler, {});
        getResults = [
            {
                domainId: 'system',
                docId: 7,
                owner: 42,
                hidden: false,
                title: 'P7',
                content: 'statement',
                config: '',
                additional_file: [],
                tag: [],
            },
        ];
        await handler._prepare('forged', 7);
        expect(calls.getViewableAuthorized[0][0]).to.equal('system');
        expect(calls.get).to.deep.equal([]);
        expect(calls.status[0][0]).to.equal('system');
        expect(handler.response.body.authorUdocs).to.deep.equal([{ _id: 42 }]);
        expect(handler.response.body.canEditProblem).to.equal(false);
    });

    it('computes the managed draft edit entry from internal state without exposing that state', async () => {
        const handler = makeHandler(ProblemDetailHandler, { canEditContent: true });
        getResults = [
            {
                domainId: 'system',
                docId: 7,
                owner: 42,
                hidden: true,
                title: 'Managed draft',
                content: 'statement',
                config: '',
                additional_file: [],
                tag: [],
                authoringMode: 'managed',
                managedAuthoring: { workingTitle: 'Managed draft', metadataStatus: 'draft' },
            },
        ];

        await handler._prepare('forged', 7);

        expect(calls.getViewableAuthorized[0][3]).to.include('managedAuthoring');
        expect(handler.response.body.canEditProblem).to.equal(true);
        expect(handler.response.body.pdoc).not.to.have.property('managedAuthoring');
        expect(handler.pdoc).not.to.have.property('managedAuthoring');
    });

    it('carries the stable managed draft content capability into the files preflight', async () => {
        const handler = makeHandler(ProblemFilesHandler, { canEditContent: true });
        getResults = [
            {
                domainId: 'system',
                docId: 7,
                owner: 42,
                hidden: true,
                title: 'Managed draft',
                content: 'statement',
                config: '',
                data: [],
                additional_file: [],
                tag: [],
                authoringMode: 'managed',
                managedAuthoring: { workingTitle: 'Managed draft', metadataStatus: 'draft' },
            },
        ];
        handler.args = { operation: 'upload_file' };
        handler.request.body = { operation: 'upload_file', filename: '1.in', type: 'testdata' };

        await handler._prepare('forged', 7);
        maintainableResults = [{ ...handler.pdoc }];
        await handler.post();

        expect(handler.response.body.canEditProblem).to.equal(true);
    });

    it('exposes the canonical managed author instead of presenting the storage owner as the author', async () => {
        const handler = makeHandler(ProblemDetailHandler, {});
        permitResults = [{ uid: 77, role: 'author' }];
        getResults = [
            {
                domainId: 'system',
                docId: 7,
                owner: 42,
                hidden: false,
                title: 'Managed problem',
                content: 'statement',
                config: '',
                additional_file: [],
                tag: [],
                authoringMode: 'managed',
            },
        ];

        await handler._prepare('forged', 7);

        expect(handler.response.body.udoc).to.deep.equal({ _id: 42 });
        expect(handler.response.body.authorUdocs).to.deep.equal([{ _id: 77, uname: 'user-77' }]);
    });

    it('preserves the storage owner in contest and exam problem DOM without querying managed permits', async () => {
        const handler = makeHandler(ProblemDetailHandler, {});
        handler.tdoc = { docId: 'contest', owner: 99, pids: [7], rule: 'acm' };
        handler.tsdoc = { attend: true, startAt: new Date() };
        permitResults = [{ uid: 77, role: 'author' }];
        getResults = [
            {
                domainId: 'system',
                docId: 7,
                owner: 42,
                hidden: false,
                title: 'Managed contest problem',
                content: 'statement',
                config: '',
                additional_file: [],
                tag: [],
                authoringMode: 'managed',
            },
        ];

        await handler._prepare('forged', 7, 'contest');

        expect(handler.response.body.authorUdocs).to.deep.equal([{ _id: 42 }]);
        expect(calls.permits).to.deep.equal([]);
    });

    it('does not fall back to owner when a managed author profile is missing', async () => {
        const handler = makeHandler(ProblemDetailHandler, {});
        permitResults = [{ uid: 77, role: 'author' }];
        missingUserIds.add(77);
        getResults = [
            {
                domainId: 'system',
                docId: 7,
                owner: 42,
                hidden: false,
                title: 'Managed problem',
                content: 'statement',
                config: '',
                additional_file: [],
                tag: [],
                authoringMode: 'managed',
            },
        ];

        await handler._prepare('forged', 7);

        expect(handler.response.body.authorUdocs).to.deep.equal([]);
    });

    it('reports an unset managed author without substituting the storage owner', async () => {
        const handler = makeHandler(ProblemDetailHandler, {});
        getResults = [
            {
                domainId: 'system',
                docId: 7,
                owner: 42,
                hidden: false,
                title: 'Managed problem',
                content: 'statement',
                config: '',
                additional_file: [],
                tag: [],
                authoringMode: 'managed',
            },
        ];

        await handler._prepare('forged', 7);

        expect(handler.response.body.authorUdocs).to.deep.equal([]);
    });

    it('publishes only resolved completed data contributors on the problem detail', async () => {
        const handler = makeHandler(ProblemDetailHandler, {});
        completedDataContributorUids = [77, 88];
        missingUserIds.add(88);
        getResults = [
            {
                domainId: 'system',
                docId: 7,
                owner: 42,
                hidden: false,
                title: 'Contributed problem',
                content: 'statement',
                config: '',
                additional_file: [],
                tag: [],
            },
        ];

        await handler._prepare('forged', 7);

        expect(handler.response.body.dataContributorUdocs).to.deep.equal([{ _id: 77, uname: 'user-77' }]);
    });

    it('opens the creation hub only for a bank administrator or trusted managed creator', async () => {
        const trusted = makeHandler(ProblemCreateHubHandler, {
            hasPerm: (permission: bigint) => permission === PERM.PERM_CREATE_PROGRAMMING_DRAFT,
        });
        await trusted.get();
        expect(trusted.response.body.problemKinds).to.deep.equal([{ kind: 'programming', slug: 'programming' }]);

        const admin = makeHandler(ProblemCreateHubHandler, { admin: true });
        await admin.get();
        expect(admin.response.body.problemKinds).to.have.length.greaterThan(1);

        for (const user of [{}, { hasPerm: (permission: bigint) => permission === PERM.PERM_CREATE_PROBLEM }]) {
            const denied = await captureFailure(() => makeHandler(ProblemCreateHubHandler, user).get());
            expect(denied).to.be.instanceOf(TestPermissionError);
        }
    });

    it('creates a problem only in the authoritative handler domain', async () => {
        const handler = makeHandler(ProblemCreateProgrammingHandler, {
            hasPerm: (permission: bigint) => permission === PERM.PERM_CREATE_PROGRAMMING_DRAFT,
        });
        handler.request.body = {
            title: 'Title',
            content: 'Statement',
            managed: 'true',
            template: 'self',
            year: '2026',
            difficulty: '2',
            mindmapNodeIds: 'node-1',
        };
        await handler.post('forged', 'Title', 'Statement', '', false, 2, [], true, 'self', 2026, '', '', 0, ['node-1']);
        expect(calls.add[0][0]).to.equal('system');
        expect(createKinds).to.deep.equal(['managed-programming']);
    });

    it('creates a field-restricted managed draft and assigns the trusted creator path', async () => {
        const handler = makeHandler(ProblemCreateProgrammingHandler, {
            hasPerm: (permission: bigint) => permission === PERM.PERM_CREATE_PROGRAMMING_DRAFT,
        });
        handler.request.body = {
            title: 'Working title',
            content: 'Statement',
            managed: 'true',
            template: 'self',
            year: '2026',
            difficulty: '4',
            mindmapNodeIds: 'node-1',
        };

        await handler.post('forged', 'Working title', 'Statement', '', false, 4, [], true, 'self', 2026, '', '', 0, ['node-1']);

        expect(createKinds).to.deep.equal(['managed-programming']);
        expect(calls.add[0]).to.deep.equal([
            'system',
            {
                workingTitle: 'Working title',
                content: 'Statement',
                difficulty: 4,
                sourceMeta: { template: 'self', year: 2026 },
                mindmapNodeIds: ['node-1'],
                authorUid: 42,
            },
            42,
            handler.user,
        ]);
        expect(handler.response.body).to.include({ docId: 7, authoringMode: 'managed', hidden: true });

        const validBody = { ...handler.request.body };
        for (const [field, value] of [
            ['pid', 'P9999'],
            ['tag', 'forged'],
            ['sourceMeta', '{"template":"self"}'],
            ['hidden', 'false'],
        ]) {
            handler.request.body = { ...validBody, [field]: value };
            const forged = await captureFailure(() =>
                handler.post('forged', 'Working title', 'Statement', 'P9999', false, 4, [], true, 'self', 2026, '', '', 0, ['node-1']),
            );
            expect(forged).to.be.instanceOf(GenericError);
        }

        for (const [body, args] of [
            [{ ...validBody, template: 'pat_basic' }, { template: 'pat_basic' }],
            [{ ...validBody, authorUid: '77' }, { authorUid: 77 }],
            [
                { ...validBody, trainingId: '64b000000000000000000010', chapterId: '1' },
                { trainingId: '64b000000000000000000010', chapterId: 1 },
            ],
        ] as const) {
            handler.request.body = body;
            const forged = await captureFailure(() =>
                handler.post(
                    'forged',
                    'Working title',
                    'Statement',
                    '',
                    false,
                    4,
                    [],
                    true,
                    args.template || 'self',
                    2026,
                    '',
                    '',
                    0,
                    ['node-1'],
                    args.trainingId || '',
                    args.chapterId || '',
                    args.authorUid || 0,
                ),
            );
            expect(forged).to.be.instanceOf(TestPermissionError);
        }
        expect(calls.add).to.have.lengthOf(1);
    });

    it('delegates managed source, mindmap, and training semantics to the observable model boundary', async () => {
        const handler = makeHandler(ProblemCreateProgrammingHandler, {
            hasPerm: (permission: bigint) => permission === PERM.PERM_CREATE_PROGRAMMING_DRAFT,
        });
        const commonBody = {
            title: 'Working title',
            content: 'Statement',
            managed: 'true',
            year: '2026',
            difficulty: '4',
        };
        const trainingId = '64b000000000000000000010';
        const cases = [
            {
                body: { ...commonBody, template: 'unknown', mindmapNodeIds: 'node-1' },
                args: ['unknown', 2026, ['node-1'], '', ''],
            },
            {
                body: { ...commonBody, template: 'self' },
                args: ['self', 2026, [], '', ''],
            },
        ] as const;

        const admin = makeHandler(ProblemCreateProgrammingHandler, { admin: true });
        for (const testCase of cases) {
            calls.add.length = 0;
            admin.request.body = testCase.body;
            await admin.post(
                'forged',
                'Working title',
                'Statement',
                '',
                false,
                4,
                [],
                true,
                testCase.args[0],
                testCase.args[1],
                '',
                '',
                '',
                [...testCase.args[2]],
                testCase.args[3],
                testCase.args[4],
            );

            expect(calls.add).to.have.lengthOf(1);
        }

        handler.request.body = { ...commonBody, template: 'self', mindmapNodeIds: 'node-1', trainingId };
        const deniedTraining = await captureFailure(() =>
            handler.post('forged', 'Working title', 'Statement', '', false, 4, [], true, 'self', 2026, '', '', '', ['node-1'], trainingId, ''),
        );
        expect(deniedTraining).to.be.instanceOf(TestPermissionError);

        const source = readFileSync(resolve(__dirname, '../src/handler/problem.ts'), 'utf8');
        const start = source.indexOf('export class ProblemCreateProgrammingHandler');
        const end = source.indexOf('export const ProblemApi', start);
        const create = source.slice(start, end);
        expect(create).to.include("@post('template', Types.String, true)");
        expect(create).to.include("@post('trainingId', Types.String, true)");
        expect(create).to.include("@post('chapterId', Types.String, true)");
        expect(create).not.to.include('Types.Range(MANAGED_SOURCE_TEMPLATES.map');
    });

    it('lets only a bank administrator pre-create a managed draft for one explicit author', async () => {
        const handler = makeHandler(ProblemCreateProgrammingHandler, {
            admin: true,
            hasPerm: (permission: bigint) => permission === PERM.PERM_CREATE_PROBLEM,
        });
        handler.request.body = {
            title: 'Admin draft',
            content: 'Statement',
            managed: 'true',
            template: 'self',
            year: '2026',
            difficulty: '3',
            mindmapNodeIds: 'node-1',
            authorUid: '77',
        };
        await handler.post('forged', 'Admin draft', 'Statement', '', false, 3, [], true, 'self', 2026, '', '', 0, ['node-1'], undefined, 0, 77);
        expect(calls.add.at(-1)?.[1]).to.deep.include({
            workingTitle: 'Admin draft',
            difficulty: 3,
            authorUid: 77,
        });
        expect(calls.add.at(-1)?.[2]).to.equal(42);
        expect(calls.add.at(-1)?.[3]).to.equal(handler.user);

        const teacher = makeHandler(ProblemCreateProgrammingHandler, {
            hasPerm: (permission: bigint) => permission === PERM.PERM_CREATE_PROBLEM,
        });
        teacher.request.body = { ...handler.request.body };
        const denied = await captureFailure(() =>
            teacher.post('forged', 'Admin draft', 'Statement', '', false, 3, [], true, 'self', 2026, '', '', 0, ['node-1'], undefined, 0, 77),
        );
        expect(denied).to.be.instanceOf(TestPermissionError);
    });

    it('defaults an administrator-created managed draft to the current administrator author', async () => {
        const handler = makeHandler(ProblemCreateProgrammingHandler, {
            admin: true,
            hasPerm: (permission: bigint) => permission === PERM.PERM_CREATE_PROBLEM,
        });
        handler.request.body = {
            title: 'Own admin draft',
            content: 'Statement',
            managed: 'true',
            template: 'self',
            year: '2026',
            difficulty: '3',
            mindmapNodeIds: 'node-1',
        };

        await handler.post('forged', 'Own admin draft', 'Statement', '', false, 3, [], true, 'self', 2026, '', '', 0, ['node-1']);

        expect(calls.add.at(-1)?.[1]).to.deep.include({
            workingTitle: 'Own admin draft',
            authorUid: 42,
        });
        expect(calls.add.at(-1)?.[2]).to.equal(42);
        expect(calls.add.at(-1)?.[3]).to.equal(handler.user);
    });

    it('defaults an omitted managed draft difficulty to level one at the HTTP boundary', async () => {
        const handler = makeHandler(ProblemCreateProgrammingHandler, {
            hasPerm: (permission: bigint) => permission === PERM.PERM_CREATE_PROGRAMMING_DRAFT,
        });
        handler.request.body = {
            title: 'Difficulty default',
            content: 'Statement',
            managed: 'true',
            template: 'self',
            year: '2026',
            mindmapNodeIds: 'node-1',
        };

        await handler.post('forged', 'Difficulty default', 'Statement', '', false, 0, [], true, 'self', 2026, '', '', 0, ['node-1']);

        expect(calls.add.at(-1)?.[1]?.difficulty).to.equal(1);
    });

    it('submits and hacks against the loaded problem domain', async () => {
        const submit = makeHandler(ProblemSubmitHandler, {});
        submit.pdoc = { domainId: 'system', docId: 7, config: { type: 'default' } };
        await submit.post('forged', 'cpp', 'code', false, [], undefined);
        expect(calls.recordAdd[0][0]).to.equal('system');
        expect(calls.inc[0][0]).to.equal('system');

        calls.recordAdd.length = 0;
        const hack = makeHandler(ProblemHackHandler, {});
        hack.pdoc = { domainId: 'system', docId: 7 };
        hack.rdoc = { _id: 'target', lang: 'cpp', code: 'code' };
        await hack.post('forged', '1 2', false, undefined);
        expect(calls.recordAdd[0][0]).to.equal('system');
    });

    it('edits problem metadata and config/files only in the loaded problem domain', async () => {
        const edit = makeHandler(ProblemEditHandler, {});
        edit.pdoc = { domainId: 'system', docId: 7, pid: 'P7' };
        edit.canEditLoadedProblem = true;
        await edit.post('forged', 'P7', 'Title', 'Statement', 'P7', false, [], 0, false);
        expect(calls.edit[0][0]).to.equal('system');
        expect(calls.edit[0][3]).to.equal(edit.user);

        const files = makeHandler(ProblemFilesHandler, {});
        files.pdoc = { domainId: 'system', docId: 7, data: [], additional_file: [] };
        files.request.files = {
            file: { filepath: '/tmp/config.yaml', originalFilename: 'config.yaml', size: 1 },
        };
        await files.postUploadFile('forged', 'config.yaml', 'testdata');
        expect(calls.renameFile[0][0]).to.equal('system');
    });

    it('routes the complete legacy owner file mutation matrix through canonical content claims', async () => {
        const handler = makeHandler(ProblemFilesHandler, {});
        handler.pdoc = { domainId: 'system', docId: 7, owner: 42, data: [], additional_file: [] };
        handler.request.files = {
            file: { filepath: '/tmp/file.txt', originalFilename: 'file.txt', size: 1 },
        };

        await handler.postUploadFile('forged', 'config.yaml', 'testdata');
        await handler.postUploadFile('forged', 'notes.txt', 'additional_file');
        await handler.postRenameFiles('forged', ['config.yaml'], ['config.yml'], 'testdata');
        await handler.postRenameFiles('forged', ['notes.txt'], ['readme.txt'], 'additional_file');
        await handler.postDeleteFiles('forged', ['config.yml'], 'testdata');
        await handler.postDeleteFiles('forged', ['readme.txt'], 'additional_file');

        expect(calls.claims.map(({ operation, options }) => ({ operation, capability: options.capability }))).to.deep.equal([
            { operation: 'files-upload', capability: 'data' },
            { operation: 'files-upload', capability: 'data' },
            { operation: 'files-rename', capability: 'data' },
            { operation: 'files-rename', capability: 'data' },
            { operation: 'files-delete', capability: 'data' },
            { operation: 'files-delete', capability: 'data' },
        ]);
        expect(calls.renameFile).to.have.length(6);
        expect(calls.renameFile.every((args) => args[0] === 'system' && args[1] === 7)).to.equal(true);
    });
});

describe('P2.13 managed programming edit boundary', () => {
    function managedHandler() {
        const handler = makeHandler(ProblemEditHandler, {});
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            pid: 'P7',
            title: 'Formal title',
            content: 'Old statement',
            hidden: true,
            tag: ['system-tag'],
            difficulty: 3,
            lockHidden: true,
            problemKind: 'programming',
            structureRevision: 2,
            authoringMode: 'managed',
            managedAuthoring: { workingTitle: 'Working title', selectedMindmapNodeIds: ['node-1'], metadataStatus: 'draft' },
        };
        handler.canEditLoadedProblem = true;
        handler.user.canEditContent = true;
        return handler;
    }

    it('sends only content fields to the model for a managed author save', async () => {
        const handler = managedHandler();
        handler.request.body = { content: 'New statement', expectedStructureRevision: '2' };

        await handler.post('forged', 'P7', undefined, 'New statement', undefined, false, [], undefined, undefined, 2);

        expect(calls.edit).to.have.lengthOf(1);
        expect(calls.edit[0][2]).to.deep.equal({ content: 'New statement', html: false });
    });

    it('accepts a managed author knowledge-node suggestion only while the problem is a draft', async () => {
        const handler = managedHandler();
        handler.user.canEditContent = true;
        handler.request.body = { content: 'New statement', knowledgeNodeIds: 'node-1', expectedStructureRevision: '2' };

        await handler.post('forged', 'P7', undefined, 'New statement', undefined, false, [], ['node-1'], undefined, undefined, 2);

        expect(calls.knowledgeMaterializations.at(-1)).to.deep.equal(['node-1']);
        expect(calls.edit[0][2]).to.deep.equal({
            content: 'New statement',
            html: false,
            managedAuthoring: {
                workingTitle: 'Working title',
                selectedMindmapNodeIds: ['node-1'],
                metadataStatus: 'draft',
            },
        });

        calls.edit.length = 0;
        handler.request.body = { content: 'New statement', knowledgeNodeIds: '', expectedStructureRevision: '2' };
        const empty = await captureFailure(() =>
            handler.post('forged', 'P7', undefined, 'New statement', undefined, false, [], [], undefined, undefined, 2),
        );
        expect(empty).to.be.instanceOf(GenericError);
        expect(calls.knowledgeMaterializations.at(-1)).to.deep.equal([]);
        expect(calls.edit).to.deep.equal([]);

        calls.edit.length = 0;
        handler.pdoc.managedAuthoring.metadataStatus = 'confirmed';
        const denied = await captureFailure(() =>
            handler.post('forged', 'P7', undefined, 'New statement', undefined, false, [], ['node-1'], undefined, undefined, 2),
        );
        expect(denied).to.be.instanceOf(GenericError);
        expect(calls.edit).to.deep.equal([]);
    });

    it('serves persisted training memberships for a confirmed managed problem', async () => {
        const handler = managedHandler();
        handler.pdoc.hidden = false;
        handler.pdoc.managedAuthoring.metadataStatus = 'confirmed';
        handler.pdoc.data = [];
        handler.pdoc.additional_file = [];
        managedTrainingPlacementResults = [
            { trainingId: 'training-1', trainingTitle: '牛客暑期多校训练集', chapterId: 40, chapterTitle: '2026年牛客-第1场' },
            { trainingId: 'training-2', trainingTitle: '数据结构训练', chapterId: 3, chapterTitle: '并查集' },
        ];
        maintainableResults = [{ config: 'type: default\n' }];

        await handler.get();

        expect(handler.response.body.managedTrainingPlacements).to.deep.equal(managedTrainingPlacementResults);
    });

    it('keeps a confirmed formal title out of generic content saves and rejects a forged title', async () => {
        maintainResult = true;
        const handler = managedHandler();
        handler.pdoc.hidden = false;
        handler.pdoc.managedAuthoring.metadataStatus = 'confirmed';
        handler.request.body = { content: 'New statement', expectedStructureRevision: '2' };

        await handler.post('forged', 'P7', undefined, 'New statement', undefined, false, [], undefined, undefined, 2);
        expect(calls.edit[0][2]).to.deep.equal({ content: 'New statement', html: false });

        calls.edit.length = 0;
        handler.request.body = { content: 'Newer statement', title: 'Working title', expectedStructureRevision: '2' };
        const error = await captureFailure(() =>
            handler.post('forged', 'P7', 'Working title', 'Newer statement', undefined, false, [], undefined, undefined, 2),
        );
        expect(error).to.be.instanceOf(GenericError);
        expect(calls.edit).to.deep.equal([]);
        expect(calls.oplog.at(-1)?.[2]?.fields).to.deep.equal(['title']);
    });

    it('rejects forbidden managed fields as one audited request even when the value is unchanged', async () => {
        const handler = managedHandler();
        handler.request.body = { content: 'New statement', title: 'Formal title', pid: 'P7' };

        const error = await captureFailure(() =>
            handler.post('forged', 'P7', 'Formal title', 'New statement', 'P7', false, [], undefined, undefined, 2),
        );

        expect(error).to.be.instanceOf(GenericError);
        expect(calls.edit).to.deep.equal([]);
        expect(calls.oplog.at(-1)?.[1]).to.equal('problem.managed.write.denied');
        expect(calls.oplog.at(-1)?.[2]?.fields).to.deep.equal(['pid']);
    });

    it('rejects administrator-forged managed PID and system tags before generic model entrypoint', async () => {
        maintainResult = true;
        const handler = managedHandler();

        const forgedFields: Array<{ field: 'pid' | 'tag'; value: string | string[] }> = [
            { field: 'pid', value: 'P9999' },
            { field: 'tag', value: ['forged'] },
        ];
        for (const { field, value } of forgedFields) {
            calls.edit.length = 0;
            handler.request.body = { content: 'New statement', expectedStructureRevision: '2', [field]: value };

            const error = await captureFailure(() =>
                handler.post(
                    'forged',
                    'P7',
                    undefined,
                    'New statement',
                    field === 'pid' ? String(value) : undefined,
                    false,
                    field === 'tag' ? (value as string[]) : [],
                    undefined,
                    undefined,
                    2,
                ),
            );

            expect(error).to.be.instanceOf(GenericError);
            expect(calls.edit).to.deep.equal([]);
            expect(calls.oplog.at(-1)?.[1]).to.equal('problem.managed.write.denied');
            expect(calls.oplog.at(-1)?.[2]?.fields).to.deep.equal([field]);
        }
    });

    it('rejects a mixed managed file request before acquiring a storage write claim', async () => {
        const handler = makeHandler(ProblemFilesHandler, {});
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            authoringMode: 'managed',
            data: [],
            additional_file: [],
        };
        handler.args = { operation: 'delete_files' };
        handler.request.body = { operation: 'delete_files', files: ['input.txt'], hidden: 'false' };

        const error = await captureFailure(() => handler.post());

        expect(error).to.be.instanceOf(GenericError);
        expect(calls.claims).to.have.lengthOf(0);
        expect(calls.renameFile).to.have.lengthOf(0);
        expect(calls.oplog.at(-1)?.[1]).to.equal('problem.managed.write.denied');
        expect(calls.oplog.at(-1)?.[2]?.fields).to.deep.equal(['hidden']);
    });
});

describe('P2.17 programming tag HTTP boundaries', () => {
    it('serves only self creation to trusted creators and every fixed template to bank administrators', async () => {
        for (const user of [{ hasPerm: (permission: bigint) => permission === PERM.PERM_CREATE_PROGRAMMING_DRAFT }, { admin: true }]) {
            const handler = makeHandler(ProblemCreateProgrammingHandler, user);
            await handler.get();
            expect(handler.response.body.pdoc.authoringMode).to.equal('managed');
            expect(handler.response.body.managedCreateDefault).to.equal(true);
            expect(handler.response.body.managedMindmapOptions).to.have.length(1);
            expect(handler.response.body.canAssignManagedAuthor).to.equal(user.admin === true);
            expect(handler.response.body.canAssignManagedTraining).to.equal(user.admin === true);
            expect(handler.response.body.managedSourceTemplates.map((template: any) => template.id)).to.deep.equal(
                user.admin === true ? ['pat_basic', 'self'] : ['self'],
            );
        }

        const broadOnly = makeHandler(ProblemCreateProgrammingHandler, {
            hasPerm: (permission: bigint) => permission === PERM.PERM_CREATE_PROBLEM,
        });
        expect(await captureFailure(() => broadOnly.get())).to.be.instanceOf(TestPermissionError);
    });

    it('serves the administrator a revision-bound review preview derived from live catalog data', async () => {
        pendingContributionRows = [
            {
                domainId: 'system',
                pid: 7,
                uid: 88,
                scope: 'tag',
                active: true,
                status: 'pending',
                lastRequestId: 'assign-88',
            },
        ];
        const pdoc = {
            domainId: 'system',
            docId: 7,
            pid: 'P3107',
            title: '工作标题',
            tag: ['stale-tag'],
            problemKind: 'programming',
            authoringMode: 'managed',
            hidden: true,
            sourceMeta: { template: 'self', year: 2026 },
            managedAuthoring: {
                workingTitle: '工作标题',
                selectedMindmapNodeIds: ['node-1'],
                metadataStatus: 'draft',
            },
            config: { cases: [{ input: '1.in', output: '1.out' }] },
            data: [{ name: '1.in' }, { name: '1.out' }],
            additional_file: [],
            structureRevision: 9,
        };
        const handler = makeHandler(ProblemEditHandler, { canPublish: true });
        handler.pdoc = pdoc;
        maintainableResults = [pdoc];

        await handler.get();

        expect(handler.response.body.managedReviewPreview).to.deep.equal({
            state: 'ready',
            structureRevision: 9,
            tags: ['自命题', 'derived:node-1'],
            selectedMindmapNodeIds: ['node-1'],
        });
        expect(handler.response.body.managedReviewPreview.tags).not.to.include('stale-tag');
        expect(handler.response.body.managedPendingContributions).to.deep.equal([{ uid: 88, scope: 'tag' }]);
        expect(handler.response.body.managedPendingContributionFingerprint).to.equal('pending-fingerprint');
        expect(handler.response.body.managedContributionUdict[88].uname).to.equal('user-88');
    });

    it('keeps an invalid managed review preview visible and non-publishable', async () => {
        const pdoc = {
            domainId: 'system',
            docId: 7,
            pid: 'P3107',
            tag: ['stale-tag'],
            problemKind: 'programming',
            authoringMode: 'managed',
            hidden: true,
            sourceMeta: { template: 'self', year: 2026 },
            managedAuthoring: { workingTitle: '工作标题', selectedMindmapNodeIds: ['node-1'], metadataStatus: 'draft' },
            config: {},
            data: [],
            additional_file: [],
            structureRevision: 9,
        };
        managedPublicationPreviewError = new Error('知识节点已失效');
        const handler = makeHandler(ProblemEditHandler, { canPublish: true });
        handler.pdoc = pdoc;
        maintainableResults = [pdoc];

        await handler.get();

        expect(handler.response.body.managedReviewPreview).to.deep.include({
            state: 'invalid',
            structureRevision: 9,
            tags: [],
            message: '知识节点已失效',
        });
    });

    it('preserves an unconverted legacy tag array exactly during an ordinary edit save', async () => {
        const handler = makeHandler(ProblemEditHandler, {});
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            pid: 'P7',
            title: 'Old',
            tag: ['PAT乙级', 'Dijksrta', '二分'],
            problemKind: 'programming',
            structureRevision: 4,
        };
        handler.canEditLoadedProblem = true;
        handler.request.body = {
            title: 'New',
            content: 'Statement',
            pid: 'P7',
            hidden: 'false',
            difficulty: '2',
            lockHidden: 'false',
            expectedStructureRevision: '4',
        };

        await handler.post('forged', 'P7', 'New', 'Statement', 'P7', false, [], [], 2, false, 4);

        expect(calls.edit).to.have.length(1);
        expect(calls.edit[0][2]).not.to.have.keys('tag', 'knowledgeNodeIds');
        expect(handler.pdoc.tag).to.deep.equal(['PAT乙级', 'Dijksrta', '二分']);
    });

    it('rejects raw tag writes and a free PID after conversion before the model write boundary', async () => {
        const handler = makeHandler(ProblemEditHandler, {});
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            pid: 'P7',
            tag: ['PAT乙级', '二分'],
            problemKind: 'programming',
            structureRevision: 4,
        };
        handler.canEditLoadedProblem = true;
        handler.request.body = { title: 'Title', content: 'Statement', tag: 'forged' };
        const rawTag = await captureFailure(() => handler.post('forged', 'P7', 'Title', 'Statement', undefined, false, ['forged'], [], 2, false, 4));
        expect(rawTag).to.be.instanceOf(GenericError);

        handler.pdoc.knowledgeNodeIds = ['node-1'];
        handler.request.body = { title: 'Title', content: 'Statement', pid: 'CUSTOM' };
        const freePid = await captureFailure(() => handler.post('forged', 'P7', 'Title', 'Statement', 'CUSTOM', false, [], [], 2, false, 4));
        expect(freePid).to.be.instanceOf(GenericError);
        expect(calls.edit).to.deep.equal([]);
    });

    it('returns a server-computed preview and requires explicit confirmation for the atomic write', async () => {
        const pdoc = {
            domainId: 'system',
            docId: 7,
            pid: 'P7',
            tag: ['PAT乙级', 'Dijksrta'],
            problemKind: 'programming',
            structureRevision: 4,
        };
        const preview = makeHandler(ProblemProgrammingTagPreviewHandler, {});
        preview.pdoc = pdoc;
        preview.request.body = { knowledgeNodeIds: 'node-1' };
        maintainableResults = [{ ...pdoc }];
        await preview.post('forged', 'P7', ['node-1']);
        expect(calls.tagUnlocks).to.deep.equal([['system', 7]]);
        expect(preview.response.body.preview).to.deep.include({
            selectedNodeIds: ['node-1'],
            removedTags: ['Dijksrta'],
            fingerprint: 'preview-fingerprint',
        });

        const apply = makeHandler(ProblemProgrammingTagApplyHandler, {});
        apply.pdoc = pdoc;
        apply.request.body = {
            knowledgeNodeIds: 'node-1',
            intent: 'normalize',
            confirmed: 'true',
            previewFingerprint: 'preview-fingerprint',
        };
        await apply.post('forged', 'P7', ['node-1'], 'normalize', true, 'preview-fingerprint');
        expect(calls.tagNormalizations).to.have.length(1);
        expect(calls.tagNormalizations[0]).to.deep.include({
            domainId: 'system',
            pid: 7,
            selectedNodeIds: ['node-1'],
            previewFingerprint: 'preview-fingerprint',
        });
        expect(apply.response.body).to.deep.include({ ok: true, structureRevision: 5 });

        calls.tagNormalizations.length = 0;
        const unconfirmed = await captureFailure(() => apply.post('forged', 'P7', ['node-1'], 'normalize', false, 'preview-fingerprint'));
        expect(unconfirmed).to.be.instanceOf(GenericError);
        expect(calls.tagNormalizations).to.deep.equal([]);
    });
});

describe('P3.15 files workspace capability contract', () => {
    it('lets a data-only contributor pass the POST preflight through a fresh data-capability read', async () => {
        const pdoc = {
            domainId: 'system',
            docId: 7,
            pid: 'P3101',
            title: 'Managed problem',
            authoringMode: 'managed',
            data: [],
            additional_file: [],
        };
        const handler = makeHandler(ProblemFilesHandler, { canEditContent: false, canEditData: true });
        handler.pdoc = pdoc;
        handler.args = { operation: 'upload_file' };
        handler.request.body = { operation: 'upload_file', filename: '1.in', type: 'testdata' };
        maintainableResults = [{ ...pdoc }];

        await handler.post();

        expect(calls.getCapabilityAuthorized[0].slice(0, 4)).to.deep.equal(['system', 7, handler.user, 'data']);
        expect(handler.canEditLoadedProblem).to.equal(true);
    });

    it('binds an administrator override challenge to the current problem, operation, and active containers', async () => {
        const pdoc = {
            domainId: 'system',
            docId: 7,
            pid: 'P3101',
            title: 'Managed problem',
            authoringMode: 'managed',
            data: [{ name: '1.in', size: 1 }],
            additional_file: [],
        };
        const handler = makeHandler(ProblemFilesHandler, { admin: true, canEditData: true });
        handler.pdoc = pdoc;
        maintainableResults = [{ ...pdoc }];
        activeDataWriteContainers = [{ docId: 'contest-1', title: '期中考试', rule: 'exam' }];

        await handler.get({}, ['testdata', 'additional_file'], false);

        const confirmations = handler.response.body.dataWriteGuard.confirmationRequestIds;
        expect(confirmations).to.have.keys('files-upload', 'files-rename', 'files-delete', 'generate-testdata-request');
        await handler.postDeleteFiles('forged', ['1.in'], 'testdata', confirmations['files-delete']);
        expect(calls.claims.at(-1).options.activeContainerConfirmation).to.deep.include({
            requestId: confirmations['files-delete'],
            domainId: 'system',
            pid: 7,
            actor: 42,
            operation: 'files-delete',
            containerFingerprint: 'fingerprint:contest-1',
        });
        await handler.postDeleteFiles('forged', ['1.in'], 'testdata', confirmations['files-delete']);
        expect(calls.claims.at(-1).options.activeContainerConfirmation.requestId).to.equal(confirmations['files-delete']);

        const claimCount = calls.claims.length;
        const wrongOperation = await captureFailure(() => handler.postDeleteFiles('forged', ['1.in'], 'testdata', confirmations['files-upload']));
        expect(wrongOperation).to.be.instanceOf(GenericError);
        expect(calls.claims).to.have.length(claimCount);
    });

    it('does not present the contribution-only contest guard to an existing content editor', async () => {
        const pdoc = {
            domainId: 'system',
            docId: 7,
            pid: 'P3101',
            title: 'Legacy problem',
            data: [],
            additional_file: [],
        };
        const handler = makeHandler(ProblemFilesHandler, { canEditContent: true, canEditData: true });
        handler.pdoc = pdoc;
        maintainableResults = [{ ...pdoc }];
        activeDataWriteContainers = [{ docId: 'contest-1', title: '期中考试', rule: 'exam' }];

        await handler.get({}, ['testdata', 'additional_file'], false);

        expect(handler.response.body.dataWriteGuard).to.deep.equal({ active: [], canOverride: false });
    });

    it('consumes an active-contest statement confirmation after exactly one save attempt', async () => {
        const pdoc = {
            domainId: 'system',
            docId: 7,
            pid: 'P7',
            title: 'Statement correction',
            content: 'old statement',
            problemKind: 'programming',
            structureRevision: 4,
            hidden: true,
            data: [],
            additional_file: [],
        };
        const handler = makeHandler(ProblemEditHandler, {
            admin: true,
            canEditContent: true,
            canEditData: true,
            canEditTags: false,
        });
        handler.pdoc = pdoc;
        handler.canEditLoadedProblem = true;
        handler.request.body = {
            title: pdoc.title,
            content: 'corrected statement',
            hidden: 'true',
            expectedStructureRevision: '4',
        };
        maintainableResults = [{ ...pdoc, config: '' }];
        activeDataWriteContainers = [{ docId: 'contest-1', title: '期中考试', rule: 'exam' }];

        await handler.get();
        const requestId = handler.response.body.statementWriteGuard.confirmationRequestIds['statement-edit'];
        handler.request.body.activeContainerConfirmation = requestId;
        const args = [
            'forged',
            'P7',
            pdoc.title,
            'corrected statement',
            undefined,
            true,
            [],
            [],
            1,
            undefined,
            4,
            '',
            '',
            false,
            false,
            requestId,
        ] as const;

        await handler.post(...args);
        expect(calls.edit).to.have.length(1);
        const replay = await captureFailure(() => handler.post(...args));
        expect(replay).to.be.instanceOf(GenericError);
        expect(calls.edit).to.have.length(1);
        expect((handler.session as any).problemDataWriteConfirmations[requestId]).to.equal(undefined);
    });

    it('publishes the canonical managed capabilities for authors, maintainers, and administrators', async () => {
        const pdoc = {
            domainId: 'system',
            docId: 7,
            pid: 'P3101',
            title: 'Managed problem',
            authoringMode: 'managed',
            managedAuthoring: { workingTitle: 'Draft title', metadataStatus: 'confirmed' },
            data: [],
            additional_file: [],
        };
        const scenarios = [
            {
                role: 'author',
                user: {
                    canEditContent: false,
                    canEditMetadata: false,
                    canManageCollaborators: false,
                    canManageMaintainers: false,
                    canPublish: false,
                    canArchive: false,
                    canDelete: false,
                    canClone: false,
                },
                expected: { canEditContent: false, canManageCollaborators: false, canPublish: false },
            },
            {
                role: 'maintainer',
                user: {
                    canEditContent: true,
                    canEditMetadata: true,
                    canManageCollaborators: true,
                    canManageMaintainers: false,
                    canPublish: false,
                    canArchive: false,
                    canDelete: false,
                    canClone: false,
                },
                expected: { canEditContent: true, canManageCollaborators: true, canPublish: false },
            },
            {
                role: 'administrator',
                user: {
                    canEditContent: true,
                    canEditMetadata: true,
                    canManageCollaborators: true,
                    canManageMaintainers: true,
                    canPublish: true,
                    canArchive: true,
                    canDelete: true,
                    canClone: true,
                },
                expected: { canEditContent: true, canManageCollaborators: true, canPublish: true },
            },
        ];

        for (const scenario of scenarios) {
            const handler = makeHandler(ProblemFilesHandler, scenario.user);
            handler.pdoc = pdoc;
            maintainableResults = [{ ...pdoc }];

            await handler.get({}, undefined, false);

            expect(handler.response.body.problemAuthoringCapabilities, scenario.role).to.deep.include({
                managed: true,
                ...scenario.expected,
            });
            expect(handler.response.body.pdoc.managedAuthoring?.metadataStatus, scenario.role).to.equal('confirmed');
            expect(calls.getCapabilityAuthorized.at(-1)?.[3], scenario.role).to.equal('data');
            expect(calls.getCapabilityAuthorized.at(-1)?.[4], scenario.role).to.equal(problemStub.PROJECTION_MANAGED_EDITOR);
        }
    });
});

describe('P3.9 basic objective HTTP boundaries', () => {
    it('creates a hidden single problem in the authoritative domain with a fixed URL kind', async () => {
        const handler = makeHandler(ProblemCreateSingleHandler, {});
        handler.request.body = {
            title: 'Single',
            content: 'Statement',
            difficulty: '3',
            knowledgeNodeIds: 'node-1',
            editorProblemKind: 'single',
            structuredConfig: JSON.stringify({ main: { options: ['A text', 'B text'], answerIndex: 1 } }),
        };
        await handler.post(
            'forged',
            'Single',
            'Statement',
            '',
            3,
            ['node-1'],
            'single',
            JSON.stringify({ main: { options: ['A text', 'B text'], answerIndex: 1 } }),
        );
        expect(createKinds).to.deep.equal(['single']);
        expect(calls.add[0][0]).to.equal('system');
        expect(calls.add[0][6].structuredConfig).to.deep.equal({
            main: { options: ['A text', 'B text'], answerIndex: 1 },
        });
        expect(calls.add[0][5]).to.deep.equal(['derived:node-1']);
        expect(calls.add[0][6].knowledgeNodeIds).to.deep.equal(['node-1']);
        expect(handler.response.body.ok).to.equal(true);
        expect(handler.response.body.hidden).to.equal(true);
    });

    it('rejects a create-route kind mismatch before creating anything', async () => {
        const handler = makeHandler(ProblemCreateSingleHandler, {});
        handler.request.body = {
            title: 'Single',
            content: 'Statement',
            difficulty: '0',
            knowledgeNodeIds: '',
            editorProblemKind: 'multi',
            structuredConfig: JSON.stringify({ main: { options: ['A', 'B'], answerIndex: 0 } }),
        };
        const error = await captureFailure(() =>
            handler.post('forged', 'Single', 'Statement', '', 0, [], 'multi', JSON.stringify({ main: { options: ['A', 'B'], answerIndex: 0 } })),
        );
        expect(error).to.be.instanceOf(GenericError);
        expect(calls.add).to.deep.equal([]);
    });

    it('rejects raw tags, non-admin custom PIDs, and stale knowledge nodes before creation', async () => {
        for (const forged of [{ tag: 'free-text' }, { pid: 'FORGED1' }]) {
            const handler = makeHandler(ProblemCreateSingleHandler, {});
            handler.request.body = {
                title: 'Single',
                content: 'Statement',
                difficulty: '1',
                knowledgeNodeIds: 'node-1',
                editorProblemKind: 'single',
                structuredConfig: JSON.stringify({ main: { options: ['A', 'B'], answerIndex: 0 } }),
                ...forged,
            };
            const error = await captureFailure(() =>
                handler.post(
                    'forged',
                    'Single',
                    'Statement',
                    forged.pid || '',
                    1,
                    ['node-1'],
                    'single',
                    JSON.stringify({ main: { options: ['A', 'B'], answerIndex: 0 } }),
                ),
            );
            expect(error).to.be.instanceOf(GenericError);
        }

        const stale = makeHandler(ProblemCreateSingleHandler, {});
        stale.request.body = {
            title: 'Single',
            content: 'Statement',
            difficulty: '1',
            knowledgeNodeIds: 'stale-node',
            editorProblemKind: 'single',
            structuredConfig: JSON.stringify({ main: { options: ['A', 'B'], answerIndex: 0 } }),
        };
        const staleError = await captureFailure(() =>
            stale.post(
                'forged',
                'Single',
                'Statement',
                '',
                1,
                ['stale-node'],
                'single',
                JSON.stringify({ main: { options: ['A', 'B'], answerIndex: 0 } }),
            ),
        );
        expect(staleError).to.be.instanceOf(GenericError);
        expect(calls.add).to.deep.equal([]);
    });

    it('allows only a site administrator to submit an explicit structured PID', async () => {
        const handler = makeHandler(ProblemCreateSingleHandler, {
            hasPriv: (privilege: number) => privilege === PRIV.PRIV_EDIT_SYSTEM,
        });
        handler.request.body = {
            title: 'Admin PID',
            content: 'Statement',
            pid: 'CUSTOM1',
            difficulty: '1',
            knowledgeNodeIds: 'node-1',
            editorProblemKind: 'single',
            structuredConfig: JSON.stringify({ main: { options: ['A', 'B'], answerIndex: 0 } }),
        };
        getResults = [null];
        await handler.post(
            'forged',
            'Admin PID',
            'Statement',
            'CUSTOM1',
            1,
            ['node-1'],
            'single',
            JSON.stringify({ main: { options: ['A', 'B'], answerIndex: 0 } }),
        );
        expect(calls.add[0][1]).to.equal('CUSTOM1');
    });

    it('saves metadata, content, and config through one revision-checked structured write', async () => {
        const handler = makeHandler(ProblemEditHandler, {});
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            pid: 'P7',
            problemKind: 'multi',
            structureRevision: 4,
        };
        handler.canEditLoadedProblem = true;
        handler.request.body = {
            title: 'Multi',
            content: 'Statement',
            hidden: 'false',
            difficulty: '2',
            knowledgeNodeIds: 'node-1',
            expectedStructureRevision: '4',
            editorProblemKind: 'multi',
            structuredConfig: JSON.stringify({
                main: { options: ['A', 'B'], answerIndexes: [0], partialCreditPercent: 25 },
            }),
        };
        await handler.post(
            'forged',
            'P7',
            'Multi',
            'Statement',
            undefined,
            false,
            [],
            ['node-1'],
            2,
            false,
            4,
            'multi',
            JSON.stringify({
                main: { options: ['A', 'B'], answerIndexes: [0], partialCreditPercent: 25 },
            }),
        );
        expect(calls.structuredSaves).to.have.length(1);
        expect(calls.structuredSaves[0]).to.deep.include({
            domainId: 'system',
            pid: 7,
            problemKind: 'multi',
            expectedStructureRevision: 4,
        });
        expect(calls.structuredSaves[0].metadata).to.deep.include({
            title: 'Multi',
            hidden: false,
            tag: ['derived:node-1'],
            knowledgeNodeIds: ['node-1'],
        });
        expect(handler.response.body).to.deep.include({ ok: true, pid: 'P7', problemKind: 'multi' });
        expect(calls.edit).to.deep.equal([]);
    });

    it('rejects forged raw tags, non-admin PID edits, and stale knowledge nodes before a structured save', async () => {
        const config = JSON.stringify({
            main: { options: ['A', 'B'], answerIndexes: [0], partialCreditPercent: 25 },
        });
        const baseBody = {
            title: 'Multi',
            content: 'Statement',
            hidden: 'false',
            difficulty: '2',
            knowledgeNodeIds: 'node-1',
            expectedStructureRevision: '4',
            editorProblemKind: 'multi',
            structuredConfig: config,
        };
        for (const forged of [{ tag: 'free-text' }, { pid: 'FORGED2' }]) {
            const handler = makeHandler(ProblemEditHandler, {});
            handler.pdoc = {
                domainId: 'system',
                docId: 7,
                pid: 'P7',
                problemKind: 'multi',
                structureRevision: 4,
            };
            handler.canEditLoadedProblem = true;
            handler.request.body = { ...baseBody, ...forged };
            const error = await captureFailure(() =>
                handler.post(
                    'forged',
                    'P7',
                    'Multi',
                    'Statement',
                    forged.pid,
                    false,
                    forged.tag ? [forged.tag] : [],
                    ['node-1'],
                    2,
                    false,
                    4,
                    'multi',
                    config,
                ),
            );
            expect(error).to.be.instanceOf(GenericError);
        }

        const stale = makeHandler(ProblemEditHandler, {});
        stale.pdoc = {
            domainId: 'system',
            docId: 7,
            pid: 'P7',
            problemKind: 'multi',
            structureRevision: 4,
        };
        stale.canEditLoadedProblem = true;
        stale.request.body = { ...baseBody, knowledgeNodeIds: 'stale-node' };
        const staleError = await captureFailure(() =>
            stale.post('forged', 'P7', 'Multi', 'Statement', undefined, false, [], ['stale-node'], 2, false, 4, 'multi', config),
        );
        expect(staleError).to.be.instanceOf(GenericError);
        expect(calls.structuredSaves).to.deep.equal([]);
    });

    it('updates only mutable metadata after an objective problem is structurally locked', async () => {
        const handler = makeHandler(ProblemEditHandler, {});
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            pid: 'P7',
            problemKind: 'multi',
            structureRevision: 5,
            structureLockedAt: new Date(),
            content: 'Original statement',
            difficulty: 2,
        };
        handler.canEditLoadedProblem = true;
        handler.request.body = {
            title: 'Renamed',
            hidden: 'true',
            difficulty: '4',
            knowledgeNodeIds: 'node-2',
            metadataOnly: 'true',
        };
        await handler.post('forged', 'P7', 'Renamed', undefined, undefined, true, [], ['node-2'], 4, undefined, undefined, '', '', true);
        expect(calls.structuredMetadataSaves).to.have.length(1);
        expect(calls.structuredMetadataSaves[0]).to.deep.include({
            domainId: 'system',
            pid: 7,
            actor: 42,
            problemKind: 'multi',
            metadata: {
                title: 'Renamed',
                hidden: true,
                tag: ['derived:node-2'],
                difficulty: 4,
                knowledgeNodeIds: ['node-2'],
            },
        });
        expect(handler.response.body).to.deep.include({ ok: true, pid: 'P7', problemKind: 'multi' });
        expect(calls.edit).to.deep.equal([]);
        expect(calls.structuredSaves).to.deep.equal([]);
    });

    it('rejects structural fields smuggled into an objective metadata-only save', async () => {
        const handler = makeHandler(ProblemEditHandler, {});
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            pid: 'P7',
            problemKind: 'multi',
            structureRevision: 5,
            structureLockedAt: new Date(),
            content: 'Original statement',
        };
        handler.canEditLoadedProblem = true;
        handler.request.body = {
            title: 'Renamed',
            content: 'Changed statement',
            hidden: 'true',
            knowledgeNodeIds: 'node-1',
            metadataOnly: 'true',
        };
        const error = await captureFailure(() =>
            handler.post(
                'forged',
                'P7',
                'Renamed',
                'Changed statement',
                undefined,
                true,
                [],
                ['node-1'],
                undefined,
                undefined,
                undefined,
                '',
                '',
                true,
            ),
        );
        expect(error).to.be.instanceOf(GenericError);
        expect(calls.edit).to.deep.equal([]);
        expect(calls.structuredMetadataSaves).to.deep.equal([]);
        expect(calls.structuredSaves).to.deep.equal([]);
    });

    it('serves the dedicated editor from stable raw config without returning derived answers', async () => {
        const handler = makeHandler(ProblemEditHandler, {});
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            pid: 'P7',
            owner: 42,
            problemKind: 'blank',
            data: [],
            additional_file: [],
            tag: [],
            content: '',
        };
        handler.canEditLoadedProblem = true;
        maintainableResults = [
            {
                config: {
                    type: 'objective',
                    main: { answer: 'Case' },
                    answers: { main: ['Case', 100, { kind: 'blank' }] },
                },
            },
        ];
        await handler.get();
        expect(handler.response.template).to.equal('problem_edit_blank.html');
        expect(handler.response.body.structuredConfig).to.deep.equal({ main: { answer: 'Case' } });
        expect(handler.response.body.structuredConfig).not.to.have.property('answers');
        expect(handler.response.body.knowledgeMindmapOptions).to.deep.equal([{ id: 'node-1', label: '数据结构 / 线段树', tags: ['线段树'] }]);
        expect(handler.response.body.canUseCustomPid).to.equal(false);
    });

    it('serves a canonical function config that has no legacy main field', async () => {
        const handler = makeHandler(ProblemEditHandler, {});
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            pid: 'P7',
            owner: 42,
            problemKind: 'function',
            data: [],
            additional_file: [],
            tag: [],
            content: '',
        };
        handler.canEditLoadedProblem = true;
        const region = { id: 'r_abcdefghijkl', startLine: 0, endLine: 1, order: 0, signature: 'int solve()' };
        maintainableResults = [
            {
                config: {
                    type: 'function',
                    template: { lang: 'cc.cc17', source: 'int solve();', sourceHash: 'hash', regions: [region] },
                    cases: [{ input: '1.in', output: '1.out' }],
                },
            },
        ];

        await handler.get();

        expect(handler.response.template).to.equal('problem_edit_function.html');
        expect(handler.response.body.structuredConfig).to.deep.equal({
            main: {
                mode: 'function',
                lang: 'cc.cc17',
                source: 'int solve();',
                regions: [region],
                cases: [{ input: '1.in', output: '1.out' }],
            },
        });
    });
});

describe('P3.10 subjective problem HTTP boundaries', () => {
    it('creates a hidden subjective problem through its fixed-kind route', async () => {
        const handler = makeHandler(ProblemCreateSubjectiveHandler, {});
        handler.request.body = {
            title: 'Essay',
            content: 'Explain why.',
            difficulty: '0',
            knowledgeNodeIds: 'node-1',
            editorProblemKind: 'subjective',
            structuredConfig: JSON.stringify({ main: { gradingInstructions: 'Look for invariants.' } }),
        };
        await handler.post(
            'forged',
            'Essay',
            'Explain why.',
            '',
            0,
            ['node-1'],
            'subjective',
            JSON.stringify({ main: { gradingInstructions: 'Look for invariants.' } }),
        );
        expect(createKinds.at(-1)).to.equal('subjective');
        expect(calls.add.at(-1)[6].structuredConfig).to.deep.equal({
            main: { gradingInstructions: 'Look for invariants.' },
        });
        expect(handler.response.body.hidden).to.equal(true);
    });

    it('rejects subjective submission outside an allowed scoring container', async () => {
        const handler = makeHandler(ProblemSubmitHandler, {});
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            problemKind: 'subjective',
            config: { type: 'objective' },
        };
        handler.tdoc = { docId: 'contest', rule: 'acm' };
        const error = await captureFailure(() => handler.post('forged', '_', 'answer', false, [], 'contest' as any));
        expect(error).to.be.instanceOf(GenericError);
        expect(calls.recordAdd).to.deep.equal([]);
    });

    it('stores the raw answer as a manual pending record in homework', async () => {
        const handler = makeHandler(ProblemSubmitHandler, {});
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            problemKind: 'subjective',
            config: { type: 'objective' },
        };
        handler.tdoc = { docId: 'homework', rule: 'homework' };
        await handler.post('forged', '_', 'line one\r\nline two', false, [], 'homework' as any);
        expect(calls.recordAdd.at(-1)[4]).to.equal('line one\r\nline two');
        expect(calls.recordAdd.at(-1)[6]).to.deep.include({ contest: 'homework', type: 'manual' });
        expect(calls.manualStatus).to.have.length(1);
        expect(calls.contestUpdates).to.have.length(1);
    });
});

describe('P3.19 program-fill and function HTTP boundaries', () => {
    it('creates each kind through a fixed dedicated route', async () => {
        const programFill = makeHandler(ProblemCreateProgramFillHandler, {});
        programFill.request.body = {
            title: 'Program fill',
            content: 'Statement',
            difficulty: '0',
            knowledgeNodeIds: '',
            editorProblemKind: 'program_fill',
            structuredConfig: JSON.stringify({
                main: { mode: 'text', lang: '', source: 'i++;\nj++;', regions: [{ id: '', startLine: 0, endLine: 1, order: 0 }] },
            }),
        };
        await programFill.post(
            'forged',
            'Program fill',
            'Statement',
            '',
            0,
            [],
            'program_fill',
            JSON.stringify({
                main: { mode: 'text', lang: '', source: 'i++;\nj++;', regions: [{ id: '', startLine: 0, endLine: 1, order: 0 }] },
            }),
        );
        const fn = makeHandler(ProblemCreateFunctionHandler, {});
        fn.request.body = {
            title: 'Function',
            difficulty: '0',
            knowledgeNodeIds: '',
            editorProblemKind: 'function',
            structuredConfig: JSON.stringify({
                main: {
                    mode: 'function',
                    lang: 'cpp',
                },
            }),
            codeEvaluationDraft: 'true',
        };
        await fn.post(
            'forged',
            'Function',
            undefined,
            '',
            0,
            [],
            'function',
            JSON.stringify({
                main: {
                    mode: 'function',
                    lang: 'cpp',
                },
            }),
            true,
        );
        expect(createKinds.slice(-2)).to.deep.equal(['program_fill', 'function']);
        expect(calls.add.at(-2)[6].structuredConfig).to.have.nested.property('main.mode', 'text');
        expect(calls.add.at(-1)[6]).to.deep.include({
            structuredConfig: { main: { mode: 'function', lang: 'cpp' } },
            codeEvaluationStatus: 'draft',
        });
        expect(fn.response.body).to.deep.include({ hidden: true, problemKind: 'function', codeEvaluationStatus: 'draft' });
    });

    it('forces the immutable template language and requires the exact function region map', async () => {
        const handler = makeHandler(ProblemSubmitHandler, {});
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            problemKind: 'function',
            config: {
                type: 'function',
                langs: ['cpp'],
                template: { lang: 'cpp', regions: [{ id: 'r_abcdefghijkl' }, { id: 'r_mnopqrstuvwx' }] },
            },
        };
        await handler.post('forged', 'forged-lang', JSON.stringify({ r_abcdefghijkl: 'body', r_mnopqrstuvwx: 'body' }), false, [], undefined);
        expect(calls.recordAdd.at(-1)[3]).to.equal('cpp');

        const error = await captureFailure(() =>
            handler.post('forged', 'cpp', JSON.stringify({ r_abcdefghijkl: 'body', extra: 'body' }), false, [], undefined),
        );
        expect(error).to.be.instanceOf(GenericError);
        expect(calls.recordAdd).to.have.length(1);
    });

    it('rejects a multi-line compile program-fill submission', async () => {
        const handler = makeHandler(ProblemSubmitHandler, {});
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            problemKind: 'program_fill',
            config: {
                type: 'program_fill',
                mode: 'compile',
                langs: ['cpp'],
                template: { lang: 'cpp', regions: [{ id: 'r_abcdefghijkl' }] },
            },
        };
        const error = await captureFailure(() => handler.post('forged', 'cpp', JSON.stringify({ r_abcdefghijkl: 'i++\nj++' }), false, [], undefined));
        expect(error).to.be.instanceOf(GenericError);
        expect(calls.recordAdd).to.deep.equal([]);
    });

    it('rejects multi-line and extra-key text program-fill submissions before Record insertion', async () => {
        const handler = makeHandler(ProblemSubmitHandler, {});
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            problemKind: 'program_fill',
            config: {
                type: 'program_fill',
                mode: 'text',
                template: { regions: [{ id: 'r_abcdefghijkl' }, { id: 'r_mnopqrstuvwx' }] },
            },
        };
        for (const code of [
            JSON.stringify({ r_abcdefghijkl: 'i++\nj++', r_mnopqrstuvwx: 'j++' }),
            JSON.stringify({ r_abcdefghijkl: 'i++', extra: 'hidden' }),
        ]) {
            const error = await captureFailure(() => handler.post('forged', '_', code, false, [], undefined));
            expect(error).to.be.instanceOf(GenericError);
        }
        expect(calls.recordAdd).to.deep.equal([]);

        await handler.post('forged', 'forged-lang', JSON.stringify({ r_abcdefghijkl: 'i++', r_mnopqrstuvwx: 'j++' }), false, [], undefined);
        expect(calls.recordAdd).to.have.length(1);
        expect(calls.recordAdd[0][3]).to.equal('_');
    });
});

describe('P2.11 scoped Mongo search', () => {
    it('sorts the full scoped text result before taking a later page', async () => {
        const scope = { $or: [{ owner: 42 }, { docId: { $in: [7] } }] };
        getMultiResults = [
            Array.from({ length: 25 }, (_, index) => ({
                domainId: 'system',
                docId: index + 1,
                owner: 42,
                pid: `P${index + 1}`,
                title: `Title ${String(24 - index).padStart(2, '0')}`,
            })),
        ];
        countResult = 25;
        const handler = makeHandler(ProblemMainHandler, {
            _id: 42,
            canBrowse: true,
            admin: false,
            scope,
            hasPriv: () => false,
        });
        await handler.get('system', 2, 'alpha', 20, false, false, 'title');
        expect(calls.getMulti).to.have.lengthOf(1);
        expect(calls.getMulti[0].query.$and[0]).to.deep.equal(scope);
        expect(calls.getMulti[0].query.$and[2]).to.have.property('$or');
        expect(handler.response.body.pdocs.map((pdoc: any) => pdoc.title)).to.deep.equal([
            'Title 20',
            'Title 21',
            'Title 22',
            'Title 23',
            'Title 24',
        ]);
        expect(handler.response.body.pcount).to.equal(25);
    });

    it('includes exact pid lookup in the same scoped Mongo query', async () => {
        const scope = { owner: 42 };
        getMultiResults = [[{ domainId: 'system', docId: 42, pid: 'P42' }]];
        countResult = 1;
        const handler = makeHandler(ProblemMainHandler, {
            _id: 42,
            canBrowse: true,
            admin: false,
            scope,
            hasPriv: () => false,
        });
        await handler.get('system', 1, 'P42', 20, false, false);
        expect(calls.getMulti).to.have.lengthOf(1);
        expect(calls.getMulti[0].query.$and[0]).to.equal(scope);
        expect(calls.getMulti[0].query.$and[2].$or[0]).to.deep.equal({ docId: 42 });
        expect(calls.get).to.deep.equal([]);
        expect(handler.response.body.pdocs.map((pdoc: any) => pdoc.docId)).to.deep.equal([42]);
        expect(handler.response.body.pcount).to.equal(1);
    });

    it('matches a single-character prefix in both pid and title search', async () => {
        getMultiResults = [[]];
        const handler = makeHandler(ProblemMainHandler, {
            _id: 42,
            canBrowse: true,
            admin: false,
            scope: { owner: 42 },
            hasPriv: () => false,
        });
        await handler.get('system', 1, 'P', 20, false, false);
        const alternatives = calls.getMulti[0].query.$and[2].$or;
        const pidPattern = alternatives.find((item: any) => item.pid).pid.$regex;
        const titlePattern = alternatives.find((item: any) => item.title).title.$regex;
        expect(pidPattern.test('P42')).to.equal(true);
        expect(titlePattern.test('Problem title')).to.equal(true);
        expect(pidPattern.flags).to.equal('i');
    });

    it('forces non-admin text search to Mongo even when a global provider is registered', async () => {
        (global as any).Hydro.module.problemSearch = {
            elastic: async (...args: any[]) => {
                calls.provider.push(args);
                return { hits: [], total: 0, countRelation: 'eq' };
            },
        };
        getMultiResults = [[]];
        const handler = makeHandler(ProblemMainHandler, {
            _id: 42,
            canBrowse: true,
            admin: false,
            scope: { owner: 42 },
            hasPriv: () => false,
        });
        await handler.get('system', 1, 'alpha', 20, false, false);
        expect(calls.provider).to.deep.equal([]);
        expect(calls.getMulti.length).to.be.greaterThan(0);
    });

    it('uses scoped Mongo for an administrator so every filter shares one count query', async () => {
        (global as any).Hydro.module.problemSearch = {
            elastic: async (...args: any[]) => {
                calls.provider.push(args);
                return { hits: [], total: 0, countRelation: 'eq' };
            },
        };
        const handler = makeHandler(ProblemMainHandler, {
            _id: 1,
            canBrowse: true,
            admin: true,
            scope: {},
            hasPriv: () => false,
        });
        await handler.get('system', 1, 'alpha', 20, false, false);
        expect(calls.provider).to.deep.equal([]);
        expect(calls.getMulti.length).to.be.greaterThan(0);
    });

    it('falls back to scoped Mongo when an administrator has a fenced exclusion', async () => {
        (global as any).Hydro.module.problemSearch = {
            elastic: async (...args: any[]) => {
                calls.provider.push(args);
                return { hits: [], total: 0, countRelation: 'eq' };
            },
        };
        getMultiResults = [[]];
        const handler = makeHandler(ProblemMainHandler, {
            _id: 1,
            canBrowse: true,
            admin: true,
            scope: { docId: { $nin: [7] } },
            hasPriv: () => false,
        });
        await handler.get('system', 1, 'alpha', 20, false, false);
        expect(calls.provider).to.deep.equal([]);
        expect(calls.getMulti[0].querySnapshot.$and[0]).to.deep.equal({ docId: { $nin: [7] } });
    });
});

describe('P2.11 Problem API gates', () => {
    it('returns 403 before exact or batch API queries for users without browse ability', async () => {
        const ctx = {
            args: { domainId: 'system' },
            domain: { _id: 'system' },
            user: { _problemAclDomainId: 'system', canBrowse: false },
        } as any;
        const exact = await captureFailure(() => ProblemApi.problem(ctx, { domainId: 'system', id: 7 }));
        const batch = await captureFailure(() => ProblemApi.problems(ctx, { domainId: 'system', ids: [7] }));
        expect(exact).to.be.instanceOf(TestPermissionError);
        expect(batch).to.be.instanceOf(TestPermissionError);
        expect(calls.getMulti).to.deep.equal([]);
        expect(calls.get).to.deep.equal([]);
    });

    it('pushes canonical scope into exact and batch API Mongo queries', async () => {
        const scope = { owner: 42 };
        const ctx = {
            args: { domainId: 'system' },
            domain: { _id: 'system' },
            user: { _problemAclDomainId: 'system', canBrowse: true, scope },
        } as any;
        getMultiResults = [[{ domainId: 'system', docId: 7, pid: 'P7' }], [{ domainId: 'system', docId: 7, pid: 'P7' }]];
        expect(await ProblemApi.problem(ctx, { domainId: 'system', id: 7 })).to.have.property('docId', 7);
        expect(await ProblemApi.problems(ctx, { domainId: 'system', ids: [7] })).to.have.lengthOf(1);
        expect(calls.getMulti).to.have.lengthOf(2);
        expect(calls.getMulti.every((call) => call.query.$and[0] === scope)).to.equal(true);
    });

    it('rejects a forged args domain that agrees with the API payload but not the authoritative domain', async () => {
        const ctx = {
            args: { domainId: 'other' },
            domain: { _id: 'system' },
            user: {
                _problemAclDomainId: 'system',
                canBrowse: true,
                scope: { docId: { $in: [7] } },
            },
        } as any;
        const exact = await captureFailure(() => ProblemApi.problem(ctx, { domainId: 'other', id: 7 }));
        const batch = await captureFailure(() => ProblemApi.problems(ctx, { domainId: 'other', ids: [7] }));
        expect(exact).to.be.instanceOf(TestPermissionError);
        expect(batch).to.be.instanceOf(TestPermissionError);
        expect(calls.getMulti).to.deep.equal([]);
    });

    it('uses the authoritative domain even when merged args contains a different forged value', async () => {
        const scope = { owner: 42 };
        const ctx = {
            args: { domainId: 'forged' },
            domain: { _id: 'other' },
            user: { _problemAclDomainId: 'other', canBrowse: true, scope },
        } as any;
        getMultiResults = [[{ domainId: 'other', docId: 7, pid: 'P7' }], [{ domainId: 'other', docId: 7, pid: 'P7' }]];
        expect(await ProblemApi.problem(ctx, { domainId: 'other', id: 7 })).to.have.property('docId', 7);
        expect(await ProblemApi.problems(ctx, { domainId: 'other', ids: [7] })).to.have.lengthOf(1);
    });

    it('rejects when preload state belongs to a different domain than the authoritative request', async () => {
        const ctx = {
            args: { domainId: 'other' },
            domain: { _id: 'other' },
            user: {
                _problemAclDomainId: 'system',
                canBrowse: true,
                scope: { docId: { $in: [7] } },
            },
        } as any;
        const exact = await captureFailure(() => ProblemApi.problem(ctx, { domainId: 'other', id: 7 }));
        const batch = await captureFailure(() => ProblemApi.problems(ctx, { domainId: 'other', ids: [7] }));
        expect(exact).to.be.instanceOf(TestPermissionError);
        expect(batch).to.be.instanceOf(TestPermissionError);
        expect(calls.getMulti).to.deep.equal([]);
    });
});

describe('P2.11 canonical ProblemDoc maintenance gate', () => {
    it('uses a stable maintainer read for manage preparation and the canonical gate for file mutations', async () => {
        const pdoc = { domainId: 'system', docId: 7, owner: 42 };
        const manage = makeHandler(ProblemManageHandler, { _id: 42 });
        manage.pdoc = pdoc;
        manage.canEditLoadedProblem = true;
        maintainableResults = [null];
        const manageError = await captureFailure(() => manage.prepare());
        expect(manageError).to.be.instanceOf(TestPermissionError);
        expect(calls.getCapabilityAuthorized[0].slice(0, 4)).to.deep.equal(['system', 7, manage.user, 'content']);

        const files = makeHandler(ProblemFilesHandler, { _id: 42 });
        files.pdoc = pdoc;
        files.args = { operation: 'upload_file' };
        maintainResult = false;
        maintainableResults = [null];
        const filesError = await captureFailure(() => files.post());
        expect(filesError).to.be.instanceOf(TestPermissionError);
        expect(calls.renameFile).to.deep.equal([]);
    });

    it('contains no legacy ProblemDoc own-or-wide-edit fallback in this handler', () => {
        const source = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/handler/problem.ts'), 'utf8');
        expect(source).not.to.match(/\.own\((?:this\.)?pdoc\b/);
        expect(source).not.to.match(/\.own\(this\.pdoc\b/);
        expect(source).not.to.match(/checkPerm\(PERM\.PERM_EDIT_PROBLEM\)/);
        expect(source).to.include('problem.getCapabilityAuthorized(');
        expect(source).to.include('problem.canEditProblemContent(udoc, pdoc)');
    });

    it('never resolves referenced-problem testdata links through wrapper-domain maintenance', async () => {
        const handler = makeHandler(ProblemFilesHandler, { _id: 42 });
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            owner: 42,
            reference: { domainId: 'source-domain', pid: 7 },
        };
        maintainResult = true;
        const error = await captureFailure(() => handler.postGetLinks('system', new Set(['config.yaml']), 'testdata'));
        expect(error).to.be.instanceOf(GenericError);
        expect(calls.get).to.deep.equal([]);
    });

    it('does not let a contest tid turn stale preload state into maintenance authority', async () => {
        const handler = makeHandler(ProblemManageHandler, { _id: 42 });
        handler.pdoc = { domainId: 'system', docId: 7, owner: 9, config: { type: 'default' } };
        handler.tdoc = { docId: 'contest' };
        handler.response.body.pdoc = handler.pdoc;
        maintainResult = true; // request preload still says maintainer
        handler.canEditLoadedProblem = true;
        maintainableResults = [null]; // stable final read sees completed downgrade

        const error = await captureFailure(() => handler.prepare());

        expect(error).to.be.instanceOf(TestPermissionError);
        expect(calls.getCapabilityAuthorized).to.have.length(1);
        expect(calls.getCapabilityAuthorized[0].slice(0, 4)).to.deep.equal(['system', 7, handler.user, 'content']);
    });

    it('loads editor raw config only through the stable maintainer read', async () => {
        const handler = makeHandler(ProblemEditHandler, { _id: 42 });
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            pid: 'P7',
            owner: 42,
            data: [],
            additional_file: [],
            tag: [],
            content: '',
        };
        handler.canEditLoadedProblem = true;
        maintainableResults = [{ config: 'type: default\n' }];

        await handler.get();

        expect(handler.response.body.configRaw).to.equal('type: default\n');
        expect(calls.get).to.deep.equal([]);
        expect(calls.getCapabilityAuthorized[0][0]).to.equal('system');
        expect(calls.getCapabilityAuthorized[0][1]).to.equal(7);
        expect(calls.getCapabilityAuthorized[0][3]).to.equal('content');
        expect(calls.getCapabilityAuthorized[0][4]).to.deep.equal(['config']);
        expect(calls.getCapabilityAuthorized[0][5]).to.equal(true);
    });

    it('performs no raw config storage read after the stable maintainer read rejects', async () => {
        const handler = makeHandler(ProblemConfigHandler, { _id: 42 });
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            owner: 9,
            data: [{ name: 'config.yaml' }],
            additional_file: [],
        };
        maintainResult = true;
        maintainableResults = [null];

        const error = await captureFailure(() => handler.get());

        expect(error).to.be.instanceOf(TestPermissionError);
        expect(calls.storageGet).to.deep.equal([]);
    });

    it('signs every validated file in a bulk selection larger than the form parser array limit', async () => {
        const names = Array.from({ length: 34 }, (_, index) => `${String(index + 1).padStart(2, '0')}.in`);
        const pdoc = {
            domainId: 'system',
            docId: 2860,
            owner: 42,
            data: names.map((name, index) => ({ name, size: index + 1 })),
            additional_file: [],
        };
        const handler = makeHandler(ProblemFilesHandler, { _id: 42 });
        handler.pdoc = pdoc;
        maintainableResults = [pdoc];

        await handler.postGetLinks('forged', new Set(names), 'testdata');

        expect(calls.storageSign).to.have.length(names.length);
        expect(calls.storageSign.map((args) => args[0])).to.deep.equal(names.map((name) => `problem/system/2860/testdata/${name}`));
        expect(Object.keys(handler.response.body.links)).to.deep.equal(names);
        expect(calls.oplog).to.have.length(1);
    });

    it('rejects a qs overflow object before signing an [object Object] file path', async () => {
        const pdoc = {
            domainId: 'system',
            docId: 2860,
            owner: 42,
            data: [{ name: '01.in', size: 1 }],
            additional_file: [],
        };
        const handler = makeHandler(ProblemFilesHandler, { _id: 42 });
        handler.pdoc = pdoc;
        maintainableResults = [pdoc];

        const error = await captureFailure(() => handler.postGetLinks('forged', new Set([{ 0: '01.in', 1: '01.out' }] as any[]), 'testdata'));

        expect(error).to.be.instanceOf(GenericError);
        expect(calls.storageSign).to.deep.equal([]);
        expect(calls.oplog).to.deep.equal([]);
    });

    it('rejects unknown bulk file names before signing any partial response', async () => {
        const pdoc = {
            domainId: 'system',
            docId: 2860,
            owner: 42,
            data: [{ name: '01.in', size: 1 }],
            additional_file: [],
        };
        const handler = makeHandler(ProblemFilesHandler, { _id: 42 });
        handler.pdoc = pdoc;
        maintainableResults = [pdoc];

        const error = await captureFailure(() => handler.postGetLinks('forged', new Set(['01.in', 'missing.out']), 'testdata'));

        expect(error).to.be.instanceOf(GenericError);
        expect(calls.storageSign).to.deep.equal([]);
        expect(calls.oplog).to.deep.equal([]);
    });

    it('rejects a file removed by the stable metadata read before signing or logging', async () => {
        const handler = makeHandler(ProblemFilesHandler, { _id: 42 });
        handler.pdoc = {
            domainId: 'system',
            docId: 2860,
            owner: 42,
            data: [{ name: 'removed.in', size: 1 }],
            additional_file: [],
        };
        const stable = {
            domainId: 'system',
            docId: 2860,
            owner: 42,
            data: [],
            additional_file: [],
        };
        maintainableResults = [stable];

        const error = await captureFailure(() => handler.postGetLinks('forged', new Set(['removed.in']), 'testdata'));

        expect(error).to.be.instanceOf(GenericError);
        expect(handler.pdoc).to.equal(stable);
        expect(calls.storageSign).to.deep.equal([]);
        expect(calls.oplog).to.deep.equal([]);
    });

    it('signs no bulk testdata links after downgrade wins the stable final read', async () => {
        const handler = makeHandler(ProblemFilesHandler, { _id: 42 });
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            owner: 9,
            data: [{ name: 'config.yaml', size: 6 }],
            additional_file: [],
        };
        maintainResult = true;
        maintainableResults = [null];

        const error = await captureFailure(() => handler.postGetLinks('forged', new Set(['config.yaml']), 'testdata'));

        expect(error).to.be.instanceOf(TestPermissionError);
        expect(calls.storageSign).to.deep.equal([]);
    });

    it('lets a data-only contributor preview or download one testdata file', async () => {
        const handler = makeHandler(ProblemFileDownloadHandler, { _id: 42, canEditData: true, canEditContent: false });
        const stable = {
            domainId: 'system',
            docId: 7,
            owner: 9,
            data: [{ name: 'config.yaml', size: 6 }],
            additional_file: [],
        };
        handler.pdoc = stable;
        handler.tdoc = { domainId: 'system', docId: 'contest' };
        maintainableResults = [stable];

        await handler.get({}, 'testdata', 'config.yaml', true, {} as any);

        expect(calls.getCapabilityAuthorized.at(-1)).to.deep.equal(['system', 7, handler.user, 'data']);
        expect(calls.storageGetMeta).to.deep.equal([['problem/system/7/testdata/config.yaml']]);
        expect(calls.storageSign).to.have.length(1);
    });

    it('signs no single testdata link after a data contribution is revoked', async () => {
        const handler = makeHandler(ProblemFileDownloadHandler, { _id: 42 });
        handler.pdoc = { domainId: 'system', docId: 7, owner: 9, data: [], additional_file: [] };
        handler.tdoc = { domainId: 'system', docId: 'contest' };
        maintainResult = true;
        maintainableResults = [null];

        const error = await captureFailure(() => handler.get({}, 'testdata', 'config.yaml', false, {} as any));

        expect(error).to.be.instanceOf(TestPermissionError);
        expect(calls.getCapabilityAuthorized.at(-1)).to.deep.equal(['system', 7, handler.user, 'data']);
        expect(calls.storageGetMeta).to.deep.equal([]);
        expect(calls.storageSign).to.deep.equal([]);
    });
});

describe('P2.11 generated-testdata request authorization', () => {
    it('takes a fresh write claim before enqueueing generation and writes no record if revoke won', async () => {
        const handler = makeHandler(ProblemFilesHandler, {});
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            data: [{ name: 'std.cpp' }, { name: 'gen.cpp' }],
        };

        claimAllowed = false;
        const denied = await captureFailure(() => handler.postGenerateTestdata('forged', 'std.cpp', 'gen.cpp'));
        expect(denied).to.be.instanceOf(TestPermissionError);
        expect(calls.recordAdd).to.deep.equal([]);

        claimAllowed = true;
        getResults = [handler.pdoc];
        await handler.postGenerateTestdata('forged', 'std.cpp', 'gen.cpp');
        expect(calls.claims.at(-1)).to.deep.include({
            domainId: 'system',
            pid: 7,
            operation: 'generate-testdata-request',
        });
        expect(calls.recordAdd).to.have.length(1);
        expect(calls.recordAdd[0][0]).to.equal('system');
    });

    it('rechecks std and generator files inside the claim and enqueues nothing after a concurrent delete', async () => {
        const handler = makeHandler(ProblemFilesHandler, {});
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            reference: null,
            data: [{ name: 'std.cpp' }, { name: 'gen.cpp' }],
        };
        getResults = [
            {
                domainId: 'system',
                docId: 7,
                reference: null,
                data: [{ name: 'std.cpp' }],
            },
        ];

        const error = await captureFailure(() => handler.postGenerateTestdata('forged', 'std.cpp', 'gen.cpp'));

        expect(error).to.be.instanceOf(GenericError);
        expect(calls.claims.at(-1)).to.deep.include({
            domainId: 'system',
            pid: 7,
            operation: 'generate-testdata-request',
        });
        expect(calls.get).to.deep.equal([['system', 7]]);
        expect(calls.recordAdd).to.deep.equal([]);
    });

    it('rechecks reference state inside the claim and enqueues nothing after a concurrent conversion', async () => {
        const handler = makeHandler(ProblemFilesHandler, {});
        handler.pdoc = {
            domainId: 'system',
            docId: 7,
            reference: null,
            data: [{ name: 'std.cpp' }, { name: 'gen.cpp' }],
        };
        getResults = [
            {
                domainId: 'system',
                docId: 7,
                reference: { domainId: 'source', pid: 9 },
                data: [{ name: 'std.cpp' }, { name: 'gen.cpp' }],
            },
        ];

        const error = await captureFailure(() => handler.postGenerateTestdata('forged', 'std.cpp', 'gen.cpp'));

        expect(error).to.be.instanceOf(GenericError);
        expect(calls.get).to.deep.equal([['system', 7]]);
        expect(calls.recordAdd).to.deep.equal([]);
    });
});
