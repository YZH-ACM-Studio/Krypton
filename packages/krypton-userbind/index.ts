/**
 * @hydrooj/krypton-userbind — student-id binding module
 *
 * Replaces the legacy dev/CAUCOJUserBind plugin. Multi-domain aware,
 * with three binding paths and ExamSession lookup support for Vigil.
 *
 * Loaded as a built-in addon — see packages/hydrooj/src/loader.ts.
 */
import { Context } from 'hydrooj';
import { registerCommands } from './src/cli';
import { applyHandlers } from './src/handler';
import { applyLegacyRedirects } from './src/legacy-redirects';
import { ensureIndexes } from './src/model';
import { migrationScripts } from './src/migration';
// Side-effect imports: register binding-path methods + export/import methods on userBindModel.
import './src/binding';
import './src/migrate-domain';

export * from './src/types';
export { userBindModel } from './src/model';

export async function apply(ctx: Context) {
    // Ensure all userbind collection indexes are in place before handlers run.
    await ensureIndexes();

    // Register migration channel — independent version number from hydrooj core.
    // See packages/hydrooj/src/lib/migration-helpers.ts for conventions.
    ctx.inject(['migration'], (c) => {
        c.migration.registerChannel('userbind', migrationScripts);
    });

    applyHandlers(ctx);
    applyLegacyRedirects(ctx);
    registerCommands(ctx);
}
