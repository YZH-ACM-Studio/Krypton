import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ComponentType } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/components/ui/toast';
import { BootstrapProvider, type KryptonBootstrap } from '@/lib/bootstrap.tsx';
import {
  formatDate,
  parseConfig,
  parseTemplate,
  type ConfirmPlan,
  type NetworkConfig,
  type NetworkPolicy,
  type PolicyTemplate,
} from '../../src/pages/exam-event/model.ts';

// A static import fails collection while policy-step.tsx is absent.
const policyStepLoaders = import.meta.glob('../../src/pages/exam-event/policy-step.tsx');

const packageRoot = resolve(import.meta.dirname, '../..');
const POLICY_STEP_SOURCE = 'src/pages/exam-event/policy-step.tsx';
const EVENT_ID = '66b800000000000000000601';
const TEMPLATE_ID = '66b800000000000000000611';
const OTHER_TEMPLATE_ID = '66b800000000000000000699';
const PUBLISH_LABEL = '发布为 v2…';
const ASSIGN_LABEL = '设为本活动策略…';
const ARCHIVE_LABEL = '归档模板…';

interface PolicyStepProps {
  eventId: string;
  templates: PolicyTemplate[];
  suggestedPolicy: NetworkPolicy | null;
  config: NetworkConfig | null;
  readOnly: boolean;
  displayName: (uid: number | null | undefined) => string;
  reload: () => Promise<void>;
  requestConfirm: (plan: ConfirmPlan) => void;
}

interface Posted {
  url: string;
  body: Record<string, unknown>;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function postedBody(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('POST body must be an object');
  }
  const body: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) body[key] = item;
  return body;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function policyTemplateFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    templateId: TEMPLATE_ID,
    name: '考试策略',
    status: 'active',
    revision: 2,
    collaboratorUids: [],
    draft: { version: 2, policy: { hosts: [], ips: [], ports: [] }, fingerprint: 'c'.repeat(64) },
    revisions: [
      {
        revision: 1,
        policy: { hosts: [], ips: [], ports: [443] },
        fingerprint: 'a'.repeat(64),
        publishedAt: '2026-08-11T02:00:00.000Z',
      },
    ],
    latestPublishedRevision: 1,
    ...overrides,
  };
}

function publishedPolicy(): Record<string, unknown> {
  return { hosts: [], ips: [], ports: [443] };
}

function alignedTemplate(): PolicyTemplate {
  return parseTemplate(policyTemplateFixture({
    draft: {
      version: 2,
      policy: publishedPolicy(),
      fingerprint: 'c'.repeat(64),
    },
  }));
}

function configRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    revision: 2,
    policy: { id: TEMPLATE_ID, revision: 2, fingerprint: 'a'.repeat(64) },
    target: { id: '66b800000000000000000612', revision: 1, fingerprint: 'b'.repeat(64) },
    ...overrides,
  };
}

function mustConfig(value: Record<string, unknown>): NetworkConfig {
  const config = parseConfig(value);
  if (!config) throw new TypeError('network config fixture must parse');
  return config;
}

function displayName(uid: number | null | undefined): string {
  if (uid == null) return '—';
  const names: Record<number, string> = { 2: '王老师', 3: '协助教师' };
  return names[uid] ?? `UID ${uid}`;
}

function bootstrap(): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-08-11T00:00:00.000Z',
    user: {
      id: 2,
      name: 'teacher',
      signedIn: true,
      priv: 0,
      canManageExamInfrastructure: true,
    } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'admin_exam_event.html', data: { eventId: EVENT_ID } },
  };
}

function policyStepLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(policyStepLoaders)) {
    if (key.endsWith(POLICY_STEP_SOURCE)) return load;
  }
  return undefined;
}

async function loadPolicyStep(): Promise<ComponentType<PolicyStepProps>> {
  const load = policyStepLoader();
  expect(typeof load, `${POLICY_STEP_SOURCE} 尚不存在`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${POLICY_STEP_SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('policy step module must be an object');
  const value = readField(imported, 'PolicyStep');
  expect(typeof value, 'PolicyStep').toBe('function');
  if (typeof value !== 'function') throw new TypeError('PolicyStep must be a function');
  return value as ComponentType<PolicyStepProps>;
}

function installFetch(): Posted[] {
  const posted: Posted[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      if (typeof init.body !== 'string') throw new TypeError('POST body must be a JSON string');
      posted.push({ url: String(input), body: postedBody(JSON.parse(init.body) as unknown) });
    }
    return json({ template: policyTemplateFixture() });
  }));
  return posted;
}

function brandButtons(): HTMLElement[] {
  return screen.queryAllByRole('button').filter((button) => button.className.includes('bg-brand'));
}

function actionBar(): HTMLElement {
  const bar = document.querySelector('[data-slot="action-bar"]');
  if (!(bar instanceof HTMLElement)) throw new TypeError('action bar missing');
  return bar;
}

function actionStatus(): HTMLElement {
  const status = actionBar().querySelector('[data-slot="action-bar-status"]');
  if (!(status instanceof HTMLElement)) throw new TypeError('action bar status missing');
  return status;
}

async function renderPolicy(overrides: Partial<PolicyStepProps> = {}): Promise<{ posted: Posted[]; props: PolicyStepProps }> {
  const posted = installFetch();
  const PolicyStep = await loadPolicyStep();
  const props: PolicyStepProps = {
    eventId: EVENT_ID,
    templates: [parseTemplate(policyTemplateFixture())],
    suggestedPolicy: null,
    config: mustConfig(configRecord()),
    readOnly: false,
    displayName,
    reload: vi.fn<() => Promise<void>>(async () => {}),
    requestConfirm: vi.fn<(plan: ConfirmPlan) => void>(),
    ...overrides,
  };
  render(
    <BootstrapProvider bootstrap={bootstrap()}>
      <PolicyStep {...props} />
    </BootstrapProvider>,
  );
  const active = props.templates.find((template) => template.status === 'active');
  if (active) await screen.findByDisplayValue(active.name);
  return { posted, props };
}

function capturePlan(requestConfirm: PolicyStepProps['requestConfirm']): ConfirmPlan {
  const recorded = vi.mocked(requestConfirm).mock.calls[0]?.[0];
  if (!recorded) throw new TypeError('requestConfirm was not called');
  return recorded;
}

function commandOutput(result: ReturnType<typeof spawnSync>): string {
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  return `${stdout}\n${stderr}`;
}

function expectDesignGateClean(): void {
  const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', POLICY_STEP_SOURCE], {
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
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, POLICY_STEP_SOURCE], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  expect(result.status, commandOutput(result)).toBe(0);
}

function watchSuccess(reload: PolicyStepProps['reload']): { sequence: string[] } {
  const sequence: string[] = [];
  vi.mocked(reload).mockImplementation(async () => {
    sequence.push('reload');
  });
  vi.spyOn(toast, 'success').mockImplementation(() => {
    sequence.push('toast');
    return 'toast-id';
  });
  return { sequence };
}

async function chooseNewTemplate(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: '策略模板' }));
  await user.click(await screen.findByRole('option', { name: '新建策略' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('exam event policy step', () => {
  it('草稿不同于已发布版本时，唯一主按钮是发布，确认放宽为破坏性', async () => {
    const { props } = await renderPolicy();
    const user = userEvent.setup();
    const publish = screen.getByRole('button', { name: PUBLISH_LABEL });

    expect(actionStatus()).toHaveTextContent('草稿已保存，尚未发布');
    expect(brandButtons()).toHaveLength(1);
    expect(brandButtons()[0]).toBe(publish);
    expect(publish.className).toContain('bg-brand');
    await user.click(publish);
    const plan = capturePlan(props.requestConfirm);

    expect(plan.title).toBe('发布不可变策略版本？');
    expect(plan.tone).toBe('destructive');
  });

  it('草稿与已发布版本相同但活动未使用时，分配确认会写入策略版本', async () => {
    const config = mustConfig(configRecord({
      revision: 4,
      policy: { id: OTHER_TEMPLATE_ID, revision: 1, fingerprint: 'd'.repeat(64) },
    }));
    const reload = vi.fn<() => Promise<void>>(async () => {});
    const requestConfirm = vi.fn<(plan: ConfirmPlan) => void>();
    const { sequence } = watchSuccess(reload);
    const { posted } = await renderPolicy({
      templates: [alignedTemplate()],
      config,
      reload,
      requestConfirm,
    });
    const user = userEvent.setup();

    expect(actionStatus()).toHaveTextContent('v1 已发布，本活动尚未使用');
    await user.click(screen.getByRole('button', { name: ASSIGN_LABEL }));
    const plan = capturePlan(requestConfirm);
    expect(plan.title).toBe('分配此策略版本？');
    await plan.run();

    expect(posted).toEqual([
      {
        url: `/api/admin/exam-events/${EVENT_ID}/network-config`,
        body: {
          eventId: EVENT_ID,
          action: 'assignPolicy',
          expectedRevision: config.revision,
          templateId: TEMPLATE_ID,
          revision: 1,
        },
      },
    ]);
    expect(toast.success).toHaveBeenCalledWith('本活动策略已改为 v1');
    expect(sequence).toEqual(['reload', 'toast']);
  });

  it('活动正在使用与草稿相同的版本时，操作栏没有按钮', async () => {
    await renderPolicy({
      templates: [alignedTemplate()],
      config: mustConfig(configRecord({
        policy: { id: TEMPLATE_ID, revision: 1, fingerprint: 'a'.repeat(64) },
      })),
    });

    expect(actionStatus()).toHaveTextContent('本活动正在使用 v1');
    expect(within(actionBar()).queryAllByRole('button')).toHaveLength(0);
  });

  it('修改允许域名后可以放弃，并恢复原文', async () => {
    await renderPolicy();
    const user = userEvent.setup();
    const hosts = screen.getByLabelText('允许域名');
    await user.type(hosts, 'judge.example.edu');

    expect(actionStatus()).toHaveTextContent('有未保存修改');
    expect(screen.getByRole('button', { name: '放弃修改' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '放弃修改' }));

    expect(hosts).toHaveValue('');
    expect(screen.queryByText('有未保存修改')).not.toBeInTheDocument();
    expect(actionStatus()).toHaveTextContent('草稿已保存，尚未发布');
  });

  it('保存草稿提交新域名，并在刷新后提示', async () => {
    const reload = vi.fn<() => Promise<void>>(async () => {});
    const { sequence } = watchSuccess(reload);
    const { posted } = await renderPolicy({ reload });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('允许域名'), 'judge.example.edu');
    await user.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(posted.some((item) => item.body.action === 'saveDraft')).toBe(true));
    const save = posted.find((item) => item.body.action === 'saveDraft');
    expect(save?.body).toMatchObject({
      action: 'saveDraft',
      expectedRevision: 2,
      policy: { hosts: ['judge.example.edu'] },
    });
    expect(toast.success).toHaveBeenCalledWith('草稿已保存');
    expect(sequence).toEqual(['reload', 'toast']);
  });

  it('新建策略在名称为空时不可创建，填写后发到模板接口', async () => {
    const reload = vi.fn<() => Promise<void>>(async () => {});
    const { sequence } = watchSuccess(reload);
    const { posted } = await renderPolicy({ reload });
    const user = userEvent.setup();
    await chooseNewTemplate(user);

    expect(actionStatus()).toHaveTextContent('新策略尚未创建');
    const name = screen.getByLabelText(/^策略名称/);
    expect(name).toHaveValue('');
    expect(screen.getByRole('button', { name: '创建策略' })).toBeDisabled();
    await user.type(name, '晚间策略');
    expect(screen.getByRole('button', { name: '创建策略' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '创建策略' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      url: `/api/admin/exam-policy-templates?eventId=${encodeURIComponent(EVENT_ID)}`,
      body: { eventId: EVENT_ID, name: '晚间策略' },
    });
    expect(toast.success).toHaveBeenCalledWith('策略模板已创建');
    expect(sequence).toEqual(['reload', 'toast']);
  });

  it('模板操作菜单里的归档项打开归档确认', async () => {
    const { props } = await renderPolicy();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '模板操作' }));
    await user.click(await screen.findByRole('menuitem', { name: ARCHIVE_LABEL }));

    expect(capturePlan(props.requestConfirm).title).toBe('归档此策略模板？');
  });

  it('只读归档不提供主按钮和模板操作', async () => {
    await renderPolicy({ readOnly: true });

    expect(screen.getByText('活动已归档，策略版本仅供查看。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '模板操作' })).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="action-bar-status"]')).toBeNull();
    expect(brandButtons()).toHaveLength(0);
  });

  it('版本历史汇总已发布版本，并可查看未使用版本的规则', async () => {
    await renderPolicy();
    const user = userEvent.setup();
    const summaryText = screen.getByText(/1 个已发布版本/);
    const summary = summaryText.closest('summary');
    if (!(summary instanceof HTMLElement)) throw new TypeError('version history summary missing');

    expect(summary.textContent).toContain('版本历史');
    await user.click(summary);
    expect(screen.getByRole('button', { name: '改用此版本' })).toBeInTheDocument();
    const rules = screen.getByText('查看规则');
    await user.click(rules);
    const ruleDetails = rules.closest('details');
    if (!(ruleDetails instanceof HTMLDetailsElement)) throw new TypeError('rule details missing');
    expect(ruleDetails.open).toBe(true);
    expect(ruleDetails.textContent).toContain('端口：443');
  });

  it('版本历史把较新的已发布版本排在前面', async () => {
    const template = parseTemplate(policyTemplateFixture({
      revisions: [
        {
          revision: 1,
          policy: { hosts: [], ips: [], ports: [80] },
          fingerprint: 'a'.repeat(64),
          publishedAt: '2026-08-11T02:00:00.000Z',
        },
        {
          revision: 2,
          policy: { hosts: [], ips: [], ports: [443] },
          fingerprint: 'b'.repeat(64),
          publishedAt: '2026-08-12T02:00:00.000Z',
        },
      ],
      latestPublishedRevision: 2,
    }));
    await renderPolicy({ templates: [template] });
    const user = userEvent.setup();
    const summaryText = screen.getByText(/2 个已发布版本/);
    const summary = summaryText.closest('summary');
    if (!(summary instanceof HTMLElement)) throw new TypeError('version history summary missing');
    await user.click(summary);
    const history = document.querySelector('[data-slot="revision-history"]');
    if (!(history instanceof HTMLElement)) throw new TypeError('revision history missing');
    const list = history.querySelector('ol');
    if (!(list instanceof HTMLOListElement)) throw new TypeError('revision list missing');
    const titles = [...list.children].map((row) => row.textContent?.trim().slice(0, 2));
    expect(titles).toEqual(['v2', 'v1']);
  });

  it('只读时未使用的历史版本不提供改用此版本', async () => {
    await renderPolicy({ readOnly: true });
    const user = userEvent.setup();
    const summaryText = screen.getByText(/1 个已发布版本/);
    const summary = summaryText.closest('summary');
    if (!(summary instanceof HTMLElement)) throw new TypeError('version history summary missing');
    await user.click(summary);

    expect(screen.queryByRole('button', { name: '改用此版本' })).not.toBeInTheDocument();
  });

  it('保存草稿在刷新完成之后才提示成功', async () => {
    let finishReload = (): void => {};
    const reload = vi.fn<() => Promise<void>>(() => new Promise((done) => {
      finishReload = () => done();
    }));
    const success = vi.spyOn(toast, 'success').mockImplementation(() => 'toast-id');
    await renderPolicy({ reload });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('允许域名'), 'judge.example.edu');
    await user.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(success).not.toHaveBeenCalled();
    finishReload();
    await waitFor(() => expect(success).toHaveBeenCalledWith('草稿已保存'));
  });

  it('发布确认执行后提示下一个已发布版本号', async () => {
    const reload = vi.fn<() => Promise<void>>(async () => {});
    const requestConfirm = vi.fn<(plan: ConfirmPlan) => void>();
    const { posted } = await renderPolicy({ reload, requestConfirm });
    const user = userEvent.setup();
    vi.spyOn(toast, 'success').mockImplementation(() => 'toast-id');
    await user.click(screen.getByRole('button', { name: PUBLISH_LABEL }));
    await capturePlan(requestConfirm).run();

    expect(posted[0]?.body).toMatchObject({ action: 'publish', expectedRevision: 2 });
    expect(toast.success).toHaveBeenCalledWith('已发布 v2');
  });

  it('草稿有最后修改时间时，版本历史摘要写出修改人和时间', async () => {
    const updatedAt = '2026-08-11T03:30:00.000Z';
    const template = parseTemplate(policyTemplateFixture({
      draft: {
        version: 2,
        policy: { hosts: [], ips: [], ports: [] },
        fingerprint: 'c'.repeat(64),
        updatedAt,
        updatedBy: 2,
      },
    }));
    await renderPolicy({ templates: [template] });
    const summaryText = screen.getByText(/1 个已发布版本/);

    expect(summaryText.textContent).toContain(`草稿最后由 王老师 修改于 ${formatDate(updatedAt)}`);
  });

  it('草稿没有新增允许项时，发布确认不是破坏性操作', async () => {
    const template = parseTemplate(policyTemplateFixture({
      draft: {
        version: 2,
        policy: { hosts: [], ips: [], ports: [443] },
        fingerprint: 'c'.repeat(64),
      },
      revisions: [
        {
          revision: 1,
          policy: { hosts: [], ips: [], ports: [443, 1935] },
          fingerprint: 'a'.repeat(64),
          publishedAt: '2026-08-11T02:00:00.000Z',
        },
      ],
    }));
    const { props } = await renderPolicy({ templates: [template] });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: PUBLISH_LABEL }));
    const plan = capturePlan(props.requestConfirm);

    expect(plan.tone).toBe('default');
    expect(plan.description).toBe('发布只生成不可变版本，不会自动下发到终端。');
  });

  it('本活动正在使用的历史版本不提供改用此版本', async () => {
    const template = parseTemplate(policyTemplateFixture({
      draft: {
        version: 3,
        policy: publishedPolicy(),
        fingerprint: 'c'.repeat(64),
      },
      revisions: [
        {
          revision: 1,
          policy: { hosts: [], ips: [], ports: [80] },
          fingerprint: 'a'.repeat(64),
          publishedAt: '2026-08-11T02:00:00.000Z',
        },
        {
          revision: 2,
          policy: publishedPolicy(),
          fingerprint: 'b'.repeat(64),
          publishedAt: '2026-08-12T02:00:00.000Z',
        },
      ],
      latestPublishedRevision: 2,
    }));
    await renderPolicy({
      templates: [template],
      config: mustConfig(configRecord({
        policy: { id: TEMPLATE_ID, revision: 2, fingerprint: 'b'.repeat(64) },
      })),
    });
    const user = userEvent.setup();
    const summaryText = screen.getByText(/2 个已发布版本/);
    const summary = summaryText.closest('summary');
    if (!(summary instanceof HTMLElement)) throw new TypeError('version history summary missing');
    await user.click(summary);
    const history = document.querySelector('[data-slot="revision-history"]');
    if (!(history instanceof HTMLElement)) throw new TypeError('revision history missing');
    const list = history.querySelector('ol');
    if (!(list instanceof HTMLOListElement)) throw new TypeError('revision list missing');
    const rows = [...list.children].filter((row): row is HTMLElement => row instanceof HTMLElement);
    const current = rows.find((row) => within(row).queryByText('本活动使用中'));
    const older = rows.find((row) => row !== current);
    if (!current || !older) throw new TypeError('current and older revision rows missing');

    expect(within(current).queryByRole('button', { name: '改用此版本' })).not.toBeInTheDocument();
    expect(within(older).getByRole('button', { name: '改用此版本' })).toBeInTheDocument();
  });

  it('创建策略会提交表单里的策略规则', async () => {
    const { posted } = await renderPolicy();
    const user = userEvent.setup();
    await chooseNewTemplate(user);
    await user.type(screen.getByLabelText(/^策略名称/), '晚间策略');
    await user.type(screen.getByLabelText('允许域名'), 'judge.example.edu');
    await user.click(screen.getByRole('button', { name: '创建策略' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body).toMatchObject({
      eventId: EVENT_ID,
      name: '晚间策略',
      policy: { hosts: ['judge.example.edu'], ips: [], ports: [] },
      collaboratorUids: [],
    });
  });

  it('归档确认执行后提交归档，并在刷新完成后提示', async () => {
    let finishReload = (): void => {};
    const reload = vi.fn<() => Promise<void>>(() => new Promise((done) => {
      finishReload = () => done();
    }));
    const success = vi.spyOn(toast, 'success').mockImplementation(() => 'toast-id');
    const requestConfirm = vi.fn<(plan: ConfirmPlan) => void>();
    const { posted } = await renderPolicy({ reload, requestConfirm });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '模板操作' }));
    await user.click(await screen.findByRole('menuitem', { name: ARCHIVE_LABEL }));
    const running = capturePlan(requestConfirm).run();

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(success).not.toHaveBeenCalled();
    expect(posted[0]).toMatchObject({
      url: `/api/admin/exam-policy-templates/${TEMPLATE_ID}?eventId=${encodeURIComponent(EVENT_ID)}`,
      body: {
        eventId: EVENT_ID,
        templateId: TEMPLATE_ID,
        action: 'archive',
        expectedRevision: 2,
      },
    });
    finishReload();
    await running;
    await waitFor(() => expect(success).toHaveBeenCalledWith('策略模板已归档'));
  });

  it('只含空白的策略名称不能创建', async () => {
    await renderPolicy();
    const user = userEvent.setup();
    await chooseNewTemplate(user);
    await user.type(screen.getByLabelText(/^策略名称/), '   ');

    expect(screen.getByRole('button', { name: '创建策略' })).toBeDisabled();
  });

  it('发布在刷新完成之后才提示已发布版本', async () => {
    let finishReload = (): void => {};
    const reload = vi.fn<() => Promise<void>>(() => new Promise((done) => {
      finishReload = () => done();
    }));
    const success = vi.spyOn(toast, 'success').mockImplementation(() => 'toast-id');
    const requestConfirm = vi.fn<(plan: ConfirmPlan) => void>();
    await renderPolicy({ reload, requestConfirm });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: PUBLISH_LABEL }));
    const running = capturePlan(requestConfirm).run();

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(success).not.toHaveBeenCalled();
    finishReload();
    await running;
    await waitFor(() => expect(success).toHaveBeenCalledWith('已发布 v2'));
  });

  it('同一屏最多一个主按钮', async () => {
    await renderPolicy();
    const user = userEvent.setup();

    expect(brandButtons().length).toBeLessThanOrEqual(1);
    await user.type(screen.getByLabelText('允许域名'), 'a.example.edu');
    expect(screen.getByRole('button', { name: '保存草稿' }).className).toContain('bg-brand');
    expect(screen.getByRole('button', { name: '放弃修改' }).className).not.toContain('bg-brand');
    expect(brandButtons().length).toBeLessThanOrEqual(1);
  });

  it('门禁零违规，按钮显式 variant', () => {
    expect(existsSync(resolve(packageRoot, POLICY_STEP_SOURCE)), POLICY_STEP_SOURCE).toBe(true);
    expectDesignGateClean();
    expectExplicitVariants();
  });
});
