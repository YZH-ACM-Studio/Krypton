import { createRequire, type Module as NodeModule } from 'node:module';
import { after, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PERM, PRIV } from '@hydrooj/common/permission';
import { expect } from 'chai';

// Globals must exist before hydrooj modules load. Static imports of those
// modules would run first, so they are required below.
const hydroHost = globalThis as unknown as {
    Hydro?: {
        model: Record<string, unknown>;
        script: Record<string, unknown>;
        module: Record<string, unknown>;
        ui: Record<string, unknown>;
        error: Record<string, unknown>;
        locales: Record<string, unknown>;
    };
    app?: {
        get: (name: string) => { collection: () => Record<string, unknown> } | undefined;
        parallel: () => undefined;
        serial: () => undefined;
        on: () => undefined;
        emit: () => undefined;
        events: { dispatch: () => unknown[] };
    };
};
hydroHost.Hydro ||= {
    model: {},
    script: {},
    module: new Proxy({}, {
        get(self: Record<string, unknown>, key: string) {
            self[key] ||= {};
            return self[key];
        },
    }) as Record<string, unknown>,
    ui: {},
    error: {},
    locales: {},
};
hydroHost.app ||= {
    get(name: string) {
        if (name !== 'db') return undefined;
        return {
            collection() {
                return {
                    createIndex() {
                        return undefined;
                    },
                    find() {
                        return { toArray: async () => [] };
                    },
                    findOne() {
                        return null;
                    },
                    updateMany() {
                        return { modifiedCount: 0 };
                    },
                };
            },
        };
    },
    parallel() {
        return undefined;
    },
    serial() {
        return undefined;
    },
    on() {
        return undefined;
    },
    emit() {
        return undefined;
    },
    events: {
        dispatch() {
            return [];
        },
    },
};

// This line matches @hydrooj/register's CJS strip so __filename stays defined.
const __filename = fileURLToPath(import.meta.url);
const requireFromTest = createRequire(__filename);

const DOMAIN = 'school-domain';
const FORGED_DOMAIN = 'forged-domain';
const ROUTE_NAME = 'problem_school_bank';
const ROUTE_PATH = '/problem/school-bank';
const HANDLER_SPECIFIER = '../src/handler/problem-school-bank.ts';

type UserKind = 'teacher' | 'student' | 'viewer' | 'admin';

interface BankUser {
    _id: number;
    _problemAclLoaded: boolean;
    _pidNamespaceAclLoaded: boolean;
    _problemAclDomainId: string;
    _pidNamespaceAclDomainId: string;
    _ownsLegacyProblems: boolean;
    _authoredPids: Set<number>;
    _maintainedPids: Set<number>;
    _dataContributionPids: Set<number>;
    _tagContributionPids: Set<number>;
    _pidNamespaceManagerIds: Set<string>;
    _pidNamespaceEditAllIds: Set<string>;
    hasPerm: (...wanted: bigint[]) => boolean;
    hasPriv: (...wanted: number[]) => boolean;
}

interface BankCall {
    domainId: string;
    actor: unknown;
    docIds: unknown;
    shared: unknown;
}

interface TraceStep {
    kind: 'refresh' | 'assert' | 'set';
    domainId: string;
    user: unknown;
}

interface BankResult {
    changed: number[];
    unchanged: number[];
}

interface RequestStub {
    json: boolean;
    method: string;
    body: Record<string, unknown>;
    query: Record<string, unknown>;
    params: Record<string, unknown>;
    headers: Record<string, unknown>;
}

interface SchoolBankHandler {
    domain: { _id: string };
    user: BankUser;
    response: { body?: unknown; template?: string | null };
    request: RequestStub;
    args: Record<string, unknown>;
    post?: (rawArgs: Record<string, unknown>) => Promise<unknown>;
    get?: (...methodArgs: unknown[]) => Promise<unknown>;
    checkPerm: (...perms: bigint[]) => void;
    checkPriv: (...privs: number[]) => void;
}

type HandlerConstructor = new (...ctorArgs: unknown[]) => SchoolBankHandler;

interface RouteRecord {
    name: string;
    path: string;
    Handler: HandlerConstructor;
}

interface ApplyContext {
    Route: (name: string, routePath: string, Handler: HandlerConstructor, ...rest: unknown[]) => void;
    inject: (deps: unknown, callback: (inner: ApplyContext) => unknown) => unknown;
}

interface ModuleLoad {
    _load: (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
}

interface ProblemAccessModule {
    canBrowseProblemBank: (user: BankUser) => boolean;
}

const errorModule = requireFromTest('../src/error') as typeof import('../src/error');
const { PermissionError } = errorModule;
const accessModule = requireFromTest('../src/model/problem-access.ts') as ProblemAccessModule;
const realBrowse = accessModule.canBrowseProblemBank.bind(accessModule);

const trace: TraceStep[] = [];
const bankCalls: BankCall[] = [];
let bankResult: BankResult = { changed: [], unchanged: [] };
let bankError: unknown = null;
let cachedHandler: HandlerConstructor | null = null;

const problemFacade = {
    async refreshProblemAcl(user: unknown, domainId: string) {
        trace.push({ kind: 'refresh', domainId: String(domainId), user });
    },
    assertProblemAclDomain(user: unknown, domainId: string) {
        trace.push({ kind: 'assert', domainId: String(domainId), user });
    },
    canBrowseProblemBank(user: BankUser) {
        return realBrowse(user);
    },
};

const schoolBankFacade = {
    async setProblemSchoolBank(domainId: string, actor: unknown, docIds: unknown, shared: unknown) {
        trace.push({ kind: 'set', domainId: String(domainId), user: actor });
        bankCalls.push({
            domainId: String(domainId),
            actor,
            docIds: Array.isArray(docIds) ? [...docIds] : docIds,
            shared,
        });
        if (bankError) throw bankError;
        return bankResult;
    },
};

function esModule(methods: Record<string, unknown>): Record<string, unknown> {
    return {
        __esModule: true,
        ...methods,
        default: methods,
    };
}

function handlerFilename(parent: NodeModule | null | undefined): boolean {
    const filename = parent?.filename?.replace(/\\/g, '/');
    return filename?.endsWith('/src/handler/problem-school-bank.ts') === true;
}

function modelKind(request: string): 'problem' | 'access' | 'bank' | null {
    const normalized = request.replace(/\\/g, '/').replace(/\.(ts|js)$/, '');
    if (normalized === '../model/problem' || normalized.endsWith('/model/problem')) return 'problem';
    if (normalized === '../model/problem-access' || normalized.endsWith('/model/problem-access')) return 'access';
    if (normalized === '../model/problem-school-bank' || normalized.endsWith('/model/problem-school-bank')) return 'bank';
    return null;
}

const moduleApi = requireFromTest('node:module') as ModuleLoad;
const originalLoad = moduleApi._load;
moduleApi._load = function load(request: string, parent: NodeModule | null | undefined, isMain: boolean) {
    if (!handlerFilename(parent)) return originalLoad.call(this, request, parent, isMain);
    const kind = modelKind(request);
    if (kind === 'problem' || kind === 'access') return esModule(problemFacade);
    if (kind === 'bank') return esModule(schoolBankFacade);
    return originalLoad.call(this, request, parent, isMain);
};

after(() => {
    moduleApi._load = originalLoad;
});

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function makeUser(kind: UserKind): BankUser {
    const perms = new Set<bigint>([PERM.PERM_VIEW_PROBLEM]);
    if (kind === 'teacher') perms.add(PERM.PERM_CREATE_PROBLEM);
    if (kind === 'viewer') perms.add(PERM.PERM_VIEW_PROBLEM_BANK);
    return {
        _id: kind === 'admin' ? 3 : kind === 'student' ? 8 : 42,
        _problemAclLoaded: true,
        _pidNamespaceAclLoaded: true,
        _problemAclDomainId: DOMAIN,
        _pidNamespaceAclDomainId: DOMAIN,
        _ownsLegacyProblems: false,
        _authoredPids: new Set<number>(),
        _maintainedPids: new Set<number>(),
        _dataContributionPids: new Set<number>(),
        _tagContributionPids: new Set<number>(),
        _pidNamespaceManagerIds: new Set<string>(),
        _pidNamespaceEditAllIds: new Set<string>(),
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => perms.has(perm)),
        hasPriv: (...wanted: number[]) => kind === 'admin' && wanted.includes(PRIV.PRIV_EDIT_SYSTEM),
    };
}

function createHandler(HandlerClass: HandlerConstructor, user: BankUser): SchoolBankHandler {
    const response: { body?: unknown; template?: string | null } = {};
    const request: RequestStub = {
        json: true,
        method: 'POST',
        body: {},
        query: {},
        params: {},
        headers: {},
    };
    const args: Record<string, unknown> = { domainId: FORGED_DOMAIN };
    const context = {
        session: {},
        HydroContext: {
            args,
            request,
            response,
            UiContext: {},
        },
    };
    const handler = new HandlerClass(context, {});
    handler.domain = { _id: DOMAIN };
    handler.user = user;
    handler.checkPerm = (...perms: bigint[]) => {
        if (!user.hasPerm(...perms)) throw new PermissionError(...perms);
    };
    handler.checkPriv = (...privs: number[]) => {
        if (!user.hasPriv(...privs)) throw new PermissionError(...privs);
    };
    return handler;
}

async function loadHandler(): Promise<HandlerConstructor> {
    if (cachedHandler) return cachedHandler;
    let filePath = '';
    try {
        filePath = requireFromTest.resolve(HANDLER_SPECIFIER);
    } catch (error) {
        const missing = new TypeError('missing export apply');
        if (error instanceof Error) missing.cause = error;
        throw missing;
    }
    delete requireFromTest.cache[filePath];
    const loaded: unknown = requireFromTest(HANDLER_SPECIFIER);
    if (!isRecord(loaded) || typeof loaded.apply !== 'function') throw new TypeError('missing export apply');
    const found: RouteRecord[] = [];
    const ctx: ApplyContext = {
        Route(name: string, routePath: string, Handler: HandlerConstructor) {
            found.push({ name, path: routePath, Handler });
        },
        inject(_deps: unknown, callback: (inner: ApplyContext) => unknown) {
            return callback(ctx);
        },
    };
    await loaded.apply(ctx);
    const route = found.find((item) => item.name === ROUTE_NAME);
    if (!route || typeof route.Handler !== 'function') throw new TypeError('missing export problem_school_bank');
    expect(route.path).to.equal(ROUTE_PATH);
    expect(found.map((item) => `${item.name} ${item.path}`)).to.deep.equal([`${ROUTE_NAME} ${ROUTE_PATH}`]);
    cachedHandler = route.Handler;
    return route.Handler;
}

async function postBank(user: BankUser, docIds: number[], shared: boolean): Promise<unknown> {
    const HandlerClass = await loadHandler();
    const handler = createHandler(HandlerClass, user);
    const body: Record<string, unknown> = { docIds, shared };
    handler.request.body = body;
    Object.assign(handler.args, body);
    if (typeof handler.post !== 'function') throw new TypeError('missing export post');
    await handler.post(handler.args);
    return handler.response.body;
}

async function rejectionOf(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run();
        return null;
    } catch (error) {
        if (error instanceof TypeError && error.message === 'missing export apply') throw error;
        if (error instanceof TypeError && error.message.startsWith('missing export ')) throw error;
        return error;
    }
}

function expectPrepared(user: BankUser): void {
    expect(trace.map((step) => step.kind)).to.deep.equal(['refresh', 'assert', 'set']);
    for (const step of trace) {
        expect(step.domainId).to.equal(DOMAIN);
        expect(step.user).to.equal(user);
    }
}

beforeEach(() => {
    trace.length = 0;
    bankCalls.length = 0;
    bankResult = { changed: [], unchanged: [] };
    bankError = null;
});

describe('problem school bank handler', () => {
    it('registers only the school bank post route', async () => {
        const HandlerClass = await loadHandler();
        const handler = createHandler(HandlerClass, makeUser('teacher'));
        expect(typeof handler.get).to.equal('undefined');
        expect(typeof handler.post).to.equal('function');
    });

    it('returns the two shared doc ids and forwards shared true', async () => {
        const teacher = makeUser('teacher');
        bankResult = { changed: [11, 12], unchanged: [] };
        const body = await postBank(teacher, [11, 12], true);
        expectPrepared(teacher);
        expect(bankCalls.length).to.equal(1);
        expect(bankCalls[0]?.domainId).to.equal(DOMAIN);
        expect(bankCalls[0]?.actor).to.equal(teacher);
        expect(bankCalls[0]?.docIds).to.deep.equal([11, 12]);
        expect(bankCalls[0]?.shared).to.equal(true);
        expect(isRecord(body)).to.equal(true);
        if (!isRecord(body)) throw new TypeError('school bank response');
        expect(body.changed).to.deep.equal([11, 12]);
        expect(body.unchanged).to.deep.equal([]);
    });

    it('rejects a student before the model is called', async () => {
        const student = makeUser('student');
        const error = await rejectionOf(() => postBank(student, [11, 12], true));
        expect(error instanceof Error ? error.name : '').to.equal('PermissionError');
        expect(trace.map((step) => step.kind)).to.deep.equal(['refresh', 'assert']);
        expect(trace.every((step) => step.domainId === DOMAIN && step.user === student)).to.equal(true);
        expect(bankCalls.length).to.equal(0);
    });

    it('rethrows the model permission error unchanged', async () => {
        const teacher = makeUser('teacher');
        const denied = new PermissionError();
        bankError = denied;
        const error = await rejectionOf(() => postBank(teacher, [11], true));
        expect(error).to.equal(denied);
        expect(bankCalls.length).to.equal(1);
        expect(bankCalls[0]?.shared).to.equal(true);
    });

    it('forwards shared false when a teacher unshares', async () => {
        const teacher = makeUser('teacher');
        bankResult = { changed: [11], unchanged: [12] };
        const body = await postBank(teacher, [11, 12], false);
        expect(bankCalls.length).to.equal(1);
        expect(bankCalls[0]?.shared).to.equal(false);
        expect(bankCalls[0]?.docIds).to.deep.equal([11, 12]);
        expect(bankCalls[0]?.domainId).to.equal(DOMAIN);
        expect(isRecord(body)).to.equal(true);
        if (!isRecord(body)) throw new TypeError('school bank response');
        expect(body.changed).to.deep.equal([11]);
        expect(body.unchanged).to.deep.equal([12]);
    });

    it('rejects a bank viewer who cannot create problems', async () => {
        const viewer = makeUser('viewer');
        const error = await rejectionOf(() => postBank(viewer, [11], true));
        expect(error instanceof Error ? error.name : '').to.equal('PermissionError');
        expect(bankCalls.length).to.equal(0);
        expect(trace.map((step) => step.kind)).to.deep.equal(['refresh', 'assert']);
    });

    it('lets a system administrator share without the create permission', async () => {
        const admin = makeUser('admin');
        bankResult = { changed: [11, 12], unchanged: [] };
        const body = await postBank(admin, [11, 12], true);
        expect(bankCalls.length).to.equal(1);
        expect(bankCalls[0]?.actor).to.equal(admin);
        expect(bankCalls[0]?.shared).to.equal(true);
        expect(bankCalls[0]?.domainId).to.equal(DOMAIN);
        expect(isRecord(body)).to.equal(true);
        if (!isRecord(body)) throw new TypeError('school bank response');
        expect(body.changed).to.deep.equal([11, 12]);
        expect(body.unchanged).to.deep.equal([]);
    });
});
