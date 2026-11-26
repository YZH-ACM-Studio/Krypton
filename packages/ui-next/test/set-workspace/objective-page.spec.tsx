// A static import fails collection while src/pages/set-workspace/objective-page.tsx is absent.
import type { ProblemKind } from '@hydrooj/common';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObjectiveClientQuestion } from '../../src/components/objective-answer-panel.tsx';
import { ToastProvider } from '../../src/components/ui/toast.tsx';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { formatMoment } from '../../src/pages/problem-sets/model.ts';
import type { ObjectiveAnswerActions } from '../../src/pages/set-workspace/objective-page';
import type {
  CellState,
  DraftMap,
  SetWorkspace,
  WorkspaceProblem,
  WsDraft,
  WsGroup,
  WsItem,
  WsPaper,
} from '../../src/pages/set-workspace/model.ts';

const transport = vi.hoisted(() => ({
  postForm: vi.fn<(path: string, body: URLSearchParams, fallback: string) => Promise<Record<string, unknown>>>(),
  postJson: vi.fn<(path: string, body: Record<string, unknown>, fallback: string) => Promise<Record<string, unknown>>>(),
}));

vi.mock('@/pages/teach/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pages/teach/api')>();
  return {
    ...actual,
    postForm: transport.postForm,
    postJson: transport.postJson,
  };
});

const pageLoaders = import.meta.glob('../../src/pages/set-workspace/objective-page.tsx');
const PAGE_SOURCE = 'src/pages/set-workspace/objective-page.tsx';

const TID = '64b8000000000000000000a1';
const NOW_ISO = '2026-10-18T14:00:00+08:00';
const END_ISO = '2026-10-20T16:30:00+08:00';
const SERVER_ERROR = '现在不能作答这份作业。';
const SUBMITTED_NOTE = `已交卷，${formatMoment(END_ISO, Date.parse(NOW_ISO))} 后公布成绩`;
const ENDED_NOTE = '答题已结束，仅供题目浏览';
const CORNER_NOTE = '交卷在右上角';
const LOCK_NOTE = '提交后这一题型不能再修改。';
const SINGLE_LOCK_NOTE = '判断题和单选题会一起锁定。';

type User = ReturnType<typeof userEvent.setup>;
type WorkspaceKind = 'homework' | 'paper';

interface WorkspacePatch {
  phase?: SetWorkspace['phase'];
  locked?: SetWorkspace['locked'];
  verdictVisible?: boolean;
  objectiveVerdictVisible?: boolean;
  action?: Partial<SetWorkspace['action']>;
  paper?: SetWorkspace['paper'];
  totals?: Partial<SetWorkspace['totals']>;
  window?: Partial<SetWorkspace['window']>;
}

interface ObjectivePageProps {
  ws: SetWorkspace;
  group: WsGroup;
  problems: Map<number, WorkspaceProblem>;
  drafts: DraftMap;
  onDraftsChange: (drafts: DraftMap) => void;
  registerObjectiveAnswers?: (actions: ObjectiveAnswerActions) => () => void;
}

interface FormCall {
  path: string;
  body: URLSearchParams;
  fallback: string;
}

interface JsonCall {
  path: string;
  body: Record<string, unknown>;
  fallback: string;
}

interface LockCase {
  kind: ProblemKind;
  name: string;
  lock: string;
  extra: boolean;
  questions: ObjectiveClientQuestion[];
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

async function loadPage(): Promise<(props: ObjectivePageProps) => ReactElement> {
  let load: unknown;
  for (const [key, candidate] of Object.entries(pageLoaders)) {
    if (key.endsWith(PAGE_SOURCE)) load = candidate;
  }
  expect(typeof load, `${PAGE_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${PAGE_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${PAGE_SOURCE} must be a module`);
  return asFunction<(props: ObjectivePageProps) => ReactElement>(readField(imported, 'ObjectiveKindPage'), 'ObjectiveKindPage');
}

function question(kind: ObjectiveClientQuestion['kind'], choices?: string[], presentation?: string): ObjectiveClientQuestion {
  const built: ObjectiveClientQuestion = {
    key: 'main',
    kind,
    score: 5,
    prompt: '作答',
  };
  if (choices) built.choices = choices;
  if (presentation) built.presentation = presentation;
  return built;
}

function singleQuestion(): ObjectiveClientQuestion {
  return question('single', ['队列', '栈']);
}

function trueFalseQuestion(): ObjectiveClientQuestion {
  return question('single', ['正确', '错误'], 'truefalse');
}

function blankQuestion(): ObjectiveClientQuestion {
  return question('blank');
}

function multiQuestion(): ObjectiveClientQuestion {
  return question('multi', ['队列', '栈']);
}

function subjectiveQuestion(): ObjectiveClientQuestion {
  return question('subjective');
}

function item(
  pid: number,
  label: string,
  kind: ProblemKind,
  score: number,
  state: CellState = 'empty',
  submits = 0,
): WsItem {
  return {
    pid,
    label,
    title: `题目 ${label}`,
    kind,
    score,
    state,
    submits,
    lastScore: null,
  };
}

function groupOf(kind: ProblemKind, name: string, items: WsItem[], scoreEach: number | null): WsGroup {
  return {
    kind, no: 1, name, scoreEach, items,
  };
}

function problemOf(pid: number, content: string, questions: ObjectiveClientQuestion[]): WorkspaceProblem {
  return {
    title: content,
    content,
    questions,
    programKind: null,
    raw: {
      docId: `doc-${pid}`,
      pid,
      title: content,
      content,
      config: { type: 'objective', questions },
    },
  };
}

function problemsOf(entries: Array<[number, ObjectiveClientQuestion[], string]>): Map<number, WorkspaceProblem> {
  return new Map(entries.map(([pid, questions, content]) => [pid, problemOf(pid, content, questions)]));
}

function draftOf(
  answers: Record<string, string | string[]> | null,
  submittedAnswers: Record<string, string | string[]> | null = null,
): WsDraft {
  return { answers, submittedAnswers };
}

function paperFacts(submitByKind: boolean, lockedKinds: string[] = []): WsPaper {
  return {
    score: null,
    passed: null,
    judging: false,
    passScore: 60,
    attemptLimit: null,
    attemptsUsed: 0,
    canRetake: false,
    submitByKind,
    lockedKinds,
  };
}

function workspace(kind: WorkspaceKind, group: WsGroup, patch: WorkspacePatch = {}): SetWorkspace {
  const overview = kind === 'homework' ? `/homework/${TID}` : `/paper/${TID}`;
  const base: SetWorkspace = {
    kind,
    codePolicy: 'highest',
    officialRound: patch.paper?.submitByKind ? undefined : { id: 'round-1', roundNo: 1, startedAt: NOW_ISO, closedAt: null },
    flavor: kind,
    tid: TID,
    title: kind === 'homework' ? '第三次作业' : '期中考试',
    description: '',
    mode: 'browser',
    phase: 'answering',
    locked: null,
    numbering: 'pta',
    window: {
      beginAt: '2026-10-18T08:00:00+08:00',
      endAt: END_ISO,
      dueAt: kind === 'homework' ? END_ISO : null,
      durationMinutes: null,
      startAt: NOW_ISO,
      personalEndAt: null,
      lockAt: null,
    },
    groups: [group],
    totals: {
      problemCount: 9,
      maxScore: 100,
      answered: 4,
      score: 20,
      accepted: null,
      showScore: true,
    },
    verdictVisible: false,
    objectiveVerdictVisible: patch.objectiveVerdictVisible ?? true,
    team: null,
    paper: kind === 'paper' ? paperFacts(false) : null,
    announcements: [],
    clarifications: [],
    info: [],
    student: { name: '张三', studentId: '2024010203' },
    action: {
      canStart: false,
      canFinalize: kind === 'paper',
      canAttend: false,
      canUnrank: false,
      canSubmit: true,
      attended: true,
      canRetake: false,
    },
    urls: {
      saveAnswers: `${overview}/round/save`,
      back: '/training',
      manage: null,
      overview,
      problem: null,
      submit: kind === 'homework' ? `/p/__PID__/submit?tid=${TID}` : null,
      submitCode: null,
      recordDetail: `/record/__RID__?tid=${TID}`,
      records: `/record?tid=${TID}&uidOrName=7`,
      ranking: null,
      clarify: null,
      print: null,
      start: kind === 'paper' ? `${overview}/start` : null,
      attend: null,
      draftList: `${overview}/draft`,
      draftUpsert: `${overview}/draft/__PID__`,
      submitKind: kind === 'homework' ? `${overview}/submit-kind` : null,
      lockKind: kind === 'paper' ? `${overview}/lock-kind` : null,
      finalize: kind === 'paper' ? `${overview}/finalize` : null,
      virtual: null,
      practice: null,
      teamProblem: null,
      pretest: null,
    },
  };
  return {
    ...base,
    phase: patch.phase ?? base.phase,
    locked: patch.locked === undefined ? base.locked : patch.locked,
    verdictVisible: patch.verdictVisible ?? base.verdictVisible,
    window: { ...base.window, ...patch.window },
    totals: { ...base.totals, ...patch.totals },
    action: { ...base.action, ...patch.action },
    paper: patch.paper === undefined ? base.paper : patch.paper,
  };
}

function makeBootstrap(): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: NOW_ISO,
    user: { id: 7, name: 'student', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'set_workspace.html', data: {} },
  };
}

type FlushFn = () => Promise<boolean>;
type RegisterFlush = (flush: FlushFn) => () => void;

async function renderPage(props: ObjectivePageProps, registerFlush?: RegisterFlush) {
  const Page = await loadPage();
  const pageProps = registerFlush ? { ...props, registerFlush } as ObjectivePageProps : props;
  return render(
    <ToastProvider>
      <BootstrapProvider bootstrap={makeBootstrap()}>
        <Page {...pageProps} />
      </BootstrapProvider>
    </ToastProvider>,
  );
}

function choiceInput(letter: string): HTMLInputElement {
  const node = document.querySelector(`input[type="radio"][value="${letter}"]`);
  if (!(node instanceof HTMLInputElement)) throw new TypeError(`missing choice ${letter}`);
  return node;
}

async function runFlush(flush: FlushFn): Promise<boolean> {
  let saved = false;
  await act(async () => {
    saved = await flush();
  });
  return saved;
}

function answerControls(): HTMLElement[] {
  return [
    ...screen.queryAllByRole('radio'),
    ...screen.queryAllByRole('checkbox'),
    ...screen.queryAllByRole('textbox'),
  ];
}

function expectAnswerControls(disabled: boolean): void {
  const controls = answerControls();
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    if (disabled) expect(control).toBeDisabled();
    else expect(control).toBeEnabled();
  }
}

function articleById(id: string): HTMLElement {
  const article = document.getElementById(id);
  expect(article, id).toBeInstanceOf(HTMLElement);
  if (!(article instanceof HTMLElement)) throw new TypeError(id);
  return article;
}

function saveVersions(pids: readonly number[]): Record<string, unknown> {
  return {
    changed: [...pids],
    unchanged: [],
    versions: Object.fromEntries(pids.map((pid) => [String(pid), 1])),
  };
}

function jsonCalls(): JsonCall[] {
  return transport.postJson.mock.calls.map((call) => {
    const [path, body, fallback] = call;
    return { path, body, fallback };
  });
}

function saveItems(body: Record<string, unknown>): Array<{ pid: number; answers: Record<string, unknown> }> {
  const items = body.items;
  if (!Array.isArray(items)) throw new TypeError('save items');
  return items.map((row) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) throw new TypeError('save item');
    const pid = Reflect.get(row, 'pid');
    const answers = Reflect.get(row, 'body');
    if (typeof pid !== 'number' || typeof answers !== 'object' || answers === null || Array.isArray(answers)) {
      throw new TypeError('save item shape');
    }
    const record: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(answers)) record[key] = value;
    return { pid, answers: record };
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let step = 0; step < 8; step += 1) await Promise.resolve();
  });
}

function formCalls(): FormCall[] {
  return transport.postForm.mock.calls.map((call) => {
    const [path, body, fallback] = call;
    expect(body, path).toBeInstanceOf(URLSearchParams);
    if (!(body instanceof URLSearchParams)) throw new TypeError('postForm body');
    expect(fallback.length).toBeGreaterThan(0);
    return { path, body, fallback };
  });
}

function pathsIncluding(fragment: string): string[] {
  return formCalls().map((call) => call.path).filter((path) => path.includes(fragment));
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function dialogConfirm(dialog: HTMLElement): HTMLElement {
  const primary = within(dialog).getAllByRole('button').filter((button) => button.getAttribute('data-variant') === 'primary');
  if (primary.length !== 1) throw new TypeError('dialog should have one primary button');
  const confirm = primary[0];
  if (!confirm) throw new TypeError('dialog is missing a confirm button');
  return confirm;
}

async function acceptDialog(user: User): Promise<void> {
  const dialog = await screen.findByRole('dialog');
  await user.click(dialogConfirm(dialog));
}

function expectShown(fragment: string): void {
  const matches = screen.getAllByText((_, element) => {
    if (!(element instanceof HTMLElement)) return false;
    return (element.textContent ?? '').includes(fragment);
  });
  expect(matches.length).toBeGreaterThan(0);
}

function badgeWithText(text: string): HTMLElement {
  const node = screen.getByText(text, { exact: true });
  const badge = node.closest('[data-slot="badge"]');
  expect(badge, text).toBeInstanceOf(HTMLElement);
  if (!(badge instanceof HTMLElement)) throw new TypeError(text);
  return badge;
}

beforeEach(() => {
  transport.postForm.mockReset();
  transport.postJson.mockReset();
  transport.postForm.mockResolvedValue({ ok: true, updatedAt: NOW_ISO });
  transport.postJson.mockResolvedValue({ changed: [], unchanged: [], versions: {} });
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('objective kind page', () => {
  it('keeps subjective snapshots tied to accepted CAS answers while restoration remains a manual edit', async () => {
    const user = userEvent.setup();
    const group = groupOf('subjective', '主观题', [item(801, '8-1', 'subjective', 20)], 20);
    const pending = Promise.withResolvers<Record<string, unknown>>();
    transport.postJson.mockReturnValueOnce(pending.promise);
    const actions: { current: ObjectiveAnswerActions | null } = { current: null };
    const onDraftsChange = vi.fn<(drafts: DraftMap) => void>();
    await renderPage({
      ws: workspace('homework', group), group,
      problems: problemsOf([[801, [subjectiveQuestion()], '论述题面']]),
      drafts: new Map([[801, { answers: { main: '初始答案' }, submittedAnswers: { main: '初始答案' }, version: 4 }]]),
      onDraftsChange,
      registerObjectiveAnswers: (next) => { actions.current = next; return () => {}; },
    });
    const input = screen.getByRole('textbox', { name: '主观题答案' });
    expect(screen.getByRole('toolbar', { name: '答案格式' })).toBeInTheDocument();
    expect(actions.current?.hasUnsaved()).toBe(false);
    fireEvent.change(input, { target: { value: '正式 A' } });
    expect(actions.current?.hasUnsaved()).toBe(true);
    expect(transport.postJson).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案（1 道）' }));
    fireEvent.change(input, { target: { value: '尚未保存 B' } });
    await act(async () => pending.resolve({ changed: [801], unchanged: [], versions: { 801: 5 }, drafts: [{ pid: 801, answers: { main: '正式 A' }, submittedAnswers: { main: '正式 A' }, version: 5 }] }));
    await settle();
    expect(input).toHaveValue('尚未保存 B');
    expect(onDraftsChange).toHaveBeenCalledOnce();
    expect(onDraftsChange.mock.calls[0][0].get(801)?.answers).toEqual({ main: '正式 A' });
    expect(jsonCalls()[0].body.items).toEqual([{ pid: 801, body: { main: '正式 A' }, baseVersion: 4 }]);
    expect(actions.current?.hasUnsaved()).toBe(true);
    await user.click(screen.getByRole('combobox', { name: '恢复草稿快照' }));
    const accepted = screen.getAllByRole('option').find((option) => /已保存.*正式 A/.test(option.textContent ?? ''));
    expect(accepted).toBeDefined();
    if (!accepted) throw new Error('accepted CAS snapshot is missing');
    await user.click(accepted);
    expect(input).toHaveValue('正式 A');
    expect(actions.current?.hasUnsaved()).toBe(false);
    await user.click(screen.getByRole('combobox', { name: '恢复草稿快照' }));
    const initial = screen.getAllByRole('option').find((option) => (option.textContent ?? '').includes('初始答案'));
    if (!initial) throw new Error('initial snapshot is missing');
    await user.click(initial);
    expect(input).toHaveValue('初始答案');
    expect(actions.current?.hasUnsaved()).toBe(true);
    expect(transport.postJson).toHaveBeenCalledTimes(1);
  });

  it('saves only the clicked snapshot while later input remains editable and unsaved over HTTP', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const group = groupOf('blank', '填空题', [item(301, '4-1', 'blank', 5)], 5);
    const onDraftsChange = vi.fn<(drafts: DraftMap) => void>();
    const pending = Promise.withResolvers<Record<string, unknown>>();
    transport.postJson.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ changed: [301], unchanged: [], versions: { 301: 2 } });
    await renderPage({ ws: workspace('homework', group), group, problems: problemsOf([[301, [blankQuestion()], '在途题面']]), drafts: new Map(), onDraftsChange });
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案（1 道）' }));
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: 'B' } });
    await act(async () => { pending.resolve({ changed: [301], unchanged: [], versions: { 301: 1 }, drafts: [{ pid: 301, answers: { main: 'A' }, submittedAnswers: { main: 'A' }, version: 1, judgeResult: { main: 'correct' }, score: 5 }] }); });
    await settle();
    expect(input).toHaveValue('B');
    expect(onDraftsChange.mock.calls[0]?.[0].get(301)?.answers).toEqual({ main: 'A' });
    expect(screen.getByRole('button', { name: '保存本题型答案（1 道）' })).toBeEnabled();
    expect(transport.postJson).toHaveBeenCalledTimes(1);
    expect(jsonCalls()[0]?.body.items).toEqual([{ pid: 301, body: { main: 'A' }, baseVersion: 0 }]);

    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案（1 道）' }));
    await settle();
    expect(transport.postJson).toHaveBeenCalledTimes(2);
    expect(jsonCalls()[1]?.body.items).toEqual([{ pid: 301, body: { main: 'B' }, baseVersion: 1 }]);
    expect(screen.getByRole('button', { name: '保存本题型答案' })).toBeDisabled();
  });

  it('retries only the uncertain operation and requires another click for newer input', async () => {
    const group = groupOf('blank', '填空题', [item(301, '4-1', 'blank', 5)], 5);
    const pending = Promise.withResolvers<Record<string, unknown>>();
    transport.postJson.mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ changed: [301], unchanged: [], versions: { 301: 1 } })
      .mockResolvedValueOnce({ changed: [301], unchanged: [], versions: { 301: 2 } });
    await renderPage({ ws: workspace('homework', group), group, problems: problemsOf([[301, [blankQuestion()], '重试题面']]), drafts: new Map(), onDraftsChange: vi.fn() });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案（1 道）' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'B' } });
    await act(async () => { pending.reject(new Error('响应丢失')); });
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案（1 道）' }));
    await settle();
    expect(transport.postJson).toHaveBeenCalledTimes(2);
    expect(jsonCalls()[1]?.body).toEqual(jsonCalls()[0]?.body);
    expect(screen.getByRole('textbox')).toHaveValue('B');
    expect(screen.getByRole('button', { name: '保存本题型答案（1 道）' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案（1 道）' }));
    await settle();
    expect(jsonCalls()[2]?.body.operationId).not.toBe(jsonCalls()[0]?.body.operationId);
    expect(jsonCalls()[2]?.body.items).toEqual([{ pid: 301, body: { main: 'B' }, baseVersion: 1 }]);
  });

  it('initializes CAS versions from formal answers and uses the projected client URL', async () => {
    const group = groupOf('blank', '填空题', [item(301, '4-1', 'blank', 5)], 5);
    const ws = workspace('homework', group);
    ws.mode = 'client';
    ws.urls.saveAnswers = `/paper/${TID}/round/save`;
    const onDraftsChange = vi.fn<(drafts: DraftMap) => void>();
    const formal = { answers: { main: '旧答案' }, submittedAnswers: { main: '旧答案' }, version: 4 };
    transport.postJson.mockResolvedValue({ changed: [301], unchanged: [], versions: { 301: 5 }, drafts: [{ pid: 301, answers: { main: '新答案' }, submittedAnswers: { main: '新答案' }, version: 5, judgeResult: { main: 'correct' }, score: 5 }] });
    await renderPage({ ws, group, problems: problemsOf([[301, [blankQuestion()], '版本题面']]), drafts: new Map([[301, formal]]), onDraftsChange });
    expect(screen.getByRole('textbox')).toHaveValue('旧答案');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '新答案' } });
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案（1 道）' }));
    await settle();
    expect(jsonCalls()[0]).toMatchObject({ path: `/paper/${TID}/round/save`, body: { roundId: 'round-1', kind: 'blank', items: [{ pid: 301, body: { main: '新答案' }, baseVersion: 4 }] } });
    expect(onDraftsChange.mock.calls[0]?.[0].get(301)).toMatchObject({ version: 5, score: 5, judgeResult: { main: 'correct' } });
    expect(screen.getByRole('button', { name: '保存本题型答案' })).toBeDisabled();
  });

  it('retries an uncertain save with the same operation and clears stale feedback', async () => {
    const group = groupOf('blank', '填空题', [item(301, '4-1', 'blank', 5)], 5);
    const onDraftsChange = vi.fn<(drafts: DraftMap) => void>();
    transport.postJson.mockRejectedValueOnce(new Error('响应丢失')).mockResolvedValueOnce({ changed: [301], unchanged: [], versions: { 301: 3 } });
    await renderPage({ ws: workspace('homework', group), group, problems: problemsOf([[301, [blankQuestion()], '重试题面']]), drafts: new Map([[301, { answers: { main: '旧' }, submittedAnswers: { main: '旧' }, version: 2, score: 5, judgeResult: { main: 'correct' } }]]), onDraftsChange });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '新' } });
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案（1 道）' }));
    await settle();
    expect(within(articleById('q-4-1')).getByRole('alert')).toHaveTextContent('响应丢失');
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案（1 道）' }));
    await settle();
    expect(transport.postJson).toHaveBeenCalledTimes(2);
    expect(jsonCalls()[1]?.body).toEqual(jsonCalls()[0]?.body);
    expect(onDraftsChange.mock.calls[0]?.[0].get(301)).toEqual({ answers: { main: '新' }, submittedAnswers: { main: '新' }, version: 3 });
  });

  it('keeps edits but uses a fresh operation after a confirmed rejection is corrected', async () => {
    const group = groupOf('blank', '填空题', [item(301, '4-1', 'blank', 5)], 5);
    transport.postJson.mockResolvedValueOnce({ accepted: false, error: { message: '答案内容无效。' } }).mockResolvedValueOnce({ changed: [301], unchanged: [], versions: { 301: 1 } });
    await renderPage({ ws: workspace('homework', group), group, problems: problemsOf([[301, [blankQuestion()], '题面']]), drafts: new Map(), onDraftsChange: vi.fn() });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '未受理答案' } });
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案（1 道）' }));
    await settle();
    expect(screen.getByRole('textbox')).toHaveValue('未受理答案');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '修正答案' } });
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案（1 道）' }));
    await settle();
    expect(jsonCalls()[1]?.body.operationId).not.toBe(jsonCalls()[0]?.body.operationId);
    expect(jsonCalls()[1]?.body.items).toEqual([{ pid: 301, body: { main: '修正答案' }, baseVersion: 0 }]);
  });

  it('saves a homework answer only when the student clicks save', async () => {
    vi.useFakeTimers();
    transport.postJson.mockResolvedValue(saveVersions([301]));
    const questions = [blankQuestion()];
    const row = item(301, '4-1', 'blank', 5);
    const group = groupOf('blank', '填空题', [row], 5);
    await renderPage({
      ws: workspace('homework', group),
      group,
      problems: problemsOf([[301, questions, '填空题面']]),
      drafts: new Map(),
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    });

    expect(screen.getByText('填空题面')).toBeInTheDocument();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '第一稿' } });
    await advance(400);
    fireEvent.change(input, { target: { value: '第二稿' } });
    await advance(800);
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案（1 道）' }));
    await settle();

    expect(transport.postJson).toHaveBeenCalledTimes(1);
    const call = jsonCalls()[0];
    if (!call) throw new TypeError('missing round save');
    expect(call.path).toBe(`/homework/${TID}/round/save`);
    expect(saveItems(call.body)).toEqual([{ pid: 301, answers: { main: '第二稿' } }]);
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(pathsIncluding('submit-kind')).toHaveLength(0);
  });

  it('names the pending homework submit and disables it when nothing is pending', async () => {
    const questions = [singleQuestion()];
    const rows = [item(201, '2-1', 'single', 5, 'draft'), item(202, '2-2', 'single', 5, 'draft')];
    const group = groupOf('single', '单选题', rows, 5);
    const problems = problemsOf([[201, questions, '单选甲'], [202, questions, '单选乙']]);
    const pending = new Map<number, WsDraft>([
      [201, draftOf({ main: 'A' }, { main: 'B' })],
      [202, draftOf({ main: 'A' }, null)],
    ]);
    const pendingView = await renderPage({
      ws: workspace('homework', group),
      group,
      problems,
      drafts: pending,
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    });

    fireEvent.click(within(articleById('q-2-1')).getByDisplayValue('B'));
    const save = screen.getByRole('button', { name: '保存本题型答案（1 道）' });
    expect(save).toBeEnabled();
    expect(save).toHaveAttribute('data-variant', 'primary');
    expectShown('已作答 2 / 2');
    expectShown('还有 1 道题的修改未保存');
    expect(screen.queryByText('草稿自动保存')).toBeNull();
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();
    pendingView.unmount();

    const saved = new Map<number, WsDraft>([
      [201, draftOf({ main: 'A' }, { main: 'A' })],
      [202, draftOf({ main: 'B' }, { main: 'B' })],
    ]);
    await renderPage({
      ws: workspace('homework', group),
      group,
      problems,
      drafts: saved,
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    });

    const idle = screen.getByRole('button', { name: '保存本题型答案' });
    expect(idle).toBeDisabled();
    expect(idle).toHaveAttribute('data-variant', 'primary');
    expect(screen.queryByRole('button', { name: /保存本题型答案（/ })).toBeNull();
    expectShown('已作答 2 / 2');
    expect(screen.queryByText('还有', { exact: false })).toBeNull();
    expect(screen.queryByText('草稿自动保存')).toBeNull();
  });

  it('does not post submit-kind for a paper and shows the corner hint', async () => {
    vi.useFakeTimers();
    const questions = [blankQuestion()];
    const row = item(301, '4-1', 'blank', 5);
    const group = groupOf('blank', '填空题', [row], 5);
    await renderPage({
      ws: workspace('paper', group, { paper: paperFacts(false) }),
      group,
      problems: problemsOf([[301, questions, '试卷填空']]),
      drafts: new Map(),
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    });

    expect(screen.queryByRole('button', { name: /^提交/ })).toBeNull();
    expectShown(CORNER_NOTE);
    expectShown('已作答 4 / 9');
    expect(screen.queryByText('答案自动保存')).toBeNull();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '试卷草稿' } });
    await advance(800);

    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '保存本题型答案（1 道）' })).toBeEnabled();
    expect(pathsIncluding('submit-kind')).toHaveLength(0);
    expect(pathsIncluding('lock-kind')).toHaveLength(0);
  });

  it('disables true-false and single controls when single is locked', async () => {
    const locked = paperFacts(true, ['single']);
    const trueFalse = groupOf('true_false', '判断题', [item(101, '1-1', 'true_false', 5)], 5);
    const trueFalseView = await renderPage({
      ws: workspace('paper', trueFalse, { paper: locked }),
      group: trueFalse,
      problems: problemsOf([[101, [trueFalseQuestion()], '判断题面']]),
      drafts: new Map([[101, draftOf({ main: 'A' })]]),
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    });
    expectAnswerControls(true);
    expect(screen.queryByRole('button', { name: '提交判断题' })).toBeNull();
    expect(screen.getByText(CORNER_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(ENDED_NOTE)).toBeNull();
    trueFalseView.unmount();

    const single = groupOf('single', '单选题', [item(201, '2-1', 'single', 5)], 5);
    const singleView = await renderPage({
      ws: workspace('paper', single, { paper: locked }),
      group: single,
      problems: problemsOf([[201, [singleQuestion()], '单选题面']]),
      drafts: new Map(),
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    });
    expectAnswerControls(true);
    expect(screen.queryByRole('button', { name: '提交单选题' })).toBeNull();
    singleView.unmount();

    const blank = groupOf('blank', '填空题', [item(301, '4-1', 'blank', 5)], 5);
    await renderPage({
      ws: workspace('paper', blank, { paper: locked }),
      group: blank,
      problems: problemsOf([[301, [blankQuestion()], '填空仍可作答']]),
      drafts: new Map(),
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    });
    expectAnswerControls(false);
    expect(screen.getByRole('button', { name: '提交填空题' })).toHaveAttribute('data-variant', 'secondary');
  });

  it('disables answer controls and shows the read-only footer', async () => {
    const questions = [singleQuestion()];
    const row = item(201, '2-1', 'single', 5, 'correct');
    const group = groupOf('single', '单选题', [row], 5);
    const problems = problemsOf([[201, questions, '只读单选']]);
    const ended = await renderPage({
      ws: workspace('homework', group, { phase: 'ended', action: { canSubmit: false } }),
      group,
      problems,
      drafts: new Map([[201, draftOf({ main: 'A' })]]),
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    });
    expectAnswerControls(true);
    expect(screen.getByText(ENDED_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^提交/ })).toBeNull();
    expect(screen.queryByText(CORNER_NOTE)).toBeNull();
    ended.unmount();

    const viewOnly = await renderPage({
      ws: workspace('homework', group, { phase: 'answering', action: { canSubmit: false } }),
      group,
      problems,
      drafts: new Map(),
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    });
    expectAnswerControls(true);
    expect(screen.getByText('当前仅可查看题目，不能作答。')).toBeInTheDocument();
    expect(screen.queryByText(ENDED_NOTE)).toBeNull();
    expect(screen.queryByRole('button', { name: /保存本题型/ })).toBeNull();
    viewOnly.unmount();

    const submitted = await renderPage({
      ws: workspace('paper', group, {
        phase: 'submitted',
        action: { canSubmit: false },
        paper: paperFacts(true),
      }),
      group,
      problems,
      drafts: new Map(),
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    });
    expectAnswerControls(true);
    expect(screen.getByText(SUBMITTED_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(ENDED_NOTE)).toBeNull();
    submitted.unmount();

    await renderPage({
      ws: workspace('homework', group, {
        phase: 'answering',
        locked: { reason: 'view_closed' },
        action: { canSubmit: true },
      }),
      group,
      problems,
      drafts: new Map(),
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    });
    expectAnswerControls(true);
    expect(screen.getByText(ENDED_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^提交/ })).toBeNull();
  });

  it('keeps the typed answer and shows the server error when saving fails', async () => {
    vi.useFakeTimers();
    transport.postJson.mockRejectedValue(new Error(SERVER_ERROR));
    const row = item(301, '4-1', 'blank', 5);
    const group = groupOf('blank', '填空题', [row], 5);
    await renderPage({
      ws: workspace('homework', group),
      group,
      problems: problemsOf([[301, [blankQuestion()], '失败题面']]),
      drafts: new Map(),
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    });

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '未保存答案' } });
    await advance(800);
    expect(transport.postJson).not.toHaveBeenCalled();
    expect(transport.postForm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案（1 道）' }));
    await settle();

    const article = articleById('q-4-1');
    expect(within(article).getByRole('alert')).toHaveTextContent(SERVER_ERROR);
    expect(within(article).getByRole('textbox')).toHaveValue('未保存答案');
    expect(transport.postJson).toHaveBeenCalledTimes(1);
    expect(jsonCalls()[0]?.path).toBe(`/homework/${TID}/round/save`);
    expect(transport.postForm).not.toHaveBeenCalled();
  });

  it('confirms before locking a paper kind and posts the mapped kind', async () => {
    const user = userEvent.setup();
    const cases: LockCase[] = [
      { kind: 'true_false', name: '判断题', lock: 'single', extra: true, questions: [trueFalseQuestion()] },
      { kind: 'single', name: '单选题', lock: 'single', extra: true, questions: [singleQuestion()] },
      { kind: 'multi', name: '多选题', lock: 'multi', extra: false, questions: [multiQuestion()] },
      { kind: 'blank', name: '填空题', lock: 'blank', extra: false, questions: [blankQuestion()] },
    ];
    for (const [index, entry] of cases.entries()) {
      const pid = 500 + index;
      const row = item(pid, `${index + 1}-1`, entry.kind, 5);
      const group = groupOf(entry.kind, entry.name, [row], 5);
      const view = await renderPage({
        ws: workspace('paper', group, { paper: paperFacts(true) }),
        group,
        problems: problemsOf([[pid, entry.questions, entry.name]]),
        drafts: new Map(),
        onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
      });
      const submit = screen.getByRole('button', { name: `提交${entry.name}` });
      expect(submit).toHaveAttribute('data-variant', 'secondary');
      expect(transport.postForm).not.toHaveBeenCalled();
      await user.click(submit);
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent(`提交${entry.name}？`);
      expect(dialog).toHaveTextContent(LOCK_NOTE);
      if (entry.extra) expect(dialog).toHaveTextContent(SINGLE_LOCK_NOTE);
      else expect(dialog).not.toHaveTextContent(SINGLE_LOCK_NOTE);
      await acceptDialog(user);
      expect(transport.postForm).toHaveBeenCalledTimes(1);
      const call = formCalls()[0];
      if (!call) throw new TypeError('missing lock-kind');
      expect(call.path).toBe(`/paper/${TID}/lock-kind`);
      expect(call.body.get('kind')).toBe(entry.lock);
      expect(pathsIncluding('submit-kind')).toHaveLength(0);
      view.unmount();
      transport.postForm.mockClear();
    }

    const subjective = groupOf('subjective', '主观题', [item(801, '8-1', 'subjective', 20)], 20);
    await renderPage({
      ws: workspace('paper', subjective, { paper: paperFacts(true) }),
      group: subjective,
      problems: problemsOf([[801, [subjectiveQuestion()], '论述题面']]),
      drafts: new Map(),
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    });
    expect(screen.getByLabelText('主观题编辑器')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '主观题答案' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '提交主观题' })).toBeNull();
    expect(screen.getByText(CORNER_NOTE)).toBeInTheDocument();
  });

  it('saves a homework kind when the student clicks save', async () => {
    transport.postJson.mockResolvedValue(saveVersions([201, 202]));
    const rows = [item(201, '2-1', 'single', 5, 'draft'), item(202, '2-2', 'single', 5, 'draft')];
    const group = groupOf('single', '单选题', rows, 5);
    await renderPage({
      ws: workspace('homework', group),
      group,
      problems: problemsOf([[201, [singleQuestion()], '待交甲'], [202, [singleQuestion()], '待交乙']]),
      drafts: new Map([
        [201, draftOf({ main: 'A' }, null)],
        [202, draftOf({ main: 'B' }, { main: 'A' })],
      ]),
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    });

    expect(screen.queryByRole('button', { name: /提交单选题/ })).toBeNull();
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();
    fireEvent.click(within(articleById('q-2-1')).getByDisplayValue('B'));
    fireEvent.click(within(articleById('q-2-2')).getByDisplayValue('A'));
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案（2 道）' }));
    await settle();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).toHaveBeenCalledTimes(1);
    const call = jsonCalls()[0];
    if (!call) throw new TypeError('missing round save');
    expect(call.path).toBe(`/homework/${TID}/round/save`);
    expect(saveItems(call.body)).toEqual([
      { pid: 201, answers: { main: 'B' } },
      { pid: 202, answers: { main: 'A' } },
    ]);
  });

  it('shows the kind summary, problem anchor, and local mark', async () => {
    const user = userEvent.setup();
    const rows = [item(201, '2-1', 'single', 8), item(202, '2-2', 'single', 8)];
    const group = groupOf('single', '单选题', rows, 5);
    const props = {
      ws: workspace('homework', group),
      group,
      problems: problemsOf([[201, [singleQuestion()], '锚点甲'], [202, [singleQuestion()], '锚点乙']]),
      drafts: new Map<number, WsDraft>(),
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    };
    const view = await renderPage(props);

    expect(screen.getByRole('button', { name: '收起或展开题目总览' })).toHaveAttribute('data-variant', 'ghost');
    expect(screen.getByText('单选题')).toBeInTheDocument();
    expect(screen.getByText('2 题 · 每题 5 分')).toBeInTheDocument();
    expect(articleById('q-2-1').textContent).toContain('2-1');
    expect(articleById('q-2-2').id).toBe('q-2-2');
    const scores = screen.getAllByText('分数 8');
    expect(scores).toHaveLength(2);
    for (const node of scores) expect(node.closest('[data-slot="badge"]')).toBeInstanceOf(HTMLElement);
    const flagKey = `ws-flag:${TID}:201`;
    expect(localStorage.getItem(flagKey)).toBeNull();
    await user.click(within(articleById('q-2-1')).getByRole('button', { name: '标记' }));
    expect(localStorage.getItem(flagKey)).not.toBeNull();
    expect(within(articleById('q-2-1')).getByRole('button', { name: '已标记' })).toHaveAttribute('data-variant', 'ghost');
    await user.click(within(articleById('q-2-1')).getByRole('button', { name: '已标记' }));
    expect(localStorage.getItem(flagKey)).toBeNull();

    const columnKey = `ws-col:${TID}`;
    const stored = localStorage.getItem(columnKey);
    await user.click(screen.getByRole('button', { name: '收起或展开题目总览' }));
    expect(localStorage.getItem(columnKey)).not.toBe(stored);
    view.unmount();

    const uneven = groupOf('single', '单选题', rows, null);
    await renderPage({
      ...props,
      ws: workspace('homework', uneven),
      group: uneven,
    });
    expect(screen.getByText('2 题 · 共 16 分')).toBeInTheDocument();
    expect(screen.queryByText(/每题/)).toBeNull();
  });

  it('shows verdict badges only when verdicts are visible, and an unsaved edit', async () => {
    const rows = [
      item(201, '2-1', 'single', 5, 'correct'),
      item(202, '2-2', 'single', 5, 'wrong'),
      item(203, '2-3', 'single', 5, 'partial'),
    ];
    const group = groupOf('single', '单选题', rows, 5);
    const problems = problemsOf([
      [201, [singleQuestion()], '正确题'],
      [202, [singleQuestion()], '错误题'],
      [203, [singleQuestion()], '部分题'],
    ]);
    const visible = await renderPage({
      ws: workspace('homework', group, { verdictVisible: true }),
      group,
      problems,
      drafts: new Map(),
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    });
    expect(badgeWithText('正确')).toHaveAttribute('data-tone', 'success');
    expect(badgeWithText('错误')).toHaveAttribute('data-tone', 'danger');
    expect(badgeWithText('部分正确')).toHaveAttribute('data-tone', 'info');
    visible.unmount();

    const hidden = await renderPage({
      ws: workspace('paper', group, { verdictVisible: false, paper: paperFacts(false) }),
      group,
      problems,
      drafts: new Map(),
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    });
    expect(screen.queryByText('正确')).toBeNull();
    expect(screen.queryByText('错误')).toBeNull();
    expect(screen.queryByText('部分正确')).toBeNull();
    hidden.unmount();

    const edited = [
      item(201, '2-1', 'single', 5, 'draft', 1),
      item(202, '2-2', 'single', 5, 'draft', 0),
    ];
    const editedGroup = groupOf('single', '单选题', edited, 5);
    await renderPage({
      ws: workspace('homework', editedGroup),
      group: editedGroup,
      problems: problemsOf([[201, [singleQuestion()], '改过'], [202, [singleQuestion()], '没交过']]),
      drafts: new Map([
        [201, draftOf({ main: 'B' }, { main: 'A' })],
        [202, draftOf({ main: 'A' }, null)],
      ]),
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    });
    fireEvent.click(within(articleById('q-2-1')).getByDisplayValue('A'));
    expect(within(articleById('q-2-1')).getByText('已修改，未保存')).toBeInTheDocument();
    expect(badgeWithText('已修改，未保存')).toHaveAttribute('data-tone', 'warning');
    expect(within(articleById('q-2-2')).queryByText('已修改，未保存')).toBeNull();
  });

  it('does not send a pending paper draft on flush', async () => {
    vi.useFakeTimers();
    const registered: FlushFn[] = [];
    const unregister = vi.fn<() => void>();
    const questions = [singleQuestion()];
    const row = item(201, '2-1', 'single', 5);
    const group = groupOf('single', '单选题', [row], 5);
    const props: ObjectivePageProps = {
      ws: workspace('paper', group, { paper: paperFacts(false) }),
      group,
      problems: problemsOf([[201, questions, '单选题面']]),
      drafts: new Map(),
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    };
    const view = await renderPage(props, (flush) => {
      registered.push(flush);
      return unregister;
    });

    expect(registered).toHaveLength(1);
    const flush = registered[0];
    if (!flush) throw new TypeError('flush was not registered');
    expect(await runFlush(flush)).toBe(true);
    expect(transport.postForm).not.toHaveBeenCalled();

    fireEvent.click(choiceInput('B'));
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();
    expect(await runFlush(flush)).toBe(false);
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();
    await advance(800);
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();

    view.unmount();
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();
    expect(unregister).toHaveBeenCalled();
  });

  it('does not post or show a draft error when a registered flush runs with an unsaved answer', async () => {
    vi.useFakeTimers();
    transport.postForm.mockRejectedValue(new Error(SERVER_ERROR));
    transport.postJson.mockRejectedValue(new Error(SERVER_ERROR));
    const registered: FlushFn[] = [];
    const row = item(201, '2-1', 'single', 5);
    const group = groupOf('single', '单选题', [row], 5);
    await renderPage({
      ws: workspace('paper', group, { paper: paperFacts(false) }),
      group,
      problems: problemsOf([[201, [singleQuestion()], '失败单选']]),
      drafts: new Map(),
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    }, (flush) => {
      registered.push(flush);
      return () => undefined;
    });

    expect(registered).toHaveLength(1);
    const flush = registered[0];
    if (!flush) throw new TypeError('flush was not registered');
    fireEvent.click(choiceInput('B'));
    expect(await runFlush(flush)).toBe(false);
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();
    expect(within(articleById('q-2-1')).queryByRole('alert')).toBeNull();
    expect(choiceInput('B').checked).toBe(true);
  });

  it('saves a paper answer from the save button when flush registration is omitted', async () => {
    vi.useFakeTimers();
    transport.postJson.mockResolvedValue(saveVersions([201]));
    const row = item(201, '2-1', 'single', 5);
    const group = groupOf('single', '单选题', [row], 5);
    await renderPage({
      ws: workspace('paper', group, { paper: paperFacts(false) }),
      group,
      problems: problemsOf([[201, [singleQuestion()], '单选题面']]),
      drafts: new Map(),
      onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
    });

    fireEvent.click(choiceInput('B'));
    await advance(800);
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案（1 道）' }));
    await settle();
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).toHaveBeenCalledTimes(1);
    const call = jsonCalls()[0];
    if (!call) throw new TypeError('missing round save');
    expect(call.path).toBe(`/paper/${TID}/round/save`);
    expect(saveItems(call.body)).toEqual([{ pid: 201, answers: { main: 'B' } }]);
  });
});
