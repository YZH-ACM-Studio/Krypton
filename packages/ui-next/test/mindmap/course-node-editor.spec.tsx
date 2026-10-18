import type { ComponentType, ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../src/components/ui/toast.tsx';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { PageResolver } from '../../src/pages/resolver.tsx';

const VERSION = '2026-10-16T00:00:00.000Z';
const COURSE_ID = 'course-programming';
const CHILD_ID = 'node-array';
const MAP_ID = 'map-merged';
const ROOT_ID = 'graph-root';
const COURSE_TITLE = '程序设计基础(I)';
const PAGE_TITLE = `${COURSE_TITLE} · 知识点`;
const NODES_PATH = `/mindmap/${COURSE_ID}/nodes`;
const RESERVED_BUTTON = /^(?:保存节点|添加|删除节点|展开节点|收起节点|子节点|同级|上移|下移|返回课程|关闭)$/;

type User = ReturnType<typeof userEvent.setup>;

function makeBootstrap(templateName: string, data: Record<string, unknown>): KryptonBootstrap {
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

function node(
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

function editorPayload(): Record<string, unknown> {
  return {
    courseNode: {
      id: COURSE_ID,
      title: COURSE_TITLE,
      order: 1,
      visibility: 'public',
      ownerUids: [3],
    },
    nodes: [
      node(COURSE_ID, ROOT_ID, 1, COURSE_TITLE, {
        courseVisibility: 'public',
        ownerUids: [3],
      }),
      node(CHILD_ID, COURSE_ID, 1, '一维数组'),
    ],
    referenceCounts: {
      [COURSE_ID]: 0,
      [CHILD_ID]: 0,
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
    nodes: [node(COURSE_ID, null, 0, COURSE_TITLE, { coursePins: [] })],
    problems: [],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

function requestPath(url: string): string {
  return new URL(url, 'http://localhost').pathname;
}

function installFetch(saved: Record<string, unknown>): RecordedCall[] {
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

function readExport(moduleValue: unknown, name: string): unknown {
  if (typeof moduleValue !== 'object' || moduleValue === null) return undefined;
  if (!(name in moduleValue)) return undefined;
  return Reflect.get(moduleValue, name);
}

function isComponent(value: unknown): value is ComponentType {
  return typeof value === 'function';
}

async function loadEditor(): Promise<ComponentType> {
  const imported: unknown = await import('../../src/pages/course/mindmap-editor.tsx');
  const page = readExport(imported, 'CourseNodeMindmapEditPage');
  expect(typeof page, 'CourseNodeMindmapEditPage is not exported').toBe('function');
  if (!isComponent(page)) throw new TypeError('CourseNodeMindmapEditPage must be a function');
  return page;
}

async function renderEditor(data: Record<string, unknown> = editorPayload()): Promise<RecordedCall[]> {
  const Page = await loadEditor();
  const calls = installFetch(data);
  renderShell('mindmap_course_edit.html', data, <Page />);
  return calls;
}

function outlineItem(topic: string): HTMLElement {
  const found = screen.getAllByRole('treeitem').find((item) => item.textContent?.includes(topic));
  if (!found) throw new Error(`outline is missing ${topic}`);
  return found;
}

async function revealTopic(user: User, parentTopic: string, topic: string) {
  if (screen.queryAllByRole('treeitem').some((item) => item.textContent?.includes(topic))) return;
  await user.click(within(outlineItem(parentTopic)).getByRole('button', { name: '展开节点' }));
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
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  }
  const params = new URLSearchParams(text);
  const fields: Record<string, unknown> = {};
  const operation = params.get('operation');
  if (operation) fields.operation = operation;
  const payload = params.get('payload');
  if (payload) {
    const parsed: unknown = JSON.parse(payload);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      Object.assign(fields, parsed as Record<string, unknown>);
    }
  }
  for (const [key, value] of params.entries()) {
    if (key === 'payload' || key === 'operation') continue;
    fields[key] = value;
  }
  return fields;
}

function findField(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findField(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (Object.hasOwn(record, key)) return record[key];
  for (const item of Object.values(record)) {
    const found = findField(item, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function buttonNear(label: HTMLElement): HTMLElement | undefined {
  let host: HTMLElement | null = label.parentElement;
  for (let depth = 0; depth < 6 && host; depth += 1) {
    const buttons = within(host).queryAllByRole('button').filter((button) => {
      const name = (button.getAttribute('aria-label') || button.textContent || '').replace(/\s+/g, ' ').trim();
      return !RESERVED_BUTTON.test(name);
    });
    if (buttons.length === 1) return buttons[0];
    host = host.parentElement;
  }
  return undefined;
}

async function openCollectedSheet(user: User): Promise<HTMLElement> {
  const already = screen.queryByRole('dialog');
  if (already && within(already).queryByRole('region', { name: '题库' })) return already;
  const named = screen.queryByRole('button', { name: '收录题' });
  const opener = named ?? screen.getAllByText('收录题').map((label) => buttonNear(label)).find((button) => button);
  if (!opener) throw new Error('收录题 picker did not open');
  await user.click(opener);
  const sheet = await screen.findByRole('dialog');
  expect(within(sheet).getByRole('region', { name: '题库' })).toBeTruthy();
  return sheet;
}

function postsToNodes(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter((call) => requestPath(call.url) === NODES_PATH && call.init?.method === 'POST');
}

function sameValue(actual: unknown, expected: unknown): boolean {
  if (!Array.isArray(expected)) return actual === expected;
  return Array.isArray(actual)
    && actual.length === expected.length
    && expected.every((item, index) => actual[index] === item);
}

function postWithField(calls: RecordedCall[], key: string, expected: unknown): RecordedCall | undefined {
  return postsToNodes(calls).find((call) => sameValue(findField(postedFields(call.init), key), expected));
}

function renderShell(templateName: string, data: Record<string, unknown>, page: ReactNode) {
  return render(
    <BootstrapProvider bootstrap={makeBootstrap(templateName, data)}>
      <ToastProvider>
        {page}
      </ToastProvider>
    </BootstrapProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('course node editor page', () => {
  it('shows the course node title and breadcrumb', async () => {
    await renderEditor();

    expect(screen.getByRole('heading', { name: PAGE_TITLE })).toBeTruthy();
    const crumbText = screen.getByRole('navigation', { name: 'breadcrumb' }).textContent ?? '';
    expect(crumbText).toContain('导图');
    expect(crumbText.includes(COURSE_TITLE) || crumbText.includes('课程节点')).toBe(true);
    expect(screen.getAllByText('收录题').length).toBeGreaterThan(0);
    expect(screen.queryByText('钉选题目')).toBe(null);
    expect(screen.queryByRole('switch', { name: '对学生公开' })).toBe(null);
    expect(screen.queryByRole('button', { name: '保存课程节点设置' })).toBe(null);
  });

  it('posts a new node to the course node endpoint', async () => {
    const user = userEvent.setup();
    const calls = await renderEditor();

    await user.click(outlineItem(COURSE_TITLE));
    await user.type(await screen.findByRole('textbox', { name: '子节点名称' }), '循环结构');
    await user.click(screen.getByRole('button', { name: '添加' }));

    await waitFor(() => {
      expect(postWithField(calls, 'operation', 'create')).not.toBe(undefined);
    });
    const posted = postWithField(calls, 'operation', 'create');
    expect(requestPath(posted?.url || '')).toBe(NODES_PATH);
    expect(posted?.init?.method).toBe('POST');
    expect(findField(postedFields(posted?.init), 'operation')).toBe('create');
  });

  it('posts two collected problems as docId strings', async () => {
    const user = userEvent.setup();
    const calls = await renderEditor();

    await revealTopic(user, COURSE_TITLE, '一维数组');
    await user.click(outlineItem('一维数组'));
    const sheet = await openCollectedSheet(user);
    await waitFor(() => {
      const treeCall = calls.find((call) => requestPath(call.url) === '/teach-api/knowledge-tree');
      expect(treeCall).not.toBe(undefined);
      if (!treeCall) throw new Error('knowledge tree was not requested');
      expect(new URL(treeCall.url, 'http://localhost').searchParams.get('type')).toBe('homework');
    });
    await user.click(await within(sheet).findByRole('button', { name: '图论' }));
    await user.click(await within(sheet).findByRole('button', { name: '加入 P0011' }));
    await user.click(await within(sheet).findByRole('button', { name: '加入 P0012' }));
    const close = within(sheet).queryByRole('button', { name: '关闭' });
    if (close) await user.click(close);
    await user.click(screen.getByRole('button', { name: '保存节点' }));

    await waitFor(() => {
      expect(postWithField(calls, 'problemIds', ['11', '12'])).not.toBe(undefined);
    });
    const posted = postWithField(calls, 'problemIds', ['11', '12']);
    expect(requestPath(posted?.url || '')).toBe(NODES_PATH);
    expect(findField(postedFields(posted?.init), 'problemIds')).toEqual(['11', '12']);
  });

  it('resolves mindmap_course_edit.html to the course node editor', () => {
    const data = editorPayload();
    installFetch(data);
    renderShell('mindmap_course_edit.html', data, <PageResolver />);

    expect(screen.queryByRole('heading', { name: PAGE_TITLE })).not.toBe(null);
  });

  it('drops the course_mindmap_edit.html mapping', () => {
    const data = legacyPayload();
    installFetch(data);
    renderShell('course_mindmap_edit.html', data, <PageResolver />);

    expect(screen.queryByText('钉选题目')).toBe(null);
    expect(screen.queryByRole('button', { name: '保存导图' })).toBe(null);
  });
});
