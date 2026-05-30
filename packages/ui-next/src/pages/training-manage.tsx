/**
 * Training management pages — edit and files.
 */

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  FolderOpen,
  GripVertical,
  Plus,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { Checkbox } from '@/components/ui/checkbox';
import { ProblemPicker } from '@/components/problem-picker';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime, replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;
type TrainingPlanNode = {
  _id: number;
  title: string;
  requireNids: number[];
  pids: Array<string | number>;
};

const DEFAULT_PLAN: TrainingPlanNode[] = [
  {
    _id: 1,
    title: '最初的最初 - A+B Problem',
    requireNids: [],
    pids: ['P1000'],
  },
  {
    _id: 2,
    title: '最初的进阶',
    requireNids: [1],
    pids: [2, 3],
  },
];

function normalizeToken(value: string): string | number {
  const token = value.trim();
  if (/^\d+$/.test(token)) return Number(token);
  return token;
}

function parseTokenList(value: string): Array<string | number> {
  return value
    .split(/[\s,，]+/)
    .map(normalizeToken)
    .filter((token) => token !== '');
}

function uniqueValues<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function normalizePlanNode(node: R, index: number): TrainingPlanNode {
  const id = Number(node._id || node.id || index + 1);
  return {
    _id: Number.isSafeInteger(id) && id > 0 ? id : index + 1,
    title: String(node.title || `阶段 ${index + 1}`),
    requireNids: Array.isArray(node.requireNids)
      ? uniqueValues(node.requireNids.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))
      : [],
    pids: Array.isArray(node.pids)
      ? uniqueValues(node.pids.map((value) => typeof value === 'number' ? value : normalizeToken(String(value))).filter((value) => value !== ''))
      : [],
  };
}

function parsePlan(value: unknown): TrainingPlanNode[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? JSON.parse(value)
      : DEFAULT_PLAN;
  if (!Array.isArray(source)) return DEFAULT_PLAN;
  const nodes = source.map(normalizePlanNode).filter((node) => node.title && node.pids.length > 0);
  return nodes.length ? nodes : DEFAULT_PLAN;
}

function serializePlan(nodes: TrainingPlanNode[]) {
  return JSON.stringify(
    nodes.map((node) => ({
      _id: node._id,
      title: node.title,
      requireNids: uniqueValues(node.requireNids).filter((id) => id !== node._id),
      pids: uniqueValues(node.pids),
    })),
    null,
    2,
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/* ---------- Training Edit ---------- */

export function TrainingEditPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const isEdit = data.page_name === 'training_edit';
  const trainingUrl = isEdit
    ? replaceRouteTokens(bs.urls.trainingDetail, { TID: String(tdoc.docId || tdoc._id) })
    : bs.urls.training;
  const [planNodes, setPlanNodes] = useState<TrainingPlanNode[]>(() => {
    try {
      return parsePlan(data.dag || tdoc.dag);
    } catch {
      return DEFAULT_PLAN;
    }
  });

  const updateNode = (index: number, patch: Partial<TrainingPlanNode>) => {
    setPlanNodes((nodes) => nodes.map((node, i) => i === index ? { ...node, ...patch } : node));
  };

  const updateNodeId = (index: number, nextId: number) => {
    setPlanNodes((nodes) => {
      const currentId = nodes[index]._id;
      const safeId = Number.isSafeInteger(nextId) && nextId > 0 ? nextId : index + 1;
      return nodes.map((node, i) => {
        if (i === index) return { ...node, _id: safeId, requireNids: node.requireNids.filter((id) => id !== safeId) };
        return {
          ...node,
          requireNids: uniqueValues(node.requireNids.map((id) => id === currentId ? safeId : id)).filter((id) => id !== node._id),
        };
      });
    });
  };

  const addNode = () => {
    setPlanNodes((nodes) => {
      const nextId = Math.max(0, ...nodes.map((node) => node._id)) + 1;
      return [
        ...nodes,
        {
          _id: nextId,
          title: `阶段 ${nextId}`,
          requireNids: nodes.length ? [nodes[nodes.length - 1]._id] : [],
          pids: [],
        },
      ];
    });
  };

  const removeNode = (index: number) => {
    setPlanNodes((nodes) => {
      if (nodes.length <= 1) return nodes;
      const removedId = nodes[index]._id;
      return nodes
        .filter((_, i) => i !== index)
        .map((node) => ({
          ...node,
          requireNids: node.requireNids.filter((id) => id !== removedId),
        }));
    });
  };

  const toggleDependency = (index: number, dependencyId: number) => {
    setPlanNodes((nodes) => nodes.map((node, i) => {
      if (i !== index) return node;
      const next = node.requireNids.includes(dependencyId)
        ? node.requireNids.filter((id) => id !== dependencyId)
        : [...node.requireNids, dependencyId];
      return { ...node, requireNids: next };
    }));
  };

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={trainingUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <h1 className="text-xl font-semibold">{isEdit ? '编辑训练' : '创建训练'}</h1>
      </div>

      <Card>
        <CardContent className="p-6">
          <form method="post" className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="title" className="text-sm font-medium">标题</label>
              <Input id="title" name="title" defaultValue={tdoc.title || ''} required />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="description" className="text-sm font-medium">简介 (Markdown)</label>
              <MarkdownEditor name="description" value={tdoc.description || ''} minHeight={280} preferredLang={bs.locale} />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="content" className="text-sm font-medium">详细说明 (Markdown)</label>
              <MarkdownEditor name="content" value={tdoc.content || ''} minHeight={280} preferredLang={bs.locale} />
            </div>

            <StagePlanEditor
              planNodes={planNodes}
              setPlanNodes={setPlanNodes}
              addNode={addNode}
              removeNode={removeNode}
              updateNode={updateNode}
              updateNodeId={updateNodeId}
              toggleDependency={toggleDependency}
            />
            <input type="hidden" name="dag" value={serializePlan(planNodes)} readOnly />

            <div className="space-y-1.5">
              <label htmlFor="pin" className="text-sm font-medium">置顶</label>
              <SimpleSelect
                id="pin"
                name="pin"
                defaultValue={String(tdoc.pin || 0)}
                options={[
                  { value: '0', label: '不置顶' },
                  { value: '1', label: '置顶' },
                ]}
              />
            </div>

            <Separator />

            <div className="flex items-center gap-3">
              <Button type="submit">
                <Save className="mr-1 size-4" />{isEdit ? '保存修改' : '创建训练'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ---------- StagePlanEditor (sortable cards + prereq collapse + auto-sort) ---------- */

interface StagePlanEditorProps {
  planNodes: TrainingPlanNode[];
  setPlanNodes: React.Dispatch<React.SetStateAction<TrainingPlanNode[]>>;
  addNode: () => void;
  removeNode: (index: number) => void;
  updateNode: (index: number, patch: Partial<TrainingPlanNode>) => void;
  updateNodeId: (index: number, nextId: number) => void;
  toggleDependency: (index: number, dependencyId: number) => void;
}

/**
 * Topological sort by `requireNids` dependencies. Falls back to ID-asc if the
 * graph has a cycle (no valid topo order exists).
 */
function topologicalSort(nodes: TrainingPlanNode[]): TrainingPlanNode[] {
  const idToNode = new Map<number, TrainingPlanNode>();
  const inDegree = new Map<number, number>();
  for (const n of nodes) {
    idToNode.set(n._id, n);
    inDegree.set(n._id, 0);
  }
  for (const n of nodes) {
    for (const req of n.requireNids) {
      if (idToNode.has(req)) inDegree.set(n._id, (inDegree.get(n._id) || 0) + 1);
    }
  }
  // Kahn's algorithm; tie-break by id ascending so output is deterministic.
  const ready: number[] = [];
  for (const [id, deg] of inDegree) if (deg === 0) ready.push(id);
  ready.sort((a, b) => a - b);
  const out: TrainingPlanNode[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    const n = idToNode.get(id);
    if (!n) continue;
    out.push(n);
    for (const dep of nodes) {
      if (dep.requireNids.includes(id)) {
        const next = (inDegree.get(dep._id) || 0) - 1;
        inDegree.set(dep._id, next);
        if (next === 0) {
          // Insert preserving ascending id order.
          const idx = ready.findIndex((x) => x > dep._id);
          if (idx < 0) ready.push(dep._id); else ready.splice(idx, 0, dep._id);
        }
      }
    }
  }
  return out.length === nodes.length ? out : [...nodes].sort((a, b) => a._id - b._id);
}

function StagePlanEditor({
  planNodes, setPlanNodes, addNode, removeNode, updateNode, updateNodeId, toggleDependency,
}: StagePlanEditorProps) {
  // 8px pointer activation distance prevents drag-handle clicks from
  // triggering on every mousedown — users can still click stage cards normally.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const ids = useMemo(() => planNodes.map((n) => `${n._id}`), [planNodes]);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    setPlanNodes((prev) => arrayMove(prev, from, to));
  };

  const applyAutoSort = (kind: 'id_asc' | 'topo') => {
    if (kind === 'id_asc') {
      setPlanNodes((prev) => [...prev].sort((a, b) => a._id - b._id));
    } else {
      setPlanNodes((prev) => topologicalSort(prev));
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm font-medium">训练计划 ({planNodes.length} 阶段)</label>
        <div className="flex items-center gap-2">
          <SimpleSelect
            value=""
            onValueChange={(v) => {
              if (v) applyAutoSort(v as 'id_asc' | 'topo');
            }}
            className="h-8 w-36"
            placeholder="自动排序…"
            options={[
              { value: '', label: '自动排序…' },
              { value: 'id_asc', label: '按 ID 升序' },
              { value: 'topo', label: '按依赖拓扑序' },
            ]}
          />
          <Button type="button" variant="outline" size="sm" onClick={addNode}>
            <Plus className="size-3.5" />
            添加阶段
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        拖动左侧 <GripVertical className="inline size-3" /> 重新排序；阶段顺序决定详情页展示顺序。
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {planNodes.map((node, index) => (
              <SortableStageCard
                key={`${node._id}`}
                node={node}
                index={index}
                planNodes={planNodes}
                onRemove={() => removeNode(index)}
                onUpdate={(patch) => updateNode(index, patch)}
                onUpdateId={(id) => updateNodeId(index, id)}
                onToggleDependency={(dep) => toggleDependency(index, dep)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

const PREREQ_COLLAPSE_THRESHOLD = 4;

interface SortableStageCardProps {
  node: TrainingPlanNode;
  index: number;
  planNodes: TrainingPlanNode[];
  onRemove: () => void;
  onUpdate: (patch: Partial<TrainingPlanNode>) => void;
  onUpdateId: (id: number) => void;
  onToggleDependency: (dep: number) => void;
}

function SortableStageCard({
  node, index, planNodes, onRemove, onUpdate, onUpdateId, onToggleDependency,
}: SortableStageCardProps) {
  const sortable = useSortable({ id: `${node._id}` });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const otherNodes = planNodes.filter((c) => c._id !== node._id);
  const [showAllPrereqs, setShowAllPrereqs] = useState(false);
  const shouldCollapse = otherNodes.length > PREREQ_COLLAPSE_THRESHOLD && !showAllPrereqs;
  const visibleOthers = shouldCollapse ? otherNodes.slice(0, PREREQ_COLLAPSE_THRESHOLD) : otherNodes;
  const hiddenCount = otherNodes.length - visibleOthers.length;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-md border bg-muted/20 p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* Drag handle. Cursor changes to grab/grabbing; the rest of the
              card stays clickable thanks to PointerSensor's 8px activation. */}
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-accent active:cursor-grabbing"
            title="拖动以重排"
          >
            <GripVertical className="size-4" />
          </button>
          <div>
            <p className="text-sm font-semibold">阶段 {index + 1}</p>
            <p className="text-xs text-muted-foreground">
              {node.pids.length} 题 · {node.requireNids.length ? `依赖 ${node.requireNids.join(', ')}` : '无前置'}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-destructive"
          onClick={onRemove}
          disabled={planNodes.length <= 1}
          title="删除阶段"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[96px_1fr]">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground" htmlFor={`plan-id-${index}`}>ID</label>
          <Input
            id={`plan-id-${index}`}
            type="number"
            min={1}
            required
            value={node._id}
            onChange={(event) => onUpdateId(Number(event.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground" htmlFor={`plan-title-${index}`}>标题</label>
          <Input
            id={`plan-title-${index}`}
            required
            value={node.title}
            onChange={(event) => onUpdate({ title: event.target.value })}
          />
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        <label className="text-xs text-muted-foreground">题目</label>
        <ProblemPicker
          value={node.pids}
          onChange={(next) => onUpdate({ pids: next })}
          placeholder="搜索题目 (pid / 标题)…"
        />
      </div>

      <div className="mt-3 space-y-2">
        <label className="text-xs text-muted-foreground">前置阶段</label>
        {otherNodes.length ? (
          <div className="flex flex-wrap items-center gap-2">
            {visibleOthers.map((candidate) => (
              <label
                key={candidate._id}
                className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-xs"
              >
                <Checkbox
                  size="sm"
                  checked={node.requireNids.includes(candidate._id)}
                  onChange={() => onToggleDependency(candidate._id)}
                />
                #{candidate._id} {candidate.title}
              </label>
            ))}
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowAllPrereqs(true)}
                className="inline-flex items-center gap-1 rounded-md border border-dashed bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                + {hiddenCount} 个
              </button>
            ) : null}
            {!shouldCollapse && otherNodes.length > PREREQ_COLLAPSE_THRESHOLD ? (
              <button
                type="button"
                onClick={() => setShowAllPrereqs(false)}
                className="inline-flex items-center gap-1 rounded-md border border-dashed bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                收起
              </button>
            ) : null}
          </div>
        ) : (
          <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">无可选阶段</p>
        )}
      </div>
    </div>
  );
}

/* ---------- Training Files ---------- */

export function TrainingFilesPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const files: R[] = data.files || [];
  const tid = tdoc.docId || tdoc._id;
  const trainingUrl = replaceRouteTokens(bs.urls.trainingDetail, { TID: String(tid) });

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={trainingUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">训练文件</h1>
          <p className="text-sm text-muted-foreground">{tdoc.title}</p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <FolderOpen className="size-4" />文件 ({files.length})
          </CardTitle>
          <form method="post" encType="multipart/form-data" className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <input type="file" name="file" className="text-xs" />
            <Button type="submit" name="operation" value="upload_file" size="sm" variant="outline">
              <Upload className="mr-1 size-3" />上传
            </Button>
          </form>
        </CardHeader>
        <CardContent className="p-0">
          {files.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>文件名</TableHead>
                  <TableHead className="w-28 text-right">大小</TableHead>
                  <TableHead className="w-40 text-right">修改时间</TableHead>
                  <TableHead className="w-20 text-center">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((f) => (
                  <TableRow key={f.name}>
                    <TableCell className="font-mono text-sm">{f.name}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{formatSize(f.size || 0)}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {f.lastModified ? formatDateTime(f.lastModified, bs.locale) : '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      <form method="post" className="inline">
                        <input type="hidden" name="files" value={f.name} />
                        <Button type="submit" name="operation" value="delete_files" variant="ghost" size="icon" className="size-7">
                          <Trash2 className="size-3 text-destructive" />
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">暂无文件</p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
