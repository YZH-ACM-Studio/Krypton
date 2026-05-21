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
  ChevronDown, ChevronUp, Edit3, Network, Plus, RefreshCw, Save, Search,
  Sparkles, Trash2, X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { useBootstrap } from '@/lib/bootstrap';
import { PRIV } from '@/lib/perms';
import { cn } from '@/lib/cn';

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
  [key: string]: unknown;
}

function MindmapNodeComponent({ data }: { data: NodeData }) {
  const color = COLOR_BG[data.color || 'gray'] || COLOR_BG.gray;
  return (
    <>
      {/* Edge handles — invisible but required for react-flow edge wiring. */}
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div
        className={cn(
          'flex h-full w-full items-center justify-center rounded-lg border px-3 py-2 text-sm transition-colors',
          color,
          data.selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
          data.isRoot && 'border-primary/60 bg-primary/10 font-semibold',
        )}
      >
        <span className="truncate">{data.topic}</span>
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </>
  );
}

const NODE_TYPES = { mindmap: MindmapNodeComponent };

interface LayoutResult { nodes: RFNode<NodeData>[]; edges: Edge[] }

/**
 * Run ELK layered layout. Honors per-node `position` overrides — those nodes
 * are pinned (have their x/y locked) and ELK routes around them.
 */
async function computeLayout(
  raw: MindmapNode[], rootId: string | null, direction: 'RIGHT' | 'DOWN',
): Promise<LayoutResult> {
  if (!raw.length) return { nodes: [], edges: [] };

  const children: Record<string, string[]> = {};
  for (const n of raw) {
    if (n.parentId) {
      if (!children[n.parentId]) children[n.parentId] = [];
      children[n.parentId].push(n._id);
    }
  }

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      // Generous spacing — 49-node default tree benefits from breathing room
      // so the user can actually read leaf labels at default zoom.
      'elk.spacing.nodeNode': '20',
      'elk.layered.spacing.nodeNodeBetweenLayers': '120',
      'elk.layered.spacing.edgeNodeBetweenLayers': '40',
      'elk.spacing.edgeNode': '20',
      'elk.padding': '[top=40,left=40,bottom=40,right=40]',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: raw.map((n) => ({
      id: n._id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: raw.filter((n) => n.parentId).map((n) => ({
      id: `e-${n.parentId}-${n._id}`,
      sources: [n.parentId as string],
      targets: [n._id],
    })),
  };

  const layouted = await elk.layout(elkGraph as any);

  const positions = new Map<string, { x: number; y: number }>();
  for (const c of layouted.children || []) {
    positions.set(c.id, { x: c.x || 0, y: c.y || 0 });
  }

  const nodes: RFNode<NodeData>[] = raw.map((n) => {
    const elkPos = positions.get(n._id) || { x: 0, y: 0 };
    const pos = n.position || elkPos;
    return {
      id: n._id,
      type: 'mindmap',
      position: pos,
      data: {
        topic: n.topic,
        color: n.color,
        isRoot: n._id === rootId,
        hasChildren: !!children[n._id]?.length,
      },
      // react-flow looks at `style` for explicit dimensions; without these
      // the custom node falls back to the library default (~150x36) and our
      // tailwind h-full / w-full classes collapse to that default.
      style: { width: NODE_WIDTH, height: NODE_HEIGHT },
    };
  });
  const edges: Edge[] = raw.filter((n) => n.parentId).map((n) => ({
    id: `e-${n.parentId}-${n._id}`,
    source: n.parentId as string,
    target: n._id,
    type: 'default',
    style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5, opacity: 0.6 },
  }));
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

  const [editMode, setEditMode] = useState(false);
  const [rawNodes, setRawNodes] = useState<MindmapNode[]>(initialData.nodes);
  const [rfNodes, setRfNodes] = useState<RFNode<NodeData>[]>([]);
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [problems, setProblems] = useState<PanelProblem[]>([]);
  const [problemsLoading, setProblemsLoading] = useState(false);
  const [problemSearch, setProblemSearch] = useState('');
  const [problemSort, setProblemSort] = useState<'pid' | 'difficulty' | 'accept'>('pid');

  // Initial layout.
  useEffect(() => {
    let cancelled = false;
    computeLayout(rawNodes, initialData.config.rootNodeId, initialData.config.layoutDirection)
      .then(({ nodes, edges }) => {
        if (cancelled) return;
        setRfNodes(nodes);
        setRfEdges(edges);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawNodes.length, initialData.config.layoutDirection]);

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
              <div className="flex-1 overflow-y-auto">
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
              </div>
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
    <aside className="absolute right-[372px] top-12 z-30 w-80 rounded-lg border bg-card shadow-2xl">
      <header className="flex items-center justify-between border-b px-4 py-2.5">
        <span className="text-sm font-medium">编辑节点</span>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </header>
      <div className="krypton-scrollbar max-h-[70vh] space-y-3 overflow-y-auto p-4">
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
          <select value={color} onChange={(e) => setColor(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm">
            {Object.keys(COLOR_BG).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Tags（逗号分隔，匹配 Hydro 题目 tag）</label>
          <Input value={tagsCsv} onChange={(e) => setTagsCsv(e.target.value)} placeholder="dp, 区间DP" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">手动 Problem IDs（逗号分隔）</label>
          <Input value={problemIdsCsv} onChange={(e) => setProblemIdsCsv(e.target.value)} placeholder="P1001, P1002" />
        </div>
      </div>
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
