// paper-print.tsx is new and may be absent until the print page lands.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { ComponentType } from 'react';
import type { ProblemKind, TeachType } from '@hydrooj/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import type { TeachPaperProblem, TeachWorkbenchPayload } from '../../src/pages/teach/model.ts';
import { ProblemsTab } from '../../src/pages/teach/tabs/problems.tsx';

const printLoaders = import.meta.glob('../../src/pages/teach/paper-print.tsx');
const PRINT_SOURCE = 'src/pages/teach/paper-print.tsx';

const downloadBlob = vi.hoisted(() => vi.fn<(filename: string, blob: Blob) => void>());

vi.mock('@/lib/download-zip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/download-zip')>();
  return { ...actual, downloadBlob };
});

const TITLE = '一次函数测验';
const HOMEWORK_ID = 'hw-12';
const EXAM_ID = 'midterm-3';
const IDENTITY_LINE = `姓名 ${'_'.repeat(6)}  学号 ${'_'.repeat(6)}  班级 ${'_'.repeat(6)}`;
const JUDGE_BLANK = '（\u3000\u3000）';
const PRINT_NOTE = '用浏览器的「打印」可以另存为 PDF。';
const DRAW_NOTE = '每人抽 2 道';
const TRUE_FALSE_HEADING = '一、判断题（每题 2 分，共 2 分）';
const SINGLE_HEADING = '二、单选题（每题 5 分，共 5 分）';
const PROGRAM_HEADING = '七、编程题（共 10 分）';
const EXPORT_ACTIONS = ['Word 空白卷', 'Word 答案卷', '打印空白卷', '打印答案卷'] as const;
const SERVER_ERROR = '这份试卷暂时不能导出。';

interface TeachPaperItem {
  label: string;
  pid: number;
  title: string;
  score: number | null;
  kind: ProblemKind;
  statement: string;
  options: string[] | null;
  answer: string | null;
}

interface TeachPaperExport {
  title: string;
  type: 'homework' | 'exam' | 'acm' | 'oi' | 'practice';
  answers: boolean;
  grouped: boolean;
  sections: Array<{
    kind: ProblemKind | null;
    heading: string;
    drawNote: string | null;
    items: TeachPaperItem[];
  }>;
}

interface DeferredResponse {
  promise: Promise<Response>;
  finish: (response: Response) => void;
}

type FetchMock = ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asComponent(value: unknown): ComponentType {
  expect(typeof value, 'TeachPaperPrintPage').toBe('function');
  if (typeof value !== 'function') throw new TypeError('TeachPaperPrintPage must be a function');
  return value as ComponentType;
}

async function loadPrintPage(): Promise<ComponentType> {
  let load: (() => Promise<unknown>) | undefined;
  for (const [key, candidate] of Object.entries(printLoaders)) {
    if (!key.endsWith(PRINT_SOURCE) || typeof candidate !== 'function') continue;
    load = candidate as () => Promise<unknown>;
  }
  expect(typeof load, `${PRINT_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${PRINT_SOURCE} is missing`);
  const imported: unknown = await load();
  if (!isRecord(imported)) throw new TypeError(`${PRINT_SOURCE} must be a module`);
  return asComponent(readField(imported, 'TeachPaperPrintPage'));
}

function requestUrl(input: unknown): URL {
  if (typeof input === 'string') return new URL(input, 'http://krypton.local');
  if (input instanceof URL) return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  throw new TypeError('unexpected fetch input');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function hydroError(message: string, status = 400): Response {
  return jsonResponse({
    error: {
      name: 'ValidationError',
      errorCode: 'ValidationError',
      code: status,
      status,
      params: [],
      message,
    },
  }, status);
}

function deferredResponse(): DeferredResponse {
  let finish: (response: Response) => void = () => {
    throw new Error('paper response was not armed');
  };
  const promise = new Promise<Response>((done) => {
    finish = done;
  });
  return { promise, finish };
}

function installFetch(respond: (url: URL, init: RequestInit | undefined) => Response | Promise<Response>): FetchMock {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    (input, init) => Promise.resolve(respond(requestUrl(input), init)),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function headerValue(headers: HeadersInit | undefined, name: string): string {
  if (!headers) return '';
  if (headers instanceof Headers) return headers.get(name) ?? '';
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found?.[1] ?? '';
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase() && typeof value === 'string') return value;
  }
  return '';
}

function paperCalls(fetchMock: FetchMock): Array<{ url: URL; init: RequestInit | undefined }> {
  return fetchMock.mock.calls.map((call) => ({ url: requestUrl(call[0]), init: call[1] }));
}

function openedPath(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('window.open url must be a string');
  if (value.startsWith('/')) return value;
  const url = new URL(value, 'http://krypton.local');
  return `${url.pathname}${url.search}`;
}

function problem(fields: {
  docId: number;
  pid: string;
  title: string;
  kind: ProblemKind;
  score: number;
}): TeachPaperProblem {
  return {
    docId: fields.docId,
    pid: fields.pid,
    title: fields.title,
    kind: fields.kind,
    score: fields.score,
    hidden: false,
    mine: true,
    difficulty: null,
  };
}

function workbench(type: TeachType, id: string): TeachWorkbenchPayload {
  return {
    container: {
      type,
      id,
      rule: type,
      title: TITLE,
      status: 'upcoming',
      beginAt: '2026-10-16T06:00:00.000Z',
      endAt: '2026-10-16T08:00:00.000Z',
      durationMinutes: null,
      penaltySince: null,
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
        studentView: `/contest/${id}`,
        scoreboard: null,
        manage: null,
        users: null,
        clarification: null,
        grading: null,
        teams: null,
        balloon: null,
        print: null,
        code: null,
        files: `/contest/${id}/management`,
        redemption: null,
      },
    },
    paper: {
      problems: [
        problem({ docId: 11, pid: 'P1001', title: '栈的基本操作', kind: 'true_false', score: 2 }),
      ],
      stages: null,
      examPaperQuotas: null,
    },
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

function exportItem(fields: TeachPaperItem): TeachPaperItem {
  return fields;
}

function printedPaper(answers: boolean): TeachPaperExport {
  return {
    title: TITLE,
    type: 'homework',
    answers,
    grouped: true,
    sections: [
      {
        kind: 'true_false',
        heading: TRUE_FALSE_HEADING,
        drawNote: null,
        items: [
          exportItem({
            label: '1-1',
            pid: 11,
            title: '栈的基本操作',
            score: 2,
            kind: 'true_false',
            statement: '栈是后进先出。',
            options: null,
            answer: answers ? '对' : null,
          }),
        ],
      },
      {
        kind: 'single',
        heading: SINGLE_HEADING,
        drawNote: DRAW_NOTE,
        items: [
          exportItem({
            label: '2-1',
            pid: 21,
            title: '循环队列长度',
            score: 5,
            kind: 'single',
            statement: '下列哪个是栈？',
            options: ['栈', '队列'],
            answer: answers ? 'B' : null,
          }),
        ],
      },
      {
        kind: 'programming',
        heading: PROGRAM_HEADING,
        drawNote: null,
        items: [
          exportItem({
            label: '7-1',
            pid: 71,
            title: '实现栈',
            score: 10,
            kind: 'programming',
            statement: '实现一个栈。',
            options: null,
            answer: null,
          }),
        ],
      },
    ],
  };
}

function pageBootstrap(data: unknown): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-17T00:00:00.000Z',
    user: {
      id: 7,
      name: 'teacher',
      mail: '',
      signedIn: true,
      theme: 'light',
      viewLang: 'zh_CN',
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
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'teach_paper_print.html', data },
  };
}

function renderProblems(type: TeachType, id: string) {
  return render(
    <BootstrapProvider bootstrap={pageBootstrap({})}>
      <ProblemsTab payload={workbench(type, id)} onNavigateTab={() => undefined} />
    </BootstrapProvider>,
  );
}

async function renderPrint(data: unknown) {
  const Page = await loadPrintPage();
  return render(
    <BootstrapProvider bootstrap={pageBootstrap(data)}>
      <Page />
    </BootstrapProvider>,
  );
}

function exportButton(): HTMLElement {
  const button = screen.getByRole('button', { name: '导出试卷' });
  expect(button).toHaveAttribute('data-variant', 'secondary');
  return button;
}

async function openExportMenu(user: UserEvent): Promise<HTMLElement> {
  await user.click(exportButton());
  return screen.findByRole('menu');
}

function menuLabels(): string[] {
  return screen.getAllByRole('menuitem').map((item) => (item.textContent ?? '').replace(/\s+/g, ' ').trim());
}

function exactText(needle: string) {
  return (_content: string | null, element: Element | null): boolean => {
    if (!(element instanceof HTMLElement)) return false;
    if ((element.textContent ?? '') !== needle) return false;
    return ![...element.children].some((child) => (child.textContent ?? '') === needle);
  };
}

function deepestIncludes(needle: string) {
  return (_content: string | null, element: Element | null): boolean => {
    if (!(element instanceof HTMLElement)) return false;
    if (!(element.textContent ?? '').includes(needle)) return false;
    return ![...element.children].some((child) => (child.textContent ?? '').includes(needle));
  };
}

function hasClassToken(element: Element, token: string): boolean {
  let current: Element | null = element;
  while (current) {
    if ((current.getAttribute('class') ?? '').split(/\s+/).includes(token)) return true;
    current = current.parentElement;
  }
  return false;
}

describe('paper export menu', () => {
  beforeEach(() => {
    downloadBlob.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists the four export actions and opens the answer print page', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderProblems('homework', HOMEWORK_ID);

    await openExportMenu(user);
    expect(menuLabels()).toEqual([...EXPORT_ACTIONS]);

    await user.click(screen.getByRole('menuitem', { name: '打印答案卷' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(openedPath(open.mock.calls[0]?.[0])).toBe(`/teach/homework/${HOMEWORK_ID}/paper?answers=1`);
    expect(open.mock.calls[0]?.[1]).toBe('_blank');
  });

  it('opens the blank print page without an answers query', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderProblems('homework', HOMEWORK_ID);

    await openExportMenu(user);
    await user.click(screen.getByRole('menuitem', { name: '打印空白卷' }));

    expect(openedPath(open.mock.calls[0]?.[0])).toBe(`/teach/homework/${HOMEWORK_ID}/paper`);
    expect(open.mock.calls[0]?.[1]).toBe('_blank');
  });

  it('opens an exam answer print page from the exam type', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderProblems('exam', EXAM_ID);

    await openExportMenu(user);
    await user.click(screen.getByRole('menuitem', { name: '打印答案卷' }));
    expect(openedPath(open.mock.calls[0]?.[0])).toBe(`/teach/exam/${EXAM_ID}/paper?answers=1`);
  });

  it('downloads the blank word paper from the json export', async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(() => jsonResponse(printedPaper(false)));
    renderProblems('homework', HOMEWORK_ID);

    await openExportMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Word 空白卷' }));

    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(downloadBlob).toHaveBeenCalledWith(`${TITLE}-空白卷.docx`, expect.any(Blob));
    const calls = paperCalls(fetchMock);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.pathname).toBe(`/teach/homework/${HOMEWORK_ID}/paper`);
    expect(calls[0]?.url.searchParams.has('answers')).toBe(false);
    expect((calls[0]?.init?.method ?? 'GET').toUpperCase()).toBe('GET');
    expect(headerValue(calls[0]?.init?.headers, 'accept')).toContain('application/json');
  });

  it('downloads the answer word paper from the answers export', async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch((url) => {
      expect(url.pathname).toBe(`/teach/homework/${HOMEWORK_ID}/paper`);
      expect(url.searchParams.get('answers')).toBe('1');
      return jsonResponse(printedPaper(true));
    });
    renderProblems('homework', HOMEWORK_ID);

    await openExportMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Word 答案卷' }));

    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(downloadBlob).toHaveBeenCalledWith(`${TITLE}-答案卷.docx`, expect.any(Blob));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('marks the export button busy until the word file is ready', async () => {
    const user = userEvent.setup();
    const pending = deferredResponse();
    installFetch(() => pending.promise);
    renderProblems('homework', HOMEWORK_ID);

    try {
      await openExportMenu(user);
      await user.click(screen.getByRole('menuitem', { name: 'Word 空白卷' }));
      await waitFor(() => expect(exportButton()).toHaveAttribute('aria-busy', 'true'));
      expect(exportButton()).toBeDisabled();
      pending.finish(jsonResponse(printedPaper(false)));
      await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
      expect(exportButton()).not.toHaveAttribute('aria-busy', 'true');
    } finally {
      pending.finish(jsonResponse(printedPaper(false)));
    }
  });

  it('shows the server message and skips the download when export fails', async () => {
    const user = userEvent.setup();
    installFetch(() => hydroError(SERVER_ERROR));
    renderProblems('homework', HOMEWORK_ID);

    await openExportMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Word 空白卷' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(SERVER_ERROR);
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(exportButton()).not.toHaveAttribute('aria-busy', 'true');
    expect(exportButton()).toBeEnabled();
  });

  it('downloads another blank word file after the first export finishes', async () => {
    const user = userEvent.setup();
    installFetch(() => jsonResponse(printedPaper(false)));
    renderProblems('homework', HOMEWORK_ID);

    await openExportMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Word 空白卷' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(exportButton()).toBeEnabled());

    await openExportMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Word 空白卷' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(2));
    expect(downloadBlob).toHaveBeenNthCalledWith(2, `${TITLE}-空白卷.docx`, expect.any(Blob));
  });
});

describe('paper print page', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the blank paper and prints from the primary button', async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    await renderPrint(printedPaper(false));

    expect(screen.getByText(deepestIncludes(TRUE_FALSE_HEADING))).toBeInTheDocument();
    expect(screen.getByText(deepestIncludes(SINGLE_HEADING))).toBeInTheDocument();
    expect(screen.getByText(deepestIncludes(PROGRAM_HEADING))).toBeInTheDocument();
    expect(screen.getByText(exactText('1-1（2 分）'))).toBeInTheDocument();
    expect(screen.getByText(exactText('2-1（5 分）'))).toBeInTheDocument();
    expect(screen.getByText(exactText('7-1（10 分）'))).toBeInTheDocument();
    expect(screen.getByText(deepestIncludes('栈是后进先出。'))).toBeInTheDocument();
    expect(screen.getByText(deepestIncludes('下列哪个是栈？'))).toBeInTheDocument();
    expect(screen.getByText(deepestIncludes('实现一个栈。'))).toBeInTheDocument();
    expect(screen.getByText(deepestIncludes('A. 栈'))).toBeInTheDocument();
    expect(screen.getByText(deepestIncludes('B. 队列'))).toBeInTheDocument();
    expect(screen.getByText(deepestIncludes(JUDGE_BLANK))).toBeInTheDocument();
    expect(screen.getByText(deepestIncludes(DRAW_NOTE))).toBeInTheDocument();
    expect(screen.getByText(deepestIncludes(IDENTITY_LINE))).toBeInTheDocument();
    expect(screen.getByText(PRINT_NOTE)).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain('答案\uFF1A');
    expect(document.body.textContent ?? '').not.toContain('（无标准答案）');

    const button = screen.getByRole('button', { name: '打印' });
    expect(button).toHaveAttribute('data-variant', 'primary');
    expect(hasClassToken(button, 'print:hidden')).toBe(true);
    await user.click(button);
    expect(print).toHaveBeenCalledTimes(1);
    const printed = document.querySelector('[data-paper-print] style')?.textContent ?? '';
    for (const token of [
      '--brand-fg: oklch(0.5 0.162 268)',
      '--brand-line: oklch(0.86 0.071 268)',
      '--success-fg: oklch(0.5 0.143 152)',
      '--warning-fg: oklch(0.5 0.143 75)',
      '--danger-fg: oklch(0.5 0.181 25)',
      '--info-fg: oklch(0.5 0.124 235)',
      '--violet-fg: oklch(0.5 0.152 300)',
      '--orange-fg: oklch(0.5 0.152 48)',
    ]) {
      expect(printed).toContain(token);
    }
  });

  it('renders choice answers and the no-answer mark on the answer paper', async () => {
    await renderPrint(printedPaper(true));

    expect(screen.getByText(deepestIncludes('答案\uFF1AB'))).toBeInTheDocument();
    expect(screen.getByText(deepestIncludes('答案\uFF1A对'))).toBeInTheDocument();
    expect(screen.getByText(deepestIncludes('（无标准答案）'))).toBeInTheDocument();
    expect(screen.queryByText(deepestIncludes(IDENTITY_LINE))).toBeNull();
  });

  it('rejects a print payload that is not the paper export', async () => {
    const Page = await loadPrintPage();
    expect(() => {
      render(
        <BootstrapProvider bootstrap={pageBootstrap(null)}>
          <Page />
        </BootstrapProvider>,
      );
    }).toThrow();
  });
});
