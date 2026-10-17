/**
 * Compose workspace: toolbar, lock, two panes, and drag between them.
 * The bank and paper panes register with this page's DndContext.
 */
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { isTeachGroupedByKind, parseProblemKind, teachPath } from '@hydrooj/common';
import type { BasicObjectiveKind, ProblemKind, TeachStatus, TeachType } from '@hydrooj/common';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { useUnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { confirmDialog } from '@/components/ui/dialog';
import { StatusDot } from '@/components/ui/display';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Toolbar, Workspace } from '@/components/ui/page';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import {
  TEACH_KIND_LABEL,
  TEACH_TYPE_LABEL,
  TEACH_TYPE_NOUN,
  parseTeachComposePayload,
} from '@/pages/teach/model';
import type { TeachBankItem } from '@/pages/teach/model';
import {
  defaultScoreFor,
  paperChangeCount,
  paperFromPayload,
  paperIssues,
  paperSummary,
} from '@/pages/teach/paper';
import type { PaperItem, PaperState, PaperTarget } from '@/pages/teach/paper';
import { BankPane } from './bank-pane';
import { composeReducer, initialComposeState, landedKindsOutsideActive } from './draft';
import type { ComposeAction, ComposeState } from './draft';
import { ObjectiveSheet } from './objective-sheet';
import { PaperPane } from './paper-pane';
import { saveComposition } from './save';

const EMPTY_TARGET: PaperTarget = { beforeDocId: null, stageId: null };
const SAVE_FAILED = '保存失败';
const UNLOCK_TITLE = '确定要修改已开始的题目集？';
const LEAVE_TITLE = '放弃未保存的修改？';

type Pane = 'bank' | 'paper';
type LeavePhase = 'idle' | 'confirming' | 'armed' | 'saving';

interface ObjectiveRequest {
  kind: BasicObjectiveKind;
  nodeId: string | null;
}

interface DragCard {
  pid: string;
  title: string;
}

interface BankRef {
  docId: number;
  pid: string;
  title: string;
  kind: ProblemKind;
  hidden: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
  return value;
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof TypeError) return fallback;
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}

function kindName(kind: ProblemKind): string {
  if (!Object.hasOwn(TEACH_KIND_LABEL, kind)) throw new TypeError(`paper_kind_invalid:${kind}`);
  return TEACH_KIND_LABEL[kind];
}

function lockBanner(status: TeachStatus, type: TeachType, noun: string, started: number): string {
  const base = status === 'running'
    ? `这个${noun}正在进行，改题会影响正在作答的学生。现在是只读。`
    : status === 'ended'
      ? `这个${noun}已经结束，改题会改变已经出来的成绩。现在是只读。`
      : null;
  if (base === null) throw new TypeError(`teach_compose_lock_status:${status}`);
  if (type === 'exam' && started > 0) return `${base}已有 ${started} 人开考，题库和抽题数改不了。`;
  return base;
}

function unlockMessage(status: TeachStatus): string {
  if (status === 'running') return '正在作答的学生会立刻看到变化；已经抽好的试卷不会重抽。';
  if (status === 'ended') return '已结束的成绩会按新的题目和分值重新计算。';
  throw new TypeError(`teach_compose_lock_status:${status}`);
}

function bankToPaper(item: BankRef): PaperItem {
  return {
    docId: item.docId,
    pid: item.pid,
    title: item.title,
    kind: item.kind,
    score: null,
    hidden: item.hidden,
    stageId: null,
  };
}

function readBankRef(value: unknown): BankRef | null {
  if (!isRecord(value)) return null;
  const docId = readInteger(value.docId);
  if (docId === null || docId <= 0) return null;
  if (typeof value.pid !== 'string' || value.pid.trim() === '') return null;
  if (typeof value.title !== 'string') return null;
  if (typeof value.hidden !== 'boolean') return null;
  let kind: ProblemKind;
  try {
    kind = parseProblemKind(value.kind);
  } catch (error: unknown) {
    console.error('teach compose bank item kind is invalid', { docId, error });
    return null;
  }
  return {
    docId,
    pid: value.pid,
    title: value.title,
    kind,
    hidden: value.hidden,
  };
}

function bankDragDocId(data: unknown): number | null {
  if (!isRecord(data) || data.from !== 'bank' || !isRecord(data.item)) return null;
  return readInteger(data.item.docId);
}

function bankDragRef(data: unknown): BankRef | null {
  if (!isRecord(data) || data.from !== 'bank') return null;
  return readBankRef(data.item);
}

function paperDragDocId(data: unknown): number | null {
  if (!isRecord(data) || data.from !== 'paper') return null;
  return readInteger(data.docId);
}

function stageFromGroup(overId: string, data: unknown): number | null {
  if (isRecord(data) && data.to === 'paper') {
    if (data.stageId === null) return null;
    const stageId = readInteger(data.stageId);
    if (stageId !== null) return stageId;
  }
  const prefix = 'group:stage-';
  if (!overId.startsWith(prefix)) return null;
  const stageId = readInteger(Number(overId.slice(prefix.length)));
  if (stageId === null) throw new TypeError(`teach_compose_drop_stage:${overId}`);
  return stageId;
}

function stageIdInCollisions(collisions: DragEndEvent['collisions']): number | null {
  if (!collisions) return null;
  for (const hit of collisions) {
    const id = String(hit.id);
    if (!id.startsWith('group:stage-')) continue;
    return stageFromGroup(id, null);
  }
  return null;
}

function dropTarget(
  overId: string,
  data: unknown,
  paper: PaperState,
  collisions: DragEndEvent['collisions'],
): PaperTarget | 'bank' | null {
  if (overId === 'bank-pane') return 'bank';
  if (overId.startsWith('paper:')) {
    const beforeDocId = readInteger(Number(overId.slice('paper:'.length)));
    if (beforeDocId === null) return null;
    const row = paper.items.find((item) => item.docId === beforeDocId);
    return { beforeDocId, stageId: row?.stageId ?? null };
  }
  if (overId.startsWith('group:')) return { beforeDocId: null, stageId: stageFromGroup(overId, data) };
  // The pointer is in the column but not on a row. Append; a stage group in the same hit list wins.
  if (overId === 'paper-pane') return { beforeDocId: null, stageId: stageIdInCollisions(collisions) };
  return null;
}

function dragCard(data: unknown, paper: PaperState, cache: ReadonlyMap<number, TeachBankItem>): DragCard | null {
  const bankId = bankDragDocId(data);
  if (bankId !== null) {
    const cached = cache.get(bankId);
    if (cached) return { pid: cached.pid, title: cached.title };
    const parsed = bankDragRef(data);
    if (parsed) return { pid: parsed.pid, title: parsed.title };
    return null;
  }
  const paperId = paperDragDocId(data);
  if (paperId === null) return null;
  const item = paper.items.find((entry) => entry.docId === paperId);
  if (!item) return null;
  return { pid: item.pid, title: item.title };
}

function outsideToast(prev: ComposeState, next: ComposeState) {
  const kinds = landedKindsOutsideActive(prev, next);
  if (kinds.length === 0) return;
  const before = new Set(prev.current.items.map((item) => item.docId));
  const outside = new Set<ProblemKind>(kinds);
  let count = 0;
  for (const item of next.current.items) {
    if (before.has(item.docId) || !outside.has(item.kind)) continue;
    count += 1;
  }
  if (count === 0) return;
  const place = kinds.map((kind) => `「${kindName(kind)}」`).join('、');
  toast.info(`已加入 ${count} 道，放在${place}页签`);
}

function collisionRank(id: string | number): number {
  const text = String(id);
  if (text.startsWith('paper:')) return 0;
  if (text.startsWith('group:')) return 1;
  if (text === 'paper-pane') return 2;
  if (text === 'bank-pane') return 3;
  return 4;
}

// Only the rectangle under the pointer counts. closestCenter would treat a drop on the
// toolbar as the nearest row or the bank and rewrite the paper. Keyboard drags report
// coordinates on the target corner, which pointerWithin still hits.
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length === 0) return [];
  return hits.slice().sort((left, right) => collisionRank(left.id) - collisionRank(right.id));
};

function paneClass(shown: boolean, divide: boolean): string {
  return cn(
    'h-full min-h-0 min-w-0 flex-col',
    divide && 'lg:border-r lg:border-line',
    shown ? 'flex' : 'hidden',
    'lg:flex',
  );
}

function PaperColumn({ shown, children }: { shown: boolean; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: 'paper-pane' });
  return (
    <div ref={setNodeRef} className={paneClass(shown, false)}>
      {children}
    </div>
  );
}

function objectiveCreateBusy(): boolean {
  for (const button of document.querySelectorAll('button')) {
    if (button.getAttribute('aria-busy') !== 'true') continue;
    if ((button.textContent ?? '').includes('保存并加入试卷')) return true;
  }
  return false;
}

function DragPreview({ pid, title }: DragCard) {
  return (
    <div className="flex max-w-xs items-baseline gap-2 rounded-md border border-line bg-surface-raised px-3 py-2 text-sm shadow-pop">
      <span className="shrink-0 font-mono text-xs text-fg-subtle">{pid}</span>
      <span className="min-w-0 truncate">{title}</span>
    </div>
  );
}

export function TeachComposePage(): JSX.Element {
  const bootstrap = useBootstrap();
  const payload = useMemo(() => parseTeachComposePayload(bootstrap.page.data), [bootstrap.page.data]);
  const { container } = payload;
  const [state, dispatch] = useReducer(
    composeReducer,
    payload,
    (loaded) => initialComposeState(paperFromPayload(loaded.paper, loaded.container), loaded.container.status),
  );
  const [pane, setPane] = useState<Pane>('bank');
  const [sheet, setSheet] = useState<ObjectiveRequest | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragCard | null>(null);
  const stateRef = useRef(state);
  const sheetRef = useRef<ObjectiveRequest | null>(sheet);
  const savingRef = useRef(false);
  const leavePending = useRef(false);
  const leavePhase = useRef<LeavePhase>('idle');
  const discardOnLeave = useRef(false);
  const savingCreatedRef = useRef(false);
  const createdDuringConfirm = useRef<PaperItem | null>(null);
  const announcedCreated = useRef<number | null>(null);
  const unlockPending = useRef(false);
  const mountedRef = useRef(true);
  const bankCache = useRef(new Map<number, TeachBankItem>());
  // Paper edits that arrive while saveComposition is in flight. `saved` must commit
  // the snapshot before these run, or the new problems are replaced by that snapshot.
  const pendingEdits = useRef<ComposeAction[]>([]);
  const leaveAfterSave = useRef(false);
  stateRef.current = state;
  sheetRef.current = sheet;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const changeCount = paperChangeCount(state.base, state.current);
  const issues = paperIssues(state.current);
  const { allowNavigation, guardDialog } = useUnsavedChangesGuard(changeCount > 0 || sheet !== null);
  const selection = useMemo(() => new Set(state.selection), [state.selection]);
  const inPaper = useMemo(() => new Set(state.current.items.map((item) => item.docId)), [state.current.items]);
  const interactiveLocked = state.locked || saving;
  const paneState = interactiveLocked === state.locked ? state : { ...state, locked: true };
  const destination = teachPath(container.type, container.id, 'problems');
  const banner = state.locked
    ? lockBanner(container.status, container.type, TEACH_TYPE_NOUN[container.type], payload.examStartedCount)
    : null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function remember(items: readonly TeachBankItem[]) {
    for (const item of items) bankCache.current.set(item.docId, item);
  }

  function projectedState(): ComposeState {
    return pendingEdits.current.reduce(
      (draft, action) => composeReducer(draft, action),
      stateRef.current,
    );
  }

  function applyEdit(action: ComposeAction) {
    if (savingRef.current) {
      pendingEdits.current.push(action);
      return;
    }
    dispatch(action);
  }

  function takePendingEdits(base: ComposeState): { actions: ComposeAction[]; next: ComposeState } {
    const actions = pendingEdits.current;
    pendingEdits.current = [];
    let next = base;
    for (const action of actions) next = composeReducer(next, action);
    return { actions, next };
  }

  function addBankItems(items: readonly BankRef[], target: PaperTarget, clearSelection: boolean) {
    const prev = projectedState();
    if (items.length === 0 || prev.locked) return;
    const paperItems = items.map(bankToPaper);
    const action: ComposeAction = { type: 'add', items: paperItems, target };
    applyEdit(action);
    if (clearSelection) dispatch({ type: 'clearSelection' });
    outsideToast(prev, composeReducer(prev, action));
  }

  function resolveBankRef(docId: number, data: unknown): BankRef | null {
    const cached = bankCache.current.get(docId);
    if (cached) return cached;
    const parsed = bankDragRef(data);
    if (parsed && parsed.docId === docId) return parsed;
    console.error('teach compose bank drag has no cached item', { docId });
    return null;
  }

  function onDragStart(event: DragStartEvent) {
    const data: unknown = event.active.data.current;
    setDragPreview(dragCard(data, stateRef.current.current, bankCache.current));
  }

  function onDragCancel() {
    setDragPreview(null);
  }

  function onDragEnd(event: DragEndEvent) {
    setDragPreview(null);
    const over = event.over;
    if (!over) return;
    const data: unknown = event.active.data.current;
    const overId = String(over.id);
    const overData: unknown = over.data.current;
    const paper = stateRef.current.current;
    const target = dropTarget(overId, overData, paper, event.collisions);
    const bankId = bankDragDocId(data);
    if (bankId !== null) {
      if (target === null || target === 'bank') return;
      const item = resolveBankRef(bankId, data);
      if (!item) return;
      addBankItems([item], target, false);
      return;
    }
    const docId = paperDragDocId(data);
    if (docId === null) {
      console.error('teach compose drag source is unknown', { id: String(event.active.id) });
      return;
    }
    if (target === 'bank') {
      applyEdit({ type: 'remove', docId });
      return;
    }
    if (target === null || target.beforeDocId === docId) return;
    applyEdit({ type: 'move', docId, target });
  }

  function composedWithCreated(item: PaperItem, discard: boolean, forceUnlocked: boolean): ComposeState | null {
    const saved = stateRef.current;
    let source: ComposeState = discard
      ? { ...saved, current: saved.base, selection: [] }
      : projectedState();
    if (forceUnlocked) source = { ...source, locked: false };
    const action: ComposeAction = { type: 'add', items: [item], target: EMPTY_TARGET };
    const next = composeReducer(source, action);
    const landed = next.current.items.some((entry) => entry.docId === item.docId)
      && !source.current.items.some((entry) => entry.docId === item.docId);
    if (!landed) {
      console.error('teach compose did not add the new problem', {
        docId: item.docId,
        pid: item.pid,
        locked: source.locked,
      });
      return null;
    }
    return next;
  }

  function showCreated(item: PaperItem, discard: boolean) {
    const action: ComposeAction = { type: 'add', items: [item], target: EMPTY_TARGET };
    if (discard) {
      pendingEdits.current = [];
      dispatch({ type: 'discard' });
      dispatch(action);
    } else {
      applyEdit(action);
    }
    setRefreshToken((value) => value + 1);
    if (isTeachGroupedByKind(container.type)) dispatch({ type: 'setActiveKind', kind: item.kind });
    if (announcedCreated.current === item.docId) return;
    announcedCreated.current = item.docId;
    toast.success(`已新建 ${item.pid} 并加入「${kindName(item.kind)}」`);
  }

  async function saveCreatedThenLeave(item: PaperItem, discard: boolean) {
    leavePhase.current = 'saving';
    const next = composedWithCreated(item, discard, true);
    if (!next) {
      savingCreatedRef.current = false;
      leavePhase.current = 'idle';
      discardOnLeave.current = false;
      return;
    }
    if (mountedRef.current) {
      const visible = stateRef.current.current.items.some((entry) => entry.docId === item.docId);
      if (!visible) showCreated(item, discard);
      else if (discard) {
        pendingEdits.current = [];
        dispatch({ type: 'discard' });
        dispatch({ type: 'add', items: [item], target: EMPTY_TARGET });
      }
    }
    // After the new problem is on screen. Setting this earlier makes applyEdit
    // park that add in pendingEdits, and the in-flight save would omit it.
    savingRef.current = true;
    if (mountedRef.current) setSaving(true);
    try {
      await saveComposition({ type: container.type, id: container.id, current: next.current });
      assignLeave();
    } catch (error: unknown) {
      console.error('teach compose save created problem failed', {
        type: container.type,
        id: container.id,
        docId: item.docId,
        pid: item.pid,
        error,
      });
      savingRef.current = false;
      savingCreatedRef.current = false;
      leavePhase.current = 'idle';
      discardOnLeave.current = false;
      if (mountedRef.current) {
        setSaving(false);
        setSaveError(messageOf(error, SAVE_FAILED));
      }
    }
  }

  function onCreated(item: PaperItem) {
    const phase = leavePhase.current;
    const unmounted = !mountedRef.current;
    if (phase === 'confirming') createdDuringConfirm.current = item;
    if (phase === 'armed' || unmounted) {
      savingCreatedRef.current = true;
      void saveCreatedThenLeave(item, phase === 'armed' && discardOnLeave.current);
      return;
    }
    const added = composedWithCreated(item, false, false);
    if (!added || unmounted) return;
    showCreated(item, false);
  }

  async function confirmUnlock() {
    const confirmed = await confirmDialog(unlockMessage(container.status), {
      title: UNLOCK_TITLE,
      confirmLabel: '仍要修改',
    });
    if (!confirmed || !mountedRef.current) return;
    dispatch({ type: 'unlock' });
  }

  function askUnlock() {
    if (unlockPending.current || !stateRef.current.locked) return;
    unlockPending.current = true;
    void confirmUnlock().finally(() => {
      unlockPending.current = false;
    });
  }

  function assignLeave() {
    if (mountedRef.current) allowNavigation();
    window.location.assign(destination);
  }

  async function confirmLeave(count: number) {
    const confirmed = await confirmDialog(`有 ${count} 项修改还没保存，离开后会丢失。`, {
      title: LEAVE_TITLE,
      confirmLabel: '放弃并离开',
      destructive: true,
    });
    if (!confirmed || !mountedRef.current) return;
    assignLeave();
  }

  async function confirmLeaveThenArm(count: number) {
    const confirmed = await confirmDialog(`有 ${count} 项修改还没保存，离开后会丢失。`, {
      title: LEAVE_TITLE,
      confirmLabel: '放弃并离开',
      destructive: true,
    });
    if (!confirmed || !mountedRef.current) {
      leavePhase.current = 'idle';
      createdDuringConfirm.current = null;
      return;
    }
    const pending = createdDuringConfirm.current;
    createdDuringConfirm.current = null;
    if (pending) {
      savingCreatedRef.current = true;
      await saveCreatedThenLeave(pending, true);
      return;
    }
    if (objectiveCreateBusy()) {
      discardOnLeave.current = true;
      leavePhase.current = 'armed';
      return;
    }
    leavePhase.current = 'idle';
    assignLeave();
  }

  function armLeaveOrConfirm(count: number) {
    if (count > 0) {
      leavePhase.current = 'confirming';
      void confirmLeaveThenArm(count);
      return;
    }
    if (objectiveCreateBusy()) {
      discardOnLeave.current = false;
      leavePhase.current = 'armed';
      return;
    }
    assignLeave();
  }

  function startLeave(count: number) {
    if (sheetRef.current !== null) {
      armLeaveOrConfirm(count);
      return;
    }
    if (count === 0) {
      assignLeave();
      return;
    }
    leavePending.current = true;
    void confirmLeave(count).finally(() => {
      leavePending.current = false;
    });
  }

  function leave() {
    if (leavePending.current) return;
    const phase = leavePhase.current;
    if (phase === 'confirming' || phase === 'armed' || phase === 'saving') return;
    if (savingRef.current) {
      leaveAfterSave.current = true;
      return;
    }
    const count = paperChangeCount(stateRef.current.base, stateRef.current.current);
    if (sheetRef.current !== null) {
      armLeaveOrConfirm(count);
      return;
    }
    startLeave(count);
  }

  function onSheetOpenChange(open: boolean) {
    if (open) return;
    sheetRef.current = null;
    setSheet(null);
    if (leavePhase.current !== 'armed' || savingCreatedRef.current) return;
    const discard = discardOnLeave.current;
    leavePhase.current = 'idle';
    discardOnLeave.current = false;
    if (discard) {
      assignLeave();
      return;
    }
    startLeave(paperChangeCount(stateRef.current.base, stateRef.current.current));
  }

  function finishDeferredLeave(next: ComposeState | null, saved: boolean) {
    if (!leaveAfterSave.current) return;
    leaveAfterSave.current = false;
    if (!mountedRef.current || next === null) return;
    const count = paperChangeCount(next.base, next.current);
    if (sheetRef.current !== null) {
      if (leavePhase.current === 'idle') armLeaveOrConfirm(count);
      return;
    }
    if (saved && count === 0) {
      assignLeave();
      return;
    }
    startLeave(count);
  }

  async function savePaper() {
    if (savingRef.current) return;
    const snapshot = stateRef.current.current;
    if (paperChangeCount(stateRef.current.base, snapshot) === 0) return;
    if (paperIssues(snapshot).length > 0) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    let saved = false;
    let settled: ComposeState | null = null;
    try {
      await saveComposition({ type: container.type, id: container.id, current: snapshot });
      if (!mountedRef.current) return;
      const savedState = composeReducer(stateRef.current, { type: 'saved', paper: snapshot });
      const pending = takePendingEdits(savedState);
      dispatch({ type: 'saved', paper: snapshot });
      for (const action of pending.actions) dispatch(action);
      toast.success('已保存');
      saved = true;
      settled = pending.next;
    } catch (error: unknown) {
      console.error('teach compose save failed', { type: container.type, id: container.id, error });
      if (mountedRef.current) setSaveError(messageOf(error, SAVE_FAILED));
      if (mountedRef.current) {
        const pending = takePendingEdits(stateRef.current);
        for (const action of pending.actions) dispatch(action);
        settled = pending.next;
      }
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
    finishDeferredLeave(settled, saved);
  }

  const drawId = `teach-compose-draw-${container.id}`;

  return (
    <Workspace>
      <Toolbar
        className="h-auto min-h-10 shrink-0 flex-wrap border-b border-line bg-surface px-2"
        end={(
          <>
            <span
              aria-live="polite"
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 text-sm whitespace-nowrap text-warning-fg',
                changeCount === 0 && 'invisible',
              )}
            >
              <StatusDot tone="warning" />
              {`${changeCount} 项修改未保存`}
            </span>
            <Button type="button" variant="ghost" size="sm" disabled={changeCount === 0 || saving} onClick={() => dispatch({ type: 'discard' })}>
              放弃修改
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={changeCount === 0 || issues.length > 0 || saving}
              loading={saving}
              onClick={() => { void savePaper(); }}
            >
              保存
            </Button>
          </>
        )}
      >
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={leave}>
          <ArrowLeft />
          返回工作台
        </Button>
        <span className="min-w-0 truncate text-sm font-semibold text-fg">{container.title}</span>
        <Badge variant="outline" size="sm" className="shrink-0">{TEACH_TYPE_LABEL[container.type]}</Badge>
        {container.type === 'exam' ? (
          <label htmlFor={drawId} className="inline-flex shrink-0 items-center gap-2 text-sm text-fg">
            <Switch
              id={drawId}
              size="sm"
              checked={state.current.draw}
              disabled={interactiveLocked}
              onCheckedChange={(on) => dispatch({ type: 'setDraw', on })}
            />
            随机抽题
          </label>
        ) : null}
        <span className="shrink-0 text-sm whitespace-nowrap text-fg-muted tabular">{paperSummary(state.current)}</span>
      </Toolbar>
      {banner !== null || saveError !== null ? (
        <div className="flex shrink-0 flex-col gap-2 border-b border-line px-3 py-2">
          {banner !== null ? (
            <Alert
              tone="warning"
              action={(
                <Button type="button" variant="secondary" size="sm" onClick={askUnlock}>
                  仍要修改
                </Button>
              )}
            >
              {banner}
            </Alert>
          ) : null}
          {saveError !== null ? (
            <Alert tone="danger" onDismiss={() => setSaveError(null)}>{saveError}</Alert>
          ) : null}
        </div>
      ) : null}
      <div className="shrink-0 border-b border-line px-2 py-2 lg:hidden">
        <MiniTabs<Pane>
          fullWidth
          size="sm"
          aria-label="切换"
          value={pane}
          onValueChange={setPane}
          items={[
            { value: 'bank', label: '题库' },
            { value: 'paper', label: '试卷', count: state.current.items.length },
          ]}
        />
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragCancel={onDragCancel}
        onDragEnd={onDragEnd}
      >
        {/* ds-allow DS004: 组卷台左栏 24rem，右栏占剩余宽度，间距档写不出这条轨道 */}
        <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[24rem_minmax(0,1fr)]">
          <div className={paneClass(pane === 'bank', true)}>
            <div className="min-h-0 w-full flex-1">
              <BankPane
                type={container.type}
                locked={interactiveLocked}
                inPaper={inPaper}
                selection={selection}
                onToggleSelect={(docId, on) => dispatch({ type: 'select', docId, on })}
                onClearSelection={() => dispatch({ type: 'clearSelection' })}
                onAdd={(items) => {
                  remember(items);
                  addBankItems(items, EMPTY_TARGET, true);
                }}
                onCreateObjective={(kind, node) => setSheet({ kind, nodeId: node?.nodeId ?? null })}
                onItemsLoaded={remember}
                refreshToken={refreshToken}
              />
            </div>
          </div>
          <PaperColumn shown={pane === 'paper'}>
            <div className="min-h-0 w-full flex-1">
              <PaperPane state={paneState} dispatch={dispatch} />
            </div>
          </PaperColumn>
        </div>
        <DragOverlay>{dragPreview ? <DragPreview pid={dragPreview.pid} title={dragPreview.title} /> : null}</DragOverlay>
      </DndContext>
      {guardDialog}
      <ObjectiveSheet
        open={sheet !== null}
        onOpenChange={onSheetOpenChange}
        type={container.type}
        initialKind={sheet?.kind ?? 'single'}
        defaultScore={(kind) => defaultScoreFor(state.current, kind)}
        knowledgeOptions={payload.knowledgeOptions}
        defaultNodeId={sheet?.nodeId ?? null}
        onCreated={onCreated}
      />
    </Workspace>
  );
}
