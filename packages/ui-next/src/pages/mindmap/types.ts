export interface MindmapNode {
  _id: string;
  mapId: string;
  parentId: string | null;
  topic: string;
  description?: string;
  color?: string;
  layoutSide?: 'left' | 'right';
  tags: string[];
  problemIds: string[];
  /** Present only on a course node (direct child of the merged root). */
  courseVisibility?: 'public' | 'hidden';
  /** Present only on a course node. Positive user ids. */
  ownerUids?: number[];
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeMap {
  _id: string;
  title: string;
  rootNodeId: string;
  visibility: 'public';
  layoutDirection: 'RIGHT' | 'DOWN';
  createdAt: string;
  updatedAt: string;
}

export type MindmapConfig = KnowledgeMap;

export interface PanelProblem {
  domainId: string;
  docId: number;
  pid: string;
  title: string;
  hidden: boolean;
  nSubmit: number;
  nAccept: number;
  difficulty: number;
  sources: Array<'canonical' | 'manual'>;
}

export interface ProblemOption {
  domainId: string;
  docId: number;
  pid: string;
  title: string;
  hidden: boolean;
}

export interface MindmapSnapshot {
  nodes: MindmapNode[];
  config: KnowledgeMap | null;
  referenceCounts: Record<string, number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requiredText(record: Record<string, unknown>, key: string, invalid: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(invalid);
  return value;
}

function optionalText(record: Record<string, unknown>, key: string, invalid: string): string | undefined {
  if (!Object.hasOwn(record, key) || record[key] == null) return undefined;
  const value = record[key];
  if (typeof value !== 'string') throw new Error(invalid);
  return value;
}

function textList(record: Record<string, unknown>, key: string, invalid: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(invalid);
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') throw new Error(invalid);
    items.push(item);
  }
  return items;
}

function readCourseVisibility(record: Record<string, unknown>): 'public' | 'hidden' | undefined {
  if (!Object.hasOwn(record, 'courseVisibility') || record.courseVisibility == null) return undefined;
  const value = record.courseVisibility;
  if (value !== 'public' && value !== 'hidden') throw new Error('课程公开状态无效');
  return value;
}

function readOwnerUids(record: Record<string, unknown>): number[] | undefined {
  if (!Object.hasOwn(record, 'ownerUids') || record.ownerUids == null) return undefined;
  const value = record.ownerUids;
  if (!Array.isArray(value)) throw new Error('负责教师必须是数组');
  const ids: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item <= 0) throw new Error('负责教师必须是正整数');
    ids.push(item);
  }
  return ids;
}

function readNode(value: unknown): MindmapNode {
  if (!isRecord(value)) throw new Error('服务器返回的导图快照格式无效');
  const parentRaw = value.parentId;
  const parentId = parentRaw === null ? null : requiredText(value, 'parentId', '父节点格式无效');
  const order = value.order;
  if (typeof order !== 'number' || !Number.isFinite(order)) throw new Error('节点顺序无效');
  const layoutRaw = value.layoutSide;
  let layoutSide: 'left' | 'right' | undefined;
  if (layoutRaw != null) {
    if (layoutRaw !== 'left' && layoutRaw !== 'right') throw new Error('根分支方向无效');
    layoutSide = layoutRaw;
  }
  const courseVisibility = readCourseVisibility(value);
  const ownerUids = readOwnerUids(value);
  const description = optionalText(value, 'description', '节点说明格式无效');
  const color = optionalText(value, 'color', '节点颜色格式无效');
  return {
    _id: requiredText(value, '_id', '节点标识格式无效'),
    mapId: requiredText(value, 'mapId', '导图标识格式无效'),
    parentId,
    topic: requiredText(value, 'topic', '节点名称格式无效'),
    ...(description !== undefined ? { description } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(layoutSide ? { layoutSide } : {}),
    tags: textList(value, 'tags', '节点标签格式无效'),
    problemIds: textList(value, 'problemIds', '收录题格式无效'),
    ...(courseVisibility ? { courseVisibility } : {}),
    ...(ownerUids ? { ownerUids } : {}),
    order,
    createdAt: requiredText(value, 'createdAt', '节点创建时间格式无效'),
    updatedAt: requiredText(value, 'updatedAt', '节点更新时间格式无效'),
  };
}

function readConfig(value: unknown): KnowledgeMap {
  if (!isRecord(value)) throw new Error('服务器返回的当前导图格式无效');
  const visibility = value.visibility;
  if (visibility !== 'public') throw new Error('服务器返回的当前导图格式无效');
  const layoutDirection = value.layoutDirection;
  if (layoutDirection !== 'RIGHT' && layoutDirection !== 'DOWN') throw new Error('导图布局方向无效');
  return {
    _id: requiredText(value, '_id', '服务器返回的当前导图格式无效'),
    title: requiredText(value, 'title', '服务器返回的当前导图格式无效'),
    rootNodeId: requiredText(value, 'rootNodeId', '服务器返回的当前导图格式无效'),
    visibility,
    layoutDirection,
    createdAt: requiredText(value, 'createdAt', '服务器返回的当前导图格式无效'),
    updatedAt: requiredText(value, 'updatedAt', '服务器返回的当前导图格式无效'),
  };
}

function readReferenceCounts(value: unknown): Record<string, number> {
  if (!isRecord(value)) throw new Error('服务器未返回节点引用状态');
  const counts: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (typeof count !== 'number' || !Number.isFinite(count)) throw new Error('服务器未返回节点引用状态');
    counts[key] = count;
  }
  return counts;
}

/** Fail closed: external mindmap payloads are `unknown` until this returns. */
export function readMindmapSnapshot(value: unknown): MindmapSnapshot {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Object.hasOwn(value, 'config')) {
    throw new Error('服务器返回的导图快照格式无效');
  }
  return {
    nodes: value.nodes.map((node) => readNode(node)),
    config: value.config === null ? null : readConfig(value.config),
    referenceCounts: readReferenceCounts(value.referenceCounts),
  };
}
