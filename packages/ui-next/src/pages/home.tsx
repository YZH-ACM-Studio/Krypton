import { type ReactNode, startTransition, useDeferredValue, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  ExternalLink,
  GraduationCap,
  MessageSquare,
  Search,
  Star,
  Trophy,
  type LucideIcon,
  Users,
  Clock,
  Compass,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { MarkdownView } from '@/components/markdown-renderer';
import { AnnouncementHomeBlock } from '@/components/announcement-home-block';
import { type GenericUserDoc, useBootstrap } from '@/lib/bootstrap';
import {
  formatDateTime,
  formatPlainTextSummary,
  formatRelativeTime,
  formatShortDate,
  makeInitials,
  replaceRouteTokens,
  toDate,
} from '@/lib/format';

type R = Record<string, any>;

// ── data helpers ──────────────────────────────────────────

function readList<T>(v: unknown): T[] {
  return Array.isArray(v) ? v : [];
}

function readTuple<A, B>(v: unknown, fb: [A, B]): [A, B] {
  if (!Array.isArray(v)) return fb;
  return [v[0] as A, (v[1] as B) ?? fb[1]];
}

function collectSections(cols: Array<{ sections: Array<[string, unknown]> }>) {
  const map = new Map<string, unknown>();
  const errors: string[] = [];
  for (const col of cols)
    for (const [k, v] of col.sections)
      k === 'error' ? errors.push(String(v)) : map.set(k, v);
  return { sections: map, errors };
}

function getUser(udict: Record<string, GenericUserDoc>, uid: string | number | undefined) {
  return uid != null ? udict[String(uid)] ?? null : null;
}

function contestState(c: R) {
  const now = Date.now();
  const begin = toDate(c.beginAt)?.getTime() || 0;
  const end = toDate(c.endAt)?.getTime() || 0;
  if (!begin || !end) return { label: '待发布', color: 'secondary' as const };
  if (now < begin) return { label: '即将开始', color: 'outline' as const };
  if (now > end) return { label: '已结束', color: 'secondary' as const };
  return { label: '进行中', color: 'default' as const };
}

function homeworkState(h: R) {
  const now = Date.now();
  const dl = toDate(h.penaltySince)?.getTime() || 0;
  const hard = toDate(h.endAt)?.getTime() || 0;
  if (!dl) return '待开放';
  if (now < dl) return '进行中';
  if (hard && now < hard) return '宽限期';
  return '已结束';
}

function trainingProgress(t: R, st: R) {
  if (!st?.enroll) return null;
  const total = Array.isArray(t.dag)
    ? t.dag.reduce((n: number, s: R) => n + (Array.isArray(s.pids) ? s.pids.length : 0), 0)
    : 0;
  const done = Array.isArray(st.donePids) ? st.donePids.length : 0;
  if (!total) return 0;
  return Math.round((done / total) * 100);
}

// ── tiny building blocks ──────────────────────────────────

function StatCard({ icon: Icon, label, value, href, index }: {
  icon: LucideIcon; label: string; value: number; href: string; index: number;
}) {
  return (
    <motion.a
      href={href}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.05 * index }}
    >
      <Card className="transition-colors hover:bg-accent/50">
        <CardContent className="flex items-center gap-4 p-4">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-5" />
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </CardContent>
      </Card>
    </motion.a>
  );
}

function SectionShell({ title, action, delay = 0, children }: {
  title: string; action?: ReactNode; delay?: number; children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
    >
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-base">{title}</CardTitle>
          {action}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </motion.div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>
  );
}

// ── page ──────────────────────────────────────────────────

export function KryptonHomePage() {
  const bs = useBootstrap();
  const contents = bs.page.data.contents || [];
  const { sections, errors } = collectSections(contents);
  const locale = bs.locale || 'zh-CN';

  // unpack sections
  const [contests] = readTuple(sections.get('contest'), [[], {}] as [R[], Record<string, R>]);
  const [homework, hwStatus] = readTuple(sections.get('homework'), [[], {}] as [R[], Record<string, R>]);
  const [training, trStatus] = readTuple(sections.get('training'), [[], {}] as [R[], Record<string, R>]);
  const [discussions, discNodes] = readTuple(sections.get('discussion'), [[], {}] as [R[], Record<string, Record<string, R>>]);
  const ranking = readList<number>(sections.get('ranking'));
  const [starred] = readTuple(sections.get('starred_problems'), [[], null] as [R[], null]);
  const [recent] = readTuple(sections.get('recent_problems'), [[], null] as [R[], null]);

  // search
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const allProblems = [...starred, ...recent].filter(
    (p, i, a) => a.findIndex((q) => `${q.docId}` === `${p.docId}`) === i,
  );
  const matched = deferred
    ? allProblems
      .filter((p) => {
        const kw = deferred.trim().toLowerCase();
        return `${p.docId}`.includes(kw) || `${p.title || ''}`.toLowerCase().includes(kw);
      })
      .slice(0, 5)
    : [];

  const submitSearch = (q: string) => {
    const kw = q.trim();
    window.location.assign(
      kw ? `${bs.urls.problems}?q=${encodeURIComponent(kw)}` : bs.urls.problems,
    );
  };

  const stats: Array<{ icon: LucideIcon; label: string; value: number; href: string }> = [
    { icon: Trophy, label: '比赛', value: contests.length, href: bs.urls.contests },
    { icon: BookOpen, label: '作业', value: homework.length, href: bs.urls.homework },
    { icon: GraduationCap, label: '训练', value: training.length, href: bs.urls.training },
    { icon: MessageSquare, label: '讨论', value: discussions.length, href: bs.urls.discussions },
  ];

  return (
    <div className="space-y-6">
      {/* ── Announcement block ──────────────────── */}
      <AnnouncementHomeBlock />

      {/* ── Hero ────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <Card className="overflow-hidden border-primary/20 bg-linear-to-br from-primary/5 via-background to-background">
          <CardContent className="grid gap-6 p-6 lg:grid-cols-[1fr_340px]">
            <div className="flex flex-col justify-center gap-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  {bs.domain.name}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  基于 Hydro 构建的现代在线评测系统
                </p>
              </div>
              {bs.domain.bulletin ? (
                <div className="max-w-xl text-sm leading-relaxed text-foreground/80">
                  <MarkdownView content={bs.domain.bulletin} />
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <a href={bs.urls.problems}>
                    开始刷题
                    <ArrowRight className="size-4" />
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a href={bs.urls.contests}>查看比赛</a>
                </Button>
              </div>
            </div>

            {/* Search panel */}
            <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
              <p className="text-sm font-medium">快速搜索</p>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitSearch(search);
                }}
              >
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => startTransition(() => setSearch(e.target.value))}
                    placeholder="题号或标题…"
                    className="pl-8"
                  />
                </div>
                <Button type="submit" size="sm">搜索</Button>
              </form>
              {matched.length > 0 ? (
                <div className="flex flex-col gap-0.5 rounded-md border p-1">
                  {matched.map((p) => (
                    <a
                      key={String(p.docId)}
                      className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                      href={replaceRouteTokens(bs.urls.problemDetail, { PID: String(p.docId) })}
                    >
                      <span className="truncate">{p.docId}. {p.title || '未命名'}</span>
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </motion.section>

      {/* ── Stats ──────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s, i) => (
          <StatCard key={s.label} {...s} index={i} />
        ))}
      </div>

      {/* ── Errors ─────────────────────────────── */}
      {errors.length > 0 ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4">
            <p className="mb-2 text-sm font-medium text-destructive">部分模块加载失败</p>
            {errors.map((msg) => (
              <p key={msg} className="text-sm text-muted-foreground">{msg}</p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* ── Main grid ──────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left column */}
        <div className="space-y-6">
          {/* Contests */}
          <SectionShell
            title="比赛"
            delay={0.1}
            action={
              <Button asChild variant="ghost" size="sm">
                <a href={bs.urls.contests}>全部 <ChevronRight className="size-4" /></a>
              </Button>
            }
          >
            {contests.length === 0 ? <Empty text="暂无比赛" /> : (
              <div className="divide-y">
                {contests.slice(0, 5).map((c) => {
                  const st = contestState(c);
                  return (
                    <a
                      key={String(c.docId)}
                      className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 transition-colors hover:bg-accent/50 -mx-2 px-2 rounded-md"
                      href={replaceRouteTokens(bs.urls.contestDetail, { TID: String(c.docId) })}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium">{c.title || '未命名比赛'}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatDateTime(c.beginAt, locale)}{c.rule ? ` · ${c.rule}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {c.attend ? (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Users className="size-3" />{c.attend}
                          </span>
                        ) : null}
                        <Badge variant={st.color}>{st.label}</Badge>
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </SectionShell>

          {/* Homework */}
          <SectionShell
            title="作业"
            delay={0.15}
            action={
              <Button asChild variant="ghost" size="sm">
                <a href={bs.urls.homework}>全部 <ChevronRight className="size-4" /></a>
              </Button>
            }
          >
            {homework.length === 0 ? <Empty text="暂无作业" /> : (
              <div className="divide-y">
                {homework.slice(0, 4).map((h) => (
                  <a
                    key={String(h.docId)}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 transition-colors hover:bg-accent/50 -mx-2 px-2 rounded-md"
                    href={replaceRouteTokens(bs.urls.homeworkDetail, { TID: String(h.docId) })}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{h.title || '未命名作业'}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3" />
                        {formatDateTime(h.penaltySince || h.endAt, locale)}
                      </p>
                    </div>
                    <Badge variant="secondary">{homeworkState(h)}</Badge>
                  </a>
                ))}
              </div>
            )}
          </SectionShell>

          {/* Training */}
          <SectionShell
            title="训练"
            delay={0.2}
            action={
              <Button asChild variant="ghost" size="sm">
                <a href={bs.urls.training}>全部 <ChevronRight className="size-4" /></a>
              </Button>
            }
          >
            {training.length === 0 ? <Empty text="暂无训练计划" /> : (
              <div className="grid gap-3 sm:grid-cols-2">
                {training.slice(0, 4).map((t) => {
                  const pct = trainingProgress(t, trStatus[t.docId] || {});
                  return (
                    <a
                      key={String(t.docId)}
                      className="group rounded-lg border p-3 transition-colors hover:bg-accent/50"
                      href={replaceRouteTokens(bs.urls.trainingDetail, { TID: String(t.docId) })}
                    >
                      <p className="truncate text-sm font-medium">{t.title || '未命名训练'}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {formatPlainTextSummary(t.content || t.desc) || '一组精选题目'}
                      </p>
                      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Users className="size-3" />{t.attend || 0}</span>
                        {pct !== null ? (
                          <span className="font-medium text-primary">{pct}%</span>
                        ) : (
                          <span>未参加</span>
                        )}
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </SectionShell>

          {/* Discussions */}
          <SectionShell
            title="讨论"
            delay={0.25}
            action={
              <Button asChild variant="ghost" size="sm">
                <a href={bs.urls.discussions}>全部 <ChevronRight className="size-4" /></a>
              </Button>
            }
          >
            {discussions.length === 0 ? <Empty text="暂无讨论" /> : (
              <div className="divide-y">
                {discussions.slice(0, 5).map((d) => {
                  const owner = getUser(bs.udict, d.owner);
                  return (
                    <a
                      key={String(d._id)}
                      className="flex items-start gap-3 py-3 first:pt-0 last:pb-0 transition-colors hover:bg-accent/50 -mx-2 px-2 rounded-md"
                      href={replaceRouteTokens(bs.urls.discussionDetail, { DID: String(d._id) })}
                    >
                      <Avatar className="mt-0.5 size-7">
                        <AvatarFallback className="text-[10px]">
                          {makeInitials(owner?.uname || '?')}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium">{d.title || '无标题'}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {owner?.uname || '匿名'} · {d.nReply || 0} 回复 · {formatRelativeTime(d.updateAt, locale)}
                        </p>
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </SectionShell>
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* User card */}
          <SectionShell title={bs.user.signedIn ? '个人' : '账号'} delay={0.1}>
            <div className="flex items-center gap-3">
              <Avatar>
                <AvatarFallback>{makeInitials(bs.user.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{bs.user.name}</p>
                <p className="text-xs text-muted-foreground">
                  {bs.user.signedIn ? `${bs.user.unreadMessages} 条未读` : '游客'}
                </p>
              </div>
            </div>
            {bs.user.signedIn ? (
              <div className="mt-3 flex gap-2">
                <Button asChild variant="outline" size="sm" className="flex-1">
                  <a href={bs.urls.messages}><MessageSquare className="size-4" />消息</a>
                </Button>
                <Button asChild variant="outline" size="sm" className="flex-1">
                  <a href={bs.urls.domains}><Compass className="size-4" />域</a>
                </Button>
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                <Button asChild size="sm" className="flex-1">
                  <a href={bs.urls.login}>登录</a>
                </Button>
                <Button asChild variant="outline" size="sm" className="flex-1">
                  <a href={bs.urls.register}>注册</a>
                </Button>
              </div>
            )}
          </SectionShell>

          {/* Ranking */}
          <SectionShell
            title="排名"
            delay={0.15}
            action={
              <Button asChild variant="ghost" size="sm">
                <a href={bs.urls.ranking}>更多</a>
              </Button>
            }
          >
            {ranking.length === 0 ? <Empty text="暂无排名" /> : (
              <div className="space-y-1">
                {ranking.slice(0, 8).map((uid, i) => {
                  const u = getUser(bs.udict, uid);
                  return (
                    <div key={uid} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                      <span className="w-5 text-center text-xs font-medium text-muted-foreground">{i + 1}</span>
                      <Avatar className="size-6">
                        <AvatarFallback className="text-[10px]">{makeInitials(u?.uname || '?')}</AvatarFallback>
                      </Avatar>
                      <span className="flex-1 truncate text-sm">{u?.uname || `#${uid}`}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{Math.round(Number(u?.rp || 0))} rp</span>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionShell>

          {/* Starred */}
          {starred.length > 0 ? (
            <SectionShell title="收藏题目" delay={0.2}>
              <div className="space-y-0.5">
                {starred.slice(0, 5).map((p) => (
                  <a
                    key={String(p.docId)}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                    href={replaceRouteTokens(bs.urls.problemDetail, { PID: String(p.docId) })}
                  >
                    <span className="truncate">{p.docId}. {p.title || '未命名'}</span>
                    <Star className="size-3.5 shrink-0 text-yellow-500" />
                  </a>
                ))}
              </div>
            </SectionShell>
          ) : null}

          {/* Recent problems */}
          {recent.length > 0 ? (
            <SectionShell title="最近题目" delay={0.25}>
              <div className="space-y-0.5">
                {recent.slice(0, 5).map((p) => (
                  <a
                    key={String(p.docId)}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                    href={replaceRouteTokens(bs.urls.problemDetail, { PID: String(p.docId) })}
                  >
                    <span className="truncate">{p.docId}. {p.title || '未命名'}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatShortDate(p._id, locale)}</span>
                  </a>
                ))}
              </div>
            </SectionShell>
          ) : null}

          {/* Links */}
          <SectionShell title="推荐站点" delay={0.3}>
            <div className="space-y-0.5">
              {[
                { label: 'Codeforces', href: 'https://codeforces.com/' },
                { label: 'AtCoder', href: 'https://atcoder.jp/' },
                { label: 'LibreOJ', href: 'https://loj.ac/' },
                { label: 'UOJ', href: 'https://uoj.ac/' },
              ].map((s) => (
                <a
                  key={s.href}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>{s.label}</span>
                  <ExternalLink className="size-3.5 text-muted-foreground" />
                </a>
              ))}
            </div>
          </SectionShell>
        </div>
      </div>
    </div>
  );
}
