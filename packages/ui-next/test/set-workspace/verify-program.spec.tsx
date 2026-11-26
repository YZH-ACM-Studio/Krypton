import type { ProblemKind } from '@hydrooj/common';
import { EditorView } from '@codemirror/view';
import { type RenderResult, act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import type {
  SetWorkspace,
  WorkspaceProblem,
  WsAction,
  WsGroup,
  WsItem,
  WsTotals,
  WsUrls,
  WsWindow,
} from '../../src/pages/set-workspace/model.ts';
import { ProgramProblemPage } from '../../src/pages/set-workspace/program-page.tsx';

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

const TID = '64b8000000000000000000a1';
const PID = 1001;
const CODE = 'int main(){return 0;}';
const EDITED = 'int main(){return 1;}';
const RID = '656f10000000000000000001';
const HISTORY_ID = '656f000000000000000000aa';
const STATEMENT = '括号匹配的题面正文';
const VERIFY_FALLBACK = '提交验题失败。';
const GRADE_FALLBACK = '判分失败。';
const STILL_JUDGING = '还在评测，稍后在详情里查看。';
const SCORE = 73;
const REGION_SCORE = 50;
const LANG = 'py.py3';
const TEXT_ANSWER = 'total += i;';

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

interface WorkspaceOverrides extends Omit<Partial<SetWorkspace>, 'action' | 'urls' | 'totals' | 'window'> {
  action?: Partial<WsAction>;
  urls?: Partial<WsUrls>;
  totals?: Partial<WsTotals>;
  window?: Partial<WsWindow>;
}

function readCalls(): FormCall[] {
  return transport.postForm.mock.calls.map((call) => {
    const [path, body, fallback] = call;
    if (!(body instanceof URLSearchParams)) throw new TypeError(`postForm body for ${path}`);
    return { path, body, fallback };
  });
}

function jsonCalls(): JsonCall[] {
  return transport.postJson.mock.calls.map((call) => {
    const [path, body, fallback] = call;
    return { path, body, fallback };
  });
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
    problemCount: 1,
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
    score: 100,
    state: 'empty',
    submits: 0,
    lastScore: null,
    ...overrides,
  };
}

function groupOf(kind: ProblemKind, name: string, items: WsItem[]): WsGroup {
  return { kind, no: 7, name, scoreEach: items[0]?.score ?? null, items };
}

function programKindOf(config: Record<string, unknown>): WorkspaceProblem['programKind'] {
  if (config.type === 'function' || config.type === 'program_fill' || config.type === 'programming') return config.type;
  return 'programming';
}

function problemOf(pid: number, content: string, config: Record<string, unknown> = { type: 'programming' }): WorkspaceProblem {
  return {
    title: `题目 ${pid}`,
    content,
    questions: null,
    programKind: programKindOf(config),
    raw: {
      docId: pid,
      pid,
      title: `题目 ${pid}`,
      content,
      config,
    },
  };
}

function verifyRid(n: number): string {
  return `656f1000000000000000000${n}`;
}

function homeworkVerify(current: WsItem, extra: Partial<WsUrls> = {}): SetWorkspace {
  return workspace({
    mode: 'preview',
    action: { canSubmit: false },
    groups: [groupOf(current.kind, '编程题', [current])],
    urls: {
      verifySubmit: `/teach/homework/${TID}/verify/submit`,
      verifyObjective: `/teach/homework/${TID}/verify/objective`,
      ...extra,
    },
  });
}

function recordBody(status: number, score: number): Record<string, unknown> {
  return { rdoc: { status, score, time: status === 1 ? 15 : 1 } };
}

function historyBody(pid: number): Record<string, unknown> {
  return {
    rdocs: [{
      _id: HISTORY_ID,
      pid,
      status: 2,
      score: 0,
      lang: LANG,
      time: 4,
      memory: 128,
    }],
  };
}

function seedCode(pid: number, code = CODE): void {
  localStorage.setItem(`ws-code:${TID}:${pid}`, code);
}

function seedLang(pid: number, lang = LANG): void {
  localStorage.setItem(`ws-lang:${TID}:${pid}`, lang);
}

function mount(ws: SetWorkspace, current: WsItem, problems: Map<number, WorkspaceProblem>): RenderResult {
  const data = bootstrap();
  window.__KRYPTON_BOOTSTRAP__ = data;
  return render(
    <BootstrapProvider bootstrap={data}>
      <ProgramProblemPage ws={ws} item={current} problems={problems} langRange={{ 'cc.cc17': 'C++17', 'py.py3': 'Python 3' }} />
    </BootstrapProvider>,
  );
}

function editorContent(): HTMLElement {
  const content = document.querySelector('.cm-content');
  if (!(content instanceof HTMLElement)) throw new TypeError('editor is missing');
  return content;
}

function replaceEditor(text: string, target: HTMLElement = editorContent()): void {
  const view = EditorView.findFromDOM(target);
  if (!view) throw new TypeError('editor view is missing');
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  });
}

function verifyButton(): HTMLElement {
  return screen.getByRole('button', { name: /^提交验题/ });
}

function formalSubmitButton(): HTMLElement {
  return screen.getByRole('button', { name: /^提交(?:\s*F10)?$/ });
}

function detailHrefs(): string[] {
  return screen.queryAllByRole('link', { name: '查看详情' }).map((link) => link.getAttribute('href') ?? '');
}

function recordHrefs(): string[] {
  return [...document.querySelectorAll('a')].flatMap((node) => {
    const href = node.getAttribute('href') ?? '';
    return href.includes('/record/') ? [href] : [];
  });
}

function isAnswerRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readAnswers(call: FormCall): Record<string, unknown> {
  const raw = call.body.get('answers');
  if (typeof raw !== 'string') throw new TypeError('answers');
  const parsed: unknown = JSON.parse(raw);
  if (!isAnswerRecord(parsed)) throw new TypeError('answers must be a JSON object');
  return parsed;
}

function findVerifyRow(rid: string): HTMLElement | null {
  const link = screen.queryAllByRole('link', { name: '查看详情' }).find((node) => node.getAttribute('href') === `/record/${rid}`);
  if (!(link instanceof HTMLElement)) return null;
  let node: HTMLElement | null = link;
  while (node && !(node.textContent ?? '').includes('验题')) node = node.parentElement;
  return node;
}

function verifyRow(rid: string): HTMLElement {
  const row = findVerifyRow(rid);
  if (!row) throw new TypeError(`missing verify row ${rid}`);
  return row;
}

function shows(text: string): boolean {
  return (document.body.textContent ?? '').includes(text);
}

function showsPass(text: string): boolean {
  return /Accepted|通过|(?:^|[^A-Za-z])AC(?:[^A-Za-z]|$)/.test(text);
}

function storageText(): string {
  const parts: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key) parts.push(`${key}=${localStorage.getItem(key) ?? ''}`);
  }
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index);
    if (key) parts.push(`session:${key}=${sessionStorage.getItem(key) ?? ''}`);
  }
  return parts.join('\n');
}

function isHistoryPath(path: string): boolean {
  return path.startsWith('/record?');
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function settle(seen: () => boolean): Promise<void> {
  await advance(0);
  for (let step = 0; step < 8 && !seen(); step += 1) {
    await advance(2000);
  }
}

function programmingProblems(): Map<number, WorkspaceProblem> {
  return new Map([[PID, problemOf(PID, STATEMENT)]]);
}

describe('program verify in the workspace', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    transport.getJson.mockReset();
    transport.postForm.mockReset();
    transport.postJson.mockReset();
    transport.getJson.mockImplementation((path: string) => {
      if (isHistoryPath(path)) return Promise.resolve({ rdocs: [] });
      return Promise.resolve(recordBody(1, SCORE));
    });
    transport.postForm.mockResolvedValue({ rid: RID });
    transport.postJson.mockResolvedValue({ rid: RID });
  });

  afterEach(() => {
    delete window.__KRYPTON_BOOTSTRAP__;
    vi.useRealTimers();
  });

  it('lets a preview editor submit a verify attempt and hides pretest', () => {
    const current = item(PID);
    seedCode(PID);
    seedLang(PID);
    mount(homeworkVerify(current), current, programmingProblems());

    expect(verifyButton()).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^提交(?:\s*F10)?$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '自测' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '运行全部自测' })).not.toBeInTheDocument();
    expect(editorContent()).toHaveAttribute('contenteditable', 'true');
    replaceEditor(EDITED);
    expect(editorContent().textContent).toContain('return 1');
  });

  it('posts pid, lang, and code to the verify submit address', async () => {
    const current = item(PID);
    seedCode(PID);
    seedLang(PID);
    mount(homeworkVerify(current), current, programmingProblems());
    replaceEditor(EDITED);
    fireEvent.click(verifyButton());

    await waitFor(() => expect(transport.postForm).toHaveBeenCalled());
    const posted = readCalls();
    expect(posted).toHaveLength(1);
    const call = posted[0];
    if (!call) throw new TypeError('missing verify submit');
    expect(call.path).toBe(`/teach/homework/${TID}/verify/submit`);
    expect(call.fallback).toBe(VERIFY_FALLBACK);
    expect(call.body.get('pid')).toBe(String(PID));
    expect(call.body.get('lang')).toBe(LANG);
    expect(call.body.get('code')).toBe(EDITED);
    expect(transport.postJson).not.toHaveBeenCalled();
    // No draft save and no formal submission: the verify address is the only POST.
    expect(posted.every((entry) => entry.path === `/teach/homework/${TID}/verify/submit`)).toBe(true);
  });

  it('polls a judging verify record until accepted and then stops', async () => {
    vi.useFakeTimers();
    const current = item(PID);
    seedCode(PID);
    const polledAt: number[] = [];
    transport.getJson.mockImplementation((path: string) => {
      if (path === `/record/${RID}`) {
        const status = polledAt.length === 0 ? 20 : 1;
        polledAt.push(Date.now());
        return Promise.resolve(recordBody(status, status === 1 ? SCORE : 0));
      }
      if (isHistoryPath(path)) return Promise.resolve(historyBody(PID));
      return Promise.resolve(recordBody(20, 0));
    });

    mount(homeworkVerify(current), current, programmingProblems());
    fireEvent.click(verifyButton());
    await settle(() => {
      const row = document.body.textContent ?? '';
      return showsPass(row) && detailHrefs().includes(`/record/${RID}`);
    });

    const row = verifyRow(RID);
    expect(showsPass(row.textContent ?? '')).toBe(true);
    expect(row.textContent ?? '').toContain(String(SCORE));
    expect(row.textContent ?? '').toContain('验题');
    const html = document.body.innerHTML;
    const verifyAt = html.indexOf(`href="/record/${RID}"`);
    const historyAt = html.indexOf(`href="/record/${HISTORY_ID}`);
    expect(verifyAt).toBeGreaterThanOrEqual(0);
    expect(historyAt).toBeGreaterThan(verifyAt);
    expect(polledAt).toHaveLength(2);
    const first = polledAt[0];
    const second = polledAt[1];
    if (first === undefined || second === undefined) throw new TypeError('expected two polls');
    expect(second - first).toBeGreaterThanOrEqual(2000);
    expect(second - first).toBeLessThan(4000);
    expect(transport.getJson.mock.calls.filter((call) => call[0] === `/record/${RID}`)).toHaveLength(2);
    await advance(10_000);
    expect(polledAt).toHaveLength(2);
    expect(shows(STILL_JUDGING)).toBe(false);
  });

  it('stops a waiting verify record once the verdict is final', async () => {
    vi.useFakeTimers();
    const current = item(PID);
    seedCode(PID);
    const polledAt: number[] = [];
    transport.getJson.mockImplementation((path: string) => {
      if (path === `/record/${RID}`) {
        polledAt.push(Date.now());
        return Promise.resolve(recordBody(2, 0));
      }
      if (isHistoryPath(path)) return Promise.resolve({ rdocs: [] });
      return Promise.resolve(recordBody(0, 0));
    });

    mount(homeworkVerify(current), current, programmingProblems());
    fireEvent.click(verifyButton());
    await settle(() => /Wrong Answer|WA/.test(findVerifyRow(RID)?.textContent ?? ''));

    expect(polledAt).toHaveLength(1);
    expect(/Wrong Answer|WA/.test(verifyRow(RID).textContent ?? '')).toBe(true);
    expect(shows(STILL_JUDGING)).toBe(false);
    await advance(10_000);
    expect(polledAt).toHaveLength(1);
  });

  it('stops polling after 120 seconds and tells the teacher to open the record', async () => {
    vi.useFakeTimers();
    const current = item(PID);
    seedCode(PID);
    const polledAt: number[] = [];
    transport.getJson.mockImplementation((path: string) => {
      if (path === `/record/${RID}`) {
        polledAt.push(Date.now());
        return Promise.resolve(recordBody(20, 0));
      }
      if (isHistoryPath(path)) return Promise.resolve({ rdocs: [] });
      return Promise.resolve(recordBody(20, 0));
    });

    mount(homeworkVerify(current), current, programmingProblems());
    fireEvent.click(verifyButton());
    await advance(0);
    for (let step = 0; step < 70 && !shows(STILL_JUDGING); step += 1) {
      await advance(2000);
    }

    expect(shows(STILL_JUDGING)).toBe(true);
    expect(detailHrefs()).toContain(`/record/${RID}`);
    expect(polledAt.length).toBeGreaterThan(1);
    const stopped = polledAt.length;
    await advance(10_000);
    expect(polledAt).toHaveLength(stopped);
  });

  it('keeps only the latest five verify rows in page memory', async () => {
    const current = item(PID);
    seedCode(PID);
    let count = 0;
    transport.postForm.mockImplementation(() => {
      count += 1;
      return Promise.resolve({ rid: verifyRid(count) });
    });
    transport.getJson.mockImplementation((path: string) => {
      if (/^\/record\/656f1000000000000000000[1-6]$/.test(path)) return Promise.resolve(recordBody(1, SCORE));
      return Promise.resolve({ rdocs: [] });
    });
    const currentWs = homeworkVerify(current);
    const view = mount(currentWs, current, programmingProblems());

    for (let n = 1; n <= 6; n += 1) {
      await waitFor(() => expect(verifyButton()).toBeEnabled());
      fireEvent.click(verifyButton());
      await waitFor(() => expect(detailHrefs()).toContain(`/record/${verifyRid(n)}`));
    }

    const hrefs = detailHrefs();
    expect(hrefs).toHaveLength(5);
    expect(hrefs[0]).toBe(`/record/${verifyRid(6)}`);
    expect(hrefs).toEqual([6, 5, 4, 3, 2].map((n) => `/record/${verifyRid(n)}`));
    expect(storageText()).not.toContain(verifyRid(6));
    expect(storageText()).not.toContain(verifyRid(1));

    view.unmount();
    mount(currentWs, current, programmingProblems());
    expect(screen.queryByRole('link', { name: '查看详情' })).not.toBeInTheDocument();
  });

  it('shows the server message when verify submit fails', async () => {
    const current = item(PID);
    seedCode(PID);
    seedLang(PID);
    transport.postForm.mockRejectedValue(new Error('语言不允许。'));
    mount(homeworkVerify(current), current, programmingProblems());
    fireEvent.click(verifyButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('语言不允许。');
    expect(readCalls()[0]?.fallback).toBe(VERIFY_FALLBACK);
    expect(screen.queryByRole('link', { name: '查看详情' })).not.toBeInTheDocument();
    expect(transport.postJson).not.toHaveBeenCalled();
  });

  it('submits a function region through verify without the formal address', async () => {
    const current = item(PID, { kind: 'function', label: '6-1', title: '函数题' });
    const ws = workspace({
      mode: 'preview',
      action: { canSubmit: false },
      groups: [groupOf('function', '函数题', [current])],
      urls: { verifySubmit: `/teach/homework/${TID}/verify/submit` },
    });
    const config = {
      type: 'function',
      template: {
        lang: 'cc.cc17',
        surface: [
          { type: 'code', code: 'int solve() {\n' },
          { type: 'region', id: 'body', title: '函数体' },
          { type: 'code', code: '\n}\n' },
        ],
      },
    };
    mount(ws, current, new Map([[PID, problemOf(PID, '函数题面', config)]]));

    const region = screen.getByRole('textbox', { name: '函数体代码编辑器' });
    expect(region).toHaveAttribute('contenteditable', 'true');
    expect(verifyButton()).toBeEnabled();
    expect(screen.queryByRole('button', { name: '自测' })).not.toBeInTheDocument();
    replaceEditor('return 1;', region);
    fireEvent.click(verifyButton());

    await waitFor(() => expect(transport.postForm).toHaveBeenCalled());
    const call = readCalls()[0];
    if (!call) throw new TypeError('missing function verify');
    expect(call.path).toBe(`/teach/homework/${TID}/verify/submit`);
    expect(call.fallback).toBe(VERIFY_FALLBACK);
    expect(call.body.get('pid')).toBe(String(PID));
    expect(call.body.get('lang')).toBe('cc.cc17');
    expect(call.body.get('code')).toBe(JSON.stringify({ body: 'return 1;' }));
    expect(transport.postJson).not.toHaveBeenCalled();
  });

  it('submits a compile-mode program fill through verify', async () => {
    const current = item(PID, { kind: 'program_fill', label: '5-1', title: '填空题' });
    const ws = workspace({
      mode: 'preview',
      action: { canSubmit: false },
      groups: [groupOf('program_fill', '程序填空题', [current])],
      urls: {
        verifySubmit: `/teach/exam/${TID}/verify/submit`,
        verifyObjective: `/teach/exam/${TID}/verify/objective`,
      },
    });
    const config = {
      type: 'program_fill',
      mode: 'compile',
      template: {
        lang: LANG,
        surface: [
          { type: 'code', code: 'print(' },
          { type: 'region', id: 'expr', title: '表达式' },
          { type: 'code', code: ')' },
        ],
      },
    };
    mount(ws, current, new Map([[PID, problemOf(PID, '填空题面', config)]]));

    const blank = screen.getByRole('textbox', { name: '表达式' });
    expect(blank).toBeEnabled();
    fireEvent.change(blank, { target: { value: '1' } });
    fireEvent.click(verifyButton());

    await waitFor(() => expect(transport.postForm).toHaveBeenCalled());
    const call = readCalls()[0];
    if (!call) throw new TypeError('missing fill verify');
    expect(call.path).toBe(`/teach/exam/${TID}/verify/submit`);
    expect(call.fallback).toBe(VERIFY_FALLBACK);
    expect(call.body.get('pid')).toBe(String(PID));
    expect(call.body.get('lang')).toBe(LANG);
    expect(call.body.get('code')).toBe(JSON.stringify({ expr: '1' }));
    expect(transport.postJson).not.toHaveBeenCalled();
    expect(readCalls().map((entry) => entry.path)).toEqual([`/teach/exam/${TID}/verify/submit`]);
  });

  it('grades a text-mode program fill in memory without a verify record', async () => {
    const current = item(PID, { kind: 'program_fill', label: '5-1', title: '文本填空' });
    const objective = `/teach/exam/${TID}/verify/objective`;
    const ws = workspace({
      mode: 'preview',
      action: { canSubmit: false },
      groups: [groupOf('program_fill', '程序填空题', [current])],
      urls: {
        verifySubmit: `/teach/exam/${TID}/verify/submit`,
        verifyObjective: objective,
      },
    });
    const config = {
      type: 'program_fill',
      mode: 'text',
      template: {
        surface: [
          { type: 'code', code: 'print(' },
          { type: 'region', id: 'expr', title: '表达式' },
          { type: 'code', code: ')' },
        ],
      },
    };
    const problems = new Map([[PID, problemOf(PID, '填空题面', config)]]);
    transport.postForm.mockResolvedValue({
      results: { expr: { outcome: 'correct', score: REGION_SCORE } },
      skipped: [],
    });
    const view = mount(ws, current, problems);

    expect(screen.queryByRole('button', { name: /^提交验题/ })).not.toBeInTheDocument();
    expect(recordHrefs()).toEqual([]);
    const blank = screen.getByRole('textbox', { name: '表达式' });
    expect(blank).toBeEnabled();
    fireEvent.change(blank, { target: { value: TEXT_ANSWER } });
    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /判分/ }));
    await waitFor(() => expect(transport.postForm).toHaveBeenCalled());
    const posted = readCalls();
    expect(posted.map((entry) => entry.path)).toEqual([objective]);
    const call = posted[0];
    if (!call) throw new TypeError('missing text grade');
    expect(call.fallback).toBe(GRADE_FALLBACK);
    expect(call.body.get('pid')).toBe(String(PID));
    expect(readAnswers(call)).toEqual({ expr: TEXT_ANSWER });
    expect(call.body.get('code')).toBeNull();
    expect(call.body.get('lang')).toBeNull();
    expect(transport.postJson).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^提交验题/ })).not.toBeInTheDocument();
    expect(recordHrefs()).toEqual([]);

    await waitFor(() => {
      expect(document.body.textContent ?? '').toContain('正确');
    });
    expect(document.body.textContent ?? '').toContain(`得分 ${REGION_SCORE}`);
    fireEvent.change(screen.getByRole('textbox', { name: '表达式' }), { target: { value: '' } });
    await waitFor(() => {
      const text = document.body.textContent ?? '';
      expect(text).not.toContain('正确');
      expect(text).not.toContain('错误');
      expect(text).not.toContain('部分正确');
      expect(text).not.toContain(`得分 ${REGION_SCORE}`);
    });
    expect(readCalls().every((entry) => entry.path === objective)).toBe(true);
    expect(screen.queryByRole('button', { name: /^提交验题/ })).not.toBeInTheDocument();
    expect(recordHrefs()).toEqual([]);

    view.unmount();
    expect(storageText()).not.toContain(TEXT_ANSWER);
    expect(localStorage.getItem(`ws-code:${TID}:${PID}`)).toBeNull();
    mount(ws, current, problems);
    expect(screen.getByRole('textbox', { name: '表达式' })).toHaveValue('');
    expect(storageText()).not.toContain(TEXT_ANSWER);
    expect(recordHrefs()).toEqual([]);
  });

  it('does not save a paper draft when previewing a programming problem', async () => {
    const current = item(PID);
    seedCode(PID);
    seedLang(PID);
    const ws = workspace({
      kind: 'paper',
      flavor: 'paper',
      mode: 'preview',
      action: { canSubmit: false },
      groups: [groupOf('programming', '编程题', [current])],
      urls: {
        overview: `/paper/${TID}`,
        submit: null,
        submitCode: `/paper/${TID}/submit-code/__PID__`,
        draftUpsert: `/paper/${TID}/draft/__PID__`,
        verifySubmit: `/teach/exam/${TID}/verify/submit`,
      },
    });
    mount(ws, current, programmingProblems());
    replaceEditor(EDITED);
    fireEvent.click(verifyButton());

    await waitFor(() => expect(transport.postForm).toHaveBeenCalled());
    const posted = readCalls();
    expect(posted.map((entry) => entry.path)).toEqual([`/teach/exam/${TID}/verify/submit`]);
    expect(posted[0]?.body.get('pid')).toBe(String(PID));
    expect(posted[0]?.body.get('lang')).toBe(LANG);
    expect(posted[0]?.body.get('code')).toBe(EDITED);
    expect(posted[0]?.fallback).toBe(VERIFY_FALLBACK);
    expect(transport.postJson).not.toHaveBeenCalled();
  });

  it('keeps polling a judging verify record past one minute and stops at 120 seconds', async () => {
    vi.useFakeTimers();
    const current = item(PID);
    seedCode(PID);
    const polledAt: number[] = [];
    transport.getJson.mockImplementation((path: string) => {
      if (path === `/record/${RID}`) {
        polledAt.push(Date.now());
        return Promise.resolve(recordBody(20, 0));
      }
      if (isHistoryPath(path)) return Promise.resolve({ rdocs: [] });
      return Promise.resolve(recordBody(20, 0));
    });

    mount(homeworkVerify(current), current, programmingProblems());
    fireEvent.click(verifyButton());
    await advance(0);
    const reached = (ms: number) => {
      const first = polledAt[0];
      const last = polledAt[polledAt.length - 1];
      return first !== undefined && last !== undefined && last - first >= ms;
    };
    for (let step = 0; step < 40 && !reached(60_000); step += 1) await advance(2_000);

    expect(reached(60_000)).toBe(true);
    expect(shows(STILL_JUDGING)).toBe(false);
    const midCount = polledAt.length;
    await advance(2_000);
    expect(polledAt.length).toBe(midCount + 1);
    expect(shows(STILL_JUDGING)).toBe(false);

    for (let step = 0; step < 40 && !shows(STILL_JUDGING); step += 1) await advance(2_000);
    expect(shows(STILL_JUDGING)).toBe(true);
    const first = polledAt[0];
    const last = polledAt[polledAt.length - 1];
    if (first === undefined || last === undefined) throw new TypeError('expected verify polls');
    expect(last - first).toBe(120_000);
    const stopped = polledAt.length;
    await advance(10_000);
    expect(polledAt).toHaveLength(stopped);
    expect(detailHrefs()).toContain(`/record/${RID}`);
  });

  it('does not say a verify record is still judging when it finishes at the time limit', async () => {
    vi.useFakeTimers();
    const current = item(PID);
    seedCode(PID);
    const polledAt: number[] = [];
    transport.getJson.mockImplementation((path: string) => {
      if (path === `/record/${RID}`) {
        const now = Date.now();
        const first = polledAt[0] ?? now;
        polledAt.push(now);
        if (now - first >= 120_000) return Promise.resolve(recordBody(1, SCORE));
        return Promise.resolve(recordBody(20, 0));
      }
      if (isHistoryPath(path)) return Promise.resolve({ rdocs: [] });
      return Promise.resolve(recordBody(20, 0));
    });

    mount(homeworkVerify(current), current, programmingProblems());
    fireEvent.click(verifyButton());
    await advance(0);
    for (let step = 0; step < 70 && !showsPass(document.body.textContent ?? ''); step += 1) {
      await advance(2_000);
    }

    const row = verifyRow(RID);
    expect(showsPass(row.textContent ?? '')).toBe(true);
    expect(row.textContent ?? '').toContain(String(SCORE));
    expect(shows(STILL_JUDGING)).toBe(false);
    const stopped = polledAt.length;
    await advance(10_000);
    expect(polledAt).toHaveLength(stopped);
  });

  it('clears verify rows when the teacher opens another problem', async () => {
    const current = item(PID);
    const other = item(PID + 1, { label: '7-2', title: '另一题' });
    seedCode(PID);
    seedCode(other.pid);
    const view = mount(homeworkVerify(current), current, programmingProblems());
    fireEvent.click(verifyButton());
    await waitFor(() => expect(detailHrefs()).toContain(`/record/${RID}`));

    const data = bootstrap();
    window.__KRYPTON_BOOTSTRAP__ = data;
    const nextWs = workspace({
      mode: 'preview',
      action: { canSubmit: false },
      groups: [groupOf(other.kind, '编程题', [other])],
      urls: {
        verifySubmit: `/teach/homework/${TID}/verify/submit`,
        verifyObjective: `/teach/homework/${TID}/verify/objective`,
      },
    });
    view.rerender(
      <BootstrapProvider bootstrap={data}>
        <ProgramProblemPage
          ws={nextWs}
          item={other}
          problems={new Map([[other.pid, problemOf(other.pid, '另一题题面')]])}
          langRange={{ 'cc.cc17': 'C++17', 'py.py3': 'Python 3' }}
        />
      </BootstrapProvider>,
    );

    expect(screen.queryByRole('link', { name: '查看详情' })).not.toBeInTheDocument();
    expect(screen.queryByText('验题')).not.toBeInTheDocument();
    expect(screen.getByText('另一题题面')).toBeInTheDocument();
  });

  it('does not save a paper draft while the teacher edits code in verify mode', async () => {
    vi.useFakeTimers();
    const current = item(PID);
    seedCode(PID);
    seedLang(PID);
    const ws = workspace({
      kind: 'paper',
      flavor: 'paper',
      mode: 'preview',
      action: { canSubmit: false },
      groups: [groupOf('programming', '编程题', [current])],
      urls: {
        overview: `/paper/${TID}`,
        submit: null,
        submitCode: `/paper/${TID}/submit-code/__PID__`,
        draftUpsert: `/paper/${TID}/draft/__PID__`,
        verifySubmit: `/teach/exam/${TID}/verify/submit`,
      },
    });
    mount(ws, current, programmingProblems());
    replaceEditor(EDITED);
    await advance(800);
    await advance(0);

    expect(transport.postForm).not.toHaveBeenCalled();
    expect(transport.postJson).not.toHaveBeenCalled();
    expect(editorContent().textContent).toContain('return 1');
  });

  it('does not open verify when the verify address is blank', () => {
    const current = item(PID);
    const ws = workspace({
      mode: 'preview',
      action: { canSubmit: false },
      groups: [groupOf('programming', '编程题', [current])],
      urls: { verifySubmit: ' \n\t ' },
    });
    mount(ws, current, programmingProblems());

    expect(screen.queryByRole('button', { name: /^提交验题/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提交' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '自测' })).not.toBeInTheDocument();
    expect(editorContent()).toHaveAttribute('contenteditable', 'false');
  });

  it('shows the server message and stops when a verify poll fails', async () => {
    vi.useFakeTimers();
    const current = item(PID);
    seedCode(PID);
    let polls = 0;
    transport.getJson.mockImplementation((path: string) => {
      if (path === `/record/${RID}`) {
        polls += 1;
        return Promise.reject(new Error('记录不存在。'));
      }
      if (isHistoryPath(path)) return Promise.resolve({ rdocs: [] });
      return Promise.resolve(recordBody(0, 0));
    });

    mount(homeworkVerify(current), current, programmingProblems());
    fireEvent.click(verifyButton());
    await advance(0);
    for (let step = 0; step < 5 && !shows('记录不存在。'); step += 1) await advance(0);

    expect(verifyRow(RID).textContent ?? '').toContain('记录不存在。');
    expect(shows(STILL_JUDGING)).toBe(false);
    const stopped = polls;
    expect(stopped).toBeGreaterThan(0);
    await advance(10_000);
    expect(polls).toBe(stopped);
  });

  it('shows the verify failure sentence when submit fails without a server message', async () => {
    const current = item(PID);
    seedCode(PID);
    seedLang(PID);
    transport.postForm.mockRejectedValue('offline');
    mount(homeworkVerify(current), current, programmingProblems());
    fireEvent.click(verifyButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(VERIFY_FALLBACK);
    expect(screen.queryByText('提交失败。')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '查看详情' })).not.toBeInTheDocument();
    expect(transport.postJson).not.toHaveBeenCalled();
  });
});

describe('student program submit stays unchanged', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    transport.getJson.mockReset();
    transport.postForm.mockReset();
    transport.postJson.mockReset();
    transport.getJson.mockImplementation((path: string) => {
      if (isHistoryPath(path)) return Promise.resolve({ rdocs: [] });
      return Promise.resolve(recordBody(1, 100));
    });
    transport.postForm.mockResolvedValue({ ok: true });
    transport.postJson.mockResolvedValue({ rid: RID });
  });

  afterEach(() => {
    delete window.__KRYPTON_BOOTSTRAP__;
    vi.useRealTimers();
  });

  it('keeps the student submit button and the original address', async () => {
    const current = item(PID);
    seedCode(PID);
    seedLang(PID);
    const ws = workspace({ groups: [groupOf('programming', '编程题', [current])] });
    mount(ws, current, programmingProblems());

    expect(screen.queryByRole('button', { name: /^提交验题/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '自测' })).toBeInTheDocument();
    fireEvent.click(formalSubmitButton());
    await waitFor(() => expect(transport.postJson).toHaveBeenCalled());
    const posted = jsonCalls()[0];
    if (!posted) throw new TypeError('missing student submit');
    expect(posted.path).toBe(`/p/${PID}/submit?tid=${TID}`);
    expect(posted.body.lang).toBe(LANG);
    expect(posted.body.code).toBe(CODE);
    expect(posted.body.tid).toBe(TID);
    expect(posted.body.examShell).toBe(false);
    expect(transport.postForm).not.toHaveBeenCalled();
  });

  it('keeps the formal submit when a browser payload still carries a verify address', async () => {
    const current = item(PID);
    seedCode(PID);
    const ws = workspace({
      groups: [groupOf('programming', '编程题', [current])],
      urls: { verifySubmit: `/teach/homework/${TID}/verify/submit` },
    });
    mount(ws, current, programmingProblems());

    expect(screen.queryByRole('button', { name: /^提交验题/ })).not.toBeInTheDocument();
    fireEvent.click(formalSubmitButton());
    await waitFor(() => expect(transport.postJson).toHaveBeenCalled());
    expect(jsonCalls()[0]?.path).toBe(`/p/${PID}/submit?tid=${TID}`);
    expect(transport.postForm).not.toHaveBeenCalled();
  });

  it('keeps the client submit when a verify address is present', async () => {
    const current = item(PID, { label: 'A', title: '最短路', score: 100 });
    seedCode(PID);
    const ws = workspace({
      kind: 'contest',
      flavor: 'acm',
      mode: 'client',
      numbering: 'letter',
      groups: [groupOf('programming', '题目', [current])],
      urls: {
        overview: `/exam-mode/${TID}`,
        submit: `/p/__PID__/submit?tid=${TID}`,
        verifySubmit: `/teach/acm/${TID}/verify/submit`,
      },
    });
    mount(ws, current, programmingProblems());

    expect(screen.queryByRole('button', { name: /^提交验题/ })).not.toBeInTheDocument();
    fireEvent.click(formalSubmitButton());
    await waitFor(() => expect(transport.postJson).toHaveBeenCalled());
    const posted = jsonCalls()[0];
    if (!posted) throw new TypeError('missing client submit');
    expect(posted.path).toBe(`/p/${PID}/submit?tid=${TID}`);
    expect(posted.body.examShell).toBe(true);
    expect(posted.body.code).toBe(CODE);
    expect(transport.postForm).not.toHaveBeenCalled();
  });
});
