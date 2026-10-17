import {
  Component,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, RefreshCw, WifiOff } from 'lucide-react';
import { useUnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  confirmFormSubmit,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { SimpleSelect } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { TEAM_DIALOG_BUTTON_CLASS, TeamDialogBody, TeamDialogContent, TeamDialogFooter } from '@/components/team-dialog';
import { toast } from '@/components/ui/toast';
import { useBootstrap } from '@/lib/bootstrap';
import { fetchHydroResponse } from '@/lib/error-presenter';
import { COMMON_LANG_OPTIONS, resolveLangs, type LangOption } from '@/lib/multi-select-presets';
import { isSystemAdmin } from '@/lib/perms';
import { getJson, postForm } from '../api';
import {
  contestFormBody,
  legacyEditPath,
  type ContestFormState,
  type ContestSnapshot,
  type ContestVigilFields,
} from '../legacy-forms';
import type { TeachWorkbenchPayload } from '../model';
import {
  countChangedKeys,
  useLegacySnapshot,
  useWorkbenchDirty,
  type AnyLegacySnapshot,
} from '../settings-kit';

const SAVE_LABEL = '保存这一段';
const SECTION_SAVE_FAILED = '保存失败';

const VIGIL_FIELDS = [
  'vigilEnabled',
  'entryMode',
  'approvalMode',
  'lockdownMode',
  'networkLockdownMode',
  'networkLockdownFailurePolicy',
  'networkWhitelistHosts',
  'networkWhitelistIps',
  'networkWhitelistPorts',
  'pauseOnDisconnect',
  'screenshotIntervalMs',
  'exclusive',
  'clientLoginBlockBeforeMinutes',
  'clientLoginBlockAfterMinutes',
  'liveEnabled',
  'recordEnabled',
  'cameraEnabled',
  'screenshotJitterMs',
  'vigilProcessWhitelist',
] as const;

const TEAM_BATCH_FIELDS = ['plannedTeamBatchId'] as const;

const VERIFIER_FIELDS = ['uid', 'role', 'note'] as const;

const OTHER_FIELDS = ['rated', 'allowVirtual', 'allowPrint', 'autoHide', 'langs'] as const;

const VIGIL_FLAGS = [
  'vigilEnabled',
  'lockdownMode',
  'networkLockdownMode',
  'pauseOnDisconnect',
  'exclusive',
  'liveEnabled',
  'recordEnabled',
  'cameraEnabled',
] as const satisfies readonly (typeof VIGIL_FIELDS)[number][];

const ENTRY_MODES = ['open', 'client_required'] as const;
const APPROVAL_MODES = ['strict', 'auto'] as const;
const FAILURE_POLICIES = ['strict', 'report_only', 'off'] as const;
const RATING_RULES = new Set(['acm', 'oi', 'ioi', 'strictioi', 'ledo']);

type VigilFlag = (typeof VIGIL_FLAGS)[number];
type ReadinessLevel = 'pass' | 'warning' | 'block';

interface ReadinessItem {
  level: ReadinessLevel;
  code: string;
  title: string;
  message: string;
}

interface ReadinessReport {
  result: ReadinessLevel;
  teamCount: number;
  memberCount: number;
  snapshotHash: string | null;
  canFinalize: boolean;
  canStart: boolean;
  items: ReadinessItem[];
}

interface SectionSave {
  saving: boolean;
  error: string | null;
  dirtyCount: number;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

const VIGIL_WHEN_DISABLED: ContestVigilFields = {
  vigilEnabled: false,
  entryMode: 'open',
  approvalMode: 'strict',
  lockdownMode: false,
  networkLockdownMode: false,
  networkLockdownFailurePolicy: 'off',
  networkWhitelistHosts: '',
  networkWhitelistIps: '',
  networkWhitelistPorts: '',
  pauseOnDisconnect: false,
  screenshotIntervalMs: 60000,
  exclusive: false,
  clientLoginBlockBeforeMinutes: 60,
  clientLoginBlockAfterMinutes: 30,
  liveEnabled: false,
  recordEnabled: false,
  cameraEnabled: false,
  screenshotJitterMs: 30000,
  vigilProcessWhitelist: '',
};

const sectionDirtyCounts = new Map<string, number>();
const dirtyListeners = new Set<() => void>();
const guardMounted: string[] = [];
let guardHostId: string | null = null;
const guardHostListeners = new Set<() => void>();

function emitDirty() {
  for (const listener of dirtyListeners) listener();
}

function dirtyTotal(): number {
  let total = 0;
  for (const count of sectionDirtyCounts.values()) total += count;
  return total;
}

function subscribeDirty(listener: () => void): () => void {
  dirtyListeners.add(listener);
  return () => {
    dirtyListeners.delete(listener);
  };
}

function emitGuardHost() {
  for (const listener of guardHostListeners) listener();
}

function subscribeGuardHost(listener: () => void): () => void {
  guardHostListeners.add(listener);
  return () => {
    guardHostListeners.delete(listener);
  };
}

function readGuardHost(): string | null {
  return guardHostId;
}

function useReportSectionDirty(id: string, count: number) {
  useEffect(() => {
    sectionDirtyCounts.set(id, count);
    emitDirty();
    return () => {
      sectionDirtyCounts.delete(id);
      emitDirty();
    };
  }, [id, count]);
}

function useIsGuardHost(id: string): boolean {
  const host = useSyncExternalStore(subscribeGuardHost, readGuardHost, readGuardHost);
  useEffect(() => {
    guardMounted.push(id);
    if (guardHostId === null) {
      guardHostId = id;
      emitGuardHost();
    }
    return () => {
      const index = guardMounted.indexOf(id);
      if (index >= 0) guardMounted.splice(index, 1);
      if (guardHostId === id) {
        guardHostId = guardMounted[0] ?? null;
        emitGuardHost();
      }
    };
  }, [id]);
  return host === id;
}

function AdvancedTabDirty({ dirty }: { dirty: boolean }) {
  const { setTabDirty } = useWorkbenchDirty();
  useEffect(() => {
    setTabDirty('advanced', dirty);
    return () => setTabDirty('advanced', false);
  }, [dirty, setTabDirty]);
  return null;
}

function AdvancedDirtyHost() {
  const dirty = useSyncExternalStore(subscribeDirty, dirtyTotal, dirtyTotal);
  const guard = useUnsavedChangesGuard(dirty > 0, {
    description: '高级设置还有没保存的修改。离开后会丢掉。',
  });
  return (
    <>
      <AdvancedTabDirty dirty={dirty > 0} />
      {guard.guardDialog}
    </>
  );
}

class MissingWorkbenchDirtyBoundary extends Component<{ children: ReactNode }, { missing: boolean }> {
  state = { missing: false };

  static getDerivedStateFromError(error: unknown): { missing: boolean } | null {
    if (error instanceof Error && error.message === 'useWorkbenchDirty must be used inside WorkbenchDirtyProvider') {
      return { missing: true };
    }
    return null;
  }

  render(): ReactNode {
    if (this.state.missing) return null;
    return this.props.children;
  }
}

function AdvancedDirtySlot({ dirtyCount }: { dirtyCount: number }) {
  const id = useId();
  useReportSectionDirty(id, dirtyCount);
  const isHost = useIsGuardHost(id);
  if (!isHost) return null;
  return (
    <MissingWorkbenchDirtyBoundary>
      <AdvancedDirtyHost />
    </MissingWorkbenchDirtyBoundary>
  );
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return allowed.includes(value as T);
}

function contestOrNull(snapshot: AnyLegacySnapshot | null): ContestSnapshot | null {
  if (!snapshot || snapshot.kind !== 'contest') return null;
  return snapshot.value;
}

function sameContest(snapshot: ContestSnapshot, payload: TeachWorkbenchPayload): boolean {
  return snapshot.tid !== null && snapshot.tid === payload.container.id;
}

function SectionPending() {
  return <p className="text-sm text-fg-muted">正在加载…</p>;
}

function SectionRejected({ message }: { message: string }) {
  return <Alert tone="danger">{message}</Alert>;
}

function useSectionSave(
  payload: TeachWorkbenchPayload,
  dirtyCount: number,
  build: (form: FormData, latest: ContestSnapshot) => URLSearchParams,
  options?: { beforeSave?: () => void; onSaved?: () => void },
): SectionSave {
  const { save } = useLegacySnapshot();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const beforeSave = options?.beforeSave;
  const onSaved = options?.onSaved;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    beforeSave?.();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    void save((latest) => {
      const contest = contestOrNull(latest);
      if (!contest || !sameContest(contest, payload)) throw new Error('这份设置已经不是当前比赛，没有保存。');
      return build(form, contest);
    }).then(() => {
      toast.success('已保存');
      onSaved?.();
    }).catch((caught: unknown) => {
      console.error('teach contest section save failed', { id: payload.container.id, error: caught });
      setError(messageOf(caught, SECTION_SAVE_FAILED));
    }).finally(() => {
      savingRef.current = false;
      setSaving(false);
    });
  };

  return { saving, error, dirtyCount, onSubmit };
}

function SectionForm({
  save,
  children,
}: {
  save: SectionSave;
  children: ReactNode;
}) {
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={save.onSubmit}>
      {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
      {children}
      <div className="flex flex-wrap items-center gap-3">
        {save.dirtyCount > 0 ? (
          <p className="text-sm text-warning-fg" aria-live="polite">{save.dirtyCount} 项修改未保存</p>
        ) : null}
        <Button type="submit" variant="secondary" disabled={save.saving}>
          {save.saving ? '正在保存…' : SAVE_LABEL}
        </Button>
      </div>
      <AdvancedDirtySlot dirtyCount={save.dirtyCount} />
    </form>
  );
}

function readFlag(form: FormData, name: VigilFlag): boolean {
  if (!VIGIL_FLAGS.includes(name)) throw new TypeError(`teach_form_invalid:${name}`);
  const value = form.get(name);
  if (value == null) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} 的值无效。`);
}

function readText(form: FormData, name: (typeof VIGIL_FIELDS)[number], label: string): string {
  const value = form.get(name);
  if (typeof value !== 'string') throw new Error(`请填写${label}。`);
  return value;
}

function readCount(form: FormData, name: (typeof VIGIL_FIELDS)[number], min: number, label: string): number {
  const value = form.get(name);
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error(`${label}必须是整数。`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    throw new Error(min > 0 ? `${label}不能小于 ${min}。` : `${label}不能是负数。`);
  }
  return parsed;
}

function readVigilChoice<T extends string>(
  form: FormData,
  name: (typeof VIGIL_FIELDS)[number],
  allowed: readonly T[],
  label: string,
): T {
  const value = form.get(name);
  if (typeof value !== 'string' || !isOneOf(value, allowed)) throw new Error(`请选择${label}。`);
  return value;
}

/** Visible links only. Turning Vigil off must not wipe the draft; the save patch does that. */
function linkShown(draft: ContestVigilFields, participationMode: ContestFormState['participationMode']): ContestVigilFields {
  const next: ContestVigilFields = { ...draft };
  if (participationMode === 'team') {
    next.vigilEnabled = true;
    next.entryMode = 'client_required';
  } else if (next.entryMode === 'client_required') {
    if (!next.vigilEnabled) next.entryMode = 'open';
    next.vigilEnabled = true;
  } else if (!next.vigilEnabled) {
    next.entryMode = 'open';
  }
  if (!next.networkLockdownMode) next.networkLockdownFailurePolicy = 'off';
  else if (next.networkLockdownFailurePolicy === 'off') next.networkLockdownFailurePolicy = 'strict';
  if (next.recordEnabled && !next.liveEnabled) next.liveEnabled = true;
  return next;
}

function vigilFromForm(form: FormData, participationMode: ContestFormState['participationMode']): ContestVigilFields {
  const vigilEnabled = participationMode === 'team' ? true : readFlag(form, 'vigilEnabled');
  if (!vigilEnabled) return { ...VIGIL_WHEN_DISABLED };
  return linkShown({
    vigilEnabled: true,
    entryMode: readVigilChoice(form, 'entryMode', ENTRY_MODES, '进入模式'),
    approvalMode: readVigilChoice(form, 'approvalMode', APPROVAL_MODES, '审批模式'),
    lockdownMode: readFlag(form, 'lockdownMode'),
    networkLockdownMode: readFlag(form, 'networkLockdownMode'),
    networkLockdownFailurePolicy: readVigilChoice(form, 'networkLockdownFailurePolicy', FAILURE_POLICIES, '失败策略'),
    networkWhitelistHosts: readText(form, 'networkWhitelistHosts', '附加域名'),
    networkWhitelistIps: readText(form, 'networkWhitelistIps', '附加 IP'),
    networkWhitelistPorts: readText(form, 'networkWhitelistPorts', '附加端口'),
    pauseOnDisconnect: readFlag(form, 'pauseOnDisconnect'),
    screenshotIntervalMs: readCount(form, 'screenshotIntervalMs', 1000, '截图间隔'),
    exclusive: readFlag(form, 'exclusive'),
    clientLoginBlockBeforeMinutes: readCount(form, 'clientLoginBlockBeforeMinutes', 0, '封锁开始'),
    clientLoginBlockAfterMinutes: readCount(form, 'clientLoginBlockAfterMinutes', 0, '封锁结束'),
    liveEnabled: readFlag(form, 'liveEnabled'),
    recordEnabled: readFlag(form, 'recordEnabled'),
    cameraEnabled: readFlag(form, 'cameraEnabled'),
    screenshotJitterMs: readCount(form, 'screenshotJitterMs', 0, '截图抖动'),
    vigilProcessWhitelist: readText(form, 'vigilProcessWhitelist', '进程白名单'),
  }, participationMode);
}

function FlagSwitch({
  name,
  checked,
  disabled,
  onCheckedChange,
  children,
}: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      {disabled ? <input type="hidden" name={name} value={checked ? 'true' : 'false'} /> : null}
      <Switch
        name={disabled ? undefined : name}
        value="true"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
      {children}
    </label>
  );
}

function VigilResyncControl({ tid, domainId }: { tid: string; domainId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const run = () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const fallback = '请求失败';
    void (async () => {
      try {
        const response = await fetchHydroResponse(
          `/d/${encodeURIComponent(domainId)}/api/admin/vigilguard/resync/${encodeURIComponent(tid)}`,
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            },
            body: new URLSearchParams(),
          },
          fallback,
        );
        let payload: unknown;
        try {
          payload = await response.json();
        } catch (cause) {
          throw new Error(`${fallback}：响应不是有效 JSON`, { cause });
        }
        const record = isRecord(payload) ? payload : null;
        if (response.ok && record?.ok === true) {
          setMessage({
            tone: 'ok',
            text: record.vigilEnabled === true
              ? '已将当前已保存的比赛配置重新推送到 Vigil。'
              : '已请求 Vigil 删除本场比赛配置。',
          });
          return;
        }
        const errorText = typeof record?.error === 'string' && record.error.trim() ? record.error : fallback;
        throw new Error(errorText);
      } catch (error) {
        console.error('teach vigil resync failed', { tid, error });
        setMessage({
          tone: 'err',
          text: messageOf(error, fallback),
        });
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="space-y-2 rounded-md bg-surface-sunken p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-medium">重新同步到 Vigil</h3>
          <p className="text-xs text-fg-subtle">
            将已保存的比赛配置重新推送到 Vigil。未保存的修改不会包含在内。自动推送失败时，可以在不重新编辑比赛的情况下重试。
          </p>
        </div>
        <Button type="button" size="sm" variant="secondary" className="shrink-0" disabled={busy} onClick={run}>
          <RefreshCw />
          {busy ? '正在同步…' : '重新同步到 Vigil'}
        </Button>
      </div>
      {message?.tone === 'err' ? <Alert tone="danger">{message.text}</Alert> : null}
      {message?.tone === 'ok' ? <p className="text-xs text-success-fg">{message.text}</p> : null}
    </div>
  );
}

function VigilEntryForm({
  payload,
  snapshot,
  networkFieldMissing,
}: {
  payload: TeachWorkbenchPayload;
  snapshot: ContestSnapshot;
  networkFieldMissing: boolean;
}) {
  const bootstrap = useBootstrap();
  const participationMode = snapshot.state.participationMode;
  const team = participationMode === 'team';
  const [networkTouched, setNetworkTouched] = useState(!networkFieldMissing);
  const [baseline, setBaseline] = useState(() => linkShown(snapshot.state.vigil, participationMode));
  const [vigil, setVigil] = useState(baseline);
  const [counts, setCounts] = useState(() => ({
    screenshotIntervalMs: String(baseline.screenshotIntervalMs),
    screenshotJitterMs: String(baseline.screenshotJitterMs),
    clientLoginBlockBeforeMinutes: String(baseline.clientLoginBlockBeforeMinutes),
    clientLoginBlockAfterMinutes: String(baseline.clientLoginBlockAfterMinutes),
  }));
  const [lists, setLists] = useState(() => ({
    networkWhitelistHosts: baseline.networkWhitelistHosts,
    networkWhitelistIps: baseline.networkWhitelistIps,
    networkWhitelistPorts: baseline.networkWhitelistPorts,
    vigilProcessWhitelist: baseline.vigilProcessWhitelist,
  }));
  const update = (patch: Partial<ContestVigilFields>) => {
    setVigil((current) => linkShown({ ...current, ...patch }, participationMode));
  };
  const draft: ContestVigilFields = {
    ...vigil,
    screenshotIntervalMs: Number(counts.screenshotIntervalMs),
    screenshotJitterMs: Number(counts.screenshotJitterMs),
    clientLoginBlockBeforeMinutes: Number(counts.clientLoginBlockBeforeMinutes),
    clientLoginBlockAfterMinutes: Number(counts.clientLoginBlockAfterMinutes),
    ...lists,
  };
  const dirtyCount = countChangedKeys(baseline, {
    ...draft,
    screenshotIntervalMs: counts.screenshotIntervalMs === String(baseline.screenshotIntervalMs) ? baseline.screenshotIntervalMs : Number.NaN,
    screenshotJitterMs: counts.screenshotJitterMs === String(baseline.screenshotJitterMs) ? baseline.screenshotJitterMs : Number.NaN,
    clientLoginBlockBeforeMinutes: counts.clientLoginBlockBeforeMinutes === String(baseline.clientLoginBlockBeforeMinutes)
      ? baseline.clientLoginBlockBeforeMinutes
      : Number.NaN,
    clientLoginBlockAfterMinutes: counts.clientLoginBlockAfterMinutes === String(baseline.clientLoginBlockAfterMinutes)
      ? baseline.clientLoginBlockAfterMinutes
      : Number.NaN,
  }, VIGIL_FIELDS);
  const lastSeenSnapshot = useRef(snapshot);
  const snapshotVersion = useRef(0);
  if (lastSeenSnapshot.current !== snapshot) {
    lastSeenSnapshot.current = snapshot;
    snapshotVersion.current += 1;
  }
  const versionAtSaveStart = useRef(0);
  const awaitingOwnSave = useRef(false);
  const [adoptNonce, setAdoptNonce] = useState(0);
  const save = useSectionSave(payload, dirtyCount, (form, latest) => contestFormBody({
    ...latest.state,
    vigil: vigilFromForm(form, latest.state.participationMode),
  }), {
    beforeSave: () => {
      versionAtSaveStart.current = snapshotVersion.current;
    },
    onSaved: () => {
      awaitingOwnSave.current = true;
      setAdoptNonce((nonce) => nonce + 1);
    },
  });
  useEffect(() => {
    if (!awaitingOwnSave.current || snapshotVersion.current <= versionAtSaveStart.current) return;
    awaitingOwnSave.current = false;
    const next = linkShown(snapshot.state.vigil, snapshot.state.participationMode);
    setBaseline(next);
    setVigil(next);
    setCounts({
      screenshotIntervalMs: String(next.screenshotIntervalMs),
      screenshotJitterMs: String(next.screenshotJitterMs),
      clientLoginBlockBeforeMinutes: String(next.clientLoginBlockBeforeMinutes),
      clientLoginBlockAfterMinutes: String(next.clientLoginBlockAfterMinutes),
    });
    setLists({
      networkWhitelistHosts: next.networkWhitelistHosts,
      networkWhitelistIps: next.networkWhitelistIps,
      networkWhitelistPorts: next.networkWhitelistPorts,
      vigilProcessWhitelist: next.vigilProcessWhitelist,
    });
    setNetworkTouched(true);
  }, [adoptNonce, snapshot]);
  const showAdminResync = snapshot.tid !== null && isSystemAdmin(bootstrap.user.priv);

  return (
    <SectionForm save={save}>
      <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-line p-4">
        <span className="min-w-0 space-y-1">
          <span className="block text-sm font-medium leading-none">启用 Vigil 反作弊</span>
          <span className="block text-xs text-fg-subtle">开启后比赛的会话会被推送到 Vigil Server</span>
        </span>
        {team ? <input type="hidden" name="vigilEnabled" value="true" /> : null}
        <Switch
          name={team ? undefined : 'vigilEnabled'}
          value="true"
          checked={vigil.vigilEnabled}
          disabled={team}
          onCheckedChange={(checked) => update({ vigilEnabled: checked })}
        />
      </label>
      {showAdminResync && snapshot.tid ? <VigilResyncControl tid={snapshot.tid} domainId={bootstrap.domain.id} /> : null}
      {vigil.vigilEnabled ? (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <label className="text-sm font-medium">进入模式</label>
            <SimpleSelect
              name="entryMode"
              value={vigil.entryMode}
              disabled={team}
              onValueChange={(value) => {
                if (isOneOf(value, ENTRY_MODES)) update({ entryMode: value });
              }}
              options={[
                { value: 'open', label: '普通网页可进入（Vigil 可选）' },
                { value: 'client_required', label: '必须通过 Qt Client 进入' },
              ]}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <label className="text-sm font-medium">审批模式</label>
            <SimpleSelect
              name="approvalMode"
              value={vigil.approvalMode}
              onValueChange={(value) => {
                if (isOneOf(value, APPROVAL_MODES)) update({ approvalMode: value });
              }}
              options={[
                { value: 'auto', label: 'auto（已绑定且命中范围的学生自动通过）' },
                { value: 'strict', label: 'strict（全部进入老师审批）' },
              ]}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-4">
          <FlagSwitch
            name="lockdownMode"
            checked={vigil.lockdownMode}
            onCheckedChange={(checked) => update(networkTouched
              ? { lockdownMode: checked }
              : { lockdownMode: checked, networkLockdownMode: checked })}
          >
            启用客户端锁屏 / 热键拦截
          </FlagSwitch>
          <FlagSwitch name="pauseOnDisconnect" checked={vigil.pauseOnDisconnect} onCheckedChange={(checked) => update({ pauseOnDisconnect: checked })}>
            断线时暂停
          </FlagSwitch>
          <FlagSwitch name="exclusive" checked={vigil.exclusive} onCheckedChange={(checked) => update({ exclusive: checked })}>
            锁定当前比赛工作台（不显示比赛切换器）
          </FlagSwitch>
        </div>
        <div className="space-y-3 rounded-md bg-surface-sunken p-4">
          <h3 className="text-sm font-medium">实时媒体</h3>
          <p className="text-xs text-fg-subtle">
            推流到 SRS 媒体服务器；老师在反作弊详情页可看实时画面。<strong>失败不影响考试</strong>。
          </p>
          <div className="flex flex-wrap gap-4">
            <FlagSwitch name="liveEnabled" checked={vigil.liveEnabled} onCheckedChange={(checked) => update({ liveEnabled: checked })}>
              实时屏幕直播
            </FlagSwitch>
            <FlagSwitch name="cameraEnabled" checked={vigil.cameraEnabled} onCheckedChange={(checked) => update({ cameraEnabled: checked })}>
              摄像头直播（防替考）
            </FlagSwitch>
            <FlagSwitch name="recordEnabled" checked={vigil.recordEnabled} onCheckedChange={(checked) => update({ recordEnabled: checked })}>
              服务器录屏 mp4（存储压力大，默认关闭）
            </FlagSwitch>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <label className="text-sm font-medium" htmlFor="screenshotIntervalMs">截图间隔 (ms)</label>
            <Input
              id="screenshotIntervalMs"
              type="number"
              name="screenshotIntervalMs"
              min={1000}
              step={1000}
              value={counts.screenshotIntervalMs}
              onChange={(event) => setCounts((current) => ({ ...current, screenshotIntervalMs: event.target.value }))}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <label className="text-sm font-medium" htmlFor="screenshotJitterMs">截图抖动 (ms)</label>
            <Input
              id="screenshotJitterMs"
              type="number"
              name="screenshotJitterMs"
              min={0}
              step={1000}
              value={counts.screenshotJitterMs}
              onChange={(event) => setCounts((current) => ({ ...current, screenshotJitterMs: event.target.value }))}
            />
            <p className="text-2xs text-fg-subtle">实际 = 间隔 ± rand(0, 抖动)，防学生预判</p>
          </div>
          <div className="min-w-0 space-y-1.5">
            <label className="text-sm font-medium" htmlFor="clientLoginBlockBeforeMinutes">封锁开始（分钟）</label>
            <Input
              id="clientLoginBlockBeforeMinutes"
              type="number"
              name="clientLoginBlockBeforeMinutes"
              min={0}
              value={counts.clientLoginBlockBeforeMinutes}
              onChange={(event) => setCounts((current) => ({ ...current, clientLoginBlockBeforeMinutes: event.target.value }))}
            />
            <p className="text-2xs text-fg-subtle">比赛开始前 N 分钟开始拒绝普通网页登录</p>
          </div>
          <div className="min-w-0 space-y-1.5">
            <label className="text-sm font-medium" htmlFor="clientLoginBlockAfterMinutes">封锁结束（分钟）</label>
            <Input
              id="clientLoginBlockAfterMinutes"
              type="number"
              name="clientLoginBlockAfterMinutes"
              min={0}
              value={counts.clientLoginBlockAfterMinutes}
              onChange={(event) => setCounts((current) => ({ ...current, clientLoginBlockAfterMinutes: event.target.value }))}
            />
            <p className="text-2xs text-fg-subtle">比赛结束后 N 分钟解除拒绝</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="vigilProcessWhitelist">进程白名单（每行一个，加在服务器全局默认之上）</label>
          <Textarea
            id="vigilProcessWhitelist"
            name="vigilProcessWhitelist"
            value={lists.vigilProcessWhitelist}
            onChange={(event) => setLists((current) => ({ ...current, vigilProcessWhitelist: event.target.value }))}
            rows={5}
            className="font-mono"
            placeholder={'Code.exe\npython.exe\nmsedge.exe'}
          />
          <p className="text-2xs text-fg-subtle">
            不在白名单的进程启动会触发 <code>process_started_unauthorized</code> 事件
          </p>
        </div>
        <div className="space-y-4 rounded-md bg-surface-sunken p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <WifiOff className="size-4 shrink-0" />
                考试网络锁
              </h3>
              <p className="text-xs text-fg-subtle">
                进入考试 WebView 后，只允许访问默认白名单和下方附加白名单；系统层由客户端服务执行，WebView 内也会拦截非白名单 URL。
              </p>
            </div>
            <FlagSwitch
              name="networkLockdownMode"
              checked={vigil.networkLockdownMode}
              onCheckedChange={(checked) => {
                setNetworkTouched(true);
                update({ networkLockdownMode: checked });
              }}
            >
              启用网络锁
            </FlagSwitch>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <label className="text-sm font-medium">失败策略</label>
              <SimpleSelect
                name="networkLockdownFailurePolicy"
                value={vigil.networkLockdownFailurePolicy}
                onValueChange={(value) => {
                  if (isOneOf(value, FAILURE_POLICIES)) update({ networkLockdownFailurePolicy: value });
                }}
                options={[
                  { value: 'strict', label: 'strict：失败则不进入考试' },
                  { value: 'report_only', label: 'report_only：失败上报后放行' },
                  { value: 'off', label: 'off：不启用系统网络锁' },
                ]}
              />
            </div>
            <div className="min-w-0 rounded-md border border-line bg-surface p-3 text-xs text-fg-subtle">
              默认白名单会自动包含 OJ、Vigil Server、回环、DNS/DHCP 基础连接。下方只填写这场比赛额外允许的地址。
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <label className="text-sm font-medium" htmlFor="networkWhitelistHosts">附加域名 / Host</label>
              <Textarea
                id="networkWhitelistHosts"
                name="networkWhitelistHosts"
                value={lists.networkWhitelistHosts}
                onChange={(event) => setLists((current) => ({ ...current, networkWhitelistHosts: event.target.value }))}
                rows={4}
                className="font-mono"
                placeholder={'docs.school.edu.cn\n*.school.edu.cn'}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <label className="text-sm font-medium" htmlFor="networkWhitelistIps">附加 IP / CIDR</label>
              <Textarea
                id="networkWhitelistIps"
                name="networkWhitelistIps"
                value={lists.networkWhitelistIps}
                onChange={(event) => setLists((current) => ({ ...current, networkWhitelistIps: event.target.value }))}
                rows={4}
                className="font-mono"
                placeholder={'10.1.234.2\n10.1.0.0/16'}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <label className="text-sm font-medium" htmlFor="networkWhitelistPorts">附加端口</label>
              <Textarea
                id="networkWhitelistPorts"
                name="networkWhitelistPorts"
                value={lists.networkWhitelistPorts}
                onChange={(event) => setLists((current) => ({ ...current, networkWhitelistPorts: event.target.value }))}
                rows={4}
                className="font-mono"
                placeholder={'80\n443\n8765'}
              />
            </div>
          </div>
        </div>
      </div>
      ) : null}
    </SectionForm>
  );
}

function networkLockWasMissing(raw: unknown): boolean {
  if (!isRecord(raw) || !isRecord(raw.tdoc)) throw new TypeError('teach_payload_invalid:tdoc');
  const rawLock = raw.tdoc.networkLockdownMode;
  return rawLock === null || rawLock === undefined;
}

export function VigilEntrySection({ payload }: { payload: TeachWorkbenchPayload }): ReactElement {
  const legacy = useLegacySnapshot();
  const snapshot = legacy.status === 'ready' ? contestOrNull(legacy.snapshot) : null;
  const editable = snapshot !== null && sameContest(snapshot, payload);
  const [networkFieldMissing, setNetworkFieldMissing] = useState<boolean | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [probedTid, setProbedTid] = useState<string | null>(null);
  const tid = editable && snapshot ? snapshot.tid : null;

  useEffect(() => {
    if (tid === null || probedTid === tid) return undefined;
    let cancelled = false;
    const requestTid = tid;
    getJson(legacyEditPath(payload.container.type, requestTid), '机房监考设置没有加载出来。')
      .then((raw) => {
        if (cancelled) return;
        setNetworkFieldMissing(networkLockWasMissing(raw));
        setNetworkError(null);
        setProbedTid(requestTid);
      })
      .catch((caught: unknown) => {
        console.error('teach vigil network lock presence failed', { id: requestTid, error: caught });
        if (!cancelled) setNetworkError(messageOf(caught, '机房监考设置没有加载出来。'));
      });
    return () => {
      cancelled = true;
    };
  }, [payload.container.type, probedTid, tid]);

  if (legacy.status === 'loading') return <SectionPending />;
  if (legacy.status === 'error' || !legacy.snapshot) {
    return <SectionRejected message={legacy.error ?? '题目集设置没有加载出来。'} />;
  }
  if (!snapshot || !editable) return <SectionRejected message="这里只能编辑当前这场比赛。" />;
  if (probedTid !== null && probedTid !== snapshot.tid) return <SectionPending />;
  if (networkError && probedTid !== snapshot.tid) return <SectionRejected message={networkError} />;
  if (networkFieldMissing === null) {
    return networkError ? <SectionRejected message={networkError} /> : <SectionPending />;
  }
  return (
    <VigilEntryForm
      payload={payload}
      snapshot={snapshot}
      networkFieldMissing={networkFieldMissing}
    />
  );
}

function batchLabel(batch: ContestSnapshot['extras']['teamBatches'][number]): string {
  const state = batch.status === 'open' ? '开放' : '已关闭';
  return `${state} · ${batch.name} · ${batch.teamCount} 队 / ${batch.memberCount} 人`;
}

function readReadinessLevel(value: unknown, label: string): ReadinessLevel {
  if (value === 'pass' || value === 'warning' || value === 'block') return value;
  throw new TypeError(label);
}

function readReadiness(value: unknown): ReadinessReport {
  if (!isRecord(value)) throw new Error('赛前检查响应缺少报告。');
  const result = readReadinessLevel(value.result, '赛前检查响应的结果无效。');
  if (typeof value.teamCount !== 'number' || !Number.isSafeInteger(value.teamCount) || value.teamCount < 0) {
    throw new Error('赛前检查响应的队伍数无效。');
  }
  if (typeof value.memberCount !== 'number' || !Number.isSafeInteger(value.memberCount) || value.memberCount < 0) {
    throw new Error('赛前检查响应的人数无效。');
  }
  if (typeof value.canFinalize !== 'boolean' || typeof value.canStart !== 'boolean') {
    throw new TypeError('赛前检查响应的结论无效。');
  }
  if (value.snapshotHash != null && typeof value.snapshotHash !== 'string') throw new Error('赛前检查响应的快照摘要无效。');
  if (!Array.isArray(value.items)) throw new Error('赛前检查响应缺少明细。');
  const items = value.items.map((item, index) => {
    if (!isRecord(item)) throw new Error(`赛前检查第 ${index + 1} 条明细无效。`);
    const level = readReadinessLevel(item.level, `赛前检查第 ${index + 1} 条级别无效。`);
    if (typeof item.code !== 'string' || typeof item.title !== 'string' || typeof item.message !== 'string') {
      throw new TypeError(`赛前检查第 ${index + 1} 条内容无效。`);
    }
    return { level, code: item.code, title: item.title, message: item.message };
  });
  return {
    result,
    teamCount: value.teamCount,
    memberCount: value.memberCount,
    snapshotHash: typeof value.snapshotHash === 'string' ? value.snapshotHash : null,
    canFinalize: value.canFinalize,
    canStart: value.canStart,
    items,
  };
}

function readinessHeadline(report: ReadinessReport): string {
  if (report.result === 'block') return '存在阻断';
  if (report.canFinalize) return '可定版，尚不可开赛';
  if (report.canStart) return report.result === 'warning' ? '可以开赛，有提醒' : '可以开赛';
  return '尚不可开赛';
}

function PlannedTeamBatchForm({ payload, snapshot }: { payload: TeachWorkbenchPayload; snapshot: ContestSnapshot }) {
  const persisted = snapshot.state.plannedTeamBatchId ?? '';
  const finalized = snapshot.extras.teamBatchId ?? '';
  const canUpdatePlannedTeamBatch = snapshot.extras.canUpdatePlannedTeamBatch && finalized === '';
  const [selectedId, setSelectedId] = useState(persisted || finalized);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [teamReadiness, setTeamReadiness] = useState<ReadinessReport | null>(null);
  const [teamReadinessLoading, setTeamReadinessLoading] = useState(false);
  const [teamReadinessError, setTeamReadinessError] = useState('');
  const batches = snapshot.extras.teamBatches;
  const selected = batches.find((batch) => batch.batchId === selectedId) ?? null;
  const savedSelection = persisted || finalized;
  const dirtyCount = canUpdatePlannedTeamBatch && selectedId !== persisted ? 1 : 0;
  const canFinalizePlannedTeamBatch = snapshot.tid !== null
    && canUpdatePlannedTeamBatch
    && persisted !== ''
    && selectedId === persisted
    && selected?.status === 'closed';
  const save = useSectionSave(payload, dirtyCount, (form, latest) => {
    let plannedTeamBatchId = latest.state.plannedTeamBatchId;
    if (canUpdatePlannedTeamBatch) {
      const raw = form.get(TEAM_BATCH_FIELDS[0]);
      if (typeof raw !== 'string') throw new Error('赛前批次没有提交。');
      if (raw !== '' && !batches.some((batch) => batch.batchId === raw)) throw new Error('赛前批次不在可选列表里。');
      plannedTeamBatchId = raw;
    }
    return contestFormBody({ ...latest.state, plannedTeamBatchId });
  });

  const runTeamReadinessCheck = () => {
    if (teamReadinessLoading || snapshot.tid === null) return;
    setTeamReadinessLoading(true);
    setTeamReadinessError('');
    const path = legacyEditPath(payload.container.type, snapshot.tid);
    void postForm(path, new URLSearchParams({ operation: 'check_team_readiness' }), '赛前检查失败').then((payloadBody) => {
      if (payloadBody.ok !== true) {
        const message = typeof payloadBody.message === 'string' && payloadBody.message.trim()
          ? payloadBody.message
          : typeof payloadBody.error === 'string' && payloadBody.error.trim()
            ? payloadBody.error
            : '赛前检查响应缺少明确的成功标记';
        throw new Error(message);
      }
      setTeamReadiness(readReadiness(payloadBody.readiness));
    }).catch((error: unknown) => {
      console.error('teach team readiness check failed', { id: snapshot.tid, error });
      setTeamReadiness(null);
      setTeamReadinessError(messageOf(error, '赛前检查失败'));
    }).finally(() => {
      setTeamReadinessLoading(false);
    });
  };

  return (
    <>
      <SectionForm save={save}>
        <div className="space-y-2 rounded-lg bg-surface-sunken p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <label className="text-sm font-medium">赛前组队批次</label>
              <p className="mt-1 text-xs leading-5 text-fg-subtle">
                可选。开放批次只建立管理关联，组队仍可继续；关闭后再由管理员显式锁定阵容并生成本场独立快照。
              </p>
            </div>
            {finalized ? (
              <Badge variant="outline">已定版 · 不自动同步</Badge>
            ) : persisted ? (
              <Badge variant="outline" tone={selected?.status === 'closed' ? 'warning' : 'info'}>
                {selected?.status === 'closed' ? '已预绑定 · 待定版' : '已预绑定 · 开放组队中'}
              </Badge>
            ) : null}
          </div>
          <SimpleSelect
            name={canUpdatePlannedTeamBatch ? 'plannedTeamBatchId' : undefined}
            value={selectedId}
            onValueChange={setSelectedId}
            disabled={!canUpdatePlannedTeamBatch}
            options={[
              { value: '', label: '不预绑定批次（保持现有比赛内组队方式）' },
              ...batches.map((batch) => ({ value: batch.batchId, label: batchLabel(batch) })),
            ]}
          />
          {!canUpdatePlannedTeamBatch && persisted ? <input type="hidden" name="plannedTeamBatchId" value={persisted} /> : null}
          {selected ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-xs">
              <span className="text-fg-muted">
                当前批次：{selected.teamCount} 支队伍 · {selected.memberCount} 名成员 ·
                {selected.status === 'open' ? ' 仍可继续组队' : ' 阵容已冻结'}
              </span>
              {canFinalizePlannedTeamBatch ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => setFinalizeOpen(true)}>
                  <ClipboardCheck /> 锁定阵容并生成快照
                </Button>
              ) : null}
            </div>
          ) : null}
          {finalized ? (
            <p className="text-xs text-fg-subtle">本场运行时只读取已定版的 ContestTeam；后续批次变化不会同步到比赛。</p>
          ) : snapshot.extras.activeTeamCount > 0 ? (
            <p className="text-xs text-warning-fg">本场已经存在比赛内队伍，不能再更换或绑定赛前批次。</p>
          ) : selectedId ? (
            <p className="text-xs text-fg-subtle">预绑定不会创建临时队伍；定版时任一成员资格失败都会整批拒绝。</p>
          ) : (
            <p className="text-xs text-fg-subtle">也可以不使用批次，继续沿用比赛内直接组队。</p>
          )}
          <div className="mt-4 space-y-3 border-t border-line-subtle pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">赛前就绪检查</p>
                <p className="mt-1 text-xs leading-5 text-fg-subtle">
                  只读检查已保存配置；不会自动关批、定版或探测客户端安装。
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={teamReadinessLoading || selectedId !== savedSelection}
                onClick={runTeamReadinessCheck}
              >
                <RefreshCw />
                {teamReadiness ? '重新检查' : '运行检查'}
              </Button>
            </div>
            {selectedId !== savedSelection ? <p className="text-xs text-warning-fg">请先保存批次选择，再运行赛前检查。</p> : null}
            {teamReadinessError ? <Alert tone="danger">{teamReadinessError}</Alert> : null}
            {teamReadiness ? (
              <div className="space-y-3 rounded-lg border border-line bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      tone={teamReadiness.result === 'pass' ? 'success' : teamReadiness.result === 'warning' ? 'warning' : 'danger'}
                    >
                      {readinessHeadline(teamReadiness)}
                    </Badge>
                    <span className="text-xs tabular text-fg-subtle">
                      {teamReadiness.teamCount} 队 · {teamReadiness.memberCount} 人
                    </span>
                  </div>
                  {teamReadiness.canFinalize ? (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setFinalizeOpen(true)}>
                      <ClipboardCheck /> 锁定阵容并生成快照
                    </Button>
                  ) : null}
                </div>
                {teamReadiness.snapshotHash ? (
                  <p className="break-all font-mono text-2xs text-fg-subtle">snapshot {teamReadiness.snapshotHash}</p>
                ) : null}
                {(['block', 'warning', 'pass'] as const).map((level) => {
                  const levelItems = teamReadiness.items.filter((item) => item.level === level);
                  if (levelItems.length === 0) return null;
                  const LevelIcon = level === 'pass' ? CheckCircle2 : AlertTriangle;
                  const iconClass = level === 'pass' ? 'text-success-fg' : level === 'warning' ? 'text-warning-fg' : 'text-danger-fg';
                  return (
                    <div key={level} className="space-y-1.5">
                      {levelItems.map((item, index) => (
                        <div key={`${item.code}:${index}`} className="flex items-start gap-2 rounded-lg bg-surface-sunken px-3 py-2">
                          <LevelIcon className={`mt-0.5 size-4 shrink-0 ${iconClass}`} />
                          <div className="min-w-0">
                            <p className="text-xs font-medium">{item.title}</p>
                            <p className="mt-0.5 text-xs leading-5 text-fg-subtle">{item.message}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </SectionForm>
      <Dialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
        <TeamDialogContent
          titleId="finalize-team-batch-dialog-title"
          descriptionId="finalize-team-batch-dialog-description"
          title="锁定阵容并生成快照？"
          description="系统会重新校验整批成员，并为本场比赛生成一份不可自动同步的独立队伍快照。"
          icon={<ClipboardCheck />}
          onClose={() => setFinalizeOpen(false)}
          className="sm:max-w-lg"
        >
          <form method="post" action={legacyEditPath(payload.container.type, snapshot.tid)} className="flex min-h-0 flex-1 flex-col">
            <input type="hidden" name="operation" value="finalize_team_batch" />
            <input type="hidden" name="plannedTeamBatchId" value={persisted} />
            <TeamDialogBody>
              <div className="rounded-lg bg-surface-sunken p-4 ring-1 ring-line">
                <p className="text-sm font-semibold">{selected?.name || '当前预绑定批次'}</p>
                <p className="mt-1.5 text-sm leading-6 text-fg-muted">
                  {selected?.teamCount ?? 0} 支队伍 · {selected?.memberCount ?? 0} 名成员。定版成功后，批次仍可供其他比赛独立使用。
                </p>
              </div>
              <p className="text-sm leading-6 text-fg-muted">
                比赛开始、已有提交、已有比赛队伍或成员资格变化时，服务端会拒绝且不会留下半批队伍。
              </p>
            </TeamDialogBody>
            <TeamDialogFooter>
              <Button type="button" variant="secondary" onClick={() => setFinalizeOpen(false)} className={TEAM_DIALOG_BUTTON_CLASS}>
                取消
              </Button>
              <Button type="submit" variant="primary" className={TEAM_DIALOG_BUTTON_CLASS}>
                确认定版
              </Button>
            </TeamDialogFooter>
          </form>
        </TeamDialogContent>
      </Dialog>
    </>
  );
}

export function PlannedTeamBatchSection({ payload }: { payload: TeachWorkbenchPayload }): ReactElement | null {
  const legacy = useLegacySnapshot();
  if (legacy.status === 'loading') return <SectionPending />;
  if (legacy.status === 'error' || !legacy.snapshot) {
    return <SectionRejected message={legacy.error ?? '题目集设置没有加载出来。'} />;
  }
  const snapshot = contestOrNull(legacy.snapshot);
  if (!snapshot || !sameContest(snapshot, payload)) return <SectionRejected message="这里只能编辑当前这场比赛。" />;
  const acm = payload.container.type === 'acm' && payload.container.rule === 'acm' && snapshot.state.rule === 'acm';
  const allowed = acm && payload.capabilities.canManageTeamBatches && snapshot.extras.canManageTeamBatches && snapshot.state.participationMode === 'team';
  if (!allowed) return null;
  return <PlannedTeamBatchForm key={`${snapshot.state.plannedTeamBatchId ?? ''}:${snapshot.extras.teamBatchId ?? ''}`} payload={payload} snapshot={snapshot} />;
}

function readVerifiers(raw: unknown): number[] {
  if (!isRecord(raw) || !isRecord(raw.tdoc)) throw new TypeError('teach_payload_invalid:verifiers');
  const list = raw.tdoc.verifiers;
  if (list == null) return [];
  if (!Array.isArray(list)) throw new TypeError('teach_payload_invalid:verifiers');
  return list.map((item, index) => {
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item <= 0) {
      throw new TypeError(`teach_payload_invalid:verifiers[${index}]`);
    }
    return item;
  });
}

export function VerifierSection({ payload }: { payload: TeachWorkbenchPayload }): ReactElement {
  const legacy = useLegacySnapshot();
  const [verifiers, setVerifiers] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const snapshot = contestOrNull(legacy.snapshot);
  const tid = snapshot && sameContest(snapshot, payload) ? snapshot.tid : null;

  useEffect(() => {
    if (legacy.status !== 'ready' || tid === null) return undefined;
    let cancelled = false;
    setVerifiers(null);
    setError(null);
    getJson(legacyEditPath(payload.container.type, tid), '验证人没有加载出来。')
      .then((raw) => {
        if (!cancelled) setVerifiers(readVerifiers(raw));
      })
      .catch((caught: unknown) => {
        console.error('teach contest verifiers load failed', { id: tid, error: caught });
        if (!cancelled) setError(messageOf(caught, '验证人没有加载出来。'));
      });
    return () => {
      cancelled = true;
    };
  }, [legacy.status, payload.container.type, tid]);

  if (legacy.status === 'loading') return <SectionPending />;
  if (legacy.status === 'error' || !legacy.snapshot) {
    return <SectionRejected message={legacy.error ?? '题目集设置没有加载出来。'} />;
  }
  if (tid === null) return <SectionRejected message="这里只能编辑当前这场比赛。" />;
  if (error) return <SectionRejected message={error} />;
  if (verifiers === null) return <SectionPending />;

  return (
    <div className="space-y-3 rounded-md bg-surface-sunken p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">验比赛人</h3>
          <p className="mt-0.5 text-xs text-fg-subtle">邀请后将自动对所有比赛题目（含将来添加的）授权可见，比赛开始 / 删除时自动清理。</p>
        </div>
        <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => setOpen(true)}>
          邀请
        </Button>
      </div>
      {verifiers.length === 0 ? (
        <p className="text-xs text-fg-subtle">还没有验比赛人</p>
      ) : (
        <ul className="space-y-1">
          {verifiers.map((uid) => (
            <li key={uid} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">UID {uid}</span>
              <form
                method="post"
                action={`/contest/${tid}/verifiers/remove`}
                onSubmit={(event) => {
                  void confirmFormSubmit(event, `确定移除 UID ${uid}？该用户对所有比赛题目的查看权将被撤销。`, { destructive: true });
                }}
              >
                <input type="hidden" name={VERIFIER_FIELDS[0]} value={uid} />
                <Button type="submit" size="sm" variant="danger-soft">移除</Button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <DialogContent size="md" onClose={() => setOpen(false)}>
          <DialogHeader>
            <DialogTitle>邀请验比赛人</DialogTitle>
          </DialogHeader>
          <form method="post" action={`/contest/${tid}/verifiers`}>
            <DialogBody className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs text-fg-subtle" htmlFor="contest-verifier-uid">用户 UID</label>
                <Input id="contest-verifier-uid" name={VERIFIER_FIELDS[0]} type="number" min={2} required />
              </div>
              <input type="hidden" name={VERIFIER_FIELDS[1]} value="verifier" />
              <div className="space-y-1.5">
                <label className="text-xs text-fg-subtle" htmlFor="contest-verifier-note">附言（可选）</label>
                <Input id="contest-verifier-note" name={VERIFIER_FIELDS[2]} placeholder="例：帮忙验一下比赛 P1-P4" />
              </div>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>取消</Button>
              <Button type="submit" variant="primary">发送邀请</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function showsRating(rule: string): boolean {
  return RATING_RULES.has(rule);
}

function readLangs(form: FormData): string[] {
  const value = form.get('langs');
  if (typeof value !== 'string') throw new Error('允许语言没有提交。');
  return value.split(',').map((item) => item.trim()).filter((item) => item !== '');
}

function readOwnedFlag(form: FormData, name: (typeof OTHER_FIELDS)[number], label: string): boolean {
  const value = form.get(name);
  if (value == null) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${label}的值无效。`);
}

interface OtherDraft {
  rated: boolean;
  allowVirtual: boolean;
  allowPrint: boolean;
  autoHide: boolean;
  langs: string[];
}

function OtherContestForm({ payload, snapshot }: { payload: TeachWorkbenchPayload; snapshot: ContestSnapshot }) {
  const state = snapshot.state;
  const team = state.participationMode === 'team';
  const rating = showsRating(state.rule);
  const canAutoHide = snapshot.extras.canAutoHideProblems;
  const base: OtherDraft = {
    rated: team ? false : state.rated,
    allowVirtual: state.allowVirtual !== false,
    allowPrint: state.allowPrint,
    autoHide: state.autoHide,
    langs: state.langs,
  };
  const [draft, setDraft] = useState<OtherDraft>(base);
  const [langs, setLangs] = useState<LangOption[]>(() => resolveLangs(state.langs));
  const comparable: OtherDraft = { ...draft, langs: langs.map((item) => item.value) };
  const dirtyKeys = OTHER_FIELDS.filter((key) => {
    if (key === 'rated' || key === 'allowVirtual' || key === 'allowPrint') return rating;
    if (key === 'autoHide') return canAutoHide;
    return true;
  });
  const dirtyCount = countChangedKeys(base, comparable, dirtyKeys);
  const save = useSectionSave(payload, dirtyCount, (form, latest) => {
    const patch: Partial<ContestFormState> = { langs: readLangs(form) };
    if (showsRating(latest.state.rule)) {
      patch.rated = latest.state.participationMode === 'team' ? false : readOwnedFlag(form, 'rated', '计入 Rating');
      patch.allowPrint = readOwnedFlag(form, 'allowPrint', '允许打印');
      const virtual = readOwnedFlag(form, 'allowVirtual', '允许赛后虚拟参赛');
      patch.allowVirtual = latest.state.allowVirtual === null && virtual ? null : virtual;
    }
    if (latest.extras.canAutoHideProblems) patch.autoHide = readOwnedFlag(form, 'autoHide', '自动隐藏题目');
    return contestFormBody({ ...latest.state, ...patch });
  });

  return (
    <SectionForm save={save}>
      {rating || canAutoHide ? (
        <div className="flex flex-wrap gap-4">
          {rating ? (
            <FlagSwitch
              name="rated"
              checked={team ? false : draft.rated}
              disabled={team}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, rated: checked }))}
            >
              计入 Rating
            </FlagSwitch>
          ) : null}
          {canAutoHide ? (
            <FlagSwitch
              name="autoHide"
              checked={draft.autoHide}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, autoHide: checked }))}
            >
              比赛中自动隐藏题目（赛后自动公开）
            </FlagSwitch>
          ) : null}
          {rating ? (
            <FlagSwitch
              name="allowPrint"
              checked={draft.allowPrint}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, allowPrint: checked }))}
            >
              允许打印
            </FlagSwitch>
          ) : null}
          {rating ? (
            <FlagSwitch
              name="allowVirtual"
              checked={draft.allowVirtual}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, allowVirtual: checked }))}
            >
              允许赛后虚拟参赛
            </FlagSwitch>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">允许语言（留空为全部）</label>
        <MultiSelect<LangOption>
          options={COMMON_LANG_OPTIONS}
          value={langs}
          onChange={setLangs}
          getKey={(option) => option.value}
          getLabel={(option) => `${option.label} (${option.value})`}
          renderChip={(option) => <span className="font-mono">{option.label}</span>}
          renderOption={(option) => (
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium">{option.label}</span>
              <span className="shrink-0 font-mono text-2xs text-fg-subtle">{option.value}</span>
            </div>
          )}
          name="langs"
          placeholder="留空 = 全部"
        />
      </div>
    </SectionForm>
  );
}

export function OtherContestSettingsSection({ payload }: { payload: TeachWorkbenchPayload }): ReactElement {
  const legacy = useLegacySnapshot();
  if (legacy.status === 'loading') return <SectionPending />;
  if (legacy.status === 'error' || !legacy.snapshot) {
    return <SectionRejected message={legacy.error ?? '题目集设置没有加载出来。'} />;
  }
  const snapshot = contestOrNull(legacy.snapshot);
  if (!snapshot || !sameContest(snapshot, payload)) return <SectionRejected message="这里只能编辑当前这场比赛。" />;
  const key = JSON.stringify({
    rule: snapshot.state.rule,
    rated: snapshot.state.rated,
    allowVirtual: snapshot.state.allowVirtual,
    allowPrint: snapshot.state.allowPrint,
    autoHide: snapshot.state.autoHide,
    langs: snapshot.state.langs,
    team: snapshot.state.participationMode,
  });
  return <OtherContestForm key={key} payload={payload} snapshot={snapshot} />;
}
