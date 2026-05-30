/**
 * @hydrooj/krypton-permits — per-problem permit/verifier role + contest
 * verifier cascade + lockHidden ("don't auto-publish at contest end") flag.
 *
 * Loaded as a built-in addon. See packages/hydrooj/src/loader.ts:BUILTIN_ADDONS
 * or /root/.hydro/addon.json on production.
 *
 * Surface:
 *   - Routes: /p/:pid/permits (POST), /contest/:tid/verifiers (POST),
 *             /tasks/verify (GET)
 *   - Hooks:  problem/edit, problem/delete, contest/before-edit, contest/edit
 *   - Model:  exposed on `global.Hydro.model.permits` and via the
 *             `permitsModel` named export so other plugins (UI, contest
 *             page) can read permits without re-implementing queries.
 *
 * Note: this plugin patches hydro core in two places — `ProblemModel.canViewBy`
 * and the `unhide` schedule worker in handler/contest.ts — to honor the
 * permits table and `lockHidden` flag. Those patches live in
 * `packages/hydrooj/src/...` rather than here because they're tight
 * call-site changes.
 */
import type { Context } from 'hydrooj';
import { ensureIndexes } from './src/db';
import { applyHandlers } from './src/handler';
import { attachHooks } from './src/hooks';
import { migrationScripts } from './src/migration';
import { permitsModel } from './src/model';

export * from './src/types';
export { permitsModel } from './src/model';
export { permitsColl } from './src/db';

export function apply(ctx: Context) {
    applyHandlers(ctx);
    attachHooks(ctx);

    ensureIndexes().catch((e) => {
        console.error('[krypton-permits] ensureIndexes failed:', e);
    });

    if (global.Hydro?.model) (global.Hydro.model as any).permits = permitsModel;

    ctx.inject(['migration'], (c) => {
        c.migration.registerChannel('permits', migrationScripts);
    });

    // Attach the user's permitted-pids set to `h.user._permitPids` on every
    // HTTP request. Patched `ProblemModel.canViewBy` and `buildQuery` then
    // honor permits transparently — no per-handler boilerplate needed.
    //
    // Cost: one tiny query per request (covered by the unique index, table
    // is bounded to a few hundred rows in typical Krypton use). Anonymous
    // users (_id === 0) skip the query.
    ctx.on('handler/create/http', async (h) => {
        const uid = h.user?._id;
        if (!uid || uid <= 1) return;
        const domainId = h.domain?._id;
        if (!domainId) return;
        try {
            (h.user as any)._permitPids = await permitsModel.loadPermittedPidsFor(domainId, uid);
        } catch {
            // best-effort; on failure user just sees the legacy
            // hidden-problem visibility rules.
        }
    });
}
