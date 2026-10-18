import { Logger } from '@hydrooj/utils';
import { db, localizedErrorText, ObjectId, PRIV, PrivilegeError } from 'hydrooj';
import { getMergedMap } from './db';
import { MindmapConflictError, MindmapRequestError } from './error';

export { getMergedMap };

const logger = new Logger('krypton-mindmap.course-nodes');
const NOT_MERGED = localizedErrorText`知识图谱尚未合并，请先运行 mindmap:merge-courses`;
const MAX_OWNER_UIDS = 50;

export class MindmapNotMergedError extends MindmapRequestError {
    name = 'MindmapNotMergedError';

    constructor() {
        super(NOT_MERGED);
    }
}

export interface CourseNodeView {
    id: string;
    title: string;
    order: number;
    visibility: 'public' | 'hidden';
    ownerUids: number[];
}

export interface MindmapActor {
    _id: number;
    hasPriv(...privileges: number[]): boolean;
}

interface RawNode {
    _id: ObjectId;
    mapId: ObjectId;
    parentId: ObjectId | null;
    topic: string;
    order: number;
    updatedAt?: Date;
    courseVisibility?: 'public' | 'hidden';
    ownerUids?: number[];
    coursePins?: unknown;
}

interface CourseNodeSettings {
    actor: MindmapActor;
    nodeId: string;
    expectedUpdatedAt: Date;
    visibility: 'public' | 'hidden';
    ownerUids: number[];
}

function nodesColl() {
    return db.collection<RawNode>('mindmap.nodes');
}

function sameId(left: ObjectId | null | undefined, right: ObjectId | null | undefined): boolean {
    if (!left || !right) return false;
    return left.equals(right);
}

function parseNodeId(value: ObjectId | string): ObjectId {
    if (value instanceof ObjectId) return value;
    if (typeof value !== 'string' || !ObjectId.isValid(value)) throw new MindmapRequestError(localizedErrorText`节点编号无效`);
    return new ObjectId(value);
}

function canonicalOwnerUids(values: unknown): number[] {
    if (!Array.isArray(values)) throw new MindmapRequestError(localizedErrorText`负责教师必须是数组`);
    const seen = new Set<number>();
    const owners: number[] = [];
    for (const value of values) {
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
            throw new MindmapRequestError(localizedErrorText`负责教师必须是正整数`);
        }
        if (seen.has(value)) continue;
        seen.add(value);
        owners.push(value);
    }
    if (owners.length > MAX_OWNER_UIDS) throw new MindmapRequestError(localizedErrorText`负责教师最多 50 人`);
    owners.sort((left, right) => left - right);
    return owners;
}

function assertVisibility(value: unknown): 'public' | 'hidden' {
    if (value !== 'public' && value !== 'hidden') throw new MindmapRequestError(localizedErrorText`课程公开状态无效`);
    return value;
}

function toCourseView(node: RawNode): CourseNodeView {
    if (node.courseVisibility !== 'public' && node.courseVisibility !== 'hidden') {
        throw new MindmapRequestError(localizedErrorText`课程节点缺少公开状态或负责教师`);
    }
    if (!Array.isArray(node.ownerUids) || node.ownerUids.some((uid) => typeof uid !== 'number')) {
        throw new MindmapRequestError(localizedErrorText`课程节点缺少公开状态或负责教师`);
    }
    return {
        id: node._id.toHexString(),
        title: node.topic,
        order: node.order,
        visibility: node.courseVisibility,
        ownerUids: [...node.ownerUids],
    };
}

export async function listCourseNodes(): Promise<CourseNodeView[]> {
    const map = await getMergedMap();
    const nodes = await nodesColl().find({ mapId: map._id, parentId: map.rootNodeId }).sort({ order: 1, _id: 1 }).toArray();
    return nodes.map((node) => toCourseView(node));
}

/** The course node that is `nodeId` or one of its ancestors. The merged root has none. */
export async function courseNodeOf(nodeId: ObjectId | string): Promise<CourseNodeView | null> {
    const map = await getMergedMap();
    const id = parseNodeId(nodeId);
    if (id.equals(map.rootNodeId)) return null;
    const nodes = await nodesColl().find({ mapId: map._id }).toArray();
    const byId = new Map(nodes.map((node) => [node._id.toHexString(), node]));
    let current = byId.get(id.toHexString());
    if (!current) throw new MindmapRequestError(localizedErrorText`导图节点不存在`);
    const seen = new Set<string>();
    while (current.parentId) {
        const currentId = current._id.toHexString();
        if (seen.has(currentId)) throw new MindmapRequestError(localizedErrorText`知识图谱节点形成了环`);
        seen.add(currentId);
        if (sameId(current.parentId, map.rootNodeId)) return toCourseView(current);
        const parent = byId.get(current.parentId.toHexString());
        if (!parent) throw new MindmapRequestError(localizedErrorText`知识图谱节点缺少父节点`);
        current = parent;
    }
    if (sameId(current._id, map.rootNodeId)) return null;
    throw new MindmapRequestError(localizedErrorText`知识图谱节点不在总根下面`);
}

export function canEditCourseSubtree(actor: MindmapActor, course: CourseNodeView): boolean {
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || course.ownerUids.includes(actor._id);
}

export function canSeeCourseNode(actor: MindmapActor | null, course: CourseNodeView): boolean {
    if (course.visibility === 'public') return true;
    if (!actor) return false;
    return canEditCourseSubtree(actor, course);
}

export async function setCourseNodeSettings(input: CourseNodeSettings): Promise<CourseNodeView> {
    const map = await getMergedMap();
    if (!input.actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) throw new PrivilegeError(PRIV.PRIV_EDIT_SYSTEM);
    const visibility = assertVisibility(input.visibility);
    const ownerUids = canonicalOwnerUids(input.ownerUids);
    if (!(input.expectedUpdatedAt instanceof Date) || Number.isNaN(input.expectedUpdatedAt.getTime())) {
        throw new MindmapRequestError(localizedErrorText`节点版本无效`);
    }
    const nodeId = parseNodeId(input.nodeId);
    const now = new Date(Math.max(Date.now(), input.expectedUpdatedAt.getTime() + 1));
    const updated = await nodesColl().findOneAndUpdate(
        { _id: nodeId, mapId: map._id, parentId: map.rootNodeId, updatedAt: input.expectedUpdatedAt },
        { $set: { courseVisibility: visibility, ownerUids, updatedAt: now } },
        { returnDocument: 'after' },
    );
    if (!updated) {
        const existing = await nodesColl().findOne({ _id: nodeId });
        if (!existing || !sameId(existing.mapId, map._id)) throw new MindmapRequestError(localizedErrorText`导图节点不存在`);
        if (!sameId(existing.parentId, map.rootNodeId)) throw new MindmapRequestError(localizedErrorText`只能修改课程节点`);
        throw new MindmapConflictError(localizedErrorText`课程节点已被其他操作修改，请刷新后重试`);
    }
    logger.info(
        'Mindmap course node settings domain=- actor=%d node=%s visibility=%s owners=%d result=success',
        input.actor._id,
        nodeId.toHexString(),
        visibility,
        ownerUids.length,
    );
    return toCourseView(updated);
}
