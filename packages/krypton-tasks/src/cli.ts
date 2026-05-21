/**
 * CLI commands for krypton-tasks. Currently a stub — exposes recompute
 * commands so an operator can refresh all pending assignments after
 * bulk score imports or schema migrations.
 */
import type { Context } from 'hydrooj';
import { assignmentsColl } from './db';
import { taskModel } from './model';

export function registerCommands(_ctx: Context) {
    if (!global.Hydro?.script) return;

    global.Hydro.script.tasks_recompute_all = {
        description: 'krypton-tasks: recompute progress for all pending assignments',
        async run({ report }: any) {
            const pending = await assignmentsColl.find({ status: 'pending' }).toArray();
            let ok = 0;
            let failed = 0;
            for (const a of pending) {
                try {
                    await taskModel.checkTaskCompletion(a.domainId, a._id, { force: true });
                    ok++;
                } catch (e) {
                    failed++;
                    if (report) report({ message: `failed assignment=${a._id}: ${(e as Error)?.message}` });
                }
            }
            if (report) report({ message: `recomputed ${ok} ok, ${failed} failed` });
            return { ok, failed };
        },
        validate: {},
    };
}
