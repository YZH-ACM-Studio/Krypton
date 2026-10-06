import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ComponentType } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/components/ui/toast';
import {
  formatDate,
  parseAssignment,
  parseBoundEndpointOptions,
  parseClassroomSummaries,
  parseConfig,
  type BoundEndpointOption,
  type ClassroomSummary,
  type ConfirmPlan,
  type ExamPreparationSummary,
  type NetworkConfig,
  type TargetAssignment,
} from '../../src/pages/exam-event/model.ts';

// A static import fails collection while target-step.tsx is absent.
const targetStepLoaders = import.meta.glob('../../src/pages/exam-event/target-step.tsx');

const packageRoot = resolve(import.meta.dirname, '../..');
const TARGET_STEP_SOURCE = 'src/pages/exam-event/target-step.tsx';

const EVENT_ID = '66b800000000000000000601';
const SCHOOL_ID = '66b800000000000000000602';
const ASSIGNMENT_ID = '66b800000000000000000612';
const POLICY_ID = '66b800000000000000000611';
const CLASSROOM_ID = '66b800000000000000000701';
const TARGET_FINGERPRINT = 'b'.repeat(64);
const POLICY_FINGERPRINT = 'a'.repeat(64);

const PREVIEW_FIELDS: Record<string, unknown> = {
  previewFingerprint: 'p',
  endpointIds: ['e1', 'e2'],
  targetCount: 2,
  addedEndpointIds: ['e2'],
  removedEndpointIds: [],
};

interface Posted {
  url: string;
  body: Record<string, unknown>;
}

interface TargetStepProps {
  eventId: string;
  schoolId: string;
  assignment: TargetAssignment | null;
  preparation: ExamPreparationSummary | null;
  config: NetworkConfig | null;
  classrooms: ClassroomSummary[];
  boundEndpoints: BoundEndpointOption[];
  readOnly: boolean;
  displayName: (uid: number | null | undefined) => string;
  reload: () => Promise<void>;
  requestConfirm: (plan: ConfirmPlan) => void;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function endpointLabel(index: number): string {
  return `未命名教室 / A${String(index + 1).padStart(2, '0')}`;
}

function endpointSource(ids: readonly string[]): Record<string, unknown> {
  return { kind: 'endpoint', ids: [...ids] };
}

function publishedRevision(sources: Array<Record<string, unknown>>, endpointIds: readonly string[]): Record<string, unknown> {
  return {
    revision: 1,
    sources,
    targetFingerprint: TARGET_FINGERPRINT,
    endpointIds: [...endpointIds],
    targetCount: endpointIds.length,
    publishedAt: '2026-08-11T02:00:00.000Z',
  };
}

function assignmentPayload(
  draftSources: Array<Record<string, unknown>>,
  revisions: Array<Record<string, unknown>>,
  latestPublishedRevision: number | null,
  revision = 1,
): Record<string, unknown> {
  return {
    assignmentId: ASSIGNMENT_ID,
    revision,
    draft: { version: 1, sources: draftSources },
    revisions,
    latestPublishedRevision,
  };
}

function requireAssignment(value: Record<string, unknown>): TargetAssignment {
  const parsed = parseAssignment(value);
  if (!parsed) throw new TypeError('assignment fixture must parse');
  return parsed;
}

function configPayload(target: Record<string, unknown> | null): Record<string, unknown> {
  return {
    revision: 2,
    policy: { id: POLICY_ID, revision: 2, fingerprint: POLICY_FINGERPRINT },
    target,
  };
}

function targetRefPayload(): Record<string, unknown> {
  return { id: ASSIGNMENT_ID, revision: 1, fingerprint: TARGET_FINGERPRINT };
}

function requireConfig(value: Record<string, unknown>): NetworkConfig {
  const parsed = parseConfig(value);
  if (!parsed) throw new TypeError('config fixture must parse');
  return parsed;
}

function classroomPayload(): Array<Record<string, unknown>> {
  return [{
    classroomId: CLASSROOM_ID,
    schoolId: SCHOOL_ID,
    name: '未命名教室',
    layoutRevision: 1,
    seatCount: 2,
  }];
}

function boundPayload(ids: readonly string[]): Array<Record<string, unknown>> {
  return ids.map((endpointId, index) => ({ endpointId, label: endpointLabel(index) }));
}

function sameSourcesAssignment(ids: readonly string[]): TargetAssignment {
  const sources: Array<Record<string, unknown>> = [endpointSource(ids)];
  return requireAssignment(assignmentPayload(sources, [publishedRevision(sources, ids)], 1));
}

function detailFetchAssignment(ids: readonly string[]): TargetAssignment {
  const draft: Array<Record<string, unknown>> = ids.length ? [endpointSource(ids)] : [];
  return requireAssignment(assignmentPayload(draft, [publishedRevision([], ids)], 1));
}

function conflictResponse(): Response {
  return json({
    error: {
      name: 'ConflictError',
      errorCode: 'revision_conflict',
      code: 409,
      status: 409,
      params: [],
      message: '目标草稿版本已变化',
    },
  }, 409);
}

function previewFailureResponse(): Response {
  return json({
    error: {
      name: 'ConflictError',
      errorCode: 'revision_conflict',
      code: 409,
      status: 409,
      params: [],
      message: '目标终端解析失败',
    },
  }, 409);
}

function targetStepLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(targetStepLoaders)) {
    if (key.endsWith(TARGET_STEP_SOURCE)) return load;
  }
  return undefined;
}

async function loadTargetStep(): Promise<ComponentType<TargetStepProps>> {
  const load = targetStepLoader();
  expect(typeof load, TARGET_STEP_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${TARGET_STEP_SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('target step module must be an object');
  const value = readField(imported, 'TargetStep');
  expect(typeof value, 'TargetStep').toBe('function');
  if (typeof value !== 'function') throw new TypeError('TargetStep must be a function');
  return value as ComponentType<TargetStepProps>;
}

function deferredGate(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  return { promise, release };
}

function installFetch(
  mode: 'preview' | 'conflict' | 'preview-fails',
  beforePreview?: () => Promise<void>,
): Posted[] {
  const posted: Posted[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method !== 'POST') return json({});
    if (typeof init.body !== 'string') throw new TypeError('POST body must be a JSON string');
    const body: unknown = JSON.parse(init.body);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new TypeError('POST body must be an object');
    const record = body as Record<string, unknown>;
    posted.push({ url: String(input), body: record });
    if (mode === 'conflict' && record.action === 'saveDraft') return conflictResponse();
    if (record.action === 'preview' && beforePreview) await beforePreview();
    if (mode === 'preview-fails' && record.action === 'preview') return previewFailureResponse();
    return json({ preview: PREVIEW_FIELDS });
  }));
  return posted;
}

function expectNotClickable(name: string): void {
  const button = screen.queryByRole('button', { name });
  if (!button) {
    expect(button).not.toBeInTheDocument();
    return;
  }
  expect(button).toBeDisabled();
}

async function chooseBoundEndpoint(user: UserEvent, index: number): Promise<void> {
  const picker = screen.getByRole('group', { name: '指定终端' });
  await user.click(within(picker).getByRole('textbox'));
  await user.click(await screen.findByRole('button', { name: endpointLabel(index) }));
}

function displayName(uid: number | null | undefined): string {
  return uid == null ? '—' : `UID ${uid}`;
}

const DRAFT_UPDATED_AT = '2026-08-11T03:30:00.000Z';
const DRAFT_EDITOR_UID = 3;

function teacherDisplayName(uid: number | null | undefined): string {
  if (uid === DRAFT_EDITOR_UID) return '王老师';
  return uid == null ? '—' : `UID ${uid}`;
}

function draftAuditSentence(): string {
  return `草稿最后由 ${teacherDisplayName(DRAFT_EDITOR_UID)} 修改于 ${formatDate(DRAFT_UPDATED_AT)}`;
}

function occurrenceCount(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (from < haystack.length) {
    const found = haystack.indexOf(needle, from);
    if (found < 0) return count;
    count += 1;
    from = found + needle.length;
  }
  return count;
}

function assignmentWithDraftAudit(
  draftSources: Array<Record<string, unknown>>,
  revisions: Array<Record<string, unknown>>,
  latestPublishedRevision: number | null,
): TargetAssignment {
  return requireAssignment({
    assignmentId: ASSIGNMENT_ID,
    revision: 1,
    draft: {
      version: 1,
      sources: draftSources,
      updatedAt: DRAFT_UPDATED_AT,
      updatedBy: DRAFT_EDITOR_UID,
    },
    revisions,
    latestPublishedRevision,
  });
}

function targetPanelText(): string {
  const panel = document.getElementById('target-assignment');
  if (!(panel instanceof HTMLElement)) throw new TypeError('target panel missing');
  return panel.textContent ?? '';
}

async function renderTarget(overrides: Partial<TargetStepProps> = {}): Promise<TargetStepProps> {
  const TargetStep = await loadTargetStep();
  const props: TargetStepProps = {
    eventId: EVENT_ID,
    schoolId: SCHOOL_ID,
    assignment: sameSourcesAssignment(['e1']),
    preparation: null,
    config: requireConfig(configPayload(targetRefPayload())),
    classrooms: parseClassroomSummaries(classroomPayload()),
    boundEndpoints: parseBoundEndpointOptions(boundPayload(['e1'])),
    readOnly: false,
    displayName,
    reload: vi.fn<() => Promise<void>>(async () => {}),
    requestConfirm: vi.fn<(plan: ConfirmPlan) => void>(),
    ...overrides,
  };
  render(<TargetStep {...props} />);
  return props;
}

function actionBar(): HTMLElement {
  const bar = document.querySelector('[data-slot="action-bar"]');
  if (!(bar instanceof HTMLElement)) throw new TypeError('action bar missing');
  return bar;
}

function brandButtons(): HTMLButtonElement[] {
  const buttons: HTMLButtonElement[] = [];
  for (const node of document.querySelectorAll('button')) {
    if (!(node instanceof HTMLButtonElement)) continue;
    if (node.className.split(/\s+/).includes('bg-brand')) buttons.push(node);
  }
  return buttons;
}

function numberedEndpointIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `ep-${String(index + 1).padStart(2, '0')}`);
}

function snapshotRevision(revision: number, endpointIds: readonly string[]): Record<string, unknown> {
  return {
    revision,
    sources: [endpointSource(endpointIds)],
    targetFingerprint: TARGET_FINGERPRINT,
    endpointIds: [...endpointIds],
    targetCount: endpointIds.length,
    publishedAt: revision === 1 ? '2026-08-11T02:00:00.000Z' : '2026-08-12T03:00:00.000Z',
  };
}

function historyRowTexts(): string[] {
  const history = screen.getByText('快照历史').closest('details');
  if (!(history instanceof HTMLDetailsElement)) throw new TypeError('snapshot history missing');
  const list = history.querySelector('ol');
  if (!(list instanceof HTMLOListElement)) throw new TypeError('snapshot history list missing');
  return [...list.children].map((node) => node.textContent ?? '');
}

function previewColumn(heading: '新增' | '移除'): HTMLElement {
  for (const node of document.querySelectorAll('div')) {
    if (!(node instanceof HTMLElement) || !node.className.split(/\s+/).includes('sm:grid-cols-2')) continue;
    for (const child of node.children) {
      if (!(child instanceof HTMLElement)) continue;
      const text = child.textContent ?? '';
      const other = heading === '新增' ? '移除' : '新增';
      if (text.includes(heading) && !text.includes(other)) return child;
    }
  }
  throw new TypeError(`missing preview column ${heading}`);
}

function capturePlan(requestConfirm: TargetStepProps['requestConfirm']): ConfirmPlan {
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
  const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', TARGET_STEP_SOURCE], {
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
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, TARGET_STEP_SOURCE], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  expect(result.status, commandOutput(result)).toBe(0);
}

beforeEach(() => {
  window.history.replaceState(null, '', `/admin/exam-infrastructure/events/${EVENT_ID}`);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('exam event target step', () => {
  it('草稿与已发布快照一致且已被本活动使用时，只给出次要的解析终端', async () => {
    await renderTarget();
    const bar = actionBar();
    const buttons = within(bar).getAllByRole('button');

    expect(within(bar).getByText('本活动正在使用 v1')).toBeInTheDocument();
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('解析终端');
    expect(buttons[0]).toHaveAttribute('data-variant', 'secondary');
  });

  it('添加指定终端后保存并解析，并显示新增终端的位置', async () => {
    const posted = installFetch('preview');
    const user = userEvent.setup();
    const TargetStep = await loadTargetStep();
    let assignment = detailFetchAssignment(['e1']);
    const requestConfirm = vi.fn<(plan: ConfirmPlan) => void>();
    const reload = vi.fn<() => Promise<void>>();
    const boundEndpoints = parseBoundEndpointOptions(boundPayload(['e1', 'e2']));
    const build = (): TargetStepProps => ({
      eventId: EVENT_ID,
      schoolId: SCHOOL_ID,
      assignment,
      preparation: null,
      config: requireConfig(configPayload(targetRefPayload())),
      classrooms: parseClassroomSummaries(classroomPayload()),
      boundEndpoints,
      readOnly: false,
      displayName,
      reload,
      requestConfirm,
    });
    const view = render(<TargetStep {...build()} />);
    // Save of revision 1 returns the next CAS revision. Preview must use that reloaded value.
    reload.mockImplementation(async () => {
      assignment = requireAssignment(assignmentPayload(
        [endpointSource(['e1', 'e2'])],
        [publishedRevision([], ['e1'])],
        1,
        2,
      ));
      view.rerender(<TargetStep {...build()} />);
    });
    const picker = screen.getByRole('group', { name: '指定终端' });
    await user.click(within(picker).getByRole('textbox'));
    await user.click(await screen.findByRole('button', { name: endpointLabel(1) }));

    expect(within(actionBar()).getByText('有未保存修改')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存并解析' }));
    await waitFor(() => expect(posted.map((item) => item.body.action)).toEqual(['saveDraft', 'preview']));

    expect(reload).toHaveBeenCalledTimes(1);
    expect(posted[0]).toEqual({
      url: `/api/admin/exam-events/${EVENT_ID}/target-assignment`,
      body: {
        eventId: EVENT_ID,
        action: 'saveDraft',
        expectedRevision: 1,
        sources: [{ kind: 'endpoint', ids: ['e1', 'e2'] }],
      },
    });
    expect(posted[1]?.url).toBe(`/api/admin/exam-events/${EVENT_ID}/target-assignment`);
    expect(posted[1]?.body).toMatchObject({ action: 'preview', expectedRevision: 2, eventId: EVENT_ID });
    expect(await screen.findByText('解析到 2 台终端')).toBeInTheDocument();
    expect(previewColumn('新增').textContent).toContain(endpointLabel(1));
  });

  it('保存返回 409 时显示错误且不再请求解析', async () => {
    const posted = installFetch('conflict');
    const user = userEvent.setup();
    await renderTarget({
      assignment: detailFetchAssignment(['e1']),
      boundEndpoints: parseBoundEndpointOptions(boundPayload(['e1', 'e2'])),
    });
    const picker = screen.getByRole('group', { name: '指定终端' });
    await user.click(within(picker).getByRole('textbox'));
    await user.click(await screen.findByRole('button', { name: endpointLabel(1) }));
    await user.click(screen.getByRole('button', { name: '保存并解析' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('目标草稿版本已变化');
    await act(async () => {
      await new Promise((done) => {
        setTimeout(done, 200);
      });
    });
    expect(posted.map((item) => item.body.action)).toEqual(['saveDraft']);
    expect(screen.queryByText(/解析到/)).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('目标草稿版本已变化');
  });

  it('解析完成后用发布快照确认，并带上预览指纹', async () => {
    const posted = installFetch('preview');
    const user = userEvent.setup();
    const props = await renderTarget({ assignment: detailFetchAssignment(['e1']) });
    await user.click(screen.getByRole('button', { name: '解析终端' }));
    await user.click(await screen.findByRole('button', { name: '发布为快照 v2…' }));
    const plan = capturePlan(props.requestConfirm);
    const count = plan.facts.find((fact) => fact.label === '目标终端数');

    expect(plan.title).toBe('发布目标终端快照？');
    expect(count?.value).toBe('2 台');
    await plan.run();
    expect(posted).toContainEqual({
      url: `/api/admin/exam-events/${EVENT_ID}/target-assignment`,
      body: {
        eventId: EVENT_ID,
        action: 'publish',
        expectedRevision: 1,
        confirmationFingerprint: 'p',
      },
    });
  });

  it('已发布但尚未分配时，确认后把快照设为本活动目标', async () => {
    const posted = installFetch('preview');
    const user = userEvent.setup();
    const props = await renderTarget({ config: requireConfig(configPayload(null)) });
    await user.click(screen.getByRole('button', { name: '设为本活动目标…' }));
    await capturePlan(props.requestConfirm).run();

    expect(posted).toContainEqual({
      url: `/api/admin/exam-events/${EVENT_ID}/network-config`,
      body: {
        eventId: EVENT_ID,
        action: 'assignTarget',
        expectedRevision: 2,
        assignmentId: ASSIGNMENT_ID,
        revision: 1,
      },
    });
  });

  it('切换到整间教室后出现教室选择器', async () => {
    const user = userEvent.setup();
    await renderTarget();
    await user.click(screen.getByRole('tab', { name: '整间教室' }));

    expect(screen.getByRole('tablist', { name: '目标来源' })).toBeInTheDocument();
    const labeled = screen.queryAllByLabelText('教室');
    const named = screen.queryAllByRole('combobox', { name: '教室' });
    expect(labeled.length + named.length).toBeGreaterThan(0);
  });

  it('混合旧来源保持只读选中，并说明来源不变', async () => {
    const sources: Array<Record<string, unknown>> = [
      { kind: 'classroom', ids: [CLASSROOM_ID, '66b800000000000000000702'] },
      { kind: 'endpoint', ids: ['endpoint-001'] },
    ];
    await renderTarget({
      assignment: requireAssignment(assignmentPayload(sources, [], null)),
    });
    const tab = screen.getByRole('tab', { name: '保留现有来源（只读）' });

    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('现有来源保持不变')).toBeInTheDocument();
  });

  it('改选指定终端但终端无法解析时，禁止保存并解析', async () => {
    const sources: Array<Record<string, unknown>> = [
      { kind: 'classroom', ids: [CLASSROOM_ID, '66b800000000000000000702'] },
      { kind: 'endpoint', ids: ['missing-endpoint'] },
    ];
    const user = userEvent.setup();
    await renderTarget({
      assignment: requireAssignment(assignmentPayload(sources, [], null)),
      boundEndpoints: [],
    });
    await user.click(screen.getByRole('tab', { name: '指定终端' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('无法解析指定终端的教室或座位');
    expect(screen.getByRole('button', { name: '保存并解析' })).toBeDisabled();
  });

  it('快照历史摘要计入快照，展开后可查看空终端清单', async () => {
    const user = userEvent.setup();
    await renderTarget({ assignment: detailFetchAssignment([]) });

    expect(screen.getByText(/1 个快照/)).toBeInTheDocument();
    const history = screen.getByText('快照历史').closest('details');
    if (!(history instanceof HTMLDetailsElement)) throw new TypeError('snapshot history missing');
    const summary = [...history.children].find((node) => node.tagName === 'SUMMARY');
    if (!(summary instanceof HTMLElement)) throw new TypeError('snapshot history summary missing');
    await user.click(summary);

    expect(history.open).toBe(true);
    expect(screen.getByText(/来源：/)).toBeInTheDocument();
    const endpoints = screen.getByText('查看 0 台终端');
    await user.click(endpoints);
    const nested = endpoints.closest('details');
    if (!(nested instanceof HTMLDetailsElement)) throw new TypeError('endpoint detail missing');
    expect(nested.open).toBe(true);
  });

  it('解析新增超过 20 台时只列出前 20 台，并说明其余台数', async () => {
    const added = numberedEndpointIds(21);
    vi.stubGlobal('fetch', vi.fn(async () => json({
      preview: {
        previewFingerprint: 'p',
        endpointIds: added,
        targetCount: added.length,
        addedEndpointIds: added,
        removedEndpointIds: [],
      },
    })));
    const user = userEvent.setup();
    await renderTarget({ assignment: detailFetchAssignment(['e1']) });
    await user.click(screen.getByRole('button', { name: '解析终端' }));

    const column = previewColumn('新增');
    await waitFor(() => expect(column.textContent).toContain('等 1 台'));
    expect(column.textContent).toContain('ep-01');
    expect(column.textContent).toContain('ep-20');
    expect(column.textContent).not.toContain('ep-21');
  });

  it('解析结果里没有新增或移除的终端时，该列显示无', async () => {
    installFetch('preview');
    const user = userEvent.setup();
    await renderTarget({ assignment: detailFetchAssignment(['e1']) });
    await user.click(screen.getByRole('button', { name: '解析终端' }));

    expect(await screen.findByText('解析到 2 台终端')).toBeInTheDocument();
    expect(previewColumn('移除').textContent).toContain('无');
  });

  it('快照历史把较新的版本排在前面', async () => {
    await renderTarget({
      assignment: requireAssignment(assignmentPayload(
        [endpointSource(['e1'])],
        [snapshotRevision(1, ['e1']), snapshotRevision(2, ['e1', 'e2'])],
        2,
      )),
    });

    const rows = historyRowTexts();
    expect(rows[0]).toContain('v2 · 2 台');
    expect(rows[1]).toContain('v1 · 1 台');
  });

  it('同一教室来源写了多个 id 时保持现有来源只读', async () => {
    const sources: Array<Record<string, unknown>> = [
      { kind: 'classroom', ids: [CLASSROOM_ID, '66b800000000000000000702'] },
    ];
    await renderTarget({
      assignment: requireAssignment(assignmentPayload(sources, [], null)),
    });
    const tab = screen.getByRole('tab', { name: '保留现有来源（只读）' });

    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('现有来源保持不变')).toBeInTheDocument();
  });

  it('清空后再次切回唯一的考试座位分配时会重新选中它', async () => {
    const preparation: ExamPreparationSummary = {
      assignment: {
        id: '66b800000000000000000801',
        revision: 4,
        fingerprint: 'c'.repeat(64),
        roster: {
          id: '66b800000000000000000802',
          revision: 1,
          fingerprint: 'd'.repeat(64),
        },
      },
      publicationRevision: 1,
      batch: null,
    };
    const user = userEvent.setup();
    await renderTarget({
      assignment: sameSourcesAssignment(['e1']),
      preparation,
    });
    await user.click(screen.getByRole('tab', { name: '已发布考试座位分配' }));
    const seat = screen.getByRole('combobox', { name: '已发布分配' });
    expect(seat).toHaveTextContent('已发布分配 r4');
    await user.click(seat);
    await user.click(await screen.findByRole('option', { name: '选择已发布分配' }));
    expect(seat).toHaveTextContent('选择已发布分配');
    await user.click(screen.getByRole('tab', { name: '指定终端' }));
    await user.click(screen.getByRole('tab', { name: '已发布考试座位分配' }));

    expect(screen.getByRole('combobox', { name: '已发布分配' })).toHaveTextContent('已发布分配 r4');
  });

  it('解析新增未超过 20 台时不显示其余台数', async () => {
    installFetch('preview');
    const user = userEvent.setup();
    await renderTarget({ assignment: detailFetchAssignment(['e1']) });
    await user.click(screen.getByRole('button', { name: '解析终端' }));

    expect(await screen.findByText('解析到 2 台终端')).toBeInTheDocument();
    expect(previewColumn('新增').textContent ?? '').not.toMatch(/等 \d+ 台/);
    expect(previewColumn('移除').textContent ?? '').not.toMatch(/等 \d+ 台/);
  });

  it('保存并解析成功后提示目标来源已保存', async () => {
    const posted = installFetch('preview');
    const success = vi.spyOn(toast, 'success').mockImplementation(() => 'toast-id');
    const user = userEvent.setup();
    await renderTarget({
      assignment: detailFetchAssignment(['e1']),
      boundEndpoints: parseBoundEndpointOptions(boundPayload(['e1', 'e2'])),
    });
    await chooseBoundEndpoint(user, 1);
    await user.click(screen.getByRole('button', { name: '保存并解析' }));

    await waitFor(() => expect(posted.map((item) => item.body.action)).toEqual(['saveDraft', 'preview']));
    expect(success).toHaveBeenCalledWith('目标来源已保存');
  });

  it('保存成功但解析失败时显示错误，且不撤回已保存来源', async () => {
    const posted = installFetch('preview-fails');
    const success = vi.spyOn(toast, 'success').mockImplementation(() => 'toast-id');
    const user = userEvent.setup();
    await renderTarget({
      assignment: detailFetchAssignment(['e1']),
      boundEndpoints: parseBoundEndpointOptions(boundPayload(['e1', 'e2'])),
    });
    await chooseBoundEndpoint(user, 1);
    await user.click(screen.getByRole('button', { name: '保存并解析' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('目标终端解析失败');
    expect(success).toHaveBeenCalledWith('目标来源已保存');
    expect(posted.map((item) => item.body.action)).toEqual(['saveDraft', 'preview']);
    expect(screen.queryByText(/解析到/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: '指定终端' })).getByText(endpointLabel(1))).toBeInTheDocument();
  });

  it('活动已归档时不能切换目标来源，操作栏也没有按钮', async () => {
    await renderTarget({ readOnly: true });

    for (const name of ['指定终端', '整间教室', '已发布考试座位分配']) {
      expect(screen.getByRole('tab', { name })).toBeDisabled();
    }
    expect(screen.getByText('活动已归档，目标快照仅供查看。')).toBeInTheDocument();
    expect(within(actionBar()).queryByRole('button')).not.toBeInTheDocument();
    expect(actionBar()).not.toHaveTextContent('本活动正在使用');
    expect(actionBar()).not.toHaveTextContent('有未保存修改');
  });

  it('切换目标来源时清掉尚未发布的解析结果', async () => {
    const held = deferredGate();
    const posted = installFetch('preview', () => held.promise);
    const user = userEvent.setup();
    try {
      await renderTarget({ assignment: detailFetchAssignment(['e1']) });
      await user.click(screen.getByRole('button', { name: '解析终端' }));
      await waitFor(() => expect(posted.map((item) => item.body.action)).toEqual(['preview']));
      expect(screen.queryByText('解析到 2 台终端')).not.toBeInTheDocument();
      await user.click(screen.getByRole('tab', { name: '整间教室' }));
      held.release();
      await waitFor(() => expect(screen.getByRole('button', { name: '保存并解析' })).toBeEnabled());
      expect(screen.queryByText('解析到 2 台终端')).not.toBeInTheDocument();
    } finally {
      held.release();
    }
  });

  it('重新解析尚未返回时不能点发布为快照', async () => {
    const held = deferredGate();
    let previewCalls = 0;
    installFetch('preview', async () => {
      previewCalls += 1;
      if (previewCalls > 1) await held.promise;
    });
    const user = userEvent.setup();
    try {
      await renderTarget({ assignment: detailFetchAssignment(['e1']) });
      await user.click(screen.getByRole('button', { name: '解析终端' }));
      expect(await screen.findByRole('button', { name: '发布为快照 v2…' })).toBeEnabled();
      await user.click(screen.getByRole('button', { name: '重新解析' }));
      await waitFor(() => expect(previewCalls).toBe(2));
      expectNotClickable('发布为快照 v2…');
    } finally {
      held.release();
    }
  });

  it('页面中 bg-brand 按钮不超过一个', async () => {
    await renderTarget({ config: requireConfig(configPayload(null)) });
    const primary = screen.getByRole('button', { name: '设为本活动目标…' });

    expect(primary.className.split(/\s+/)).toContain('bg-brand');
    expect(brandButtons().length).toBeLessThanOrEqual(1);
  });

  it('发布快照成功后提示已发布的版本号', async () => {
    installFetch('preview');
    const success = vi.spyOn(toast, 'success').mockImplementation(() => 'toast-id');
    const user = userEvent.setup();
    const props = await renderTarget({ assignment: detailFetchAssignment(['e1']) });
    await user.click(screen.getByRole('button', { name: '解析终端' }));
    await user.click(await screen.findByRole('button', { name: '发布为快照 v2…' }));
    await capturePlan(props.requestConfirm).run();

    expect(success).toHaveBeenCalledWith('已发布快照 v2');
  });

  it('把已发布快照设为本活动目标后提示版本号', async () => {
    installFetch('preview');
    const success = vi.spyOn(toast, 'success').mockImplementation(() => 'toast-id');
    const user = userEvent.setup();
    const props = await renderTarget({ config: requireConfig(configPayload(null)) });
    await user.click(screen.getByRole('button', { name: '设为本活动目标…' }));
    await capturePlan(props.requestConfirm).run();

    expect(success).toHaveBeenCalledWith('本活动目标已改为 v1');
  });

  it('教室选择器只列出本活动学校的教室', async () => {
    const classrooms: Array<Record<string, unknown>> = [
      {
        classroomId: CLASSROOM_ID,
        schoolId: SCHOOL_ID,
        name: '机房 A301',
        layoutRevision: 1,
        seatCount: 48,
      },
      {
        classroomId: '66b800000000000000000799',
        schoolId: '66b800000000000000000699',
        name: '其他学校机房',
        layoutRevision: 1,
        seatCount: 12,
      },
    ];
    const user = userEvent.setup();
    await renderTarget({ classrooms: parseClassroomSummaries(classrooms) });
    await user.click(screen.getByRole('tab', { name: '整间教室' }));
    await user.click(screen.getByRole('combobox', { name: '教室' }));

    expect(await screen.findByRole('option', { name: '机房 A301 · 48 座' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '其他学校机房 · 12 座' })).not.toBeInTheDocument();
  });

  it('只有不是当前使用的快照才提供改用此快照', async () => {
    const user = userEvent.setup();
    const props = await renderTarget({
      assignment: requireAssignment(assignmentPayload(
        [endpointSource(['e1'])],
        [snapshotRevision(1, ['e1']), snapshotRevision(2, ['e1', 'e2'])],
        2,
      )),
      config: requireConfig(configPayload({
        id: ASSIGNMENT_ID,
        revision: 2,
        fingerprint: TARGET_FINGERPRINT,
      })),
    });
    const history = screen.getByText('快照历史').closest('details');
    if (!(history instanceof HTMLDetailsElement)) throw new TypeError('snapshot history missing');
    const summary = [...history.children].find((node) => node.tagName === 'SUMMARY');
    if (!(summary instanceof HTMLElement)) throw new TypeError('snapshot history summary missing');
    await user.click(summary);
    const list = history.querySelector('ol');
    if (!(list instanceof HTMLOListElement)) throw new TypeError('snapshot history list missing');
    const rows = [...list.children].filter((node): node is HTMLElement => node instanceof HTMLElement);
    const current = rows.find((row) => (row.textContent ?? '').includes('v2 · 2 台'));
    const previous = rows.find((row) => (row.textContent ?? '').includes('v1 · 1 台'));
    if (!current || !previous) throw new TypeError('snapshot history rows missing');

    expect(within(current).queryByRole('button', { name: '改用此快照' })).not.toBeInTheDocument();
    await user.click(within(previous).getByRole('button', { name: '改用此快照' }));
    const plan = capturePlan(props.requestConfirm);
    const version = plan.facts.find((fact) => fact.label === '目标版本');

    expect(plan.title).toBe('分配此目标快照？');
    expect(version?.value).toBe('v1');
  });

  it('零快照且草稿有修改时间时，面板底部用次要文字写出修改人和时间', async () => {
    await renderTarget({
      assignment: assignmentWithDraftAudit([endpointSource(['e1'])], [], null),
      displayName: teacherDisplayName,
    });
    const sentence = draftAuditSentence();
    const panel = document.getElementById('target-assignment');
    if (!(panel instanceof HTMLElement)) throw new TypeError('target panel missing');
    const lines = [...panel.querySelectorAll('p')].filter((node) => node.textContent === sentence);

    expect(lines).toHaveLength(1);
    const line = lines[0];
    if (!(line instanceof HTMLParagraphElement)) throw new TypeError('draft audit line missing');
    const classes = line.className.split(/\s+/);
    expect(classes).toContain('text-xs');
    expect(classes).toContain('text-fg-muted');
    expect(line.textContent).toBe(`草稿最后由 ${teacherDisplayName(DRAFT_EDITOR_UID)} 修改于 ${formatDate(DRAFT_UPDATED_AT)}`);
  });

  it('已有快照且草稿有修改时间时，修改信息只出现在快照历史摘要里一次', async () => {
    const sentence = draftAuditSentence();
    await renderTarget({
      assignment: assignmentWithDraftAudit(
        [endpointSource(['e1'])],
        [publishedRevision([endpointSource(['e1'])], ['e1'])],
        1,
      ),
      displayName: teacherDisplayName,
    });
    const history = screen.getByText('快照历史').closest('details');
    if (!(history instanceof HTMLDetailsElement)) throw new TypeError('snapshot history missing');
    const summary = [...history.children].find((node) => node.tagName === 'SUMMARY');
    if (!(summary instanceof HTMLElement)) throw new TypeError('snapshot history summary missing');

    expect(occurrenceCount(summary.textContent ?? '', sentence)).toBe(1);
    expect(occurrenceCount(targetPanelText(), sentence)).toBe(1);
  });

  it('门禁零违规，按钮显式 variant', () => {
    expect(existsSync(resolve(packageRoot, TARGET_STEP_SOURCE)), TARGET_STEP_SOURCE).toBe(true);
    expectDesignGateClean();
    expectExplicitVariants();
  });
});
