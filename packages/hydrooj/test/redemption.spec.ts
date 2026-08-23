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
                const doc = { _id: new ObjectId(), ...input };
                granted.push(doc);
                return doc;
            },
            async grantStageRedemptionWithClosure(input: any) {
                const docs = (input.tdoc.dag || []).map((node: any) => ({ _id: new ObjectId(), stageId: node._id, ...input }));
                granted.push(...docs);
                return docs;
            },
            async revokeRedemptionEntitlement(input: any) {
                return { ...input, revokedAt: new Date() };
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
            rows.push(doc);
            return { insertedId: doc._id };
        },
        async insertMany(docs: T[]) {
            for (const doc of docs) await this.insertOne(doc);
            return { insertedCount: docs.length };
        },
        async updateOne(filter: any, update: any) {
            const current = rows.find((row) => match(row, filter));
            if (!current) return { modifiedCount: 0 };
            Object.assign(current, update.$set || {});
            if (update.$inc) {
                for (const [key, value] of Object.entries(update.$inc)) (current as any)[key] = ((current as any)[key] || 0) + (value as number);
            }
            return { modifiedCount: 1 };
        },
        async findOneAndUpdate(filter: any, update: any) {
            const current = rows.find((row) => match(row, filter));
            if (!current) return null;
            Object.assign(current, update.$set || {});
            if (update.$inc) {
                for (const [key, value] of Object.entries(update.$inc)) (current as any)[key] = ((current as any)[key] || 0) + (value as number);
            }
            return current;
        },
        async deleteMany(filter: any) {
            const kept = rows.filter((row) => !match(row, filter));
            rows.length = 0;
            rows.push(...kept);
        },
    };
}

function match(row: any, filter: any) {
    for (const [key, value] of Object.entries(filter || {})) {
        if (key === 'usedCount' && value && typeof value === 'object' && '$lt' in (value as any)) {
            if (!(row.usedCount < (value as any).$lt)) return false;
            continue;
        }
        if (value instanceof ObjectId || (value && typeof value === 'object' && (value as any)._bsontype)) {
            if (String(row[key]) !== String(value)) return false;
            continue;
        }
        if (row[key] !== value && String(row[key]) !== String(value)) return false;
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
});

async function expectReject(work: Promise<unknown>) {
    try {
        await work;
        expect.fail('expected rejection');
    } catch (error) {
        expect(error).to.be.instanceOf(Error);
    }
}
