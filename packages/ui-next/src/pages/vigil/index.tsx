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
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Film,
  Inbox,
  Layers,
  Megaphone,
  RefreshCw,
  ServerOff,
  ShieldAlert,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { PRIV } from '@/lib/perms';
import { AdminPage } from '@/components/admin/admin-page';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DateTime } from '@/components/ui/datetime';
import { Skeleton, Stat, StatusDot } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, SearchInput } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Checkbox } from '@/components/ui/checkbox';
import { SimpleSelect } from '@/components/ui/select';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';
import {
  approveRequest,
  fetchApprovals,
  fetchClients,
  fetchEvents,
  fetchExamSessions,
  invalidateExamSession,
  rejectRequest,
  VigilOfflineError,
  type VigilApproval,
  type VigilClient,
  resetStudentFinishSession,
  type VigilEvent,
  type VigilExamSession,
  listContestStudents,
  listContestRecordings,
  buildRecordingUrl,
  type VigilRecording,
  type RecordingDeleteScope,
  type VigilStudentCard as VigilStudentCardData,
  type VigilStudentListResponse,
  type VigilStudentStatus,
  isVigilAnomalySeverity,
} from '@/lib/vigil-api';
import { useVigilSocket, type ContestSubscription, type VigilEventMessage } from '@/hooks/use-vigil-socket';
import { useProctorCommands, notifyCommandResult } from '@/hooks/use-proctor-commands';
import { StudentCard } from '@/pages/vigil/student-card';
import { StudentDetailSheet } from '@/pages/vigil/student-detail-sheet';
import { LivePlayerDialog } from '@/pages/vigil/live-player-dialog';
import { MediaNodeBadge } from '@/pages/vigil/media-node-badge';
import { SendMessageDialog } from '@/pages/vigil/send-message-dialog';
import { VigilDateTime, parseVigilTimestamp } from '@/pages/vigil/timestamp';
import { cn } from '@/lib/cn';
import { parseVigilSortKey, type VigilSortKey as SortKey } from '@/pages/vigil/sort';
import { RecordingDeleteDialog } from '@/pages/vigil/recording-delete-dialog';

/* ─── Defensive UI primitives ─────────────────────────────────────────── */

function OfflineBanner({ err, onRetry }: { err: VigilOfflineError; onRetry: () => void }) {
  const [showDetail, setShowDetail] = useState(false);
  const reasonHints: Record<VigilOfflineError['reason'], string> = {
    not_configured:
      '反作弊服务地址尚未配置。请到系统设置 → 反作弊填写 vigil.baseUrl，保存后重启 hydrooj。',
    network: '反作弊服务无法访问 — 检查 KVS 服务器是否在线，以及网络连通性。',
    non_json: '反作弊服务返回了非预期的响应（可能是 URL 配置错误，请求被 OJ 兜底）。',
    token_failed:
      'OJ 端获取访问令牌失败。该令牌来自 Mongo system 键 vigil.dashboardToken，不是系统设置项。请检查该键以及 OJ 服务状态。',
    server_5xx: '反作弊服务返回 5xx — 服务端异常，请查看 KVS 日志。',
  };
  return (
    <Alert
      tone="warning"
      title="反作弊服务暂不可用"
      action={(
        <>
          <Button size="sm" variant="secondary" onClick={onRetry}>
            <RefreshCw /> 重试
          </Button>
          {err.detail ? (
            <Button size="sm" variant="ghost" onClick={() => setShowDetail((p) => !p)}>
              {showDetail ? <ChevronUp /> : <ChevronDown />}
              技术详情
            </Button>
          ) : null}
        </>
      )}
    >
      <p>{reasonHints[err.reason]}</p>
      {showDetail && err.detail ? (
        <pre className="mt-2 max-h-32 overflow-auto rounded-md border border-warning-line bg-warning-soft p-2 font-mono text-2xs text-warning-fg">
          {err.reason}: {err.detail}
        </pre>
      ) : null}
    </Alert>
  );
}

function EmptyTable({ message, icon: Icon }: { message: string; icon?: LucideIcon }) {
  const I = Icon || ServerOff;
  return <EmptyState compact icon={<I />} title={message} />;
}

function VigilQueryBody({
  query,
  failureTitle,
  skeletonRows,
  skeletonCols,
  isEmpty,
  emptyMessage,
  emptyIcon,
  children,
}: {
  query: {
    data: unknown;
    loading: boolean;
    offlineErr: VigilOfflineError | null;
    err: string | null;
    retry: () => void;
  };
  failureTitle: string;
  skeletonRows: number;
  skeletonCols: number;
  isEmpty: boolean;
  emptyMessage: string;
  emptyIcon: LucideIcon;
  children: ReactNode;
}) {
  if (query.loading && query.data == null) {
    return <SkeletonTable rows={skeletonRows} cols={skeletonCols} />;
  }
  const failed = Boolean(query.offlineErr || query.err);
  return (
    <>
      {query.offlineErr ? (
        <div className="p-4"><OfflineBanner err={query.offlineErr} onRetry={query.retry} /></div>
      ) : null}
      {query.err ? (
        <div className="p-4">
          <Alert
            tone="danger"
            title={`${failureTitle}：${query.err}`}
            action={<Button size="sm" variant="secondary" onClick={query.retry}>重试</Button>}
          />
        </div>
      ) : null}
      {query.data == null || (isEmpty && failed) ? null : isEmpty ? (
        <EmptyTable message={emptyMessage} icon={emptyIcon} />
      ) : children}
    </>
  );
}

function SkeletonTable({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: cols }).map((__, j) => (
            <Skeleton key={j} className="h-4" />
          ))}
        </div>
      ))}
    </div>
  );
}

function useVigilData<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[] = [],
  enabled = true,
): {
  data: T | null;
  loading: boolean;
  offlineErr: VigilOfflineError | null;
  err: string | null;
  retry: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [offlineErr, setOfflineErr] = useState<VigilOfflineError | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setLoading(true);
    setOfflineErr(null);
    setErr(null);
    loader()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setErr(null);
        setOfflineErr(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof VigilOfflineError) setOfflineErr(e);
        else setErr(e instanceof Error && e.message ? e.message : '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    const interval = setInterval(() => setReloadKey((k) => k + 1), 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [...deps, reloadKey, enabled]);
  return { data, loading, offlineErr, err, retry: () => setReloadKey((k) => k + 1) };
}

function vigilQueryMissing(query: { data: unknown; err: string | null; offlineErr: VigilOfflineError | null }): boolean {
  return query.data == null && Boolean(query.err || query.offlineErr);
}

function statValue(loading: boolean, value: ReactNode): ReactNode {
  if (loading) return <Skeleton className="h-8 w-12" />;
  return value;
}

function attentionCount(value: number, className: string): ReactNode {
  if (value <= 0) return value;
  return <span className={className}>{value}</span>;
}

function examRowProps(examId: string) {
  const open = () => {
    window.location.href = `/admin/vigil/exams/${encodeURIComponent(examId)}`;
  };
  return {
    role: 'link' as const,
    tabIndex: 0,
    className: 'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    onClick: open,
    onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open();
    },
  };
}

function SeverityBadge({ level }: { level: string }) {
  if (level === 'critical' || level === 'high') {
    return <Badge tone="danger" size="sm">{level}</Badge>;
  }
  if (level === 'medium' || level === 'warning') return <Badge tone="warning" variant="solid" size="sm">{level}</Badge>;
  return <Badge variant="outline" size="sm">{level}</Badge>;
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

function groupByExam(sessions: VigilExamSession[] | null, approvals: VigilApproval[] | null, events: VigilEvent[] | null): ExamGroup[] {
  const map = new Map<string, ExamGroup>();
  const ensure = (examId: string): ExamGroup => {
    if (!map.has(examId)) {
      map.set(examId, {
        examId,
        sessions: [],
        approvals: [],
        events: [],
        startedAt: null,
        endedAt: null,
        isActive: false,
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
function useContestNames(ids: string[]): { names: Map<string, string>; error: string | null; retry: () => void } {
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // Stable key so the effect only re-runs when the set of ids actually changes.
  const key = ids.slice().sort().join(',');
  useEffect(() => {
    if (!ids.length) {
      setNames(new Map());
      setError(null);
      return undefined;
    }
    let cancelled = false;
    // Hydro's @param('ids', Types.CommaSeperatedArray) reads only the first
    // value of repeated form keys, so we must send the ids comma-joined.
    const form = new URLSearchParams();
    form.set('ids', ids.join(','));
    fetchHydroResponse('/api/admin/vigil/resolve-contests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: form,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readHydroResponseError(response, '比赛标题解析失败'));
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('比赛标题解析失败');
        return body as Record<string, unknown>;
      })
      .then((map) => {
        if (cancelled) return;
        const next = new Map<string, string>();
        for (const [id, title] of Object.entries(map)) {
          if (typeof title === 'string' && title.length > 0) next.set(id, title);
        }
        setNames(next);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error && reason.message ? reason.message : '比赛标题解析失败');
      });
    return () => {
      cancelled = true;
    };
  }, [key, reload]);
  return { names, error, retry: () => setReload((current) => current + 1) };
}

function displayExam(id: string, names: Map<string, string>): string {
  return names.get(id) || id;
}

interface AllContestRow {
  domainId: string;
  examId: string;
  title: string;
  beginAt: string;
  endAt: string;
  rule: string;
  vigilEnabled: boolean;
}

interface AllContestsResponse {
  page: number;
  pageSize: number;
  total: number;
  items: AllContestRow[];
}

function VigilOverviewTabs({ value }: { value: 'overview' | 'all' }) {
  return (
    <MiniTabs
      value={value}
      items={[
        { value: 'overview', label: '监考总览', href: '/admin/vigil' },
        { value: 'all', label: '全部比赛', href: '/admin/vigil?view=all' },
      ]}
    />
  );
}

function AllContestsPage() {
  const initialUrl = useMemo(() => new URL(window.location.href), []);
  const [page, setPage] = useState(() => Math.max(1, Number(initialUrl.searchParams.get('page')) || 1));
  const [query, setQuery] = useState(initialUrl.searchParams.get('q') || '');
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [data, setData] = useState<AllContestsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'all');
    if (page > 1) url.searchParams.set('page', String(page));
    else url.searchParams.delete('page');
    if (debouncedQuery) url.searchParams.set('q', debouncedQuery);
    else url.searchParams.delete('q');
    window.history.replaceState(null, '', url.toString());

    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page) });
    if (debouncedQuery) params.set('q', debouncedQuery);
    setLoading(true);
    setError(null);
    fetchHydroResponse(`/api/admin/vigil/contests?${params}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readHydroResponseError(response, '加载比赛列表失败'));
        return await response.json() as AllContestsResponse;
      })
      .then((response) => {
        setData(response);
        setLoading(false);
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : '加载比赛列表失败');
        setLoading(false);
      });
    return () => controller.abort();
  }, [page, debouncedQuery, reload]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <AdminPage
      title="反作弊总览"
      requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
      description="浏览 OJ 中的全部比赛，进入现有监考详情查看会话与录像。"
      actions={<VigilOverviewTabs value="all" />}
      hideSidebar
    >
      <Panel
        flush
        title={`全部比赛${data ? `（${data.total}）` : ''}`}
        actions={(
          <SearchInput
            size="sm"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="搜索比赛标题"
            className="w-60 sm:w-72"
          />
        )}
      >
        {loading && !data ? (
          <SkeletonTable rows={8} cols={5} />
        ) : error ? (
          <div className="p-4">
            <Alert
              tone="danger"
              title={`比赛列表加载失败：${error}`}
              action={<Button size="sm" variant="secondary" onClick={() => setReload((current) => current + 1)}>重试</Button>}
            />
          </div>
        ) : !data?.items.length ? (
          <EmptyTable message={debouncedQuery ? '没有匹配的比赛。' : '暂无比赛。'} icon={Inbox} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>比赛</TableHead>
                <TableHead>开始时间</TableHead>
                <TableHead>结束时间</TableHead>
                <TableHead className="w-24">赛制</TableHead>
                <TableHead className="w-24">监考</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((contest) => (
                <TableRow key={contest.examId} {...examRowProps(contest.examId)}>
                  <TableCell>
                    <p className="truncate font-medium">{contest.title}</p>
                    <p className="truncate font-mono text-2xs text-fg-subtle">{contest.examId}</p>
                  </TableCell>
                  <TableCell className="text-xs text-fg-subtle"><DateTime value={new Date(contest.beginAt)} /></TableCell>
                  <TableCell className="text-xs text-fg-subtle"><DateTime value={new Date(contest.endAt)} /></TableCell>
                  <TableCell><Badge variant="outline" size="sm">{contest.rule || '—'}</Badge></TableCell>
                  <TableCell>
                    <Badge tone={contest.vigilEnabled ? 'success' : 'neutral'} size="sm">
                      {contest.vigilEnabled ? '已启用' : '未启用'}
                    </Badge>
                  </TableCell>
                  <TableCell><ChevronRight className="size-3.5 text-fg-subtle" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
      {data && data.total > data.pageSize ? (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button size="sm" variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            <ChevronLeft />上一页
          </Button>
          <span className="text-xs text-fg-subtle tabular">第 {page} / {totalPages} 页</span>
          <Button size="sm" variant="secondary" disabled={page >= totalPages || loading} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
            下一页<ChevronRight />
          </Button>
        </div>
      ) : null}
    </AdminPage>
  );
}

export function AdminVigilOverviewPage() {
  const view = new URL(window.location.href).searchParams.get('view');
  return view === 'all' ? <AllContestsPage /> : <VigilLiveOverviewPage />;
}

function VigilLiveOverviewPage() {
  const bs = useBootstrap();
  const localContests = (bs.page.data as { activeVigilContests?: LocalVigilContest[] }).activeVigilContests || [];
  const clientsQ = useVigilData<VigilClient[]>(() => fetchClients());
  const sessionsQ = useVigilData<VigilExamSession[]>(() => fetchExamSessions());
  const approvalsQ = useVigilData<VigilApproval[]>(() => fetchApprovals());
  const eventsQ = useVigilData<VigilEvent[]>(() => fetchEvents({ limit: '200' }));

  const offline = clientsQ.offlineErr || sessionsQ.offlineErr || approvalsQ.offlineErr || eventsQ.offlineErr;
  const pendingApprovals = approvalsQ.data?.filter((a) => a.status === 'pending') || [];
  const activeSessions = sessionsQ.data?.filter((s) => s.status === 'active') || [];

  const groups = useMemo(
    () => mergeLocalVigilContests(groupByExam(sessionsQ.data, approvalsQ.data, eventsQ.data), localContests),
    [sessionsQ.data, approvalsQ.data, eventsQ.data, localContests],
  );
  const examIds = useMemo(() => groups.filter((g) => !g.localContest?.title).map((g) => g.examId), [groups]);
  const contestNames = useContestNames(examIds);
  const names = contestNames.names;
  const active = groups.filter((g) => g.isActive);
  const ended = groups.filter((g) => !g.isActive);
  const nameFor = (g: ExamGroup) => g.localContest?.title || displayExam(g.examId, names);

  const retryAll = () => {
    clientsQ.retry();
    sessionsQ.retry();
    approvalsQ.retry();
    eventsQ.retry();
  };
  const vigilListErr = sessionsQ.err || approvalsQ.err || eventsQ.err;
  const vigilListsFailed = vigilQueryMissing(sessionsQ) || vigilQueryMissing(approvalsQ) || vigilQueryMissing(eventsQ);
  const listsSettling = !offline && !vigilListErr && [sessionsQ, approvalsQ, eventsQ].some((query) => query.loading && !query.data);

  return (
    <AdminPage
      title="反作弊总览"
      requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
      description="按考试聚合的会话 / 审批 / 事件。点击具体考试查看详情。"
      actions={<VigilOverviewTabs value="overview" />}
      hideSidebar
    >
      {offline && <OfflineBanner err={offline} onRetry={retryAll} />}
      {vigilListErr ? (
        <Alert
          tone="danger"
          title={`监考数据加载失败：${vigilListErr}`}
          action={<Button size="sm" variant="secondary" onClick={retryAll}>重试</Button>}
        />
      ) : null}
      {clientsQ.err && !offline ? (
        <Alert
          tone="danger"
          title={`在线客户端加载失败：${clientsQ.err}`}
          action={<Button size="sm" variant="secondary" onClick={clientsQ.retry}>重试</Button>}
        />
      ) : null}
      {contestNames.error ? (
        <Alert
          tone="danger"
          title={`比赛标题解析失败：${contestNames.error}`}
          action={<Button size="sm" variant="secondary" onClick={contestNames.retry}>重试</Button>}
        />
      ) : null}

      <Panel>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
          <Stat label="在线客户端" value={statValue(clientsQ.loading && !clientsQ.data && !offline, clientsQ.data?.length ?? '—')} />
          <Stat
            label="进行中会话"
            value={statValue(sessionsQ.loading && !sessionsQ.data && !offline, sessionsQ.data ? activeSessions.length : '—')}
          />
          <Stat
            label="待审批"
            value={statValue(
              approvalsQ.loading && !approvalsQ.data && !offline,
              approvalsQ.data ? attentionCount(pendingApprovals.length, 'text-warning-fg') : '—',
            )}
          />
          <Stat label="今日事件" value={statValue(eventsQ.loading && !eventsQ.data && !offline, eventsQ.data?.length ?? '—')} />
        </div>
      </Panel>

      {listsSettling ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-fg">进行中</h2>
          <SkeletonTable rows={2} cols={4} />
        </div>
      ) : active.length === 0 && vigilListsFailed ? null : (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-fg">进行中（{active.length}）</h2>
          {active.length === 0 ? (
            <Panel>
              <EmptyState compact title="没有进行中的考试。" />
            </Panel>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {active.map((g) => (
                <ExamGroupLink key={g.examId} group={g} active name={nameFor(g)} />
              ))}
            </div>
          )}
        </div>
      )}

      {listsSettling ? (
        <Panel flush title="已结束">
          <SkeletonTable rows={2} cols={4} />
        </Panel>
      ) : ended.length === 0 && vigilListsFailed ? null : (
      <Panel flush title={`已结束（${ended.length}）`}>
        {ended.length === 0 ? (
          <EmptyState compact title="无历史考试记录。" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>考试</TableHead>
                <TableHead className="w-24 text-right">会话数</TableHead>
                <TableHead className="w-24 text-right">审批数</TableHead>
                <TableHead className="w-24 text-right">事件数</TableHead>
                <TableHead>开始时间</TableHead>
                <TableHead>结束时间</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {ended.map((g) => {
                const name = nameFor(g);
                const hasName = name !== g.examId;
                return (
                  <TableRow key={g.examId} {...examRowProps(g.examId)}>
                    <TableCell>
                      <p className={cn('truncate text-sm', hasName && 'font-medium')}>{name}</p>
                      {hasName && <p className="truncate font-mono text-2xs text-fg-subtle">{g.examId}</p>}
                    </TableCell>
                    <TableCell className="text-right tabular">{g.sessions.length}</TableCell>
                    <TableCell className="text-right tabular">{g.approvals.length}</TableCell>
                    <TableCell className="text-right tabular">{g.events.length}</TableCell>
                    <TableCell className="text-xs text-fg-subtle">{g.startedAt ? <DateTime value={g.startedAt} /> : '—'}</TableCell>
                    <TableCell className="text-xs text-fg-subtle">{g.endedAt ? <DateTime value={g.endedAt} /> : '—'}</TableCell>
                    <TableCell>
                      <ChevronRight className="size-3.5 text-fg-subtle" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Panel>
      )}
    </AdminPage>
  );
}

function ExamGroupLink({ group, active, name }: { group: ExamGroup; active?: boolean; name: string }) {
  const pending = group.approvals.filter((a) => a.status === 'pending').length;
  const recentEvents = group.events.length;
  const hasName = name !== group.examId;
  const waitingForClient = !!group.localContest && group.sessions.length === 0;
  return (
    <a
      href={`/admin/vigil/exams/${encodeURIComponent(group.examId)}`}
      className="block min-w-0 rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Panel as="div" className="h-full transition-[box-shadow] duration-(--dur-1) ease-(--ease-out) hover:shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={cn('truncate text-sm text-fg', hasName && 'font-semibold')}>{name}</p>
            {hasName && <p className="truncate font-mono text-2xs text-fg-subtle">{group.examId}</p>}
          </div>
          {active ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-success-fg">
              <StatusDot tone="success" pulse />
              进行中
            </span>
          ) : null}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="会话" value={group.sessions.length} />
          <Stat label="待审批" value={attentionCount(pending, 'text-warning-fg')} />
          <Stat label="事件" value={recentEvents} />
        </div>
        {group.startedAt && (
          <p className="mt-3 text-2xs text-fg-subtle">
            开始 <VigilDateTime value={group.startedAt} mode="datetime" />
          </p>
        )}
        {waitingForClient && (
          <p className="mt-2 rounded-md bg-surface-sunken px-2 py-1 text-2xs text-fg-subtle">OJ 已开启 Vigil，等待客户端会话接入</p>
        )}
      </Panel>
    </a>
  );
}

function formatRecordingBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
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
 * Secondary views (会话 / 审批 / 事件 / 录像) are accessed via a "更多视图"
 * dropdown so the card wall stays the primary surface.
 */
type SecondaryView = 'sessions' | 'approvals' | 'events' | 'recordings';

type StatusFilter = '' | VigilStudentStatus;
const ALL_STATUSES: VigilStudentStatus[] = ['online', 'anomaly', 'offline', 'disconnected', 'locked', 'ended'];
const PAGE_SIZE = 30;
const CARD_WALL_GRID_CLASS = 'grid w-full min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-6';

export function AdminVigilExamDetailPage() {
  const bs = useBootstrap();
  const examId = String((bs.page.data as { examId?: unknown }).examId || '');
  const examTitle = (bs.page.data as { examTitle?: string | null }).examTitle;
  // Contest config — needed for live-player URL + record-enabled UI gates.
  // Hydro injects this via page.data; the student list carries the same field
  // as a fallback for older OJ pages that did not expose it yet.
  const pageRecordEnabled: unknown = (bs.page.data as { recordEnabled?: unknown }).recordEnabled;

  // ─── Toolbar state (URL-aware so refresh keeps the user's filter) ───
  const initialUrl = useMemo(() => new URL(window.location.href), []);
  const [page, setPage] = useState(() => Math.max(1, Number(initialUrl.searchParams.get('page')) || 1));
  const [pageInput, setPageInput] = useState(String(page));
  const pageRef = useRef(page);
  const showStudentPage = (next: number) => {
    const clamped = Math.max(1, next);
    pageRef.current = clamped;
    setPage(clamped);
    setPageInput(String(clamped));
  };
  const resetStudentPage = () => showStudentPage(1);
  const [query, setQuery] = useState(initialUrl.searchParams.get('q') || '');
  const [queryDebounced, setQueryDebounced] = useState(query);
  const [statusFilter, setStatusFilter] = useState<Set<StatusFilter>>(() => {
    const raw = initialUrl.searchParams.get('status') || '';
    return new Set(raw.split(',').filter(Boolean) as VigilStudentStatus[]);
  });
  const [sortKey, setSortKey] = useState<SortKey>(() => parseVigilSortKey(initialUrl.searchParams.get('sort')));
  const [secondary, setSecondary] = useState<SecondaryView | null>(null);
  const [groupMessageOpen, setGroupMessageOpen] = useState(false);
  const [recordingDeleteScope, setRecordingDeleteScope] = useState<RecordingDeleteScope | null>(null);

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
    if (sortKey !== 'student_id') url.searchParams.set('sort', sortKey);
    else url.searchParams.delete('sort');
    window.history.replaceState(null, '', url.toString());
  }, [page, queryDebounced, statusFilter, sortKey]);

  // ─── Student list (server-side paged) ───
  const [studentResp, setStudentResp] = useState<VigilStudentListResponse | null>(null);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentErr, setStudentErr] = useState<string | null>(null);
  const [offlineErr, setOfflineErr] = useState<VigilOfflineError | null>(null);
  const [reloadVer, setReloadVer] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStudentsLoading(true);
    setOfflineErr(null);
    setStudentErr(null);
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
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof VigilOfflineError) setOfflineErr(e);
        else setStudentErr(e instanceof Error && e.message ? e.message : '加载学生列表失败');
        setStudentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
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
  const recordEnabled = typeof pageRecordEnabled === 'boolean' ? pageRecordEnabled : students.some((s) => s.recordEnabled === true);

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
  const machineIdsOnPage = useMemo(() => (machineIdsKey ? machineIdsKey.split(',') : []), [machineIdsKey]);

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

  const handleWsMessage = useCallback(
    (msg: VigilEventMessage) => {
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
          const nextCounters = { ...prev.counters };
          if (idx >= 0) {
            const oldStatus = prev.items[idx].status;
            if (oldStatus !== msg.status) {
              nextCounters[oldStatus] = Math.max(0, (nextCounters[oldStatus] || 0) - 1);
              nextCounters[msg.status] = (nextCounters[msg.status] || 0) + 1;
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
            return { ...prev, items, counters: nextCounters };
          }
          // Unknown machineId: either off-page (counters only) or a brand-new
          // ExamSession that arrived after our last fetch. session_opened is
          // the primary trigger; this is a belt-and-suspenders fallback in
          // case that message races / is dropped during a WS reconnect.
          queueStudentsReload();
          return { ...prev, counters: nextCounters };
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
        if (isVigilAnomalySeverity(msg.severity)) {
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
    },
    [examId, selectedStudent, queueStudentsReload],
  );

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
  const recordingsQ = useVigilData<VigilRecording[]>(
    () => listContestRecordings(examId),
    [examId],
    secondary === 'recordings',
  );
  const examSessions = useMemo(() => (sessionsQ.data || []).filter((s) => s.oj_contest_id === examId), [sessionsQ.data, examId]);
  const examApprovals = useMemo(() => (approvalsQ.data || []).filter((a) => a.oj_contest_id === examId), [approvalsQ.data, examId]);
  const examEvents = useMemo(() => {
    const sessIds = new Set(examSessions.map((s) => s.id));
    return (eventsQ.data || []).filter((e) => e.exam_session_id && sessIds.has(e.exam_session_id));
  }, [eventsQ.data, examSessions]);
  const pendingCount = examApprovals.filter((a) => a.status === 'pending').length;
  const retrySecondary = () => {
    sessionsQ.retry();
    approvalsQ.retry();
    eventsQ.retry();
    if (secondary === 'recordings') recordingsQ.retry();
  };
  const retryStudents = () => setReloadVer((v) => v + 1);

  return (
    <AdminPage
      title={`反作弊 · ${examTitle || examId}`}
      requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
      hideSidebar
      description={examTitle ? <span className="font-mono text-2xs text-fg-subtle">{examId}</span> : undefined}
      actions={
        <div className="flex items-center gap-2">
          <MediaNodeBadge />
          <Button variant="ghost" asChild>
            <a href="/admin/vigil">返回总览</a>
          </Button>
        </div>
      }
    >
      {offline && <OfflineBanner err={offline} onRetry={retryStudents} />}

      <Panel>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="已连接" value={studentResp ? (counters?.online ?? 0) + (counters?.locked ?? 0) : '—'} />
          <Stat label="异常" value={studentResp ? attentionCount(counters?.anomaly ?? 0, 'text-warning-fg') : '—'} />
          <Stat label="离线" value={studentResp ? attentionCount(counters?.offline ?? 0, 'text-danger-fg') : '—'} />
          <Stat label="已结束" value={studentResp ? (counters?.ended ?? 0) : '—'} />
          <Stat label="待审批" value={approvalsQ.data ? attentionCount(pendingCount, 'text-warning-fg') : '—'} />
          <Stat label="总人数" value={studentResp ? (counters?.total ?? 0) : '—'} />
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-fg-subtle">状态</span>
          {ALL_STATUSES.map((st) => (
            <label
              key={st}
              className={cn(
                'flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-0.5 text-2xs transition-colors duration-(--dur-1) ease-(--ease-out)',
                statusFilter.has(st) ? 'border-brand bg-brand-soft text-brand-fg' : 'border-line-strong text-fg-subtle hover:bg-surface-hover',
              )}
            >
              <Checkbox
                size="sm"
                checked={statusFilter.has(st)}
                onCheckedChange={(c) => {
                  setStatusFilter((prev) => {
                    const next = new Set(prev);
                    if (c) next.add(st);
                    else next.delete(st);
                    return next;
                  });
                  resetStudentPage();
                }}
              />
              {statusBadgeLabel(st)}
            </label>
          ))}
        </div>

        <div className="w-full min-w-0 sm:w-72">
          <SearchInput
            size="sm"
            placeholder="搜索学号 / 姓名"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              resetStudentPage();
            }}
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-subtle">排序</span>
          <SimpleSelect
            size="sm"
            className="w-40"
            value={sortKey}
            onValueChange={(v) => {
              setSortKey(v as SortKey);
              resetStudentPage();
            }}
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
          key={secondary ?? 'none'}
          size="sm"
          className="w-32"
          value={secondary ?? undefined}
          onValueChange={(v) => setSecondary(v ? (v as SecondaryView) : null)}
          placeholder="更多视图"
          ariaLabel="更多视图"
          options={[
            ...(secondary ? [{ value: '', label: '关闭辅助视图' }] : []),
            { value: 'sessions', label: '会话表' },
            { value: 'approvals', label: '审批表' },
            { value: 'events', label: '事件表' },
            { value: 'recordings', label: '录像' },
          ]}
        />

        <Button size="sm" variant="primary" className="ml-auto" onClick={() => setGroupMessageOpen(true)}>
          <Megaphone />
          全员消息
        </Button>
      </div>

      {studentErr ? (
        <Alert
          tone="danger"
          title={`学生列表加载失败：${studentErr}`}
          action={<Button size="sm" variant="secondary" onClick={retryStudents}>重试</Button>}
        />
      ) : null}
      {approvalsQ.offlineErr ? <OfflineBanner err={approvalsQ.offlineErr} onRetry={approvalsQ.retry} /> : null}
      {approvalsQ.err ? (
        <Alert
          tone="danger"
          title={`审批列表加载失败：${approvalsQ.err}`}
          action={<Button size="sm" variant="secondary" onClick={approvalsQ.retry}>重试</Button>}
        />
      ) : null}
      {studentsLoading && !studentResp ? (
        <CardWallSkeleton />
      ) : (offline || studentErr) && !studentResp ? null : !students.length ? (
        <Panel>
          <EmptyState
            icon={<Users />}
            title={queryDebounced || statusFilter.size ? '没有匹配当前筛选条件的学生。' : '此比赛暂无学生客户端会话接入。'}
          />
        </Panel>
      ) : (
        <div className={CARD_WALL_GRID_CLASS}>
          {students.map((s) => (
            <div key={s.machineId} className="w-full min-w-0 [&>button]:w-full [&>button]:min-w-0">
              <StudentCard student={s} onClick={() => openStudent(s)} onDoubleClick={() => liveLaunch(s)} />
            </div>
          ))}
        </div>
      )}

      {studentResp && totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => showStudentPage(pageRef.current - 1)}
          >
            <ChevronLeft />
            上一页
          </Button>
          <span className="text-xs text-fg-subtle">
            第
            <Input
              type="number"
              size="sm"
              min={1}
              max={totalPages}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={() => {
                showStudentPage(Math.min(totalPages, Number(pageInput) || 1));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
              }}
              className="mx-1.5 inline-block w-20 text-center"
            />
            / {totalPages}
            <span className="ml-2 text-fg-subtle tabular">（{studentResp.total} 学生）</span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => showStudentPage(Math.min(totalPages, pageRef.current + 1))}
          >
            下一页
            <ChevronRight />
          </Button>
        </div>
      )}

      {secondary && (
        <Panel
          flush
          title={
            secondary === 'sessions' ? '会话表'
              : secondary === 'approvals' ? '审批表'
                : secondary === 'events' ? '事件表'
                  : '录像'
          }
          actions={(
            <>
              {secondary === 'recordings' ? (
                <Button size="sm" variant="danger-soft" onClick={() => setRecordingDeleteScope({ cid: examId })}>
                  <Trash2 />删除整场录像
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setSecondary(null)}>
                <XCircle /> 关闭
              </Button>
            </>
          )}
        >
          {secondary === 'sessions' && (
            <VigilQueryBody
              query={sessionsQ}
              failureTitle="会话加载失败"
              skeletonRows={5}
              skeletonCols={6}
              isEmpty={examSessions.length === 0}
              emptyMessage="此考试暂无会话。"
              emptyIcon={Layers}
            >
              <SessionsTable sessions={examSessions} proctorOjUserId={bs.user.id} onChanged={retrySecondary} />
            </VigilQueryBody>
          )}
          {secondary === 'approvals' && (
            <VigilQueryBody
              query={approvalsQ}
              failureTitle="审批列表加载失败"
              skeletonRows={4}
              skeletonCols={6}
              isEmpty={examApprovals.length === 0}
              emptyMessage="此考试暂无审批请求。"
              emptyIcon={Inbox}
            >
              <ApprovalsTable approvals={examApprovals} onChanged={() => approvalsQ.retry()} />
            </VigilQueryBody>
          )}
          {secondary === 'events' && (
            <VigilQueryBody
              query={eventsQ}
              failureTitle="事件加载失败"
              skeletonRows={6}
              skeletonCols={6}
              isEmpty={examEvents.length === 0}
              emptyMessage="此考试暂无风险事件。"
              emptyIcon={Activity}
            >
              <EventTable events={examEvents} />
            </VigilQueryBody>
          )}
          {secondary === 'recordings' &&
            (recordingsQ.loading && !recordingsQ.data ? (
              <SkeletonTable rows={5} cols={5} />
            ) : (
              <>
              {recordingsQ.offlineErr ? (
                <div className="p-4"><OfflineBanner err={recordingsQ.offlineErr} onRetry={recordingsQ.retry} /></div>
              ) : null}
              {recordingsQ.err ? (
                <div className="p-4">
                  <Alert
                    tone="danger"
                    title={`录像加载失败：${recordingsQ.err}`}
                    action={<Button size="sm" variant="secondary" onClick={recordingsQ.retry}>重试</Button>}
                  />
                </div>
              ) : null}
              {recordingsQ.data && recordingsQ.data.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>机器</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>开始时间</TableHead>
                    <TableHead className="text-right">大小</TableHead>
                    <TableHead className="w-48" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recordingsQ.data.map((recording) => (
                    <TableRow key={recording.recordingId}>
                      <TableCell className="font-mono text-xs">{recording.machineId}</TableCell>
                      <TableCell><Badge variant="outline" size="sm">{recording.streamType === 'screen' ? '屏幕' : '摄像头'}</Badge></TableCell>
                      <TableCell className="text-xs text-fg-subtle"><VigilDateTime value={recording.startTs} mode="datetime" /></TableCell>
                      <TableCell className="text-right text-xs tabular">{formatRecordingBytes(recording.size)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button asChild size="sm" variant="secondary">
                            <a href={buildRecordingUrl(recording.filename)} target="_blank" rel="noreferrer">播放</a>
                          </Button>
                          {(recording.uid || recording.examSessionId) ? (
                            <Button
                              size="sm"
                              variant="danger-soft"
                              onClick={() => setRecordingDeleteScope({
                                cid: examId,
                                ...(recording.uid ? { ojUserId: recording.uid } : { examSessionId: recording.examSessionId! }),
                              })}
                            >删该生</Button>
                          ) : null}
                          <Button size="sm" variant="danger-soft" onClick={() => setRecordingDeleteScope({ cid: examId, recordingId: recording.recordingId })}>
                            删本段
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              ) : recordingsQ.err || recordingsQ.offlineErr ? null : (
                <EmptyTable message="此比赛暂无录像。" icon={Film} />
              )}
              </>
            ))}
        </Panel>
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

      {recordingDeleteScope ? (
        <RecordingDeleteDialog
          open
          onOpenChange={(next) => {
            if (!next) setRecordingDeleteScope(null);
          }}
          scope={recordingDeleteScope}
          onDeleted={() => recordingsQ.retry()}
        />
      ) : null}

      {/* Top-bar group message */}
      <GroupMessageInvoker open={groupMessageOpen} onOpenChange={setGroupMessageOpen} contestId={examId} counters={counters} />
    </AdminPage>
  );
}

/* ─── Small UI helpers used only by the new detail page ────────────────── */

function CardWallSkeleton() {
  return (
    <div className={CARD_WALL_GRID_CLASS}>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="w-full min-w-0 overflow-hidden rounded-lg border border-line bg-surface">
          <Skeleton className="aspect-video w-full rounded-none" />
          <div className="flex flex-col gap-2 px-3 py-2.5">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2 w-1/2" />
            <Skeleton className="h-2 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function statusBadgeLabel(s: VigilStudentStatus): string {
  switch (s) {
    case 'online':
      return '在线';
    case 'anomaly':
      return '异常';
    case 'offline':
      return '离线';
    case 'disconnected':
      return '未连接';
    case 'locked':
      return '锁定';
    case 'ended':
      return '已结束';
  }
}

/** Thin wrapper so the group-message dialog can own its own useProctorCommands hook. */
function GroupMessageInvoker({
  open,
  onOpenChange,
  contestId,
  counters,
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
      counters={
        counters && {
          total: counters.total,
          online: counters.online,
          anomaly: counters.anomaly,
        }
      }
    />
  );
}

/* ─── Shared tables ─────────────────────────────────────────────────── */

function SessionsTable({ sessions, proctorOjUserId, onChanged }: { sessions: VigilExamSession[]; proctorOjUserId?: number; onChanged: () => void }) {
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
    } catch (e) {
      setActionError(e instanceof Error && e.message ? e.message : '作废会话失败');
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
    } catch (e) {
      setActionError(e instanceof Error && e.message ? e.message : '重置主动结束状态失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>会话 ID</TableHead>
            <TableHead>机器</TableHead>
            <TableHead>OJ 用户</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>开始</TableHead>
            <TableHead>结束</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-mono text-xs">{s.id.slice(0, 16)}…</TableCell>
              <TableCell className="font-mono text-xs">{s.machine_id.slice(0, 12)}…</TableCell>
              <TableCell>
                UID {s.oj_user_id}
                {s.is_temporary_user && (
                  <Badge variant="outline" size="sm" className="ml-1.5">
                    临时
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                {s.status === 'active' && <Badge tone="success" size="sm">进行中</Badge>}
                {s.status === 'closed' && <Badge size="sm">已结束</Badge>}
                {s.status === 'transferred' && <Badge variant="outline" size="sm">已转移</Badge>}
                {s.status === 'force_closed' && <Badge tone="danger" size="sm">强制关闭</Badge>}
                {s.status === 'invalidated' && <Badge size="sm">已作废</Badge>}
                {s.status === 'student_finished' && <Badge size="sm">主动结束</Badge>}
              </TableCell>
              <TableCell className="text-xs text-fg-subtle">
                <VigilDateTime value={s.began_at} />
              </TableCell>
              <TableCell className="text-xs text-fg-subtle">{s.closed_at ? <VigilDateTime value={s.closed_at} /> : '—'}</TableCell>
              <TableCell className="text-right">
                {s.status === 'active' && (
                  <Button
                    size="sm"
                    variant="danger-soft"
                    onClick={() => {
                      setReason('监考老师作废本次客户端会话');
                      setInvalidateTarget(s);
                    }}
                  >
                    <XCircle />
                    作废会话
                  </Button>
                )}
                {s.status === 'student_finished' && (
                  <Button size="sm" variant="secondary" onClick={() => setResetTarget(s)} disabled={busy}>
                    <RefreshCw />
                    允许重进
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog
        open={!!invalidateTarget}
        onOpenChange={(open) => {
          if (!open && !busy) setInvalidateTarget(null);
        }}
      >
        <DialogContent size="md" onClose={() => !busy && setInvalidateTarget(null)}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="size-4 text-danger-fg" />
              {invalidateTarget ? `作废 UID ${invalidateTarget.oj_user_id} 的会话？` : '作废会话？'}
            </DialogTitle>
          </DialogHeader>
          {invalidateTarget && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitInvalidate();
              }}
            >
              <DialogBody className="flex flex-col gap-4">
              <div className="rounded-md border border-line bg-surface-sunken p-3 text-xs text-fg-subtle">
                <div>
                  会话：<code className="font-mono">{invalidateTarget.id}</code>
                </div>
                <div>
                  机器：<code className="font-mono">{invalidateTarget.machine_id}</code>
                </div>
                <div>OJ 用户：UID {invalidateTarget.oj_user_id}</div>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">作废原因</span>
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <p className="text-xs text-fg-subtle">作废只关闭本次客户端会话并使启动链接失效，不会替学生提交答卷。</p>
              </DialogBody>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setInvalidateTarget(null)} disabled={busy}>
                  取消
                </Button>
                <Button type="submit" variant="danger" disabled={busy}>
                  作废
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!resetTarget}
        onOpenChange={(open) => {
          if (!open && !busy) setResetTarget(null);
        }}
      >
        <DialogContent size="md" onClose={() => !busy && setResetTarget(null)}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="size-4 text-brand-fg" />
              {resetTarget ? `允许 UID ${resetTarget.oj_user_id} 重新进入？` : '允许重新进入？'}
            </DialogTitle>
          </DialogHeader>
          {resetTarget && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitResetFinish();
              }}
            >
              <DialogBody className="flex flex-col gap-4">
              <div className="rounded-md border border-line bg-surface-sunken p-3 text-xs text-fg-subtle">
                <div>
                  会话：<code className="font-mono">{resetTarget.id}</code>
                </div>
                <div>
                  机器：<code className="font-mono">{resetTarget.machine_id}</code>
                </div>
                <div>OJ 用户：UID {resetTarget.oj_user_id}</div>
              </div>
              <p className="text-sm text-fg-muted">重置后该考生可以重新通过客户端申请进入本场比赛/考试；不会恢复旧客户端会话。</p>
              </DialogBody>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setResetTarget(null)} disabled={busy}>
                  取消
                </Button>
                <Button type="submit" variant="primary" disabled={busy}>
                  允许重进
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!actionError}
        onOpenChange={(open) => {
          if (!open) setActionError('');
        }}
      >
        <DialogContent size="sm" onClose={() => setActionError('')}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="size-4 text-danger-fg" />
              操作失败
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger-fg">{actionError || '操作失败'}</p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="primary" onClick={() => setActionError('')}>
              知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ApprovalsTable({ approvals, onChanged }: { approvals: VigilApproval[]; onChanged: () => void }) {
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
    } catch (e) {
      setActionError(e instanceof Error && e.message ? e.message : '操作失败');
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
    } catch (e) {
      setActionError(e instanceof Error && e.message ? e.message : '操作失败');
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
            <TableRow key={a.id} className={a.is_unknown ? 'bg-warning-soft' : undefined}>
              <TableCell className="font-mono text-sm">{a.student_id_input}</TableCell>
              <TableCell>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate">{a.real_name_input}</span>
                  {a.is_unknown && (
                    <Badge tone="danger" size="sm" className="shrink-0">
                      未知考生
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="font-mono text-xs">{a.machine_id.slice(0, 12)}…</TableCell>
              <TableCell>
                <Badge tone={a.status === 'pending' ? 'brand' : 'neutral'} variant={a.status === 'pending' ? 'soft' : 'outline'} size="sm">{a.status}</Badge>
              </TableCell>
              <TableCell className="text-xs text-fg-subtle">
                <VigilDateTime value={a.created_at} mode="both" />
              </TableCell>
              <TableCell className="text-right">
                {a.status === 'pending' && (
                  <div className="inline-flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => onApprove(a)} disabled={busy}>
                      <CheckCircle />
                      批准
                    </Button>
                    <Button size="sm" variant="danger-soft" onClick={() => onReject(a)} disabled={busy}>
                      <XCircle />
                      拒绝
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog
        open={!!approveTarget}
        onOpenChange={(open) => {
          if (!open && !busy) setApproveTarget(null);
        }}
      >
        <DialogContent size="md" onClose={() => !busy && setApproveTarget(null)}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-warning-fg" />
              未知考生审批
            </DialogTitle>
          </DialogHeader>
          {approveTarget ? (
              <DialogBody className="flex flex-col gap-4">
              <div className="rounded-md border border-warning-line bg-warning-soft p-3">
                <p className="text-sm font-medium text-fg">未在学号库中匹配到该考生</p>
                <div className="mt-2 grid gap-1 text-xs text-fg-subtle">
                  <span>
                    学号：<code className="font-mono">{approveTarget.student_id_input}</code>
                  </span>
                  <span>姓名：{approveTarget.real_name_input || '—'}</span>
                  <span>
                    机器：<code className="font-mono">{approveTarget.machine_id}</code>
                  </span>
                </div>
              </div>
              <p className="text-sm text-fg-muted">可以直接批准本次登录，也可以批准并创建临时账号，便于后续追踪这名考生的会话。</p>
              </DialogBody>
          ) : null}
          {approveTarget ? (
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setApproveTarget(null)} disabled={busy}>
                  取消
                </Button>
                <Button type="button" variant="secondary" onClick={() => approve(approveTarget, false)} disabled={busy}>
                  直接批准
                </Button>
                <Button type="button" variant="primary" onClick={() => approve(approveTarget, true)} disabled={busy}>
                  创建临时账号并批准
                </Button>
              </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!rejectTarget}
        onOpenChange={(open) => {
          if (!open && !busy) setRejectTarget(null);
        }}
      >
        <DialogContent size="md" onClose={() => !busy && setRejectTarget(null)}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="size-4 text-danger-fg" />
              {rejectTarget
                ? `拒绝「${rejectTarget.real_name_input.trim() || rejectTarget.student_id_input.trim() || '该考生'}」的登录请求？`
                : '拒绝该登录请求？'}
            </DialogTitle>
          </DialogHeader>
          {rejectTarget && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitReject();
              }}
            >
              <DialogBody className="flex flex-col gap-4">
              <div className="grid gap-1 text-xs text-fg-subtle">
                <span>
                  学号：<code className="font-mono">{rejectTarget.student_id_input}</code>
                </span>
                <span>姓名：{rejectTarget.real_name_input || '—'}</span>
                <span>
                  机器：<code className="font-mono">{rejectTarget.machine_id}</code>
                </span>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">拒绝理由</span>
                <Textarea
                  value={rejectReason}
                  invalid={rejectReasonError.length > 0}
                  onChange={(event) => {
                    setRejectReason(event.target.value);
                    if (rejectReasonError) setRejectReasonError('');
                  }}
                  placeholder="例如：身份信息不匹配、未在考试名单中、请联系监考老师确认。"
                  autoFocus
                />
              </label>
              {rejectReasonError && (
                <p className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger-fg">{rejectReasonError}</p>
              )}
              </DialogBody>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setRejectTarget(null)} disabled={busy}>
                  取消
                </Button>
                <Button type="submit" variant="danger" disabled={busy}>
                  拒绝
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!actionError}
        onOpenChange={(open) => {
          if (!open) setActionError('');
        }}
      >
        <DialogContent size="sm" onClose={() => setActionError('')}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="size-4 text-danger-fg" />
              操作失败
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger-fg">{actionError || '操作失败'}</p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="primary" onClick={() => setActionError('')}>
              知道了
            </Button>
          </DialogFooter>
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
            <TableCell className="pl-5 text-xs">
              <VigilDateTime value={e.last_seen_at} mode="both" />
            </TableCell>
            <TableCell className="font-mono text-xs">{e.client_id.slice(0, 12)}…</TableCell>
            <TableCell>
              <Badge variant="outline" size="sm">
                {e.category}
              </Badge>
            </TableCell>
            <TableCell>
              <SeverityBadge level={e.severity} />
            </TableCell>
            <TableCell className="max-w-sm min-w-0 truncate">{e.message}</TableCell>
            <TableCell className="tabular">{e.occurrence_count}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
