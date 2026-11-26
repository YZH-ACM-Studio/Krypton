import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { teachPath, type TeachType } from '@hydrooj/common';
import type { ComponentType } from 'react';
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';
import { BootstrapProvider, type KryptonBootstrap, type KryptonUrls, type KryptonUser } from '../../src/lib/bootstrap.tsx';
import { teachSetTypeLabel } from '../../src/pages/teach/shared-preview-dialog.tsx';

// A static import fails collection while teacher-home.tsx is absent.
const pageLoaders = import.meta.glob('../../src/pages/home/teacher-home.tsx');

const PAGE_SOURCE = 'src/pages/home/teacher-home.tsx';
const NOW_ISO = '2026-10-21T06:32:00.000Z';
const CREATED_AT = '2026-10-11T12:00:00.000Z';
const DOMAIN = '航院程序设计';
const COURSE_ERROR = '你不能查看课程。';
const COURSE_FALLBACK = '课程列表暂时不能查看。';
const ANNOUNCE_TITLE = '期中考试安排与机房分配';
const EMPTY_SETS = '没有进行中或即将开始的题目集';
const EMPTY_COURSES = '还没有课程';
const SEARCH_PLACEHOLDER = '题号或标题\u2026';
const NOT_STARTED = '\u2014';
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SET_HREF = /^\/teach\/(?:homework|exam|acm|oi|practice)\/[0-9a-f]{24}$/i;
const COURSE_HREF = /^\/course\/[0-9a-f]{24}\/edit$/i;

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

type SetStatus = 'running' | 'upcoming';
type CourseRole = 'owner' | 'maintainer' | 'admin';

interface SetFixture {
  type: TeachType;
  id: string;
  rule: string;
  title: string;
  status: SetStatus;
  beginAt: string;
  endAt: string;
  participantCount: number;
}

interface CourseFixture {
  id: string;
  title: string;
  term: string;
  hidden: boolean;
  groupNames: string[];
  chapterCount: number;
  videoCount: number;
  problemCount: number;
  boundStudentCount: number | null;
  role: CourseRole;
  createdAt: string;
}

interface HomeFixture {
  running: SetFixture[];
  upcoming: SetFixture[];
  courses: CourseFixture[];
  canBrowseProblemBank?: boolean;
  courseError?: string;
}

const originalLocation = window.location;

function objectId(n: number): string {
  return `64b7c3a2e4b0f96d1a2c${n.toString(16).padStart(4, '0')}`;
}

function setFixture(
  n: number,
  type: TeachType,
  title: string,
  status: SetStatus,
  beginAt: string,
  endAt: string,
  participantCount: number,
): SetFixture {
  return {
    type,
    id: objectId(n),
    rule: type,
    title,
    status,
    beginAt,
    endAt,
    participantCount,
  };
}

function courseFixture(
  n: number,
  title: string,
  groupNames: string[],
  chapterCount: number,
  videoCount: number,
  hidden: boolean,
): CourseFixture {
  return {
    id: objectId(100 + n),
    title,
    term: '2026 秋',
    hidden,
    groupNames,
    chapterCount,
    videoCount,
    problemCount: chapterCount,
    boundStudentCount: groupNames.length === 0 ? null : 30,
    role: 'owner',
    createdAt: CREATED_AT,
  };
}

const LOOP = setFixture(1, 'homework', '第三章循环结构', 'running', '2026-10-18T00:00:00.000Z', '2026-10-22T04:00:00.000Z', 38);
const RETAKE = setFixture(2, 'exam', '第一单元补考', 'running', '2026-10-20T01:00:00.000Z', '2026-10-21T07:30:00.000Z', 12);
const MIDTERM = setFixture(3, 'exam', '期中测验', 'upcoming', '2026-10-23T08:00:00.000Z', '2026-10-23T10:00:00.000Z', 0);
const WARMUP = setFixture(4, 'acm', '校赛热身赛', 'upcoming', '2026-10-24T08:00:00.000Z', '2026-10-24T12:00:00.000Z', 0);
const FUNCTIONS = setFixture(5, 'homework', '第五章函数', 'upcoming', '2026-10-26T08:00:00.000Z', '2026-10-27T00:00:00.000Z', 0);
const ARRAYS = setFixture(6, 'homework', '第六章数组', 'upcoming', '2026-10-27T08:00:00.000Z', '2026-10-28T00:00:00.000Z', 0);
const POINTERS = setFixture(7, 'homework', '第七章指针', 'upcoming', '2026-10-28T08:00:00.000Z', '2026-10-29T00:00:00.000Z', 0);
const STRUCTS = setFixture(8, 'homework', '第八章结构', 'upcoming', '2026-10-29T08:00:00.000Z', '2026-10-30T00:00:00.000Z', 0);
const NEXT_MORNING = setFixture(9, 'homework', '次日清晨场', 'upcoming', '2026-10-22T00:00:00.000Z', '2026-10-22T02:00:00.000Z', 0);
const FOUR_DAYS = setFixture(10, 'exam', '二十五日午后场', 'upcoming', '2026-10-25T05:00:00.000Z', '2026-10-25T07:00:00.000Z', 0);
const EARLIEST_UPCOMING = setFixture(40, 'homework', '最早的即将开始', 'upcoming', '2026-10-21T07:00:00.000Z', '2026-10-21T09:00:00.000Z', 0);
const LIST_PAGE_SIZE = 20;

function laterUpcoming(index: number): SetFixture {
  const beginMs = Date.parse('2026-10-22T00:00:00.000Z') + index * DAY_MS;
  const beginAt = new Date(beginMs).toISOString();
  const endAt = new Date(beginMs + 2 * 60 * 60 * 1000).toISOString();
  return setFixture(40 + index, 'homework', `稍后场次${index}`, 'upcoming', beginAt, endAt, 0);
}

const PAGED_UPCOMING = [EARLIEST_UPCOMING, ...Array.from({ length: LIST_PAGE_SIZE }, (_item, index) => laterUpcoming(index + 1))];

const INTRO = courseFixture(1, '程序设计基础', ['一班', '二班'], 6, 14, false);
const DATA_STRUCT = courseFixture(2, '数据结构', ['三班'], 8, 20, false);
const ALGO = courseFixture(3, '算法竞赛入门', [], 4, 6, true);
const PYTHON = courseFixture(4, 'Python 编程', ['一班'], 3, 9, false);
const OS_COURSE = courseFixture(5, '操作系统', ['二班'], 5, 7, false);
const COMPILER = courseFixture(6, '编译原理', ['三班'], 9, 11, false);
const FOUR_COURSES = [INTRO, DATA_STRUCT, ALGO, PYTHON];
const SIX_COURSES = [...FOUR_COURSES, OS_COURSE, COMPILER];

function pageLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(pageLoaders)) {
    if (key.endsWith(PAGE_SOURCE)) return load;
  }
  return undefined;
}

async function importPageModule(load: () => Promise<unknown>): Promise<unknown> {
  try {
    return await load();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect.fail(message);
  }
}

async function loadTeacherHomePage(): Promise<ComponentType> {
  const load = pageLoader();
  expect(typeof load, PAGE_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${PAGE_SOURCE} must exist`);
  const imported = await importPageModule(load);
  if (typeof imported !== 'object' || imported === null || !('TeacherHomePage' in imported)) {
    throw new TypeError('TeacherHomePage must be exported');
  }
  const component: unknown = imported.TeacherHomePage;
  expect(typeof component, 'TeacherHomePage').toBe('function');
  if (typeof component !== 'function') throw new TypeError('TeacherHomePage must be a function');
  return component as ComponentType;
}

function makeUser(canBrowseProblemBank: boolean): KryptonUser {
  return {
    id: 7,
    name: '王老师',
    mail: '',
    signedIn: true,
    theme: 'light',
    viewLang: 'zh-CN',
    unreadMessages: 0,
    rp: 0,
    bio: '',
    priv: 0,
    role: 'teacher',
    tfa: false,
    authn: false,
    pinnedDomains: [],
    canBrowseProblemBank,
    canTeach: true,
  };
}

function makeBootstrap(canBrowseProblemBank: boolean): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: NOW_ISO,
    user: makeUser(canBrowseProblemBank),
    domain: {
      id: 'system', name: DOMAIN, bulletin: '', avatar: '',
    },
    urls: URLS,
    udict: {},
    page: { templateName: 'main.html', data: {} },
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
      name: 'ForbiddenError',
      errorCode: 'ForbiddenError',
      code: status,
      status,
      params: [],
      message,
    },
  }, status);
}

function canCreate(open: boolean) {
  return {
    practice: open,
    homework: open,
    exam: open,
    acm: open,
    oi: open,
  };
}

function listBody(
  status: SetStatus,
  rows: readonly SetFixture[],
  paging?: { page: number; pageCount: number; total: number },
) {
  const page = paging?.page ?? 1;
  const pageCount = paging?.pageCount ?? 1;
  const total = paging?.total ?? rows.length;
  return {
    scope: 'mine',
    canSeeAll: true,
    filter: { type: 'all', status, q: '' },
    typeCounts: {
      all: total,
      practice: 0,
      homework: total,
      exam: 0,
      contest: 0,
    },
    page,
    pageCount,
    total,
    rows: rows.map((row) => ({
      type: row.type,
      id: row.id,
      rule: row.rule,
      title: row.title,
      status: row.status,
      beginAt: row.beginAt,
      endAt: row.endAt,
      durationMinutes: null,
      audience: '计科 2401',
      problemCount: 8,
      drawCount: null,
      stageCount: null,
      participantCount: row.participantCount,
      role: 'owner',
      shared: false,
      createdAt: CREATED_AT,
    })),
    sharedRows: [],
    canCreate: canCreate(true),
  };
}

function pageNumber(url: URL): number {
  const raw = url.searchParams.get('page');
  if (raw === null || raw === '') return 1;
  const page = Number(raw);
  if (!Number.isSafeInteger(page) || page < 1) return 1;
  return page;
}

function upcomingBody(rows: readonly SetFixture[], page: number) {
  if (rows.length <= LIST_PAGE_SIZE) return listBody('upcoming', rows);
  // 服务端按新近程度分页，不按 beginAt。较晚的 20 条在第 1 页，最早的一条在第 2 页。
  const laterFirst = [...rows].sort((left, right) => Date.parse(right.beginAt) - Date.parse(left.beginAt) || right.id.localeCompare(left.id));
  const total = laterFirst.length;
  const pageCount = Math.ceil(total / LIST_PAGE_SIZE);
  const start = (page - 1) * LIST_PAGE_SIZE;
  return listBody('upcoming', laterFirst.slice(start, start + LIST_PAGE_SIZE), { page, pageCount, total });
}

function courseBody(rows: readonly CourseFixture[]) {
  return {
    scope: 'mine',
    canSeeAll: true,
    canCreate: true,
    q: '',
    rows,
  };
}

function installFetch(fixture: HomeFixture): string[] {
  const urls: string[] = [];
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
    const scope = url.searchParams.get('scope');
    const status = url.searchParams.get('status');
    if (url.pathname === '/teach' && scope === 'mine' && status === 'running') {
      return Promise.resolve(jsonResponse(listBody('running', fixture.running)));
    }
    if (url.pathname === '/teach' && scope === 'mine' && status === 'upcoming') {
      return Promise.resolve(jsonResponse(upcomingBody(fixture.upcoming, pageNumber(url))));
    }
    if (url.pathname === '/teach/courses' && scope === 'mine') {
      if (fixture.courseError !== undefined) return Promise.resolve(hydroError(fixture.courseError, 403));
      return Promise.resolve(jsonResponse(courseBody(fixture.courses)));
    }
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return urls;
}

async function renderTeacherHome(fixture: HomeFixture): Promise<string[]> {
  const urls = installFetch(fixture);
  const TeacherHomePage = await loadTeacherHomePage();
  render(
    <BootstrapProvider bootstrap={makeBootstrap(fixture.canBrowseProblemBank !== false)}>
      <TeacherHomePage />
    </BootstrapProvider>,
  );
  return urls;
}

function asked(urls: readonly string[], pathname: string, params: Record<string, string>): boolean {
  return urls.some((raw) => {
    const url = new URL(raw, 'http://krypton.local');
    if (url.pathname !== pathname) return false;
    return Object.entries(params).every(([key, value]) => url.searchParams.get(key) === value);
  });
}

function expectDataRequests(urls: readonly string[]) {
  expect(asked(urls, '/teach', { scope: 'mine', status: 'running' })).toBe(true);
  expect(asked(urls, '/teach', { scope: 'mine', status: 'upcoming' })).toBe(true);
  expect(asked(urls, '/teach/courses', { scope: 'mine' })).toBe(true);
}

function linksNamed(name: string): HTMLAnchorElement[] {
  return screen.getAllByRole('link', { name }).filter((link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement);
}

function linksMatching(pattern: RegExp): HTMLAnchorElement[] {
  return screen.getAllByRole('link').filter((link): link is HTMLAnchorElement => {
    return link instanceof HTMLAnchorElement && pattern.test(link.getAttribute('href') ?? '');
  });
}

function linkByTitle(links: readonly HTMLAnchorElement[], title: string): HTMLAnchorElement {
  const link = links.find((item) => (item.textContent ?? '').includes(title));
  if (link === undefined) throw new TypeError(`missing link ${title}`);
  return link;
}

function titlesOf(links: readonly HTMLAnchorElement[], known: readonly string[]): string[] {
  return links.map((link) => {
    const text = link.textContent ?? '';
    const title = known.find((item) => text.includes(item));
    if (title === undefined) throw new TypeError(`unexpected row ${text}`);
    return title;
  });
}

function shanghaiLabel(iso: string, suffix: '截止' | '开始'): string {
  const shifted = new Date(Date.parse(iso) + SHANGHAI_OFFSET_MS);
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const hour = String(shifted.getUTCHours()).padStart(2, '0');
  const minute = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${month}月${day}日 ${hour}:${minute} ${suffix}`;
}

function shanghaiDayStart(ms: number): number {
  const shifted = new Date(ms + SHANGHAI_OFFSET_MS);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

function dayPhrase(beginAt: string): string {
  const days = Math.round((shanghaiDayStart(Date.parse(beginAt)) - shanghaiDayStart(Date.parse(NOW_ISO))) / DAY_MS);
  return `${days} 天后`;
}

function chapterLine(course: CourseFixture): string {
  return `${course.chapterCount} 章 \u00B7 ${course.videoCount} 个视频`;
}

function metricValue(label: string): string {
  const nodes = screen.getAllByText((_content, element) => {
    if (!(element instanceof HTMLElement)) return false;
    if (element.closest('h1, h2, h3')) return false;
    let own = '';
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) own += child.textContent ?? '';
    }
    return own.trim() === label;
  });
  const found: string[] = [];
  for (const node of nodes) {
    let current: HTMLElement | null = node;
    for (let depth = 0; depth < 5 && current; depth += 1) {
      const compact = (current.textContent ?? '').replace(/\s+/g, '');
      const match = compact.match(new RegExp(`^${label}(\\d+)$`));
      if (match?.[1] !== undefined) {
        found.push(match[1]);
        break;
      }
      current = current.parentElement;
    }
  }
  expect(found, label).toHaveLength(1);
  return found[0] ?? '';
}

function expectOnlyCreatePrimary() {
  const actions = [...document.querySelectorAll<HTMLElement>('[data-variant="primary"]')];
  expect(actions).toHaveLength(1);
  const action = actions[0];
  if (!(action instanceof HTMLElement)) throw new TypeError('primary action');
  expect(action).toHaveTextContent('新建题目集');
  const href = action.getAttribute('href') ?? action.querySelector('a')?.getAttribute('href');
  expect(href).toBe('/teach/new');
}

function expectSetCopy(row: SetFixture) {
  const link = linkByTitle(linksMatching(SET_HREF), row.title);
  expect(link).toHaveAttribute('href', teachPath(row.type, row.id));
  expect(link).toHaveTextContent(teachSetTypeLabel(row.type, row.rule));
  if (row.status === 'running') {
    expect(link).toHaveTextContent(shanghaiLabel(row.endAt, '截止'));
    expect(link.textContent ?? '').toMatch(/还剩|剩余|\d+\s*小时|\d+\s*分钟/);
    expect(link).toHaveTextContent(`${row.participantCount} 人参加`);
    return;
  }
  expect(link).toHaveTextContent(shanghaiLabel(row.beginAt, '开始'));
  expect(link).toHaveTextContent(dayPhrase(row.beginAt));
  // D8 写成未开始一律「—」，本 lane 写成未开始且人数为 0 才「—」。夹具人数是 0，两种读法一致。
  expect(link).toHaveTextContent(NOT_STARTED);
  expect(link).not.toHaveTextContent('人参加');
}

function stubAssign(): ReturnType<typeof vi.fn<(url: string) => void>> {
  const assign = vi.fn<(url: string) => void>();
  const current = window.location;
  let href = current.href;
  const record = (url: string) => {
    href = url;
    assign(url);
  };
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      origin: current.origin,
      pathname: current.pathname,
      search: current.search,
      hash: current.hash,
      assign: record,
      replace: record,
      get href() {
        return href;
      },
      set href(value: string) {
        record(value);
      },
    },
  });
  return assign;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('teacher home page', () => {
  it('shows running totals ahead of upcoming rows and lists the courses', async () => {
    const urls = await renderTeacherHome({
      running: [RETAKE, LOOP],
      upcoming: [FUNCTIONS, MIDTERM, WARMUP],
      courses: FOUR_COURSES,
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: DOMAIN })).toBeInTheDocument();
      expect(screen.getByText(LOOP.title)).toBeInTheDocument();
      expect(screen.getByText(INTRO.title)).toBeInTheDocument();
    });

    expect(metricValue('进行中')).toBe('2');
    expect(metricValue('即将开始')).toBe('3');
    expect(metricValue('我的课程')).toBe('4');
    expect(titlesOf(linksMatching(SET_HREF), [LOOP.title, RETAKE.title, MIDTERM.title, WARMUP.title, FUNCTIONS.title])).toEqual([
      LOOP.title,
      RETAKE.title,
      MIDTERM.title,
      WARMUP.title,
      FUNCTIONS.title,
    ]);
    expectSetCopy(LOOP);
    expectSetCopy(RETAKE);
    expectSetCopy(MIDTERM);
    expectSetCopy(WARMUP);
    expectSetCopy(FUNCTIONS);

    const courses = linksMatching(COURSE_HREF);
    expect(titlesOf(courses, FOUR_COURSES.map((course) => course.title))).toEqual(FOUR_COURSES.map((course) => course.title));
    const intro = linkByTitle(courses, INTRO.title);
    expect(intro).toHaveAttribute('href', `/course/${INTRO.id}/edit`);
    expect(intro).toHaveTextContent(chapterLine(INTRO));
    expect(intro).toHaveTextContent('一班');
    expect(intro).toHaveTextContent('二班');
    expect(intro).not.toHaveTextContent('已隐藏');
    const hidden = linkByTitle(courses, ALGO.title);
    expect(hidden).toHaveAttribute('href', `/course/${ALGO.id}/edit`);
    expect(hidden).toHaveTextContent('已隐藏');
    expect(hidden).toHaveTextContent('全站可见');
    expect(hidden).toHaveTextContent(chapterLine(ALGO));
    expect(linkByTitle(courses, DATA_STRUCT.title)).toHaveTextContent('三班');
    expect(linkByTitle(courses, PYTHON.title)).toHaveTextContent(chapterLine(PYTHON));

    const allHrefs = linksNamed('全部').map((link) => link.getAttribute('href'));
    expect(allHrefs).toContain('/teach');
    expect(allHrefs).toContain('/teach/courses');
    expect(screen.getByRole('heading', { name: '我的题目集' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '我的课程' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '最新公告' })).toBeInTheDocument();
    expect(screen.getByText(ANNOUNCE_TITLE)).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expectOnlyCreatePrimary();
    expectDataRequests(urls);
  });

  it('keeps the list totals while showing only five set rows and five courses', async () => {
    await renderTeacherHome({
      running: [RETAKE, LOOP],
      upcoming: [STRUCTS, WARMUP, POINTERS, MIDTERM, ARRAYS, FUNCTIONS],
      courses: SIX_COURSES,
    });

    await waitFor(() => {
      expect(screen.getByText(OS_COURSE.title)).toBeInTheDocument();
      expect(screen.queryByText(COMPILER.title)).toBeNull();
      expect(screen.queryByText(ARRAYS.title)).toBeNull();
    });

    expect(metricValue('进行中')).toBe('2');
    expect(metricValue('即将开始')).toBe('6');
    expect(metricValue('我的课程')).toBe('6');
    expect(titlesOf(linksMatching(SET_HREF), [LOOP.title, RETAKE.title, MIDTERM.title, WARMUP.title, FUNCTIONS.title])).toEqual([
      LOOP.title,
      RETAKE.title,
      MIDTERM.title,
      WARMUP.title,
      FUNCTIONS.title,
    ]);
    expect(screen.queryByText(POINTERS.title)).toBeNull();
    expect(screen.queryByText(STRUCTS.title)).toBeNull();
    expect(titlesOf(linksMatching(COURSE_HREF), SIX_COURSES.map((course) => course.title))).toEqual([
      INTRO.title,
      DATA_STRUCT.title,
      ALGO.title,
      PYTHON.title,
      OS_COURSE.title,
    ]);
  });

  it('links a homework row to the teach workbench and a course row to the editor', async () => {
    await renderTeacherHome({
      running: [LOOP],
      upcoming: [],
      courses: [INTRO],
    });

    await waitFor(() => {
      expect(screen.getByText(LOOP.title)).toBeInTheDocument();
      expect(screen.getByText(INTRO.title)).toBeInTheDocument();
    });

    expect(linkByTitle(linksMatching(SET_HREF), LOOP.title)).toHaveAttribute('href', teachPath('homework', LOOP.id));
    expect(linkByTitle(linksMatching(COURSE_HREF), INTRO.title)).toHaveAttribute('href', `/course/${INTRO.id}/edit`);
  });

  it('uses one primary action for creating a set', async () => {
    await renderTeacherHome({
      running: [LOOP],
      upcoming: [MIDTERM],
      courses: [INTRO],
    });

    await screen.findByText(LOOP.title);
    expectOnlyCreatePrimary();
    expect(screen.getByRole('link', { name: '新建题目集' })).toHaveAttribute('href', '/teach/new');
  });

  it('hides problem search without bank permission', async () => {
    await renderTeacherHome({
      running: [LOOP],
      upcoming: [MIDTERM],
      courses: [INTRO],
      canBrowseProblemBank: false,
    });

    await screen.findByText(LOOP.title);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).toBeNull();
    expect(screen.queryByRole('button', { name: '搜索' })).toBeNull();
    expect(screen.queryByRole('link', { name: '搜索' })).toBeNull();
  });

  it('shows the course error beside the sets', async () => {
    const urls = await renderTeacherHome({
      running: [RETAKE, LOOP],
      upcoming: [MIDTERM],
      courses: FOUR_COURSES,
      courseError: COURSE_ERROR,
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(COURSE_ERROR);
      expect(screen.getByText(LOOP.title)).toBeInTheDocument();
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(COURSE_ERROR);
    expect(alert).not.toHaveTextContent(COURSE_FALLBACK);

    expect(screen.queryByText(INTRO.title)).toBeNull();
    expect(screen.queryByText(EMPTY_COURSES)).toBeNull();
    expect(linksMatching(COURSE_HREF)).toHaveLength(0);
    expect(linkByTitle(linksMatching(SET_HREF), LOOP.title)).toHaveAttribute('href', teachPath('homework', LOOP.id));
    expect(linkByTitle(linksMatching(SET_HREF), RETAKE.title)).toHaveAttribute('href', teachPath('exam', RETAKE.id));
    expectDataRequests(urls);
  });

  it('shows the two empty states', async () => {
    await renderTeacherHome({
      running: [],
      upcoming: [],
      courses: [],
    });

    await waitFor(() => {
      expect(screen.getByText(EMPTY_SETS)).toBeInTheDocument();
      expect(screen.getByText(EMPTY_COURSES)).toBeInTheDocument();
    });

    expect(metricValue('进行中')).toBe('0');
    expect(metricValue('即将开始')).toBe('0');
    expect(metricValue('我的课程')).toBe('0');
    expect(linksMatching(SET_HREF)).toHaveLength(0);
    expect(linksMatching(COURSE_HREF)).toHaveLength(0);
    const create = screen.getByRole('link', { name: '新建' });
    const sets = screen.getByRole('heading', { name: '我的题目集' });
    const panel = sets.closest('[data-slot="panel"]');
    if (!(panel instanceof HTMLElement)) throw new TypeError('missing set panel');
    expect(within(panel).getByRole('link', { name: '新建' })).toBe(create);
    // 空状态只规定链接文案「新建」，地址与页头同一个新建入口。
    expect(create).toHaveAttribute('href', '/teach/new');
    expectOnlyCreatePrimary();
  });

  it('counts upcoming days on the Shanghai calendar', async () => {
    await renderTeacherHome({
      running: [],
      upcoming: [FOUR_DAYS, NEXT_MORNING],
      courses: [],
    });

    await screen.findByText(NEXT_MORNING.title);
    const morning = linkByTitle(linksMatching(SET_HREF), NEXT_MORNING.title);
    expect(morning).toHaveTextContent('1 天后');
    expect(morning).not.toHaveTextContent('0 天后');
    const afternoon = linkByTitle(linksMatching(SET_HREF), FOUR_DAYS.title);
    expect(afternoon).toHaveTextContent('4 天后');
    expect(afternoon).not.toHaveTextContent('3 天后');
  });

  it('keeps the upcoming total when the earliest row is on the next page', async () => {
    await renderTeacherHome({
      running: [RETAKE, LOOP],
      upcoming: PAGED_UPCOMING,
      courses: [],
    });

    await waitFor(() => {
      expect(metricValue('即将开始')).toBe('21');
      expect(screen.getByText(EARLIEST_UPCOMING.title)).toBeInTheDocument();
    });

    const shown = linksMatching(SET_HREF);
    expect(shown).toHaveLength(5);
    expect(shown.some((link) => (link.textContent ?? '').includes(EARLIEST_UPCOMING.title))).toBe(true);
  });

  it('submits problem search to the problem list', async () => {
    await renderTeacherHome({
      running: [LOOP],
      upcoming: [],
      courses: [],
    });

    const field = await screen.findByRole('searchbox');
    const assign = stubAssign();
    const user = userEvent.setup();
    await user.type(field, '二分 查找');
    await user.click(screen.getByRole('button', { name: '搜索' }));

    expect(assign).toHaveBeenCalled();
    const target = assign.mock.calls.map((call) => call[0]).find((value) => value.includes('/p'));
    if (typeof target !== 'string') throw new TypeError('search navigation');
    const url = new URL(target, 'http://krypton.local');
    expect(url.pathname).toBe('/p');
    expect(url.searchParams.get('q')).toBe('二分 查找');
  });
});
