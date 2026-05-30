/**
 * Types for krypton-vigilguard.
 *
 * @see /Users/motricseven/Krypton/CLIENT_REQUIRED_CONTEST_DESIGN.md §8 (client
 * session) and §7 (login lockout).
 */
import type { ObjectId } from 'hydrooj';

/**
 * One row in `vigil.client_sessions`. Created by `/vigil-launch` after
 * Vigil approval, deleted by Vigil notify-session-closed or by the TTL
 * sweep (24h after `expiresAt`).
 *
 * Single-contest binding: each Vigil session corresponds to exactly one
 * (domainId, contestId) pair — see DESIGN §8.1.
 */
export interface ClientSessionDoc {
    _id: ObjectId;
    /** Stable Hydro-session key, usually `session.sessionId` for Qt-launched sessions. */
    sid: string;
    /** Vigil-issued session id, used for force-finalize and reverse lookups. */
    vigilSessionId: string;
    domainId: string;
    /**
     * Owning contest. Stored as an ObjectId — the request layer uses this to
     * gate `/exam-mode/:tid`, `/contest/:tid/...` access.
     */
    contestId: ObjectId;
    uid: number;
    machineId: string;
    /** True if this session is bound to a temporary user account. */
    isTemporary: boolean;
    /**
     * True if Vigil approval explicitly granted scope-override (temp account
     * or human-decided override). When true the scope-hit check at the
     * contest-access layer is skipped for THIS session only.
     */
    scopeOverride: boolean;
    createdAt: Date;
    /** Wall-clock expiry; TTL index drops the doc 24h after this. */
    expiresAt: Date;
}
