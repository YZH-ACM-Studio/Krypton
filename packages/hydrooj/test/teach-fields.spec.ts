import { createRequire, type Module as NodeModule } from 'node:module';
import { after, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { ContestNotFoundError, getLocalizedErrorMetadata, TrainingNotFoundError, type HydroError } from '../src/error';

// PLAN shows a static import. The modules do not exist yet, and a static import
// would fail this lane's tsc gate inside the test file. Load them at runtime.
// This line matches @hydrooj/register's CJS strip so __filename stays defined.
const __filename = fileURLToPath(import.meta.url);
const requireFromTest = createRequire(__filename);

type TeachType = 'practice' | 'homework' | 'exam' | 'acm' | 'oi';
type TeachRole = 'owner' | 'maintainer' | 'admin';

interface TeachActor {
    _id: number;
    own: (doc: { owner: number; maintainer?: number[] }, exact?: boolean) => boolean;
    hasPerm: (...perm: bigint[]) => boolean;
    hasPriv: (...priv: number[]) => boolean;
}

interface TeachFieldsModule {
    readSchoolShared: (raw: unknown) => unknown;
    readCopiedFrom: (raw: unknown) => unknown;
    readProblemSchoolBank: (raw: unknown) => unknown;
}

interface TeachAccessModule {
    canManageTeachContainer: (actor: TeachActor, type: TeachType, doc: { owner: number; maintainer?: number[] }) => boolean;
    canCreateTeachType: (actor: TeachActor, type: TeachType) => boolean;
    teachRoleOf: (actor: TeachActor, doc: { owner: number; maintainer?: number[] }) => TeachRole;
    loadTeachContainer: (domainId: string, type: TeachType, id: ObjectId) => Promise<unknown>;
    assertTeachManage: (domainId: string, actor: TeachActor, type: TeachType, id: ObjectId) => Promise<unknown>;
}

interface ModelCall {
    domainId: string;
    id: unknown;
}

interface InvalidSample {
    label: string;
    value: unknown;
}

const FIELD_EXPORTS = ['readSchoolShared', 'readCopiedFrom', 'readProblemSchoolBank'] as const satisfies readonly (keyof TeachFieldsModule)[];
const ACCESS_EXPORTS = [
    'canManageTeachContainer',
    'canCreateTeachType',
    'teachRoleOf',
    'loadTeachContainer',
    'assertTeachManage',
] as const satisfies readonly (keyof TeachAccessModule)[];
const BASE_RULES = ['acm', 'oi', 'ioi', 'ledo', 'strictioi', 'exam', 'homework'] as const;
const domainId = 'teach-domain';

const contestCalls: ModelCall[] = [];
const trainingCalls: ModelCall[] = [];
const contestRules: Record<string, { hidden?: boolean }> = {};
let contestDoc: Record<string, unknown> | null | undefined = null;
let trainingDoc: Record<string, unknown> | null = null;
let contestFailure: Error | null = null;
const replaced: Array<{ resolved: string; previous: NodeModule | undefined }> = [];

const hydroHost = global as { Hydro?: { model?: object } };
if (!hydroHost.Hydro) hydroHost.Hydro = { model: {} };
if (!hydroHost.Hydro.model) hydroHost.Hydro.model = {};
// builtin assigns global.Hydro.model at import time, so it has to load after that object exists.
const { PERM, PRIV } = requireFromTest('../src/model/builtin.ts') as typeof import('../src/model/builtin');

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFieldsModule(value: unknown): value is TeachFieldsModule {
    return isRecord(value) && FIELD_EXPORTS.every((name) => typeof value[name] === 'function');
}

function isAccessModule(value: unknown): value is TeachAccessModule {
    return isRecord(value) && ACCESS_EXPORTS.every((name) => typeof value[name] === 'function');
}

function loadRecord(modulePath: string): Record<string, unknown> {
    const loaded: unknown = requireFromTest(modulePath);
    if (!isRecord(loaded)) throw new TypeError(`teach export missing: ${modulePath}`);
    return loaded;
}

function loadFields(): TeachFieldsModule {
    const loaded = loadRecord('../src/lib/teach-fields.ts');
    if (!isFieldsModule(loaded)) {
        const missing = FIELD_EXPORTS.find((name) => typeof loaded[name] !== 'function') ?? FIELD_EXPORTS[0];
        throw new TypeError(`teach export missing: ${missing}`);
    }
    return loaded;
}

function loadAccess(): TeachAccessModule {
    const loaded = loadRecord('../src/lib/teach-access.ts');
    if (!isAccessModule(loaded)) {
        const missing = ACCESS_EXPORTS.find((name) => typeof loaded[name] !== 'function') ?? ACCESS_EXPORTS[0];
        throw new TypeError(`teach export missing: ${missing}`);
    }
    return loaded;
}

function installStub(relativePath: string, exports: Record<string, unknown>): void {
    const resolved = requireFromTest.resolve(relativePath);
    replaced.push({ resolved, previous: requireFromTest.cache[resolved] });
    requireFromTest.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports,
    } as NodeModule;
}

function resetModels(): void {
    contestCalls.length = 0;
    trainingCalls.length = 0;
    contestDoc = null;
    trainingDoc = null;
    contestFailure = null;
    for (const key of Object.keys(contestRules)) {
        if (!BASE_RULES.includes(key as (typeof BASE_RULES)[number])) delete contestRules[key];
    }
    contestRules.acm = {};
    contestRules.oi = {};
    contestRules.ioi = {};
    contestRules.ledo = {};
    contestRules.strictioi = {};
    contestRules.exam = {};
    contestRules.homework = { hidden: true };
}

installStub('../src/service/db.ts', {
    collection: () => ({
        createIndex: async () => 'ok',
        find: () => ({ toArray: async () => [] }),
    }),
});
installStub('../src/model/document.ts', {
    TYPE_TRAINING: 40,
    coll: { find: () => ({ toArray: async () => [] }) },
});
installStub('../src/model/contest.ts', {
    RULES: contestRules,
    async get(nextDomainId: string, id: unknown) {
        contestCalls.push({ domainId: nextDomainId, id });
        if (contestFailure) throw contestFailure;
        if (contestDoc === null) throw new ContestNotFoundError(nextDomainId, id);
        return contestDoc;
    },
});
installStub('../src/model/training.ts', {
    async get(nextDomainId: string, id: unknown) {
        trainingCalls.push({ domainId: nextDomainId, id });
        if (trainingDoc === null) throw new TrainingNotFoundError(nextDomainId, id);
        return trainingDoc;
    },
});
resetModels();

after(() => {
    for (const item of replaced) {
        if (item.previous) requireFromTest.cache[item.resolved] = item.previous;
        else delete requireFromTest.cache[item.resolved];
    }
});

beforeEach(() => {
    resetModels();
});

function teachActor(uid: number, perms: readonly bigint[] = [], privs: readonly number[] = []): TeachActor {
    const permSet = new Set<bigint>(perms);
    const privSet = new Set<number>(privs);
    return {
        _id: uid,
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => permSet.has(perm)),
        hasPriv: (...wanted: number[]) => wanted.some((priv) => privSet.has(priv)),
        own: (doc, exact) => (exact === true ? doc.owner === uid : doc.owner === uid || (doc.maintainer || []).includes(uid)),
    };
}

function failureOf(run: () => unknown): unknown {
    try {
        run();
    } catch (error) {
        return error;
    }
    throw new Error('expected the call to throw');
}

async function rejectionOf(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run();
    } catch (error) {
        return error;
    }
    throw new Error('expected the call to reject');
}

function errorName(error: unknown): string {
    return error instanceof Error ? error.name : '';
}

function errorText(error: unknown): string {
    if (!(error instanceof Error)) return '';
    const withParams = error as Error & { params?: unknown };
    const params = Array.isArray(withParams.params) ? withParams.params : [];
    const metadata = getLocalizedErrorMetadata(error as HydroError);
    const templates = [metadata?.message?.template ?? '', ...[...(metadata?.parameters.values() ?? [])].map((item) => item.template)];
    return [error.message, ...params.map((item) => String(item)), ...templates].join('\n');
}

function expectInvalid(run: () => unknown, message: string, label: string): void {
    try {
        const error = failureOf(run);
        expect(error instanceof TypeError).to.equal(true);
        if (!(error instanceof TypeError)) return;
        expect(error.message).to.equal(message);
    } catch (error) {
        if (error instanceof Error && !error.message.startsWith(`${label}:`)) error.message = `${label}: ${error.message}`;
        throw error;
    }
}

function expectShare(read: unknown, sharedBy: number, sharedAt: Date): void {
    expect(isRecord(read)).to.equal(true);
    if (!isRecord(read)) return;
    expect(read.sharedBy).to.equal(sharedBy);
    expect(read.sharedAt instanceof Date).to.equal(true);
    if (!(read.sharedAt instanceof Date)) return;
    expect(read.sharedAt.getTime()).to.equal(sharedAt.getTime());
    expect(Object.keys(read).sort()).to.deep.equal(['sharedAt', 'sharedBy']);
}

function expectCopied(
    read: unknown,
    input: { type: string; id: ObjectId; title: string; ownerUid: number; copiedBy: number; copiedAt: Date },
): void {
    expect(isRecord(read)).to.equal(true);
    if (!isRecord(read)) return;
    expect(read.type).to.equal(input.type);
    expect(read.id instanceof ObjectId).to.equal(true);
    if (!(read.id instanceof ObjectId)) return;
    expect(read.id.equals(input.id)).to.equal(true);
    expect(read.title).to.equal(input.title);
    expect(read.ownerUid).to.equal(input.ownerUid);
    expect(read.copiedBy).to.equal(input.copiedBy);
    expect(read.copiedAt instanceof Date).to.equal(true);
    if (!(read.copiedAt instanceof Date)) return;
    expect(read.copiedAt.getTime()).to.equal(input.copiedAt.getTime());
    expect(Object.keys(read).sort()).to.deep.equal(['copiedAt', 'copiedBy', 'id', 'ownerUid', 'title', 'type']);
}

function sawCall(calls: ModelCall[], id: ObjectId): boolean {
    return calls.some(
        (call) =>
            call.domainId === domainId && (call.id instanceof ObjectId ? call.id.equals(id) : String(call.id) === id.toHexString()),
    );
}

async function expectNotFound(run: () => Promise<unknown>): Promise<void> {
    const error = await rejectionOf(run);
    expect(errorName(error)).to.equal('NotFoundError');
    expect(errorText(error)).to.include('题目集不存在');
}

async function expectPermission(run: () => Promise<unknown>): Promise<void> {
    const error = await rejectionOf(run);
    expect(errorName(error)).to.equal('PermissionError');
    expect(errorText(error)).to.include('你不能管理这个题目集。');
}

describe('teach field readers', () => {
    it('returns null when a share is absent and the same value when the object is exact', () => {
        const fields = loadFields();
        const sharedAt = new Date();
        const bankAt = new Date('2026-10-16T01:02:03.000Z');
        const copiedAt = new Date('2026-10-16T04:05:06.000Z');
        const sourceId = new ObjectId();
        expect(fields.readSchoolShared(undefined)).to.equal(null);
        expect(fields.readProblemSchoolBank(undefined)).to.equal(null);
        expect(fields.readCopiedFrom(undefined)).to.equal(null);
        expectShare(fields.readSchoolShared({ sharedBy: 3, sharedAt }), 3, sharedAt);
        expectShare(fields.readSchoolShared({ sharedBy: Number.MAX_SAFE_INTEGER, sharedAt }), Number.MAX_SAFE_INTEGER, sharedAt);
        expectShare(fields.readProblemSchoolBank({ sharedBy: 3, sharedAt: bankAt }), 3, bankAt);
        expectCopied(fields.readCopiedFrom({
            type: 'exam',
            id: sourceId,
            title: '期中考试',
            ownerUid: 1,
            copiedBy: Number.MAX_SAFE_INTEGER,
            copiedAt,
        }), {
            type: 'exam',
            id: sourceId,
            title: '期中考试',
            ownerUid: 1,
            copiedBy: Number.MAX_SAFE_INTEGER,
            copiedAt,
        });
        expectCopied(fields.readCopiedFrom({
            type: 'practice',
            id: sourceId,
            title: '',
            ownerUid: 4,
            copiedBy: 8,
            copiedAt,
        }), {
            type: 'practice',
            id: sourceId,
            title: '',
            ownerUid: 4,
            copiedBy: 8,
            copiedAt,
        });
    });

    it('rejects a school share that has an extra key or is not a positive safe integer and a valid date', () => {
        const fields = loadFields();
        const sharedAt = new Date('2026-10-16T00:00:00.000Z');
        const valid: Record<string, unknown> = { sharedBy: 3, sharedAt };
        const samples: InvalidSample[] = [
            { label: 'extra key', value: { ...valid, note: 'x' } },
            { label: 'sharedBy zero', value: { ...valid, sharedBy: 0 } },
            { label: 'sharedBy negative', value: { ...valid, sharedBy: -1 } },
            { label: 'sharedBy fraction', value: { ...valid, sharedBy: 1.5 } },
            { label: 'sharedBy unsafe', value: { ...valid, sharedBy: Number.MAX_SAFE_INTEGER + 1 } },
            { label: 'sharedBy string', value: { ...valid, sharedBy: '3' } },
            { label: 'sharedBy bigint', value: { ...valid, sharedBy: 3n } },
            { label: 'invalid date', value: { sharedBy: 3, sharedAt: new Date(Number.NaN) } },
            { label: 'string date', value: { sharedBy: 3, sharedAt: '2026-10-16T00:00:00.000Z' } },
            { label: 'missing date', value: { sharedBy: 3 } },
            { label: 'null', value: null },
            { label: 'array', value: [valid] },
            { label: 'number', value: 3 },
        ];
        for (const sample of samples) {
            expectInvalid(() => fields.readSchoolShared(sample.value), 'teach_school_shared_invalid', sample.label);
        }
    });

    it('rejects a copy source that omits copiedAt or whose type is not a teach type', () => {
        const fields = loadFields();
        const copiedAt = new Date('2026-10-16T04:05:06.000Z');
        const sourceId = new ObjectId();
        const valid: Record<string, unknown> = {
            type: 'homework',
            id: sourceId,
            title: '作业一',
            ownerUid: 4,
            copiedBy: 8,
            copiedAt,
        };
        const samples: InvalidSample[] = [
            { label: 'missing copiedAt', value: { type: 'homework', id: sourceId, title: '作业一', ownerUid: 4, copiedBy: 8 } },
            { label: 'quiz type', value: { ...valid, type: 'quiz' } },
            { label: 'extra key', value: { ...valid, note: 'x' } },
            { label: 'ownerUid zero', value: { ...valid, ownerUid: 0 } },
            { label: 'copiedBy zero', value: { ...valid, copiedBy: 0 } },
            { label: 'copiedBy fraction', value: { ...valid, copiedBy: 1.5 } },
            { label: 'string id', value: { ...valid, id: sourceId.toHexString() } },
            { label: 'numeric title', value: { ...valid, title: 1 } },
            { label: 'invalid date', value: { ...valid, copiedAt: new Date(Number.NaN) } },
            { label: 'null', value: null },
        ];
        for (const sample of samples) {
            expectInvalid(() => fields.readCopiedFrom(sample.value), 'teach_copied_from_invalid', sample.label);
        }
    });

    it('rejects a problem school bank share with the bank error', () => {
        const fields = loadFields();
        const sharedAt = new Date('2026-10-16T01:02:03.000Z');
        const valid: Record<string, unknown> = { sharedBy: 3, sharedAt };
        const samples: InvalidSample[] = [
            { label: 'extra key', value: { ...valid, note: 'x' } },
            { label: 'sharedBy zero', value: { ...valid, sharedBy: 0 } },
            { label: 'string date', value: { sharedBy: 9, sharedAt: sharedAt.toISOString() } },
            { label: 'undefined is not invalid', value: undefined },
        ];
        expectInvalid(() => fields.readProblemSchoolBank(samples[0]?.value), 'problem_school_bank_invalid', 'extra key');
        expectInvalid(() => fields.readProblemSchoolBank(samples[1]?.value), 'problem_school_bank_invalid', 'sharedBy zero');
        expectInvalid(() => fields.readProblemSchoolBank(samples[2]?.value), 'problem_school_bank_invalid', 'string date');
        expect(fields.readProblemSchoolBank(samples[3]?.value)).to.equal(null);
    });

    it('rejects a share or copy source that also has a symbol key', () => {
        const fields = loadFields();
        const marker = Symbol('extra');
        const sharedAt = new Date('2026-10-16T00:00:00.000Z');
        const share: Record<string | symbol, unknown> = { sharedBy: 3, sharedAt };
        Object.defineProperty(share, marker, { value: true, enumerable: true });
        expect(Object.getOwnPropertySymbols(share).length).to.equal(1);
        expectInvalid(() => fields.readSchoolShared(share), 'teach_school_shared_invalid', 'school symbol');
        expectInvalid(() => fields.readProblemSchoolBank(share), 'problem_school_bank_invalid', 'bank symbol');

        const copiedAt = new Date('2026-10-16T04:05:06.000Z');
        const sourceId = new ObjectId();
        const copied: Record<string | symbol, unknown> = {
            type: 'homework',
            id: sourceId,
            title: '作业一',
            ownerUid: 4,
            copiedBy: 8,
            copiedAt,
        };
        Object.defineProperty(copied, marker, { value: true, enumerable: true });
        expectInvalid(() => fields.readCopiedFrom(copied), 'teach_copied_from_invalid', 'copy symbol');
    });

    it('accepts the unix epoch and a date before it as a valid share or copy time', () => {
        const fields = loadFields();
        const epoch = new Date(0);
        const beforeEpoch = new Date(-1);
        const sourceId = new ObjectId();
        expectShare(fields.readSchoolShared({ sharedBy: 1, sharedAt: epoch }), 1, epoch);
        expectShare(fields.readProblemSchoolBank({ sharedBy: 1, sharedAt: beforeEpoch }), 1, beforeEpoch);
        expectCopied(fields.readCopiedFrom({
            type: 'oi',
            id: sourceId,
            title: '来源',
            ownerUid: 1,
            copiedBy: 2,
            copiedAt: epoch,
        }), {
            type: 'oi',
            id: sourceId,
            title: '来源',
            ownerUid: 1,
            copiedBy: 2,
            copiedAt: epoch,
        });
    });

    it('rejects a copy source whose title is a string object', () => {
        const fields = loadFields();
        const copiedAt = new Date('2026-10-16T04:05:06.000Z');
        const sourceId = new ObjectId();
        const title: unknown = new Object('作业一');
        expect(typeof title).to.equal('object');
        expect(title instanceof String).to.equal(true);
        expectInvalid(() => fields.readCopiedFrom({
            type: 'homework',
            id: sourceId,
            title,
            ownerUid: 4,
            copiedBy: 8,
            copiedAt,
        }), 'teach_copied_from_invalid', 'string object title');
    });
});

describe('teach container access', () => {
    it('follows the old homework, contest, and problem-set manage rules', () => {
        const access = loadAccess();
        const ownHomework = { owner: 7, maintainer: [] as number[] };
        const otherHomework = { owner: 8, maintainer: [] as number[] };
        const maintainedHomework = { owner: 8, maintainer: [7] };
        expect(access.canManageTeachContainer(teachActor(7, [PERM.PERM_EDIT_HOMEWORK_SELF]), 'homework', ownHomework)).to.equal(true);
        expect(access.canManageTeachContainer(teachActor(7, [PERM.PERM_EDIT_HOMEWORK_SELF]), 'homework', otherHomework)).to.equal(false);
        expect(access.canManageTeachContainer(teachActor(7, [], [PRIV.PRIV_EDIT_SYSTEM]), 'homework', otherHomework)).to.equal(true);
        expect(access.canManageTeachContainer(teachActor(7, [PERM.PERM_EDIT_HOMEWORK]), 'homework', otherHomework)).to.equal(true);
        expect(access.canManageTeachContainer(teachActor(7, [PERM.PERM_EDIT_HOMEWORK]), 'homework', ownHomework)).to.equal(false);
        expect(access.canManageTeachContainer(teachActor(7, [PERM.PERM_EDIT_HOMEWORK_SELF]), 'homework', maintainedHomework)).to.equal(true);
        expect(access.canManageTeachContainer(teachActor(7, [PERM.PERM_EDIT_HOMEWORK]), 'homework', maintainedHomework)).to.equal(false);
        expect(access.canManageTeachContainer(teachActor(7), 'homework', ownHomework)).to.equal(false);

        for (const type of ['exam', 'acm', 'oi'] as const) {
            expect(access.canManageTeachContainer(teachActor(7, [PERM.PERM_EDIT_CONTEST_SELF]), type, ownHomework)).to.equal(true);
            expect(access.canManageTeachContainer(teachActor(7, [PERM.PERM_EDIT_CONTEST_SELF]), type, otherHomework)).to.equal(false);
            expect(access.canManageTeachContainer(teachActor(7, [], [PRIV.PRIV_EDIT_SYSTEM]), type, otherHomework)).to.equal(true);
            expect(access.canManageTeachContainer(teachActor(7, [PERM.PERM_EDIT_CONTEST]), type, otherHomework)).to.equal(true);
            expect(access.canManageTeachContainer(teachActor(7, [PERM.PERM_EDIT_CONTEST]), type, ownHomework)).to.equal(false);
            expect(access.canManageTeachContainer(teachActor(7, [PERM.PERM_EDIT_CONTEST_SELF]), type, maintainedHomework)).to.equal(true);
            expect(access.canManageTeachContainer(teachActor(7, [PERM.PERM_EDIT_CONTEST]), type, maintainedHomework)).to.equal(false);
        }

        expect(access.canManageTeachContainer(teachActor(7, [], [PRIV.PRIV_EDIT_SYSTEM]), 'practice', otherHomework)).to.equal(true);
        expect(access.canManageTeachContainer(teachActor(7, [PERM.PERM_EDIT_TRAINING]), 'practice', otherHomework)).to.equal(true);
        expect(access.canManageTeachContainer(teachActor(7, [PERM.PERM_EDIT_TRAINING_SELF]), 'practice', ownHomework)).to.equal(true);
        expect(access.canManageTeachContainer(teachActor(7, [PERM.PERM_EDIT_TRAINING_SELF]), 'practice', maintainedHomework)).to.equal(true);
        expect(access.canManageTeachContainer(teachActor(7, [PERM.PERM_EDIT_TRAINING_SELF]), 'practice', otherHomework)).to.equal(false);
        expect(access.canManageTeachContainer(teachActor(7), 'practice', ownHomework)).to.equal(false);
        expect(access.canManageTeachContainer(teachActor(7, [PERM.PERM_EDIT_HOMEWORK_SELF]), 'practice', ownHomework)).to.equal(false);
    });

    it('checks only the create permission that belongs to the teach type', () => {
        const access = loadAccess();
        const training = teachActor(1, [PERM.PERM_CREATE_TRAINING]);
        const contest = teachActor(1, [PERM.PERM_CREATE_CONTEST]);
        const homework = teachActor(1, [PERM.PERM_CREATE_HOMEWORK]);
        const admin = teachActor(1, [], [PRIV.PRIV_EDIT_SYSTEM]);
        const nobody = teachActor(1);
        expect(access.canCreateTeachType(training, 'practice')).to.equal(true);
        expect(access.canCreateTeachType(admin, 'practice')).to.equal(true);
        expect(access.canCreateTeachType(contest, 'practice')).to.equal(false);
        expect(access.canCreateTeachType(homework, 'practice')).to.equal(false);
        expect(access.canCreateTeachType(nobody, 'practice')).to.equal(false);
        expect(access.canCreateTeachType(contest, 'oi')).to.equal(true);
        expect(access.canCreateTeachType(admin, 'oi')).to.equal(true);
        expect(access.canCreateTeachType(training, 'oi')).to.equal(false);
        expect(access.canCreateTeachType(homework, 'oi')).to.equal(false);
        expect(access.canCreateTeachType(homework, 'homework')).to.equal(true);
        expect(access.canCreateTeachType(admin, 'homework')).to.equal(true);
        expect(access.canCreateTeachType(contest, 'homework')).to.equal(false);
        expect(access.canCreateTeachType(training, 'homework')).to.equal(false);
        for (const type of ['exam', 'acm'] as const) {
            expect(access.canCreateTeachType(contest, type)).to.equal(true);
            expect(access.canCreateTeachType(homework, type)).to.equal(false);
            expect(access.canCreateTeachType(training, type)).to.equal(false);
            expect(access.canCreateTeachType(admin, type)).to.equal(true);
        }
    });

    it('reports owner, then maintainer, otherwise admin', () => {
        const access = loadAccess();
        const actor = teachActor(9);
        expect(access.teachRoleOf(actor, { owner: 9, maintainer: [9, 4] })).to.equal('owner');
        expect(access.teachRoleOf(actor, { owner: 2, maintainer: [4, 9] })).to.equal('maintainer');
        expect(access.teachRoleOf(actor, { owner: 2, maintainer: [4] })).to.equal('admin');
        expect(access.teachRoleOf(actor, { owner: 2 })).to.equal('admin');
    });

    it('loads a hidden homework, an oi-family contest, and a problem set', async () => {
        const access = loadAccess();
        const id = new ObjectId();
        contestDoc = { rule: 'homework', owner: 4 };
        const homework = await access.loadTeachContainer(domainId, 'homework', id);
        expect(isRecord(homework) && homework.rule).to.equal('homework');
        expect(sawCall(contestCalls, id)).to.equal(true);

        for (const rule of ['oi', 'ioi', 'strictioi', 'ledo']) {
            contestCalls.length = 0;
            contestDoc = { rule, owner: 4 };
            const loaded = await access.loadTeachContainer(domainId, 'oi', id);
            expect(isRecord(loaded) && loaded.rule).to.equal(rule);
            expect(sawCall(contestCalls, id)).to.equal(true);
        }

        for (const kind of [undefined, null, 'training', 'problem_set'] as const) {
            trainingCalls.length = 0;
            trainingDoc = { owner: 4 };
            if (kind !== undefined) trainingDoc.kind = kind;
            const loaded = await access.loadTeachContainer(domainId, 'practice', id);
            expect(isRecord(loaded) && loaded.owner).to.equal(4);
            if (kind !== undefined) expect(isRecord(loaded) && loaded.kind).to.equal(kind);
            expect(sawCall(trainingCalls, id)).to.equal(true);
        }
    });

    it('rejects an exam read as acm, a hidden non-homework rule, a course, and a missing container', async () => {
        const access = loadAccess();
        const id = new ObjectId();
        contestDoc = { rule: 'exam', owner: 4 };
        await expectNotFound(() => access.loadTeachContainer(domainId, 'acm', id));
        expect(sawCall(contestCalls, id)).to.equal(true);

        resetModels();
        contestRules.exam = { hidden: true };
        contestDoc = { rule: 'exam', owner: 4 };
        await expectNotFound(() => access.loadTeachContainer(domainId, 'exam', id));
        expect(sawCall(contestCalls, id)).to.equal(true);

        resetModels();
        contestRules.codeforces = { hidden: true };
        contestDoc = { rule: 'codeforces', owner: 4 };
        await expectNotFound(() => access.loadTeachContainer(domainId, 'acm', id));
        expect(sawCall(contestCalls, id)).to.equal(true);

        resetModels();
        trainingDoc = { kind: 'course', owner: 4 };
        await expectNotFound(() => access.loadTeachContainer(domainId, 'practice', id));
        expect(sawCall(trainingCalls, id)).to.equal(true);

        resetModels();
        trainingDoc = { kind: 'quiz', owner: 4 };
        await expectNotFound(() => access.loadTeachContainer(domainId, 'practice', id));

        resetModels();
        await expectNotFound(() => access.loadTeachContainer(domainId, 'acm', id));
        expect(sawCall(contestCalls, id)).to.equal(true);

        resetModels();
        await expectNotFound(() => access.loadTeachContainer(domainId, 'practice', id));
        expect(sawCall(trainingCalls, id)).to.equal(true);
    });

    it('requires manage permission after the container type matches', async () => {
        const access = loadAccess();
        const id = new ObjectId();
        contestDoc = { rule: 'acm', owner: 7 };
        const managed = await access.assertTeachManage(domainId, teachActor(7, [PERM.PERM_EDIT_CONTEST_SELF]), 'acm', id);
        expect(isRecord(managed) && managed.rule).to.equal('acm');

        contestDoc = { rule: 'homework', owner: 8 };
        await expectPermission(() => access.assertTeachManage(domainId, teachActor(7, [PERM.PERM_EDIT_HOMEWORK_SELF]), 'homework', id));

        contestDoc = null;
        await expectNotFound(() => access.assertTeachManage(domainId, teachActor(7, [], [PRIV.PRIV_EDIT_SYSTEM]), 'acm', id));

        contestDoc = { rule: 'exam', owner: 7 };
        await expectNotFound(() => access.assertTeachManage(domainId, teachActor(7, [], [PRIV.PRIV_EDIT_SYSTEM]), 'acm', id));

        contestDoc = null;
        trainingDoc = { kind: 'course', owner: 7 };
        await expectNotFound(() => access.assertTeachManage(domainId, teachActor(7, [], [PRIV.PRIV_EDIT_SYSTEM]), 'practice', id));
    });

    it('keeps a contest whose rule is present and explicitly not hidden', async () => {
        const access = loadAccess();
        const id = new ObjectId();
        contestRules.acm = { hidden: false };
        contestDoc = { rule: 'acm', owner: 4 };
        const loaded = await access.loadTeachContainer(domainId, 'acm', id);
        expect(isRecord(loaded) && loaded.rule).to.equal('acm');
        expect(sawCall(contestCalls, id)).to.equal(true);
    });

    it('reports an unsupported contest rule as a missing container', async () => {
        const access = loadAccess();
        const id = new ObjectId();
        contestDoc = { rule: 'hack', owner: 4 };
        await expectNotFound(() => access.loadTeachContainer(domainId, 'acm', id));
        expect(sawCall(contestCalls, id)).to.equal(true);
    });

    it('reports a contest lookup that returns no document as missing', async () => {
        const access = loadAccess();
        const id = new ObjectId();
        contestDoc = undefined;
        await expectNotFound(() => access.loadTeachContainer(domainId, 'exam', id));
        expect(sawCall(contestCalls, id)).to.equal(true);
    });

    it('does not report an unexpected contest lookup failure as a missing container', async () => {
        const access = loadAccess();
        const id = new ObjectId();
        const failure = new Error('database down');
        contestFailure = failure;
        const error = await rejectionOf(() => access.loadTeachContainer(domainId, 'acm', id));
        expect(error).to.equal(failure);
        expect(errorName(error)).to.equal('Error');
        expect(errorText(error).includes('题目集不存在')).to.equal(false);
    });
});
