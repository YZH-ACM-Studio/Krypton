import type { FormEvent } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialogHost } from '../../src/components/ui/dialog.tsx';
import type { KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import type { ChapterDraft, CourseRecord } from '../../src/pages/course/types.ts';
import { CourseMindmapTab } from '../../src/pages/course/workbench/mindmap-tab.tsx';
import type { CourseEditorPageData } from '../../src/pages/course/workbench/model.ts';

const COURSE_ID = '64b8000000000000000000c1';
const PUBLIC_ID = '64b8000000000000000000d1';
const HIDDEN_ID = '64b8000000000000000000d2';
const PUBLIC_TITLE = '程序设计基础(I)';
const HIDDEN_TITLE = '实验室安全与防护';
const FIELD = 'knowledgeCourseNodeId';
const PANEL_TITLE = '知识点';
const PANEL_DESCRIPTION = '绑定一个课程节点后，可以用它的知识点生成章节，学生在课程页看到这门课的知识点导图。';
const UNBOUND_LABEL = '不绑定';
const HIDDEN_HINT = '隐藏';
const GENERATE_LABEL = '从知识点生成章节';
const EDIT_LABEL = '编辑这门课的知识点';
const LOCKED_NOTE = '只有负责教师和管理员能编辑这门课的知识点';
const GENERATE_MESSAGE = '已有视频、题目或收集的章节会保留。';
const EDIT_PATH = `/course/${COURSE_ID}/edit`;
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

function keepFormMounted(event: FormEvent<HTMLFormElement>): void {
  event.preventDefault();
}

function boundNode(id: string, title: string, canEdit: boolean): BoundCourseNode {
  return { id, title, canEdit };
}

/** Same keys `parseCourseEditor` returns. The GET-only `courseNodes` and `boundCourseNode` are absent. */
function parsedEditorData(): CourseEditorPageData {
  return {
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
    files: [],
    mindmaps: [],
  };
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
    files: [],
    mindmaps: [],
    courseNodes: COURSE_NODES,
    boundCourseNode: binding,
  };
}

function installEditorBootstrap(data: Record<string, unknown>): void {
  const bootstrap: KryptonBootstrap = {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-16T00:00:00.000Z',
    user: { id: 2, name: 'root', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'course_edit.html', data },
  };
  window.__KRYPTON_BOOTSTRAP__ = bootstrap;
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
  return {
    page_name: 'course_edit',
    tdoc,
    groupOptions: [],
    attachedGroups: [],
    canManageOwnGroups: false,
    canManageFiles: false,
    canCreateQuiz: false,
    files: [],
    mindmaps: [{ _id: '64b8000000000000000000aa', title: '旧公开图', visibility: 'public' }],
    courseOwnedMindmap: {
      _id: '64b8000000000000000000bb',
      title: '本课导图',
      updatedAt: '2026-10-16T00:00:00.000Z',
    },
    courseNodes: COURSE_NODES,
    boundCourseNode: binding,
  };
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

function renderTab(data: CourseEditorPageData, active = true): { container: HTMLElement; onDirty: ReturnType<typeof vi.fn> } {
  const onDirty = vi.fn();
  const view = render(
    <form onSubmit={keepFormMounted}>
      <DialogHost />
      <CourseMindmapTab
        data={data}
        chapters={CHAPTERS}
        onDirty={onDirty}
        onChaptersReplaced={vi.fn()}
        active={active}
      />
    </form>,
  );
  return { container: view.container, onDirty };
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

function installFetch(): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
    const url = requestUrl(input);
    const method = (init?.method || 'GET').toUpperCase();
    const body = await readRequestBody(init?.body);
    calls.push({ method, pathname: url.pathname, body });
    return jsonResponse({
      createdChapters: 1,
      createdSections: 0,
      notices: [],
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function postedOperation(calls: RecordedCall[], operation: string): RecordedCall[] {
  return calls.filter((call) => {
    if (call.method !== 'POST' || call.pathname !== EDIT_PATH) return false;
    return new URLSearchParams(call.body).get('operation') === operation;
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

function follows(before: HTMLElement, after: HTMLElement): void {
  const position = before.compareDocumentPosition(after);
  expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearEditorBootstrap();
});

describe('course mindmap tab', () => {
  it('submits knowledgeCourseNodeId and marks hidden course nodes', async () => {
    const user = userEvent.setup();
    const { container, onDirty } = renderTab(pageData(null), true);
    expect(formValue(container, FIELD)).toBe('');
    expect(container.querySelector('[name="mindmapId"]')).toBeNull();
    expectNoExclusiveMapUi();
    expect(screen.getByRole('heading', { name: PANEL_TITLE })).toBeInTheDocument();
    expect(screen.getByText(PANEL_DESCRIPTION)).toBeInTheDocument();
    expect(screen.getByText('课程节点')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: GENERATE_LABEL })).toBeNull();
    expect(screen.queryByRole('link', { name: EDIT_LABEL })).toBeNull();
    expect(screen.queryByText(LOCKED_NOTE)).toBeNull();

    const choice = screen.getByRole('combobox');
    expect(choice).toHaveTextContent(UNBOUND_LABEL);
    await user.click(choice);
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent(UNBOUND_LABEL);
    expect(screen.getByRole('option', { name: PUBLIC_TITLE })).not.toHaveTextContent(HIDDEN_HINT);
    expect(screen.getByRole('option', { name: HIDDEN_TITLE })).toHaveTextContent(HIDDEN_HINT);

    await user.click(screen.getByRole('option', { name: HIDDEN_TITLE }));
    expect(formValue(container, FIELD)).toBe(HIDDEN_ID);
    expect(onDirty).toHaveBeenCalled();

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: UNBOUND_LABEL }));
    expect(formValue(container, FIELD)).toBe('');
  });

  it('shows chapter generation and an edit link after a course node is bound', () => {
    const binding = boundNode(PUBLIC_ID, PUBLIC_TITLE, true);
    const { container } = renderTab(pageData(binding), true);
    expect(formValue(container, FIELD)).toBe(PUBLIC_ID);
    expectNoExclusiveMapUi();
    const choice = screen.getByRole('combobox');
    expect(choice).toHaveTextContent(PUBLIC_TITLE);
    const generate = screen.getByRole('button', { name: GENERATE_LABEL });
    expect(generate).toHaveAttribute('data-variant', 'secondary');
    expect(generate).toHaveAttribute('data-size', 'sm');
    const link = screen.getByRole('link', { name: EDIT_LABEL });
    expect(link).toHaveAttribute('href', `/mindmap/${PUBLIC_ID}/edit`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.queryByText(LOCKED_NOTE)).toBeNull();
    follows(choice, generate);
    follows(generate, link);
  });

  it('explains who can edit when the bound course node is locked', () => {
    const binding = boundNode(HIDDEN_ID, HIDDEN_TITLE, false);
    const { container } = renderTab(pageData(binding), true);
    expect(formValue(container, FIELD)).toBe(HIDDEN_ID);
    expectNoExclusiveMapUi();
    const generate = screen.getByRole('button', { name: GENERATE_LABEL });
    const note = screen.getByText(LOCKED_NOTE);
    expect(note).toHaveClass('text-xs', 'text-fg-subtle');
    expect(screen.queryByRole('link', { name: EDIT_LABEL })).toBeNull();
    follows(screen.getByRole('combobox'), generate);
    follows(generate, note);
  });

  it('posts generate_chapters only after confirmation', async () => {
    const restoreLocation = installLocation();
    const calls = installFetch();
    const user = userEvent.setup();
    try {
      renderTab(pageData(boundNode(PUBLIC_ID, PUBLIC_TITLE, true)), true);
      await user.click(screen.getByRole('button', { name: GENERATE_LABEL }));
      const cancelled = await screen.findByRole('dialog');
      expect(within(cancelled).getByText(GENERATE_MESSAGE, { exact: false })).toBeInTheDocument();
      await user.click(within(cancelled).getByRole('button', { name: '取消' }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      expect(postedOperation(calls, 'generate_chapters')).toHaveLength(0);
      expect(postedOperation(calls, 'create_mindmap')).toHaveLength(0);
      expect(postedOperation(calls, 'delete_mindmap')).toHaveLength(0);

      await user.click(screen.getByRole('button', { name: GENERATE_LABEL }));
      const confirmed = await screen.findByRole('dialog');
      await user.click(within(confirmed).getByRole('button', { name: '生成' }));
      await waitFor(() => {
        expect(postedOperation(calls, 'generate_chapters')).toHaveLength(1);
      });
    } finally {
      restoreLocation();
    }
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
    installEditorBootstrap(editorGetBody(binding));
    const { container } = renderTab(parsedEditorData(), true);
    expect(formValue(container, FIELD)).toBe(PUBLIC_ID);
    expect(screen.getByRole('button', { name: GENERATE_LABEL })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: PUBLIC_TITLE })).not.toHaveTextContent(HIDDEN_HINT);
    expect(screen.getByRole('option', { name: HIDDEN_TITLE })).toHaveTextContent(HIDDEN_HINT);
  });

  it('keeps knowledgeCourseNodeId in the form while the tab is inactive', () => {
    const { container } = renderTab(pageData(boundNode(PUBLIC_ID, PUBLIC_TITLE, true)), false);
    expect(screen.queryByRole('heading', { name: PANEL_TITLE })).toBeNull();
    expect(screen.getByRole('heading', { name: PANEL_TITLE, hidden: true })).toBeInTheDocument();
    expect(formValue(container, FIELD)).toBe(PUBLIC_ID);
    expect(container.querySelector('[name="mindmapId"]')).toBeNull();
  });
});
