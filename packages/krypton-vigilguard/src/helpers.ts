/**
 * Helpers used by handlers / middleware to gate access to client-required
 * contests.
 *
 * Boundary discipline:
 *   - Pure tdoc predicates (e.g. `isClientRequired`) live in hydrooj's
 *     `model/contest.ts`. Import those from there.
 *   - Anything that needs to touch `userbind.students` or
 *     `vigil.client_sessions` lives here.
 */
import type { Tdoc } from 'hydrooj';
import * as contest from 'hydrooj/src/model/contest';
import type { ObjectId } from 'hydrooj';
import { clientSessionsColl } from './db';
import type { ClientSessionDoc } from './types';

// ── Participant scope check ───────────────────────────────────────────────

/**
 * Does `uid` hit the Krypton participant scope of `tdoc`?
 *
 * Returns:
 *   - `true`  if scope-mode is `none` (no Krypton restriction)
 *   - `true`  if the user's StudentRecord matches the contest's school list /
 *             group list (depending on mode)
 *   - `false` if the user has no StudentRecord OR the record doesn't match
 *
 * NOTE: this is *not* the full access check. The handler still has to AND
 * this with the legacy Hydro access (`assign`, invite code, etc.) per
 * DESIGN §6.1. See `effectiveAccessAllowed` below.
 */
export async function hitsParticipantScope(
    domainId: string, tdoc: Tdoc, uid: number,
): Promise<boolean> {
    if (!contest.hasParticipantScope(tdoc)) return true;
    // Admins / contest owner / maintainer should bypass — but that decision
    // belongs in the caller (it usually has the `Handler` and `User`),
    // not here.

    const userbind = (global as any).Hydro?.model?.userbind;
    if (!userbind?.findStudentsByUserIds) {
        // userbind plugin not loaded — fail safe (deny) so the scope is
        // not silently ignored.
        return false;
    }
    const studentDict = await userbind.findStudentsByUserIds(domainId, [uid]);
    const record = studentDict[String(uid)];
    if (!record) return false;

    if (tdoc.participantScopeMode === 'schools') {
        const wantIds = (tdoc.participantSchoolIds || []).map((o: ObjectId) => o.toString());
        const have = record.schoolId?.toString();
        return !!have && wantIds.includes(have);
    }
    if (tdoc.participantScopeMode === 'groups') {
        const wantIds = (tdoc.participantGroupIds || []).map((o: ObjectId) => o.toString());
        const have: ObjectId[] = record.groupIds || [];
        return have.some((g) => wantIds.includes(g.toString()));
    }
    // Defensive: unknown mode → treat as no restriction. The migration
    // ensures every contest has a valid mode, so we shouldn't hit this.
    return true;
}

// ── Client session lookup ─────────────────────────────────────────────────

/**
 * Stable key used to connect the Hydro session document with
 * `vigil.client_sessions`.
 *
 * During `/vigil-launch`, Hydro has not necessarily persisted the cookie
 * token yet, so `session._id` may not exist until the base layer finishes the
 * request. The launcher creates `session.sessionId` before writing the client
 * session row; later requests load that same field from the Hydro token doc.
 */
export function clientSessionKeyFromSession(session: any): string {
    return session?.sessionId || session?._id || session?.sid || '';
}

/**
 * Look up the active Vigil-bound client session for the given Hydro session key.
 * Returns `null` if no session exists, or if it's expired (caller decides
 * whether to honor scopeOverride).
 */
export async function currentClientSession(sid: string): Promise<ClientSessionDoc | null> {
    if (!sid) return null;
    const doc = await clientSessionsColl.findOne({ sid });
    if (!doc) return null;
    if (doc.expiresAt && doc.expiresAt.getTime() < Date.now()) return null;
    return doc;
}

export async function deleteClientSessionByVigilSessionId(vigilSessionId: string): Promise<number> {
    if (!vigilSessionId) return 0;
    const result = await clientSessionsColl.deleteOne({ vigilSessionId });
    return result.deletedCount || 0;
}

/**
 * Is `sid` a valid client session for accessing `contestId`? A session is
 * "valid for contest X" iff (a) the session is not expired and (b) its
 * `contestId` matches X (single-contest binding, DESIGN §8.1).
 */
export async function isValidClientSessionForContest(
    sid: string, domainId: string, contestId: ObjectId, uid?: number,
): Promise<boolean> {
    const s = await currentClientSession(sid);
    if (!s) return false;
    if (s.domainId !== domainId) return false;
    if (uid != null && s.uid !== uid) return false;
    return s.contestId.equals(contestId);
}

/**
 * Sessions that are active for (`domainId`, `contestId`). Used by the
 * delete-contest pre-check and admin overview pages.
 */
export async function listActiveSessionsForContest(
    domainId: string, contestId: ObjectId,
): Promise<ClientSessionDoc[]> {
    return await clientSessionsColl.find({
        domainId,
        contestId,
        expiresAt: { $gt: new Date() },
    }).toArray();
}

// ── Effective contest access ──────────────────────────────────────────────

/**
 * Single source of truth for "may `uid` participate in `tdoc`?" given the
 * Krypton scope rules. Handlers that already passed the legacy Hydro
 * access check (assign / invite code / public) call this to add the
 * Krypton overlay.
 *
 * Returns:
 *   - `{ ok: true }`                — access granted
 *   - `{ ok: false, reason: ... }`  — denied; `reason` is one of
 *       'scope_miss'    user has no record / record doesn't match
 *       'client_only'   contest is client_required but caller has no
 *                       active client session for THIS contest
 *
 * The caller can choose to override either reason for admins / contest
 * owner / maintainer (those are not handled here — see the handler-side
 * `user.own(tdoc) || user.hasPerm(PERM_EDIT_CONTEST)` guard idiom).
 *
 * `sidForClientCheck` is optional — pass the request's sid when you want
 * the client_required gate to be enforced. Omit it (e.g., from a CLI or a
 * background job) and only the scope check applies.
 */
export async function effectiveContestAccess(
    domainId: string, tdoc: Tdoc, uid: number,
    sidForClientCheck?: string,
): Promise<{ ok: true } | { ok: false; reason: 'scope_miss' | 'client_only' }> {
    // (1) Scope hit (if scope is set)
    const scopeOk = await hitsParticipantScope(domainId, tdoc, uid);
    if (!scopeOk) {
        // Temporary accounts with `scopeOverride` flag bypass scope —
        // check the client session first.
        if (sidForClientCheck) {
            const sess = await currentClientSession(sidForClientCheck);
            if (sess && sess.uid === uid && sess.domainId === domainId && sess.contestId.equals(tdoc.docId)
                && sess.scopeOverride) {
                // Scope override granted by Vigil approval (temp account).
            } else {
                return { ok: false, reason: 'scope_miss' };
            }
        } else {
            return { ok: false, reason: 'scope_miss' };
        }
    }

    // (2) client_required gate
    if (contest.isClientRequired(tdoc) && sidForClientCheck !== undefined) {
        const ok = await isValidClientSessionForContest(sidForClientCheck, domainId, tdoc.docId, uid);
        if (!ok) return { ok: false, reason: 'client_only' };
    }
    return { ok: true };
}
