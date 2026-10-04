import { Award, CheckCircle2, Clock, LayoutGrid, List, Lock, PlayCircle, Search, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { MarkdownView } from '@/components/markdown-renderer';
import { RedeemDialogButton } from '@/components/redeem-dialog';
import { Badge } from '@/components/ui/badge';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { Progress, Stat, StatusDot } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Page, PageHeader, Toolbar } from '@/components/ui/page';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Verdict } from '@/components/ui/verdict';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { formatPlainTextSummary, replaceRouteTokens } from '@/lib/format';
import { practiceProblemEntryUrl } from '@/lib/practice-integrity';
import { useChapterQuery } from './course/chapter-query';
import {
  isStageEnterable,
  matchesProblemSetBucket,
  problemSetAccessSources,
  problemSetSourceLabel,
  stageLockReason,
  type ProblemSetAccessDecision,
  type ProblemSetAccessSource,
  type ProblemSetListBucket,
} from './training-access';
import {
  resolveTrainingListProgress,
  searchTrainingProblems,
  type TrainingListContextualProgress,
  type TrainingProblemSearchRow,
} from './training-search';

/** Section node of a training DAG (serialized hydrooj `TrainingNode`). */
interface TrainingDagNode {
  _id: number;
  title: string;
  content?: string;
  /** Legacy field kept by old editors; rendered like `content`. */
  description?: string;
  requireNids: number[];
  pids: number[];
}

/** Training document fields read by the list and detail pages. */
interface TrainingDoc {
  docId: string;
  title: string;
  owner?: number;
  content?: string;
  description?: string;
  /** Legacy list-page summary field. */
  desc?: string;
  attend?: number;
  dag?: TrainingDagNode[];
}

/** Per-user training status (`tsdoc` / `tsdict` values). */
interface TrainingStatusDoc {
  enroll?: number;
  donePids?: number[];
  doneNids?: number[];
  contextualProgress?: TrainingListContextualProgress;
}

/** Per-section status computed by the training detail handler (`nsdict`). */
interface TrainingNodeStatus {
  progress?: number;
  isDone?: boolean;
  isProgress?: boolean;
  isOpen?: boolean;
  isInvalid?: boolean;
  hasAccess?: boolean;
  lockReason?: 'no_access' | 'prereq';
  donePids?: number[];
}

/** Problem fields rendered in section problem lists (`pdict` values). */
interface TrainingProblemDoc {
  docId?: number;
  pid?: string;
  title?: string;
  nSubmit?: number;
  nAccept?: number;
  origStat?: { accepted: number; submitted: number };
}

/** Per-user problem status (`psdict` values). */
interface TrainingProblemStatusDoc {
  status?: number;
}

/** Per-training stats derived on the list page. */
interface TrainingListEntry {
  t: TrainingDoc;
  ts: TrainingStatusDoc;
  total: number;
  done: number;
  pct: number;
  sectionCount: number;
  sectionDone: number;
  progress: ReturnType<typeof resolveTrainingListProgress>;
  enrolled: boolean;
  fullyDone: boolean;
  access?: ProblemSetAccessDecision;
}

interface TrainingPageData {
  completedProblemCount?: number;
  integrityControlled?: boolean;
  missing?: unknown[];
  ndict?: Record<string, TrainingDagNode>;
  nsdict?: Record<string, TrainingNodeStatus>;
  page?: unknown;
  pdict?: Record<string, TrainingProblemDoc>;
  psdict?: Record<string, TrainingProblemStatusDoc>;
  q?: string;
  tdoc?: TrainingDoc;
  tdocs?: TrainingDoc[];
  tpcount?: unknown;
  tsdict?: Record<string, TrainingStatusDoc | undefined>;
  tsdoc?: TrainingStatusDoc;
  udoc?: { uname?: string };
  access?: ProblemSetAccessDecision | Record<string, ProblemSetAccessDecision | undefined>;
  canManage?: boolean;
  canViewRoster?: boolean;
}

const VIEW_KEY = 'krypton.training.view';
const BUCKETS: Array<[ProblemSetListBucket, string]> = [
  ['all', '全部'],
  ['discoverable', '可发现'],
  ['mine', '我的题集'],
  ['redemption', '兑换获得'],
];
const CARD_LINK = 'flex h-full w-full min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-xs transition-[border-color,box-shadow] duration-(--dur-2) ease-(--ease-out) hover:border-line-strong hover:shadow-sm';

function EnrollmentBadge({ fullyDone, enrolled }: { fullyDone: boolean; enrolled: boolean }) {
  if (fullyDone) {
    return <Badge tone="success" size="sm">已完成</Badge>;
  }
  if (enrolled) {
    return <Badge tone="info" size="sm">进行中</Badge>;
  }
  return <Badge tone="neutral" size="sm">未开始</Badge>;
}

function StageStatusBadge({ ns }: { ns: TrainingNodeStatus }) {
  if (ns.hasAccess === false || ns.lockReason === 'no_access') {
    return <Badge tone="neutral" variant="outline" size="sm">未获得访问权</Badge>;
  }
  if (ns.isInvalid) {
    return <Badge tone="neutral" variant="outline" size="sm">前置阶段未完成</Badge>;
  }
  if (ns.isDone) {
    return <Badge tone="success" size="sm">已完成</Badge>;
  }
  if (ns.isProgress) {
    return <Badge tone="info" size="sm">进行中</Badge>;
  }
  if (ns.isOpen) {
    return <Badge tone="neutral" variant="outline" size="sm">可解锁</Badge>;
  }
  return <Badge tone="neutral" variant="outline" size="sm">前置阶段未完成</Badge>;
}

function stageDotTone(ns: TrainingNodeStatus): 'success' | 'info' | 'neutral' {
  if (ns.isDone) return 'success';
  if (ns.isProgress) return 'info';
  return 'neutral';
}

function AccessSourceBadges({ sources }: { sources: ProblemSetAccessSource[] }) {
  if (sources.length === 0) return null;
  return (
    <span className="inline-flex shrink-0 flex-wrap items-center gap-1">
      {sources.map((source) => (
        <Badge
          key={`${source.kind}:${source.groupId || source.courseId || source.entitlementId || ''}`}
          variant="outline"
          tone="neutral"
          size="sm"
        >
          {problemSetSourceLabel(source)}
        </Badge>
      ))}
    </span>
  );
}

function ProblemSearchStatusBadge({ row }: { row: TrainingProblemSearchRow }) {
  if (row.status === 'accepted') {
    return <Badge tone="success" size="sm">已完成当前题集</Badge>;
  }
  if (row.status === 'partiallyAccepted') {
    return (
      <Badge tone="info" size="sm">
        {`已完成 ${row.completedChapterCount}/${row.chapters.length} 个阶段`}
      </Badge>
    );
  }
  if (row.status === 'previouslyAccepted') {
    return <Badge tone="neutral" variant="outline" size="sm">曾通过，不计当前题集</Badge>;
  }
  if (row.status === 'attempted') {
    return <Badge tone="neutral" size="sm">尝试中</Badge>;
  }
  return <Badge tone="neutral" variant="outline" size="sm">未尝试</Badge>;
}

function StatCell({
  label,
  value,
  icon,
  active,
  onClick,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="min-w-0 flex-1 text-left">
        <Stat label={label} value={value} />
      </div>
      {icon}
    </>
  );
  if (!onClick) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-line bg-surface p-3 shadow-xs">
        {body}
      </div>
    );
  }
  return (
    <Button
      type="button"
      variant={active ? 'soft' : 'secondary'}
      onClick={onClick}
      className="h-auto! w-full justify-between px-3 py-3 text-left"
    >
      {body}
    </Button>
  );
}

function ProblemSetCard({ e, bs }: { e: TrainingListEntry; bs: ReturnType<typeof useBootstrap> }) {
  const { t, ts, total, done, pct, sectionCount, enrolled, fullyDone, access } = e;
  const url = replaceRouteTokens(bs.urls.trainingDetail, { TID: String(t.docId) });
  const sources = problemSetAccessSources(access);
  return (
    <a href={url} className={CARD_LINK}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 line-clamp-2 text-md font-semibold leading-tight text-fg">{t.title || '未命名题集'}</h3>
        <EnrollmentBadge fullyDone={fullyDone} enrolled={enrolled} />
      </div>
      <AccessSourceBadges sources={sources} />
      <p className="min-h-10 line-clamp-2 text-sm text-fg-muted text-pretty">{formatPlainTextSummary(t.content || t.desc) || '精选题集'}</p>
      <DagThumbnail
        dag={t.dag || []}
        doneNids={e.progress.doneNids}
        donePids={ts.contextualProgress ? [] : Array.isArray(ts.donePids) ? ts.donePids : []}
        nsdictHint={e.progress.nsdict}
      />
      <div className="flex items-center justify-between text-xs text-fg-subtle">
        <span className="inline-flex items-center gap-1">
          <Users className="size-3" />
          <span className="tabular">{t.attend || 0}</span>
        </span>
        <span className="tabular">
          {sectionCount} 段 · {total} 题
        </span>
      </div>
      {enrolled ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-fg-subtle">进度</span>
            <span className="tabular text-fg">
              {done}/{total} · {pct}%
            </span>
          </div>
          <Progress value={pct} />
        </div>
      ) : null}
    </a>
  );
}

function TrainingTable({ rows, bs }: { rows: TrainingListEntry[]; bs: ReturnType<typeof useBootstrap> }) {
  return (
    <Panel flush>
      <div className="divide-y divide-line-subtle">
        {rows.map((e) => (
          <a
            key={String(e.t.docId)}
            href={replaceRouteTokens(bs.urls.trainingDetail, { TID: String(e.t.docId) })}
            className="flex items-center gap-4 px-4 py-3 transition-[background-color] duration-(--dur-1) ease-(--ease-standard) hover:bg-surface-hover"
          >
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-start gap-2">
                <span className="min-w-0 line-clamp-2 font-medium text-fg">{e.t.title || '未命名'}</span>
                <EnrollmentBadge fullyDone={e.fullyDone} enrolled={e.enrolled} />
                <AccessSourceBadges sources={problemSetAccessSources(e.access)} />
              </div>
              <p className="line-clamp-1 text-xs text-fg-subtle">{formatPlainTextSummary(e.t.content || e.t.desc) || '—'}</p>
            </div>
            <span className="hidden w-20 text-right text-xs tabular text-fg-subtle sm:block">{e.sectionCount} 段</span>
            <span className="hidden w-20 text-right text-xs tabular text-fg-subtle sm:block">
              {e.done}/{e.total}
            </span>
            <span className="hidden w-16 items-center justify-end gap-1 text-xs text-fg-subtle md:flex">
              <Users className="size-3" />
              <span className="tabular">{e.t.attend || 0}</span>
            </span>
            <span className="w-16 text-right text-sm tabular text-fg">{e.enrolled ? `${e.pct}%` : '—'}</span>
          </a>
        ))}
      </div>
    </Panel>
  );
}

/**
 * One cell per section. Color encodes done / in progress / open / locked,
 * and the cells flex so a long DAG still fits the card.
 */
function DagThumbnail({
  dag,
  doneNids,
  donePids,
  nsdictHint,
}: {
  dag: TrainingDagNode[];
  doneNids: number[];
  /** when nsdict isn't available on the list page we approximate from donePids */
  donePids?: number[];
  /** Optional precomputed status dict — preferred when caller has it. */
  nsdictHint?: Record<string, TrainingNodeStatus>;
}) {
  if (!Array.isArray(dag) || dag.length === 0) return null;
  const doneNidSet = new Set((doneNids || []).map(Number));
  const donePidSet = new Set((donePids || []).map(Number));

  function statusOf(s: TrainingDagNode): 'done' | 'progress' | 'open' | 'locked' {
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
    if (donePidSet.size > 0 && Array.isArray(s.pids) && s.pids.some((p) => donePidSet.has(Number(p)))) {
      return 'progress';
    }
    return 'open';
  }

  const classOf = (st: 'done' | 'progress' | 'open' | 'locked') =>
    (
      {
        done: 'bg-success',
        progress: 'bg-info',
        open: 'bg-surface-active',
        locked: 'bg-surface-sunken',
      } as const
    )[st];

  return (
    <div className="flex h-3 w-full gap-0.5">
      {dag.map((s, i) => (
        <div key={s._id ?? i} className={cn('flex-1 rounded-sm', classOf(statusOf(s)))} title={`${s.title || `阶段 ${s._id}`} · ${statusOf(s)}`} />
      ))}
    </div>
  );
}

export function TrainingPage() {
  const bs = useBootstrap();
  const data = bs.page.data as TrainingPageData;
  const tdocs: TrainingDoc[] = data.tdocs || [];
  const page = Number(data.page) || 1;
  const tpcount = Number(data.tpcount) || 1;
  const tsdict: Record<string, TrainingStatusDoc | undefined> = data.tsdict || {};
  const q: string = data.q || '';

  const [view, setView] = useState<'cards' | 'list'>(() => {
    try {
      return (localStorage.getItem(VIEW_KEY) as 'cards' | 'list' | null) || 'cards';
    } catch {
      return 'cards';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* ignore */
    }
  }, [view]);

  const [statusFilter, setStatusFilter] = useState<'all' | 'enrolled' | 'done' | 'not_started'>('all');
  const [bucket, setBucket] = useState<ProblemSetListBucket>('all');
  const accessById = useMemo(
    () => (data.access && !('sources' in data.access) ? data.access : {}) as Record<string, ProblemSetAccessDecision | undefined>,
    [data.access],
  );

  const enriched = useMemo(
    () =>
      tdocs.map((t) => {
        const ts = tsdict[String(t.docId)] || {};
        const total = Array.isArray(t.dag) ? t.dag.reduce((n, s) => n + (Array.isArray(s.pids) ? s.pids.length : 0), 0) : 0;
        const progress = resolveTrainingListProgress(ts, ts.contextualProgress);
        const done = progress.completedProblemCount;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const sectionCount = Array.isArray(t.dag) ? t.dag.length : 0;
        const sectionDone = progress.doneNids.length;
        const access = accessById[String(t.docId)];
        return {
          t,
          ts,
          total,
          done,
          pct,
          sectionCount,
          sectionDone,
          progress,
          enrolled: !!ts.enroll || !!access?.enrolled,
          fullyDone: total > 0 && done === total,
          access,
        };
      }),
    [accessById, tdocs, tsdict],
  );

  const filtered = useMemo(
    () =>
      enriched.filter((e) => {
        if (!matchesProblemSetBucket(bucket, e.access, e.enrolled)) return false;
        if (statusFilter === 'all') return true;
        if (statusFilter === 'enrolled') return e.enrolled && !e.fullyDone && e.done > 0;
        if (statusFilter === 'done') return e.fullyDone;
        if (statusFilter === 'not_started') return !e.enrolled;
        return true;
      }),
    [bucket, enriched, statusFilter],
  );

  const stats = useMemo(
    () => ({
      total: enriched.length,
      enrolled: enriched.filter((e) => e.enrolled).length,
      inProgress: enriched.filter((e) => e.enrolled && !e.fullyDone && e.done > 0).length,
      done: enriched.filter((e) => e.fullyDone).length,
      totalProblems: enriched.reduce((n, e) => n + e.total, 0),
    }),
    [enriched],
  );

  const emptyTitle = tdocs.length === 0 ? '暂无题集' : bucket === 'redemption' ? '还没有通过兑换获得的题集' : '没有符合条件的题集';

  return (
    <Page width="wide" className="min-w-0">
      <PageHeader
        title="题集"
        description="系统化题集，按阶段 DAG 推进"
        actions={(
          <>
            {bs.user.signedIn ? <RedeemDialogButton variant="outline" /> : null}
            <Button asChild variant="primary">
              <a href={`${bs.urls.training}/create`}>创建题集</a>
            </Button>
          </>
        )}
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCell
          label="进行中"
          value={stats.inProgress}
          icon={<PlayCircle className="size-4 text-info-fg" />}
          active={statusFilter === 'enrolled'}
          onClick={() => setStatusFilter(statusFilter === 'enrolled' ? 'all' : 'enrolled')}
        />
        <StatCell
          label="已完成"
          value={stats.done}
          icon={<CheckCircle2 className="size-4 text-success-fg" />}
          active={statusFilter === 'done'}
          onClick={() => setStatusFilter(statusFilter === 'done' ? 'all' : 'done')}
        />
        <StatCell
          label="未参加"
          value={stats.total - stats.enrolled}
          icon={<Lock className="size-4 text-fg-subtle" />}
          active={statusFilter === 'not_started'}
          onClick={() => setStatusFilter(statusFilter === 'not_started' ? 'all' : 'not_started')}
        />
        <StatCell label="总题数" value={stats.totalProblems} icon={<Award className="size-4 text-fg-subtle" />} />
      </div>

      <Toolbar>
        {BUCKETS.map(([id, label]) => (
          <Button key={id} type="button" size="sm" variant={bucket === id ? 'soft' : 'secondary'} onClick={() => setBucket(id)}>
            {label}
          </Button>
        ))}
      </Toolbar>

      <Panel>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <label className="text-xs text-fg-subtle">搜索</label>
            <Input name="q" defaultValue={q} placeholder="题集标题" leading={<Search />} />
          </div>
          <Button type="submit" size="sm" variant="secondary">筛选</Button>
          <MiniTabs
            size="sm"
            value={view}
            onValueChange={setView}
            aria-label="题集视图"
            items={[
              { value: 'cards', label: null, icon: LayoutGrid, ariaLabel: '卡片视图' },
              { value: 'list', label: null, icon: List, ariaLabel: '列表视图' },
            ]}
          />
        </form>
      </Panel>

      {filtered.length === 0 ? (
        <Panel>
          <EmptyState compact title={emptyTitle} />
        </Panel>
      ) : view === 'cards' ? (
        <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((e) => (
            <ProblemSetCard key={String(e.t.docId)} e={e} bs={bs} />
          ))}
        </div>
      ) : (
        <TrainingTable rows={filtered} bs={bs} />
      )}

      <Pagination current={page} total={tpcount} baseUrl={q ? `${bs.urls.training}?q=${encodeURIComponent(q)}` : bs.urls.training} />
    </Page>
  );
}

export function TrainingDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data as TrainingPageData;
  const tdoc: TrainingDoc = data.tdoc || ({} as TrainingDoc);
  const pdict: Record<string, TrainingProblemDoc> = data.pdict || {};
  const psdict: Record<string, TrainingProblemStatusDoc> = data.psdict || {};
  const tsdoc: TrainingStatusDoc = data.tsdoc || {};
  const ndict: Record<string, TrainingDagNode> = data.ndict || {};
  const nsdict: Record<string, TrainingNodeStatus> = data.nsdict || {};
  const access = (data.access && 'sources' in data.access ? data.access : undefined) as ProblemSetAccessDecision | undefined;
  const enrolled = !!tsdoc.enroll || !!access?.enrolled;
  const accessSources = problemSetAccessSources(access);
  const integrityControlled = data.integrityControlled === true;
  const dag = Array.isArray(tdoc.dag) ? tdoc.dag : [];

  const totalProblems = dag.reduce((n, s) => n + (Array.isArray(s.pids) ? s.pids.length : 0), 0);
  const doneProblems = Number.isSafeInteger(data.completedProblemCount)
    ? Number(data.completedProblemCount)
    : Array.isArray(tsdoc.donePids)
      ? tsdoc.donePids.length
      : 0;
  const overallPct = totalProblems > 0 ? Math.round((doneProblems / totalProblems) * 100) : 0;
  const doneNids: number[] = Array.isArray(tsdoc.doneNids) ? tsdoc.doneNids : [];
  const problemEntryUrl = (pid: string | number, scopeId: number) => {
    const base = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });
    return practiceProblemEntryUrl(base, {
      containerKind: 'problemSet',
      containerId: String(tdoc.docId),
      scopeKind: 'stage',
      scopeId,
    });
  };

  const continueLink = (() => {
    if (!enrolled) return null;
    for (const node of dag) {
      const ns = nsdict[node._id] || {};
      if (!isStageEnterable(ns) || ns.isDone) continue;
      for (const pid of node.pids || []) {
        if (!ns.donePids?.map(Number).includes(Number(pid))) {
          return problemEntryUrl(pid, node._id);
        }
      }
    }
    return null;
  })();

  const preferredNid =
    dag.find((node) => isStageEnterable(nsdict[node._id] || {}) && nsdict[node._id]?.isProgress)?._id ??
    dag.find((node) => isStageEnterable(nsdict[node._id] || {}) && nsdict[node._id]?.isOpen && !nsdict[node._id]?.isDone)?._id ??
    dag.find((node) => isStageEnterable(nsdict[node._id] || {}))?._id ??
    dag[0]?._id ??
    null;
  const { activeId: selectedNid, selectChapter } = useChapterQuery(dag, preferredNid);

  const selected = selectedNid != null ? ndict[selectedNid] || dag.find((n) => n._id === selectedNid) : null;
  const selectedStatus = selectedNid != null ? nsdict[selectedNid] || {} : {};
  const selectedEnterable = selected ? isStageEnterable(selectedStatus) : false;
  const selectedLock = selected ? stageLockReason(selectedStatus) : null;
  const canManage = data.canManage === true;
  const canViewRoster = data.canViewRoster === true;
  const trainingUrl = replaceRouteTokens(bs.urls.trainingDetail, { TID: String(tdoc.docId) });
  const [problemQuery, setProblemQuery] = useState('');
  const problemSearch = useMemo(
    () => searchTrainingProblems({ dag, pdict, psdict, nsdict, controlled: integrityControlled, query: problemQuery }),
    [dag, integrityControlled, nsdict, pdict, problemQuery, psdict],
  );
  const problemSearchEntryUrl = (row: TrainingProblemSearchRow) => {
    const chapter =
      row.chapters.find((item) => !item.completed && isStageEnterable(nsdict[item.id] || {})) ||
      row.chapters.find((item) => isStageEnterable(nsdict[item.id] || {}));
    if (!chapter) return null;
    return problemEntryUrl(row.docId, chapter.id);
  };
  const averageProgress = dag.length ? Math.round(Object.values(nsdict).reduce((n, x) => n + (x?.progress || 0), 0) / dag.length) : 0;

  return (
    <Page width="wide" className="w-full min-w-0">
      <PageHeader
        breadcrumb={<Breadcrumb items={[{ label: '题集', href: bs.urls.training }, { label: tdoc.title || '题集' }]} />}
        title={tdoc.title || '题集'}
        meta={(
          <>
            <span className="inline-flex items-center gap-1 tabular">
              <Users className="size-3" />
              {tdoc.attend || 0} 人参加
            </span>
            <span>·</span>
            <span className="tabular">
              {dag.length} 段 · {totalProblems} 题
            </span>
            {accessSources.length ? (
              <>
                <span>·</span>
                <AccessSourceBadges sources={accessSources} />
              </>
            ) : null}
            {data.udoc?.uname ? (
              <>
                <span>·</span>
                <span>由 {data.udoc.uname} 创建</span>
              </>
            ) : null}
            {Array.isArray(data.missing) && data.missing.length > 0 ? (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1 text-warning-fg">
                  <X className="size-3" />
                  {data.missing.length} 题已失效
                </span>
              </>
            ) : null}
          </>
        )}
        actions={(
          <>
            {bs.user.signedIn ? <RedeemDialogButton variant="outline" /> : null}
            {!enrolled && bs.user.signedIn ? (
              <form method="post">
                <input type="hidden" name="operation" value="enroll" />
                <Button type="submit" variant="primary">开始题集</Button>
              </form>
            ) : null}
            {continueLink ? (
              <Button asChild variant="primary">
                <a href={continueLink}>
                  <PlayCircle />
                  继续题集
                </a>
              </Button>
            ) : null}
            {canViewRoster ? (
              <Button asChild variant="secondary" size="sm">
                <a href={`${trainingUrl}/roster`}>
                  <Users />
                  名单
                </a>
              </Button>
            ) : null}
            {canManage ? (
              <>
                <Button asChild variant="secondary" size="sm">
                  <a href={`${trainingUrl}/edit`}>编辑</a>
                </Button>
                <Button asChild variant="secondary" size="sm">
                  <a href={`${trainingUrl}/file`}>文件</a>
                </Button>
                <form
                  method="post"
                  onSubmit={(event) => {
                    void confirmFormSubmit(event, `确定删除题集「${tdoc.title || ''}」？`, { destructive: true });
                  }}
                >
                  <input type="hidden" name="operation" value="delete" />
                  <Button type="submit" variant="danger-soft" size="sm">删除</Button>
                </form>
              </>
            ) : null}
          </>
        )}
      />

      <Panel>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-2">
            <Stat label="总体进度" value={`${overallPct}%`} hint={`${doneProblems}/${totalProblems} 题`} />
            <Progress value={overallPct} />
          </div>
          <Stat label="已完成阶段" value={String(doneNids.length)} hint={`/ ${dag.length} 段`} />
          <Stat label="已通过题数" value={String(doneProblems)} hint={`/ ${totalProblems} 题`} />
          <Stat label="平均进度" value={`${averageProgress}%`} hint="每阶段均值" />
        </div>
      </Panel>

      {tdoc.content || tdoc.description ? (
        <Panel>
          <MarkdownView content={tdoc.content || tdoc.description || ''} className="text-sm" />
        </Panel>
      ) : null}

      <Panel
        title="题集内搜题"
        description="按题号或标题搜索全部章节"
        actions={problemQuery.trim() ? (
          <span className="text-xs tabular text-fg-subtle" role="status" aria-live="polite">
            {problemSearch.total > problemSearch.results.length
              ? `${problemSearch.results.length}/${problemSearch.total} 个结果`
              : `${problemSearch.total} 个结果`}
          </span>
        ) : null}
      >
        <div className="flex flex-col gap-3">
          <Input
            value={problemQuery}
            onChange={(event) => setProblemQuery(event.target.value)}
            placeholder="搜索公开题号、内部题号或标题"
            aria-label="搜索当前题集中的题目"
            leading={<Search />}
            trailing={problemQuery ? (
              <Button type="button" variant="ghost" size="sm" iconOnly onClick={() => setProblemQuery('')} aria-label="清空题集题目搜索">
                <X />
              </Button>
            ) : null}
          />
          {problemQuery.trim() ? (
            problemSearch.results.length ? (
              <div className="divide-y divide-line-subtle overflow-hidden rounded-md bg-surface-sunken">
                {problemSearch.results.map((row) => {
                  const searchHref = problemSearchEntryUrl(row);
                  return (
                    <div key={row.docId} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start">
                      {searchHref ? (
                        <a href={searchHref} className="min-w-0 flex-1 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                          <div className="flex min-w-0 items-start gap-2">
                            {row.status === 'accepted' ? (
                              <CheckCircle2 className="size-4 shrink-0 text-success-fg" />
                            ) : row.status === 'previouslyAccepted' ? (
                              <Award className="size-4 shrink-0 text-fg-subtle" />
                            ) : row.status === 'partiallyAccepted' ? (
                              <Clock className="size-4 shrink-0 text-info-fg" />
                            ) : row.status === 'attempted' ? (
                              <Clock className="size-4 shrink-0 text-fg-subtle" />
                            ) : (
                              <span className="size-4 shrink-0 rounded-full border border-line-strong" aria-hidden="true" />
                            )}
                            <span className="shrink-0 font-mono text-xs text-fg-subtle">{row.displayPid}</span>
                            <span className="min-w-0 line-clamp-2 text-sm font-medium text-fg hover:text-brand-fg">{row.title}</span>
                          </div>
                        </a>
                      ) : (
                        <div className="min-w-0 flex-1 text-sm text-fg-muted">
                          <span className="shrink-0 font-mono text-xs">{row.displayPid}</span> {row.title} · 阶段未解锁
                        </div>
                      )}
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:max-w-1/2 sm:justify-end">
                        <ProblemSearchStatusBadge row={row} />
                        {row.chapters.map((chapter) => (
                          <Button
                            key={chapter.id}
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => selectChapter(chapter.id)}
                            className="min-w-0 max-w-full shrink"
                            title={chapter.title}
                          >
                            <span className="min-w-0 truncate">
                              {chapter.completed ? '✓ ' : ''}
                              {chapter.title}
                            </span>
                          </Button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div role="status" aria-live="polite">
                <EmptyState compact title="当前题集中没有匹配的可见题目" />
              </div>
            )
          ) : null}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          {selected ? (
            <Panel>
              <div className="flex flex-col gap-3">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <h2 className="min-w-0 line-clamp-2 text-lg font-semibold text-fg">{selected.title || `阶段 ${selected._id}`}</h2>
                  <StageStatusBadge ns={selectedStatus} />
                </div>
                <div className="flex items-center gap-2 text-xs text-fg-subtle">
                  <span className="tabular">{(selected.pids || []).length} 题</span>
                  <span>·</span>
                  <span className="tabular">进度 {selectedStatus.progress ?? 0}%</span>
                </div>
                {selected.content || selected.description ? (
                  <div className="rounded-md bg-surface-sunken p-3">
                    <MarkdownView content={selected.content || selected.description || ''} className="text-xs" />
                  </div>
                ) : null}
                {(selected.requireNids || []).length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-fg-subtle">前置依赖：</span>
                    {(selected.requireNids || []).map((rid) => {
                      const r = ndict[rid] || dag.find((n) => n._id === rid);
                      const done = doneNids.includes(Number(rid));
                      return (
                        <Button
                          key={String(rid)}
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => selectChapter(Number(rid))}
                        >
                          {done ? <CheckCircle2 className="text-success-fg" /> : <Lock className="text-fg-subtle" />}
                          {r?.title || `阶段 ${rid}`}
                        </Button>
                      );
                    })}
                  </div>
                ) : null}
                {!selectedEnterable ? (
                  <div className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-fg-muted">
                    <Lock className="mx-auto mb-2 size-4 text-fg-subtle" />
                    {selectedLock === 'no_access' ? '未获得访问权' : '前置阶段未完成'}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {(selected.pids || []).map((pid: string | number) => {
                      const p = pdict[String(pid)] || {};
                      const accepted = selectedStatus.donePids?.map(Number).includes(Number(pid)) || false;
                      const globalStatus = psdict[String(pid)]?.status;
                      const attempted = !integrityControlled && !!globalStatus;
                      const previouslyAccepted = integrityControlled && !accepted && globalStatus === 1;
                      return (
                        <a
                          key={String(pid)}
                          href={problemEntryUrl(pid, selected._id)}
                          className="flex items-center justify-between rounded-md border border-line px-3 py-2 transition-[background-color,border-color] duration-(--dur-1) ease-(--ease-standard) hover:bg-surface-hover"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-start gap-2">
                              {accepted ? (
                                <CheckCircle2 className="size-3.5 shrink-0 text-success-fg" />
                              ) : previouslyAccepted ? (
                                <Award className="size-3.5 shrink-0 text-fg-subtle" />
                              ) : attempted ? (
                                <Clock className="size-3.5 shrink-0 text-fg-subtle" />
                              ) : null}
                              <span className="shrink-0 font-mono text-2xs text-fg-subtle">{p.pid || pid}</span>
                              <span className="min-w-0 line-clamp-2 text-sm font-medium text-fg">{p.title || '未命名'}</span>
                            </div>
                            <div className="mt-0.5 ml-5 flex items-center gap-2 text-2xs text-fg-subtle">
                              {p.origStat ? (
                                <>
                                  <span className="tabular">
                                    赛时 {p.origStat.accepted}/{p.origStat.submitted} (
                                    {p.origStat.submitted > 0 ? Math.round((p.origStat.accepted / p.origStat.submitted) * 100) : 0}%)
                                  </span>
                                  <span>·</span>
                                  <span className="tabular">
                                    本站 {p.nAccept || 0}/{p.nSubmit || 0} ({p.nSubmit ? Math.round(((p.nAccept || 0) / p.nSubmit) * 100) : 0}%)
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className="tabular">通过率 {p.nSubmit ? Math.round(((p.nAccept || 0) / p.nSubmit) * 100) : 0}%</span>
                                  <span>·</span>
                                  <span className="tabular">
                                    {p.nAccept || 0}/{p.nSubmit || 0}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                          {accepted ? (
                            <span className="shrink-0"><Verdict status={1} compact /></span>
                          ) : previouslyAccepted ? (
                            <Badge variant="outline" tone="neutral" size="sm">曾通过，不计当前题集</Badge>
                          ) : attempted ? (
                            <Badge tone="neutral" size="sm">尝试中</Badge>
                          ) : null}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            </Panel>
          ) : (
            <Panel>
              <EmptyState compact title="选择一个阶段查看题目" />
            </Panel>
          )}
        </div>

        <div className="min-w-0">
          <Panel
            title="阶段"
            actions={<span className="text-2xs tabular text-fg-subtle">{dag.length} 段</span>}
          >
            <ScrollArea className="max-h-[60vh] lg:h-[60vh]" viewportLayout="block">
              <div className="flex flex-col gap-2 pr-2">
                {dag.map((s, i) => {
                  const ns = nsdict[s._id] || {};
                  const isSelected = selectedNid === s._id;
                  return (
                    <Button
                      key={String(s._id)}
                      type="button"
                      variant="secondary"
                      onClick={() => selectChapter(s._id)}
                      className={cn(
                        'h-auto! w-full shrink justify-start gap-3 whitespace-normal! px-4 py-3.5 text-left font-normal',
                        isSelected && 'bg-surface-active font-medium hover:bg-surface-active',
                      )}
                    >
                      <StatusDot tone={stageDotTone(ns)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-start gap-2">
                          <span className="shrink-0 font-mono text-2xs text-fg-subtle">#{i + 1}</span>
                          <span className="min-w-0 line-clamp-2 text-sm font-medium text-fg">{s.title || `阶段 ${s._id}`}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-2xs text-fg-subtle">
                          <span className="tabular">{s.pids?.length || 0} 题</span>
                          <span>·</span>
                          <span className="tabular">进度 {ns.progress ?? 0}%</span>
                          {(s.requireNids || []).length > 0 ? (
                            <>
                              <span>·</span>
                              <span className="tabular">依赖 {s.requireNids.length}</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <StageStatusBadge ns={ns} />
                    </Button>
                  );
                })}
              </div>
            </ScrollArea>
          </Panel>
        </div>
      </div>
    </Page>
  );
}

export { TrainingDetailPage as ProblemSetDetailPage, TrainingPage as ProblemSetPage };
