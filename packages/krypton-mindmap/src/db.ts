import { Logger } from '@hydrooj/utils';
import yaml from 'js-yaml';
import { db, ObjectId, SystemModel } from 'hydrooj';
import type { MindmapConfig, MindmapNode } from './types';

const logger = new Logger('mindmap.seed');

export const nodesColl = db.collection<MindmapNode>('mindmap.nodes');
export const configColl = db.collection<MindmapConfig>('mindmap.config');

let indexesEnsured = false;

export async function ensureIndexes(): Promise<void> {
    if (indexesEnsured) return;
    indexesEnsured = true;
    await Promise.all([
        nodesColl.createIndex({ parentId: 1, order: 1 }),
        nodesColl.createIndex({ tags: 1 }),
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
        try { raw = yaml.load(raw); } catch (e) {
            logger.warn('failed to parse problem.categories yaml: %s', (e as Error).message);
            return out;
        }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [cat, subs] of Object.entries(raw as Record<string, unknown>)) {
        const name = String(cat).trim();
        if (!name) continue;
        if (Array.isArray(subs)) {
            const leaves = subs
                .filter((s): s is string => typeof s === 'string' && !!s.trim())
                .map((s) => s.trim());
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

/** Internal: build & insert a fresh tree from the given category map. */
async function buildTreeFromCategories(cats: Map<string, string[]>): Promise<ObjectId> {
    const now = new Date();
    const mk = (parentId: any, topic: string, order: number, tags: string[] = []) => ({
        _id: new ObjectId(),
        parentId,
        topic,
        tags,
        problemIds: [],
        order,
        createdAt: now,
        updatedAt: now,
    } as MindmapNode);

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

    await nodesColl.insertMany(all);
    await configColl.updateOne(
        { _id: 'global' as const },
        {
            $set: {
                title: '算法知识图谱',
                rootNodeId: root._id,
                layoutDirection: 'RIGHT' as const,
                updatedAt: now,
            },
            $setOnInsert: { _id: 'global' as const },
        },
        { upsert: true },
    );
    return root._id;
}

/**
 * Seed the default tree only when the collection is empty.
 * Reads categories from the hydrooj `problem.categories` setting (yaml),
 * falling back to a hardcoded structure if that setting is absent.
 */
export async function seedDefaultTreeIfEmpty(): Promise<void> {
    const count = await nodesColl.estimatedDocumentCount();
    if (count > 0) return;

    const cats = readProblemCategories();
    if (cats.size === 0) {
        logger.info('problem.categories setting empty/unparseable — using hardcoded fallback');
    } else {
        logger.info('seeding mindmap from problem.categories (%d categories)', cats.size);
    }
    await buildTreeFromCategories(cats.size > 0 ? cats : fallbackCategories());
}

/**
 * Drop all existing mindmap nodes and rebuild the tree from the current
 * `problem.categories` setting. Destructive — any admin-edited
 * `problemIds`/tags/topics on existing nodes are lost. Intended for admin
 * re-sync after editing `problem.categories` in the hydrooj admin UI.
 */
export async function rebuildFromCategories(): Promise<{ categories: number; leaves: number }> {
    const cats = readProblemCategories();
    if (cats.size === 0) {
        throw new Error('problem.categories is empty or unparseable; refusing to rebuild');
    }
    await nodesColl.deleteMany({});
    await buildTreeFromCategories(cats);
    let leaves = 0;
    for (const ls of cats.values()) leaves += ls.length;
    logger.info('mindmap rebuilt from problem.categories: %d categories, %d leaves',
        cats.size, leaves);
    return { categories: cats.size, leaves };
}

export async function getConfig(): Promise<MindmapConfig> {
    await seedDefaultTreeIfEmpty();
    const doc = await configColl.findOne({ _id: 'global' });
    if (!doc) {
        return {
            _id: 'global',
            title: '算法知识图谱',
            rootNodeId: null,
            layoutDirection: 'RIGHT',
            updatedAt: new Date(),
        };
    }
    return doc;
}

export async function setConfig(patch: Partial<Omit<MindmapConfig, '_id'>>): Promise<void> {
    await configColl.updateOne(
        { _id: 'global' as const },
        {
            $set: { ...patch, updatedAt: new Date() },
            $setOnInsert: { _id: 'global' as const },
        },
        { upsert: true },
    );
}
