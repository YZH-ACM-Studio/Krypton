/**
 * krypton-vigil admin pages.
 *
 * Two surfaces:
 *   /admin/vigil                 → AdminVigilOverviewPage     (template:
 *     admin_vigil_overview.html). Stats + Active exam cards + Ended table.
 *   /admin/vigil/exams/:examId   → AdminVigilExamDetailPage   (template:
 *     admin_vigil_exam_detail.html). Phase 1 monitoring refactor: top stat
 *     banner + toolbar + student card wall + right-side detail sheet, with
 *     legacy 会话 / 审批 / 事件 tables accessible via the "更多视图" dropdown.
 *
 * Vigil is reached from the *main* sidebar (under 管理) — admin-nav-registry
 * registration was removed in the parallel sidebar refactor.
 *
 * Defensive design: when Vigil server is unreachable the pages render a
 * banner + skeleton instead of throwing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertCircle, CheckCircle, ChevronDown, ChevronLeft,
  ChevronRight, ChevronUp,
  Inbox, Layers, Megaphone, RefreshCw, Search, ServerOff, ShieldAlert,
  Users, XCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import { PRIV } from '@/lib/perms';
import { AdminPage } from '@/components/admin/admin-page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DateTime } from '@/components/ui/datetime';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { SimpleSelect } from '@/components/ui/select';
import { ToastProvider } from '@/components/ui/toast';
import { useBootstrap } from '@/lib/bootstrap';
import {
  approveRequest, fetchApprovals, fetchClients, fetchEvents, fetchExamSessions,
  invalidateExamSession, rejectRequest, VigilOfflineError, type VigilApproval, type VigilClient,
  resetStudentFinishSession, type VigilEvent, type VigilExamSession,
  listContestStudents, type VigilStudentCard as VigilStudentCardData,
  type VigilStudentListResponse, type VigilStudentStatus,
} from '@/lib/vigil-api';
import { useVigilSocket, type ContestSubscription } from '@/hooks/use-vigil-socket';
import { useProctorCommands, notifyCommandResult } from '@/hooks/use-proctor-commands';
import { StudentCard } from '@/pages/vigil/student-card';
import { StudentDetailSheet } from '@/pages/vigil/student-detail-sheet';
import { LivePlayerDialog } from '@/pages/vigil/live-player-dialog';
import { SendMessageDialog } from '@/pages/vigil/send-message-dialog';
import { VigilDateTime, parseVigilTimestamp } from '@/pages/vigil/timestamp';
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

// (Vigil timestamp helpers are now imported from ./timestamp at file top.)

/* ─── Exam grouping helpers ─────────────────────────────────────────── */

interface ExamGroup {
  examId: string;
  sessions: VigilExamSession[];
  approvals: VigilApproval[];
  events: VigilEvent[];
  localContest?: LocalVigilContest;
  /** Earliest session start time across the exam. */
  startedAt: Date | null;
  /** Latest session end time, or null if any session is still active. */
  endedAt: Date | null;
  /** Whether any session is in-progress. */
  isActive: boolean;
}

interface LocalVigilContest {
  domainId: string;
  examId: string;
  title: string;
  beginAt: string;
  endAt: string;
  rule?: string;
  entryMode?: 'open' | 'client_required';
}

function sortExamGroups(a: ExamGroup, b: ExamGroup) {
  if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
  return (b.startedAt?.getTime() || 0) - (a.startedAt?.getTime() || 0);
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
    const began = s.began_at ? parseVigilTimestamp(s.began_at) : null;
    if (began && (!g.startedAt || began < g.startedAt)) g.startedAt = began;
    if (s.status === 'active') {
      g.isActive = true;
    } else if (s.closed_at) {
      const closed = parseVigilTimestamp(s.closed_at);
      if (!closed) continue;
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

  return Array.from(map.values()).sort(sortExamGroups);
}

function mergeLocalVigilContests(groups: ExamGroup[], contests: LocalVigilContest[]): ExamGroup[] {
  const map = new Map<string, ExamGroup>();
  for (const group of groups) {
    map.set(group.examId, {
      ...group,
      sessions: [...group.sessions],
      approvals: [...group.approvals],
      events: [...group.events],
    });
  }

  for (const contest of contests || []) {
    const begin = contest.beginAt ? new Date(contest.beginAt) : null;
    const existing = map.get(contest.examId);
    if (existing) {
      existing.localContest = contest;
      existing.isActive = true;
      if (begin && (!existing.startedAt || begin < existing.startedAt)) existing.startedAt = begin;
      continue;
    }
    map.set(contest.examId, {
      examId: contest.examId,
      sessions: [],
      approvals: [],
      events: [],
      localContest: contest,
      startedAt: begin,
      endedAt: null,
      isActive: true,
    });
  }

  return Array.from(map.values()).sort(sortExamGroups);
}

/* ─── Overview ─────────────────────────────────────────────────────── */

/**
 * Resolve Hydro contest ids → human titles via /api/admin/vigil/resolve-contests.
 * Returns a Map; missing ids stay missing and the caller can fall back to
 * displaying the raw id.
 */
function useContestNames(ids: string[]): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(new Map());
  // Stable key so the effect only re-runs when the set of ids actually changes.
  const key = ids.slice().sort().join(',');
  useEffect(() => {
    if (!ids.length) { setNames(new Map()); return; }
    // Hydro's @param('ids', Types.CommaSeperatedArray) reads only the first
    // value of repeated form keys, so we must send the ids comma-joined.
    const form = new URLSearchParams();
    form.set('ids', ids.join(','));
    fetch('/api/admin/vigil/resolve-contests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: form,
    })
      .then((r) => (r.ok ? r.json() : {}))
      .then((map) => setNames(new Map(Object.entries(map))))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return names;
}

function displayExam(id: string, names: Map<string, string>): string {
  return names.get(id) || id;
}

export function AdminVigilOverviewPage() {
  const bs = useBootstrap();
  const localContests = ((bs.page.data as any)?.activeVigilContests || []) as LocalVigilContest[];
  const clientsQ = useVigilData<VigilClient[]>(() => fetchClients());
  const sessionsQ = useVigilData<VigilExamSession[]>(() => fetchExamSessions());
  const approvalsQ = useVigilData<VigilApproval[]>(() => fetchApprovals());
  const eventsQ = useVigilData<VigilEvent[]>(() => fetchEvents({ limit: '200' }));

  const offline = clientsQ.offlineErr || sessionsQ.offlineErr || approvalsQ.offlineErr || eventsQ.offlineErr;
  const pendingApprovals = approvalsQ.data?.filter((a) => a.status === 'pending') || [];
  const activeSessions = sessionsQ.data?.filter((s) => s.status === 'active') || [];

  const groups = useMemo(
    () => mergeLocalVigilContests(
      groupByExam(sessionsQ.data, approvalsQ.data, eventsQ.data),
      localContests,
    ),
    [sessionsQ.data, approvalsQ.data, eventsQ.data, localContests],
  );
  const examIds = useMemo(() => groups.filter((g) => !g.localContest?.title).map((g) => g.examId), [groups]);
  const names = useContestNames(examIds);
  const active = groups.filter((g) => g.isActive);
  const ended = groups.filter((g) => !g.isActive);
  const nameFor = (g: ExamGroup) => g.localContest?.title || displayExam(g.examId, names);

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
      hideSidebar
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
                {active.map((g) => <ExamCard key={g.examId} group={g} active name={nameFor(g)} />)}
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
                  <TableHead className="pl-5">考试</TableHead>
                  <TableHead className="w-24 text-right">会话数</TableHead>
                  <TableHead className="w-24 text-right">审批数</TableHead>
                  <TableHead className="w-24 text-right">事件数</TableHead>
                  <TableHead>开始时间</TableHead>
                  <TableHead>结束时间</TableHead>
                  <TableHead className="w-10 pr-5" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {ended.map((g) => {
                  const name = nameFor(g);
                  const hasName = name !== g.examId;
                  return (
                  <TableRow
                    key={g.examId}
                    className="cursor-pointer hover:bg-accent/40"
                    onClick={() => { window.location.href = `/admin/vigil/exams/${encodeURIComponent(g.examId)}`; }}
                  >
                    <TableCell className="pl-5">
                      <p className={cn('text-sm', hasName && 'font-medium')}>{name}</p>
                      {hasName && <p className="font-mono text-[10px] text-muted-foreground">{g.examId}</p>}
                    </TableCell>
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

function ExamCard({ group, active, name }: { group: ExamGroup; active?: boolean; name: string }) {
  const pending = group.approvals.filter((a) => a.status === 'pending').length;
  const recentEvents = group.events.length;
  const hasName = name !== group.examId;
  const waitingForClient = !!group.localContest && group.sessions.length === 0;
  return (
    <a
      href={`/admin/vigil/exams/${encodeURIComponent(group.examId)}`}
      className={cn(
        'block rounded-lg border bg-card p-4 transition-shadow hover:shadow-md',
        active && 'border-emerald-500/40 bg-emerald-500/5',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn('truncate text-sm', hasName && 'font-semibold')}>{name}</p>
          {hasName && <p className="truncate font-mono text-[10px] text-muted-foreground">{group.examId}</p>}
        </div>
        {active && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
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
          开始 <VigilDateTime value={group.startedAt} mode="datetime" />
        </p>
      )}
      {waitingForClient && (
        <p className="mt-2 rounded-md bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground">
          OJ 已开启 Vigil，等待客户端会话接入
        </p>
      )}
    </a>
  );
}

/* ─── Per-exam detail page (Phase 1 monitoring refactor) ──────────────── */

/**
 * AdminVigilExamDetailPage — the live proctoring view.
 *
 * Phase 1 refactor (CLIENT_PROCTOR_MONITORING_DESIGN §8):
 *   1. Top: compressed stat banner (4 counters) + toolbar
 *   2. Middle: 30-card grid (status colour, thumbnail, anomaly badge)
 *   3. Bottom: pagination
 *
 * Real-time updates flow via useVigilSocket (contest subscription) and bump
 * targeted React state — we never re-fetch the whole list on a single delta.
 *
 * Secondary views (会话 / 审批 / 事件 / 审计) are accessed via a "更多视图"
 * dropdown so the card wall stays the primary surface.
 */
type SecondaryView = 'sessions' | 'approvals' | 'events';

type StatusFilter = '' | VigilStudentStatus;
type SortKey = 'status_priority' | 'student_id' | 'name' | 'exam_time' | 'event_count';

const ALL_STATUSES: VigilStudentStatus[] = ['online', 'anomaly', 'offline', 'disconnected', 'locked', 'ended'];
const PAGE_SIZE = 30;

export function AdminVigilExamDetailPage() {
  const bs = useBootstrap();
  const examId = String(bs.page.data.examId || '');
  const examTitle = bs.page.data.examTitle as string | null | undefined;
  // Contest config — needed for live-player URL + record-enabled UI gates.
  // Hydro injects this via page.data; the student list carries the same field
  // as a fallback for older OJ pages that did not expose it yet.
  const pageRecordEnabled = (bs.page.data as any)?.recordEnabled;

  // ─── Toolbar state (URL-aware so refresh keeps the user's filter) ───
  const initialUrl = useMemo(() => new URL(window.location.href), []);
  const [page, setPage] = useState(() => Math.max(1, Number(initialUrl.searchParams.get('page')) || 1));
  const [pageInput, setPageInput] = useState(String(page));
  const [query, setQuery] = useState(initialUrl.searchParams.get('q') || '');
  const [queryDebounced, setQueryDebounced] = useState(query);
  const [statusFilter, setStatusFilter] = useState<Set<StatusFilter>>(() => {
    const raw = initialUrl.searchParams.get('status') || '';
    return new Set(raw.split(',').filter(Boolean) as VigilStudentStatus[]);
  });
  const [sortKey, setSortKey] = useState<SortKey>(
    ((initialUrl.searchParams.get('sort') as SortKey) || 'status_priority'),
  );
  const [secondary, setSecondary] = useState<SecondaryView | null>(null);
  const [groupMessageOpen, setGroupMessageOpen] = useState(false);

  // Debounce search input — typing 张三 shouldn't fire 2 requests.
  useEffect(() => {
    const t = setTimeout(() => setQueryDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Push state to the URL so 刷新 / 分享链接 都保持过滤条件.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (page > 1) url.searchParams.set('page', String(page));
    else url.searchParams.delete('page');
    if (queryDebounced) url.searchParams.set('q', queryDebounced);
    else url.searchParams.delete('q');
    if (statusFilter.size) url.searchParams.set('status', Array.from(statusFilter).join(','));
    else url.searchParams.delete('status');
    if (sortKey !== 'status_priority') url.searchParams.set('sort', sortKey);
    else url.searchParams.delete('sort');
    window.history.replaceState(null, '', url.toString());
  }, [page, queryDebounced, statusFilter, sortKey]);

  // ─── Student list (server-side paged) ───
  const [studentResp, setStudentResp] = useState<VigilStudentListResponse | null>(null);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [offlineErr, setOfflineErr] = useState<VigilOfflineError | null>(null);
  const [reloadVer, setReloadVer] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStudentsLoading(true);
    setOfflineErr(null);
    listContestStudents(examId, {
      page,
      pageSize: PAGE_SIZE,
      q: queryDebounced || undefined,
      status: statusFilter.size ? Array.from(statusFilter).join(',') : undefined,
      sort: sortKey,
    })
      .then((resp) => {
        if (cancelled) return;
        setStudentResp(resp);
        setStudentsLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof VigilOfflineError) setOfflineErr(e);
        setStudentsLoading(false);
      });
    return () => { cancelled = true; };
  }, [examId, page, queryDebounced, statusFilter, sortKey, reloadVer]);

  // Safety-net: periodically re-pull the full card-wall so a *missed* WS
  // status-recovery broadcast (e.g. dropped during a dashboard WS reconnect)
  // self-corrects instead of leaving a card stuck on a stale online/offline
  // state. WS deltas keep it fresh in real time; this only backstops gaps.
  // No flicker: the spinner only shows on first load (`!studentResp`), so a
  // background reload swaps data in place.
  useEffect(() => {
    const id = setInterval(() => setReloadVer((v) => v + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const counters = studentResp?.counters;
  const totalPages = studentResp ? Math.max(1, Math.ceil(studentResp.total / PAGE_SIZE)) : 1;
  const students = studentResp?.items || [];
  const recordEnabled = typeof pageRecordEnabled === 'boolean'
    ? pageRecordEnabled
    : students.some((s) => s.recordEnabled === true);

  // ─── Selected student (drawer / quick live-player from double-click) ──
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<VigilStudentCardData | null>(null);
  const [doubleClickLiveOpen, setDoubleClickLiveOpen] = useState(false);
  // newEventVersion bumps every time a WS event_added matches the open drawer
  // — the drawer keys its event-list reload off this.
  const [newEventVersion, setNewEventVersion] = useState(0);

  const openStudent = useCallback((s: VigilStudentCardData) => {
    setSelectedStudent(s);
    setDrawerOpen(true);
  }, []);

  const liveLaunch = useCallback((s: VigilStudentCardData) => {
    setSelectedStudent(s);
    setDoubleClickLiveOpen(true);
  }, []);

  // ─── WS subscription: stream status / screenshot / event / command_result ──
  const subscriptionRef = useRef<ContestSubscription | null>(null);
  // Build the current subscription target list — what's on screen *now*.
  // Memo'd on the *joined* string so per-message WS deltas that rewrite
  // studentResp.items in-place don't thrash the subscription effect.
  const machineIdsKey = students.map((s) => s.machineId).join(',');
  const machineIdsOnPage = useMemo(
    () => (machineIdsKey ? machineIdsKey.split(',') : []),
    [machineIdsKey],
  );

  // Throttle reloads triggered by WS pushes so that a flurry of
  // status_update / session_opened messages doesn't fire `listContestStudents`
  // dozens of times back-to-back.
  const lastReloadAtRef = useRef(0);
  const queueStudentsReload = useCallback(() => {
    const now = Date.now();
    if (now - lastReloadAtRef.current < 1500) return;
    lastReloadAtRef.current = now;
    setReloadVer((v) => v + 1);
  }, []);

  const handleWsMessage = useCallback((msg: any) => {
    // Forward command results to useProctorCommands' pending bus.
    if (msg.type === 'command_result') {
      notifyCommandResult(msg);
      return;
    }
    // New ExamSession created (proctor just approved an ApprovalRequest,
    // or a student auto-approved). The students list is stale because
    // the card-wall fetched before this session existed — reload to
    // pick up the new machineId. Approval table also wants a refresh
    // because the just-approved row should flip to "approved".
    if (msg.type === 'session_opened' || msg.type === 'session_closed' || msg.type === 'session_transferred') {
      const contestId = msg.payload?.oj_contest_id || msg.contestId;
      if (contestId === examId) queueStudentsReload();
      return;
    }
    if (msg.type === 'approval_resolved') {
      // The dashboard's secondary "审批表" subscribes via its own handler,
      // but the card-wall needs to refresh too: an approved request means
      // a new ExamSession just landed.
      queueStudentsReload();
      return;
    }
    if (msg.type === 'student_status_update' && msg.contestId === examId) {
      // Patch the matching card in-place; falls through to a list reload if
      // we don't have the student on the current page (its state still
      // affects banner counters).
      setStudentResp((prev) => {
        if (!prev) return prev;
        const idx = prev.items.findIndex((s) => s.machineId === msg.machineId);
        const counters = { ...prev.counters };
        if (idx >= 0) {
          const oldStatus = prev.items[idx].status;
          if (oldStatus !== msg.status) {
            counters[oldStatus] = Math.max(0, (counters[oldStatus] || 0) - 1);
            counters[msg.status] = (counters[msg.status] || 0) + 1;
          }
          const items = [...prev.items];
          items[idx] = {
            ...items[idx],
            status: msg.status,
            lastHeartbeat: msg.lastHeartbeat ?? items[idx].lastHeartbeat,
            eventCount: msg.eventCount ?? items[idx].eventCount,
            lockedAt: msg.lockedAt ?? items[idx].lockedAt,
            lockedBy: msg.lockedBy ?? items[idx].lockedBy,
          };
          return { ...prev, items, counters };
        }
        // Unknown machineId: either off-page (counters only) or a brand-new
        // ExamSession that arrived after our last fetch. session_opened is
        // the primary trigger; this is a belt-and-suspenders fallback in
        // case that message races / is dropped during a WS reconnect.
        queueStudentsReload();
        return { ...prev, counters };
      });
      return;
    }
    if (msg.type === 'screenshot_added' && msg.contestId === examId) {
      // Update the recent thumb on whichever card matches; ignore otherwise.
      setStudentResp((prev) => {
        if (!prev) return prev;
        const idx = prev.items.findIndex((s) => s.machineId === msg.machineId);
        if (idx < 0) return prev;
        const items = [...prev.items];
        items[idx] = {
          ...items[idx],
          recentScreenshotUrl: msg.thumbUrl || items[idx].recentScreenshotUrl,
          recentScreenshotAt: msg.ts,
        };
        return { ...prev, items };
      });
      return;
    }
    if (msg.type === 'event_added' && msg.contestId === examId) {
      // Bump the open drawer's event list reload.
      if (selectedStudent && selectedStudent.machineId === msg.machineId) {
        setNewEventVersion((v) => v + 1);
      }
      // Severity >= warning → bump the student's local eventCount badge.
      if (msg.severity === 'warning' || msg.severity === 'error' || msg.severity === 'critical') {
        setStudentResp((prev) => {
          if (!prev) return prev;
          const idx = prev.items.findIndex((s) => s.machineId === msg.machineId);
          if (idx < 0) return prev;
          const items = [...prev.items];
          items[idx] = { ...items[idx], eventCount: (items[idx].eventCount || 0) + 1 };
          return { ...prev, items };
        });
      }
      return;
    }
    if (msg.type === 'stream_status_change' && msg.contestId === examId) {
      setStudentResp((prev) => {
        if (!prev) return prev;
        const idx = prev.items.findIndex((s) => s.machineId === msg.machineId);
        if (idx < 0) return prev;
        const items = [...prev.items];
        items[idx] = {
          ...items[idx],
          streamState: {
            ...(items[idx].streamState || {}),
            [msg.streamType]: msg.status,
          },
        };
        return { ...prev, items };
      });
    }
  }, [examId, selectedStudent, queueStudentsReload]);

  const { subscribeContest } = useVigilSocket({ onMessage: handleWsMessage });

  // Re-subscribe whenever page / filter / machineIds list changes.
  useEffect(() => {
    if (!examId || !machineIdsOnPage.length) {
      subscribeContest(null);
      subscriptionRef.current = null;
      return;
    }
    const sub: ContestSubscription = {
      contestId: examId,
      page,
      pageSize: PAGE_SIZE,
      machineIds: machineIdsOnPage,
    };
    subscriptionRef.current = sub;
    subscribeContest(sub);
    return () => {
      // Don't tear down on every re-render — only when component unmounts.
    };
  }, [examId, page, machineIdsOnPage, subscribeContest]);

  // Cleanup on unmount.
  useEffect(() => () => subscribeContest(null), [subscribeContest]);

  const offline = offlineErr;

  // ─── Secondary view (sessions / approvals / events) supporting state ──
  // These are the *old* tables; we keep them as a fallback view, accessed
  // via the "更多视图" dropdown next to the toolbar.
  const sessionsQ = useVigilData<VigilExamSession[]>(() => fetchExamSessions(), [secondary]);
  const approvalsQ = useVigilData<VigilApproval[]>(() => fetchApprovals(), [secondary]);
  const eventsQ = useVigilData<VigilEvent[]>(() => fetchEvents({ limit: '500' }), [secondary]);
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
  const retrySecondary = () => { sessionsQ.retry(); approvalsQ.retry(); eventsQ.retry(); };
  const retryStudents = () => setReloadVer((v) => v + 1);

  return (
    <AdminPage
      title={(
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">反作弊 · {examTitle || examId}</h1>
        </div>
      )}
      requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
      hideSidebar
      description={examTitle ? <span className="font-mono text-[11px]">{examId}</span> : undefined}
      actions={(
        <Button variant="ghost" asChild>
          <a href="/admin/vigil">返回总览</a>
        </Button>
      )}
    >
      <ToastProvider />
      {offline && <OfflineBanner err={offline} onRetry={retryStudents} />}

      {/* Stat banner (compressed) */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <CompactStat
          label="已连接"
          value={(counters?.online ?? 0) + (counters?.locked ?? 0)}
          color="emerald"
        />
        <CompactStat label="异常" value={counters?.anomaly ?? 0} color="amber" highlight={(counters?.anomaly ?? 0) > 0} />
        <CompactStat label="离线" value={counters?.offline ?? 0} color="red" highlight={(counters?.offline ?? 0) > 0} />
        <CompactStat label="已结束" value={counters?.ended ?? 0} color="neutral" />
        <CompactStat label="待审批" value={pendingCount} color="amber" highlight={pendingCount > 0} />
        <CompactStat label="总人数" value={counters?.total ?? 0} color="neutral" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">状态</span>
          {ALL_STATUSES.map((st) => (
            <label
              key={st}
              className={cn(
                'flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                statusFilter.has(st) ? 'border-primary bg-primary/10 text-primary' : 'border-input text-muted-foreground hover:bg-accent',
              )}
            >
              <Checkbox
                size="sm"
                checked={statusFilter.has(st)}
                onCheckedChange={(c) => {
                  setStatusFilter((prev) => {
                    const next = new Set(prev);
                    if (c) next.add(st); else next.delete(st);
                    return next;
                  });
                  setPage(1);
                }}
              />
              {statusBadgeLabel(st)}
            </label>
          ))}
        </div>

        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8 text-xs"
            placeholder="搜索学号 / 姓名"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">排序</span>
          <SimpleSelect
            size="sm"
            className="h-8 w-40 text-xs"
            value={sortKey}
            onValueChange={(v) => { setSortKey(v as SortKey); setPage(1); }}
            options={[
              { value: 'status_priority', label: '状态优先' },
              { value: 'student_id', label: '学号' },
              { value: 'name', label: '姓名' },
              { value: 'exam_time', label: '已考时长' },
              { value: 'event_count', label: '异常数' },
            ]}
          />
        </div>

        <SimpleSelect
          size="sm"
          className="h-8 w-32 text-xs"
          value={secondary || ''}
          onValueChange={(v) => setSecondary(v ? (v as SecondaryView) : null)}
          placeholder="更多视图"
          options={[
            { value: '', label: '关闭辅助视图' },
            { value: 'sessions', label: '会话表' },
            { value: 'approvals', label: '审批表' },
            { value: 'events', label: '事件表' },
          ]}
        />

        <Button
          size="sm"
          className="ml-auto h-8 gap-1.5 text-xs"
          onClick={() => setGroupMessageOpen(true)}
        >
          <Megaphone className="size-3.5" />
          全员消息
        </Button>
      </div>

      {/* Card wall */}
      {studentsLoading && !studentResp ? (
        <CardWallSkeleton />
      ) : !students.length ? (
        <div className="rounded-lg border bg-card py-16 text-center text-sm text-muted-foreground">
          <Users className="mx-auto mb-3 size-8 text-muted-foreground/40" />
          {queryDebounced || statusFilter.size
            ? '没有匹配当前筛选条件的学生。'
            : '此比赛暂无学生客户端会话接入。'}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {students.map((s) => (
            <StudentCard
              key={s.machineId}
              student={s}
              onClick={() => openStudent(s)}
              onDoubleClick={() => liveLaunch(s)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {studentResp && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-xs"
            disabled={page <= 1}
            onClick={() => { setPage((p) => Math.max(1, p - 1)); setPageInput(String(Math.max(1, page - 1))); }}
          >
            <ChevronLeft className="size-3.5" />
            上一页
          </Button>
          <span className="text-xs text-muted-foreground">
            第
            <input
              type="number"
              min={1}
              max={totalPages}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={() => {
                const n = Math.max(1, Math.min(totalPages, Number(pageInput) || 1));
                setPage(n);
                setPageInput(String(n));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              className="mx-1.5 inline-block w-12 rounded-md border border-input bg-background px-1.5 py-0.5 text-center text-xs"
            />
            / {totalPages}
            <span className="ml-2 text-muted-foreground">（{studentResp.total} 学生）</span>
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-xs"
            disabled={page >= totalPages}
            onClick={() => { setPage((p) => Math.min(totalPages, p + 1)); setPageInput(String(Math.min(totalPages, page + 1))); }}
          >
            下一页
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      )}

      {/* Secondary table view (legacy) */}
      {secondary && (
        <Card>
          <CardHeader className="px-5 pb-3 pt-5">
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <span>
                {secondary === 'sessions' && '会话表'}
                {secondary === 'approvals' && '审批表'}
                {secondary === 'events' && '事件表'}
              </span>
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setSecondary(null)}>
                <XCircle className="size-3" /> 关闭
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {secondary === 'sessions' && (
              sessionsQ.loading && !sessionsQ.data
                ? <SkeletonTable rows={5} cols={6} />
                : examSessions.length === 0
                  ? <EmptyTable message="此考试暂无会话。" icon={Layers} />
                  : <SessionsTable sessions={examSessions} proctorOjUserId={bs.user.id} onChanged={retrySecondary} />
            )}
            {secondary === 'approvals' && (
              approvalsQ.loading && !approvalsQ.data
                ? <SkeletonTable rows={4} cols={6} />
                : examApprovals.length === 0
                  ? <EmptyTable message="此考试暂无审批请求。" icon={Inbox} />
                  : <ApprovalsTable approvals={examApprovals} onChanged={() => approvalsQ.retry()} />
            )}
            {secondary === 'events' && (
              eventsQ.loading && !eventsQ.data
                ? <SkeletonTable rows={6} cols={6} />
                : examEvents.length === 0
                  ? <EmptyTable message="此考试暂无风险事件。" icon={Activity} />
                  : <EventTable events={examEvents} />
            )}
          </CardContent>
        </Card>
      )}

      {/* Right-side detail sheet */}
      <StudentDetailSheet
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        contestId={examId}
        student={selectedStudent}
        recordEnabled={selectedStudent?.recordEnabled ?? recordEnabled}
        newEventVersion={newEventVersion}
      />

      {/* Double-click direct live view (no drawer) */}
      {selectedStudent && (
        <LivePlayerDialog
          open={doubleClickLiveOpen}
          onOpenChange={setDoubleClickLiveOpen}
          contestId={examId}
          student={selectedStudent}
          recordEnabled={selectedStudent.recordEnabled ?? recordEnabled}
        />
      )}

      {/* Top-bar group message */}
      <GroupMessageInvoker
        open={groupMessageOpen}
        onOpenChange={setGroupMessageOpen}
        contestId={examId}
        counters={counters}
      />
    </AdminPage>
  );
}

/* ─── Small UI helpers used only by the new detail page ────────────────── */

type StatColor = 'emerald' | 'amber' | 'red' | 'neutral';
const STAT_COLOR_CLASSES: Record<StatColor, string> = {
  emerald: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  red: 'bg-red-500/10 text-red-700 dark:text-red-300',
  neutral: 'bg-muted/50 text-foreground',
};

function CompactStat({
  label, value, color, highlight,
}: {
  label: string;
  value: number;
  color: StatColor;
  highlight?: boolean;
}) {
  return (
    <div className={cn(
      'rounded-lg border px-4 py-2.5',
      STAT_COLOR_CLASSES[color],
      highlight && 'ring-2 ring-current/30',
    )}>
      <p className="text-[10px] uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function CardWallSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-lg border bg-card">
          <div className="aspect-video w-full animate-pulse bg-muted/40" />
          <div className="space-y-2 px-3 py-2.5">
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted/40" />
            <div className="h-2 w-1/2 animate-pulse rounded bg-muted/40" />
            <div className="h-2 w-3/4 animate-pulse rounded bg-muted/40" />
          </div>
        </div>
      ))}
    </div>
  );
}

function statusBadgeLabel(s: VigilStudentStatus): string {
  switch (s) {
    case 'online': return '在线';
    case 'anomaly': return '异常';
    case 'offline': return '离线';
    case 'disconnected': return '未连接';
    case 'locked': return '锁定';
    case 'ended': return '已结束';
  }
}

/** Thin wrapper so the group-message dialog can own its own useProctorCommands hook. */
function GroupMessageInvoker({
  open, onOpenChange, contestId, counters,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contestId: string;
  counters?: VigilStudentListResponse['counters'];
}) {
  const { sendCommand } = useProctorCommands({ contestId });
  return (
    <SendMessageDialog
      open={open}
      onOpenChange={onOpenChange}
      sendCommand={sendCommand}
      counters={counters && {
        total: counters.total,
        online: counters.online,
        anomaly: counters.anomaly,
      }}
    />
  );
}

/* ─── Shared tables ─────────────────────────────────────────────────── */

function SessionsTable({
  sessions, proctorOjUserId, onChanged,
}: { sessions: VigilExamSession[]; proctorOjUserId?: number; onChanged: () => void }) {
  const [invalidateTarget, setInvalidateTarget] = useState<VigilExamSession | null>(null);
  const [resetTarget, setResetTarget] = useState<VigilExamSession | null>(null);
  const [reason, setReason] = useState('监考老师作废本次客户端会话');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const submitInvalidate = async () => {
    if (!invalidateTarget) return;
    setBusy(true);
    try {
      await invalidateExamSession(invalidateTarget.id, reason, proctorOjUserId);
      setInvalidateTarget(null);
      onChanged();
    } catch (e: any) {
      setActionError(e?.message || '作废会话失败');
    } finally {
      setBusy(false);
    }
  };
  const submitResetFinish = async () => {
    if (!resetTarget) return;
    setBusy(true);
    try {
      await resetStudentFinishSession(resetTarget.id, proctorOjUserId);
      setResetTarget(null);
      onChanged();
    } catch (e: any) {
      setActionError(e?.message || '重置主动结束状态失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">会话 ID</TableHead>
            <TableHead>机器</TableHead>
            <TableHead>OJ 用户</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>开始</TableHead>
            <TableHead>结束</TableHead>
            <TableHead className="pr-5 text-right">操作</TableHead>
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
                {s.status === 'invalidated' && <Badge variant="secondary">已作废</Badge>}
                {s.status === 'student_finished' && <Badge variant="secondary">主动结束</Badge>}
              </TableCell>
              <TableCell className="text-xs"><VigilDateTime value={s.began_at} /></TableCell>
              <TableCell className="text-xs">{s.closed_at ? <VigilDateTime value={s.closed_at} /> : '—'}</TableCell>
              <TableCell className="pr-5 text-right">
                {s.status === 'active' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                    onClick={() => {
                      setReason('监考老师作废本次客户端会话');
                      setInvalidateTarget(s);
                    }}
                  >
                    <XCircle className="size-3.5" />作废会话
                  </Button>
                )}
                {s.status === 'student_finished' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    onClick={() => setResetTarget(s)}
                    disabled={busy}
                  >
                    <RefreshCw className="size-3.5" />允许重进
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!invalidateTarget} onOpenChange={(open) => {
        if (!open && !busy) setInvalidateTarget(null);
      }}>
        <DialogContent className="w-full sm:w-[520px]" onClose={() => !busy && setInvalidateTarget(null)}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="size-4 text-destructive" />作废客户端会话
            </DialogTitle>
          </DialogHeader>
          {invalidateTarget && (
            <form
              className="space-y-4 p-5"
              onSubmit={(event) => {
                event.preventDefault();
                submitInvalidate();
              }}
            >
              <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                <div>会话：<code>{invalidateTarget.id}</code></div>
                <div>机器：<code>{invalidateTarget.machine_id}</code></div>
                <div>OJ 用户：UID {invalidateTarget.oj_user_id}</div>
              </div>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">作废原因</span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
                />
              </label>
              <p className="text-xs text-muted-foreground">
                作废只关闭本次客户端会话并使启动链接失效，不会替学生提交答卷。
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setInvalidateTarget(null)} disabled={busy}>
                  取消
                </Button>
                <Button type="submit" variant="destructive" disabled={busy}>
                  确认作废
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetTarget} onOpenChange={(open) => {
        if (!open && !busy) setResetTarget(null);
      }}>
        <DialogContent className="w-full sm:w-[520px]" onClose={() => !busy && setResetTarget(null)}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="size-4 text-primary" />重置主动结束状态
            </DialogTitle>
          </DialogHeader>
          {resetTarget && (
            <form
              className="space-y-4 p-5"
              onSubmit={(event) => {
                event.preventDefault();
                submitResetFinish();
              }}
            >
              <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                <div>会话：<code>{resetTarget.id}</code></div>
                <div>机器：<code>{resetTarget.machine_id}</code></div>
                <div>OJ 用户：UID {resetTarget.oj_user_id}</div>
              </div>
              <p className="text-sm text-muted-foreground">
                重置后该考生可以重新通过客户端申请进入本场比赛/考试；不会恢复旧客户端会话。
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setResetTarget(null)} disabled={busy}>
                  取消
                </Button>
                <Button type="submit" disabled={busy}>
                  确认允许重进
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!actionError} onOpenChange={(open) => {
        if (!open) setActionError('');
      }}>
        <DialogContent className="w-full sm:w-[440px]" onClose={() => setActionError('')}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="size-4 text-destructive" />操作失败
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 p-5">
            <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {actionError || '操作失败'}
            </p>
            <div className="flex justify-end">
              <Button type="button" onClick={() => setActionError('')}>知道了</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ApprovalsTable({
  approvals, onChanged,
}: { approvals: VigilApproval[]; onChanged: () => void }) {
  const [approveTarget, setApproveTarget] = useState<VigilApproval | null>(null);
  const [rejectTarget, setRejectTarget] = useState<VigilApproval | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectReasonError, setRejectReasonError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  // Live updates via WS.
  useVigilSocket({
    onMessage: (msg) => {
      if (msg.type === 'approval_request' || msg.type === 'approval_resolved') onChanged();
    },
  });

  const approve = async (a: VigilApproval, asTemp: boolean) => {
    setBusy(true);
    try {
      await approveRequest(a.id, asTemp);
      setApproveTarget(null);
      onChanged();
    } catch (e: any) {
      setActionError(e?.message || '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const onApprove = async (a: VigilApproval) => {
    if (a.is_unknown) {
      setApproveTarget(a);
      return;
    }
    await approve(a, false);
  };
  const onReject = async (a: VigilApproval) => {
    setRejectTarget(a);
    setRejectReason('');
    setRejectReasonError('');
  };

  const submitReject = async () => {
    const reason = rejectReason.trim();
    if (!reason) {
      setRejectReasonError('请填写拒绝理由');
      return;
    }
    if (!rejectTarget) return;
    setBusy(true);
    try {
      await rejectRequest(rejectTarget.id, reason);
      setRejectTarget(null);
      onChanged();
    } catch (e: any) {
      setActionError(e?.message || '操作失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
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
              <TableCell className="text-xs"><VigilDateTime value={a.created_at} mode="both" /></TableCell>
              <TableCell className="pr-5 text-right">
                {a.status === 'pending' && (
                  <div className="inline-flex gap-1">
                    <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => onApprove(a)} disabled={busy}>
                      <CheckCircle className="size-3.5" />批准
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => onReject(a)} disabled={busy}>
                      <XCircle className="size-3.5" />拒绝
                    </Button>
                  </div>
                )}
              </TableCell>
            </motion.tr>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!approveTarget} onOpenChange={(open) => {
        if (!open && !busy) setApproveTarget(null);
      }}>
        <DialogContent className="w-full sm:w-[520px]" onClose={() => !busy && setApproveTarget(null)}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-amber-500" />未知考生审批
            </DialogTitle>
          </DialogHeader>
          {approveTarget && (
            <div className="space-y-4 p-5">
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="text-sm font-medium text-foreground">未在学号库中匹配到该考生</p>
                <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                  <span>学号：<code className="font-mono">{approveTarget.student_id_input}</code></span>
                  <span>姓名：{approveTarget.real_name_input || '—'}</span>
                  <span>机器：<code className="font-mono">{approveTarget.machine_id}</code></span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                可以直接批准本次登录，也可以批准并创建临时账号，便于后续追踪这名考生的会话。
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="ghost" onClick={() => setApproveTarget(null)} disabled={busy}>
                  取消
                </Button>
                <Button type="button" variant="outline" onClick={() => approve(approveTarget, false)} disabled={busy}>
                  直接批准
                </Button>
                <Button type="button" onClick={() => approve(approveTarget, true)} disabled={busy}>
                  创建临时账号并批准
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectTarget} onOpenChange={(open) => {
        if (!open && !busy) setRejectTarget(null);
      }}>
        <DialogContent className="w-full sm:w-[520px]" onClose={() => !busy && setRejectTarget(null)}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="size-4 text-destructive" />拒绝登录请求
            </DialogTitle>
          </DialogHeader>
          {rejectTarget && (
            <form
              className="space-y-4 p-5"
              onSubmit={(event) => {
                event.preventDefault();
                submitReject();
              }}
            >
              <div className="grid gap-1 text-xs text-muted-foreground">
                <span>学号：<code className="font-mono">{rejectTarget.student_id_input}</code></span>
                <span>姓名：{rejectTarget.real_name_input || '—'}</span>
                <span>机器：<code className="font-mono">{rejectTarget.machine_id}</code></span>
              </div>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">拒绝理由</span>
                <textarea
                  value={rejectReason}
                  onChange={(event) => {
                    setRejectReason(event.target.value);
                    if (rejectReasonError) setRejectReasonError('');
                  }}
                  className="min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
                  placeholder="例如：身份信息不匹配、未在考试名单中、请联系监考老师确认。"
                  autoFocus
                />
              </label>
              {rejectReasonError && (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {rejectReasonError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setRejectTarget(null)} disabled={busy}>
                  取消
                </Button>
                <Button type="submit" variant="destructive" disabled={busy}>
                  确认拒绝
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!actionError} onOpenChange={(open) => {
        if (!open) setActionError('');
      }}>
        <DialogContent className="w-full sm:w-[440px]" onClose={() => setActionError('')}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="size-4 text-destructive" />操作失败
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 p-5">
            <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {actionError || '操作失败'}
            </p>
            <div className="flex justify-end">
              <Button type="button" onClick={() => setActionError('')}>知道了</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
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
            <TableCell className="pl-5 text-xs"><VigilDateTime value={e.last_seen_at} mode="both" /></TableCell>
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
