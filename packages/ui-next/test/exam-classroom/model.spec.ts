import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  STATUS_DOT,
  STATUS_LABELS,
  STATUS_STYLES,
  deriveSeatViews,
  pairingProgress,
  parseBinding,
  parsePairingWindow,
  parseState,
  readClassroomMode,
  recentOperations,
  remainingLabel,
  seatFilterCounts,
  seatHistory,
  seatMatchesFilter,
  writeClassroomMode,
  type SeatHistoryEntry,
  type SeatView,
} from '../../src/pages/exam-classroom/model.ts';

const CLASSROOM_ID = '66b800000000000000000701';
const SCHOOL_ID = '66b800000000000000000702';
const NOW = Date.parse('2026-08-11T00:00:00.000Z');

function historyItem(
  revision: number,
  action: 'bind' | 'replace' | 'unbind',
  at: string,
  endpointId: string | null,
  previousEndpointId: string | null,
  actorUid = 2,
): Record<string, unknown> {
  return { revision, action, actorUid, at, endpointId, previousEndpointId };
}

function bindingPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const history: Array<Record<string, unknown>> = [
    historyItem(1, 'bind', '2026-08-11T01:00:00.000Z', 'ep_online_00000001', null),
  ];
  return {
    bindingId: '66b800000000000000000711',
    sourceSeatId: 'seat-1',
    status: 'active',
    endpointId: 'ep_online_00000001',
    revision: 1,
    history,
    updatedAt: '2026-08-11T01:00:00.000Z',
    ...overrides,
  };
}

function seat(sourceSeatId: string, label: string, x: number): Record<string, unknown> {
  return { sourceSeatId, label, x, y: 0, rotation: 0, status: 'active' };
}

function enabledEntry(sourceSeatId: string): Record<string, unknown> {
  return { sourceSeatId, enabled: true, facing: 'unset', disabledReason: null, note: null };
}

function profile(entries: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    schemaVersion: 1,
    domainId: 'system',
    schoolId: SCHOOL_ID,
    classroomId: CLASSROOM_ID,
    layoutRevision: 3,
    layoutFingerprint: 'a'.repeat(64),
    revision: 0,
    previousRevision: null,
    entries,
    fingerprint: 'f'.repeat(64),
    persisted: false,
    createdAt: null,
    createdBy: null,
  };
}

function pairingEntry(
  sourceSeatId: string,
  status: string,
  mode: string,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sourceSeatId,
    mode,
    status,
    revision: 1,
    codeHint: '12',
    expectedBindingRevision: 0,
    claimedEndpointId: null,
    claimedAt: null,
    bindingRevision: null,
    completedAt: null,
    ...extras,
  };
}

function pairingWindow(entries: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    windowId: '66b800000000000000000720',
    status: 'open',
    revision: 3,
    expiresAt: '2026-08-11T02:00:00.000Z',
    entries,
    createdAt: '2026-08-11T00:00:00.000Z',
    createdBy: 2,
    closedAt: null,
    closedBy: null,
  };
}

function stateFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const seat1History: Array<Record<string, unknown>> = [
    historyItem(1, 'bind', '2026-08-11T01:00:00.000Z', 'ep_online_00000001', null, 2),
    historyItem(2, 'unbind', '2026-08-11T02:00:00.000Z', null, 'ep_online_00000001', 4),
    historyItem(3, 'replace', '2026-08-11T03:00:00.000Z', 'ep_new_000000000001', 'ep_online_00000001', 7),
  ];
  const seat2History: Array<Record<string, unknown>> = [
    historyItem(1, 'bind', '2026-08-12T00:00:00.000Z', 'ep_offline_0000002', null, 3),
  ];
  const seat3History: Array<Record<string, unknown>> = [
    historyItem(2, 'unbind', '2026-08-10T00:00:00.000Z', null, 'ep_old_0000000003', 5),
  ];
  const bindings: Array<Record<string, unknown>> = [
    {
      bindingId: '66b800000000000000000711',
      sourceSeatId: 'seat-1',
      status: 'active',
      endpointId: 'ep_online_00000001',
      revision: 3,
      history: seat1History,
      updatedAt: '2026-08-11T03:00:00.000Z',
    },
    {
      bindingId: '66b800000000000000000712',
      sourceSeatId: 'seat-2',
      status: 'active',
      endpointId: 'ep_offline_0000002',
      revision: 1,
      history: seat2History,
      updatedAt: '2026-08-12T00:00:00.000Z',
    },
    {
      bindingId: '66b800000000000000000713',
      sourceSeatId: 'seat-3',
      status: 'unbound',
      endpointId: null,
      revision: 2,
      history: seat3History,
      updatedAt: '2026-08-10T00:00:00.000Z',
    },
  ];
  const items: Array<Record<string, unknown>> = [
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
  ];
  const references: Array<Record<string, unknown>> = [
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
  ];
  const seats: Array<Record<string, unknown>> = [
    seat('seat-1', 'A-01', 0),
    seat('seat-2', 'A-02', 1),
    seat('seat-3', '很长的座位显示名称 A-03', 2),
  ];
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
        seats,
        decorations: [],
      },
    },
    bindings,
    pairingWindow: null,
    references,
    endpointPreflight: { state: 'unavailable', items },
    seatOperationalProfile: profile([enabledEntry('seat-1'), enabledEntry('seat-2'), enabledEntry('seat-3')]),
    ...overrides,
  };
}

function viewFor(sourceSeatId: string, overrides: Record<string, unknown> = {}) {
  const views = deriveSeatViews(parseState(stateFixture(overrides)), NOW);
  const view = views.find((item: SeatView) => item.seat.sourceSeatId === sourceSeatId);
  expect(view).toBeDefined();
  if (!view) throw new TypeError(`missing seat view ${sourceSeatId}`);
  return view;
}

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('exam classroom model', () => {
  it('labels an unavailable bound seat as unchecked instead of unknown danger', () => {
    expect(STATUS_LABELS.unknown).toBe('已绑定 · 未检测在线状态');
    expect(STATUS_DOT.unknown).toEqual({ tone: 'neutral' });
    expect(STATUS_STYLES.unknown).toBe('border-success-line bg-surface text-fg hover:bg-surface hover:text-fg');
  });

  it('parses omitted or null binding audit fields as null and keeps real values', () => {
    const omitted = parseBinding(bindingPayload());
    expect(omitted.createdAt).toBeNull();
    expect(omitted.createdBy).toBeNull();
    expect(omitted.updatedBy).toBeNull();

    const cleared = parseBinding(bindingPayload({ createdAt: null, createdBy: null, updatedBy: null }));
    expect(cleared.createdAt).toBeNull();
    expect(cleared.createdBy).toBeNull();
    expect(cleared.updatedBy).toBeNull();

    const stamped = parseBinding(bindingPayload({
      createdAt: '2026-08-11T00:30:00.000Z',
      createdBy: 2,
      updatedBy: 3,
    }));
    expect(stamped.createdAt).toBe('2026-08-11T00:30:00.000Z');
    expect(stamped.createdBy).toBe(2);
    expect(stamped.updatedBy).toBe(3);

    const boundary = parseBinding(bindingPayload({ createdAt: '', createdBy: 0, updatedBy: 0 }));
    expect(boundary.createdAt).toBe('');
    expect(boundary.createdBy).toBe(0);
    expect(boundary.updatedBy).toBe(0);
  });

  it('rejects binding audit fields that are not strings or safe integers', () => {
    expect(() => parseBinding(bindingPayload({ createdBy: 'x' }))).toThrow(/^终端绑定响应格式不正确$/);
    expect(() => parseBinding(bindingPayload({ createdAt: 1 }))).toThrow(/^终端绑定响应格式不正确$/);
    expect(() => parseBinding(bindingPayload({ updatedBy: 1.5 }))).toThrow(/^终端绑定响应格式不正确$/);
  });

  it('derives unknown for unavailable preflight and counts bound seats separately from online', () => {
    const views = deriveSeatViews(parseState(stateFixture()), NOW);
    expect(views.find((view: SeatView) => view.seat.sourceSeatId === 'seat-1')?.status).toBe('unknown');
    expect(views.find((view: SeatView) => view.seat.sourceSeatId === 'seat-2')?.status).toBe('unknown');
    expect(views.find((view: SeatView) => view.seat.sourceSeatId === 'seat-3')?.status).toBe('unbound');
    const counts = seatFilterCounts(views);
    expect(counts.bound).toBe(2);
    expect(counts.unbound).toBe(1);
    expect(counts.all).toBe(3);
    expect(counts.online).toBe(0);
  });

  it('matches disabled seats and open unbound seats without treating identity changes as pairing', () => {
    const disabled = viewFor('seat-3', {
      seatOperationalProfile: profile([
        enabledEntry('seat-1'),
        enabledEntry('seat-2'),
        { sourceSeatId: 'seat-3', enabled: false, facing: 'unset', disabledReason: 'computer_failure', note: null },
      ]),
    });
    expect(disabled.operational.enabled).toBe(false);
    expect(seatMatchesFilter(disabled, 'disabled')).toBe(true);
    expect(seatMatchesFilter(viewFor('seat-1'), 'disabled')).toBe(false);

    const pairing = viewFor('seat-3', {
      pairingWindow: pairingWindow([pairingEntry('seat-3', 'open', 'bind')]),
    });
    expect(pairing.status).toBe('unbound');
    expect(pairing.entry?.status).toBe('open');
    expect(seatMatchesFilter(pairing, 'pairing')).toBe(true);
    expect(seatMatchesFilter(pairing, 'unbound')).toBe(true);
    expect(seatMatchesFilter(pairing, 'online')).toBe(false);
    expect(seatMatchesFilter(pairing, 'all')).toBe(true);

    const replacement = viewFor('seat-1', {
      pairingWindow: pairingWindow([
        pairingEntry('seat-1', 'claimed', 'replace', {
          claimedEndpointId: 'ep_new_000000000001',
          claimedAt: '2026-08-11T00:30:00.000Z',
        }),
      ]),
    });
    expect(replacement.status).toBe('identity-change');
    expect(replacement.entry?.status).toBe('claimed');
    expect(seatMatchesFilter(replacement, 'pairing')).toBe(false);
    expect(seatMatchesFilter(replacement, 'identity-change')).toBe(true);

    const conflict = viewFor('seat-3', {
      pairingWindow: pairingWindow([pairingEntry('seat-3', 'open', 'replace')]),
    });
    expect(conflict.status).toBe('conflict');
    expect(conflict.entry?.status).toBe('open');
    expect(seatMatchesFilter(conflict, 'pairing')).toBe(false);
    expect(seatMatchesFilter(conflict, 'conflict')).toBe(true);
  });

  it('returns one seat history newest first with the replace action label', () => {
    const history = seatHistory(parseState(stateFixture()), 'seat-1');
    expect(history.map((item: SeatHistoryEntry) => item.at)).toEqual([
      '2026-08-11T03:00:00.000Z',
      '2026-08-11T02:00:00.000Z',
      '2026-08-11T01:00:00.000Z',
    ]);
    expect(history.map((item: SeatHistoryEntry) => [item.action, item.label])).toEqual([
      ['replace', '确认换机'],
      ['unbind', '解除绑定'],
      ['bind', '建立绑定'],
    ]);
    expect(history[0]).toMatchObject({
      key: '66b800000000000000000711:3',
      seatLabel: 'A-01',
      endpointId: 'ep_new_000000000001',
      previousEndpointId: 'ep_online_00000001',
      actorUid: 7,
    });
  });

  it('limits recent operations to the single newest classroom entry', () => {
    const latest = recentOperations(parseState(stateFixture()), 1);
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({
      key: '66b800000000000000000712:1',
      at: '2026-08-12T00:00:00.000Z',
      action: 'bind',
      label: '建立绑定',
      seatLabel: 'A-02',
      endpointId: 'ep_offline_0000002',
      previousEndpointId: null,
      actorUid: 3,
    });
  });

  it('counts pairing entry statuses', () => {
    const entries: Array<Record<string, unknown>> = [
      pairingEntry('seat-1', 'bound', 'bind'),
      pairingEntry('seat-2', 'cancelled', 'bind'),
      pairingEntry('seat-3', 'claimed', 'replace', { claimedEndpointId: 'ep_new_000000000001' }),
      pairingEntry('seat-4', 'open', 'bind'),
    ];
    const parsed = parsePairingWindow(pairingWindow(entries));
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(pairingProgress(parsed)).toEqual({ total: 4, bound: 1, cancelled: 1, claimed: 1, open: 1 });
  });

  it('formats remaining pairing time as m:ss and expiry as 已到期', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    expect(remainingLabel('2026-01-01T00:04:12.000Z', now)).toBe('4:12');
    expect(remainingLabel('2026-01-01T00:00:05.000Z', now)).toBe('0:05');
    expect(remainingLabel('2026-01-01T00:00:00.000Z', now)).toBe('已到期');
    expect(remainingLabel('2025-12-31T23:59:59.000Z', now)).toBe('已到期');
    expect(remainingLabel('2026-01-01T00:00:00.500Z', now)).toMatch(/^\d+:\d{2}$/);
  });

  it('reads config mode only from an exact mode=config query', () => {
    expect(readClassroomMode('http://x/c?mode=config')).toBe('config');
    expect(readClassroomMode('http://x/c?mode=bind')).toBe('bind');
    expect(readClassroomMode('http://x/c')).toBe('bind');
    expect(readClassroomMode('http://x/c?mode=other')).toBe('bind');
    expect(readClassroomMode('http://x/c?mode=Config')).toBe('bind');
    expect(readClassroomMode('http://x/c?mode=CONFIG')).toBe('bind');
    expect(readClassroomMode('http://x/c?mode=config2')).toBe('bind');
  });

  it('writes config mode into the url and removes it without dropping seat', () => {
    window.history.replaceState({}, '', `/admin/exam-infrastructure/classrooms/${CLASSROOM_ID}?seat=seat-2`);
    const historyLength = window.history.length;
    writeClassroomMode('config');
    const configured = new URLSearchParams(window.location.search);
    expect(configured.get('mode')).toBe('config');
    expect(configured.get('seat')).toBe('seat-2');

    writeClassroomMode('bind');
    const bound = new URLSearchParams(window.location.search);
    expect(bound.has('mode')).toBe(false);
    expect(bound.get('seat')).toBe('seat-2');
    expect(window.history.length).toBe(historyLength);
  });

  it('keeps the classroom model inside the design gate', () => {
    // Vitest rewrites design-gate.mjs under jsdom, so run the gate in a plain Node process.
    const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', 'src/pages/exam-classroom/model.ts'], {
      cwd: resolve(import.meta.dirname, '../..'),
      encoding: 'utf8',
    });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  });
});
