import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { formatDateTime } from '../../src/lib/format.ts';

// A static import fails collection while student.tsx is absent.
const pageLoaders = import.meta.glob('../../src/pages/team-batch/student.tsx');

const PAGE_SOURCE = 'src/pages/team-batch/student.tsx';
const BATCH_ID = '64b7c3a2e4b0f96d1a2c3d40';
const TEAM_ID = '64b7c3a2e4b0f96d1a2c3d41';
const INVITE_OK = '64b7c3a2e4b0f96d1a2c3d42';
const INVITE_STALE = '64b7c3a2e4b0f96d1a2c3d43';
const DIR_OPEN = '64b7c3a2e4b0f96d1a2c3d44';
const DIR_FULL = '64b7c3a2e4b0f96d1a2c3d45';
const MANAGE_URL = `/teams/${BATCH_ID}/manage`;
const BATCH_NAME = '2026 秋季校赛组队';
const BATCH_DESCRIPTION = '每周三晚可以找队友。';
const TEAM_NAME = 'Segment Tree Fans';
const TEAM_DESCRIPTION = '每周三晚训练';
const TEAM_REVISION = 4;
const SELF_ID = 7;
const MATE_ID = 8;
const LI_ID = 4;
const EXTRA_ID = 5;
const CHEN_ID = 6;
const INVITEE_ID = 9;
const INVITE_AT = '2026-10-17T02:30:00.000Z';
const TEAM_SIZE = '1\u20133 人';
const TEAM_SIZE_LABEL = `每队 ${TEAM_SIZE}`;
const NO_TEAM = '你还没有队伍。可以自己建队、接受别人的邀请，或者一个人成队。';
const OUT_OF_SCOPE = '你不在这次组队的范围内。';
const LOCKED = '组队已截止，阵容已锁定。';
const LOCK_NOTE = '截止后由老师统一锁定阵容，比赛里不能再换人。';
const STALE_HINT = '队伍已变化或已满';
const WRITE_LABELS = [
  '创建队伍',
  '一个人成队',
  '邀请',
  '移出',
  '转让队长',
  '修改队名',
  '离开队伍',
  '拒绝',
  '接受',
] as const;

interface Person {
  _id: number;
  uname: string;
  displayName: string;
  studentId: string;
}

interface Caps {
  canManage: boolean;
  canCreate: boolean;
  canInvite: boolean;
  canEditOwn: boolean;
  canLeave: boolean;
}

interface OwnTeam {
  teamId: string;
  name: string;
  description: string;
  captainUid: number;
  memberUids: number[];
  managementMode: 'self' | 'admin';
  revision: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface InviteFixture {
  inviteId: string;
  teamId: string;
  teamName: string;
  inviterUid: number;
  teamRevision: number;
  currentRevision: number | null;
  memberUids: number[];
  captainUid: number | null;
  createdAt: string;
  canAccept: boolean;
}

interface DirectoryRow {
  teamId: string;
  name: string;
  captainUid: number;
  memberCount: number;
}

interface Directory {
  rows: DirectoryRow[];
  page: number;
  pageCount: number;
  total: number;
  search: string;
}

interface StudentPageData {
  batch: {
    batchId: string;
    name: string;
    description: string;
    status: 'open' | 'closed';
    revision: number;
    createdAt: string;
    updatedAt: string;
    closedAt?: string;
  };
  ownTeam: OwnTeam | null;
  pendingInvites: InviteFixture[];
  users: Record<string, Person>;
  capabilities: Caps;
  directory: Directory;
  manageUrl: string | null;
}

interface Posted {
  operation: string;
  fields: Record<string, string>;
}

type FetchMock = ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;
type User = ReturnType<typeof userEvent.setup>;

const DIRECTORY_ROWS: DirectoryRow[] = [
  { teamId: DIR_OPEN, name: '算法小分队', captainUid: LI_ID, memberCount: 2 },
  { teamId: DIR_FULL, name: 'DP 不会队', captainUid: CHEN_ID, memberCount: 3 },
];

const DIRECTORY: Directory = {
  rows: DIRECTORY_ROWS,
  page: 1,
  pageCount: 2,
  total: 5,
  search: '算法',
};

function person(id: number, name: string, studentId: string): Person {
  return {
    _id: id, uname: name, displayName: name, studentId,
  };
}

const USERS: Record<string, Person> = {
  [String(SELF_ID)]: person(SELF_ID, '张三', '2024010203'),
  [String(MATE_ID)]: person(MATE_ID, '王五', '2024010311'),
  [String(LI_ID)]: person(LI_ID, '李四', '2024010201'),
  [String(EXTRA_ID)]: person(EXTRA_ID, '周可', '2024010209'),
  [String(CHEN_ID)]: person(CHEN_ID, '陈思远', '2024010205'),
};

let pageComponent: ComponentType | null = null;
let posts: Posted[] = [];
let fetchMock: FetchMock | null = null;
let restoreRect: (() => void) | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pageLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(pageLoaders)) {
    if (key.endsWith(PAGE_SOURCE)) return load;
  }
  return undefined;
}

async function loadPage(): Promise<ComponentType> {
  if (pageComponent) return pageComponent;
  const load = pageLoader();
  expect(typeof load, PAGE_SOURCE).toBe('function');
  if (typeof load !== 'function') {
    throw new TypeError(`${PAGE_SOURCE} must exist`);
  }
  let imported: unknown;
  try {
    imported = await load();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect.fail(message);
  }
  const component: unknown = isRecord(imported) ? imported.TeamBatchStudentPage : undefined;
  if (typeof component !== 'function') {
    throw new TypeError('TeamBatchStudentPage must be exported');
  }
  pageComponent = component as ComponentType;
  return pageComponent;
}

function makeOwnTeam(
  memberUids: number[] = [SELF_ID, MATE_ID],
  captainUid = SELF_ID,
  managementMode: OwnTeam['managementMode'] = 'self',
): OwnTeam {
  return {
    teamId: TEAM_ID,
    name: TEAM_NAME,
    description: TEAM_DESCRIPTION,
    captainUid,
    memberUids,
    managementMode,
    revision: TEAM_REVISION,
    active: true,
    createdAt: '2026-10-16T02:00:00.000Z',
    updatedAt: '2026-10-18T02:00:00.000Z',
  };
}

function makeInvite(
  overrides: Pick<InviteFixture, 'inviteId' | 'teamName' | 'canAccept' | 'memberUids'>
    & Partial<Pick<InviteFixture, 'captainUid' | 'inviterUid'>>,
): InviteFixture {
  return {
    inviteId: overrides.inviteId,
    teamId: DIR_OPEN,
    teamName: overrides.teamName,
    inviterUid: overrides.inviterUid ?? EXTRA_ID,
    teamRevision: 2,
    currentRevision: overrides.canAccept ? 2 : 9,
    memberUids: overrides.memberUids,
    captainUid: overrides.captainUid ?? LI_ID,
    createdAt: INVITE_AT,
    canAccept: overrides.canAccept,
  };
}

function body(overrides: {
  status?: 'open' | 'closed';
  description?: string;
  ownTeam?: OwnTeam | null;
  pendingInvites?: InviteFixture[];
  capabilities?: Partial<Caps>;
  manageUrl?: string | null;
} = {}): StudentPageData {
  const status = overrides.status ?? 'open';
  return {
    batch: {
      batchId: BATCH_ID,
      name: BATCH_NAME,
      description: overrides.description ?? BATCH_DESCRIPTION,
      status,
      revision: 3,
      createdAt: '2026-10-12T02:00:00.000Z',
      updatedAt: '2026-10-18T02:00:00.000Z',
      ...(status === 'closed' ? { closedAt: '2026-10-18T15:59:00.000Z' } : {}),
    },
    ownTeam: overrides.ownTeam === undefined ? null : overrides.ownTeam,
    pendingInvites: overrides.pendingInvites ?? [],
    users: USERS,
    capabilities: {
      canManage: false,
      canCreate: false,
      canInvite: false,
      canEditOwn: false,
      canLeave: false,
      ...overrides.capabilities,
    },
    directory: DIRECTORY,
    manageUrl: overrides.manageUrl === undefined ? null : overrides.manageUrl,
  };
}

function bootstrap(data: StudentPageData, userId = SELF_ID): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-18T06:00:00.000Z',
    user: {
      id: userId,
      name: 'student',
      mail: '',
      signedIn: true,
      theme: 'light',
      viewLang: 'zh_CN',
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
    page: { templateName: 'team_batch_detail.html', data },
  };
}

async function renderStudent(data: StudentPageData, userId = SELF_ID) {
  const Page = await loadPage();
  return render(
    <BootstrapProvider bootstrap={bootstrap(data, userId)}>
      <Page />
    </BootstrapProvider>,
  );
}

function fieldsFromPairs(pairs: Iterable<[string, unknown]>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of pairs) {
    if (typeof value === 'string') fields[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) fields[key] = String(value);
  }
  return fields;
}

function fieldsFromBody(payload: BodyInit | null | undefined): Record<string, string> {
  if (payload == null) return {};
  if (typeof payload === 'string') {
    if (payload.startsWith('{')) {
      const parsed: unknown = JSON.parse(payload);
      return isRecord(parsed) ? fieldsFromPairs(Object.entries(parsed)) : {};
    }
    return fieldsFromPairs(new URLSearchParams(payload).entries());
  }
  if (payload instanceof URLSearchParams || payload instanceof FormData) return fieldsFromPairs(payload.entries());
  return {};
}

function pushPost(fields: Record<string, string>) {
  if (!fields.operation) return;
  posts.push({ operation: fields.operation, fields });
}

function onFormSubmit(event: Event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.method.toLowerCase() === 'get') return;
  event.preventDefault();
  pushPost(fieldsFromPairs(form.entries()));
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, window.location.href);
  if (input instanceof URL) return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  throw new TypeError('unexpected fetch input');
}

function methodOf(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetch(): FetchMock {
  const mock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input, init) => {
    const method = methodOf(input, init);
    if (method === 'POST') {
      pushPost(fieldsFromBody(init?.body));
      return Promise.resolve(jsonResponse({ ok: true }));
    }
    return Promise.resolve(jsonResponse({
      users: [{
        _id: INVITEE_ID,
        uname: 'zhaoliu',
        displayName: '赵六',
        studentId: '2024010888',
      }],
    }));
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

function installRect() {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function boundingClientRect() {
    return new DOMRect(16, 16, 320, 40);
  };
  restoreRect = () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
}

function operationPost(operation: string, start: number): Posted {
  const matched = posts.slice(start).filter((item) => item.operation === operation);
  const found = matched[matched.length - 1];
  if (!found) throw new Error(`missing ${operation}`);
  return found;
}

function expectFields(post: Posted, fields: Record<string, string>) {
  for (const [key, value] of Object.entries(fields)) {
    expect(post.fields[key]).toBe(value);
  }
}

function panel(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title });
  const root = heading.closest('section');
  if (!(root instanceof HTMLElement)) throw new Error(`missing panel ${title}`);
  return root;
}

function banner(): HTMLElement {
  return screen.getByRole('banner');
}

function primaryControls(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-variant="primary"]')];
}

function badge(scope: HTMLElement, text: string): HTMLElement {
  const node = within(scope).getByText(text);
  const found = node.closest('[data-slot="badge"]');
  if (!(found instanceof HTMLElement)) throw new Error(`badge ${text} missing`);
  return found;
}

function memberRow(name: string): HTMLElement {
  const mine = panel('我的队伍');
  const node = within(mine).getByText(name);
  let current: HTMLElement | null = node.parentElement;
  while (current && current !== mine) {
    if (current.querySelector('[data-slot="avatar"]')) return current;
    current = current.parentElement;
  }
  throw new Error(`member ${name} missing`);
}

function inviteBlock(teamName: string): HTMLElement {
  const root = panel('收到的邀请');
  const node = within(root).getByText(teamName);
  let current: HTMLElement | null = node.parentElement;
  while (current && current !== root) {
    if (within(current).queryAllByRole('button', { name: '接受' }).length === 1) return current;
    current = current.parentElement;
  }
  throw new Error(`invite ${teamName} missing`);
}

function textField(dialog: HTMLElement, name: string): HTMLInputElement | HTMLTextAreaElement {
  const field = dialog.querySelector(`[name="${name}"]`);
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) return field;
  throw new Error(`missing field ${name}`);
}

async function submitDialog(user: User) {
  const dialog = await screen.findByRole('dialog');
  const submit = within(dialog).getAllByRole('button').find((button) => button.getAttribute('type') === 'submit')
    ?? within(dialog).queryByRole('button', { name: '确认' });
  if (!submit) throw new Error('dialog submit missing');
  await user.click(submit);
}

async function confirmRequired(user: User, start: number, operation: string): Promise<Posted> {
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(posts.slice(start).some((item) => item.operation === operation)).toBe(false);
  await submitDialog(user);
  await waitFor(() => {
    expect(posts.slice(start).some((item) => item.operation === operation)).toBe(true);
  });
  return operationPost(operation, start);
}

async function finishOptional(user: User, start: number, operation: string): Promise<Posted> {
  await waitFor(() => {
    const posted = posts.slice(start).some((item) => item.operation === operation);
    expect(posted || screen.queryByRole('dialog') !== null).toBe(true);
  });
  const posted = posts.slice(start).some((item) => item.operation === operation);
  if (!posted && screen.queryByRole('dialog')) await submitDialog(user);
  await waitFor(() => {
    expect(posts.slice(start).some((item) => item.operation === operation)).toBe(true);
  });
  return operationPost(operation, start);
}

function expectNoWriteButtons() {
  for (const label of WRITE_LABELS) {
    expect(screen.queryByRole('button', { name: label })).toBeNull();
  }
}

function captainData(): StudentPageData {
  return body({
    ownTeam: makeOwnTeam(),
    capabilities: { canInvite: true, canEditOwn: true, canLeave: true },
  });
}

beforeEach(() => {
  posts = [];
  window.history.pushState({}, '', `/teams/${BATCH_ID}`);
  installRect();
  fetchMock = installFetch();
  document.addEventListener('submit', onFormSubmit, true);
});

afterEach(() => {
  document.removeEventListener('submit', onFormSubmit, true);
  restoreRect?.();
  restoreRect = null;
  fetchMock = null;
  vi.unstubAllGlobals();
});

describe('team batch student page', () => {
  it('renders the open batch, directory, and a single primary create action', async () => {
    await renderStudent(body({
      capabilities: { canCreate: true, canManage: true },
      manageUrl: MANAGE_URL,
    }));

    const header = banner();
    expect(within(header).getByRole('heading', { level: 1, name: BATCH_NAME })).toBeInTheDocument();
    const crumb = within(header).getByRole('navigation', { name: 'breadcrumb' });
    expect(within(crumb).getByRole('link', { name: '题目集' })).toHaveAttribute('href', '/problem-sets');
    expect(within(crumb).getByText(BATCH_NAME)).toBeInTheDocument();
    expect(badge(header, '组队')).toHaveAttribute('data-tone', 'neutral');
    expect(header.textContent).toContain(TEAM_SIZE_LABEL);
    expect(badge(header, '进行中')).toHaveAttribute('data-tone', 'success');
    const manage = within(header).getByRole('link', { name: '管理批次' });
    expect(manage).toHaveAttribute('href', MANAGE_URL);
    expect(manage).toHaveAttribute('data-variant', 'secondary');

    const mine = panel('我的队伍');
    expect(within(mine).getByText(NO_TEAM)).toBeInTheDocument();
    expect(within(mine).getByRole('button', { name: '创建队伍' })).toBeInTheDocument();
    expect(within(mine).getByRole('button', { name: '一个人成队' })).toHaveAttribute('data-variant', 'secondary');
    const primaries = primaryControls();
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.textContent).toContain('创建队伍');
    expect(screen.queryByRole('heading', { name: '收到的邀请' })).toBeNull();

    const directory = panel('全部队伍');
    expect(directory.textContent).toContain('5 支队伍');
    const search = within(directory).getByRole('textbox');
    expect(search).toHaveAttribute('name', 'teamSearch');
    expect(search).toHaveValue('算法');
    const form = search.closest('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('team search form missing');
    expect(form.method).toBe('get');
    const table = within(directory).getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(DIRECTORY_ROWS.length + 1);
    for (const label of ['队名', '队长', '人数', '状态']) {
      expect(within(table).getByRole('columnheader', { name: label })).toBeInTheDocument();
    }
    expect(within(table).getByText('算法小分队')).toBeInTheDocument();
    expect(within(table).getByText('李四')).toBeInTheDocument();
    expect(within(table).getByText('2 / 3')).toBeInTheDocument();
    expect(badge(table, '缺 1 人')).toHaveAttribute('data-tone', 'success');
    expect(within(table).getByText('DP 不会队')).toBeInTheDocument();
    expect(within(table).getByText('陈思远')).toBeInTheDocument();
    expect(within(table).getByText('3 / 3')).toBeInTheDocument();
    expect(badge(table, '已满')).toHaveAttribute('data-tone', 'neutral');
    const pagination = screen.getByRole('navigation', { name: 'pagination' });
    const pageTwoHref = within(pagination).getByRole('link', { name: '2' }).getAttribute('href');
    if (pageTwoHref === null) throw new Error('page link missing');
    expect(pageTwoHref).toContain('page=2');
    expect(decodeURIComponent(pageTwoHref)).toContain('teamSearch=算法');

    const aside = panel('组队说明');
    expect(within(aside).getByText('状态')).toBeInTheDocument();
    expect(within(aside).getByText('进行中')).toBeInTheDocument();
    expect(within(aside).getByText('每队')).toBeInTheDocument();
    expect(aside.textContent).toContain(TEAM_SIZE);
    expect(within(aside).getByText('说明')).toBeInTheDocument();
    expect(within(aside).getByText(BATCH_DESCRIPTION)).toBeInTheDocument();
    expect(within(aside).getByText(LOCK_NOTE)).toBeInTheDocument();
  });

  it('posts create_self with the team name and description', async () => {
    const user = userEvent.setup();
    await renderStudent(body({ capabilities: { canCreate: true } }));
    const start = posts.length;
    await user.click(screen.getByRole('button', { name: '创建队伍' }));
    const dialog = await screen.findByRole('dialog');
    expect(posts.slice(start)).toHaveLength(0);
    await user.type(textField(dialog, 'name'), '线段树爱好者');
    await user.type(textField(dialog, 'description'), '周三训练');
    await submitDialog(user);
    await waitFor(() => {
      expect(posts.slice(start).some((item) => item.operation === 'create_self')).toBe(true);
    });
    expectFields(operationPost('create_self', start), {
      operation: 'create_self',
      name: '线段树爱好者',
      description: '周三训练',
    });
  });

  it('posts create_solo only after confirmation', async () => {
    const user = userEvent.setup();
    await renderStudent(body({ capabilities: { canCreate: true } }));
    const start = posts.length;
    await user.click(screen.getByRole('button', { name: '一个人成队' }));
    const posted = await confirmRequired(user, start, 'create_solo');
    expect(posted.operation).toBe('create_solo');
  });

  it('explains when the student cannot create a team', async () => {
    await renderStudent(body({ capabilities: { canCreate: false } }));
    const mine = panel('我的队伍');
    expect(within(mine).getByText(OUT_OF_SCOPE)).toBeInTheDocument();
    expect(within(mine).queryByRole('button', { name: '创建队伍' })).toBeNull();
    expect(within(mine).queryByRole('button', { name: '一个人成队' })).toBeNull();
    expect(primaryControls()).toHaveLength(0);
  });

  it('hides the scope reason and write actions after the batch closes', async () => {
    await renderStudent(body({
      status: 'closed',
      capabilities: { canCreate: false },
      pendingInvites: [
        makeInvite({
          inviteId: INVITE_OK,
          teamName: '深夜刷题队',
          canAccept: true,
          memberUids: [LI_ID, EXTRA_ID],
        }),
      ],
    }));
    expect(screen.getByText(LOCKED)).toBeInTheDocument();
    expect(screen.queryByText(OUT_OF_SCOPE)).toBeNull();
    expect(screen.queryByText(NO_TEAM)).toBeNull();
    expect(screen.getByText('深夜刷题队')).toBeInTheDocument();
    expect(banner().textContent).toContain('已结束');
    expectNoWriteButtons();
    expect(primaryControls()).toHaveLength(0);
  });

  it('renders the captain roster and member actions', async () => {
    await renderStudent(captainData());
    const mine = panel('我的队伍');
    expect(within(mine).getByText(TEAM_NAME)).toBeInTheDocument();
    expect(within(mine).getByText('2 / 3 人')).toBeInTheDocument();
    expect(within(mine).getByText(TEAM_DESCRIPTION)).toBeInTheDocument();
    expect(mine.querySelectorAll('[data-slot="avatar"]')).toHaveLength(2);
    expect(within(mine).getByText(/2024010203/)).toBeInTheDocument();
    expect(within(mine).getByText(/2024010311/)).toBeInTheDocument();
    const self = memberRow('张三');
    expect(self.textContent).toContain('（你）');
    expect(self.textContent).toContain('队长');
    const mate = memberRow('王五');
    expect(mate.textContent).not.toContain('（你）');
    expect(within(mate).getByRole('button', { name: '移出' })).toHaveAttribute('data-variant', 'ghost');
    expect(within(mate).getByRole('button', { name: '转让队长' })).toHaveAttribute('data-variant', 'secondary');
    expect(within(mine).getByRole('button', { name: '修改队名' })).toHaveAttribute('data-variant', 'secondary');
    const leave = within(mine).getByRole('button', { name: '离开队伍' });
    expect(leave).toHaveAttribute('data-variant', 'danger-soft');
    expect(leave).toBeDisabled();
    const leaveStart = posts.length;
    leave.click();
    expect(posts.slice(leaveStart).some((item) => item.operation === 'leave')).toBe(false);
    expect(within(mine).getByRole('button', { name: '邀请' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '收到的邀请' })).toBeNull();
  });

  it('posts transfer_captain for the other member', async () => {
    const user = userEvent.setup();
    await renderStudent(captainData());
    const start = posts.length;
    await user.click(within(memberRow('王五')).getByRole('button', { name: '转让队长' }));
    const posted = await confirmRequired(user, start, 'transfer_captain');
    expectFields(posted, {
      operation: 'transfer_captain',
      teamId: TEAM_ID,
      expectedRevision: String(TEAM_REVISION),
      captainUid: String(MATE_ID),
    });
  });

  it('posts remove_member for the other member', async () => {
    const user = userEvent.setup();
    await renderStudent(captainData());
    const start = posts.length;
    await user.click(within(memberRow('王五')).getByRole('button', { name: '移出' }));
    const posted = await confirmRequired(user, start, 'remove_member');
    expectFields(posted, {
      operation: 'remove_member',
      teamId: TEAM_ID,
      expectedRevision: String(TEAM_REVISION),
      memberUid: String(MATE_ID),
    });
  });

  it('posts leave with the team revision', async () => {
    const user = userEvent.setup();
    await renderStudent(body({
      ownTeam: makeOwnTeam([SELF_ID]),
      capabilities: { canLeave: true },
    }));
    const start = posts.length;
    await user.click(screen.getByRole('button', { name: '离开队伍' }));
    const posted = await confirmRequired(user, start, 'leave');
    expectFields(posted, {
      operation: 'leave',
      teamId: TEAM_ID,
      expectedRevision: String(TEAM_REVISION),
    });
  });

  it('posts update_info from the rename dialog', async () => {
    const user = userEvent.setup();
    await renderStudent(captainData());
    const start = posts.length;
    await user.click(screen.getByRole('button', { name: '修改队名' }));
    const dialog = await screen.findByRole('dialog');
    expect(posts.slice(start)).toHaveLength(0);
    const name = textField(dialog, 'name');
    const description = textField(dialog, 'description');
    await user.clear(name);
    await user.type(name, '新队名');
    await user.clear(description);
    await user.type(description, '新简介');
    await submitDialog(user);
    await waitFor(() => {
      expect(posts.slice(start).some((item) => item.operation === 'update_info')).toBe(true);
    });
    expectFields(operationPost('update_info', start), {
      operation: 'update_info',
      teamId: TEAM_ID,
      expectedRevision: String(TEAM_REVISION),
      name: '新队名',
      description: '新简介',
    });
  });

  it('searches teammates on the batch and posts invite', async () => {
    const user = userEvent.setup();
    await renderStudent(captainData());
    const mine = panel('我的队伍');
    await user.type(within(mine).getByRole('textbox'), '赵六');
    await waitFor(() => {
      const matched = fetchMock?.mock.calls.find((call) => {
        const input = call[0];
        if (input === undefined || methodOf(input, call[1]) !== 'GET') return false;
        return requestUrl(input).searchParams.get('search') === '赵六';
      });
      expect(matched?.[0]).toBeTruthy();
      if (matched?.[0] === undefined) throw new Error('search request missing');
      expect(requestUrl(matched[0]).pathname).toContain(BATCH_ID);
    });
    await user.click(await screen.findByRole('button', { name: /赵六/ }, { timeout: 3000 }));
    const invite = within(mine).getByRole('button', { name: '邀请' });
    await waitFor(() => expect(invite).toBeEnabled());
    const start = posts.length;
    await user.click(invite);
    const posted = await finishOptional(user, start, 'invite');
    expectFields(posted, { operation: 'invite', inviteeUid: String(INVITEE_ID) });
  });

  it('hides roster edits on an admin managed team', async () => {
    await renderStudent(body({
      ownTeam: makeOwnTeam([SELF_ID, MATE_ID], SELF_ID, 'admin'),
      capabilities: { canEditOwn: true },
    }));
    const mine = panel('我的队伍');
    expect(within(mine).queryByRole('button', { name: '移出' })).toBeNull();
    expect(within(mine).queryByRole('button', { name: '转让队长' })).toBeNull();
    expect(within(mine).getByRole('button', { name: '修改队名' })).toBeInTheDocument();
  });

  it('hides invite controls when the captain cannot invite', async () => {
    await renderStudent(body({
      ownTeam: makeOwnTeam(),
      capabilities: { canInvite: false, canEditOwn: true, canLeave: true },
    }));
    const mine = panel('我的队伍');
    expect(within(mine).queryByRole('button', { name: '邀请' })).toBeNull();
    expect(within(mine).queryByRole('textbox')).toBeNull();
    expect(within(mine).getByRole('button', { name: '转让队长' })).toBeInTheDocument();
  });

  it('limits a member who is not captain to leaving', async () => {
    await renderStudent(body({
      ownTeam: makeOwnTeam(),
      capabilities: { canLeave: true },
    }), MATE_ID);
    const mine = panel('我的队伍');
    expect(memberRow('王五').textContent).toContain('（你）');
    expect(memberRow('张三').textContent).not.toContain('（你）');
    expect(memberRow('张三').textContent).toContain('队长');
    expect(within(mine).getByRole('button', { name: '离开队伍' })).toHaveAttribute('data-variant', 'danger-soft');
    expect(within(mine).queryByRole('button', { name: '移出' })).toBeNull();
    expect(within(mine).queryByRole('button', { name: '转让队长' })).toBeNull();
    expect(within(mine).queryByRole('button', { name: '修改队名' })).toBeNull();
    expect(within(mine).queryByRole('button', { name: '邀请' })).toBeNull();
  });

  it('renders pending invites and posts accept or decline', async () => {
    const user = userEvent.setup();
    await renderStudent(body({
      capabilities: { canCreate: true },
      pendingInvites: [
        makeInvite({
          inviteId: INVITE_OK,
          teamName: '算法小分队',
          canAccept: true,
          memberUids: [LI_ID, EXTRA_ID],
        }),
        makeInvite({
          inviteId: INVITE_STALE,
          teamName: '已满的队伍',
          canAccept: false,
          memberUids: [LI_ID, EXTRA_ID, CHEN_ID],
        }),
      ],
    }));
    expect(primaryControls()).toHaveLength(1);
    const fresh = inviteBlock('算法小分队');
    expect(fresh.textContent).toContain('队长 李四');
    expect(fresh.textContent ?? '').toMatch(/2\s*\/\s*3|2\s*人/);
    expect(fresh.textContent).toContain(formatDateTime(INVITE_AT, 'zh_CN'));
    expect(within(fresh).getByRole('button', { name: '接受' })).toBeEnabled();
    expect(within(fresh).getByRole('button', { name: '接受' })).toHaveAttribute('data-variant', 'soft');
    expect(within(fresh).getByRole('button', { name: '拒绝' })).toHaveAttribute('data-variant', 'secondary');
    const stale = inviteBlock('已满的队伍');
    expect(within(stale).getByRole('button', { name: '接受' })).toBeDisabled();
    expect(within(stale).getByText(STALE_HINT)).toBeInTheDocument();

    const acceptStart = posts.length;
    await user.click(within(fresh).getByRole('button', { name: '接受' }));
    const accepted = await finishOptional(user, acceptStart, 'accept_invite');
    expectFields(accepted, { operation: 'accept_invite', inviteId: INVITE_OK });
  });

  it('posts decline_invite for a pending invite', async () => {
    const user = userEvent.setup();
    await renderStudent(body({
      pendingInvites: [
        makeInvite({
          inviteId: INVITE_OK,
          teamName: '算法小分队',
          canAccept: true,
          memberUids: [LI_ID, EXTRA_ID],
        }),
      ],
    }));
    const start = posts.length;
    await user.click(within(inviteBlock('算法小分队')).getByRole('button', { name: '拒绝' }));
    const posted = await finishOptional(user, start, 'decline_invite');
    expectFields(posted, { operation: 'decline_invite', inviteId: INVITE_OK });
  });

  it('removes every write action when a captain views a closed batch', async () => {
    await renderStudent(body({
      status: 'closed',
      ownTeam: makeOwnTeam(),
      capabilities: {
        canManage: true,
        canCreate: false,
        canInvite: true,
        canEditOwn: true,
        canLeave: true,
      },
      manageUrl: MANAGE_URL,
      pendingInvites: [
        makeInvite({
          inviteId: INVITE_STALE,
          teamName: '深夜刷题队',
          canAccept: false,
          memberUids: [LI_ID, EXTRA_ID, CHEN_ID],
        }),
      ],
    }));
    expect(screen.getByText(LOCKED)).toBeInTheDocument();
    expect(screen.queryByText(OUT_OF_SCOPE)).toBeNull();
    expect(screen.getByText('深夜刷题队')).toBeInTheDocument();
    expect(within(banner()).getByRole('link', { name: '管理批次' })).toHaveAttribute('href', MANAGE_URL);
    expectNoWriteButtons();
    expect(primaryControls()).toHaveLength(0);
    expect(within(panel('全部队伍')).getByRole('table').querySelectorAll('tbody tr')).toHaveLength(DIRECTORY_ROWS.length);
  });

  it('omits manage batch when manageUrl is null', async () => {
    await renderStudent(body({
      capabilities: { canCreate: true, canManage: false },
      manageUrl: null,
    }));
    expect(screen.queryByRole('link', { name: '管理批次' })).toBeNull();
    expect(screen.queryByRole('button', { name: '管理批次' })).toBeNull();
  });

  it('omits the description row when the batch description is empty', async () => {
    await renderStudent(body({
      description: '',
      capabilities: { canCreate: true },
    }));
    const aside = panel('组队说明');
    expect(within(aside).queryByText('说明')).toBeNull();
    expect(within(aside).getByText('状态')).toBeInTheDocument();
    expect(within(aside).getByText('每队')).toBeInTheDocument();
    expect(within(aside).getByText(LOCK_NOTE)).toBeInTheDocument();
  });
});
