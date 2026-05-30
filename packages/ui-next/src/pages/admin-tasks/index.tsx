/**
 * /admin/tasks (admin-facing) — task management.
 *
 * Pages (registered template names → page export):
 *   - admin_tasks.html             → AdminTasksListPage
 *   - admin_tasks_edit.html        → AdminTasksEditPage     (create + edit, xyflow canvas)
 *   - admin_tasks_assign.html      → AdminTasksAssignPage   (bulk assign)
 *   - admin_tasks_stats.html       → AdminTasksStatsPage    (per-task stats)
 *   - admin_tasks_candidates.html  → AdminTasksCandidatesPage  (quota-mode candidate pool)
 *   - admin_tasks_scores.html      → AdminTasksScoresPage
 *   - admin_tasks_settings.html    → AdminTasksSettingsPage
 *
 * v2 (2026-05-25): task definition is now a DAG (TaskGraph) rendered with
 * @xyflow/react. See ~/Krypton/packages/krypton-tasks/src/types.ts for
 * the canonical schema and grill rationale.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowLeft, ChevronRight, ClipboardList, Copy, FileDown, Flag,
  Layers, ListChecks, Loader2, Lock, Maximize2, Minimize2, Network, Plus, Save,
  Settings, Star, Tag, Target, Trash2, Trophy, UserCheck, Users, X,
} from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { PRIV } from '@/lib/perms';
import { registerAdminNavSection } from '@/lib/admin-nav-registry';
import { AdminPage } from '@/components/admin/admin-page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FormField, FormRow, FormSection } from '@/components/ui/form';
import { DateTime } from '@/components/ui/datetime';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { TableAction, TableActions } from '@/components/ui/table-actions';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import {
  TaskGraphRenderer, TOOLBOX_MIME,
  type PresetSummary, type TaskGraph, type TaskGraphNode,
  type TaskPointResult,
} from '@/components/task-graph';

// ─── Register admin nav ───────────────────────────────────────────────────

registerAdminNavSection({
  key: 'tasks',
  label: '任务系统',
  order: 35,
  requiredPriv: PRIV.PRIV_USER_PROFILE,
  items: [
    {
      key: 'tasks', label: '任务列表', href: '/admin/tasks', icon: ClipboardList,
      templateNames: ['admin_tasks.html', 'admin_tasks_edit.html', 'admin_tasks_assign.html', 'admin_tasks_stats.html', 'admin_tasks_candidates.html'],
    },
    { key: 'scores', label: '比赛分数', href: '/admin/tasks/scores', icon: Trophy, templateNames: ['admin_tasks_scores.html'] },
    { key: 'settings', label: '系统设置', href: '/admin/tasks/settings', icon: Settings, templateNames: ['admin_tasks_settings.html'] },
  ],
});

// ─── Types ────────────────────────────────────────────────────────────────

type TaskAccess =
  | { type: 'public' }
  | { type: 'user_group'; targetId: string }
  | { type: 'school'; targetId: string }
  | { type: 'grade'; years: number[] };

type AdmissionMode = 'auto' | 'quota';

type AssignmentStatus = 'pending' | 'qualified' | 'admitted' | 'completed' | 'cancelled';

interface TaskDoc {
  _id: string;
  domainId: string;
  title: string;
  description: string;
  tags: string[];
  graph: TaskGraph;
  access: TaskAccess;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  claimStartAt: string | null;
  claimEndAt: string | null;
  maxAssignments: number | null;
  currentAssignments: number;
  countsAsStay?: boolean;
  admissionMode: AdmissionMode;
  quota: number | null;
  createdAt: string;
  createdBy: number;
}

interface SchoolRef { _id: string; name: string }
interface GroupRef { _id: string; schoolId: string; name: string }
interface ContestRef { _id: string; title: string; beginAt?: string; rule?: string }
interface HomeworkRef { _id: string; title: string; beginAt?: string }
interface TrainingRef { _id: string; title: string }

interface AssignmentEntry {
  _id: string;
  userId: number;
  status: AssignmentStatus;
  canCancel: boolean;
  assignedAt: string;
  completedAt?: string | null;
  qualifiedAt?: string | null;
  admittedAt?: string | null;
  admittedBy?: number;
  admissionNote?: string;
  confirmedAt?: string | null;
  confirmedBy?: number;
  note: string;
  progress: Record<string, TaskPointResult>;
}

interface AuditEntry {
  _id: string;
  assignmentId: string | null;
  eventType: string;
  pointId?: string;
  adminUid: number;
  before: any;
  after: any;
  reason: string;
  createdAt: string;
}

interface StudentLite {
  studentId: string;
  realName: string;
  enrollmentYear: number | null;
  schoolId: string;
  groupIds?: string[];
}

// ─── Status helpers (used across pages) ───────────────────────────────────

function StatusBadge({ status }: { status: AssignmentStatus }) {
  if (status === 'completed') return <Badge className="bg-emerald-500 text-white hover:bg-emerald-500/90">已完成</Badge>;
  if (status === 'admitted') return <Badge className="bg-violet-500 text-white hover:bg-violet-500/90">已录取</Badge>;
  if (status === 'qualified') return <Badge className="bg-amber-500 text-white hover:bg-amber-500/90">候选</Badge>;
  if (status === 'cancelled') return <Badge variant="outline">已取消</Badge>;
  return <Badge className="bg-sky-500 text-white hover:bg-sky-500/90">进行中</Badge>;
}

function toCstDateTimeLocal(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const cst = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${cst.getUTCFullYear()}-${pad(cst.getUTCMonth() + 1)}-${pad(cst.getUTCDate())}T${pad(cst.getUTCHours())}:${pad(cst.getUTCMinutes())}`;
}

function WindowLine({
  start, end, emptyText,
}: {
  start?: string | null;
  end?: string | null;
  emptyText: string;
}) {
  if (!start && !end) return <span className="text-muted-foreground">{emptyText}</span>;
  return (
    <div className="space-y-0.5 text-xs">
      <div>{start ? <><DateTime value={start} mode="datetime" /> 开始</> : <span className="text-muted-foreground">不限开始</span>}</div>
      <div>{end ? <><DateTime value={end} mode="datetime" /> 截止</> : <span className="text-muted-foreground">不限截止</span>}</div>
    </div>
  );
}

// ─── Admin Tasks List ────────────────────────────────────────────────────

export function AdminTasksListPage() {
  const data = useBootstrap().page.data as {
    tasks: TaskDoc[];
    tagOptions: string[];
    canManage: boolean;
  };
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data.tasks || []).filter((t) => {
      if (activeTag && !t.tags.includes(activeTag)) return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data.tasks, query, activeTag]);

  return (
    <AdminPage
      title="任务管理"
      description="基于流程图的任务系统：从 START 经过若干任务点到 END，存在一条全亮路径即任务完成。"
      actions={
        <div className="flex gap-2">
          <Button asChild variant="outline"><a href="/admin/tasks/scores"><Trophy className="mr-1 size-4" />比赛分数</a></Button>
          <Button asChild><a href="/admin/tasks/create"><Plus className="mr-1 size-4" />新建任务</a></Button>
        </div>
      }
    >
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Input placeholder="搜索任务标题…" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-sm" />
          {data.tagOptions?.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag className="size-3.5 text-muted-foreground" />
              <button
                onClick={() => setActiveTag(null)}
                className={cn('rounded-md px-2 py-0.5 text-xs', activeTag === null ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80')}
              >全部</button>
              {data.tagOptions.map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveTag(t === activeTag ? null : t)}
                  className={cn('rounded-md px-2 py-0.5 text-xs', activeTag === t ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80')}
                >{t}</button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>任务</TableHead>
                <TableHead>标签</TableHead>
                <TableHead>节点</TableHead>
                <TableHead>认领</TableHead>
                <TableHead>模式</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="w-80">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                    {data.tasks.length === 0 ? '还没有任务，点击右上角"新建任务"开始创建' : '没有匹配的任务'}
                  </TableCell>
                </TableRow>
              ) : filtered.map((task) => {
                const taskNodes = (task.graph?.nodes || []).filter((n) => n.type === 'task');
                return (
                  <TableRow key={task._id}>
                    <TableCell>
                      <div className="space-y-0.5">
                        <a href={`/admin/tasks/${task._id}/edit`} className="font-medium hover:underline">{task.title}</a>
                        <p className="line-clamp-1 text-xs text-muted-foreground">{task.description || '暂无描述'}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {task.tags.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="gap-1 text-[10px]"><Network className="size-3" />{taskNodes.length}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium">
                        {task.currentAssignments}
                        {task.maxAssignments && <span className="text-muted-foreground"> / {task.maxAssignments}</span>}
                      </div>
                      <WindowLine start={task.claimStartAt} end={task.claimEndAt} emptyText="认领不限时间" />
                    </TableCell>
                    <TableCell>
                      {task.admissionMode === 'quota'
                        ? <Badge variant="outline" className="gap-1 text-[10px]"><Users className="size-3" />配额 {task.quota ?? '?'}</Badge>
                        : <Badge variant="outline" className="text-[10px]">自动</Badge>}
                    </TableCell>
                    <TableCell>
                      {task.isActive ? (
                        <Badge className="bg-emerald-500 text-white hover:bg-emerald-500/90">启用</Badge>
                      ) : <Badge variant="outline">停用</Badge>}
                    </TableCell>
                    <TableCell>
                      <TableActions>
                        {task.admissionMode === 'quota' && (
                          <TableAction href={`/admin/tasks/${task._id}/candidates`}>候选池</TableAction>
                        )}
                        <TableAction href={`/admin/tasks/${task._id}/stats`}>统计</TableAction>
                        <TableAction href={`/admin/tasks/${task._id}/assign`}>分配</TableAction>
                        <TableAction href={`/admin/tasks/${task._id}/edit`}>编辑</TableAction>
                        <TableAction
                          formAction="/admin/tasks"
                          hidden={{ operation: 'clone', tid: task._id }}
                          icon={Copy}
                          hint="复制"
                        />
                        <TableAction
                          formAction="/admin/tasks"
                          hidden={{ operation: 'delete', tid: task._id }}
                          icon={Trash2}
                          variant="destructive"
                          hint="删除"
                          confirm={`确定删除任务"${task.title}"？这将一并删除所有用户的分配记录。`}
                        />
                      </TableActions>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AdminPage>
  );
}

// ─── Admin Tasks Edit (xyflow canvas) ────────────────────────────────────

interface EditPageData {
  task: TaskDoc | null;
  isEdit: boolean;
  presets: PresetSummary[];
  schools: SchoolRef[];
  userGroups: GroupRef[];
  contests: ContestRef[];
  homeworks: HomeworkRef[];
  trainings: TrainingRef[];
}

export function AdminTasksEditPage() {
  const data = useBootstrap().page.data as EditPageData;
  const initial = data.task;

  // ── Top-level task fields
  const [title, setTitle] = useState(initial?.title || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [tagsCsv, setTagsCsv] = useState((initial?.tags || []).join(', '));
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [countsAsStay, setCountsAsStay] = useState(initial?.countsAsStay ?? false);
  const [startDate, setStartDate] = useState(toCstDateTimeLocal(initial?.startDate));
  const [endDate, setEndDate] = useState(toCstDateTimeLocal(initial?.endDate));
  const [claimStartAt, setClaimStartAt] = useState(toCstDateTimeLocal(initial?.claimStartAt));
  const [claimEndAt, setClaimEndAt] = useState(toCstDateTimeLocal(initial?.claimEndAt));
  const [maxAssignments, setMaxAssignments] = useState(initial?.maxAssignments?.toString() || '');
  const [accessType, setAccessType] = useState<TaskAccess['type']>(initial?.access.type || 'public');
  const [accessTargetId, setAccessTargetId] = useState(
    (initial?.access.type === 'user_group' || initial?.access.type === 'school')
      ? (initial.access as any).targetId : '',
  );
  const [accessYears, setAccessYears] = useState<number[]>(
    initial?.access.type === 'grade' ? initial.access.years : [],
  );
  const [admissionMode, setAdmissionMode] = useState<AdmissionMode>(initial?.admissionMode || 'auto');
  const [quota, setQuota] = useState<string>(initial?.quota?.toString() || '');

  // ── Graph state
  const [graph, setGraph] = useState<TaskGraph>(() => initial?.graph || {
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 } },
      { id: 'end', type: 'end', position: { x: 400, y: 0 } },
    ],
    edges: [],
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const selectedNode = useMemo(() => graph.nodes.find((n) => n.id === selectedNodeId), [graph, selectedNodeId]);

  // Fullscreen canvas — same pattern as Krypton IDE (krypton-ide.tsx). When
  // active, the editor card becomes `fixed inset-0` so it covers the whole
  // viewport. The side panel stays as an inline `<aside>` next to the canvas,
  // so it naturally anchors to the canvas's right edge in both modes — which
  // equals the screen's right edge when fullscreen, the card's right edge
  // when not.
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!fullscreen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fullscreen]);

  // Group presets by category for the left toolbox.
  const presetsByCategory = useMemo(() => {
    const out: Record<string, PresetSummary[]> = { behavior: [], condition: [] };
    for (const p of data.presets) {
      (out[p.category] = out[p.category] || []).push(p);
    }
    return out;
  }, [data.presets]);

  function updateNode(nodeId: string, patch: Partial<TaskGraphNode>) {
    setGraph({
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
    });
  }
  function updateNodeParams(nodeId: string, name: string, value: any) {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    updateNode(nodeId, { params: { ...(node.params || {}), [name]: value } });
  }
  function deleteNode(nodeId: string) {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== 'task') return;
    setGraph({
      nodes: graph.nodes.filter((n) => n.id !== nodeId),
      edges: graph.edges.filter((e) => e.from !== nodeId && e.to !== nodeId),
    });
    setSelectedNodeId(null);
  }

  function serializedAccess(): TaskAccess {
    if (accessType === 'public') return { type: 'public' };
    if (accessType === 'grade') return { type: 'grade', years: accessYears };
    return { type: accessType, targetId: accessTargetId };
  }

  return (
    <AdminPage
      title={data.isEdit ? '编辑任务' : '新建任务'}
      actions={<Button asChild variant="outline"><a href="/admin/tasks"><ArrowLeft className="mr-1 size-4" />返回列表</a></Button>}
    >
      <form method="post" className="space-y-4">
        <input type="hidden" name="graph" value={JSON.stringify(graph)} />
        <input type="hidden" name="access" value={JSON.stringify(serializedAccess())} />
        <input type="hidden" name="isActive" value={isActive ? 'true' : 'false'} />
        <input type="hidden" name="countsAsStay" value={countsAsStay ? 'true' : 'false'} />
        <input type="hidden" name="admissionMode" value={admissionMode} />

        {/* Top: basic info + access + admission */}
        <Card>
          <CardHeader><CardTitle className="text-sm">基本信息</CardTitle></CardHeader>
          <CardContent>
            <FormSection>
              <FormRow columns={2}>
                <FormField label="任务名称" required>
                  <Input name="title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="例如：ICPC 2026 区域赛参赛资格" />
                </FormField>
                <FormField label="标签" hint="逗号分隔，便于筛选">
                  <Input name="tags" value={tagsCsv} onChange={(e) => setTagsCsv(e.target.value)} placeholder="例如：ICPC, 2026, 资格审核" />
                </FormField>
              </FormRow>
              <FormField label="任务描述">
                <textarea
                  name="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[60px] w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="说明这个任务的目的、奖励等"
                />
              </FormField>
              <FormRow columns={4}>
                <FormField label="统计开始" hint="任务点未单独设置时继承这里">
                  <Input type="datetime-local" name="startDate" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </FormField>
                <FormField label="统计结束" hint="用于任务进度统计，不限制已认领用户重查">
                  <Input type="datetime-local" name="endDate" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </FormField>
                <FormField label="认领开始" hint="只限制用户自行认领">
                  <Input type="datetime-local" name="claimStartAt" value={claimStartAt} onChange={(e) => setClaimStartAt(e.target.value)} />
                </FormField>
                <FormField label="认领截止" hint="管理员分配不受影响">
                  <Input type="datetime-local" name="claimEndAt" value={claimEndAt} onChange={(e) => setClaimEndAt(e.target.value)} />
                </FormField>
              </FormRow>
              <FormRow columns={2}>
                <FormField label="最大认领数" hint="留空=不限">
                  <Input type="number" min={1} name="maxAssignments" value={maxAssignments} onChange={(e) => setMaxAssignments(e.target.value)} />
                </FormField>
                <FormField label="启用状态">
                  <label className="flex h-9 items-center gap-2 text-sm">
                    <Checkbox checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                    用户可见可认领
                  </label>
                </FormField>
              </FormRow>
              <FormField label="完成后计入留校次数" hint="勾选后：任务进入 completed 状态时，自动 +1 留校（idempotent）。配额模式下只有 admin 点「确认录取」后才触发。">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={countsAsStay} onChange={(e) => setCountsAsStay(e.target.checked)} />
                  完成此任务计 1 次留校
                </label>
              </FormField>
            </FormSection>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-sm">可见范围</CardTitle></CardHeader>
            <CardContent>
              <MiniTabs
                size="md"
                value={accessType}
                onValueChange={(t) => {
                  setAccessType(t as TaskAccess['type']);
                  if (t === 'public') setAccessTargetId('');
                }}
                items={[
                  { value: 'public', label: '所有人' },
                  { value: 'user_group', label: '用户组' },
                  { value: 'school', label: '学校' },
                  { value: 'grade', label: '年级' },
                ]}
              />
              {accessType === 'grade' && (
                <FormField label="允许的入学年" className="mt-3">
                  <Input
                    value={accessYears.join(' ')}
                    onChange={(e) => setAccessYears(
                      e.target.value.split(/[\s,，]+/).map((s) => parseInt(s.trim(), 10))
                        .filter((n) => Number.isInteger(n) && n >= 1900 && n <= 2099),
                    )}
                    placeholder="例如：2023 2024"
                  />
                </FormField>
              )}
              {accessType === 'school' && (
                <FormField label="选择学校" className="mt-3">
                  <SimpleSelect
                    value={accessTargetId}
                    onValueChange={setAccessTargetId}
                    placeholder="— 选择 —"
                    options={[
                      { value: '', label: '— 选择 —' },
                      ...data.schools.map((s) => ({ value: s._id, label: s.name })),
                    ]}
                  />
                </FormField>
              )}
              {accessType === 'user_group' && (
                <FormField label="选择用户组" className="mt-3">
                  <SimpleSelect
                    value={accessTargetId}
                    onValueChange={setAccessTargetId}
                    placeholder="— 选择 —"
                    options={[
                      { value: '', label: '— 选择 —' },
                      ...data.userGroups.map((g) => {
                        const s = data.schools.find((s2) => s2._id === g.schoolId);
                        return { value: g._id, label: `${s ? `${s.name} / ` : ''}${g.name}` };
                      }),
                    ]}
                  />
                </FormField>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">完成模式</CardTitle></CardHeader>
            <CardContent>
              <MiniTabs
                size="md"
                value={admissionMode}
                onValueChange={(v) => setAdmissionMode(v as AdmissionMode)}
                items={[
                  { value: 'auto', label: '自动（满足图条件即完成）' },
                  { value: 'quota', label: '配额（候选池 + 管理员审核）' },
                ]}
              />
              {admissionMode === 'quota' && (
                <FormField label="名额数（quota）" className="mt-3" hint="软上限——超额录取会警告但不阻止">
                  <Input
                    type="number"
                    name="quota"
                    min={1}
                    value={quota}
                    onChange={(e) => setQuota(e.target.value)}
                    placeholder="例如 30"
                  />
                </FormField>
              )}
              {admissionMode === 'auto' && (
                <p className="mt-3 text-xs text-muted-foreground">
                  用户图条件全满足后直接进入 <b>completed</b>。若勾了「完成后计入留校次数」，立即触发 +1。
                </p>
              )}
              {admissionMode === 'quota' && !quota && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  未填名额数 — 留空 = 不设上限（仍走候选池流程，admin 自行控制）
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* The big canvas — flex row [toolbox | canvas | side-panel-when-selected].
            When fullscreen, the whole Card escapes its page slot via
            `fixed inset-0 z-50` (same trick as krypton-ide). The inner flex
            layout is unchanged, so the side panel keeps tracking the canvas's
            right edge — which is the screen's right edge in fullscreen. */}
        <Card
          className={cn(
            'overflow-hidden',
            fullscreen && 'fixed inset-0 z-50 rounded-none border-0',
          )}
        >
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm">任务流程图</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  从左侧拖拽节点到画布；连线拖动节点边上的圆点；删除连线双击它或选中后按 Delete。
                </p>
              </div>
              {/* Header keeps just the fullscreen toggle. Save lives in the
                  bottom action card so the form follows natural top-down flow
                  (same pattern as AssignPage / ScoresPage / SettingsPage). */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setFullscreen((p) => !p)}
                title={fullscreen ? '退出全屏 (Esc)' : '全屏编辑'}
              >
                {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </Button>
            </div>
          </CardHeader>
          <CardContent
            className={cn(
              'p-0',
              fullscreen ? 'flex-1 min-h-0' : '',
            )}
            // In fullscreen, the Card is `fixed inset-0` and uses default
            // CardContent height. Force flex-col on the Card so the canvas
            // row can flex-1 fill remaining viewport height.
            style={fullscreen ? { height: 'calc(100% - 4rem)' } : undefined}
          >
            <div
              className={cn('flex', fullscreen ? 'h-full' : 'h-[68vh]')}
            >
              <Toolbox presetsByCategory={presetsByCategory} />
              <div className="flex min-w-0 flex-1">
                <TaskGraphRenderer
                  graph={graph}
                  presets={data.presets}
                  onChange={setGraph}
                  selectedNodeId={selectedNodeId}
                  onNodeSelect={setSelectedNodeId}
                  height="100%"
                />
              </div>
              {selectedNode && (
                <aside className="flex w-[400px] shrink-0 flex-col border-l bg-background">
                  <div className="flex shrink-0 items-center justify-between border-b px-5 py-3">
                    <h3 className="text-sm font-semibold">
                      {selectedNode.type === 'start' ? '开始节点'
                        : selectedNode.type === 'end' ? '完成节点'
                        : '编辑任务点'}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setSelectedNodeId(null)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      title="关闭"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="space-y-4 px-5 py-4">
                      {selectedNode.type === 'task' ? (
                        <NodeEditor
                          node={selectedNode}
                          presets={data.presets}
                          contests={data.contests}
                          homeworks={data.homeworks}
                          trainings={data.trainings}
                          schools={data.schools}
                          userGroups={data.userGroups}
                          onChangeName={(name) => updateNode(selectedNode.id, { name })}
                          onChangeParam={(name, value) => updateNodeParams(selectedNode.id, name, value)}
                          onDelete={() => deleteNode(selectedNode.id)}
                        />
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {selectedNode.type === 'start' ? '开始节点：所有路径的起点，不可删除。可拖动调整位置。' : '完成节点：所有路径的终点，不可删除。可拖动调整位置。'}
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </aside>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Bottom action bar. Sits outside the canvas Card so it's NOT covered
            when the canvas enters fullscreen — admin must Esc out of fullscreen
            to save, which is the right workflow (review whole graph → save). */}
        <Card>
          <CardContent className="flex items-center justify-end gap-2 py-4">
            <Button asChild type="button" variant="outline">
              <a href="/admin/tasks"><X className="mr-1 size-4" />取消</a>
            </Button>
            <Button type="submit">
              <Save className="mr-1 size-4" />{data.isEdit ? '保存修改' : '创建任务'}
            </Button>
          </CardContent>
        </Card>
      </form>
    </AdminPage>
  );
}

function Toolbox({ presetsByCategory }: { presetsByCategory: Record<string, PresetSummary[]> }) {
  function onDragStart(event: React.DragEvent<HTMLDivElement>, presetId: string) {
    event.dataTransfer.setData(TOOLBOX_MIME, presetId);
    event.dataTransfer.effectAllowed = 'move';
  }
  const groups = [
    { key: 'behavior', label: '行为型', icon: Target, tone: 'sky' },
    { key: 'condition', label: '条件型', icon: UserCheck, tone: 'amber' },
  ] as const;
  // Toolbox is the leftmost column inside a fixed-height flex row, so we let
  // the parent dictate height: `w-[220px]` width, `h-full` to fill the flex
  // row, then ScrollArea inside is `min-h-0 flex-1`. Hardcoded `h-[68vh]`
  // (old behavior) clipped wrong when the page entered fullscreen.
  return (
    <div className="flex h-full w-[220px] shrink-0 flex-col border-r bg-muted/30">
      <h3 className="shrink-0 px-3 pb-2 pt-3 text-xs font-medium text-muted-foreground">从这里拖到画布</h3>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 px-3 pb-4">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <g.icon className={cn('size-3', g.key === 'behavior' ? 'text-sky-500' : 'text-amber-500')} />
                {g.label}
              </div>
              <div className="space-y-1">
                {(presetsByCategory[g.key] || []).map((p) => (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, p.id)}
                    className={cn(
                      'cursor-grab rounded border bg-card px-2 py-1.5 text-xs transition-colors hover:bg-accent active:cursor-grabbing',
                      g.key === 'behavior' && 'hover:border-sky-400',
                      g.key === 'condition' && 'hover:border-amber-400',
                    )}
                    title={p.description}
                  >
                    <div className="font-medium">{p.name}</div>
                    <div className="line-clamp-2 text-[10px] text-muted-foreground">{p.description}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

interface NodeEditorProps {
  node: TaskGraphNode;
  presets: PresetSummary[];
  contests: ContestRef[];
  homeworks: HomeworkRef[];
  trainings: TrainingRef[];
  schools: SchoolRef[];
  userGroups: GroupRef[];
  onChangeName: (name: string) => void;
  onChangeParam: (name: string, value: any) => void;
  onDelete: () => void;
}

function NodeEditor(props: NodeEditorProps) {
  const preset = props.presets.find((p) => p.id === props.node.presetId);
  if (!preset) {
    return (
      <div className="space-y-2 text-xs text-muted-foreground">
        <p>未知的 preset：{props.node.presetId}</p>
        <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={props.onDelete}>
          <Trash2 className="mr-1 size-3.5" />删除节点
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      <FormField label="节点显示名">
        <Input value={props.node.name || ''} onChange={(e) => props.onChangeName(e.target.value)} placeholder={preset.name} />
      </FormField>
      <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <div className="mb-0.5 font-medium">{preset.name}</div>
        {preset.description}
      </div>
      {preset.params.map((p) => (
        <NodeParamInput
          key={p.name}
          spec={p}
          value={props.node.params?.[p.name] ?? ''}
          onChange={(v) => props.onChangeParam(p.name, v)}
          contests={props.contests}
          homeworks={props.homeworks}
          trainings={props.trainings}
          schools={props.schools}
          userGroups={props.userGroups}
        />
      ))}
      <div className="pt-2">
        <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={props.onDelete}>
          <Trash2 className="mr-1 size-3.5" />删除节点
        </Button>
      </div>
    </div>
  );
}

interface NodeParamInputProps {
  spec: PresetSummary['params'][number];
  value: any;
  onChange: (v: any) => void;
  contests: ContestRef[];
  homeworks: HomeworkRef[];
  trainings: TrainingRef[];
  schools: SchoolRef[];
  userGroups: GroupRef[];
}

function NodeParamInput({ spec, value, onChange, contests, homeworks, trainings, schools, userGroups }: NodeParamInputProps) {
  if (spec.type === 'select' || spec.type === 'pat_level' || spec.type === 'pat_season' || spec.type === 'gplt_level') {
    return (
      <FormField label={spec.label} hint={spec.helper} required={spec.required}>
        <SimpleSelect
          value={value || ''}
          onValueChange={onChange}
          placeholder="—"
          options={[
            { value: '', label: '—' },
            ...(spec.options?.map((o) => ({ value: o.value, label: o.label })) || []),
          ]}
        />
      </FormField>
    );
  }
  if (spec.type === 'date') {
    return (
      <FormField label={spec.label} hint={spec.helper} required={spec.required}>
        <Input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} />
      </FormField>
    );
  }
  if (spec.type === 'contest') {
    return (
      <FormField label={spec.label} hint={spec.helper} required={spec.required}>
        <SimpleSelect
          value={value || ''}
          onValueChange={onChange}
          placeholder="— 选择比赛 —"
          options={[
            { value: '', label: '— 选择比赛 —' },
            ...contests.map((c) => ({ value: c._id, label: c.title })),
          ]}
        />
      </FormField>
    );
  }
  if (spec.type === 'homework') {
    return (
      <FormField label={spec.label} hint={spec.helper} required={spec.required}>
        <SimpleSelect
          value={value || ''}
          onValueChange={onChange}
          placeholder="— 选择 homework —"
          options={[
            { value: '', label: '— 选择 homework —' },
            ...homeworks.map((c) => ({ value: c._id, label: c.title })),
          ]}
        />
      </FormField>
    );
  }
  if (spec.type === 'training') {
    return (
      <FormField label={spec.label} hint={spec.helper} required={spec.required}>
        <SimpleSelect
          value={value || ''}
          onValueChange={onChange}
          placeholder="— 选择 training —"
          options={[
            { value: '', label: '— 选择 training —' },
            ...trainings.map((c) => ({ value: c._id, label: c.title })),
          ]}
        />
      </FormField>
    );
  }
  if (spec.type === 'school') {
    return (
      <FormField label={spec.label} hint={spec.helper} required={spec.required}>
        <SimpleSelect
          value={value || ''}
          onValueChange={onChange}
          placeholder="— 选择学校 —"
          options={[
            { value: '', label: '— 选择学校 —' },
            ...schools.map((c) => ({ value: c._id, label: c.name })),
          ]}
        />
      </FormField>
    );
  }
  if (spec.type === 'user_group') {
    return (
      <FormField label={spec.label} hint={spec.helper} required={spec.required}>
        <SimpleSelect
          value={value || ''}
          onValueChange={onChange}
          placeholder="— 选择用户组 —"
          options={[
            { value: '', label: '— 选择用户组 —' },
            ...userGroups.map((g) => {
              const s = schools.find((sc) => sc._id === g.schoolId);
              return { value: g._id, label: `${s ? `${s.name} / ` : ''}${g.name}` };
            }),
          ]}
        />
      </FormField>
    );
  }
  if (spec.type === 'problem') {
    return (
      <FormField label={spec.label} hint={spec.helper || '题目 ID / pid（v2: 后续接入 autocomplete）'} required={spec.required}>
        <Input
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="例如 1001 或 P1001"
        />
      </FormField>
    );
  }
  if (spec.type === 'years') {
    const years = Array.isArray(value) ? value : [];
    return (
      <FormField label={spec.label} hint={spec.helper} required={spec.required}>
        <Input
          value={years.join(' ')}
          onChange={(e) => onChange(
            e.target.value.split(/[\s,，]+/)
              .map((s) => parseInt(s.trim(), 10))
              .filter((n) => Number.isInteger(n) && n >= 1900 && n <= 2099),
          )}
          placeholder="例如 2023 2024"
        />
      </FormField>
    );
  }
  return (
    <FormField label={spec.label} hint={spec.helper} required={spec.required}>
      <Input
        type={spec.type === 'number' ? 'number' : 'text'}
        value={value ?? ''}
        onChange={(e) => onChange(spec.type === 'number' ? +e.target.value : e.target.value)}
        placeholder={spec.default !== undefined ? String(spec.default) : ''}
      />
    </FormField>
  );
}

// ─── Admin Tasks Assign ──────────────────────────────────────────────────

export function AdminTasksAssignPage() {
  const data = useBootstrap().page.data as {
    task: TaskDoc;
    assignments: AssignmentEntry[];
    udict: Record<string, { _id: number; uname: string }>;
    schools: SchoolRef[];
    userGroups: GroupRef[];
  };

  const [scope, setScope] = useState<'uid' | 'user_group' | 'school'>('uid');
  const [uid, setUid] = useState('');
  const [targetId, setTargetId] = useState('');
  const [note, setNote] = useState('');

  return (
    <AdminPage
      title={`分配 — ${data.task.title}`}
      actions={<Button asChild variant="outline"><a href="/admin/tasks"><ArrowLeft className="mr-1 size-4" />返回列表</a></Button>}
    >
      <Card>
        <CardHeader><CardTitle className="text-sm">分配任务</CardTitle></CardHeader>
        <CardContent>
          <form method="post" className="space-y-3">
            <input type="hidden" name="operation" value="batch" />
            <input type="hidden" name="scope" value={scope} />
            <MiniTabs
              size="md"
              value={scope}
              onValueChange={setScope as any}
              items={[
                { value: 'uid', label: '单个用户' },
                { value: 'user_group', label: '整个用户组' },
                { value: 'school', label: '整个学校' },
              ]}
            />
            {scope === 'uid' && (
              <FormField label="用户 UID" required>
                <Input name="uid" type="number" min={1} value={uid} onChange={(e) => setUid(e.target.value)} required />
              </FormField>
            )}
            {scope === 'user_group' && (
              <FormField label="用户组" required>
                <SimpleSelect
                  name="targetId"
                  value={targetId}
                  onValueChange={setTargetId}
                  placeholder="— 选择 —"
                  options={[
                    { value: '', label: '— 选择 —' },
                    ...data.userGroups.map((g) => {
                      const s = data.schools.find((s2) => s2._id === g.schoolId);
                      return { value: g._id, label: `${s ? `${s.name} / ` : ''}${g.name}` };
                    }),
                  ]}
                />
              </FormField>
            )}
            {scope === 'school' && (
              <FormField label="学校" required>
                <SimpleSelect
                  name="targetId"
                  value={targetId}
                  onValueChange={setTargetId}
                  placeholder="— 选择 —"
                  options={[
                    { value: '', label: '— 选择 —' },
                    ...data.schools.map((s) => ({ value: s._id, label: s.name })),
                  ]}
                />
              </FormField>
            )}
            <FormField label="备注">
              <Input name="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：你们班今年的必做任务" />
            </FormField>
            <Button type="submit"><Users className="mr-1 size-4" />分配</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">已分配 ({data.assignments.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.assignments.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">还没有分配记录</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>分配时间</TableHead>
                  <TableHead>备注</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.assignments.map((a) => {
                  const u = data.udict[a.userId];
                  return (
                    <TableRow key={a._id}>
                      <TableCell>{u?.uname || `uid:${a.userId}`}</TableCell>
                      <TableCell>{a.canCancel ? '自主认领' : '管理员分配'}</TableCell>
                      <TableCell><StatusBadge status={a.status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground"><DateTime value={a.assignedAt} /></TableCell>
                      <TableCell className="text-xs">{a.note || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AdminPage>
  );
}

// ─── Admin Tasks Stats ───────────────────────────────────────────────────

export function AdminTasksStatsPage() {
  const data = useBootstrap().page.data as {
    task: TaskDoc;
    assignments: AssignmentEntry[];
    udict: Record<string, { _id: number; uname: string }>;
    studentByUid: Record<string, StudentLite>;
    audit: AuditEntry[];
    presets: PresetSummary[];
  };
  const taskNodes = (data.task.graph?.nodes || []).filter((n) => n.type === 'task');
  const total = data.assignments.length;
  const completed = data.assignments.filter((a) => a.status === 'completed').length;
  const qualified = data.assignments.filter((a) => a.status === 'qualified').length;
  const admitted = data.assignments.filter((a) => a.status === 'admitted').length;
  const [drillIn, setDrillIn] = useState<AssignmentEntry | null>(null);
  const [statsTab, setStatsTab] = useState<'progress' | 'audit'>('progress');
  const presetMap = useMemo(() => Object.fromEntries(data.presets.map((p) => [p.id, p])), [data.presets]);
  const drillUser = drillIn ? data.udict[drillIn.userId] : null;
  const drillStudent = drillIn ? data.studentByUid[String(drillIn.userId)] : null;

  return (
    <AdminPage
      title={`统计 — ${data.task.title}`}
      actions={
        <div className="flex gap-2">
          {data.task.admissionMode === 'quota' && (
            <Button asChild variant="outline">
              <a href={`/admin/tasks/${data.task._id}/candidates`}><Users className="mr-1 size-4" />候选池</a>
            </Button>
          )}
          <Button asChild variant="outline"><a href={`/admin/tasks/${data.task._id}/stats?format=csv`}><FileDown className="mr-1 size-4" />导出 CSV</a></Button>
          <Button asChild variant="outline"><a href="/admin/tasks"><ArrowLeft className="mr-1 size-4" />返回列表</a></Button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardContent>
          <p className="text-xs text-muted-foreground">总分配</p>
          <p className="mt-1 text-2xl font-semibold">{total}</p>
        </CardContent></Card>
        <Card><CardContent>
          <p className="text-xs text-muted-foreground">候选 / 已录取</p>
          <p className="mt-1 text-2xl font-semibold">{qualified}<span className="text-base text-muted-foreground"> / {admitted}</span></p>
        </CardContent></Card>
        <Card><CardContent>
          <p className="text-xs text-muted-foreground">已完成</p>
          <p className="mt-1 text-2xl font-semibold">{completed}</p>
        </CardContent></Card>
        <Card><CardContent>
          <p className="text-xs text-muted-foreground">完成率</p>
          <p className="mt-1 text-2xl font-semibold">{total > 0 ? Math.round((completed / total) * 100) : 0}%</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-sm">统计明细</CardTitle>
          <MiniTabs
            value={statsTab}
            onValueChange={setStatsTab}
            items={[
              { value: 'progress', label: '用户进度', count: data.assignments.length, icon: ListChecks },
              { value: 'audit', label: '审计日志', count: data.audit.length, icon: ClipboardList },
            ]}
          />
        </CardHeader>
        <CardContent className={cn(statsTab === 'progress' && 'p-0')}>
          {statsTab === 'progress' ? (
            data.assignments.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">还没有人认领此任务</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>用户</TableHead>
                    <TableHead>完成进度</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>完成时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.assignments.map((a) => {
                    const u = data.udict[a.userId];
                    const st = data.studentByUid[String(a.userId)];
                    const done = taskNodes.filter((n) => a.progress?.[n.id]?.completed).length;
                    return (
                      <TableRow key={a._id} className="cursor-pointer hover:bg-muted/40" onClick={() => setDrillIn(a)}>
                        <TableCell>
                          <div className="font-medium">{u?.uname || `uid:${a.userId}`}</div>
                          {st ? (
                            <div className="text-xs text-muted-foreground">
                              {st.studentId} · {st.realName}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                              <div
                                className={cn('h-full', a.status === 'completed' ? 'bg-emerald-500' : 'bg-sky-500')}
                                style={{ width: `${taskNodes.length ? (done / taskNodes.length) * 100 : 0}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">{done}/{taskNodes.length}</span>
                          </div>
                        </TableCell>
                        <TableCell><StatusBadge status={a.status} /></TableCell>
                        <TableCell className="text-xs">{a.completedAt ? <DateTime value={a.completedAt} mode="date" /> : '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )
          ) : (
            <div className="space-y-2">
              {data.audit.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">暂无审计日志</p>
              ) : data.audit.map((row) => (
                <div key={row._id} className="rounded-md border p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{row.eventType}</Badge>
                    {row.pointId ? <span className="font-mono text-muted-foreground">{row.pointId}</span> : null}
                    <span className="ml-auto text-muted-foreground"><DateTime value={row.createdAt} /></span>
                  </div>
                  {row.reason && <p className="mt-1 text-muted-foreground">原因：{row.reason}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!drillIn} onOpenChange={(o) => { if (!o) setDrillIn(null); }}>
        <SheetContent side="right" className="w-[640px] sm:max-w-[640px]">
          <SheetHeader>
            <SheetTitle>
              {drillIn ? (drillUser?.uname || `uid:${drillIn.userId}`) : '—'}
            </SheetTitle>
            {drillStudent ? (
              <p className="text-xs text-muted-foreground">
                {drillStudent.studentId} · {drillStudent.realName}
              </p>
            ) : null}
          </SheetHeader>
          {drillIn && (
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-4 px-6 py-5">
                <div className="flex items-center gap-2">
                  <StatusBadge status={drillIn.status} />
                  <span className="text-xs text-muted-foreground">认领于 <DateTime value={drillIn.assignedAt} /></span>
                </div>
                {drillIn.note && (
                  <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">📝 {drillIn.note}</div>
                )}
                <TaskGraphRenderer
                  graph={data.task.graph}
                  presets={data.presets}
                  progress={drillIn.progress}
                  height="45vh"
                />
                <div className="space-y-1.5">
                  {taskNodes.map((n) => {
                    const r = drillIn.progress?.[n.id];
                    return (
                      <AdminNodeProgressRow
                        key={n.id}
                        taskId={data.task._id}
                        assignment={drillIn}
                        node={n}
                        preset={n.presetId ? presetMap[n.presetId] : null}
                        result={r}
                        redirectTo={`/admin/tasks/${data.task._id}/stats`}
                      />
                    );
                  })}
                </div>
              </div>
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>
    </AdminPage>
  );
}

// ─── Admin Tasks Candidates (quota mode) ─────────────────────────────────

export function AdminTasksCandidatesPage() {
  const data = useBootstrap().page.data as {
    task: TaskDoc;
    assignments: AssignmentEntry[];
    udict: Record<string, { _id: number; uname: string }>;
    studentByUid: Record<string, StudentLite>;
    schools: SchoolRef[];
    userGroups: GroupRef[];
    counts: { qualified: number; admitted: number; completed: number };
    presets: PresetSummary[];
  };
  const taskNodes = (data.task.graph?.nodes || []).filter((n) => n.type === 'task');

  // Local filter state.
  const [query, setQuery] = useState('');
  const [schoolFilter, setSchoolFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'qualified' | 'admitted' | 'completed'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drillIn, setDrillIn] = useState<AssignmentEntry | null>(null);
  const presetMap = useMemo(() => Object.fromEntries(data.presets.map((p) => [p.id, p])), [data.presets]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.assignments.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      const u = data.udict[a.userId];
      const st = data.studentByUid[a.userId];
      if (schoolFilter && st?.schoolId !== schoolFilter) return false;
      if (q) {
        const hay = `${u?.uname || ''} ${st?.realName || ''} ${st?.studentId || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data.assignments, data.udict, data.studentByUid, query, schoolFilter, statusFilter]);

  const allVisibleSelected = visible.length > 0 && visible.every((a) => selected.has(a._id));
  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) for (const a of visible) next.delete(a._id);
      else for (const a of visible) next.add(a._id);
      return next;
    });
  }
  function toggleOne(aid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(aid)) next.delete(aid);
      else next.add(aid);
      return next;
    });
  }

  return (
    <AdminPage
      title={`候选池 — ${data.task.title}`}
      actions={
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn('gap-1',
              data.task.quota && data.counts.admitted > data.task.quota && 'border-rose-500 text-rose-700')}
          >
            <Users className="size-3" />
            已选 {data.counts.admitted + data.counts.completed}
            {data.task.quota != null ? ` / ${data.task.quota}` : ''}
          </Badge>
          <Button asChild variant="outline"><a href={`/admin/tasks/${data.task._id}/stats`}>统计</a></Button>
          <Button asChild variant="outline"><a href="/admin/tasks"><ArrowLeft className="mr-1 size-4" />返回</a></Button>
        </div>
      }
    >
      {/* Filter bar */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Input
            placeholder="搜索 用户名 / 真实姓名 / 学号…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-xs"
          />
          <SimpleSelect
            value={schoolFilter}
            onValueChange={setSchoolFilter}
            options={[
              { value: '', label: '所有学校' },
              ...data.schools.map((s) => ({ value: s._id, label: s.name })),
            ]}
            className="w-40"
          />
          <MiniTabs
            value={statusFilter}
            onValueChange={setStatusFilter as any}
            items={[
              { value: 'all', label: `全部 (${data.assignments.length})` },
              { value: 'qualified', label: `候选 (${data.counts.qualified})` },
              { value: 'admitted', label: `已录取 (${data.counts.admitted})` },
              { value: 'completed', label: `已完成 (${data.counts.completed})` },
            ]}
          />
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            选中 <span className="font-semibold text-foreground">{selected.size}</span> 人
          </div>
        </CardContent>
      </Card>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="flex flex-wrap items-center gap-2 py-2">
            <BulkActionForm
              taskId={data.task._id}
              operation="admit"
              aids={Array.from(selected)}
              label="批量录取"
              variant="default"
            />
            <BulkActionForm
              taskId={data.task._id}
              operation="unadmit"
              aids={Array.from(selected)}
              label="撤销录取"
              variant="outline"
            />
            <BulkActionForm
              taskId={data.task._id}
              operation="confirm"
              aids={Array.from(selected)}
              label="确认录取并生效"
              variant="default"
              confirm={`确定让这 ${selected.size} 人进入 completed 状态？此操作不可逆，将触发留校 +1 等副作用。`}
            />
            <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <X className="mr-1 size-3.5" />清空选择
            </Button>
            <div className="ml-auto flex gap-2">
              <ExportCSV taskId={data.task._id} filter={{ status: 'admitted' }} label="导出录取名单" />
              <ExportCSV taskId={data.task._id} filter={{ status: 'qualified' }} label="导出候选名单" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main table */}
      <Card>
        <CardContent className="p-0">
          {visible.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {data.assignments.length === 0 ? '候选池还为空——等用户图条件全满足后会自动进入此池' : '没有匹配的候选'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox checked={allVisibleSelected} onChange={toggleAllVisible} />
                  </TableHead>
                  <TableHead>用户</TableHead>
                  <TableHead>学校 / 年级</TableHead>
                  <TableHead>节点完成</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>候选时间</TableHead>
                  <TableHead>备注</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((a) => {
                  const u = data.udict[a.userId];
                  const st = data.studentByUid[a.userId];
                  const school = st ? data.schools.find((s) => s._id === st.schoolId) : null;
                  return (
                    <TableRow key={a._id}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(a._id)}
                          onChange={() => toggleOne(a._id)}
                        />
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="text-left hover:underline"
                          onClick={() => setDrillIn(a)}
                        >
                          <div className="font-medium">{u?.uname || `uid:${a.userId}`}</div>
                          {st && (
                            <div className="text-xs text-muted-foreground">
                              {st.realName} · {st.studentId}
                            </div>
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {school?.name || '—'}
                        {st?.enrollmentYear ? ` · ${st.enrollmentYear} 级` : ''}
                      </TableCell>
                      <TableCell>
                        <DotMatrix nodes={taskNodes} progress={a.progress} />
                      </TableCell>
                      <TableCell><StatusBadge status={a.status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.qualifiedAt ? <DateTime value={a.qualifiedAt} /> : '—'}
                      </TableCell>
                      <TableCell className="text-xs">{a.admissionNote || a.note || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Drill-in sheet */}
      <Sheet open={!!drillIn} onOpenChange={(o) => { if (!o) setDrillIn(null); }}>
        <SheetContent side="right" className="w-[680px] sm:max-w-[680px]">
          <SheetHeader>
            <SheetTitle>
              {drillIn ? (data.udict[drillIn.userId]?.uname || `uid:${drillIn.userId}`) : '—'}
            </SheetTitle>
          </SheetHeader>
          {drillIn && (
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-4 px-6 py-5">
                <div className="flex items-center gap-2">
                  <StatusBadge status={drillIn.status} />
                  {drillIn.admittedAt && (
                    <span className="text-xs text-muted-foreground">
                      录取于 <DateTime value={drillIn.admittedAt} />
                    </span>
                  )}
                </div>
                <TaskGraphRenderer
                  graph={data.task.graph}
                  presets={data.presets}
                  progress={drillIn.progress}
                  height="40vh"
                />
                <div className="space-y-1.5">
                  {taskNodes.map((n) => {
                    const r = drillIn.progress?.[n.id];
                    return (
                      <AdminNodeProgressRow
                        key={n.id}
                        taskId={data.task._id}
                        assignment={drillIn}
                        node={n}
                        preset={n.presetId ? presetMap[n.presetId] : null}
                        result={r}
                        redirectTo={`/admin/tasks/${data.task._id}/candidates`}
                      />
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  {drillIn.status === 'qualified' && (
                    <BulkActionForm
                      taskId={data.task._id}
                      operation="admit"
                      aids={[drillIn._id]}
                      label="录取此人"
                      variant="default"
                    />
                  )}
                  {drillIn.status === 'admitted' && (
                    <>
                      <BulkActionForm
                        taskId={data.task._id}
                        operation="confirm"
                        aids={[drillIn._id]}
                        label="确认录取并生效"
                        variant="default"
                        confirm="确认后此人状态变 completed，触发留校等副作用。"
                      />
                      <BulkActionForm
                        taskId={data.task._id}
                        operation="unadmit"
                        aids={[drillIn._id]}
                        label="撤销录取"
                        variant="outline"
                      />
                    </>
                  )}
                </div>
              </div>
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>
    </AdminPage>
  );
}

function DotMatrix({ nodes, progress }: {
  nodes: TaskGraphNode[];
  progress: Record<string, TaskPointResult>;
}) {
  return (
    <div className="flex flex-wrap gap-0.5">
      {nodes.map((n) => {
        const r = progress[n.id];
        const detail = r
          ? `${n.name || n.presetId}: ${r.completed ? '✓' : '○'} ${r.target > 1 ? `${r.current}/${r.target}` : ''} ${r.details || ''}`
          : `${n.name || n.presetId}: ○`;
        return (
          <span
            key={n.id}
            title={detail}
            className={cn(
              'inline-block size-2.5 rounded-full',
              r?.completed ? 'bg-emerald-500' : 'bg-muted-foreground/30',
            )}
          />
        );
      })}
    </div>
  );
}

function AdminNodeProgressRow({
  taskId, assignment, node, preset, result, redirectTo,
}: {
  taskId: string;
  assignment: AssignmentEntry;
  node: TaskGraphNode;
  preset?: PresetSummary | null;
  result?: TaskPointResult;
  redirectTo: string;
}) {
  const completed = !!result?.completed;
  const isManualConfirm = node.presetId === 'manual_confirm';
  const canOverride = assignment.status !== 'completed' && assignment.status !== 'cancelled';
  const reason = completed
    ? '从管理端进度抽屉撤销人工判定'
    : isManualConfirm ? '管理员手动确认' : '从管理端进度抽屉人工判定完成';
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md border px-3 py-2 text-xs">
      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('inline-flex size-4 shrink-0 items-center justify-center rounded-full',
            completed ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground')}>
            {completed ? '✓' : '○'}
          </span>
          <span className="truncate font-medium">{node.name || preset?.name || node.presetId}</span>
          {isManualConfirm && <Badge variant="secondary" className="shrink-0 text-[10px]">手动确认</Badge>}
          {result?.overridden && <Badge variant="outline" className="shrink-0 text-[10px]">人工</Badge>}
        </div>
        <div className="pl-6 text-[11px] text-muted-foreground">
          {result?.details || preset?.description || '尚未评估'}
          {result && result.target > 1 && (
            <span className="ml-2 tabular-nums">{result.current}/{result.target}</span>
          )}
        </div>
      </div>
      <div className="flex items-center">
        {canOverride ? (
          <form method="post" action={`/admin/tasks/${taskId}/override`}>
            <input type="hidden" name="aid" value={assignment._id} />
            <input type="hidden" name="pointId" value={node.id} />
            <input type="hidden" name="completed" value={completed ? 'false' : 'true'} />
            <input type="hidden" name="reason" value={reason} />
            <input type="hidden" name="redirect" value={redirectTo} />
            <Button
              type="submit"
              size="sm"
              variant={completed ? 'outline' : 'default'}
              className="h-7 px-2 text-xs"
            >
              {completed ? '撤销判定' : isManualConfirm ? '确认完成' : '判定完成'}
            </Button>
          </form>
        ) : (
          <span className="text-[11px] text-muted-foreground">已终局</span>
        )}
      </div>
    </div>
  );
}

function BulkActionForm({ taskId, operation, aids, label, variant, confirm }: {
  taskId: string;
  operation: 'admit' | 'unadmit' | 'confirm';
  aids: string[];
  label: string;
  variant?: 'default' | 'outline' | 'ghost';
  confirm?: string;
}) {
  return (
    <form
      method="post"
      action={`/admin/tasks/${taskId}/candidates`}
      onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}
    >
      <input type="hidden" name="operation" value={operation} />
      <input type="hidden" name="aids" value={aids.join(',')} />
      <Button type="submit" size="sm" variant={variant || 'default'}>
        {operation === 'admit' && <UserCheck className="mr-1 size-3.5" />}
        {operation === 'confirm' && <ListChecks className="mr-1 size-3.5" />}
        {operation === 'unadmit' && <X className="mr-1 size-3.5" />}
        {label}
      </Button>
    </form>
  );
}

function ExportCSV({ taskId, filter, label }: {
  taskId: string;
  filter: { status: string };
  label: string;
}) {
  // CSV export piggy-backs on stats?format=csv for now; future endpoint can
  // narrow by status (TODO).
  return (
    <Button asChild size="sm" variant="outline">
      <a href={`/admin/tasks/${taskId}/stats?format=csv`}>
        <FileDown className="mr-1 size-3.5" />{label}
      </a>
    </Button>
  );
}

// ─── Admin Tasks Scores ──────────────────────────────────────────────────

interface PatScore { _id: string; userId: number; level: string; year: number; season: string; score: number; createdAt: string }
interface GpltScore { _id: string; userId: number; level: string; year: number; score: number; rank: number | null; createdAt: string }
interface CspScore { _id: string; userId: number; round: number; score: number; createdAt: string }

interface DomainSettings {
  maxPatScore: number; maxGpltScore: number; maxCspScore: number;
}

interface StayEvent { _id: string; userId: number; year: number; source: string; createdAt: string }

export function AdminTasksScoresPage() {
  const data = useBootstrap().page.data as {
    tab: 'pat' | 'gplt' | 'csp' | 'stay';
    scores: any[];
    stayEvents?: StayEvent[];
    schools?: { _id: string; name: string }[];
    udict: Record<string, { _id: number; uname: string }>;
    settings: DomainSettings;
    level: string;
    year: number;
  };
  const tabs = [
    { key: 'pat', label: 'PAT 认证' },
    { key: 'gplt', label: '天梯赛' },
    { key: 'csp', label: 'CSP 认证' },
    { key: 'stay', label: '留校次数' },
  ];

  return (
    <AdminPage
      title="比赛分数管理"
      description="录入 PAT / GPLT / CSP 等外部比赛成绩 — 这些分数会被任务点用作完成判定的输入。"
    >
      <MiniTabs
        size="md"
        value={data.tab}
        items={tabs.map((t) => ({ value: t.key as any, label: t.label, href: `/admin/tasks/scores?tab=${t.key}` }))}
      />

      {data.tab === 'pat' && <PatScoreTab scores={data.scores} udict={data.udict} settings={data.settings} />}
      {data.tab === 'gplt' && <GpltScoreTab scores={data.scores} udict={data.udict} settings={data.settings} />}
      {data.tab === 'csp' && <CspScoreTab scores={data.scores} udict={data.udict} settings={data.settings} />}
      {data.tab === 'stay' && (
        <StayCountTab
          events={data.stayEvents || []}
          schools={data.schools || []}
          udict={data.udict}
        />
      )}
    </AdminPage>
  );
}

function PatScoreTab({ scores, udict, settings }: { scores: PatScore[]; udict: any; settings: DomainSettings }) {
  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-sm">添加 / 更新 PAT 成绩</CardTitle></CardHeader>
        <CardContent>
          <form method="post" action="/admin/tasks/scores?tab=pat" className="space-y-3">
            <input type="hidden" name="operation" value="pat" />
            <FormRow columns={4}>
              <FormField label="用户 UID" required>
                <Input name="userId" type="number" min={1} required />
              </FormField>
              <FormField label="等级" required>
                <SimpleSelect
                  name="level"
                  required
                  defaultValue="advanced"
                  options={[
                    { value: 'advanced', label: '甲级' },
                    { value: 'basic', label: '乙级' },
                  ]}
                />
              </FormField>
              <FormField label="年份" required>
                <Input name="year" type="number" min={2010} max={2100} defaultValue={new Date().getFullYear()} required />
              </FormField>
              <FormField label="季节" required>
                <SimpleSelect
                  name="season"
                  required
                  defaultValue="spring"
                  options={[
                    { value: 'spring', label: '春季' },
                    { value: 'summer', label: '夏季' },
                    { value: 'autumn', label: '秋季' },
                    { value: 'winter', label: '冬季' },
                  ]}
                />
              </FormField>
            </FormRow>
            <FormRow columns={4}>
              <FormField label={`分数 (0-${settings.maxPatScore})`} required>
                <Input name="score" type="number" min={0} max={settings.maxPatScore} step={1} required />
              </FormField>
            </FormRow>
            <Button type="submit"><Plus className="mr-1 size-4" />保存</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">已录入成绩 ({scores.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {scores.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">还没有 PAT 成绩</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>用户</TableHead><TableHead>等级</TableHead><TableHead>年份</TableHead>
                <TableHead>季节</TableHead><TableHead>分数</TableHead><TableHead>录入时间</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {scores.map((s) => (
                  <TableRow key={s._id}>
                    <TableCell>{udict[s.userId]?.uname || `uid:${s.userId}`}</TableCell>
                    <TableCell>{s.level === 'advanced' ? '甲级' : '乙级'}</TableCell>
                    <TableCell>{s.year}</TableCell>
                    <TableCell>{{ spring: '春', summer: '夏', autumn: '秋', winter: '冬' }[s.season] || s.season}</TableCell>
                    <TableCell className="font-medium">{s.score}</TableCell>
                    <TableCell className="text-xs text-muted-foreground"><DateTime value={s.createdAt} mode="date" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function GpltScoreTab({ scores, udict, settings }: { scores: GpltScore[]; udict: any; settings: DomainSettings }) {
  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-sm">添加 / 更新天梯赛成绩</CardTitle></CardHeader>
        <CardContent>
          <form method="post" action="/admin/tasks/scores?tab=gplt" className="space-y-3">
            <input type="hidden" name="operation" value="gplt" />
            <FormRow columns={4}>
              <FormField label="用户 UID" required><Input name="userId" type="number" min={1} required /></FormField>
              <FormField label="比赛级别" required>
                <SimpleSelect
                  name="level"
                  required
                  defaultValue="school"
                  options={[
                    { value: 'school', label: '校赛' },
                    { value: 'national', label: '国赛' },
                  ]}
                />
              </FormField>
              <FormField label="年份" required><Input name="year" type="number" min={2010} max={2100} defaultValue={new Date().getFullYear()} required /></FormField>
              <FormField label={`分数 (0-${settings.maxGpltScore})`} required>
                <Input name="score" type="number" min={0} max={settings.maxGpltScore} step={1} required />
              </FormField>
            </FormRow>
            <FormField label="排名（可选）"><Input name="rank" type="number" min={1} /></FormField>
            <Button type="submit"><Plus className="mr-1 size-4" />保存</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">已录入成绩 ({scores.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {scores.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">还没有天梯赛成绩</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>用户</TableHead><TableHead>级别</TableHead><TableHead>年份</TableHead>
                <TableHead>分数</TableHead><TableHead>排名</TableHead><TableHead>录入时间</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {scores.map((s) => (
                  <TableRow key={s._id}>
                    <TableCell>{udict[s.userId]?.uname || `uid:${s.userId}`}</TableCell>
                    <TableCell>{s.level === 'school' ? '校赛' : '国赛'}</TableCell>
                    <TableCell>{s.year}</TableCell>
                    <TableCell className="font-medium">{s.score}</TableCell>
                    <TableCell>{s.rank || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground"><DateTime value={s.createdAt} mode="date" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function CspScoreTab({ scores, udict, settings }: { scores: CspScore[]; udict: any; settings: DomainSettings }) {
  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-sm">添加 / 更新 CSP 成绩</CardTitle></CardHeader>
        <CardContent>
          <form method="post" action="/admin/tasks/scores?tab=csp" className="space-y-3">
            <input type="hidden" name="operation" value="csp" />
            <FormRow columns={3}>
              <FormField label="用户 UID" required><Input name="userId" type="number" min={1} required /></FormField>
              <FormField label="认证次数（第几次）" required><Input name="round" type="number" min={1} max={100} required placeholder="例如 37" /></FormField>
              <FormField label={`分数 (0-${settings.maxCspScore})`} required>
                <Input name="score" type="number" min={0} max={settings.maxCspScore} step={1} required />
              </FormField>
            </FormRow>
            <Button type="submit"><Plus className="mr-1 size-4" />保存</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">已录入成绩 ({scores.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {scores.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">还没有 CSP 成绩</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>用户</TableHead><TableHead>次数</TableHead><TableHead>分数</TableHead><TableHead>录入时间</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {scores.map((s) => (
                  <TableRow key={s._id}>
                    <TableCell>{udict[s.userId]?.uname || `uid:${s.userId}`}</TableCell>
                    <TableCell>第 {s.round} 次</TableCell>
                    <TableCell className="font-medium">{s.score}</TableCell>
                    <TableCell className="text-xs text-muted-foreground"><DateTime value={s.createdAt} mode="date" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function StayCountTab({
  events, schools, udict,
}: {
  events: StayEvent[];
  schools: { _id: string; name: string }[];
  udict: any;
}) {
  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-sm">单条录入留校事件</CardTitle></CardHeader>
        <CardContent>
          <form method="post" action="/admin/tasks/scores?tab=stay" className="space-y-3">
            <input type="hidden" name="operation" value="stay" />
            <FormRow columns={4}>
              <FormField label="学校" required>
                <SimpleSelect
                  name="schoolId"
                  required
                  defaultValue=""
                  placeholder="选择"
                  options={[
                    { value: '', label: '选择学校' },
                    ...schools.map((s) => ({ value: s._id, label: s.name })),
                  ]}
                />
              </FormField>
              <FormField label="学号" required><Input name="studentId" required /></FormField>
              <FormField label="姓名" required><Input name="realName" required /></FormField>
              <FormField label="年份" required>
                <Input name="year" type="number" min={2010} max={2100} defaultValue={new Date().getFullYear()} required />
              </FormField>
            </FormRow>
            <Button type="submit"><Plus className="mr-1 size-4" />添加</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">TSV 批量导入</CardTitle></CardHeader>
        <CardContent>
          <form method="post" action="/admin/tasks/scores?tab=stay" className="space-y-3">
            <input type="hidden" name="operation" value="stayImport" />
            <FormField label="选择学校" required>
              <SimpleSelect
                name="schoolId"
                required
                defaultValue=""
                placeholder="选择"
                options={[
                  { value: '', label: '选择学校' },
                  ...schools.map((s) => ({ value: s._id, label: s.name })),
                ]}
              />
            </FormField>
            <FormField label="粘贴 TSV：每行「学号 姓名 年份」" hint="字段用 Tab 或空格分隔；重复的行 = 重复 +1。每行不匹配学生档案 / 未绑定 OJ 都会跳过并报错">
              <textarea
                name="text" rows={6}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
                placeholder={'240340179\t张三\t2024\n240340180\t李四\t2024'}
                required
              />
            </FormField>
            <Button type="submit"><FileDown className="mr-1 size-4" />批量导入</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">已录入留校事件 ({events.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {events.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">还没有留校事件</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>用户</TableHead>
                <TableHead>年份</TableHead>
                <TableHead>来源</TableHead>
                <TableHead>录入时间</TableHead>
                <TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {events.map((e) => {
                  const isManual = e.source.startsWith('manual:');
                  return (
                    <TableRow key={e._id}>
                      <TableCell>{udict[e.userId]?.uname || `uid:${e.userId}`}</TableCell>
                      <TableCell className="tabular-nums">{e.year}</TableCell>
                      <TableCell>
                        <Badge variant={isManual ? 'secondary' : 'default'} className="text-[10px]">
                          {isManual ? '手动录入' : `自动（${e.source.slice(0, 16)}…）`}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground"><DateTime value={e.createdAt} mode="date" /></TableCell>
                      <TableCell>
                        <form
                          method="post" action="/admin/tasks/scores?tab=stay"
                          className="inline"
                          onSubmit={(ev) => { if (!confirm('确定删除该事件？此操作不会撤销已完成的任务')) ev.preventDefault(); }}
                        >
                          <input type="hidden" name="operation" value="stayDelete" />
                          <input type="hidden" name="id" value={e._id} />
                          <Button type="submit" size="sm" variant="ghost" className="h-7 text-xs text-destructive">删除</Button>
                        </form>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ─── Admin Tasks Settings ────────────────────────────────────────────────

export function AdminTasksSettingsPage() {
  const data = useBootstrap().page.data as { settings: DomainSettings };
  return (
    <AdminPage
      title="任务系统设置"
      description="配置 PAT / GPLT / CSP 分数录入的上限。这些上限会被任务点的 minScore 校验时强制约束。"
    >
      <Card>
        <CardHeader><CardTitle className="text-sm">分数上限</CardTitle></CardHeader>
        <CardContent>
          <form method="post" className="space-y-3">
            <FormRow columns={3}>
              <FormField label="PAT 分数上限" hint="默认 100">
                <Input name="maxPatScore" type="number" min={0} defaultValue={data.settings.maxPatScore} />
              </FormField>
              <FormField label="天梯赛分数上限" hint="默认 290">
                <Input name="maxGpltScore" type="number" min={0} defaultValue={data.settings.maxGpltScore} />
              </FormField>
              <FormField label="CSP 分数上限" hint="默认 500">
                <Input name="maxCspScore" type="number" min={0} defaultValue={data.settings.maxCspScore} />
              </FormField>
            </FormRow>
            <Button type="submit"><Settings className="mr-1 size-4" />保存设置</Button>
          </form>
        </CardContent>
      </Card>
    </AdminPage>
  );
}
