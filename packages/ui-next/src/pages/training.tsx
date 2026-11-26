import { Award, Check, CheckCircle2, ChevronDown, LayoutGrid, List, Lock, Minus, PlayCircle, Search, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { RedeemDialogButton } from '@/components/redeem-dialog';
import { Badge } from '@/components/ui/badge';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { DataTable } from '@/components/ui/data-table';
import { Progress, Stat, StatusDot } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { useMotionTokens } from '@/components/ui/motion';
import { Page, PageHeader, Toolbar } from '@/components/ui/page';
import { Pagination } from '@/components/ui/pagination';
import { DescriptionList, Panel } from '@/components/ui/panel';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { formatPlainTextSummary, replaceRouteTokens } from '@/lib/format';
import { practiceProblemEntryUrl } from '@/lib/practice-integrity';
import { useRefreshPracticeOnReturn } from './problem-sets/use-practice-history';
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
  files?: Array<{ name?: string }>;
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
  score?: number;
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
  totalProblemCount?: number;
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

type PracticeMark = 'passed' | 'failed' | 'partial' | 'none';

function listedStagePids(node: TrainingDagNode): number[] {
  const pids: number[] = [];
  for (const raw of node.pids || []) {
    const pid = Number(raw);
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    pids.push(pid);
  }
  return pids;
}

function visibleStagePids(node: TrainingDagNode, pdict: Record<string, TrainingProblemDoc>): number[] {
  return listedStagePids(node).filter((pid) => Object.hasOwn(pdict, String(pid)));
}

function stageTotals(
  node: TrainingDagNode,
  ns: TrainingNodeStatus,
): { done: number; total: number; complete: boolean } {
  const pids = listedStagePids(node);
  const doneSet = new Set((ns.donePids || []).map(Number));
  const done = pids.filter((pid) => doneSet.has(pid)).length;
  return { done, total: pids.length, complete: ns.isDone === true };
}

function problemStatusDoc(
  psdict: Record<string, TrainingProblemStatusDoc>,
  pid: number,
): TrainingProblemStatusDoc | undefined {
  return Object.hasOwn(psdict, String(pid)) ? psdict[String(pid)] : undefined;
}

function problemMark(
  pid: number,
  ns: TrainingNodeStatus,
  ps: TrainingProblemStatusDoc | undefined,
  controlled: boolean,
): PracticeMark {
  if ((ns.donePids || []).map(Number).includes(pid)) return 'passed';
  if (controlled) return 'none';
  const score = ps?.score;
  if (typeof score === 'number' && Number.isFinite(score) && score > 0 && score < 100) return 'partial';
  const status = ps?.status;
  if (status == null || status === 1 || status === 0 || status === 20 || status === 21 || status === 22) return 'none';
  return 'failed';
}

function practiceStatusText(kind: PracticeMark): string {
  if (kind === 'passed') return '已通过';
  if (kind === 'failed') return '未通过';
  if (kind === 'partial') return '部分得分';
  return '';
}

function PracticeProblemMark({ kind }: { kind: PracticeMark }) {
  if (kind === 'passed') return <Check className="size-4 text-success-fg" role="img" aria-label="已通过" />;
  if (kind === 'failed') return <X className="size-4 text-danger-fg" role="img" aria-label="未通过" />;
  if (kind === 'partial') return <Minus className="size-4 text-info-fg" role="img" aria-label="部分得分" />;
  return <span role="img" aria-label="未做" className="inline-block size-4 rounded-full border border-current text-fg-subtle" />;
}

function stageLockCopy(
  node: TrainingDagNode,
  dag: TrainingDagNode[],
  ndict: Record<string, TrainingDagNode>,
  nsdict: Record<string, TrainingNodeStatus>,
): string {
  if (stageLockReason(nsdict[node._id] || {}) === 'no_access') return '未获得访问权';
  for (const rid of node.requireNids || []) {
    const req = dag.find((item) => item._id === Number(rid)) || ndict[rid] || ndict[String(rid)];
    const reqNs = nsdict[Number(rid)] || nsdict[String(rid)] || {};
    if (reqNs.isDone !== true) return `完成「${req?.title || `阶段 ${rid}`}」后解锁`;
  }
  return '前置阶段未完成';
}

function searchEntryChapter(row: TrainingProblemSearchRow, nsdict: Record<string, TrainingNodeStatus>) {
  return row.chapters.find((item) => !item.completed && isStageEnterable(nsdict[item.id] || {}))
    || row.chapters.find((item) => isStageEnterable(nsdict[item.id] || {}));
}

function searchMark(
  row: TrainingProblemSearchRow,
  nsdict: Record<string, TrainingNodeStatus>,
  psdict: Record<string, TrainingProblemStatusDoc>,
  controlled: boolean,
): PracticeMark {
  const chapter = searchEntryChapter(row, nsdict);
  if (chapter) {
    const ns = nsdict[chapter.id] || {};
    if ((ns.donePids || []).map(Number).includes(row.docId)) return 'passed';
    return problemMark(row.docId, ns, problemStatusDoc(psdict, row.docId), controlled);
  }
  for (const item of row.chapters) {
    const ns = nsdict[item.id] || {};
    if ((ns.donePids || []).map(Number).includes(row.docId)) return 'passed';
  }
  return problemMark(row.docId, {}, problemStatusDoc(psdict, row.docId), controlled);
}

function searchEnterableCopy(row: TrainingProblemSearchRow, nsdict: Record<string, TrainingNodeStatus>): string {
  const open = searchEntryChapter(row, nsdict);
  if (open) return '可进入';
  const first = row.chapters[0];
  if (!first) return '前置阶段未完成';
  return stageLockReason(nsdict[first.id] || {}) === 'no_access' ? '未获得访问权' : '前置阶段未完成';
}

function PracticeStageSection({
  stage: s,
  ns,
  dag,
  ndict,
  nsdict,
  pdict,
  psdict,
  controlled,
  expanded,
  onSelect,
  selectChapter,
  problemHref,
}: {
  stage: TrainingDagNode;
  ns: TrainingNodeStatus;
  dag: TrainingDagNode[];
  ndict: Record<string, TrainingDagNode>;
  nsdict: Record<string, TrainingNodeStatus>;
  pdict: Record<string, TrainingProblemDoc>;
  psdict: Record<string, TrainingProblemStatusDoc>;
  controlled: boolean;
  expanded: boolean;
  onSelect: () => void;
  selectChapter: (chapterId: number) => void;
  problemHref: (pid: number) => string;
}) {
  const motion = useMotionTokens();
  const enterable = isStageEnterable(ns);
  const totals = stageTotals(s, ns);
  const title = s.title || `阶段 ${s._id}`;
  const subtitle = enterable
    ? `${totals.done} / ${totals.total}${ns.isDone === true ? ' · 已完成' : ''}`
    : stageLockCopy(s, dag, ndict, nsdict);
  const pct = totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0;
  const ease = motion.state.ease;
  const rows = visibleStagePids(s, pdict).map((pid) => {
    const problem = pdict[String(pid)] || {};
    const kind = problemMark(pid, ns, problemStatusDoc(psdict, pid), controlled);
    return {
      pid,
      label: String(problem.pid || pid),
      title: problem.title || '未命名',
      kind,
      stateText: practiceStatusText(kind),
      href: problemHref(pid),
    };
  });

  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        aria-expanded={expanded}
        aria-disabled={enterable ? undefined : true}
        onClick={() => {
          if (!enterable) return;
          onSelect();
        }}
        className={cn(
          'h-auto! w-full justify-start gap-3 whitespace-normal! rounded-none px-4 py-3 text-left font-normal',
          expanded ? 'bg-surface-active font-medium hover:bg-surface-active' : 'hover:bg-surface-hover',
        )}
      >
        {enterable ? (
          <ChevronDown
            aria-hidden
            className={cn('size-4 text-fg-subtle', !expanded && '-rotate-90')}
            style={{
              transitionProperty: 'transform',
              transitionDuration: `${motion.state.duration}s`,
              transitionTimingFunction: `cubic-bezier(${ease.join(',')})`,
            }}
          />
        ) : (
          <Lock aria-hidden className="size-4 text-fg-subtle" />
        )}
        <span className="min-w-0 flex-1 text-left">
          <span className="block min-w-0 line-clamp-2 text-sm font-semibold text-fg">{title}</span>
          <span className="mt-0.5 block text-xs text-fg-subtle">{subtitle}</span>
        </span>
        {enterable ? (
          <span className="w-28 shrink-0">
            <Progress value={pct} />
          </span>
        ) : null}
        <StageStatusBadge ns={ns} />
      </Button>
      {expanded ? (
        <div className="border-t border-line-subtle">
          {(s.requireNids || []).length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 px-4 py-2">
              {(s.requireNids || []).map((rid) => {
                const req = ndict[rid] || ndict[String(rid)] || dag.find((item) => item._id === Number(rid));
                return (
                  <Button
                    key={String(rid)}
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => selectChapter(Number(rid))}
                  >
                    <span className="min-w-0 line-clamp-2">{req?.title || `阶段 ${rid}`}</span>
                  </Button>
                );
              })}
            </div>
          ) : null}
          {rows.length > 0 ? (
            <DataTable
              mobile="scroll"
              rows={rows}
              rowKey={(row) => String(row.pid)}
              rowHref={(row) => row.href}
              columns={[
                { key: 'mark', header: '状态', cell: (row) => <PracticeProblemMark kind={row.kind} /> },
                { key: 'pid', header: '题号', cell: (row) => <span className="font-mono text-fg-muted">{row.label}</span> },
                {
                  key: 'title',
                  header: '标题',
                  stackRole: 'title',
                  cell: (row) => <span className="block min-w-0 truncate">{row.title}</span>,
                },
                {
                  key: 'state',
                  header: '结果',
                  align: 'right',
                  cell: (row) => <span className="text-fg-subtle">{row.stateText}</span>,
                },
              ]}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function TrainingDetailPage() {
  useRefreshPracticeOnReturn();
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
  const countedProblems = dag.reduce((sum, node) => sum + visibleStagePids(node, pdict).length, 0);
  const listedProblems = dag.reduce((sum, node) => sum + (Array.isArray(node.pids) ? node.pids.length : 0), 0);
  const totalProblems = Number.isSafeInteger(data.totalProblemCount) ? Number(data.totalProblemCount) : countedProblems || listedProblems;
  const doneProblems = Number.isSafeInteger(data.completedProblemCount)
    ? Number(data.completedProblemCount)
    : Array.isArray(tsdoc.donePids)
      ? tsdoc.donePids.length
      : 0;
  const overallPct = totalProblems > 0 ? Math.round((doneProblems / totalProblems) * 100) : 0;
  const problemEntryUrl = (pid: string | number, scopeId: number) => {
    const base = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });
    return practiceProblemEntryUrl(base, {
      containerKind: 'problemSet',
      containerId: String(tdoc.docId),
      scopeKind: 'stage',
      scopeId,
    });
  };
  const firstEnterableProblem = (unfinishedOnly: boolean) => {
    for (const node of dag) {
      const ns = nsdict[node._id] || {};
      if (!isStageEnterable(ns)) continue;
      const done = new Set((ns.donePids || []).map(Number));
      for (const pid of visibleStagePids(node, pdict)) {
        if (unfinishedOnly && done.has(pid)) continue;
        return { pid, stageId: node._id };
      }
    }
    return null;
  };
  const practiceTarget = firstEnterableProblem(true) ?? firstEnterableProblem(false);
  const practiceHref = practiceTarget ? problemEntryUrl(practiceTarget.pid, practiceTarget.stageId) : null;
  const practiceLabel = doneProblems <= 0 ? '开始练习' : '继续练习';
  const summary = doneProblems <= 0
    ? '还没开始'
    : totalProblems > 0 && doneProblems >= totalProblems
      ? '已全部完成'
      : `已完成 ${overallPct}%`;
  const firstUnfinishedEnterableId = dag.find((node) => {
    const ns = nsdict[node._id] || {};
    return isStageEnterable(ns) && ns.isDone !== true;
  })?._id ?? null;
  const preferredNid = firstUnfinishedEnterableId
    ?? dag.find((node) => isStageEnterable(nsdict[node._id] || {}))?._id
    ?? dag[0]?._id
    ?? null;
  const { activeId: selectedNid, selectChapter } = useChapterQuery(dag, preferredNid);
  const expandedId = selectedNid != null && isStageEnterable(nsdict[selectedNid] || {})
    ? selectedNid
    : firstUnfinishedEnterableId;
  const canManage = data.canManage === true;
  const canViewRoster = data.canViewRoster === true;
  const trainingUrl = replaceRouteTokens(bs.urls.trainingDetail, { TID: String(tdoc.docId) });
  const hasFiles = Array.isArray(tdoc.files) && tdoc.files.length > 0;
  const sourceLabel = accessSources[0] ? problemSetSourceLabel(accessSources[0]) : '';
  const hasStageOrder = dag.some((node) => (node.requireNids || []).length > 0);
  const [problemQuery, setProblemQuery] = useState('');
  const problemSearch = useMemo(
    () => searchTrainingProblems({ dag, pdict, psdict, nsdict, controlled: integrityControlled, query: problemQuery }),
    [dag, integrityControlled, nsdict, pdict, problemQuery, psdict],
  );
  const problemSearchEntryUrl = (row: TrainingProblemSearchRow) => {
    const chapter = searchEntryChapter(row, nsdict);
    if (!chapter) return null;
    return problemEntryUrl(row.docId, chapter.id);
  };
  const queryActive = problemQuery.trim().length > 0;
  const metaCounts = `${dag.length > 1 ? `${dag.length} 个阶段 · ` : ''}${totalProblems} 题${sourceLabel ? ` · ${sourceLabel}` : ''}`;

  return (
    <Page width="wide" className="w-full min-w-0">
      <PageHeader
        breadcrumb={<Breadcrumb items={[{ label: '题目集', href: bs.urls.training }, { label: tdoc.title || '题集' }]} />}
        title={tdoc.title || '题集'}
        meta={(
          <>
            <Badge tone="neutral" size="sm">练习</Badge>
            <span className="inline-flex items-center gap-1.5">
              <StatusDot tone="neutral" />
              不限时间
            </span>
            <span>{metaCounts}</span>
          </>
        )}
        actions={(
          <>
            {bs.user.signedIn ? <RedeemDialogButton variant="outline" /> : null}
            {!enrolled && bs.user.signedIn ? (
              <form method="post">
                <input type="hidden" name="operation" value="enroll" />
                <Button type="submit" variant="secondary">开始题集</Button>
              </form>
            ) : null}
            {canViewRoster ? (
              <Button asChild variant="secondary" size="sm">
                <a href={`${trainingUrl}/roster`}>名单</a>
              </Button>
            ) : null}
            {canManage && hasFiles ? (
              <Button asChild variant="secondary" size="sm">
                <a href={`${trainingUrl}/file`}>附件</a>
              </Button>
            ) : null}
            {canManage ? (
              <>
                <Button asChild variant="secondary" size="sm">
                  <a href={`/teach/practice/${tdoc.docId}`}>管理</a>
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs text-fg-subtle">
                  <StatusDot tone="neutral" />
                  <span>练习 · 不限时间</span>
                </div>
                <div className="mt-1 text-2xl font-semibold tabular text-fg">
                  {doneProblems}
                  {' / '}
                  {totalProblems}
                  {' '}
                  <span className="text-md font-normal text-fg-subtle">题</span>
                </div>
                <p className="mt-1 text-sm text-fg-muted">{summary}</p>
              </div>
              <div className="flex shrink-0 flex-col items-stretch gap-1 sm:items-end">
                {practiceHref ? (
                  <Button asChild variant="primary">
                    <a href={practiceHref}>{practiceLabel}</a>
                  </Button>
                ) : (
                  <>
                    <Button type="button" variant="primary" disabled>{practiceLabel}</Button>
                    <span className="text-xs text-fg-subtle">还没有可以进入的阶段</span>
                  </>
                )}
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-1">
              <Progress value={overallPct} />
              <span className="text-xs text-fg-subtle">已完成 {overallPct}%</span>
            </div>
          </Panel>

          <Toolbar
            end={hasStageOrder ? (
              <span className="text-sm text-fg-subtle">按阶段顺序做，后面的阶段要先完成前面的</span>
            ) : null}
          >
            <Input
              value={problemQuery}
              onChange={(event) => setProblemQuery(event.target.value)}
              placeholder="在这个练习里搜题号或标题"
              aria-label="搜索当前题集中的题目"
              leading={<Search />}
              className="w-auto min-w-48 flex-1"
            />
          </Toolbar>

          {queryActive ? (
            <Panel flush title="题集内搜题">
              {problemSearch.results.length ? (
                <>
                <Table density="flush">
                  <TableBody>
                    {problemSearch.results.map((row) => {
                      const searchHref = problemSearchEntryUrl(row);
                      return (
                        <TableRow key={row.docId}>
                          <TableCell className="w-12">
                            <PracticeProblemMark kind={searchMark(row, nsdict, psdict, integrityControlled)} />
                          </TableCell>
                          <TableCell className="font-mono text-fg-muted">{row.displayPid}</TableCell>
                          <TableCell>
                            {searchHref ? (
                              <a href={searchHref} className="block min-w-0 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                                <span className="min-w-0 line-clamp-2 text-sm font-medium text-fg">{row.title}</span>
                              </a>
                            ) : (
                              <div className="min-w-0">
                                <span className="min-w-0 line-clamp-2 text-sm font-medium text-fg">{row.title}</span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:max-w-1/2 sm:justify-end">
                                {row.chapters.map((chapter) => {
                                  const node = dag.find((item) => item._id === chapter.id);
                                  const totals = node
                                    ? stageTotals(node, nsdict[chapter.id] || {})
                                    : { done: 0, total: 0, complete: false };
                                  return (
                                    <Button
                                      key={chapter.id}
                                      type="button"
                                      variant="secondary"
                                      size="sm"
                                      title={chapter.title}
                                      aria-label={chapter.title}
                                      onClick={() => {
                                        setProblemQuery('');
                                        selectChapter(chapter.id);
                                      }}
                                      className="min-w-0 max-w-full shrink"
                                    >
                                      <span className="min-w-0 truncate">
                                        {chapter.title}
                                        <span className="text-fg-subtle">{` ${totals.done}/${totals.total}`}</span>
                                      </span>
                                    </Button>
                                  );
                                })}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-fg-subtle">{searchEnterableCopy(row, nsdict)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {problemSearch.total > problemSearch.results.length ? (
                  <p className="border-t border-line-subtle px-4 py-2 text-xs text-fg-subtle tabular">
                    {`已显示 ${problemSearch.results.length}/${problemSearch.total} 个结果`}
                  </p>
                ) : null}
                </>
              ) : (
                <EmptyState compact title="没有匹配的题目" />
              )}
            </Panel>
          ) : (
            <Panel flush title="阶段">
              <div className="divide-y divide-line">
                {dag.map((s) => (
                  <PracticeStageSection
                    key={String(s._id)}
                    stage={s}
                    ns={nsdict[s._id] || {}}
                    dag={dag}
                    ndict={ndict}
                    nsdict={nsdict}
                    pdict={pdict}
                    psdict={psdict}
                    controlled={integrityControlled}
                    expanded={expandedId === s._id}
                    onSelect={() => selectChapter(s._id)}
                    selectChapter={selectChapter}
                    problemHref={(pid) => problemEntryUrl(pid, s._id)}
                  />
                ))}
              </div>
            </Panel>
          )}
        </div>

        <aside className="min-w-0">
          <Panel title="信息">
            <DescriptionList
              items={[
                { term: '类型', detail: '练习' },
                { term: '范围', detail: sourceLabel || '—' },
                { term: '阶段', detail: `${dag.length} 个` },
                { term: '题目', detail: `${totalProblems} 题` },
                { term: '维护', detail: data.udoc?.uname || '—' },
              ]}
            />
          </Panel>
        </aside>
      </div>
    </Page>
  );
}

export { TrainingDetailPage as ProblemSetDetailPage, TrainingPage as ProblemSetPage };
