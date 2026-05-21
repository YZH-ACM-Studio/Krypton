/**
 * @hydrooj/krypton-mindmap — algorithm knowledge tree.
 *
 * Loaded as a built-in addon — see packages/hydrooj/src/loader.ts.
 */
import { Context } from 'hydrooj';
import { ensureIndexes, seedDefaultTreeIfEmpty } from './src/db';
import { applyHandlers } from './src/handler';
import { migrationScripts } from './src/migration';

export * from './src/types';

export function apply(ctx: Context) {
    applyHandlers(ctx);

    ensureIndexes().catch((e) => {
        console.error('[krypton-mindmap] ensureIndexes failed:', e);
    });
    seedDefaultTreeIfEmpty().catch((e) => {
        console.error('[krypton-mindmap] seedDefaultTreeIfEmpty failed:', e);
    });

    ctx.inject(['migration'], (c) => {
        c.migration.registerChannel('mindmap', migrationScripts);
    });
}
