import { db, ObjectId } from 'hydrooj';
import type { MindmapConfig, MindmapNode } from './types';

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
 * Seed the default tree (matching the legacy CAUCOJXMind hardcoded structure)
 * only when the collection is empty. Returns the root node id.
 */
export async function seedDefaultTreeIfEmpty(): Promise<void> {
    const count = await nodesColl.estimatedDocumentCount();
    if (count > 0) return;

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

    // Root + the 9 categories from the legacy plugin
    const root = mk(null, '算法', 0);
    const cats = [
        '语法入门', '基础算法', '数据结构', '图论', '字符串',
        '动态规划', '数学', '计算几何', '杂项',
    ].map((name, idx) => mk(root._id, name, idx + 1, [name]));

    // A small starter set of leaves under common parents — admins can expand.
    const subs: MindmapNode[] = [];
    const findCat = (name: string) => cats.find((c) => c.topic === name)!._id;
    const seeds: Array<[string, string[]]> = [
        ['基础算法', ['二分', '前缀和', '差分', '双指针', '贪心', '排序', '搜索', '递归']],
        ['数据结构', ['栈', '队列', '链表', '堆', '并查集', '哈希', '线段树', '树状数组', '字典树']],
        ['图论', ['最短路', '最小生成树', '拓扑排序', '强连通分量', '二分图']],
        ['字符串', ['KMP', 'AC自动机', '后缀数组', '字符串哈希', 'Manacher']],
        ['动态规划', ['线性 DP', '区间 DP', '背包', '树形 DP', '状压 DP', '数位 DP']],
        ['数学', ['数论', '组合数学', '概率期望', '快速幂', '矩阵', 'FFT']],
    ];
    let order = 0;
    for (const [cat, leaves] of seeds) {
        for (const leaf of leaves) {
            subs.push(mk(findCat(cat), leaf, ++order, [leaf]));
        }
    }

    await nodesColl.insertMany([root, ...cats, ...subs]);

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
