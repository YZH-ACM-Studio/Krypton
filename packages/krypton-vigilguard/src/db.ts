/**
 * MongoDB collection references and indexes for krypton-vigilguard.
 *
 * Collection naming: `vigil.client_sessions` — the `vigil.*` namespace
 * mirrors the (remote) Vigil Server's own naming so it's obvious on read
 * which side owns the data; this collection lives on the OJ side and is
 * the OJ-authoritative copy of "what Vigil sessions are currently active
 * against which contest".
 */
import { db } from 'hydrooj';
import type { ClientSessionDoc } from './types';

export const clientSessionsColl = (db as any).collection('vigil.client_sessions') as {
    createIndex: (...args: any[]) => Promise<any>;
    findOne: (...args: any[]) => Promise<ClientSessionDoc | null>;
    find: (...args: any[]) => { toArray: () => Promise<ClientSessionDoc[]> };
    deleteOne: (...args: any[]) => Promise<{ deletedCount?: number }>;
};

let indexesEnsured = false;

export async function ensureIndexes(): Promise<void> {
    if (indexesEnsured) return;
    indexesEnsured = true;

    await Promise.all([
        // Lookup-by-sid for the per-request lockout middleware.
        clientSessionsColl.createIndex({ sid: 1 }, { unique: true }),
        // Lookup-by-vigil-sessionId for notify-session-closed and force-finalize.
        clientSessionsColl.createIndex({ vigilSessionId: 1 }, { unique: true }),
        // Lookup active sessions for a (domainId, contestId) — used by the
        // delete-contest pre-check and the admin overview.
        clientSessionsColl.createIndex({ domainId: 1, contestId: 1 }),
        // Per-user lookup for force-close-all-sessions-for-user style admin tools.
        clientSessionsColl.createIndex({ uid: 1 }),
        // TTL: drop 24h after expiresAt. Wall-clock TTL with a 24h grace
        // keeps the row around for late audit reads without bloating storage.
        clientSessionsColl.createIndex(
            { expiresAt: 1 },
            { expireAfterSeconds: 24 * 60 * 60 },
        ),
    ]);
}
