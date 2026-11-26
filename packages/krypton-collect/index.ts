/**
 * @hydrooj/krypton-collect — teacher file collection.
 *
 * Loaded as a built-in addon. See packages/hydrooj/src/loader.ts:BUILTIN_ADDONS.
 */
import type { Context } from 'hydrooj';
import { ensureIndexes } from './src/db';
import { applyHandlers } from './src/handler';
import { migrationScripts } from './src/migration';
import { getSigningBindingContext } from './src/model';
import { applySigningHandlers } from './src/signing-handler';

export { canCreateCollect, canEditCollect, canViewCollect } from './src/auth';
export { existsByCourse, existsRequiringCourseExam, listByCourse, listByCourseChapter } from './src/course-query';
export {
    COLLECT_DEFAULT_FILE_NAME_TEMPLATE,
    COLLECT_DEFAULT_PACK_LAYOUT,
    COLLECT_NAME_TOKENS,
} from './src/name-format';
export * from './src/types';

export async function apply(ctx: Context) {
    await ensureIndexes();
    global.Hydro.model.collect = { getSigningBindingContext };
    applyHandlers(ctx);
    applySigningHandlers(ctx);
    ctx.inject(['migration'], (c) => {
        c.migration.registerChannel('collect', migrationScripts);
    });
}
