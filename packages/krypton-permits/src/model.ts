/**
 * Public ACL model. `problem.permits` is the one active canonical row per
 * (domainId,pid,uid); `problem.permitSources` retains direct plus every
 * contest source independently. Every mutation is delegated to the durable
 * fence coordinator in service.ts.
 */
import { ObjectId, type ObjectId as ObjectIdType } from 'hydrooj';
import { permitsColl, permitSourcesColl } from './db';
import { canonicalActiveFilter, normalizeActiveCanonicalDoc } from './legacy-canonical';
import { mongoAclRepository } from './repository';
import { createAclService } from './service';
import type { ContestPermitRole, PermitDoc, PermitRole } from './types';

const aclService = createAclService(mongoAclRepository);

type BoundWriteCapability = 'collaborators' | 'publish' | 'maintain' | 'hard-delete';

interface ManagedDraftIdentity {
    documentId: ObjectIdType;
    publicPid: string;
    owner: number;
}

async function assertBoundWriteClaimCapability(
    domainId: string,
    pid: number,
    requestId: string | undefined,
    required: BoundWriteCapability[],
    actor?: number,
    managed = false,
): Promise<void> {
    if (!requestId) {
        if (managed) throw new Error(`managed problem mutation requires a bound write claim for ${domainId}/${pid}`);
        return;
    }
    const claim = await mongoAclRepository.getProblemWriteClaim(domainId, pid);
    if (
        !claim ||
        claim.requestId !== requestId ||
        claim.state !== 'active' ||
        (actor !== undefined && claim.actor !== actor) ||
        !required.includes(claim.capability as BoundWriteCapability)
    ) {
        throw new Error(`problem write claim ${requestId} lacks ${required.join('/')} capability for ${domainId}/${pid}`);
    }
}

async function pairHasMaintainerRole(domainId: string, pid: number, uid: number): Promise<boolean> {
    const [canonical, sources] = await Promise.all([
        mongoAclRepository.getCanonical({ domainId, pid, uid }),
        mongoAclRepository.getSources({ domainId, pid, uid }),
    ]);
    return canonical?.role === 'maintainer' || sources.some((source) => source.active === true && source.role === 'maintainer');
}

function newRequestId(prefix: string, supplied?: string): string {
    return supplied?.trim() || `${prefix}:${new ObjectId().toHexString()}`;
}

export async function grant(
    domainId: string,
    pid: number,
    uid: number,
    role: PermitRole,
    grantedBy: number,
    opts: {
        viaContest?: ObjectIdType;
        note?: string;
        requestId?: string;
        writeClaimRequestId?: string;
    } = {},
): Promise<PermitDoc> {
    const managed = await mongoAclRepository.isManagedProblem(domainId, pid);
    const maintainerInvolved = managed && (role === 'maintainer' || (await pairHasMaintainerRole(domainId, pid, uid)));
    await assertBoundWriteClaimCapability(
        domainId,
        pid,
        opts.writeClaimRequestId,
        maintainerInvolved ? ['publish'] : ['collaborators'],
        grantedBy,
        managed,
    );
    const requestId = newRequestId('grant', opts.requestId);
    if (opts.viaContest) {
        await aclService.grantContest(
            domainId,
            pid,
            uid,
            role,
            grantedBy,
            opts.viaContest.toHexString(),
            requestId,
            opts.note || '',
            opts.writeClaimRequestId,
        );
    } else {
        await aclService.grantDirect(domainId, pid, uid, role, grantedBy, requestId, opts.note || '', opts.writeClaimRequestId);
    }
    const canonical = await permitsColl.findOne({
        domainId,
        pid,
        uid,
        active: canonicalActiveFilter(),
    });
    if (!canonical) throw new Error(`canonical ACL missing after grant ${requestId}`);
    return canonical;
}

export async function revoke(
    domainId: string,
    permitId: ObjectIdType,
    opts: {
        requireOwner?: 'direct' | 'viaContest';
        viaContest?: ObjectIdType;
        requestId?: string;
        actor?: number;
        writeClaimRequestId?: string;
    } = {},
): Promise<boolean> {
    const canonical = await permitsColl.findOne({
        domainId,
        _id: permitId,
        active: canonicalActiveFilter(),
    });
    if (!canonical) return false;
    const sources = (
        await mongoAclRepository.getSources({
            domainId,
            pid: canonical.pid,
            uid: canonical.uid,
        })
    ).filter((source) => source.active === true);
    const managed = await mongoAclRepository.isManagedProblem(domainId, canonical.pid);
    const maintainerInvolved = managed && (canonical.role === 'maintainer' || sources.some((source) => source.role === 'maintainer'));
    await assertBoundWriteClaimCapability(
        domainId,
        canonical.pid,
        opts.writeClaimRequestId,
        maintainerInvolved ? ['publish'] : ['collaborators'],
        opts.actor,
        managed,
    );
    const requestId = newRequestId('revoke', opts.requestId);
    if (opts.requireOwner) {
        if (opts.requireOwner === 'viaContest' && !opts.viaContest) {
            throw new Error('viaContest is required for contest-owned revoke');
        }
        if (sources.length) {
            const sourceType = opts.requireOwner === 'direct' ? 'direct' : 'contest';
            const sourceId = opts.requireOwner === 'direct' ? 'direct' : opts.viaContest!.toHexString();
            return aclService.revokeSource(
                domainId,
                canonical.pid,
                canonical.uid,
                sourceType,
                sourceId,
                requestId,
                opts.actor || 0,
                opts.writeClaimRequestId,
            );
        }

        // A production legacy canonical row has no source row yet. Preserve
        // its original provenance read-only until the explicit repair command
        // materializes that source; never reinterpret a contest grant as direct.
        const legacyContestId = canonical.viaContest ? canonical.viaContest.toHexString?.() || String(canonical.viaContest) : null;
        const requestedContestId = opts.viaContest?.toHexString() || null;
        if ((opts.requireOwner === 'direct' && legacyContestId) || (opts.requireOwner === 'viaContest' && legacyContestId !== requestedContestId)) {
            return false;
        }
        await aclService.revokePairs(domainId, [{ pid: canonical.pid, uid: canonical.uid }], requestId, opts.actor || 0, opts.writeClaimRequestId);
        return true;
    }
    await aclService.revokePairs(domainId, [{ pid: canonical.pid, uid: canonical.uid }], requestId, opts.actor || 0, opts.writeClaimRequestId);
    return true;
}

export async function revokeByPair(
    domainId: string,
    pid: number,
    uid: number,
    opts: { requestId?: string; actor?: number; writeClaimRequestId?: string } = {},
): Promise<boolean> {
    const sources = await mongoAclRepository.getSources({ domainId, pid, uid });
    const canonical = await mongoAclRepository.getCanonical({ domainId, pid, uid });
    if (!sources.length && !canonical) return false;
    const managed = await mongoAclRepository.isManagedProblem(domainId, pid);
    const maintainerInvolved =
        managed && (canonical?.role === 'maintainer' || sources.some((source) => source.active && source.role === 'maintainer'));
    await assertBoundWriteClaimCapability(
        domainId,
        pid,
        opts.writeClaimRequestId,
        maintainerInvolved ? ['publish'] : ['collaborators'],
        opts.actor,
        managed,
    );
    await aclService.revokePairs(domainId, [{ pid, uid }], newRequestId('revoke-pair', opts.requestId), opts.actor || 0, opts.writeClaimRequestId);
    return true;
}

export async function revokePairs(
    domainId: string,
    pairs: Array<{ pid: number; uid: number }>,
    opts: { requestId?: string; actor?: number; writeClaimRequestId?: string } = {},
): Promise<number> {
    const uniquePairs = [...new Map(pairs.map((pair) => [`${pair.pid}:${pair.uid}`, pair])).values()];
    const managedPairs: typeof uniquePairs = [];
    for (const pair of uniquePairs) {
        const managed = await mongoAclRepository.isManagedProblem(domainId, pair.pid);
        if (!managed) {
            await assertBoundWriteClaimCapability(domainId, pair.pid, opts.writeClaimRequestId, ['collaborators'], opts.actor, false);
            continue;
        }
        managedPairs.push(pair);
        const maintainerInvolved = await pairHasMaintainerRole(domainId, pair.pid, pair.uid);
        await assertBoundWriteClaimCapability(
            domainId,
            pair.pid,
            opts.writeClaimRequestId,
            maintainerInvolved ? ['publish'] : ['collaborators'],
            opts.actor,
            true,
        );
    }
    if (managedPairs.length > 1) throw new Error('managed problem ACL mutations accept exactly one user per request');
    return aclService.revokePairs(domainId, uniquePairs, newRequestId('revoke-pairs', opts.requestId), opts.actor || 0, opts.writeClaimRequestId);
}

/** Single-use bootstrap used only while creating a brand-new managed draft. */
export async function bootstrapManagedDraftAuthor(
    domainId: string,
    pid: number,
    creator: number,
    opts: { requestId?: string; note?: string } = {},
): Promise<PermitDoc> {
    const [state, sources, canonical] = await Promise.all([
        mongoAclRepository.getManagedDraftBootstrapState(domainId, pid),
        mongoAclRepository.listSourcesForProblem(domainId, pid),
        mongoAclRepository.listCanonicalForProblem(domainId, pid),
    ]);
    if (
        !state ||
        state.authoringMode !== 'managed' ||
        state.owner !== creator ||
        state.hidden !== true ||
        state.metadataStatus !== 'draft' ||
        sources.length ||
        canonical.length
    ) {
        throw new Error(`managed draft author bootstrap is not available for ${domainId}/${pid}`);
    }
    const requestId = newRequestId('managed-draft-author-bootstrap', opts.requestId);
    await aclService.grantDirect(domainId, pid, creator, 'author', creator, requestId, opts.note || 'managed draft creator');
    const created = await permitsColl.findOne({ domainId, pid, uid: creator, active: canonicalActiveFilter() });
    if (!created || created.role !== 'author') {
        throw new Error(`managed draft author bootstrap did not create canonical author for ${domainId}/${pid}`);
    }
    return created;
}

/** Admin-only bootstrap bound to the new draft's active publish claim. */
export async function bootstrapManagedDraftAuthorForAdmin(
    domainId: string,
    pid: number,
    authorUid: number,
    actor: number,
    opts: { requestId?: string; note?: string; writeClaimRequestId?: string } = {},
): Promise<PermitDoc> {
    await assertBoundWriteClaimCapability(domainId, pid, opts.writeClaimRequestId, ['publish'], actor, true);
    const [state, sources, canonical] = await Promise.all([
        mongoAclRepository.getManagedDraftBootstrapState(domainId, pid),
        mongoAclRepository.listSourcesForProblem(domainId, pid),
        mongoAclRepository.listCanonicalForProblem(domainId, pid),
    ]);
    if (
        !state ||
        state.authoringMode !== 'managed' ||
        state.owner !== actor ||
        state.hidden !== true ||
        state.metadataStatus !== 'draft' ||
        sources.length ||
        canonical.length
    ) {
        throw new Error(`managed draft admin author bootstrap is not available for ${domainId}/${pid}`);
    }
    const requestId = newRequestId('managed-draft-admin-author-bootstrap', opts.requestId);
    await aclService.grantDirect(
        domainId,
        pid,
        authorUid,
        'author',
        actor,
        requestId,
        opts.note || 'administrator pre-created managed draft',
        opts.writeClaimRequestId,
    );
    const created = await permitsColl.findOne({ domainId, pid, uid: authorUid, active: canonicalActiveFilter() });
    if (!created || created.role !== 'author') {
        throw new Error(`managed draft admin author bootstrap did not create canonical author for ${domainId}/${pid}`);
    }
    return created;
}

/** Narrow cleanup companion for a failed managed-draft bootstrap. */
export async function cleanupManagedDraftCreation(
    domainId: string,
    pid: number,
    creator: number,
    opts: ManagedDraftIdentity & { requestId?: string; authorUid?: number; writeClaimRequestId?: string },
): Promise<{ removed: number; writeClaimRequestId?: string }> {
    if (opts.owner !== creator) throw new Error(`managed draft cleanup owner mismatch for ${domainId}/${pid}`);
    const identity = { documentId: opts.documentId, publicPid: opts.publicPid, owner: opts.owner };
    const [state, sources, canonical, claim] = await Promise.all([
        mongoAclRepository.getManagedDraftBootstrapState(domainId, pid, identity),
        mongoAclRepository.listSourcesForProblem(domainId, pid),
        mongoAclRepository.listCanonicalForProblem(domainId, pid),
        mongoAclRepository.getProblemWriteClaim(domainId, pid),
    ]);
    if (!state || state.authoringMode !== 'managed' || state.owner !== creator || state.hidden !== true || state.metadataStatus !== 'draft') {
        throw new Error(`managed draft cleanup is not available for ${domainId}/${pid}`);
    }
    const rows = [...sources, ...canonical];
    const expectedAuthor = opts.authorUid || creator;
    if (rows.some((row) => row.uid !== expectedAuthor || row.role !== 'author')) {
        throw new Error(`managed draft cleanup refused unexpected ACL rows for ${domainId}/${pid}`);
    }
    let writeClaimRequestId: string | undefined;
    if (claim) {
        if (
            !opts.writeClaimRequestId ||
            claim.requestId !== opts.writeClaimRequestId ||
            claim.state !== 'active' ||
            claim.actor !== creator ||
            claim.capability !== 'publish'
        ) {
            throw new Error(`managed draft cleanup claim mismatch for ${domainId}/${pid}`);
        }
        writeClaimRequestId = claim.requestId;
    }
    const removed = await aclService.clearForProblem(
        domainId,
        pid,
        newRequestId('managed-draft-cleanup', opts.requestId),
        creator,
        writeClaimRequestId,
    );
    return { removed, ...(writeClaimRequestId ? { writeClaimRequestId } : {}) };
}

/**
 * The managed-create failure path already cleared ACL after validating a
 * pristine hidden draft. Recheck that exact invariant before the delete hook
 * skips its otherwise claim-bound duplicate cleanup.
 */
export async function assertManagedDraftCreationCleanupComplete(
    domainId: string,
    pid: number,
    creator: number,
    identity: ManagedDraftIdentity,
    writeClaimRequestId?: string,
): Promise<void> {
    if (identity.owner !== creator) throw new Error(`managed draft cleanup owner mismatch for ${domainId}/${pid}`);
    const [state, sources, canonical, fences, mirror, claim] = await Promise.all([
        mongoAclRepository.getManagedDraftBootstrapState(domainId, pid, identity),
        mongoAclRepository.listSourcesForProblem(domainId, pid),
        mongoAclRepository.listCanonicalForProblem(domainId, pid),
        mongoAclRepository.listFencesForProblem(domainId, pid),
        mongoAclRepository.getProblemMirror(domainId, pid),
        mongoAclRepository.getProblemWriteClaim(domainId, pid),
    ]);
    if (
        !state ||
        state.authoringMode !== 'managed' ||
        state.owner !== creator ||
        state.hidden !== true ||
        state.metadataStatus !== 'draft' ||
        sources.length ||
        canonical.length ||
        fences.length ||
        mirror.length ||
        (writeClaimRequestId
            ? !claim ||
              claim.requestId !== writeClaimRequestId ||
              claim.state !== 'active' ||
              claim.actor !== creator ||
              claim.capability !== 'publish'
            : !!claim)
    ) {
        throw new Error(`managed draft creation cleanup is incomplete for ${domainId}/${pid}`);
    }
}

export async function grantBulkViaContest(
    domainId: string,
    pids: number[],
    uid: number,
    role: ContestPermitRole,
    grantedBy: number,
    viaContest: ObjectIdType,
    opts: { requestId?: string; note?: string } = {},
): Promise<number> {
    const base = newRequestId('contest-grant', opts.requestId);
    const contestId = viaContest.toHexString();
    const uniquePids = [...new Set(pids)].sort((a, b) => a - b);
    for (const pid of uniquePids) {
        await aclService.grantContest(domainId, pid, uid, role, grantedBy, contestId, `${base}:${pid}:${uid}`, opts.note || '');
    }
    return uniquePids.length;
}

export async function revokeContestUser(
    domainId: string,
    viaContest: ObjectIdType,
    uid: number,
    opts: { requestId?: string; actor?: number; writeClaimRequestId?: string } = {},
): Promise<number> {
    return aclService.revokeContestUser(
        domainId,
        viaContest.toHexString(),
        uid,
        newRequestId('contest-user-revoke', opts.requestId),
        opts.actor || 0,
    );
}

export async function revokeContestAll(
    domainId: string,
    viaContest: ObjectIdType,
    opts: { requestId?: string; actor?: number; writeClaimRequestId?: string } = {},
): Promise<number> {
    return aclService.revokeContestAll(domainId, viaContest.toHexString(), newRequestId('contest-revoke', opts.requestId), opts.actor || 0);
}

export async function syncContestPids(
    domainId: string,
    viaContest: ObjectIdType,
    oldPids: number[],
    newPids: number[],
    verifiers: number[],
    role: ContestPermitRole,
    grantedBy: number,
    opts: { requestId?: string } = {},
): Promise<{ added: number; removed: number }> {
    return aclService.syncContestPids(
        domainId,
        viaContest.toHexString(),
        oldPids,
        newPids,
        [...new Set(verifiers)].map((uid) => ({ uid, role })),
        grantedBy,
        newRequestId('contest-pid-sync', opts.requestId),
    );
}

export async function syncContestCurrentPids(
    domainId: string,
    viaContest: ObjectIdType,
    newPids: number[],
    verifiers: number[],
    grantedBy: number,
    opts: { requestId?: string } = {},
): Promise<{ added: number; removed: number }> {
    const contestId = viaContest.toHexString();
    const currentSources = await mongoAclRepository.listSourcesForContest(domainId, contestId);
    const oldPids = [...new Set(currentSources.map((source) => source.pid))];
    const users = [...new Set(verifiers)].map((uid) => ({
        uid,
        role: currentSources.some((source) => source.uid === uid && source.role === 'maintainer') ? ('maintainer' as const) : ('verifier' as const),
    }));
    return aclService.syncContestPids(
        domainId,
        contestId,
        oldPids,
        newPids,
        users,
        grantedBy,
        newRequestId('contest-current-pid-sync', opts.requestId),
    );
}

export async function listForProblem(domainId: string, pid: number): Promise<PermitDoc[]> {
    const rows = await permitsColl
        .find({
            domainId,
            pid,
            active: canonicalActiveFilter(),
        })
        .sort({ grantedAt: -1 })
        .toArray();
    return rows.map((row) => normalizeActiveCanonicalDoc(row) as PermitDoc);
}

export async function listForUser(domainId: string, uid: number): Promise<PermitDoc[]> {
    if (!uid) return [];
    const { permitPids } = await aclService.loadUserAcl(domainId, uid);
    if (!permitPids.size) return [];
    return permitsColl
        .find({
            domainId,
            uid,
            active: canonicalActiveFilter(),
            pid: { $in: [...permitPids] },
        })
        .sort({ grantedAt: -1 })
        .toArray()
        .then((rows) => rows.map((row) => normalizeActiveCanonicalDoc(row) as PermitDoc));
}

export async function loadAclForUser(domainId: string, uid: number) {
    if (!uid) {
        return {
            permitPids: new Set<number>(),
            authoredPids: new Set<number>(),
            maintainedPids: new Set<number>(),
            fencedPids: new Set<number>(),
        };
    }
    return aclService.loadUserAcl(domainId, uid);
}

export async function loadPermittedPidsFor(domainId: string, uid: number): Promise<Set<number>> {
    return (await loadAclForUser(domainId, uid)).permitPids;
}

export async function loadMaintainedPidsFor(domainId: string, uid: number): Promise<Set<number>> {
    return (await loadAclForUser(domainId, uid)).maintainedPids;
}

export async function loadAuthoredPidsFor(domainId: string, uid: number): Promise<Set<number>> {
    return (await loadAclForUser(domainId, uid)).authoredPids;
}

export async function loadFencedPidsFor(domainId: string, uid: number): Promise<Set<number>> {
    return (await loadAclForUser(domainId, uid)).fencedPids;
}

export async function clearVerifiersForProblem(
    domainId: string,
    pid: number,
    opts: { requestId?: string; actor?: number; writeClaimRequestId?: string } = {},
): Promise<number> {
    const managed = await mongoAclRepository.isManagedProblem(domainId, pid);
    await assertBoundWriteClaimCapability(domainId, pid, opts.writeClaimRequestId, ['publish', 'maintain'], opts.actor, managed);
    return aclService.clearVerifiersForProblem(
        domainId,
        pid,
        newRequestId('publish-clear-verifiers', opts.requestId),
        opts.actor || 0,
        opts.writeClaimRequestId,
    );
}

export async function clearForProblem(
    domainId: string,
    pid: number,
    opts: { requestId?: string; actor?: number; writeClaimRequestId?: string } = {},
): Promise<number> {
    const managed = await mongoAclRepository.isManagedProblem(domainId, pid);
    await assertBoundWriteClaimCapability(domainId, pid, opts.writeClaimRequestId, ['hard-delete'], opts.actor, managed);
    return aclService.clearForProblem(
        domainId,
        pid,
        newRequestId('hard-delete-clear-acl', opts.requestId),
        opts.actor || 0,
        opts.writeClaimRequestId,
    );
}

export async function countByContest(domainId: string, viaContest: ObjectIdType): Promise<number> {
    return permitSourcesColl.countDocuments({
        domainId,
        sourceType: 'contest',
        sourceId: viaContest.toHexString(),
        active: true,
    });
}

export async function buildDriftReport(domainId: string) {
    return aclService.buildDriftReport(domainId);
}

export async function repairLegacyMaintainerWithoutCanonical(
    domainId: string,
    pid: number,
    uid: number,
    strategy: 'grant-maintainer' | 'remove-legacy',
    actor: number,
    requestId: string,
) {
    if (strategy === 'grant-maintainer') {
        return aclService.grantDirect(domainId, pid, uid, 'maintainer', actor, requestId);
    }
    return aclService.reconcilePair({ domainId, pid, uid }, requestId, actor);
}

export async function repairCanonicalMaintainerWithoutLegacy(domainId: string, pid: number, uid: number, actor: number, requestId: string) {
    const sources = await mongoAclRepository.getSources({ domainId, pid, uid });
    if (!sources.length) throw new Error('source/canonical conflict must be repaired first');
    return aclService.reconcilePair({ domainId, pid, uid }, requestId, actor);
}

export async function repairVerifierInLegacy(domainId: string, pid: number, uid: number, actor: number, requestId: string) {
    const sources = await mongoAclRepository.getSources({ domainId, pid, uid });
    if (!sources.length) throw new Error('source/canonical conflict must be repaired first');
    return aclService.reconcilePair({ domainId, pid, uid }, requestId, actor);
}

export async function repairSourceCanonicalConflict(
    domainId: string,
    pid: number,
    uid: number,
    strategy: 'reconcile-from-sources',
    actor: number,
    requestId: string,
) {
    if (strategy !== 'reconcile-from-sources') throw new Error(`unknown source repair strategy: ${strategy}`);
    return aclService.reconcilePair({ domainId, pid, uid }, requestId, actor);
}

export async function repairLegacyCanonicalWithoutSource(domainId: string, pid: number, uid: number, actor: number, requestId: string) {
    return aclService.repairLegacyCanonicalWithoutSource({ domainId, pid, uid }, requestId, actor);
}

export async function repairOrphanProblemLock(domainId: string, pid: number, uid: number, expectedRequestId: string) {
    return aclService.repairOrphanProblemLock({ domainId, pid, uid }, expectedRequestId);
}

export async function repairFenceWithoutProblemLock(domainId: string, pid: number, uid: number, expectedRequestId: string) {
    return aclService.repairFenceWithoutProblemLock({ domainId, pid, uid }, expectedRequestId);
}

export async function repairErroredProblemWriteClaim(domainId: string, pid: number, expectedRequestId: string) {
    return aclService.repairErroredProblemWriteClaim(domainId, pid, expectedRequestId);
}

export async function recoverActiveProblemWriteClaim(domainId: string, pid: number, expectedRequestId: string, confirmation: string) {
    return aclService.recoverActiveProblemWriteClaim(domainId, pid, expectedRequestId, confirmation);
}

export async function repairAclMutation(domainId: string, pid: number, uid: number, expectedRequestId: string) {
    return aclService.repairAclMutation({ domainId, pid, uid }, expectedRequestId);
}

export async function resumeFence(domainId: string, pid: number, uid: number, expectedRequestId?: string) {
    return aclService.resumeMarkersForPair({ domainId, pid, uid }, expectedRequestId);
}

export async function prepareProblemWriteClaim(domainId: string, pid: number): Promise<void> {
    return aclService.prepareProblemWriteClaim(domainId, pid);
}

export const permitsModel = {
    grant,
    revoke,
    revokeByPair,
    revokePairs,
    grantBulkViaContest,
    revokeContestUser,
    revokeContestAll,
    syncContestPids,
    syncContestCurrentPids,
    listForProblem,
    listForUser,
    loadAclForUser,
    loadPermittedPidsFor,
    loadAuthoredPidsFor,
    loadMaintainedPidsFor,
    loadFencedPidsFor,
    clearVerifiersForProblem,
    clearForProblem,
    assertManagedDraftCreationCleanupComplete,
    countByContest,
    buildDriftReport,
    repairLegacyMaintainerWithoutCanonical,
    repairCanonicalMaintainerWithoutLegacy,
    repairVerifierInLegacy,
    repairLegacyCanonicalWithoutSource,
    repairSourceCanonicalConflict,
    repairOrphanProblemLock,
    repairFenceWithoutProblemLock,
    repairErroredProblemWriteClaim,
    recoverActiveProblemWriteClaim,
    repairAclMutation,
    resumeFence,
    prepareProblemWriteClaim,
};

/**
 * Runtime surface exposed to Hydro core. Generic ACL mutations stay private
 * to this package's authenticated handlers; core receives only claim-bound
 * lifecycle operations and the narrowly validated draft bootstrap pair.
 */
export const publicPermitsModel = {
    listForProblem,
    listForUser,
    loadAclForUser,
    loadPermittedPidsFor,
    loadAuthoredPidsFor,
    loadMaintainedPidsFor,
    loadFencedPidsFor,
    clearVerifiersForProblem,
    clearForProblem,
    bootstrapManagedDraftAuthor,
    bootstrapManagedDraftAuthorForAdmin,
    cleanupManagedDraftCreation,
    countByContest,
    prepareProblemWriteClaim,
};
