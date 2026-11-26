// A static import fails collection while src/pages/problem-sets/calendar-view.tsx is absent.
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap, type KryptonUrls, type KryptonUser } from '../../src/lib/bootstrap.tsx';
import { calendarHeadline, monthGrid } from '../../src/pages/problem-sets/calendar-layout.ts';
import { StudentHomePage } from '../../src/pages/home/student-home.tsx';
import { schoolWeekStart, studentCalendarUrl, type ContestRow } from '../../src/pages/problem-sets/model.ts';

const viewLoaders = import.meta.glob('../../src/pages/problem-sets/calendar-view.tsx');
const VIEW_SOURCE = 'src/pages/problem-sets/calendar-view.tsx';

const GENERATED_AT = '2026-10-21T06:32:00.000Z';
const SERVER_NOW = Date.parse(GENERATED_AT);
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const CHAPTER_TITLE = '第三章';
const CALENDAR_ERROR = '日历暂时打不开。';
const FOOTER = '练习没有时间，不在日历里；去「列表 › 练习」查看。组队没有时间，留在「列表 › 进行中」置顶。';
const LEGEND = ['进行中', '24 小时内截止', '未开始', '已结束'] as const;
const PREVIOUS = '\u2039';
const NEXT = '\u203A';

const calls: URL[] = [];
let failAt: number | null = null;
let rowsForCall: (call: number) => readonly ContestRow[] = () => [chapterRow()];
let user = userEvent.setup();
const originalMatchMedia = window.matchMedia;

type CalendarViewComponent = (props: { endpoint?: string; teacher?: boolean }) => ReactElement;

function readField(record: object, key: string): unknown {
  if (!Object.hasOwn(record, key)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function viewLoader(): (() => Promise<unknown>) | undefined {
  const load = Object.values(viewLoaders).find((item) => typeof item === 'function');
  if (typeof load !== 'function') return undefined;
  return load as () => Promise<unknown>;
}

async function loadCalendarView(): Promise<CalendarViewComponent> {
  const load = viewLoader();
  expect(typeof load, `${VIEW_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${VIEW_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${VIEW_SOURCE} must be a module`);
  const component = readField(imported, 'CalendarView');
  expect(typeof component, 'CalendarView').toBe('function');
  if (typeof component !== 'function') throw new TypeError('CalendarView must be a function');
  return component as CalendarViewComponent;
}

function chapterRow(): ContestRow {
  return {
    kind: 'homework',
    id: 'chapter-3',
    flavor: 'homework',
    title: CHAPTER_TITLE,
    href: '/homework/chapter-3',
    beginAt: '2026-10-20T00:00:00.000Z',
    endAt: '2026-10-22T04:00:00.000Z',
    dueAt: null,
    durationMinutes: null,
    startAt: null,
    personalEndAt: null,
    attended: true,
    clientRequired: false,
    team: false,
    problemCount: 6,
    progress: { answered: 1 },
    finalized: false,
    done: false,
  };
}

function weekBounds(offset: number): { from: number; to: number } {
  const from = schoolWeekStart(SERVER_NOW) + offset * WEEK_MS;
  return { from, to: from + WEEK_MS };
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, 'http://krypton.local');
  if (input instanceof URL) return input;
  return new URL(input.url, 'http://krypton.local');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function hydroError(message: string, status: number): Response {
  return jsonResponse({
    error: {
      name: 'InternalError',
      errorCode: 'InternalError',
      code: status,
      status,
      params: [],
      message,
    },
  }, status);
}

function boundText(url: URL, key: 'from' | 'to'): string {
  const value = url.searchParams.get(key);
  if (value === null) throw new TypeError(`calendar request is missing ${key}`);
  return value;
}

function callAt(index: number): URL {
  const url = calls[index];
  if (!(url instanceof URL)) throw new TypeError(`missing calendar request ${index + 1}`);
  return url;
}

function expectCalendarUrl(url: URL, fromMs: number, toMs: number): void {
  const expected = new URL(studentCalendarUrl(fromMs, toMs), 'http://krypton.local');
  expect(url.pathname).toBe('/problem-sets');
  expect(url.searchParams.get('view')).toBe('calendar');
  expect(url.searchParams.get('from')).toBe(expected.searchParams.get('from'));
  expect(url.searchParams.get('to')).toBe(expected.searchParams.get('to'));
}

function pageText(): string {
  return document.body.textContent ?? '';
}

function expectRemaining(count: number | null): void {
  const body = pageText();
  if (count === null) {
    expect(body).not.toMatch(/还有\s*\d+\s*项没完成/);
    return;
  }
  expect(body).toMatch(new RegExp(`还有\\s*${count}\\s*项没完成`));
}

function mediaMatches(query: string, width: number): boolean {
  const minWidth = /\(min-width:\s*(\d+)px\)/.exec(query);
  const minText = minWidth?.[1];
  if (minText !== undefined) return width >= Number(minText);
  const maxWidth = /\(max-width:\s*(\d+)px\)/.exec(query);
  const maxText = maxWidth?.[1];
  if (maxText !== undefined) return width <= Number(maxText);
  return false;
}

type MediaChange = (event: MediaQueryListEvent) => void;

interface LiveMediaQuery {
  matches: boolean;
  listeners: Set<MediaChange>;
}

const SM_QUERY = '(min-width: 640px)';
const mediaQueries = new Map<string, LiveMediaQuery>();
let viewportWidth = 1280;

function liveMediaQuery(query: string): LiveMediaQuery {
  const matches = mediaMatches(query, viewportWidth);
  const existing = mediaQueries.get(query);
  if (existing) {
    existing.matches = matches;
    return existing;
  }
  const created: LiveMediaQuery = { matches, listeners: new Set() };
  mediaQueries.set(query, created);
  return created;
}

function rememberMediaChange(live: LiveMediaQuery, listener: EventListenerOrEventListenerObject | null): void {
  if (typeof listener !== 'function') return;
  live.listeners.add(listener as MediaChange);
}

function forgetMediaChange(live: LiveMediaQuery, listener: EventListenerOrEventListenerObject | null): void {
  if (typeof listener !== 'function') return;
  live.listeners.delete(listener as MediaChange);
}

// setup.ts reports every media query as unmatched, so useBreakpoint('sm') stays false until this runs.
function installViewport(width: number): void {
  viewportWidth = width;
  mediaQueries.clear();
  window.matchMedia = ((query: string) => {
    const live = liveMediaQuery(query);
    return {
      get matches() {
        return live.matches;
      },
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
        rememberMediaChange(live, listener);
      },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
        forgetMediaChange(live, listener);
      },
      dispatchEvent: vi.fn(() => false),
    };
  }) as unknown as typeof window.matchMedia;
}

// useBreakpoint keeps the list it subscribed at mount. Replacing matchMedia does not emit change.
async function narrowBelowSm(): Promise<void> {
  const live = mediaQueries.get(SM_QUERY);
  if (live === undefined || live.listeners.size === 0) {
    throw new TypeError(`no change listener registered for ${SM_QUERY}`);
  }
  viewportWidth = 500;
  live.matches = false;
  const event = { matches: false, media: SM_QUERY } as MediaQueryListEvent;
  const listeners = [...live.listeners];
  await act(async () => {
    for (const listener of listeners) listener(event);
  });
}

function installFetch(): void {
  calls.length = 0;
  let calendarCall = 0;
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const url = requestUrl(input);
    if (!['/problem-sets', '/teach'].includes(url.pathname) || url.searchParams.get('view') !== 'calendar') {
      return Promise.resolve(jsonResponse({ docs: [], count: 0 }));
    }
    calendarCall += 1;
    calls.push(url);
    if (failAt === calendarCall) return Promise.resolve(hydroError(CALENDAR_ERROR, 500));
    return Promise.resolve(jsonResponse({
      view: 'calendar',
      from: boundText(url, 'from'),
      to: boundText(url, 'to'),
      rows: rowsForCall(calendarCall),
    }));
  }));
}

function calendarBootstrap(): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: GENERATED_AT,
    user: {
      id: 7,
      name: 'student',
      mail: '',
      signedIn: true,
      theme: 'light',
      viewLang: 'zh-CN',
      unreadMessages: 0,
      rp: 0,
      bio: '',
      priv: 0,
      role: 'default',
      tfa: false,
      authn: false,
      pinnedDomains: [],
      canBrowseProblemBank: true,
    },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/', training: '/problem-sets' } as KryptonBootstrap['urls'],
    udict: {},
    page: {
      templateName: 'student_sets.html',
      data: {
        tab: 'running',
        counts: { running: 0, upcoming: 0, practice: 0 },
        rows: [],
        practice: null,
        ended: null,
      },
    },
  };
}

function renderCalendar(View: CalendarViewComponent, props: { endpoint?: string; teacher?: boolean } = {}) {
  return render(
    <BootstrapProvider bootstrap={calendarBootstrap()}>
      <View {...props} />
    </BootstrapProvider>,
  );
}

async function shownWeek(offset: number, rows: readonly ContestRow[]): Promise<void> {
  const bounds = weekBounds(offset);
  const headline = calendarHeadline(rows, 'week', offset, bounds.from, bounds.to, SERVER_NOW);
  expect(pageText()).toContain(headline.caption);
  expect(pageText()).toContain(headline.relative);
  if (headline.range !== null) expect(pageText()).toContain(headline.range);
  expectRemaining(headline.remaining);
}

describe('problem sets calendar view', () => {
  beforeEach(() => {
    failAt = null;
    rowsForCall = () => [chapterRow()];
    user = userEvent.setup();
    installViewport(1280);
    installFetch();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('keeps teacher filters and links shared events to copying without student progress', async () => {
    installViewport(400);
    rowsForCall = () => [{ ...chapterRow(), teacherAction: 'copy', href: '/teach/new?copy=homework:chapter-3' }];
    const View = await loadCalendarView();
    renderCalendar(View, { endpoint: '/teach?scope=shared&type=quiz&status=running&q=第三章', teacher: true });
    const links = await screen.findAllByRole('link', { name: '使用这个题目集' });
    for (const link of links) expect(link).toHaveAttribute('href', '/teach/new?copy=homework:chapter-3');
    const request = callAt(0);
    expect(request.pathname).toBe('/teach');
    expect(Object.fromEntries(['scope', 'type', 'status', 'q', 'view'].map((key) => [key, request.searchParams.get(key)])))
      .toEqual({ scope: 'shared', type: 'quiz', status: 'running', q: '第三章', view: 'calendar' });
    expectRemaining(null);
    expect(screen.queryByText(/已作答/)).toBeNull();
    expect(screen.getAllByText(/6 题/).length).toBeGreaterThan(0);
  });

  it('requests the current school week and shows its headline', async () => {
    const View = await loadCalendarView();
    renderCalendar(View);

    expect(await screen.findByText(CHAPTER_TITLE)).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expectCalendarUrl(callAt(0), weekBounds(0).from, weekBounds(0).to);
    expect(screen.getByRole('region', { name: '本周题目集' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '周' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '月' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('button', { name: '今天' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: PREVIOUS })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: NEXT })).toBeInTheDocument();
    for (const label of LEGEND) expect(pageText()).toContain(label);
    expect(pageText()).toContain(FOOTER);
    shownWeek(0, [chapterRow()]);
    expect(pageText()).not.toContain('这一周没有考试和作业。');
  });

  it('moves the week forward by seven days and can return to today', async () => {
    rowsForCall = (call) => (call === 2 ? [] : [chapterRow()]);
    const View = await loadCalendarView();
    renderCalendar(View);
    await screen.findByText(CHAPTER_TITLE);

    await user.click(screen.getByRole('button', { name: NEXT }));
    await waitFor(() => expect(calls).toHaveLength(2));
    const firstFrom = Date.parse(boundText(callAt(0), 'from'));
    const secondFrom = Date.parse(boundText(callAt(1), 'from'));
    expect(secondFrom - firstFrom).toBe(WEEK_MS);
    expectCalendarUrl(callAt(1), weekBounds(1).from, weekBounds(1).to);
    shownWeek(1, []);
    expect(pageText()).not.toContain('项在本周截止');

    await user.click(screen.getByRole('button', { name: '今天' }));
    await waitFor(() => expect(calls).toHaveLength(3));
    expectCalendarUrl(callAt(2), weekBounds(0).from, weekBounds(0).to);
    expect(await screen.findByText(CHAPTER_TITLE)).toBeInTheDocument();
    shownWeek(0, [chapterRow()]);
  });

  it('requests the month grid and shows the month view', async () => {
    const View = await loadCalendarView();
    renderCalendar(View);
    await screen.findByText(CHAPTER_TITLE);

    await user.click(screen.getByRole('tab', { name: '月' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    const from = Date.parse(boundText(callAt(1), 'from'));
    const to = Date.parse(boundText(callAt(1), 'to'));
    const days = (to - from) / DAY_MS;
    expect(days === 35 || days === 42).toBe(true);
    const grid = monthGrid([chapterRow()], 0, SERVER_NOW);
    expect(from).toBe(grid.fromMs);
    expect(to).toBe(grid.toMs);
    expect(screen.getByRole('tab', { name: '月' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('grid', { name: '月历' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '本周题目集' })).toBeNull();
    const headline = calendarHeadline([chapterRow()], 'month', 0, grid.fromMs, grid.toMs, SERVER_NOW);
    expect(pageText()).toContain(headline.caption);
    expect(pageText()).toContain(headline.relative);
    expectRemaining(headline.remaining);
    expect(pageText()).toContain(FOOTER);
  });

  it('shows the agenda and hides the week month switch below sm', async () => {
    installViewport(500);
    const View = await loadCalendarView();
    renderCalendar(View);

    expect(screen.queryByRole('tab', { name: '周' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '月' })).toBeNull();
    expect(await screen.findByRole('region', { name: '进行中' })).toBeInTheDocument();
    const dueDay = screen.getByRole('region', { name: '周四' });
    expect(dueDay).toHaveTextContent(CHAPTER_TITLE);
    expect(dueDay).toHaveTextContent('截止');
    expect(screen.getByText(CHAPTER_TITLE)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '本周题目集' })).toBeNull();
    expect(screen.queryByRole('grid', { name: '月历' })).toBeNull();
    expect(calls).toHaveLength(1);
    expectCalendarUrl(callAt(0), weekBounds(0).from, weekBounds(0).to);
    expect(pageText()).toContain(FOOTER);
  });

  it('keeps the selected week when the month view narrows below sm', async () => {
    const View = await loadCalendarView();
    renderCalendar(View);
    expect(await screen.findByText(CHAPTER_TITLE)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '月' }));
    expect(await screen.findByRole('grid', { name: '月历' })).toBeInTheDocument();
    await waitFor(() => expect(calls).toHaveLength(2));
    const from = Date.parse(boundText(callAt(1), 'from'));
    const to = Date.parse(boundText(callAt(1), 'to'));
    const days = (to - from) / DAY_MS;
    expect(days === 35 || days === 42).toBe(true);
    expect(pageText()).toContain(CHAPTER_TITLE);

    await narrowBelowSm();

    expect(pageText()).toContain(CHAPTER_TITLE);
    expect(pageText()).toContain('本周');
    expect(pageText()).not.toContain('3 周前');
  });

  it('keeps the previous week when the next request fails', async () => {
    failAt = 2;
    const View = await loadCalendarView();
    renderCalendar(View);
    expect(await screen.findByText(CHAPTER_TITLE)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: NEXT }));
    expect(await screen.findByRole('alert')).toHaveTextContent(CALENDAR_ERROR);
    expect(screen.getByText(CHAPTER_TITLE)).toBeInTheDocument();
    expect(calls).toHaveLength(2);
  });
});

const HOME_URLS: KryptonUrls = {
  home: '/',
  problems: '/p',
  contests: '/contest',
  homework: '/homework',
  training: '/problem-sets',
  ranking: '/ranking',
  discussions: '/discuss',
  domains: '/domains',
  messages: '/messages',
  login: '/login',
  register: '/register',
  logout: '/logout',
  settings: '/settings',
  security: '/security',
  files: '/files',
  records: '/records',
  domainDashboard: '/domain',
  domainPermission: '/domain/permission',
  manage: '/manage',
  status: '/status',
  problemDetail: '/p/__PID__',
  contestDetail: '/contest/__TID__',
  homeworkDetail: '/homework/__TID__',
  trainingDetail: '/problem-sets/__TID__',
  discussionDetail: '/discuss/__DID__',
  discussionNode: '/discuss/node/__NID__',
  userDetail: '/user/__UID__',
  recordDetail: '/record/__RID__',
};

function homeUser(): KryptonUser {
  return {
    id: 7,
    name: '张三',
    mail: '',
    signedIn: true,
    theme: 'light',
    viewLang: 'zh-CN',
    unreadMessages: 0,
    rp: 0,
    bio: '',
    priv: 0,
    role: 'default',
    tfa: false,
    authn: false,
    pinnedDomains: [],
    canBrowseProblemBank: true,
  };
}

function installHomeFetch(): void {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const url = requestUrl(input);
    if (url.pathname === '/api/announce/homepage') return Promise.resolve(jsonResponse({ docs: [] }));
    if (url.pathname === '/api/collect/pending') return Promise.resolve(jsonResponse({ count: 0, docs: [] }));
    if (url.pathname === '/problem-sets' && url.searchParams.get('view') === 'calendar') {
      return Promise.resolve(jsonResponse({
        view: 'calendar',
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
        rows: [],
      }));
    }
    const tab = url.searchParams.get('tab') === 'upcoming' ? 'upcoming' : 'running';
    return Promise.resolve(jsonResponse({
      tab,
      counts: { running: 0, upcoming: 0, practice: 0 },
      rows: [],
      practice: null,
      ended: null,
    }));
  }));
}

describe('student home calendar link', () => {
  it('points the calendar link at the problem sets calendar', async () => {
    installHomeFetch();
    render(
      <BootstrapProvider
        bootstrap={{
          appName: 'Krypton',
          siteName: 'Krypton OJ',
          locale: 'zh-CN',
          theme: 'light',
          generatedAt: GENERATED_AT,
          user: homeUser(),
          domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
          urls: HOME_URLS,
          udict: {},
          page: { templateName: 'main.html', data: {} },
        }}
      >
        <StudentHomePage />
      </BootstrapProvider>,
    );

    const calendar = await screen.findByRole('link', { name: '日历' });
    expect(calendar).toHaveAttribute('href', '/problem-sets#calendar');
    expect(screen.getByRole('link', { name: '全部题目集' })).toHaveAttribute('href', '/problem-sets');
  });
});
