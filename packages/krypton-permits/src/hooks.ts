/** Lifecycle hooks. Every write delegates to the fenced ACL model. */
import type { Context } from 'hydrooj';
import { isLegacyPublishTransition } from './hook-policy';
import { permitsModel } from './model';

export function attachHooks(ctx: Context) {
    ctx.on('problem/edit', async (pdoc, writeClaimRequestId, previous) => {
        if (!pdoc?.domainId || !isLegacyPublishTransition(pdoc, previous)) return;
        // Managed publish clears verifiers before the visibility mutation so
        // audit persistence and ACL cleanup are fail-closed. This hook remains
        // only for unchanged legacy publish behavior.
        await permitsModel.clearVerifiersForProblem(pdoc.domainId, pdoc.docId, {
            requestId: `problem-publish:${pdoc.domainId}:${pdoc.docId}`,
            actor: pdoc.owner || 0,
            writeClaimRequestId,
        });
    });

    // Run before destructive work starts. The downstream `problem/delete`
    // event is parallel with ProblemDoc deletion and is too late to verify the
    // legacy mirror deterministically.
    ctx.on('problem/before-del', async (domainId, docId, writeClaimRequestId, context) => {
        if (context?.kind === 'managed-draft-creation-cleanup') {
            await permitsModel.assertManagedDraftCreationCleanupComplete(
                domainId,
                docId,
                context.creator,
                {
                    documentId: context.documentId,
                    publicPid: context.publicPid,
                    owner: context.owner,
                },
                context.writeClaimRequestId,
            );
            return;
        }
        await permitsModel.clearForProblem(domainId, docId, {
            requestId: `problem-hard-delete:${domainId}:${docId}`,
            writeClaimRequestId,
        });
    });

    // Reconcile from persistent contest sources rather than an in-process
    // before/edit snapshot, so process restarts and concurrent edits cannot
    // lose pid synchronization.
    ctx.on('contest/edit', async (tdoc) => {
        if (!tdoc?._id || !tdoc.domainId) return;
        await permitsModel.syncContestCurrentPids(tdoc.domainId, tdoc._id, tdoc.pids || [], tdoc.verifiers || [], tdoc.owner || 0, {
            requestId: `contest-edit:${tdoc.domainId}:${tdoc._id.toHexString()}`,
        });
    });

    ctx.on('contest/del', async (domainId, tid) => {
        await permitsModel.revokeContestAll(domainId, tid, {
            requestId: `contest-delete:${domainId}:${tid.toHexString()}`,
        });
    });
}
