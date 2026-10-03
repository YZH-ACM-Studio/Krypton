import { useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleX,
  ClipboardCopy,
  Code2,
  Download,
  Filter,
  LayoutDashboard,
  ListChecks,
  RotateCcw,
} from 'lucide-react';
import { useRecordSocket } from '@/hooks/use-record-socket';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Page, PageHeader, Toolbar } from '@/components/ui/page';
import { DescriptionList, Panel } from '@/components/ui/panel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { scoreTone, STATUS_DISPLAY, statusDisplay, Verdict } from '@/components/ui/verdict';
import { KryptonIDE } from '@/components/krypton-ide';
import { readTeamExamModeContext } from '@/components/team-exam-mode';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { formatRelativeTime, replaceRouteTokens, toDate } from '@/lib/format';
import {
  defaultRecordDetailTab,
  paginateRecordCases,
  recordCodeDownloadAvailable,
  recordDetailMode,
  recordDetailTabs,
  resolveRecordIdentity,
  summarizeRecordCases,
  type RecordDetailTab,
} from '@/lib/record-detail-workspace';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { ObjectiveRecordResult, isObjectiveRecordProblem } from '@/pages/record-objective';

type RecordScoreAction =
  | { kind: 'cancel'; expectedStatus: number; expectedJudgeAt: string; contestId?: string; contestTeamId?: string }
  | { kind: 'rejudge'; expectedCancellationAt: string; contestId?: string; contestTeamId?: string };

type JsonRecord = Record<string, unknown>;

interface RecordLanguage {
  display?: string;
  name?: string;
}

type RecordLanguages = Record<string, RecordLanguage>;
type RecordStatusTexts = Record<string, unknown>;

interface RecordCase {
  id?: string | number;
  memory?: number;
  message?: unknown;
  score?: string | number;
  status?: number;
  subtask?: string | number;
  subtaskId?: string | number;
  time?: number;
}

interface SubtaskView extends JsonRecord {
  id: string;
  score?: string | number;
  status?: number;
  type?: string | number;
}

interface RecordDocument {
  _id?: unknown;
  cases?: RecordCase[];
  code?: unknown;
  compilerTexts?: unknown;
  files?: {
    code?: unknown;
    hack?: unknown;
  };
  judgeAt?: unknown;
  judgeTexts?: unknown;
  lang?: string;
  memory?: number;
  pid?: string | number;
  progress?: string | number;
  score?: number;
  sourceContestId?: unknown;
  status?: number;
  subtasks?: unknown;
  testCases?: RecordCase[];
  time?: number;
  uid?: string | number;
  virtualAttemptId?: unknown;
}

interface RecordProblemSummary {
  title?: string;
  content?: unknown;
  problemKind?: unknown;
  config?: unknown;
}

interface RecordLanguageContext {
  langs?: RecordLanguages;
}

interface RecordStatistics extends Record<string, number> {
  accepted: number;
  participants: number;
  total: number;
}

interface RecordsPageData extends RecordLanguageContext {
  all?: unknown;
  allDomain?: unknown;
  filterLang?: string;
  filterPid?: string;
  filterStatus?: unknown;
  filterTid?: string;
  filterUidOrName?: string;
  virtual?: boolean;
  virtualAttemptOpen?: boolean;
  page?: unknown;
  pdict?: Record<string, RecordProblemSummary>;
  postContestPracticeActive?: boolean;
  rdocs?: RecordDocument[];
  recordDetailTid?: unknown;
  recordScoreActions?: Record<string, RecordScoreAction>;
  canRejudgeVirtual?: boolean;
  statistics?: RecordStatistics | null;
  statisticsScope?: string;
  statusTexts?: RecordStatusTexts;
  studentDict?: Record<string, { studentId: string; realName: string }>;
  tdoc?: { docId?: unknown };
  udict?: Record<string, GenericUserDoc>;
  notification?: Array<{ name?: string }>;
}

interface RecordExamModeData {
  urls?: {
    problem?: string;
    problems?: string;
    record?: string;
  };
  [key: string]: unknown;
}

interface RecordDetailPageData extends RecordLanguageContext {
  allRevs?: Record<string, string>;
  code?: unknown;
  examMode?: RecordExamModeData;
  examRecordCodeOnly?: boolean;
  examRecordDownloadAvailable?: unknown;
  pdoc?: RecordProblemSummary;
  postContestPracticeRecordAccess?: boolean;
  practiceTid?: unknown;
  rdoc?: RecordDocument;
  recordScoreAction?: RecordScoreAction | null;
  canRejudgeVirtual?: boolean;
  recordStudent?: { studentId?: unknown; realName?: unknown } | null;
  rev?: string;
  tdoc?: { docId?: unknown };
  statusTexts?: RecordStatusTexts;
  testHints?: Record<string, { hint?: string; videoUrl?: string }>;
  udoc?: GenericUserDoc;
  virtual?: boolean;
  virtualAttemptOpen?: boolean;
  virtualContestActive?: boolean;
}

interface RecordScoreResponse {
  rdoc?: RecordDocument;
  recordScoreAction?: RecordScoreAction | null;
}

function getUser(udict: Record<string, GenericUserDoc>, uid: string | number | undefined) {
  return uid != null ? (udict[String(uid)] ?? null) : null;
}

const RECORD_NATIVE_TABLE_CLASS =
  'krypton-table w-full caption-bottom text-sm [&_tr>*:first-child]:pl-5 [&_tr>*:last-child]:pr-5';

const SCORE_TONE_CLASS = {
  danger: 'text-danger-fg',
  warning: 'text-warning-fg',
  success: 'text-success-fg',
} as const;

function verdictTexts(statusTexts: RecordStatusTexts): Record<string, string> {
  const texts: Record<string, string> = {};
  for (const [key, value] of Object.entries(statusTexts)) {
    if (typeof value === 'string') texts[key] = value;
  }
  return texts;
}

function statusLabel(status: number | string, statusTexts: RecordStatusTexts) {
  return statusDisplay(Number(status), verdictTexts(statusTexts)).label;
}

function verdictStatus(status: number | undefined): number {
  return typeof status === 'number' ? status : 0;
}

function problemFullScore(config: unknown): number {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return 100;
  const parsed = config as { maxScore?: unknown; questions?: unknown };
  if (typeof parsed.maxScore === 'number' && Number.isFinite(parsed.maxScore) && parsed.maxScore > 0) return parsed.maxScore;
  if (!Array.isArray(parsed.questions)) return 100;
  let sum = 0;
  for (const question of parsed.questions) {
    if (!question || typeof question !== 'object' || Array.isArray(question)) continue;
    const score = (question as { score?: unknown }).score;
    if (typeof score === 'number' && Number.isFinite(score) && score > 0) sum += score;
  }
  return sum > 0 ? sum : 100;
}

function scoreToneClass(value: unknown, full: number): string | undefined {
  const score = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  if (!Number.isFinite(score)) return undefined;
  return SCORE_TONE_CLASS[scoreTone(score, full)];
}

function formatMemory(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  const kib = value;
  if (kib < 1024) return `${Math.round(kib * 10) / 10} KiB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${Math.round(mib * 10) / 10} MiB`;
  return `${Math.round((mib / 1024) * 10) / 10} GiB`;
}

function formatTime(value: unknown, status?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  const limited = status === 3 || status === 4 || status === 5;
  return `${limited ? '≥ ' : ''}${Math.round(value)}ms`;
}

function toRecordDate(value: unknown) {
  const date = toDate(value);
  if (date) return date;
  if (typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value)) {
    return new Date(Number.parseInt(value.slice(0, 8), 16) * 1000);
  }
  return null;
}

function formatRecordTime(value: unknown, locale: string) {
  const date = toRecordDate(value);
  return date ? formatRelativeTime(date, locale) : '—';
}

function buildUrlWithQuery(baseUrl: string, params: Record<string, unknown>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === '' || value === false) return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${query}` : baseUrl;
}

function normalizeId(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object' && value && '$oid' in value) {
    return String((value as { $oid?: unknown }).$oid || '');
  }
  return String(value);
}

function virtualRejudgeHref(record: Pick<RecordDocument, 'virtualAttemptId' | 'sourceContestId'> | null | undefined): string {
  if (!record) return '';
  const attemptId = normalizeId(record.virtualAttemptId);
  const tid = normalizeId(record.sourceContestId);
  if (!attemptId || !tid) return '';
  return `/contest/${encodeURIComponent(tid)}/virtual/rejudge?attemptId=${encodeURIComponent(attemptId)}`;
}

function formatJudgeText(text: unknown): string {
  if (text == null || text === '') return '';
  if (typeof text === 'string') return text;
  if (typeof text === 'number' || typeof text === 'boolean') return String(text);
  throw new TypeError('Record judge messages must be formatted by the server');
}

function collectTexts(value: unknown): string[] {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  return source.map(formatJudgeText).filter(Boolean);
}

function normalizeSubtasks(value: unknown): SubtaskView[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(
      (item, index) =>
        ({
          ...(typeof item === 'object' && item ? (item as JsonRecord) : {}),
          id: String((typeof item === 'object' && item ? (item as JsonRecord).id : undefined) ?? index + 1),
        }) as SubtaskView,
    );
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, JsonRecord | null | undefined>).map(([id, item]) => ({ ...(item || {}), id }) as SubtaskView);
  }
  return [];
}

/**
 * Resolve a Hydro language id (e.g. "cc.cc17") to its human-readable
 * display name from `data.langs` (e.g. "C++ 17"). Falls back to the
 * raw id if the lookup table or entry is missing.
 */
function langDisplay(langs: RecordLanguages | undefined, id: string | undefined): string {
  if (!id) return '—';
  const entry = (langs || {})[id];
  return entry?.display || entry?.name || id;
}

function DiagnosticPanel({ title, texts }: { title: string; texts: string[] }) {
  if (!texts.length) return null;

  return (
    <Panel title={title} flush>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-fg">
        {texts.join('\n')}
      </pre>
    </Panel>
  );
}

async function copyRecordCode(text: string) {
  if (!text) throw new Error('没有可复制的代码');
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Continue to the compatibility path; failure is surfaced below if it
      // also cannot copy.
    }
  }
  if (typeof document === 'undefined') throw new Error('当前环境不支持复制');
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  textarea.focus();
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
    active?.focus();
  }
  if (!copied) throw new Error('浏览器拒绝了复制操作');
}

function RecordIdentity({
  problemUrl,
  problemTitle,
  username,
  student,
}: {
  problemUrl: string;
  problemTitle: string;
  username: string;
  student: { studentId: string; realName: string } | null;
}) {
  const items = [
    {
      term: '题目',
      detail: (
        <a href={problemUrl} title={problemTitle} className="break-words font-medium text-fg hover:text-brand-fg">
          {problemTitle}
        </a>
      ),
    },
    { term: '用户', detail: username },
  ];
  if (student?.studentId) items.push({ term: '学号', detail: <span className="font-mono">{student.studentId}</span> });
  if (student?.realName) items.push({ term: '姓名', detail: student.realName });
  return (
    <Panel title="题目 / 用户">
      <DescriptionList items={items} />
    </Panel>
  );
}

function RecordCodeContent({
  data,
  rdoc,
  code,
  copyState,
  onCopy,
  examCodeOnly = false,
}: {
  data: RecordLanguageContext;
  rdoc: RecordDocument;
  code: unknown;
  copyState: 'idle' | 'copied' | 'failed';
  onCopy: () => void;
  examCodeOnly?: boolean;
}) {
  return (
    <>
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {examCodeOnly ? <p className="text-sm font-semibold text-fg">提交代码</p> : null}
          {examCodeOnly ? (
            <p className="mt-0.5 text-xs text-fg-muted">考试期间仅展示本次提交源码，不提供评测状态、输出或测试点。</p>
          ) : null}
          {!examCodeOnly ? <Badge variant="outline" size="sm">{langDisplay(data.langs, rdoc.lang)}</Badge> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {examCodeOnly ? <Badge variant="outline" size="sm">{langDisplay(data.langs, rdoc.lang)}</Badge> : null}
          {copyState === 'failed' ? (
            <span role="alert" className="text-xs text-danger-fg">
              复制失败，请检查浏览器权限
            </span>
          ) : null}
          {code ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={copyState === 'copied' ? '提交代码已复制' : copyState === 'failed' ? '重新复制提交代码' : '复制提交代码'}
              onClick={onCopy}
            >
              {copyState === 'copied' ? <Check /> : copyState === 'failed' ? <CircleX /> : <ClipboardCopy />}
              {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '重试复制' : '复制代码'}
            </Button>
          ) : null}
          <span className="sr-only" role="status" aria-live="polite">
            {copyState === 'copied' ? '提交代码已复制' : ''}
          </span>
        </div>
      </div>
      {code ? (
        <div className="h-[min(68vh,720px)] min-h-0 overflow-hidden">
          <KryptonIDE
            mode="readonly"
            langs={[]}
            defaultLang={rdoc.lang || 'cc.cc17'}
            value={String(code)}
            onValueChange={() => {
              /* read-only */
            }}
            minHeight={0}
            className="h-full min-h-0 rounded-none border-0"
          />
        </div>
      ) : (
        <EmptyState compact title="该提交没有可直接预览的文本源码；若为文件提交，请使用页面上方的下载入口。" />
      )}
    </>
  );
}

function RecordScoreActionDialog({
  open,
  record: rdoc,
  action,
  endpoint,
  problemTitle,
  username,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  record: RecordDocument | null;
  action: RecordScoreAction | null;
  endpoint: string;
  problemTitle: string;
  username: string;
  onOpenChange: (open: boolean) => void;
  onSuccess: (payload: RecordScoreResponse) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancel = action?.kind === 'cancel';

  async function submit() {
    if (!rdoc || !action) return;
    setBusy(true);
    setError('');
    try {
      const body = new URLSearchParams({ operation: cancel ? 'cancel' : 'rejudge' });
      if (cancel) {
        body.set('expectedStatus', String(action.expectedStatus));
        body.set('expectedJudgeAt', action.expectedJudgeAt);
        if (reason.trim()) body.set('reason', reason.trim());
      } else {
        body.set('expectedCancellationAt', action.expectedCancellationAt);
      }
      const response = await fetchHydroResponse(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body,
      });
      if (!response.ok) throw new Error(await readHydroResponseError(response, cancel ? '取消成绩失败' : '重新评测失败'));
      const payload: RecordScoreResponse = await response.json();
      onSuccess(payload);
      setReason('');
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) {
          setError('');
          setReason('');
        }
        onOpenChange(next);
      }}
    >
      <DialogContent size="lg" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>{cancel ? '确认取消单条记录成绩' : '重新评测并恢复成绩'}</DialogTitle>
          <p className="mt-1 text-sm text-fg-muted">
            记录 #{String(rdoc?._id || '').slice(-8)} · {problemTitle} · {username}
          </p>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Alert tone="warning" title={cancel ? '这会立即把该记录计分归零' : '这会使用当前题目配置和测试数据重新评测'}>
            {cancel
              ? '系统将同步重算该用户的题目状态及关联比赛成绩。历史提交统计、气球、讨论和旧计数不会被改写。'
              : '恢复结果以本次重新评测为准，不会把取消前的旧快照直接写回。'}
          </Alert>
          {action?.contestId ? (
            <div className="rounded-lg border border-line bg-surface-sunken px-4 py-3 text-sm">
              <p className="font-medium text-fg">比赛影响</p>
              <p className="mt-1 break-all text-fg-muted">
                比赛 {action.contestId}
                {action.contestTeamId ? ` · 队伍 ${action.contestTeamId}` : ''}；若比赛仍在进行，榜单会立即按新投影更新。
              </p>
            </div>
          ) : null}
          {cancel ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-fg">备注（可选）</span>
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={240} placeholder="简要记录取消原因" />
              <span className="block text-right text-xs tabular text-fg-subtle">{reason.length}/240</span>
            </label>
          ) : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" variant={cancel ? 'danger' : 'primary'} disabled={busy} onClick={() => void submit()}>
            {busy ? '处理中…' : cancel ? '确认取消成绩' : '重新评测'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VirtualRejudgeCard({ record }: { record: RecordDocument }) {
  const vpHref = virtualRejudgeHref(record);
  if (!vpHref) return null;
  return (
    <Panel title="虚拟参赛重测">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-fg-muted">虚拟参赛记录不能从本页直接重测，请到确认页核对 Record ID 后再提交。</p>
        <Button asChild variant="primary" className="shrink-0">
          <a href={vpHref}>前往确认重测</a>
        </Button>
      </div>
    </Panel>
  );
}

function RecordScoreManageCard({
  action,
  record,
  onOpen,
}: {
  action: RecordScoreAction;
  record: RecordDocument;
  onOpen: () => void;
}) {
  const vpHref = virtualRejudgeHref(record);
  const useVirtualRejudge = action.kind === 'rejudge' && !!vpHref;
  return (
    <Panel title={action.kind === 'cancel' ? '成绩管理' : useVirtualRejudge ? '虚拟参赛重测' : '恢复已取消记录'}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-fg-muted">
          {action.kind === 'cancel'
            ? '仅取消这一条记录的计分，并同步重算它影响到的题目状态与比赛榜单。'
            : useVirtualRejudge
              ? '虚拟参赛记录不能从本页直接重测，请到确认页核对 Record ID 后再提交。'
              : '使用当前题目配置和测试数据重新评测；结果通过正常评测链重新进入计分。'}
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          {useVirtualRejudge ? (
            <Button asChild variant="primary" className="shrink-0">
              <a href={vpHref}>前往确认重测</a>
            </Button>
          ) : (
            <Button
              type="button"
              variant={action.kind === 'cancel' ? 'danger' : 'primary'}
              className="shrink-0"
              onClick={onOpen}
            >
              {action.kind === 'cancel' ? '取消本条成绩' : '重新评测并恢复'}
            </Button>
          )}
          {action.kind === 'cancel' && vpHref ? (
            <Button asChild variant="secondary" className="shrink-0">
              <a href={vpHref}>确认虚拟重测</a>
            </Button>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

export function RecordsPage() {
  const bs = useBootstrap();
  const data = bs.page.data as RecordsPageData;
  const initialRdocs = data.rdocs || [];
  // Local state so WS updates can splice in / patch existing rows.
  // The first render mirrors server pagination; subsequent rdoc updates
  // arrive via the WS hook below and merge by `_id`.
  const [rdocs, setRdocs] = useState<RecordDocument[]>(initialRdocs);
  const [recordScoreActions, setRecordScoreActions] = useState<Record<string, RecordScoreAction>>(data.recordScoreActions || {});
  const canRejudgeVirtual = data.canRejudgeVirtual === true;
  const showRecordManage = Object.keys(recordScoreActions).length > 0 || canRejudgeVirtual;
  const [scoreActionRid, setScoreActionRid] = useState('');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const page = Number(data.page) || 1;
  const locale = bs.locale;
  const pdict = data.pdict || {};
  const udict: Record<string, GenericUserDoc> = { ...bs.udict, ...(data.udict || {}) };
  // Admin-only studentId/realName column data. Empty for non-admin viewers;
  // we render the column conditionally on `hasStudentColumn`.
  const studentDict: Record<string, { studentId: string; realName: string }> = data.studentDict || {};
  const hasStudentColumn = Object.keys(studentDict).length > 0;
  const langs = data.langs || {};
  const statusTexts = data.statusTexts || {};
  const filterStatus = typeof data.filterStatus === 'number' ? String(data.filterStatus) : '';
  const postContestPracticeActive = data.postContestPracticeActive === true;
  const virtualRecords = data.virtual === true;
  const virtualAttemptOpen = data.virtualAttemptOpen === true;
  const practiceTid = postContestPracticeActive || virtualRecords ? normalizeId(data.recordDetailTid || data.filterTid || data.tdoc?.docId) : '';
  const filterParams = {
    uidOrName: data.filterUidOrName || '',
    pid: data.filterPid || '',
    tid: data.filterTid || '',
    practice: postContestPracticeActive ? '1' : '',
    virtual: virtualRecords ? '1' : '',
    lang: data.filterLang || '',
    status: filterStatus,
    all: data.all ? '1' : '',
    allDomain: data.allDomain ? '1' : '',
    stat: data.statistics ? '1' : '',
  };
  const nextUrl = buildUrlWithQuery(bs.urls.records, { ...filterParams, page: page + 1 });
  const prevUrl = buildUrlWithQuery(bs.urls.records, { ...filterParams, page: page - 1 });
  const statistics = data.statistics || null;
  const languageOptions = Object.entries(langs);
  const listVerdictTexts = verdictTexts(statusTexts);
  const statusOptions: Array<[string, string]> = Object.keys(statusTexts).length
    ? Object.keys(statusTexts).map((key) => [key, statusLabel(key, statusTexts)])
    : Object.entries(STATUS_DISPLAY).map(([key, value]) => [key, value.label]);
  const selectedScoreRecord = rdocs.find((rdoc) => String(rdoc._id) === scoreActionRid) || null;
  const selectedScoreAction = scoreActionRid ? recordScoreActions[scoreActionRid] || null : null;
  const filtersActive = Boolean(
    filterParams.uidOrName ||
      filterParams.pid ||
      filterParams.tid ||
      filterParams.lang ||
      filterParams.status ||
      filterParams.all ||
      filterParams.allDomain ||
      filterParams.stat,
  );

  // Live updates: subscribe to /record-conn with the same filters as the
  // current page so newly arriving rdocs (or status flips) update the
  // table without a full reload. New ids land at the top; existing ones
  // get patched in place.
  useRecordSocket({
    filters: {
      tid: filterParams.tid || undefined,
      practice: postContestPracticeActive || undefined,
      virtual: virtualRecords || undefined,
      pid: filterParams.pid || undefined,
      uidOrName: filterParams.uidOrName || undefined,
      lang: filterParams.lang || undefined,
      status: filterStatus || undefined,
      all: filterParams.all === '1' || undefined,
      allDomain: filterParams.allDomain === '1' || undefined,
    },
    onRdoc: (rdoc) => {
      const id = String(rdoc._id);
      setRdocs((prev) => {
        const idx = prev.findIndex((r) => String(r._id) === id);
        if (idx >= 0) {
          const next = prev.slice();
          next[idx] = { ...prev[idx], ...rdoc } as RecordDocument;
          return next;
        }
        // Insert new record at the top; keep the page-size cap so we
        // don't grow unboundedly between page navigations.
        const limit = prev.length || 100;
        return [rdoc as RecordDocument, ...prev].slice(0, limit);
      });
    },
    onRecordScoreAction: (action, rid) => {
      if (!rid) return;
      setRecordScoreActions((current) => {
        const updated = { ...current };
        if (action) updated[rid] = action as RecordScoreAction;
        else delete updated[rid];
        return updated;
      });
    },
    disabled: !bs.user.signedIn && !filterParams.tid,
  });

  return (
    <Page width="wide">
      {(data.notification || []).map((item, index) =>
        item?.name ? (
          <Alert key={`${item.name}-${index}`} tone="warning">
            {item.name}
          </Alert>
        ) : null,
      )}
      {postContestPracticeActive ? (
        <Alert tone="info">
          这里只显示你在该题上的普通个人提交，不计入原比赛成绩、罚时或排行榜。
        </Alert>
      ) : null}
      <PageHeader title="评测记录" description="所有提交记录" />

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between lg:hidden">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-expanded={filtersExpanded}
            aria-controls="record-list-filters"
            onClick={() => setFiltersExpanded((open) => !open)}
          >
            <Filter />
            {filtersExpanded ? '收起筛选' : `筛选${filtersActive ? ' · 已启用' : ''}`}
          </Button>
        </div>
        <form
          id="record-list-filters"
          method="get"
          action={bs.urls.records}
          className={cn('flex flex-col gap-3', filtersExpanded ? 'flex' : 'hidden lg:flex')}
        >
          {postContestPracticeActive ? <input type="hidden" name="practice" value="1" /> : null}
          {virtualRecords ? <input type="hidden" name="virtual" value="1" /> : null}
          <Toolbar className="items-end">
            <FormField label="用户 / UID" className="w-full sm:w-40">
              <Input name="uidOrName" size="sm" defaultValue={data.filterUidOrName || ''} placeholder="用户名或 UID" />
            </FormField>
            <FormField label="题目" className="w-full sm:w-32">
              <Input name="pid" size="sm" defaultValue={data.filterPid || ''} placeholder="题号" />
            </FormField>
            <FormField label="比赛" className="w-full sm:w-32">
              <Input name="tid" size="sm" defaultValue={data.filterTid || ''} placeholder="比赛 ID" />
            </FormField>
            <FormField label="语言" className="w-full sm:w-32">
              <SimpleSelect
                name="lang"
                size="sm"
                defaultValue={data.filterLang || ''}
                options={[
                  { value: '', label: '全部语言' },
                  ...languageOptions.map(([key, value]) => ({
                    value: key,
                    label: String(value?.display || value?.name || key),
                  })),
                ]}
              />
            </FormField>
            <FormField label="状态" className="w-full sm:w-32">
              <SimpleSelect
                name="status"
                size="sm"
                defaultValue={filterStatus}
                options={[
                  { value: '', label: '全部提交' },
                  ...statusOptions.map(([key, label]) => ({
                    value: key,
                    label,
                  })),
                ]}
              />
            </FormField>
            <Button type="submit" variant="primary" size="sm">
              <Filter />
              筛选
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a href={bs.urls.records}>
                <RotateCcw />
                重置
              </a>
            </Button>
          </Toolbar>
          <div className="flex flex-wrap gap-4 text-xs text-fg-subtle">
            <label className="inline-flex items-center gap-2">
              <Checkbox size="sm" name="all" value="1" defaultChecked={!!data.all} />
              包含比赛记录
            </label>
            <label className="inline-flex items-center gap-2">
              <Checkbox size="sm" name="allDomain" value="1" defaultChecked={!!data.allDomain} />
              全站域记录
            </label>
            <label className="inline-flex items-center gap-2">
              <Checkbox size="sm" name="stat" value="1" defaultChecked={!!statistics} />
              显示统计
            </label>
          </div>
        </form>
      </div>

      <Panel flush className="min-w-0">
          <ScrollArea className="max-h-[min(65vh,680px)] w-full" orientation="both">
            {/* ds-allow DS005: 记录宽表必须保留原生 table，才能放进这条双向滚动的 ScrollArea */}
            <table className={cn(RECORD_NATIVE_TABLE_CLASS, 'min-w-[56rem]')}>{/* ds-allow DS004: 记录表至少 56rem，避免列被压扁，间距档没有这个宽度 */}
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">状态</TableHead>
                  <TableHead className="min-w-0">题目</TableHead>
                  <TableHead className="w-28">用户</TableHead>
                  {hasStudentColumn ? <TableHead className="w-32">学号 / 姓名</TableHead> : null}
                  <TableHead className="w-20 text-center">语言</TableHead>
                  <TableHead className="w-24 text-right">得分</TableHead>
                  <TableHead className="w-24 text-right">时间</TableHead>
                  <TableHead className="w-24 text-right">内存</TableHead>
                  <TableHead className="w-28 text-right">提交时间</TableHead>
                  {showRecordManage ? <TableHead className="text-right">管理</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
              {rdocs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8 + (hasStudentColumn ? 1 : 0) + (showRecordManage ? 1 : 0)}>
                    <EmptyState compact title="暂无提交记录" />
                  </TableCell>
                </TableRow>
              ) : (
                rdocs.map((r) => {
                  const user = getUser(udict, r.uid);
                  const pdoc = pdict[String(r.pid)] || {};
                  const recordUrl = buildUrlWithQuery(replaceRouteTokens(bs.urls.recordDetail, { RID: String(r._id) }), {
                    tid: practiceTid,
                    practice: postContestPracticeActive,
                    virtual: virtualRecords,
                  });
                  const problemUrl = buildUrlWithQuery(replaceRouteTokens(bs.urls.problemDetail, { PID: String(r.pid) }), {
                    tid: practiceTid,
                    virtual: virtualAttemptOpen,
                  });
                  const scoreAction = recordScoreActions[String(r._id)];
                  const vpHref = virtualRejudgeHref(r);
                  const problemLabel = pdoc.title ? `${r.pid}. ${pdoc.title}` : String(r.pid ?? '');
                  return (
                    <TableRow key={String(r._id)}>
                      <TableCell>
                        <a href={recordUrl} className="hover:underline" title={statusDisplay(verdictStatus(r.status), listVerdictTexts).label}>
                          <Verdict status={verdictStatus(r.status)} texts={listVerdictTexts} compact />
                        </a>
                      </TableCell>
                      <TableCell className="min-w-0 max-w-72">
                        <a
                          href={problemUrl}
                          title={problemLabel}
                          className="block min-w-0 truncate font-medium text-fg hover:text-brand-fg hover:underline"
                        >
                          {problemLabel}
                        </a>
                      </TableCell>
                      <TableCell className="text-sm text-fg">{user?.uname || `#${r.uid}`}</TableCell>
                      {hasStudentColumn ? (
                        <TableCell className="text-xs">
                          {studentDict[String(r.uid)] ? (
                            <>
                              <div className="font-mono tabular">{studentDict[String(r.uid)].studentId}</div>
                              <div className="text-fg-subtle">{studentDict[String(r.uid)].realName}</div>
                            </>
                          ) : (
                            <span className="text-fg-disabled">—</span>
                          )}
                        </TableCell>
                      ) : null}
                      <TableCell className="text-center">
                        <Badge variant="outline" size="sm">
                          {langDisplay(langs, r.lang)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {r.score != null ? (
                          <span className={cn('font-semibold', scoreToneClass(r.score, problemFullScore(pdoc.config)))}>{r.score}</span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell align="right" className="text-right tabular text-xs text-fg-subtle">{formatTime(r.time, r.status)}</TableCell>
                      <TableCell align="right" className="text-right tabular text-xs text-fg-subtle">{formatMemory(r.memory)}</TableCell>
                      <TableCell className="text-right text-xs tabular text-fg-subtle">{formatRecordTime(r._id || r.judgeAt, locale)}</TableCell>
                      {showRecordManage ? (
                        <TableCell className="whitespace-nowrap text-right">
                          {scoreAction ? (
                            <div className="inline-flex justify-end gap-1">
                              {scoreAction.kind === 'rejudge' && vpHref ? (
                                <Button asChild size="sm" variant="ghost">
                                  <a href={vpHref}>确认重测</a>
                                </Button>
                              ) : (
                                <Button type="button" size="sm" variant="ghost" onClick={() => setScoreActionRid(String(r._id))}>
                                  {scoreAction.kind === 'cancel' ? '取消成绩' : '重新评测'}
                                </Button>
                              )}
                              {scoreAction.kind === 'cancel' && vpHref ? (
                                <Button asChild size="sm" variant="ghost">
                                  <a href={vpHref}>确认重测</a>
                                </Button>
                              ) : null}
                            </div>
                          ) : canRejudgeVirtual && vpHref ? (
                            <Button asChild size="sm" variant="ghost">
                              <a href={vpHref}>确认重测</a>
                            </Button>
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })
              )}
              </TableBody>
            </table>
          </ScrollArea>
      </Panel>

      <RecordScoreActionDialog
        open={!!selectedScoreRecord && !!selectedScoreAction}
        record={selectedScoreRecord}
        action={selectedScoreAction}
        endpoint={
          selectedScoreRecord
            ? replaceRouteTokens(bs.urls.recordDetail, {
                RID: String(selectedScoreRecord._id),
              })
            : ''
        }
        problemTitle={selectedScoreRecord ? String(pdict[String(selectedScoreRecord.pid)]?.title || selectedScoreRecord.pid) : ''}
        username={selectedScoreRecord ? String(getUser(udict, selectedScoreRecord.uid)?.uname || `#${selectedScoreRecord.uid}`) : ''}
        onOpenChange={(open) => {
          if (!open) setScoreActionRid('');
        }}
        onSuccess={(payload) => {
          const next = payload.rdoc;
          if (!next?._id) return;
          const rid = String(next._id);
          setRdocs((current) => current.map((item) => (String(item._id) === rid ? { ...item, ...next } : item)));
          setRecordScoreActions((current) => {
            const updated = { ...current };
            if (payload.recordScoreAction) updated[rid] = payload.recordScoreAction;
            else delete updated[rid];
            return updated;
          });
        }}
      />

      <div className="flex items-center justify-center gap-2">
        {page > 1 ? (
          <Button asChild variant="secondary" size="sm">
            <a href={prevUrl}>上一页</a>
          </Button>
        ) : (
          <Button variant="secondary" size="sm" disabled>
            上一页
          </Button>
        )}
        <span className="text-xs tabular text-fg-subtle">第 {page} 页</span>
        {rdocs.length ? (
          <Button asChild variant="secondary" size="sm">
            <a href={nextUrl}>下一页</a>
          </Button>
        ) : (
          <Button variant="secondary" size="sm" disabled>
            下一页
          </Button>
        )}
      </div>

      {statistics ? (
        <Panel
          title="评测统计"
          actions={
            data.statisticsScope === 'contest' ? (
              <Badge variant="outline" size="sm">本场比赛</Badge>
            ) : data.statisticsScope === 'all' ? (
              <Badge variant="outline" size="sm">全站</Badge>
            ) : null
          }
        >
          <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {[
              ['5 分钟', 'd5min'],
              ['1 小时', 'd1h'],
              ['今日', 'day'],
              ['本周', 'week'],
              ['本月', 'month'],
              ['今年', 'year'],
              ['总计', 'total'],
            ].map(([label, key]) => (
              <div key={key} className="rounded-md border border-line bg-surface-sunken px-3 py-2">
                <div className="text-2xs text-fg-subtle">{label}</div>
                <div className="font-mono text-sm font-medium tabular">{statistics[key] ?? 0}</div>
              </div>
            ))}
          </div>
          {data.statisticsScope === 'contest' ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <div className="rounded-md border border-line bg-surface-sunken px-3 py-2">
                <div className="text-2xs text-fg-subtle">本场 AC</div>
                <div className="font-mono text-sm font-medium tabular">{statistics.accepted ?? 0}</div>
              </div>
              <div className="rounded-md border border-line bg-surface-sunken px-3 py-2">
                <div className="text-2xs text-fg-subtle">提交人数</div>
                <div className="font-mono text-sm font-medium tabular">{statistics.participants ?? 0}</div>
              </div>
              <div className="rounded-md border border-line bg-surface-sunken px-3 py-2">
                <div className="text-2xs text-fg-subtle">人均提交</div>
                <div className="font-mono text-sm font-medium tabular">
                  {statistics.participants ? (statistics.total / statistics.participants).toFixed(1) : '—'}
                </div>
              </div>
            </div>
          ) : null}
        </Panel>
      ) : null}
    </Page>
  );
}

export function RecordDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data as RecordDetailPageData;
  const initialRdoc = data.rdoc || {};
  // Live-tracking state — WS updates patch subtask/case progress in place
  // so the user sees judging move from "Pending" → "Judging" → final.
  const [rdoc, setRdoc] = useState<RecordDocument>(initialRdoc);
  const [recordScoreAction, setRecordScoreAction] = useState<RecordScoreAction | null>(data.recordScoreAction || null);
  const canRejudgeVirtual = data.canRejudgeVirtual === true;
  const [scoreActionOpen, setScoreActionOpen] = useState(false);
  const pdoc = data.pdoc || {};
  const detailVerdictTexts = verdictTexts(data.statusTexts || {});
  const detailFullScore = problemFullScore(pdoc.config);
  const code = data.code || rdoc.code || '';
  const locale = bs.locale;
  const user = data.udoc || getUser(bs.udict, rdoc.uid);
  const recordIdentity = resolveRecordIdentity({
    user,
    uid: rdoc.uid,
    student: data.recordStudent,
  });
  const cases = rdoc.testCases || rdoc.cases || [];
  // PTA-style per-test-point hints, already visibility-filtered server-side
  // (RecordDetailHandler). Keyed by case identity `${subtaskId}-${caseId}` (the
  // same numbering the judge assigns), looked up per row below.
  const testHints = data.testHints || {};
  const compilerTexts = collectTexts(rdoc.compilerTexts);
  const judgeTexts = collectTexts(rdoc.judgeTexts);
  const subtasks = normalizeSubtasks(rdoc.subtasks);
  const tabs = recordDetailTabs({ hasCode: !!code, caseCount: cases.length });
  const [activeTab, setActiveTab] = useState<RecordDetailTab>(() => defaultRecordDetailTab({ hasCode: !!code, caseCount: cases.length }));
  const [casePage, setCasePage] = useState(1);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const currentTab = tabs.includes(activeTab) ? activeTab : defaultRecordDetailTab({ hasCode: !!code, caseCount: cases.length });
  const caseSummary = summarizeRecordCases(cases);
  const casePageData = paginateRecordCases(cases, casePage);
  const canSplitWorkspace = tabs.includes('code') && tabs.includes('cases');
  const showCasesPanel = currentTab === 'cases' || (canSplitWorkspace && currentTab === 'code');
  const showCodePanel = currentTab === 'code' || (canSplitWorkspace && currentTab === 'cases');
  const allRevs = Object.entries(data.allRevs || {});
  const examUrls = data.examMode?.urls || {};
  const teamExamMode = readTeamExamModeContext(data.examMode);
  const postContestPracticeRecordAccess = data.postContestPracticeRecordAccess === true;
  const virtualRecords = data.virtual === true;
  const virtualAttemptOpen = data.virtualAttemptOpen === true;
  const detailMode = recordDetailMode({
    hasExamMode: !!data.examMode || data.examRecordCodeOnly === true,
    hasContestContext: !!data.tdoc,
    postContestPractice: postContestPracticeRecordAccess,
  });
  const practiceTid = postContestPracticeRecordAccess || virtualRecords ? normalizeId(data.practiceTid || data.tdoc?.docId) : '';
  const recordUrlBase = examUrls.record
    ? String(examUrls.record).replace('__RID__', String(rdoc._id))
    : replaceRouteTokens(bs.urls.recordDetail, { RID: String(rdoc._id) });
  const recordUrl = buildUrlWithQuery(recordUrlBase, {
    tid: practiceTid,
    practice: postContestPracticeRecordAccess,
    virtual: virtualRecords,
  });
  const downloadUrl = buildUrlWithQuery(recordUrl, { download: true });
  const codeDownloadAvailable = recordCodeDownloadAvailable({
    mode: detailMode,
    serverAvailable: data.examRecordDownloadAvailable,
    hasInlineCode: !!code,
    hasCodeFile: !!rdoc.files?.code,
    hasHackFile: !!rdoc.files?.hack,
  });
  const problemUrlBase = examUrls.problem
    ? String(examUrls.problem).replace('__PID__', String(rdoc.pid))
    : replaceRouteTokens(bs.urls.problemDetail, { PID: String(rdoc.pid) });
  const problemUrl = buildUrlWithQuery(problemUrlBase, { tid: practiceTid, virtual: virtualAttemptOpen || undefined });
  const recordListUrl = virtualRecords
    ? buildUrlWithQuery(bs.urls.records, {
        tid: practiceTid,
        virtual: true,
        pid: rdoc.pid,
      })
    : postContestPracticeRecordAccess
      ? buildUrlWithQuery(bs.urls.records, {
          tid: practiceTid,
          practice: true,
          pid: rdoc.pid,
          uidOrName: bs.user?.id,
        })
      : examUrls.problems || bs.urls.records;

  useRecordSocket({
    path: '/record-detail-conn',
    filters: {
      rid: String(rdoc._id || ''),
      tid: practiceTid || undefined,
      practice: postContestPracticeRecordAccess || undefined,
      virtual: virtualRecords || undefined,
    },
    onRdoc: (next) => {
      if (!next || !next._id) return;
      // Merge — preserve any fields the server may not echo (e.g. `code`
      // may be omitted from later updates to save bandwidth).
      setRdoc((cur) => ({ ...cur, ...next }) as RecordDocument);
    },
    onRecordScoreAction: (action) => setRecordScoreAction((action as RecordScoreAction | null) || null),
    disabled: !rdoc._id || detailMode === 'exam-code',
  });

  const handleCopyCode = async () => {
    try {
      await copyRecordCode(String(code));
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  if (isObjectiveRecordProblem(pdoc)) {
    return (
      <Page width="wide">
        <PageHeader
          breadcrumb={<Breadcrumb items={[{ label: '记录', href: recordListUrl }, { label: '客观题' }]} />}
          title={`提交记录 #${String(rdoc._id).slice(-8)}`}
          meta={<span className="tabular">{formatRecordTime(rdoc._id, locale)}</span>}
        />
        <ObjectiveRecordResult
          pdoc={pdoc}
          rdoc={rdoc}
          code={code}
          problemUrl={problemUrl}
          username={recordIdentity.username}
          student={recordIdentity.student}
          submittedAt={formatRecordTime(rdoc._id, locale)}
        />
        {recordScoreAction ? (
          <RecordScoreManageCard action={recordScoreAction} record={rdoc} onOpen={() => setScoreActionOpen(true)} />
        ) : canRejudgeVirtual ? (
          <VirtualRejudgeCard record={rdoc} />
        ) : null}
        <RecordScoreActionDialog
          open={scoreActionOpen && !!recordScoreAction}
          record={rdoc}
          action={recordScoreAction}
          endpoint={recordUrl}
          problemTitle={String(pdoc.title || rdoc.pid || '')}
          username={recordIdentity.username}
          onOpenChange={setScoreActionOpen}
          onSuccess={(payload) => {
            if (payload.rdoc) setRdoc((current) => ({ ...current, ...payload.rdoc }));
            setRecordScoreAction(payload.recordScoreAction || null);
          }}
        />
      </Page>
    );
  }

  const detailTitle = `${detailMode === 'exam-code' ? '提交代码' : '提交记录'} #${String(rdoc._id).slice(-8)}`;
  return (
    <Page width="wide">
      {postContestPracticeRecordAccess ? (
        <Alert tone="info">
          这是个人赛后补题记录，不计入原比赛成绩、罚时或排行榜。
        </Alert>
      ) : null}
      <PageHeader
        breadcrumb={<Breadcrumb items={[{ label: '记录', href: recordListUrl }, { label: detailMode === 'exam-code' ? '提交代码' : '提交记录' }]} />}
        title={detailTitle}
        meta={detailMode === 'exam-code' ? undefined : (
          <>
            <Verdict status={verdictStatus(rdoc.status)} texts={detailVerdictTexts} size="lg" />
            <span className={cn('font-semibold', scoreToneClass(rdoc.score, detailFullScore))}>{rdoc.score ?? '—'}</span>
            <span>{langDisplay(data.langs, rdoc.lang)}</span>
            <span>{formatRecordTime(rdoc._id, locale)}</span>
            <span className="tabular">{formatTime(rdoc.time, rdoc.status)}</span>
            <span className="tabular">{formatMemory(rdoc.memory)}</span>
          </>
        )}
        actions={codeDownloadAvailable && (!teamExamMode || teamExamMode.canEditCode) ? (
          <Button asChild variant="secondary" size="sm">
            <a href={downloadUrl}>
              <Download />
              {rdoc.files?.hack ? '下载 Hack 输入' : '下载代码'}
            </a>
          </Button>
        ) : null}
      />

      {detailMode === 'exam-code' ? (
        <div className="flex flex-col gap-6">
          <RecordIdentity problemUrl={problemUrl} problemTitle={pdoc.title || String(rdoc.pid)} username={recordIdentity.username} student={null} />
          <Panel flush>
            <RecordCodeContent data={data} rdoc={rdoc} code={code} copyState={copyState} onCopy={() => void handleCopyCode()} examCodeOnly />
          </Panel>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-6">
        <div className="flex min-w-0 flex-col gap-4">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg">评测详情</p>
                <p className="mt-0.5 text-xs text-fg-subtle">在摘要、测试点和源码之间直接切换</p>
              </div>
              <div className="min-w-0 overflow-x-auto scrollbar-none">
                <MiniTabs
                  value={currentTab}
                  onValueChange={setActiveTab}
                  size="md"
                  className="max-w-full"
                  aria-label="提交详情视图"
                  items={tabs.map((tab) => ({
                    value: tab,
                    label: tab === 'overview' ? '概览' : tab === 'cases' ? '测试点' : '代码',
                    count: tab === 'cases' ? cases.length : undefined,
                    icon: tab === 'overview' ? LayoutDashboard : tab === 'cases' ? ListChecks : Code2,
                  }))}
                />
              </div>
            </div>

            {currentTab === 'overview' ? (
              <div role="tabpanel" className="flex flex-col gap-4">
                <div className="grid gap-3 rounded-lg border border-line bg-surface-sunken p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-xs text-fg-subtle">语言</p>
                    <p className="mt-1 font-medium text-fg">{langDisplay(data.langs, rdoc.lang)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-fg-subtle">提交时间</p>
                    <p className="mt-1 font-medium text-fg">{formatRecordTime(rdoc._id, locale)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-fg-subtle">评测时间</p>
                    <p className="mt-1 font-medium text-fg">{rdoc.judgeAt ? formatRecordTime(rdoc.judgeAt, locale) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-fg-subtle">进度</p>
                    <p className="mt-1 font-medium tabular text-fg">{rdoc.progress != null ? `${Math.trunc(Number(rdoc.progress))}%` : '—'}</p>
                  </div>
                </div>

                <DiagnosticPanel title="编译输出" texts={compilerTexts} />
                <DiagnosticPanel title="评测输出" texts={judgeTexts} />

                {subtasks.length > 0 ? (
                  <Panel title="子任务">
                    <div className="grid w-full min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {subtasks.map((subtask) => (
                        <div key={subtask.id} className="w-full min-w-0 rounded-md border border-line bg-surface-sunken p-3">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-fg">#{subtask.id}</span>
                            <Verdict status={verdictStatus(subtask.status)} texts={detailVerdictTexts} compact />
                          </div>
                          <div className="mt-2 flex items-center gap-2 text-xs text-fg-subtle">
                            <span className="tabular">
                              得分{' '}
                              <span className={cn('font-semibold', scoreToneClass(subtask.score, detailFullScore))}>{subtask.score ?? '—'}</span>
                            </span>
                            {subtask.type ? (
                              <Badge variant="outline" size="sm">
                                {subtask.type}
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Panel>
                ) : null}

                {!compilerTexts.length && !judgeTexts.length && !subtasks.length ? (
                  <EmptyState compact title="当前记录没有额外评测摘要。" />
                ) : null}
              </div>
            ) : null}

            {currentTab !== 'overview' ? (
              <Panel flush>
              <div className={cn(canSplitWorkspace && 'xl:grid xl:grid-cols-2 xl:items-stretch')}>
                {showCasesPanel ? (
                  <div role="tabpanel" className={cn('min-w-0', currentTab !== 'cases' && 'hidden xl:block')}>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-4 py-3 text-xs text-fg-subtle">
                      <span>
                        共 <strong className="font-semibold tabular text-fg">{caseSummary.total}</strong> 个
                      </span>
                      <span>
                        通过 <strong className="font-semibold tabular text-success-fg">{caseSummary.accepted}</strong>
                      </span>
                      <span>
                        未通过 <strong className="font-semibold tabular text-danger-fg">{caseSummary.failed}</strong>
                      </span>
                      <span>
                        评测中 <strong className="font-semibold tabular text-info-fg">{caseSummary.active}</strong>
                      </span>
                      <span>
                        其他 <strong className="font-semibold tabular text-fg-subtle">{caseSummary.other}</strong>
                      </span>
                    </div>
                    <ScrollArea className="max-h-[min(65vh,680px)] w-full" orientation="both">
                      {/* ds-allow DS005: 测试点行内嵌输出详情，DataTable 不能表达这张原生表 */}
                      <table className={RECORD_NATIVE_TABLE_CLASS}>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-16">#</TableHead>
                            <TableHead>状态</TableHead>
                            <TableHead className="w-20 text-right">得分</TableHead>
                            <TableHead className="w-24 text-right">时间</TableHead>
                            <TableHead className="w-24 text-right">内存</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {casePageData.items.map((c, pageIndex) => {
                            const absoluteIndex = (casePageData.page - 1) * casePageData.pageSize + pageIndex;
                            const message = formatJudgeText(c.message);
                            const subtaskId = c.subtaskId ?? c.subtask;
                            const caseId = c.id ?? absoluteIndex + 1;
                            // Key by the case identity emitted by the judge. Flat
                            // problems are judged as subtask 1.
                            const hint = testHints[subtaskId != null ? `${subtaskId}-${caseId}` : `1-${caseId}`];
                            const hasDetails = !!(message || hint?.hint || hint?.videoUrl);
                            return (
                              <TableRow key={`${subtaskId ?? 'case'}-${caseId}-${absoluteIndex}`}>
                                <TableCell className="font-mono text-xs tabular text-fg-subtle">
                                  {subtaskId != null ? `${subtaskId}-${caseId}` : caseId}
                                </TableCell>
                                <TableCell>
                                  <Verdict status={verdictStatus(c.status)} texts={detailVerdictTexts} compact />
                                  {hasDetails ? (
                                    <details className="group mt-1">
                                      <summary className="flex min-h-10 cursor-pointer list-none items-center text-xs font-medium text-brand-fg hover:underline">
                                        查看输出与提示
                                      </summary>
                                      <div className="mb-2 flex flex-col gap-2 rounded-lg border border-line bg-surface-sunken p-3">
                                        {message ? (
                                          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-fg-muted">{message}</pre>
                                        ) : null}
                                        {hint?.hint ? (
                                          <p className="whitespace-pre-wrap break-words text-xs text-warning-fg">💡 {hint.hint}</p>
                                        ) : null}
                                        {hint?.videoUrl && /^https?:\/\//i.test(hint.videoUrl) ? (
                                          <a
                                            href={hint.videoUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex min-h-10 items-center text-xs text-brand-fg hover:underline"
                                          >
                                            ▶ 讲解视频
                                          </a>
                                        ) : null}
                                      </div>
                                    </details>
                                  ) : null}
                                </TableCell>
                                <TableCell className="text-right tabular">
                                  <span className={cn('font-semibold', scoreToneClass(c.score, detailFullScore))}>{c.score ?? '—'}</span>
                                </TableCell>
                                <TableCell className="text-right tabular text-sm text-fg-subtle">{formatTime(c.time, c.status)}</TableCell>
                                <TableCell className="text-right tabular text-sm text-fg-subtle">{formatMemory(c.memory)}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </table>
                    </ScrollArea>
                    <div className="flex flex-col gap-2 border-t border-line bg-surface-sunken px-4 py-3 text-xs text-fg-subtle sm:flex-row sm:items-center sm:justify-between">
                      <span className="tabular">
                        显示 {casePageData.start}–{casePageData.end} / {casePageData.total}
                      </span>
                      {casePageData.totalPages > 1 ? (
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={casePageData.page === 1}
                            onClick={() => setCasePage(casePageData.page - 1)}
                          >
                            <ChevronLeft />
                            上一页
                          </Button>
                          <span className="min-w-16 text-center tabular">
                            {casePageData.page} / {casePageData.totalPages}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={casePageData.page === casePageData.totalPages}
                            onClick={() => setCasePage(casePageData.page + 1)}
                          >
                            下一页
                            <ChevronRight />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {showCodePanel && code ? (
                  <div
                    role="tabpanel"
                    className={cn('min-w-0', currentTab !== 'code' && 'hidden xl:block', canSplitWorkspace && 'xl:border-l xl:border-line')}
                  >
                    <RecordCodeContent data={data} rdoc={rdoc} code={code} copyState={copyState} onCopy={() => void handleCopyCode()} />
                  </div>
                ) : null}
              </div>
              </Panel>
            ) : null}
        </div>
          </div>
          <aside className="flex flex-col gap-4">
            <RecordIdentity
              problemUrl={problemUrl}
              problemTitle={pdoc.title || String(rdoc.pid)}
              username={recordIdentity.username}
              student={recordIdentity.student}
            />
          </aside>
        </div>
      )}

      {detailMode !== 'exam-code' && recordScoreAction ? (
        <RecordScoreManageCard action={recordScoreAction} record={rdoc} onOpen={() => setScoreActionOpen(true)} />
      ) : detailMode !== 'exam-code' && canRejudgeVirtual ? (
        <VirtualRejudgeCard record={rdoc} />
      ) : null}

      <RecordScoreActionDialog
        open={scoreActionOpen && !!recordScoreAction}
        record={rdoc}
        action={recordScoreAction}
        endpoint={recordUrl}
        problemTitle={String(pdoc.title || rdoc.pid || '')}
        username={recordIdentity.username}
        onOpenChange={setScoreActionOpen}
        onSuccess={(payload) => {
          if (payload.rdoc) setRdoc((current) => ({ ...current, ...payload.rdoc }));
          setRecordScoreAction(payload.recordScoreAction || null);
        }}
      />

      {detailMode !== 'exam-code' && allRevs.length > 0 ? (
        <Panel title="历史版本" flush>
          <div className="divide-y divide-line-subtle">
            <a href={recordUrl} className="flex items-center justify-between px-4 py-3 text-sm text-fg hover:bg-surface-hover">
              <span>最新版本</span>
              {!data.rev ? <Badge variant="outline" size="sm">当前</Badge> : null}
            </a>
            {allRevs.map(([rev, time]) => (
              <a
                key={rev}
                href={buildUrlWithQuery(recordUrl, { rev })}
                className="flex items-center justify-between px-4 py-3 text-sm text-fg hover:bg-surface-hover"
              >
                <span>{formatRecordTime(time, locale)}</span>
                {String(data.rev || '') === rev ? <Badge variant="outline" size="sm">当前</Badge> : null}
              </a>
            ))}
          </div>
        </Panel>
      ) : null}
    </Page>
  );
}
