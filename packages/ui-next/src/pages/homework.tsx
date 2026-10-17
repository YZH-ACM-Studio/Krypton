import { Clock, Users } from 'lucide-react';
import { MarkdownView } from '@/components/markdown-renderer';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { StatusDot } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { Page, PageHeader } from '@/components/ui/page';
import { Pagination } from '@/components/ui/pagination';
import { DescriptionList, Panel } from '@/components/ui/panel';
import { useBootstrap } from '@/lib/bootstrap';
import { useExamNow } from '@/lib/exam-server-clock';
import { formatDateTime, replaceRouteTokens, toDate } from '@/lib/format';
import { paginationBaseUrl } from '@/pages/problem-set-roster';

interface HomeworkDocument {
  docId?: string | number;
  title?: string;
  penaltySince?: unknown;
  endAt?: unknown;
  attend?: number;
  pids?: Array<string | number>;
  content?: string;
}

interface HomeworkProblem {
  title?: string;
  nAccept?: number;
  nSubmit?: number;
}

interface HomeworkPageData {
  tdocs?: HomeworkDocument[];
  tdoc?: HomeworkDocument;
  page?: string | number;
  tpcount?: string | number;
  pids?: Array<string | number>;
  pdict?: Record<string, HomeworkProblem>;
  canGradeSubjective?: boolean;
  canEditHomework?: boolean;
  canDeleteHomework?: boolean;
}

interface HomeworkProblemRow {
  pid: string | number;
  index: number;
  problem: HomeworkProblem;
}

/** Absent on older homework pages. A present object must carry every field. */
interface HomeworkStartView {
  required: boolean;
  durationMinutes: number | null;
  startAt: string | null;
  personalEndAt: string | null;
}

const HOMEWORK_START_IDLE: HomeworkStartView = {
  required: false,
  durationMinutes: null,
  startAt: null,
  personalEndAt: null,
};

const ONE_MINUTE_MS = 60_000;
const FIVE_MINUTES_MS = 5 * ONE_MINUTE_MS;

type HomeworkStartPresentation =
  | { kind: 'start'; minutes: number }
  | { kind: 'countdown'; endMs: number }
  | { kind: 'open' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readDurationMinutes(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError('homeworkStart.durationMinutes is invalid');
  }
  return value;
}

function readInstant(value: unknown, field: 'startAt' | 'personalEndAt'): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`homeworkStart.${field} is invalid`);
  }
  return value;
}

function readHomeworkStart(data: unknown): HomeworkStartView {
  if (!isRecord(data) || !Object.hasOwn(data, 'homeworkStart')) {
    return HOMEWORK_START_IDLE;
  }
  const raw = data.homeworkStart;
  if (raw == null) return HOMEWORK_START_IDLE;
  if (!isRecord(raw)) throw new TypeError('homeworkStart is invalid');
  for (const key of ['required', 'durationMinutes', 'startAt', 'personalEndAt'] as const) {
    if (!Object.hasOwn(raw, key)) {
      throw new TypeError(`homeworkStart.${key} is invalid`);
    }
  }
  if (typeof raw.required !== 'boolean') throw new TypeError('homeworkStart.required is invalid');
  return {
    required: raw.required,
    durationMinutes: readDurationMinutes(raw.durationMinutes),
    startAt: readInstant(raw.startAt, 'startAt'),
    personalEndAt: readInstant(raw.personalEndAt, 'personalEndAt'),
  };
}

function presentHomeworkStart(start: HomeworkStartView): HomeworkStartPresentation {
  if (start.required) {
    if (start.durationMinutes == null) throw new TypeError('homeworkStart.durationMinutes is invalid');
    return { kind: 'start', minutes: start.durationMinutes };
  }
  if (start.durationMinutes != null && start.startAt != null) {
    if (start.personalEndAt == null) throw new TypeError('homeworkStart.personalEndAt is invalid');
    return { kind: 'countdown', endMs: Date.parse(start.personalEndAt) };
  }
  return { kind: 'open' };
}

function padClock(value: number): string {
  return String(value).padStart(2, '0');
}

function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `剩余 ${padClock(hours)}:${padClock(minutes)}:${padClock(seconds)}`;
}

function remainingClass(remainingMs: number): string {
  if (remainingMs <= ONE_MINUTE_MS) return 'shrink-0 font-mono tabular text-danger-fg';
  if (remainingMs <= FIVE_MINUTES_MS) return 'shrink-0 font-mono tabular text-warning-fg';
  return 'shrink-0 font-mono tabular text-fg';
}

function HomeworkPersonalCountdown({ endMs }: { endMs: number }) {
  const serverNow = useExamNow(useBootstrap().generatedAt);
  const remainingMs = endMs - serverNow;
  if (remainingMs <= 0) {
    return <span className="shrink-0 font-mono tabular text-danger-fg">已到时间</span>;
  }
  return <span className={remainingClass(remainingMs)}>{formatRemaining(remainingMs)}</span>;
}

function HomeworkStartPanel({ minutes }: { minutes: number }) {
  return (
    <Panel
      title="这份作业有个人限时"
      footer={(
        <form method="post">
          <input type="hidden" name="operation" value="start" />
          <Button type="submit" variant="primary">开始作答</Button>
        </form>
      )}
    >
      <p className="text-sm text-fg">
        {`个人限时 ${minutes} 分钟。点「开始作答」后开始计时，到时自动截止；开始前看不到题目。`}
      </p>
    </Panel>
  );
}

function hwState(homework: HomeworkDocument): { label: string; tone: 'neutral' | 'success' | 'warning'; pulse?: boolean } {
  const now = Date.now();
  const deadline = toDate(homework.penaltySince)?.getTime() || 0;
  const hard = toDate(homework.endAt)?.getTime() || 0;
  if (!deadline) return { label: '待开放', tone: 'neutral' };
  if (now < deadline) return { label: '进行中', tone: 'success', pulse: true };
  if (hard && now < hard) return { label: '宽限期', tone: 'warning' };
  return { label: '已结束', tone: 'neutral' };
}

function HomeworkStatus({ homework }: { homework: HomeworkDocument }) {
  const state = hwState(homework);
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusDot tone={state.tone} pulse={state.pulse} />
      {state.label}
    </span>
  );
}

export function HomeworkPage() {
  const bs = useBootstrap();
  const data = bs.page.data as HomeworkPageData;
  const tdocs = data.tdocs || [];
  const page = Number(data.page) || 1;
  const tpcount = Number(data.tpcount) || 1;
  const locale = bs.locale;
  const columns: Column<HomeworkDocument>[] = [
    {
      key: 'title',
      header: '作业名称',
      stackRole: 'title',
      cell: (homework) => <span className="break-words font-medium">{homework.title || '未命名作业'}</span>,
    },
    {
      key: 'deadline',
      header: '截止时间',
      width: '11rem',
      cell: (homework) => (
        <span className="inline-flex items-center gap-1.5 text-fg-muted">
          <Clock className="size-3.5 text-fg-subtle" />
          <span className="tabular">{formatDateTime(homework.penaltySince || homework.endAt, locale)}</span>
        </span>
      ),
    },
    {
      key: 'attend',
      header: '参与',
      align: 'center',
      width: '5rem',
      cell: (homework) => (
        <span className="inline-flex items-center justify-center gap-1.5 tabular text-fg-muted">
          <Users className="size-3.5 text-fg-subtle" />
          {homework.attend || 0}
        </span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      align: 'center',
      width: '6rem',
      stackRole: 'meta',
      cell: (homework) => <HomeworkStatus homework={homework} />,
    },
  ];

  return (
    <Page width="wide">
      <PageHeader
        title="作业"
        description="课程作业列表"
        actions={(
          <Button asChild variant="primary">
            <a href={`${bs.urls.homework}/create`}>创建作业</a>
          </Button>
        )}
      />
      <Panel
        flush
        footer={(
          <Pagination
            current={page}
            total={tpcount}
            baseUrl={typeof window === 'undefined' ? bs.urls.homework : `${bs.urls.homework}${paginationBaseUrl(window.location.search)}`}
          />
        )}
      >
        {tdocs.length === 0 ? (
          <EmptyState compact title="暂无作业" />
        ) : (
          <DataTable
            mobile="stack"
            columns={columns}
            rows={tdocs}
            rowKey={(homework) => String(homework.docId)}
            rowHref={(homework) => replaceRouteTokens(bs.urls.homeworkDetail, { TID: String(homework.docId) })}
          />
        )}
      </Panel>
    </Page>
  );
}

export function HomeworkDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data as HomeworkPageData;
  const tdoc = data.tdoc || {};
  const homeworkStart = presentHomeworkStart(readHomeworkStart(bs.page.data));
  // Only a required personal start hides the list. Older pages omit pdict and still list tdoc.pids as "Problem {pid}".
  const pdict = data.pdict || {};
  const pids: (string | number)[] = homeworkStart.kind === 'start' ? [] : (data.pids || tdoc.pids || []);
  const locale = bs.locale;
  const problemRows: HomeworkProblemRow[] = pids.map((pid, index) => ({
    pid,
    index,
    problem: pdict[String(pid)] || {},
  }));
  const problemColumns: Column<HomeworkProblemRow>[] = [
    {
      key: 'index',
      header: '#',
      width: '3rem',
      cell: (row) => <span className="font-mono text-xs text-fg-subtle">{String.fromCharCode(65 + row.index)}</span>,
    },
    {
      key: 'title',
      header: '题目',
      stackRole: 'title',
      cell: (row) => <span className="break-words font-medium">{row.problem.title || `Problem ${row.pid}`}</span>,
    },
    {
      key: 'stats',
      header: '通过/提交',
      align: 'right',
      width: '6rem',
      stackRole: 'meta',
      cell: (row) => (
        <span className="tabular text-sm text-fg-subtle">
          {row.problem.nAccept || 0}/{row.problem.nSubmit || 0}
        </span>
      ),
    },
  ];

  return (
    <Page width="wide">
      <PageHeader
        breadcrumb={(
          <Breadcrumb
            items={[
              { label: '作业', href: bs.urls.homework },
              { label: tdoc.title || '作业' },
            ]}
          />
        )}
        title={tdoc.title || '作业'}
        meta={(
          <>
            <HomeworkStatus homework={tdoc} />
            {homeworkStart.kind === 'countdown' ? <HomeworkPersonalCountdown endMs={homeworkStart.endMs} /> : null}
          </>
        )}
        actions={(
          <>
            {data.canEditHomework ? (
              <Button asChild variant="secondary">
                <a href={`/homework/${String(tdoc.docId)}/edit`}>编辑作业</a>
              </Button>
            ) : null}
            {data.canDeleteHomework ? (
              <Button asChild variant="secondary">
                <a href={`/homework/${String(tdoc.docId)}/file`}>文件</a>
              </Button>
            ) : null}
            {data.canGradeSubjective ? (
              <Button asChild variant="secondary">
                <a href={`/manage/grading/${String(tdoc.docId)}`}>主观题阅卷</a>
              </Button>
            ) : null}
            {data.canDeleteHomework ? (
              <form
                method="post"
                action={`/homework/${String(tdoc.docId)}/edit`}
                onSubmit={(event) => {
                  void confirmFormSubmit(event, '确定要删除此作业吗？', { destructive: true });
                }}
              >
                <input type="hidden" name="operation" value="delete" />
                <Button type="submit" variant="danger-soft">
                  删除
                </Button>
              </form>
            ) : null}
          </>
        )}
      />

      <Panel>
        <DescriptionList
          columns={2}
          items={[
            { term: '截止时间', detail: formatDateTime(tdoc.penaltySince, locale) },
            { term: '硬截止', detail: formatDateTime(tdoc.endAt, locale) },
          ]}
        />
      </Panel>

      {tdoc.content ? (
        <Panel title="作业说明">
          <MarkdownView content={tdoc.content} className="max-w-prose" />
        </Panel>
      ) : null}

      {homeworkStart.kind === 'start' ? (
        <HomeworkStartPanel minutes={homeworkStart.minutes} />
      ) : (
        <Panel title="题目列表" flush={pids.length > 0}>
          {pids.length === 0 ? (
            <EmptyState compact title="暂无题目" />
          ) : (
            <DataTable
              mobile="stack"
              columns={problemColumns}
              rows={problemRows}
              rowKey={(row) => String(row.pid)}
              rowHref={(row) => `${replaceRouteTokens(bs.urls.problemDetail, { PID: String(row.pid) })}?tid=${encodeURIComponent(String(tdoc.docId))}`}
            />
          )}
        </Panel>
      )}
    </Page>
  );
}
