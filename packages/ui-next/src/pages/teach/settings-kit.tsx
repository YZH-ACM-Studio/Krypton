import type { TeachTab, TeachType } from '@hydrooj/common';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Trash2 } from 'lucide-react';
import {
  DomainUserMultiSelect,
  loadDomainUsersByIds,
  type DomainUserOption,
} from '@/components/domain-user-search';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  confirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton, Spinner, StatusDot } from '@/components/ui/display';
import { Panel } from '@/components/ui/panel';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { useBootstrap } from '@/lib/bootstrap';
import { getJson, postForm, postJson, teachApi } from './api';
import {
  legacyEditPath,
  parseContestSnapshot,
  parseHomeworkSnapshot,
  parsePracticeSnapshot,
  type ContestSnapshot,
  type HomeworkSnapshot,
  type PracticeSnapshot,
} from './legacy-forms';
import { parseTeachShareState, type TeachShareState } from './model';

const SNAPSHOT_LOAD_FAILED = '题目集设置没有加载出来。';
const SNAPSHOT_SAVE_FAILED = '保存失败。';
const SNAPSHOT_SAVE_BUSY = '正在保存，请稍候。';
const SHARE_LOAD_FAILED = '学校内共享状态没有加载出来。';
const SHARE_FAILED = '学校内共享失败。';
const SHARE_DESCRIPTION = '共享后，其他老师可以在「学校共享」里复制一份去用（题目、分值、设置），时间和学生由他们自己填。学生永远看不到。';
const SHARE_LABEL = '在学校内共享';
const SHARE_ON = '正在共享。关掉后已经复制走的不受影响。';
const SHARE_OFF = '没有共享。';
const SHARE_DISABLED = '只有所有者能共享这个题目集。';
const SHARE_STOPPED = '已停止共享，已经复制走的不受影响';
const OWN_NOTE = '共享后所有老师都能预览、选用这些题，但不能修改；学生在题目集外仍然看不到。题目集里如果有别人的、没共享的隐藏题，这里会列出来，并且不能共享（D49）。';
const OTHERS_TITLE = '这个题目集还不能共享';
const OTHERS_NOTE = '这些是别人的隐藏题，需要他们先共享到学校题库。';
const DELETE_WARNING = '删除后不能恢复。';
const DELETE_FAILED = '删除失败。';

export type AnyLegacySnapshot =
  | { kind: 'contest'; value: ContestSnapshot }
  | { kind: 'homework'; value: HomeworkSnapshot }
  | { kind: 'practice'; value: PracticeSnapshot };

interface LegacySnapshotController {
  status: 'loading' | 'ready' | 'error';
  snapshot: AnyLegacySnapshot | null;
  error: string | null;
  reload: () => Promise<void>;
  save: (build: (latest: AnyLegacySnapshot) => URLSearchParams) => Promise<{ refreshError: string | null }>;
}

interface SnapshotView {
  status: 'loading' | 'ready' | 'error';
  snapshot: AnyLegacySnapshot | null;
  error: string | null;
}

interface DirtyController {
  dirtyTabs: ReadonlySet<TeachTab>;
  setTabDirty: (tab: TeachTab, dirty: boolean) => void;
}

interface HiddenProblemRow {
  docId: number;
  pid: string;
  title: string;
  ownerName?: string;
}

type OwnHiddenProblem = TeachShareState['ownHiddenUnshared'][number];
type OtherHiddenProblem = TeachShareState['othersHiddenUnshared'][number];

type SharePrompt =
  | { kind: 'own'; problems: OwnHiddenProblem[] }
  | { kind: 'others'; problems: OtherHiddenProblem[] };

type SharePhase =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; share: TeachShareState; error: string | null; busy: boolean };

const LegacySnapshotContext = createContext<LegacySnapshotController | null>(null);
const WorkbenchDirtyContext = createContext<DirtyController | null>(null);

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof TypeError) return fallback;
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}

function rethrow(error: unknown, fallback: string): never {
  throw error instanceof Error ? error : new Error(fallback);
}

function snapshotFromRaw(type: TeachType, raw: unknown): AnyLegacySnapshot {
  switch (type) {
    case 'practice':
      return { kind: 'practice', value: parsePracticeSnapshot(raw) };
    case 'homework':
      return { kind: 'homework', value: parseHomeworkSnapshot(raw) };
    case 'exam':
    case 'acm':
    case 'oi':
      return { kind: 'contest', value: parseContestSnapshot(raw) };
    default: {
      const unexpected: never = type;
      throw new TypeError(`teach_type_invalid:${String(unexpected)}`);
    }
  }
}

async function readSnapshot(type: TeachType, id: string): Promise<AnyLegacySnapshot> {
  const raw = await getJson(legacyEditPath(type, id), SNAPSHOT_LOAD_FAILED);
  return snapshotFromRaw(type, raw);
}

function deletePath(type: TeachType, id: string): string {
  if (!id) throw new TypeError('teach_id_invalid');
  switch (type) {
    case 'practice':
      return `/problem-sets/${id}`;
    case 'homework':
      return `/homework/${id}/edit`;
    case 'exam':
    case 'acm':
    case 'oi':
      return `/contest/${id}/edit`;
    default: {
      const unexpected: never = type;
      throw new TypeError(`teach_type_invalid:${String(unexpected)}`);
    }
  }
}

function shareRequest(shared: boolean, ownDocIds?: readonly number[]): Record<string, unknown> {
  const body: Record<string, unknown> = { shared };
  if (ownDocIds !== undefined) {
    body.shareOwnProblems = true;
    body.expectedOwnDocIds = [...ownDocIds];
  }
  return body;
}

function collaboratorIds(value: readonly number[]): number[] {
  return value.map((id) => {
    if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError('teach_collaborator_invalid');
    return id;
  });
}

export function LegacySnapshotProvider({
  type,
  id,
  children,
}: {
  type: TeachType;
  id: string;
  children: ReactNode;
}): ReactElement {
  const [view, setView] = useState<SnapshotView>({ status: 'loading', snapshot: null, error: null });
  const generation = useRef(0);
  const saving = useRef(false);
  const identityRef = useRef({ type, id });
  identityRef.current = { type, id };

  const reload = useCallback(async () => {
    const token = generation.current + 1;
    generation.current = token;
    try {
      const snapshot = await readSnapshot(type, id);
      if (generation.current !== token) return;
      setView({ status: 'ready', snapshot, error: null });
    } catch (error) {
      console.error('teach legacy snapshot load failed', { type, id, error });
      if (generation.current !== token) return;
      setView((current) => (
        current.snapshot
          ? { status: 'ready', snapshot: current.snapshot, error: null }
          : { status: 'error', snapshot: null, error: messageOf(error, SNAPSHOT_LOAD_FAILED) }
      ));
      rethrow(error, SNAPSHOT_LOAD_FAILED);
    }
  }, [type, id]);

  useEffect(() => {
    const token = generation.current + 1;
    generation.current = token;
    let cancelled = false;
    setView({ status: 'loading', snapshot: null, error: null });
    readSnapshot(type, id)
      .then((snapshot) => {
        if (cancelled || generation.current !== token) return;
        setView({ status: 'ready', snapshot, error: null });
      })
      .catch((error: unknown) => {
        console.error('teach legacy snapshot load failed', { type, id, error });
        if (cancelled || generation.current !== token) return;
        setView({ status: 'error', snapshot: null, error: messageOf(error, SNAPSHOT_LOAD_FAILED) });
      });
    return () => {
      cancelled = true;
    };
  }, [type, id]);

  const save = useCallback(async (build: (latest: AnyLegacySnapshot) => URLSearchParams) => {
    if (saving.current) throw new Error(SNAPSHOT_SAVE_BUSY);
    saving.current = true;
    const savedType = type;
    const savedId = id;
    const stillHere = () => identityRef.current.type === savedType && identityRef.current.id === savedId;
    try {
      let latest: AnyLegacySnapshot;
      try {
        latest = await readSnapshot(savedType, savedId);
      } catch (error) {
        console.error('teach legacy snapshot refresh failed', { type: savedType, id: savedId, error });
        rethrow(error, SNAPSHOT_LOAD_FAILED);
      }
      const body = build(latest);
      if (!(body instanceof URLSearchParams)) throw new TypeError('teach_snapshot_body_invalid');
      try {
        await postForm(legacyEditPath(savedType, savedId), body, SNAPSHOT_SAVE_FAILED);
      } catch (error) {
        console.error('teach legacy snapshot save failed', { type: savedType, id: savedId, error });
        rethrow(error, SNAPSHOT_SAVE_FAILED);
      }
      // A newer container already owns this provider. Do not invalidate its load or write A's snapshot onto it.
      if (!stillHere()) return { refreshError: null };
      const token = generation.current + 1;
      generation.current = token;
      try {
        const refreshed = await readSnapshot(savedType, savedId);
        if (!stillHere() || generation.current !== token) return { refreshError: null };
        setView({ status: 'ready', snapshot: refreshed, error: null });
        return { refreshError: null };
      } catch (error) {
        console.error('teach legacy snapshot refresh failed', { type: savedType, id: savedId, error });
        const refreshError = messageOf(error, SNAPSHOT_LOAD_FAILED);
        if (stillHere() && generation.current === token) {
          setView({
            status: 'error',
            snapshot: latest,
            error: refreshError,
          });
        }
        return { refreshError };
      }
    } finally {
      saving.current = false;
    }
  }, [type, id]);

  const value = useMemo<LegacySnapshotController>(() => ({
    status: view.status,
    snapshot: view.snapshot,
    error: view.error,
    reload,
    save,
  }), [view, reload, save]);

  return <LegacySnapshotContext.Provider value={value}>{children}</LegacySnapshotContext.Provider>;
}

export function useLegacySnapshot(): LegacySnapshotController {
  const value = useContext(LegacySnapshotContext);
  if (!value) throw new Error('useLegacySnapshot must be used inside LegacySnapshotProvider');
  return value;
}

export function WorkbenchDirtyProvider({ children }: { children: ReactNode }): ReactElement {
  const [dirtyTabs, setDirtyTabs] = useState<ReadonlySet<TeachTab>>(() => new Set());
  const setTabDirty = useCallback((tab: TeachTab, dirty: boolean) => {
    setDirtyTabs((current) => {
      if (current.has(tab) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(tab);
      else next.delete(tab);
      return next;
    });
  }, []);
  const value = useMemo<DirtyController>(() => ({ dirtyTabs, setTabDirty }), [dirtyTabs, setTabDirty]);
  return <WorkbenchDirtyContext.Provider value={value}>{children}</WorkbenchDirtyContext.Provider>;
}

export function useWorkbenchDirty(): DirtyController {
  const value = useContext(WorkbenchDirtyContext);
  if (!value) throw new Error('useWorkbenchDirty must be used inside WorkbenchDirtyProvider');
  return value;
}

export function SaveBar({
  dirtyCount,
  saving,
  onSave,
  onDiscard,
}: {
  dirtyCount: number;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}): ReactElement | null {
  if (dirtyCount === 0) return null;
  return (
    <div role="status" className="sticky bottom-0 z-10 flex items-center gap-3 border-t border-line bg-surface px-4 py-3">
      <StatusDot tone="warning" />
      <span className="min-w-0 flex-1 text-sm text-fg tabular">{dirtyCount} 项修改未保存</span>
      <Button type="button" variant="ghost" onClick={onDiscard}>放弃</Button>
      <Button type="button" variant="primary" disabled={saving} onClick={onSave}>
        {saving ? <Spinner /> : null}
        保存
      </Button>
    </div>
  );
}

export function SwitchRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled = false,
  disabledReason = null,
}: {
  id: string;
  label: string;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  disabledReason?: string | null;
}): ReactElement {
  const reason = disabled && disabledReason ? disabledReason : null;
  const detail = reason ?? description ?? null;
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm text-fg">{label}</label>
        {detail != null && detail !== '' ? <p className="mt-0.5 text-xs text-fg-subtle">{detail}</p> : null}
      </div>
      <Switch
        id={id}
        className="shrink-0"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export function countChangedKeys<T extends object>(base: T, draft: T, keys: ReadonlyArray<keyof T>): number {
  let count = 0;
  for (const key of keys) {
    if (JSON.stringify(base[key]) !== JSON.stringify(draft[key])) count += 1;
  }
  return count;
}

export function CollaboratorsPanel({
  noun,
  value,
  onChange,
}: {
  noun: string;
  value: number[];
  onChange: (next: number[]) => void;
}): ReactElement {
  const domainId = useBootstrap().domain.id;
  const idsKey = collaboratorIds(value).join(',');
  const [loaded, setLoaded] = useState<{ key: string; users: DomainUserOption[] } | null>(null);
  const users = loaded?.key === idsKey
    ? loaded.users
    : collaboratorIds(value).map((id) => ({ _id: id }));

  useEffect(() => {
    const ids = idsKey === '' ? [] : idsKey.split(',').map((part) => Number(part));
    let cancelled = false;
    if (ids.length === 0) return undefined;
    loadDomainUsersByIds(domainId, ids)
      .then((found) => {
        if (cancelled) return;
        const byId = new Map(found.map((user) => [user._id, user]));
        setLoaded({
          key: idsKey,
          users: ids.map((id) => byId.get(id) ?? { _id: id }),
        });
      })
      .catch((error: unknown) => {
        console.error('teach collaborator lookup failed', { domainId, error });
        if (cancelled) return;
        setLoaded({ key: idsKey, users: ids.map((id) => ({ _id: id })) });
      });
    return () => {
      cancelled = true;
    };
  }, [domainId, idsKey]);

  return (
    <Panel title="协作者" description={`协作者能和你一样管理这个${noun}，但不能删除它。`}>
      <DomainUserMultiSelect
        domainId={domainId}
        value={users}
        onChange={(next) => onChange(next.map((user) => user._id))}
      />
    </Panel>
  );
}

function ProblemRows({ problems }: { problems: readonly HiddenProblemRow[] }): ReactElement {
  return (
    <ul className="divide-y divide-line-subtle">
      {problems.map((problem) => (
        <li key={problem.docId} className="flex min-w-0 items-baseline gap-3 py-2">
          <span className="shrink-0 font-mono text-xs text-fg-subtle">{problem.pid}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-fg">{problem.title}</span>
          {problem.ownerName ? <span className="shrink-0 text-xs text-fg-muted">{problem.ownerName}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function SharePanel({
  type,
  id,
  canShare,
}: {
  type: TeachType;
  id: string;
  canShare: boolean;
}): ReactElement {
  const switchId = useId();
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<SharePhase>({ phase: 'loading' });
  const [prompt, setPrompt] = useState<SharePrompt | null>(null);
  const busyRef = useRef(false);
  const refreshRef = useRef(false);
  const identityRef = useRef({ type, id });
  identityRef.current = { type, id };

  useEffect(() => {
    if (!id) {
      busyRef.current = false;
      refreshRef.current = false;
      setPhase({ phase: 'error', message: '题目集编号无效。' });
      return undefined;
    }
    let cancelled = false;
    busyRef.current = false;
    refreshRef.current = false;
    setPhase({ phase: 'loading' });
    setPrompt(null);
    getJson(teachApi.share(type, id), SHARE_LOAD_FAILED)
      .then((raw) => {
        if (cancelled) return;
        setPhase({ phase: 'ready', share: parseTeachShareState(raw), error: null, busy: false });
      })
      .catch((error: unknown) => {
        console.error('teach share load failed', { type, id, error });
        if (cancelled) return;
        setPhase({ phase: 'error', message: messageOf(error, SHARE_LOAD_FAILED) });
      });
    return () => {
      cancelled = true;
    };
  }, [type, id, attempt]);

  const commit = useCallback(async (shared: boolean, ownDocIds?: readonly number[]) => {
    const savedType = type;
    const savedId = id;
    const stillHere = () => identityRef.current.type === savedType && identityRef.current.id === savedId;
    if (busyRef.current || !stillHere()) return;
    busyRef.current = true;
    setPhase((current) => (current.phase === 'ready' ? { ...current, busy: true, error: null } : current));
    try {
      const raw = await postJson(teachApi.share(savedType, savedId), shareRequest(shared, ownDocIds), SHARE_FAILED);
      if (!stillHere()) return;
      const share = parseTeachShareState(raw);
      const applied = (share.shared !== null) === shared;
      if (!applied) {
        if (shared) refreshRef.current = true;
        setPrompt(null);
        setPhase({ phase: 'ready', share, error: SHARE_FAILED, busy: false });
        return;
      }
      refreshRef.current = false;
      setPrompt(null);
      setPhase({ phase: 'ready', share, error: null, busy: false });
      if (!shared) toast.success(SHARE_STOPPED);
    } catch (error) {
      console.error('teach share update failed', { type: savedType, id: savedId, shared, error });
      if (!stillHere()) return;
      if (shared) refreshRef.current = true;
      setPrompt(null);
      setPhase((current) => (
        current.phase === 'ready'
          ? { ...current, busy: false, error: messageOf(error, SHARE_FAILED) }
          : current
      ));
    } finally {
      if (stillHere()) busyRef.current = false;
    }
  }, [type, id]);

  function dismissPrompt(open: boolean) {
    if (open || busyRef.current) return;
    setPrompt(null);
  }

  async function requestShare(next: boolean) {
    const savedType = type;
    const savedId = id;
    const stillHere = () => identityRef.current.type === savedType && identityRef.current.id === savedId;
    if (busyRef.current || !stillHere() || phase.phase !== 'ready' || phase.busy || !canShare || prompt !== null) return;
    if (next === (phase.share.shared !== null)) return;
    if (!next) {
      void commit(false);
      return;
    }
    let share = phase.share;
    if (refreshRef.current) {
      busyRef.current = true;
      setPhase((current) => (current.phase === 'ready' ? { ...current, busy: true, error: null } : current));
      try {
        share = parseTeachShareState(await getJson(teachApi.share(savedType, savedId), SHARE_LOAD_FAILED));
        if (!stillHere()) return;
        refreshRef.current = false;
      } catch (error) {
        console.error('teach share load failed', { type: savedType, id: savedId, error });
        if (!stillHere()) return;
        setPhase((current) => (
          current.phase === 'ready'
            ? { ...current, busy: false, error: messageOf(error, SHARE_LOAD_FAILED) }
            : current
        ));
        return;
      } finally {
        if (stillHere()) busyRef.current = false;
      }
      if (!stillHere()) return;
      setPhase({ phase: 'ready', share, error: null, busy: false });
      if (share.shared !== null) return;
    }
    if (share.othersHiddenUnshared.length > 0) {
      refreshRef.current = true;
      setPrompt({ kind: 'others', problems: share.othersHiddenUnshared });
      return;
    }
    if (share.ownHiddenUnshared.length > 0) {
      setPrompt({ kind: 'own', problems: share.ownHiddenUnshared });
      return;
    }
    void commit(true);
  }

  const ready = phase.phase === 'ready' ? phase : null;
  const shared = ready?.share.shared !== null;
  const ownProblems = prompt?.kind === 'own' ? prompt.problems : [];
  const otherProblems = prompt?.kind === 'others' ? prompt.problems : [];

  return (
    <Panel title="学校内共享" description={SHARE_DESCRIPTION}>
      {phase.phase === 'loading' ? <Skeleton className="h-12 w-full" /> : null}
      {phase.phase === 'error' ? (
        <div className="flex flex-col items-start gap-3">
          <Alert tone="danger">{phase.message}</Alert>
          <Button type="button" variant="secondary" onClick={() => setAttempt((current) => current + 1)}>重试</Button>
        </div>
      ) : null}
      {ready ? (
        <div className="flex flex-col gap-3">
          {ready.error ? <Alert tone="danger">{ready.error}</Alert> : null}
          <SwitchRow
            id={switchId}
            label={SHARE_LABEL}
            description={shared ? SHARE_ON : SHARE_OFF}
            checked={shared}
            disabled={!canShare || ready.busy || prompt !== null}
            disabledReason={canShare ? null : SHARE_DISABLED}
            onCheckedChange={requestShare}
          />
        </div>
      ) : null}
      <Dialog open={prompt?.kind === 'own'} onOpenChange={dismissPrompt}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{`先把 ${ownProblems.length} 道题共享到学校题库`}</DialogTitle>
            <DialogDescription>
              {`别的老师复制时要能选用这里的每一道题。下面 ${ownProblems.length} 道是你自己的隐藏题，还没共享。`}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <ProblemRows problems={ownProblems} />
            <p className="text-xs text-fg-subtle">{OWN_NOTE}</p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={ready?.busy === true} onClick={() => { if (!busyRef.current) setPrompt(null); }}>取消</Button>
            <Button
              type="button"
              variant="primary"
              disabled={ready?.busy === true}
              onClick={() => { void commit(true, ownProblems.map((problem) => problem.docId)); }}
            >
              一并共享并开启
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={prompt?.kind === 'others'} onOpenChange={dismissPrompt}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{OTHERS_TITLE}</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <ProblemRows problems={otherProblems} />
            <p className="text-sm text-fg-muted">{OTHERS_NOTE}</p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="primary" onClick={() => setPrompt(null)}>知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

export function DangerPanel({
  type,
  id,
  title,
  noun,
  canDelete,
}: {
  type: TeachType;
  id: string;
  title: string;
  noun: string;
  canDelete: boolean;
}): ReactElement | null {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  if (!canDelete) return null;

  async function remove() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    const confirmed = await confirmDialog(DELETE_WARNING, {
      title: `删除「${title}」？`,
      confirmLabel: '删除',
      destructive: true,
    });
    if (!confirmed) {
      pendingRef.current = false;
      return;
    }
    setPending(true);
    setError(null);
    const body = new URLSearchParams();
    body.set('operation', 'delete');
    try {
      await postForm(deletePath(type, id), body, DELETE_FAILED);
    } catch (caught) {
      console.error('teach delete failed', { type, id, error: caught });
      setError(messageOf(caught, DELETE_FAILED));
      setPending(false);
      pendingRef.current = false;
      return;
    }
    location.assign('/teach');
  }

  return (
    <Panel title="危险操作">
      <div className="flex flex-col gap-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-fg">{`删除这个${noun}`}</p>
            <p className="mt-0.5 text-xs text-fg-subtle">{DELETE_WARNING}</p>
          </div>
          <Button type="button" variant="danger-soft" disabled={pending} onClick={() => { void remove(); }}>
            <Trash2 />
            删除
          </Button>
        </div>
      </div>
    </Panel>
  );
}
