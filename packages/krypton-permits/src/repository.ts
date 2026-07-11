import { db, ObjectId } from 'hydrooj';
import {
    AclMutationConflictError,
    AclMutationError,
    type AclMutationFence,
    type AclPair,
    type CanonicalPermit,
    type PermitSource,
    type ProblemAclMutationLock,
    sameAclMutationIntent,
} from './coordinator';
import {
    aclMutationFencesColl,
    permitsColl,
    permitSourcesColl,
} from './db';
import { canonicalActiveFilter, normalizeActiveCanonicalDoc } from './legacy-canonical';
import type {
    AclServiceRepository, ProblemMaintainerMirror, ProblemWriteClaim,
} from './service';

const TYPE_PROBLEM = 10;
const documentColl = db.collection<any>('document');

function sourceFromDoc(doc: any): PermitSource {
    return {
        domainId: doc.domainId,
        pid: doc.pid,
        uid: doc.uid,
        sourceType: doc.sourceType,
        sourceId: doc.sourceId,
        role: doc.role,
        active: doc.active,
        grantedBy: doc.grantedBy,
        grantedAt: doc.grantedAt,
        note: doc.note || '',
    } as PermitSource;
}

function canonicalFromDoc(doc: any): CanonicalPermit {
    const normalized = normalizeActiveCanonicalDoc(doc);
    const viaContest = normalized.viaContest
        ? (normalized.viaContest.toHexString?.() || String(normalized.viaContest))
        : null;
    return {
        domainId: normalized.domainId,
        pid: normalized.pid,
        uid: normalized.uid,
        role: normalized.role,
        active: true,
        grantedBy: normalized.grantedBy,
        grantedAt: normalized.grantedAt,
        viaContest,
        note: normalized.note || '',
    } as CanonicalPermit;
}

function fenceFromDoc(doc: any): AclMutationFence {
    return {
        domainId: doc.domainId,
        pid: doc.pid,
        uid: doc.uid,
        requestId: doc.requestId,
        from: doc.from ?? null,
        to: doc.to ?? null,
        intent: doc.intent,
        completedSteps: doc.completedSteps || [],
        lastError: doc.lastError ?? null,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        writeClaimRequestId: doc.writeClaimRequestId || null,
    };
}

function problemLockFromDoc(domainId: string, pid: number, lock: any): ProblemAclMutationLock {
    return {
        domainId,
        pid,
        uid: lock.uid,
        requestId: lock.requestId,
        from: lock.from ?? null,
        to: lock.to ?? null,
        intent: lock.intent,
        createdAt: lock.createdAt,
        updatedAt: lock.updatedAt,
        writeClaimRequestId: lock.writeClaimRequestId || null,
    };
}

function problemWriteClaimFromDoc(domainId: string, pid: number, claim: any): ProblemWriteClaim {
    return {
        domainId,
        pid,
        requestId: claim.requestId,
        actor: claim.actor,
        operation: claim.operation,
        state: claim.state,
        lastError: claim.lastError ?? null,
        createdAt: claim.createdAt,
        updatedAt: claim.updatedAt,
    };
}

function transactionCapable(): boolean {
    const topology = (db as any).client?.topology?.description?.type;
    return topology === 'ReplicaSetWithPrimary'
        || topology === 'ReplicaSetNoPrimary'
        || topology === 'Sharded';
}

export class MongoAclRepository implements AclServiceRepository {
    constructor(private readonly session?: any) { }

    private options() {
        return this.session ? { session: this.session } : {};
    }

    async getCanonical(pair: AclPair): Promise<CanonicalPermit | null> {
        const doc = await permitsColl.findOne({ ...pair, active: canonicalActiveFilter() }, this.options());
        return doc ? canonicalFromDoc(doc) : null;
    }

    async getSources(pair: AclPair): Promise<PermitSource[]> {
        const docs = await permitSourcesColl.find(pair, this.options()).toArray();
        return docs.map(sourceFromDoc);
    }

    async getFence(pair: AclPair): Promise<AclMutationFence | null> {
        const doc = await aclMutationFencesColl.findOne(pair, this.options());
        return doc ? fenceFromDoc(doc) : null;
    }

    async getProblemAclMutationLock(pair: AclPair): Promise<ProblemAclMutationLock | null> {
        const doc = await documentColl.findOne(
            { domainId: pair.domainId, docType: TYPE_PROBLEM, docId: pair.pid },
            { ...this.options(), projection: { aclMutationLocks: 1 } },
        );
        const lock = doc?.aclMutationLocks?.find((item: any) => item.uid === pair.uid);
        return lock ? problemLockFromDoc(pair.domainId, pair.pid, lock) : null;
    }

    async beginProblemAclMutation(lock: ProblemAclMutationLock): Promise<ProblemAclMutationLock> {
        const writeClaimFilter = lock.writeClaimRequestId
            ? {
                'aclWriteClaim.requestId': lock.writeClaimRequestId,
                'aclWriteClaim.state': 'active',
            }
            : { aclWriteClaim: { $exists: false } };
        const doc: any = await documentColl.findOneAndUpdate(
            {
                domainId: lock.domainId,
                docType: TYPE_PROBLEM,
                docId: lock.pid,
                'aclMutationLocks.uid': { $ne: lock.uid },
                ...writeClaimFilter,
            },
            ({
                $inc: { aclMutationRevision: 1 },
                $push: {
                    aclMutationLocks: {
                        uid: lock.uid,
                        requestId: lock.requestId,
                        from: lock.from,
                        to: lock.to,
                        intent: lock.intent,
                        createdAt: lock.createdAt,
                        updatedAt: lock.updatedAt,
                        writeClaimRequestId: lock.writeClaimRequestId || null,
                    },
                },
            } as any),
            { ...this.options(), returnDocument: 'after' },
        );
        if (doc) {
            const inserted = doc.aclMutationLocks?.find((item: any) => item.uid === lock.uid);
            if (!inserted) throw new Error('ProblemDoc ACL lock insert returned no matching lock');
            return problemLockFromDoc(lock.domainId, lock.pid, inserted);
        }

        const existing = await this.getProblemAclMutationLock(lock);
        if (!existing) {
            throw new Error(`problem ${lock.domainId}/${lock.pid} vanished while creating ACL write lock`);
        }
        if (existing.requestId !== lock.requestId) {
            throw new AclMutationConflictError(lock, lock.requestId, existing.requestId);
        }
        if (!sameAclMutationIntent(existing.intent, lock.intent)) {
            throw new AclMutationError(
                `requestId ${lock.requestId} was reused with a different ProblemDoc ACL lock intent`,
                lock,
                lock.requestId,
            );
        }
        return existing;
    }

    async clearProblemAclMutation(pair: AclPair, requestId: string): Promise<void> {
        const doc: any = await documentColl.findOneAndUpdate(
            {
                domainId: pair.domainId,
                docType: TYPE_PROBLEM,
                docId: pair.pid,
                aclMutationLocks: { $elemMatch: { uid: pair.uid, requestId } },
            },
            { $pull: { aclMutationLocks: { uid: pair.uid, requestId } } } as any,
            { ...this.options(), returnDocument: 'after' },
        );
        if (!doc) {
            throw new Error(`ProblemDoc ACL lock ownership lost for ${pair.domainId}/${pair.pid}/${pair.uid}`);
        }
    }

    async createFence(fence: AclMutationFence): Promise<void> {
        await aclMutationFencesColl.insertOne({
            _id: new ObjectId(),
            ...fence,
        }, this.options());
    }

    async updateFence(
        pair: AclPair,
        requestId: string,
        patch: Partial<AclMutationFence>,
    ): Promise<void> {
        const result = await aclMutationFencesColl.updateOne(
            { ...pair, requestId },
            { $set: patch },
            this.options(),
        );
        if (result.matchedCount !== 1) {
            throw new Error(`ACL fence ownership lost for ${pair.domainId}/${pair.pid}/${pair.uid}`);
        }
    }

    async applySource(fence: AclMutationFence): Promise<void> {
        if (fence.intent.action === 'reconcile') return;
        const identity = {
            domainId: fence.domainId,
            pid: fence.pid,
            uid: fence.uid,
            sourceType: fence.intent.sourceType,
            sourceId: fence.intent.sourceId,
        };
        if (!fence.intent.role) {
            await permitSourcesColl.deleteOne(identity, this.options());
            return;
        }
        await permitSourcesColl.updateOne(
            identity,
            {
                $set: {
                    role: fence.intent.role,
                    active: true,
                    grantedBy: fence.intent.grantedBy,
                    note: fence.intent.note,
                },
                $setOnInsert: {
                    _id: new ObjectId(),
                    ...identity,
                    grantedAt: new Date(),
                },
            },
            { ...this.options(), upsert: true },
        );
    }

    async writeCanonical(pair: AclPair, expected: CanonicalPermit | null): Promise<void> {
        if (!expected) {
            await permitsColl.deleteOne(pair, this.options());
            return;
        }
        await permitsColl.updateOne(
            pair,
            {
                $set: {
                    role: expected.role,
                    active: true,
                    grantedBy: expected.grantedBy,
                    grantedAt: expected.grantedAt,
                    viaContest: expected.viaContest ? new ObjectId(expected.viaContest) : null,
                    note: expected.note,
                },
                $setOnInsert: { _id: new ObjectId(), ...pair },
            },
            { ...this.options(), upsert: true },
        );
    }

    async writeMirror(pair: AclPair, maintain: boolean): Promise<void> {
        const update = maintain
            ? { $addToSet: { maintainer: pair.uid } }
            : { $pull: { maintainer: pair.uid } };
        const result = await documentColl.updateOne(
            { domainId: pair.domainId, docType: TYPE_PROBLEM, docId: pair.pid },
            update as any,
            this.options(),
        );
        if (maintain && result.matchedCount !== 1) {
            throw new Error(`problem ${pair.domainId}/${pair.pid} vanished while writing maintainer mirror`);
        }
    }

    async mirrorHas(pair: AclPair): Promise<boolean> {
        const problem = await documentColl.findOne(
            { domainId: pair.domainId, docType: TYPE_PROBLEM, docId: pair.pid },
            { ...this.options(), projection: { maintainer: 1 } },
        );
        return Array.isArray(problem?.maintainer) && problem.maintainer.includes(pair.uid);
    }

    async deleteFence(pair: AclPair, requestId: string): Promise<void> {
        const result = await aclMutationFencesColl.deleteOne(
            { ...pair, requestId },
            this.options(),
        );
        if (result.deletedCount !== 1) {
            throw new Error(`ACL fence ownership lost before clear for ${pair.domainId}/${pair.pid}/${pair.uid}`);
        }
    }

    async withMutationTransaction<T>(
        work: (transactional: AclServiceRepository) => Promise<T>,
    ): Promise<T> {
        if (this.session || !transactionCapable()) return work(this);
        const session = (db as any).client.startSession();
        try {
            let value: T | undefined;
            await session.withTransaction(async () => {
                value = await work(new MongoAclRepository(session));
            });
            return value as T;
        } finally {
            await session.endSession();
        }
    }

    async listSourcesForProblem(domainId: string, pid: number): Promise<PermitSource[]> {
        return (await permitSourcesColl.find({ domainId, pid }, this.options()).toArray()).map(sourceFromDoc);
    }

    async listSourcesForContest(
        domainId: string, sourceId: string, uid?: number,
    ): Promise<PermitSource[]> {
        const filter: any = { domainId, sourceType: 'contest', sourceId };
        if (uid !== undefined) filter.uid = uid;
        return (await permitSourcesColl.find(filter, this.options()).toArray()).map(sourceFromDoc);
    }

    async listCanonicalForUser(domainId: string, uid: number): Promise<CanonicalPermit[]> {
        const docs = await permitsColl.find(
            { domainId, uid, active: canonicalActiveFilter() },
            this.options(),
        ).toArray();
        return docs.map(canonicalFromDoc);
    }

    async listFencesForUser(domainId: string, uid: number): Promise<AclMutationFence[]> {
        const docs = await aclMutationFencesColl.find({ domainId, uid }, this.options()).toArray();
        return docs.map(fenceFromDoc);
    }

    async listProblemAclMutationLocksForUser(
        domainId: string,
        uid: number,
    ): Promise<ProblemAclMutationLock[]> {
        const docs = await documentColl.find(
            { domainId, docType: TYPE_PROBLEM, 'aclMutationLocks.uid': uid },
            { ...this.options(), projection: { docId: 1, aclMutationLocks: 1 } },
        ).toArray();
        return docs.flatMap((doc: any) => (doc.aclMutationLocks || [])
            .filter((lock: any) => lock.uid === uid)
            .map((lock: any) => problemLockFromDoc(domainId, doc.docId, lock)));
    }

    async listFencesForDomain(domainId: string): Promise<AclMutationFence[]> {
        return (await aclMutationFencesColl.find({ domainId }, this.options()).toArray()).map(fenceFromDoc);
    }

    async listProblemAclMutationLocksForDomain(domainId: string): Promise<ProblemAclMutationLock[]> {
        const docs = await documentColl.find(
            { domainId, docType: TYPE_PROBLEM, 'aclMutationLocks.0': { $exists: true } },
            { ...this.options(), projection: { docId: 1, aclMutationLocks: 1 } },
        ).toArray();
        return docs.flatMap((doc: any) => (doc.aclMutationLocks || [])
            .map((lock: any) => problemLockFromDoc(domainId, doc.docId, lock)));
    }

    async listProblemAclMutationLocksForProblem(
        domainId: string, pid: number,
    ): Promise<ProblemAclMutationLock[]> {
        const doc = await documentColl.findOne(
            { domainId, docType: TYPE_PROBLEM, docId: pid },
            { ...this.options(), projection: { docId: 1, aclMutationLocks: 1 } },
        );
        return (doc?.aclMutationLocks || [])
            .map((lock: any) => problemLockFromDoc(domainId, pid, lock));
    }

    async listProblemWriteClaimsForDomain(domainId: string): Promise<ProblemWriteClaim[]> {
        const docs = await documentColl.find(
            { domainId, docType: TYPE_PROBLEM, aclWriteClaim: { $exists: true } },
            { ...this.options(), projection: { docId: 1, aclWriteClaim: 1 } },
        ).toArray();
        return docs.map((doc: any) => problemWriteClaimFromDoc(domainId, doc.docId, doc.aclWriteClaim));
    }

    async problemExists(domainId: string, pid: number): Promise<boolean> {
        return !!await documentColl.findOne(
            { domainId, docType: TYPE_PROBLEM, docId: pid },
            { ...this.options(), projection: { _id: 1 } },
        );
    }

    async getProblemWriteClaim(domainId: string, pid: number): Promise<ProblemWriteClaim | null> {
        const doc = await documentColl.findOne(
            { domainId, docType: TYPE_PROBLEM, docId: pid },
            { ...this.options(), projection: { aclWriteClaim: 1 } },
        );
        return doc?.aclWriteClaim
            ? problemWriteClaimFromDoc(domainId, pid, doc.aclWriteClaim)
            : null;
    }

    async reactivateErroredProblemWriteClaim(
        domainId: string, pid: number, requestId: string,
    ): Promise<boolean> {
        const result = await documentColl.updateOne(
            {
                domainId,
                docType: TYPE_PROBLEM,
                docId: pid,
                'aclWriteClaim.requestId': requestId,
                'aclWriteClaim.state': 'error',
            },
            {
                $inc: { aclMutationRevision: 1 },
                $set: {
                    'aclWriteClaim.state': 'active',
                    'aclWriteClaim.updatedAt': new Date(),
                },
            },
            this.options(),
        );
        return result.matchedCount === 1;
    }

    async markProblemWriteClaimRepairError(
        domainId: string, pid: number, requestId: string, error: unknown,
    ): Promise<boolean> {
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        const result = await documentColl.updateOne(
            {
                domainId,
                docType: TYPE_PROBLEM,
                docId: pid,
                'aclWriteClaim.requestId': requestId,
                'aclWriteClaim.state': 'active',
            },
            {
                $set: {
                    'aclWriteClaim.state': 'error',
                    'aclWriteClaim.lastError': message,
                    'aclWriteClaim.updatedAt': new Date(),
                },
            },
            this.options(),
        );
        return result.matchedCount === 1;
    }

    async clearActiveProblemWriteClaim(
        domainId: string, pid: number, requestId: string,
    ): Promise<boolean> {
        const result = await documentColl.updateOne(
            {
                domainId,
                docType: TYPE_PROBLEM,
                docId: pid,
                'aclWriteClaim.requestId': requestId,
                'aclWriteClaim.state': 'active',
                'aclMutationLocks.0': { $exists: false },
            },
            { $inc: { aclMutationRevision: 1 }, $unset: { aclWriteClaim: '' } },
            this.options(),
        );
        return result.matchedCount === 1;
    }

    async listCanonicalForDomain(domainId: string): Promise<CanonicalPermit[]> {
        return (await permitsColl.find(
            { domainId, active: canonicalActiveFilter() },
            this.options(),
        ).toArray()).map(canonicalFromDoc);
    }

    async listCanonicalForContest(
        domainId: string, sourceId: string, uid?: number,
    ): Promise<CanonicalPermit[]> {
        const filter: any = {
            domainId,
            viaContest: new ObjectId(sourceId),
            active: canonicalActiveFilter(),
        };
        if (uid !== undefined) filter.uid = uid;
        return (await permitsColl.find(filter, this.options()).toArray()).map(canonicalFromDoc);
    }

    async listSourcesForDomain(domainId: string): Promise<PermitSource[]> {
        return (await permitSourcesColl.find({ domainId }, this.options()).toArray()).map(sourceFromDoc);
    }

    async listProblemMirrorsForDomain(domainId: string): Promise<ProblemMaintainerMirror[]> {
        const docs = await documentColl.find(
            { domainId, docType: TYPE_PROBLEM },
            { ...this.options(), projection: { docId: 1, maintainer: 1 } },
        ).toArray();
        return docs.map((doc: any) => ({
            domainId,
            pid: doc.docId,
            maintainer: Array.isArray(doc.maintainer) ? doc.maintainer : [],
        }));
    }

    async listCanonicalForProblem(domainId: string, pid: number): Promise<CanonicalPermit[]> {
        return (await permitsColl.find(
            { domainId, pid, active: canonicalActiveFilter() },
            this.options(),
        ).toArray()).map(canonicalFromDoc);
    }

    async listFencesForProblem(domainId: string, pid: number): Promise<AclMutationFence[]> {
        return (await aclMutationFencesColl.find({ domainId, pid }, this.options()).toArray()).map(fenceFromDoc);
    }

    async getProblemMirror(domainId: string, pid: number): Promise<number[]> {
        const doc = await documentColl.findOne(
            { domainId, docType: TYPE_PROBLEM, docId: pid },
            { ...this.options(), projection: { maintainer: 1 } },
        );
        return Array.isArray(doc?.maintainer) ? doc.maintainer : [];
    }
}

export const mongoAclRepository = new MongoAclRepository();
