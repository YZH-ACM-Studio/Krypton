// A static import fails collection while src/pages/course/node-editor/editor.tsx is absent.
import type { ComponentType, ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider, type Node as FlowNode, type ReactFlowProps } from '@xyflow/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../src/components/ui/toast.tsx';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import type { ChapterDraft, SectionDraft } from '../../src/pages/course/types.ts';
import { PageResolver } from '../../src/pages/resolver.tsx';

const captured = vi.hoisted(() => ({
  onNodeDragStop: null as ReactFlowProps['onNodeDragStop'] | null,
  intersections: [] as FlowNode[],
  fitMaxZoom: null as number | null,
}));

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react');
  return {
    ...actual,
    ReactFlow: (props: ReactFlowProps) => {
      captured.onNodeDragStop = props.onNodeDragStop ?? null;
      captured.fitMaxZoom = props.fitViewOptions?.maxZoom ?? null;
      return <actual.ReactFlow {...props} />;
    },
    useReactFlow: () => {
      const flow = actual.useReactFlow();
      return {
        ...flow,
        getIntersectingNodes: () => captured.intersections,
      };
    },
  };
});

const editorLoaders = import.meta.glob('../../src/pages/course/node-editor/editor.tsx');
const EDITOR_SOURCE = 'src/pages/course/node-editor/editor.tsx';

const VERSION = '2026-10-16T00:00:00.000Z';
const MAP_UPDATED = '2026-10-16T00:00:05.000Z';
const LOOP_UPDATED = '2026-10-16T00:00:01.000Z';
const ARRAY_UPDATED = '2026-10-16T00:00:02.000Z';
const COURSE_UPDATED = '2026-10-16T00:00:03.000Z';
const FUNC_UPDATED = '2026-10-16T00:00:04.000Z';
const COURSE_ID = 'course-programming';
const LOOP_ID = 'node-loop';
const ARRAY_ID = 'node-array';
const FUNC_ID = 'node-func';
const LOOP_BODY_ID = 'node-loop-body';
const MAP_ID = 'map-merged';
const ROOT_ID = 'graph-root';
const COURSE_TITLE = '程序设计基础(I)';
const PAGE_TITLE = `${COURSE_TITLE} · 知识点`;
const NODES_PATH = `/mindmap/${COURSE_ID}/nodes`;
const EDIT_PATH = `/mindmap/${COURSE_ID}/edit`;
const LOOP_DESCRIPTION = '先写循环条件，再写循环体。';
const NEW_TOPIC = '新知识点';
const RENAMED_TOPIC = '条件循环';
const REJECTED = '这个知识点正在被别人修改。';
const HINT = '双击 改名 · 拖动 换位置 · Tab 加子节点 · Enter 加同级 · Del 删除';
const READONLY_NOTICE = '只有这门课节点的负责教师和管理员能编辑知识点。你可以浏览、搜索、看每个知识点的题，也能用它生成章节。';
const NO_CHAPTER = '还没有生成章节。在上方点「从知识点生成章节」。';
const SAVING = '正在保存…';
const SAVED = /已保存 · \d{2}:\d{2}/;

type User = ReturnType<typeof userEvent.setup>;

interface CourseNodeEditorProps {
  nodeId: string;
  initial?: unknown;
  search?: string;
  chapters?: readonly ChapterDraft[];
  onOpenChapter?: (chapterId: number, sectionId: number | null) => void;
  className?: string;
}

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

interface FetchSession {
  calls: RecordedCall[];
  snapshot: Record<string, unknown>;
  holdPosts: boolean;
  held: Array<(response: Response) => void>;
}

let CourseNodeEditor: ComponentType<CourseNodeEditorProps> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key);
}

function makeBootstrap(templateName: string, data: unknown): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: VERSION,
    user: { id: 2, name: 'root', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName, data },
  };
}

function mindNode(
  id: string,
  parentId: string | null,
  order: number,
  topic: string,
  updatedAt: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    _id: id,
    mapId: MAP_ID,
    parentId,
    topic,
    tags: [],
    problemIds: [],
    order,
    createdAt: VERSION,
    updatedAt,
    ...extra,
  };
}

function courseSnapshot(canEdit = true): Record<string, unknown> {
  return {
    canEdit,
    courseNode: {
      id: COURSE_ID,
      title: COURSE_TITLE,
      order: 1,
      visibility: 'public',
      ownerUids: [3],
    },
    nodes: [
      mindNode(COURSE_ID, ROOT_ID, 1, COURSE_TITLE, COURSE_UPDATED, {
        courseVisibility: 'public',
        ownerUids: [3],
      }),
      mindNode(LOOP_ID, COURSE_ID, 1, '循环结构', LOOP_UPDATED, {
        description: LOOP_DESCRIPTION,
        color: 'sky',
        problemIds: ['11', '12'],
      }),
      mindNode(ARRAY_ID, COURSE_ID, 2, '一维数组', ARRAY_UPDATED),
      mindNode(FUNC_ID, COURSE_ID, 3, '函数', FUNC_UPDATED),
    ],
    referenceCounts: {
      [COURSE_ID]: 20,
      [LOOP_ID]: 17,
      [ARRAY_ID]: 3,
      [FUNC_ID]: 0,
    },
    config: {
      _id: MAP_ID,
      title: '知识图谱',
      rootNodeId: ROOT_ID,
      visibility: 'public',
      layoutDirection: 'RIGHT',
      createdAt: VERSION,
      updatedAt: MAP_UPDATED,
    },
  };
}

function pagePayload(): Record<string, unknown> {
  return {
    canEdit: true,
    courseNode: {
      id: COURSE_ID,
      title: COURSE_TITLE,
      order: 1,
      visibility: 'public',
      ownerUids: [3],
    },
    nodes: [
      mindNode(COURSE_ID, ROOT_ID, 1, COURSE_TITLE, COURSE_UPDATED, {
        courseVisibility: 'public',
        ownerUids: [3],
      }),
      mindNode(ARRAY_ID, COURSE_ID, 1, '一维数组', ARRAY_UPDATED),
    ],
    referenceCounts: {
      [COURSE_ID]: 0,
      [ARRAY_ID]: 0,
    },
    config: {
      _id: MAP_ID,
      title: '知识图谱',
      rootNodeId: ROOT_ID,
      visibility: 'public',
      layoutDirection: 'RIGHT',
      createdAt: VERSION,
      updatedAt: MAP_UPDATED,
    },
  };
}

function legacyPayload(): Record<string, unknown> {
  return {
    course: { docId: 'course-1', title: COURSE_TITLE },
    config: {
      _id: MAP_ID,
      title: COURSE_TITLE,
      rootNodeId: COURSE_ID,
      visibility: 'hidden',
      layoutDirection: 'RIGHT',
      createdAt: VERSION,
      updatedAt: VERSION,
    },
    nodes: [mindNode(COURSE_ID, null, 0, COURSE_TITLE, VERSION, { coursePins: [] })],
    problems: [],
  };
}

function sectionDraft(id: number, title: string, sourceMindmapNodeId: string): SectionDraft {
  return {
    _id: id,
    title,
    content: '',
    pids: [],
    videos: [],
    sourceMindmapNodeId,
  };
}

function chapterDraft(
  id: number,
  title: string,
  sourceMindmapNodeId: string | undefined,
  sections: SectionDraft[],
): ChapterDraft {
  return {
    _id: id,
    title,
    content: '',
    pids: [],
    videos: [],
    sections,
    tids: '',
    ...(sourceMindmapNodeId ? { sourceMindmapNodeId } : {}),
  };
}

function sampleChapters(): ChapterDraft[] {
  return [
    chapterDraft(1, '绪论', undefined, [sectionDraft(1, '数组入门', ARRAY_ID)]),
    chapterDraft(2, '分支', undefined, []),
    chapterDraft(3, '循环结构', LOOP_ID, []),
  ];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status = 400): Response {
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

function panelProblem(docId: number, pid: string, title: string): Record<string, unknown> {
  return {
    domainId: 'system',
    docId,
    pid,
    title,
    hidden: false,
    nSubmit: 8,
    nAccept: 3,
    difficulty: 2,
    sources: ['canonical'],
  };
}

function knowledgeTree(): Record<string, unknown> {
  return {
    courses: [
      {
        id: 'algo',
        title: '算法知识图谱',
        hidden: false,
        total: 2,
        nodes: [{ id: 'graph', title: '图论', count: 2, children: [] }],
      },
    ],
  };
}

function bankItem(docId: number, pid: string, title: string): Record<string, unknown> {
  return {
    docId,
    pid,
    title,
    kind: 'programming',
    difficulty: 2,
    tags: ['数组'],
    nSubmit: 8,
    nAccept: 3,
    hidden: false,
    mine: true,
    schoolShared: false,
    ownerName: '王老师',
    courseId: 'algo',
    nodePath: ['图论'],
  };
}

function requestPath(url: string): string {
  return new URL(url, 'http://localhost').pathname;
}

function bodyText(body: BodyInit | null | undefined): string {
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof FormData) {
    const params = new URLSearchParams();
    for (const [key, value] of body.entries()) {
      if (typeof value === 'string') params.append(key, value);
    }
    return params.toString();
  }
  return '';
}

function postedFields(init: RequestInit | undefined): Record<string, unknown> {
  const text = bodyText(init?.body).trim();
  if (!text) return {};
  if (text.startsWith('{')) {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  }
  const params = new URLSearchParams(text);
  const fields: Record<string, unknown> = {};
  const operation = params.get('operation');
  if (operation) fields.operation = operation;
  const payload = params.get('payload');
  if (payload) {
    const parsed: unknown = JSON.parse(payload);
    if (isRecord(parsed)) Object.assign(fields, parsed);
  }
  for (const [key, value] of params.entries()) {
    if (key === 'payload' || key === 'operation') continue;
    fields[key] = value;
  }
  return fields;
}

function asFields(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('mutation fields are missing');
  return value;
}

function nodePosts(session: FetchSession): RecordedCall[] {
  return session.calls.filter((call) => requestPath(call.url) === NODES_PATH && call.init?.method === 'POST');
}

function editGets(session: FetchSession): RecordedCall[] {
  return session.calls.filter((call) => requestPath(call.url) === EDIT_PATH && call.init?.method !== 'POST');
}

function cloneSnapshot(snapshot: Record<string, unknown>): Record<string, unknown> {
  const cloned: unknown = structuredClone(snapshot);
  if (!isRecord(cloned)) throw new Error('snapshot clone failed');
  return cloned;
}

function snapshotNodes(snapshot: Record<string, unknown>): Record<string, unknown>[] {
  const nodes = snapshot.nodes;
  if (!Array.isArray(nodes)) throw new Error('snapshot nodes are missing');
  return nodes.filter(isRecord);
}

function problemsBody(nodeId: string): Record<string, unknown> {
  if (nodeId !== LOOP_ID) return { problems: [] };
  return {
    problems: [
      panelProblem(11, 'P0011', '数组求和'),
      panelProblem(12, 'P0012', '数组最值'),
      panelProblem(13, 'P0013', '循环求和'),
    ],
  };
}

function applyMutation(snapshot: Record<string, unknown>, init: RequestInit | undefined): Record<string, unknown> {
  const next = cloneSnapshot(snapshot);
  const posted = postedFields(init);
  const nodes = snapshotNodes(next);
  next.nodes = nodes;
  if (posted.operation === 'create' && typeof posted.parentId === 'string' && typeof posted.topic === 'string') {
    nodes.push(mindNode('node-created', posted.parentId, nodes.length + 1, posted.topic, '2026-10-16T00:00:06.000Z'));
    const counts = next.referenceCounts;
    if (isRecord(counts)) counts['node-created'] = 0;
  }
  if (posted.operation === 'update' && typeof posted.id === 'string' && isRecord(posted.fields)) {
    const node = nodes.find((item) => item._id === posted.id);
    if (node && typeof posted.fields.topic === 'string') node.topic = posted.fields.topic;
    if (node && Array.isArray(posted.fields.problemIds)) node.problemIds = posted.fields.problemIds;
  }
  if (posted.operation === 'move' && typeof posted.id === 'string' && typeof posted.newParentId === 'string') {
    const node = nodes.find((item) => item._id === posted.id);
    if (node) node.parentId = posted.newParentId;
  }
  if (posted.operation === 'delete' && typeof posted.id === 'string') {
    next.nodes = nodes.filter((item) => item._id !== posted.id);
  }
  return next;
}

function installFetch(snapshot: Record<string, unknown>, rejectMessage: string | null = null): FetchSession {
  const session: FetchSession = {
    calls: [],
    snapshot: cloneSnapshot(snapshot),
    holdPosts: false,
    held: [],
  };
  let rejected = false;
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    session.calls.push({ url, init });
    const path = requestPath(url);
    if (path === '/teach-api/knowledge-tree') return Promise.resolve(jsonResponse(knowledgeTree()));
    if (path === '/teach-api/bank') {
      return Promise.resolve(jsonResponse({
        items: [bankItem(11, 'P0011', '数组求和'), bankItem(12, 'P0012', '数组最值')],
        page: 1,
        pageCount: 1,
        total: 2,
      }));
    }
    if (path === '/api/mindmap/problems') {
      const nodeId = new URL(url, 'http://localhost').searchParams.get('nodeId') ?? '';
      return Promise.resolve(jsonResponse(problemsBody(nodeId)));
    }
    if (init?.method === 'POST' && path === NODES_PATH) {
      if (rejectMessage && !rejected) {
        rejected = true;
        return Promise.resolve(errorResponse(rejectMessage));
      }
      if (session.holdPosts) {
        return new Promise<Response>((settle) => {
          session.held.push(settle);
        });
      }
      session.snapshot = applyMutation(session.snapshot, init);
      return Promise.resolve(jsonResponse(session.snapshot));
    }
    if (path === EDIT_PATH) return Promise.resolve(jsonResponse(session.snapshot));
    return Promise.resolve(jsonResponse({ ok: true }));
  }));
  return session;
}

function releasePost(session: FetchSession, body: unknown, status = 200): void {
  const settle = session.held.shift();
  if (!settle) throw new Error('no held post');
  settle(jsonResponse(body, status));
}

function installPageFetch(saved: Record<string, unknown>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    const path = requestPath(url);
    if (path === '/teach-api/knowledge-tree') return Promise.resolve(jsonResponse(knowledgeTree()));
    if (path === '/teach-api/bank') {
      return Promise.resolve(jsonResponse({
        items: [bankItem(11, 'P0011', '数组求和'), bankItem(12, 'P0012', '数组最值')],
        page: 1,
        pageCount: 1,
        total: 2,
      }));
    }
    if (init?.method === 'POST') return Promise.resolve(jsonResponse({ ok: true, ...saved }));
    return Promise.resolve(jsonResponse({ ok: true }));
  }));
  return calls;
}

function isComponent(value: unknown): value is ComponentType {
  return typeof value === 'function';
}

function isEditor(value: unknown): value is ComponentType<CourseNodeEditorProps> {
  return typeof value === 'function';
}

async function loadEditor(): Promise<ComponentType<CourseNodeEditorProps>> {
  let load: unknown;
  for (const [key, candidate] of Object.entries(editorLoaders)) {
    if (key.endsWith(EDITOR_SOURCE)) load = candidate;
  }
  expect(typeof load, `${EDITOR_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${EDITOR_SOURCE} is missing`);
  const imported: unknown = await load();
  if (!isRecord(imported)) throw new TypeError(`${EDITOR_SOURCE} must be a module`);
  const editor = readField(imported, 'CourseNodeEditor');
  expect(typeof editor, 'CourseNodeEditor is not exported').toBe('function');
  if (!isEditor(editor)) throw new TypeError('CourseNodeEditor must be a function');
  return editor;
}

async function loadPage(): Promise<ComponentType> {
  const imported: unknown = await import('../../src/pages/course/mindmap-editor.tsx');
  if (!isRecord(imported)) throw new TypeError('mindmap editor module is missing');
  const page = readField(imported, 'CourseNodeMindmapEditPage');
  expect(typeof page, 'CourseNodeMindmapEditPage is not exported').toBe('function');
  if (!isComponent(page)) throw new TypeError('CourseNodeMindmapEditPage must be a function');
  return page;
}

function renderShell(templateName: string, data: unknown, page: ReactNode) {
  return render(
    <BootstrapProvider bootstrap={makeBootstrap(templateName, data)}>
      <ToastProvider>
        {page}
      </ToastProvider>
    </BootstrapProvider>,
  );
}

function renderCourseEditor(props: CourseNodeEditorProps, snapshot: Record<string, unknown>, rejectMessage: string | null = null): FetchSession {
  if (!CourseNodeEditor) throw new Error('CourseNodeEditor was not loaded');
  const session = installFetch(snapshot, rejectMessage);
  const Editor = CourseNodeEditor;
  renderShell(props.initial ? 'mindmap_course_edit.html' : 'course_editor.html', props.initial ? snapshot : {}, (
    <ReactFlowProvider>
      <div style={{ width: 1200, height: 720 }}>
        <Editor {...props} />
      </div>
    </ReactFlowProvider>
  ));
  return session;
}

function editorProps(snapshot: Record<string, unknown>, extra: Partial<CourseNodeEditorProps> = {}): CourseNodeEditorProps {
  return {
    nodeId: COURSE_ID,
    initial: snapshot,
    chapters: sampleChapters(),
    className: 'h-full',
    ...extra,
  };
}

function outlineItem(topic: string): HTMLElement {
  const found = screen.getAllByRole('treeitem').find((item) => item.textContent?.includes(topic));
  if (!found) throw new Error(`outline is missing ${topic}`);
  return found;
}

function canvasElement(): HTMLElement {
  const flow = document.querySelector('.react-flow');
  if (!(flow instanceof HTMLElement)) throw new Error('canvas is missing');
  return flow;
}

function nodeById(id: string): HTMLElement {
  const node = canvasElement().querySelector(`.react-flow__node[data-id="${id}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`canvas node missing: ${id}`);
  return node;
}

function focusCanvas(): HTMLElement {
  const flow = canvasElement();
  const host = flow.parentElement instanceof HTMLElement ? flow.parentElement : flow;
  for (const candidate of [host, flow]) {
    candidate.focus();
    if (document.activeElement === candidate) return candidate;
  }
  throw new Error('canvas did not take focus');
}

function flowNodeStub(id: string): FlowNode {
  return {
    id,
    type: 'mindmap',
    position: { x: 0, y: 0 },
    data: { topic: id },
    width: 160,
    height: 44,
    measured: { width: 160, height: 44 },
  };
}

function labelElement(text: string): HTMLElement | null {
  for (const node of screen.queryAllByText(text)) {
    if (node.tagName === 'LABEL') return node;
    const label = node.closest('label');
    if (label instanceof HTMLElement) return label;
  }
  return null;
}

function controlNearLabel(texts: readonly string[]): HTMLElement {
  for (const text of texts) {
    const label = labelElement(text);
    if (!label) continue;
    let host: HTMLElement | null = label.parentElement;
    for (let depth = 0; depth < 4 && host; depth += 1) {
      const control = host.querySelector('input, textarea, [role="combobox"]');
      if (control instanceof HTMLElement && !control.closest('.react-flow') && !label.contains(control)) return control;
      host = host.parentElement;
    }
  }
  throw new Error(`missing control near ${texts.join(' / ')}`);
}

function isLocked(control: HTMLElement): boolean {
  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
    return control.readOnly || control.disabled;
  }
  return control.hasAttribute('disabled')
    || control.getAttribute('aria-disabled') === 'true'
    || control.hasAttribute('data-disabled');
}

function isDimmed(id: string): boolean {
  return nodeById(id).querySelector('[data-dimmed="true"]') instanceof HTMLElement;
}

function removeControl(title: string, pid: string): HTMLElement {
  const labels = [...screen.queryAllByText(pid), ...screen.queryAllByText(title)];
  for (const label of labels) {
    let host: HTMLElement | null = label.parentElement;
    for (let depth = 0; depth < 6 && host; depth += 1) {
      const button = within(host).queryAllByRole('button').find((item) => {
        const name = `${item.getAttribute('aria-label') ?? ''} ${item.textContent ?? ''}`;
        return /移出|移除/.test(name);
      });
      if (button) return button;
      host = host.parentElement;
    }
  }
  throw new Error(`no remove control for ${pid}`);
}

async function shownOutline(): Promise<void> {
  await waitFor(() => {
    expect(outlineItem(COURSE_TITLE).textContent).toContain(COURSE_TITLE);
    expect(outlineItem('循环结构').textContent).toContain('循环结构');
    expect(outlineItem('循环结构').textContent).toContain('17');
  });
}

async function shownCanvas(): Promise<void> {
  await waitFor(() => {
    expect(nodeById(LOOP_ID).textContent).toContain('循环结构');
    expect(nodeById(LOOP_ID).textContent).toContain('17');
  });
}

function loopListCalls(session: FetchSession): number {
  return session.calls.filter((item) => {
    const url = new URL(item.url, 'http://localhost');
    return url.pathname === '/api/mindmap/problems' && url.searchParams.get('nodeId') === LOOP_ID;
  }).length;
}

async function selectTopic(user: User, topic: string): Promise<void> {
  await user.click(outlineItem(topic));
  await waitFor(() => {
    expect(outlineItem(topic).getAttribute('aria-selected')).toBe('true');
  });
}

async function renameOnCanvas(topicId: string, nextTopic: string): Promise<void> {
  fireEvent.doubleClick(nodeById(topicId));
  const input = await waitFor(() => {
    const field = nodeById(topicId).querySelector('input');
    if (!(field instanceof HTMLInputElement)) throw new Error('rename field is missing');
    return field;
  });
  fireEvent.change(input, { target: { value: nextTopic } });
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
}

async function stopDrag(id: string, targetId: string): Promise<void> {
  captured.intersections = [flowNodeStub(targetId)];
  const stop = captured.onNodeDragStop;
  expect(typeof stop).toBe('function');
  if (typeof stop !== 'function') return;
  const node = flowNodeStub(id);
  node.position = { x: 480, y: 120 };
  await act(async () => {
    stop(new MouseEvent('mouseup') as never, node, [node]);
  });
}

async function openBank(user: User): Promise<HTMLElement> {
  const tab = screen.queryByRole('tab', { name: /收录/ });
  if (tab) await user.click(tab);
  const opener = screen.queryByRole('button', { name: '从题库收录' })
    ?? screen.queryByRole('button', { name: '收录题' });
  expect(opener, 'collected problems picker is missing').not.toBeNull();
  if (!opener) throw new Error('collected problems picker is missing');
  await user.click(opener);
  const sheet = await screen.findByRole('dialog');
  expect(within(sheet).getByRole('region', { name: '题库' })).toBeTruthy();
  return sheet;
}

afterEach(() => {
  captured.onNodeDragStop = null;
  captured.intersections = [];
  captured.fitMaxZoom = null;
  vi.unstubAllGlobals();
});

describe('course node editor', () => {
  // React Flow hides a node until ResizeObserver measures it, and jsdom never measures; show nodes so role queries reach them.
  const flowVisibility = document.createElement('style');
  flowVisibility.textContent = '.react-flow__node{visibility:visible !important}';

  beforeAll(async () => {
    document.head.append(flowVisibility);
    CourseNodeEditor = await loadEditor();
  });

  afterAll(() => {
    flowVisibility.remove();
  });

  it('shows outline counts and canvas counts from the snapshot', async () => {
    const snapshot = courseSnapshot();
    renderCourseEditor(editorProps(snapshot), snapshot);
    await shownOutline();
    await shownCanvas();

    expect(screen.getByRole('heading', { name: '结构大纲' })).toBeTruthy();
    expect(nodeById(LOOP_ID).classList.contains('draggable')).toBe(true);
    expect(document.body.textContent).toContain(HINT);
    expect(document.body.textContent).not.toContain(READONLY_NOTICE);
    const name = controlNearLabel(['节点名称', '名称']);
    expect(name).toBeInstanceOf(HTMLInputElement);
    if (name instanceof HTMLInputElement) expect(isLocked(name)).toBe(false);
  });

  it('shows the selected node properties and chapter links', async () => {
    const user = userEvent.setup({ delay: null });
    const onOpenChapter = vi.fn();
    const snapshot = courseSnapshot();
    renderCourseEditor(editorProps(snapshot, { onOpenChapter }), snapshot);
    await shownOutline();

    await selectTopic(user, '循环结构');
    expect(screen.getByText('对应章节')).toBeTruthy();
    const name = controlNearLabel(['节点名称', '名称']);
    expect(name).toBeInstanceOf(HTMLInputElement);
    if (name instanceof HTMLInputElement) expect(name.value).toBe('循环结构');
    const description = controlNearLabel(['说明']);
    expect(description).toBeInstanceOf(HTMLTextAreaElement);
    if (description instanceof HTMLTextAreaElement) expect(description.value).toBe(LOOP_DESCRIPTION);
    expect(controlNearLabel(['颜色']).textContent).toContain('天空蓝');
    await user.click(screen.getByText('第 3 章 · 循环结构'));
    expect(onOpenChapter).toHaveBeenCalledWith(3, null);

    await selectTopic(user, '一维数组');
    await user.click(screen.getByText('第 1 章 · 绪论 › 数组入门'));
    expect(onOpenChapter).toHaveBeenCalledWith(1, 1);

    await selectTopic(user, '函数');
    expect(screen.getByText(NO_CHAPTER)).toBeTruthy();
  });

  it('posts a canvas rename and shows the saved time', async () => {
    const snapshot = courseSnapshot();
    const session = renderCourseEditor(editorProps(snapshot), snapshot);
    session.holdPosts = true;
    await shownCanvas();

    await renameOnCanvas(LOOP_ID, RENAMED_TOPIC);
    expect(await screen.findByText(SAVING)).toBeTruthy();
    const renamed = applyMutation(snapshot, nodePosts(session).at(-1)?.init);
    releasePost(session, renamed);

    expect(await screen.findByText(SAVED)).toBeTruthy();
    await waitFor(() => {
      expect(outlineItem(RENAMED_TOPIC).textContent).toContain(RENAMED_TOPIC);
    });
    const posted = postedFields(nodePosts(session).at(-1)?.init);
    expect(requestPath(nodePosts(session).at(-1)?.url ?? '')).toBe(NODES_PATH);
    expect(posted.operation).toBe('update');
    expect(posted.id).toBe(LOOP_ID);
    expect(posted.mapId).toBe(MAP_ID);
    expect(posted.expectedMapUpdatedAt).toBe(MAP_UPDATED);
    expect(posted.expectedUpdatedAt).toBe(LOOP_UPDATED);
    expect(asFields(posted.fields).topic).toBe(RENAMED_TOPIC);
  });

  it('posts a child when tab is pressed and starts renaming it', async () => {
    const user = userEvent.setup({ delay: null });
    const snapshot = courseSnapshot();
    const session = renderCourseEditor(editorProps(snapshot), snapshot);
    await shownOutline();
    await shownCanvas();
    await selectTopic(user, '循环结构');

    const canvas = focusCanvas();
    fireEvent.keyDown(canvas, { key: 'Tab', code: 'Tab' });

    await waitFor(() => {
      expect(nodePosts(session).length).toBeGreaterThan(0);
    });
    const posted = postedFields(nodePosts(session).at(-1)?.init);
    expect(posted.operation).toBe('create');
    expect(posted.parentId).toBe(LOOP_ID);
    expect(posted.topic).toBe(NEW_TOPIC);
    expect(posted.mapId).toBe(MAP_ID);
    expect(posted.expectedMapUpdatedAt).toBe(MAP_UPDATED);
    expect(posted.expectedParentUpdatedAt).toBe(LOOP_UPDATED);
    const input = await screen.findByRole('textbox', { name: '知识点名称' });
    expect(input).toBeInstanceOf(HTMLInputElement);
    if (input instanceof HTMLInputElement) expect(input.value).toBe(NEW_TOPIC);
  });

  it('shows nested children on the canvas and renames a new child of a node that already has children', async () => {
    const user = userEvent.setup({ delay: null });
    const snapshot = courseSnapshot();
    const nodes = snapshot.nodes;
    if (!Array.isArray(nodes)) throw new TypeError('snapshot nodes');
    nodes.push(mindNode(LOOP_BODY_ID, LOOP_ID, 1, '循环体', LOOP_UPDATED));
    const counts = snapshot.referenceCounts;
    if (!isRecord(counts)) throw new TypeError('snapshot counts');
    counts[LOOP_BODY_ID] = 0;
    const session = renderCourseEditor(editorProps(snapshot), snapshot);
    await shownOutline();
    await shownCanvas();
    await waitFor(() => {
      expect(nodeById(LOOP_BODY_ID).textContent).toContain('循环体');
    });
    await selectTopic(user, '循环结构');

    fireEvent.keyDown(focusCanvas(), { key: 'Tab', code: 'Tab' });

    await waitFor(() => {
      expect(nodePosts(session).length).toBeGreaterThan(0);
    });
    expect(postedFields(nodePosts(session).at(-1)?.init).parentId).toBe(LOOP_ID);
    const input = await screen.findByRole('textbox', { name: '知识点名称' });
    expect(input).toBeInstanceOf(HTMLInputElement);
    if (input instanceof HTMLInputElement) expect(input.value).toBe(NEW_TOPIC);
  });

  it('opens a collapsed course node on the canvas before renaming a new child', async () => {
    const user = userEvent.setup({ delay: null });
    const snapshot = courseSnapshot();
    renderCourseEditor(editorProps(snapshot), snapshot);
    await shownOutline();
    await shownCanvas();
    fireEvent.click(within(nodeById(COURSE_ID)).getByRole('button', { name: '收起子节点' }));
    await waitFor(() => {
      expect(document.querySelector(`.react-flow__node[data-id="${LOOP_ID}"]`)).toBeNull();
    });
    await selectTopic(user, '循环结构');

    fireEvent.keyDown(focusCanvas(), { key: 'Tab', code: 'Tab' });

    const input = await screen.findByRole('textbox', { name: '知识点名称' });
    expect(input).toBeInstanceOf(HTMLInputElement);
    if (input instanceof HTMLInputElement) expect(input.value).toBe(NEW_TOPIC);
    expect(nodeById(LOOP_ID).textContent).toContain('循环结构');
  });

  it('does not create a sibling of the course node', async () => {
    const user = userEvent.setup({ delay: null });
    const snapshot = courseSnapshot();
    const session = renderCourseEditor(editorProps(snapshot), snapshot);
    await shownOutline();
    await shownCanvas();
    await selectTopic(user, COURSE_TITLE);

    const canvas = focusCanvas();
    await act(async () => {
      fireEvent.keyDown(canvas, { key: 'Enter', code: 'Enter' });
    });
    expect(nodePosts(session)).toHaveLength(0);
    expect(screen.queryByRole('textbox', { name: '知识点名称' })).toBeNull();
  });

  it('posts a sibling under the selected node parent', async () => {
    const user = userEvent.setup({ delay: null });
    const snapshot = courseSnapshot();
    const session = renderCourseEditor(editorProps(snapshot), snapshot);
    await shownOutline();
    await shownCanvas();
    await selectTopic(user, '循环结构');

    const canvas = focusCanvas();
    fireEvent.keyDown(canvas, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(nodePosts(session).length).toBeGreaterThan(0);
    });
    const posted = postedFields(nodePosts(session).at(-1)?.init);
    expect(posted.operation).toBe('create');
    expect(posted.parentId).toBe(COURSE_ID);
    expect(posted.topic).toBe(NEW_TOPIC);
    expect(posted.expectedParentUpdatedAt).toBe(COURSE_UPDATED);
    expect(await screen.findByRole('textbox', { name: '知识点名称' })).toBeTruthy();
  });

  it('posts a move under the drop target', async () => {
    const snapshot = courseSnapshot();
    const session = renderCourseEditor(editorProps(snapshot), snapshot);
    await shownCanvas();

    await stopDrag(LOOP_ID, ARRAY_ID);

    await waitFor(() => {
      expect(nodePosts(session).length).toBeGreaterThan(0);
    });
    const posted = postedFields(nodePosts(session).at(-1)?.init);
    expect(posted.operation).toBe('move');
    expect(posted.id).toBe(LOOP_ID);
    expect(posted.newParentId).toBe(ARRAY_ID);
    expect(posted.targetIndex).toBe(0);
    expect(posted.mapId).toBe(MAP_ID);
    expect(posted.expectedMapUpdatedAt).toBe(MAP_UPDATED);
    expect(posted.expectedUpdatedAt).toBe(LOOP_UPDATED);
    expect(posted.expectedParentUpdatedAt).toBe(ARRAY_UPDATED);
  });

  it('shows the server message and reloads the snapshot when a save is rejected', async () => {
    const snapshot = courseSnapshot();
    const session = renderCourseEditor(editorProps(snapshot), snapshot, REJECTED);
    await shownCanvas();
    const getsBefore = editGets(session).length;

    await renameOnCanvas(LOOP_ID, RENAMED_TOPIC);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(REJECTED);
      expect(editGets(session).length).toBeGreaterThan(getsBefore);
      expect(document.body.textContent).not.toContain(RENAMED_TOPIC);
      expect(outlineItem('循环结构').textContent).toContain('循环结构');
    });
  });

  it('lists every problem on the all tab and removes a collected problem', async () => {
    const user = userEvent.setup({ delay: null });
    const snapshot = courseSnapshot();
    const session = renderCourseEditor(editorProps(snapshot), snapshot);
    await shownOutline();
    await selectTopic(user, '循环结构');

    await user.click(await screen.findByRole('tab', { name: /全部\s*17/ }));
    await waitFor(() => {
      const call = session.calls.find((item) => {
        const url = new URL(item.url, 'http://localhost');
        return url.pathname === '/api/mindmap/problems'
          && url.searchParams.get('mapId') === MAP_ID
          && url.searchParams.get('nodeId') === LOOP_ID;
      });
      expect(call).toBeTruthy();
    });
    expect((await screen.findAllByText('P0011')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('数组求和')).length).toBeGreaterThan(0);
    expect(document.querySelector('a[href="/p/P0011"]')?.textContent).toContain('数组求和');
    expect((await screen.findAllByText('循环求和')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('tab', { name: /收录\s*2/ }));
    const listedBeforeRemove = loopListCalls(session);
    await user.click(removeControl('数组求和', 'P0011'));
    await waitFor(() => {
      const posted = nodePosts(session).map((call) => postedFields(call.init)).find((fields) => {
        const patch = fields.fields;
        return isRecord(patch) && Array.isArray(patch.problemIds);
      });
      expect(posted).toBeTruthy();
      if (!posted) return;
      expect(posted.operation).toBe('update');
      expect(posted.id).toBe(LOOP_ID);
      expect(asFields(posted.fields).problemIds).toEqual(['12']);
    });
    // The saved snapshot changes the node's problems, so the「全部」list is fetched again.
    await waitFor(() => {
      expect(loopListCalls(session)).toBeGreaterThan(listedBeforeRemove);
    });
  });

  it('posts collected bank problems as doc id strings', async () => {
    const user = userEvent.setup({ delay: null });
    const snapshot = courseSnapshot();
    const session = renderCourseEditor(editorProps(snapshot), snapshot);
    await shownOutline();
    await selectTopic(user, '一维数组');
    const sheet = await openBank(user);

    await waitFor(() => {
      const treeCall = session.calls.find((call) => requestPath(call.url) === '/teach-api/knowledge-tree');
      expect(treeCall).toBeTruthy();
      if (!treeCall) return;
      expect(new URL(treeCall.url, 'http://localhost').searchParams.get('type')).toBe('homework');
    });
    await user.click(await within(sheet).findByRole('button', { name: '图论' }));
    await user.click(await within(sheet).findByRole('button', { name: '加入 P0011' }));
    await user.click(await within(sheet).findByRole('button', { name: '加入 P0012' }));

    await waitFor(() => {
      const posted = nodePosts(session).map((call) => postedFields(call.init)).find((fields) => {
        const patch = fields.fields;
        return isRecord(patch) && Array.isArray(patch.problemIds) && patch.problemIds.length === 2;
      });
      expect(posted).toBeTruthy();
      if (!posted) return;
      expect(requestPath(nodePosts(session).at(-1)?.url ?? '')).toBe(NODES_PATH);
      expect(posted.operation).toBe('update');
      expect(posted.id).toBe(ARRAY_ID);
      expect(asFields(posted.fields).problemIds).toEqual(['11', '12']);
    });
  });

  it('adds a child from the property panel', async () => {
    const user = userEvent.setup({ delay: null });
    const snapshot = courseSnapshot();
    const session = renderCourseEditor(editorProps(snapshot), snapshot);
    await shownOutline();
    await shownCanvas();
    await selectTopic(user, COURSE_TITLE);

    const childName = screen.getByRole('textbox', { name: '子节点名称' });
    await user.type(childName, '分支结构');
    await user.click(screen.getByRole('button', { name: '添加' }));

    await waitFor(() => {
      expect(nodePosts(session).length).toBeGreaterThan(0);
    });
    const posted = postedFields(nodePosts(session).at(-1)?.init);
    expect(requestPath(nodePosts(session).at(-1)?.url ?? '')).toBe(NODES_PATH);
    expect(posted.operation).toBe('create');
    expect(posted.parentId).toBe(COURSE_ID);
    expect(posted.topic).toBe('分支结构');
    expect(posted.expectedParentUpdatedAt).toBe(COURSE_UPDATED);
    const input = await screen.findByRole('textbox', { name: '知识点名称' });
    expect(input).toBeInstanceOf(HTMLInputElement);
    if (input instanceof HTMLInputElement) expect(input.value).toBe('分支结构');
  });

  it('confirms before deleting a node from the canvas', async () => {
    const user = userEvent.setup({ delay: null });
    const snapshot = courseSnapshot();
    const session = renderCourseEditor(editorProps(snapshot), snapshot);
    await shownOutline();
    await shownCanvas();

    await selectTopic(user, COURSE_TITLE);
    await act(async () => {
      fireEvent.keyDown(focusCanvas(), { key: 'Delete', code: 'Delete' });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('课程节点不能在这里删除。');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(nodePosts(session)).toHaveLength(0);

    await selectTopic(user, '循环结构');
    fireEvent.keyDown(focusCanvas(), { key: 'Delete', code: 'Delete' });
    const firstDialog = await screen.findByRole('dialog');
    expect(firstDialog.textContent).toContain('删除节点「循环结构」？');
    expect(firstDialog.textContent).toContain('它的收录题会一起删除。');
    await user.click(within(firstDialog).getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(nodePosts(session)).toHaveLength(0);

    fireEvent.keyDown(focusCanvas(), { key: 'Backspace', code: 'Backspace' });
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '删除' }));
    await waitFor(() => {
      expect(nodePosts(session).length).toBeGreaterThan(0);
    });
    const posted = postedFields(nodePosts(session).at(-1)?.init);
    expect(posted.operation).toBe('delete');
    expect(posted.id).toBe(LOOP_ID);
    expect(posted.expectedUpdatedAt).toBe(LOOP_UPDATED);
    expect(posted.mapId).toBe(MAP_ID);
    expect(posted.expectedMapUpdatedAt).toBe(MAP_UPDATED);
  });

  it('keeps a read-only editor from renaming, deleting, or collecting', async () => {
    const user = userEvent.setup({ delay: null });
    const snapshot = courseSnapshot(false);
    const session = renderCourseEditor(editorProps(snapshot), snapshot);
    await shownOutline();
    await shownCanvas();
    await selectTopic(user, '循环结构');

    expect(document.body.textContent).toContain(READONLY_NOTICE);
    expect(document.body.textContent).not.toContain(HINT);
    expect(nodeById(LOOP_ID).classList.contains('draggable')).toBe(false);
    const name = controlNearLabel(['节点名称', '名称']);
    expect(isLocked(name)).toBe(true);
    expect(isLocked(controlNearLabel(['说明']))).toBe(true);
    expect(isLocked(controlNearLabel(['颜色']))).toBe(true);
    expect(screen.queryByRole('button', { name: /删除/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /从题库收录|^收录题$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /移出|移除/ })).toBeNull();

    fireEvent.doubleClick(nodeById(LOOP_ID));
    expect(nodeById(LOOP_ID).querySelector('input')).toBeNull();
    const flow = canvasElement();
    const host = flow.parentElement instanceof HTMLElement ? flow.parentElement : flow;
    host.focus();
    const keyTarget = document.activeElement instanceof HTMLElement ? document.activeElement : host;
    fireEvent.keyDown(keyTarget, { key: 'Tab', code: 'Tab' });
    fireEvent.keyDown(host, { key: 'Tab', code: 'Tab' });
    expect(nodePosts(session)).toHaveLength(0);
    expect(screen.queryByRole('textbox', { name: '知识点名称' })).toBeNull();
  });

  it('emphasizes search matches on the canvas', async () => {
    const snapshot = courseSnapshot();
    renderCourseEditor(editorProps(snapshot, { search: '循环' }), snapshot);
    await shownCanvas();

    await waitFor(() => {
      expect(isDimmed(LOOP_ID)).toBe(false);
      expect(isDimmed(FUNC_ID)).toBe(true);
    });
  });

  it('keeps every outline row and canvas node undimmed when the search is blank', async () => {
    const snapshot = courseSnapshot();
    renderCourseEditor(editorProps(snapshot, { search: '  ' }), snapshot);
    await shownOutline();
    await shownCanvas();

    const row = (topic: string) => {
      const found = screen.getAllByRole('treeitem').find((item) => (item.textContent ?? '').includes(topic));
      if (!found) throw new TypeError(`missing outline row ${topic}`);
      return found;
    };
    expect(row(COURSE_TITLE)).not.toHaveAttribute('data-dimmed');
    expect(row('循环结构')).not.toHaveAttribute('data-dimmed');
    expect(row('函数')).not.toHaveAttribute('data-dimmed');
    expect(isDimmed(LOOP_ID)).toBe(false);
    expect(isDimmed(FUNC_ID)).toBe(false);
  });

  it('shows the renamed title in the outline before the save returns', async () => {
    const snapshot = courseSnapshot();
    const session = renderCourseEditor(editorProps(snapshot), snapshot);
    session.holdPosts = true;
    await shownCanvas();

    await renameOnCanvas(LOOP_ID, RENAMED_TOPIC);
    expect(await screen.findByText(SAVING)).toBeTruthy();
    await waitFor(() => {
      expect(outlineItem(RENAMED_TOPIC).textContent).toContain(RENAMED_TOPIC);
    });
    expect(nodePosts(session)).toHaveLength(1);
    releasePost(session, applyMutation(snapshot, nodePosts(session).at(-1)?.init));
    expect(await screen.findByText(SAVED)).toBeTruthy();
  });

  it('posts the description when the field leaves focus', async () => {
    const user = userEvent.setup({ delay: null });
    const snapshot = courseSnapshot();
    const session = renderCourseEditor(editorProps(snapshot), snapshot);
    await shownOutline();
    await selectTopic(user, '循环结构');

    const description = controlNearLabel(['说明']);
    expect(description).toBeInstanceOf(HTMLTextAreaElement);
    if (!(description instanceof HTMLTextAreaElement)) throw new TypeError('description is missing');
    fireEvent.change(description, { target: { value: '先判断再循环。' } });
    fireEvent.blur(description);
    await waitFor(() => {
      const posted = nodePosts(session).map((call) => postedFields(call.init)).find((fields) => {
        const patch = fields.fields;
        return isRecord(patch) && typeof patch.description === 'string';
      });
      expect(posted).toBeTruthy();
      if (!posted) return;
      expect(posted.operation).toBe('update');
      expect(posted.id).toBe(LOOP_ID);
      expect(asFields(posted.fields).description).toBe('先判断再循环。');
      expect(posted.expectedUpdatedAt).toBe(LOOP_UPDATED);
    });
  });

  it('fits the open canvas at no more than full size', async () => {
    const snapshot = courseSnapshot();
    renderCourseEditor(editorProps(snapshot), snapshot);
    await shownCanvas();
    expect(captured.fitMaxZoom).toBe(1);
  });

  it('dims outline rows that do not match the search and keeps them listed', async () => {
    const snapshot = courseSnapshot();
    renderCourseEditor(editorProps(snapshot, { search: '循环' }), snapshot);
    await shownOutline();

    const row = (topic: string) => {
      const found = screen.getAllByRole('treeitem').find((item) => (item.textContent ?? '').includes(topic));
      if (!found) throw new TypeError(`missing outline row ${topic}`);
      return found;
    };
    expect(row('循环结构')).not.toHaveAttribute('data-dimmed');
    expect(row('函数')).toHaveAttribute('data-dimmed', 'true');
    expect(row('一维数组')).toHaveAttribute('data-dimmed', 'true');
  });

  it('loads the snapshot when initial data is omitted', async () => {
    const snapshot = courseSnapshot();
    const session = renderCourseEditor({
      nodeId: COURSE_ID,
      chapters: sampleChapters(),
      className: 'h-full',
    }, snapshot);
    await waitFor(() => {
      expect(editGets(session).length).toBeGreaterThan(0);
    });
    await shownOutline();
    await shownCanvas();
    expect(document.body.textContent).toContain(HINT);
  });
});

describe('course node editor page', () => {
  it('shows the course node title and breadcrumb', async () => {
    const data = pagePayload();
    const Page = await loadPage();
    installPageFetch(data);
    renderShell('mindmap_course_edit.html', data, <Page />);

    expect(screen.getByRole('heading', { name: PAGE_TITLE })).toBeTruthy();
    const crumbText = screen.getByRole('navigation', { name: 'breadcrumb' }).textContent ?? '';
    expect(crumbText).toContain('导图');
    expect(crumbText).toContain(COURSE_TITLE);
    expect(screen.getByRole('link', { name: '导图' }).getAttribute('href')).toBe(
      `/mindmap?course=${encodeURIComponent(COURSE_ID)}`,
    );
    expect(screen.queryByText('钉选题目')).toBeNull();
    expect(screen.queryByRole('switch', { name: '对学生公开' })).toBeNull();
    expect(screen.queryByRole('button', { name: '保存课程节点设置' })).toBeNull();
  });

  it('updates the page title and breadcrumb after the course node is renamed', async () => {
    const data = pagePayload();
    const saved = pagePayload();
    const renamed = '程序设计基础(II)';
    const savedCourse = saved.courseNode;
    if (!isRecord(savedCourse)) throw new TypeError('saved courseNode');
    savedCourse.title = renamed;
    const savedNodes = saved.nodes;
    if (!Array.isArray(savedNodes)) throw new TypeError('saved nodes');
    for (const node of savedNodes) if (isRecord(node) && node._id === COURSE_ID) node.topic = renamed;
    const Page = await loadPage();
    installPageFetch(saved);
    renderShell('mindmap_course_edit.html', data, <Page />);
    await waitFor(() => {
      expect(nodeById(COURSE_ID).textContent).toContain(COURSE_TITLE);
    });

    await renameOnCanvas(COURSE_ID, renamed);

    expect(await screen.findByRole('heading', { name: `${renamed} · 知识点` })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'breadcrumb' }).textContent ?? '').toContain(renamed);
  });

  it('resolves mindmap_course_edit.html to the course node editor', async () => {
    const data = pagePayload();
    installPageFetch(data);
    renderShell('mindmap_course_edit.html', data, <PageResolver />);

    expect(await screen.findByRole('heading', { name: PAGE_TITLE })).toBeTruthy();
  });

  it('drops the course_mindmap_edit.html mapping', () => {
    const data = legacyPayload();
    installPageFetch(data);
    renderShell('course_mindmap_edit.html', data, <PageResolver />);

    expect(screen.queryByText('钉选题目')).toBeNull();
    expect(screen.queryByRole('button', { name: '保存导图' })).toBeNull();
    expect(screen.queryByRole('heading', { name: PAGE_TITLE })).toBeNull();
  });
});
