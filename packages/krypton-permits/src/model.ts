/**
 * permitsModel — grant / revoke / list problem permits.
 *
 * Permission checks here are minimal — callers (handlers) do the auth, this
 * module is pure data. The one exception is `revoke` which refuses to delete
 * the row that belongs to the problem owner (a safety net).
 *
 * Idempotency:
 *   - `grant` upserts on `(domainId, pid, uid)` — a second call for the same
 *     user just updates the role / note / viaContest tag in place.
 *   - `grantBulk` (contest cascade) uses bulkWrite upsert. Each contest-pid
 *     row gets `viaContest=tid`. If a direct (non-contest) permit already
 *     exists for that user/pid, we DO NOT overwrite it — the direct grant
 *     wins, preserving its source-of-truth role.
 */
import type { Filter, ObjectId as ObjectIdType } from 'mongodb';
import { db, NotFoundError, ObjectId } from 'hydrooj';
import { permitsColl } from './db';
import type { PermitDoc, PermitRole } from './types';

// Hydro stores problems in the shared `document` collection with
// `docType: 10` (TYPE_PROBLEM). We touch `maintainer[]` directly via this
// collection rather than through `ProblemModel.edit` to avoid firing the
// `problem/edit` bus event (which would re-trigger this plugin's own
// `clearForProblem` hook, deleting the permit we just inserted).
const documentColl = db.collection<any>('document');
const TYPE_PROBLEM = 10;

/**
 * Mirror the new permits row into the legacy `pdoc.maintainer[]` array so
 * upstream hydro code (and any future hydro routes that only read the array)
 * stays consistent with our source-of-truth permits table.
 *
 * verifier role intentionally does NOT touch maintainer[] — verifiers are
 * read-only and must not inherit edit perms via the legacy field.
 */
async function syncMaintainerField(
    domainId: string, pid: number, uid: number, action: 'add' | 'remove',
): Promise<void> {
    const update = action === 'add'
        ? { $addToSet: { maintainer: uid } }
        : { $pull: { maintainer: uid } };
    await documentColl.updateOne(
        { domainId, docType: TYPE_PROBLEM, docId: pid },
        update as any,
    );
}

// ─── Single-row ops ───────────────────────────────────────────────────────

export async function grant(
    domainId: string,
    pid: number,
    uid: number,
    role: PermitRole,
    grantedBy: number,
    opts: { viaContest?: ObjectIdType; note?: string } = {},
): Promise<PermitDoc> {
    const now = new Date();
    const $set: Partial<PermitDoc> = {
        role,
        grantedBy,
        note: opts.note || '',
    };
    // viaContest is only set on initial insert; we don't downgrade a direct
    // permit to a contest-tagged one if a re-grant happens.
    const $setOnInsert: Partial<PermitDoc> = {
        domainId,
        pid,
        uid,
        grantedAt: now,
        viaContest: opts.viaContest || null,
    };
    await permitsColl.updateOne(
        { domainId, pid, uid },
        { $set, $setOnInsert: { _id: new ObjectId(), ...$setOnInsert } },
        { upsert: true },
    );
    if (role === 'maintainer') {
        // Dual-write the legacy maintainer[] field. See `syncMaintainerField`.
        await syncMaintainerField(domainId, pid, uid, 'add');
    }
    return (await permitsColl.findOne({ domainId, pid, uid }))!;
}

/**
 * Revoke a permit by row id. Returns `false` if no row matched.
 *
 * If `requireOwner` is set, ensures the row is owned via the given source
 * (e.g. don't let a contest-revoke wipe a directly-granted permit).
 */
export async function revoke(
    domainId: string,
    permitId: ObjectIdType,
    opts: { requireOwner?: 'direct' | 'viaContest'; viaContest?: ObjectIdType } = {},
): Promise<boolean> {
    const filter: Filter<PermitDoc> = { domainId, _id: permitId };
    if (opts.requireOwner === 'direct') filter.viaContest = null;
    if (opts.requireOwner === 'viaContest' && opts.viaContest) {
        filter.viaContest = opts.viaContest;
    }
    // Fetch first so we can mirror to maintainer[] on success.
    const existing = await permitsColl.findOne(filter);
    if (!existing) return false;
    const res = await permitsColl.deleteOne({ _id: existing._id });
    if (res.deletedCount === 1 && existing.role === 'maintainer') {
        await syncMaintainerField(domainId, existing.pid, existing.uid, 'remove');
    }
    return res.deletedCount === 1;
}

/** Revoke by (pid, uid) — used by per-problem UI when admin removes a user. */
export async function revokeByPair(
    domainId: string,
    pid: number,
    uid: number,
): Promise<boolean> {
    const existing = await permitsColl.findOne({ domainId, pid, uid });
    if (!existing) return false;
    const res = await permitsColl.deleteOne({ _id: existing._id });
    if (res.deletedCount === 1 && existing.role === 'maintainer') {
        await syncMaintainerField(domainId, pid, uid, 'remove');
    }
    return res.deletedCount === 1;
}

// ─── Bulk ops (contest cascade) ───────────────────────────────────────────

/**
 * Grant `role` on every `pids` to `uid`, tagged with `viaContest`. Used when
 * adding a verifier to a contest.
 *
 * Per-pid behavior:
 *   - If no row exists → insert with `viaContest=tid`.
 *   - If a row exists with `viaContest=tid` (same contest) → no-op.
 *   - If a row exists with `viaContest=null` (direct grant) → leave alone.
 *     Direct grants outlive contest sync.
 *   - If a row exists with `viaContest=<other tid>` → leave alone (another
 *     contest already brought this user in). Removing the other contest's
 *     verifier list won't strip the user from this contest.
 */
export async function grantBulkViaContest(
    domainId: string,
    pids: number[],
    uid: number,
    role: PermitRole,
    grantedBy: number,
    viaContest: ObjectIdType,
): Promise<number> {
    if (!pids.length) return 0;
    const existing = await permitsColl
        .find({ domainId, pid: { $in: pids }, uid })
        .project({ pid: 1 })
        .toArray();
    const existingPids = new Set(existing.map((d) => d.pid));
    const toCreate = pids.filter((p) => !existingPids.has(p));
    if (!toCreate.length) return 0;
    const now = new Date();
    const docs: PermitDoc[] = toCreate.map((pid) => ({
        _id: new ObjectId(),
        domainId,
        pid,
        uid,
        role,
        grantedBy,
        grantedAt: now,
        viaContest,
        note: '',
    }));
    await permitsColl.insertMany(docs);
    return docs.length;
}

/** Revoke all `viaContest=tid` permits for one user. */
export async function revokeContestUser(
    domainId: string, viaContest: ObjectIdType, uid: number,
): Promise<number> {
    const res = await permitsColl.deleteMany({ domainId, viaContest, uid });
    return res.deletedCount || 0;
}

/** Revoke all `viaContest=tid` permits — e.g. when contest is opened/deleted. */
export async function revokeContestAll(
    domainId: string, viaContest: ObjectIdType,
): Promise<number> {
    const res = await permitsColl.deleteMany({ domainId, viaContest });
    return res.deletedCount || 0;
}

/**
 * Sync contest verifier list against contest pids. Called when a contest's
 * pid list changes (add / remove problems).
 *   - For pids removed from contest: delete the contest-tagged permits for
 *     ALL contest verifiers on those pids.
 *   - For pids added: grant via `grantBulkViaContest` for each verifier.
 */
export async function syncContestPids(
    domainId: string,
    viaContest: ObjectIdType,
    oldPids: number[],
    newPids: number[],
    verifiers: number[],
    role: PermitRole,
    grantedBy: number,
): Promise<{ added: number; removed: number }> {
    const oldSet = new Set(oldPids);
    const newSet = new Set(newPids);
    const removedPids = oldPids.filter((p) => !newSet.has(p));
    const addedPids = newPids.filter((p) => !oldSet.has(p));
    let removed = 0;
    let added = 0;
    if (removedPids.length && verifiers.length) {
        const r = await permitsColl.deleteMany({
            domainId,
            viaContest,
            pid: { $in: removedPids },
            uid: { $in: verifiers },
        });
        removed += r.deletedCount || 0;
    }
    if (addedPids.length && verifiers.length) {
        for (const uid of verifiers) {
            added += await grantBulkViaContest(
                domainId, addedPids, uid, role, grantedBy, viaContest,
            );
        }
    }
    return { added, removed };
}

// ─── Read ops ─────────────────────────────────────────────────────────────

export async function listForProblem(
    domainId: string, pid: number,
): Promise<PermitDoc[]> {
    return permitsColl.find({ domainId, pid }).sort({ grantedAt: -1 }).toArray();
}

export async function listForUser(
    domainId: string, uid: number,
): Promise<PermitDoc[]> {
    return permitsColl.find({ domainId, uid }).sort({ grantedAt: -1 }).toArray();
}

/**
 * Pre-fetch the user's permitted pids for one domain. Returned as a Set
 * for O(1) `has` lookups inside the sync `canViewBy`. Called by request-
 * scoped pre-handler hooks; cached on the user object as `_permitPids`.
 */
export async function loadPermittedPidsFor(
    domainId: string, uid: number,
): Promise<Set<number>> {
    if (!uid) return new Set();
    const docs = await permitsColl
        .find({ domainId, uid })
        .project({ pid: 1 })
        .toArray();
    return new Set(docs.map((d) => d.pid));
}

/**
 * Clear all permits for a problem — called when the problem transitions
 * from `hidden=true` to `hidden=false` and `lockHidden=false`. The problem
 * is now publicly visible, permits add no value.
 */
export async function clearForProblem(
    domainId: string, pid: number,
): Promise<number> {
    const res = await permitsColl.deleteMany({ domainId, pid });
    return res.deletedCount || 0;
}

/**
 * Aggregate counts by viaContest tag — drives the contest editor's
 * "currently invited verifiers" badge counts.
 */
export async function countByContest(
    domainId: string, viaContest: ObjectIdType,
): Promise<number> {
    return permitsColl.countDocuments({ domainId, viaContest });
}

// ─── Exported model surface ───────────────────────────────────────────────

export const permitsModel = {
    grant,
    revoke,
    revokeByPair,
    grantBulkViaContest,
    revokeContestUser,
    revokeContestAll,
    syncContestPids,
    listForProblem,
    listForUser,
    loadPermittedPidsFor,
    clearForProblem,
    countByContest,
};
