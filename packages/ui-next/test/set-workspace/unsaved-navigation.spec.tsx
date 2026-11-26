import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { sectionHref, type SetWorkspace, type WsGroup, type WsItem } from '../../src/pages/set-workspace/model.ts';

const transport = vi.hoisted(() => ({
  getJson: vi.fn<(path: string, fallback: string) => Promise<unknown>>(),
  postForm: vi.fn<(path: string, body: URLSearchParams, fallback: string) => Promise<Record<string, unknown>>>(),
  postJson: vi.fn<(path: string, body: Record<string, unknown>, fallback: string) => Promise<Record<string, unknown>>>(),
}));

vi.mock('@/pages/teach/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pages/teach/api')>();
  return {
    ...actual,
    getJson: transport.getJson,
    postForm: transport.postForm,
    postJson: transport.postJson,
  };
});

const pageLoaders = import.meta.glob('../../src/pages/set-workspace/page.tsx');
const PAGE_SOURCE = 'src/pages/set-workspace/page.tsx';

const TID = '64b8000000000000000000a1';
const NOW_ISO = '2026-10-18T06:00:00.000Z';
const STARTED_AT = '2026-10-18T05:00:00.000Z';
const TRUE_FALSE_PID = 1001;
const SINGLE_PID = 1002;
const PAPER_FINALIZE = `/paper/${TID}/finalize`;
const HOMEWORK_HAND_IN = `/homework/${TID}/round/hand-in`;

type WorkspacePage = () => ReactElement;
type WorkspaceKind = 'homework' | 'paper';

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

function objectiveItem(pid: number, label: string, kind: WsItem['kind'], title: string): WsItem {
  return {
    pid,
    label,
    title,
    kind,
    score: 5,
    state: 'empty',
    submits: 0,
    lastScore: null,
  };
}

function objectiveGroup(kind: WsGroup['kind'], no: number, name: string, item: WsItem): WsGroup {
  return {
    kind, no, name, scoreEach: 5, items: [item],
  };
}

function groups(): WsGroup[] {
  return [
    objectiveGroup('true_false', 1, '判断题', objectiveItem(TRUE_FALSE_PID, '1-1', 'true_false', '栈是后进先出')),
    objectiveGroup('single', 2, '单选题', objectiveItem(SINGLE_PID, '2-1', 'single', '队列和栈')),
  ];
}

function objectivePayload(item: WsItem): Record<string, unknown> {
  const question: Record<string, unknown> = {
    key: 'main',
    kind: 'single',
    score: item.score,
    prompt: '作答',
    choices: item.kind === 'true_false' ? ['正确', '错误'] : ['队列', '栈'],
  };
  if (item.kind === 'true_false') question.presentation = 'truefalse';
  return {
    docId: `doc-${item.pid}`,
    pid: item.pid,
    title: item.title,
    content: `${item.title}的题面`,
    config: { type: 'objective', questions: [question] },
  };
}

function workspace(kind: WorkspaceKind, finalize: string): SetWorkspace {
  const overview = kind === 'homework' ? `/homework/${TID}` : `/paper/${TID}`;
  const rows = groups();
  return {
    kind,
    codePolicy: 'highest',
    officialRound: { id: 'round-1', roundNo: 1, startedAt: NOW_ISO, closedAt: null },
    flavor: kind,
    tid: TID,
    title: kind === 'homework' ? '第三次作业' : '期中机考工作台',
    description: '',
    mode: 'browser',
    phase: 'answering',
    locked: null,
    numbering: 'pta',
    window: {
      beginAt: '2026-10-18T08:00:00+08:00',
      endAt: '2026-10-22T23:59:00+08:00',
      dueAt: kind === 'homework' ? '2026-10-20T23:59:00+08:00' : null,
      durationMinutes: null,
      startAt: STARTED_AT,
      personalEndAt: null,
      lockAt: null,
    },
    groups: rows,
    totals: {
      problemCount: 2,
      maxScore: 10,
      answered: 0,
      score: 0,
      accepted: null,
      showScore: true,
    },
    verdictVisible: true,
    objectiveVerdictVisible: true,
    team: null,
    paper: kind === 'paper' ? {
      score: null,
      passed: null,
      judging: false,
      passScore: 60,
      attemptLimit: null,
      attemptsUsed: 0,
      canRetake: false,
      submitByKind: false,
      lockedKinds: [],
    } : null,
    announcements: [],
    clarifications: [],
    info: [],
    student: { name: '张三', studentId: '2024010203' },
    action: {
      canStart: false,
      canFinalize: true,
      canAttend: false,
      canUnrank: false,
      canSubmit: true,
      attended: true,
      canRetake: false,
    },
    urls: {
      saveAnswers: `${overview}/round/save`,
      back: '/problem-sets',
      manage: null,
      overview,
      problem: null,
      submit: kind === 'paper' ? null : `/p/__PID__/submit?tid=${TID}`,
      submitCode: kind === 'paper' ? `/paper/${TID}/submit-code/__PID__` : null,
      recordDetail: `/record/__RID__?tid=${TID}`,
      records: `/record?tid=${TID}&uidOrName=7`,
      ranking: null,
      clarify: null,
      print: null,
      start: null,
      attend: null,
      draftList: null,
      draftUpsert: null,
      submitKind: kind === 'homework' ? `/homework/${TID}/submit-kind` : null,
      lockKind: null,
      finalize,
      virtual: null,
      practice: null,
      teamProblem: null,
      pretest: null,
    },
  };
}

function pageData(ws: SetWorkspace): Record<string, unknown> {
  const problems: Record<string, unknown> = {};
  for (const group of ws.groups) {
    for (const item of group.items) problems[String(item.pid)] = objectivePayload(item);
  }
  return { workspace: ws, workspaceProblems: problems, langRange: { 'py.py3': 'Python 3' } };
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

async function openAt(kind: WorkspaceKind, finalize: string): Promise<SetWorkspace> {
  const Page = await loadPage();
  const ws = workspace(kind, finalize);
  restoreLocation();
  restoreLocation = installLocation('?section=problems&kind=single');
  const bootstrap = bootstrapFor(pageData(ws));
  window.__KRYPTON_BOOTSTRAP__ = bootstrap;
  render(
    <BootstrapProvider bootstrap={bootstrap}>
      <Page />
    </BootstrapProvider>,
  );
  return ws;
}

function choiceInput(letter: string): HTMLInputElement {
  const node = document.querySelector(`input[type="radio"][value="${letter}"]`);
  if (!(node instanceof HTMLInputElement)) throw new TypeError(`missing choice ${letter}`);
  return node;
}

function expectNoWrites(): void {
  expect(transport.postForm).not.toHaveBeenCalled();
  expect(transport.postJson).not.toHaveBeenCalled();
}

async function editSingle(kind: WorkspaceKind, finalize: string): Promise<SetWorkspace> {
  const ws = await openAt(kind, finalize);
  const idle = await screen.findByRole('button', { name: /保存本题型答案/ });
  expect(idle).toHaveTextContent('保存本题型答案');
  expect(idle).toBeDisabled();
  fireEvent.click(choiceInput('B'));
  const pending = screen.getByRole('button', { name: /保存本题型答案/ });
  expect(pending).toHaveTextContent('保存本题型答案（1 道）');
  expect(pending).toBeEnabled();
  expect(choiceInput('B').checked).toBe(true);
  expectNoWrites();
  return ws;
}

function kindLink(name: RegExp): HTMLElement {
  const column = screen.getByRole('complementary', { name: '题目总览' });
  return within(column).getByRole('link', { name });
}

beforeEach(() => {
  localStorage.clear();
  transport.getJson.mockReset();
  transport.postForm.mockReset();
  transport.postJson.mockReset();
  transport.getJson.mockResolvedValue({ drafts: [] });
  transport.postForm.mockResolvedValue({});
  transport.postJson.mockResolvedValue({});
  restoreLocation();
  restoreLocation = installLocation('?section=problems&kind=single');
});

afterEach(() => {
  restoreLocation();
  restoreLocation = (): void => undefined;
  localStorage.clear();
  delete window.__KRYPTON_BOOTSTRAP__;
});

describe('unsaved objective kind navigation and hand-in', () => {
  it('keeps the page and blocks hand-in when input changes during save-and-switch', async () => {
    await editSingle('paper', PAPER_FINALIZE);
    const pending = Promise.withResolvers<Record<string, unknown>>();
    transport.postJson.mockReturnValueOnce(pending.promise);
    fireEvent.click(kindLink(/判断题/));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '保存并切换' }));
    expect(choiceInput('A')).toBeEnabled();
    fireEvent.click(choiceInput('A'));
    await act(async () => { pending.resolve({ changed: [SINGLE_PID], unchanged: [], versions: { [SINGLE_PID]: 1 } }); });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('本次答案已保存，后续修改尚未保存，请再次点击保存。');
    expect(choiceInput('A').checked).toBe(true);
    expect(transport.postJson).toHaveBeenCalledTimes(1);
    expect(locationAssign()).not.toHaveBeenCalled();
    expect(transport.postJson.mock.calls[0]?.[1].items).toEqual([{ pid: SINGLE_PID, body: { main: 'B' }, baseVersion: 0 }]);

    fireEvent.click(within(dialog).getByRole('button', { name: '继续作答' }));
    fireEvent.click(screen.getByRole('button', { name: '交卷' }));
    const handIn = await screen.findByRole('dialog');
    fireEvent.click(within(handIn).getByRole('button', { name: '交卷' }));
    await act(async () => { await Promise.resolve(); });
    expect(within(handIn).getByRole('alert')).toHaveTextContent('还有未保存的修改');
    expect(choiceInput('A').checked).toBe(true);
    expect(transport.postJson).toHaveBeenCalledTimes(1);
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(locationAssign()).not.toHaveBeenCalled();
  });

  it('shows save, discard, and stay when leaving a kind with unsaved answers', async () => {
    await editSingle('paper', PAPER_FINALIZE);
    const nextKind = kindLink(/判断题/);
    expect(nextKind.getAttribute('href')).toContain('kind=true_false');
    fireEvent.click(nextKind);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: '还有未保存的答案' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '保存并切换' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: '放弃修改并切换' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: '继续作答' })).toBeEnabled();

    fireEvent.click(within(dialog).getByRole('button', { name: '继续作答' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(choiceInput('B').checked).toBe(true);
    expect(screen.getByText('队列和栈的题面')).toBeInTheDocument();
    expectNoWrites();
    expect(locationAssign()).not.toHaveBeenCalled();
  });

  it('posts only the round identity to the projected finalize URL after explicit discard', async () => {
    const ws = await editSingle('paper', PAPER_FINALIZE);
    fireEvent.click(screen.getByRole('button', { name: '交卷' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: '交卷？' })).toBeInTheDocument();
    const discard = within(dialog).getByRole('button', { name: '放弃并交卷' });
    expect(discard).toBeEnabled();

    fireEvent.click(within(dialog).getByRole('button', { name: '交卷' }));
    await act(async () => {
      await Promise.resolve();
    });
    expectNoWrites();
    expect(choiceInput('B').checked).toBe(true);
    expect(locationAssign()).not.toHaveBeenCalled();

    fireEvent.click(discard);
    await waitFor(() => {
      expect(transport.postJson).toHaveBeenCalledTimes(1);
    });
    const call = transport.postJson.mock.calls[0];
    if (!call) throw new TypeError('missing finalize post');
    const [path, body] = call;
    expect(path).toBe(PAPER_FINALIZE);
    expect(body).toEqual({ roundId: 'round-1' });
    expect(transport.postForm).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(choiceInput('B').checked).toBe(false);
    });
    expect(locationAssign()).toHaveBeenCalledTimes(1);
    expect(locationAssign()).toHaveBeenCalledWith(sectionHref(ws, 'overview'));
  });

  it('discards unsaved answers and posts only the hand-in url', async () => {
    const ws = await editSingle('homework', HOMEWORK_HAND_IN);
    fireEvent.click(screen.getByRole('button', { name: '交卷' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '交卷' }));
    await act(async () => {
      await Promise.resolve();
    });
    expectNoWrites();

    fireEvent.click(within(dialog).getByRole('button', { name: '放弃并交卷' }));
    await waitFor(() => {
      expect(transport.postJson).toHaveBeenCalledTimes(1);
    });
    expect(transport.postJson).toHaveBeenCalledWith(HOMEWORK_HAND_IN, { roundId: 'round-1' }, '交卷失败。');
    expect(transport.postForm).not.toHaveBeenCalled();
    const posted = transport.postJson.mock.calls[0]?.[1];
    expect(posted).toEqual({ roundId: 'round-1' });
    expect(JSON.stringify(posted)).not.toContain(String(SINGLE_PID));
    expect(JSON.stringify(posted)).not.toContain('栈');
    await waitFor(() => {
      expect(locationAssign()).toHaveBeenCalledWith(sectionHref(ws, 'overview'));
    });
    expect(choiceInput('B').checked).toBe(false);
  });

  it('allows explicit discard and hand-in after the server confirms a save was rejected', async () => {
    const ws = await editSingle('homework', HOMEWORK_HAND_IN);
    transport.postJson.mockImplementation(async (path) => path.endsWith('/round/save')
      ? { accepted: false, error: { message: '答案已在其他页面更新，请先查看最新答案。' } }
      : {});
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案（1 道）' }));
    await waitFor(() => expect(transport.postJson).toHaveBeenCalledTimes(1));
    await screen.findByText('答案已在其他页面更新，请先查看最新答案。');
    expect(choiceInput('B').checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '交卷' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '放弃并交卷' }));
    await waitFor(() => expect(locationAssign()).toHaveBeenCalledWith(sectionHref(ws, 'overview')));
    expect(transport.postJson).toHaveBeenLastCalledWith(HOMEWORK_HAND_IN, { roundId: 'round-1' }, '交卷失败。');
  });
});
