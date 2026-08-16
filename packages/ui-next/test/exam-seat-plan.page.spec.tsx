import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { ExamSeatPlanPage, assignmentCsv, assignmentCsvV2 } from '../src/pages/exam-seat-plan.tsx';

const EVENT_ID = '66b800000000000000000801';
const objectIdFromIndex = (index: number) => index.toString(16).padStart(24, '0');
const PLAN_RESPONSE = {
  event: {
    eventId: EVENT_ID,
    revision: 3,
    type: 'krypton',
    contestAudienceState: 'fixed',
    lifecycle: 'scheduled',
    schoolId: '66b800000000000000000802',
    contestId: '66b800000000000000000803',
    startAt: '2026-08-14T01:00:00.000Z',
    endAt: '2026-08-14T03:00:00.000Z',
  },
  rosterRevisions: [
    {
      rosterId: '66b800000000000000000804',
      revision: 2,
      fingerprint: 'a'.repeat(64),
      source: { kind: 'contestAudience' },
      entries: [
        { studentId: '20260001', realName: '张三', boundUserId: 21 },
        { studentId: '20260002', realName: '李四', boundUserId: 22 },
      ],
    },
  ],
  seatPlans: [
    {
      schemaVersion: 1,
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
  schemaVersion: 1,
  assignmentId: '66b800000000000000000807',
  revision: 1,
  seatPlan: { seatPlanId: '66b800000000000000000805', revision: 4, fingerprint: 'c'.repeat(64) },
  roster: { rosterId: '66b800000000000000000804', revision: 2, fingerprint: 'a'.repeat(64) },
  classroomId: '66b800000000000000000806',
  layoutRevision: 7,
  layoutFingerprint: 'b'.repeat(64),
  candidateSeatIds: ['seat-01', 'seat-02'],
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
    schemaVersion: 1,
    seatPlanRevision: 4,
    classroomId: '66b800000000000000000806',
    layoutRevision: 7,
    layoutFingerprint: 'b'.repeat(64),
    seats: [
      {
        classroomId: '66b800000000000000000806',
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
        classroomId: '66b800000000000000000806',
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
  publishedRosterDrift: null,
  latestSeatPlanState: 'current',
  rosterGroups: [{ groupId: '66b800000000000000000821', name: '2026 级一班' }],
  classrooms: [{ classroomId: '66b800000000000000000806', name: '北实 201', layoutRevision: 7, seatCount: 2 }],
};

const PUBLISHED_ASSIGNMENT = { ...ASSIGNMENT, published: true };
const PUBLISHED_ASSIGNMENT_RESPONSE = {
  ...ASSIGNMENT_RESPONSE,
  assignments: [PUBLISHED_ASSIGNMENT],
  publication: {
    revision: 3,
    assignmentId: PUBLISHED_ASSIGNMENT.assignmentId,
    assignmentRevision: PUBLISHED_ASSIGNMENT.revision,
    assignmentFingerprint: PUBLISHED_ASSIGNMENT.fingerprint,
    updatedAt: '2026-08-13T01:00:00.000Z',
    updatedBy: 2,
  },
};

function preloginPreparation(count = 2) {
  return {
    schemaVersion: 1,
    domainId: 'system',
    eventId: EVENT_ID,
    eventRevision: 3,
    assignment: { assignmentId: PUBLISHED_ASSIGNMENT.assignmentId, revision: 1, fingerprint: PUBLISHED_ASSIGNMENT.fingerprint },
    publicationRevision: 3,
    workspace: { kind: 'contest', contestId: PLAN_RESPONSE.event.contestId, path: `/exam-mode/${PLAN_RESPONSE.event.contestId}` },
    items: Array.from({ length: count }, (_, index) => ({
      uid: index + 21,
      studentRecordId: objectIdFromIndex(0x830 + index),
      sourceSeatId: `seat-${String(index + 1).padStart(2, '0')}`,
      bindingId: objectIdFromIndex(0x840 + index),
      bindingRevision: index + 3,
      endpointId: `endpoint-${String(index + 1).padStart(2, '0')}`,
      ready: true,
      diagnostics: [],
      endpoint: {
        online: true,
        serviceVersion: '0.5.0',
        protocolVersion: 2,
        capabilities: [{ name: 'exam.prelogin', version: 1, commands: ['launch_prelogin'] }],
        activeSessionId: null,
      },
    })),
    hardErrorCount: 0,
    warningCount: 0,
    fingerprint: 'e'.repeat(64),
  };
}

function preloginWorkflow(count = 2, source: 'config' | 'execution' = 'execution') {
  const networkReady = source === 'execution';
  return {
    schemaVersion: 1,
    network: {
      source,
      configRevision: source === 'config' ? 6 : null,
      executionRevision: source === 'config' ? 0 : 7,
      policy: { id: '66b800000000000000000851', revision: 2, fingerprint: '1'.repeat(64) },
      target: { id: '66b800000000000000000852', revision: 4, fingerprint: '2'.repeat(64) },
      targetCount: count,
      startAt: PLAN_RESPONSE.event.startAt,
      hardEndAt: PLAN_RESPONSE.event.endAt,
      ready: networkReady,
      reason: networkReady ? 'ready' : 'network_execution_not_active',
      appliedCount: networkReady ? count : 0,
      failedCount: 0,
      pendingCount: networkReady ? 0 : count,
      preloginEndpointCount: count,
      coveredPreloginCount: count,
      missingPreloginEndpointIds: [],
    },
    monitoring: {
      ready: true,
      items: Array.from({ length: count }, (_, index) => ({
        endpointId: `endpoint-${String(index + 1).padStart(2, '0')}`,
        ready: true,
        reason: 'ready',
        credentialStatus: 'active',
        online: true,
        compatible: true,
        serviceVersion: '0.5.0',
        protocolVersion: 2,
        capabilities: [{ name: 'exam.monitoring', version: 1, commands: ['start_monitoring', 'stop_monitoring', 'get_monitoring_status'] }],
        warnings: index === 0 ? [{ kind: 'usb_storage_detected', detector: null, reason: null }] : [],
      })),
    },
    hardErrorCount: networkReady ? 0 : 1,
    warningCount: 1,
    fingerprint: 'f'.repeat(64),
  };
}

function preloginBatch(statuses: Array<{ status: string; stage: string }>) {
  const batchId = '66b800000000000000000860';
  const subjects = statuses.map((_, index) => ({
    ticketId: objectIdFromIndex(0x870 + index),
    uid: index + 21,
    studentRecordId: objectIdFromIndex(0x830 + index),
    sourceSeatId: `seat-${String(index + 1).padStart(2, '0')}`,
    bindingId: objectIdFromIndex(0x840 + index),
    bindingRevision: index + 3,
    endpointId: `endpoint-${String(index + 1).padStart(2, '0')}`,
    expiresAt: '2026-08-14T00:30:00.000Z',
    state: 'issued',
    redeemedAt: null,
  }));
  const items = statuses.map((status, index) => ({
    ticketId: subjects[index].ticketId,
    endpointId: subjects[index].endpointId,
    commandId: `prelogin_command_${index}`,
    status: status.status,
    stage: status.stage,
    failureReason: status.status === 'failed' ? 'process_launch_failed' : null,
  }));
  return {
    batchId,
    eventId: EVENT_ID,
    eventRevision: 3,
    assignment: { assignmentId: PUBLISHED_ASSIGNMENT.assignmentId, revision: 1, fingerprint: PUBLISHED_ASSIGNMENT.fingerprint },
    publicationRevision: 3,
    requestId: '11111111-1111-4111-8111-111111111111',
    preparationFingerprint: 'e'.repeat(64),
    workflow: {
      fingerprint: 'f'.repeat(64),
      executionRevision: 7,
      policy: { id: '66b800000000000000000851', revision: 2, fingerprint: '1'.repeat(64) },
      target: { id: '66b800000000000000000852', revision: 4, fingerprint: '2'.repeat(64) },
      targetCount: statuses.length,
      startAt: PLAN_RESPONSE.event.startAt,
      hardEndAt: PLAN_RESPONSE.event.endAt,
    },
    state: 'dispatched',
    revision: 2,
    ticketCount: subjects.length,
    subjects,
    projection: {
      requestId: '11111111-1111-4111-8111-111111111111',
      batchId,
      dispatchStatus: 'complete',
      projectionRevision: 1,
      summary: {},
      items,
    },
    retryableTicketIds: items.filter((item) => ['expired', 'failed', 'offline', 'rejected'].includes(item.status)).map((item) => item.ticketId),
    createdAt: '2026-08-13T01:00:00.000Z',
    updatedAt: '2026-08-13T01:00:01.000Z',
    fingerprint: '3'.repeat(64),
  };
}

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
    page: { templateName: 'admin_exam_seats.html', data: { eventId: EVENT_ID, canManage: allowed } },
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
    if (url.endsWith('/prelogin-latest')) return json({ batch: null });
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

function singleClassroomV2Fixture(extraSeat = false) {
  const classroomId = PLAN_RESPONSE.seatPlans[0].classroomId;
  const candidateSeatIds = extraSeat ? ['seat-01', 'seat-02', 'seat-03'] : ['seat-01', 'seat-02'];
  const classroom = {
    classroomId,
    layoutRevision: 7,
    layoutFingerprint: 'b'.repeat(64),
    profileRevision: 1,
    profileFingerprint: 'e'.repeat(64),
    candidateSeatIds,
  };
  const seatFacts = candidateSeatIds.map((sourceSeatId, index) => ({
    classroomId,
    sourceSeatId,
    label: `A0${index + 1}`,
    x: index,
    y: 0,
    width: 1,
    height: 1,
    rotation: 0,
    layoutStatus: index === 2 ? 'empty' : 'active',
    enabled: true,
    facing: index === 0 ? ('right' as const) : ('left' as const),
    disabledReason: null,
    bindingId: objectIdFromIndex(0x8d0 + index),
    bindingRevision: 1,
    endpointId: `endpoint-v2-${index + 1}`,
    endpointOnline: true,
  }));
  const v2Plan = {
    schemaVersion: 2 as const,
    seatPlanId: '66b800000000000000000955',
    revision: 5,
    roster: PLAN_RESPONSE.seatPlans[0].roster,
    classrooms: [classroom],
    fingerprint: '8'.repeat(64),
    diagnostics: [],
  };
  const v2Assignment = {
    schemaVersion: 2 as const,
    assignmentId: '66b800000000000000000957',
    revision: 2,
    seatPlan: { seatPlanId: v2Plan.seatPlanId, revision: v2Plan.revision, fingerprint: v2Plan.fingerprint },
    roster: PLAN_RESPONSE.seatPlans[0].roster,
    classrooms: [classroom],
    participants: PLAN_RESPONSE.rosterRevisions[0].entries.map((entry, index) => ({
      boundUserId: entry.boundUserId,
      studentRecordId: objectIdFromIndex(0x8e0 + index),
      studentId: entry.studentId,
      teamId: null,
      teamRole: null,
    })),
    seatFacts,
    constraints: { strategy: 'maximizeSpacing' as const, lockedAssignments: [], manualAssignments: [] },
    assignments: PLAN_RESPONSE.rosterRevisions[0].entries.map((entry, index) => ({
      boundUserId: entry.boundUserId,
      seat: { classroomId, sourceSeatId: candidateSeatIds[index] },
    })),
    explanation: {
      classrooms: [{ classroomId, assignedCount: 2, eligibleSeatCount: candidateSeatIds.length }],
      highRiskEdges: [],
      mediumRiskEdges: [],
      splitTeamIds: [],
      skippedSeats: [],
      offlineSeats: [],
      unsetFacingSeats: [],
    },
    fingerprint: '9'.repeat(64),
    published: false,
  };
  const planResponse = { ...PLAN_RESPONSE, seatPlans: [v2Plan] };
  const assignmentResponse = {
    ...ASSIGNMENT_RESPONSE,
    assignments: [v2Assignment],
    source: {
      schemaVersion: 2,
      seatPlanRevision: v2Plan.revision,
      seats: seatFacts.map((seat) => ({
        classroomId: seat.classroomId,
        sourceSeatId: seat.sourceSeatId,
        label: seat.label,
        status: seat.layoutStatus,
        bindingId: seat.bindingId,
        bindingRevision: seat.bindingRevision,
        endpointId: seat.endpointId,
      })),
    },
    endpointPreflight: {
      state: 'available',
      items: seatFacts.map((seat) => ({ endpointId: seat.endpointId, ready: true, online: true, reason: 'ready' })),
    },
  };
  return { assignmentResponse, planResponse, seatFacts, v2Assignment, v2Plan };
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('p2.5 exam seat assignment workspace', () => {
  it('fails closed before fetching and rejects a malformed bootstrap contract', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPage(false);
    expect(screen.getByText('你没有管理此考试活动的权限。')).toBeInTheDocument();
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

  it('operates a cross-classroom v2 revision without colliding identical source seat ids or reopening v1 mutations', async () => {
    const user = userEvent.setup();
    const postBodies: Record<string, unknown>[] = [];
    const firstClassroomId = '66b800000000000000000806';
    const secondClassroomId = '66b800000000000000000816';
    const classrooms = [firstClassroomId, secondClassroomId].map((classroomId, index) => ({
      classroomId,
      layoutRevision: 7 + index,
      layoutFingerprint: String(index + 1).repeat(64),
      profileRevision: 1,
      profileFingerprint: String(index + 3).repeat(64),
      candidateSeatIds: ['shared-seat'],
    }));
    const seatFacts = classrooms.map((classroom, index) => ({
      classroomId: classroom.classroomId,
      sourceSeatId: 'shared-seat',
      label: index === 0 ? 'A-shared' : 'B-shared',
      x: index,
      y: 0,
      width: null,
      height: null,
      rotation: 0,
      layoutStatus: 'active',
      enabled: true,
      facing: index === 0 ? 'right' : 'unset',
      disabledReason: null,
      bindingId: objectIdFromIndex(0x8a0 + index),
      bindingRevision: index + 1,
      endpointId: `endpoint-v2-${index + 1}`,
      endpointOnline: index === 0 ? true : null,
    }));
    const v2Plan = {
      schemaVersion: 2,
      seatPlanId: '66b800000000000000000905',
      revision: 5,
      roster: PLAN_RESPONSE.seatPlans[0].roster,
      classrooms,
      fingerprint: '8'.repeat(64),
      diagnostics: [],
    };
    const v2Assignment = {
      schemaVersion: 2,
      assignmentId: '66b800000000000000000907',
      revision: 2,
      seatPlan: { seatPlanId: v2Plan.seatPlanId, revision: v2Plan.revision, fingerprint: v2Plan.fingerprint },
      roster: PLAN_RESPONSE.seatPlans[0].roster,
      classrooms,
      participants: PLAN_RESPONSE.rosterRevisions[0].entries.map((entry, index) => ({
        boundUserId: entry.boundUserId,
        studentRecordId: objectIdFromIndex(0x8b0 + index),
        studentId: entry.studentId,
        teamId: null,
        teamRole: null,
      })),
      seatFacts,
      constraints: { strategy: 'maximizeSpacing', lockedAssignments: [], manualAssignments: [] },
      assignments: PLAN_RESPONSE.rosterRevisions[0].entries.map((entry, index) => ({
        boundUserId: entry.boundUserId,
        seat: { classroomId: classrooms[index].classroomId, sourceSeatId: 'shared-seat' },
      })),
      explanation: {
        classrooms: classrooms.map((classroom) => ({ classroomId: classroom.classroomId, assignedCount: 1, eligibleSeatCount: 1 })),
        highRiskEdges: [],
        mediumRiskEdges: [],
        splitTeamIds: [],
        skippedSeats: [],
        offlineSeats: [{ classroomId: secondClassroomId, sourceSeatId: 'shared-seat' }],
        unsetFacingSeats: [{ classroomId: secondClassroomId, sourceSeatId: 'shared-seat' }],
      },
      fingerprint: '9'.repeat(64),
      published: true,
    };
    const plans = { ...PLAN_RESPONSE, seatPlans: [v2Plan] };
    const assignments = {
      ...ASSIGNMENT_RESPONSE,
      assignments: [v2Assignment],
      classrooms: [
        { classroomId: firstClassroomId, name: '同名教室', layoutRevision: 7, seatCount: 1 },
        { classroomId: secondClassroomId, name: '同名教室', layoutRevision: 8, seatCount: 1 },
      ],
      publication: {
        revision: 4,
        assignmentId: v2Assignment.assignmentId,
        assignmentRevision: v2Assignment.revision,
        assignmentFingerprint: v2Assignment.fingerprint,
      },
      source: {
        schemaVersion: 2,
        seatPlanRevision: v2Plan.revision,
        seats: seatFacts.map((seat) => ({
          classroomId: seat.classroomId,
          sourceSeatId: seat.sourceSeatId,
          label: seat.label,
          status: seat.layoutStatus,
          bindingId: seat.bindingId,
          bindingRevision: seat.bindingRevision,
          endpointId: seat.endpointId,
        })),
      },
      endpointPreflight: {
        state: 'available',
        items: seatFacts.map((seat) => ({ endpointId: seat.endpointId, ready: true, online: true, reason: 'ready' })),
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          postBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return json({ assignment: v2Assignment, diagnostics: [] });
        }
        if (url.endsWith('/seat-plans')) return json(plans);
        if (url.endsWith('/seat-assignments')) return json(assignments);
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    renderPage();

    expect(await screen.findByText('A-shared')).toBeInTheDocument();
    expect(screen.getByText('B-shared')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /选择.*换位/ })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '随机分配' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布跨教室版本 2' })).toBeEnabled();
    expect(screen.getByText('步骤 6–7：终端预检、网络启动与显式预启动')).toBeInTheDocument();
    expect(screen.getByText('步骤 4：检查解释并人工调整')).toBeInTheDocument();
    expect(screen.getByText('在线未知 1')).toBeInTheDocument();
    expect(screen.getByText('朝向未设置 1')).toBeInTheDocument();
    expect(screen.getAllByText(`同名教室 · ${firstClassroomId}`).length).toBeGreaterThan(0);
    expect(screen.getAllByText(`同名教室 · ${secondClassroomId}`).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: new RegExp(`同名教室 · ${firstClassroomId} A-shared，朝右`) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(`同名教室 · ${secondClassroomId} B-shared，朝向未设置`) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '缩小座位图' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '选择张三换位' }));
    const selector = screen.getByRole('combobox', { name: '为张三指定座位' });
    expect(screen.getAllByRole('combobox', { name: /指定座位/ })).toHaveLength(1);
    await user.selectOptions(selector, `${secondClassroomId}\u0000shared-seat`);
    await user.click(screen.getByRole('checkbox', { name: '锁定张三' }));
    expect(screen.getByText('人工调整未保存')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布跨教室版本 2' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '导出当前页面 CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '创建跨教室候选计划' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '保存跨教室人工调整' }));
    await waitFor(() => expect(postBodies).toHaveLength(1));
    expect(postBodies[0]).toEqual({
      action: 'adjustV2',
      baseAssignmentRevision: 2,
      lockedUids: [21],
      mappings: [
        { boundUserId: 21, seat: { classroomId: secondClassroomId, sourceSeatId: 'shared-seat' } },
        { boundUserId: 22, seat: { classroomId: firstClassroomId, sourceSeatId: 'shared-seat' } },
      ],
    });
    expect(
      assignmentCsvV2(
        seatFacts.map((seat, index) => ({
          ...PLAN_RESPONSE.rosterRevisions[0].entries[index],
          classroomId: seat.classroomId,
          sourceSeatId: seat.sourceSeatId,
          seatLabel: seat.label,
          endpointId: seat.endpointId,
        })),
        2,
      ),
    ).toContain(`${secondClassroomId},B-shared,shared-seat,endpoint-v2-2,2`);
  });

  it('keeps every v1 mutation closed and offers only v2 generation when a v2 plan is newer than the displayed v1 assignment', async () => {
    const user = userEvent.setup();
    const postBodies: Record<string, unknown>[] = [];
    const legacyPlan = PLAN_RESPONSE.seatPlans[0];
    const v2Plan = {
      schemaVersion: 2,
      seatPlanId: '66b800000000000000000908',
      revision: legacyPlan.revision + 1,
      roster: legacyPlan.roster,
      classrooms: [
        {
          classroomId: legacyPlan.classroomId,
          layoutRevision: legacyPlan.layoutRevision,
          layoutFingerprint: legacyPlan.layoutFingerprint,
          profileRevision: 1,
          profileFingerprint: 'e'.repeat(64),
          candidateSeatIds: legacyPlan.candidateSeatIds,
        },
      ],
      fingerprint: 'f'.repeat(64),
      diagnostics: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          postBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return json({ assignment: null, diagnostics: [{ code: 'insufficient_seats', requiredSeatCount: 2, availableSeatCount: 1 }] });
        }
        if (url.endsWith('/seat-plans')) return json({ ...PLAN_RESPONSE, seatPlans: [v2Plan, legacyPlan] });
        if (url.endsWith('/seat-assignments')) return json(ASSIGNMENT_RESPONSE);
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    renderPage();

    expect(await screen.findByRole('button', { name: '生成尽力型跨教室分配' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '随机分配' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '按学号分配' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新随机未锁定座位' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布' })).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', { name: '跨教室分配策略' }), 'maximizeSpacing');
    await user.click(screen.getByRole('button', { name: '生成尽力型跨教室分配' }));
    await waitFor(() =>
      expect(postBodies).toEqual([{ action: 'generateV2', expectedPreviousRevision: 1, seatPlanRevision: 5, strategy: 'maximizeSpacing' }]),
    );
    expect(screen.getByText('可用座位不足：需要 2，当前 1')).toBeInTheDocument();
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
      if (String(input).endsWith('/prelogin-latest')) return json({ batch: null });
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
      if (String(input).endsWith('/prelogin-latest')) return json({ batch: null });
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
    expect(screen.queryByRole('button', { name: '随机分配' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '名单来源' })).toHaveValue('contestAudience');
    expect(screen.queryByRole('checkbox', { name: '2026 级一班' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成或刷新名单' })).toBeEnabled();
    await user.click(screen.getByRole('checkbox', { name: '选择教室北实 201' }));
    expect(screen.getByRole('button', { name: '创建跨教室候选计划' })).toBeEnabled();
  });

  it('keeps a v1 assignment strictly historical and emits no legacy mutation', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', fetchFixture(bodies));
    renderPage();

    expect(await screen.findAllByText('v1 历史只读')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /换位/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /锁定/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /随机分配|按学号分配|保存人工调整|重新随机/ })).not.toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it('assigns a student to an unoccupied eligible seat without exposing excluded candidates', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fixture = singleClassroomV2Fixture(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return json({ assignment: fixture.v2Assignment, diagnostics: [] });
        }
        if (url.endsWith('/seat-plans')) return json(fixture.planResponse);
        if (url.endsWith('/seat-assignments')) return json(fixture.assignmentResponse);
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderPage();

    const emptySeat = await screen.findByRole('button', { name: /A03，朝左，未分配/ });
    expect(emptySeat).toHaveClass('border-dashed');
    expect(emptySeat).not.toHaveClass('bg-primary');
    await user.click(await screen.findByRole('button', { name: '选择张三换位' }));
    const select = screen.getByRole('combobox', { name: '为张三指定座位' });
    expect(screen.queryByRole('option', { name: /A04/ })).not.toBeInTheDocument();
    await user.selectOptions(select, `${PLAN_RESPONSE.seatPlans[0].classroomId}\u0000seat-03`);
    await user.click(screen.getByRole('button', { name: '保存跨教室人工调整' }));
    expect(bodies[0]).toMatchObject({
      action: 'adjustV2',
      mappings: [
        { boundUserId: 21, seat: { classroomId: PLAN_RESPONSE.seatPlans[0].classroomId, sourceSeatId: 'seat-03' } },
        { boundUserId: 22, seat: { classroomId: PLAN_RESPONSE.seatPlans[0].classroomId, sourceSeatId: 'seat-02' } },
      ],
    });
  });

  it('keeps a local mapping or lock change explicitly dirty until a new revision is saved', async () => {
    const fixture = singleClassroomV2Fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/seat-plans')) return json(fixture.planResponse);
        if (url.endsWith('/seat-assignments')) return json(fixture.assignmentResponse);
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: '选择张三换位' }));
    await user.click(screen.getByRole('button', { name: '选择李四换位' }));
    expect(screen.getByText('人工调整未保存')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布跨教室版本 2' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保留锁定项重新分配' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '导出当前页面 CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存跨教室人工调整' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '生成或刷新名单' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '创建跨教室候选计划' })).toBeDisabled();
  });

  it('fails closed during an explicit refresh and restores editing only after both canonical reads settle', async () => {
    const fixture = singleClassroomV2Fixture();
    let planReads = 0;
    let assignmentReads = 0;
    let resolvePlans!: (response: Response) => void;
    let resolveAssignments!: (response: Response) => void;
    const pendingPlans = new Promise<Response>((resolve) => {
      resolvePlans = resolve;
    });
    const pendingAssignments = new Promise<Response>((resolve) => {
      resolveAssignments = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/seat-plans')) {
          planReads++;
          return planReads === 1 ? json(fixture.planResponse) : pendingPlans;
        }
        if (url.endsWith('/seat-assignments')) {
          assignmentReads++;
          return assignmentReads === 1 ? json(fixture.assignmentResponse) : pendingAssignments;
        }
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('button', { name: '选择张三换位' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '重读教室事实' }));
    expect(await screen.findByText(/页面事实尚未完成重读/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '选择张三换位' })).not.toBeInTheDocument();
    expect(screen.getAllByText('当前分配未引用最新计划')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '导出当前页面 CSV' })).toBeDisabled();

    resolvePlans(json(fixture.planResponse));
    resolveAssignments(json(fixture.assignmentResponse));
    await waitFor(() => expect(screen.getByRole('button', { name: '选择张三换位' })).toBeEnabled());
    expect(screen.getByRole('button', { name: '导出当前页面 CSV' })).toBeEnabled();
  });

  it('offers an explicit discard-and-reload recovery after an adjustment response is lost', async () => {
    const fixture = singleClassroomV2Fixture();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') throw new TypeError('adjust response lost');
        if (url.endsWith('/seat-plans')) return json(fixture.planResponse);
        if (url.endsWith('/seat-assignments')) return json(fixture.assignmentResponse);
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '选择张三换位' }));
    await user.click(screen.getByRole('button', { name: '选择李四换位' }));
    await user.click(screen.getByRole('button', { name: '保存跨教室人工调整' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('座位分配操作失败');
    expect(screen.getByText('人工调整未保存')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '放弃未保存调整并重读' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: '放弃未保存调整并重读' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.queryByText('人工调整未保存')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择张三换位' })).toBeEnabled();
  });

  it('keeps an older v2 assignment read-only when a newer v2 plan is already canonical', async () => {
    const fixture = singleClassroomV2Fixture();
    const newerRoster = {
      ...PLAN_RESPONSE.rosterRevisions[0],
      rosterId: '66b800000000000000000959',
      revision: 3,
      fingerprint: '6'.repeat(64),
      entries: [{ studentId: '20269999', realName: '新名单学生', boundUserId: 99 }],
    };
    const newerPlan = {
      ...fixture.v2Plan,
      seatPlanId: '66b800000000000000000958',
      revision: fixture.v2Plan.revision + 1,
      fingerprint: '7'.repeat(64),
      roster: { rosterId: newerRoster.rosterId, revision: newerRoster.revision, fingerprint: newerRoster.fingerprint },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/seat-plans')) {
          return json({
            ...fixture.planResponse,
            rosterRevisions: [newerRoster, ...PLAN_RESPONSE.rosterRevisions],
            seatPlans: [newerPlan, fixture.v2Plan],
          });
        }
        if (url.endsWith('/seat-assignments')) return json(fixture.assignmentResponse);
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    renderPage();

    expect(await screen.findAllByText('当前分配未引用最新计划')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /选择.*换位/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布跨教室版本 2' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保留锁定项重新分配' })).toBeDisabled();
    expect(screen.getByText('当前候选计划冻结名单 r3 · 1 人（生成前请核对）')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('张三')).toBeInTheDocument();
    expect(within(table).queryByText('新名单学生')).not.toBeInTheDocument();
  });

  it('disables every automatic-seating path for a public or invite-code Krypton contest', async () => {
    const fixture = singleClassroomV2Fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/seat-plans')) {
          return json({ ...fixture.planResponse, event: { ...fixture.planResponse.event, contestAudienceState: 'public' } });
        }
        if (url.endsWith('/seat-assignments')) return json(fixture.assignmentResponse);
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    renderPage();

    expect(await screen.findByText(/第一版不提供自动排座/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '名单来源' })).toBeDisabled();
    expect(screen.queryByRole('checkbox', { name: '2026 级一班' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '选择教室北实 201' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '生成或刷新名单' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '创建跨教室候选计划' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '生成尽力型跨教室分配' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发布跨教室版本 2' })).toBeDisabled();
  });

  it('keeps a historical Krypton v2 assignment based on a userbind subset strictly read-only', async () => {
    const fixture = singleClassroomV2Fixture();
    const historicalRoster = {
      ...PLAN_RESPONSE.rosterRevisions[0],
      source: { kind: 'userbindGroups' as const },
    };
    const published = { ...fixture.v2Assignment, published: true };
    const planResponse = { ...fixture.planResponse, rosterRevisions: [historicalRoster] };
    const assignmentResponse = {
      ...fixture.assignmentResponse,
      assignments: [published],
      publication: {
        revision: 1,
        assignmentId: published.assignmentId,
        assignmentRevision: published.revision,
        assignmentFingerprint: published.fingerprint,
        updatedAt: '2026-08-15T00:00:00.000Z',
        updatedBy: 2,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/seat-plans')) return json(planResponse);
        if (url.endsWith('/seat-assignments')) return json(assignmentResponse);
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    renderPage();

    expect(await screen.findByText(/历史 v2 计划或分配使用了 userbind 子名单/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成尽力型跨教室分配' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保留锁定项重新分配' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发布跨教室版本 2' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '1. 保存当前分配为目标' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '运行终端预检' })).toBeDisabled();
  });

  it.each(['fixed', 'public'] as const)(
    'preserves legacy v1 userbind target, preflight and retry compatibility for a %s Contest audience',
    async (contestAudienceState) => {
      const historicalRoster = {
        ...PLAN_RESPONSE.rosterRevisions[0],
        source: { kind: 'userbindGroups' as const },
      };
      const planResponse = {
        ...PLAN_RESPONSE,
        event: { ...PLAN_RESPONSE.event, contestAudienceState },
        rosterRevisions: [historicalRoster],
      };
      const batch = preloginBatch([{ status: 'failed', stage: 'launch' }]);
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (init?.method === 'POST' && url.endsWith('/prelogin/prepare')) {
            return json({
              preparation: preloginPreparation(),
              workflow: preloginWorkflow(),
              v2WriterEnabled: true,
              workflowWriterEnabled: true,
            });
          }
          if (url.endsWith('/seat-plans')) return json(planResponse);
          if (url.endsWith('/seat-assignments')) return json(PUBLISHED_ASSIGNMENT_RESPONSE);
          if (url.endsWith('/prelogin-latest')) return json({ batch });
          throw new Error(`unexpected request: ${url}`);
        }),
      );
      const user = userEvent.setup();
      renderPage();

      expect(await screen.findByRole('button', { name: '1. 保存当前分配为目标' })).toBeEnabled();
      expect(screen.getByRole('button', { name: '运行终端预检' })).toBeEnabled();
      expect(await screen.findByRole('button', { name: '只重试 1 个失败项' })).toBeEnabled();
      expect(screen.queryByText(/当前发布分配使用历史 userbind 子名单，仅供审计/)).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: '运行终端预检' }));
      expect(await screen.findByText('确认范围')).toBeInTheDocument();
    },
  );

  it('expands a split-team warning into member identities and physical destinations', async () => {
    const fixture = singleClassroomV2Fixture();
    const teamId = '66b800000000000000000960';
    const assignment = {
      ...fixture.v2Assignment,
      participants: fixture.v2Assignment.participants.map((participant, index) => ({
        ...participant,
        teamId,
        teamRole: index === 0 ? 'captain' : 'member',
      })),
      explanation: { ...fixture.v2Assignment.explanation, splitTeamIds: [teamId] },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/seat-plans')) return json(fixture.planResponse);
        if (url.endsWith('/seat-assignments')) return json({ ...fixture.assignmentResponse, assignments: [assignment] });
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    renderPage();

    expect(await screen.findByText(`队伍 ${teamId}`)).toBeInTheDocument();
    expect(screen.getByText(/队长 · 20260001 张三 → 北实 201 \/ A01/)).toBeInTheDocument();
    expect(screen.getByText(/队员 · 20260002 李四 → 北实 201 \/ A02/)).toBeInTheDocument();
  });

  it('shows the complete blocked diagnostics returned by the action without inventing a revision', async () => {
    const fixture = singleClassroomV2Fixture();
    const blocked = {
      assignment: null,
      diagnostics: [
        { code: 'seat_disabled', sourceSeatIds: ['seat-01'] },
        { code: 'seat_unbound', sourceSeatIds: ['seat-02'] },
        { code: 'insufficient_seats', requiredSeatCount: 2, availableSeatCount: 0 },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') return json(blocked);
        if (url.endsWith('/seat-plans')) return json(fixture.planResponse);
        if (url.endsWith('/seat-assignments')) {
          return json({ ...fixture.assignmentResponse, assignments: [], source: null, endpointPreflight: { state: 'not-required', items: [] } });
        }
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: '生成尽力型跨教室分配' }));
    expect(await screen.findByText('已排除禁用座位：seat-01')).toBeInTheDocument();
    expect(screen.getByText('已排除未绑定终端的座位：seat-02')).toBeInTheDocument();
    expect(screen.getByText('可用座位不足：需要 2，当前 0')).toBeInTheDocument();
  });

  it('prepares a fresh event through the event-authorized roster and classroom boundaries before generation', async () => {
    const fixture = singleClassroomV2Fixture();
    let plans: Record<string, unknown> = { ...PLAN_RESPONSE, rosterRevisions: [], seatPlans: [] };
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
        if (url.endsWith('/seat-plans') && body.action === 'createSeatPlanV2') {
          plans = { ...plans, seatPlans: [fixture.v2Plan] };
          return json({ seatPlan: fixture.v2Plan });
        }
        if (url.endsWith('/seat-assignments') && body.action === 'generateV2') {
          assignments = fixture.assignmentResponse;
          return json({ assignment: fixture.v2Assignment, diagnostics: [] });
        }
        throw new Error(`unexpected POST: ${url}`);
      }
      if (url.endsWith('/seat-plans')) return json(plans);
      if (url.endsWith('/seat-assignments')) return json(assignments);
      if (url.endsWith('/prelogin-latest')) return json({ batch: null });
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('combobox', { name: '名单来源' })).toHaveValue('contestAudience');
    expect(screen.queryByRole('checkbox', { name: '2026 级一班' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '生成或刷新名单' }));
    await waitFor(() => expect(bodies[0]?.body).toEqual({ action: 'createRoster', sourceKind: 'contestAudience', groupIds: [] }));

    await user.click(screen.getByRole('checkbox', { name: '选择教室北实 201' }));
    await user.click(screen.getByRole('button', { name: '创建跨教室候选计划' }));
    await waitFor(() =>
      expect(bodies[1]?.body).toEqual({
        action: 'createSeatPlanV2',
        classroomIds: [PLAN_RESPONSE.seatPlans[0].classroomId],
        expectedPreviousRevision: 0,
        rosterRevision: 2,
      }),
    );

    await user.click(screen.getByRole('button', { name: '生成尽力型跨教室分配' }));
    await waitFor(() =>
      expect(bodies[2]?.body).toEqual({ action: 'generateV2', expectedPreviousRevision: 0, seatPlanRevision: 5, strategy: 'minimizeClassrooms' }),
    );
    expect(bodies.some((entry) => entry.url.includes('/exam-infrastructure/classrooms/'))).toBe(false);
  });

  it('creates the primary multi-classroom plan from selected classrooms with the latest plan CAS', async () => {
    const classroomId = PLAN_RESPONSE.seatPlans[0].classroomId;
    const v2Plan = {
      schemaVersion: 2,
      seatPlanId: '66b800000000000000000909',
      revision: 1,
      roster: PLAN_RESPONSE.seatPlans[0].roster,
      classrooms: [
        {
          classroomId,
          layoutRevision: 7,
          layoutFingerprint: 'b'.repeat(64),
          profileRevision: 1,
          profileFingerprint: 'e'.repeat(64),
          candidateSeatIds: ['seat-01', 'seat-02'],
        },
      ],
      fingerprint: 'f'.repeat(64),
      diagnostics: [],
    };
    let plans = { ...PLAN_RESPONSE, seatPlans: [] as Array<typeof v2Plan> };
    const assignments = {
      ...ASSIGNMENT_RESPONSE,
      assignments: [] as typeof ASSIGNMENT_RESPONSE.assignments,
      source: null,
      endpointPreflight: { state: 'not-required', items: [] },
    };
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          bodies.push(body);
          if (body.action !== 'createSeatPlanV2') throw new Error(`unexpected action: ${String(body.action)}`);
          plans = { ...plans, seatPlans: [v2Plan] };
          return json({ seatPlan: v2Plan });
        }
        if (url.endsWith('/seat-plans')) return json(plans);
        if (url.endsWith('/seat-assignments')) return json(assignments);
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('checkbox', { name: '选择教室北实 201' }));
    await user.click(screen.getByRole('button', { name: '创建跨教室候选计划' }));
    await waitFor(() =>
      expect(bodies).toEqual([
        {
          action: 'createSeatPlanV2',
          classroomIds: [classroomId],
          expectedPreviousRevision: 0,
          rosterRevision: 2,
        },
      ]),
    );
    expect(await screen.findByRole('button', { name: '生成尽力型跨教室分配' })).toBeEnabled();
  });

  it('renders 500 v2 assignments and map seats with one shared selector instead of one full selector per row', { timeout: 30_000 }, async () => {
    const count = 500;
    const classroomId = PLAN_RESPONSE.seatPlans[0].classroomId;
    const entries = Array.from({ length: count }, (_, index) => ({
      studentId: `2026${String(index).padStart(4, '0')}`,
      realName: `学生${index}`,
      boundUserId: index + 2,
    }));
    const seatIds = entries.map((_, index) => `seat-${String(index).padStart(3, '0')}`);
    const classroom = {
      classroomId,
      layoutRevision: 7,
      layoutFingerprint: 'b'.repeat(64),
      profileRevision: 1,
      profileFingerprint: 'e'.repeat(64),
      candidateSeatIds: seatIds,
    };
    const seatFacts = seatIds.map((sourceSeatId, index) => ({
      classroomId,
      sourceSeatId,
      label: `S${index}`,
      x: index % 25,
      y: Math.floor(index / 25),
      width: null,
      height: null,
      rotation: 0,
      layoutStatus: 'active',
      enabled: true,
      facing: 'unset',
      disabledReason: null,
      bindingId: objectIdFromIndex(0x1000 + index),
      bindingRevision: 1,
      endpointId: `endpoint-${index}`,
      endpointOnline: true,
    }));
    const v2Plan = {
      schemaVersion: 2,
      seatPlanId: '66b800000000000000000a05',
      revision: 5,
      roster: PLAN_RESPONSE.seatPlans[0].roster,
      classrooms: [classroom],
      fingerprint: '7'.repeat(64),
      diagnostics: [],
    };
    const mappings = entries.map((entry, index) => ({
      boundUserId: entry.boundUserId,
      seat: { classroomId, sourceSeatId: seatIds[index] },
    }));
    const v2Assignment = {
      schemaVersion: 2,
      assignmentId: '66b800000000000000000a07',
      revision: 1,
      seatPlan: { seatPlanId: v2Plan.seatPlanId, revision: v2Plan.revision, fingerprint: v2Plan.fingerprint },
      roster: PLAN_RESPONSE.seatPlans[0].roster,
      classrooms: [classroom],
      participants: entries.map((entry, index) => ({
        boundUserId: entry.boundUserId,
        studentRecordId: objectIdFromIndex(0x2000 + index),
        studentId: entry.studentId,
        teamId: null,
        teamRole: null,
      })),
      seatFacts,
      constraints: { strategy: 'maximizeSpacing', lockedAssignments: [], manualAssignments: [] },
      assignments: mappings,
      explanation: {
        classrooms: [{ classroomId, assignedCount: count, eligibleSeatCount: count }],
        highRiskEdges: [],
        mediumRiskEdges: [],
        splitTeamIds: [],
        skippedSeats: [],
        offlineSeats: [],
        unsetFacingSeats: seatIds.map((sourceSeatId) => ({ classroomId, sourceSeatId })),
      },
      fingerprint: '6'.repeat(64),
      published: false,
    };
    const plans = {
      ...PLAN_RESPONSE,
      rosterRevisions: [{ ...PLAN_RESPONSE.rosterRevisions[0], entries }],
      seatPlans: [v2Plan],
    };
    const response = {
      ...ASSIGNMENT_RESPONSE,
      assignments: [v2Assignment],
      source: {
        schemaVersion: 2,
        seatPlanRevision: v2Plan.revision,
        seats: seatFacts.map((seat) => ({
          classroomId: seat.classroomId,
          sourceSeatId: seat.sourceSeatId,
          label: seat.label,
          status: seat.layoutStatus,
          bindingId: seat.bindingId,
          bindingRevision: seat.bindingRevision,
          endpointId: seat.endpointId,
        })),
      },
      classrooms: [
        {
          classroomId,
          name: '北实 201',
          layoutRevision: 7,
          seatCount: count,
        },
      ],
      endpointPreflight: { state: 'not-required', items: [] },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/seat-plans')) return json(plans);
      if (String(input).endsWith('/seat-assignments')) return json(response);
      if (String(input).endsWith('/prelogin-latest')) return json({ batch: null });
      throw new Error(`unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage();
    const map = await screen.findByRole('region', { name: '北实 201座位图' });
    expect(within(map).getAllByRole('button')).toHaveLength(count);
    await user.click(await screen.findByRole('button', { name: '选择学生0换位' }));
    const selector = screen.getByRole('combobox', { name: '为学生0指定座位' });
    expect(within(selector).getAllByRole('option')).toHaveLength(count);
    expect(screen.getAllByRole('combobox', { name: /为.+指定座位/ })).toHaveLength(1);
  }, 20_000);

  it('shows exact frozen risk edges on demand and draws them only after explicit opt-in', async () => {
    const classroomId = PLAN_RESPONSE.seatPlans[0].classroomId;
    const classroom = {
      classroomId,
      layoutRevision: 7,
      layoutFingerprint: 'b'.repeat(64),
      profileRevision: 1,
      profileFingerprint: 'e'.repeat(64),
      candidateSeatIds: ['seat-01', 'seat-02'],
    };
    const seatFacts = [
      {
        classroomId,
        sourceSeatId: 'seat-01',
        label: 'A01',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        rotation: 0,
        layoutStatus: 'active',
        enabled: true,
        facing: 'right',
        disabledReason: null,
        bindingId: objectIdFromIndex(0x3010),
        bindingRevision: 1,
        endpointId: 'endpoint-risk-1',
        endpointOnline: true,
      },
      {
        classroomId,
        sourceSeatId: 'seat-02',
        label: 'A02',
        x: 1,
        y: 0,
        width: 1,
        height: 1,
        rotation: 0,
        layoutStatus: 'active',
        enabled: true,
        facing: 'right',
        disabledReason: null,
        bindingId: objectIdFromIndex(0x3011),
        bindingRevision: 1,
        endpointId: 'endpoint-risk-2',
        endpointOnline: true,
      },
    ];
    const riskEdge = {
      left: { classroomId, sourceSeatId: 'seat-01' },
      right: { classroomId, sourceSeatId: 'seat-02' },
      distance: 1,
      reason: 'same_facing',
    };
    const v2Plan = {
      schemaVersion: 2,
      seatPlanId: '66b800000000000000000b05',
      revision: 5,
      roster: PLAN_RESPONSE.seatPlans[0].roster,
      classrooms: [classroom],
      fingerprint: '5'.repeat(64),
      diagnostics: [],
    };
    const v2Assignment = {
      schemaVersion: 2,
      assignmentId: '66b800000000000000000b07',
      revision: 1,
      seatPlan: { seatPlanId: v2Plan.seatPlanId, revision: v2Plan.revision, fingerprint: v2Plan.fingerprint },
      roster: PLAN_RESPONSE.seatPlans[0].roster,
      classrooms: [classroom],
      participants: PLAN_RESPONSE.rosterRevisions[0].entries.map((entry, index) => ({
        boundUserId: entry.boundUserId,
        studentRecordId: objectIdFromIndex(0x3020 + index),
        studentId: entry.studentId,
        teamId: null,
        teamRole: null,
      })),
      seatFacts,
      constraints: { strategy: 'maximizeSpacing', lockedAssignments: [], manualAssignments: [] },
      assignments: PLAN_RESPONSE.rosterRevisions[0].entries.map((entry, index) => ({
        boundUserId: entry.boundUserId,
        seat: { classroomId, sourceSeatId: `seat-0${index + 1}` },
      })),
      explanation: {
        classrooms: [{ classroomId, assignedCount: 2, eligibleSeatCount: 2 }],
        highRiskEdges: [riskEdge],
        mediumRiskEdges: [],
        splitTeamIds: [],
        skippedSeats: [],
        offlineSeats: [],
        unsetFacingSeats: [],
      },
      fingerprint: '4'.repeat(64),
      published: false,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/seat-plans')) return json({ ...PLAN_RESPONSE, seatPlans: [v2Plan] });
        if (url.endsWith('/seat-assignments')) {
          return json({
            ...ASSIGNMENT_RESPONSE,
            assignments: [v2Assignment],
            source: {
              schemaVersion: 2,
              seatPlanRevision: v2Plan.revision,
              seats: seatFacts.map((seat) => ({
                classroomId: seat.classroomId,
                sourceSeatId: seat.sourceSeatId,
                label: seat.label,
                status: seat.layoutStatus,
                bindingId: seat.bindingId,
                bindingRevision: seat.bindingRevision,
                endpointId: seat.endpointId,
              })),
            },
          });
        }
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('button', { name: '高风险边 1' })).toBeInTheDocument();
    const map = screen.getByRole('region', { name: '北实 201座位图' });
    expect(map.querySelectorAll('line')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: '高风险边 1' }));
    expect(screen.getByText('北实 201 / A01 ↔ 北实 201 / A02 · 同向 · 距离 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '显示风险连线' }));
    expect(map.querySelectorAll('line')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /北实 201 A01，朝右，20260001 张三，高风险/ })).toBeInTheDocument();
  });

  it('preflights the published assignment and confirms with the exact workflow identity on insecure HTTP', async () => {
    const preparation = preloginPreparation();
    const workflow = preloginWorkflow();
    const posts: Array<{ body: Record<string, unknown>; url: string; urlState: string }> = [];
    vi.stubGlobal('crypto', {
      getRandomValues(bytes: Uint8Array) {
        bytes.forEach((_, index) => {
          bytes[index] = index;
        });
        return bytes;
      },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push({ body, url, urlState: window.location.search });
        if (url.endsWith('/prelogin/prepare')) return json({ preparation, workflow, v2WriterEnabled: true, workflowWriterEnabled: true });
        if (url.endsWith('/prelogin/confirm')) {
          const batch = preloginBatch([
            { status: 'sent', stage: 'launch' },
            { status: 'queued', stage: 'dispatch' },
          ]);
          batch.requestId = String(body.requestId);
          if (batch.projection) batch.projection.requestId = String(body.requestId);
          return json({ batch, workflow });
        }
      }
      if (url.endsWith('/seat-plans')) return json(PLAN_RESPONSE);
      if (url.endsWith('/seat-assignments')) return json(PUBLISHED_ASSIGNMENT_RESPONSE);
      if (url.endsWith('/prelogin-latest')) return json({ batch: null });
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '运行终端预检' }));
    expect(await screen.findByText('告警：usb_storage_detected')).toBeInTheDocument();
    expect(screen.getByText('硬错误 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '步骤 7：一键预启动全部终端' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '步骤 7：一键预启动全部终端' }));
    expect(await screen.findByText('逐终端结果')).toBeInTheDocument();

    expect(posts[0]?.url.endsWith('/prelogin/prepare')).toBe(true);
    expect(posts[0]?.body).toEqual({ assignmentRevision: 1 });
    expect(posts[1]?.body).toEqual({
      assignmentRevision: 1,
      preparationFingerprint: preparation.fingerprint,
      workflowFingerprint: workflow.fingerprint,
      requestId: '00010203-0405-4607-8809-0a0b0c0d0e0f',
    });
    expect(posts[1]?.urlState).toContain('requestId=00010203-0405-4607-8809-0a0b0c0d0e0f');
  });

  it('shows structured v2 seats and keeps prestart closed until the P2.14 writer gate is enabled', async () => {
    const fixture = singleClassroomV2Fixture();
    const published = { ...fixture.v2Assignment, published: true };
    const assignmentResponse = {
      ...fixture.assignmentResponse,
      assignments: [published],
      publication: {
        revision: 4,
        assignmentId: published.assignmentId,
        assignmentRevision: published.revision,
        assignmentFingerprint: published.fingerprint,
      },
    };
    const preparation = {
      ...preloginPreparation(),
      assignment: { assignmentId: published.assignmentId, revision: published.revision, fingerprint: published.fingerprint },
      publicationRevision: 4,
      items: preloginPreparation().items.map((item, index) => ({
        ...item,
        endpointId: fixture.seatFacts[index].endpointId,
        diagnostics: index === 0 ? [{ code: 'seat_facing_changed', severity: 'warning' }] : [],
      })),
    };
    const workflow = preloginWorkflow();
    workflow.monitoring.items = workflow.monitoring.items.map((item, index) => ({
      ...item,
      endpointId: fixture.seatFacts[index].endpointId,
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST' && url.endsWith('/prelogin/prepare')) {
          return json({ preparation, workflow, v2WriterEnabled: false, workflowWriterEnabled: true });
        }
        if (url.endsWith('/seat-plans')) return json(fixture.planResponse);
        if (url.endsWith('/seat-assignments')) return json(assignmentResponse);
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/建议在开赛前 10–15 分钟/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '运行终端预检' }));
    expect(await screen.findByText(/跨教室预登录当前处于兼容读取阶段/)).toBeInTheDocument();
    expect(screen.getByText('北实 201 / seat-01')).toBeInTheDocument();
    expect(screen.getByText('告警：seat_facing_changed')).toHaveClass('text-amber-700');
    expect(screen.getByRole('button', { name: '步骤 7：一键预启动全部终端' })).toBeDisabled();
  });

  it('lists exact participant and team changes against the published v2 assignment', async () => {
    const fixture = singleClassroomV2Fixture();
    const published = { ...fixture.v2Assignment, published: true };
    const assignmentResponse = {
      ...fixture.assignmentResponse,
      assignments: [published],
      publication: {
        revision: 4,
        assignmentId: published.assignmentId,
        assignmentRevision: published.revision,
        assignmentFingerprint: published.fingerprint,
      },
      publishedRosterDrift: {
        changed: true,
        sourceChangedWithoutParticipantDiff: false,
        items: [
          {
            boundUserId: 21,
            studentId: '20260001',
            realName: '张三',
            kind: 'team_changed',
            previousTeamId: '66b800000000000000000901',
            previousTeamRole: 'member',
            currentTeamId: '66b800000000000000000902',
            currentTeamRole: 'captain',
          },
          {
            boundUserId: 23,
            studentId: '20260003',
            realName: '王五',
            kind: 'added',
            previousTeamId: null,
            previousTeamRole: null,
            currentTeamId: null,
            currentTeamRole: null,
          },
        ],
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/seat-plans')) return json(fixture.planResponse);
        if (url.endsWith('/seat-assignments')) return json(assignmentResponse);
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    renderPage();

    expect(await screen.findByText(/当前参赛名单或团队关系已不同于已发布分配/)).toBeInTheDocument();
    expect(screen.getByText(/团队或角色变化：20260001 · 张三/)).toBeInTheDocument();
    expect(screen.getByText('新增参赛者：20260003 · 王五')).toBeInTheDocument();
  });

  it('re-reads and displays exact roster drift when a long-open preflight is rejected', async () => {
    let drifted = false;
    const driftedAssignmentResponse = {
      ...PUBLISHED_ASSIGNMENT_RESPONSE,
      publishedRosterDrift: {
        changed: true,
        sourceChangedWithoutParticipantDiff: false,
        items: [
          {
            boundUserId: 23,
            studentId: '20260003',
            realName: '王五',
            kind: 'added',
            previousTeamId: null,
            previousTeamRole: null,
            currentTeamId: null,
            currentTeamRole: null,
          },
        ],
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST' && url.endsWith('/prelogin/prepare')) {
          drifted = true;
          throw new TypeError('assignment_reference_changed:roster');
        }
        if (url.endsWith('/seat-plans')) return json(PLAN_RESPONSE);
        if (url.endsWith('/seat-assignments')) return json(drifted ? driftedAssignmentResponse : PUBLISHED_ASSIGNMENT_RESPONSE);
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '运行终端预检' }));
    expect(await screen.findByText(/当前参赛名单或团队关系已不同于已发布分配/)).toBeInTheDocument();
    expect(screen.getByText('新增参赛者：20260003 · 王五')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '步骤 7：一键预启动全部终端' })).toBeDisabled();
  });

  it('builds and assigns the current published assignment target on the same page with the real config CAS revision', async () => {
    const targetAssignmentId = '66b8000000000000000008d0';
    const targetFingerprint = '9'.repeat(64);
    const sources = [{ kind: 'examSeat', ids: [PUBLISHED_ASSIGNMENT.assignmentId] }];
    let targetState: 'missing' | 'draft' | 'published' = 'missing';
    const posts: Array<{ body: Record<string, unknown>; url: string }> = [];
    const targetPayload = () => ({
      assignment:
        targetState === 'missing'
          ? null
          : {
              assignmentId: targetAssignmentId,
              revision: targetState === 'draft' ? 1 : 2,
              draft: { version: 1, sources },
              revisions:
                targetState === 'published'
                  ? [
                      {
                        revision: 1,
                        sources,
                        targetFingerprint,
                        endpointIds: ['endpoint-01', 'endpoint-02'],
                        targetCount: 2,
                        publishedAt: '2026-08-13T02:00:00.000Z',
                      },
                    ]
                  : [],
              latestPublishedRevision: targetState === 'published' ? 1 : null,
            },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          posts.push({ body, url });
          if (url.endsWith('/target-assignment') && body.action === 'saveDraft') {
            targetState = 'draft';
            return json(targetPayload());
          }
          if (url.endsWith('/target-assignment') && body.action === 'preview') {
            return json({
              preview: {
                previewFingerprint: targetFingerprint,
                endpointIds: ['endpoint-01', 'endpoint-02'],
                targetCount: 2,
                addedEndpointIds: ['endpoint-01', 'endpoint-02'],
                removedEndpointIds: [],
              },
            });
          }
          if (url.endsWith('/target-assignment') && body.action === 'publish') {
            targetState = 'published';
            return json(targetPayload());
          }
          if (url.endsWith('/network-config') && body.action === 'assignTarget') return json({ config: {} });
          if (url.endsWith('/prelogin/prepare')) {
            return json({ preparation: preloginPreparation(), workflow: preloginWorkflow(), v2WriterEnabled: true, workflowWriterEnabled: true });
          }
        }
        if (url.endsWith('/seat-plans')) return json(PLAN_RESPONSE);
        if (url.endsWith('/seat-assignments')) return json(PUBLISHED_ASSIGNMENT_RESPONSE);
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        if (url.endsWith('/target-assignment')) return json(targetPayload());
        if (url.startsWith('/api/admin/exam-policy-templates?')) return json({ templates: [] });
        if (url.endsWith('/network-config')) {
          return json({
            config: {
              revision: 5,
              policy: { id: '66b800000000000000000851', revision: 2, fingerprint: '1'.repeat(64) },
              target: null,
            },
          });
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '1. 保存当前分配为目标' }));
    await user.click(await screen.findByRole('button', { name: '2. 重新解析目标' }));
    expect(await screen.findByText('即将发布 2 台终端')).toBeInTheDocument();
    expect(screen.getByText('endpoint-01、endpoint-02')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '3. 发布目标快照' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '4. 分配到活动' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '4. 分配到活动' }));

    expect(posts.find((entry) => entry.body.action === 'saveDraft')?.body).toEqual({
      action: 'saveDraft',
      expectedRevision: 0,
      sources,
    });
    expect(posts.find((entry) => entry.body.action === 'publish')?.body).toEqual({
      action: 'publish',
      expectedRevision: 1,
      confirmationFingerprint: targetFingerprint,
    });
    expect(posts.find((entry) => entry.body.action === 'assignTarget')?.body).toEqual({
      action: 'assignTarget',
      expectedRevision: 5,
      assignmentId: targetAssignmentId,
      revision: 1,
    });
  });

  it('assigns a published policy and explicitly schedules a fresh event on the same page', async () => {
    const targetAssignmentId = '66b8000000000000000008d0';
    const firstPolicyId = '66b800000000000000000851';
    const selectedPolicyId = '66b800000000000000000853';
    const sources = [{ kind: 'examSeat', ids: [PUBLISHED_ASSIGNMENT.assignmentId] }];
    let scheduled = false;
    let configRevision = 5;
    let policy: { id: string; revision: number; fingerprint: string } | null = null;
    const posts: Array<{ body: Record<string, unknown>; url: string }> = [];
    const planResponse = () => ({
      ...PLAN_RESPONSE,
      event: {
        ...PLAN_RESPONSE.event,
        revision: scheduled ? 4 : 3,
        lifecycle: scheduled ? 'scheduled' : 'draft',
      },
    });
    const targetPayload = {
      assignment: {
        assignmentId: targetAssignmentId,
        revision: 2,
        draft: { version: 1, sources },
        revisions: [
          {
            revision: 1,
            sources,
            targetFingerprint: '9'.repeat(64),
            endpointIds: ['endpoint-01', 'endpoint-02'],
            targetCount: 2,
            publishedAt: '2026-08-13T02:00:00.000Z',
          },
        ],
        latestPublishedRevision: 1,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          posts.push({ body, url });
          if (url.endsWith('/network-config') && body.action === 'assignPolicy') {
            configRevision = 6;
            policy = { id: selectedPolicyId, revision: 3, fingerprint: '3'.repeat(64) };
            return json({ config: {} });
          }
          if (url === `/api/admin/exam-events/${EVENT_ID}` && body.action === 'schedule') {
            scheduled = true;
            return json({ event: {} });
          }
        }
        if (url.endsWith('/seat-plans')) return json(planResponse());
        if (url.endsWith('/seat-assignments')) return json(PUBLISHED_ASSIGNMENT_RESPONSE);
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        if (url.endsWith('/target-assignment')) return json(targetPayload);
        if (url.endsWith('/network-config')) {
          return json({
            config: {
              revision: configRevision,
              policy,
              target: { id: targetAssignmentId, revision: 1, fingerprint: '9'.repeat(64) },
            },
          });
        }
        if (url.startsWith('/api/admin/exam-policy-templates?')) {
          return json({
            templates: [
              {
                templateId: firstPolicyId,
                name: '基础策略',
                status: 'active',
                revisions: [{ revision: 2, fingerprint: '1'.repeat(64) }],
              },
              {
                templateId: selectedPolicyId,
                name: '严格封锁',
                status: 'active',
                revisions: [{ revision: 3, fingerprint: '3'.repeat(64) }],
              },
            ],
          });
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /读取当前策略与目标事实/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: '已发布网络策略版本' }), `${selectedPolicyId}:3`);
    await user.click(screen.getByRole('button', { name: '分配所选策略' }));
    await waitFor(() => expect(screen.getByText('当前策略 r3')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /将考试活动显式计划为待开始/ }));
    await waitFor(() => expect(screen.getByText('活动 已计划')).toBeInTheDocument());

    expect(posts.find((entry) => entry.body.action === 'assignPolicy')?.body).toEqual({
      action: 'assignPolicy',
      expectedRevision: 5,
      templateId: selectedPolicyId,
      revision: 3,
    });
    expect(posts.find((entry) => entry.body.action === 'schedule')?.body).toEqual({
      action: 'schedule',
      expectedRevision: 3,
    });
  });

  it('keeps confirmation disabled while the compatibility reader is deployed with the workflow writer off', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST' && url.endsWith('/prelogin/prepare')) {
          return json({ preparation: preloginPreparation(), workflow: preloginWorkflow(), v2WriterEnabled: true, workflowWriterEnabled: false });
        }
        if (url.endsWith('/seat-plans')) return json(PLAN_RESPONSE);
        if (url.endsWith('/seat-assignments')) return json(PUBLISHED_ASSIGNMENT_RESPONSE);
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '运行终端预检' }));
    expect(await screen.findByText(/当前处于 P2\.9 兼容读取阶段/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '步骤 7：一键预启动全部终端' })).toBeDisabled();
  });

  it('starts the fixed network execution on the same page before enabling prelogin confirmation', async () => {
    const preparation = preloginPreparation();
    const configured = preloginWorkflow(2, 'config');
    const active = preloginWorkflow(2, 'execution');
    let prepareCalls = 0;
    const posts: Array<{ body: Record<string, unknown>; url: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push({ body, url });
        if (url.endsWith('/prelogin/prepare')) {
          prepareCalls += 1;
          return json({ preparation, workflow: prepareCalls === 1 ? configured : active, v2WriterEnabled: true, workflowWriterEnabled: true });
        }
        if (url.endsWith('/network-execution')) return json({ execution: {} });
      }
      if (url.endsWith('/seat-plans')) return json(PLAN_RESPONSE);
      if (url.endsWith('/seat-assignments')) return json(PUBLISHED_ASSIGNMENT_RESPONSE);
      if (url.endsWith('/prelogin-latest')) return json({ batch: null });
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '运行终端预检' }));
    expect(await screen.findByText(/尚未启动/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '步骤 7：一键预启动全部终端' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '启动网络策略' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '步骤 7：一键预启动全部终端' })).toBeEnabled());
    expect(posts.find((entry) => entry.url.endsWith('/network-execution'))?.body).toEqual({
      action: 'start',
      expectedRevision: 0,
      expectedConfigRevision: 6,
    });
    expect(prepareCalls).toBe(2);
  });

  it('retries a pending network execution on the same page and then re-reads readiness', async () => {
    const preparation = preloginPreparation();
    const pending = preloginWorkflow();
    pending.network.ready = false;
    pending.network.reason = 'network_execution_pending';
    pending.network.appliedCount = 0;
    pending.network.pendingCount = 2;
    pending.hardErrorCount = 1;
    const active = preloginWorkflow();
    let prepareCalls = 0;
    const posts: Array<{ body: Record<string, unknown>; url: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          posts.push({ body, url });
          if (url.endsWith('/prelogin/prepare')) {
            prepareCalls += 1;
            return json({
              preparation,
              workflow: prepareCalls === 1 ? pending : active,
              v2WriterEnabled: true,
              workflowWriterEnabled: true,
            });
          }
          if (url.endsWith('/network-execution')) return json({ execution: {} });
        }
        if (url.endsWith('/seat-plans')) return json(PLAN_RESPONSE);
        if (url.endsWith('/seat-assignments')) return json(PUBLISHED_ASSIGNMENT_RESPONSE);
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '运行终端预检' }));
    await user.click(await screen.findByRole('button', { name: '重试当前网络请求' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '步骤 7：一键预启动全部终端' })).toBeEnabled());

    expect(posts.find((entry) => entry.url.endsWith('/network-execution'))?.body).toEqual({
      action: 'retry',
      expectedRevision: 7,
    });
    expect(prepareCalls).toBe(2);
  });

  it('recovers the same confirm request after the HTTP response is lost', async () => {
    const preparation = preloginPreparation();
    const workflow = preloginWorkflow();
    const batch = preloginBatch([
      { status: 'sent', stage: 'launch' },
      { status: 'queued', stage: 'dispatch' },
    ]);
    const request = '22222222-2222-4222-8222-222222222222';
    batch.requestId = request;
    if (batch.projection) batch.projection.requestId = request;
    let confirmCalls = 0;
    vi.stubGlobal('crypto', { randomUUID: () => request });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/prelogin/prepare')) {
        return json({ preparation, workflow, v2WriterEnabled: true, workflowWriterEnabled: true });
      }
      if (init?.method === 'POST' && url.endsWith('/prelogin/confirm')) {
        confirmCalls += 1;
        throw new TypeError('response lost');
      }
      if (url.endsWith(`/prelogin-requests/${request}`)) return json({ batch });
      if (url.endsWith('/seat-plans')) return json(PLAN_RESPONSE);
      if (url.endsWith('/seat-assignments')) return json(PUBLISHED_ASSIGNMENT_RESPONSE);
      if (url.endsWith('/prelogin-latest')) return json({ batch: null });
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '运行终端预检' }));
    await user.click(await screen.findByRole('button', { name: '步骤 7：一键预启动全部终端' }));
    expect(await screen.findByText('逐终端结果')).toBeInTheDocument();
    expect(confirmCalls).toBe(1);
    expect(window.location.search).toContain(`batchId=${batch.batchId}`);
    expect(window.location.search).not.toContain('requestId=');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retains an unresolved confirm request and locks history until the same request converges', async () => {
    const preparation = preloginPreparation();
    const workflow = preloginWorkflow();
    const historical = preloginBatch([{ status: 'applied', stage: 'page_ready' }]);
    historical.batchId = '66b8000000000000000008ed';
    historical.requestId = '55555555-5555-4555-8555-555555555555';
    if (historical.projection) {
      historical.projection.batchId = historical.batchId;
      historical.projection.requestId = historical.requestId;
    }
    const request = '77777777-7777-4777-8777-777777777777';
    const confirmBodies: Record<string, unknown>[] = [];
    vi.stubGlobal('crypto', { randomUUID: () => request });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST' && url.endsWith('/prelogin/prepare')) {
          return json({ preparation, workflow, v2WriterEnabled: true, workflowWriterEnabled: true });
        }
        if (init?.method === 'POST' && url.endsWith('/prelogin/confirm')) {
          confirmBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          throw new TypeError('confirm response lost');
        }
        if (url.endsWith(`/prelogin-requests/${request}`)) return json({ batch: null });
        if (url.endsWith('/seat-plans')) return json(PLAN_RESPONSE);
        if (url.endsWith('/seat-assignments')) return json(PUBLISHED_ASSIGNMENT_RESPONSE);
        if (url.endsWith('/prelogin-latest')) return json({ batch: null });
        if (url.endsWith('/prelogin-batches')) return json({ batches: [historical] });
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '查看历史批次' }));
    const historicalButton = (await screen.findByText(historical.requestId)).closest('button');
    if (!historicalButton) throw new Error('historical batch button missing');
    expect(historicalButton).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '运行终端预检' }));
    await user.click(screen.getByRole('button', { name: '步骤 7：一键预启动全部终端' }));

    expect(await screen.findByText('确认请求结果尚未收敛；原 requestId 已保留，继续同一确认请求前暂不可切换历史批次。')).toBeInTheDocument();
    expect(historicalButton).toBeDisabled();
    expect(window.location.search).toContain(`requestId=${request}`);
    await user.click(screen.getByRole('button', { name: '步骤 7：一键预启动全部终端' }));
    await waitFor(() => expect(confirmBodies).toHaveLength(2));
    expect(confirmBodies[0]?.requestId).toBe(request);
    expect(confirmBodies[1]?.requestId).toBe(request);
    expect(window.location.search).toContain(`requestId=${request}`);
  });

  it('separates final success, retryable failure and in-flight subjects and retries only the exact failure set', async () => {
    const initial = preloginBatch([
      { status: 'applied', stage: 'page_ready' },
      { status: 'failed', stage: 'launch' },
      { status: 'sent', stage: 'process_ready' },
      { status: 'queued', stage: 'dispatch' },
    ]);
    const retryRequest = '33333333-3333-4333-8333-333333333333';
    const retryPosts: Array<{ body: Record<string, unknown>; urlState: string }> = [];
    vi.stubGlobal('crypto', { randomUUID: () => retryRequest });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith(`/prelogin-batches/${initial.batchId}/retry`)) {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        retryPosts.push({ body, urlState: window.location.search });
        const updated = preloginBatch([
          { status: 'applied', stage: 'page_ready' },
          { status: 'sent', stage: 'launch' },
          { status: 'sent', stage: 'process_ready' },
          { status: 'queued', stage: 'dispatch' },
        ]);
        updated.revision = 3;
        if (updated.projection) updated.projection.projectionRevision = 2;
        return json({ batch: updated });
      }
      if (url.endsWith('/seat-plans')) return json(PLAN_RESPONSE);
      if (url.endsWith('/seat-assignments')) return json(PUBLISHED_ASSIGNMENT_RESPONSE);
      if (url.endsWith('/prelogin-latest')) return json({ batch: initial });
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('成功 1')).toBeInTheDocument();
    expect(screen.getByText(/确认时执行 r7 · 策略 r2 · 目标 r4/)).toBeInTheDocument();
    expect(screen.getByText('失败 1')).toBeInTheDocument();
    expect(screen.getByText('在途 2')).toBeInTheDocument();
    expect(screen.getByText('未处理 0')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '只重试 1 个失败项' }));
    await waitFor(() => expect(retryPosts).toHaveLength(1));
    expect(retryPosts[0]?.body).toEqual({
      expectedProjectionRevision: 1,
      requestId: retryRequest,
      ticketIds: [initial.subjects[1].ticketId],
    });
    expect(retryPosts[0]?.urlState).toContain(`retryRequestId=${retryRequest}`);
    expect(retryPosts[0]?.urlState).toContain('retryProjectionRevision=1');
    expect(retryPosts[0]?.urlState).not.toContain('retryTicketIds=');
  });

  it('keeps a newer polled projection when an older retry response arrives later', async () => {
    const initial = preloginBatch([
      { status: 'failed', stage: 'launch' },
      { status: 'sent', stage: 'process_ready' },
    ]);
    const staleRetry = preloginBatch([
      { status: 'failed', stage: 'launch' },
      { status: 'applied', stage: 'page_ready' },
    ]);
    staleRetry.revision = 3;
    if (staleRetry.projection) staleRetry.projection.projectionRevision = 2;
    const newest = preloginBatch([
      { status: 'applied', stage: 'page_ready' },
      { status: 'applied', stage: 'page_ready' },
    ]);
    newest.revision = 4;
    if (newest.projection) newest.projection.projectionRevision = 3;
    let resolveRetry!: (response: Response) => void;
    const retryResponse = new Promise<Response>((resolve) => {
      resolveRetry = resolve;
    });
    let polls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST' && url.endsWith(`/prelogin-batches/${initial.batchId}/retry`)) return retryResponse;
        if (url.endsWith('/seat-plans')) return json(PLAN_RESPONSE);
        if (url.endsWith('/seat-assignments')) return json(PUBLISHED_ASSIGNMENT_RESPONSE);
        if (url.endsWith('/prelogin-latest')) return json({ batch: initial });
        if (url.endsWith(`/prelogin-batches/${initial.batchId}`)) {
          polls += 1;
          return json({ batch: newest });
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '只重试 1 个失败项' }));
    expect(await screen.findByText('成功 2', {}, { timeout: 3500 })).toBeInTheDocument();
    expect(polls).toBe(1);
    resolveRetry(json({ batch: staleRetry }));
    await waitFor(() => expect(window.location.search).not.toContain('retryRequestId='));
    expect(screen.getByText('成功 2')).toBeInTheDocument();
    expect(screen.getByText('失败 0')).toBeInTheDocument();
  });

  it('keeps historical batch selection locked while an exact failed-retry request is unresolved', async () => {
    const initial = preloginBatch([{ status: 'failed', stage: 'launch' }]);
    const historical = preloginBatch([{ status: 'applied', stage: 'page_ready' }]);
    historical.batchId = '66b8000000000000000008ef';
    historical.requestId = '55555555-5555-4555-8555-555555555555';
    if (historical.projection) {
      historical.projection.batchId = historical.batchId;
      historical.projection.requestId = historical.requestId;
    }
    vi.stubGlobal('crypto', { randomUUID: () => '66666666-6666-4666-8666-666666666666' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST' && url.endsWith(`/prelogin-batches/${initial.batchId}/retry`)) {
          throw new TypeError('retry response lost');
        }
        if (url.endsWith('/seat-plans')) return json(PLAN_RESPONSE);
        if (url.endsWith('/seat-assignments')) return json(PUBLISHED_ASSIGNMENT_RESPONSE);
        if (url.endsWith('/prelogin-latest')) return json({ batch: initial });
        if (url.endsWith('/prelogin-batches')) return json({ batches: [historical, initial] });
        if (url.endsWith(`/prelogin-batches/${initial.batchId}`)) return json({ batch: initial });
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '查看历史批次' }));
    const historicalButton = (await screen.findByText(historical.requestId)).closest('button');
    if (!historicalButton) throw new Error('historical batch button missing');
    expect(historicalButton).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '只重试 1 个失败项' }));
    expect(await screen.findByText(/结果未知，已保留同一失败重试请求/)).toBeInTheDocument();
    expect(historicalButton).toBeDisabled();
    expect(window.location.search).toContain('retryRequestId=66666666-6666-4666-8666-666666666666');
    expect(screen.getByText(`batch ${initial.batchId}`)).toBeInTheDocument();
  });

  it('ignores an old batch poll after the teacher selects a different historical batch', async () => {
    const first = preloginBatch([{ status: 'sent', stage: 'launch' }]);
    const firstLate = preloginBatch([{ status: 'applied', stage: 'page_ready' }]);
    firstLate.revision = 3;
    if (firstLate.projection) firstLate.projection.projectionRevision = 2;
    const selected = preloginBatch([{ status: 'applied', stage: 'page_ready' }]);
    selected.batchId = '66b8000000000000000008f0';
    selected.requestId = '44444444-4444-4444-8444-444444444444';
    if (selected.projection) {
      selected.projection.batchId = selected.batchId;
      selected.projection.requestId = selected.requestId;
    }
    let resolvePoll!: (response: Response) => void;
    const pollResponse = new Promise<Response>((resolve) => {
      resolvePoll = resolve;
    });
    let pollStarted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/seat-plans')) return json(PLAN_RESPONSE);
        if (url.endsWith('/seat-assignments')) return json(PUBLISHED_ASSIGNMENT_RESPONSE);
        if (url.endsWith('/prelogin-latest')) return json({ batch: first });
        if (url.endsWith('/prelogin-batches')) return json({ batches: [selected, first] });
        if (url.endsWith(`/prelogin-batches/${first.batchId}`)) {
          pollStarted = true;
          return pollResponse;
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '查看历史批次' }));
    await waitFor(() => expect(screen.getByText(selected.requestId)).toBeInTheDocument());
    await waitFor(() => expect(pollStarted).toBe(true), { timeout: 3500 });
    const historyButton = screen.getByText(selected.requestId).closest('button');
    if (!historyButton) throw new Error('historical batch button missing');
    await user.click(historyButton);
    expect(window.location.search).toContain(`batchId=${selected.batchId}`);
    resolvePoll(json({ batch: firstLate }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(screen.getByText(`batch ${selected.batchId}`)).toBeInTheDocument();
    expect(window.location.search).toContain(`batchId=${selected.batchId}`);
  });

  it('continues polling after the first dispatch completes until every endpoint reaches a real terminal stage', async () => {
    const queued = preloginBatch([{ status: 'queued', stage: 'dispatch' }]);
    const complete = preloginBatch([{ status: 'applied', stage: 'page_ready' }]);
    if (complete.projection) complete.projection.projectionRevision = 2;
    let batchPolls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/seat-plans')) return json(PLAN_RESPONSE);
        if (url.endsWith('/seat-assignments')) return json(PUBLISHED_ASSIGNMENT_RESPONSE);
        if (url.endsWith('/prelogin-latest')) return json({ batch: queued });
        if (url.endsWith(`/prelogin-batches/${queued.batchId}`)) {
          batchPolls += 1;
          return json({ batch: complete });
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    renderPage();

    expect(await screen.findByText('在途 1')).toBeInTheDocument();
    expect(await screen.findByText('成功 1', {}, { timeout: 3500 })).toBeInTheDocument();
    expect(batchPolls).toBe(1);
  });

  it('does not create a second request for an already confirmed published assignment', async () => {
    const existing = preloginBatch([{ status: 'applied', stage: 'page_ready' }]);
    let confirmPosts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/seat-plans')) return json(PLAN_RESPONSE);
        if (url.endsWith('/seat-assignments')) return json(PUBLISHED_ASSIGNMENT_RESPONSE);
        if (url.endsWith('/prelogin-latest')) return json({ batch: existing });
        if (init?.method === 'POST' && url.endsWith('/prelogin/prepare')) {
          return json({ preparation: preloginPreparation(1), workflow: preloginWorkflow(1), v2WriterEnabled: true, workflowWriterEnabled: true });
        }
        if (init?.method === 'POST' && url.endsWith('/prelogin/confirm')) {
          confirmPosts += 1;
          return json({ batch: existing });
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('成功 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '运行终端预检' }));
    const confirm = await screen.findByRole('button', { name: '步骤 7：一键预启动全部终端' });
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(confirmPosts).toBe(0);
  });

  it('resumes a persisted dispatching batch from its frozen identity after a page reload', async () => {
    const dispatching = preloginBatch([
      { status: 'queued', stage: 'dispatch' },
      { status: 'queued', stage: 'dispatch' },
      { status: 'queued', stage: 'dispatch' },
      { status: 'queued', stage: 'dispatch' },
    ]);
    dispatching.state = 'dispatching';
    (dispatching as { projection: unknown }).projection = null;
    dispatching.subjects = dispatching.subjects.slice(0, 2);
    dispatching.retryableTicketIds = [];
    let resumeBody: Record<string, unknown> | null = null;
    const completed = preloginBatch([
      { status: 'sent', stage: 'launch' },
      { status: 'sent', stage: 'launch' },
      { status: 'queued', stage: 'dispatch' },
      { status: 'queued', stage: 'dispatch' },
    ]);
    completed.batchId = dispatching.batchId;
    completed.requestId = dispatching.requestId;
    completed.assignment = { ...dispatching.assignment };
    completed.preparationFingerprint = dispatching.preparationFingerprint;
    if (!dispatching.workflow) throw new Error('dispatching fixture requires a P2.9 workflow');
    completed.workflow = { ...dispatching.workflow };
    if (completed.projection) {
      completed.projection.batchId = completed.batchId;
      completed.projection.requestId = completed.requestId;
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/prelogin/confirm')) {
        resumeBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json({ batch: completed });
      }
      if (url.endsWith('/seat-plans')) return json(PLAN_RESPONSE);
      if (url.endsWith('/seat-assignments')) return json(PUBLISHED_ASSIGNMENT_RESPONSE);
      if (url.endsWith('/prelogin-latest')) return json({ batch: dispatching });
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    expect(await screen.findByText('逐终端结果')).toBeInTheDocument();
    expect(resumeBody).toEqual({
      assignmentRevision: dispatching.assignment.revision,
      preparationFingerprint: dispatching.preparationFingerprint,
      workflowFingerprint: dispatching.workflow?.fingerprint,
      requestId: dispatching.requestId,
    });
    expect(screen.getByText('未处理 0')).toBeInTheDocument();
    expect(screen.getByText('失败 0')).toBeInTheDocument();
    expect(window.location.search).toContain(`batchId=${dispatching.batchId}`);
    expect(window.location.search).not.toContain('requestId=');
  });

  it('keeps external exams usable while marking prelogin explicitly not applicable', async () => {
    const externalPlan = {
      ...PLAN_RESPONSE,
      event: { ...PLAN_RESPONSE.event, type: 'external', contestAudienceState: 'not-applicable' },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.includes('/prelogin/')) throw new Error('external exam must not call prelogin');
      if (url.endsWith('/seat-plans')) return json(externalPlan);
      if (url.endsWith('/seat-assignments')) return json(PUBLISHED_ASSIGNMENT_RESPONSE);
      if (url.endsWith('/prelogin-latest')) return json({ batch: null });
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    expect(await screen.findByText('预登录不适用')).toBeInTheDocument();
    expect(screen.getByText(/外部考试没有受信 Contest 工作台/)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input, init]) => String(input).includes('/prelogin/') && (init as RequestInit | undefined)?.method === 'POST'),
    ).toBe(false);
  });

  it('keeps legacy writers absent while preserving historical CSV export formatting', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', fetchFixture(bodies));
    renderPage();
    await screen.findByText('20260001');

    expect(screen.queryByRole('button', { name: '重新随机未锁定座位' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发布版本 1' })).not.toBeInTheDocument();
    expect(bodies).toEqual([]);

    expect(
      assignmentCsv(
        [
          {
            boundUserId: 21,
            studentId: '20260001',
            realName: '张三',
            classroomId: '66b800000000000000000806',
            sourceSeatId: 'seat-01',
            seatLabel: 'A01',
            endpointId: 'endpoint-01',
          },
          {
            boundUserId: 22,
            studentId: '20260002',
            realName: '李四',
            classroomId: '66b800000000000000000806',
            sourceSeatId: 'seat-02',
            seatLabel: 'A02',
            endpointId: 'endpoint-02',
          },
        ],
        1,
      ),
    ).toContain('20260001,张三,A01,seat-01,endpoint-01,1');
    expect(
      assignmentCsv(
        [
          {
            boundUserId: 21,
            studentId: '=HYPERLINK("https://evil")',
            realName: '+cmd',
            classroomId: '66b800000000000000000806',
            sourceSeatId: '@seat',
            seatLabel: '-1',
            endpointId: '\tbad',
          },
        ],
        1,
      ),
    ).toContain("'=HYPERLINK");
  });
});
