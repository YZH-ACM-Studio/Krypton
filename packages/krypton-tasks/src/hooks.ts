/**
 * Cordis-side event hooks that mark a user's pending assignments stale
 * so the next view triggers a recompute.
 *
 * Hooks attached:
 *   - record/judge      → record.uid
 *   - contest/finish    → all contestants of that contest
 *   - paper/finalize    → paper_draft.uid
 *
 * Marking stale is cheap (single Mongo update); the recompute itself runs
 * on next view. This avoids holding cordis events while we run checkers.
 */
import type { Context, Tdoc } from 'hydrooj';
import { taskModel } from './model';

declare module 'cordis' {
    interface Events {
        'contest/attend': (tdoc: Tdoc & { uid?: number }, uid?: number) => Promise<void>;
        'paper/finalize': (payload: { domainId: string; uid: number }) => Promise<void>;
    }
}

export function attachHooks(ctx: Context) {
    // Record judge — fires on every status update; we only act when status flips to >0.
    ctx.on('record/change', async (rdoc: any) => {
        try {
            if (!rdoc?.uid || !rdoc?.domainId) return;
            await taskModel.markUserAssignmentsStale(rdoc.domainId, rdoc.uid);
        } catch {
            /* swallow; hooks must never throw */
        }
    });

    // Contest attendance / finish — handled by the standard contest events. If
    // those signals aren't present on this Hydro version, the manual recheck
    // button still works.
    ctx.on('contest/attend', async (tdoc, _uid) => {
        try {
            const uid = _uid || tdoc?.uid;
            if (!uid || !tdoc?.domainId) return;
            await taskModel.markUserAssignmentsStale(tdoc.domainId, uid);
        } catch {
            /* */
        }
    });

    // Paper finalize is exam-rule specific; krypton-paper emits 'paper/finalize'
    // with { domainId, uid }. Tolerant if the event doesn't exist yet.
    ctx.on('paper/finalize', async ({ domainId, uid }) => {
        try {
            if (!uid || !domainId) return;
            await taskModel.markUserAssignmentsStale(domainId, uid);
        } catch {
            /* */
        }
    });
}
