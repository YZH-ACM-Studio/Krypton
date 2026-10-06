import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EVENT_PANELS,
  parseAssignment,
  parseConfig,
  parseEvent,
  parseExecution,
  parseTemplate,
  type EventPanel,
  type ExamEventView,
  type NetworkConfig,
  type NetworkExecution,
  type PolicyTemplate,
  type TargetAssignment,
} from '../../src/pages/exam-event/model.ts';

// A static import fails collection while step-status.ts is absent.
const stepStatusLoaders = import.meta.glob('../../src/pages/exam-event/step-status.ts');

const packageRoot = resolve(import.meta.dirname, '../..');
const STEP_STATUS_SOURCE = 'src/pages/exam-event/step-status.ts';
const TEMPLATE_ID = '66b800000000000000000611';
const ASSIGNMENT_ID = '66b800000000000000000612';
const OTHER_TEMPLATE_ID = '66b800000000000000000699';

type StepState = 'done' | 'attention' | 'active' | 'todo';

interface EventStepFacts {
  event: ExamEventView;
  config: NetworkConfig | null;
  templates: PolicyTemplate[];
  assignment: TargetAssignment | null;
  execution: NetworkExecution | null;
}

interface StepItem {
  id: string;
  label: string;
  summary: unknown;
  state: string;
}

interface StepStatusApi {
  eventStepItems: (facts: EventStepFacts) => StepItem[];
  defaultEventPanel: (facts: EventStepFacts, requested: EventPanel | null) => unknown;
}

interface FactsInput {
  event?: Record<string, unknown>;
  config?: Record<string, unknown> | null;
  templates?: Array<Record<string, unknown>>;
  assignment?: Record<string, unknown> | null;
  execution?: Record<string, unknown> | null;
}

const EVENT_BASE: Record<string, unknown> = {
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
  createdAt: null,
  createdBy: null,
  updatedBy: null,
  archivedAt: null,
  archivedBy: null,
};

const SAME_POLICY: Record<string, unknown> = { hosts: ['b', 'a'], ips: [], ports: [443, 80] };
const SAME_POLICY_REORDERED: Record<string, unknown> = { hosts: ['a', 'b'], ips: [], ports: [80, 443] };

function eventRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...EVENT_BASE, ...overrides };
}

function ref(id: string, revision: number): Record<string, unknown> {
  return { id, revision, fingerprint: 'a'.repeat(64) };
}

function configRecord(
  policy: Record<string, unknown> | null,
  target: Record<string, unknown> | null,
): Record<string, unknown> {
  return { revision: 1, policy, target, updatedAt: null };
}

function publishedPolicyRevision(revision: number): Record<string, unknown> {
  return {
    revision,
    policy: SAME_POLICY,
    fingerprint: revision === 1 ? 'a'.repeat(64) : 'd'.repeat(64),
    publishedAt: '2026-08-11T02:00:00.000Z',
  };
}

function policyDraft(policy: Record<string, unknown>, version = 1): Record<string, unknown> {
  return {
    version,
    policy,
    fingerprint: 'c'.repeat(64),
    updatedAt: null,
    updatedBy: null,
  };
}

function templateRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    templateId: TEMPLATE_ID,
    name: '考试策略',
    status: 'active',
    revision: 1,
    collaboratorUids: [],
    ownerUid: null,
    draft: policyDraft(SAME_POLICY_REORDERED),
    revisions: [publishedPolicyRevision(1)],
    latestPublishedRevision: 1,
    ...overrides,
  };
}

function targetRevision(revision: number, ids: string[], targetCount: number): Record<string, unknown> {
  return {
    revision,
    sources: [{ kind: 'endpoint', ids }],
    targetFingerprint: 'b'.repeat(64),
    endpointIds: ['endpoint-001'],
    targetCount,
    publishedAt: '2026-08-11T02:00:00.000Z',
  };
}

function assignmentDraft(ids: string[], kind = 'endpoint'): Record<string, unknown> {
  return {
    version: 1,
    sources: [{ kind, ids }],
    updatedAt: null,
    updatedBy: null,
  };
}

function assignmentRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    assignmentId: ASSIGNMENT_ID,
    revision: 1,
    draft: assignmentDraft(['b', 'a']),
    revisions: [targetRevision(1, ['a', 'b'], 12)],
    latestPublishedRevision: 1,
    ...overrides,
  };
}

function projectionItem(endpointId: string, status: string): Record<string, unknown> {
  return {
    endpointId,
    commandId: `command-${endpointId}`,
    command: 'apply_network_policy',
    previousPolicyRevision: 1,
    expectedPolicyRevision: 1,
    appliedPolicyRevision: status === 'applied' ? 1 : null,
    status,
    failureReason: status === 'failed' ? 'endpoint_offline' : null,
    online: status !== 'failed',
    networkPolicyState: null,
  };
}

function executionRecord(
  desiredState: string,
  items: Array<Record<string, unknown>> | null,
): Record<string, unknown> {
  return {
    executionId: '66b800000000000000000610',
    revision: 3,
    networkPolicyRevision: 1,
    desiredState,
    policyRef: ref(TEMPLATE_ID, 1),
    targetRef: ref(ASSIGNMENT_ID, 1),
    startAt: '2026-08-20T01:00:00.000Z',
    hardEndAt: '2026-08-20T04:00:00.000Z',
    operation: {
      kind: desiredState === 'stopped' ? 'stop' : 'apply',
      status: 'received',
      failureReason: null,
      requestedAt: null,
      receivedAt: null,
      failedAt: null,
    },
    projection: items === null
      ? null
      : {
        revision: 3,
        dispatchStatus: 'complete',
        summary: { applied: 99 },
        items,
        receivedAt: '2026-08-11T03:00:00.000Z',
      },
  };
}

function facts(input: FactsInput = {}): EventStepFacts {
  return {
    event: parseEvent(input.event ?? eventRecord()),
    config: parseConfig(input.config === undefined ? null : input.config),
    templates: (input.templates ?? []).map((item) => parseTemplate(item)),
    assignment: parseAssignment(input.assignment === undefined ? null : input.assignment),
    execution: parseExecution(input.execution === undefined ? null : input.execution),
  };
}

function moduleField(moduleObject: object, key: string): unknown {
  if (!(key in moduleObject)) return undefined;
  return Reflect.get(moduleObject, key) as unknown;
}

function asUnknownFunction(value: unknown, key: string): (...args: unknown[]) => unknown {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as (...args: unknown[]) => unknown;
}

function isStepItem(value: unknown): value is StepItem {
  if (typeof value !== 'object' || value === null) return false;
  const id = moduleField(value, 'id');
  const label = moduleField(value, 'label');
  const state = moduleField(value, 'state');
  return typeof id === 'string' && typeof label === 'string' && typeof state === 'string' && 'summary' in value;
}

function asStepItems(value: unknown): StepItem[] {
  expect(Array.isArray(value), 'eventStepItems').toBe(true);
  if (!Array.isArray(value)) throw new TypeError('eventStepItems must return an array');
  const items: StepItem[] = [];
  for (const item of value) {
    expect(isStepItem(item), 'step item').toBe(true);
    if (!isStepItem(item)) throw new TypeError('eventStepItems returned a non-step');
    items.push(item);
  }
  return items;
}

function stepStatusLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(stepStatusLoaders)) {
    if (key.endsWith(STEP_STATUS_SOURCE)) return load;
  }
  return undefined;
}

async function loadStepStatus(): Promise<StepStatusApi> {
  const load = stepStatusLoader();
  expect(typeof load, STEP_STATUS_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${STEP_STATUS_SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('step status module must be an object');
  const eventStepItems = asUnknownFunction(moduleField(imported, 'eventStepItems'), 'eventStepItems');
  const defaultEventPanel = asUnknownFunction(moduleField(imported, 'defaultEventPanel'), 'defaultEventPanel');
  return {
    eventStepItems: (value) => asStepItems(eventStepItems(value)),
    defaultEventPanel: (value, requested) => defaultEventPanel(value, requested),
  };
}

async function inspect(input: FactsInput = {}) {
  const api = await loadStepStatus();
  const value = facts(input);
  const items = api.eventStepItems(value);
  expect(items.map((item) => item.id)).toEqual(EVENT_PANELS.map((panel) => panel.id));
  return {
    items,
    panel(requested: EventPanel | null = null): unknown {
      return api.defaultEventPanel(value, requested);
    },
  };
}

function expectStep(items: StepItem[], id: EventPanel, state: StepState, summary: string): void {
  const found = items.find((item) => item.id === id);
  expect(found, id).toBeDefined();
  expect(found?.state).toBe(state);
  expect(found?.summary).toBe(summary);
}

function commandOutput(result: ReturnType<typeof spawnSync>): string {
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  return `${stdout}\n${stderr}`;
}

const ACTIVE_ITEMS: Array<Record<string, unknown>> = [
  projectionItem('endpoint-001', 'applied'),
  projectionItem('endpoint-002', 'applied'),
  projectionItem('endpoint-003', 'failed'),
];

describe('exam event step status', () => {
  it('marks a draft as attention and defaults to basics', async () => {
    const viewed = await inspect({ event: eventRecord({ lifecycle: 'draft', status: 'draft' }) });

    expect(viewed.items.map((item) => item.label)).toEqual(EVENT_PANELS.map((panel) => panel.label));
    expectStep(viewed.items, 'basics', 'attention', '草稿 · 尚未计划');
    expectStep(viewed.items, 'policy', 'todo', '尚未设置');
    expectStep(viewed.items, 'targets', 'todo', '尚未设置');
    expectStep(viewed.items, 'run', 'todo', '未启动');
    expect(viewed.panel(null)).toBe('basics');

    const configuredDraft = await inspect({
      event: eventRecord({ lifecycle: 'draft', status: 'scheduled' }),
      config: configRecord(ref(TEMPLATE_ID, 1), ref(ASSIGNMENT_ID, 1)),
      templates: [templateRecord()],
      assignment: assignmentRecord(),
    });
    expectStep(configuredDraft.items, 'basics', 'attention', '草稿 · 尚未计划');
    expect(configuredDraft.panel(null)).toBe('basics');
  });

  it('defaults a scheduled event to the first missing step', async () => {
    const scheduled = eventRecord();
    const noPolicy = await inspect({ event: scheduled, config: configRecord(null, null) });
    expectStep(noPolicy.items, 'basics', 'done', '已计划 · 待开始');
    expectStep(noPolicy.items, 'policy', 'todo', '尚未设置');
    expect(noPolicy.panel()).toBe('policy');

    const missingConfig = await inspect({ event: scheduled });
    expectStep(missingConfig.items, 'policy', 'todo', '尚未设置');
    expect(missingConfig.panel()).toBe('policy');

    const policyWithoutTarget = await inspect({
      event: scheduled,
      config: configRecord(ref(TEMPLATE_ID, 1), null),
    });
    expectStep(policyWithoutTarget.items, 'targets', 'todo', '尚未设置');
    expect(policyWithoutTarget.panel()).toBe('targets');

    const targetWithoutPolicy = await inspect({
      event: scheduled,
      config: configRecord(null, ref(ASSIGNMENT_ID, 3)),
    });
    expect(targetWithoutPolicy.panel()).toBe('policy');

    const both = await inspect({
      event: scheduled,
      config: configRecord(ref(TEMPLATE_ID, 1), ref(ASSIGNMENT_ID, 1)),
    });
    expectStep(both.items, 'run', 'todo', '未启动');
    expect(both.panel()).toBe('run');
  });

  it('returns the requested panel even when another step would be the default', async () => {
    const draft = await inspect({ event: eventRecord({ lifecycle: 'draft', status: 'draft' }) });
    const requested: EventPanel[] = ['basics', 'policy', 'targets', 'run'];
    for (const panel of requested) {
      expect(draft.panel(panel)).toBe(panel);
    }

    const ready = await inspect({
      event: eventRecord(),
      config: configRecord(ref(TEMPLATE_ID, 1), ref(ASSIGNMENT_ID, 1)),
    });
    expect(ready.panel('policy')).toBe('policy');
  });

  it('marks policy attention for a new draft and done when the assigned revision matches', async () => {
    const changed = await inspect({
      event: eventRecord(),
      config: configRecord(ref(TEMPLATE_ID, 1), null),
      templates: [templateRecord({
        draft: policyDraft({ hosts: ['a', 'b'], ips: [], ports: [80] }, 2),
      })],
    });
    expectStep(changed.items, 'policy', 'attention', '考试策略 · v1 生效中，有新改动');

    const matched = await inspect({
      event: eventRecord(),
      config: configRecord(ref(TEMPLATE_ID, 1), null),
      templates: [templateRecord()],
    });
    expectStep(matched.items, 'policy', 'done', '考试策略 · v1 已生效');
  });

  it('marks policy attention when nothing is published or the config revision is stale', async () => {
    const unpublished = await inspect({
      event: eventRecord(),
      config: configRecord(ref(TEMPLATE_ID, 1), null),
      templates: [templateRecord({ latestPublishedRevision: null })],
    });
    expectStep(unpublished.items, 'policy', 'attention', '考试策略 · v1 生效中，有新改动');

    const stale = await inspect({
      event: eventRecord(),
      config: configRecord(ref(TEMPLATE_ID, 1), null),
      templates: [templateRecord({
        revisions: [publishedPolicyRevision(1), publishedPolicyRevision(2)],
        latestPublishedRevision: 2,
      })],
    });
    expectStep(stale.items, 'policy', 'attention', '考试策略 · v1 生效中，有新改动');
  });

  it('uses the fallback policy name when the assigned template is absent', async () => {
    const viewed = await inspect({
      event: eventRecord(),
      config: configRecord(ref(TEMPLATE_ID, 4), null),
      templates: [templateRecord({ templateId: OTHER_TEMPLATE_ID, name: '别的策略' })],
    });
    expectStep(viewed.items, 'policy', 'done', '策略 · v4 已生效');
  });

  it('describes the assigned target count and unpublished source changes', async () => {
    const matched = await inspect({
      event: eventRecord(),
      config: configRecord(ref(TEMPLATE_ID, 1), ref(ASSIGNMENT_ID, 1)),
      assignment: assignmentRecord(),
    });
    expectStep(matched.items, 'targets', 'done', 'v1 · 12 台');

    const changed = await inspect({
      event: eventRecord(),
      config: configRecord(ref(TEMPLATE_ID, 1), ref(ASSIGNMENT_ID, 1)),
      assignment: assignmentRecord({ draft: assignmentDraft(['c1'], 'classroom') }),
    });
    expectStep(changed.items, 'targets', 'attention', 'v1 · 12 台 生效中，有新改动');

    const unpublished = await inspect({
      event: eventRecord(),
      config: configRecord(ref(TEMPLATE_ID, 1), ref(ASSIGNMENT_ID, 1)),
      assignment: assignmentRecord({ latestPublishedRevision: null }),
    });
    expectStep(unpublished.items, 'targets', 'attention', 'v1 · 12 台 生效中，有新改动');

    const stale = await inspect({
      event: eventRecord(),
      config: configRecord(ref(TEMPLATE_ID, 1), ref(ASSIGNMENT_ID, 1)),
      assignment: assignmentRecord({
        revisions: [targetRevision(1, ['a', 'b'], 5), targetRevision(2, ['a', 'b'], 8)],
        latestPublishedRevision: 2,
      }),
    });
    expectStep(stale.items, 'targets', 'attention', 'v1 · 5 台 生效中，有新改动');

    const unknownCount = await inspect({
      event: eventRecord(),
      config: configRecord(ref(TEMPLATE_ID, 1), ref(ASSIGNMENT_ID, 3)),
    });
    expectStep(unknownCount.items, 'targets', 'done', 'v3 · 数量未知');

    const unknownChanged = await inspect({
      event: eventRecord(),
      config: configRecord(ref(TEMPLATE_ID, 1), ref(ASSIGNMENT_ID, 6)),
      assignment: assignmentRecord({ revisions: [], latestPublishedRevision: null }),
    });
    expectStep(unknownChanged.items, 'targets', 'attention', 'v6 · 数量未知 生效中，有新改动');
  });

  it('marks an archived event done and interpolates other planned statuses', async () => {
    const archived = await inspect({ event: eventRecord({ lifecycle: 'archived', status: 'ended' }) });
    expectStep(archived.items, 'basics', 'done', '已归档');

    const active = await inspect({ event: eventRecord({ lifecycle: 'scheduled', status: 'active' }) });
    expectStep(active.items, 'basics', 'done', '已计划 · 进行中');
  });

  it('counts applied projection items while an execution is active', async () => {
    const viewed = await inspect({
      event: eventRecord(),
      config: configRecord(ref(TEMPLATE_ID, 1), ref(ASSIGNMENT_ID, 1)),
      execution: executionRecord('active', ACTIVE_ITEMS),
    });
    expectStep(viewed.items, 'run', 'active', '运行中 · 2/3 已应用');
  });

  it('treats a missing projection as zero and a stopped execution as done', async () => {
    const empty = await inspect({
      event: eventRecord(),
      execution: executionRecord('active', null),
    });
    expectStep(empty.items, 'run', 'active', '运行中 · 0/0 已应用');

    const stopped = await inspect({
      event: eventRecord(),
      execution: executionRecord('stopped', ACTIVE_ITEMS),
    });
    expectStep(stopped.items, 'run', 'done', '已停止');
  });

  it('marks policy attention when the assigned revision is newer than the latest published revision', async () => {
    const viewed = await inspect({
      event: eventRecord(),
      config: configRecord(ref(TEMPLATE_ID, 2), null),
      templates: [templateRecord()],
    });
    expectStep(viewed.items, 'policy', 'attention', '考试策略 · v2 生效中，有新改动');
  });

  it('marks targets attention when the assigned revision is newer than the latest published snapshot', async () => {
    const viewed = await inspect({
      event: eventRecord(),
      config: configRecord(ref(TEMPLATE_ID, 1), ref(ASSIGNMENT_ID, 2)),
      assignment: assignmentRecord(),
    });
    expectStep(viewed.items, 'targets', 'attention', 'v2 · 数量未知 生效中，有新改动');
  });

  it('counts only applied projection items, ignoring other non-failed statuses', async () => {
    const viewed = await inspect({
      event: eventRecord(),
      execution: executionRecord('active', [
        projectionItem('endpoint-001', 'applied'),
        projectionItem('endpoint-002', 'sent'),
        projectionItem('endpoint-003', 'failed'),
        projectionItem('endpoint-004', 'offline'),
      ]),
    });
    expectStep(viewed.items, 'run', 'active', '运行中 · 1/4 已应用');
  });

  it('shows a published target count of zero instead of an unknown count', async () => {
    const viewed = await inspect({
      event: eventRecord(),
      config: configRecord(ref(TEMPLATE_ID, 1), ref(ASSIGNMENT_ID, 1)),
      assignment: assignmentRecord({
        revisions: [targetRevision(1, ['a', 'b'], 0)],
      }),
    });
    expectStep(viewed.items, 'targets', 'done', 'v1 · 0 台');
  });

  it('defaults an archived event to the first missing step', async () => {
    const archived = eventRecord({ lifecycle: 'archived', status: 'ended' });
    const noPolicy = await inspect({ event: archived });
    expect(noPolicy.panel()).toBe('policy');

    const policyOnly = await inspect({
      event: archived,
      config: configRecord(ref(TEMPLATE_ID, 1), null),
    });
    expect(policyOnly.panel()).toBe('targets');

    const ready = await inspect({
      event: archived,
      config: configRecord(ref(TEMPLATE_ID, 1), ref(ASSIGNMENT_ID, 1)),
    });
    expect(ready.panel()).toBe('run');
  });

  it('interpolates the ended status for a scheduled lifecycle', async () => {
    const viewed = await inspect({ event: eventRecord({ lifecycle: 'scheduled', status: 'ended' }) });
    expectStep(viewed.items, 'basics', 'done', '已计划 · 已结束');
  });

  it('keeps an empty assigned template name instead of the missing-template fallback', async () => {
    const viewed = await inspect({
      event: eventRecord(),
      config: configRecord(ref(TEMPLATE_ID, 1), null),
      templates: [templateRecord({ name: '' })],
    });
    expectStep(viewed.items, 'policy', 'done', ' · v1 已生效');
  });

  it('passes design-gate for step-status.ts', () => {
    const file = resolve(packageRoot, STEP_STATUS_SOURCE);
    expect(existsSync(file), STEP_STATUS_SOURCE).toBe(true);
    const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', STEP_STATUS_SOURCE], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    expect(result.status, commandOutput(result)).toBe(0);
  });
});
