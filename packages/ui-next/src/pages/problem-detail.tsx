import {
  AlertTriangle,
  Archive,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code2,
  Cpu,
  Edit3,
  FileText,
  HardDrive,
  HelpCircle,
  History,
  Loader2,
  type LucideIcon,
  MessageSquare,
  Network,
  RotateCcw,
  Send,
  Tag,
  ThumbsDown,
  ThumbsUp,
  Trophy,
  User,
  X,
  XCircle,
} from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getLangEntry, KryptonIDE, type RecordEntry } from '@/components/krypton-ide';
import { AntiAiCopyBoundary, AntiAiMarkerRenderError } from '@/components/anti-ai-copy-boundary';
import { MarkdownView } from '@/components/markdown-renderer';
import { ObjectiveAnswerPanel, type ObjectiveClientQuestion } from '@/components/objective-answer-panel';
import { ProblemAuthorText, type ProblemAuthorView, ProblemEditGate } from '@/components/problem-authoring-state';
import { ProblemRejudgeDialog } from '@/components/problem-rejudge-dialog';
import { ProgrammingStatementView, structuredStatementSamples, type ProgrammingStatementViewData } from '@/components/programming-statement';
import { TeamCodeSendDialog, type TeamCodeBuffer } from '@/components/team-code-snapshots';
import { readTeamExamModeContext } from '@/components/team-exam-mode';
import { Badge } from '@/components/ui/badge';
import { CompetitiveCompanionBridge } from '@/components/competitive-companion-bridge';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { Page, PageHeader, Toolbar, Workspace } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Difficulty, Verdict } from '@/components/ui/verdict';
import { useRecordSocket } from '@/hooks/use-record-socket';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { canSubmitProblemMode } from '@/lib/contest-exam-display';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { replaceRouteTokens } from '@/lib/format';
import { isTerminalJudgeStatus } from '@/lib/pretest-results';
import { shouldShowNoTestdataWarning } from '@/lib/problem-testcase-warning';
import {
  practiceDraftIdentity,
  practiceProblemEntryUrl,
  readPracticeEnforcement,
  readPracticeIntegrityPageContext,
  type PracticeIntegrityPageContext,
} from '@/lib/practice-integrity';
import { companionProblemName } from '@/lib/competitive-companion';
import { extractSamples } from '@/lib/samples';
import { readAntiAiMarkerClientView } from '@/lib/anti-ai-marker';

/**
 * Judge configuration as delivered inside `pdoc.config` (server-side
 * `parseConfig`). Kept optional/loose because older problems may miss
 * fields; runtime guards below stay authoritative.
 */
interface ProblemConfig {
  type?: string;
  time?: string | number;
  memory?: string | number;
  timeMin?: string | number;
  timeMax?: string | number;
  memoryMin?: string | number;
  memoryMax?: string | number;
  langs?: string[];
  time_limit_rate?: Record<string, number>;
  memory_limit_rate?: Record<string, number>;
  /** type=objective 时服务端下发的无答案题面描述符。 */
  questions?: ObjectiveClientQuestion[];
}

/** Subset of the serialized problem document this page reads. */
interface ProblemDoc {
  archivedAt?: unknown;
  docId?: number;
  pid?: string;
  title?: string;
  content?: string;
  config?: ProblemConfig | string | null;
  tag?: string[];
  nSubmit?: number;
  nAccept?: number;
  difficulty?: number;
  origStat?: { accepted: number; submitted: number };
  reactions?: { up?: unknown; down?: unknown; what?: unknown };
  problemKind?: string;
  programmingStatementView?: ProgrammingStatementViewData | null;
  reference?: unknown;
}

/** Per-user problem status doc (`psdoc`). */
interface ProblemStatusDoc {
  status?: number;
  reaction?: unknown;
}

/** Subset of the serialized contest/homework document this page reads. */
interface ContestDoc {
  docId?: string | number;
  title?: string;
  rule?: string;
  participationMode?: string;
  beginAt?: string | Date;
  endAt?: string | Date;
  pids?: unknown[];
}

/** Exam-mode bootstrap payload (see paper.ts; team fields read separately). */
interface ExamModeData {
  enabled?: boolean;
  urls?: ExamModeUrls;
}

interface ExamModeUrls {
  overview?: string;
  record?: string;
  teamCodeSnapshots?: string;
}

/** Related contest/homework rows (`ctdocs` / `htdocs`). */
interface RelatedContestDoc {
  _id?: unknown;
  title?: string;
}

/**
 * Loose record document as it arrives from the `/records` JSON endpoint or
 * the record websocket. Every field is re-validated before use.
 */
interface RawRecordDoc {
  _id?: unknown;
  rid?: unknown;
  contest?: unknown;
  status?: unknown;
  score?: unknown;
  lang?: unknown;
  url?: string;
  time?: unknown;
  memory?: unknown;
  submitAt?: unknown;
  judgeAt?: unknown;
  timestamp?: unknown;
}

interface ProblemDetailPageData {
  authorUdocs?: ProblemAuthorView[];
  canArchiveProblem?: boolean;
  canEditProblem?: boolean;
  canPreviewSubjective?: boolean;
  canRejudgeProblem?: boolean;
  canSubmitProblem?: boolean;
  ctdocs?: RelatedContestDoc[];
  dataContributorUdocs?: ProblemAuthorView[];
  discussionCount?: number;
  examMode?: ExamModeData | null;
  htdocs?: RelatedContestDoc[];
  knowledgeMapView?: {
    id: string;
    title: string;
    nodes: Array<{ id: string; label: string }>;
  } | null;
  mode?: string;
  pdoc?: ProblemDoc;
  postContestPracticeActive?: boolean;
  virtualContestActive?: boolean;
  virtualRemainingMs?: number;
  psdoc?: ProblemStatusDoc;
  solutionCount?: number;
  tdoc?: ContestDoc | null;
  practiceIntegrity?: unknown;
  practiceEnforcement?: unknown;
  antiAiMarkerView?: unknown;
}

type ProblemReactionChoice = 'up' | 'down' | 'what';

interface ProblemReactionCounts {
  up: number;
  down: number;
  what: number;
}

function readProblemReactionCounts(raw: unknown): ProblemReactionCounts | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const node = raw as Record<string, unknown>;
  const read = (key: ProblemReactionChoice): number | null => {
    const value = node[key];
    if (value === undefined) return 0;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
    return value;
  };
  const up = read('up');
  const down = read('down');
  const what = read('what');
  if (up === null || down === null || what === null) return null;
  return { up, down, what };
}

function readProblemReactionChoice(raw: unknown): ProblemReactionChoice | null {
  return raw === 'up' || raw === 'down' || raw === 'what' ? raw : null;
}

function ProblemReactionBar({
  counts,
  mine,
  canReact,
  pending,
  error,
  onSelect,
}: {
  counts: ProblemReactionCounts;
  mine: ProblemReactionChoice | null;
  canReact: boolean;
  pending: boolean;
  error: string;
  onSelect: (next: ProblemReactionChoice) => void;
}) {
  const items: Array<{ key: ProblemReactionChoice; label: string; icon: typeof ThumbsUp; count: number }> = [
    { key: 'up', label: '点赞', icon: ThumbsUp, count: counts.up },
    { key: 'down', label: '点踩', icon: ThumbsDown, count: counts.down },
    { key: 'what', label: '点问号', icon: HelpCircle, count: counts.what },
  ];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {items.map((item) => {
        const active = mine === item.key;
        const Icon = item.icon;
        if (!canReact) {
          return (
            <span
              key={item.key}
              title={item.label}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface-sunken px-2 text-xs text-fg-subtle"
            >
              <Icon className="size-3.5" strokeWidth={1.75} />
              <span className="tabular">{item.count}</span>
              <span className="sr-only">{item.label}</span>
            </span>
          );
        }
        return (
          <Button
            key={item.key}
            type="button"
            size="sm"
            variant={active ? 'soft' : 'secondary'}
            title={item.label}
            aria-pressed={active}
            aria-label={item.label}
            disabled={pending}
            onClick={() => onSelect(item.key)}
          >
            <Icon className="size-3.5" strokeWidth={active ? 2.25 : 1.75} />
            <span className="tabular">{item.count}</span>
          </Button>
        );
      })}
      {error ? (
        <p role="alert" className="w-full text-xs text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function statusBadge(status: number | undefined) {
  if (status === 1) {
    return (
      <Badge tone="success" variant="soft" size="sm">
        <CheckCircle2 className="size-3" />
        已通过
      </Badge>
    );
  }
  if (status === 2) {
    return (
      <Badge tone="danger" variant="soft" size="sm">
        <XCircle className="size-3" />
        未通过
      </Badge>
    );
  }
  return null;
}

function NoTestdataWarning() {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-warning-line bg-warning-soft px-3 py-2.5 text-sm text-fg">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-fg" />
      <div>
        <p className="font-medium">此题没有测试点</p>
        <p className="text-xs text-fg-subtle">当前没有可用于评测的测试用例。</p>
      </div>
    </div>
  );
}

function formatMemory(kb: number | undefined): string {
  if (!kb) return '—';
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)} MB`;
  return `${kb} KB`;
}

function formatTime(ms: number | undefined | null): string {
  if (!ms) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${ms} ms`;
}

export function formatLimitRange(min: number | null | undefined, max: number | null | undefined, unit: string): string {
  const lower = typeof min === 'number' && Number.isFinite(min) ? min : undefined;
  const upper = typeof max === 'number' && Number.isFinite(max) ? max : undefined;
  if (lower != null && upper != null && lower !== upper) return `${lower}\u2013${upper} ${unit}`;
  const single = lower ?? upper;
  if (single == null) return '';
  return `${single} ${unit}`;
}

function buildUrlWithQuery(baseUrl: string, params: Record<string, unknown>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === '' || value === false) return;
    search.set(key, String(value));
  });
  const query = search.toString();
  if (!query) return baseUrl;
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${query}`;
}

export function buildProblemRecordsHref(input: {
  recordsBase: string;
  docId?: number;
  pid?: string | number;
  tid?: string | null;
  practice?: boolean;
  virtual?: boolean;
  uidOrName?: string | number;
  status?: number;
}) {
  const pid = input.docId ?? input.pid;
  if (pid == null || pid === '') return input.recordsBase;
  return buildUrlWithQuery(input.recordsBase, {
    pid,
    tid: input.tid || undefined,
    practice: input.practice || undefined,
    virtual: input.virtual || undefined,
    uidOrName: input.uidOrName || undefined,
    status: input.status,
  });
}

export function extractRecordListPayload(json: unknown): unknown[] {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return [];
  const root = json as Record<string, unknown>;
  if (Array.isArray(root.rdocs)) return root.rdocs;
  const page = root.page;
  if (page && typeof page === 'object' && !Array.isArray(page)) {
    const data = (page as { data?: unknown }).data;
    if (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray((data as { rdocs?: unknown }).rdocs)) {
      return (data as { rdocs: unknown[] }).rdocs;
    }
  }
  const nested = root.data;
  if (nested && typeof nested === 'object' && !Array.isArray(nested) && Array.isArray((nested as { rdocs?: unknown }).rdocs)) {
    return (nested as { rdocs: unknown[] }).rdocs;
  }
  return [];
}

function normalizeId(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object' && value && '$oid' in value) {
    return String((value as { $oid?: unknown }).$oid || '');
  }
  return String(value);
}

function objectIdTimestamp(value: unknown): number | null {
  const id = normalizeId(value);
  if (!/^[0-9a-f]{24}$/i.test(id)) return null;
  return Number.parseInt(id.slice(0, 8), 16) * 1000;
}

function dateTimestamp(value: unknown): number | null {
  if (!value) return null;
  const raw = typeof value === 'object' && value && '$date' in value ? (value as { $date?: unknown }).$date : value;
  // `new Date` tolerates arbitrary input at runtime; the cast only names the
  // shapes this field realistically carries (ISO string / epoch ms / Date).
  const ts = new Date(raw as string | number | Date).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function formatRecordTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mergeRecordEntries(...lists: RecordEntry[][]): RecordEntry[] {
  const byRid = new Map<string, RecordEntry>();
  lists.flat().forEach((entry) => {
    if (!entry.rid) return;
    const prev = byRid.get(entry.rid);
    byRid.set(entry.rid, prev ? { ...prev, ...entry, timestamp: entry.timestamp || prev.timestamp } : entry);
  });
  return Array.from(byRid.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 50);
}

export function mergeIdeRecordSnapshot(current: RecordEntry[], snapshot: RecordEntry[]): RecordEntry[] {
  const currentByRid = new Map(current.map((record) => [record.rid, record]));
  const nonRegressingSnapshot = snapshot.map((record) => {
    const liveRecord = currentByRid.get(record.rid);
    const liveIsTerminal = !!liveRecord && isTerminalJudgeStatus(liveRecord.status);
    const snapshotIsTerminal = isTerminalJudgeStatus(record.status);
    return liveIsTerminal && !snapshotIsTerminal ? liveRecord : record;
  });
  return mergeRecordEntries(current, nonRegressingSnapshot);
}

// Sentinel contest IDs for non-submission records — pretest and generate
// (see RecordModel.RECORD_PRETEST / RECORD_GENERATE on the backend). These
// records must never appear in the per-problem 提交记录 list — they are
// self-tests / system-internal runs, not real submissions.
const PRETEST_CONTEST_ID = '000000000000000000000000';
const GENERATE_CONTEST_ID = '000000000000000000000001';

function isPretestOrGenerate(rdoc: RawRecordDoc): boolean {
  const contest = normalizeId(rdoc.contest);
  if (!contest) return false;
  return contest === PRETEST_CONTEST_ID || contest === GENERATE_CONTEST_ID;
}

function recordEntryFromRdoc(rdoc: RawRecordDoc, recordDetailRoute: string): RecordEntry | null {
  const rid = normalizeId(rdoc._id ?? rdoc.rid);
  if (!rid) return null;
  // Defensive: even if the backend leaks a pretest/generate record
  // (older releases didn't filter the sentinel contest IDs), drop it
  // here so the IDE submission panel only ever lists real submissions.
  if (isPretestOrGenerate(rdoc)) return null;
  const status = Number(rdoc.status);
  const score = Number(rdoc.score);
  const recordUrl = replaceRouteTokens(recordDetailRoute, { RID: rid });
  return {
    rid,
    url: recordUrl || rdoc.url || `/record/${rid}`,
    lang: String(rdoc.lang || ''),
    status: Number.isFinite(status) ? status : 0,
    time: typeof rdoc.time === 'number' ? rdoc.time : undefined,
    memory: typeof rdoc.memory === 'number' ? rdoc.memory : undefined,
    score: Number.isFinite(score) ? score : undefined,
    timestamp: objectIdTimestamp(rdoc._id ?? rdoc.rid) ?? dateTimestamp(rdoc.submitAt ?? rdoc.judgeAt ?? rdoc.timestamp) ?? Date.now(),
  };
}

function origStatChipValue(os: { accepted: number; submitted: number }) {
  const rate = os.submitted > 0 ? Math.round((os.accepted / os.submitted) * 100) : 0;
  return `${os.accepted}/${os.submitted} (${rate}%)`;
}

/** Contest entry banner with live countdown and a back-to-contest link. */
function ContestBanner({
  tdoc,
  mode,
  letter,
  contestUrl,
  virtualRemainingMs,
}: {
  tdoc: ContestDoc;
  mode: string;
  letter: string | null;
  contestUrl: string;
  virtualRemainingMs?: number;
}) {
  const isHomework = tdoc.rule === 'homework';
  const begin = (() => {
    if (!tdoc.beginAt) return 0;
    const d = new Date(tdoc.beginAt);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  })();
  const end = (() => {
    if (!tdoc.endAt) return 0;
    const d = new Date(tdoc.endAt);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  })();
  const now = Date.now();
  const virtual = typeof virtualRemainingMs === 'number';
  const running = virtual ? virtualRemainingMs > 0 : now >= begin && now < end;
  const ended = virtual ? virtualRemainingMs <= 0 : now >= end;

  const [remainMs, setRemainMs] = useState(virtual ? Math.max(0, virtualRemainingMs) : 0);
  useEffect(() => {
    if (!virtual) return;
    const started = Date.now();
    const base = virtualRemainingMs;
    const timer = setInterval(() => setRemainMs(Math.max(0, base - (Date.now() - started))), 1000);
    return () => clearInterval(timer);
  }, [virtual, virtualRemainingMs]);

  // Live countdown when running
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (virtual || !running) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [running, virtual]);
  // Use tick to silence unused warning while letting state drive re-render
  void tick;

  const remaining = virtual ? remainMs : running ? Math.max(0, end - Date.now()) : 0;
  const remH = Math.floor(remaining / 3_600_000);
  const remM = Math.floor((remaining / 60_000) % 60);
  const remS = Math.floor((remaining / 1000) % 60);
  const pad = (n: number) => String(n).padStart(2, '0');

  const modeBadge = (() => {
    switch (mode) {
      case 'contest':
        return (
          <Badge tone="success" size="sm">
            {virtual ? '虚拟参赛' : '比赛中'}
          </Badge>
        );
      case 'view':
        return (
          <Badge variant="outline" size="sm">
            观看模式
          </Badge>
        );
      case 'correction':
        return (
          <Badge tone="warning" variant="outline" size="sm">
            订正模式
          </Badge>
        );
      case 'none':
        return null;
      default:
        return null;
    }
  })();

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3 shadow-xs">
      <a href={contestUrl} className="flex items-center gap-1.5 text-sm font-medium text-fg hover:underline">
        <ChevronRight className="size-3.5 rotate-180" />
        返回 {virtual ? '虚拟参赛' : isHomework ? '作业' : '比赛'}
      </a>
      <span className="text-fg-subtle">|</span>
      <span className="min-w-0 max-w-[40ch] truncate text-sm font-medium text-fg">{tdoc.title || '比赛'}</span>
      {letter ? (
        <Badge variant="outline" size="sm" className="font-mono">
          题 {letter}
        </Badge>
      ) : null}
      {modeBadge}
      <div className="ml-auto flex items-center gap-2">
        {running ? (
          <span className="flex items-center gap-1.5 text-sm text-fg">
            <Clock className="size-3.5 text-fg-subtle" />
            <span className="font-mono tabular">
              {remH > 0 ? `${remH}:` : ''}
              {pad(remM)}:{pad(remS)}
            </span>
            <span className="text-xs text-fg-subtle">剩余</span>
          </span>
        ) : ended ? (
          <span className="text-xs text-fg-subtle">已结束</span>
        ) : (
          <span className="text-xs text-fg-subtle">未开始</span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Resizable split pane                                               */
/* ------------------------------------------------------------------ */

const IDE_STACK_QUERY = '(max-width: 767px), (max-height: 500px)';

function readStackedIdeSplit(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(IDE_STACK_QUERY).matches;
}

function ResizableSplit({
  left,
  right,
  defaultLeftPercent = 40,
  minPercent = 20,
  maxPercent = 80,
}: {
  left: ReactNode;
  right: ReactNode;
  defaultLeftPercent?: number;
  minPercent?: number;
  maxPercent?: number;
}) {
  const [leftPct, setLeftPct] = useState(defaultLeftPercent);
  const [stacked, setStacked] = useState(readStackedIdeSplit);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const stackedRef = useRef(stacked);
  stackedRef.current = stacked;

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(IDE_STACK_QUERY);
    const sync = () => setStacked(mq.matches);
    sync();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', sync);
      return () => mq.removeEventListener('change', sync);
    }
    mq.addListener(sync);
    return () => mq.removeListener(sync);
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      e.preventDefault();
      const rect = containerRef.current.getBoundingClientRect();
      const pct = stackedRef.current
        ? ((e.clientY - rect.top) / rect.height) * 100
        : ((e.clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.max(minPercent, Math.min(maxPercent, pct)));
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [minPercent, maxPercent]);

  return (
    <div ref={containerRef} className={cn('krypton-split flex min-h-0 min-w-0 flex-1 overflow-hidden', stacked && 'flex-col')}>
      <div
        style={stacked ? { height: `${leftPct}%`, width: '100%' } : { width: `${leftPct}%` }}
        className="krypton-split-pane min-h-0 min-w-0 shrink-0 overflow-hidden"
      >
        {left}
      </div>
      <div
        className={cn(
          'krypton-split-handle shrink-0 bg-line transition-colors hover:bg-line-strong',
          stacked ? 'h-1.5 w-full cursor-row-resize' : 'w-1.5 cursor-col-resize',
        )}
        onMouseDown={() => {
          draggingRef.current = true;
          document.body.style.cursor = stackedRef.current ? 'row-resize' : 'col-resize';
          document.body.style.userSelect = 'none';
        }}
      />
      <div className="krypton-split-pane min-h-0 min-w-0 flex-1 overflow-hidden">{right}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Info bar — dense row of stats                                      */
/* ------------------------------------------------------------------ */

function InfoChip({ icon: Icon, label, value, href }: { icon: LucideIcon; label: string; value: React.ReactNode; href?: string }) {
  const body = (
    <>
      <Icon className="size-3.5 text-fg-subtle" />
      <span className="text-fg-subtle">{label}</span>
      <span className="font-medium text-fg tabular">{value}</span>
    </>
  );
  if (href) {
    return (
      <a href={href} className="inline-flex items-center gap-1.5 text-xs text-fg hover:text-brand-fg">
        {body}
      </a>
    );
  }
  return <div className="flex items-center gap-1.5 text-xs text-fg">{body}</div>;
}

function InheritedPracticeEnforcementNotice({
  active,
  blockExternalCode,
  ideOnlySubmit,
}: {
  active: boolean;
  blockExternalCode: boolean;
  ideOnlySubmit: boolean;
}) {
  if (!active) return null;
  const parts = [...(blockExternalCode ? ['禁止粘贴或拖入外部代码'] : []), ...(ideOnlySubmit ? ['只能用题面内的 Krypton IDE 提交'] : [])];
  if (!parts.length) return null;
  return (
    <div role="status" className="border-y border-warning-line bg-warning-soft px-3 py-2 text-xs text-fg">
      当前课程或题集要求：{parts.join('，')}。本题库或作业提交不计入真实性完成。
    </div>
  );
}

function PracticeIntegrityNotice({ context, problemUrl }: { context: PracticeIntegrityPageContext | null; problemUrl: string }) {
  if (!context || (!context.controlled && !context.bypassed)) return null;
  const preview = context.controlled && context.mode === 'preview';
  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-2 border-y px-3 py-2 text-xs text-fg',
        context.bypassed ? 'border-info-line bg-info-soft' : 'border-warning-line bg-warning-soft',
      )}
    >
      <span className="font-medium">
        {context.bypassed
          ? '你正在以题目协作者身份使用完整编辑能力。'
          : preview
            ? '学生预览：真实性限制已启用；本次提交不会计入真实性训练完成。'
            : '真实性训练已启用；只有本页面 IDE 的合格提交会计入当前进度。'}
      </span>
      {context.previewAvailable ? (
        <a
          className="ml-auto rounded-sm font-medium text-brand-fg underline underline-offset-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          href={practiceProblemEntryUrl(problemUrl, context.entry, !preview)}
        >
          {preview ? '退出学生预览' : '进入学生预览'}
        </a>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Limits table per language                                          */
/* ------------------------------------------------------------------ */

// Pretty label lookup defers to `getLangEntry` from the IDE so we share the
// same modifier-aware label generator (e.g. `cc.cc14o2` → "C++14 (O2)").
function langLabel(id: string): string {
  if (id === '_') return '任意语言';
  return getLangEntry(id).label;
}

interface LangGroup {
  family: string;
  familyLabel: string;
  variants: { id: string; suffix: string; fullLabel: string }[];
}

/**
 * Bucket a flat list of Hydro lang ids into per-family display groups.
 * Each variant's label is reduced to its suffix after the family prefix
 * ("C++14" inside the "C++" family becomes the chip "14"; "C++14 (O2)"
 * becomes "14 (O2)"). Single-language families (Java, Go, ...) collapse
 * to a single empty-suffix variant which the renderer omits the chips
 * row for.
 */
function organizeAllowedLangs(ids: string[]): LangGroup[] {
  const groups = new Map<string, LangGroup>();
  for (const id of ids) {
    if (id === '_') continue;
    const dotIdx = id.indexOf('.');
    const family = dotIdx > 0 ? id.slice(0, dotIdx) : id;
    const familyLabel = langLabel(family);
    const variantLabel = langLabel(id);
    let suffix = variantLabel;
    if (variantLabel === familyLabel) {
      suffix = '';
    } else if (variantLabel.startsWith(familyLabel)) {
      suffix = variantLabel.slice(familyLabel.length).trim();
    }
    if (!groups.has(family)) {
      groups.set(family, { family, familyLabel, variants: [] });
    }
    groups.get(family)!.variants.push({ id, suffix, fullLabel: variantLabel });
  }
  // Deterministic family ordering — common langs first, then alphabetical.
  const FAMILY_PRIORITY = ['c', 'cc', 'py3', 'py', 'java', 'js', 'go', 'rs'];
  return Array.from(groups.values()).sort((a, b) => {
    const ia = FAMILY_PRIORITY.indexOf(a.family);
    const ib = FAMILY_PRIORITY.indexOf(b.family);
    if (ia !== ib) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return a.familyLabel.localeCompare(b.familyLabel);
  });
}

function LimitsSection({ config }: { config: ProblemConfig }) {
  if (typeof config === 'string' || !config) return null;

  const timeMin = parseConfigTimeMS(config.timeMin);
  const timeMax = parseConfigTimeMS(config.timeMax);
  const memMin = parseConfigMemoryMB(config.memoryMin);
  const memMax = parseConfigMemoryMB(config.memoryMax);
  const langs: string[] = config.langs || [];

  const baseTimeMs = parseConfigTimeMS(config.time);
  const baseMemMb = parseConfigMemoryMB(config.memory);
  const displayTimeMin = baseTimeMs ?? timeMin;
  const displayTimeMax = baseTimeMs ?? timeMax ?? timeMin;
  const displayMemMin = baseMemMb ?? memMin;
  const displayMemMax = baseMemMb ?? memMax ?? memMin;
  const languageBaseTimeMs = baseTimeMs ?? displayTimeMax ?? displayTimeMin;
  const languageBaseMemMb = baseMemMb ?? displayMemMax ?? displayMemMin;

  // Per-language absolute limits, derived from the rates the editor wrote.
  // Display only when both a base value and a rate map exist.
  const timeRates: Record<string, number> = config.time_limit_rate && typeof config.time_limit_rate === 'object' ? config.time_limit_rate : {};
  const memRates: Record<string, number> = config.memory_limit_rate && typeof config.memory_limit_rate === 'object' ? config.memory_limit_rate : {};
  const perLangKeys = Array.from(new Set([...Object.keys(timeRates), ...Object.keys(memRates)]));

  const hasTimeVariation = baseTimeMs == null && displayTimeMin !== displayTimeMax;
  const hasMemoryVariation = baseMemMb == null && displayMemMin !== displayMemMax;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
        <Cpu className="size-3.5 text-fg-subtle" />
        限制
      </h3>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="flex items-center gap-2 rounded-md bg-surface-sunken px-3 py-2">
          <Clock className="size-3.5 text-fg-subtle" />
          <div>
            <p className="text-2xs text-fg-subtle">时间</p>
            <p className="font-mono text-xs font-medium tabular">
              {hasTimeVariation ? `${formatTime(displayTimeMin)} — ${formatTime(displayTimeMax)}` : formatTime(displayTimeMax ?? displayTimeMin)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-surface-sunken px-3 py-2">
          <HardDrive className="size-3.5 text-fg-subtle" />
          <div>
            <p className="text-2xs text-fg-subtle">内存</p>
            <p className="font-mono text-xs font-medium tabular">
              {hasMemoryVariation
                ? `${formatConfigMemory(displayMemMin)} — ${formatConfigMemory(displayMemMax)}`
                : formatConfigMemory(displayMemMax ?? displayMemMin)}
            </p>
          </div>
        </div>
      </div>
      {perLangKeys.length > 0 ? (
        <div className="flex flex-col gap-1 pt-1">
          <p className="text-2xs text-fg-subtle">分语言限制</p>
          <Table density="compact" className="min-w-72 text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>语言</TableHead>
                <TableHead className="text-right">时间</TableHead>
                <TableHead className="text-right">内存</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perLangKeys.map((id) => {
                const tr = Number(timeRates[id]);
                const mr = Number(memRates[id]);
                const absMs = languageBaseTimeMs != null && Number.isFinite(tr) && tr > 0 ? languageBaseTimeMs * tr : null;
                const absMb = languageBaseMemMb != null && Number.isFinite(mr) && mr > 0 ? languageBaseMemMb * mr : null;
                return (
                  <TableRow key={id}>
                    <TableCell>
                      <span className="font-medium">{langLabel(id)}</span>
                      {langLabel(id) !== id ? <span className="ml-1 font-mono text-2xs text-fg-subtle">{id}</span> : null}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular">{absMs != null ? formatHumanTime(absMs) : '默认'}</TableCell>
                    <TableCell className="text-right font-mono tabular">{absMb != null ? formatHumanMemory(absMb) : '默认'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {langs.length > 0 && (
        <div className="mt-2 rounded-md bg-surface-sunken px-3 py-2">
          <p className="mb-1.5 text-2xs font-medium text-fg-subtle">允许的语言</p>
          {langs.includes('_') ? <div className="text-2xs text-fg-subtle">任意语言</div> : <AllowedLangs ids={langs} />}
        </div>
      )}
    </div>
  );
}

/**
 * Compact two-column language listing: family label on the left,
 * variant chips on the right. Groups are sorted by FAMILY_PRIORITY so
 * the most common langs (C / C++ / Python) appear first.
 */
function AllowedLangs({ ids }: { ids: string[] }) {
  const groups = useMemo(() => organizeAllowedLangs(ids), [ids]);
  return (
    <div className="flex flex-col gap-1">
      {groups.map((g) => {
        const onlyBaseVariant = g.variants.length === 1 && g.variants[0].suffix === '';
        return (
          <div key={g.family} className="flex min-w-0 flex-wrap items-baseline gap-2 text-2xs">
            <span className="min-w-16 shrink-0 font-medium text-fg">{g.familyLabel}</span>
            {onlyBaseVariant ? (
              // Single-variant families collapse to a check; no chip soup.
              <span className="text-success-fg">✓</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {g.variants.map((v) => (
                  <Badge key={v.id} variant="outline" size="sm" title={v.fullLabel}>
                    {v.suffix || v.fullLabel}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Parse a Hydro time string ('1s', '1500ms') → milliseconds; tolerant. */
function parseConfigTimeMS(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  const s = String(input).trim().toLowerCase();
  const m = s.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))\s*(ms|s)?$/);
  if (!m) return null;
  const v = Number.parseFloat(m[1]);
  if (!Number.isFinite(v)) return null;
  return m[2] === 'ms' || !m[2] ? Math.round(v) : Math.round(v * 1000);
}

function parseConfigMemoryMB(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  const s = String(input).trim().toLowerCase();
  const m = s.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))\s*([bkmg]|kb|mb|gb)?$/);
  if (!m) return null;
  const v = Number.parseFloat(m[1]);
  if (!Number.isFinite(v)) return null;
  const u = m[2] || 'mb';
  if (u === 'b') return v / (1024 * 1024);
  if (u === 'k' || u === 'kb') return v / 1024;
  if (u === 'g' || u === 'gb') return v * 1024;
  return v;
}

function formatHumanTime(ms: number): string {
  if (ms < 1000 || ms % 1000 !== 0) return `${Math.round(ms)}ms`;
  return `${ms / 1000}s`;
}

function formatHumanMemory(mb: number): string {
  if (mb >= 1024 && mb % 1024 === 0) return `${mb / 1024}GB`;
  if (mb < 1) return `${Math.round(mb * 1024)}KB`;
  return `${Math.round(mb)}MB`;
}

function formatConfigMemory(mb: number | undefined | null): string {
  if (mb == null || !Number.isFinite(mb)) return '—';
  return formatHumanMemory(mb);
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

function ControlledStatementFailure() {
  return (
    <div role="alert" className="rounded-lg border border-danger-line bg-danger-soft p-5 text-sm text-fg">
      <p className="font-semibold">真实性题面初始化失败</p>
      <p className="mt-1">当前题面无法验证复制保护数据，已阻止进入和提交。请返回课程或题集后重新进入；若仍失败，请联系管理员。</p>
    </div>
  );
}

function observableStatementError(error: unknown, stage: string, contextId?: string) {
  return error instanceof Error
    ? { stage, contextId: contextId || 'unavailable', name: error.name, message: error.message, stack: error.stack || 'stack-unavailable' }
    : { stage, contextId: contextId || 'unavailable', name: 'unknown', message: 'non-error thrown', stack: 'stack-unavailable' };
}

class ControlledStatementErrorBoundary extends Component<
  { children: ReactNode; contextId?: string; onFailure: () => void },
  { error: unknown | null }
> {
  state: { error: unknown | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    if (!(error instanceof AntiAiMarkerRenderError)) return;
    console.error('Controlled statement rendering failed', {
      ...observableStatementError(error, 'statement-render', this.props.contextId),
      componentStack: info.componentStack || 'component-stack-unavailable',
    });
    this.props.onFailure();
  }

  override render() {
    if (this.state.error) {
      if (!(this.state.error instanceof AntiAiMarkerRenderError)) throw this.state.error;
      return <ControlledStatementFailure />;
    }
    return this.props.children;
  }
}

export function ProblemDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data as ProblemDetailPageData;
  const pdoc: ProblemDoc = data.pdoc || {};
  const practiceIntegrity = readPracticeIntegrityPageContext(data.practiceIntegrity);
  const practiceControlled = practiceIntegrity?.controlled === true;
  const practicePolicy = practiceControlled ? practiceIntegrity.policy! : null;
  const practiceContextId = practiceControlled ? practiceIntegrity.contextId : undefined;
  const practiceEnforcement = readPracticeEnforcement(data.practiceEnforcement);
  const blockExternalCode = practicePolicy?.prohibitExternalCodeInjection === true || practiceEnforcement.prohibitExternalCodeInjection;
  const ideOnlySubmit = practicePolicy?.removeIndependentSubmitForm === true || practiceEnforcement.removeIndependentSubmitForm;
  const practiceDraftScope = practiceIntegrity ? practiceDraftIdentity(practiceIntegrity) : null;
  const antiAiCopyInitialization = useMemo(() => {
    if (!practiceControlled || practicePolicy?.antiAiCopyInjection !== true) return { markers: [], failed: false };
    try {
      return { markers: readAntiAiMarkerClientView(data.antiAiMarkerView).markers, failed: false };
    } catch (error) {
      console.error('Controlled statement initialization failed', observableStatementError(error, 'safe-view-parse', practiceContextId));
      return { markers: [], failed: true };
    }
  }, [data.antiAiMarkerView, practiceContextId, practiceControlled, practicePolicy?.antiAiCopyInjection]);
  const antiAiCopyMarkers = antiAiCopyInitialization.markers;
  const [antiAiRenderFailed, setAntiAiRenderFailed] = useState(false);
  const antiAiCopyFailed = antiAiCopyInitialization.failed || antiAiRenderFailed;
  const authorUdocs: ProblemAuthorView[] = Array.isArray(data.authorUdocs) ? data.authorUdocs : [];
  const dataContributorUdocs: ProblemAuthorView[] = Array.isArray(data.dataContributorUdocs) ? data.dataContributorUdocs : [];
  const canEditProblem = data.canEditProblem === true;
  const canArchiveProblem = data.canArchiveProblem === true && !pdoc.archivedAt;
  const canRejudgeProblem = data.canRejudgeProblem === true;
  const psdoc: ProblemStatusDoc = data.psdoc || {};
  const config: ProblemConfig = pdoc.config && typeof pdoc.config === 'object' ? pdoc.config : {};
  const content = pdoc.content || '';
  const nSubmit = pdoc.nSubmit || 0;
  const nAccept = pdoc.nAccept || 0;
  const tags: string[] = pdoc.tag || [];
  const knowledgeMapView: { id: string; title: string; nodes: Array<{ id: string; label: string }> } | null = data.knowledgeMapView || null;
  const pid = pdoc.pid || pdoc.docId || '';
  const difficulty = pdoc.difficulty;
  const solutionCount = data.solutionCount || 0;
  const discussionCount = data.discussionCount || 0;
  const ctdocs: RelatedContestDoc[] = data.ctdocs || [];
  const htdocs: RelatedContestDoc[] = data.htdocs || [];
  const rate = nSubmit > 0 ? Math.round((nAccept / nSubmit) * 100) : 0;
  const canonicalTimeMs = parseConfigTimeMS(config.time);
  const headerTimeLimit = canonicalTimeMs != null
    ? formatTime(canonicalTimeMs)
    : formatLimitRange(parseConfigTimeMS(config.timeMin), parseConfigTimeMS(config.timeMax), 'ms') || '—';
  const canonicalMemoryMb = parseConfigMemoryMB(config.memory);
  const headerMemoryLimit = canonicalMemoryMb != null
    ? formatConfigMemory(canonicalMemoryMb)
    : formatLimitRange(parseConfigMemoryMB(config.memoryMin), parseConfigMemoryMB(config.memoryMax), 'MB') || '—';

  /* ── Contest mode ── */
  const tdoc: ContestDoc | null = data.tdoc || null;
  const examMode: ExamModeData | null = data.examMode || null;
  const teamExamMode = readTeamExamModeContext(examMode);
  const teamCodeWritable = teamExamMode?.teamRole === 'captain' && teamExamMode.canEditCode && teamExamMode.canRun && teamExamMode.canSubmit;
  const teamCodeReadOnly = !!teamExamMode && !teamCodeWritable;
  const teamCanVirtualPrint = teamCodeWritable && teamExamMode?.canUseVirtualPrint === true;
  const teamCanViewRecords = !teamExamMode || teamExamMode.canViewTeamRecords;
  const showNoTestdataWarning = shouldShowNoTestdataWarning(pdoc, !!examMode?.enabled);
  const examUrls: ExamModeUrls = examMode?.urls || {};
  const teamCodeEndpoint = String(examUrls.teamCodeSnapshots || '');
  const mode: string = data.mode || 'normal';
  const postContestPracticeActive = data.postContestPracticeActive === true;
  const virtualContestActive = data.virtualContestActive === true;
  const virtualRemainingMs = typeof data.virtualRemainingMs === 'number' ? data.virtualRemainingMs : undefined;
  const canSubmit = canSubmitProblemMode(mode) && data.canSubmitProblem === true && !antiAiCopyFailed;
  // mode ∈ 'normal' | 'view' | 'contest' | 'correction' | 'none' (from problem.ts ProblemDetailHandler)
  // Contest mode shows banner + locks down external links; correction reopens them.
  const inContest = !!tdoc && tdoc.docId && mode !== 'normal';
  const isHomework = tdoc?.rule === 'homework';
  const tid = tdoc?.docId ? String(tdoc.docId) : null;
  const recordContextTid = tid;
  const recordPracticeScope = postContestPracticeActive || undefined;
  const contestUrl = tid
    ? virtualContestActive
      ? `/contest/${encodeURIComponent(tid)}/virtual`
      : examUrls.overview || replaceRouteTokens(isHomework ? bs.urls.homeworkDetail : bs.urls.contestDetail, { TID: tid })
    : null;
  const recordFilterPid = pdoc.docId ?? pid;
  const problemRecordsHref = buildProblemRecordsHref({
    recordsBase: bs.urls.records,
    docId: typeof pdoc.docId === 'number' ? pdoc.docId : undefined,
    pid,
    tid,
    practice: postContestPracticeActive,
    virtual: virtualContestActive,
    uidOrName: bs.user?.signedIn ? bs.user.id : undefined,
  });
  const acceptedRecordsHref = buildProblemRecordsHref({
    recordsBase: bs.urls.records,
    docId: typeof pdoc.docId === 'number' ? pdoc.docId : undefined,
    pid,
    tid,
    practice: postContestPracticeActive,
    virtual: virtualContestActive,
    uidOrName: bs.user?.signedIn ? bs.user.id : undefined,
    status: 1,
  });
  const recordDetailRouteBase = examUrls.record || bs.urls.recordDetail;
  const recordDetailRoute = virtualContestActive
    ? buildUrlWithQuery(recordDetailRouteBase, { tid: recordContextTid, virtual: true })
    : postContestPracticeActive
      ? buildUrlWithQuery(recordDetailRouteBase, { tid: recordContextTid, practice: true })
      : recordDetailRouteBase;
  const pretestRecordRoute = buildUrlWithQuery(bs.urls.recordDetail, {
    tid: recordContextTid,
    practice: recordPracticeScope,
    virtual: virtualContestActive || undefined,
  });
  // Alphabetic id "A" / "B" / "C" from contest problem order
  const contestPids: unknown[] = Array.isArray(tdoc?.pids) ? tdoc!.pids : [];
  const contestIdx = inContest ? contestPids.findIndex((x) => String(x) === String(pdoc.docId)) : -1;
  const contestLetter = contestIdx >= 0 ? String.fromCharCode(65 + contestIdx) : null;
  // Inside contest, drop the raw pid prefix from the title; the letter takes its place.
  const baseTitle = pdoc.title || pdoc.pid || '题目';
  const title = inContest && contestLetter ? `${contestLetter}. ${baseTitle}` : baseTitle;
  // During contests, hide external resources (solutions/discussions/stats) and other-user info.
  // Re-open them in 'correction' mode after the contest ends.
  const showExternals = !inContest || mode === 'correction';

  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });
  const requestIdeMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('ide') === '1';
  const [ideMode, setIdeMode] = useState(false);
  const [rejudgeOpen, setRejudgeOpen] = useState(false);
  const [teamCodeBuffer, setTeamCodeBuffer] = useState<TeamCodeBuffer | null>(null);
  const serverReactions = readProblemReactionCounts(pdoc.reactions);
  const showProblemReactions = Boolean(serverReactions) && !inContest && !virtualContestActive && !examMode?.enabled;
  const [reactionCounts, setReactionCounts] = useState<ProblemReactionCounts | null>(serverReactions);
  const [myReaction, setMyReaction] = useState<ProblemReactionChoice | null>(readProblemReactionChoice(psdoc.reaction));
  const [reactionPending, setReactionPending] = useState(false);
  const [reactionError, setReactionError] = useState('');
  useEffect(() => {
    setReactionCounts(serverReactions);
    setMyReaction(readProblemReactionChoice(psdoc.reaction));
    setReactionError('');
  }, [pdoc.docId, psdoc.reaction, serverReactions?.down, serverReactions?.up, serverReactions?.what]);
  const submitProblemReaction = async (clicked: ProblemReactionChoice) => {
    if (!showProblemReactions || !reactionCounts || !bs.user?.signedIn || reactionPending) return;
    const next = myReaction === clicked ? null : clicked;
    const previousMine = myReaction;
    const previousCounts = reactionCounts;
    const optimistic = { ...reactionCounts };
    if (previousMine) optimistic[previousMine] = Math.max(0, optimistic[previousMine] - 1);
    if (next) optimistic[next] += 1;
    setMyReaction(next);
    setReactionCounts(optimistic);
    setReactionPending(true);
    setReactionError('');
    try {
      const response = await fetchHydroResponse(problemUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        body: new URLSearchParams({ operation: 'reaction', reaction: next || 'none' }),
      });
      if (!response.ok) throw new Error(await readHydroResponseError(response, '反应失败'));
      const body = (await response.json()) as { reaction?: unknown; reactions?: unknown };
      const confirmedCounts = readProblemReactionCounts(body.reactions);
      if (!confirmedCounts) throw new Error('反应结果无效');
      setReactionCounts(confirmedCounts);
      setMyReaction(readProblemReactionChoice(body.reaction));
    } catch (error) {
      setMyReaction(previousMine);
      setReactionCounts(previousCounts);
      setReactionError(error instanceof Error && error.message ? error.message : '反应失败');
    } finally {
      setReactionPending(false);
    }
  };
  // Keep tid on the submit endpoint for correction authorization; the server
  // deliberately stores correction records without a contest id.
  const contestQS = tid ? (virtualContestActive ? `?tid=${tid}&virtual=1` : `?tid=${tid}`) : '';
  const submitUrl = `${problemUrl}/submit${contestQS}`;
  const independentSubmitUrl = practiceIntegrity
    ? practiceProblemEntryUrl(`${problemUrl}/submit`, practiceIntegrity.entry, practiceIntegrity.mode === 'preview')
    : submitUrl;
  const problemCanPretest = config.type === 'default' || config.type === undefined || config.type == null;
  // 客观题结构化作答（PLAN P3.2 Rev.11）：服务端 parseConfig 对
  // type=objective 下发无答案的 questions 描述符，走面板作答提交。
  const objectiveQuestions: ObjectiveClientQuestion[] = config.type === 'objective' && Array.isArray(config.questions) ? config.questions : [];
  const isObjective = objectiveQuestions.length > 0;
  const isStructuredAnswer =
    ['program_fill', 'function'].includes(config.type ?? '') && ['program_fill', 'function'].includes(String(pdoc.problemKind));
  const canOpenIde = canSubmit && !isObjective && !isStructuredAnswer;
  useEffect(() => {
    if (requestIdeMode && canOpenIde) setIdeMode(true);
  }, [canOpenIde, requestIdeMode]);
  const isSubjective = pdoc.problemKind === 'subjective';
  const canPreviewSubjective = !!data.canPreviewSubjective;
  const objectiveDraftKey = `objective-draft:${bs.user?.id || 0}/${bs.domain?.id || 'default'}/${pdoc.docId || pid}${tid ? `@${tid}` : ''}${practiceDraftScope ? `@practice:${practiceDraftScope}` : ''}`;
  const ideCacheKey = `${bs.user?.id || 0}/${bs.domain?.id || 'default'}/${pid}${practiceDraftScope ? `/practice/${practiceDraftScope}` : ''}`;
  const preferredLang = bs.locale?.startsWith('zh') ? 'zh' : 'en';
  // `samples` is still needed for the IDE/pretest panel even though the
  // problem-statement markdown now renders sample blocks inline (see
  // MarkdownView → splitMarkdownBySamples).
  const structuredStatement = (pdoc.programmingStatementView || null) as ProgrammingStatementViewData | null;
  const samples = useMemo(() => {
    if (structuredStatement) {
      const fromView = structuredStatementSamples(structuredStatement);
      if (fromView.length) return fromView;
    }
    return extractSamples(content);
  }, [content, structuredStatement]);
  const companionTimeMs = parseConfigTimeMS(config.time) ?? parseConfigTimeMS(config.timeMin) ?? 1000;
  const companionMemoryMb = Math.max(1, Math.floor(parseConfigMemoryMB(config.memory) ?? parseConfigMemoryMB(config.memoryMin) ?? 256));
  const companionName = companionProblemName(String(pid), baseTitle);
  const companionGroup = inContest && tdoc?.title ? `Krypton - ${tdoc.title}` : 'Krypton';
  const companionUrl = typeof window === 'undefined' ? problemUrl : window.location.href;
  const showCompanion = !examMode?.enabled;
  const canSubmitBack = showCompanion && canSubmit && !isObjective && !isStructuredAnswer && !isSubjective && tdoc?.participationMode !== 'team';
  const renderStatement = (includeLegacyLimits: boolean) => {
    const statement = structuredStatement ? (
      <ProgrammingStatementView
        statement={structuredStatement}
        preferredLang={preferredLang}
        limits={<LimitsSection config={config} />}
        antiAiMarkers={antiAiCopyMarkers}
      />
    ) : (
      <>
        {includeLegacyLimits ? <LimitsSection config={config} /> : null}
        <MarkdownView content={content} preferredLang={preferredLang} antiAiPath="content" antiAiMarkers={antiAiCopyMarkers} />
      </>
    );
    return antiAiCopyMarkers.length ? (
      <ControlledStatementErrorBoundary key={practiceContextId} contextId={practiceContextId} onFailure={() => setAntiAiRenderFailed(true)}>
        <AntiAiCopyBoundary markers={antiAiCopyMarkers} contextId={practiceContextId}>
          {statement}
        </AntiAiCopyBoundary>
      </ControlledStatementErrorBoundary>
    ) : (
      statement
    );
  };

  /* ── Records state for IDE mode ── */
  const [ideRecords, setIdeRecords] = useState<RecordEntry[]>([]);
  const [showIdeRecords, setShowIdeRecords] = useState(false);
  const [ideRecordsLoaded, setIdeRecordsLoaded] = useState(false);
  const [ideRecordsLoading, setIdeRecordsLoading] = useState(false);
  const [ideRecordsError, setIdeRecordsError] = useState<string | null>(null);
  const [readonlySource, setReadonlySource] = useState<{ rid: string; lang: string; code: string } | null>(null);
  const [readonlySourceLoading, setReadonlySourceLoading] = useState(false);
  const [readonlySourceError, setReadonlySourceError] = useState<string | null>(null);
  const [ideRecordsPct, setIdeRecordsPct] = useState(70); // top content takes 70%
  const recordsDragging = useRef(false);
  const recordsPanelRef = useRef<HTMLDivElement>(null);

  const handleRecordsChange = useCallback((records: RecordEntry[]) => {
    setIdeRecords((prev) => mergeIdeRecordSnapshot(prev, records));
  }, []);
  const handleToggleRecords = useCallback(() => {
    setShowIdeRecords((p) => !p);
  }, []);

  const loadReadonlySource = useCallback(
    async (entry: RecordEntry) => {
      if (!teamCodeReadOnly || !teamCanViewRecords) return;
      setReadonlySourceLoading(true);
      setReadonlySourceError(null);
      try {
        const res = await fetchHydroResponse(entry.url, {
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
        });
        if (res.status === 409) {
          window.location.reload();
          return;
        }
        if (!res.ok) throw new Error(await readHydroResponseError(res, '加载本队源码失败'));
        const json = (await res.json()) as {
          code?: unknown;
          rdoc?: { code?: unknown; lang?: unknown };
          page?: { data?: { rdoc?: { code?: unknown; lang?: unknown } } };
        };
        const record = json.rdoc || json.page?.data?.rdoc || {};
        const code = json.code ?? record.code;
        if (typeof code !== 'string' || !code) throw new Error('该记录没有可查看的文本源码');
        setReadonlySource({ rid: entry.rid, lang: String(record.lang || entry.lang || ''), code });
      } catch (error) {
        setReadonlySourceError(error instanceof Error && error.message ? error.message : '加载本队源码失败');
      } finally {
        setReadonlySourceLoading(false);
      }
    },
    [teamCanViewRecords, teamCodeReadOnly],
  );

  const loadIdeRecords = useCallback(async () => {
    if (!bs.user?.signedIn || !pid || !teamCanViewRecords) return;
    setIdeRecordsLoading(true);
    setIdeRecordsError(null);
    try {
      const url = buildUrlWithQuery(bs.urls.records, {
        pid: recordFilterPid,
        tid: recordContextTid || undefined,
        practice: recordPracticeScope,
        virtual: virtualContestActive || undefined,
        uidOrName: bs.user.id,
      });
      const res = await fetchHydroResponse(url, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(await readHydroResponseError(res, '加载提交记录失败'));
      const rdocs = extractRecordListPayload(await res.json());
      const entries = rdocs.map((rdoc) => recordEntryFromRdoc(rdoc as RawRecordDoc, recordDetailRoute)).filter(Boolean) as RecordEntry[];
      setIdeRecords((prev) => mergeIdeRecordSnapshot(prev, entries));
      if (teamCodeReadOnly && entries[0]) await loadReadonlySource(entries[0]);
      setIdeRecordsLoaded(true);
    } catch (e) {
      setIdeRecordsError(e instanceof Error && e.message ? e.message : '加载提交记录失败');
      setIdeRecordsLoaded(true);
    } finally {
      setIdeRecordsLoading(false);
    }
  }, [
    bs.urls.records,
    bs.user?.id,
    bs.user?.signedIn,
    loadReadonlySource,
    recordFilterPid,
    recordContextTid,
    recordDetailRoute,
    recordPracticeScope,
    virtualContestActive,
    teamCanViewRecords,
    teamCodeReadOnly,
  ]);

  useEffect(() => {
    if ((ideMode || showIdeRecords) && !ideRecordsLoaded && !ideRecordsLoading) {
      void loadIdeRecords();
    }
  }, [ideMode, showIdeRecords, ideRecordsLoaded, ideRecordsLoading, loadIdeRecords]);

  useRecordSocket({
    filters: {
      pid: String(recordFilterPid),
      tid: recordContextTid || undefined,
      practice: recordPracticeScope,
      virtual: virtualContestActive || undefined,
      uidOrName: bs.user?.id || undefined,
    },
    onRdoc: (rdoc) => {
      const entry = recordEntryFromRdoc(rdoc, recordDetailRoute);
      if (!entry) return;
      setIdeRecords((prev) => mergeRecordEntries(prev, [entry]));
    },
    disabled: !ideMode || !showIdeRecords || !bs.user?.signedIn || !pid,
  });

  /* Mouse handler for records panel height drag */
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!recordsDragging.current || !recordsPanelRef.current) return;
      const rect = recordsPanelRef.current.getBoundingClientRect();
      const pct = ((e.clientY - rect.top) / rect.height) * 100;
      setIdeRecordsPct(Math.max(20, Math.min(85, pct)));
    };
    const onMouseUp = () => {
      if (recordsDragging.current) {
        recordsDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  if (antiAiCopyFailed) return <ControlledStatementFailure />;

  /* IDE workspace. Exam mode still escapes the padded shell so the countdown stays visible. */
  if (ideMode) {
    return (
      <Workspace className={cn(examMode?.enabled && 'fixed inset-x-0 bottom-0 top-14 z-30 h-auto')}>
        <Toolbar
          className="h-10 shrink-0 border-b border-line bg-surface px-2"
          end={(
            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setIdeMode(false)}>
              <X />
              退出 IDE
            </Button>
          )}
        >
          <Code2 className="size-4 shrink-0 text-brand-fg" />
          <span className="min-w-0 truncate text-sm font-semibold text-fg">{title}</span>
          <span className="hidden min-w-0 truncate text-xs text-fg-subtle sm:inline">— {pid}</span>
          {teamCodeReadOnly ? (
            <Badge variant="outline" tone="warning" size="sm" className="shrink-0">
              {teamExamMode?.teamRole === 'invalid'
                ? '团队身份异常 · 已锁定'
                : teamExamMode?.teamRole === 'admin_preview'
                  ? '管理员只读预览'
                  : '队员只读'}
            </Badge>
          ) : null}
        </Toolbar>
        {/* Resizable split view */}
        <ResizableSplit
          left={
            <div ref={recordsPanelRef} className="flex h-full min-h-0 min-w-0 flex-col">
              {/* Problem content area */}
              <ScrollArea viewportClassName="p-4 sm:p-6" style={{ height: showIdeRecords ? `${ideRecordsPct}%` : '100%' }}>
                <div className="flex flex-col gap-4">
                {/* Problem header */}
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="min-w-0 break-words text-lg font-semibold text-fg">{title}</h2>
                    {statusBadge(psdoc.status)}
                    {/* Hide difficulty during contest (gives away problem hardness) */}
                    {!inContest && difficulty ? <Difficulty level={difficulty} /> : null}
                  </div>
                  {showProblemReactions && reactionCounts ? (
                    <ProblemReactionBar
                      counts={reactionCounts}
                      mine={myReaction}
                      canReact={!!bs.user?.signedIn}
                      pending={reactionPending}
                      error={reactionError}
                      onSelect={submitProblemReaction}
                    />
                  ) : null}
                  {/* Hide tags during contest (gives away algorithm) */}
                  {!inContest && tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {tags.map((t) => (
                        <Badge key={t} tone="neutral" variant="soft" size="sm">
                          <Tag className="size-2.5" />
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {!inContest && knowledgeMapView ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
                      <span className="inline-flex items-center gap-1 font-medium text-fg">
                        <Network className="size-3" aria-hidden="true" />
                        {knowledgeMapView.title}
                      </span>
                      {knowledgeMapView.nodes.map((node) => (
                        <Badge key={node.id} variant="outline" className="font-normal">
                          {node.label}
                        </Badge>
                      ))}
                      {!knowledgeMapView.nodes.length ? <span>尚未归类知识节点</span> : null}
                    </div>
                  ) : null}
                </div>

                <PracticeIntegrityNotice context={practiceIntegrity} problemUrl={problemUrl} />
                <InheritedPracticeEnforcementNotice
                  active={!practiceControlled}
                  blockExternalCode={practiceEnforcement.prohibitExternalCodeInjection}
                  ideOnlySubmit={practiceEnforcement.removeIndependentSubmitForm}
                />

                {showNoTestdataWarning ? <NoTestdataWarning /> : null}

                {/* Info chips */}
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg border border-line bg-surface-sunken px-3 py-2">
                  {!inContest ? <InfoChip icon={User} label="出题人" value={<ProblemAuthorText authors={authorUdocs} />} /> : null}
                  {!inContest && dataContributorUdocs.length ? (
                    <InfoChip icon={HardDrive} label="数据贡献者" value={<ProblemAuthorText authors={dataContributorUdocs} />} />
                  ) : null}
                  {!virtualContestActive ? <InfoChip icon={Send} label="提交" value={nSubmit} href={problemRecordsHref} /> : null}
                  {!virtualContestActive ? (
                    <InfoChip
                      icon={CheckCircle2}
                      label="通过"
                      value={<span className="text-success-fg">{nAccept}</span>}
                      href={acceptedRecordsHref}
                    />
                  ) : null}
                  {!virtualContestActive ? <InfoChip icon={Trophy} label="通过率" value={`${rate}%`} /> : null}
                  {!inContest && pdoc.origStat ? <InfoChip icon={BarChart3} label="赛时通过率" value={origStatChipValue(pdoc.origStat)} /> : null}
                </div>

                {renderStatement(true)}
                </div>
              </ScrollArea>

              {/* Records panel — bottom of left side */}
              {showIdeRecords && (
                <>
                  {/* Drag handle for records height */}
                  <div
                    className="h-1.5 shrink-0 cursor-row-resize bg-line transition-colors hover:bg-line-strong"
                    onMouseDown={() => {
                      recordsDragging.current = true;
                      document.body.style.cursor = 'row-resize';
                      document.body.style.userSelect = 'none';
                    }}
                  />
                  <div className="flex flex-col min-h-0 overflow-hidden" style={{ height: `${100 - ideRecordsPct}%` }}>
                    <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-sunken px-3 py-1.5">
                      <History className="size-3.5 text-fg-subtle" />
                      <span className="text-xs font-medium text-fg">{teamExamMode ? '本队提交记录' : '提交记录'}</span>
                      <span className="text-2xs text-fg-subtle tabular">({ideRecords.length})</span>
                      <div className="flex-1" />
                      <a href={problemRecordsHref} className="text-xs text-brand-fg hover:underline">
                        全部
                      </a>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setShowIdeRecords(false)}>
                        收起
                      </Button>
                    </div>
                    <ScrollArea className="min-h-0 flex-1" orientation="both">
                      {ideRecordsLoading && ideRecords.length === 0 ? (
                        <div className="flex h-full items-center justify-center gap-2 text-xs text-fg-subtle">
                          <Loader2 className="size-3.5 animate-spin" />
                          加载提交记录
                        </div>
                      ) : ideRecordsError && ideRecords.length === 0 ? (
                        <div className="flex h-full items-center justify-center gap-2 px-4 text-xs text-danger-fg">
                          <XCircle className="size-3.5" />
                          {ideRecordsError}
                        </div>
                      ) : ideRecords.length === 0 ? (
                        <div className="flex h-full items-center justify-center px-4 text-xs text-fg-subtle">
                          {teamExamMode ? '暂无本队提交记录' : '暂无个人提交记录'}
                        </div>
                      ) : (
                        // ds-allow DS004: 620px 下限是既有双向滚动契约，不能改成间距档位。ds-allow DS005: 提交记录表必须保留原生 table，测试按状态列表头锁定。
                        <table className="min-w-[620px] w-full text-xs">
                          <thead>
                            <tr className="border-b border-line-subtle bg-surface-sunken text-fg-subtle">
                              <th className="px-3 py-1.5 text-left font-medium">状态</th>
                              <th className="px-3 py-1.5 text-left font-medium">语言</th>
                              <th className="px-3 py-1.5 text-right font-medium">分数</th>
                              <th className="px-3 py-1.5 text-right font-medium">时间</th>
                              <th className="px-3 py-1.5 text-right font-medium">内存</th>
                              <th className="px-3 py-1.5 text-left font-medium">提交时间</th>
                              <th className="px-3 py-1.5 text-left font-medium" />
                            </tr>
                          </thead>
                          <tbody>
                            {ideRecords.map((r) => (
                              <tr key={r.rid} className="border-b border-line-subtle last:border-0 hover:bg-surface-hover">
                                <td className="whitespace-nowrap px-3 py-1.5">
                                  <Verdict status={r.status} compact />
                                </td>
                                <td className="whitespace-nowrap px-3 py-1.5 text-fg">{getLangEntry(r.lang).label}</td>
                                <td className="px-3 py-1.5 text-right font-mono tabular">{r.score ?? '—'}</td>
                                <td className="px-3 py-1.5 text-right font-mono tabular">{r.time != null ? `${r.time} ms` : '—'}</td>
                                <td className="px-3 py-1.5 text-right font-mono tabular">{r.memory != null ? formatMemory(r.memory) : '—'}</td>
                                <td className="whitespace-nowrap px-3 py-1.5 text-fg-subtle">{formatRecordTimestamp(r.timestamp)}</td>
                                <td className="px-3 py-1.5">
                                  {teamCodeReadOnly ? (
                                    <Button type="button" variant="link" size="sm" onClick={() => void loadReadonlySource(r)}>
                                      查看代码
                                    </Button>
                                  ) : (
                                    <a href={r.url} className="text-brand-fg hover:underline">
                                      详情
                                    </a>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </ScrollArea>
                  </div>
                </>
              )}
            </div>
          }
          right={
            teamCodeReadOnly ? (
              <div className="flex h-full min-h-0 min-w-0 flex-col">
                <div className="flex h-10 min-w-0 shrink-0 items-center gap-2 border-b border-line bg-surface-sunken px-3 text-xs">
                  <span className="shrink-0 font-medium text-fg">只读源码</span>
                  {readonlySource ? <span className="min-w-0 truncate font-mono text-fg-subtle">#{readonlySource.rid.slice(-8)}</span> : null}
                  <div className="flex-1" />
                  {readonlySourceLoading ? <Loader2 className="size-3.5 animate-spin text-fg-subtle" /> : null}
                  {readonlySourceError ? <span className="text-danger-fg">{readonlySourceError}</span> : null}
                </div>
                {readonlySource ? (
                  <KryptonIDE
                    mode="readonly"
                    teamReadOnlyView
                    langs={[]}
                    defaultLang={readonlySource.lang || config.langs?.[0]}
                    value={readonlySource.code}
                    minHeight={0}
                    className="h-full min-h-0 flex-1 rounded-none border-0"
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-fg-muted">
                    {!teamCanViewRecords
                      ? '当前服务端能力不允许查看本队源码。'
                      : readonlySourceLoading
                        ? '正在加载本队最新源码…'
                        : '本队提交源码会在这里以只读方式显示。'}
                  </div>
                )}
              </div>
            ) : (
              <KryptonIDE
                langs={config.langs || []}
                defaultLang={config.langs?.[0]}
                submitUrl={submitUrl}
                practiceContextId={practiceContextId}
                prohibitExternalCodeInjection={blockExternalCode}
                isolateDraftByLanguage={practiceControlled || blockExternalCode}
                canPretest={problemCanPretest}
                cacheKey={ideCacheKey}
                samples={samples}
                onRecordsChange={handleRecordsChange}
                onToggleRecords={handleToggleRecords}
                onOpenRecords={() => setShowIdeRecords(true)}
                recordUrlTemplate={recordDetailRoute}
                pretestRecordUrlTemplate={pretestRecordRoute}
                showRecordsButton
                recordsVisible={showIdeRecords}
                recordsCount={ideRecords.length}
                toolbarAfterRecords={
                  showCompanion ? (
                    <CompetitiveCompanionBridge
                      compact
                      name={companionName}
                      group={companionGroup}
                      url={companionUrl}
                      timeLimitMs={companionTimeMs}
                      memoryLimitMb={companionMemoryMb}
                      tests={samples}
                      allowedLangs={config.langs || []}
                    />
                  ) : null
                }
                reloadOnConflict={!!teamExamMode}
                onSendToTeammates={teamCanVirtualPrint && teamCodeEndpoint ? setTeamCodeBuffer : undefined}
                className="h-full min-h-0 min-w-0 rounded-none border-0"
              />
            )
          }
          defaultLeftPercent={40}
        />
        {teamCanVirtualPrint && teamCodeEndpoint ? (
          <TeamCodeSendDialog
            open={!!teamCodeBuffer}
            onOpenChange={(open) => {
              if (!open) setTeamCodeBuffer(null);
            }}
            endpoint={teamCodeEndpoint}
            problemId={Number(pdoc.docId)}
            buffer={teamCodeBuffer}
          />
        ) : null}
      </Workspace>
    );
  }

  return (
    <Page width="wide">
      <ProblemRejudgeDialog open={rejudgeOpen} onOpenChange={setRejudgeOpen} endpoint={problemUrl} pid={String(pid)} title={baseTitle} />
      {/* Contest mode banner — visible whenever we entered via a contest tid */}
      {inContest && contestUrl ? (
        <ContestBanner
          tdoc={tdoc!}
          mode={mode}
          letter={contestLetter}
          contestUrl={contestUrl}
          virtualRemainingMs={virtualContestActive ? virtualRemainingMs : undefined}
        />
      ) : null}
      <PracticeIntegrityNotice context={practiceIntegrity} problemUrl={problemUrl} />
      <InheritedPracticeEnforcementNotice
        active={!practiceControlled}
        blockExternalCode={practiceEnforcement.prohibitExternalCodeInjection}
        ideOnlySubmit={practiceEnforcement.removeIndependentSubmitForm}
      />

      {showNoTestdataWarning ? <NoTestdataWarning /> : null}

      <PageHeader
        breadcrumb={
          inContest && contestUrl ? (
            <Breadcrumb
              items={[
                {
                  label: isHomework ? '作业' : '比赛',
                  href: examUrls.overview || (isHomework ? bs.urls.homework : bs.urls.contests),
                },
                { label: tdoc?.title || '比赛', href: contestUrl },
                { label: <span className="font-mono">{contestLetter || pid}</span> },
              ]}
            />
          ) : (
            <Breadcrumb
              items={[
                { label: '题库', href: bs.urls.problems },
                { label: <span className="font-mono">{pid}</span> },
              ]}
            />
          )
        }
        title={<span className="break-words">{title}</span>}
        meta={(
          <>
            {statusBadge(psdoc.status)}
            {/* Hide difficulty during contest (gives away problem hardness) */}
            {!inContest && difficulty ? <Difficulty level={difficulty} /> : null}
            <span className="tabular">时间 {headerTimeLimit}</span>
            <span className="tabular">内存 {headerMemoryLimit}</span>
            {!virtualContestActive ? <span className="tabular">通过 {nAccept} / 提交 {nSubmit}</span> : null}
          </>
        )}
        actions={(
          <>
            {showCompanion ? (
              <CompetitiveCompanionBridge
                name={companionName}
                group={companionGroup}
                url={companionUrl}
                timeLimitMs={companionTimeMs}
                memoryLimitMb={companionMemoryMb}
                tests={samples}
                canSubmitBack={canSubmitBack}
                submitUrl={submitUrl}
                allowedLangs={config.langs || []}
                tid={tid || undefined}
                practiceContextId={practiceContextId}
                recordDetailUrl={(rid) => replaceRouteTokens(recordDetailRoute, { RID: rid })}
              />
            ) : null}
            {/* 客观题在下方面板作答，IDE 模式无意义 */}
            {canSubmit && !isObjective && !isStructuredAnswer ? (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  if (teamCanViewRecords) setShowIdeRecords(true);
                  setIdeMode(true);
                }}
              >
                <Code2 />
                {teamCodeReadOnly ? '只读代码' : 'IDE 模式'}
              </Button>
            ) : null}
            {bs.user?.signedIn ? (
              <Button asChild size="sm" variant="secondary">
                <a href={problemRecordsHref}>
                  <History />
                  提交记录
                </a>
              </Button>
            ) : null}
            {canSubmit && (isStructuredAnswer || (!examMode?.enabled && !ideOnlySubmit)) ? (
              <Button asChild size="sm" variant="secondary">
                <a href={independentSubmitUrl}>
                  <Send />
                  {ideOnlySubmit && isStructuredAnswer ? '作答' : '提交'}
                </a>
              </Button>
            ) : null}
            {canRejudgeProblem && !inContest ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => setRejudgeOpen(true)}>
                <RotateCcw />
                整题重测
              </Button>
            ) : null}
            <ProblemEditGate canEditProblem={canEditProblem} inContest={!!inContest}>
              <Button asChild size="sm" variant="ghost">
                <a href={`${problemUrl}/edit`}>
                  <Edit3 />
                  编辑
                </a>
              </Button>
            </ProblemEditGate>
            {canArchiveProblem && !inContest ? (
              <form
                method="post"
                action={bs.urls.problems}
                onSubmit={(event) => {
                  void confirmFormSubmit(
                    event,
                    '归档后将强制隐藏。',
                    {
                      destructive: true,
                      title: `归档题目「${pdoc.title || pid}」？`,
                      confirmLabel: '归档',
                    },
                  );
                }}
              >
                <input type="hidden" name="operation" value="archive" />
                <input type="hidden" name="pid" value={String(pdoc.docId)} />
                <input type="hidden" name="reason" value="Archived from problem detail" />
                <Button type="submit" size="sm" variant="danger-soft">
                  <Archive />
                  归档
                </Button>
              </form>
            ) : null}
          </>
        )}
      />
      {showProblemReactions && reactionCounts ? (
        <ProblemReactionBar
          counts={reactionCounts}
          mine={myReaction}
          canReact={!!bs.user?.signedIn}
          pending={reactionPending}
          error={reactionError}
          onSelect={submitProblemReaction}
        />
      ) : null}
      {/* Hide tags during contest (gives away algorithm) */}
      {!inContest && tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <Badge key={t} tone="neutral" variant="soft" size="sm">
              <Tag className="size-2.5" />
              {t}
            </Badge>
          ))}
        </div>
      )}
      {!inContest && knowledgeMapView ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
          <span className="inline-flex items-center gap-1 font-medium text-fg">
            <Network className="size-3" aria-hidden="true" />
            {knowledgeMapView.title}
          </span>
          {knowledgeMapView.nodes.map((node) => (
            <Badge key={node.id} variant="outline" className="font-normal">
              {node.label}
            </Badge>
          ))}
          {!knowledgeMapView.nodes.length ? <span>尚未归类知识节点</span> : null}
        </div>
      ) : null}

      {/* Dense info bar — during contest, hide owner/solutions/discussions to avoid info leak */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg border border-line bg-surface-sunken px-3 py-2">
        {!virtualContestActive ? <InfoChip icon={Send} label="提交" value={nSubmit} href={problemRecordsHref} /> : null}
        {!virtualContestActive ? (
          <InfoChip
            icon={CheckCircle2}
            label="通过"
            value={<span className="text-success-fg">{nAccept}</span>}
            href={acceptedRecordsHref}
          />
        ) : null}
        {!virtualContestActive ? <InfoChip icon={Trophy} label="通过率" value={`${rate}%`} /> : null}
        {!inContest && pdoc.origStat ? <InfoChip icon={BarChart3} label="赛时通过率" value={origStatChipValue(pdoc.origStat)} /> : null}
        {!inContest ? <InfoChip icon={User} label="出题人" value={<ProblemAuthorText authors={authorUdocs} />} /> : null}
        {!inContest && dataContributorUdocs.length ? (
          <InfoChip icon={HardDrive} label="数据贡献者" value={<ProblemAuthorText authors={dataContributorUdocs} />} />
        ) : null}
        {showExternals && solutionCount > 0 && <InfoChip icon={BookOpen} label="题解" value={solutionCount} />}
        {showExternals && discussionCount > 0 && <InfoChip icon={MessageSquare} label="讨论" value={discussionCount} />}
      </div>

      {/* Main content area: two-column layout */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        {/* Left: statement only (mini tabs removed — submit moved to its own page
            and "题解" is reachable via the sidebar quick links / its own button). */}
        <div className="flex min-w-0 flex-col gap-6">
          <Panel>{renderStatement(false)}</Panel>
          {canSubmit && isObjective && (!teamExamMode || teamExamMode.canSubmit) && (!isSubjective || inContest || canPreviewSubjective) ? (
            <ObjectiveAnswerPanel
              questions={objectiveQuestions}
              submitUrl={submitUrl}
              storageKey={objectiveDraftKey}
              signedIn={!!bs.user?.signedIn}
              previewOnly={isSubjective && !inContest}
              reloadOnConflict={!!teamExamMode}
              practiceContextId={practiceContextId}
            />
          ) : null}
          {showExternals && solutionCount > 0 ? (
            <Panel>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-1.5 text-fg-muted">
                  <BookOpen className="size-3.5" />共 {solutionCount} 篇题解
                </span>
                <a href={`${problemUrl}/solution`} className="text-brand-fg hover:underline">
                  查看全部 →
                </a>
              </div>
            </Panel>
          ) : null}
        </div>

        {/* Right: sidebar info panel */}
        <aside className="flex flex-col gap-4">
          {/* Limits */}
          {!structuredStatement ? (
            <Panel>
              <LimitsSection config={config} />
            </Panel>
          ) : null}

          {/* Related contests — hide during contest (would reveal source) */}
          {showExternals && (ctdocs.length > 0 || htdocs.length > 0) && (
            <Panel
              title={(
                <span className="inline-flex items-center gap-1.5">
                  <Trophy className="size-3.5 text-fg-subtle" />
                  相关比赛 & 作业
                </span>
              )}
            >
              <div className="flex flex-col gap-1">
                {[...ctdocs, ...htdocs].slice(0, 5).map((td) => (
                  <a
                    key={String(td._id)}
                    href={replaceRouteTokens(bs.urls.contestDetail, { TID: String(td._id) })}
                    className="block truncate text-xs text-brand-fg hover:underline"
                  >
                    {td.title || String(td._id)}
                  </a>
                ))}
              </div>
            </Panel>
          )}

          {/* Quick links — hide solution/discussion/stats during contest */}
          {showExternals ? (
            <Panel>
              <div className="flex flex-col gap-1">
                <a href={`${problemUrl}/solution`} className="flex items-center gap-1.5 text-xs text-fg-muted hover:text-brand-fg">
                  <BookOpen className="size-3" />
                  题解 ({solutionCount})
                </a>
                <a href={`${problemUrl}/discuss`} className="flex items-center gap-1.5 text-xs text-fg-muted hover:text-brand-fg">
                  <MessageSquare className="size-3" />
                  讨论 ({discussionCount})
                </a>
                <a href={`${problemUrl}/statistics`} className="flex items-center gap-1.5 text-xs text-fg-muted hover:text-brand-fg">
                  <Trophy className="size-3" />
                  统计
                </a>
                <a href={`${problemUrl}/files`} className="flex items-center gap-1.5 text-xs text-fg-muted hover:text-brand-fg">
                  <FileText className="size-3" />
                  附件
                </a>
                {bs.user?.signedIn ? (
                  <a href={problemRecordsHref} className="flex items-center gap-1.5 text-xs text-fg-muted hover:text-brand-fg">
                    <History className="size-3" />
                    提交记录
                  </a>
                ) : null}
              </div>
            </Panel>
          ) : (
            <Panel>
              <div className="flex flex-col gap-1">
                <a href={`${problemUrl}/files${contestQS}`} className="flex items-center gap-1.5 text-xs text-fg-muted hover:text-brand-fg">
                  <FileText className="size-3" />
                  附件
                </a>
                {bs.user?.signedIn ? (
                  <a href={problemRecordsHref} className="flex items-center gap-1.5 text-xs text-fg-muted hover:text-brand-fg">
                    <History className="size-3" />
                    提交记录
                  </a>
                ) : null}
                {contestUrl ? (
                  <a href={contestUrl} className="flex items-center gap-1.5 text-xs text-fg-muted hover:text-brand-fg">
                    <ChevronRight className="size-3 rotate-180" />
                    返回 {isHomework ? '作业' : '比赛'}
                  </a>
                ) : null}
              </div>
            </Panel>
          )}
        </aside>
      </div>
    </Page>
  );
}
