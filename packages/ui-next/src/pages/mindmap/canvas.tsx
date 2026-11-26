import '@xyflow/react/dist/style.css';

import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useReactFlow,
  type NodeChange,
  type Node as RFNode,
  type OnNodeDrag,
} from '@xyflow/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useColorMode } from '@/lib/use-color-mode';
import { computeMindmapLayout, type MindmapNodeData } from './layout';
import type { MindmapConfig, MindmapNode } from './types';

/** Author-picked node colors, mapped onto semantic tones. Gray stays on surface. */
const NODE_TONE_STYLE: Record<string, { backgroundColor: string; borderColor: string }> = {
  sky: { backgroundColor: 'var(--info-soft)', borderColor: 'var(--info-line)' },
  blue: { backgroundColor: 'var(--info-soft)', borderColor: 'var(--info-line)' },
  green: { backgroundColor: 'var(--success-soft)', borderColor: 'var(--success-line)' },
  amber: { backgroundColor: 'var(--warning-soft)', borderColor: 'var(--warning-line)' },
  rose: { backgroundColor: 'var(--danger-soft)', borderColor: 'var(--danger-line)' },
  purple: { backgroundColor: 'var(--violet-soft)', borderColor: 'var(--violet-line)' },
};

/** Saved color wins. Brand is only the fallback when a root has no saved color. */
export function rootNodeColor(node: { color?: string; isRoot?: boolean }): string {
  if (node.color) return node.color;
  return 'brand';
}

function nodeToneStyle(node: { color?: string; isRoot?: boolean }): { backgroundColor: string; borderColor: string } | undefined {
  const color = node.isRoot ? rootNodeColor(node) : node.color;
  if (!color || color === 'gray' || color === 'brand') return undefined;
  return NODE_TONE_STYLE[color];
}

interface CanvasNodeData extends MindmapNodeData {
  problemCount?: number;
  renaming?: boolean;
}

type CanvasKeyCommand = 'child' | 'sibling' | 'delete';

interface CanvasRenameActions {
  commit: (id: string, title: string) => void;
  cancel: () => void;
}

const CanvasRenameContext = createContext<CanvasRenameActions | null>(null);

function isDescendantOf(nodes: readonly MindmapNode[], ancestorId: string, nodeId: string): boolean {
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

function canvasKeyCommand(key: string): CanvasKeyCommand | null {
  if (key === 'Tab') return 'child';
  if (key === 'Enter') return 'sibling';
  if (key === 'Delete' || key === 'Backspace') return 'delete';
  return null;
}

function blocksCanvasKeys(element: Element): boolean {
  return element.closest('input, textarea, select, button, a, [contenteditable="true"]') !== null;
}

function restoreLayoutPositions(
  current: RFNode<CanvasNodeData>[],
  homes: ReadonlyMap<string, { x: number; y: number }>,
): RFNode<CanvasNodeData>[] {
  let changed = false;
  const next = current.map((item) => {
    const home = homes.get(item.id);
    if (!home) return item;
    if (item.position.x === home.x && item.position.y === home.y && item.dragging !== true) return item;
    changed = true;
    return { ...item, position: { x: home.x, y: home.y }, dragging: false };
  });
  return changed ? next : current;
}

function RenameField({ nodeId, topic, onCommit, onCancel }: { nodeId: string; topic: string; onCommit: (id: string, title: string) => void; onCancel: () => void }) {
  const fieldRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(topic);
  const skipBlurRef = useRef(false);

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    field.select();
  }, []);

  return (
    <Input
      ref={fieldRef}
      size="sm"
      value={value}
      aria-label="知识点名称"
      className="nodrag nopan min-w-0 flex-1"
      onChange={(event) => setValue(event.target.value)}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key !== 'Enter' && event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        skipBlurRef.current = true;
        if (event.key === 'Escape') {
          onCancel();
          return;
        }
        const title = event.currentTarget.value.trim();
        if (!title) onCancel();
        else onCommit(nodeId, title);
      }}
      onBlur={() => {
        if (skipBlurRef.current) return;
        if (!fieldRef.current?.isConnected) return;
        onCancel();
      }}
    />
  );
}

function MindmapNodeView({ id, data }: { id: string; data: CanvasNodeData }) {
  const rename = useContext(CanvasRenameContext);
  const toggle = data.onToggleCollapse;
  const dimmed = data.dimmed === true && data.selected !== true;
  const savedRootColor = data.isRoot ? rootNodeColor({ color: data.color, isRoot: true }) : undefined;
  const tone = dimmed ? undefined : nodeToneStyle({ color: data.color, isRoot: data.isRoot === true });
  const problemCount = typeof data.problemCount === 'number' ? data.problemCount : null;
  return (
    <>
      <Handle type="target" id="tgt-left" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="target" id="tgt-right" position={Position.Right} style={{ opacity: 0 }} />
      <Handle type="target" id="tgt-top" position={Position.Top} style={{ opacity: 0 }} />
      <div
        className="flex h-full w-full min-w-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface px-3 py-0.5 text-sm text-fg shadow-xs transition-[background-color,border-color,box-shadow,color] duration-(--dur-1) ease-(--ease-standard) motion-reduce:transition-none data-[dimmed=true]:border-line-subtle data-[dimmed=true]:text-fg-subtle data-[root=true]:font-semibold data-[root-brand=true]:border-brand data-[root-brand=true]:bg-brand-soft data-[selected=true]:ring-2 data-[selected=true]:ring-ring"
        data-dimmed={dimmed ? 'true' : undefined}
        data-root={data.isRoot ? 'true' : undefined}
        data-root-brand={!dimmed && savedRootColor === 'brand' ? 'true' : undefined}
        data-selected={data.selected ? 'true' : undefined}
        style={tone}
      >
        <span className="min-w-0 max-w-full text-center leading-tight line-clamp-2" hidden={data.renaming && rename ? true : undefined}>{data.topic}</span>
        {data.renaming && rename ? (
          <RenameField nodeId={id} topic={data.topic} onCommit={rename.commit} onCancel={rename.cancel} />
        ) : null}
        {problemCount !== null ? <span className="ml-1.5 shrink-0 text-xs text-fg-muted tabular">{problemCount}</span> : null}
        {data.hasChildren && toggle ? (
          <Button
            type="button"
            variant="ghost"
            iconOnly
            onClick={(event) => {
              event.stopPropagation();
              toggle();
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className="-mr-2 ml-1.5 size-10 shrink-0"
            aria-label={data.collapsed ? '展开子节点' : '收起子节点'}
          >
            {data.collapsed ? <ChevronRight /> : <ChevronDown />}
          </Button>
        ) : null}
      </div>
      <Handle type="source" id="src-left" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" id="src-right" position={Position.Right} style={{ opacity: 0 }} />
      <Handle type="source" id="src-bottom" position={Position.Bottom} style={{ opacity: 0 }} />
    </>
  );
}

const NODE_TYPES = { mindmap: MindmapNodeView };

export function initialCollapsedNodes(nodes: MindmapNode[], rootId: string | null): Set<string> {
  if (!rootId) return new Set();
  const parents = new Set(nodes.map((node) => node.parentId).filter((id): id is string => !!id));
  return new Set(nodes.filter((node) => node._id !== rootId && parents.has(node._id)).map((node) => node._id));
}

export function MindmapCanvas({
  nodes,
  config,
  selectedId,
  onSelect,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  emphasizedIds,
  counts,
  editable = false,
  renamingId = null,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onMoveInto,
  onKeyCommand,
  fitMaxZoom,
}: {
  nodes: MindmapNode[];
  config: MindmapConfig;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  collapsed?: Set<string>;
  onCollapsedChange?: (value: Set<string>) => void;
  emphasizedIds?: ReadonlySet<string>;
  counts?: Readonly<Record<string, number>>;
  editable?: boolean;
  renamingId?: string | null;
  onRenameStart?: (id: string) => void;
  onRenameCommit?: (id: string, title: string) => void;
  onRenameCancel?: () => void;
  onMoveInto?: (dragId: string, targetId: string) => void;
  onKeyCommand?: (command: CanvasKeyCommand, selectedId: string) => void;
  /** Largest zoom when fitting the tree to the window; manual zoom still goes up to maxZoom. */
  fitMaxZoom?: number;
}) {
  const [internalCollapsed, setInternalCollapsed] = useState(() => initialCollapsedNodes(nodes, config.rootNodeId));
  const collapsed = controlledCollapsed || internalCollapsed;
  const setCollapsed = onCollapsedChange || setInternalCollapsed;
  const [flowNodes, setFlowNodes] = useState<RFNode<CanvasNodeData>[]>([]);
  const [flowEdges, setFlowEdges] = useState<Awaited<ReturnType<typeof computeMindmapLayout>>['edges']>([]);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const selectedIdRef = useRef(selectedId);
  const layoutPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const editingViewRef = useRef({ editable, renamingId, counts });
  const onRenameCommitRef = useRef(onRenameCommit);
  const onRenameCancelRef = useRef(onRenameCancel);
  editingViewRef.current = { editable, renamingId: editable ? renamingId : null, counts };
  onRenameCommitRef.current = onRenameCommit;
  onRenameCancelRef.current = onRenameCancel;
  const { fitView, getIntersectingNodes } = useReactFlow();
  const colorMode = useColorMode();
  const renameActions = useMemo<CanvasRenameActions>(
    () => ({
      commit: (id, title) => onRenameCommitRef.current?.(id, title),
      cancel: () => onRenameCancelRef.current?.(),
    }),
    [],
  );

  const toggleCollapse = useCallback(
    (id: string) => {
      const next = new Set(collapsed);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setCollapsed(next);
    },
    [collapsed, setCollapsed],
  );

  useEffect(() => {
    selectedIdRef.current = selectedId;
    setFlowNodes((current) =>
      current.map((node) =>
        node.data.selected === (node.id === selectedId) ? node : { ...node, data: { ...node.data, selected: node.id === selectedId } },
      ),
    );
  }, [selectedId]);

  useEffect(() => {
    const view = editingViewRef.current;
    setFlowNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        const problemCount = view.counts?.[node.id];
        const renaming = view.renamingId === node.id;
        if (node.data.problemCount === problemCount && node.data.renaming === renaming) return node;
        changed = true;
        return { ...node, data: { ...node.data, problemCount, renaming } };
      });
      return changed ? next : current;
    });
  }, [counts, renamingId, editable]);

  useEffect(() => {
    let cancelled = false;
    setLayoutError(null);
    void computeMindmapLayout(nodes, config.rootNodeId, collapsed, config.layoutDirection)
      .then((layout) => {
        if (cancelled) return;
        const view = editingViewRef.current;
        layoutPositionsRef.current = new Map(layout.nodes.map((node) => [node.id, { x: node.position.x, y: node.position.y }]));
        setFlowNodes(
          layout.nodes.map((node) => ({
            ...node,
            data: {
              ...node.data,
              selected: node.id === selectedIdRef.current,
              dimmed: emphasizedIds ? !emphasizedIds.has(node.id) : false,
              onToggleCollapse: () => toggleCollapse(node.id),
              problemCount: view.counts?.[node.id],
              renaming: view.renamingId === node.id,
            },
          })),
        );
        setFlowEdges(layout.edges);
        window.requestAnimationFrame(() => {
          if (!cancelled) void fitView({ padding: 0.16, maxZoom: fitMaxZoom });
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Mindmap layout failed', error);
        setFlowNodes([]);
        setFlowEdges([]);
        setLayoutError(error instanceof Error ? error.message : '未知布局错误');
      });
    return () => {
      cancelled = true;
    };
  }, [nodes, config.rootNodeId, config.layoutDirection, collapsed, toggleCollapse, fitView, emphasizedIds, fitMaxZoom]);

  const onNodesChange = useCallback((changes: NodeChange<RFNode<CanvasNodeData>>[]) => {
    if (!editingViewRef.current.editable) return;
    // Keep dimensions on the user node. A later position update adopts userNode.measured
    // and would clear every internal size if a dimensions change was dropped.
    const kept = changes.filter((change) => change.type === 'position' || change.type === 'dimensions');
    if (kept.length === 0) return;
    setFlowNodes((current) => applyNodeChanges(kept, current));
  }, []);

  // Layout owns positions. A drop that does not reparent snaps the gesture back.
  const onNodeDragStop = useCallback<OnNodeDrag<RFNode<CanvasNodeData>>>(
    (_, node) => {
      if (!editable) return;
      const hits = getIntersectingNodes(node);
      const target = hits.find(
        (hit) => hit.id !== node.id && nodes.some((item) => item._id === hit.id) && !isDescendantOf(nodes, node.id, hit.id),
      );
      if (target) {
        onMoveInto?.(node.id, target.id);
        return;
      }
      setFlowNodes((current) => restoreLayoutPositions(current, layoutPositionsRef.current));
    },
    [editable, getIntersectingNodes, nodes, onMoveInto],
  );

  const onCanvasKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!editable || !selectedId) return;
      const active = document.activeElement;
      if (!(active instanceof Element) || !event.currentTarget.contains(active) || blocksCanvasKeys(active)) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.nativeEvent.isComposing) return;
      const command = canvasKeyCommand(event.key);
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      onKeyCommand?.(command, selectedId);
    },
    [editable, onKeyCommand, selectedId],
  );

  const nodeTypes = useMemo(() => NODE_TYPES, []);
  return (
    <CanvasRenameContext.Provider value={renameActions}>
      <div
        className="relative h-full min-h-0 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        tabIndex={editable ? 0 : undefined}
        onKeyDown={editable ? onCanvasKeyDown : undefined}
      >
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          colorMode={colorMode}
          onNodeClick={(_, node) => onSelect(node.id)}
          onPaneClick={() => onSelect(null)}
          onNodeDoubleClick={(event, node) => {
            if (!editable) return;
            const target = event.target;
            if (target instanceof Element && target.closest('button, input, textarea, a')) return;
            onRenameStart?.(node.id);
          }}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          nodesDraggable={editable}
          nodesConnectable={false}
          elementsSelectable
          deleteKeyCode={editable ? null : undefined}
          disableKeyboardA11y={editable ? true : undefined}
          fitView
          fitViewOptions={{ padding: 0.16, maxZoom: fitMaxZoom }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
          maxZoom={2.5}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--line)" />
          <Controls showInteractive={false} />
        </ReactFlow>
        {layoutError ? (
          <div className="absolute inset-x-4 top-4 z-20 rounded-lg border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-fg shadow-xs">
            导图布局失败：{layoutError}
          </div>
        ) : null}
      </div>
    </CanvasRenameContext.Provider>
  );
}
