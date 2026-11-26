// A static import fails collection while src/pages/set-workspace/page.tsx is absent.
import { EditorView } from '@codemirror/view';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { formatMoment } from '../../src/pages/problem-sets/model.ts';
import { sectionHref, type SetWorkspace, type WsGroup, type WsItem, type WsPaper } from '../../src/pages/set-workspace/model.ts';

const transport = vi.hoisted(() => ({
  getJson: vi.fn<(path: string, fallback: string) => Promise<unknown>>(),
  postForm: vi.fn<(path: string, body: URLSearchParams, fallback: string) => Promise<Record<string, unknown>>>(),
}));

vi.mock('@/pages/teach/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pages/teach/api')>();
  return { ...actual, getJson: transport.getJson, postForm: transport.postForm };
});

const pageLoaders = import.meta.glob('../../src/pages/set-workspace/page.tsx');
const PAGE_SOURCE = 'src/pages/set-workspace/page.tsx';

const TID = '64b8000000000000000000a1';
const NOW_ISO = '2026-10-18T06:00:00.000Z';
const NOW = Date.parse(NOW_ISO);
const MINUTE_MS = 60_000;
const SINGLE_PID = 1001;
const PROGRAM_PID = 1002;
const PROGRAM_TITLE = '最短路计数';
const PROGRAM_BODY = '给定一张无向图，求最短路条数。';
const SINGLE_BODY = '下列结构中后进先出的是。';
const OVERVIEW_ONLY = '只在概览出现的说明。';
const KIND_SUMMARY = '1 题 · 每题 5 分';
const TITLE = '期中机考工作台';
const COLUMN_KEY = `ws-col:${TID}`;
const ATTEND_FALLBACK = '开始做作业失败。';
const HOMEWORK_DRAFT = `/homework/${TID}/draft`;
const PAPER_DRAFT = `/paper/${TID}/draft`;
const PAPER_START = `/paper/${TID}/start`;
const HOMEWORK_ATTEND = `/homework/${TID}`;
const PAPER_FINALIZE = `/paper/${TID}/finalize`;
const PAPER_UPSERT = `/paper/${TID}/draft/__PID__`;
const STARTED_AT = '2026-10-18T05:00:00.000Z';
const UNSAVED_NOTE = '还有未保存的修改。请先保存本题型答案，或放弃这些修改后再交卷。交卷不会自动保存。';
const PROGRAM_CODE = 'int answer = 1;';
const CHOICE_KEY = '1';
const PRINT_URL = `/exam-mode/${TID}/print`;
const FAR_END_ISO = '2026-10-18T18:00:00+08:00';
const SHORT_END_ISO = new Date(NOW + 40 * MINUTE_MS + 20_000).toISOString();
const OPEN_AT = '2026-10-19T08:15:00+08:00';
const LATER_START = '2026-10-20T09:30:00+08:00';
const FAR_END_LABEL = formatMoment(FAR_END_ISO, NOW);
const SHORT_END_LABEL = formatMoment(SHORT_END_ISO, NOW);
const OPEN_LABEL = formatMoment(OPEN_AT, NOW);
const LATER_START_LABEL = formatMoment(LATER_START, NOW);
const START_DIALOG = `开始后计时 120 分钟，中途不能暂停；${FAR_END_LABEL} 统一截止。`;
const SHORT_DIALOG = `现在开始只剩 40 分钟，${SHORT_END_LABEL} 统一截止。`;
const FINALIZE_COPY = '交卷后不能再修改答案。已作答 3 / 8。';
const NEED_START_COPY = '点「开始作答」后才能看到题目';
const NEED_ATTEND_COPY = '点「开始做作业」后才能看到题目';
const CONTEST_LOCK_COPY = '报名后，比赛开始时这里出现题目';
const CLIENT_TITLE = '请在机房客户端进入';
const CLIENT_PROBLEM = '这场考试只能在机房电脑上的 Krypton 客户端里作答';
const CLIENT_OVERVIEW = '这场考试只能用机房电脑上的 Krypton 客户端参加。在浏览器里只能查看说明和公告。';
const NOT_STARTED_COPY = '开始后才能看到题目';
const NOT_OPEN_COPY = '开放后才能看到题目';
const VIEW_CLOSED_COPY = '比赛结束后不能查看题目。';

type WorkspacePage = () => ReactElement;
type WorkspaceKind = SetWorkspace['kind'];

interface WorkspaceOptions {
  kind?: WorkspaceKind;
  flavor?: SetWorkspace['flavor'];
  phase?: SetWorkspace['phase'];
  mode?: SetWorkspace['mode'];
  locked?: SetWorkspace['locked'];
  groups?: WsGroup[];
  answered?: number;
  problemCount?: number;
  durationMinutes?: number | null;
  beginAt?: string;
  endAt?: string;
  dueAt?: string | null;
  startAt?: string | null;
  draftList?: string | null;
  draftUpsert?: string | null;
  start?: string | null;
  attend?: string | null;
  finalize?: string | null;
  ranking?: string | null;
  clarify?: string | null;
  print?: string | null;
  canFinalize?: boolean;
  canSubmit?: boolean;
  paper?: WsPaper | null;
}

interface PageExtra {
  langRange?: unknown;
  omitLang?: boolean;
  choiceKey?: string;
}

interface FormCall {
  path: string;
  body: URLSearchParams;
  fallback: string;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asPage(value: unknown): WorkspacePage {
  expect(typeof value, 'SetWorkspacePage').toBe('function');
  if (typeof value !== 'function') throw new TypeError('SetWorkspacePage must be a function');
  return value as WorkspacePage;
}

async function loadPage(): Promise<WorkspacePage> {
  let load: unknown;
  for (const [key, candidate] of Object.entries(pageLoaders)) {
    if (key.endsWith(PAGE_SOURCE)) load = candidate;
  }
  expect(typeof load, `${PAGE_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${PAGE_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${PAGE_SOURCE} must be a module`);
  return asPage(readField(imported, 'SetWorkspacePage'));
}

function overviewOf(kind: WorkspaceKind): string {
  if (kind === 'homework') return `/homework/${TID}`;
  if (kind === 'paper') return `/paper/${TID}`;
  return `/contest/${TID}`;
}

function singleItem(state: WsItem['state'] = 'empty'): WsItem {
  return {
    pid: SINGLE_PID,
    label: '2-1',
    title: '队列和栈',
    kind: 'single',
    score: 5,
    state,
    submits: 0,
    lastScore: null,
  };
}

function programItem(state: WsItem['state'] = 'empty'): WsItem {
  return {
    pid: PROGRAM_PID,
    label: '7-1',
    title: PROGRAM_TITLE,
    kind: 'programming',
    score: 25,
    state,
    submits: 0,
    lastScore: null,
  };
}

function singleGroup(state: WsItem['state'] = 'empty'): WsGroup {
  return {
    kind: 'single', no: 2, name: '单选题', scoreEach: 5, items: [singleItem(state)],
  };
}

function programGroup(state: WsItem['state'] = 'empty'): WsGroup {
  return {
    kind: 'programming', no: 7, name: '编程题', scoreEach: 25, items: [programItem(state)],
  };
}

function paperFacts(): WsPaper {
  return {
    score: null,
    passed: null,
    judging: false,
    passScore: 60,
    attemptLimit: null,
    attemptsUsed: 0,
    canRetake: false,
    submitByKind: false,
    lockedKinds: [],
  };
}

function objectivePayload(item: WsItem, choiceKey = 'main'): Record<string, unknown> {
  return {
    docId: `doc-${item.pid}`,
    pid: item.pid,
    title: item.title,
    content: SINGLE_BODY,
    config: {
      type: 'objective',
      questions: [{
        key: choiceKey, kind: 'single', score: item.score, prompt: '作答', choices: ['队列', '栈'],
      }],
    },
  };
}

function programmingPayload(item: WsItem): Record<string, unknown> {
  return {
    docId: `doc-${item.pid}`,
    pid: item.pid,
    title: item.title,
    content: PROGRAM_BODY,
    config: { type: 'programming' },
  };
}

function problemRecord(groups: readonly WsGroup[], choiceKey = 'main'): Record<string, unknown> {
  const problems: Record<string, unknown> = {};
  for (const group of groups) {
    for (const item of group.items) {
      const programming = item.kind === 'programming' || item.kind === 'program_fill' || item.kind === 'function';
      problems[String(item.pid)] = programming ? programmingPayload(item) : objectivePayload(item, choiceKey);
    }
  }
  return problems;
}

function workspace(options: WorkspaceOptions = {}): SetWorkspace {
  const kind = options.kind ?? 'homework';
  const flavor = options.flavor ?? (kind === 'contest' ? 'acm' : kind);
  const overview = overviewOf(kind);
  const groups = options.groups ?? [singleGroup(), programGroup()];
  return {
    kind,
    flavor,
    tid: TID,
    title: TITLE,
    description: OVERVIEW_ONLY,
    mode: options.mode ?? 'browser',
    phase: options.phase ?? 'answering',
    locked: options.locked === undefined ? null : options.locked,
    numbering: kind === 'contest' ? 'letter' : 'pta',
    window: {
      beginAt: options.beginAt ?? '2026-10-18T08:00:00+08:00',
      endAt: options.endAt ?? '2026-10-22T23:59:00+08:00',
      dueAt: options.dueAt === undefined ? (kind === 'homework' ? '2026-10-20T23:59:00+08:00' : null) : options.dueAt,
      durationMinutes: options.durationMinutes === undefined ? null : options.durationMinutes,
      startAt: options.startAt === undefined ? null : options.startAt,
      personalEndAt: null,
      lockAt: null,
    },
    groups,
    totals: {
      problemCount: options.problemCount ?? groups.reduce((sum, group) => sum + group.items.length, 0),
      maxScore: flavor === 'acm' ? null : 30,
      answered: options.answered ?? 0,
      score: 0,
      accepted: flavor === 'acm' ? 0 : null,
      showScore: true,
    },
    verdictVisible: true,
    objectiveVerdictVisible: true,
    team: null,
    paper: options.paper === undefined ? (kind === 'paper' ? paperFacts() : null) : options.paper,
    announcements: [],
    clarifications: [],
    info: [],
    student: { name: '张三', studentId: '2024010203' },
    action: {
      canStart: options.start !== undefined && options.start !== null,
      canFinalize: options.canFinalize ?? false,
      canAttend: options.attend !== undefined && options.attend !== null,
      canUnrank: false,
      canSubmit: options.canSubmit ?? true,
      attended: options.locked?.reason !== 'need_attend',
      canRetake: false,
    },
    urls: {
      back: '/problem-sets',
      manage: null,
      overview,
      problem: null,
      submit: kind === 'paper' ? null : `/p/__PID__/submit?tid=${TID}`,
      submitCode: kind === 'paper' ? `/paper/${TID}/submit-code/__PID__` : null,
      recordDetail: `/record/__RID__?tid=${TID}`,
      records: `/record?tid=${TID}&uidOrName=7`,
      ranking: options.ranking === undefined ? null : options.ranking,
      clarify: options.clarify === undefined ? null : options.clarify,
      print: options.print === undefined ? null : options.print,
      start: options.start === undefined ? null : options.start,
      attend: options.attend === undefined ? null : options.attend,
      draftList: options.draftList === undefined ? null : options.draftList,
      draftUpsert: options.draftUpsert === undefined ? null : options.draftUpsert,
      submitKind: kind === 'homework' ? `/homework/${TID}/submit-kind` : null,
      lockKind: null,
      finalize: options.finalize === undefined ? null : options.finalize,
      virtual: null,
      practice: null,
      teamProblem: null,
      pretest: null,
    },
  };
}

function pageData(ws: SetWorkspace, extra: PageExtra = {}): Record<string, unknown> {
  const data: Record<string, unknown> = {
    workspace: ws,
    workspaceProblems: problemRecord(ws.groups, extra.choiceKey ?? 'main'),
  };
  if (extra.omitLang !== true) data.langRange = extra.langRange === undefined ? { 'py.py3': 'Python 3' } : extra.langRange;
  return data;
}

function bootstrapFor(data: Record<string, unknown>): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: NOW_ISO,
    user: {
      id: 7,
      name: '张三',
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
    page: { templateName: 'set_workspace.html', data },
  };
}

let restoreLocation = (): void => undefined;

function installNarrowScreen(): () => void {
  const previousWidth = window.innerWidth;
  const previousMedia = window.matchMedia.bind(window);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  const matchMedia = (query: string): MediaQueryList => ({
    matches: query.includes('max-width') && !/min-width:\s*(?:1024px|64rem)/.test(query),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }) as MediaQueryList;
  window.matchMedia = matchMedia;
  return () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
    window.matchMedia = previousMedia;
  };
}

function installLocation(search: string): () => void {
  const assign = vi.fn();
  const saved = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...saved, search, assign, reload: vi.fn(), replace: vi.fn() },
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

function show(Page: WorkspacePage, data: Record<string, unknown>, search: string): void {
  restoreLocation();
  restoreLocation = installLocation(search);
  const bootstrap = bootstrapFor(data);
  window.__KRYPTON_BOOTSTRAP__ = bootstrap;
  render(
    <BootstrapProvider bootstrap={bootstrap}>
      <Page />
    </BootstrapProvider>,
  );
}

async function openAt(search: string, options: WorkspaceOptions = {}, extra: PageExtra = {}): Promise<SetWorkspace> {
  const Page = await loadPage();
  const ws = workspace(options);
  show(Page, pageData(ws, extra), search);
  return ws;
}

async function findCopy(text: string): Promise<HTMLElement> {
  const matches = await screen.findAllByText(text, { exact: false });
  const leaf = matches.find((element) => (
    [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').includes(text))
  ));
  if (!leaf) throw new TypeError(`missing copy ${text}`);
  return leaf;
}

function absent(text: string): void {
  expect(screen.queryAllByText(text, { exact: false })).toHaveLength(0);
}

function formCall(): FormCall {
  const call = transport.postForm.mock.calls[0];
  if (!call) throw new TypeError('postForm was not called');
  const [path, body, fallback] = call;
  if (!(body instanceof URLSearchParams)) throw new TypeError('postForm body must be URLSearchParams');
  return { path, body, fallback };
}

function holdForm(): (value: Record<string, unknown>) => void {
  let finish: (value: Record<string, unknown>) => void = () => undefined;
  const promise = new Promise<Record<string, unknown>>((done) => {
    finish = done;
  });
  transport.postForm.mockImplementation(() => promise);
  return finish;
}

beforeEach(() => {
  localStorage.clear();
  transport.getJson.mockReset();
  transport.postForm.mockReset();
  transport.getJson.mockResolvedValue({ drafts: [], rdocs: [] });
  transport.postForm.mockResolvedValue({});
  restoreLocation();
  restoreLocation = installLocation('?section=overview');
});

function choiceInput(letter: string): HTMLInputElement {
  const node = document.querySelector(`input[type="radio"][value="${letter}"]`);
  if (!(node instanceof HTMLInputElement)) throw new TypeError(`missing choice ${letter}`);
  return node;
}

function replaceEditor(text: string): void {
  const content = document.querySelector('.cm-content');
  if (!(content instanceof HTMLElement)) throw new TypeError('editor is missing');
  const view = EditorView.findFromDOM(content);
  if (!view) throw new TypeError('editor view is missing');
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

function useDebounceTimers(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
}

async function drain(): Promise<void> {
  await act(async () => {
    for (let step = 0; step < 8; step += 1) {
      await Promise.resolve();
    }
  });
}

function formPaths(): string[] {
  return transport.postForm.mock.calls.map((call) => call[0]);
}

afterEach(() => {
  restoreLocation();
  restoreLocation = (): void => undefined;
  localStorage.clear();
  delete window.__KRYPTON_BOOTSTRAP__;
  vi.useRealTimers();
});

describe('set workspace page', () => {
  it('renders the single group and the answer column', async () => {
    await openAt('?section=problems&kind=single', { kind: 'homework', phase: 'answering' });

    expect(await findCopy(TITLE)).toBeInTheDocument();
    expect(await findCopy(KIND_SUMMARY)).toBeInTheDocument();
    expect(await findCopy(SINGLE_BODY)).toBeInTheDocument();
    expect(document.getElementById('q-2-1')).toBeInstanceOf(HTMLElement);
    const column = screen.getByRole('complementary', { name: '题目总览' });
    expect(within(column).getByRole('link', { name: '2-1' })).toHaveAttribute('href', '#q-2-1');
    expect(screen.getByRole('button', { name: '保存本题型答案' })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: PROGRAM_TITLE })).toBeNull();
    absent(OVERVIEW_ONLY);
  });

  it('renders one programming problem per page', async () => {
    await openAt('?section=problems&q=1002', { kind: 'homework', phase: 'answering' });

    expect(await screen.findByRole('heading', { name: PROGRAM_TITLE })).toBeInTheDocument();
    expect(await findCopy(PROGRAM_BODY)).toBeInTheDocument();
    expect(screen.getAllByRole('button').find((button) => button.getAttribute('aria-haspopup') === 'true')).toHaveTextContent('Python (py3)');
    const column = screen.getByRole('complementary', { name: '题目总览' });
    expect(within(column).getByRole('link', { name: '7-1' }).getAttribute('href')).toContain('q=1002');
    expect(document.getElementById('q-2-1')).toBeNull();
    absent(KIND_SUMMARY);
    absent(OVERVIEW_ONLY);
  });

  it('opens the start dialog when the problem list is locked until start', async () => {
    const user = userEvent.setup();
    await openAt('?section=problems', {
      kind: 'paper',
      phase: 'ready',
      locked: { reason: 'need_start' },
      durationMinutes: 120,
      endAt: FAR_END_ISO,
      start: PAPER_START,
      canSubmit: false,
    });

    expect(await findCopy(NEED_START_COPY)).toBeInTheDocument();
    const start = screen.getByRole('button', { name: '开始作答' });
    expect(start).toHaveAttribute('data-variant', 'primary');
    absent(SINGLE_BODY);
    expect(screen.queryByRole('complementary', { name: '题目总览' })).toBeNull();

    await user.click(start);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: '开始作答？' })).toBeInTheDocument();
    expect(within(dialog).getByText(START_DIALOG)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '开始作答' })).toBeInTheDocument();
  });

  it('opens the short-window start dialog when the limit does not fit', async () => {
    const user = userEvent.setup();
    await openAt('?section=problems', {
      kind: 'paper',
      phase: 'ready',
      locked: { reason: 'need_start' },
      durationMinutes: 45,
      endAt: SHORT_END_ISO,
      start: PAPER_START,
      canSubmit: false,
    });

    await user.click(await screen.findByRole('button', { name: '开始作答' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: '开始作答？' })).toBeInTheDocument();
    expect(within(dialog).getByText(SHORT_DIALOG)).toBeInTheDocument();
  });

  it('posts finalize after the hand-in dialog is confirmed', async () => {
    const user = userEvent.setup();
    const ws = await openAt('?section=overview', {
      kind: 'paper',
      phase: 'answering',
      answered: 3,
      problemCount: 8,
      canFinalize: true,
      finalize: PAPER_FINALIZE,
    });
    const finish = holdForm();

    await user.click(await screen.findByRole('button', { name: '交卷' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: '交卷？' })).toBeInTheDocument();
    expect(within(dialog).getByText(FINALIZE_COPY)).toBeInTheDocument();
    expect(transport.postForm).not.toHaveBeenCalled();

    const confirm = within(dialog).getByRole('button', { name: '交卷' });
    expect(confirm).toHaveAttribute('data-variant', 'primary');
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(transport.postForm).toHaveBeenCalledTimes(1);
    });
    expect(formCall().path).toBe(PAPER_FINALIZE);
    expect(formCall().body).toBeInstanceOf(URLSearchParams);
    expect(locationAssign()).not.toHaveBeenCalled();
    finish({});
    await waitFor(() => {
      expect(locationAssign()).toHaveBeenCalledWith(sectionHref(ws, 'overview'));
    });
  });

  it('does not leave the page when finalize fails', async () => {
    const user = userEvent.setup();
    await openAt('?section=overview', {
      kind: 'paper',
      phase: 'answering',
      answered: 3,
      problemCount: 8,
      canFinalize: true,
      finalize: PAPER_FINALIZE,
    });
    transport.postForm.mockRejectedValue(new Error('交卷失败。'));

    await user.click(await screen.findByRole('button', { name: '交卷' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '交卷' }));
    await waitFor(() => {
      expect(transport.postForm).toHaveBeenCalledTimes(1);
    });
    await new Promise((done) => {
      setTimeout(done, 0);
    });
    expect(locationAssign()).not.toHaveBeenCalled();
  });

  it('renders the overview for an unknown section', async () => {
    await openAt('?section=nope', { kind: 'paper', phase: 'answering' });

    expect(await findCopy(OVERVIEW_ONLY)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '继续作答' })).toBeInTheDocument();
    expect(document.getElementById('q-2-1')).toBeNull();
    absent(KIND_SUMMARY);
    absent(PROGRAM_BODY);
  });

  it('opens the first unfinished objective group when the query is empty', async () => {
    await openAt('?section=problems', { kind: 'homework', phase: 'answering' });

    expect(await findCopy(KIND_SUMMARY)).toBeInTheDocument();
    expect(document.getElementById('q-2-1')).toBeInstanceOf(HTMLElement);
    expect(screen.queryByRole('heading', { name: PROGRAM_TITLE })).toBeNull();
  });

  it('opens the first unfinished programming problem when earlier groups are done', async () => {
    await openAt('?section=problems', {
      kind: 'homework',
      phase: 'answering',
      groups: [singleGroup('correct'), programGroup('empty')],
    });

    expect(await screen.findByRole('heading', { name: PROGRAM_TITLE })).toBeInTheDocument();
    expect(await findCopy(PROGRAM_BODY)).toBeInTheDocument();
    expect(document.getElementById('q-2-1')).toBeNull();
  });

  it('hides a collapsed answer column and keeps the answer chips', async () => {
    localStorage.setItem(COLUMN_KEY, '1');
    const restoreScreen = installNarrowScreen();
    try {
      await openAt('?section=problems&kind=single', { kind: 'homework', phase: 'answering' });
      expect(await findCopy(KIND_SUMMARY)).toBeInTheDocument();
      expect(screen.queryByRole('complementary', { name: '题目总览' })).toBeNull();
      expect(screen.getByRole('link', { name: '2-1' })).toHaveAttribute('href', '#q-2-1');
    } finally {
      restoreScreen();
    }
  });

  it('applies homework drafts from the draft list', async () => {
    transport.getJson.mockImplementation(async (path: string) => {
      if (path === HOMEWORK_DRAFT) {
        return {
          drafts: [{
            pid: SINGLE_PID,
            answers: { main: 'A' },
            submittedAnswers: null,
            updatedAt: NOW_ISO,
          }],
        };
      }
      return { drafts: [], rdocs: [] };
    });
    await openAt('?section=problems&kind=single', {
      kind: 'homework',
      phase: 'answering',
      draftList: HOMEWORK_DRAFT,
    });

    await waitFor(() => {
      const radio = document.querySelector('input[type="radio"][value="A"]');
      expect(radio).toBeInstanceOf(HTMLInputElement);
      if (!(radio instanceof HTMLInputElement)) throw new TypeError('missing saved choice');
      expect(radio.checked).toBe(true);
    });
    expect(screen.getByRole('button', { name: '保存本题型答案' })).toBeDisabled();
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.getJson.mock.calls.some((call) => call[0] === HOMEWORK_DRAFT)).toBe(true);
  });

  it('applies paper drafts from the draft list', async () => {
    transport.getJson.mockImplementation(async (path: string) => {
      if (path === PAPER_DRAFT) {
        return {
          drafts: [{ pid: SINGLE_PID, answers: { main: 'B' }, updatedAt: NOW_ISO }],
          recordStatus: {},
        };
      }
      return { drafts: [], rdocs: [] };
    });
    await openAt('?section=problems&kind=single', {
      kind: 'paper',
      phase: 'answering',
      startAt: STARTED_AT,
      draftList: PAPER_DRAFT,
    });

    await findCopy(KIND_SUMMARY);
    await waitFor(() => {
      const radio = document.querySelector('input[type="radio"][value="B"]');
      expect(radio).toBeInstanceOf(HTMLInputElement);
      if (!(radio instanceof HTMLInputElement)) throw new TypeError('missing saved choice');
      expect(radio.checked).toBe(true);
    });
    expect(transport.getJson.mock.calls.some((call) => call[0] === PAPER_DRAFT)).toBe(true);
  });

  it('skips the draft request when there is no draft list', async () => {
    await openAt('?section=problems&kind=single', { kind: 'homework', phase: 'answering', draftList: null });

    await findCopy(KIND_SUMMARY);
    expect(transport.getJson).not.toHaveBeenCalled();
  });

  it('shows the not-started lock with the start time', async () => {
    await openAt('?section=problems', {
      kind: 'paper',
      phase: 'upcoming',
      locked: { reason: 'not_started' },
      beginAt: LATER_START,
      canSubmit: false,
    });

    expect(await findCopy(NOT_STARTED_COPY)).toBeInTheDocument();
    expect(await findCopy(LATER_START_LABEL)).toBeInTheDocument();
    absent(SINGLE_BODY);
    absent(OVERVIEW_ONLY);
  });

  it('shows the not-open lock with the open time', async () => {
    await openAt('?section=problems', {
      kind: 'homework',
      phase: 'upcoming',
      locked: { reason: 'not_open' },
      beginAt: OPEN_AT,
      canSubmit: false,
    });

    expect(await findCopy(NOT_OPEN_COPY)).toBeInTheDocument();
    expect(await findCopy(OPEN_LABEL)).toBeInTheDocument();
    absent(SINGLE_BODY);
  });

  it('starts homework from the locked problem list', async () => {
    const ws = await openAt('?section=problems', {
      kind: 'homework',
      phase: 'ready',
      locked: { reason: 'need_attend' },
      attend: HOMEWORK_ATTEND,
      canSubmit: false,
    });
    const finish = holdForm();

    expect(await findCopy(NEED_ATTEND_COPY)).toBeInTheDocument();
    const start = screen.getByRole('button', { name: '开始做作业' });
    expect(start).toHaveAttribute('data-variant', 'primary');
    fireEvent.click(start);
    await waitFor(() => {
      expect(transport.postForm).toHaveBeenCalledTimes(1);
    });
    const sent = formCall();
    expect(sent.path).toBe(HOMEWORK_ATTEND);
    expect(sent.body.get('operation')).toBe('attend');
    expect(sent.fallback).toBe(ATTEND_FALLBACK);
    expect(locationAssign()).not.toHaveBeenCalled();
    finish({});
    await waitFor(() => {
      expect(locationAssign()).toHaveBeenCalledWith(sectionHref(ws, 'problems'));
    });
  });

  it('links a locked contest back to the overview', async () => {
    const ws = await openAt('?section=problems', {
      kind: 'contest',
      flavor: 'acm',
      phase: 'ready',
      locked: { reason: 'need_attend' },
      groups: [{
        kind: 'programming', no: null, name: '题目', scoreEach: null, items: [programItem()],
      }],
      canSubmit: false,
    });

    expect(await findCopy(CONTEST_LOCK_COPY)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: '去概览报名' });
    expect(link).toHaveAttribute('data-variant', 'secondary');
    expect(link).toHaveAttribute('href', sectionHref(ws, 'overview'));
    expect(screen.queryByRole('button', { name: '开始作答' })).toBeNull();
    absent(PROGRAM_BODY);
  });

  it('shows the client-only lock without an action button', async () => {
    await openAt('?section=problems', {
      kind: 'paper',
      phase: 'answering',
      mode: 'browser',
      locked: { reason: 'client_only' },
      canSubmit: false,
    });

    expect(await findCopy(CLIENT_TITLE)).toBeInTheDocument();
    expect(await findCopy(CLIENT_PROBLEM)).toBeInTheDocument();
    absent(CLIENT_OVERVIEW);
    expect(screen.queryByRole('button', { name: '开始作答' })).toBeNull();
    expect(screen.queryByRole('button', { name: '开始做作业' })).toBeNull();
    absent(SINGLE_BODY);
  });

  it('shows the closed-view lock', async () => {
    await openAt('?section=problems', {
      kind: 'contest',
      phase: 'ended',
      locked: { reason: 'view_closed' },
      groups: [{
        kind: 'programming', no: null, name: '题目', scoreEach: null, items: [programItem()],
      }],
      canSubmit: false,
    });

    expect(await findCopy(VIEW_CLOSED_COPY)).toBeInTheDocument();
    absent(PROGRAM_BODY);
    absent(OVERVIEW_ONLY);
  });

  it('renders the records section', async () => {
    const ws = await openAt('?section=records', { kind: 'homework', phase: 'answering' });

    expect(await findCopy('还没有提交')).toBeInTheDocument();
    expect(transport.getJson.mock.calls.some((call) => call[0] === ws.urls.records)).toBe(true);
    absent(OVERVIEW_ONLY);
  });

  it('renders the ranking empty state', async () => {
    await openAt('?section=ranking', { kind: 'paper', phase: 'answering', ranking: null });

    expect(await findCopy('成绩公布后才能看到排名')).toBeInTheDocument();
    expect(await findCopy('考试结束后公布')).toBeInTheDocument();
    absent(OVERVIEW_ONLY);
  });

  it('renders the notice section', async () => {
    await openAt('?section=notice', { kind: 'paper', phase: 'answering' });

    expect(await findCopy('还没有公告')).toBeInTheDocument();
    absent(OVERVIEW_ONLY);
  });

  it('renders the clarify section', async () => {
    await openAt('?section=clar', { kind: 'paper', phase: 'answering', clarify: null });

    expect(await findCopy('还没有提问')).toBeInTheDocument();
    absent(OVERVIEW_ONLY);
  });

  it('renders the print section', async () => {
    await openAt('?section=print', {
      kind: 'contest',
      mode: 'client',
      phase: 'answering',
      print: PRINT_URL,
      groups: [{
        kind: 'programming', no: null, name: '题目', scoreEach: null, items: [programItem()],
      }],
    });

    expect(await findCopy('打印件由监考老师送到座位。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '打开打印' })).toHaveAttribute('href', PRINT_URL);
    absent(OVERVIEW_ONLY);
  });

  it('rejects a lang range that is not a map of strings', async () => {
    const Page = await loadPage();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => {
        show(Page, pageData(workspace(), { langRange: { 'py.py3': 1 } }), '?section=overview');
      }).toThrow(TypeError);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('renders a programming problem when lang range is omitted', async () => {
    await openAt('?section=problems&q=1002', { kind: 'homework', phase: 'answering' }, { omitLang: true });

    expect(await screen.findByRole('heading', { name: PROGRAM_TITLE })).toBeInTheDocument();
    const language = screen.getAllByRole('button').find((button) => button.getAttribute('aria-haspopup') === 'true');
    expect(language?.textContent ?? '').not.toContain('Python 3');
  });

  it('keeps a single-choice draft when a code-only paper draft has no answers', async () => {
    transport.getJson.mockImplementation(async (path: string) => {
      if (path === PAPER_DRAFT) {
        return {
          drafts: [
            { pid: SINGLE_PID, answers: { [CHOICE_KEY]: 'B' }, updatedAt: NOW_ISO },
            { pid: PROGRAM_PID, code: 'int main(){}', lang: 'cc.cc17', updatedAt: NOW_ISO },
          ],
        };
      }
      return { drafts: [] };
    });
    await openAt('?section=problems&kind=single', {
      kind: 'paper',
      phase: 'answering',
      startAt: STARTED_AT,
      draftList: PAPER_DRAFT,
    }, { choiceKey: CHOICE_KEY });

    await findCopy(KIND_SUMMARY);
    await waitFor(() => {
      expect(transport.getJson.mock.calls.some((call) => call[0] === PAPER_DRAFT)).toBe(true);
    });
    const alert = screen.queryByRole('alert');
    expect(alert?.textContent ?? '').not.toContain('answers is missing');
    expect(alert).toBeNull();
    // The draft list resolves before the paper applies it; wait for the restored choice.
    await waitFor(() => {
      expect(choiceInput('B').checked).toBe(true);
    });
  });

  it('rejects the whole draft list when one answers value is a number', async () => {
    transport.getJson.mockImplementation(async (path: string) => {
      if (path === PAPER_DRAFT) {
        return {
          drafts: [
            { pid: SINGLE_PID, answers: { [CHOICE_KEY]: 'B' }, updatedAt: NOW_ISO },
            { pid: PROGRAM_PID, answers: 3, updatedAt: NOW_ISO },
          ],
        };
      }
      return { drafts: [] };
    });
    await openAt('?section=problems&kind=single', {
      kind: 'paper',
      phase: 'answering',
      startAt: STARTED_AT,
      draftList: PAPER_DRAFT,
    }, { choiceKey: CHOICE_KEY });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText('无法读取已保存答案')).toBeInTheDocument();
  });

  it('does not load drafts before a browser paper has started', async () => {
    await openAt('?section=problems', {
      kind: 'paper',
      phase: 'ready',
      mode: 'browser',
      locked: { reason: 'need_start' },
      startAt: null,
      draftList: PAPER_DRAFT,
      start: PAPER_START,
      canSubmit: false,
    });

    expect(await findCopy(NEED_START_COPY)).toBeInTheDocument();
    await drain();
    expect(formPaths()).not.toContain(PAPER_DRAFT);
    expect(transport.getJson.mock.calls.map((call) => call[0])).not.toContain(PAPER_DRAFT);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('loads drafts for a preview paper that has not started', async () => {
    await openAt('?section=problems&kind=single', {
      kind: 'paper',
      phase: 'ready',
      mode: 'preview',
      locked: null,
      startAt: null,
      draftList: PAPER_DRAFT,
      canSubmit: false,
    });

    await findCopy(KIND_SUMMARY);
    await waitFor(() => {
      expect(transport.getJson.mock.calls.some((call) => call[0] === PAPER_DRAFT)).toBe(true);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('loads homework drafts when startAt is null', async () => {
    await openAt('?section=problems&kind=single', {
      kind: 'homework',
      phase: 'answering',
      locked: null,
      startAt: null,
      draftList: HOMEWORK_DRAFT,
    });

    await findCopy(KIND_SUMMARY);
    await waitFor(() => {
      expect(transport.getJson.mock.calls.some((call) => call[0] === HOMEWORK_DRAFT)).toBe(true);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not save the single-choice answer on hand-in while a debounce would have been pending', async () => {
    useDebounceTimers();
    await openAt('?section=problems&kind=single', {
      kind: 'paper',
      phase: 'answering',
      startAt: STARTED_AT,
      canFinalize: true,
      finalize: PAPER_FINALIZE,
      draftUpsert: PAPER_UPSERT,
    });

    expect(screen.getByText(KIND_SUMMARY)).toBeInTheDocument();
    fireEvent.click(choiceInput('B'));
    expect(choiceInput('B').checked).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(transport.postForm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '交卷' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(UNSAVED_NOTE);
    fireEvent.click(within(dialog).getByRole('button', { name: '交卷' }));
    await drain();

    expect(formPaths()).toEqual([]);
    expect(choiceInput('B').checked).toBe(true);
  });

  it('does not save the programming draft on hand-in while a debounce would have been pending', async () => {
    useDebounceTimers();
    await openAt('?section=problems&q=1002', {
      kind: 'paper',
      phase: 'answering',
      startAt: STARTED_AT,
      canFinalize: true,
      finalize: PAPER_FINALIZE,
      draftUpsert: PAPER_UPSERT,
    });

    expect(screen.getByRole('heading', { name: PROGRAM_TITLE })).toBeInTheDocument();
    replaceEditor(PROGRAM_CODE);
    expect(localStorage.getItem(`ws-code:${TID}:${PROGRAM_PID}`)).toBe(PROGRAM_CODE);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(transport.postForm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '交卷' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '交卷' }));
    await drain();

    expect(formPaths()).toEqual([PAPER_FINALIZE]);
    expect(formPaths().some((path) => path.includes('/draft/'))).toBe(false);
  });

  it('keeps the hand-in dialog open without posting an unsaved answer', async () => {
    useDebounceTimers();
    await openAt('?section=problems&kind=single', {
      kind: 'paper',
      phase: 'answering',
      startAt: STARTED_AT,
      canFinalize: true,
      finalize: PAPER_FINALIZE,
      draftUpsert: PAPER_UPSERT,
    });

    fireEvent.click(choiceInput('B'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    fireEvent.click(screen.getByRole('button', { name: '交卷' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '交卷' }));
    await drain();

    expect(formPaths()).toEqual([]);
    expect(within(dialog).getByRole('alert')).toHaveTextContent(UNSAVED_NOTE);
    const again = within(dialog).getByRole('button', { name: '交卷' });
    expect(again).toBeEnabled();
    fireEvent.click(again);
    await drain();
    expect(formPaths()).toEqual([]);
    expect(choiceInput('B').checked).toBe(true);
  });
});
