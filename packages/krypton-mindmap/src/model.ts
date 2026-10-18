import { createRequire } from 'node:module';
import { Logger } from '@hydrooj/utils';
import type { Filter } from 'mongodb';
import { localizedErrorText, ObjectId, PRIV, PrivilegeError, db } from 'hydrooj';
import type { LocalizedErrorText } from 'hydrooj';
import type { MindmapActor } from './course-nodes';
import { getMergedMap, mapsColl, nodesColl } from './db';
import { MindmapConflictError, MindmapRequestError } from './error';
import type { KnowledgeMapDoc, MindmapMaterializeOptions, MindmapMaterializeResult, MindmapNode, MindmapPathVersion } from './types';

export type { MindmapActor };

declare const __filename: string;

const nodeRequire = createRequire(__filename);

interface CourseNodeAccess {
    courseNodeOf(nodeId: ObjectId | string): Promise<{ id: string; ownerUids: number[] } | null>;
    canEditCourseSubtree(actor: MindmapActor, course: { id: string; ownerUids: number[] }): boolean;
}

/** Loaded on use so importing model.ts does not pull course-nodes' hydrooj import. */
function courseNodeAccess(): CourseNodeAccess {
    return nodeRequire('./course-nodes') as CourseNodeAccess;
}

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
    actor: MindmapActor;
}

interface NodeMutationContext extends MutationContext {
    mapId: ObjectId | string;
    expectedMapUpdatedAt: Date;
}

const DOC_ID_TEXT = /^[1-9]\d*$/;
const NODE_PATCH_KEYS = ['topic', 'description', 'color', 'tags', 'problemIds'];
const REJECTED_NODE_PATCH_KEYS = ['coursePins', 'courseVisibility', 'ownerUids'];

function objectId(value: ObjectId | string, field = 'nodeId'): ObjectId {
    if (value instanceof ObjectId) return value;
    if (!ObjectId.isValid(value)) throw new MindmapRequestError(localizedErrorText`${field} 无效`);
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
    if (!Array.isArray(values)) throw new MindmapRequestError(localizedErrorText`${field} 必须是数组`);
    if (values.length > limit) throw new MindmapRequestError(localizedErrorText`${field} 最多允许 ${limit} 项`);
    const result: string[] = [];
    for (const value of values) {
        if (typeof value !== 'string') throw new MindmapRequestError(localizedErrorText`${field} 包含非字符串值`);
        const normalized = value.trim();
        if (!normalized) continue;
        if (normalized.length > itemLimit) throw new MindmapRequestError(localizedErrorText`${field} 单项过长`);
        if (!result.includes(normalized)) result.push(normalized);
    }
    return result;
}

function canonicalTopic(value: unknown): string {
    if (typeof value !== 'string') throw new MindmapRequestError(localizedErrorText`节点名称必填`);
    const topic = value.trim();
    if (!topic) throw new MindmapRequestError(localizedErrorText`节点名称不能为空`);
    if (topic.length > 100) throw new MindmapRequestError(localizedErrorText`节点名称不能超过 100 个字符`);
    return topic;
}

function canonicalMapTitle(value: unknown): string {
    if (typeof value !== 'string') throw new MindmapRequestError(localizedErrorText`导图名称必填`);
    const title = value.trim();
    if (!title) throw new MindmapRequestError(localizedErrorText`导图名称不能为空`);
    if (title.length > 100) throw new MindmapRequestError(localizedErrorText`导图名称不能超过 100 个字符`);
    return title;
}

function canonicalDescription(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') throw new MindmapRequestError(localizedErrorText`节点说明格式无效`);
    const description = value.trim();
    if (!description) return undefined;
    if (description.length > 2000) throw new MindmapRequestError(localizedErrorText`节点说明不能超过 2000 个字符`);
    return description;
}

function canonicalColor(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string' || !ALLOWED_COLORS.has(value)) throw new MindmapRequestError(localizedErrorText`节点颜色无效`);
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

function conflict(message: LocalizedErrorText, reason: string, problems: ProblemSummary[] = []): never {
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
    if (!exists) conflict(localizedErrorText`导图节点不存在，请刷新后重试`, 'node-missing');
    if (!sameId(exists.mapId, mapId)) conflict(localizedErrorText`节点属于另一张导图，请刷新后重试`, 'cross-map-node');
    conflict(localizedErrorText`导图已被其他操作修改，请刷新后重试`, 'stale-version');
}

async function staleOrMissingMap(id: ObjectId): Promise<never> {
    const exists = await mapsColl.findOne({ _id: id }, { projection: { _id: 1 } });
    if (!exists) conflict(localizedErrorText`导图不存在，请刷新后重试`, 'map-missing');
    conflict(localizedErrorText`导图已被其他操作修改，请刷新后重试`, 'stale-map-version');
}

function nextVersion(previous: Date): Date {
    if (!(previous instanceof Date) || Number.isNaN(previous.getTime())) throw new MindmapRequestError(localizedErrorText`节点版本无效`);
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
        if (found.has(current)) conflict(localizedErrorText`当前导图已经存在环，拒绝继续修改`, 'existing-cycle');
        found.add(current);
        queue.push(...(children.get(current) || []));
    }
    return found;
}

/** Reference-protection union: zh-CN sort, untagged selections allowed, no root gate. Problem writes use materialize(). */
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
        conflict(localizedErrorText`移动会改变已引用题目的继承标签，请先执行单独的标签迁移`, 'inherited-tags-change', affected);
    }
}

interface IncludedProblemDocument {
    domainId: string;
    docId: number;
    archivedAt?: Date;
}

function canonicalDocIdList(values: unknown): string[] {
    if (!Array.isArray(values)) throw new MindmapRequestError(localizedErrorText`收录题必须是数组`);
    if (values.length > 200) throw new MindmapRequestError(localizedErrorText`一个节点最多收录 200 道题`);
    const requested: string[] = [];
    for (const value of values) {
        if (typeof value !== 'string' || !DOC_ID_TEXT.test(value)) throw new MindmapRequestError(localizedErrorText`收录题必须是正整数 docId`);
        const docId = Number(value);
        if (!Number.isSafeInteger(docId)) throw new MindmapRequestError(localizedErrorText`收录题必须是正整数 docId`);
        if (!requested.includes(value)) requested.push(value);
    }
    return requested;
}

function includedDocIds(node: MindmapNode): number[] {
    if (!Array.isArray(node.problemIds)) throw new Error(`mindmap problemIds corrupt node=${node._id}`);
    const ids: number[] = [];
    for (const raw of node.problemIds) {
        if (typeof raw !== 'string' || !DOC_ID_TEXT.test(raw)) throw new Error(`mindmap problemIds corrupt node=${node._id}`);
        const docId = Number(raw);
        if (!Number.isSafeInteger(docId)) throw new Error(`mindmap problemIds corrupt node=${node._id}`);
        if (!ids.includes(docId)) ids.push(docId);
    }
    return ids;
}

async function loadIncludedProblems(domainId: string | undefined, docIds: number[]): Promise<Map<number, IncludedProblemDocument>> {
    if (!docIds.length) return new Map();
    const filter: Record<string, unknown> = { docType: HYDRO_PROBLEM_DOCTYPE, docId: { $in: docIds } };
    if (domainId) filter.domainId = domainId;
    const docs = (await documentColl.find(filter).project({ domainId: 1, docId: 1, archivedAt: 1 }).toArray()) as IncludedProblemDocument[];
    const byDocId = new Map<number, IncludedProblemDocument>();
    for (const doc of docs) {
        const previous = byDocId.get(doc.docId);
        if (previous && previous.domainId !== doc.domainId) {
            throw new Error(`mindmap included problem docId collision docId=${doc.docId}`);
        }
        byDocId.set(doc.docId, doc);
    }
    return byDocId;
}

/** Included problems are decimal docId strings. The problem must exist in the domain and be unarchived. */
async function canonicalIncludedProblemIds(domainId: string, values: unknown): Promise<string[]> {
    const requested = canonicalDocIdList(values);
    if (!requested.length) return [];
    const byDocId = await loadIncludedProblems(
        domainId,
        requested.map((value) => Number(value)),
    );
    const missing: string[] = [];
    const archived: string[] = [];
    const resolved: string[] = [];
    for (const input of requested) {
        const doc = byDocId.get(Number(input));
        if (!doc) {
            missing.push(input);
            continue;
        }
        if (doc.archivedAt) {
            archived.push(input);
            continue;
        }
        resolved.push(String(doc.docId));
    }
    if (missing.length || archived.length) {
        const detail = [missing.length ? `题目不存在：${missing.join('、')}` : '', archived.length ? `题目已归档：${archived.join('、')}` : '']
            .filter(Boolean)
            .join('；');
        throw new MindmapRequestError(localizedErrorText`${detail}`);
    }
    return resolved;
}

function requireAdmin(actor: MindmapActor): void {
    if (!actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) throw new PrivilegeError(PRIV.PRIV_EDIT_SYSTEM);
}

function isMergedRoot(map: KnowledgeMapDoc, node: { _id: ObjectId; parentId: ObjectId | null }): boolean {
    return node.parentId === null || sameId(node._id, map.rootNodeId);
}

function isCourseNode(map: KnowledgeMapDoc, node: { parentId: ObjectId | null }): boolean {
    return sameId(node.parentId, map.rootNodeId);
}

async function requireSubtreeEditor(actor: MindmapActor, nodeId: ObjectId): Promise<void> {
    const access = courseNodeAccess();
    const course = await access.courseNodeOf(nodeId);
    if (!course || !access.canEditCourseSubtree(actor, course)) throw new PrivilegeError(PRIV.PRIV_EDIT_SYSTEM);
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
    void includeHidden;
    return [await getMergedMap()];
}

export async function getKnowledgeMap(id: ObjectId | string): Promise<KnowledgeMapDoc | null> {
    const map = await getMergedMap();
    const mapId = objectId(id, 'mapId');
    if (!sameId(map._id, mapId)) return null;
    return map;
}

export async function getPublicKnowledgeMap(id: ObjectId | string): Promise<KnowledgeMapDoc | null> {
    return await getKnowledgeMap(id);
}

export async function getPublicKnowledgeMapSnapshot(id: ObjectId | string): Promise<{ config: KnowledgeMapDoc; nodes: MindmapNode[] } | null> {
    const map = await getMergedMap();
    const mapId = objectId(id, 'mapId');
    if (!sameId(map._id, mapId)) return null;
    const nodes = await nodesColl.find({ mapId: map._id }).sort({ parentId: 1, order: 1, _id: 1 }).toArray();
    assertMapTree(map, nodes);
    const hidden = new Set<string>();
    for (const node of nodes) {
        if (!sameId(node.parentId, map.rootNodeId) || node.courseVisibility === 'public') continue;
        for (const descendant of descendantsOf(node._id.toHexString(), nodes)) hidden.add(descendant);
    }
    return { config: map, nodes: nodes.filter((node) => !hidden.has(node._id.toHexString())) };
}

export async function getKnowledgeMapUsage(id: ObjectId | string): Promise<KnowledgeMapUsage> {
    const map = await getMergedMap();
    const mapId = objectId(id, 'mapId');
    if (!sameId(map._id, mapId)) conflict(localizedErrorText`导图不存在，请刷新后重试`, 'map-missing');
    const courseNodes = await nodesColl.find({ mapId: map._id, parentId: map.rootNodeId }).project({ _id: 1 }).toArray();
    const [nodeCount, problemCount, courseCount] = await Promise.all([
        nodesColl.countDocuments({ mapId: map._id }),
        documentColl.countDocuments({ docType: HYDRO_PROBLEM_DOCTYPE, knowledgeMapId: map._id }),
        courseNodes.length
            ? documentColl.countDocuments({
                  docType: 40,
                  kind: 'course',
                  knowledgeCourseNodeId: { $in: courseNodes.map((node) => node._id) },
              })
            : 0,
    ]);
    return { nodes: nodeCount, problems: problemCount, courses: courseCount };
}

export async function updateKnowledgeMap(
    input: MutationContext & {
        id: ObjectId | string;
        expectedUpdatedAt: Date;
        patch: Record<string, unknown>;
    },
): Promise<KnowledgeMapDoc> {
    const map = await getMergedMap();
    requireAdmin(input.actor);
    const mapId = objectId(input.id, 'mapId');
    if (!sameId(map._id, mapId)) conflict(localizedErrorText`导图不存在，请刷新后重试`, 'map-missing');
    const keys = Object.keys(input.patch);
    if (!keys.length) throw new MindmapRequestError(localizedErrorText`没有可保存的导图字段`);
    if (keys.some((key) => key !== 'title' && key !== 'layoutDirection')) {
        throw new MindmapRequestError(localizedErrorText`知识图谱只能修改名称和布局方向`);
    }
    const set: Record<string, unknown> = { updatedAt: nextVersion(input.expectedUpdatedAt) };
    if (Object.hasOwn(input.patch, 'title')) set.title = canonicalMapTitle(input.patch.title);
    if (Object.hasOwn(input.patch, 'layoutDirection')) {
        if (input.patch.layoutDirection !== 'RIGHT' && input.patch.layoutDirection !== 'DOWN') {
            throw new MindmapRequestError(localizedErrorText`导图布局方向无效`);
        }
        set.layoutDirection = input.patch.layoutDirection;
    }
    const result = await mapsColl.updateOne({ _id: mapId, updatedAt: input.expectedUpdatedAt }, { $set: set });
    if (result.matchedCount !== 1) await staleOrMissingMap(mapId);
    const updated = await mapsColl.findOne({ _id: mapId });
    if (!updated) throw new Error(`mindmap disappeared after update map=${mapId}`);
    logger.info(
        'Mindmap map mutation domain=%s actor=%d map=%s operation=update fields=%o result=success',
        input.domainId,
        input.actor._id,
        String(mapId),
        keys,
    );
    return updated;
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

/* ─── tree access ─── */

export async function listAllNodes(mapId: ObjectId | string): Promise<MindmapNode[]> {
    const map = await getMergedMap();
    const id = objectId(mapId, 'mapId');
    if (!sameId(map._id, id)) conflict(localizedErrorText`导图不存在，请刷新后重试`, 'map-missing');
    return await nodesColl.find({ mapId: id }).sort({ parentId: 1, order: 1, _id: 1 }).toArray();
}

export async function getNode(mapId: ObjectId | string, id: ObjectId | string): Promise<MindmapNode | null> {
    const map = await getMergedMap();
    const scopedMapId = objectId(mapId, 'mapId');
    if (!sameId(map._id, scopedMapId)) return null;
    return await nodesColl.findOne({ _id: objectId(id), mapId: scopedMapId });
}

function normalizeMaterializeMapId(value: unknown): ObjectId {
    const normalized = value instanceof ObjectId ? value.toHexString() : typeof value === 'string' ? value.trim() : '';
    if (!normalized || !ObjectId.isValid(normalized)) throw new MindmapRequestError(localizedErrorText`${'knowledgeMapId'} 无效`);
    return new ObjectId(normalized);
}

function normalizeMaterializeNodeIds(nodeIds: unknown, required: boolean, field: 'knowledgeNodeIds' | 'mindmapNodeIds'): string[] {
    if (!Array.isArray(nodeIds)) throw new MindmapRequestError(localizedErrorText`${field} 无效`);
    const normalized = nodeIds.map((value) => {
        if (value instanceof ObjectId) return value.toHexString();
        if (typeof value !== 'string') throw new MindmapRequestError(localizedErrorText`${field} 无效`);
        const trimmed = value.trim();
        if (!trimmed || !ObjectId.isValid(trimmed)) throw new MindmapRequestError(localizedErrorText`${field} 无效`);
        return new ObjectId(trimmed).toHexString();
    });
    if (!normalized.length) {
        if (required) throw new MindmapRequestError(localizedErrorText`${field} 无效`);
        return [];
    }
    return [...new Set(normalized)].sort();
}

function buildMaterializePath(node: MindmapNode, byId: Map<string, MindmapNode>, expectedRootNodeId: ObjectId): MindmapNode[] {
    const path: MindmapNode[] = [];
    const visited = new Set<string>();
    let current: MindmapNode | undefined = node;
    while (current) {
        const id = current._id.toHexString();
        if (visited.has(id)) conflict(localizedErrorText`导图存在循环`, 'existing-cycle');
        visited.add(id);
        path.push(current);
        if (!current.parentId) break;
        current = byId.get(current.parentId.toHexString());
        if (!current) conflict(localizedErrorText`导图祖先节点已删除`, 'ancestor-missing');
    }
    path.reverse();
    if (!path[0] || !sameId(path[0]._id, expectedRootNodeId) || path[0].parentId !== null) {
        conflict(localizedErrorText`导图节点不属于该图的唯一根节点`, 'root-mismatch');
    }
    return path;
}

/**
 * Production db always exports getMergedMap, which fail-closes until the graph is merged.
 * The managed-problem authoring test stubs db.ts with only the collections, so that path
 * still resolves the requested map by id.
 */
async function mapForMaterialize(mapId: ObjectId): Promise<KnowledgeMapDoc> {
    if (typeof getMergedMap === 'function') {
        const map = await getMergedMap();
        if (!sameId(map._id, mapId)) conflict(localizedErrorText`所属导图已删除`, 'map-missing');
        return map;
    }
    const map = await mapsColl.findOne({ _id: mapId });
    if (!map) conflict(localizedErrorText`所属导图已删除`, 'map-missing');
    return map;
}

/**
 * Problem-write materialization: required mapId, selected nodes must belong to that
 * map and carry their own tags, paths must terminate at the map root, and tags stay
 * in first-seen insertion order. Does not apply tagsForSelection's zh-CN sort or the
 * hydrooj sole-public-map fallback.
 */
export async function materialize(
    mapIdInput: unknown,
    nodeIdsInput: unknown,
    options: MindmapMaterializeOptions = {},
): Promise<MindmapMaterializeResult> {
    const field = options.field === 'mindmapNodeIds' ? 'mindmapNodeIds' : 'knowledgeNodeIds';
    const mapId = normalizeMaterializeMapId(mapIdInput);
    const map = await mapForMaterialize(mapId);
    const nodeIds = normalizeMaterializeNodeIds(nodeIdsInput, options.required === true, field);
    const nodes = await nodesColl.find({ mapId: map._id }).sort({ parentId: 1, order: 1, _id: 1 }).toArray();
    const byId = new Map(nodes.map((node) => [node._id.toHexString(), node]));
    if (nodeIds.length && nodeIds.some((id) => !byId.has(id))) {
        conflict(localizedErrorText`所选知识节点已删除或不属于指定导图`, 'selection-not-in-map');
    }
    if (options.requirePublicMap && map.visibility !== 'public') {
        conflict(localizedErrorText`所属导图当前不可用于题目归类`, 'map-not-public');
    }
    const tags: string[] = [];
    const nodePaths: Array<{ id: string; label: string }> = [];
    const pathVersion = new Map<string, MindmapPathVersion>();
    for (const id of nodeIds) {
        const node = byId.get(id);
        if (!node || !Array.isArray(node.tags) || !node.tags.some((tag) => typeof tag === 'string' && tag.trim())) {
            conflict(localizedErrorText`导图节点 ${id} 已删除或不可选`, 'node-not-selectable');
        }
        const nodePath = buildMaterializePath(node, byId, map.rootNodeId);
        const labeled = nodePath.filter((part, index) => index !== 0 || !sameId(part._id, map.rootNodeId));
        nodePaths.push({ id, label: labeled.map((part) => part.topic).join(' / ') });
        for (const pathNode of nodePath) {
            if (options.includePathVersion) {
                if (!(pathNode.updatedAt instanceof Date) || Number.isNaN(pathNode.updatedAt.getTime())) {
                    throw new TypeError(`mindmap node ${pathNode._id.toHexString()} updatedAt must be a valid date`);
                }
                const pathNodeId = pathNode._id.toHexString();
                pathVersion.set(pathNodeId, {
                    id: pathNodeId,
                    parentId: pathNode.parentId?.toHexString() || null,
                    topic: pathNode.topic,
                    updatedAt: pathNode.updatedAt.toISOString(),
                });
            }
            for (const tag of Array.isArray(pathNode.tags) ? pathNode.tags : []) {
                const normalized = typeof tag === 'string' ? tag.trim() : '';
                if (normalized && !tags.includes(normalized)) tags.push(normalized);
            }
        }
    }
    return {
        mapId,
        mapTitle: map.title,
        nodeIds: nodeIds.map((id) => new ObjectId(id)),
        nodePaths,
        tags,
        ...(options.includePathVersion ? { pathVersion: [...pathVersion.values()].sort((left, right) => left.id.localeCompare(right.id)) } : {}),
    };
}

export async function getNodeReferenceCounts(mapIdValue: ObjectId | string, nodes: MindmapNode[]): Promise<Record<string, number>> {
    const map = await getMergedMap();
    const mapId = objectId(mapIdValue, 'mapId');
    if (!sameId(map._id, mapId)) throw new Error(`mindmap reference count received another map map=${mapId}`);
    if (nodes.some((node) => !sameId(node.mapId, mapId))) throw new Error(`mindmap reference count received mixed maps map=${mapId}`);
    const ids = nodes.map((node) => node._id);
    const references = await findReferencingProblems(mapId, ids);
    const byId = new Map(nodes.map((node) => [node._id.toHexString(), node]));
    const counts: Record<string, number> = {};
    for (const node of nodes) counts[node._id.toHexString()] = 0;
    const direct = new Map<string, Set<string>>();
    const addHit = (key: string, nodeId: string) => {
        const hits = direct.get(key) ?? new Set<string>();
        hits.add(nodeId);
        direct.set(key, hits);
    };
    for (const problem of references) {
        const key = `${problem.domainId}:${problem.docId}`;
        for (const selectedId of referencedNodeIds(problem)) {
            if (!byId.has(selectedId)) {
                throw new Error(
                    `mindmap problem references a node outside its map domain=${problem.domainId} docId=${problem.docId} map=${mapId} node=${selectedId}`,
                );
            }
            addHit(key, selectedId);
        }
    }
    const pinnedIds: number[] = [];
    for (const node of nodes) {
        for (const docId of includedDocIds(node)) {
            if (!pinnedIds.includes(docId)) pinnedIds.push(docId);
        }
    }
    const pinned = await loadIncludedProblems(undefined, pinnedIds);
    for (const node of nodes) {
        for (const docId of includedDocIds(node)) {
            const problem = pinned.get(docId);
            if (!problem) throw new Error(`mindmap included problem missing node=${node._id} docId=${docId}`);
            addHit(`${problem.domainId}:${problem.docId}`, node._id.toHexString());
        }
    }
    for (const hits of direct.values()) {
        const affected = new Set<string>();
        for (const selectedId of hits) {
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
    const map = await getMergedMap();
    const mapId = objectId(input.mapId, 'mapId');
    if (!sameId(map._id, mapId)) conflict(localizedErrorText`导图不存在，请刷新后重试`, 'map-missing');
    const parentId = objectId(input.parentId, 'parentId');
    const topic = canonicalTopic(input.topic);
    const description = canonicalDescription(input.description);
    const color = canonicalColor(input.color);
    const tags = canonicalStrings(input.tags ?? [], 'tags', 30, 80);
    const problemIds = await canonicalIncludedProblemIds(input.domainId, input.problemIds ?? []);
    const allNodes = await nodesColl.find({ mapId }).sort({ parentId: 1, order: 1, _id: 1 }).toArray();
    const parent = allNodes.find((node) => sameId(node._id, parentId));
    if (!parent) {
        const crossMapParent = await nodesColl.findOne({ _id: parentId }, { projection: { mapId: 1 } });
        conflict(
            crossMapParent ? localizedErrorText`不能把节点添加到另一张导图` : localizedErrorText`父节点不存在，请刷新后重试`,
            crossMapParent ? 'cross-map-parent' : 'parent-missing',
        );
    }
    if (isMergedRoot(map, parent)) requireAdmin(input.actor);
    else await requireSubtreeEditor(input.actor, parent._id);
    const creatingCourseNode = isMergedRoot(map, parent);
    const siblings = sortNodes(allNodes.filter((node) => sameId(node.parentId, parentId)));
    const order = Number(siblings.at(-1)?.order || 0) + 10;
    const layoutSide = creatingCourseNode ? defaultRootSide(allNodes, parentId) : undefined;

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
        ...(creatingCourseNode ? { courseVisibility: 'hidden' as const, ownerUids: [] } : {}),
        order,
        createdAt: now,
        updatedAt: now,
    };
    await nodesColl.insertOne(doc);
    logger.info(
        'Mindmap mutation domain=%s actor=%d map=%s node=%s operation=create fromParent=- toParent=%s fromIndex=- toIndex=%d result=success',
        input.domainId,
        input.actor._id,
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
        patch: Record<string, unknown>;
    },
): Promise<MindmapNode> {
    const map = await getMergedMap();
    const mapId = objectId(input.mapId, 'mapId');
    if (!sameId(map._id, mapId)) conflict(localizedErrorText`导图不存在，请刷新后重试`, 'map-missing');
    const id = objectId(input.id);
    const current = await nodesColl.findOne({ _id: id, mapId });
    if (!current) {
        const crossMapNode = await nodesColl.findOne({ _id: id }, { projection: { mapId: 1 } });
        conflict(
            crossMapNode ? localizedErrorText`不能编辑另一张导图的节点` : localizedErrorText`导图节点不存在，请刷新后重试`,
            crossMapNode ? 'cross-map-node' : 'node-missing',
        );
    }
    const keys = Object.keys(input.patch);
    if (!keys.length) throw new MindmapRequestError(localizedErrorText`没有可保存的字段`);
    if (keys.some((key) => REJECTED_NODE_PATCH_KEYS.includes(key))) {
        throw new MindmapRequestError(localizedErrorText`课程节点的公开状态、负责教师和已废止的课程钉选不能在这里修改`);
    }
    if (keys.some((key) => !NODE_PATCH_KEYS.includes(key))) {
        throw new MindmapRequestError(localizedErrorText`请求包含不可编辑的节点字段`);
    }
    if (isMergedRoot(map, current)) {
        requireAdmin(input.actor);
        if (keys.some((key) => key !== 'topic')) throw new MindmapRequestError(localizedErrorText`总根只能修改标题`);
    } else if (isCourseNode(map, current) && keys.includes('topic')) {
        requireAdmin(input.actor);
    } else {
        await requireSubtreeEditor(input.actor, current._id);
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
            if (refs.length) {
                conflict(localizedErrorText`该节点已被题目引用，不能直接修改标签`, 'referenced-tags-locked', refs.map(asProblemSummary));
            }
        }
        set.tags = tags;
    }
    if (Object.hasOwn(input.patch, 'problemIds')) set.problemIds = await canonicalIncludedProblemIds(input.domainId, input.patch.problemIds);

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
        input.actor._id,
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
    conflict(localizedErrorText`同级顺序已无法继续细分，请调整到其它落点后重试`, 'order-space-exhausted');
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
    const map = await getMergedMap();
    const mapId = objectId(input.mapId, 'mapId');
    if (!sameId(map._id, mapId)) conflict(localizedErrorText`导图不存在，请刷新后重试`, 'map-missing');
    const id = objectId(input.id);
    const newParentId = objectId(input.newParentId, 'newParentId');
    if (!Number.isSafeInteger(input.targetIndex) || input.targetIndex < 0) throw new MindmapRequestError(localizedErrorText`目标顺序无效`);
    const allNodes = await nodesColl.find({ mapId }).sort({ parentId: 1, order: 1, _id: 1 }).toArray();
    const config = map;
    const node = allNodes.find((entry) => sameId(entry._id, id));
    const parent = allNodes.find((entry) => sameId(entry._id, newParentId));
    if (!node) {
        const crossMapNode = await nodesColl.findOne({ _id: id }, { projection: { mapId: 1 } });
        conflict(
            crossMapNode ? localizedErrorText`不能移动另一张导图的节点` : localizedErrorText`导图节点不存在，请刷新后重试`,
            crossMapNode ? 'cross-map-node' : 'node-missing',
        );
    }
    if (!parent) {
        const crossMapParent = await nodesColl.findOne({ _id: newParentId }, { projection: { mapId: 1 } });
        conflict(
            crossMapParent ? localizedErrorText`不能把节点移动到另一张导图` : localizedErrorText`目标父节点不存在，请刷新后重试`,
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
        if (config.rootNodeId && sameId(config.rootNodeId, id)) conflict(localizedErrorText`根节点不能移动`, 'root-move');
        if (sameId(id, newParentId)) conflict(localizedErrorText`节点不能成为自己的父节点`, 'self-parent');
        const movingCourseNode = isCourseNode(map, node);
        const intoCourseSlot = isMergedRoot(map, parent);
        if (movingCourseNode || intoCourseSlot) requireAdmin(input.actor);
        else {
            const access = courseNodeAccess();
            const source = await access.courseNodeOf(node._id);
            const destination = await access.courseNodeOf(newParentId);
            if (!source || !destination) throw new MindmapRequestError(localizedErrorText`知识图谱节点不在总根下面`);
            if (source.id !== destination.id) requireAdmin(input.actor);
            else if (!access.canEditCourseSubtree(input.actor, source)) throw new PrivilegeError(PRIV.PRIV_EDIT_SYSTEM);
        }
        const subtree = descendantsOf(id.toHexString(), allNodes);
        if (subtree.has(newParentId.toHexString())) conflict(localizedErrorText`节点不能移动到自己的后代中`, 'descendant-parent');
        await assertReparentKeepsReferencedTags(mapId, node, newParentId, allNodes, subtree);

        const order = insertionOrder(siblings, targetIndex);
        const rootChild = !!config.rootNodeId && sameId(config.rootNodeId, newParentId);
        let layoutSide: 'left' | 'right' | undefined;
        if (!rootChild && input.layoutSide !== undefined) throw new MindmapRequestError(localizedErrorText`只有根节点的直接分支可以设置左右方向`);
        if (rootChild) {
            if (input.layoutSide && input.layoutSide !== 'left' && input.layoutSide !== 'right') {
                throw new MindmapRequestError(localizedErrorText`根分支侧边无效`);
            }
            const currentSide = sameId(node.parentId, newParentId) ? resolveRootBranchSides(allNodes, newParentId).get(id.toHexString()) : undefined;
            layoutSide = input.layoutSide || currentSide || defaultRootSide(allNodes, newParentId);
        }

        if (movingCourseNode && !intoCourseSlot) {
            const bound = await documentColl.findOne({ docType: 40, kind: 'course', knowledgeCourseNodeId: id });
            if (bound) conflict(localizedErrorText`该课程节点仍被课程绑定，不能移出总根`, 'course-node-bound');
        }

        await bumpMapVersion(mapId, input.expectedMapUpdatedAt);
        await bumpTargetParent(mapId, newParentId, input.expectedParentUpdatedAt);
        const now = nextVersion(input.expectedUpdatedAt);
        const set: Record<string, unknown> = { parentId: newParentId, order, updatedAt: now };
        const unset: Record<string, ''> = {};
        if (layoutSide) set.layoutSide = layoutSide;
        else unset.layoutSide = '';
        if (intoCourseSlot && !movingCourseNode) {
            set.courseVisibility = 'hidden';
            set.ownerUids = [];
        }
        if (movingCourseNode && !intoCourseSlot) {
            unset.courseVisibility = '';
            unset.ownerUids = '';
        }
        const update: Record<string, unknown> = { $set: set };
        if (Object.keys(unset).length) update.$unset = unset;
        const result = await nodesColl.updateOne({ _id: id, mapId, updatedAt: input.expectedUpdatedAt }, update);
        if (result.matchedCount !== 1) await staleOrMissing(mapId, id);
        const updated = await nodesColl.findOne({ _id: id, mapId });
        if (!updated) throw new Error(`mindmap node disappeared after move node=${id}`);
        logger.info(
            'Mindmap mutation domain=%s actor=%d map=%s node=%s operation=move fromParent=%s toParent=%s fromIndex=%d toIndex=%d side=%s result=success',
            input.domainId,
            input.actor._id,
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
    const map = await getMergedMap();
    const mapId = objectId(input.mapId, 'mapId');
    if (!sameId(map._id, mapId)) conflict(localizedErrorText`导图不存在，请刷新后重试`, 'map-missing');
    const id = objectId(input.id);
    const node = await nodesColl.findOne({ _id: id, mapId });
    const config = map;
    if (!node) {
        const crossMapNode = await nodesColl.findOne({ _id: id }, { projection: { mapId: 1 } });
        conflict(
            crossMapNode ? localizedErrorText`不能删除另一张导图的节点` : localizedErrorText`导图节点不存在，请刷新后重试`,
            crossMapNode ? 'cross-map-node' : 'node-missing',
        );
    }
    if (config.rootNodeId && sameId(config.rootNodeId, id)) conflict(localizedErrorText`根节点不能删除`, 'root-delete');
    if (isCourseNode(map, node)) requireAdmin(input.actor);
    else await requireSubtreeEditor(input.actor, node._id);
    const child = await nodesColl.findOne({ mapId, parentId: id }, { projection: { _id: 1 } });
    if (child) conflict(localizedErrorText`只能删除没有子节点的叶子，请先处理其子节点`, 'node-has-children');
    if (isCourseNode(map, node)) {
        const bound = await documentColl.findOne({ docType: 40, kind: 'course', knowledgeCourseNodeId: id });
        if (bound) conflict(localizedErrorText`该课程节点仍被课程绑定，不能删除`, 'course-node-bound');
    }
    const refs = await findReferencingProblems(mapId, [id]);
    if (refs.length) conflict(localizedErrorText`该节点仍被题目引用，不能删除`, 'node-referenced', refs.map(asProblemSummary));
    await bumpMapVersion(mapId, input.expectedMapUpdatedAt);
    const result = await nodesColl.deleteOne({ _id: id, mapId, updatedAt: input.expectedUpdatedAt });
    if (result.deletedCount !== 1) await staleOrMissing(mapId, id);
    logger.info(
        'Mindmap mutation domain=%s actor=%d map=%s node=%s operation=delete fromParent=%s toParent=- fromIndex=- toIndex=- result=success',
        input.domainId,
        input.actor._id,
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
    const map = await getMergedMap();
    const mapId = objectId(mapIdValue, 'mapId');
    if (!sameId(map._id, mapId)) conflict(localizedErrorText`导图不存在，请刷新后重试`, 'map-missing');
    const node = await nodesColl.findOne({ _id: objectId(nodeId), mapId });
    if (!node) throw new MindmapRequestError(localizedErrorText`导图节点不存在`);
    const allNodes = await nodesColl.find({ mapId }).sort({ parentId: 1, order: 1, _id: 1 }).toArray();
    const subtree = descendantsOf(node._id.toHexString(), allNodes);
    const subtreeIds = [...subtree].map((id) => new ObjectId(id));
    const manualDocIds: number[] = [];
    for (const candidate of allNodes) {
        if (!subtree.has(candidate._id.toHexString())) continue;
        for (const docId of includedDocIds(candidate)) {
            if (!manualDocIds.includes(docId)) manualDocIds.push(docId);
        }
    }
    const visible = options.includeHidden ? {} : { hidden: { $ne: true } };
    const orClauses: Array<Record<string, unknown>> = [
        {
            docType: HYDRO_PROBLEM_DOCTYPE,
            domainId,
            knowledgeMapId: mapId,
            ...visible,
            $or: [{ knowledgeNodeIds: { $in: subtreeIds } }, { 'managedAuthoring.selectedMindmapNodeIds': { $in: subtreeIds } }],
        },
    ];
    if (manualDocIds.length) {
        orClauses.push({
            docType: HYDRO_PROBLEM_DOCTYPE,
            domainId,
            ...visible,
            docId: { $in: manualDocIds },
        });
    }
    const docs = await documentColl
        .find({
            $and: [scope, { $or: orClauses }],
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
        .toArray();
    const manualSet = new Set(manualDocIds.map(String));
    return docs.map((doc: any) => {
        const sources: Array<'canonical' | 'manual'> = [];
        if (referencedNodeIds(doc).some((id) => subtree.has(id))) sources.push('canonical');
        if (manualSet.has(String(doc.docId))) sources.push('manual');
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
    const map = await getMergedMap();
    const mapId = objectId(mapIdValue, 'mapId');
    if (!sameId(map._id, mapId)) conflict(localizedErrorText`导图不存在，请刷新后重试`, 'map-missing');
    if (typeof query !== 'string') throw new MindmapRequestError(localizedErrorText`搜索关键词无效`);
    const q = query.trim();
    if (!q) return [];
    if (q.length > 80) throw new MindmapRequestError(localizedErrorText`搜索关键词不能超过 80 个字符`);
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
