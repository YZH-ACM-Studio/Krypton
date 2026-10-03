import '@xyflow/react/dist/style.css';

import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, useReactFlow, type Node as RFNode } from '@xyflow/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
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

function nodeToneStyle(color: string | undefined, isRoot: boolean): { backgroundColor: string; borderColor: string } | undefined {
  if (isRoot || !color || color === 'gray') return undefined;
  return NODE_TONE_STYLE[color];
}

function MindmapNodeView({ data }: { data: MindmapNodeData }) {
  const toggle = data.onToggleCollapse;
  return (
    <>
      <Handle type="target" id="tgt-left" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="target" id="tgt-right" position={Position.Right} style={{ opacity: 0 }} />
      <Handle type="target" id="tgt-top" position={Position.Top} style={{ opacity: 0 }} />
      <div
        className="flex h-full w-full items-center justify-center rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg shadow-xs transition-[background-color,border-color,box-shadow] duration-(--dur-1) ease-(--ease-standard) motion-reduce:transition-none data-[dimmed=true]:opacity-45 data-[root=true]:border-brand data-[root=true]:bg-brand-soft data-[root=true]:font-semibold data-[selected=true]:ring-2 data-[selected=true]:ring-ring"
        data-dimmed={data.dimmed && !data.selected ? 'true' : undefined}
        data-root={data.isRoot ? 'true' : undefined}
        data-selected={data.selected ? 'true' : undefined}
        style={nodeToneStyle(data.color, data.isRoot === true)}
      >
        <span className="truncate">{data.topic}</span>
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
            className="-my-2 -mr-2 ml-1.5 size-10 shrink-0"
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
}: {
  nodes: MindmapNode[];
  config: MindmapConfig;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  collapsed?: Set<string>;
  onCollapsedChange?: (value: Set<string>) => void;
  emphasizedIds?: ReadonlySet<string>;
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
    void computeMindmapLayout(nodes, config.rootNodeId, collapsed, config.layoutDirection)
      .then((layout) => {
        if (cancelled) return;
        setFlowNodes(
          layout.nodes.map((node) => ({
            ...node,
            data: {
              ...node.data,
              selected: node.id === selectedIdRef.current,
              dimmed: emphasizedIds ? !emphasizedIds.has(node.id) : false,
              onToggleCollapse: () => toggleCollapse(node.id),
            },
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
  }, [nodes, config.rootNodeId, config.layoutDirection, collapsed, toggleCollapse, fitView, emphasizedIds]);

  const nodeTypes = useMemo(() => NODE_TYPES, []);
  return (
    <div className="relative h-full min-h-0 w-full">
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
        <div className="absolute inset-x-4 top-4 z-20 rounded-lg border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-fg shadow-xs">
          导图布局失败：{layoutError}
        </div>
      ) : null}
    </div>
  );
}
