import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ComponentType } from 'react';
import { render, screen, waitFor, within, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { toast } from '@/components/ui/toast';
import type {
  BoundEndpointOption,
  ConfirmPlan,
  ExamEventView,
  NetworkConfig,
  NetworkExecution,
  NetworkUpdatePreview,
  ProjectionItem,
} from '../../src/pages/exam-event/model.ts';

// A static import fails collection while run-step.tsx is absent.
const runStepLoaders = import.meta.glob('../../src/pages/exam-event/run-step.tsx');

const packageRoot = resolve(import.meta.dirname, '../..');
const RUN_STEP_SOURCE = 'src/pages/exam-event/run-step.tsx';

const EVENT: ExamEventView = {
  eventId: '66b800000000000000000601',
  schoolId: '66b800000000000000000602',
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

const POLICY_REF = { id: '66b800000000000000000611', revision: 2, fingerprint: 'a'.repeat(64) };
const TARGET_REF = { id: '66b800000000000000000612', revision: 1, fingerprint: 'b'.repeat(64) };

interface PreflightProbe {
  endpointId: string;
  ready: boolean;
  online: boolean;
  compatible: boolean | null;
  reason: string;
}

interface Posted {
  url: string;
  body: Record<string, unknown>;
}

interface RunStepProps {
  event: ExamEventView;
  config: NetworkConfig | null;
  assignment: null;
  execution: NetworkExecution | null;
  updatePreview: NetworkUpdatePreview | null;
  updatePreviewWarning: string | null;
  boundEndpoints: BoundEndpointOption[];
  reload: () => Promise<void>;
  requestConfirm: (plan: ConfirmPlan) => void;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function configFixture(overrides: Partial<NetworkConfig> = {}): NetworkConfig {
  return {
    revision: 2,
    policy: POLICY_REF,
    target: TARGET_REF,
    updatedAt: null,
    ...overrides,
  };
}

function executionFixture(items: ProjectionItem[]): NetworkExecution {
  return {
    executionId: '66b800000000000000000610',
    revision: 3,
    networkPolicyRevision: 2,
    desiredState: 'active',
    policyRef: POLICY_REF,
    targetRef: TARGET_REF,
    startAt: EVENT.startAt,
    hardEndAt: EVENT.endAt,
    operation: {
      kind: 'apply',
      status: 'received',
      failureReason: null,
      requestedAt: null,
      receivedAt: null,
      failedAt: null,
    },
    projection: {
      revision: 3,
      dispatchStatus: 'complete',
      summary: { applied: items.length },
      items,
      receivedAt: '2026-08-11T03:00:00.000Z',
    },
  };
}

function projectionItem(index: number, overrides: Partial<ProjectionItem> = {}): ProjectionItem {
  return {
    endpointId: `endpoint-${String(index).padStart(3, '0')}`,
    commandId: `command-${index}`,
    command: 'apply_network_policy',
    previousPolicyRevision: 1,
    expectedPolicyRevision: 2,
    appliedPolicyRevision: 2,
    status: 'applied',
    failureReason: null,
    online: true,
    networkPolicyState: { state: 'applied', policyRevision: 2 },
    ...overrides,
  };
}

function updatePreviewFixture(overrides: Partial<NetworkUpdatePreview> = {}): NetworkUpdatePreview {
  return {
    executionRevision: 3,
    configRevision: 3,
    fromPolicyRef: POLICY_REF,
    toPolicyRef: { id: '66b800000000000000000611', revision: 3, fingerprint: 'c'.repeat(64) },
    fromTargetRef: TARGET_REF,
    toTargetRef: TARGET_REF,
    previousNetworkPolicyRevision: 2,
    expectedNetworkPolicyRevision: 3,
    policyDiff: {
      effect: 'loosening',
      addedHosts: ['mirror.example.edu'],
      removedHosts: [],
      addedIps: [],
      removedIps: [],
      beforePorts: [443],
      afterPorts: [],
    },
    targetDiff: { beforeCount: 1, afterCount: 1, addedEndpointIds: [], removedEndpointIds: [] },
    requiresStop: false,
    ...overrides,
  };
}

function preflightPayload(items: PreflightProbe[], fingerprint = POLICY_REF.fingerprint): Record<string, unknown> {
  return {
    preflightConfig: {
      revision: 2,
      policy: { id: POLICY_REF.id, revision: POLICY_REF.revision, fingerprint },
      target: TARGET_REF,
    },
    preflight: items.map((item) => ({ ...item, serviceVersion: '0.3.0' })),
  };
}

function badgesByLabel(label: string): Element[] {
  return [...document.querySelectorAll('[data-slot="badge"]')].filter((node) => node.textContent?.trim() === label);
}

function endpointBadge(view: RenderResult, endpointId: string): Element {
  const badge = view.getByText(endpointId).parentElement?.parentElement?.querySelector('[data-slot="badge"]') ?? null;
  expect(badge, endpointId).not.toBeNull();
  return badge ?? view.getByText(endpointId);
}

function bodyRows(): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const node of document.querySelectorAll('table tbody tr')) {
    if (node instanceof HTMLElement) rows.push(node);
  }
  return rows;
}

function runStepLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(runStepLoaders)) {
    if (key.endsWith(RUN_STEP_SOURCE)) return load;
  }
  return undefined;
}

async function loadRunStep(): Promise<ComponentType<RunStepProps>> {
  const load = runStepLoader();
  expect(typeof load, RUN_STEP_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${RUN_STEP_SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('run step module must be an object');
  const value = readField(imported, 'RunStep');
  expect(typeof value, 'RunStep').toBe('function');
  if (typeof value !== 'function') throw new TypeError('RunStep must be a function');
  return value as ComponentType<RunStepProps>;
}

function installFetch(payload: unknown): Posted[] {
  const posted: Posted[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      if (typeof init.body !== 'string') throw new TypeError('POST body must be a JSON string');
      posted.push({ url: String(input), body: JSON.parse(init.body) as Record<string, unknown> });
    }
    return json(payload);
  }));
  return posted;
}

async function renderRun(overrides: Partial<RunStepProps> = {}): Promise<{ view: RenderResult; props: RunStepProps }> {
  const RunStep = await loadRunStep();
  const props: RunStepProps = {
    event: EVENT,
    config: configFixture(),
    assignment: null,
    execution: null,
    updatePreview: null,
    updatePreviewWarning: null,
    boundEndpoints: [],
    reload: vi.fn<() => Promise<void>>(async () => {}),
    requestConfirm: vi.fn<(plan: ConfirmPlan) => void>(),
    ...overrides,
  };
  return { view: render(<RunStep {...props} />), props };
}

function capturePlan(requestConfirm: RunStepProps['requestConfirm']): ConfirmPlan {
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
  const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', RUN_STEP_SOURCE], {
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
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, RUN_STEP_SOURCE], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  expect(result.status, commandOutput(result)).toBe(0);
}

const READY_PROBE: PreflightProbe = {
  endpointId: 'endpoint-ready',
  ready: true,
  online: true,
  compatible: true,
  reason: 'ready',
};
const UNKNOWN_PROBE: PreflightProbe = {
  endpointId: 'endpoint-unknown',
  ready: false,
  online: false,
  compatible: null,
  reason: 'endpoint_offline',
};
const BLOCKED_PROBE: PreflightProbe = {
  endpointId: 'endpoint-blocked',
  ready: false,
  online: false,
  compatible: false,
  reason: 'endpoint_incompatible',
};

describe('exam event run step', () => {
  it('配置缺少目标时只显示未完成，没有终端预检', async () => {
    await renderRun({ config: configFixture({ target: null }) });

    expect(screen.getByText('网络配置尚未完成')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '终端预检' })).not.toBeInTheDocument();
  });

  it('没有执行时显示尚未启动、主按钮启动和一枚待检', async () => {
    await renderRun();
    const pending = badgesByLabel('待检');

    expect(screen.getByText('尚未启动')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启动' }).className).toContain('bg-brand');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.getAttribute('data-tone')).toBe('warning');
  });

  it('预检三项分别显示就绪、未知和阻塞，并汇总成危险的 1/3', async () => {
    installFetch(preflightPayload([READY_PROBE, UNKNOWN_PROBE, BLOCKED_PROBE]));
    const { view } = await renderRun();
    await userEvent.setup().click(screen.getByRole('button', { name: '终端预检' }));

    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    expect(endpointBadge(view, 'endpoint-ready').textContent?.trim()).toBe('就绪');
    expect(endpointBadge(view, 'endpoint-ready').getAttribute('data-tone')).toBe('success');
    expect(endpointBadge(view, 'endpoint-unknown').textContent?.trim()).toBe('未知');
    expect(endpointBadge(view, 'endpoint-unknown').getAttribute('data-tone')).toBe('neutral');
    expect(endpointBadge(view, 'endpoint-blocked').textContent?.trim()).toBe('阻塞');
    expect(endpointBadge(view, 'endpoint-blocked').getAttribute('data-tone')).toBe('danger');
    expect(badgesByLabel('待检')).toHaveLength(0);
    const summary = badgesByLabel('1/3 就绪');
    expect(summary).toHaveLength(1);
    expect(summary[0]?.getAttribute('data-tone')).toBe('danger');
  });

  it('预检指纹与配置不一致时不展示行，待检仍在', async () => {
    const posted = installFetch(preflightPayload([
      { endpointId: 'endpoint-stale', ready: false, online: false, compatible: null, reason: 'endpoint_offline' },
    ], 'c'.repeat(64)));
    const reload = vi.fn<() => Promise<void>>(async () => {});
    await renderRun({ reload });
    const button = screen.getByRole('button', { name: '终端预检' });
    await userEvent.setup().click(button);

    await waitFor(() => expect(reload).toHaveBeenCalled());
    await waitFor(() => expect(button).toBeEnabled());
    expect(posted.some((item) => item.body.action === 'preflight')).toBe(true);
    expect(bodyRows()).toHaveLength(0);
    expect(screen.queryByText('endpoint-stale')).toBeNull();
    expect(badgesByLabel('待检')).toHaveLength(1);
  });

  it('运行中把整批重试作为主按钮，停止在操作栏最后且为 danger-soft', async () => {
    const execution = executionFixture([
      projectionItem(1),
      projectionItem(2),
      projectionItem(3, { status: 'failed', failureReason: 'apply_failed' }),
    ]);
    await renderRun({ execution });
    const bar = document.querySelector('[data-slot="action-bar"]');
    if (!(bar instanceof HTMLElement)) throw new TypeError('action bar missing');
    const stop = within(bar).getByRole('button', { name: '停止' });
    const buttons = [...bar.querySelectorAll('button')];

    expect(screen.getByText('锁网运行中')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '整批重试失败项' })).toHaveAttribute('data-variant', 'primary');
    expect(stop.className).toContain('bg-danger-soft');
    expect(buttons.at(-1)).toBe(stop);
    for (const button of buttons) {
      if (button === stop) continue;
      expect(button.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
    expect(screen.getAllByRole('cell', { name: /旧 1 \/ 期望 2 \/ 实际 2/ }).length).toBeGreaterThan(0);
  });

  it('确认停止后按当前执行版本下发，并在刷新后提示', async () => {
    const success = vi.spyOn(toast, 'success');
    const sequence: string[] = [];
    const posted = installFetch({});
    const reload = vi.fn<() => Promise<void>>(async () => {
      sequence.push('reload');
    });
    success.mockImplementation(() => {
      sequence.push('toast');
      return 'toast-id';
    });
    const requestConfirm = vi.fn<(plan: ConfirmPlan) => void>();
    await renderRun({
      execution: executionFixture([projectionItem(1)]),
      reload,
      requestConfirm,
    });
    await userEvent.setup().click(screen.getByRole('button', { name: '停止' }));
    const plan = capturePlan(requestConfirm);

    expect(plan.title).toBe('停止网络策略？');
    expect(plan.tone).toBe('destructive');
    expect(success).not.toHaveBeenCalled();
    await plan.run();
    expect(posted).toEqual([
      {
        url: `/api/admin/exam-events/${EVENT.eventId}/network-execution`,
        body: { action: 'stop', expectedRevision: 3 },
      },
    ]);
    expect(success).toHaveBeenCalledWith('停止命令已下发');
    expect(sequence).toEqual(['reload', 'toast']);
  });

  it('一次渲染全部 500 行执行事实', async () => {
    const items = Array.from({ length: 500 }, (_, index) => projectionItem(index));
    await renderRun({ execution: executionFixture(items) });

    expect(bodyRows()).toHaveLength(500);
  });

  it('按命令事实筛选终端，应用失败只留一行', async () => {
    const items = [
      projectionItem(1),
      projectionItem(2),
      projectionItem(3, { status: 'failed', failureReason: 'apply_failed' }),
    ];
    const execution = executionFixture(items);
    if (!execution.projection) throw new TypeError('projection missing');
    execution.projection = { ...execution.projection, summary: { applied: 2, failed: 1 } };
    await renderRun({ execution });

    expect(screen.getByRole('tab', { name: /全部/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /已应用/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /应用失败/ })).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(3);
    await userEvent.setup().click(screen.getByRole('tab', { name: /应用失败/ }));
    const rows = bodyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('endpoint-003');
  });

  it('放宽的更新预览提供热更新确认', async () => {
    const requestConfirm = vi.fn<(plan: ConfirmPlan) => void>();
    await renderRun({
      config: configFixture({
        revision: 3,
        policy: { id: '66b800000000000000000611', revision: 3, fingerprint: 'c'.repeat(64) },
      }),
      execution: executionFixture([projectionItem(1)]),
      updatePreview: updatePreviewFixture(),
      requestConfirm,
    });

    expect(screen.getByText('配置已有新版本等待应用')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '热更新策略' }));
    expect(capturePlan(requestConfirm).title).toBe('热更新网络策略？');
  });

  it('运行中的离线终端提示 offline 不是已释放', async () => {
    await renderRun({
      execution: executionFixture([projectionItem(1, { online: false })]),
    });
    const message = screen.getByText(/offline 不是已释放/);

    expect(message.closest('[role="status"], [role="alert"]')).not.toBeNull();
  });

  it('已绑定终端显示座位标签，未绑定显示位置未知', async () => {
    await renderRun({
      execution: executionFixture([projectionItem(1), projectionItem(2)]),
      boundEndpoints: [{ endpointId: 'endpoint-001', label: 'A301 / 1-1' }],
    });
    const rows = bodyRows();

    expect(rows[0]?.querySelector('td')?.textContent?.trim()).toBe('A301 / 1-1');
    expect(rows[0]?.textContent).toContain('endpoint-001');
    expect(rows[1]?.querySelector('td')?.textContent?.trim()).toBe('位置未知');
    expect(rows[1]?.textContent).toContain('endpoint-002');
  });

  it('没有执行时提示尚未启动网络策略，有执行但没有投影时等待执行投影', async () => {
    const first = await renderRun();
    expect(screen.getByText('尚未启动网络策略')).toBeInTheDocument();
    expect(screen.queryByText('等待执行投影')).toBeNull();
    first.view.unmount();

    const execution = executionFixture([]);
    execution.projection = null;
    await renderRun({ execution });
    expect(screen.getByText('等待执行投影')).toBeInTheDocument();
    expect(screen.queryByText('尚未启动网络策略')).toBeNull();
  });

  it('连接列按投影在线标记显示在线或离线', async () => {
    await renderRun({
      execution: executionFixture([
        projectionItem(1, { online: true }),
        projectionItem(2, { online: false }),
      ]),
    });
    const rows = bodyRows();

    expect(rows[0]?.textContent).toContain('endpoint-001');
    expect(rows[0]?.textContent).toContain('在线');
    expect(rows[0]?.textContent).not.toContain('离线');
    expect(rows[1]?.textContent).toContain('endpoint-002');
    expect(rows[1]?.textContent).toContain('离线');
    expect(rows[1]?.textContent).not.toContain('在线');
  });

  it('实际策略版本缺失时使用终端上报的 revision', async () => {
    await renderRun({
      execution: executionFixture([
        projectionItem(1, {
          appliedPolicyRevision: null,
          networkPolicyState: { state: 'applied', policyRevision: 4 },
        }),
      ]),
    });

    expect(screen.getByRole('cell', { name: '旧 1 / 期望 2 / 实际 4' })).toBeInTheDocument();
  });

  it('未就绪预检在原因列显示原因，并附上 Service 版本', async () => {
    installFetch(preflightPayload([UNKNOWN_PROBE]));
    await renderRun();
    await userEvent.setup().click(screen.getByRole('button', { name: '终端预检' }));
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    const row = bodyRows()[0];

    expect(row?.textContent).toContain('终端离线');
    expect(row?.textContent).toContain('· Service 0.3.0');
  });

  it('复制终端 ID 成功后提示，失败时保持沉默', async () => {
    const success = vi.spyOn(toast, 'success');
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    try {
      await renderRun({ execution: executionFixture([projectionItem(1)]) });
      await user.click(screen.getByRole('button', { name: '复制终端 ID endpoint-001' }));
      await waitFor(() => expect(success).toHaveBeenCalledWith('已复制终端 ID'));
      expect(writeText).toHaveBeenCalledWith('endpoint-001');

      success.mockClear();
      writeText.mockRejectedValueOnce(new DOMException('denied'));
      await user.click(screen.getByRole('button', { name: '复制终端 ID endpoint-001' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
      expect(success).not.toHaveBeenCalled();
    } finally {
      writeText.mockRestore();
      success.mockRestore();
    }
  });

  it('热更新成功提示热更新已下发，且发生在刷新之后', async () => {
    const success = vi.spyOn(toast, 'success');
    const sequence: string[] = [];
    installFetch({});
    const reload = vi.fn<() => Promise<void>>(async () => {
      sequence.push('reload');
    });
    success.mockImplementation(() => {
      sequence.push('toast');
      return 'toast-id';
    });
    const requestConfirm = vi.fn<(plan: ConfirmPlan) => void>();
    try {
      await renderRun({
        config: configFixture({
          revision: 3,
          policy: { id: '66b800000000000000000611', revision: 3, fingerprint: 'c'.repeat(64) },
        }),
        execution: executionFixture([projectionItem(1)]),
        updatePreview: updatePreviewFixture(),
        reload,
        requestConfirm,
      });
      await userEvent.setup().click(screen.getByRole('button', { name: '热更新策略' }));
      await capturePlan(requestConfirm).run();

      expect(success).toHaveBeenCalledWith('热更新已下发');
      expect(success).not.toHaveBeenCalledWith('网络策略已启动');
      expect(sequence).toEqual(['reload', 'toast']);
    } finally {
      success.mockRestore();
    }
  });

  it('没有执行时确认启动，成功后提示网络策略已启动', async () => {
    const success = vi.spyOn(toast, 'success');
    const posted = installFetch({});
    const reload = vi.fn<() => Promise<void>>(async () => {});
    success.mockImplementation(() => 'toast-id');
    const requestConfirm = vi.fn<(plan: ConfirmPlan) => void>();
    try {
      await renderRun({ reload, requestConfirm });
      await userEvent.setup().click(screen.getByRole('button', { name: '启动' }));
      await capturePlan(requestConfirm).run();

      expect(posted).toEqual([
        {
          url: `/api/admin/exam-events/${EVENT.eventId}/network-execution`,
          body: { action: 'start', expectedRevision: 0, expectedConfigRevision: 2 },
        },
      ]);
      expect(success).toHaveBeenCalledWith('网络策略已启动');
      expect(reload).toHaveBeenCalled();
    } finally {
      success.mockRestore();
    }
  });

  it('已停止的执行显示已停止', async () => {
    const execution = executionFixture([projectionItem(1)]);
    execution.desiredState = 'stopped';
    await renderRun({ execution });

    expect(screen.getByText('已停止')).toBeInTheDocument();
    expect(screen.queryByText('锁网运行中')).toBeNull();
    expect(screen.queryByText('尚未启动')).toBeNull();
  });

  it('门禁零违规，按钮显式 variant', () => {
    expect(existsSync(resolve(packageRoot, RUN_STEP_SOURCE)), RUN_STEP_SOURCE).toBe(true);
    expectDesignGateClean();
    expectExplicitVariants();
  });
});
