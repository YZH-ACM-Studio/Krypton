/**
 * @hydrooj/krypton-announcement — announcement system with categories,
 * pin / hide / schedule / sort, and homepage integration.
 *
 * Loaded as a built-in addon — see packages/hydrooj/src/loader.ts.
 */
import { Context } from 'hydrooj';
import { ensureIndexes, seedCategoriesIfEmpty } from './src/db';
import { applyHandlers } from './src/handler';
import { migrationScripts } from './src/migration';

export * from './src/types';
export {
    listAnnouncements,
    listForHomepage,
    listCategories,
    listUnreadForUser,
    countUnreadForUser,
} from './src/model';

export function apply(ctx: Context) {
    applyHandlers(ctx);

    ensureIndexes().catch((e) => {
        console.error('[krypton-announcement] ensureIndexes failed:', e);
    });
    seedCategoriesIfEmpty().catch((e) => {
        console.error('[krypton-announcement] seedCategoriesIfEmpty failed:', e);
    });

    ctx.inject(['migration'], (c) => {
        c.migration.registerChannel('announcement', migrationScripts);
    });
}
