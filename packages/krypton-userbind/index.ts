/**
 * @hydrooj/krypton-userbind — student-id binding module
 *
 * Replaces the legacy dev/CAUCOJUserBind plugin. Multi-domain aware,
 * with three binding paths and ExamSession lookup support for Vigil.
 *
 * Loaded as a built-in addon — see packages/hydrooj/src/loader.ts.
 */
// Side-effect imports: register binding-path methods + export/import methods on userBindModel.
import { Context, SettingModel } from 'hydrooj';
import { registerCommands } from './src/cli';
import { applyHandlers } from './src/handler';
import { applyLegacyRedirects } from './src/legacy-redirects';
import { ensureIndexes, userBindModel } from './src/model';
import { migrationScripts } from './src/migration';
import { sweepPendingBindingNotifications } from './src/binding-notification';
// Side-effect imports: register binding-path methods + export/import methods on userBindModel.
import './src/binding';
import './src/migrate-domain';

const Setting = SettingModel.Setting;

export * from './src/exam-roster-source';
export { userBindModel } from './src/model';
export * from './src/types';

export function apply(ctx: Context) {
    // Expose the model on `global.Hydro.model.userbind` so cross-plugin
    // consumers (krypton-vigilguard scope checks, hydrooj record/domain
    // handlers showing the admin-only 学号/姓名 column) can reach it via
    // the same dot path other models use (`Hydro.model.user`, etc.).
    //
    // The hydrooj addon loader does NOT do this automatically — see
    // packages/hydrooj/src/init.ts (no Proxy on `model`) — so each plugin
    // that wants to be addressable this way must assign it explicitly.
    if ((global as any).Hydro?.model) (global as any).Hydro.model.userbind = userBindModel;

    ctx.inject(['setting'], (c) => {
        c.setting.SystemSetting(
            Setting(
                'setting_userbind',
                'userbind.forceBind',
                true,
                'boolean',
                'userbind.forceBind',
                'Require default-role students to bind a student record before using the site',
            ),
        );
        // Addon SystemSetting runs after SystemModel.init, so seed cache when Mongo has no override.
        const system = global.Hydro.model.system;
        const current = system.get('userbind.forceBind');
        if (current === undefined || current === null || current === '') {
            if (!system.cache) {
                throw new Error('Hydro.model.system.cache is missing; cannot apply userbind.forceBind default');
            }
            system.cache['userbind.forceBind'] = true;
        }
    });

    // Register routes directly — `ctx.Route` is available on the apply context
    // (same pattern as packages/blog/index.ts).
    applyHandlers(ctx);
    applyLegacyRedirects(ctx);

    // Ensure collection indexes asynchronously; errors logged but non-fatal.
    ensureIndexes().catch((e) => {
        console.error('[krypton-userbind] ensureIndexes failed:', e);
    });

    if (!process.env.HYDRO_CLI) {
        const sweepNotifications = () =>
            sweepPendingBindingNotifications().catch((error) => {
                console.error('[krypton-userbind] binding notification sweep failed:', error);
            });
        ctx.on('app/started', sweepNotifications);
        ctx.effect(() => ctx.setInterval(sweepNotifications, 60_000));
    }

    // Register migration channel — independent version number from hydrooj core.
    ctx.inject(['migration'], (c) => {
        c.migration.registerChannel('userbind', migrationScripts);
    });

    registerCommands(ctx);
}
