import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap, type KryptonUrls, type KryptonUser } from '../../src/lib/bootstrap.tsx';
import {
  schoolWeekStart,
  studentCalendarUrl,
  studentSetRowView,
  type ContestRow,
  type StudentSetRow,
} from '../../src/pages/problem-sets/model.ts';
import { KryptonHomePage } from '../../src/pages/home.tsx';

const NOW_ISO = '2026-10-21T06:32:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;
const RUNNING_ERROR = '进行中的题目集暂时不能查看。';
const NO_RUNNING = '现在没有进行中的作业和考试';
const NO_WEEK = '近一周没有安排。';
const LOGIN_PROMPT = '登录后，这里显示你的作业和考试';
const DONE_TITLE = '已经做完的作业';
const TEAM_TITLE = '开放中的组队批次';
const PRACTICE_TITLE = '循环练习';
const FIRST_TITLE = '第一次未完成作业';
const SECOND_TITLE = '第二次未完成作业';
const FOURTH_TITLE = '第四次未完成作业';
const FIFTH_TITLE = '第五次未完成作业';
const LEGACY_CONTEST = '旧比赛面板';
const LEGACY_HOMEWORK = '旧作业面板';
const LEGACY_TRAINING = '旧题集面板';

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

function homework(id: string, title: string, dueAt: string, done = false): ContestRow {
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
    personalEndAt: null,
    attended: true,
    clientRequired: false,
    team: false,
    problemCount: 4,
    progress: { answered: done ? 4 : 1 },
    finalized: false,
    done,
  };
}

const FIRST = homework('hw-1', FIRST_TITLE, '2026-10-23T04:00:00.000Z');
const SECOND = homework('hw-2', SECOND_TITLE, '2026-10-24T04:00:00.000Z');
const FOURTH = homework('hw-4', FOURTH_TITLE, '2026-10-25T04:00:00.000Z');
const FIFTH = homework('hw-5', FIFTH_TITLE, '2026-10-26T04:00:00.000Z');
const DONE = homework('done-1', DONE_TITLE, '2026-10-21T10:00:00.000Z', true);

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
  stageCount: 1,
  problemCount: 3,
  doneCount: 0,
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

function setsBody(tab: 'running' | 'upcoming', rows: readonly StudentSetRow[]) {
  return {
    tab,
    counts: { running: rows.length, upcoming: 0, practice: 0 },
    rows,
    practice: null,
    ended: null,
  };
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

function makeUser(signedIn: boolean): KryptonUser {
  return {
    id: 7,
    name: signedIn ? '张三' : '游客',
    mail: '',
    signedIn,
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
    canBrowseProblemBank: false,
    canTeach: false,
  };
}

function makeBootstrap(user: KryptonUser): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: NOW_ISO,
    user,
    domain: {
      id: 'system', name: '主域', bulletin: '', avatar: '',
    },
    urls: URLS,
    udict: {},
    page: {
      templateName: 'main.html',
      data: {
        contents: [{
          sections: [
            ['contest', [[{
              docId: 'old-contest', title: LEGACY_CONTEST, beginAt: NOW_ISO, endAt: NOW_ISO,
            }], {}]],
            ['homework', [[{
              docId: 'old-homework', title: LEGACY_HOMEWORK, penaltySince: NOW_ISO, endAt: NOW_ISO,
            }], {}]],
            ['training', [[{ docId: 'old-training', title: LEGACY_TRAINING }], {}]],
            ['discussion', [[], {}]],
            ['ranking', []],
            ['starred_problems', [[], null]],
            ['recent_problems', [[], null]],
          ],
        }],
      },
    },
  };
}

function installFetch(rows: readonly StudentSetRow[], runningStatus = 200): string[] {
  const urls: string[] = [];
  const from = schoolWeekStart(Date.parse(NOW_ISO));
  const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const url = requestUrl(input);
    urls.push(`${url.pathname}${url.search}`);
    if (url.pathname === '/api/announce/homepage') return Promise.resolve(jsonResponse({ docs: [] }));
    if (url.pathname === '/api/collect/pending') return Promise.resolve(jsonResponse({ count: 0, docs: [] }));
    if (url.pathname === '/problem-sets' && url.searchParams.get('tab') === 'running') {
      if (runningStatus !== 200) return Promise.resolve(hydroError(RUNNING_ERROR, runningStatus));
      return Promise.resolve(jsonResponse(setsBody('running', rows)));
    }
    if (url.pathname === '/problem-sets' && url.searchParams.get('tab') === 'upcoming') {
      return Promise.resolve(jsonResponse(setsBody('upcoming', [])));
    }
    if (url.pathname === '/problem-sets' && url.searchParams.get('view') === 'calendar') {
      return Promise.resolve(jsonResponse({
        view: 'calendar',
        from: new Date(from).toISOString(),
        to: new Date(from + 7 * DAY_MS).toISOString(),
        rows: [],
      }));
    }
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return urls;
}

function renderHome(user: KryptonUser, rows: readonly StudentSetRow[], runningStatus = 200): string[] {
  const urls = installFetch(rows, runningStatus);
  render(
    <BootstrapProvider bootstrap={makeBootstrap(user)}>
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

function expectLegacyEntriesGone() {
  expect(screen.queryByText('查看比赛')).toBeNull();
  expect(screen.queryByRole('heading', { name: '比赛' })).toBeNull();
  expect(screen.queryByRole('heading', { name: '作业' })).toBeNull();
  expect(screen.queryByRole('heading', { name: '题集' })).toBeNull();
  expect(screen.queryByText(LEGACY_CONTEST)).toBeNull();
  expect(screen.queryByText(LEGACY_HOMEWORK)).toBeNull();
  expect(screen.queryByText(LEGACY_TRAINING)).toBeNull();
  const hrefs = screen.queryAllByRole('link').map((link) => link.getAttribute('href') ?? '');
  expect(hrefs).not.toContain('/contest');
  expect(hrefs).not.toContain('/homework');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('home in-progress strip', () => {
  it('shows every unfinished exam or homework and ignores the old three-row cap', async () => {
    const urls = renderHome(makeUser(true), [DONE, TEAM, PRACTICE, FIFTH, FOURTH, SECOND, FIRST]);
    expect(await screen.findByText(FIRST_TITLE)).toBeInTheDocument();
    expect(screen.getByText(SECOND_TITLE)).toBeInTheDocument();
    expect(screen.getByText(FOURTH_TITLE)).toBeInTheDocument();
    expect(screen.getByText(FIFTH_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(DONE_TITLE)).toBeNull();
    expect(screen.queryByText(TEAM_TITLE)).toBeNull();
    expect(screen.queryByText(PRACTICE_TITLE)).toBeNull();
    expect(screen.queryByRole('heading', { name: '进行中的题目集' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '讨论' })).toBeNull();
    expect(screen.queryByText('全部 7 项')).toBeNull();
    expect(screen.getByRole('link', { name: /全部题目集/ })).toHaveAttribute('href', '/problem-sets');
    expectLegacyEntriesGone();
    expect(asked(urls, { tab: 'running' })).toBe(true);
    expect(asked(urls, { tab: 'upcoming' })).toBe(true);
    const from = schoolWeekStart(Date.parse(NOW_ISO));
    const expected = new URL(studentCalendarUrl(from, from + 7 * DAY_MS), 'http://krypton.local');
    expect(asked(urls, {
      view: 'calendar',
      from: expected.searchParams.get('from') ?? '',
      to: expected.searchParams.get('to') ?? '',
    })).toBe(true);
    const action = studentSetRowView(FIRST, Date.parse(NOW_ISO)).action;
    if (action === null) throw new TypeError('row action');
    const primaries = [...document.querySelectorAll<HTMLElement>('[data-variant="primary"]')];
    expect(primaries).toHaveLength(1);
    const primary = primaries.at(0);
    if (!(primary instanceof HTMLElement)) throw new TypeError('missing primary');
    const href = primary instanceof HTMLAnchorElement
      ? primary.getAttribute('href')
      : primary.querySelector('a')?.getAttribute('href');
    expect(href).toBe(action.href);
    expect(primary.textContent ?? '').toContain(action.label);
  });

  it('replaces the old empty strip when nothing is running', async () => {
    renderHome(makeUser(true), [DONE]);
    expect(await screen.findByText(NO_RUNNING)).toBeInTheDocument();
    expect(screen.getByText(NO_WEEK)).toBeInTheDocument();
    expect(screen.queryByText('现在没有要做的题目集')).toBeNull();
    expect(screen.queryByText(DONE_TITLE)).toBeNull();
    expect(screen.getByRole('link', { name: /去练习/ })).toHaveAttribute('href', '/problem-sets');
  });

  it('shows the empty copy when the running list has no rows', async () => {
    renderHome(makeUser(true), []);
    expect(await screen.findByText(NO_RUNNING)).toBeInTheDocument();
    expect(screen.getByText(NO_WEEK)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /全部 0 项/ })).toBeNull();
  });

  it('shows the server error inside the in-progress block', async () => {
    renderHome(makeUser(true), [FIRST], 500);
    const heading = await screen.findByRole('heading', { name: /^正在进行/ });
    const panel = heading.closest('[data-slot="panel"]');
    if (!(panel instanceof HTMLElement)) throw new TypeError('missing panel');
    expect(within(panel).getByRole('alert')).toHaveTextContent(RUNNING_ERROR);
    expect(screen.getByRole('heading', { name: '继续练题' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '进行中的题目集' })).toBeNull();
  });

  it('does not request sets for a signed-out visitor', async () => {
    const urls = renderHome(makeUser(false), [FIRST]);
    expect(await screen.findByText(LOGIN_PROMPT)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: '注册' })).toHaveAttribute('href', '/register');
    expect(urls.some((raw) => new URL(raw, 'http://krypton.local').pathname === '/problem-sets')).toBe(false);
    expect(screen.queryByRole('heading', { name: '进行中的题目集' })).toBeNull();
    expectLegacyEntriesGone();
  });
});
