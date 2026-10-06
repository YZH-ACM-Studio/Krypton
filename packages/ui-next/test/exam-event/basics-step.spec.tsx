import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ComponentType } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/components/ui/toast';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import {
  formatDate,
  type ConfirmPlan,
  type ExamEventView,
  type SchoolView,
} from '../../src/pages/exam-event/model.ts';

// A static import fails collection while basics-step.tsx is absent.
const basicsStepLoaders = import.meta.glob('../../src/pages/exam-event/basics-step.tsx');

const packageRoot = resolve(import.meta.dirname, '../..');
const BASICS_STEP_SOURCE = 'src/pages/exam-event/basics-step.tsx';
const EVENT_ID = '66b800000000000000000601';
const EVENT_PATH = `/api/admin/exam-events/${EVENT_ID}`;
const SCHOOL_ID = '66b800000000000000000602';
const OTHER_SCHOOL_ID = '66b800000000000000000603';
const EDITED_START_LOCAL = '2026-09-01T08:15';
const EDITED_END_LOCAL = '2026-09-01T11:45';
const TIMELINE_SEPARATOR = '\u3000·\u3000';

const EVENT: ExamEventView = {
  eventId: EVENT_ID,
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
  updatedAt: '2026-08-10T02:00:00.000Z',
  createdAt: '2026-08-10T01:00:00.000Z',
  createdBy: 2,
  updatedBy: 2,
  archivedAt: null,
  archivedBy: null,
};

const SCHOOLS: SchoolView[] = [{ schoolId: SCHOOL_ID, name: '计算机学院' }];

interface BasicsStepProps {
  event: ExamEventView;
  schools: SchoolView[];
  displayName: (uid: number | null | undefined) => string;
  reload: () => Promise<void>;
  requestConfirm: (plan: ConfirmPlan) => void;
}

interface Posted {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

interface FetchSink {
  posted: Posted[];
  calls: () => number;
}

const displayName = (uid: number | null | undefined): string => (
  uid == null ? '—' : ({ 2: '王老师', 3: '协助教师' } as Record<number, string>)[uid] ?? `UID ${uid}`
);

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function eventFixture(overrides: Partial<ExamEventView> = {}): ExamEventView {
  return { ...EVENT, ...overrides };
}

function bootstrap(data: Record<string, unknown>): KryptonBootstrap {
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
    page: { templateName: 'admin_exam_event.html', data },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({
    error: {
      name: 'ValidationError',
      errorCode: 'event_rejected',
      code: status,
      status,
      params: [],
      message,
    },
  }, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBody(body: BodyInit | null | undefined): Record<string, unknown> | null {
  if (typeof body !== 'string') return null;
  const parsed: unknown = JSON.parse(body);
  if (!isRecord(parsed)) throw new TypeError('request body must be a JSON object');
  return parsed;
}

function contestPayload(contestId: string, title = '关联比赛'): Response {
  return jsonResponse({
    tdoc: {
      docId: contestId,
      title,
      beginAt: EVENT.startAt,
      endAt: EVENT.endAt,
    },
  });
}

function deferredGate(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  return { promise, release };
}

function installFetch(options: {
  eventStatus?: number;
  eventMessage?: string;
  contests?: Record<string, Response>;
} = {}): FetchSink {
  const posted: Posted[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    posted.push({ url, method, body: parseBody(init?.body) });
    if (url.startsWith('/contest/')) return options.contests?.[url] ?? errorResponse('加载比赛失败', 500);
    if (method === 'POST' && url === EVENT_PATH) {
      if (options.eventStatus !== undefined && options.eventStatus >= 400) {
        return errorResponse(options.eventMessage ?? '保存活动信息失败', options.eventStatus);
      }
      return jsonResponse({});
    }
    if (url.includes('/api/users')) return jsonResponse([]);
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return { posted, calls: () => fetchMock.mock.calls.length };
}

function basicsStepLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(basicsStepLoaders)) {
    if (key.endsWith(BASICS_STEP_SOURCE)) return load;
  }
  return undefined;
}

async function loadBasicsStep(): Promise<ComponentType<BasicsStepProps>> {
  const load = basicsStepLoader();
  expect(typeof load, BASICS_STEP_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${BASICS_STEP_SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('basics step module must be an object');
  const value = readField(imported, 'BasicsStep');
  expect(typeof value, 'BasicsStep').toBe('function');
  if (typeof value !== 'function') throw new TypeError('BasicsStep must be a function');
  return value as ComponentType<BasicsStepProps>;
}

async function renderBasics(overrides: Partial<BasicsStepProps> = {}): Promise<{ props: BasicsStepProps; unmount: () => void }> {
  const BasicsStep = await loadBasicsStep();
  const props: BasicsStepProps = {
    event: EVENT,
    schools: SCHOOLS,
    displayName,
    reload: vi.fn<() => Promise<void>>(async () => {}),
    requestConfirm: vi.fn<(plan: ConfirmPlan) => void>(),
    ...overrides,
  };
  const view = render(
    <BootstrapProvider bootstrap={bootstrap({ eventId: props.event.eventId })}>
      <BasicsStep {...props} />
    </BootstrapProvider>,
  );
  return { props, unmount: () => view.unmount() };
}

function panel(): HTMLElement {
  const node = document.querySelector('[data-slot="panel"]');
  if (!(node instanceof HTMLElement)) throw new TypeError('panel missing');
  return node;
}

function actionBar(): HTMLElement {
  const bar = panel().querySelector('footer [data-slot="action-bar"]');
  if (!(bar instanceof HTMLElement)) throw new TypeError('action bar missing');
  return bar;
}

function actionStatus(): HTMLElement {
  const status = actionBar().querySelector('[data-slot="action-bar-status"]');
  if (!(status instanceof HTMLElement)) throw new TypeError('action bar status missing');
  return status;
}

function factGrid(): HTMLElement {
  const grid = document.querySelector('[data-slot="fact-grid"]');
  if (!(grid instanceof HTMLElement)) throw new TypeError('fact grid missing');
  return grid;
}

function factLabels(): string[] {
  return [...factGrid().querySelectorAll('dt')].map((node) => node.textContent ?? '');
}

function factValue(label: string): string {
  const term = [...factGrid().querySelectorAll('dt')].find((node) => node.textContent === label);
  const value = term?.nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new TypeError(`fact ${label} missing`);
  return value.textContent ?? '';
}

function timelineLine(pattern: RegExp): HTMLElement {
  const line = screen.getByText(pattern).closest('.text-xs');
  if (!(line instanceof HTMLElement)) throw new TypeError('timeline missing');
  return line;
}

function eventPosts(posted: Posted[]): Posted[] {
  return posted.filter((item) => item.method === 'POST' && item.url === EVENT_PATH);
}

function capturePlan(requestConfirm: BasicsStepProps['requestConfirm']): ConfirmPlan {
  const recorded = vi.mocked(requestConfirm).mock.calls[0]?.[0];
  if (!recorded) throw new TypeError('requestConfirm was not called');
  return recorded;
}

function createdStamp(): string {
  if (EVENT.createdAt == null) throw new TypeError('fixture createdAt');
  return formatDate(EVENT.createdAt);
}

function commandOutput(result: ReturnType<typeof spawnSync>): string {
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  return `${stdout}\n${stderr}`;
}

function expectDesignGateClean(): void {
  const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', BASICS_STEP_SOURCE], {
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
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, BASICS_STEP_SOURCE], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  expect(result.status, commandOutput(result)).toBe(0);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('exam event basics step', () => {
  it('已计划活动显示学校、外部考试、负责人和主按钮编辑', async () => {
    await renderBasics();
    const grid = factGrid();
    const collaborator = within(grid).getByText('协助教师');
    const timeline = timelineLine(/创建于/);

    expect(screen.getByRole('heading', { name: '基本信息' })).toBeInTheDocument();
    expect(screen.getByText('活动时间窗和类型是后续策略执行的边界。')).toBeInTheDocument();
    expect(grid.className).toContain('lg:grid-cols-3');
    expect(factLabels()).toEqual(['学校', '类型', '关联比赛', '状态', '开始', '硬截止', '负责人', '协作者']);
    expect(within(grid).getByText('计算机学院')).toBeInTheDocument();
    expect(within(grid).getByText('外部考试')).toBeInTheDocument();
    expect(within(grid).getByText('纯外部考试')).toBeInTheDocument();
    expect(within(grid).getByText('待开始')).toBeInTheDocument();
    expect(within(grid).getByText(formatDate(EVENT.startAt))).toBeInTheDocument();
    expect(within(grid).getByText(formatDate(EVENT.endAt))).toBeInTheDocument();
    expect(within(grid).getByText('王老师')).toBeInTheDocument();
    expect(collaborator.closest('[data-slot="badge"]')).toHaveAttribute('data-tone', 'neutral');
    expect(collaborator.parentElement?.className.split(/\s+/)).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'gap-1.5']));
    expect(timeline.className).toContain('text-fg-subtle');
    expect(timeline.textContent).toBe(
      `创建于 ${createdStamp()} · 王老师${TIMELINE_SEPARATOR}最近更新 ${formatDate(EVENT.updatedAt)} · 王老师`,
    );
    expect(timeline.textContent).not.toContain('归档于');
    const tech = document.querySelector('[data-slot="tech-details"]');
    if (!(tech instanceof HTMLElement)) throw new TypeError('tech details missing');
    expect(tech.querySelector('summary')?.textContent).toBe('技术细节');
    expect(tech).not.toHaveAttribute('open');
    expect(within(tech).getByText(EVENT_ID)).toBeInTheDocument();
    expect(within(tech).getByText('2')).toBeInTheDocument();
    expect(within(tech).queryByText('Contest ID')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(actionBar()).toHaveAttribute('data-tone', 'success');
    expect(actionStatus().textContent).toBe('已计划');
    expect(actionStatus().className).toContain('text-success-fg');
    const edit = within(actionBar()).getByRole('button', { name: '编辑' });
    expect(edit.className).toContain('bg-brand');
    expect(edit).toHaveAttribute('data-variant', 'primary');
    expect(within(actionBar()).getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '归档' })).toBeNull();
    expect(screen.queryByRole('button', { name: '计划活动' })).toBeNull();
  });

  it('找不到学校、没有协作者、未知用户和空创建时间按规格留白', async () => {
    const first = await renderBasics({
      schools: [{ schoolId: '66b800000000000000000699', name: '别的学院' }],
      event: eventFixture({ collaboratorUids: [] }),
    });
    expect(within(factGrid()).getByText('学校不可用')).toBeInTheDocument();
    expect(screen.queryByText('别的学院')).toBeNull();
    expect(within(factGrid()).getByText('无')).toBeInTheDocument();
    expect(factGrid().querySelector('[data-slot="badge"]')).toBeNull();
    first.unmount();

    const archivedAt = '2026-08-12T00:00:00.000Z';
    await renderBasics({
      event: eventFixture({
        collaboratorUids: [9],
        createdAt: null,
        createdBy: null,
        archivedAt,
        archivedBy: 3,
        lifecycle: 'archived',
        status: 'archived',
      }),
    });
    expect(within(factGrid()).getByText('UID 9')).toBeInTheDocument();
    expect(screen.queryByText(/创建于/)).toBeNull();
    expect(timelineLine(/最近更新/).textContent).toBe(
      `最近更新 ${formatDate(EVENT.updatedAt)} · 王老师${TIMELINE_SEPARATOR}归档于 ${formatDate(archivedAt)} · 协助教师`,
    );
  });

  it('草稿显示计划活动，确认后按当前版本计划并提示', async () => {
    const sink = installFetch();
    const sequence: string[] = [];
    const reload = vi.fn<() => Promise<void>>(async () => {
      sequence.push('reload');
    });
    const success = vi.spyOn(toast, 'success').mockImplementation(() => {
      sequence.push('toast');
      return 'toast-id';
    });
    const { props } = await renderBasics({
      event: eventFixture({ lifecycle: 'draft', status: 'draft' }),
      reload,
    });
    const edit = within(actionBar()).getByRole('button', { name: '编辑' });
    const planButton = within(actionBar()).getByRole('button', { name: '计划活动' });

    expect(actionBar()).toHaveAttribute('data-tone', 'warning');
    expect(actionStatus().textContent).toBe('草稿 · 尚未计划');
    expect(actionStatus().className).toContain('text-warning-fg');
    expect(edit).toHaveAttribute('data-variant', 'secondary');
    expect(edit.className).not.toContain('bg-brand');
    expect(planButton.className).toContain('bg-brand');
    expect(planButton).toHaveAttribute('data-variant', 'primary');
    expect(within(actionBar()).getAllByRole('button')).toHaveLength(2);

    await userEvent.setup().click(planButton);
    const plan = capturePlan(props.requestConfirm);
    expect(plan.title).toBe('计划此考试活动？');
    expect(plan.description).toBe('计划后时间窗和关键关联会受到生命周期限制。服务端会重新校验 Contest 与权限。');
    expect(plan.confirmLabel).toBe('确认计划');
    expect(plan.facts.map((fact) => fact.label)).toEqual(['活动版本', '考试时段', 'Contest']);
    expect(plan.facts[0]?.value).toBe('2 → 3');
    expect(plan.facts[1]?.value).toBe(`${formatDate(EVENT.startAt)} → ${formatDate(EVENT.endAt)}`);
    expect(plan.facts[2]?.value).toBe('纯外部考试');
    expect(plan.details).toBeUndefined();
    expect(eventPosts(sink.posted)).toEqual([]);
    expect(success).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    await plan.run();
    expect(eventPosts(sink.posted)).toEqual([
      { url: EVENT_PATH, method: 'POST', body: { action: 'schedule', expectedRevision: 2 } },
    ]);
    expect(success).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith('活动已计划');
    expect(sequence).toEqual(['reload', 'toast']);
  });

  it('计划请求失败时抛出错误且不刷新', async () => {
    installFetch({ eventStatus: 500, eventMessage: '计划考试失败' });
    const reload = vi.fn<() => Promise<void>>(async () => {});
    const success = vi.spyOn(toast, 'success').mockImplementation(() => 'toast-id');
    const { props } = await renderBasics({
      event: eventFixture({ lifecycle: 'draft', status: 'draft' }),
      reload,
    });
    await userEvent.setup().click(screen.getByRole('button', { name: '计划活动' }));
    const plan = capturePlan(props.requestConfirm);

    await expect(plan.run()).rejects.toThrow('计划考试失败');
    expect(reload).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  });

  it('归档活动只显示只读归档，操作栏没有按钮', async () => {
    await renderBasics({
      event: eventFixture({ lifecycle: 'archived', status: 'archived' }),
    });

    expect(actionStatus().textContent).toBe('只读归档');
    expect(within(actionBar()).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull();
    expect(screen.queryByRole('button', { name: '归档' })).toBeNull();
    expect(screen.queryByRole('button', { name: '计划活动' })).toBeNull();
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
  });

  it('编辑名称后保存当前版本，刷新并回到只读', async () => {
    const sink = installFetch();
    const sequence: string[] = [];
    const reload = vi.fn<() => Promise<void>>(async () => {
      sequence.push('reload');
    });
    const success = vi.spyOn(toast, 'success').mockImplementation(() => {
      sequence.push('toast');
      return 'toast-id';
    });
    const user = userEvent.setup();
    await renderBasics({ reload });

    await user.click(screen.getByRole('button', { name: '编辑' }));
    const title = screen.getByLabelText(/^活动名称/);
    expect(title).toHaveFocus();
    expect(title).toHaveAttribute('id', 'edit-exam-title');
    expect(title).toHaveAttribute('name', 'title');
    expect(title).toBeRequired();
    expect(screen.getByLabelText(/^学校/)).toHaveAttribute('id', 'edit-exam-school');
    expect(document.querySelector('input[name="schoolId"]')).not.toBeNull();
    expect(screen.getByLabelText(/^考试类型/)).toHaveAttribute('id', 'edit-exam-type');
    expect(screen.getByLabelText(/^开始时间/)).toHaveAttribute('id', 'edit-exam-start');
    expect(screen.getByLabelText(/^开始时间/)).toHaveAttribute('name', 'startAt');
    expect(screen.getByLabelText(/^开始时间/)).toBeRequired();
    expect(screen.getByLabelText(/^硬截止时间/)).toHaveAttribute('id', 'edit-exam-end');
    expect(screen.getByLabelText(/^硬截止时间/)).toHaveAttribute('name', 'endAt');
    expect(screen.getByLabelText(/^硬截止时间/)).toBeRequired();
    expect(screen.queryByText('考试已经开始或结束；仅活动名称和协作者仍可维护。')).toBeNull();
    expect(factGrid).toThrow(TypeError);
    expect(actionBar().querySelector('[data-slot="action-bar-status"]')).toBeNull();
    const cancel = within(actionBar()).getByRole('button', { name: '取消' });
    const save = within(actionBar()).getByRole('button', { name: '保存' });
    expect(cancel).toHaveAttribute('data-variant', 'secondary');
    expect(save).toHaveAttribute('data-variant', 'primary');
    expect(save).toHaveAttribute('type', 'submit');

    await user.clear(title);
    await user.type(title, '校赛网络保障（更新）');
    await user.click(save);

    await waitFor(() => expect(eventPosts(sink.posted)).toHaveLength(1));
    expect(eventPosts(sink.posted)[0]?.body).toEqual({
      action: 'update',
      expectedRevision: 2,
      title: '校赛网络保障（更新）',
      collaboratorUids: [3],
      schoolId: SCHOOL_ID,
      type: 'external',
      contestId: null,
      startAt: EVENT.startAt,
      endAt: EVENT.endAt,
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith('基本信息已保存');
    expect(sequence).toEqual(['reload', 'toast']);
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^活动名称/)).toBeNull();
  });

  it('可编辑时保存的时间和学校来自表单而不是活动快照', async () => {
    const sink = installFetch();
    const user = userEvent.setup();
    await renderBasics({
      schools: [
        { schoolId: SCHOOL_ID, name: '计算机学院' },
        { schoolId: OTHER_SCHOOL_ID, name: '航空工程学院' },
      ],
    });

    await user.click(screen.getByRole('button', { name: '编辑' }));
    await user.click(screen.getByLabelText(/^学校/));
    await user.click(await screen.findByRole('option', { name: '航空工程学院' }));
    fireEvent.change(screen.getByLabelText(/^开始时间/), { target: { value: EDITED_START_LOCAL } });
    fireEvent.change(screen.getByLabelText(/^硬截止时间/), { target: { value: EDITED_END_LOCAL } });
    expect(screen.getByLabelText(/^开始时间/)).toHaveValue(EDITED_START_LOCAL);
    expect(screen.getByLabelText(/^硬截止时间/)).toHaveValue(EDITED_END_LOCAL);
    const schoolInput = document.querySelector('input[name="schoolId"]');
    if (!(schoolInput instanceof HTMLInputElement)) throw new TypeError('school input missing');
    expect(schoolInput.value).toBe(OTHER_SCHOOL_ID);
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(eventPosts(sink.posted)).toHaveLength(1));
    const startAt = new Date(EDITED_START_LOCAL).toISOString();
    const endAt = new Date(EDITED_END_LOCAL).toISOString();
    expect(startAt).not.toBe(EVENT.startAt);
    expect(endAt).not.toBe(EVENT.endAt);
    expect(eventPosts(sink.posted)[0]?.body).toEqual({
      action: 'update',
      expectedRevision: 2,
      title: EVENT.title,
      collaboratorUids: [3],
      schoolId: OTHER_SCHOOL_ID,
      type: 'external',
      contestId: null,
      startAt,
      endAt,
    });
  });

  it('保存失败时留在表单并显示错误', async () => {
    installFetch({ eventStatus: 500, eventMessage: '活动名称无法保存' });
    const reload = vi.fn<() => Promise<void>>(async () => {});
    const user = userEvent.setup();
    await renderBasics({ reload });
    await user.click(screen.getByRole('button', { name: '编辑' }));
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('活动名称无法保存');
    expect(screen.getByLabelText(/^活动名称/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('取消编辑回到只读且不提交', async () => {
    const sink = installFetch();
    const user = userEvent.setup();
    await renderBasics();
    await user.click(screen.getByRole('button', { name: '编辑' }));
    expect(screen.getByLabelText(/^活动名称/)).toBeInTheDocument();
    const callsBeforeCancel = sink.calls();

    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.queryByLabelText(/^活动名称/)).toBeNull();
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();
    expect(within(factGrid()).getByText('纯外部考试')).toBeInTheDocument();
    await waitFor(() => expect(sink.calls()).toBe(callsBeforeCancel));
    expect(eventPosts(sink.posted)).toEqual([]);
  });

  it('保存失败后取消会清掉错误并回到只读', async () => {
    const sink = installFetch({ eventStatus: 500, eventMessage: '活动名称无法保存' });
    const user = userEvent.setup();
    await renderBasics();
    await user.click(screen.getByRole('button', { name: '编辑' }));
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const posts = eventPosts(sink.posted).length;

    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByLabelText(/^活动名称/)).toBeNull();
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();
    expect(eventPosts(sink.posted)).toHaveLength(posts);
  });

  it('考试进行中只能改名称和协作者', async () => {
    const sink = installFetch();
    const user = userEvent.setup();
    await renderBasics({ event: eventFixture({ status: 'active' }) });

    expect(actionBar()).toHaveAttribute('data-tone', 'neutral');
    expect(actionStatus().textContent).toBe('考试已开始或结束，只能修改名称和协作者');
    const edit = within(actionBar()).getByRole('button', { name: '编辑' });
    expect(edit.className).toContain('bg-brand');
    expect(edit).toHaveAttribute('data-variant', 'primary');
    expect(screen.queryByRole('button', { name: '计划活动' })).toBeNull();

    await user.click(edit);
    expect(screen.getByText('考试已经开始或结束；仅活动名称和协作者仍可维护。')).toBeInTheDocument();
    expect(screen.getByLabelText(/^活动名称/)).toBeEnabled();
    expect(screen.getByLabelText(/^学校/)).toBeDisabled();
    expect(screen.getByLabelText(/^考试类型/)).toBeDisabled();
    expect(screen.getByLabelText(/^开始时间/)).toBeDisabled();
    expect(screen.getByLabelText(/^硬截止时间/)).toBeDisabled();

    const title = screen.getByLabelText(/^活动名称/);
    await user.clear(title);
    await user.type(title, '校赛网络保障（更新）');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(eventPosts(sink.posted)).toHaveLength(1));
    expect(eventPosts(sink.posted)[0]?.body).toEqual({
      action: 'update',
      expectedRevision: 2,
      title: '校赛网络保障（更新）',
      collaboratorUids: [3],
    });
    expect(eventPosts(sink.posted)[0]?.body).not.toHaveProperty('schoolId');
    expect(eventPosts(sink.posted)[0]?.body).not.toHaveProperty('startAt');
  });

  it('关联比赛加载成功后显示比赛链接', async () => {
    const contestId = '66b800000000000000000777';
    installFetch({ contests: { [`/contest/${contestId}`]: contestPayload(contestId) } });
    const { props } = await renderBasics({
      event: eventFixture({ type: 'krypton', contestId, lifecycle: 'draft', status: 'draft' }),
    });

    const link = await within(factGrid()).findByRole('link', { name: '关联比赛' });
    expect(link).toHaveAttribute('href', `/contest/${contestId}`);
    expect(link.className).toContain('text-brand-fg');
    expect(link.className).toContain('hover:underline');
    const tech = document.querySelector('[data-slot="tech-details"]');
    if (!(tech instanceof HTMLElement)) throw new TypeError('tech details missing');
    expect(within(tech).getByText('Contest ID')).toBeInTheDocument();
    expect(within(tech).getByText(contestId)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: '计划活动' }));
    const plan = capturePlan(props.requestConfirm);
    expect(plan.facts[2]?.value).toBe('关联比赛');
    expect(plan.details).toEqual([{ label: 'Contest ID', value: contestId }]);
  });

  it('关联比赛加载失败时显示比赛标题不可用', async () => {
    const contestId = '66b800000000000000000778';
    installFetch({ contests: { [`/contest/${contestId}`]: errorResponse('加载比赛失败', 500) } });
    await renderBasics({ event: eventFixture({ contestId }) });

    expect(await within(factGrid()).findByText('比赛标题不可用')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '关联比赛' })).toBeNull();
    expect(screen.queryByText('加载比赛…')).toBeNull();
  });

  it('考试已经结束时只能改名称和协作者', async () => {
    const sink = installFetch();
    const user = userEvent.setup();
    await renderBasics({ event: eventFixture({ status: 'ended' }) });

    expect(actionBar()).toHaveAttribute('data-tone', 'neutral');
    expect(actionStatus().textContent).toBe('考试已开始或结束，只能修改名称和协作者');
    expect(screen.queryByRole('button', { name: '计划活动' })).toBeNull();

    await user.click(within(actionBar()).getByRole('button', { name: '编辑' }));
    expect(screen.getByText('考试已经开始或结束；仅活动名称和协作者仍可维护。')).toBeInTheDocument();
    expect(screen.getByLabelText(/^活动名称/)).toBeEnabled();
    expect(screen.getByLabelText(/^学校/)).toBeDisabled();
    expect(screen.getByLabelText(/^考试类型/)).toBeDisabled();
    expect(screen.getByLabelText(/^开始时间/)).toBeDisabled();
    expect(screen.getByLabelText(/^硬截止时间/)).toBeDisabled();

    const title = screen.getByLabelText(/^活动名称/);
    await user.clear(title);
    await user.type(title, '校赛网络保障（更新）');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(eventPosts(sink.posted)).toHaveLength(1));
    expect(eventPosts(sink.posted)[0]?.body).toEqual({
      action: 'update',
      expectedRevision: 2,
      title: '校赛网络保障（更新）',
      collaboratorUids: [3],
    });
    expect(eventPosts(sink.posted)[0]?.body).not.toHaveProperty('schoolId');
    expect(eventPosts(sink.posted)[0]?.body).not.toHaveProperty('startAt');
    expect(eventPosts(sink.posted)[0]?.body).not.toHaveProperty('endAt');
    expect(eventPosts(sink.posted)[0]?.body).not.toHaveProperty('type');
  });

  it('类型格对 Krypton 比赛显示 Krypton 比赛', async () => {
    const contestId = '66b800000000000000000779';
    installFetch({ contests: { [`/contest/${contestId}`]: contestPayload(contestId) } });
    await renderBasics({ event: eventFixture({ type: 'krypton', contestId }) });

    expect(factValue('类型')).toBe('Krypton 比赛');
    expect(factValue('关联比赛')).not.toBe('Krypton 比赛');
  });

  it('保存 Krypton 比赛时提交已选比赛编号', async () => {
    const contestId = '66b80000000000000000077a';
    const sink = installFetch({ contests: { [`/contest/${contestId}`]: contestPayload(contestId) } });
    const user = userEvent.setup();
    await renderBasics({ event: eventFixture({ type: 'krypton', contestId }) });

    await user.click(screen.getByRole('button', { name: '编辑' }));
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(eventPosts(sink.posted)).toHaveLength(1));
    expect(eventPosts(sink.posted)[0]?.body).toMatchObject({
      action: 'update',
      expectedRevision: 2,
      type: 'krypton',
      contestId,
      schoolId: SCHOOL_ID,
      startAt: EVENT.startAt,
      endAt: EVENT.endAt,
    });
  });

  it('改成外部考试会清掉已选比赛，再改回 Krypton 后保存不再带上原比赛', async () => {
    const contestId = '66b80000000000000000077b';
    const sink = installFetch({ contests: { [`/contest/${contestId}`]: contestPayload(contestId) } });
    const user = userEvent.setup();
    await renderBasics({ event: eventFixture({ type: 'krypton', contestId }) });

    await user.click(screen.getByRole('button', { name: '编辑' }));
    await user.click(screen.getByLabelText(/^考试类型/));
    await user.click(await screen.findByRole('option', { name: '外部考试' }));
    expect(screen.queryByRole('group', { name: 'Krypton 比赛' })).toBeNull();

    await user.click(screen.getByLabelText(/^考试类型/));
    await user.click(await screen.findByRole('option', { name: 'Krypton 比赛' }));
    expect(screen.getByRole('group', { name: 'Krypton 比赛' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(eventPosts(sink.posted)).toHaveLength(1));
    expect(eventPosts(sink.posted)[0]?.body).toMatchObject({
      action: 'update',
      type: 'krypton',
      contestId: null,
    });
  });

  it('保存成功要等刷新完成才提示并回到只读', async () => {
    installFetch();
    let finishReload = (): void => {};
    const reload = vi.fn(() => new Promise<void>((done) => {
      finishReload = done;
    }));
    const success = vi.spyOn(toast, 'success').mockImplementation(() => 'toast-id');
    const user = userEvent.setup();
    await renderBasics({ reload });

    await user.click(screen.getByRole('button', { name: '编辑' }));
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(success).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^活动名称/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull();

    finishReload();

    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    expect(success).toHaveBeenCalledWith('基本信息已保存');
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^活动名称/)).toBeNull();
  });

  it('创建时间线写出创建人而不是最近更新人', async () => {
    await renderBasics({
      event: eventFixture({ createdBy: 3, updatedBy: 2 }),
    });

    expect(timelineLine(/创建于/).textContent).toBe(
      `创建于 ${createdStamp()} · 协助教师${TIMELINE_SEPARATOR}最近更新 ${formatDate(EVENT.updatedAt)} · 王老师`,
    );
  });

  it('比赛切换后晚返回的旧标题不能盖住新比赛', async () => {
    const contestA = '66b8000000000000000007a1';
    const contestB = '66b8000000000000000007a2';
    const stale = deferredGate();
    let staleFinished = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/contest/${contestA}`) {
        await stale.promise;
        staleFinished = true;
        return contestPayload(contestA, '旧比赛');
      }
      if (url === `/contest/${contestB}`) return contestPayload(contestB, '新比赛');
      if (url.includes('/api/users')) return jsonResponse([]);
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);
    const BasicsStep = await loadBasicsStep();
    let contestId = contestA;
    const requestConfirm = vi.fn<(plan: ConfirmPlan) => void>();
    const viewFor = () => (
      <BootstrapProvider bootstrap={bootstrap({ eventId: EVENT_ID })}>
        <BasicsStep
          event={eventFixture({ type: 'krypton', contestId })}
          schools={SCHOOLS}
          displayName={displayName}
          reload={async () => {}}
          requestConfirm={requestConfirm}
        />
      </BootstrapProvider>
    );
    const view = render(viewFor());
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]) === `/contest/${contestA}`)).toBe(true);
    });

    contestId = contestB;
    view.rerender(viewFor());
    expect(await within(factGrid()).findByRole('link', { name: '新比赛' })).toHaveAttribute('href', `/contest/${contestB}`);

    await act(async () => {
      stale.release();
      await new Promise((resolveWait) => {
        setTimeout(resolveWait, 50);
      });
    });

    expect(staleFinished).toBe(true);
    expect(within(factGrid()).queryByRole('link', { name: '旧比赛' })).toBeNull();
    expect(within(factGrid()).getByRole('link', { name: '新比赛' })).toHaveAttribute('href', `/contest/${contestB}`);
  });

  it('取消后再打开编辑会恢复原来的比赛', async () => {
    const contestId = '66b8000000000000000007a3';
    const sink = installFetch({ contests: { [`/contest/${contestId}`]: contestPayload(contestId) } });
    const user = userEvent.setup();
    await renderBasics({ event: eventFixture({ type: 'krypton', contestId }) });

    await user.click(screen.getByRole('button', { name: '编辑' }));
    await user.click(screen.getByLabelText(/^考试类型/));
    await user.click(await screen.findByRole('option', { name: '外部考试' }));
    expect(screen.queryByRole('group', { name: 'Krypton 比赛' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(screen.getByRole('button', { name: '编辑' }));
    expect(screen.getByRole('group', { name: 'Krypton 比赛' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(eventPosts(sink.posted)).toHaveLength(1));
    expect(eventPosts(sink.posted)[0]?.body).toMatchObject({
      action: 'update',
      type: 'krypton',
      contestId,
    });
  });

  it('打开编辑后协作者芯片显示搜索到的姓名', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/users')) return jsonResponse([{ _id: 3, uname: 'helper', displayName: '协助教师' }]);
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    await renderBasics();

    await user.click(screen.getByRole('button', { name: '编辑' }));
    const collaborators = screen.getByRole('group', { name: '协作者' });
    expect(await within(collaborators).findByText('协助教师')).toBeInTheDocument();
    expect(within(collaborators).queryByText('协作者（名称不可用）')).toBeNull();
  });

  it('只含空白的比赛编号按未关联比赛提交', async () => {
    const sink = installFetch();
    const user = userEvent.setup();
    await renderBasics({ event: eventFixture({ type: 'krypton', contestId: '   ' }) });

    await user.click(screen.getByRole('button', { name: '编辑' }));
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(eventPosts(sink.posted)).toHaveLength(1));
    expect(eventPosts(sink.posted)[0]?.body).toMatchObject({
      action: 'update',
      type: 'krypton',
      contestId: null,
    });
  });

  it('考试进行中不能移除已关联的比赛', async () => {
    const contestId = '66b8000000000000000007a4';
    installFetch({ contests: { [`/contest/${contestId}`]: contestPayload(contestId) } });
    const user = userEvent.setup();
    await renderBasics({
      event: eventFixture({ type: 'krypton', contestId, status: 'active' }),
    });

    await user.click(screen.getByRole('button', { name: '编辑' }));
    const contest = screen.getByRole('group', { name: 'Krypton 比赛' });
    expect(contest).toHaveAttribute('aria-disabled', 'true');
    expect(within(contest).getByRole('button', { name: '移除' })).toBeDisabled();
  });

  it('门禁零违规，按钮显式 variant', () => {
    expect(existsSync(resolve(packageRoot, BASICS_STEP_SOURCE)), BASICS_STEP_SOURCE).toBe(true);
    expectDesignGateClean();
    expectExplicitVariants();
  });
});
