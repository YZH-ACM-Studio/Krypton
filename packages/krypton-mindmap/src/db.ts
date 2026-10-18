import Module, { createRequire } from 'node:module';
import { Logger } from '@hydrooj/utils';
import { db, ObjectId } from 'hydrooj';
import type { KnowledgeMapDoc, MindmapNode } from './types';

declare const __filename: string;

const logger = new Logger('mindmap.seed');

export const nodesColl = db.collection<MindmapNode>('mindmap.nodes');
export const mapsColl = db.collection<KnowledgeMapDoc>('mindmap.maps');

let indexesEnsured = false;

export async function ensureIndexes(): Promise<void> {
    if (indexesEnsured) return;
    indexesEnsured = true;
    await Promise.all([
        nodesColl.createIndex({ mapId: 1, parentId: 1, order: 1, _id: 1 }),
        nodesColl.createIndex({ mapId: 1, tags: 1 }),
        nodesColl.createIndex(
            { mapId: 1, parentId: 1 },
            { unique: true, partialFilterExpression: { parentId: null }, name: 'mindmap_one_root_per_map' },
        ),
        mapsColl.createIndex({ visibility: 1, title: 1, _id: 1 }),
    ]);
}

async function rollbackMapCreation(mapId: ObjectId, cause: unknown, context: string): Promise<never> {
    const rollbackErrors: unknown[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            await nodesColl.deleteMany({ mapId });
        } catch (error) {
            rollbackErrors.push(error);
        }
        try {
            await mapsColl.deleteOne({ _id: mapId });
        } catch (error) {
            rollbackErrors.push(error);
        }
        try {
            const [remainingNodes, remainingMap] = await Promise.all([
                nodesColl.countDocuments({ mapId }),
                mapsColl.findOne({ _id: mapId }, { projection: { _id: 1 } }),
            ]);
            if (remainingNodes === 0 && !remainingMap) throw cause;
            rollbackErrors.push(
                new Error(`mindmap ${context} rollback incomplete map=${mapId} remainingNodes=${remainingNodes} remainingMap=${remainingMap ? 'yes' : 'no'}`),
            );
        } catch (error) {
            if (error === cause) throw error;
            rollbackErrors.push(error);
        }
    }
    throw new AggregateError([cause, ...rollbackErrors], `mindmap ${context} left an unverified partial write map=${mapId}`);
}

/** Internal: build & insert a fresh tree from the given category map. */
export async function insertMapWithRoot(map: KnowledgeMapDoc, root: MindmapNode): Promise<void> {
    if (!root.mapId.equals(map._id) || !root._id.equals(map.rootNodeId) || root.parentId !== null) {
        throw new Error(`mindmap map/root identity mismatch map=${map._id} root=${root._id}`);
    }
    const [existingMap, existingNodes] = await Promise.all([mapsColl.findOne({ _id: map._id }), nodesColl.countDocuments({ mapId: map._id })]);
    if (existingMap || existingNodes) throw new Error(`mindmap create id collision map=${map._id} nodes=${existingNodes}`);
    try {
        await mapsColl.insertOne(map);
        await nodesColl.insertOne(root);
    } catch (error) {
        await rollbackMapCreation(map._id, error, 'create');
    }
}

async function seedMergedMap(): Promise<ObjectId> {
    const now = new Date();
    const mapId = new ObjectId();
    const rootId = new ObjectId();
    const root: MindmapNode = {
        _id: rootId,
        mapId,
        parentId: null,
        topic: '知识图谱',
        tags: [],
        problemIds: [],
        order: 0,
        createdAt: now,
        updatedAt: now,
    };
    const map: KnowledgeMapDoc = {
        _id: mapId,
        title: '知识图谱',
        rootNodeId: rootId,
        visibility: 'public',
        layoutDirection: 'RIGHT',
        createdAt: now,
        updatedAt: now,
    };
    await insertMapWithRoot(map, root);
    return rootId;
}

/** Seed the merged graph only when both collections are empty. Existing data is left untouched. */
export async function seedDefaultMapIfEmpty(): Promise<void> {
    const [nodeCount, mapCount] = await Promise.all([nodesColl.estimatedDocumentCount(), mapsColl.estimatedDocumentCount()]);
    if (nodeCount > 0 || mapCount > 0) {
        if (nodeCount === 0 || mapCount === 0) {
            throw new Error(`mindmap collections disagree nodes=${nodeCount} maps=${mapCount}; explicit migration is required`);
        }
        return;
    }
    logger.info('seeding empty mindmap as the merged knowledge graph');
    await seedMergedMap();
}

const nodeRequire = createRequire(__filename);

function throwNotMerged(): never {
    const { MindmapNotMergedError } = nodeRequire('./course-nodes') as { MindmapNotMergedError: new () => Error };
    throw new MindmapNotMergedError();
}

/** Re-check the merged-map preconditions on every call. The success path does not load course-nodes. */
export async function getMergedMap(): Promise<KnowledgeMapDoc> {
    const maps = mapsColl as typeof mapsColl & { countDocuments?: (filter?: Record<string, unknown>) => Promise<number> };
    const nodes = nodesColl as typeof nodesColl & { countDocuments: (filter: Record<string, unknown>) => Promise<number> };
    const mapCount = typeof maps.countDocuments === 'function' ? await maps.countDocuments({}) : await mapsColl.estimatedDocumentCount();
    const pinned = await nodes.countDocuments({ coursePins: { $exists: true } });
    if (mapCount !== 1 || pinned !== 0) throwNotMerged();
    const map = await mapsColl.findOne({});
    if (
        !map ||
        Object.hasOwn(map, 'isDefault') ||
        Object.hasOwn(map, 'ownerDomainId') ||
        Object.hasOwn(map, 'ownerCourseId') ||
        map.visibility !== 'public' ||
        !map.rootNodeId ||
        typeof map.title !== 'string' ||
        (map.layoutDirection !== 'RIGHT' && map.layoutDirection !== 'DOWN') ||
        !(map.createdAt instanceof Date) ||
        !(map.updatedAt instanceof Date)
    ) {
        throwNotMerged();
    }
    return map;
}

interface CourseNodeApi {
    getMergedMap: unknown;
    setCourseNodeSettings: unknown;
    listCourseNodes: unknown;
    courseNodeOf: unknown;
    canSeeCourseNode: unknown;
    canEditCourseSubtree: unknown;
}

function isMindmapModelRequest(request: string, parent: NodeModule | null | undefined): boolean {
    const normalized = request.replaceAll('\\', '/');
    if (normalized.endsWith('/krypton-mindmap/src/model.ts') || normalized.endsWith('/krypton-mindmap/src/model')) return true;
    const parentFile = parent?.filename?.replaceAll('\\', '/') ?? '';
    if (!parentFile.includes('/krypton-mindmap/')) return false;
    return normalized === './model' || normalized === './model.ts' || normalized === './src/model' || normalized === './src/model.ts';
}

// course-nodes.ts is the implementation, but a static import from this file makes db-seed load
// real hydrooj before Hydro exists, and a static import from model.ts does the same to model-access.
// Attach the exports when the mindmap model module is loaded instead.
type NodeModuleLoad = (this: unknown, request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
const moduleLoader = Module as typeof Module & { _load: NodeModuleLoad };
const previousLoad = moduleLoader._load;
moduleLoader._load = function load(this: unknown, request: string, parent: NodeModule | null | undefined, isMain: boolean) {
    const loaded = previousLoad.call(this, request, parent, isMain) as Record<string, unknown>;
    if (loaded && isMindmapModelRequest(request, parent)) {
        const api = nodeRequire('./course-nodes') as CourseNodeApi;
        loaded.listCourseNodes = api.listCourseNodes;
        loaded.courseNodeOf = api.courseNodeOf;
        loaded.canSeeCourseNode = api.canSeeCourseNode;
        loaded.canEditCourseSubtree = api.canEditCourseSubtree;
        const dbExports = nodeRequire('./db') as Record<string, unknown>;
        dbExports.getMergedMap = api.getMergedMap;
        dbExports.setCourseNodeSettings = api.setCourseNodeSettings;
    }
    return loaded;
};
