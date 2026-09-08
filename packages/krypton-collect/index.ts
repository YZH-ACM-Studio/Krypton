/**
 * @hydrooj/krypton-collect — teacher file collection.
 *
 * Loaded as a built-in addon. See packages/hydrooj/src/loader.ts:BUILTIN_ADDONS.
 */
import type { Context } from 'hydrooj';
import { ensureIndexes } from './src/db';
import { applyHandlers } from './src/handler';
import { migrationScripts } from './src/migration';

export { canCreateCollect, canEditCollect, canViewCollect } from './src/auth';
export { listByCourseChapter } from './src/course-query';
export * from './src/types';

export async function apply(ctx: Context) {
    await ensureIndexes();
    applyHandlers(ctx);
    ctx.inject(['migration'], (c) => {
        c.migration.registerChannel('collect', migrationScripts);
    });
}
