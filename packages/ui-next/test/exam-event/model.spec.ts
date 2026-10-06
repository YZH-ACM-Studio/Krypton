// @vitest-environment node
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { expectExplicitButtonVariants, expectGateClean } from '../design/helpers.ts';
import {
  endpointLocation,
  endpointLocations,
  latestPolicyRevision,
  latestTargetRevision,
  parseEvent,
  parseExecution,
  parsePreflightResponse,
  parseTemplate,
  requestedEventPanel,
  samePolicy,
  sameSources,
  sourceSummary,
  type PreflightItem,
  type TargetAssignment,
} from '../../src/pages/exam-event/model.ts';
import { PreflightReadinessBadge } from '../../src/pages/exam-event/shared.tsx';

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

function executionFixture(items: unknown[], operation: Record<string, unknown> = {}) {
  return {
    executionId: '66b800000000000000000610',
    revision: 3,
    networkPolicyRevision: 2,
    desiredState: 'active',
    policyRef: { id: '66b800000000000000000611', revision: 2, fingerprint: 'a'.repeat(64) },
    targetRef: { id: '66b800000000000000000612', revision: 1, fingerprint: 'b'.repeat(64) },
    startAt: EVENT.startAt,
    hardEndAt: EVENT.endAt,
    operation: { kind: 'apply', status: 'received', failureReason: null, ...operation },
    projection: {
      revision: 3,
      dispatchStatus: 'complete',
      summary: { applied: items.length },
      items,
      receivedAt: '2026-08-11T03:00:00.000Z',
    },
  };
}

function policyTemplateFixture(overrides: Record<string, unknown> = {}) {
  return {
    templateId: '66b800000000000000000611',
    name: '考试策略',
    status: 'active',
    revision: 2,
    collaboratorUids: [] as number[],
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

const POLICY_REF = { id: '66b800000000000000000611', revision: 2, fingerprint: 'a'.repeat(64) };
const TARGET_REF = { id: '66b800000000000000000612', revision: 1, fingerprint: 'b'.repeat(64) };
const CLASSROOMS = [{ classroomId: 'c1', schoolId: 's', name: '机房 A301', layoutRevision: 1, seatCount: 48 }];

describe('exam event model', () => {
  it('parses created and archive fields from the event fixture', () => {
    const event = parseEvent(EVENT);
    expect(event.createdAt).toBe('2026-08-10T01:00:00.000Z');
    expect(event.createdBy).toBe(2);
    expect(event.updatedBy).toBe(2);
    expect(event.archivedAt).toBeNull();
    expect(event.archivedBy).toBeNull();
  });

  it('treats omitted audit fields as null', () => {
    const { createdAt, createdBy, updatedBy, archivedAt, archivedBy, ...rest } = EVENT;
    expect(createdAt).toBe('2026-08-10T01:00:00.000Z');
    expect(createdBy).toBe(2);
    expect(updatedBy).toBe(2);
    expect(archivedAt).toBeNull();
    expect(archivedBy).toBeNull();
    const event = parseEvent(rest);
    expect(event.createdAt).toBeNull();
    expect(event.createdBy).toBeNull();
    expect(event.updatedBy).toBeNull();
    expect(event.archivedAt).toBeNull();
    expect(event.archivedBy).toBeNull();
  });

  it('rejects a non-integer createdBy with the event format error', () => {
    expect(() => parseEvent({ ...EVENT, createdBy: 'x' })).toThrow(/^考试活动响应格式不正确$/);
  });

  it('parses template owner and draft audit fields', () => {
    const bare = parseTemplate(policyTemplateFixture());
    expect(bare.draft.updatedAt).toBeNull();
    expect(bare.draft.updatedBy).toBeNull();
    expect(bare.ownerUid).toBeNull();

    const stamped = parseTemplate(policyTemplateFixture({
      ownerUid: 2,
      draft: {
        version: 2,
        policy: { hosts: [], ips: [], ports: [] },
        fingerprint: 'c'.repeat(64),
        updatedAt: '2026-08-11T02:00:00.000Z',
        updatedBy: 3,
      },
    }));
    expect(stamped.draft.updatedAt).toBe('2026-08-11T02:00:00.000Z');
    expect(stamped.draft.updatedBy).toBe(3);
    expect(stamped.ownerUid).toBe(2);
  });

  it('parses execution operation timestamps', () => {
    expect(parseExecution(executionFixture([]))?.operation.requestedAt).toBeNull();
    expect(parseExecution(executionFixture([], { requestedAt: '2026-08-11T03:30:00.000Z' }))?.operation.requestedAt).toBe(
      '2026-08-11T03:30:00.000Z',
    );
    expect(parseExecution(executionFixture([]))?.operation.receivedAt).toBeNull();
    expect(parseExecution(executionFixture([]))?.operation.failedAt).toBeNull();
    const stamped = parseExecution(executionFixture([], {
      receivedAt: '2026-08-11T03:40:00.000Z',
      failedAt: '2026-08-11T03:45:00.000Z',
    }));
    expect(stamped?.operation.receivedAt).toBe('2026-08-11T03:40:00.000Z');
    expect(stamped?.operation.failedAt).toBe('2026-08-11T03:45:00.000Z');
  });

  it('reads the requested event panel without treating an unknown panel as a step', () => {
    expect(requestedEventPanel('http://x/e?panel=run')).toBe('run');
    expect(requestedEventPanel('http://x/e?panel=basics')).toBe('basics');
    expect(requestedEventPanel('http://x/e?panel=policy')).toBe('policy');
    expect(requestedEventPanel('http://x/e?panel=targets')).toBe('targets');
    expect(requestedEventPanel('http://x/e?panel=bad')).toBeNull();
    expect(requestedEventPanel('http://x/e#target-assignment')).toBe('targets');
    expect(requestedEventPanel('http://x/e?examSeatAssignmentId=abc')).toBe('targets');
    expect(requestedEventPanel('http://x/e')).toBeNull();
    expect(requestedEventPanel('http://x/e?panel=run#target-assignment')).toBe('run');
    expect(requestedEventPanel('http://x/e?panel=policy&examSeatAssignmentId=abc')).toBe('policy');
  });

  it('compares policies after sorting hosts, ips, and ports', () => {
    expect(samePolicy(
      { hosts: ['b', 'a'], ips: [], ports: [443, 80] },
      { hosts: ['a', 'b'], ips: [], ports: [80, 443] },
    )).toBe(true);
    expect(samePolicy(
      { hosts: ['b', 'a'], ips: [], ports: [443, 80] },
      { hosts: ['a', 'b'], ips: [], ports: [80, 81] },
    )).toBe(false);
    expect(samePolicy(
      { hosts: ['a'], ips: ['10.0.0.2', '10.0.0.1'], ports: [80] },
      { hosts: ['a'], ips: ['10.0.0.1', '10.0.0.2'], ports: [80] },
    )).toBe(true);
    expect(samePolicy(
      { hosts: ['a'], ips: ['10.0.0.1'], ports: [80] },
      { hosts: ['a'], ips: ['10.0.0.2'], ports: [80] },
    )).toBe(false);
  });

  it('compares source groups after sorting ids and groups', () => {
    expect(sameSources(
      [{ kind: 'endpoint', ids: ['b', 'a'] }],
      [{ kind: 'endpoint', ids: ['a', 'b'] }],
    )).toBe(true);
    expect(sameSources(
      [{ kind: 'endpoint', ids: ['a', 'b'] }],
      [{ kind: 'classroom', ids: ['a', 'b'] }],
    )).toBe(false);
    expect(sameSources([], [])).toBe(true);
    expect(sameSources(
      [
        { kind: 'endpoint', ids: ['b', 'a'] },
        { kind: 'classroom', ids: ['c1'] },
      ],
      [
        { kind: 'classroom', ids: ['c1'] },
        { kind: 'endpoint', ids: ['a', 'b'] },
      ],
    )).toBe(true);
  });

  it('labels a bound endpoint and leaves an unknown endpoint unnamed', () => {
    const locations = endpointLocations([{ endpointId: 'e1', label: 'A301 / 1-1' }]);
    expect(endpointLocation('e1', locations)).toBe('A301 / 1-1');
    expect(endpointLocation('missing', locations)).toBe('位置未知');
  });

  it('summarizes one classroom by name and other sources by count', () => {
    expect(sourceSummary([{ kind: 'classroom', ids: ['c1'] }], CLASSROOMS)).toBe('机房 A301');
    expect(sourceSummary([{ kind: 'endpoint', ids: ['a', 'b'] }], CLASSROOMS)).toBe('指定终端 2 项');
    expect(sourceSummary([], CLASSROOMS)).toBe('无');
    expect(sourceSummary([
      { kind: 'classroom', ids: ['c1'] },
      { kind: 'endpoint', ids: ['a', 'b'] },
    ], CLASSROOMS)).toBe('机房 A301、指定终端 2 项');
  });

  it('rejects a preflight payload with the legacy identity and item errors', () => {
    expect(() => parsePreflightResponse({
      preflight: [],
      preflightConfig: { revision: 1, policy: POLICY_REF, target: null },
    })).toThrow(/^预检配置身份不正确$/);
    expect(() => parsePreflightResponse({
      preflight: [{
        endpointId: 'endpoint-001',
        ready: true,
        reason: 'ready',
        online: true,
        compatible: 'yes',
        serviceVersion: '0.3.0',
      }],
      preflightConfig: { revision: 1, policy: POLICY_REF, target: TARGET_REF },
    })).toThrow(/^预检响应格式不正确$/);
  });

  it('returns no latest policy revision when nothing is published', () => {
    expect(latestPolicyRevision(parseTemplate(policyTemplateFixture({ latestPublishedRevision: null })))).toBeNull();
    expect(latestPolicyRevision(parseTemplate(policyTemplateFixture()))).toEqual({
      revision: 1,
      policy: { hosts: [], ips: [], ports: [443] },
      fingerprint: 'a'.repeat(64),
      publishedAt: '2026-08-11T02:00:00.000Z',
    });
    const older = {
      revision: 1,
      policy: { hosts: [], ips: [], ports: [443] },
      fingerprint: 'a'.repeat(64),
      publishedAt: '2026-08-11T02:00:00.000Z',
    };
    const newer = {
      revision: 2,
      policy: { hosts: ['oj.example'], ips: [], ports: [80] },
      fingerprint: 'd'.repeat(64),
      publishedAt: '2026-08-11T04:00:00.000Z',
    };
    expect(latestPolicyRevision(parseTemplate(policyTemplateFixture({
      latestPublishedRevision: 2,
      revisions: [older, newer],
    })))).toEqual(newer);
    expect(latestPolicyRevision(parseTemplate(policyTemplateFixture({
      latestPublishedRevision: 9,
      revisions: [older],
    })))).toBeNull();
  });

  it('returns the target snapshot that matches latestPublishedRevision', () => {
    const older = {
      revision: 1,
      sources: [{ kind: 'endpoint' as const, ids: ['e1'] }],
      targetFingerprint: 'a'.repeat(64),
      endpointIds: ['e1'],
      targetCount: 1,
      publishedAt: '2026-08-11T02:00:00.000Z',
    };
    const newer = {
      revision: 2,
      sources: [{ kind: 'classroom' as const, ids: ['c1'] }],
      targetFingerprint: 'b'.repeat(64),
      endpointIds: ['e2'],
      targetCount: 1,
      publishedAt: '2026-08-11T04:00:00.000Z',
    };
    const assignment: TargetAssignment = {
      assignmentId: '66b800000000000000000612',
      revision: 2,
      draft: { version: 1, sources: newer.sources, updatedAt: null, updatedBy: null },
      revisions: [older, newer],
      latestPublishedRevision: 2,
    };
    expect(latestTargetRevision(assignment)).toEqual(newer);
    expect(latestTargetRevision({ ...assignment, latestPublishedRevision: null })).toBeNull();
    expect(latestTargetRevision(null)).toBeNull();
  });

  it('labels preflight readiness as ready, unknown, or blocked', () => {
    const item = (ready: boolean, compatible: boolean | null): PreflightItem => ({
      endpointId: 'endpoint-001',
      ready,
      reason: ready ? 'ready' : 'offline',
      online: ready,
      compatible,
      serviceVersion: '0.3.0',
    });
    const markup = (ready: boolean, compatible: boolean | null) => renderToStaticMarkup(
      createElement(PreflightReadinessBadge, { item: item(ready, compatible) }),
    );
    expect(markup(true, true)).toContain('>就绪<');
    expect(markup(true, true)).toContain('data-tone="success"');
    expect(markup(false, null)).toContain('>未知<');
    expect(markup(false, null)).toContain('data-tone="neutral"');
    expect(markup(false, false)).toContain('>阻塞<');
    expect(markup(false, false)).toContain('data-tone="danger"');
  });

  it('keeps the event model and shared components inside the design gate', () => {
    expectGateClean(['src/pages/exam-event/model.ts', 'src/pages/exam-event/shared.tsx']);
    expectExplicitButtonVariants(['src/pages/exam-event/shared.tsx']);
  });
});
