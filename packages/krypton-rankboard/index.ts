/**
 * @hydrooj/krypton-rankboard — ranking honor board.
 *
 * Loaded as a built-in addon — see packages/hydrooj/src/loader.ts.
 */
import { Context } from 'hydrooj';
import { ensureIndexes, seedAwardTypesIfEmpty } from './src/db';
import { applyHandlers } from './src/handler';
import { migrationScripts } from './src/migration';

export * from './src/types';

export function apply(ctx: Context) {
    applyHandlers(ctx);

    ensureIndexes().catch((e) => {
        console.error('[krypton-rankboard] ensureIndexes failed:', e);
    });
    seedAwardTypesIfEmpty().catch((e) => {
        console.error('[krypton-rankboard] seedAwardTypesIfEmpty failed:', e);
    });

    ctx.inject(['migration'], (c) => {
        c.migration.registerChannel('rankboard', migrationScripts);
    });
}
