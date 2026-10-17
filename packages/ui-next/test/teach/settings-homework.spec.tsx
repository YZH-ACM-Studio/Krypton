import type { TeachTab } from '@hydrooj/common';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { DEFAULT_PENALTY_RULES, parseHomeworkSnapshot } from '../../src/pages/teach/legacy-forms.ts';
import { parseTeachShareState, type TeachWorkbenchPayload } from '../../src/pages/teach/model.ts';
import { LegacySnapshotProvider, WorkbenchDirtyProvider } from '../../src/pages/teach/settings-kit.tsx';

// A static import fails collection while settings-homework.tsx is absent.
const tabLoaders = import.meta.glob('../../src/pages/teach/tabs/settings-homework.tsx');

const TAB_SOURCE = 'src/pages/teach/tabs/settings-homework.tsx';
const HOMEWORK_ID = '64b7c3a2e4b0f96d1a2c3d4e';
const EDIT_PATH = `/homework/${HOMEWORK_ID}/edit`;
const SHARE_PATH = `/teach/homework/${HOMEWORK_ID}/share`;
const TITLE = '链表作业';
const BEGIN_DATE = '2026-10-13';
const BEGIN_TIME = '08:00';
const DEADLINE_DATE = '2026-10-20';
const DEADLINE_TIME = '23:59';
const PIDS = [11, 12] as const;
const LATE_DESCRIPTION = '截止后仍可提交，按超时时长打折计分。';
const LATE_LOCKS_PERSONAL = '已经允许迟交，不能再设个人限时。关掉「允许迟交」后可以设。';
const PERSONAL_LOCKS_LATE = '已经设了个人限时，不能再允许迟交。清空个人限时后可以打开。';
const PERSONAL_HINT = '设了以后，学生先点「开始作答」才计时，到时自动截止；同时不能再允许迟交。';
const PENALTY_HINT = '超过截止时间多久，得分乘以多少';
const PENALTY_LINE = /^\s*([0-9]+(?:\.[0-9]+)?)\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*$/;

interface SettingsHomeworkTabProps {
  payload: TeachWorkbenchPayload;
  onNavigateTab: (tab: TeachTab) => void;
}

interface RecordedCall {
  method: string;
  pathname: string;
  body: string;
}

interface PenaltyRow {
  hours: HTMLInputElement;
  coefficient: HTMLInputElement;
  remove: HTMLButtonElement;
}

interface WindowStamp {
  beginDate: string;
  beginTime: string;
  deadlineDate: string;
  deadlineTime: string;
}

interface HomeworkFixture {
  extensionDays: number;
  penaltyRules: Record<string, number> | null;
  beginDate?: string;
  beginTime?: string;
  deadlineDate?: string;
  deadlineTime?: string;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asComponent<Props>(value: unknown, key: string): ComponentType<Props> {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as ComponentType<Props>;
}

function tabLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(tabLoaders)) {
    if (key.endsWith(TAB_SOURCE)) return load;
  }
  return undefined;
}

async function loadTab(): Promise<ComponentType<SettingsHomeworkTabProps>> {
  const load = tabLoader();
  expect(typeof load, TAB_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${TAB_SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('settings homework module must be an object');
  return asComponent<SettingsHomeworkTabProps>(readField(imported, 'SettingsHomeworkTab'), 'SettingsHomeworkTab');
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function addCalendarDays(date: string, time: string, days: number): { date: string; time: string } {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch?.[1] || !dateMatch[2] || !dateMatch[3] || !timeMatch?.[1] || !timeMatch[2]) {
    throw new TypeError('stamp');
  }
  const value = new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    0,
    0,
  );
  value.setDate(value.getDate() + days);
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  };
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, 'http://krypton.local');
  if (input instanceof URL) return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  throw new TypeError('unexpected fetch input');
}

async function readRequestBody(body: BodyInit | null | undefined): Promise<string> {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const params = new URLSearchParams();
    for (const [key, value] of body.entries()) {
      if (typeof value === 'string') params.append(key, value);
    }
    return params.toString();
  }
  if (body instanceof Blob) return body.text();
  return '';
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function shareBody(): Record<string, unknown> {
  return {
    shared: null,
    canShare: true,
    ownHiddenUnshared: [],
    othersHiddenUnshared: [],
  };
}

const DEFAULT_WINDOW: WindowStamp = {
  beginDate: BEGIN_DATE,
  beginTime: BEGIN_TIME,
  deadlineDate: DEADLINE_DATE,
  deadlineTime: DEADLINE_TIME,
};

function homeworkWindow(fixture: Partial<WindowStamp> = {}): WindowStamp {
  return {
    beginDate: fixture.beginDate ?? DEFAULT_WINDOW.beginDate,
    beginTime: fixture.beginTime ?? DEFAULT_WINDOW.beginTime,
    deadlineDate: fixture.deadlineDate ?? DEFAULT_WINDOW.deadlineDate,
    deadlineTime: fixture.deadlineTime ?? DEFAULT_WINDOW.deadlineTime,
  };
}

function homeworkSnapshot(fixture: HomeworkFixture): Record<string, unknown> {
  const stamp = homeworkWindow(fixture);
  return {
    page_name: 'homework_edit',
    extensionDays: fixture.extensionDays,
    penaltyRules: fixture.penaltyRules ?? {},
    dateBeginText: stamp.beginDate,
    timeBeginText: stamp.beginTime,
    datePenaltyText: stamp.deadlineDate,
    timePenaltyText: stamp.deadlineTime,
    participantScopeMode: 'none',
    participantGroupIds: [],
    scopeGroups: [],
    tdoc: {
      _id: HOMEWORK_ID,
      title: TITLE,
      content: '写出逆置过程。',
      pids: [...PIDS],
      rated: false,
      maintainer: [],
      assign: [],
      langs: [],
    },
  };
}

function pageBootstrap(): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: '2026-10-16T00:00:00.000Z',
    user: {
      id: 4,
      name: 'wang',
      mail: 'wang@example.com',
      signedIn: true,
      theme: 'light',
      viewLang: 'zh',
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
    urls: {
      home: '/',
      problems: '/p',
      contests: '/contest',
      homework: '/homework',
      training: '/training',
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
      domainPermission: '/domain/perm',
      manage: '/manage',
      status: '/status',
      problemDetail: '/p/:pid',
      contestDetail: '/contest/:tid',
      homeworkDetail: '/homework/:tid',
      trainingDetail: '/training/:tid',
      discussionDetail: '/discuss/:did',
      discussionNode: '/discuss/node/:node',
      userDetail: '/user/:uid',
      recordDetail: '/record/:rid',
    },
    udict: {},
    page: { templateName: 'teach_workbench.html', data: {} },
  };
}

function homeworkPayload(): TeachWorkbenchPayload {
  return {
    container: {
      type: 'homework',
      id: HOMEWORK_ID,
      rule: 'homework',
      title: TITLE,
      status: 'upcoming',
      beginAt: '2026-10-13T00:00:00.000Z',
      endAt: '2026-10-20T15:59:00.000Z',
      durationMinutes: null,
      penaltySince: '2026-10-20T15:59:00.000Z',
      lockAt: null,
      audience: {
        mode: 'all',
        groupNames: [],
        schoolNames: [],
        boundStudentCount: null,
      },
      owner: { uid: 4, name: '王老师' },
      maintainers: [],
      createdAt: '2026-10-01T00:00:00.000Z',
      schoolShared: null,
      copiedFrom: null,
      examPassScore: null,
      examAttemptLimit: null,
      participationMode: 'individual',
      vigilEnabled: false,
      entryMode: 'open',
      links: {
        studentView: `/homework/${HOMEWORK_ID}`,
        scoreboard: null,
        manage: null,
        users: null,
        clarification: null,
        grading: null,
        teams: null,
        balloon: null,
        print: null,
        code: null,
        files: `/homework/${HOMEWORK_ID}/file`,
        redemption: null,
      },
    },
    paper: { problems: [], stages: null, examPaperQuotas: null },
    stats: {
      participantCount: 0,
      startedCount: null,
      finalizedCount: null,
      submittedCount: null,
      recordCount: null,
      audienceCount: null,
      problemStats: null,
    },
    capabilities: {
      canDelete: true,
      canShare: true,
      canGrade: false,
      canManageTeamBatches: false,
      isSystemAdmin: false,
      canPin: false,
    },
  };
}

function installFetch(snapshot: Record<string, unknown>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
    const url = requestUrl(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = await readRequestBody(init?.body);
    calls.push({ method, pathname: url.pathname, body });
    if (method === 'GET' && url.pathname === EDIT_PATH) return jsonResponse(snapshot);
    if (method === 'POST' && url.pathname === EDIT_PATH) return jsonResponse({ ok: true });
    if (method === 'GET' && url.pathname === SHARE_PATH) return jsonResponse(shareBody());
    return jsonResponse({ error: { message: `不该请求 ${method} ${url.pathname}` } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '');
}

function labelByText(text: string): HTMLLabelElement {
  const label = [...document.querySelectorAll('label')].find((node) => normalize(node.textContent).startsWith(normalize(text)));
  if (!(label instanceof HTMLLabelElement)) throw new TypeError(`label ${text}`);
  return label;
}

function lateSwitch(): HTMLInputElement {
  const control = screen.getByRole('switch', { name: '允许迟交' });
  if (!(control instanceof HTMLInputElement)) throw new TypeError('允许迟交');
  return control;
}

function personalInput(): HTMLInputElement {
  const control = screen.getByLabelText(/个人限时/);
  if (!(control instanceof HTMLInputElement)) throw new TypeError('个人限时');
  return control;
}

function lateDeadlineInputs(): { date: HTMLInputElement; time: HTMLInputElement } {
  const dates = [...document.querySelectorAll('input')].filter((node): node is HTMLInputElement => (
    node instanceof HTMLInputElement
    && node.getAttribute('type') === 'date'
    && node.getAttribute('aria-label') !== '开始日期'
    && node.getAttribute('aria-label') !== '截止日期'
  ));
  const times = [...document.querySelectorAll('input')].filter((node): node is HTMLInputElement => (
    node instanceof HTMLInputElement
    && node.getAttribute('type') === 'time'
    && node.getAttribute('aria-label') !== '开始时间'
    && node.getAttribute('aria-label') !== '截止时间'
  ));
  expect(dates, '迟交截止日期').toHaveLength(1);
  expect(times, '迟交截止时间').toHaveLength(1);
  const date = dates[0];
  const time = times[0];
  if (!date || !time) throw new TypeError('迟交截止');
  return { date, time };
}

function penaltyRoot(): HTMLElement {
  const label = labelByText('扣分规则');
  let node: HTMLElement | null = label.parentElement;
  while (node) {
    const ownsTier = [...node.querySelectorAll('button')].some((button) => {
      const name = `${button.getAttribute('aria-label') ?? ''} ${button.textContent ?? ''}`;
      return name.includes('删除这一档') || name.includes('加一档');
    });
    if (ownsTier) return node;
    node = node.parentElement;
  }
  throw new TypeError('扣分规则');
}

function rowContaining(button: HTMLButtonElement): HTMLElement {
  let node: HTMLElement | null = button.parentElement;
  while (node) {
    const deletes = [...node.querySelectorAll('button')].filter((item) => item.getAttribute('aria-label') === '删除这一档');
    const inputs = [...node.querySelectorAll('input')];
    if (deletes.length === 1 && inputs.length >= 2) return node;
    node = node.parentElement;
  }
  throw new TypeError('penalty row');
}

function penaltyRows(): PenaltyRow[] {
  const buttons = [...penaltyRoot().querySelectorAll('button')].filter((button) => button.getAttribute('aria-label') === '删除这一档');
  return buttons.map((button) => {
    if (!(button instanceof HTMLButtonElement)) throw new TypeError('删除这一档');
    const inputs = [...rowContaining(button).querySelectorAll('input')].filter((node): node is HTMLInputElement => node instanceof HTMLInputElement);
    const hours = inputs[0];
    const coefficient = inputs[1];
    if (!hours || !coefficient || inputs.length !== 2) throw new TypeError('penalty inputs');
    return { hours, coefficient, remove: button };
  });
}

function addTierButton(): HTMLButtonElement {
  const button = screen.getByRole('button', { name: '加一档' });
  if (!(button instanceof HTMLButtonElement)) throw new TypeError('加一档');
  return button;
}

function setInputValue(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

function postCalls(calls: readonly RecordedCall[]): RecordedCall[] {
  return calls.filter((call) => call.method === 'POST');
}

function editPosts(calls: readonly RecordedCall[]): RecordedCall[] {
  return calls.filter((call) => call.method === 'POST' && call.pathname === EDIT_PATH);
}

function postedParams(calls: readonly RecordedCall[]): URLSearchParams {
  const posts = editPosts(calls);
  expect(posts).toHaveLength(1);
  return new URLSearchParams(posts[0]?.body ?? '');
}

function penaltyLines(raw: string): Array<{ hours: number; coefficient: number }> {
  const lines = raw.split('\n').filter((line) => line.trim() !== '');
  return lines.map((line) => {
    const match = PENALTY_LINE.exec(line);
    expect(match, line).not.toBeNull();
    if (!match?.[1] || !match[2]) throw new TypeError(`penalty line ${line}`);
    return { hours: Number(match[1]), coefficient: Number(match[2]) };
  });
}

function expectKeptDocument(params: URLSearchParams, stamp: WindowStamp = DEFAULT_WINDOW) {
  expect(params.get('operation')).toBe('update');
  expect(params.get('title')).toBe(TITLE);
  expect(params.get('pids')).toBe(PIDS.join(','));
  expect(params.get('beginAtDate')).toBe(stamp.beginDate);
  expect(params.get('beginAtTime')).toBe(stamp.beginTime);
  expect(params.get('penaltySinceDate')).toBe(stamp.deadlineDate);
  expect(params.get('penaltySinceTime')).toBe(stamp.deadlineTime);
  expect(params.has('allowPostContestView')).toBe(false);
  expect(params.has('allowPostContestPractice')).toBe(false);
  expect(params.has('allowPostContestSubmit')).toBe(false);
}

async function renderHomework(fixture: HomeworkFixture): Promise<{ calls: RecordedCall[]; user: ReturnType<typeof userEvent.setup>; stamp: WindowStamp }> {
  const stamp = homeworkWindow(fixture);
  const snapshot = homeworkSnapshot({ ...fixture, ...stamp });
  parseHomeworkSnapshot(snapshot);
  parseTeachShareState(shareBody());
  const Tab = await loadTab();
  const calls = installFetch(snapshot);
  const user = userEvent.setup();
  render(
    <BootstrapProvider bootstrap={pageBootstrap()}>
      <WorkbenchDirtyProvider>
        <LegacySnapshotProvider type="homework" id={HOMEWORK_ID}>
          <Tab payload={homeworkPayload()} onNavigateTab={vi.fn()} />
        </LegacySnapshotProvider>
      </WorkbenchDirtyProvider>
    </BootstrapProvider>,
  );
  await waitFor(() => {
    expect(screen.getByLabelText('开始日期')).toHaveValue(stamp.beginDate);
    expect(screen.getByLabelText('开始时间')).toHaveValue(stamp.beginTime);
    expect(screen.getByLabelText('截止日期')).toHaveValue(stamp.deadlineDate);
    expect(screen.getByLabelText('截止时间')).toHaveValue(stamp.deadlineTime);
    expect(screen.getByText('没有共享。')).toBeInTheDocument();
  });
  expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
  return { calls, user, stamp };
}

async function saveEdit(user: ReturnType<typeof userEvent.setup>, calls: RecordedCall[]): Promise<URLSearchParams> {
  const save = screen.getByRole('button', { name: '保存' });
  expect(save).toBeEnabled();
  await user.click(save);
  await waitFor(() => {
    expect(editPosts(calls)).toHaveLength(1);
  });
  return postedParams(calls);
}

async function expectSaveBlocked(user: ReturnType<typeof userEvent.setup>, calls: RecordedCall[]) {
  const before = postCalls(calls).length;
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
  const save = screen.getByRole('button', { name: '保存' });
  expect(save).toBeEnabled();
  await user.click(save);
  await waitFor(() => {
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });
  expect(postCalls(calls)).toHaveLength(before);
  expect(editPosts(calls)).toHaveLength(0);
}

describe('settings homework tab', () => {
  it('disables personal time while late submission is open, then disables late submission after 90 minutes', async () => {
    const { user } = await renderHomework({
      extensionDays: 2,
      penaltyRules: { 1: 0.9, 3: 0.8, 12: 0.75, 9999: 0.5 },
    });

    expect(screen.getByRole('heading', { name: '基本信息' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '时间' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '协作者' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '学校内共享' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '危险操作' })).toBeInTheDocument();
    expect(screen.getByText('删除这个作业')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '结束以后' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '赛后' })).not.toBeInTheDocument();
    expect(screen.queryByText('允许查看题目')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('结束日期')).not.toBeInTheDocument();

    expect(lateSwitch()).toBeChecked();
    expect(lateSwitch()).toBeEnabled();
    expect(screen.getByText(LATE_DESCRIPTION)).toBeInTheDocument();
    expect(personalInput()).toBeDisabled();
    expect(screen.getByText(LATE_LOCKS_PERSONAL)).toBeInTheDocument();
    expect(screen.queryByText(PERSONAL_HINT)).not.toBeInTheDocument();

    await user.click(lateSwitch());

    expect(lateSwitch()).not.toBeChecked();
    expect(lateSwitch()).toBeEnabled();
    expect(screen.queryByText(LATE_LOCKS_PERSONAL)).not.toBeInTheDocument();
    expect(screen.getByText(PERSONAL_HINT)).toBeInTheDocument();
    expect(screen.getByText(LATE_DESCRIPTION)).toBeInTheDocument();
    expect(personalInput()).toBeEnabled();

    setInputValue(personalInput(), '90');

    expect(personalInput()).toHaveValue(90);
    expect(personalInput()).toBeEnabled();
    expect(lateSwitch()).toBeDisabled();
    expect(lateSwitch()).not.toBeChecked();
    expect(screen.getByText(PERSONAL_LOCKS_LATE)).toBeInTheDocument();
    expect(screen.queryByText(LATE_DESCRIPTION)).not.toBeInTheDocument();
  });

  it('saves 90 personal minutes as contestDuration 1.5 and empty penalty rules', async () => {
    const { calls, user } = await renderHomework({ extensionDays: 0, penaltyRules: {} });

    expect(lateSwitch()).not.toBeChecked();
    expect(lateSwitch()).toBeEnabled();
    expect(personalInput()).toBeEnabled();
    expect(screen.getByText(PERSONAL_HINT)).toBeInTheDocument();
    expect(addTierButton()).toBeDisabled();
    expect(lateDeadlineInputs().date).toBeDisabled();
    expect(lateDeadlineInputs().time).toBeDisabled();

    setInputValue(personalInput(), '90');

    expect(personalInput()).toHaveValue(90);
    expect(lateSwitch()).toBeDisabled();
    expect(screen.getByText(PERSONAL_LOCKS_LATE)).toBeInTheDocument();
    expect(screen.getByText('1 项修改未保存')).toBeInTheDocument();

    const params = await saveEdit(user, calls);
    expectKeptDocument(params);
    expect(params.get('contestDuration')).toBe('1.5');
    expect(params.get('penaltyRules')).toBe('{}');
    expect(params.get('extensionDays')).toBe('0');
  });

  it('fills four default penalty tiers when late submission opens and saves the three that remain', async () => {
    const { calls, user } = await renderHomework({ extensionDays: 0, penaltyRules: {} });
    const expectedLate = addCalendarDays(DEADLINE_DATE, DEADLINE_TIME, 2);

    expect(screen.getByText(PENALTY_HINT)).toBeInTheDocument();
    expect(addTierButton()).toBeDisabled();
    for (const row of penaltyRows()) {
      expect(row.hours).toBeDisabled();
      expect(row.coefficient).toBeDisabled();
      expect(row.remove).toBeDisabled();
    }

    await user.click(lateSwitch());

    expect(lateSwitch()).toBeChecked();
    expect(personalInput()).toBeDisabled();
    expect(screen.getByText(LATE_LOCKS_PERSONAL)).toBeInTheDocument();
    expect(addTierButton()).toBeEnabled();
    const late = lateDeadlineInputs();
    expect(late.date).toBeEnabled();
    expect(late.time).toBeEnabled();
    expect(late.date).toHaveValue(expectedLate.date);
    expect(late.time).toHaveValue(expectedLate.time);

    const rows = penaltyRows();
    expect(rows).toHaveLength(DEFAULT_PENALTY_RULES.length);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rule = DEFAULT_PENALTY_RULES[index];
      if (!row || !rule) throw new TypeError('default penalty rule');
      expect(Number(row.hours.value)).toBe(rule.hours);
      expect(Number(row.coefficient.value)).toBe(rule.coefficient);
      expect(row.hours).toBeEnabled();
      expect(row.coefficient).toBeEnabled();
      expect(row.remove).toBeEnabled();
    }

    const removed = rows.find((row) => Number(row.hours.value) === 12);
    if (!removed) throw new TypeError('12 hour tier');
    await user.click(removed.remove);
    expect(penaltyRows().some((row) => Number(row.hours.value) === 12)).toBe(false);

    const params = await saveEdit(user, calls);
    expectKeptDocument(params);
    expect(params.get('extensionDays')).toBe('2');
    expect(params.get('contestDuration')).toBe('');
    expect(penaltyLines(params.get('penaltyRules') ?? '')).toEqual(
      DEFAULT_PENALTY_RULES.filter((rule) => rule.hours !== 12).map((rule) => ({
        hours: rule.hours,
        coefficient: rule.coefficient,
      })),
    );
  });

  it('refuses a coefficient of 1.5 without posting', async () => {
    const { calls, user } = await renderHomework({
      extensionDays: 2,
      penaltyRules: { 1: 0.9, 3: 0.8, 12: 0.75, 9999: 0.5 },
    });
    const row = penaltyRows()[0];
    if (!row) throw new TypeError('penalty row');
    setInputValue(row.coefficient, '1.5');
    expect(row.coefficient.value).toBe('1.5');
    await expectSaveBlocked(user, calls);
  });

  it('refuses a coefficient of 0 without posting', async () => {
    const { calls, user } = await renderHomework({
      extensionDays: 2,
      penaltyRules: { 1: 0.9, 3: 0.8, 12: 0.75, 9999: 0.5 },
    });
    const row = penaltyRows()[0];
    if (!row) throw new TypeError('penalty row');
    setInputValue(row.coefficient, '0');
    expect(Number(row.coefficient.value)).toBe(0);
    await expectSaveBlocked(user, calls);
  });

  it('refuses a negative penalty hour without posting', async () => {
    const { calls, user } = await renderHomework({
      extensionDays: 2,
      penaltyRules: { 1: 0.9, 3: 0.8, 12: 0.75, 9999: 0.5 },
    });
    const row = penaltyRows()[0];
    if (!row) throw new TypeError('penalty row');
    setInputValue(row.hours, '-1');
    expect(row.hours.value).toBe('-1');
    await expectSaveBlocked(user, calls);
  });

  it('refuses a late deadline that is not after the deadline without posting', async () => {
    const { calls, user } = await renderHomework({
      extensionDays: 2,
      penaltyRules: { 1: 0.9, 3: 0.8, 12: 0.75, 9999: 0.5 },
    });
    const late = lateDeadlineInputs();
    const tooEarly = addCalendarDays(DEADLINE_DATE, DEADLINE_TIME, -1);
    setInputValue(late.date, tooEarly.date);
    setInputValue(late.time, tooEarly.time);
    expect(late.date).toHaveValue(tooEarly.date);
    expect(late.time).toHaveValue(tooEarly.time);
    await expectSaveBlocked(user, calls);
  });

  it('clears extension days when late submission is turned off', async () => {
    const { calls, user } = await renderHomework({
      extensionDays: 2,
      penaltyRules: { 1: 0.9, 3: 0.8, 12: 0.75, 9999: 0.5 },
    });

    await user.click(lateSwitch());
    expect(lateSwitch()).not.toBeChecked();

    const params = await saveEdit(user, calls);
    expectKeptDocument(params);
    expect(params.get('extensionDays')).toBe('0');
    expect(params.get('penaltyRules')).toBe('{}');
    expect(params.get('contestDuration')).toBe('');
  });

  // 旧接口按毫秒差把 extensionDays 收成两位小数；moment 加「天」则按日历。夏令时当天的同一钟点仍是 2 天，五分钟会被收成 0。
  it('posts two extension days when the late deadline crosses us spring-forward', async () => {
    const previous = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    const spring = homeworkWindow({
      beginDate: '2026-03-01',
      beginTime: '08:00',
      deadlineDate: '2026-03-07',
      deadlineTime: '23:59',
    });
    try {
      const elapsedDays = (new Date(2026, 2, 9, 23, 59).getTime() - new Date(2026, 2, 7, 23, 59).getTime()) / 86_400_000;
      expect(elapsedDays).toBeLessThan(2);
      const { calls, user, stamp } = await renderHomework({ extensionDays: 0, penaltyRules: {}, ...spring });
      await user.click(lateSwitch());
      const late = lateDeadlineInputs();
      expect(late.date).toHaveValue('2026-03-09');
      expect(late.time).toHaveValue('23:59');
      const params = await saveEdit(user, calls);
      expectKeptDocument(params, stamp);
      expect(params.get('extensionDays')).toBe('2');
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  // moment.add(n, 'days') absRounds to a whole day, so 1.52 is not a saved window.
  it('saves 12:30 only as two whole days on the deadline clock, or not at all', async () => {
    const { calls, user } = await renderHomework({
      extensionDays: 2,
      penaltyRules: { 1: 0.9, 3: 0.8, 12: 0.75, 9999: 0.5 },
    });
    const late = lateDeadlineInputs();
    setInputValue(late.date, '2026-10-22');
    setInputValue(late.time, '12:30');
    expect(late.date).toHaveValue('2026-10-22');
    expect(late.time).toHaveValue('12:30');
    const before = postCalls(calls).length;
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      const posted = editPosts(calls).length > 0;
      const blocked = screen.queryAllByRole('alert').length > 0;
      expect(posted || blocked).toBe(true);
    });
    if (editPosts(calls).length === 0) {
      expect(postCalls(calls)).toHaveLength(before);
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
      return;
    }
    const params = postedParams(calls);
    expectKeptDocument(params);
    expect(params.get('extensionDays')).toBe('2');
    const aligned = lateDeadlineInputs();
    expect(aligned.date).toHaveValue('2026-10-22');
    expect(aligned.time).toHaveValue(DEADLINE_TIME);
  });

  it('does not post a late deadline only ten hours later', async () => {
    const { calls, user } = await renderHomework({
      extensionDays: 2,
      penaltyRules: { 1: 0.9, 3: 0.8, 12: 0.75, 9999: 0.5 },
    });
    const late = lateDeadlineInputs();
    setInputValue(late.date, '2026-10-21');
    setInputValue(late.time, '09:59');
    expect(late.date).toHaveValue('2026-10-21');
    expect(late.time).toHaveValue('09:59');
    const before = postCalls(calls).length;
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      const posted = editPosts(calls).length > 0;
      const blocked = screen.queryAllByRole('alert').length > 0;
      expect(posted || blocked).toBe(true);
    });
    expect(editPosts(calls)).toHaveLength(0);
    expect(postCalls(calls)).toHaveLength(before);
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });

  it('does not post a late deadline only five minutes later', async () => {
    const { calls, user } = await renderHomework({
      extensionDays: 2,
      penaltyRules: { 1: 0.9, 3: 0.8, 12: 0.75, 9999: 0.5 },
    });
    const late = lateDeadlineInputs();
    setInputValue(late.date, '2026-10-21');
    setInputValue(late.time, '00:04');
    expect(late.date).toHaveValue('2026-10-21');
    expect(late.time).toHaveValue('00:04');
    await expectSaveBlocked(user, calls);
  });
});
