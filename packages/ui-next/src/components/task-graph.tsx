/**
 * Shared task-graph renderer — used by:
 *
 *   - Admin editor (editable + drag-and-drop new nodes from a toolbox)
 *   - User-side detail view (read-only + done-colored nodes)
 *   - Admin candidate-pool drill-in (read-only, per-user progress overlay)
 *   - Admin stats drill-in (read-only)
 *
 * Built on @xyflow/react. Custom NodeComponent handles three node types:
 *   - start  → green pill labelled "开始"
 *   - end    → violet pill labelled "完成"
 *   - task   → card with preset name + (when read-only) progress badge
 *
 * Edges have no special semantics beyond "path option" — see
 * krypton-tasks evaluateGraph for the eval rule.
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type DragEvent, type ReactNode,
} from 'react';
import {
  Background, BackgroundVariant, Controls, Handle, MarkerType, Position,
  ReactFlow, ReactFlowProvider, addEdge, applyEdgeChanges, applyNodeChanges,
  type Edge, type EdgeChange, type Node as RFNode, type NodeChange,
  type OnConnect, useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CheckCircle2, Circle, Flag, Play, UserCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useColorMode } from '@/lib/use-color-mode';

// ─── Public types ─────────────────────────────────────────────────────────

export interface TaskGraphNode {
  id: string;
  type: 'start' | 'end' | 'task';
  position: { x: number; y: number };
  presetId?: string;
  name?: string;
  params?: Record<string, any>;
}

export interface TaskGraphEdge {
  id: string;
  from: string;
  to: string;
}

export interface TaskGraph {
  nodes: TaskGraphNode[];
  edges: TaskGraphEdge[];
}

export interface PresetSummary {
  id: string;
  name: string;
  category: 'behavior' | 'condition';
  description: string;
  params: Array<{
    name: string;
    label: string;
    type: string;
    required?: boolean;
    default?: any;
    options?: { value: string; label: string }[];
    helper?: string;
  }>;
}

export interface TaskPointResult {
  completed: boolean;
  current: number;
  target: number;
  details?: string;
  overridden?: boolean;
}

// ─── Internal node-data type (carried on every RF node) ────────────────────

interface NodeDataShape extends Record<string, unknown> {
  variant: 'start' | 'end' | 'task';
  name?: string;
  presetId?: string;
  category?: 'behavior' | 'condition';
  description?: string;
  selected?: boolean;
  // Read-only overlay:
  done?: boolean;
  current?: number;
  target?: number;
  details?: string;
  overridden?: boolean;
}

// ─── Custom node renderer ─────────────────────────────────────────────────

function TaskGraphNodeComponent({ data, selected }: {
  data: NodeDataShape;
  selected?: boolean;
}) {
  const isStart = data.variant === 'start';
  const isEnd = data.variant === 'end';
  const isCondition = data.category === 'condition';
  const hasProgress = data.done !== undefined;

  return (
    <>
      {!isStart && (
        <Handle type="target" position={Position.Left} className="!size-2 !border-2" />
      )}
      <div
        className={cn(
          'flex min-w-[140px] max-w-[220px] flex-col gap-1 rounded-lg border px-3 py-2 text-sm shadow-sm transition-all',
          isStart && 'border-emerald-500 bg-emerald-500 font-semibold text-white',
          isEnd && 'border-violet-500 bg-violet-500 font-semibold text-white',
          !isStart && !isEnd && isCondition && 'border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-100',
          !isStart && !isEnd && !isCondition && 'border-sky-400 bg-sky-50 text-sky-900 dark:border-sky-600 dark:bg-sky-950/40 dark:text-sky-100',
          selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
          hasProgress && data.done && 'ring-2 ring-emerald-500 ring-offset-2 ring-offset-background',
          hasProgress && !data.done && !isStart && !isEnd && 'opacity-60',
        )}
      >
        <div className="flex items-center gap-1.5">
          {isStart ? <Play className="size-3.5" />
            : isEnd ? <Flag className="size-3.5" />
            : isCondition ? <UserCheck className="size-3.5 shrink-0" />
            : hasProgress ? (data.done ? <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" /> : <Circle className="size-3.5 shrink-0" />)
            : <Circle className="size-3.5 shrink-0" />}
          <span className="truncate font-medium">
            {isStart ? '开始'
              : isEnd ? '完成'
              : data.name || data.presetId || '未命名'}
          </span>
        </div>
        {hasProgress && !isStart && !isEnd && (
          <div className="text-[10px] leading-tight opacity-80">
            {data.target && data.target > 1
              ? `${data.current}/${data.target}`
              : data.done ? '已完成' : '未完成'}
            {data.overridden && <span className="ml-1 rounded bg-amber-200 px-1 text-amber-900">手动</span>}
          </div>
        )}
      </div>
      {!isEnd && (
        <Handle type="source" position={Position.Right} className="!size-2 !border-2" />
      )}
    </>
  );
}

const NODE_TYPES = { tg: TaskGraphNodeComponent };

// ─── Public component ─────────────────────────────────────────────────────

export interface TaskGraphRendererProps {
  graph: TaskGraph;
  presets: PresetSummary[];

  /** When provided, render in read-only mode with per-node done-state colored. */
  progress?: Record<string, TaskPointResult>;

  /** Set to enable editor mode — receives every graph mutation. */
  onChange?: (graph: TaskGraph) => void;

  /** Currently selected node (controlled). */
  selectedNodeId?: string | null;
  onNodeSelect?: (nodeId: string | null) => void;

  /** Height of the canvas. Defaults to 70vh. */
  height?: number | string;

  /** Extra controls slot (e.g. layout button). */
  extraControls?: ReactNode;
}

/** Drag-source MIME for toolbox → canvas drops. */
export const TOOLBOX_MIME = 'application/x-krypton-tasks-preset';

export function TaskGraphRenderer(props: TaskGraphRendererProps) {
  return (
    <ReactFlowProvider>
      <TaskGraphInner {...props} />
    </ReactFlowProvider>
  );
}

function presetIndex(presets: PresetSummary[]): Map<string, PresetSummary> {
  const m = new Map<string, PresetSummary>();
  for (const p of presets) m.set(p.id, p);
  return m;
}

function toRFNodes(graph: TaskGraph, presets: Map<string, PresetSummary>, progress?: Record<string, TaskPointResult>): RFNode<NodeDataShape>[] {
  return graph.nodes.map((n) => {
    const preset = n.presetId ? presets.get(n.presetId) : null;
    const r = progress?.[n.id];
    const isSentinel = n.type === 'start' || n.type === 'end';
    return {
      id: n.id,
      type: 'tg',
      position: n.position,
      // START / END nodes must always exist — block xyflow's keyboard-delete
      // path so an admin can't accidentally `Backspace` away the graph's anchors.
      // (Connection-removing the edges INTO them is still allowed.)
      deletable: !isSentinel,
      data: {
        variant: n.type,
        name: n.name,
        presetId: n.presetId,
        category: preset?.category,
        description: preset?.description,
        ...(r ? {
          done: r.completed,
          current: r.current,
          target: r.target,
          details: r.details,
          overridden: r.overridden,
        } : {}),
      },
    };
  });
}

// Edge styling — values tuned to roughly match GitHub Actions workflow graph:
//   - Default ~2.5 px slate so lines read well at any zoom level.
//   - Winning paths (progress mode) flip to emerald + light animation.
//   - Selected edges glow indigo with a thicker stroke + drop-shadow. Picked
//     indigo (not emerald or red) so selection is distinguishable from the
//     "completed path" color overlay even when both apply.
const EDGE_STROKE_DEFAULT = '#94a3b8';     // slate-400
const EDGE_STROKE_WINNING = '#10b981';     // emerald-500
const EDGE_STROKE_SELECTED = '#6366f1';    // indigo-500
const EDGE_WIDTH_DEFAULT = 2.5;
const EDGE_WIDTH_SELECTED = 4;

function buildEdgeStyle(isSelected: boolean, isWinning: boolean): React.CSSProperties {
  if (isSelected) {
    return {
      stroke: EDGE_STROKE_SELECTED,
      strokeWidth: EDGE_WIDTH_SELECTED,
      filter: 'drop-shadow(0 0 4px rgba(99, 102, 241, 0.55))',
    };
  }
  if (isWinning) {
    return { stroke: EDGE_STROKE_WINNING, strokeWidth: EDGE_WIDTH_DEFAULT };
  }
  return { stroke: EDGE_STROKE_DEFAULT, strokeWidth: EDGE_WIDTH_DEFAULT };
}

function toRFEdges(
  graph: TaskGraph,
  progress: Record<string, TaskPointResult> | undefined,
  selectedEdgeIds: ReadonlySet<string>,
  nodes?: TaskGraphNode[],
): Edge[] {
  const nodeById = new Map((nodes || graph.nodes).map((n) => [n.id, n]));
  return graph.edges.map((e) => {
    const fromNode = nodeById.get(e.from);
    const toNode = nodeById.get(e.to);
    let isWinning = false;
    if (progress && fromNode && toNode) {
      const fromOk = fromNode.type === 'start' || (fromNode.type === 'task' && progress[fromNode.id]?.completed);
      const toOk = toNode.type === 'end' || (toNode.type === 'task' && progress[toNode.id]?.completed);
      isWinning = fromOk && toOk;
    }
    const isSelected = selectedEdgeIds.has(e.id);
    const style = buildEdgeStyle(isSelected, isWinning);
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      animated: !!progress && isWinning,
      selected: isSelected,
      style,
      // Marker color must match the stroke or the arrowhead looks orphaned
      // when the edge is selected/winning. xyflow re-generates the marker
      // SVG def per (type, color) tuple so this is cheap.
      markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke as string },
      // Slightly larger interaction stroke for easier click — invisible but
      // helps users hit thin edges. xyflow puts this on `.react-flow__edge-interaction`.
      interactionWidth: 18,
    };
  });
}

function TaskGraphInner({
  graph, presets, progress, onChange, selectedNodeId, onNodeSelect,
  height, extraControls,
}: TaskGraphRendererProps) {
  const editable = !!onChange;
  const presetMap = useMemo(() => presetIndex(presets), [presets]);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // Observe the .dark class on <html> so xyflow's Controls/Background/MiniMap
  // recolor when the user toggles theme. xyflow v12 honors `colorMode` directly.
  const colorMode = useColorMode();

  // Derived RF state — we keep the graph state in the parent (controlled
  // pattern). xyflow expects to drive position changes locally for buttery
  // dragging, so we mirror graph→RFNodes on every parent update.
  const [rfNodes, setRfNodes] = useState<RFNode<NodeDataShape>[]>(
    () => toRFNodes(graph, presetMap, progress),
  );
  // Edge-selection state — kept in React (not just xyflow's internal) so we
  // can re-style edges (GitHub-Actions-like indigo glow) on selection change.
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(() => new Set());
  const [rfEdges, setRfEdges] = useState<Edge[]>(
    () => toRFEdges(graph, progress, selectedEdgeIds),
  );

  // Re-derive when parent graph or progress changes.
  // We compare structurally on a serialized key so re-renders with same data
  // don't trash position state during drag.
  const graphKey = useMemo(() => JSON.stringify({
    n: graph.nodes.map((n) => ({ i: n.id, t: n.type, p: n.presetId, na: n.name, pa: n.params })),
    e: graph.edges.map((e) => [e.id, e.from, e.to]),
    pk: progress ? Object.keys(progress).sort().map((k) => `${k}:${progress[k].completed ? 1 : 0}:${progress[k].current}/${progress[k].target}${progress[k].overridden ? '*' : ''}`).join(',') : '',
  }), [graph, progress]);
  useEffect(() => {
    setRfNodes(toRFNodes(graph, presetMap, progress));
    setRfEdges(toRFEdges(graph, progress, selectedEdgeIds));
    // Drop stale selection ids if the user deleted the underlying edge.
    setSelectedEdgeIds((prev) => {
      const validIds = new Set(graph.edges.map((e) => e.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey]);

  // Re-stripe edges whenever selection changes (no full re-derive needed).
  useEffect(() => {
    setRfEdges((prev) => prev.map((e) => {
      const isSelected = selectedEdgeIds.has(e.id);
      if (!!e.selected === isSelected) return e;
      const fromNode = graph.nodes.find((n) => n.id === e.source);
      const toNode = graph.nodes.find((n) => n.id === e.target);
      let isWinning = false;
      if (progress && fromNode && toNode) {
        const fromOk = fromNode.type === 'start' || (fromNode.type === 'task' && progress[fromNode.id]?.completed);
        const toOk = toNode.type === 'end' || (toNode.type === 'task' && progress[toNode.id]?.completed);
        isWinning = fromOk && toOk;
      }
      const style = buildEdgeStyle(isSelected, isWinning);
      return {
        ...e,
        selected: isSelected,
        style,
        markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke as string },
      };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEdgeIds]);

  // Sync external `selectedNodeId` into RF's selection state.
  useEffect(() => {
    setRfNodes((nodes) => nodes.map((n) => ({
      ...n,
      selected: selectedNodeId === n.id,
    })));
  }, [selectedNodeId]);

  // ─── Edit handlers (only wired when editable) ────────────────────────

  const onNodesChange = useCallback((changes: NodeChange<RFNode<NodeDataShape>>[]) => {
    setRfNodes((prev) => applyNodeChanges(changes, prev));
    if (!editable) return;

    // Two persistable changes:
    //   - 'position' (drag): update node coordinates
    //   - 'remove'   (Delete key): drop node + every edge touching it
    const positional = changes.filter((c) => c.type === 'position' && (c as any).position);
    const removed = changes
      .filter((c) => c.type === 'remove')
      .map((c: any) => c.id as string)
      .filter((id) => {
        const node = graph.nodes.find((n) => n.id === id);
        return node && node.type === 'task'; // sentinels protected via `deletable: false`
      });

    if (!positional.length && !removed.length) return;

    let nextNodes = graph.nodes;
    if (positional.length) {
      nextNodes = nextNodes.map((n) => {
        const c = positional.find((cc: any) => cc.id === n.id);
        if (!c) return n;
        return { ...n, position: { x: (c as any).position.x, y: (c as any).position.y } };
      });
    }
    if (removed.length) {
      const removedSet = new Set(removed);
      nextNodes = nextNodes.filter((n) => !removedSet.has(n.id));
      const nextEdges = graph.edges.filter((e) => !removedSet.has(e.from) && !removedSet.has(e.to));
      onChange!({ nodes: nextNodes, edges: nextEdges });
      // Clear selection if the deleted node was selected.
      if (selectedNodeId && removedSet.has(selectedNodeId)) onNodeSelect?.(null);
      return;
    }
    onChange!({ ...graph, nodes: nextNodes });
  }, [editable, graph, onChange, selectedNodeId, onNodeSelect]);

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    setRfEdges((prev) => applyEdgeChanges(changes, prev));
    if (editable) {
      const removed = changes.filter((c) => c.type === 'remove').map((c: any) => c.id);
      if (removed.length) {
        onChange!({ ...graph, edges: graph.edges.filter((e) => !removed.includes(e.id)) });
      }
    }
  }, [editable, graph, onChange]);

  const onConnect: OnConnect = useCallback((conn) => {
    if (!editable || !conn.source || !conn.target) return;
    if (conn.source === conn.target) return;
    // Don't allow incoming to 'start' or outgoing from 'end'.
    const src = graph.nodes.find((n) => n.id === conn.source);
    const tgt = graph.nodes.find((n) => n.id === conn.target);
    if (!src || !tgt) return;
    if (tgt.type === 'start' || src.type === 'end') return;
    // No duplicate.
    if (graph.edges.some((e) => e.from === conn.source && e.to === conn.target)) return;
    const newEdge: TaskGraphEdge = {
      id: `e_${Math.random().toString(36).slice(2, 9)}`,
      from: conn.source,
      to: conn.target,
    };
    onChange!({ ...graph, edges: [...graph.edges, newEdge] });
  }, [editable, graph, onChange]);

  const { screenToFlowPosition } = useReactFlow();

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!editable) return;
    event.preventDefault();
    const presetId = event.dataTransfer.getData(TOOLBOX_MIME);
    if (!presetId) return;
    const preset = presetMap.get(presetId);
    if (!preset) return;
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const defaults: Record<string, any> = {};
    for (const p of preset.params || []) {
      if (p.default !== undefined) defaults[p.name] = p.default;
    }
    const newNode: TaskGraphNode = {
      id: `t_${Math.random().toString(36).slice(2, 9)}`,
      type: 'task',
      position,
      presetId,
      name: preset.name,
      params: defaults,
    };
    onChange!({ ...graph, nodes: [...graph.nodes, newNode] });
    onNodeSelect?.(newNode.id);
  }, [editable, graph, onChange, onNodeSelect, presetMap, screenToFlowPosition]);

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!editable) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, [editable]);

  const onNodeClick = useCallback((_: any, node: RFNode<NodeDataShape>) => {
    onNodeSelect?.(node.id);
    setSelectedEdgeIds(new Set()); // clicking a node clears edge selection
  }, [onNodeSelect]);

  const onPaneClick = useCallback(() => {
    onNodeSelect?.(null);
    setSelectedEdgeIds(new Set());
  }, [onNodeSelect]);

  const onEdgeClick = useCallback((_: any, edge: Edge) => {
    setSelectedEdgeIds(new Set([edge.id]));
    onNodeSelect?.(null);
  }, [onNodeSelect]);

  // Double-click an edge to delete it — discoverable alternative to
  // "select edge + press Delete/Backspace". The keyboard path stays wired
  // via `deleteKeyCode` below for power-users.
  const onEdgeDoubleClick = useCallback((_: any, edge: Edge) => {
    if (!editable) return;
    if (!window.confirm('删除这条连线？')) return;
    onChange!({ ...graph, edges: graph.edges.filter((e) => e.id !== edge.id) });
  }, [editable, graph, onChange]);

  return (
    <div
      ref={wrapperRef}
      className="relative w-full overflow-hidden rounded-md border bg-card"
      style={{ height: height ?? '70vh' }}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={NODE_TYPES}
        colorMode={colorMode}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onEdgeClick={onEdgeClick}
        onEdgeDoubleClick={editable ? onEdgeDoubleClick : undefined}
        // Backspace + Delete both trigger removal of selected nodes/edges.
        // Without an explicit array, xyflow defaults to ['Backspace'] which
        // doesn't fire on macOS forward-Delete keys.
        deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
        nodesDraggable={editable}
        nodesConnectable={editable}
        elementsSelectable={true}
        edgesFocusable={editable}
        proOptions={{ hideAttribution: true }}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} />
        {extraControls}
      </ReactFlow>
    </div>
  );
}
