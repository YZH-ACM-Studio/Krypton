import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Calendar, Compass, MessageSquare } from 'lucide-react';
import { AnnouncementHomeBlock } from '@/components/announcement-home-block';
import { CollectHomeBlock } from '@/components/collect-home-block';
import { MarkdownView } from '@/components/markdown-renderer';
import { Alert } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { useExamNow } from '@/lib/exam-server-clock';
import { makeInitials, replaceRouteTokens } from '@/lib/format';
import {
  parseStudentCalendar,
  parseStudentSets,
  schoolWeekStart,
  studentCalendarUrl,
  studentSetRowView,
  type ContestRow,
  type RowView,
  type StudentSetRow,
} from '@/pages/problem-sets/model';
import { getJson } from '@/pages/teach/api';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const PRACTICE_LIMIT = 5;
const UPCOMING_LIMIT = 3;
const RUNNING_FAILED = '进行中的题目集暂时不能查看。';
const UPCOMING_FAILED = '即将开始的题目集暂时不能查看。';
const CALENDAR_FAILED = '本周安排暂时不能查看。';
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

type PracticeTab = 'recent' | 'starred';

interface ProblemRef {
  docId: string;
  title: string;
}

interface ShanghaiParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

interface WeekEvent {
  key: string;
  text: string;
  sortMs: number;
  done: boolean;
  warn: boolean;
}

type Load<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function visibleError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function instant(iso: string, label: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new TypeError(`${label} is not a timestamp`);
  return ms;
}

function shanghaiParts(ms: number): ShanghaiParts {
  const shifted = new Date(ms + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

function weekdayName(index: number): string {
  const name = WEEKDAYS[index];
  if (name === undefined) throw new TypeError(`weekday out of range: ${index}`);
  return name;
}

function shanghaiMidnight(ms: number): number {
  const parts = shanghaiParts(ms);
  return Date.UTC(parts.year, parts.month - 1, parts.day) - SHANGHAI_OFFSET_MS;
}

function clockOf(ms: number): string {
  const parts = shanghaiParts(ms);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

function relativeDay(target: number, now: number): string {
  const diff = Math.round((shanghaiMidnight(target) - shanghaiMidnight(now)) / DAY_MS);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  if (diff === -1) return '昨天';
  if (diff === -2) return '前天';
  const parts = shanghaiParts(target);
  return `${parts.month}月${parts.day}日 ${weekdayName(parts.weekday)}`;
}

function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 11) return '上午好';
  if (hour >= 11 && hour < 13) return '中午好';
  if (hour >= 13 && hour < 18) return '下午好';
  return '晚上好';
}

function remainLabel(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe >= DAY_MS) {
    const days = Math.floor(safe / DAY_MS);
    const hours = Math.floor((safe - days * DAY_MS) / HOUR_MS);
    return `${days} 天 ${hours} 小时`;
  }
  const total = Math.floor(safe / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
}

function isContest(row: StudentSetRow): row is ContestRow {
  return row.kind === 'exam' || row.kind === 'homework';
}

function deadlineIso(row: ContestRow): string {
  return row.personalEndAt ?? row.dueAt ?? row.endAt;
}

function byDeadline(left: ContestRow, right: ContestRow): number {
  const delta = instant(deadlineIso(left), left.id) - instant(deadlineIso(right), right.id);
  if (delta !== 0) return delta;
  return left.id.localeCompare(right.id);
}

function unfinishedContests(rows: readonly StudentSetRow[]): ContestRow[] {
  return rows.filter((row): row is ContestRow => isContest(row) && row.done === false).sort(byDeadline);
}

function isLive(row: ContestRow, now: number): boolean {
  if (row.done !== false) return false;
  const begin = instant(row.beginAt, `${row.id} begin`);
  const end = instant(row.personalEndAt ?? row.endAt, `${row.id} end`);
  return begin <= now && now < end;
}

function mergeRunning(running: readonly ContestRow[], upcoming: readonly ContestRow[], now: number): ContestRow[] {
  const seen = new Set<string>();
  const merged: ContestRow[] = [];
  for (const row of [...running, ...upcoming]) {
    if (seen.has(row.id) || !isLive(row, now)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  merged.sort(byDeadline);
  return merged;
}

function upcomingWithinWeek(rows: readonly ContestRow[], now: number): ContestRow[] {
  return rows.flatMap((row) => {
    const begin = instant(row.beginAt, `${row.id} begin`);
    const end = instant(row.endAt, `${row.id} end`);
    if (begin - now >= WEEK_MS || now >= end || now >= begin) return [];
    return [{ row, begin }];
  }).sort((left, right) => left.begin - right.begin || left.row.id.localeCompare(right.row.id))
    .slice(0, UPCOMING_LIMIT)
    .map((item) => item.row);
}

function eventsOnDay(rows: readonly ContestRow[], dayStart: number, dayEnd: number, now: number): WeekEvent[] {
  const events: WeekEvent[] = [];
  for (const row of rows) {
    if (row.kind === 'homework') {
      const at = instant(deadlineIso(row), `${row.id} deadline`);
      if (at < dayStart || at >= dayEnd) continue;
      const remain = at - now;
      events.push({
        key: `deadline:${row.id}`,
        text: `截止 ${row.title}`,
        sortMs: at,
        done: row.done,
        warn: !row.done && remain > 0 && remain <= DAY_MS,
      });
      continue;
    }
    const at = instant(row.beginAt, `${row.id} begin`);
    if (at < dayStart || at >= dayEnd) continue;
    events.push({
      key: `start:${row.id}`,
      text: `${clockOf(at)} ${row.title}`,
      sortMs: at,
      done: row.done,
      warn: false,
    });
  }
  events.sort((left, right) => left.sortMs - right.sortMs || left.text.localeCompare(right.text, 'zh-CN'));
  return events;
}

function requireAction(row: ContestRow, view: RowView): NonNullable<RowView['action']> {
  if (view.action === null) throw new TypeError(`student home row ${row.id} has no action`);
  return view.action;
}

function answeredMeter(row: ContestRow): { text: string; percent: number } | null {
  const progress = row.progress;
  if (progress === null || !('answered' in progress)) return null;
  const percent = row.problemCount > 0 ? Math.round((progress.answered / row.problemCount) * 100) : 0;
  return { text: `已答 ${progress.answered} / ${row.problemCount} 题`, percent };
}

function readProblemRefs(value: unknown, label: string): ProblemRef[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value.map((item, index) => {
    if (!isRecord(item)) throw new TypeError(`${label}[${index}] must be an object`);
    const docId = item.docId;
    if (typeof docId !== 'string' && typeof docId !== 'number') {
      throw new TypeError(`${label}[${index}].docId must be a string or number`);
    }
    if (item.title !== undefined && typeof item.title !== 'string') {
      throw new TypeError(`${label}[${index}].title must be a string`);
    }
    return { docId: String(docId), title: typeof item.title === 'string' ? item.title : '' };
  });
}

function readHomeSections(data: unknown): { sections: Map<string, unknown>; errors: string[] } {
  const sections = new Map<string, unknown>();
  const errors: string[] = [];
  if (!isRecord(data) || data.contents === undefined) return { sections, errors };
  if (!Array.isArray(data.contents)) throw new TypeError('home contents must be an array');
  for (const column of data.contents) {
    if (!isRecord(column) || !Array.isArray(column.sections)) throw new TypeError('home column sections must be an array');
    for (const section of column.sections) {
      if (!Array.isArray(section) || typeof section[0] !== 'string') throw new TypeError('home section must be a tuple');
      if (section[0] === 'error') {
        if (typeof section[1] !== 'string') throw new TypeError('home error section must be a string');
        errors.push(section[1]);
        continue;
      }
      sections.set(section[0], section[1]);
    }
  }
  return { sections, errors };
}

function readProblemSection(sections: Map<string, unknown>, key: string): ProblemRef[] | null {
  if (!sections.has(key)) return null;
  const value = sections.get(key);
  if (!Array.isArray(value)) throw new TypeError(`${key} must be a tuple`);
  return readProblemRefs(value[0], key);
}

function SetLinks({ setsUrl }: { setsUrl: string }) {
  return (
    <>
      <Button asChild variant="ghost" size="sm">
        <a href={`${setsUrl}#calendar`}>
          <Calendar />
          日历
        </a>
      </Button>
      <Button asChild variant="ghost" size="sm">
        <a href={setsUrl}>
          全部题目集
          <ArrowRight />
        </a>
      </Button>
    </>
  );
}

function RemainText({ ms, warn }: { ms: number; warn: boolean }) {
  return (
    <p className={cn('font-mono text-3xl font-semibold tracking-tight tabular', warn && 'text-warning-fg')}>
      {remainLabel(ms)}
    </p>
  );
}

function FocusCard({ row, now }: { row: ContestRow; now: number }) {
  const view = studentSetRowView(row, now);
  const action = requireAction(row, view);
  const deadline = instant(deadlineIso(row), `${row.id} deadline`);
  const remain = deadline - now;
  const urgent = remain > 0 && remain <= DAY_MS;
  const answered = answeredMeter(row);
  const progressText = answered?.text ?? view.progress?.text ?? '';
  const percent = answered?.percent ?? (view.progress?.ratio == null ? null : Math.round(view.progress.ratio * 100));
  return (
    <div className={cn('flex min-w-0 flex-col gap-3 rounded-lg border p-4', urgent ? 'border-warning-line' : 'border-line')}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral" size="sm">{view.typeLabel}</Badge>
        {urgent
          ? <Badge tone="warning" size="sm">24 小时内截止</Badge>
          : <Badge tone="success" size="sm" dot>进行中</Badge>}
      </div>
      <p className="min-w-0 text-xl font-semibold tracking-tight text-fg">{row.title}</p>
      <div>
        <RemainText ms={remain} warn={urgent} />
        <p className="text-sm text-fg-muted">{`后截止 · ${relativeDay(deadline, now)} ${clockOf(deadline)}`}</p>
      </div>
      {progressText === '' ? null : (
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-sm text-fg-muted">{progressText}</p>
          {percent === null ? null : <Progress value={percent} tone={urgent ? 'warning' : 'brand'} size="sm" />}
        </div>
      )}
      <div>
        <Button asChild variant="primary">
          <a href={action.href}>{action.label}</a>
        </Button>
      </div>
    </div>
  );
}

function EmptyFocus({
  next,
  blocked,
  now,
  setsUrl,
}: {
  next: ContestRow | null;
  blocked: boolean;
  now: number;
  setsUrl: string;
}) {
  const begin = next === null ? null : instant(next.beginAt, `${next.id} begin`);
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-line p-4">
      <p className="text-md font-medium text-fg">现在没有进行中的作业和考试</p>
      {blocked || begin === null || next === null ? (
        blocked ? null : <p className="text-sm text-fg-muted">近一周没有安排。</p>
      ) : (
        <>
          <p className="text-sm text-fg-muted">{`下一项是「${next.title}」，${relativeDay(begin, now)} ${clockOf(begin)} 开始。`}</p>
          <RemainText ms={begin - now} warn={begin - now > 0 && begin - now <= DAY_MS} />
          <p className="text-sm text-fg-muted">后开始</p>
        </>
      )}
      <div>
        <Button asChild variant="secondary">
          <a href={setsUrl}>
            去练习
            <ArrowRight />
          </a>
        </Button>
      </div>
    </div>
  );
}

function SideRow({ row, now }: { row: ContestRow; now: number }) {
  const view = studentSetRowView(row, now);
  const action = requireAction(row, view);
  const begin = instant(row.beginAt, `${row.id} begin`);
  const when = now < begin
    ? `${relativeDay(begin, now)} ${clockOf(begin)} 开始`
    : `截止 ${relativeDay(instant(deadlineIso(row), `${row.id} deadline`), now)} ${clockOf(instant(deadlineIso(row), `${row.id} deadline`))}`;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-2">
      <Badge tone="neutral" size="sm" className="shrink-0">{view.typeLabel}</Badge>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.title}</span>
      <span className="shrink-0 text-xs text-fg-subtle">{when}</span>
      <Button asChild variant={action.variant} size="sm">
        <a href={action.href}>{action.label}</a>
      </Button>
    </div>
  );
}

function SideList({ title, rows, now }: { title: string; rows: readonly ContestRow[]; now: number }) {
  if (rows.length === 0) return null;
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-fg-subtle">{title}</p>
      <div className="divide-y divide-line-subtle">
        {rows.map((row) => <SideRow key={`${row.kind}:${row.id}`} row={row} now={now} />)}
      </div>
    </div>
  );
}

function WeekStrip({ rows, now, setsUrl }: { rows: readonly ContestRow[]; now: number; setsUrl: string }) {
  const start = schoolWeekStart(now);
  const today = shanghaiParts(now);
  const days = Array.from({ length: 7 }, (_, index) => {
    const at = start + index * DAY_MS;
    const parts = shanghaiParts(at);
    const isToday = parts.year === today.year && parts.month === today.month && parts.day === today.day;
    const events = eventsOnDay(rows, at, at + DAY_MS, now);
    return {
      at,
      parts,
      isToday,
      events,
      name: isToday ? '今天' : weekdayName(parts.weekday),
    };
  });
  return (
    <div className="grid grid-cols-7 gap-1 border-t border-line-subtle pt-3" aria-label="本周">
      {days.map((day) => {
        const summary = day.events.map((event) => event.text).join(' ');
        return (
          <a
            key={day.at}
            href={setsUrl}
            aria-label={`${day.name} ${day.parts.day}${summary === '' ? '' : ` ${summary}`}`}
            className={cn(
              'flex min-h-11 min-w-0 flex-col gap-1 rounded-md px-1 py-1.5 text-xs hover:bg-surface-hover',
              day.isToday && 'bg-brand-soft',
            )}
          >
            <span className="text-fg-subtle">{day.name}</span>
            <span className="font-medium text-fg tabular">{day.parts.day}</span>
            <span className="hidden min-w-0 sm:flex sm:flex-col sm:gap-0.5">
              {day.events.map((event) => (
                <span
                  key={event.key}
                  className={cn(
                    'truncate',
                    event.done ? 'text-fg-subtle line-through' : event.warn ? 'text-warning-fg' : 'text-fg-muted',
                  )}
                >
                  {event.text}
                </span>
              ))}
            </span>
            <span className="flex gap-0.5 sm:hidden" aria-hidden="true">
              {day.events.map((event) => (
                <span
                  key={event.key}
                  className={cn('size-1.5 rounded-full', event.done ? 'bg-fg-subtle' : event.warn ? 'bg-warning' : 'bg-brand')}
                />
              ))}
            </span>
          </a>
        );
      })}
    </div>
  );
}

function InProgressPanel({
  now,
  setsUrl,
  running,
  upcoming,
  calendar,
}: {
  now: number;
  setsUrl: string;
  running: Load<ContestRow[]>;
  upcoming: Load<ContestRow[]>;
  calendar: Load<ContestRow[]>;
}) {
  if (running.status === 'loading' && upcoming.status === 'loading' && calendar.status === 'loading') return null;
  const upcomingRows = upcoming.status === 'ready' ? upcoming.data : [];
  const focus = running.status === 'ready' ? running.data[0] ?? null : null;
  const rest = running.status === 'ready' ? running.data.slice(1) : [];
  const showMain = running.status !== 'loading' || upcoming.status !== 'loading';
  const sideEmpty = running.status === 'ready'
    && rest.length === 0
    && upcoming.status === 'ready'
    && upcomingRows.length === 0;
  return (
    <Panel
      title={running.status === 'ready' ? `正在进行 ${running.data.length} 项` : '正在进行'}
      actions={<SetLinks setsUrl={setsUrl} />}
    >
      {showMain ? (
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="min-w-0">
            {running.status === 'error' ? <Alert tone="danger">{running.message}</Alert> : null}
            {running.status === 'ready' && focus !== null ? <FocusCard row={focus} now={now} /> : null}
            {running.status === 'ready' && focus === null && upcoming.status !== 'loading' ? (
              <EmptyFocus
                next={upcoming.status === 'ready' ? upcomingRows[0] ?? null : null}
                blocked={upcoming.status === 'error'}
                now={now}
                setsUrl={setsUrl}
              />
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            {upcoming.status === 'error' ? <Alert tone="danger">{upcoming.message}</Alert> : null}
            {sideEmpty ? <p className="text-sm text-fg-muted">近一周没有其它安排</p> : null}
            {running.status === 'ready' ? <SideList title="也在进行" rows={rest} now={now} /> : null}
            {upcoming.status === 'ready' ? <SideList title="即将开始" rows={upcomingRows} now={now} /> : null}
          </div>
        </div>
      ) : null}
      {calendar.status === 'error' ? <Alert tone="danger">{calendar.message}</Alert> : null}
      {calendar.status === 'ready' ? <WeekStrip rows={calendar.data} now={now} setsUrl={setsUrl} /> : null}
    </Panel>
  );
}

function GuestPrompt({ login, register }: { login: string; register: string }) {
  return (
    <Panel title="登录后，这里显示你的作业和考试">
      <div className="flex min-w-0 flex-col gap-4">
        <p className="text-sm text-fg-muted">进行中的题目集、截止倒计时和本周日程都在这里。</p>
        <div className="flex gap-2">
          <Button asChild variant="primary" size="sm">
            <a href={login}>登录</a>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <a href={register}>注册</a>
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function problemHref(template: string, docId: string): string {
  return replaceRouteTokens(template, { PID: docId });
}

function PracticeList({ problems, detailUrl }: { problems: readonly ProblemRef[]; detailUrl: string }) {
  if (problems.length === 0) return <EmptyState compact title="没有题目" />;
  return (
    <div className="flex min-w-0 flex-col">
      {problems.map((problem) => (
        <a
          key={problem.docId}
          className="flex min-h-11 min-w-0 items-center rounded-md px-2 py-1.5 text-sm hover:bg-surface-hover sm:min-h-0"
          href={problemHref(detailUrl, problem.docId)}
        >
          <span className="min-w-0 flex-1 truncate">{problem.docId}. {problem.title || '未命名'}</span>
        </a>
      ))}
    </div>
  );
}

export function StudentHomePage() {
  const bs = useBootstrap();
  const now = useExamNow(bs.generatedAt);
  const signedIn = bs.user.signedIn;
  const canSearch = bs.user.canBrowseProblemBank === true;
  const parts = shanghaiParts(now);
  const dateText = `${parts.month}月${parts.day}日 ${weekdayName(parts.weekday)}`;
  const meta = signedIn ? `${greetingFor(parts.hour)}，${bs.user.name} · ${dateText}` : dateText;
  const setsUrl = bs.urls.training;
  const weekStart = schoolWeekStart(now);
  const domainId = bs.domain.id;
  const { sections, errors: sectionErrors } = readHomeSections(bs.page.data);
  const recent = readProblemSection(sections, 'recent_problems');
  const starred = readProblemSection(sections, 'starred_problems');
  const [practiceTab, setPracticeTab] = useState<PracticeTab>('recent');
  const [query, setQuery] = useState('');
  const [running, setRunning] = useState<Load<ContestRow[]>>({ status: 'loading' });
  const [upcomingLoad, setUpcomingLoad] = useState<Load<ContestRow[]>>({ status: 'loading' });
  const [calendar, setCalendar] = useState<Load<ContestRow[]>>({ status: 'loading' });

  useEffect(() => {
    if (!signedIn) return undefined;
    let cancelled = false;
    const fail = (stage: string, error: unknown, fallback: string, set: (next: Load<ContestRow[]>) => void) => {
      if (cancelled) return;
      console.error('[student-home] request failed', { domainId, stage, error });
      set({ status: 'error', message: visibleError(error, fallback) });
    };
    getJson('/problem-sets?tab=running', RUNNING_FAILED).then((raw) => {
      if (cancelled) return;
      setRunning({ status: 'ready', data: unfinishedContests(parseStudentSets(raw).rows) });
    }).catch((error: unknown) => fail('running', error, RUNNING_FAILED, setRunning));
    getJson('/problem-sets?tab=upcoming', UPCOMING_FAILED).then((raw) => {
      if (cancelled) return;
      setUpcomingLoad({ status: 'ready', data: parseStudentSets(raw).rows.filter(isContest) });
    }).catch((error: unknown) => fail('upcoming', error, UPCOMING_FAILED, setUpcomingLoad));
    getJson(studentCalendarUrl(weekStart, weekStart + WEEK_MS), CALENDAR_FAILED).then((raw) => {
      if (cancelled) return;
      setCalendar({ status: 'ready', data: parseStudentCalendar(raw).rows });
    }).catch((error: unknown) => fail('calendar', error, CALENDAR_FAILED, setCalendar));
    return () => {
      cancelled = true;
    };
  }, [signedIn, domainId, weekStart]);

  const upcomingRows = upcomingLoad.status === 'ready' ? upcomingWithinWeek(upcomingLoad.data, now) : [];
  const upcoming: Load<ContestRow[]> = upcomingLoad.status === 'ready'
    ? { status: 'ready', data: upcomingRows }
    : upcomingLoad;
  const runningView: Load<ContestRow[]> = running.status === 'ready'
    ? { status: 'ready', data: mergeRunning(running.data, upcomingLoad.status === 'ready' ? upcomingLoad.data : [], now) }
    : running;

  const keyword = query.trim().toLowerCase();
  const practiceRecord = practiceTab === 'recent' ? recent : starred;
  const practiceSource = practiceRecord ?? [];
  const practiceRows = (keyword === ''
    ? practiceSource
    : practiceSource.filter((problem) => problem.docId.toLowerCase().includes(keyword) || problem.title.toLowerCase().includes(keyword))
  ).slice(0, PRACTICE_LIMIT);
  const practiceEmpty = keyword === ''
    ? (practiceTab === 'recent' ? '还没有最近做过的题' : '还没有收藏的题')
    : '没有匹配的题目';

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const kw = query.trim();
    window.location.assign(kw === '' ? bs.urls.problems : `${bs.urls.problems}?q=${encodeURIComponent(kw)}`);
  };

  let practiceBody: ReactNode;
  if (!signedIn) {
    practiceBody = <p className="text-sm text-fg-muted">登录后显示最近做过和收藏的题。</p>;
  } else if (practiceRecord === null && sectionErrors.length > 0) {
    practiceBody = (
      <Alert tone="danger">
        {sectionErrors.map((message, index) => (
          <p key={`${index}:${message}`}>{message}</p>
        ))}
      </Alert>
    );
  } else if (practiceRows.length === 0) {
    practiceBody = <EmptyState compact title={practiceEmpty} />;
  } else {
    practiceBody = <PracticeList problems={practiceRows} detailUrl={bs.urls.problemDetail} />;
  }

  return (
    <Page width="wide">
      <PageHeader
        title={bs.domain.name}
        meta={meta}
        actions={canSearch ? (
          <Button asChild variant="secondary">
            <a href={bs.urls.problems}>
              开始刷题
              <ArrowRight />
            </a>
          </Button>
        ) : undefined}
      />

      {signedIn
        ? <InProgressPanel now={now} setsUrl={setsUrl} running={runningView} upcoming={upcoming} calendar={calendar} />
        : <GuestPrompt login={bs.urls.login} register={bs.urls.register} />}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel
          title="继续练题"
          actions={signedIn ? (
            <MiniTabs
              aria-label="练题记录"
              value={practiceTab}
              onValueChange={setPracticeTab}
              items={[{ value: 'recent', label: '最近' }, { value: 'starred', label: '收藏' }]}
            />
          ) : undefined}
        >
          <div className="flex min-w-0 flex-col gap-3">
            {canSearch ? (
              <form className="flex min-w-0 flex-wrap gap-2" onSubmit={submitSearch}>
                <SearchInput
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="题号或标题…"
                  aria-label="题号或标题"
                  className="min-w-0 flex-1"
                />
                <Button type="submit" variant="secondary" size="sm" className="shrink-0">
                  搜索
                </Button>
              </form>
            ) : null}
            {practiceBody}
          </div>
        </Panel>
        <div className="flex min-w-0 flex-col gap-4">
          {signedIn ? (
            <Panel title="个人">
              <div className="flex min-w-0 flex-col gap-3">
                <div className="flex items-center gap-3">
                  <Avatar>
                    {bs.user.avatarUrl ? <AvatarImage src={bs.user.avatarUrl} alt={bs.user.name} /> : null}
                    <AvatarFallback>{makeInitials(bs.user.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{bs.user.name}</p>
                    <p className="text-xs text-fg-subtle tabular">{bs.user.unreadMessages} 条未读</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button asChild variant="secondary" size="sm" className="flex-1">
                    <a href={bs.urls.messages}>
                      <MessageSquare />
                      消息
                    </a>
                  </Button>
                  <Button asChild variant="secondary" size="sm" className="flex-1">
                    <a href={bs.urls.domains}>
                      <Compass />
                      域
                    </a>
                  </Button>
                </div>
              </div>
            </Panel>
          ) : null}
          {signedIn ? <CollectHomeBlock /> : null}
        </div>
      </div>

      <AnnouncementHomeBlock />
      {bs.domain.bulletin ? (
        <div className="max-w-prose text-sm text-fg-muted">
          <MarkdownView content={bs.domain.bulletin} />
        </div>
      ) : null}
    </Page>
  );
}
