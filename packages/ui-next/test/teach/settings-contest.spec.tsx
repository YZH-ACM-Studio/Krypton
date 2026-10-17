import type { TeachTab, TeachType } from '@hydrooj/common';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import {
  contestFormBody,
  parseContestSnapshot,
  type ContestFormState,
} from '../../src/pages/teach/legacy-forms.ts';
import type {
  TeachCapabilities,
  TeachContainerSummary,
  TeachLinks,
  TeachPaper,
  TeachPaperProblem,
  TeachStats,
  TeachWorkbenchPayload,
} from '../../src/pages/teach/model.ts';
import { LegacySnapshotProvider, useWorkbenchDirty, WorkbenchDirtyProvider } from '../../src/pages/teach/settings-kit.tsx';

// A static import fails collection while settings-contest.tsx is absent.
const tabLoaders = import.meta.glob('../../src/pages/teach/tabs/settings-contest.tsx');

const TAB_SOURCE = 'src/pages/teach/tabs/settings-contest.tsx';
const CONTEST_ID = '64b7c3a2e4b0f96d1a2c3d4e';
const MAINTAINER_ID = 7;
const INVITE_CODE = 'keep-invite';
const WINDOW_HOURS = 5;
const BEGIN = new Date(2026, 0, 15, 9, 0, 0, 0);
const END = new Date(2026, 0, 15, 14, 0, 0, 0);
const EDIT_PATH = `/contest/${CONTEST_ID}/edit`;
const LOCK_EMPTY_HINT = '留空 = 不封榜';
const LOCK_BLOCKS_PERSONAL = '已经设了封榜，不能再设个人限时。';
const PERSONAL_BLOCKS_LOCK = '已经设了个人限时，不能封榜。';
const CONTEST_OPEN_HINT = '比赛的开始和结束时间。';
const EXAM_OPEN_HINT = '学生在这段时间里可以开始答题。';
const CONTEST_PERSONAL_HINT = '每个人从第一次打开题目开始计时（限时赛）。';
const TIME_DESCRIPTION = '开放时间 + 可选的个人限时。';
const MARKDOWN_HINT = '学生在详情页看到，支持 Markdown';
const VIEW_LABEL = '允许查看题目';
const PRACTICE_LABEL = '允许补题';
const CODE_LABEL = '允许查看他人代码';
const BOARD_LABEL = '赛后保持榜单隐藏';
const VIEW_DESCRIPTION = '结束后学生还能打开题面。';
const PRACTICE_DESCRIPTION = '结束后继续提交，记作补题，不进正式榜单。';
const PRACTICE_BLOCKED = '先允许查看题目';
const CODE_DESCRIPTION = '结束后能看到其他人的提交代码。';
const BOARD_DESCRIPTION = '结束后普通学生也看不到榜单。';
const VERDICT_LABEL = '学生能看到每题对错';
const VERDICT_DESCRIPTION = '关掉后学生只看到总分。';
const PASS_LABEL = '及格线';
const ATTEMPT_LABEL = '最多考几次';
const PASS_HINT = '留空 = 不设及格线，也不能补考';
const ATTEMPT_HINT = '含第一次。需要先设及格线';
const ATTEMPT_SUFFIX = '次。不及格且次数没用完，学生可以重新抽卷再考。';
const PASS_OVER_FULL = '及格线不能超过满分';
const FULL_SCORE_TEXT = '满分 110';
const BEGIN_MISSING = '请填写开始时间';
const UNSAVED_ONE = '1 项修改未保存';

interface SettingsTabProps {
  payload: TeachWorkbenchPayload;
  onNavigateTab: (tab: TeachTab) => void;
}

interface SettingsContestModule {
  SettingsContestTab: ComponentType<SettingsTabProps>;
}

interface RecordedCall {
  method: string;
  pathname: string;
  body: string;
}

interface RoutedCall {
  method: string;
  url: URL;
  body: string;
}

interface EditOptions {
  rule: string;
  title: string;
  allowPostContestView: boolean;
  allowPostContestPractice: boolean;
  allowPostContestSubmit: boolean;
  allowViewCode: boolean;
  keepScoreboardHidden: boolean;
  exam: boolean;
  scores: Record<string, number> | null;
  begin?: Date;
  windowHours?: number;
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

async function loadSettingsContest(): Promise<SettingsContestModule> {
  const load = tabLoader();
  expect(typeof load, TAB_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${TAB_SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('settings contest module must be an object');
  return {
    SettingsContestTab: asComponent<SettingsTabProps>(readField(imported, 'SettingsContestTab'), 'SettingsContestTab'),
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function localStamp(date: Date): { date: string; time: string } {
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
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
  if (body instanceof Blob) return body.text();
  throw new TypeError('unexpected request body');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function userIds(body: string): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  const args = parsed.args;
  if (!isRecord(args) || !Array.isArray(args.ids)) return [];
  return args.ids.filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0);
}

function shareState(): Record<string, unknown> {
  return {
    shared: null,
    canShare: true,
    ownHiddenUnshared: [],
    othersHiddenUnshared: [],
  };
}

function editDocument(options: EditOptions): Record<string, unknown> {
  const begin = options.begin ?? BEGIN;
  const windowHours = options.windowHours ?? WINDOW_HOURS;
  const end = new Date(begin.getTime() + windowHours * 3_600_000);
  const tdoc: Record<string, unknown> = {
    _id: CONTEST_ID,
    title: options.title,
    content: '闭卷说明',
    rule: options.rule,
    beginAt: begin.toISOString(),
    endAt: end.toISOString(),
    pids: [8, 9],
    rated: false,
    autoHide: false,
    assign: [],
    hidden: false,
    maintainer: [MAINTAINER_ID],
    allowViewCode: options.allowViewCode,
    allowPrint: false,
    keepScoreboardHidden: options.keepScoreboardHidden,
    allowVirtual: false,
    allowPostContestView: options.allowPostContestView,
    allowPostContestPractice: options.allowPostContestPractice,
    allowPostContestSubmit: options.allowPostContestSubmit,
    langs: ['py.py3'],
    vigilEnabled: true,
    entryMode: 'client_required',
    approvalMode: 'auto',
    lockdownMode: true,
    networkLockdownMode: false,
    networkLockdownFailurePolicy: 'report_only',
    networkWhitelistHosts: 'judge.example',
    networkWhitelistIps: '10.0.0.8',
    networkWhitelistPorts: '443',
    pauseOnDisconnect: true,
    screenshotIntervalMs: 15000,
    exclusive: true,
    clientLoginBlockBeforeMinutes: 20,
    clientLoginBlockAfterMinutes: 10,
    liveEnabled: false,
    recordEnabled: true,
    cameraEnabled: false,
    screenshotJitterMs: 5000,
    vigilProcessWhitelist: 'Code.exe',
    participantScopeMode: 'groups',
    participantSchoolIds: [],
    participantGroupIds: ['group-open'],
    participationMode: 'individual',
  };
  if (options.scores) tdoc.score = options.scores;
  if (options.exam) tdoc.examShowVerdict = true;
  return {
    page_name: 'contest_edit',
    inviteCode: INVITE_CODE,
    duration: windowHours,
    beginAt: begin.toISOString(),
    participationRevision: 4,
    teamModeClearConfirmation: 'clear-token',
    scopeSchools: [{ _id: 'school-1', name: '一中' }],
    scopeGroups: [{ _id: 'group-open', name: '一班', schoolId: 'school-1' }],
    canAutoHideProblems: true,
    activeTeamCount: 0,
    recordCount: 3,
    canManageTeamBatches: false,
    canUpdatePlannedTeamBatch: false,
    teamBatches: [],
    tdoc,
  };
}

function acmDocument(title: string, patch: Partial<EditOptions> = {}): Record<string, unknown> {
  return editDocument({
    rule: 'acm',
    title,
    allowPostContestView: true,
    allowPostContestPractice: false,
    allowPostContestSubmit: false,
    allowViewCode: true,
    keepScoreboardHidden: true,
    exam: false,
    scores: null,
    ...patch,
  });
}

function examDocument(title: string): Record<string, unknown> {
  return editDocument({
    rule: 'exam',
    title,
    allowPostContestView: true,
    allowPostContestPractice: true,
    allowPostContestSubmit: false,
    allowViewCode: true,
    keepScoreboardHidden: true,
    exam: true,
    scores: { 8: 40, 9: 70 },
  });
}

function oiDocument(rule: 'ledo' | 'ioi', title: string): Record<string, unknown> {
  return editDocument({
    rule,
    title,
    allowPostContestView: true,
    allowPostContestPractice: true,
    allowPostContestSubmit: true,
    allowViewCode: false,
    keepScoreboardHidden: false,
    exam: false,
    scores: null,
  });
}

function paperProblem(docId: number, pid: string, title: string, score: number | null): TeachPaperProblem {
  return {
    docId,
    pid,
    title,
    kind: 'programming',
    score,
    hidden: false,
    mine: true,
    difficulty: null,
  };
}

function paperFor(scored: boolean): TeachPaper {
  return {
    problems: [
      paperProblem(8, 'P1008', '第一题', scored ? 40 : null),
      paperProblem(9, 'P1009', '第二题', scored ? 70 : null),
    ],
    stages: null,
    examPaperQuotas: null,
  };
}

function links(): TeachLinks {
  return {
    studentView: `/contest/${CONTEST_ID}`,
    scoreboard: `/contest/${CONTEST_ID}/scoreboard`,
    manage: `/contest/${CONTEST_ID}/management`,
    users: `/contest/${CONTEST_ID}/user`,
    clarification: `/contest/${CONTEST_ID}/clarification`,
    grading: null,
    teams: null,
    balloon: null,
    print: null,
    code: null,
    files: `/contest/${CONTEST_ID}/management`,
    redemption: null,
  };
}

function capabilities(): TeachCapabilities {
  return {
    canDelete: true,
    canShare: true,
    canGrade: false,
    canManageTeamBatches: false,
    isSystemAdmin: false,
    canPin: false,
  };
}

function stats(): TeachStats {
  return {
    participantCount: 12,
    startedCount: null,
    finalizedCount: null,
    submittedCount: 4,
    recordCount: 9,
    audienceCount: null,
    problemStats: null,
  };
}

function container(type: TeachType, rule: string, title: string): TeachContainerSummary {
  return {
    type,
    id: CONTEST_ID,
    rule,
    title,
    status: 'upcoming',
    beginAt: BEGIN.toISOString(),
    endAt: END.toISOString(),
    durationMinutes: null,
    penaltySince: null,
    lockAt: null,
    audience: { mode: 'groups', groupNames: ['一班'], schoolNames: [], boundStudentCount: 30 },
    owner: { uid: 4, name: '王老师' },
    maintainers: [{ uid: MAINTAINER_ID, name: '协作者' }],
    createdAt: '2026-01-02T00:00:00.000Z',
    schoolShared: null,
    copiedFrom: null,
    examPassScore: null,
    examAttemptLimit: null,
    participationMode: 'individual',
    vigilEnabled: true,
    entryMode: 'client_required',
    links: links(),
  };
}

function workbench(type: TeachType, rule: string, title: string, scored: boolean): TeachWorkbenchPayload {
  return {
    container: container(type, rule, title),
    paper: paperFor(scored),
    stats: stats(),
    capabilities: capabilities(),
  };
}

function pageBootstrap(): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: '2026-01-15T01:00:00.000Z',
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

function installFetch(type: TeachType, raw: Record<string, unknown>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const sharePath = `/teach/${type}/${CONTEST_ID}/share`;
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
    const url = requestUrl(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = await readRequestBody(init?.body);
    const call: RoutedCall = { method, url, body };
    calls.push({ method, pathname: url.pathname, body });
    if (call.method === 'GET' && url.pathname === EDIT_PATH) return jsonResponse(raw);
    if (call.method === 'POST' && url.pathname === EDIT_PATH) return jsonResponse({ saved: true });
    if (call.method === 'GET' && url.pathname === sharePath) return jsonResponse(shareState());
    if (call.method === 'POST' && url.pathname === '/d/system/api/users') {
      return jsonResponse(userIds(body).map((id) => ({ _id: id, uname: 'teacher', displayName: '协作者' })));
    }
    throw new Error(`unexpected ${method} ${url.pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function DirtyProbe() {
  const dirty = useWorkbenchDirty();
  return <p data-testid="settings-dirty">{[...dirty.dirtyTabs].sort().join(',')}</p>;
}

function renderSettings(
  Tab: ComponentType<SettingsTabProps>,
  type: TeachType,
  rule: string,
  title: string,
  raw: Record<string, unknown>,
  scored: boolean,
): RecordedCall[] {
  const calls = installFetch(type, raw);
  render(
    <BootstrapProvider bootstrap={pageBootstrap()}>
      <WorkbenchDirtyProvider>
        <LegacySnapshotProvider type={type} id={CONTEST_ID}>
          <DirtyProbe />
          <Tab payload={workbench(type, rule, title, scored)} onNavigateTab={() => undefined} />
        </LegacySnapshotProvider>
      </WorkbenchDirtyProvider>
    </BootstrapProvider>,
  );
  return calls;
}

function inputByLabel(name: string | RegExp): HTMLInputElement {
  const found = screen.getByLabelText(name);
  if (!(found instanceof HTMLInputElement)) throw new TypeError('expected an input');
  return found;
}

function switchByLabel(name: string): HTMLInputElement {
  const found = screen.getByRole('switch', { name });
  if (!(found instanceof HTMLInputElement)) throw new TypeError(`expected a switch named ${name}`);
  return found;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  fireEvent.change(input, { target: { value } });
}

function editPosts(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter((call) => call.method === 'POST' && call.pathname === EDIT_PATH);
}

function postedParams(calls: RecordedCall[]): URLSearchParams {
  const posts = editPosts(calls);
  expect(posts).toHaveLength(1);
  const posted = posts[0];
  if (!posted) throw new TypeError('missing contest edit post');
  return new URLSearchParams(posted.body);
}

function expectNoEditPost(calls: RecordedCall[]): void {
  expect(editPosts(calls)).toHaveLength(0);
}

function openWindowMinutes(raw: string | null): number {
  expect(typeof raw, 'duration').toBe('string');
  if (typeof raw !== 'string' || raw.trim() === '') throw new TypeError('missing duration');
  const hours = Number(raw);
  expect(Number.isFinite(hours), raw).toBe(true);
  return Math.round(hours * 60);
}

function expectPostedForm(calls: RecordedCall[], raw: Record<string, unknown>, patch: Partial<ContestFormState>): void {
  const posts = editPosts(calls);
  expect(posts).toHaveLength(1);
  const posted = posts[0];
  if (!posted) throw new TypeError('missing contest edit post');
  const actual = new URLSearchParams(posted.body);
  const expected = contestFormBody({ ...parseContestSnapshot(raw).state, ...patch });
  const keys = new Set<string>([...expected.keys(), ...actual.keys()]);
  for (const key of keys) {
    expect(actual.get(key), key).toBe(expected.get(key));
  }
}

function ruleTabNames(): string[] {
  return screen.getAllByRole('tab').map((tab) => tab.textContent?.trim() ?? '');
}

describe('contest and exam settings', () => {
  it('disables personal time while an acm lock is set and restores both directions', async () => {
    const title = '校赛';
    const raw = acmDocument(title);
    const parsed = parseContestSnapshot(raw);
    expect(parsed.state.lockMinutes).toBeNull();
    expect(parsed.state.personalHours).toBeNull();
    expect(parsed.state.windowHours).toBe(WINDOW_HOURS);
    const tab = await loadSettingsContest();
    renderSettings(tab.SettingsContestTab, 'acm', 'acm', title, raw, false);

    expect(await screen.findByRole('heading', { name: '基本信息' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '时间' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '赛后' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '结束以后' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '成绩与补考' })).toBeNull();
    expect(screen.queryByText('赛制')).toBeNull();
    expect(screen.getByText(TIME_DESCRIPTION)).toBeInTheDocument();
    expect(screen.getByText(CONTEST_OPEN_HINT)).toBeInTheDocument();
    expect(screen.getByText(LOCK_EMPTY_HINT)).toBeInTheDocument();
    const begin = localStamp(BEGIN);
    const end = localStamp(END);
    expect(inputByLabel('开始日期')).toHaveValue(begin.date);
    expect(inputByLabel('开始时间')).toHaveValue(begin.time);
    expect(inputByLabel('结束日期')).toHaveValue(end.date);
    expect(inputByLabel('结束时间')).toHaveValue(end.time);
    expect(inputByLabel('封榜')).toBeEnabled();
    expect(inputByLabel('封榜')).toHaveValue('');
    expect(inputByLabel(/个人限时/)).toBeEnabled();
    expect(screen.getByText(CONTEST_PERSONAL_HINT)).toBeInTheDocument();

    setInputValue(inputByLabel('封榜'), '60');
    await waitFor(() => expect(inputByLabel(/个人限时/)).toBeDisabled());
    expect(inputByLabel('封榜')).toBeEnabled();
    expect(inputByLabel('封榜')).toHaveValue('60');
    expect(screen.getByText(LOCK_BLOCKS_PERSONAL)).toBeInTheDocument();
    expect(screen.queryByText(CONTEST_PERSONAL_HINT)).toBeNull();

    setInputValue(inputByLabel('封榜'), '');
    await waitFor(() => expect(inputByLabel(/个人限时/)).toBeEnabled());
    expect(screen.queryByText(LOCK_BLOCKS_PERSONAL)).toBeNull();
    expect(screen.getByText(CONTEST_PERSONAL_HINT)).toBeInTheDocument();
    expect(screen.getByText(LOCK_EMPTY_HINT)).toBeInTheDocument();

    setInputValue(inputByLabel(/个人限时/), '90');
    await waitFor(() => expect(inputByLabel('封榜')).toBeDisabled());
    expect(screen.getByText(PERSONAL_BLOCKS_LOCK)).toBeInTheDocument();
    expect(screen.queryByText(LOCK_EMPTY_HINT)).toBeNull();
    expect(inputByLabel(/个人限时/)).toBeEnabled();

    setInputValue(inputByLabel(/个人限时/), '');
    await waitFor(() => expect(inputByLabel('封榜')).toBeEnabled());
    expect(screen.getByText(LOCK_EMPTY_HINT)).toBeInTheDocument();
    expect(screen.queryByText(PERSONAL_BLOCKS_LOCK)).toBeNull();
  });

  it('keeps a 100 minute open window when only the personal limit changes', async () => {
    const user = userEvent.setup();
    const title = '分钟窗口';
    const begin = new Date(2026, 0, 15, 14, 0, 0, 0);
    const windowHours = 100 / 60;
    const raw = acmDocument(title, { begin, windowHours });
    const parsed = parseContestSnapshot(raw);
    expect(parsed.state.beginTime).toBe('14:00');
    expect(parsed.state.windowHours).toBe(windowHours);
    expect(parsed.state.personalHours).toBeNull();
    const tab = await loadSettingsContest();
    const calls = renderSettings(tab.SettingsContestTab, 'acm', 'acm', title, raw, false);
    const stamp = localStamp(begin);

    expect(await screen.findByLabelText('开始时间')).toHaveValue('14:00');
    expect(inputByLabel('开始日期')).toHaveValue(stamp.date);
    expect(inputByLabel('结束日期')).toHaveValue(stamp.date);
    expect(inputByLabel('结束时间')).toHaveValue('15:40');

    setInputValue(inputByLabel(/个人限时/), '45');
    await user.click(await screen.findByRole('button', { name: '保存' }));
    await waitFor(() => expect(editPosts(calls)).toHaveLength(1));
    const posted = postedParams(calls);
    expect(openWindowMinutes(posted.get('duration'))).toBe(100);
    expect(posted.get('beginAtDate')).toBe(stamp.date);
    expect(posted.get('beginAtTime')).toBe('14:00');
    expect(openWindowMinutes(posted.get('contestDuration'))).toBe(45);
  });

  it('saves an exam pass score and attempt limit without dropping the rest of the snapshot', async () => {
    const user = userEvent.setup();
    const title = '期末整卷';
    const raw = examDocument(title);
    const parsed = parseContestSnapshot(raw);
    expect(parsed.state.examPassScore).toBeNull();
    expect(parsed.state.examAttemptLimit).toBeNull();
    expect(parsed.state.vigil.vigilEnabled).toBe(true);
    const tab = await loadSettingsContest();
    const calls = renderSettings(tab.SettingsContestTab, 'exam', 'exam', title, raw, true);

    expect(await screen.findByRole('heading', { name: '成绩与补考' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '结束以后' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '赛后' })).toBeNull();
    expect(screen.queryByLabelText('封榜')).toBeNull();
    expect(screen.queryByText('赛制')).toBeNull();
    expect(screen.queryByRole('switch', { name: PRACTICE_LABEL })).toBeNull();
    expect(screen.queryByRole('switch', { name: CODE_LABEL })).toBeNull();
    expect(screen.queryByRole('switch', { name: BOARD_LABEL })).toBeNull();
    expect(screen.getByText(EXAM_OPEN_HINT)).toBeInTheDocument();
    expect(switchByLabel(VERDICT_LABEL)).toBeChecked();
    expect(screen.getByText(VERDICT_DESCRIPTION)).toBeInTheDocument();
    expect(switchByLabel(VIEW_LABEL)).toBeChecked();
    expect(screen.getByText(VIEW_DESCRIPTION)).toBeInTheDocument();
    expect(screen.getByText(PASS_HINT)).toBeInTheDocument();
    expect(screen.getByText(ATTEMPT_HINT)).toBeInTheDocument();
    expect(screen.getByText(ATTEMPT_SUFFIX)).toBeInTheDocument();
    expect(screen.getByText(FULL_SCORE_TEXT, { exact: false })).toBeInTheDocument();
    const attempts = inputByLabel(ATTEMPT_LABEL);
    expect(attempts).toBeDisabled();
    expect(screen.getByText(ATTEMPT_LABEL)).toBeInTheDocument();

    setInputValue(inputByLabel(PASS_LABEL), '60');
    await waitFor(() => expect(inputByLabel(ATTEMPT_LABEL)).toBeEnabled());
    setInputValue(inputByLabel(ATTEMPT_LABEL), '2');
    await user.click(await screen.findByRole('button', { name: '保存' }));
    await waitFor(() => expect(editPosts(calls)).toHaveLength(1));

    const posted = postedParams(calls);
    expect(posted.get('examPassScore')).toBe('60');
    expect(posted.get('examAttemptLimit')).toBe('2');
    expect(posted.get('vigilEnabled')).toBe('true');
    expect(posted.get('code')).toBe(INVITE_CODE);
    expect(posted.get('title')).toBe(title);
    expect(posted.get('pids')).toBe('8,9');
    expect(posted.get('maintainer')).toBe(String(MAINTAINER_ID));
    expect(posted.get('networkWhitelistHosts')).toBe('judge.example');
    expectPostedForm(calls, raw, { examPassScore: 60, examAttemptLimit: 2 });
  });

  it('refuses a pass score above the known paper full score and does not post', async () => {
    const user = userEvent.setup();
    const raw = examDocument('期末整卷');
    const tab = await loadSettingsContest();
    const calls = renderSettings(tab.SettingsContestTab, 'exam', 'exam', '期末整卷', raw, true);

    expect(await screen.findByText(FULL_SCORE_TEXT, { exact: false })).toBeInTheDocument();
    setInputValue(inputByLabel(PASS_LABEL), '111');
    const attempts = inputByLabel(ATTEMPT_LABEL);
    if (!attempts.disabled) setInputValue(attempts, '2');
    await user.click(await screen.findByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert', { name: PASS_OVER_FULL })).toBeInTheDocument();
    expectNoEditPost(calls);
  });

  it('does not post when the open window is missing a start time', async () => {
    const user = userEvent.setup();
    const raw = acmDocument('校赛');
    const tab = await loadSettingsContest();
    const calls = renderSettings(tab.SettingsContestTab, 'acm', 'acm', '校赛', raw, false);

    const beginDate = await screen.findByLabelText('开始日期');
    expect(beginDate).toHaveValue(localStamp(BEGIN).date);
    fireEvent.change(beginDate, { target: { value: '' } });
    await user.click(await screen.findByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert', { name: BEGIN_MISSING })).toBeInTheDocument();
    expectNoEditPost(calls);
  });

  it('disables practice after closing view and posts both practice flags when practice is opened', async () => {
    const user = userEvent.setup();
    const raw = acmDocument('校赛');
    const parsed = parseContestSnapshot(raw);
    expect(parsed.state.allowPostContestView).toBe(true);
    expect(parsed.state.allowPostContestPractice).toBe(false);
    expect(parsed.state.allowPostContestSubmit).toBe(false);
    const tab = await loadSettingsContest();
    const calls = renderSettings(tab.SettingsContestTab, 'acm', 'acm', '校赛', raw, false);

    expect(await screen.findByRole('heading', { name: '赛后' })).toBeInTheDocument();
    await waitFor(() => expect(switchByLabel(VIEW_LABEL)).toBeChecked());
    expect(screen.getByText(VIEW_DESCRIPTION)).toBeInTheDocument();
    expect(switchByLabel(PRACTICE_LABEL)).toBeEnabled();
    expect(switchByLabel(PRACTICE_LABEL)).not.toBeChecked();
    expect(screen.getByText(PRACTICE_DESCRIPTION)).toBeInTheDocument();
    expect(screen.getByText(CODE_DESCRIPTION)).toBeInTheDocument();
    expect(screen.getByText(BOARD_DESCRIPTION)).toBeInTheDocument();

    await user.click(switchByLabel(VIEW_LABEL));
    await waitFor(() => expect(switchByLabel(PRACTICE_LABEL)).toBeDisabled());
    expect(switchByLabel(VIEW_LABEL)).not.toBeChecked();
    expect(screen.getByText(PRACTICE_LABEL)).toBeInTheDocument();
    expect(screen.getByText(PRACTICE_BLOCKED)).toBeInTheDocument();
    expect(screen.queryByText(PRACTICE_DESCRIPTION)).toBeNull();
    expect(switchByLabel(CODE_LABEL)).toBeEnabled();
    expect(switchByLabel(BOARD_LABEL)).toBeEnabled();

    await user.click(switchByLabel(VIEW_LABEL));
    await waitFor(() => expect(switchByLabel(PRACTICE_LABEL)).toBeEnabled());
    expect(switchByLabel(VIEW_LABEL)).toBeChecked();
    expect(screen.getByText(PRACTICE_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByText(PRACTICE_BLOCKED)).toBeNull();

    await user.click(switchByLabel(PRACTICE_LABEL));
    await waitFor(() => expect(switchByLabel(PRACTICE_LABEL)).toBeChecked());
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(editPosts(calls)).toHaveLength(1));

    const posted = postedParams(calls);
    expect(posted.get('allowPostContestPractice')).toBe('true');
    expect(posted.get('allowPostContestSubmit')).toBe('true');
    expect(posted.get('allowPostContestView')).toBe('true');
    expectPostedForm(calls, raw, {
      allowPostContestView: true,
      allowPostContestPractice: true,
      allowPostContestSubmit: true,
    });
  });

  it('shows one unsaved change after the title changes and restores it on discard', async () => {
    const user = userEvent.setup();
    const title = '数据结构校赛';
    const nextTitle = '数据结构校赛修订';
    const raw = acmDocument(title);
    const tab = await loadSettingsContest();
    const calls = renderSettings(tab.SettingsContestTab, 'acm', 'acm', title, raw, false);

    expect(await screen.findByLabelText('标题')).toHaveValue(title);
    expect(screen.getByText(MARKDOWN_HINT)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '放弃' })).toBeNull();
    expect(screen.getByTestId('settings-dirty').textContent).toBe('');

    setInputValue(inputByLabel('标题'), nextTitle);
    expect(await screen.findByText(UNSAVED_ONE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '放弃' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('settings-dirty').textContent).toBe('settings'));

    await user.click(screen.getByRole('button', { name: '放弃' }));
    await waitFor(() => {
      expect(inputByLabel('标题')).toHaveValue(title);
      expect(screen.queryByText(UNSAVED_ONE)).toBeNull();
      expect(screen.queryByRole('button', { name: '放弃' })).toBeNull();
      expect(screen.getByTestId('settings-dirty').textContent).toBe('');
    });
    expectNoEditPost(calls);
  });

  it('adds a ledo rule segment only when the document rule is ledo', async () => {
    const ledoTitle = 'Ledo 模拟';
    const ledoRaw = oiDocument('ledo', ledoTitle);
    expect(parseContestSnapshot(ledoRaw).state.rule).toBe('ledo');
    const tab = await loadSettingsContest();
    renderSettings(tab.SettingsContestTab, 'oi', 'ledo', ledoTitle, ledoRaw, false);

    expect(await screen.findByRole('tab', { name: 'Ledo' })).toBeInTheDocument();
    expect(screen.getByText('赛制')).toBeInTheDocument();
    expect(ruleTabNames()).toEqual(['OI', 'IOI', '严格 IOI', 'Ledo']);
    expect(screen.getByRole('tab', { name: 'Ledo' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: '赛后' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '成绩与补考' })).toBeNull();
    expect(inputByLabel('封榜')).toBeInTheDocument();
    expect(screen.getByText(CONTEST_OPEN_HINT)).toBeInTheDocument();

    cleanup();
    const ioiTitle = 'IOI 模拟';
    const ioiRaw = oiDocument('ioi', ioiTitle);
    expect(parseContestSnapshot(ioiRaw).state.rule).toBe('ioi');
    renderSettings(tab.SettingsContestTab, 'oi', 'ioi', ioiTitle, ioiRaw, false);

    expect(await screen.findByRole('tab', { name: 'IOI' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Ledo' })).toBeNull();
    expect(ruleTabNames()).toEqual(['OI', 'IOI', '严格 IOI']);
  });
});
