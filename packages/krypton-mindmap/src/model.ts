import { Logger } from '@hydrooj/utils';
import type { Filter } from 'mongodb';
import { ObjectId, db } from 'hydrooj';
import { insertMapWithRoot, mapsColl, nodesColl } from './db';
import { MindmapConflictError, MindmapRequestError } from './error';
import type { KnowledgeMapDoc, MindmapNode } from './types';

const logger = new Logger('krypton-mindmap.model');
const documentColl = db.collection<any>('document');
const HYDRO_PROBLEM_DOCTYPE = 10;
const ALLOWED_COLORS = new Set(['gray', 'sky', 'blue', 'green', 'amber', 'rose', 'purple']);

export interface ProblemSummary {
    domainId: string;
    docId: number;
    pid: string;
    title: string;
    hidden: boolean;
}

interface ReferencingProblemDocument {
    domainId: string;
    docId: number;
    pid?: string | number;
    title?: string;
    hidden?: boolean;
    tag?: unknown[];
    knowledgeMapId?: unknown;
    knowledgeNodeIds?: unknown[];
    managedAuthoring?: { selectedMindmapNodeIds?: unknown[] };
}

interface MutationContext {
    domainId: string;
    actor: number;
}

interface NodeMutationContext extends MutationContext {
    mapId: ObjectId | string;
    expectedMapUpdatedAt: Date;
}

interface NodePatch {
    topic?: string;
    description?: string;
    color?: string;
    tags?: string[];
    problemIds?: string[];
}

function objectId(value: ObjectId | string, field = 'nodeId'): ObjectId {
    if (value instanceof ObjectId) return value;
    if (!ObjectId.isValid(value)) throw new MindmapRequestError(`${field} 无效`);
    return new ObjectId(value);
}

function idString(value: unknown): string | null {
    if (value instanceof ObjectId) return value.toHexString();
    if (typeof value === 'string' && ObjectId.isValid(value)) return new ObjectId(value).toHexString();
    return null;
}

function sameId(left: unknown, right: unknown): boolean {
    const a = idString(left);
    const b = idString(right);
    return !!a && a === b;
}

function canonicalStrings(values: unknown, field: string, limit: number, itemLimit: number): string[] {
    if (!Array.isArray(values)) throw new MindmapRequestError(`${field} 必须是数组`);
    if (values.length > limit) throw new MindmapRequestError(`${field} 最多允许 ${limit} 项`);
    const result: string[] = [];
    for (const value of values) {
        if (typeof value !== 'string') throw new MindmapRequestError(`${field} 包含非字符串值`);
        const normalized = value.trim();
        if (!normalized) continue;
        if (normalized.length > itemLimit) throw new MindmapRequestError(`${field} 单项过长`);
        if (!result.includes(normalized)) result.push(normalized);
    }
    return result;
}

function canonicalTopic(value: unknown): string {
    if (typeof value !== 'string') throw new MindmapRequestError('节点名称必填');
    const topic = value.trim();
    if (!topic) throw new MindmapRequestError('节点名称不能为空');
    if (topic.length > 100) throw new MindmapRequestError('节点名称不能超过 100 个字符');
    return topic;
}

function canonicalMapTitle(value: unknown): string {
    if (typeof value !== 'string') throw new MindmapRequestError('导图名称必填');
    const title = value.trim();
    if (!title) throw new MindmapRequestError('导图名称不能为空');
    if (title.length > 100) throw new MindmapRequestError('导图名称不能超过 100 个字符');
    return title;
}

function canonicalDescription(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') throw new MindmapRequestError('节点说明格式无效');
    const description = value.trim();
    if (!description) return undefined;
    if (description.length > 2000) throw new MindmapRequestError('节点说明不能超过 2000 个字符');
    return description;
}

function canonicalColor(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string' || !ALLOWED_COLORS.has(value)) throw new MindmapRequestError('节点颜色无效');
    return value;
}

function sortNodes(nodes: MindmapNode[]): MindmapNode[] {
    return nodes.slice().sort((left, right) => {
        const order = Number(left.order || 0) - Number(right.order || 0);
        return order || left._id.toHexString().localeCompare(right._id.toHexString());
    });
}

function asProblemSummary(doc: ReferencingProblemDocument): ProblemSummary {
    return {
        docId: doc.docId,
        domainId: doc.domainId,
        pid: String(doc.pid || doc.docId),
        title: doc.title || '(无标题)',
        hidden: doc.hidden === true,
    };
}

function referencedNodeIds(doc: ReferencingProblemDocument): string[] {
    const knowledge = doc.knowledgeNodeIds;
    const managed = doc.managedAuthoring?.selectedMindmapNodeIds;
    if (knowledge !== undefined && !Array.isArray(knowledge)) {
        throw new Error(`mindmap reference field malformed domain=${doc.domainId} docId=${doc.docId} field=knowledgeNodeIds`);
    }
    if (managed !== undefined && !Array.isArray(managed)) {
        throw new Error(`mindmap reference field malformed domain=${doc.domainId} docId=${doc.docId} field=managedAuthoring.selectedMindmapNodeIds`);
    }
    const ids: string[] = [];
    for (const value of [...(knowledge || []), ...(managed || [])]) {
        const id = idString(value);
        if (!id) throw new Error(`mindmap reference id malformed domain=${doc.domainId} docId=${doc.docId}`);
        if (!ids.includes(id)) ids.push(id);
    }
    return ids;
}

function assertProblemMap(problem: ReferencingProblemDocument, mapId: ObjectId): void {
    const actual = idString(problem.knowledgeMapId);
    if (!actual) {
        throw new Error(`mindmap problem map missing domain=${problem.domainId} docId=${problem.docId}`);
    }
    if (actual !== mapId.toHexString()) {
        throw new Error(`mindmap cross-map reference domain=${problem.domainId} docId=${problem.docId} expectedMap=${mapId} actualMap=${actual}`);
    }
}

async function findReferencingProblems(mapId: ObjectId, nodeIds: ObjectId[]): Promise<ReferencingProblemDocument[]> {
    if (!nodeIds.length) return [];
    const problems = (await documentColl
        .find({
            docType: HYDRO_PROBLEM_DOCTYPE,
            $or: [{ knowledgeNodeIds: { $in: nodeIds } }, { 'managedAuthoring.selectedMindmapNodeIds': { $in: nodeIds } }],
        })
        .project({
            domainId: 1,
            docId: 1,
            pid: 1,
            title: 1,
            hidden: 1,
            knowledgeMapId: 1,
            knowledgeNodeIds: 1,
            'managedAuthoring.selectedMindmapNodeIds': 1,
        })
        .toArray()) as ReferencingProblemDocument[];
    for (const problem of problems) assertProblemMap(problem, mapId);
    return problems;
}

function conflict(message: string, reason: string, problems: ProblemSummary[] = []): never {
    throw new MindmapConflictError(message, { reason, problems });
}

interface MutationFailureContext {
    fromParent: string;
    toParent: string;
    fromIndex: number | '-';
    toIndex: number | '-';
    expectedUpdatedAt: string;
    expectedParentUpdatedAt: string;
}

function rethrowWithMutationContext(error: unknown, context: MutationFailureContext): never {
    if (error && typeof error === 'object') {
        Object.defineProperty(error, 'mindmapMutationContext', {
            configurable: true,
            enumerable: false,
            value: context,
        });
    }
    throw error;
}

async function staleOrMissing(mapId: ObjectId, id: ObjectId): Promise<never> {
    const exists = await nodesColl.findOne({ _id: id }, { projection: { _id: 1, mapId: 1 } });
    if (!exists) conflict('导图节点不存在，请刷新后重试', 'node-missing');
    if (!sameId(exists.mapId, mapId)) conflict('节点属于另一张导图，请刷新后重试', 'cross-map-node');
    conflict('导图已被其他操作修改，请刷新后重试', 'stale-version');
}

async function staleOrMissingMap(id: ObjectId): Promise<never> {
    const exists = await mapsColl.findOne({ _id: id }, { projection: { _id: 1 } });
    if (!exists) conflict('导图不存在，请刷新后重试', 'map-missing');
    conflict('导图已被其他操作修改，请刷新后重试', 'stale-map-version');
}

function nextVersion(previous: Date): Date {
    if (!(previous instanceof Date) || Number.isNaN(previous.getTime())) throw new MindmapRequestError('节点版本无效');
    return new Date(Math.max(Date.now(), previous.getTime() + 1));
}

async function bumpTargetParent(mapId: ObjectId, parentId: ObjectId, expectedUpdatedAt: Date): Promise<Date> {
    const now = nextVersion(expectedUpdatedAt);
    const result = await nodesColl.updateOne({ _id: parentId, mapId, updatedAt: expectedUpdatedAt }, { $set: { updatedAt: now } });
    if (result.matchedCount !== 1) await staleOrMissing(mapId, parentId);
    return now;
}

async function bumpMapVersion(mapId: ObjectId, expectedUpdatedAt: Date): Promise<Date> {
    const now = nextVersion(expectedUpdatedAt);
    const result = await mapsColl.updateOne({ _id: mapId, updatedAt: expectedUpdatedAt }, { $set: { updatedAt: now } });
    if (result.matchedCount !== 1) await staleOrMissingMap(mapId);
    return now;
}

function descendantsOf(nodeId: string, nodes: MindmapNode[]): Set<string> {
    const children = new Map<string, string[]>();
    for (const node of nodes) {
        const parent = idString(node.parentId);
        if (!parent) continue;
        const list = children.get(parent) || [];
        list.push(node._id.toHexString());
        children.set(parent, list);
    }
    const found = new Set<string>();
    const queue = [nodeId];
    while (queue.length) {
        const current = queue.shift()!;
        if (found.has(current)) conflict('当前导图已经存在环，拒绝继续修改', 'existing-cycle');
        found.add(current);
        queue.push(...(children.get(current) || []));
    }
    return found;
}

function tagsForSelection(nodeIds: string[], byId: Map<string, MindmapNode>): string[] {
    const tags: string[] = [];
    for (const selectedId of nodeIds) {
        let current: string | null = selectedId;
        const pathSeen = new Set<string>();
        const path: MindmapNode[] = [];
        while (current) {
            if (pathSeen.has(current)) throw new Error(`mindmap cycle while materializing reference node=${selectedId}`);
            pathSeen.add(current);
            const node = byId.get(current);
            if (!node) throw new Error(`mindmap referenced node missing node=${current}`);
            path.unshift(node);
            current = idString(node.parentId);
        }
        for (const node of path) {
            for (const tag of Array.isArray(node.tags) ? node.tags : []) {
                const normalized = typeof tag === 'string' ? tag.trim() : '';
                if (normalized && !tags.includes(normalized)) tags.push(normalized);
            }
        }
    }
    return tags.sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function assertReparentKeepsReferencedTags(
    mapId: ObjectId,
    movingNode: MindmapNode,
    newParentId: ObjectId,
    allNodes: MindmapNode[],
    subtree: Set<string>,
): Promise<void> {
    if (sameId(movingNode.parentId, newParentId)) return;
    const subtreeIds = [...subtree].map((id) => new ObjectId(id));
    const references = await findReferencingProblems(mapId, subtreeIds);
    if (!references.length) return;

    const currentById = new Map(allNodes.map((node) => [node._id.toHexString(), node]));
    const movedById = new Map(currentById);
    movedById.set(movingNode._id.toHexString(), { ...movingNode, parentId: newParentId });
    const affected: ProblemSummary[] = [];
    for (const problem of references) {
        const selected = referencedNodeIds(problem);
        const before = tagsForSelection(selected, currentById);
        const after = tagsForSelection(selected, movedById);
        if (!arraysEqual(before, after)) affected.push(asProblemSummary(problem));
    }
    if (affected.length) {
        conflict('移动会改变已引用题目的继承标签，请先执行单独的标签迁移', 'inherited-tags-change', affected);
    }
}

async function canonicalProblemIds(domainId: string, mapId: ObjectId, values: unknown): Promise<string[]> {
    const requested = canonicalStrings(values, '手动关联题目', 200, 80);
    if (!requested.length) return [];
    const numeric = requested.map(Number).filter((value) => Number.isSafeInteger(value));
    const pidCandidates: Array<string | number> = [...requested, ...numeric];
    const docs = await documentColl
        .find({
            domainId,
            docType: HYDRO_PROBLEM_DOCTYPE,
            $or: [{ pid: { $in: pidCandidates } }, ...(numeric.length ? [{ docId: { $in: numeric } }] : [])],
        })
        .project({ domainId: 1, docId: 1, pid: 1, knowledgeMapId: 1 })
        .toArray();

    const resolved: string[] = [];
    const missing: string[] = [];
    const ambiguous: string[] = [];
    const wrongMap: string[] = [];
    for (const input of requested) {
        const matches = docs.filter((doc: any) => String(doc.pid ?? '') === input || String(doc.docId) === input);
        const unique = new Map(matches.map((doc: any) => [String(doc.docId), doc]));
        if (!unique.size) {
            missing.push(input);
            continue;
        }
        if (unique.size > 1) {
            ambiguous.push(input);
            continue;
        }
        const doc: any = unique.values().next().value;
        const actualMapId = idString(doc.knowledgeMapId);
        if (actualMapId && actualMapId !== mapId.toHexString()) {
            wrongMap.push(input);
            continue;
        }
        assertProblemMap(doc, mapId);
        const canonical = String(doc.pid || doc.docId);
        if (!resolved.includes(canonical)) resolved.push(canonical);
    }
    if (missing.length || ambiguous.length || wrongMap.length) {
        throw new MindmapRequestError(
            [
                missing.length ? `题目不存在或不属于当前域：${missing.join('、')}` : '',
                ambiguous.length ? `题号有歧义：${ambiguous.join('、')}` : '',
                wrongMap.length ? `题目属于另一张导图：${wrongMap.join('、')}` : '',
            ]
                .filter(Boolean)
                .join('；'),
        );
    }
    return resolved;
}

/** Resolve root branch sides without writing defaults into existing data. */
export function resolveRootBranchSides(nodes: MindmapNode[], rootId: ObjectId | string): Map<string, 'left' | 'right'> {
    const root = objectId(rootId, 'rootNodeId');
    const children = sortNodes(nodes.filter((node) => sameId(node.parentId, root)));
    const result = new Map<string, 'left' | 'right'>();
    let left = 0;
    for (const child of children) {
        if (child.layoutSide === 'left' || child.layoutSide === 'right') {
            result.set(child._id.toHexString(), child.layoutSide);
            if (child.layoutSide === 'left') left += 1;
        }
    }
    const targetLeft = Math.ceil(children.length / 2);
    for (const child of children) {
        const id = child._id.toHexString();
        if (result.has(id)) continue;
        const side = left < targetLeft ? 'left' : 'right';
        result.set(id, side);
        if (side === 'left') left += 1;
    }
    return result;
}

function defaultRootSide(nodes: MindmapNode[], rootId: ObjectId): 'left' | 'right' {
    const sides = resolveRootBranchSides(nodes, rootId);
    let left = 0;
    let right = 0;
    for (const side of sides.values()) {
        if (side === 'left') left += 1;
        else right += 1;
    }
    return left < right ? 'left' : 'right';
}

/* ─── map lifecycle ─── */

export interface KnowledgeMapUsage {
    nodes: number;
    problems: number;
    courses: number;
}

export async function listKnowledgeMaps(includeHidden = false): Promise<KnowledgeMapDoc[]> {
    return await mapsColl
        .find(includeHidden ? {} : { visibility: 'public' })
        .sort({ title: 1, _id: 1 })
        .toArray();
}

export async function getKnowledgeMap(id: ObjectId | string): Promise<KnowledgeMapDoc | null> {
    return await mapsColl.findOne({ _id: objectId(id, 'mapId') });
}

export async function getKnowledgeMapUsage(id: ObjectId | string): Promise<KnowledgeMapUsage> {
    const mapId = objectId(id, 'mapId');
    const [nodeCount, problemCount, courseCount] = await Promise.all([
        nodesColl.countDocuments({ mapId }),
        documentColl.countDocuments({ docType: HYDRO_PROBLEM_DOCTYPE, knowledgeMapId: mapId }),
        documentColl.countDocuments({ docType: 40, kind: 'course', mindmapId: mapId }),
    ]);
    return { nodes: nodeCount, problems: problemCount, courses: courseCount };
}

function assertMapTree(map: KnowledgeMapDoc, nodes: MindmapNode[]): void {
    if (!nodes.length) throw new Error(`mindmap has no root map=${map._id}`);
    const mapId = map._id.toHexString();
    const byId = new Map<string, MindmapNode>();
    const roots: MindmapNode[] = [];
    for (const node of nodes) {
        if (!sameId(node.mapId, map._id)) throw new Error(`mindmap node belongs to another map map=${map._id} node=${node._id}`);
        byId.set(node._id.toHexString(), node);
        if (node.parentId === null) roots.push(node);
    }
    if (roots.length !== 1 || !sameId(roots[0]._id, map.rootNodeId)) {
        throw new Error(`mindmap root invariant failed map=${mapId} roots=${roots.map((node) => node._id).join(',')}`);
    }
    for (const node of nodes) {
        if (node.parentId !== null && !byId.has(node.parentId.toHexString())) {
            throw new Error(`mindmap parent missing map=${mapId} node=${node._id} parent=${node.parentId}`);
        }
    }
    const reachable = descendantsOf(map.rootNodeId.toHexString(), nodes);
    if (reachable.size !== nodes.length) {
        throw new Error(`mindmap contains unreachable nodes map=${mapId} reachable=${reachable.size} total=${nodes.length}`);
    }
}

async function restoreDeletedMap(map: KnowledgeMapDoc, root: MindmapNode, cause: unknown): Promise<never> {
    const restoreErrors: unknown[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            if (!(await mapsColl.findOne({ _id: map._id }))) await mapsColl.insertOne(map);
        } catch (error) {
            restoreErrors.push(error);
        }
        try {
            if (!(await nodesColl.findOne({ _id: root._id }))) await nodesColl.insertOne(root);
        } catch (error) {
            restoreErrors.push(error);
        }
        try {
            const [exactMap, exactRoot, nodeCount] = await Promise.all([
                mapsColl.findOne({ ...map }),
                nodesColl.findOne({ ...root }),
                nodesColl.countDocuments({ mapId: map._id }),
            ]);
            if (exactMap && exactRoot && nodeCount === 1) throw cause;
            restoreErrors.push(
                new Error(
                    `mindmap delete restore incomplete map=${map._id} exactMap=${exactMap ? 'yes' : 'no'} exactRoot=${exactRoot ? 'yes' : 'no'} nodes=${nodeCount}`,
                ),
            );
        } catch (error) {
            if (error === cause) throw error;
            restoreErrors.push(error);
        }
    }
    throw new AggregateError([cause, ...restoreErrors], `mindmap delete left an unverified partial write map=${map._id}`);
}

export async function createKnowledgeMap(
    input: MutationContext & {
        title: unknown;
        rootTopic: unknown;
        layoutDirection?: unknown;
    },
): Promise<KnowledgeMapDoc> {
    const title = canonicalMapTitle(input.title);
    const rootTopic = canonicalTopic(input.rootTopic);
    const layoutDirection = input.layoutDirection ?? 'RIGHT';
    if (layoutDirection !== 'RIGHT' && layoutDirection !== 'DOWN') throw new MindmapRequestError('导图布局方向无效');
    const now = new Date();
    const mapId = new ObjectId();
    const rootId = new ObjectId();
    const map: KnowledgeMapDoc = {
        _id: mapId,
        title,
        rootNodeId: rootId,
        visibility: 'hidden',
        layoutDirection,
        createdAt: now,
        updatedAt: now,
    };
    const root: MindmapNode = {
        _id: rootId,
        mapId,
        parentId: null,
        topic: rootTopic,
        tags: [],
        problemIds: [],
        order: 0,
        createdAt: now,
        updatedAt: now,
    };
    await insertMapWithRoot(map, root);
    logger.info('Mindmap map mutation domain=%s actor=%d map=%s operation=create result=success', input.domainId, input.actor, mapId);
    return map;
}

export async function updateKnowledgeMap(
    input: MutationContext & {
        id: ObjectId | string;
        expectedUpdatedAt: Date;
        patch: { title?: unknown; layoutDirection?: unknown; visibility?: unknown };
    },
): Promise<KnowledgeMapDoc> {
    const mapId = objectId(input.id, 'mapId');
    const current = await mapsColl.findOne({ _id: mapId });
    if (!current) conflict('导图不存在，请刷新后重试', 'map-missing');
    const keys = Object.keys(input.patch);
    if (!keys.length) throw new MindmapRequestError('没有可保存的导图字段');
    if (keys.some((key) => !['title', 'layoutDirection', 'visibility'].includes(key))) {
        throw new MindmapRequestError('请求包含不可编辑的导图字段');
    }
    const set: Record<string, unknown> = { updatedAt: nextVersion(input.expectedUpdatedAt) };
    if (Object.hasOwn(input.patch, 'title')) set.title = canonicalMapTitle(input.patch.title);
    if (Object.hasOwn(input.patch, 'layoutDirection')) {
        if (input.patch.layoutDirection !== 'RIGHT' && input.patch.layoutDirection !== 'DOWN') {
            throw new MindmapRequestError('导图布局方向无效');
        }
        set.layoutDirection = input.patch.layoutDirection;
    }
    if (Object.hasOwn(input.patch, 'visibility')) {
        if (input.patch.visibility !== 'hidden' && input.patch.visibility !== 'public') {
            throw new MindmapRequestError('导图公开状态无效');
        }
        if (input.patch.visibility === 'public' && current.visibility !== 'public') {
            assertMapTree(current, await listAllNodes(mapId));
        }
        if (input.patch.visibility === 'hidden' && current.visibility === 'public') {
            const [courses, problems] = await Promise.all([
                documentColl.countDocuments({ docType: 40, kind: 'course', mindmapId: mapId }),
                documentColl.countDocuments({ docType: HYDRO_PROBLEM_DOCTYPE, knowledgeMapId: mapId }),
            ]);
            if (courses > 0) conflict(`该导图仍被 ${courses} 门课程使用，请先逐课解绑`, 'map-course-referenced');
            if (problems > 0) conflict(`该导图仍被 ${problems} 道题引用，请先逐题更换所属导图`, 'map-problem-referenced');
        }
        set.visibility = input.patch.visibility;
    }
    const result = await mapsColl.updateOne({ _id: mapId, updatedAt: input.expectedUpdatedAt }, { $set: set });
    if (result.matchedCount !== 1) await staleOrMissingMap(mapId);
    const updated = await mapsColl.findOne({ _id: mapId });
    if (!updated) throw new Error(`mindmap disappeared after update map=${mapId}`);
    logger.info('Mindmap map mutation domain=%s actor=%d map=%s operation=update fields=%o result=success', input.domainId, input.actor, mapId, keys);
    return updated;
}

export async function deleteKnowledgeMap(input: MutationContext & { id: ObjectId | string; expectedUpdatedAt: Date }): Promise<void> {
    const mapId = objectId(input.id, 'mapId');
    const map = await mapsColl.findOne({ _id: mapId });
    if (!map) conflict('导图不存在，请刷新后重试', 'map-missing');
    if (map.visibility !== 'hidden') conflict('只有隐藏导图可以删除', 'map-public');
    const nodes = await listAllNodes(mapId);
    assertMapTree(map, nodes);
    await findReferencingProblems(
        mapId,
        nodes.map((node) => node._id),
    );
    const usage = await getKnowledgeMapUsage(mapId);
    if (usage.problems || usage.courses) {
        conflict(`导图仍被 ${usage.problems} 道题和 ${usage.courses} 门课程引用`, 'map-referenced');
    }
    if (nodes.length !== 1) conflict('导图仍有子节点，请先逐个清理', 'map-has-children');
    const root = nodes[0];
    let removed;
    try {
        removed = await mapsColl.deleteOne({ _id: mapId, updatedAt: input.expectedUpdatedAt, visibility: 'hidden' });
    } catch (error) {
        await restoreDeletedMap(map, root, error);
    }
    if (removed.deletedCount !== 1) await staleOrMissingMap(mapId);
    try {
        const rootRemoved = await nodesColl.deleteOne({ _id: map.rootNodeId, mapId, parentId: null });
        if (rootRemoved.deletedCount !== 1) throw new Error(`mindmap root delete missed map=${mapId} root=${map.rootNodeId}`);
    } catch (error) {
        await restoreDeletedMap(map, root, error);
    }
    logger.info('Mindmap map mutation domain=%s actor=%d map=%s operation=delete result=success', input.domainId, input.actor, mapId);
}

/* ─── tree access ─── */

export async function listAllNodes(mapId: ObjectId | string): Promise<MindmapNode[]> {
    const id = objectId(mapId, 'mapId');
    return await nodesColl.find({ mapId: id }).sort({ parentId: 1, order: 1, _id: 1 }).toArray();
}

export async function getNode(mapId: ObjectId | string, id: ObjectId | string): Promise<MindmapNode | null> {
    return await nodesColl.findOne({ _id: objectId(id), mapId: objectId(mapId, 'mapId') });
}

export async function getNodeReferenceCounts(mapIdValue: ObjectId | string, nodes: MindmapNode[]): Promise<Record<string, number>> {
    const mapId = objectId(mapIdValue, 'mapId');
    if (nodes.some((node) => !sameId(node.mapId, mapId))) throw new Error(`mindmap reference count received mixed maps map=${mapId}`);
    const ids = nodes.map((node) => node._id);
    const references = await findReferencingProblems(mapId, ids);
    const byId = new Map(nodes.map((node) => [node._id.toHexString(), node]));
    const counts: Record<string, number> = {};
    for (const node of nodes) counts[node._id.toHexString()] = 0;
    for (const problem of references) {
        const affected = new Set<string>();
        for (const selectedId of referencedNodeIds(problem)) {
            if (!byId.has(selectedId)) {
                throw new Error(
                    `mindmap problem references a node outside its map domain=${problem.domainId} docId=${problem.docId} map=${mapId} node=${selectedId}`,
                );
            }
            let current: string | null = selectedId;
            const pathSeen = new Set<string>();
            while (current && byId.has(current)) {
                if (pathSeen.has(current)) throw new Error(`mindmap cycle while counting references node=${selectedId}`);
                pathSeen.add(current);
                affected.add(current);
                current = idString(byId.get(current)!.parentId);
            }
        }
        for (const id of affected) counts[id] += 1;
    }
    return counts;
}

export async function createNode(
    input: NodeMutationContext & {
        parentId: ObjectId | string;
        expectedParentUpdatedAt: Date;
        topic: unknown;
        description?: unknown;
        color?: unknown;
        tags?: unknown;
        problemIds?: unknown;
    },
): Promise<MindmapNode> {
    const mapId = objectId(input.mapId, 'mapId');
    const parentId = objectId(input.parentId, 'parentId');
    const topic = canonicalTopic(input.topic);
    const description = canonicalDescription(input.description);
    const color = canonicalColor(input.color);
    const tags = canonicalStrings(input.tags ?? [], 'tags', 30, 80);
    const problemIds = await canonicalProblemIds(input.domainId, mapId, input.problemIds ?? []);
    const [allNodes, config] = await Promise.all([listAllNodes(mapId), getKnowledgeMap(mapId)]);
    if (!config) conflict('导图不存在，请刷新后重试', 'map-missing');
    const parent = allNodes.find((node) => sameId(node._id, parentId));
    if (!parent) {
        const crossMapParent = await nodesColl.findOne({ _id: parentId }, { projection: { mapId: 1 } });
        conflict(
            crossMapParent ? '不能把节点添加到另一张导图' : '父节点不存在，请刷新后重试',
            crossMapParent ? 'cross-map-parent' : 'parent-missing',
        );
    }
    const siblings = sortNodes(allNodes.filter((node) => sameId(node.parentId, parentId)));
    const order = Number(siblings.at(-1)?.order || 0) + 10;
    const layoutSide = config.rootNodeId && sameId(config.rootNodeId, parentId) ? defaultRootSide(allNodes, parentId) : undefined;

    const mapVersion = await bumpMapVersion(mapId, input.expectedMapUpdatedAt);
    const parentVersion = await bumpTargetParent(mapId, parentId, input.expectedParentUpdatedAt);
    const now = new Date(Math.max(Date.now(), parentVersion.getTime(), mapVersion.getTime()));
    const doc: MindmapNode = {
        _id: new ObjectId(),
        mapId,
        parentId,
        topic,
        ...(description ? { description } : {}),
        ...(color ? { color } : {}),
        ...(layoutSide ? { layoutSide } : {}),
        tags,
        problemIds,
        order,
        createdAt: now,
        updatedAt: now,
    };
    await nodesColl.insertOne(doc);
    logger.info(
        'Mindmap mutation domain=%s actor=%d map=%s node=%s operation=create fromParent=- toParent=%s fromIndex=- toIndex=%d result=success',
        input.domainId,
        input.actor,
        mapId,
        doc._id,
        parentId,
        siblings.length,
    );
    return doc;
}

export async function updateNode(
    input: NodeMutationContext & {
        id: ObjectId | string;
        expectedUpdatedAt: Date;
        patch: NodePatch;
    },
): Promise<MindmapNode> {
    const mapId = objectId(input.mapId, 'mapId');
    const id = objectId(input.id);
    const current = await nodesColl.findOne({ _id: id, mapId });
    if (!current) {
        const crossMapNode = await nodesColl.findOne({ _id: id }, { projection: { mapId: 1 } });
        conflict(crossMapNode ? '不能编辑另一张导图的节点' : '导图节点不存在，请刷新后重试', crossMapNode ? 'cross-map-node' : 'node-missing');
    }
    const keys = Object.keys(input.patch);
    if (!keys.length) throw new MindmapRequestError('没有可保存的字段');
    if (keys.some((key) => !['topic', 'description', 'color', 'tags', 'problemIds'].includes(key))) {
        throw new MindmapRequestError('请求包含不可编辑的节点字段');
    }

    const set: Record<string, unknown> = { updatedAt: nextVersion(input.expectedUpdatedAt) };
    const unset: Record<string, ''> = {};
    if (Object.hasOwn(input.patch, 'topic')) set.topic = canonicalTopic(input.patch.topic);
    if (Object.hasOwn(input.patch, 'description')) {
        const description = canonicalDescription(input.patch.description);
        if (description) set.description = description;
        else unset.description = '';
    }
    if (Object.hasOwn(input.patch, 'color')) {
        const color = canonicalColor(input.patch.color);
        if (color) set.color = color;
        else unset.color = '';
    }
    if (Object.hasOwn(input.patch, 'tags')) {
        const tags = canonicalStrings(input.patch.tags, 'tags', 30, 80);
        const existing = canonicalStrings(current.tags || [], 'tags', 30, 80);
        if (!arraysEqual(tags, existing)) {
            const allNodes = await listAllNodes(mapId);
            const affectedNodeIds = [...descendantsOf(id.toHexString(), allNodes)].map((nodeId) => new ObjectId(nodeId));
            const refs = await findReferencingProblems(mapId, affectedNodeIds);
            if (refs.length) conflict('该节点已被题目引用，不能直接修改标签', 'referenced-tags-locked', refs.map(asProblemSummary));
        }
        set.tags = tags;
    }
    if (Object.hasOwn(input.patch, 'problemIds')) set.problemIds = await canonicalProblemIds(input.domainId, mapId, input.patch.problemIds);

    await bumpMapVersion(mapId, input.expectedMapUpdatedAt);
    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length) update.$unset = unset;
    const result = await nodesColl.updateOne({ _id: id, mapId, updatedAt: input.expectedUpdatedAt }, update);
    if (result.matchedCount !== 1) await staleOrMissing(mapId, id);
    const updated = await nodesColl.findOne({ _id: id, mapId });
    if (!updated) throw new Error(`mindmap node disappeared after update node=${id}`);
    logger.info(
        'Mindmap mutation domain=%s actor=%d map=%s node=%s operation=update fromParent=- toParent=- fromIndex=- toIndex=- fields=%o result=success',
        input.domainId,
        input.actor,
        mapId,
        id,
        keys,
    );
    return updated;
}

function insertionOrder(siblings: MindmapNode[], targetIndex: number): number {
    const index = Math.max(0, Math.min(targetIndex, siblings.length));
    const before = siblings[index - 1];
    const after = siblings[index];
    if (!before && !after) return 10;
    if (!before) return Number(after.order || 0) - 10;
    if (!after) return Number(before.order || 0) + 10;
    const left = Number(before.order || 0);
    const right = Number(after.order || 0);
    if (Number.isFinite(left) && Number.isFinite(right) && right > left) {
        const middle = left + (right - left) / 2;
        if (middle > left && middle < right) return middle;
    }
    conflict('同级顺序已无法继续细分，请调整到其它落点后重试', 'order-space-exhausted');
}

export async function moveNode(
    input: NodeMutationContext & {
        id: ObjectId | string;
        newParentId: ObjectId | string;
        targetIndex: number;
        layoutSide?: 'left' | 'right';
        expectedUpdatedAt: Date;
        expectedParentUpdatedAt: Date;
    },
): Promise<MindmapNode> {
    const mapId = objectId(input.mapId, 'mapId');
    const id = objectId(input.id);
    const newParentId = objectId(input.newParentId, 'newParentId');
    if (!Number.isSafeInteger(input.targetIndex) || input.targetIndex < 0) throw new MindmapRequestError('目标顺序无效');
    const [allNodes, config] = await Promise.all([listAllNodes(mapId), getKnowledgeMap(mapId)]);
    if (!config) conflict('导图不存在，请刷新后重试', 'map-missing');
    const node = allNodes.find((entry) => sameId(entry._id, id));
    const parent = allNodes.find((entry) => sameId(entry._id, newParentId));
    if (!node) {
        const crossMapNode = await nodesColl.findOne({ _id: id }, { projection: { mapId: 1 } });
        conflict(crossMapNode ? '不能移动另一张导图的节点' : '导图节点不存在，请刷新后重试', crossMapNode ? 'cross-map-node' : 'node-missing');
    }
    if (!parent) {
        const crossMapParent = await nodesColl.findOne({ _id: newParentId }, { projection: { mapId: 1 } });
        conflict(
            crossMapParent ? '不能把节点移动到另一张导图' : '目标父节点不存在，请刷新后重试',
            crossMapParent ? 'cross-map-parent' : 'parent-missing',
        );
    }
    const oldSiblings = sortNodes(allNodes.filter((entry) => sameId(entry.parentId, node.parentId)));
    const siblings = sortNodes(allNodes.filter((entry) => sameId(entry.parentId, newParentId) && !sameId(entry._id, id)));
    const targetIndex = Math.min(input.targetIndex, siblings.length);
    const failureContext: MutationFailureContext = {
        fromParent: idString(node.parentId) || '-',
        toParent: newParentId.toHexString(),
        fromIndex: oldSiblings.findIndex((entry) => sameId(entry._id, id)),
        toIndex: targetIndex,
        expectedUpdatedAt: input.expectedUpdatedAt.toISOString(),
        expectedParentUpdatedAt: input.expectedParentUpdatedAt.toISOString(),
    };
    try {
        if (config.rootNodeId && sameId(config.rootNodeId, id)) conflict('根节点不能移动', 'root-move');
        if (sameId(id, newParentId)) conflict('节点不能成为自己的父节点', 'self-parent');
        const subtree = descendantsOf(id.toHexString(), allNodes);
        if (subtree.has(newParentId.toHexString())) conflict('节点不能移动到自己的后代中', 'descendant-parent');
        await assertReparentKeepsReferencedTags(mapId, node, newParentId, allNodes, subtree);

        const order = insertionOrder(siblings, targetIndex);
        const rootChild = !!config.rootNodeId && sameId(config.rootNodeId, newParentId);
        let layoutSide: 'left' | 'right' | undefined;
        if (!rootChild && input.layoutSide !== undefined) throw new MindmapRequestError('只有根节点的直接分支可以设置左右方向');
        if (rootChild) {
            if (input.layoutSide && input.layoutSide !== 'left' && input.layoutSide !== 'right') throw new MindmapRequestError('根分支侧边无效');
            const currentSide = sameId(node.parentId, newParentId) ? resolveRootBranchSides(allNodes, newParentId).get(id.toHexString()) : undefined;
            layoutSide = input.layoutSide || currentSide || defaultRootSide(allNodes, newParentId);
        }

        await bumpMapVersion(mapId, input.expectedMapUpdatedAt);
        await bumpTargetParent(mapId, newParentId, input.expectedParentUpdatedAt);
        const now = nextVersion(input.expectedUpdatedAt);
        const set: Record<string, unknown> = { parentId: newParentId, order, updatedAt: now };
        const update: Record<string, unknown> = { $set: set };
        if (layoutSide) set.layoutSide = layoutSide;
        else update.$unset = { layoutSide: '' };
        const result = await nodesColl.updateOne({ _id: id, mapId, updatedAt: input.expectedUpdatedAt }, update);
        if (result.matchedCount !== 1) await staleOrMissing(mapId, id);
        const updated = await nodesColl.findOne({ _id: id, mapId });
        if (!updated) throw new Error(`mindmap node disappeared after move node=${id}`);
        logger.info(
            'Mindmap mutation domain=%s actor=%d map=%s node=%s operation=move fromParent=%s toParent=%s fromIndex=%d toIndex=%d side=%s result=success',
            input.domainId,
            input.actor,
            mapId,
            id,
            node.parentId,
            newParentId,
            failureContext.fromIndex,
            targetIndex,
            layoutSide || '-',
        );
        return updated;
    } catch (error) {
        rethrowWithMutationContext(error, failureContext);
    }
}

export async function deleteNode(input: NodeMutationContext & { id: ObjectId | string; expectedUpdatedAt: Date }): Promise<void> {
    const mapId = objectId(input.mapId, 'mapId');
    const id = objectId(input.id);
    const [node, config] = await Promise.all([nodesColl.findOne({ _id: id, mapId }), getKnowledgeMap(mapId)]);
    if (!config) conflict('导图不存在，请刷新后重试', 'map-missing');
    if (!node) {
        const crossMapNode = await nodesColl.findOne({ _id: id }, { projection: { mapId: 1 } });
        conflict(crossMapNode ? '不能删除另一张导图的节点' : '导图节点不存在，请刷新后重试', crossMapNode ? 'cross-map-node' : 'node-missing');
    }
    if (config.rootNodeId && sameId(config.rootNodeId, id)) conflict('根节点不能删除', 'root-delete');
    const child = await nodesColl.findOne({ mapId, parentId: id }, { projection: { _id: 1 } });
    if (child) conflict('只能删除没有子节点的叶子，请先处理其子节点', 'node-has-children');
    const refs = await findReferencingProblems(mapId, [id]);
    if (refs.length) conflict('该节点仍被题目引用，不能删除', 'node-referenced', refs.map(asProblemSummary));
    await bumpMapVersion(mapId, input.expectedMapUpdatedAt);
    const result = await nodesColl.deleteOne({ _id: id, mapId, updatedAt: input.expectedUpdatedAt });
    if (result.deletedCount !== 1) await staleOrMissing(mapId, id);
    logger.info(
        'Mindmap mutation domain=%s actor=%d map=%s node=%s operation=delete fromParent=%s toParent=- fromIndex=- toIndex=- result=success',
        input.domainId,
        input.actor,
        mapId,
        id,
        node.parentId,
    );
}

/* ─── problem panels and admin search ─── */

export interface PanelProblem extends ProblemSummary {
    nSubmit: number;
    nAccept: number;
    /** Heuristic difficulty 1-6 derived from acceptance rate. */
    difficulty: number;
    sources: Array<'canonical' | 'manual'>;
}

function difficultyOf(problem: { nSubmit?: number; nAccept?: number }): number {
    if (!problem.nSubmit || problem.nSubmit < 5) return 3;
    const rate = (problem.nAccept || 0) / problem.nSubmit;
    if (rate > 0.8) return 1;
    if (rate > 0.6) return 2;
    if (rate > 0.4) return 3;
    if (rate > 0.25) return 4;
    if (rate > 0.1) return 5;
    return 6;
}

export async function listProblemsForNode(
    domainId: string,
    mapIdValue: ObjectId | string,
    nodeId: ObjectId | string,
    scope: Filter<any>,
    options: { includeHidden?: boolean } = {},
): Promise<PanelProblem[]> {
    const mapId = objectId(mapIdValue, 'mapId');
    const node = await getNode(mapId, nodeId);
    if (!node) throw new MindmapRequestError('导图节点不存在');
    const allNodes = await listAllNodes(mapId);
    const subtree = descendantsOf(node._id.toHexString(), allNodes);
    const subtreeIds = [...subtree].map((id) => new ObjectId(id));
    const orClauses: any[] = [{ knowledgeNodeIds: { $in: subtreeIds } }, { 'managedAuthoring.selectedMindmapNodeIds': { $in: subtreeIds } }];
    if (node.problemIds?.length) {
        orClauses.push({ pid: { $in: node.problemIds } });
        const numericIds = node.problemIds.map(Number).filter((value) => Number.isSafeInteger(value));
        if (numericIds.length) orClauses.push({ docId: { $in: numericIds } });
    }
    if (!orClauses.length) return [];
    const docs = await documentColl
        .find({
            $and: [
                scope,
                {
                    docType: HYDRO_PROBLEM_DOCTYPE,
                    domainId,
                    knowledgeMapId: mapId,
                    ...(options.includeHidden ? {} : { hidden: { $ne: true } }),
                    $or: orClauses,
                },
            ],
        })
        .project({
            domainId: 1,
            pid: 1,
            docId: 1,
            title: 1,
            hidden: 1,
            nSubmit: 1,
            nAccept: 1,
            knowledgeNodeIds: 1,
            'managedAuthoring.selectedMindmapNodeIds': 1,
        })
        .limit(500)
        .toArray();
    const manualSet = new Set(node.problemIds || []);
    return docs.map((doc: any) => {
        const pid = String(doc.pid || doc.docId);
        const sources: Array<'canonical' | 'manual'> = [];
        if (referencedNodeIds(doc).some((id) => subtree.has(id))) sources.push('canonical');
        if (manualSet.has(pid) || manualSet.has(String(doc.docId))) sources.push('manual');
        return {
            ...asProblemSummary(doc),
            nSubmit: doc.nSubmit || 0,
            nAccept: doc.nAccept || 0,
            difficulty: difficultyOf(doc),
            sources,
        };
    });
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function searchProblemsForAdmin(domainId: string, mapIdValue: ObjectId | string, query: unknown): Promise<ProblemSummary[]> {
    const mapId = objectId(mapIdValue, 'mapId');
    if (typeof query !== 'string') throw new MindmapRequestError('搜索关键词无效');
    const q = query.trim();
    if (!q) return [];
    if (q.length > 80) throw new MindmapRequestError('搜索关键词不能超过 80 个字符');
    const regex = new RegExp(escapeRegExp(q), 'i');
    const numeric = Number(q);
    const clauses: Record<string, unknown>[] = [{ pid: regex }, { title: regex }];
    if (Number.isSafeInteger(numeric)) clauses.unshift({ docId: numeric });
    const docs = await documentColl
        .find({ domainId, docType: HYDRO_PROBLEM_DOCTYPE, knowledgeMapId: mapId, $or: clauses })
        .project({ domainId: 1, docId: 1, pid: 1, title: 1, hidden: 1 })
        .limit(20)
        .toArray();
    return docs.map(asProblemSummary).sort((left, right) => left.pid.localeCompare(right.pid, 'zh-CN', { numeric: true }));
}
