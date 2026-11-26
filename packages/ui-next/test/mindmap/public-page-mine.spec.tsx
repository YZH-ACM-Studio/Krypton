import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { MindmapPage } from '../../src/pages/mindmap/index.tsx';

const VERSION = '2026-10-16T00:00:00.000Z';
const COURSE_LABEL = '课程';
const MINE_HINT = '我的';
const HIDDEN_HINT = '仅你可见';
const MINE_HIDDEN_HINT = `${MINE_HINT} · ${HIDDEN_HINT}`;
const EDIT_LABEL = '编辑';
const COURSE_A = 'course-a';
const COURSE_B = 'course-b';
const COURSE_C = 'course-c';
const TITLE_A = '程序设计';
const TITLE_B = '数据结构';
const TITLE_C = '实验室安全';

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

function course(input: {
  id: string;
  title: string;
  order: number;
  visibility: 'public' | 'hidden';
  mine: boolean;
  canEdit: boolean;
}): Record<string, unknown> {
  return { ...input, ownerUids: [] };
}

function listedCourses(): Record<string, unknown>[] {
  return [
    course({ id: COURSE_A, title: TITLE_A, order: 1, visibility: 'public', mine: false, canEdit: false }),
    course({ id: COURSE_B, title: TITLE_B, order: 2, visibility: 'public', mine: true, canEdit: false }),
    course({ id: COURSE_C, title: TITLE_C, order: 3, visibility: 'hidden', mine: true, canEdit: true }),
  ];
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

function pageData(selectedId: string, courses: Record<string, unknown>[] = listedCourses()): Record<string, unknown> {
  const config = mapConfig();
  return {
    config,
    course: selectedId,
    courses,
    nodes: [
      node('root', null, 0, '知识图谱'),
      node(COURSE_A, 'root', 1, TITLE_A),
      node(COURSE_B, 'root', 2, TITLE_B),
      node(COURSE_C, 'root', 3, TITLE_C),
    ],
    maps: [config],
  };
}

function coursesReplacing(field: 'mine' | 'canEdit', value: unknown | undefined): Record<string, unknown>[] {
  return listedCourses().map((item, index) => {
    if (index !== 0) return item;
    if (value === undefined) {
      return Object.fromEntries(Object.entries(item).filter(([key]) => key !== field));
    }
    return { ...item, [field]: value };
  });
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

function expectClosed(data: Record<string, unknown>) {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(() => renderPage(data)).toThrow();
  } finally {
    consoleError.mockRestore();
    cleanup();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('public mindmap page shows my courses first', () => {
  it('lists mine courses first and keeps their hints', async () => {
    const user = userEvent.setup();
    renderPage(pageData(COURSE_A));
    await user.click(screen.getByRole('combobox', { name: COURSE_LABEL }));
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent(TITLE_B);
    expect(options[0]).toHaveTextContent(MINE_HINT);
    expect(options[0]).not.toHaveTextContent(HIDDEN_HINT);
    expect(options[1]).toHaveTextContent(TITLE_C);
    expect(options[1]).toHaveTextContent(MINE_HIDDEN_HINT);
    expect(options[2]).toHaveTextContent(TITLE_A);
    expect(options[2]).not.toHaveTextContent(MINE_HINT);
    expect(options[2]).not.toHaveTextContent(HIDDEN_HINT);
  });

  it('shows an edit link only for the current editable course', () => {
    renderPage(pageData(COURSE_C));
    const select = screen.getByRole('combobox', { name: COURSE_LABEL });
    const edit = screen.getByRole('link', { name: EDIT_LABEL });
    expect(select).toHaveTextContent(TITLE_C);
    expect(screen.getAllByRole('link', { name: EDIT_LABEL })).toHaveLength(1);
    expect(edit).toHaveAttribute('href', `/mindmap/${COURSE_C}/edit`);
    expect(edit).toHaveAttribute('data-variant', 'secondary');
    expect(edit).toHaveAttribute('data-size', 'sm');
    expect(select.parentElement?.contains(edit)).toBe(true);
    expect(select.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    cleanup();
    renderPage(pageData(COURSE_A));
    expect(screen.getByRole('combobox', { name: COURSE_LABEL })).toHaveTextContent(TITLE_A);
    expect(screen.queryByRole('link', { name: EDIT_LABEL })).toBeNull();

    cleanup();
    renderPage(pageData(COURSE_B));
    expect(screen.getByRole('combobox', { name: COURSE_LABEL })).toHaveTextContent(TITLE_B);
    expect(screen.queryByRole('link', { name: EDIT_LABEL })).toBeNull();
  });

  it('throws when a course omits mine', () => {
    expectClosed(pageData(COURSE_A, coursesReplacing('mine', undefined)));
  });

  it('throws when a course omits canEdit', () => {
    expectClosed(pageData(COURSE_A, coursesReplacing('canEdit', undefined)));
  });

  it('throws when mine is not a boolean', () => {
    expectClosed(pageData(COURSE_A, coursesReplacing('mine', 'true')));
  });

  it('throws when canEdit is not a boolean', () => {
    expectClosed(pageData(COURSE_A, coursesReplacing('canEdit', 1)));
  });
});
