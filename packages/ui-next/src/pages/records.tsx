import { useState } from 'react';
import { motion } from 'motion/react';
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
  Search,
  ShieldAlert,
} from 'lucide-react';
import { useRecordSocket } from '@/hooks/use-record-socket';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { KryptonIDE } from '@/components/krypton-ide';
import { readTeamExamModeContext } from '@/components/team-exam-mode';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SimpleSelect } from '@/components/ui/select';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
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
  status?: number;
  subtasks?: unknown;
  testCases?: RecordCase[];
  time?: number;
  uid?: string | number;
}

interface RecordProblemSummary {
  title?: string;
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
  page?: unknown;
  pdict?: Record<string, RecordProblemSummary>;
  postContestPracticeActive?: boolean;
  rdocs?: RecordDocument[];
  recordDetailTid?: unknown;
  recordScoreActions?: Record<string, RecordScoreAction>;
  statistics?: RecordStatistics | null;
  statisticsScope?: string;
  statusTexts?: RecordStatusTexts;
  studentDict?: Record<string, { studentId: string; realName: string }>;
  tdoc?: { docId?: unknown };
  udict?: Record<string, GenericUserDoc>;
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
  recordStudent?: { studentId?: unknown; realName?: unknown } | null;
  rev?: string;
  tdoc?: { docId?: unknown };
  testHints?: Record<string, { hint?: string; videoUrl?: string }>;
  udoc?: GenericUserDoc;
}

interface RecordScoreResponse {
  rdoc?: RecordDocument;
  recordScoreAction?: RecordScoreAction | null;
}

function getUser(udict: Record<string, GenericUserDoc>, uid: string | number | undefined) {
  return uid != null ? (udict[String(uid)] ?? null) : null;
}

const STATUS_MAP: Record<number, { label: string; color: string }> = {
  0: { label: '等待评测', color: 'text-muted-foreground' },
  1: { label: 'Accepted', color: 'text-green-600 dark:text-green-400' },
  2: { label: 'Wrong Answer', color: 'text-red-600 dark:text-red-400' },
  3: { label: 'Time Exceeded', color: 'text-yellow-600 dark:text-yellow-400' },
  4: { label: 'Memory Exceeded', color: 'text-orange-600 dark:text-orange-400' },
  5: { label: 'Output Exceeded', color: 'text-orange-600 dark:text-orange-400' },
  6: { label: 'Runtime Error', color: 'text-purple-600 dark:text-purple-400' },
  7: { label: 'Compile Error', color: 'text-blue-600 dark:text-blue-400' },
  8: { label: 'System Error', color: 'text-gray-600 dark:text-gray-400' },
  9: { label: 'Canceled', color: 'text-gray-500' },
  10: { label: 'Unknown Error', color: 'text-red-600 dark:text-red-400' },
  11: { label: 'Hacked', color: 'text-red-600 dark:text-red-400' },
  12: { label: '人工已评分', color: 'text-green-600 dark:text-green-400' },
  20: { label: 'Running', color: 'text-blue-500' },
  21: { label: 'Compiling', color: 'text-blue-500' },
  22: { label: 'Fetched', color: 'text-blue-500' },
  30: { label: 'Ignored', color: 'text-gray-500' },
  31: { label: 'Format Error', color: 'text-gray-500' },
  32: { label: 'Hack Successful', color: 'text-green-600 dark:text-green-400' },
  33: { label: 'Hack Unsuccessful', color: 'text-red-600 dark:text-red-400' },
};

function statusDisplay(status: number | undefined) {
  const code = typeof status === 'number' ? status : 0;
  const s = STATUS_MAP[code] || { label: `Status ${status}`, color: 'text-muted-foreground' };
  return <span className={`text-sm font-medium ${s.color}`}>{s.label}</span>;
}

function statusLabel(status: number | string, statusTexts: RecordStatusTexts) {
  const value = statusTexts[String(status)] ?? statusTexts[Number(status)];
  if (typeof value === 'string') return value;
  const fallback = STATUS_MAP[Number(status)];
  return fallback?.label || `Status ${status}`;
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
    <section className="overflow-hidden rounded-lg border bg-muted/10">
      <div className="border-b px-4 py-3 text-sm font-medium">{title}</div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-foreground">
        {texts.join('\n')}
      </pre>
    </section>
  );
}

function LegacyDiagnosticCard({ title, texts }: { title: string; texts: string[] }) {
  if (!texts.length) return null;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">{title}</div>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-foreground">
          {texts.join('\n')}
        </pre>
      </CardContent>
    </Card>
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

function LegacyRecordDetailBody({
  rdoc,
  data,
  locale,
  compilerTexts,
  judgeTexts,
  subtasks,
  cases,
  testHints,
  code,
}: {
  rdoc: RecordDocument;
  data: RecordLanguageContext;
  locale: string;
  compilerTexts: string[];
  judgeTexts: string[];
  subtasks: SubtaskView[];
  cases: RecordCase[];
  testHints: Record<string, { hint?: string; videoUrl?: string }>;
  code: unknown;
}) {
  return (
    <>
      <Card>
        <CardContent className="grid gap-4 p-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">语言</p>
            <p className="mt-1 font-medium">{langDisplay(data.langs, rdoc.lang)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">提交时间</p>
            <p className="mt-1 font-medium">{formatRecordTime(rdoc._id, locale)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">评测时间</p>
            <p className="mt-1 font-medium">{rdoc.judgeAt ? formatRecordTime(rdoc.judgeAt, locale) : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">进度</p>
            <p className="mt-1 font-medium">{rdoc.progress != null ? `${Math.trunc(Number(rdoc.progress))}%` : '—'}</p>
          </div>
        </CardContent>
      </Card>

      <LegacyDiagnosticCard title="编译输出" texts={compilerTexts} />
      <LegacyDiagnosticCard title="评测输出" texts={judgeTexts} />

      {subtasks.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="border-b px-4 py-3 text-sm font-medium">子任务</div>
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {subtasks.map((subtask) => (
                <div key={subtask.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">#{subtask.id}</span>
                    {statusDisplay(subtask.status)}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>得分 {subtask.score ?? '—'}</span>
                    {subtask.type ? (
                      <Badge variant="outline" className="text-[10px]">
                        {subtask.type}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {cases.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="w-20 text-right">得分</TableHead>
                  <TableHead className="w-24 text-right">时间</TableHead>
                  <TableHead className="w-24 text-right">内存</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.map((c, i) => {
                  const message = formatJudgeText(c.message);
                  const subtaskId = c.subtaskId ?? c.subtask;
                  const caseId = c.id ?? i + 1;
                  return (
                    <TableRow key={`${subtaskId ?? 'case'}-${caseId}-${i}`}>
                      <TableCell className="text-muted-foreground">{subtaskId != null ? `${subtaskId}-${caseId}` : caseId}</TableCell>
                      <TableCell>
                        <div>{statusDisplay(c.status)}</div>
                        {message ? (
                          <p className="mt-1 max-w-xl whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">{message}</p>
                        ) : null}
                        {(() => {
                          const h = testHints[subtaskId != null ? `${subtaskId}-${caseId}` : `1-${caseId}`];
                          if (!h?.hint && !h?.videoUrl) return null;
                          return (
                            <div className="mt-1.5 max-w-xl rounded border border-amber-200 bg-amber-50/60 px-2 py-1 text-xs dark:border-amber-900/50 dark:bg-amber-950/20">
                              {h.hint ? <p className="whitespace-pre-wrap break-words text-amber-800 dark:text-amber-200">💡 {h.hint}</p> : null}
                              {h.videoUrl && /^https?:\/\//i.test(h.videoUrl) ? (
                                <a href={h.videoUrl} target="_blank" rel="noreferrer" className="mt-0.5 inline-block text-primary hover:underline">
                                  ▶ 讲解视频
                                </a>
                              ) : null}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.score ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{formatTime(c.time, c.status)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{formatMemory(c.memory)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {code ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <span className="text-sm font-medium">代码</span>
              <Badge variant="outline">{langDisplay(data.langs, rdoc.lang)}</Badge>
            </div>
            <div className="overflow-hidden" style={{ height: 'min(60vh, 640px)', minHeight: 320 }}>
              <KryptonIDE
                mode="readonly"
                langs={[]}
                defaultLang={rdoc.lang || 'cc.cc17'}
                value={String(code)}
                onValueChange={() => {
                  /* read-only */
                }}
                minHeight={320}
                className="h-full rounded-none border-0"
              />
            </div>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

function RecordIdentityCard({
  problemUrl,
  problemTitle,
  username,
  student,
  className = '',
}: {
  problemUrl: string;
  problemTitle: string;
  username: string;
  student: { studentId: string; realName: string } | null;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">题目 / 用户</p>
        <a
          href={problemUrl}
          title={problemTitle}
          className="mt-1 block break-words text-sm font-semibold leading-5 text-foreground hover:text-primary"
        >
          {problemTitle}
        </a>
        <div className="mt-3 flex flex-wrap gap-2 border-t pt-3 text-xs">
          <span className="inline-flex min-h-7 items-center gap-1.5 rounded-md bg-muted px-2.5 py-1">
            <span className="text-muted-foreground">用户</span>
            <span className="font-medium">{username}</span>
          </span>
          {student?.studentId ? (
            <span className="inline-flex min-h-7 items-center gap-1.5 rounded-md bg-muted px-2.5 py-1">
              <span className="text-muted-foreground">学号</span>
              <span className="font-mono tabular-nums">{student.studentId}</span>
            </span>
          ) : null}
          {student?.realName ? (
            <span className="inline-flex min-h-7 items-center gap-1.5 rounded-md bg-muted px-2.5 py-1">
              <span className="text-muted-foreground">姓名</span>
              <span className="font-medium">{student.realName}</span>
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
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
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {examCodeOnly ? <p className="text-sm font-semibold">提交代码</p> : null}
          {examCodeOnly ? (
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">考试期间仅展示本次提交源码，不提供评测状态、输出或测试点。</p>
          ) : null}
          {!examCodeOnly ? <Badge variant="outline">{langDisplay(data.langs, rdoc.lang)}</Badge> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {examCodeOnly ? <Badge variant="outline">{langDisplay(data.langs, rdoc.lang)}</Badge> : null}
          {copyState === 'failed' ? (
            <span role="alert" className="text-xs text-destructive">
              复制失败，请检查浏览器权限
            </span>
          ) : null}
          {code ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-10 active:scale-[0.96]"
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
        <div className="overflow-hidden" style={{ height: 'min(68vh, 720px)', minHeight: 360 }}>
          <KryptonIDE
            mode="readonly"
            langs={[]}
            defaultLang={rdoc.lang || 'cc.cc17'}
            value={String(code)}
            onValueChange={() => {
              /* read-only */
            }}
            minHeight={360}
            className="h-full rounded-none border-0"
          />
        </div>
      ) : (
        <div className="px-4 py-16 text-center text-sm leading-6 text-muted-foreground">
          该提交没有可直接预览的文本源码；若为文件提交，请使用页面上方的下载入口。
        </div>
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
      <DialogContent className="w-[min(34rem,calc(100vw-1.5rem))]" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>{cancel ? '确认取消单条记录成绩' : '重新评测并恢复成绩'}</DialogTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            记录 #{String(rdoc?._id || '').slice(-8)} · {problemTitle} · {username}
          </p>
        </DialogHeader>
        <DialogBody className="space-y-4 px-6 py-5">
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.07] p-4 text-sm">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-medium">{cancel ? '这会立即把该记录计分归零' : '这会使用当前题目配置和测试数据重新评测'}</p>
                <p className="mt-1 leading-6 text-muted-foreground">
                  {cancel
                    ? '系统将同步重算该用户的题目状态及关联比赛成绩。历史提交统计、气球、讨论和旧计数不会被改写。'
                    : '恢复结果以本次重新评测为准，不会把取消前的旧快照直接写回。'}
                </p>
              </div>
            </div>
          </div>
          {action?.contestId ? (
            <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm">
              <p className="font-medium">比赛影响</p>
              <p className="mt-1 break-all text-muted-foreground">
                比赛 {action.contestId}
                {action.contestTeamId ? ` · 队伍 ${action.contestTeamId}` : ''}；若比赛仍在进行，榜单会立即按新投影更新。
              </p>
            </div>
          ) : null}
          {cancel ? (
            <label className="block space-y-2">
              <span className="text-sm font-medium">备注（可选）</span>
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={240} placeholder="简要记录取消原因" />
              <span className="block text-right text-xs tabular-nums text-muted-foreground">{reason.length}/240</span>
            </label>
          ) : null}
          {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div> : null}
        </DialogBody>
        <div className="flex shrink-0 justify-end gap-2 border-t px-6 py-4">
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" variant={cancel ? 'destructive' : 'default'} disabled={busy} onClick={() => void submit()}>
            {busy ? '处理中…' : cancel ? '确认取消成绩' : '重新评测'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
  const [scoreActionRid, setScoreActionRid] = useState('');
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
  const practiceTid = postContestPracticeActive ? normalizeId(data.recordDetailTid || data.tdoc?.docId) : '';
  const filterParams = {
    uidOrName: data.filterUidOrName || '',
    pid: data.filterPid || '',
    tid: data.filterTid || '',
    practice: postContestPracticeActive ? '1' : '',
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
  const statusOptions: Array<[string, string]> = Object.keys(statusTexts).length
    ? Object.keys(statusTexts).map((key) => [key, statusLabel(key, statusTexts)])
    : Object.entries(STATUS_MAP).map(([key, value]) => [key, value.label]);
  const selectedScoreRecord = rdocs.find((rdoc) => String(rdoc._id) === scoreActionRid) || null;
  const selectedScoreAction = scoreActionRid ? recordScoreActions[scoreActionRid] || null : null;

  // Live updates: subscribe to /record-conn with the same filters as the
  // current page so newly arriving rdocs (or status flips) update the
  // table without a full reload. New ids land at the top; existing ones
  // get patched in place.
  useRecordSocket({
    filters: {
      tid: filterParams.tid || undefined,
      practice: postContestPracticeActive || undefined,
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
    <motion.div className="space-y-4" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      {postContestPracticeActive ? (
        <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.06] px-4 py-3 text-sm text-muted-foreground">
          这里只显示你在该题上的普通个人提交，不计入原比赛成绩、罚时或排行榜。
        </div>
      ) : null}
      <div>
        <h1 className="text-xl font-semibold">评测记录</h1>
        <p className="text-sm text-muted-foreground">所有提交记录</p>
      </div>

      <Card>
        <CardContent className="p-4">
          <form method="get" action={bs.urls.records} className="grid gap-3 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] lg:items-end">
            {postContestPracticeActive ? <input type="hidden" name="practice" value="1" /> : null}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">用户 / UID</label>
              <Input name="uidOrName" defaultValue={data.filterUidOrName || ''} placeholder="用户名或 UID" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">题目</label>
              <Input name="pid" defaultValue={data.filterPid || ''} placeholder="题号" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">比赛</label>
              <Input name="tid" defaultValue={data.filterTid || ''} placeholder="比赛 ID" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">语言</label>
              <SimpleSelect
                name="lang"
                defaultValue={data.filterLang || ''}
                className="h-9"
                options={[
                  { value: '', label: '全部语言' },
                  ...languageOptions.map(([key, value]) => ({
                    value: key,
                    label: String(value?.display || value?.name || key),
                  })),
                ]}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">状态</label>
              <SimpleSelect
                name="status"
                defaultValue={filterStatus}
                className="h-9"
                options={[
                  { value: '', label: '全部提交' },
                  ...statusOptions.map(([key, label]) => ({
                    value: key,
                    label,
                  })),
                ]}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm">
                <Filter className="size-4" />
                筛选
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={bs.urls.records}>
                  <RotateCcw className="size-4" />
                  重置
                </a>
              </Button>
            </div>
            <div className="lg:col-span-6 flex flex-wrap gap-4 text-xs text-muted-foreground">
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
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">状态</TableHead>
                <TableHead>题目</TableHead>
                <TableHead className="w-28">用户</TableHead>
                {hasStudentColumn ? <TableHead className="w-32">学号 / 姓名</TableHead> : null}
                <TableHead className="w-20 text-center">语言</TableHead>
                <TableHead className="w-24 text-right">得分</TableHead>
                <TableHead className="w-24 text-right">时间</TableHead>
                <TableHead className="w-24 text-right">内存</TableHead>
                <TableHead className="w-28 text-right">提交时间</TableHead>
                {Object.keys(recordScoreActions).length ? <TableHead className="w-28 text-right">管理</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rdocs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8 + (hasStudentColumn ? 1 : 0) + (Object.keys(recordScoreActions).length ? 1 : 0)}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    暂无提交记录
                  </TableCell>
                </TableRow>
              ) : (
                rdocs.map((r) => {
                  const user = getUser(udict, r.uid);
                  const pdoc = pdict[String(r.pid)] || {};
                  const recordUrl = buildUrlWithQuery(replaceRouteTokens(bs.urls.recordDetail, { RID: String(r._id) }), {
                    tid: practiceTid,
                    practice: postContestPracticeActive,
                  });
                  const problemUrl = buildUrlWithQuery(replaceRouteTokens(bs.urls.problemDetail, { PID: String(r.pid) }), {
                    tid: practiceTid,
                  });
                  return (
                    <TableRow key={String(r._id)}>
                      <TableCell>
                        <a href={recordUrl} className="hover:underline">
                          {statusDisplay(r.status)}
                        </a>
                      </TableCell>
                      <TableCell>
                        <a href={problemUrl} className="font-medium hover:text-primary hover:underline">
                          {pdoc.title ? `${r.pid}. ${pdoc.title}` : r.pid}
                        </a>
                      </TableCell>
                      <TableCell className="text-sm">{user?.uname || `#${r.uid}`}</TableCell>
                      {hasStudentColumn ? (
                        <TableCell className="text-xs">
                          {studentDict[String(r.uid)] ? (
                            <>
                              <div className="font-mono">{studentDict[String(r.uid)].studentId}</div>
                              <div className="text-muted-foreground">{studentDict[String(r.uid)].realName}</div>
                            </>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </TableCell>
                      ) : null}
                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-[10px]">
                          {langDisplay(langs, r.lang)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.score != null ? (
                          <span className={r.score === 100 ? 'font-medium text-green-600 dark:text-green-400' : ''}>{r.score}</span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{r.time != null ? `${r.time}ms` : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{formatMemory(r.memory)}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{formatRecordTime(r._id || r.judgeAt, locale)}</TableCell>
                      {Object.keys(recordScoreActions).length ? (
                        <TableCell className="text-right">
                          {recordScoreActions[String(r._id)] ? (
                            <Button type="button" size="sm" variant="ghost" onClick={() => setScoreActionRid(String(r._id))}>
                              {recordScoreActions[String(r._id)].kind === 'cancel' ? '取消成绩' : '重新评测'}
                            </Button>
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
          <Button asChild variant="outline" size="sm">
            <a href={prevUrl}>上一页</a>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            上一页
          </Button>
        )}
        <span className="text-xs text-muted-foreground">第 {page} 页</span>
        {rdocs.length ? (
          <Button asChild variant="outline" size="sm">
            <a href={nextUrl}>下一页</a>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            下一页
          </Button>
        )}
      </div>

      {statistics ? (
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Search className="size-4 text-primary" />
              评测统计
              {data.statisticsScope === 'contest' ? (
                <Badge variant="secondary" className="text-[10px]">
                  本场比赛
                </Badge>
              ) : data.statisticsScope === 'all' ? (
                <Badge variant="secondary" className="text-[10px]">
                  全站
                </Badge>
              ) : null}
            </div>
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
                <div key={key} className="rounded-md border bg-muted/20 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">{label}</div>
                  <div className="font-mono text-sm font-medium">{statistics[key] ?? 0}</div>
                </div>
              ))}
            </div>
            {data.statisticsScope === 'contest' ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <div className="rounded-md border bg-muted/20 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">本场 AC</div>
                  <div className="font-mono text-sm font-medium">{statistics.accepted ?? 0}</div>
                </div>
                <div className="rounded-md border bg-muted/20 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">提交人数</div>
                  <div className="font-mono text-sm font-medium">{statistics.participants ?? 0}</div>
                </div>
                <div className="rounded-md border bg-muted/20 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">人均提交</div>
                  <div className="font-mono text-sm font-medium">
                    {statistics.participants ? (statistics.total / statistics.participants).toFixed(1) : '—'}
                  </div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </motion.div>
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
  const [scoreActionOpen, setScoreActionOpen] = useState(false);
  const pdoc = data.pdoc || {};
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
  const allRevs = Object.entries(data.allRevs || {});
  const examUrls = data.examMode?.urls || {};
  const teamExamMode = readTeamExamModeContext(data.examMode);
  const postContestPracticeRecordAccess = data.postContestPracticeRecordAccess === true;
  const detailMode = recordDetailMode({
    hasExamMode: !!data.examMode || data.examRecordCodeOnly === true,
    hasContestContext: !!data.tdoc,
    postContestPractice: postContestPracticeRecordAccess,
  });
  const practiceTid = postContestPracticeRecordAccess ? normalizeId(data.practiceTid || data.tdoc?.docId) : '';
  const recordUrlBase = examUrls.record
    ? String(examUrls.record).replace('__RID__', String(rdoc._id))
    : replaceRouteTokens(bs.urls.recordDetail, { RID: String(rdoc._id) });
  const recordUrl = buildUrlWithQuery(recordUrlBase, {
    tid: practiceTid,
    practice: postContestPracticeRecordAccess,
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
  const problemUrl = buildUrlWithQuery(problemUrlBase, { tid: practiceTid });
  const recordListUrl = postContestPracticeRecordAccess
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

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      {postContestPracticeRecordAccess ? (
        <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.06] px-4 py-3 text-sm text-muted-foreground">
          这是个人赛后补题记录，不计入原比赛成绩、罚时或排行榜。
        </div>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <a href={recordListUrl} className="hover:text-primary">
              记录
            </a>
            <ChevronRight className="size-3" />
          </div>
          <h1 className="mt-1 text-xl font-semibold text-balance">
            {detailMode === 'exam-code' ? '提交代码' : '提交记录'} #{String(rdoc._id).slice(-8)}
          </h1>
        </div>
        {codeDownloadAvailable && (!teamExamMode || teamExamMode.canEditCode) ? (
          <Button asChild variant="outline" size="sm" className="w-fit">
            <a href={downloadUrl}>
              <Download className="size-4" />
              {rdoc.files?.hack ? '下载 Hack 输入' : '下载代码'}
            </a>
          </Button>
        ) : null}
      </div>

      {detailMode === 'exam-code' ? (
        <RecordIdentityCard problemUrl={problemUrl} problemTitle={pdoc.title || String(rdoc.pid)} username={recordIdentity.username} student={null} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(18rem,1.55fr)]">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">状态</p>
              <div className="mt-1">{statusDisplay(rdoc.status)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">得分</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{rdoc.score ?? '—'}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">用时 / 内存</p>
              <p className="mt-1 text-sm font-medium tabular-nums">
                {formatTime(rdoc.time, rdoc.status)} / {formatMemory(rdoc.memory)}
              </p>
            </CardContent>
          </Card>
          <RecordIdentityCard
            problemUrl={problemUrl}
            problemTitle={pdoc.title || String(rdoc.pid)}
            username={recordIdentity.username}
            student={recordIdentity.student}
          />
        </div>
      )}

      {detailMode === 'exam-code' ? (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <RecordCodeContent data={data} rdoc={rdoc} code={code} copyState={copyState} onCopy={() => void handleCopyCode()} examCodeOnly />
          </CardContent>
        </Card>
      ) : detailMode === 'legacy-contest' ? (
        <LegacyRecordDetailBody
          rdoc={rdoc}
          data={data}
          locale={locale}
          compilerTexts={compilerTexts}
          judgeTexts={judgeTexts}
          subtasks={subtasks}
          cases={cases}
          testHints={testHints}
          code={code}
        />
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="flex flex-col gap-3 border-b bg-muted/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">评测详情</p>
                <p className="mt-0.5 text-xs text-muted-foreground">在摘要、测试点和源码之间直接切换</p>
              </div>
              <div role="tablist" aria-label="提交详情视图" className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1">
                {tabs.map((tab) => {
                  const selected = currentTab === tab;
                  const Icon = tab === 'overview' ? LayoutDashboard : tab === 'cases' ? ListChecks : Code2;
                  const label = tab === 'overview' ? '概览' : tab === 'cases' ? `测试点 ${cases.length}` : '代码';
                  return (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setActiveTab(tab)}
                      className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors active:scale-[0.96] ${
                        selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                      }`}
                    >
                      <Icon className="size-4" />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {currentTab === 'overview' ? (
              <div role="tabpanel" className="space-y-4 p-4">
                <div className="grid gap-3 rounded-lg border bg-muted/10 p-4 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">语言</p>
                    <p className="mt-1 font-medium">{langDisplay(data.langs, rdoc.lang)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">提交时间</p>
                    <p className="mt-1 font-medium">{formatRecordTime(rdoc._id, locale)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">评测时间</p>
                    <p className="mt-1 font-medium">{rdoc.judgeAt ? formatRecordTime(rdoc.judgeAt, locale) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">进度</p>
                    <p className="mt-1 font-medium tabular-nums">{rdoc.progress != null ? `${Math.trunc(Number(rdoc.progress))}%` : '—'}</p>
                  </div>
                </div>

                <DiagnosticPanel title="编译输出" texts={compilerTexts} />
                <DiagnosticPanel title="评测输出" texts={judgeTexts} />

                {subtasks.length > 0 ? (
                  <section className="overflow-hidden rounded-lg border">
                    <div className="border-b px-4 py-3 text-sm font-medium">子任务</div>
                    <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
                      {subtasks.map((subtask) => (
                        <div key={subtask.id} className="rounded-lg border bg-muted/10 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium">#{subtask.id}</span>
                            {statusDisplay(subtask.status)}
                          </div>
                          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="tabular-nums">得分 {subtask.score ?? '—'}</span>
                            {subtask.type ? (
                              <Badge variant="outline" className="text-[10px]">
                                {subtask.type}
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {!compilerTexts.length && !judgeTexts.length && !subtasks.length ? (
                  <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                    当前记录没有额外评测摘要。
                  </div>
                ) : null}
              </div>
            ) : null}

            {currentTab === 'cases' ? (
              <div role="tabpanel">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-4 py-3 text-xs text-muted-foreground">
                  <span>
                    共 <strong className="font-semibold tabular-nums text-foreground">{caseSummary.total}</strong> 个
                  </span>
                  <span>
                    通过 <strong className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{caseSummary.accepted}</strong>
                  </span>
                  <span>
                    未通过 <strong className="font-semibold tabular-nums text-destructive">{caseSummary.failed}</strong>
                  </span>
                  <span>
                    评测中 <strong className="font-semibold tabular-nums text-blue-600 dark:text-blue-400">{caseSummary.active}</strong>
                  </span>
                  <span>
                    其他 <strong className="font-semibold tabular-nums text-muted-foreground">{caseSummary.other}</strong>
                  </span>
                </div>
                <div className="max-h-[min(65vh,680px)] overflow-y-auto">
                  <Table density="compact">
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
                            <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                              {subtaskId != null ? `${subtaskId}-${caseId}` : caseId}
                            </TableCell>
                            <TableCell>
                              <div>{statusDisplay(c.status)}</div>
                              {hasDetails ? (
                                <details className="group mt-1 max-w-2xl">
                                  <summary className="flex min-h-10 cursor-pointer list-none items-center text-xs font-medium text-primary hover:underline">
                                    查看输出与提示
                                  </summary>
                                  <div className="mb-2 space-y-2 rounded-lg border bg-muted/20 p-3">
                                    {message ? (
                                      <pre className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">{message}</pre>
                                    ) : null}
                                    {hint?.hint ? (
                                      <p className="whitespace-pre-wrap break-words text-xs text-amber-700 dark:text-amber-300">💡 {hint.hint}</p>
                                    ) : null}
                                    {hint?.videoUrl && /^https?:\/\//i.test(hint.videoUrl) ? (
                                      <a
                                        href={hint.videoUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex min-h-10 items-center text-xs text-primary hover:underline"
                                      >
                                        ▶ 讲解视频
                                      </a>
                                    ) : null}
                                  </div>
                                </details>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{c.score ?? '—'}</TableCell>
                            <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{formatTime(c.time, c.status)}</TableCell>
                            <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{formatMemory(c.memory)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex flex-col gap-2 border-t bg-muted/10 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <span className="tabular-nums">
                    显示 {casePageData.start}–{casePageData.end} / {casePageData.total}
                  </span>
                  {casePageData.totalPages > 1 ? (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-10 active:scale-[0.96]"
                        disabled={casePageData.page === 1}
                        onClick={() => setCasePage(casePageData.page - 1)}
                      >
                        <ChevronLeft />
                        上一页
                      </Button>
                      <span className="min-w-16 text-center tabular-nums">
                        {casePageData.page} / {casePageData.totalPages}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-10 active:scale-[0.96]"
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

            {currentTab === 'code' && code ? (
              <div role="tabpanel">
                <RecordCodeContent data={data} rdoc={rdoc} code={code} copyState={copyState} onCopy={() => void handleCopyCode()} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {detailMode !== 'exam-code' && recordScoreAction ? (
        <Card className={recordScoreAction.kind === 'cancel' ? 'border-destructive/25' : ''}>
          <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">{recordScoreAction.kind === 'cancel' ? '成绩管理' : '恢复已取消记录'}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {recordScoreAction.kind === 'cancel'
                  ? '仅取消这一条记录的计分，并同步重算它影响到的题目状态与比赛榜单。'
                  : '使用当前题目配置和测试数据重新评测；结果通过正常评测链重新进入计分。'}
              </p>
            </div>
            <Button
              type="button"
              variant={recordScoreAction.kind === 'cancel' ? 'destructive' : 'default'}
              className="shrink-0"
              onClick={() => setScoreActionOpen(true)}
            >
              {recordScoreAction.kind === 'cancel' ? '取消本条成绩' : '重新评测并恢复'}
            </Button>
          </CardContent>
        </Card>
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
        <Card>
          <CardContent className="p-0">
            <div className="border-b px-4 py-3 text-sm font-medium">历史版本</div>
            <div className="divide-y">
              <a href={recordUrl} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-accent">
                <span>最新版本</span>
                {!data.rev ? <Badge variant="outline">当前</Badge> : null}
              </a>
              {allRevs.map(([rev, time]) => (
                <a
                  key={rev}
                  href={buildUrlWithQuery(recordUrl, { rev })}
                  className="flex items-center justify-between px-4 py-3 text-sm hover:bg-accent"
                >
                  <span>{formatRecordTime(time, locale)}</span>
                  {String(data.rev || '') === rev ? <Badge variant="outline">当前</Badge> : null}
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </motion.div>
  );
}
