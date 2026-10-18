/**
 * @hydrooj/krypton-mindmap — algorithm knowledge tree.
 *
 * Loaded as a built-in addon — see packages/hydrooj/src/loader.ts.
 */
import { Context } from 'hydrooj';
import { canEditCourseSubtree, courseNodeOf, getMergedMap, listCourseNodes } from './src/course-nodes';
import { ensureIndexes } from './src/db';
import { applyHandlers } from './src/handler';
import { migrationScripts } from './src/migration';
import { getPublicKnowledgeMap, getPublicKnowledgeMapSnapshot, listKnowledgeMaps, materialize } from './src/model';
import { listTeachKnowledgeSources } from './src/teach-sources';

export * from './src/types';
export { materialize };

export const mindmapModel = {
    getPublicMap: getPublicKnowledgeMap,
    getPublicSnapshot: getPublicKnowledgeMapSnapshot,
    listPublicMaps: () => listKnowledgeMaps(false),
    materialize,
    listCourseNodes,
    courseNodeOf,
    canEditCourseSubtree,
    getMergedMap,
    listTeachKnowledgeSources,
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
