/**
 * @hydrooj/krypton-mindmap — algorithm knowledge tree.
 *
 * Loaded as a built-in addon — see packages/hydrooj/src/loader.ts.
 */
import { Context } from 'hydrooj';
import { ensureIndexes } from './src/db';
import { applyHandlers } from './src/handler';
import { migrationScripts } from './src/migration';
import {
    createCourseOwnedMap,
    createCourseOwnedNode,
    deleteCourseOwnedMap,
    deleteCourseOwnedNode,
    getCourseOwnedMap,
    getCourseOwnedSnapshot,
    getPublicKnowledgeMap,
    getPublicKnowledgeMapSnapshot,
    listKnowledgeMaps,
    materialize,
    moveCourseOwnedNode,
    updateCourseOwnedMap,
    updateCourseOwnedNode,
} from './src/model';

export * from './src/types';
export { materialize };

export const mindmapModel = {
    getPublicMap: getPublicKnowledgeMap,
    getPublicSnapshot: getPublicKnowledgeMapSnapshot,
    listPublicMaps: () => listKnowledgeMaps(false),
    materialize,
    getCourseOwnedMap,
    getCourseOwnedSnapshot,
    createCourseOwnedMap,
    updateCourseOwnedMap,
    deleteCourseOwnedMap,
    createCourseOwnedNode,
    updateCourseOwnedNode,
    moveCourseOwnedNode,
    deleteCourseOwnedNode,
};

export function apply(ctx: Context) {
    if ((global as any).Hydro?.model) (global as any).Hydro.model.mindmap = mindmapModel;
    applyHandlers(ctx);

    ensureIndexes().catch((e) => {
        console.error('[krypton-mindmap] ensureIndexes failed:', e);
    });
    ctx.inject(['migration'], (c) => {
        c.migration.registerChannel('mindmap', migrationScripts);
    });
}
