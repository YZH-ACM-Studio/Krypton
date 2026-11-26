// A static import fails collection while src/pages/set-workspace/shell.tsx is absent.
import type { ComponentType, ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import {
  railItems,
  sectionHref,
  timerView,
  type SectionName,
  type SetWorkspace,
  type WsUrls,
} from '../../src/pages/set-workspace/model.ts';

const shellLoaders = import.meta.glob('../../src/pages/set-workspace/shell.tsx');
const SHELL_SOURCE = 'src/pages/set-workspace/shell.tsx';

const TID = '64b8000000000000000000a1';
const SERVER_ISO = '2026-10-18T06:00:00.000Z';
const SERVER = Date.parse(SERVER_ISO);
const BACK_HREF = '/problem-sets';
const LATEST_NOTICE = '2026-10-18T14:40:00.000Z';
const OLDER_NOTICE = '2026-10-18T14:00:00.000Z';

const ROOT_CLASS = ['flex', 'h-dvh', 'flex-col', 'bg-bg'] as const;
const BODY_CLASS = ['flex', 'min-h-0', 'flex-1'] as const;
const RAIL_CLASS = ['w-16', 'shrink-0', 'border-r', 'border-line', 'bg-surface'] as const;
const MAIN_CLASS = ['min-w-0', 'flex-1', 'flex', 'flex-col', 'min-h-0'] as const;
const CURRENT_CLASS = ['bg-brand-soft', 'text-brand-fg', 'font-semibold'] as const;
const TIMER_VALUE_CLASS = ['font-mono', 'text-lg', 'font-semibold', 'tabular'] as const;
const BANNER_CLASS = ['bg-warning-soft', 'border-b', 'border-warning-line'] as const;
const SAFE_AREA_CLASS = 'pb-[env(safe-area-inset-bottom)]';
const LG_SHOW = ['lg:flex', 'lg:inline-flex', 'lg:block', 'lg:grid'] as const;
const MAX_LG_SHOW = ['max-lg:flex', 'max-lg:inline-flex', 'max-lg:block', 'max-lg:grid'] as const;

const ICON_CLASS: Record<string, string> = {
  Gauge: 'lucide-gauge',
  PenLine: 'lucide-pen-line',
  Rows3: 'lucide-rows-3',
  ChartColumn: 'lucide-chart-column',
  Bell: 'lucide-bell',
  MessageSquare: 'lucide-message-square',
  Printer: 'lucide-printer',
};

interface ShellProps {
  ws: SetWorkspace;
  section: SectionName;
  column: ReactNode;
  onFinalize: () => void;
  children: ReactNode;
}

type ShellComponent = ComponentType<ShellProps>;

interface WorkspacePatch {
  kind?: SetWorkspace['kind'];
  flavor?: SetWorkspace['flavor'];
  title?: string;
  mode?: SetWorkspace['mode'];
  phase?: SetWorkspace['phase'];
  numbering?: SetWorkspace['numbering'];
  paper?: SetWorkspace['paper'];
  announcements?: SetWorkspace['announcements'];
  clarifications?: SetWorkspace['clarifications'];
  student?: Partial<SetWorkspace['student']>;
  action?: Partial<SetWorkspace['action']>;
  window?: Partial<SetWorkspace['window']>;
  urls?: Partial<WsUrls>;
}

interface MountOptions {
  section?: SectionName;
  generatedAt?: string;
  onFinalize?: () => void;
  column?: ReactNode;
  children?: ReactNode;
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function hasAll(element: Element, required: readonly string[]): boolean {
  const present = new Set(classTokens(element));
  return required.every((token) => present.has(token));
}

function hasToken(element: Element, token: string): boolean {
  return classTokens(element).includes(token);
}

function ancestorWith(start: Element | null, required: readonly string[]): HTMLElement | null {
  let current: Element | null = start;
  while (current) {
    if (current instanceof HTMLElement && hasAll(current, required)) return current;
    current = current.parentElement;
  }
  return null;
}

function elementsWith(required: readonly string[]): HTMLElement[] {
  return [...document.querySelectorAll('*')].filter((element): element is HTMLElement => (
    element instanceof HTMLElement && hasAll(element, required)
  ));
}

function shownFromLg(tokens: readonly string[]): boolean {
  if (tokens.includes('max-lg:hidden')) return true;
  return tokens.includes('hidden') && LG_SHOW.some((token) => tokens.includes(token));
}

function hiddenFromLg(tokens: readonly string[]): boolean {
  if (tokens.includes('lg:hidden')) return true;
  return tokens.includes('hidden') && MAX_LG_SHOW.some((token) => tokens.includes(token));
}

function responsiveHost(start: Element | null, matches: (tokens: readonly string[]) => boolean): HTMLElement | null {
  let current: Element | null = start;
  while (current) {
    if (current instanceof HTMLElement && matches(classTokens(current))) return current;
    current = current.parentElement;
  }
  return null;
}

function shortLabel(label: string): string {
  if (label === '题目列表') return '题目';
  if (label === '提交列表') return '提交';
  return label;
}

function linkByExactText(root: ParentNode, label: string): HTMLAnchorElement {
  const found = [...root.querySelectorAll('a')].find((anchor) => (
    (anchor.textContent ?? '').replace(/\s+/g, '') === label
  ));
  expect(found, label).toBeInstanceOf(HTMLAnchorElement);
  if (!(found instanceof HTMLAnchorElement)) throw new TypeError(`missing link ${label}`);
  return found;
}

function primaryButtons(): HTMLElement[] {
  return [...document.querySelectorAll('[data-slot="button"][data-variant="primary"]')].filter((node): node is HTMLElement => (
    node instanceof HTMLElement
  ));
}

function timerValue(label: string): HTMLElement {
  const labelNode = screen.getByText(label);
  const scopes = [labelNode.parentElement, labelNode.parentElement?.parentElement];
  for (const scope of scopes) {
    if (!(scope instanceof HTMLElement)) continue;
    const value = [...scope.querySelectorAll('*')].find((element) => hasAll(element, TIMER_VALUE_CLASS));
    if (value instanceof HTMLElement) return value;
  }
  throw new TypeError(`missing timer value for ${label}`);
}

function examModeChip(): HTMLElement | null {
  const label = screen.queryByText('考试模式');
  if (!(label instanceof HTMLElement)) return null;
  let current: HTMLElement | null = label.parentElement;
  while (current) {
    if (current.querySelector('svg.lucide-lock')) return current;
    current = current.parentElement;
  }
  return label;
}

function hasDangerDot(link: HTMLElement): boolean {
  return [link, ...link.querySelectorAll('*')].some((element) => hasToken(element, 'bg-danger'));
}

function readNoticeStamp(tid: string): number {
  const raw = localStorage.getItem(`ws-notice:${tid}`);
  expect(raw, `ws-notice:${tid}`).toEqual(expect.any(String));
  if (typeof raw !== 'string') throw new TypeError(`ws-notice:${tid} is missing`);
  const numeric = Number(raw);
  if (raw.trim() !== '' && Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(raw);
  expect(Number.isFinite(parsed), raw).toBe(true);
  if (!Number.isFinite(parsed)) throw new TypeError(`ws-notice:${tid} is not a time`);
  return parsed;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key);
}

function isShellComponent(value: unknown): value is ShellComponent {
  return typeof value === 'function';
}

async function loadShell(): Promise<ShellComponent> {
  const load = Object.values(shellLoaders).find((candidate) => typeof candidate === 'function');
  expect(typeof load, `${SHELL_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${SHELL_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${SHELL_SOURCE} must be a module`);
  const exported = readField(imported, 'SetWorkspaceShell');
  expect(typeof exported, 'SetWorkspaceShell').toBe('function');
  if (!isShellComponent(exported)) throw new TypeError('SetWorkspaceShell must be a function');
  return exported;
}

let loading: Promise<ShellComponent> | undefined;

function getShell(): Promise<ShellComponent> {
  loading ??= loadShell();
  return loading;
}

function bootstrap(generatedAt: string): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt,
    user: {
      id: 7,
      name: 'student',
      signedIn: true,
    } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'set_workspace.html', data: {} },
  };
}

function urls(overview: string, overrides: Partial<WsUrls> = {}): WsUrls {
  return {
    back: BACK_HREF,
    manage: null,
    overview,
    problem: null,
    submit: null,
    submitCode: null,
    recordDetail: `/record/__RID__?tid=${TID}`,
    records: `/record?tid=${TID}&uidOrName=7`,
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

function workspace(patch: WorkspacePatch = {}): SetWorkspace {
  const base: SetWorkspace = {
    kind: 'paper',
    flavor: 'paper',
    tid: TID,
    title: '数据结构期中考试',
    description: '',
    mode: 'browser',
    phase: 'answering',
    locked: null,
    numbering: 'pta',
    window: {
      beginAt: new Date(SERVER - 60_000).toISOString(),
      endAt: new Date(SERVER + 2 * 60 * 60_000).toISOString(),
      dueAt: null,
      durationMinutes: 120,
      startAt: new Date(SERVER - 30_000).toISOString(),
      personalEndAt: new Date(SERVER + 59_000).toISOString(),
      lockAt: null,
    },
    groups: [{
      kind: 'single',
      no: 2,
      name: '单选题',
      scoreEach: 5,
      items: [{
        pid: 21,
        label: '2-1',
        title: '栈',
        kind: 'single',
        score: 5,
        state: 'empty',
        submits: 0,
        lastScore: null,
      }],
    }],
    totals: {
      problemCount: 1,
      maxScore: 100,
      answered: 0,
      score: null,
      accepted: null,
      showScore: false,
    },
    verdictVisible: false,
    objectiveVerdictVisible: true,
    team: null,
    paper: {
      score: null,
      passed: null,
      judging: false,
      passScore: 60,
      attemptLimit: null,
      attemptsUsed: 0,
      canRetake: false,
      submitByKind: false,
      lockedKinds: [],
    },
    announcements: [],
    clarifications: [],
    info: [],
    student: { name: '张三', studentId: '2024010203' },
    action: {
      canStart: false,
      canFinalize: false,
      canAttend: false,
      canUnrank: false,
      canSubmit: true,
      attended: true,
      canRetake: false,
    },
    urls: urls(`/paper/${TID}`, {
      manage: `/teach/exam/${TID}`,
      ranking: `/paper/${TID}/ranking`,
      finalize: `/paper/${TID}/finalize`,
    }),
  };
  return {
    ...base,
    ...patch,
    student: { ...base.student, ...patch.student },
    action: { ...base.action, ...patch.action },
    window: { ...base.window, ...patch.window },
    urls: { ...base.urls, ...patch.urls },
  };
}

function mount(Shell: ShellComponent, ws: SetWorkspace, options: MountOptions = {}) {
  const onFinalize = options.onFinalize ?? vi.fn();
  const view = render(
    <BootstrapProvider bootstrap={bootstrap(options.generatedAt ?? SERVER_ISO)}>
      <Shell
        ws={ws}
        section={options.section ?? 'overview'}
        column={options.column ?? <aside>题目总览栏</aside>}
        onFinalize={onFinalize}
      >
        {options.children ?? <div>主区内容</div>}
      </Shell>
    </BootstrapProvider>,
  );
  return { ...view, onFinalize };
}

function railElement(): HTMLElement {
  const rails = elementsWith(RAIL_CLASS);
  expect(rails).toHaveLength(1);
  const rail = rails[0];
  if (!rail) throw new TypeError('missing rail');
  return rail;
}

function bottomElement(): HTMLElement {
  const bars = [...document.querySelectorAll('*')].filter((element): element is HTMLElement => (
    element instanceof HTMLElement && hasToken(element, SAFE_AREA_CLASS)
  ));
  expect(bars).toHaveLength(1);
  const bar = bars[0];
  if (!bar) throw new TypeError('missing bottom bar');
  return bar;
}

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('set workspace shell', () => {
  it('replaces the back link with a lock in client mode', async () => {
    const Shell = await getShell();
    const ws = workspace({
      mode: 'client',
      action: { canFinalize: true },
      urls: { back: BACK_HREF, manage: null },
    });
    mount(Shell, ws);

    expect(document.querySelector(`a[href="${BACK_HREF}"]`)).toBeNull();
    const chip = examModeChip();
    const locks = [...document.querySelectorAll('svg.lucide-lock')];
    const backLocks = chip ? locks.filter((lock) => !chip.contains(lock)) : locks;
    expect(backLocks.length).toBeGreaterThan(0);
    for (const lock of locks) {
      expect(lock.closest('a')).toBeNull();
    }
    expect(primaryButtons()).toHaveLength(1);
    expect(primaryButtons()[0]).toHaveTextContent('交卷');
    expect(screen.getByText('考试模式')).toBeInTheDocument();
  });

  it('links back to the list outside client mode', async () => {
    const Shell = await getShell();
    mount(Shell, workspace({ mode: 'browser', urls: { back: BACK_HREF } }));
    const back = document.querySelector(`a[href="${BACK_HREF}"]`);
    expect(back).toBeInstanceOf(HTMLAnchorElement);
    expect(back?.querySelector('svg.lucide-lock')).toBeNull();
  });

  it('shows the exact preview banner and an exit link', async () => {
    const Shell = await getShell();
    const manageHref = `/teach/exam/${TID}`;
    const ws = workspace({ mode: 'preview', urls: { back: BACK_HREF, manage: manageHref } });
    mount(Shell, ws);
    const bannerText = screen.getByText('验题模式：你的作答只有你自己看得到，不计成绩。');
    expect(ancestorWith(bannerText, BANNER_CLASS)).not.toBeNull();
    expect(screen.queryByText('以学生视角预览：作答不会被记录。')).toBeNull();
    expect(screen.queryByRole('link', { name: '退出预览' })).toBeNull();
    expect(screen.getByRole('link', { name: '退出验题' })).toHaveAttribute('href', manageHref);
    expect(document.querySelector(`a[href="${BACK_HREF}"]`)).not.toBeNull();
  });

  it('omits the preview banner in browser and client mode', async () => {
    const Shell = await getShell();
    const browser = mount(Shell, workspace({ mode: 'browser' }));
    expect(screen.queryByText('以学生视角预览：作答不会被记录。')).toBeNull();
    expect(screen.queryByText('验题模式：你的作答只有你自己看得到，不计成绩。')).toBeNull();
    expect(screen.queryByRole('link', { name: '退出预览' })).toBeNull();
    expect(screen.queryByRole('link', { name: '退出验题' })).toBeNull();
    browser.unmount();

    mount(Shell, workspace({ mode: 'client' }));
    expect(screen.queryByText('以学生视角预览：作答不会被记录。')).toBeNull();
    expect(screen.queryByText('验题模式：你的作答只有你自己看得到，不计成绩。')).toBeNull();
    expect(screen.queryByRole('link', { name: '退出预览' })).toBeNull();
    expect(screen.queryByRole('link', { name: '退出验题' })).toBeNull();
  });

  it('paints the timer text-danger-fg when less than a minute remains', async () => {
    const Shell = await getShell();
    vi.useFakeTimers();
    vi.setSystemTime(SERVER);
    const ws = workspace({
      phase: 'answering',
      window: { personalEndAt: new Date(SERVER + 59_000).toISOString() },
    });
    expect(timerView(ws, SERVER)).toMatchObject({ label: '个人剩余', tone: 'danger' });
    mount(Shell, ws, { generatedAt: SERVER_ISO });
    const value = timerValue('个人剩余');
    expect(hasToken(value, 'text-danger-fg')).toBe(true);
    expect(hasToken(value, 'text-warning-fg')).toBe(false);
  });

  it('paints the timer text-warning-fg between one and five minutes', async () => {
    const Shell = await getShell();
    vi.useFakeTimers();
    vi.setSystemTime(SERVER);
    const ws = workspace({
      phase: 'answering',
      window: { personalEndAt: new Date(SERVER + 2 * 60_000).toISOString() },
    });
    expect(timerView(ws, SERVER)).toMatchObject({ label: '个人剩余', tone: 'warning' });
    mount(Shell, ws, { generatedAt: SERVER_ISO });
    const value = timerValue('个人剩余');
    expect(hasToken(value, 'text-warning-fg')).toBe(true);
    expect(hasToken(value, 'text-danger-fg')).toBe(false);
  });

  it('keeps the server clock when the classroom clock is already in the last minute', async () => {
    const Shell = await getShell();
    vi.useFakeTimers();
    const classroom = SERVER + (5 * 60_000) + 30_000;
    vi.setSystemTime(classroom);
    const ws = workspace({
      phase: 'answering',
      window: { personalEndAt: new Date(SERVER + 6 * 60_000).toISOString() },
    });
    expect(timerView(ws, SERVER)).toMatchObject({ tone: 'fg' });
    expect(timerView(ws, classroom)).toMatchObject({ tone: 'danger' });
    mount(Shell, ws, { generatedAt: SERVER_ISO });
    const value = timerValue('个人剩余');
    expect(hasToken(value, 'text-fg')).toBe(true);
    expect(hasToken(value, 'text-danger-fg')).toBe(false);
    expect(hasToken(value, 'text-warning-fg')).toBe(false);
  });

  it('shows the untimed homework deadline in text-danger-fg', async () => {
    const Shell = await getShell();
    vi.useFakeTimers();
    vi.setSystemTime(SERVER);
    const dueAt = new Date(SERVER + 59_000).toISOString();
    const homework = workspace({
      kind: 'homework',
      flavor: 'homework',
      title: '第 4 周作业',
      phase: 'answering',
      paper: null,
      window: { durationMinutes: null, dueAt, personalEndAt: null },
      urls: { overview: `/homework/${TID}` },
    });
    const view = timerView(homework, SERVER);
    expect(view).toMatchObject({ label: '截止', tone: 'danger' });
    if (!view?.text) throw new TypeError('deadline text is missing');
    mount(Shell, homework, { generatedAt: SERVER_ISO });
    const value = timerValue('截止');
    expect(value).toHaveTextContent(view.text);
    expect(hasToken(value, 'text-danger-fg')).toBe(true);
    expect(screen.queryByText('考试模式')).toBeNull();
  });

  it('labels an upcoming paper as time until the exam and omits the timer once it has ended', async () => {
    const Shell = await getShell();
    vi.useFakeTimers();
    vi.setSystemTime(SERVER);
    const upcoming = workspace({
      phase: 'upcoming',
      window: { beginAt: new Date(SERVER + 2 * 60 * 60_000).toISOString() },
    });
    expect(timerView(upcoming, SERVER)).toMatchObject({ label: '距开考' });
    const open = mount(Shell, upcoming, { generatedAt: SERVER_ISO });
    expect(timerValue('距开考')).toBeInstanceOf(HTMLElement);
    open.unmount();

    const ended = workspace({ phase: 'ended' });
    expect(timerView(ended, SERVER)).toBeNull();
    mount(Shell, ended, { generatedAt: SERVER_ISO });
    expect(screen.queryByText('距开考')).toBeNull();
    expect(screen.queryByText('个人剩余')).toBeNull();
    expect(screen.queryByText('剩余')).toBeNull();
    expect(screen.queryByText('距开始')).toBeNull();
    expect(screen.queryByText('截止')).toBeNull();
    expect(elementsWith(TIMER_VALUE_CLASS)).toHaveLength(0);
    expect(screen.queryByText('考试模式')).toBeNull();
  });

  it('keeps exactly one primary hand-in control when a paper can be finalized', async () => {
    const Shell = await getShell();
    const user = userEvent.setup();
    const onFinalize = vi.fn();
    const ws = workspace({
      mode: 'browser',
      phase: 'answering',
      action: { canFinalize: true },
      urls: { manage: `/teach/exam/${TID}`, back: BACK_HREF },
    });
    mount(Shell, ws, { onFinalize });
    const manage = screen.getByRole('link', { name: '管理' });
    expect(manage).toHaveAttribute('href', `/teach/exam/${TID}`);
    expect(manage).toHaveAttribute('data-variant', 'secondary');
    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.getByText('2024010203')).toBeInTheDocument();
    expect(screen.getByText('数据结构期中考试')).toBeInTheDocument();
    const primaries = primaryButtons();
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent('交卷');
    expect(onFinalize).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '交卷' }));
    expect(onFinalize).toHaveBeenCalledTimes(1);
  });

  it('omits the hand-in button when the paper cannot be finalized', async () => {
    const Shell = await getShell();
    const ws = workspace({
      phase: 'answering',
      action: { canFinalize: false },
      urls: { manage: `/teach/exam/${TID}` },
    });
    mount(Shell, ws);
    expect(screen.queryByRole('button', { name: '交卷' })).toBeNull();
    expect(screen.queryByText('交卷')).toBeNull();
    expect(primaryButtons()).toHaveLength(0);
    expect(screen.getByRole('link', { name: '管理' })).toHaveAttribute('data-variant', 'secondary');
  });

  it('hides exam mode on a browser contest and shows it for a client contest', async () => {
    const Shell = await getShell();
    const browser = mount(Shell, workspace({
      kind: 'contest',
      flavor: 'acm',
      title: '秋季校赛',
      mode: 'browser',
      numbering: 'letter',
      paper: null,
      urls: { overview: `/contest/${TID}`, manage: null },
    }));
    expect(screen.queryByText('考试模式')).toBeNull();
    browser.unmount();

    mount(Shell, workspace({
      kind: 'contest',
      flavor: 'acm',
      title: '秋季校赛',
      mode: 'client',
      phase: 'answering',
      numbering: 'letter',
      paper: null,
      urls: { overview: `/exam-mode/${TID}`, back: BACK_HREF, manage: null },
    }));
    expect(screen.getByText('考试模式')).toBeInTheDocument();
    expect(document.querySelector(`a[href="${BACK_HREF}"]`)).toBeNull();
  });

  it('omits a null student id without rendering the word null', async () => {
    const Shell = await getShell();
    mount(Shell, workspace({ student: { studentId: null } }));
    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.queryByText('2024010203')).toBeNull();
    expect(screen.queryByText('null')).toBeNull();
  });

  it('lays out the rail, the column from lg, and the main area', async () => {
    const Shell = await getShell();
    const ws = workspace();
    mount(Shell, ws);
    const mainText = screen.getByText('主区内容');
    const columnText = screen.getByText('题目总览栏');
    const root = ancestorWith(mainText, ROOT_CLASS);
    const main = ancestorWith(mainText, MAIN_CLASS);
    const rail = railElement();
    const body = ancestorWith(rail, BODY_CLASS);
    expect(root).not.toBeNull();
    expect(main).not.toBeNull();
    expect(body).not.toBeNull();
    expect(body).toContainElement(mainText);
    expect(responsiveHost(rail, shownFromLg)).not.toBeNull();
    expect(responsiveHost(columnText, shownFromLg)).not.toBeNull();
    expect(main).toContainElement(mainText);
    expect(screen.getByText(ws.title)).toBeInTheDocument();
  });

  it('shows the first five rail items in the bottom bar and shortens the long labels', async () => {
    const Shell = await getShell();
    const ws = workspace({
      kind: 'contest',
      flavor: 'acm',
      title: '秋季校赛',
      mode: 'browser',
      numbering: 'letter',
      paper: null,
      announcements: [{
        id: 'a1',
        subject: '更正',
        content: '题面已更新。',
        createdAt: LATEST_NOTICE,
      }],
      urls: {
        overview: `/contest/${TID}`,
        ranking: `/contest/${TID}/scoreboard`,
        clarify: `/contest/${TID}/problems`,
        print: `/exam-mode/${TID}/print`,
        manage: null,
      },
    });
    const items = railItems(ws);
    expect(items.map((item) => item.label)).toEqual(['概览', '题目列表', '提交列表', '排名', '公告', '答疑', '打印']);
    mount(Shell, ws, { section: 'records' });

    const rail = railElement();
    const bottom = bottomElement();
    expect(responsiveHost(bottom, hiddenFromLg)).not.toBeNull();
    expect(rail.querySelectorAll('button')).toHaveLength(0);
    expect(bottom.querySelectorAll('button')).toHaveLength(0);
    expect([...rail.querySelectorAll('a')].map((anchor) => (anchor.textContent ?? '').replace(/\s+/g, ''))).toEqual(
      items.map((item) => item.label),
    );
    expect([...bottom.querySelectorAll('a')].map((anchor) => (anchor.textContent ?? '').replace(/\s+/g, ''))).toEqual(
      items.slice(0, 5).map((item) => shortLabel(item.label)),
    );
    expect(bottom.querySelectorAll('a').length).toBeLessThanOrEqual(5);

    for (const item of items) {
      const link = linkByExactText(rail, item.label);
      expect(link).toHaveAttribute('href', sectionHref(ws, item.section));
      const iconClass = ICON_CLASS[item.icon];
      expect(iconClass, item.icon).toBeTruthy();
      expect(link.querySelector(`svg.${iconClass}`)).not.toBeNull();
      expect([link, ...link.querySelectorAll('*')].some((element) => hasToken(element, 'text-2xs'))).toBe(true);
    }
    expect(linkByExactText(bottom, '提交')).toHaveAttribute('href', sectionHref(ws, 'records'));
    expect(linkByExactText(bottom, '题目')).toHaveAttribute('href', sectionHref(ws, 'problems'));
    expect(hasAll(linkByExactText(rail, '提交列表'), CURRENT_CLASS)).toBe(true);
    expect(hasAll(linkByExactText(rail, '概览'), ['bg-brand-soft'])).toBe(false);
    expect(hasAll(linkByExactText(bottom, '提交'), CURRENT_CLASS)).toBe(true);
    expect(bottom.textContent ?? '').not.toContain('答疑');
    expect(bottom.textContent ?? '').not.toContain('打印');
    expect(bottom.textContent ?? '').not.toContain('题目列表');
    expect(bottom.textContent ?? '').not.toContain('提交列表');
  });

  it('keeps a short homework bottom bar without notice or clarifications', async () => {
    const Shell = await getShell();
    const ws = workspace({
      kind: 'homework',
      flavor: 'homework',
      title: '第 4 周作业',
      paper: null,
      urls: {
        overview: `/homework/${TID}`,
        ranking: null,
        clarify: null,
        print: null,
        manage: null,
      },
    });
    expect(railItems(ws).map((item) => item.label)).toEqual(['概览', '题目列表', '提交列表']);
    mount(Shell, ws);
    const rail = railElement();
    const bottom = bottomElement();
    expect([...rail.querySelectorAll('a')].map((anchor) => (anchor.textContent ?? '').replace(/\s+/g, ''))).toEqual([
      '概览', '题目列表', '提交列表',
    ]);
    expect([...bottom.querySelectorAll('a')].map((anchor) => (anchor.textContent ?? '').replace(/\s+/g, ''))).toEqual([
      '概览', '题目', '提交',
    ]);
    expect(bottom.querySelectorAll('a').length).toBeLessThanOrEqual(5);
    expect(rail.textContent ?? '').not.toContain('公告');
    expect(rail.textContent ?? '').not.toContain('答疑');
    expect(bottom.textContent ?? '').not.toContain('公告');
  });

  it('marks a notice unread until the notice section records the latest announcement', async () => {
    const Shell = await getShell();
    const announcement = {
      id: 'a1',
      subject: '更正',
      content: '题面已更新。',
      createdAt: LATEST_NOTICE,
    };
    const ws = workspace({
      kind: 'contest',
      flavor: 'acm',
      title: '秋季校赛',
      mode: 'browser',
      numbering: 'letter',
      paper: null,
      announcements: [
        {
          id: 'a0',
          subject: '开放',
          content: '比赛已开放。',
          createdAt: OLDER_NOTICE,
        },
        announcement,
        {
          id: 'a2',
          subject: '补充',
          content: '请看清题面。',
          createdAt: '2026-10-18T13:00:00.000Z',
        },
      ],
      urls: {
        overview: `/contest/${TID}`,
        ranking: `/contest/${TID}/scoreboard`,
        clarify: null,
        manage: null,
      },
    });
    const latest = Date.parse(LATEST_NOTICE);

    localStorage.clear();
    const unread = mount(Shell, ws, { section: 'overview' });
    expect(hasDangerDot(linkByExactText(railElement(), '公告'))).toBe(true);
    unread.unmount();

    localStorage.setItem(`ws-notice:${TID}`, LATEST_NOTICE);
    const read = mount(Shell, ws, { section: 'overview' });
    expect(hasDangerDot(linkByExactText(railElement(), '公告'))).toBe(false);
    read.unmount();

    localStorage.setItem(`ws-notice:${TID}`, OLDER_NOTICE);
    const stale = mount(Shell, ws, { section: 'overview' });
    expect(hasDangerDot(linkByExactText(railElement(), '公告'))).toBe(true);
    stale.unmount();

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(latest + 3 * 24 * 60 * 60 * 1000);
    const visiting = mount(Shell, ws, { section: 'notice' });
    await waitFor(() => {
      expect(readNoticeStamp(TID)).toBe(latest);
    });
    visiting.unmount();

    mount(Shell, ws, { section: 'overview' });
    expect(hasDangerDot(linkByExactText(railElement(), '公告'))).toBe(false);
  });
});
