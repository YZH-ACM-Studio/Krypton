import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { CourseEditPage } from '../../src/pages/course/editor.tsx';
import type { GroupRefView } from '../../src/pages/course/types.ts';

const EXAM_ID = '64a000000000000000000801';

const group: GroupRefView = {
  _id: 'group-a',
  name: '一班',
  schoolName: null,
  state: 'active',
  kind: 'own',
  attachable: true,
};

function editData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    page_name: 'course_edit',
    tdoc: {
      _id: 'course-1',
      docId: 'course-1',
      title: '消防课程',
      courseGroupIds: ['group-a'],
      courseHidden: false,
      courseExam: { contestId: EXAM_ID, gate: 'percent', percent: 80 },
    },
    chapters: JSON.stringify([{
      _id: 1,
      title: '第一章',
      content: '',
      pids: [],
      tids: [],
    }]),
    groupOptions: [group],
    attachedGroups: [group],
    canManageOwnGroups: false,
    canManageFiles: false,
    canCreate: false,
    canCreateQuiz: false,
    canAssign: false,
    files: [],
    mindmaps: [],
    courseExamContest: { docId: EXAM_ID, title: '期末考试' },
    ...overrides,
  };
}

function pageBootstrap(data: Record<string, unknown>): KryptonBootstrap {
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

function renderEditor(data: Record<string, unknown>) {
  return render(
    <BootstrapProvider bootstrap={pageBootstrap(data)}>
      <CourseEditPage />
    </BootstrapProvider>,
  );
}

function field(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  expect(typeof value, name).toBe('string');
  if (typeof value !== 'string') throw new Error(`missing ${name}`);
  return value;
}

interface SaveRequest {
  method: string;
  body: URLSearchParams | null;
}

const saveRequests: SaveRequest[] = [];

function jsonOk(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function bodyParams(body: BodyInit | null | undefined): URLSearchParams {
  if (body instanceof URLSearchParams) return body;
  if (typeof body === 'string') return new URLSearchParams(body);
  throw new Error('save body is not form data');
}

function noteCourseEdit(input: RequestInfo | URL, init: RequestInit | undefined) {
  const pathname = new URL(requestUrl(input), window.location.origin).pathname;
  if (pathname !== '/course/course-1/edit') return;
  const method = (init?.method ?? 'GET').toUpperCase();
  saveRequests.push({
    method,
    body: method === 'POST' ? bodyParams(init?.body) : null,
  });
}

function postedSave(): SaveRequest {
  expect(saveRequests).toHaveLength(1);
  const request = saveRequests[0];
  if (!request) throw new Error('missing save request');
  expect(request.method).toBe('POST');
  if (!request.body) throw new Error('missing save body');
  return request;
}

let restoreLocation: () => void = () => {};

function installLocation(href: string): { replace: ReturnType<typeof vi.fn>; reload: ReturnType<typeof vi.fn> } {
  const saved = window.location;
  const url = new URL(href, saved.origin);
  const replace = vi.fn();
  const reload = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: url.href,
      origin: url.origin,
      protocol: url.protocol,
      host: url.host,
      hostname: url.hostname,
      port: url.port,
      pathname: url.pathname,
      search: url.search,
      hash: '',
      assign: vi.fn(),
      replace,
      reload,
      toString: () => url.href,
    },
  });
  restoreLocation = () => {
    Object.defineProperty(window, 'location', { configurable: true, value: saved });
  };
  return { replace, reload };
}

beforeEach(() => {
  saveRequests.length = 0;
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    noteCourseEdit(input, init);
    return Promise.resolve(jsonOk({ tid: 'course-1', published: null, draft: null }));
  }));
});

afterEach(() => {
  restoreLocation();
  restoreLocation = () => {};
  window.history.replaceState(null, '', '/');
});

describe('course editor shell', () => {
  it('shows the exam panel and keeps the chapter panel mounted when tab=exam', () => {
    window.history.replaceState(null, '', '/course/course-1/edit?tab=exam');
    renderEditor(editData());

    expect(screen.getByRole('tab', { name: '结业考试', selected: true })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '观看统计' }).getAttribute('href')).toBe('/course/course-1/videos');
    const outline = screen.getByRole('heading', { name: '大纲', hidden: true });
    expect(outline.closest('[hidden]')).not.toBeNull();
    const exam = screen.getByRole('heading', { name: '结业考试' });
    expect(exam.closest('[hidden]')).toBeNull();
  });

  it('switches tabs with history.replaceState and keeps both panels mounted', async () => {
    window.history.replaceState(null, '', '/course/course-1/edit');
    const user = userEvent.setup();
    renderEditor(editData());
    const replaceState = vi.spyOn(window.history, 'replaceState');

    await user.click(screen.getByRole('tab', { name: '结业考试' }));

    const call = replaceState.mock.calls[replaceState.mock.calls.length - 1];
    const target: unknown = call?.[2];
    expect(String(target)).toContain('tab=exam');
    expect(screen.getByRole('heading', { name: '大纲', hidden: true }).closest('[hidden]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: '结业考试' }).closest('[hidden]')).toBeNull();
  });

  it('posts chapters, the exam gate, groups, and the title from one form', () => {
    renderEditor(editData());
    const form = document.getElementById('course-editor-form');
    if (!(form instanceof HTMLFormElement)) throw new Error('missing course editor form');

    expect(form.getAttribute('action')).toBe('/course/course-1/edit');
    expect((form.getAttribute('method') || '').toLowerCase()).toBe('post');
    expect(field(form, 'tid')).toBe('course-1');
    expect(field(form, 'chapters')).toContain('"title":"第一章"');
    expect(field(form, 'description')).toBe('');
    expect(field(form, 'courseExamGate')).toBe('percent');
    expect(field(form, 'courseGroupIds')).toBe('group-a');
    expect(field(form, 'title')).toBe('消防课程');
  });

  it('reloads the editor after a successful save', async () => {
    const { reload } = installLocation('/course/course-1/edit');
    const user = userEvent.setup();
    renderEditor(editData());

    await user.type(screen.getByRole('textbox', { name: '章节标题' }), '改');
    expect(screen.getByText('1 项修改未保存')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: (accessibleName) => accessibleName === '保存' }));

    await waitFor(() => {
      expect(saveRequests.length).toBeGreaterThan(0);
    });
    const request = postedSave();
    const body = request.body;
    if (!body) throw new Error('missing save body');
    expect(request.method).toBe('POST');
    expect(body.get('chapters')).toContain('"title":"第一章改"');
    expect(body.get('courseExamGate')).toBe('percent');
    expect(body.get('courseGroupIds')).toBe('group-a');
    expect(body.get('title')).toBe('消防课程');
    await waitFor(() => {
      expect(reload).toHaveBeenCalled();
    });
  });

  it('does not reload when the chapter title changes before the save returns', async () => {
    const { reload } = installLocation('/course/course-1/edit');
    let finishSave: (response: Response) => void = () => {
      throw new Error('save was not posted');
    };
    let markPosted: () => void = () => {};
    const posted = new Promise<void>((done) => {
      markPosted = done;
    });
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const pathname = new URL(requestUrl(input), window.location.origin).pathname;
      if (method === 'POST' && pathname === '/course/course-1/edit') {
        noteCourseEdit(input, init);
        return new Promise<Response>((finish) => {
          finishSave = finish;
          markPosted();
        });
      }
      return Promise.resolve(jsonOk({ published: null, draft: null }));
    }));
    const user = userEvent.setup();
    renderEditor(editData());

    await user.type(screen.getByRole('textbox', { name: '章节标题' }), '改');
    await user.click(screen.getByRole('button', { name: (accessibleName) => accessibleName === '保存' }));
    await posted;
    const request = postedSave();
    const body = request.body;
    if (!body) throw new Error('missing save body');
    expect(body.get('chapters')).toContain('"title":"第一章改"');
    await user.type(screen.getByRole('textbox', { name: '章节标题' }), '再');
    finishSave(jsonOk({ tid: 'course-1' }));

    await waitFor(() => {
      expect(reload).not.toHaveBeenCalled();
      expect(screen.getByText('1 项修改未保存')).toBeTruthy();
      expect(screen.getByRole('button', { name: (accessibleName) => accessibleName === '保存' })).toBeEnabled();
    });
  });

  it('opens the teacher course list when the page is course_create', () => {
    const { replace } = installLocation('/course/create');
    renderEditor(editData({
      page_name: 'course_create',
      tdoc: {},
    }));

    expect(replace).toHaveBeenCalledWith('/teach/courses?new=1');
    expect(screen.getByText('正在打开…')).toBeTruthy();
  });

  it('shows the course header for a hidden course with no class groups', () => {
    renderEditor(editData({
      tdoc: {
        _id: 'course-1',
        docId: 'course-1',
        title: '消防课程',
        courseGroupIds: [],
        courseHidden: true,
      },
      groupOptions: [],
      attachedGroups: [],
      courseExamContest: null,
    }));

    expect(screen.getByRole('heading', { level: 1, name: '消防课程' })).toBeTruthy();
    const studentView = screen.getByRole('link', { name: '学生视角' });
    expect(studentView.getAttribute('href')).toBe('/course/course-1');
    expect(studentView.getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('link', { name: '课程' }).getAttribute('href')).toBe('/teach/courses');
    expect(screen.getByText('全站可见', { exact: true })).toBeTruthy();
    expect(screen.getByText('已隐藏', { exact: true })).toBeTruthy();
    expect(screen.getByText('1 章 · 0 个视频 · 0 个题目集')).toBeTruthy();
    expect(screen.getByRole('button', { name: '大纲' })).toBeTruthy();
  });
});
