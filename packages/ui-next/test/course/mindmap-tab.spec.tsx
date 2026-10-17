import type { ComponentType, FormEvent } from 'react';
import {
  act, cleanup, fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';
import { DialogHost } from '../../src/components/ui/dialog.tsx';
import type { ChapterDraft } from '../../src/pages/course/types.ts';
import type { CourseEditorPageData } from '../../src/pages/course/workbench/model.ts';

// A static import fails collection while mindmap-tab.tsx is absent.
const tabLoaders = import.meta.glob('../../src/pages/course/workbench/mindmap-tab.tsx');

const TAB_SOURCE = 'src/pages/course/workbench/mindmap-tab.tsx';
const COURSE_ID = '64b8000000000000000000c1';
const PUBLIC_MAP_ID = '64b8000000000000000000d1';
const OWNED_MAP_ID = '64b8000000000000000000e2';
const GROUP_ID = '64b8000000000000000000f1';
const EDIT_PATH = `/course/${COURSE_ID}/edit`;
const PUBLIC_LABEL = '图论入门 · 已公开';
const SELECT_LABEL = '选择课程知识导图';
const GENERATE_LABEL = '从导图生成章节';
const CREATE_LABEL = '创建本课导图';
const DELETE_LABEL = '删除本课导图';
const SAVE_FIRST = '请先保存课程';
const GENERATE_MESSAGE = '已有视频、题目或收集的章节会保留。';
const PANEL_TITLE = '导图';

interface CourseMindmapTabProps {
  data: CourseEditorPageData;
  chapters: ChapterDraft[];
  onDirty: () => void;
  active: boolean;
  onChaptersReplaced: (next: ChapterDraft[]) => void;
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

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function keepFormMounted(event: FormEvent<HTMLFormElement>): void {
  event.preventDefault();
}

function pageData(owned: boolean): CourseEditorPageData {
  const data: CourseEditorPageData = {
    page_name: 'course_edit',
    tdoc: {
      docId: COURSE_ID,
      title: '图论',
      mindmapId: owned ? OWNED_MAP_ID : PUBLIC_MAP_ID,
    },
    groupOptions: [],
    attachedGroups: [],
    canManageOwnGroups: false,
    canManageFiles: false,
    canCreateQuiz: false,
    files: [],
    mindmaps: [{ _id: PUBLIC_MAP_ID, title: '图论入门', visibility: 'public' }],
  };
  if (owned) {
    data.courseOwnedMindmap = {
      _id: OWNED_MAP_ID,
      title: '本课导图',
      updatedAt: '2026-10-16T00:00:00.000Z',
    };
  }
  return data;
}

async function loadTab(): Promise<ComponentType<CourseMindmapTabProps>> {
  let load: unknown;
  for (const [key, candidate] of Object.entries(tabLoaders)) {
    if (key.endsWith(TAB_SOURCE)) load = candidate;
  }
  expect(typeof load, `${TAB_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${TAB_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${TAB_SOURCE} must be a module`);
  const component = readField(imported, 'CourseMindmapTab');
  expect(typeof component, 'CourseMindmapTab').toBe('function');
  if (typeof component !== 'function') throw new TypeError('CourseMindmapTab must be a function');
  return component as ComponentType<CourseMindmapTabProps>;
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
      ok: true,
      createdChapters: 1,
      createdSections: 0,
      removedChapters: 0,
      removedSections: 0,
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

function postedGenerate(calls: RecordedCall[]): RecordedCall[] {
  return postedOperation(calls, 'generate_chapters');
}

function formMindmapId(container: HTMLElement): string {
  const form = container.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new TypeError('expected a form');
  const values = [...new FormData(form).getAll('mindmapId')].filter((item): item is string => typeof item === 'string');
  expect(values).toHaveLength(1);
  const value = values[0];
  if (value === undefined) throw new TypeError('expected mindmapId');
  return value;
}

function hiddenMindmapInput(container: HTMLElement): HTMLInputElement {
  const fields = [...container.querySelectorAll('input[name="mindmapId"]')].filter((node): node is HTMLInputElement => node instanceof HTMLInputElement);
  expect(fields).toHaveLength(1);
  const field = fields[0];
  if (!field) throw new TypeError('expected mindmapId');
  return field;
}

function installLocation(): void {
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
}

async function renderTab(data: CourseEditorPageData, active: boolean): Promise<HTMLElement> {
  const Tab = await loadTab();
  const savedTitle = typeof data.tdoc?.title === 'string' ? data.tdoc.title : '';
  const view = render(
    <form onSubmit={keepFormMounted}>
      <input name="title" defaultValue={savedTitle} aria-label="名称" />
      <DialogHost />
      <Tab
        data={data}
        chapters={CHAPTERS}
        onDirty={vi.fn()}
        onChaptersReplaced={vi.fn()}
        active={active}
      />
    </form>,
  );
  return view.container;
}

function titleField(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[name="title"]');
  if (!(input instanceof HTMLInputElement)) throw new TypeError('expected title');
  return input;
}

async function editCourseTitle(user: ReturnType<typeof userEvent.setup>, container: HTMLElement): Promise<void> {
  const input = titleField(container);
  const original = input.value;
  await user.clear(input);
  await user.type(input, `${original}修订`);
  await user.tab();
  expect(input.value).not.toBe(original);
}

async function openedDialog(): Promise<HTMLElement | null> {
  try {
    return await screen.findByRole('dialog', {}, { timeout: 400 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unable to find role="dialog"')) return null;
    throw error;
  }
}

async function pressAction(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}

function MindmapHost({
  Tab,
  data,
  active,
  groupIds,
}: {
  Tab: ComponentType<CourseMindmapTabProps>;
  data: CourseEditorPageData;
  active: boolean;
  groupIds: string;
}) {
  const savedTitle = typeof data.tdoc?.title === 'string' ? data.tdoc.title : '';
  return (
    <form onSubmit={keepFormMounted}>
      <input type="hidden" name="courseGroupIds" value={groupIds} />
      <input name="title" defaultValue={savedTitle} aria-label="名称" />
      <DialogHost />
      <Tab
        data={data}
        chapters={CHAPTERS}
        onDirty={vi.fn()}
        onChaptersReplaced={vi.fn()}
        active={active}
      />
    </form>
  );
}

async function showAfterSilentGroupChange(data: CourseEditorPageData): Promise<HTMLElement> {
  const Tab = await loadTab();
  const view = render(<MindmapHost Tab={Tab} data={data} active={false} groupIds="" />);
  view.rerender(<MindmapHost Tab={Tab} data={data} active={false} groupIds={GROUP_ID} />);
  view.rerender(<MindmapHost Tab={Tab} data={data} active groupIds={GROUP_ID} />);
  const field = view.container.querySelector('input[name="courseGroupIds"]');
  if (!(field instanceof HTMLInputElement)) throw new TypeError('expected courseGroupIds');
  expect(field.value).toBe(GROUP_ID);
  return view.container;
}

async function confirmOpenDialog(confirmLabel: string): Promise<void> {
  const dialog = await openedDialog();
  if (!dialog) return;
  const confirm = within(dialog).getByRole('button', { name: confirmLabel });
  await act(async () => {
    fireEvent.click(confirm);
    await new Promise((finish) => {
      setTimeout(finish, 0);
    });
  });
}

afterEach(() => {
  cleanup();
});

describe('course mindmap tab', () => {
  it('shows a mindmapId choice when the course has no owned map', async () => {
    const container = await renderTab(pageData(false), true);
    const choice = screen.getByRole('combobox', { name: SELECT_LABEL });
    expect(choice).toHaveTextContent(PUBLIC_LABEL);
    expect(formMindmapId(container)).toBe(PUBLIC_MAP_ID);
    expect(screen.getByRole('heading', { name: PANEL_TITLE })).toBeInTheDocument();
  });

  it('keeps the owned map id in a hidden mindmapId field', async () => {
    const container = await renderTab(pageData(true), true);
    expect(screen.queryByRole('combobox', { name: SELECT_LABEL })).toBeNull();
    const field = hiddenMindmapInput(container);
    expect(field.type).toBe('hidden');
    expect(field.value).toBe(OWNED_MAP_ID);
    expect(formMindmapId(container)).toBe(OWNED_MAP_ID);
    expect(screen.getByText('这是本课专属导图。学生进入课程就能看到当前结构。要改绑公开导图，需要先删除它。')).toBeInTheDocument();
  });

  it('hides the panel when the tab is inactive', async () => {
    const container = await renderTab(pageData(false), false);
    expect(screen.queryByRole('heading', { name: PANEL_TITLE })).toBeNull();
    const heading = screen.getByRole('heading', { name: PANEL_TITLE, hidden: true });
    expect(heading.closest('[hidden]')).not.toBeNull();
    expect(formMindmapId(container)).toBe(PUBLIC_MAP_ID);
  });

  it('posts generate_chapters after confirming the owned map action', async () => {
    installLocation();
    const calls = installFetch();
    const user = userEvent.setup();
    await renderTab(pageData(true), true);
    const generate = screen.getByRole('button', { name: GENERATE_LABEL });
    expect(generate).toBeEnabled();

    await user.click(generate);
    const cancelled = await screen.findByRole('dialog', { name: GENERATE_LABEL });
    expect(within(cancelled).getByText(GENERATE_MESSAGE, { exact: false })).toBeInTheDocument();
    await user.click(within(cancelled).getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(postedGenerate(calls)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: GENERATE_LABEL }));
    const confirmed = await screen.findByRole('dialog', { name: GENERATE_LABEL });
    await user.click(within(confirmed).getByRole('button', { name: '生成' }));
    await waitFor(() => {
      expect(postedGenerate(calls)).toHaveLength(1);
    });
  });

  it('blocks chapter generation while the course title is unsaved', async () => {
    installLocation();
    const calls = installFetch();
    const user = userEvent.setup();
    const container = await renderTab(pageData(true), true);
    await editCourseTitle(user, container);
    const generate = screen.getByRole('button', { name: GENERATE_LABEL });
    await waitFor(() => {
      expect(generate).toBeDisabled();
    });
    expect(generate).toHaveAttribute('title', SAVE_FIRST);
    await pressAction(GENERATE_LABEL);
    await confirmOpenDialog('生成');
    expect(postedGenerate(calls)).toHaveLength(0);
  });

  it('does not create a mindmap while the course title is unsaved', async () => {
    installLocation();
    const calls = installFetch();
    const user = userEvent.setup();
    const container = await renderTab(pageData(false), true);
    await editCourseTitle(user, container);
    await pressAction(CREATE_LABEL);
    await confirmOpenDialog('创建');
    expect(postedOperation(calls, 'create_mindmap')).toHaveLength(0);
    const create = screen.getByRole('button', { name: CREATE_LABEL });
    expect(create).toBeDisabled();
    expect(create).toHaveAttribute('title', SAVE_FIRST);
  });

  it('does not delete a mindmap while the course title is unsaved', async () => {
    installLocation();
    const calls = installFetch();
    const user = userEvent.setup();
    const container = await renderTab(pageData(true), true);
    await editCourseTitle(user, container);
    await pressAction(DELETE_LABEL);
    await confirmOpenDialog('删除');
    expect(postedOperation(calls, 'delete_mindmap')).toHaveLength(0);
    expect(screen.getByRole('button', { name: DELETE_LABEL })).toBeDisabled();
  });

  it('blocks mindmap actions when a hidden group field changes without an input event', async () => {
    installLocation();
    const calls = installFetch();
    await showAfterSilentGroupChange(pageData(true));
    const generate = screen.getByRole('button', { name: GENERATE_LABEL });
    const remove = screen.getByRole('button', { name: DELETE_LABEL });
    expect(generate).toBeDisabled();
    expect(generate).toHaveAttribute('title', SAVE_FIRST);
    expect(remove).toBeDisabled();
    expect(postedOperation(calls, 'generate_chapters')).toHaveLength(0);
    expect(postedOperation(calls, 'delete_mindmap')).toHaveLength(0);

    cleanup();
    await showAfterSilentGroupChange(pageData(false));
    const create = screen.getByRole('button', { name: CREATE_LABEL });
    expect(create).toBeDisabled();
    expect(create).toHaveAttribute('title', SAVE_FIRST);
    expect(postedOperation(calls, 'create_mindmap')).toHaveLength(0);
  });
});
