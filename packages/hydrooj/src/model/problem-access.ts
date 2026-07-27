import type { Filter } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import { PermissionError, ValidationError } from '../error';
import { assertProgrammingStatementComplete, compileProgrammingStatement } from '../lib/programming-statement';
import { PERM, PRIV } from './builtin';
import { assertCodeEvaluationLifecyclePatch, assertProblemReadyForUse, CODE_EVALUATION_CANDIDATE_FILTER } from './code-evaluation-lifecycle';
import * as document from './document';
import { canonicalizeManagedDraftMindmapPatch } from './managed-problem-authoring';
import { managedProblemPatchCapability, managedProblemPatchStateFilter } from './managed-problem-patch';
import {
    loadPidNamespaceAclForUser,
    pidNamespaceCapabilityForProblem,
    withPidNamespaceBoundary,
    type PidNamespaceAclUser,
} from './problem-pid-namespace';
import type { ProblemDoc } from './problem';
import { canonicalizeStructuredKnowledgePatch, touchesCanonicalProblemFields } from './structured-problem-metadata';

/**
 * Request-local problem ACL state populated by krypton-permits.
 *
 * `_permitPids` contains every active role, `_authoredPids` contains managed
 * authors, `_maintainedPids` contains maintainers, and the two contribution
 * sets contain only active narrow data/tag assignments. `_aclFencedPids`
 * contains pairs currently undergoing an ACL role mutation for this user and
 * domain. `_ownsLegacyProblems` is an indexed existence fact, not a role.
 * Non-admin callers must never infer an empty ACL from absent state; only
 * `_problemAclLoaded === true` makes this complete snapshot authoritative.
 */
export type ProblemAclUser = PidNamespaceAclUser & {
    _permitPids?: Set<number>;
    _authoredPids?: Set<number>;
    _maintainedPids?: Set<number>;
    _dataContributionPids?: Set<number>;
    _tagContributionPids?: Set<number>;
    _aclFencedPids?: Set<number>;
    _ownsLegacyProblems?: boolean;
    _problemAclDomainId?: string;
    _problemAclLoaded?: boolean;
};

export type ProblemWriteCapability =
    | 'maintain'
    | 'content'
    | 'metadata'
    | 'collaborators'
    | 'contributions'
    | 'data'
    | 'tag'
    | 'publish'
    | 'archive'
    | 'hard-delete'
    | 'clone';
export type ProblemTestdataMutation = 'upload' | 'rename' | 'delete';
export type ProblemFileListSnapshot = { state: 'missing' } | { state: 'null' } | { state: 'array'; value: NonNullable<ProblemDoc['data']> };

export interface ProblemWriteClaim {
    domainId: string;
    pid: number;
    requestId: string;
    actor: number;
    operation: string;
    capability: ProblemWriteCapability;
    /** Author-only claim acquired while the managed problem is still a hidden draft. */
    managedAuthorDraftOnly?: true;
    /** Present only when the write depends on a live namespace-scoped grant. */
    pidNamespaceId?: string;
    pidNamespaceGrant?: 'manager' | 'editAll';
    state: 'active' | 'error';
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
}

const DENY_ALL_PROBLEMS: Filter<ProblemDoc> = { docId: { $in: [] } };
const logger = new Logger('problem-access');
/** Persistent coordination fields that must never cross a problem read boundary. */
export const PROBLEM_ACL_INTERNAL_FIELDS = new Set(['aclMutationRevision', 'aclMutationLocks', 'aclWriteClaim']);
const NARROW_CAPABILITY_FIELDS: Partial<Record<ProblemWriteCapability, ReadonlySet<string>>> = {
    data: new Set(['config', 'data', 'additional_file', 'codeEvaluationStatus']),
    tag: new Set(['tag', 'knowledgeMapId', 'knowledgeNodeIds', 'managedAuthoring.selectedMindmapNodeIds']),
    contributions: new Set(),
};
const PID_NAMESPACE_EDIT_ALL_FIELDS = new Set([
    'title',
    'content',
    'html',
    'difficulty',
    'tag',
    'knowledgeMapId',
    'knowledgeNodeIds',
    'config',
    'data',
    'additional_file',
    'managedAuthoring',
]);

function sorted(values?: Set<number>): number[] {
    return Array.from(values || []).sort((a, b) => a - b);
}

function assertCodeEvaluationLifecyclePatchWithTrace(
    pdoc: ProblemDoc,
    $set: Record<string, unknown>,
    $unset: Record<string, unknown>,
    context: { actor: number; operation: string; stage: string },
): void {
    try {
        assertCodeEvaluationLifecyclePatch(pdoc, $set, $unset, context.operation);
    } catch (error) {
        logger.warn(
            'Code evaluation lifecycle patch rejected domain=%s pid=%s docId=%d problemKind=%s actor=%d stage=%s structureRevision=%s result=denied fields=%o error=%o',
            pdoc.domainId,
            pdoc.pid || '-',
            pdoc.docId,
            pdoc.problemKind || 'programming',
            context.actor,
            context.stage,
            pdoc.structureRevision ?? '-',
            [...Object.keys($set), ...Object.keys($unset)],
            error,
        );
        throw error;
    }
}

function publishesProblemPatch($set: Record<string, unknown>, $unset: Record<string, unknown>): boolean {
    return $set.hidden === false || Object.keys($unset).some((field) => field === 'hidden' || field.startsWith('hidden.'));
}

function codeEvaluationSnapshotAfterPatch(pdoc: ProblemDoc, $set: Record<string, unknown>, $unset: Record<string, unknown>): ProblemDoc {
    const next = { ...pdoc } as Record<string, unknown>;
    for (const field of ['problemKind', 'config', 'codeEvaluationStatus', 'data']) {
        if (Object.hasOwn($unset, field)) delete next[field];
        if (Object.hasOwn($set, field)) next[field] = $set[field];
    }
    return next as unknown as ProblemDoc;
}

function assertCodeEvaluationReadyWithTrace(pdoc: ProblemDoc, context: { actor: number; stage: string }): void {
    try {
        assertProblemReadyForUse(pdoc, context);
    } catch (error) {
        logger.warn(
            'Code evaluation ready gate rejected domain=%s pid=%s docId=%d problemKind=%s actor=%d stage=%s structureRevision=%s result=denied error=%o',
            pdoc.domainId,
            pdoc.pid || '-',
            pdoc.docId,
            pdoc.problemKind || 'programming',
            context.actor,
            context.stage,
            pdoc.structureRevision ?? '-',
            error,
        );
        throw error;
    }
}

function isAclFenced(user: ProblemAclUser, pid: number): boolean {
    return user._aclFencedPids?.has(pid) === true;
}

function hasLoadedAclForProblem(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    return (
        user._problemAclLoaded === true &&
        user._problemAclDomainId === pdoc.domainId &&
        user._pidNamespaceAclLoaded === true &&
        user._pidNamespaceAclDomainId === pdoc.domainId
    );
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
    if (
        user._problemAclLoaded !== true ||
        user._problemAclDomainId !== authoritativeDomainId ||
        user._pidNamespaceAclLoaded !== true ||
        user._pidNamespaceAclDomainId !== authoritativeDomainId
    ) {
        throw selectionDenied();
    }
}

/** Site-wide problem-bank administrator capability. Role names are irrelevant. */
export function isProblemBankAdmin(user: ProblemAclUser): boolean {
    return user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
}

/** Whether this request may create every supported problem kind. */
export function canCreateAllProblemKinds(user: ProblemAclUser): boolean {
    return isProblemBankAdmin(user) || user.hasPerm(PERM.PERM_CREATE_PROBLEM);
}

/** Whether this request may create a hidden managed programming draft. */
export function canCreateManagedProgrammingDraft(user: ProblemAclUser): boolean {
    return canCreateAllProblemKinds(user) || user.hasPerm(PERM.PERM_CREATE_PROGRAMMING_DRAFT);
}

/** Hydro archive import remains an upper-level creation capability. */
export function canImportProblems(user: ProblemAclUser): boolean {
    return canCreateAllProblemKinds(user);
}

/** Assigning another managed author is reserved for the site problem-bank administrator. */
export function canAssignManagedAuthor(user: ProblemAclUser): boolean {
    return isProblemBankAdmin(user);
}

/** Whether this request may enumerate the problem bank. */
export function canBrowseProblemBank(user: ProblemAclUser): boolean {
    if (user._problemAclLoaded !== true || user._pidNamespaceAclLoaded !== true || user._problemAclDomainId !== user._pidNamespaceAclDomainId) {
        return false;
    }
    return (
        isProblemBankAdmin(user) ||
        user.hasPerm(PERM.PERM_CREATE_PROBLEM) ||
        user.hasPerm(PERM.PERM_CREATE_PROGRAMMING_DRAFT) ||
        user._ownsLegacyProblems === true ||
        (user._authoredPids?.size || 0) > 0 ||
        (user._maintainedPids?.size || 0) > 0 ||
        (user._dataContributionPids?.size || 0) > 0 ||
        (user._tagContributionPids?.size || 0) > 0 ||
        (user._pidNamespaceManagerIds?.size || 0) > 0 ||
        (user._pidNamespaceEditAllIds?.size || 0) > 0
    );
}

/**
 * Mongo filter for every problem-bank list, count, exact-id lookup and search.
 * The caller supplies the domain to ProblemModel.getMulti/count; permits are
 * likewise preloaded for that current domain.
 */
function buildProblemBankScopeFor(user: ProblemAclUser, includeContributions: boolean): Filter<ProblemDoc> {
    const fenced = sorted(user._aclFencedPids);
    if (user._problemAclLoaded !== true) return { ...DENY_ALL_PROBLEMS };
    const liveLockExclusion: Filter<ProblemDoc> = {
        'aclMutationLocks.uid': { $ne: user._id },
    } as Filter<ProblemDoc>;
    if (isProblemBankAdmin(user)) {
        return fenced.length ? { $and: [{ docId: { $nin: fenced } }, liveLockExclusion] } : liveLockExclusion;
    }
    if (!canBrowseProblemBank(user)) return { ...DENY_ALL_PROBLEMS };

    const maintained = sorted(new Set(sorted(user._maintainedPids).filter((pid) => !user._aclFencedPids?.has(pid))));
    const authored = sorted(new Set(sorted(user._authoredPids).filter((pid) => !user._aclFencedPids?.has(pid))));
    const contributed = includeContributions
        ? sorted(
              new Set([...sorted(user._dataContributionPids), ...sorted(user._tagContributionPids)].filter((pid) => !user._aclFencedPids?.has(pid))),
          )
        : [];
    const managerNamespaceIds = Array.from(user._pidNamespaceManagerIds || []).sort();
    const editAllNamespaceIds = Array.from(user._pidNamespaceEditAllIds || []).sort();
    const authorScopes: Filter<ProblemDoc>[] = [];
    if (user.hasPerm(PERM.PERM_CREATE_PROBLEM) || user._ownsLegacyProblems === true) {
        authorScopes.push({ $and: [{ owner: user._id }, { authoringMode: { $ne: 'managed' } }] });
    }
    if (maintained.length) {
        const maintainedScope: Filter<ProblemDoc>[] = [{ docId: { $in: maintained } }, { maintainer: user._id }];
        // A managed maintainer may enter the bank without the broad create
        // permission. That role must not accidentally make legacy problems
        // enumerable to a user who could only reach them by direct URL before.
        if (!user.hasPerm(PERM.PERM_CREATE_PROBLEM)) maintainedScope.push({ authoringMode: 'managed' });
        authorScopes.push({ $and: maintainedScope });
    }
    if (authored.length) {
        authorScopes.push({ $and: [{ docId: { $in: authored } }, { authoringMode: 'managed' }] });
    }
    if (contributed.length) authorScopes.push({ docId: { $in: contributed } });
    if (editAllNamespaceIds.length) authorScopes.push({ pidNamespaceId: { $in: editAllNamespaceIds } });
    if (managerNamespaceIds.length) {
        authorScopes.push({
            pidNamespaceId: { $in: managerNamespaceIds },
            authoringMode: 'managed',
            hidden: true,
            archivedAt: { $exists: false },
            'managedAuthoring.metadataStatus': { $in: ['draft', 'confirmed'] },
        });
    }
    if (!authorScopes.length) return { ...DENY_ALL_PROBLEMS };
    const authorScope: Filter<ProblemDoc> = authorScopes.length === 1 ? authorScopes[0] : { $or: authorScopes };
    return fenced.length ? { $and: [authorScope, { docId: { $nin: fenced } }, liveLockExclusion] } : { $and: [authorScope, liveLockExclusion] };
}

export function buildProblemBankScope(user: ProblemAclUser): Filter<ProblemDoc> {
    return buildProblemBankScopeFor(user, true);
}

/**
 * Scope for adding new references to contests, training, courses or tasks.
 * Contribution ranges make a problem visible in the bank but never grant the
 * separate authority to place it in another container.
 */
export function buildProblemContainerSelectionScope(user: ProblemAclUser): Filter<ProblemDoc> {
    return buildProblemBankScopeFor(user, false);
}

function denyProblemAcl(user: ProblemAclUser): void {
    user._permitPids = new Set<number>();
    user._authoredPids = new Set<number>();
    user._maintainedPids = new Set<number>();
    user._dataContributionPids = new Set<number>();
    user._tagContributionPids = new Set<number>();
    user._aclFencedPids = new Set<number>();
    user._ownsLegacyProblems = false;
    user._problemAclDomainId = undefined;
    user._problemAclLoaded = false;
    user._pidNamespaceAuthorIds = new Set<string>();
    user._pidNamespaceManagerIds = new Set<string>();
    user._pidNamespaceEditAllIds = new Set<string>();
    user._pidNamespaceAclDomainId = undefined;
    user._pidNamespaceAclLoaded = false;
}

/** Reload persistent canonical/fence/ProblemDoc-lock state immediately before use. */
export async function refreshProblemAcl(user: ProblemAclUser, authoritativeDomainId: string): Promise<void> {
    denyProblemAcl(user);
    try {
        const permits = (global.Hydro?.model as any)?.permits;
        if (typeof permits?.loadAclForUser !== 'function') {
            throw new TypeError('permits.loadAclForUser is unavailable');
        }
        const [loaded, namespaceAcl] = await Promise.all([
            permits.loadAclForUser(authoritativeDomainId, user._id),
            (async () => {
                const pidNamespaces = (global.Hydro?.model as any)?.pidNamespaces;
                if (typeof pidNamespaces?.loadAclForUser !== 'function') {
                    throw new TypeError('pidNamespaces.loadAclForUser is unavailable');
                }
                return pidNamespaces.loadAclForUser(authoritativeDomainId, user._id);
            })(),
        ]);
        if (
            !(loaded?.permitPids instanceof Set) ||
            !(loaded?.authoredPids instanceof Set) ||
            !(loaded?.maintainedPids instanceof Set) ||
            !(loaded?.dataContributionPids instanceof Set) ||
            !(loaded?.tagContributionPids instanceof Set) ||
            !(loaded?.fencedPids instanceof Set) ||
            typeof loaded?.ownsLegacyProblems !== 'boolean'
        ) {
            throw new TypeError('permits.loadAclForUser returned an invalid ACL snapshot');
        }
        if (
            !(namespaceAcl?.authorNamespaceIds instanceof Set) ||
            !(namespaceAcl?.managerNamespaceIds instanceof Set) ||
            !(namespaceAcl?.editAllNamespaceIds instanceof Set)
        ) {
            throw new TypeError('pidNamespaces.loadAclForUser returned an invalid ACL snapshot');
        }
        user._permitPids = loaded.permitPids;
        user._authoredPids = loaded.authoredPids;
        user._maintainedPids = loaded.maintainedPids;
        user._dataContributionPids = loaded.dataContributionPids;
        user._tagContributionPids = loaded.tagContributionPids;
        user._aclFencedPids = loaded.fencedPids;
        user._ownsLegacyProblems = loaded.ownsLegacyProblems;
        user._problemAclDomainId = authoritativeDomainId;
        user._problemAclLoaded = true;
        user._pidNamespaceAuthorIds = namespaceAcl.authorNamespaceIds;
        user._pidNamespaceManagerIds = namespaceAcl.managerNamespaceIds;
        user._pidNamespaceEditAllIds = namespaceAcl.editAllNamespaceIds;
        user._pidNamespaceAclDomainId = authoritativeDomainId;
        user._pidNamespaceAclLoaded = true;
    } catch (error) {
        denyProblemAcl(user);
        logger.error('Problem ACL reload failed domain=%s uid=%d error=%o', authoritativeDomainId, user._id, error);
        throw selectionDenied(error);
    }
}

export type StableProblemRead = (filter?: Filter<ProblemDoc>) => Promise<ProblemDoc | null>;
export type StableProblemBatchRead = (filter: Filter<ProblemDoc>) => Promise<ProblemDoc[]>;

/** Remove every persistent ACL coordination field from a detached ProblemDoc. */
export function stripProblemAclInternalFields(pdoc: ProblemDoc): ProblemDoc {
    const safe = { ...pdoc } as ProblemDoc;
    for (const field of PROBLEM_ACL_INTERNAL_FIELDS) delete (safe as any)[field];
    return safe;
}

function problemAclRevisionFilter(authoritativeDomainId: string, user: ProblemAclUser, pdoc: ProblemDoc): Filter<ProblemDoc> {
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
    if (!claim.capability) throw new TypeError('problem write claim capability is required');
    return {
        domainId: claim.domainId,
        docType: document.TYPE_PROBLEM,
        docId: claim.pid,
        ...(claim.pidNamespaceId ? { pidNamespaceId: claim.pidNamespaceId } : {}),
        'aclWriteClaim.requestId': claim.requestId,
        'aclWriteClaim.actor': claim.actor,
        'aclWriteClaim.operation': claim.operation,
        'aclWriteClaim.capability': claim.capability,
        'aclWriteClaim.state': 'active',
        ...(claim.managedAuthorDraftOnly ? { 'aclWriteClaim.managedAuthorDraftOnly': true } : {}),
        ...(claim.pidNamespaceId ? { 'aclWriteClaim.pidNamespaceId': claim.pidNamespaceId } : {}),
        ...(claim.pidNamespaceGrant ? { 'aclWriteClaim.pidNamespaceGrant': claim.pidNamespaceGrant } : {}),
    };
}

export function normalizeProblemFileListSnapshot(
    value: unknown,
    present: boolean,
    field: 'data' | 'additional_file',
): { files: NonNullable<ProblemDoc['data']>; snapshot: ProblemFileListSnapshot } {
    if (!present) return { files: [], snapshot: { state: 'missing' } };
    if (value === null) return { files: [], snapshot: { state: 'null' } };
    if (!Array.isArray(value)) {
        throw new ValidationError(field, null, `题目 ${field} 文件元数据必须是数组、null 或缺失`);
    }
    const invalidIndex = value.findIndex(
        (item) =>
            !item ||
            typeof item !== 'object' ||
            Array.isArray(item) ||
            typeof (item as { name?: unknown }).name !== 'string' ||
            !(item as { name: string }).name.trim(),
    );
    if (invalidIndex !== -1) {
        throw new ValidationError(field, null, `题目 ${field} 文件元数据第 ${invalidIndex + 1} 项缺少有效文件名`);
    }
    return { files: value as NonNullable<ProblemDoc['data']>, snapshot: { state: 'array', value: value as NonNullable<ProblemDoc['data']> } };
}

export function problemDataSnapshotFilter(snapshot: ProblemFileListSnapshot): Filter<ProblemDoc> {
    if (snapshot.state === 'missing') return { data: { $exists: false } } as Filter<ProblemDoc>;
    if (snapshot.state === 'null') {
        return {
            $and: [{ data: null }, { data: { $exists: true } }, { data: { $not: { $type: 'array' } } }],
        } as Filter<ProblemDoc>;
    }
    return {
        $expr: { $eq: ['$data', { $literal: snapshot.value }] },
    } as Filter<ProblemDoc>;
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

    if (!canMaintainProblem(user, authorizedPdoc)) return null;
    if ([...Object.keys($set || {}), ...Object.keys($unset || {})].some((key) => PROBLEM_ACL_INTERNAL_FIELDS.has(key))) {
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
    const set = $set as Record<string, unknown>;
    const lifecycleTouched = [...Object.keys(set), ...Object.keys($unset || {})].some((field) =>
        ['problemKind', 'config', 'codeEvaluationStatus', 'data'].includes(field.split('.')[0]),
    );
    const publishes = publishesProblemPatch(set, $unset);
    if (touchesCanonicalProblemFields(set, $unset) || lifecycleTouched || publishes) {
        const current = await document.coll.findOne(filter, {
            projection: {
                domainId: 1,
                docId: 1,
                pid: 1,
                problemKind: 1,
                config: 1,
                codeEvaluationStatus: 1,
                structureRevision: 1,
                data: 1,
                tag: 1,
                authoringMode: 1,
                knowledgeMapId: 1,
                knowledgeNodeIds: 1,
            },
        });
        if (!current) return null;
        if (lifecycleTouched) {
            assertCodeEvaluationLifecyclePatchWithTrace(current as ProblemDoc, set, $unset, {
                actor: user._id,
                operation: 'acl-guarded-update',
                stage: 'acl-guarded-update',
            });
        }
        if (publishes) {
            assertCodeEvaluationReadyWithTrace(codeEvaluationSnapshotAfterPatch(current as ProblemDoc, set, $unset), {
                actor: user._id,
                stage: 'acl-guarded-publish',
            });
        }
        await canonicalizeStructuredKnowledgePatch(
            current,
            $set,
            $unset,
            { domainId: authorizedPdoc.domainId, pid: authorizedPdoc.docId, actor: user._id, operation: 'acl-guarded-update' },
            'commit',
        );
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
    options: {
        selfRevokeUid?: number;
        now?: Date;
        capability?: ProblemWriteCapability;
        requiredPidNamespaceGrant?: 'manager';
    } = {},
): Promise<ProblemWriteClaim | null> {
    if (!requestId?.trim()) throw new TypeError('problem write claim requestId is required');
    if (!operation?.trim()) throw new TypeError('problem write claim operation is required');
    assertProblemAclDomain(user, authorizedPdoc.domainId);
    const selfRevoke = options.selfRevokeUid !== undefined;
    if (selfRevoke && options.selfRevokeUid !== user._id) {
        throw new TypeError('self-revoke write claim must target the current actor');
    }
    // Declared below with the rest of the public capability helpers.

    const capability = options.capability || 'maintain';
    if (!selfRevoke && !canUseProblemWriteCapability(user, authorizedPdoc, capability)) return null;
    const managedAuthorDraftOnly = !selfRevoke && isManagedAuthorDraftOnly(user, authorizedPdoc, capability);
    const problemRoleAllowed = !selfRevoke && canUseProblemWriteCapabilityByProblemRole(user, authorizedPdoc, capability);
    const scopedGrant = !selfRevoke && !problemRoleAllowed ? pidNamespaceCapabilityForProblem(user, authorizedPdoc, capability) : null;
    const requiredManagerGrant =
        !selfRevoke &&
        !isProblemBankAdmin(user) &&
        options.requiredPidNamespaceGrant === 'manager' &&
        !!authorizedPdoc.pidNamespaceId &&
        user._pidNamespaceManagerIds?.has(authorizedPdoc.pidNamespaceId) === true;
    if (!selfRevoke && !isProblemBankAdmin(user) && options.requiredPidNamespaceGrant === 'manager' && !requiredManagerGrant) {
        return null;
    }
    const pidNamespaceGrant = requiredManagerGrant ? 'manager' : scopedGrant === 'manager' || scopedGrant === 'editAll' ? scopedGrant : undefined;
    const pidNamespaceId = pidNamespaceGrant ? authorizedPdoc.pidNamespaceId : undefined;
    if (pidNamespaceGrant && !pidNamespaceId) return null;

    const timestamp = options.now || new Date();
    const stored = {
        requestId: requestId.trim(),
        actor: user._id,
        operation: operation.trim(),
        capability,
        ...(managedAuthorDraftOnly ? { managedAuthorDraftOnly: true as const } : {}),
        ...(pidNamespaceId ? { pidNamespaceId } : {}),
        ...(pidNamespaceGrant ? { pidNamespaceGrant } : {}),
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
        applyCapabilityIdentityFilter(filter, user, authorizedPdoc, capability);
    }
    const result = await document.coll.findOneAndUpdate(
        filter,
        { $inc: { aclMutationRevision: 1 }, $set: { aclWriteClaim: stored } },
        { returnDocument: 'after' },
    );
    if (!result?.aclWriteClaim) return null;
    const claim = {
        domainId: authorizedPdoc.domainId,
        pid: authorizedPdoc.docId,
        ...result.aclWriteClaim,
    } as ProblemWriteClaim;
    if (!selfRevoke && !isProblemBankAdmin(user)) {
        try {
            // Contribution and managed-author roles live outside ProblemDoc.
            // Re-read them while this global claim blocks revocation, closing
            // the refresh/acquire race without duplicating ACL state.
            await refreshProblemAcl(user, authorizedPdoc.domainId);
            const managerGrantStillPresent =
                options.requiredPidNamespaceGrant !== 'manager' ||
                (!!result.pidNamespaceId && user._pidNamespaceManagerIds?.has(result.pidNamespaceId) === true);
            if (!canUseProblemWriteCapability(user, result as ProblemDoc, capability) || !managerGrantStillPresent) {
                if (!(await clearProblemWriteClaim(claim))) {
                    throw new Error(`problem write claim ownership lost after final authorization denial: ${claim.requestId}`);
                }
                return null;
            }
        } catch (error) {
            const remaining = await inspectProblemWriteClaim(claim.domainId, claim.pid);
            if (remaining?.requestId === claim.requestId && !(await clearProblemWriteClaim(claim))) {
                throw new Error(`problem write claim could not be cleared after final authorization failure: ${claim.requestId}`, {
                    cause: error,
                });
            }
            throw error;
        }
    }
    return claim;
}

/** Reject every field outside a narrow contribution claim before mutation. */
export function assertProblemWriteClaimFieldScope(claim: ProblemWriteClaim, fields: string[]): void {
    const allowed =
        claim.pidNamespaceGrant === 'manager' && claim.capability === 'metadata'
            ? new Set(['title', 'difficulty', 'tag', 'knowledgeMapId', 'knowledgeNodeIds', 'managedAuthoring', 'pidNamespaceReview'])
            : claim.pidNamespaceGrant === 'editAll' && ['content', 'metadata'].includes(claim.capability)
              ? PID_NAMESPACE_EDIT_ALL_FIELDS
              : NARROW_CAPABILITY_FIELDS[claim.capability];
    if (!allowed) return;
    const denied = fields.filter((field) => !allowed.has(field) && !allowed.has(field.split('.')[0]));
    if (denied.length) {
        logger.warn(
            'Narrow problem write rejected domain=%s pid=%d actor=%d requestId=%s capability=%s fields=%o result=denied',
            claim.domainId,
            claim.pid,
            claim.actor,
            claim.requestId,
            claim.capability,
            denied,
        );
        throw new ValidationError('fields', null, `${claim.capability} 协作权限不能修改字段：${denied.join(', ')}`);
    }
}

/** Commit metadata while retaining an already-acquired multi-step claim. */
export async function commitProblemWriteClaimUpdate(
    claim: ProblemWriteClaim,
    $set: Partial<ProblemDoc>,
    $unset: Record<string, unknown> = {},
    requiredCapability: ProblemWriteCapability = claim.capability,
    options: {
        expectedStructureRevision?: number;
        expectedStructureRevisionAbsent?: boolean;
        expectedTag?: string[];
        expectedData?: ProblemFileListSnapshot;
        allowHistoricalStructureLock?: boolean;
    } = {},
): Promise<ProblemDoc | null> {
    if (options.expectedStructureRevision !== undefined && options.expectedStructureRevisionAbsent) {
        throw new TypeError('expected structure revision cannot be both present and absent');
    }
    const requestedFields = [...Object.keys($set || {}), ...Object.keys($unset || {})];
    if (requestedFields.some((key) => PROBLEM_ACL_INTERNAL_FIELDS.has(key.split('.')[0]))) {
        throw new TypeError('ACL mutation fields cannot be written through a problem write claim');
    }
    if (!problemWriteCapabilityAllows(claim.capability, requiredCapability)) {
        throw new TypeError(`problem write claim capability ${claim.capability} cannot perform ${requiredCapability}`);
    }
    assertProblemWriteClaimFieldScope(claim, requestedFields);
    let filter: Filter<ProblemDoc> = {
        ...claimFilter(claim),
        ...(options.expectedStructureRevision === undefined
            ? options.expectedStructureRevisionAbsent
                ? {
                      structureRevision: { $exists: false },
                      ...(options.allowHistoricalStructureLock ? {} : { structureLockedAt: { $exists: false } }),
                  }
                : {}
            : {
                  structureRevision: options.expectedStructureRevision,
                  ...(options.allowHistoricalStructureLock ? {} : { structureLockedAt: { $exists: false } }),
              }),
        ...(options.expectedTag === undefined ? {} : { tag: options.expectedTag }),
        ...(options.expectedData === undefined ? {} : problemDataSnapshotFilter(options.expectedData)),
    };
    // MongoDB rejects projections that contain both a parent path and one of
    // its children. Claim commits always read several complete coordination
    // roots below, so collapse caller fields to their top-level roots before
    // composing the projection (for example managedAuthoring.selected... ->
    // managedAuthoring).
    const requestedProjectionRoots = Object.fromEntries(requestedFields.map((field) => [field.split('.')[0], 1]));
    const current = await document.coll.findOne(filter, {
        projection: {
            ...requestedProjectionRoots,
            domainId: 1,
            docId: 1,
            pid: 1,
            problemKind: 1,
            config: 1,
            data: 1,
            structureRevision: 1,
            authoringMode: 1,
            hidden: 1,
            codeEvaluationStatus: 1,
            managedAuthoring: 1,
            pidNamespaceId: 1,
            tag: 1,
            knowledgeMapId: 1,
            knowledgeNodeIds: 1,
            aclWriteClaim: 1,
        },
    });
    if (!current) return null;
    const managedAuthorDraftOnly = (current as any).aclWriteClaim?.managedAuthorDraftOnly === true;
    if (
        managedAuthorDraftOnly &&
        (current.authoringMode !== 'managed' || current.hidden !== true || current.managedAuthoring?.metadataStatus !== 'draft')
    ) {
        logger.warn(
            'Managed author claim commit rejected domain=%s pid=%d actor=%d requestId=%s capability=%s hidden=%s metadataStatus=%s stage=claim-commit result=denied',
            claim.domainId,
            claim.pid,
            claim.actor,
            claim.requestId,
            claim.capability,
            current.hidden,
            current.managedAuthoring?.metadataStatus || '-',
        );
        throw new ValidationError('fields', null, '普通出题人只能修改尚未发布的托管草稿');
    }
    const set = $set as Record<string, unknown>;
    assertCodeEvaluationLifecyclePatchWithTrace(current as ProblemDoc, set, $unset, {
        actor: claim.actor,
        operation: claim.operation,
        stage: 'claim-commit',
    });
    if (publishesProblemPatch(set, $unset)) {
        assertCodeEvaluationReadyWithTrace(codeEvaluationSnapshotAfterPatch(current as ProblemDoc, set, $unset), {
            actor: claim.actor,
            stage: 'claim-publish',
        });
    }
    if (current.authoringMode === 'managed' && !['data', 'tag'].includes(claim.capability)) {
        let guard = managedProblemPatchCapability(current, $set, $unset);
        if (guard.immutableFields.length || guard.publishes || !problemWriteCapabilityAllows(claim.capability, guard.capability)) {
            logger.warn(
                'Managed claim commit rejected domain=%s pid=%d actor=%d requestId=%s claimCapability=%s requiredCapability=%s fields=%o publishes=%s result=denied',
                claim.domainId,
                claim.pid,
                claim.actor,
                claim.requestId,
                claim.capability,
                guard.capability,
                guard.requestedFields,
                guard.publishes,
            );
            throw new ValidationError('fields', null, '写入字段不能绕过托管题统一服务');
        }
        await canonicalizeManagedDraftMindmapPatch(current, $set);
        guard = managedProblemPatchCapability(current, $set, $unset);
        if (guard.immutableFields.length || guard.publishes || !problemWriteCapabilityAllows(claim.capability, guard.capability)) {
            throw new ValidationError('fields', null, '知识节点物化结果超出托管题写入凭据');
        }
        filter = { ...filter, ...managedProblemPatchStateFilter(current) };
        if (managedAuthorDraftOnly) {
            filter = {
                ...filter,
                hidden: true,
                'managedAuthoring.metadataStatus': 'draft',
                'aclWriteClaim.managedAuthorDraftOnly': true,
            } as Filter<ProblemDoc>;
        }
    }
    await canonicalizeStructuredKnowledgePatch(current, $set, $unset, claim, 'claim-commit', {
        allowMapChange: claim.operation === 'programming-tag-normalize',
    });
    const update: any = {};
    if (Object.keys($set || {}).length) update.$set = $set;
    if (Object.keys($unset || {}).length) update.$unset = $unset;
    if (options.expectedStructureRevision !== undefined || options.expectedStructureRevisionAbsent) update.$inc = { structureRevision: 1 };
    const commit = () => document.coll.findOneAndUpdate(filter, update, { returnDocument: 'after' });
    if (!claim.pidNamespaceId || !claim.pidNamespaceGrant) return commit();
    return withPidNamespaceBoundary(claim.domainId, claim.pidNamespaceId, async () => {
        const snapshot = await loadPidNamespaceAclForUser(claim.domainId, claim.actor);
        const stillAuthorized =
            claim.pidNamespaceGrant === 'manager'
                ? snapshot.managerNamespaceIds.has(claim.pidNamespaceId)
                : snapshot.editAllNamespaceIds.has(claim.pidNamespaceId);
        if (!stillAuthorized) {
            logger.warn(
                'PID namespace scoped claim commit rejected domain=%s namespace=%s pid=%d actor=%d grant=%s requestId=%s stage=claim-commit result=revoked',
                claim.domainId,
                claim.pidNamespaceId,
                claim.pid,
                claim.actor,
                claim.pidNamespaceGrant,
                claim.requestId,
            );
            return null;
        }
        return commit();
    });
}

/** Persist a failed write; ERROR claims never expire or auto-clear. */
export async function markProblemWriteClaimError(claim: ProblemWriteClaim, error: unknown, now = new Date()): Promise<boolean> {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const result = await document.coll.updateOne(claimFilter(claim), {
        $set: { 'aclWriteClaim.state': 'error', 'aclWriteClaim.lastError': message, 'aclWriteClaim.updatedAt': now },
    });
    return result.matchedCount === 1;
}

/** Clear only the exact successful owner; ERROR claims require explicit repair. */
export async function clearProblemWriteClaim(claim: ProblemWriteClaim): Promise<boolean> {
    try {
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
    } catch (clearError) {
        let remaining: ProblemWriteClaim | null;
        try {
            remaining = await inspectProblemWriteClaim(claim.domainId, claim.pid);
        } catch (confirmationError) {
            logger.error(
                'Problem write claim clear response and confirmation read failed domain=%s pid=%d actor=%d capability=%s requestId=%s clearError=%o confirmationError=%o',
                claim.domainId,
                claim.pid,
                claim.actor,
                claim.capability,
                claim.requestId,
                clearError,
                confirmationError,
            );
            throw new Error(`problem write claim clear could not be confirmed: ${claim.requestId}`, {
                cause: new AggregateError([clearError, confirmationError]),
            });
        }
        const exactClaimRemains =
            remaining?.requestId === claim.requestId && remaining.actor === claim.actor && remaining.capability === claim.capability;
        if (exactClaimRemains) {
            logger.error(
                'Problem write claim clear failed and exact claim remains domain=%s pid=%d actor=%d capability=%s requestId=%s state=%s clearError=%o',
                claim.domainId,
                claim.pid,
                claim.actor,
                claim.capability,
                claim.requestId,
                remaining.state,
                clearError,
            );
            throw new Error(`problem write claim clear failed: ${claim.requestId}`, { cause: clearError });
        }
        logger.warn(
            'Problem write claim clear confirmed after lost response domain=%s pid=%d actor=%d capability=%s requestId=%s replacementRequestId=%s',
            claim.domainId,
            claim.pid,
            claim.actor,
            claim.capability,
            claim.requestId,
            remaining?.requestId,
        );
        return true;
    }
}

export async function inspectProblemWriteClaim(domainId: string, pid: number): Promise<ProblemWriteClaim | null> {
    const doc = await document.coll.findOne({ domainId, docType: document.TYPE_PROBLEM, docId: pid }, { projection: { aclWriteClaim: 1 } });
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
    if (pdoc.authoringMode === 'managed') return user._maintainedPids?.has(pdoc.docId) === true;
    return pdoc.owner === user._id || user._maintainedPids?.has(pdoc.docId) === true;
}

/** Active managed author; legacy problems deliberately have no author role. */
export function canAuthorProblem(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    if (!hasLoadedAclForProblem(user, pdoc) || isAclFenced(user, pdoc.docId) || pdoc.authoringMode !== 'managed') return false;
    if (isProblemBankAdmin(user)) return true;
    return user._authoredPids?.has(pdoc.docId) === true;
}

/**
 * Direct submission/testing capability.
 *
 * The ordinary domain permission remains authoritative for normal and
 * container submissions. Direct problem pages additionally honor the existing
 * per-problem testing roles: a hidden-problem verifier, a data contributor, or
 * the assigned author of an active hidden managed draft. The handler never
 * carries these narrow grants into a contest or homework context.
 */
export function canSubmitProblem(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    if (user.hasPerm(PERM.PERM_SUBMIT_PROBLEM)) return true;
    if (pdoc.archivedAt || !hasLoadedAclForProblem(user, pdoc) || isAclFenced(user, pdoc.docId)) return false;
    if (user._dataContributionPids?.has(pdoc.docId) === true) return true;
    const hasVerifierPermit =
        user._permitPids?.has(pdoc.docId) === true && user._authoredPids?.has(pdoc.docId) !== true && user._maintainedPids?.has(pdoc.docId) !== true;
    if (pdoc.hidden === true && hasVerifierPermit) return true;
    return (
        pdoc.authoringMode === 'managed' &&
        pdoc.hidden === true &&
        pdoc.managedAuthoring?.metadataStatus === 'draft' &&
        user._authoredPids?.has(pdoc.docId) === true
    );
}

function isManagedAuthorEditableState(pdoc: ProblemDoc): boolean {
    return pdoc.managedAuthoring?.metadataStatus === 'confirmed' || (pdoc.hidden === true && pdoc.managedAuthoring?.metadataStatus === 'draft');
}

function canEditProblemContentByProblemRole(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    if (pdoc.authoringMode !== 'managed') return canMaintainProblem(user, pdoc);
    if (canMaintainProblem(user, pdoc)) return true;
    return isManagedAuthorEditableState(pdoc) && canAuthorProblem(user, pdoc);
}

function canEditProblemMetadataByProblemRole(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    if (pdoc.authoringMode !== 'managed') return canMaintainProblem(user, pdoc);
    if (!hasLoadedAclForProblem(user, pdoc) || isAclFenced(user, pdoc.docId)) return false;
    if (isProblemBankAdmin(user)) return true;
    if (canMaintainProblem(user, pdoc)) return pdoc.managedAuthoring?.metadataStatus !== 'confirmed';
    return isManagedAuthorEditableState(pdoc) && canAuthorProblem(user, pdoc);
}

export function canEditProblemContent(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    return canEditProblemContentByProblemRole(user, pdoc) || pidNamespaceCapabilityForProblem(user, pdoc, 'content') === 'editAll';
}

export function canEditProblemMetadata(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    return canEditProblemMetadataByProblemRole(user, pdoc) || pidNamespaceCapabilityForProblem(user, pdoc, 'metadata') !== null;
}

/** Testdata, judge configuration and other evaluation-only fields. */
function canEditProblemDataByProblemRole(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    if (!hasLoadedAclForProblem(user, pdoc) || isAclFenced(user, pdoc.docId)) return false;
    return canMaintainProblem(user, pdoc) || canAuthorProblem(user, pdoc) || user._dataContributionPids?.has(pdoc.docId) === true;
}

export function canEditProblemData(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    return canEditProblemDataByProblemRole(user, pdoc) || pidNamespaceCapabilityForProblem(user, pdoc, 'data') === 'editAll';
}

/** Mindmap selection plus its canonical materialized tags, and nothing else. */
function canEditProblemTagsByProblemRole(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    if (!hasLoadedAclForProblem(user, pdoc) || isAclFenced(user, pdoc.docId)) return false;
    return canEditProblemContentByProblemRole(user, pdoc) || user._tagContributionPids?.has(pdoc.docId) === true;
}

export function canEditProblemTags(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    return canEditProblemTagsByProblemRole(user, pdoc) || pidNamespaceCapabilityForProblem(user, pdoc, 'tag') !== null;
}

export function canManageProblemCollaborators(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    if (pdoc.authoringMode !== 'managed') return canMaintainProblem(user, pdoc);
    return canMaintainProblem(user, pdoc);
}

export function canManageProblemContributions(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    if (canMaintainProblem(user, pdoc)) return true;
    return pdoc.authoringMode === 'managed' && canAuthorProblem(user, pdoc);
}

export function canOpenProblemWorkspace(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    return (
        canEditProblemContent(user, pdoc) ||
        canEditProblemData(user, pdoc) ||
        canEditProblemTags(user, pdoc) ||
        canManageProblemContributions(user, pdoc)
    );
}

export function canManageProblemMaintainers(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    if (pdoc.authoringMode !== 'managed') return canMaintainProblem(user, pdoc);
    return hasLoadedAclForProblem(user, pdoc) && !isAclFenced(user, pdoc.docId) && isProblemBankAdmin(user);
}

function canPublishProblemByProblemRole(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    if (pdoc.authoringMode !== 'managed') return canMaintainProblem(user, pdoc);
    return hasLoadedAclForProblem(user, pdoc) && !isAclFenced(user, pdoc.docId) && isProblemBankAdmin(user);
}

export function canPublishProblem(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    return canPublishProblemByProblemRole(user, pdoc) || pidNamespaceCapabilityForProblem(user, pdoc, 'publish') === 'manager';
}

export function canArchiveProblem(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    return pdoc.authoringMode === 'managed' ? canPublishProblemByProblemRole(user, pdoc) : canMaintainProblem(user, pdoc);
}

export function canDeleteProblem(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    return pdoc.authoringMode === 'managed' ? canPublishProblemByProblemRole(user, pdoc) : canMaintainProblem(user, pdoc);
}

export function canCloneProblem(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    if (pdoc.problemKind === undefined || pdoc.problemKind === 'programming') return false;
    return pdoc.authoringMode === 'managed' ? canPublishProblemByProblemRole(user, pdoc) : canMaintainProblem(user, pdoc);
}

export function canUseProblemWriteCapability(user: ProblemAclUser, pdoc: ProblemDoc, capability: ProblemWriteCapability): boolean {
    if (capability === 'content') return canEditProblemContent(user, pdoc);
    if (capability === 'metadata') return canEditProblemMetadata(user, pdoc);
    if (capability === 'collaborators') return canManageProblemCollaborators(user, pdoc);
    if (capability === 'contributions') return canManageProblemContributions(user, pdoc);
    if (capability === 'data') return canEditProblemData(user, pdoc);
    if (capability === 'tag') return canEditProblemTags(user, pdoc);
    if (capability === 'publish') return canPublishProblem(user, pdoc);
    if (capability === 'archive') return canArchiveProblem(user, pdoc);
    if (capability === 'hard-delete') return canDeleteProblem(user, pdoc);
    if (capability === 'clone') return canCloneProblem(user, pdoc);
    return canMaintainProblem(user, pdoc);
}

function canUseProblemWriteCapabilityByProblemRole(user: ProblemAclUser, pdoc: ProblemDoc, capability: ProblemWriteCapability): boolean {
    if (capability === 'content') return canEditProblemContentByProblemRole(user, pdoc);
    if (capability === 'metadata') return canEditProblemMetadataByProblemRole(user, pdoc);
    if (capability === 'collaborators') return canManageProblemCollaborators(user, pdoc);
    if (capability === 'contributions') return canManageProblemContributions(user, pdoc);
    if (capability === 'data') return canEditProblemDataByProblemRole(user, pdoc);
    if (capability === 'tag') return canEditProblemTagsByProblemRole(user, pdoc);
    if (capability === 'publish') return canPublishProblemByProblemRole(user, pdoc);
    if (capability === 'archive') {
        return pdoc.authoringMode === 'managed' ? canPublishProblemByProblemRole(user, pdoc) : canMaintainProblem(user, pdoc);
    }
    if (capability === 'hard-delete') {
        return pdoc.authoringMode === 'managed' ? canPublishProblemByProblemRole(user, pdoc) : canMaintainProblem(user, pdoc);
    }
    if (capability === 'clone') {
        if (pdoc.problemKind === undefined || pdoc.problemKind === 'programming') return false;
        return pdoc.authoringMode === 'managed' ? canPublishProblemByProblemRole(user, pdoc) : canMaintainProblem(user, pdoc);
    }
    return canMaintainProblem(user, pdoc);
}

/**
 * Capabilities are bound into the durable claim and checked again at the
 * final mutation. Only the small, explicit implication graph needed by the
 * current managed-authoring workflow is allowed.
 */
export function problemWriteCapabilityAllows(granted: ProblemWriteCapability, required: ProblemWriteCapability): boolean {
    if (granted === required) return true;
    if (granted === 'maintain') return ['content', 'metadata', 'collaborators', 'contributions', 'data', 'tag'].includes(required);
    if (granted === 'content') return ['data', 'tag'].includes(required);
    if (granted === 'metadata') return ['content', 'data', 'tag'].includes(required);
    if (granted === 'publish') return ['content', 'metadata', 'data', 'tag'].includes(required);
    return false;
}

const TESTDATA_CLAIM_OPERATIONS: Record<ProblemTestdataMutation, ReadonlySet<string>> = {
    upload: new Set(['files-upload', 'generate-testdata-callback', 'crawler-testdata-replace']),
    rename: new Set(['files-rename']),
    delete: new Set(['files-delete', 'crawler-testdata-replace']),
};

/** Keep physical testdata writers bound to their explicit server operation. */
export function problemWriteClaimAllowsTestdataMutation(claim: ProblemWriteClaim, mutation: ProblemTestdataMutation): boolean {
    return (
        claim.state === 'active' && problemWriteCapabilityAllows(claim.capability, 'data') && TESTDATA_CLAIM_OPERATIONS[mutation].has(claim.operation)
    );
}

function applyCapabilityIdentityFilter(
    filter: Record<string, unknown>,
    user: ProblemAclUser,
    pdoc: ProblemDoc,
    capability: ProblemWriteCapability,
): void {
    const scopedGrant =
        !canUseProblemWriteCapabilityByProblemRole(user, pdoc, capability) && pidNamespaceCapabilityForProblem(user, pdoc, capability);
    if (scopedGrant === 'manager' || scopedGrant === 'editAll') {
        filter.pidNamespaceId = pdoc.pidNamespaceId;
        return;
    }
    if (
        capability === 'data' &&
        !canMaintainProblem(user, pdoc) &&
        (canAuthorProblem(user, pdoc) || user._dataContributionPids?.has(pdoc.docId) === true)
    ) {
        return;
    }
    if (capability === 'tag' && user._tagContributionPids?.has(pdoc.docId) && !canEditProblemContent(user, pdoc)) return;
    if (capability === 'contributions' && pdoc.authoringMode === 'managed' && canAuthorProblem(user, pdoc) && !canMaintainProblem(user, pdoc)) {
        return;
    }
    if (pdoc.authoringMode !== 'managed') {
        filter.$or = [{ owner: user._id }, { maintainer: user._id }];
        return;
    }
    if (isManagedAuthorOnly(user, pdoc, capability)) {
        if (isManagedAuthorDraftOnly(user, pdoc, capability)) {
            filter.hidden = true;
            filter['managedAuthoring.metadataStatus'] = 'draft';
        }
        return;
    }
    filter.maintainer = user._id;
}

function isManagedAuthorOnly(user: ProblemAclUser, pdoc: ProblemDoc, capability: ProblemWriteCapability): boolean {
    return (
        ['content', 'metadata', 'tag'].includes(capability) &&
        pdoc.authoringMode === 'managed' &&
        canAuthorProblem(user, pdoc) &&
        !canMaintainProblem(user, pdoc)
    );
}

function isManagedAuthorDraftOnly(user: ProblemAclUser, pdoc: ProblemDoc, capability: ProblemWriteCapability): boolean {
    return isManagedAuthorOnly(user, pdoc, capability) && pdoc.hidden === true && pdoc.managedAuthoring?.metadataStatus === 'draft';
}

/** Canonical direct-problem view check used by ProblemModel.canViewBy. */
export function canViewProblem(user: ProblemAclUser, pdoc: ProblemDoc): boolean {
    if (!hasLoadedAclForProblem(user, pdoc)) return false;
    if (!user.hasPerm(PERM.PERM_VIEW_PROBLEM)) return false;
    if (isAclFenced(user, pdoc.docId)) return false;
    if (!pdoc.hidden) return true;
    if (isProblemBankAdmin(user)) return true;
    if (
        pidNamespaceCapabilityForProblem(user, pdoc, 'content') === 'editAll' ||
        pidNamespaceCapabilityForProblem(user, pdoc, 'publish') === 'manager'
    ) {
        return true;
    }
    if (pdoc.authoringMode === 'managed') {
        return (
            user._permitPids?.has(pdoc.docId) === true ||
            user._dataContributionPids?.has(pdoc.docId) === true ||
            user._tagContributionPids?.has(pdoc.docId) === true
        );
    }
    if (pdoc.owner === user._id) return true;
    if (user.hasPerm(PERM.PERM_VIEW_PROBLEM_HIDDEN)) return true;
    return (
        user._permitPids?.has(pdoc.docId) === true ||
        user._dataContributionPids?.has(pdoc.docId) === true ||
        user._tagContributionPids?.has(pdoc.docId) === true
    );
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
        const initial = await read();
        if (!initial || initial.domainId !== authoritativeDomainId) return null;

        await refreshProblemAcl(user, authoritativeDomainId);
        if (!canViewProblem(user, initial)) return null;

        // This conditional read is the authorization linearization point.

        const stable = await read(problemAclRevisionFilter(authoritativeDomainId, user, initial));
        if (!stable) continue;
        if (!canViewProblem(user, stable)) return null;
        return stripProblemAclInternalFields(stable);
    }
    return null;
}

/**
 * Batch form of `readStableViewableProblem` for containers that reference
 * hundreds of problems. One ACL snapshot and two Mongo reads replace the
 * previous three reads per problem while preserving the same revision/lock
 * linearization point. Only documents invalidated by a concurrent ACL change
 * are retried once.
 */
export async function readStableViewableProblems(
    authoritativeDomainId: string,
    user: ProblemAclUser,
    pids: number[],
    read: StableProblemBatchRead,
    attempts = 2,
): Promise<ProblemDoc[]> {
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 2) {
        throw new TypeError('stable problem reads support one or two attempts');
    }
    const requested = Array.from(new Set(pids));
    if (!requested.every((pid) => Number.isSafeInteger(pid) && pid > 0)) throw new TypeError('problem ids must be positive integers');

    const pending = new Set(requested);
    const visible = new Map<number, ProblemDoc>();
    for (let attempt = 0; attempt < attempts && pending.size; attempt++) {
        const wanted = Array.from(pending);
        const initialDocs = await read({ docId: { $in: wanted } });
        const initialById = new Map(initialDocs.map((pdoc) => [pdoc.docId, pdoc]));
        // A missing or cross-domain identity is final, just like the singular
        // helper's initial read; only a failed revision-guarded final read is
        // eligible for the bounded retry.
        for (const pid of wanted) {
            const pdoc = initialById.get(pid);
            if (!pdoc || pdoc.domainId !== authoritativeDomainId) pending.delete(pid);
        }
        if (!initialById.size) continue;

        await refreshProblemAcl(user, authoritativeDomainId);
        const authorized: ProblemDoc[] = [];
        for (const pdoc of initialDocs) {
            if (!pending.has(pdoc.docId)) continue;
            if (!canViewProblem(user, pdoc)) {
                pending.delete(pdoc.docId);
                continue;
            }
            authorized.push(pdoc);
        }
        if (!authorized.length) continue;

        const stableDocs = await read({
            $or: authorized.map((pdoc) => problemAclRevisionFilter(authoritativeDomainId, user, pdoc)),
        });
        const stableById = new Map(stableDocs.map((pdoc) => [pdoc.docId, pdoc]));
        for (const initial of authorized) {
            const stable = stableById.get(initial.docId);
            if (!stable) continue;
            pending.delete(initial.docId);
            if (canViewProblem(user, stable)) visible.set(stable.docId, stripProblemAclInternalFields(stable));
        }
    }
    return requested.map((pid) => visible.get(pid)).filter((pdoc): pdoc is ProblemDoc => !!pdoc);
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
        const initial = await read();
        if (!initial || initial.domainId !== authoritativeDomainId) return null;

        await refreshProblemAcl(user, authoritativeDomainId);
        if (!canMaintainProblem(user, initial)) return null;

        const filter: any = problemAclRevisionFilter(authoritativeDomainId, user, initial);
        if (!isProblemBankAdmin(user)) {
            filter.$or = [{ owner: user._id }, { maintainer: user._id }];
        }

        const stable = await read(filter);
        if (!stable) continue;
        if (!canMaintainProblem(user, stable)) return null;
        return stripProblemAclInternalFields(stable);
    }
    return null;
}

/** Stable sensitive read for one exact problem workspace capability. */
export async function readStableProblemWithCapability(
    authoritativeDomainId: string,
    user: ProblemAclUser,
    read: StableProblemRead,
    capability: ProblemWriteCapability,
    attempts = 2,
): Promise<ProblemDoc | null> {
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 2) {
        throw new TypeError('stable problem reads support one or two attempts');
    }
    for (let attempt = 0; attempt < attempts; attempt++) {
        const initial = await read();
        if (!initial || initial.domainId !== authoritativeDomainId) return null;

        await refreshProblemAcl(user, authoritativeDomainId);
        if (!canUseProblemWriteCapability(user, initial, capability)) return null;

        const filter: any = problemAclRevisionFilter(authoritativeDomainId, user, initial);
        if (!isProblemBankAdmin(user)) applyCapabilityIdentityFilter(filter, user, initial, capability);

        const stable = await read(filter);
        if (!stable) continue;
        if (!canUseProblemWriteCapability(user, stable, capability)) return null;
        return stripProblemAclInternalFields(stable);
    }
    return null;
}

/** Stable sensitive read for managed authors plus legacy owner/maintainer. */
export async function readStableEditableProblem(
    authoritativeDomainId: string,
    user: ProblemAclUser,
    read: StableProblemRead,
    attempts = 2,
): Promise<ProblemDoc | null> {
    return readStableProblemWithCapability(authoritativeDomainId, user, read, 'content', attempts);
}

/**
 * Validate every selected code-evaluation problem through the full ready gate,
 * then check only newly selected ids against the caller's bank scope.
 * Existing/grandfathered references survive later permission changes, but can
 * never grandfather an incomplete draft. One scoped count keeps missing and
 * unauthorized ids indistinguishable.
 */
export async function assertProblemBankSelection(
    domainId: string,
    pids: number[],
    user: ProblemAclUser,
    grandfatheredPids: number[] = [],
): Promise<void> {
    assertProblemAclDomain(user, domainId);
    const selected = Array.from(new Set(pids));
    if (!selected.every((pid) => Number.isSafeInteger(pid) && pid > 0)) throw selectionDenied();
    const grandfathered = new Set(grandfatheredPids);
    const added = selected.filter((pid) => !grandfathered.has(pid));
    if (added.length && !canBrowseProblemBank(user)) throw selectionDenied();
    if (selected.length) {
        const candidates = await document.coll
            .find(
                {
                    domainId,
                    docType: document.TYPE_PROBLEM,
                    docId: { $in: selected },
                    $or: [...CODE_EVALUATION_CANDIDATE_FILTER.$or, { statementFormat: 'structured-v1' }],
                } as Filter<ProblemDoc>,
                {
                    projection: {
                        domainId: 1,
                        docId: 1,
                        pid: 1,
                        problemKind: 1,
                        codeEvaluationStatus: 1,
                        structureRevision: 1,
                        config: 1,
                        data: 1,
                        content: 1,
                        statementFormat: 1,
                        programmingStatement: 1,
                    },
                },
            )
            .toArray();
        for (const candidate of candidates) {
            try {
                assertProblemReadyForUse(candidate as ProblemDoc, { actor: user._id, stage: 'container-reference' });
                if (candidate.statementFormat === 'structured-v1') {
                    const statement = assertProgrammingStatementComplete(candidate.programmingStatement, candidate.config);
                    if (compileProgrammingStatement(statement) !== candidate.content) {
                        throw new ValidationError('content', null, '结构化题面投影不一致');
                    }
                }
            } catch (error) {
                logger.warn(
                    'Problem selection ready gate rejected domain=%s pid=%s docId=%d problemKind=%s actor=%d stage=container-reference structureRevision=%s result=not-ready error=%o',
                    domainId,
                    candidate.pid || '-',
                    candidate.docId,
                    candidate.problemKind || 'programming',
                    user._id,
                    candidate.structureRevision ?? '-',
                    error,
                );
                throw selectionDenied();
            }
        }
    }
    if (!added.length) return;

    const count = await document.count(domainId, document.TYPE_PROBLEM, {
        $and: [buildProblemContainerSelectionScope(user), { docId: { $in: added }, archivedAt: { $exists: false } }],
    });
    if (count !== added.length) throw selectionDenied();
}
