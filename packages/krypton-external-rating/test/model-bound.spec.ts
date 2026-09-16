import { expect } from 'chai';
import { PERM, PRIV } from '@hydrooj/common';
import {
    CreateError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
    localizedErrorText,
} from '@hydrooj/framework';
import { after, beforeEach, describe, it } from 'node:test';

const Module = require('module');
const modelPath = require.resolve('../src/model.ts');
const originalLoad = Module._load;

class PermissionError extends ForbiddenError {
    name = 'PermissionError';
}

// CreateError is a factory, not a constructor.
// eslint-disable-next-line unicorn/throw-new-error
const UserNotFoundError = CreateError('UserNotFoundError', NotFoundError, 'User {0} not found.');

interface StudentRow {
    boundUserId?: number | null;
}

interface UserDoc {
    _id: number;
    externalRating?: unknown;
}

const students = new Map<number, StudentRow | null>();
const users = new Map<number, UserDoc>();
const findStudentCalls: Array<{ domainId: string; userId: number }> = [];
const findOneCalls: Array<{ _id?: number }> = [];
const setByIdCalls: Array<{ uid: number; $set?: Record<string, unknown> }> = [];

async function findStudentByUserId(domainId: string, userId: number): Promise<StudentRow | null> {
    findStudentCalls.push({ domainId, userId });
    if (!students.has(userId)) return null;
    return students.get(userId) ?? null;
}

const UserModel = {
    coll: {
        async findOne(filter: { _id?: number }) {
            findOneCalls.push({ ...filter });
            const uid = filter._id;
            if (typeof uid !== 'number') return null;
            const doc = users.get(uid);
            return doc ? { ...doc } : null;
        },
    },
    async setById(uid: number, $set?: Record<string, unknown>) {
        setByIdCalls.push({ uid, $set: $set ? structuredClone($set) : undefined });
        const existing = users.get(uid);
        if (!existing) return null;
        const next = { ...existing, ...($set || {}) } as UserDoc;
        users.set(uid, next);
        return { ...next };
    },
};

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (request === 'hydrooj' && parent?.filename === modelPath) {
        return {
            CreateError,
            ForbiddenError,
            PERM,
            PRIV,
            PermissionError,
            UserModel,
            UserNotFoundError,
            ValidationError,
            localizedErrorText,
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

interface ExternalRatingActor {
    _id: number;
    hasPerm(perm: bigint): boolean;
    hasPriv(priv: number): boolean;
}

interface SiteSnapshot {
    handle: string;
    rating: number | null;
    fetchedAt: Date | null;
    lastError: string | null;
    publicShow: boolean;
}

interface SavedState {
    codeforces: SiteSnapshot;
    nowcoder: SiteSnapshot;
}

interface ModelApi {
    USER_EXTERNAL_RATING_KEY: 'externalRating';
    ExternalRatingUnboundError: new () => Error;
    saveHandlesAndFlags(input: {
        actor: ExternalRatingActor;
        targetUid: number;
        domainId: string;
        handles?: Record<string, unknown>;
        flags?: Record<string, unknown>;
    }): Promise<SavedState>;
}

// Mirrors the production view in src/model.ts: the bridge is read as `unknown`
// and narrowed at runtime, so the fake does not have to satisfy the full
// hydrooj-declared bridge interface. Intentionally not intersected with
// `typeof globalThis`, which would re-impose that interface here.
interface HydroGlobal {
    Hydro?: { model?: { userbind?: unknown } };
}

const hydroGlobal: HydroGlobal = globalThis;
const originalHydro = hydroGlobal.Hydro;

let model: ModelApi;
try {
    delete require.cache[modelPath];
    model = require(modelPath) as ModelApi;
} finally {
    Module._load = originalLoad;
}

const { saveHandlesAndFlags, ExternalRatingUnboundError, USER_EXTERNAL_RATING_KEY } = model;

const DOMAIN = 'system';
const TARGET_UID = 10;
const TEACHER_UID = 2;
const FETCHED_AT = new Date('2026-09-13T08:00:00.000Z');

function actor(id: number, options: { privs?: number[]; perms?: bigint[] } = {}): ExternalRatingActor {
    const privs = new Set(options.privs ?? []);
    const perms = new Set(options.perms ?? []);
    return {
        _id: id,
        hasPriv(priv: number) {
            return privs.has(priv);
        },
        hasPerm(perm: bigint) {
            return perms.has(perm);
        },
    };
}

function bind(uid: number, row: StudentRow | null = { boundUserId: uid }): void {
    students.set(uid, row);
}

function seedUser(uid: number, externalRating?: unknown): void {
    const doc: UserDoc = { _id: uid };
    if (externalRating !== undefined) doc.externalRating = externalRating;
    users.set(uid, doc);
}

async function expectNamed(run: () => Promise<unknown>, name: string): Promise<Error> {
    try {
        await run();
    } catch (error) {
        expect((error as Error).name).to.equal(name);
        return error as Error;
    }
    expect.fail(`expected ${name}`);
    throw new Error('unreachable');
}

function emptySite(): SiteSnapshot {
    return {
        handle: '',
        rating: null,
        fetchedAt: null,
        lastError: null,
        publicShow: false,
    };
}

beforeEach(() => {
    students.clear();
    users.clear();
    findStudentCalls.length = 0;
    findOneCalls.length = 0;
    setByIdCalls.length = 0;
    hydroGlobal.Hydro = {
        model: {
            userbind: {
                findStudentByUserId,
            },
        },
    };
});

after(() => {
    if (originalHydro === undefined) delete hydroGlobal.Hydro;
    else hydroGlobal.Hydro = originalHydro;
});

describe('krypton-external-rating saveHandlesAndFlags bound gate', { concurrency: false }, () => {
    it('throws ExternalRatingUnboundError when the target is unbound', async () => {
        const self = actor(TARGET_UID);
        const teacher = actor(TEACHER_UID, { privs: [PRIV.PRIV_EDIT_SYSTEM] });
        seedUser(TARGET_UID);

        const cases: Array<{ actor: ExternalRatingActor; student: StudentRow | null | undefined; label: string }> = [
            { actor: self, student: undefined, label: 'missing roster row' },
            { actor: self, student: null, label: 'null student' },
            { actor: self, student: { boundUserId: null }, label: 'null boundUserId' },
            { actor: self, student: { boundUserId: 99 }, label: 'boundUserId mismatch' },
            { actor: teacher, student: undefined, label: 'teacher cannot write unbound target' },
            { actor: teacher, student: { boundUserId: TEACHER_UID }, label: 'teacher boundUserId is not the target' },
        ];

        for (const testCase of cases) {
            students.clear();
            findStudentCalls.length = 0;
            findOneCalls.length = 0;
            setByIdCalls.length = 0;
            if (testCase.student !== undefined) bind(TARGET_UID, testCase.student);

            const error = await expectNamed(
                () => saveHandlesAndFlags({
                    actor: testCase.actor,
                    targetUid: TARGET_UID,
                    domainId: DOMAIN,
                    handles: { codeforces: 'tourist' },
                }),
                'ExternalRatingUnboundError',
            );
            expect(error, testCase.label).to.be.instanceOf(ExternalRatingUnboundError);
            expect(findStudentCalls).to.deep.equal([{ domainId: DOMAIN, userId: TARGET_UID }]);
            expect(findOneCalls).to.deep.equal([]);
            expect(setByIdCalls).to.deep.equal([]);
        }
    });

    it('lets a teacher with PRIV_EDIT_SYSTEM write a bound target', async () => {
        bind(TARGET_UID);
        seedUser(TARGET_UID);
        const teacher = actor(TEACHER_UID, { privs: [PRIV.PRIV_EDIT_SYSTEM] });
        expect(teacher.hasPerm(PERM.PERM_USERBIND_MANAGE_STUDENTS)).to.equal(false);

        const saved = await saveHandlesAndFlags({
            actor: teacher,
            targetUid: TARGET_UID,
            domainId: DOMAIN,
            handles: { codeforces: 'tourist' },
            flags: { codeforces: { publicShow: true } },
        });

        expect(teacher._id).to.not.equal(TARGET_UID);
        expect(findStudentCalls).to.deep.equal([{ domainId: DOMAIN, userId: TARGET_UID }]);
        expect(saved.codeforces).to.deep.equal({
            handle: 'tourist',
            rating: null,
            fetchedAt: null,
            lastError: null,
            publicShow: true,
        });
        expect(saved.nowcoder).to.deep.equal(emptySite());
        expect(setByIdCalls).to.have.lengthOf(1);
        expect(setByIdCalls[0].uid).to.equal(TARGET_UID);
        expect(setByIdCalls[0].$set).to.deep.equal({
            [USER_EXTERNAL_RATING_KEY]: {
                codeforces: saved.codeforces,
                nowcoder: saved.nowcoder,
            },
        });
        expect(users.get(TARGET_UID)?.[USER_EXTERNAL_RATING_KEY]).to.deep.equal(saved);

        const stranger = actor(TEACHER_UID);
        setByIdCalls.length = 0;
        findOneCalls.length = 0;
        const denied = await expectNamed(
            () => saveHandlesAndFlags({
                actor: stranger,
                targetUid: TARGET_UID,
                domainId: DOMAIN,
                handles: { codeforces: 'Petr' },
            }),
            'PermissionError',
        );
        expect(denied).to.be.instanceOf(PermissionError);
        expect(setByIdCalls).to.deep.equal([]);
        expect(findOneCalls).to.deep.equal([]);
    });

    it('rejects client snapshot fields', async () => {
        bind(TARGET_UID);
        seedUser(TARGET_UID);
        const self = actor(TARGET_UID);
        const payloads: Array<{ handles?: Record<string, unknown>; flags?: Record<string, unknown>; field: string }> = [
            { handles: { codeforces: 'tourist', rating: 3301 }, field: 'rating' },
            { handles: { codeforces: 'tourist', fetchedAt: FETCHED_AT.toISOString() }, field: 'fetchedAt' },
            { handles: { nowcoder: 'alice', lastError: 'timeout' }, field: 'lastError' },
            { handles: { codeforces: { handle: 'tourist', rating: 3301 } }, field: 'rating' },
            { flags: { codeforces: { publicShow: true, rating: 3301 } }, field: 'rating' },
            { flags: { nowcoder: { publicShow: false, fetchedAt: FETCHED_AT } }, field: 'fetchedAt' },
            { flags: { lastError: 'timeout' }, field: 'lastError' },
            {
                handles: { codeforces: 'tourist' },
                flags: { codeforces: { publicShow: true, lastError: 'timeout' } },
                field: 'lastError',
            },
        ];

        for (const payload of payloads) {
            findStudentCalls.length = 0;
            findOneCalls.length = 0;
            setByIdCalls.length = 0;
            const error = await expectNamed(
                () => saveHandlesAndFlags({
                    actor: self,
                    targetUid: TARGET_UID,
                    domainId: DOMAIN,
                    handles: payload.handles,
                    flags: payload.flags,
                }),
                'ExternalRatingSnapshotFieldError',
            );
            expect((error as Error & { field?: string }).field).to.equal(payload.field);
            expect(findStudentCalls).to.deep.equal([{ domainId: DOMAIN, userId: TARGET_UID }]);
            expect(findOneCalls).to.deep.equal([]);
            expect(setByIdCalls).to.deep.equal([]);
        }
    });
});
