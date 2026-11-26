import { CalendarDays, Layers, List } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Page, PageHeader, Toolbar } from '@/components/ui/page';
import { PageTabs } from '@/components/ui/page-tabs';
import { Panel } from '@/components/ui/panel';
import { Pagination } from '@/components/ui/pagination';
import { useBootstrap } from '@/lib/bootstrap';
import { participantRecordsUrl } from '@/lib/record-navigation';
import { useExamNow } from '@/lib/exam-server-clock';
import { CalendarView } from './calendar-view';
import { PracticeCard } from './practice-card';
import { useRefreshPracticeOnReturn } from './use-practice-history';
import {
  contestTypeLabel,
  endedResultText,
  formatDate,
  parseStudentSets,
  type EndedRow,
  type StudentSetRow,
  type StudentSetsBody,
  type StudentSetsTab,
} from './model';
import { StudentSetRowItem } from './set-row';

const ENDED_PAGE_SIZE = 20;
const RANGE_DASH = '\u2013';

const WINDOW_EMPTY: Record<'running' | 'upcoming', { title: string; description: string }> = {
  running: {
    title: '现在没有要做的题目集',
    description: '老师布置作业或考试开始后会出现在这里。',
  },
  upcoming: {
    title: '近期没有安排',
    description: '有新的考试或作业时会出现在这里。',
  },
};

const ENDED_TYPE_LABEL: Record<'all' | 'exam' | 'homework', string> = {
  all: '全部',
  exam: '考试及比赛',
  homework: '作业',
};

function hrefQuery(entries: ReadonlyArray<readonly [string, string]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value === '') continue;
    params.set(key, value);
  }
  const text = params.toString();
  return text === '' ? '?' : `?${text}`;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer, received ${String(value)}`);
  }
  return value;
}

function pageWindow(page: number, pageCount: number): { page: number; pageCount: number } {
  const current = positiveInteger(page, 'page');
  const count = positiveInteger(pageCount, 'pageCount');
  if (current > count) throw new TypeError(`page ${current} exceeds pageCount ${count}`);
  return { page: current, pageCount: count };
}

function rowKey(row: StudentSetRow): string {
  return `${row.kind}:${row.id}`;
}

function assertUniqueRows(rows: readonly StudentSetRow[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = rowKey(row);
    if (seen.has(key)) throw new TypeError(`duplicate student set row ${key}`);
    seen.add(key);
  }
}

function isDone(row: StudentSetRow): boolean {
  return (row.kind === 'exam' || row.kind === 'homework') && row.done;
}

function endedSummary(page: number, total: number): string {
  if (!Number.isInteger(total) || total < 0) {
    throw new TypeError(`ended total must be a non-negative integer, received ${String(total)}`);
  }
  const start = total === 0 ? 0 : (page - 1) * ENDED_PAGE_SIZE + 1;
  const end = Math.min(page * ENDED_PAGE_SIZE, total);
  if (end < start) throw new TypeError(`ended page ${page} is outside ${total} items`);
  return `第 ${start}${RANGE_DASH}${end} 项，共 ${total} 项`;
}

function tabItems(counts: StudentSetsBody['counts']) {
  return [
    { value: 'running' as const, label: '进行中', count: counts.running, href: hrefQuery([['tab', 'running']]) },
    { value: 'upcoming' as const, label: '即将开始', count: counts.upcoming, href: hrefQuery([['tab', 'upcoming']]) },
    { value: 'practice' as const, label: '练习', count: counts.practice, href: hrefQuery([['tab', 'practice']]) },
    { value: 'ended' as const, label: '已结束', href: hrefQuery([['tab', 'ended']]) },
  ];
}

function SetList({ rows, now }: { rows: readonly StudentSetRow[]; now: number }) {
  return (
    <div className="[&>*:first-child]:border-t-0">
      {rows.map((row) => (
        <StudentSetRowItem key={rowKey(row)} row={row} now={now} />
      ))}
    </div>
  );
}

function FinishedSeparator() {
  return (
    <p className="border-t border-line-subtle bg-surface-sunken px-4 py-2 text-xs text-fg-subtle">
      已完成
    </p>
  );
}

function WindowList({
  tab,
  rows,
  now,
}: {
  tab: 'running' | 'upcoming';
  rows: readonly StudentSetRow[];
  now: number;
}) {
  assertUniqueRows(rows);
  if (rows.length === 0) {
    const copy = WINDOW_EMPTY[tab];
    return (
      <Panel flush>
        <EmptyState icon={<Layers />} title={copy.title} description={copy.description} />
      </Panel>
    );
  }
  const open = rows.filter((row) => !isDone(row));
  const done = rows.filter((row) => isDone(row));
  return (
    <Panel flush>
      {open.length > 0 ? <SetList rows={open} now={now} /> : null}
      {done.length > 0 ? (
        <>
          <FinishedSeparator />
          <SetList rows={done} now={now} />
        </>
      ) : null}
    </Panel>
  );
}

function PracticeList({
  rows,
  page,
}: {
  rows: readonly StudentSetRow[];
  page: NonNullable<StudentSetsBody['practice']>;
}) {
  assertUniqueRows(rows);
  const practices = rows.map((row) => {
    if (row.kind !== 'practice') throw new TypeError('practice tab contains a non-practice row');
    return row;
  });
  const paging = pageWindow(page.page, page.pageCount);
  return (
    <>
      <Toolbar>
        <form method="get" className="w-full sm:w-72">
          <input type="hidden" name="tab" value="practice" />
          <SearchInput
            name="q"
            defaultValue={page.q}
            placeholder="搜索练习"
            aria-label="搜索练习"
            className="w-full"
          />
        </form>
      </Toolbar>
      {practices.length === 0 ? (
        <Panel flush><EmptyState icon={<Layers />} title="还没有练习" /></Panel>
      ) : (
        <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {practices.map((row) => <PracticeCard key={row.id} row={row} />)}
        </div>
      )}
      {paging.pageCount > 1 ? (
          <Pagination
            current={paging.page}
            total={paging.pageCount}
            baseUrl={hrefQuery([['tab', 'practice'], ['q', page.q]])}
          />
      ) : null}
    </>
  );
}

function endedColumns(now: number, recordsBase: string, uid: number): Column<EndedRow>[] {
  return [
    {
      key: 'type',
      header: '类型',
      width: '7rem',
      stackRole: 'meta',
      cell: (row) => (
        <Badge tone="neutral" variant="outline" size="sm">{contestTypeLabel(row)}</Badge>
      ),
    },
    {
      key: 'title',
      header: '标题',
      stackRole: 'title',
      cell: (row) => <a href={row.href} className="block min-w-0 truncate font-medium hover:text-brand-fg">{row.title}</a>,
    },
    {
      key: 'end',
      header: '结束',
      width: '8rem',
      cell: (row) => <span className="tabular text-fg-muted">{formatDate(row.endAt, now)}</span>,
    },
    {
      key: 'result',
      header: '我的成绩',
      align: 'right',
      width: '9rem',
      cell: (row) => row.result.kind !== 'score' && row.result.kind !== 'accepted' ? (
        <span className="tabular text-fg-subtle">{endedResultText(row.result)}</span>
      ) : (
        <a className="tabular text-brand-fg hover:underline" href={participantRecordsUrl(recordsBase, row.id, uid)}>
          {endedResultText(row.result)}
        </a>
      ),
    },
  ];
}

function EndedList({
  page,
  now,
}: {
  page: NonNullable<StudentSetsBody['ended']>;
  now: number;
}) {
  const bs = useBootstrap();
  const seen = new Set<string>();
  for (const row of page.rows) {
    const key = `${row.kind}:${row.id}`;
    if (seen.has(key)) throw new TypeError(`duplicate ended row ${key}`);
    seen.add(key);
  }
  const paging = pageWindow(page.page, page.pageCount);
  const baseUrl = hrefQuery([
    ['tab', 'ended'],
    ['type', page.type],
    ['q', page.q],
  ]);
  return (
    <>
      <Toolbar
        end={(
          <form method="get" className="w-full sm:w-72">
            <input type="hidden" name="tab" value="ended" />
            <input type="hidden" name="type" value={page.type} />
            <SearchInput
              name="q"
              defaultValue={page.q}
              placeholder="搜索标题"
              aria-label="搜索标题"
              className="w-full"
            />
          </form>
        )}
      >
        <MiniTabs
          aria-label="类型"
          value={page.type}
          items={(Object.keys(ENDED_TYPE_LABEL) as Array<keyof typeof ENDED_TYPE_LABEL>).map((type) => ({
            value: type,
            label: ENDED_TYPE_LABEL[type],
            href: hrefQuery([['tab', 'ended'], ['type', type], ['q', page.q]]),
          }))}
        />
      </Toolbar>
      <Panel
        flush
        footer={paging.pageCount > 1 ? (
          <Pagination
            current={paging.page}
            total={paging.pageCount}
            baseUrl={baseUrl}
            summary={endedSummary(paging.page, page.total)}
          />
        ) : undefined}
      >
        <DataTable
          mobile="stack"
          columns={endedColumns(now, bs.urls.records, bs.user.id)}
          rows={page.rows}
          rowKey={(row) => `${row.kind}:${row.id}`}
          empty={<EmptyState icon={<Layers />} title="没有已结束的题目集" />}
        />
      </Panel>
    </>
  );
}

function requirePractice(body: StudentSetsBody): NonNullable<StudentSetsBody['practice']> {
  if (body.tab !== 'practice' || body.practice === null) {
    throw new TypeError('practice tab is missing its page');
  }
  return body.practice;
}

function requireEnded(body: StudentSetsBody): NonNullable<StudentSetsBody['ended']> {
  if (body.tab !== 'ended' || body.ended === null) {
    throw new TypeError('ended tab is missing its page');
  }
  return body.ended;
}

const VIEW_STORAGE_KEY = 'krypton:problem-sets-view';
type SetsView = 'list' | 'calendar';

function hashSelectsCalendar(): boolean {
  return window.location.hash === '#calendar';
}

function readSavedView(): SetsView {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'calendar' ? 'calendar' : 'list';
  } catch {
    return 'list';
  }
}

function rememberView(view: SetsView): void {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Storage can be blocked. The choice still applies for this visit.
  }
}

function initialSetsView(): SetsView {
  if (hashSelectsCalendar()) return 'calendar';
  return readSavedView();
}

function ViewSwitch({ view, onChange }: { view: SetsView; onChange: (next: SetsView) => void }) {
  return (
    <MiniTabs
      aria-label="题目集视图"
      value={view}
      onValueChange={onChange}
      items={[
        { value: 'list', label: '列表', icon: List },
        { value: 'calendar', label: '日历', icon: CalendarDays },
      ]}
    />
  );
}

export function StudentSetsPage() {
  const bootstrap = useBootstrap();
  const now = useExamNow(bootstrap.generatedAt);
  const body = parseStudentSets(bootstrap.page.data);
  const [view, setView] = useState<SetsView>(initialSetsView);
  const calendar = view === 'calendar';
  useRefreshPracticeOnReturn(!calendar && body.tab === 'practice');

  function selectView(next: SetsView) {
    rememberView(next);
    setView(next);
  }

  return (
    <Page width="wide">
      <PageHeader
        title="题目集"
        actions={<ViewSwitch view={view} onChange={selectView} />}
        tabs={calendar ? undefined : (
          <PageTabs<StudentSetsTab>
            aria-label="题目集"
            value={body.tab}
            items={tabItems(body.counts)}
          />
        )}
      />
      {calendar ? <CalendarView /> : null}
      {!calendar && (body.tab === 'running' || body.tab === 'upcoming') ? (
        <WindowList tab={body.tab} rows={body.rows} now={now} />
      ) : null}
      {!calendar && body.tab === 'practice' ? <PracticeList rows={body.rows} page={requirePractice(body)} /> : null}
      {!calendar && body.tab === 'ended' ? <EndedList page={requireEnded(body)} now={now} /> : null}
    </Page>
  );
}
