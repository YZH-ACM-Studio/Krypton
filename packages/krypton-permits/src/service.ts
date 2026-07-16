import {
    type AclMutationFence,
    type AclPair,
    type AclRepository,
    type CanonicalPermit,
    createAclCoordinator,
    deriveCanonicalPermit,
    type PermitSource,
    type ProblemAclMutationLock,
    sameAclMutationIntent,
} from './coordinator';
import { ACTIVE_WRITE_CLAIM_RECOVERY_CONFIRMATION, type PermitRole, type ProblemWriteClaimMarker } from './types';

export interface ProblemMaintainerMirror {
    domainId: string;
    pid: number;
    maintainer: number[];
}

export interface ProblemWriteClaim extends ProblemWriteClaimMarker {
    domainId: string;
    pid: number;
}

export type FenceProblemLockMismatchReason =
    | 'missing-problem-lock'
    | 'request-id'
    | 'intent'
    | 'transition'
    | 'write-claim'
    | 'multiple-problem-locks';

export interface AclServiceRepository extends AclRepository {
    listSourcesForProblem(domainId: string, pid: number): Promise<PermitSource[]>;
    listSourcesForContest(domainId: string, sourceId: string, uid?: number): Promise<PermitSource[]>;
    listCanonicalForUser(domainId: string, uid: number): Promise<CanonicalPermit[]>;
    listFencesForUser(domainId: string, uid: number): Promise<AclMutationFence[]>;
    listProblemAclMutationLocksForUser(domainId: string, uid: number): Promise<ProblemAclMutationLock[]>;
    hasLegacyOwnedProblem(domainId: string, uid: number): Promise<boolean>;
    listFencesForDomain(domainId: string): Promise<AclMutationFence[]>;
    listProblemAclMutationLocksForDomain(domainId: string): Promise<ProblemAclMutationLock[]>;
    listProblemAclMutationLocksForProblem(domainId: string, pid: number): Promise<ProblemAclMutationLock[]>;
    listProblemWriteClaimsForDomain(domainId: string): Promise<ProblemWriteClaim[]>;
    problemExists(domainId: string, pid: number): Promise<boolean>;
    isManagedProblem(domainId: string, pid: number): Promise<boolean>;
    getProblemWriteClaim(domainId: string, pid: number): Promise<ProblemWriteClaim | null>;
    reactivateErroredProblemWriteClaim(domainId: string, pid: number, requestId: string): Promise<boolean>;
    markProblemWriteClaimRepairError(domainId: string, pid: number, requestId: string, error: unknown): Promise<boolean>;
    clearActiveProblemWriteClaim(domainId: string, pid: number, requestId: string): Promise<boolean>;
    listCanonicalForDomain(domainId: string): Promise<CanonicalPermit[]>;
    listCanonicalForContest(domainId: string, sourceId: string, uid?: number): Promise<CanonicalPermit[]>;
    listSourcesForDomain(domainId: string): Promise<PermitSource[]>;
    listProblemMirrorsForDomain(domainId: string): Promise<ProblemMaintainerMirror[]>;
    listCanonicalForProblem(domainId: string, pid: number): Promise<CanonicalPermit[]>;
    listFencesForProblem(domainId: string, pid: number): Promise<AclMutationFence[]>;
    getProblemMirror(domainId: string, pid: number): Promise<number[]>;
}

export interface AclDriftReport {
    domainId: string;
    generatedAt: Date;
    legacyMaintainerWithoutCanonical: AclPair[];
    canonicalMaintainerWithoutLegacy: AclPair[];
    verifierInLegacy: AclPair[];
    legacyCanonicalWithoutSource: Array<
        AclPair & {
            role: PermitRole;
            sourceType: PermitSource['sourceType'];
            sourceId: string;
        }
    >;
    sourceCanonicalConflicts: Array<
        AclPair & {
            expected: CanonicalPermit | null;
            actual: CanonicalPermit | null;
        }
    >;
    orphanProblemLocks: ProblemAclMutationLock[];
    /** Every durable deny fence plus its same-pair ProblemDoc lock, if present. */
    aclMutationFences: Array<
        AclMutationFence & {
            problemLock: ProblemAclMutationLock | null;
        }
    >;
    fenceProblemLockMismatches: Array<
        AclPair & {
            reasons: FenceProblemLockMismatchReason[];
            fence: AclMutationFence;
            problemLock: ProblemAclMutationLock | null;
        }
    >;
    problemWriteClaims: ProblemWriteClaim[];
}

function requireRequestId(requestId: string): string {
    if (!requestId || !requestId.trim()) throw new Error('ACL mutation requestId is required');
    return requestId.trim();
}

function mutationRequestId(base: string, source: Pick<PermitSource, 'domainId' | 'pid' | 'uid' | 'sourceType' | 'sourceId'>) {
    return `${requireRequestId(base)}:${source.domainId}:${source.pid}:${source.uid}:${source.sourceType}:${source.sourceId}`;
}

function sortPairs<T extends AclPair>(rows: T[]): T[] {
    return rows.sort((a, b) => a.domainId.localeCompare(b.domainId) || a.pid - b.pid || a.uid - b.uid);
}

function canonicalMatches(actual: CanonicalPermit | null, expected: CanonicalPermit | null): boolean {
    if (!actual || !expected) return actual === expected;
    return actual.active === true && actual.role === expected.role && actual.viaContest === expected.viaContest;
}

function errorText(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function createAclService(repo: AclServiceRepository, options: { now?: () => Date } = {}) {
    const now = options.now || (() => new Date());
    const coordinator = createAclCoordinator(repo, { now });

    async function grantDirect(
        domainId: string,
        pid: number,
        uid: number,
        role: PermitRole,
        grantedBy: number,
        requestId: string,
        note = '',
        writeClaimRequestId?: string,
    ) {
        return coordinator.mutate({
            domainId,
            pid,
            uid,
            role,
            grantedBy,
            requestId: requireRequestId(requestId),
            note,
            sourceType: 'direct',
            sourceId: 'direct',
            writeClaimRequestId,
        });
    }

    async function grantContest(
        domainId: string,
        pid: number,
        uid: number,
        role: PermitRole,
        grantedBy: number,
        contestId: string,
        requestId: string,
        note = '',
        writeClaimRequestId?: string,
    ) {
        if (!contestId) throw new Error('contest sourceId is required');
        if (role === 'author') throw new Error('author role is direct-problem only');
        if (role === 'maintainer' && (await repo.isManagedProblem(domainId, pid))) {
            throw new Error('managed problem maintainer must be granted directly by a system administrator');
        }
        return coordinator.mutate({
            domainId,
            pid,
            uid,
            role,
            grantedBy,
            requestId: requireRequestId(requestId),
            note,
            sourceType: 'contest',
            sourceId: contestId,
            writeClaimRequestId,
        });
    }

    async function removeSources(sources: PermitSource[], requestId: string, actor: number, writeClaimRequestId?: string): Promise<number> {
        let removed = 0;
        const ordered = sources
            .slice()
            .sort(
                (a, b) =>
                    a.domainId.localeCompare(b.domainId) ||
                    a.pid - b.pid ||
                    a.uid - b.uid ||
                    a.sourceType.localeCompare(b.sourceType) ||
                    a.sourceId.localeCompare(b.sourceId),
            );
        for (const source of ordered) {
            await coordinator.mutate({
                domainId: source.domainId,
                pid: source.pid,
                uid: source.uid,
                requestId: mutationRequestId(requestId, source),
                sourceType: source.sourceType,
                sourceId: source.sourceId,
                role: null,
                grantedBy: actor,
                note: '',
                writeClaimRequestId,
            });
            removed++;
        }
        return removed;
    }

    async function revokeSource(
        domainId: string,
        pid: number,
        uid: number,
        sourceType: PermitSource['sourceType'],
        sourceId: string,
        requestId: string,
        actor = 0,
        writeClaimRequestId?: string,
    ): Promise<boolean> {
        const source = (await repo.getSources({ domainId, pid, uid })).find((item) => item.sourceType === sourceType && item.sourceId === sourceId);
        if (!source) return false;
        await removeSources([source], requestId, actor, writeClaimRequestId);
        return true;
    }

    async function resumeFence(fence: AclMutationFence): Promise<CanonicalPermit | null> {
        return coordinator.mutate({
            domainId: fence.domainId,
            pid: fence.pid,
            uid: fence.uid,
            requestId: fence.requestId,
            sourceType: fence.intent.sourceType,
            sourceId: fence.intent.sourceId,
            role: fence.intent.role,
            grantedBy: fence.intent.grantedBy,
            note: fence.intent.note,
            reconcileOnly: fence.intent.action === 'reconcile',
            writeClaimRequestId: fence.writeClaimRequestId || undefined,
        });
    }

    async function resumeProblemLock(lock: ProblemAclMutationLock): Promise<CanonicalPermit | null> {
        return coordinator.mutate({
            domainId: lock.domainId,
            pid: lock.pid,
            uid: lock.uid,
            requestId: lock.requestId,
            sourceType: lock.intent.sourceType,
            sourceId: lock.intent.sourceId,
            role: lock.intent.role,
            grantedBy: lock.intent.grantedBy,
            note: lock.intent.note,
            reconcileOnly: lock.intent.action === 'reconcile',
            writeClaimRequestId: lock.writeClaimRequestId || undefined,
        });
    }

    async function resumeMarkersForPair(pair: AclPair, expectedRequestId?: string): Promise<CanonicalPermit | null> {
        const [fence, lock] = await Promise.all([repo.getFence(pair), repo.getProblemAclMutationLock(pair)]);
        if (!fence && !lock) return null;
        for (const marker of [fence, lock].filter(Boolean) as Array<AclMutationFence | ProblemAclMutationLock>) {
            if (expectedRequestId && marker.requestId !== expectedRequestId) {
                throw new Error(`ACL marker requestId mismatch: expected ${expectedRequestId}, got ${marker.requestId}`);
            }
        }
        return lock ? resumeProblemLock(lock) : resumeFence(fence!);
    }

    async function repairAclMutation(pair: AclPair, expectedRequestId: string): Promise<CanonicalPermit | null> {
        const requestId = requireRequestId(expectedRequestId);
        if (!(await repo.problemExists(pair.domainId, pair.pid))) {
            throw new Error(`problem ${pair.domainId}/${pair.pid} does not exist`);
        }
        const [fence, lock, claim] = await Promise.all([
            repo.getFence(pair),
            repo.getProblemAclMutationLock(pair),
            repo.getProblemWriteClaim(pair.domainId, pair.pid),
        ]);
        const markers = [fence, lock].filter(Boolean) as Array<AclMutationFence | ProblemAclMutationLock>;
        if (!markers.length) {
            throw new Error(`ACL mutation does not exist for ${pair.domainId}/${pair.pid}/${pair.uid}`);
        }
        for (const marker of markers) {
            if (marker.requestId !== requestId) {
                throw new Error(`ACL marker requestId mismatch: expected ${requestId}, got ${marker.requestId}`);
            }
        }
        const bindings = new Set(markers.map((marker) => marker.writeClaimRequestId || null).filter((value): value is string => !!value));
        if (bindings.size > 1) throw new Error('ACL markers are bound to different problem write claims');
        const binding = [...bindings][0];
        if (claim || binding) {
            if (!claim || !binding || claim.requestId !== binding) {
                throw new Error('ACL marker binding does not match the current problem write claim');
            }
            if (claim.state === 'error') {
                throw new Error(`ACL mutation belongs to ERROR problem write claim ${claim.requestId}; use problem-write-claim repair`);
            }
            throw new Error(
                `ACL mutation belongs to ACTIVE problem write claim ${claim.requestId}; ` +
                    `after quiescing the process use problem-write-claim repair with ${ACTIVE_WRITE_CLAIM_RECOVERY_CONFIRMATION}`,
            );
        }

        const result = await resumeMarkersForPair(pair, requestId);
        const [fenceLeft, lockLeft] = await Promise.all([repo.getFence(pair), repo.getProblemAclMutationLock(pair)]);
        if (fenceLeft || lockLeft) {
            throw new Error(`ACL mutation repair incomplete for ${pair.domainId}/${pair.pid}/${pair.uid}`);
        }
        return result;
    }

    async function repairOrphanProblemLock(pair: AclPair, expectedRequestId: string): Promise<CanonicalPermit | null> {
        const requestId = requireRequestId(expectedRequestId);
        const [exists, lock] = await Promise.all([repo.problemExists(pair.domainId, pair.pid), repo.getProblemAclMutationLock(pair)]);
        if (!exists) throw new Error(`problem ${pair.domainId}/${pair.pid} does not exist`);
        if (!lock) {
            throw new Error(`ProblemDoc ACL lock does not exist for ${pair.domainId}/${pair.pid}/${pair.uid}`);
        }
        if (lock.requestId !== requestId) {
            throw new Error(`ProblemDoc ACL lock requestId mismatch: expected ${requestId}, got ${lock.requestId}`);
        }
        return repairAclMutation(pair, requestId);
    }

    async function repairFenceWithoutProblemLock(pair: AclPair, expectedRequestId: string): Promise<CanonicalPermit | null> {
        const requestId = requireRequestId(expectedRequestId);
        const [exists, fence, lock] = await Promise.all([
            repo.problemExists(pair.domainId, pair.pid),
            repo.getFence(pair),
            repo.getProblemAclMutationLock(pair),
        ]);
        if (!exists) throw new Error(`problem ${pair.domainId}/${pair.pid} does not exist`);
        if (!fence) {
            throw new Error(`ACL fence does not exist for ${pair.domainId}/${pair.pid}/${pair.uid}`);
        }
        if (fence.requestId !== requestId) {
            throw new Error(`ACL fence requestId mismatch: expected ${requestId}, got ${fence.requestId}`);
        }
        if (lock) {
            throw new Error(`ProblemDoc ACL lock already exists for ${pair.domainId}/${pair.pid}/${pair.uid}`);
        }
        return repairAclMutation(pair, requestId);
    }

    async function repairErroredProblemWriteClaim(domainId: string, pid: number, expectedRequestId: string): Promise<void> {
        const requestId = requireRequestId(expectedRequestId);
        if (!(await repo.problemExists(domainId, pid))) {
            throw new Error(`problem ${domainId}/${pid} does not exist`);
        }
        const claim = await repo.getProblemWriteClaim(domainId, pid);
        if (!claim) throw new Error(`problem ${domainId}/${pid} has no write claim`);
        if (claim.requestId !== requestId) {
            throw new Error(`problem write claim requestId mismatch: expected ${requestId}, got ${claim.requestId}`);
        }
        if (claim.state !== 'error') {
            throw new Error(`problem write claim ${requestId} is active and cannot be operator-cleared`);
        }
        if (!(await repo.reactivateErroredProblemWriteClaim(domainId, pid, requestId))) {
            throw new Error(`problem write claim ${requestId} changed before repair activation`);
        }

        try {
            const markerPairs = new Map<string, AclPair>();
            const [fences, locks] = await Promise.all([
                repo.listFencesForProblem(domainId, pid),
                repo.listProblemAclMutationLocksForProblem(domainId, pid),
            ]);
            for (const marker of [...fences, ...locks]) {
                if ((marker.writeClaimRequestId || null) !== requestId) {
                    throw new Error(`ACL marker ${marker.requestId} is not bound to write claim ${requestId}`);
                }
                markerPairs.set(`${marker.pid}:${marker.uid}`, marker);
            }
            for (const pair of markerPairs.values()) await resumeMarkersForPair(pair);

            const [fencesLeft, locksLeft] = await Promise.all([
                repo.listFencesForProblem(domainId, pid),
                repo.listProblemAclMutationLocksForProblem(domainId, pid),
            ]);
            if (fencesLeft.length || locksLeft.length) {
                throw new Error(`write-claim ACL markers remain for ${domainId}/${pid}`);
            }
            if (!(await repo.clearActiveProblemWriteClaim(domainId, pid, requestId))) {
                throw new Error(`problem write claim ${requestId} changed before exact clear`);
            }
        } catch (error) {
            let restored = false;
            try {
                restored = await repo.markProblemWriteClaimRepairError(domainId, pid, requestId, error);
            } catch (markerError) {
                throw new Error(
                    `write-claim repair failed and ERROR marker update also failed: ${requestId}; ` +
                        `${errorText(error)}; markerError=${errorText(markerError)}`,
                    { cause: error },
                );
            }
            if (!restored) {
                throw new Error(`write-claim repair failed and exact ERROR marker could not be restored: ${requestId}; ${errorText(error)}`, {
                    cause: error,
                });
            }
            throw error;
        }
    }

    async function recoverActiveProblemWriteClaim(domainId: string, pid: number, expectedRequestId: string, confirmation: string): Promise<void> {
        if (confirmation !== ACTIVE_WRITE_CLAIM_RECOVERY_CONFIRMATION) {
            throw new Error(`ACTIVE write-claim recovery requires ${ACTIVE_WRITE_CLAIM_RECOVERY_CONFIRMATION}`);
        }
        const requestId = requireRequestId(expectedRequestId);
        if (!(await repo.problemExists(domainId, pid))) {
            throw new Error(`problem ${domainId}/${pid} does not exist`);
        }
        const claim = await repo.getProblemWriteClaim(domainId, pid);
        if (!claim) throw new Error(`problem ${domainId}/${pid} has no write claim`);
        if (claim.requestId !== requestId) {
            throw new Error(`problem write claim requestId mismatch: expected ${requestId}, got ${claim.requestId}`);
        }
        if (claim.state !== 'active') {
            throw new Error(`problem write claim ${requestId} is ${claim.state}; use ERROR write-claim repair`);
        }
        const recoveryMarker = new Error(`operator confirmed ${ACTIVE_WRITE_CLAIM_RECOVERY_CONFIRMATION}`);
        if (!(await repo.markProblemWriteClaimRepairError(domainId, pid, requestId, recoveryMarker))) {
            throw new Error(`problem write claim ${requestId} changed before exact ACTIVE recovery`);
        }
        await repairErroredProblemWriteClaim(domainId, pid, requestId);
    }

    async function resumeFencesForProblem(domainId: string, pid: number): Promise<void> {
        const [fences, locks] = await Promise.all([
            repo.listFencesForProblem(domainId, pid),
            repo.listProblemAclMutationLocksForProblem(domainId, pid),
        ]);
        const pairs = new Map<number, AclPair>();
        for (const marker of [...fences, ...locks]) pairs.set(marker.uid, marker);
        for (const pair of [...pairs.values()].sort((a, b) => a.uid - b.uid)) {
            await resumeMarkersForPair(pair);
        }
    }

    async function prepareProblemWriteClaim(domainId: string, pid: number): Promise<void> {
        if (!(await repo.problemExists(domainId, pid))) {
            throw new Error(`problem ${domainId}/${pid} does not exist`);
        }
        const claim = await repo.getProblemWriteClaim(domainId, pid);
        if (claim) {
            throw new Error(`problem ${domainId}/${pid} already has ${claim.state} write claim ${claim.requestId}`);
        }
        await resumeFencesForProblem(domainId, pid);
        const [fencesLeft, locksLeft] = await Promise.all([
            repo.listFencesForProblem(domainId, pid),
            repo.listProblemAclMutationLocksForProblem(domainId, pid),
        ]);
        if (fencesLeft.length || locksLeft.length) {
            throw new Error(`ACL markers remain before problem write claim for ${domainId}/${pid}`);
        }
    }

    async function reconcilePair(pair: AclPair, requestId: string, actor: number, writeClaimRequestId?: string) {
        return coordinator.mutate({
            ...pair,
            requestId: requireRequestId(requestId),
            sourceType: 'direct',
            sourceId: 'direct',
            role: null,
            grantedBy: actor,
            note: '',
            reconcileOnly: true,
            writeClaimRequestId,
        });
    }

    async function clearVerifiersForProblem(
        domainId: string,
        pid: number,
        requestId: string,
        actor = 0,
        writeClaimRequestId?: string,
    ): Promise<number> {
        await resumeFencesForProblem(domainId, pid);
        const sources = await repo.listSourcesForProblem(domainId, pid);
        const removed = await removeSources(
            sources.filter((source) => source.active && source.role === 'verifier'),
            requestId,
            actor,
            writeClaimRequestId,
        );
        const staleCanonical = (await repo.listCanonicalForProblem(domainId, pid)).filter(
            (permit) => permit.active === true && permit.role === 'verifier',
        );
        for (const permit of staleCanonical.sort((a, b) => a.uid - b.uid)) {
            await reconcilePair({ domainId, pid, uid: permit.uid }, `${requestId}:canonical-verifier:${permit.uid}`, actor, writeClaimRequestId);
        }
        const [verifierSources, verifierCanonical] = await Promise.all([
            repo.listSourcesForProblem(domainId, pid),
            repo.listCanonicalForProblem(domainId, pid),
        ]);
        if (
            verifierSources.some((source) => source.active === true && source.role === 'verifier') ||
            verifierCanonical.some((permit) => permit.active === true && permit.role === 'verifier')
        ) {
            throw new Error(`publish verifier cleanup incomplete for ${domainId}/${pid}`);
        }
        return removed;
    }

    async function clearForProblem(domainId: string, pid: number, requestId: string, actor = 0, writeClaimRequestId?: string): Promise<number> {
        await resumeFencesForProblem(domainId, pid);
        const removed = await removeSources(await repo.listSourcesForProblem(domainId, pid), requestId, actor, writeClaimRequestId);
        const [canonical, mirroredUids] = await Promise.all([repo.listCanonicalForProblem(domainId, pid), repo.getProblemMirror(domainId, pid)]);
        const pairUids = new Set([...canonical.map((permit) => permit.uid), ...mirroredUids]);
        for (const uid of [...pairUids].sort((a, b) => a - b)) {
            await reconcilePair({ domainId, pid, uid }, `${requestId}:reconcile:${uid}`, actor, writeClaimRequestId);
        }
        const [sourcesLeft, canonicalLeft, fencesLeft, mirrorLeft] = await Promise.all([
            repo.listSourcesForProblem(domainId, pid),
            repo.listCanonicalForProblem(domainId, pid),
            repo.listFencesForProblem(domainId, pid),
            repo.getProblemMirror(domainId, pid),
        ]);
        if (sourcesLeft.length || canonicalLeft.length || fencesLeft.length || mirrorLeft.length) {
            throw new Error(`hard-delete ACL cleanup incomplete for ${domainId}/${pid}`);
        }
        return removed;
    }

    async function revokeContestUser(domainId: string, contestId: string, uid: number, requestId: string, actor = 0): Promise<number> {
        const removed = await removeSources(await repo.listSourcesForContest(domainId, contestId, uid), requestId, actor);
        const stale = await repo.listCanonicalForContest(domainId, contestId, uid);
        for (const permit of stale.sort((a, b) => a.pid - b.pid)) {
            await reconcilePair({ domainId, pid: permit.pid, uid }, `${requestId}:canonical:${permit.pid}:${uid}`, actor);
        }
        const left = (await repo.listCanonicalForContest(domainId, contestId, uid)).length > 0;
        if (left) throw new Error(`contest user revoke incomplete for ${domainId}/${contestId}/${uid}`);
        return removed;
    }

    async function revokeContestAll(domainId: string, contestId: string, requestId: string, actor = 0): Promise<number> {
        const removed = await removeSources(await repo.listSourcesForContest(domainId, contestId), requestId, actor);
        const stale = await repo.listCanonicalForContest(domainId, contestId);
        for (const permit of stale.sort((a, b) => a.pid - b.pid || a.uid - b.uid)) {
            await reconcilePair({ domainId, pid: permit.pid, uid: permit.uid }, `${requestId}:canonical:${permit.pid}:${permit.uid}`, actor);
        }
        const left = (await repo.listCanonicalForContest(domainId, contestId)).length > 0;
        if (left) throw new Error(`contest revoke incomplete for ${domainId}/${contestId}`);
        return removed;
    }

    async function revokePairs(
        domainId: string,
        pairs: Array<{ pid: number; uid: number }>,
        requestId: string,
        actor = 0,
        writeClaimRequestId?: string,
    ): Promise<number> {
        let removed = 0;
        const unique = new Map(pairs.map((pair) => [`${pair.pid}:${pair.uid}`, pair]));
        for (const pair of [...unique.values()].sort((a, b) => a.pid - b.pid || a.uid - b.uid)) {
            const aclPair = { domainId, ...pair };
            const fence = await repo.getFence(aclPair);
            if (fence) await resumeFence(fence);
            const sources = (await repo.getSources({ domainId, ...pair })).filter((source) => source.domainId === domainId);
            removed += await removeSources(sources, requestId, actor, writeClaimRequestId);
            await reconcilePair(aclPair, `${requestId}:pair-reconcile:${pair.pid}:${pair.uid}`, actor, writeClaimRequestId);
            const [canonicalLeft, sourcesLeft, fenceLeft, mirrorLeft] = await Promise.all([
                repo.getCanonical(aclPair),
                repo.getSources(aclPair),
                repo.getFence(aclPair),
                repo.mirrorHas(aclPair),
            ]);
            if (canonicalLeft || sourcesLeft.length || fenceLeft || mirrorLeft) {
                throw new Error(`pair revoke incomplete for ${domainId}/${pair.pid}/${pair.uid}`);
            }
        }
        return removed;
    }

    async function syncContestPids(
        domainId: string,
        contestId: string,
        _oldPids: number[],
        newPids: number[],
        users: Array<{ uid: number; role: PermitRole }>,
        grantedBy: number,
        requestId: string,
    ): Promise<{ added: number; removed: number }> {
        const existing = await repo.listSourcesForContest(domainId, contestId);
        const desired = new Map<string, { pid: number; uid: number; role: PermitRole }>();
        for (const pid of [...new Set(newPids)].sort((a, b) => a - b)) {
            const managed = await repo.isManagedProblem(domainId, pid);
            for (const user of users.slice().sort((a, b) => a.uid - b.uid)) {
                // Contest roles may grant verification access to managed
                // drafts, but must never create or propagate maintainer.
                const role = managed && user.role === 'maintainer' ? 'verifier' : user.role;
                desired.set(`${pid}:${user.uid}`, { pid, uid: user.uid, role });
            }
        }
        const toRemove = existing.filter((source) => !desired.has(`${source.pid}:${source.uid}`));
        const removed = await removeSources(toRemove, `${requestId}:remove`, grantedBy);
        let added = 0;
        const existingByPair = new Map(
            existing.filter((source) => !toRemove.includes(source)).map((source) => [`${source.pid}:${source.uid}`, source]),
        );
        for (const target of desired.values()) {
            const current = existingByPair.get(`${target.pid}:${target.uid}`);
            if (current?.active === true && current.role === target.role) continue;
            await grantContest(
                domainId,
                target.pid,
                target.uid,
                target.role,
                grantedBy,
                contestId,
                `${requestId}:upsert:${target.pid}:${target.uid}`,
            );
            added++;
        }
        return { added, removed };
    }

    async function loadUserAcl(domainId: string, uid: number) {
        const [canonical, fences, problemLocks, ownsLegacyProblems] = await Promise.all([
            repo.listCanonicalForUser(domainId, uid),
            repo.listFencesForUser(domainId, uid),
            repo.listProblemAclMutationLocksForUser(domainId, uid),
            repo.hasLegacyOwnedProblem(domainId, uid),
        ]);
        const fencedPids = new Set([...fences.map((fence) => fence.pid), ...problemLocks.map((lock) => lock.pid)]);
        const active = canonical.filter((permit) => permit.active === true && !fencedPids.has(permit.pid));
        return {
            permitPids: new Set(active.map((permit) => permit.pid)),
            authoredPids: new Set(active.filter((permit) => permit.role === 'author').map((permit) => permit.pid)),
            maintainedPids: new Set(active.filter((permit) => permit.role === 'maintainer').map((permit) => permit.pid)),
            fencedPids,
            ownsLegacyProblems,
        };
    }

    async function repairLegacyCanonicalWithoutSource(pair: AclPair, requestId: string, actor: number): Promise<CanonicalPermit> {
        const [canonical, sources, fence] = await Promise.all([repo.getCanonical(pair), repo.getSources(pair), repo.getFence(pair)]);
        if (fence) {
            throw new Error(`legacy canonical repair refused while pair is fenced by ${fence.requestId}`);
        }
        if (!canonical || canonical.active !== true) {
            throw new Error('active legacy canonical row does not exist');
        }
        if (sources.some((source) => source.active === true)) {
            throw new Error('legacy canonical repair refused because source rows already exist');
        }
        const grantedBy = Number.isSafeInteger(canonical.grantedBy) && canonical.grantedBy > 0 ? canonical.grantedBy : actor;
        const repaired = canonical.viaContest
            ? await grantContest(pair.domainId, pair.pid, pair.uid, canonical.role, grantedBy, canonical.viaContest, requestId, canonical.note)
            : await grantDirect(pair.domainId, pair.pid, pair.uid, canonical.role, grantedBy, requestId, canonical.note);
        if (!repaired) throw new Error('legacy canonical repair produced no active canonical row');
        return repaired;
    }

    async function buildDriftReport(domainId: string): Promise<AclDriftReport> {
        const [canonical, sources, problems, fences, problemLocks, problemWriteClaims] = await Promise.all([
            repo.listCanonicalForDomain(domainId),
            repo.listSourcesForDomain(domainId),
            repo.listProblemMirrorsForDomain(domainId),
            repo.listFencesForDomain(domainId),
            repo.listProblemAclMutationLocksForDomain(domainId),
            repo.listProblemWriteClaimsForDomain(domainId),
        ]);
        const canonicalByPair = new Map(canonical.map((permit) => [`${permit.pid}:${permit.uid}`, permit]));
        const mirrored = new Set<string>();
        const legacyMaintainerWithoutCanonical: AclPair[] = [];
        const verifierInLegacy: AclPair[] = [];
        for (const problem of problems) {
            for (const uid of problem.maintainer || []) {
                const key = `${problem.pid}:${uid}`;
                mirrored.add(key);
                const permit = canonicalByPair.get(key);
                const pair = { domainId, pid: problem.pid, uid };
                if (!permit || permit.active !== true || permit.role !== 'maintainer') {
                    legacyMaintainerWithoutCanonical.push(pair);
                }
                if (permit?.active === true && permit.role === 'verifier') verifierInLegacy.push(pair);
            }
        }
        const canonicalMaintainerWithoutLegacy = canonical
            .filter((permit) => permit.active === true && permit.role === 'maintainer' && !mirrored.has(`${permit.pid}:${permit.uid}`))
            .map(({ domainId: d, pid, uid }) => ({ domainId: d, pid, uid }));

        const sourcesByPair = new Map<string, PermitSource[]>();
        for (const source of sources) {
            const key = `${source.pid}:${source.uid}`;
            if (!sourcesByPair.has(key)) sourcesByPair.set(key, []);
            sourcesByPair.get(key)!.push(source);
        }
        const pairKeys = new Set([...canonicalByPair.keys(), ...sourcesByPair.keys()]);
        const legacyCanonicalWithoutSource = canonical
            .filter((permit) => !(sourcesByPair.get(`${permit.pid}:${permit.uid}`) || []).some((source) => source.active === true))
            .map((permit) => ({
                domainId: permit.domainId,
                pid: permit.pid,
                uid: permit.uid,
                role: permit.role,
                sourceType: permit.viaContest ? ('contest' as const) : ('direct' as const),
                sourceId: permit.viaContest || 'direct',
            }));
        const sourceCanonicalConflicts: AclDriftReport['sourceCanonicalConflicts'] = [];
        for (const key of pairKeys) {
            const [pid, uid] = key.split(':').map(Number);
            const pair = { domainId, pid, uid };
            const expected = deriveCanonicalPermit(pair, sourcesByPair.get(key) || []);
            const actual = canonicalByPair.get(key) || null;
            if (!canonicalMatches(actual, expected)) {
                sourceCanonicalConflicts.push({ ...pair, expected, actual });
            }
        }
        const fencesByPair = new Map(fences.map((fence) => [`${fence.pid}:${fence.uid}`, fence]));
        const locksByPair = new Map<string, ProblemAclMutationLock[]>();
        for (const lock of problemLocks) {
            const key = `${lock.pid}:${lock.uid}`;
            if (!locksByPair.has(key)) locksByPair.set(key, []);
            locksByPair.get(key)!.push(lock);
        }
        const orphanProblemLocks = problemLocks.filter((lock) => !fencesByPair.has(`${lock.pid}:${lock.uid}`));
        const lockForFence = (fence: AclMutationFence): ProblemAclMutationLock | null => {
            const locks = locksByPair.get(`${fence.pid}:${fence.uid}`) || [];
            return locks.find((lock) => lock.requestId === fence.requestId) || locks[0] || null;
        };
        const aclMutationFences = fences.map((fence) => ({
            ...fence,
            problemLock: lockForFence(fence),
        }));
        const fenceProblemLockMismatches: AclDriftReport['fenceProblemLockMismatches'] = [];
        for (const fence of fences) {
            const locks = locksByPair.get(`${fence.pid}:${fence.uid}`) || [];
            const lock = lockForFence(fence);
            const reasons: FenceProblemLockMismatchReason[] = [];
            if (!lock) reasons.push('missing-problem-lock');
            if (locks.length > 1) reasons.push('multiple-problem-locks');
            if (lock) {
                if (fence.requestId !== lock.requestId) reasons.push('request-id');
                if (!sameAclMutationIntent(fence.intent, lock.intent)) reasons.push('intent');
                if (fence.from !== lock.from || fence.to !== lock.to) reasons.push('transition');
                if ((fence.writeClaimRequestId || null) !== (lock.writeClaimRequestId || null)) {
                    reasons.push('write-claim');
                }
            }
            if (reasons.length) {
                fenceProblemLockMismatches.push({
                    domainId,
                    pid: fence.pid,
                    uid: fence.uid,
                    reasons,
                    fence,
                    problemLock: lock,
                });
            }
        }
        return {
            domainId,
            generatedAt: now(),
            legacyMaintainerWithoutCanonical: sortPairs(legacyMaintainerWithoutCanonical),
            canonicalMaintainerWithoutLegacy: sortPairs(canonicalMaintainerWithoutLegacy),
            verifierInLegacy: sortPairs(verifierInLegacy),
            legacyCanonicalWithoutSource: sortPairs(legacyCanonicalWithoutSource),
            sourceCanonicalConflicts: sortPairs(sourceCanonicalConflicts),
            orphanProblemLocks: sortPairs(orphanProblemLocks),
            aclMutationFences: sortPairs(aclMutationFences),
            fenceProblemLockMismatches: sortPairs(fenceProblemLockMismatches),
            problemWriteClaims: problemWriteClaims.sort(
                (a, b) => a.domainId.localeCompare(b.domainId) || a.pid - b.pid || a.requestId.localeCompare(b.requestId),
            ),
        };
    }

    return {
        grantDirect,
        grantContest,
        revokeSource,
        clearVerifiersForProblem,
        clearForProblem,
        revokeContestUser,
        revokeContestAll,
        revokePairs,
        syncContestPids,
        loadUserAcl,
        repairLegacyCanonicalWithoutSource,
        repairOrphanProblemLock,
        repairFenceWithoutProblemLock,
        repairErroredProblemWriteClaim,
        recoverActiveProblemWriteClaim,
        repairAclMutation,
        buildDriftReport,
        reconcilePair,
        resumeFencesForProblem,
        prepareProblemWriteClaim,
        resumeFence,
        resumeProblemLock,
        resumeMarkersForPair,
    };
}
