/**
 * Type definitions for @hydrooj/krypton-permits.
 *
 * Per-problem permits — a fine-grained ACL layer on top of hydro's coarse
 * `PERM_VIEW_PROBLEM_HIDDEN` global permission. Use cases:
 *
 *   - Invite a peer to verify a single hidden problem before publishing,
 *     without granting view-all-hidden domain perms.
 *   - Bulk-grant verifiers across all problems of a hidden contest. Tagged
 *     with `viaContest` so cleanup is one query when the contest is opened
 *     / deleted / loses the user from its verifier list.
 *
 * Two roles:
 *   - `verifier`  : read-only view of the problem (statement, data, records)
 *   - `maintainer`: read + edit (the old `pdoc.maintainer[]` is migrated into
 *                   permits rows with this role)
 *
 * The legacy `pdoc.maintainer[]` array is kept on the doc for backward
 * compatibility (upstream hydro code reads it). The migration creates permit
 * rows mirroring the array; canViewBy is patched to check BOTH the legacy
 * array AND permits so we don't have to mutate the array on every change.
 */
import type { ObjectId } from 'mongodb';

/**
 * Two roles defined in the data model:
 *
 *   - `verifier`   : read-only access to a hidden problem.
 *   - `maintainer` : read-only access today (semantically equivalent to
 *                    verifier — for current Krypton OJ workflow); the
 *                    role tag is preserved so a future upgrade can grant
 *                    edit rights to maintainer holders without a schema
 *                    migration. The legacy `pdoc.maintainer[]` array is
 *                    dual-written when this role is granted so that
 *                    upstream hydro code (which reads the array for
 *                    visibility filtering) stays consistent.
 *
 * UI today only exposes the `verifier` option in the invite dialog. Existing
 * `maintainer` rows from the legacy field migrate in at v1 and keep working
 * — they just don't gain extra edit privileges beyond what the verifier
 * role provides until that future upgrade ships.
 */
export type PermitRole = 'verifier' | 'maintainer';

export interface PermitDoc {
    _id: ObjectId;
    domainId: string;
    /** Problem docId (the integer pid hydro uses internally). */
    pid: number;
    /** Recipient uid. */
    uid: number;
    role: PermitRole;
    /** uid that issued the grant — author / domain admin / contest editor. */
    grantedBy: number;
    grantedAt: Date;
    /**
     * Set when the permit was created via "contest verifier" bulk-grant.
     * Cleanup queries use this tag to undo all permits granted via a single
     * contest (when contest is opened / deleted / loses the user).
     */
    viaContest: ObjectId | null;
    /** Optional admin note shown alongside the permit in the list UI. */
    note: string;
}

declare module 'hydrooj' {
    interface Collections {
        'problem.permits': PermitDoc;
    }

    interface ProblemDoc {
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
         * real ACL lives in `problem.permits` with `viaContest = this._id`.
         */
        verifiers?: number[];
    }
}
