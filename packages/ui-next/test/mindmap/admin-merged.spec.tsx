import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { AdminMindmapPage } from '../../src/pages/mindmap/admin.tsx';

const VERSION = '2026-10-16T00:00:00.000Z';
const PUBLIC_DESCRIPTION = '出现在公开导图页';
const HIDDEN_DESCRIPTION = '只有管理员和负责教师能在导图页看到；老师组卷时仍能用';
const TEACHER_HINT = '负责教师可以编辑这门课下面的知识点，不能改课程节点本身';
const COLLECTED_HINT = '收录题：把不是挂在这个知识点上的题也算进来';
const SAVE_LABEL = '保存课程节点设置';
const PUBLIC_SWITCH = '对学生公开';

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
    page: { templateName: 'admin_mindmap.html', data },
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
    mapId: 'map-merged',
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

function pageData(): Record<string, unknown> {
  const config = {
    _id: 'map-merged',
    title: '知识图谱',
    rootNodeId: 'root',
    visibility: 'public',
    layoutDirection: 'RIGHT',
    createdAt: VERSION,
    updatedAt: VERSION,
  };
  return {
    nodes: [
      node('root', null, 0, '知识图谱'),
      node('course-programming', 'root', 1, '程序设计基础(I)', {
        courseVisibility: 'public',
        ownerUids: [3, 7],
      }),
      node('course-safety', 'root', 2, '实验室安全与防护', {
        courseVisibility: 'hidden',
        ownerUids: [],
      }),
      node('node-array', 'course-programming', 1, '一维数组'),
    ],
    config,
    maps: [config],
    referenceCounts: {},
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

function savedRootSnapshot(data: Record<string, unknown>): Record<string, unknown> {
  const nodes = data.nodes;
  if (!Array.isArray(nodes)) return data;
  return {
    ...data,
    nodes: nodes.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      const record = item as Record<string, unknown>;
      if (record._id !== 'root') return record;
      return { ...record, topic: '知识图谱', updatedAt: '2026-10-16T00:00:01.000Z' };
    }),
  };
}

function installFetch(data: Record<string, unknown>, nodesSaveResponse?: Record<string, unknown>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    if (url.includes('/api/users')) {
      return Promise.resolve(jsonResponse([
        { _id: 3, uname: 'teacher', displayName: '张老师' },
        { _id: 7, uname: 'li', displayName: '李老师' },
      ]));
    }
    if (url.includes('/api/mindmap/admin/problems')) {
      return Promise.resolve(jsonResponse({
        problems: [{ docId: 12, pid: 'P1001', title: '数组题', domainId: 'system', hidden: false }],
      }));
    }
    if (url.includes('node-problems') || url.includes('/problems')) {
      return Promise.resolve(jsonResponse({ problems: [] }));
    }
    if (nodesSaveResponse && init?.method === 'POST' && url.includes('/admin/mindmap/nodes')) {
      return Promise.resolve(jsonResponse(nodesSaveResponse));
    }
    return Promise.resolve(jsonResponse(data));
  }));
  return calls;
}

function renderPage(data: Record<string, unknown> = pageData(), nodesSaveResponse?: Record<string, unknown>): RecordedCall[] {
  const calls = installFetch(data, nodesSaveResponse);
  render(
    <BootstrapProvider bootstrap={makeBootstrap(data)}>
      <AdminMindmapPage />
    </BootstrapProvider>,
  );
  return calls;
}

function outlineItem(topic: string): HTMLElement {
  const found = screen.getAllByRole('treeitem').find((item) => item.textContent?.includes(topic));
  if (!found) throw new Error(`outline is missing ${topic}`);
  return found;
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
  for (const child of Object.values(record)) {
    const found = findField(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function numericIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids: number[] = [];
  for (const item of value) {
    if (typeof item === 'number' && Number.isFinite(item)) ids.push(item);
  }
  return ids;
}

function checkedSwitch(name: string): HTMLInputElement {
  const toggle = screen.getByRole('switch', { name });
  if (!(toggle instanceof HTMLInputElement)) throw new Error(`${name} is not an input`);
  return toggle;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('admin mindmap page on the merged tree', () => {
  it('does not offer creating a map', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /新建导图/ })).to.equal(null);
    expect(screen.queryByRole('combobox', { name: '切换知识导图' })).to.equal(null);
  });

  it('does not offer setting a map as the default', async () => {
    const user = userEvent.setup();
    renderPage();
    const settings = screen.queryByText('导图设置');
    if (settings) await user.click(settings);
    expect(screen.queryByText(/设为默认/)).to.equal(null);
    expect(screen.queryByRole('switch', { name: '作为公开页默认导图' })).to.equal(null);
  });

  it('shows course-node settings only for a course node', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(outlineItem('知识图谱').textContent).to.include('知识图谱');
    expect(outlineItem('程序设计基础(I)').textContent).to.include('程序设计基础(I)');
    expect(outlineItem('实验室安全与防护').textContent).to.include('实验室安全与防护');
    expect(screen.queryByRole('switch', { name: PUBLIC_SWITCH })).to.equal(null);

    await user.click(outlineItem('程序设计基础(I)'));
    const publicToggle = checkedSwitch(PUBLIC_SWITCH);
    expect(publicToggle.checked).to.equal(true);
    expect(screen.getByText(PUBLIC_DESCRIPTION)).not.to.equal(null);
    expect(screen.getByText('负责教师')).not.to.equal(null);
    expect(screen.getByText(TEACHER_HINT)).not.to.equal(null);
    expect(screen.getByText('课程节点')).not.to.equal(null);
    const save = screen.getByRole('button', { name: SAVE_LABEL });
    expect(save.getAttribute('data-variant')).to.equal('secondary');
    expect(save.getAttribute('data-size')).to.equal('sm');

    await user.click(publicToggle);
    expect(publicToggle.checked).to.equal(false);
    expect(screen.getByText(HIDDEN_DESCRIPTION)).not.to.equal(null);
    expect(screen.queryByText(PUBLIC_DESCRIPTION)).to.equal(null);

    await user.click(outlineItem('实验室安全与防护'));
    const hiddenToggle = checkedSwitch(PUBLIC_SWITCH);
    expect(hiddenToggle.checked).to.equal(false);
    expect(screen.getByText(HIDDEN_DESCRIPTION)).not.to.equal(null);
    expect(screen.getByText(TEACHER_HINT)).not.to.equal(null);

    await user.click(within(outlineItem('程序设计基础(I)')).getByRole('button', { name: '展开节点' }));
    await user.click(outlineItem('一维数组'));
    expect(screen.getByRole('heading', { name: '一维数组' })).not.to.equal(null);
    expect(screen.queryByRole('switch', { name: PUBLIC_SWITCH })).to.equal(null);
    expect(screen.queryByText('负责教师')).to.equal(null);
    expect(screen.queryByText(TEACHER_HINT)).to.equal(null);
    expect(screen.queryByRole('button', { name: SAVE_LABEL })).to.equal(null);
  });

  it('posts visibility and owner uids when saving course-node settings', async () => {
    const user = userEvent.setup();
    const calls = renderPage();
    await user.click(outlineItem('程序设计基础(I)'));
    await user.click(checkedSwitch(PUBLIC_SWITCH));
    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    await waitFor(() => {
      const posted = calls.find((call) => requestPath(call.url) === '/admin/mindmap/course-nodes');
      expect(posted).not.to.equal(undefined);
    });
    const posted = calls.find((call) => requestPath(call.url) === '/admin/mindmap/course-nodes');
    expect(posted?.init?.method).to.equal('POST');
    const fields = postedFields(posted?.init);
    expect(findField(fields, 'operation')).to.equal('settings');
    expect(findField(fields, 'visibility')).to.equal('hidden');
    expect(numericIds(findField(fields, 'ownerUids')).slice().sort((left, right) => left - right)).to.deep.equal([3, 7]);
  });

  it('saves a collected problem as its docId and shows the title', async () => {
    const user = userEvent.setup();
    const calls = renderPage();
    await user.click(within(outlineItem('程序设计基础(I)')).getByRole('button', { name: '展开节点' }));
    await user.click(outlineItem('一维数组'));
    expect(screen.getByText(COLLECTED_HINT)).not.to.equal(null);
    await user.type(screen.getByPlaceholderText('搜索 PID 或标题'), '数组');
    await user.click(await screen.findByRole('button', { name: /数组题/ }));
    expect(screen.getByText('数组题')).not.to.equal(null);
    await user.click(screen.getByRole('button', { name: '保存节点' }));
    await waitFor(() => {
      const posted = calls.find((call) => requestPath(call.url) === '/admin/mindmap/nodes' && call.init?.method === 'POST');
      expect(posted).not.to.equal(undefined);
    });
    const posted = calls.find((call) => requestPath(call.url) === '/admin/mindmap/nodes' && call.init?.method === 'POST');
    const params = new URLSearchParams(bodyText(posted?.init?.body));
    expect(params.get('operation')).to.equal('update');
    const payload: unknown = JSON.parse(params.get('payload') || '{}');
    const fields = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).fields
      : undefined;
    const problemIds = fields && typeof fields === 'object' && !Array.isArray(fields)
      ? (fields as Record<string, unknown>).problemIds
      : undefined;
    expect(problemIds).to.deep.equal(['12']);
  });

  it('shows the trimmed root name and a synced badge after saving', async () => {
    const user = userEvent.setup();
    const data = pageData();
    renderPage(data, savedRootSnapshot(data));
    const name = screen.getByRole('textbox', { name: '名称' });
    if (!(name instanceof HTMLInputElement)) throw new Error('name is not an input');
    expect(name.value).to.equal('知识图谱');
    await user.type(name, ' ');
    expect(name.value).to.equal('知识图谱 ');
    const save = screen.getByRole('button', { name: '保存节点' });
    if (!(save instanceof HTMLButtonElement)) throw new Error('save node is not a button');
    expect(save.disabled).to.equal(false);
    await user.click(save);
    const inspector = screen.getByRole('complementary', { name: '节点检查器' });
    await waitFor(() => {
      const savedName = within(inspector).getByRole('textbox', { name: '名称' });
      if (!(savedName instanceof HTMLInputElement)) throw new Error('name is not an input');
      expect(savedName.value).to.equal('知识图谱');
      expect(within(inspector).getByText('已同步')).not.to.equal(null);
      expect(within(inspector).queryByText('未保存')).to.equal(null);
    });
  });
});
