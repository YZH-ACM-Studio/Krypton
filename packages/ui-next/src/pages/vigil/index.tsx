/**
 * krypton-vigil admin pages — Phase 3 S2 absorption of the legacy Dashboard.
 *
 * Pages live under `/admin/vigil/*` and call Vigil server through
 * lib/vigil-api.ts (which authenticates via short-lived dashboard tokens
 * fetched from OJ's `/api/admin/vigil/dashboard-token`).
 *
 * Mounted via PAGE_MAP — page templates set by hydrooj's vigil-integration
 * handler. The OJ admin nav registry entries are added here (module side-effect).
 */
import { useEffect, useState } from 'react';
import {
  Activity, AlertCircle, CheckCircle, Eye, Inbox, Layers,
  ShieldCheck, Users, X, XCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import { registerAdminNavSection } from '@/lib/admin-nav-registry';
import { PRIV } from '@/lib/perms';
import { AdminPage } from '@/components/admin/admin-page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  approveRequest, fetchApprovals, fetchClients, fetchEvents, fetchExamSessions,
  rejectRequest, type VigilApproval, type VigilClient, type VigilEvent, type VigilExamSession,
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

// ─── Overview ─────────────────────────────────────────────────────────────

export function AdminVigilOverviewPage() {
  const [clients, setClients] = useState<VigilClient[] | null>(null);
  const [events, setEvents] = useState<VigilEvent[] | null>(null);
  const [approvals, setApprovals] = useState<VigilApproval[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [c, e, a] = await Promise.all([fetchClients(), fetchEvents({ limit: '20' }), fetchApprovals()]);
        setClients(c);
        setEvents(e);
        setApprovals(a);
      } catch (e: any) {
        setErr(e?.message || '加载失败');
      }
    })();
  }, []);

  const pendingApprovals = approvals?.filter((a) => a.status === 'pending') || [];

  return (
    <AdminPage title="反作弊总览" requiredPriv={PRIV.PRIV_EDIT_SYSTEM} description="实时机器、考试会话和风险事件。">
      {err && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="在线客户端" value={clients?.length ?? '—'} icon={Users} href="/admin/vigil/sessions" />
        <Stat label="待审批" value={pendingApprovals.length} icon={Inbox} href="/admin/vigil/approvals" highlight={pendingApprovals.length > 0} />
        <Stat label="未处理事件" value={events?.filter((e) => e.status === 'open').length ?? '—'} icon={AlertCircle} href="/admin/vigil/events" />
        <Stat label="活跃考试会话" value={'—'} icon={Layers} href="/admin/vigil/sessions" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">最新风险事件</CardTitle></CardHeader>
        <CardContent className="p-0">
          <EventTable events={(events || []).slice(0, 10)} />
        </CardContent>
      </Card>
    </AdminPage>
  );
}

function Stat({ label, value, icon: Icon, href, highlight }: {
  label: string; value: any; icon: any; href: string; highlight?: boolean;
}) {
  return (
    <a href={href}>
      <Card className={highlight ? 'border-amber-500/40 bg-amber-500/5' : 'transition-colors hover:bg-accent/50'}>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-primary/10 p-2"><Icon className="size-4 text-primary" /></div>
            <div>
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="text-2xl font-semibold">{value}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </a>
  );
}

function EventTable({ events }: { events: VigilEvent[] }) {
  if (events.length === 0) {
    return <p className="px-5 py-6 text-sm text-muted-foreground">暂无事件。</p>;
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
            <TableCell className="pl-5 text-xs">{new Date(e.last_seen_at).toLocaleString()}</TableCell>
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
  const [approvals, setApprovals] = useState<VigilApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      setApprovals(await fetchApprovals());
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  // Live updates: subscribe to Vigil WS for instant approval push.
  useVigilSocket({
    onMessage: (msg) => {
      if (msg.type === 'approval_request') {
        setApprovals((prev) => {
          // Replace by id if exists, otherwise prepend.
          const filtered = prev.filter((a) => a.id !== msg.approval.id);
          return [msg.approval as VigilApproval, ...filtered];
        });
      } else if (msg.type === 'approval_resolved') {
        setApprovals((prev) => prev.map((a) => (
          a.id === msg.approvalId ? { ...a, status: msg.status } : a
        )));
      }
    },
  });

  const onApprove = async (a: VigilApproval) => {
    const asTemp = a.is_unknown && window.confirm(
      '该考生未在学号库中匹配到。批准并创建临时账号？\n\n确定 = 创建临时账号\n取消 = 不创建',
    );
    try {
      await approveRequest(a.id, asTemp);
      await reload();
    } catch (e: any) {
      alert(e?.message || '操作失败');
    }
  };

  const onReject = async (a: VigilApproval) => {
    const reason = window.prompt('拒绝理由（可选）：') || '';
    try {
      await rejectRequest(a.id, reason);
      await reload();
    } catch (e: any) {
      alert(e?.message || '操作失败');
    }
  };

  return (
    <AdminPage title="审批队列" requiredPriv={PRIV.PRIV_EDIT_SYSTEM}>
      {err && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{err}</div>
      )}
      <Card>
        <CardContent className="p-0">
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
              {loading && <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">加载中…</TableCell></TableRow>}
              {!loading && approvals.length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">没有等待审批的请求。</TableCell></TableRow>
              )}
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
                  <TableCell className="text-xs">{new Date(a.created_at).toLocaleString()}</TableCell>
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
        </CardContent>
      </Card>
    </AdminPage>
  );
}

// ─── Sessions list ────────────────────────────────────────────────────────

export function AdminVigilSessionsPage() {
  const [sessions, setSessions] = useState<VigilExamSession[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchExamSessions().then(setSessions).catch((e) => setErr(e.message));
  }, []);

  return (
    <AdminPage title="考试会话" requiredPriv={PRIV.PRIV_EDIT_SYSTEM}>
      {err && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{err}</div>}
      <Card>
        <CardContent className="p-0">
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
                  <TableCell className="text-xs">{new Date(s.began_at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{s.closed_at ? new Date(s.closed_at).toLocaleString() : '—'}</TableCell>
                </TableRow>
              ))}
              {sessions.length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">暂无考试会话。</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AdminPage>
  );
}

// ─── Events list ──────────────────────────────────────────────────────────

export function AdminVigilEventsPage() {
  const [events, setEvents] = useState<VigilEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchEvents({ limit: '200' }).then(setEvents).catch((e) => setErr(e.message));
  }, []);

  return (
    <AdminPage title="风险事件" requiredPriv={PRIV.PRIV_EDIT_SYSTEM}>
      {err && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{err}</div>}
      <Card>
        <CardContent className="p-0">
          <EventTable events={events} />
        </CardContent>
      </Card>
    </AdminPage>
  );
}
