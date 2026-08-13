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
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  CloudOff,
  Crosshair,
  History,
  Keyboard,
  Link2,
  LocateFixed,
  MonitorCheck,
  MonitorCog,
  MonitorOff,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Unlink2,
  UserRoundCog,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { AdminPage } from '@/components/admin/admin-page';
import { ForbiddenPanel } from '@/components/admin/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';

type SeatStatus = 'conflict' | 'identity-change' | 'offline' | 'online' | 'unbound' | 'unknown';
type BindingStatus = 'active' | 'unbound';
type PairingEntryStatus = 'bound' | 'cancelled' | 'claimed' | 'open';
type PairingMode = 'bind' | 'replace';

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

interface ClassroomState {
  classroom: ClassroomView;
  bindings: SeatBinding[];
  pairingWindow: PairingWindow | null;
  references: SeatReference[];
  endpointPreflight: EndpointPreflight;
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
  run: () => Promise<void>;
}

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
  conflict: 'border-red-500/70 bg-red-500/12 text-red-800 dark:text-red-200',
  'identity-change': 'border-amber-500/70 bg-amber-500/15 text-amber-900 dark:text-amber-100',
  offline: 'border-slate-400/70 bg-slate-500/10 text-slate-700 dark:text-slate-200',
  online: 'border-emerald-500/70 bg-emerald-500/12 text-emerald-800 dark:text-emerald-100',
  unbound: 'border-dashed border-muted-foreground/45 bg-background/85 text-foreground',
  unknown: 'border-zinc-400/70 bg-zinc-500/10 text-zinc-700 dark:text-zinc-200',
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

function parseState(value: unknown): ClassroomState {
  const state = asRecord(value, '教室工作台');
  const preflight = asRecord(state.endpointPreflight, '终端状态');
  const preflightState = asString(preflight.state, '终端状态');
  if (!['available', 'not-required', 'unavailable'].includes(preflightState) || !Array.isArray(preflight.items)) {
    throw new Error('终端状态响应格式不正确');
  }
  if (!Array.isArray(state.bindings) || !Array.isArray(state.references)) throw new Error('教室工作台响应格式不正确');
  return {
    classroom: parseClassroom(state.classroom),
    bindings: state.bindings.map(parseBinding),
    pairingWindow: parsePairingWindow(state.pairingWindow),
    references: state.references.map(parseReference),
    endpointPreflight: {
      state: preflightState as EndpointPreflight['state'],
      items: preflight.items.map(parsePreflightItem),
    },
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
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
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
  const preflight = new Map(state.endpointPreflight.items.map((item) => [item.endpointId, item]));
  const window = activeWindow(state.pairingWindow, now);
  const entries = new Map(window?.entries.map((entry) => [entry.sourceSeatId, entry]) || []);
  return state.classroom.layout.seats.map((seat) => {
    const binding = bindings.get(seat.sourceSeatId) || null;
    const entry = entries.get(seat.sourceSeatId) || null;
    const activeBinding = binding?.status === 'active' && binding.endpointId ? binding : null;
    const endpoint = activeBinding?.endpointId || null;
    const item = endpoint ? preflight.get(endpoint) || null : null;
    const references = endpoint ? state.references.filter((reference) => reference.endpointId === endpoint) : [];
    const modeConflict = Boolean(
      entry &&
      ((entry.mode === 'bind' && activeBinding) ||
        (entry.mode === 'replace' && !activeBinding) ||
        (entry.status === 'claimed' && !entry.claimedEndpointId)),
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
    return { seat, binding, entry, preflight: item, references, status };
  });
}

function seatAccessibleName(view: SeatView): string {
  const facts = [view.seat.label || view.seat.sourceSeatId, STATUS_LABELS[view.status]];
  if (view.binding?.endpointId) facts.push(compactEndpoint(view.binding.endpointId));
  if (view.references.length) facts.push(`被 ${view.references.length} 个活动引用`);
  return facts.join('，');
}

function StatusIcon({ status }: { status: SeatStatus }) {
  if (status === 'online') return <MonitorCheck className="size-3.5" aria-hidden="true" />;
  if (status === 'offline') return <MonitorOff className="size-3.5" aria-hidden="true" />;
  if (status === 'identity-change') return <UserRoundCog className="size-3.5" aria-hidden="true" />;
  if (status === 'conflict') return <ShieldAlert className="size-3.5" aria-hidden="true" />;
  if (status === 'unknown') return <CloudOff className="size-3.5" aria-hidden="true" />;
  return <Crosshair className="size-3.5" aria-hidden="true" />;
}

function Notice({ error, message }: { error?: string | null; message?: string | null }) {
  if (!error && !message) return null;
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={cn(
        'rounded-xl border px-4 py-3 text-sm',
        error
          ? 'border-destructive/35 bg-destructive/5 text-destructive'
          : 'border-emerald-500/30 bg-emerald-500/8 text-emerald-800 dark:text-emerald-200',
      )}
    >
      {error || message}
    </div>
  );
}

function ConfirmActionDialog({ plan, busy, error, close }: { plan: ConfirmPlan | null; busy: boolean; error: string | null; close: () => void }) {
  return (
    <Dialog open={Boolean(plan)} onOpenChange={(open) => !open && !busy && close()}>
      {plan ? (
        <DialogContent className="w-[min(560px,calc(100vw-1.5rem))]" onClose={busy ? undefined : close}>
          <DialogHeader>
            <DialogTitle>{plan.title}</DialogTitle>
            <p className="mt-1 pr-8 text-sm leading-6 text-muted-foreground">{plan.description}</p>
          </DialogHeader>
          <DialogBody className="space-y-3 px-6 py-5">
            <Notice error={error} />
            {plan.facts.map((fact) => (
              <div key={fact.label} className="grid gap-1 rounded-lg border bg-muted/20 px-3 py-2 sm:grid-cols-[9rem_1fr]">
                <span className="text-xs font-medium text-muted-foreground">{fact.label}</span>
                <span className="break-words text-sm">{fact.value}</span>
              </div>
            ))}
          </DialogBody>
          <div className="flex justify-end gap-2 border-t px-6 py-4">
            <Button type="button" variant="outline" disabled={busy} autoFocus onClick={close}>
              取消
            </Button>
            <Button type="button" variant={plan.destructive ? 'destructive' : 'default'} disabled={busy} onClick={() => void plan.run()}>
              {busy ? <CircleDashed className="size-4 animate-spin" aria-hidden="true" /> : null}
              {plan.confirmLabel}
            </Button>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
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
  recentSeatId,
  zoom,
  onSelect,
}: {
  layout: ClassroomLayout;
  views: SeatView[];
  selectedSeatId: string | null;
  recentSeatId: string | null;
  zoom: number;
  onSelect: (sourceSeatId: string) => void;
}) {
  const geometry = useMemo(() => buildGeometry(layout), [layout]);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const seatRefs = useRef(new Map<string, HTMLButtonElement>());
  const drag = useRef<{ pointerId: number; scrollLeft: number; scrollTop: number; x: number; y: number } | null>(null);

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
    drag.current = {
      pointerId: event.pointerId,
      scrollLeft: event.currentTarget.scrollLeft,
      scrollTop: event.currentTarget.scrollTop,
      x: event.clientX,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.currentTarget.scrollLeft = active.scrollLeft - (event.clientX - active.x);
    event.currentTarget.scrollTop = active.scrollTop - (event.clientY - active.y);
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  if (!layout.seats.length) {
    return (
      <div className="flex min-h-[26rem] flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/15 px-6 text-center">
        <Crosshair className="size-8 text-muted-foreground" aria-hidden="true" />
        <h2 className="mt-4 font-semibold">这个教室没有实体座位</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">当前 canonical 布局为空。P2.3 不提供布局编辑或按名称猜测座位。</p>
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      role="group"
      aria-label="教室实体座位布局，可用方向键移动焦点"
      className="relative min-h-[30rem] max-h-[66dvh] cursor-grab overflow-auto rounded-2xl border bg-slate-50/70 shadow-inner active:cursor-grabbing [overscroll-behavior:contain] dark:bg-slate-950/45"
      onPointerDown={beginPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      <div
        className="relative origin-top-left text-foreground"
        style={{
          width: geometry.width * zoom,
          height: geometry.height * zoom,
          backgroundImage: 'radial-gradient(circle, rgb(100 116 139 / 0.2) 1px, transparent 1px)',
          backgroundSize: `${18 * zoom}px ${18 * zoom}px`,
        }}
      >
        {layout.decorations.map((decoration) => {
          const item = geometry.item(decoration);
          return (
            <div
              key={decoration.sourceItemId}
              aria-hidden="true"
              className="pointer-events-none absolute flex items-center justify-center overflow-hidden rounded-lg border border-slate-400/30 bg-slate-300/20 px-2 text-[0.65rem] font-medium uppercase tracking-[0.16em] text-slate-500 dark:bg-slate-700/20 dark:text-slate-400"
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
        {views.map((view, index) => {
          const item = geometry.item(view.seat);
          const selected = selectedSeatId === view.seat.sourceSeatId;
          const recentlyResponded = recentSeatId === view.seat.sourceSeatId;
          return (
            <button
              key={view.seat.sourceSeatId}
              ref={(node) => {
                if (node) seatRefs.current.set(view.seat.sourceSeatId, node);
                else seatRefs.current.delete(view.seat.sourceSeatId);
              }}
              type="button"
              data-seat-id={view.seat.sourceSeatId}
              aria-label={seatAccessibleName(view)}
              aria-pressed={selected}
              tabIndex={selected || (!selectedSeatId && index === 0) ? 0 : -1}
              className={cn(
                'group absolute flex min-h-10 min-w-12 flex-col items-start justify-between overflow-hidden rounded-xl border-2 px-2 py-1.5 text-left shadow-sm transition-[border-color,box-shadow,transform] hover:z-20 hover:-translate-y-0.5 hover:shadow-md focus-visible:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                STATUS_STYLES[view.status],
                selected && 'z-20 ring-2 ring-primary ring-offset-2',
                recentlyResponded && 'z-20 shadow-[0_0_0_5px_rgb(14_165_233/0.22)]',
              )}
              style={{
                left: item.left * zoom,
                top: item.top * zoom,
                width: Math.max(48, item.width * zoom),
                height: Math.max(40, item.height * zoom),
                transform: `rotate(${view.seat.rotation}deg)`,
              }}
              onClick={() => onSelect(view.seat.sourceSeatId)}
              onKeyDown={(event) => handleSeatKey(event, view)}
            >
              <span className="flex w-full items-center justify-between gap-1 text-[0.65rem] font-semibold leading-none">
                <span className="truncate">{view.seat.label || view.seat.sourceSeatId}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {view.references.length ? <Link2 className="size-3" aria-hidden="true" /> : null}
                  <StatusIcon status={view.status} />
                </span>
              </span>
              <span className="mt-1 max-w-full truncate font-mono text-[0.58rem] leading-none opacity-75">
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
          className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.68rem] font-medium', STATUS_STYLES[status])}
        >
          <StatusIcon status={status} />
          {STATUS_LABELS[status]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.68rem] font-medium text-muted-foreground">
        <Link2 className="size-3" aria-hidden="true" />
        活动引用
      </span>
    </div>
  );
}

function PairingCode({ code, hint }: { code: string | null; hint: string }) {
  const displayCode = code ? `${code.slice(0, 4)}-${code.slice(4)}` : null;
  return (
    <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/8 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-cyan-900 dark:text-cyan-100">当前一次性配对码</span>
        <Badge variant="outline">尾号 {hint}</Badge>
      </div>
      {displayCode ? (
        <p className="mt-2 select-all break-all font-mono text-lg font-semibold tracking-[0.09em] text-cyan-950 dark:text-cyan-50">{displayCode}</p>
      ) : (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">页面刷新后不会恢复明文码；请关闭当前窗口并重新生成。</p>
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
      <Card className="border-dashed">
        <CardContent className="flex min-h-52 flex-col items-center justify-center text-center">
          <LocateFixed className="size-7 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">选择一个实体座位</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">可点击布局，或从搜索框后用方向键遍历。</p>
        </CardContent>
      </Card>
    );
  }
  const activeBinding = view.binding?.status === 'active' && view.binding.endpointId ? view.binding : null;
  const claimedReplacement = view.entry?.mode === 'replace' && view.entry.status === 'claimed';
  const openEntry = view.entry && (view.entry.status === 'open' || view.entry.status === 'claimed') ? view.entry : null;
  const canOpen = !window;
  return (
    <Card className="overflow-hidden border-slate-300/70 dark:border-slate-700">
      <CardHeader className="border-b bg-slate-950 text-slate-50">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.65rem] font-medium uppercase tracking-[0.2em] text-slate-400">Physical seat</p>
            <CardTitle className="mt-1 break-words text-lg text-white">{view.seat.label || view.seat.sourceSeatId}</CardTitle>
            <p className="mt-1 break-all font-mono text-[0.68rem] text-slate-400">{view.seat.sourceSeatId}</p>
          </div>
          <Badge className="shrink-0" variant={view.status === 'conflict' ? 'destructive' : 'secondary'}>
            {STATUS_LABELS[view.status]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-muted/35 px-3 py-2">
            <p className="text-muted-foreground">绑定版本</p>
            <p className="mt-1 font-mono font-medium">{view.binding?.revision || 0}</p>
          </div>
          <div className="rounded-lg bg-muted/35 px-3 py-2">
            <p className="text-muted-foreground">布局状态</p>
            <p className="mt-1 font-medium">{view.seat.status}</p>
          </div>
        </div>
        {activeBinding ? (
          <div className="space-y-2 rounded-xl border px-3 py-3">
            <p className="text-xs font-medium text-muted-foreground">当前 Endpoint</p>
            <p className="break-all font-mono text-xs">{activeBinding.endpointId}</p>
            <div className="flex flex-wrap gap-2 text-[0.68rem] text-muted-foreground">
              <span>Service {view.preflight?.serviceVersion || '未知'}</span>
              <span>协议 {view.preflight?.protocolVersion ?? '未知'}</span>
              <span>凭据 {view.preflight?.credentialStatus || '未知'}</span>
            </div>
          </div>
        ) : null}
        {openEntry ? <PairingCode code={code} hint={openEntry.codeHint} /> : null}
        {claimedReplacement ? (
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/8 px-3 py-3 text-xs leading-5">
            <p className="font-medium text-amber-900 dark:text-amber-100">新终端已完成身份认领，等待教师确认</p>
            <p className="mt-1 break-all font-mono text-amber-800 dark:text-amber-200">{view.entry?.claimedEndpointId}</p>
          </div>
        ) : null}
        {view.references.length ? (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <Link2 className="size-3.5" aria-hidden="true" />
              活动引用
            </p>
            {view.references.map((reference) => (
              <a
                key={`${reference.kind}:${reference.eventId}:${reference.targetRevision}`}
                href={`/admin/exam-infrastructure/events/${reference.eventId}`}
                className="block rounded-lg border px-3 py-2 text-xs hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="font-medium">{reference.eventTitle}</span>
                <span className="ml-2 text-muted-foreground">
                  {reference.eventState === 'active' ? '进行中' : '未来'} · 目标 r{reference.targetRevision}
                </span>
              </a>
            ))}
          </div>
        ) : null}
        <div className="grid gap-2">
          {!activeBinding && canOpen ? (
            <Button disabled={busy} onClick={onOpenSingle}>
              <Crosshair className="size-4" aria-hidden="true" />
              为此座位生成配对码
            </Button>
          ) : null}
          {activeBinding && !openEntry && canOpen ? (
            <Button disabled={busy} variant="outline" onClick={onOpenReplacement}>
              <UserRoundCog className="size-4" aria-hidden="true" />
              开始换机识别
            </Button>
          ) : null}
          {claimedReplacement ? (
            <>
              <Button disabled={busy} onClick={onConfirmReplacement}>
                <CheckCircle2 className="size-4" aria-hidden="true" />
                确认换机
              </Button>
              <Button disabled={busy} variant="outline" onClick={onCancelPairing}>
                <X className="size-4" aria-hidden="true" />
                取消本次认领
              </Button>
            </>
          ) : null}
          {activeBinding && !claimedReplacement ? (
            <Button disabled={busy} variant="destructive" onClick={onUnbind}>
              <Unlink2 className="size-4" aria-hidden="true" />
              解除长期绑定
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <History className="size-4" aria-hidden="true" />
          最近操作
        </CardTitle>
      </CardHeader>
      <CardContent>
        {operations.length ? (
          <ol className="space-y-3">
            {operations.map((operation) => (
              <li key={operation.key} className="border-l-2 border-muted pl-3 text-xs leading-5">
                <p className="font-medium">
                  {operation.label} · {operation.seat}
                </p>
                <p className="truncate font-mono text-[0.65rem] text-muted-foreground">{compactEndpoint(operation.endpoint)}</p>
                <p className="text-[0.65rem] text-muted-foreground">
                  {formatDate(operation.at)} · UID {operation.actorUid}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs leading-5 text-muted-foreground">还没有绑定、换机或解绑记录。</p>
        )}
      </CardContent>
    </Card>
  );
}

function ExamClassroomWorkspace({ classroomId }: { classroomId: string }) {
  const [state, setState] = useState<ClassroomState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
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

  useEffect(() => {
    if (!state?.classroom.layout.seats.length) return;
    const valid = state.classroom.layout.seats.some((seat) => seat.sourceSeatId === selectedSeatId);
    if (!valid) setSelectedSeatId(state.classroom.layout.seats[0].sourceSeatId);
  }, [selectedSeatId, setSelectedSeatId, state]);

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
      <AdminPage bypassPrivGate hideSidebar title="教室终端工作台">
        <div className="flex min-h-72 items-center justify-center">
          <CircleDashed className="size-7 animate-spin text-muted-foreground" aria-label="正在加载" />
        </div>
      </AdminPage>
    );
  }

  if (!state) {
    return (
      <AdminPage bypassPrivGate hideSidebar title="教室终端工作台">
        <Notice error={error || '教室终端状态不可用'} />
        <Button className="mt-4" variant="outline" onClick={() => void load()}>
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
      contentClassName="max-w-none"
      title={
        <div>
          <a
            href="/admin/exam-infrastructure"
            className="mb-2 inline-flex items-center gap-1 text-sm font-normal text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            返回考试基础设施
          </a>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{state.classroom.name}</h1>
            <Badge variant="outline">布局 r{state.classroom.layoutRevision}</Badge>
            <Badge variant="secondary">{state.classroom.layout.seats.length} 座</Badge>
          </div>
        </div>
      }
      description="按导入坐标呈现实体座位；这里不修改 sourceSeatId、label 或几何，所有绑定写入继续使用 P2.2 CAS。"
      actions={
        <>
          {undoView ? (
            <Button variant="outline" disabled={busy} onClick={() => void requestUnbind(undoView, true)}>
              <RotateCcw className="size-4" aria-hidden="true" />
              撤销刚完成的绑定
            </Button>
          ) : null}
          <Button variant="outline" disabled={busy} onClick={() => void load()}>
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} aria-hidden="true" />
            刷新状态
          </Button>
        </>
      }
    >
      <Notice error={error} message={message} />
      {state.endpointPreflight.state === 'unavailable' ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-500/8 px-4 py-3 text-sm text-amber-900 dark:text-amber-100"
        >
          <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Vigil 当前不可用；长期绑定仍来自 OJ canonical，但在线/离线状态显示为“未知”，不会伪装成离线。
        </div>
      ) : null}

      <section className="rounded-2xl border bg-slate-950 px-4 py-3 text-slate-100 shadow-sm" aria-label="教室终端摘要">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs">
            <span className="text-emerald-300">ONLINE {summary.online}</span>
            <span className="text-slate-300">OFFLINE {summary.offline}</span>
            <span className="text-cyan-300">UNBOUND {summary.unbound}</span>
            <span className="text-amber-300">IDENTITY {summary['identity-change']}</span>
            <span className="text-red-300">CONFLICT {summary.conflict}</span>
          </div>
          <span className="font-mono text-[0.65rem] text-slate-400">LAYOUT {state.classroom.layout.fingerprint.slice(0, 12)}</span>
        </div>
      </section>

      {currentWindow ? (
        <section
          className="flex flex-col gap-3 rounded-2xl border border-cyan-500/30 bg-cyan-500/7 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          aria-label="当前配对窗口"
        >
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-cyan-950 dark:text-cyan-50">
              <Activity className="size-4" aria-hidden="true" />
              配对窗口进行中 · r{currentWindow.revision}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {currentWindow.entries.length} 个座位 · {formatDate(currentWindow.expiresAt)} 到期 · 页面仅在窗口期间轮询响应
            </p>
          </div>
          <Button variant="outline" disabled={busy} onClick={closeWindow}>
            关闭窗口
          </Button>
          {recentSeatId ? (
            <Button
              variant="outline"
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

      <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-col gap-3 rounded-2xl border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block min-w-0 flex-1 sm:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">搜索座位、sourceSeatId 或 Endpoint</span>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9"
                placeholder="搜索座位、sourceSeatId 或 Endpoint"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label="缩小布局"
                disabled={zoom <= 0.75}
                onClick={() => setZoom((value) => Math.max(0.75, Number((value - 0.25).toFixed(2))))}
              >
                <ZoomOut className="size-4" />
              </Button>
              <span className="w-12 text-center font-mono text-xs" aria-live="polite">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                variant="outline"
                size="icon"
                aria-label="放大布局"
                disabled={zoom >= 2}
                onClick={() => setZoom((value) => Math.min(2, Number((value + 0.25).toFixed(2))))}
              >
                <ZoomIn className="size-4" />
              </Button>
              <Button variant="outline" size="icon" aria-label="恢复默认缩放" onClick={() => setZoom(1)}>
                <LocateFixed className="size-4" />
              </Button>
              <Button
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
          <StatusLegend />
          {visibleViews.length || !state.classroom.layout.seats.length ? (
            <SeatCanvas
              layout={state.classroom.layout}
              views={visibleViews}
              selectedSeatId={canvasSelectedSeatId}
              recentSeatId={recentSeatId}
              zoom={zoom}
              onSelect={setSelectedSeatId}
            />
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed text-center">
              <Search className="size-7 text-muted-foreground" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium">没有匹配的实体座位</p>
              <Button className="mt-3" variant="outline" onClick={() => setQuery('')}>
                清除搜索
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Keyboard className="size-4" aria-hidden="true" />
            Tab 进入布局，方向键按坐标移动，Home/End 跳至首尾；拖动空白区域或滚动可平移。
          </div>
        </div>
        <aside className="space-y-4 xl:sticky xl:top-0 xl:self-start">
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

  useEffect(() => {
    if (!open || requested) return;
    setRequested(true);
    setLoading(true);
    void apiObject('/api/admin/exam-infrastructure/classrooms', undefined, '加载教室列表失败')
      .then((payload) => {
        if (!Array.isArray(payload.classrooms)) throw new Error('教室列表响应格式不正确');
        setClassrooms(payload.classrooms.map(parseClassroomSummary));
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
      <Button variant="outline" onClick={() => setOpen(true)}>
        <MonitorCog className="size-4" aria-hidden="true" />
        教室终端
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(720px,calc(100vw-1.5rem))]" onClose={() => setOpen(false)}>
          <DialogHeader>
            <DialogTitle>打开教室终端工作台</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">选择已导入并确认的 canonical 教室；这里不会重新导入或编辑布局。</p>
          </DialogHeader>
          <DialogBody className="space-y-4 px-6 py-5">
            <Notice error={error} />
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">搜索教室</span>
              <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="搜索教室或学校" autoFocus />
            </label>
            {loading ? (
              <div className="flex min-h-40 items-center justify-center">
                <CircleDashed className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : visible.length ? (
              <div className="grid max-h-[55dvh] gap-2 overflow-y-auto [overscroll-behavior:contain] sm:grid-cols-2">
                {visible.map((classroom) => (
                  <a
                    key={classroom.classroomId}
                    href={`/admin/exam-infrastructure/classrooms/${classroom.classroomId}`}
                    className="rounded-xl border bg-card px-4 py-3 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <p className="truncate text-sm font-medium">{classroom.name}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{schoolNames.get(classroom.schoolId) || classroom.schoolId}</p>
                    <p className="mt-2 font-mono text-[0.65rem] text-muted-foreground">
                      {classroom.seatCount} 座 · layout r{classroom.layoutRevision}
                    </p>
                  </a>
                ))}
              </div>
            ) : (
              <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed text-center">
                <AlertTriangle className="size-6 text-muted-foreground" aria-hidden="true" />
                <p className="mt-2 text-sm font-medium">{classrooms.length ? '没有匹配的教室' : '还没有已导入教室'}</p>
                {error ? (
                  <Button className="mt-3" variant="outline" onClick={() => setRequested(false)}>
                    重试
                  </Button>
                ) : null}
              </div>
            )}
          </DialogBody>
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
