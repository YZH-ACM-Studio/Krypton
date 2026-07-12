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
import type { PermitDoc, PermitRole } from './types';

const aclService = createAclService(mongoAclRepository);

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
    const requestId = newRequestId('revoke', opts.requestId);
    if (opts.requireOwner) {
        if (opts.requireOwner === 'viaContest' && !opts.viaContest) {
            throw new Error('viaContest is required for contest-owned revoke');
        }
        const sources = (
            await mongoAclRepository.getSources({
                domainId,
                pid: canonical.pid,
                uid: canonical.uid,
            })
        ).filter((source) => source.active === true);
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
    await aclService.revokePairs(domainId, [{ pid, uid }], newRequestId('revoke-pair', opts.requestId), opts.actor || 0, opts.writeClaimRequestId);
    return true;
}

export async function revokePairs(
    domainId: string,
    pairs: Array<{ pid: number; uid: number }>,
    opts: { requestId?: string; actor?: number; writeClaimRequestId?: string } = {},
): Promise<number> {
    return aclService.revokePairs(domainId, pairs, newRequestId('revoke-pairs', opts.requestId), opts.actor || 0, opts.writeClaimRequestId);
}

export async function grantBulkViaContest(
    domainId: string,
    pids: number[],
    uid: number,
    role: PermitRole,
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
    role: PermitRole,
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

export async function loadFencedPidsFor(domainId: string, uid: number): Promise<Set<number>> {
    return (await loadAclForUser(domainId, uid)).fencedPids;
}

export async function clearVerifiersForProblem(
    domainId: string,
    pid: number,
    opts: { requestId?: string; actor?: number; writeClaimRequestId?: string } = {},
): Promise<number> {
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
    loadMaintainedPidsFor,
    loadFencedPidsFor,
    clearVerifiersForProblem,
    clearForProblem,
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
