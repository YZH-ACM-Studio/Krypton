// A static import fails collection while src/pages/set-workspace/program-page.tsx is absent.
import type { ProblemKind } from '@hydrooj/common';
import { EditorView } from '@codemirror/view';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { sectionHref } from '../../src/pages/set-workspace/model.ts';
import type {
  DraftMap,
  SetWorkspace,
  WorkspaceProblem,
  WsAction,
  WsGroup,
  WsItem,
  WsPaper,
  WsTotals,
  WsUrls,
  WsWindow,
} from '../../src/pages/set-workspace/model.ts';

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

const pageLoaders = import.meta.glob('../../src/pages/set-workspace/program-page.tsx');
const PAGE_SOURCE = 'src/pages/set-workspace/program-page.tsx';

const TID = '64b8000000000000000000a1';
const CODE = 'int main(){return 0;}';
const RID = 'r-program-1';
const STATEMENT = '给定一张无向图，求最短路条数。';
const HOMEWORK_STATEMENT = '括号匹配的题面正文';
const EMPTY_MARK = '\u2014';
const DEFERRED = '已提交，结束后公布成绩';
const COLUMN_LABEL = '收起或展开题目总览';
const LANG_LABEL = '编程语言';
const BOTH_LANGS: Record<string, string> = { 'cc.cc17': 'C++17', 'py.py3': 'Python 3' };

type User = ReturnType<typeof userEvent.setup>;

interface ProgramPageProps {
  ws: SetWorkspace;
  item: WsItem;
  problems: Map<number, WorkspaceProblem>;
  langRange: Record<string, string>;
  drafts?: DraftMap;
  onDraftsChange?: (drafts: DraftMap) => void;
}

interface WorkspaceOverrides extends Omit<Partial<SetWorkspace>, 'action' | 'urls' | 'totals' | 'window'> {
  action?: Partial<WsAction>;
  urls?: Partial<WsUrls>;
  totals?: Partial<WsTotals>;
  window?: Partial<WsWindow>;
}

interface JsonCall {
  path: string;
  body: Record<string, unknown>;
  fallback: string;
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

function asFunction<Fn extends (...args: never[]) => unknown>(value: unknown, key: string): Fn {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as Fn;
}

async function loadProgramPage(): Promise<(props: ProgramPageProps) => ReactElement> {
  let load: unknown;
  for (const [key, candidate] of Object.entries(pageLoaders)) {
    if (key.endsWith(PAGE_SOURCE)) load = candidate;
  }
  expect(typeof load, `${PAGE_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${PAGE_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${PAGE_SOURCE} must be a module`);
  return asFunction<(props: ProgramPageProps) => ReactElement>(readField(imported, 'ProgramProblemPage'), 'ProgramProblemPage');
}

function bootstrap(): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-18T06:00:00.000Z',
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
    urls: { home: '/', recordDetail: '/record/__RID__' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'set_workspace.html', data: {} },
  };
}

function baseUrls(overview: string): WsUrls {
  return {
    back: '/problem-sets',
    manage: null,
    overview,
    problem: null,
    submit: `/p/__PID__/submit?tid=${TID}`,
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
    pretest: `/p/__PID__/submit?tid=${TID}`,
  };
}

function workspace(overrides: WorkspaceOverrides = {}): SetWorkspace {
  const kind = overrides.kind ?? 'homework';
  const overview = kind === 'paper' ? `/paper/${TID}` : kind === 'contest' ? `/contest/${TID}` : `/homework/${TID}`;
  const baseWindow: WsWindow = {
    beginAt: '2026-10-18T08:00:00+08:00',
    endAt: '2026-10-20T23:59:00+08:00',
    dueAt: kind === 'homework' ? '2026-10-20T23:59:00+08:00' : null,
    durationMinutes: null,
    startAt: null,
    personalEndAt: null,
    lockAt: null,
  };
  const baseTotals: WsTotals = {
    problemCount: 2,
    maxScore: 100,
    answered: 0,
    score: 0,
    accepted: 0,
    showScore: true,
  };
  const baseAction: WsAction = {
    canStart: false,
    canFinalize: false,
    canAttend: false,
    canUnrank: false,
    canSubmit: true,
    attended: true,
    canRetake: false,
  };
  return {
    kind,
    codePolicy: overrides.codePolicy ?? (overrides.officialRound === undefined ? undefined : 'highest'),
    officialRound: overrides.officialRound,
    flavor: overrides.flavor ?? (kind === 'contest' ? 'acm' : kind),
    tid: TID,
    title: '工作台',
    description: '',
    mode: overrides.mode ?? 'browser',
    phase: overrides.phase ?? 'answering',
    locked: overrides.locked === undefined ? null : overrides.locked,
    numbering: overrides.numbering ?? (kind === 'contest' ? 'letter' : 'pta'),
    window: { ...baseWindow, ...overrides.window },
    groups: overrides.groups ?? [],
    totals: { ...baseTotals, ...overrides.totals },
    verdictVisible: overrides.verdictVisible ?? true,
    objectiveVerdictVisible: overrides.objectiveVerdictVisible ?? true,
    team: null,
    paper: overrides.paper === undefined ? null : overrides.paper,
    announcements: [],
    clarifications: [],
    info: [],
    student: { name: '张三', studentId: '2024010203' },
    action: { ...baseAction, ...overrides.action },
    urls: { ...baseUrls(overview), ...overrides.urls },
  };
}

function item(pid: number, overrides: Partial<WsItem> = {}): WsItem {
  return {
    pid,
    label: `7-${pid}`,
    title: `题目 ${pid}`,
    kind: 'programming',
    score: 25,
    state: 'empty',
    submits: 0,
    lastScore: null,
    ...overrides,
  };
}

function groupOf(kind: ProblemKind, name: string, items: WsItem[], no: number | null): WsGroup {
  return { kind, no, name, scoreEach: items[0]?.score ?? null, items };
}

function problemOf(pid: number, content: string, config: Record<string, unknown> = { type: 'programming' }, extra: Record<string, unknown> = {}): WorkspaceProblem {
  return {
    title: `题目 ${pid}`,
    content,
    questions: null,
    programKind: 'programming',
    raw: {
      docId: pid,
      pid,
      title: `题目 ${pid}`,
      content,
      config,
      ...extra,
    },
  };
}

function statementView(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    locale: 'zh-CN',
    description: { state: 'present', content: '删除链表的描述' },
    input: { state: 'absent', content: '' },
    output: { state: 'absent', content: '' },
    limits: { complete: true },
    ...extra,
  };
}

function paperFacts(): WsPaper {
  return {
    score: null,
    passed: null,
    judging: false,
    passScore: null,
    attemptLimit: null,
    attemptsUsed: 0,
    canRetake: false,
    submitByKind: false,
    lockedKinds: [],
  };
}

function recordBody(status: number, score: number): Record<string, unknown> {
  return { rdoc: { status, score, time: status === 1 ? 15 : 1 } };
}

function seedCode(pid: number): void {
  localStorage.setItem(`ws-code:${TID}:${pid}`, CODE);
}

function langKey(pid: number): string {
  return `ws-lang:${TID}:${pid}`;
}

type FlushFn = () => Promise<boolean>;
type RegisterFlush = (flush: FlushFn) => () => void;

function mount(
  Page: (props: ProgramPageProps) => ReactElement,
  ws: SetWorkspace,
  current: WsItem,
  problems: Map<number, WorkspaceProblem>,
  langRange: Record<string, string> = BOTH_LANGS,
) {
  const data = bootstrap();
  window.__KRYPTON_BOOTSTRAP__ = data;
  return render(
    <BootstrapProvider bootstrap={data}>
      <Page ws={ws} item={current} problems={problems} langRange={langRange} />
    </BootstrapProvider>,
  );
}

function mountRegistered(
  Page: (props: ProgramPageProps) => ReactElement,
  ws: SetWorkspace,
  current: WsItem,
  problems: Map<number, WorkspaceProblem>,
  registerFlush: RegisterFlush,
  langRange: Record<string, string> = BOTH_LANGS,
) {
  const data = bootstrap();
  window.__KRYPTON_BOOTSTRAP__ = data;
  const props = {
    ws, item: current, problems, langRange, registerFlush,
  } as ProgramPageProps;
  return render(
    <BootstrapProvider bootstrap={data}>
      <Page {...props} />
    </BootstrapProvider>,
  );
}

function replaceEditor(text: string): void {
  const content = document.querySelector('.cm-content');
  if (!(content instanceof HTMLElement)) throw new TypeError('editor is missing');
  const view = EditorView.findFromDOM(content);
  if (!view) throw new TypeError('editor view is missing');
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

async function runFlush(flush: FlushFn): Promise<boolean> {
  let saved = false;
  await act(async () => {
    saved = await flush();
  });
  return saved;
}

function paperProgram(current: WsItem): SetWorkspace {
  return workspace({
    kind: 'paper',
    flavor: 'paper',
    groups: [groupOf('programming', '编程题', [current], 7)],
    paper: paperFacts(),
    urls: {
      overview: `/paper/${TID}`,
      submit: null,
      draftUpsert: `/paper/${TID}/draft/__PID__`,
    },
  });
}

function jsonCalls(): JsonCall[] {
  return transport.postJson.mock.calls.map((call) => {
    const [path, body, fallback] = call;
    expect(fallback.length, path).toBeGreaterThan(0);
    return { path, body, fallback };
  });
}

function formCalls(): FormCall[] {
  return transport.postForm.mock.calls.map((call) => {
    const [path, body, fallback] = call;
    expect(fallback.length, path).toBeGreaterThan(0);
    if (!(body instanceof URLSearchParams)) throw new TypeError(`postForm body for ${path}`);
    return { path, body, fallback };
  });
}

function clickSubmit(): void {
  fireEvent.click(screen.getByRole('button', { name: /^提交(?:验题)?(?:\s*F10)?$/ }));
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function settle(seen: () => boolean): Promise<void> {
  await advance(0);
  for (let step = 0; step < 6 && !seen(); step += 1) {
    await advance(2000);
  }
}

function problemHead(): HTMLElement {
  const collapse = screen.getByRole('button', { name: COLUMN_LABEL });
  const next = screen.queryByRole('link', { name: '下一题' }) ?? screen.getByRole('button', { name: '下一题' });
  let node: HTMLElement | null = collapse;
  while (node && !node.contains(next)) node = node.parentElement;
  if (!node) throw new TypeError('problem header is missing');
  return node;
}

function languageTrigger(): HTMLElement {
  const trigger = screen.getAllByRole('button').find((button) => button.getAttribute('aria-haspopup') === 'true');
  if (!trigger) throw new TypeError('language menu is missing');
  return trigger;
}

async function openLanguages(user: User): Promise<void> {
  await user.click(languageTrigger());
  expect(await screen.findByLabelText(LANG_LABEL)).toBeInTheDocument();
}

function optionNames(): string[] {
  const list = screen.getByLabelText(LANG_LABEL);
  return [...list.querySelectorAll('button')].map((button) => (button.querySelector('span')?.textContent ?? '').replace(/\s+/g, ' ').trim());
}

function shows(text: string): boolean {
  return (document.body.textContent ?? '').includes(text);
}

function fetchTarget(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return '';
}

describe('program problem page', () => {
  it('shows score-only feedback without requiring or displaying a verdict', async () => {
    const Page = await loadProgramPage();
    const current = item(1001, { feedback: { score: true, verdict: false, details: false } });
    const ws = workspace({ groups: [groupOf('programming', '编程题', [current], 7)] });
    transport.getJson.mockResolvedValue({ rdoc: { score: 80, judging: false } });
    seedCode(1001);
    mount(Page, ws, current, new Map([[1001, problemOf(1001, STATEMENT)]]));
    clickSubmit();
    expect(await screen.findByText('得分 20 / 25')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Accepted')).toBeNull();
  });

  it('shows allowed score-only compiled-fill feedback in an ACM set without inventing an error verdict', async () => {
    const Page = await loadProgramPage();
    const current = item(1001, { kind: 'program_fill', label: '5-1', feedback: { score: true, verdict: false, details: false } });
    const ws = workspace({
      kind: 'contest', flavor: 'acm', officialRound: { id: 'round-1', roundNo: 1, startedAt: '2026-10-18T06:00:00Z', closedAt: null },
      groups: [groupOf('program_fill', '程序填空题', [current], 5)], urls: { submitCode: `/paper/${TID}/submit-code/__PID__` },
    });
    const problem = problemOf(1001, '填空', { type: 'program_fill', mode: 'compile', template: { lang: 'py.py3', surface: [{ type: 'code', code: 'print(' }, { type: 'region', id: 'expr', title: '表达式' }, { type: 'code', code: ')' }] } });
    transport.getJson.mockResolvedValue({ rdoc: { score: 80, judging: false } });
    mount(Page, ws, current, new Map([[1001, problem]]));
    fireEvent.change(screen.getByRole('textbox', { name: '表达式' }), { target: { value: '2' } });
    clickSubmit();
    expect(await screen.findByText('得分 20 / 25')).toBeInTheDocument();
    expect(screen.queryByText(/错误 \d+ 次/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('submits configured paper code directly with the current round and never posts a legacy draft', async () => {
    const Page = await loadProgramPage();
    const current = item(1001);
    const ws = workspace({ kind: 'paper', officialRound: { id: 'round-2', roundNo: 2, startedAt: '2026-10-18T06:00:00Z', closedAt: null }, groups: [groupOf('programming', '编程题', [current], 7)], urls: { submitCode: `/paper/${TID}/submit-code/__PID__`, draftUpsert: null } });
    seedCode(1001);
    mount(Page, ws, current, new Map([[1001, problemOf(1001, STATEMENT)]]));
    clickSubmit();
    await waitFor(() => expect(transport.postJson).toHaveBeenCalled());
    expect(transport.postJson.mock.calls[0]?.slice(0, 2)).toEqual([`/paper/${TID}/submit-code/1001`, { code: CODE, lang: 'cc.cc17', roundId: 'round-2' }]);
    expect(transport.postForm).not.toHaveBeenCalled();
  });

  it('restores and explicitly saves text program-fill answers with their version', async () => {
    const Page = await loadProgramPage();
    const current = item(1001, { kind: 'program_fill', label: '5-1' });
    const ws = workspace({ kind: 'homework', officialRound: { id: 'round-1', roundNo: 1, startedAt: '2026-10-18T06:00:00Z', closedAt: null }, groups: [groupOf('program_fill', '程序填空题', [current], 5)], urls: { saveAnswers: `/homework/${TID}/round/save` } });
    const problem = problemOf(1001, '填空', { type: 'program_fill', mode: 'text', template: { surface: [{ type: 'code', code: 'print(' }, { type: 'region', id: 'expr', title: '表达式' }, { type: 'code', code: ')' }] } });
    const onDraftsChange = vi.fn<(drafts: DraftMap) => void>();
    const draft = { answers: { expr: '1' }, submittedAnswers: { expr: '1' }, version: 4 };
    transport.postJson.mockResolvedValue({ changed: [1001], unchanged: [], versions: { 1001: 5 }, drafts: [{ pid: 1001, answers: { expr: '2' }, submittedAnswers: { expr: '2' }, version: 5 }] });
    render(<BootstrapProvider bootstrap={bootstrap()}><Page ws={ws} item={current} problems={new Map([[1001, problem]])} langRange={BOTH_LANGS} drafts={new Map([[1001, draft]])} onDraftsChange={onDraftsChange} /></BootstrapProvider>);
    expect(screen.getByRole('textbox', { name: '表达式' })).toHaveValue('1');
    expect(screen.queryByRole('button', { name: '自测' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^提交记录/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '表达式' }), { target: { value: '2' } });
    expect(screen.getByText('还有 1 道题的修改未保存')).toBeInTheDocument();
    expect(transport.postJson).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案' }));
    await waitFor(() => expect(onDraftsChange).toHaveBeenCalled());
    expect(transport.postJson.mock.calls[0]?.[1]).toMatchObject({ roundId: 'round-1', kind: 'program_fill', items: [{ pid: 1001, body: { expr: '2' }, baseVersion: 4 }] });
    expect(transport.postForm).not.toHaveBeenCalled();
  });

  it('keeps text-fill input made during saving dirty until the next explicit save over HTTP', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const Page = await loadProgramPage();
    const current = item(1001, { kind: 'program_fill', label: '5-1' });
    const ws = workspace({ kind: 'homework', officialRound: { id: 'round-1', roundNo: 1, startedAt: '2026-10-18T06:00:00Z', closedAt: null }, groups: [groupOf('program_fill', '程序填空题', [current], 5)], urls: { saveAnswers: `/homework/${TID}/round/save` } });
    const problem = problemOf(1001, '填空', { type: 'program_fill', mode: 'text', template: { surface: [{ type: 'region', id: 'expr', title: '表达式' }] } });
    const onDraftsChange = vi.fn<(drafts: DraftMap) => void>();
    const pending = Promise.withResolvers<Record<string, unknown>>();
    transport.postJson.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ versions: { 1001: 2 } });
    render(<BootstrapProvider bootstrap={bootstrap()}><Page ws={ws} item={current} problems={new Map([[1001, problem]])} langRange={BOTH_LANGS} drafts={new Map()} onDraftsChange={onDraftsChange} /></BootstrapProvider>);
    const input = screen.getByRole('textbox', { name: '表达式' });
    fireEvent.change(input, { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案' }));
    expect(input).toBeEnabled();
    expect(input).not.toHaveAttribute('readonly');
    fireEvent.change(input, { target: { value: 'B' } });
    await act(async () => { pending.resolve({ versions: { 1001: 1 }, drafts: [{ pid: 1001, answers: { expr: 'A' }, submittedAnswers: { expr: 'A' }, version: 1, score: 5 }] }); });
    expect(input).toHaveValue('B');
    expect(onDraftsChange.mock.calls[0]?.[0].get(1001)?.answers).toEqual({ expr: 'A' });
    expect(screen.getByText('还有 1 道题的修改未保存')).toBeInTheDocument();
    expect(screen.queryByText('得分 5')).toBeNull();
    expect(transport.postJson).toHaveBeenCalledTimes(1);
    expect(transport.postJson.mock.calls[0]?.[1].items).toEqual([{ pid: 1001, body: { expr: 'A' }, baseVersion: 0 }]);

    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案' }));
    await waitFor(() => expect(onDraftsChange).toHaveBeenCalledTimes(2));
    expect(transport.postJson).toHaveBeenCalledTimes(2);
    expect(transport.postJson.mock.calls[1]?.[1].items).toEqual([{ pid: 1001, body: { expr: 'B' }, baseVersion: 1 }]);
    expect(screen.getByText('本题答案已保存')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存本题型答案' })).toBeDisabled();
  });

  it('retries an unknown text-fill save without submitting newer input in the same click', async () => {
    const Page = await loadProgramPage();
    const current = item(1001, { kind: 'program_fill', label: '5-1' });
    const ws = workspace({ kind: 'homework', officialRound: { id: 'round-1', roundNo: 1, startedAt: '2026-10-18T06:00:00Z', closedAt: null }, groups: [groupOf('program_fill', '程序填空题', [current], 5)], urls: { saveAnswers: `/homework/${TID}/round/save` } });
    const problem = problemOf(1001, '填空', { type: 'program_fill', mode: 'text', template: { surface: [{ type: 'region', id: 'expr', title: '表达式' }] } });
    const pending = Promise.withResolvers<Record<string, unknown>>();
    transport.postJson.mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ versions: { 1001: 1 } })
      .mockResolvedValueOnce({ versions: { 1001: 2 } });
    render(<BootstrapProvider bootstrap={bootstrap()}><Page ws={ws} item={current} problems={new Map([[1001, problem]])} langRange={BOTH_LANGS} drafts={new Map()} onDraftsChange={vi.fn()} /></BootstrapProvider>);
    fireEvent.change(screen.getByRole('textbox', { name: '表达式' }), { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案' }));
    fireEvent.change(screen.getByRole('textbox', { name: '表达式' }), { target: { value: 'B' } });
    await act(async () => { pending.reject(new Error('响应丢失')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('响应丢失');
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存本题型答案' })).toBeEnabled());
    expect(transport.postJson).toHaveBeenCalledTimes(2);
    expect(transport.postJson.mock.calls[1]?.[1]).toEqual(transport.postJson.mock.calls[0]?.[1]);
    expect(screen.getByRole('textbox', { name: '表达式' })).toHaveValue('B');
    expect(screen.getByText('还有 1 道题的修改未保存')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案' }));
    await waitFor(() => expect(screen.getByText('本题答案已保存')).toBeInTheDocument());
    expect(transport.postJson.mock.calls[2]?.[1].operationId).not.toBe(transport.postJson.mock.calls[0]?.[1].operationId);
    expect(transport.postJson.mock.calls[2]?.[1].items).toEqual([{ pid: 1001, body: { expr: 'B' }, baseVersion: 1 }]);
  });

  it('can correct a confirmed rejected text-fill save with a new operation', async () => {
    const Page = await loadProgramPage();
    const current = item(1001, { kind: 'program_fill', label: '5-1' });
    const ws = workspace({ kind: 'homework', officialRound: { id: 'round-1', roundNo: 1, startedAt: '2026-10-18T06:00:00Z', closedAt: null }, groups: [groupOf('program_fill', '程序填空题', [current], 5)], urls: { saveAnswers: `/homework/${TID}/round/save` } });
    const problem = problemOf(1001, '填空', { type: 'program_fill', mode: 'text', template: { surface: [{ type: 'region', id: 'expr', title: '表达式' }] } });
    transport.postJson.mockResolvedValueOnce({ accepted: false, error: { message: '答案内容无效。' } }).mockResolvedValueOnce({ versions: { 1001: 1 } });
    render(<BootstrapProvider bootstrap={bootstrap()}><Page ws={ws} item={current} problems={new Map([[1001, problem]])} langRange={BOTH_LANGS} drafts={new Map()} onDraftsChange={vi.fn()} /></BootstrapProvider>);
    fireEvent.change(screen.getByRole('textbox', { name: '表达式' }), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('答案内容无效。');
    expect(screen.getByRole('textbox', { name: '表达式' })).toHaveValue('bad');
    fireEvent.change(screen.getByRole('textbox', { name: '表达式' }), { target: { value: 'good' } });
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案' }));
    await waitFor(() => expect(transport.postJson).toHaveBeenCalledTimes(2));
    expect(transport.postJson.mock.calls[1]?.[1].operationId).not.toBe(transport.postJson.mock.calls[0]?.[1].operationId);
    expect(transport.postJson.mock.calls[1]?.[1].items).toEqual([{ pid: 1001, body: { expr: 'good' }, baseVersion: 0 }]);
  });

  beforeEach(() => {
    localStorage.clear();
    transport.getJson.mockReset();
    transport.postForm.mockReset();
    transport.postJson.mockReset();
    transport.getJson.mockImplementation((path: string) => {
      if (/\/record\?/.test(path)) return Promise.resolve({ rdocs: [] });
      return Promise.resolve(recordBody(1, 0));
    });
    transport.postForm.mockResolvedValue({ ok: true });
    transport.postJson.mockResolvedValue({ rid: RID });
  });

  it.each([
    ['program_fill', 'browser'], ['function', 'browser'], ['program_fill', 'client'], ['function', 'client'],
  ] as const)('connects %s workbench pretests, samples and records in %s mode', async (kind, mode) => {
    const Page = await loadProgramPage();
    const current = item(1001, { kind });
    const ws = workspace({ mode, groups: [groupOf(kind, '代码题', [current], 5)] });
    const problem = problemOf(1001, '题面', { type: kind, mode: 'compile', template: { lang: 'c', surface: [
      { type: 'code', code: 'int solve() {' }, { type: 'region', id: 'body', title: '函数体' }, { type: 'code', code: '}' },
    ] } }, { programmingStatementView: statementView({ examples: { items: [
      { input: '1', inputEmpty: false, output: '2', outputEmpty: false, note: '' },
      { input: '3', inputEmpty: false, output: '4', outputEmpty: false, note: '' },
    ] } }) });
    transport.getJson.mockImplementation((url) => Promise.resolve(url.includes('/record?')
      ? { rdocs: [{ _id: '656f10000000000000000001', pid: 1001, status: 1, lang: 'c', score: 100 }] }
      : recordBody(1, 100)));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => new Response(JSON.stringify(
      init?.method === 'POST' ? { rid: 'selftest' } : { rdoc: { status: 1, testCases: [{ id: 1, status: 1, time: 2, memory: 128, message: '4' }] } },
    ), { headers: { 'Content-Type': 'application/json' } }));
    const view = mount(Page, ws, current, new Map([[1001, problem]]));
    if (kind === 'function') act(() => replaceEditor('return 2;'));
    else fireEvent.change(screen.getByRole('textbox', { name: '函数体' }), { target: { value: 'return 2;' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /^提交记录/ })).toHaveTextContent('1'));
    expect(screen.queryByRole('link', { name: '详情' }) !== null).toBe(mode !== 'client');
    fireEvent.click(screen.getByRole('button', { name: '收起提交记录' }));
    expect(screen.queryByRole('separator', { name: '调整题面和提交记录的高度' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^提交记录/ })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: /^提交记录/ }));
    expect(screen.getByRole('separator', { name: '调整题面和提交记录的高度' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '在自测中打开' })[1]);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText('结构化代码工作台'), { key: 'F9' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 2500 });
    expect(fetchTarget(fetchMock.mock.calls[0][0])).toBe(`/p/1001/submit?tid=${TID}`);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ lang: 'c', code: '{"body":"return 2;"}', pretest: true, input: ['3'] });
    expect(fetchTarget(fetchMock.mock.calls[1][0])).toBe(`/record/selftest?tid=${TID}`);
    expect(await screen.findByText('输出匹配')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收起提交记录' }));
    clickSubmit();
    await waitFor(() => expect(transport.postJson).toHaveBeenCalled());
    expect(transport.postJson.mock.calls[0][0]).toBe(`/p/1001/submit?tid=${TID}`);
    expect(transport.postJson.mock.calls[0][1]).toEqual({ code: '{"body":"return 2;"}', lang: 'c', tid: TID, examShell: mode === 'client' });
    expect(screen.getByRole('separator', { name: '调整题面和提交记录的高度' })).toBeInTheDocument();
    view.unmount();
  });

  it('keeps record reopening available on a read-only programming workspace', async () => {
    const Page = await loadProgramPage();
    const current = item(1001);
    const ws = workspace({ action: { canSubmit: false }, groups: [groupOf('programming', '编程题', [current], 7)] });
    mount(Page, ws, current, new Map([[1001, problemOf(1001, STATEMENT)]]));
    const split = screen.getByRole('separator', { name: '调整题面和编辑器的宽度' }).parentElement;
    expect(split?.firstElementChild).toHaveStyle({ width: '44%' });
    fireEvent.click(screen.getByRole('button', { name: '收起提交记录' }));
    fireEvent.click(screen.getByRole('button', { name: /^提交记录/ }));
    expect(screen.getByRole('separator', { name: '调整题面和提交记录的高度' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^提交(?:\s*F10)?$/ })).not.toBeInTheDocument();
  });

  afterEach(() => {
    delete window.__KRYPTON_BOOTSTRAP__;
    vi.useRealTimers();
  });

  it('disables previous on the first problem and next on the last problem', async () => {
    const Page = await loadProgramPage();
    const only = item(2001, { kind: 'function', label: '6-1', title: '删除结点' });
    const first = item(1001, { label: '7-1', title: '括号匹配' });
    const last = item(1002, { label: '7-2', title: '链表反转' });
    const ws = workspace({
      groups: [
        groupOf('function', '函数题', [only], 6),
        groupOf('programming', '编程题', [first, last], 7),
      ],
    });
    const problems = new Map<number, WorkspaceProblem>([
      [2001, problemOf(2001, '函数题面')],
      [1001, problemOf(1001, HOMEWORK_STATEMENT)],
      [1002, problemOf(1002, '链表反转的题面正文')],
    ]);

    const firstView = mount(Page, ws, first, problems);
    expect(screen.getByText(HOMEWORK_STATEMENT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一题' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '上一题' })).toHaveAttribute('data-variant', 'secondary');
    const next = screen.getByRole('link', { name: '下一题' });
    expect(next).toHaveAttribute('href', sectionHref(ws, 'problems', { q: 1002 }));
    expect(next).toHaveAttribute('data-variant', 'secondary');
    expect(next).toHaveAttribute('data-size', 'sm');
    expect(transport.getJson.mock.calls.every((call) => /\/record\?/.test(call[0]))).toBe(true);
    firstView.unmount();

    const lastView = mount(Page, ws, last, problems);
    expect(screen.getByRole('button', { name: '下一题' })).toBeDisabled();
    expect(screen.getByRole('link', { name: '上一题' })).toHaveAttribute('href', sectionHref(ws, 'problems', { q: 1001 }));
    lastView.unmount();

    mount(Page, ws, only, problems);
    expect(screen.getByRole('button', { name: '上一题' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下一题' })).toBeDisabled();
  });

  it('renders a client contest statement from the problem map and submits with examShell', async () => {
    const Page = await loadProgramPage();
    const current = item(1001, { label: 'A', title: '最短路计数', score: 100 });
    const ws = workspace({
      kind: 'contest',
      flavor: 'acm',
      codePolicy: 'acm',
      mode: 'client',
      numbering: 'letter',
      groups: [groupOf('programming', '题目', [current], null)],
      urls: {
        back: null,
        overview: `/exam-mode/${TID}`,
        problem: null,
        submit: `/p/__PID__/submit?tid=${TID}`,
      },
    });
    seedCode(1001);

    mount(Page, ws, current, new Map([[1001, problemOf(1001, STATEMENT)]]));
    expect(screen.getByText(STATEMENT)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '详情' })).not.toBeInTheDocument();
    expect(transport.getJson.mock.calls.every((call) => /\/record\?/.test(call[0]))).toBe(true);
    expect(transport.postJson).not.toHaveBeenCalled();

    clickSubmit();
    await waitFor(() => expect(transport.postJson).toHaveBeenCalled());
    const posted = jsonCalls()[0];
    if (!posted) throw new TypeError('missing submit');
    expect(posted.path).toBe(`/p/1001/submit?tid=${TID}`);
    expect(posted.path).not.toContain('__PID__');
    expect(posted.body.examShell).toBe(true);
    expect(posted.body.tid).toBe(TID);
    expect(posted.body.code).toBe(CODE);
    const problemReads = transport.getJson.mock.calls.filter((call) => !call[0].includes('/record'));
    expect(problemReads).toEqual([]);
  });

  it('saves the paper draft before submit-code', async () => {
    const Page = await loadProgramPage();
    const current = item(1001, { label: '7-1', title: '括号匹配', state: 'draft' });
    const ws = workspace({
      kind: 'paper',
      flavor: 'paper',
      verdictVisible: false,
      groups: [groupOf('programming', '编程题', [current], 7)],
      paper: paperFacts(),
      urls: {
        overview: `/paper/${TID}`,
        submit: null,
        submitCode: `/paper/${TID}/submit-code/__PID__`,
        draftList: `/paper/${TID}/draft`,
        draftUpsert: `/paper/${TID}/draft/__PID__`,
        finalize: `/paper/${TID}/finalize`,
      },
    });
    seedCode(1001);
    transport.postForm.mockImplementation(async (path) => {
      if (path.includes('/submit-code/')) return { rid: RID };
      return { ok: true, updatedAt: '2026-10-18T06:00:00.000Z' };
    });
    transport.getJson.mockImplementation((path: string) => {
      if (/\/record\?/.test(path)) {
        return Promise.resolve({
          rdocs: [{ _id: '656f00000000000000000001', pid: 1001, status: 1, score: 100 }],
        });
      }
      return Promise.resolve(recordBody(1, 0));
    });

    mount(Page, ws, current, new Map([[1001, problemOf(1001, HOMEWORK_STATEMENT)]]));
    expect(screen.getByText(HOMEWORK_STATEMENT)).toBeInTheDocument();
    const before = transport.postForm.mock.calls.length;
    clickSubmit();
    await waitFor(() => {
      const posted = formCalls().slice(before);
      expect(posted.some((call) => call.path === `/paper/${TID}/submit-code/1001`)).toBe(true);
    });
    const posted = formCalls().slice(before);
    const codeAt = posted.findIndex((call) => call.path === `/paper/${TID}/submit-code/1001`);
    expect(codeAt).toBeGreaterThan(0);
    const draft = posted[codeAt - 1];
    if (!draft) throw new TypeError('missing draft upsert');
    expect(draft.path).toBe(`/paper/${TID}/draft/1001`);
    expect(draft.path).not.toContain('__PID__');
    expect(draft.body.get('code')).toBe(CODE);
    expect(typeof draft.body.get('lang')).toBe('string');
    expect(draft.body.get('lang')?.length).toBeGreaterThan(0);
    expect(transport.postJson).not.toHaveBeenCalled();
    expect(await screen.findByText('Accepted')).toBeInTheDocument();
    expect(screen.queryByText(DEFERRED)).not.toBeInTheDocument();
    expect(screen.queryByText('还没提交')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^提交记录/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '详情' })).toHaveAttribute('href', `/record/656f00000000000000000001?tid=${TID}`);
    expect(document.body.textContent ?? '').not.toContain('提交后马上评测');
    expect(screen.getByRole('button', { name: '自测' })).toBeInTheDocument();
  });

  it('polls the record and shows the verdict', async () => {
    const Page = await loadProgramPage();
    vi.useFakeTimers();
    const current = item(1001, { label: '7-1', title: '括号匹配', score: 100 });
    const ws = workspace({ groups: [groupOf('programming', '编程题', [current], 7)] });
    seedCode(1001);
    let polls = 0;
    transport.postJson.mockResolvedValue({ rid: RID });
    transport.getJson.mockImplementation(() => {
      polls += 1;
      if (polls === 1) return Promise.resolve(recordBody(20, 0));
      return Promise.resolve(recordBody(1, 100));
    });

    mount(Page, ws, current, new Map([[1001, problemOf(1001, HOMEWORK_STATEMENT)]]));
    clickSubmit();
    await settle(() => shows('Accepted'));

    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(polls).toBeGreaterThanOrEqual(2);
    expect(transport.getJson.mock.calls.some((call) => call[0] === `/record/${RID}?tid=${TID}`)).toBe(true);
    expect(transport.getJson.mock.calls.every((call) => !call[0].includes('__RID__'))).toBe(true);
    const fallback = transport.getJson.mock.calls[0]?.[1];
    expect(typeof fallback).toBe('string');
    expect(fallback?.length).toBeGreaterThan(0);
  });

  it('hides the submit button in preview when verify submit is empty', async () => {
    const Page = await loadProgramPage();
    const current = item(1001, { label: '7-1', title: '括号匹配' });
    for (const verifySubmit of [null, ''] as const) {
      const ws = workspace({
        mode: 'preview',
        action: { canSubmit: false },
        groups: [groupOf('programming', '编程题', [current], 7)],
        urls: { verifySubmit },
      });
      const view = mount(Page, ws, current, new Map([[1001, problemOf(1001, HOMEWORK_STATEMENT)]]));
      expect(screen.getByText(HOMEWORK_STATEMENT)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^提交验题/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '提交' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: '提交' })).not.toBeInTheDocument();
      expect(document.querySelector('.cm-content')).toHaveAttribute('contenteditable', 'false');
      expect(transport.postJson).not.toHaveBeenCalled();
      expect(transport.postForm).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it('shows the verify submit button in preview when verify submit is set', async () => {
    const Page = await loadProgramPage();
    const current = item(1001, { label: '7-1', title: '括号匹配' });
    const ws = workspace({
      mode: 'preview',
      action: { canSubmit: false },
      groups: [groupOf('programming', '编程题', [current], 7)],
      urls: { verifySubmit: `/teach/homework/${TID}/verify/submit` },
    });

    mount(Page, ws, current, new Map([[1001, problemOf(1001, HOMEWORK_STATEMENT)]]));
    expect(screen.getByText(HOMEWORK_STATEMENT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^提交验题/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^提交(?:\s*F10)?$/ })).not.toBeInTheDocument();
    expect(document.querySelector('.cm-content')).toHaveAttribute('contenteditable', 'true');
  });

  it('renders a statement background that has no state', async () => {
    const Page = await loadProgramPage();
    const current = item(1001, { label: '7-1', title: '删除链表结点' });
    const ws = workspace({ groups: [groupOf('programming', '编程题', [current], 7)] });
    const view = statementView({
      background: { content: '背景' },
      hints: { content: '这是提示' },
    });

    mount(Page, ws, current, new Map([[1001, problemOf(1001, '普通 markdown 题面', { type: 'programming' }, { programmingStatementView: view })]]));
    expect(screen.getByRole('heading', { name: '题目背景' })).toBeInTheDocument();
    expect(screen.getByText('背景', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('这是提示')).toBeInTheDocument();
    expect(screen.getByText('删除链表的描述')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/invalid/i);
  });

  it('drags the statement width and the submission history height', async () => {
    const Page = await loadProgramPage();
    const current = item(1001, { label: '7-1', title: '括号匹配' });
    const ws = workspace({ groups: [groupOf('programming', '编程题', [current], 7)] });
    mount(Page, ws, current, new Map([[1001, problemOf(1001, HOMEWORK_STATEMENT)]]));
    const widthHandle = screen.getByRole('separator', { name: '调整题面和编辑器的宽度' });
    const heightHandle = screen.getByRole('separator', { name: '调整题面和提交记录的高度' });
    const split = widthHandle.parentElement;
    const column = heightHandle.parentElement;
    if (!split || !column) throw new TypeError('split handle is missing its pane');
    const box = (width: number, height: number): DOMRect => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width,
      height,
      right: width,
      bottom: height,
      toJSON: () => ({}),
    });
    vi.spyOn(split, 'getBoundingClientRect').mockReturnValue(box(1000, 800));
    fireEvent.mouseDown(widthHandle);
    fireEvent.mouseMove(document, { clientX: 300, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 350, clientY: 10 });
    fireEvent.mouseUp(document);
    expect(split.querySelector('.krypton-split-pane')).toHaveStyle({ width: '35%' });

    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue(box(300, 800));
    fireEvent.mouseDown(heightHandle);
    fireEvent.mouseMove(document, { clientX: 10, clientY: 200 });
    fireEvent.mouseUp(document);
    expect(column.firstElementChild).toHaveStyle({ height: '25%' });
  });

  it('offers only config.langs and submits that language', async () => {
    const Page = await loadProgramPage();
    const user = userEvent.setup();
    const current = item(1001, { label: '7-1', title: '括号匹配' });
    const ws = workspace({ groups: [groupOf('programming', '编程题', [current], 7)] });
    seedCode(1001);

    mount(Page, ws, current, new Map([[1001, problemOf(1001, HOMEWORK_STATEMENT, { type: 'programming', langs: ['py.py3'] })]]));
    expect(languageTrigger()).toHaveTextContent('Python (py3)');
    expect(languageTrigger()).not.toHaveTextContent('C++17');
    await openLanguages(user);
    expect(optionNames()).toEqual(['Python (py3)']);
    await user.keyboard('{Escape}');
    clickSubmit();
    await waitFor(() => expect(transport.postJson).toHaveBeenCalled());
    const posted = jsonCalls()[0];
    if (!posted) throw new TypeError('missing submit');
    expect(posted.body.lang).toBe('py.py3');
    expect(posted.body.code).toBe(CODE);
  });

  it('offers every langRange language when config.langs is absent', async () => {
    const Page = await loadProgramPage();
    const user = userEvent.setup();
    const current = item(1001, { label: '7-1', title: '括号匹配' });
    const ws = workspace({ groups: [groupOf('programming', '编程题', [current], 7)] });

    mount(Page, ws, current, new Map([[1001, problemOf(1001, HOMEWORK_STATEMENT, { type: 'programming' })]]));
    await openLanguages(user);
    expect(optionNames()).toEqual(['C++17', 'Python (py3)']);
  });

  it('restores a saved language and ignores a language outside the options', async () => {
    const Page = await loadProgramPage();
    const user = userEvent.setup();
    const current = item(1001, { label: '7-1', title: '括号匹配' });
    const ws = workspace({ groups: [groupOf('programming', '编程题', [current], 7)] });
    const problems = new Map<number, WorkspaceProblem>([[1001, problemOf(1001, HOMEWORK_STATEMENT, { type: 'programming' })]]);

    const first = mount(Page, ws, current, problems);
    expect(languageTrigger()).toHaveTextContent('C++17');
    await openLanguages(user);
    await user.click(screen.getByRole('button', { name: /Python \(py3\)/ }));
    expect(localStorage.getItem(langKey(1001))).toBe('py.py3');
    expect(languageTrigger()).toHaveTextContent('Python (py3)');
    first.unmount();

    const restored = mount(Page, ws, current, problems);
    expect(languageTrigger()).toHaveTextContent('Python (py3)');
    expect(languageTrigger()).not.toHaveTextContent('C++17');
    restored.unmount();

    localStorage.setItem(langKey(1001), 'cc.cc17');
    const restricted = new Map<number, WorkspaceProblem>([
      [1001, problemOf(1001, HOMEWORK_STATEMENT, { type: 'programming', langs: ['py.py3'] })],
    ]);
    mount(Page, ws, current, restricted);
    expect(languageTrigger()).toHaveTextContent('Python (py3)');
    expect(languageTrigger()).not.toHaveTextContent('C++17');
  });

  it('shows the deferred result when the submit response has no rid', async () => {
    const Page = await loadProgramPage();
    const current = item(1001, { label: '7-1', title: '括号匹配', score: 100 });
    const ws = workspace({ groups: [groupOf('programming', '编程题', [current], 7)] });
    seedCode(1001);
    transport.postJson.mockResolvedValue({ tid: TID, url: `/homework/${TID}` });

    mount(Page, ws, current, new Map([[1001, problemOf(1001, HOMEWORK_STATEMENT)]]));
    clickSubmit();
    await waitFor(() => expect(transport.postJson).toHaveBeenCalled());
    expect(document.body).toHaveTextContent(DEFERRED);
    expect(transport.getJson.mock.calls.every((call) => /\/record\?/.test(call[0]))).toBe(true);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows statement time and memory in the header when config has neither', async () => {
    const Page = await loadProgramPage();
    const current = item(1001, { label: '7-1', title: '括号匹配' });
    const ws = workspace({ groups: [groupOf('programming', '编程题', [current], 7)] });
    const view = statementView({
      description: { state: 'present', content: '有时空限制的题面' },
      limits: { complete: true, time: '1s', memory: '256m' },
    });

    mount(Page, ws, current, new Map([[1001, problemOf(1001, '题面正文', { type: 'programming' }, { programmingStatementView: view })]]));
    const head = problemHead();
    expect(head.textContent).toContain('1s');
    expect(head.textContent).toContain('256m');
    const limitsHeading = screen.getByRole('heading', { name: '时空限制' });
    const limitsSection = limitsHeading.closest('section');
    expect(limitsSection).not.toBeNull();
    expect(limitsSection?.textContent).toContain('1s');
    expect(limitsSection?.textContent).toContain('256m');
    expect(limitsSection?.textContent ?? '').not.toContain(EMPTY_MARK);
  });

  it('omits the empty-limit dash when neither source has limits', async () => {
    const Page = await loadProgramPage();
    const current = item(1001, { label: '7-1', title: '括号匹配' });
    const ws = workspace({ groups: [groupOf('programming', '编程题', [current], 7)] });
    const view = statementView({
      description: { state: 'present', content: '没有时空限制的题面' },
      limits: { complete: true },
    });

    mount(Page, ws, current, new Map([[1001, problemOf(1001, '没有限制的题面', { type: 'programming' }, { programmingStatementView: view })]]));
    expect(screen.getByText('没有时空限制的题面')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain(EMPTY_MARK);
  });

  it('scales a perfect record onto a 25-point problem', async () => {
    const Page = await loadProgramPage();
    vi.useFakeTimers();
    const current = item(1001, { label: '7-1', title: '括号匹配', score: 25 });
    const ws = workspace({ groups: [groupOf('programming', '编程题', [current], 7)] });
    seedCode(1001);
    transport.getJson.mockResolvedValue(recordBody(1, 100));

    mount(Page, ws, current, new Map([[1001, problemOf(1001, HOMEWORK_STATEMENT)]]));
    clickSubmit();
    await settle(() => shows('得分 25 / 25'));
    expect(document.body).toHaveTextContent('得分 25 / 25');
    expect(document.body).not.toHaveTextContent('得分 100 / 25');
  });

  it('scales an 80-point record onto a 100-point problem', async () => {
    const Page = await loadProgramPage();
    vi.useFakeTimers();
    const current = item(1001, { label: '7-1', title: '括号匹配', score: 100 });
    const ws = workspace({ groups: [groupOf('programming', '编程题', [current], 7)] });
    seedCode(1001);
    transport.getJson.mockResolvedValue(recordBody(1, 80));

    mount(Page, ws, current, new Map([[1001, problemOf(1001, HOMEWORK_STATEMENT)]]));
    clickSubmit();
    await settle(() => shows('得分 80 / 100'));
    expect(document.body).toHaveTextContent('得分 80 / 100');
  });

  it('dispatches ws-storage when the overview column toggles', async () => {
    const Page = await loadProgramPage();
    const current = item(1001, { label: '7-1', title: '括号匹配' });
    const ws = workspace({ groups: [groupOf('programming', '编程题', [current], 7)] });
    const details: unknown[] = [];
    const onStorage: EventListener = (event) => {
      if (!(event instanceof CustomEvent)) {
        details.push(event.type);
        return;
      }
      details.push(Reflect.get(event, 'detail') as unknown);
    };
    window.addEventListener('ws-storage', onStorage);

    try {
      mount(Page, ws, current, new Map([[1001, problemOf(1001, HOMEWORK_STATEMENT)]]));
      const toggle = screen.getByRole('button', { name: COLUMN_LABEL });
      fireEvent.click(toggle);
      expect(details).toEqual([{ key: `ws-col:${TID}`, value: '1' }]);
      expect(localStorage.getItem(`ws-col:${TID}`)).toBe('1');
      fireEvent.click(toggle);
      expect(details).toEqual([
        { key: `ws-col:${TID}`, value: '1' },
        { key: `ws-col:${TID}`, value: null },
      ]);
      expect(localStorage.getItem(`ws-col:${TID}`)).toBeNull();
    } finally {
      window.removeEventListener('ws-storage', onStorage);
    }
  });

  it('counts consecutive wrong answers from zero on this page', async () => {
    const Page = await loadProgramPage();
    vi.useFakeTimers();
    const current = item(1001, { label: 'A', title: '最短路计数', score: 0, submits: 0 });
    const ws = workspace({
      kind: 'contest',
      flavor: 'acm',
      codePolicy: 'acm',
      mode: 'browser',
      numbering: 'letter',
      groups: [groupOf('programming', '题目', [current], null)],
      urls: { overview: `/contest/${TID}`, problem: null },
    });
    seedCode(1001);
    let submits = 0;
    transport.postJson.mockImplementation(async () => {
      submits += 1;
      return { rid: `r-wa-${submits}` };
    });
    transport.getJson.mockResolvedValue(recordBody(2, 0));

    mount(Page, ws, current, new Map([[1001, problemOf(1001, STATEMENT)]]));
    expect(screen.getByText(STATEMENT)).toBeInTheDocument();
    clickSubmit();
    await settle(() => shows('错误 1 次'));
    expect(document.body).toHaveTextContent('错误 1 次');
    expect(document.body).not.toHaveTextContent('错误 2 次');

    clickSubmit();
    await settle(() => shows('错误 2 次'));
    expect(document.body).toHaveTextContent('错误 2 次');
    expect(submits).toBe(2);
  });

  it('shows the failure alert when the problem is missing', async () => {
    const Page = await loadProgramPage();
    const current = item(1001, { label: '7-1', title: '括号匹配' });
    const ws = workspace({ groups: [groupOf('programming', '编程题', [current], 7)] });

    mount(Page, ws, current, new Map());
    expect(screen.getByRole('alert')).toHaveTextContent('题面加载失败，请刷新页面。');
    expect(transport.getJson).not.toHaveBeenCalled();
  });

  it('registers one flush and does not send the pending paper code draft', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const Page = await loadProgramPage();
    const registered: FlushFn[] = [];
    const unregister = vi.fn<() => void>();
    const current = item(1001, { label: '7-1', title: '括号匹配' });
    const problems = new Map([[1001, problemOf(1001, HOMEWORK_STATEMENT)]]);
    const view = mountRegistered(Page, paperProgram(current), current, problems, (flush) => {
      registered.push(flush);
      return unregister;
    });

    expect(registered).toHaveLength(1);
    const flush = registered[0];
    if (!flush) throw new TypeError('flush was not registered');
    expect(await runFlush(flush)).toBe(true);
    expect(transport.postForm).not.toHaveBeenCalled();

    replaceEditor('int answer = 1;');
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();
    expect(await runFlush(flush)).toBe(true);
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();
    await advance(800);
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();
    view.unmount();
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it('returns true without posting when a paper code flush runs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    transport.postForm.mockRejectedValue(new Error('保存草稿失败。'));
    const Page = await loadProgramPage();
    const registered: FlushFn[] = [];
    const current = item(1001, { label: '7-1', title: '括号匹配' });
    mountRegistered(
      Page,
      paperProgram(current),
      current,
      new Map([[1001, problemOf(1001, HOMEWORK_STATEMENT)]]),
      (flush) => {
        registered.push(flush);
        return () => undefined;
      },
    );

    expect(registered).toHaveLength(1);
    const flush = registered[0];
    if (!flush) throw new TypeError('flush was not registered');
    replaceEditor('int answer = 2;');
    expect(await runFlush(flush)).toBe(true);
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();
    expect(screen.queryByText('保存草稿失败。')).toBeNull();
  });

  it('returns true without a request when a homework program flush runs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const Page = await loadProgramPage();
    const registered: FlushFn[] = [];
    const current = item(1001, { label: '7-1', title: '括号匹配' });
    const ws = workspace({
      kind: 'homework',
      groups: [groupOf('programming', '编程题', [current], 7)],
      urls: { draftUpsert: `/homework/${TID}/draft/__PID__` },
    });
    mountRegistered(Page, ws, current, new Map([[1001, problemOf(1001, HOMEWORK_STATEMENT)]]), (flush) => {
      registered.push(flush);
      return () => undefined;
    });

    expect(registered).toHaveLength(1);
    const flush = registered[0];
    if (!flush) throw new TypeError('flush was not registered');
    replaceEditor('int answer = 3;');
    expect(await runFlush(flush)).toBe(true);
    expect(transport.postForm).not.toHaveBeenCalled();
  });

  it('does not send the paper code draft when the page unmounts before the debounce', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const Page = await loadProgramPage();
    const registered: FlushFn[] = [];
    const unregister = vi.fn<() => void>();
    const current = item(1001, { label: '7-1', title: '括号匹配' });
    const view = mountRegistered(
      Page,
      paperProgram(current),
      current,
      new Map([[1001, problemOf(1001, HOMEWORK_STATEMENT)]]),
      (flush) => {
        registered.push(flush);
        return unregister;
      },
    );

    expect(registered).toHaveLength(1);
    replaceEditor('int answer = 4;');
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();
    view.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it('does not post a paper code draft on pagehide or unmount', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    try {
      const Page = await loadProgramPage();
      const current = item(1001, { label: '7-1', title: '括号匹配' });
      const view = mount(
        Page,
        paperProgram(current),
        current,
        new Map([[1001, problemOf(1001, HOMEWORK_STATEMENT)]]),
      );
      replaceEditor('int answer = 5;');
      expect(localStorage.getItem(`ws-code:${TID}:1001`)).toBe('int answer = 5;');

      await act(async () => {
        window.dispatchEvent(new Event('pagehide'));
        await Promise.resolve();
      });
      const draftFetches = () => fetchSpy.mock.calls
        .map((call) => fetchTarget(call[0]))
        .filter((url) => url.includes('/draft'));
      expect(transport.postForm).not.toHaveBeenCalled();
      expect(transport.postJson).not.toHaveBeenCalled();
      expect(draftFetches()).toEqual([]);

      view.unmount();
      await act(async () => {
        await Promise.resolve();
      });
      expect(transport.postForm).not.toHaveBeenCalled();
      expect(transport.postJson).not.toHaveBeenCalled();
      expect(draftFetches()).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
