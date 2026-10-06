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
  AlertTriangle,
  ArrowLeft,
  Crosshair,
  Keyboard,
  Link2,
  LocateFixed,
  MonitorCog,
  RefreshCw,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { AdminPage } from '@/components/admin/admin-page';
import { TechDetails, type FactItem } from '@/components/admin/fact-grid';
import { ForbiddenPanel } from '@/components/admin/forbidden';
import { RevisionHistory } from '@/components/admin/revision-history';
import { useUserNames, userDisplayName } from '@/components/admin/user-label';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner, StatusDot } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { toast } from '@/components/ui/toast';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { isSystemAdmin } from '@/lib/perms';
import { OperationalPanel } from './exam-classroom/operational-panel';
import { PairingCard, RecentActionNotice } from './exam-classroom/pairing-card';
import { SeatDetail } from './exam-classroom/seat-detail';
import { SeatStatusFilter } from './exam-classroom/seat-status-filter';
import {
  DEFAULT_REPLACEMENT_REVOKE_REASON,
  FACING_LABELS,
  FACING_MARKS,
  STATUS_DOT,
  STATUS_STYLES,
  activeWindow,
  apiObject,
  asInteger,
  asRecord,
  asString,
  buildGeometry,
  compactEndpoint,
  deriveSeatViews,
  directionalSeat,
  formatDate,
  parseClassroomSummary,
  parsePairingWindow,
  parseReference,
  parseState,
  postJson,
  readClassroomMode,
  recentOperations,
  requestId,
  seatAccessibleName,
  seatFilterCounts,
  seatHistory,
  seatMatchesFilter,
  writeClassroomMode,
  type ClassroomLayout,
  type ClassroomState,
  type ClassroomSummary,
  type CodeState,
  type ConfirmPlan,
  type SeatDisabledReason,
  type SeatFilter,
  type SeatOperationalEntry,
  type SeatStatus,
  type SeatView,
} from './exam-classroom/model';

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

function ExamClassroomWorkspace({ classroomId }: { classroomId: string }) {
  const bootstrap = useBootstrap();
  const canRevokeEndpoint = isSystemAdmin(bootstrap.user.priv);
  const [state, setState] = useState<ClassroomState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const [mode, setMode] = useState<'bind' | 'config'>(() => readClassroomMode());
  const [filter, setFilter] = useState<SeatFilter>('all');
  const [operationalSelection, setOperationalSelection] = useState<Set<string> | null>(() => {
    if (readClassroomMode() !== 'config') return null;
    const seat = new URLSearchParams(window.location.search).get('seat');
    return new Set(seat ? [seat] : []);
  });
  const [disabledReason, setDisabledReason] = useState<SeatDisabledReason>('computer_failure');
  const [disabledNote, setDisabledNote] = useState('');
  const loadSequence = useRef(0);
  const previousBindings = useRef<Map<string, number> | null>(null);
  const configSelectionInitialized = useRef(readClassroomMode() !== 'config');
  const nameUids = useMemo(() => {
    if (!state) return [];
    const uids: Array<number | null | undefined> = [];
    for (const item of state.bindings) {
      uids.push(item.createdBy, item.updatedBy);
      for (const history of item.history) uids.push(history.actorUid);
    }
    uids.push(state.pairingWindow?.createdBy, state.seatOperationalProfile.createdBy);
    return uids;
  }, [state]);
  const names = useUserNames(bootstrap.domain.id, nameUids);
  const displayName = (uid: number | null | undefined) => userDisplayName(uid, names);

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
    if (configSelectionInitialized.current || !state) return;
    const seats = state.classroom.layout.seats;
    const seatIsValid = selectedSeatId !== null && seats.some((seat) => seat.sourceSeatId === selectedSeatId);
    if (seats.length > 0 && !seatIsValid) return;
    configSelectionInitialized.current = true;
    setOperationalSelection(new Set(selectedSeatId ? [selectedSeatId] : []));
  }, [selectedSeatId, state]);

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
    toast.success(`${seat?.label || sourceSeatId} 已绑定${next ? `，已选中下一个未绑定座位 ${next.label || next.sourceSeatId}` : ''}。`);
    if (selectedSeatId === sourceSeatId && next) setSelectedSeatId(next.sourceSeatId);
  }, [codes, selectedSeatId, setSelectedSeatId, state]);

  useEffect(() => {
    if (!lastUndoable || !state) return;
    const binding = state.bindings.find((candidate) => candidate.sourceSeatId === lastUndoable.sourceSeatId);
    if (!binding || binding.status !== 'active' || binding.revision !== lastUndoable.revision) setLastUndoable(null);
  }, [lastUndoable, state]);

  const visibleViews = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const searched = needle
      ? views.filter((view) =>
          [view.seat.label, view.seat.sourceSeatId, view.binding?.endpointId || '', view.entry?.claimedEndpointId || ''].some((value) =>
            value.toLocaleLowerCase().includes(needle),
          ),
        )
      : views;
    return searched.filter((view) => seatMatchesFilter(view, filter));
  }, [filter, query, views]);
  const canvasSelectedSeatId = visibleViews.some((view) => view.seat.sourceSeatId === selectedSeatId) ? selectedSeatId : null;

  const mutate = async (work: () => Promise<void>, success: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      toast.success(success);
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
      toast.info('所选座位已经是该运行配置，无需新增 revision。');
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
          toast.success('配对窗口已关闭。');
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
            toast.success(`${view.seat.label || view.seat.sourceSeatId} 已解除绑定。`);
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
            toast.success(`${view.seat.label || view.seat.sourceSeatId} 已完成换机。`);
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
          toast.success(`已吊销旧终端 ${target.endpointId}。`);
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

  const changeMode = (next: 'bind' | 'config') => {
    setMode(next);
    writeClassroomMode(next);
    if (next === 'config') setOperationalSelection(new Set(selectedSeatId ? [selectedSeatId] : []));
    else setOperationalSelection(null);
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
  const unbound = views.filter((view) => view.status === 'unbound');
  const undoView = lastUndoable ? views.find((view) => view.seat.sourceSeatId === lastUndoable.sourceSeatId) || null : null;
  const profile = state.seatOperationalProfile;
  const techItems: FactItem[] = [
    { label: '布局指纹', value: state.classroom.layout.fingerprint },
    { label: '运行配置指纹', value: profile.fingerprint },
    { label: '坐标系', value: state.classroom.layout.coordinateSystem },
    { label: '来源格式', value: state.classroom.layout.sourceFormat },
  ];
  if (profile.createdBy !== null) techItems.push({ label: '运行配置保存人', value: displayName(profile.createdBy) });
  const operationRows = recentOperations(state, 8).map((operation) => ({
    key: operation.key,
    title: `${operation.label} · ${operation.seatLabel}`,
    meta: `${formatDate(operation.at)} · ${displayName(operation.actorUid)} · ${compactEndpoint(operation.endpointId ?? operation.previousEndpointId)}`,
  }));

  return (
    <AdminPage
      bypassPrivGate
      hideSidebar
      contentClassName="min-w-0 overflow-x-clip"
      title={state.classroom.name}
      description={`${state.classroom.layout.seats.length} 座 · 布局 r${state.classroom.layoutRevision} · 运行配置 r${profile.revision}${profile.persisted ? '' : ' · 默认'}`}
      actions={
        <Button variant="secondary" disabled={busy} onClick={() => void load()}>
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} aria-hidden="true" />
          刷新状态
        </Button>
      }
    >
      <a
        href="/admin/exam-infrastructure"
        className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
        返回考试基础设施
      </a>
      <Notice error={error} />
      <div className="grid min-h-0 min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-2">
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
            <MiniTabs<'bind' | 'config'>
              aria-label="工作模式"
              size="sm"
              value={mode}
              onValueChange={changeMode}
              items={[
                { value: 'bind', label: '终端绑定' },
                { value: 'config', label: '运行配置' },
              ]}
            />
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
            </div>
            {mode === 'bind' ? (
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
                        toast.success(`${unbound.length} 个座位的配对窗口已开启，明文码只保留在当前页面。`);
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
                批量识别未绑定（{unbound.length}）
              </Button>
            ) : null}
          </div>
          <SeatStatusFilter
            counts={seatFilterCounts(views)}
            value={filter}
            preflightState={state.endpointPreflight.state}
            onValueChange={setFilter}
          />
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
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                  }}
                >
                  清除搜索
                </Button>
              }
            />
          )}
          <div className="flex items-center gap-2 text-xs text-fg-subtle">
            <Keyboard className="size-4 shrink-0" aria-hidden="true" />
            Tab 进入布局，方向键按坐标移动，Home/End 跳至首尾；拖动空白区域或滚动可平移。
          </div>
          <TechDetails items={techItems} />
        </div>
        <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-0 xl:self-start">
          {mode === 'bind' ? (
            <>
              <RecentActionNotice
                undoSeatLabel={undoView ? undoView.seat.label || undoView.seat.sourceSeatId : null}
                revoke={canRevokeEndpoint ? pendingRevoke : null}
                busy={busy}
                onUndo={() => {
                  if (undoView) void requestUnbind(undoView, true);
                }}
                onRevoke={() => {
                  if (pendingRevoke) requestOldEndpointRevoke(pendingRevoke);
                }}
              />
              {currentWindow ? (
                <PairingCard
                  window={currentWindow}
                  completed={currentWindowCompleted}
                  now={clock}
                  busy={busy}
                  recentSeatId={recentSeatId}
                  displayName={displayName}
                  onClose={closeWindow}
                  onLocateRecent={() => {
                    if (!recentSeatId) return;
                    setQuery('');
                    setSelectedSeatId(recentSeatId);
                  }}
                />
              ) : null}
              <SeatDetail
                view={selected}
                code={selectedCode}
                window={currentWindow}
                busy={busy}
                history={selectedSeatId ? seatHistory(state, selectedSeatId) : []}
                displayName={displayName}
                preflightState={state.endpointPreflight.state}
                onOpenSingle={() => selected && void openWindow([selected.seat.sourceSeatId], [])}
                onOpenReplacement={() => selected && void openWindow([selected.seat.sourceSeatId], [selected.seat.sourceSeatId])}
                onConfirmReplacement={() => selected && void requestReplacementConfirmation(selected)}
                onCancelPairing={() => selected && void cancelPairing(selected)}
                onUnbind={() => selected && void requestUnbind(selected)}
              />
              <RevisionHistory title="最近操作" summary="全教室最近 8 条" rows={operationRows} />
            </>
          ) : (
            <OperationalPanel
              profile={profile}
              selectedSeatIds={operationalSelection ?? new Set()}
              visibleSeatIds={visibleViews.map((view) => view.seat.sourceSeatId)}
              busy={busy}
              disabledReason={disabledReason}
              note={disabledNote}
              displayName={displayName}
              onDisabledReasonChange={setDisabledReason}
              onNoteChange={setDisabledNote}
              onSelectVisible={() => setOperationalSelection(new Set(visibleViews.map((view) => view.seat.sourceSeatId)))}
              onClear={() => setOperationalSelection(new Set())}
              onFacing={(facing) => {
                if (operationalSelection === null) return;
                void saveOperationalEntries(
                  operationalSelection,
                  (entry) => ({ ...entry, facing }),
                  `${operationalSelection.size} 个座位的朝向已保存。`,
                );
              }}
              onDisable={() => {
                if (operationalSelection === null) return;
                void saveOperationalEntries(
                  operationalSelection,
                  (entry) => ({
                    ...entry,
                    enabled: false,
                    disabledReason,
                    note: disabledNote.trim() || null,
                  }),
                  `${operationalSelection.size} 个座位已标记为不可用于考试。`,
                );
              }}
              onRestore={() => {
                if (operationalSelection === null) return;
                void saveOperationalEntries(
                  operationalSelection,
                  (entry) => ({ ...entry, enabled: true, disabledReason: null, note: null }),
                  `${operationalSelection.size} 个座位已恢复可用。`,
                );
              }}
            />
          )}
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
