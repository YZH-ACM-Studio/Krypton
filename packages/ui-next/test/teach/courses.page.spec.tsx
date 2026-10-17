import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';

// A static import fails collection while courses.tsx is absent.
const pageLoaders = import.meta.glob('../../src/pages/teach/courses.tsx');

const PAGE_SOURCE = 'src/pages/teach/courses.tsx';
const PAGE_DESCRIPTION = '你创建或协作管理的课程。';
const EMPTY_TITLE = '还没有课程';
const EMPTY_DESCRIPTION = '新建一门课程，按章节组织视频、讲义和题目。';
const CREATE_FALLBACK = '创建课程失败';
const SERVER_MESSAGE = '这门课现在创建不了。';
const TERM_PLACEHOLDER = '2026 秋';
const INITIAL_CHAPTERS = JSON.stringify([{ _id: 1, title: '第一章', pids: [], tids: [] }]);
const DATA_ID = '64b7c3a2e4b0f96d1a2c3d71';
const ALGO_ID = '64b7c3a2e4b0f96d1a2c3d72';
const NET_ID = '64b7c3a2e4b0f96d1a2c3d73';
const NEW_ID = '64b7c3a2e4b0f96d1a2c3d80';
const DATA_TITLE = '数据结构';
const ALGO_TITLE = '算法设计';
const NET_TITLE = '计算机网络';
const DATA_TERM = '2026 秋';
const ALGO_TERM = '2025 春';
const NET_TERM = '2024 秋';
const GROUP_A = '计科 2401';
const GROUP_B = '计科 2402';
const GROUP_C = '网工 2301';
const CREATED_AT = '2026-10-11T12:00:00.000Z';
const ROLE_LABEL = {
  owner: '所有者',
  maintainer: '协作者',
  admin: '管理员',
} as const;

type CourseRole = keyof typeof ROLE_LABEL;
type FetchMock = ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;

interface TeachCourseRow {
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

interface TeachCourseListPayload {
  scope: 'mine' | 'all';
  canSeeAll: boolean;
  canCreate: boolean;
  q: string;
  rows: TeachCourseRow[];
}

const originalLocation = window.location;

function pageBootstrap(data: TeachCourseListPayload): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-17T00:00:00.000Z',
    user: {
      id: 7,
      name: 'teacher',
      mail: '',
      signedIn: true,
      theme: 'light',
      viewLang: 'zh_CN',
      unreadMessages: 0,
      rp: 0,
      bio: '',
      priv: 0,
      role: 'teacher',
      tfa: false,
      authn: false,
      pinnedDomains: [],
      canBrowseProblemBank: true,
    },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'teach_courses.html', data },
  };
}

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

async function loadTeachCourseListPage(): Promise<ComponentType> {
  const load = pageLoader();
  expect(typeof load, PAGE_SOURCE).toBe('function');
  if (typeof load !== 'function') {
    throw new TypeError(`${PAGE_SOURCE} must exist`);
  }
  const imported = await importPageModule(load);
  if (typeof imported !== 'object' || imported === null || !('TeachCourseListPage' in imported)) {
    throw new TypeError('TeachCourseListPage must be exported');
  }
  const component: unknown = imported.TeachCourseListPage;
  expect(typeof component, 'TeachCourseListPage').toBe('function');
  if (typeof component !== 'function') {
    throw new TypeError('TeachCourseListPage must be a function');
  }
  return component as ComponentType;
}

function requestUrl(input: unknown): URL {
  if (typeof input === 'string') return new URL(input, 'http://krypton.local');
  if (input instanceof URL) return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  throw new TypeError('unexpected fetch input');
}

function methodOf(init: RequestInit | undefined): string {
  const method = init?.method;
  if (typeof method !== 'string' || method === '') return 'GET';
  return method.toUpperCase();
}

function formBody(init: RequestInit | undefined): URLSearchParams | null {
  const body = init?.body;
  if (body instanceof URLSearchParams) return body;
  if (typeof body !== 'string' || body.startsWith('{') || body.startsWith('[')) return null;
  return new URLSearchParams(body);
}

function createCalls(fetchMock: FetchMock): URL[] {
  const urls: URL[] = [];
  for (const call of fetchMock.mock.calls) {
    if (methodOf(call[1]) !== 'POST') continue;
    const url = requestUrl(call[0]);
    if (url.pathname === '/course/create') urls.push(url);
  }
  return urls;
}

function createForm(fetchMock: FetchMock): URLSearchParams {
  expect(createCalls(fetchMock)).toHaveLength(1);
  const call = fetchMock.mock.calls.find((item) => {
    if (methodOf(item[1]) !== 'POST') return false;
    return requestUrl(item[0]).pathname === '/course/create';
  });
  if (call === undefined) throw new TypeError('course create request');
  const form = formBody(call[1]);
  expect(form).toBeInstanceOf(URLSearchParams);
  if (!(form instanceof URLSearchParams)) throw new TypeError('course create body');
  return form;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function hydroError(message: string, status = 400): Response {
  return jsonResponse({
    error: {
      name: 'ValidationError',
      errorCode: 'ValidationError',
      code: status,
      status,
      params: [],
      message,
    },
  }, status);
}

function installFetch(respond: (url: URL, init?: RequestInit) => Response | Promise<Response>): FetchMock {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    (input, init) => Promise.resolve(respond(requestUrl(input), init)),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function rememberLocation(payload: TeachCourseListPayload, openNew = false) {
  const params = new URLSearchParams();
  params.set('scope', payload.scope);
  if (payload.q !== '') params.set('q', payload.q);
  if (openNew) params.set('new', '1');
  window.history.replaceState(null, '', `/teach/courses?${params.toString()}`);
}

function stubAssign(): ReturnType<typeof vi.fn<(url: string) => void>> {
  const assign = vi.fn<(url: string) => void>();
  const current = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: current.href,
      origin: current.origin,
      pathname: current.pathname,
      search: current.search,
      hash: current.hash,
      assign,
      replace: vi.fn(),
    },
  });
  return assign;
}

function hrefUrl(element: Element): URL {
  const href = element.getAttribute('href');
  if (href === null || href === '') throw new TypeError('missing href');
  return new URL(href, 'http://krypton.local');
}

function expectListHref(element: Element, scope: 'mine' | 'all', q: string) {
  const url = hrefUrl(element);
  expect(url.pathname).toBe('/teach/courses');
  if (scope === 'all') {
    expect(url.searchParams.get('scope')).toBe('all');
  } else {
    const value = url.searchParams.get('scope');
    expect(value === null || value === 'mine').toBe(true);
  }
  if (q === '') {
    const query = url.searchParams.get('q');
    expect(query === null || query === '').toBe(true);
  } else {
    expect(url.searchParams.get('q')).toBe(q);
  }
}

function tablistOf(name: string): HTMLElement {
  const tab = screen.getByRole('tab', { name });
  const list = tab.closest('[role="tablist"]');
  if (!(list instanceof HTMLElement)) throw new TypeError('tablist');
  return list;
}

function tableRow(title: string): HTMLElement {
  const nodes = screen.getAllByText(title);
  for (const node of nodes) {
    const row = node.closest('tr');
    if (row instanceof HTMLElement) return row;
  }
  throw new TypeError(`missing table row for ${title}`);
}

function stackAnchor(title: string): HTMLAnchorElement {
  const lists = document.querySelectorAll('[data-slot="data-table"] ul');
  for (const list of lists) {
    for (const item of list.querySelectorAll(':scope > li')) {
      if (!(item instanceof HTMLElement)) continue;
      if (!(item.textContent ?? '').includes(title)) continue;
      const anchor = item.querySelector(':scope > a');
      if (anchor instanceof HTMLAnchorElement) return anchor;
    }
  }
  throw new TypeError(`missing stack card for ${title}`);
}

function rowStretchLink(row: HTMLElement): HTMLAnchorElement {
  for (const link of row.querySelectorAll('a')) {
    if (link.getAttribute('aria-hidden') !== 'true') continue;
    if (link.getAttribute('tabindex') !== '-1') continue;
    if (link instanceof HTMLAnchorElement) return link;
  }
  throw new TypeError('row link');
}

function columnText(row: HTMLElement, header: string): string {
  const table = row.closest('table');
  if (!(table instanceof HTMLTableElement)) throw new TypeError('table');
  const headers = [...table.querySelectorAll('thead th')].map((cell) => (cell.textContent ?? '').trim());
  const index = headers.indexOf(header);
  if (index < 0) throw new TypeError(`missing column ${header}`);
  const cell = [...row.querySelectorAll('td')][index];
  if (!(cell instanceof HTMLElement)) throw new TypeError(`missing cell ${header}`);
  return (cell.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

function badgeOf(row: HTMLElement, text: string): HTMLElement {
  const node = within(row).getByText(text);
  const badge = node.getAttribute('data-slot') === 'badge' ? node : node.closest('[data-slot="badge"]');
  if (!(badge instanceof HTMLElement)) throw new TypeError(`badge ${text}`);
  return badge;
}

function headerLabels(): string[] {
  return [...document.querySelectorAll('[data-slot="data-table"] thead th')].map((cell) => (cell.textContent ?? '').trim());
}

function searchForm(): HTMLFormElement {
  const search = screen.getByRole('searchbox');
  expect(search).toHaveAttribute('name', 'q');
  const form = search.closest('form');
  if (!(form instanceof HTMLFormElement)) throw new TypeError('search form');
  expect(form.method).toBe('get');
  const action = form.getAttribute('action');
  if (action !== null && action !== '') {
    expect(new URL(action, 'http://krypton.local').pathname).toBe('/teach/courses');
  }
  return form;
}

function formScope(form: HTMLFormElement): string | null {
  const hidden = form.querySelector('input[name="scope"]');
  if (hidden instanceof HTMLInputElement && hidden.value !== '') return hidden.value;
  const action = form.getAttribute('action');
  if (action === null || action === '') return null;
  return new URL(action, 'http://krypton.local').searchParams.get('scope');
}

function headerCreateButton(): HTMLElement | null {
  const header = document.querySelector('[data-slot="page-header"]');
  if (!(header instanceof HTMLElement)) throw new TypeError('page header');
  return within(header).queryByRole('button', { name: '新建课程' });
}

function courseRow(options: {
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
}): TeachCourseRow {
  return {
    id: options.id,
    title: options.title,
    term: options.term,
    hidden: options.hidden,
    groupNames: options.groupNames,
    chapterCount: options.chapterCount,
    videoCount: options.videoCount,
    problemCount: options.problemCount,
    boundStudentCount: options.boundStudentCount,
    role: options.role,
    createdAt: CREATED_AT,
  };
}

function dataCourse(): TeachCourseRow {
  return courseRow({
    id: DATA_ID,
    title: DATA_TITLE,
    term: DATA_TERM,
    hidden: true,
    groupNames: [GROUP_A, GROUP_B],
    chapterCount: 4,
    videoCount: 7,
    problemCount: 12,
    boundStudentCount: 36,
    role: 'owner',
  });
}

function algoCourse(): TeachCourseRow {
  return courseRow({
    id: ALGO_ID,
    title: ALGO_TITLE,
    term: ALGO_TERM,
    hidden: false,
    groupNames: [],
    chapterCount: 1,
    videoCount: 0,
    problemCount: 3,
    boundStudentCount: null,
    role: 'maintainer',
  });
}

function netCourse(): TeachCourseRow {
  return courseRow({
    id: NET_ID,
    title: NET_TITLE,
    term: NET_TERM,
    hidden: false,
    groupNames: [GROUP_C],
    chapterCount: 6,
    videoCount: 2,
    problemCount: 9,
    boundStudentCount: 18,
    role: 'admin',
  });
}

function shell(options?: {
  scope?: TeachCourseListPayload['scope'];
  canSeeAll?: boolean;
  canCreate?: boolean;
  q?: string;
  rows?: TeachCourseRow[];
}): TeachCourseListPayload {
  return {
    scope: options?.scope ?? 'mine',
    canSeeAll: options?.canSeeAll ?? false,
    canCreate: options?.canCreate ?? true,
    q: options?.q ?? '',
    rows: options?.rows ?? [dataCourse(), algoCourse()],
  };
}

function textbox(dialog: HTMLElement, name: RegExp): HTMLElement {
  const field = within(dialog).getByRole('textbox', { name });
  if (!(field instanceof HTMLElement)) throw new TypeError('textbox');
  return field;
}

function assignedPath(assign: ReturnType<typeof vi.fn<(url: string) => void>>): URL {
  expect(assign).toHaveBeenCalledTimes(1);
  const target: unknown = assign.mock.calls[0]?.[0];
  if (typeof target !== 'string') throw new TypeError('assign target');
  return new URL(target, 'http://krypton.local');
}

async function renderPage(payload: TeachCourseListPayload, openNew = false) {
  rememberLocation(payload, openNew);
  const Page = await loadTeachCourseListPage();
  return render(
    <BootstrapProvider bootstrap={pageBootstrap(payload)}>
      <Page />
    </BootstrapProvider>,
  );
}

function expectEditLink(title: string, id: string) {
  const href = `/course/${id}/edit`;
  const row = tableRow(title);
  expect(rowStretchLink(row)).toHaveAttribute('href', href);
  expect(stackAnchor(title)).toHaveAttribute('href', href);
}

function expectCount(row: HTMLElement, header: string, count: number) {
  expect(digits(columnText(row, header))).toBe(String(count));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  window.history.replaceState(null, '', '/');
});

describe('teacher course list page', () => {
  it('links each row to the course editor and shows its columns', async () => {
    const payload = shell({
      rows: [dataCourse(), algoCourse(), netCourse()],
    });
    await renderPage(payload);

    expect(screen.getByRole('heading', { level: 1, name: '课程' })).toBeInTheDocument();
    expect(screen.getByText(PAGE_DESCRIPTION)).toBeInTheDocument();
    expect(document.querySelector('[data-slot="page"]')).toHaveAttribute('data-width', 'wide');
    expect(document.querySelector('[data-slot="data-table"]')).toHaveAttribute('data-mobile', 'stack');
    const panel = document.querySelector('[data-slot="panel"]');
    if (!(panel instanceof HTMLElement)) throw new TypeError('panel');
    const body = panel.firstElementChild;
    if (!(body instanceof HTMLElement)) throw new TypeError('panel body');
    expect(body.className.split(/\s+/)).not.toContain('p-4');
    expect(headerLabels()).toEqual(['课程', '班级', '章节', '视频', '题目', '学生', '我的角色']);
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();

    const create = headerCreateButton();
    if (!(create instanceof HTMLElement)) throw new TypeError('create button');
    expect(create).toHaveAttribute('data-variant', 'primary');

    expectEditLink(DATA_TITLE, DATA_ID);
    expectEditLink(ALGO_TITLE, ALGO_ID);
    expectEditLink(NET_TITLE, NET_ID);

    const data = tableRow(DATA_TITLE);
    const algo = tableRow(ALGO_TITLE);
    const net = tableRow(NET_TITLE);
    expect(columnText(data, '课程')).toContain(DATA_TITLE);
    expect(columnText(data, '课程')).toContain(DATA_TERM);
    expect(badgeOf(data, '已隐藏')).toBeInTheDocument();
    expect(columnText(algo, '课程')).toContain(ALGO_TITLE);
    expect(columnText(algo, '课程')).toContain(ALGO_TERM);
    expect(within(algo).queryByText('已隐藏')).toBeNull();
    expect(columnText(data, '班级')).toContain(GROUP_A);
    expect(columnText(data, '班级')).toContain(GROUP_B);
    expect(columnText(net, '班级')).toContain(GROUP_C);
    expectCount(data, '章节', 4);
    expectCount(data, '视频', 7);
    expectCount(data, '题目', 12);
    expectCount(data, '学生', 36);
    expectCount(algo, '章节', 1);
    expectCount(algo, '视频', 0);
    expectCount(algo, '题目', 3);
    expect(digits(columnText(algo, '学生'))).toBe('');
    expectCount(net, '章节', 6);
    expectCount(net, '视频', 2);
    expectCount(net, '题目', 9);
    expectCount(net, '学生', 18);
    expect(columnText(data, '我的角色')).toBe(ROLE_LABEL.owner);
    expect(columnText(algo, '我的角色')).toBe(ROLE_LABEL.maintainer);
    expect(columnText(net, '我的角色')).toBe(ROLE_LABEL.admin);
  });

  it('keeps scope and the search query on the list toolbar', async () => {
    const q = '图';
    await renderPage(shell({
      scope: 'all',
      canSeeAll: true,
      q,
      rows: [dataCourse()],
    }));

    const search = screen.getByRole('searchbox');
    expect(search).toHaveValue(q);
    const form = searchForm();
    expect(formScope(form)).toBe('all');

    const scopeList = tablistOf('我的');
    const tabs = within(scopeList).getAllByRole('tab');
    expect(tabs.map((tab) => (tab.textContent ?? '').replace(/\s+/g, ''))).toEqual(['我的', '全部']);
    const mine = within(scopeList).getByRole('tab', { name: '我的' });
    const all = within(scopeList).getByRole('tab', { name: '全部' });
    expect(mine).toHaveAttribute('aria-selected', 'false');
    expect(all).toHaveAttribute('aria-selected', 'true');
    expectListHref(mine, 'mine', q);
    expectListHref(all, 'all', q);
  });

  it('hides the all-courses tab when the viewer cannot see every course', async () => {
    await renderPage(shell({ canSeeAll: false, canCreate: true }));

    expect(screen.queryByRole('tab', { name: '全部' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: '课程' })).toBeInTheDocument();
    const search = screen.getByRole('searchbox');
    expect(search).toHaveAttribute('name', 'q');
  });

  it('hides the create button when the viewer cannot create a course', async () => {
    await renderPage(shell({ canSeeAll: true, canCreate: false, scope: 'mine' }));

    expect(headerCreateButton()).toBeNull();
    expect(screen.queryByRole('button', { name: '新建课程' })).toBeNull();
    expect(screen.getByRole('tab', { name: '全部' })).toBeInTheDocument();
    expect(screen.getByText(DATA_TITLE)).toBeInTheDocument();
  });

  it('shows the empty state when the teacher has no courses', async () => {
    await renderPage(shell({ rows: [], canCreate: true }));

    expect(screen.getAllByText(EMPTY_TITLE).length).toBeGreaterThan(0);
    expect(screen.getAllByText(EMPTY_DESCRIPTION).length).toBeGreaterThan(0);
    expect(screen.queryByRole('columnheader', { name: '课程' })).toBeNull();
  });

  it('opens the create dialog from the page button and closes it on cancel', async () => {
    const user = userEvent.setup();
    await renderPage(shell());

    expect(screen.queryByRole('dialog')).toBeNull();
    const opener = headerCreateButton();
    if (!(opener instanceof HTMLElement)) throw new TypeError('create button');
    await user.click(opener);

    const dialog = await screen.findByRole('dialog', { name: '新建课程' });
    expect(dialog.className).toContain('sm:max-w-sm');
    const submit = within(dialog).getByRole('button', { name: '创建' });
    expect(submit).toHaveAttribute('data-variant', 'primary');
    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '新建课程' })).toBeNull();
    });
  });

  it('opens the create dialog from ?new=1 and refuses to submit a missing field', async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(() => jsonResponse({ tid: NEW_ID }));
    await renderPage(shell(), true);
    const assign = stubAssign();

    const dialog = await screen.findByRole('dialog', { name: '新建课程' });
    expect(dialog.className).toContain('sm:max-w-sm');
    const title = textbox(dialog, /^标题/);
    const term = textbox(dialog, /^学期/);
    const content = textbox(dialog, /课程简介/);
    expect(title.tagName).toBe('INPUT');
    expect(term.tagName).toBe('INPUT');
    expect(content.tagName).toBe('TEXTAREA');
    expect(term).toHaveAttribute('placeholder', TERM_PLACEHOLDER);

    await user.type(term, DATA_TERM);
    await user.type(content, '线性表');
    await user.click(within(dialog).getByRole('button', { name: '创建' }));
    expect(createCalls(fetchMock)).toHaveLength(0);

    await user.type(title, DATA_TITLE);
    await user.clear(term);
    await user.click(within(dialog).getByRole('button', { name: '创建' }));
    expect(createCalls(fetchMock)).toHaveLength(0);

    await user.type(term, DATA_TERM);
    await user.clear(content);
    await user.click(within(dialog).getByRole('button', { name: '创建' }));
    expect(createCalls(fetchMock)).toHaveLength(0);
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '新建课程' })).toBeInTheDocument();
  });

  it('creates the course and opens its editor', async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch((url) => {
      expect(url.pathname).toBe('/course/create');
      return jsonResponse({ tid: NEW_ID });
    });
    await renderPage(shell(), true);
    const assign = stubAssign();
    const dialog = await screen.findByRole('dialog', { name: '新建课程' });
    const content = '按章节组织视频和讲义。';

    await user.type(textbox(dialog, /^标题/), DATA_TITLE);
    await user.type(textbox(dialog, /^学期/), DATA_TERM);
    await user.type(textbox(dialog, /课程简介/), content);
    await user.click(within(dialog).getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(assign).toHaveBeenCalled();
    });
    const form = createForm(fetchMock);
    expect(form.get('title')).toBe(DATA_TITLE);
    expect(form.get('term')).toBe(DATA_TERM);
    expect(form.get('content')).toBe(content);
    expect(form.get('chapters')).toBe(INITIAL_CHAPTERS);
    const target = assignedPath(assign);
    expect(target.pathname).toBe(`/course/${NEW_ID}/edit`);
    expect(target.search).toBe('');
    expect(target.hash).toBe('');
  });

  it('shows the server message when creating a course fails', async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(() => hydroError(SERVER_MESSAGE));
    await renderPage(shell(), true);
    const assign = stubAssign();
    const dialog = await screen.findByRole('dialog', { name: '新建课程' });

    await user.type(textbox(dialog, /^标题/), DATA_TITLE);
    await user.type(textbox(dialog, /^学期/), DATA_TERM);
    await user.type(textbox(dialog, /课程简介/), '线性表');
    await user.click(within(dialog).getByRole('button', { name: '创建' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(SERVER_MESSAGE);
    expect(createCalls(fetchMock)).toHaveLength(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it('shows the create fallback when the error response cannot be read', async () => {
    const user = userEvent.setup();
    installFetch(() => new Response('nope', { status: 500, headers: { 'Content-Type': 'text/plain' } }));
    await renderPage(shell(), true);
    const assign = stubAssign();
    const dialog = await screen.findByRole('dialog', { name: '新建课程' });

    await user.type(textbox(dialog, /^标题/), DATA_TITLE);
    await user.type(textbox(dialog, /^学期/), DATA_TERM);
    await user.type(textbox(dialog, /课程简介/), '线性表');
    await user.click(within(dialog).getByRole('button', { name: '创建' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(CREATE_FALLBACK);
    expect(assign).not.toHaveBeenCalled();
  });
});
