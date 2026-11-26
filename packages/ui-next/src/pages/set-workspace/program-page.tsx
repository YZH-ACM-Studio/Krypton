import { paperAward } from '@hydrooj/common';
import { rememberEndCode, acknowledgeEndCode, endCodeRequestId } from './end-save';
import { Difficulty, Verdict } from '@/components/ui/verdict';
import { isAcmWorkspace } from '@/pages/set-workspace/model';
import { parseDraftList, saveRejection, validateSaveItems } from './answers';
import type { DraftMap, WsDraft } from './model';
import type { ObjectiveAnswerActions } from './objective-page';
import { homeworkKindRevealsVerdict, type ClientStructuredCodeSegment, type ProblemKind } from '@hydrooj/common';
import { ChevronLeft, ChevronRight, History, PanelLeftClose, PanelLeftOpen, Send, X } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { KryptonIDE, getLangEntry, getStatus } from '@/components/krypton-ide';
import type { IdePretestHandle } from '@/components/ide-pretest-panel';
import { MarkdownView } from '@/components/markdown-renderer';
import {
  ProgrammingStatementView,
  structuredStatementSamples,
  type ProgrammingStatementExample,
  type ProgrammingStatementViewData,
  type StatementState,
} from '@/components/programming-statement';
import { WorkspaceStructuredBench } from './structured-workbench';
import { ResizableSplit } from '@/components/resizable-split';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/display';
import { useBootstrap } from '@/lib/bootstrap';
import { createRequestId } from '@/lib/request-id';
import { extractSamples, type SampleCase } from '@/lib/samples';
import { createEmptyStructuredRegionDraft, parseStructuredRegionDraft } from '@/lib/structured-region-draft';
import { formatMoment } from '@/pages/problem-sets/model';
import { getJson, postForm, postJson } from '@/pages/teach/api';
import {
  sectionHref,
  type CellState,
  type SetWorkspace,
  type WorkspaceProblem,
  type WsFlavor,
  type WsGroup,
  type WsItem,
} from '@/pages/set-workspace/model';

const LOAD_FAILURE = '题面加载失败，请刷新页面。';
const DRAFT_FAILURE = '保存草稿失败。';
const SUBMIT_FAILURE = '提交失败。';
const RECORD_FAILURE = '加载评测结果失败。';
const RECORD_LIST_FAILURE = '加载提交记录失败。';
const DEFERRED_RESULT = '已提交，结束后公布成绩';
const PRACTICE_NOTE = '比赛已结束：这里是赛后补题，提交不计入比赛成绩。';
const PAPER_NOTE = '这道题随整卷评测，交卷后才显示对错。';
const DRAFT_NOT_SAVED = '代码没有保存，不能提交。';
const POLL_MS = 2000;
const POLL_LIMIT_MS = 60_000;
const VERIFY_POLL_LIMIT_MS = 120_000;
const VERIFY_SUBMIT_FAILURE = '提交验题失败。';
const GRADE_FALLBACK = '判分失败。';
const GRADE_SHAPE = '判分返回的数据格式不对。';
const VERIFY_STILL_JUDGING = '还在评测，稍后在详情里查看。';
const VERIFY_ROW_LIMIT = 5;
const COLUMN_COLLAPSED = '1';

interface LangOption {
  value: string;
  label: string;
}

interface ProblemFace {
  content: string;
  config: Record<string, unknown>;
  statement: ProgrammingStatementViewData | null;
}

interface JudgeResult {
  status: number;
  score: number | null;
  time: number | null;
}

interface WorkspaceJudgeResult {
  status: number | null;
  score: number | null;
  time: number | null;
  judging: boolean;
}

interface PendingCodeDraft {
  url: string;
  code: string;
  lang: string;
  generation: number;
  tid: string;
  pid: number;
}

interface LimitPair {
  time: string | null;
  memory: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failureText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

const codeDraftSignals = new Map<string, AbortSignal>();
let codeFetchPatched = false;

function requestUrl(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return null;
}

function ensureCodeFetchPatch(): void {
  if (codeFetchPatched) return;
  codeFetchPatched = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const signal = url && !init?.keepalive ? codeDraftSignals.get(url) : undefined;
    if (url && signal) codeDraftSignals.delete(url);
    if (!signal) return original(input, init);
    return original(input, { ...init, signal });
  };
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function postCodeDraft(pending: PendingCodeDraft, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (signal.aborted) return Promise.reject(abortError());
  ensureCodeFetchPatch();
  codeDraftSignals.set(pending.url, signal);
  let onAbort: (() => void) | undefined;
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    postForm(
      pending.url,
      new URLSearchParams({ code: pending.code, lang: pending.lang }),
      DRAFT_FAILURE,
    ).then(resolve, reject);
  }).catch((error: unknown) => {
    if (signal.aborted || isAbortError(error)) throw abortError();
    throw error;
  }).finally(() => {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    if (codeDraftSignals.get(pending.url) === signal) codeDraftSignals.delete(pending.url);
  });
}

function codeKey(tid: string, pid: number): string {
  return `ws-code:${tid}:${pid}`;
}

function langStorageKey(tid: string, pid: number): string {
  return `ws-lang:${tid}:${pid}`;
}

function columnStorageKey(tid: string): string {
  return `ws-col:${tid}`;
}

function writeStorage(key: string, value: string | null): void {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
  window.dispatchEvent(new CustomEvent('ws-storage', { detail: { key, value } }));
}

function readConfig(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return value;
}

function limitText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function firstLimit(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const text = limitText(source[key]);
    if (text) return text;
  }
  return null;
}

function resolvedLimits(config: Record<string, unknown>, statement: unknown): LimitPair {
  const view = isRecord(statement) && isRecord(statement.limits) ? statement.limits : null;
  return {
    time: firstLimit(config, ['time', 'timeMax', 'timeMin']) ?? (view ? limitText(view.time) : null),
    memory: firstLimit(config, ['memory', 'memoryMax', 'memoryMin']) ?? (view ? limitText(view.memory) : null),
  };
}

function readState(value: unknown, allowed: readonly StatementState[]): StatementState | null {
  if (typeof value !== 'string') return null;
  for (const state of allowed) {
    if (value === state) return state;
  }
  return null;
}

function readStateBlock(
  value: unknown,
  allowed: readonly StatementState[],
): { state: StatementState; content: string } | null {
  if (!isRecord(value) || typeof value.content !== 'string') return null;
  const state = readState(value.state, allowed);
  if (!state) return null;
  return { state, content: value.content };
}

/** Client views send `{ content }` for background and hints, with no `state`. */
function readContentBlock(value: unknown): { content: string } | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.content !== 'string') return undefined;
  return { content: value.content };
}

function readExamples(value: unknown): { items: ProgrammingStatementExample[] } | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !Array.isArray(value.items)) return undefined;
  const items: ProgrammingStatementExample[] = [];
  for (const item of value.items) {
    if (!isRecord(item) || typeof item.input !== 'string' || typeof item.output !== 'string') return undefined;
    items.push({
      input: item.input,
      output: item.output,
      inputEmpty: item.inputEmpty === true,
      outputEmpty: item.outputEmpty === true,
      note: typeof item.note === 'string' ? item.note : '',
    });
  }
  return { items };
}

function readStatement(value: unknown): ProgrammingStatementViewData | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || value.schemaVersion !== 1 || value.locale !== 'zh-CN') return null;
  const description = readStateBlock(value.description, ['undecided', 'present']);
  const input = readStateBlock(value.input, ['undecided', 'present', 'absent']);
  const output = readStateBlock(value.output, ['undecided', 'present', 'absent']);
  if (!description || !input || !output) return null;
  if (description.state !== 'undecided' && description.state !== 'present') return null;
  const limits = isRecord(value.limits) && typeof value.limits.complete === 'boolean'
    ? { complete: value.limits.complete, time: value.limits.time, memory: value.limits.memory }
    : { complete: false, time: undefined, memory: undefined };
  const examples = readExamples(value.examples);
  const background = readContentBlock(value.background);
  const hints = readContentBlock(value.hints);
  return {
    schemaVersion: 1,
    locale: 'zh-CN',
    ...(background ? { background } : {}),
    description: { state: description.state, content: description.content },
    input,
    output,
    ...(examples ? { examples } : {}),
    ...(hints ? { hints } : {}),
    limits,
  };
}

function parseSegment(value: unknown, index: number): ClientStructuredCodeSegment {
  if (!isRecord(value)) throw new TypeError(`作答区第 ${index + 1} 段不是对象`);
  if (value.type === 'code') {
    if (typeof value.code !== 'string') throw new TypeError(`作答区第 ${index + 1} 段缺少代码`);
    return { type: 'code', code: value.code };
  }
  if (value.type === 'region') {
    if (typeof value.id !== 'string' || !value.id) throw new TypeError(`作答区第 ${index + 1} 段缺少编号`);
    return {
      type: 'region',
      id: value.id,
      ...(typeof value.title === 'string' ? { title: value.title } : {}),
      ...(typeof value.description === 'string' ? { description: value.description } : {}),
      ...(typeof value.prompt === 'string' ? { prompt: value.prompt } : {}),
    };
  }
  throw new TypeError(`作答区第 ${index + 1} 段类型无效`);
}

function readSurface(config: Record<string, unknown>): ClientStructuredCodeSegment[] | null {
  if (!isRecord(config.template) || !Array.isArray(config.template.surface)) return null;
  return config.template.surface.map((segment, index) => parseSegment(segment, index));
}

function faceFromProblem(problem: WorkspaceProblem): ProblemFace {
  return {
    content: problem.content,
    config: readConfig(problem.raw.config),
    statement: readStatement(problem.raw.programmingStatementView),
  };
}

function parseRecord(body: unknown): JudgeResult {
  if (!isRecord(body)) throw new TypeError('评测结果不是对象');
  const source = isRecord(body.rdoc) ? body.rdoc : body;
  if (typeof source.status !== 'number' || !Number.isInteger(source.status)) throw new TypeError('评测结果缺少状态');
  return {
    status: source.status,
    score: typeof source.score === 'number' && Number.isFinite(source.score) ? source.score : null,
    time: typeof source.time === 'number' && Number.isFinite(source.time) ? source.time : null,
  };
}

function parseWorkspaceRecord(body: unknown, verdictVisible: boolean): WorkspaceJudgeResult {
  if (verdictVisible) {
    const parsed = parseRecord(body);
    return { ...parsed, judging: isJudging(parsed.status) };
  }
  if (!isRecord(body)) throw new TypeError('评测结果不是对象');
  const source = isRecord(body.rdoc) ? body.rdoc : body;
  if (typeof source.judging !== 'boolean') throw new TypeError('评测结果缺少完成状态');
  if (source.score != null && (typeof source.score !== 'number' || !Number.isFinite(source.score))) throw new TypeError('评测分数无效');
  return { status: null, score: typeof source.score === 'number' ? source.score : null, time: null, judging: source.judging };
}

interface HistoryRow {
  id: string;
  pid: number;
  status: number;
  lang: string | null;
  score: number | null;
  time: number | null;
  memory: number | null;
  at: string;
}

function historyId(value: unknown, path: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (isRecord(value) && typeof value.$oid === 'string' && value.$oid.length > 0) return value.$oid;
  throw new TypeError(`${path} must be an id`);
}

function historyInstant(id: string): string {
  if (!/^[0-9a-f]{24}$/i.test(id)) throw new TypeError(`record id ${id} is not an object id`);
  const seconds = Number.parseInt(id.slice(0, 8), 16);
  if (!Number.isFinite(seconds)) throw new TypeError(`record id ${id} has no timestamp`);
  return new Date(seconds * 1000).toISOString();
}

function optionalText(value: unknown, path: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new TypeError(`${path} 必须是字符串`);
  return value;
}

function optionalNumber(value: unknown, path: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${path} 必须是数字`);
  return value;
}

function formatMemory(kb: number | null): string {
  if (kb === null || kb <= 0) return '—';
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)} MB`;
  return `${kb} KB`;
}

function parseHistory(body: unknown): HistoryRow[] {
  if (!isRecord(body) || !Array.isArray(body.rdocs)) throw new TypeError('提交记录缺少 rdocs');
  return body.rdocs.map((item, index) => {
    if (!isRecord(item)) throw new TypeError(`提交记录 ${index} 不是对象`);
    const id = historyId(item._id, `rdocs[${index}]._id`);
    if (typeof item.pid !== 'number' || !Number.isSafeInteger(item.pid)) throw new TypeError(`rdocs[${index}].pid 必须是整数`);
    let status = 0;
    if (item.status !== undefined && item.status !== null) {
      if (typeof item.status !== 'number' || !Number.isInteger(item.status)) throw new TypeError(`rdocs[${index}].status 必须是整数`);
      status = item.status;
    }
    return {
      id,
      pid: item.pid,
      status,
      lang: optionalText(item.lang, `rdocs[${index}].lang`),
      score: optionalNumber(item.score, `rdocs[${index}].score`),
      time: optionalNumber(item.time, `rdocs[${index}].time`),
      memory: optionalNumber(item.memory, `rdocs[${index}].memory`),
      at: historyInstant(id),
    };
  });
}

function historyUrl(template: string, pid: number): string {
  const url = new URL(template, window.location.origin);
  url.searchParams.set('pid', String(pid));
  return `${url.pathname}${url.search}`;
}

function StatementHistorySplit({ statement, history }: { statement: ReactNode; history: ReactNode | null }) {
  const [statementPct, setStatementPct] = useState(70);
  const dragging = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!dragging.current || !panelRef.current) return;
      event.preventDefault();
      const rect = panelRef.current.getBoundingClientRect();
      const pct = ((event.clientY - rect.top) / rect.height) * 100;
      setStatementPct(Math.max(20, Math.min(85, pct)));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);
  if (!history) return <div className="flex h-full min-h-0 flex-col">{statement}</div>;
  return (
    <div ref={panelRef} className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 shrink-0 overflow-hidden" style={{ height: `${statementPct}%` }}>{statement}</div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="调整题面和提交记录的高度"
        className="h-1.5 shrink-0 cursor-row-resize bg-line transition-colors hover:bg-line-strong"
        onMouseDown={() => {
          dragging.current = true;
          document.body.style.cursor = 'row-resize';
          document.body.style.userSelect = 'none';
        }}
      />
      <div className="min-h-0 overflow-hidden" style={{ height: `${100 - statementPct}%` }}>{history}</div>
    </div>
  );
}

function SubmissionHistory({
  url,
  pid,
  detailTemplate,
  linkDetails,
  allHref,
  refreshKey,
  onCountChange,
  onClose,
}: {
  url: string;
  pid: number;
  detailTemplate: string;
  linkDetails: boolean;
  allHref: string;
  refreshKey: string | null;
  onCountChange: (count: number) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setError('');
    getJson(historyUrl(url, pid), RECORD_LIST_FAILURE).then((body) => {
      if (cancelled) return;
      try {
        const nextRows = parseHistory(body).filter((row) => row.pid === pid);
        setRows(nextRows);
        onCountChange(nextRows.length);
      } catch (cause) {
        setRows(null);
        setError(failureText(cause, RECORD_LIST_FAILURE));
      }
    }, (cause: unknown) => {
      if (cancelled) return;
      setRows(null);
      setError(failureText(cause, RECORD_LIST_FAILURE));
    });
    return () => {
      cancelled = true;
    };
  }, [url, pid, refreshKey, onCountChange]);
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-sunken px-3 py-1.5">
        <History className="size-3.5 text-fg-subtle" />
        <span className="text-xs font-medium text-fg">提交记录</span>
        {rows ? <span className="text-2xs text-fg-subtle tabular">({rows.length})</span> : null}
        <div className="flex-1" />
        <a className="text-xs text-brand-fg hover:underline" href={allHref}>全部</a>
        <Button variant="ghost" size="sm" iconOnly aria-label="收起提交记录" onClick={onClose}><X /></Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? <p className="px-3 py-2 text-xs text-danger-fg">{error}</p> : null}
        {!error && rows && rows.length === 0 ? <p className="px-3 py-6 text-center text-xs text-fg-subtle">还没有提交</p> : null}
        {rows && rows.length > 0 ? (
          // ds-allow DS005: IDE 底部面板里的紧凑提交表，DataTable 的行高和手机卡片模式放不进这个面板
          <table className="w-full min-w-144 text-xs">
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
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line-subtle last:border-0 hover:bg-surface-hover">
                  <td className="whitespace-nowrap px-3 py-1.5"><Verdict status={row.status} compact /></td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-fg">{row.lang ? getLangEntry(row.lang).label : '—'}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular">{row.score ?? '—'}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular">{row.time === null ? '—' : `${Math.round(row.time)} ms`}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular">{formatMemory(row.memory)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-fg-subtle">{formatMoment(row.at, Date.now())}</td>
                  <td className="px-3 py-1.5">
                    {linkDetails ? (
                      <a className="text-brand-fg hover:underline" href={fillToken(detailTemplate, '__RID__', row.id)}>详情</a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}

function fillToken(template: string, token: string, value: string): string {
  if (!template.includes(token)) throw new TypeError(`地址缺少 ${token}`);
  return template.replace(token, value);
}

function locateItem(ws: SetWorkspace, pid: number): { group: WsGroup; index: number } {
  for (const group of ws.groups) {
    const index = group.items.findIndex((entry) => entry.pid === pid);
    if (index >= 0) return { group, index };
  }
  throw new TypeError(`题目 ${pid} 不在工作台题目列表里`);
}

function configuredLangs(config: Record<string, unknown>): string[] | null {
  if (!Array.isArray(config.langs) || config.langs.length === 0) return null;
  const ids: string[] = [];
  for (const entry of config.langs) {
    if (typeof entry !== 'string' || !entry) return null;
    ids.push(entry);
  }
  return ids;
}

function languageOptions(config: Record<string, unknown>, langRange: Record<string, string>): LangOption[] {
  const ids = configuredLangs(config) ?? Object.keys(langRange);
  return ids.map((id) => ({ value: id, label: langRange[id] ?? id }));
}

function pickLang(tid: string, pid: number, options: readonly LangOption[]): string {
  if (options.length === 0) return '';
  const saved = localStorage.getItem(langStorageKey(tid, pid));
  if (saved && options.some((option) => option.value === saved)) return saved;
  return options[0]!.value;
}

function structuredLanguage(kind: ProblemKind, config: Record<string, unknown>, options: readonly LangOption[]): string {
  if (kind === 'program_fill' && config.mode === 'text') return '_';
  const template = config.template;
  if (isRecord(template) && typeof template.lang === 'string' && template.lang) return template.lang;
  return options[0]?.value ?? '';
}

function isStructuredKind(kind: ProblemKind): boolean {
  return kind === 'program_fill' || kind === 'function';
}

function allowsPretest(config: Record<string, unknown>): boolean {
  const type = config.type;
  return type == null || type === 'default' || type === 'programming' || type === 'function' || (type === 'program_fill' && config.mode !== 'text');
}

function problemSamples(face: ProblemFace | null): SampleCase[] {
  if (!face) return [];
  const fromStatement = structuredStatementSamples(face.statement);
  if (fromStatement.length > 0) return fromStatement;
  return extractSamples(face.content);
}

/** In-progress labels from getStatus. Finished labels such as 编译错误 do not match. */
function isJudging(status: number): boolean {
  const label = getStatus(status).label;
  return label.includes('评测中') || label.includes('编译中') || label.includes('等待');
}

function verifySubmitUrl(ws: SetWorkspace): string | null {
  if (ws.mode !== 'preview') return null;
  const url = ws.urls.verifySubmit;
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function verifyObjectiveUrl(ws: SetWorkspace): string | null {
  if (ws.mode !== 'preview') return null;
  const url = ws.urls.verifyObjective;
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function textAnswerCode(ids: readonly string[], answers: Readonly<Record<string, string | string[]>> | null | undefined): string {
  return JSON.stringify(Object.fromEntries(ids.map((id) => [id, answers?.[id] ?? ''])));
}

function isTextProgramFill(kind: ProblemKind, config: Record<string, unknown>): boolean {
  return kind === 'program_fill' && config.mode === 'text';
}

interface RegionGrade {
  outcome: 'correct' | 'partial' | 'wrong';
  score: number;
}

function regionOutcomeBadge(outcome: RegionGrade['outcome']): ReactNode {
  if (outcome === 'correct') return <Badge tone="success" variant="soft" size="sm">正确</Badge>;
  if (outcome === 'wrong') return <Badge tone="danger" variant="soft" size="sm">错误</Badge>;
  return <Badge tone="info" variant="soft" size="sm">部分正确</Badge>;
}

function RegionGradeList({
  surface,
  grades,
}: {
  surface: ClientStructuredCodeSegment[];
  grades: Record<string, RegionGrade>;
}) {
  const rows = surface.flatMap((segment) => {
    if (segment.type !== 'region') return [];
    const grade = grades[segment.id];
    if (!grade) return [];
    return [{ id: segment.id, grade }];
  });
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-2">
      {rows.map((row) => (
        <div key={row.id} className="flex flex-wrap items-center gap-2">
          {regionOutcomeBadge(row.grade.outcome)}
          <Badge variant="outline" size="sm">
            <span className="tabular">{`得分 ${row.grade.score}`}</span>
          </Badge>
        </div>
      ))}
    </div>
  );
}

function isVerifyOutcome(value: unknown): value is RegionGrade['outcome'] {
  return value === 'correct' || value === 'partial' || value === 'wrong';
}

function parseRegionGrades(body: Record<string, unknown>): ReadonlyMap<string, RegionGrade> {
  if (!isRecord(body.results)) throw new TypeError(GRADE_SHAPE);
  if (!Array.isArray(body.skipped) || body.skipped.some((item) => typeof item !== 'string')) {
    throw new TypeError(GRADE_SHAPE);
  }
  const results = new Map<string, RegionGrade>();
  for (const [key, value] of Object.entries(body.results)) {
    if (!isRecord(value)) throw new TypeError(GRADE_SHAPE);
    const { outcome, score } = value;
    if (!isVerifyOutcome(outcome) || typeof score !== 'number' || !Number.isFinite(score)) {
      throw new TypeError(GRADE_SHAPE);
    }
    results.set(key, { outcome, score });
  }
  return results;
}

interface VerifyAttempt {
  rid: string;
  status: number;
  score: number | null;
  timedOut: boolean;
  stopped: boolean;
  error: string;
}

interface VerifyPollPatch {
  status: number;
  score: number | null;
  timedOut: boolean;
  stopped: boolean;
  error: string;
}

function VerifyAttemptPoll({
  rid,
  stopped,
  onResult,
}: {
  rid: string;
  stopped: boolean;
  onResult: (rid: string, patch: VerifyPollPatch) => void;
}) {
  useEffect(() => {
    if (stopped) return undefined;
    let cancelled = false;
    const pending: { timer: number | null } = { timer: null };
    const started = Date.now();
    const waitPoll = () => new Promise<void>((resolve) => {
      pending.timer = window.setTimeout(resolve, POLL_MS);
    });
    const run = async () => {
      while (!cancelled) {
        let parsed: JudgeResult;
        try {
          parsed = parseRecord(await getJson(`/record/${rid}`, RECORD_FAILURE));
        } catch (cause) {
          if (cancelled) return;
          console.error('Verify record poll failed', { rid, cause });
          onResult(rid, {
            status: 0,
            score: null,
            timedOut: false,
            stopped: true,
            error: failureText(cause, RECORD_FAILURE),
          });
          return;
        }
        if (cancelled) return;
        const finished = !isJudging(parsed.status);
        const timedOut = !finished && Date.now() - started >= VERIFY_POLL_LIMIT_MS;
        onResult(rid, {
          status: parsed.status,
          score: parsed.score,
          timedOut,
          stopped: finished || timedOut,
          error: '',
        });
        if (finished || timedOut) return;
        await waitPoll();
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (pending.timer !== null) window.clearTimeout(pending.timer);
    };
  }, [onResult, rid, stopped]);
  return null;
}

function VerifyAttemptList({ rows }: { rows: readonly VerifyAttempt[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="shrink-0 border-b border-line bg-surface">
      {rows.map((row) => (
        <div key={row.rid} className="flex min-w-0 items-center gap-2 border-b border-line-subtle px-3 py-1.5 text-xs last:border-0">
          <span className="shrink-0 font-medium text-fg">验题</span>
          <span className="shrink-0"><Verdict status={row.status} compact /></span>
          <span className="shrink-0 font-mono tabular text-fg">{row.score === null ? '—' : String(row.score)}</span>
          {row.timedOut ? <span className="min-w-0 text-fg-muted">{VERIFY_STILL_JUDGING}</span> : null}
          {row.error ? <span className="min-w-0 text-danger-fg">{row.error}</span> : null}
          <a className="ml-auto shrink-0 text-brand-fg hover:underline" href={`/record/${row.rid}`}>查看详情</a>
        </div>
      ))}
    </div>
  );
}

function contestRule(flavor: WsFlavor): string {
  if (flavor === 'acm') return 'ACM 赛制：通过才得分，每次错误提交罚时 20 分钟';
  if (flavor === 'ioi') return 'IOI 赛制：按测试点给分，取最高一次';
  if (flavor === 'oi') return 'OI 赛制：结束后公布成绩';
  throw new TypeError(`unknown contest flavor ${flavor}`);
}

function footerCopy(ws: SetWorkspace, group: WsGroup): { left: string; right: string } {
  if (ws.codePolicy !== undefined) {
    const policies = {
      highest: '编程题取本轮最高分', last: '编程题取本轮最后一次提交',
      subtask_best: '编程题按子任务最高分计分', retry_decay: '编程题按重试衰减计分',
      acm: '按通过题数和罚时排名',
    };
    const answered = group.items.filter((entry) => entry.state !== 'empty').length;
    return { left: policies[ws.codePolicy], right: `已作答 ${answered} / ${group.items.length}` };
  }
  if (ws.kind === 'contest') {
    if (isAcmWorkspace(ws)) {
      const accepted = group.items.filter((entry) => entry.state === 'correct').length;
      return { left: contestRule(ws.flavor), right: `已通过 ${accepted} / ${group.items.length}` };
    }
    const score = ws.totals.score === null ? '—' : String(ws.totals.score);
    const max = ws.totals.maxScore === null ? '—' : String(ws.totals.maxScore);
    return { left: contestRule(ws.flavor), right: `当前 ${score} / ${max}` };
  }
  const answered = group.items.filter((entry) => entry.state !== 'empty').length;
  return {
    left: `${group.name}每题单独提交，提交后马上评测`,
    right: `已作答 ${answered} / ${group.items.length}`,
  };
}

function resultWord(state: CellState): string {
  if (state === 'empty') return '—';
  if (state === 'draft') return '未提交';
  if (state === 'submitted') return '已提交';
  if (state === 'correct') return '已通过';
  if (state === 'wrong') return '未通过';
  return '部分正确';
}

function showVerdict(ws: SetWorkspace, item: WsItem): boolean {
  if (item.feedback) return item.feedback.verdict;
  const kind = item.kind;
  if ((ws.kind === 'homework' || ws.kind === 'paper') && homeworkKindRevealsVerdict(kind)) return true;
  if (ws.kind === 'homework' && !ws.objectiveVerdictVisible) return false;
  if (ws.kind === 'homework' || isAcmWorkspace(ws) || ws.flavor === 'ioi') return true;
  return ws.verdictVisible;
}

/** Judge records retain the original problem scale. */
function formatScaledScore(itemScore: number, recordScore: number, rawMax = 100): string {
  const value = paperAward({ points: itemScore, rawMax }, recordScore);
  if (!Number.isFinite(value)) throw new TypeError('得分无法换算');
  return String(Math.round(value * 100) / 100);
}

function classifySubmit(body: Record<string, unknown>): { kind: 'rid'; rid: string } | { kind: 'deferred' } {
  if (typeof body.rid === 'string' && body.rid.trim()) return { kind: 'rid', rid: body.rid };
  if (typeof body.url === 'string' || typeof body.tid === 'string') return { kind: 'deferred' };
  throw new TypeError('提交响应缺少记录编号');
}

function StepControl({ label, href }: { label: string; href: string | null }) {
  const icon = label === '上一题' ? <ChevronLeft /> : <ChevronRight />;
  if (!href) {
    return (
      <Button type="button" variant="secondary" size="sm" iconOnly disabled aria-label={label}>
        {icon}
      </Button>
    );
  }
  return (
    <Button asChild variant="secondary" size="sm" iconOnly>
      <a href={href} aria-label={label}>{icon}</a>
    </Button>
  );
}

function LimitsLine({ time, memory }: LimitPair) {
  const parts = [time, memory].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  return <p className="font-mono text-sm tabular text-fg">{parts.join(' · ')}</p>;
}

function StatementBody({
  face,
  preferred,
  limits,
  onOpenSample,
}: {
  face: ProblemFace;
  preferred: string;
  limits: LimitPair;
  onOpenSample?: (sampleId: number) => void;
}) {
  const line = <LimitsLine time={limits.time} memory={limits.memory} />;
  if (face.statement) {
    return <ProgrammingStatementView statement={face.statement} preferredLang={preferred} limits={line} onOpenSample={onOpenSample} />;
  }
  return (
    <>
      <MarkdownView content={face.content} preferredLang={preferred} />
      {line ? (
        <section className="min-w-0 space-y-3">
          <h2 className="text-lg font-semibold">时空限制</h2>
          {line}
        </section>
      ) : null}
    </>
  );
}

export function ProgramProblemPage({
  ws,
  item,
  problems,
  langRange,
  registerFlush,
  drafts,
  onDraftsChange,
  registerObjectiveAnswers,
}: {
  ws: SetWorkspace;
  item: WsItem;
  problems: Map<number, WorkspaceProblem>;
  langRange: Record<string, string>;
  registerFlush?: (flush: () => Promise<boolean>) => () => void;
  drafts?: DraftMap;
  onDraftsChange?: (drafts: DraftMap) => void;
  registerObjectiveAnswers?: (actions: ObjectiveAnswerActions) => () => void;
}) {
  const bs = useBootstrap();
  const preferredMarkdown = bs.locale.startsWith('zh') ? 'zh' : 'en';
  const problem = problems.get(item.pid) ?? null;
  const face = problem ? faceFromProblem(problem) : null;
  const config = face?.config ?? {};
  const options = languageOptions(config, langRange);
  const optionKey = options.map((option) => option.value).join('\0');
  const located = locateItem(ws, item.pid);
  const draftKey = codeKey(ws.tid, item.pid);
  const structured = isStructuredKind(item.kind);
  const kindLocked = ws.paper?.lockedKinds.includes(item.kind) ?? false;
  const textFill = isTextProgramFill(item.kind, config);
  const memoryGrade = textFill && ws.mode === 'preview';
  const formalText = textFill && ws.officialRound !== undefined && ws.mode !== 'preview';
  const objectiveUrl = memoryGrade ? verifyObjectiveUrl(ws) : null;
  const verifyUrl = memoryGrade ? null : verifySubmitUrl(ws);
  const canEdit = !item.excluded && (memoryGrade || verifyUrl !== null || (ws.action.canSubmit && ws.locked === null && !kindLocked && ws.mode !== 'preview'));
  const limits = resolvedLimits(config, problem?.raw.programmingStatementView);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const countedRid = useRef<string | null>(null);
  const ephemeralCode = formalText || memoryGrade || verifyUrl !== null;
  const [columnCollapsed, setColumnCollapsed] = useState(() => localStorage.getItem(columnStorageKey(ws.tid)) === COLUMN_COLLAPSED);
  const [code, setCode] = useState(() => formalText ? JSON.stringify(drafts?.get(item.pid)?.answers ?? {}) : memoryGrade ? '' : (localStorage.getItem(draftKey) ?? ''));
  const codeRef = useRef(code);
  codeRef.current = code;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const savedTextRef = useRef<WsDraft | null>(null);
  const [lang, setLang] = useState(() => pickLang(ws.tid, item.pid, options));
  const [seenSubmits, setSeenSubmits] = useState(item.submits);
  const [rid, setRid] = useState<string | null>(null);
  const [recordsVisible, setRecordsVisible] = useState(true);
  const [recordsCount, setRecordsCount] = useState(item.submits);
  const pretestApiRef = useRef<IdePretestHandle | null>(null);
  const [result, setResult] = useState<WorkspaceJudgeResult | null>(null);
  const [deferred, setDeferred] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [verifyAttempts, setVerifyAttempts] = useState<VerifyAttempt[]>([]);
  const [regionGrades, setRegionGrades] = useState<Record<string, RegionGrade>>({});
  const regionStamp = useRef<Record<string, number>>({});
  const pidRef = useRef(item.pid);
  pidRef.current = item.pid;
  const mounted = useRef(true);
  const submittingRef = useRef(false);
  const draftTimer = useRef<number | null>(null);
  const draftGeneration = useRef(0);
  const pendingRef = useRef<PendingCodeDraft | null>(null);
  const unackedRef = useRef<PendingCodeDraft | null>(null);
  const inflightRef = useRef<Promise<boolean> | null>(null);
  const inflightDraftRef = useRef<PendingCodeDraft | null>(null);
  const draftAbortRef = useRef<AbortController | null>(null);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);

  const surface = structured ? readSurface(config) : null;
  const regionIds = surface?.flatMap((segment) => (segment.type === 'region' ? [segment.id] : [])) ?? [];
  const regionValues = structured && regionIds.length > 0
    ? (parseStructuredRegionDraft(code, regionIds, item.kind === 'program_fill') ?? createEmptyStructuredRegionDraft(regionIds))
    : {};
  const answerCode = structured
    ? JSON.stringify(Object.fromEntries(regionIds.map((id) => [id, regionValues[id] || ''])))
    : code;
  const submitLang = structured ? structuredLanguage(item.kind, config, options) : lang;

  if (item.kind === 'programming' && lang) {
    try {
      if (localStorage.getItem('krypton:ide-lang') !== lang) localStorage.setItem('krypton:ide-lang', lang);
    } catch (cause) {
      console.error('Failed to store editor language', cause);
    }
  }

  useLayoutEffect(() => {
    countedRid.current = null;
    savedTextRef.current = null;
    setLang(pickLang(ws.tid, item.pid, optionsRef.current));
    const nextCode = formalText ? JSON.stringify(drafts?.get(item.pid)?.answers ?? {}) : memoryGrade ? '' : (localStorage.getItem(codeKey(ws.tid, item.pid)) ?? '');
    codeRef.current = nextCode;
    setCode(nextCode);
    setSeenSubmits(item.submits);
    setRecordsVisible(true);
    setRecordsCount(item.submits);
    setRid(null);
    setResult(null);
    setDeferred(false);
    setError('');
    setVerifyAttempts([]);
    setRegionGrades({});
    regionStamp.current = {};
  }, [ws.tid, item.pid, item.submits, optionKey, memoryGrade]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (draftTimer.current === null) return;
      window.clearTimeout(draftTimer.current);
      draftTimer.current = null;
    };
  }, []);

  useEffect(() => {
    if (!registerFlush) return undefined;
    return registerFlush(() => flushRef.current());
  }, [registerFlush]);

  useEffect(() => {
    if (!rid || (!showVerdict(ws, item) && item.feedback?.score !== true)) return undefined;
    const recordUrl = fillToken(ws.urls.recordDetail, '__RID__', rid);
    let cancelled = false;
    const started = Date.now();
    const run = async () => {
      while (!cancelled) {
        try {
          const parsed = parseWorkspaceRecord(await getJson(recordUrl, RECORD_FAILURE), showVerdict(ws, item));
          if (cancelled) return;
          setResult(parsed);
          if (!parsed.judging) return;
        } catch (cause) {
          if (cancelled) return;
          console.error('Record poll failed', { tid: ws.tid, pid: item.pid, rid, cause });
          setError(failureText(cause, RECORD_FAILURE));
          return;
        }
        if (Date.now() - started >= POLL_LIMIT_MS) {
          if (!cancelled) setError('评测结果等待超时。');
          return;
        }
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, POLL_MS);
        });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [rid, item.kind, item.pid, item.feedback?.verdict, item.feedback?.score, ws.kind, ws.flavor, ws.verdictVisible, ws.objectiveVerdictVisible, ws.urls.recordDetail, ws.tid]);

  function writeCode(next: string) {
    try {
      localStorage.setItem(draftKey, next);
    } catch (cause) {
      console.error('Failed to store code draft', { tid: ws.tid, pid: item.pid, cause });
      setError('代码草稿无法保存在本机。');
    }
  }

  function stillUnacked(pending: PendingCodeDraft): boolean {
    return unackedRef.current?.generation === pending.generation;
  }

  function acknowledge(pending: PendingCodeDraft) {
    if (!stillUnacked(pending)) return;
    unackedRef.current = null;
    if (pendingRef.current?.generation === pending.generation) pendingRef.current = null;
  }

  function keepForRetry(pending: PendingCodeDraft) {
    if (!stillUnacked(pending)) return;
    pendingRef.current = unackedRef.current;
  }

  function trackInflight(pending: PendingCodeDraft, controller: AbortController, task: Promise<boolean>): Promise<boolean> {
    const tracked = task.finally(() => {
      if (inflightRef.current === tracked) {
        inflightRef.current = null;
        if (inflightDraftRef.current === pending) inflightDraftRef.current = null;
      }
      if (draftAbortRef.current === controller) draftAbortRef.current = null;
      const newer = unackedRef.current;
      if (!newer || newer.generation === pending.generation || inflightRef.current) return;
      clearDraftTimer();
      pendingRef.current = null;
      void emitDraft(newer, true);
    });
    inflightRef.current = tracked;
    inflightDraftRef.current = pending;
    draftAbortRef.current = controller;
    return tracked;
  }

  function emitDraft(pending: PendingCodeDraft, updateState: boolean): Promise<boolean> {
    const controller = new AbortController();
    const task = postCodeDraft(pending, controller.signal).then(
      () => {
        acknowledge(pending);
        if (updateState && mounted.current && draftGeneration.current === pending.generation) setError('');
        return true;
      },
      (cause: unknown) => {
        keepForRetry(pending);
        if (isAbortError(cause)) return false;
        console.error('Paper code draft save failed', { tid: pending.tid, pid: pending.pid, cause });
        if (updateState && mounted.current && draftGeneration.current === pending.generation) {
          setError(failureText(cause, DRAFT_FAILURE));
        }
        return false;
      },
    );
    return trackInflight(pending, controller, task);
  }

  function rememberSubmitDraft(source: string, nextLang: string) {
    if (!ws.urls.draftUpsert) throw new TypeError('试卷提交地址缺失。');
    const url = fillToken(ws.urls.draftUpsert, '__PID__', String(item.pid));
    const current = unackedRef.current;
    if (current && current.url === url && current.code === source && current.lang === nextLang) return;
    const generation = draftGeneration.current + 1;
    draftGeneration.current = generation;
    const pending: PendingCodeDraft = {
      url, code: source, lang: nextLang, generation, tid: ws.tid, pid: item.pid,
    };
    unackedRef.current = pending;
    pendingRef.current = pending;
  }

  async function ensureDraftSaved(): Promise<boolean> {
    while (unackedRef.current) {
      clearDraftTimer();
      const latest = unackedRef.current;
      if (inflightRef.current) {
        const sent = inflightDraftRef.current;
        const ok = await inflightRef.current;
        if (!ok && sent && unackedRef.current?.generation === sent.generation) return false;
        continue;
      }
      pendingRef.current = null;
      const ok = await emitDraft(latest, true);
      if (!ok && unackedRef.current?.generation === latest.generation) return false;
    }
    return true;
  }

  function clearDraftTimer() {
    if (draftTimer.current === null) return;
    window.clearTimeout(draftTimer.current);
    draftTimer.current = null;
  }

  function schedulePaperDraft(_nextCode: string, _nextLangValue: string) {
  }

  async function flushCodeDraft(): Promise<boolean> {
    clearDraftTimer();
    unackedRef.current = null;
    return true;
  }
  flushRef.current = flushCodeDraft;

  function updateCode(next: string) {
    if (!canEdit || (!formalText && submittingRef.current) || next === codeRef.current) return;
    codeRef.current = next;
    setCode(next);
    if (ephemeralCode) return;
    writeCode(next);
    if (!formalText) {
      try {
        rememberEndCode(ws, item.pid, next, submitLang);
      } catch (cause) {
        console.error('End save draft failed', { tid: ws.tid, pid: item.pid, cause });
        setError('结束前代码草稿未保存到本机，请手动提交。');
      }
    }
    schedulePaperDraft(next, submitLang);
  }

  function updateRegion(id: string, value: string) {
    if (!regionIds.includes(id)) throw new Error(`structured region ${id} is not part of the current problem`);
    const currentValues = parseStructuredRegionDraft(codeRef.current, regionIds, item.kind === 'program_fill') ?? createEmptyStructuredRegionDraft(regionIds);
    if ((currentValues[id] || '') === value) return;
    if (memoryGrade) {
      regionStamp.current[id] = (regionStamp.current[id] ?? 0) + 1;
      setRegionGrades((current) => {
        if (!Object.hasOwn(current, id)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
    const next = JSON.stringify(Object.fromEntries(regionIds.map((current) => [current, current === id ? value : currentValues[current] || ''])));
    updateCode(next);
  }

  function chooseLang(next: string) {
    if (!options.some((option) => option.value === next)) return;
    setLang(next);
    try {
      localStorage.setItem(langStorageKey(ws.tid, item.pid), next);
      if (!formalText) rememberEndCode(ws, item.pid, answerCode, next);
    } catch (cause) {
      console.error('Failed to store language', { tid: ws.tid, pid: item.pid, cause });
      setError('语言选择无法保存在本机。');
    }
    if (!memoryGrade) schedulePaperDraft(answerCode, next);
  }

  function toggleColumn() {
    const key = columnStorageKey(ws.tid);
    const nextCollapsed = localStorage.getItem(key) !== COLUMN_COLLAPSED;
    writeStorage(key, nextCollapsed ? COLUMN_COLLAPSED : null);
    setColumnCollapsed(nextCollapsed);
  }

  const textRequest = useRef<{ operationId: string; roundId: string; kind: 'program_fill'; items: Array<{ pid: number; body: Record<string, string>; baseVersion: number }> } | null>(null);
  const acceptedText = savedTextRef.current ?? drafts?.get(item.pid);
  const savedTextCode = JSON.stringify(Object.fromEntries(regionIds.map((id) => [id, acceptedText?.answers?.[id] ?? ''])));
  const textUnsaved = formalText && (textRequest.current !== null || answerCode !== savedTextCode);
  const textUnsavedRef = useRef(textUnsaved);
  textUnsavedRef.current = textUnsaved;

  async function saveTextAnswers(): Promise<boolean> {
    if (!formalText || !canEdit || !ws.officialRound || !ws.urls.saveAnswers || !onDraftsChange) throw new Error('当前不能保存答案。');
    if (submittingRef.current) throw new Error('正在保存答案，请稍后再操作。');
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      if (!textRequest.current) {
        const current = parseStructuredRegionDraft(codeRef.current, regionIds, true) ?? createEmptyStructuredRegionDraft(regionIds);
        const body = Object.fromEntries(regionIds.map((id) => [id, current[id] || '']));
        const official = savedTextRef.current ?? draftsRef.current?.get(item.pid);
        if (JSON.stringify(body) === textAnswerCode(regionIds, official?.answers)) return true;
        validateSaveItems([{ body }]);
        textRequest.current = { operationId: createRequestId(), roundId: ws.officialRound.id, kind: 'program_fill', items: [{ pid: item.pid, body, baseVersion: official?.version ?? 0 }] };
      }
      const request = textRequest.current;
      const response = await postJson(ws.urls.saveAnswers, request, '保存答案失败。');
      const rejected = saveRejection(response);
      if (rejected !== null) {
        textRequest.current = null;
        throw new Error(rejected);
      }
      if (!isRecord(response.versions)) throw new Error('保存响应缺少答案版本。');
      const version = response.versions[String(item.pid)];
      if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) throw new Error('保存响应的答案版本无效。');
      const saved = Object.hasOwn(response, 'drafts') ? parseDraftList(response).get(item.pid) : undefined;
      if (Object.hasOwn(response, 'drafts') && (!saved || saved.version !== version || !saved.answers)) throw new Error('保存响应缺少当前题目的正式答案。');
      const body = request.items[0]?.body;
      if (!body) throw new Error('保存请求缺少答案。');
      const official = saved ?? { answers: body, submittedAnswers: body, version };
      savedTextRef.current = official;
      textRequest.current = null;
      const next = new Map(draftsRef.current);
      next.set(item.pid, official);
      draftsRef.current = next;
      onDraftsChange(next);
      const savedCode = textAnswerCode(regionIds, official.answers);
      const currentCode = textAnswerCode(regionIds, parseStructuredRegionDraft(codeRef.current, regionIds, true));
      if (currentCode === JSON.stringify(body)) {
        codeRef.current = savedCode;
        setCode(savedCode);
      }
      textUnsavedRef.current = textAnswerCode(regionIds, parseStructuredRegionDraft(codeRef.current, regionIds, true)) !== savedCode;
      return !textUnsavedRef.current;
    } catch (cause) {
      setError(failureText(cause, '保存答案失败。'));
      throw cause;
    } finally { submittingRef.current = false; setSubmitting(false); }
  }

  useEffect(() => {
    if (!formalText) return undefined;
    return registerObjectiveAnswers?.({
      hasUnsaved: () => submittingRef.current || textUnsavedRef.current,
      save: saveTextAnswers,
      discard: () => {
        if (submittingRef.current || textRequest.current) throw new Error('请先确认上次保存结果。');
        textUnsavedRef.current = false;
        codeRef.current = savedTextCode;
        setCode(savedTextCode);
      },
    });
  });

  async function handleSubmit(source = answerCode, nextLang = submitLang) {
    if (!canEdit || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    setDeferred(false);
    setResult(null);
    try {
      const filled = structured
        ? Object.values(regionValues).some((value) => value.trim().length > 0)
        : source.trim().length > 0;
      if (!filled) {
        setError('作答内容不能为空。');
        return;
      }
      clearDraftTimer();
      if (memoryGrade) {
        if (!objectiveUrl) throw new TypeError('判分地址缺失。');
        const answers = Object.fromEntries(regionIds.map((id) => [id, regionValues[id] || '']));
        const stamps = { ...regionStamp.current };
        const requestPid = item.pid;
        const posted = await postForm(
          objectiveUrl,
          new URLSearchParams({ pid: String(item.pid), answers: JSON.stringify(answers) }),
          GRADE_FALLBACK,
        );
        if (!mounted.current || pidRef.current !== requestPid) return;
        const parsed = parseRegionGrades(posted);
        if (!mounted.current || pidRef.current !== requestPid) return;
        setRegionGrades((current) => {
          const next = { ...current };
          for (const id of regionIds) {
            if ((regionStamp.current[id] ?? 0) !== (stamps[id] ?? 0)) continue;
            const grade = parsed.get(id);
            if (grade) next[id] = grade;
            else delete next[id];
          }
          return next;
        });
        return;
      }
      if (verifyUrl) {
        const posted = await postForm(
          verifyUrl,
          new URLSearchParams({ pid: String(item.pid), lang: nextLang, code: source }),
          VERIFY_SUBMIT_FAILURE,
        );
        if (!mounted.current) return;
        const nextRid = posted.rid;
        if (typeof nextRid !== 'string' || nextRid.trim() === '') throw new TypeError('验题响应缺少记录编号');
        setVerifyAttempts((current) => [
          { rid: nextRid, status: 0, score: null, timedOut: false, stopped: false, error: '' },
          ...current.filter((row) => row.rid !== nextRid),
        ].slice(0, VERIFY_ROW_LIMIT));
        return;
      }
      let posted: Record<string, unknown>;
      if (ws.officialRound !== undefined) {
        if (!ws.officialRound || !ws.urls.submitCode) throw new Error('当前没有可提交的作答轮次，请刷新页面。');
        const autoSaveId = endCodeRequestId(ws, item.pid, source, nextLang);
        posted = await postJson(fillToken(ws.urls.submitCode, '__PID__', String(item.pid)), { code: source, lang: nextLang, roundId: ws.officialRound.id, ...(autoSaveId ? { autoSaveId } : {}) }, SUBMIT_FAILURE);
      } else if (ws.kind === 'paper') {
        if (!ws.urls.draftUpsert || !ws.urls.submitCode) throw new TypeError('试卷提交地址缺失。');
        rememberSubmitDraft(source, nextLang);
        const saved = await ensureDraftSaved();
        if (!mounted.current) return;
        if (!saved) {
          setError((current) => current || DRAFT_NOT_SAVED);
          return;
        }
        posted = await postForm(
          fillToken(ws.urls.submitCode, '__PID__', String(item.pid)),
          new URLSearchParams(),
          SUBMIT_FAILURE,
        );
      } else {
        posted = await submitProgram(source, nextLang);
      }
      acknowledgeEndCode(ws, item.pid, source, nextLang);
      if (!mounted.current) return;
      const outcome = classifySubmit(posted);
      if (outcome.kind === 'deferred') {
        setRid(null);
        setDeferred(true);
        return;
      }
      if (countedRid.current !== outcome.rid) {
        countedRid.current = outcome.rid;
        setSeenSubmits((count) => count + 1);
      }
      setRid(outcome.rid);
      setRecordsVisible(true);
      if (!showVerdict(ws, item) && item.feedback?.score !== true) setDeferred(true);
      else setResult({ status: null, score: null, time: null, judging: true });
    } catch (cause) {
      console.error('Program problem submit failed', { tid: ws.tid, pid: item.pid, cause });
      if (mounted.current) {
        const fallback = memoryGrade ? GRADE_FALLBACK : verifyUrl ? VERIFY_SUBMIT_FAILURE : SUBMIT_FAILURE;
        setError(failureText(cause, fallback));
      }
    } finally {
      submittingRef.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  function submitProgram(source: string, nextLang: string): Promise<Record<string, unknown>> {
    if (!ws.urls.submit) throw new TypeError('提交地址缺失。');
    return postJson(
      fillToken(ws.urls.submit, '__PID__', String(item.pid)),
      { lang: nextLang, code: source, tid: ws.tid, examShell: ws.mode === 'client' },
      SUBMIT_FAILURE,
    );
  }

  const previous = located.index > 0 ? sectionHref(ws, 'problems', { q: located.group.items[located.index - 1]!.pid }) : null;
  const next = located.index < located.group.items.length - 1
    ? sectionHref(ws, 'problems', { q: located.group.items[located.index + 1]!.pid })
    : null;
  const footer = footerCopy(ws, located.group);
  const judging = result?.judging ?? false;
  const reveal = showVerdict(ws, item);
  const useFullIde = !structured;
  const samples = problemSamples(face);
  const pretestUrl = ws.urls.pretest ? fillToken(ws.urls.pretest, '__PID__', String(item.pid)) : null;
  const canPretest = canEdit && verifyUrl === null && pretestUrl !== null && allowsPretest(config);
  const hasHistory = !textFill && reveal && face !== null;
  const scoreText = result && !deferred && !judging && result.score !== null && (!isAcmWorkspace(ws) || !reveal) && (item.feedback ? item.feedback.score : reveal)
    ? `得分 ${formatScaledScore(item.score, result.score, item.rawMax)} / ${item.score}`
    : null;
  const passed = result?.status === 1;
  const attemptText = result && !deferred && !judging && reveal && result.status !== null && isAcmWorkspace(ws)
    ? (passed ? `第 ${seenSubmits} 次通过` : `错误 ${seenSubmits} 次`)
    : null;
  const timeText = result && !deferred && !judging && result.time !== null && item.feedback?.details !== false
    ? `${Math.round(result.time)}ms`
    : null;
  const practice = ws.kind === 'contest' && ws.phase === 'ended' && ws.urls.practice ? PRACTICE_NOTE : null;
  const paperHint = ws.kind === 'paper' && !reveal ? PAPER_NOTE : null;
  const applyVerifyResult = useCallback((target: string, patch: VerifyPollPatch) => {
    if (!mounted.current) return;
    setVerifyAttempts((current) => current.map((row) => (row.rid === target ? { ...row, ...patch } : row)));
  }, []);
  const historyPanel = hasHistory && recordsVisible ? (
    <SubmissionHistory
      url={ws.urls.records}
      pid={item.pid}
      detailTemplate={ws.urls.recordDetail}
      linkDetails={ws.mode !== 'client'}
      allHref={sectionHref(ws, 'records')}
      refreshKey={rid}
      onCountChange={setRecordsCount}
      onClose={() => setRecordsVisible(false)}
    />
  ) : null;
  const statusSummary = <>
    {formalText ? <span>{textUnsaved ? '还有 1 道题的修改未保存' : '本题答案已保存'}</span> : null}
    {deferred ? <span>{DEFERRED_RESULT}</span> : null}
    {!reveal && !deferred && item.state !== 'empty' ? <span>待评测</span> : null}
    {scoreText ? <span className="tabular">{scoreText}</span> : null}
    {attemptText ? <span>{attemptText}</span> : null}
    {timeText ? <span className="font-mono tabular">{timeText}</span> : null}
    {!formalText && !result && !deferred && item.state === 'empty' ? <span>还没提交</span> : null}
    <span className="tabular">{footer.right}</span>
  </>;
  const primaryAction = formalText ? (
    <Button
      variant="primary"
      size="sm"
      disabled={!canEdit || !textUnsaved || submitting}
      loading={submitting}
      onClick={() => { void saveTextAnswers().catch((cause: unknown) => console.error('Program fill answer save failed', { tid: ws.tid, pid: item.pid, cause })); }}
    >
      保存本题型答案
    </Button>
  ) : canEdit ? (
    <Button variant="primary" size="sm" onClick={() => { void handleSubmit(); }} disabled={submitting} loading={submitting}>
      <Send />{memoryGrade ? '判分' : verifyUrl ? '提交验题' : '提交'}<Kbd>F10</Kbd>
    </Button>
  ) : <span className="text-xs text-fg-subtle">只读</span>;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      {verifyAttempts.map((row) => (
        <VerifyAttemptPoll key={row.rid} rid={row.rid} stopped={row.stopped} onResult={applyVerifyResult} />
      ))}
      <header className="sticky top-0 z-10 flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="收起或展开题目总览"
          aria-pressed={columnCollapsed}
          onClick={toggleColumn}
        >
          {columnCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>
        <span className="font-mono text-sm font-semibold">{item.label}</span>
        <h2 className="min-w-0 truncate text-md font-semibold">{item.title}</h2>
        {ws.rules?.showDifficulty && typeof problem?.raw.difficulty === 'number' ? <Difficulty level={problem.raw.difficulty} /> : null}
        {isAcmWorkspace(ws) ? (
          <span className="text-sm text-fg-muted">我的结果 {resultWord(item.state)}</span>
        ) : (
          <Badge variant="outline" size="sm">{item.excluded ? '已剔除' : `分数 ${item.score}`}</Badge>
        )}
        {limits.time ? <Badge variant="outline" size="sm">{limits.time}</Badge> : null}
        {limits.memory ? <Badge variant="outline" size="sm">{limits.memory}</Badge> : null}
        <span className="ml-auto flex items-center gap-1">
          <StepControl label="上一题" href={previous} />
          <StepControl label="下一题" href={next} />
        </span>
      </header>
      <ResizableSplit
        defaultLeftPercent={44}
        handleLabel="调整题面和编辑器的宽度"
        left={(
          <StatementHistorySplit
            statement={(
              <div className="h-full min-h-0 overflow-y-auto p-4">
                {problem ? null : <Alert tone="danger">{LOAD_FAILURE}</Alert>}
                {face ? <StatementBody
                  face={face}
                  preferred={preferredMarkdown}
                  limits={limits}
                  onOpenSample={canPretest ? (sampleId) => {
                    if (!pretestApiRef.current) throw new Error('自测面板尚未就绪');
                    pretestApiRef.current.openSampleTab(sampleId);
                  } : undefined} /> : null}
              </div>
            )}
            history={verifyAttempts.length > 0 ? (
              <div className="flex h-full min-h-0 flex-col">
                <VerifyAttemptList rows={verifyAttempts} />
                {historyPanel ? <div className="min-h-0 flex-1">{historyPanel}</div> : null}
              </div>
            ) : historyPanel}
          />
        )}
        right={(
          <section className="flex h-full min-h-0 min-w-0 flex-col bg-surface">
            {structured && surface ? (
              <WorkspaceStructuredBench
                key={`${ws.tid}:${item.pid}`}
                surface={surface}
                prohibitExternalCodeInjection={ws.rules?.prohibitCodePaste === true}
                values={regionValues}
                onChange={updateRegion}
                kind={item.kind === 'program_fill' ? 'program_fill' : 'function'}
                lang={submitLang}
                readOnly={!canEdit || (!formalText && submitting)}
                primaryAction={primaryAction}
                onSubmit={formalText ? undefined : () => { void handleSubmit(); }}
                statusExtra={statusSummary}
                result={result?.status != null && !deferred && reveal ? { status: result.status } : undefined}
                recordsVisible={recordsVisible}
                recordsCount={recordsCount}
                onToggleRecords={hasHistory ? () => setRecordsVisible((visible) => !visible) : undefined}
                pretest={canPretest && pretestUrl ? { url: pretestUrl, resolveRecordUrl: (recordId) => fillToken(ws.urls.recordDetail, '__RID__', recordId), samples } : undefined}
                pretestApiRef={pretestApiRef}
              />
            ) : null}
            {structured && face && !surface ? <div className="p-4"><Alert tone="danger">这道题没有作答区。</Alert></div> : null}
            {useFullIde ? (
              <KryptonIDE
                key={item.pid}
                prohibitExternalCodeInjection={ws.rules?.prohibitCodePaste === true}
                mode={canEdit ? 'full' : 'readonly'}
                className="h-full min-h-0 flex-1 rounded-none border-x-0 border-t-0"
                langs={options.map((option) => option.value)}
                defaultLang={lang}
                value={code}
                onValueChange={canEdit ? updateCode : undefined}
                onLanguageChange={canEdit ? chooseLang : undefined}
                samples={samples}
                canPretest={canPretest}
                pretestUrl={pretestUrl ?? undefined}
                pretestRecordUrlTemplate={ws.urls.recordDetail}
                pretestApiRef={pretestApiRef}
                onSubmit={canEdit ? (nextLang, source) => handleSubmit(source, nextLang) : undefined}
                submitLabel={verifyUrl ? '提交验题' : '提交'}
                showRecordsButton={hasHistory}
                recordsVisible={recordsVisible}
                recordsCount={recordsCount}
                onToggleRecords={() => setRecordsVisible((visible) => !visible)}
                statusExtra={<>{result?.status != null && !deferred && reveal ? <Verdict status={result.status} /> : null}{statusSummary}</>}
                minHeight={0}
              />
            ) : null}
            {memoryGrade && surface ? <div className="max-h-40 shrink-0 overflow-auto"><RegionGradeList surface={surface} grades={regionGrades} /></div> : null}
            {formalText && !textUnsaved && (acceptedText?.score != null || Object.keys(acceptedText?.judgeResult ?? {}).length > 0) ? (
              <div className="flex shrink-0 flex-wrap gap-2 border-t border-line px-3 py-1.5">
                {Object.entries(acceptedText?.judgeResult ?? {}).map(([id, outcome]) => <span key={id} className="flex items-center gap-1 text-sm">作答区{regionOutcomeBadge(outcome)}</span>)}
                {acceptedText?.score != null ? <Badge variant="outline">得分 {acceptedText.score}</Badge> : null}
              </div>
            ) : null}
            {error ? <div className="shrink-0 px-3 py-2"><Alert tone="danger">{error}</Alert></div> : null}
            {practice ? <p className="shrink-0 px-3 py-2 text-sm text-fg-muted">{practice}</p> : null}
            {paperHint ? <p className="shrink-0 px-3 py-2 text-sm text-fg-muted">{paperHint}</p> : null}
          </section>
        )}
      />
    </div>
  );
}
