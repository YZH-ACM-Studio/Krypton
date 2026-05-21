/**
 * @hydrooj/krypton-tasks — training-task system for contest eligibility.
 *
 * Loaded as a built-in addon. See packages/hydrooj/src/loader.ts:BUILTIN_ADDONS.
 *
 * Surface:
 *   - User pages:    /tasks, /tasks/my, /tasks/:tid
 *   - Admin pages:   /admin/tasks (list, edit, assign, stats), /admin/tasks/scores,
 *                    /admin/tasks/settings
 *   - Domain perms:  PERM_VIEW_TASKS, PERM_CREATE_TASK, PERM_MANAGE_TASKS
 *
 * Required dependency: @hydrooj/krypton-userbind (for school/group lookups)
 */
import type { Context } from 'hydrooj';
import { registerCommands } from './src/cli';
import { ensureIndexes } from './src/db';
import { applyHandlers } from './src/handler';
import { attachHooks } from './src/hooks';
import { i18n_en, i18n_zh } from './src/i18n';
import { migrationScripts } from './src/migration';
import { taskModel } from './src/model';

export * from './src/types';
export { taskModel } from './src/model';
export { taskPointPresets, presetSummaries, runChecker } from './src/presets';
export { canCreateTask, canManageAllTasks, canModifyTask } from './src/auth';

export function apply(ctx: Context) {
    applyHandlers(ctx);
    attachHooks(ctx);

    ensureIndexes().catch((e) => {
        console.error('[krypton-tasks] ensureIndexes failed:', e);
    });

    ctx.inject(['migration'], (c) => {
        c.migration.registerChannel('tasks', migrationScripts);
    });

    ctx.i18n.load('zh', i18n_zh);
    ctx.i18n.load('en', i18n_en);

    registerCommands(ctx);

    // Side-effect: expose model on global Hydro.model.tasks for cli access.
    if (global.Hydro?.model) (global.Hydro.model as any).tasks = taskModel;
}
