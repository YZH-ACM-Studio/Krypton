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
import { Logger } from '@hydrooj/utils';
import type { Context } from 'hydrooj';
import { registerCommands } from './src/cli';
import { ensureIndexes } from './src/db';
import { applyHandlers } from './src/handler';
import { attachHooks } from './src/hooks';
import { migrationScripts } from './src/migration';
import { permitsModel, publicPermitsModel } from './src/model';
import { preloadProblemAcl } from './src/preload';

export { aclMutationFencesColl, permitsColl, permitSourcesColl } from './src/db';
export { permitsModel } from './src/model';
export * from './src/types';

const logger = new Logger('krypton-permits');

export async function apply(ctx: Context) {
    // Index drift is an authorization-integrity failure. Do not register a
    // partially functional plugin or let Cordis mark startup successful.
    await ensureIndexes();

    if (global.Hydro?.model) (global.Hydro.model as any).permits = publicPermitsModel;

    applyHandlers(ctx);
    attachHooks(ctx);
    registerCommands(ctx);

    ctx.inject(['migration'], (c) => {
        c.migration.registerChannel('permits', migrationScripts);
    });

    // Load one coherent request-scoped ACL snapshot. Core access helpers only
    // trust these sets when `_problemAclLoaded === true`.
    ctx.on('handler/create/http', async (h) => {
        const user = h.user as any;
        const domainId = h.domain?._id;
        await preloadProblemAcl(
            user,
            domainId,
            (loadedDomainId, uid) => permitsModel.loadAclForUser(loadedDomainId, uid),
            (error) => logger.error('ACL preload failed domain=%s uid=%d error=%s', domainId, user?._id || 0, error),
        );
    });
}
