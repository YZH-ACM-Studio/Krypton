import { expect } from 'chai';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';

(global as any).Hydro ||= { model: {} };
const { PERM, PRIV } = require('../src/model/builtin.ts') as typeof import('../src/model/builtin');

const dbPath = require.resolve('../src/service/db.ts');
const documentPath = require.resolve('../src/model/document.ts');
const trainingPath = require.resolve('../src/model/training.ts');
const accessPath = require.resolve('../src/model/problem-set-access.ts');
const systemPath = require.resolve('../src/model/system.ts');
const redemptionPath = require.resolve('../src/model/redemption.ts');

require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { collection: () => ({ createIndex: async () => 'ok', find: () => ({ toArray: async () => [] }) }) },
} as NodeModule;
require.cache[documentPath] = {
    id: documentPath,
    filename: documentPath,
    loaded: true,
    exports: { TYPE_TRAINING: 40, coll: { find: () => ({ toArray: async () => [] }) } },
} as NodeModule;
require.cache[systemPath] = {
    id: systemPath,
    filename: systemPath,
    loaded: true,
    exports: { get: () => ({ current: 1, keys: { 1: 'aa'.repeat(32) } }), set: async () => undefined },
} as NodeModule;

const granted: any[] = [];
require.cache[accessPath] = {
    id: accessPath,
    filename: accessPath,
    loaded: true,
    exports: {
        ACCESS_ENTITLEMENT_WHOLE_SET_STAGE: 0,
        problemSetAccessService: {
            async grantRedemptionEntitlement(input: any) {
                const existing = granted.find(
                    (row) =>
                        String(row.sourceId) === String(input.sourceId) &&
                        row.uid === input.uid &&
                        row.targetKind === input.targetKind &&
                        String(row.targetId) === String(input.targetId) &&
                        !row.revokedAt,
                );
                if (existing) return existing;
                const doc = { _id: new ObjectId(), revokedAt: null, ...input };
                granted.push(doc);
                return doc;
            },
            async grantStageRedemptionWithClosure(input: any) {
                const docs = (input.tdoc.dag || []).map((node: any) => ({
                    _id: new ObjectId(),
                    stageId: node._id,
                    revokedAt: null,
                    ...input,
                }));
                granted.push(...docs);
                return docs;
            },
            async revokeRedemptionEntitlement(input: any) {
                const current = granted.find((row) => String(row._id) === String(input.entitlementId) && row.uid === input.uid);
                if (!current) throw new Error('entitlement missing');
                current.revokedAt = new Date();
                return current;
            },
            async listActiveBySource(_domainId: string, uid: number, sourceId: ObjectId) {
                return granted.filter((row) => row.uid === uid && String(row.sourceId) === String(sourceId));
            },
            async getEntitlement(_domainId: string, uid: number, entitlementId: ObjectId) {
                return granted.find((row) => row.uid === uid && String(row._id) === String(entitlementId)) || null;
            },
            async evaluate() {
                return { discoverable: true, accessible: true, enrolled: true, sources: [{ kind: 'public' }], stageAccess: 'all' };
            },
        },
    },
} as NodeModule;
require.cache[trainingPath] = {
    id: trainingPath,
    filename: trainingPath,
    loaded: true,
    exports: {
        async get(_domainId: string, tid: ObjectId) {
            return currentTarget && String(currentTarget.docId) === String(tid) ? currentTarget : null;
        },
        async ensureEnrolled() {
            enrollments += 1;
            return true;
        },
    },
} as NodeModule;
delete require.cache[redemptionPath];
const { RedemptionService, normalizeRedemptionCode, redemptionCodeIsWeak } = require(redemptionPath) as typeof import('../src/model/redemption');

const domainId = 'system';
const setId = new ObjectId();
const uid = 42;
let currentTarget: any = { domainId, docId: setId, owner: uid, kind: 'problem_set', dag: [{ _id: 1, title: 'A', requireNids: [], pids: [11] }] };
let enrollments = 0;

function actor(overrides: Record<string, unknown> = {}) {
    const perms = new Set<bigint>([PERM.PERM_CREATE_REDEMPTION_CODE, PERM.PERM_EDIT_TRAINING_SELF, ...(overrides.perms as bigint[] | undefined) || []]);
    return {
        _id: uid,
        hasPerm: (...wanted: bigint[]) => wanted.some((perm) => perms.has(perm)),
        hasPriv: (priv: number) => priv !== PRIV.PRIV_EDIT_SYSTEM,
        own: (doc: { owner?: number }) => doc?.owner === uid,
        ...overrides,
    };
}

function memory<T extends { _id: ObjectId }>(rows: T[]) {
    return {
        async createIndex() {
            return 'ok';
        },
        find(filter: any = {}) {
            return {
                async toArray() {
                    return rows.filter((row) => match(row, filter));
                },
            };
        },
        async findOne(filter: any) {
            return rows.find((row) => match(row, filter)) || null;
        },
        async insertOne(doc: T) {
            if (rows.some((row) => String(row._id) === String(doc._id))) {
                const error: any = new Error('duplicate');
                error.code = 11000;
                throw error;
            }
            if (
                'codeId' in (doc as object) &&
                'uid' in (doc as object) &&
                rows.some(
                    (row: any) =>
                        String(row.codeId) === String((doc as any).codeId) &&
                        row.uid === (doc as any).uid &&
                        row.domainId === (doc as any).domainId,
                )
            ) {
                const error: any = new Error('duplicate');
                error.code = 11000;
                throw error;
            }
            rows.push(doc);
            return { insertedId: doc._id };
        },
        async insertMany(docs: T[]) {
            for (const doc of docs) await this.insertOne(doc);
            return { insertedCount: docs.length };
        },
        async updateOne(filter: any, update: any) {
            const current = rows.find((row) => match(row, filter));
            if (!current) return { matchedCount: 0, modifiedCount: 0 };
            applyUpdate(current, update);
            return { matchedCount: 1, modifiedCount: 1 };
        },
        async findOneAndUpdate(filter: any, update: any) {
            const current = rows.find((row) => match(row, filter));
            if (!current) return null;
            applyUpdate(current, update);
            return current;
        },
        async deleteMany(filter: any) {
            const kept = rows.filter((row) => !match(row, filter));
            rows.length = 0;
            rows.push(...kept);
        },
    };
}

function applyUpdate(current: any, update: any) {
    Object.assign(current, update.$set || {});
    if (update.$inc) {
        for (const [key, value] of Object.entries(update.$inc)) current[key] = (current[key] || 0) + (value as number);
    }
    if (update.$addToSet) {
        for (const [key, value] of Object.entries(update.$addToSet)) {
            const list = current[key] || [];
            if (!list.some((item: unknown) => String(item) === String(value))) list.push(value);
            current[key] = list;
        }
    }
}

function matchValue(actual: unknown, expected: unknown): boolean {
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof ObjectId) && !(expected as any)._bsontype) {
        const ops = expected as Record<string, unknown>;
        if ('$lt' in ops) return typeof actual === 'number' && actual < (ops.$lt as number);
        if ('$ne' in ops) return String(actual) !== String(ops.$ne) && actual !== ops.$ne;
        if ('$nin' in ops) {
            const list = Array.isArray(actual) ? actual : [];
            return !(ops.$nin as unknown[]).some((item) => list.some((entry) => String(entry) === String(item)));
        }
        if ('$in' in ops) return (ops.$in as unknown[]).some((item) => String(actual) === String(item));
    }
    if (expected instanceof ObjectId || (expected && typeof expected === 'object' && (expected as any)._bsontype)) {
        return String(actual) === String(expected);
    }
    if (expected === null) return actual === null || actual === undefined;
    return actual === expected || String(actual) === String(expected);
}

function match(row: any, filter: any) {
    for (const [key, value] of Object.entries(filter || {})) {
        if (!matchValue(row[key], value)) return false;
    }
    return true;
}

function service() {
    granted.length = 0;
    enrollments = 0;
    return new RedemptionService({
        batches: memory([]) as any,
        codes: memory([]) as any,
        redemptions: memory([]) as any,
        hmacKeys: async () => ({ current: 1, keys: { 1: 'ab'.repeat(32) } }),
        loadTraining: async () => currentTarget,
        findStudentGroupIds: async () => new Set(['g1']),
        randomCode: () => 'AUTOCODE-1',
    });
}

describe('P3.6 redemption codes', () => {
    it('normalizes by trimming only and rejects control characters', () => {
        expect(normalizeRedemptionCode('  AbC 1  ')).to.equal('AbC 1');
        expect(redemptionCodeIsWeak('1234')).to.equal(true);
        expect(() => normalizeRedemptionCode('bad\ncode')).to.throw();
    });

    it('creates a single-use code, redeems atomically, and is idempotent for the same user', async () => {
        const redemption = service();
        const created = await redemption.createBatch({
            domainId,
            user: actor(),
            targetKind: 'problem_set',
            targetId: setId,
            kind: 'single',
            count: 1,
        });
        expect(created.plaintext).to.have.length(1);
        const first = await redemption.redeem({ domainId, uid, user: actor(), code: created.plaintext[0].code });
        const again = await redemption.redeem({ domainId, uid, user: actor(), code: created.plaintext[0].code });
        expect(String(again._id)).to.equal(String(first._id));
        expect(enrollments).to.equal(1);
        expect(granted).to.have.length(1);
        await expectReject(redemption.redeem({ domainId, uid: 99, user: actor({ _id: 99 }), code: created.plaintext[0].code }));
    });

    it('keeps a limited code from overselling the last slot', async () => {
        const redemption = service();
        const created = await redemption.createBatch({
            domainId,
            user: actor(),
            targetKind: 'problem_set',
            targetId: setId,
            kind: 'limited',
            maxUses: 1,
            count: 1,
            manualCodes: ['Limited-One-99'],
        });
        expect(created.warning).to.equal(undefined);
        await redemption.redeem({ domainId, uid, user: actor(), code: 'Limited-One-99' });
        await expectReject(redemption.redeem({ domainId, uid: 7, user: actor({ _id: 7 }), code: 'Limited-One-99' }));
    });

    it('freezes target edits after the first redemption', async () => {
        const redemption = service();
        const created = await redemption.createBatch({
            domainId,
            user: actor(),
            targetKind: 'problem_set',
            targetId: setId,
            kind: 'single',
            manualCodes: ['FreezeMe12'],
        });
        await redemption.redeem({ domainId, uid, user: actor(), code: 'FreezeMe12' });
        await expectReject(
            redemption.editBatch({
                domainId,
                user: actor(),
                batchId: created.batch._id,
                allowedGroupIds: ['g2'],
            }),
        );
        const edited = await redemption.editBatch({
            domainId,
            user: actor(),
            batchId: created.batch._id,
            note: 'keep',
            maxUses: 2,
        });
        expect(edited.codes[0].maxUses).to.equal(2);
        expect(edited.codes[0].note).to.equal('keep');
    });

    it('refuses to shorten expiry after the first redemption', async () => {
        const redemption = service();
        const created = await redemption.createBatch({
            domainId,
            user: actor(),
            targetKind: 'problem_set',
            targetId: setId,
            kind: 'single',
            expiresAt: new Date('2027-01-01T00:00:00Z'),
            manualCodes: ['ExpireLater1'],
        });
        await redemption.redeem({ domainId, uid, user: actor(), code: 'ExpireLater1' });
        await expectReject(
            redemption.editBatch({
                domainId,
                user: actor(),
                batchId: created.batch._id,
                expiresAt: new Date('2026-01-01T00:00:00Z'),
            }),
        );
    });

    it('hides a deleted target as a missing code and refuses a revoked source on retry', async () => {
        const redemption = service();
        const created = await redemption.createBatch({
            domainId,
            user: actor(),
            targetKind: 'problem_set',
            targetId: setId,
            kind: 'single',
            manualCodes: ['RevokeRetry1'],
        });
        const first = await redemption.redeem({ domainId, uid, user: actor(), code: 'RevokeRetry1' });
        expect(first.entitlementIds).to.have.length(1);
        const revoked = await redemption.revokeUserSource({
            domainId,
            user: actor(),
            uid,
            entitlementId: first.entitlementIds[0],
        });
        expect(revoked.revoked).to.have.length(1);
        expect(revoked.remainingSources.map((source) => source.kind)).to.deep.equal(['public']);
        await expectReject(redemption.redeem({ domainId, uid, user: actor(), code: 'RevokeRetry1' }));
        const missing = service();
        await missing.createBatch({
            domainId,
            user: actor(),
            targetKind: 'problem_set',
            targetId: setId,
            kind: 'single',
            manualCodes: ['DeletedTarget'],
        });
        currentTarget = null;
        try {
            await missing.redeem({ domainId, uid, user: actor(), code: 'DeletedTarget' });
            expect.fail('expected missing target to fail closed');
        } catch (error: any) {
            expect(error.name).to.equal('NotFoundError');
            expect(String(error.message || error.params || '')).to.not.include(String(setId));
        } finally {
            currentTarget = { domainId, docId: setId, owner: uid, kind: 'problem_set', dag: [{ _id: 1, title: 'A', requireNids: [], pids: [11] }] };
        }
    });
});

async function expectReject(work: Promise<unknown>) {
    try {
        await work;
        expect.fail('expected rejection');
    } catch (error) {
        expect(error).to.be.instanceOf(Error);
    }
}
