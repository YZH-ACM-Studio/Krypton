import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ComponentType } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/components/ui/toast';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';

// A static import fails collection while event-detail.tsx is absent.
const eventDetailLoaders = import.meta.glob('../../src/pages/exam-event/event-detail.tsx');

const packageRoot = resolve(import.meta.dirname, '../..');
const EVENT_DETAIL_SOURCE = 'src/pages/exam-event/event-detail.tsx';
const EVENT_ID = '66b800000000000000000601';
const SCHOOL_ID = '66b800000000000000000602';
const EVENT_PATH = `/api/admin/exam-events/${EVENT_ID}`;
const EVENT_PAGE = `/admin/exam-infrastructure/events/${EVENT_ID}`;
const SEATS_HREF = `${EVENT_PAGE}/seats`;
const DOT = '\u00B7';

// The legacy "loads the detail in workflow order" test never asserts URLs.
// These five are the old EventDetailPage.reload order that fixture accepts.
const WORKFLOW_URLS = [
  EVENT_PATH,
  `/api/admin/exam-policy-templates?eventId=${encodeURIComponent(EVENT_ID)}`,
  `${EVENT_PATH}/target-assignment`,
  `${EVENT_PATH}/network-config`,
  `${EVENT_PATH}/network-execution`,
];

const EVENT: Record<string, unknown> = {
  eventId: EVENT_ID,
  domainId: 'system',
  schoolId: SCHOOL_ID,
  title: '校赛网络保障',
  type: 'external',
  contestId: null,
  lifecycle: 'scheduled',
  status: 'scheduled',
  startAt: '2026-08-20T01:00:00.000Z',
  endAt: '2026-08-20T04:00:00.000Z',
  ownerUid: 2,
  collaboratorUids: [3],
  revision: 2,
  auditRef: 'exam-event:66b800000000000000000601:2',
  createdAt: '2026-08-10T01:00:00.000Z',
  createdBy: 2,
  updatedAt: '2026-08-10T02:00:00.000Z',
  updatedBy: 2,
  archivedAt: null,
  archivedBy: null,
};

const PREPARATION_SUMMARY: Record<string, unknown> = {
  assignment: null,
  publicationRevision: 0,
  batch: null,
};

const USERS = [{ _id: 3, uname: 'helper', displayName: '协助教师' }];

interface Posted {
  url: string;
  body: Record<string, unknown>;
}

interface NamedUser {
  _id: number;
  uname: string;
  displayName: string;
}

interface DetailOptions {
  preparation?: Record<string, unknown>;
  event?: Record<string, unknown>;
  schools?: Array<Record<string, unknown>>;
  omitSchools?: boolean;
  users?: readonly NamedUser[];
  archiveError?: string;
  updatePreviewWarning?: string;
}

interface DetailTraffic {
  calls: string[];
  posts: Posted[];
  unmount: () => void;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({
    error: {
      name: 'ConflictError',
      errorCode: 'revision_conflict',
      code: status,
      status,
      params: [],
      message,
    },
  }), { status, headers: { 'Content-Type': 'application/json' } });
}

function requestedUserIds(init?: RequestInit): number[] {
  if (typeof init?.body !== 'string') return [];
  const parsed: unknown = JSON.parse(init.body);
  if (typeof parsed !== 'object' || parsed === null) return [];
  const args = readField(parsed, 'args');
  if (typeof args !== 'object' || args === null) return [];
  const ids = readField(args, 'ids');
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is number => typeof id === 'number');
}

function requestPath(input: RequestInfo | URL): string {
  let raw = '';
  if (typeof input === 'string') raw = input;
  else if (input instanceof URL) raw = input.href;
  else raw = input.url;
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) return raw;
  const parsed = new URL(raw);
  return `${parsed.pathname}${parsed.search}`;
}

function openEvent(search = '', hash = ''): void {
  let query = '';
  if (search !== '') query = search.startsWith('?') ? search : `?${search}`;
  let fragment = '';
  if (hash !== '') fragment = hash.startsWith('#') ? hash : `#${hash}`;
  window.history.replaceState(null, '', `${EVENT_PAGE}${query}${fragment}`);
}

function bootstrap(): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-08-11T00:00:00.000Z',
    user: { id: 2, name: 'teacher', signedIn: true, priv: 0, canManageExamInfrastructure: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'admin_exam_event.html', data: { eventId: EVENT_ID } },
  };
}

function targetAssignmentPayload(): Record<string, unknown> {
  return {
    assignment: {
      assignmentId: '66b800000000000000000612',
      revision: 1,
      draft: { version: 1, sources: [] },
      revisions: [
        {
          revision: 1,
          sources: [],
          targetFingerprint: 'b'.repeat(64),
          endpointIds: [],
          targetCount: 0,
          publishedAt: '2026-08-11T02:00:00.000Z',
        },
      ],
      latestPublishedRevision: 1,
    },
    classrooms: [],
    boundEndpoints: [],
  };
}

function networkConfigPayload(): Record<string, unknown> {
  return {
    config: {
      revision: 2,
      policy: { id: '66b800000000000000000611', revision: 2, fingerprint: 'a'.repeat(64) },
      target: { id: '66b800000000000000000612', revision: 1, fingerprint: 'b'.repeat(64) },
    },
  };
}

function batchRecord(state: string, ticketCount: number, workflow: Record<string, unknown> | null): Record<string, unknown> {
  return {
    id: '66b800000000000000000622',
    revision: 2,
    projectionRevision: workflow ? 7 : null,
    state,
    ticketCount,
    workflow,
  };
}

function eventDetailLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(eventDetailLoaders)) {
    if (key.endsWith(EVENT_DETAIL_SOURCE)) return load;
  }
  return undefined;
}

async function loadEventDetail(): Promise<ComponentType<{ eventId: string }>> {
  const load = eventDetailLoader();
  expect(typeof load, EVENT_DETAIL_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${EVENT_DETAIL_SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('event detail module must be an object');
  const value = readField(imported, 'EventDetailPage');
  expect(typeof value, 'EventDetailPage').toBe('function');
  if (typeof value !== 'function') throw new TypeError('EventDetailPage must be a function');
  return value as ComponentType<{ eventId: string }>;
}

function installDetailFetch(options: DetailOptions = {}): { calls: string[]; posts: Posted[] } {
  const calls: string[] = [];
  const posts: Posted[] = [];
  const preparation = options.preparation ?? PREPARATION_SUMMARY;
  const event = options.event ?? EVENT;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestPath(input);
    calls.push(url);
    if (init?.method === 'POST' && typeof init.body === 'string') {
      const parsed: unknown = JSON.parse(init.body) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        posts.push({ url, body: parsed as Record<string, unknown> });
      }
    }
    if (url.includes('/api/users')) {
      const ids = requestedUserIds(init);
      const catalog = options.users ?? USERS;
      return json(catalog.filter((user) => ids.includes(user._id)));
    }
    if (url === EVENT_PATH && init?.method === 'POST' && options.archiveError) {
      return errorResponse(options.archiveError, 409);
    }
    if (url === EVENT_PATH) {
      if (options.omitSchools) return json({ event, preparation });
      const schools = options.schools ?? [{ schoolId: SCHOOL_ID, name: '计算机学院' }];
      return json({ event, schools, preparation });
    }
    if (/^\/contest\/[a-f0-9]{24}$/i.test(url)) {
      return json({
        tdoc: {
          docId: url.slice('/contest/'.length),
          title: '关联比赛',
          beginAt: '2026-08-20T01:00:00.000Z',
          endAt: '2026-08-20T04:00:00.000Z',
        },
      });
    }
    if (url.startsWith('/api/admin/exam-policy-templates')) return json({ templates: [] });
    if (url.endsWith('/target-assignment')) return json(targetAssignmentPayload());
    if (url.endsWith('/network-config')) return json(networkConfigPayload());
    if (url.endsWith('/network-execution')) {
      return json({
        execution: null,
        updatePreview: null,
        updatePreviewWarning: options.updatePreviewWarning ?? null,
      });
    }
    throw new Error(`unexpected request: ${url}`);
  }));
  return { calls, posts };
}

async function renderDetail(options: DetailOptions = {}): Promise<DetailTraffic> {
  const traffic = installDetailFetch(options);
  const EventDetailPage = await loadEventDetail();
  const view = render(
    <BootstrapProvider bootstrap={bootstrap()}>
      <EventDetailPage eventId={EVENT_ID} />
    </BootstrapProvider>,
  );
  return { ...traffic, unmount: () => view.unmount() };
}

function preparationPanel(): HTMLElement {
  const heading = screen.getByRole('heading', { name: '考试准备' });
  const panel = heading.closest('[data-slot="panel"]');
  if (!(panel instanceof HTMLElement)) throw new TypeError('考试准备面板缺失');
  return panel;
}

function pageHeader(): HTMLElement {
  const header = document.querySelector('[data-slot="page-header"]');
  if (!(header instanceof HTMLElement)) throw new TypeError('页头缺失');
  return header;
}

function panelAround(heading: HTMLElement): HTMLElement {
  const panel = heading.closest('[data-slot="panel"]');
  if (!(panel instanceof HTMLElement)) throw new TypeError('面板缺失');
  return panel;
}

function ddText(root: HTMLElement, label: string): string {
  const term = within(root).getByText(label, { selector: 'dt' });
  const value = term.nextElementSibling;
  if (!(value instanceof HTMLElement) || value.tagName !== 'DD') throw new TypeError(`缺少「${label}」的值`);
  return value.textContent?.trim() ?? '';
}

function archivePosts(posts: Posted[]): Posted[] {
  return posts.filter((item) => item.body.action === 'archive');
}

async function openRevisions(): Promise<HTMLElement> {
  const summary = screen.getByText('修订号', { selector: 'summary' });
  await userEvent.setup().click(summary);
  const details = summary.closest('details');
  if (!(details instanceof HTMLElement)) throw new TypeError('修订号 details 缺失');
  return details;
}

function commandOutput(result: ReturnType<typeof spawnSync>): string {
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  return `${stdout}\n${stderr}`;
}

function expectDesignGateClean(): void {
  const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', EVENT_DETAIL_SOURCE], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  expect(result.status, commandOutput(result)).toBe(0);
}

function expectExplicitVariants(): void {
  const script = [
    "import { readFileSync } from 'node:fs';",
    "import { scanOpenTags } from './scripts/design-gate.mjs';",
    'const source = readFileSync(process.argv[1], "utf8");',
    'const lines = [];',
    "for (const tag of scanOpenTags(source, 'Button')) {",
    "  if (!tag.text.includes('variant=')) lines.push(String(tag.line));",
    '}',
    'if (lines.length > 0) {',
    "  console.log(lines.map((line) => process.argv[1] + ':' + line + ' 缺少 variant=').join('\\n'));",
    '  process.exit(1);',
    '}',
  ].join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, EVENT_DETAIL_SOURCE], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  expect(result.status, commandOutput(result)).toBe(0);
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('exam event detail shell', () => {
  it('没有面板参数时停在预检与执行', async () => {
    openEvent();
    await renderDetail();

    expect(await screen.findByRole('heading', { name: '预检与执行' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '校赛网络保障' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '基本信息' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '网络策略' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '目标终端' })).not.toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: '考试活动步骤' });
    for (const label of ['基本信息', '网络策略', '目标终端', '预检与执行']) {
      expect(within(nav).getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(within(nav).getByRole('button', { name: '预检与执行' })).toHaveAttribute('aria-current', 'step');
    expect(within(nav).getByRole('button', { name: '基本信息' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: '返回活动列表' })).toHaveAttribute('href', '/admin/exam-infrastructure');
  });

  it('panel=policy 时打开网络策略', async () => {
    openEvent('?panel=policy');
    await renderDetail();

    expect(await screen.findByRole('heading', { name: '网络策略' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '预检与执行' })).not.toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: '考试活动步骤' });
    expect(within(nav).getByRole('button', { name: '网络策略' })).toHaveAttribute('aria-current', 'step');
  });

  it('锚点或考试座位参数进入目标终端', async () => {
    openEvent('', '#target-assignment');
    const hashed = await renderDetail();

    expect(await screen.findByRole('heading', { name: '目标终端' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '预检与执行' })).not.toBeInTheDocument();
    hashed.unmount();

    openEvent('?examSeatAssignmentId=seat-1');
    await renderDetail();
    expect(await screen.findByRole('heading', { name: '目标终端' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '网络策略' })).not.toBeInTheDocument();
  });

  it('点击目标终端后地址变为 panel=targets', async () => {
    openEvent();
    await renderDetail();
    const nav = await screen.findByRole('navigation', { name: '考试活动步骤' });
    await userEvent.setup().click(within(nav).getByRole('button', { name: '目标终端' }));

    expect(window.location.search).toBe('?panel=targets');
    expect(await screen.findByRole('heading', { name: '目标终端' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '预检与执行' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: '目标终端' })).toHaveAttribute('aria-current', 'step');
  });

  it('从预检与执行点基本信息后，重新进入仍是基本信息', async () => {
    openEvent();
    const first = await renderDetail();
    const nav = await screen.findByRole('navigation', { name: '考试活动步骤' });
    await userEvent.setup().click(within(nav).getByRole('button', { name: '基本信息' }));

    expect(window.location.search).toContain('panel=basics');
    expect(screen.getByRole('heading', { name: '基本信息' })).toBeInTheDocument();
    first.unmount();

    await renderDetail();
    expect(await screen.findByRole('heading', { name: '基本信息' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '预检与执行' })).not.toBeInTheDocument();
  });

  it('考试座位参数下点基本信息，重新进入仍是基本信息', async () => {
    openEvent('?examSeatAssignmentId=seat-1');
    const first = await renderDetail();
    const nav = await screen.findByRole('navigation', { name: '考试活动步骤' });
    expect(screen.getByRole('heading', { name: '目标终端' })).toBeInTheDocument();
    await userEvent.setup().click(within(nav).getByRole('button', { name: '基本信息' }));

    expect(window.location.search).toContain('panel=basics');
    first.unmount();

    await renderDetail();
    expect(await screen.findByRole('heading', { name: '基本信息' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '目标终端' })).not.toBeInTheDocument();
  });

  it('更多菜单可以确认归档并提交当前版本', async () => {
    const success = vi.spyOn(toast, 'success');
    openEvent();
    const { posts } = await renderDetail();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: '预检与执行' });
    await user.click(screen.getByRole('button', { name: '更多' }));
    const menu = await screen.findByRole('menu', { name: '更多' });
    const seats = within(menu).getByRole('menuitem', { name: '打开座位工作台' });
    expect(seats).toHaveAttribute('href', SEATS_HREF);
    expect(seats.getAttribute('href')).toMatch(/\/seats$/);

    await user.click(within(menu).getByRole('menuitem', { name: '归档活动\u2026' }));
    const dialog = await screen.findByRole('dialog', { name: '归档此活动？' });
    expect(dialog).toHaveTextContent('归档是当前唯一移除路径，不会删除历史网络版本或执行事实。');
    expect(within(dialog).getByText('校赛网络保障')).toBeInTheDocument();
    expect(within(dialog).getByText('待开始')).toBeInTheDocument();
    expect(within(dialog).getByText('2 \u2192 3')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '确认归档' }));

    await waitFor(() => {
      expect(archivePosts(posts)).toEqual([
        { url: EVENT_PATH, body: { action: 'archive', expectedRevision: 2 } },
      ]);
    });
    expect(success).toHaveBeenCalledWith('活动已归档');
    expect(screen.queryByRole('dialog', { name: '归档此活动？' })).not.toBeInTheDocument();
    success.mockRestore();
  });

  it('考试准备按批次显示票据或尚未创建', async () => {
    openEvent();
    const empty = await renderDetail();
    expect(await screen.findByRole('heading', { name: '考试准备' })).toBeInTheDocument();
    const emptyPanel = preparationPanel();
    expect(ddText(emptyPanel, '名单 / 座位分配')).toBe('未发布');
    expect(ddText(emptyPanel, '座位发布')).toBe('r0');
    expect(ddText(emptyPanel, '预登录批次')).toBe('尚未创建');
    expect(within(emptyPanel).getByRole('link', { name: '打开座位工作台' })).toHaveAttribute('href', SEATS_HREF);
    empty.unmount();

    openEvent();
    const dispatched = await renderDetail({
      preparation: {
        assignment: null,
        publicationRevision: 1,
        batch: batchRecord('dispatched', 42, null),
      },
    });
    expect(await screen.findByText(`已派发 ${DOT} 42 张票据`)).toBeInTheDocument();
    expect(ddText(preparationPanel(), '预登录批次')).toBe(`已派发 ${DOT} 42 张票据`);
    dispatched.unmount();

    openEvent();
    await renderDetail({
      preparation: {
        assignment: null,
        publicationRevision: 1,
        batch: batchRecord('dispatching', 3, null),
      },
    });
    expect(await screen.findByText(`派发中 ${DOT} 3 张票据`)).toBeInTheDocument();
    expect(ddText(preparationPanel(), '预登录批次')).toBe(`派发中 ${DOT} 3 张票据`);
  });

  it('页头描述包含学校和外部考试', async () => {
    openEvent();
    await renderDetail();
    await screen.findByRole('heading', { name: '校赛网络保障' });
    const header = pageHeader();

    expect(within(header).getByText(new RegExp(`计算机学院 ${DOT} 外部考试`))).toBeInTheDocument();
    expect(within(header).getByText('待开始')).toBeInTheDocument();
  });

  it('学校对不上时页头写学校不可用', async () => {
    openEvent();
    await renderDetail({
      schools: [{ schoolId: '66b800000000000000000699', name: '其他学院' }],
    });
    await screen.findByRole('heading', { name: '校赛网络保障' });

    expect(within(pageHeader()).getByText(new RegExp(`学校不可用 ${DOT} 外部考试`))).toBeInTheDocument();
    expect(screen.queryByText('其他学院')).not.toBeInTheDocument();
  });

  it('首次加载的前五个请求沿用旧详情顺序', async () => {
    openEvent();
    const { calls } = await renderDetail();
    await screen.findByRole('heading', { name: '校赛网络保障' });

    expect(calls.slice(0, 5)).toEqual(WORKFLOW_URLS);
  });

  it('基本信息把已解析的协作者名传给步骤', async () => {
    openEvent('?panel=basics');
    await renderDetail();

    const heading = await screen.findByRole('heading', { name: '基本信息' });
    expect(await screen.findByText('协助教师')).toBeInTheDocument();
    const panel = panelAround(heading);
    expect(ddText(panel, '负责人')).toBe('UID 2');
    expect(ddText(panel, '协作者')).toBe('协助教师');
    expect(screen.queryByText('UID 3')).not.toBeInTheDocument();
  });

  it('修订号展开后列出冻结引用', async () => {
    openEvent();
    await renderDetail({
      preparation: {
        assignment: {
          id: '66b800000000000000000620',
          revision: 5,
          fingerprint: 'c'.repeat(64),
          roster: { id: '66b800000000000000000621', revision: 4, fingerprint: 'd'.repeat(64) },
        },
        publicationRevision: 3,
        batch: {
          id: '66b800000000000000000622',
          revision: 2,
          projectionRevision: 7,
          state: 'dispatched',
          ticketCount: 98,
          workflow: { executionRevision: 9, policyRevision: 6, targetRevision: 8 },
        },
      },
    });
    await screen.findByRole('heading', { name: '考试准备' });
    const panel = preparationPanel();
    expect(ddText(panel, '名单 / 座位分配')).toBe('r4 / r5');
    expect(ddText(panel, '座位发布')).toBe('r3');
    expect(ddText(panel, '预登录批次')).toBe(`已派发 ${DOT} 98 张票据`);

    const details = await openRevisions();
    expect(ddText(details, '名单')).toBe('r4');
    expect(ddText(details, '分配')).toBe('r5');
    expect(ddText(details, '发布')).toBe('r3');
    expect(ddText(details, '策略')).toBe('r2');
    expect(ddText(details, '目标')).toBe('r1');
    expect(ddText(details, '票据批次')).toBe('r2');
    expect(ddText(details, '投影')).toBe('r7');
    expect(ddText(details, '活动版本')).toBe('2');
    expect(ddText(details, '配置版本')).toBe('2');
    expect(ddText(details, '确认执行')).toBe('r9');
    expect(ddText(details, '批次策略')).toBe('r6');
    expect(ddText(details, '批次目标')).toBe('r8');
    expect(within(details).queryByText('P2.9 前历史批次')).not.toBeInTheDocument();
  });

  it('没有 workflow 的批次标成历史批次', async () => {
    openEvent();
    await renderDetail({
      preparation: {
        assignment: null,
        publicationRevision: 0,
        batch: batchRecord('dispatched', 1, null),
      },
    });
    await screen.findByRole('heading', { name: '考试准备' });
    const details = await openRevisions();

    expect(ddText(details, '名单')).toBe('r0');
    expect(ddText(details, '分配')).toBe('r0');
    expect(ddText(details, '发布')).toBe('r0');
    expect(ddText(details, '投影')).toBe('r0');
    expect(ddText(details, '批次')).toBe('P2.9 前历史批次');
    expect(within(details).queryByText('确认执行', { selector: 'dt' })).not.toBeInTheDocument();
    expect(within(details).queryByText('批次策略', { selector: 'dt' })).not.toBeInTheDocument();
    expect(within(details).queryByText('批次目标', { selector: 'dt' })).not.toBeInTheDocument();
  });

  it('座位发布漂移和其它警告沿用旧文案', async () => {
    openEvent();
    const drifted = await renderDetail({
      preparation: {
        assignment: null,
        publicationRevision: 3,
        batch: batchRecord('dispatched', 98, { executionRevision: 9, policyRevision: 6, targetRevision: 8 }),
        warning: 'assignment_publication_reference_drift',
      },
    });
    expect(await screen.findByRole('heading', { name: '校赛网络保障' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('已发布座位分配的引用已变化，座位发布摘要暂不可用，但活动基本信息仍可编辑。');
    expect(screen.queryByText('assignment_publication_reference_drift')).not.toBeInTheDocument();
    expect(screen.queryByText('考试活动不存在或无权访问')).not.toBeInTheDocument();
    drifted.unmount();

    openEvent();
    await renderDetail({
      preparation: {
        ...PREPARATION_SUMMARY,
        warning: 'batch_summary_unavailable',
      },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('预登录批次摘要暂不可用，但活动基本信息仍可编辑。');
    expect(screen.queryByText('batch_summary_unavailable')).not.toBeInTheDocument();
  });

  it('学校列表不是数组时失败且不渲染步骤', async () => {
    openEvent();
    await renderDetail({ omitSchools: true });

    expect(await screen.findByRole('alert')).toHaveTextContent('学校响应格式不正确');
    expect(screen.queryByRole('heading', { name: '预检与执行' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '校赛网络保障' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '考试活动步骤' })).not.toBeInTheDocument();
  });

  it('再次加载先换上新标题，学校缺名称先于坏模板报错', async () => {
    const nextTitle = '改名后的活动';
    let eventReads = 0;
    let templateReads = 0;
    openEvent();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestPath(input);
      if (url.includes('/api/users')) return json(USERS);
      if (init?.method === 'POST' && url === EVENT_PATH) return json({ event: EVENT });
      if (url === EVENT_PATH) {
        eventReads += 1;
        if (eventReads === 1) {
          return json({
            event: EVENT,
            schools: [{ schoolId: SCHOOL_ID, name: '计算机学院' }],
            preparation: PREPARATION_SUMMARY,
          });
        }
        return json({
          event: { ...EVENT, title: nextTitle },
          schools: [{ schoolId: SCHOOL_ID }],
          preparation: PREPARATION_SUMMARY,
        });
      }
      if (url.startsWith('/api/admin/exam-policy-templates')) {
        templateReads += 1;
        if (templateReads === 1) return json({ templates: [] });
        return json({
          templates: [{
            name: '考试策略',
            status: 'active',
            revision: 1,
            collaboratorUids: [],
            draft: {
              version: 1,
              policy: { hosts: [], ips: [], ports: [] },
              fingerprint: 'c'.repeat(64),
            },
            revisions: [],
            latestPublishedRevision: null,
          }],
        });
      }
      if (url.endsWith('/target-assignment')) return json(targetAssignmentPayload());
      if (url.endsWith('/network-config')) return json(networkConfigPayload());
      if (url.endsWith('/network-execution')) return json({ execution: null, updatePreview: null, updatePreviewWarning: null });
      throw new Error(`unexpected request: ${url}`);
    }));
    const EventDetailPage = await loadEventDetail();
    render(
      <BootstrapProvider bootstrap={bootstrap()}>
        <EventDetailPage eventId={EVENT_ID} />
      </BootstrapProvider>,
    );
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: '校赛网络保障' });
    await user.click(screen.getByRole('button', { name: '更多' }));
    await user.click(within(await screen.findByRole('menu', { name: '更多' })).getByRole('menuitem', { name: '归档活动\u2026' }));
    await user.click(within(await screen.findByRole('dialog', { name: '归档此活动？' })).getByRole('button', { name: '确认归档' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('学校响应格式不正确');
    });
    expect(within(pageHeader()).getByRole('heading', { name: nextTitle })).toBeInTheDocument();
    expect(screen.queryByText('策略模板响应格式不正确')).not.toBeInTheDocument();
  });

  it('已归档活动禁用归档并让策略只读', async () => {
    openEvent('?panel=policy');
    await renderDetail({
      event: { ...EVENT, lifecycle: 'archived', status: 'archived' },
    });
    expect(await screen.findByText('活动已归档，策略版本仅供查看。')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '更多' }));
    const archive = within(await screen.findByRole('menu', { name: '更多' })).getByRole('menuitem', { name: '归档活动\u2026' });

    expect(archive).toBeDisabled();
    expect(screen.queryByRole('dialog', { name: '归档此活动？' })).not.toBeInTheDocument();
  });

  it('初次选定后改地址再刷新，仍留在预检与执行', async () => {
    openEvent();
    const { calls, posts } = await renderDetail();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: '预检与执行' });
    window.history.replaceState(null, '', `${EVENT_PAGE}?panel=basics`);
    await user.click(screen.getByRole('button', { name: '更多' }));
    await user.click(within(await screen.findByRole('menu', { name: '更多' })).getByRole('menuitem', { name: '归档活动\u2026' }));
    await user.click(within(await screen.findByRole('dialog', { name: '归档此活动？' })).getByRole('button', { name: '确认归档' }));

    await waitFor(() => {
      expect(archivePosts(posts)).toHaveLength(1);
      expect(calls.filter((url) => url === WORKFLOW_URLS[4]).length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByRole('heading', { name: '预检与执行' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '基本信息' })).not.toBeInTheDocument();
    expect(window.location.search).toBe('?panel=basics');
  });

  it('页头把 Krypton 活动标成 Krypton 比赛', async () => {
    openEvent();
    await renderDetail({ event: { ...EVENT, type: 'krypton' } });
    await screen.findByRole('heading', { name: '校赛网络保障' });

    expect(within(pageHeader()).getByText(new RegExp(`计算机学院 ${DOT} Krypton 比赛`))).toBeInTheDocument();
    expect(within(pageHeader()).queryByText(/外部考试/)).not.toBeInTheDocument();
  });

  it('没有预登录批次时修订号不标历史批次', async () => {
    openEvent();
    await renderDetail();
    await screen.findByRole('heading', { name: '考试准备' });
    const details = await openRevisions();

    expect(within(details).queryByText('P2.9 前历史批次')).not.toBeInTheDocument();
    expect(within(details).queryByText('批次', { selector: 'dt' })).not.toBeInTheDocument();
    expect(ddText(details, '票据批次')).toBe('r0');
  });

  it('基本信息显示已解析的创建人', async () => {
    openEvent('?panel=basics');
    await renderDetail({
      event: { ...EVENT, createdBy: 8 },
      users: [...USERS, { _id: 8, uname: 'maker', displayName: '活动创建人' }],
    });
    const heading = await screen.findByRole('heading', { name: '基本信息' });
    const panel = panelAround(heading);

    expect(await within(panel).findByText(/活动创建人/)).toBeInTheDocument();
    expect(panel).not.toHaveTextContent('UID 8');
  });

  it('归档失败时确认框留下服务端错误', async () => {
    const success = vi.spyOn(toast, 'success');
    openEvent();
    await renderDetail({ archiveError: '活动版本已变化' });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: '预检与执行' });
    await user.click(screen.getByRole('button', { name: '更多' }));
    await user.click(within(await screen.findByRole('menu', { name: '更多' })).getByRole('menuitem', { name: '归档活动\u2026' }));
    await user.click(within(await screen.findByRole('dialog', { name: '归档此活动？' })).getByRole('button', { name: '确认归档' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('活动版本已变化');
    expect(screen.getByRole('dialog', { name: '归档此活动？' })).toBeInTheDocument();
    expect(success).not.toHaveBeenCalled();
    success.mockRestore();
  });

  it('执行步骤显示热更新预览不可用的原因', async () => {
    openEvent();
    await renderDetail({ updatePreviewWarning: 'endpoint_offline' });

    expect(await screen.findByRole('heading', { name: '预检与执行' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('终端离线');
    expect(screen.queryByText('endpoint_offline')).not.toBeInTheDocument();
  });

  it('门禁零违规，按钮显式 variant', () => {
    expect(existsSync(resolve(packageRoot, EVENT_DETAIL_SOURCE)), EVENT_DETAIL_SOURCE).toBe(true);
    expectDesignGateClean();
    expectExplicitVariants();
  });
});
