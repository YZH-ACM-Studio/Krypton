import { createRequire, type Module as NodeModule } from 'node:module';
import { after, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { expect } from 'chai';
import { param, post as postParam } from '@hydrooj/framework/decorators';
import { Types } from '@hydrooj/framework/validator';
import { ObjectId } from 'mongodb';
import { ValidationError } from '../src/error';

const __filename = fileURLToPath(import.meta.url);
const requireFromTest = createRequire(__filename);

const domainId = 'teach-domain';
const ownerUid = 42;
const createdId = new ObjectId('64b000000000000000000014');
const keptId = new ObjectId('64b0000000000000000000b1');
const emptyDag = '[{"_id":1,"title":"","requireNids":[],"pids":[]}]';
const subjectiveDocId = 3;
const trueFalseDocId = 4;

interface StageNode {
    _id: number;
    title: string;
    requireNids: number[];
    pids: number[];
}

interface TrainingDocument {
    docId: ObjectId;
    kind: string;
    owner: number;
    pin: number;
    title: string;
    content: string;
    description: string;
    dag: StageNode[];
}

interface ProblemRow {
    docId: number;
    pid: string;
    title: string;
    problemKind?: string;
}

interface BankCall {
    domainId: string;
    pids: number[];
    existing: number[];
}

interface AddCall {
    domainId: string;
    title: string;
    content: string;
    owner: number;
    dag: StageNode[];
    description: string;
    pin: number;
}

interface EditCall {
    domainId: string;
    tid: string;
    title: unknown;
    content: unknown;
    description: unknown;
    pin: unknown;
    dag: StageNode[];
}

interface TrainingEditor {
    tdoc?: TrainingDocument;
    user: TestUser;
    domain: { _id: string };
    response: { body?: { tid?: ObjectId }; redirect?: string };
    checkPerm: (...perms: bigint[]) => void;
    checkPriv: (...privs: number[]) => void;
    url: (name: string, args?: Record<string, unknown>) => string;
    prepare: (rawArgs: Record<string, unknown>) => Promise<void>;
    post: (rawArgs: Record<string, unknown>) => Promise<void>;
}

interface TestUser {
    _id: number;
    hasPerm: (...perms: bigint[]) => boolean;
    hasPriv: (...privs: number[]) => boolean;
    own: (doc: { owner?: number }) => boolean;
}

interface TrainingHandlerModule {
    apply: (ctx: { Route: (name: string, path: string, HandlerClass: new () => TrainingEditor) => void }) => Promise<void> | void;
}

interface ModuleWithLoad {
    _load: (this: unknown, request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
}

const hydroHost = globalThis as unknown as { Hydro?: { model?: Record<string, unknown> } };
if (!hydroHost.Hydro) hydroHost.Hydro = {};
if (!hydroHost.Hydro.model) hydroHost.Hydro.model = {};

const { PERM } = requireFromTest('../src/model/builtin.ts') as {
    PERM: { PERM_CREATE_TRAINING: bigint };
};

const trainingFile = requireFromTest.resolve('../src/handler/training.ts');
const kindsFile = requireFromTest.resolve('../src/lib/container-problem-kinds.ts');
const moduleApi = requireFromTest('module') as ModuleWithLoad;
const originalLoad = moduleApi._load;

const bankCalls: BankCall[] = [];
const addCalls: AddCall[] = [];
const editCalls: EditCall[] = [];
const audienceCalls: unknown[] = [];
const infoCalls: unknown[][] = [];
const routes = new Map<string, new () => TrainingEditor>();
let problems: ProblemRow[] = [];
let currentTraining: TrainingDocument | null = null;

function isParent(parent: NodeModule | null | undefined, file: string): boolean {
    return parent?.filename === file;
}

function normalizeProblemDocIds(values: unknown): number[] {
    if (!Array.isArray(values)) throw new ValidationError('pids');
    const pids = values.map((value) => Number(value));
    if (!pids.every((pid) => Number.isSafeInteger(pid) && pid > 0)) throw new ValidationError('pids');
    return Array.from(new Set(pids));
}

function stagePids(dag: readonly { pids?: number[] }[]): number[] {
    const seen = new Set<number>();
    const pids: number[] = [];
    for (const node of dag) {
        for (const pid of node.pids || []) {
            if (seen.has(pid)) continue;
            seen.add(pid);
            pids.push(pid);
        }
    }
    return pids;
}

function readDocIds(query: unknown): number[] {
    if (!query || typeof query !== 'object') return [];
    const docId = (query as { docId?: unknown }).docId;
    if (!docId || typeof docId !== 'object') return [];
    const list = (docId as { $in?: unknown }).$in;
    if (!Array.isArray(list)) return [];
    return list.filter((id): id is number => typeof id === 'number');
}

function problemCursor(docIds: readonly number[]) {
    const rows = problems.filter((row) => docIds.includes(row.docId)).map((row) => ({ ...row }));
    const cursor = {
        project() {
            return cursor;
        },
        async toArray() {
            return rows;
        },
    };
    return cursor;
}

function unused(name: string): never {
    throw new Error(`${name} is outside the training edit path`);
}

const problemApi = {
    assertProblemAclDomain() {
        return undefined;
    },
};

const trainingApi = {
    async add(
        readDomain: string,
        title: string,
        content: string,
        owner: number,
        dag: StageNode[],
        description: string,
        pin: number,
    ) {
        addCalls.push({
            domainId: readDomain,
            title,
            content,
            owner,
            dag,
            description,
            pin,
        });
        return createdId;
    },
    async edit(readDomain: string, tid: ObjectId, set: Record<string, unknown>) {
        editCalls.push({
            domainId: readDomain,
            tid: String(tid),
            title: set.title,
            content: set.content,
            description: set.description,
            pin: set.pin,
            dag: Array.isArray(set.dag) ? (set.dag as StageNode[]) : [],
        });
    },
    async get(readDomain: string, tid: ObjectId) {
        if (readDomain !== domainId || !currentTraining || String(currentTraining.docId) !== String(tid)) {
            throw new Error(`missing training ${readDomain}/${String(tid)}`);
        }
        return currentTraining;
    },
    getPids(dag: readonly { pids?: number[] }[] = []) {
        return stagePids(dag);
    },
    async setProblemSetAudience(...args: unknown[]) {
        audienceCalls.push(args);
    },
};

const documentApi = {
    TYPE_PROBLEM: 10,
    getMulti(_readDomain: string, _docType: number, query: unknown) {
        return problemCursor(readDocIds(query));
    },
};

function trainingStub(request: string): unknown | undefined {
    if (request === '../model/problem') return { __esModule: true, default: problemApi };
    if (request === '../model/problem-access') {
        return {
            __esModule: true,
            async assertProblemBankSelection(readDomain: string, pids: number[], _user: unknown, existing: number[] = []) {
                bankCalls.push({ domainId: readDomain, pids: [...pids], existing: [...existing] });
            },
        };
    }
    if (request === '../model/training') return { __esModule: true, ...trainingApi };
    if (request === '../model/problem-set-access') {
        return {
            __esModule: true,
            canManageProblemSet() {
                return true;
            },
            problemSetAccessService: {
                async assertAccessible() {
                    unused('problemSetAccessService.assertAccessible');
                },
            },
        };
    }
    if (request === '../model/contextual-completion') return { __esModule: true, contextualCompletionService: {} };
    if (request === '../model/oplog') return { __esModule: true, async log() { return undefined; } };
    if (request === '../model/practice-integrity') return { __esModule: true, practiceIntegrityService: {} };
    if (request === '../model/storage') return { __esModule: true, default: {} };
    if (request === '../model/system') return { __esModule: true, default: { get: () => 0 } };
    if (request === '../model/user') return { __esModule: true, default: {} };
    if (request === '../service/server') {
        return {
            __esModule: true,
            Handler: class Handler {},
            param,
            post: postParam,
            Types,
        };
    }
    if (request === '../service/student-directory') {
        return { __esModule: true, studentDirectory: () => unused('studentDirectory') };
    }
    if (request === './problem-reference') {
        return {
            __esModule: true,
            normalizeProblemDocIds,
            async getVisibleReferencedProblems() {
                unused('getVisibleReferencedProblems');
            },
        };
    }
    if (request === '../lib/practice-roster-load') {
        return { __esModule: true, async loadCompletedPidsByUid() { return new Map<number, Set<number>>(); } };
    }
    if (request === '../logger') {
        return {
            __esModule: true,
            logger: {
                info(...args: unknown[]) {
                    infoCalls.push(args);
                },
            },
        };
    }
    return undefined;
}

moduleApi._load = function load(request, parent, isMain) {
    if (isParent(parent, trainingFile)) {
        const stub = trainingStub(request);
        if (stub !== undefined) return stub;
    }
    if (isParent(parent, kindsFile) && request === '../model/document') return { __esModule: true, ...documentApi };
    return originalLoad.call(this, request, parent, isMain);
};

try {
    delete requireFromTest.cache[trainingFile];
    const loaded = requireFromTest('../src/handler/training.ts') as TrainingHandlerModule;
    void loaded.apply({
        Route(name, _path, HandlerClass) {
            routes.set(name, HandlerClass);
        },
    });
} finally {
    moduleApi._load = originalLoad;
}

function makeUser(): TestUser {
    const perms = new Set<bigint>([PERM.PERM_CREATE_TRAINING]);
    return {
        _id: ownerUid,
        hasPerm: (...wanted: bigint[]) => wanted.every((item) => perms.has(item)),
        hasPriv: () => false,
        own: (doc) => doc.owner === ownerUid,
    };
}

function makeHandler(): TrainingEditor {
    const HandlerClass = routes.get('training_edit');
    if (!HandlerClass) throw new TypeError('training edit handler was not registered');
    const user = makeUser();
    const handler = new HandlerClass();
    handler.user = user;
    handler.domain = { _id: domainId };
    handler.response = {};
    handler.checkPerm = (...wanted: bigint[]) => {
        if (!user.hasPerm(...wanted)) throw new Error('missing training create permission');
    };
    handler.checkPriv = () => {
        throw new Error('privilege check was not expected');
    };
    handler.url = () => '/problem-sets/next';
    return handler;
}

function dagJson(nodes: StageNode[]): string {
    return JSON.stringify(nodes);
}

function stage(overrides: Partial<StageNode> = {}): StageNode {
    return {
        _id: 1,
        title: '阶段',
        requireNids: [],
        pids: [],
        ...overrides,
    };
}

async function postTraining(handler: TrainingEditor, rawArgs: Record<string, unknown>): Promise<void> {
    await handler.prepare({ domainId, ...rawArgs });
    await handler.post({ domainId, pin: 0, ...rawArgs });
}

async function capture(work: Promise<unknown>): Promise<unknown> {
    try {
        await work;
        return undefined;
    } catch (error) {
        return error;
    }
}

function failureDetail(error: unknown): string {
    if (error === undefined) return 'success';
    if (error instanceof ValidationError) return `${error.message} params=${JSON.stringify(error.params)}`;
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    return String(error);
}

function expectSaveLog(created: boolean, stageCount: number, problemCount: number, tid: ObjectId): void {
    expect(infoCalls.length).to.equal(1);
    const [message, loggedDomain, uid, loggedTid, loggedStages, loggedProblems, loggedCreated] = infoCalls[0];
    expect(String(message).includes('result=success')).to.equal(true);
    expect(loggedDomain).to.equal(domainId);
    expect(uid).to.equal(ownerUid);
    expect(String(loggedTid)).to.equal(tid.toHexString());
    expect(loggedStages).to.equal(stageCount);
    expect(loggedProblems).to.equal(problemCount);
    expect(loggedCreated).to.equal(created);
}

beforeEach(() => {
    bankCalls.length = 0;
    addCalls.length = 0;
    editCalls.length = 0;
    audienceCalls.length = 0;
    infoCalls.length = 0;
    problems = [
        { docId: subjectiveDocId, pid: 'S3', title: '论述', problemKind: 'subjective' },
        { docId: trueFalseDocId, pid: 'T4', title: '判断', problemKind: 'true_false' },
    ];
    currentTraining = null;
});

after(() => {
    moduleApi._load = originalLoad;
});

describe('training edit handler', () => {
    it('creates an empty shell when content, description and stage problems are absent', async () => {
        const handler = makeHandler();
        const error = await capture(postTraining(handler, {
            title: '空壳练习',
            dag: emptyDag,
        }));
        expect(error, failureDetail(error)).to.equal(undefined);
        expect(addCalls.length).to.equal(1);
        expect(editCalls.length).to.equal(0);
        expect(audienceCalls.length).to.equal(0);
        expect(addCalls[0]).to.deep.equal({
            domainId,
            title: '空壳练习',
            content: '',
            owner: ownerUid,
            description: '',
            pin: 0,
            dag: [{ _id: 1, title: '', requireNids: [], pids: [] }],
        });
        expect(bankCalls).to.deep.equal([{ domainId, pids: [], existing: [] }]);
        expect(String(handler.response.body?.tid)).to.equal(createdId.toHexString());
        expectSaveLog(true, 1, 0, createdId);
    });

    it('rejects a stage that lists itself as a prerequisite', async () => {
        const handler = makeHandler();
        const error = await capture(postTraining(handler, {
            title: '阶段练习',
            content: '正文',
            description: '简介',
            dag: dagJson([stage({ requireNids: [1], pids: [trueFalseDocId] })]),
        }));
        if (!(error instanceof ValidationError)) {
            throw new Error(`self prerequisite should be rejected, got ${failureDetail(error)}`);
        }
        expect(error.params[0]).to.equal('dag');
        expect(String(error.params[2]).includes('1')).to.equal(true);
        expect(addCalls.length).to.equal(0);
        expect(infoCalls.length).to.equal(0);
    });

    it('rejects a prerequisite stage that does not exist', async () => {
        const handler = makeHandler();
        const error = await capture(postTraining(handler, {
            title: '阶段练习',
            content: '正文',
            description: '简介',
            dag: dagJson([stage({ requireNids: [9], pids: [trueFalseDocId] })]),
        }));
        if (!(error instanceof ValidationError)) {
            throw new Error(`missing stage prerequisite should be rejected, got ${failureDetail(error)}`);
        }
        expect(error.params[0]).to.equal('dag');
        expect(String(error.params[2]).includes('9')).to.equal(true);
        expect(addCalls.length).to.equal(0);
    });

    it('rejects a newly added subjective problem', async () => {
        const handler = makeHandler();
        const error = await capture(postTraining(handler, {
            title: '阶段练习',
            content: '正文',
            description: '简介',
            dag: dagJson([stage({ pids: [subjectiveDocId] })]),
        }));
        if (!(error instanceof ValidationError)) {
            throw new Error(`new subjective problem should be rejected, got ${failureDetail(error)}; adds=${addCalls.length}`);
        }
        expect(error.params[0]).to.equal('pids');
        expect(String(error.params[2]).includes('主观题')).to.equal(true);
        expect(addCalls.length).to.equal(0);
        expect(bankCalls).to.deep.equal([{ domainId, pids: [subjectiveDocId], existing: [] }]);
    });

    it('accepts a newly added true or false problem', async () => {
        const handler = makeHandler();
        const error = await capture(postTraining(handler, {
            title: '阶段练习',
            content: '正文',
            description: '简介',
            dag: dagJson([stage({ pids: [trueFalseDocId] })]),
        }));
        expect(error, failureDetail(error)).to.equal(undefined);
        expect(addCalls.length).to.equal(1);
        expect(addCalls[0].dag).to.deep.equal([stage({ pids: [trueFalseDocId] })]);
        expect(bankCalls).to.deep.equal([{ domainId, pids: [trueFalseDocId], existing: [] }]);
        expect(String(handler.response.body?.tid)).to.equal(createdId.toHexString());
    });

    it('does not reject a subjective problem that is already in the set', async () => {
        currentTraining = {
            docId: keptId,
            kind: 'problem_set',
            owner: ownerUid,
            pin: 0,
            title: '已有练习',
            content: '旧正文',
            description: '旧简介',
            dag: [stage({ pids: [subjectiveDocId] })],
        };
        const handler = makeHandler();
        const error = await capture(postTraining(handler, {
            tid: keptId.toHexString(),
            title: '已有练习',
            content: '旧正文',
            description: '旧简介',
            dag: dagJson([stage({ pids: [subjectiveDocId] })]),
        }));
        expect(error, failureDetail(error)).to.equal(undefined);
        expect(addCalls.length).to.equal(0);
        expect(editCalls.length).to.equal(1);
        expect(editCalls[0].domainId).to.equal(domainId);
        expect(editCalls[0].tid).to.equal(keptId.toHexString());
        expect(editCalls[0].dag).to.deep.equal([stage({ pids: [subjectiveDocId] })]);
        expect(bankCalls).to.deep.equal([{ domainId, pids: [subjectiveDocId], existing: [subjectiveDocId] }]);
        expectSaveLog(false, 1, 1, keptId);
    });

    it('still requires at least one stage', async () => {
        const handler = makeHandler();
        const error = await capture(postTraining(handler, {
            title: '阶段练习',
            content: '正文',
            description: '简介',
            dag: '[]',
        }));
        if (!(error instanceof ValidationError)) {
            throw new Error(`empty stage list should be rejected, got ${failureDetail(error)}`);
        }
        expect(error.params[0]).to.equal('dag');
        expect(String(error.params[2]).includes('at least one node')).to.equal(true);
        expect(addCalls.length).to.equal(0);
    });

    it('still requires unique stage ids', async () => {
        const handler = makeHandler();
        const error = await capture(postTraining(handler, {
            title: '阶段练习',
            content: '正文',
            description: '简介',
            dag: dagJson([
                stage({ pids: [trueFalseDocId] }),
                stage({ title: '另一阶段', pids: [trueFalseDocId] }),
            ]),
        }));
        if (!(error instanceof ValidationError)) {
            throw new Error(`duplicated stage id should be rejected, got ${failureDetail(error)}`);
        }
        expect(error.params[0]).to.equal('dag');
        expect(String(error.params[2]).includes('unique')).to.equal(true);
        expect(addCalls.length).to.equal(0);
    });

    it('rejects a stage whose problem list is not an array', async () => {
        const handler = makeHandler();
        const error = await capture(postTraining(handler, {
            title: '阶段练习',
            content: '正文',
            description: '简介',
            dag: '[{"_id":1,"title":"阶段","requireNids":[],"pids":null}]',
        }));
        if (!(error instanceof ValidationError)) {
            throw new Error(`non-array stage problems should be rejected, got ${failureDetail(error)}`);
        }
        expect(addCalls.length).to.equal(0);
    });
});
