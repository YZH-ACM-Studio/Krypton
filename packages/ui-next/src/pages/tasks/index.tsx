/**
 * /tasks (user-facing) — task center + my tasks + task detail.
 *
 * Bootstrap shape comes from packages/krypton-tasks/src/handler.ts.
 * Pages register in PAGE_MAP (see ../resolver.tsx) via:
 *   - tasks_center.html      → TaskCenterPage
 *   - tasks_my.html          → TaskMyPage
 *   - tasks_detail.html      → TaskDetailPage
 */
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  ClipboardList,
  Hourglass,
  ListChecks,
  Lock,
  type LucideIcon,
  Network,
  RefreshCw,
  Tag,
  Trophy,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { DateTime } from '@/components/ui/datetime';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { Progress, Spinner } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { Page, PageHeader, Toolbar } from '@/components/ui/page';
import { PageTabs } from '@/components/ui/page-tabs';
import { Panel } from '@/components/ui/panel';
import { TaskGraphRenderer, type PresetSummary, type TaskGraph, type TaskGraphNode, type TaskPointResult } from '@/components/task-graph';

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

function claimStateFor(
  task: TaskDoc,
  claimed: boolean,
  now = Date.now(),
): {
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
      badge: (
        <Badge variant="outline" tone="info" size="sm">
          <Clock className="size-3" />
          即将开放
        </Badge>
      ),
      buttonText: '未到认领时间',
      detail: (
        <>
          认领开始 <DateTime value={task.claimStartAt!} mode="datetime" />
        </>
      ),
    };
  }
  if (end !== null && now > end) {
    return {
      kind: 'closed',
      canClaim: false,
      badge: (
        <Badge variant="outline" tone="warning" size="sm">
          <Lock className="size-3" />
          已截止
        </Badge>
      ),
      buttonText: '认领已截止',
      detail: (
        <>
          认领截止 <DateTime value={task.claimEndAt!} mode="datetime" />
        </>
      ),
    };
  }
  return {
    kind: 'open',
    canClaim: true,
    badge: (
      <Badge variant="outline" tone="success" size="sm">
        <UserCheck className="size-3" />
        可认领
      </Badge>
    ),
    buttonText: '认领任务',
    detail: task.claimEndAt ? (
      <>
        认领截止 <DateTime value={task.claimEndAt} mode="datetime" />
      </>
    ) : (
      '认领不限时间'
    ),
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
  task,
  status,
  assignedAt,
  now,
  compact = false,
}: {
  task: TaskDoc;
  status: AssignmentStatus | 'not-claimed';
  assignedAt?: string | null;
  now: number;
  compact?: boolean;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5 rounded-md border border-line bg-surface-sunken p-2.5 text-xs', compact && 'p-2')}>
      <TimeRow
        icon={Clock}
        label="认领"
        value={
          <>
            {task.claimStartAt ? <DateTime value={task.claimStartAt} mode="datetime" /> : '不限开始'}
            {' - '}
            {task.claimEndAt ? <DateTime value={task.claimEndAt} mode="datetime" /> : '不限截止'}
          </>
        }
      />
      {assignedAt && <TimeRow icon={UserCheck} label="已认领" value={<DateTime value={assignedAt} mode="datetime" />} />}
      <TimeRow
        icon={Calendar}
        label="统计"
        value={
          <>
            {task.startDate ? <DateTime value={task.startDate} mode="datetime" /> : '不限开始'}
            {' - '}
            {task.endDate ? <DateTime value={task.endDate} mode="datetime" /> : '不限截止'}
          </>
        }
      />
      <TaskCountdownNotice task={task} status={status} now={now} />
    </div>
  );
}

function TimeRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-1.5 text-fg-subtle">
      <Icon className="mt-0.5 size-3 shrink-0" />
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 flex-1 break-words">{value}</span>
    </div>
  );
}

function TaskCountdownNotice({ task, status, now }: { task: TaskDoc; status: AssignmentStatus | 'not-claimed'; now: number }) {
  const notice = countdownNoticeFor(task, status, now);
  if (!notice) return null;
  const toneClass = {
    info: 'border-info-line bg-info-soft text-info-fg',
    warning: 'border-warning-line bg-warning-soft text-warning-fg',
    danger: 'border-danger-line bg-danger-soft text-danger-fg',
    muted: 'border-line bg-surface-sunken text-fg-subtle',
  }[notice.tone];
  return (
    <div className={cn('mt-2 flex items-center gap-1.5 rounded-md border px-2 py-1 text-2xs font-medium', toneClass)}>
      {notice.tone === 'danger' || notice.tone === 'warning' ? (
        <AlertTriangle className="size-3.5 shrink-0" />
      ) : (
        <Clock className="size-3.5 shrink-0" />
      )}
      <span>{notice.label}</span>
      {notice.target && <span className="ml-auto font-mono tabular">{formatCountdown(notice.target - now)}</span>}
    </div>
  );
}

function AssignmentBadge({ status }: { status: AssignmentStatus | 'not-claimed' }) {
  if (status === 'completed') {
    return (
      <Badge tone="success">
        <CheckCircle2 className="size-3" />
        已完成
      </Badge>
    );
  }
  if (status === 'admitted') {
    return (
      <Badge tone="info">
        <UserCheck className="size-3" />
        已录取
      </Badge>
    );
  }
  if (status === 'qualified') {
    return (
      <Badge tone="warning">
        <Trophy className="size-3" />
        候选中
      </Badge>
    );
  }
  if (status === 'pending') {
    return (
      <Badge tone="info">
        <Spinner className="size-3" />
        进行中
      </Badge>
    );
  }
  if (status === 'cancelled') {
    return (
      <Badge tone="neutral" variant="outline">
        <XCircle className="size-3" />
        已取消
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" variant="outline">
      <Hourglass className="size-3" />
      未认领
    </Badge>
  );
}

function AccessPill({ access }: { access: TaskAccess }) {
  if (access.type === 'public') return null;
  const label =
    access.type === 'school' ? '限定学校' : access.type === 'user_group' ? '限定用户组' : access.type === 'grade' ? '限定年级' : '限定可见';
  return (
    <Badge variant="outline" tone="neutral" size="sm">
      <Lock className="size-3" />
      {label}
    </Badge>
  );
}

function ProgressBar({ result }: { result: TaskPointResult }) {
  const pct = result.target > 0 ? Math.min(100, Math.round((result.current / result.target) * 100)) : result.completed ? 100 : 0;
  return <Progress value={pct} tone={result.completed ? 'success' : 'brand'} />;
}

function isEmptyParamValue(value: unknown): boolean {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

function refId(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object' && typeof (value as { toHexString?: unknown }).toHexString === 'function') {
    return (value as { toHexString: () => string }).toHexString();
  }
  return String(value);
}

function RefDisplay({ title, meta }: { title: ReactNode; meta?: ReactNode }) {
  return (
    <span className="inline-flex max-w-full flex-col items-end text-right">
      <span className="max-w-full truncate">{title}</span>
      {meta && <span className="text-2xs font-normal text-fg-subtle">{meta}</span>}
    </span>
  );
}

function missingRefLabel(value: unknown): ReactNode {
  const id = refId(value);
  if (!id) return '未配置';
  return <span className="break-all text-fg-subtle">未找到：{id}</span>;
}

function effectiveParamValue(
  node: TaskGraphNode,
  spec: PresetSummary['params'][number],
  task: TaskDoc,
): {
  value: unknown;
  note?: string;
} {
  const raw = node.params?.[spec.name];
  if (!isEmptyParamValue(raw)) return { value: raw };
  if (spec.name === 'startDate' && task.startDate) return { value: task.startDate, note: '继承任务统计开始' };
  if (spec.name === 'endDate' && task.endDate) return { value: task.endDate, note: '继承任务统计截止' };
  if (spec.default !== undefined) return { value: spec.default, note: '默认值' };
  return { value: raw };
}

function formatNodeParamValue(node: TaskGraphNode, spec: PresetSummary['params'][number], task: TaskDoc, refs?: TaskParamRefs): ReactNode {
  const { value } = effectiveParamValue(node, spec, task);
  if (isEmptyParamValue(value)) return '未配置';
  const id = refId(value);

  const option = spec.options?.find((o) => String(o.value) === String(value));
  if (option) return option.group ? `${option.group} / ${option.label}` : option.label;

  if (spec.type === 'date') return <DateTime value={String(value)} mode="date" />;
  if (spec.type === 'years') {
    const years = Array.isArray(value)
      ? value
      : String(value)
          .split(/[\s,，]+/)
          .filter(Boolean);
    return years.length ? years.join('、') : '未配置';
  }
  if (spec.type === 'contest') {
    const contest = refs?.contests?.find((c) => c._id === id);
    return contest ? (
      <RefDisplay
        title={contest.title}
        meta={
          contest.beginAt ? (
            <>
              开始 <DateTime value={contest.beginAt} mode="datetime" />
            </>
          ) : undefined
        }
      />
    ) : (
      missingRefLabel(value)
    );
  }
  if (spec.type === 'homework') {
    const homework = refs?.homeworks?.find((h) => h._id === id);
    return homework ? (
      <RefDisplay
        title={homework.title}
        meta={
          homework.beginAt ? (
            <>
              开始 <DateTime value={homework.beginAt} mode="datetime" />
            </>
          ) : undefined
        }
      />
    ) : (
      missingRefLabel(value)
    );
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

function NodeParamSummary({ node, preset, task, refs }: { node: TaskGraphNode; preset: PresetSummary; task: TaskDoc; refs?: TaskParamRefs }) {
  if (!preset.params.length) return null;
  return (
    <div className="border-t border-line-subtle pt-3">
      <div className="mb-2 text-2xs font-medium text-fg-subtle">任务点配置</div>
      <dl className="flex flex-col gap-2">
        {preset.params.map((spec) => {
          const { note } = effectiveParamValue(node, spec, task);
          return (
            <div key={spec.name} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 text-xs">
              <dt className="text-fg-subtle">{spec.label}</dt>
              <dd className="min-w-0 text-right font-medium text-fg">
                {formatNodeParamValue(node, spec, task, refs)}
                {note && <span className="ml-1 whitespace-nowrap text-2xs font-normal text-fg-subtle">({note})</span>}
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
  const bs = useBootstrap();
  const data = bs.page.data as {
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
    return tasks
      .filter((t) => {
        if (!showInactive && !t.isActive) return false;
        if (activeTag && !t.tags?.includes(activeTag)) return false;
        if (q && !t.title.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const aStatus = (data.assignmentMap[a._id]?.status as AssignmentStatus | undefined) || 'not-claimed';
        const bStatus = (data.assignmentMap[b._id]?.status as AssignmentStatus | undefined) || 'not-claimed';
        const rankDiff = taskCenterRank(a, aStatus) - taskCenterRank(b, bStatus);
        if (rankDiff !== 0) return rankDiff;
        return a.title.localeCompare(b.title, 'zh-Hans-CN');
      });
  }, [tasks, query, activeTag, showInactive, data.assignmentMap]);

  return (
    <Page width="wide">
      <PageHeader
        title="任务中心"
        description="完成任务获得比赛资格 — 任务点会根据你的 OJ 记录自动判定。"
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <a href="/tasks/my">
                <ListChecks />
                我的任务
              </a>
            </Button>
            {bs.user.canManageTasks ? (
              <Button asChild variant="primary" size="sm">
                <a href="/admin/tasks">
                  <Trophy />
                  管理任务
                </a>
              </Button>
            ) : null}
          </>
        }
      />

      <Toolbar
        end={
          data.canManage ? (
            <Checkbox checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} label="显示已停用" />
          ) : undefined
        }
      >
        <SearchInput
          placeholder="搜索任务标题或描述…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full sm:w-72"
        />
        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Tag className="size-3.5 text-fg-subtle" />
            <Button type="button" size="sm" variant={activeTag === null ? 'soft' : 'ghost'} onClick={() => setActiveTag(null)}>
              全部
            </Button>
            {allTags.map((t) => (
              <Button
                key={t}
                type="button"
                size="sm"
                variant={activeTag === t ? 'soft' : 'ghost'}
                onClick={() => setActiveTag(t === activeTag ? null : t)}
              >
                {t}
              </Button>
            ))}
          </div>
        )}
      </Toolbar>

      {filtered.length === 0 ? (
        <EmptyState icon={<ClipboardList />} title={tasks.length === 0 ? '当前没有可用的任务' : '没有匹配的任务'} compact />
      ) : (
        <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((task) => {
            const a = data.assignmentMap[task._id];
            const status = ((a?.status as AssignmentStatus | undefined) || 'not-claimed') as AssignmentStatus | 'not-claimed';
            const claimState = claimStateFor(task, status !== 'not-claimed');
            return (
              <Card
                key={task._id}
                className="h-full transition-[box-shadow,opacity] w-full min-w-0 duration-(--dur-2) ease-(--ease-out) hover:border-line-strong hover:shadow-sm motion-reduce:transition-none"
              >
                <CardContent className="flex h-full flex-col gap-3">
                  <div className="flex min-h-10 min-w-0 items-start justify-between gap-2">
                    <h3 className="min-w-0 flex-1 break-words text-md font-semibold text-balance text-fg line-clamp-2">{task.title}</h3>
                    <div className="shrink-0">
                      <AssignmentBadge status={status} />
                    </div>
                  </div>
                  {task.description ? <p className="line-clamp-2 text-xs text-fg-subtle">{task.description}</p> : null}
                  <div className="flex flex-wrap gap-1.5">
                    {!task.isActive && (
                      <Badge variant="outline" tone="neutral" size="sm">
                        已停用
                      </Badge>
                    )}
                    <Badge variant="outline" tone="neutral" size="sm">
                      <Network className="size-3" />
                      {(task.graph?.nodes || []).filter((n) => n.type === 'task').length} 个节点
                    </Badge>
                    {task.admissionMode === 'quota' && (
                      <Badge variant="outline" tone="neutral" size="sm">
                        <UserCheck className="size-3" />
                        配额
                      </Badge>
                    )}
                    <AccessPill access={task.access} />
                    {status === 'not-claimed' && claimState.badge}
                    {task.tags?.slice(0, 2).map((tag) => (
                      <Badge key={tag} tone="neutral" size="sm">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <TaskTimeBlock task={task} status={status} assignedAt={a?.assignedAt || null} now={now} compact />
                  <div className="mt-auto pt-1">
                    <Button asChild className="w-full" variant="secondary" size="sm">
                      <a href={`/tasks/${task._id}`}>
                        {status === 'not-claimed' ? '查看详情' : '查看进度'}
                        <ChevronRight />
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}

// ─── My Tasks ────────────────────────────────────────────────────────────

export function TaskMyPage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    assignments: TaskAssignment[];
    tasks: Record<string, TaskDoc>;
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
    <Page width="wide">
      <PageHeader
        title="我的任务"
        description="已认领或分配给你的任务。进度会在你提交代码 / 完成 exam / 加入用户组时自动更新。"
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <a href="/tasks">
                <ClipboardList />
                任务中心
              </a>
            </Button>
            {bs.user.canManageTasks ? (
              <Button asChild variant="primary" size="sm">
                <a href="/admin/tasks">
                  <Trophy />
                  管理任务
                </a>
              </Button>
            ) : null}
          </>
        }
        tabs={
          <PageTabs
            aria-label="任务状态"
            value={filter}
            onValueChange={setFilter}
            items={[
              { value: 'all', label: '全部', count: counts.all },
              { value: 'pending', label: '进行中', count: counts.pending },
              { value: 'completed', label: '已完成', count: counts.completed },
              { value: 'cancelled', label: '已取消', count: counts.cancelled },
            ]}
          />
        }
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Hourglass />}
          title={assignments.length === 0 ? '还没有认领任何任务' : '没有匹配的任务'}
          action={
            <Button asChild variant="secondary" size="sm">
              <a href="/tasks">浏览任务</a>
            </Button>
          }
          compact
        />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((a) => {
            const task = data.tasks[a.taskId];
            if (!task) return null;
            const taskNodes = (task.graph?.nodes || []).filter((n) => n.type === 'task');
            const completedPoints = taskNodes.filter((n) => a.progress?.[n.id]?.completed).length;
            const totalPoints = taskNodes.length;
            const pct = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;
            return (
              <Panel key={a._id}>
                <div className="flex flex-col gap-3">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <a href={`/tasks/${task._id}`} className="min-w-0 flex-1 break-words text-sm font-semibold text-fg hover:underline">
                      {task.title}
                    </a>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <AssignmentBadge status={a.status} />
                      {!a.canCancel && (
                        <Badge variant="outline" tone="neutral" size="sm">
                          <Lock className="size-3" />
                          管理员分配
                        </Badge>
                      )}
                    </div>
                  </div>
                  {a.note && <p className="rounded-md bg-surface-sunken px-3 py-2 text-xs text-fg-subtle">📝 {a.note}</p>}
                  <div className="flex items-center gap-3">
                    <ProgressBar result={{ current: completedPoints, target: totalPoints, completed: a.status === 'completed' }} />
                    <span className="whitespace-nowrap text-xs text-fg-subtle tabular">
                      {completedPoints}/{totalPoints} · {pct}%
                    </span>
                  </div>
                  <TaskTimeBlock task={task} status={a.status} assignedAt={a.assignedAt} now={now} />
                  {a.completedAt && (
                    <div className="flex items-center gap-1.5 text-xs text-fg-subtle">
                      <CheckCircle2 className="size-3" />
                      <span>
                        完成于 <DateTime value={a.completedAt} mode="datetime" />
                      </span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Button asChild size="sm" variant="secondary" className="w-full">
                        <a href={`/tasks/${task._id}`}>
                          查看进度
                          <ChevronRight />
                        </a>
                      </Button>
                    </div>
                    {a.status === 'pending' && (
                      <form method="post" action={`/tasks/assignments/${a._id}`}>
                        <input type="hidden" name="operation" value="recheck" />
                        <Button type="submit" size="sm" variant="ghost" iconOnly title="立即重算进度" aria-label="立即重算进度">
                          <RefreshCw />
                        </Button>
                      </form>
                    )}
                    {a.status === 'pending' && a.canCancel && (
                      <form
                        method="post"
                        action={`/tasks/assignments/${a._id}`}
                        onSubmit={(event: FormEvent<HTMLFormElement>) => {
                          void confirmFormSubmit(event, '认领窗口关闭后将无法再次认领。', {
                            destructive: true,
                            title: `取消认领「${task.title}」？`,
                            confirmLabel: '取消认领',
                          });
                        }}
                      >
                        <input type="hidden" name="operation" value="cancel" />
                        <Button type="submit" size="sm" variant="danger-soft">
                          取消
                        </Button>
                      </form>
                    )}
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </Page>
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
    <Page width="wide">
      <PageHeader
        title={task.title}
        meta={
          <>
            {!task.isActive && (
              <Badge variant="outline" tone="neutral" size="sm">
                已停用
              </Badge>
            )}
            {task.admissionMode === 'quota' && (
              <Badge variant="outline" tone="neutral" size="sm">
                <UserCheck className="size-3" />
                配额制
              </Badge>
            )}
            <AssignmentBadge status={(assignment?.status as AssignmentStatus | undefined) || 'not-claimed'} />
            {!assignment && claimState.badge}
            <span>创建者 {data.creatorName}</span>
            <span>· {data.assignmentCount} 人认领</span>
            <span>
              · 统计 {task.startDate ? <DateTime value={task.startDate} mode="datetime" /> : '不限开始'}
              {' - '}
              {task.endDate ? <DateTime value={task.endDate} mode="datetime" /> : '不限截止'}
            </span>
            {!assignment && <span>· {claimState.detail}</span>}
            {task.maxAssignments && (
              <span>
                · 名额 {task.currentAssignments}/{task.maxAssignments}
              </span>
            )}
            {task.admissionMode === 'quota' && task.quota != null && <span>· 录取名额 {task.quota}</span>}
          </>
        }
        actions={
          <>
            {data.canManage && (
              <>
                <Button asChild variant="secondary" size="sm">
                  <a href={`/admin/tasks/${task._id}/edit`}>编辑</a>
                </Button>
                <Button asChild variant="secondary" size="sm">
                  <a href={`/admin/tasks/${task._id}/stats`}>统计</a>
                </Button>
              </>
            )}
            {!assignment && claimState.canClaim && (
              <form method="post" action={`/tasks/${task._id}`}>
                <input type="hidden" name="operation" value="claim" />
                <Button type="submit" size="sm" variant="primary">
                  认领任务
                  <ChevronRight />
                </Button>
              </form>
            )}
            {!assignment && !claimState.canClaim && (
              <Button type="button" size="sm" variant="secondary" disabled>
                {claimState.buttonText}
              </Button>
            )}
            {assignment?.status === 'pending' && (
              <form method="post" action={`/tasks/assignments/${assignment._id}`}>
                <input type="hidden" name="operation" value="recheck" />
                <Button type="submit" variant="primary" size="sm">
                  <RefreshCw />
                  立即检查
                </Button>
              </form>
            )}
          </>
        }
      />

      {!assignment && !claimState.canClaim && <Alert tone="warning">{claimState.detail}</Alert>}

      {assignment && (
        <Panel>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <ProgressBar result={{ current: completedNodes, target: totalNodes, completed: assignment.status === 'completed' }} />
              <span className="whitespace-nowrap text-sm font-medium tabular text-fg">
                {completedNodes}/{totalNodes} · {overallPct}%
              </span>
            </div>
            {assignment.note && <p className="rounded-md bg-surface-sunken px-3 py-2 text-xs text-fg-subtle">📝 {assignment.note}</p>}
            {beforeStatsWindow && (
              <Alert tone="warning">
                统计窗口尚未开始，将从 <DateTime value={task.startDate!} mode="datetime" /> 起计算；现在仍可手动检查。
              </Alert>
            )}
            {afterStatsWindow && (
              <Alert tone="neutral">
                统计窗口已截止在 <DateTime value={task.endDate!} mode="datetime" />
                ；仍可重算进度，结果会按截止窗口计算。
              </Alert>
            )}
            {assignment.status === 'qualified' && <Alert tone="warning">✓ 已达到所有任务点要求，进入候选池等待管理员录取。</Alert>}
            {assignment.status === 'admitted' && <Alert tone="info">✓ 已被管理员录取，等待最终确认即可生效。</Alert>}
          </div>
        </Panel>
      )}

      <div className="grid min-w-0 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-3 lg:col-span-2">
          <h2 className="min-w-0 break-words text-lg font-semibold text-fg">任务流程图</h2>
          <TaskGraphRenderer
            graph={task.graph}
            presets={presets}
            progress={progress || {}}
            selectedNodeId={selectedNodeId}
            onNodeSelect={setSelectedNodeId}
            height="60vh"
          />
          <p className="text-xs text-fg-subtle">
            点击任意节点查看具体进度。绿色路径 = 已点亮的任务点，存在一条从「开始」到「完成」的全亮路径即任务完成。
          </p>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <Panel title={selectedNode ? selectedNode.name || selectedPreset?.name || '节点详情' : '节点详情'}>
            <div className="flex flex-col gap-2 text-sm">
              {selectedNode ? (
                <>
                  {selectedPreset && <p className="text-xs text-fg-subtle">{selectedPreset.description}</p>}
                  {selectedPreset && <NodeParamSummary node={selectedNode} preset={selectedPreset} task={task} refs={data.paramRefs} />}
                  {selectedResult ? (
                    <>
                      <div className="flex items-center gap-2">
                        {selectedResult.completed ? (
                          <Badge tone="success">
                            <CheckCircle2 className="size-3" />
                            已完成
                          </Badge>
                        ) : (
                          <Badge tone="neutral" variant="outline">
                            未完成
                          </Badge>
                        )}
                        {selectedResult.overridden && (
                          <Badge variant="outline" tone="warning" size="sm">
                            人工判定
                          </Badge>
                        )}
                      </div>
                      <ProgressBar result={selectedResult} />
                      <p className="text-xs text-fg-subtle">{selectedResult.details || `${selectedResult.current} / ${selectedResult.target}`}</p>
                    </>
                  ) : (
                    <p className="text-xs text-fg-subtle">尚未评估，认领后会自动检查</p>
                  )}
                </>
              ) : (
                <p className="text-xs text-fg-subtle">点击流程图上的节点查看详情</p>
              )}
            </div>
          </Panel>

          <Panel title="任务信息">
            <div className="flex flex-col gap-2 text-sm">
              <Row icon={Calendar} label="统计开始" value={task.startDate ? <DateTime value={task.startDate} mode="datetime" /> : '不限'} />
              <Row icon={Calendar} label="统计截止" value={task.endDate ? <DateTime value={task.endDate} mode="datetime" /> : '不限'} />
              <Row icon={Clock} label="认领开始" value={task.claimStartAt ? <DateTime value={task.claimStartAt} mode="datetime" /> : '不限'} />
              <Row icon={Clock} label="认领截止" value={task.claimEndAt ? <DateTime value={task.claimEndAt} mode="datetime" /> : '不限'} />
              <Row icon={Trophy} label="完成模式" value={task.admissionMode === 'quota' ? '配额制（候选池）' : '自动'} />
              <Row
                icon={Lock}
                label="可见范围"
                value={
                  task.access.type === 'public'
                    ? '所有人'
                    : task.access.type === 'school'
                      ? '限定学校'
                      : task.access.type === 'user_group'
                        ? '限定用户组'
                        : task.access.type === 'grade'
                          ? `限 ${task.access.years?.join('/') || ''} 级`
                          : '限定可见'
                }
              />
              {task.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {task.tags.map((t) => (
                    <Badge key={t} tone="neutral" size="sm">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </Panel>

          {task.description && (
            <Panel title="描述">
              <p className="whitespace-pre-wrap text-sm text-fg-muted">{task.description}</p>
            </Panel>
          )}
        </aside>
      </div>
    </Page>
  );
}

function Row({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-2">
      <span className="flex shrink-0 items-center gap-1.5 text-fg-subtle">
        <Icon className="size-3.5" />
        {label}
      </span>
      <span className="min-w-0 break-words text-right font-medium text-fg">{value}</span>
    </div>
  );
}
