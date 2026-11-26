import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { ComponentType } from 'react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { BootstrapProvider, type KryptonBootstrap, type KryptonUrls } from '../src/lib/bootstrap.tsx';

// A static import fails collection while admin-teachers.tsx is absent.
const pageLoaders = import.meta.glob('../src/pages/admin-teachers.tsx');

const PAGE_SOURCE = 'src/pages/admin-teachers.tsx';
const TEACHERS_PATH = '/admin/teachers';
const DESCRIPTION = '域角色为「老师」的账号。设为老师后，侧栏出现「教学」分组；老师不需要绑定学生档案。';
const WANG = 'wang_t';
const ZHOU = 'zhou2019';
const ZHAO = 'zhao_t';
const WANG_UID = 7;
const ZHOU_UID = 92;
const ZHAO_UID = 1281;
const STUDENT_ID = '240131';
const BOUND_STUDENT = `已绑定学生 ${STUDENT_ID}`;
const SCHOOL_A = 'school-a';
const SCHOOL_B = 'school-b';
const SCHOOL_A_NAME = '一中';
const SCHOOL_B_NAME = '二中';
const WANG_SCHOOLS = `${SCHOOL_A_NAME}、${SCHOOL_B_NAME}`;
const UNASSIGNED = '未指定学校';
const WANG_OWNED = '2 门课程 · 9 个题目集 · 3 个用户组';
const ZHOU_OWNED = '0 门课程 · 1 个题目集 · 0 个用户组';
const PASSWORD = 'pw-n12';
const EFFECTIVE = '445566778899';
const STORED = '112233445566';
const DENIED = '服务端拒绝了这次写入：N12-409。';
const RELOAD_DENIED = '教师名单刷新失败。';
const REMOVAL = /同时从.*教职工名单移除/;
const DEFAULT_OFF = new Set(['createPractice', 'createTask']);

const CAPABILITY_KEYS = [
  'createProblem',
  'browseProblemBank',
  'viewHiddenProblem',
  'createHomework',
  'createContest',
  'createPractice',
  'createCourse',
  'manageOwnGroups',
  'manageStudents',
  'readRecordCode',
  'createTask',
  'createCollect',
  'createRedemptionCode',
  'createExamEvent',
] as const;

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

interface OwnedCounts {
  courses: number;
  sets: number;
  groups: number;
}

interface TeacherFixture {
  uid: number;
  uname: string;
  schoolIds: string[];
  owned: OwnedCounts;
  loginAt: string | null;
}

interface CapabilityFixture {
  key: string;
  enabled: boolean;
  defaultEnabled: boolean;
}

interface TeachersPayload {
  teachers: TeacherFixture[];
  schools: Array<{ id: string; name: string }>;
  capabilities: {
    customized: boolean;
    stored: string | null;
    effective: string;
    items: CapabilityFixture[];
  };
}

interface FetchSession {
  gets: number;
  posts: URLSearchParams[];
}

type FetchMock = ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;

function fail(message: string): never {
  throw new TypeError(message);
}

function pageLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(pageLoaders)) {
    if (key.endsWith(PAGE_SOURCE)) return load;
  }
  return undefined;
}

async function loadAdminTeachersPage(): Promise<ComponentType> {
  const load = pageLoader();
  expect(typeof load, PAGE_SOURCE).toBe('function');
  if (typeof load !== 'function') fail(`${PAGE_SOURCE} must exist`);
  let imported: unknown;
  try {
    imported = await load();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect.fail(message);
  }
  if (typeof imported !== 'object' || imported === null || !('AdminTeachersPage' in imported)) {
    fail('AdminTeachersPage must be exported');
  }
  const component: unknown = imported.AdminTeachersPage;
  expect(typeof component, 'AdminTeachersPage').toBe('function');
  if (typeof component !== 'function') fail('AdminTeachersPage must be a function');
  return component as ComponentType;
}

function capabilityItems(): CapabilityFixture[] {
  return CAPABILITY_KEYS.map((key) => {
    const enabled = !DEFAULT_OFF.has(key);
    return { key, enabled, defaultEnabled: enabled };
  });
}

function customizedPayload(): TeachersPayload {
  const payload = teachersPayload();
  payload.capabilities.customized = true;
  payload.capabilities.stored = STORED;
  return payload;
}

function teachersPayload(): TeachersPayload {
  return {
    teachers: [
      {
        uid: WANG_UID,
        uname: WANG,
        schoolIds: [SCHOOL_A, SCHOOL_B],
        owned: { courses: 2, sets: 9, groups: 3 },
        loginAt: '2026-10-21T01:00:00.000Z',
      },
      {
        uid: ZHOU_UID,
        uname: ZHOU,
        schoolIds: [],
        owned: { courses: 0, sets: 1, groups: 0 },
        loginAt: null,
      },
    ],
    schools: [
      { id: SCHOOL_A, name: SCHOOL_A_NAME },
      { id: SCHOOL_B, name: SCHOOL_B_NAME },
    ],
    capabilities: {
      customized: false,
      stored: null,
      effective: EFFECTIVE,
      items: capabilityItems(),
    },
  };
}

function makeBootstrap(data: TeachersPayload): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-21T06:32:00.000Z',
    user: {
      id: 1,
      name: 'root',
      mail: '',
      signedIn: true,
      theme: 'light',
      viewLang: 'zh_CN',
      unreadMessages: 0,
      rp: 0,
      bio: '',
      priv: 1,
      role: 'root',
      tfa: false,
      authn: false,
      pinnedDomains: [],
      canBrowseProblemBank: true,
    },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: URLS,
    udict: {},
    page: { templateName: 'admin_teachers.html', data },
  };
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
      name: 'ConflictError',
      errorCode: 'ConflictError',
      code: status,
      status,
      params: [],
      message,
    },
  }, status);
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, 'http://krypton.local');
  if (input instanceof URL) return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  fail('unexpected fetch input');
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const fromInit = init?.method;
  if (typeof fromInit === 'string' && fromInit) return fromInit.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function readFormBody(body: BodyInit | null | undefined): URLSearchParams {
  if (body instanceof URLSearchParams) return new URLSearchParams(body);
  if (typeof body === 'string') return new URLSearchParams(body);
  if (body instanceof FormData) {
    const params = new URLSearchParams();
    for (const [key, value] of body.entries()) {
      if (typeof value === 'string') params.append(key, value);
    }
    return params;
  }
  fail('teacher admin write must submit a form body');
}

function searchText(body: BodyInit | null | undefined): string {
  if (typeof body !== 'string' || body === '') return '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return '';
  }
  if (typeof parsed !== 'object' || parsed === null || !('args' in parsed)) return '';
  const args: unknown = parsed.args;
  if (typeof args !== 'object' || args === null || !('search' in args)) return '';
  const search: unknown = args.search;
  return typeof search === 'string' ? search : '';
}

function installFetch(
  payload: TeachersPayload,
  postResponse?: Response,
  reloadResponse?: Response,
): { fetchMock: FetchMock; session: FetchSession } {
  const session: FetchSession = { gets: 0, posts: [] };
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    if (method === 'GET' && url.pathname === TEACHERS_PATH) {
      session.gets += 1;
      if (reloadResponse && session.posts.length > 0) return reloadResponse.clone();
      return jsonResponse(payload);
    }
    if (method === 'POST' && url.pathname === TEACHERS_PATH) {
      session.posts.push(readFormBody(init?.body));
      return postResponse ?? jsonResponse({ ok: true });
    }
    if (method === 'POST' && url.pathname.endsWith('/api/users')) {
      const query = searchText(init?.body);
      if (!query.includes('zhao')) return jsonResponse([]);
      return jsonResponse([{ _id: ZHAO_UID, uname: ZHAO, studentId: STUDENT_ID }]);
    }
    return jsonResponse({ error: 'unexpected fetch' }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, session };
}

async function renderTeachers(
  postResponse?: Response,
  payload: TeachersPayload = teachersPayload(),
  reloadResponse?: Response,
): Promise<FetchSession> {
  const { session } = installFetch(payload, postResponse, reloadResponse);
  const Page = await loadAdminTeachersPage();
  render(
    <BootstrapProvider bootstrap={makeBootstrap(payload)}>
      <Page />
    </BootstrapProvider>,
  );
  await screen.findByText(WANG);
  return session;
}

function countText(needle: string): number {
  return screen.queryAllByText(needle, { exact: false }).length;
}

function actionFor(uname: string, action: string): HTMLElement {
  const labels = screen.queryAllByText((_, node) => {
    if (!(node instanceof HTMLElement)) return false;
    const text = node.textContent ?? '';
    return text.includes(uname) && !text.includes(uname === WANG ? ZHOU : WANG);
  });
  for (const label of labels) {
    const buttons = within(label).queryAllByRole('button', { name: action });
    const button = buttons[0];
    if (button) return button;
  }
  fail(`missing ${action} for ${uname}`);
}

function fieldControl(root: HTMLElement, label: string): HTMLElement {
  const labeled = within(root).queryByLabelText(label);
  if (labeled) return labeled;
  const text = within(root).getByText(label);
  let parent: HTMLElement | null = text.parentElement;
  for (let depth = 0; depth < 6 && parent && root.contains(parent); depth += 1) {
    const control = parent.querySelector('input:not([type="hidden"]), textarea, [role="combobox"]');
    if (control instanceof HTMLElement && !text.contains(control)) return control;
    parent = parent.parentElement;
  }
  fail(`missing control ${label}`);
}

function passwordInput(root: HTMLElement): HTMLElement {
  const labeled = within(root).queryByLabelText(/管理员密码/);
  if (labeled) return labeled;
  const input = root.querySelector('input[type="password"]');
  if (input instanceof HTMLElement) return input;
  fail('missing admin password');
}

function removalCheckbox(root: HTMLElement): HTMLElement | null {
  const named = within(root).queryByRole('checkbox', { name: REMOVAL });
  if (named) return named;
  const text = within(root).queryByText(REMOVAL);
  const label = text?.closest('label');
  const input = label?.querySelector('input[type="checkbox"]');
  return input instanceof HTMLElement ? input : null;
}

function confirmButton(root: HTMLElement): HTMLElement {
  for (const name of [/^保存$/, /^确认$/, /^确定$/]) {
    const found = within(root).queryByRole('button', { name });
    if (found) return found;
  }
  const buttons = within(root).queryAllByRole('button').filter((button) => !/取消|关闭|保留/.test(button.textContent ?? ''));
  const confirm = buttons[buttons.length - 1];
  if (confirm) return confirm;
  fail('missing dialog confirm');
}

async function dismissDialog(user: UserEvent) {
  const dialog = screen.getByRole('dialog');
  const dismiss = within(dialog).queryByRole('button', { name: /^(取消|保留|关闭)$/ });
  if (dismiss) await user.click(dismiss);
  else await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
}

async function chooseMenuText(user: UserEvent, name: string) {
  const nodes = await screen.findAllByText(name);
  for (const node of nodes) {
    const choice = node.closest('button, [role="option"]');
    if (choice instanceof HTMLElement && !choice.closest('table')) {
      await user.click(choice);
      return;
    }
  }
  fail(`missing menu choice ${name}`);
}

async function openSetTeacher(user: UserEvent): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: '设为老师' }));
  return screen.findByRole('dialog');
}

async function pickAccount(user: UserEvent, dialog: HTMLElement) {
  const account = fieldControl(dialog, '账号');
  await user.click(account);
  await user.type(account, 'zhao');
  expect(await screen.findByText(BOUND_STUDENT)).toBeInTheDocument();
  await chooseMenuText(user, ZHAO);
}

async function pickSchool(user: UserEvent, dialog: HTMLElement) {
  const school = fieldControl(dialog, '任教学校');
  await user.click(school);
  await chooseMenuText(user, SCHOOL_A_NAME);
}

async function chooseSchool(user: UserEvent, name: string) {
  const named = screen.queryByRole('combobox', { name: /学校/ });
  const combos = named ? [named] : screen.queryAllByRole('combobox');
  const filter = combos.find((node) => /学校|全部/.test(node.textContent ?? '')) ?? combos[0];
  if (filter) {
    if (filter.tagName === 'SELECT') {
      await user.selectOptions(filter, within(filter).getByRole('option', { name }));
      return;
    }
    await user.click(filter);
    await user.click(await screen.findByRole('option', { name }));
    return;
  }
  await user.click(screen.getByRole('button', { name }));
}

async function chooseUnassigned(user: UserEvent) {
  await chooseSchool(user, UNASSIGNED);
}

function rosterSearch(): HTMLElement {
  const search = screen.queryByRole('searchbox');
  if (search) return search;
  const boxes = screen.queryAllByRole('textbox');
  const named = boxes.find((box) => /账号|搜索|邮箱|uname/i.test(
    `${box.getAttribute('placeholder') ?? ''} ${box.getAttribute('aria-label') ?? ''}`,
  ));
  if (named) return named;
  const box = boxes[0];
  if (box) return box;
  fail('missing roster search');
}

function postsFor(session: FetchSession, operation: string): URLSearchParams[] {
  return session.posts.filter((params) => params.get('operation') === operation);
}

function fieldList(params: URLSearchParams, key: string): string[] {
  return params.getAll(key).flatMap((value) => value.split(',')).map((item) => item.trim()).filter((item) => item !== '');
}

function capabilitySwitch(label: string): HTMLElement {
  const exact = screen.queryByRole('switch', { name: label });
  if (exact) return exact;
  const titles = screen.getAllByText(label);
  for (const title of titles) {
    let parent: HTMLElement | null = title.parentElement;
    for (let depth = 0; depth < 8 && parent; depth += 1) {
      const switches = [...parent.querySelectorAll('[role="switch"]')].filter((node) => node instanceof HTMLElement);
      if (switches.length === 1 && switches[0] instanceof HTMLElement) return switches[0];
      parent = parent.parentElement;
    }
  }
  fail(`missing switch ${label}`);
}

async function openCapabilities(user: UserEvent) {
  const tab = screen.getByRole('tab', { name: '老师能做什么' });
  tab.addEventListener('click', (event) => {
    event.preventDefault();
  });
  await user.click(tab);
  await screen.findByRole('button', { name: '恢复默认' });
}

beforeEach(() => {
  window.history.replaceState(null, '', TEACHERS_PATH);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('teacher administration page', () => {
  it('shows both teachers, an unspecified school, and owned counts', async () => {
    await renderTeachers();

    expect(screen.getByRole('heading', { name: '教师' })).toBeInTheDocument();
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /教师名单/ })).toHaveTextContent('2');
    expect(countText(WANG)).toBeGreaterThan(0);
    expect(countText(ZHOU)).toBeGreaterThan(0);
    expect(countText(WANG_SCHOOLS)).toBeGreaterThan(0);
    expect(countText(UNASSIGNED)).toBeGreaterThan(0);
    expect(countText(WANG_OWNED)).toBeGreaterThan(0);
    expect(countText(ZHOU_OWNED)).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '设为老师' })).toBeInTheDocument();
    expect(actionFor(WANG, '改学校')).toBeInTheDocument();
    expect(actionFor(ZHOU, '取消老师')).toBeInTheDocument();
  });

  it('filters the roster to teachers without a school', async () => {
    const user = userEvent.setup();
    await renderTeachers();

    await chooseUnassigned(user);

    await waitFor(() => {
      expect(countText(WANG)).toBe(0);
    });
    expect(countText(ZHOU)).toBeGreaterThan(0);
    expect(countText(WANG_OWNED)).toBe(0);
    expect(countText(ZHOU_OWNED)).toBeGreaterThan(0);
    expect(countText(UNASSIGNED)).toBeGreaterThan(0);
  });

  it('filters the roster by uname', async () => {
    const user = userEvent.setup();
    await renderTeachers();

    await user.type(rosterSearch(), ZHOU);

    await waitFor(() => {
      expect(countText(WANG)).toBe(0);
    });
    expect(countText(ZHOU)).toBeGreaterThan(0);
  });

  it('posts set_teacher and reloads the roster', async () => {
    const user = userEvent.setup();
    const session = await renderTeachers();
    const getsBefore = session.gets;
    const dialog = await openSetTeacher(user);

    await pickAccount(user, dialog);
    await pickSchool(user, dialog);
    await user.type(passwordInput(dialog), PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: '设为老师' }));

    await waitFor(() => {
      expect(session.gets).toBeGreaterThan(getsBefore);
    });
    const posted = postsFor(session, 'set_teacher');
    expect(posted).toHaveLength(1);
    const body = posted[0] ?? fail('missing set_teacher body');
    expect(body.get('uid')).toBe(String(ZHAO_UID));
    expect(fieldList(body, 'schoolIds')).toEqual([SCHOOL_A]);
    expect(body.get('password')).toBe(PASSWORD);
  });

  it('posts unset_teacher with the staff-removal checkbox', async () => {
    const user = userEvent.setup();
    const session = await renderTeachers();

    await user.click(actionFor(ZHOU, '取消老师'));
    const emptyDialog = await screen.findByRole('dialog');
    expect(emptyDialog).toHaveTextContent(`取消 ${ZHOU} 的老师身份？`);
    expect(removalCheckbox(emptyDialog)).toBeNull();
    await dismissDialog(user);

    await user.click(actionFor(WANG, '取消老师'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(`取消 ${WANG} 的老师身份？`);
    const checked = removalCheckbox(dialog) ?? fail('missing staff removal checkbox');
    expect(checked).toBeChecked();
    await user.type(passwordInput(dialog), PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: '取消老师' }));
    await waitFor(() => {
      expect(postsFor(session, 'unset_teacher')).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    await user.click(actionFor(WANG, '取消老师'));
    const again = await screen.findByRole('dialog');
    const box = removalCheckbox(again) ?? fail('missing staff removal checkbox');
    expect(box).toBeChecked();
    await user.click(box);
    expect(box).not.toBeChecked();
    await user.type(passwordInput(again), PASSWORD);
    await user.click(within(again).getByRole('button', { name: '取消老师' }));

    await waitFor(() => {
      expect(postsFor(session, 'unset_teacher')).toHaveLength(2);
    });
    const [kept, cleared] = postsFor(session, 'unset_teacher');
    expect(kept?.get('uid')).toBe(String(WANG_UID));
    expect(kept?.get('removeStaff')).toBe('1');
    expect(kept?.get('password')).toBe(PASSWORD);
    expect(cleared?.get('uid')).toBe(String(WANG_UID));
    expect(cleared?.get('removeStaff')).toBe('0');
    expect(cleared?.get('password')).toBe(PASSWORD);
  });

  it('saves capability changes against the current effective mask', async () => {
    const user = userEvent.setup();
    const session = await renderTeachers();
    await openCapabilities(user);

    expect(new URLSearchParams(window.location.search).has('tab')).toBe(true);
    expect(screen.getByText(/使用系统默认/)).toBeInTheDocument();
    expect(screen.queryByText(/本域已自定义/)).not.toBeInTheDocument();
    const restore = screen.getByRole('button', { name: '恢复默认' });
    const save = screen.getByRole('button', { name: '保存' });
    expect(restore).toBeDisabled();
    expect(save).toBeDisabled();
    expect(screen.queryByText('与默认不同')).not.toBeInTheDocument();

    await user.click(capabilitySwitch('建任务'));

    expect(screen.getByRole('button', { name: '恢复默认' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
    expect(screen.getAllByText('与默认不同').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '保存' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(passwordInput(dialog), PASSWORD);
    await user.click(confirmButton(dialog));

    await waitFor(() => {
      expect(postsFor(session, 'save_capabilities')).toHaveLength(1);
    });
    const body = postsFor(session, 'save_capabilities')[0] ?? fail('missing save_capabilities body');
    const enabled = fieldList(body, 'enabled');
    const expected = CAPABILITY_KEYS.filter((key) => key === 'createTask' || !DEFAULT_OFF.has(key));
    expect([...enabled].sort()).toEqual([...expected].sort());
    expect(enabled).not.toContain('createPractice');
    expect(body.get('expected')).toBe(EFFECTIVE);
  });

  it('shows the server message from a 409 inside the dialog', async () => {
    const user = userEvent.setup();
    const session = await renderTeachers(hydroError(DENIED, 409));
    const getsBefore = session.gets;
    const dialog = await openSetTeacher(user);

    await pickAccount(user, dialog);
    await pickSchool(user, dialog);
    await user.type(passwordInput(dialog), PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: '设为老师' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(DENIED);
    expect(screen.getByRole('dialog')).toHaveTextContent(DENIED);
    expect(session.gets).toBe(getsBefore);
  });

  it('shows a failed roster reload and does not repeat the write', async () => {
    const user = userEvent.setup();
    const session = await renderTeachers(undefined, teachersPayload(), hydroError(RELOAD_DENIED, 500));
    const dialog = await openSetTeacher(user);

    await pickAccount(user, dialog);
    await pickSchool(user, dialog);
    await user.type(passwordInput(dialog), PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: '设为老师' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(RELOAD_DENIED);
    expect(postsFor(session, 'set_teacher')).toHaveLength(1);

    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: '设为老师' });
    await waitFor(() => {
      expect(confirm).toBeEnabled();
    });
    await user.click(confirm);
    await waitFor(() => {
      expect(within(screen.getByRole('dialog')).getByRole('button', { name: '设为老师' })).toBeEnabled();
    });
    expect(postsFor(session, 'set_teacher')).toHaveLength(1);
  });

  it('filters the roster to one school', async () => {
    const user = userEvent.setup();
    await renderTeachers();

    await chooseSchool(user, SCHOOL_A_NAME);

    await waitFor(() => {
      expect(countText(ZHOU)).toBe(0);
    });
    expect(countText(WANG)).toBeGreaterThan(0);
    expect(countText(WANG_OWNED)).toBeGreaterThan(0);
    expect(countText(ZHOU_OWNED)).toBe(0);
  });

  it('posts set_schools for the teacher current schools', async () => {
    const user = userEvent.setup();
    const session = await renderTeachers();
    const getsBefore = session.gets;

    await user.click(actionFor(WANG, '改学校'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(`${WANG} 任教的学校`);
    await user.type(passwordInput(dialog), PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(postsFor(session, 'set_schools')).toHaveLength(1);
    });
    const body = postsFor(session, 'set_schools')[0] ?? fail('missing set_schools body');
    expect(body.get('uid')).toBe(String(WANG_UID));
    expect(fieldList(body, 'schoolIds')).toEqual([SCHOOL_A, SCHOOL_B]);
    expect(body.get('password')).toBe(PASSWORD);
    await waitFor(() => {
      expect(session.gets).toBeGreaterThan(getsBefore);
    });
  });

  it('explains unsetting a teacher and the student-binding warning', async () => {
    const user = userEvent.setup();
    await renderTeachers();

    await user.click(actionFor(WANG, '取消老师'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('普通账号要绑定学生档案才能继续用题目、比赛和作业（学生强制绑定）。');
    expect(dialog).toHaveTextContent('2 门课程');
    expect(dialog).toHaveTextContent('9 个题目集');
    expect(dialog).toHaveTextContent('3 个用户组');
    expect(dialog).toHaveTextContent('保持不变');
  });

  it('resets a customized teacher role with the stored mask', async () => {
    const user = userEvent.setup();
    const session = await renderTeachers(undefined, customizedPayload());
    await openCapabilities(user);

    expect(screen.getByText(/本域已自定义/)).toBeInTheDocument();
    expect(screen.queryByText(/使用系统默认/)).not.toBeInTheDocument();
    const restore = screen.getByRole('button', { name: '恢复默认' });
    expect(restore).toBeEnabled();
    await user.click(restore);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('不会改任何账号的角色');
    await user.type(passwordInput(dialog), PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: '恢复默认' }));

    await waitFor(() => {
      expect(postsFor(session, 'reset_capabilities')).toHaveLength(1);
    });
    const body = postsFor(session, 'reset_capabilities')[0] ?? fail('missing reset_capabilities body');
    expect(body.get('expected')).toBe(STORED);
    expect(body.get('password')).toBe(PASSWORD);
    expect(body.has('enabled')).toBe(false);
  });
});
