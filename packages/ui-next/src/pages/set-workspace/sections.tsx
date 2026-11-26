import { isAcmWorkspace } from '@/pages/set-workspace/model';
import { homeworkKindRevealsVerdict } from '@hydrooj/common';
import {
  useEffect, useId, useRef, useState, type FormEvent, type ReactNode,
} from 'react';
import { Bell, ChartColumn, Rows3 } from 'lucide-react';
import { MarkdownView } from '@/components/markdown-renderer';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import {
  Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form';
import { Input, SearchInput } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect, type SimpleSelectOption } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Verdict, scoreTone } from '@/components/ui/verdict';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { scoreboardParticipantColumn } from '@/lib/contest-exam-display';
import { useExamNow } from '@/lib/exam-server-clock';
import { formatMoment } from '@/pages/problem-sets/model';
import { MEDAL_TEXT_CLASS, rankMedal } from '@/pages/rankboard/award-display';
import { sectionHref, objectiveVerdictPending, type SetWorkspace, type WsAnnouncement } from '@/pages/set-workspace/model';
import {
  filterRankingRows, parseBoard, rankingSummary,
  type Board, type BoardCell, type BoardStudent, type RankingSummary,
} from '@/pages/set-workspace/ranking-model';
import { getJson, postForm } from '@/pages/teach/api';

const RECORDS_FAILURE = '加载提交记录失败。';
const RANKING_FAILURE = '加载排名失败。';
const CLARIFY_FAILURE = '提交提问失败。';

interface Submission {
  id: string;
  pid: number;
  status: number | null;
  score: number | null;
  at: string;
  user: string;
}

interface Loaded<T> {
  status: 'loading' | 'ready' | 'error';
  value: T | null;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failureText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function readId(value: unknown, path: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (isRecord(value) && typeof value.$oid === 'string' && value.$oid.length > 0) return value.$oid;
  throw new TypeError(`${path} must be an id`);
}

/** Hydro record ids are object ids; the submission time is the leading timestamp. */
function objectIdInstant(id: string): string {
  if (!/^[0-9a-f]{24}$/i.test(id)) throw new TypeError(`record id ${id} is not an object id`);
  const seconds = Number.parseInt(id.slice(0, 8), 16);
  if (!Number.isFinite(seconds)) throw new TypeError(`record id ${id} has no timestamp`);
  return new Date(seconds * 1000).toISOString();
}

function parseSubmissions(raw: unknown): { rows: Submission[]; languages: SimpleSelectOption[]; canSearchStudents: boolean } {
  if (!isRecord(raw) || !Array.isArray(raw.rdocs)) throw new TypeError('提交记录缺少 rdocs');
  const rows = raw.rdocs.map((item, index) => {
    if (!isRecord(item)) throw new TypeError(`提交记录 ${index} 不是对象`);
    const id = readId(item._id, `rdocs[${index}]._id`);
    if (typeof item.pid !== 'number' || !Number.isSafeInteger(item.pid)) throw new TypeError(`rdocs[${index}].pid 必须是整数`);
    let status: number | null = null;
    if (item.status !== undefined && item.status !== null) {
      if (typeof item.status !== 'number' || !Number.isInteger(item.status)) throw new TypeError(`rdocs[${index}].status 必须是整数`);
      status = item.status;
    }
    let score: number | null = null;
    if (item.score !== undefined && item.score !== null) {
      if (typeof item.score !== 'number' || !Number.isFinite(item.score)) throw new TypeError(`rdocs[${index}].score 必须是数字`);
      score = item.score;
    }
    const uid = typeof item.uid === 'number' ? String(item.uid) : '';
    const account = isRecord(raw.udict) && isRecord(raw.udict[uid]) ? raw.udict[uid] : null;
    const student = isRecord(raw.studentDict) && isRecord(raw.studentDict[uid]) ? raw.studentDict[uid] : null;
    const identity = student && typeof student.realName === 'string' && typeof student.studentId === 'string'
      ? `${student.realName} · ${student.studentId}` : account && typeof account.uname === 'string' ? account.uname : uid;
    return {
      id, pid: item.pid, status, score, at: objectIdInstant(id), user: identity,
    };
  });
  const languages = isRecord(raw.langs) ? Object.entries(raw.langs).map(([key, value]) => ({
    value: key, label: isRecord(value) && typeof value.display === 'string' ? value.display : key,
  })) : [];
  return { rows, languages, canSearchStudents: raw.canSearchStudents === true };
}

function useParsedJson<T>(path: string | null, fallback: string, parse: (raw: unknown) => T): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({
    status: path ? 'loading' : 'ready',
    value: null,
    message: '',
  });

  useEffect(() => {
    if (!path) return undefined;
    let cancelled = false;
    setState({ status: 'loading', value: null, message: '' });
    getJson(path, fallback).then((raw) => {
      const value = parse(raw);
      if (!cancelled) setState({ status: 'ready', value, message: '' });
    }).catch((error: unknown) => {
      if (!cancelled) setState({ status: 'error', value: null, message: failureText(error, fallback) });
    });
    return () => {
      cancelled = true;
    };
  }, [fallback, parse, path]);

  return state;
}

function SectionFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface-sunken">
      <div className="mx-auto max-w-5xl p-4">{children}</div>
    </div>
  );
}

function problemText(ws: SetWorkspace, pid: number): { label: string; title: string } {
  for (const group of ws.groups) {
    for (const item of group.items) {
      if (item.pid === pid) return { label: item.label, title: item.title };
    }
  }
  return { label: String(pid), title: '' };
}

function detailHref(template: string, id: string): string {
  if (!template.includes('__RID__')) throw new TypeError('记录详情地址缺少 __RID__');
  return template.replace('__RID__', id);
}

function plainPiece(value: string | number): string {
  return String(value)
    .replace(/<span style="color:orange">[^<]*<\/span>/g, '?')
    .replace(/<span class="icon icon-check"><\/span>/g, '✓')
    .replace(/<[^>]*>/g, '')
    .replace(/\u00A0/g, ' ')
    .trim();
}

function plainBoardText(value: string | number): string {
  const text = plainPiece(value);
  return text.length > 0 ? text : '—';
}

function recordsText(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((item, index) => {
    if (!isRecord(item) || (typeof item.value !== 'string' && typeof item.value !== 'number')) {
      throw new TypeError(`records[${index}].value 必须是文字或数字`);
    }
    return plainPiece(item.value);
  }).join(' / ');
}

function boardCellText(cell: BoardCell, names: ReadonlyMap<string, string>): string {
  if (cell.type === 'records' && Array.isArray(cell.raw)) {
    const joined = recordsText(cell.raw);
    if (joined !== null) return joined;
  }
  if (cell.type === 'rank' && (cell.value === 0 || cell.value === '0' || cell.value === '*')) return '*';
  if (cell.type === 'user' && (typeof cell.raw === 'string' || typeof cell.raw === 'number')) {
    const name = names.get(String(cell.raw));
    if (name) return name;
  }
  return plainBoardText(cell.value);
}

function columnAlign(type: string): string {
  if (type === 'rank' || type === 'solved' || type === 'time' || type === 'total_score') return 'text-right';
  if (type === 'problem' || type === 'record' || type === 'records') return 'text-center';
  return 'text-left';
}

function latestNotice(items: readonly WsAnnouncement[]): WsAnnouncement | null {
  let latest: WsAnnouncement | null = null;
  let latestAt = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const at = Date.parse(item.createdAt);
    if (!Number.isFinite(at)) throw new TypeError(`公告 ${item.id} 的时间无效`);
    if (at > latestAt) {
      latest = item;
      latestAt = at;
    }
  }
  return latest;
}

function clarifySubjects(ws: SetWorkspace): SimpleSelectOption[] {
  const seen = new Set<string>();
  const problems: SimpleSelectOption[] = [];
  for (const group of ws.groups) {
    for (const item of group.items) {
      const value = String(item.pid);
      if (seen.has(value)) continue;
      seen.add(value);
      problems.push({ value, label: item.title ? `${item.label} ${item.title}` : item.label });
    }
  }
  return [
    { value: '0', label: '比赛整体' },
    { value: '-1', label: '技术问题' },
    ...problems,
  ];
}

function readField(form: HTMLFormElement, name: string): string {
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) return field.value;
  throw new TypeError(`提问表单缺少 ${name}`);
}

function recordConcealed(ws: SetWorkspace, pid: number): boolean {
  for (const group of ws.groups) {
    const item = group.items.find((entry) => entry.pid === pid);
    if (!item) continue;
    if (homeworkKindRevealsVerdict(item.kind)) return false;
    if (ws.kind === 'paper') return !ws.verdictVisible;
    return objectiveVerdictPending(ws, item.kind);
  }
  if (ws.kind === 'paper') return !ws.verdictVisible;
  return !ws.objectiveVerdictVisible;
}

export function RecordsSection({ ws }: { ws: SetWorkspace }) {
  const bs = useBootstrap();
  const query = new URLSearchParams(window.location.search);
  const recordUrl = new URL(ws.urls.records, window.location.origin);
  if (ws.mode !== 'client') {
    for (const key of ['uidOrName', 'pid', 'status', 'lang', 'from', 'to', 'page']) {
      if (query.has(key)) {
        const value = query.get(key)!;
        if (value) recordUrl.searchParams.set(key, value);
        else recordUrl.searchParams.delete(key);
      }
    }
  }
  const loaded = useParsedJson(`${recordUrl.pathname}${recordUrl.search}`, RECORDS_FAILURE, parseSubmissions);
  const currentPage = Math.max(1, Number(query.get('page')) || 1);
  const pageHref = (page: number) => {
    const params = new URLSearchParams(query);
    params.set('section', 'records');
    params.set('page', String(page));
    return `${ws.urls.overview}?${params}`;
  };
  const linked = ws.mode !== 'client' && (
    ws.verdictVisible || ws.groups.some((group) => group.items.some((item) => homeworkKindRevealsVerdict(item.kind)))
  );
  const columns: Column<Submission>[] = [
    { key: 'user', header: '用户', cell: (row) => row.user || '—' },
    {
      key: 'time',
      header: '时间',
      width: '6rem',
      cell: (row) => <span className="font-mono tabular text-fg-subtle">{formatDateTime(row.at, bs.locale)}</span>,
    },
    {
      key: 'problem',
      header: '题目',
      stackRole: 'title',
      cell: (row) => {
        const problem = problemText(ws, row.pid);
        return (
          <span className="font-medium">
            <span className="font-mono text-fg-muted">{problem.label}</span>
            {problem.title ? <span className="ml-2">{problem.title}</span> : null}
          </span>
        );
      },
    },
    {
      key: 'verdict',
      header: '结果',
      cell: (row) => {
        if (ws.officialRound !== undefined) return row.status === null ? '—' : <Verdict status={row.status} />;
        if (recordConcealed(ws, row.pid)) return '待评测';
        const revealed = ws.groups.some((group) => group.items.some((item) => item.pid === row.pid && homeworkKindRevealsVerdict(item.kind)));
        if (ws.verdictVisible || revealed) return <Verdict status={row.status ?? 0} />;
        return '—';
      },
    },
    {
      key: 'score',
      header: '得分',
      align: 'right',
      width: '6rem',
      cell: (row) => <span className="tabular">{(ws.officialRound === undefined && ws.kind === 'homework' && recordConcealed(ws, row.pid)) || row.score === null ? '—' : row.score}</span>,
    },
  ];

  return (
    <SectionFrame>
      {ws.mode !== 'client' ? (
        <form method="get" action={ws.urls.overview} className="mb-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="section" value="records" />
          <FormField label="用户" htmlFor="workspace-record-user">
            <SearchInput id="workspace-record-user" name="uidOrName" defaultValue={query.get('uidOrName') ?? String(bs.user.id)} placeholder={loaded.value?.canSearchStudents ? '学号、姓名、用户名或 UID' : '用户名或 UID'} />
          </FormField>
          <FormField label="题目">
            <SimpleSelect
              ariaLabel="题目"
              name="pid"
              defaultValue={query.get('pid') || ''}
              options={[
              { value: '', label: '全部题目' },
              ...Array.from(new Map(ws.groups.flatMap((group) => group.items).map((item) => [item.pid, { value: String(item.pid), label: `${item.label} ${item.title}` }])).values()),
            ]} />
          </FormField>
          <FormField label="结果">
            <SimpleSelect
              ariaLabel="结果"
              name="status"
              defaultValue={query.get('status') || ''}
              options={[
              { value: '', label: '全部结果' }, { value: '1', label: '答案正确' }, { value: '2', label: '答案错误' },
              { value: '3', label: '超时' }, { value: '4', label: '内存超限' }, { value: '6', label: '运行错误' }, { value: '7', label: '编译错误' },
            ]} />
          </FormField>
          <FormField label="语言">
            <SimpleSelect
              ariaLabel="语言"
              name="lang"
              defaultValue={query.get('lang') || ''}
              options={[{ value: '', label: '全部语言' }, ...(loaded.value?.languages || [])]}
            />
          </FormField>
          <FormField label="开始日期（北京时间）" htmlFor="workspace-record-from"><Input id="workspace-record-from" name="from" type="date" defaultValue={query.get('from') || ''} /></FormField>
          <FormField label="结束日期（含当天）" htmlFor="workspace-record-to"><Input id="workspace-record-to" name="to" type="date" defaultValue={query.get('to') || ''} /></FormField>
          <Button type="submit">筛选</Button>
          <Button variant="ghost" asChild><a href={sectionHref(ws, 'records')}>重置</a></Button>
        </form>
      ) : null}
      <Panel flush>
        {loaded.status === 'error' || (loaded.status === 'ready' && !loaded.value) ? (
          <Alert tone="danger">{loaded.message || RECORDS_FAILURE}</Alert>
        ) : (
          <DataTable
            columns={columns}
            rows={loaded.value?.rows ?? []}
            rowKey={(row) => row.id}
            mobile="scroll"
            loading={loaded.status === 'loading'}
            empty={<EmptyState compact icon={<Rows3 />} title="还没有提交" />}
            rowHref={linked ? (row) => (recordConcealed(ws, row.pid) ? '' : detailHref(ws.urls.recordDetail, row.id)) : undefined}
          />
        )}
      </Panel>
      {ws.mode !== 'client' ? (
        <div className="mt-3 flex items-center justify-between text-sm">
          <span>第 {currentPage} 页</span>
          <div className="flex gap-2">
            {currentPage > 1 ? <Button variant="ghost" asChild><a href={pageHref(currentPage - 1)}>上一页</a></Button> : null}
            {loaded.value?.rows.length ? <Button variant="ghost" asChild><a href={pageHref(currentPage + 1)}>下一页</a></Button> : null}
          </div>
        </div>
      ) : null}

    </SectionFrame>
  );
}

const RANK_COLUMN_PX = 64;
const NAME_COLUMN_PX = 112;
const TOTAL_COLUMN_PX = 64;
const PENALTY_COLUMN_PX = 72;
const PROBLEM_COLUMN_PX = 76;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
// The acceptance test matches the exact token `p-4`, not `sm:p-4`. Unprefixed `p-3` would fight that token, so the base stays `p-4` and `lg:p-6` steps up.
const RANKING_SHELL_CLASS = 'flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden bg-surface-sunken p-4 lg:p-6';
const BOARD_PANEL_CLASS = 'flex min-h-0 flex-1 flex-col overflow-hidden [&>div:first-child]:flex [&>div:first-child]:min-h-0 [&>div:first-child]:flex-1 [&>div:first-child]:flex-col [&>div:first-child]:overflow-hidden';

function rankingColumnWidth(column: RankingColumn, participantIndex: number): string {
  if (column.type === 'rank') return 'w-16';
  if (column.type === 'studentId' || column.type === 'realName' || column.type === 'user') return 'w-28';
  if (column.type === 'solved' || column.type === 'total_score') return 'w-16';
  if (column.type === 'time') return 'w-18';
  if (column.sourceIndex === participantIndex) return 'w-28';
  return '';
}

function rankingColumnPixels(column: RankingColumn, participantIndex: number): number | null {
  if (column.type === 'rank') return RANK_COLUMN_PX;
  if (column.type === 'studentId' || column.type === 'realName' || column.type === 'user') return NAME_COLUMN_PX;
  if (column.type === 'solved' || column.type === 'total_score') return TOTAL_COLUMN_PX;
  if (column.type === 'time') return PENALTY_COLUMN_PX;
  if (column.sourceIndex === participantIndex) return NAME_COLUMN_PX;
  return null;
}

function scoredCell(type: string): boolean {
  return type === 'record' || type === 'records' || type === 'problem';
}

function rankNumber(value: string | number): number | null {
  if (value === 0 || value === '0' || value === '*') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

interface CellPaint {
  style: string | null;
  score: number | null;
  scorePercentage: number | null;
  parts: Array<{ style: string | null; score: number | null }>;
}

function emptyPaint(): CellPaint {
  return { style: null, score: null, scorePercentage: null, parts: [] };
}

function readOptionalNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

/** Style and score stay off Board; parseBoard does not keep them. */
function readCellPaints(raw: unknown): CellPaint[][] {
  if (!isRecord(raw) || !Array.isArray(raw.rows)) return [];
  return raw.rows.slice(1).map((row) => {
    if (!Array.isArray(row)) return [];
    return row.map((cell) => {
      if (!isRecord(cell)) return emptyPaint();
      const parts = Array.isArray(cell.raw)
        ? cell.raw.map((part) => {
          if (!isRecord(part)) return { style: null, score: null };
          return {
            style: typeof part.style === 'string' ? part.style : null,
            score: readOptionalNumber(part.score),
          };
        })
        : [];
      return {
        style: typeof cell.style === 'string' ? cell.style : null,
        score: readOptionalNumber(cell.score),
        scorePercentage: readOptionalNumber(cell.scorePercentage),
        parts,
      };
    });
  });
}

function isPaintedFirstBlood(paint: CellPaint | null): boolean {
  if (!paint) return false;
  if (paint.style !== null && /background-color/i.test(paint.style)) return true;
  return paint.parts.some((part) => part.style !== null && /background-color/i.test(part.style));
}

/** Digits before an orange freeze marker are the kept score. A leading minus is not. */
function scoreBeforeFreeze(raw: string): number | null {
  const markerAt = raw.search(/<span style="color:\s*orange"/i);
  const head = (markerAt >= 0 ? raw.slice(0, markerAt) : raw).replace(/<[^>]*>/g, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(head)) return null;
  const numeric = Number(head);
  return Number.isFinite(numeric) ? numeric : null;
}

function toneClass(tone: 'danger' | 'warning' | 'success'): string {
  if (tone === 'danger') return 'bg-danger-soft text-danger-fg';
  if (tone === 'warning') return 'bg-warning-soft text-warning-fg';
  return 'bg-success-soft text-success-fg';
}

/**
 * 0–100 ratio for scoreTone. scorePercentage wins. Otherwise a larger score
 * next to a smaller display is the scale (value 10, score 100 → 10/100),
 * matching the partial-credit fixture. Never multiply a display of 1 by 100.
 */
function toneRatio(plain: string, paint: CellPaint | null, kept: number | null): number | null {
  const shown = Number(plain.replaceAll('?', '').trim());
  if (paint?.scorePercentage !== null && paint?.scorePercentage !== undefined) return paint.scorePercentage;
  if (paint?.score !== null && paint?.score !== undefined && Number.isFinite(shown) && paint.score > shown && paint.score > 0) {
    return (shown / paint.score) * 100;
  }
  if (paint?.score !== null && paint?.score !== undefined && paint.score >= 0 && paint.score <= 100 && !Number.isFinite(shown)) {
    return paint.score;
  }
  if (kept !== null) return kept;
  return Number.isFinite(shown) ? shown : null;
}

function resultTone(cell: BoardCell, paint: CellPaint | null): string {
  if (!scoredCell(cell.type)) return '';
  if (isPaintedFirstBlood(paint)) return 'bg-success text-on-success';
  if (cell.type === 'records') return '';
  const raw = typeof cell.value === 'string' ? cell.value : String(cell.value);
  const plain = plainBoardText(cell.value);
  if (plain === '—' || plain.length === 0 || plain === '-') return '';
  const accepted = raw.includes('icon-check') || plain.includes('✓') || plain.startsWith('+');
  const kept = scoreBeforeFreeze(raw);
  if (/color:\s*orange/i.test(raw) && !accepted && kept === null) return 'bg-info-soft text-info-fg';
  if (plain === '?') return 'bg-info-soft text-info-fg';
  if (accepted) return 'bg-success-soft text-success-fg';
  if (plain.startsWith('-') && kept === null) return 'bg-danger-soft text-danger-fg';
  const ratio = toneRatio(plain, paint, kept);
  if (ratio === null) return plain.includes('?') ? 'bg-info-soft text-info-fg' : '';
  return toneClass(scoreTone(ratio));
}

interface RankingColumn {
  key: string;
  type: string;
  label: string;
  sourceIndex: number | null;
  problemId: string | null;
}

function rankingColumns(header: readonly BoardCell[], showIdentity: boolean): RankingColumn[] {
  const columns: RankingColumn[] = header.map((head, index) => ({
    key: `${head.type}-${index}`,
    type: head.type,
    label: plainBoardText(head.value),
    sourceIndex: index,
    problemId: head.type === 'problem' && (typeof head.raw === 'number' || typeof head.raw === 'string') ? String(head.raw) : null,
  }));
  if (!showIdentity) return columns;
  const rankAt = columns.findIndex((column) => column.type === 'rank');
  const insertAt = rankAt >= 0 ? rankAt + 1 : 0;
  columns.splice(insertAt, 0, {
    key: 'studentId',
    type: 'studentId',
    label: '学号',
    sourceIndex: null,
    problemId: null,
  }, {
    key: 'realName',
    type: 'realName',
    label: '姓名',
    sourceIndex: null,
    problemId: null,
  });
  return columns;
}

function identityText(row: readonly BoardCell[], students: ReadonlyMap<string, BoardStudent>, field: keyof BoardStudent): string {
  const user = row.find((cell) => cell.type === 'user');
  const uid = user?.raw;
  if (typeof uid !== 'number' && typeof uid !== 'string') return '—';
  const info = students.get(String(uid));
  if (!info) return '—';
  return info[field].length > 0 ? info[field] : '—';
}

function formatUpdateClock(ms: number): string {
  if (!Number.isFinite(ms)) throw new TypeError('排名更新时间无效');
  const shifted = new Date(ms + SHANGHAI_OFFSET_MS);
  const hour = String(shifted.getUTCHours()).padStart(2, '0');
  const minute = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${hour}:${minute}`;
}

function rankingViewerId(board: Board, signedInId: number, teamMode: boolean): number {
  if (teamMode) return signedInId;
  const current = board.currentUserId;
  if (typeof current === 'number' && Number.isInteger(current)) return current;
  if (typeof current === 'string' && /^-?\d+$/.test(current)) return Number(current);
  return signedInId;
}

function contestFullMark(ws: SetWorkspace): number | null {
  if (isAcmWorkspace(ws) || ws.groups.length === 0) return null;
  let sum = 0;
  let counted = 0;
  for (const group of ws.groups) {
    for (const item of group.items) {
      if (!Number.isFinite(item.score) || item.score <= 0) return null;
      sum += item.score;
      counted += 1;
    }
  }
  return counted > 0 ? sum : null;
}

function columnSticky(column: RankingColumn, showIdentity: boolean, participantIndex: number): string {
  if (column.type === 'rank') return 'sticky left-0';
  if (column.type === 'studentId') return 'sticky left-16';
  if (showIdentity && column.type === 'realName') return 'sticky left-16 sm:left-44';
  if (!showIdentity && (column.type === 'user' || column.sourceIndex === participantIndex)) return 'sticky left-16';
  return '';
}

function cellSticky(column: RankingColumn, showIdentity: boolean, participantIndex: number, stickBottom: boolean): string {
  const side = columnSticky(column, showIdentity, participantIndex);
  if (!stickBottom) return side;
  if (side.length === 0) return 'sticky bottom-0';
  return `${side} bottom-0`;
}

function penaltyMinutes(penalty: string | null): string {
  if (penalty === null) return '—';
  const text = penalty.trim();
  if (text.length === 0) return '—';
  const clock = /^(\d+):(\d{2})$/.exec(text);
  if (clock) {
    const hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    return `${hours * 60 + minutes} 分钟`;
  }
  if (/^\d+(?:\.\d+)?$/.test(text)) return `${text} 分钟`;
  return `${text} 分钟`;
}

function tableMinWidth(columns: readonly RankingColumn[], participantIndex: number): number {
  let fixed = 0;
  let flexCount = 0;
  for (const column of columns) {
    const width = rankingColumnPixels(column, participantIndex);
    if (width === null) flexCount += 1;
    else fixed += width;
  }
  return fixed + flexCount * PROBLEM_COLUMN_PX;
}

function sourceCell(row: readonly BoardCell[], column: RankingColumn): BoardCell | null {
  if (column.sourceIndex === null) return null;
  return row[column.sourceIndex] ?? null;
}

function displayedCellText(column: RankingColumn, row: readonly BoardCell[], board: Board): string {
  if (column.type === 'studentId') return identityText(row, board.students, 'studentId');
  if (column.type === 'realName') return identityText(row, board.students, 'realName');
  const cell = sourceCell(row, column);
  return cell ? boardCellText(cell, board.names) : '—';
}

interface RankingLoad {
  status: 'loading' | 'ready' | 'error';
  board: Board | null;
  paints: CellPaint[][];
  message: string;
  refreshing: boolean;
  generation: number;
  updatedAt: number | null;
  reload: () => void;
}

function useRankingBoard(path: string, nowRef: { readonly current: number }): RankingLoad {
  const [request, setRequest] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [state, setState] = useState({
    status: 'loading' as 'loading' | 'ready' | 'error',
    board: null as Board | null,
    paints: [] as CellPaint[][],
    message: '',
    generation: 0,
    updatedAt: null as number | null,
  });

  useEffect(() => {
    let cancelled = false;
    getJson(path, RANKING_FAILURE).then((raw) => {
      const board = parseBoard(raw);
      const paints = readCellPaints(raw);
      if (cancelled) return;
      const updatedAt = nowRef.current;
      setRefreshing(false);
      setState((current) => ({
        status: 'ready',
        board,
        paints,
        message: '',
        generation: current.generation + 1,
        updatedAt,
      }));
    }).catch((error: unknown) => {
      if (cancelled) return;
      setRefreshing(false);
      setState((current) => ({
        status: 'error',
        board: current.board,
        paints: current.paints,
        message: failureText(error, RANKING_FAILURE),
        generation: current.generation,
        updatedAt: current.updatedAt,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [nowRef, path, request]);

  return {
    ...state,
    refreshing,
    reload: () => {
      setRefreshing(true);
      setRequest((value) => value + 1);
    },
  };
}

function RankingShell({ children }: { children: ReactNode }) {
  return <div className={RANKING_SHELL_CLASS}>{children}</div>;
}

function RankingStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className="text-lg font-semibold tabular text-fg">{value}</p>
    </div>
  );
}

function scoreSummary(summary: RankingSummary, full: number | null): string {
  const score = summary.score ?? '—';
  if (full === null) return score;
  return `${score} / ${full}`;
}

export function RankingSection({ ws }: { ws: SetWorkspace }) {
  if (!ws.urls.ranking) {
    return (
      <RankingShell>
        <Panel>
          <EmptyState icon={<ChartColumn />} title="成绩公布后才能看到排名" description="考试结束后公布" />
        </Panel>
      </RankingShell>
    );
  }
  return <RankingBoard ws={ws} url={ws.urls.ranking} />;
}

function rankingCells(
  row: readonly BoardCell[],
  columns: readonly RankingColumn[],
  board: Board,
  paints: readonly CellPaint[] | undefined,
  showIdentity: boolean,
  participantIndex: number,
  mine: boolean,
  stickBottom: boolean,
  ws: SetWorkspace,
): ReactNode[] {
  return columns.map((column) => {
    const cell = sourceCell(row, column);
    const text = displayedCellText(column, row, board);
    const paint = column.sourceIndex === null ? null : paints?.[column.sourceIndex] ?? null;
    const tone = cell ? resultTone(cell, paint) : '';
    const scored = scoredCell(column.type);
    const rank = column.type === 'rank' && cell ? rankNumber(cell.value) : null;
    const medal = rank === null ? null : rankMedal(rank);
    const sticky = cellSticky(column, showIdentity, participantIndex, stickBottom);
    return (
      <td
        key={column.key}
        className={cn(
          'min-h-12 border-b border-line-subtle px-2 align-middle',
          columnAlign(column.type),
          rankingColumnWidth(column, participantIndex),
          column.type === 'studentId' && 'hidden font-mono text-sm sm:table-cell',
          scored && 'border-l border-line-subtle text-center',
          sticky,
          sticky && (mine ? 'z-10 bg-brand-soft' : 'z-10 bg-surface'),
        )}
      >
        {scored ? (
          <span className={cn(
            'inline-flex min-h-8 min-w-12 items-center justify-center rounded-sm px-1.5 text-center font-semibold whitespace-pre-line tabular',
            tone || 'text-fg-subtle',
          )}
          >
            {text}
          </span>
        ) : ws.mode !== 'client' && ['user', 'realName', 'studentId'].includes(column.type) && row[participantIndex]?.type === 'user' ? (
          <a className="font-medium text-brand-fg hover:underline" href={`${sectionHref(ws, 'records')}&uidOrName=${encodeURIComponent(String(row[participantIndex].raw))}`}>{text}</a>
        ) : (
          <span className={cn(
            'whitespace-pre-line tabular',
            (column.type === 'realName' || column.type === 'user') && 'font-medium',
            column.type === 'rank' && cn('font-mono text-sm', medal ? cn('font-bold', MEDAL_TEXT_CLASS[medal]) : 'text-fg-subtle'),
          )}
          >
            {text}
          </span>
        )}
      </td>
    );
  });
}

function RankingBoard({ ws, url }: { ws: SetWorkspace; url: string }) {
  const bs = useBootstrap();
  const serverNow = useExamNow(bs.generatedAt);
  const nowRef = useRef(serverNow);
  nowRef.current = serverNow;
  const loaded = useRankingBoard(url, nowRef);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLTableRowElement>(null);
  const [query, setQuery] = useState('');
  const [offscreen, setOffscreen] = useState(false);
  const board = loaded.board;
  const teamMode = ws.team !== null;
  const acm = isAcmWorkspace(ws);
  const participantIndex = board ? scoreboardParticipantColumn(board.header, teamMode) : -1;
  const showIdentity = Boolean(board && board.students.size > 0 && !teamMode);
  const columns = board ? rankingColumns(board.header, showIdentity) : [];
  const summary = board ? rankingSummary(board, rankingViewerId(board, bs.user.id, teamMode), teamMode) : null;
  const indices = board ? filterRankingRows(board, query) : [];
  const viewerIndex = summary?.rowIndex ?? null;
  const viewerShown = viewerIndex !== null && indices.includes(viewerIndex);
  const canPin = typeof window.IntersectionObserver === 'function';
  const showPinned = viewerShown && offscreen && canPin;
  const viewerRow = viewerIndex !== null && board ? board.body[viewerIndex] ?? null : null;
  const fullMark = contestFullMark(ws);

  useEffect(() => {
    const row = rowRef.current;
    if (!viewerShown || !row || typeof window.IntersectionObserver !== 'function') return undefined;
    const observer = new window.IntersectionObserver((entries) => {
      const entry = entries.find((item) => item.target === row);
      if (!entry) return;
      setOffscreen(!entry.isIntersecting);
    }, { root: scrollRef.current, threshold: 0 });
    observer.observe(row);
    return () => {
      observer.disconnect();
    };
  }, [loaded.generation, query, viewerShown]);

  function locateMine() {
    if (viewerIndex === null) return;
    if (!indices.includes(viewerIndex)) {
      setQuery('');
      requestAnimationFrame(() => {
        rowRef.current?.scrollIntoView({ block: 'center' });
      });
      return;
    }
    rowRef.current?.scrollIntoView({ block: 'center' });
  }

  return (
    <RankingShell>
      {loaded.status === 'error' ? (
        <Panel>
          <Alert tone="danger">{loaded.message || RANKING_FAILURE}</Alert>
        </Panel>
      ) : null}
      {loaded.status === 'loading' && !board ? <p className="text-sm text-fg-subtle">正在加载排名。</p> : null}
      {board && board.body.length === 0 && loaded.status === 'ready' ? (
        <Panel>
          <EmptyState compact icon={<ChartColumn />} title="还没有排名" />
        </Panel>
      ) : null}
      {board && summary && board.body.length > 0 ? (
        <>
          <Panel className="shrink-0">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              {summary.rowIndex !== null ? (
                <>
                  <div className="min-w-0">
                    <p className="text-xs text-fg-subtle">我的名次</p>
                    <p className="font-mono text-3xl font-semibold tabular text-fg">
                      <span>{summary.rank ?? '—'}</span>
                      <span className="text-lg font-normal text-fg-subtle">{` / ${summary.total}`}</span>
                    </p>
                  </div>
                  {acm ? (
                    <>
                      <RankingStat label="解题" value={summary.solved ?? '—'} />
                      <RankingStat label="罚时" value={penaltyMinutes(summary.penalty)} />
                    </>
                  ) : (
                    <RankingStat label="得分" value={scoreSummary(summary, fullMark)} />
                  )}
                </>
              ) : null}
              {board.locked ? <Badge tone="info">封榜中</Badge> : null}
              <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
                <SearchInput
                  size="sm"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="搜索学号、姓名或用户名"
                  placeholder="学号、姓名或用户名"
                  className="w-full sm:w-56"
                />
                {summary.rowIndex !== null ? (
                  <Button type="button" variant="secondary" size="sm" onClick={locateMine}>定位到我</Button>
                ) : null}
                {loaded.updatedAt !== null ? (
                  <span className="shrink-0 text-xs tabular text-fg-subtle">{`${formatUpdateClock(loaded.updatedAt)} 更新`}</span>
                ) : null}
                <Button type="button" variant="ghost" size="sm" loading={loaded.refreshing} onClick={loaded.reload}>刷新</Button>
              </div>
            </div>
          </Panel>
          <Panel
            flush
            className={BOARD_PANEL_CLASS}
            footer={(
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-fg-subtle">
                <span>{`共 ${board.body.length} 人${acm ? ' · 「*」是打星选手，不计名次' : ''}`}</span>
                <span>{acm ? '封榜后别人的新提交显示为「?」' : '按总分排名，同分同名次'}</span>
              </div>
            )}
          >
            <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-auto">
              {/* ds-allow DS005: 排名要吸顶表头、吸左的名次与选手列和逐格着色，DataTable 没有吸左列 */}
              <table className="w-full table-fixed border-separate border-spacing-0 text-sm" style={{ minWidth: `${tableMinWidth(columns, participantIndex)}px` }}>
                <thead>
                  <tr>
                    {columns.map((column) => {
                      const stat = column.problemId ? board.problems.get(column.problemId) : undefined;
                      const sticky = columnSticky(column, showIdentity, participantIndex);
                      return (
                        <th
                          key={column.key}
                          scope="col"
                          className={cn(
                            'h-11 border-b border-line bg-surface-sunken px-2 text-xs font-medium whitespace-pre-line text-fg-subtle',
                            columnAlign(column.type),
                            rankingColumnWidth(column, participantIndex),
                            column.type === 'studentId' && 'hidden sm:table-cell',
                            // Chrome pins header cells, not thead: every th sticks to the top, the identity corner also to the left.
                            'sticky top-0',
                            sticky,
                            sticky ? 'z-30' : 'z-20',
                          )}
                        >
                          <span className="block">{column.label}</span>
                          {stat ? <span title={teamMode ? '通过队数 / 提交次数' : '通过人数 / 提交次数'} className="mt-0.5 block text-2xs tabular">{stat.nAccept}/{stat.nSubmit}</span> : null}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {indices.map((rowIndex) => {
                    const row = board.body[rowIndex];
                    if (!row) return null;
                    const mine = summary.rowIndex === rowIndex;
                    const raw = participantIndex >= 0 ? row[participantIndex]?.raw : null;
                    const key = `${typeof raw === 'string' || typeof raw === 'number' ? String(raw) : 'row'}-${rowIndex}`;
                    return (
                      <tr
                        key={key}
                        ref={mine ? rowRef : undefined}
                        className={cn(mine && 'bg-brand-soft')}
                        aria-current={mine ? 'true' : undefined}
                      >
                        {rankingCells(row, columns, board, loaded.paints[rowIndex], showIdentity, participantIndex, mine, false, ws)}
                      </tr>
                    );
                  })}
                </tbody>
                {showPinned && viewerRow ? (
                  <tfoot>
                    <tr aria-hidden="true" className="bg-brand-soft">
                      {rankingCells(viewerRow, columns, board, loaded.paints[viewerIndex ?? -1], showIdentity, participantIndex, true, true, ws)}
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </Panel>
        </>
      ) : null}
    </RankingShell>
  );
}

export function NoticeSection({ ws }: { ws: SetWorkspace }) {
  const bs = useBootstrap();
  const now = useExamNow(bs.generatedAt);
  useEffect(() => {
    const latest = latestNotice(ws.announcements);
    if (!latest) return;
    localStorage.setItem(`ws-notice:${ws.tid}`, latest.createdAt);
  }, [ws.announcements, ws.tid]);

  return (
    <SectionFrame>
      <Panel flush title="公告">
        {ws.announcements.length === 0 ? (
          <EmptyState compact icon={<Bell />} title="还没有公告" />
        ) : (
          <ul className="divide-y divide-line-subtle">
            {ws.announcements.map((item) => (
              <li key={item.id} className="space-y-2 px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="min-w-0 text-sm font-semibold text-fg">{item.subject}</h3>
                  <time className="shrink-0 font-mono text-xs tabular text-fg-subtle" dateTime={item.createdAt}>
                    {formatMoment(item.createdAt, now)}
                  </time>
                </div>
                <MarkdownView content={item.content} preferredLang={bs.locale} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </SectionFrame>
  );
}

export function ClarifySection({ ws }: { ws: SetWorkspace }) {
  const bs = useBootstrap();
  const now = useExamNow(bs.generatedAt);
  const subjectId = useId();
  const contentId = useId();
  const [askOpen, setAskOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [askError, setAskError] = useState('');
  const sendingRef = useRef(false);
  const canAsk = Boolean(ws.urls.clarify);

  function openAsk() {
    setAskError('');
    setFormKey((key) => key + 1);
    setAskOpen(true);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = ws.urls.clarify;
    if (!url || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setAskError('');
    try {
      const params = new URLSearchParams();
      params.set('content', readField(event.currentTarget, 'content'));
      params.set('operation', readField(event.currentTarget, 'operation'));
      params.set('subject', readField(event.currentTarget, 'subject'));
      await postForm(url, params, CLARIFY_FAILURE);
      window.location.reload();
    } catch (error) {
      sendingRef.current = false;
      setSending(false);
      setAskError(failureText(error, CLARIFY_FAILURE));
    }
  }

  return (
    <SectionFrame>
      <Panel
        flush
        title="答疑"
        actions={canAsk ? (
          <Button type="button" variant="secondary" size="sm" onClick={openAsk}>提问</Button>
        ) : null}
      >
        {ws.clarifications.length === 0 ? (
          <EmptyState compact title="还没有提问" />
        ) : (
          <ul className="divide-y divide-line-subtle">
            {ws.clarifications.map((item) => (
              <li key={item.id} className="space-y-2 px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="min-w-0 text-sm font-semibold text-fg">{item.subject}</h3>
                  <time className="shrink-0 font-mono text-xs tabular text-fg-subtle" dateTime={item.createdAt}>
                    {formatMoment(item.createdAt, now)}
                  </time>
                </div>
                <MarkdownView content={item.content} preferredLang={bs.locale} />
                {item.replies.length > 0 ? (
                  <div className="space-y-2 border-t border-line-subtle pt-3">
                    {item.replies.map((reply, index) => (
                      <div key={`${item.id}-${index}`} className="rounded-md bg-surface-sunken p-3">
                        <p className="font-mono text-xs tabular text-fg-subtle">{formatMoment(reply.createdAt, now)}</p>
                        <MarkdownView content={reply.content} preferredLang={bs.locale} />
                      </div>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {canAsk ? (
        <Dialog open={askOpen} onOpenChange={setAskOpen}>
          <DialogContent>
            <form key={formKey} onSubmit={(event) => { void onSubmit(event); }}>
              <DialogHeader>
                <DialogTitle>提问</DialogTitle>
              </DialogHeader>
              <DialogBody className="space-y-4">
                <input type="hidden" name="operation" value="clarification" />
                <FormField label="主题" htmlFor={subjectId}>
                  <SimpleSelect id={subjectId} name="subject" defaultValue="0" options={clarifySubjects(ws)} />
                </FormField>
                <FormField label="内容" htmlFor={contentId}>
                  <Textarea id={contentId} name="content" rows={6} />
                </FormField>
                {askError ? <Alert tone="danger">{askError}</Alert> : null}
              </DialogBody>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setAskOpen(false)}>取消</Button>
                <Button type="submit" variant="primary" loading={sending}>发送</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </SectionFrame>
  );
}

export function PrintSection({ ws }: { ws: SetWorkspace }) {
  return (
    <SectionFrame>
      <Panel flush title="打印">
        <div className="flex flex-col items-start gap-3 p-4">
          <p className="text-sm text-fg">打印件由监考老师送到座位。</p>
          {ws.urls.print ? (
            <Button asChild variant="secondary" size="sm">
              <a href={ws.urls.print}>打开打印</a>
            </Button>
          ) : null}
        </div>
      </Panel>
    </SectionFrame>
  );
}
