import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Ban,
  CheckCircle2,
  CircleDashed,
  Crosshair,
  History,
  Keyboard,
  Link2,
  LocateFixed,
  MonitorCog,
  MousePointer2,
  RefreshCw,
  RotateCcw,
  Search,
  Unlink2,
  UserRoundCog,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { AdminPage } from '@/components/admin/admin-page';
import { ForbiddenPanel } from '@/components/admin/forbidden';
import { Alert } from '@/components/ui/alert';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner, StatusDot } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { isSystemAdmin } from '@/lib/perms';
import { createRequestId } from '@/lib/request-id';

type SeatStatus = 'conflict' | 'identity-change' | 'offline' | 'online' | 'unbound' | 'unknown';
type BindingStatus = 'active' | 'unbound';
type PairingEntryStatus = 'bound' | 'cancelled' | 'claimed' | 'open';
type PairingMode = 'bind' | 'replace';
type SeatFacing = 'down' | 'left' | 'right' | 'unset' | 'up';
type SeatDisabledReason = 'client_incompatible' | 'computer_failure' | 'manual_reserve' | 'physical_seat_unavailable';

interface LayoutSeat {
  sourceSeatId: string;
  label: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation: number;
  status: string;
}

interface LayoutDecoration {
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

interface ClassroomLayout {
  schemaVersion: 1;
  coordinateSystem: 'cartesian' | 'grid';
  sourceFormat: 'empty' | 'items-v1' | 'legacy-grid-v1';
  rows: number | null;
  cols: number | null;
  fingerprint: string;
  seats: LayoutSeat[];
  decorations: LayoutDecoration[];
}

interface ClassroomView {
  classroomId: string;
  schoolId: string;
  name: string;
  layoutRevision: number;
  layout: ClassroomLayout;
}

interface BindingHistory {
  revision: number;
  action: 'bind' | 'replace' | 'unbind';
  actorUid: number;
  at: string;
  endpointId: string | null;
  previousEndpointId: string | null;
}

interface SeatBinding {
  bindingId: string;
  sourceSeatId: string;
  status: BindingStatus;
  endpointId: string | null;
  revision: number;
  history: BindingHistory[];
  updatedAt: string;
}

interface PairingEntry {
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

interface PairingWindow {
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

interface SeatReference {
  kind: 'network-config' | 'network-execution';
  endpointId: string;
  eventId: string;
  eventTitle: string;
  eventState: 'active' | 'future';
  startAt: string;
  endAt: string;
  targetRevision: number;
}

interface EndpointPreflightItem {
  endpointId: string;
  ready: boolean;
  reason: string;
  credentialStatus: string | null;
  online: boolean;
  compatible: boolean | null;
  serviceVersion: string | null;
  protocolVersion: number | null;
}

interface EndpointPreflight {
  state: 'available' | 'not-required' | 'unavailable';
  items: EndpointPreflightItem[];
}

interface SeatOperationalEntry {
  sourceSeatId: string;
  enabled: boolean;
  facing: SeatFacing;
  disabledReason: SeatDisabledReason | null;
  note: string | null;
}

interface SeatOperationalProfile {
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

interface ClassroomState {
  classroom: ClassroomView;
  bindings: SeatBinding[];
  pairingWindow: PairingWindow | null;
  references: SeatReference[];
  endpointPreflight: EndpointPreflight;
  seatOperationalProfile: SeatOperationalProfile;
}

interface ClassroomSummary {
  classroomId: string;
  schoolId: string;
  name: string;
  layoutRevision: number;
  seatCount: number;
}

interface SeatView {
  seat: LayoutSeat;
  binding: SeatBinding | null;
  entry: PairingEntry | null;
  preflight: EndpointPreflightItem | null;
  references: SeatReference[];
  status: SeatStatus;
  operational: SeatOperationalEntry;
}

interface CodeState {
  windowId: string;
  bySeat: Map<string, string>;
}

interface ConfirmPlan {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  facts: Array<{ label: string; value: string }>;
  reasonDefault?: string;
  run: (input?: { reason: string }) => Promise<void>;
}

const DEFAULT_REPLACEMENT_REVOKE_REASON = '换机后吊销旧终端';

interface CanvasGeometry {
  width: number;
  height: number;
  item(item: LayoutSeat | LayoutDecoration): { height: number; left: number; top: number; width: number };
}

const STATUS_LABELS: Record<SeatStatus, string> = {
  conflict: '冲突',
  'identity-change': '身份变化',
  offline: '已绑定 · 离线',
  online: '已绑定 · 在线',
  unbound: '未绑定',
  unknown: '状态未知',
};

const STATUS_STYLES: Record<SeatStatus, string> = {
  conflict: 'border-danger-line bg-danger-soft text-danger-fg hover:bg-danger-soft hover:text-danger-fg',
  'identity-change': 'border-warning-line bg-warning-soft text-warning-fg hover:bg-warning-soft hover:text-warning-fg',
  offline: 'border-line bg-surface-active text-fg-muted hover:bg-surface-active hover:text-fg-muted',
  online: 'border-success-line bg-success-soft text-success-fg hover:bg-success-soft hover:text-success-fg',
  unbound: 'border-dashed border-line bg-bg text-fg hover:bg-bg hover:text-fg',
  unknown: 'border-line-strong bg-surface-sunken text-fg-muted hover:bg-surface-sunken hover:text-fg-muted',
};

const STATUS_DOT: Record<SeatStatus, { pulse?: boolean; tone: BadgeTone }> = {
  conflict: { tone: 'danger' },
  'identity-change': { tone: 'danger' },
  offline: { tone: 'neutral' },
  online: { tone: 'success', pulse: true },
  unbound: { tone: 'neutral' },
  unknown: { tone: 'danger' },
};

const FACING_LABELS: Record<SeatFacing, string> = {
  unset: '未设置',
  up: '上',
  right: '右',
  down: '下',
  left: '左',
};

const FACING_MARKS: Record<SeatFacing, string> = {
  unset: '未',
  up: '↑',
  right: '→',
  down: '↓',
  left: '←',
};

const DISABLED_REASON_LABELS: Record<SeatDisabledReason, string> = {
  computer_failure: '电脑故障',
  client_incompatible: '客户端不兼容',
  physical_seat_unavailable: '实体座位不可用',
  manual_reserve: '人工保留',
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}响应格式不正确`);
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}响应格式不正确`);
  return value;
}

function optionalString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return asString(value, label);
}

function asInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}响应格式不正确`);
  return Number(value);
}

function optionalInteger(value: unknown, label: string): number | null {
  if (value === null) return null;
  return asInteger(value, label);
}

function asFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}响应格式不正确`);
  return value;
}

function optionalFiniteNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  return asFiniteNumber(value, label);
}

function parseLayoutSeat(value: unknown): LayoutSeat {
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

function parseLayoutDecoration(value: unknown): LayoutDecoration {
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

function parseClassroom(value: unknown): ClassroomView {
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

function parseHistory(value: unknown): BindingHistory {
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

function parseBinding(value: unknown): SeatBinding {
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
  };
}

function parsePairingEntry(value: unknown): PairingEntry {
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

function parsePairingWindow(value: unknown): PairingWindow | null {
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

function parseReference(value: unknown): SeatReference {
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

function parsePreflightItem(value: unknown): EndpointPreflightItem {
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

function parseSeatOperationalEntry(value: unknown): SeatOperationalEntry {
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

function parseSeatOperationalProfile(value: unknown, classroom: ClassroomView): SeatOperationalProfile {
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

function parseState(value: unknown): ClassroomState {
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

function parseClassroomSummary(value: unknown): ClassroomSummary {
  const classroom = asRecord(value, '教室列表');
  return {
    classroomId: asString(classroom.classroomId, '教室列表'),
    schoolId: asString(classroom.schoolId, '教室列表'),
    name: asString(classroom.name, '教室列表'),
    layoutRevision: asInteger(classroom.layoutRevision, '教室列表'),
    seatCount: asInteger(classroom.seatCount, '教室列表'),
  };
}

async function apiObject(path: string, init?: RequestInit, fallback = '操作失败'): Promise<Record<string, unknown>> {
  const response = await fetchHydroResponse(path, init);
  if (!response.ok) throw new Error(await readHydroResponseError(response, fallback));
  return asRecord(await response.json(), fallback);
}

function postJson(path: string, body: Record<string, unknown>, fallback: string) {
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

function requestId(prefix: string): string {
  return `${prefix}_${createRequestId().replaceAll('-', '')}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short', hour12: false }).format(date);
}

function compactEndpoint(value: string | null): string {
  if (!value) return '—';
  return value.length <= 22 ? value : `${value.slice(0, 12)}…${value.slice(-6)}`;
}

function atLeastVersion(value: string | null, minimum: [number, number, number]): boolean {
  if (!value) return false;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  return (
    parts.some((part, index) => part > minimum[index] && parts.slice(0, index).every((item, itemIndex) => item === minimum[itemIndex])) ||
    parts.every((part, index) => part === minimum[index])
  );
}

function buildGeometry(layout: ClassroomLayout): CanvasGeometry {
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

function activeWindow(window: PairingWindow | null, now: number): PairingWindow | null {
  if (!window || window.status !== 'open') return null;
  if (new Date(window.expiresAt).getTime() > now || window.entries.some((entry) => entry.status === 'claimed')) return window;
  return null;
}

function deriveSeatViews(state: ClassroomState, now: number): SeatView[] {
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

function seatAccessibleName(view: SeatView): string {
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

function StatusMark({ status }: { status: SeatStatus }) {
  const mark = STATUS_DOT[status];
  return <StatusDot tone={mark.tone} pulse={mark.pulse} />;
}

function Notice({ error, message }: { error?: string | null; message?: string | null }) {
  if (!error && !message) return null;
  return <Alert tone={error ? 'danger' : 'success'}>{error || message}</Alert>;
}

function ConfirmActionDialog({ plan, busy, error, close }: { plan: ConfirmPlan | null; busy: boolean; error: string | null; close: () => void }) {
  return (
    <Dialog open={Boolean(plan)} onOpenChange={(open) => !open && !busy && close()}>
      {plan ? <ConfirmActionDialogContent key={plan.title} plan={plan} busy={busy} error={error} close={close} /> : null}
    </Dialog>
  );
}

function ConfirmActionDialogContent({
  plan,
  busy,
  error,
  close,
}: {
  plan: ConfirmPlan;
  busy: boolean;
  error: string | null;
  close: () => void;
}) {
  const [reason, setReason] = useState(plan.reasonDefault ?? '');
  const trimmedReason = reason.trim();
  const reasonReady = plan.reasonDefault === undefined || (trimmedReason.length > 0 && trimmedReason.length <= 500);
  return (
    <DialogContent onClose={busy ? undefined : close}>
      <DialogHeader>
        <DialogTitle>{plan.title}</DialogTitle>
        <DialogDescription className="pr-8">{plan.description}</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-3">
        <Notice error={error} />
        {plan.facts.map((fact) => (
          <div key={fact.label} className="grid gap-1 rounded-lg border border-line bg-surface-sunken px-3 py-2 sm:grid-cols-2">
            <span className="text-xs font-medium text-fg-subtle">{fact.label}</span>
            <span className="min-w-0 break-words text-sm">{fact.value}</span>
          </div>
        ))}
        {plan.reasonDefault !== undefined ? (
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-fg-subtle">吊销原因</span>
            <Input
              aria-label="吊销原因"
              value={reason}
              maxLength={500}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" disabled={busy} autoFocus onClick={close}>
          取消
        </Button>
        <Button
          type="button"
          variant={plan.destructive ? 'danger' : 'primary'}
          disabled={busy || !reasonReady}
          loading={busy}
          onClick={() => void plan.run({ reason: trimmedReason })}
        >
          {plan.confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function verticalScrollOwner(from: HTMLElement): HTMLElement | null {
  let current = from.parentElement;
  while (current) {
    const { overflowY } = getComputedStyle(current);
    if ((overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight - current.clientHeight > 1) return current;
    current = current.parentElement;
  }
  return null;
}

function directionalSeat(current: SeatView, views: SeatView[], key: string): SeatView | null {
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

function SeatCanvas({
  layout,
  views,
  selectedSeatId,
  operationalSelection,
  recentSeatId,
  zoom,
  onSelect,
  onOperationalSelectionChange,
}: {
  layout: ClassroomLayout;
  views: SeatView[];
  selectedSeatId: string | null;
  operationalSelection: Set<string> | null;
  recentSeatId: string | null;
  zoom: number;
  onSelect: (sourceSeatId: string) => void;
  onOperationalSelectionChange: (sourceSeatIds: Set<string>) => void;
}) {
  const geometry = useMemo(() => buildGeometry(layout), [layout]);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const seatRefs = useRef(new Map<string, HTMLButtonElement>());
  const drag = useRef<
    | { kind: 'pan'; pointerId: number; scrollLeft: number; pageScroller: HTMLElement | null; pageScrollTop: number; x: number; y: number }
    | { kind: 'select'; pointerId: number; startX: number; startY: number; currentX: number; currentY: number; base: Set<string> }
    | null
  >(null);
  const [selectionRectangle, setSelectionRectangle] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const focusSeat = (sourceSeatId: string) => {
    const target = seatRefs.current.get(sourceSeatId);
    onSelect(sourceSeatId);
    target?.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      seatRefs.current.get(sourceSeatId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  };

  useEffect(() => {
    if (!selectedSeatId) return;
    seatRefs.current.get(selectedSeatId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedSeatId]);

  const handleSeatKey = (event: ReactKeyboardEvent<HTMLButtonElement>, view: SeatView) => {
    let target: SeatView | null = null;
    if (['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp'].includes(event.key)) target = directionalSeat(view, views, event.key);
    else if (event.key === 'Home') target = views[0] || null;
    else if (event.key === 'End') target = views.at(-1) || null;
    else return;
    if (!target) return;
    event.preventDefault();
    focusSeat(target.seat.sourceSeatId);
  };

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest('[data-seat-id]')) return;
    if (operationalSelection !== null) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - bounds.left + event.currentTarget.scrollLeft;
      const y = event.clientY - bounds.top + event.currentTarget.scrollTop;
      drag.current = {
        kind: 'select',
        pointerId: event.pointerId,
        startX: x,
        startY: y,
        currentX: x,
        currentY: y,
        base: event.shiftKey || event.metaKey || event.ctrlKey ? new Set(operationalSelection) : new Set(),
      };
      setSelectionRectangle({ left: x, top: y, width: 0, height: 0 });
    } else {
      const pageScroller = verticalScrollOwner(event.currentTarget);
      drag.current = {
        kind: 'pan',
        pointerId: event.pointerId,
        scrollLeft: event.currentTarget.scrollLeft,
        pageScroller,
        pageScrollTop: pageScroller?.scrollTop ?? 0,
        x: event.clientX,
        y: event.clientY,
      };
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.kind === 'pan') {
      event.currentTarget.scrollLeft = active.scrollLeft - (event.clientX - active.x);
      if (active.pageScroller) active.pageScroller.scrollTop = active.pageScrollTop - (event.clientY - active.y);
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    active.currentX = event.clientX - bounds.left + event.currentTarget.scrollLeft;
    active.currentY = event.clientY - bounds.top + event.currentTarget.scrollTop;
    setSelectionRectangle({
      left: Math.min(active.startX, active.currentX),
      top: Math.min(active.startY, active.currentY),
      width: Math.abs(active.currentX - active.startX),
      height: Math.abs(active.currentY - active.startY),
    });
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    if (active.kind === 'select') {
      const left = Math.min(active.startX, active.currentX);
      const right = Math.max(active.startX, active.currentX);
      const top = Math.min(active.startY, active.currentY);
      const bottom = Math.max(active.startY, active.currentY);
      const next = new Set(active.base);
      for (const view of views) {
        const item = geometry.item(view.seat);
        const seatLeft = item.left * zoom;
        const seatTop = item.top * zoom;
        const seatRight = seatLeft + Math.max(48, item.width * zoom);
        const seatBottom = seatTop + Math.max(40, item.height * zoom);
        if (seatRight >= left && seatLeft <= right && seatBottom >= top && seatTop <= bottom) next.add(view.seat.sourceSeatId);
      }
      onOperationalSelectionChange(next);
      setSelectionRectangle(null);
    }
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  if (!layout.seats.length) {
    return (
      <EmptyState
        className="min-h-96 rounded-lg border border-dashed border-line"
        icon={<Crosshair />}
        title="这个教室没有实体座位"
        description="当前 canonical 布局为空。P2.3 不提供布局编辑或按名称猜测座位。"
      />
    );
  }

  return (
    <div
      ref={viewportRef}
      role="group"
      aria-label={operationalSelection === null ? '教室实体座位布局，可用方向键移动焦点' : '教室实体座位布局，拖动空白区域可框选座位'}
      className={cn(
        // overflow-x-auto 会把 overflow-y 算成 auto；hidden 避免画布抢页面的纵向滚轮。
        'relative min-h-64 min-w-0 overflow-x-auto overflow-y-hidden rounded-lg border border-line bg-surface-sunken',
        operationalSelection === null ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair',
      )}
      onPointerDown={beginPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      <div
        className="relative origin-top-left text-fg"
        style={{
          width: geometry.width * zoom,
          height: geometry.height * zoom,
          backgroundImage: 'radial-gradient(circle, var(--line) 1px, transparent 1px)',
          backgroundSize: `${18 * zoom}px ${18 * zoom}px`,
        }}
      >
        {layout.decorations.map((decoration) => {
          const item = geometry.item(decoration);
          return (
            <div
              key={decoration.sourceItemId}
              aria-hidden="true"
              className="pointer-events-none absolute flex items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-active px-2 text-2xs font-medium text-fg-subtle"
              style={{
                left: item.left * zoom,
                top: item.top * zoom,
                width: Math.max(36, item.width * zoom),
                height: Math.max(28, item.height * zoom),
                transform: `rotate(${decoration.rotation}deg)`,
              }}
            >
              {decoration.label || decoration.type}
            </div>
          );
        })}
        {selectionRectangle ? (
          <div aria-hidden="true" className="pointer-events-none absolute z-40 border border-brand bg-brand-soft" style={selectionRectangle} />
        ) : null}
        {views.map((view, index) => {
          const item = geometry.item(view.seat);
          const selected = selectedSeatId === view.seat.sourceSeatId;
          const operationallySelected = operationalSelection?.has(view.seat.sourceSeatId) || false;
          const recentlyResponded = recentSeatId === view.seat.sourceSeatId;
          return (
            // ds-allow DS005: 座位砖按布局宽高定位，Button 默认控件会裁掉 StatusDot 和第二行
            <button
              key={view.seat.sourceSeatId}
              ref={(node) => {
                if (node) seatRefs.current.set(view.seat.sourceSeatId, node);
                else seatRefs.current.delete(view.seat.sourceSeatId);
              }}
              type="button"
              data-seat-id={view.seat.sourceSeatId}
              aria-label={`${seatAccessibleName(view)}${operationallySelected ? '，已选入运行配置批量操作' : ''}`}
              aria-pressed={selected}
              tabIndex={selected || (!selectedSeatId && index === 0) ? 0 : -1}
              className={cn(
                'absolute flex min-h-0 min-w-0 flex-col items-stretch justify-between gap-0.5 overflow-hidden rounded-lg border-2 px-0.5 py-0.5 text-left text-2xs font-medium leading-none shadow-xs hover:z-20 focus-visible:z-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                STATUS_STYLES[view.status],
                recentlyResponded && 'z-20 ring-2 ring-info',
                selected && 'z-20 ring-2 ring-brand ring-offset-1 ring-offset-surface',
                operationallySelected && 'z-30 ring-2 ring-brand ring-offset-1 ring-offset-surface',
                !view.operational.enabled &&
                  'bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,var(--danger-soft)_6px,var(--danger-soft)_12px)]',
              )}
              style={{
                left: item.left * zoom,
                top: item.top * zoom,
                width: Math.max(48, item.width * zoom),
                height: Math.max(40, item.height * zoom),
                transform: `rotate(${view.seat.rotation}deg)`,
              }}
              onClick={() => {
                onSelect(view.seat.sourceSeatId);
                if (operationalSelection === null) return;
                const next = new Set(operationalSelection);
                if (next.has(view.seat.sourceSeatId)) next.delete(view.seat.sourceSeatId);
                else next.add(view.seat.sourceSeatId);
                onOperationalSelectionChange(next);
              }}
              onKeyDown={(event) => handleSeatKey(event, view)}
            >
              <span className="flex min-w-0 items-center justify-between gap-0.5">
                <span className="min-w-0 truncate">{view.seat.label || view.seat.sourceSeatId}</span>
                <span className="flex shrink-0 items-center gap-0.5">
                  <span
                    title={`业务朝向：${FACING_LABELS[view.operational.facing]}`}
                    className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-surface text-2xs font-bold leading-none"
                    style={{ transform: `rotate(${-view.seat.rotation}deg)` }}
                    aria-hidden="true"
                  >
                    {FACING_MARKS[view.operational.facing]}
                  </span>
                  {view.references.length ? <Link2 className="size-3 shrink-0" aria-hidden="true" /> : null}
                  <StatusMark status={view.status} />
                </span>
              </span>
              <span className="min-w-0 truncate font-mono leading-none text-fg-muted">
                {view.binding?.endpointId ? compactEndpoint(view.binding.endpointId) : view.entry ? `码尾 ${view.entry.codeHint}` : '空闲'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatusLegend() {
  const statuses: SeatStatus[] = ['unbound', 'online', 'offline', 'identity-change', 'conflict', 'unknown'];
  return (
    <div className="flex flex-wrap gap-2" aria-label="座位状态图例">
      {statuses.map((status) => (
        <span
          key={status}
          className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium', STATUS_STYLES[status])}
        >
          <StatusMark status={status} />
          {STATUS_LABELS[status]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-medium text-fg-subtle">
        <Link2 className="size-3" aria-hidden="true" />
        活动引用
      </span>
    </div>
  );
}

function FacingIcon({ facing }: { facing: SeatFacing }) {
  if (facing === 'up') return <ArrowUp className="size-4" aria-hidden="true" />;
  if (facing === 'right') return <ArrowRight className="size-4" aria-hidden="true" />;
  if (facing === 'down') return <ArrowDown className="size-4" aria-hidden="true" />;
  if (facing === 'left') return <ArrowLeft className="size-4" aria-hidden="true" />;
  return <CircleDashed className="size-4" aria-hidden="true" />;
}

function SeatOperationalProfileEditor({
  profile,
  selectedSeatIds,
  visibleSeatIds,
  busy,
  disabledReason,
  note,
  onDisabledReasonChange,
  onNoteChange,
  onSelectVisible,
  onClear,
  onFacing,
  onDisable,
  onRestore,
  onClose,
}: {
  profile: SeatOperationalProfile;
  selectedSeatIds: Set<string>;
  visibleSeatIds: string[];
  busy: boolean;
  disabledReason: SeatDisabledReason;
  note: string;
  onDisabledReasonChange: (reason: SeatDisabledReason) => void;
  onNoteChange: (note: string) => void;
  onSelectVisible: () => void;
  onClear: () => void;
  onFacing: (facing: SeatFacing) => void;
  onDisable: () => void;
  onRestore: () => void;
  onClose: () => void;
}) {
  const selectedEntries = profile.entries.filter((entry) => selectedSeatIds.has(entry.sourceSeatId));
  const canRestore = selectedEntries.some((entry) => !entry.enabled);
  return (
    <section className="space-y-4 rounded-lg bg-surface-sunken p-4" aria-label="座位运行配置编辑器">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <MousePointer2 className="size-4 shrink-0" aria-hidden="true" />
            批量设置座位运行配置
          </p>
          <p className="mt-1 text-xs text-fg-subtle">
            已选 {selectedSeatIds.size} 个座位。点击座位切换选择，或在布局空白处拖动框选；不会修改布局几何或终端绑定。
          </p>
          <p className="mt-1 font-mono text-2xs text-fg-subtle">
            当前 revision {profile.revision}
            {profile.persisted && profile.createdAt && profile.createdBy
              ? ` · ${formatDate(profile.createdAt)} · UID ${profile.createdBy}`
              : ' · 当前布局使用未持久化默认值'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={busy || !visibleSeatIds.length} onClick={onSelectVisible}>
            选择当前结果
          </Button>
          <Button variant="secondary" size="sm" disabled={busy || !selectedSeatIds.size} onClick={onClear}>
            清空选择
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            完成
          </Button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset disabled={busy || !selectedSeatIds.size} className="space-y-2">
          <legend className="text-xs font-medium">朝向</legend>
          <div className="flex flex-wrap gap-2">
            {(['unset', 'up', 'right', 'down', 'left'] as const).map((facing) => (
              <Button key={facing} type="button" size="sm" variant="secondary" onClick={() => onFacing(facing)}>
                <FacingIcon facing={facing} />
                {FACING_LABELS[facing]}
              </Button>
            ))}
          </div>
        </fieldset>
        <div className="space-y-2">
          <p className="text-xs font-medium">可用状态</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label>
              <span className="sr-only">禁用原因</span>
              <SimpleSelect
                ariaLabel="禁用原因"
                value={disabledReason}
                onValueChange={(reason) => onDisabledReasonChange(reason as SeatDisabledReason)}
                disabled={busy}
                size="sm"
                options={Object.entries(DISABLED_REASON_LABELS).map(([reason, label]) => ({
                  value: reason,
                  label,
                }))}
              />
            </label>
            <label>
              <span className="sr-only">禁用备注（可选）</span>
              <Input
                aria-label="禁用备注（可选）"
                value={note}
                maxLength={240}
                onChange={(event) => onNoteChange(event.target.value)}
                placeholder="可选备注，最多 240 字"
                disabled={busy}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="danger-soft" disabled={busy || !selectedSeatIds.size} onClick={onDisable}>
              <Ban className="size-4" aria-hidden="true" />
              禁用所选
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={busy || !canRestore} onClick={onRestore}>
              <CheckCircle2 className="size-4" aria-hidden="true" />
              恢复所选
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function PairingCode({ code, hint }: { code: string | null; hint: string }) {
  const displayCode = code ? `${code.slice(0, 4)}-${code.slice(4)}` : null;
  return (
    <div className="rounded-lg border border-info-line bg-info-soft px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-info-fg">当前一次性配对码</span>
        <Badge variant="outline">尾号 {hint}</Badge>
      </div>
      {displayCode ? (
        <p className="mt-2 select-all break-all font-mono text-lg font-semibold tracking-wider text-fg tabular">{displayCode}</p>
      ) : (
        <p className="mt-2 text-xs text-fg-muted">页面刷新后不会恢复明文码；请关闭当前窗口并重新生成。</p>
      )}
    </div>
  );
}

function SeatDetail({
  view,
  code,
  window,
  busy,
  onOpenSingle,
  onOpenReplacement,
  onConfirmReplacement,
  onCancelPairing,
  onUnbind,
}: {
  view: SeatView | null;
  code: string | null;
  window: PairingWindow | null;
  busy: boolean;
  onOpenSingle: () => void;
  onOpenReplacement: () => void;
  onConfirmReplacement: () => void;
  onCancelPairing: () => void;
  onUnbind: () => void;
}) {
  if (!view) {
    return (
      <Panel>
        <EmptyState compact icon={<LocateFixed />} title="选择一个实体座位" description="可点击布局，或从搜索框后用方向键遍历。" />
      </Panel>
    );
  }
  const activeBinding = view.binding?.status === 'active' && view.binding.endpointId ? view.binding : null;
  const claimedReplacement = view.entry?.mode === 'replace' && view.entry.status === 'claimed';
  const openEntry = view.entry && (view.entry.status === 'open' || view.entry.status === 'claimed') ? view.entry : null;
  const canOpen = !window;
  return (
    <Panel>
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-2xs font-medium uppercase tracking-wider text-fg-subtle">Physical seat</p>
            <h2 className="mt-1 break-words text-lg font-semibold text-fg">{view.seat.label || view.seat.sourceSeatId}</h2>
            <p className="mt-1 break-all font-mono text-2xs text-fg-subtle">{view.seat.sourceSeatId}</p>
          </div>
          <Badge className="shrink-0" tone={STATUS_DOT[view.status].tone} variant="soft">
            {STATUS_LABELS[view.status]}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-surface-sunken px-3 py-2">
            <p className="text-fg-subtle">绑定版本</p>
            <p className="mt-1 font-mono font-medium tabular">{view.binding?.revision || 0}</p>
          </div>
          <div className="min-w-0 rounded-lg bg-surface-sunken px-3 py-2">
            <p className="text-fg-subtle">布局状态</p>
            <p className="mt-1 truncate font-medium">{view.seat.status}</p>
          </div>
        </div>
        <div className="space-y-2 rounded-lg border border-line px-3 py-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">考试运行配置</span>
            <Badge tone={view.operational.enabled ? 'neutral' : 'danger'} variant="soft">{view.operational.enabled ? '可用' : '已禁用'}</Badge>
          </div>
          <p className="text-fg-subtle">朝向：{FACING_LABELS[view.operational.facing]}</p>
          {!view.operational.enabled && view.operational.disabledReason ? (
            <p>原因：{DISABLED_REASON_LABELS[view.operational.disabledReason]}</p>
          ) : null}
          {view.operational.note ? <p className="break-words text-fg-subtle">备注：{view.operational.note}</p> : null}
        </div>
        {activeBinding ? (
          <div className="space-y-2 rounded-lg border border-line px-3 py-3">
            <p className="text-xs font-medium text-fg-subtle">当前 Endpoint</p>
            <p className="break-all font-mono text-xs">{activeBinding.endpointId}</p>
            <div className="flex flex-wrap gap-2 text-2xs text-fg-subtle">
              <span>Service {view.preflight?.serviceVersion || '未知'}</span>
              <span>协议 {view.preflight?.protocolVersion ?? '未知'}</span>
              <span>凭据 {view.preflight?.credentialStatus || '未知'}</span>
            </div>
          </div>
        ) : null}
        {openEntry ? <PairingCode code={code} hint={openEntry.codeHint} /> : null}
        {claimedReplacement ? (
          <div className="rounded-lg border border-warning-line bg-warning-soft px-3 py-3 text-xs">
            <p className="font-medium text-warning-fg">新终端已完成身份认领，等待教师确认</p>
            <p className="mt-1 break-all font-mono text-warning-fg">{view.entry?.claimedEndpointId}</p>
          </div>
        ) : null}
        {view.references.length ? (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <Link2 className="size-3.5 shrink-0" aria-hidden="true" />
              活动引用
            </p>
            {view.references.map((reference) => (
              <a
                key={`${reference.kind}:${reference.eventId}:${reference.targetRevision}`}
                href={`/admin/exam-infrastructure/events/${reference.eventId}`}
                className="block min-w-0 rounded-lg border border-line px-3 py-2 text-xs hover:border-line-strong hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="font-medium">{reference.eventTitle}</span>
                <span className="ml-2 text-fg-subtle">
                  {reference.eventState === 'active' ? '进行中' : '未来'} · 目标 r{reference.targetRevision}
                </span>
              </a>
            ))}
          </div>
        ) : null}
        <div className="grid gap-2">
          {!activeBinding && canOpen ? (
            <Button variant="secondary" disabled={busy} onClick={onOpenSingle}>
              <Crosshair className="size-4" aria-hidden="true" />
              为此座位生成配对码
            </Button>
          ) : null}
          {activeBinding && !openEntry && canOpen ? (
            <Button disabled={busy} variant="secondary" onClick={onOpenReplacement}>
              <UserRoundCog className="size-4" aria-hidden="true" />
              开始换机识别
            </Button>
          ) : null}
          {claimedReplacement ? (
            <>
              <Button variant="soft" disabled={busy} onClick={onConfirmReplacement}>
                <CheckCircle2 className="size-4" aria-hidden="true" />
                确认换机
              </Button>
              <Button disabled={busy} variant="secondary" onClick={onCancelPairing}>
                <X className="size-4" aria-hidden="true" />
                取消本次认领
              </Button>
            </>
          ) : null}
          {activeBinding && !claimedReplacement ? (
            <Button disabled={busy} variant="danger-soft" onClick={onUnbind}>
              <Unlink2 className="size-4" aria-hidden="true" />
              解除长期绑定
            </Button>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function RecentOperations({ state }: { state: ClassroomState }) {
  const operations = useMemo(
    () =>
      state.bindings
        .flatMap((binding) =>
          binding.history.map((history) => ({
            key: `${binding.bindingId}:${history.revision}`,
            at: history.at,
            label: history.action === 'bind' ? '建立绑定' : history.action === 'replace' ? '确认换机' : '解除绑定',
            seat: state.classroom.layout.seats.find((seat) => seat.sourceSeatId === binding.sourceSeatId)?.label || binding.sourceSeatId,
            endpoint: history.endpointId || history.previousEndpointId,
            actorUid: history.actorUid,
          })),
        )
        .sort((left, right) => right.at.localeCompare(left.at))
        .slice(0, 8),
    [state],
  );
  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          <History className="size-4 shrink-0" aria-hidden="true" />
          最近操作
        </span>
      }
    >
      {operations.length ? (
        <ol className="space-y-3">
          {operations.map((operation) => (
            <li key={operation.key} className="border-l-2 border-line pl-3 text-xs">
              <p className="font-medium">
                {operation.label} · {operation.seat}
              </p>
              <p className="truncate font-mono text-2xs text-fg-subtle">{compactEndpoint(operation.endpoint)}</p>
              <p className="text-2xs text-fg-subtle">
                {formatDate(operation.at)} · UID {operation.actorUid}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-fg-muted">还没有绑定、换机或解绑记录。</p>
      )}
    </Panel>
  );
}

function ExamClassroomWorkspace({ classroomId }: { classroomId: string }) {
  const bootstrap = useBootstrap();
  const canRevokeEndpoint = isSystemAdmin(bootstrap.user.priv);
  const [state, setState] = useState<ClassroomState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<{ endpointId: string; seatLabel: string } | null>(null);
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [clock, setClock] = useState(Date.now());
  const [selectedSeatId, setSelectedSeatIdState] = useState<string | null>(() => new URLSearchParams(window.location.search).get('seat'));
  const [recentSeatId, setRecentSeatId] = useState<string | null>(null);
  const [codes, setCodes] = useState<CodeState | null>(null);
  const [plan, setPlan] = useState<ConfirmPlan | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [lastUndoable, setLastUndoable] = useState<{ revision: number; sourceSeatId: string } | null>(null);
  const [operationalSelection, setOperationalSelection] = useState<Set<string> | null>(null);
  const [disabledReason, setDisabledReason] = useState<SeatDisabledReason>('computer_failure');
  const [disabledNote, setDisabledNote] = useState('');
  const loadSequence = useRef(0);
  const previousBindings = useRef<Map<string, number> | null>(null);

  const setSelectedSeatId = useCallback((sourceSeatId: string) => {
    setSelectedSeatIdState(sourceSeatId);
    const url = new URL(window.location.href);
    url.searchParams.set('seat', sourceSeatId);
    window.history.replaceState(window.history.state, '', url);
  }, []);

  const load = useCallback(
    async (quiet = false) => {
      const sequence = ++loadSequence.current;
      if (!quiet) setLoading(true);
      try {
        const payload = await apiObject(
          `/api/admin/exam-infrastructure/classrooms/${encodeURIComponent(classroomId)}/seat-bindings`,
          undefined,
          '加载教室终端状态失败',
        );
        const parsed = parseState(payload);
        if (sequence !== loadSequence.current) return;
        setState(parsed);
        setCodes((current) => (current && current.windowId !== parsed.pairingWindow?.windowId ? null : current));
        setError(null);
      } catch (cause) {
        if (sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : '加载教室终端状态失败');
      } finally {
        if (sequence === loadSequence.current && !quiet) setLoading(false);
      }
    },
    [classroomId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const views = useMemo(() => (state ? deriveSeatViews(state, clock) : []), [clock, state]);
  const selected = views.find((view) => view.seat.sourceSeatId === selectedSeatId) || null;
  const currentWindow = state ? activeWindow(state.pairingWindow, clock) : null;
  const currentWindowCompleted = Boolean(
    currentWindow && currentWindow.entries.every((entry) => entry.status === 'bound' || entry.status === 'cancelled'),
  );

  useEffect(() => {
    if (!state?.classroom.layout.seats.length) return;
    const valid = state.classroom.layout.seats.some((seat) => seat.sourceSeatId === selectedSeatId);
    if (!valid) setSelectedSeatId(state.classroom.layout.seats[0].sourceSeatId);
  }, [selectedSeatId, setSelectedSeatId, state]);

  useEffect(() => {
    if (!state || operationalSelection === null) return;
    const validSeatIds = new Set(state.classroom.layout.seats.map((seat) => seat.sourceSeatId));
    setOperationalSelection((current) => {
      if (current === null) return null;
      const next = new Set([...current].filter((seatId) => validSeatIds.has(seatId)));
      return next.size === current.size ? current : next;
    });
  }, [operationalSelection, state]);

  useEffect(() => {
    if (!currentWindow) {
      setCodes(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setClock(Date.now());
      void load(true);
    }, 4_000);
    return () => window.clearTimeout(timer);
  }, [currentWindow, load]);

  useEffect(() => {
    if (!state) return;
    const current = new Map(
      state.bindings.filter((binding) => binding.status === 'active').map((binding) => [binding.sourceSeatId, binding.revision]),
    );
    const previous = previousBindings.current;
    previousBindings.current = current;
    if (!previous) return;
    const newlyBound = [...current.entries()]
      .filter(([sourceSeatId]) => !previous.has(sourceSeatId) && codes?.bySeat.has(sourceSeatId))
      .sort(([leftSeatId], [rightSeatId]) => {
        const left = state.bindings.find((binding) => binding.sourceSeatId === leftSeatId)?.updatedAt || '';
        const right = state.bindings.find((binding) => binding.sourceSeatId === rightSeatId)?.updatedAt || '';
        return left.localeCompare(right) || leftSeatId.localeCompare(rightSeatId);
      });
    if (!newlyBound.length) return;
    const [sourceSeatId, revision] = newlyBound.at(-1)!;
    setRecentSeatId(sourceSeatId);
    setLastUndoable({ sourceSeatId, revision });
    setCodes((currentCodes) => {
      if (!currentCodes || !newlyBound.some(([seatId]) => currentCodes.bySeat.has(seatId))) return currentCodes;
      const bySeat = new Map(currentCodes.bySeat);
      newlyBound.forEach(([seatId]) => bySeat.delete(seatId));
      return { ...currentCodes, bySeat };
    });
    const seat = state.classroom.layout.seats.find((candidate) => candidate.sourceSeatId === sourceSeatId);
    const next = state.classroom.layout.seats.find(
      (candidate) => candidate.sourceSeatId !== sourceSeatId && !current.has(candidate.sourceSeatId) && candidate.sourceSeatId !== selectedSeatId,
    );
    setMessage(`${seat?.label || sourceSeatId} 已绑定${next ? `，已选中下一个未绑定座位 ${next.label || next.sourceSeatId}` : ''}。`);
    if (selectedSeatId === sourceSeatId && next) setSelectedSeatId(next.sourceSeatId);
  }, [codes, selectedSeatId, setSelectedSeatId, state]);

  useEffect(() => {
    if (!lastUndoable || !state) return;
    const binding = state.bindings.find((candidate) => candidate.sourceSeatId === lastUndoable.sourceSeatId);
    if (!binding || binding.status !== 'active' || binding.revision !== lastUndoable.revision) setLastUndoable(null);
  }, [lastUndoable, state]);

  const visibleViews = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return views;
    return views.filter((view) =>
      [view.seat.label, view.seat.sourceSeatId, view.binding?.endpointId || '', view.entry?.claimedEndpointId || ''].some((value) =>
        value.toLocaleLowerCase().includes(needle),
      ),
    );
  }, [query, views]);
  const canvasSelectedSeatId = visibleViews.some((view) => view.seat.sourceSeatId === selectedSeatId) ? selectedSeatId : null;

  const mutate = async (work: () => Promise<void>, success: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await work();
      setMessage(success);
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const saveOperationalEntries = async (
    sourceSeatIds: Set<string>,
    update: (entry: SeatOperationalEntry) => SeatOperationalEntry,
    success: string,
  ) => {
    if (!state || !sourceSeatIds.size) return;
    const profile = state.seatOperationalProfile;
    const entries = profile.entries.map((entry) => (sourceSeatIds.has(entry.sourceSeatId) ? update(entry) : entry));
    if (JSON.stringify(entries) === JSON.stringify(profile.entries)) {
      setError(null);
      setMessage('所选座位已经是该运行配置，无需新增 revision。');
      return;
    }
    await mutate(async () => {
      await postJson(
        `/api/admin/exam-infrastructure/classrooms/${encodeURIComponent(classroomId)}/seat-operational-profile`,
        {
          entries,
          expectedRevision: profile.revision,
          layoutFingerprint: profile.layoutFingerprint,
          layoutRevision: profile.layoutRevision,
        },
        '保存座位运行配置失败',
      );
    }, success);
  };

  const createPairingWindow = async (sourceSeatIds: string[], replacementSeatIds: string[]) => {
    if (!state || !sourceSeatIds.length) throw new Error('没有可开启配对窗口的座位');
    const payload = await postJson(
      `/api/admin/exam-infrastructure/classrooms/${encodeURIComponent(classroomId)}/seat-pairing-window`,
      {
        action: 'open',
        expectedRevision: state.pairingWindow?.revision || 0,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        replacementSeatIds,
        requestId: requestId('seat_window'),
        sourceSeatIds,
      },
      '开启配对窗口失败',
    );
    const window = parsePairingWindow(payload.pairingWindow);
    if (!window || !Array.isArray(payload.codes)) throw new Error('配对窗口响应格式不正确');
    const bySeat = new Map<string, string>();
    for (const value of payload.codes) {
      const code = asRecord(value, '配对码');
      const canonicalCode = asString(code.code, '配对码');
      if (!/^[0-9]{8}$/.test(canonicalCode)) throw new Error('配对窗口响应格式不正确');
      bySeat.set(asString(code.sourceSeatId, '配对码'), canonicalCode);
    }
    if (bySeat.size !== sourceSeatIds.length || sourceSeatIds.some((sourceSeatId) => !bySeat.has(sourceSeatId))) {
      throw new Error('配对窗口响应格式不正确');
    }
    setState((current) => (current ? { ...current, pairingWindow: window } : current));
    setCodes({ windowId: window.windowId, bySeat });
    setClock(Date.now());
  };

  const openWindow = async (sourceSeatIds: string[], replacementSeatIds: string[]) => {
    await mutate(
      () => createPairingWindow(sourceSeatIds, replacementSeatIds),
      `${sourceSeatIds.length} 个座位的配对窗口已开启，明文码只保留在当前页面。`,
    );
  };

  const closeWindow = () => {
    if (!state?.pairingWindow || state.pairingWindow.status !== 'open') return;
    const window = state.pairingWindow;
    setPlan({
      title: '关闭当前配对窗口',
      description: '关闭后未使用的明文码立即失效；已经完成的绑定和历史审计不会回滚。',
      confirmLabel: '关闭窗口',
      facts: [
        { label: '窗口版本', value: String(window.revision) },
        { label: '座位数', value: String(window.entries.length) },
        { label: '到期时间', value: formatDate(window.expiresAt) },
      ],
      run: async () => {
        setPlanBusy(true);
        setPlanError(null);
        try {
          const payload = await postJson(
            `/api/admin/exam-infrastructure/classrooms/${encodeURIComponent(classroomId)}/seat-pairing-window`,
            { action: 'close', expectedRevision: window.revision, requestId: requestId('seat_close') },
            '关闭配对窗口失败',
          );
          const closed = parsePairingWindow(payload.pairingWindow);
          if (!closed || closed.status !== 'closed') throw new Error('关闭配对窗口响应格式不正确');
          setState((current) => (current ? { ...current, pairingWindow: closed } : current));
          setPlan(null);
          setCodes(null);
          setMessage('配对窗口已关闭。');
          await load(true);
        } catch (cause) {
          setPlanError(cause instanceof Error ? cause.message : '关闭配对窗口失败');
        } finally {
          setPlanBusy(false);
        }
      },
    });
  };

  const requestUnbind = async (view: SeatView, undo = false) => {
    if (!view.binding || view.binding.status !== 'active') return;
    setBusy(true);
    setError(null);
    try {
      const payload = await postJson(
        `/api/admin/exam-infrastructure/classrooms/${encodeURIComponent(classroomId)}/seat-bindings/${encodeURIComponent(view.seat.sourceSeatId)}`,
        { action: 'previewUnbind' },
        '生成解绑确认失败',
      );
      const preview = asRecord(payload.preview, '解绑确认');
      if (!Array.isArray(preview.references)) throw new Error('解绑确认响应格式不正确');
      const references = preview.references.map(parseReference);
      const expectedBindingRevision = asInteger(preview.bindingRevision, '解绑确认');
      const confirmationFingerprint = asString(preview.confirmationFingerprint, '解绑确认');
      const endpointId = asString(preview.endpointId, '解绑确认');
      setPlan({
        title: undo ? '撤销刚完成的绑定' : '解除长期绑定',
        description: references.length
          ? '该终端已被活动快照引用。解绑不会改写已发布目标，但会影响后续动态解析，请核对后继续。'
          : '解绑会保留完整历史，不会删除 Endpoint 身份，也不会修改教室布局。',
        confirmLabel: undo ? '撤销绑定' : '确认解绑',
        destructive: true,
        facts: [
          { label: '实体座位', value: view.seat.label || view.seat.sourceSeatId },
          { label: 'Endpoint', value: endpointId },
          { label: '绑定版本', value: String(expectedBindingRevision) },
          { label: '活动引用', value: references.map((reference) => reference.eventTitle).join('、') || '无' },
        ],
        run: async () => {
          setPlanBusy(true);
          setPlanError(null);
          try {
            await postJson(
              `/api/admin/exam-infrastructure/classrooms/${encodeURIComponent(classroomId)}/seat-bindings/${encodeURIComponent(view.seat.sourceSeatId)}`,
              {
                action: 'unbind',
                confirmationFingerprint,
                expectedBindingRevision,
                requestId: requestId(undo ? 'seat_undo' : 'seat_unbind'),
              },
              undo ? '撤销绑定失败' : '解除绑定失败',
            );
            setPlan(null);
            setLastUndoable(null);
            setMessage(`${view.seat.label || view.seat.sourceSeatId} 已解除绑定。`);
            await load(true);
          } catch (cause) {
            setPlanError(cause instanceof Error ? cause.message : '解除绑定失败');
          } finally {
            setPlanBusy(false);
          }
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成解绑确认失败');
    } finally {
      setBusy(false);
    }
  };

  const requestReplacementConfirmation = async (view: SeatView) => {
    if (!state?.pairingWindow || !view.entry || view.entry.status !== 'claimed') return;
    setBusy(true);
    setError(null);
    try {
      const payload = await postJson(
        `/api/admin/exam-infrastructure/classrooms/${encodeURIComponent(classroomId)}/seat-bindings/${encodeURIComponent(view.seat.sourceSeatId)}`,
        { action: 'previewReplacement', windowId: state.pairingWindow.windowId },
        '生成换机确认失败',
      );
      const preview = asRecord(payload.preview, '换机确认');
      if (!Array.isArray(preview.references)) throw new Error('换机确认响应格式不正确');
      const references = preview.references.map(parseReference);
      const windowId = asString(preview.windowId, '换机确认');
      const expectedEntryRevision = asInteger(preview.entryRevision, '换机确认');
      const expectedBindingRevision = asInteger(preview.bindingRevision, '换机确认');
      const confirmationFingerprint = asString(preview.confirmationFingerprint, '换机确认');
      const oldEndpointId = asString(preview.oldEndpointId, '换机确认');
      const newEndpointId = asString(preview.newEndpointId, '换机确认');
      setPlan({
        title: '确认终端换机',
        description: 'OJ 会保留旧 Endpoint 和完整换机链；已发布或执行中的目标快照不会被改写。',
        confirmLabel: '确认换机',
        facts: [
          { label: '实体座位', value: view.seat.label || view.seat.sourceSeatId },
          { label: '原 Endpoint', value: oldEndpointId },
          { label: '新 Endpoint', value: newEndpointId },
          { label: '活动引用', value: references.map((reference) => reference.eventTitle).join('、') || '无' },
        ],
        run: async () => {
          setPlanBusy(true);
          setPlanError(null);
          try {
            await postJson(
              `/api/admin/exam-infrastructure/classrooms/${encodeURIComponent(classroomId)}/seat-bindings/${encodeURIComponent(view.seat.sourceSeatId)}`,
              {
                action: 'confirmReplacement',
                confirmationFingerprint,
                expectedBindingRevision,
                expectedEntryRevision,
                requestId: requestId('seat_replace'),
                windowId,
              },
              '确认换机失败',
            );
            setPlan(null);
            setMessage(`${view.seat.label || view.seat.sourceSeatId} 已完成换机。`);
            if (canRevokeEndpoint) {
              setPendingRevoke({
                endpointId: oldEndpointId,
                seatLabel: view.seat.label || view.seat.sourceSeatId,
              });
            }
            await load(true);
          } catch (cause) {
            setPlanError(cause instanceof Error ? cause.message : '确认换机失败');
          } finally {
            setPlanBusy(false);
          }
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成换机确认失败');
    } finally {
      setBusy(false);
    }
  };

  const requestOldEndpointRevoke = (target: { endpointId: string; seatLabel: string }) => {
    setPlan({
      title: '吊销旧终端凭据',
      description: `换机完成后旧终端仍然有效。确认吊销 ${target.endpointId} 的凭据后，该终端将无法再用于考试。`,
      confirmLabel: '确认吊销',
      destructive: true,
      reasonDefault: DEFAULT_REPLACEMENT_REVOKE_REASON,
      facts: [
        { label: '实体座位', value: target.seatLabel },
        { label: '旧 Endpoint', value: target.endpointId },
      ],
      run: async (input) => {
        const reason = input?.reason.trim() ?? '';
        if (!reason) return;
        setPlanBusy(true);
        setPlanError(null);
        try {
          await postJson(
            `/api/admin/endpoint-credentials/${encodeURIComponent(target.endpointId)}/revoke`,
            { reason },
            '吊销旧终端失败',
          );
          setPlan(null);
          setPendingRevoke(null);
          setMessage(`已吊销旧终端 ${target.endpointId}。`);
        } catch (cause) {
          setPlanError(cause instanceof Error ? cause.message : '吊销旧终端失败');
        } finally {
          setPlanBusy(false);
        }
      },
    });
  };

  const cancelPairing = async (view: SeatView) => {
    if (!state?.pairingWindow || !view.entry) return;
    await mutate(
      async () => {
        await postJson(
          `/api/admin/exam-infrastructure/classrooms/${encodeURIComponent(classroomId)}/seat-bindings/${encodeURIComponent(view.seat.sourceSeatId)}`,
          {
            action: 'cancelPairing',
            expectedEntryRevision: view.entry!.revision,
            requestId: requestId('seat_cancel'),
            windowId: state.pairingWindow!.windowId,
          },
          '取消终端认领失败',
        );
      },
      `${view.seat.label || view.seat.sourceSeatId} 的终端认领已取消。`,
    );
  };

  if (loading && !state) {
    return (
      <AdminPage bypassPrivGate hideSidebar contentClassName="min-w-0 overflow-x-clip" title="教室终端工作台">
        <div className="flex min-h-64 items-center justify-center text-fg-subtle">
          <Spinner aria-label="正在加载" />
          <span className="sr-only">正在加载</span>
        </div>
      </AdminPage>
    );
  }

  if (!state) {
    return (
      <AdminPage bypassPrivGate hideSidebar contentClassName="min-w-0 overflow-x-clip" title="教室终端工作台">
        <Notice error={error || '教室终端状态不可用'} />
        <Button className="mt-4" variant="secondary" onClick={() => void load()}>
          <RefreshCw className="size-4" aria-hidden="true" />
          重试
        </Button>
      </AdminPage>
    );
  }

  const selectedCode =
    selected && currentWindow && codes?.windowId === currentWindow.windowId ? codes.bySeat.get(selected.seat.sourceSeatId) || null : null;
  const summary = views.reduce((counts, view) => ({ ...counts, [view.status]: counts[view.status] + 1 }), {
    conflict: 0,
    'identity-change': 0,
    offline: 0,
    online: 0,
    unbound: 0,
    unknown: 0,
  } satisfies Record<SeatStatus, number>);
  const unbound = views.filter((view) => view.status === 'unbound');
  const undoView = lastUndoable ? views.find((view) => view.seat.sourceSeatId === lastUndoable.sourceSeatId) || null : null;

  return (
    <AdminPage
      bypassPrivGate
      hideSidebar
      contentClassName="flex min-w-0 flex-col gap-6 overflow-x-clip short:gap-4"
      title={state.classroom.name}
      description="按导入坐标呈现实体座位；运行配置只维护可用状态与明确朝向，不修改 sourceSeatId、label、几何或长期绑定。"
      actions={
        <>
          {undoView ? (
            <Button variant="secondary" disabled={busy} onClick={() => void requestUnbind(undoView, true)}>
              <RotateCcw className="size-4" aria-hidden="true" />
              撤销刚完成的绑定
            </Button>
          ) : null}
          {canRevokeEndpoint && pendingRevoke ? (
            <Button variant="danger-soft" disabled={busy} onClick={() => requestOldEndpointRevoke(pendingRevoke)}>
              <Ban className="size-4" aria-hidden="true" />
              吊销旧终端
            </Button>
          ) : null}
          <Button variant="secondary" disabled={busy} onClick={() => void load()}>
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} aria-hidden="true" />
            刷新状态
          </Button>
        </>
      }
    >
      <a
        href="/admin/exam-infrastructure"
        className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
        返回考试基础设施
      </a>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">布局 r{state.classroom.layoutRevision}</Badge>
        <Badge variant="outline">
          运行配置 r{state.seatOperationalProfile.revision}
          {state.seatOperationalProfile.persisted ? '' : ' · 默认'}
        </Badge>
        <Badge variant="soft" tone="neutral">{state.classroom.layout.seats.length} 座</Badge>
      </div>
      <Notice error={error} message={message} />
      {state.endpointPreflight.state === 'unavailable' ? (
        <Alert tone="warning">
          Vigil 当前不可用；长期绑定仍来自 OJ canonical，但在线/离线状态显示为“未知”，不会伪装成离线。
        </Alert>
      ) : null}

      <section className="rounded-lg border border-line bg-surface-sunken px-4 py-3" aria-label="教室终端摘要">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-x-4 gap-y-2 font-mono text-xs tabular">
            <span className="text-success-fg">ONLINE {summary.online}</span>
            <span className="text-fg-muted">OFFLINE {summary.offline}</span>
            <span className="text-info-fg">UNBOUND {summary.unbound}</span>
            <span className="text-warning-fg">IDENTITY {summary['identity-change']}</span>
            <span className="text-danger-fg">CONFLICT {summary.conflict}</span>
          </div>
          <span className="font-mono text-2xs text-fg-subtle">LAYOUT {state.classroom.layout.fingerprint.slice(0, 12)}</span>
          <span className="font-mono text-2xs text-fg-subtle">
            PROFILE {state.seatOperationalProfile.fingerprint.slice(0, 12)}
            {state.seatOperationalProfile.createdBy ? ` · UID ${state.seatOperationalProfile.createdBy}` : ''}
          </span>
        </div>
      </section>

      {currentWindow ? (
        <section
          className="flex flex-col gap-3 rounded-lg border border-info-line bg-info-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          aria-label="当前配对窗口"
        >
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium text-info-fg">
              <Activity className="size-4 shrink-0" aria-hidden="true" />
              {currentWindowCompleted ? '配对已完成' : '配对窗口进行中'} · r{currentWindow.revision}
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              {currentWindowCompleted
                ? `${currentWindow.entries.length} 个座位均已处理；关闭窗口后可继续为下一座位生成配对码。`
                : `${currentWindow.entries.length} 个座位 · ${formatDate(currentWindow.expiresAt)} 到期 · 页面仅在窗口期间轮询响应`}
            </p>
          </div>
          <Button variant="secondary" disabled={busy} onClick={closeWindow}>
            {currentWindowCompleted ? '关闭并继续下一台' : '关闭窗口'}
          </Button>
          {recentSeatId ? (
            <Button
              variant="secondary"
              onClick={() => {
                setQuery('');
                setSelectedSeatId(recentSeatId);
              }}
            >
              <LocateFixed className="size-4" aria-hidden="true" />
              定位最近响应
            </Button>
          ) : null}
        </section>
      ) : null}

      <div className="grid min-h-0 min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block min-w-0 flex-1 sm:max-w-md">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
              <span className="sr-only">搜索座位、sourceSeatId 或 Endpoint</span>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-8"
                placeholder="搜索座位、sourceSeatId 或 Endpoint"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                iconOnly
                aria-label="缩小布局"
                disabled={zoom <= 0.75}
                onClick={() => setZoom((value) => Math.max(0.75, Number((value - 0.25).toFixed(2))))}
              >
                <ZoomOut className="size-4" />
              </Button>
              <span className="w-12 text-center font-mono text-xs tabular" aria-live="polite">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                variant="secondary"
                size="sm"
                iconOnly
                aria-label="放大布局"
                disabled={zoom >= 2}
                onClick={() => setZoom((value) => Math.min(2, Number((value + 0.25).toFixed(2))))}
              >
                <ZoomIn className="size-4" />
              </Button>
              <Button variant="secondary" size="sm" iconOnly aria-label="恢复默认缩放" onClick={() => setZoom(1)}>
                <LocateFixed className="size-4" />
              </Button>
              <Button
                variant={operationalSelection === null ? 'secondary' : 'soft'}
                disabled={busy}
                onClick={() => setOperationalSelection((current) => (current === null ? new Set(selectedSeatId ? [selectedSeatId] : []) : null))}
              >
                <MousePointer2 className="size-4" aria-hidden="true" />
                {operationalSelection === null ? '批量设置运行配置' : '退出批量设置'}
              </Button>
              <Button
                variant="primary"
                disabled={busy || Boolean(currentWindow) || !unbound.length}
                onClick={() =>
                  setPlan({
                    title: '批量识别所有未绑定座位',
                    description: '将为当前教室全部未绑定实体座位生成独立短时码；不会按主机名自动匹配。',
                    confirmLabel: `生成 ${unbound.length} 个码`,
                    facts: [
                      { label: '未绑定座位', value: String(unbound.length) },
                      { label: '有效时间', value: '5 分钟' },
                      { label: '明文保存', value: '仅当前页面内存' },
                    ],
                    run: async () => {
                      setPlanBusy(true);
                      setPlanError(null);
                      try {
                        await createPairingWindow(
                          unbound.map((view) => view.seat.sourceSeatId),
                          [],
                        );
                        setPlan(null);
                        setMessage(`${unbound.length} 个座位的配对窗口已开启，明文码只保留在当前页面。`);
                        await load(true);
                      } catch (cause) {
                        setPlanError(cause instanceof Error ? cause.message : '开启配对窗口失败');
                      } finally {
                        setPlanBusy(false);
                      }
                    },
                  })
                }
              >
                <Crosshair className="size-4" aria-hidden="true" />
                批量识别未绑定
              </Button>
            </div>
          </div>
          {operationalSelection !== null ? (
            <SeatOperationalProfileEditor
              profile={state.seatOperationalProfile}
              selectedSeatIds={operationalSelection}
              visibleSeatIds={visibleViews.map((view) => view.seat.sourceSeatId)}
              busy={busy}
              disabledReason={disabledReason}
              note={disabledNote}
              onDisabledReasonChange={setDisabledReason}
              onNoteChange={setDisabledNote}
              onSelectVisible={() => setOperationalSelection(new Set(visibleViews.map((view) => view.seat.sourceSeatId)))}
              onClear={() => setOperationalSelection(new Set())}
              onFacing={(facing) =>
                void saveOperationalEntries(
                  operationalSelection,
                  (entry) => ({ ...entry, facing }),
                  `${operationalSelection.size} 个座位的朝向已保存。`,
                )
              }
              onDisable={() =>
                void saveOperationalEntries(
                  operationalSelection,
                  (entry) => ({
                    ...entry,
                    enabled: false,
                    disabledReason,
                    note: disabledNote.trim() || null,
                  }),
                  `${operationalSelection.size} 个座位已标记为不可用于考试。`,
                )
              }
              onRestore={() =>
                void saveOperationalEntries(
                  operationalSelection,
                  (entry) => ({ ...entry, enabled: true, disabledReason: null, note: null }),
                  `${operationalSelection.size} 个座位已恢复可用。`,
                )
              }
              onClose={() => setOperationalSelection(null)}
            />
          ) : null}
          <StatusLegend />
          {visibleViews.length || !state.classroom.layout.seats.length ? (
            <SeatCanvas
              layout={state.classroom.layout}
              views={visibleViews}
              selectedSeatId={canvasSelectedSeatId}
              operationalSelection={operationalSelection}
              recentSeatId={recentSeatId}
              zoom={zoom}
              onSelect={setSelectedSeatId}
              onOperationalSelectionChange={setOperationalSelection}
            />
          ) : (
            <EmptyState
              className="min-h-64 rounded-lg border border-dashed border-line"
              icon={<Search />}
              title="没有匹配的实体座位"
              action={
                <Button variant="secondary" onClick={() => setQuery('')}>
                  清除搜索
                </Button>
              }
            />
          )}
          <div className="flex items-center gap-2 text-xs text-fg-subtle">
            <Keyboard className="size-4 shrink-0" aria-hidden="true" />
            Tab 进入布局，方向键按坐标移动，Home/End 跳至首尾；拖动空白区域或滚动可平移。
          </div>
        </div>
        <aside className="min-w-0 space-y-4 xl:sticky xl:top-0 xl:self-start">
          <SeatDetail
            view={selected}
            code={selectedCode}
            window={currentWindow}
            busy={busy}
            onOpenSingle={() => selected && void openWindow([selected.seat.sourceSeatId], [])}
            onOpenReplacement={() => selected && void openWindow([selected.seat.sourceSeatId], [selected.seat.sourceSeatId])}
            onConfirmReplacement={() => selected && void requestReplacementConfirmation(selected)}
            onCancelPairing={() => selected && void cancelPairing(selected)}
            onUnbind={() => selected && void requestUnbind(selected)}
          />
          <RecentOperations state={state} />
        </aside>
      </div>
      <ConfirmActionDialog
        plan={plan}
        busy={planBusy}
        error={planError}
        close={() => {
          setPlan(null);
          setPlanError(null);
        }}
      />
    </AdminPage>
  );
}

export interface ClassroomLauncherSchool {
  schoolId: string;
  name: string;
}

export function ClassroomLauncher({ schools }: { schools: ClassroomLauncherSchool[] }) {
  const [open, setOpen] = useState(false);
  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [classroomWarning, setClassroomWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!open || requested) return;
    setRequested(true);
    setLoading(true);
    void apiObject('/api/admin/exam-infrastructure/classrooms', undefined, '加载教室列表失败')
      .then((payload) => {
        if (!Array.isArray(payload.classrooms)) throw new Error('教室列表响应格式不正确');
        const warning =
          payload.classroomWarning == null
            ? null
            : payload.classroomWarning === 'classroom_sources_unavailable'
              ? 'classroom_sources_unavailable'
              : (() => {
                  throw new Error('教室列表警告格式不正确');
                })();
        setClassrooms(payload.classrooms.map(parseClassroomSummary));
        setClassroomWarning(warning);
        setError(null);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : '加载教室列表失败'))
      .finally(() => setLoading(false));
  }, [open, requested]);

  const schoolNames = new Map(schools.map((school) => [school.schoolId, school.name]));
  const needle = query.trim().toLocaleLowerCase();
  const visible = needle
    ? classrooms.filter((classroom) =>
        [classroom.name, classroom.classroomId, schoolNames.get(classroom.schoolId) || ''].some((value) =>
          value.toLocaleLowerCase().includes(needle),
        ),
      )
    : classrooms;

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <MonitorCog className="size-4" aria-hidden="true" />
        教室终端
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg" onClose={() => setOpen(false)}>
          <DialogHeader>
            <DialogTitle>打开教室终端工作台</DialogTitle>
            <DialogDescription>选择已导入并确认的 canonical 教室；这里不会重新导入或编辑布局。</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <Notice error={error} />
            {classroomWarning === 'classroom_sources_unavailable' ? (
              <div role="alert" className="rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning-fg">
                教室数据暂不可用，页面仍可打开。请检查教室布局后再写入。
              </div>
            ) : null}
            <label className="relative block">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
              <span className="sr-only">搜索教室</span>
              <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-8" placeholder="搜索教室或学校" autoFocus />
            </label>
            {loading ? (
              <div className="flex min-h-24 items-center justify-center text-fg-subtle">
                <Spinner />
                <span className="sr-only">正在加载教室</span>
              </div>
            ) : visible.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {visible.map((classroom) => (
                  <a
                    key={classroom.classroomId}
                    href={`/admin/exam-infrastructure/classrooms/${classroom.classroomId}`}
                    className="min-w-0 rounded-lg border border-line bg-surface px-4 py-3 hover:border-line-strong hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <p className="truncate text-sm font-medium">{classroom.name}</p>
                    <p className="mt-1 truncate text-xs text-fg-subtle">{schoolNames.get(classroom.schoolId) || classroom.schoolId}</p>
                    <p className="mt-2 font-mono text-2xs text-fg-subtle">
                      {classroom.seatCount} 座 · layout r{classroom.layoutRevision}
                    </p>
                  </a>
                ))}
              </div>
            ) : (
              <EmptyState
                className="min-h-24 rounded-lg border border-dashed border-line"
                icon={<AlertTriangle />}
                title={classrooms.length ? '没有匹配的教室' : '还没有已导入教室'}
                action={error ? (
                  <Button variant="secondary" onClick={() => setRequested(false)}>
                    重试
                  </Button>
                ) : undefined}
              />
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ExamClassroomPage() {
  const bootstrap = useBootstrap();
  if (!bootstrap.user.canManageExamInfrastructure) return <ForbiddenPanel message="你没有管理考试基础设施的权限。" />;
  const data = asRecord(bootstrap.page.data, '教室终端页面');
  const classroomId = asString(data.classroomId, '教室终端页面');
  if (!classroomId) throw new Error('教室终端页面响应格式不正确');
  return <ExamClassroomWorkspace classroomId={classroomId} />;
}
