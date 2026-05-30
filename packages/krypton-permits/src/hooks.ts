/**
 * Cordis hook wiring — react to hydro core lifecycle events for permit
 * cleanup and contest cascade.
 *
 * Hook surface:
 *   - `problem/edit`     : if problem is now non-hidden, clear all permits.
 *                          (Hidden→public transition or fresh non-hidden
 *                          create; either way, permits no longer add value.)
 *   - `problem/delete`   : clear all permits for that pid.
 *   - `contest/before-edit` + `contest/edit`: detect pids list change, sync
 *                          contest-tagged permits for all current verifiers.
 *   - `contest/before-del` (none in bus, we use a manual revoke in handler).
 */
import type { Context } from 'hydrooj';
import { permitsModel } from './model';

/**
 * Per-process snapshot of contest pids before the edit, keyed by tid hex.
 * Used by the `contest/edit` listener to diff added/removed pids and sync
 * `viaContest`-tagged permits accordingly.
 *
 * Known limitations (documented; not currently worth solving):
 *   - Same contest concurrently edited in two tabs → second `before-edit`
 *     overwrites the first snapshot, the second `edit` diffs from a stale
 *     baseline. Mitigation: admin re-runs "邀请验比赛人" once to force
 *     a fresh full-sync.
 *   - Multi-process hydrooj (pm2 cluster) → cross-process edits miss the
 *     snapshot. Krypton currently runs single-process so N/A.
 *   - Process restart between `before-edit` and `edit` (rare) → the edit
 *     listener no-ops; same mitigation as #1.
 */
const contestOldPids = new Map<string, number[]>();

export function attachHooks(ctx: Context) {
    ctx.on('problem/edit', async (pdoc) => {
        // Permits are only useful while the problem is hidden. As soon as it
        // becomes public, drop them. `lockHidden` is intentionally not
        // consulted here — that flag only blocks the contest-end auto-unhide
        // worker; if an admin explicitly flips hidden→false they meant it.
        if (!pdoc?.domainId) return;
        if (pdoc.hidden) return;
        await permitsModel.clearForProblem(pdoc.domainId, pdoc.docId);
    });

    ctx.on('problem/delete', async (domainId, docId) => {
        await permitsModel.clearForProblem(domainId, docId);
    });

    ctx.on('contest/before-edit', (tdoc) => {
        // Snapshot the pre-edit pids list so the `contest/edit` handler can
        // diff against the post-edit list. Cleared after dispatch to avoid
        // a stale entry from a half-failed write.
        if (tdoc?._id) contestOldPids.set(tdoc._id.toHexString(), (tdoc.pids || []).slice());
    });

    ctx.on('contest/edit', async (tdoc) => {
        if (!tdoc?._id) return;
        const key = tdoc._id.toHexString();
        const oldPids = contestOldPids.get(key);
        contestOldPids.delete(key);
        if (!oldPids) return;
        const newPids = tdoc.pids || [];
        // No structural pids change → nothing to sync.
        if (oldPids.length === newPids.length
            && oldPids.every((p, i) => p === newPids[i])) return;
        const verifiers = tdoc.verifiers || [];
        if (!verifiers.length) return;
        await permitsModel.syncContestPids(
            tdoc.domainId,
            tdoc._id,
            oldPids,
            newPids,
            verifiers,
            'verifier',
            tdoc.owner || 0,
        );
    });
}
