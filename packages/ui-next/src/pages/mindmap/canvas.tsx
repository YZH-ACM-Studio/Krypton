import '@xyflow/react/dist/style.css';

import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, useReactFlow, type Node as RFNode } from '@xyflow/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { useColorMode } from '@/lib/use-color-mode';
import { computeMindmapLayout, type MindmapNodeData } from './layout';
import type { MindmapConfig, MindmapNode } from './types';

const COLOR_STYLES: Record<string, string> = {
  gray: 'bg-card border-border',
  sky: 'bg-sky-50 border-sky-300 dark:bg-sky-950/30 dark:border-sky-700/50',
  blue: 'bg-blue-50 border-blue-300 dark:bg-blue-950/30 dark:border-blue-700/50',
  green: 'bg-emerald-50 border-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-700/50',
  amber: 'bg-amber-50 border-amber-300 dark:bg-amber-950/30 dark:border-amber-700/50',
  rose: 'bg-rose-50 border-rose-300 dark:bg-rose-950/30 dark:border-rose-700/50',
  purple: 'bg-purple-50 border-purple-300 dark:bg-purple-950/30 dark:border-purple-700/50',
};

function MindmapNodeView({ data }: { data: MindmapNodeData }) {
  const toggle = data.onToggleCollapse;
  return (
    <>
      <Handle type="target" id="tgt-left" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="target" id="tgt-right" position={Position.Right} style={{ opacity: 0 }} />
      <div
        className={cn(
          'flex h-full w-full items-center justify-center rounded-xl border px-3 py-2 text-sm shadow-sm transition-[box-shadow,border-color] duration-200 motion-reduce:transition-none',
          COLOR_STYLES[data.color || 'gray'] || COLOR_STYLES.gray,
          data.selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
          data.isRoot && 'border-primary/60 bg-primary/10 font-semibold shadow-md',
        )}
      >
        <span className="truncate">{data.topic}</span>
        {data.hasChildren && toggle ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              toggle();
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className="ml-1.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={data.collapsed ? '展开子节点' : '收起子节点'}
          >
            {data.collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        ) : null}
      </div>
      <Handle type="source" id="src-left" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" id="src-right" position={Position.Right} style={{ opacity: 0 }} />
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
}: {
  nodes: MindmapNode[];
  config: MindmapConfig;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  collapsed?: Set<string>;
  onCollapsedChange?: (value: Set<string>) => void;
}) {
  const [internalCollapsed, setInternalCollapsed] = useState(() => initialCollapsedNodes(nodes, config.rootNodeId));
  const collapsed = controlledCollapsed || internalCollapsed;
  const setCollapsed = onCollapsedChange || setInternalCollapsed;
  const [flowNodes, setFlowNodes] = useState<RFNode<MindmapNodeData>[]>([]);
  const [flowEdges, setFlowEdges] = useState<Awaited<ReturnType<typeof computeMindmapLayout>>['edges']>([]);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const selectedIdRef = useRef(selectedId);
  const { fitView } = useReactFlow();
  const colorMode = useColorMode();

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
    let cancelled = false;
    setLayoutError(null);
    void computeMindmapLayout(nodes, config.rootNodeId, collapsed)
      .then((layout) => {
        if (cancelled) return;
        setFlowNodes(
          layout.nodes.map((node) => ({
            ...node,
            data: { ...node.data, selected: node.id === selectedIdRef.current, onToggleCollapse: () => toggleCollapse(node.id) },
          })),
        );
        setFlowEdges(layout.edges);
        window.requestAnimationFrame(() => {
          if (!cancelled) void fitView({ padding: 0.16 });
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
  }, [nodes, config.rootNodeId, collapsed, toggleCollapse, fitView]);

  const nodeTypes = useMemo(() => NODE_TYPES, []);
  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        colorMode={colorMode}
        onNodeClick={(_, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.16 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} className="opacity-60" />
        <Controls showInteractive={false} />
      </ReactFlow>
      {layoutError ? (
        <div className="absolute inset-x-4 top-4 z-20 rounded-xl border border-destructive/20 bg-background/95 px-4 py-3 text-sm text-destructive shadow-sm">
          导图布局失败：{layoutError}
        </div>
      ) : null}
    </div>
  );
}
