/**
 * krypton-mindmap page — single global tree rendered with @xyflow/react,
 * laid out by elkjs. Public read mode + admin edit mode toggle.
 *
 * Layout:
 *   - 70% canvas (left): react-flow with custom node component
 *   - 30% panel (right): problems for the clicked node (always visible)
 *   - Edit mode (admin only): node selection opens a right-side drawer
 *     for tags / problemIds / color editing; double-click rename;
 *     Enter = add child, Tab = add sibling, Delete = remove.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, Controls, Handle, Position, ReactFlow,
  ReactFlowProvider, applyNodeChanges, addEdge,
  type Edge, type Node as RFNode, type NodeChange, type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ELK from 'elkjs/lib/elk.bundled.js';
import {
  ChevronDown, ChevronRight, ChevronUp, Edit3, Network, Plus, RefreshCw, Save, Search,
  Sparkles, Trash2, X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import { useBootstrap } from '@/lib/bootstrap';
import { PRIV } from '@/lib/perms';
import { cn } from '@/lib/cn';
import { useColorMode } from '@/lib/use-color-mode';

interface MindmapNode {
  _id: string;
  parentId: string | null;
  topic: string;
  description?: string;
  color?: string;
  position?: { x: number; y: number };
  tags: string[];
  problemIds: string[];
  order: number;
}

interface MindmapConfig {
  title: string;
  rootNodeId: string | null;
  layoutDirection: 'RIGHT' | 'DOWN';
}

interface PanelProblem {
  pid: string;
  title: string;
  nSubmit: number;
  nAccept: number;
  difficulty: number;
}

const elk = new ELK();

const COLOR_BG: Record<string, string> = {
  gray: 'bg-card border-border',
  sky: 'bg-sky-50 border-sky-300 dark:bg-sky-950/30 dark:border-sky-700/50',
  blue: 'bg-blue-50 border-blue-300 dark:bg-blue-950/30 dark:border-blue-700/50',
  green: 'bg-emerald-50 border-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-700/50',
  amber: 'bg-amber-50 border-amber-300 dark:bg-amber-950/30 dark:border-amber-700/50',
  rose: 'bg-rose-50 border-rose-300 dark:bg-rose-950/30 dark:border-rose-700/50',
  purple: 'bg-purple-50 border-purple-300 dark:bg-purple-950/30 dark:border-purple-700/50',
};

const NODE_WIDTH = 160;
const NODE_HEIGHT = 44;

interface NodeData {
  topic: string;
  color?: string;
  isRoot?: boolean;
  selected?: boolean;
  hasChildren?: boolean;
  collapsed?: boolean;
  /** Which half of the mindmap this node lives in. Drives handle wiring. */
  side?: 'left' | 'right' | 'root';
  [key: string]: unknown;
}

/**
 * Each node renders 4 invisible handles so edges can wire onto whichever
 * side they need:
 *   - target handles ("tgt-left", "tgt-right") on both sides for incoming
 *     edges from the parent
 *   - source handles ("src-left", "src-right") on both sides for outgoing
 *     edges to children
 *
 * The actual edge then specifies `sourceHandle` + `targetHandle` ids based
 * on its child's side: a left-side child wants its parent's left source
 * and its own right target (so the edge enters from the right of the
 * child) — see edge construction in `computeLayout`.
 */
function MindmapNodeComponent({ data }: { data: NodeData }) {
  const color = COLOR_BG[data.color || 'gray'] || COLOR_BG.gray;
  const toggle = data.onToggleCollapse as (() => void) | undefined;
  return (
    <>
      <Handle type="target" id="tgt-left" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="target" id="tgt-right" position={Position.Right} style={{ opacity: 0 }} />
      <div
        className={cn(
          'flex h-full w-full items-center justify-center rounded-lg border px-3 py-2 text-sm transition-colors',
          color,
          data.selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
          data.isRoot && 'border-primary/60 bg-primary/10 font-semibold',
        )}
      >
        <span className="truncate">{data.topic}</span>
        {data.hasChildren && toggle ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggle(); }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="ml-1.5 inline-flex size-4 shrink-0 items-center justify-center rounded hover:bg-accent"
            title={data.collapsed ? '展开子节点' : '收起子节点'}
            aria-label={data.collapsed ? '展开' : '收起'}
          >
            {data.collapsed
              ? <ChevronRight className="size-3" />
              : <ChevronDown className="size-3" />}
          </button>
        ) : null}
      </div>
      <Handle type="source" id="src-left" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" id="src-right" position={Position.Right} style={{ opacity: 0 }} />
    </>
  );
}

const NODE_TYPES = { mindmap: MindmapNodeComponent };

interface LayoutResult { nodes: RFNode<NodeData>[]; edges: Edge[] }

/**
 * Compute a subset of `raw` nodes to actually render — anything whose
 * parent chain crosses a collapsed node is hidden. Returns both the
 * visible subset and the per-node `children` adjacency (used for the
 * `hasChildren` flag on the visible nodes' UI badges).
 */
function visibleSubset(
  raw: MindmapNode[],
  collapsed: ReadonlySet<string>,
): { visible: MindmapNode[]; children: Record<string, string[]> } {
  const children: Record<string, string[]> = {};
  for (const n of raw) {
    if (n.parentId) {
      if (!children[n.parentId]) children[n.parentId] = [];
      children[n.parentId].push(n._id);
    }
  }
  // Hide any node whose parent (or ancestor) is in `collapsed`.
  const hidden = new Set<string>();
  const sweep = (id: string) => {
    for (const c of children[id] || []) {
      hidden.add(c);
      sweep(c);
    }
  };
  for (const id of collapsed) sweep(id);
  const visible = raw.filter((n) => !hidden.has(n._id));
  return { visible, children };
}

/**
 * Bidirectional mindmap layout: split the root's direct children in half,
 * lay the left half out with `elk.direction=LEFT` and the right half with
 * `elk.direction=RIGHT`, then merge so the root sits at (0,0). Pure ELK
 * doesn't ship a "bidirectional tree" algorithm so we run it twice.
 *
 * Each subtree contains the root + half of categories + their descendants.
 * (The root is shared; we anchor it to (0,0) using the right-side layout's
 * coordinates and shift the left-side layout to match.)
 */
const SHARED_LAYOUT_OPTS = {
  'elk.algorithm': 'layered',
  'elk.spacing.nodeNode': '20',
  'elk.layered.spacing.nodeNodeBetweenLayers': '100',
  'elk.layered.spacing.edgeNodeBetweenLayers': '40',
  'elk.spacing.edgeNode': '20',
  'elk.padding': '[top=40,left=40,bottom=40,right=40]',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.edgeRouting': 'ORTHOGONAL',
};

async function layoutHalf(
  rootId: string,
  ids: Set<string>,
  visible: MindmapNode[],
  direction: 'LEFT' | 'RIGHT',
) {
  // Sort nodes by their `order` field so ELK's layered crossing
  // minimization gets stable input, keeping siblings in the same relative
  // position across expand/collapse cycles.
  const nodes = visible
    .filter((n) => ids.has(n._id))
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (nodes.length <= 1) return null;
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      ...SHARED_LAYOUT_OPTS,
      'elk.direction': direction,
      // Honor input order — siblings stay in their declared sequence so
      // expanding one node doesn't reshuffle the others to a different row.
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.crossingMinimization.semiInteractive': 'true',
    },
    children: nodes.map((n) => ({ id: n._id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: nodes
      .filter((n) => n.parentId && ids.has(n.parentId))
      .map((n) => ({
        id: `e-${n.parentId}-${n._id}`,
        sources: [n.parentId as string],
        targets: [n._id],
      })),
  };
  return elk.layout(elkGraph as any);
}

async function computeLayout(
  raw: MindmapNode[], rootId: string | null, _direction: 'RIGHT' | 'DOWN',
  collapsed: ReadonlySet<string> = new Set(),
): Promise<LayoutResult> {
  if (!raw.length || !rootId) return { nodes: [], edges: [] };

  const { visible, children: allChildren } = visibleSubset(raw, collapsed);
  const visibleIds = new Set(visible.map((n) => n._id));

  // Split root's visible direct children into two halves.
  const rootChildren = (allChildren[rootId] || []).filter((id) => visibleIds.has(id));
  const mid = Math.ceil(rootChildren.length / 2);
  const leftCats = rootChildren.slice(0, mid);
  const rightCats = rootChildren.slice(mid);

  // Collect each side's descendant id set (including root).
  function collectDescendants(catId: string, into: Set<string>) {
    into.add(catId);
    for (const c of allChildren[catId] || []) {
      if (visibleIds.has(c)) collectDescendants(c, into);
    }
  }
  const leftIds = new Set<string>([rootId]);
  const rightIds = new Set<string>([rootId]);
  for (const id of leftCats) collectDescendants(id, leftIds);
  for (const id of rightCats) collectDescendants(id, rightIds);

  const [leftLayouted, rightLayouted] = await Promise.all([
    layoutHalf(rootId, leftIds, visible, 'LEFT'),
    layoutHalf(rootId, rightIds, visible, 'RIGHT'),
  ]);

  // Anchor root at (0,0). For each subtree, find the laid-out root position
  // and translate all of that subtree's nodes by (-rootX, -rootY).
  const positions = new Map<string, { x: number; y: number }>();
  positions.set(rootId, { x: 0, y: 0 });
  function ingest(layouted: any, ids: Set<string>) {
    if (!layouted?.children) return;
    const rootEntry = layouted.children.find((c: any) => c.id === rootId);
    const dx = rootEntry?.x || 0;
    const dy = rootEntry?.y || 0;
    for (const c of layouted.children) {
      if (c.id === rootId) continue;
      if (!ids.has(c.id)) continue;
      positions.set(c.id, { x: (c.x || 0) - dx, y: (c.y || 0) - dy });
    }
  }
  ingest(leftLayouted, leftIds);
  ingest(rightLayouted, rightIds);

  // Per-node "side" — which half of the mindmap each node lives in.
  // Drives handle wiring so left-side nodes connect via their right edge
  // back to the root's left edge (and vice versa for the right half).
  const sideOf = new Map<string, 'left' | 'right' | 'root'>();
  sideOf.set(rootId, 'root');
  for (const id of leftIds) if (id !== rootId) sideOf.set(id, 'left');
  for (const id of rightIds) if (id !== rootId) sideOf.set(id, 'right');

  const nodes: RFNode<NodeData>[] = visible.map((n) => {
    const elkPos = positions.get(n._id) || { x: 0, y: 0 };
    const pos = n.position || elkPos;
    const childCount = allChildren[n._id]?.length || 0;
    const side = sideOf.get(n._id) || 'right';
    return {
      id: n._id,
      type: 'mindmap',
      position: pos,
      data: {
        topic: n.topic,
        color: n.color,
        isRoot: n._id === rootId,
        hasChildren: childCount > 0,
        collapsed: collapsed.has(n._id),
        side,
      },
      // react-flow looks at `style` for explicit dimensions; without these
      // the custom node falls back to the library default (~150x36) and our
      // tailwind h-full / w-full classes collapse to that default.
      style: { width: NODE_WIDTH, height: NODE_HEIGHT },
    };
  });
  // Edge wiring: a child on the left half connects its *right* edge back
  // to its parent's *left* edge; right-half children do the mirror.
  const edges: Edge[] = visible
    .filter((n) => n.parentId && visibleIds.has(n.parentId))
    .map((n) => {
      const childSide = sideOf.get(n._id) || 'right';
      const useLeft = childSide === 'left';
      return {
        id: `e-${n.parentId}-${n._id}`,
        source: n.parentId as string,
        target: n._id,
        sourceHandle: useLeft ? 'src-left' : 'src-right',
        targetHandle: useLeft ? 'tgt-right' : 'tgt-left',
        type: 'default',
        style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5, opacity: 0.6 },
      };
    });
  return { nodes, edges };
}

function difficultyChip(d: number): string {
  if (d <= 1) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200';
  if (d <= 2) return 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200';
  if (d <= 3) return 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200';
  if (d <= 4) return 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200';
  if (d <= 5) return 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200';
  return 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200';
}

/* ─────────────────────────── Main page ─────────────────────────── */

export function MindmapPage() {
  return (
    <ReactFlowProvider>
      <MindmapInner />
    </ReactFlowProvider>
  );
}

function MindmapInner() {
  const bs = useBootstrap();
  const initialData = bs.page.data as {
    nodes: MindmapNode[];
    config: MindmapConfig;
  };
  const canEdit = (bs.user.priv & PRIV.PRIV_EDIT_SYSTEM) !== 0;
  // Re-render xyflow Controls/Background/MiniMap when the user flips theme.
  const colorMode = useColorMode();

  const [editMode, setEditMode] = useState(false);
  const [rawNodes, setRawNodes] = useState<MindmapNode[]>(initialData.nodes);
  const [rfNodes, setRfNodes] = useState<RFNode<NodeData>[]>([]);
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [problems, setProblems] = useState<PanelProblem[]>([]);
  const [problemsLoading, setProblemsLoading] = useState(false);
  const [problemSearch, setProblemSearch] = useState('');
  const [problemSort, setProblemSort] = useState<'pid' | 'difficulty' | 'accept'>('pid');

  // Collapsed = the user can only see the root and its direct children by
  // default. Every level-1 (root's direct children, i.e. the "categories")
  // starts collapsed so its level-2 leaves are hidden until the user
  // expands. Deeper levels are also collapsed by inheritance because once
  // their parent (a level-1 category) is collapsed the whole subtree is
  // invisible anyway.
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => {
    const rootId = initialData.config.rootNodeId;
    if (!rootId) return new Set();
    const level1 = initialData.nodes
      .filter((n) => n.parentId === rootId)
      .map((n) => n._id);
    return new Set(level1);
  });

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedNodes((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Layout — re-runs whenever the tree shape OR the collapsed set changes.
  useEffect(() => {
    let cancelled = false;
    computeLayout(
      rawNodes,
      initialData.config.rootNodeId,
      initialData.config.layoutDirection,
      collapsedNodes,
    ).then(({ nodes, edges }) => {
      if (cancelled) return;
      // Inject the per-node toggle callback so the in-node ▾/▸ button
      // can call back into this component.
      const withCallbacks = nodes.map((n) => ({
        ...n,
        data: { ...n.data, onToggleCollapse: () => toggleCollapse(n.id) },
      }));
      setRfNodes(withCallbacks);
      setRfEdges(edges);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawNodes.length, initialData.config.layoutDirection, collapsedNodes]);

  // Selection sync.
  useEffect(() => {
    setRfNodes((nodes) => nodes.map((n) => ({
      ...n,
      data: { ...n.data, selected: n.id === selectedId },
    })));
  }, [selectedId]);

  // Fetch problems for selected node.
  useEffect(() => {
    if (!selectedId) { setProblems([]); return; }
    setProblemsLoading(true);
    fetch(`/api/mindmap/problems?nodeId=${selectedId}`, { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((body) => setProblems(body.problems || []))
      .catch(() => setProblems([]))
      .finally(() => setProblemsLoading(false));
  }, [selectedId]);

  const selectedNode = selectedId ? rawNodes.find((n) => n._id === selectedId) : null;

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds) as RFNode<NodeData>[]);
  }, []);

  const onConnect: OnConnect = useCallback((conn) => {
    setRfEdges((eds) => addEdge(conn, eds));
  }, []);

  const onNodeClick = useCallback((_: any, node: RFNode) => {
    setSelectedId(node.id);
  }, []);

  const filteredProblems = useMemo(() => {
    let list = problems;
    if (problemSearch.trim()) {
      const q = problemSearch.trim().toLowerCase();
      list = list.filter((p) => p.pid.toLowerCase().includes(q) || p.title.toLowerCase().includes(q));
    }
    if (problemSort === 'pid') list = [...list].sort((a, b) => a.pid.localeCompare(b.pid));
    else if (problemSort === 'difficulty') list = [...list].sort((a, b) => a.difficulty - b.difficulty);
    else if (problemSort === 'accept') list = [...list].sort((a, b) => b.nAccept - a.nAccept);
    return list;
  }, [problems, problemSearch, problemSort]);

  return (
    <div className="flex h-[calc(100dvh-6rem)] gap-3">
      {/* Left: canvas */}
      <div className="relative flex-1 overflow-hidden rounded-lg border bg-background">
        <header className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between border-b bg-background/80 px-4 py-2 backdrop-blur">
          <div className="flex items-center gap-2">
            <Network className="size-4 text-primary" />
            <h1 className="text-sm font-semibold">{initialData.config.title}</h1>
            <span className="text-xs text-muted-foreground">{rawNodes.length} 节点</span>
          </div>
          {canEdit && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant={editMode ? 'default' : 'outline'} onClick={() => setEditMode((v) => !v)} className="gap-1">
                <Edit3 className="size-3.5" />
                {editMode ? '退出编辑' : '编辑模式'}
              </Button>
              {editMode && (
                <Button
                  size="sm" variant="outline"
                  onClick={async () => {
                    if (!confirm('重置所有节点的手动位置覆盖？')) return;
                    const form = new URLSearchParams();
                    form.set('operation', 'resetLayout');
                    await fetch('/admin/mindmap/config', { method: 'POST', body: form });
                    window.location.reload();
                  }}
                  className="gap-1"
                >
                  <RefreshCw className="size-3.5" />
                  重置布局
                </Button>
              )}
            </div>
          )}
        </header>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={NODE_TYPES}
          colorMode={colorMode}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={() => setSelectedId(null)}
          nodesDraggable={editMode}
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
          maxZoom={2.5}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {/* Right: problem panel (always visible) */}
      <aside className="flex w-[360px] flex-col gap-3 overflow-hidden">
        <Card className="flex flex-1 flex-col overflow-hidden">
          <header className="border-b p-3.5">
            {selectedNode ? (
              <>
                <p className="text-xs text-muted-foreground">节点</p>
                <h2 className="truncate text-base font-semibold">{selectedNode.topic}</h2>
                {selectedNode.description && (
                  <p className="mt-1 text-xs text-muted-foreground">{selectedNode.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedNode.tags.map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                  ))}
                </div>
              </>
            ) : (
              <p className="py-4 text-center text-xs text-muted-foreground">
                <Sparkles className="mx-auto mb-1 size-4" />
                点击左侧任意节点查看相关题目
              </p>
            )}
          </header>

          {selectedNode && (
            <>
              <div className="flex flex-col gap-2 border-b p-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-8 pl-8 text-xs" placeholder="搜索题号 / 标题"
                    value={problemSearch} onChange={(e) => setProblemSearch(e.target.value)}
                  />
                </div>
                <MiniTabs
                  size="sm"
                  value={problemSort}
                  onValueChange={(v) => setProblemSort(v as any)}
                  items={[
                    { value: 'pid', label: '题号' },
                    { value: 'difficulty', label: '难度' },
                    { value: 'accept', label: '通过数' },
                  ]}
                />
              </div>
              <ScrollArea className="flex-1">
                {problemsLoading ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">加载中…</p>
                ) : filteredProblems.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    {problems.length === 0 ? '此节点暂无关联题目' : '无匹配题目'}
                  </p>
                ) : (
                  <ul className="divide-y">
                    {filteredProblems.map((p) => (
                      <li key={p.pid}>
                        <a
                          href={`/p/${p.pid}`}
                          className="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-accent/40"
                        >
                          <span className={cn(
                            'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold',
                            difficultyChip(p.difficulty),
                          )}>
                            {p.difficulty}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{p.title}</p>
                            <p className="font-mono text-[10px] text-muted-foreground">
                              {p.pid} · {p.nAccept}/{p.nSubmit}
                            </p>
                          </div>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </>
          )}
        </Card>
      </aside>

      {editMode && selectedNode && (
        <NodeEditorDrawer
          node={selectedNode}
          onClose={() => setSelectedId(null)}
          onSaved={(updated) => {
            setRawNodes((prev) => prev.map((n) => (n._id === updated._id ? updated : n)));
          }}
          onDeleted={(id) => {
            setRawNodes((prev) => prev.filter((n) => n._id !== id && n.parentId !== id));
            setSelectedId(null);
          }}
          onChildCreated={(child) => {
            setRawNodes((prev) => [...prev, child]);
          }}
        />
      )}
    </div>
  );
}

function NodeEditorDrawer({
  node, onClose, onSaved, onDeleted, onChildCreated,
}: {
  node: MindmapNode;
  onClose: () => void;
  onSaved: (n: MindmapNode) => void;
  onDeleted: (id: string) => void;
  onChildCreated: (n: MindmapNode) => void;
}) {
  const [topic, setTopic] = useState(node.topic);
  const [description, setDescription] = useState(node.description || '');
  const [color, setColor] = useState(node.color || 'gray');
  const [tagsCsv, setTagsCsv] = useState(node.tags.join(', '));
  const [problemIdsCsv, setProblemIdsCsv] = useState(node.problemIds.join(', '));
  const [saving, setSaving] = useState(false);

  // Reset state when node changes.
  useEffect(() => {
    setTopic(node.topic);
    setDescription(node.description || '');
    setColor(node.color || 'gray');
    setTagsCsv(node.tags.join(', '));
    setProblemIdsCsv(node.problemIds.join(', '));
  }, [node._id]);

  const save = async () => {
    setSaving(true);
    const form = new URLSearchParams();
    form.set('operation', 'update');
    form.set('id', node._id);
    form.set('topic', topic);
    form.set('description', description);
    form.set('color', color);
    form.set('tagsCsv', tagsCsv);
    form.set('problemIdsCsv', problemIdsCsv);
    await fetch('/admin/mindmap/nodes', { method: 'POST', body: form });
    setSaving(false);
    onSaved({
      ...node,
      topic, description, color,
      tags: tagsCsv.split(',').map((s) => s.trim()).filter(Boolean),
      problemIds: problemIdsCsv.split(',').map((s) => s.trim()).filter(Boolean),
    });
  };

  const addChild = async () => {
    const newTopic = prompt('新子节点名称：');
    if (!newTopic) return;
    const form = new URLSearchParams();
    form.set('operation', 'create');
    form.set('parentId', node._id);
    form.set('topic', newTopic);
    const res = await fetch('/admin/mindmap/nodes', { method: 'POST', body: form });
    const body = await res.json().catch(() => ({}));
    if (body.node) onChildCreated(body.node);
  };

  const remove = async () => {
    if (!confirm(`删除节点「${node.topic}」及其所有子节点？`)) return;
    const form = new URLSearchParams();
    form.set('operation', 'delete');
    form.set('id', node._id);
    await fetch('/admin/mindmap/nodes', { method: 'POST', body: form });
    onDeleted(node._id);
  };

  return (
    <aside className="absolute right-[372px] top-12 z-30 w-80 overflow-hidden rounded-lg border bg-card shadow-2xl">
      <header className="flex items-center justify-between border-b px-4 py-2.5">
        <span className="text-sm font-medium">编辑节点</span>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </header>
      <ScrollArea className="h-[70vh]" viewportClassName="space-y-3 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium">名称</label>
          <Input value={topic} onChange={(e) => setTopic(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">描述（hover 显示）</label>
          <textarea
            value={description} onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border bg-background p-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">配色</label>
          <SimpleSelect
            value={color}
            onValueChange={setColor}
            options={Object.keys(COLOR_BG).map((c) => ({ value: c, label: c }))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Tags（逗号分隔，匹配 Hydro 题目 tag）</label>
          <Input value={tagsCsv} onChange={(e) => setTagsCsv(e.target.value)} placeholder="dp, 区间DP" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">手动 Problem IDs（逗号分隔）</label>
          <Input value={problemIdsCsv} onChange={(e) => setProblemIdsCsv(e.target.value)} placeholder="P1001, P1002" />
        </div>
      </ScrollArea>
      <div className="flex items-center justify-between gap-2 border-t bg-muted/20 px-4 py-2.5">
        <Button variant="outline" size="sm" onClick={remove} className="gap-1 text-destructive">
          <Trash2 className="size-3.5" />
          删除
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addChild} className="gap-1">
            <Plus className="size-3.5" />
            子节点
          </Button>
          <Button size="sm" onClick={save} disabled={saving} className="gap-1">
            <Save className="size-3.5" />
            保存
          </Button>
        </div>
      </div>
    </aside>
  );
}
