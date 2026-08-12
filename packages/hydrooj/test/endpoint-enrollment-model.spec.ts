import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import type { EndpointEnrollmentBatchDoc, EndpointEnrollmentError as EndpointEnrollmentErrorType } from '../src/model/endpoint-enrollment';

function sameValue(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId || right instanceof ObjectId) return String(left) === String(right);
    return left === right;
}

function valueAt(source: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((value, key) => {
        if (Array.isArray(value)) return value.map((item) => valueAt(item, key));
        if (!value || typeof value !== 'object') return undefined;
        return (value as Record<string, unknown>)[key];
    }, source);
}

function cloneDoc(doc: EndpointEnrollmentBatchDoc): EndpointEnrollmentBatchDoc {
    return {
        ...doc,
        _id: new ObjectId(doc._id),
        expiresAt: new Date(doc.expiresAt),
        createdAt: new Date(doc.createdAt),
        updatedAt: new Date(doc.updatedAt),
        ...(doc.revokedAt ? { revokedAt: new Date(doc.revokedAt) } : {}),
        claims: doc.claims.map((claim) => ({
            ...claim,
            reservedAt: new Date(claim.reservedAt),
            ...(claim.finalizedAt ? { finalizedAt: new Date(claim.finalizedAt) } : {}),
        })),
    };
}

class MemoryCollection {
    docs: EndpointEnrollmentBatchDoc[] = [];
    indexes: Array<{ key: Record<string, number>; options: Record<string, unknown> }> = [];

    async createIndex(key: Record<string, number>, options: Record<string, unknown> = {}) {
        this.indexes.push({ key, options });
        return String(options.name || 'index');
    }

    async insertOne(doc: EndpointEnrollmentBatchDoc) {
        if (this.docs.some((candidate) => candidate.codeDigest === doc.codeDigest)) {
            throw Object.assign(new Error('duplicate key'), {
                code: 11000,
                keyPattern: { codeDigest: 1 },
                keyValue: { codeDigest: doc.codeDigest },
            });
        }
        this.docs.push(cloneDoc(doc));
        return { insertedId: doc._id };
    }

    async findOne(filter: Record<string, unknown>) {
        return this.docs.find((doc) => this.matches(doc, filter)) || null;
    }

    find(filter: Record<string, unknown>) {
        let rows = this.docs.filter((doc) => this.matches(doc, filter));
        return {
            sort: (sort: Record<string, number>) => {
                const [field, direction] = Object.entries(sort)[0];
                rows = [...rows].sort((left, right) => direction * (Number(valueAt(left, field)) - Number(valueAt(right, field))));
                return {
                    limit: (count: number) => ({
                        toArray: async () => rows.slice(0, count),
                    }),
                };
            },
        };
    }

    async findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, unknown>) {
        const index = this.docs.findIndex((doc) => this.matches(doc, filter));
        if (index === -1) return null;
        const next = cloneDoc(this.docs[index]);
        Object.assign(next, (update.$set as Record<string, unknown> | undefined) || {});
        for (const [field, amount] of Object.entries((update.$inc as Record<string, number> | undefined) || {})) {
            (next as unknown as Record<string, unknown>)[field] = Number(valueAt(next, field) || 0) + amount;
        }
        const push = (update.$push as Record<string, unknown> | undefined) || {};
        for (const [field, value] of Object.entries(push)) {
            ((next as unknown as Record<string, unknown>)[field] as unknown[]).push(structuredClone(value));
        }
        this.docs[index] = next;
        return cloneDoc(next);
    }

    async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options: Record<string, unknown> = {}) {
        const index = this.docs.findIndex((doc) => this.matches(doc, filter));
        if (index === -1) return { matchedCount: 0, modifiedCount: 0 };
        const next = cloneDoc(this.docs[index]);
        const set = (update.$set as Record<string, unknown> | undefined) || {};
        const arrayFilters = (options.arrayFilters as Array<Record<string, unknown>> | undefined) || [];
        for (const [field, value] of Object.entries(set)) {
            if (field.startsWith('claims.$[claim].')) {
                const claimId = arrayFilters[0]?.['claim.claimId'];
                const key = field.slice('claims.$[claim].'.length);
                const claim = next.claims.find((candidate) => candidate.claimId === claimId);
                if (claim) (claim as unknown as Record<string, unknown>)[key] = structuredClone(value);
            } else {
                (next as unknown as Record<string, unknown>)[field] = value;
            }
        }
        for (const [field, amount] of Object.entries((update.$inc as Record<string, number> | undefined) || {})) {
            (next as unknown as Record<string, unknown>)[field] = Number(valueAt(next, field) || 0) + amount;
        }
        this.docs[index] = next;
        return { matchedCount: 1, modifiedCount: 1 };
    }

    private matches(doc: EndpointEnrollmentBatchDoc, filter: Record<string, unknown>): boolean {
        return Object.entries(filter).every(([field, expected]) => {
            if (field === '$expr') {
                const expr = expected as { $lt: [string, string] };
                const [left, right] = expr.$lt;
                return Number(valueAt(doc, left.slice(1))) < Number(valueAt(doc, right.slice(1)));
            }
            const actual = valueAt(doc, field);
            if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof ObjectId)) {
                const operators = expected as Record<string, unknown>;
                if ('$elemMatch' in operators) {
                    if (!Array.isArray(actual)) return false;
                    return actual.some((item) => this.matches(item as EndpointEnrollmentBatchDoc, operators.$elemMatch as Record<string, unknown>));
                }
                if ('$exists' in operators) return operators.$exists ? actual !== undefined : actual === undefined;
                if ('$gt' in operators && (!(actual instanceof Date) || !(operators.$gt instanceof Date) || actual <= operators.$gt)) {
                    return false;
                }
                if ('$lt' in operators && (typeof actual !== 'number' || actual >= Number(operators.$lt))) return false;
                if ('$ne' in operators) {
                    const values = Array.isArray(actual) ? actual.flat(Infinity) : [actual];
                    if (values.some((value) => sameValue(value, operators.$ne))) return false;
                }
                return true;
            }
            return sameValue(actual, expected);
        });
    }
}

const dbPath = require.resolve('../src/service/db.ts');
const previousDbCache = require.cache[dbPath];
const productionCollection = new MemoryCollection();
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
        __esModule: true,
        default: { collection: () => productionCollection },
    },
} as NodeModule;
(global as unknown as { Hydro: { model: Record<string, unknown> } }).Hydro = { model: {} };
const enrollmentModule = require('../src/model/endpoint-enrollment.ts') as typeof import('../src/model/endpoint-enrollment');
if (previousDbCache) require.cache[dbPath] = previousDbCache;
else delete require.cache[dbPath];

const { EndpointEnrollmentBatchService, EndpointEnrollmentError } = enrollmentModule;

const fixedCode = `KVE1-${'A'.repeat(32)}`;
const publicKeyFingerprint = '1'.repeat(64);
const machineFingerprint = '2'.repeat(64);

function makeService() {
    const batches = new MemoryCollection();
    let now = new Date('2026-08-10T05:00:00.000Z');
    const service = new EndpointEnrollmentBatchService({
        batches: batches as never,
        now: () => now,
        idFactory: () => new ObjectId('66b800000000000000000001'),
        codeFactory: () => fixedCode,
    });
    return { service, batches, setNow: (value: Date) => (now = value) };
}

async function capture(run: () => Promise<unknown>): Promise<EndpointEnrollmentErrorType | null> {
    try {
        await run();
        return null;
    } catch (error) {
        return error as EndpointEnrollmentErrorType;
    }
}

describe('endpoint enrollment batch canonical model', () => {
    it('stores only a digest and creates the exact lookup indexes', async () => {
        const { service, batches } = makeService();
        await service.ensureIndexes();
        expect(batches.indexes).to.deep.equal([
            { key: { codeDigest: 1 }, options: { name: 'endpointEnrollmentCode', unique: true } },
            { key: { 'claims.claimId': 1 }, options: { name: 'endpointEnrollmentClaim', unique: true, sparse: true } },
            { key: { domainId: 1, status: 1, updatedAt: -1 }, options: { name: 'endpointEnrollmentAdminList' } },
        ]);

        const created = await service.createBatch({
            domainId: 'system',
            actorUid: 1,
            expiresAt: new Date('2026-08-10T06:00:00.000Z'),
            maxEnrollments: 2,
        });
        expect(created.enrollmentCode).to.equal(fixedCode);
        expect(batches.docs[0]).not.to.have.property('enrollmentCode');
        expect(batches.docs[0].codeDigest).to.equal(createHash('sha256').update(fixedCode).digest('hex'));
        expect(batches.docs[0]).to.include({ usedCount: 0, maxEnrollments: 2, status: 'active', revision: 1 });

        const tooLong = await capture(() =>
            service.createBatch({
                domainId: 'system',
                actorUid: 1,
                expiresAt: new Date('2026-08-11T05:00:00.001Z'),
                maxEnrollments: 1,
            }),
        );
        expect(tooLong?.reason).to.equal('invalid_expiry');
    });

    it('consumes capacity atomically and makes an identical claim idempotent', async () => {
        const { service, batches } = makeService();
        const { batch } = await service.createBatch({
            domainId: 'system',
            actorUid: 1,
            expiresAt: new Date('2026-08-10T06:00:00.000Z'),
            maxEnrollments: 2,
        });
        const input = {
            enrollmentCode: fixedCode,
            claimId: 'claim_1234567890abcdef',
            publicKeyFingerprint,
            machineFingerprint,
            hostname: 'LAB-PC-01',
        };
        const first = await service.consume(input);
        const second = await service.consume(input);
        expect(second).to.deep.equal(first);
        expect(batches.docs[0].usedCount).to.equal(1);
        expect(batches.docs[0].claims).to.have.length(1);

        const finalized = await service.finalize({ batchId: batch._id, claimId: input.claimId, endpointId: 'ep_1234567890abcdef' });
        expect(finalized.claims[0]).to.include({ endpointId: 'ep_1234567890abcdef' });
        expect((await service.consume(input)).endpointId).to.equal('ep_1234567890abcdef');

        const mismatch = await capture(() => service.consume({ ...input, machineFingerprint: '3'.repeat(64) }));
        expect(mismatch).to.be.instanceOf(EndpointEnrollmentError);
        expect(mismatch?.reason).to.equal('claim_mismatch');
    });

    it('rejects a second claim for the same physical machine in one deployment batch', async () => {
        const { service, batches } = makeService();
        await service.createBatch({
            domainId: 'system',
            actorUid: 1,
            expiresAt: new Date('2026-08-10T06:00:00.000Z'),
            maxEnrollments: 3,
        });
        await service.consume({
            enrollmentCode: fixedCode,
            claimId: 'claim_first_boot_1234',
            publicKeyFingerprint,
            machineFingerprint,
            hostname: 'LAB-PC-01',
        });

        const restoredCloneAttempt = await capture(() =>
            service.consume({
                enrollmentCode: fixedCode,
                claimId: 'claim_after_restore_1',
                publicKeyFingerprint: '3'.repeat(64),
                machineFingerprint,
                hostname: 'LAB-PC-01',
            }),
        );

        expect(restoredCloneAttempt).to.be.instanceOf(EndpointEnrollmentError);
        expect(restoredCloneAttempt?.reason).to.equal('machine_already_claimed');
        expect(batches.docs[0].usedCount).to.equal(1);
        expect(batches.docs[0].claims).to.have.length(1);
    });

    it('rejects expired, exhausted and revoked batches with stable reasons', async () => {
        const expired = makeService();
        await expired.service.createBatch({
            domainId: 'system',
            actorUid: 1,
            expiresAt: new Date('2026-08-10T05:01:00.000Z'),
            maxEnrollments: 1,
        });
        expired.setNow(new Date('2026-08-10T05:01:00.000Z'));
        const base = {
            enrollmentCode: fixedCode,
            claimId: 'claim_expired_123456',
            publicKeyFingerprint,
            machineFingerprint,
            hostname: 'LAB-PC-01',
        };
        expect((await capture(() => expired.service.consume(base)))?.reason).to.equal('expired');

        const exhausted = makeService();
        await exhausted.service.createBatch({
            domainId: 'system',
            actorUid: 1,
            expiresAt: new Date('2026-08-10T06:00:00.000Z'),
            maxEnrollments: 1,
        });
        await exhausted.service.consume({ ...base, claimId: 'claim_first_12345678' });
        expect(
            (
                await capture(() =>
                    exhausted.service.consume({
                        ...base,
                        claimId: 'claim_second_1234567',
                        machineFingerprint: '4'.repeat(64),
                    }),
                )
            )?.reason,
        ).to.equal('exhausted');

        const revoked = makeService();
        const { batch } = await revoked.service.createBatch({
            domainId: 'system',
            actorUid: 1,
            expiresAt: new Date('2026-08-10T06:00:00.000Z'),
            maxEnrollments: 1,
        });
        await revoked.service.revokeBatch({ batchId: batch._id, actorUid: 2, expectedRevision: 1 });
        expect((await capture(() => revoked.service.consume(base)))?.reason).to.equal('revoked');
    });

    it('does not complete an unfinished claim after its batch is revoked or expired', async () => {
        const revoked = makeService();
        const { batch: revokedBatch } = await revoked.service.createBatch({
            domainId: 'system',
            actorUid: 1,
            expiresAt: new Date('2026-08-10T06:00:00.000Z'),
            maxEnrollments: 1,
        });
        const revokedInput = {
            enrollmentCode: fixedCode,
            claimId: 'claim_revoked_123456',
            publicKeyFingerprint,
            machineFingerprint,
            hostname: 'LAB-PC-01',
        };
        await revoked.service.consume(revokedInput);
        await revoked.service.revokeBatch({ batchId: revokedBatch._id, actorUid: 2, expectedRevision: 2 });
        expect((await capture(() => revoked.service.consume(revokedInput)))?.reason).to.equal('revoked');
        expect(
            (
                await capture(() =>
                    revoked.service.finalize({
                        batchId: revokedBatch._id,
                        claimId: revokedInput.claimId,
                        endpointId: 'ep_1234567890abcdef',
                    }),
                )
            )?.reason,
        ).to.equal('revoked');

        const expired = makeService();
        const { batch: expiredBatch } = await expired.service.createBatch({
            domainId: 'system',
            actorUid: 1,
            expiresAt: new Date('2026-08-10T05:01:00.000Z'),
            maxEnrollments: 1,
        });
        const expiredInput = { ...revokedInput, claimId: 'claim_expired_123456' };
        await expired.service.consume(expiredInput);
        expired.setNow(new Date('2026-08-10T05:01:00.000Z'));
        expect((await capture(() => expired.service.consume(expiredInput)))?.reason).to.equal('expired');
        expect(
            (
                await capture(() =>
                    expired.service.finalize({
                        batchId: expiredBatch._id,
                        claimId: expiredInput.claimId,
                        endpointId: 'ep_1234567890abcdef',
                    }),
                )
            )?.reason,
        ).to.equal('expired');
    });

    it('binds a replacement batch to exactly one old endpoint', async () => {
        const { service } = makeService();
        const { batch } = await service.createBatch({
            domainId: 'system',
            actorUid: 1,
            expiresAt: new Date('2026-08-10T06:00:00.000Z'),
            maxEnrollments: 1,
            replacesEndpointId: 'ep_old_1234567890',
        });
        expect(batch).to.include({ replacesEndpointId: 'ep_old_1234567890', maxEnrollments: 1 });

        const invalid = await capture(() =>
            service.createBatch({
                domainId: 'system',
                actorUid: 1,
                expiresAt: new Date('2026-08-10T06:00:00.000Z'),
                maxEnrollments: 2,
                replacesEndpointId: 'ep_old_1234567890',
            }),
        );
        expect(invalid?.reason).to.equal('replacement_capacity');
    });
});
