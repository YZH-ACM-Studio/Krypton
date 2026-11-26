import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap, type KryptonUrls, type KryptonUser } from '../../src/lib/bootstrap.tsx';
import { PRIV } from '../../src/lib/perms.ts';
import {
  schoolWeekStart,
  studentCalendarUrl,
  studentSetRowView,
  type ContestRow,
  type StudentSetRow,
} from '../../src/pages/problem-sets/model.ts';
import { KryptonHomePage } from '../../src/pages/home.tsx';

vi.mock('@/pages/home/teacher-home', async () => {
  const react = await import('react');
  return {
    TeacherHomePage() {
      return react.createElement('p', null, '老师首页替身');
    },
  };
});

const studentLoaders = import.meta.glob('../../src/pages/home/student-home.tsx');

const NOW_ISO = '2026-10-21T06:32:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;
const DOMAIN = '航院程序设计';
const STUDENT_NAME = '张三';
const LOOP_TITLE = '第三章 循环结构';
const ARRAY_TITLE = '第四章 数组';
const DONE_TITLE = '已经做完的作业';
const TEAM_TITLE = '开放中的组队批次';
const PRACTICE_TITLE = '循环练习';
const MIDTERM_TITLE = '期中测验';
const SECOND_UPCOMING = '第二天测验';
const THIRD_UPCOMING = '第三天测验';
const FOURTH_UPCOMING = '第四天测验';
const WEEK_EDGE = '七天后的作业';
const DISCUSSION_TITLE = '一条讨论';
const ANNOUNCE_TITLE = '期中考试安排与机房分配';
const RUNNING_ERROR = '进行中的题目集暂时不能查看。';
const LOGIN_PROMPT = '登录后，这里显示你的作业和考试';
const GUEST_PRACTICE = '登录后显示最近做过和收藏的题。';
const NO_RUNNING = '现在没有进行中的作业和考试';
const NO_WEEK = '近一周没有安排。';
const NO_SIDE = '近一周没有其它安排';
const COLLECT_ID = '66b800000000000000000701';
const LOOP_DUE = '2026-10-22T04:00:00.000Z';
const MIDTERM_BEGIN = '2026-10-23T11:00:00.000Z';

const URLS: KryptonUrls = {
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

interface RenderOptions {
  role?: string;
  priv?: number;
  signedIn?: boolean;
  canTeach?: boolean;
  canBrowseProblemBank?: boolean;
  name?: string;
  generatedAt?: string;
  running?: StudentSetRow[];
  upcoming?: ContestRow[];
  calendar?: ContestRow[];
  runningStatus?: number;
  recent?: Array<{ docId: string; title: string }>;
}

function homework(
  id: string,
  title: string,
  dueAt: string,
  answered: number,
  problemCount: number,
  done = false,
  personalEndAt: string | null = null,
): ContestRow {
  return {
    kind: 'homework',
    id,
    flavor: 'homework',
    title,
    href: `/homework/${id}`,
    beginAt: '2026-10-18T00:00:00.000Z',
    endAt: '2026-10-30T15:59:00.000Z',
    dueAt,
    durationMinutes: null,
    startAt: null,
    personalEndAt,
    attended: true,
    clientRequired: false,
    team: false,
    problemCount,
    progress: { answered },
    finalized: false,
    done,
  };
}

function exam(id: string, title: string, beginAt: string, endAt: string): ContestRow {
  return {
    kind: 'exam',
    id,
    flavor: 'paper',
    title,
    href: `/paper/${id}`,
    beginAt,
    endAt,
    dueAt: null,
    durationMinutes: null,
    startAt: null,
    personalEndAt: null,
    attended: false,
    clientRequired: false,
    team: false,
    problemCount: 8,
    progress: null,
    finalized: false,
    done: false,
  };
}

const LOOP = homework('loop', LOOP_TITLE, LOOP_DUE, 8, 12);
const ARRAY = homework('array', ARRAY_TITLE, '2026-10-29T08:00:00.000Z', 1, 9);
const DONE = homework('done-1', DONE_TITLE, '2026-10-21T10:00:00.000Z', 4, 4, true);
const MIDTERM = exam('midterm', MIDTERM_TITLE, MIDTERM_BEGIN, '2026-10-23T13:00:00.000Z');

const PRACTICE: StudentSetRow = {
  kind: 'practice',
  description: '练习简介',
  enrolled: true,
  participantCount: 12,
  sourceLabels: ['课程'],
  stages: [{ id: 1, title: '阶段一', status: 'open' as const }],
  id: 'practice-1',
  title: PRACTICE_TITLE,
  href: '/problem-sets/practice-1',
  stageCount: 2,
  problemCount: 10,
  doneCount: 1,
  sourceLabel: '课程',
};

const TEAM: StudentSetRow = {
  kind: 'team',
  id: 'batch-1',
  title: TEAM_TITLE,
  href: '/teams/batch-1',
  description: '每队 1–3 人',
  myState: 'none',
  inviteCount: 0,
  memberCount: null,
};

const BUSY_RUNNING: StudentSetRow[] = [DONE, TEAM, PRACTICE, ARRAY, LOOP];

function words(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
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

function setsBody(tab: 'running' | 'upcoming', rows: readonly StudentSetRow[]) {
  return {
    tab,
    counts: { running: rows.length, upcoming: rows.length, practice: 0 },
    rows,
    practice: null,
    ended: null,
  };
}

function calendarBody(rows: readonly ContestRow[]) {
  const from = schoolWeekStart(Date.parse(NOW_ISO));
  return {
    view: 'calendar',
    from: new Date(from).toISOString(),
    to: new Date(from + 7 * DAY_MS).toISOString(),
    rows,
  };
}

function pageData(recent: ReadonlyArray<{ docId: string; title: string }> = [{ docId: 'P1001', title: '素数判定' }]) {
  return {
    contents: [{
      sections: [
        ['discussion', [[{
          _id: 'd1', title: DISCUSSION_TITLE, owner: 3, nReply: 1, updateAt: NOW_ISO,
        }], {}]],
        ['ranking', [9]],
        ['starred_problems', [[], null]],
        ['recent_problems', [recent, null]],
        ['contest', [[{
          docId: 'old-contest', title: '旧比赛面板', beginAt: NOW_ISO, endAt: NOW_ISO,
        }], {}]],
        ['homework', [[{
          docId: 'old-homework', title: '旧作业面板', penaltySince: NOW_ISO, endAt: NOW_ISO,
        }], {}]],
        ['training', [[{ docId: 'old-training', title: '旧题集面板' }], {}]],
      ],
    }],
  };
}

function makeUser(options: RenderOptions): KryptonUser {
  const signedIn = options.signedIn !== false;
  return {
    id: 7,
    name: options.name ?? (signedIn ? STUDENT_NAME : '游客'),
    mail: '',
    signedIn,
    theme: 'light',
    viewLang: 'zh-CN',
    unreadMessages: 2,
    rp: 0,
    bio: '',
    priv: options.priv ?? 0,
    role: options.role ?? 'default',
    tfa: false,
    authn: false,
    pinnedDomains: [],
    canBrowseProblemBank: options.canBrowseProblemBank !== false,
    canTeach: options.canTeach === true,
  };
}

function makeBootstrap(options: RenderOptions): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: options.generatedAt ?? NOW_ISO,
    user: makeUser(options),
    domain: {
      id: 'system', name: DOMAIN, bulletin: '', avatar: '',
    },
    urls: URLS,
    udict: {},
    page: { templateName: 'main.html', data: pageData(options.recent) },
  };
}

function installFetch(options: RenderOptions): string[] {
  const urls: string[] = [];
  const runningStatus = options.runningStatus ?? 200;
  const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const url = requestUrl(input);
    urls.push(`${url.pathname}${url.search}`);
    if (url.pathname === '/api/announce/homepage') {
      return Promise.resolve(jsonResponse({
        docs: [{
          _id: 'ann-midterm',
          title: ANNOUNCE_TITLE,
          category: 'academic',
          categoryName: '教务',
          categoryColor: 'blue',
          pin: false,
          publishAt: '2026-10-20T02:00:00.000Z',
        }],
      }));
    }
    if (url.pathname === '/api/collect/pending') {
      return Promise.resolve(jsonResponse({
        count: 1,
        docs: [{ _id: COLLECT_ID, title: '实验报告', dueAt: '2026-10-24T15:59:00.000Z' }],
      }));
    }
    if (url.pathname === '/problem-sets' && url.searchParams.get('tab') === 'running') {
      if (runningStatus !== 200) return Promise.resolve(hydroError(RUNNING_ERROR, runningStatus));
      return Promise.resolve(jsonResponse(setsBody('running', options.running ?? [])));
    }
    if (url.pathname === '/problem-sets' && url.searchParams.get('tab') === 'upcoming') {
      return Promise.resolve(jsonResponse(setsBody('upcoming', options.upcoming ?? [])));
    }
    if (url.pathname === '/problem-sets' && url.searchParams.get('view') === 'calendar') {
      return Promise.resolve(jsonResponse(calendarBody(options.calendar ?? [])));
    }
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return urls;
}

function renderHome(options: RenderOptions = {}): string[] {
  const urls = installFetch(options);
  render(
    <BootstrapProvider bootstrap={makeBootstrap(options)}>
      <KryptonHomePage />
    </BootstrapProvider>,
  );
  return urls;
}

function asked(urls: readonly string[], params: Record<string, string>): boolean {
  return urls.some((raw) => {
    const url = new URL(raw, 'http://krypton.local');
    if (url.pathname !== '/problem-sets') return false;
    return Object.entries(params).every(([key, value]) => url.searchParams.get(key) === value);
  });
}

function expectsCalendar(urls: readonly string[]) {
  const from = schoolWeekStart(Date.parse(NOW_ISO));
  const expected = new URL(studentCalendarUrl(from, from + 7 * DAY_MS), 'http://krypton.local');
  expect(asked(urls, {
    view: 'calendar',
    from: expected.searchParams.get('from') ?? '',
    to: expected.searchParams.get('to') ?? '',
  })).toBe(true);
}

function expectsSetTabs(urls: readonly string[]) {
  expect(asked(urls, { tab: 'running' })).toBe(true);
  expect(asked(urls, { tab: 'upcoming' })).toBe(true);
  expectsCalendar(urls);
}

function noProblemSets(urls: readonly string[]) {
  expect(urls.some((raw) => new URL(raw, 'http://krypton.local').pathname === '/problem-sets')).toBe(false);
}

function primaryActions(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-variant="primary"]')];
}

function requirePrimary(): HTMLElement {
  const actions = primaryActions();
  expect(actions).toHaveLength(1);
  const action = actions.at(0);
  if (!(action instanceof HTMLElement)) throw new TypeError('missing primary');
  return action;
}

function actionHref(node: HTMLElement): string | null {
  if (node instanceof HTMLAnchorElement) return node.getAttribute('href');
  return node.querySelector('a')?.getAttribute('href') ?? null;
}

function variantOf(node: Element): string | null {
  const own = node.getAttribute('data-variant');
  if (own) return own;
  return node.closest('[data-variant]')?.getAttribute('data-variant') ?? null;
}

function focusCard(): HTMLElement {
  const seed = screen.getByText('24 小时内截止');
  let best: HTMLElement | null = null;
  let node: HTMLElement | null = seed;
  while (node) {
    const text = node.textContent ?? '';
    if (text.includes(ARRAY_TITLE)) break;
    if (text.includes(LOOP_TITLE) && node.querySelector('[data-variant="primary"]')) best = node;
    node = node.parentElement;
  }
  if (best === null) throw new TypeError('focus card');
  return best;
}

function expectSoonClock(text: string) {
  const match = /(\d{1,2}):(\d{2}):(\d{2})/.exec(text);
  expect(match, text).not.toBeNull();
  if (match === null) return;
  const total = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  const expected = Math.round((Date.parse(LOOP_DUE) - Date.parse(NOW_ISO)) / 1000);
  expect(Math.abs(total - expected)).toBeLessThanOrEqual(15);
}

function dayLabel(link: HTMLElement): string {
  return `${link.getAttribute('aria-label') ?? ''} ${link.textContent ?? ''}`.replace(/\s+/g, '');
}

function weekCells(): HTMLAnchorElement[] {
  return screen.queryAllByRole('link').flatMap((link) => {
    if (!(link instanceof HTMLAnchorElement)) return [];
    if (link.getAttribute('href') !== '/problem-sets') return [];
    const label = dayLabel(link);
    if (/日历|全部题目集|去练习|开始刷题/.test(label)) return [];
    if (!(/周[一二三四五六日]|今天/.test(label))) return [];
    return [link];
  });
}

function highlighted(node: HTMLElement): boolean {
  if (node.classList.contains('bg-brand-soft')) return true;
  if (node.querySelector('.bg-brand-soft')) return true;
  return node.parentElement?.classList.contains('bg-brand-soft') ?? false;
}

function panelOf(node: HTMLElement): HTMLElement {
  const panel = node.closest('[data-slot="panel"]');
  if (!(panel instanceof HTMLElement)) throw new TypeError('missing panel');
  return panel;
}

function follows(earlier: HTMLElement, later: HTMLElement): boolean {
  const position = earlier.compareDocumentPosition(later);
  return (position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function desktopQuery(query: string): MediaQueryList {
  const min = /min-width:\s*(\d+)px/.exec(query);
  const max = /max-width:\s*(\d+)px/.exec(query);
  const matches = (min?.[1] !== undefined && Number(min[1]) <= 1920)
    || (max?.[1] !== undefined && Number(max[1]) >= 1920);
  return {
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  } as unknown as MediaQueryList;
}

beforeEach(() => {
  window.matchMedia = ((query: string) => desktopQuery(query)) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('student home page', () => {
  it('shows formal contest progress and opens the current paper from the focus card', async () => {
    const row: ContestRow = {
      ...LOOP, kind: 'exam', purpose: 'contest', flavor: 'acm', href: '/contest/current', title: '课堂赛',
      startAt: NOW_ISO, personalEndAt: LOOP_DUE, attended: true, progress: { answered: 2 },
    };
    renderHome({ running: [row], upcoming: [], calendar: [row] });
    await screen.findByText('已答 2 / 12 题');
    expect(screen.getByText('比赛 · ACM')).toBeInTheDocument();
    expect(actionHref(requirePrimary())).toBe('/contest/current?section=problems');
  });

  it('removes an expired personal round from running cards even when the cached row was open', async () => {
    const expired: ContestRow = { ...LOOP, purpose: 'homework', personalEndAt: NOW_ISO, done: false };
    renderHome({ running: [expired], upcoming: [], calendar: [] });
    expect(await screen.findByText('现在没有进行中的作业和考试')).toBeInTheDocument();
    expect(screen.queryByText(LOOP_TITLE)).toBeNull();
  });

  it('exports student home page', async () => {
    const load = Object.values(studentLoaders).at(0);
    expect(typeof load, 'src/pages/home/student-home.tsx').toBe('function');
    if (typeof load !== 'function') return;
    const imported: unknown = await load();
    if (typeof imported !== 'object' || imported === null) throw new TypeError('StudentHomePage must be exported');
    const record = imported as Record<string, unknown>;
    expect(typeof record.StudentHomePage).toBe('function');
  });

  it('focuses the soonest unfinished homework and keeps one primary action', async () => {
    const urls = renderHome({
      running: BUSY_RUNNING,
      upcoming: [],
      calendar: [LOOP],
    });
    expect(await screen.findByText('24 小时内截止')).toBeInTheDocument();
    await screen.findByRole('heading', { name: '最新公告' });

    const card = focusCard();
    const cardText = words(card.textContent);
    expect(cardText).toContain(LOOP_TITLE);
    expect(cardText).toContain('作业');
    expect(cardText).toContain('已答 8 / 12 题');
    expect(cardText).toMatch(/后截止\s*·\s*明天\s*12:00/);
    expectSoonClock(cardText);
    expect(cardText).not.toMatch(/\d+ 天 \d+ 小时/);

    const now = Date.parse(NOW_ISO);
    const action = studentSetRowView(LOOP, now).action;
    if (action === null) throw new TypeError('row action');
    const primary = requirePrimary();
    expect(words(primary.textContent)).toContain(action.label);
    expect(actionHref(primary)).toBe(action.href);
    expect(primaryActions()).toHaveLength(1);

    const start = screen.getByRole('link', { name: /开始刷题/ });
    expect(variantOf(start)).toBe('secondary');
    expect(start).toHaveAttribute('href', '/p');
    expect(screen.getByRole('searchbox')).toBeInTheDocument();

    expect(screen.getByText('也在进行')).toBeInTheDocument();
    expect(screen.getByText(ARRAY_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(DONE_TITLE)).toBeNull();
    expect(screen.queryByText(TEAM_TITLE)).toBeNull();
    expect(screen.queryByText(PRACTICE_TITLE)).toBeNull();

    expect(screen.getByRole('heading', { level: 1, name: DOMAIN })).toBeInTheDocument();
    expect(words(document.body.textContent)).toMatch(/下午好，张三\s*·\s*10月21日\s*周三/);
    expect(screen.getByRole('link', { name: /日历/ })).toHaveAttribute('href', '/problem-sets#calendar');
    expect(screen.getByRole('link', { name: /全部题目集/ })).toHaveAttribute('href', '/problem-sets');

    expect(screen.queryByRole('heading', { name: '讨论' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '排名' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '推荐站点' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '进行中的题目集' })).toBeNull();
    expect(screen.queryByText(DISCUSSION_TITLE)).toBeNull();
    expect(screen.queryByText('旧比赛面板')).toBeNull();
    expect(screen.queryByText('旧作业面板')).toBeNull();
    expect(screen.queryByText('旧题集面板')).toBeNull();
    expect(screen.queryByText('老师首页替身')).toBeNull();

    const practice = screen.getByRole('heading', { name: '继续练题' });
    const personal = screen.getByRole('heading', { name: '个人' });
    const collect = screen.getByRole('heading', { name: '未交文件' });
    const news = screen.getByRole('heading', { name: '最新公告' });
    const current = screen.getByRole('heading', { name: /^正在进行/ });
    expect(follows(current, practice)).toBe(true);
    expect(follows(practice, news)).toBe(true);
    expect(follows(personal, collect)).toBe(true);
    expect(screen.getByText('2 条未读')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /消息/ })).toHaveAttribute('href', '/messages');
    expect(screen.getByRole('link', { name: '域' })).toHaveAttribute('href', '/domains');
    expect(screen.getByText(ANNOUNCE_TITLE)).toBeInTheDocument();
    expectsSetTabs(urls);
  });

  it('marks wednesday on the school week and lists thursday deadlines', async () => {
    renderHome({
      running: BUSY_RUNNING,
      upcoming: [],
      calendar: [LOOP],
    });
    await waitFor(() => {
      expect(weekCells()).toHaveLength(7);
    });
    const cells = weekCells();
    const labels = cells.map((cell) => dayLabel(cell));
    expect(labels[0]).toContain('周一');
    expect(labels[0]).toContain('19');
    expect(labels[1]).toContain('周二');
    expect(labels[2]?.includes('今天') || labels[2]?.includes('周三')).toBe(true);
    expect(labels[2]).toContain('21');
    expect(labels[3]).toContain('周四');
    expect(labels[3]).toContain('22');
    expect(labels[3]).toContain(`截止${LOOP_TITLE}`.replace(/\s+/g, ''));
    expect(labels[6]).toContain('周日');
    expect(labels[6]).toContain('25');
    const wednesday = cells.at(2);
    if (!(wednesday instanceof HTMLAnchorElement)) throw new TypeError('wednesday');
    expect(highlighted(wednesday)).toBe(true);
    for (const cell of cells) expect(cell).toHaveAttribute('href', '/problem-sets');
  });

  it('hides start practice without problem bank permission', async () => {
    renderHome({
      running: [LOOP],
      upcoming: [],
      calendar: [],
      canBrowseProblemBank: false,
    });
    expect(await screen.findByText(LOOP_TITLE)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /开始刷题/ })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    const primary = requirePrimary();
    const action = studentSetRowView(LOOP, Date.parse(NOW_ISO)).action;
    if (action === null) throw new TypeError('row action');
    expect(actionHref(primary)).toBe(action.href);
  });

  it('counts down to the next set when nothing is running', async () => {
    const edge = new Date(Date.parse(NOW_ISO) + 7 * DAY_MS).toISOString();
    renderHome({
      running: [],
      upcoming: [
        MIDTERM,
        exam('edge', WEEK_EDGE, edge, '2026-10-28T08:00:00.000Z'),
        exam('second', SECOND_UPCOMING, '2026-10-24T02:00:00.000Z', '2026-10-24T04:00:00.000Z'),
        exam('third', THIRD_UPCOMING, '2026-10-25T02:00:00.000Z', '2026-10-25T04:00:00.000Z'),
        exam('fourth', FOURTH_UPCOMING, '2026-10-26T02:00:00.000Z', '2026-10-26T04:00:00.000Z'),
      ],
      calendar: [],
    });
    expect(await screen.findByText(NO_RUNNING)).toBeInTheDocument();
    const text = words(document.body.textContent);
    expect(text).toContain(`下一项是「${MIDTERM_TITLE}」`);
    expect(text).toMatch(/后天\s*19:00\s*开始/);
    expect(text).toContain('2 天 4 小时');
    expect(screen.getByText(SECOND_UPCOMING)).toBeInTheDocument();
    expect(screen.getByText(THIRD_UPCOMING)).toBeInTheDocument();
    expect(screen.queryByText(FOURTH_UPCOMING)).toBeNull();
    expect(screen.queryByText(WEEK_EDGE)).toBeNull();
    const practice = screen.getByRole('link', { name: /去练习/ });
    expect(practice).toHaveAttribute('href', '/problem-sets');
    expect(variantOf(practice)).toBe('secondary');
  });

  it('drops the countdown when the next week is empty', async () => {
    renderHome({ running: [], upcoming: [], calendar: [] });
    expect(await screen.findByText(NO_WEEK)).toBeInTheDocument();
    expect(screen.getByText(NO_RUNNING)).toBeInTheDocument();
    expect(words(document.body.textContent)).not.toMatch(/\d{1,2}:\d{2}:\d{2}/);
    expect(words(document.body.textContent)).not.toMatch(/\d+ 天 \d+ 小时/);
    expect(screen.getByRole('link', { name: /去练习/ })).toHaveAttribute('href', '/problem-sets');
  });

  it('says there is nothing else this week when one set is running', async () => {
    renderHome({ running: [LOOP], upcoming: [], calendar: [] });
    expect(await screen.findByText(LOOP_TITLE)).toBeInTheDocument();
    expect(screen.getByText(NO_SIDE)).toBeInTheDocument();
    expect(screen.queryByText('也在进行')).toBeNull();
    expect(screen.queryByText('即将开始')).toBeNull();
  });

  it('asks a signed-out visitor to log in without loading sets', async () => {
    const urls = renderHome({
      signedIn: false,
      canBrowseProblemBank: false,
      running: [LOOP],
      upcoming: [MIDTERM],
      calendar: [LOOP],
    });
    expect(await screen.findByText(LOGIN_PROMPT)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: '注册' })).toHaveAttribute('href', '/register');
    expect(variantOf(screen.getByRole('link', { name: '登录' }))).toBe('primary');
    expect(variantOf(screen.getByRole('link', { name: '注册' }))).toBe('secondary');
    expect(screen.getByText(GUEST_PRACTICE)).toBeInTheDocument();
    expect(words(document.body.textContent)).not.toMatch(/上午好|中午好|下午好|晚上好/);
    expect(words(document.body.textContent)).toContain('10月21日');
    expect(screen.queryByRole('heading', { name: '个人' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '未交文件' })).toBeNull();
    expect(screen.queryByText(LOOP_TITLE)).toBeNull();
    noProblemSets(urls);
  });

  it('sends a teacher to the teacher home without loading sets', async () => {
    const urls = renderHome({
      role: 'teacher',
      canTeach: true,
      running: [LOOP],
      upcoming: [MIDTERM],
      calendar: [LOOP],
    });
    expect(await screen.findByText('老师首页替身')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '讨论' })).toBeNull();
    expect(screen.queryByText(LOOP_TITLE)).toBeNull();
    expect(screen.queryByText(LOGIN_PROMPT)).toBeNull();
    noProblemSets(urls);
  });

  it('prefers the teacher home when a teacher is also a system admin', async () => {
    const urls = renderHome({
      role: 'teacher',
      priv: PRIV.PRIV_EDIT_SYSTEM,
      canTeach: true,
      running: [LOOP],
    });
    expect(await screen.findByText('老师首页替身')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '讨论' })).toBeNull();
    noProblemSets(urls);
  });

  it('keeps a non-teacher on the student home even with teach permission', async () => {
    const urls = renderHome({
      role: 'default',
      canTeach: true,
      priv: 0,
      running: [LOOP],
      upcoming: [],
      calendar: [],
    });
    expect(await screen.findByText(LOOP_TITLE)).toBeInTheDocument();
    expect(screen.queryByText('老师首页替身')).toBeNull();
    expect(screen.queryByRole('heading', { name: '讨论' })).toBeNull();
    expectsSetTabs(urls);
  });

  it('keeps a system admin on the existing home', async () => {
    renderHome({
      role: 'root',
      priv: PRIV.PRIV_EDIT_SYSTEM,
      canTeach: true,
      name: '管理员',
      running: [LOOP],
    });
    expect(await screen.findByRole('heading', { name: '讨论' })).toBeInTheDocument();
    expect(screen.getByText(DISCUSSION_TITLE)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '推荐站点' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '排名' })).toBeInTheDocument();
    expect(screen.queryByText('老师首页替身')).toBeNull();
    expect(screen.queryByRole('heading', { name: /^正在进行/ })).toBeNull();
    expect(screen.queryByText(LOOP_TITLE)).toBeNull();
  });

  it('shows a running failure beside the other home blocks', async () => {
    const urls = renderHome({
      running: [LOOP],
      upcoming: [MIDTERM],
      calendar: [LOOP],
      runningStatus: 500,
    });
    const heading = await screen.findByRole('heading', { name: /^正在进行/ });
    const alert = within(panelOf(heading)).getByRole('alert');
    expect(alert).toHaveTextContent(RUNNING_ERROR);
    expect(screen.getByRole('heading', { name: '继续练题' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '个人' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '最新公告' })).toBeInTheDocument();
    expect(screen.getByText(ANNOUNCE_TITLE)).toBeInTheDocument();
    expectsSetTabs(urls);
  });

  it('greets from the shanghai server clock', async () => {
    const cases = [
      ['2026-10-21T00:00:00.000Z', '上午好'],
      ['2026-10-21T04:00:00.000Z', '中午好'],
      ['2026-10-21T06:32:00.000Z', '下午好'],
      ['2026-10-21T12:00:00.000Z', '晚上好'],
    ] as const;
    for (const [generatedAt, greeting] of cases) {
      cleanup();
      vi.unstubAllGlobals();
      renderHome({
        generatedAt,
        running: [],
        upcoming: [],
        calendar: [],
      });
      expect(screen.getByRole('heading', { level: 1, name: DOMAIN })).toBeInTheDocument();
      expect(words(document.body.textContent)).toContain(`${greeting}，${STUDENT_NAME}`);
    }
  });

  it('says midday at eleven shanghai time', () => {
    renderHome({
      generatedAt: '2026-10-21T03:00:00.000Z',
      running: [],
      upcoming: [],
      calendar: [],
    });
    expect(words(document.body.textContent)).toContain(`中午好，${STUDENT_NAME}`);
    expect(words(document.body.textContent)).not.toMatch(/上午好|下午好|晚上好/);
  });

  it('orders the focus card by personal deadline ahead of due date', async () => {
    const personal = homework(
      'personal',
      '个人限时作业',
      '2026-10-29T08:00:00.000Z',
      2,
      6,
      false,
      '2026-10-22T04:00:00.000Z',
    );
    const ordinary = homework('ordinary', '普通截止作业', '2026-10-23T04:00:00.000Z', 0, 4);
    renderHome({ running: [ordinary, personal], upcoming: [], calendar: [] });
    expect(await screen.findByText('24 小时内截止')).toBeInTheDocument();
    expect(screen.getByText('个人限时作业')).toBeInTheDocument();
    expect(screen.getByText('普通截止作业')).toBeInTheDocument();
    expect(words(document.body.textContent)).toMatch(/后截止\s*·\s*明天\s*12:00/);
  });

  it('shows a one day label when a deadline is exactly twenty four hours away', async () => {
    const fixed = Date.parse(NOW_ISO);
    const spy = vi.spyOn(Date, 'now').mockReturnValue(fixed);
    try {
      const due = new Date(fixed + DAY_MS).toISOString();
      renderHome({
        running: [homework('exact-day', '恰好一天后截止', due, 0, 3)],
        upcoming: [],
        calendar: [],
      });
      expect(await screen.findByText('1 天 0 小时')).toBeInTheDocument();
      expect(screen.queryByText('24:00:00')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('strikes through a finished homework on the day it is due', async () => {
    const finished = homework('finished', '已经交完的作业', LOOP_DUE, 4, 4, true);
    renderHome({ running: [], upcoming: [], calendar: [finished] });
    await waitFor(() => {
      expect(weekCells()).toHaveLength(7);
    });
    const thursday = weekCells().at(3);
    if (!(thursday instanceof HTMLAnchorElement)) throw new TypeError('thursday');
    const struck = thursday.querySelector('.line-through');
    if (!(struck instanceof HTMLElement)) throw new TypeError('missing strikethrough');
    expect(words(struck.textContent)).toContain('截止 已经交完的作业');
  });

  it('places an exam on the day it starts', async () => {
    const paper = exam('thu-exam', '周四开考', '2026-10-22T11:00:00.000Z', '2026-10-23T13:00:00.000Z');
    renderHome({ running: [], upcoming: [], calendar: [paper] });
    await waitFor(() => {
      expect(weekCells()).toHaveLength(7);
    });
    const labels = weekCells().map((cell) => dayLabel(cell));
    expect(labels[3]).toContain('19:00');
    expect(labels[3]).toContain('周四开考');
    expect(labels[4]).not.toContain('周四开考');
  });

  it('keeps only five recent problems', () => {
    const recent = [1, 2, 3, 4, 5, 6].map((index) => ({ docId: `P100${index}`, title: `题目${index}` }));
    renderHome({ running: [], upcoming: [], calendar: [], recent });
    for (const index of [1, 2, 3, 4, 5]) {
      expect(screen.getByRole('link', { name: `P100${index}. 题目${index}` })).toBeInTheDocument();
    }
    expect(screen.queryByRole('link', { name: 'P1006. 题目6' })).toBeNull();
  });

  it('keeps the week strip when the running request fails', async () => {
    renderHome({
      running: [LOOP],
      upcoming: [],
      calendar: [LOOP],
      runningStatus: 500,
    });
    const heading = await screen.findByRole('heading', { name: /^正在进行/ });
    expect(within(panelOf(heading)).getByRole('alert')).toHaveTextContent(RUNNING_ERROR);
    await waitFor(() => {
      expect(weekCells()).toHaveLength(7);
    });
    const thursday = weekCells().at(3);
    if (!(thursday instanceof HTMLAnchorElement)) throw new TypeError('thursday');
    expect(dayLabel(thursday)).toContain(`截止${LOOP_TITLE}`.replace(/\s+/g, ''));
  });
});
