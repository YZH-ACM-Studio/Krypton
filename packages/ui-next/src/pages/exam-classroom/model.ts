import type { BadgeTone } from '@/components/ui/badge';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { createRequestId } from '@/lib/request-id';

export type SeatStatus = 'conflict' | 'identity-change' | 'offline' | 'online' | 'unbound' | 'unknown';
export type BindingStatus = 'active' | 'unbound';
export type PairingEntryStatus = 'bound' | 'cancelled' | 'claimed' | 'open';
export type PairingMode = 'bind' | 'replace';
export type SeatFacing = 'down' | 'left' | 'right' | 'unset' | 'up';
export type SeatDisabledReason = 'client_incompatible' | 'computer_failure' | 'manual_reserve' | 'physical_seat_unavailable';

export interface LayoutSeat {
  sourceSeatId: string;
  label: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation: number;
  status: string;
}

export interface LayoutDecoration {
  sourceItemId: string;
  label: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation: number;
  status: string;
  type: string;
}

export interface ClassroomLayout {
  schemaVersion: 1;
  coordinateSystem: 'cartesian' | 'grid';
  sourceFormat: 'empty' | 'items-v1' | 'legacy-grid-v1';
  rows: number | null;
  cols: number | null;
  fingerprint: string;
  seats: LayoutSeat[];
  decorations: LayoutDecoration[];
}

export interface ClassroomView {
  classroomId: string;
  schoolId: string;
  name: string;
  layoutRevision: number;
  layout: ClassroomLayout;
}

export interface BindingHistory {
  revision: number;
  action: 'bind' | 'replace' | 'unbind';
  actorUid: number;
  at: string;
  endpointId: string | null;
  previousEndpointId: string | null;
}

export interface SeatBinding {
  bindingId: string;
  sourceSeatId: string;
  status: BindingStatus;
  endpointId: string | null;
  revision: number;
  history: BindingHistory[];
  updatedAt: string;
  createdAt: string | null;
  createdBy: number | null;
  updatedBy: number | null;
}

export interface PairingEntry {
  sourceSeatId: string;
  mode: PairingMode;
  status: PairingEntryStatus;
  revision: number;
  codeHint: string;
  expectedBindingRevision: number;
  claimedEndpointId: string | null;
  claimedAt: string | null;
  bindingRevision: number | null;
  completedAt: string | null;
}

export interface PairingWindow {
  windowId: string;
  status: 'closed' | 'open';
  revision: number;
  expiresAt: string;
  entries: PairingEntry[];
  createdAt: string;
  createdBy: number;
  closedAt: string | null;
  closedBy: number | null;
}

export interface SeatReference {
  kind: 'network-config' | 'network-execution';
  endpointId: string;
  eventId: string;
  eventTitle: string;
  eventState: 'active' | 'future';
  startAt: string;
  endAt: string;
  targetRevision: number;
}

export interface EndpointPreflightItem {
  endpointId: string;
  ready: boolean;
  reason: string;
  credentialStatus: string | null;
  online: boolean;
  compatible: boolean | null;
  serviceVersion: string | null;
  protocolVersion: number | null;
}

export interface EndpointPreflight {
  state: 'available' | 'not-required' | 'unavailable';
  items: EndpointPreflightItem[];
}

export interface SeatOperationalEntry {
  sourceSeatId: string;
  enabled: boolean;
  facing: SeatFacing;
  disabledReason: SeatDisabledReason | null;
  note: string | null;
}

export interface SeatOperationalProfile {
  schemaVersion: 1;
  domainId: string;
  schoolId: string;
  classroomId: string;
  layoutRevision: number;
  layoutFingerprint: string;
  revision: number;
  previousRevision: number | null;
  entries: SeatOperationalEntry[];
  fingerprint: string;
  persisted: boolean;
  createdAt: string | null;
  createdBy: number | null;
}

export interface ClassroomState {
  classroom: ClassroomView;
  bindings: SeatBinding[];
  pairingWindow: PairingWindow | null;
  references: SeatReference[];
  endpointPreflight: EndpointPreflight;
  seatOperationalProfile: SeatOperationalProfile;
}

export interface ClassroomSummary {
  classroomId: string;
  schoolId: string;
  name: string;
  layoutRevision: number;
  seatCount: number;
}

export interface SeatView {
  seat: LayoutSeat;
  binding: SeatBinding | null;
  entry: PairingEntry | null;
  preflight: EndpointPreflightItem | null;
  references: SeatReference[];
  status: SeatStatus;
  operational: SeatOperationalEntry;
}

export interface CodeState {
  windowId: string;
  bySeat: Map<string, string>;
}

export interface ConfirmPlan {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  facts: Array<{ label: string; value: string }>;
  reasonDefault?: string;
  run: (input?: { reason: string }) => Promise<void>;
}

export const DEFAULT_REPLACEMENT_REVOKE_REASON = '换机后吊销旧终端';

export interface CanvasGeometry {
  width: number;
  height: number;
  item(item: LayoutSeat | LayoutDecoration): { height: number; left: number; top: number; width: number };
}

export const STATUS_LABELS: Record<SeatStatus, string> = {
  conflict: '冲突',
  'identity-change': '身份变化',
  offline: '已绑定 · 离线',
  online: '已绑定 · 在线',
  unbound: '未绑定',
  unknown: '已绑定 · 未检测在线状态',
};

export const STATUS_STYLES: Record<SeatStatus, string> = {
  conflict: 'border-danger-line bg-danger-soft text-danger-fg hover:bg-danger-soft hover:text-danger-fg',
  'identity-change': 'border-warning-line bg-warning-soft text-warning-fg hover:bg-warning-soft hover:text-warning-fg',
  offline: 'border-line bg-surface-active text-fg-muted hover:bg-surface-active hover:text-fg-muted',
  online: 'border-success-line bg-success-soft text-success-fg hover:bg-success-soft hover:text-success-fg',
  unbound: 'border-dashed border-line bg-bg text-fg hover:bg-bg hover:text-fg',
  unknown: 'border-success-line bg-surface text-fg hover:bg-surface hover:text-fg',
};

export const STATUS_DOT: Record<SeatStatus, { pulse?: boolean; tone: BadgeTone }> = {
  conflict: { tone: 'danger' },
  'identity-change': { tone: 'danger' },
  offline: { tone: 'neutral' },
  online: { tone: 'success', pulse: true },
  unbound: { tone: 'neutral' },
  unknown: { tone: 'neutral' },
};

export const FACING_LABELS: Record<SeatFacing, string> = {
  unset: '未设置',
  up: '上',
  right: '右',
  down: '下',
  left: '左',
};

export const FACING_MARKS: Record<SeatFacing, string> = {
  unset: '未',
  up: '↑',
  right: '→',
  down: '↓',
  left: '←',
};

export const DISABLED_REASON_LABELS: Record<SeatDisabledReason, string> = {
  computer_failure: '电脑故障',
  client_incompatible: '客户端不兼容',
  physical_seat_unavailable: '实体座位不可用',
  manual_reserve: '人工保留',
};

export type SeatFilter = 'all' | 'bound' | 'online' | 'offline' | 'unbound' | 'pairing' | 'identity-change' | 'conflict' | 'disabled';

export interface SeatHistoryEntry {
  key: string;
  at: string;
  action: BindingHistory['action'];
  label: string;
  seatLabel: string;
  endpointId: string | null;
  previousEndpointId: string | null;
  actorUid: number;
}

export interface PairingProgress {
  total: number;
  bound: number;
  cancelled: number;
  claimed: number;
  open: number;
}

const SEAT_FILTERS: readonly SeatFilter[] = [
  'all',
  'bound',
  'online',
  'offline',
  'unbound',
  'pairing',
  'identity-change',
  'conflict',
  'disabled',
];

export function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}响应格式不正确`);
  return value as Record<string, unknown>;
}

export function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}响应格式不正确`);
  return value;
}

export function optionalString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return asString(value, label);
}

export function asInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}响应格式不正确`);
  return Number(value);
}

export function optionalInteger(value: unknown, label: string): number | null {
  if (value === null) return null;
  return asInteger(value, label);
}

export function asFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}响应格式不正确`);
  return value;
}

export function optionalFiniteNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  return asFiniteNumber(value, label);
}

function optionalBindingString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return asString(value, '终端绑定');
}

function optionalBindingInteger(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  return asInteger(value, '终端绑定');
}

export function parseLayoutSeat(value: unknown): LayoutSeat {
  const seat = asRecord(value, '座位布局');
  return {
    sourceSeatId: asString(seat.sourceSeatId, '座位布局'),
    label: asString(seat.label, '座位布局'),
    x: asFiniteNumber(seat.x, '座位布局'),
    y: asFiniteNumber(seat.y, '座位布局'),
    width: optionalFiniteNumber(seat.width, '座位布局'),
    height: optionalFiniteNumber(seat.height, '座位布局'),
    rotation: asFiniteNumber(seat.rotation, '座位布局'),
    status: asString(seat.status, '座位布局'),
  };
}

export function parseLayoutDecoration(value: unknown): LayoutDecoration {
  const decoration = asRecord(value, '布局装饰');
  return {
    sourceItemId: asString(decoration.sourceItemId, '布局装饰'),
    label: asString(decoration.label, '布局装饰'),
    x: asFiniteNumber(decoration.x, '布局装饰'),
    y: asFiniteNumber(decoration.y, '布局装饰'),
    width: optionalFiniteNumber(decoration.width, '布局装饰'),
    height: optionalFiniteNumber(decoration.height, '布局装饰'),
    rotation: asFiniteNumber(decoration.rotation, '布局装饰'),
    status: asString(decoration.status, '布局装饰'),
    type: asString(decoration.type, '布局装饰'),
  };
}

export function parseClassroom(value: unknown): ClassroomView {
  const classroom = asRecord(value, '教室');
  const layout = asRecord(classroom.layout, '教室布局');
  const coordinateSystem = asString(layout.coordinateSystem, '教室布局');
  const sourceFormat = asString(layout.sourceFormat, '教室布局');
  const schemaVersion = asInteger(layout.schemaVersion, '教室布局');
  if (
    schemaVersion !== 1 ||
    (coordinateSystem !== 'cartesian' && coordinateSystem !== 'grid') ||
    !['empty', 'items-v1', 'legacy-grid-v1'].includes(sourceFormat)
  ) {
    throw new Error('教室布局响应格式不正确');
  }
  if (!Array.isArray(layout.seats) || !Array.isArray(layout.decorations)) throw new Error('教室布局响应格式不正确');
  return {
    classroomId: asString(classroom.classroomId, '教室'),
    schoolId: asString(classroom.schoolId, '教室'),
    name: asString(classroom.name, '教室'),
    layoutRevision: asInteger(classroom.layoutRevision, '教室'),
    layout: {
      schemaVersion,
      coordinateSystem,
      sourceFormat: sourceFormat as ClassroomLayout['sourceFormat'],
      rows: optionalInteger(layout.rows, '教室布局'),
      cols: optionalInteger(layout.cols, '教室布局'),
      fingerprint: asString(layout.fingerprint, '教室布局'),
      seats: layout.seats.map(parseLayoutSeat),
      decorations: layout.decorations.map(parseLayoutDecoration),
    },
  };
}

export function parseHistory(value: unknown): BindingHistory {
  const history = asRecord(value, '绑定历史');
  const action = asString(history.action, '绑定历史');
  if (action !== 'bind' && action !== 'replace' && action !== 'unbind') throw new Error('绑定历史响应格式不正确');
  return {
    revision: asInteger(history.revision, '绑定历史'),
    action,
    actorUid: asInteger(history.actorUid, '绑定历史'),
    at: asString(history.at, '绑定历史'),
    endpointId: optionalString(history.endpointId, '绑定历史'),
    previousEndpointId: optionalString(history.previousEndpointId, '绑定历史'),
  };
}

export function parseBinding(value: unknown): SeatBinding {
  const binding = asRecord(value, '终端绑定');
  const status = asString(binding.status, '终端绑定');
  if (status !== 'active' && status !== 'unbound') throw new Error('终端绑定响应格式不正确');
  if (!Array.isArray(binding.history)) throw new Error('终端绑定响应格式不正确');
  return {
    bindingId: asString(binding.bindingId, '终端绑定'),
    sourceSeatId: asString(binding.sourceSeatId, '终端绑定'),
    status,
    endpointId: optionalString(binding.endpointId, '终端绑定'),
    revision: asInteger(binding.revision, '终端绑定'),
    history: binding.history.map(parseHistory),
    updatedAt: asString(binding.updatedAt, '终端绑定'),
    createdAt: optionalBindingString(binding.createdAt),
    createdBy: optionalBindingInteger(binding.createdBy),
    updatedBy: optionalBindingInteger(binding.updatedBy),
  };
}

export function parsePairingEntry(value: unknown): PairingEntry {
  const entry = asRecord(value, '配对窗口');
  const mode = asString(entry.mode, '配对窗口');
  const status = asString(entry.status, '配对窗口');
  if ((mode !== 'bind' && mode !== 'replace') || !['bound', 'cancelled', 'claimed', 'open'].includes(status)) {
    throw new Error('配对窗口响应格式不正确');
  }
  return {
    sourceSeatId: asString(entry.sourceSeatId, '配对窗口'),
    mode,
    status: status as PairingEntryStatus,
    revision: asInteger(entry.revision, '配对窗口'),
    codeHint: asString(entry.codeHint, '配对窗口'),
    expectedBindingRevision: asInteger(entry.expectedBindingRevision, '配对窗口'),
    claimedEndpointId: optionalString(entry.claimedEndpointId, '配对窗口'),
    claimedAt: optionalString(entry.claimedAt, '配对窗口'),
    bindingRevision: optionalInteger(entry.bindingRevision, '配对窗口'),
    completedAt: optionalString(entry.completedAt, '配对窗口'),
  };
}

export function parsePairingWindow(value: unknown): PairingWindow | null {
  if (value === null) return null;
  const window = asRecord(value, '配对窗口');
  const status = asString(window.status, '配对窗口');
  if ((status !== 'open' && status !== 'closed') || !Array.isArray(window.entries)) throw new Error('配对窗口响应格式不正确');
  return {
    windowId: asString(window.windowId, '配对窗口'),
    status,
    revision: asInteger(window.revision, '配对窗口'),
    expiresAt: asString(window.expiresAt, '配对窗口'),
    entries: window.entries.map(parsePairingEntry),
    createdAt: asString(window.createdAt, '配对窗口'),
    createdBy: asInteger(window.createdBy, '配对窗口'),
    closedAt: optionalString(window.closedAt, '配对窗口'),
    closedBy: optionalInteger(window.closedBy, '配对窗口'),
  };
}

export function parseReference(value: unknown): SeatReference {
  const reference = asRecord(value, '活动引用');
  const kind = asString(reference.kind, '活动引用');
  const eventState = asString(reference.eventState, '活动引用');
  if ((kind !== 'network-config' && kind !== 'network-execution') || (eventState !== 'active' && eventState !== 'future')) {
    throw new Error('活动引用响应格式不正确');
  }
  return {
    kind,
    endpointId: asString(reference.endpointId, '活动引用'),
    eventId: asString(reference.eventId, '活动引用'),
    eventTitle: asString(reference.eventTitle, '活动引用'),
    eventState,
    startAt: asString(reference.startAt, '活动引用'),
    endAt: asString(reference.endAt, '活动引用'),
    targetRevision: asInteger(reference.targetRevision, '活动引用'),
  };
}

export function parsePreflightItem(value: unknown): EndpointPreflightItem {
  const item = asRecord(value, '终端状态');
  if (typeof item.ready !== 'boolean' || typeof item.online !== 'boolean' || (item.compatible !== null && typeof item.compatible !== 'boolean')) {
    throw new Error('终端状态响应格式不正确');
  }
  return {
    endpointId: asString(item.endpointId, '终端状态'),
    ready: item.ready,
    reason: asString(item.reason, '终端状态'),
    credentialStatus: optionalString(item.credentialStatus, '终端状态'),
    online: item.online,
    compatible: item.compatible,
    serviceVersion: optionalString(item.serviceVersion, '终端状态'),
    protocolVersion: optionalInteger(item.protocolVersion, '终端状态'),
  };
}

export function parseSeatOperationalEntry(value: unknown): SeatOperationalEntry {
  const entry = asRecord(value, '座位运行配置');
  const facing = asString(entry.facing, '座位运行配置');
  if (typeof entry.enabled !== 'boolean' || !['down', 'left', 'right', 'unset', 'up'].includes(facing)) {
    throw new Error('座位运行配置响应格式不正确');
  }
  const disabledReason = optionalString(entry.disabledReason, '座位运行配置');
  const note = optionalString(entry.note, '座位运行配置');
  if (
    (entry.enabled && (disabledReason !== null || note !== null)) ||
    (!entry.enabled &&
      (disabledReason === null ||
        !['client_incompatible', 'computer_failure', 'manual_reserve', 'physical_seat_unavailable'].includes(disabledReason)))
  ) {
    throw new Error('座位运行配置响应格式不正确');
  }
  return {
    sourceSeatId: asString(entry.sourceSeatId, '座位运行配置'),
    enabled: entry.enabled,
    facing: facing as SeatFacing,
    disabledReason: disabledReason as SeatDisabledReason | null,
    note,
  };
}

export function parseSeatOperationalProfile(value: unknown, classroom: ClassroomView): SeatOperationalProfile {
  const profile = asRecord(value, '座位运行配置');
  if (profile.schemaVersion !== 1 || typeof profile.persisted !== 'boolean' || !Array.isArray(profile.entries)) {
    throw new Error('座位运行配置响应格式不正确');
  }
  const revision = asInteger(profile.revision, '座位运行配置');
  const previousRevision = optionalInteger(profile.previousRevision, '座位运行配置');
  const createdAt = optionalString(profile.createdAt, '座位运行配置');
  const createdBy = optionalInteger(profile.createdBy, '座位运行配置');
  const entries = profile.entries.map(parseSeatOperationalEntry);
  const seatIds = classroom.layout.seats.map((seat) => seat.sourceSeatId).sort();
  const profileSeatIds = entries.map((entry) => entry.sourceSeatId).sort();
  if (
    revision < 0 ||
    (revision === 0 && (profile.persisted || previousRevision !== null || createdAt !== null || createdBy !== null)) ||
    (revision > 0 && (!profile.persisted || createdAt === null || createdBy === null)) ||
    asString(profile.classroomId, '座位运行配置') !== classroom.classroomId ||
    asString(profile.schoolId, '座位运行配置') !== classroom.schoolId ||
    asInteger(profile.layoutRevision, '座位运行配置') !== classroom.layoutRevision ||
    asString(profile.layoutFingerprint, '座位运行配置') !== classroom.layout.fingerprint ||
    seatIds.length !== profileSeatIds.length ||
    seatIds.some((seatId, index) => seatId !== profileSeatIds[index]) ||
    !/^[a-f0-9]{64}$/.test(asString(profile.fingerprint, '座位运行配置'))
  ) {
    throw new Error('座位运行配置响应格式不正确');
  }
  return {
    schemaVersion: 1,
    domainId: asString(profile.domainId, '座位运行配置'),
    schoolId: classroom.schoolId,
    classroomId: classroom.classroomId,
    layoutRevision: classroom.layoutRevision,
    layoutFingerprint: classroom.layout.fingerprint,
    revision,
    previousRevision,
    entries,
    fingerprint: asString(profile.fingerprint, '座位运行配置'),
    persisted: profile.persisted,
    createdAt,
    createdBy,
  };
}

export function parseState(value: unknown): ClassroomState {
  const state = asRecord(value, '教室工作台');
  const classroom = parseClassroom(state.classroom);
  const preflight = asRecord(state.endpointPreflight, '终端状态');
  const preflightState = asString(preflight.state, '终端状态');
  if (!['available', 'not-required', 'unavailable'].includes(preflightState) || !Array.isArray(preflight.items)) {
    throw new Error('终端状态响应格式不正确');
  }
  if (!Array.isArray(state.bindings) || !Array.isArray(state.references)) throw new Error('教室工作台响应格式不正确');
  return {
    classroom,
    bindings: state.bindings.map(parseBinding),
    pairingWindow: parsePairingWindow(state.pairingWindow),
    references: state.references.map(parseReference),
    endpointPreflight: {
      state: preflightState as EndpointPreflight['state'],
      items: preflight.items.map(parsePreflightItem),
    },
    seatOperationalProfile: parseSeatOperationalProfile(state.seatOperationalProfile, classroom),
  };
}

export function parseClassroomSummary(value: unknown): ClassroomSummary {
  const classroom = asRecord(value, '教室列表');
  return {
    classroomId: asString(classroom.classroomId, '教室列表'),
    schoolId: asString(classroom.schoolId, '教室列表'),
    name: asString(classroom.name, '教室列表'),
    layoutRevision: asInteger(classroom.layoutRevision, '教室列表'),
    seatCount: asInteger(classroom.seatCount, '教室列表'),
  };
}

export async function apiObject(path: string, init?: RequestInit, fallback = '操作失败'): Promise<Record<string, unknown>> {
  const response = await fetchHydroResponse(path, init);
  if (!response.ok) throw new Error(await readHydroResponseError(response, fallback));
  return asRecord(await response.json(), fallback);
}

export function postJson(path: string, body: Record<string, unknown>, fallback: string) {
  return apiObject(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    fallback,
  );
}

export function requestId(prefix: string): string {
  return `${prefix}_${createRequestId().replaceAll('-', '')}`;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short', hour12: false }).format(date);
}

export function compactEndpoint(value: string | null): string {
  if (!value) return '—';
  return value.length <= 22 ? value : `${value.slice(0, 12)}…${value.slice(-6)}`;
}

export function atLeastVersion(value: string | null, minimum: [number, number, number]): boolean {
  if (!value) return false;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  return (
    parts.some((part, index) => part > minimum[index] && parts.slice(0, index).every((item, itemIndex) => item === minimum[itemIndex])) ||
    parts.every((part, index) => part === minimum[index])
  );
}

export function buildGeometry(layout: ClassroomLayout): CanvasGeometry {
  const items: Array<LayoutSeat | LayoutDecoration> = [...layout.seats, ...layout.decorations];
  if (!items.length) return { width: 720, height: 420, item: () => ({ left: 0, top: 0, width: 0, height: 0 }) };
  const defaultLogicalWidth = layout.coordinateSystem === 'grid' ? 0.82 : 48;
  const defaultLogicalHeight = layout.coordinateSystem === 'grid' ? 0.68 : 36;
  const minX = Math.min(...items.map((item) => item.x));
  const minY = Math.min(...items.map((item) => item.y));
  const maxX = Math.max(...items.map((item) => item.x + (item.width || defaultLogicalWidth)));
  const maxY = Math.max(...items.map((item) => item.y + (item.height || defaultLogicalHeight)));
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const unit = layout.coordinateSystem === 'grid' ? 72 : Math.min(24, Math.max(0.2, 1_240 / spanX));
  const padding = 52;
  return {
    width: Math.max(680, spanX * unit + padding * 2),
    height: Math.max(430, spanY * unit + padding * 2),
    item: (item) => ({
      left: (item.x - minX) * unit + padding,
      top: (item.y - minY) * unit + padding,
      width: (item.width || (layout.coordinateSystem === 'grid' ? defaultLogicalWidth : 52 / unit)) * unit,
      height: (item.height || (layout.coordinateSystem === 'grid' ? defaultLogicalHeight : 42 / unit)) * unit,
    }),
  };
}

export function activeWindow(window: PairingWindow | null, now: number): PairingWindow | null {
  if (!window || window.status !== 'open') return null;
  if (new Date(window.expiresAt).getTime() > now || window.entries.some((entry) => entry.status === 'claimed')) return window;
  return null;
}

export function deriveSeatViews(state: ClassroomState, now: number): SeatView[] {
  const bindings = new Map(state.bindings.map((binding) => [binding.sourceSeatId, binding]));
  const operationalEntries = new Map(state.seatOperationalProfile.entries.map((entry) => [entry.sourceSeatId, entry]));
  const preflight = new Map(state.endpointPreflight.items.map((item) => [item.endpointId, item]));
  const window = activeWindow(state.pairingWindow, now);
  const entries = new Map(window?.entries.map((entry) => [entry.sourceSeatId, entry]) || []);
  return state.classroom.layout.seats.map((seat) => {
    const operational = operationalEntries.get(seat.sourceSeatId);
    if (!operational) throw new Error('座位运行配置响应缺少实体座位');
    const binding = bindings.get(seat.sourceSeatId) || null;
    const entry = entries.get(seat.sourceSeatId) || null;
    const activeBinding = binding?.status === 'active' && binding.endpointId ? binding : null;
    const endpoint = activeBinding?.endpointId || null;
    const item = endpoint ? preflight.get(endpoint) || null : null;
    const references = endpoint ? state.references.filter((reference) => reference.endpointId === endpoint) : [];
    const pendingEntry = entry && (entry.status === 'open' || entry.status === 'claimed') ? entry : null;
    const completedBindingConflict = Boolean(
      entry?.status === 'bound' &&
      (!activeBinding || entry.claimedEndpointId !== activeBinding.endpointId || entry.bindingRevision !== activeBinding.revision),
    );
    const modeConflict = Boolean(
      completedBindingConflict ||
      (pendingEntry &&
        ((pendingEntry.mode === 'bind' && activeBinding) ||
          (pendingEntry.mode === 'replace' && !activeBinding) ||
          (pendingEntry.status === 'claimed' && !pendingEntry.claimedEndpointId))),
    );
    const healthConflict = Boolean(
      activeBinding &&
      state.endpointPreflight.state === 'available' &&
      (!item ||
        item.credentialStatus !== 'active' ||
        item.compatible === false ||
        !atLeastVersion(item.serviceVersion, [0, 4, 0]) ||
        (!item.ready && item.reason !== 'endpoint_offline')),
    );
    let status: SeatStatus;
    if (modeConflict || healthConflict || (!activeBinding && entry?.status === 'claimed')) status = 'conflict';
    else if (entry?.mode === 'replace' && entry.status === 'claimed') status = 'identity-change';
    else if (!activeBinding) status = 'unbound';
    else if (state.endpointPreflight.state !== 'available') status = 'unknown';
    else status = item?.online ? 'online' : 'offline';
    return { seat, binding, entry, preflight: item, references, status, operational };
  });
}

export function seatAccessibleName(view: SeatView): string {
  const facts = [view.seat.label || view.seat.sourceSeatId, STATUS_LABELS[view.status]];
  facts.push(
    view.operational.enabled
      ? `朝向${FACING_LABELS[view.operational.facing]}`
      : `已禁用，${DISABLED_REASON_LABELS[view.operational.disabledReason!]}`,
  );
  if (view.binding?.endpointId) facts.push(compactEndpoint(view.binding.endpointId));
  if (view.references.length) facts.push(`被 ${view.references.length} 个活动引用`);
  return facts.join('，');
}

export function directionalSeat(current: SeatView, views: SeatView[], key: string): SeatView | null {
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const positive = key === 'ArrowRight' || key === 'ArrowDown';
  const candidates = views.filter((candidate) => {
    if (candidate.seat.sourceSeatId === current.seat.sourceSeatId) return false;
    const primary = horizontal ? candidate.seat.x - current.seat.x : candidate.seat.y - current.seat.y;
    return positive ? primary > 0 : primary < 0;
  });
  candidates.sort((left, right) => {
    const leftPrimary = Math.abs(horizontal ? left.seat.x - current.seat.x : left.seat.y - current.seat.y);
    const rightPrimary = Math.abs(horizontal ? right.seat.x - current.seat.x : right.seat.y - current.seat.y);
    const leftSecondary = Math.abs(horizontal ? left.seat.y - current.seat.y : left.seat.x - current.seat.x);
    const rightSecondary = Math.abs(horizontal ? right.seat.y - current.seat.y : right.seat.x - current.seat.x);
    return leftPrimary * 1_000 + leftSecondary - (rightPrimary * 1_000 + rightSecondary);
  });
  return candidates[0] || null;
}

export function seatMatchesFilter(view: SeatView, filter: SeatFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'bound') return view.status === 'online' || view.status === 'offline' || view.status === 'unknown';
  if (filter === 'disabled') return !view.operational.enabled;
  if (filter === 'pairing') {
    const entryStatus = view.entry?.status;
    return (entryStatus === 'open' || entryStatus === 'claimed') && view.status !== 'identity-change' && view.status !== 'conflict';
  }
  return view.status === filter;
}

export function seatFilterCounts(views: SeatView[]): Record<SeatFilter, number> {
  const counts: Record<SeatFilter, number> = {
    all: 0,
    bound: 0,
    online: 0,
    offline: 0,
    unbound: 0,
    pairing: 0,
    'identity-change': 0,
    conflict: 0,
    disabled: 0,
  };
  for (const view of views) {
    for (const filter of SEAT_FILTERS) {
      if (seatMatchesFilter(view, filter)) counts[filter] += 1;
    }
  }
  return counts;
}

function historyActionLabel(action: BindingHistory['action']): string {
  if (action === 'bind') return '建立绑定';
  if (action === 'replace') return '确认换机';
  return '解除绑定';
}

function historyEntries(state: ClassroomState, sourceSeatId?: string): SeatHistoryEntry[] {
  return state.bindings
    .filter((binding) => sourceSeatId === undefined || binding.sourceSeatId === sourceSeatId)
    .flatMap((binding) =>
      binding.history.map((history) => ({
        key: `${binding.bindingId}:${history.revision}`,
        at: history.at,
        action: history.action,
        label: historyActionLabel(history.action),
        seatLabel: state.classroom.layout.seats.find((seat) => seat.sourceSeatId === binding.sourceSeatId)?.label || binding.sourceSeatId,
        endpointId: history.endpointId,
        previousEndpointId: history.previousEndpointId,
        actorUid: history.actorUid,
      })),
    )
    .sort((left, right) => right.at.localeCompare(left.at));
}

export function seatHistory(state: ClassroomState, sourceSeatId: string): SeatHistoryEntry[] {
  return historyEntries(state, sourceSeatId);
}

export function recentOperations(state: ClassroomState, limit: number): SeatHistoryEntry[] {
  return historyEntries(state).slice(0, limit);
}

export function pairingProgress(pairingWindow: PairingWindow): PairingProgress {
  const progress: PairingProgress = { total: pairingWindow.entries.length, bound: 0, cancelled: 0, claimed: 0, open: 0 };
  for (const entry of pairingWindow.entries) progress[entry.status] += 1;
  return progress;
}

export function remainingLabel(expiresAt: string, now: number): string {
  const remainingMs = Date.parse(expiresAt) - now;
  if (!(remainingMs > 0)) return '已到期';
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function readClassroomMode(url?: string): 'bind' | 'config' {
  const parsed = url === undefined ? new URL(window.location.href) : new URL(url);
  return parsed.searchParams.get('mode') === 'config' ? 'config' : 'bind';
}

export function writeClassroomMode(mode: 'bind' | 'config'): void {
  const url = new URL(window.location.href);
  if (mode === 'bind') url.searchParams.delete('mode');
  else url.searchParams.set('mode', 'config');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
