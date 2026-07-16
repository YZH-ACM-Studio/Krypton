import { Logger } from '@hydrooj/utils';
import type { Filter } from 'mongodb';
import { ObjectId, db } from 'hydrooj';
import { getConfig, nodesColl } from './db';
import { MindmapConflictError, MindmapRequestError } from './error';
import type { MindmapNode } from './types';

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
    knowledgeNodeIds?: unknown[];
    managedAuthoring?: { selectedMindmapNodeIds?: unknown[] };
}

interface MutationContext {
    domainId: string;
    actor: number;
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

async function findReferencingProblems(nodeIds: ObjectId[]): Promise<ReferencingProblemDocument[]> {
    if (!nodeIds.length) return [];
    return (await documentColl
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
            knowledgeNodeIds: 1,
            'managedAuthoring.selectedMindmapNodeIds': 1,
        })
        .toArray()) as ReferencingProblemDocument[];
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

async function staleOrMissing(id: ObjectId): Promise<never> {
    const exists = await nodesColl.findOne({ _id: id }, { projection: { _id: 1 } });
    if (!exists) conflict('导图节点不存在，请刷新后重试', 'node-missing');
    conflict('导图已被其他操作修改，请刷新后重试', 'stale-version');
}

function nextVersion(previous: Date): Date {
    if (!(previous instanceof Date) || Number.isNaN(previous.getTime())) throw new MindmapRequestError('节点版本无效');
    return new Date(Math.max(Date.now(), previous.getTime() + 1));
}

async function bumpTargetParent(parentId: ObjectId, expectedUpdatedAt: Date): Promise<Date> {
    const now = nextVersion(expectedUpdatedAt);
    const result = await nodesColl.updateOne({ _id: parentId, updatedAt: expectedUpdatedAt }, { $set: { updatedAt: now } });
    if (result.matchedCount !== 1) await staleOrMissing(parentId);
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
    movingNode: MindmapNode,
    newParentId: ObjectId,
    allNodes: MindmapNode[],
    subtree: Set<string>,
): Promise<void> {
    if (sameId(movingNode.parentId, newParentId)) return;
    const subtreeIds = [...subtree].map((id) => new ObjectId(id));
    const references = await findReferencingProblems(subtreeIds);
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

async function canonicalProblemIds(domainId: string, values: unknown): Promise<string[]> {
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
        .project({ docId: 1, pid: 1 })
        .toArray();

    const resolved: string[] = [];
    const missing: string[] = [];
    const ambiguous: string[] = [];
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
        const canonical = String(doc.pid || doc.docId);
        if (!resolved.includes(canonical)) resolved.push(canonical);
    }
    if (missing.length || ambiguous.length) {
        throw new MindmapRequestError(
            [missing.length ? `题目不存在或不属于当前域：${missing.join('、')}` : '', ambiguous.length ? `题号有歧义：${ambiguous.join('、')}` : '']
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

/* ─── tree access ─── */

export async function listAllNodes(): Promise<MindmapNode[]> {
    return await nodesColl.find({}).sort({ parentId: 1, order: 1, _id: 1 }).toArray();
}

export async function getNode(id: ObjectId | string): Promise<MindmapNode | null> {
    return await nodesColl.findOne({ _id: objectId(id) });
}

export async function getNodeReferenceCounts(nodes: MindmapNode[]): Promise<Record<string, number>> {
    const ids = nodes.map((node) => node._id);
    const references = await findReferencingProblems(ids);
    const byId = new Map(nodes.map((node) => [node._id.toHexString(), node]));
    const counts: Record<string, number> = {};
    for (const node of nodes) counts[node._id.toHexString()] = 0;
    for (const problem of references) {
        const affected = new Set<string>();
        for (const selectedId of referencedNodeIds(problem)) {
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
    input: MutationContext & {
        parentId: ObjectId | string;
        expectedParentUpdatedAt: Date;
        topic: unknown;
        description?: unknown;
        color?: unknown;
        tags?: unknown;
        problemIds?: unknown;
    },
): Promise<MindmapNode> {
    const parentId = objectId(input.parentId, 'parentId');
    const topic = canonicalTopic(input.topic);
    const description = canonicalDescription(input.description);
    const color = canonicalColor(input.color);
    const tags = canonicalStrings(input.tags ?? [], 'tags', 30, 80);
    const problemIds = await canonicalProblemIds(input.domainId, input.problemIds ?? []);
    const [allNodes, config] = await Promise.all([listAllNodes(), getConfig()]);
    const parent = allNodes.find((node) => sameId(node._id, parentId));
    if (!parent) conflict('父节点不存在，请刷新后重试', 'parent-missing');
    const siblings = sortNodes(allNodes.filter((node) => sameId(node.parentId, parentId)));
    const order = Number(siblings.at(-1)?.order || 0) + 10;
    const layoutSide = config.rootNodeId && sameId(config.rootNodeId, parentId) ? defaultRootSide(allNodes, parentId) : undefined;

    const parentVersion = await bumpTargetParent(parentId, input.expectedParentUpdatedAt);
    const now = new Date(Math.max(Date.now(), parentVersion.getTime()));
    const doc: MindmapNode = {
        _id: new ObjectId(),
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
        'Mindmap mutation domain=%s actor=%d node=%s operation=create fromParent=- toParent=%s fromIndex=- toIndex=%d result=success',
        input.domainId,
        input.actor,
        doc._id,
        parentId,
        siblings.length,
    );
    return doc;
}

export async function updateNode(
    input: MutationContext & {
        id: ObjectId | string;
        expectedUpdatedAt: Date;
        patch: NodePatch;
    },
): Promise<MindmapNode> {
    const id = objectId(input.id);
    const current = await nodesColl.findOne({ _id: id });
    if (!current) conflict('导图节点不存在，请刷新后重试', 'node-missing');
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
            const allNodes = await listAllNodes();
            const affectedNodeIds = [...descendantsOf(id.toHexString(), allNodes)].map((nodeId) => new ObjectId(nodeId));
            const refs = await findReferencingProblems(affectedNodeIds);
            if (refs.length) conflict('该节点已被题目引用，不能直接修改标签', 'referenced-tags-locked', refs.map(asProblemSummary));
        }
        set.tags = tags;
    }
    if (Object.hasOwn(input.patch, 'problemIds')) set.problemIds = await canonicalProblemIds(input.domainId, input.patch.problemIds);

    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length) update.$unset = unset;
    const result = await nodesColl.updateOne({ _id: id, updatedAt: input.expectedUpdatedAt }, update);
    if (result.matchedCount !== 1) await staleOrMissing(id);
    const updated = await nodesColl.findOne({ _id: id });
    if (!updated) throw new Error(`mindmap node disappeared after update node=${id}`);
    logger.info(
        'Mindmap mutation domain=%s actor=%d node=%s operation=update fromParent=- toParent=- fromIndex=- toIndex=- fields=%o result=success',
        input.domainId,
        input.actor,
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
    input: MutationContext & {
        id: ObjectId | string;
        newParentId: ObjectId | string;
        targetIndex: number;
        layoutSide?: 'left' | 'right';
        expectedUpdatedAt: Date;
        expectedParentUpdatedAt: Date;
    },
): Promise<MindmapNode> {
    const id = objectId(input.id);
    const newParentId = objectId(input.newParentId, 'newParentId');
    if (!Number.isSafeInteger(input.targetIndex) || input.targetIndex < 0) throw new MindmapRequestError('目标顺序无效');
    const [allNodes, config] = await Promise.all([listAllNodes(), getConfig()]);
    const node = allNodes.find((entry) => sameId(entry._id, id));
    const parent = allNodes.find((entry) => sameId(entry._id, newParentId));
    if (!node) conflict('导图节点不存在，请刷新后重试', 'node-missing');
    if (!parent) conflict('目标父节点不存在，请刷新后重试', 'parent-missing');
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
        await assertReparentKeepsReferencedTags(node, newParentId, allNodes, subtree);

        const order = insertionOrder(siblings, targetIndex);
        const rootChild = !!config.rootNodeId && sameId(config.rootNodeId, newParentId);
        let layoutSide: 'left' | 'right' | undefined;
        if (!rootChild && input.layoutSide !== undefined) throw new MindmapRequestError('只有根节点的直接分支可以设置左右方向');
        if (rootChild) {
            if (input.layoutSide && input.layoutSide !== 'left' && input.layoutSide !== 'right') throw new MindmapRequestError('根分支侧边无效');
            const currentSide = sameId(node.parentId, newParentId)
                ? resolveRootBranchSides(allNodes, newParentId).get(id.toHexString())
                : undefined;
            layoutSide = input.layoutSide || currentSide || defaultRootSide(allNodes, newParentId);
        }

        await bumpTargetParent(newParentId, input.expectedParentUpdatedAt);
        const now = nextVersion(input.expectedUpdatedAt);
        const set: Record<string, unknown> = { parentId: newParentId, order, updatedAt: now };
        const update: Record<string, unknown> = { $set: set };
        if (layoutSide) set.layoutSide = layoutSide;
        else update.$unset = { layoutSide: '' };
        const result = await nodesColl.updateOne({ _id: id, updatedAt: input.expectedUpdatedAt }, update);
        if (result.matchedCount !== 1) await staleOrMissing(id);
        const updated = await nodesColl.findOne({ _id: id });
        if (!updated) throw new Error(`mindmap node disappeared after move node=${id}`);
        logger.info(
            'Mindmap mutation domain=%s actor=%d node=%s operation=move fromParent=%s toParent=%s fromIndex=%d toIndex=%d side=%s result=success',
            input.domainId,
            input.actor,
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

export async function deleteNode(input: MutationContext & { id: ObjectId | string; expectedUpdatedAt: Date }): Promise<void> {
    const id = objectId(input.id);
    const [node, config] = await Promise.all([nodesColl.findOne({ _id: id }), getConfig()]);
    if (!node) conflict('导图节点不存在，请刷新后重试', 'node-missing');
    if (config.rootNodeId && sameId(config.rootNodeId, id)) conflict('根节点不能删除', 'root-delete');
    const child = await nodesColl.findOne({ parentId: id }, { projection: { _id: 1 } });
    if (child) conflict('只能删除没有子节点的叶子，请先处理其子节点', 'node-has-children');
    const refs = await findReferencingProblems([id]);
    if (refs.length) conflict('该节点仍被题目引用，不能删除', 'node-referenced', refs.map(asProblemSummary));
    const result = await nodesColl.deleteOne({ _id: id, updatedAt: input.expectedUpdatedAt });
    if (result.deletedCount !== 1) await staleOrMissing(id);
    logger.info(
        'Mindmap mutation domain=%s actor=%d node=%s operation=delete fromParent=%s toParent=- fromIndex=- toIndex=- result=success',
        input.domainId,
        input.actor,
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
    sources: Array<'tag' | 'manual'>;
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
    nodeId: ObjectId | string,
    scope: Filter<any>,
    options: { includeHidden?: boolean } = {},
): Promise<PanelProblem[]> {
    const node = await getNode(nodeId);
    if (!node) throw new MindmapRequestError('导图节点不存在');
    const orClauses: any[] = [];
    if (node.tags?.length) orClauses.push({ tag: { $in: node.tags } });
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
                    ...(options.includeHidden ? {} : { hidden: { $ne: true } }),
                    $or: orClauses,
                },
            ],
        })
        .project({ domainId: 1, pid: 1, docId: 1, title: 1, hidden: 1, tag: 1, nSubmit: 1, nAccept: 1 })
        .limit(500)
        .toArray();
    const tagSet = new Set(node.tags || []);
    const manualSet = new Set(node.problemIds || []);
    return docs.map((doc: any) => {
        const pid = String(doc.pid || doc.docId);
        const sources: Array<'tag' | 'manual'> = [];
        if (Array.isArray(doc.tag) && doc.tag.some((tag: unknown) => typeof tag === 'string' && tagSet.has(tag))) sources.push('tag');
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

export async function searchProblemsForAdmin(domainId: string, query: unknown): Promise<ProblemSummary[]> {
    if (typeof query !== 'string') throw new MindmapRequestError('搜索关键词无效');
    const q = query.trim();
    if (!q) return [];
    if (q.length > 80) throw new MindmapRequestError('搜索关键词不能超过 80 个字符');
    const regex = new RegExp(escapeRegExp(q), 'i');
    const numeric = Number(q);
    const clauses: Record<string, unknown>[] = [{ pid: regex }, { title: regex }];
    if (Number.isSafeInteger(numeric)) clauses.unshift({ docId: numeric });
    const docs = await documentColl
        .find({ domainId, docType: HYDRO_PROBLEM_DOCTYPE, $or: clauses })
        .project({ domainId: 1, docId: 1, pid: 1, title: 1, hidden: 1 })
        .limit(20)
        .toArray();
    return docs.map(asProblemSummary).sort((left, right) => left.pid.localeCompare(right.pid, 'zh-CN', { numeric: true }));
}

export { getConfig };
