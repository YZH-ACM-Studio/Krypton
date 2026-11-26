import type { ChapterDraft } from '../types';
import { readMindmapSnapshot, type KnowledgeMap, type MindmapNode } from '../../mindmap/types';
import type { PlannedMove } from '../../mindmap/tree';

export interface CourseNodeView {
  id: string;
  title: string;
  order: number;
  visibility: 'public' | 'hidden';
  ownerUids: number[];
}

export interface CourseNodeEditorSnapshot {
  courseNode: CourseNodeView;
  nodes: MindmapNode[];
  referenceCounts: Record<string, number>;
  config: KnowledgeMap;
  canEdit: boolean;
}

export interface ListedProblem {
  domainId: string;
  docId: number;
  pid: string;
  title: string;
}

export interface ChapterMatch {
  chapterId: number;
  sectionId: number | null;
  label: string;
}

export type CourseNodeOperation = 'create' | 'update' | 'move' | 'delete';

export interface CourseNodeMutation {
  operation: CourseNodeOperation;
  body: Record<string, unknown>;
}

export const NEW_NODE_TOPIC = '新知识点';
export const MAX_INCLUDED = 200;

const INVALID_SNAPSHOT = '服务器返回的课程节点格式无效';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readCourseNode(value: unknown): CourseNodeView {
  if (!isRecord(value)) throw new Error(INVALID_SNAPSHOT);
  const { id, title, order, visibility, ownerUids } = value;
  if (typeof id !== 'string' || id.length === 0) throw new Error(INVALID_SNAPSHOT);
  if (typeof title !== 'string' || title.length === 0) throw new Error(INVALID_SNAPSHOT);
  if (typeof order !== 'number' || !Number.isFinite(order)) throw new Error(INVALID_SNAPSHOT);
  if (visibility !== 'public' && visibility !== 'hidden') throw new Error(INVALID_SNAPSHOT);
  if (!Array.isArray(ownerUids)) throw new Error(INVALID_SNAPSHOT);
  const owners: number[] = [];
  for (const uid of ownerUids) {
    if (typeof uid !== 'number' || !Number.isSafeInteger(uid) || uid <= 0) throw new Error(INVALID_SNAPSHOT);
    owners.push(uid);
  }
  return { id, title, order, visibility, ownerUids: owners };
}

/** Fail closed: the edit payload is `unknown` until this returns. */
export function parseCourseNodeEditorSnapshot(raw: unknown): CourseNodeEditorSnapshot {
  if (!isRecord(raw) || typeof raw.canEdit !== 'boolean') throw new Error(INVALID_SNAPSHOT);
  const snapshot = readMindmapSnapshot(raw);
  if (!snapshot.config) throw new Error('服务器返回的当前导图格式无效');
  const courseNode = readCourseNode(raw.courseNode);
  const course = snapshot.nodes.find((node) => node._id === courseNode.id);
  if (!course) throw new Error('课程节点不在子树里');
  if (course.parentId !== snapshot.config.rootNodeId) throw new Error('课程节点不在知识图谱总根下');
  for (const node of snapshot.nodes) {
    if (!Object.hasOwn(snapshot.referenceCounts, node._id)) throw new Error('服务器未返回节点引用状态');
  }
  return {
    canEdit: raw.canEdit,
    courseNode,
    nodes: snapshot.nodes,
    referenceCounts: snapshot.referenceCounts,
    config: snapshot.config,
  };
}

export function parseListedProblems(raw: unknown): ListedProblem[] {
  if (!isRecord(raw) || !Array.isArray(raw.problems)) throw new Error('服务器返回的关联题目格式无效');
  return raw.problems.map((item) => {
    if (!isRecord(item)) throw new Error('服务器返回的关联题目格式无效');
    const { domainId, docId, pid, title } = item;
    if (typeof domainId !== 'string' || domainId.length === 0) throw new Error('服务器返回的关联题目格式无效');
    if (typeof docId !== 'number' || !Number.isSafeInteger(docId) || docId <= 0) throw new Error('服务器返回的关联题目格式无效');
    if (typeof pid !== 'string' || pid.length === 0) throw new Error('服务器返回的关联题目格式无效');
    if (typeof title !== 'string') throw new Error('服务器返回的关联题目格式无效');
    return { domainId, docId, pid, title };
  });
}

export function parentNodeIds(nodes: readonly MindmapNode[]): Set<string> {
  const known = new Set(nodes.map((node) => node._id));
  const parents = new Set<string>();
  for (const node of nodes) {
    if (node.parentId && known.has(node.parentId)) parents.add(node.parentId);
  }
  return parents;
}

export function emphasizedNodeIds(nodes: readonly MindmapNode[], search: string): ReadonlySet<string> | undefined {
  const normalized = search.trim().toLocaleLowerCase('zh-CN');
  if (!normalized) return undefined;
  const ids = new Set<string>();
  for (const node of nodes) {
    const haystack = `${node.topic} ${node.description ?? ''} ${node.tags.join(' ')}`.toLocaleLowerCase('zh-CN');
    if (haystack.includes(normalized)) ids.add(node._id);
  }
  return ids;
}

export function chapterForNode(chapters: readonly ChapterDraft[] | undefined, nodeId: string): ChapterMatch | null {
  if (!chapters) return null;
  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    if (!chapter) continue;
    const chapterNo = index + 1;
    if (chapter.sourceMindmapNodeId === nodeId) {
      return { chapterId: chapter._id, sectionId: null, label: `第 ${chapterNo} 章 · ${chapter.title}` };
    }
    for (const section of chapter.sections) {
      if (section.sourceMindmapNodeId !== nodeId) continue;
      return {
        chapterId: chapter._id,
        sectionId: section._id,
        label: `第 ${chapterNo} 章 · ${chapter.title} › ${section.title}`,
      };
    }
  }
  return null;
}

export function formatSavedClock(nowMs: number): string {
  if (!Number.isFinite(nowMs)) throw new Error('保存时间无效');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(nowMs);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '';
  if (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute)) throw new Error('保存时间格式无效');
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

export function courseNodeFormPayload(snapshot: CourseNodeEditorSnapshot, mutation: CourseNodeMutation): Record<string, unknown> {
  return {
    ...mutation.body,
    mapId: snapshot.config._id,
    expectedMapUpdatedAt: snapshot.config.updatedAt,
  };
}

function nodeById(nodes: readonly MindmapNode[], id: string): MindmapNode | null {
  return nodes.find((node) => node._id === id) ?? null;
}

function containsNode(nodes: readonly MindmapNode[], ancestorId: string, nodeId: string): boolean {
  const parentById = new Map(nodes.map((node) => [node._id, node.parentId]));
  const seen = new Set<string>();
  let current = parentById.get(nodeId) ?? null;
  while (current) {
    if (current === ancestorId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = parentById.get(current) ?? null;
  }
  return false;
}

/** Appending is the sibling count, so an empty target is index 0 and that index is still last. */
function appendIndex(nodes: readonly MindmapNode[], parentId: string, movingId: string): number {
  let count = 0;
  for (const node of nodes) {
    if (node.parentId === parentId && node._id !== movingId) count += 1;
  }
  return count;
}

/** Same spacing as the server insert: last among the other children is max(order)+10, or 10 with no siblings. */
function optimisticMoveOrder(nodes: readonly MindmapNode[], parentId: string, movingId: string, targetIndex: unknown): number {
  const siblings = nodes
    .filter((node) => node.parentId === parentId && node._id !== movingId)
    .slice()
    .sort((left, right) => left.order - right.order || left._id.localeCompare(right._id));
  const index = typeof targetIndex === 'number' && Number.isSafeInteger(targetIndex) && targetIndex >= 0
    ? Math.min(targetIndex, siblings.length)
    : siblings.length;
  const before = siblings[index - 1];
  const after = siblings[index];
  if (!before) return after ? after.order - 10 : 10;
  if (!after) return before.order + 10;
  const middle = before.order + (after.order - before.order) / 2;
  if (middle > before.order && middle < after.order) return middle;
  return before.order + 10;
}

export function childMutation(snapshot: CourseNodeEditorSnapshot, nodeId: string, topic = NEW_NODE_TOPIC): CourseNodeMutation | null {
  const parent = nodeById(snapshot.nodes, nodeId);
  const nextTopic = topic.trim();
  if (!parent || !nextTopic) return null;
  return {
    operation: 'create',
    body: {
      parentId: parent._id,
      expectedParentUpdatedAt: parent.updatedAt,
      topic: nextTopic,
    },
  };
}

export function siblingMutation(snapshot: CourseNodeEditorSnapshot, nodeId: string): CourseNodeMutation | null {
  const node = nodeById(snapshot.nodes, nodeId);
  if (!node?.parentId || node._id === snapshot.courseNode.id) return null;
  const parent = nodeById(snapshot.nodes, node.parentId);
  if (!parent) return null;
  return childMutation(snapshot, parent._id, NEW_NODE_TOPIC);
}

export function renameMutation(snapshot: CourseNodeEditorSnapshot, nodeId: string, title: string): CourseNodeMutation | null {
  const node = nodeById(snapshot.nodes, nodeId);
  const topic = title.trim();
  if (!node || !topic || topic === node.topic) return null;
  return {
    operation: 'update',
    body: {
      id: node._id,
      expectedUpdatedAt: node.updatedAt,
      fields: { topic },
    },
  };
}

export function moveMutation(snapshot: CourseNodeEditorSnapshot, nodeId: string, move: PlannedMove): CourseNodeMutation | null {
  const node = nodeById(snapshot.nodes, nodeId);
  const parent = nodeById(snapshot.nodes, move.newParentId);
  if (!node || !parent || node._id === snapshot.courseNode.id) return null;
  if (node._id === parent._id || containsNode(snapshot.nodes, node._id, parent._id)) return null;
  return {
    operation: 'move',
    body: {
      id: node._id,
      newParentId: parent._id,
      targetIndex: move.targetIndex,
      expectedUpdatedAt: node.updatedAt,
      expectedParentUpdatedAt: parent.updatedAt,
    },
  };
}

export function moveIntoMutation(snapshot: CourseNodeEditorSnapshot, dragId: string, targetId: string): CourseNodeMutation | null {
  if (dragId === targetId || dragId === snapshot.courseNode.id) return null;
  if (!nodeById(snapshot.nodes, dragId) || !nodeById(snapshot.nodes, targetId)) return null;
  if (containsNode(snapshot.nodes, dragId, targetId)) return null;
  return moveMutation(snapshot, dragId, {
    newParentId: targetId,
    targetIndex: appendIndex(snapshot.nodes, targetId, dragId),
  });
}

export function applyCourseNodeMutation(snapshot: CourseNodeEditorSnapshot, mutation: CourseNodeMutation): CourseNodeEditorSnapshot | null {
  if (mutation.operation === 'update' && typeof mutation.body.id === 'string' && isRecord(mutation.body.fields)) {
    const fields = mutation.body.fields;
    const problemIds = Array.isArray(fields.problemIds) && fields.problemIds.every((id) => typeof id === 'string')
      ? fields.problemIds
      : null;
    return {
      ...snapshot,
      nodes: snapshot.nodes.map((node) => {
        if (node._id !== mutation.body.id) return node;
        return {
          ...node,
          ...(typeof fields.topic === 'string' ? { topic: fields.topic } : {}),
          ...(typeof fields.description === 'string' ? { description: fields.description } : {}),
          ...(typeof fields.color === 'string' ? { color: fields.color } : {}),
          ...(problemIds !== null ? { problemIds } : {}),
        };
      }),
    };
  }
  if (mutation.operation === 'move' && typeof mutation.body.id === 'string' && typeof mutation.body.newParentId === 'string') {
    const parentId = mutation.body.newParentId;
    const id = mutation.body.id;
    const order = optimisticMoveOrder(snapshot.nodes, parentId, id, mutation.body.targetIndex);
    return {
      ...snapshot,
      nodes: snapshot.nodes.map((node) => (
        node._id === id ? { ...node, parentId, order } : node
      )),
    };
  }
  return null;
}

export function createdNodeId(
  before: CourseNodeEditorSnapshot,
  after: CourseNodeEditorSnapshot,
  parentId: string,
  topic: string,
): string | null {
  const known = new Set(before.nodes.map((node) => node._id));
  const created = after.nodes.filter((node) => !known.has(node._id) && node.parentId === parentId && node.topic === topic);
  if (created.length !== 1) return null;
  return created[0]?._id ?? null;
}

export function nextProblemIds(current: readonly string[], additions: readonly string[]): { ids: string[]; overflow: boolean } {
  const ids = [...current];
  const seen = new Set(ids);
  let overflow = false;
  for (const id of additions) {
    if (seen.has(id)) continue;
    if (ids.length >= MAX_INCLUDED) {
      overflow = true;
      break;
    }
    seen.add(id);
    ids.push(id);
  }
  return { ids, overflow };
}
