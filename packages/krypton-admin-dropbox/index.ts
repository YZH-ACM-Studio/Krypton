/**
 * @hydrooj/krypton-admin-dropbox — system-admin temporary file cabinet.
 *
 * Loaded as a built-in addon. See packages/hydrooj/src/loader.ts:BUILTIN_ADDONS.
 */
import type { Context } from 'hydrooj';
import { ensureIndexes } from './src/db';
import { applyHandlers } from './src/handler';

export { canUseAdminDropbox } from './src/auth';
export * from './src/types';

export async function apply(ctx: Context) {
    await ensureIndexes();
    applyHandlers(ctx);
}
