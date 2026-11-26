import { teachPath } from '@hydrooj/common';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { AnnouncementHomeBlock } from '@/components/announcement-home-block';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton, Stat, StatusDot } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { useBootstrap } from '@/lib/bootstrap';
import { useExamNow } from '@/lib/exam-server-clock';
import { getJson, teachApi } from '@/pages/teach/api';
import { parseTeachCourseListPayload, type TeachCourseListPayload, type TeachCourseRow } from '@/pages/teach/courses';
import { parseTeachListPayload, type TeachListRow } from '@/pages/teach/model';
import { teachSetTypeLabel } from '@/pages/teach/shared-preview-dialog';

const SETS_FAILED = '题目集列表暂时不能查看。';
const COURSES_FAILED = '课程列表暂时不能查看。';
const COURSES_PATH = '/teach/courses?scope=mine';
const SET_LIMIT = 5;
const COURSE_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const NOT_STARTED = '\u2014';

type SetStatus = 'running' | 'upcoming';

interface HomeSetRow {
  row: TeachListRow;
  beginMs: number;
  endMs: number | null;
}

interface HomeSetList {
  total: number;
  rows: HomeSetRow[];
}

type Load<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string };

function visibleError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}

function requireMs(value: string | null, label: string): number {
  if (value === null) throw new TypeError(`teacher_home_time_missing:${label}`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new TypeError(`teacher_home_time_invalid:${label}`);
  return ms;
}

function optionalMs(value: string | null, label: string): number | null {
  if (value === null) return null;
  return requireMs(value, label);
}

function listPath(status: SetStatus, page: number): string {
  const params = new URLSearchParams({ scope: 'mine', status });
  if (page > 1) params.set('page', String(page));
  return teachApi.list(params);
}

function timedRow(row: TeachListRow, status: SetStatus): HomeSetRow {
  if (row.status !== status) throw new TypeError(`teacher_home_status_mismatch:${row.id}`);
  return {
    row,
    beginMs: requireMs(row.beginAt, `begin:${row.id}`),
    endMs: status === 'running' ? requireMs(row.endAt, `end:${row.id}`) : optionalMs(row.endAt, `end:${row.id}`),
  };
}

function readPageCount(pageCount: number): number {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new TypeError(`teacher_home_page_count_invalid:${pageCount}`);
  return pageCount;
}

async function readListPage(status: SetStatus, page: number) {
  const payload = parseTeachListPayload(await getJson(listPath(status, page), SETS_FAILED));
  if (payload.page !== page) throw new TypeError(`teacher_home_page_mismatch:${payload.page}`);
  return payload;
}

async function loadSetList(status: SetStatus): Promise<HomeSetList> {
  const first = await readListPage(status, 1);
  const pageCount = readPageCount(first.pageCount);
  const rest = pageCount === 1
    ? []
    : await Promise.all(Array.from({ length: pageCount - 1 }, (_item, index) => readListPage(status, index + 2)));
  const seen = new Set<string>();
  const rows: HomeSetRow[] = [];
  for (const row of [first, ...rest].flatMap((page) => page.rows)) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(timedRow(row, status));
  }
  rows.sort((left, right) => left.beginMs - right.beginMs || left.row.id.localeCompare(right.row.id));
  return { total: first.total, rows };
}

function useSetList(status: SetStatus): Load<HomeSetList> {
  const [state, setState] = useState<Load<HomeSetList>>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    loadSetList(status)
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ready', data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error('[teacher-home] request failed', { status, error });
        setState({ status: 'error', message: visibleError(error, SETS_FAILED) });
      });
    return () => {
      cancelled = true;
    };
  }, [status]);
  return state;
}

function useTeacherJson<T>(path: string, fallback: string, parse: (raw: unknown) => T): Load<T> {
  const [state, setState] = useState<Load<T>>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    getJson(path, fallback)
      .then((raw) => {
        const data = parse(raw);
        if (cancelled) return;
        setState({ status: 'ready', data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error('[teacher-home] request failed', { path, error });
        setState({ status: 'error', message: visibleError(error, fallback) });
      });
    return () => {
      cancelled = true;
    };
  }, [path, fallback, parse]);
  return state;
}

function countMark(state: Load<unknown>, count: number): ReactNode {
  if (state.status === 'loading') return <Skeleton className="inline-block h-7 w-8" />;
  if (state.status === 'error') return NOT_STARTED;
  return count;
}

function shanghaiStamp(ms: number, suffix: '截止' | '开始'): string {
  const shifted = new Date(ms + SHANGHAI_OFFSET_MS);
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const hour = String(shifted.getUTCHours()).padStart(2, '0');
  const minute = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${month}月${day}日 ${hour}:${minute} ${suffix}`;
}

function remainingText(endMs: number, nowMs: number): string {
  const diff = endMs - nowMs;
  if (diff <= 0) return '已截止';
  const days = Math.floor(diff / DAY_MS);
  const hours = Math.floor((diff % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((diff % HOUR_MS) / MINUTE_MS);
  if (days > 0) return hours > 0 ? `还剩 ${days} 天 ${hours} 小时` : `还剩 ${days} 天`;
  if (hours > 0) return minutes > 0 ? `还剩 ${hours} 小时 ${minutes} 分钟` : `还剩 ${hours} 小时`;
  if (minutes > 0) return `还剩 ${minutes} 分钟`;
  return '还剩不到 1 分钟';
}

function shanghaiDayIndex(ms: number): number {
  return Math.floor((ms + SHANGHAI_OFFSET_MS) / DAY_MS);
}

function daysUntil(beginMs: number, nowMs: number): string {
  return `${Math.max(0, shanghaiDayIndex(beginMs) - shanghaiDayIndex(nowMs))} 天后`;
}

function attendanceLabel(status: SetStatus, count: number): string {
  if (status === 'upcoming' && count === 0) return NOT_STARTED;
  return `${count} 人参加`;
}

function groupLabel(names: readonly string[]): string {
  if (names.length === 0) return '全站可见';
  return names.join('、');
}

function chapterLabel(row: TeachCourseRow): string {
  return `${row.chapterCount} 章 · ${row.videoCount} 个视频`;
}

function runningEnd(item: HomeSetRow): number {
  if (item.endMs === null) throw new TypeError(`teacher_home_end_missing:${item.row.id}`);
  return item.endMs;
}

function listedSets(running: Load<HomeSetList>, upcoming: Load<HomeSetList>): HomeSetRow[] {
  const rows: HomeSetRow[] = [];
  if (running.status === 'ready') rows.push(...running.data.rows);
  if (upcoming.status === 'ready') rows.push(...upcoming.data.rows);
  return rows.slice(0, SET_LIMIT);
}

function ProblemSearch({ problemsUrl }: { problemsUrl: string }) {
  const [query, setQuery] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const keyword = query.trim();
    window.location.assign(keyword === '' ? problemsUrl : `${problemsUrl}?q=${encodeURIComponent(keyword)}`);
  };
  return (
    <Panel title="快速搜索">
      <form className="flex min-w-0 flex-wrap gap-2" onSubmit={submit}>
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="题号或标题…"
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="secondary" size="sm" className="shrink-0">
          搜索
        </Button>
      </form>
    </Panel>
  );
}

function SetLink({ item, now }: { item: HomeSetRow; now: number }) {
  const { row } = item;
  if (row.status !== 'running' && row.status !== 'upcoming') {
    throw new TypeError(`teacher_home_status_invalid:${row.id}`);
  }
  const running = row.status === 'running';
  const when = running ? shanghaiStamp(runningEnd(item), '截止') : shanghaiStamp(item.beginMs, '开始');
  const extra = running ? remainingText(runningEnd(item), now) : daysUntil(item.beginMs, now);
  return (
    <a
      href={teachPath(row.type, row.id)}
      className="grid min-w-0 grid-cols-1 gap-y-1 px-4 py-3 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring 3xl:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] 3xl:items-center 3xl:gap-x-4"
    >
      <span className="flex min-w-0 items-center gap-2 3xl:contents">
        <span className="inline-flex shrink-0 items-center gap-2">
          <span className="inline-flex" aria-label={running ? '进行中' : '未开始'}>
            <StatusDot tone={running ? 'success' : 'neutral'} pulse={running} />
          </span>
          <Badge variant="outline" tone="neutral" size="sm">{teachSetTypeLabel(row.type, row.rule)}</Badge>
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{row.title}</span>
      </span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-sm text-fg-muted 3xl:contents">
        <span className="shrink-0 tabular">{when}</span>
        <span className="shrink-0 tabular">{extra}</span>
        <span className="ml-auto shrink-0 font-medium tabular text-fg 3xl:ml-0">{attendanceLabel(row.status, row.participantCount)}</span>
      </span>
    </a>
  );
}

function SetsPanel({ running, upcoming, now }: { running: Load<HomeSetList>; upcoming: Load<HomeSetList>; now: number }) {
  const messages = [running, upcoming].flatMap((state) => (state.status === 'error' ? [state.message] : []));
  const rows = listedSets(running, upcoming);
  const loading = (running.status === 'loading' || upcoming.status === 'loading') && rows.length === 0 && messages.length === 0;
  const empty = running.status === 'ready' && upcoming.status === 'ready' && rows.length === 0;
  return (
    <Panel
      title="我的题目集"
      description="进行中和即将开始的，我是所有者或协作者"
      flush={rows.length > 0}
      actions={(
        <Button asChild variant="ghost" size="sm">
          <a href="/teach">
            全部
            <ChevronRight />
          </a>
        </Button>
      )}
    >
      {messages.map((message) => (
        <div key={message} className={rows.length > 0 ? 'p-4' : undefined}>
          <Alert tone="danger">{message}</Alert>
        </div>
      ))}
      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : null}
      {empty ? (
        <EmptyState
          compact
          title="没有进行中或即将开始的题目集"
          description="新建一份作业或考试，布置给你的用户组。"
          action={(
            <Button asChild variant="link" size="sm">
              <a href="/teach/new">新建</a>
            </Button>
          )}
        />
      ) : null}
      {rows.length > 0 ? (
        <div className="divide-y divide-line-subtle">
          {rows.map((item) => <SetLink key={`${item.row.type}:${item.row.id}`} item={item} now={now} />)}
        </div>
      ) : null}
    </Panel>
  );
}

function CourseLink({ row }: { row: TeachCourseRow }) {
  return (
    <a
      href={`/course/${row.id}/edit`}
      className="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-fg">{row.title}</span>
          {row.hidden ? <Badge size="sm" className="shrink-0">已隐藏</Badge> : null}
        </span>
        <span className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-3 text-sm text-fg-muted">
          <span className="min-w-0 truncate">{groupLabel(row.groupNames)}</span>
          <span className="shrink-0 tabular">{chapterLabel(row)}</span>
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-fg-subtle" />
    </a>
  );
}

function CoursesPanel({ courses }: { courses: Load<TeachCourseListPayload> }) {
  const rows = courses.status === 'ready' ? courses.data.rows.slice(0, COURSE_LIMIT) : [];
  return (
    <Panel
      title="我的课程"
      description="我拥有或维护的课程"
      flush={rows.length > 0}
      actions={(
        <Button asChild variant="ghost" size="sm">
          <a href="/teach/courses">
            全部
            <ChevronRight />
          </a>
        </Button>
      )}
    >
      {courses.status === 'error' ? <Alert tone="danger">{courses.message}</Alert> : null}
      {courses.status === 'loading' ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : null}
      {courses.status === 'ready' && rows.length === 0 ? (
        <EmptyState compact title="还没有课程" description="在「教学 › 课程」里新建。" />
      ) : null}
      {rows.length > 0 ? (
        <div className="divide-y divide-line-subtle">
          {rows.map((row) => <CourseLink key={row.id} row={row} />)}
        </div>
      ) : null}
    </Panel>
  );
}

export function TeacherHomePage() {
  const bs = useBootstrap();
  const now = useExamNow(bs.generatedAt);
  const running = useSetList('running');
  const upcoming = useSetList('upcoming');
  const courses = useTeacherJson(COURSES_PATH, COURSES_FAILED, parseTeachCourseListPayload);
  const showSearch = bs.user.canBrowseProblemBank === true;

  return (
    <Page>
      <PageHeader
        title={bs.domain.name}
        actions={(
          <Button asChild variant="primary">
            <a href="/teach/new">
              <Plus />
              新建题目集
            </a>
          </Button>
        )}
      />
      <AnnouncementHomeBlock />
      <Panel>
        <div className="grid grid-cols-3 gap-4">
          <Stat label="进行中" value={countMark(running, running.status === 'ready' ? running.data.total : 0)} />
          <Stat label="即将开始" value={countMark(upcoming, upcoming.status === 'ready' ? upcoming.data.total : 0)} />
          <Stat label="我的课程" value={countMark(courses, courses.status === 'ready' ? courses.data.rows.length : 0)} />
        </div>
      </Panel>
      {showSearch ? <ProblemSearch problemsUrl={bs.urls.problems} /> : null}
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SetsPanel running={running} upcoming={upcoming} now={now} />
        <CoursesPanel courses={courses} />
      </div>
    </Page>
  );
}
