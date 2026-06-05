import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code,
  Download,
  FileText,
  Flag,
  LayoutGrid,
  List,
  Lock,
  MessageSquare,
  Pencil,
  Radio,
  Search,
  Settings,
  ShieldCheck,
  Trophy,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { SimpleSelect } from '@/components/ui/select';
import { MarkdownView } from '@/components/markdown-renderer';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { formatDateTime, replaceRouteTokens, toDate } from '@/lib/format';

type R = Record<string, any>;
type ScoreboardCell = {
  type?: string;
  value?: string | number;
  raw?: any;
  score?: number;
  hover?: string;
  style?: string;
};

/* ────────────────────────────────────────────────────────────────── */
/*  Shared helpers                                                   */
/* ────────────────────────────────────────────────────────────────── */

function contestState(c: R) {
  const now = Date.now();
  const begin = toDate(c.beginAt)?.getTime() || 0;
  const end = toDate(c.endAt)?.getTime() || 0;
  if (!begin || !end) return { label: '待发布', variant: 'secondary' as const, phase: 'draft' as const };
  if (now < begin) return { label: '即将开始', variant: 'outline' as const, phase: 'upcoming' as const };
  if (now > end) return { label: '已结束', variant: 'secondary' as const, phase: 'ended' as const };
  return { label: '进行中', variant: 'default' as const, phase: 'running' as const };
}

function ruleLabel(rule?: string): string {
  switch ((rule || '').toLowerCase()) {
    case 'acm': return 'XCPC';
    case 'oi': return 'OI';
    case 'ioi': return 'IOI';
    case 'strictioi': return 'IOI 严格';
    case 'ledo': return 'Ledo';
    case 'homework': return '作业';
    case 'exam': return '考试';
    default: return rule || '—';
  }
}

function ruleBadgeVariant(rule?: string): 'default' | 'secondary' | 'outline' {
  switch ((rule || '').toLowerCase()) {
    case 'acm': return 'default';
    case 'ioi':
    case 'strictioi': return 'secondary';
    default: return 'outline';
  }
}

/** Live countdown that re-renders every second while the contest matters. */
function useCountdown(target: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target]);
  if (!target) return null;
  const remaining = target - now;
  if (remaining <= 0) return { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 };
  return {
    expired: false,
    days: Math.floor(remaining / (1000 * 60 * 60 * 24)),
    hours: Math.floor((remaining / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((remaining / (1000 * 60)) % 60),
    seconds: Math.floor((remaining / 1000) % 60),
    total: remaining,
  };
}

function fmtCountdown(c: ReturnType<typeof useCountdown>) {
  if (!c) return '—';
  if (c.expired) return '00:00:00';
  const pad = (n: number) => String(n).padStart(2, '0');
  if (c.days > 0) return `${c.days}天 ${pad(c.hours)}:${pad(c.minutes)}:${pad(c.seconds)}`;
  return `${pad(c.hours)}:${pad(c.minutes)}:${pad(c.seconds)}`;
}

function countdownProgress(phase: ReturnType<typeof contestState>['phase'], beginAt: number, endAt: number) {
  if (!beginAt || !endAt || endAt <= beginAt) return 0;
  if (phase === 'upcoming') return 0;
  if (phase === 'ended') return 100;
  const pct = ((Date.now() - beginAt) / (endAt - beginAt)) * 100;
  return Math.min(100, Math.max(0, pct));
}

function CountdownUnit({ value, label, wide = false }: { value: string | number; label: string; wide?: boolean }) {
  return (
    <span className="inline-flex items-end gap-1">
      <span className={`inline-flex h-11 items-center justify-center rounded-md border bg-background/80 px-2 font-mono text-2xl font-semibold tabular-nums ${wide ? 'min-w-16' : 'min-w-12'}`}>
        {value}
      </span>
      <span className="pb-1 text-[11px] text-muted-foreground">{label}</span>
    </span>
  );
}

function CountdownStrip({
  phase,
  beginAt,
  endAt,
  cd,
}: {
  phase: ReturnType<typeof contestState>['phase'];
  beginAt: number;
  endAt: number;
  cd: ReturnType<typeof useCountdown>;
}) {
  const isRunning = phase === 'running';
  const isUpcoming = phase === 'upcoming';
  const progress = countdownProgress(phase, beginAt, endAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const label = isRunning ? '距离结束' : isUpcoming ? '距离开始' : '比赛已结束';
  const tone = isRunning
    ? 'border-emerald-500/30 bg-emerald-500/10'
    : isUpcoming
      ? 'border-amber-500/30 bg-amber-500/10'
      : 'border-border bg-muted/30';
  const barTone = isRunning ? 'bg-emerald-500' : isUpcoming ? 'bg-amber-500' : 'bg-muted-foreground/40';

  return (
    <section className={`rounded-xl border ${tone}`}>
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto_220px] lg:items-center">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg border bg-background/70">
            {isRunning ? <Radio className="size-4 text-emerald-600" /> : isUpcoming ? <Clock className="size-4 text-amber-600" /> : <CheckCircle2 className="size-4 text-muted-foreground" />}
          </span>
          <div>
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">
              {isRunning ? '比赛正在进行' : isUpcoming ? '准备阶段' : '可查看赛后信息'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <CountdownUnit value={cd?.expired ? '0' : cd?.days || 0} label="天" wide />
          <span className="text-xl font-semibold text-muted-foreground">:</span>
          <CountdownUnit value={cd?.expired ? '00' : pad(cd?.hours || 0)} label="时" />
          <span className="text-xl font-semibold text-muted-foreground">:</span>
          <CountdownUnit value={cd?.expired ? '00' : pad(cd?.minutes || 0)} label="分" />
          <span className="text-xl font-semibold text-muted-foreground">:</span>
          <CountdownUnit value={cd?.expired ? '00' : pad(cd?.seconds || 0)} label="秒" />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{isRunning ? '比赛进度' : isUpcoming ? '等待开始' : '已完成'}</span>
            <span className="font-mono tabular-nums">{Math.round(progress)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-background/80">
            <div className={`h-full rounded-full ${barTone} transition-[width] duration-700`} style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Contest list page                                                */
/* ────────────────────────────────────────────────────────────────── */

const VIEW_KEY = 'krypton.contests.view';

export function ContestsPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdocs: R[] = data.tdocs || [];
  const page = Number(data.page) || 1;
  const tpcount = Number(data.tpcount) || 1;
  const locale = bs.locale;
  const groups: string[] = data.groups || [];
  const rules: Record<string, string> = data.rules || {};
  const tsdict: Record<string, R> = data.tsdict || {};
  const currentGroup = data.group || '';
  const currentRule = data.rule || '';
  const currentQuery = data.q || '';

  const [view, setView] = useState<'list' | 'cards'>(() => {
    try { return (localStorage.getItem(VIEW_KEY) as any) || 'list'; } catch { return 'list'; }
  });
  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ }
  }, [view]);

  // Status filter (client-side, since server doesn't filter by status)
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'upcoming' | 'ended'>('all');

  // Bucket contests by phase for stats + sort
  const buckets = useMemo(() => {
    const running: R[] = [];
    const upcoming: R[] = [];
    const ended: R[] = [];
    for (const c of tdocs) {
      const st = contestState(c);
      if (st.phase === 'running') running.push(c);
      else if (st.phase === 'upcoming') upcoming.push(c);
      else if (st.phase === 'ended') ended.push(c);
    }
    return { running, upcoming, ended };
  }, [tdocs]);

  const filteredDocs = useMemo(() => {
    if (statusFilter === 'all') return tdocs;
    if (statusFilter === 'running') return buckets.running;
    if (statusFilter === 'upcoming') return buckets.upcoming;
    return buckets.ended;
  }, [statusFilter, tdocs, buckets]);

  const pageBase = (() => {
    const query = new URLSearchParams();
    if (currentQuery) query.set('q', currentQuery);
    if (currentGroup) query.set('group', currentGroup);
    if (currentRule) query.set('rule', currentRule);
    const suffix = query.toString();
    return suffix ? `${bs.urls.contests}?${suffix}` : bs.urls.contests;
  })();

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header + create */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">比赛</h1>
          <p className="text-sm text-muted-foreground">{tdocs.length} 场比赛</p>
        </div>
        <Button asChild>
          <a href={`${bs.urls.contests}/create`}>创建比赛</a>
        </Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCell label="进行中" value={buckets.running.length} icon={<Flag className="size-4 text-green-600" />} active={statusFilter === 'running'} onClick={() => setStatusFilter(statusFilter === 'running' ? 'all' : 'running')} />
        <StatCell label="即将开始" value={buckets.upcoming.length} icon={<Clock className="size-4 text-amber-600" />} active={statusFilter === 'upcoming'} onClick={() => setStatusFilter(statusFilter === 'upcoming' ? 'all' : 'upcoming')} />
        <StatCell label="已结束" value={buckets.ended.length} icon={<CheckCircle2 className="size-4 text-muted-foreground" />} active={statusFilter === 'ended'} onClick={() => setStatusFilter(statusFilter === 'ended' ? 'all' : 'ended')} />
        <StatCell label="我参加" value={Object.values(tsdict).filter((s: any) => s?.attend).length} icon={<Trophy className="size-4 text-primary" />} />
      </div>

      {/* Search + group + rule filter form */}
      <Card>
        <CardContent className="p-4">
          <form method="get" className="grid gap-3 sm:grid-cols-[1fr_180px_180px_auto] sm:items-end">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">搜索</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  name="q"
                  defaultValue={currentQuery}
                  className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm"
                  placeholder="比赛名称"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">用户组</label>
              <SimpleSelect
                name="group"
                defaultValue={currentGroup}
                options={[
                  { value: '', label: '全部' },
                  ...groups.map((group) => ({ value: group, label: group })),
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">赛制</label>
              <SimpleSelect
                name="rule"
                defaultValue={currentRule}
                options={[
                  { value: '', label: '全部' },
                  ...Object.entries(rules).map(([key, label]) => ({ value: key, label: label as string })),
                ]}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm">筛选</Button>
              <div className="ml-auto flex items-center gap-1 rounded-md border bg-muted/30 p-0.5">
                <button type="button" onClick={() => setView('list')} className={`p-1.5 rounded ${view === 'list' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} title="列表视图">
                  <List className="size-3.5" />
                </button>
                <button type="button" onClick={() => setView('cards')} className={`p-1.5 rounded ${view === 'cards' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} title="卡片视图">
                  <LayoutGrid className="size-3.5" />
                </button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Pinned: running contests, only when statusFilter='all' so user can spot them */}
      {statusFilter === 'all' && buckets.running.length > 0 ? (
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Flag className="size-3.5 text-green-600" />
            进行中
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {buckets.running.map((c) => (
              <RunningContestCard key={String(c.docId)} c={c} bs={bs} tsdict={tsdict} />
            ))}
          </div>
        </div>
      ) : null}

      {/* Main list */}
      {filteredDocs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            没有符合条件的比赛
          </CardContent>
        </Card>
      ) : view === 'list' ? (
        <ContestTable docs={filteredDocs} bs={bs} tsdict={tsdict} locale={locale} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filteredDocs.map((c) => <ContestCard key={String(c.docId)} c={c} bs={bs} tsdict={tsdict} />)}
        </div>
      )}

      <Pagination current={page} total={tpcount} baseUrl={pageBase} />
    </motion.div>
  );
}

function StatCell({ label, value, icon, active, onClick }: { label: string; value: number; icon: React.ReactNode; active?: boolean; onClick?: () => void }) {
  const clickable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={`flex items-center justify-between rounded-md border bg-card p-3 text-left transition-colors ${active ? 'border-primary bg-primary/5' : 'border-border'} ${clickable ? 'hover:border-primary/40 hover:bg-accent/30 cursor-pointer' : 'cursor-default'}`}
    >
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tabular-nums">{value}</p>
      </div>
      {icon}
    </button>
  );
}

function RunningContestCard({ c, bs, tsdict }: { c: R; bs: ReturnType<typeof useBootstrap>; tsdict: Record<string, R> }) {
  const endAt = toDate(c.endAt)?.getTime() || 0;
  const cd = useCountdown(endAt);
  const tsdoc = tsdict[String(c.docId)] || {};
  const detailUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: String(c.docId) });
  return (
    <a href={detailUrl} className="group block">
      <Card className="h-full transition-all group-hover:border-primary/40 group-hover:shadow-md">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-medium line-clamp-2 leading-tight">{c.title || '未命名'}</h3>
            <Badge variant={ruleBadgeVariant(c.rule)} className="shrink-0">{ruleLabel(c.rule)}</Badge>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3" />
            <span className="font-mono">剩余 {fmtCountdown(cd)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Users className="size-3" />{c.attend || 0}
            </span>
            {tsdoc.attend
              ? <Badge variant="default" className="text-[10px]">已参加</Badge>
              : <Badge variant="outline" className="text-[10px]">未参加</Badge>
            }
          </div>
        </CardContent>
      </Card>
    </a>
  );
}

function ContestCard({ c, bs, tsdict }: { c: R; bs: ReturnType<typeof useBootstrap>; tsdict: Record<string, R> }) {
  const st = contestState(c);
  const tsdoc = tsdict[String(c.docId)] || {};
  const detailUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: String(c.docId) });
  return (
    <a href={detailUrl} className="group block">
      <Card className="h-full transition-all group-hover:border-primary/40 group-hover:shadow-md">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-medium line-clamp-2 leading-tight">{c.title || '未命名'}</h3>
            <Badge variant={ruleBadgeVariant(c.rule)} className="shrink-0">{ruleLabel(c.rule)}</Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            {formatDateTime(c.beginAt, bs.locale)}
          </div>
          <div className="flex items-center justify-between">
            <Badge variant={st.variant} className="text-[10px]">{st.label}</Badge>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="size-3" />{c.attend || 0}
            </span>
            {tsdoc.attend ? <Badge variant="secondary" className="text-[10px]">已参加</Badge> : null}
          </div>
        </CardContent>
      </Card>
    </a>
  );
}

function ContestTable({ docs, bs, tsdict, locale }: { docs: R[]; bs: ReturnType<typeof useBootstrap>; tsdict: Record<string, R>; locale: string }) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>比赛名称</TableHead>
              <TableHead className="w-44">时间</TableHead>
              <TableHead className="w-24 text-center">规则</TableHead>
              <TableHead className="w-20 text-center">参与</TableHead>
              <TableHead className="w-24 text-center">状态</TableHead>
              <TableHead className="w-24 text-center">我的</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {docs.map((c) => {
              const st = contestState(c);
              const ts = tsdict[String(c.docId)] || {};
              return (
                <TableRow key={String(c.docId)}>
                  <TableCell>
                    <a
                      href={replaceRouteTokens(bs.urls.contestDetail, { TID: String(c.docId) })}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {c.title || '未命名比赛'}
                    </a>
                    {c.rated ? <Badge variant="secondary" className="ml-2 text-[10px]">Rated</Badge> : null}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(c.beginAt, locale)}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={ruleBadgeVariant(c.rule)}>{ruleLabel(c.rule)}</Badge>
                  </TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">
                    <span className="flex items-center justify-center gap-1">
                      <Users className="size-3" />{c.attend || 0}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    {ts.attend
                      ? <Badge variant="default" className="text-[10px]">已参加</Badge>
                      : <span className="text-[10px] text-muted-foreground">—</span>
                    }
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Contest detail page                                              */
/* ────────────────────────────────────────────────────────────────── */

export function ContestDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const pids: (string | number)[] = data.pids || tdoc.pids || [];
  const tsdoc: R = data.tsdoc || {};
  const attended = data.attended || tsdoc.attend;
  const st = contestState(tdoc);
  const locale = bs.locale;
  const isHomework = tdoc.rule === 'homework';
  const isACM = tdoc.rule === 'acm';
  const isExam = tdoc.rule === 'exam';
  const canManageContest = !!data.canManageContest;
  const canViewRecord = !!data.canViewRecord;
  const isClientRequired = tdoc.entryMode === 'client_required';

  const detailUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: String(tdoc.docId) });
  const beginAt = toDate(tdoc.beginAt)?.getTime() || 0;
  const endAt = toDate(tdoc.endAt)?.getTime() || 0;
  const countdownTarget = st.phase === 'upcoming' ? beginAt : st.phase === 'running' ? endAt : null;
  const cd = useCountdown(countdownTarget);
  const cdForStrip = cd || (st.phase === 'ended'
    ? { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 }
    : null);
  const entryUrl = isClientRequired ? `/exam-mode/${encodeURIComponent(String(tdoc.docId))}` : `${detailUrl}/problems`;
  const canOpenProblems = canManageContest || st.phase === 'ended' || (attended && st.phase !== 'upcoming');
  const discussionUrl = replaceRouteTokens(bs.urls.discussionNode, { TYPE: 'contest', NAME: String(tdoc.docId) });
  const myRecordUrl = `${bs.urls.records}?tid=${encodeURIComponent(String(tdoc.docId))}&uidOrName=${encodeURIComponent(String(bs.user.id))}`;
  const allRecordUrl = `${bs.urls.records}?tid=${encodeURIComponent(String(tdoc.docId))}`;

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <a href={isHomework ? bs.urls.homework : bs.urls.contests} className="hover:text-primary">
          {isHomework ? '作业' : '比赛'}
        </a>
        <ChevronRight className="size-3" />
        <span className="text-foreground">{tdoc.title || '比赛'}</span>
      </div>

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={st.variant}>{st.label}</Badge>
              <Badge variant={ruleBadgeVariant(tdoc.rule)}>{ruleLabel(tdoc.rule)}</Badge>
              {tdoc.rated ? <Badge variant="secondary">Rated</Badge> : null}
              {isClientRequired ? (
                <Badge variant="outline" className="gap-1">
                  <ShieldCheck className="size-3" />
                  客户端进入
                </Badge>
              ) : null}
              {tdoc.allowViewCode ? <Badge variant="outline">代码可见</Badge> : null}
            </div>
            <h1 className="mt-3 text-3xl font-semibold leading-tight">{tdoc.title || '比赛'}</h1>
            <div className="mt-4 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
              <span className="inline-flex items-center gap-2">
                <Users className="size-4" />
                {tdoc.attend || 0} 人参加
              </span>
              <span className="inline-flex items-center gap-2">
                <List className="size-4" />
                {pids.length} 道题
              </span>
              <span className="inline-flex items-center gap-2">
                <Calendar className="size-4" />
                {formatDuration(beginAt, endAt)}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end">
            {!attended && st.phase !== 'ended' ? (
              <form method="post">
                <input type="hidden" name="operation" value="attend" />
                <Button type="submit">
                  参加比赛
                  <ArrowRight className="size-4" />
                </Button>
              </form>
            ) : canOpenProblems ? (
              <Button asChild>
                <a href={entryUrl}>
                  {st.phase === 'ended' ? '查看题目' : '进入比赛'}
                  <ArrowRight className="size-4" />
                </a>
              </Button>
            ) : (
              <Button type="button" disabled>
                <Lock className="size-4" />
                等待开始
              </Button>
            )}
            <Button asChild variant="outline">
              <a href={`${detailUrl}/scoreboard`}>
                <Trophy className="size-4" />
                排行榜
              </a>
            </Button>
            {canManageContest ? (
              <Button asChild variant="outline">
                <a href={`${detailUrl}/management`}>
                  <Settings className="size-4" />
                  管理
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {cdForStrip ? (
        <CountdownStrip phase={st.phase} beginAt={beginAt} endAt={endAt} cd={cdForStrip} />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          {tdoc.content ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <BookOpen className="size-4" />
                  比赛说明
                </CardTitle>
              </CardHeader>
              <CardContent>
                <MarkdownView content={tdoc.content} preferredLang={locale?.startsWith('zh') ? 'zh' : 'en'} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">比赛入口</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <DetailAction href={entryUrl} icon={<List className="size-4" />} title={canOpenProblems ? '进入题目' : '题目未开放'} muted={!canOpenProblems}>
                {isClientRequired ? '客户端工作台' : '比赛题目入口'}
              </DetailAction>
              <DetailAction href={`${detailUrl}/scoreboard`} icon={<Trophy className="size-4" />} title="排行榜">
                查看排名与榜单视图
              </DetailAction>
              {!isExam ? (
                <DetailAction href={`${detailUrl}/clarification`} icon={<MessageSquare className="size-4" />} title="澄清答疑">
                  查看公告与提交提问
                </DetailAction>
              ) : null}
              <DetailAction href={discussionUrl} icon={<MessageSquare className="size-4" />} title="讨论区">
                比赛相关公开讨论
              </DetailAction>
              {tdoc.allowPrint ? (
                <DetailAction href={`${detailUrl}/print`} icon={<FileText className="size-4" />} title="打印服务">
                  提交或查看打印请求
                </DetailAction>
              ) : null}
              {attended && canViewRecord ? (
                <DetailAction href={myRecordUrl} icon={<Code className="size-4" />} title="我的提交">
                  查看本场个人提交
                </DetailAction>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">我的成绩</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {attended ? (
                <>
                  {typeof tsdoc.rank === 'number' && tsdoc.rank > 0 ? (
                    <Row label="当前排名" value={`# ${tsdoc.rank}`} />
                  ) : null}
                  {typeof tsdoc.score === 'number' ? (
                    <Row label={isACM ? '通过题数' : '总得分'} value={String(tsdoc.score)} />
                  ) : null}
                  {tsdoc.endAt ? (
                    <Row label="结束时间" value={formatDateTime(tsdoc.endAt, locale)} />
                  ) : null}
                  <a href={`${detailUrl}/scoreboard`} className="block pt-2 text-xs text-primary hover:underline">
                    查看完整排行 →
                  </a>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">参加比赛后显示个人成绩</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">比赛时间</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="开始" value={formatDateTime(tdoc.beginAt, locale)} />
              <Row label="结束" value={formatDateTime(tdoc.endAt, locale)} />
              <Row label="时长" value={formatDuration(beginAt, endAt)} />
              {tdoc.lockAt ? <Row label="封榜" value={formatDateTime(tdoc.lockAt, locale)} /> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">操作</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {canManageContest ? (
                <>
                  <SidebarLink href={`${detailUrl}/edit`} icon={<Pencil className="size-3.5" />}>编辑比赛</SidebarLink>
                  <SidebarLink href={`${detailUrl}/management`} icon={<Settings className="size-3.5" />}>管理比赛</SidebarLink>
                  <div className="my-1 h-px bg-border" />
                </>
              ) : null}
              <SidebarLink href={`${detailUrl}/scoreboard`} icon={<Trophy className="size-3.5" />}>排行榜</SidebarLink>
              {!isExam ? (
                <SidebarLink href={`${detailUrl}/clarification`} icon={<MessageSquare className="size-3.5" />}>澄清答疑</SidebarLink>
              ) : null}
              <SidebarLink href={discussionUrl} icon={<MessageSquare className="size-3.5" />}>讨论</SidebarLink>
              {tdoc.allowViewCode ? (
                <SidebarLink href={`${detailUrl}/code`} icon={<Code className="size-3.5" />}>代码浏览</SidebarLink>
              ) : null}
              {attended && canViewRecord ? (
                <SidebarLink href={myRecordUrl} icon={<Code className="size-3.5" />}>我的提交</SidebarLink>
              ) : null}
              {canManageContest ? (
                <SidebarLink href={allRecordUrl} icon={<Flag className="size-3.5" />}>全部提交</SidebarLink>
              ) : null}
              {isACM ? (
                <SidebarLink href={`${detailUrl}/balloon`} icon={<Flag className="size-3.5" />}>气球</SidebarLink>
              ) : null}
              <SidebarLink href={`${detailUrl}/print`} icon={<FileText className="size-3.5" />}>打印题面</SidebarLink>
              <SidebarLink href={`${detailUrl}/user`} icon={<Users className="size-3.5" />}>参赛选手</SidebarLink>
            </CardContent>
          </Card>

          {Array.isArray(data.files) && data.files.length > 0 ? (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">附件</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {data.files.map((f: R) => (
                  <a key={f.name} href={`${detailUrl}/file/contest/${f.name}`} className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                    <Download className="size-3" />
                    <span className="truncate">{f.name}</span>
                  </a>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

function DetailAction({
  href,
  icon,
  title,
  muted,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  muted?: boolean;
  children: React.ReactNode;
}) {
  const content = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{children}</span>
      </span>
      {!muted ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : <Lock className="size-4 shrink-0 text-muted-foreground" />}
    </>
  );
  const className = `flex items-center gap-3 rounded-md border p-3 text-left transition-colors ${
    muted ? 'cursor-not-allowed bg-muted/30 opacity-70' : 'hover:border-primary/40 hover:bg-accent/30'
  }`;
  if (muted) return <div className={className}>{content}</div>;
  return <a href={href} className={className}>{content}</a>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium tabular-nums">{value}</span>
    </div>
  );
}

function SidebarLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {icon}
      <span>{children}</span>
    </a>
  );
}

function formatDuration(begin: number, end: number): string {
  if (!begin || !end || end <= begin) return '—';
  const ms = end - begin;
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分`;
}

/* ────────────────────────────────────────────────────────────────── */
/*  Contest scoreboard (kept; only URL bug fixed)                   */
/* ────────────────────────────────────────────────────────────────── */

export function ContestScoreboardPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const rows: ScoreboardCell[][] = Array.isArray(data.rows) ? data.rows : [];
  const header = rows[0] || [];
  const body = rows.slice(1);
  const pdict: Record<string, R> = data.pdict || {};
  const udict: Record<string, GenericUserDoc> = { ...(bs.udict || {}), ...(data.udict || {}) };
  const isHomework = tdoc.rule === 'homework';
  const examUrls: R = data.examMode?.urls || {};
  const inExamMode = !!data.examMode?.enabled;
  const detailUrl = examUrls.overview || replaceRouteTokens(isHomework ? bs.urls.homeworkDetail : bs.urls.contestDetail, {
    TID: String(tdoc.docId),
  });
  const scoreboardUrl = examUrls.ranking || `${detailUrl}/scoreboard`;
  const availableViews = Array.isArray(data.availableViews) ? data.availableViews : [];
  const extraViews = availableViews.filter(([id]: [string]) => !['html', 'csv', 'default', 'ghost'].includes(id));

  // Admin-only 学号 / 姓名 columns. The backend only sends studentDict to
  // system admins, so a non-empty dict is the signal to render the columns —
  // they stay invisible to ordinary contestants. The cells are injected right
  // after the user column, keeping header / body alignment intact.
  const studentDict: Record<string, { studentId: string; realName: string }> = data.studentDict || {};
  const userColIndex = header.findIndex((cell) => cell.type === 'user');
  const showStudentCols = Object.keys(studentDict).length > 0 && userColIndex >= 0;
  const displayHeader: ScoreboardCell[] = showStudentCols
    ? [
      ...header.slice(0, userColIndex + 1),
      { type: 'studentId', value: '学号' },
      { type: 'realName', value: '姓名' },
      ...header.slice(userColIndex + 1),
    ]
    : header;
  const displayBody: ScoreboardCell[][] = showStudentCols
    ? body.map((row) => {
      const uid = row[userColIndex]?.raw;
      const info = studentDict[String(uid)] || null;
      return [
        ...row.slice(0, userColIndex + 1),
        { type: 'studentId', value: info?.studentId, raw: uid },
        { type: 'realName', value: info?.realName, raw: uid },
        ...row.slice(userColIndex + 1),
      ];
    })
    : body;

  function cellText(cell: ScoreboardCell) {
    return cell.value == null ? '—' : String(cell.value);
  }

  function renderScoreboardText(cell: ScoreboardCell): ReactNode {
    const source = cellText(cell);
    const marker = /<span class="icon icon-check"><\/span>|<span style="color:orange">([^<]+)<\/span>/g;
    const nodes: ReactNode[] = [];
    let last = 0;
    let key = 0;
    const pushText = (text: string) => {
      text.split('\n').forEach((line, index) => {
        if (index > 0) nodes.push(<br key={`br-${key++}`} />);
        if (line) nodes.push(<span key={`t-${key++}`}>{line}</span>);
      });
    };
    for (const match of source.matchAll(marker)) {
      const index = match.index ?? 0;
      pushText(source.slice(last, index));
      if (match[0].includes('icon-check')) {
        nodes.push(<span key={`ok-${key++}`} className="font-semibold">✓</span>);
      } else {
        nodes.push(<span key={`pending-${key++}`} className="font-semibold text-orange-500">{match[1]}</span>);
      }
      last = index + match[0].length;
    }
    pushText(source.slice(last));
    return nodes.length ? nodes : source;
  }

  function firstBloodClass(cell: ScoreboardCell) {
    if (typeof cell.style === 'string' && /background-color/i.test(cell.style)) {
      return 'bg-[#d9f0c7] dark:bg-emerald-950/50';
    }
    if (cell.type === 'records' && Array.isArray(cell.raw) && cell.raw.some((record: ScoreboardCell) => /background-color/i.test(String(record.style || '')))) {
      return 'bg-[#d9f0c7] dark:bg-emerald-950/50';
    }
    return '';
  }

  function scoreClass(cell: ScoreboardCell) {
    const score = Number(cell.score ?? cell.value);
    if (!Number.isFinite(score)) return 'text-foreground';
    if (score >= 100) return 'text-green-600 dark:text-green-400';
    if (score > 0) return 'text-amber-600 dark:text-amber-400';
    return 'text-muted-foreground';
  }

  function renderRecordCell(cell: ScoreboardCell) {
    const content = (
      <span className={`whitespace-pre-line font-semibold ${scoreClass(cell)}`} title={cell.hover || undefined}>
        {renderScoreboardText(cell)}
      </span>
    );
    if (!cell.raw) return content;
    // In the Qt client workspace, submissions should only be browsed from the
    // user's own IDE history. Scoreboard cells can point at other users' records.
    if (inExamMode) return content;
    return (
      <a
        href={examUrls.record ? String(examUrls.record).replace('__RID__', String(cell.raw)) : replaceRouteTokens(bs.urls.recordDetail, { RID: String(cell.raw) })}
        className="hover:underline"
      >
        {content}
      </a>
    );
  }

  function renderHeaderCell(cell: ScoreboardCell, index: number) {
    if (cell.type === 'problem' && cell.raw) {
      const problem = pdict[String(cell.raw)] || {};
      return (
        <a
          href={examUrls.problem
            ? String(examUrls.problem).replace('__PID__', String(cell.raw))
            : `${replaceRouteTokens(bs.urls.problemDetail, { PID: String(cell.raw) })}?tid=${tdoc.docId}`}
          className="block text-center hover:text-primary hover:underline"
          title={problem.title || cell.hover || undefined}
        >
          <span>{cellText(cell)}</span>
          <span className="block text-[10px] text-muted-foreground">
            {problem.nAccept || 0}/{problem.nSubmit || 0}
          </span>
        </a>
      );
    }
    return <span className={index === 0 ? 'font-mono' : 'whitespace-pre-line'}>{cellText(cell)}</span>;
  }

  function renderBodyCell(cell: ScoreboardCell) {
    if (cell.type === 'rank') {
      return (
        <span className="font-mono text-sm text-muted-foreground">
          {cell.value === '0' || cell.value === 0 ? '*' : cellText(cell)}
        </span>
      );
    }
    if (cell.type === 'user') {
      const user = udict[String(cell.raw)] || null;
      const name = user?.uname || cellText(cell);
      if (inExamMode) return <span className="font-medium">{name}</span>;
      return cell.raw ? (
        <a
          href={replaceRouteTokens(bs.urls.userDetail, { UID: String(cell.raw) })}
          className="font-medium hover:text-primary hover:underline"
        >
          {name}
        </a>
      ) : <span className="font-medium">{name}</span>;
    }
    if (cell.type === 'studentId') {
      return <span className="font-mono text-xs text-muted-foreground">{cellText(cell)}</span>;
    }
    if (cell.type === 'realName') {
      return <span className="text-xs text-muted-foreground">{cellText(cell)}</span>;
    }
    if (cell.type === 'record') return renderRecordCell(cell);
    if (cell.type === 'records' && Array.isArray(cell.raw)) {
      return (
        <span className="space-x-1">
          {cell.raw.map((record: ScoreboardCell, index: number) => (
            <span key={`${record.raw || record.value || index}`}>
              {index > 0 ? <span className="text-muted-foreground">/</span> : null}
              {record.raw ? renderRecordCell(record) : <span className="whitespace-pre-line">{renderScoreboardText(record)}</span>}
            </span>
          ))}
        </span>
      );
    }
    if (cell.type === 'total_score' || cell.type === 'solved' || cell.type === 'time') {
      return (
        <span className={`whitespace-pre-line font-medium tabular-nums ${cell.type === 'total_score' ? scoreClass(cell) : ''}`} title={cell.hover || undefined}>
          {renderScoreboardText(cell)}
        </span>
      );
    }
    return <span className="whitespace-pre-line" title={cell.hover || undefined}>{renderScoreboardText(cell)}</span>;
  }

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <a href={examUrls.overview || (isHomework ? bs.urls.homework : bs.urls.contests)} className="hover:text-primary">
              {isHomework ? '作业' : '比赛'}
            </a>
            <ChevronRight className="size-3" />
            <a href={detailUrl} className="hover:text-primary">
              {tdoc.title || (isHomework ? '作业' : '比赛')}
            </a>
            <ChevronRight className="size-3" />
          </div>
          <h1 className="mt-1 text-xl font-semibold">排行榜</h1>
        </div>
        {!inExamMode ? (
        <div className="flex flex-wrap gap-2">
          {['html', 'csv', 'ghost'].map((view) => (
            <Button key={view} asChild variant="outline" size="sm">
              <a href={`${scoreboardUrl}/${view}`} target="_blank" rel="noreferrer">
                <Download className="size-4" />
                {view.toUpperCase()}
              </a>
            </Button>
          ))}
          {extraViews.map(([id, name]: [string, string]) => (
            <Button key={id} asChild variant="outline" size="sm">
              <a href={`${scoreboardUrl}/${id}`} target="_blank" rel="noreferrer">
                {name || id}
              </a>
            </Button>
          ))}
        </div>
        ) : null}
      </div>

      {tdoc.lockAt && !tdoc.unlocked ? (
        <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20">
          <CardContent className="p-4 text-sm text-amber-800 dark:text-amber-200">
            排行榜已封榜，封榜后的提交可能会暂时显示为待定。
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {header.length > 0 ? (
            <Table className="min-w-max">
              <TableHeader>
                <TableRow>
                  {displayHeader.map((cell, index) => (
                    <TableHead
                      key={`${cell.type || 'col'}-${index}`}
                      className={cell.type === 'problem' || cell.type === 'record' || cell.type === 'records' ? 'min-w-20 text-center' : 'min-w-24'}
                    >
                      {renderHeaderCell(cell, index)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayBody.map((row, rowIndex) => (
                  <TableRow key={rowIndex}>
                    {displayHeader.map((head, columnIndex) => {
                      const cell = row[columnIndex] || {};
                      return (
                        <TableCell
                          key={`${rowIndex}-${columnIndex}`}
                          className={cn(
                            head.type === 'problem' || cell.type === 'record' || cell.type === 'records' ? 'text-center' : '',
                            firstBloodClass(cell),
                          )}
                        >
                          {renderBodyCell(cell)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">暂无排行数据</p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
