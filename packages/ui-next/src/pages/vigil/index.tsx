/**
 * krypton-vigil admin pages.
 *
 * Two surfaces:
 *   /admin/vigil                 → AdminVigilOverviewPage     (template:
 *     admin_vigil_overview.html). Stats + Active exam cards + Ended table.
 *   /admin/vigil/exams/:examId   → AdminVigilExamDetailPage   (template:
 *     admin_vigil_exam_detail.html). Per-exam detail with MiniTabs for
 *     概览 / 会话 / 审批 / 事件.
 *
 * Vigil is reached from the *main* sidebar (under 管理) — admin-nav-registry
 * registration was removed in the parallel sidebar refactor.
 *
 * Defensive design: when Vigil server is unreachable the pages render a
 * banner + skeleton instead of throwing.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity, AlertCircle, CheckCircle, ChevronDown, ChevronRight, ChevronUp,
  Inbox, Layers, RefreshCw, ServerOff, ShieldAlert, Users, XCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import { PRIV } from '@/lib/perms';
import { AdminPage } from '@/components/admin/admin-page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DateTime } from '@/components/ui/datetime';
import { useBootstrap } from '@/lib/bootstrap';
import {
  approveRequest, fetchApprovals, fetchClients, fetchEvents, fetchExamSessions,
  rejectRequest, VigilOfflineError, type VigilApproval, type VigilClient,
  type VigilEvent, type VigilExamSession,
} from '@/lib/vigil-api';
import { useVigilSocket } from '@/hooks/use-vigil-socket';
import { cn } from '@/lib/cn';

/* ─── Defensive UI primitives ─────────────────────────────────────────── */

function OfflineBanner({ err, onRetry }: { err: VigilOfflineError; onRetry: () => void }) {
  const [showDetail, setShowDetail] = useState(false);
  const reasonHints: Record<VigilOfflineError['reason'], string> = {
    not_configured: '反作弊服务地址尚未配置。请管理员到 系统设置 → vigil.baseUrl 处填写并保存。',
    network: '反作弊服务无法访问 — 检查 KVS 服务器是否在线，以及网络连通性。',
    non_json: '反作弊服务返回了非预期的响应（可能是 URL 配置错误，请求被 OJ 兜底）。',
    token_failed: 'OJ 端获取访问令牌失败 — 检查 vigil.dashboardToken 配置和 OJ 服务状态。',
    server_5xx: '反作弊服务返回 5xx — 服务端异常，请查看 KVS 日志。',
  };
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-start gap-3">
        <ServerOff className="size-5 shrink-0 text-amber-600" />
        <div className="flex-1 space-y-1">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">反作弊服务暂不可用</p>
          <p className="text-xs text-amber-700/80 dark:text-amber-200/80">{reasonHints[err.reason]}</p>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onRetry}>
              <RefreshCw className="size-3" /> 重试
            </Button>
            <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
              <a href="/manage/setting?find=vigil">前往配置</a>
            </Button>
            {err.detail && (
              <button
                type="button"
                onClick={() => setShowDetail((p) => !p)}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-amber-700/70 hover:bg-amber-500/10"
              >
                {showDetail ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                技术详情
              </button>
            )}
          </div>
          {showDetail && err.detail && (
            <pre className="mt-2 max-h-32 overflow-auto rounded border border-amber-500/20 bg-amber-500/5 p-2 font-mono text-[10px] text-amber-800 dark:text-amber-200">
              {err.reason}: {err.detail}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyTable({ message, icon: Icon }: { message: string; icon?: any }) {
  const I = Icon || ServerOff;
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
      <I className="size-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function SkeletonTable({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: cols }).map((__, j) => (
            <div key={j} className="h-4 animate-pulse rounded bg-muted/40" />
          ))}
        </div>
      ))}
    </div>
  );
}

function useVigilData<T>(loader: () => Promise<T>, deps: any[] = []): {
  data: T | null; loading: boolean; offlineErr: VigilOfflineError | null;
  err: string | null; retry: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [offlineErr, setOfflineErr] = useState<VigilOfflineError | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loader().then((d) => {
      if (cancelled) return;
      setData(d); setErr(null); setOfflineErr(null);
    }).catch((e) => {
      if (cancelled) return;
      if (e instanceof VigilOfflineError) setOfflineErr(e);
      else setErr(e?.message || '加载失败');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    const interval = setInterval(() => setReloadKey((k) => k + 1), 60_000);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadKey]);
  return { data, loading, offlineErr, err, retry: () => setReloadKey((k) => k + 1) };
}

function Stat({ label, value, icon: Icon, highlight, loading }: {
  label: string; value: any; icon: any; highlight?: boolean; loading?: boolean;
}) {
  return (
    <Card className={highlight ? 'border-amber-500/40 bg-amber-500/5' : ''}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-primary/10 p-2"><Icon className="size-4 text-primary" /></div>
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            {loading
              ? <div className="mt-1 h-7 w-12 animate-pulse rounded bg-muted/40" />
              : <p className="text-2xl font-semibold">{value}</p>
            }
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SeverityBadge({ level }: { level: string }) {
  if (level === 'critical' || level === 'high') return <Badge variant="destructive" className="text-[10px]">{level}</Badge>;
  if (level === 'medium' || level === 'warning') return <Badge className="bg-amber-500 text-[10px] text-white">{level}</Badge>;
  return <Badge variant="outline" className="text-[10px]">{level}</Badge>;
}

/* ─── Exam grouping helpers ─────────────────────────────────────────── */

interface ExamGroup {
  examId: string;
  sessions: VigilExamSession[];
  approvals: VigilApproval[];
  events: VigilEvent[];
  /** Earliest session start time across the exam. */
  startedAt: Date | null;
  /** Latest session end time, or null if any session is still active. */
  endedAt: Date | null;
  /** Whether any session is in-progress. */
  isActive: boolean;
}

function groupByExam(
  sessions: VigilExamSession[] | null,
  approvals: VigilApproval[] | null,
  events: VigilEvent[] | null,
): ExamGroup[] {
  const map = new Map<string, ExamGroup>();
  const ensure = (examId: string): ExamGroup => {
    if (!map.has(examId)) {
      map.set(examId, {
        examId, sessions: [], approvals: [], events: [],
        startedAt: null, endedAt: null, isActive: false,
      });
    }
    return map.get(examId)!;
  };

  for (const s of sessions || []) {
    if (!s.oj_contest_id) continue;
    const g = ensure(s.oj_contest_id);
    g.sessions.push(s);
    const began = s.began_at ? new Date(s.began_at) : null;
    if (began && (!g.startedAt || began < g.startedAt)) g.startedAt = began;
    if (s.status === 'active') {
      g.isActive = true;
    } else if (s.closed_at) {
      const closed = new Date(s.closed_at);
      if (!g.endedAt || closed > g.endedAt) g.endedAt = closed;
    }
  }
  for (const a of approvals || []) {
    if (!a.oj_contest_id) continue;
    ensure(a.oj_contest_id).approvals.push(a);
  }
  // Events bind to a session — map back via exam_session_id.
  const sessionToExam = new Map<string, string>();
  for (const s of sessions || []) sessionToExam.set(s.id, s.oj_contest_id || '');
  for (const e of events || []) {
    const examId = e.exam_session_id ? sessionToExam.get(e.exam_session_id) : null;
    if (!examId) continue;
    ensure(examId).events.push(e);
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return (b.startedAt?.getTime() || 0) - (a.startedAt?.getTime() || 0);
  });
}

/* ─── Overview ─────────────────────────────────────────────────────── */

export function AdminVigilOverviewPage() {
  const clientsQ = useVigilData<VigilClient[]>(() => fetchClients());
  const sessionsQ = useVigilData<VigilExamSession[]>(() => fetchExamSessions());
  const approvalsQ = useVigilData<VigilApproval[]>(() => fetchApprovals());
  const eventsQ = useVigilData<VigilEvent[]>(() => fetchEvents({ limit: '200' }));

  const offline = clientsQ.offlineErr || sessionsQ.offlineErr || approvalsQ.offlineErr || eventsQ.offlineErr;
  const pendingApprovals = approvalsQ.data?.filter((a) => a.status === 'pending') || [];
  const activeSessions = sessionsQ.data?.filter((s) => s.status === 'active') || [];

  const groups = useMemo(
    () => groupByExam(sessionsQ.data, approvalsQ.data, eventsQ.data),
    [sessionsQ.data, approvalsQ.data, eventsQ.data],
  );
  const active = groups.filter((g) => g.isActive);
  const ended = groups.filter((g) => !g.isActive);

  const retryAll = () => {
    clientsQ.retry(); sessionsQ.retry(); approvalsQ.retry(); eventsQ.retry();
  };

  return (
    <AdminPage
      title={(
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">反作弊总览</h1>
        </div>
      )}
      requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
      description="按考试聚合的会话 / 审批 / 事件。点击具体考试查看详情。"
    >
      {offline && <OfflineBanner err={offline} onRetry={retryAll} />}

      {/* Stats row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="在线客户端" value={clientsQ.data?.length ?? '—'} icon={Users}
          loading={clientsQ.loading && !clientsQ.data && !offline} />
        <Stat label="进行中会话" value={sessionsQ.data ? activeSessions.length : '—'} icon={Layers}
          loading={sessionsQ.loading && !sessionsQ.data && !offline} />
        <Stat label="待审批" value={approvalsQ.data ? pendingApprovals.length : '—'} icon={Inbox}
          highlight={pendingApprovals.length > 0}
          loading={approvalsQ.loading && !approvalsQ.data && !offline} />
        <Stat label="今日事件" value={eventsQ.data?.length ?? '—'} icon={Activity}
          loading={eventsQ.loading && !eventsQ.data && !offline} />
      </div>

      {/* Active exams */}
      <Card>
        <CardHeader className="px-5 pb-3 pt-5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4 text-emerald-600" />
            进行中（{active.length}）
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {sessionsQ.loading && !sessionsQ.data && !offline ? <SkeletonTable rows={2} cols={4} /> : (
            active.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">没有进行中的考试。</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {active.map((g) => <ExamCard key={g.examId} group={g} active />)}
              </div>
            )
          )}
        </CardContent>
      </Card>

      {/* Ended exams */}
      <Card>
        <CardHeader className="px-5 pb-3 pt-5">
          <CardTitle className="text-base">已结束（{ended.length}）</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {ended.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">无历史考试记录。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">考试 ID</TableHead>
                  <TableHead className="w-24 text-right">会话数</TableHead>
                  <TableHead className="w-24 text-right">审批数</TableHead>
                  <TableHead className="w-24 text-right">事件数</TableHead>
                  <TableHead>开始时间</TableHead>
                  <TableHead>结束时间</TableHead>
                  <TableHead className="w-10 pr-5" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {ended.map((g) => (
                  <TableRow
                    key={g.examId}
                    className="cursor-pointer hover:bg-accent/40"
                    onClick={() => { window.location.href = `/admin/vigil/exams/${encodeURIComponent(g.examId)}`; }}
                  >
                    <TableCell className="pl-5 font-mono text-xs">{g.examId}</TableCell>
                    <TableCell className="text-right text-sm">{g.sessions.length}</TableCell>
                    <TableCell className="text-right text-sm">{g.approvals.length}</TableCell>
                    <TableCell className="text-right text-sm">{g.events.length}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {g.startedAt ? <DateTime value={g.startedAt} /> : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {g.endedAt ? <DateTime value={g.endedAt} /> : '—'}
                    </TableCell>
                    <TableCell className="pr-5">
                      <ChevronRight className="size-3.5 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AdminPage>
  );
}

function ExamCard({ group, active }: { group: ExamGroup; active?: boolean }) {
  const pending = group.approvals.filter((a) => a.status === 'pending').length;
  const recentEvents = group.events.length;
  return (
    <a
      href={`/admin/vigil/exams/${encodeURIComponent(group.examId)}`}
      className={cn(
        'block rounded-lg border bg-card p-4 transition-shadow hover:shadow-md',
        active && 'border-emerald-500/40 bg-emerald-500/5',
      )}
    >
      <div className="flex items-center justify-between">
        <p className="truncate font-mono text-xs text-muted-foreground">{group.examId}</p>
        {active && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-500" />
            进行中
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-2xl font-semibold tabular-nums">{group.sessions.length}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">会话</p>
        </div>
        <div>
          <p className={cn('text-2xl font-semibold tabular-nums', pending > 0 && 'text-amber-600')}>{pending}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">待审批</p>
        </div>
        <div>
          <p className="text-2xl font-semibold tabular-nums">{recentEvents}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">事件</p>
        </div>
      </div>
      {group.startedAt && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          开始 <DateTime value={group.startedAt} mode="datetime" />
        </p>
      )}
    </a>
  );
}

/* ─── Per-exam detail page ─────────────────────────────────────────── */

type TabKey = 'overview' | 'sessions' | 'approvals' | 'events';

export function AdminVigilExamDetailPage() {
  const bs = useBootstrap();
  const examId = String(bs.page.data.examId || '');
  const [tab, setTab] = useState<TabKey>('overview');

  const sessionsQ = useVigilData<VigilExamSession[]>(() => fetchExamSessions());
  const approvalsQ = useVigilData<VigilApproval[]>(() => fetchApprovals());
  const eventsQ = useVigilData<VigilEvent[]>(() => fetchEvents({ limit: '500' }));

  const offline = sessionsQ.offlineErr || approvalsQ.offlineErr || eventsQ.offlineErr;

  // Filter all three streams to just this exam.
  const examSessions = useMemo(
    () => (sessionsQ.data || []).filter((s) => s.oj_contest_id === examId),
    [sessionsQ.data, examId],
  );
  const examApprovals = useMemo(
    () => (approvalsQ.data || []).filter((a) => a.oj_contest_id === examId),
    [approvalsQ.data, examId],
  );
  const examEvents = useMemo(() => {
    const sessIds = new Set(examSessions.map((s) => s.id));
    return (eventsQ.data || []).filter((e) => e.exam_session_id && sessIds.has(e.exam_session_id));
  }, [eventsQ.data, examSessions]);

  const pendingCount = examApprovals.filter((a) => a.status === 'pending').length;
  const activeCount = examSessions.filter((s) => s.status === 'active').length;

  const retryAll = () => {
    sessionsQ.retry(); approvalsQ.retry(); eventsQ.retry();
  };

  return (
    <AdminPage
      title={(
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">反作弊 · {examId}</h1>
        </div>
      )}
      requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
      actions={(
        <Button variant="ghost" asChild>
          <a href="/admin/vigil">返回总览</a>
        </Button>
      )}
    >
      {offline && <OfflineBanner err={offline} onRetry={retryAll} />}

      <MiniTabs
        value={tab}
        onValueChange={(v) => setTab(v as TabKey)}
        items={[
          { value: 'overview', label: '概览' },
          { value: 'sessions', label: '会话', count: examSessions.length },
          { value: 'approvals', label: '审批', count: pendingCount > 0 ? pendingCount : undefined },
          { value: 'events', label: '事件', count: examEvents.length },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="会话总数" value={examSessions.length} icon={Layers} />
          <Stat label="进行中" value={activeCount} icon={Activity} />
          <Stat label="待审批" value={pendingCount} icon={Inbox} highlight={pendingCount > 0} />
          <Stat label="事件总数" value={examEvents.length} icon={AlertCircle} />
        </div>
      )}

      {tab === 'sessions' && (
        <Card>
          <CardContent className="p-0">
            {sessionsQ.loading && !sessionsQ.data ? <SkeletonTable rows={5} cols={6} /> : (
              examSessions.length === 0
                ? <EmptyTable message="此考试暂无会话。" icon={Layers} />
                : <SessionsTable sessions={examSessions} />
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'approvals' && (
        <Card>
          <CardContent className="p-0">
            {approvalsQ.loading && !approvalsQ.data ? <SkeletonTable rows={4} cols={6} /> : (
              examApprovals.length === 0
                ? <EmptyTable message="此考试暂无审批请求。" icon={Inbox} />
                : <ApprovalsTable approvals={examApprovals} onChanged={() => approvalsQ.retry()} />
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'events' && (
        <Card>
          <CardContent className="p-0">
            {eventsQ.loading && !eventsQ.data ? <SkeletonTable rows={6} cols={6} /> : (
              examEvents.length === 0
                ? <EmptyTable message="此考试暂无风险事件。" icon={Activity} />
                : <EventTable events={examEvents} />
            )}
          </CardContent>
        </Card>
      )}
    </AdminPage>
  );
}

/* ─── Shared tables ─────────────────────────────────────────────────── */

function SessionsTable({ sessions }: { sessions: VigilExamSession[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-5">会话 ID</TableHead>
          <TableHead>机器</TableHead>
          <TableHead>OJ 用户</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>开始</TableHead>
          <TableHead className="pr-5">结束</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((s) => (
          <TableRow key={s.id}>
            <TableCell className="pl-5 font-mono text-xs">{s.id.slice(0, 16)}…</TableCell>
            <TableCell className="font-mono text-xs">{s.machine_id.slice(0, 12)}…</TableCell>
            <TableCell className="text-sm">
              UID {s.oj_user_id}
              {s.is_temporary_user && <Badge variant="outline" className="ml-1.5 text-[10px]">临时</Badge>}
            </TableCell>
            <TableCell>
              {s.status === 'active' && <Badge>进行中</Badge>}
              {s.status === 'closed' && <Badge variant="secondary">已结束</Badge>}
              {s.status === 'transferred' && <Badge variant="outline">已转移</Badge>}
              {s.status === 'force_closed' && <Badge variant="destructive">强制关闭</Badge>}
            </TableCell>
            <TableCell className="text-xs"><DateTime value={s.began_at} /></TableCell>
            <TableCell className="pr-5 text-xs">{s.closed_at ? <DateTime value={s.closed_at} /> : '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ApprovalsTable({
  approvals, onChanged,
}: { approvals: VigilApproval[]; onChanged: () => void }) {
  // Live updates via WS.
  useVigilSocket({
    onMessage: (msg) => {
      if (msg.type === 'approval_request' || msg.type === 'approval_resolved') onChanged();
    },
  });

  const onApprove = async (a: VigilApproval) => {
    const asTemp = a.is_unknown && window.confirm(
      '该考生未在学号库中匹配到。批准并创建临时账号？\n\n确定 = 创建临时账号\n取消 = 不创建',
    );
    try {
      await approveRequest(a.id, asTemp);
      onChanged();
    } catch (e: any) {
      alert(e?.message || '操作失败');
    }
  };
  const onReject = async (a: VigilApproval) => {
    const reason = window.prompt('拒绝理由（必填）：') || '';
    if (!reason.trim()) { alert('请填写拒绝理由'); return; }
    try {
      await rejectRequest(a.id, reason);
      onChanged();
    } catch (e: any) {
      alert(e?.message || '操作失败');
    }
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-5">学号</TableHead>
          <TableHead>姓名</TableHead>
          <TableHead>机器</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>提交时间</TableHead>
          <TableHead className="pr-5 text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {approvals.map((a) => (
          <motion.tr
            key={a.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className={a.is_unknown ? 'bg-amber-500/5' : undefined}
          >
            <TableCell className="pl-5 font-mono text-sm">{a.student_id_input}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <span>{a.real_name_input}</span>
                {a.is_unknown && <Badge variant="destructive" className="text-[10px]">未知考生</Badge>}
              </div>
            </TableCell>
            <TableCell className="font-mono text-xs">{a.machine_id.slice(0, 12)}…</TableCell>
            <TableCell>
              <Badge variant={a.status === 'pending' ? 'default' : 'outline'}>{a.status}</Badge>
            </TableCell>
            <TableCell className="text-xs"><DateTime value={a.created_at} mode="both" /></TableCell>
            <TableCell className="pr-5 text-right">
              {a.status === 'pending' && (
                <div className="inline-flex gap-1">
                  <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => onApprove(a)}>
                    <CheckCircle className="size-3.5" />批准
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => onReject(a)}>
                    <XCircle className="size-3.5" />拒绝
                  </Button>
                </div>
              )}
            </TableCell>
          </motion.tr>
        ))}
      </TableBody>
    </Table>
  );
}

function EventTable({ events }: { events: VigilEvent[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-5">时间</TableHead>
          <TableHead>机器</TableHead>
          <TableHead>分类</TableHead>
          <TableHead>严重程度</TableHead>
          <TableHead>消息</TableHead>
          <TableHead className="w-16 pr-5">次数</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((e) => (
          <TableRow key={e.event_id}>
            <TableCell className="pl-5 text-xs"><DateTime value={e.last_seen_at} mode="both" /></TableCell>
            <TableCell className="font-mono text-xs">{e.client_id.slice(0, 12)}…</TableCell>
            <TableCell><Badge variant="outline" className="text-[10px]">{e.category}</Badge></TableCell>
            <TableCell><SeverityBadge level={e.severity} /></TableCell>
            <TableCell className="max-w-sm truncate text-sm">{e.message}</TableCell>
            <TableCell className="pr-5 text-sm">{e.occurrence_count}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
