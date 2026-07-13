/**
 * Type definitions for @hydrooj/krypton-permits.
 *
 * Per-problem permits — a fine-grained ACL layer on top of hydro's coarse
 * `PERM_VIEW_PROBLEM_HIDDEN` global permission. Use cases:
 *
 *   - Invite a peer to verify a single hidden problem before publishing,
 *     without granting view-all-hidden domain perms.
 *   - Preserve direct and multiple contest grants independently, then derive
 *     one active canonical role per user/problem pair.
 *
 * Three roles:
 *   - `verifier`  : read-only view of the problem (statement, data, records)
 *   - `author`    : managed-problem content/config/file editing only
 *   - `maintainer`: managed content plus draft metadata/collaborator management
 *
 * `problem.permits.active` is the ACL authority when present. Production
 * legacy rows that predate the field remain active unless it is explicitly
 * `false`; compatibility reads never backfill those rows. The legacy
 * `pdoc.maintainer[]` array is a compatibility mirror and never grants access
 * by itself. Missing preload data and durable mutation fences fail closed.
 */
import type { ObjectId } from 'hydrooj';
import type { AclMutationFence, PermitSource, ProblemAclMutationLock } from './coordinator';

export const ACTIVE_WRITE_CLAIM_RECOVERY_CONFIRMATION = 'PROCESS_QUIESCED_AND_PARTIAL_WRITE_INSPECTED';

export interface ProblemWriteClaimMarker {
    requestId: string;
    actor: number;
    operation: string;
    /** Missing only on pre-P2.13 repair markers; every new claim persists it. */
    capability?: 'maintain' | 'content' | 'metadata' | 'collaborators' | 'publish' | 'archive' | 'hard-delete' | 'clone';
    state: 'active' | 'error';
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Three roles defined in the data model:
 *
 *   - `verifier`   : read-only access to a hidden problem.
 *   - `author`     : managed-problem content/config/file editing capability.
 *   - `maintainer` : broader maintenance capability and inclusion in the
 *                    author's problem-bank scope.
 *
 * Direct sources outrank contest maintainers, which outrank contest
 * verifiers. A direct verifier therefore intentionally overrides a contest
 * maintainer until that direct source is removed.
 */
export type PermitRole = 'verifier' | 'author' | 'maintainer';
export type ContestPermitRole = Exclude<PermitRole, 'author'>;

export interface PermitDoc {
    _id: ObjectId;
    domainId: string;
    /** Problem docId (the integer pid hydro uses internally). */
    pid: number;
    /** Recipient uid. */
    uid: number;
    role: PermitRole;
    /** Missing is legacy-active; explicit false never grants access. */
    active?: boolean;
    /** uid that issued the grant — author / domain admin / contest editor. */
    grantedBy: number;
    grantedAt: Date;
    /**
     * Representative winning contest source for compatibility/display only.
     * Cleanup always queries `problem.permitSources`, because multiple
     * contest sources may coexist for one canonical pair.
     */
    viaContest: ObjectId | null;
    /** Optional admin note shown alongside the permit in the list UI. */
    note: string;
}

declare module 'hydrooj' {
    interface Collections {
        'problem.permits': PermitDoc;
        'problem.permitSources': PermitSource & { _id: ObjectId };
        'problem.aclMutationFences': AclMutationFence & { _id: ObjectId };
    }

    interface ProblemDoc {
        /** Monotonic ACL/write linearization token; missing legacy value means 0. */
        aclMutationRevision?: number;
        /** Durable per-uid deny markers. Never TTL-expired or client-writable. */
        aclMutationLocks?: Array<Omit<ProblemAclMutationLock, 'domainId' | 'pid'>>;
        /** Global, durable write claim. ERROR markers require explicit repair. */
        aclWriteClaim?: ProblemWriteClaimMarker;
        /**
         * If true, this problem is exempt from the contest-end "auto-unhide"
         * worker. Use for repeated-use private problems (题源题 / 套路题 /
         * 集训内部题). The hidden flag still controls visibility — lockHidden
         * just protects against the schedule task setting `hidden: false`.
         */
        lockHidden?: boolean;
    }

    interface Tdoc {
        /**
         * Contest verifier uids — purely for UI display + sync trigger. The
         * active ACL is derived from persistent source rows into the canonical
         * `problem.permits` row.
         */
        verifiers?: number[];
    }
}
