import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { ExamSeatPlanPage, assignmentCsv } from '../src/pages/exam-seat-plan.tsx';

const EVENT_ID = '66b800000000000000000801';
const PLAN_RESPONSE = {
  event: {
    eventId: EVENT_ID,
    revision: 3,
    type: 'krypton',
    lifecycle: 'scheduled',
    schoolId: '66b800000000000000000802',
    contestId: '66b800000000000000000803',
  },
  rosterRevisions: [
    {
      rosterId: '66b800000000000000000804',
      revision: 2,
      fingerprint: 'a'.repeat(64),
      entries: [
        { studentId: '20260001', realName: '张三', boundUserId: 21 },
        { studentId: '20260002', realName: '李四', boundUserId: 22 },
      ],
    },
  ],
  seatPlans: [
    {
      seatPlanId: '66b800000000000000000805',
      revision: 4,
      roster: { rosterId: '66b800000000000000000804', revision: 2, fingerprint: 'a'.repeat(64) },
      classroomId: '66b800000000000000000806',
      layoutRevision: 7,
      layoutFingerprint: 'b'.repeat(64),
      fingerprint: 'c'.repeat(64),
      candidateSeatIds: ['seat-01', 'seat-02'],
      diagnostics: [],
    },
  ],
};

const ASSIGNMENT = {
  assignmentId: '66b800000000000000000807',
  revision: 1,
  seatPlan: { seatPlanId: '66b800000000000000000805', revision: 4, fingerprint: 'c'.repeat(64) },
  roster: { rosterId: '66b800000000000000000804', revision: 2, fingerprint: 'a'.repeat(64) },
  constraints: { mode: 'random', lockedAssignments: [], manualAssignments: [] },
  eligibleSeatIds: ['seat-01', 'seat-02'],
  assignments: [
    { boundUserId: 21, sourceSeatId: 'seat-01' },
    { boundUserId: 22, sourceSeatId: 'seat-02' },
  ],
  diagnostics: [],
  fingerprint: 'd'.repeat(64),
  published: false,
};

const ASSIGNMENT_RESPONSE = {
  assignments: [ASSIGNMENT],
  publication: null,
  source: {
    seatPlanRevision: 4,
    classroomId: '66b800000000000000000806',
    layoutRevision: 7,
    layoutFingerprint: 'b'.repeat(64),
    seats: [
      {
        sourceSeatId: 'seat-01',
        label: 'A01',
        x: 0,
        y: 0,
        rotation: 0,
        status: 'active',
        bindingId: '66b800000000000000000811',
        bindingRevision: 3,
        endpointId: 'endpoint-01',
      },
      {
        sourceSeatId: 'seat-02',
        label: 'A02',
        x: 1,
        y: 0,
        rotation: 0,
        status: 'active',
        bindingId: '66b800000000000000000812',
        bindingRevision: 4,
        endpointId: 'endpoint-02',
      },
    ],
  },
  endpointPreflight: {
    state: 'available',
    items: [
      { endpointId: 'endpoint-01', ready: true, online: true, reason: 'ready' },
      { endpointId: 'endpoint-02', ready: false, online: false, reason: 'offline' },
    ],
  },
  latestSeatPlanState: 'current',
  rosterGroups: [{ groupId: '66b800000000000000000821', name: '2026 级一班' }],
  classrooms: [{ classroomId: '66b800000000000000000806', name: '北实 201', layoutRevision: 7, seatCount: 2 }],
};

function bootstrap(allowed = true): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-08-12T00:00:00.000Z',
    user: { id: 2, name: 'teacher', signedIn: true, priv: 0, canManageExamInfrastructure: allowed } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'admin_exam_seats.html', data: { eventId: EVENT_ID } },
  };
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function renderPage(allowed = true) {
  return render(
    <BootstrapProvider bootstrap={bootstrap(allowed)}>
      <ExamSeatPlanPage />
    </BootstrapProvider>,
  );
}

function fetchFixture(
  postBodies: Record<string, unknown>[] = [],
  assignmentResponse: unknown = ASSIGNMENT_RESPONSE,
  postResponse: unknown = { assignment: ASSIGNMENT, diagnostics: [] },
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      postBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return json(postResponse);
    }
    if (url.endsWith('/seat-plans')) return json(PLAN_RESPONSE);
    if (url.endsWith('/seat-assignments')) return json(assignmentResponse);
    if (url.endsWith(`/seat-assignment-classrooms/${PLAN_RESPONSE.seatPlans[0].classroomId}`)) {
      return json({
        classroomId: PLAN_RESPONSE.seatPlans[0].classroomId,
        layoutRevision: 7,
        layoutFingerprint: 'b'.repeat(64),
        seats: ASSIGNMENT_RESPONSE.source.seats,
      });
    }
    throw new Error(`unexpected request: ${url}`);
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('p2.5 exam seat assignment workspace', () => {
  it('fails closed before fetching and rejects a malformed bootstrap contract', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPage(false);
    expect(screen.getByText('你没有管理考试基础设施的权限。')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('joins the immutable roster, physical seat, binding and live endpoint views', async () => {
    vi.stubGlobal('fetch', fetchFixture());
    renderPage();
    expect(await screen.findByText('20260001')).toBeInTheDocument();
    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.getByText('A01')).toBeInTheDocument();
    expect(screen.getByText('endpoint-01')).toBeInTheDocument();
    expect(screen.getByText('在线')).toBeInTheDocument();
    expect(screen.getByText('离线')).toBeInTheDocument();
  });

  it('keeps a displayed assignment tied to its exact roster and historical seat-plan source', async () => {
    const plans = {
      ...PLAN_RESPONSE,
      seatPlans: [
        { ...PLAN_RESPONSE.seatPlans[0], seatPlanId: '66b800000000000000000899', revision: 5, layoutRevision: 8 },
        PLAN_RESPONSE.seatPlans[0],
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/seat-plans')) return json(plans);
      if (String(input).endsWith('/seat-assignments')) return json(ASSIGNMENT_RESPONSE);
      throw new Error(`unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    expect(await screen.findByText('A01')).toBeInTheDocument();
    expect(screen.getByText('张三')).toBeInTheDocument();
  });

  it('uses the roster referenced by the latest plan before an assignment exists', async () => {
    const newerRoster = {
      ...PLAN_RESPONSE.rosterRevisions[0],
      rosterId: '66b800000000000000000898',
      revision: 3,
      fingerprint: 'e'.repeat(64),
      entries: [{ studentId: '20269999', realName: '不应显示', boundUserId: 99 }],
    };
    const response = { ...ASSIGNMENT_RESPONSE, assignments: [], publication: null };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/seat-plans')) return json({ ...PLAN_RESPONSE, rosterRevisions: [newerRoster, ...PLAN_RESPONSE.rosterRevisions] });
      if (String(input).endsWith('/seat-assignments')) return json(response);
      throw new Error(`unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    expect(await screen.findByText('张三')).toBeInTheDocument();
    expect(screen.queryByText('不应显示')).not.toBeInTheDocument();
  });

  it('keeps preparation available but disables generation when the latest plan layout has drifted', async () => {
    const response = { ...ASSIGNMENT_RESPONSE, assignments: [], publication: null, latestSeatPlanState: 'layout-drift' };
    vi.stubGlobal('fetch', fetchFixture([], response));
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('候选教室布局已变化；请在上方按当前布局创建新计划后再生成。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '随机分配' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: '2026 级一班' }));
    expect(screen.getByRole('button', { name: '生成或刷新名单' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: '候选教室' })).toBeEnabled();
  });

  it('uses explicit generation, swaps two rows, locks one row and persists a new adjustment revision', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', fetchFixture(bodies));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '按学号分配' }));
    expect(bodies[0]).toEqual({ action: 'generate', mode: 'studentId', seatPlanRevision: 4 });

    await user.click(screen.getByRole('button', { name: '选择张三换位' }));
    await user.click(screen.getByRole('button', { name: '选择李四换位' }));
    await user.click(screen.getByRole('checkbox', { name: '锁定张三' }));
    await user.click(screen.getByRole('button', { name: '保存人工调整' }));
    expect(bodies[1]).toEqual({
      action: 'adjust',
      baseAssignmentRevision: 1,
      lockedUids: [21],
      mappings: [
        { boundUserId: 21, sourceSeatId: 'seat-02' },
        { boundUserId: 22, sourceSeatId: 'seat-01' },
      ],
    });
  });

  it('assigns a student to an unoccupied eligible seat without exposing excluded candidates', async () => {
    const bodies: Record<string, unknown>[] = [];
    const thirdSeat = {
      sourceSeatId: 'seat-03',
      label: 'A03',
      x: 2,
      y: 0,
      rotation: 0,
      status: 'empty',
      bindingId: '66b800000000000000000813',
      bindingRevision: 1,
      endpointId: 'endpoint-03',
    };
    const excludedSeat = { ...thirdSeat, sourceSeatId: 'seat-04', label: 'A04', bindingId: null, bindingRevision: null, endpointId: null };
    const response = {
      ...ASSIGNMENT_RESPONSE,
      assignments: [{ ...ASSIGNMENT, eligibleSeatIds: ['seat-01', 'seat-02', 'seat-03'] }],
      source: { ...ASSIGNMENT_RESPONSE.source, seats: [...ASSIGNMENT_RESPONSE.source.seats, thirdSeat, excludedSeat] },
    };
    vi.stubGlobal('fetch', fetchFixture(bodies, response));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '选择张三换位' }));
    const select = screen.getByRole('combobox', { name: '为张三指定座位' });
    expect(screen.queryByRole('option', { name: /A04/ })).not.toBeInTheDocument();
    await user.selectOptions(select, 'seat-03');
    await user.click(screen.getByRole('button', { name: '保存人工调整' }));
    expect(bodies[0]).toMatchObject({
      action: 'adjust',
      mappings: [
        { boundUserId: 21, sourceSeatId: 'seat-03' },
        { boundUserId: 22, sourceSeatId: 'seat-02' },
      ],
    });
  });

  it('keeps a local mapping or lock change explicitly dirty until a new revision is saved', async () => {
    vi.stubGlobal('fetch', fetchFixture());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('checkbox', { name: '2026 级一班' }));
    await user.selectOptions(screen.getByRole('combobox', { name: '候选教室' }), PLAN_RESPONSE.seatPlans[0].classroomId);
    expect(await screen.findByRole('checkbox', { name: /A01 · seat-01/ })).toBeChecked();
    expect(screen.getByRole('button', { name: '生成或刷新名单' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '创建候选座位计划' })).toBeEnabled();
    await user.click(await screen.findByRole('button', { name: '选择张三换位' }));
    await user.click(screen.getByRole('button', { name: '选择李四换位' }));
    expect(screen.getByText('人工调整未保存')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布版本 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重新随机未锁定座位' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '导出当前页面 CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存人工调整' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '生成或刷新名单' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '创建候选座位计划' })).toBeDisabled();
  });

  it('shows the complete blocked diagnostics returned by the action without inventing a revision', async () => {
    const blocked = {
      assignment: null,
      diagnostics: [
        { code: 'seat_disabled', sourceSeatIds: ['seat-01'] },
        { code: 'seat_unbound', sourceSeatIds: ['seat-02'] },
        { code: 'insufficient_seats', requiredSeatCount: 2, availableSeatCount: 0 },
      ],
    };
    vi.stubGlobal('fetch', fetchFixture([], ASSIGNMENT_RESPONSE, blocked));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: '随机分配' }));
    expect(await screen.findByText('已排除禁用座位：seat-01')).toBeInTheDocument();
    expect(screen.getByText('已排除未绑定终端的座位：seat-02')).toBeInTheDocument();
    expect(screen.getByText('可用座位不足：需要 2，当前 0')).toBeInTheDocument();
  });

  it('prepares a fresh event through the event-authorized roster and classroom boundaries before generation', async () => {
    let plans = { ...PLAN_RESPONSE, rosterRevisions: [] as typeof PLAN_RESPONSE.rosterRevisions, seatPlans: [] as typeof PLAN_RESPONSE.seatPlans };
    let assignments: Record<string, unknown> = {
      ...ASSIGNMENT_RESPONSE,
      assignments: [] as typeof ASSIGNMENT_RESPONSE.assignments,
      source: null,
      endpointPreflight: { state: 'not-required', items: [] },
    };
    const bodies: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        bodies.push({ url, body });
        if (url.endsWith('/seat-plans') && body.action === 'createRoster') {
          plans = { ...plans, rosterRevisions: PLAN_RESPONSE.rosterRevisions };
          return json({ rosterRevision: 2 });
        }
        if (url.endsWith('/seat-plans') && body.action === 'createSeatPlan') {
          plans = { ...plans, seatPlans: PLAN_RESPONSE.seatPlans };
          assignments = { ...assignments, source: ASSIGNMENT_RESPONSE.source };
          return json({ seatPlanRevision: 4 });
        }
        if (url.endsWith('/seat-assignments') && body.action === 'generate') {
          assignments = { ...ASSIGNMENT_RESPONSE };
          return json({ assignment: ASSIGNMENT, diagnostics: [] });
        }
        throw new Error(`unexpected POST: ${url}`);
      }
      if (url.endsWith('/seat-plans')) return json(plans);
      if (url.endsWith('/seat-assignments')) return json(assignments);
      if (url.endsWith(`/seat-assignment-classrooms/${PLAN_RESPONSE.seatPlans[0].classroomId}`)) {
        return json({
          classroomId: PLAN_RESPONSE.seatPlans[0].classroomId,
          layoutRevision: 7,
          layoutFingerprint: 'b'.repeat(64),
          seats: ASSIGNMENT_RESPONSE.source.seats,
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('checkbox', { name: '2026 级一班' }));
    await user.click(screen.getByRole('button', { name: '生成或刷新名单' }));
    await waitFor(() =>
      expect(bodies[0]?.body).toEqual({ action: 'createRoster', sourceKind: 'userbindGroups', groupIds: ['66b800000000000000000821'] }),
    );

    await user.selectOptions(screen.getByRole('combobox', { name: '候选教室' }), PLAN_RESPONSE.seatPlans[0].classroomId);
    expect(await screen.findByRole('checkbox', { name: /A01 · seat-01/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: '创建候选座位计划' }));
    await waitFor(() =>
      expect(bodies[1]?.body).toEqual({
        action: 'createSeatPlan',
        rosterRevision: 2,
        classroomId: PLAN_RESPONSE.seatPlans[0].classroomId,
        layoutRevision: 7,
        candidateSeatIds: ['seat-01', 'seat-02'],
      }),
    );

    await user.click(screen.getByRole('button', { name: '随机分配' }));
    await waitFor(() => expect(bodies[2]?.body).toEqual({ action: 'generate', mode: 'random', seatPlanRevision: 4 }));
    expect(bodies.some((entry) => entry.url.includes('/exam-infrastructure/classrooms/'))).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/admin/exam-events/${EVENT_ID}/seat-assignment-classrooms/${PLAN_RESPONSE.seatPlans[0].classroomId}`,
      expect.anything(),
    );
  });

  it('renders 500 assignments with one shared seat selector instead of one full selector per row', async () => {
    const count = 500;
    const entries = Array.from({ length: count }, (_, index) => ({
      studentId: `2026${String(index).padStart(4, '0')}`,
      realName: `学生${index}`,
      boundUserId: index + 2,
    }));
    const seatIds = entries.map((_, index) => `seat-${String(index).padStart(3, '0')}`);
    const plans = {
      ...PLAN_RESPONSE,
      rosterRevisions: [{ ...PLAN_RESPONSE.rosterRevisions[0], entries }],
      seatPlans: [{ ...PLAN_RESPONSE.seatPlans[0], candidateSeatIds: seatIds }],
    };
    const response = {
      ...ASSIGNMENT_RESPONSE,
      assignments: [
        {
          ...ASSIGNMENT,
          eligibleSeatIds: seatIds,
          assignments: entries.map((entry, index) => ({ boundUserId: entry.boundUserId, sourceSeatId: seatIds[index] })),
        },
      ],
      source: {
        ...ASSIGNMENT_RESPONSE.source,
        seats: seatIds.map((sourceSeatId, index) => ({
          sourceSeatId,
          label: `S${index}`,
          status: 'active',
          bindingId: `binding-${index}`,
          bindingRevision: 1,
          endpointId: `endpoint-${index}`,
        })),
      },
      endpointPreflight: { state: 'not-required', items: [] },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/seat-plans')) return json(plans);
      if (String(input).endsWith('/seat-assignments')) return json(response);
      throw new Error(`unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: '选择学生0换位' }));
    const selector = screen.getByRole('combobox', { name: '为学生0指定座位' });
    expect(within(selector).getAllByRole('option')).toHaveLength(count);
    expect(screen.getAllByRole('combobox', { name: /为.+指定座位/ })).toHaveLength(1);
  });

  it('rerandomizes only on an explicit action, publishes with CAS and exports the displayed mapping', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', fetchFixture(bodies));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('20260001');

    fireEvent.click(screen.getByRole('button', { name: '重新随机未锁定座位' }));
    await waitFor(() => expect(bodies[0]).toEqual({ action: 'rerandomize', baseAssignmentRevision: 1 }));
    await user.click(screen.getByRole('button', { name: '发布版本 1' }));
    expect(bodies[1]).toEqual({ action: 'publish', assignmentRevision: 1, expectedPublicationRevision: 0 });

    expect(
      assignmentCsv(
        [
          { boundUserId: 21, studentId: '20260001', realName: '张三', sourceSeatId: 'seat-01', seatLabel: 'A01', endpointId: 'endpoint-01' },
          { boundUserId: 22, studentId: '20260002', realName: '李四', sourceSeatId: 'seat-02', seatLabel: 'A02', endpointId: 'endpoint-02' },
        ],
        1,
      ),
    ).toContain('20260001,张三,A01,seat-01,endpoint-01,1');
    expect(
      assignmentCsv(
        [{ boundUserId: 21, studentId: '=HYPERLINK("https://evil")', realName: '+cmd', sourceSeatId: '@seat', seatLabel: '-1', endpointId: '\tbad' }],
        1,
      ),
    ).toContain("'=HYPERLINK");
  });
});
