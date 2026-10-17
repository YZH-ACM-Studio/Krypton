// A static import fails collection while compose/page.tsx is absent.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import {
  afterEach, beforeAll, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { ToastProvider } from '../../src/components/ui/toast.tsx';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { parseHomeworkSnapshot } from '../../src/pages/teach/legacy-forms.ts';
import {
  parseTeachBankPage,
  parseTeachComposePayload,
  parseTeachKnowledgeTree,
} from '../../src/pages/teach/model.ts';

const pageLoaders = import.meta.glob('../../src/pages/teach/compose/page.tsx');

const PAGE_SOURCE = 'src/pages/teach/compose/page.tsx';
const ORIGIN = 'http://krypton.local';
const HOMEWORK_ID = '64b7c3a2e4b0f96d1a2c3d63';
const EXAM_ID = '64b7c3a2e4b0f96d1a2c3d65';
const BEGIN_AT = '2026-10-17T01:00:00.000Z';
const END_AT = '2026-10-17T06:00:00.000Z';
const CREATED_AT = '2026-10-01T00:00:00.000Z';
const RUNNING_TITLE = '进行中的函数作业';
const UPCOMING_TITLE = '即将开始的函数作业';
const EXAM_TITLE = '期中整卷考试';
const RUNNING_BANNER = '这个作业正在进行，改题会影响正在作答的学生。现在是只读。';
const UNLOCK_TITLE = '确定要修改已开始的题目集？';
const UNLOCK_MESSAGE = '正在作答的学生会立刻看到变化；已经抽好的试卷不会重抽。';
const LEAVE_TITLE = '放弃未保存的修改？';
const LEAVE_MESSAGE = '有 1 项修改还没保存，离开后会丢失。';
const SINGLE_TOAST = '已加入 1 道，放在「单选题」页签';
const SAVED_TOAST = '已保存';
const SAVE_REJECTED = '这份作业现在不能改题目。';
const ZERO_CHANGES = '0 项修改未保存';
const ONE_CHANGE = '1 项修改未保存';
const ADDED_DOC = 11;
const ADDED_PID = 'P0011';
const SINGLE_DOC = 202;
const SINGLE_PID = 'P0202';
const PROGRAM_DOC = 101;
const FIRST_DOC = 31;
const SECOND_DOC = 32;
const FIRST_PID = 'P0031';
const SECOND_PID = 'P0032';
const FIRST_TITLE = '第一题走迷宫';
const SECOND_TITLE = '第二题最短路';
const NODE_TITLE = '图论';
const CREATE_STEM = '栈空时 top 为 -1';
const CREATED_DOC = 99;
const CREATED_PID = 'P99';

type User = ReturnType<typeof userEvent.setup>;

interface CapturedRequest {
  url: string;
  method: string;
  body: string;
}

interface HeldFetch {
  finish: (response: Response) => void;
}

interface PointerPoint {
  clientX: number;
  clientY: number;
}

let bankItems: Record<string, unknown>[] = [];
let captured: CapturedRequest[] = [];
let heldCreates: HeldFetch[] = [];
let heldSaves: HeldFetch[] = [];
let restoreLocation: (() => void) | null = null;
let restoreRects: (() => void) | null = null;
let rejectSave = false;
let holdSave = false;
const dragBoxes = new WeakMap<Element, DOMRect>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pageBootstrap(data: Record<string, unknown>): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-17T02:00:00.000Z',
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
    page: { templateName: 'teach_compose.html', data },
  };
}

function pageLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(pageLoaders)) {
    if (key.endsWith(PAGE_SOURCE)) return load;
  }
  return undefined;
}

async function importPageModule(load: () => Promise<unknown>): Promise<unknown> {
  try {
    return await load();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect.fail(message);
  }
}

async function loadTeachComposePage(): Promise<ComponentType> {
  const load = pageLoader();
  expect(typeof load, `${PAGE_SOURCE} must exist`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${PAGE_SOURCE} must exist`);
  const imported = await importPageModule(load);
  if (!isRecord(imported) || typeof imported.TeachComposePage !== 'function') {
    throw new TypeError('TeachComposePage must be exported');
  }
  return imported.TeachComposePage as ComponentType;
}

function links(id: string, kind: 'homework' | 'exam'): Record<string, unknown> {
  if (kind === 'homework') {
    return {
      studentView: `/homework/${id}`,
      scoreboard: `/homework/${id}/scoreboard`,
      manage: null,
      users: null,
      clarification: null,
      grading: null,
      teams: null,
      balloon: null,
      print: null,
      code: null,
      files: `/homework/${id}/file`,
      redemption: null,
    };
  }
  return {
    studentView: `/contest/${id}`,
    scoreboard: `/contest/${id}/scoreboard`,
    manage: `/contest/${id}/management`,
    users: `/contest/${id}/user`,
    clarification: `/contest/${id}/clarification`,
    grading: null,
    teams: null,
    balloon: null,
    print: null,
    code: null,
    files: `/contest/${id}/management`,
    redemption: null,
  };
}

function container(options: {
  type: 'homework' | 'exam';
  id: string;
  rule: string;
  title: string;
  status: 'running' | 'upcoming';
}): Record<string, unknown> {
  return {
    type: options.type,
    id: options.id,
    rule: options.rule,
    title: options.title,
    status: options.status,
    beginAt: BEGIN_AT,
    endAt: END_AT,
    durationMinutes: null,
    penaltySince: null,
    lockAt: null,
    audience: {
      mode: 'groups',
      groupNames: ['计科 2401'],
      schoolNames: [],
      boundStudentCount: 30,
    },
    owner: { uid: 7, name: '王老师' },
    maintainers: [],
    createdAt: CREATED_AT,
    schoolShared: null,
    copiedFrom: null,
    examPassScore: null,
    examAttemptLimit: null,
    participationMode: 'individual',
    vigilEnabled: false,
    entryMode: 'open',
    links: links(options.id, options.type),
  };
}

function paperProblem(docId: number, pid: string, title: string, kind: string, score: number | null): Record<string, unknown> {
  return {
    docId,
    pid,
    title,
    kind,
    score,
    hidden: false,
    mine: true,
    difficulty: null,
  };
}

function composePayload(containerRecord: Record<string, unknown>, problems: Record<string, unknown>[]): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    container: containerRecord,
    paper: {
      problems,
      stages: null,
      examPaperQuotas: null,
    },
    examStartedCount: 0,
    knowledgeOptions: [{ id: 'graph', mapId: 'algo', label: '算法知识图谱 / 图论' }],
    canCreateObjective: true,
  };
  parseTeachComposePayload(raw);
  return raw;
}

function runningHomework(): Record<string, unknown> {
  return composePayload(container({
    type: 'homework',
    id: HOMEWORK_ID,
    rule: 'homework',
    title: RUNNING_TITLE,
    status: 'running',
  }), []);
}

function upcomingHomework(): Record<string, unknown> {
  return composePayload(container({
    type: 'homework',
    id: HOMEWORK_ID,
    rule: 'homework',
    title: UPCOMING_TITLE,
    status: 'upcoming',
  }), []);
}

function twoProblemHomework(): Record<string, unknown> {
  return composePayload(container({
    type: 'homework',
    id: HOMEWORK_ID,
    rule: 'homework',
    title: UPCOMING_TITLE,
    status: 'upcoming',
  }), [
    paperProblem(FIRST_DOC, FIRST_PID, FIRST_TITLE, 'programming', 20),
    paperProblem(SECOND_DOC, SECOND_PID, SECOND_TITLE, 'programming', 10),
  ]);
}

function programmingExam(): Record<string, unknown> {
  return composePayload(container({
    type: 'exam',
    id: EXAM_ID,
    rule: 'exam',
    title: EXAM_TITLE,
    status: 'upcoming',
  }), [
    paperProblem(PROGRAM_DOC, 'P0101', '走迷宫', 'programming', 20),
  ]);
}

function knowledgeTree(): Record<string, unknown> {
  return {
    courses: [{
      id: 'algo',
      title: '算法知识图谱',
      hidden: false,
      total: 2,
      nodes: [{
        id: 'graph', title: NODE_TITLE, count: 2, children: [],
      }],
    }],
  };
}

function bankItem(docId: number, pid: string, title: string, kind: string): Record<string, unknown> {
  return {
    docId,
    pid,
    title,
    kind,
    difficulty: 2,
    tags: [],
    nSubmit: 0,
    nAccept: 0,
    hidden: false,
    mine: true,
    schoolShared: false,
    ownerName: '王老师',
    courseId: 'algo',
    nodePath: [NODE_TITLE],
  };
}

function programmingBankItem(): Record<string, unknown> {
  return bankItem(ADDED_DOC, ADDED_PID, '图的遍历', 'programming');
}

function singleBankItem(): Record<string, unknown> {
  return bankItem(SINGLE_DOC, SINGLE_PID, '下列说法正确的是', 'single');
}

function bankPage(items: Record<string, unknown>[], page: number): Record<string, unknown> {
  return {
    items,
    page,
    pageCount: 1,
    total: items.length,
  };
}

function homeworkSnapshot(): Record<string, unknown> {
  return {
    page_name: 'homework_edit',
    extensionDays: 1,
    dateBeginText: '2026-10-17',
    timeBeginText: '08:00',
    datePenaltyText: '2026-10-24',
    timePenaltyText: '23:59',
    penaltyRules: { 1: 0.9 },
    scopeGroups: [],
    participantScopeMode: 'groups',
    participantGroupIds: ['g1'],
    pids: [8, 9],
    tdoc: {
      _id: HOMEWORK_ID,
      title: UPCOMING_TITLE,
      content: '写出过程',
      pids: [8, 9],
      score: { 8: 1, 9: 2 },
      rated: false,
      maintainer: [7],
      assign: ['class-a'],
      langs: ['py.py3'],
    },
  };
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, ORIGIN);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

function requestMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (typeof input !== 'string' && !(input instanceof URL)) return input.method.toUpperCase();
  return (init?.method ?? 'GET').toUpperCase();
}

async function requestBody(input: RequestInfo | URL, init: RequestInit | undefined): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body instanceof URLSearchParams) return init.body.toString();
  if (typeof input !== 'string' && !(input instanceof URL)) return input.clone().text();
  return '';
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function rejectedSaveResponse(): Response {
  return jsonResponse({
    error: {
      name: 'ValidationError',
      errorCode: 'validation',
      code: 400,
      status: 400,
      params: [],
      message: SAVE_REJECTED,
    },
  }, 400);
}

function route(url: URL, method: string): Response | Promise<Response> {
  if (url.pathname === '/teach-api/knowledge-tree' && method === 'GET') return jsonResponse(knowledgeTree());
  if (url.pathname === '/teach-api/bank' && method === 'GET') {
    const page = Number(url.searchParams.get('page') ?? '1');
    return jsonResponse(bankPage(bankItems, page));
  }
  if (url.pathname === `/homework/${HOMEWORK_ID}/edit`) {
    if (method === 'GET') return jsonResponse(homeworkSnapshot());
    if (method === 'POST') {
      if (holdSave) {
        return new Promise<Response>((finish) => {
          heldSaves.push({ finish });
        });
      }
      return rejectSave ? rejectedSaveResponse() : jsonResponse({});
    }
  }
  if (method === 'POST' && url.pathname.startsWith('/problem/create/')) {
    return new Promise<Response>((finish) => {
      heldCreates.push({ finish });
    });
  }
  return jsonResponse({
    error: {
      name: 'NotFoundError',
      message: `未桩的请求 ${method} ${url.pathname}`,
    },
  }, 404);
}

function installFetch() {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    return requestBody(input, init).then((body) => {
      captured.push({ url: url.href, method, body });
      return route(url, method);
    });
  }));
}

function installLocation(): () => void {
  const assign = vi.fn();
  const saved = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...saved,
      href: saved.href,
      origin: saved.origin,
      pathname: saved.pathname,
      search: saved.search,
      hash: saved.hash,
      assign,
    },
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

async function renderCompose(data: Record<string, unknown>) {
  const Page = await loadTeachComposePage();
  const user = userEvent.setup();
  const view = render(
    <ToastProvider>
      <BootstrapProvider bootstrap={pageBootstrap(data)}>
        <Page />
      </BootstrapProvider>
    </ToastProvider>,
  );
  return { user, ...view };
}

function unsavedNotice(): HTMLElement {
  const lives = [...document.querySelectorAll('[aria-live="polite"]')].filter((element) => (
    /项修改未保存/.test(element.textContent ?? '')
  ));
  const live = lives[0];
  if (lives.length !== 1 || !(live instanceof HTMLElement)) {
    throw new TypeError('unsaved notice is not in an aria-live region');
  }
  return live;
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

async function openBankItem(user: User, pid: string) {
  await user.click(await screen.findByRole('button', { name: NODE_TITLE }));
  expect(await screen.findByRole('button', { name: `加入 ${pid}` })).toBeEnabled();
}

function editCalls(): CapturedRequest[] {
  return captured.filter((call) => new URL(call.url).pathname === `/homework/${HOMEWORK_ID}/edit`);
}

function releaseHeldCreates() {
  const waiting = heldCreates.splice(0, heldCreates.length);
  for (const held of waiting) held.finish(jsonResponse({ pid: CREATED_DOC }));
}

function releaseHeldSaves(response: Response = jsonResponse({})) {
  const waiting = heldSaves.splice(0, heldSaves.length);
  for (const held of waiting) held.finish(response);
}

function postedDocIds(call: CapturedRequest): string[] {
  return (new URLSearchParams(call.body).get('pids') ?? '').split(',').filter((id) => id !== '');
}

function homeworkPostIncludes(docId: number): boolean {
  return editCalls().some((call) => call.method === 'POST' && postedDocIds(call).includes(String(docId)));
}

function paperColumn(): HTMLElement {
  const paper = screen.getByRole('region', { name: '试卷' });
  const column = paper.parentElement?.parentElement;
  if (!(column instanceof HTMLElement)) throw new TypeError('paper column is missing');
  return column;
}

function bankDragRow(pid: string): HTMLElement {
  const row = screen.getAllByText(pid)
    .map((node) => node.closest('[aria-roledescription="可拖动题目"]'))
    .find((node) => node instanceof HTMLElement);
  if (!(row instanceof HTMLElement)) throw new TypeError(`missing bank row ${pid}`);
  return row;
}

function watchHomeworkPosts(sequence: string[]): () => void {
  const current = window.fetch.bind(window);
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await current(input, init);
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    if (method === 'POST' && url.pathname === `/homework/${HOMEWORK_ID}/edit`) sequence.push('post');
    return response;
  };
  window.fetch = wrapped as typeof window.fetch;
  return () => {
    window.fetch = current as typeof window.fetch;
  };
}

function installDragRects(): () => void {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function boundingClientRect() {
    return dragBoxes.get(this) ?? new DOMRect(0, 0, 0, 0);
  };
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
}

function paperPids(): string[] {
  const paper = screen.getByRole('region', { name: '试卷' });
  const pids: string[] = [];
  for (const node of paper.querySelectorAll('span.font-mono')) {
    const text = node.textContent ?? '';
    if (text.startsWith('P')) pids.push(text);
  }
  return pids;
}

function dragHandles(): HTMLElement[] {
  return screen.getAllByRole('button', { name: '拖动排序' });
}

function requireHandle(handles: readonly HTMLElement[], index: number): HTMLElement {
  const handle = handles[index];
  if (!handle) throw new TypeError(`missing drag handle ${index}`);
  return handle;
}

function rowOfHandle(handle: HTMLElement): HTMLElement {
  const row = handle.parentElement;
  if (!(row instanceof HTMLElement)) throw new TypeError('drag handle has no row');
  return row;
}

function toolbar(): HTMLElement {
  const back = screen.getByRole('button', { name: '返回工作台' });
  let current: HTMLElement | null = back.parentElement;
  while (current) {
    if ((current.textContent ?? '').includes('保存')) return current;
    current = current.parentElement;
  }
  throw new TypeError('toolbar is missing');
}

function placeDragLayout(rows: readonly HTMLElement[]) {
  rows.forEach((row, index) => {
    dragBoxes.set(row, new DOMRect(400, 100 + index * 80, 360, 64));
  });
  dragBoxes.set(toolbar(), new DOMRect(0, 0, 800, 48));
  const bank = screen.queryByRole('region', { name: '题库' });
  if (bank) dragBoxes.set(bank, new DOMRect(0, 80, 320, 480));
  dragBoxes.set(screen.getByRole('region', { name: '试卷' }), new DOMRect(360, 80, 440, 480));
}

function pointerInit(point: PointerPoint): PointerEventInit {
  return {
    button: 0,
    buttons: 1,
    isPrimary: true,
    pointerId: 1,
    pointerType: 'mouse',
    clientX: point.clientX,
    clientY: point.clientY,
  };
}

function dragOverlayText(): string {
  const cards = [...document.querySelectorAll('.shadow-pop')];
  return cards.map((card) => card.textContent ?? '').join('');
}

function dragElement(element: HTMLElement, start: PointerPoint, drop: PointerPoint, overlayPid: string) {
  fireEvent.pointerDown(element, pointerInit(start));
  fireEvent.pointerMove(document, pointerInit({ clientX: start.clientX, clientY: start.clientY + 24 }));
  fireEvent.pointerMove(document, pointerInit(drop));
  expect(dragOverlayText(), 'drag did not start').toContain(overlayPid);
  fireEvent.pointerUp(document, pointerInit(drop));
}

function dragFromHandle(handle: HTMLElement, drop: PointerPoint, overlayPid = FIRST_PID) {
  dragElement(handle, { clientX: 420, clientY: 132 }, drop, overlayPid);
}

function dispatchBeforeUnload(): Event {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

beforeAll(() => {
  parseTeachComposePayload(runningHomework());
  parseTeachComposePayload(upcomingHomework());
  parseTeachComposePayload(programmingExam());
  parseTeachComposePayload(twoProblemHomework());
  parseHomeworkSnapshot(homeworkSnapshot());
  parseTeachKnowledgeTree(knowledgeTree());
  parseTeachBankPage(bankPage([programmingBankItem()], 1));
  parseTeachBankPage(bankPage([singleBankItem()], 1));
});

beforeEach(() => {
  bankItems = [];
  captured = [];
  heldCreates = [];
  heldSaves = [];
  rejectSave = false;
  holdSave = false;
  installFetch();
  restoreLocation = installLocation();
  restoreRects = installDragRects();
});

afterEach(async () => {
  // dnd-kit leaves a document click listener for 50ms after a drag, which swallows the next test's click.
  await new Promise((resolve) => {
    setTimeout(resolve, 60);
  });
  holdSave = false;
  releaseHeldSaves();
  releaseHeldCreates();
  restoreRects?.();
  restoreRects = null;
  restoreLocation?.();
  restoreLocation = null;
});

describe('teach compose page', () => {
  it('shows a read-only banner for a running homework and hides it after confirming edits', async () => {
    const { user } = await renderCompose(runningHomework());

    expect(await screen.findByText(RUNNING_BANNER)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '仍要修改' }));
    const dialog = await screen.findByRole('dialog', { name: UNLOCK_TITLE });
    expect(within(dialog).getByText(UNLOCK_MESSAGE)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '仍要修改' }));

    await waitFor(() => {
      expect(screen.queryByText(RUNNING_BANNER)).toBeNull();
    });

    bankItems = [programmingBankItem()];
    await openBankItem(user, ADDED_PID);
    await user.click(screen.getByRole('button', { name: `加入 ${ADDED_PID}` }));
    await waitFor(() => {
      const dirty = unsavedNotice();
      expect(dirty.textContent ?? '').toContain(ONE_CHANGE);
      expect(classTokens(dirty)).not.toContain('invisible');
    });
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  });

  it('keeps the unsaved notice mounted while clean and counts one added problem', async () => {
    bankItems = [programmingBankItem()];
    const { user } = await renderCompose(upcomingHomework());
    expect(await screen.findByText(UPCOMING_TITLE)).toBeInTheDocument();

    const clean = unsavedNotice();
    expect(clean.textContent ?? '').toContain(ZERO_CHANGES);
    expect(classTokens(clean)).toContain('invisible');

    await openBankItem(user, ADDED_PID);
    await user.click(screen.getByRole('button', { name: `加入 ${ADDED_PID}` }));

    await waitFor(() => {
      const dirty = unsavedNotice();
      expect(dirty.textContent ?? '').toContain(ONE_CHANGE);
      expect(classTokens(dirty)).not.toContain('invisible');
    });
  });

  it('toasts when a single-choice problem lands off the programming tab', async () => {
    bankItems = [singleBankItem()];
    const { user } = await renderCompose(programmingExam());

    const kinds = await screen.findByRole('tablist', { name: '题型' });
    expect(within(kinds).getByRole('tab', { name: /编程题/ })).toHaveAttribute('aria-selected', 'true');
    await openBankItem(user, SINGLE_PID);
    await user.click(screen.getByRole('button', { name: `加入 ${SINGLE_PID}` }));

    expect(await screen.findByText(SINGLE_TOAST)).toBeInTheDocument();
  });

  it('reads the legacy snapshot before posting and clears the change count', async () => {
    bankItems = [programmingBankItem()];
    const { user } = await renderCompose(upcomingHomework());
    await openBankItem(user, ADDED_PID);
    await user.click(screen.getByRole('button', { name: `加入 ${ADDED_PID}` }));
    await waitFor(() => {
      expect(unsavedNotice().textContent ?? '').toContain(ONE_CHANGE);
    });

    const save = screen.getByRole('button', { name: '保存' });
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => {
      const edits = editCalls();
      expect(edits.some((call) => call.method === 'GET')).toBe(true);
      expect(edits.some((call) => call.method === 'POST')).toBe(true);
    });
    const edits = editCalls();
    const getIndex = edits.findIndex((call) => call.method === 'GET');
    const postIndex = edits.findIndex((call) => call.method === 'POST');
    expect(getIndex).toBeGreaterThanOrEqual(0);
    expect(postIndex).toBeGreaterThan(getIndex);
    const posted = edits[postIndex];
    if (!posted) throw new TypeError('missing save POST');
    expect(new URLSearchParams(posted.body).get('pids')).toBe(String(ADDED_DOC));

    await waitFor(() => {
      const clean = unsavedNotice();
      expect(clean.textContent ?? '').toContain(ZERO_CHANGES);
      expect(classTokens(clean)).toContain('invisible');
    });
    expect(await screen.findByText(SAVED_TOAST)).toBeInTheDocument();
  });

  it('shows the server message when saving fails and keeps the unsaved change', async () => {
    bankItems = [programmingBankItem()];
    rejectSave = true;
    const { user } = await renderCompose(upcomingHomework());
    await openBankItem(user, ADDED_PID);
    await user.click(screen.getByRole('button', { name: `加入 ${ADDED_PID}` }));
    await waitFor(() => {
      expect(unsavedNotice().textContent ?? '').toContain(ONE_CHANGE);
    });

    await user.click(screen.getByRole('button', { name: '保存' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent ?? '').toContain(SAVE_REJECTED);
    expect(within(alert).getByRole('button', { name: '关闭' })).toBeEnabled();
    expect(screen.queryByText(SAVED_TOAST)).toBeNull();
    expect(unsavedNotice().textContent ?? '').toContain(ONE_CHANGE);

    await user.click(within(alert).getByRole('button', { name: '关闭' }));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    expect(screen.queryByText(SAVE_REJECTED)).toBeNull();
    expect(screen.queryByText(SAVED_TOAST)).toBeNull();
    expect(unsavedNotice().textContent ?? '').toContain(ONE_CHANGE);
  });

  it('asks before leaving the workbench and stays when the teacher cancels', async () => {
    bankItems = [programmingBankItem()];
    const href = window.location.href;
    const { user } = await renderCompose(upcomingHomework());
    await openBankItem(user, ADDED_PID);
    await user.click(screen.getByRole('button', { name: `加入 ${ADDED_PID}` }));
    await waitFor(() => {
      expect(unsavedNotice().textContent ?? '').toContain(ONE_CHANGE);
    });

    await user.click(screen.getByRole('button', { name: '返回工作台' }));
    const dialog = await screen.findByRole('dialog', { name: LEAVE_TITLE });
    expect(within(dialog).getByText(LEAVE_MESSAGE)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '放弃并离开' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '取消' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: LEAVE_TITLE })).toBeNull();
    });
    expect(locationAssign()).not.toHaveBeenCalled();
    expect(window.location.href).toBe(href);
    expect(screen.getByText(UPCOMING_TITLE)).toBeInTheDocument();
    expect(unsavedNotice().textContent ?? '').toContain(ONE_CHANGE);
  });

  it('keeps both problems when the first is dropped on the toolbar', async () => {
    await renderCompose(twoProblemHomework());
    expect(await screen.findByText(FIRST_TITLE)).toBeInTheDocument();
    const handles = dragHandles();
    const rows = handles.map(rowOfHandle);
    expect(paperPids()).toEqual([FIRST_PID, SECOND_PID]);
    placeDragLayout(rows);

    dragFromHandle(requireHandle(handles, 0), { clientX: 200, clientY: 24 });

    expect(paperPids()).toEqual([FIRST_PID, SECOND_PID]);
    const paper = screen.getByRole('region', { name: '试卷' });
    expect(within(paper).getByText(FIRST_TITLE)).toBeInTheDocument();
    expect(within(paper).getByText(SECOND_TITLE)).toBeInTheDocument();
  });

  it('keeps the first problem ahead when it is dropped on the second row', async () => {
    await renderCompose(twoProblemHomework());
    expect(await screen.findByText(SECOND_TITLE)).toBeInTheDocument();
    const handles = dragHandles();
    const rows = handles.map(rowOfHandle);
    expect(paperPids()).toEqual([FIRST_PID, SECOND_PID]);
    placeDragLayout(rows);
    const second = rows[1];
    if (!second) throw new TypeError('missing second paper row');

    // The page inserts before the hovered row, so the first problem stays first.
    dragFromHandle(requireHandle(handles, 0), { clientX: 580, clientY: 212 });

    expect(paperPids()).toEqual([FIRST_PID, SECOND_PID]);
  });

  it('moves the second problem before the first when dropped on its top half', async () => {
    await renderCompose(twoProblemHomework());
    expect(await screen.findByText(FIRST_TITLE)).toBeInTheDocument();
    const handles = dragHandles();
    const rows = handles.map(rowOfHandle);
    expect(paperPids()).toEqual([FIRST_PID, SECOND_PID]);
    placeDragLayout(rows);
    const first = rows[0];
    if (!first) throw new TypeError('missing first paper row');
    const box = dragBoxes.get(first);
    if (!box) throw new TypeError('missing first row box');

    dragFromHandle(requireHandle(handles, 1), {
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height / 4,
    }, SECOND_PID);

    expect(paperPids()).toEqual([SECOND_PID, FIRST_PID]);
  });

  it('appends a bank problem dropped on the blank below the paper cards', async () => {
    bankItems = [programmingBankItem()];
    const { user } = await renderCompose(twoProblemHomework());
    expect(await screen.findByText(FIRST_TITLE)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: NODE_TITLE }));
    expect(await screen.findByRole('button', { name: `加入 ${ADDED_PID}` }, { timeout: 3000 })).toBeEnabled();
    const handles = dragHandles();
    const rows = handles.map(rowOfHandle);
    expect(paperPids()).toEqual([FIRST_PID, SECOND_PID]);
    placeDragLayout(rows);
    dragBoxes.set(paperColumn(), new DOMRect(360, 80, 440, 480));

    dragElement(bankDragRow(ADDED_PID), { clientX: 80, clientY: 200 }, { clientX: 580, clientY: 400 }, ADDED_PID);

    expect(paperPids()).toEqual([FIRST_PID, SECOND_PID, ADDED_PID]);
  });

  it('blocks beforeunload while a clean paper waits on objective creation', async () => {
    const { user } = await renderCompose(upcomingHomework());
    expect(await screen.findByText(UPCOMING_TITLE)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: NODE_TITLE }));
    await user.click(await screen.findByRole('button', { name: '新建' }));
    await user.click(await screen.findByRole('menuitem', { name: '新建判断题' }));
    expect(await screen.findByRole('heading', { name: '新建判断题' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /题干/ }), CREATE_STEM);
    await user.click(screen.getByRole('button', { name: '保存并加入试卷' }));

    await waitFor(() => {
      expect(heldCreates).toHaveLength(1);
    });
    expect(screen.getByRole('heading', { name: '新建判断题' })).toBeInTheDocument();
    expect(unsavedNotice().textContent ?? '').toContain(ZERO_CHANGES);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    await user.click(screen.getByRole('button', { name: '返回工作台' }));
    expect(locationAssign()).not.toHaveBeenCalled();

    const sequence: string[] = [];
    locationAssign().mockImplementation(() => {
      sequence.push('assign');
    });
    const restoreFetch = watchHomeworkPosts(sequence);
    try {
      releaseHeldCreates();
      await waitFor(() => {
        const postBeforeLeave = sequence.includes('post')
          && sequence.includes('assign')
          && sequence.indexOf('post') < sequence.indexOf('assign')
          && homeworkPostIncludes(CREATED_DOC);
        const confirmWhileKept = !sequence.includes('assign')
          && screen.queryByRole('dialog', { name: LEAVE_TITLE }) !== null
          && paperPids().includes(CREATED_PID);
        expect(postBeforeLeave || confirmWhileKept).toBe(true);
      });
    } finally {
      restoreFetch();
    }
    expect(await screen.findByText(`已新建 ${CREATED_PID} 并加入「判断题」`)).toBeInTheDocument();
  });

  it('leaves immediately when the create sheet has not been submitted', async () => {
    const { user } = await renderCompose(upcomingHomework());
    expect(await screen.findByText(UPCOMING_TITLE)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: NODE_TITLE }));
    await user.click(await screen.findByRole('button', { name: '新建' }));
    await user.click(await screen.findByRole('menuitem', { name: '新建判断题' }));
    expect(await screen.findByRole('heading', { name: '新建判断题' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存并加入试卷' }).getAttribute('aria-busy')).not.toBe('true');

    await user.click(screen.getByRole('button', { name: '返回工作台' }));

    expect(locationAssign()).toHaveBeenCalledWith(`/teach/homework/${HOMEWORK_ID}?tab=problems`);
  });

  it('assigns as soon as leaving a dirty paper is confirmed, even while the create sheet is open', async () => {
    bankItems = [programmingBankItem()];
    const { user } = await renderCompose(upcomingHomework());
    await openBankItem(user, ADDED_PID);
    await user.click(screen.getByRole('button', { name: `加入 ${ADDED_PID}` }));
    await waitFor(() => {
      expect(unsavedNotice().textContent ?? '').toContain(ONE_CHANGE);
    });
    await user.click(await screen.findByRole('button', { name: '新建' }));
    await user.click(await screen.findByRole('menuitem', { name: '新建判断题' }));
    expect(await screen.findByRole('heading', { name: '新建判断题' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '返回工作台' }));
    const dialog = await screen.findByRole('dialog', { name: LEAVE_TITLE });
    await user.click(within(dialog).getByRole('button', { name: '放弃并离开' }));

    expect(locationAssign()).toHaveBeenCalledWith(`/teach/homework/${HOMEWORK_ID}?tab=problems`);
    expect(screen.getByRole('heading', { name: '新建判断题' })).toBeInTheDocument();
  });

  it('keeps a score edit out of the save that follows a created problem, and stays on failure', async () => {
    const { user } = await renderCompose(upcomingHomework());
    expect(await screen.findByText(UPCOMING_TITLE)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: NODE_TITLE }));
    await user.click(await screen.findByRole('button', { name: '新建' }));
    await user.click(await screen.findByRole('menuitem', { name: '新建判断题' }));
    await user.type(screen.getByRole('textbox', { name: /题干/ }), CREATE_STEM);
    await user.click(screen.getByRole('button', { name: '保存并加入试卷' }));
    await waitFor(() => {
      expect(heldCreates).toHaveLength(1);
    });
    await user.click(screen.getByRole('button', { name: '返回工作台' }));
    expect(locationAssign()).not.toHaveBeenCalled();

    holdSave = true;
    releaseHeldCreates();
    await waitFor(() => {
      expect(heldSaves).toHaveLength(1);
    });
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    const score = screen.getByRole('spinbutton', { name: '判断题每题分值' });
    expect(score).toBeDisabled();
    const posted = editCalls().find((call) => call.method === 'POST');
    if (!posted) throw new TypeError('missing save POST');
    const scores = new URLSearchParams(posted.body).get('problemScores');
    fireEvent.change(score, { target: { value: '9' } });
    fireEvent.blur(score);
    expect(new URLSearchParams(posted.body).get('problemScores')).toBe(scores);
    expect(postedDocIds(posted)).toContain(String(CREATED_DOC));

    releaseHeldSaves(rejectedSaveResponse());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent ?? '').toContain(SAVE_REJECTED);
    expect(locationAssign()).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  });

  it('allows beforeunload when the paper is clean and the create sheet is closed', async () => {
    await renderCompose(upcomingHomework());
    expect(await screen.findByText(UPCOMING_TITLE)).toBeInTheDocument();
    expect(unsavedNotice().textContent ?? '').toContain(ZERO_CHANGES);
    expect(screen.queryByRole('heading', { name: '新建判断题' })).toBeNull();
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });
});
