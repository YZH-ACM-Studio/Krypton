import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { ExamEventPage, ExamInfrastructurePage } from '../src/pages/exam-infrastructure.tsx';

const EVENT = {
  eventId: '66b800000000000000000601',
  domainId: 'system',
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
  auditRef: 'exam-event:66b800000000000000000601:2',
  createdAt: '2026-08-10T01:00:00.000Z',
  createdBy: 2,
  updatedAt: '2026-08-10T02:00:00.000Z',
  updatedBy: 2,
  archivedAt: null,
  archivedBy: null,
};

function bootstrap(data: Record<string, unknown>, allowed = true): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-08-11T00:00:00.000Z',
    user: { id: 2, name: 'teacher', signedIn: true, priv: 0, canManageExamInfrastructure: allowed } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: typeof data.eventId === 'string' ? 'admin_exam_event.html' : 'admin_exam_infrastructure.html', data },
  };
}

function renderPage(data: Record<string, unknown>, allowed = true) {
  const Page = typeof data.eventId === 'string' ? ExamEventPage : ExamInfrastructurePage;
  return render(
    <BootstrapProvider bootstrap={bootstrap(data, allowed)}>
      <Page />
    </BootstrapProvider>,
  );
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function executionFixture(items: unknown[]) {
  return {
    executionId: '66b800000000000000000610',
    revision: 3,
    networkPolicyRevision: 2,
    desiredState: 'active',
    policyRef: { id: '66b800000000000000000611', revision: 2, fingerprint: 'a'.repeat(64) },
    targetRef: { id: '66b800000000000000000612', revision: 1, fingerprint: 'b'.repeat(64) },
    startAt: EVENT.startAt,
    hardEndAt: EVENT.endAt,
    operation: { kind: 'apply', status: 'received', failureReason: null },
    projection: {
      revision: 3,
      dispatchStatus: 'complete',
      summary: { applied: items.length },
      items,
      receivedAt: '2026-08-11T03:00:00.000Z',
    },
  };
}

function projectionItem(index: number, overrides: Record<string, unknown> = {}) {
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

function updatePreviewFixture(overrides: Record<string, unknown> = {}) {
  return {
    executionRevision: 3,
    configRevision: 3,
    fromPolicyRef: { id: '66b800000000000000000611', revision: 2, fingerprint: 'a'.repeat(64) },
    toPolicyRef: { id: '66b800000000000000000611', revision: 3, fingerprint: 'c'.repeat(64) },
    fromTargetRef: { id: '66b800000000000000000612', revision: 1, fingerprint: 'b'.repeat(64) },
    toTargetRef: { id: '66b800000000000000000612', revision: 1, fingerprint: 'b'.repeat(64) },
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

function detailFetch(execution: unknown, endpointIds: string[] = [], event = EVENT) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === `/api/admin/exam-events/${EVENT.eventId}`) return json({ event, schools: [{ schoolId: EVENT.schoolId, name: '计算机学院' }] });
    if (url.startsWith('/api/admin/exam-policy-templates')) return json({ templates: [] });
    if (url.endsWith('/target-assignment')) {
      return json({
        assignment: {
          assignmentId: '66b800000000000000000612',
          revision: 1,
          draft: { version: 1, sources: endpointIds.length ? [{ kind: 'endpoint', ids: endpointIds }] : [] },
          revisions: [
            {
              revision: 1,
              sources: [],
              targetFingerprint: 'b'.repeat(64),
              endpointIds,
              targetCount: endpointIds.length,
              publishedAt: '2026-08-11T02:00:00.000Z',
            },
          ],
          latestPublishedRevision: 1,
        },
      });
    }
    if (url.endsWith('/network-config')) {
      return json({
        config: {
          revision: 2,
          policy: { id: '66b800000000000000000611', revision: 2, fingerprint: 'a'.repeat(64) },
          target: { id: '66b800000000000000000612', revision: 1, fingerprint: 'b'.repeat(64) },
        },
      });
    }
    if (url.endsWith('/network-execution')) return json({ execution, updatePreview: null });
    throw new Error(`unexpected request: ${url}`);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('exam infrastructure workspace', () => {
  it('fails closed before requesting data when the bootstrap affordance is absent', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPage({ eventId: null }, false);

    expect(screen.getByText('你没有管理考试基础设施的权限。')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps list and detail bootstrap contracts separate', () => {
    vi.stubGlobal('fetch', vi.fn());
    expect(() =>
      render(
        <BootstrapProvider bootstrap={bootstrap({ eventId: null })}>
          <ExamEventPage />
        </BootstrapProvider>,
      ),
    ).toThrow('考试活动页面响应格式不正确');
  });

  it('renders the empty list and exposes an accessible create dialog', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ events: [], schools: [{ schoolId: EVENT.schoolId, name: '计算机学院' }] })));
    const user = userEvent.setup();
    const { container } = renderPage({ eventId: null });

    expect(await screen.findByText('还没有考试活动')).toBeInTheDocument();
    const createButton = screen.getByRole('button', { name: '创建第一个活动' });
    await user.click(createButton);
    expect(screen.getByRole('dialog', { name: '新建考试活动' })).toBeInTheDocument();
    expect(container).toHaveAttribute('inert');
    expect(screen.getByRole('heading', { name: '新建考试活动' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^活动名称/)).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('heading', { name: '新建考试活动' })).not.toBeInTheDocument());
    expect(container).not.toHaveAttribute('inert');
    expect(createButton).toHaveFocus();
  });

  it('shows canonical lifecycle and type facts in the activity list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ events: [EVENT], schools: [] })));
    renderPage({ eventId: null });

    const link = await screen.findByRole('link', { name: /校赛网络保障/ });
    expect(link).toHaveAttribute('href', `/admin/exam-infrastructure/events/${EVENT.eventId}`);
    expect(screen.getByText('待开始')).toBeInTheDocument();
    expect(screen.getByText('外部考试')).toBeInTheDocument();
  });

  it('opens the canonical classroom workspace from the infrastructure page without a second navigation system', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/admin/exam-infrastructure/classrooms') {
        return json({
          classrooms: [
            {
              classroomId: '66b800000000000000000701',
              schoolId: EVENT.schoolId,
              name: '北实 201 机房',
              layoutRevision: 3,
              seatCount: 120,
            },
          ],
        });
      }
      return json({ events: [EVENT], schools: [{ schoolId: EVENT.schoolId, name: '计算机学院' }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage({ eventId: null });

    await user.click(await screen.findByRole('button', { name: '教室终端' }));
    const link = await screen.findByRole('link', { name: /北实 201 机房/ });
    expect(link).toHaveAttribute('href', '/admin/exam-infrastructure/classrooms/66b800000000000000000701');
    expect(screen.getByText('120 座 · layout r3')).toBeInTheDocument();
  });

  it('loads an empty classroom collection once instead of polling the launcher', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/admin/exam-infrastructure/classrooms') return json({ classrooms: [] });
      return json({ events: [EVENT], schools: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage({ eventId: null });

    await user.click(await screen.findByRole('button', { name: '教室终端' }));
    expect(await screen.findByText('还没有已导入教室')).toBeInTheDocument();
    await new Promise((resolve) => window.setTimeout(resolve, 50));

    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/admin/exam-infrastructure/classrooms')).toHaveLength(1);
  });

  it('does not present a load failure as an empty activity list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              name: 'ServiceUnavailableError',
              errorCode: 'database_unavailable',
              code: 503,
              status: 503,
              params: [],
              message: '考试活动暂时无法加载',
            },
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    renderPage({ eventId: null });

    expect(await screen.findByRole('alert')).toHaveTextContent('考试活动暂时无法加载');
    expect(screen.queryByText('还没有考试活动')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /新建活动|创建第一个活动/ })).not.toBeInTheDocument();
  });

  it('only exposes the endpoint target source supported by the current canonical', async () => {
    vi.stubGlobal('fetch', detailFetch(null));
    renderPage({ eventId: EVENT.eventId });

    expect(await screen.findByLabelText('指定终端')).toBeInTheDocument();
    for (const unavailable of ['教室', '实体座位', '考试座位', '用户组']) {
      expect(screen.queryByLabelText(unavailable)).not.toBeInTheDocument();
    }
    expect(screen.getByText(/当前不作为可提交的目标来源/)).toBeInTheDocument();
  });

  it('invalidates a target preview as soon as the endpoint draft changes', async () => {
    const load = detailFetch(null, ['endpoint-001']);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return json({
          preview: {
            previewFingerprint: 'c'.repeat(64),
            endpointIds: ['endpoint-001'],
            targetCount: 1,
            addedEndpointIds: ['endpoint-001'],
            removedEndpointIds: [],
          },
        });
      }
      return load(input);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage({ eventId: EVENT.eventId });

    const input = await screen.findByLabelText('指定终端');
    await user.click(screen.getByRole('button', { name: '重新解析' }));
    expect(await screen.findByText('解析到 1 台终端')).toBeInTheDocument();
    await user.type(input, '\nendpoint-002');
    expect(screen.queryByText('解析到 1 台终端')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发布快照' })).not.toBeInTheDocument();
    expect(screen.getByText('有未保存修改，请先保存再解析')).toBeInTheDocument();
    const previewButton = screen.getByRole('button', { name: '重新解析' });
    expect(previewButton).toBeDisabled();
    fireEvent.click(previewButton);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('shows target draft and published revision changes before publishing', async () => {
    const load = detailFetch(null, ['endpoint-001']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return json({
            preview: {
              previewFingerprint: 'c'.repeat(64),
              endpointIds: ['endpoint-001'],
              targetCount: 1,
              addedEndpointIds: [],
              removedEndpointIds: [],
            },
          });
        }
        return load(input);
      }),
    );
    const user = userEvent.setup();
    renderPage({ eventId: EVENT.eventId });

    await user.click(await screen.findByRole('button', { name: '重新解析' }));
    const publishButton = await screen.findByRole('button', { name: '发布快照' });
    await user.click(publishButton);
    expect(screen.getByRole('dialog', { name: '发布目标终端快照？' })).toBeInTheDocument();
    expect(screen.getByText('目标草稿版本')).toBeInTheDocument();
    expect(screen.getByText('1 → 2')).toBeInTheDocument();
    expect(screen.getByText('发布目标版本')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: '确认发布' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '发布目标终端快照？' })).not.toBeInTheDocument());
    expect(publishButton).toHaveFocus();
  });

  it('treats changing finite ports to all ports as a policy expansion', async () => {
    const load = detailFetch(null, ['endpoint-001']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method && String(input).startsWith('/api/admin/exam-policy-templates')) {
          return json({
            templates: [
              {
                templateId: '66b800000000000000000611',
                name: '考试策略',
                status: 'active',
                revision: 2,
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
              },
            ],
          });
        }
        return load(input);
      }),
    );
    const user = userEvent.setup();
    renderPage({ eventId: EVENT.eventId });

    const publishButton = await screen.findByRole('button', { name: '发布版本' });
    await waitFor(() => expect(publishButton).toBeEnabled());
    await user.click(publishButton);
    expect(screen.getByRole('dialog', { name: '发布不可变策略版本？' })).toHaveTextContent('放宽终端可访问范围');
    expect(screen.getByText('端口：全部端口')).toBeInTheDocument();
  });

  it('moves keyboard focus into the basic-information editor', async () => {
    vi.stubGlobal('fetch', detailFetch(null));
    const user = userEvent.setup();
    renderPage({ eventId: EVENT.eventId });

    await user.click(await screen.findByRole('button', { name: '编辑' }));
    expect(screen.getByLabelText(/^活动名称/)).toHaveFocus();
  });

  it('updates only title and collaborators after the exam has started', async () => {
    const activeEvent = { ...EVENT, status: 'active' as const };
    const load = detailFetch(null, ['endpoint-001'], activeEvent);
    let submitted: Record<string, unknown> | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST' && String(input) === `/api/admin/exam-events/${EVENT.eventId}`) {
          submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
          return json({ event: activeEvent });
        }
        return load(input);
      }),
    );
    const user = userEvent.setup();
    renderPage({ eventId: EVENT.eventId });

    await user.click(await screen.findByRole('button', { name: '编辑' }));
    expect(screen.getByLabelText(/^学校/)).toBeDisabled();
    expect(screen.getByLabelText(/^考试类型/)).toBeDisabled();
    const title = screen.getByLabelText(/^活动名称/);
    await user.clear(title);
    await user.type(title, '校赛网络保障（更新）');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(submitted).not.toBeNull());
    expect(Object.keys(submitted || {}).sort()).toEqual(['action', 'collaboratorUids', 'expectedRevision', 'title']);
  });

  it('renders archived policy and target configuration as read-only', async () => {
    const archivedEvent = { ...EVENT, lifecycle: 'archived' as const, status: 'archived' as const };
    vi.stubGlobal('fetch', detailFetch(null, ['endpoint-001'], archivedEvent));
    renderPage({ eventId: EVENT.eventId });

    expect(await screen.findByText('只读归档')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^策略名称/)).toBeDisabled();
    expect(screen.getByLabelText('指定终端')).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存来源' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重新解析' })).toBeDisabled();
    expect(screen.getByText('活动已归档，策略版本仅供查看。')).toBeInTheDocument();
    expect(screen.getByText('活动已归档，目标快照仅供查看。')).toBeInTheDocument();
  });

  it('loads the detail in workflow order and keeps transport facts distinct from applied state', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/admin/exam-events/${EVENT.eventId}`) {
        return json({ event: EVENT, schools: [{ schoolId: EVENT.schoolId, name: '计算机学院' }] });
      }
      if (url.startsWith('/api/admin/exam-policy-templates')) return json({ templates: [] });
      if (url.endsWith('/target-assignment')) return json({ assignment: null, config: null });
      if (url.endsWith('/network-config')) return json({ config: null });
      if (url.endsWith('/network-execution')) return json({ execution: null, updatePreview: null });
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage({ eventId: EVENT.eventId });

    expect(await screen.findByRole('heading', { name: '校赛网络保障' })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual(['1. 基本信息', '2. 网络策略', '3. 目标终端', '4. 预检、启停与结果']);
    expect(screen.getByText(/“已送达”不等于“已应用”/)).toBeInTheDocument();
    expect(screen.getByText('网络配置尚未完成')).toBeInTheDocument();
  });

  it('renders the full 500-endpoint canonical projection without collapsing rows', async () => {
    const items = Array.from({ length: 500 }, (_, index) => projectionItem(index));
    vi.stubGlobal(
      'fetch',
      detailFetch(
        executionFixture(items),
        items.map((item) => item.endpointId),
      ),
    );
    renderPage({ eventId: EVENT.eventId });

    expect(await screen.findByText('endpoint-499')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(501);
    expect(screen.getAllByText('已应用')).toHaveLength(500);
  });

  it('fails closed instead of coercing malformed endpoint state to offline', async () => {
    const malformed = projectionItem(1, { online: 'false' });
    vi.stubGlobal('fetch', detailFetch(executionFixture([malformed]), [malformed.endpointId]));
    renderPage({ eventId: EVENT.eventId });

    expect(await screen.findByRole('alert')).toHaveTextContent('终端执行状态响应格式不正确');
    expect(screen.queryByText('离线')).not.toBeInTheDocument();
  });

  it('fails closed when a displayed network-state fact has the wrong type', async () => {
    const malformed = projectionItem(1, { networkPolicyState: { state: 'applied', policyRevision: '2', reason: 17 } });
    vi.stubGlobal('fetch', detailFetch(executionFixture([malformed]), [malformed.endpointId]));
    renderPage({ eventId: EVENT.eventId });

    expect(await screen.findByRole('alert')).toHaveTextContent('终端网络状态响应格式不正确');
    expect(screen.queryByText(/实际 2/)).not.toBeInTheDocument();
  });

  it('keeps the workspace usable and reports a preflight outage', async () => {
    const endpointIds = ['endpoint-001'];
    const load = detailFetch(null, endpointIds);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST' && String(input).endsWith('/network-execution')) {
        return new Response(
          JSON.stringify({
            error: {
              name: 'ServiceUnavailableError',
              errorCode: 'vigil_unavailable',
              code: 503,
              status: 503,
              params: [],
              message: 'Vigil Server 暂时不可用',
            },
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      return load(input);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage({ eventId: EVENT.eventId });

    await user.click(await screen.findByRole('button', { name: '终端预检' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Vigil Server 暂时不可用/);
    expect(screen.getByRole('heading', { name: '校赛网络保障' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '终端预检' })).toBeEnabled();
  });

  it('invalidates a preflight result when canonical config changes again before reload', async () => {
    const endpointIds = ['endpoint-001'];
    const load = detailFetch(null, endpointIds);
    let afterPreflight = false;
    let resolveConfigReload!: (response: Response) => void;
    const configReload = new Promise<Response>((resolve) => {
      resolveConfigReload = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/network-execution')) {
        afterPreflight = true;
        return json({
          preflightConfig: {
            revision: 3,
            policy: { id: '66b800000000000000000611', revision: 2, fingerprint: 'a'.repeat(64) },
            target: { id: '66b800000000000000000612', revision: 1, fingerprint: 'b'.repeat(64) },
          },
          preflight: [{ endpointId: 'endpoint-001', ready: true, reason: 'ready', online: true, compatible: true, serviceVersion: '0.3.0' }],
        });
      }
      if (!init?.method && url.endsWith('/network-config') && afterPreflight) {
        return configReload;
      }
      return load(input);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage({ eventId: EVENT.eventId });

    await user.click(await screen.findByRole('button', { name: '终端预检' }));
    expect(screen.queryByText('1/1 就绪')).not.toBeInTheDocument();
    resolveConfigReload(
      json({
        config: {
          revision: 4,
          policy: { id: '66b800000000000000000611', revision: 3, fingerprint: 'c'.repeat(64) },
          target: { id: '66b800000000000000000612', revision: 2, fingerprint: 'd'.repeat(64) },
        },
      }),
    );
    expect(await screen.findByText(/配置版本 4/)).toBeInTheDocument();
    expect(screen.queryByText('1/1 就绪')).not.toBeInTheDocument();
  });

  it('does not reuse a preflight result when only a canonical fingerprint differs', async () => {
    const load = detailFetch(null, ['endpoint-001']);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/network-execution')) {
        return json({
          preflightConfig: {
            revision: 2,
            policy: { id: '66b800000000000000000611', revision: 2, fingerprint: 'c'.repeat(64) },
            target: { id: '66b800000000000000000612', revision: 1, fingerprint: 'b'.repeat(64) },
          },
          preflight: [{ endpointId: 'endpoint-001', ready: true, reason: 'ready', online: true, compatible: true, serviceVersion: '0.3.0' }],
        });
      }
      return load(input);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage({ eventId: EVENT.eventId });

    const button = await screen.findByRole('button', { name: '终端预检' });
    await user.click(button);
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByText('1/1 就绪')).not.toBeInTheDocument();
  });

  it('shows a preflight result whose service identity matches canonical config', async () => {
    const load = detailFetch(null, ['endpoint-001']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST' && url.endsWith('/network-execution')) {
          return json({
            preflightConfig: {
              revision: 2,
              policy: { id: '66b800000000000000000611', revision: 2, fingerprint: 'a'.repeat(64) },
              target: { id: '66b800000000000000000612', revision: 1, fingerprint: 'b'.repeat(64) },
            },
            preflight: [{ endpointId: 'endpoint-001', ready: true, reason: 'ready', online: true, compatible: true, serviceVersion: '0.3.0' }],
          });
        }
        return load(input);
      }),
    );
    const user = userEvent.setup();
    renderPage({ eventId: EVENT.eventId });

    await user.click(await screen.findByRole('button', { name: '终端预检' }));
    expect(await screen.findByText('1/1 就绪')).toBeInTheDocument();
  });

  it('does not offer a new preflight or apply after the exam has ended', async () => {
    vi.stubGlobal('fetch', detailFetch(null, ['endpoint-001'], { ...EVENT, status: 'ended' }));
    renderPage({ eventId: EVENT.eventId });

    expect(await screen.findByRole('button', { name: '终端预检' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '启动' })).toBeDisabled();
  });

  it('previews and explicitly confirms a policy hot update against the current config', async () => {
    const execution = executionFixture([projectionItem(1)]);
    const base = detailFetch(execution, ['endpoint-001']);
    let submitted: Record<string, unknown> | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (!init?.method && url.endsWith('/network-config')) {
          return json({
            config: {
              revision: 3,
              policy: { id: '66b800000000000000000611', revision: 3, fingerprint: 'c'.repeat(64) },
              target: { id: '66b800000000000000000612', revision: 1, fingerprint: 'b'.repeat(64) },
            },
          });
        }
        if (!init?.method && url.endsWith('/network-execution')) {
          return json({ execution, updatePreview: updatePreviewFixture() });
        }
        if (init?.method === 'POST' && url.endsWith('/network-execution')) {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          if (body.action === 'preflight') {
            return json({
              preflightConfig: {
                revision: 3,
                policy: { id: '66b800000000000000000611', revision: 3, fingerprint: 'c'.repeat(64) },
                target: { id: '66b800000000000000000612', revision: 1, fingerprint: 'b'.repeat(64) },
              },
              preflight: [{ endpointId: 'endpoint-001', ready: true, reason: 'ready', online: true, compatible: true, serviceVersion: '0.3.0' }],
            });
          }
          submitted = body;
          return json({ execution });
        }
        return base(input);
      }),
    );
    const user = userEvent.setup();
    renderPage({ eventId: EVENT.eventId });

    const hotUpdate = await screen.findByRole('button', { name: '热更新策略' });
    expect(hotUpdate).toBeDisabled();
    expect(screen.getByText('配置已有新版本等待应用')).toBeInTheDocument();
    expect(screen.getByText('放宽')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '终端预检' }));
    await waitFor(() => expect(hotUpdate).toBeEnabled());
    await user.click(hotUpdate);
    const dialog = screen.getByRole('dialog', { name: '热更新网络策略？' });
    expect(dialog).toHaveTextContent('2 → 3');
    expect(dialog).toHaveTextContent('mirror.example.edu');
    expect(dialog).toHaveTextContent('443 → 全部端口');
    await user.click(screen.getByRole('button', { name: '确认热更新' }));
    await waitFor(() => expect(submitted).toEqual({ action: 'start', expectedRevision: 3, expectedConfigRevision: 3 }));
  });

  it('requires a confirmed stop before applying a changed target snapshot', async () => {
    const execution = executionFixture([projectionItem(1)]);
    const base = detailFetch(execution, ['endpoint-001']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/target-assignment')) {
          return json({
            assignment: {
              assignmentId: '66b800000000000000000612',
              revision: 2,
              draft: { version: 2, sources: [{ kind: 'endpoint', ids: ['endpoint-002', 'endpoint-003', 'endpoint-004'] }] },
              revisions: [
                {
                  revision: 2,
                  sources: [{ kind: 'endpoint', ids: ['endpoint-002', 'endpoint-003', 'endpoint-004'] }],
                  targetFingerprint: 'd'.repeat(64),
                  endpointIds: ['endpoint-002', 'endpoint-003', 'endpoint-004'],
                  targetCount: 3,
                  publishedAt: '2026-08-11T02:30:00.000Z',
                },
              ],
              latestPublishedRevision: 2,
            },
          });
        }
        if (url.endsWith('/network-config')) {
          return json({
            config: {
              revision: 3,
              policy: execution.policyRef,
              target: { id: '66b800000000000000000612', revision: 2, fingerprint: 'd'.repeat(64) },
            },
          });
        }
        if (url.endsWith('/network-execution')) {
          return json({
            execution,
            updatePreview: updatePreviewFixture({
              configRevision: 3,
              toPolicyRef: execution.policyRef,
              toTargetRef: { id: '66b800000000000000000612', revision: 2, fingerprint: 'd'.repeat(64) },
              policyDiff: {
                effect: 'unchanged',
                addedHosts: [],
                removedHosts: [],
                addedIps: [],
                removedIps: [],
                beforePorts: [443],
                afterPorts: [443],
              },
              targetDiff: {
                beforeCount: 1,
                afterCount: 3,
                addedEndpointIds: ['endpoint-002', 'endpoint-003', 'endpoint-004'],
                removedEndpointIds: ['endpoint-001'],
              },
              requiresStop: true,
            }),
          });
        }
        return base(input);
      }),
    );
    renderPage({ eventId: EVENT.eventId });

    expect(await screen.findByText(/必须先停止当前目标并等待全部终端确认释放/)).toBeInTheDocument();
    expect(screen.getAllByText(/endpoint-002/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '热更新策略' })).not.toBeInTheDocument();
    expect(
      screen.getByText((_content, element) => element?.tagName === 'P' && element.textContent?.includes('目标 1 → 3 台') === true),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '停止' }));
    const dialog = screen.getByRole('dialog', { name: '停止网络策略？' });
    expect(within(dialog).getByText('目标终端数').parentElement).toHaveTextContent('1');
  });

  it('does not offer a full-target failure retry while the active configuration has drifted', async () => {
    const execution = executionFixture([
      projectionItem(1, {
        appliedPolicyRevision: null,
        status: 'offline',
        failureReason: 'endpoint_offline',
        online: false,
        networkPolicyState: null,
      }),
    ]);
    const base = detailFetch(execution, ['endpoint-001']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/network-config')) {
          return json({
            config: {
              revision: 3,
              policy: { id: '66b800000000000000000611', revision: 3, fingerprint: 'c'.repeat(64) },
              target: execution.targetRef,
            },
          });
        }
        if (url.endsWith('/network-execution')) {
          return json({ execution, updatePreview: updatePreviewFixture() });
        }
        return base(input);
      }),
    );
    renderPage({ eventId: EVENT.eventId });

    expect(await screen.findByRole('button', { name: '热更新策略' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '整批重试失败项' })).not.toBeInTheDocument();
  });

  it('keeps an unresolved hot update on the original request identity', async () => {
    const active = executionFixture([projectionItem(1)]);
    const execution = {
      ...active,
      operation: { ...active.operation, status: 'unknown' as const, failureReason: 'vigil_delivery_unknown' },
    };
    const base = detailFetch(execution, ['endpoint-001']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/network-config')) {
          return json({
            config: {
              revision: 3,
              policy: { id: '66b800000000000000000611', revision: 3, fingerprint: 'c'.repeat(64) },
              target: execution.targetRef,
            },
          });
        }
        if (url.endsWith('/network-execution')) return json({ execution, updatePreview: updatePreviewFixture() });
        return base(input);
      }),
    );
    renderPage({ eventId: EVENT.eventId });

    expect(await screen.findByRole('button', { name: '重试当前请求' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '热更新策略' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '热更新策略' })).toHaveAttribute('title', '请先重试当前请求或刷新到完整执行事实');
  });

  it('does not turn a transport-unknown endpoint fact into a new full-target retry', async () => {
    const execution = executionFixture([
      projectionItem(1, {
        appliedPolicyRevision: null,
        status: 'offline',
        failureReason: 'endpoint_offline',
        online: false,
        networkPolicyState: null,
      }),
      projectionItem(2, {
        appliedPolicyRevision: null,
        status: 'failed',
        failureReason: 'transport_send_failed_delivery_unknown',
      }),
    ]);
    const base = detailFetch(execution, ['endpoint-001', 'endpoint-002']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/network-config')) {
          return json({
            config: {
              revision: 3,
              policy: { id: '66b800000000000000000611', revision: 3, fingerprint: 'c'.repeat(64) },
              target: execution.targetRef,
            },
          });
        }
        if (url.endsWith('/network-execution')) return json({ execution, updatePreview: updatePreviewFixture() });
        return base(input);
      }),
    );
    renderPage({ eventId: EVENT.eventId });

    expect(await screen.findByRole('button', { name: '重试当前请求' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '整批重试失败项' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '热更新策略' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '停止' })).toBeEnabled();
  });

  it('shows old, expected and actual policy revisions for every endpoint fact', async () => {
    vi.stubGlobal('fetch', detailFetch(executionFixture([projectionItem(1)]), ['endpoint-001']));
    renderPage({ eventId: EVENT.eventId });

    expect(await screen.findByText(/旧 1 \/ 期望 2 \/ 实际 2/)).toBeInTheDocument();
  });

  it('creates a new full-target retry intent for explicit endpoint failures', async () => {
    const execution = executionFixture([
      projectionItem(1),
      projectionItem(2, {
        previousPolicyRevision: null,
        appliedPolicyRevision: null,
        status: 'offline',
        failureReason: 'endpoint_offline',
        online: false,
        networkPolicyState: null,
      }),
    ]);
    const base = detailFetch(execution, ['endpoint-001', 'endpoint-002']);
    let submitted: Record<string, unknown> | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST' && String(input).endsWith('/network-execution')) {
          submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
          return json({ execution });
        }
        return base(input);
      }),
    );
    const user = userEvent.setup();
    renderPage({ eventId: EVENT.eventId });

    await user.click(await screen.findByRole('button', { name: '整批重试失败项' }));
    const dialog = screen.getByRole('dialog', { name: '整批重新应用网络策略？' });
    expect(dialog).toHaveTextContent('不是只给失败终端补发');
    expect(dialog).toHaveTextContent('2 → 3');
    expect(dialog).toHaveTextContent('endpoint-002');
    await user.click(screen.getByRole('button', { name: '确认整批重试' }));
    await waitFor(() => expect(submitted).toEqual({ action: 'retryFailed', expectedRevision: 3 }));
  });

  it('keeps a failed start confirmation open and shows the server error in place', async () => {
    const load = detailFetch(null, ['endpoint-001']);
    let submittedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          submittedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          if (submittedBody.action === 'preflight') {
            return json({
              preflightConfig: {
                revision: 2,
                policy: { id: '66b800000000000000000611', revision: 2, fingerprint: 'a'.repeat(64) },
                target: { id: '66b800000000000000000612', revision: 1, fingerprint: 'b'.repeat(64) },
              },
              preflight: [{ endpointId: 'endpoint-001', ready: true, reason: 'ready', online: true, compatible: true, serviceVersion: '0.3.0' }],
            });
          }
          return new Response(
            JSON.stringify({
              error: {
                name: 'ServiceUnavailableError',
                errorCode: 'vigil_unavailable',
                code: 503,
                status: 503,
                params: [],
                message: 'Vigil Server 暂时不可用',
              },
            }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return load(input);
      }),
    );
    const user = userEvent.setup();
    renderPage({ eventId: EVENT.eventId });

    await user.click(await screen.findByRole('button', { name: '终端预检' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '启动' })).toBeEnabled());
    await user.click(await screen.findByRole('button', { name: '启动' }));
    expect(screen.getByRole('heading', { name: '启动网络策略？' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认启动' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Vigil Server 暂时不可用');
    expect(screen.getByRole('heading', { name: '启动网络策略？' })).toBeInTheDocument();
    expect(submittedBody).toEqual({ action: 'start', expectedRevision: 0, expectedConfigRevision: 2 });
  });
});
