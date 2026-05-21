/**
 * /tasks (user-facing) — task center + my tasks + task detail.
 *
 * Bootstrap shape comes from packages/krypton-tasks/src/handler.ts.
 * Pages register in PAGE_MAP (see ../resolver.tsx) via:
 *   - tasks_center.html      → TaskCenterPage
 *   - tasks_my.html          → TaskMyPage
 *   - tasks_detail.html      → TaskDetailPage
 */
import { type ReactNode, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Calendar, CheckCircle2, ChevronRight, Clock, ClipboardList, Flag, Hourglass,
  Loader2, ListChecks, Lock, RefreshCw, Tag, Trophy, XCircle,
} from 'lucide-react';
import { daysUntil, isToday } from '@hydrooj/common';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateTime } from '@/components/ui/datetime';
import { MiniTabs } from '@/components/ui/mini-tabs';

// ─── Shared types ─────────────────────────────────────────────────────────

interface TaskPoint {
  id: string;
  presetId: string;
  name: string;
  params: Record<string, any>;
}

interface TaskAccess {
  type: 'public' | 'user_group' | 'school';
  targetId?: string;
}

interface TaskCondition {
  type: 'all' | 'groups';
  groups?: { points: string[]; require: number }[];
}

interface TaskDoc {
  _id: string;
  domainId: string;
  title: string;
  description: string;
  tags: string[];
  points: TaskPoint[];
  condition: TaskCondition;
  access: TaskAccess;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  maxAssignments: number | null;
  currentAssignments: number;
  createdAt: string;
  createdBy: number;
}

interface TaskPointResult {
  completed: boolean;
  current: number;
  target: number;
  details?: string;
  overridden?: boolean;
}

interface TaskAssignment {
  _id: string;
  taskId: string;
  userId: number;
  assignedBy: number;
  assignedAt: string;
  canCancel: boolean;
  status: 'pending' | 'completed' | 'cancelled';
  completedAt: string | null;
  progress: Record<string, TaskPointResult>;
  progressUpdatedAt: string | null;
  note: string;
}

interface PresetSummary {
  id: string;
  name: string;
  description: string;
  params: Array<{ name: string; label: string; type: string; required?: boolean; default?: any; options?: { value: string; label: string }[]; helper?: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function deadlineLabel(task: TaskDoc): string | null {
  if (!task.endDate) return null;
  if (isToday(task.endDate)) return '今日截止';
  const days = daysUntil(task.endDate);
  if (days < 0) return '已过期';
  if (days <= 7) return `${days} 天后截止`;
  return null;
}

function StatusPill({ status }: { status: 'pending' | 'completed' | 'cancelled' | 'not-claimed' }) {
  if (status === 'completed') {
    return <Badge variant="default" className="gap-1 bg-emerald-500 text-white hover:bg-emerald-500/90"><CheckCircle2 className="size-3" />已完成</Badge>;
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
  return (
    <Badge variant="outline" className="gap-1 text-[10px]">
      <Lock className="size-3" />
      {access.type === 'school' ? '限定学校' : '限定用户组'}
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

// ─── Task Center ──────────────────────────────────────────────────────────

export function TaskCenterPage() {
  const data = useBootstrap().page.data as {
    tasks: TaskDoc[];
    assignmentMap: Record<string, { _id: string; status: string; canCancel: boolean }>;
    canManage: boolean;
  };
  const tasks = data.tasks || [];
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
    });
  }, [tasks, query, activeTag, showInactive]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
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
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
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
            const status = (a?.status as any) || 'not-claimed';
            const deadline = deadlineLabel(task);
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
                      <Flag className="size-3" />{task.points.length} 个任务点
                    </Badge>
                    {task.condition.type === 'groups' && (
                      <Badge variant="outline" className="text-[10px]">分组条件</Badge>
                    )}
                    <AccessPill access={task.access} />
                    {task.tags?.slice(0, 2).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="size-3" />
                    {task.endDate ? (
                      <>截止 <DateTime value={task.endDate} mode="date" /></>
                    ) : '不限时间'}
                    {deadline && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">{deadline}</span>}
                  </div>
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

  const [filter, setFilter] = useState<'all' | 'pending' | 'completed' | 'cancelled'>('all');
  const filtered = assignments.filter((a) => filter === 'all' || a.status === filter);

  const counts = {
    all: assignments.length,
    pending: assignments.filter((a) => a.status === 'pending').length,
    completed: assignments.filter((a) => a.status === 'completed').length,
    cancelled: assignments.filter((a) => a.status === 'cancelled').length,
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
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
            const completedPoints = task.points.filter((p) => a.progress?.[p.id]?.completed).length;
            const totalPoints = task.points.length;
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
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>认领于 <DateTime value={a.assignedAt} /></span>
                    {a.completedAt && <span>· 完成于 <DateTime value={a.completedAt} /></span>}
                  </div>
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
  };
  const { task, assignment, progress, presets } = data;
  const presetMap = useMemo(() => Object.fromEntries(presets.map((p) => [p.id, p])), [presets]);

  const completedPoints = task.points.filter((p) => progress?.[p.id]?.completed).length;
  const totalPoints = task.points.length;
  const overallPct = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <motion.header
        initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border bg-card p-6 shadow-sm"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{task.title}</h1>
              {!task.isActive && <Badge variant="outline">已停用</Badge>}
              <StatusPill status={(assignment?.status as any) || 'not-claimed'} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>创建者 {data.creatorName}</span>
              <span>· {data.assignmentCount} 人认领</span>
              {task.endDate && <span>· 截止 <DateTime value={task.endDate} mode="date" /></span>}
              {task.maxAssignments && <span>· 名额 {task.currentAssignments}/{task.maxAssignments}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data.canManage && (
              <>
                <Button asChild variant="outline" size="sm"><a href={`/admin/tasks/${task._id}/edit`}>编辑</a></Button>
                <Button asChild variant="outline" size="sm"><a href={`/admin/tasks/${task._id}/stats`}>统计</a></Button>
              </>
            )}
            {!assignment && task.isActive && (
              <form method="post" action={`/tasks/${task._id}`}>
                <input type="hidden" name="operation" value="claim" />
                <Button type="submit" size="sm">认领任务<ChevronRight className="size-4" /></Button>
              </form>
            )}
            {assignment?.status === 'pending' && (
              <form method="post" action={`/tasks/assignments/${assignment._id}`}>
                <input type="hidden" name="operation" value="recheck" />
                <Button type="submit" variant="outline" size="sm"><RefreshCw className="mr-1 size-4" />立即检查</Button>
              </form>
            )}
          </div>
        </div>
      </motion.header>

      {assignment && (
        <Card>
          <CardContent>
            <div className="flex items-center gap-3">
              <ProgressBar result={{ current: completedPoints, target: totalPoints, completed: assignment.status === 'completed' }} />
              <span className="whitespace-nowrap text-sm font-medium">{completedPoints}/{totalPoints} · {overallPct}%</span>
            </div>
            {assignment.note && (
              <p className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">📝 {assignment.note}</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <h2 className="text-sm font-semibold">任务点 ({task.points.length})</h2>
          {task.points.map((point) => {
            const preset = presetMap[point.presetId];
            const r = progress?.[point.id];
            return (
              <Card key={point.id} className={cn(
                'border-l-4',
                r?.completed ? 'border-l-emerald-500' : r?.current > 0 ? 'border-l-sky-500' : 'border-l-muted',
              )}>
                <CardContent className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-medium">{point.name}</h3>
                      {preset && <p className="text-xs text-muted-foreground">{preset.description}</p>}
                    </div>
                    {r ? (
                      r.completed ? (
                        <Badge className="gap-1 bg-emerald-500 text-white hover:bg-emerald-500/90">
                          {r.overridden ? '管理员判定' : '完成'} <CheckCircle2 className="size-3" />
                        </Badge>
                      ) : <Badge variant="outline">未完成</Badge>
                    ) : <Badge variant="outline">待检查</Badge>}
                  </div>
                  {r && (
                    <div className="space-y-1.5">
                      <ProgressBar result={r} />
                      <p className="text-xs text-muted-foreground">{r.details || `${r.current} / ${r.target}`}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <aside className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="text-sm">任务信息</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row icon={Calendar} label="开始" value={task.startDate ? <DateTime value={task.startDate} mode="date" /> : '不限'} />
              <Row icon={Calendar} label="截止" value={task.endDate ? <DateTime value={task.endDate} mode="date" /> : '不限'} />
              <Row icon={Trophy} label="完成条件" value={task.condition.type === 'all' ? '满足全部任务点' : '满足分组条件'} />
              <Row icon={Lock} label="可见范围" value={
                task.access.type === 'public' ? '所有人' : task.access.type === 'school' ? '限定学校' : '限定用户组'
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

          {task.condition.type === 'groups' && (
            <Card>
              <CardHeader><CardTitle className="text-sm">分组条件</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {task.condition.groups?.map((g, i) => {
                  const done = g.points.filter((pid) => progress?.[pid]?.completed).length;
                  const ok = done >= g.require;
                  return (
                    <div key={i} className="rounded-md border p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">分组 {i + 1}</span>
                        <Badge variant={ok ? 'default' : 'outline'} className={cn('text-[10px]', ok && 'bg-emerald-500 text-white')}>
                          {done}/{g.require}
                        </Badge>
                      </div>
                      <p className="mt-1 text-muted-foreground">至少完成 {g.require} 个任务点（共 {g.points.length} 个）</p>
                    </div>
                  );
                })}
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
