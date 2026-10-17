import { ObjectId } from 'hydrooj';
import { mapsColl, nodesColl } from './db';
import type { KnowledgeMapDoc, MindmapNode } from './types';

export interface TeachKnowledgeSourceNode {
    id: string;
    parentId: string | null;
    title: string;
    order: number;
    pinnedDocIds: number[];
}

export interface TeachKnowledgeSource {
    /** This period each map is one course. The id is the map `_id` hex. */
    courseId: string;
    title: string;
    /** `visibility !== 'public'`, including course-owned hidden maps. */
    hidden: boolean;
    /** Problem `knowledgeMapId` filter. Same hex as `courseId`. */
    mapId: string;
    rootNodeId: string;
    /** Root omitted. Its direct children use `parentId: null`. Siblings are ordered by `order`, then id. */
    nodes: TeachKnowledgeSourceNode[];
}

function idHex(value: unknown, label: string): string {
    if (value instanceof ObjectId) return value.toHexString();
    if (typeof value === 'string' && ObjectId.isValid(value)) return new ObjectId(value).toHexString();
    throw new TypeError(`teach knowledge ${label} is not an id`);
}

function readMapTitle(map: KnowledgeMapDoc, mapId: string): string {
    if (typeof map.title !== 'string') throw new TypeError(`teach knowledge map title is invalid map=${mapId}`);
    return map.title;
}

function positiveProblemDocId(value: unknown): number | null {
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || String(parsed) !== value) return null;
    return parsed;
}

function coursePinDocIds(node: MindmapNode, nodeId: string): number[] {
    if (node.coursePins === undefined) return [];
    if (!Array.isArray(node.coursePins)) throw new TypeError(`teach knowledge course pins are corrupt node=${nodeId}`);
    const pins: number[] = [];
    for (const pin of node.coursePins) {
        if (typeof pin !== 'number' || !Number.isSafeInteger(pin) || pin < 1) {
            throw new TypeError(`teach knowledge course pins are corrupt node=${nodeId}`);
        }
        pins.push(pin);
    }
    return pins;
}

function pinnedDocIds(node: MindmapNode, nodeId: string): number[] {
    if (!Array.isArray(node.problemIds)) throw new TypeError(`teach knowledge problem ids are corrupt node=${nodeId}`);
    const ids = new Set<number>();
    for (const value of node.problemIds) {
        const parsed = positiveProblemDocId(value);
        if (parsed !== null) ids.add(parsed);
    }
    for (const pin of coursePinDocIds(node, nodeId)) ids.add(pin);
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
    const root = byId.get(rootId);
    if (!root || root.parentId !== null) throw new Error(`teach knowledge root invariant failed map=${mapId} root=${rootId}`);

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

function toTeachKnowledgeSource(map: KnowledgeMapDoc, documents: MindmapNode[]): TeachKnowledgeSource {
    const mapId = idHex(map._id, 'map');
    const rootNodeId = idHex(map.rootNodeId, 'root');
    return {
        courseId: mapId,
        title: readMapTitle(map, mapId),
        hidden: map.visibility !== 'public',
        mapId,
        rootNodeId,
        nodes: teachNodes(mapId, rootNodeId, documents),
    };
}

function compareSources(left: TeachKnowledgeSource, right: TeachKnowledgeSource): number {
    if (left.title !== right.title) return left.title < right.title ? -1 : 1;
    if (left.mapId === right.mapId) return 0;
    return left.mapId < right.mapId ? -1 : 1;
}

/** Every map, including hidden and course-owned maps, is one teach course for this period. */
export async function listTeachKnowledgeSources(): Promise<TeachKnowledgeSource[]> {
    const maps = await mapsColl.find({}).sort({ title: 1, _id: 1 }).toArray();
    const sources: TeachKnowledgeSource[] = [];
    for (const map of maps) {
        const documents = await nodesColl.find({ mapId: map._id }).toArray();
        sources.push(toTeachKnowledgeSource(map, documents));
    }
    sources.sort(compareSources);
    return sources;
}
