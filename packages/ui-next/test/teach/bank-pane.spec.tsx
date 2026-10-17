// Static imports fail collection while the compose bank modules are absent.
import { useState, type ComponentType } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { ToastProvider } from '../../src/components/ui/toast.tsx';

const paneLoaders = import.meta.glob('../../src/pages/teach/compose/bank-pane.tsx');
const previewLoaders = import.meta.glob('../../src/pages/teach/compose/bank-preview.tsx');

const PANE_SOURCE = 'src/pages/teach/compose/bank-pane.tsx';
const PREVIEW_SOURCE = 'src/pages/teach/compose/bank-preview.tsx';
const ORIGIN = 'http://krypton.local';
const SHARE_ERROR = '这道题不能共享。';
const PREVIEW_CONTENT = '给定一张无向图。';
const TREE_NOTE = '数字是这个知识点（含下级）里你能选、而且这个比赛能用的题。';
const HIDDEN_KINDS = ['判断题', '单选题', '多选题', '填空题', '主观题'] as const;

type TeachType = 'practice' | 'homework' | 'exam' | 'acm' | 'oi';
type BasicObjectiveKind = 'single' | 'multi' | 'true_false' | 'blank';
type User = ReturnType<typeof userEvent.setup>;

interface KnowledgeNode {
  id: string;
  title: string;
  count: number;
  children: KnowledgeNode[];
}

interface KnowledgeCourse {
  id: string;
  title: string;
  hidden: boolean;
  total: number;
  nodes: KnowledgeNode[];
}

interface BankItem {
  docId: number;
  pid: string;
  title: string;
  kind: string;
  difficulty: number | null;
  tags: string[];
  nSubmit: number;
  nAccept: number;
  hidden: boolean;
  mine: boolean;
  schoolShared: boolean;
  ownerName: string;
  courseId: string | null;
  nodePath: string[];
}

interface CapturedRequest {
  url: string;
  method: string;
  body: string;
}

interface HeldResponse {
  url: string;
  finish: (response: Response) => void;
}

interface BankPaneProps {
  type: TeachType;
  locked: boolean;
  inPaper: ReadonlySet<number>;
  selection: ReadonlySet<number>;
  onToggleSelect: (docId: number, on: boolean) => void;
  onClearSelection: () => void;
  onAdd: (items: BankItem[]) => void;
  onCreateObjective: (kind: BasicObjectiveKind, node: { courseId: string; nodeId: string } | null) => void;
  onItemsLoaded: (items: BankItem[]) => void;
  refreshToken: number;
}

interface HarnessProps {
  Pane: ComponentType<BankPaneProps>;
  type: TeachType;
  locked: boolean;
  paper: ReadonlySet<number>;
  keyboard: boolean;
  onDragStart?: () => void;
  onAdd: (items: BankItem[]) => void;
  onCreateObjective: BankPaneProps['onCreateObjective'];
  onItemsLoaded: (items: BankItem[]) => void;
}

interface RenderOptions {
  type: TeachType;
  locked?: boolean;
  inPaper?: readonly number[];
  keyboard?: boolean;
  onDragStart?: () => void;
}

let tree: { courses: KnowledgeCourse[] } = { courses: [] };
let bankItems: BankItem[] = [];
let bankPageCount = 1;
let shareFails = false;
let captured: CapturedRequest[] = [];
let heldBanks: HeldResponse[] = [];
let holdQuery = '';
let pageFailuresLeft = new Map<number, number>();
let pageItems: Map<number, BankItem[]> | null = null;

function knowledgeNode(id: string, title: string, count: number, children: KnowledgeNode[] = []): KnowledgeNode {
  return {
    id, title, count, children,
  };
}

function course(id: string, title: string, total: number, hidden: boolean, nodes: KnowledgeNode[]): KnowledgeCourse {
  return {
    id, title, hidden, total, nodes,
  };
}

function algoTree(): { courses: KnowledgeCourse[] } {
  return {
    courses: [
      course('empty', '空课程', 0, false, [knowledgeNode('empty-node', '空节点', 0)]),
      course('algo', '算法知识图谱', 4, false, [
        knowledgeNode('graph', '图论', 2),
        knowledgeNode('ds', '数据结构', 2, [knowledgeNode('stack', '栈', 2)]),
      ]),
      course('safe', '学校安全', 1, true, [knowledgeNode('fire', '消防安全', 1)]),
    ],
  };
}

function emptyTree(): { courses: KnowledgeCourse[] } {
  return {
    courses: [
      course('first', '先出现的课', 0, false, [knowledgeNode('first-node', '先出现的点', 0)]),
      course('second', '后出现的课', 0, false, [knowledgeNode('second-node', '后出现的点', 0)]),
    ],
  };
}

function bankItem(overrides: Partial<BankItem> & Pick<BankItem, 'docId' | 'pid' | 'title' | 'kind'>): BankItem {
  return {
    difficulty: 2,
    tags: ['图'],
    nSubmit: 8,
    nAccept: 3,
    hidden: false,
    mine: true,
    schoolShared: false,
    ownerName: '王老师',
    courseId: 'algo',
    nodePath: ['图论'],
    ...overrides,
  };
}

const TRAVERSAL = bankItem({
  docId: 11, pid: 'P0011', title: '图的遍历', kind: 'programming',
});
const SHORTEST = bankItem({
  docId: 12,
  pid: 'P0012',
  title: '最短路',
  kind: 'programming',
  mine: false,
  ownerName: '郑老师',
});
const MINE_SINGLE = bankItem({
  docId: 31,
  pid: 'P0031',
  title: '我的单选题',
  kind: 'single',
  hidden: true,
  mine: true,
  schoolShared: false,
});
const OTHER_SINGLE = bankItem({
  docId: 32,
  pid: 'P0032',
  title: '别人的单选题',
  kind: 'single',
  hidden: true,
  mine: false,
  schoolShared: true,
  ownerName: '郑老师',
});
const ONCE = bankItem({
  docId: 21,
  pid: 'P0021',
  title: '只交过一次',
  kind: 'programming',
  nSubmit: 1,
  nAccept: 1,
  tags: [],
});
const NEVER = bankItem({
  docId: 22,
  pid: 'P0022',
  title: '还没人交',
  kind: 'programming',
  nSubmit: 0,
  nAccept: 0,
  tags: [],
});
const PUBLIC_SHARED = bankItem({
  docId: 41,
  pid: 'P0041',
  title: '公开但带共享标记',
  kind: 'programming',
  hidden: false,
  mine: false,
  schoolShared: true,
  ownerName: '郑老师',
  tags: [],
});
const HIDDEN_SHARED = bankItem({
  docId: 42,
  pid: 'P0042',
  title: '别人共享的隐藏题',
  kind: 'programming',
  hidden: true,
  mine: false,
  schoolShared: true,
  ownerName: '郑老师',
  tags: [],
});
const MINE_SHARED = bankItem({
  docId: 43,
  pid: 'P0043',
  title: '我共享的隐藏题',
  kind: 'programming',
  hidden: true,
  mine: true,
  schoolShared: true,
  ownerName: '王老师',
  tags: [],
});
const TRUE_FALSE = bankItem({
  docId: 51,
  pid: 'P0051',
  title: '判断对错',
  kind: 'true_false',
  tags: [],
  nSubmit: 0,
  nAccept: 0,
});
const LONG_SINGLE = bankItem({
  docId: 61,
  pid: 'P0061',
  title: '选项很多的单选题',
  kind: 'single',
  hidden: true,
  mine: true,
  tags: [],
  nSubmit: 0,
  nAccept: 0,
});
const LONG_OPTION_COUNT = 27;
const PAGE_LOAD_ERROR = '加载题目失败';
const TOO_MANY_OPTIONS = '选项超过 26 个，无法按字母显示。';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function classTokens(className: string | null): string[] {
  return (className ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function hasClassNear(element: Element, token: string): boolean {
  if (classTokens(element.getAttribute('class')).includes(token)) return true;
  if ([...element.querySelectorAll('*')].some((child) => classTokens(child.getAttribute('class')).includes(token))) {
    return true;
  }
  const parent = element.parentElement;
  return parent !== null && classTokens(parent.getAttribute('class')).includes(token);
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
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

function hydroError(message: string, status = 403): Response {
  return jsonResponse({
    error: {
      name: 'PermissionError',
      errorCode: 'permission',
      code: status,
      status,
      params: [],
      message,
    },
  }, status);
}

function longOptions(): string[] {
  const options: string[] = [];
  for (let number = 1; number <= LONG_OPTION_COUNT; number += 1) options.push(`选项${number}`);
  return options;
}

function objectiveOf(docId: number): Record<string, unknown> | null {
  if (docId === MINE_SINGLE.docId) {
    return { kind: 'single', options: ['错误说法', '正确说法'], answerIndex: 1 };
  }
  if (docId === TRUE_FALSE.docId) return { kind: 'true_false', answer: true };
  if (docId === LONG_SINGLE.docId) return { kind: 'single', options: longOptions(), answerIndex: 0 };
  return null;
}

function previewBody(docId: number): Record<string, unknown> | null {
  const item = bankItems.find((entry) => entry.docId === docId);
  if (!item) return null;
  return {
    item,
    content: PREVIEW_CONTENT,
    objective: objectiveOf(docId),
    limits: { timeMs: 1000, memoryMb: 128 },
  };
}

function route(url: URL, method: string): Response | Promise<Response> {
  if (url.pathname === '/teach-api/knowledge-tree') return jsonResponse(tree);
  if (url.pathname === '/teach-api/bank') {
    const page = Number(url.searchParams.get('page') ?? '1');
    const q = url.searchParams.get('q') ?? '';
    if (holdQuery !== '' && q === holdQuery) {
      return new Promise<Response>((finish) => {
        heldBanks.push({ url: url.href, finish });
      });
    }
    const failures = pageFailuresLeft.get(page) ?? 0;
    if (failures > 0) {
      pageFailuresLeft.set(page, failures - 1);
      return hydroError(PAGE_LOAD_ERROR);
    }
    const items = pageItems?.get(page) ?? bankItems;
    return jsonResponse({
      items,
      page,
      pageCount: bankPageCount,
      total: items.length,
    });
  }
  const preview = /^\/teach-api\/bank\/(\d+)$/.exec(url.pathname);
  if (preview) {
    const docId = Number(preview[1]);
    const body = previewBody(docId);
    if (!body) return hydroError(`题目 ${docId} 不在桩里`, 404);
    return jsonResponse(body);
  }
  if (url.pathname === '/problem/school-bank' && method === 'POST') {
    if (shareFails) return hydroError(SHARE_ERROR);
    return jsonResponse({ changed: [MINE_SINGLE.docId], unchanged: [] });
  }
  return hydroError(`未桩的请求 ${method} ${url.pathname}`, 404);
}

function installFetch() {
  captured = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    const body = await requestBody(input, init);
    captured.push({ url, method, body });
    return route(new URL(url, ORIGIN), method);
  }));
}

function callsTo(pathname: string): CapturedRequest[] {
  return captured.filter((call) => new URL(call.url, ORIGIN).pathname === pathname);
}

function latestBankUrl(): string {
  const calls = callsTo('/teach-api/bank');
  const last = calls[calls.length - 1];
  if (!last) throw new TypeError('bank was not requested');
  return last.url;
}

function excludeIds(url: string): number[] {
  const raw = new URL(url, ORIGIN).searchParams.get('exclude') ?? '';
  if (raw === '') return [];
  return raw.split(',').map((part) => Number(part)).sort((left, right) => left - right);
}

function bankPages(): string[] {
  return callsTo('/teach-api/bank').map((call) => new URL(call.url, ORIGIN).searchParams.get('page') ?? '');
}

function releaseHeldBanks(body: unknown) {
  const waiting = heldBanks.splice(0, heldBanks.length);
  if (waiting.length === 0) throw new TypeError('no held bank request');
  for (const held of waiting) held.finish(jsonResponse(body));
}

function writeSearch(value: string) {
  const input = screen.getByRole('searchbox', { name: '题号、标题或标签', hidden: true });
  if (!(input instanceof HTMLInputElement)) throw new TypeError('search box is not an input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new TypeError('missing input value setter');
  const tracker: unknown = Reflect.get(input, '_valueTracker');
  act(() => {
    if (isRecord(tracker) && typeof tracker.setValue === 'function') {
      Reflect.apply(tracker.setValue, tracker, ['']);
    }
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function sharePosts(): CapturedRequest[] {
  return captured.filter((call) => {
    const url = new URL(call.url, ORIGIN);
    return url.pathname === '/problem/school-bank' && call.method === 'POST';
  });
}

function parseShare(raw: string): { docIds: number[]; shared: boolean } {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || !Array.isArray(parsed.docIds) || typeof parsed.shared !== 'boolean') {
    throw new TypeError('school bank body has the wrong shape');
  }
  const docIds: number[] = [];
  for (const id of parsed.docIds) {
    if (typeof id !== 'number' || !Number.isInteger(id)) throw new TypeError('school bank docId is not an integer');
    docIds.push(id);
  }
  return { docIds, shared: parsed.shared };
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function loaderFor(source: string): (() => Promise<unknown>) | undefined {
  const groups = source === PREVIEW_SOURCE ? previewLoaders : paneLoaders;
  for (const [key, load] of Object.entries(groups)) {
    if (key.endsWith(source)) return () => load();
  }
  return undefined;
}

async function importModule(source: string): Promise<object> {
  const load = loaderFor(source);
  expect(typeof load, source).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${source} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${source} must be a module`);
  return imported;
}

async function loadBankPane(): Promise<ComponentType<BankPaneProps>> {
  const paneModule = await importModule(PANE_SOURCE);
  const previewModule = await importModule(PREVIEW_SOURCE);
  const preview = readField(previewModule, 'BankPreview');
  const pane = readField(paneModule, 'BankPane');
  if (typeof preview !== 'function') throw new TypeError('BankPreview must be a function');
  if (typeof pane !== 'function') throw new TypeError('BankPane must be a function');
  return pane as ComponentType<BankPaneProps>;
}

function BankHarness({
  Pane,
  type,
  locked,
  paper,
  keyboard,
  onDragStart,
  onAdd,
  onCreateObjective,
  onItemsLoaded,
}: HarnessProps) {
  const [selection, setSelection] = useState<ReadonlySet<number>>(() => new Set());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );
  return (
    <ToastProvider>
      <DndContext sensors={keyboard ? sensors : undefined} onDragStart={onDragStart}>
        <Pane
          type={type}
          locked={locked}
          inPaper={paper}
          selection={selection}
          onToggleSelect={(docId, on) => {
            setSelection((current) => {
              const next = new Set(current);
              if (on) next.add(docId);
              else next.delete(docId);
              return next;
            });
          }}
          onClearSelection={() => setSelection(new Set())}
          onAdd={onAdd}
          onCreateObjective={onCreateObjective}
          onItemsLoaded={onItemsLoaded}
          refreshToken={0}
        />
      </DndContext>
    </ToastProvider>
  );
}

function renderPane(Pane: ComponentType<BankPaneProps>, options: RenderOptions) {
  const onAdd = vi.fn<(items: BankItem[]) => void>();
  const onCreateObjective = vi.fn<BankPaneProps['onCreateObjective']>();
  const onItemsLoaded = vi.fn<(items: BankItem[]) => void>();
  const paper = new Set(options.inPaper ?? []);
  const view = render(
    <BankHarness
      Pane={Pane}
      type={options.type}
      locked={options.locked ?? false}
      paper={paper}
      keyboard={options.keyboard ?? false}
      onDragStart={options.onDragStart}
      onAdd={onAdd}
      onCreateObjective={onCreateObjective}
      onItemsLoaded={onItemsLoaded}
    />,
  );
  return {
    onAdd, onCreateObjective, onItemsLoaded, ...view,
  };
}

async function renderLoaded(options: RenderOptions) {
  const Pane = await loadBankPane();
  const user = userEvent.setup();
  return { user, ...renderPane(Pane, options) };
}

async function openNode(user: User, name: string) {
  await screen.findByRole('button', { name });
  await user.click(screen.getByRole('button', { name }));
}

function answerRow(dialog: HTMLElement, label: string): HTMLElement {
  const labels = within(dialog).getAllByText(label).filter((element) => element.tagName === 'SPAN');
  const row = labels[0]?.parentElement;
  if (!row || labels.length !== 1) throw new TypeError(`missing answer row for ${label}`);
  return row;
}

function previewMeta(dialog: HTMLElement): string {
  const metas = [...dialog.querySelectorAll('p')].filter((paragraph) => {
    const text = paragraph.textContent ?? '';
    return text.includes('学校题库') || text.includes('我的题目');
  });
  const meta = metas[0];
  if (!meta || metas.length !== 1) throw new TypeError('missing preview meta');
  return meta.textContent ?? '';
}

function rowOf(pid: string, hidden = false): HTMLElement {
  const checkbox = screen.getByRole('checkbox', { name: `选择 ${pid}`, hidden });
  let current: HTMLElement | null = checkbox.parentElement;
  let found: HTMLElement | null = null;
  while (current) {
    const boxes = [...current.querySelectorAll('input')].filter((input) => input.getAttribute('aria-label') === `选择 ${pid}`);
    if (boxes.length === 1 && (current.textContent ?? '').includes(pid)) found = current;
    current = current.parentElement;
  }
  if (!found) throw new TypeError(`missing row for ${pid}`);
  return found;
}

function successChecks(scope: ParentNode): Element[] {
  return [...scope.querySelectorAll('svg')].filter((icon) => {
    if (icon.tagName.toLowerCase() !== 'svg') return false;
    if (!classTokens(icon.getAttribute('class')).includes('lucide-check')) return false;
    let current: Element | null = icon;
    while (current) {
      if (classTokens(current.getAttribute('class')).includes('text-success-fg')) return true;
      if (current === scope) break;
      current = current.parentElement;
    }
    return false;
  });
}

function hiddenKindNote(): HTMLElement {
  const matches = screen.getAllByText((_, element) => {
    if (!(element instanceof HTMLElement)) return false;
    const text = element.textContent ?? '';
    return text.includes('比赛不能加') && text.includes('已经隐藏');
  });
  const note = [...matches].sort((left, right) => (left.textContent ?? '').length - (right.textContent ?? '').length)[0];
  if (!note) throw new TypeError('missing hidden-kind note');
  return note;
}

function loadedDocIds(onItemsLoaded: { mock: { calls: unknown[][] } }): number[] {
  const calls = onItemsLoaded.mock.calls;
  const last = calls[calls.length - 1];
  if (!last || !Array.isArray(last[0])) throw new TypeError('onItemsLoaded was not called with items');
  const ids: number[] = [];
  for (const item of last[0]) {
    if (!isRecord(item) || typeof item.docId !== 'number') throw new TypeError('loaded item is missing docId');
    ids.push(item.docId);
  }
  return ids;
}

function addedDocIds(onAdd: { mock: { calls: unknown[][] } }): number[] {
  expect(onAdd.mock.calls).toHaveLength(1);
  const first = onAdd.mock.calls[0];
  if (!first || !Array.isArray(first[0])) throw new TypeError('onAdd was not called with items');
  const ids: number[] = [];
  for (const item of first[0]) {
    if (!isRecord(item) || typeof item.docId !== 'number') throw new TypeError('added item is missing docId');
    ids.push(item.docId);
  }
  return ids.sort((left, right) => left - right);
}

async function openPreview(user: User, title: string): Promise<HTMLElement> {
  const button = screen.getAllByRole('button').find((candidate) => {
    const name = candidate.getAttribute('aria-label') ?? candidate.textContent ?? '';
    return name.includes(title) && !name.startsWith('加入');
  });
  if (!button) throw new TypeError(`missing preview control for ${title}`);
  await user.click(button);
  return screen.findByRole('dialog', { name: '题目预览' });
}

async function closePreview(user: User) {
  const dialog = screen.getByRole('dialog', { name: '题目预览' });
  expect(within(dialog).getAllByRole('button').some((button) => {
    const name = button.getAttribute('aria-label') ?? button.textContent ?? '';
    return name.includes('关闭');
  })).toBe(true);
  dialog.tabIndex = -1;
  dialog.focus();
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: '题目预览' })).toBeNull();
  });
}

beforeEach(() => {
  tree = algoTree();
  bankItems = [];
  bankPageCount = 1;
  shareFails = false;
  heldBanks = [];
  holdQuery = '';
  pageFailuresLeft = new Map();
  pageItems = null;
  installFetch();
});

afterEach(() => {
  const pending = heldBanks.splice(0, heldBanks.length);
  for (const held of pending) {
    held.finish(jsonResponse({
      items: [], page: 1, pageCount: 1, total: 0,
    }));
  }
  vi.unstubAllGlobals();
});

describe('compose bank pane', () => {
  it('requests the acm knowledge tree and selects the first course that has problems', async () => {
    await renderLoaded({ type: 'acm' });

    expect(await screen.findByRole('button', { name: '图论' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '题库' })).toBeInTheDocument();
    expect(screen.getByText('课程')).toBeInTheDocument();
    const boxes = screen.getAllByRole('combobox');
    expect(boxes.some((box) => (box.textContent ?? '').includes('算法知识图谱'))).toBe(true);
    expect(boxes.some((box) => (box.textContent ?? '').includes('空课程'))).toBe(false);
    expect(screen.getByRole('button', { name: '全部知识点' })).toBeInTheDocument();
    expect(hasClassNear(screen.getByRole('button', { name: '全部知识点' }), 'font-medium')).toBe(true);
    expect(screen.getByRole('button', { name: '数据结构' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '空节点' })).toBeNull();
    expect(screen.queryByRole('button', { name: '消防安全' })).toBeNull();
    expect(screen.getByText(TREE_NOTE)).toBeInTheDocument();

    const treeCalls = callsTo('/teach-api/knowledge-tree');
    expect(treeCalls.length).toBeGreaterThan(0);
    for (const call of treeCalls) {
      const url = new URL(call.url, ORIGIN);
      expect(call.method).toBe('GET');
      expect(url.pathname).toBe('/teach-api/knowledge-tree');
      expect(url.searchParams.get('type')).toBe('acm');
    }
  });

  it('selects the first course when every course total is zero', async () => {
    tree = emptyTree();
    await renderLoaded({ type: 'acm' });

    expect(await screen.findByRole('button', { name: '先出现的点' })).toBeInTheDocument();
    expect(screen.getByRole('combobox').textContent ?? '').toContain('先出现的课');
    expect(screen.queryByRole('button', { name: '后出现的点' })).toBeNull();
  });

  it('loads the chosen node and returns to the tree', async () => {
    bankItems = [TRAVERSAL, SHORTEST];
    const { user, onItemsLoaded } = await renderLoaded({ type: 'acm' });
    await openNode(user, '图论');

    expect(await screen.findByRole('button', { name: '回到知识点树' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '算法知识图谱' })).toBeInTheDocument();
    expect(hasClassNear(screen.getByText('图论'), 'font-medium')).toBe(true);
    expect(await screen.findByText('图的遍历')).toBeInTheDocument();
    const bankCalls = callsTo('/teach-api/bank');
    expect(bankCalls.length).toBeGreaterThan(0);
    const query = new URL(latestBankUrl(), ORIGIN).searchParams;
    expect(query.get('type')).toBe('acm');
    expect(query.get('course')).toBe('algo');
    expect(query.get('node')).toBe('graph');
    await waitFor(() => {
      expect(loadedDocIds(onItemsLoaded).sort((left, right) => left - right)).toEqual([11, 12]);
    });
    const note = hiddenKindNote().textContent ?? '';
    let previous = -1;
    for (const kind of HIDDEN_KINDS) {
      const index = note.indexOf(kind);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
    expect(note.includes('程序填空题')).toBe(false);
    expect(note.includes('函数题')).toBe(false);
    expect(note.includes('编程题')).toBe(false);

    await user.click(screen.getByRole('button', { name: '回到知识点树' }));

    expect(await screen.findByRole('button', { name: '全部知识点' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '图论' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '回到知识点树' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: '只看未加入的' })).toBeNull();
    expect(screen.getByText(TREE_NOTE)).toBeInTheDocument();
  });

  it('excludes problems already in the paper when that filter is on', async () => {
    bankItems = [TRAVERSAL, SHORTEST];
    const { user } = await renderLoaded({ type: 'acm', inPaper: [11, 99] });
    await openNode(user, '图论');
    await screen.findByRole('checkbox', { name: '只看未加入的' });
    await waitFor(() => {
      expect(callsTo('/teach-api/bank').length).toBeGreaterThan(0);
    });
    expect(excludeIds(latestBankUrl())).toEqual([]);

    const before = callsTo('/teach-api/bank').length;
    await user.click(screen.getByRole('checkbox', { name: '只看未加入的' }));

    await waitFor(() => {
      expect(callsTo('/teach-api/bank').length).toBeGreaterThan(before);
    });
    expect(excludeIds(latestBankUrl())).toEqual([11, 99]);
  });

  it('marks problems already in the paper with a disabled check and a check icon', async () => {
    bankItems = [TRAVERSAL, SHORTEST];
    const { user } = await renderLoaded({ type: 'acm', inPaper: [11] });
    await openNode(user, '图论');
    await screen.findByRole('checkbox', { name: '选择 P0011' });

    const added = screen.getByRole('checkbox', { name: '选择 P0011' });
    const free = screen.getByRole('checkbox', { name: '选择 P0012' });
    expect(added).toBeChecked();
    expect(added).toBeDisabled();
    expect(free).toBeEnabled();
    expect(free).not.toBeChecked();
    const addedRow = rowOf('P0011');
    const freeRow = rowOf('P0012');
    expect(within(addedRow).queryByRole('button', { name: '加入 P0011' })).toBeNull();
    expect(screen.queryByRole('button', { name: '加入 P0011' })).toBeNull();
    expect(successChecks(addedRow).length).toBeGreaterThan(0);
    expect(within(addedRow).getByText('已加入')).toBeInTheDocument();
    const plus = within(freeRow).getByRole('button', { name: '加入 P0012' });
    expect(plus).toBeEnabled();
    expect(plus).toHaveAttribute('data-variant', 'ghost');
    expect(successChecks(freeRow)).toHaveLength(0);
    expect(within(freeRow).queryByText('已加入')).toBeNull();
  });

  it('adds the two checked problems', async () => {
    bankItems = [TRAVERSAL, SHORTEST];
    const { user, onAdd } = await renderLoaded({ type: 'acm' });
    await openNode(user, '图论');
    await screen.findByRole('checkbox', { name: '选择 P0011' });

    expect(screen.getByRole('button', { name: '新建' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '新建' })).toHaveAttribute('data-variant', 'secondary');
    expect(screen.getByRole('button', { name: '加入 P0011' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '加入选中（2）' })).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: '选择 P0011' }));
    await user.click(screen.getByRole('checkbox', { name: '选择 P0012' }));

    expect(screen.getByText('已选 2 道')).toBeInTheDocument();
    const addSelected = screen.getByRole('button', { name: '加入选中（2）' });
    expect(addSelected).toHaveAttribute('data-variant', 'secondary');
    await user.click(addSelected);

    expect(addedDocIds(onAdd)).toEqual([11, 12]);
  });

  it('previews my objective with the standard answer and hides the share switch on someone else\'s problem', async () => {
    bankItems = [MINE_SINGLE, OTHER_SINGLE];
    const { user } = await renderLoaded({ type: 'exam' });
    await openNode(user, '图论');
    await screen.findByText('我的单选题');
    expect(screen.queryByText(/不能加/)).toBeNull();

    const mine = await openPreview(user, '我的单选题');
    expect(within(mine).getByRole('switch', { name: '共享到学校题库' })).toBeInTheDocument();
    expect(await within(mine).findByText('标准答案')).toBeInTheDocument();
    expect(within(mine).getByText('正确说法')).toBeInTheDocument();
    expect(within(mine).getByText('错误说法')).toBeInTheDocument();
    expect(within(mine).getAllByText('标准答案')).toHaveLength(1);
    expect(within(mine).getByText(PREVIEW_CONTENT)).toBeInTheDocument();
    const previewUrl = captured.map((call) => new URL(call.url, ORIGIN)).find((url) => url.pathname === '/teach-api/bank/31');
    if (!previewUrl) throw new TypeError('missing bank preview request');
    expect(previewUrl.searchParams.get('type')).toBe('exam');

    await closePreview(user);
    const other = await openPreview(user, '别人的单选题');
    expect(within(other).queryByRole('switch', { name: '共享到学校题库' })).toBeNull();
    expect(within(other).queryByText('共享到学校题库')).toBeNull();
  });

  it('rolls the share switch back when the school bank request fails', async () => {
    bankItems = [MINE_SINGLE];
    shareFails = true;
    const { user } = await renderLoaded({ type: 'exam' });
    await openNode(user, '图论');
    const dialog = await openPreview(user, '我的单选题');
    const share = within(dialog).getByRole('switch', { name: '共享到学校题库' });
    expect(share).not.toBeChecked();

    await user.click(share);

    await waitFor(() => {
      expect(sharePosts().length).toBeGreaterThan(0);
    });
    expect(sharePosts()).toHaveLength(1);
    const posted = sharePosts()[0];
    if (!posted) throw new TypeError('missing school bank post');
    expect(parseShare(posted.body)).toEqual({ docIds: [31], shared: true });
    await waitFor(() => {
      expect(within(dialog).getByRole('switch', { name: '共享到学校题库' })).not.toBeChecked();
    });
    expect(screen.getByText(SHARE_ERROR)).toBeInTheDocument();
  });

  it('disables create and every add button when locked', async () => {
    bankItems = [TRAVERSAL, SHORTEST];
    const { user } = await renderLoaded({ type: 'acm', locked: true });
    await openNode(user, '图论');

    const created = await screen.findByRole('button', { name: '新建' });
    expect(created).toBeDisabled();
    expect(created).toHaveAttribute('data-variant', 'secondary');
    const adds = await screen.findAllByRole('button', { name: /^加入 / });
    expect(adds.length).toBeGreaterThanOrEqual(2);
    for (const button of adds) {
      expect(button).toBeDisabled();
    }
    expect(screen.getByRole('checkbox', { name: '选择 P0011' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: '选择 P0011' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: '选择 P0012' })).toBeDisabled();
  });

  it('selects a course with one problem before a later course', async () => {
    tree = {
      courses: [
        course('empty', '空课程', 0, false, [knowledgeNode('empty-node', '空节点', 0)]),
        course('one', '只有一题', 1, false, [knowledgeNode('only', '唯一知识点', 1)]),
        course('many', '题很多', 5, false, [knowledgeNode('many-node', '很多知识点', 5)]),
      ],
    };
    await renderLoaded({ type: 'acm' });

    expect(await screen.findByRole('button', { name: '唯一知识点' })).toBeInTheDocument();
    expect(screen.getByRole('combobox').textContent ?? '').toContain('只有一题');
    expect(screen.queryByRole('button', { name: '空节点' })).toBeNull();
    expect(screen.queryByRole('button', { name: '很多知识点' })).toBeNull();
  });

  it('shows the pass rate when one submission exists', async () => {
    bankItems = [ONCE, NEVER];
    const { user } = await renderLoaded({ type: 'acm' });
    await openNode(user, '图论');
    await screen.findByText('只交过一次');

    expect(within(rowOf('P0021')).getByText('通过率 100%')).toBeInTheDocument();
    expect(within(rowOf('P0022')).queryByText(/通过率/)).toBeNull();
  });

  it('names the owner only for a hidden shared problem that is not mine', async () => {
    bankItems = [PUBLIC_SHARED, HIDDEN_SHARED, MINE_SHARED];
    const { user } = await renderLoaded({ type: 'acm' });
    await openNode(user, '图论');
    await screen.findByText('别人共享的隐藏题');

    expect(within(rowOf('P0042')).getByText('共享自郑老师')).toBeInTheDocument();
    expect(within(rowOf('P0041')).queryByText(/共享自/)).toBeNull();
    expect(within(rowOf('P0043')).queryByText(/共享自/)).toBeNull();
  });

  it('calls a public problem a public school-bank item in the preview', async () => {
    bankItems = [SHORTEST];
    const { user } = await renderLoaded({ type: 'acm' });
    await openNode(user, '图论');
    const dialog = await openPreview(user, '最短路');

    const meta = previewMeta(dialog);
    expect(meta).toContain('学校题库 · 公开题');
    expect(meta.includes('隐藏题')).toBe(false);
    expect(meta.includes('我的题目')).toBe(false);
  });

  it('puts the standard answer badge on the true option', async () => {
    bankItems = [TRUE_FALSE];
    const { user } = await renderLoaded({ type: 'exam' });
    await openNode(user, '图论');
    const dialog = await openPreview(user, '判断对错');

    expect(within(answerRow(dialog, '正确')).getByText('标准答案')).toBeInTheDocument();
    expect(within(answerRow(dialog, '错误')).queryByText('标准答案')).toBeNull();
  });

  it('shows load more while another page remains', async () => {
    bankItems = [TRAVERSAL];
    bankPageCount = 2;
    const { user } = await renderLoaded({ type: 'acm' });
    await openNode(user, '图论');
    await screen.findByText('图的遍历');

    const before = callsTo('/teach-api/bank').length;
    await user.click(screen.getByRole('button', { name: '加载更多' }));
    await waitFor(() => {
      expect(callsTo('/teach-api/bank').length).toBeGreaterThan(before);
    });
    expect(new URL(latestBankUrl(), ORIGIN).searchParams.get('page')).toBe('2');
  });

  it('activates add and select from the keyboard without starting a drag', async () => {
    bankItems = [TRAVERSAL, SHORTEST];
    const onDragStart = vi.fn();
    const { user, onAdd } = await renderLoaded({ type: 'acm', keyboard: true, onDragStart });
    await openNode(user, '图论');
    const add = await screen.findByRole('button', { name: '加入 P0012' });
    add.focus();
    await user.keyboard('{Enter}');

    expect(onDragStart).not.toHaveBeenCalled();
    expect(addedDocIds(onAdd)).toEqual([12]);

    const box = screen.getByRole('checkbox', { name: '选择 P0012' });
    box.focus();
    await user.keyboard(' ');
    expect(box).toBeChecked();
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it('keeps a successful school-bank share after a later failure and a reopen', async () => {
    bankItems = [MINE_SINGLE];
    const { user } = await renderLoaded({ type: 'exam' });
    await openNode(user, '图论');
    const dialog = await openPreview(user, '我的单选题');
    expect(within(dialog).getByRole('switch', { name: '共享到学校题库' })).not.toBeChecked();

    await user.click(within(dialog).getByRole('switch', { name: '共享到学校题库' }));
    await waitFor(() => {
      expect(sharePosts()).toHaveLength(1);
    });
    const opened = sharePosts()[0];
    if (!opened) throw new TypeError('missing school bank post');
    expect(parseShare(opened.body)).toEqual({ docIds: [31], shared: true });
    await waitFor(() => {
      const share = within(dialog).getByRole('switch', { name: '共享到学校题库' });
      expect(share).toBeEnabled();
      expect(share).toBeChecked();
    });

    shareFails = true;
    await user.click(within(dialog).getByRole('switch', { name: '共享到学校题库' }));
    await waitFor(() => {
      expect(sharePosts()).toHaveLength(2);
    });
    const closed = sharePosts()[1];
    if (!closed) throw new TypeError('missing second school bank post');
    expect(parseShare(closed.body)).toEqual({ docIds: [31], shared: false });
    await waitFor(() => {
      expect(within(dialog).getByRole('switch', { name: '共享到学校题库' })).toBeChecked();
    });

    await closePreview(user);
    const again = await openPreview(user, '我的单选题');
    expect(within(again).getByRole('switch', { name: '共享到学校题库' })).toBeChecked();
  });

  it('drops the selection when the source tab changes', async () => {
    bankItems = [TRAVERSAL, SHORTEST];
    const { user, onAdd } = await renderLoaded({ type: 'acm' });
    await openNode(user, '图论');
    await screen.findByRole('checkbox', { name: '选择 P0011' });
    await user.click(screen.getByRole('checkbox', { name: '选择 P0011' }));
    await user.click(screen.getByRole('checkbox', { name: '选择 P0012' }));
    expect(screen.getByText('已选 2 道')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '学校题库' }));
    await waitFor(() => {
      expect(new URL(latestBankUrl(), ORIGIN).searchParams.get('source')).toBe('school');
    });
    expect(screen.queryByText(/已选 \d+ 道/)).toBeNull();
    expect(screen.queryByRole('button', { name: /加入选中/ })).toBeNull();

    await screen.findByRole('checkbox', { name: '选择 P0012' });
    await user.click(screen.getByRole('checkbox', { name: '选择 P0012' }));
    await user.click(screen.getByRole('button', { name: '加入选中（1）' }));
    expect(addedDocIds(onAdd)).toEqual([12]);
  });

  it('retries the same page when load more fails and then asks for the next page', async () => {
    bankItems = [TRAVERSAL];
    bankPageCount = 3;
    pageItems = new Map<number, BankItem[]>([
      [1, [TRAVERSAL]],
      [2, [SHORTEST]],
      [3, [ONCE]],
    ]);
    pageFailuresLeft.set(2, 1);
    const { user } = await renderLoaded({ type: 'acm' });
    await openNode(user, '图论');
    await screen.findByText('图的遍历');
    expect(bankPages().filter((page) => page === '1').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '加载更多' }));

    const region = screen.getByRole('region', { name: '题库' });
    expect((await within(region).findByRole('alert')).textContent ?? '').toContain(PAGE_LOAD_ERROR);
    expect(within(region).getByText('图的遍历')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: '加载更多' })).toBeEnabled();
    expect(bankPages().filter((page) => page === '2')).toEqual(['2']);
    expect(bankPages().includes('3')).toBe(false);

    await user.click(within(region).getByRole('button', { name: '加载更多' }));

    await waitFor(() => {
      expect(bankPages().filter((page) => page === '2')).toEqual(['2', '2']);
    });
    expect(bankPages().includes('3')).toBe(false);
    expect(within(region).queryByRole('alert')).toBeNull();
    expect(within(region).getByText('图的遍历')).toBeInTheDocument();
    expect(within(region).getByText('最短路')).toBeInTheDocument();

    await user.click(within(region).getByRole('button', { name: '加载更多' }));

    await waitFor(() => {
      expect(bankPages().filter((page) => page === '3')).toEqual(['3']);
    });
  });

  it('keeps a share on when a debounced list response arrives with the old value', async () => {
    bankItems = [MINE_SINGLE, HIDDEN_SHARED];
    const { user, onAdd } = await renderLoaded({ type: 'exam' });
    await openNode(user, '图论');
    await screen.findByText('我的单选题');
    expect(within(rowOf('P0042')).getByText('共享自郑老师')).toBeInTheDocument();
    const dialog = await openPreview(user, '我的单选题');
    const share = await within(dialog).findByRole('switch', { name: '共享到学校题库' });
    expect(share).not.toBeChecked();

    holdQuery = '单选';
    writeSearch('单选');
    await waitFor(() => {
      const held = heldBanks.filter((entry) => new URL(entry.url, ORIGIN).searchParams.get('q') === '单选');
      expect(held.length).toBeGreaterThan(0);
    });

    await user.click(share);
    await waitFor(() => {
      expect(sharePosts()).toHaveLength(1);
      expect(within(dialog).getByRole('switch', { name: '共享到学校题库' })).toBeChecked();
    });
    const posted = sharePosts()[0];
    if (!posted) throw new TypeError('missing school bank post');
    expect(parseShare(posted.body)).toEqual({ docIds: [MINE_SINGLE.docId], shared: true });

    releaseHeldBanks({
      items: [
        { ...MINE_SINGLE, schoolShared: false },
        { ...HIDDEN_SHARED, schoolShared: false },
      ],
      page: 1,
      pageCount: 1,
      total: 2,
    });

    await waitFor(() => {
      const other = rowOf('P0042', true);
      expect(within(other).getByText('别人共享的隐藏题')).toBeInTheDocument();
      expect(within(other).queryByText(/共享自/)).toBeNull();
      expect(within(dialog).getByRole('switch', { name: '共享到学校题库' })).toBeChecked();
    });

    await closePreview(user);
    expect(within(rowOf('P0031')).getByText('我的单选题')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '加入 P0031' }));
    const added = onAdd.mock.calls[0]?.[0];
    if (!Array.isArray(added) || !isRecord(added[0]) || typeof added[0].schoolShared !== 'boolean') {
      throw new TypeError('onAdd did not receive the shared bank item');
    }
    expect(added[0].schoolShared).toBe(true);
  });

  it('shows a warning instead of throwing when a single question has 27 options', async () => {
    bankItems = [LONG_SINGLE];
    const { user } = await renderLoaded({ type: 'exam' });
    await openNode(user, '图论');
    await screen.findByText('选项很多的单选题');
    const dialog = await openPreview(user, '选项很多的单选题');

    const warning = await within(dialog).findByText(TOO_MANY_OPTIONS);
    expect(warning.closest('[role="status"]')).not.toBeNull();
    expect(within(dialog).queryByText('选项27')).toBeNull();
    expect(screen.getByRole('region', { name: '题库' })).toBeInTheDocument();
    expect(screen.getByText('课程')).toBeInTheDocument();
    expect(screen.getAllByText('选项很多的单选题').length).toBeGreaterThan(0);
  });
});
