import type { FormEvent } from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { CourseEditPage } from '../../src/pages/course/editor.tsx';
import type { ChapterDraft, CourseRecord } from '../../src/pages/course/types.ts';
import { CourseMindmapTab } from '../../src/pages/course/workbench/mindmap-tab.tsx';
import type { CourseEditorPageData } from '../../src/pages/course/workbench/model.ts';

const COURSE_ID = '64b8000000000000000000c1';
const PUBLIC_ID = '64b8000000000000000000d1';
const HIDDEN_ID = '64b8000000000000000000d2';
const ROOT_ID = '64b8000000000000000000aa';
const LOOP_ID = '64b8000000000000000000e3';
const ARRAY_ID = '64b8000000000000000000e4';
const MAP_ID = '64b8000000000000000000cc';
const PUBLIC_TITLE = '程序设计基础(I)';
const HIDDEN_TITLE = '实验室安全与防护';
const VERSION = '2026-10-16T00:00:00.000Z';
const FIELD = 'knowledgeCourseNodeId';
const UNBOUND_LABEL = '不绑定';
const HIDDEN_HINT = '隐藏';
const GENERATE_LABEL = '从知识点生成章节';
const EDIT_LABEL = '编辑这门课的知识点';
const LOCKED_NOTE = '只有负责教师和管理员能编辑这门课的知识点';
const EMPTY_TITLE = '这门课还没绑定课程节点';
const BIND_HINT = '换节点随课程一起保存';
const SEARCH_PLACEHOLDER = '搜索知识点';
const SAVE_BEFORE_EDIT = '保存课程后才能编辑新的课程节点。';
const CANVAS_HINT = '双击 改名 · 拖动 换位置 · Tab 加子节点 · Enter 加同级 · Del 删除';
const READONLY_NOTICE = '只有这门课节点的负责教师和管理员能编辑知识点。你可以浏览、搜索、看每个知识点的题，也能用它生成章节。';
const CHAPTER_LINK = '第 3 章 · 循环结构';
const GENERATE_MESSAGE = '已有视频、题目或收集的章节会保留。';
const EDIT_PATH = `/course/${COURSE_ID}/edit`;
const SNAPSHOT_PATH = `/mindmap/${PUBLIC_ID}/edit`;
const REMOVED_BUTTONS = ['新建专属导图', '创建本课导图', '删除本课导图', '编辑本课导图'] as const;

interface EditorCourseNode {
  id: string;
  title: string;
  visibility: 'public' | 'hidden';
  canEdit: boolean;
}

interface BoundCourseNode {
  id: string;
  title: string;
  canEdit: boolean;
}

/** Editor GET adds these fields beside the existing page data. model.ts does not declare them. */
interface MindmapTabPageData extends CourseEditorPageData {
  courseNodes: EditorCourseNode[];
  boundCourseNode: BoundCourseNode | null;
}

interface RecordedCall {
  method: string;
  pathname: string;
  body: string;
}

const CHAPTERS: ChapterDraft[] = [
  {
    _id: 1,
    title: '第 1 章',
    content: '',
    pids: [],
    videos: [],
    sections: [],
    tids: '',
  },
];

const COURSE_NODES: EditorCourseNode[] = [
  { id: PUBLIC_ID, title: PUBLIC_TITLE, visibility: 'public', canEdit: true },
  { id: HIDDEN_ID, title: HIDDEN_TITLE, visibility: 'hidden', canEdit: false },
];

const calls: RecordedCall[] = [];
let snapshotCanEdit = true;

function keepFormMounted(event: FormEvent<HTMLFormElement>): void {
  event.preventDefault();
}

function boundNode(id: string, title: string, canEdit: boolean): BoundCourseNode {
  return { id, title, canEdit };
}

/** Same keys `parseCourseEditor` returns. The GET-only `courseNodes` and `boundCourseNode` are absent. */
function parsedEditorData(): CourseEditorPageData {
  const data: CourseEditorPageData & { canCreatePractice: boolean } = {
    page_name: 'course_edit',
    tdoc: {
      docId: COURSE_ID,
      title: '图论',
    },
    groupOptions: [],
    attachedGroups: [],
    canManageOwnGroups: false,
    canManageFiles: false,
    canCreateQuiz: false,
    canCreatePractice: true,
    files: [],
    mindmaps: [],
  };
  return data;
}

/** Course editor GET body. `parseCourseEditor` drops `courseNodes` and `boundCourseNode`. */
function editorGetBody(binding: BoundCourseNode): Record<string, unknown> {
  return {
    page_name: 'course_edit',
    tdoc: {
      docId: COURSE_ID,
      title: '图论',
      knowledgeCourseNodeId: binding.id,
    },
    groupOptions: [],
    attachedGroups: [],
    canManageOwnGroups: false,
    canManageFiles: false,
    canCreateQuiz: false,
    canCreatePractice: true,
    files: [],
    mindmaps: [],
    courseNodes: COURSE_NODES,
    boundCourseNode: binding,
  };
}

function coursePageData(): Record<string, unknown> {
  return {
    ...editorGetBody(boundNode(PUBLIC_ID, PUBLIC_TITLE, true)),
    chapters: JSON.stringify([
      { _id: 1, title: '绪论', content: '', pids: [], videos: [], sections: [] },
      { _id: 2, title: '分支', content: '', pids: [], videos: [], sections: [] },
      {
        _id: 3,
        title: '循环结构',
        content: '',
        pids: [],
        videos: [],
        sections: [],
        sourceMindmapNodeId: LOOP_ID,
      },
    ]),
  };
}

function mindNode(
  id: string,
  parentId: string | null,
  order: number,
  topic: string,
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
    updatedAt: VERSION,
    ...extra,
  };
}

function editorSnapshot(): Record<string, unknown> {
  return {
    canEdit: snapshotCanEdit,
    courseNode: {
      id: PUBLIC_ID,
      title: PUBLIC_TITLE,
      order: 1,
      visibility: 'public',
      ownerUids: [3],
    },
    nodes: [
      mindNode(PUBLIC_ID, ROOT_ID, 1, PUBLIC_TITLE, {
        courseVisibility: 'public',
        ownerUids: [3],
      }),
      mindNode(LOOP_ID, PUBLIC_ID, 1, '循环结构', { description: '先写循环条件。' }),
      mindNode(ARRAY_ID, PUBLIC_ID, 2, '一维数组'),
    ],
    referenceCounts: {
      [PUBLIC_ID]: 20,
      [LOOP_ID]: 17,
      [ARRAY_ID]: 3,
    },
    config: {
      _id: MAP_ID,
      title: '知识图谱',
      rootNodeId: ROOT_ID,
      visibility: 'public',
      layoutDirection: 'RIGHT',
      createdAt: VERSION,
      updatedAt: VERSION,
    },
  };
}

function tabBootstrap(data: unknown): KryptonBootstrap {
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
    page: { templateName: 'course_edit.html', data },
  };
}

function clearEditorBootstrap(): void {
  Reflect.deleteProperty(window, '__KRYPTON_BOOTSTRAP__');
}

function pageData(binding: BoundCourseNode | null): MindmapTabPageData {
  const tdoc: CourseRecord = {
    docId: COURSE_ID,
    title: '图论',
  };
  if (binding) Object.assign(tdoc, { knowledgeCourseNodeId: binding.id });
  const data: MindmapTabPageData & { canCreatePractice: boolean } = {
    page_name: 'course_edit',
    tdoc,
    groupOptions: [],
    attachedGroups: [],
    canManageOwnGroups: false,
    canManageFiles: false,
    canCreateQuiz: false,
    canCreatePractice: true,
    files: [],
    mindmaps: [{ _id: '64b8000000000000000000aa', title: '旧公开图', visibility: 'public' }],
    courseOwnedMindmap: {
      _id: '64b8000000000000000000bb',
      title: '本课导图',
      updatedAt: VERSION,
    },
    courseNodes: COURSE_NODES,
    boundCourseNode: binding,
  };
  return data;
}

function formValue(container: HTMLElement, name: string): string {
  const form = container.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new TypeError('expected a form');
  const values = [...new FormData(form).getAll(name)].filter((item): item is string => typeof item === 'string');
  expect(values, name).toHaveLength(1);
  const value = values[0];
  if (value === undefined) throw new TypeError(`expected ${name}`);
  return value;
}

function renderTab(
  data: CourseEditorPageData,
  active = true,
  bootstrapData: unknown = data,
): { container: HTMLElement; onDirty: ReturnType<typeof vi.fn> } {
  const onDirty = vi.fn();
  const bootstrap = tabBootstrap(bootstrapData);
  window.__KRYPTON_BOOTSTRAP__ = bootstrap;
  const view = render(
    <BootstrapProvider bootstrap={bootstrap}>
      <form onSubmit={keepFormMounted}>
        <CourseMindmapTab
          data={data}
          chapters={CHAPTERS}
          onDirty={onDirty}
          onChaptersReplaced={vi.fn()}
          active={active}
        />
      </form>
    </BootstrapProvider>,
  );
  return { container: view.container, onDirty };
}

function renderCoursePage(): void {
  const data = coursePageData();
  const bootstrap = tabBootstrap(data);
  window.__KRYPTON_BOOTSTRAP__ = bootstrap;
  render(
    <BootstrapProvider bootstrap={bootstrap}>
      <CourseEditPage />
    </BootstrapProvider>,
  );
}

function expectNoExclusiveMapUi(): void {
  for (const name of REMOVED_BUTTONS) {
    expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByRole('link', { name })).toBeNull();
  }
  expect(screen.queryByText('这是本课专属导图', { exact: false })).toBeNull();
  expect(screen.queryByText('不绑定知识导图')).toBeNull();
  expect(screen.queryByText('保存课程后才能创建本课导图')).toBeNull();
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, 'http://krypton.local');
  if (input instanceof URL) return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  throw new TypeError('unexpected fetch input');
}

async function readRequestBody(body: BodyInit | null | undefined): Promise<string> {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const params = new URLSearchParams();
    for (const [key, value] of body.entries()) {
      if (typeof value === 'string') params.append(key, value);
    }
    return params.toString();
  }
  if (body instanceof Blob) return body.text();
  return '';
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function postedOperation(operation: string): RecordedCall[] {
  return calls.filter((call) => {
    if (call.method !== 'POST' || call.pathname !== EDIT_PATH) return false;
    return new URLSearchParams(call.body).get('operation') === operation;
  });
}

/** Course save posts the editor form. Chapter generation is the only other post on that path. */
function courseSavePosts(): RecordedCall[] {
  return calls.filter((call) => {
    if (call.method !== 'POST' || call.pathname !== EDIT_PATH) return false;
    return new URLSearchParams(call.body).get('operation') !== 'generate_chapters';
  });
}

function snapshotGets(): RecordedCall[] {
  return calls.filter((call) => call.method === 'GET' && call.pathname === SNAPSHOT_PATH);
}

function outlineItem(topic: string): HTMLElement {
  const found = screen.getAllByRole('treeitem').find((item) => item.textContent?.includes(topic));
  if (!found) throw new Error(`outline is missing ${topic}`);
  return found;
}

function courseNodeChoice(): HTMLElement {
  return screen.getByRole('combobox', { name: '课程节点' });
}

/** Let a hidden editor finish its mount-time snapshot request if it started one. */
async function settlePaint(): Promise<void> {
  await act(async () => {
    await new Promise<void>((done) => {
      setTimeout(done, 20);
    });
  });
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

beforeEach(() => {
  calls.length = 0;
  snapshotCanEdit = true;
  vi.stubGlobal('fetch', vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
    const url = requestUrl(input);
    const method = (init?.method || 'GET').toUpperCase();
    const body = await readRequestBody(init?.body);
    calls.push({ method, pathname: url.pathname, body });
    if (method === 'GET' && url.pathname === SNAPSHOT_PATH) return jsonResponse(editorSnapshot());
    if (method === 'GET' && url.pathname === '/api/mindmap/problems') return jsonResponse({ problems: [] });
    if (method === 'POST' && url.pathname === EDIT_PATH) {
      return jsonResponse({ createdChapters: 1, createdSections: 0, notices: [] });
    }
    if (method === 'GET') return jsonResponse({ published: null, draft: null });
    return jsonResponse({ message: '未桩的请求' }, 404);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearEditorBootstrap();
  snapshotCanEdit = true;
  window.history.replaceState(null, '', '/');
});

describe('course mindmap tab', () => {
  it('submits knowledgeCourseNodeId and marks hidden course nodes', async () => {
    const user = userEvent.setup();
    const { container, onDirty } = renderTab(pageData(null), true);
    expect(formValue(container, FIELD)).toBe('');
    expect(container.querySelector('[name="mindmapId"]')).toBeNull();
    expectNoExclusiveMapUi();
    expect(screen.getByText('课程节点')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: GENERATE_LABEL })).toBeNull();
    expect(screen.queryByRole('link', { name: EDIT_LABEL })).toBeNull();
    expect(screen.queryByText(LOCKED_NOTE)).toBeNull();

    const choice = courseNodeChoice();
    expect(choice).toHaveTextContent(UNBOUND_LABEL);
    await user.click(choice);
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent(UNBOUND_LABEL);
    expect(screen.getByRole('option', { name: PUBLIC_TITLE })).not.toHaveTextContent(HIDDEN_HINT);
    expect(screen.getByRole('option', { name: HIDDEN_TITLE })).toHaveTextContent(HIDDEN_HINT);

    await user.click(screen.getByRole('option', { name: HIDDEN_TITLE }));
    expect(formValue(container, FIELD)).toBe(HIDDEN_ID);
    expect(onDirty).toHaveBeenCalled();

    await user.click(courseNodeChoice());
    await user.click(screen.getByRole('option', { name: UNBOUND_LABEL }));
    expect(formValue(container, FIELD)).toBe('');
  });

  it('shows an empty state and does not load a snapshot when no course node is bound', () => {
    renderTab(pageData(null), true);
    expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument();
    expect(courseNodeChoice()).toBeInTheDocument();
    expect(calls.filter((call) => call.pathname.startsWith('/mindmap/'))).toHaveLength(0);
  });

  it('embeds the outline, canvas, and properties and loads the edit snapshot when a course node is bound', async () => {
    const user = userEvent.setup();
    // The real course form posts and reloads on submit. The isolated tab harness swallows that.
    window.history.replaceState(null, '', `/course/${COURSE_ID}/edit?tab=mindmap`);
    renderCoursePage();
    const outline = await screen.findByRole('region', { name: '大纲' });
    expect(screen.getByRole('region', { name: '画布' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '知识点属性' })).toBeInTheDocument();
    expect(snapshotGets().length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: EDIT_LABEL })).toBeNull();
    expect(screen.queryByText(LOCKED_NOTE)).toBeNull();
    expect(screen.queryByText(READONLY_NOTICE)).toBeNull();
    expect(screen.getByText(BIND_HINT)).toBeInTheDocument();
    expect(screen.getByText(CANVAS_HINT)).toBeInTheDocument();
    expect(within(outline).queryByPlaceholderText(SEARCH_PLACEHOLDER)).toBeNull();

    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), '循环');
    await waitFor(() => {
      expect(outlineItem('循环结构')).not.toHaveAttribute('data-dimmed');
      expect(outlineItem('一维数组')).toHaveAttribute('data-dimmed', 'true');
    });

    const addChild = within(outline).getByRole('button', { name: '子节点' });
    expect(addChild).toBeEnabled();
    await user.click(addChild);
    await settlePaint();
    expect(courseSavePosts()).toHaveLength(0);
    expect(screen.getByRole('region', { name: '大纲' })).toBeInTheDocument();
  });

  it('asks to save the course before editing a newly chosen course node', async () => {
    const user = userEvent.setup();
    const { container } = renderTab(pageData(boundNode(PUBLIC_ID, PUBLIC_TITLE, true)), true);
    await user.click(courseNodeChoice());
    await user.click(screen.getByRole('option', { name: HIDDEN_TITLE }));
    expect(formValue(container, FIELD)).toBe(HIDDEN_ID);
    expect(screen.getByRole('button', { name: GENERATE_LABEL })).toBeDisabled();
    expect(screen.getByText(SAVE_BEFORE_EDIT)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '大纲' })).toBeNull();
  });

  it('disables chapter generation while the course node choice is unsaved', async () => {
    const user = userEvent.setup();
    renderTab(pageData(boundNode(PUBLIC_ID, PUBLIC_TITLE, true)), true);
    expect(screen.getByRole('button', { name: GENERATE_LABEL })).toBeEnabled();
    await user.click(courseNodeChoice());
    await user.click(screen.getByRole('option', { name: HIDDEN_TITLE }));
    expect(screen.getByRole('button', { name: GENERATE_LABEL })).toBeDisabled();
  });

  it('posts generate_chapters only after confirmation', async () => {
    const restoreLocation = installLocation();
    const user = userEvent.setup();
    try {
      renderTab(pageData(boundNode(PUBLIC_ID, PUBLIC_TITLE, true)), true);
      const generate = screen.getByRole('button', { name: GENERATE_LABEL });
      expect(generate).toHaveAttribute('data-variant', 'secondary');
      await user.click(generate);
      const cancelled = await screen.findByRole('dialog');
      expect(within(cancelled).getByText(GENERATE_MESSAGE, { exact: false })).toBeInTheDocument();
      await user.click(within(cancelled).getByRole('button', { name: '取消' }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      expect(postedOperation('generate_chapters')).toHaveLength(0);
      expect(postedOperation('create_mindmap')).toHaveLength(0);
      expect(postedOperation('delete_mindmap')).toHaveLength(0);

      await user.click(screen.getByRole('button', { name: GENERATE_LABEL }));
      const confirmed = await screen.findByRole('dialog');
      await user.click(within(confirmed).getByRole('button', { name: '生成' }));
      await waitFor(() => {
        expect(postedOperation('generate_chapters')).toHaveLength(1);
      });
    } finally {
      restoreLocation();
    }
  });

  it('shows the snapshot readonly notice instead of a new-window edit link', async () => {
    snapshotCanEdit = false;
    renderTab(pageData(boundNode(PUBLIC_ID, PUBLIC_TITLE, true)), true);
    expect(screen.queryByRole('link', { name: EDIT_LABEL })).toBeNull();
    expect(screen.queryByText(LOCKED_NOTE)).toBeNull();
    expect(await screen.findByText(READONLY_NOTICE)).toBeInTheDocument();
    expect(screen.queryByText(CANVAS_HINT)).toBeNull();
    expect(screen.getByRole('region', { name: '大纲' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '画布' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '知识点属性' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: GENERATE_LABEL })).toBeEnabled();
  });

  it('does not draw the canvas or load the snapshot until the mindmap tab is opened', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', `/course/${COURSE_ID}/edit`);
    renderCoursePage();
    expect(screen.getByRole('tab', { name: '章节', selected: true })).toBeTruthy();
    expect(new URL(window.location.href).searchParams.has('tab')).toBe(false);

    await settlePaint();
    expect(document.querySelector('[aria-label="画布"]')).toBeNull();
    expect(snapshotGets()).toHaveLength(0);

    await user.click(screen.getByRole('tab', { name: '导图' }));
    expect(await screen.findByRole('region', { name: '大纲' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '画布' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '知识点属性' })).toBeInTheDocument();
    await waitFor(() => {
      expect(snapshotGets().length).toBeGreaterThan(0);
    });
  });

  it('opens the matching chapter from the mindmap tab and drops the tab query', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', `/course/${COURSE_ID}/edit?tab=mindmap`);
    renderCoursePage();
    expect(screen.getByRole('tab', { name: '导图', selected: true })).toBeTruthy();

    const outline = await screen.findByRole('region', { name: '大纲' });
    await user.click(within(outline).getByRole('treeitem', { name: /循环结构/ }));
    await user.click(await screen.findByRole('button', { name: CHAPTER_LINK }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '章节', selected: true })).toBeTruthy();
      const url = new URL(window.location.href);
      expect(url.searchParams.has('tab')).toBe(false);
      expect(url.searchParams.get('chapter')).toBe('3');
      expect(screen.getByRole('textbox', { name: '章节标题' })).toHaveValue('循环结构');
    });
    expect(screen.getByRole('button', { name: '循环结构' })).toHaveAttribute('aria-current', 'true');

    window.history.back();
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '导图', selected: true })).toBeTruthy();
      expect(new URL(window.location.href).searchParams.get('tab')).toBe('mindmap');
      expect(screen.queryByRole('textbox', { name: '章节标题' })).toBeNull();
    });
  });

  it('does not submit an empty knowledgeCourseNodeId when the editor payload omitted the binding', () => {
    clearEditorBootstrap();
    expect(window.__KRYPTON_BOOTSTRAP__).toBeUndefined();
    let container: HTMLElement | undefined;
    try {
      container = renderTab(parsedEditorData(), true).container;
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      return;
    }
    const form = container.querySelector('form');
    if (!(form instanceof HTMLFormElement)) throw new TypeError('expected a form');
    const values = [...new FormData(form).getAll(FIELD)].filter((item): item is string => typeof item === 'string');
    expect(values.includes('')).toBe(false);
  });

  it('reads the bound course node from the editor get payload', async () => {
    const user = userEvent.setup();
    const binding = boundNode(PUBLIC_ID, PUBLIC_TITLE, true);
    const { container } = renderTab(parsedEditorData(), true, editorGetBody(binding));
    expect(formValue(container, FIELD)).toBe(PUBLIC_ID);
    expect(screen.getByRole('button', { name: GENERATE_LABEL })).toBeInTheDocument();
    await user.click(courseNodeChoice());
    expect(screen.getByRole('option', { name: PUBLIC_TITLE })).not.toHaveTextContent(HIDDEN_HINT);
    expect(screen.getByRole('option', { name: HIDDEN_TITLE })).toHaveTextContent(HIDDEN_HINT);
  });

  it('keeps knowledgeCourseNodeId in the form while the tab is inactive', () => {
    const { container } = renderTab(pageData(boundNode(PUBLIC_ID, PUBLIC_TITLE, true)), false);
    expect(screen.queryByRole('combobox', { name: '课程节点' })).toBeNull();
    expect(screen.getByRole('combobox', { name: '课程节点', hidden: true })).toBeInTheDocument();
    expect(formValue(container, FIELD)).toBe(PUBLIC_ID);
    expect(container.querySelector('[name="mindmapId"]')).toBeNull();
  });
});
