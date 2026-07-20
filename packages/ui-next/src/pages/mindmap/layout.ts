import type { Edge, Node as RFNode } from '@xyflow/react';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { MindmapConfig, MindmapNode } from './types';

const elk = new ELK();

export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 44;

export interface MindmapNodeData extends Record<string, unknown> {
  topic: string;
  color?: string;
  isRoot?: boolean;
  selected?: boolean;
  dimmed?: boolean;
  hasChildren?: boolean;
  collapsed?: boolean;
  side?: 'left' | 'right' | 'root';
  onToggleCollapse?: () => void;
}

export interface LayoutResult {
  nodes: RFNode<MindmapNodeData>[];
  edges: Edge[];
}

export function sortMindmapNodes(nodes: MindmapNode[]): MindmapNode[] {
  return nodes.slice().sort((left, right) => left.order - right.order || left._id.localeCompare(right._id));
}

export function resolveRootBranchSides(nodes: MindmapNode[], rootId: string): Map<string, 'left' | 'right'> {
  const children = sortMindmapNodes(nodes.filter((node) => node.parentId === rootId));
  const result = new Map<string, 'left' | 'right'>();
  let left = 0;
  for (const child of children) {
    if (child.layoutSide === 'left' || child.layoutSide === 'right') {
      result.set(child._id, child.layoutSide);
      if (child.layoutSide === 'left') left += 1;
    }
  }
  const targetLeft = Math.ceil(children.length / 2);
  for (const child of children) {
    if (result.has(child._id)) continue;
    const side = left < targetLeft ? 'left' : 'right';
    result.set(child._id, side);
    if (side === 'left') left += 1;
  }
  return result;
}

export function visibleSubset(raw: MindmapNode[], collapsed: ReadonlySet<string>): { visible: MindmapNode[]; children: Record<string, string[]> } {
  const children: Record<string, string[]> = {};
  for (const node of sortMindmapNodes(raw)) {
    if (!node.parentId) continue;
    (children[node.parentId] ||= []).push(node._id);
  }
  const hidden = new Set<string>();
  const sweep = (id: string) => {
    for (const child of children[id] || []) {
      hidden.add(child);
      sweep(child);
    }
  };
  for (const id of collapsed) sweep(id);
  return { visible: raw.filter((node) => !hidden.has(node._id)), children };
}

const SHARED_LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.spacing.nodeNode': '20',
  'elk.layered.spacing.nodeNodeBetweenLayers': '100',
  'elk.layered.spacing.edgeNodeBetweenLayers': '40',
  'elk.spacing.edgeNode': '20',
  'elk.padding': '[top=40,left=40,bottom=40,right=40]',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.edgeRouting': 'ORTHOGONAL',
};

async function layoutHalf(rootId: string, ids: Set<string>, visible: MindmapNode[], direction: 'LEFT' | 'RIGHT') {
  const nodes = sortMindmapNodes(visible.filter((node) => ids.has(node._id)));
  if (nodes.length <= 1) return null;
  return await elk.layout({
    id: 'root',
    layoutOptions: {
      ...SHARED_LAYOUT_OPTIONS,
      'elk.direction': direction,
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.crossingMinimization.semiInteractive': 'true',
    },
    children: nodes.map((node) => ({ id: node._id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: nodes
      .filter((node) => node.parentId && ids.has(node.parentId))
      .map((node) => ({ id: `e-${node.parentId}-${node._id}`, sources: [node.parentId as string], targets: [node._id] })),
  });
}

async function layoutDown(visible: MindmapNode[]) {
  const nodes = sortMindmapNodes(visible);
  return await elk.layout({
    id: 'root',
    layoutOptions: {
      ...SHARED_LAYOUT_OPTIONS,
      'elk.direction': 'DOWN',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.crossingMinimization.semiInteractive': 'true',
    },
    children: nodes.map((node) => ({ id: node._id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: nodes
      .filter((node) => node.parentId)
      .map((node) => ({ id: `e-${node.parentId}-${node._id}`, sources: [node.parentId as string], targets: [node._id] })),
  });
}

export async function computeMindmapLayout(
  raw: MindmapNode[],
  rootId: string | null,
  collapsed: ReadonlySet<string> = new Set(),
  layoutDirection: MindmapConfig['layoutDirection'] = 'RIGHT',
): Promise<LayoutResult> {
  if (!raw.length || !rootId) return { nodes: [], edges: [] };
  const { visible, children } = visibleSubset(raw, collapsed);
  const visibleIds = new Set(visible.map((node) => node._id));
  if (layoutDirection === 'DOWN') {
    const layout = await layoutDown(visible);
    const root = layout.children?.find((entry) => entry.id === rootId);
    const dx = root?.x || 0;
    const dy = root?.y || 0;
    const positions = new Map((layout.children || []).map((entry) => [entry.id, { x: (entry.x || 0) - dx, y: (entry.y || 0) - dy }]));
    return {
      nodes: visible.map((node) => ({
        id: node._id,
        type: 'mindmap',
        position: positions.get(node._id) || { x: 0, y: 0 },
        data: {
          topic: node.topic,
          color: node.color,
          isRoot: node._id === rootId,
          hasChildren: (children[node._id]?.length || 0) > 0,
          collapsed: collapsed.has(node._id),
          side: node._id === rootId ? 'root' : 'right',
        },
        style: { width: NODE_WIDTH, height: NODE_HEIGHT },
      })),
      edges: visible
        .filter((node) => node.parentId && visibleIds.has(node.parentId))
        .map(
          (node) =>
            ({
              id: `e-${node.parentId}-${node._id}`,
              source: node.parentId as string,
              target: node._id,
              sourceHandle: 'src-bottom',
              targetHandle: 'tgt-top',
              type: 'default',
              style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5, opacity: 0.55 },
            }) satisfies Edge,
        ),
    };
  }
  const rootSides = resolveRootBranchSides(raw, rootId);
  const rootChildren = (children[rootId] || []).filter((id) => visibleIds.has(id));
  const leftBranches = rootChildren.filter((id) => rootSides.get(id) === 'left');
  const rightBranches = rootChildren.filter((id) => rootSides.get(id) !== 'left');

  const collectDescendants = (nodeId: string, target: Set<string>) => {
    target.add(nodeId);
    for (const child of children[nodeId] || []) {
      if (visibleIds.has(child)) collectDescendants(child, target);
    }
  };
  const leftIds = new Set<string>([rootId]);
  const rightIds = new Set<string>([rootId]);
  for (const id of leftBranches) collectDescendants(id, leftIds);
  for (const id of rightBranches) collectDescendants(id, rightIds);

  const [leftLayout, rightLayout] = await Promise.all([layoutHalf(rootId, leftIds, visible, 'LEFT'), layoutHalf(rootId, rightIds, visible, 'RIGHT')]);
  const positions = new Map<string, { x: number; y: number }>([[rootId, { x: 0, y: 0 }]]);
  const ingest = (layout: Awaited<ReturnType<typeof layoutHalf>>, ids: Set<string>) => {
    if (!layout?.children) return;
    const root = layout.children.find((entry) => entry.id === rootId);
    const dx = root?.x || 0;
    const dy = root?.y || 0;
    for (const entry of layout.children) {
      if (entry.id === rootId || !ids.has(entry.id)) continue;
      positions.set(entry.id, { x: (entry.x || 0) - dx, y: (entry.y || 0) - dy });
    }
  };
  ingest(leftLayout, leftIds);
  ingest(rightLayout, rightIds);

  const sideOf = new Map<string, 'left' | 'right' | 'root'>([[rootId, 'root']]);
  for (const id of leftIds) if (id !== rootId) sideOf.set(id, 'left');
  for (const id of rightIds) if (id !== rootId) sideOf.set(id, 'right');

  return {
    nodes: visible.map((node) => ({
      id: node._id,
      type: 'mindmap',
      position: positions.get(node._id) || { x: 0, y: 0 },
      data: {
        topic: node.topic,
        color: node.color,
        isRoot: node._id === rootId,
        hasChildren: (children[node._id]?.length || 0) > 0,
        collapsed: collapsed.has(node._id),
        side: sideOf.get(node._id) || 'right',
      },
      style: { width: NODE_WIDTH, height: NODE_HEIGHT },
    })),
    edges: visible
      .filter((node) => node.parentId && visibleIds.has(node.parentId))
      .map((node) => {
        const side = sideOf.get(node._id) || 'right';
        const left = side === 'left';
        return {
          id: `e-${node.parentId}-${node._id}`,
          source: node.parentId as string,
          target: node._id,
          sourceHandle: left ? 'src-left' : 'src-right',
          targetHandle: left ? 'tgt-right' : 'tgt-left',
          type: 'default',
          style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5, opacity: 0.55 },
        } satisfies Edge;
      }),
  };
}
