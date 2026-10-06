import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ComponentType } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  compactEndpoint,
  formatDate,
  type EndpointPreflight,
  type EndpointPreflightItem,
  type LayoutSeat,
  type PairingEntry,
  type PairingWindow,
  type SeatBinding,
  type SeatHistoryEntry,
  type SeatOperationalEntry,
  type SeatReference,
  type SeatView,
} from '../../src/pages/exam-classroom/model.ts';

// A static import fails collection while seat-detail.tsx is absent.
const seatDetailLoaders = import.meta.glob('../../src/pages/exam-classroom/seat-detail.tsx');

const packageRoot = resolve(import.meta.dirname, '../..');
const SEAT_DETAIL_SOURCE = 'src/pages/exam-classroom/seat-detail.tsx';
const SOURCE_SEAT_ID = 'seat-1';
const SEAT_LABEL = 'A-01';
const BINDING_ID = '66b800000000000000000811';
const ENDPOINT_ID = 'ep-seat-detail-0001';
const BINDING_UPDATED_AT = '2026-08-11T01:00:00.000Z';
const EVENT_ID = '66b800000000000000000821';
const EVENT_TITLE = '期末上机考试';
const EVENT_START = '2026-09-01T01:00:00.000Z';
const EVENT_END = '2026-09-01T04:00:00.000Z';
const PAIRING_CODE = '01234567';
const FORMATTED_CODE = '0123-4567';
const CODE_HINT = '67';
const REPLACE_AT = '2026-08-12T02:30:00.000Z';
const BIND_AT = '2026-08-11T01:00:00.000Z';
const PREVIOUS_ENDPOINT = 'ep-old-0001';
const NEXT_ENDPOINT = 'ep-new-0001';
const BOUND_ENDPOINT = 'ep-bind-0001';
const CLAIMED_ENDPOINT = 'ep-claimed-0001';
const SERVICE_LINE = 'Service 0.4.1 · 协议 2 · 凭据 active';
const EMPTY_PROMPT = '选择一个实体座位';
const EMPTY_DESCRIPTION = '可点击布局，或从搜索框后用方向键遍历。';
const EMPTY_HISTORY = '这个座位还没有绑定记录。';
const HISTORY_TITLE = '此座位历史';
const REPLACEMENT_WARNING = '新终端已完成身份认领，等待教师确认';
const UNCHECKED_STATUS = '已绑定 · 未检测在线状态';
const LOST_CODE = '页面刷新后不会恢复明文码；请关闭当前窗口并重新生成。';

interface SeatDetailProps {
  view: SeatView | null;
  code: string | null;
  window: PairingWindow | null;
  busy: boolean;
  history: SeatHistoryEntry[];
  displayName: (uid: number | null | undefined) => string;
  preflightState: EndpointPreflight['state'];
  onOpenSingle: () => void;
  onOpenReplacement: () => void;
  onConfirmReplacement: () => void;
  onCancelPairing: () => void;
  onUnbind: () => void;
}

const displayName = (uid: number | null | undefined): string => (
  uid == null ? '\u2014' : ({ 2: '王老师' } as Record<number, string>)[uid] ?? `UID ${uid}`
);

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function seat(overrides: Partial<LayoutSeat> = {}): LayoutSeat {
  return {
    sourceSeatId: SOURCE_SEAT_ID,
    label: SEAT_LABEL,
    x: 0,
    y: 0,
    rotation: 0,
    status: 'active',
    ...overrides,
  };
}

function operational(overrides: Partial<SeatOperationalEntry> = {}): SeatOperationalEntry {
  return {
    sourceSeatId: SOURCE_SEAT_ID,
    enabled: true,
    facing: 'unset',
    disabledReason: null,
    note: null,
    ...overrides,
  };
}

function activeBinding(overrides: Partial<SeatBinding> = {}): SeatBinding {
  return {
    bindingId: BINDING_ID,
    sourceSeatId: SOURCE_SEAT_ID,
    status: 'active',
    endpointId: ENDPOINT_ID,
    revision: 4,
    history: [],
    updatedAt: BINDING_UPDATED_AT,
    createdAt: BINDING_UPDATED_AT,
    createdBy: 2,
    updatedBy: 2,
    ...overrides,
  };
}

function preflightItem(overrides: Partial<EndpointPreflightItem> = {}): EndpointPreflightItem {
  return {
    endpointId: ENDPOINT_ID,
    ready: true,
    reason: '',
    credentialStatus: 'active',
    online: true,
    compatible: true,
    serviceVersion: '0.4.1',
    protocolVersion: 2,
    ...overrides,
  };
}

function pairingEntry(overrides: Partial<PairingEntry> = {}): PairingEntry {
  return {
    sourceSeatId: SOURCE_SEAT_ID,
    mode: 'bind',
    status: 'open',
    revision: 1,
    codeHint: CODE_HINT,
    expectedBindingRevision: 0,
    claimedEndpointId: null,
    claimedAt: null,
    bindingRevision: null,
    completedAt: null,
    ...overrides,
  };
}

function pairingWindow(): PairingWindow {
  return {
    windowId: '66b800000000000000000831',
    status: 'open',
    revision: 1,
    expiresAt: '2026-08-11T00:10:00.000Z',
    entries: [],
    createdAt: '2026-08-11T00:00:00.000Z',
    createdBy: 2,
    closedAt: null,
    closedBy: null,
  };
}

function futureReference(): SeatReference {
  return {
    kind: 'network-config',
    endpointId: ENDPOINT_ID,
    eventId: EVENT_ID,
    eventTitle: EVENT_TITLE,
    eventState: 'future',
    startAt: EVENT_START,
    endAt: EVENT_END,
    targetRevision: 3,
  };
}

function boundView(overrides: Partial<SeatView> = {}): SeatView {
  return {
    seat: seat(),
    binding: activeBinding(),
    entry: null,
    preflight: preflightItem(),
    references: [],
    status: 'unknown',
    operational: operational(),
    ...overrides,
  };
}

function unboundView(overrides: Partial<SeatView> = {}): SeatView {
  return boundView({
    binding: null,
    entry: null,
    preflight: null,
    status: 'unbound',
    references: [],
    ...overrides,
  });
}

function historyEntry(
  action: SeatHistoryEntry['action'],
  at: string,
  key: string,
  endpointId: string | null,
  previousEndpointId: string | null,
): SeatHistoryEntry {
  const label = action === 'bind' ? '建立绑定' : action === 'replace' ? '确认换机' : '解除绑定';
  return {
    key,
    at,
    action,
    label,
    seatLabel: SEAT_LABEL,
    endpointId,
    previousEndpointId,
    actorUid: 2,
  };
}

function detailProps(overrides: Partial<SeatDetailProps> = {}): SeatDetailProps {
  return {
    view: null,
    code: null,
    window: null,
    busy: false,
    history: [],
    displayName,
    preflightState: 'unavailable',
    onOpenSingle: vi.fn<() => void>(),
    onOpenReplacement: vi.fn<() => void>(),
    onConfirmReplacement: vi.fn<() => void>(),
    onCancelPairing: vi.fn<() => void>(),
    onUnbind: vi.fn<() => void>(),
    ...overrides,
  };
}

function seatDetailLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(seatDetailLoaders)) {
    if (key.endsWith(SEAT_DETAIL_SOURCE)) return load;
  }
  return undefined;
}

async function loadSeatDetail(): Promise<ComponentType<SeatDetailProps>> {
  const load = seatDetailLoader();
  expect(typeof load, SEAT_DETAIL_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${SEAT_DETAIL_SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('seat detail module must be an object');
  const value = readField(imported, 'SeatDetail');
  expect(typeof value, 'SeatDetail').toBe('function');
  if (typeof value !== 'function') throw new TypeError('SeatDetail must be a function');
  return value as ComponentType<SeatDetailProps>;
}

async function renderDetail(overrides: Partial<SeatDetailProps> = {}): Promise<{ props: SeatDetailProps; unmount: () => void }> {
  const SeatDetail = await loadSeatDetail();
  const props = detailProps(overrides);
  const view = render(<SeatDetail {...props} />);
  return { props, unmount: () => view.unmount() };
}

function buttonNames(): string[] {
  return screen.getAllByRole('button').map((button) => (button.textContent ?? '').replace(/\s+/g, ''));
}

function badge(text: string): HTMLElement {
  const node = screen.getByText(text).closest('[data-slot="badge"]');
  if (!(node instanceof HTMLElement)) throw new TypeError(`badge ${text} missing`);
  return node;
}

function descriptionDetail(term: string): HTMLElement {
  const label = [...document.querySelectorAll('dt')].find((node) => node.textContent === term);
  const value = label?.nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new TypeError(`description ${term} missing`);
  return value;
}

function techDetails(): HTMLElement {
  const node = document.querySelector('[data-slot="tech-details"]');
  if (!(node instanceof HTMLElement)) throw new TypeError('tech details missing');
  return node;
}

function commandOutput(result: ReturnType<typeof spawnSync>): string {
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  return `${stdout}\n${stderr}`;
}

function expectDesignGateClean(): void {
  const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', SEAT_DETAIL_SOURCE], {
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
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, SEAT_DETAIL_SOURCE], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  expect(result.status, commandOutput(result)).toBe(0);
}

describe('exam classroom seat detail', () => {
  it('未选择座位时显示选择实体座位的空状态', async () => {
    await renderDetail();

    expect(screen.getByText(EMPTY_PROMPT)).toBeInTheDocument();
    expect(screen.getByText(EMPTY_DESCRIPTION)).toBeInTheDocument();
    expect(document.querySelector('[data-slot="panel"]')).toBeInstanceOf(HTMLElement);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('未检测在线状态的已绑定座位隐藏服务信息并给出换机和解除绑定', async () => {
    await renderDetail({
      view: boundView(),
      code: PAIRING_CODE,
      preflightState: 'unavailable',
    });

    const status = badge(UNCHECKED_STATUS);
    expect(status).toHaveAttribute('data-tone', 'neutral');
    expect(status).toHaveAttribute('data-variant', 'soft');
    expect(screen.getByRole('heading', { level: 2, name: SEAT_LABEL })).toBeInTheDocument();
    expect(screen.getByText('座位')).toBeInTheDocument();
    expect(screen.getByText(ENDPOINT_ID)).toBeInTheDocument();
    expect(descriptionDetail('终端').textContent).toContain(ENDPOINT_ID);
    expect(descriptionDetail('绑定').textContent).toBe(`r4 · ${formatDate(BINDING_UPDATED_AT)} · 王老师`);
    expect(screen.queryByText('版本')).toBeNull();
    expect(screen.queryByText(/Service/)).toBeNull();
    expect(screen.queryByText(FORMATTED_CODE)).toBeNull();
    expect(descriptionDetail('运行配置').textContent).toContain('可用');
    expect(descriptionDetail('运行配置').textContent).toContain('朝向：未设置');
    expect(badge('可用')).toHaveAttribute('data-tone', 'neutral');
    expect(buttonNames()).toEqual(['开始换机识别', '解除长期绑定']);
    expect(screen.getByRole('button', { name: '开始换机识别' })).toHaveAttribute('data-variant', 'secondary');
    expect(screen.getByRole('button', { name: '解除长期绑定' })).toHaveAttribute('data-variant', 'danger-soft');
    expect(screen.queryByRole('link')).toBeNull();

    const tech = techDetails();
    expect(within(tech).getByText('sourceSeatId').nextElementSibling?.textContent).toBe(SOURCE_SEAT_ID);
    expect(within(tech).getByText('bindingId').nextElementSibling?.textContent).toBe(BINDING_ID);
    expect(within(tech).getByText('布局状态').nextElementSibling?.textContent).toBe('active');
    expect(within(tech).getByText('绑定版本').nextElementSibling?.textContent).toBe('4');
  });

  it('预检可用时显示服务、协议和凭据', async () => {
    const rendered = await renderDetail({
      view: boundView(),
      preflightState: 'available',
    });

    expect(screen.getByText(SERVICE_LINE)).toBeInTheDocument();
    expect(descriptionDetail('版本').textContent).toBe(SERVICE_LINE);
    rendered.unmount();

    await renderDetail({
      view: boundView({ preflight: null }),
      preflightState: 'available',
    });
    expect(screen.queryByText(/Service/)).toBeNull();
    expect(screen.queryByText('版本')).toBeNull();
  });

  it('没有配对窗口的未绑定座位只提供生成配对码', async () => {
    const rendered = await renderDetail({
      view: unboundView(),
      window: null,
      preflightState: 'unavailable',
    });

    expect(buttonNames()).toEqual(['为此座位生成配对码']);
    expect(screen.getByRole('button', { name: '为此座位生成配对码' })).toHaveAttribute('data-variant', 'secondary');
    expect(screen.queryByRole('button', { name: '开始换机识别' })).toBeNull();
    expect(screen.queryByRole('button', { name: '确认换机' })).toBeNull();
    expect(screen.queryByRole('button', { name: '取消本次认领' })).toBeNull();
    expect(screen.queryByRole('button', { name: '解除长期绑定' })).toBeNull();
    const tech = techDetails();
    expect(within(tech).getByText('sourceSeatId').nextElementSibling?.textContent).toBe(SOURCE_SEAT_ID);
    expect(within(tech).queryByText('bindingId')).toBeNull();
    expect(within(tech).getByText('绑定版本').nextElementSibling?.textContent).toBe('0');
    await userEvent.click(screen.getByRole('button', { name: '为此座位生成配对码' }));
    expect(rendered.props.onOpenSingle).toHaveBeenCalledTimes(1);
    expect(rendered.props.onOpenReplacement).not.toHaveBeenCalled();
    expect(rendered.props.onConfirmReplacement).not.toHaveBeenCalled();
    expect(rendered.props.onCancelPairing).not.toHaveBeenCalled();
    expect(rendered.props.onUnbind).not.toHaveBeenCalled();
  });

  it('已有配对窗口时不能再为座位开窗', async () => {
    const rendered = await renderDetail({
      view: boundView({ entry: null }),
      window: pairingWindow(),
    });

    expect(buttonNames()).toEqual(['解除长期绑定']);
    expect(screen.queryByRole('button', { name: '开始换机识别' })).toBeNull();
    expect(screen.queryByRole('button', { name: '为此座位生成配对码' })).toBeNull();
    rendered.unmount();

    await renderDetail({
      view: unboundView(),
      window: pairingWindow(),
    });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('换机已认领时要求确认且不提供解除长期绑定', async () => {
    const rendered = await renderDetail({
      view: boundView({
        status: 'identity-change',
        entry: pairingEntry({
          mode: 'replace',
          status: 'claimed',
          claimedEndpointId: CLAIMED_ENDPOINT,
          claimedAt: '2026-08-11T02:00:00.000Z',
        }),
      }),
      window: pairingWindow(),
      preflightState: 'unavailable',
    });

    expect(screen.getByText(REPLACEMENT_WARNING)).toBeInTheDocument();
    expect(screen.getByText(CLAIMED_ENDPOINT)).toBeInTheDocument();
    expect(buttonNames()).toEqual(['确认换机', '取消本次认领']);
    expect(screen.getByRole('button', { name: '确认换机' })).toHaveAttribute('data-variant', 'soft');
    expect(screen.getByRole('button', { name: '取消本次认领' })).toHaveAttribute('data-variant', 'secondary');
    expect(screen.queryByRole('button', { name: '解除长期绑定' })).toBeNull();
    expect(screen.queryByRole('button', { name: '开始换机识别' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '确认换机' }));
    expect(rendered.props.onConfirmReplacement).toHaveBeenCalledTimes(1);
    expect(rendered.props.onCancelPairing).not.toHaveBeenCalled();
    expect(rendered.props.onUnbind).not.toHaveBeenCalled();
  });

  it('时间线先显示确认换机和操作人，空历史给出没有绑定记录', async () => {
    const rendered = await renderDetail({
      view: boundView(),
      history: [
        historyEntry('replace', REPLACE_AT, `${BINDING_ID}:2`, NEXT_ENDPOINT, PREVIOUS_ENDPOINT),
        historyEntry('bind', BIND_AT, `${BINDING_ID}:1`, BOUND_ENDPOINT, null),
      ],
    });
    const items = screen.getAllByRole('listitem');
    const first = items[0];
    const second = items[1];
    if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)) throw new TypeError('history items missing');

    expect(screen.getByRole('heading', { name: HISTORY_TITLE })).toBeInTheDocument();
    expect(items).toHaveLength(2);
    expect(first.textContent).toContain('确认换机');
    expect(first.textContent).toContain('王老师');
    expect(first.textContent).toContain(formatDate(REPLACE_AT));
    expect(first.textContent).toContain(`${compactEndpoint(PREVIOUS_ENDPOINT)} → ${compactEndpoint(NEXT_ENDPOINT)}`);
    expect(second.textContent).toContain('建立绑定');
    expect(second.textContent).toContain('王老师');
    expect(second.textContent).toContain(compactEndpoint(BOUND_ENDPOINT));
    expect(second.textContent).not.toContain('→');
    rendered.unmount();

    await renderDetail({
      view: boundView(),
      history: [],
    });
    expect(screen.getByRole('heading', { name: HISTORY_TITLE })).toBeInTheDocument();
    expect(screen.getByText(EMPTY_HISTORY)).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('活动引用链接包含标题、未来时段和目标版本', async () => {
    await renderDetail({
      view: boundView({ references: [futureReference()] }),
    });

    const link = screen.getByRole('link', { name: new RegExp(EVENT_TITLE) });
    expect(link).toHaveAttribute('href', `/admin/exam-infrastructure/events/${EVENT_ID}`);
    expect(link.textContent).toContain(EVENT_TITLE);
    expect(link.textContent).toContain(`未来 · ${formatDate(EVENT_START)} – ${formatDate(EVENT_END)} · 目标 r3`);
  });

  it('禁用座位显示原因、备注和朝向', async () => {
    await renderDetail({
      view: unboundView({
        operational: operational({
          enabled: false,
          facing: 'left',
          disabledReason: 'computer_failure',
          note: '靠窗',
        }),
      }),
    });

    const configuration = descriptionDetail('运行配置');
    expect(configuration.textContent).toContain('已禁用');
    expect(configuration.textContent).toContain('原因：电脑故障');
    expect(configuration.textContent).toContain('朝向：左');
    expect(configuration.textContent).toContain('备注：靠窗');
    expect(badge('已禁用')).toHaveAttribute('data-tone', 'danger');
    expect(screen.queryByText('可用')).toBeNull();
  });

  it('开放认领时把八位配对码显示成四位一组', async () => {
    const rendered = await renderDetail({
      view: unboundView({ entry: pairingEntry({ status: 'open', mode: 'bind' }) }),
      code: PAIRING_CODE,
      window: pairingWindow(),
    });

    expect(screen.getByText(FORMATTED_CODE)).toBeInTheDocument();
    expect(screen.getByText('当前一次性配对码')).toBeInTheDocument();
    expect(screen.getByText(`尾号 ${CODE_HINT}`)).toBeInTheDocument();
    rendered.unmount();

    await renderDetail({
      view: unboundView({ entry: pairingEntry({ status: 'open', mode: 'bind' }) }),
      code: null,
      window: pairingWindow(),
    });
    expect(screen.getByText(LOST_CODE)).toBeInTheDocument();
    expect(screen.queryByText(FORMATTED_CODE)).toBeNull();
  });

  it('换机已认领时仍把八位配对码显示成四位一组', async () => {
    await renderDetail({
      view: boundView({
        status: 'identity-change',
        entry: pairingEntry({
          mode: 'replace',
          status: 'claimed',
          claimedEndpointId: CLAIMED_ENDPOINT,
          claimedAt: '2026-08-11T02:00:00.000Z',
        }),
      }),
      code: PAIRING_CODE,
      window: pairingWindow(),
    });

    expect(screen.getByText(REPLACEMENT_WARNING)).toBeInTheDocument();
    expect(screen.getByText(FORMATTED_CODE)).toBeInTheDocument();
    expect(screen.getByText(`尾号 ${CODE_HINT}`)).toBeInTheDocument();
  });

  it('协议版本为 0 时版本行保留 0，空服务版本显示未知', async () => {
    const zeroProtocol = await renderDetail({
      view: boundView({
        preflight: preflightItem({ protocolVersion: 0 }),
      }),
      preflightState: 'available',
    });
    expect(descriptionDetail('版本').textContent).toBe('Service 0.4.1 · 协议 0 · 凭据 active');
    zeroProtocol.unmount();

    await renderDetail({
      view: boundView({
        preflight: preflightItem({ serviceVersion: '' }),
      }),
      preflightState: 'available',
    });
    expect(descriptionDetail('版本').textContent).toBe('Service 未知 · 协议 2 · 凭据 active');
  });

  it('进行中的活动引用显示进行中和起止时间', async () => {
    const reference = futureReference();
    reference.eventState = 'active';
    await renderDetail({
      view: boundView({ references: [reference] }),
    });

    const link = screen.getByRole('link', { name: new RegExp(EVENT_TITLE) });
    expect(link.textContent).toContain(`进行中 · ${formatDate(EVENT_START)} – ${formatDate(EVENT_END)} · 目标 r3`);
    expect(link.textContent).not.toContain('未来');
  });

  it('解除绑定的历史只显示换下的原终端', async () => {
    await renderDetail({
      view: boundView(),
      history: [
        historyEntry('unbind', REPLACE_AT, `${BINDING_ID}:3`, NEXT_ENDPOINT, PREVIOUS_ENDPOINT),
      ],
    });

    const item = screen.getByRole('listitem');
    expect(item.textContent).toContain('解除绑定');
    expect(item.textContent).toContain('王老师');
    expect(item.textContent).toContain(compactEndpoint(PREVIOUS_ENDPOINT));
    expect(item.textContent).not.toContain(compactEndpoint(NEXT_ENDPOINT));
    expect(item.textContent).not.toContain('→');
  });

  it('座位详情通过设计门禁且每个按钮都写明 variant', () => {
    expect(existsSync(resolve(packageRoot, SEAT_DETAIL_SOURCE)), SEAT_DETAIL_SOURCE).toBe(true);
    expectDesignGateClean();
    expectExplicitVariants();
  });
});
