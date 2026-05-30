import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Award,
  CheckCircle2,
  ChevronRight,
  Clock,
  GitBranch,
  LayoutGrid,
  List,
  Lock,
  PlayCircle,
  Search,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Pagination } from '@/components/ui/pagination';
import { MarkdownView } from '@/components/markdown-renderer';
import { useBootstrap } from '@/lib/bootstrap';
import { formatPlainTextSummary, replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

/* ────────────────────────────────────────────────────────────────── */
/*  Training list page                                                */
/* ────────────────────────────────────────────────────────────────── */

const VIEW_KEY = 'krypton.training.view';

export function TrainingPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdocs: R[] = data.tdocs || [];
  const page = Number(data.page) || 1;
  const tpcount = Number(data.tpcount) || 1;
  const tsdict: Record<string, R> = data.tsdict || {};
  const q: string = data.q || '';

  const [view, setView] = useState<'cards' | 'list'>(() => {
    try { return (localStorage.getItem(VIEW_KEY) as any) || 'cards'; } catch { return 'cards'; }
  });
  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ }
  }, [view]);

  const [statusFilter, setStatusFilter] = useState<'all' | 'enrolled' | 'done' | 'not_started'>('all');

  // Compute per-training stats
  const enriched = useMemo(() => tdocs.map((t) => {
    const ts = tsdict[String(t.docId)] || {};
    const total = Array.isArray(t.dag)
      ? t.dag.reduce((n: number, s: R) => n + (Array.isArray(s.pids) ? s.pids.length : 0), 0)
      : 0;
    const done = Array.isArray(ts.donePids) ? ts.donePids.length : 0;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const sectionCount = Array.isArray(t.dag) ? t.dag.length : 0;
    const sectionDone = Array.isArray(ts.doneNids) ? ts.doneNids.length : 0;
    return {
      t,
      ts,
      total,
      done,
      pct,
      sectionCount,
      sectionDone,
      enrolled: !!ts.enroll,
      fullyDone: total > 0 && done === total,
    };
  }), [tdocs, tsdict]);

  const filtered = useMemo(() => enriched.filter((e) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'enrolled') return e.enrolled && !e.fullyDone;
    if (statusFilter === 'done') return e.fullyDone;
    if (statusFilter === 'not_started') return !e.enrolled;
    return true;
  }), [enriched, statusFilter]);

  const stats = useMemo(() => ({
    total: enriched.length,
    enrolled: enriched.filter((e) => e.enrolled).length,
    inProgress: enriched.filter((e) => e.enrolled && !e.fullyDone && e.done > 0).length,
    done: enriched.filter((e) => e.fullyDone).length,
    totalProblems: enriched.reduce((n, e) => n + e.total, 0),
  }), [enriched]);

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">训练</h1>
          <p className="text-sm text-muted-foreground">系统化训练计划，按 DAG 推进</p>
        </div>
        <Button asChild>
          <a href={`${bs.urls.training}/create`}>创建训练</a>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCell label="进行中" value={stats.inProgress} icon={<PlayCircle className="size-4 text-green-600" />} active={statusFilter === 'enrolled'} onClick={() => setStatusFilter(statusFilter === 'enrolled' ? 'all' : 'enrolled')} />
        <StatCell label="已完成" value={stats.done} icon={<CheckCircle2 className="size-4 text-primary" />} active={statusFilter === 'done'} onClick={() => setStatusFilter(statusFilter === 'done' ? 'all' : 'done')} />
        <StatCell label="未参加" value={stats.total - stats.enrolled} icon={<Lock className="size-4 text-muted-foreground" />} active={statusFilter === 'not_started'} onClick={() => setStatusFilter(statusFilter === 'not_started' ? 'all' : 'not_started')} />
        <StatCell label="总题数" value={stats.totalProblems} icon={<Award className="size-4 text-amber-600" />} />
      </div>

      {/* Search + view */}
      <Card>
        <CardContent className="p-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px] space-y-1.5">
              <label className="text-xs text-muted-foreground">搜索</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  name="q"
                  defaultValue={q}
                  className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm"
                  placeholder="训练标题"
                />
              </div>
            </div>
            <Button type="submit" size="sm">筛选</Button>
            <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-0.5">
              <button type="button" onClick={() => setView('cards')} className={`p-1.5 rounded ${view === 'cards' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} title="卡片视图">
                <LayoutGrid className="size-3.5" />
              </button>
              <button type="button" onClick={() => setView('list')} className={`p-1.5 rounded ${view === 'list' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} title="列表视图">
                <List className="size-3.5" />
              </button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* List */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {tdocs.length === 0 ? '暂无训练计划' : '没有符合条件的训练'}
          </CardContent>
        </Card>
      ) : view === 'cards' ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((e) => <TrainingCard key={String(e.t.docId)} e={e} bs={bs} />)}
        </div>
      ) : (
        <TrainingTable rows={filtered} bs={bs} />
      )}

      <Pagination current={page} total={tpcount} baseUrl={bs.urls.training} />
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

function TrainingCard({ e, bs }: { e: any; bs: ReturnType<typeof useBootstrap> }) {
  const { t, ts, total, done, pct, sectionCount, enrolled, fullyDone } = e;
  const url = replaceRouteTokens(bs.urls.trainingDetail, { TID: String(t.docId) });
  return (
    <a href={url} className="group block">
      <Card className="h-full transition-all group-hover:border-primary/40 group-hover:shadow-md">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="line-clamp-2 text-base leading-tight">{t.title || '未命名训练'}</CardTitle>
            {fullyDone ? (
              <Badge variant="default" className="shrink-0">已完成</Badge>
            ) : enrolled ? (
              <Badge variant="secondary" className="shrink-0">进行中</Badge>
            ) : (
              <Badge variant="outline" className="shrink-0">未参加</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="line-clamp-2 text-sm text-muted-foreground min-h-[40px]">
            {formatPlainTextSummary(t.content || t.desc) || '精选题目训练'}
          </p>

          {/* Mini DAG preview */}
          <DagThumbnail
            dag={t.dag || []}
            doneNids={Array.isArray(ts.doneNids) ? ts.doneNids : []}
            donePids={Array.isArray(ts.donePids) ? ts.donePids : []}
          />

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Users className="size-3" />{t.attend || 0}</span>
            <span>{sectionCount} 段 · {total} 题</span>
          </div>

          {enrolled ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">进度</span>
                <span className="font-mono text-primary">{done}/{total} · {pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </a>
  );
}

function TrainingTable({ rows, bs }: { rows: any[]; bs: ReturnType<typeof useBootstrap> }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="divide-y">
          {rows.map((e) => (
            <a
              key={String(e.t.docId)}
              href={replaceRouteTokens(bs.urls.trainingDetail, { TID: String(e.t.docId) })}
              className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-accent"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{e.t.title || '未命名'}</span>
                  {e.fullyDone ? <Badge variant="default" className="text-[10px]">已完成</Badge> :
                    e.enrolled ? <Badge variant="secondary" className="text-[10px]">进行中</Badge> :
                      <Badge variant="outline" className="text-[10px]">未参加</Badge>}
                </div>
                <p className="line-clamp-1 text-xs text-muted-foreground">
                  {formatPlainTextSummary(e.t.content || e.t.desc) || '—'}
                </p>
              </div>
              <span className="hidden sm:block text-xs text-muted-foreground tabular-nums w-20 text-right">{e.sectionCount} 段</span>
              <span className="hidden sm:block text-xs text-muted-foreground tabular-nums w-20 text-right">{e.done}/{e.total}</span>
              <span className="hidden md:flex items-center gap-1 text-xs text-muted-foreground w-16 justify-end">
                <Users className="size-3" />{e.t.attend || 0}
              </span>
              <span className="w-16 font-mono text-sm text-primary tabular-nums text-right">{e.enrolled ? `${e.pct}%` : '—'}</span>
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * GitHub-contributions style heat strip: one tiny cell per section, color
 * encodes status. Scales gracefully from 4 sections to 100+ in the same
 * card width because cells flex.
 */
function DagThumbnail({ dag, doneNids, donePids, nsdictHint }: {
  dag: R[];
  doneNids: number[];
  /** when nsdict isn't available on the list page we approximate from donePids */
  donePids?: number[];
  /** Optional precomputed status dict — preferred when caller has it. */
  nsdictHint?: Record<string, R>;
}) {
  if (!Array.isArray(dag) || dag.length === 0) return null;
  const doneNidSet = new Set((doneNids || []).map(Number));
  const donePidSet = new Set((donePids || []).map(Number));

  // Status for each section: done / progress / open / locked
  // Locked = any required section not in doneNidSet AND this section also not done.
  function statusOf(s: R): 'done' | 'progress' | 'open' | 'locked' {
    if (nsdictHint && nsdictHint[s._id]) {
      const ns = nsdictHint[s._id];
      if (ns.isDone) return 'done';
      if (ns.isProgress) return 'progress';
      if (ns.isOpen) return 'open';
      return 'locked';
    }
    if (doneNidSet.has(Number(s._id))) return 'done';
    const reqs: number[] = Array.isArray(s.requireNids) ? s.requireNids.map(Number) : [];
    const locked = reqs.some((r) => !doneNidSet.has(r));
    if (locked) return 'locked';
    // Has it been touched? If any of its pids in donePidSet, mark progress.
    if (donePidSet.size > 0 && Array.isArray(s.pids) && s.pids.some((p: any) => donePidSet.has(Number(p)))) {
      return 'progress';
    }
    return 'open';
  }

  // Class per status; opacity stays at 1 so cells don't darken when overlapping.
  const classOf = (st: 'done' | 'progress' | 'open' | 'locked') => ({
    done: 'bg-green-500',
    progress: 'bg-blue-500',
    open: 'bg-muted-foreground/30',
    locked: 'bg-muted-foreground/10',
  } as const)[st];

  return (
    <div className="flex h-3 w-full gap-[2px]">
      {dag.map((s, i) => (
        <div
          key={s._id ?? i}
          className={`flex-1 rounded-[2px] ${classOf(statusOf(s))}`}
          title={`${s.title || `阶段 ${s._id}`} · ${statusOf(s)}`}
        />
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Training detail page                                              */
/* ────────────────────────────────────────────────────────────────── */

export function TrainingDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const pdict: Record<string, R> = data.pdict || {};
  const psdict: Record<string, R> = data.psdict || {};
  const tsdoc: R = data.tsdoc || {};
  const ndict: Record<string, R> = data.ndict || {};
  const nsdict: Record<string, R> = data.nsdict || {};
  const enrolled = !!tsdoc.enroll;
  const dag: R[] = Array.isArray(tdoc.dag) ? tdoc.dag : [];

  const totalProblems = dag.reduce((n, s) => n + (Array.isArray(s.pids) ? s.pids.length : 0), 0);
  const doneProblems = Array.isArray(tsdoc.donePids) ? tsdoc.donePids.length : 0;
  const overallPct = totalProblems > 0 ? Math.round((doneProblems / totalProblems) * 100) : 0;
  const doneNids: number[] = Array.isArray(tsdoc.doneNids) ? tsdoc.doneNids : [];

  // First unsolved problem (for "continue" button)
  const continueLink = (() => {
    if (!enrolled) return null;
    for (const node of dag) {
      const ns = nsdict[node._id] || {};
      if (!ns.isOpen && !ns.isProgress) continue; // locked or done
      for (const pid of (node.pids || [])) {
        const ps = psdict[String(pid)] || {};
        if (ps.status !== 1) {
          return replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });
        }
      }
    }
    return null;
  })();

  // Stage list now renders in `dag` config order — the editor's drag-reorder
  // is the source of truth. (Old status-priority sort was removed when the
  // DAG canvas was dropped; users browse stages top-down like a TOC now.)

  const [selectedNid, setSelectedNid] = useState<number | null>(() => {
    const inProg = dag.find((n) => nsdict[n._id]?.isProgress);
    if (inProg) return inProg._id;
    const open = dag.find((n) => nsdict[n._id]?.isOpen && !nsdict[n._id]?.isDone);
    if (open) return open._id;
    return dag[0]?._id ?? null;
  });

  const selected = selectedNid != null ? ndict[selectedNid] || dag.find((n) => n._id === selectedNid) : null;
  const selectedStatus = selectedNid != null ? nsdict[selectedNid] || {} : {};
  const isOwner = data.tdoc?.owner === bs.user?.id;
  const trainingUrl = replaceRouteTokens(bs.urls.trainingDetail, { TID: String(tdoc.docId) });

  return (
    <motion.div
      className="space-y-5"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <a href={bs.urls.training} className="hover:text-primary">训练</a>
        <ChevronRight className="size-3" />
        <span className="text-foreground">{tdoc.title || '训练'}</span>
      </div>

      {/* Hero (compact, single line) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold truncate">{tdoc.title || '训练'}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Users className="size-3" />{tdoc.attend || 0} 人参加</span>
            <span>·</span>
            <span>{dag.length} 段 · {totalProblems} 题</span>
            {data.udoc?.uname ? <><span>·</span><span>由 {data.udoc.uname} 创建</span></> : null}
            {Array.isArray(data.missing) && data.missing.length > 0 ? (
              <>
                <span>·</span>
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <X className="size-3" />
                  {data.missing.length} 题已失效
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {!enrolled ? (
            <form method="post">
              <input type="hidden" name="operation" value="enroll" />
              <Button type="submit">参加训练</Button>
            </form>
          ) : null}
          {continueLink ? (
            <Button asChild>
              <a href={continueLink}>
                <PlayCircle className="mr-1.5 size-4" />继续训练
              </a>
            </Button>
          ) : null}
          {isOwner ? (
            <Button asChild variant="outline" size="sm">
              <a href={`${trainingUrl}/edit`}>编辑</a>
            </Button>
          ) : null}
        </div>
      </div>

      {/* Top stats bar — 4 inline cells */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatBlock label="总体进度" big={`${overallPct}%`} small={`${doneProblems}/${totalProblems} 题`} progress={overallPct} />
            <StatBlock label="已完成阶段" big={String(doneNids.length)} small={`/ ${dag.length} 段`} />
            <StatBlock label="已通过题数" big={String(doneProblems)} small={`/ ${totalProblems} 题`} />
            <StatBlock label="平均进度" big={`${dag.length ? Math.round(Object.values(nsdict).reduce((n: number, x: any) => n + (x?.progress || 0), 0) / dag.length) : 0}%`} small="每阶段均值" />
          </div>
        </CardContent>
      </Card>

      {/* Description (optional, above main grid) */}
      {tdoc.content || tdoc.description ? (
        <Card>
          <CardContent className="p-4">
            <MarkdownView content={tdoc.content || tdoc.description} className="text-sm" />
          </CardContent>
        </Card>
      ) : null}

      {/* Main 64 : 36 grid — left = selected section, right = section list + DAG */}
      <div className="grid gap-5 lg:grid-cols-[64fr_36fr]">
        {/* LEFT — selected section detail */}
        <div className="space-y-4 min-w-0">
          {selected ? (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base truncate">{selected.title || `阶段 ${selected._id}`}</CardTitle>
                  <SectionStatusBadge ns={selectedStatus} />
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{(selected.pids || []).length} 题</span>
                  <span>·</span>
                  <span>进度 {selectedStatus.progress ?? 0}%</span>
                </div>
              </CardHeader>
              <CardContent>
                {selected.content || selected.description ? (
                  <div className="mb-3 rounded-md bg-muted/30 p-3">
                    <MarkdownView content={selected.content || selected.description} className="text-xs" />
                  </div>
                ) : null}
                {(selected.requireNids || []).length > 0 ? (
                  <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">前置依赖：</span>
                    {(selected.requireNids || []).map((rid: any) => {
                      const r = ndict[rid] || dag.find((n) => n._id === rid);
                      const done = doneNids.includes(Number(rid));
                      return (
                        <button
                          key={String(rid)}
                          type="button"
                          onClick={() => setSelectedNid(Number(rid))}
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${done ? 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'}`}
                        >
                          {done ? <CheckCircle2 className="size-2.5" /> : <Lock className="size-2.5" />}
                          {r?.title || `阶段 ${rid}`}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  {(selected.pids || []).map((pid: string | number) => {
                    const p = pdict[String(pid)] || {};
                    const ps = psdict[String(pid)] || {};
                    const accepted = ps.status === 1;
                    return (
                      <a
                        key={String(pid)}
                        href={replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) })}
                        className={`flex items-center justify-between rounded-md border px-3 py-2 transition-colors hover:bg-accent ${accepted ? 'border-green-200 bg-green-50/30 dark:border-green-900/40 dark:bg-green-950/15' : ''}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {accepted ? <CheckCircle2 className="size-3.5 text-green-600 shrink-0" /> : ps.status ? <Clock className="size-3.5 text-amber-600 shrink-0" /> : null}
                            <span className="font-mono text-[10px] text-muted-foreground">{pid}</span>
                            <span className="truncate text-sm font-medium">{p.title || '未命名'}</span>
                          </div>
                          <div className="ml-5 mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                            <span>通过率 {p.nSubmit ? Math.round((p.nAccept / p.nSubmit) * 100) : 0}%</span>
                            <span>·</span>
                            <span>{p.nAccept || 0}/{p.nSubmit || 0}</span>
                          </div>
                        </div>
                        {accepted
                          ? <Badge variant="default" className="text-[10px]">AC</Badge>
                          : ps.status
                            ? <Badge variant="secondary" className="text-[10px]">尝试中</Badge>
                            : null}
                      </a>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                选择一个阶段查看题目
              </CardContent>
            </Card>
          )}
        </div>

        {/* RIGHT — section list (config order, card-style rows with status dot).
            DAG canvas removed per grill; ordering follows tdoc.dag array order
            so the editor's drag-reorder controls the user-facing sequence. */}
        <div className="space-y-4 min-w-0">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">阶段</CardTitle>
                <span className="text-[10px] text-muted-foreground">{dag.length} 段</span>
              </div>
            </CardHeader>
            <CardContent className="p-3">
              <ScrollArea className="h-[60vh]">
                <div className="space-y-2 pr-2">
                  {dag.map((s, i) => {
                    const ns = nsdict[s._id] || {};
                    const isSelected = selectedNid === s._id;
                    return (
                      <button
                        key={String(s._id)}
                        type="button"
                        onClick={() => setSelectedNid(s._id)}
                        className={`flex w-full items-center gap-3 rounded-md border px-4 py-3.5 text-left transition-colors hover:bg-accent ${
                          isSelected
                            ? 'border-primary/50 bg-accent/60 ring-1 ring-primary/30'
                            : 'border-border'
                        }`}
                      >
                        <SectionStatusDot ns={ns} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-muted-foreground">#{i + 1}</span>
                            <span className="truncate text-sm font-medium">{s.title || `阶段 ${s._id}`}</span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span>{s.pids?.length || 0} 题</span>
                            <span>·</span>
                            <span>进度 {ns.progress ?? 0}%</span>
                            {(s.requireNids || []).length > 0 ? (
                              <>
                                <span>·</span>
                                <span>依赖 {s.requireNids.length}</span>
                              </>
                            ) : null}
                          </div>
                        </div>
                        <SectionStatusBadge ns={ns} />
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </motion.div>
  );
}

function StatBlock({ label, big, small, progress }: { label: string; big: string; small?: string; progress?: number }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums">{big}</span>
        {small ? <span className="text-[11px] text-muted-foreground">{small}</span> : null}
      </div>
      {typeof progress === 'number' ? (
        <div className="mt-1.5 h-1 rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  DAG layout + canvas                                               */
/* ────────────────────────────────────────────────────────────────── */

interface DagLayout {
  width: number;
  height: number;
  nodes: { id: any; x: number; y: number; depth: number }[];
  edges: { from: any; to: any; d: string }[];
}

/**
 * Layered layout: assign each node a depth (longest path from a root),
 * spread nodes within each layer vertically.
 *
 * Pure function — usable from any component.
 */
function computeDagLayout(dag: R[], width: number, height: number, padding: number): DagLayout {
  if (!dag.length) return { width, height, nodes: [], edges: [] };

  const byId = new Map<any, R>();
  for (const n of dag) byId.set(n._id, n);

  // Compute depth via memoized recursion.
  const depthCache = new Map<any, number>();
  function depthOf(nid: any, visiting = new Set<any>()): number {
    if (depthCache.has(nid)) return depthCache.get(nid)!;
    if (visiting.has(nid)) return 0; // cycle guard
    visiting.add(nid);
    const node = byId.get(nid);
    if (!node || !Array.isArray(node.requireNids) || node.requireNids.length === 0) {
      depthCache.set(nid, 0);
      return 0;
    }
    let d = 0;
    for (const pid of node.requireNids) d = Math.max(d, depthOf(pid, visiting) + 1);
    visiting.delete(nid);
    depthCache.set(nid, d);
    return d;
  }

  // Group nodes by depth
  const layers = new Map<number, any[]>();
  let maxDepth = 0;
  for (const n of dag) {
    const d = depthOf(n._id);
    maxDepth = Math.max(maxDepth, d);
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d)!.push(n._id);
  }

  const cols = maxDepth + 1;
  const colWidth = (width - padding * 2) / Math.max(1, cols - 1 || 1);
  const positions = new Map<any, { x: number; y: number; depth: number }>();
  for (const [d, ids] of layers) {
    const rowCount = ids.length;
    ids.forEach((id, i) => {
      const x = cols === 1 ? width / 2 : padding + d * colWidth;
      const y = padding + ((height - padding * 2) * (i + 1)) / (rowCount + 1);
      positions.set(id, { x, y, depth: d });
    });
  }

  const nodes = dag.map((n) => ({ id: n._id, ...positions.get(n._id)! }));

  const edges: { from: any; to: any; d: string }[] = [];
  for (const n of dag) {
    if (!Array.isArray(n.requireNids)) continue;
    const to = positions.get(n._id);
    if (!to) continue;
    for (const reqId of n.requireNids) {
      const from = positions.get(reqId);
      if (!from) continue;
      const cx = (from.x + to.x) / 2;
      const d = `M ${from.x},${from.y} C ${cx},${from.y} ${cx},${to.y} ${to.x},${to.y}`;
      edges.push({ from: reqId, to: n._id, d });
    }
  }

  return { width, height, nodes, edges };
}

/** Hook wrapper around computeDagLayout for components. */
function useDagLayout(dag: R[], width: number, height: number, padding: number): DagLayout {
  return useMemo(() => computeDagLayout(dag, width, height, padding), [dag, width, height, padding]);
}

function DagCanvas({
  dag,
  nsdict,
  selectedNid,
  onSelectNid,
  compact,
}: {
  dag: R[];
  nsdict: Record<string, R>;
  selectedNid: number | null;
  onSelectNid: (nid: number) => void;
  /** Smaller canvas + smaller nodes for the right-column placement. */
  compact?: boolean;
}) {
  // Auto-size: tall enough for the most-populated layer, wide enough for the longest chain.
  // Compact mode roughly halves the canvas while still showing labels.
  const layout = compact
    ? useDagLayout(dag, 380, Math.max(220, dag.length * 18), 20)
    : useDagLayout(dag, 720, Math.max(180, dag.length * 24), 30);
  const nodeR = compact ? 7 : 10;
  const nodeRSelected = compact ? 10 : 14;
  const labelLen = compact ? 8 : 12;
  const labelDY = compact ? 22 : 28;
  const labelClass = compact ? 'text-[9px]' : 'text-[10px]';
  const minWidth = compact ? 280 : 360;

  function fillFor(ns: R): string {
    if (ns.isDone) return 'fill-green-500';
    if (ns.isProgress) return 'fill-blue-500';
    if (ns.isOpen) return 'fill-muted-foreground/40';
    return 'fill-muted-foreground/15';
  }

  function strokeFor(ns: R): string {
    if (ns.isDone) return 'stroke-green-700';
    if (ns.isProgress) return 'stroke-blue-700';
    if (ns.isOpen) return 'stroke-muted-foreground/70';
    return 'stroke-muted-foreground/30';
  }

  return (
    <ScrollArea orientation="horizontal">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="w-full"
        style={{ minWidth, height: layout.height }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* edges */}
        {layout.edges.map((e, i) => {
          const fromNs = nsdict[e.from] || {};
          const toNs = nsdict[e.to] || {};
          const dim = !fromNs.isDone && !toNs.isProgress && !toNs.isOpen;
          return (
            <path
              key={i}
              d={e.d}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray={dim ? '4 3' : undefined}
              className={dim ? 'text-muted-foreground/30' : 'text-muted-foreground/60'}
            />
          );
        })}
        {/* nodes */}
        {layout.nodes.map((n) => {
          const node = dag.find((d) => d._id === n.id);
          const ns = nsdict[n.id] || {};
          const selected = selectedNid === n.id;
          return (
            <g
              key={String(n.id)}
              transform={`translate(${n.x},${n.y})`}
              onClick={() => onSelectNid(n.id)}
              style={{ cursor: 'pointer' }}
            >
              <circle
                r={selected ? nodeRSelected : nodeR}
                className={`${fillFor(ns)} ${strokeFor(ns)} transition-all`}
                strokeWidth={selected ? 3 : 2}
              />
              <text
                y={labelDY}
                textAnchor="middle"
                className={`fill-foreground ${labelClass} font-medium select-none`}
                style={{ pointerEvents: 'none' }}
              >
                {(node?.title || `阶段 ${n.id}`).slice(0, labelLen)}
              </text>
              {ns.isDone ? (
                <text
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className={`fill-white ${labelClass} font-bold select-none`}
                  style={{ pointerEvents: 'none' }}
                >
                  ✓
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </ScrollArea>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium tabular-nums">{value}</span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`size-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function SectionStatusBadge({ ns }: { ns: R }) {
  if (ns.isInvalid) return <Badge variant="destructive" className="text-[10px]">无效</Badge>;
  if (ns.isDone) return <Badge variant="default" className="text-[10px]">已完成</Badge>;
  if (ns.isProgress) return <Badge variant="secondary" className="text-[10px]">进行中</Badge>;
  if (ns.isOpen) return <Badge variant="outline" className="text-[10px]">可解锁</Badge>;
  return <Badge variant="outline" className="text-[10px] opacity-60">已锁定</Badge>;
}

function SectionStatusDot({ ns }: { ns: R }) {
  let cls = 'bg-muted-foreground/30';
  if (ns.isDone) cls = 'bg-green-500';
  else if (ns.isProgress) cls = 'bg-blue-500';
  else if (ns.isOpen) cls = 'bg-muted-foreground/50';
  else cls = 'bg-muted-foreground/15';
  return <span className={`size-2.5 rounded-full shrink-0 ${cls}`} />;
}
