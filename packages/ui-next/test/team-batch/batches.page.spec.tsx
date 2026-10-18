import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { TeamBatchesPage } from '../../src/pages/team-batches.tsx';

const USER_ID = 7;
const OTHER_ID = 8;
const OPEN_ID = '64b7c3a2e4b0f96d1a2c3d41';
const CLOSED_ID = '64b7c3a2e4b0f96d1a2c3d42';
const OPEN_NAME = '2026 秋季校赛组队';
const CLOSED_NAME = '2024 春季校赛组队';
const OPEN_REVISION = 4;
const MINE_CREATOR = '张老师';
const OTHER_CREATOR = '李老师';
const SERVER_NOW = '2025-06-15T12:00:00.000Z';
const OPEN_CREATED_AT = '2025-10-12T12:00:00.000Z';
const CLOSED_CREATED_AT = '2024-12-31T12:00:00.000Z';
const PAGE_TITLE = '组队批次';
const PAGE_DESCRIPTION = '学生在「题目集」里看到开放中的批次并自己组队';
const EMPTY_TITLE = '还没有组队批次';
const CREATE_LABEL = '新建批次';
const VIEW_LABEL = '查看';
const CLOSE_LABEL = '关闭组队';
const SELF_MARK = '（你）';
const CREATE_NAME = '暑期留校';
const CREATE_DESCRIPTION = '自己组队';
const CONFIRM_LABELS = [CLOSE_LABEL, '确认', '确定'] as const;

type FetchMock = ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;

interface TeamBatchListItem {
  batchId: string;
  name: string;
  description: string;
  status: 'open' | 'closed';
  revision: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  copiedFromBatchId: string | null;
  teamCount: number;
  memberCount: number;
  ownTeam: { teamId: string; name: string; captainUid: number } | null;
  pendingInviteCount: number;
  createdBy: number;
  creatorName: string;
}

interface TeamBatchListData {
  batches: TeamBatchListItem[];
  page: number;
  pageCount: number;
  total: number;
  capabilities: { canManage: boolean };
}

interface PostedForm {
  pathname: string;
  operation: string | null;
  expectedRevision: string | null;
  name: string | null;
  description: string | null;
}

function pageBootstrap(data: TeamBatchListData): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: SERVER_NOW,
    user: {
      id: USER_ID,
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
    page: { templateName: 'team_batches.html', data },
  };
}

function renderPage(data: TeamBatchListData) {
  window.history.replaceState(null, '', '/teams');
  return render(
    <BootstrapProvider bootstrap={pageBootstrap(data)}>
      <TeamBatchesPage />
    </BootstrapProvider>,
  );
}

function listItem(overrides: Partial<TeamBatchListItem> & Pick<TeamBatchListItem, 'batchId' | 'name' | 'status'>): TeamBatchListItem {
  return {
    description: '',
    revision: 1,
    createdAt: OPEN_CREATED_AT,
    updatedAt: '2025-11-01T12:00:00.000Z',
    closedAt: null,
    copiedFromBatchId: null,
    teamCount: 0,
    memberCount: 0,
    ownTeam: null,
    pendingInviteCount: 0,
    createdBy: OTHER_ID,
    creatorName: OTHER_CREATOR,
    ...overrides,
  };
}

function listData(): TeamBatchListData {
  return {
    batches: [
      listItem({
        batchId: OPEN_ID,
        name: OPEN_NAME,
        description: '开放中的校赛',
        status: 'open',
        revision: OPEN_REVISION,
        createdAt: OPEN_CREATED_AT,
        teamCount: 14,
        memberCount: 31,
        createdBy: USER_ID,
        creatorName: MINE_CREATOR,
      }),
      listItem({
        batchId: CLOSED_ID,
        name: CLOSED_NAME,
        description: '已经关闭',
        status: 'closed',
        revision: 9,
        createdAt: CLOSED_CREATED_AT,
        updatedAt: '2025-01-02T12:00:00.000Z',
        closedAt: '2025-01-15T12:00:00.000Z',
        teamCount: 2,
        memberCount: 5,
        createdBy: OTHER_ID,
        creatorName: OTHER_CREATOR,
      }),
    ],
    page: 2,
    pageCount: 3,
    total: 22,
    capabilities: { canManage: true },
  };
}

function emptyData(): TeamBatchListData {
  return {
    batches: [],
    page: 1,
    pageCount: 0,
    total: 0,
    capabilities: { canManage: true },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetch(): FetchMock {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    () => Promise.resolve(jsonResponse({})),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, window.location.href);
  if (input instanceof URL) return input;
  if (input instanceof Request) return new URL(input.url);
  throw new TypeError('unexpected fetch input');
}

function methodOf(init: RequestInit | undefined): string {
  const method = init?.method;
  if (typeof method !== 'string' || method === '') return 'GET';
  return method.toUpperCase();
}

function entryString(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' ? value : null;
}

function paramsFromUnknown(value: unknown): URLSearchParams | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const params = new URLSearchParams();
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' || typeof item === 'number') params.append(key, String(item));
  }
  return params;
}

function bodyParams(init: RequestInit | undefined): URLSearchParams | null {
  const body = init?.body;
  if (body instanceof URLSearchParams) return body;
  if (body instanceof FormData) {
    const params = new URLSearchParams();
    for (const [key, value] of body.entries()) {
      if (typeof value === 'string') params.append(key, value);
    }
    return params;
  }
  if (typeof body !== 'string') return null;
  if (body.startsWith('{')) {
    try {
      return paramsFromUnknown(JSON.parse(body) as unknown);
    } catch {
      return null;
    }
  }
  return new URLSearchParams(body);
}

function postedFromForm(form: HTMLFormElement): PostedForm {
  const action = form.getAttribute('action');
  const raw = action === null || action === '' ? window.location.href : action;
  const url = new URL(raw, window.location.href);
  const data = new FormData(form);
  return {
    pathname: url.pathname,
    operation: entryString(data.get('operation')),
    expectedRevision: entryString(data.get('expectedRevision')),
    name: entryString(data.get('name')),
    description: entryString(data.get('description')),
  };
}

function postedFromFetch(input: RequestInfo | URL, init: RequestInit | undefined): PostedForm | null {
  if (methodOf(init) !== 'POST') return null;
  const params = bodyParams(init);
  if (params === null) return null;
  return {
    pathname: requestUrl(input).pathname,
    operation: params.get('operation'),
    expectedRevision: params.get('expectedRevision'),
    name: params.get('name'),
    description: params.get('description'),
  };
}

function formsOf(values: readonly unknown[]): HTMLFormElement[] {
  const forms: HTMLFormElement[] = [];
  for (const value of values) {
    if (value instanceof HTMLFormElement && !forms.includes(value)) forms.push(value);
  }
  return forms;
}

function collectPosts(
  fetchMock: FetchMock,
  contexts: readonly unknown[],
  instances: readonly unknown[],
  forms: readonly HTMLFormElement[],
): PostedForm[] {
  const posts: PostedForm[] = [];
  for (const call of fetchMock.mock.calls) {
    const input = call[0];
    if (input === undefined) continue;
    const posted = postedFromFetch(input, call[1]);
    if (posted) posts.push(posted);
  }
  for (const form of formsOf([...contexts, ...instances, ...forms])) posts.push(postedFromForm(form));
  return posts;
}

function tableBody(): HTMLTableSectionElement {
  const body = document.querySelector('[data-slot="data-table"] tbody');
  expect(body).toBeInstanceOf(HTMLTableSectionElement);
  if (!(body instanceof HTMLTableSectionElement)) throw new TypeError('team batch table is missing');
  return body;
}

function tableRow(title: string): HTMLTableRowElement {
  for (const row of tableBody().querySelectorAll(':scope > tr')) {
    if (!(row instanceof HTMLTableRowElement)) continue;
    if ((row.textContent ?? '').includes(title)) return row;
  }
  throw new TypeError(`missing table row for ${title}`);
}

function headerLabels(): string[] {
  return [...document.querySelectorAll('[data-slot="data-table"] thead th')].map((cell) => (cell.textContent ?? '').trim());
}

function columnText(row: HTMLElement, header: string): string {
  const headers = headerLabels();
  const index = headers.indexOf(header);
  expect(index).toBeGreaterThanOrEqual(0);
  const cell = [...row.querySelectorAll(':scope > td')][index];
  if (!(cell instanceof HTMLElement)) throw new TypeError(`missing cell ${header}`);
  return (cell.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function badge(row: HTMLElement, text: string): HTMLElement {
  const node = within(row).getByText(text);
  const host = node.getAttribute('data-slot') === 'badge' ? node : node.closest('[data-slot="badge"]');
  if (!(host instanceof HTMLElement)) throw new TypeError(`badge ${text}`);
  return host;
}

function primaryControls(): HTMLElement[] {
  return [...document.querySelectorAll('[data-variant="primary"]')].filter((node): node is HTMLElement => node instanceof HTMLElement);
}

function confirmControl(dialog: HTMLElement): HTMLElement {
  for (const label of CONFIRM_LABELS) {
    const button = within(dialog).queryByRole('button', { name: label });
    if (button) return button;
  }
  throw new TypeError('close confirmation is missing');
}

function dialogSubmit(dialog: HTMLElement): HTMLElement {
  const buttons = within(dialog).getAllByRole('button');
  const typed = buttons.find((button) => button.getAttribute('type') === 'submit');
  if (typed) return typed;
  const primary = buttons.find((button) => button.getAttribute('data-variant') === 'primary');
  if (primary) return primary;
  throw new TypeError('create dialog is missing a submit control');
}

function labeledField(dialog: HTMLElement, label: RegExp, fieldName: string): HTMLElement {
  const field = within(dialog).getByRole('textbox', { name: label });
  expect(field).toHaveAttribute('name', fieldName);
  return field;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('team batches management list', () => {
  it('renders one table row per batch and points 查看 at manage', () => {
    installFetch();
    const data = listData();
    renderPage(data);

    expect(screen.getByRole('heading', { level: 1, name: PAGE_TITLE })).toBeInTheDocument();
    expect(screen.getByText(PAGE_DESCRIPTION)).toBeInTheDocument();
    const crumb = screen.getByRole('navigation', { name: 'breadcrumb' });
    expect(within(crumb).getByText('教学')).toBeInTheDocument();
    expect(within(crumb).getByText(PAGE_TITLE)).toBeInTheDocument();

    const rows = [...tableBody().querySelectorAll(':scope > tr')];
    expect(rows).toHaveLength(data.batches.length);
    expect(headerLabels()).toEqual(expect.arrayContaining(['名称', '状态', '队伍', '人数', '创建者', '创建']));

    const openRow = tableRow(OPEN_NAME);
    const closedRow = tableRow(CLOSED_NAME);
    expect(within(openRow).getByRole('link', { name: VIEW_LABEL })).toHaveAttribute('href', `/teams/${OPEN_ID}/manage`);
    expect(within(closedRow).getByRole('link', { name: VIEW_LABEL })).toHaveAttribute('href', `/teams/${CLOSED_ID}/manage`);
    expect(badge(openRow, '开放中')).toHaveAttribute('data-tone', 'success');
    expect(badge(closedRow, '已结束')).toHaveAttribute('data-tone', 'neutral');
    expect(columnText(openRow, '队伍').replace(/\D/g, '')).toBe('14');
    expect(columnText(openRow, '人数').replace(/\D/g, '')).toBe('31');
    expect(columnText(closedRow, '队伍').replace(/\D/g, '')).toBe('2');
    expect(columnText(closedRow, '人数').replace(/\D/g, '')).toBe('5');
    expect(columnText(openRow, '创建者')).toContain(MINE_CREATOR);
    expect(columnText(openRow, '创建者')).toContain(SELF_MARK);
    expect(columnText(closedRow, '创建者')).toContain(OTHER_CREATOR);
    expect(columnText(closedRow, '创建者')).not.toContain(SELF_MARK);
    expect(columnText(openRow, '创建')).toBe('10/12');
    expect(columnText(closedRow, '创建')).toBe('2024-12-31');
    expect(within(openRow).getByRole('button', { name: CLOSE_LABEL })).toBeInTheDocument();
    expect(within(closedRow).queryByRole('button', { name: CLOSE_LABEL })).toBeNull();

    const createButtons = screen.getAllByRole('button', { name: CREATE_LABEL });
    expect(createButtons).toHaveLength(1);
    expect(createButtons[0]).toHaveAttribute('data-variant', 'primary');
    expect(primaryControls()).toHaveLength(1);
    expect(screen.getByRole('link', { name: '上一页' })).toHaveAttribute('href', '/teams?page=1');
    expect(screen.getByRole('link', { name: '下一页' })).toHaveAttribute('href', '/teams?page=3');
  });

  it('asks before closing an open batch and posts expectedRevision', async () => {
    const fetchMock = installFetch();
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    const submitted: HTMLFormElement[] = [];
    const onSubmit = (event: Event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (event.target instanceof HTMLFormElement) submitted.push(event.target);
    };
    const user = userEvent.setup();
    renderPage(listData());
    document.addEventListener('submit', onSubmit);
    try {
      const posts = () => collectPosts(fetchMock, submitSpy.mock.contexts, submitSpy.mock.instances, submitted)
        .filter((post) => post.operation === 'close');
      await user.click(within(tableRow(OPEN_NAME)).getByRole('button', { name: CLOSE_LABEL }));
      const dialog = await screen.findByRole('dialog');
      expect(posts()).toHaveLength(0);

      await user.click(confirmControl(dialog));
      await waitFor(() => {
        expect(posts().length).toBeGreaterThan(0);
      });
      for (const post of posts()) {
        expect(post.pathname).toBe(`/teams/${OPEN_ID}`);
        expect(post.operation).toBe('close');
        expect(post.expectedRevision).toBe(String(OPEN_REVISION));
      }
    } finally {
      document.removeEventListener('submit', onSubmit);
      submitSpy.mockRestore();
    }
  });

  it('keeps one primary action when there are no batches', () => {
    installFetch();
    renderPage(emptyData());

    expect(screen.getByRole('heading', { level: 1, name: PAGE_TITLE })).toBeInTheDocument();
    expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument();
    const createButtons = screen.getAllByRole('button', { name: CREATE_LABEL });
    expect(createButtons).toHaveLength(1);
    expect(createButtons[0]).toHaveAttribute('data-variant', 'primary');
    expect(primaryControls()).toHaveLength(1);
    expect(screen.queryByRole('link', { name: '下一页' })).toBeNull();
  });

  it('posts create with the existing name and description fields', async () => {
    const fetchMock = installFetch();
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    const submitted: HTMLFormElement[] = [];
    const onSubmit = (event: Event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (event.target instanceof HTMLFormElement) submitted.push(event.target);
    };
    const user = userEvent.setup();
    renderPage(listData());
    document.addEventListener('submit', onSubmit);
    try {
      await user.click(screen.getByRole('button', { name: CREATE_LABEL }));
      const dialog = await screen.findByRole('dialog');
      const name = labeledField(dialog, /名称/, 'name');
      const description = labeledField(dialog, /说明/, 'description');
      await user.type(name, CREATE_NAME);
      await user.type(description, CREATE_DESCRIPTION);
      await user.click(dialogSubmit(dialog));

      const posts = () => collectPosts(fetchMock, submitSpy.mock.contexts, submitSpy.mock.instances, submitted)
        .filter((post) => post.operation === 'create');
      await waitFor(() => {
        expect(posts().length).toBeGreaterThan(0);
      });
      for (const post of posts()) {
        expect(post.pathname).toBe('/teams');
        expect(post.operation).toBe('create');
        expect(post.name).toBe(CREATE_NAME);
        expect(post.description).toBe(CREATE_DESCRIPTION);
      }
    } finally {
      document.removeEventListener('submit', onSubmit);
      submitSpy.mockRestore();
    }
  });
});
