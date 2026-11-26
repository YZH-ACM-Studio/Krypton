// A static import fails collection while src/pages/set-workspace/overview.tsx is absent.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { formatMoment } from '../../src/pages/problem-sets/model';
import type {
  SetWorkspace,
  WsAction,
  WsGroup,
  WsPaper,
  WsTotals,
  WsUrls,
  WsWindow,
} from '../../src/pages/set-workspace/model';

const transport = vi.hoisted(() => ({
  postForm: vi.fn<(path: string, body: URLSearchParams, fallback: string) => Promise<Record<string, unknown>>>(),
  postJson: vi.fn<(path: string, body: Record<string, unknown>, fallback: string) => Promise<Record<string, unknown>>>(),
}));

vi.mock('@/pages/teach/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pages/teach/api')>();
  return { ...actual, postForm: transport.postForm, postJson: transport.postJson };
});

const overviewLoaders = import.meta.glob('../../src/pages/set-workspace/overview.tsx');
const OVERVIEW_SOURCE = 'src/pages/set-workspace/overview.tsx';

const MINUTE_MS = 60_000;
const NOW_ISO = '2026-10-18T06:00:00.000Z';
const NOW = Date.parse(NOW_ISO);
const TID = '64b8000000000000000000a1';
const HOMEWORK_OVERVIEW = `/homework/${TID}`;
const PAPER_OVERVIEW = `/paper/${TID}`;
const CONTEST_OVERVIEW = `/contest/${TID}`;
const PAPER_START = `/paper/${TID}/start`;
const HOMEWORK_ATTEND = `/homework/${TID}`;
const CONTEST_ATTEND = `/contest/${TID}`;
const PRACTICE_URL = `${CONTEST_OVERVIEW}?section=problems`;
const VIRTUAL_URL = `/contest/${TID}/virtual`;
const PROBLEMS_HREF = `${HOMEWORK_OVERVIEW}?section=problems`;
// 40 minutes plus 20 seconds so a ticking exam clock still floors to 「40 分钟」.
const SHORT_END_ISO = new Date(NOW + 40 * MINUTE_MS + 20_000).toISOString();
const PAPER_END_ISO = new Date(NOW + 5 * 60 * MINUTE_MS).toISOString();
const SHORT_END_LABEL = formatMoment(SHORT_END_ISO, NOW);
const PAPER_END_LABEL = formatMoment(PAPER_END_ISO, NOW);
const SHORT_NOTE = `现在开始只剩 40 分钟：${SHORT_END_LABEL} 统一截止，个人限时 45 分钟用不完。`;
const SHORT_DIALOG = `现在开始只剩 40 分钟，${SHORT_END_LABEL} 统一截止。`;
const START_DIALOG = `开始后计时 120 分钟，中途不能暂停；${PAPER_END_LABEL} 统一截止。`;
const RETAKE_DIALOG = '会清空上一轮的答卷，重新抽题并计时 90 分钟。已用 1/2 次。';
const CLIENT_TITLE = '请在机房客户端进入';
const CLIENT_NOTE = '这场考试只能用机房电脑上的 Krypton 客户端参加。在浏览器里只能查看说明和公告。';
const ATTEND_FALLBACK = '开始做作业失败。';
const STAR_LABEL = '以打星身份参赛（不计入排名）';
// Same instants as the acceptance example: due 2026-10-20T23:59+08, now 2026-10-18T14:00+08.
const DUE_ISO = '2026-10-20T23:59:00+08:00';
const LATE_END_ISO = '2026-10-22T23:59:00+08:00';
const BETWEEN_DUE_ISO = '2026-10-21T06:00:00.000Z';
const BEFORE_DUE = '还有 2 天 9 小时';
const AFTER_DUE = '已过截止，迟交会扣分';

type PointerUser = ReturnType<typeof userEvent.setup>;

interface WorkspaceOverviewProps {
  ws: SetWorkspace;
}

interface OpenedDialog {
  dialog: HTMLElement;
  done: Promise<void>;
}

let restoreLocation: () => void = () => undefined;

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asComponent<Props>(value: unknown, key: string): ComponentType<Props> {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as ComponentType<Props>;
}

async function loadOverview(): Promise<ComponentType<WorkspaceOverviewProps>> {
  let load: unknown;
  for (const [key, candidate] of Object.entries(overviewLoaders)) {
    if (key.endsWith(OVERVIEW_SOURCE)) load = candidate;
  }
  expect(typeof load, `${OVERVIEW_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${OVERVIEW_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${OVERVIEW_SOURCE} must be a module`);
  return asComponent<WorkspaceOverviewProps>(readField(imported, 'WorkspaceOverview'), 'WorkspaceOverview');
}

let loading: Promise<ComponentType<WorkspaceOverviewProps>> | undefined;

function overviewComponent(): Promise<ComponentType<WorkspaceOverviewProps>> {
  loading ??= loadOverview();
  return loading;
}

function windowOf(overrides: Partial<WsWindow> = {}): WsWindow {
  return {
    beginAt: '2026-10-16T08:00:00+08:00',
    endAt: '2026-10-22T23:59:00+08:00',
    dueAt: '2026-10-20T23:59:00+08:00',
    durationMinutes: null,
    startAt: null,
    personalEndAt: null,
    lockAt: null,
    ...overrides,
  };
}

function actionOf(overrides: Partial<WsAction> = {}): WsAction {
  return {
    canStart: false,
    canFinalize: false,
    canAttend: false,
    canUnrank: false,
    canSubmit: true,
    attended: true,
    canRetake: false,
    ...overrides,
  };
}

function totalsOf(overrides: Partial<WsTotals> = {}): WsTotals {
  return {
    problemCount: 1,
    maxScore: 5,
    answered: 0,
    score: 0,
    accepted: null,
    showScore: true,
    ...overrides,
  };
}

function urlsOf(overview: string, overrides: Partial<WsUrls> = {}): WsUrls {
  return {
    back: '/training',
    manage: null,
    overview,
    problem: null,
    submit: null,
    submitCode: null,
    recordDetail: `/record/__RID__?tid=${TID}`,
    records: `/record?tid=${TID}&uidOrName=62`,
    ranking: null,
    clarify: null,
    print: null,
    start: null,
    attend: null,
    draftList: null,
    draftUpsert: null,
    submitKind: null,
    lockKind: null,
    finalize: null,
    virtual: null,
    practice: null,
    teamProblem: null,
    pretest: null,
    ...overrides,
  };
}

function paperFacts(overrides: Partial<WsPaper> = {}): WsPaper {
  return {
    score: 86,
    passed: true,
    judging: false,
    passScore: 60,
    attemptLimit: 2,
    attemptsUsed: 1,
    canRetake: false,
    submitByKind: false,
    lockedKinds: [],
    ...overrides,
  };
}

function singleGroup(): WsGroup {
  return {
    kind: 'single',
    no: 2,
    name: '单选题',
    scoreEach: 5,
    items: [{
      pid: 1001,
      label: '2-1',
      title: '题 1',
      kind: 'single',
      score: 5,
      state: 'empty',
      submits: 0,
      lastScore: null,
    }],
  };
}

function letterGroup(): WsGroup {
  return {
    kind: 'programming',
    no: null,
    name: '题目',
    scoreEach: null,
    items: [{
      pid: 1001,
      label: 'A',
      title: 'A+B',
      kind: 'programming',
      score: 100,
      state: 'empty',
      submits: 0,
      lastScore: null,
    }],
  };
}

function workspace(overrides: Partial<SetWorkspace> = {}): SetWorkspace {
  return {
    kind: 'homework',
    flavor: 'homework',
    tid: TID,
    title: '第一次作业',
    description: '',
    mode: 'browser',
    phase: 'ready',
    locked: null,
    numbering: 'pta',
    window: windowOf(),
    groups: [singleGroup()],
    totals: totalsOf(),
    verdictVisible: true,
    team: null,
    paper: null,
    announcements: [],
    clarifications: [],
    info: [{ label: '时长', text: '2 小时' }],
    student: { name: '学生', studentId: '2026001' },
    action: actionOf(),
    urls: urlsOf(HOMEWORK_OVERVIEW),
    ...overrides,
    objectiveVerdictVisible: overrides.objectiveVerdictVisible ?? true,
  };
}

function bootstrap(generatedAt: string = NOW_ISO): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt,
    user: {
      id: 7,
      name: 'student',
      mail: '',
      signedIn: true,
      theme: 'light',
      viewLang: 'zh_CN',
      unreadMessages: 0,
      rp: 0,
      bio: '',
      priv: 0,
      role: 'student',
      tfa: false,
      authn: false,
      pinnedDomains: [],
      canBrowseProblemBank: false,
    },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'set_workspace.html', data: {} },
  };
}

function installLocation(): () => void {
  const assign = vi.fn();
  const saved = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...saved, assign, reload: vi.fn() },
  });
  return () => {
    Object.defineProperty(window, 'location', { configurable: true, value: saved });
  };
}

function locationAssign(): ReturnType<typeof vi.fn> {
  const assign: unknown = Reflect.get(window.location, 'assign');
  if (typeof assign !== 'function' || !('mock' in assign)) throw new TypeError('location.assign is not a mock');
  return assign as ReturnType<typeof vi.fn>;
}

function controlByName(name: string): HTMLElement {
  const found = screen.queryByRole('button', { name }) ?? screen.queryByRole('link', { name });
  if (!(found instanceof HTMLElement)) throw new TypeError(`missing control ${name}`);
  return found;
}

function dialogConfirm(dialog: HTMLElement): HTMLElement {
  const primary = within(dialog).getAllByRole('button').filter((button) => button.getAttribute('data-variant') === 'primary');
  if (primary.length !== 1) throw new TypeError('dialog should have one primary button');
  const confirm = primary[0];
  if (!confirm) throw new TypeError('dialog is missing a confirm button');
  return confirm;
}

function postCall(): [string, URLSearchParams, string] {
  const call = transport.postForm.mock.calls[0];
  if (!call) throw new TypeError('postForm was not called');
  const [path, body, fallback] = call;
  if (!(body instanceof URLSearchParams)) throw new TypeError('postForm body must be URLSearchParams');
  return [path, body, fallback];
}

function deferredRecord(): { promise: Promise<Record<string, unknown>>; finish: (value: Record<string, unknown>) => void } {
  let finish: (value: Record<string, unknown>) => void = () => {
    throw new TypeError('attend request finished before it was opened');
  };
  const promise = new Promise<Record<string, unknown>>((done) => {
    finish = done;
  });
  return { promise, finish };
}

function problemPanel(): HTMLElement {
  const heading = screen.getByRole('heading', { name: '题目' });
  const panel = heading.closest('[data-slot="panel"]');
  if (!(panel instanceof HTMLElement)) throw new TypeError('题目 panel is missing');
  return panel;
}

function submittedPaper(canRetake: boolean): SetWorkspace {
  return workspace({
    kind: 'paper',
    flavor: 'paper',
    title: '期中考试',
    phase: 'submitted',
    window: windowOf({
      durationMinutes: 90,
      endAt: PAPER_END_ISO,
      dueAt: null,
    }),
    action: actionOf({ canRetake, canSubmit: false }),
    paper: paperFacts({
      canRetake,
      attemptsUsed: 1,
      attemptLimit: 2,
    }),
    urls: urlsOf(PAPER_OVERVIEW, { start: PAPER_START }),
  });
}

function unattendedHomework(): SetWorkspace {
  return workspace({
    phase: 'ready',
    locked: { reason: 'need_attend' },
    window: windowOf({
      dueAt: DUE_ISO,
      endAt: LATE_END_ISO,
      durationMinutes: null,
    }),
    action: actionOf({
      canAttend: true,
      attended: false,
      canSubmit: false,
    }),
    urls: urlsOf(HOMEWORK_OVERVIEW, { attend: HOMEWORK_ATTEND }),
  });
}

function leafText(startsWith: string): string {
  const node = screen.getByText((content, element) => {
    if (!(element instanceof HTMLElement) || element.childElementCount > 0) return false;
    return content.startsWith(startsWith);
  });
  return node.textContent ?? '';
}

function rowHref(label: string): string {
  const host = [...problemPanel().querySelectorAll('tr')].find((row) => (row.textContent ?? '').includes(label));
  if (!(host instanceof HTMLTableRowElement)) throw new TypeError(`missing row ${label}`);
  const anchor = host.querySelector('a');
  if (!(anchor instanceof HTMLAnchorElement)) throw new TypeError(`row ${label} is not a link`);
  const href = anchor.getAttribute('href');
  if (href === null || href === '') throw new TypeError(`row ${label} has no href`);
  return href;
}

async function renderOverview(ws: SetWorkspace, generatedAt: string = NOW_ISO): Promise<PointerUser> {
  const View = await overviewComponent();
  const user = userEvent.setup();
  render(
    <BootstrapProvider bootstrap={bootstrap(generatedAt)}>
      <View ws={ws} />
    </BootstrapProvider>,
  );
  return user;
}

async function openDialog(user: PointerUser, name: string): Promise<OpenedDialog> {
  const done = user.click(screen.getByRole('button', { name }));
  try {
    const dialog = await screen.findByRole('dialog');
    return { dialog, done };
  } catch (error) {
    await done;
    throw error;
  }
}

beforeEach(() => {
  transport.postForm.mockReset();
  transport.postForm.mockResolvedValue({});
  transport.postJson.mockReset();
  transport.postJson.mockResolvedValue({});
  restoreLocation = installLocation();
});

afterEach(() => {
  restoreLocation();
});

describe('workspace overview', () => {
  it.each([true, false])('shows a configured public group score when total visibility is %s', async (showScore) => {
    const group = singleGroup();
    group.items[0] = { ...group.items[0]!, state: 'submitted', lastScore: 3, feedback: { score: true, verdict: false, details: false } };
    await renderOverview(workspace({
      codePolicy: 'highest',
      officialRound: { id: 'round-1', roundNo: 1, startedAt: NOW_ISO, closedAt: null },
      phase: 'answering', objectiveVerdictVisible: false, groups: [group],
      totals: totalsOf({ showScore, score: showScore ? 3 : null }),
    }));
    const row = within(problemPanel()).getByRole('row', { name: /单选题/ });
    expect(within(row).getAllByRole('cell').at(-1)).toHaveTextContent('3');
    expect(row).not.toHaveTextContent('待评测');
  });

  it.each(['homework', 'paper', 'contest'] as const)('shows accepted counts for configured ACM %s after hand-in and deadline', async (kind) => {
    const group = singleGroup();
    group.items = group.items.map((item) => ({ ...item, state: 'correct', lastScore: 100, feedback: { score: true, verdict: true, details: true } }));
    for (const phase of ['submitted', 'ended'] as const) {
      await renderOverview(workspace({
        kind, flavor: kind === 'contest' ? 'acm' : kind, codePolicy: 'acm', phase,
        officialRound: { id: 'round-1', roundNo: 1, startedAt: NOW_ISO, closedAt: NOW_ISO },
        groups: [group], totals: totalsOf({ score: 200, maxScore: null, accepted: 2, problemCount: 3 }),
      }));
      expect(screen.getByText('通过 2/3')).toBeVisible();
      expect(screen.queryByText('200 分')).not.toBeInTheDocument();
      expect(screen.queryByText('200 / —')).not.toBeInTheDocument();
      expect(within(problemPanel()).queryByRole('columnheader', { name: '分值' })).not.toBeInTheDocument();
      expect(within(problemPanel()).queryByRole('columnheader', { name: '得分' })).not.toBeInTheDocument();
      expect(within(problemPanel()).getByRole('columnheader', { name: '通过' })).toBeVisible();
      cleanup();
    }
  });

  it('starts another configured round without legacy paper facts', async () => {
    const start = `/paper/${TID}/round/start`;
    const user = await renderOverview(workspace({
      phase: 'submitted',
      codePolicy: 'highest',
      officialRound: { id: 'round-1', roundNo: 1, startedAt: NOW_ISO, closedAt: NOW_ISO },
      action: actionOf({ canRetake: true, canSubmit: false }),
      paper: null,
      urls: urlsOf(HOMEWORK_OVERVIEW, { start }),
    }));
    const { dialog, done } = await openDialog(user, '重新作答');
    expect(within(dialog).getByText('将开始第 2 轮作答，上一轮答案和成绩会保留。')).toBeInTheDocument();
    await user.click(dialogConfirm(dialog));
    await done;
    expect(transport.postJson).toHaveBeenCalledWith(start, {}, expect.any(String));
    expect(transport.postForm).not.toHaveBeenCalled();
  });

  it('exchanges an invitation before offering configured round start and surfaces a rejected code', async () => {
    transport.postForm.mockRejectedValueOnce(new Error('邀请码不正确'));
    const user = await renderOverview(workspace({
      codePolicy: 'highest',
      officialRound: null,
      action: actionOf({ canStart: false, canAttend: true, invitationRequired: true, attended: false }),
      urls: urlsOf(HOMEWORK_OVERVIEW, { attend: CONTEST_ATTEND }),
    }));
    expect(screen.queryByRole('button', { name: '开始作答' })).toBeNull();
    await user.type(screen.getByRole('textbox', { name: '邀请码' }), 'class-42');
    await user.click(screen.getByRole('button', { name: '确认邀请码' }));
    expect(await screen.findByText('邀请码不正确')).toBeInTheDocument();
    expect(postCall()[0]).toBe(CONTEST_ATTEND);
    expect(postCall()[1].get('operation')).toBe('attend');
    expect(postCall()[1].get('code')).toBe('class-42');
    await user.click(screen.getByRole('button', { name: '确认邀请码' }));
    await waitFor(() => expect(locationAssign()).toHaveBeenCalledWith(HOMEWORK_OVERVIEW));
  });

  it('asks before starting a ready paper and posts the start url after confirm', async () => {
    const user = await renderOverview(workspace({
      kind: 'paper',
      flavor: 'paper',
      title: '期中考试',
      phase: 'ready',
      window: windowOf({ durationMinutes: 120, endAt: PAPER_END_ISO, dueAt: null }),
      action: actionOf({ canStart: true, attended: false, canSubmit: false }),
      paper: paperFacts(),
      urls: urlsOf(PAPER_OVERVIEW, { start: PAPER_START }),
    }));

    const start = screen.getByRole('button', { name: '开始作答' });
    expect(start).toBeEnabled();
    const { dialog, done } = await openDialog(user, '开始作答');
    expect(within(dialog).getByRole('heading', { name: '开始作答？' })).toBeInTheDocument();
    expect(within(dialog).getByText(START_DIALOG)).toBeInTheDocument();
    expect(transport.postForm).not.toHaveBeenCalled();

    await user.click(dialogConfirm(dialog));
    await done;
    await waitFor(() => {
      expect(transport.postForm).toHaveBeenCalledTimes(1);
    });
    expect(postCall()[0]).toBe(PAPER_START);
  });

  it('warns that a timed homework cannot use the full limit when forty minutes remain', async () => {
    const user = await renderOverview(workspace({
      phase: 'ready',
      window: windowOf({
        durationMinutes: 45,
        endAt: SHORT_END_ISO,
        dueAt: null,
      }),
      action: actionOf({ canStart: true, attended: false, canSubmit: false }),
      urls: urlsOf(HOMEWORK_OVERVIEW, { start: HOMEWORK_OVERVIEW }),
    }));

    const note = screen.getByText(SHORT_NOTE);
    expect(note).toHaveClass('text-warning-fg', 'font-medium');
    const { dialog, done } = await openDialog(user, '开始作答');
    expect(within(dialog).getByRole('heading', { name: '开始作答？' })).toBeInTheDocument();
    expect(within(dialog).getByText(SHORT_DIALOG)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    await done;
    expect(transport.postForm).not.toHaveBeenCalled();
  });

  it('submits ordinary enrollment without a personal starring control', async () => {
    await renderOverview(workspace({
      kind: 'contest',
      flavor: 'acm',
      title: '周赛',
      phase: 'ready',
      numbering: 'letter',
      locked: { reason: 'need_attend' },
      groups: [letterGroup()],
      totals: totalsOf({ maxScore: null, score: null, accepted: 0 }),
      action: actionOf({
        canAttend: true,
        canUnrank: true,
        attended: false,
        canSubmit: false,
      }),
      urls: urlsOf(CONTEST_OVERVIEW, { attend: CONTEST_ATTEND }),
    }));

    const signup = screen.getByRole('button', { name: '报名' });
    expect(screen.queryByRole('checkbox', { name: STAR_LABEL })).toBeNull();
    expect(signup).toHaveAttribute('data-variant', 'primary');
    const form = signup.closest('form');
    if (!(form instanceof HTMLFormElement)) throw new TypeError('报名 is not in a form');
    expect(form.getAttribute('method')?.toLowerCase()).toBe('post');
    expect(form.getAttribute('action')).toBe(CONTEST_ATTEND);
    expect(new FormData(form).has('unrank')).toBe(false);
    const operation = form.querySelector('input[name="operation"]');
    if (!(operation instanceof HTMLInputElement)) throw new TypeError('signup form is missing operation');
    expect(operation.value).toBe('attend');
  });

  it('shows the client-only notice without a button', async () => {
    await renderOverview(workspace({
      kind: 'contest',
      flavor: 'acm',
      title: '机房赛',
      phase: 'answering',
      numbering: 'letter',
      locked: { reason: 'client_only' },
      groups: [letterGroup()],
      totals: totalsOf({ maxScore: null, score: null, accepted: 1 }),
      window: windowOf({ personalEndAt: new Date(NOW + 30 * MINUTE_MS).toISOString() }),
      action: actionOf({ attended: true, canSubmit: true }),
      urls: urlsOf(CONTEST_OVERVIEW),
    }));

    expect(screen.getByText(CLIENT_TITLE)).toBeInTheDocument();
    expect(screen.getByText(CLIENT_NOTE)).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.querySelector('[data-slot="button"]')).toBeNull();
  });

  it('uses a secondary action while a paper is being answered', async () => {
    await renderOverview(workspace({
      kind: 'paper',
      flavor: 'paper',
      title: '期中考试',
      phase: 'answering',
      window: windowOf({
        durationMinutes: 120,
        startAt: new Date(NOW - 10 * MINUTE_MS).toISOString(),
        personalEndAt: new Date(NOW + 30 * MINUTE_MS).toISOString(),
      }),
      action: actionOf({ canFinalize: true, canSubmit: true }),
      paper: paperFacts(),
      urls: urlsOf(PAPER_OVERVIEW, { start: PAPER_START, finalize: `/paper/${TID}/finalize` }),
    }));

    expect(controlByName('继续作答')).toHaveAttribute('data-variant', 'secondary');
    expect(document.querySelectorAll('[data-slot="button"][data-variant="primary"]')).toHaveLength(0);
  });

  it('posts the start url after confirming another paper attempt', async () => {
    const user = await renderOverview(workspace({
      kind: 'paper',
      flavor: 'paper',
      title: '期中考试',
      phase: 'ended',
      window: windowOf({ durationMinutes: 90 }),
      action: actionOf({ canRetake: true, canSubmit: false }),
      paper: paperFacts({ canRetake: true, attemptsUsed: 1, attemptLimit: 2 }),
      urls: urlsOf(PAPER_OVERVIEW, { start: PAPER_START }),
    }));

    expect(controlByName('再考一次')).toHaveAttribute('data-variant', 'primary');
    expect(controlByName('查看答卷')).toHaveAttribute('data-variant', 'secondary');
    const { dialog, done } = await openDialog(user, '再考一次');
    expect(within(dialog).getByRole('heading', { name: '再考一次？' })).toBeInTheDocument();
    expect(within(dialog).getByText(RETAKE_DIALOG)).toBeInTheDocument();
    expect(transport.postForm).not.toHaveBeenCalled();

    await user.click(dialogConfirm(dialog));
    await done;
    await waitFor(() => {
      expect(transport.postForm).toHaveBeenCalledTimes(1);
    });
    expect(postCall()[0]).toBe(PAPER_START);
  });

  it('offers a retake while a submitted paper is still inside the window', async () => {
    await renderOverview(submittedPaper(false));
    expect(screen.queryByRole('button', { name: '再考一次' })).toBeNull();
    expect(screen.queryByRole('link', { name: '再考一次' })).toBeNull();

    cleanup();
    const user = await renderOverview(submittedPaper(true));
    expect(controlByName('再考一次')).toHaveAttribute('data-variant', 'primary');
    expect(controlByName('查看我的答卷')).toHaveAttribute('data-variant', 'secondary');
    const { dialog, done } = await openDialog(user, '再考一次');
    expect(within(dialog).getByRole('heading', { name: '再考一次？' })).toBeInTheDocument();
    expect(within(dialog).getByText(RETAKE_DIALOG)).toBeInTheDocument();
    expect(transport.postForm).not.toHaveBeenCalled();

    await user.click(dialogConfirm(dialog));
    await done;
    await waitFor(() => {
      expect(transport.postForm).toHaveBeenCalledTimes(1);
    });
    expect(postCall()[0]).toBe(PAPER_START);
  });

  it('keeps a single primary when practice and virtual are both offered', async () => {
    await renderOverview(workspace({
      kind: 'contest',
      flavor: 'acm',
      title: '周赛',
      phase: 'ended',
      numbering: 'letter',
      groups: [letterGroup()],
      totals: totalsOf({ maxScore: null, score: null, accepted: 2 }),
      action: actionOf({ attended: true, canSubmit: false }),
      urls: urlsOf(CONTEST_OVERVIEW, { practice: PRACTICE_URL, virtual: VIRTUAL_URL }),
    }));

    const practice = controlByName('赛后补题');
    const virtual = controlByName('虚拟参赛');
    expect(practice).toHaveAttribute('data-variant', 'primary');
    expect(virtual).toHaveAttribute('data-variant', 'secondary');
    expect(virtual).toHaveAttribute('href', VIRTUAL_URL);
    expect(document.querySelectorAll('[data-slot="button"][data-variant="primary"]')).toHaveLength(1);
  });

  it('starts an untimed homework and opens the problem list after attend', async () => {
    const pending = deferredRecord();
    transport.postForm.mockImplementation(() => pending.promise);
    const user = await renderOverview(workspace({
      phase: 'ready',
      locked: { reason: 'need_attend' },
      window: windowOf({ durationMinutes: null }),
      action: actionOf({
        canAttend: true,
        attended: false,
        canSubmit: false,
      }),
      urls: urlsOf(HOMEWORK_OVERVIEW, { attend: HOMEWORK_ATTEND }),
    }));

    const start = screen.getByRole('button', { name: '开始做作业' });
    expect(start).toHaveAttribute('data-variant', 'primary');
    await user.click(start);
    await waitFor(() => {
      expect(transport.postForm).toHaveBeenCalledTimes(1);
    });
    expect(locationAssign()).not.toHaveBeenCalled();
    const [path, body, fallback] = postCall();
    expect(path).toBe(HOMEWORK_ATTEND);
    expect(body.get('operation')).toBe('attend');
    expect(fallback).toBe(ATTEND_FALLBACK);
    await act(async () => {
      pending.finish({});
    });
    await waitFor(() => {
      expect(locationAssign()).toHaveBeenCalledWith(PROBLEMS_HREF);
    });
  });

  it('states only the time left before an unattended homework is due', async () => {
    await renderOverview(unattendedHomework());

    expect(leafText('还有')).toBe(BEFORE_DUE);
    expect(document.body.textContent ?? '').not.toContain('截止后可迟交');
  });

  it('states that a late unattended homework loses points after the due time', async () => {
    await renderOverview(unattendedHomework(), BETWEEN_DUE_ISO);

    expect(leafText('已过截止')).toBe(AFTER_DUE);
  });

  it('links an unanswered programming problem by q and a single group by kind', async () => {
    const openPid = 3007;
    await renderOverview(workspace({
      phase: 'ended',
      groups: [
        singleGroup(),
        {
          kind: 'programming',
          no: 7,
          name: '编程题',
          scoreEach: 25,
          items: [
            {
              pid: 3001,
              label: '7-1',
              title: '已提交',
              kind: 'programming',
              score: 25,
              state: 'submitted',
              submits: 1,
              lastScore: 25,
            },
            {
              pid: openPid,
              label: '7-2',
              title: '未作答',
              kind: 'programming',
              score: 25,
              state: 'empty',
              submits: 0,
              lastScore: null,
            },
          ],
        },
      ],
      totals: totalsOf({ problemCount: 3, maxScore: 55, score: 25, answered: 1 }),
    }));

    expect(rowHref('单选题')).toContain('kind=single');
    const programHref = rowHref('编程题');
    expect(programHref).toContain(`q=${openPid}`);
    expect(programHref).not.toContain('kind=programming');
  });
});
