import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { MindmapPage } from '../../src/pages/mindmap/index.tsx';

const VERSION = '2026-10-16T00:00:00.000Z';
const COURSE_LABEL = '课程';
const HIDDEN_HINT = '仅你可见';
const EMPTY_TITLE = '还没有公开的知识图谱';
const PANEL_TITLE = '选择一个节点查看相关题目';
const EMPTY_PROBLEMS = '此节点暂无关联题目';
const PROBLEM_ERROR = '关联题目加载失败';
const CHILD_TOPIC = '一维数组';

function makeBootstrap(data: Record<string, unknown>): KryptonBootstrap {
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
    page: { templateName: 'mindmap_main.html', data },
  };
}

function node(id: string, parentId: string | null, order: number, topic: string): Record<string, unknown> {
  return {
    _id: id,
    mapId: 'map-merged',
    parentId,
    topic,
    tags: [],
    problemIds: [],
    order,
    createdAt: VERSION,
    updatedAt: VERSION,
  };
}

function course(id: string, title: string, order: number, visibility: 'public' | 'hidden'): Record<string, unknown> {
  return { id, title, order, visibility, ownerUids: [] };
}

function mapConfig(): Record<string, unknown> {
  return {
    _id: 'map-merged',
    title: '知识图谱',
    rootNodeId: 'root',
    visibility: 'public',
    layoutDirection: 'RIGHT',
    createdAt: VERSION,
    updatedAt: VERSION,
  };
}

function pageData(): Record<string, unknown> {
  const config = mapConfig();
  return {
    config,
    course: 'course-programming',
    courses: [
      course('course-programming', '程序设计基础(I)', 1, 'public'),
      course('course-os', '操作系统', 2, 'public'),
      course('course-safety', '实验室安全与防护', 3, 'hidden'),
    ],
    nodes: [
      node('root', null, 0, '知识图谱'),
      node('course-programming', 'root', 1, '程序设计基础(I)'),
      node('node-array', 'course-programming', 1, CHILD_TOPIC),
    ],
    maps: [config],
  };
}

function emptyCourseData(): Record<string, unknown> {
  const config = mapConfig();
  return {
    config,
    course: null,
    courses: [],
    nodes: [node('root', null, 0, '知识图谱')],
    maps: [config],
  };
}

function unselectedHiddenCourseData(): Record<string, unknown> {
  const config = mapConfig();
  return {
    config,
    course: null,
    courses: [course('course-safety', '实验室安全与防护', 1, 'hidden')],
    nodes: [node('root', null, 0, '知识图谱')],
    maps: [config],
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPage(data: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ problems: [] }))));
  return render(
    <BootstrapProvider bootstrap={makeBootstrap(data)}>
      <MindmapPage />
    </BootstrapProvider>,
  );
}

function installLocation(): { assign: ReturnType<typeof vi.fn>; restore: () => void } {
  const assign = vi.fn();
  const saved = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...saved, assign },
  });
  return {
    assign,
    restore: () => {
      Object.defineProperty(window, 'location', { configurable: true, value: saved });
    },
  };
}

function canvasElement(): HTMLElement {
  const flow = document.querySelector('.react-flow');
  if (!(flow instanceof HTMLElement)) throw new Error('canvas is missing');
  return flow;
}

function fetchInputUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return '';
}

function problemRequestUrls(): string[] {
  const current = globalThis.fetch;
  if (!vi.isMockFunction(current)) throw new Error('fetch is not mocked');
  return current.mock.calls
    .map(([input]) => fetchInputUrl(input))
    .filter((url) => url.includes('/api/mindmap/problems'));
}

function canvasTopic(topic: string): HTMLElement {
  const match = within(canvasElement()).getByText(topic);
  const flowNode = match.closest('.react-flow__node');
  if (!(flowNode instanceof HTMLElement)) throw new Error(`canvas node missing for ${topic}`);
  return flowNode;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('public mindmap page by course node', () => {
  it('places the course selector under the page header', () => {
    renderPage(pageData());
    const select = screen.getByRole('combobox', { name: COURSE_LABEL });
    expect(select).toHaveClass('w-56');
    expect(select.closest('.ml-auto')).toBeNull();
    expect(select.parentElement?.firstElementChild).toBe(select);
    const title = screen.getByRole('heading', { level: 1 });
    expect(title.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(select).toHaveTextContent('程序设计基础(I)');
  });

  it('navigates to the selected course', async () => {
    const navigation = installLocation();
    try {
      const user = userEvent.setup();
      renderPage(pageData());
      await user.click(screen.getByRole('combobox', { name: COURSE_LABEL }));
      await user.click(screen.getByRole('option', { name: '操作系统' }));
      expect(navigation.assign).toHaveBeenCalledWith('/mindmap?course=course-os');
    } finally {
      navigation.restore();
    }
  });

  it('marks a hidden course as only visible to you', async () => {
    const user = userEvent.setup();
    renderPage(pageData());
    await user.click(screen.getByRole('combobox', { name: COURSE_LABEL }));
    expect(screen.getByRole('option', { name: '程序设计基础(I)' })).not.toHaveTextContent(HIDDEN_HINT);
    expect(screen.getByRole('option', { name: '操作系统' })).not.toHaveTextContent(HIDDEN_HINT);
    expect(screen.getByRole('option', { name: '实验室安全与防护' })).toHaveTextContent(HIDDEN_HINT);
  });

  it('draws the payload nodes on the canvas', async () => {
    renderPage(pageData());
    await waitFor(() => {
      const text = canvasElement().textContent ?? '';
      expect(text).toContain('知识图谱');
      expect(text).toContain('程序设计基础(I)');
      expect(text).toContain(CHILD_TOPIC);
      expect(text).not.toContain('操作系统');
      expect(text).not.toContain('实验室安全与防护');
    });
  });

  it('keeps the node problem panel', () => {
    renderPage(pageData());
    expect(screen.getByText(PANEL_TITLE)).toBeInTheDocument();
  });

  it('shows an empty problem list for the root and requests a course node', async () => {
    renderPage(pageData());
    await within(canvasElement()).findByText('知识图谱');
    fireEvent.click(canvasTopic('知识图谱'));
    await waitFor(() => {
      expect(screen.getAllByText(EMPTY_PROBLEMS).length).toBeGreaterThan(0);
    });
    expect(screen.queryAllByText(PROBLEM_ERROR, { exact: false })).toEqual([]);
    expect(problemRequestUrls()).toEqual([]);
    fireEvent.click(canvasTopic('程序设计基础(I)'));
    await waitFor(() => {
      const matched = problemRequestUrls().some((url) => {
        const parsed = new URL(url, 'http://localhost');
        return parsed.pathname.endsWith('/api/mindmap/problems') && parsed.searchParams.get('nodeId') === 'course-programming';
      });
      expect(matched).toBe(true);
    });
  });

  it('shows an empty state when no course is visible', () => {
    renderPage(emptyCourseData());
    expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: COURSE_LABEL })).toBeNull();
  });

  it('selects the only hidden course when none is selected', async () => {
    const navigation = installLocation();
    try {
      const user = userEvent.setup();
      renderPage(unselectedHiddenCourseData());
      expect(navigation.assign).not.toHaveBeenCalled();
      await user.click(screen.getByRole('combobox', { name: COURSE_LABEL }));
      expect(screen.getByRole('option', { name: '实验室安全与防护' })).toHaveTextContent(HIDDEN_HINT);
      await user.click(screen.getByRole('option', { name: '实验室安全与防护' }));
      expect(navigation.assign).toHaveBeenCalledWith('/mindmap?course=course-safety');
    } finally {
      navigation.restore();
    }
  });
});
