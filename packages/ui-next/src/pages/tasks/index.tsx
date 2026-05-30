/**
 * /tasks (user-facing) — task center + my tasks + task detail.
 *
 * Bootstrap shape comes from packages/krypton-tasks/src/handler.ts.
 * Pages register in PAGE_MAP (see ../resolver.tsx) via:
 *   - tasks_center.html      → TaskCenterPage
 *   - tasks_my.html          → TaskMyPage
 *   - tasks_detail.html      → TaskDetailPage
 */
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle, Calendar, CheckCircle2, ChevronRight, Clock, ClipboardList, Hourglass,
  Loader2, ListChecks, Lock, Network, RefreshCw, Tag, Trophy, UserCheck, XCircle,
} from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateTime } from '@/components/ui/datetime';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Checkbox } from '@/components/ui/checkbox';
import {
  TaskGraphRenderer,
  type PresetSummary, type TaskGraph, type TaskGraphNode, type TaskPointResult,
} from '@/components/task-graph';

// ─── Shared types ─────────────────────────────────────────────────────────

interface TaskAccess {
  type: 'public' | 'user_group' | 'school' | 'grade';
  targetId?: string;
  years?: number[];
}

type AdmissionMode = 'auto' | 'quota';

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

type AssignmentStatus = 'pending' | 'qualified' | 'admitted' | 'completed' | 'cancelled';

interface TaskAssignment {
  _id: string;
  taskId: string;
  userId: number;
  assignedBy: number;
  assignedAt: string;
  canCancel: boolean;
  status: AssignmentStatus;
  completedAt: string | null;
  progress: Record<string, TaskPointResult>;
  progressUpdatedAt: string | null;
  note: string;
}

interface AssignmentSummary {
  _id: string;
  status: string;
  canCancel: boolean;
  assignedAt?: string | null;
}

interface TaskParamRefs {
  contests?: Array<{ _id: string; title: string; beginAt?: string | null; rule?: string }>;
  homeworks?: Array<{ _id: string; title: string; beginAt?: string | null; rule?: string }>;
  trainings?: Array<{ _id: string; title: string }>;
  problems?: Array<{ docId: number | string; pid?: string; title: string }>;
  schools?: Array<{ _id: string; name: string }>;
  userGroups?: Array<{ _id: string; schoolId?: string; name: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function timeMs(value?: string | null): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function useLiveNow(enabled = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}

function formatCountdown(totalMs: number): string {
  const ms = Math.max(0, totalMs);
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) return `${days}天 ${pad(hours)}:${pad(minutes)}`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

type CountdownTone = 'info' | 'warning' | 'danger' | 'muted';

function countdownNoticeFor(
  task: TaskDoc,
  status: AssignmentStatus | 'not-claimed',
  now: number,
): { label: string; target?: number; tone: CountdownTone } | null {
  const claimed = status !== 'not-claimed';
  const claimStart = timeMs(task.claimStartAt);
  const claimEnd = timeMs(task.claimEndAt);
  const statsEnd = timeMs(task.endDate);
  const day = 24 * 60 * 60 * 1000;

  if (!claimed) {
    if (!task.isActive) return null;
    if (claimStart !== null && now < claimStart) {
      if (claimStart - now <= 7 * day) return { label: '距认领开始', target: claimStart, tone: 'info' };
      return null;
    }
    if (claimEnd !== null) {
      if (now > claimEnd) return { label: '认领已截止', tone: 'muted' };
      const remaining = claimEnd - now;
      if (remaining <= day) return { label: '认领即将截止', target: claimEnd, tone: 'danger' };
      if (remaining <= 3 * day) return { label: '认领截止倒计时', target: claimEnd, tone: 'warning' };
    }
    return null;
  }

  if (status === 'completed' || status === 'cancelled' || statsEnd === null) return null;
  if (now > statsEnd) return { label: '统计窗口已截止', tone: 'muted' };
  const remaining = statsEnd - now;
  if (remaining <= day) return { label: '任务即将截止', target: statsEnd, tone: 'danger' };
  if (remaining <= 7 * day) return { label: '任务截止倒计时', target: statsEnd, tone: 'warning' };
  return null;
}

type ClaimStateKind = 'claimed' | 'open' | 'upcoming' | 'closed' | 'inactive';

function claimStateFor(task: TaskDoc, claimed: boolean, now = Date.now()): {
  kind: ClaimStateKind;
  canClaim: boolean;
  badge?: ReactNode;
  buttonText: string;
  detail: ReactNode;
} {
  if (claimed) {
    return { kind: 'claimed', canClaim: false, buttonText: '已认领', detail: '已认领，可继续检查进度' };
  }
  if (!task.isActive) {
    return { kind: 'inactive', canClaim: false, buttonText: '任务已停用', detail: '任务已停用' };
  }
  const start = timeMs(task.claimStartAt);
  const end = timeMs(task.claimEndAt);
  if (start !== null && now < start) {
    return {
      kind: 'upcoming',
      canClaim: false,
      badge: <Badge variant="outline" className="gap-1 text-[10px]"><Clock className="size-3" />即将开放</Badge>,
      buttonText: '未到认领时间',
      detail: <>认领开始 <DateTime value={task.claimStartAt!} mode="datetime" /></>,
    };
  }
  if (end !== null && now > end) {
    return {
      kind: 'closed',
      canClaim: false,
      badge: <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground"><Lock className="size-3" />已截止</Badge>,
      buttonText: '认领已截止',
      detail: <>认领截止 <DateTime value={task.claimEndAt!} mode="datetime" /></>,
    };
  }
  return {
    kind: 'open',
    canClaim: true,
    badge: <Badge variant="outline" className="gap-1 text-[10px] text-emerald-700 dark:text-emerald-300"><UserCheck className="size-3" />可认领</Badge>,
    buttonText: '认领任务',
    detail: task.claimEndAt
      ? <>认领截止 <DateTime value={task.claimEndAt} mode="datetime" /></>
      : '认领不限时间',
  };
}

function taskCenterRank(task: TaskDoc, status: AssignmentStatus | 'not-claimed'): number {
  const claim = claimStateFor(task, status !== 'not-claimed');
  if (status === 'not-claimed' && claim.kind === 'open') return 0;
  if (status === 'pending' || status === 'qualified' || status === 'admitted') return 1;
  if (status === 'not-claimed' && claim.kind === 'upcoming') return 2;
  if (status === 'not-claimed' && claim.kind === 'closed') return 3;
  if (status === 'completed') return 4;
  return 5;
}

function TaskTimeBlock({
  task, status, assignedAt, now, compact = false,
}: {
  task: TaskDoc;
  status: AssignmentStatus | 'not-claimed';
  assignedAt?: string | null;
  now: number;
  compact?: boolean;
}) {
  return (
    <div className={cn(
      'space-y-1.5 rounded-md border bg-muted/20 p-2.5 text-xs',
      compact && 'p-2',
    )}>
      <TimeRow
        icon={Clock}
        label="认领"
        value={(
          <>
            {task.claimStartAt ? <DateTime value={task.claimStartAt} mode="datetime" /> : '不限开始'}
            {' - '}
            {task.claimEndAt ? <DateTime value={task.claimEndAt} mode="datetime" /> : '不限截止'}
          </>
        )}
      />
      {assignedAt && (
        <TimeRow
          icon={UserCheck}
          label="已认领"
          value={<DateTime value={assignedAt} mode="datetime" />}
        />
      )}
      <TimeRow
        icon={Calendar}
        label="统计"
        value={(
          <>
            {task.startDate ? <DateTime value={task.startDate} mode="datetime" /> : '不限开始'}
            {' - '}
            {task.endDate ? <DateTime value={task.endDate} mode="datetime" /> : '不限截止'}
          </>
        )}
      />
      <TaskCountdownNotice task={task} status={status} now={now} />
    </div>
  );
}

function TimeRow({
  icon: Icon, label, value,
}: { icon: any; label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-1.5 text-muted-foreground">
      <Icon className="mt-0.5 size-3 shrink-0" />
      <span className="shrink-0 text-foreground/70">{label}</span>
      <span className="min-w-0 flex-1 break-words">{value}</span>
    </div>
  );
}

function TaskCountdownNotice({
  task, status, now,
}: { task: TaskDoc; status: AssignmentStatus | 'not-claimed'; now: number }) {
  const notice = countdownNoticeFor(task, status, now);
  if (!notice) return null;
  const toneClass = {
    info: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
    danger: 'border-destructive/30 bg-destructive/10 text-destructive',
    muted: 'border-border bg-muted/60 text-muted-foreground',
  }[notice.tone];
  return (
    <div className={cn(
      'mt-2 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium',
      toneClass,
    )}>
      {notice.tone === 'danger' || notice.tone === 'warning'
        ? <AlertTriangle className="size-3.5 shrink-0" />
        : <Clock className="size-3.5 shrink-0" />}
      <span>{notice.label}</span>
      {notice.target && (
        <span className="ml-auto font-mono tabular-nums">{formatCountdown(notice.target - now)}</span>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: AssignmentStatus | 'not-claimed' }) {
  if (status === 'completed') {
    return <Badge variant="default" className="gap-1 bg-emerald-500 text-white hover:bg-emerald-500/90"><CheckCircle2 className="size-3" />已完成</Badge>;
  }
  if (status === 'admitted') {
    return <Badge variant="default" className="gap-1 bg-violet-500 text-white hover:bg-violet-500/90"><UserCheck className="size-3" />已录取</Badge>;
  }
  if (status === 'qualified') {
    return <Badge variant="default" className="gap-1 bg-amber-500 text-white hover:bg-amber-500/90"><Trophy className="size-3" />候选中</Badge>;
  }
  if (status === 'pending') {
    return <Badge variant="default" className="gap-1 bg-sky-500 text-white hover:bg-sky-500/90"><Loader2 className="size-3 animate-spin" />进行中</Badge>;
  }
  if (status === 'cancelled') {
    return <Badge variant="outline" className="gap-1 text-muted-foreground"><XCircle className="size-3" />已取消</Badge>;
  }
  return <Badge variant="outline" className="gap-1"><Hourglass className="size-3" />未认领</Badge>;
}

function AccessPill({ access }: { access: TaskAccess }) {
  if (access.type === 'public') return null;
  const label = access.type === 'school' ? '限定学校'
    : access.type === 'user_group' ? '限定用户组'
    : access.type === 'grade' ? '限定年级'
    : '限定可见';
  return (
    <Badge variant="outline" className="gap-1 text-[10px]">
      <Lock className="size-3" />{label}
    </Badge>
  );
}

function ProgressBar({ result }: { result: TaskPointResult }) {
  const pct = result.target > 0 ? Math.min(100, Math.round((result.current / result.target) * 100)) : (result.completed ? 100 : 0);
  const color = result.completed ? 'bg-emerald-500' : result.current > 0 ? 'bg-sky-500' : 'bg-muted-foreground/30';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn('h-full transition-all', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function isEmptyParamValue(value: any): boolean {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

function refId(value: any): string {
  if (value == null) return '';
  if (typeof value === 'object' && typeof value.toHexString === 'function') return value.toHexString();
  return String(value);
}

function RefDisplay({ title, meta }: { title: ReactNode; meta?: ReactNode }) {
  return (
    <span className="inline-flex max-w-full flex-col items-end text-right">
      <span className="max-w-full truncate">{title}</span>
      {meta && <span className="text-[10px] font-normal text-muted-foreground">{meta}</span>}
    </span>
  );
}

function missingRefLabel(value: any): ReactNode {
  const id = refId(value);
  if (!id) return '未配置';
  return <span className="break-all text-muted-foreground">未找到：{id}</span>;
}

function effectiveParamValue(node: TaskGraphNode, spec: PresetSummary['params'][number], task: TaskDoc): {
  value: any;
  note?: string;
} {
  const raw = node.params?.[spec.name];
  if (!isEmptyParamValue(raw)) return { value: raw };
  if (spec.name === 'startDate' && task.startDate) return { value: task.startDate, note: '继承任务统计开始' };
  if (spec.name === 'endDate' && task.endDate) return { value: task.endDate, note: '继承任务统计截止' };
  if (spec.default !== undefined) return { value: spec.default, note: '默认值' };
  return { value: raw };
}

function formatNodeParamValue(
  node: TaskGraphNode,
  spec: PresetSummary['params'][number],
  task: TaskDoc,
  refs?: TaskParamRefs,
): ReactNode {
  const { value } = effectiveParamValue(node, spec, task);
  if (isEmptyParamValue(value)) return '未配置';
  const id = refId(value);

  const option = spec.options?.find((o) => String(o.value) === String(value));
  if (option) return option.label;

  if (spec.type === 'date') return <DateTime value={String(value)} mode="date" />;
  if (spec.type === 'years') {
    const years = Array.isArray(value) ? value : String(value).split(/[\s,，]+/).filter(Boolean);
    return years.length ? years.join('、') : '未配置';
  }
  if (spec.type === 'contest') {
    const contest = refs?.contests?.find((c) => c._id === id);
    return contest
      ? <RefDisplay title={contest.title} meta={contest.beginAt ? <>开始 <DateTime value={contest.beginAt} mode="datetime" /></> : undefined} />
      : missingRefLabel(value);
  }
  if (spec.type === 'homework') {
    const homework = refs?.homeworks?.find((h) => h._id === id);
    return homework
      ? <RefDisplay title={homework.title} meta={homework.beginAt ? <>开始 <DateTime value={homework.beginAt} mode="datetime" /></> : undefined} />
      : missingRefLabel(value);
  }
  if (spec.type === 'training') {
    const training = refs?.trainings?.find((t) => t._id === id);
    return training ? training.title : missingRefLabel(value);
  }
  if (spec.type === 'problem') {
    const problem = refs?.problems?.find((p) => String(p.docId) === id || String(p.pid || '') === id);
    if (!problem) return missingRefLabel(value);
    const prefix = problem.pid || problem.docId;
    return <RefDisplay title={`${prefix} · ${problem.title}`} />;
  }
  if (spec.type === 'school' || (node.presetId === 'group_membership' && spec.name === 'targetId' && node.params?.scope === 'school')) {
    const school = refs?.schools?.find((s) => s._id === id);
    return school ? school.name : missingRefLabel(value);
  }
  if (spec.type === 'user_group') {
    const group = refs?.userGroups?.find((g) => g._id === id);
    if (!group) return missingRefLabel(value);
    const school = refs?.schools?.find((s) => s._id === group.schoolId);
    return <RefDisplay title={school ? `${school.name} / ${group.name}` : group.name} />;
  }
  return String(value);
}

function NodeParamSummary({
  node, preset, task, refs,
}: {
  node: TaskGraphNode;
  preset: PresetSummary;
  task: TaskDoc;
  refs?: TaskParamRefs;
}) {
  if (!preset.params.length) return null;
  return (
    <div className="border-t pt-3">
      <div className="mb-2 text-[11px] font-medium text-muted-foreground">任务点配置</div>
      <dl className="space-y-2">
        {preset.params.map((spec) => {
          const { note } = effectiveParamValue(node, spec, task);
          return (
            <div key={spec.name} className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 text-xs">
              <dt className="text-muted-foreground">{spec.label}</dt>
              <dd className="min-w-0 text-right font-medium">
                {formatNodeParamValue(node, spec, task, refs)}
                {note && <span className="ml-1 whitespace-nowrap text-[10px] font-normal text-muted-foreground">({note})</span>}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

// ─── Task Center ──────────────────────────────────────────────────────────

export function TaskCenterPage() {
  const data = useBootstrap().page.data as {
    tasks: TaskDoc[];
    assignmentMap: Record<string, AssignmentSummary>;
    canManage: boolean;
  };
  const tasks = data.tasks || [];
  const now = useLiveNow(tasks.length > 0);
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) for (const tag of t.tags || []) set.add(tag);
    return Array.from(set).sort();
  }, [tasks]);

  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (!showInactive && !t.isActive) return false;
      if (activeTag && !t.tags?.includes(activeTag)) return false;
      if (q && !t.title.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => {
      const aStatus = (data.assignmentMap[a._id]?.status as AssignmentStatus | undefined) || 'not-claimed';
      const bStatus = (data.assignmentMap[b._id]?.status as AssignmentStatus | undefined) || 'not-claimed';
      const rankDiff = taskCenterRank(a, aStatus) - taskCenterRank(b, bStatus);
      if (rankDiff !== 0) return rankDiff;
      return a.title.localeCompare(b.title, 'zh-Hans-CN');
    });
  }, [tasks, query, activeTag, showInactive, data.assignmentMap]);

  return (
    <div className="space-y-6">
      <motion.header
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="flex items-center justify-between rounded-xl border bg-card p-6 shadow-sm"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ClipboardList className="size-5 text-primary" />
            <h1 className="text-xl font-semibold">任务中心</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            完成任务获得比赛资格 — 任务点会根据你的 OJ 记录自动判定。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm"><a href="/tasks/my"><ListChecks className="mr-1 size-4" />我的任务</a></Button>
          {data.canManage && (
            <Button asChild variant="default" size="sm"><a href="/admin/tasks"><Trophy className="mr-1 size-4" />管理任务</a></Button>
          )}
        </div>
      </motion.header>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Input
            placeholder="搜索任务标题或描述…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-sm"
          />
          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag className="size-3.5 text-muted-foreground" />
              <button
                onClick={() => setActiveTag(null)}
                className={cn('rounded-md px-2 py-0.5 text-xs', activeTag === null ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80')}
              >全部</button>
              {allTags.map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveTag(t === activeTag ? null : t)}
                  className={cn('rounded-md px-2 py-0.5 text-xs', activeTag === t ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80')}
                >{t}</button>
              ))}
            </div>
          )}
          {data.canManage && (
            <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)}  />
              显示已停用
            </label>
          )}
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ClipboardList className="mx-auto size-12 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              {tasks.length === 0 ? '当前没有可用的任务' : '没有匹配的任务'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((task) => {
            const a = data.assignmentMap[task._id];
            const status = ((a?.status as AssignmentStatus | undefined) || 'not-claimed') as AssignmentStatus | 'not-claimed';
            const claimState = claimStateFor(task, status !== 'not-claimed');
            return (
              <Card key={task._id} className={cn('transition-shadow hover:shadow-md', !task.isActive && 'opacity-60')}>
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-2 font-semibold">{task.title}</h3>
                    <StatusPill status={status} />
                  </div>
                  {task.description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <Network className="size-3" />{(task.graph?.nodes || []).filter((n) => n.type === 'task').length} 个节点
                    </Badge>
                    {task.admissionMode === 'quota' && (
                      <Badge variant="outline" className="gap-1 text-[10px]"><UserCheck className="size-3" />配额</Badge>
                    )}
                    <AccessPill access={task.access} />
                    {status === 'not-claimed' && claimState.badge}
                    {task.tags?.slice(0, 2).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                    ))}
                  </div>
                  <TaskTimeBlock
                    task={task}
                    status={status}
                    assignedAt={a?.assignedAt || null}
                    now={now}
                    compact
                  />
                  <Button asChild className="w-full" variant={status === 'completed' ? 'outline' : 'default'} size="sm">
                    <a href={`/tasks/${task._id}`}>
                      {status === 'not-claimed' ? '查看详情' : '查看进度'}
                      <ChevronRight className="size-4" />
                    </a>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── My Tasks ────────────────────────────────────────────────────────────

export function TaskMyPage() {
  const data = useBootstrap().page.data as {
    assignments: TaskAssignment[];
    tasks: Record<string, TaskDoc>;
    canManage: boolean;
  };
  const assignments = data.assignments || [];
  const now = useLiveNow(assignments.length > 0);

  const [filter, setFilter] = useState<'all' | 'pending' | 'completed' | 'cancelled'>('all');
  const filtered = assignments.filter((a) => filter === 'all' || a.status === filter);

  const counts = {
    all: assignments.length,
    pending: assignments.filter((a) => a.status === 'pending').length,
    completed: assignments.filter((a) => a.status === 'completed').length,
    cancelled: assignments.filter((a) => a.status === 'cancelled').length,
  };

  return (
    <div className="space-y-6">
      <motion.header
        initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between rounded-xl border bg-card p-6 shadow-sm"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ListChecks className="size-5 text-primary" />
            <h1 className="text-xl font-semibold">我的任务</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            已认领或分配给你的任务。进度会在你提交代码 / 完成 exam / 加入用户组时自动更新。
          </p>
        </div>
        <Button asChild variant="outline" size="sm"><a href="/tasks"><ClipboardList className="mr-1 size-4" />任务中心</a></Button>
      </motion.header>

      <MiniTabs
        value={filter}
        onValueChange={setFilter}
        items={[
          { value: 'all', label: '全部', count: counts.all },
          { value: 'pending', label: '进行中', count: counts.pending },
          { value: 'completed', label: '已完成', count: counts.completed },
          { value: 'cancelled', label: '已取消', count: counts.cancelled },
        ]}
      />

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Hourglass className="mx-auto size-12 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              {assignments.length === 0 ? '还没有认领任何任务' : '没有匹配的任务'}
            </p>
            <Button asChild variant="outline" size="sm" className="mt-4"><a href="/tasks">浏览任务</a></Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => {
            const task = data.tasks[a.taskId];
            if (!task) return null;
            const taskNodes = (task.graph?.nodes || []).filter((n) => n.type === 'task');
            const completedPoints = taskNodes.filter((n) => a.progress?.[n.id]?.completed).length;
            const totalPoints = taskNodes.length;
            const pct = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;
            return (
              <Card key={a._id} className="transition-shadow hover:shadow-md">
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <a href={`/tasks/${task._id}`} className="font-semibold hover:underline">{task.title}</a>
                    <div className="flex items-center gap-1.5">
                      <StatusPill status={a.status} />
                      {!a.canCancel && (
                        <Badge variant="outline" className="gap-1 text-[10px]"><Lock className="size-3" />管理员分配</Badge>
                      )}
                    </div>
                  </div>
                  {a.note && (
                    <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                      📝 {a.note}
                    </p>
                  )}
                  <div className="flex items-center gap-3">
                    <ProgressBar result={{ current: completedPoints, target: totalPoints, completed: a.status === 'completed' }} />
                    <span className="whitespace-nowrap text-xs text-muted-foreground">{completedPoints}/{totalPoints} · {pct}%</span>
                  </div>
                  <TaskTimeBlock
                    task={task}
                    status={a.status}
                    assignedAt={a.assignedAt}
                    now={now}
                  />
                  {a.completedAt && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CheckCircle2 className="size-3" />
                      <span>完成于 <DateTime value={a.completedAt} mode="datetime" /></span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button asChild size="sm" variant="outline" className="flex-1">
                      <a href={`/tasks/${task._id}`}>查看进度<ChevronRight className="size-4" /></a>
                    </Button>
                    {a.status === 'pending' && (
                      <form method="post" action={`/tasks/assignments/${a._id}`}>
                        <input type="hidden" name="operation" value="recheck" />
                        <Button type="submit" size="sm" variant="ghost" title="立即重算进度"><RefreshCw className="size-4" /></Button>
                      </form>
                    )}
                    {a.status === 'pending' && a.canCancel && (
                      <form method="post" action={`/tasks/assignments/${a._id}`}>
                        <input type="hidden" name="operation" value="cancel" />
                        <Button type="submit" size="sm" variant="ghost" className="text-destructive">取消</Button>
                      </form>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Task Detail ──────────────────────────────────────────────────────────

export function TaskDetailPage() {
  const data = useBootstrap().page.data as {
    task: TaskDoc;
    assignment: TaskAssignment | null;
    progress: Record<string, TaskPointResult>;
    creatorName: string;
    assignmentCount: number;
    presets: PresetSummary[];
    canManage: boolean;
    paramRefs?: TaskParamRefs;
  };
  const { task, assignment, progress, presets } = data;
  const presetMap = useMemo(() => Object.fromEntries(presets.map((p) => [p.id, p])), [presets]);

  const taskNodes = (task.graph?.nodes || []).filter((n) => n.type === 'task');
  const completedNodes = taskNodes.filter((n) => progress?.[n.id]?.completed).length;
  const totalNodes = taskNodes.length;
  const overallPct = totalNodes > 0 ? Math.round((completedNodes / totalNodes) * 100) : 0;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const selectedNode = selectedNodeId ? taskNodes.find((n) => n.id === selectedNodeId) : null;
  const selectedResult = selectedNode ? progress?.[selectedNode.id] : null;
  const selectedPreset = selectedNode?.presetId ? presetMap[selectedNode.presetId] : null;
  const claimState = claimStateFor(task, !!assignment);
  const now = Date.now();
  const statsStart = timeMs(task.startDate);
  const statsEnd = timeMs(task.endDate);
  const beforeStatsWindow = !!assignment && statsStart !== null && now < statsStart;
  const afterStatsWindow = !!assignment && statsEnd !== null && now > statsEnd;

  return (
    <div className="space-y-6">
      <motion.header
        initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border bg-card p-6 shadow-sm"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{task.title}</h1>
              {!task.isActive && <Badge variant="outline">已停用</Badge>}
              {task.admissionMode === 'quota' && <Badge variant="outline" className="gap-1"><UserCheck className="size-3" />配额制</Badge>}
              <StatusPill status={(assignment?.status as AssignmentStatus | undefined) || 'not-claimed'} />
              {!assignment && claimState.badge}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>创建者 {data.creatorName}</span>
              <span>· {data.assignmentCount} 人认领</span>
              <span>
                · 统计 {task.startDate ? <DateTime value={task.startDate} mode="datetime" /> : '不限开始'}
                {' - '}
                {task.endDate ? <DateTime value={task.endDate} mode="datetime" /> : '不限截止'}
              </span>
              {!assignment && <span>· {claimState.detail}</span>}
              {task.maxAssignments && <span>· 名额 {task.currentAssignments}/{task.maxAssignments}</span>}
              {task.admissionMode === 'quota' && task.quota != null && (
                <span>· 录取名额 {task.quota}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data.canManage && (
              <>
                <Button asChild variant="outline" size="sm"><a href={`/admin/tasks/${task._id}/edit`}>编辑</a></Button>
                <Button asChild variant="outline" size="sm"><a href={`/admin/tasks/${task._id}/stats`}>统计</a></Button>
              </>
            )}
            {!assignment && claimState.canClaim && (
              <form method="post" action={`/tasks/${task._id}`}>
                <input type="hidden" name="operation" value="claim" />
                <Button type="submit" size="sm">认领任务<ChevronRight className="size-4" /></Button>
              </form>
            )}
            {!assignment && !claimState.canClaim && (
              <Button type="button" size="sm" disabled>{claimState.buttonText}</Button>
            )}
            {assignment?.status === 'pending' && (
              <form method="post" action={`/tasks/assignments/${assignment._id}`}>
                <input type="hidden" name="operation" value="recheck" />
                <Button type="submit" variant="outline" size="sm"><RefreshCw className="mr-1 size-4" />立即检查</Button>
              </form>
            )}
          </div>
        </div>
        {!assignment && !claimState.canClaim && (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {claimState.detail}
          </p>
        )}
      </motion.header>

      {assignment && (
        <Card>
          <CardContent>
            <div className="flex items-center gap-3">
              <ProgressBar result={{ current: completedNodes, target: totalNodes, completed: assignment.status === 'completed' }} />
              <span className="whitespace-nowrap text-sm font-medium">{completedNodes}/{totalNodes} · {overallPct}%</span>
            </div>
            {assignment.note && (
              <p className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">📝 {assignment.note}</p>
            )}
            {beforeStatsWindow && (
              <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                统计窗口尚未开始，将从 <DateTime value={task.startDate!} mode="datetime" /> 起计算；现在仍可手动检查。
              </p>
            )}
            {afterStatsWindow && (
              <p className="mt-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
                统计窗口已截止在 <DateTime value={task.endDate!} mode="datetime" />；仍可重算进度，结果会按截止窗口计算。
              </p>
            )}
            {assignment.status === 'qualified' && (
              <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                ✓ 已达到所有任务点要求，进入候选池等待管理员录取。
              </p>
            )}
            {assignment.status === 'admitted' && (
              <p className="mt-3 rounded-md border border-violet-300 bg-violet-50 px-3 py-2 text-xs text-violet-800 dark:bg-violet-950/40 dark:text-violet-200">
                ✓ 已被管理员录取，等待最终确认即可生效。
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <h2 className="text-sm font-semibold">任务流程图</h2>
          <Card>
            <CardContent className="p-0">
              <TaskGraphRenderer
                graph={task.graph}
                presets={presets}
                progress={progress || {}}
                selectedNodeId={selectedNodeId}
                onNodeSelect={setSelectedNodeId}
                height="60vh"
              />
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            点击任意节点查看具体进度。绿色路径 = 已点亮的任务点，存在一条从「开始」到「完成」的全亮路径即任务完成。
          </p>
        </div>

        <aside className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="text-sm">
              {selectedNode ? selectedNode.name || selectedPreset?.name || '节点详情' : '节点详情'}
            </CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {selectedNode ? (
                <>
                  {selectedPreset && (
                    <p className="text-xs text-muted-foreground">{selectedPreset.description}</p>
                  )}
                  {selectedPreset && (
                    <NodeParamSummary
                      node={selectedNode}
                      preset={selectedPreset}
                      task={task}
                      refs={data.paramRefs}
                    />
                  )}
                  {selectedResult ? (
                    <>
                      <div className="flex items-center gap-2">
                        {selectedResult.completed
                          ? <Badge className="gap-1 bg-emerald-500 text-white hover:bg-emerald-500/90"><CheckCircle2 className="size-3" />已完成</Badge>
                          : <Badge variant="outline">未完成</Badge>}
                        {selectedResult.overridden && <Badge variant="outline" className="text-[10px]">人工判定</Badge>}
                      </div>
                      <ProgressBar result={selectedResult} />
                      <p className="text-xs text-muted-foreground">{selectedResult.details || `${selectedResult.current} / ${selectedResult.target}`}</p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">尚未评估，认领后会自动检查</p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">点击流程图上的节点查看详情</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">任务信息</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row icon={Calendar} label="统计开始" value={task.startDate ? <DateTime value={task.startDate} mode="datetime" /> : '不限'} />
              <Row icon={Calendar} label="统计截止" value={task.endDate ? <DateTime value={task.endDate} mode="datetime" /> : '不限'} />
              <Row icon={Clock} label="认领开始" value={task.claimStartAt ? <DateTime value={task.claimStartAt} mode="datetime" /> : '不限'} />
              <Row icon={Clock} label="认领截止" value={task.claimEndAt ? <DateTime value={task.claimEndAt} mode="datetime" /> : '不限'} />
              <Row icon={Trophy} label="完成模式" value={task.admissionMode === 'quota' ? '配额制（候选池）' : '自动'} />
              <Row icon={Lock} label="可见范围" value={
                task.access.type === 'public' ? '所有人'
                  : task.access.type === 'school' ? '限定学校'
                  : task.access.type === 'user_group' ? '限定用户组'
                  : task.access.type === 'grade' ? `限 ${task.access.years?.join('/') || ''} 级`
                  : '限定可见'
              } />
              {task.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {task.tags.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                </div>
              )}
            </CardContent>
          </Card>

          {task.description && (
            <Card>
              <CardHeader><CardTitle className="text-sm">描述</CardTitle></CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{task.description}</p>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: any; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-muted-foreground"><Icon className="size-3.5" />{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
