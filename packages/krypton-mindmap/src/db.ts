import { Logger } from '@hydrooj/utils';
import yaml from 'js-yaml';
import { db, ObjectId, SystemModel } from 'hydrooj';
import type { KnowledgeMapDoc, MindmapNode } from './types';

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

/**
 * Parse the hydrooj `problem.categories` system setting (yaml-encoded
 * `{ category: [tag1, tag2, ...] }`) into a `Map<categoryName, subtags[]>`.
 * Empty / unparseable values yield an empty map and the caller decides
 * whether to fall back to a hardcoded default.
 */
function readProblemCategories(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    let raw: any = SystemModel.get('problem.categories');
    if (!raw) return out;
    if (typeof raw === 'string') {
        try {
            raw = yaml.load(raw);
        } catch (e) {
            logger.warn('failed to parse problem.categories yaml: %s', (e as Error).message);
            return out;
        }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [cat, subs] of Object.entries(raw as Record<string, unknown>)) {
        const name = String(cat).trim();
        if (!name) continue;
        if (Array.isArray(subs)) {
            const leaves = subs.filter((s): s is string => typeof s === 'string' && !!s.trim()).map((s) => s.trim());
            out.set(name, leaves);
        } else {
            // Category with no subtags (e.g. `贪心: []` or `贪心:` in yaml).
            out.set(name, []);
        }
    }
    return out;
}

/**
 * Hardcoded fallback — preserved for the case where `problem.categories`
 * isn't set yet (typically a fresh hydrooj install before any admin tuning).
 * Once the admin configures `problem.categories`, that wins.
 */
function fallbackCategories(): Map<string, string[]> {
    return new Map<string, string[]>([
        ['语法入门', []],
        ['基础算法', ['二分', '前缀和', '差分', '双指针', '贪心', '排序', '搜索', '递归']],
        ['数据结构', ['栈', '队列', '链表', '堆', '并查集', '哈希', '线段树', '树状数组', '字典树']],
        ['图论', ['最短路', '最小生成树', '拓扑排序', '强连通分量', '二分图']],
        ['字符串', ['KMP', 'AC自动机', '后缀数组', '字符串哈希', 'Manacher']],
        ['动态规划', ['线性 DP', '区间 DP', '背包', '树形 DP', '状压 DP', '数位 DP']],
        ['数学', ['数论', '组合数学', '概率期望', '快速幂', '矩阵', 'FFT']],
        ['计算几何', []],
        ['杂项', []],
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

async function buildTreeFromCategories(cats: Map<string, string[]>): Promise<ObjectId> {
    const now = new Date();
    const mapId = new ObjectId();
    const mk = (parentId: any, topic: string, order: number, tags: string[] = []) =>
        ({
            _id: new ObjectId(),
            mapId,
            parentId,
            topic,
            tags,
            problemIds: [],
            order,
            createdAt: now,
            updatedAt: now,
        }) as MindmapNode;

    const root = mk(null, '算法', 0);
    const all: MindmapNode[] = [root];
    let catOrder = 1;
    for (const [cat, leaves] of cats.entries()) {
        const catNode = mk(root._id, cat, catOrder++, [cat]);
        all.push(catNode);
        let leafOrder = 1;
        for (const leaf of leaves) {
            all.push(mk(catNode._id, leaf, leafOrder++, [leaf]));
        }
    }

    const map: KnowledgeMapDoc = {
        _id: mapId,
        title: '算法知识图谱',
        rootNodeId: root._id,
        visibility: 'public',
        layoutDirection: 'RIGHT',
        createdAt: now,
        updatedAt: now,
    };
    await insertMapWithRoot(map, root);
    try {
        if (all.length > 1) await nodesColl.insertMany(all.slice(1));
    } catch (error) {
        await rollbackMapCreation(mapId, error, 'seed');
    }
    return root._id;
}

/**
 * Seed the default tree only when the collection is empty.
 * Reads categories from the hydrooj `problem.categories` setting (yaml),
 * falling back to a hardcoded structure if that setting is absent.
 */
export async function seedDefaultMapIfEmpty(): Promise<void> {
    const [nodeCount, mapCount] = await Promise.all([nodesColl.estimatedDocumentCount(), mapsColl.estimatedDocumentCount()]);
    if (nodeCount > 0 || mapCount > 0) {
        if (nodeCount === 0 || mapCount === 0) {
            throw new Error(`mindmap collections disagree nodes=${nodeCount} maps=${mapCount}; explicit migration is required`);
        }
        return;
    }

    const cats = readProblemCategories();
    if (cats.size === 0) {
        logger.info('problem.categories setting empty/unparseable — using hardcoded fallback');
    } else {
        logger.info('seeding mindmap from problem.categories (%d categories)', cats.size);
    }
    await buildTreeFromCategories(cats.size > 0 ? cats : fallbackCategories());
}
