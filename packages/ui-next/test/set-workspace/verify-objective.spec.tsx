import type { ProblemKind } from '@hydrooj/common';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObjectiveClientQuestion } from '../../src/components/objective-answer-panel.tsx';
import { ToastProvider } from '../../src/components/ui/toast.tsx';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { parseSetWorkspace } from '../../src/pages/set-workspace/model.ts';
import type {
  CellState,
  DraftMap,
  SetWorkspace,
  WorkspaceProblem,
  WsDraft,
  WsGroup,
  WsItem,
  WsUrls,
} from '../../src/pages/set-workspace/model.ts';
import { ObjectiveKindPage } from '../../src/pages/set-workspace/objective-page.tsx';

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

const TID = '64b8000000000000000000a1';
const NOW_ISO = '2026-10-18T14:00:00+08:00';
const END_ISO = '2026-10-20T16:30:00+08:00';
const VERIFY_OBJECTIVE = `/teach/homework/${TID}/verify/objective`;
const VERIFY_SUBMIT = `/teach/homework/${TID}/verify/submit`;
const DRAFT_UPSERT = `/homework/${TID}/draft/__PID__`;
const GRADE_FALLBACK = '判分失败。';
const SUBJECTIVE_NOTE = '主观题需要人工阅卷，验题不判分。';
const ENDED_NOTE = '答题已结束，仅供题目浏览';
// Item badge already says 「分数 5」. These earned scores appear only after grading.
const CORRECT_SCORE = 4;
const WRONG_SCORE = 1;
const PARTIAL_SCORE = 2;

type WorkspaceKind = 'homework' | 'paper';
type Outcome = 'correct' | 'partial' | 'wrong';

interface WorkspacePatch {
  mode?: SetWorkspace['mode'];
  phase?: SetWorkspace['phase'];
  locked?: SetWorkspace['locked'];
  verdictVisible?: boolean;
  action?: Partial<SetWorkspace['action']>;
  paper?: SetWorkspace['paper'];
}

interface ObjectivePageProps {
  ws: SetWorkspace;
  group: WsGroup;
  problems: Map<number, WorkspaceProblem>;
  drafts: DraftMap;
  onDraftsChange: (drafts: DraftMap) => void;
}

interface FormCall {
  path: string;
  body: URLSearchParams;
  fallback: string;
}

interface HeldCall extends FormCall {
  finish: (value: Record<string, unknown>) => void;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key);
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

function subjectiveQuestion(): ObjectiveClientQuestion {
  return question('subjective');
}

function item(
  pid: number,
  label: string,
  kind: ProblemKind,
  score: number,
  state: CellState = 'empty',
): WsItem {
  return {
    pid,
    label,
    title: `题目 ${label}`,
    kind,
    score,
    state,
    submits: 0,
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

function workspace(kind: WorkspaceKind, group: WsGroup, patch: WorkspacePatch = {}): SetWorkspace {
  const overview = kind === 'homework' ? `/homework/${TID}` : `/paper/${TID}`;
  const base: SetWorkspace = {
    kind,
    codePolicy: 'highest',
    officialRound: { id: 'round-1', roundNo: 1, startedAt: NOW_ISO, closedAt: null },
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
      problemCount: group.items.length,
      maxScore: 100,
      answered: 0,
      score: 0,
      accepted: null,
      showScore: true,
    },
    verdictVisible: false,
    objectiveVerdictVisible: true,
    team: null,
    paper: null,
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
      start: null,
      attend: null,
      draftList: `${overview}/draft`,
      draftUpsert: DRAFT_UPSERT,
      submitKind: kind === 'homework' ? `${overview}/submit-kind` : null,
      lockKind: null,
      finalize: null,
      virtual: null,
      practice: null,
      teamProblem: null,
      pretest: null,
    },
  };
  return {
    ...base,
    mode: patch.mode ?? base.mode,
    phase: patch.phase ?? base.phase,
    locked: patch.locked === undefined ? base.locked : patch.locked,
    verdictVisible: patch.verdictVisible ?? base.verdictVisible,
    action: { ...base.action, ...patch.action },
    paper: patch.paper === undefined ? base.paper : patch.paper,
  };
}

function withUrls(ws: SetWorkspace, extra: Record<string, string | null>): SetWorkspace {
  const urls: WsUrls = { ...ws.urls };
  for (const [key, value] of Object.entries(extra)) Reflect.set(urls, key, value);
  return { ...ws, urls };
}

function previewWorkspace(group: WsGroup, verifyObjective: string | null = VERIFY_OBJECTIVE): SetWorkspace {
  return withUrls(workspace('homework', group, {
    mode: 'preview',
    verdictVisible: true,
    action: { canSubmit: false },
  }), {
    verifyObjective,
    verifySubmit: VERIFY_SUBMIT,
  });
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

function renderPage(props: ObjectivePageProps) {
  return render(
    <ToastProvider>
      <BootstrapProvider bootstrap={makeBootstrap()}>
        <ObjectiveKindPage {...props} />
      </BootstrapProvider>
    </ToastProvider>,
  );
}

function pageProps(ws: SetWorkspace, group: WsGroup, problems: Map<number, WorkspaceProblem>): ObjectivePageProps {
  return {
    ws,
    group,
    problems,
    drafts: new Map<number, WsDraft>(),
    onDraftsChange: vi.fn<(drafts: DraftMap) => void>(),
  };
}

function articleById(id: string): HTMLElement {
  const article = document.getElementById(id);
  expect(article, id).toBeInstanceOf(HTMLElement);
  if (!(article instanceof HTMLElement)) throw new TypeError(id);
  return article;
}

function choiceIn(articleId: string, letter: string): HTMLInputElement {
  const node = articleById(articleId).querySelector(`input[type="radio"][value="${letter}"]`);
  if (!(node instanceof HTMLInputElement)) throw new TypeError(`missing choice ${articleId} ${letter}`);
  return node;
}

function formCalls(): FormCall[] {
  return transport.postForm.mock.calls.map((call) => {
    const [path, body, fallback] = call;
    expect(body, path).toBeInstanceOf(URLSearchParams);
    if (!(body instanceof URLSearchParams)) throw new TypeError('postForm body');
    return { path, body, fallback };
  });
}

function isAnswerRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readAnswers(call: FormCall): Record<string, unknown> {
  const raw = call.body.get('answers');
  expect(typeof raw, 'answers').toBe('string');
  if (typeof raw !== 'string') throw new TypeError('answers');
  const parsed: unknown = JSON.parse(raw);
  if (!isAnswerRecord(parsed)) throw new TypeError('answers must be a JSON object');
  return parsed;
}

function callForPid(pid: number): FormCall {
  const found = formCalls().find((call) => call.body.get('pid') === String(pid));
  expect(found, `pid ${pid}`).toBeDefined();
  if (!found) throw new TypeError(`missing post for ${pid}`);
  return found;
}

function gradePayload(outcome: Outcome, score: number): Record<string, unknown> {
  return {
    results: { main: { outcome, score } },
    skipped: [],
  };
}

function draftPaths(): string[] {
  return formCalls().map((call) => call.path).filter((path) => path.includes('/draft/'));
}

function saveVersions(pids: readonly number[]): Record<string, unknown> {
  return {
    changed: [...pids],
    unchanged: [],
    versions: Object.fromEntries(pids.map((pid) => [String(pid), 1])),
  };
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

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function urlRecord(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    back: '/training',
    manage: null,
    overview: `/homework/${TID}`,
    problem: null,
    submit: null,
    pretest: null,
    submitCode: null,
    recordDetail: `/record/__RID__?tid=${TID}`,
    records: `/record?tid=${TID}`,
    ranking: null,
    clarify: null,
    print: null,
    start: null,
    attend: null,
    draftList: `/homework/${TID}/draft`,
    draftUpsert: DRAFT_UPSERT,
    submitKind: `/homework/${TID}/submit-kind`,
    lockKind: null,
    finalize: null,
    virtual: null,
    practice: null,
    teamProblem: null,
    ...extra,
  };
}

function workspaceRaw(urls: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: 'homework',
    flavor: 'homework',
    tid: TID,
    title: '第三次作业',
    description: '',
    mode: 'preview',
    phase: 'answering',
    locked: null,
    numbering: 'pta',
    window: {
      beginAt: '2026-10-18T08:00:00+08:00',
      endAt: END_ISO,
      dueAt: END_ISO,
      durationMinutes: null,
      startAt: NOW_ISO,
      personalEndAt: null,
      lockAt: null,
    },
    groups: [{
      kind: 'single',
      no: 2,
      name: '单选题',
      scoreEach: 5,
      items: [{
        pid: 201,
        label: '2-1',
        title: '单选',
        kind: 'single',
        score: 5,
        state: 'empty',
        submits: 0,
        lastScore: null,
      }],
    }],
    totals: {
      problemCount: 1,
      maxScore: 5,
      answered: 0,
      score: 0,
      accepted: null,
      showScore: true,
    },
    verdictVisible: true,
    team: null,
    paper: null,
    announcements: [],
    clarifications: [],
    info: [],
    student: { name: '张三', studentId: '2024010203' },
    action: {
      canStart: false,
      canFinalize: false,
      canAttend: false,
      canUnrank: false,
      canSubmit: false,
      attended: true,
      canRetake: false,
    },
    urls,
  };
}

function holdPosts(): HeldCall[] {
  const held: HeldCall[] = [];
  transport.postForm.mockImplementation((path, body, fallback) => new Promise((done) => {
    held.push({ path, body, fallback, finish: done });
  }));
  return held;
}

async function settleGrades(held: readonly HeldCall[]): Promise<void> {
  await act(async () => {
    for (const entry of held) {
      const pid = entry.body.get('pid');
      if (pid === '201') entry.finish(gradePayload('correct', CORRECT_SCORE));
      else if (pid === '202') entry.finish(gradePayload('wrong', WRONG_SCORE));
      else throw new TypeError(`unexpected pid ${String(pid)}`);
    }
    await Promise.resolve();
  });
}

beforeEach(() => {
  transport.postForm.mockReset();
  transport.postJson.mockReset();
  transport.postForm.mockResolvedValue({ ok: true });
  transport.postJson.mockResolvedValue({ changed: [], unchanged: [], versions: {} });
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('verify url parsing', () => {
  it('reads optional verify urls as null when they are missing', () => {
    const missing = parseSetWorkspace(workspaceRaw(urlRecord()));
    expect(readField(missing.urls, 'verifyObjective')).toBeNull();
    expect(readField(missing.urls, 'verifySubmit')).toBeNull();

    const present = parseSetWorkspace(workspaceRaw(urlRecord({
      verifyObjective: VERIFY_OBJECTIVE,
      verifySubmit: VERIFY_SUBMIT,
    })));
    expect(readField(present.urls, 'verifyObjective')).toBe(VERIFY_OBJECTIVE);
    expect(readField(present.urls, 'verifySubmit')).toBe(VERIFY_SUBMIT);

    const explicitNull = parseSetWorkspace(workspaceRaw(urlRecord({
      verifyObjective: null,
      verifySubmit: null,
    })));
    expect(readField(explicitNull.urls, 'verifyObjective')).toBeNull();
    expect(readField(explicitNull.urls, 'verifySubmit')).toBeNull();

    const empty = parseSetWorkspace(workspaceRaw(urlRecord({
      verifyObjective: '',
      verifySubmit: '',
    })));
    expect(readField(empty.urls, 'verifyObjective')).toBe('');
    expect(readField(empty.urls, 'verifySubmit')).toBe('');
  });

  it('rejects a verify url that is not a string or null', () => {
    expect(() => parseSetWorkspace(workspaceRaw(urlRecord({ verifyObjective: 1 })))).toThrow(TypeError);
    expect(() => parseSetWorkspace(workspaceRaw(urlRecord({ verifySubmit: false })))).toThrow(TypeError);
  });
});

describe('objective verify page', () => {
  it('grades answered preview choices without saving a draft and clears an edited result', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(NOW_ISO));
    const rows = [
      item(201, '2-1', 'single', 5),
      item(202, '2-2', 'single', 5),
      item(203, '2-3', 'single', 5),
    ];
    const group = groupOf('single', '单选题', rows, 5);
    await renderPage(pageProps(
      previewWorkspace(group),
      group,
      problemsOf([
        [201, [singleQuestion()], '单选甲'],
        [202, [singleQuestion()], '单选乙'],
        [203, [singleQuestion()], '单选丙'],
      ]),
    ));

    expect(screen.getByRole('button', { name: '判分（0 道）' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^提交/ })).toBeNull();
    expect(screen.queryByText(ENDED_NOTE)).toBeNull();
    expect(choiceIn('q-2-1', 'A')).toBeEnabled();
    expect(choiceIn('q-2-2', 'B')).toBeEnabled();
    expect(choiceIn('q-2-3', 'A')).toBeEnabled();

    fireEvent.click(choiceIn('q-2-1', 'A'));
    fireEvent.click(choiceIn('q-2-2', 'B'));
    expect(choiceIn('q-2-1', 'A').checked).toBe(true);
    expect(choiceIn('q-2-2', 'B').checked).toBe(true);
    const grade = screen.getByRole('button', { name: '判分（2 道）' });
    expect(grade).toBeEnabled();
    await advance(800);
    expect(draftPaths()).toEqual([]);
    expect(transport.postForm).not.toHaveBeenCalled();

    const held = holdPosts();
    fireEvent.click(grade);
    expect(held).toHaveLength(2);
    expect(held.every((entry) => entry.path === VERIFY_OBJECTIVE)).toBe(true);
    expect(held.every((entry) => entry.fallback === GRADE_FALLBACK)).toBe(true);
    const first = callForPid(201);
    const second = callForPid(202);
    expect(readAnswers(first)).toEqual({ main: 'A' });
    expect(readAnswers(second)).toEqual({ main: 'B' });
    expect(formCalls().some((entry) => entry.body.get('pid') === '203')).toBe(false);
    expect(articleById('q-2-1').textContent ?? '').not.toContain('正确');

    await settleGrades(held);
    const gradedFirst = articleById('q-2-1').textContent ?? '';
    const gradedSecond = articleById('q-2-2').textContent ?? '';
    expect(gradedFirst).toContain('正确');
    expect(gradedFirst).toContain(String(CORRECT_SCORE));
    expect(gradedSecond).toContain('错误');
    expect(gradedSecond).toContain(String(WRONG_SCORE));
    expect(articleById('q-2-3').textContent ?? '').not.toContain('正确');
    expect(articleById('q-2-3').textContent ?? '').not.toContain('错误');

    fireEvent.click(choiceIn('q-2-1', 'B'));
    const editedFirst = articleById('q-2-1').textContent ?? '';
    expect(editedFirst).not.toContain('正确');
    expect(editedFirst).not.toContain(String(CORRECT_SCORE));
    const keptSecond = articleById('q-2-2').textContent ?? '';
    expect(keptSecond).toContain('错误');
    expect(keptSecond).toContain(String(WRONG_SCORE));
    await advance(800);
    expect(draftPaths()).toEqual([]);
  });

  it('shows a partial grade on that question', async () => {
    const row = item(201, '2-1', 'single', 5);
    const group = groupOf('single', '单选题', [row], 5);
    await renderPage(pageProps(
      previewWorkspace(group),
      group,
      problemsOf([[201, [singleQuestion()], '部分题']]),
    ));
    fireEvent.click(choiceIn('q-2-1', 'A'));
    const held = holdPosts();
    fireEvent.click(screen.getByRole('button', { name: '判分（1 道）' }));
    expect(held).toHaveLength(1);
    await act(async () => {
      held[0]?.finish(gradePayload('partial', PARTIAL_SCORE));
      await Promise.resolve();
    });
    const text = articleById('q-2-1').textContent ?? '';
    expect(text).toContain('部分正确');
    expect(text).toContain(String(PARTIAL_SCORE));
  });

  it('shows the manual-review note for a subjective question', async () => {
    const row = item(801, '8-1', 'subjective', 20);
    const group = groupOf('subjective', '主观题', [row], 20);
    await renderPage(pageProps(
      previewWorkspace(group),
      group,
      problemsOf([[801, [subjectiveQuestion()], '论述题面']]),
    ));
    expect(within(articleById('q-8-1')).getByText(SUBJECTIVE_NOTE)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(screen.getByRole('button', { name: '判分（0 道）' })).toBeDisabled();
  });

  it('shows the server message when grading fails', async () => {
    const message = '现在不能判分这道题。';
    transport.postForm.mockRejectedValue(new Error(message));
    const row = item(201, '2-1', 'single', 5);
    const group = groupOf('single', '单选题', [row], 5);
    await renderPage(pageProps(
      previewWorkspace(group),
      group,
      problemsOf([[201, [singleQuestion()], '失败题']]),
    ));
    fireEvent.click(choiceIn('q-2-1', 'A'));
    fireEvent.click(screen.getByRole('button', { name: '判分（1 道）' }));
    const article = articleById('q-2-1');
    expect(await within(article).findByRole('alert')).toHaveTextContent(message);
    expect(article.textContent ?? '').not.toContain('正确');
    const call = formCalls()[0];
    if (!call) throw new TypeError('missing grade post');
    expect(call.path).toBe(VERIFY_OBJECTIVE);
    expect(call.fallback).toBe(GRADE_FALLBACK);
    expect(readAnswers(call)).toEqual({ main: 'A' });
    expect(draftPaths()).toEqual([]);
  });

  it('shows an error when the grade response has the wrong shape', async () => {
    transport.postForm.mockResolvedValue({ results: null });
    const row = item(201, '2-1', 'single', 5);
    const group = groupOf('single', '单选题', [row], 5);
    await renderPage(pageProps(
      previewWorkspace(group),
      group,
      problemsOf([[201, [singleQuestion()], '畸形响应']]),
    ));
    fireEvent.click(choiceIn('q-2-1', 'A'));
    fireEvent.click(screen.getByRole('button', { name: '判分（1 道）' }));
    const article = articleById('q-2-1');
    expect(await within(article).findByRole('alert')).toBeInTheDocument();
    expect(article.textContent ?? '').not.toContain('正确');
  });

  it('does not enter verify when the preview address is empty', async () => {
    const row = item(201, '2-1', 'single', 5);
    const group = groupOf('single', '单选题', [row], 5);
    await renderPage(pageProps(
      previewWorkspace(group, ''),
      group,
      problemsOf([[201, [singleQuestion()], '空地址']]),
    ));
    expect(choiceIn('q-2-1', 'A')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /判分/ })).toBeNull();
    expect(screen.getByText('当前仅可查看题目，不能作答。')).toBeInTheDocument();
  });

  it('saves a student homework from the save button and does not autosave', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(NOW_ISO));
    transport.postJson.mockResolvedValue(saveVersions([201]));
    const row = item(201, '2-1', 'single', 5);
    const group = groupOf('single', '单选题', [row], 5);
    await renderPage(pageProps(
      workspace('homework', group),
      group,
      problemsOf([[201, [singleQuestion()], '学生单选']]),
    ));

    expect(screen.queryByRole('button', { name: /判分/ })).toBeNull();
    expect(screen.getByRole('button', { name: '保存本题型答案' })).toBeDisabled();
    fireEvent.click(choiceIn('q-2-1', 'A'));
    expect(screen.getByRole('button', { name: '保存本题型答案（1 道）' })).toBeEnabled();
    await advance(800);
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案（1 道）' }));
    await settle();
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).toHaveBeenCalledTimes(1);
    const call = transport.postJson.mock.calls[0];
    if (!call) throw new TypeError('missing round save');
    expect(call[0]).toBe(`/homework/${TID}/round/save`);
    expect(saveItems(call[1])).toEqual([{ pid: 201, answers: { main: 'A' } }]);
    expect(draftPaths()).toEqual([]);
  });

  it('saves a browser homework from the save button when a verify address is present', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(NOW_ISO));
    transport.postJson.mockResolvedValue(saveVersions([201]));
    const row = item(201, '2-1', 'single', 5);
    const group = groupOf('single', '单选题', [row], 5);
    const ws = withUrls(workspace('homework', group, { mode: 'browser' }), {
      verifyObjective: VERIFY_OBJECTIVE,
      verifySubmit: VERIFY_SUBMIT,
    });
    await renderPage(pageProps(
      ws,
      group,
      problemsOf([[201, [singleQuestion()], '浏览器地址']]),
    ));

    fireEvent.click(choiceIn('q-2-1', 'B'));
    expect(screen.getByRole('button', { name: '保存本题型答案（1 道）' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /判分/ })).toBeNull();
    await advance(800);
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案（1 道）' }));
    await settle();
    const call = transport.postJson.mock.calls[0];
    if (!call) throw new TypeError('missing round save');
    expect(call[0]).toBe(`/homework/${TID}/round/save`);
    expect(saveItems(call[1])).toEqual([{ pid: 201, answers: { main: 'B' } }]);
    expect(formCalls().some((entry) => entry.path === VERIFY_OBJECTIVE)).toBe(false);
    expect(transport.postForm).not.toHaveBeenCalled();
  });

  it('saves a client homework from the save button when a verify address is present', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(NOW_ISO));
    transport.postJson.mockResolvedValue(saveVersions([201]));
    const row = item(201, '2-1', 'single', 5);
    const group = groupOf('single', '单选题', [row], 5);
    const ws = withUrls(workspace('homework', group, { mode: 'client' }), {
      verifyObjective: VERIFY_OBJECTIVE,
      verifySubmit: VERIFY_SUBMIT,
    });
    await renderPage(pageProps(
      ws,
      group,
      problemsOf([[201, [singleQuestion()], '客户端单选']]),
    ));

    fireEvent.click(choiceIn('q-2-1', 'A'));
    expect(screen.queryByRole('button', { name: /判分/ })).toBeNull();
    expect(screen.queryByText(SUBJECTIVE_NOTE)).toBeNull();
    expect(screen.getByRole('button', { name: '保存本题型答案（1 道）' })).toBeEnabled();
    await advance(800);
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存本题型答案（1 道）' }));
    await settle();
    const call = transport.postJson.mock.calls[0];
    if (!call) throw new TypeError('missing round save');
    expect(call[0]).toBe(`/homework/${TID}/round/save`);
    expect(saveItems(call[1])).toEqual([{ pid: 201, answers: { main: 'A' } }]);
    expect(formCalls().some((entry) => entry.path === VERIFY_OBJECTIVE)).toBe(false);
    expect(transport.postForm).not.toHaveBeenCalled();
  });

  it('does not show the manual-review note on a single-choice question', async () => {
    const row = item(201, '2-1', 'single', 5);
    const group = groupOf('single', '单选题', [row], 5);
    await renderPage(pageProps(
      previewWorkspace(group),
      group,
      problemsOf([[201, [singleQuestion()], '单选提示']]),
    ));
    expect(screen.queryByText(SUBJECTIVE_NOTE)).toBeNull();
    expect(choiceIn('q-2-1', 'A')).toBeEnabled();
  });

  it('shows an error when the grade response omits skipped', async () => {
    transport.postForm.mockResolvedValue({
      results: { main: { outcome: 'correct', score: CORRECT_SCORE } },
    });
    const row = item(201, '2-1', 'single', 5);
    const group = groupOf('single', '单选题', [row], 5);
    await renderPage(pageProps(
      previewWorkspace(group),
      group,
      problemsOf([[201, [singleQuestion()], '缺 skipped']]),
    ));
    fireEvent.click(choiceIn('q-2-1', 'A'));
    fireEvent.click(screen.getByRole('button', { name: '判分（1 道）' }));
    const article = articleById('q-2-1');
    expect(await within(article).findByRole('alert')).toHaveTextContent('判分返回的数据格式不对。');
    expect(article.textContent ?? '').not.toContain('正确');
    expect(article.textContent ?? '').not.toContain(`得分 ${CORRECT_SCORE}`);
  });

  it('shows an error when a grade score is not finite', async () => {
    transport.postForm.mockResolvedValue({
      results: { main: { outcome: 'correct', score: Number.NaN } },
      skipped: [],
    });
    const row = item(201, '2-1', 'single', 5);
    const group = groupOf('single', '单选题', [row], 5);
    await renderPage(pageProps(
      previewWorkspace(group),
      group,
      problemsOf([[201, [singleQuestion()], '非有限得分']]),
    ));
    fireEvent.click(choiceIn('q-2-1', 'A'));
    fireEvent.click(screen.getByRole('button', { name: '判分（1 道）' }));
    const article = articleById('q-2-1');
    expect(await within(article).findByRole('alert')).toHaveTextContent('判分返回的数据格式不对。');
    expect(article.textContent ?? '').not.toContain('正确');
  });

  it('ignores a grade that arrives after that answer changes', async () => {
    const row = item(201, '2-1', 'single', 5);
    const group = groupOf('single', '单选题', [row], 5);
    await renderPage(pageProps(
      previewWorkspace(group),
      group,
      problemsOf([[201, [singleQuestion()], '迟到判分']]),
    ));
    fireEvent.click(choiceIn('q-2-1', 'A'));
    const held = holdPosts();
    fireEvent.click(screen.getByRole('button', { name: '判分（1 道）' }));
    expect(held).toHaveLength(1);
    fireEvent.click(choiceIn('q-2-1', 'B'));
    const pending = held[0];
    if (!pending) throw new TypeError('missing held grade');
    await act(async () => {
      pending.finish(gradePayload('correct', CORRECT_SCORE));
      await Promise.resolve();
    });
    const text = articleById('q-2-1').textContent ?? '';
    expect(text).not.toContain('正确');
    expect(text).not.toContain(`得分 ${CORRECT_SCORE}`);
    expect(choiceIn('q-2-1', 'B').checked).toBe(true);
  });

  it('does not post a second grade while the first request is in flight', async () => {
    const row = item(201, '2-1', 'single', 5);
    const group = groupOf('single', '单选题', [row], 5);
    await renderPage(pageProps(
      previewWorkspace(group),
      group,
      problemsOf([[201, [singleQuestion()], '重复判分']]),
    ));
    fireEvent.click(choiceIn('q-2-1', 'A'));
    const held = holdPosts();
    const grade = screen.getByRole('button', { name: '判分（1 道）' });
    fireEvent.click(grade);
    fireEvent.click(grade);
    expect(held).toHaveLength(1);
    expect(held[0]?.path).toBe(VERIFY_OBJECTIVE);
    expect(held[0]?.body.get('pid')).toBe('201');
  });
});
