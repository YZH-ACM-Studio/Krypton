import { ObjectId, db } from 'hydrooj';
import { configColl, getConfig, nodesColl, setConfig } from './db';
import type { MindmapNode } from './types';

const documentColl = db.collection<any>('document');

/* ─── tree access ─── */

export async function listAllNodes(): Promise<MindmapNode[]> {
    return await nodesColl.find({}).sort({ parentId: 1, order: 1 }).toArray();
}

export async function getNode(id: ObjectId | string): Promise<MindmapNode | null> {
    const _id = typeof id === 'string' ? new ObjectId(id) : id;
    return await nodesColl.findOne({ _id });
}

export async function createNode(input: {
    parentId: ObjectId | string;
    topic: string;
    tags?: string[];
    problemIds?: string[];
    description?: string;
    color?: string;
}): Promise<MindmapNode> {
    const pid = typeof input.parentId === 'string' ? new ObjectId(input.parentId) : input.parentId;
    // append-at-end ordering: max-order + 1 among siblings.
    const last = await nodesColl.find({ parentId: pid })
        .sort({ order: -1 }).limit(1).toArray();
    const order = (last[0]?.order || 0) + 10;
    const doc: MindmapNode = {
        _id: new ObjectId(),
        parentId: pid,
        topic: input.topic.trim(),
        description: input.description,
        color: input.color,
        tags: input.tags || [],
        problemIds: input.problemIds || [],
        order,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    await nodesColl.insertOne(doc);
    return doc;
}

export async function updateNode(
    id: ObjectId | string,
    patch: Partial<Omit<MindmapNode, '_id' | 'createdAt' | 'parentId'>>,
): Promise<void> {
    const _id = typeof id === 'string' ? new ObjectId(id) : id;
    await nodesColl.updateOne({ _id }, { $set: { ...patch, updatedAt: new Date() } });
}

export async function moveNode(
    id: ObjectId | string,
    newParentId: ObjectId | string,
    newOrder?: number,
): Promise<void> {
    const _id = typeof id === 'string' ? new ObjectId(id) : id;
    const pid = typeof newParentId === 'string' ? new ObjectId(newParentId) : newParentId;
    const order = newOrder ?? ((await nodesColl.find({ parentId: pid }).sort({ order: -1 }).limit(1).toArray())[0]?.order || 0) + 10;
    await nodesColl.updateOne({ _id }, { $set: { parentId: pid, order, updatedAt: new Date() } });
}

/**
 * Delete a node and all its descendants recursively.
 * Returns the number of removed nodes.
 */
export async function deleteNodeRecursive(id: ObjectId | string): Promise<number> {
    const _id = typeof id === 'string' ? new ObjectId(id) : id;
    const removedIds: ObjectId[] = [];
    const queue: ObjectId[] = [_id];
    while (queue.length) {
        const cur = queue.shift()!;
        const children = await nodesColl.find({ parentId: cur }).project({ _id: 1 }).toArray();
        queue.push(...children.map((c) => c._id as ObjectId));
        removedIds.push(cur);
    }
    if (!removedIds.length) return 0;
    const res = await nodesColl.deleteMany({ _id: { $in: removedIds } });
    return res.deletedCount || 0;
}

/* ─── layout overrides ─── */

export async function clearAllPositions(): Promise<void> {
    await nodesColl.updateMany({ position: { $exists: true } }, { $unset: { position: '' } });
}

export async function setNodePosition(id: ObjectId | string, position: { x: number; y: number } | null): Promise<void> {
    const _id = typeof id === 'string' ? new ObjectId(id) : id;
    if (position) {
        await nodesColl.updateOne({ _id }, { $set: { position, updatedAt: new Date() } });
    } else {
        await nodesColl.updateOne({ _id }, { $unset: { position: '' } });
    }
}

/* ─── problem panel ─── */

const HYDRO_PROBLEM_DOCTYPE = 10;

export interface PanelProblem {
    pid: string;
    title: string;
    nSubmit: number;
    nAccept: number;
    /** Heuristic difficulty 1-6 derived from acceptance rate. */
    difficulty: number;
}

function difficultyOf(p: { nSubmit?: number; nAccept?: number }): number {
    if (!p.nSubmit || p.nSubmit < 5) return 3;
    const rate = (p.nAccept || 0) / p.nSubmit;
    if (rate > 0.8) return 1;
    if (rate > 0.6) return 2;
    if (rate > 0.4) return 3;
    if (rate > 0.25) return 4;
    if (rate > 0.1) return 5;
    return 6;
}

export async function listProblemsForNode(
    domainId: string, nodeId: ObjectId | string,
): Promise<PanelProblem[]> {
    const node = await getNode(nodeId);
    if (!node) return [];
    const filter: Record<string, unknown> = { docType: HYDRO_PROBLEM_DOCTYPE, domainId, hidden: { $ne: true } };
    const orClauses: any[] = [];
    if (node.tags && node.tags.length) orClauses.push({ tag: { $in: node.tags } });
    if (node.problemIds && node.problemIds.length) {
        orClauses.push({ pid: { $in: node.problemIds } });
        // Also accept numeric pids (Hydro stores both)
        const numericIds = node.problemIds.map((p) => Number(p)).filter((n) => Number.isFinite(n));
        if (numericIds.length) orClauses.push({ docId: { $in: numericIds } });
    }
    if (!orClauses.length) return [];
    Object.assign(filter, { $or: orClauses });
    const docs = await documentColl.find(filter)
        .project({ pid: 1, docId: 1, title: 1, nSubmit: 1, nAccept: 1 })
        .limit(500)
        .toArray();
    return docs.map((d: any) => ({
        pid: d.pid || String(d.docId),
        title: d.title || '(无标题)',
        nSubmit: d.nSubmit || 0,
        nAccept: d.nAccept || 0,
        difficulty: difficultyOf(d),
    }));
}

export { getConfig, setConfig };
