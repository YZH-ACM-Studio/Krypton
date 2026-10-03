import { type ReactNode, startTransition, useDeferredValue, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  ChevronRight,
  Clock,
  Compass,
  ExternalLink,
  MessageSquare,
  Star,
  Users,
} from 'lucide-react';
import { AnnouncementHomeBlock } from '@/components/announcement-home-block';
import { CollectHomeBlock } from '@/components/collect-home-block';
import { MarkdownView } from '@/components/markdown-renderer';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Stat, StatusDot } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { type GenericUserDoc, useBootstrap } from '@/lib/bootstrap';
import { formatDateTime, formatPlainTextSummary, formatRelativeTime, formatShortDate, makeInitials, replaceRouteTokens, toDate } from '@/lib/format';

interface HomeContentDocument {
  _id?: unknown;
  docId?: string | number;
  title?: string;
  beginAt?: unknown;
  endAt?: unknown;
  penaltySince?: unknown;
  rule?: string;
  attend?: number;
  dag?: Array<{ pids?: unknown[] }>;
  content?: string;
  desc?: string;
  owner?: string | number;
  hidden?: boolean;
  nReply?: number;
  updateAt?: unknown;
}

interface HomeTrainingStatus {
  enroll?: boolean;
  donePids?: unknown[];
  contextualProgress?: {
    completedProblemCount?: number;
    totalProblemCount?: number;
  };
}

interface HomePageData {
  contents?: Array<{ sections: Array<[string, unknown]> }>;
}

type StatusTone = 'neutral' | 'info' | 'success' | 'warning';

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
  for (const col of cols) {
    for (const [k, v] of col.sections) {
      if (k === 'error') errors.push(String(v));
      else map.set(k, v);
    }
  }
  return { sections: map, errors };
}

function getUser(udict: Record<string, GenericUserDoc>, uid: string | number | undefined) {
  return uid != null ? (udict[String(uid)] ?? null) : null;
}

function contestState(c: HomeContentDocument): { label: string; tone: StatusTone; pulse: boolean } {
  const now = Date.now();
  const begin = toDate(c.beginAt)?.getTime() || 0;
  const end = toDate(c.endAt)?.getTime() || 0;
  if (!begin || !end) return { label: '待发布', tone: 'neutral', pulse: false };
  if (now < begin) return { label: '即将开始', tone: 'info', pulse: false };
  if (now > end) return { label: '已结束', tone: 'neutral', pulse: false };
  return { label: '进行中', tone: 'success', pulse: true };
}

function homeworkState(h: HomeContentDocument): { label: string; tone: StatusTone; pulse: boolean } {
  const now = Date.now();
  const dl = toDate(h.penaltySince)?.getTime() || 0;
  const hard = toDate(h.endAt)?.getTime() || 0;
  if (!dl) return { label: '待开放', tone: 'neutral', pulse: false };
  if (now < dl) return { label: '进行中', tone: 'success', pulse: true };
  if (hard && now < hard) return { label: '宽限期', tone: 'warning', pulse: false };
  return { label: '已结束', tone: 'neutral', pulse: false };
}

export function trainingProgress(t: HomeContentDocument, st: HomeTrainingStatus) {
  if (!st?.enroll) return null;
  if (st.contextualProgress) {
    const done = Number.isSafeInteger(st.contextualProgress.completedProblemCount) ? st.contextualProgress.completedProblemCount! : 0;
    const total = Number.isSafeInteger(st.contextualProgress.totalProblemCount) ? st.contextualProgress.totalProblemCount! : 0;
    if (!total) return 0;
    return Math.round((done / total) * 100);
  }
  const total = Array.isArray(t.dag) ? t.dag.reduce((n, s) => n + (Array.isArray(s.pids) ? s.pids.length : 0), 0) : 0;
  const done = Array.isArray(st.donePids) ? st.donePids.length : 0;
  if (!total) return 0;
  return Math.round((done / total) * 100);
}

function StatusLine({ label, tone = 'neutral', pulse = false }: { label: string; tone?: StatusTone; pulse?: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-fg">
      <StatusDot tone={tone} pulse={pulse} />
      {label}
    </span>
  );
}

function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild variant="ghost" size="sm">
      <a href={href}>{children}</a>
    </Button>
  );
}

// ── page ──────────────────────────────────────────────────

export function KryptonHomePage() {
  const bs = useBootstrap();
  const { contents = [] } = bs.page.data as HomePageData;
  const { sections, errors } = collectSections(contents);
  const locale = bs.locale || 'zh-CN';
  const showProblems = bs.user.canBrowseProblemBank === true;

  // unpack sections
  const [contests] = readTuple(sections.get('contest'), [[], {}] as [HomeContentDocument[], Record<string, unknown>]);
  const [homework] = readTuple(sections.get('homework'), [[], {}] as [HomeContentDocument[], Record<string, unknown>]);
  const [training, trStatus] = readTuple(sections.get('training'), [[], {}] as [HomeContentDocument[], Record<string, HomeTrainingStatus>]);
  const [discussions] = readTuple(sections.get('discussion'), [[], {}] as [HomeContentDocument[], Record<string, Record<string, unknown>>]);
  const ranking = readList<number>(sections.get('ranking'));
  const [starred] = readTuple(sections.get('starred_problems'), [[], null] as [HomeContentDocument[], null]);
  const [recent] = readTuple(sections.get('recent_problems'), [[], null] as [HomeContentDocument[], null]);

  // search
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const allProblems = [...starred, ...recent].filter((p, i, a) => a.findIndex((q) => `${q.docId}` === `${p.docId}`) === i);
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
    window.location.assign(kw ? `${bs.urls.problems}?q=${encodeURIComponent(kw)}` : bs.urls.problems);
  };

  const stats: Array<{ label: string; value: number; href: string }> = [
    { label: '比赛', value: contests.length, href: bs.urls.contests },
    { label: '作业', value: homework.length, href: bs.urls.homework },
    { label: '题集', value: training.length, href: bs.urls.training },
    { label: '讨论', value: discussions.length, href: bs.urls.discussions },
  ];

  return (
    <Page width="wide">
      <PageHeader
        title={bs.domain.name}
        actions={(
          <>
            {showProblems ? (
              <Button asChild variant="primary">
                <a href={bs.urls.problems}>
                  开始刷题
                  <ArrowRight />
                </a>
              </Button>
            ) : null}
            <Button asChild variant="secondary">
              <a href={bs.urls.contests}>查看比赛</a>
            </Button>
          </>
        )}
      />

      <AnnouncementHomeBlock />

      {bs.domain.bulletin ? (
        <div className="max-w-prose text-sm text-fg-muted">
          <MarkdownView content={bs.domain.bulletin} />
        </div>
      ) : null}

      {showProblems ? (
        <Panel title="快速搜索">
          <div className="flex min-w-0 flex-col gap-3">
            <form
              className="flex min-w-0 flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                submitSearch(search);
              }}
            >
              <SearchInput
                value={search}
                onChange={(e) => startTransition(() => setSearch(e.target.value))}
                placeholder="题号或标题…"
                className="min-w-0 flex-1"
              />
              <Button type="submit" variant="secondary" size="sm" className="shrink-0">
                搜索
              </Button>
            </form>
            {matched.length > 0 ? (
              <div className="flex min-w-0 flex-col divide-y divide-line-subtle overflow-hidden rounded-md bg-surface-sunken">
                {matched.map((p) => (
                  <a
                    key={String(p.docId)}
                    className="flex min-h-11 min-w-0 items-center justify-between px-2 text-sm hover:bg-surface-hover sm:min-h-0 sm:py-1.5"
                    href={replaceRouteTokens(bs.urls.problemDetail, { PID: String(p.docId) })}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {p.docId}. {p.title || '未命名'}
                    </span>
                    <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" />
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </Panel>
      ) : null}

      <Panel>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-4 md:divide-x md:divide-line-subtle [&>*]:md:pl-6 [&>*:first-child]:md:pl-0">
          {stats.map(({ label, value, href }) => (
            <motion.a href={href} key={label} className="min-w-0 rounded-md hover:bg-surface-hover">
              <Stat label={label} value={value} />
            </motion.a>
          ))}
        </div>
      </Panel>

      {errors.length > 0 ? (
        <Alert tone="danger" title="部分模块加载失败">
          {errors.map((msg) => (
            <p key={msg}>{msg}</p>
          ))}
        </Alert>
      ) : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          {/* Contests */}
          <Panel
            title="比赛"
            flush
            actions={(
              <SectionLink href={bs.urls.contests}>
                全部
                <ChevronRight />
              </SectionLink>
            )}
          >
            {contests.length === 0 ? (
              <EmptyState compact title="暂无比赛" />
            ) : (
              <div className="divide-y divide-line-subtle">
                {contests.slice(0, 5).map((c) => {
                  const st = contestState(c);
                  return (
                    <a
                      key={String(c.docId)}
                      className="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-surface-hover"
                      href={replaceRouteTokens(bs.urls.contestDetail, { TID: String(c.docId) })}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="min-w-0 flex-1 truncate text-sm font-medium">{c.title || '未命名比赛'}</p>
                          {c.hidden === true ? (
                            <Badge variant="outline" size="sm" className="shrink-0">
                              已隐藏
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-xs text-fg-subtle">
                          {formatDateTime(c.beginAt, locale)}
                          {c.rule ? ` · ${c.rule}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {c.attend ? (
                          <span className="flex items-center gap-1 text-xs text-fg-subtle tabular">
                            <Users className="size-3.5" />
                            {c.attend}
                          </span>
                        ) : null}
                        <StatusLine label={st.label} tone={st.tone} pulse={st.pulse} />
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </Panel>

          {/* Homework */}
          <Panel
            title="作业"
            flush
            actions={(
              <SectionLink href={bs.urls.homework}>
                全部
                <ChevronRight />
              </SectionLink>
            )}
          >
            {homework.length === 0 ? (
              <EmptyState compact title="暂无作业" />
            ) : (
              <div className="divide-y divide-line-subtle">
                {homework.slice(0, 4).map((h) => {
                  const st = homeworkState(h);
                  return (
                    <a
                      key={String(h.docId)}
                      className="flex min-w-0 items-center justify-between gap-3 px-4 py-3 hover:bg-surface-hover"
                      href={replaceRouteTokens(bs.urls.homeworkDetail, { TID: String(h.docId) })}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{h.title || '未命名作业'}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-fg-subtle">
                          <Clock className="size-3.5" />
                          {formatDateTime(h.penaltySince || h.endAt, locale)}
                        </p>
                      </div>
                      <StatusLine label={st.label} tone={st.tone} pulse={st.pulse} />
                    </a>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel
            title="题集"
            actions={(
              <SectionLink href={bs.urls.training}>
                全部
                <ChevronRight />
              </SectionLink>
            )}
          >
            {training.length === 0 ? (
              <EmptyState compact title="暂无题集" />
            ) : (
              <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {training.slice(0, 4).map((t) => {
                  const pct = trainingProgress(t, trStatus[String(t.docId)] || {});
                  return (
                    <a
                      key={String(t.docId)}
                      className="group min-w-0 rounded-lg border border-line p-3 hover:border-line-strong hover:bg-surface-hover"
                      href={replaceRouteTokens(bs.urls.trainingDetail, { TID: String(t.docId) })}
                    >
                      <p className="min-w-0 truncate text-sm font-medium">{t.title || '未命名题集'}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-fg-subtle">
                        {formatPlainTextSummary(t.content || t.desc) || '一组精选题目'}
                      </p>
                      <div className="mt-2 flex items-center justify-between text-xs text-fg-subtle">
                        <span className="flex items-center gap-1 tabular">
                          <Users className="size-3.5" />
                          {t.attend || 0}
                        </span>
                        {pct !== null ? <span className="font-medium text-brand-fg tabular">{pct}%</span> : <span>未参加</span>}
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel
            title="讨论"
            flush
            actions={(
              <SectionLink href={bs.urls.discussions}>
                全部
                <ChevronRight />
              </SectionLink>
            )}
          >
            {discussions.length === 0 ? (
              <EmptyState compact title="暂无讨论" />
            ) : (
              <div className="divide-y divide-line-subtle">
                {discussions.slice(0, 5).map((d) => {
                  const owner = getUser(bs.udict, d.owner);
                  return (
                    <a
                      key={String(d._id)}
                      className="flex min-w-0 items-start gap-3 px-4 py-3 hover:bg-surface-hover"
                      href={replaceRouteTokens(bs.urls.discussionDetail, { DID: String(d._id) })}
                    >
                      <Avatar className="mt-0.5 size-6">
                        {owner?.avatarUrl ? <AvatarImage src={String(owner.avatarUrl)} alt={String(owner.uname || '')} /> : null}
                        <AvatarFallback className="text-2xs">{makeInitials(owner?.uname || '?')}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{d.title || '无标题'}</p>
                        <p className="mt-0.5 text-xs text-fg-subtle">
                          {owner?.uname || '匿名'} · {d.nReply || 0} 回复 · {formatRelativeTime(d.updateAt, locale)}
                        </p>
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title={bs.user.signedIn ? '个人' : '账号'}>
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex items-center gap-3">
                <Avatar>
                  {bs.user.avatarUrl ? <AvatarImage src={bs.user.avatarUrl} alt={bs.user.name} /> : null}
                  <AvatarFallback>{makeInitials(bs.user.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{bs.user.name}</p>
                  <p className="text-xs text-fg-subtle tabular">{bs.user.signedIn ? `${bs.user.unreadMessages} 条未读` : '游客'}</p>
                </div>
              </div>
              {bs.user.signedIn ? (
                <div className="flex gap-2">
                  <Button asChild variant="secondary" size="sm" className="flex-1">
                    <a href={bs.urls.messages}>
                      <MessageSquare />
                      消息
                    </a>
                  </Button>
                  <Button asChild variant="secondary" size="sm" className="flex-1">
                    <a href={bs.urls.domains}>
                      <Compass />
                      域
                    </a>
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button asChild variant={showProblems ? 'secondary' : 'primary'} size="sm" className="flex-1">
                    <a href={bs.urls.login}>登录</a>
                  </Button>
                  <Button asChild variant="secondary" size="sm" className="flex-1">
                    <a href={bs.urls.register}>注册</a>
                  </Button>
                </div>
              )}
            </div>
          </Panel>

          <CollectHomeBlock />

          {/* Ranking */}
          <Panel
            title="排名"
            actions={(
              <SectionLink href={bs.urls.ranking}>更多</SectionLink>
            )}
          >
            {ranking.length === 0 ? (
              <EmptyState compact title="暂无排名" />
            ) : (
              <div className="flex flex-col gap-1">
                {ranking.slice(0, 8).map((uid, i) => {
                  const u = getUser(bs.udict, uid);
                  return (
                    <div key={uid} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5">
                      <span className="w-5 text-center text-xs font-medium text-fg-subtle tabular">{i + 1}</span>
                      <Avatar className="size-6">
                        {u?.avatarUrl ? <AvatarImage src={String(u.avatarUrl)} alt={String(u?.uname || '')} /> : null}
                        <AvatarFallback className="text-2xs">{makeInitials(u?.uname || '?')}</AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1 truncate text-sm">{u?.uname || `#${uid}`}</span>
                      <span className="text-xs text-fg-subtle tabular">{Math.round(Number(u?.rp || 0))} rp</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          {starred.length > 0 ? (
            <Panel title="收藏题目">
              <div className="flex flex-col gap-0.5">
                {starred.slice(0, 5).map((p) => (
                  <a
                    key={String(p.docId)}
                    className="flex min-h-11 min-w-0 items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-surface-hover sm:min-h-0"
                    href={replaceRouteTokens(bs.urls.problemDetail, { PID: String(p.docId) })}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {p.docId}. {p.title || '未命名'}
                    </span>
                    <Star className="size-3.5 shrink-0 text-warning-fg" />
                  </a>
                ))}
              </div>
            </Panel>
          ) : null}

          {recent.length > 0 ? (
            <Panel title="最近题目">
              <div className="flex flex-col gap-0.5">
                {recent.slice(0, 5).map((p) => (
                  <a
                    key={String(p.docId)}
                    className="flex min-h-11 min-w-0 items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-surface-hover sm:min-h-0"
                    href={replaceRouteTokens(bs.urls.problemDetail, { PID: String(p.docId) })}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {p.docId}. {p.title || '未命名'}
                    </span>
                    <span className="shrink-0 text-xs text-fg-subtle">{formatShortDate(p._id, locale)}</span>
                  </a>
                ))}
              </div>
            </Panel>
          ) : null}

          <Panel title="推荐站点">
            <div className="flex flex-col gap-0.5">
              {[
                { label: 'Codeforces', href: 'https://codeforces.com/' },
                { label: 'AtCoder', href: 'https://atcoder.jp/' },
                { label: 'LibreOJ', href: 'https://loj.ac/' },
                { label: 'UOJ', href: 'https://uoj.ac/' },
              ].map((s) => (
                <a
                  key={s.href}
                  className="flex min-h-11 min-w-0 items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-surface-hover sm:min-h-0"
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>{s.label}</span>
                  <ExternalLink className="size-3.5 text-fg-subtle" />
                </a>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </Page>
  );
}
