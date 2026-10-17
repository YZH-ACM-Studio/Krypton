import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import type { ChapterDraft } from '../../src/pages/course/types.ts';
import type { CourseEditorPageData } from '../../src/pages/course/workbench/model.ts';

// A static import fails collection while settings-tab.tsx is absent.
const tabLoaders = import.meta.glob('../../src/pages/course/workbench/settings-tab.tsx');

const TAB_SOURCE = 'src/pages/course/workbench/settings-tab.tsx';
const COURSE_ID = '64b7c3a2e4b0f96d1a2c3d4e';
const COURSE_TITLE = '线性代数';
const COURSE_TERM = '2026 春';
const COURSE_CONTENT = '向量空间与线性变换。';
const DUE_AT = '2026-11-02T04:30:00.000Z';
const TERM_PLACEHOLDER = '2026 秋';
const FILE_NAME = '讲义.pdf';
const FORM_ID = 'course-editor-form';
const COPY_NOTE = '复制出一门新课程：章节、讲义、题目和视频文件都会带过来，学生的观看和成绩不复制。';
const DELETE_MESSAGE = '课件、视频和观看记录会一并删除，不能恢复。';
const COPIED_COURSE_ID = '64b7c3a2e4b0f96d1a2c3d99';
const SAVE_FIRST = '请先保存课程修改';
const PANEL_TITLES = ['基本信息', '协作者', '真实性训练策略', '课件', '复制课程', '危险操作'] as const;

interface CourseTabProps {
  data: CourseEditorPageData;
  chapters: ChapterDraft[];
  onDirty(): void;
  active: boolean;
}

interface RecordedCall {
  method: string;
  pathname: string;
  body: string;
}

const CHAPTERS: ChapterDraft[] = [
  {
    _id: 1,
    title: '第一章',
    content: '',
    pids: [],
    videos: [],
    sections: [],
    tids: '',
  },
];

let restoreLocation: (() => void) | undefined;

function dueAtInputValue(raw: string): string {
  const date = new Date(raw);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asComponent<Props>(value: unknown, key: string): ComponentType<Props> {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as ComponentType<Props>;
}

function tabLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(tabLoaders)) {
    if (key.endsWith(TAB_SOURCE)) return load;
  }
  return undefined;
}

async function loadCourseSettingsTab(): Promise<ComponentType<CourseTabProps>> {
  const load = tabLoader();
  expect(typeof load, TAB_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${TAB_SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('settings tab module must be an object');
  return asComponent<CourseTabProps>(readField(imported, 'CourseSettingsTab'), 'CourseSettingsTab');
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, 'http://krypton.local');
  if (input instanceof URL) return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  throw new TypeError('unexpected fetch input');
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase();
  return 'GET';
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
    const entry: RecordedCall = { method: requestMethod(input, init), pathname: url.pathname, body: '' };
    calls.push(entry);
    entry.body = await readRequestBody(init?.body);
    if (url.pathname.startsWith('/practice-integrity/')) return jsonResponse({ published: null, draft: null });
    if (entry.method === 'POST') return jsonResponse({ ok: true, tid: COPIED_COURSE_ID });
    if (url.pathname.endsWith('/file')) return jsonResponse({ files: [{ name: FILE_NAME }] });
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function installLocation(): () => void {
  const assign = vi.fn();
  const saved = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...saved, assign, reload: vi.fn() },
  });
  return () => {
    Object.defineProperty(window, 'location', { configurable: true, value: saved });
  };
}

function pageBootstrap(data: CourseEditorPageData): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-18T00:00:00.000Z',
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
      canBrowseProblemBank: false,
    },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'course_edit.html', data },
  };
}

function savedCourse(): CourseEditorPageData {
  return {
    page_name: 'course_edit',
    tdoc: {
      _id: COURSE_ID,
      docId: COURSE_ID,
      owner: 7,
      title: COURSE_TITLE,
      term: COURSE_TERM,
      content: COURSE_CONTENT,
      courseVideoDueAt: DUE_AT,
    },
    groupOptions: [],
    attachedGroups: [],
    canManageOwnGroups: false,
    canManageFiles: true,
    canCreate: true,
    canCreateQuiz: false,
    canAssign: true,
    expectedOwner: 7,
    ownerUser: { _id: 7, uname: 'teacher', displayName: '张老师' },
    maintainerUsers: [],
    files: [{ name: FILE_NAME, size: 128 }],
    mindmaps: [],
  };
}

function unsavedCourse(): CourseEditorPageData {
  return {
    ...savedCourse(),
    page_name: 'course_create',
    tdoc: { title: '未保存课程' },
    canManageFiles: false,
    canCreate: false,
    canAssign: false,
    expectedOwner: undefined,
    ownerUser: undefined,
    maintainerUsers: [],
    files: [],
  };
}

function courseId(data: CourseEditorPageData): string {
  return String(data.tdoc?.docId || data.tdoc?._id || '');
}

function mainForm(): HTMLFormElement {
  const form = document.getElementById(FORM_ID);
  if (!(form instanceof HTMLFormElement)) throw new TypeError('missing course editor form');
  return form;
}

function formsWithOperation(operation: string): HTMLFormElement[] {
  return [...document.querySelectorAll('form')].filter((form) => new FormData(form).get('operation') === operation);
}

function copyPosts(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter((call) => call.method === 'POST' && new URLSearchParams(call.body).get('operation') === 'copy');
}

function locationAssign(): ReturnType<typeof vi.fn> {
  const assign: unknown = Reflect.get(window.location, 'assign');
  if (typeof assign !== 'function' || !('mock' in assign)) throw new TypeError('location.assign is not a mock');
  return assign as ReturnType<typeof vi.fn>;
}

function showsSaveFirst(): boolean {
  if (document.body.textContent?.includes(SAVE_FIRST)) return true;
  return [...document.querySelectorAll('[title]')].some((node) => (node.getAttribute('title') ?? '').includes(SAVE_FIRST));
}

function isDisabled(element: HTMLElement): boolean {
  return element.hasAttribute('disabled') || (element instanceof HTMLButtonElement && element.disabled);
}

async function renderSettings(data: CourseEditorPageData) {
  const Tab = await loadCourseSettingsTab();
  const calls = installFetch();
  const user = userEvent.setup();
  render(
    <BootstrapProvider bootstrap={pageBootstrap(data)}>
      <form
        id={FORM_ID}
        method="post"
        action={courseId(data) ? `/course/${courseId(data)}/edit` : '/course/create'}
        onSubmit={(event) => event.preventDefault()}
      >
        <Tab data={data} chapters={CHAPTERS} onDirty={() => undefined} active />
      </form>
    </BootstrapProvider>,
  );
  return { user, calls };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await new Promise<void>((finish) => {
      setTimeout(finish, 0);
    });
  });
}

beforeEach(() => {
  restoreLocation = installLocation();
});

afterEach(() => {
  restoreLocation?.();
  restoreLocation = undefined;
  vi.unstubAllGlobals();
});

describe('course settings tab', () => {
  it('puts title, term, courseVideoDueAt and content in the main form', async () => {
    await renderSettings(savedCourse());
    const form = mainForm();
    const body = new FormData(form);
    const dueInput = form.querySelector('input[name="courseVideoDueAt"]');
    const termInput = form.querySelector('input[name="term"]');

    expect(body.get('title')).toBe(COURSE_TITLE);
    expect(body.get('term')).toBe(COURSE_TERM);
    expect(body.get('content')).toBe(COURSE_CONTENT);
    expect(body.get('courseVideoDueAt')).toBe(dueAtInputValue(DUE_AT));
    if (!(dueInput instanceof HTMLInputElement)) throw new TypeError('missing courseVideoDueAt');
    if (!(termInput instanceof HTMLInputElement)) throw new TypeError('missing term');
    expect(dueInput.type).toBe('datetime-local');
    expect(termInput.placeholder).toBe(TERM_PLACEHOLDER);
    expect(body.get('operation')).toBeNull();

    for (const title of PANEL_TITLES) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText('标题')).toBeInTheDocument();
    expect(screen.getByText('学期')).toBeInTheDocument();
    expect(screen.getByText('视频截止')).toBeInTheDocument();
    expect(screen.getByText('课程简介')).toBeInTheDocument();
    expect(screen.getByText('课程负责人')).toBeInTheDocument();
    expect(screen.getByText(FILE_NAME)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `删除${FILE_NAME}` })).toBeInTheDocument();
    expect(screen.getByText('拖拽文件到此处，或点击选择')).toBeInTheDocument();
  });

  it('posts operation=copy when 复制为新课程 is clicked', async () => {
    const { user, calls } = await renderSettings(savedCourse());

    expect(screen.getByText(COPY_NOTE)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '复制为新课程' }));
    await waitFor(() => {
      expect(copyPosts(calls)).toHaveLength(1);
    });

    const post = copyPosts(calls)[0];
    if (!post) throw new TypeError('missing copy request');
    expect(post.pathname).toBe(`/course/${COURSE_ID}/edit`);
    expect(new URLSearchParams(post.body).get('operation')).toBe('copy');
    await waitFor(() => {
      expect(locationAssign()).toHaveBeenCalledWith(`/course/${COPIED_COURSE_ID}/edit`);
    });
  });

  it('does not copy after the title changes and shows 请先保存课程修改', async () => {
    const { user, calls } = await renderSettings(savedCourse());
    const titleInput = mainForm().querySelector('input[name="title"]');
    if (!(titleInput instanceof HTMLInputElement)) throw new TypeError('missing title');

    await user.click(titleInput);
    await user.clear(titleInput);
    await user.type(titleInput, '新标题');
    expect(titleInput.value).toBe('新标题');
    await waitFor(() => {
      expect(showsSaveFirst()).toBe(true);
    });

    const copyButton = screen.getByRole('button', { name: '复制为新课程' });
    if (!isDisabled(copyButton)) await user.click(copyButton);
    await flushEffects();
    expect(copyPosts(calls)).toHaveLength(0);
  });

  it('keeps deletion outside the main form and submits it after confirmation', async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    const { user } = await renderSettings(savedCourse());
    const form = mainForm();
    const deleteForms = formsWithOperation('delete');
    const deleteForm = deleteForms[0];

    expect(deleteForms).toHaveLength(1);
    if (!deleteForm) throw new TypeError('missing delete form');
    expect(form.contains(deleteForm)).toBe(false);
    expect(deleteForm).not.toBe(form);
    expect(new FormData(form).get('operation')).toBeNull();
    expect(new FormData(deleteForm).get('operation')).toBe('delete');
    expect(deleteForm.getAttribute('method')?.toLowerCase()).toBe('post');
    expect(deleteForm.getAttribute('action')).toBe(`/course/${COURSE_ID}/edit`);

    await user.click(screen.getByRole('button', { name: '删除课程' }));
    expect(await screen.findByRole('heading', { name: `删除课程「${COURSE_TITLE}」？` })).toBeInTheDocument();
    expect(screen.getByText(DELETE_MESSAGE)).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '删除' }));
    await waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1);
    });
    const submitted = submit.mock.instances[0];
    if (!(submitted instanceof HTMLFormElement)) throw new TypeError('delete submit target is not a form');
    expect(form.contains(submitted)).toBe(false);
    expect(submitted.getAttribute('method')?.toLowerCase()).toBe('post');
    expect(submitted.getAttribute('action')).toBe(`/course/${COURSE_ID}/edit`);
    expect(new FormData(submitted).get('operation')).toBe('delete');
  });

  it('shows the integrity policy only for a saved course', async () => {
    const saved = await renderSettings(savedCourse());
    expect(screen.getByRole('heading', { name: '真实性训练策略' })).toBeInTheDocument();
    await waitFor(() => {
      expect(saved.calls.some((call) => call.method === 'GET' && call.pathname === `/practice-integrity/course/${COURSE_ID}`)).toBe(true);
    });

    cleanup();
    const unsaved = await renderSettings(unsavedCourse());
    await flushEffects();
    expect(screen.queryByRole('heading', { name: '真实性训练策略' })).toBeNull();
    expect(screen.queryByText('禁止粘贴或拖入外部代码')).toBeNull();
    expect(unsaved.calls.some((call) => call.pathname.startsWith('/practice-integrity/'))).toBe(false);
  });
});
