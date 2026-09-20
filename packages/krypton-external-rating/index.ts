/**
 * @hydrooj/krypton-external-rating — Codeforces / Nowcoder rating snapshots.
 *
 * Loaded as a built-in addon. See packages/hydrooj/src/loader.ts:BUILTIN_ADDONS.
 */
import type { Context } from 'hydrooj';
import { ensureIndexes } from './src/db';
import { applyHandlers } from './src/handler';
import { EXTERNAL_RATING_ACCOUNT_SETTINGS } from './src/settings';

export { ensureIndexes, historyColl, type ExternalRatingHistoryDoc } from './src/db';
export * from './src/types';

export async function apply(ctx: Context) {
    await ensureIndexes();
    ctx.inject(['setting'], (c) => {
        c.setting.AccountSetting(...EXTERNAL_RATING_ACCOUNT_SETTINGS);
    });
    applyHandlers(ctx);
}
