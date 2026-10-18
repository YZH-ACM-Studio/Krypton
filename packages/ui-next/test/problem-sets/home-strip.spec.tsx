import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap, type KryptonUrls, type KryptonUser } from '../../src/lib/bootstrap.tsx';
import { KryptonHomePage } from '../../src/pages/home.tsx';

const RUNNING_URL = '/problem-sets?tab=running';
const TRAINING_URL = '/problem-sets';
const CONTESTS_URL = '/contest';
const HOMEWORK_URL = '/homework';
const BEGIN_AT = '2026-10-18T08:00:00+08:00';
const END_AT = '2026-10-18T18:00:00+08:00';
const EMPTY_TITLE = '现在没有要做的题目集';
const LOAD_FAILED = '加载题目集失败';
const STRIP_TITLE = '进行中的题目集';

const DONE_TITLE = '已经做完的作业';
const TEAM_TITLE = '开放中的组队批次';
const FIRST_TITLE = '第一次未完成作业';
const SECOND_TITLE = '第二次未完成作业';
const FOURTH_TITLE = '第四次未完成作业';
const FIFTH_TITLE = '第五次未完成作业';
const LEGACY_CONTEST = '旧比赛面板';
const LEGACY_HOMEWORK = '旧作业面板';
const LEGACY_TRAINING = '旧题集面板';

interface ContestFixture {
  kind: 'homework';
  id: string;
  flavor: 'homework';
  title: string;
  href: string;
  beginAt: string;
  endAt: string;
  dueAt: string | null;
  durationMinutes: number | null;
  startAt: string | null;
  personalEndAt: string | null;
  attended: boolean;
  clientRequired: boolean;
  team: boolean;
  problemCount: number;
  progress: { answered: number };
  finalized: boolean;
  done: boolean;
}

interface TeamFixture {
  kind: 'team';
  id: string;
  title: string;
  href: string;
  description: string;
  myState: 'none';
  inviteCount: number;
  memberCount: null;
}

type StripRow = ContestFixture | TeamFixture;

function homeworkRow(id: string, title: string, done: boolean): ContestFixture {
  return {
    kind: 'homework',
    id,
    flavor: 'homework',
    title,
    href: `/homework/${id}`,
    beginAt: BEGIN_AT,
    endAt: END_AT,
    dueAt: END_AT,
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

// Team rows have no done field. The row view treats them as not done, so they occupy a strip slot.
function teamRow(id: string, title: string): TeamFixture {
  return {
    kind: 'team',
    id,
    title,
    href: `/teams/${id}`,
    description: '每队 1–3 人',
    myState: 'none',
    inviteCount: 0,
    memberCount: null,
  };
}

function runningBody(rows: StripRow[], running: number) {
  return {
    tab: 'running' as const,
    counts: { running, upcoming: 1, practice: 2 },
    rows,
    practice: null,
    ended: null,
  };
}

const URLS: KryptonUrls = {
  home: '/',
  problems: '/p',
  contests: CONTESTS_URL,
  homework: HOMEWORK_URL,
  training: TRAINING_URL,
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

function makeUser(signedIn: boolean, canTeach: boolean): KryptonUser {
  return {
    id: 7,
    name: signedIn ? '同学甲' : '游客',
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
    canTeach,
  };
}

function legacyHomeData() {
  return {
    contents: [{
      sections: [
        ['contest', [[{ docId: 'old-contest', title: LEGACY_CONTEST, beginAt: BEGIN_AT, endAt: END_AT }], {}]],
        ['homework', [[{ docId: 'old-homework', title: LEGACY_HOMEWORK, penaltySince: END_AT, endAt: END_AT }], {}]],
        ['training', [[{ docId: 'old-training', title: LEGACY_TRAINING }], {}]],
      ],
    }],
  };
}

function makeBootstrap(user: KryptonUser): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: '2026-10-18T14:00:00+08:00',
    user,
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: URLS,
    udict: {},
    page: { templateName: 'main.html', data: legacyHomeData() },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestTarget(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    if (input.startsWith('http://') || input.startsWith('https://')) {
      const url = new URL(input);
      return `${url.pathname}${url.search}`;
    }
    return input;
  }
  if (input instanceof URL) return `${input.pathname}${input.search}`;
  const url = new URL(input.url);
  return `${url.pathname}${url.search}`;
}

function installFetch(onRunning: () => Promise<Response>): string[] {
  const urls: string[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const url = requestTarget(input);
    urls.push(url);
    if (url === '/api/announce/homepage') return Promise.resolve(jsonResponse({ docs: [] }));
    if (url === '/api/collect/pending') return Promise.resolve(jsonResponse({ count: 0, docs: [] }));
    if (url === RUNNING_URL) return onRunning();
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return urls;
}

function renderHome(user: KryptonUser) {
  return render(
    <BootstrapProvider bootstrap={makeBootstrap(user)}>
      <KryptonHomePage />
    </BootstrapProvider>,
  );
}

function linkHrefs(): string[] {
  return screen.getAllByRole('link').map((link) => link.getAttribute('href') ?? '');
}

function expectLegacyEntriesGone() {
  expect(screen.queryByText('查看比赛')).toBeNull();
  expect(screen.queryByRole('heading', { name: '比赛' })).toBeNull();
  expect(screen.queryByRole('heading', { name: '作业' })).toBeNull();
  expect(screen.queryByRole('heading', { name: '题集' })).toBeNull();
  expect(screen.queryByText('比赛')).toBeNull();
  expect(screen.queryByText('题集')).toBeNull();
  expect(screen.queryByText(LEGACY_CONTEST)).toBeNull();
  expect(screen.queryByText(LEGACY_HOMEWORK)).toBeNull();
  expect(screen.queryByText(LEGACY_TRAINING)).toBeNull();
  const hrefs = linkHrefs();
  expect(hrefs).not.toContain(CONTESTS_URL);
  expect(hrefs).not.toContain(HOMEWORK_URL);
}

async function settleHomepage(urls: string[]) {
  await waitFor(() => {
    expect(urls).toContain('/api/announce/homepage');
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('home in-progress strip', () => {
  it('requests the running tab and renders only the first three unfinished rows', async () => {
    const urls = installFetch(() => Promise.resolve(jsonResponse(runningBody([
      homeworkRow('done-1', DONE_TITLE, true),
      teamRow('batch-1', TEAM_TITLE),
      homeworkRow('hw-1', FIRST_TITLE, false),
      homeworkRow('hw-2', SECOND_TITLE, false),
      homeworkRow('hw-4', FOURTH_TITLE, false),
      homeworkRow('hw-5', FIFTH_TITLE, false),
    ], 7))));
    renderHome(makeUser(true, false));

    expect(await screen.findByRole('heading', { name: STRIP_TITLE })).toBeTruthy();
    expect(urls).toContain(RUNNING_URL);
    expect(screen.getByRole('link', { name: '全部 7 项' }).getAttribute('href')).toBe(TRAINING_URL);
    expect(screen.getByText(TEAM_TITLE)).toBeTruthy();
    expect(screen.getByText(FIRST_TITLE)).toBeTruthy();
    expect(screen.getByText(SECOND_TITLE)).toBeTruthy();
    expect(screen.queryByText(DONE_TITLE)).toBeNull();
    expect(screen.queryByText(FOURTH_TITLE)).toBeNull();
    expect(screen.queryByText(FIFTH_TITLE)).toBeNull();
    expect(screen.getByRole('heading', { name: '讨论' })).toBeTruthy();
    expectLegacyEntriesGone();
  });

  it('shows the empty state when every running row is already finished', async () => {
    installFetch(() => Promise.resolve(jsonResponse(runningBody([
      homeworkRow('done-1', DONE_TITLE, true),
    ], 2))));
    renderHome(makeUser(true, false));

    expect(await screen.findByText(EMPTY_TITLE)).toBeTruthy();
    expect(screen.getByRole('heading', { name: STRIP_TITLE })).toBeTruthy();
    expect(screen.getByRole('link', { name: '全部 2 项' }).getAttribute('href')).toBe(TRAINING_URL);
    expect(screen.queryByText(DONE_TITLE)).toBeNull();
  });

  it('shows the empty state when the running list has no rows', async () => {
    installFetch(() => Promise.resolve(jsonResponse(runningBody([], 0))));
    renderHome(makeUser(true, false));

    expect(await screen.findByText(EMPTY_TITLE)).toBeTruthy();
    expect(screen.getByRole('link', { name: '全部 0 项' }).getAttribute('href')).toBe(TRAINING_URL);
  });

  it('shows a danger alert when the running list fails to load', async () => {
    installFetch(() => Promise.reject(new TypeError('offline')));
    renderHome(makeUser(true, false));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(LOAD_FAILED);
    expect(screen.getByRole('heading', { name: STRIP_TITLE })).toBeTruthy();
  });

  it('does not request or render the strip for a teacher', async () => {
    const urls = installFetch(() => Promise.resolve(jsonResponse(runningBody([
      homeworkRow('hw-1', FIRST_TITLE, false),
    ], 1))));
    renderHome(makeUser(true, true));

    await settleHomepage(urls);
    expect(urls).not.toContain(RUNNING_URL);
    expect(screen.queryByRole('heading', { name: STRIP_TITLE })).toBeNull();
    expect(screen.queryByText(FIRST_TITLE)).toBeNull();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expectLegacyEntriesGone();
  });

  it('does not request or render the strip for a signed-out visitor', async () => {
    const urls = installFetch(() => Promise.resolve(jsonResponse(runningBody([
      homeworkRow('hw-1', FIRST_TITLE, false),
    ], 1))));
    renderHome(makeUser(false, false));

    await settleHomepage(urls);
    expect(urls).not.toContain(RUNNING_URL);
    expect(screen.queryByRole('heading', { name: STRIP_TITLE })).toBeNull();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expectLegacyEntriesGone();
  });
});
