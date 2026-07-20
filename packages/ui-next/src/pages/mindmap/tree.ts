import type { MindmapNode } from './types';
import { sortMindmapNodes } from './layout';

export interface FlatMindmapNode {
  node: MindmapNode;
  depth: number;
  hasChildren: boolean;
}

export function mergeMindmapTagDraft(tags: string[], draft: string): string[] {
  return [...tags, ...draft.split(',')].map((value) => value.trim()).filter((value, index, all) => !!value && all.indexOf(value) === index);
}

export function childrenByParent(nodes: MindmapNode[]): Map<string | null, MindmapNode[]> {
  const result = new Map<string | null, MindmapNode[]>();
  for (const node of nodes) {
    const siblings = result.get(node.parentId) || [];
    siblings.push(node);
    result.set(node.parentId, siblings);
  }
  for (const [parent, children] of result) result.set(parent, sortMindmapNodes(children));
  return result;
}

function queryVisibleIds(nodes: MindmapNode[], query: string): Set<string> | null {
  const normalized = query.trim().toLocaleLowerCase('zh-CN');
  if (!normalized) return null;
  const byId = new Map(nodes.map((node) => [node._id, node]));
  const visible = new Set<string>();
  for (const node of nodes) {
    const haystack = `${node.topic} ${node.description || ''} ${node.tags.join(' ')}`.toLocaleLowerCase('zh-CN');
    if (!haystack.includes(normalized)) continue;
    let current: MindmapNode | undefined = node;
    const seen = new Set<string>();
    while (current && !seen.has(current._id)) {
      seen.add(current._id);
      visible.add(current._id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return visible;
}

export function flattenMindmapTree(nodes: MindmapNode[], rootId: string | null, expanded: ReadonlySet<string>, query = ''): FlatMindmapNode[] {
  if (!rootId) return [];
  const byParent = childrenByParent(nodes);
  const visibleForQuery = queryVisibleIds(nodes, query);
  const result: FlatMindmapNode[] = [];
  const visit = (node: MindmapNode, depth: number, ancestors: Set<string>) => {
    if (ancestors.has(node._id)) return;
    if (visibleForQuery && !visibleForQuery.has(node._id)) return;
    const children = byParent.get(node._id) || [];
    result.push({ node, depth, hasChildren: children.length > 0 });
    if (!visibleForQuery && !expanded.has(node._id)) return;
    const nextAncestors = new Set(ancestors).add(node._id);
    for (const child of children) visit(child, depth + 1, nextAncestors);
  };
  const root = nodes.find((node) => node._id === rootId);
  if (root) visit(root, 0, new Set());
  return result;
}

export function nodePath(nodes: MindmapNode[], nodeId: string): MindmapNode[] {
  const byId = new Map(nodes.map((node) => [node._id, node]));
  const path: MindmapNode[] = [];
  const seen = new Set<string>();
  let current = byId.get(nodeId);
  while (current && !seen.has(current._id)) {
    seen.add(current._id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

export function siblingIndex(nodes: MindmapNode[], node: MindmapNode): number {
  return (childrenByParent(nodes).get(node.parentId) || []).findIndex((entry) => entry._id === node._id);
}

export interface PlannedMove {
  newParentId: string;
  targetIndex: number;
}

export function planDrop(nodes: MindmapNode[], activeId: string, overId: string, zone: 'before' | 'inside' | 'after'): PlannedMove | null {
  const byId = new Map(nodes.map((node) => [node._id, node]));
  const active = byId.get(activeId);
  const over = byId.get(overId);
  if (!active || !over || active._id === over._id) return null;
  const byParent = childrenByParent(nodes);
  if (zone === 'inside') {
    const targetChildren = (byParent.get(over._id) || []).filter((node) => node._id !== activeId);
    return { newParentId: over._id, targetIndex: targetChildren.length };
  }
  if (!over.parentId) return null;
  const siblings = (byParent.get(over.parentId) || []).filter((node) => node._id !== activeId);
  const overIndex = siblings.findIndex((node) => node._id === overId);
  if (overIndex < 0) return null;
  return { newParentId: over.parentId, targetIndex: overIndex + (zone === 'after' ? 1 : 0) };
}
