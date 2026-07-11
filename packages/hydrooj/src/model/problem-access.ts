import type { Filter } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import { PermissionError } from '../error';
import type { User } from '../interface';
import { PERM, PRIV } from './builtin';
import * as document from './document';
import type { ProblemDoc } from './problem';

/**
 * Request-local problem ACL state populated by krypton-permits.
 *
 * `_permitPids` contains active verifier and maintainer grants, while
 * `_maintainedPids` contains maintainer grants only. `_aclFencedPids`
 * contains pairs currently undergoing an ACL role mutation for this user and
 * domain. Non-admin callers must never infer an empty ACL from absent state;
 * only `_problemAclLoaded === true` makes permit-derived access authoritative.
 */
export type ProblemAclUser = Pick<User, '_id' | 'hasPerm' | 'hasPriv'> & {
    _permitPids?: Set<number>;
    _maintainedPids?: Set<number>;
    _aclFencedPids?: Set<number>;
    _problemAclDomainId?: string;
    _problemAclLoaded?: boolean;
};

export interface ProblemWriteClaim {
    domainId: string;
    pid: number;
    requestId: string;
    actor: number;
    operation: string;
    state: 'active' | 'error';
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
}

const DENY_ALL_PROBLEMS: Filter<ProblemDoc> = { docId: { $in: [] } };
const logger = new Logger('problem-access');
/** Persistent coordination fields that must never cross a problem read boundary. */
export const PROBLEM_ACL_INTERNAL_FIELDS = new Set([
    'aclMutationRevision',
    'aclMutationLocks',
    'aclWriteClaim',
]);

function sorted(values?: Set<number>): number[] {
    return Array.from(values || []).sort((a, b) => a - b);
}

function isAclFenced(user: ProblemAclUser, pid: number): boolean {
    return user._aclFencedPids?.has(pid) === true;
}

function hasLoadedAclForProblem(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    return user._problemAclLoaded === true && user._problemAclDomainId === pdoc.domainId;
}

function selectionDenied(cause?: unknown): Error {
    // Deliberately name only the capability. Missing and out-of-scope pids
    // must remain indistinguishable to callers.
    const denied = new PermissionError(PERM.PERM_CREATE_PROBLEM);
    if (cause !== undefined) {
        Object.defineProperty(denied, 'cause', {
            value: cause,
            configurable: true,
        });
    }
    return denied;
}

/** Assert that request-local ACL state belongs to the authoritative domain. */
export function assertProblemAclDomain(user: ProblemAclUser, authoritativeDomainId: string): void {
    if (user._problemAclLoaded !== true || user._problemAclDomainId !== authoritativeDomainId) {
        throw selectionDenied();
    }
}

/** Site-wide problem-bank administrator capability. Role names are irrelevant. */
export function isProblemBankAdmin(user: ProblemAclUser): boolean {
    return user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
}

/** Whether this request may enumerate the problem bank. */
export function canBrowseProblemBank(user: ProblemAclUser): boolean {
    if (user._problemAclLoaded !== true) return false;
    return isProblemBankAdmin(user) || user.hasPerm(PERM.PERM_CREATE_PROBLEM);
}

/**
 * Mongo filter for every problem-bank list, count, exact-id lookup and search.
 * The caller supplies the domain to ProblemModel.getMulti/count; permits are
 * likewise preloaded for that current domain.
 */
export function buildProblemBankScope(user: ProblemAclUser): Filter<ProblemDoc> {
    const fenced = sorted(user._aclFencedPids);
    if (user._problemAclLoaded !== true) return { ...DENY_ALL_PROBLEMS };
    const liveLockExclusion: Filter<ProblemDoc> = {
        'aclMutationLocks.uid': { $ne: user._id },
    } as Filter<ProblemDoc>;
    if (isProblemBankAdmin(user)) {
        return fenced.length
            ? { $and: [{ docId: { $nin: fenced } }, liveLockExclusion] }
            : liveLockExclusion;
    }
    if (!canBrowseProblemBank(user)) return { ...DENY_ALL_PROBLEMS };

    const maintained = sorted(new Set(
        sorted(user._maintainedPids).filter((pid) => !user._aclFencedPids?.has(pid)),
    ));
    const authorScope: Filter<ProblemDoc> = maintained.length
        ? {
            $or: [
                { owner: user._id },
                {
                    $and: [
                        { docId: { $in: maintained } },
                        { maintainer: user._id },
                    ],
                },
            ],
        }
        : { owner: user._id };
    return fenced.length
        ? { $and: [authorScope, { docId: { $nin: fenced } }, liveLockExclusion] }
        : { $and: [authorScope, liveLockExclusion] };
}

function denyProblemAcl(user: ProblemAclUser): void {
    user._permitPids = new Set<number>();
    user._maintainedPids = new Set<number>();
    user._aclFencedPids = new Set<number>();
    user._problemAclDomainId = undefined;
    user._problemAclLoaded = false;
}

/** Reload persistent canonical/fence/ProblemDoc-lock state immediately before use. */
export async function refreshProblemAcl(
    user: ProblemAclUser,
    authoritativeDomainId: string,
): Promise<void> {
    denyProblemAcl(user);
    try {
        const permits = (global.Hydro?.model as any)?.permits;
        if (typeof permits?.loadAclForUser !== 'function') {
            throw new TypeError('permits.loadAclForUser is unavailable');
        }
        const loaded = await permits.loadAclForUser(authoritativeDomainId, user._id);
        if (!(loaded?.permitPids instanceof Set)
            || !(loaded?.maintainedPids instanceof Set)
            || !(loaded?.fencedPids instanceof Set)) {
            throw new TypeError('permits.loadAclForUser returned an invalid ACL snapshot');
        }
        user._permitPids = loaded.permitPids;
        user._maintainedPids = loaded.maintainedPids;
        user._aclFencedPids = loaded.fencedPids;
        user._problemAclDomainId = authoritativeDomainId;
        user._problemAclLoaded = true;
    } catch (error) {
        denyProblemAcl(user);
        logger.error(
            'Problem ACL reload failed domain=%s uid=%d error=%o',
            authoritativeDomainId,
            user._id,
            error,
        );
        throw selectionDenied(error);
    }
}

export type StableProblemRead = (
    filter?: Filter<ProblemDoc>,
) => Promise<ProblemDoc | null>;

/** Remove every persistent ACL coordination field from a detached ProblemDoc. */
export function stripProblemAclInternalFields(pdoc: ProblemDoc): ProblemDoc {
    const safe = { ...pdoc } as ProblemDoc;
    for (const field of PROBLEM_ACL_INTERNAL_FIELDS) delete (safe as any)[field];
    return safe;
}

function problemAclRevisionFilter(
    authoritativeDomainId: string,
    user: ProblemAclUser,
    pdoc: ProblemDoc,
): Filter<ProblemDoc> {
    const rawRevision = (pdoc as any).aclMutationRevision;
    const revision = Number.isSafeInteger(rawRevision) && rawRevision >= 0 ? rawRevision : 0;
    return {
        domainId: authoritativeDomainId,
        docType: document.TYPE_PROBLEM,
        docId: pdoc.docId,
        aclMutationRevision: revision === 0 ? { $in: [null, 0] } : revision,
        'aclMutationLocks.uid': { $ne: user._id },
    } as Filter<ProblemDoc>;
}

function claimFilter(claim: ProblemWriteClaim): Record<string, unknown> {
    return {
        domainId: claim.domainId,
        docType: document.TYPE_PROBLEM,
        docId: claim.pid,
        'aclWriteClaim.requestId': claim.requestId,
        'aclWriteClaim.actor': claim.actor,
        'aclWriteClaim.state': 'active',
    };
}

/**
 * Commit one authorized ProblemDoc metadata update with the ACL revision token
 * read during authorization. This is the linearization point shared with ACL
 * lock creation: whichever atomic update reaches the ProblemDoc first wins.
 */
export async function commitProblemAclGuardedUpdate(
    user: ProblemAclUser,
    authorizedPdoc: ProblemDoc,
    $set: Partial<ProblemDoc>,
    $unset: Record<string, unknown>,
): Promise<ProblemDoc | null> {
    // Declared below with the rest of the public capability helpers.
    // eslint-disable-next-line ts/no-use-before-define
    if (!canMaintainProblem(user, authorizedPdoc)) return null;
    if ([...Object.keys($set || {}), ...Object.keys($unset || {})]
        .some((key) => PROBLEM_ACL_INTERNAL_FIELDS.has(key))) {
        throw new TypeError('ACL mutation fields cannot be written through the problem metadata entrypoint');
    }
    const rawRevision = (authorizedPdoc as any).aclMutationRevision;
    const revision = Number.isSafeInteger(rawRevision) && rawRevision >= 0 ? rawRevision : 0;
    const filter: any = {
        domainId: authorizedPdoc.domainId,
        docType: document.TYPE_PROBLEM,
        docId: authorizedPdoc.docId,
        aclMutationRevision: revision === 0 ? { $in: [null, 0] } : revision,
        'aclMutationLocks.uid': { $ne: user._id },
        aclWriteClaim: { $exists: false },
    };
    if (authorizedPdoc.owner !== user._id && !isProblemBankAdmin(user)) {
        filter.maintainer = user._id;
    }
    const update: any = {};
    if ($set && Object.keys($set).length) update.$set = $set;
    if ($unset && Object.keys($unset).length) update.$unset = $unset;
    return document.coll.findOneAndUpdate(filter, update, { returnDocument: 'after' });
}

/**
 * Acquire the sole durable write claim for a problem. This update and ACL lock
 * creation share the ProblemDoc as their linearization point.
 */
export async function acquireProblemWriteClaim(
    user: ProblemAclUser,
    authorizedPdoc: ProblemDoc,
    requestId: string,
    operation: string,
    options: { selfRevokeUid?: number, now?: Date } = {},
): Promise<ProblemWriteClaim | null> {
    if (!requestId?.trim()) throw new TypeError('problem write claim requestId is required');
    if (!operation?.trim()) throw new TypeError('problem write claim operation is required');
    assertProblemAclDomain(user, authorizedPdoc.domainId);
    const selfRevoke = options.selfRevokeUid !== undefined;
    if (selfRevoke && options.selfRevokeUid !== user._id) {
        throw new TypeError('self-revoke write claim must target the current actor');
    }
    // Declared below with the rest of the public capability helpers.
    // eslint-disable-next-line ts/no-use-before-define
    if (!selfRevoke && !canMaintainProblem(user, authorizedPdoc)) return null;

    const timestamp = options.now || new Date();
    const stored = {
        requestId: requestId.trim(),
        actor: user._id,
        operation: operation.trim(),
        state: 'active' as const,
        lastError: null,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    const filter: any = {
        ...problemAclRevisionFilter(authorizedPdoc.domainId, user, authorizedPdoc),
        // Any target ACL lock blocks a global write, not just a lock for actor.
        'aclMutationLocks.0': { $exists: false },
        aclWriteClaim: { $exists: false },
    };
    delete filter['aclMutationLocks.uid'];
    if (!selfRevoke && !isProblemBankAdmin(user)) {
        filter.$or = [{ owner: user._id }, { maintainer: user._id }];
    }
    const result = await document.coll.findOneAndUpdate(
        filter,
        { $inc: { aclMutationRevision: 1 }, $set: { aclWriteClaim: stored } },
        { returnDocument: 'after' },
    );
    if (!result?.aclWriteClaim) return null;
    return {
        domainId: authorizedPdoc.domainId,
        pid: authorizedPdoc.docId,
        ...result.aclWriteClaim,
    } as ProblemWriteClaim;
}

/** Commit metadata while retaining an already-acquired multi-step claim. */
export async function commitProblemWriteClaimUpdate(
    claim: ProblemWriteClaim,
    $set: Partial<ProblemDoc>,
    $unset: Record<string, unknown> = {},
): Promise<ProblemDoc | null> {
    if ([...Object.keys($set || {}), ...Object.keys($unset || {})]
        .some((key) => PROBLEM_ACL_INTERNAL_FIELDS.has(key))) {
        throw new TypeError('ACL mutation fields cannot be written through a problem write claim');
    }
    const update: any = {};
    if (Object.keys($set || {}).length) update.$set = $set;
    if (Object.keys($unset || {}).length) update.$unset = $unset;
    return document.coll.findOneAndUpdate(claimFilter(claim), update, { returnDocument: 'after' });
}

/** Persist a failed write; ERROR claims never expire or auto-clear. */
export async function markProblemWriteClaimError(
    claim: ProblemWriteClaim,
    error: unknown,
    now = new Date(),
): Promise<boolean> {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const result = await document.coll.updateOne(
        claimFilter(claim),
        { $set: { 'aclWriteClaim.state': 'error', 'aclWriteClaim.lastError': message, 'aclWriteClaim.updatedAt': now } },
    );
    return result.matchedCount === 1;
}

/** Clear only the exact successful owner; ERROR claims require explicit repair. */
export async function clearProblemWriteClaim(claim: ProblemWriteClaim): Promise<boolean> {
    const result = await document.coll.updateOne(
        {
            ...claimFilter(claim),
            // Never clear the global writer while a claim-bound ACL mutation
            // still owns a ProblemDoc lock. This closes the check/clear race
            // that would otherwise strand a fence after its parent claim was
            // removed.
            'aclMutationLocks.0': { $exists: false },
        },
        { $unset: { aclWriteClaim: '' } },
    );
    return result.matchedCount === 1;
}

export async function inspectProblemWriteClaim(domainId: string, pid: number): Promise<ProblemWriteClaim | null> {
    const doc = await document.coll.findOne(
        { domainId, docType: document.TYPE_PROBLEM, docId: pid },
        { projection: { aclWriteClaim: 1 } },
    );
    return doc?.aclWriteClaim ? { domainId, pid, ...doc.aclWriteClaim } : null;
}

/**
 * Canonical ability for problem-owned mutation routes. A maintainer grant is
 * itself sufficient even if the recipient cannot create new problems.
 */
export function canMaintainProblem(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    if (!hasLoadedAclForProblem(user, pdoc)) return false;
    if (isAclFenced(user, pdoc.docId)) return false;
    if (isProblemBankAdmin(user)) return true;
    return pdoc.owner === user._id || user._maintainedPids?.has(pdoc.docId) === true;
}

/** Canonical direct-problem view check used by ProblemModel.canViewBy. */
export function canViewProblem(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    if (!hasLoadedAclForProblem(user, pdoc)) return false;
    if (!user.hasPerm(PERM.PERM_VIEW_PROBLEM)) return false;
    if (isAclFenced(user, pdoc.docId)) return false;
    if (!pdoc.hidden) return true;
    if (pdoc.owner === user._id) return true;
    if (user.hasPerm(PERM.PERM_VIEW_PROBLEM_HIDDEN)) return true;
    return user._permitPids?.has(pdoc.docId) === true;
}

/**
 * Read one directly-authorized problem at a stable ACL revision.
 *
 * `read()` performs the initial identity lookup. `read(filter)` must perform
 * the final Mongo read with the supplied revision/lock predicate. An ACL
 * mutation that overlaps the ACL refresh either appears in the refreshed
 * snapshot or invalidates that final predicate. One retry handles a mutation
 * that completed cleanly between the two reads without weakening fail-closed
 * behavior.
 */
export async function readStableViewableProblem(
    authoritativeDomainId: string,
    user: ProblemAclUser,
    read: StableProblemRead,
    attempts = 2,
): Promise<ProblemDoc | null> {
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 2) {
        throw new TypeError('stable problem reads support one or two attempts');
    }
    for (let attempt = 0; attempt < attempts; attempt++) {
        // eslint-disable-next-line no-await-in-loop
        const initial = await read();
        if (!initial || initial.domainId !== authoritativeDomainId) return null;

        // eslint-disable-next-line no-await-in-loop
        await refreshProblemAcl(user, authoritativeDomainId);
        if (!canViewProblem(user, initial)) return null;

        // This conditional read is the authorization linearization point.
        // eslint-disable-next-line no-await-in-loop
        const stable = await read(problemAclRevisionFilter(authoritativeDomainId, user, initial));
        if (!stable) continue;
        if (!canViewProblem(user, stable)) return null;
        return stripProblemAclInternalFields(stable);
    }
    return null;
}

/**
 * Read one maintainer-only problem payload at a stable ACL revision.
 *
 * Unlike a container-authorized statement read, raw config and testdata
 * metadata require current owner/maintainer authority. The final Mongo read
 * therefore binds the freshly loaded canonical role to both the ProblemDoc
 * ACL revision and its compatibility mirror; a completed downgrade can
 * invalidate either side but can never reuse the request's old preload.
 */
export async function readStableMaintainableProblem(
    authoritativeDomainId: string,
    user: ProblemAclUser,
    read: StableProblemRead,
    attempts = 2,
): Promise<ProblemDoc | null> {
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 2) {
        throw new TypeError('stable problem reads support one or two attempts');
    }
    for (let attempt = 0; attempt < attempts; attempt++) {
        // eslint-disable-next-line no-await-in-loop
        const initial = await read();
        if (!initial || initial.domainId !== authoritativeDomainId) return null;

        // eslint-disable-next-line no-await-in-loop
        await refreshProblemAcl(user, authoritativeDomainId);
        if (!canMaintainProblem(user, initial)) return null;

        const filter: any = problemAclRevisionFilter(authoritativeDomainId, user, initial);
        if (!isProblemBankAdmin(user)) {
            filter.$or = [{ owner: user._id }, { maintainer: user._id }];
        }
        // eslint-disable-next-line no-await-in-loop
        const stable = await read(filter);
        if (!stable) continue;
        if (!canMaintainProblem(user, stable)) return null;
        return stripProblemAclInternalFields(stable);
    }
    return null;
}

/**
 * Validate only newly selected problem ids against the caller's bank scope.
 * Existing/grandfathered references survive later permission changes. One
 * scoped count keeps missing and unauthorized ids indistinguishable.
 */
export async function assertProblemBankSelection(
    domainId: string,
    pids: number[],
    user: ProblemAclUser,
    grandfatheredPids: number[] = [],
): Promise<void> {
    assertProblemAclDomain(user, domainId);
    const grandfathered = new Set(grandfatheredPids);
    const added = Array.from(new Set(pids)).filter((pid) => !grandfathered.has(pid));
    if (!added.length) return;
    if (!added.every((pid) => Number.isSafeInteger(pid) && pid > 0)) throw selectionDenied();
    if (!canBrowseProblemBank(user)) throw selectionDenied();

    const count = await document.count(domainId, document.TYPE_PROBLEM, {
        $and: [
            buildProblemBankScope(user),
            { docId: { $in: added } },
        ],
    });
    if (count !== added.length) throw selectionDenied();
}
