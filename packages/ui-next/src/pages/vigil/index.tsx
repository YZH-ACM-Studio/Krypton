/**
 * krypton-vigil admin pages — Phase 3 S2 absorption of the legacy Dashboard.
 *
 * Pages live under `/admin/vigil/*` and call Vigil server through
 * lib/vigil-api.ts (which authenticates via short-lived dashboard tokens
 * fetched from OJ's `/api/admin/vigil/dashboard-token`).
 *
 * Defensive design: when Vigil server is unreachable / misconfigured, pages
 * render skeleton + friendly banner instead of throwing.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity, AlertCircle, CheckCircle, ChevronDown, ChevronUp, Inbox, Layers,
  RefreshCw, ServerOff, ShieldCheck, Users, XCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import { registerAdminNavSection } from '@/lib/admin-nav-registry';
import { PRIV } from '@/lib/perms';
import { AdminPage } from '@/components/admin/admin-page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DateTime } from '@/components/ui/datetime';
import {
  approveRequest, fetchApprovals, fetchClients, fetchEvents, fetchExamSessions,
  rejectRequest, VigilOfflineError, type VigilApproval, type VigilClient,
  type VigilEvent, type VigilExamSession,
} from '@/lib/vigil-api';
import { useVigilSocket } from '@/hooks/use-vigil-socket';

registerAdminNavSection({
  key: 'vigil',
  label: '反作弊',
  order: 40,
  requiredPriv: PRIV.PRIV_EDIT_SYSTEM,
  items: [
    { key: 'overview', label: '总览', href: '/admin/vigil', icon: ShieldCheck, templateNames: ['admin_vigil_overview.html'] },
    { key: 'sessions', label: '会话', href: '/admin/vigil/sessions', icon: Layers, templateNames: ['admin_vigil_sessions.html'] },
    { key: 'approvals', label: '审批队列', href: '/admin/vigil/approvals', icon: Inbox, templateNames: ['admin_vigil_approvals.html'] },
    { key: 'events', label: '事件', href: '/admin/vigil/events', icon: Activity, templateNames: ['admin_vigil_events.html'] },
  ],
});

// ─── Defensive UI primitives ─────────────────────────────────────────────

function OfflineBanner({
  err, onRetry,
}: { err: VigilOfflineError; onRetry: () => void }) {
  const [showDetail, setShowDetail] = useState(false);
  const reasonHints: Record<VigilOfflineError['reason'], string> = {
    not_configured: '反作弊服务地址尚未配置。请管理员到 系统设置 → vigil.baseUrl 处填写并保存。',
    network:        '反作弊服务无法访问 — 检查 KVS 服务器是否在线，以及网络连通性。',
    non_json:       '反作弊服务返回了非预期的响应（可能是 URL 配置错误，请求被 OJ 兜底）。',
    token_failed:   'OJ 端获取访问令牌失败 — 检查 vigil.dashboardToken 配置和 OJ 服务状态。',
    server_5xx:     '反作弊服务返回 5xx — 服务端异常，请查看 KVS 日志。',
  };
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-start gap-3">
        <ServerOff className="size-5 shrink-0 text-amber-600" />
        <div className="flex-1 space-y-1">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            反作弊服务暂不可用
          </p>
          <p className="text-xs text-amber-700/80 dark:text-amber-200/80">
            {reasonHints[err.reason]}
          </p>
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

/**
 * Hook to drive vigil page state. Catches VigilOfflineError separately from
 * real errors, auto-retries every 60s, exposes retry trigger.
 */
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

// ─── Overview ─────────────────────────────────────────────────────────────

export function AdminVigilOverviewPage() {
  const clientsQ = useVigilData(() => fetchClients());
  const eventsQ = useVigilData(() => fetchEvents({ limit: '20' }));
  const approvalsQ = useVigilData(() => fetchApprovals());

  const offline = clientsQ.offlineErr || eventsQ.offlineErr || approvalsQ.offlineErr;
  const pendingApprovals = approvalsQ.data?.filter((a) => a.status === 'pending') || [];
  const openEvents = eventsQ.data?.filter((e) => e.status === 'open') || [];

  const retryAll = () => { clientsQ.retry(); eventsQ.retry(); approvalsQ.retry(); };

  return (
    <AdminPage title="反作弊总览" requiredPriv={PRIV.PRIV_EDIT_SYSTEM} description="实时机器、考试会话和风险事件。">
      {offline && <OfflineBanner err={offline} onRetry={retryAll} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="在线客户端" value={clientsQ.data?.length ?? '—'} icon={Users} href="/admin/vigil/sessions" loading={clientsQ.loading && !clientsQ.data && !offline} />
        <Stat label="待审批" value={approvalsQ.data ? pendingApprovals.length : '—'} icon={Inbox} href="/admin/vigil/approvals" highlight={pendingApprovals.length > 0} loading={approvalsQ.loading && !approvalsQ.data && !offline} />
        <Stat label="未处理事件" value={eventsQ.data ? openEvents.length : '—'} icon={AlertCircle} href="/admin/vigil/events" loading={eventsQ.loading && !eventsQ.data && !offline} />
        <Stat label="活跃考试会话" value={'—'} icon={Layers} href="/admin/vigil/sessions" />
      </div>

      <Card>
        <CardHeader className="px-5 pb-3 pt-5"><CardTitle className="text-base">最新风险事件</CardTitle></CardHeader>
        <CardContent className="p-0">
          {eventsQ.loading && !eventsQ.data && !offline ? <SkeletonTable rows={4} cols={6} /> : (
            <EventTable events={(eventsQ.data || []).slice(0, 10)} offline={!!offline} />
          )}
        </CardContent>
      </Card>
    </AdminPage>
  );
}

function Stat({ label, value, icon: Icon, href, highlight, loading }: {
  label: string; value: any; icon: any; href: string; highlight?: boolean; loading?: boolean;
}) {
  return (
    <a href={href}>
      <Card className={highlight ? 'border-amber-500/40 bg-amber-500/5' : 'transition-colors hover:bg-accent/50'}>
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
    </a>
  );
}

function EventTable({ events, offline }: { events: VigilEvent[]; offline?: boolean }) {
  if (events.length === 0) {
    return <EmptyTable message={offline ? '反作弊服务离线，暂无数据展示。' : '暂无风险事件。'} icon={offline ? ServerOff : Activity} />;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-5">时间</TableHead>
          <TableHead>机器</TableHead>
          <TableHead>分类</TableHead>
          <TableHead>严重程度</TableHead>
          <TableHead>消息</TableHead>
          <TableHead className="w-16">次数</TableHead>
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
            <TableCell className="text-sm">{e.occurrence_count}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SeverityBadge({ level }: { level: string }) {
  if (level === 'critical' || level === 'high') return <Badge variant="destructive" className="text-[10px]">{level}</Badge>;
  if (level === 'medium' || level === 'warning') return <Badge className="bg-amber-500 text-white text-[10px]">{level}</Badge>;
  return <Badge variant="outline" className="text-[10px]">{level}</Badge>;
}

// ─── Approvals queue ──────────────────────────────────────────────────────

export function AdminVigilApprovalsPage() {
  const q = useVigilData(() => fetchApprovals());
  const approvals = q.data || [];

  // Live updates: subscribe to Vigil WS for instant approval push.
  useVigilSocket({
    onMessage: (msg) => {
      if (q.offlineErr) return;
      if (msg.type === 'approval_request') {
        // Force a reload; merging would require local mutator on useVigilData.
        q.retry();
      } else if (msg.type === 'approval_resolved') {
        q.retry();
      }
    },
  });

  const onApprove = async (a: VigilApproval) => {
    const asTemp = a.is_unknown && window.confirm(
      '该考生未在学号库中匹配到。批准并创建临时账号？\n\n确定 = 创建临时账号\n取消 = 不创建',
    );
    try {
      await approveRequest(a.id, asTemp);
      q.retry();
    } catch (e: any) {
      alert(e?.message || '操作失败');
    }
  };

  const onReject = async (a: VigilApproval) => {
    const reason = window.prompt('拒绝理由（必填）：') || '';
    if (!reason.trim()) {
      alert('请填写拒绝理由');
      return;
    }
    try {
      await rejectRequest(a.id, reason);
      q.retry();
    } catch (e: any) {
      alert(e?.message || '操作失败');
    }
  };

  return (
    <AdminPage title="审批队列" requiredPriv={PRIV.PRIV_EDIT_SYSTEM} description="临时账号审批、学号匹配请求。">
      {q.offlineErr && <OfflineBanner err={q.offlineErr} onRetry={q.retry} />}
      {q.err && !q.offlineErr && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{q.err}</div>
      )}
      <Card>
        <CardContent className="p-0">
          {q.loading && !q.data && !q.offlineErr ? <SkeletonTable rows={5} cols={7} /> : (
            approvals.length === 0 ? (
              <EmptyTable message={q.offlineErr ? '服务离线，无法加载审批列表。' : '没有等待审批的请求。'} icon={q.offlineErr ? ServerOff : Inbox} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">学号</TableHead>
                    <TableHead>姓名</TableHead>
                    <TableHead>机器</TableHead>
                    <TableHead>考试</TableHead>
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
                      <TableCell className="text-xs">{a.oj_contest_id || '—'}</TableCell>
                      <TableCell><Badge variant={a.status === 'pending' ? 'default' : 'outline'}>{a.status}</Badge></TableCell>
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
            )
          )}
        </CardContent>
      </Card>
    </AdminPage>
  );
}

// ─── Sessions list ────────────────────────────────────────────────────────

export function AdminVigilSessionsPage() {
  const q = useVigilData(() => fetchExamSessions());
  const sessions = q.data || [];
  return (
    <AdminPage title="考试会话" requiredPriv={PRIV.PRIV_EDIT_SYSTEM}>
      {q.offlineErr && <OfflineBanner err={q.offlineErr} onRetry={q.retry} />}
      {q.err && !q.offlineErr && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{q.err}</div>
      )}
      <Card>
        <CardContent className="p-0">
          {q.loading && !q.data && !q.offlineErr ? <SkeletonTable rows={5} cols={7} /> : (
            sessions.length === 0 ? (
              <EmptyTable message={q.offlineErr ? '服务离线，无法加载会话列表。' : '暂无考试会话。'} icon={q.offlineErr ? ServerOff : Layers} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">会话 ID</TableHead>
                    <TableHead>机器</TableHead>
                    <TableHead>OJ 用户</TableHead>
                    <TableHead>考试</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>开始时间</TableHead>
                    <TableHead>结束时间</TableHead>
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
                      <TableCell className="text-xs">{s.oj_contest_id}</TableCell>
                      <TableCell>
                        {s.status === 'active' && <Badge>进行中</Badge>}
                        {s.status === 'closed' && <Badge variant="secondary">已结束</Badge>}
                        {s.status === 'transferred' && <Badge variant="outline">已转移</Badge>}
                        {s.status === 'force_closed' && <Badge variant="destructive">强制关闭</Badge>}
                      </TableCell>
                      <TableCell className="text-xs"><DateTime value={s.began_at} /></TableCell>
                      <TableCell className="text-xs">{s.closed_at ? <DateTime value={s.closed_at} /> : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          )}
        </CardContent>
      </Card>
    </AdminPage>
  );
}

// ─── Events list ──────────────────────────────────────────────────────────

export function AdminVigilEventsPage() {
  const q = useVigilData(() => fetchEvents({ limit: '200' }));
  const events = q.data || [];
  return (
    <AdminPage title="风险事件" requiredPriv={PRIV.PRIV_EDIT_SYSTEM}>
      {q.offlineErr && <OfflineBanner err={q.offlineErr} onRetry={q.retry} />}
      {q.err && !q.offlineErr && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{q.err}</div>
      )}
      <Card>
        <CardContent className="p-0">
          {q.loading && !q.data && !q.offlineErr ? <SkeletonTable rows={6} cols={6} /> : (
            <EventTable events={events} offline={!!q.offlineErr} />
          )}
        </CardContent>
      </Card>
    </AdminPage>
  );
}
