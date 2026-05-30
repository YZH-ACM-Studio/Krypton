/**
 * Collection + indexes for krypton-permits.
 *
 * Index shapes:
 *
 *   - `{domainId, pid, uid}` UNIQUE — prevents double-grant; also covers
 *     `findOne` for "does user X have a permit on problem Y".
 *   - `{domainId, uid}` — drives the "我的验题" inbox + bulk pre-fetch on
 *     user-load (to feed canViewBy without an extra round-trip).
 *   - `{domainId, pid}` — drives the "this problem's permit list" panel
 *     in the problem editor.
 *   - `{domainId, viaContest}` partial — cleanup queries when a contest
 *     opens / is deleted / loses a verifier from its list.
 */
import { db } from 'hydrooj';
import type { PermitDoc } from './types';

export const permitsColl = db.collection<PermitDoc>('problem.permits');

let indexesEnsured = false;

export async function ensureIndexes(): Promise<void> {
    if (indexesEnsured) return;
    indexesEnsured = true;

    await Promise.all([
        permitsColl.createIndex(
            { domainId: 1, pid: 1, uid: 1 },
            { unique: true },
        ),
        permitsColl.createIndex({ domainId: 1, uid: 1 }),
        permitsColl.createIndex({ domainId: 1, pid: 1 }),
        permitsColl.createIndex(
            { domainId: 1, viaContest: 1 },
            { partialFilterExpression: { viaContest: { $type: 'objectId' } } },
        ),
    ]);
}
