import type { TeachTab } from '@hydrooj/common';
import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { Toolbar } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect, type SimpleSelectOption } from '@/components/ui/select';
import { STATUS_DISPLAY, Verdict } from '@/components/ui/verdict';
import { useBootstrap } from '@/lib/bootstrap';
import { useExamNow } from '@/lib/exam-server-clock';
import { getJson, teachApi } from '../api';
import { parseTeachParticipants } from '../model';
import type { TeachParticipant, TeachWorkbenchPayload } from '../model';
import { paperFromPayload, paperNumbering } from '../paper';

const RECORD_LOAD_FAILED = '读取提交记录失败';
const PARTICIPANT_LOAD_FAILED = '读取学生名单失败';
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/** Chinese names for the common Hydro statuses. Codes stay the STATUS_DISPLAY keys. */
const RESULT_FILTERS = [
  { status: 1, label: '通过' },
  { status: 2, label: '答案错误' },
  { status: 3, label: '时间超限' },
  { status: 4, label: '内存超限' },
  { status: 6, label: '运行时错误' },
  { status: 7, label: '编译错误' },
  { status: 20, label: '评测中' },
] as const;

interface Submission {
  id: string;
  at: number;
  uid: number;
  pid: number;
  /** Null when contest projection removed the field. Not the same as status 0. */
  status: number | null;
  score: number | null;
  language: string;
  time: number | null;
  uname: string;
  problemPid: string;
  problemTitle: string;
}

type RecordState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; raw: unknown };

type ParticipantsState =
  | { status: 'loading' }
  | { status: 'ready'; participants: TeachParticipant[] }
  | { status: 'error'; message: string };

function invalid(path: string): never {
  throw new TypeError(`record_list_invalid:${path}`);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(path);
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== 'string') invalid(`${path}.${key}`);
  return value;
}

function readInteger(record: Record<string, unknown>, key: string, path: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid(`${path}.${key}`);
  return value;
}

function readFinite(record: Record<string, unknown>, key: string, path: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${path}.${key}`);
  return value;
}

/** Absent, null, or undefined is projection hiding the field. Any other shape still throws. */
function readOptionalInteger(record: Record<string, unknown>, key: string, path: string): number | null {
  if (!Object.hasOwn(record, key)) return null;
  const value = record[key];
  if (value === undefined || value === null) return null;
  return readInteger(record, key, path);
}

function readOptionalFinite(record: Record<string, unknown>, key: string, path: string): number | null {
  if (!Object.hasOwn(record, key)) return null;
  const value = record[key];
  if (value === undefined || value === null) return null;
  return readFinite(record, key, path);
}

function readRecordId(value: unknown, path: string): string {
  if (typeof value === 'string' && OBJECT_ID.test(value)) return value;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = asRecord(value, path);
    const oid = record.$oid;
    if (Object.keys(record).length === 1 && typeof oid === 'string' && OBJECT_ID.test(oid)) return oid;
  }
  invalid(path);
}

function objectIdTime(id: string): number {
  return Number.parseInt(id.slice(0, 8), 16) * 1000;
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}

function readLangTable(body: Record<string, unknown>): Record<string, unknown> | null {
  if (!Object.hasOwn(body, 'langs')) return null;
  const value = body.langs;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid('record.langs');
  return value as Record<string, unknown>;
}

function textField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value !== 'string' || value === '') return null;
  return value;
}

/** Missing `langs` keeps the raw code. `_` with no entry is the subjective placeholder. */
function languageLabel(langs: Record<string, unknown> | null, lang: string): string {
  if (langs === null || !Object.hasOwn(langs, lang)) return lang === '_' && langs !== null ? '—' : lang;
  const entry = langs[lang];
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return lang;
  const record = asRecord(entry, `record.langs.${lang}`);
  return textField(record, 'display') ?? textField(record, 'name') ?? lang;
}

/** Parse the record list in render so a bad payload cannot paint a partial row. */
function parseRecordList(raw: unknown): Submission[] {
  const body = asRecord(raw, 'record');
  const langs = readLangTable(body);
  if (!Array.isArray(body.rdocs)) invalid('record.rdocs');
  const udict = asRecord(body.udict, 'record.udict');
  const pdict = asRecord(body.pdict, 'record.pdict');
  return body.rdocs.map((item, index) => {
    const path = `record.rdocs[${index}]`;
    const record = asRecord(item, path);
    const id = readRecordId(record._id, `${path}._id`);
    const uid = readInteger(record, 'uid', path);
    const pid = readInteger(record, 'pid', path);
    const user = asRecord(udict[String(uid)], `${path}.user`);
    const problem = asRecord(pdict[String(pid)], `${path}.problem`);
    return {
      id,
      at: objectIdTime(id),
      uid,
      pid,
      status: readOptionalInteger(record, 'status', path),
      score: readOptionalFinite(record, 'score', path),
      language: languageLabel(langs, readString(record, 'lang', path)),
      time: readOptionalFinite(record, 'time', path),
      uname: readString(user, 'uname', `${path}.user`),
      problemPid: readString(problem, 'pid', `${path}.problem`),
      problemTitle: readString(problem, 'title', `${path}.problem`),
    };
  });
}

function recordListPath(id: string, page: number, problemId: string, status: string, uidOrName: string): string {
  const params = new URLSearchParams();
  params.set('tid', id);
  params.set('page', String(page));
  if (problemId !== '') params.set('pid', problemId);
  if (status !== '') params.set('status', status);
  if (uidOrName !== '') params.set('uidOrName', uidOrName);
  return `/record?${params.toString()}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function sameLocalDay(left: number, right: number): boolean {
  const a = new Date(left);
  const b = new Date(right);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** `now` is the exam server clock. The digits themselves use the teacher's local calendar. */
function formatSubmissionTime(at: number, now: number): string {
  const date = new Date(at);
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  if (sameLocalDay(at, now)) return `${hours}:${minutes}:${pad2(date.getSeconds())}`;
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${hours}:${minutes}`;
}

function resultOptions(): SimpleSelectOption[] {
  return [
    { value: '', label: '全部结果' },
    ...RESULT_FILTERS.map((filter) => {
      if (!Object.hasOwn(STATUS_DISPLAY, filter.status)) throw new TypeError(`record_status_unknown:${filter.status}`);
      return { value: String(filter.status), label: filter.label };
    }),
  ];
}

function isResultStatus(value: string): boolean {
  return RESULT_FILTERS.some((filter) => String(filter.status) === value);
}

function paperProblemLabels(payload: TeachWorkbenchPayload): Map<number, string> {
  const paper = paperFromPayload(payload.paper, payload.container);
  const numbers = paperNumbering(paper);
  const labels = new Map<number, string>();
  for (const item of paper.items) {
    const number = numbers.get(item.docId);
    if (number === undefined) throw new TypeError(`record_problem_number_missing:${item.docId}`);
    labels.set(item.docId, `${number} ${item.title}`);
  }
  return labels;
}

function problemOptions(payload: TeachWorkbenchPayload, labels: Map<number, string>): SimpleSelectOption[] {
  const paper = paperFromPayload(payload.paper, payload.container);
  return [
    { value: '', label: '全部题目' },
    ...paper.items.map((item) => {
      const label = labels.get(item.docId);
      if (label === undefined) throw new TypeError(`record_problem_number_missing:${item.docId}`);
      return { value: String(item.docId), label };
    }),
  ];
}

function submissionProblemLabel(row: Submission, labels: Map<number, string>): string {
  return labels.get(row.pid) ?? `${row.problemPid} ${row.problemTitle}`;
}

function participantIndex(state: ParticipantsState): Map<number, TeachParticipant> | null {
  if (state.status !== 'ready') return null;
  const index = new Map<number, TeachParticipant>();
  for (const person of state.participants) index.set(person.uid, person);
  return index;
}

function StudentName({ person, uname }: { person: TeachParticipant | null; uname: string }) {
  if (person === null || (person.studentId.trim() === '' && person.realName.trim() === '')) return uname;
  return (
    <span className="inline-flex max-w-full min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 font-mono text-xs text-fg-subtle">{person.studentId}</span>
      <span className="min-w-0 truncate">{person.realName}</span>
    </span>
  );
}

function columnsFor(labels: Map<number, string>, identities: Map<number, TeachParticipant> | null, now: number): Column<Submission>[] {
  return [
    {
      key: 'time',
      header: '时间',
      cell: (row) => <span className="tabular text-fg-muted">{formatSubmissionTime(row.at, now)}</span>,
    },
    {
      key: 'student',
      header: '学生',
      cell: (row) => <StudentName person={identities?.get(row.uid) ?? null} uname={row.uname} />,
    },
    {
      key: 'problem',
      header: '题目',
      cell: (row) => <span className="block min-w-0 truncate">{submissionProblemLabel(row, labels)}</span>,
    },
    {
      key: 'verdict',
      header: '结果',
      cell: (row) => (row.status === null ? <span className="text-fg-subtle">{'\u2014'}</span> : <Verdict status={row.status} compact />),
    },
    {
      key: 'score',
      header: '分数',
      align: 'right',
      cell: (row) => <span className="tabular">{row.score === null ? '\u2014' : row.score}</span>,
    },
    {
      key: 'lang',
      header: '语言',
      cell: (row) => row.language,
    },
    {
      key: 'elapsed',
      header: '用时',
      align: 'right',
      cell: (row) => <span className="tabular text-fg-muted">{row.time === null ? '\u2014' : `${row.time} ms`}</span>,
    },
  ];
}

export function RecordsTab(props: {
  payload: TeachWorkbenchPayload;
  onNavigateTab: (tab: TeachTab) => void;
}) {
  const { payload } = props;
  const containerId = payload.container.id;
  const containerType = payload.container.type;
  const now = useExamNow(useBootstrap().generatedAt);
  const labels = paperProblemLabels(payload);
  const [page, setPage] = useState(1);
  const [problemId, setProblemId] = useState('');
  const [status, setStatus] = useState('');
  const [uidDraft, setUidDraft] = useState('');
  const [uidApplied, setUidApplied] = useState('');
  const uidInput = useRef<HTMLInputElement>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [recordState, setRecordState] = useState<RecordState>({ phase: 'loading' });
  const [participantsState, setParticipantsState] = useState<ParticipantsState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    getJson(teachApi.participants(containerType, containerId), PARTICIPANT_LOAD_FAILED)
      .then((raw) => {
        const parsed = parseTeachParticipants(raw);
        if (!active) return;
        setParticipantsState({ status: 'ready', participants: parsed.participants });
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error('teach records participants failed', { type: containerType, id: containerId, error });
        setParticipantsState({ status: 'error', message: messageOf(error, PARTICIPANT_LOAD_FAILED) });
      });
    return () => {
      active = false;
    };
  }, [containerId, containerType]);

  useEffect(() => {
    const node = uidInput.current;
    if (node === null) return undefined;
    const onSearch = () => {
      const next = node.value.trim();
      setUidDraft(next);
      setUidApplied(next);
      setPage(1);
    };
    node.addEventListener('search', onSearch);
    return () => node.removeEventListener('search', onSearch);
  }, []);

  useEffect(() => {
    let active = true;
    setRecordState({ phase: 'loading' });
    getJson(recordListPath(containerId, page, problemId, status, uidApplied), RECORD_LOAD_FAILED)
      .then((raw) => {
        if (!active) return;
        setRecordState({ phase: 'ready', raw });
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error('teach records load failed', { id: containerId, page, error });
        setRecordState({ phase: 'error', message: messageOf(error, RECORD_LOAD_FAILED) });
      });
    return () => {
      active = false;
    };
  }, [containerId, page, problemId, status, uidApplied, refreshToken]);

  const rows = recordState.phase === 'ready' ? parseRecordList(recordState.raw) : null;
  const identitiesPending = participantsState.status === 'loading';
  const shown = identitiesPending ? null : rows;
  const participantError = participantsState.status === 'error' ? participantsState.message : null;
  const recordError = recordState.phase === 'error' ? recordState.message : null;
  const pageEmpty = shown === null || shown.length === 0;

  let body: ReactNode;
  if (recordError !== null) body = null;
  else if (shown === null) body = <p className="px-4 py-8 text-center text-sm text-fg-subtle">正在加载…</p>;
  else if (shown.length === 0) body = <EmptyState compact title="还没有提交记录" />;
  else {
    body = (
      <DataTable
        mobile="stack"
        columns={columnsFor(labels, participantIndex(participantsState), now)}
        rows={shown}
        rowKey={(row) => row.id}
        rowHref={(row) => `/record/${row.id}`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Toolbar
        end={(
          <Button type="button" variant="ghost" onClick={() => setRefreshToken((current) => current + 1)}>
            <RefreshCw />
            刷新
          </Button>
        )}
      >
        <SimpleSelect
          ariaLabel="题目"
          className="w-64 max-w-full"
          value={problemId}
          options={problemOptions(payload, labels)}
          onValueChange={(next) => {
            if (next !== '' && !labels.has(Number(next))) throw new TypeError(`record_problem_filter_invalid:${next}`);
            setProblemId(next);
            setPage(1);
          }}
        />
        <SimpleSelect
          ariaLabel="结果"
          className="w-40 max-w-full"
          value={status}
          options={resultOptions()}
          onValueChange={(next) => {
            if (next !== '' && !isResultStatus(next)) throw new TypeError(`record_status_filter_invalid:${next}`);
            setStatus(next);
            setPage(1);
          }}
        />
        <SearchInput
          ref={uidInput}
          className="w-56 max-w-full"
          placeholder="用户名或 UID"
          aria-label="用户名或 UID"
          value={uidDraft}
          onChange={(event) => setUidDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            const next = event.currentTarget.value.trim();
            setUidDraft(next);
            setUidApplied(next);
            setPage(1);
          }}
        />
      </Toolbar>
      {recordError !== null ? <Alert tone="danger">{recordError}</Alert> : null}
      {participantError !== null ? <Alert tone="neutral">{participantError}</Alert> : null}
      <Panel
        flush
        footer={(
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-fg-muted tabular">第 {page} 页</span>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                上一页
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={pageEmpty} onClick={() => setPage(page + 1)}>
                下一页
              </Button>
            </div>
          </div>
        )}
      >
        {body}
      </Panel>
    </div>
  );
}
