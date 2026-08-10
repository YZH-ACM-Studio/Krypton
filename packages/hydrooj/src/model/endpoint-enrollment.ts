import { createHash, randomBytes } from 'node:crypto';
import { Collection, ObjectId } from 'mongodb';
import db from '../service/db';

export type EndpointEnrollmentBatchStatus = 'active' | 'revoked';

export interface EndpointEnrollmentClaim {
    claimId: string;
    publicKeyFingerprint: string;
    machineFingerprint: string;
    hostname: string;
    reservedAt: Date;
    endpointId?: string;
    finalizedAt?: Date;
}

export interface EndpointEnrollmentBatchDoc {
    _id: ObjectId;
    domainId: string;
    codeDigest: string;
    codeHint: string;
    status: EndpointEnrollmentBatchStatus;
    expiresAt: Date;
    maxEnrollments: number;
    usedCount: number;
    claims: EndpointEnrollmentClaim[];
    replacesEndpointId?: string;
    createdBy: number;
    createdAt: Date;
    updatedBy: number;
    updatedAt: Date;
    revokedBy?: number;
    revokedAt?: Date;
    revision: number;
}

type BatchCollection = Pick<
    Collection<EndpointEnrollmentBatchDoc>,
    'createIndex' | 'deleteMany' | 'find' | 'findOne' | 'findOneAndUpdate' | 'insertOne' | 'updateOne'
>;

interface EndpointEnrollmentBatchServiceOptions {
    batches: BatchCollection;
    now?: () => Date;
    idFactory?: () => ObjectId;
    codeFactory?: () => string;
}

interface CreateBatchInput {
    domainId: string;
    actorUid: number;
    expiresAt: Date;
    maxEnrollments: number;
    replacesEndpointId?: string;
}

interface ConsumeEnrollmentInput {
    enrollmentCode: string;
    claimId: string;
    publicKeyFingerprint: string;
    machineFingerprint: string;
    hostname: string;
}

interface FinalizeEnrollmentInput {
    batchId: ObjectId;
    claimId: string;
    endpointId: string;
}

interface RevokeBatchInput {
    batchId: ObjectId;
    actorUid: number;
    expectedRevision: number;
}

export interface ConsumedEndpointEnrollment {
    batchId: ObjectId;
    claimId: string;
    domainId: string;
    replacesEndpointId?: string;
    endpointId?: string;
}

const CODE_PATTERN = /^KVE1-[A-Za-z0-9_-]{32}$/;
const CLAIM_PATTERN = /^[A-Za-z0-9_-]{16,96}$/;
const ENDPOINT_PATTERN = /^ep_[A-Za-z0-9_-]{12,80}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_BATCH_LIFETIME_MS = 24 * 60 * 60 * 1000;

export class EndpointEnrollmentError extends Error {
    constructor(public readonly reason: string) {
        super(reason);
        this.name = 'EndpointEnrollmentError';
    }
}

function assertPositiveInteger(value: number, field: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${field} must be a positive integer`);
}

function codeDigest(code: string): string {
    return createHash('sha256').update(code, 'utf8').digest('hex');
}

function canonicalEnrollmentCode(value: string): string {
    const code = value.trim();
    if (!CODE_PATTERN.test(code)) throw new EndpointEnrollmentError('invalid_code');
    return code;
}

function canonicalEndpointId(value: string, field = 'endpointId'): string {
    const endpointId = value.trim();
    if (!ENDPOINT_PATTERN.test(endpointId)) throw new TypeError(`${field} is invalid`);
    return endpointId;
}

function canonicalClaimInput(input: ConsumeEnrollmentInput): ConsumeEnrollmentInput & { codeDigest: string } {
    const enrollmentCode = canonicalEnrollmentCode(input.enrollmentCode);
    const claimId = input.claimId.trim();
    const publicKeyFingerprint = input.publicKeyFingerprint.trim().toLowerCase();
    const machineFingerprint = input.machineFingerprint.trim().toLowerCase();
    const hostname = input.hostname.trim();
    if (!CLAIM_PATTERN.test(claimId)) throw new EndpointEnrollmentError('invalid_claim');
    if (!SHA256_PATTERN.test(publicKeyFingerprint)) throw new EndpointEnrollmentError('invalid_public_key_fingerprint');
    if (!SHA256_PATTERN.test(machineFingerprint)) throw new EndpointEnrollmentError('invalid_machine_fingerprint');
    if (!hostname || hostname.length > 255) throw new EndpointEnrollmentError('invalid_hostname');
    return { enrollmentCode, claimId, publicKeyFingerprint, machineFingerprint, hostname, codeDigest: codeDigest(enrollmentCode) };
}

function claimMatches(claim: EndpointEnrollmentClaim, input: ReturnType<typeof canonicalClaimInput>): boolean {
    return (
        claim.claimId === input.claimId &&
        claim.publicKeyFingerprint === input.publicKeyFingerprint &&
        claim.machineFingerprint === input.machineFingerprint &&
        claim.hostname === input.hostname
    );
}

function assertClaimRetryAllowed(batch: EndpointEnrollmentBatchDoc, claim: EndpointEnrollmentClaim, now: Date): void {
    if (claim.endpointId) return;
    if (batch.status === 'revoked') throw new EndpointEnrollmentError('revoked');
    if (batch.expiresAt <= now) throw new EndpointEnrollmentError('expired');
}

function consumed(batch: EndpointEnrollmentBatchDoc, claim: EndpointEnrollmentClaim): ConsumedEndpointEnrollment {
    return {
        batchId: new ObjectId(batch._id),
        claimId: claim.claimId,
        domainId: batch.domainId,
        ...(batch.replacesEndpointId ? { replacesEndpointId: batch.replacesEndpointId } : {}),
        ...(claim.endpointId ? { endpointId: claim.endpointId } : {}),
    };
}

function isExactDuplicate(error: unknown, key: string, value: unknown): boolean {
    if (!error || typeof error !== 'object' || (error as { code?: unknown }).code !== 11000) return false;
    const keyPattern = (error as { keyPattern?: unknown }).keyPattern;
    const keyValue = (error as { keyValue?: unknown }).keyValue;
    if (!keyPattern || typeof keyPattern !== 'object' || Array.isArray(keyPattern)) return false;
    if (!keyValue || typeof keyValue !== 'object' || Array.isArray(keyValue)) return false;
    return (
        Object.keys(keyPattern).length === 1 &&
        (keyPattern as Record<string, unknown>)[key] === 1 &&
        (keyValue as Record<string, unknown>)[key] === value
    );
}

export class EndpointEnrollmentBatchService {
    private readonly batches: BatchCollection;
    private readonly now: () => Date;
    private readonly idFactory: () => ObjectId;
    private readonly codeFactory: () => string;
    private indexesPromise?: Promise<void>;

    constructor(options: EndpointEnrollmentBatchServiceOptions) {
        this.batches = options.batches;
        this.now = options.now || (() => new Date());
        this.idFactory = options.idFactory || (() => new ObjectId());
        this.codeFactory = options.codeFactory || (() => `KVE1-${randomBytes(24).toString('base64url')}`);
    }

    ensureIndexes(): Promise<void> {
        this.indexesPromise ||= Promise.all([
            this.batches.createIndex({ codeDigest: 1 }, { name: 'endpointEnrollmentCode', unique: true }),
            this.batches.createIndex({ 'claims.claimId': 1 }, { name: 'endpointEnrollmentClaim', unique: true, sparse: true }),
            this.batches.createIndex({ domainId: 1, status: 1, updatedAt: -1 }, { name: 'endpointEnrollmentAdminList' }),
        ]).then(() => undefined);
        return this.indexesPromise;
    }

    async createBatch(input: CreateBatchInput): Promise<{ batch: EndpointEnrollmentBatchDoc; enrollmentCode: string }> {
        if (!input.domainId || input.domainId.length > 64) throw new TypeError('domainId is invalid');
        assertPositiveInteger(input.actorUid, 'actorUid');
        const now = this.now();
        if (
            !(input.expiresAt instanceof Date) ||
            !Number.isFinite(input.expiresAt.getTime()) ||
            input.expiresAt <= now ||
            input.expiresAt.getTime() > now.getTime() + MAX_BATCH_LIFETIME_MS
        ) {
            throw new EndpointEnrollmentError('invalid_expiry');
        }
        if (!Number.isSafeInteger(input.maxEnrollments) || input.maxEnrollments < 1 || input.maxEnrollments > 500) {
            throw new EndpointEnrollmentError('invalid_capacity');
        }
        const replacesEndpointId = input.replacesEndpointId ? canonicalEndpointId(input.replacesEndpointId, 'replacesEndpointId') : undefined;
        if (replacesEndpointId && input.maxEnrollments !== 1) throw new EndpointEnrollmentError('replacement_capacity');

        const enrollmentCode = canonicalEnrollmentCode(this.codeFactory());
        const batch: EndpointEnrollmentBatchDoc = {
            _id: this.idFactory(),
            domainId: input.domainId,
            codeDigest: codeDigest(enrollmentCode),
            codeHint: enrollmentCode.slice(-4),
            status: 'active',
            expiresAt: new Date(input.expiresAt),
            maxEnrollments: input.maxEnrollments,
            usedCount: 0,
            claims: [],
            ...(replacesEndpointId ? { replacesEndpointId } : {}),
            createdBy: input.actorUid,
            createdAt: now,
            updatedBy: input.actorUid,
            updatedAt: now,
            revision: 1,
        };
        try {
            await this.batches.insertOne(batch);
        } catch (error) {
            if (isExactDuplicate(error, 'codeDigest', batch.codeDigest)) throw new EndpointEnrollmentError('code_collision');
            throw error;
        }
        return { batch, enrollmentCode };
    }

    async consume(rawInput: ConsumeEnrollmentInput): Promise<ConsumedEndpointEnrollment> {
        const input = canonicalClaimInput(rawInput);
        const now = this.now();
        const existingOwner = await this.batches.findOne({ 'claims.claimId': input.claimId });
        if (existingOwner) {
            const existingClaim = existingOwner.claims.find((claim) => claim.claimId === input.claimId);
            if (!existingClaim || existingOwner.codeDigest !== input.codeDigest || !claimMatches(existingClaim, input)) {
                throw new EndpointEnrollmentError('claim_mismatch');
            }
            assertClaimRetryAllowed(existingOwner, existingClaim, now);
            return consumed(existingOwner, existingClaim);
        }

        const claim: EndpointEnrollmentClaim = {
            claimId: input.claimId,
            publicKeyFingerprint: input.publicKeyFingerprint,
            machineFingerprint: input.machineFingerprint,
            hostname: input.hostname,
            reservedAt: now,
        };
        let updated: EndpointEnrollmentBatchDoc | null;
        try {
            updated = await this.batches.findOneAndUpdate(
                {
                    codeDigest: input.codeDigest,
                    status: 'active',
                    expiresAt: { $gt: now },
                    'claims.claimId': { $ne: input.claimId },
                    $expr: { $lt: ['$usedCount', '$maxEnrollments'] },
                },
                {
                    $push: { claims: claim },
                    $inc: { usedCount: 1, revision: 1 },
                    $set: { updatedAt: now },
                },
                { returnDocument: 'after' },
            );
        } catch (error) {
            if (!isExactDuplicate(error, 'claims.claimId', input.claimId)) throw error;
            const raced = await this.batches.findOne({ 'claims.claimId': input.claimId });
            const racedClaim = raced?.claims.find((candidate) => candidate.claimId === input.claimId);
            if (!raced || raced.codeDigest !== input.codeDigest || !racedClaim || !claimMatches(racedClaim, input)) {
                throw new EndpointEnrollmentError('claim_mismatch');
            }
            assertClaimRetryAllowed(raced, racedClaim, now);
            return consumed(raced, racedClaim);
        }
        if (updated) {
            const stored = updated.claims.find((candidate) => candidate.claimId === input.claimId);
            if (!stored) throw new Error(`endpoint enrollment claim disappeared after reservation: ${input.claimId}`);
            return consumed(updated, stored);
        }

        const batch = await this.batches.findOne({ codeDigest: input.codeDigest });
        if (!batch) throw new EndpointEnrollmentError('invalid_code');
        const existing = batch.claims.find((candidate) => candidate.claimId === input.claimId);
        if (existing) {
            if (!claimMatches(existing, input)) throw new EndpointEnrollmentError('claim_mismatch');
            assertClaimRetryAllowed(batch, existing, now);
            return consumed(batch, existing);
        }
        if (batch.status === 'revoked') throw new EndpointEnrollmentError('revoked');
        if (batch.expiresAt <= now) throw new EndpointEnrollmentError('expired');
        if (batch.usedCount >= batch.maxEnrollments) throw new EndpointEnrollmentError('exhausted');
        throw new EndpointEnrollmentError('reservation_conflict');
    }

    async finalize(input: FinalizeEnrollmentInput): Promise<EndpointEnrollmentBatchDoc> {
        if (!(input.batchId instanceof ObjectId)) throw new TypeError('batchId must be an ObjectId');
        const endpointId = canonicalEndpointId(input.endpointId);
        if (!CLAIM_PATTERN.test(input.claimId)) throw new TypeError('claimId is invalid');
        const current = await this.batches.findOne({ _id: input.batchId });
        if (!current) throw new EndpointEnrollmentError('batch_not_found');
        const claim = current.claims.find((candidate) => candidate.claimId === input.claimId);
        if (!claim) throw new EndpointEnrollmentError('claim_not_found');
        if (claim.endpointId) {
            if (claim.endpointId !== endpointId) throw new EndpointEnrollmentError('endpoint_mismatch');
            return current;
        }
        const now = this.now();
        if (current.status === 'revoked') throw new EndpointEnrollmentError('revoked');
        if (current.expiresAt <= now) throw new EndpointEnrollmentError('expired');
        const result = await this.batches.updateOne(
            {
                _id: input.batchId,
                revision: current.revision,
                claims: { $elemMatch: { claimId: input.claimId, endpointId: { $exists: false } } },
            },
            {
                $set: {
                    'claims.$[claim].endpointId': endpointId,
                    'claims.$[claim].finalizedAt': now,
                    updatedAt: now,
                },
                $inc: { revision: 1 },
            },
            { arrayFilters: [{ 'claim.claimId': input.claimId }] },
        );
        if (result.matchedCount !== 1) {
            const raced = await this.batches.findOne({ _id: input.batchId });
            const racedClaim = raced?.claims.find((candidate) => candidate.claimId === input.claimId);
            if (raced && racedClaim?.endpointId === endpointId) return raced;
            throw new EndpointEnrollmentError('finalize_conflict');
        }
        const finalized = await this.batches.findOne({ _id: input.batchId });
        if (!finalized) throw new Error(`endpoint enrollment batch disappeared after finalize: ${input.batchId}`);
        return finalized;
    }

    async revokeBatch(input: RevokeBatchInput): Promise<EndpointEnrollmentBatchDoc> {
        if (!(input.batchId instanceof ObjectId)) throw new TypeError('batchId must be an ObjectId');
        assertPositiveInteger(input.actorUid, 'actorUid');
        assertPositiveInteger(input.expectedRevision, 'expectedRevision');
        const now = this.now();
        const updated = await this.batches.findOneAndUpdate(
            { _id: input.batchId, status: 'active', revision: input.expectedRevision },
            {
                $set: {
                    status: 'revoked',
                    revokedBy: input.actorUid,
                    revokedAt: now,
                    updatedBy: input.actorUid,
                    updatedAt: now,
                },
                $inc: { revision: 1 },
            },
            { returnDocument: 'after' },
        );
        if (!updated) throw new EndpointEnrollmentError('revoke_conflict');
        return updated;
    }

    async list(domainId: string, limit = 100): Promise<EndpointEnrollmentBatchDoc[]> {
        if (!domainId) throw new TypeError('domainId is required');
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new TypeError('limit is invalid');
        return this.batches.find({ domainId }).sort({ updatedAt: -1 }).limit(limit).toArray();
    }
}

export const endpointEnrollmentBatchColl = db.collection<EndpointEnrollmentBatchDoc>('endpoint.enrollmentBatches');
export const endpointEnrollmentBatchService = new EndpointEnrollmentBatchService({ batches: endpointEnrollmentBatchColl });

export async function apply(ctx: any): Promise<void> {
    await endpointEnrollmentBatchService.ensureIndexes();
    ctx.on('domain/delete', async (domainId: string) => {
        await endpointEnrollmentBatchColl.deleteMany({ domainId });
    });
}

global.Hydro.model.endpointEnrollment = {
    endpointEnrollmentBatchColl,
    endpointEnrollmentBatchService,
};
