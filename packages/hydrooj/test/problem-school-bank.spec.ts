import { readFileSync } from 'node:fs';
import { createRequire, type Module as NodeModule } from 'node:module';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { expect } from 'chai';
import { getLocalizedErrorMetadata, PermissionError, ValidationError, type HydroError } from '../src/error';

// Load after the document stub is installed. A static import would bind the
// real document module before that stub exists.
// This line matches @hydrooj/register's CJS strip so __filename stays defined.
const __filename = fileURLToPath(import.meta.url);
const requireFromTest = createRequire(__filename);

const TYPE_PROBLEM = 10;
const DOMAIN = 'school-a';

type UserKind = 'student' | 'creator' | 'draft-creator' | 'hidden-viewer' | 'bank-viewer' | 'admin';

interface AclUser {
    _id: number;
    role: string;
    _permitPids: Set<number>;
    _authoredPids: Set<number>;
    _maintainedPids: Set<number>;
    _dataContributionPids: Set<number>;
    _tagContributionPids: Set<number>;
    _aclFencedPids: Set<number>;
    _ownsLegacyProblems: boolean;
    _managedContainerPids: Set<number>;
    _problemAclDomainId: string;
    _problemAclLoaded: boolean;
    _pidNamespaceAuthorIds: Set<string>;
    _pidNamespaceManagerIds: Set<string>;
    _pidNamespaceEditAllIds: Set<string>;
    _pidNamespaceAclDomainId: string;
    _pidNamespaceAclLoaded: boolean;
    hasPerm: (...wanted: bigint[]) => boolean;
    hasPriv: (...wanted: number[]) => boolean;
}

interface BankActor {
    _id: number;
    hasPriv: (...wanted: number[]) => boolean;
}

interface SchoolBankModule {
    isProblemInSchoolBank: (pdoc: { schoolBank?: unknown }) => boolean;
    canToggleProblemSchoolBank: (actor: BankActor, pdoc: { owner: number; authoringMode?: unknown }) => boolean;
    setProblemSchoolBank: (
        domainId: string,
        actor: BankActor,
        docIds: number[],
        shared: boolean,
    ) => Promise<{ changed: number[]; unchanged: number[] }>;
    listSchoolBankDocIds: (domainId: string, docIds: number[]) => Promise<number[]>;
}

interface WriteCall {
    method: string;
    filter: unknown;
    update: unknown;
}

interface AccessModule {
    buildProblemBankScope: (user: AclUser) => unknown;
    buildProblemContainerSelectionScope: (user: AclUser) => unknown;
    canViewProblem: (user: AclUser, pdoc: Record<string, unknown>) => boolean;
}

interface ProblemFacade {
    get: (
        domainId: string,
        pid: string | number,
        projection?: readonly string[],
    ) => Promise<Record<string, unknown> | null>;
    getViewableAuthorized: (
        domainId: string,
        pid: string | number,
        user: AclUser,
        projection?: readonly string[],
    ) => Promise<Record<string, unknown> | null>;
    canViewBy: (pdoc: Record<string, unknown>, user: AclUser) => boolean;
    PROJECTION_LIST: readonly string[];
    PROJECTION_PUBLIC: readonly string[];
}

const BANK_EXPORTS = ['isProblemInSchoolBank', 'canToggleProblemSchoolBank', 'setProblemSchoolBank', 'listSchoolBankDocIds'] as const;

const OWN_LEGACY_SCOPE = {
    $and: [
        { $and: [{ owner: 42 }, { authoringMode: { $ne: 'managed' } }] },
        { 'aclMutationLocks.uid': { $ne: 42 } },
    ],
};
const PUBLIC_SCOPE = {
    $and: [{ hidden: { $ne: true } }, { 'aclMutationLocks.uid': { $ne: 42 } }],
};
const DENY_SCOPE = { docId: { $in: [] } };
const ADMIN_SCOPE = { 'aclMutationLocks.uid': { $ne: 42 } };
const ADMIN_FENCED_SCOPE = {
    $and: [{ docId: { $nin: [101, 103] } }, { 'aclMutationLocks.uid': { $ne: 42 } }],
};
const MISSING_SENTENCE = '题目不存在或已归档';
const SHARE_DENIED = '你不能修改这些题目的学校题库共享。';
const PROBLEM_MODEL_SOURCE = readFileSync(path.join(path.dirname(__filename), '../src/model/problem.ts'), 'utf8');

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ensureHydro() {
    const host = globalThis as unknown as { Hydro?: Record<string, unknown> };
    if (!host.Hydro) host.Hydro = {};
    const hydro = host.Hydro;
    if (!isRecord(hydro.model)) hydro.model = {};
    if (!isRecord(hydro.ui)) hydro.ui = {};
    if (!isRecord(hydro.script)) hydro.script = {};
    if (!isRecord(hydro.error)) hydro.error = {};
    if (!isRecord(hydro.locales)) hydro.locales = {};
    if (!isRecord(hydro.module)) {
        const modules: Record<string, Record<string, unknown>> = {};
        hydro.module = new Proxy(modules, {
            get(self, key) {
                if (typeof key !== 'string') return undefined;
                if (!self[key]) self[key] = {};
                return self[key];
            },
        });
    }
}

ensureHydro();

const { PERM, PRIV } = requireFromTest('../src/model/builtin.ts') as {
    PERM: {
        PERM_CREATE_PROBLEM: bigint;
        PERM_VIEW_PROBLEM: bigint;
        PERM_VIEW_PROBLEM_BANK: bigint;
        PERM_VIEW_PROBLEM_HIDDEN: bigint;
        PERM_CREATE_PROGRAMMING_DRAFT: bigint;
    };
    PRIV: { PRIV_EDIT_SYSTEM: number };
};

const infoCalls: unknown[][] = [];
const problems: Record<string, unknown>[] = [];
const writes: WriteCall[] = [];
const moduleLoader = requireFromTest('node:module') as { _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown };
const originalLoad = moduleLoader._load;
const documentPath = requireFromTest.resolve('../src/model/document.ts');
const previousDocument = requireFromTest.cache[documentPath];
let accessModule: AccessModule | null = null;
let schoolBank: SchoolBankModule | null = null;
let problemModel: ProblemFacade | null = null;

class RecordingLogger {
    info(...args: unknown[]) {
        infoCalls.push(args);
    }

    warn() {}

    error() {}

    debug() {}
}

const sharedLogger = new RecordingLogger();

function clone<T>(value: T): T {
    return structuredClone(value);
}

function matchesValue(actual: unknown, expected: unknown): boolean {
    if (!isRecord(expected) || expected instanceof Date) return Object.is(actual, expected);
    let sawOperator = false;
    let ok = true;
    if (Object.hasOwn(expected, '$in')) {
        sawOperator = true;
        const list = expected.$in;
        ok = ok && Array.isArray(list) && list.some((item) => Object.is(item, actual));
    }
    if (Object.hasOwn(expected, '$nin')) {
        sawOperator = true;
        const list = expected.$nin;
        ok = ok && Array.isArray(list) && !list.some((item) => Object.is(item, actual));
    }
    if (Object.hasOwn(expected, '$ne')) {
        sawOperator = true;
        ok = ok && !Object.is(actual, expected.$ne);
    }
    if (Object.hasOwn(expected, '$exists')) {
        sawOperator = true;
        ok = ok && (actual !== undefined) === Boolean(expected.$exists);
    }
    if (Object.hasOwn(expected, '$eq')) {
        sawOperator = true;
        ok = ok && Object.is(actual, expected.$eq);
    }
    return sawOperator && ok;
}

function readPath(doc: Record<string, unknown>, key: string): unknown {
    if (!key.includes('.')) return doc[key];
    let cursor: unknown = doc;
    for (const part of key.split('.')) {
        if (!isRecord(cursor) || !Object.hasOwn(cursor, part)) return undefined;
        cursor = cursor[part];
    }
    return cursor;
}

function matchesQuery(doc: Record<string, unknown>, query: unknown): boolean {
    if (!isRecord(query)) return false;
    if (Array.isArray(query.$and) && !query.$and.every((part) => matchesQuery(doc, part))) return false;
    if (Array.isArray(query.$or) && !query.$or.some((part) => matchesQuery(doc, part))) return false;
    for (const [key, expected] of Object.entries(query)) {
        if (key === '$and' || key === '$or') continue;
        if (!matchesValue(readPath(doc, key), expected)) return false;
    }
    return true;
}

function rememberWrite(method: string, filter: unknown, update: unknown) {
    writes.push({ method, filter: clone(filter), update: clone(update) });
}

function projectionNames(projection: unknown): string[] | null {
    if (Array.isArray(projection)) {
        return projection.filter((field): field is string => typeof field === 'string' && field !== '_id');
    }
    if (!isRecord(projection)) return null;
    return Object.entries(projection)
        .filter(([key, included]) => key !== '_id' && Boolean(included))
        .map(([key]) => key);
}

// document.get applies an inclusion projection. Contest statements call
// problem.get with PROJECTION_PUBLIC, which does not ask for schoolBank.
function projectedDoc(doc: Record<string, unknown>, projection: unknown): Record<string, unknown> {
    const names = projectionNames(projection);
    if (!names) return clone(doc);
    const projected: Record<string, unknown> = {};
    if (Object.hasOwn(doc, '_id')) projected._id = clone(doc._id);
    for (const field of names) {
        if (!Object.hasOwn(doc, field)) continue;
        projected[field] = clone(doc[field]);
    }
    return projected;
}

function cursorFor(filter: unknown) {
    const cursor = {
        project() {
            return cursor;
        },
        sort() {
            return cursor;
        },
        limit() {
            return cursor;
        },
        async toArray() {
            return problems.filter((doc) => matchesQuery(doc, filter)).map((doc) => clone(doc));
        },
    };
    return cursor;
}

const documentStub = {
    TYPE_PROBLEM,
    TYPE_CONTEST: 30,
    TYPE_TRAINING: 40,
    coll: {
        find(filter: unknown) {
            return cursorFor(filter);
        },
        async findOne(filter: unknown) {
            const found = problems.find((doc) => matchesQuery(doc, filter));
            return found ? clone(found) : null;
        },
        async updateMany(filter: unknown, update: unknown) {
            rememberWrite('updateMany', filter, update);
            return { matchedCount: 0, modifiedCount: 0 };
        },
        async updateOne(filter: unknown, update: unknown) {
            rememberWrite('updateOne', filter, update);
            return { matchedCount: 0, modifiedCount: 0 };
        },
        async findOneAndUpdate(filter: unknown, update: unknown) {
            rememberWrite('findOneAndUpdate', filter, update);
            return null;
        },
        async bulkWrite(ops: unknown[]) {
            rememberWrite('bulkWrite', ops, ops);
            return { ok: 1 };
        },
    },
    async get(domainId: string, docType: number, docId: unknown, projection?: unknown) {
        const found = problems.find((doc) => matchesQuery(doc, { domainId, docType, docId }));
        return found ? projectedDoc(found, projection) : null;
    },
    getMulti(domainId: string, docType: number, query?: unknown) {
        const filter = { ...(isRecord(query) ? query : {}), domainId, docType };
        return cursorFor(filter);
    },
    async set(domainId: string, docType: number, docId: unknown, $set?: unknown, $unset?: unknown) {
        rememberWrite('set', { domainId, docType, docId }, { $set, $unset });
        return null;
    },
};

function isSchoolBankParent(parent: NodeModule | null): boolean {
    return Boolean(parent?.filename?.endsWith(`${path.sep}problem-school-bank.ts`));
}

function isLoggerRequest(request: string): boolean {
    return request === '../logger' || request === './logger' || request.endsWith('/logger') || request.endsWith('/logger.ts');
}

const pidNamespaceStub = {
    async loadPidNamespaceAclForUser() {
        return {
            authorNamespaceIds: new Set<string>(),
            managerNamespaceIds: new Set<string>(),
            editAllNamespaceIds: new Set<string>(),
        };
    },
    pidNamespaceCapabilityForProblem(user: AclUser, problemDoc: { pidNamespaceId?: string; authoringMode?: string; hidden?: boolean; archivedAt?: unknown; managedAuthoring?: { metadataStatus?: string } }, capability: string) {
        if (user._pidNamespaceEditAllIds.has(problemDoc.pidNamespaceId ?? '') && ['content', 'metadata', 'data', 'tag'].includes(capability)) {
            return 'editAll';
        }
        if (
            user._pidNamespaceManagerIds.has(problemDoc.pidNamespaceId ?? '')
            && problemDoc.authoringMode === 'managed'
            && problemDoc.hidden === true
            && !problemDoc.archivedAt
            && ['draft', 'confirmed'].includes(problemDoc.managedAuthoring?.metadataStatus ?? '')
            && ['metadata', 'tag', 'publish'].includes(capability)
        ) {
            return 'manager';
        }
        return null;
    },
    async withPidNamespaceBoundary(_domainId: string, _namespaceId: string, work: () => Promise<unknown>) {
        return work();
    },
};

const managedAuthoringStub = {
    async materializeKnowledgeMindmapTags() {
        return { mapId: '', nodeIds: [], tags: [] };
    },
    async canonicalizeManagedDraftMindmapPatch() {
        return null;
    },
};

function installLoadHook() {
    moduleLoader._load = function load(request: string, parent: NodeModule | null, isMain: boolean) {
        if (request === './problem-pid-namespace' || request === './problem-pid-namespace.ts') return pidNamespaceStub;
        if (request === './managed-problem-authoring' || request === './managed-problem-authoring.ts') return managedAuthoringStub;
        if (isSchoolBankParent(parent) && (request === './problem' || request === './problem.ts')) {
            const edit = async (domainId: string, docId: number, $set?: unknown) => {
                rememberWrite('problem.edit', { domainId, docId }, { $set });
                return {};
            };
            const model = { edit };
            return { __esModule: true, default: model, ProblemModel: model };
        }
        const loaded = originalLoad.call(this, request, parent, isMain);
        if (!isSchoolBankParent(parent)) return loaded;
        if (isLoggerRequest(request)) return { __esModule: true, Logger: RecordingLogger, logger: sharedLogger };
        if (request !== '@hydrooj/utils' && request !== '@hydrooj/utils/lib/utils') return loaded;
        return new Proxy(loaded as object, {
            get(target, key, receiver) {
                if (key === 'Logger') return RecordingLogger;
                if (key === 'logger') return sharedLogger;
                return Reflect.get(target, key, receiver);
            },
        });
    };
}

function installStubs() {
    requireFromTest.cache[documentPath] = {
        id: documentPath,
        filename: documentPath,
        loaded: true,
        exports: documentStub,
    } as NodeModule;
    installLoadHook();
}

installStubs();

after(() => {
    moduleLoader._load = originalLoad;
    if (previousDocument) requireFromTest.cache[documentPath] = previousDocument;
    else delete requireFromTest.cache[documentPath];
});

function loadAccess(): AccessModule {
    if (accessModule) return accessModule;
    const loaded = requireFromTest('../src/model/problem-access.ts') as Partial<AccessModule>;
    if (typeof loaded.buildProblemContainerSelectionScope !== 'function') {
        throw new TypeError('missing export buildProblemContainerSelectionScope');
    }
    if (typeof loaded.buildProblemBankScope !== 'function') throw new TypeError('missing export buildProblemBankScope');
    if (typeof loaded.canViewProblem !== 'function') throw new TypeError('missing export canViewProblem');
    accessModule = loaded as AccessModule;
    return accessModule;
}

function ensureApp(): void {
    const host = globalThis as unknown as { app?: Record<string, unknown> };
    if (host.app) return;
    const collection = {
        find() {
            return { toArray: async () => [] };
        },
        async findOne() {
            return null;
        },
    };
    host.app = {
        get(name: string) {
            if (name === 'db') return { collection: () => collection };
            return undefined;
        },
        parallel() {},
        on() {},
        emit() {},
        events: { dispatch() { return []; } },
    };
}

function loadProblem(): ProblemFacade {
    if (problemModel) return problemModel;
    ensureApp();
    const loaded = requireFromTest('../src/model/problem.ts') as { default?: ProblemFacade } & Partial<ProblemFacade>;
    const model = loaded.default && typeof loaded.default.getViewableAuthorized === 'function' ? loaded.default : (loaded as ProblemFacade);
    if (typeof model.get !== 'function') throw new TypeError('missing export get');
    if (typeof model.getViewableAuthorized !== 'function') throw new TypeError('missing export getViewableAuthorized');
    if (typeof model.canViewBy !== 'function') throw new TypeError('missing export canViewBy');
    if (!Array.isArray(model.PROJECTION_LIST)) throw new TypeError('missing PROJECTION_LIST');
    if (!Array.isArray(model.PROJECTION_PUBLIC)) throw new TypeError('missing PROJECTION_PUBLIC');
    problemModel = model;
    return model;
}

function installAclReload(): void {
    const host = globalThis as unknown as { Hydro?: { model?: Record<string, unknown> } };
    const hydroModel = host.Hydro?.model;
    if (!hydroModel) throw new TypeError('Hydro.model is unavailable');
    hydroModel.permits = {
        async loadAclForUser() {
            return {
                permitPids: new Set<number>(),
                authoredPids: new Set<number>(),
                maintainedPids: new Set<number>(),
                dataContributionPids: new Set<number>(),
                tagContributionPids: new Set<number>(),
                fencedPids: new Set<number>(),
                ownsLegacyProblems: false,
            };
        },
    };
    hydroModel.pidNamespaces = {
        async loadAclForUser() {
            return {
                authorNamespaceIds: new Set<string>(),
                managerNamespaceIds: new Set<string>(),
                editAllNamespaceIds: new Set<string>(),
            };
        },
    };
}

function loadSchoolBank(): SchoolBankModule {
    if (schoolBank) return schoolBank;
    let bankPath = '';
    try {
        bankPath = requireFromTest.resolve('../src/model/problem-school-bank.ts');
    } catch (error) {
        const missing = new TypeError('missing export setProblemSchoolBank');
        if (error instanceof Error) missing.cause = error;
        throw missing;
    }
    delete requireFromTest.cache[bankPath];
    const loaded = requireFromTest('../src/model/problem-school-bank.ts') as Partial<SchoolBankModule>;
    const missing = BANK_EXPORTS.find((name) => typeof loaded[name] !== 'function');
    if (missing) throw new TypeError(`missing export ${missing}`);
    schoolBank = loaded as SchoolBankModule;
    return schoolBank;
}

function makeUser(kind: UserKind, overrides: Partial<AclUser> & { extraPerms?: bigint[] } = {}): AclUser {
    const perms = new Set<bigint>();
    if (kind === 'creator') perms.add(PERM.PERM_CREATE_PROBLEM);
    if (kind === 'draft-creator') perms.add(PERM.PERM_CREATE_PROGRAMMING_DRAFT);
    if (kind === 'hidden-viewer') perms.add(PERM.PERM_VIEW_PROBLEM_HIDDEN);
    if (kind === 'bank-viewer') perms.add(PERM.PERM_VIEW_PROBLEM_BANK);
    perms.add(PERM.PERM_VIEW_PROBLEM);
    for (const perm of overrides.extraPerms ?? []) perms.add(perm);
    return {
        _id: overrides._id ?? 42,
        role: kind === 'admin' ? 'default' : 'root',
        _permitPids: overrides._permitPids ?? new Set<number>(),
        _authoredPids: overrides._authoredPids ?? new Set<number>(),
        _maintainedPids: overrides._maintainedPids ?? new Set<number>(),
        _dataContributionPids: overrides._dataContributionPids ?? new Set<number>(),
        _tagContributionPids: overrides._tagContributionPids ?? new Set<number>(),
        _aclFencedPids: overrides._aclFencedPids ?? new Set<number>(),
        _ownsLegacyProblems: overrides._ownsLegacyProblems ?? false,
        _managedContainerPids: overrides._managedContainerPids ?? new Set<number>(),
        _problemAclDomainId: overrides._problemAclDomainId ?? 'system',
        _problemAclLoaded: overrides._problemAclLoaded ?? true,
        _pidNamespaceAuthorIds: overrides._pidNamespaceAuthorIds ?? new Set<string>(),
        _pidNamespaceManagerIds: overrides._pidNamespaceManagerIds ?? new Set<string>(),
        _pidNamespaceEditAllIds: overrides._pidNamespaceEditAllIds ?? new Set<string>(),
        _pidNamespaceAclDomainId: overrides._pidNamespaceAclDomainId ?? 'system',
        _pidNamespaceAclLoaded: overrides._pidNamespaceAclLoaded ?? true,
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => perms.has(perm)),
        hasPriv: (...wanted: number[]) => kind === 'admin' && wanted.includes(PRIV.PRIV_EDIT_SYSTEM),
    };
}

function sharedAt(iso = '2026-03-01T00:00:00.000Z'): Date {
    return new Date(iso);
}

function viewDoc(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        domainId: 'system',
        docId: 100,
        owner: 7,
        hidden: true,
        ...extra,
    };
}

function storeProblem(extra: Record<string, unknown>): void {
    problems.push({
        domainId: DOMAIN,
        docType: TYPE_PROBLEM,
        hidden: true,
        owner: 42,
        ...extra,
    });
}

function eachNode(value: unknown, call: (node: Record<string, unknown>) => void): void {
    const seen = new Set<unknown>();
    const walk = (node: unknown) => {
        if (!node || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);
        if (Array.isArray(node)) {
            for (const item of node) walk(item);
            return;
        }
        call(node as Record<string, unknown>);
        for (const child of Object.values(node as Record<string, unknown>)) walk(child);
    };
    walk(value);
}

function isNeManaged(value: unknown): boolean {
    return isRecord(value) && value.$ne === 'managed';
}

function hasOwnerClause(node: unknown): boolean {
    if (!isRecord(node)) return false;
    if (node.owner === 42 && isNeManaged(node.authoringMode)) return true;
    if (!Array.isArray(node.$and)) return false;
    let owner = false;
    let mode = false;
    for (const part of node.$and) {
        if (!isRecord(part)) continue;
        if (part.owner === 42) owner = true;
        if (isNeManaged(part.authoringMode)) mode = true;
    }
    return owner && mode;
}

function hasPublicClause(node: unknown): boolean {
    return isRecord(node) && isRecord(node.hidden) && node.hidden.$ne === true && Object.keys(node).length === 1;
}

function hasSchoolClause(node: unknown): boolean {
    return isRecord(node)
        && isRecord(node['schoolBank.sharedAt'])
        && node['schoolBank.sharedAt'].$exists === true
        && Object.keys(node).length === 1;
}

function hasExpandedOr(scope: unknown): boolean {
    let matched = false;
    eachNode(scope, (node) => {
        if (!Array.isArray(node.$or)) return;
        const group = node.$or;
        if (group.some(hasOwnerClause) && group.some(hasPublicClause) && group.some(hasSchoolClause)) matched = true;
    });
    return matched;
}

function hasLock(scope: unknown, uid: number): boolean {
    let found = false;
    eachNode(scope, (node) => {
        const lock = node['aclMutationLocks.uid'];
        if (isRecord(lock) && lock.$ne === uid) found = true;
    });
    return found;
}

function ninValues(scope: unknown): number[] {
    const ids: number[] = [];
    eachNode(scope, (node) => {
        const docId = node.docId;
        if (!isRecord(docId) || !Array.isArray(docId.$nin)) return;
        for (const id of docId.$nin) if (typeof id === 'number') ids.push(id);
    });
    return ids.sort((left, right) => left - right);
}

function hasMaintainerClause(scope: unknown, docId: number, uid: number): boolean {
    let found = false;
    eachNode(scope, (node) => {
        const parts = Array.isArray(node.$and) ? node.$and : [node];
        let docs = false;
        let maintainer = false;
        for (const part of parts) {
            if (!isRecord(part)) continue;
            const id = part.docId;
            if (isRecord(id) && Array.isArray(id.$in) && id.$in.includes(docId)) docs = true;
            if (part.maintainer === uid) maintainer = true;
        }
        if (docs && maintainer) found = true;
    });
    return found;
}

function containsNumber(value: unknown, target: number): boolean {
    let found = false;
    const seen = new Set<unknown>();
    const walk = (node: unknown) => {
        if (found || node === undefined || node === null) return;
        if (typeof node === 'number') {
            if (node === target) found = true;
            return;
        }
        if (typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);
        const children = Array.isArray(node) ? node : Object.values(node as Record<string, unknown>);
        for (const child of children) walk(child);
    };
    walk(value);
    return found;
}

async function capture(work: () => Promise<unknown> | unknown): Promise<unknown> {
    try {
        await work();
        return undefined;
    } catch (error) {
        return error;
    }
}

function errorBlob(error: unknown): string {
    if (!(error instanceof Error)) return '';
    const params = isRecord(error) && Array.isArray(error.params) ? error.params : [];
    return [error.message, ...params.map((item) => String(item))].join('\n');
}

function localizedMessageTemplate(error: unknown): string {
    if (!(error instanceof Error)) return '';
    return getLocalizedErrorMetadata(error as HydroError)?.message?.template ?? '';
}

function methodBody(source: string, startSignature: string, endSignature: string): string {
    const start = source.indexOf(startSignature);
    if (start < 0) throw new TypeError(`missing ${startSignature}`);
    const end = source.indexOf(endSignature, start + startSignature.length);
    if (end < 0) throw new TypeError(`missing ${endSignature}`);
    return source.slice(start, end);
}

function authorizationFieldsLiteral(body: string): string {
    const marker = 'authorizationFields = [';
    const start = body.indexOf(marker);
    if (start < 0) throw new TypeError('missing authorizationFields array');
    const end = body.indexOf('];', start);
    if (end < 0) throw new TypeError('missing authorizationFields array end');
    return body.slice(start + marker.length, end);
}

function expectSchoolBankField(signature: string, nextSignature: string): void {
    const literal = authorizationFieldsLiteral(methodBody(PROBLEM_MODEL_SOURCE, signature, nextSignature));
    expect(literal.includes("'schoolBank'") || literal.includes('"schoolBank"'), literal).to.equal(true);
}

function shareResult(value: unknown): { changed: number[]; unchanged: number[] } {
    if (!isRecord(value) || !Array.isArray(value.changed) || !Array.isArray(value.unchanged)) {
        throw new TypeError('school bank result must include changed and unchanged arrays');
    }
    const changed = value.changed.filter((id): id is number => typeof id === 'number');
    const unchanged = value.unchanged.filter((id): id is number => typeof id === 'number');
    expect(changed.length).to.equal(value.changed.length);
    expect(unchanged.length).to.equal(value.unchanged.length);
    return { changed, unchanged };
}

function sortedIds(ids: readonly number[]): number[] {
    return [...ids].sort((left, right) => left - right);
}

function numberIds(value: unknown, ids: number[]): void {
    if (typeof value === 'number') {
        ids.push(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) numberIds(item, ids);
        return;
    }
    if (!isRecord(value)) return;
    for (const child of Object.values(value)) numberIds(child, ids);
}

function writtenDocIds(): number[] {
    const ids: number[] = [];
    for (const write of writes) numberIds(write.filter, ids);
    return ids;
}

function schoolBankWrites(): Array<{ sharedBy: number; sharedAt: unknown }> {
    const found: Array<{ sharedBy: number; sharedAt: unknown }> = [];
    const visit = (node: unknown) => {
        if (Array.isArray(node)) {
            for (const item of node) visit(item);
            return;
        }
        if (!isRecord(node)) return;
        const bank = node.schoolBank;
        if (isRecord(bank) && typeof bank.sharedBy === 'number') {
            found.push({ sharedBy: bank.sharedBy, sharedAt: bank.sharedAt });
        }
        for (const child of Object.values(node)) visit(child);
    };
    for (const write of writes) visit(write.update);
    return found;
}

function unsetsSchoolBank(): boolean {
    let found = false;
    const visit = (node: unknown) => {
        if (found || !isRecord(node)) return;
        const unset = node.$unset;
        if (isRecord(unset) && Object.keys(unset).some((key) => key === 'schoolBank' || key.startsWith('schoolBank.'))) {
            found = true;
            return;
        }
        for (const child of Object.values(node)) visit(child);
    };
    for (const write of writes) visit(write.update);
    return found;
}

function loggedTokens(): unknown[] {
    const tokens: unknown[] = [];
    const visit = (value: unknown) => {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            tokens.push(value);
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        if (isRecord(value)) {
            for (const item of Object.values(value)) visit(item);
        }
    };
    for (const args of infoCalls) visit(args);
    return tokens;
}

function expectLogged(domainId: string, actorId: number, shared: boolean, changedCount: number) {
    const tokens = loggedTokens();
    expect(tokens.includes(domainId)).to.equal(true);
    expect(tokens.includes(actorId)).to.equal(true);
    expect(tokens.includes(shared)).to.equal(true);
    expect(tokens.includes(changedCount)).to.equal(true);
}

beforeEach(() => {
    problems.length = 0;
    writes.length = 0;
    infoCalls.length = 0;
});

describe('school bank selection scope', () => {
    it('unions own problems with public and shared hidden problems for a bank-browsing creator', () => {
        const { buildProblemContainerSelectionScope, buildProblemBankScope } = loadAccess();
        const user = makeUser('creator', { extraPerms: [PERM.PERM_VIEW_PROBLEM_BANK] });
        const scope = buildProblemContainerSelectionScope(user);
        expect(hasExpandedOr(scope)).to.equal(true);
        expect(hasLock(scope, 42)).to.equal(true);
        expect(buildProblemBankScope(user)).to.deep.equal(OWN_LEGACY_SCOPE);
    });

    it('keeps maintainer rows, fences, and lock exclusion when the selection scope widens', () => {
        const { buildProblemContainerSelectionScope } = loadAccess();
        const scope = buildProblemContainerSelectionScope(makeUser('creator', {
            extraPerms: [PERM.PERM_VIEW_PROBLEM_BANK],
            _maintainedPids: new Set([102, 103]),
            _aclFencedPids: new Set([9, 3]),
            _dataContributionPids: new Set([77]),
        }));
        expect(hasExpandedOr(scope)).to.equal(true);
        expect(hasMaintainerClause(scope, 102, 42)).to.equal(true);
        expect(hasLock(scope, 42)).to.equal(true);
        expect(ninValues(scope)).to.deep.equal([3, 9]);
        expect(containsNumber(scope, 77)).to.equal(false);
    });

    // Acceptance case 2 names makeUser('creator'). That fixture has PERM_CREATE_PROBLEM,
    // so canBrowseProblemBank is already true, but the case still requires the old scope.
    it('keeps a creator without bank browse permission on the previous selection scope', () => {
        const { buildProblemContainerSelectionScope } = loadAccess();
        expect(buildProblemContainerSelectionScope(makeUser('creator'))).to.deep.equal(OWN_LEGACY_SCOPE);
    });

    it('keeps a browse-only viewer on the previous public selection scope', () => {
        const { buildProblemContainerSelectionScope } = loadAccess();
        expect(buildProblemContainerSelectionScope(makeUser('bank-viewer'))).to.deep.equal(PUBLIC_SCOPE);
    });

    // PERM_CREATE_PROGRAMMING_DRAFT can browse, but the widened union requires PERM_CREATE_PROBLEM.
    it('keeps a programming-draft creator who can browse the bank on the public selection scope', () => {
        const { buildProblemContainerSelectionScope } = loadAccess();
        const user = makeUser('draft-creator', { extraPerms: [PERM.PERM_VIEW_PROBLEM_BANK] });
        expect(buildProblemContainerSelectionScope(user)).to.deep.equal(PUBLIC_SCOPE);
    });

    it('keeps administrators and callers who cannot browse on the previous selection scope', () => {
        const { buildProblemContainerSelectionScope } = loadAccess();
        expect(buildProblemContainerSelectionScope(makeUser('admin'))).to.deep.equal(ADMIN_SCOPE);
        expect(buildProblemContainerSelectionScope(makeUser('admin', {
            _aclFencedPids: new Set([103, 101]),
        }))).to.deep.equal(ADMIN_FENCED_SCOPE);
        expect(buildProblemContainerSelectionScope(makeUser('student'))).to.deep.equal(DENY_SCOPE);
        expect(buildProblemContainerSelectionScope(makeUser('creator', { _problemAclLoaded: false }))).to.deep.equal(DENY_SCOPE);
        expect(buildProblemContainerSelectionScope(makeUser('draft-creator'))).to.deep.equal(DENY_SCOPE);
    });
});

describe('shared hidden problem visibility', () => {
    it('lets a teacher open a shared hidden problem and refuses a student or an unshared problem', () => {
        const { canViewProblem } = loadAccess();
        const teacher = makeUser('creator', { extraPerms: [PERM.PERM_VIEW_PROBLEM_BANK] });
        const student = makeUser('student');
        const shared = viewDoc({ schoolBank: { sharedBy: 7, sharedAt: sharedAt() } });
        expect(canViewProblem(teacher, shared)).to.equal(true);
        expect(canViewProblem(student, shared)).to.equal(false);
        expect(canViewProblem(teacher, viewDoc())).to.equal(false);
        expect(canViewProblem(makeUser('creator'), shared)).to.equal(false);
        expect(canViewProblem(makeUser('bank-viewer'), shared)).to.equal(false);
        expect(canViewProblem(makeUser('hidden-viewer'), shared)).to.equal(false);
        expect(canViewProblem(makeUser('draft-creator'), shared)).to.equal(false);
        expect(canViewProblem(makeUser('draft-creator', { extraPerms: [PERM.PERM_VIEW_PROBLEM_BANK] }), shared)).to.equal(false);
    });

    it('keeps a stripped discussion copy visible after the authorized read in the same request', async () => {
        const { canViewProblem } = loadAccess();
        const problem = loadProblem();
        const teacher = makeUser('creator', { extraPerms: [PERM.PERM_VIEW_PROBLEM_BANK] });
        installAclReload();
        storeProblem({
            domainId: 'system',
            docId: 100,
            owner: 7,
            hidden: true,
            aclMutationRevision: 0,
            schoolBank: { sharedBy: 7, sharedAt: sharedAt() },
        });
        const authorized = await problem.getViewableAuthorized('system', 100, teacher, problem.PROJECTION_LIST);
        expect(isRecord(authorized)).to.equal(true);
        if (!isRecord(authorized)) return;
        expect(Object.hasOwn(authorized, 'schoolBank')).to.equal(false);
        const vnode = { ...authorized, type: TYPE_PROBLEM, id: authorized.docId };
        expect(problem.canViewBy(vnode, teacher)).to.equal(true);
        expect(canViewProblem(teacher, viewDoc())).to.equal(false);
    });

    it('lets a teacher view a contest statement loaded by get with the public projection', async () => {
        const problem = loadProblem();
        const teacher = makeUser('creator', { extraPerms: [PERM.PERM_VIEW_PROBLEM_BANK] });
        storeProblem({
            domainId: 'system',
            docId: 100,
            owner: 7,
            hidden: true,
            schoolBank: { sharedBy: 7, sharedAt: sharedAt() },
        });
        expect(problem.PROJECTION_PUBLIC.includes('schoolBank')).to.equal(false);
        const loaded = await problem.get('system', 100, problem.PROJECTION_PUBLIC);
        expect(isRecord(loaded)).to.equal(true);
        if (!isRecord(loaded)) return;
        expect(Object.hasOwn(loaded, 'schoolBank')).to.equal(false);
        expect(problem.canViewBy(loaded, teacher)).to.equal(true);
    });

    it('lets the same teacher open a shared hidden managed problem', () => {
        const { canViewProblem } = loadAccess();
        const teacher = makeUser('creator', { extraPerms: [PERM.PERM_VIEW_PROBLEM_BANK] });
        const shared = viewDoc({
            authoringMode: 'managed',
            schoolBank: { sharedBy: 7, sharedAt: sharedAt() },
        });
        expect(canViewProblem(teacher, shared)).to.equal(true);
        expect(canViewProblem(teacher, viewDoc({ authoringMode: 'managed' }))).to.equal(false);
        expect(canViewProblem(makeUser('student'), shared)).to.equal(false);
    });

    it('still refuses a fenced teacher and throws when the school bank field is dirty', async () => {
        const { canViewProblem } = loadAccess();
        const teacher = makeUser('creator', {
            extraPerms: [PERM.PERM_VIEW_PROBLEM_BANK],
            _aclFencedPids: new Set([100]),
        });
        const shared = viewDoc({ schoolBank: { sharedBy: 7, sharedAt: sharedAt() } });
        expect(canViewProblem(teacher, shared)).to.equal(false);
        const dirty = viewDoc({ schoolBank: { sharedBy: 7, sharedAt: sharedAt(), extra: true } });
        const thrown = await capture(() => canViewProblem(makeUser('creator', { extraPerms: [PERM.PERM_VIEW_PROBLEM_BANK] }), dirty));
        expect(thrown instanceof TypeError).to.equal(true);
        expect(thrown instanceof Error && thrown.message).to.equal('problem_school_bank_invalid');
    });
});

describe('school bank writes', () => {
    it('treats an exact share as membership and rejects a dirty share', async () => {
        const { isProblemInSchoolBank } = loadSchoolBank();
        expect(isProblemInSchoolBank({})).to.equal(false);
        expect(isProblemInSchoolBank({ schoolBank: { sharedBy: 7, sharedAt: sharedAt() } })).to.equal(true);
        const thrown = await capture(() => isProblemInSchoolBank({ schoolBank: { sharedBy: 0, sharedAt: sharedAt() } }));
        expect(thrown instanceof TypeError).to.equal(true);
        expect(thrown instanceof Error && thrown.message).to.equal('problem_school_bank_invalid');
    });

    it('lets only an administrator or the owner of a non-managed problem toggle the share', () => {
        const { canToggleProblemSchoolBank } = loadSchoolBank();
        const owner = makeUser('creator');
        const stranger = makeUser('creator', { _id: 9 });
        const admin = makeUser('admin');
        expect(canToggleProblemSchoolBank(admin, { owner: 7, authoringMode: 'managed' })).to.equal(true);
        expect(canToggleProblemSchoolBank(owner, { owner: 42 })).to.equal(true);
        expect(canToggleProblemSchoolBank(owner, { owner: 42, authoringMode: 'managed' })).to.equal(false);
        expect(canToggleProblemSchoolBank(stranger, { owner: 42 })).to.equal(false);
        expect(canToggleProblemSchoolBank(makeUser('student'), { owner: 42 })).to.equal(true);
        expect(canToggleProblemSchoolBank(owner, { owner: 42, authoringMode: 'legacy' })).to.equal(true);
    });

    it('refuses a non-owner or the owner of a managed problem and writes nothing', async () => {
        const { setProblemSchoolBank } = loadSchoolBank();
        storeProblem({ docId: 4, owner: 42 });
        storeProblem({ docId: 5, owner: 9 });
        const mixed = await capture(() => setProblemSchoolBank(DOMAIN, makeUser('creator'), [4, 5], true));
        expect(mixed instanceof PermissionError).to.equal(true);
        expect(localizedMessageTemplate(mixed)).to.equal(SHARE_DENIED);
        expect(writes.length).to.equal(0);

        problems.length = 0;
        writes.length = 0;
        storeProblem({ docId: 6, owner: 42, authoringMode: 'managed' });
        const managed = await capture(() => setProblemSchoolBank(DOMAIN, makeUser('creator'), [6], true));
        expect(managed instanceof PermissionError).to.equal(true);
        expect(localizedMessageTemplate(managed)).to.equal(SHARE_DENIED);
        expect(writes.length).to.equal(0);
    });

    it('lets an administrator share a managed problem owned by someone else', async () => {
        const { setProblemSchoolBank } = loadSchoolBank();
        storeProblem({ docId: 8, owner: 9, authoringMode: 'managed' });
        const result = shareResult(await setProblemSchoolBank(DOMAIN, makeUser('admin'), [8], true));
        expect(result.changed).to.deep.equal([8]);
        expect(result.unchanged).to.deep.equal([]);
        const shares = schoolBankWrites();
        expect(shares.length).to.be.greaterThan(0);
        expect(shares.every((share) => share.sharedBy === 42 && share.sharedAt instanceof Date)).to.equal(true);
        expect(writtenDocIds().includes(8)).to.equal(true);
        expectLogged(DOMAIN, 42, true, 1);
    });

    it('lets the owner share an unshared problem and only writes the problems that change', async () => {
        const { setProblemSchoolBank } = loadSchoolBank();
        const at = sharedAt();
        storeProblem({ docId: 4 });
        storeProblem({ docId: 5, schoolBank: { sharedBy: 42, sharedAt: at } });
        const result = shareResult(await setProblemSchoolBank(DOMAIN, makeUser('creator'), [4, 5], true));
        expect(sortedIds(result.changed)).to.deep.equal([4]);
        expect(sortedIds(result.unchanged)).to.deep.equal([5]);
        expect(writtenDocIds().includes(4)).to.equal(true);
        expect(writtenDocIds().includes(5)).to.equal(false);
        expect(schoolBankWrites().some((share) => share.sharedBy === 42 && share.sharedAt instanceof Date)).to.equal(true);
        expectLogged(DOMAIN, 42, true, 1);
    });

    it('reports a repeated share as unchanged and does not write', async () => {
        const { setProblemSchoolBank } = loadSchoolBank();
        storeProblem({ docId: 4, schoolBank: { sharedBy: 42, sharedAt: sharedAt() } });
        const result = shareResult(await setProblemSchoolBank(DOMAIN, makeUser('creator'), [4], true));
        expect(result.changed).to.deep.equal([]);
        expect(result.unchanged).to.deep.equal([4]);
        expect(writes.length).to.equal(0);
        expectLogged(DOMAIN, 42, true, 0);
    });

    it('unsets a share that is turned off and leaves an unshared problem unchanged', async () => {
        const { setProblemSchoolBank } = loadSchoolBank();
        storeProblem({ docId: 4, schoolBank: { sharedBy: 42, sharedAt: sharedAt() } });
        storeProblem({ docId: 5 });
        const result = shareResult(await setProblemSchoolBank(DOMAIN, makeUser('creator'), [4, 5], false));
        expect(sortedIds(result.changed)).to.deep.equal([4]);
        expect(sortedIds(result.unchanged)).to.deep.equal([5]);
        expect(unsetsSchoolBank()).to.equal(true);
        expect(writtenDocIds().includes(4)).to.equal(true);
        expect(writtenDocIds().includes(5)).to.equal(false);
        expectLogged(DOMAIN, 42, false, 1);
    });

    it('rejects an empty id list and more than 500 ids', async () => {
        const { setProblemSchoolBank } = loadSchoolBank();
        const empty = await capture(() => setProblemSchoolBank(DOMAIN, makeUser('creator'), [], true));
        expect(empty instanceof ValidationError).to.equal(true);
        expect(writes.length).to.equal(0);

        for (let docId = 1; docId <= 501; docId += 1) storeProblem({ docId });
        const tooMany = await capture(() => setProblemSchoolBank(
            DOMAIN,
            makeUser('creator'),
            Array.from({ length: 501 }, (_unused, index) => index + 1),
            true,
        ));
        expect(tooMany instanceof ValidationError).to.equal(true);
        expect(errorBlob(tooMany).includes(MISSING_SENTENCE)).to.equal(false);
        expect(writes.length).to.equal(0);
    });

    it('accepts exactly 500 ids and counts duplicate ids once', async () => {
        const { setProblemSchoolBank } = loadSchoolBank();
        for (let docId = 1; docId <= 500; docId += 1) storeProblem({ docId });
        const full = shareResult(await setProblemSchoolBank(
            DOMAIN,
            makeUser('creator'),
            Array.from({ length: 500 }, (_unused, index) => index + 1),
            true,
        ));
        expect(sortedIds(full.changed)).to.deep.equal(Array.from({ length: 500 }, (_unused, index) => index + 1));
        expect(full.unchanged).to.deep.equal([]);
        expect(writes.length).to.be.greaterThan(0);

        problems.length = 0;
        writes.length = 0;
        infoCalls.length = 0;
        storeProblem({ docId: 4 });
        const repeated = shareResult(await setProblemSchoolBank(DOMAIN, makeUser('creator'), Array.from({ length: 600 }, () => 4), true));
        expect(repeated.changed).to.deep.equal([4]);
        expect(repeated.unchanged).to.deep.equal([]);
        expectLogged(DOMAIN, 42, true, 1);
    });

    it('rejects a missing or archived problem and writes nothing', async () => {
        const { setProblemSchoolBank } = loadSchoolBank();
        storeProblem({ docId: 15 });
        const missing = await capture(() => setProblemSchoolBank(DOMAIN, makeUser('creator'), [15, 16], true));
        expect(missing instanceof ValidationError).to.equal(true);
        expect(errorBlob(missing).includes(MISSING_SENTENCE)).to.equal(true);
        expect(errorBlob(missing).includes('16')).to.equal(true);
        expect(writes.length).to.equal(0);

        problems.length = 0;
        writes.length = 0;
        storeProblem({ docId: 15, archivedAt: sharedAt() });
        const archived = await capture(() => setProblemSchoolBank(DOMAIN, makeUser('creator'), [15], true));
        expect(archived instanceof ValidationError).to.equal(true);
        expect(errorBlob(archived).includes(MISSING_SENTENCE)).to.equal(true);
        expect(errorBlob(archived).includes('15')).to.equal(true);
        expect(writes.length).to.equal(0);
    });

    it('throws when a stored school bank field is dirty and writes nothing', async () => {
        const { setProblemSchoolBank } = loadSchoolBank();
        storeProblem({ docId: 4, schoolBank: { sharedBy: 42, sharedAt: sharedAt(), extra: true } });
        const thrown = await capture(() => setProblemSchoolBank(DOMAIN, makeUser('creator'), [4], true));
        expect(thrown instanceof TypeError).to.equal(true);
        expect(thrown instanceof Error && thrown.message).to.equal('problem_school_bank_invalid');
        expect(writes.length).to.equal(0);
    });

    it('lists only the requested problems that are already in this domain school bank', async () => {
        const { listSchoolBankDocIds } = loadSchoolBank();
        storeProblem({ docId: 1, schoolBank: { sharedBy: 7, sharedAt: sharedAt() } });
        storeProblem({ docId: 2 });
        storeProblem({ docId: 3, schoolBank: { sharedBy: 7, sharedAt: sharedAt() } });
        storeProblem({ domainId: 'other-school', docId: 5, schoolBank: { sharedBy: 7, sharedAt: sharedAt() } });
        const ids = await listSchoolBankDocIds(DOMAIN, [3, 2, 1, 5, 9]);
        expect(sortedIds(ids)).to.deep.equal([1, 3]);
    });

    it('throws when a listed problem has a dirty school bank field', async () => {
        const { listSchoolBankDocIds } = loadSchoolBank();
        storeProblem({ docId: 4, schoolBank: { sharedBy: 7, sharedAt: sharedAt(), extra: true } });
        const thrown = await capture(() => listSchoolBankDocIds(DOMAIN, [4]));
        expect(thrown instanceof TypeError).to.equal(true);
        expect(thrown instanceof Error && thrown.message).to.equal('problem_school_bank_invalid');
    });
});

describe('school bank read projection', () => {
    it('loads schoolBank in both direct view authorization field lists', () => {
        expectSchoolBankField('static async getViewableAuthorized(', 'static async getListViewableAuthorized(');
        expectSchoolBankField('static async getListViewableAuthorized(', 'static async getMaintainableAuthorized(');
    });
});
