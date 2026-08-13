import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { clearAdminNavRegistry, registerAdminNavSection } from '../src/lib/admin-nav-registry.ts';
import { ExamClassroomPage } from '../src/pages/exam-classroom.tsx';

const CLASSROOM_ID = '66b800000000000000000701';
const SCHOOL_ID = '66b800000000000000000702';

function bootstrap(allowed = true): KryptonBootstrap {
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
    page: { templateName: 'admin_exam_classroom.html', data: { classroomId: CLASSROOM_ID } },
  };
}

function renderPage(allowed = true) {
  return render(
    <BootstrapProvider bootstrap={bootstrap(allowed)}>
      <ExamClassroomPage />
    </BootstrapProvider>,
  );
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function seat(sourceSeatId: string, label: string, x: number, y: number) {
  return { sourceSeatId, label, x, y, rotation: 0, status: 'active' };
}

function binding(sourceSeatId: string, endpointId: string, revision = 1) {
  return {
    bindingId: `66b800000000000000000${sourceSeatId.at(-1)}`,
    sourceSeatId,
    status: 'active',
    endpointId,
    revision,
    history: [
      {
        revision,
        action: 'bind',
        actorUid: 2,
        at: '2026-08-11T01:00:00.000Z',
        endpointId,
        previousEndpointId: null,
      },
    ],
    updatedAt: '2026-08-11T01:00:00.000Z',
  };
}

function stateFixture(overrides: Record<string, unknown> = {}) {
  return {
    classroom: {
      classroomId: CLASSROOM_ID,
      schoolId: SCHOOL_ID,
      name: '北实 201 机房',
      layoutRevision: 3,
      layout: {
        schemaVersion: 1,
        sourceFormat: 'legacy-grid-v1',
        coordinateSystem: 'grid',
        rows: 1,
        cols: 3,
        fingerprint: 'a'.repeat(64),
        seats: [seat('seat-1', 'A-01', 0, 0), seat('seat-2', 'A-02', 1, 0), seat('seat-3', '很长的座位显示名称 A-03', 2, 0)],
        decorations: [],
      },
    },
    bindings: [binding('seat-1', 'ep_online_00000001'), binding('seat-2', 'ep_offline_0000002')],
    pairingWindow: null,
    references: [
      {
        kind: 'network-config',
        endpointId: 'ep_online_00000001',
        eventId: '66b800000000000000000710',
        eventTitle: '校赛网络保障',
        eventState: 'future',
        startAt: '2026-08-20T01:00:00.000Z',
        endAt: '2026-08-20T04:00:00.000Z',
        targetRevision: 2,
      },
    ],
    endpointPreflight: {
      state: 'available',
      items: [
        {
          endpointId: 'ep_online_00000001',
          ready: true,
          reason: 'ready',
          credentialStatus: 'active',
          online: true,
          compatible: true,
          serviceVersion: '0.4.0',
          protocolVersion: 2,
        },
        {
          endpointId: 'ep_offline_0000002',
          ready: false,
          reason: 'endpoint_offline',
          credentialStatus: 'active',
          online: false,
          compatible: true,
          serviceVersion: '0.4.1',
          protocolVersion: 2,
        },
      ],
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearAdminNavRegistry();
  window.history.replaceState({}, '', '/');
});

describe('exam classroom endpoint binding workspace', () => {
  it('fails closed before requesting state without the infrastructure capability', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPage(false);

    expect(screen.getByText('你没有管理考试基础设施的权限。')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders the classroom workspace without the admin sidebar', async () => {
    registerAdminNavSection({
      key: 'test-admin',
      label: '管理测试',
      order: 1,
      items: [{ key: 'test-admin-item', label: '不应显示的管理侧栏', href: '/admin/test' }],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(stateFixture())));

    renderPage();

    expect(await screen.findByRole('heading', { name: '北实 201 机房' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '不应显示的管理侧栏' })).not.toBeInTheDocument();
  });

  it('renders canonical coordinates, live states, references, and restores the selected deep link', async () => {
    window.history.replaceState({}, '', `/admin/exam-infrastructure/classrooms/${CLASSROOM_ID}?seat=seat-2`);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(stateFixture())));
    renderPage();

    const offlineSeat = await screen.findByRole('button', { name: /A-02，已绑定 · 离线/ });
    expect(offlineSeat).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /A-01，已绑定 · 在线.*被 1 个活动引用/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /很长的座位显示名称 A-03，未绑定/ })).toBeInTheDocument();
    expect(screen.getByText('布局 r3')).toBeInTheDocument();
    expect(screen.getByText('ONLINE 1')).toBeInTheDocument();
    expect(screen.getByText('OFFLINE 1')).toBeInTheDocument();
  });

  it('uses spatial arrow-key navigation with a single roving tab stop', async () => {
    window.history.replaceState({}, '', `/admin/exam-infrastructure/classrooms/${CLASSROOM_ID}?seat=seat-1`);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(stateFixture())));
    renderPage();

    const first = await screen.findByRole('button', { name: /A-01，已绑定 · 在线/ });
    const second = screen.getByRole('button', { name: /A-02，已绑定 · 离线/ });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });

    expect(second).toHaveFocus();
    expect(second).toHaveAttribute('tabindex', '0');
    expect(first).toHaveAttribute('tabindex', '-1');
    expect(window.location.search).toBe('?seat=seat-2');
  });

  it('keeps a newly generated pairing code in page memory and sends the exact P2.2 CAS identity', async () => {
    window.history.replaceState({}, '', `/admin/exam-infrastructure/classrooms/${CLASSROOM_ID}?seat=seat-3`);
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const openWindow = {
      windowId: '66b800000000000000000720',
      status: 'open',
      revision: 1,
      expiresAt,
      entries: [
        {
          sourceSeatId: 'seat-3',
          mode: 'bind',
          status: 'open',
          revision: 1,
          codeHint: 'EF',
          expectedBindingRevision: 0,
          claimedEndpointId: null,
          claimedAt: null,
          bindingRevision: null,
          completedAt: null,
        },
      ],
      createdAt: '2026-08-11T01:00:00.000Z',
      createdBy: 2,
      closedAt: null,
      closedBy: null,
    };
    const afterOpen = stateFixture({ pairingWindow: openWindow });
    let opened = false;
    let completed = false;
    let failNextReload = false;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          action: 'open',
          expectedRevision: 0,
          replacementSeatIds: [],
          sourceSeatIds: ['seat-3'],
        });
        expect(body.requestId).toMatch(/^seat_window_[a-f0-9]{32}$/);
        expect(body.expiresAt).toEqual(expect.any(String));
        opened = true;
        failNextReload = true;
        return json({ pairingWindow: openWindow, codes: [{ sourceSeatId: 'seat-3', code: '01234567' }] });
      }
      if (failNextReload) {
        failNextReload = false;
        return new Response(
          JSON.stringify({
            error: {
              name: 'ServiceUnavailableError',
              errorCode: 'classroom_state_unavailable',
              code: 503,
              status: 503,
              params: [],
              message: '教室状态暂时无法刷新',
            },
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (completed) {
        return json(
          stateFixture({
            bindings: [...stateFixture().bindings, binding('seat-3', 'ep_newly_bound_003')],
            pairingWindow: {
              ...openWindow,
              revision: 3,
              entries: [
                {
                  ...openWindow.entries[0],
                  status: 'bound',
                  revision: 3,
                  claimedEndpointId: 'ep_newly_bound_003',
                  claimedAt: '2026-08-11T01:01:00.000Z',
                  bindingRevision: 1,
                  completedAt: '2026-08-11T01:01:01.000Z',
                },
              ],
            },
            endpointPreflight: {
              state: 'available',
              items: [
                ...stateFixture().endpointPreflight.items,
                {
                  endpointId: 'ep_newly_bound_003',
                  ready: true,
                  reason: 'ready',
                  credentialStatus: 'active',
                  online: true,
                  compatible: true,
                  serviceVersion: '0.4.0',
                  protocolVersion: 2,
                },
              ],
            },
          }),
        );
      }
      return json(opened ? afterOpen : stateFixture());
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '为此座位生成配对码' }));

    expect(await screen.findByText('0123-4567')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('教室状态暂时无法刷新');
    expect(fetchMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === 'POST')).toHaveLength(1);

    completed = true;
    await user.click(screen.getByRole('button', { name: '刷新状态' }));
    expect(await screen.findByRole('button', { name: '撤销刚完成的绑定' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '定位最近响应' })).toBeInTheDocument();
  });

  it('labels bound seats as unknown instead of offline when Vigil is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(
          stateFixture({
            endpointPreflight: { state: 'unavailable', items: [] },
          }),
        ),
      ),
    );
    renderPage();

    expect(await screen.findByRole('status')).toHaveTextContent('不会伪装成离线');
    expect(screen.getByRole('button', { name: /A-01，状态未知/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /A-02，状态未知/ })).toBeInTheDocument();
  });

  it('does not offer local undo for a replacement or an external new binding', async () => {
    const replacement = binding('seat-1', 'ep_replaced_000001', 2);
    const external = binding('seat-3', 'ep_external_0000003');
    let reads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        reads += 1;
        return json(
          reads === 1
            ? stateFixture()
            : stateFixture({
                bindings: [replacement, binding('seat-2', 'ep_offline_0000002')],
                endpointPreflight: {
                  state: 'available',
                  items: [
                    {
                      endpointId: 'ep_replaced_000001',
                      ready: true,
                      reason: 'ready',
                      credentialStatus: 'active',
                      online: true,
                      compatible: true,
                      serviceVersion: '0.4.0',
                      protocolVersion: 2,
                    },
                  ],
                },
              }),
        );
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '刷新状态' }));
    expect(await screen.findAllByText('ep_replaced_000001')).not.toHaveLength(0);

    expect(screen.queryByRole('button', { name: '撤销刚完成的绑定' })).not.toBeInTheDocument();

    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        stateFixture({
          bindings: [replacement, binding('seat-2', 'ep_offline_0000002'), external],
          endpointPreflight: { state: 'unavailable', items: [] },
        }),
      ),
    );
    await user.click(screen.getByRole('button', { name: '刷新状态' }));
    expect(await screen.findAllByText('ep_external_0000003')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: '撤销刚完成的绑定' })).not.toBeInTheDocument();
  });

  it('renders a dense 500-seat classroom from one aggregated state request', async () => {
    const seats = Array.from({ length: 500 }, (_, index) => seat(`seat-${index + 1}`, `S-${index + 1}`, index % 25, Math.floor(index / 25)));
    const fetchMock = vi.fn().mockResolvedValue(
      json(
        stateFixture({
          classroom: {
            classroomId: CLASSROOM_ID,
            schoolId: SCHOOL_ID,
            name: '500 座压力教室',
            layoutRevision: 1,
            layout: {
              schemaVersion: 1,
              sourceFormat: 'legacy-grid-v1',
              coordinateSystem: 'grid',
              rows: 20,
              cols: 25,
              fingerprint: 'b'.repeat(64),
              seats,
              decorations: [],
            },
          },
          bindings: [],
          references: [],
          endpointPreflight: { state: 'not-required', items: [] },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderPage();

    await waitFor(() => expect(container.querySelectorAll('[data-seat-id]')).toHaveLength(500));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('UNBOUND 500')).toBeInTheDocument();
  });
});
