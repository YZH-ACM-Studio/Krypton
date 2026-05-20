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

export function apply(ctx: Context) {
    // Register routes directly — `ctx.Route` is available on the apply context
    // (same pattern as packages/blog/index.ts).
    applyHandlers(ctx);
    applyLegacyRedirects(ctx);

    // Ensure collection indexes asynchronously; errors logged but non-fatal.
    ensureIndexes().catch((e) => {
        console.error('[krypton-userbind] ensureIndexes failed:', e);
    });

    // Register migration channel — independent version number from hydrooj core.
    ctx.inject(['migration'], (c) => {
        c.migration.registerChannel('userbind', migrationScripts);
    });

    registerCommands(ctx);
}
