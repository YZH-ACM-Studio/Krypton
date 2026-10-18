import { ObjectId } from 'hydrooj';
import { getMergedMap, nodesColl } from './db';
import type { MindmapNode } from './types';

export interface TeachKnowledgeSourceNode {
    id: string;
    parentId: string | null;
    title: string;
    order: number;
    pinnedDocIds: number[];
}

export interface TeachKnowledgeSource {
    /** Course node id. */
    courseId: string;
    title: string;
    /** `courseVisibility === 'hidden'`. */
    hidden: boolean;
    /** Merged knowledge map id. */
    mapId: string;
    /** Course node id. Its direct children use `parentId: null`. Siblings are ordered by `order`, then id. */
    rootNodeId: string;
    /** Course node omitted. */
    nodes: TeachKnowledgeSourceNode[];
}

function idHex(value: unknown, label: string): string {
    if (value instanceof ObjectId) return value.toHexString();
    if (typeof value === 'string' && ObjectId.isValid(value)) return new ObjectId(value).toHexString();
    throw new TypeError(`teach knowledge ${label} is not an id`);
}

function positiveProblemDocId(value: unknown): number | null {
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || String(parsed) !== value) return null;
    return parsed;
}

function pinnedDocIds(node: MindmapNode, nodeId: string): number[] {
    if (!Array.isArray(node.problemIds)) throw new TypeError(`teach knowledge problem ids are corrupt node=${nodeId}`);
    const ids = new Set<number>();
    for (const value of node.problemIds) {
        const parsed = positiveProblemDocId(value);
        if (parsed !== null) ids.add(parsed);
    }
    return [...ids].sort((left, right) => left - right);
}

function nodeOrder(node: MindmapNode, nodeId: string): number {
    if (typeof node.order !== 'number' || !Number.isFinite(node.order)) {
        throw new TypeError(`teach knowledge node order is invalid node=${nodeId}`);
    }
    return node.order;
}

function nodeTitle(node: MindmapNode, nodeId: string): string {
    if (typeof node.topic !== 'string') throw new TypeError(`teach knowledge node title is invalid node=${nodeId}`);
    return node.topic;
}

function courseHidden(node: MindmapNode, nodeId: string): boolean {
    if (node.courseVisibility === 'hidden') return true;
    if (node.courseVisibility === 'public') return false;
    throw new TypeError(`teach knowledge course visibility is invalid node=${nodeId}`);
}

function compareSourceNodes(left: TeachKnowledgeSourceNode, right: TeachKnowledgeSourceNode): number {
    if (left.parentId !== right.parentId) {
        if (left.parentId === null) return -1;
        if (right.parentId === null) return 1;
        return left.parentId < right.parentId ? -1 : 1;
    }
    if (left.order !== right.order) return left.order < right.order ? -1 : 1;
    if (left.id === right.id) return 0;
    return left.id < right.id ? -1 : 1;
}

function teachNodes(mapId: string, rootId: string, documents: MindmapNode[]): TeachKnowledgeSourceNode[] {
    const byId = new Map<string, MindmapNode>();
    for (const node of documents) {
        const id = idHex(node._id, 'node');
        if (byId.has(id)) throw new Error(`teach knowledge duplicate node map=${mapId} node=${id}`);
        if (idHex(node.mapId, 'node map') !== mapId) throw new Error(`teach knowledge node belongs to another map map=${mapId} node=${id}`);
        byId.set(id, node);
    }
    if (!byId.has(rootId)) throw new Error(`teach knowledge root invariant failed map=${mapId} root=${rootId}`);

    const children = new Map<string, string[]>();
    for (const [id, node] of byId) {
        if (id === rootId) continue;
        if (node.parentId === null) throw new Error(`teach knowledge extra root map=${mapId} node=${id}`);
        const parentId = idHex(node.parentId, 'parent');
        if (!byId.has(parentId)) throw new Error(`teach knowledge parent missing map=${mapId} node=${id} parent=${parentId}`);
        const siblings = children.get(parentId) ?? [];
        siblings.push(id);
        children.set(parentId, siblings);
    }

    const seen = new Set<string>([rootId]);
    const stack = [rootId];
    while (stack.length > 0) {
        const current = stack.pop();
        if (current === undefined) break;
        for (const child of children.get(current) ?? []) {
            if (seen.has(child)) throw new Error(`teach knowledge cycle map=${mapId} node=${child}`);
            seen.add(child);
            stack.push(child);
        }
    }
    if (seen.size !== byId.size) {
        throw new Error(`teach knowledge unreachable nodes map=${mapId} reachable=${seen.size} total=${byId.size}`);
    }

    const nodes: TeachKnowledgeSourceNode[] = [];
    for (const [id, node] of byId) {
        if (id === rootId) continue;
        const parentId = idHex(node.parentId, 'parent');
        nodes.push({
            id,
            parentId: parentId === rootId ? null : parentId,
            title: nodeTitle(node, id),
            order: nodeOrder(node, id),
            pinnedDocIds: pinnedDocIds(node, id),
        });
    }
    nodes.sort(compareSourceNodes);
    return nodes;
}

function indexMergedNodes(mapId: string, rootId: string, documents: MindmapNode[]): Map<string, MindmapNode> {
    const byId = new Map<string, MindmapNode>();
    for (const node of documents) {
        const id = idHex(node._id, 'node');
        if (byId.has(id)) throw new Error(`teach knowledge duplicate node map=${mapId} node=${id}`);
        if (idHex(node.mapId, 'node map') !== mapId) throw new Error(`teach knowledge node belongs to another map map=${mapId} node=${id}`);
        byId.set(id, node);
    }
    const root = byId.get(rootId);
    if (!root || root.parentId !== null) throw new Error(`teach knowledge root invariant failed map=${mapId} root=${rootId}`);
    for (const [id, node] of byId) {
        if (id === rootId) continue;
        if (node.parentId === null) throw new Error(`teach knowledge extra root map=${mapId} node=${id}`);
        const parentId = idHex(node.parentId, 'parent');
        if (!byId.has(parentId)) throw new Error(`teach knowledge parent missing map=${mapId} node=${id} parent=${parentId}`);
    }
    return byId;
}

function childIds(byId: Map<string, MindmapNode>, parentId: string): string[] {
    const ids: string[] = [];
    for (const [id, node] of byId) {
        if (node.parentId !== null && idHex(node.parentId, 'parent') === parentId) ids.push(id);
    }
    return ids;
}

function subtreeDocuments(byId: Map<string, MindmapNode>, rootId: string, mapId: string): MindmapNode[] {
    const children = new Map<string, string[]>();
    for (const id of byId.keys()) {
        const node = byId.get(id);
        if (!node?.parentId) continue;
        const parentId = idHex(node.parentId, 'parent');
        const siblings = children.get(parentId) ?? [];
        siblings.push(id);
        children.set(parentId, siblings);
    }
    const documents: MindmapNode[] = [];
    const seen = new Set<string>();
    const stack = [rootId];
    while (stack.length > 0) {
        const current = stack.pop();
        if (current === undefined) break;
        if (seen.has(current)) throw new Error(`teach knowledge cycle map=${mapId} node=${current}`);
        const node = byId.get(current);
        if (!node) throw new Error(`teach knowledge node missing map=${mapId} node=${current}`);
        seen.add(current);
        documents.push(node);
        for (const child of children.get(current) ?? []) stack.push(child);
    }
    return documents;
}

/** One source per course node on the merged graph. Hidden courses stay in the list. */
export async function listTeachKnowledgeSources(): Promise<TeachKnowledgeSource[]> {
    const map = await getMergedMap();
    const mapId = idHex(map._id, 'map');
    const rootId = idHex(map.rootNodeId, 'root');
    const documents = await nodesColl.find({ mapId: map._id }).toArray();
    const byId = indexMergedNodes(mapId, rootId, documents);
    const courseIds = childIds(byId, rootId).sort((left, right) => {
        const leftNode = byId.get(left);
        const rightNode = byId.get(right);
        if (!leftNode || !rightNode) return left < right ? -1 : 1;
        const order = nodeOrder(leftNode, left) - nodeOrder(rightNode, right);
        if (order !== 0) return order;
        return left < right ? -1 : 1;
    });
    const claimed = new Set<string>([rootId]);
    const sources: TeachKnowledgeSource[] = [];
    for (const courseId of courseIds) {
        const course = byId.get(courseId);
        if (!course) throw new Error(`teach knowledge course node missing map=${mapId} node=${courseId}`);
        const subtree = subtreeDocuments(byId, courseId, mapId);
        for (const node of subtree) {
            const id = idHex(node._id, 'node');
            if (claimed.has(id)) throw new Error(`teach knowledge node in two courses map=${mapId} node=${id}`);
            claimed.add(id);
        }
        sources.push({
            courseId,
            title: nodeTitle(course, courseId),
            hidden: courseHidden(course, courseId),
            mapId,
            rootNodeId: courseId,
            nodes: teachNodes(mapId, courseId, subtree),
        });
    }
    if (claimed.size !== byId.size) {
        throw new Error(`teach knowledge unreachable nodes map=${mapId} reachable=${claimed.size} total=${byId.size}`);
    }
    return sources;
}
