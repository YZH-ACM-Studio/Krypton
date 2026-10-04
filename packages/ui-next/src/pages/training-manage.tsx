/**
 * Training management pages — edit and files.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, FolderOpen, GripVertical, Plus, Save, Trash2, Upload } from 'lucide-react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useMediaQuery } from '@/components/ui/media';
import { Page } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { ProblemPicker } from '@/components/problem-picker';
import { PracticeIntegrityPolicyPanel } from '@/components/practice-integrity-policy-panel';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime, replaceRouteTokens } from '@/lib/format';
import { fetchProblemsByIds } from '@/lib/multi-select-presets';

interface TrainingPlanNode {
  _id: number;
  title: string;
  requireNids: number[];
  pids: Array<string | number>;
}

interface RawTrainingPlanNode {
  _id?: unknown;
  id?: unknown;
  title?: unknown;
  requireNids?: unknown[];
  pids?: unknown[];
}

interface TrainingManageDocument {
  _id?: string | number;
  docId?: string | number;
  title?: string;
  description?: string;
  content?: string;
  dag?: unknown;
  pin?: string | number;
}

interface TrainingFile {
  name: string;
  size?: number;
  lastModified?: unknown;
}

interface TrainingManageGroup {
  _id: string;
  name: string;
  archivedAt?: string | null;
}

interface TrainingManagePageData {
  tdoc?: TrainingManageDocument;
  page_name?: string;
  dag?: unknown;
  files?: TrainingFile[];
  groups?: TrainingManageGroup[];
  audience?: { public?: boolean; groupIds?: string[] };
}

const MARKDOWN_EDITOR_MIN_HEIGHT = 280;
const MARKDOWN_EDITOR_MIN_HEIGHT_SHORT = 160;

function useShortScreenMarkdownMinHeight(): number {
  const short = useMediaQuery('(max-height: 800px)');
  return short ? MARKDOWN_EDITOR_MIN_HEIGHT_SHORT : MARKDOWN_EDITOR_MIN_HEIGHT;
}

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

function uniqueValues<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function normalizePlanNode(node: RawTrainingPlanNode, index: number): TrainingPlanNode {
  const id = Number(node._id || node.id || index + 1);
  return {
    _id: Number.isSafeInteger(id) && id > 0 ? id : index + 1,
    title: String(node.title || `阶段 ${index + 1}`),
    requireNids: Array.isArray(node.requireNids)
      ? uniqueValues(node.requireNids.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))
      : [],
    pids: Array.isArray(node.pids)
      ? uniqueValues(node.pids.map((value) => (typeof value === 'number' ? value : normalizeToken(String(value)))).filter((value) => value !== ''))
      : [],
  };
}

function parsePlan(value: unknown): TrainingPlanNode[] {
  const source = Array.isArray(value) ? value : typeof value === 'string' && value.trim() ? JSON.parse(value) : DEFAULT_PLAN;
  if (!Array.isArray(source)) return DEFAULT_PLAN;
  for (const node of source) {
    if (node && typeof node === 'object' && !Array.isArray(node) && Object.hasOwn(node, 'sections')) {
      throw new TypeError('题集阶段不支持小节');
    }
  }
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

function docIdOf(value: string | number): number | null {
  const numeric = typeof value === 'number' ? value : /^[1-9]\d*$/.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

// Create-page sample still names the welcome problem as pid P1000.
// _parseDagJson only accepts positive docIds, and ProblemPicker does not
// write a resolved docId back until the teacher changes the selection.
async function resolvePlanDocIds(nodes: TrainingPlanNode[]): Promise<Map<string, number> | null> {
  const pending = Array.from(new Set(nodes.flatMap((node) => node.pids.map(String).filter((pid) => docIdOf(pid) === null))));
  if (!pending.length) return new Map();
  const found = await fetchProblemsByIds(pending);
  const resolved = new Map<string, number>();
  pending.forEach((token, index) => {
    const hit = found[index];
    const docId = hit ? docIdOf(hit.docId) : null;
    if (docId !== null && hit && (String(hit.pid) === token || String(hit.docId) === token)) resolved.set(token, docId);
  });
  if (pending.some((token) => !resolved.has(token))) return null;
  return resolved;
}

function applyPlanDocIds(nodes: TrainingPlanNode[], resolved: ReadonlyMap<string, number>): TrainingPlanNode[] {
  if (!resolved.size) return nodes;
  return nodes.map((node) => ({
    ...node,
    pids: node.pids.map((pid) => resolved.get(String(pid)) ?? pid),
  }));
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function BackLink({ href }: { href: string }) {
  return (
    <Button asChild variant="ghost" size="sm" iconOnly>
      <a href={href} aria-label="返回">
        <ArrowLeft />
      </a>
    </Button>
  );
}

/* ---------- Training Edit ---------- */

export function TrainingEditPage() {
  const bs = useBootstrap();
  const markdownMinHeight = useShortScreenMarkdownMinHeight();
  const data = bs.page.data as TrainingManagePageData;
  const tdoc = data.tdoc || {};
  const isEdit = data.page_name === 'problem_set_edit';
  const trainingUrl = isEdit ? replaceRouteTokens(bs.urls.trainingDetail, { TID: String(tdoc.docId || tdoc._id) }) : bs.urls.training;
  const initialAudienceGroupIds = (data.audience?.groupIds || []).map(String);
  // 已归档组不进常规选择器；本题集已经选中的仍保留并标出，避免保存时静默摘掉。
  const groups = (data.groups || []).filter((group) => !group.archivedAt || initialAudienceGroupIds.includes(String(group._id)));
  const visibleGroupIds = new Set(groups.map((group) => group._id));
  const [audiencePublic, setAudiencePublic] = useState(data.audience?.public !== false);
  const [audienceGroupIds, setAudienceGroupIds] = useState<Set<string>>(
    () => new Set(initialAudienceGroupIds.filter((id) => visibleGroupIds.has(id))),
  );
  const [pin, setPin] = useState(Number(tdoc.pin || 0) === 1);
  const [planNodes, setPlanNodes] = useState<TrainingPlanNode[]>(() => {
    try {
      return parsePlan(data.dag || tdoc.dag);
    } catch (error) {
      if (error instanceof TypeError && error.message === '题集阶段不支持小节') throw error;
      return DEFAULT_PLAN;
    }
  });
  const [planError, setPlanError] = useState('');
  const [resolvingPlan, setResolvingPlan] = useState(false);
  const resolvingPlanRef = useRef(false);
  const planNodesRef = useRef(planNodes);
  planNodesRef.current = planNodes;
  const unresolvedPidKey = planNodes
    .flatMap((node) => node.pids.map(String).filter((pid) => docIdOf(pid) === null))
    .join('\n');

  useEffect(() => {
    if (!unresolvedPidKey) return undefined;
    let cancelled = false;
    resolvePlanDocIds(planNodesRef.current)
      .then((resolved) => {
        if (cancelled || !resolved) return;
        setPlanNodes((current) => applyPlanDocIds(current, resolved));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error && error.message ? error.message : '题目编号解析失败';
        setPlanError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [unresolvedPidKey]);

  const submitTraining = async (event: FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget;
    if (planNodes.every((node) => node.pids.every((pid) => docIdOf(pid) !== null))) return;
    event.preventDefault();
    if (resolvingPlanRef.current) return;
    resolvingPlanRef.current = true;
    setResolvingPlan(true);
    setPlanError('');
    try {
      const resolved = await resolvePlanDocIds(planNodes);
      if (!resolved) {
        setPlanError('有阶段题目还不是数字题号，请重新选择后再保存。');
        return;
      }
      const next = applyPlanDocIds(planNodes, resolved);
      setPlanNodes(next);
      const dag = form.elements.namedItem('dag');
      if (!(dag instanceof HTMLInputElement)) {
        setPlanError('无法写入题集阶段，请刷新后重试。');
        return;
      }
      dag.value = serializePlan(next);
      form.submit();
    } catch (error: unknown) {
      const message = error instanceof Error && error.message ? error.message : '题目编号解析失败';
      setPlanError(message);
    } finally {
      resolvingPlanRef.current = false;
      setResolvingPlan(false);
    }
  };

  const updateNode = (index: number, patch: Partial<TrainingPlanNode>) => {
    setPlanNodes((nodes) => nodes.map((node, i) => (i === index ? { ...node, ...patch } : node)));
  };

  const updateNodeId = (index: number, nextId: number) => {
    setPlanNodes((nodes) => {
      const currentId = nodes[index]._id;
      const safeId = Number.isSafeInteger(nextId) && nextId > 0 ? nextId : index + 1;
      return nodes.map((node, i) => {
        if (i === index) return { ...node, _id: safeId, requireNids: node.requireNids.filter((id) => id !== safeId) };
        return {
          ...node,
          requireNids: uniqueValues(node.requireNids.map((id) => (id === currentId ? safeId : id))).filter((id) => id !== node._id),
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
    setPlanNodes((nodes) =>
      nodes.map((node, i) => {
        if (i !== index) return node;
        const next = node.requireNids.includes(dependencyId)
          ? node.requireNids.filter((id) => id !== dependencyId)
          : [...node.requireNids, dependencyId];
        return { ...node, requireNids: next };
      }),
    );
  };

  return (
    <Page width="form">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <BackLink href={trainingUrl} />
        <h2 className="min-w-0 truncate text-lg font-semibold text-fg">{isEdit ? '编辑题集' : '创建题集'}</h2>
      </div>

      <form method="post" className="flex flex-col gap-6" onSubmit={submitTraining}>
        <Panel>
          <div className="flex flex-col gap-5">
            <FormField label="标题" htmlFor="title" required>
              <Input id="title" name="title" defaultValue={tdoc.title || ''} required />
            </FormField>

            <FormField label="简介 (Markdown)" htmlFor="description">
              <MarkdownEditor name="description" value={tdoc.description || ''} minHeight={markdownMinHeight} preferredLang={bs.locale} />
            </FormField>

            <FormField label="详细说明 (Markdown)" htmlFor="content">
              <MarkdownEditor name="content" value={tdoc.content || ''} minHeight={markdownMinHeight} preferredLang={bs.locale} />
            </FormField>
          </div>
        </Panel>

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
        <input type="hidden" name="audiencePublic" value={audiencePublic ? '1' : '0'} />
        <input type="hidden" name="audienceGroupIds" value={Array.from(audienceGroupIds).join(',')} />

        <Panel title="可见范围" description="公开和用户组动态生效；关闭公开且不选用户组后，仅兑换或课程引用可见。">
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm text-fg">
              <Switch checked={audiencePublic} onCheckedChange={setAudiencePublic} />
              公开可见
            </label>
            {groups.length ? (
              <div className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-2">
                {groups.map((group) => {
                  const checked = audienceGroupIds.has(group._id);
                  return (
                    <label key={group._id} className="flex min-w-0 items-center gap-2 text-sm text-fg">
                      <Checkbox
                        className="shrink-0"
                        checked={checked}
                        onCheckedChange={(next) => {
                          setAudienceGroupIds((current) => {
                            const copy = new Set(current);
                            if (next === true) copy.add(group._id);
                            else copy.delete(group._id);
                            return copy;
                          });
                        }}
                      />
                      <span className="min-w-0 break-words">{group.archivedAt ? `${group.name}（已归档）` : group.name}</span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-fg-subtle">当前域还没有用户组。</p>
            )}
          </div>
        </Panel>

        {isEdit && (tdoc.docId || tdoc._id) ? (
          <Panel title="真实性训练" description="默认全部关闭。保存草稿不会影响学生；点发布后才对受众生效。">
            <PracticeIntegrityPolicyPanel containerKind="problemSet" containerId={String(tdoc.docId || tdoc._id)} />
          </Panel>
        ) : null}

        <Panel title="置顶">
          <input type="hidden" name="pin" value={pin ? '1' : '0'} />
          <Switch checked={pin} onCheckedChange={setPin} aria-label="置顶" />
        </Panel>

        {planError ? (
          <p role="alert" className="text-sm text-danger-fg">
            {planError}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button type="submit" variant="primary" disabled={resolvingPlan}>
            <Save />
            {isEdit ? '保存修改' : '创建题集'}
          </Button>
        </div>
      </form>
    </Page>
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
          if (idx < 0) ready.push(dep._id);
          else ready.splice(idx, 0, dep._id);
        }
      }
    }
  }
  return out.length === nodes.length ? out : [...nodes].sort((a, b) => a._id - b._id);
}

function StagePlanEditor({ planNodes, setPlanNodes, addNode, removeNode, updateNode, updateNodeId, toggleDependency }: StagePlanEditorProps) {
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
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="min-w-0 truncate text-sm font-medium text-fg">
          题集阶段 (<span className="tabular">{planNodes.length}</span>)
        </label>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SimpleSelect
            value=""
            onValueChange={(v) => {
              if (v) applyAutoSort(v as 'id_asc' | 'topo');
            }}
            size="sm"
            className="w-36"
            placeholder="自动排序…"
            options={[
              { value: '', label: '自动排序…' },
              { value: 'id_asc', label: '按 ID 升序' },
              { value: 'topo', label: '按依赖拓扑序' },
            ]}
          />
          <Button type="button" variant="secondary" size="sm" onClick={addNode}>
            <Plus />
            添加阶段
          </Button>
        </div>
      </div>
      <p className="text-xs text-fg-subtle">
        拖动左侧 <GripVertical className="inline size-3 text-fg-subtle" /> 重新排序；阶段顺序决定详情页展示顺序。
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-3">
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

function SortableStageCard({ node, index, planNodes, onRemove, onUpdate, onUpdateId, onToggleDependency }: SortableStageCardProps) {
  const sortable = useSortable({ id: `${node._id}` });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const otherNodes = planNodes.filter((c) => c._id !== node._id);
  const [showAllPrereqs, setShowAllPrereqs] = useState(false);
  const shouldCollapse = otherNodes.length > PREREQ_COLLAPSE_THRESHOLD && !showAllPrereqs;
  const visibleOthers = shouldCollapse ? otherNodes.slice(0, PREREQ_COLLAPSE_THRESHOLD) : otherNodes;
  const hiddenCount = otherNodes.length - visibleOthers.length;

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'relative z-10' : undefined}>
      <Panel className={isDragging ? 'border-brand' : undefined}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {/* Drag handle. Cursor changes to grab/grabbing; the rest of the
                card stays clickable thanks to PointerSensor's 8px activation. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              iconOnly
              {...attributes}
              {...listeners}
              className="cursor-grab touch-none active:cursor-grabbing"
              title="拖动以重排"
              aria-label="拖动以重排"
            >
              <GripVertical className="text-fg-subtle" />
            </Button>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg">阶段 {index + 1}</p>
              <p className="break-words text-xs text-fg-subtle">
                <span className="tabular">{node.pids.length}</span> 题 · {node.requireNids.length ? `依赖 ${node.requireNids.join(', ')}` : '无前置'}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            onClick={onRemove}
            disabled={planNodes.length <= 1}
            title="删除阶段"
            aria-label="删除阶段"
          >
            <Trash2 />
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-[6rem_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="text-xs text-fg-subtle" htmlFor={`plan-id-${index}`}>
              ID
            </label>
            <Input
              id={`plan-id-${index}`}
              type="number"
              min={1}
              required
              value={node._id}
              onChange={(event) => onUpdateId(Number(event.target.value))}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="text-xs text-fg-subtle" htmlFor={`plan-title-${index}`}>
              标题
            </label>
            <Input id={`plan-title-${index}`} required value={node.title} onChange={(event) => onUpdate({ title: event.target.value })} />
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-1.5">
          <label className="text-xs text-fg-subtle">题目</label>
          <ProblemPicker value={node.pids} onChange={(next) => onUpdate({ pids: next })} placeholder="搜索题目 (pid / 标题)…" />
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <label className="text-xs text-fg-subtle">前置阶段</label>
          {otherNodes.length ? (
            <div className="flex flex-wrap items-center gap-2">
              {visibleOthers.map((candidate) => (
                <label
                  key={candidate._id}
                  className="inline-flex max-w-full cursor-pointer items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-fg"
                >
                  <Checkbox size="sm" className="shrink-0" checked={node.requireNids.includes(candidate._id)} onChange={() => onToggleDependency(candidate._id)} />
                  <span className="min-w-0 break-words">
                    #{candidate._id} {candidate.title}
                  </span>
                </label>
              ))}
              {hiddenCount > 0 ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowAllPrereqs(true)}>
                  + {hiddenCount} 个
                </Button>
              ) : null}
              {!shouldCollapse && otherNodes.length > PREREQ_COLLAPSE_THRESHOLD ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowAllPrereqs(false)}>
                  收起
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-line px-3 py-2 text-xs text-fg-subtle">无可选阶段</p>
          )}
        </div>
      </Panel>
    </div>
  );
}

/* ---------- Training Files ---------- */

export function TrainingFilesPage() {
  const bs = useBootstrap();
  const data = bs.page.data as TrainingManagePageData;
  const tdoc = data.tdoc || {};
  const files = data.files || [];
  const tid = tdoc.docId || tdoc._id;
  const trainingUrl = replaceRouteTokens(bs.urls.trainingDetail, { TID: String(tid) });

  return (
    <Page width="wide">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <BackLink href={trainingUrl} />
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-fg">题集文件</h2>
          <p className="truncate text-sm text-fg-muted">{tdoc.title}</p>
        </div>
      </div>

      <Panel
        flush
        title={
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <FolderOpen className="size-4 shrink-0 text-fg-subtle" />
            <span className="min-w-0 truncate">
              文件 (<span className="tabular">{files.length}</span>)
            </span>
          </span>
        }
        actions={
          <form method="post" encType="multipart/form-data" className="flex w-full max-w-full flex-wrap items-center gap-2 sm:w-auto">
            <input type="file" name="file" className="max-w-full text-xs" />
            <Button type="submit" name="operation" value="upload_file" size="sm" variant="primary">
              <Upload />
              上传
            </Button>
          </form>
        }
      >
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
                  <TableCell className="min-w-0 break-all font-mono text-sm">{f.name}</TableCell>
                  <TableCell className="text-right text-sm text-fg-subtle tabular">{formatSize(f.size || 0)}</TableCell>
                  <TableCell className="text-right text-sm text-fg-subtle tabular">
                    {f.lastModified ? formatDateTime(f.lastModified, bs.locale) : '-'}
                  </TableCell>
                  <TableCell className="text-center">
                    <form
                      method="post"
                      className="inline"
                      onSubmit={(event) => {
                        void confirmFormSubmit(event, '删除后不能恢复。', {
                          destructive: true,
                          title: `删除文件「${f.name}」？`,
                          confirmLabel: '删除',
                        });
                      }}
                    >
                      <input type="hidden" name="operation" value="delete_files" />
                      <input type="hidden" name="files" value={f.name} />
                      <Button type="submit" variant="danger-soft" size="sm" iconOnly aria-label={`删除 ${f.name}`}>
                        <Trash2 />
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState compact icon={<FolderOpen />} title="暂无文件" />
        )}
      </Panel>
    </Page>
  );
}

export { TrainingFilesPage as ProblemSetFilesPage, TrainingEditPage as ProblemSetManagePage };
