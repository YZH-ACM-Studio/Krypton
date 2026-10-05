import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleDot, Clock3, Code2, Loader2, Send, Users } from 'lucide-react';
import { KryptonIDE } from '@/components/krypton-ide';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { TEAM_DIALOG_BUTTON_CLASS, TeamDialogBody, TeamDialogContent, TeamDialogFooter } from '@/components/team-dialog';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { formatDateTime } from '@/lib/format';
import { createLatestRequestGate } from '@/lib/latest-request';

export interface TeamCodeUser {
  uid: number;
  uname: string;
  displayName: string;
}

export interface TeamCodeTarget extends TeamCodeUser {
  online: boolean | null;
}

export interface TeamCodeSnapshotSummary {
  snapshotId: string;
  teamId: string;
  target: TeamCodeUser;
  sender: TeamCodeUser;
  problemId: number;
  pid: string;
  title: string;
  language: string;
  clientVersion: string;
  sequence: number;
  createdAt: string;
  openedAt: string | null;
  state: 'pending' | 'saved' | 'opened';
}

export interface TeamCodeSnapshotDetail extends TeamCodeSnapshotSummary {
  code: string;
}

interface TeamCodeListPayload {
  snapshots: TeamCodeSnapshotSummary[];
  targets: TeamCodeTarget[];
  presenceError: string | null;
  capabilities: { canSend: boolean; canRead: boolean };
}

export interface TeamCodeBuffer {
  language: string;
  code: string;
}

/** Thrown values surfaced to the user (Error / DOMException from fetch). */
interface ErrorLike {
  name?: string;
  message?: string;
}

async function requestJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchHydroResponse(url, {
    ...init,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(init?.headers || {}) },
  });
  if (response.status === 409) {
    window.location.reload();
    throw new Error('队伍状态已变化，正在刷新。');
  }
  if (!response.ok) throw new Error(await readHydroResponseError(response, '队伍代码操作失败'));
  const payload = (await response.json().catch(() => {
    throw new Error('服务器返回了无法解析的响应。');
  })) as { page?: { data?: T } };
  return (payload?.page?.data || payload) as T;
}

function snapshotUrl(endpoint: string, snapshotId: string): string {
  const separator = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${separator}snapshotId=${encodeURIComponent(snapshotId)}`;
}

function stateLabel(state: TeamCodeSnapshotSummary['state']) {
  if (state === 'opened') return { label: '已查看', icon: CheckCircle2, className: 'text-success-fg' };
  if (state === 'saved') return { label: '已送达', icon: CircleDot, className: 'text-info-fg' };
  return { label: '已保存 · 待取', icon: Clock3, className: 'text-warning-fg' };
}

export function TeamCodeSendDialog({
  open,
  onOpenChange,
  endpoint,
  problemId,
  buffer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endpoint: string;
  problemId: number;
  buffer: TeamCodeBuffer | null;
}) {
  const [targets, setTargets] = useState<TeamCodeTarget[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [presenceError, setPresenceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setSelected(new Set());
    setLoading(true);
    setError(null);
    void requestJson<TeamCodeListPayload>(endpoint, { signal: controller.signal })
      .then((payload: TeamCodeListPayload) => {
        setTargets(Array.isArray(payload.targets) ? payload.targets : []);
        setPresenceError(payload.presenceError || null);
      })
      .catch((caught: ErrorLike | null) => {
        if (caught?.name !== 'AbortError') setError(caught?.message || '无法读取当前队员。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [endpoint, open]);

  const codeBytes = useMemo(() => new TextEncoder().encode(buffer?.code || '').byteLength, [buffer?.code]);
  const submit = async () => {
    if (sending) return;
    if (selected.size > 2) {
      setError('一次可发送给一名或两名当前队员。');
      return;
    }
    if (!buffer || !buffer.code || !buffer.language || selected.size < 1) return;
    setSending(true);
    setError(null);
    const form = new FormData();
    form.append('operation', 'send');
    form.append('problemId', String(problemId));
    form.append('targetUids', [...selected].sort((a, b) => a - b).join(','));
    form.append('language', buffer.language);
    form.append('code', buffer.code);
    try {
      const payload = await requestJson<{ notificationFailures?: unknown[] }>(endpoint, { method: 'POST', body: form });
      const failures = Array.isArray(payload.notificationFailures) ? payload.notificationFailures.length : 0;
      toast.success('代码快照已保存', {
        description: failures
          ? `${failures} 个网页唤醒通知发送失败；快照仍可由队员稍后读取。`
          : `已保存给 ${selected.size} 名队员；在线页面会自动打开，离线时可稍后读取。`,
      });
      onOpenChange(false);
    } catch (caught) {
      setError((caught as ErrorLike | null)?.message || '代码快照发送失败。');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <TeamDialogContent
        titleId="send-team-code-dialog-title"
        descriptionId="send-team-code-dialog-description"
        title="发送当前代码给队友"
        description="保存编辑器此刻的未提交内容，一次可发送给一名或两名当前队员。"
        icon={<Send className="size-5" />}
        onClose={() => onOpenChange(false)}
      >
        <TeamDialogBody>
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface-sunken p-4 text-xs">
            <div className="min-w-0">
              <p className="text-fg-subtle">语言</p>
              <p className="mt-1 truncate font-mono font-medium text-fg">{buffer?.language || '—'}</p>
            </div>
            <div className="min-w-0">
              <p className="text-fg-subtle">快照大小</p>
              <p className="mt-1 font-mono font-medium text-fg tabular">{codeBytes.toLocaleString()} bytes</p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Users className="size-4 shrink-0" />
              选择接收者
            </p>
            {loading ? (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-line bg-surface-sunken py-8 text-sm text-fg-muted">
                <Loader2 className="size-4 shrink-0 animate-spin text-fg-subtle" />
                读取当前队伍
              </div>
            ) : targets.length ? (
              <div className="space-y-2">
                {targets.map((target) => {
                  const checked = selected.has(target.uid);
                  return (
                    <label
                      key={target.uid}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors motion-reduce:transition-none',
                        checked ? 'border-brand bg-brand-soft' : 'border-line bg-surface-sunken hover:bg-surface-hover',
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) =>
                          setSelected((current) => {
                            const copy = new Set(current);
                            if (next) copy.add(target.uid);
                            else copy.delete(target.uid);
                            return copy;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{target.displayName || target.uname}</span>
                        <span className="block truncate text-xs text-fg-subtle">
                          {target.uname} · UID {target.uid}
                        </span>
                      </span>
                      <Badge variant="soft" tone={target.online === true ? 'success' : 'neutral'} dot className="shrink-0">
                        {target.online === true ? '在线' : target.online === false ? '离线' : '未知'}
                      </Badge>
                    </label>
                  );
                })}
              </div>
            ) : (
              <EmptyState compact icon={<Users />} title="当前没有可接收代码的队员。" />
            )}
            {selected.size > 2 ? <p className="text-xs text-warning-fg">一次可发送给一名或两名当前队员。</p> : null}
            {presenceError ? <p className="text-xs text-warning-fg">在线状态暂不可用，但不会阻止保存离线快照。</p> : null}
          </div>

          {error ? <Alert tone="danger">{error}</Alert> : null}
        </TeamDialogBody>
        <TeamDialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={sending} className={TEAM_DIALOG_BUTTON_CLASS}>
            取消
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => void submit()}
            disabled={sending || loading || selected.size < 1 || selected.size > 2 || !buffer?.code}
            className={TEAM_DIALOG_BUTTON_CLASS}
          >
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
            保存并发送
          </Button>
        </TeamDialogFooter>
      </TeamDialogContent>
    </Dialog>
  );
}

export function TeamCodeSnapshotDrawer({
  open,
  onOpenChange,
  endpoint,
  locale,
  preferredSnapshotId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endpoint: string;
  locale: string;
  preferredSnapshotId?: string | null;
}) {
  const [snapshots, setSnapshots] = useState<TeamCodeSnapshotSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeamCodeSnapshotDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detailRequestGate = useRef(createLatestRequestGate());
  const detailAbortController = useRef<AbortController | null>(null);

  const loadDetail = useCallback(
    async (snapshotId: string) => {
      detailAbortController.current?.abort();
      const controller = new AbortController();
      detailAbortController.current = controller;
      const generation = detailRequestGate.current.begin();
      setSelectedId(snapshotId);
      setDetailLoading(true);
      setError(null);
      try {
        const payload = await requestJson<{ snapshot: TeamCodeSnapshotDetail }>(snapshotUrl(endpoint, snapshotId), { signal: controller.signal });
        if (!detailRequestGate.current.isCurrent(generation)) return;
        const next = payload.snapshot;
        setDetail(next);
        setSnapshots((current) =>
          current.map((snapshot) => (snapshot.snapshotId === snapshotId ? { ...snapshot, state: next.state, openedAt: next.openedAt } : snapshot)),
        );
      } catch (caught) {
        if ((caught as ErrorLike | null)?.name !== 'AbortError' && detailRequestGate.current.isCurrent(generation)) {
          setError((caught as ErrorLike | null)?.message || '无法读取代码快照。');
        }
      } finally {
        if (detailRequestGate.current.isCurrent(generation)) setDetailLoading(false);
        if (detailAbortController.current === controller) detailAbortController.current = null;
      }
    },
    [endpoint],
  );

  useEffect(() => {
    if (!open) {
      detailAbortController.current?.abort();
      detailAbortController.current = null;
      detailRequestGate.current.invalidate();
      setDetailLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void requestJson<TeamCodeListPayload>(endpoint, { signal: controller.signal })
      .then(async (payload: TeamCodeListPayload) => {
        const next = Array.isArray(payload.snapshots) ? payload.snapshots : [];
        setSnapshots(next);
        const preferred = preferredSnapshotId && next.some((snapshot) => snapshot.snapshotId === preferredSnapshotId) ? preferredSnapshotId : null;
        const nextId = preferred || next[0]?.snapshotId;
        if (nextId) await loadDetail(nextId);
        else {
          setSelectedId(null);
          setDetail(null);
          setDetailLoading(false);
        }
      })
      .catch((caught: ErrorLike | null) => {
        if (caught?.name !== 'AbortError') {
          setDetailLoading(false);
          setError(caught?.message || '无法读取代码快照列表。');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      detailAbortController.current?.abort();
      detailAbortController.current = null;
      detailRequestGate.current.invalidate();
    };
  }, [endpoint, loadDetail, open, preferredSnapshotId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-5xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Code2 className="size-4 shrink-0 text-brand-fg" />
            队伍代码快照
          </SheetTitle>
          <p className="mt-1 text-xs text-pretty text-fg-subtle">最近的定向代码版本保存在 OJ；这里只读展示，不提供运行、提交或下载。</p>
        </SheetHeader>
        {/* ds-allow DS004: 快照列表固定 19rem，右侧代码占剩余宽度，间距档写不出这条分栏 */}
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,40%)_minmax(0,1fr)] overflow-hidden md:grid-cols-[19rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]">
          <ScrollArea className="h-full min-h-0 min-w-0 border-b border-line bg-surface-sunken md:border-r md:border-b-0" viewportClassName="overscroll-contain">
            <div className="p-3">
              {loading && snapshots.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-fg-muted">
                  <Loader2 className="size-4 shrink-0 animate-spin text-fg-subtle" />
                  加载快照
                </div>
              ) : snapshots.length ? (
                <div className="space-y-2">
                  {snapshots.map((snapshot) => {
                    const state = stateLabel(snapshot.state);
                    const StateIcon = state.icon;
                    return (
                      // ds-allow DS005: 快照行是两行列表命中区，标准 Button 的固定高度装不下题号、队员和状态
                      <button
                        key={snapshot.snapshotId}
                        type="button"
                        onClick={() => void loadDetail(snapshot.snapshotId)}
                        className={cn(
                          'w-full min-w-0 rounded-lg border p-3 text-left transition-colors outline-none motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                          selectedId === snapshot.snapshotId ? 'border-brand bg-brand-soft' : 'border-line bg-bg hover:bg-surface-hover',
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {snapshot.pid} · {snapshot.title}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-fg-subtle">
                              #{snapshot.sequence} · {snapshot.sender.displayName} → {snapshot.target.displayName}
                            </span>
                          </span>
                          <span className={cn('flex shrink-0 items-center gap-1 text-2xs', state.className)}>
                            <StateIcon className="size-3" />
                            {state.label}
                          </span>
                        </div>
                        <p className="mt-2 text-2xs text-fg-subtle">
                          {formatDateTime(snapshot.createdAt, locale)} · {snapshot.language}
                        </p>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EmptyState compact icon={<Code2 />} title="还没有代码快照。" />
              )}
            </div>
          </ScrollArea>

          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            {detail ? (
              <>
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-xs">
                  <span className="min-w-0 font-medium">
                    {detail.pid} · {detail.title}
                  </span>
                  <Badge variant="outline" className="shrink-0">版本 #{detail.sequence}</Badge>
                  <span className="min-w-0 text-fg-subtle">
                    {detail.sender.displayName} → {detail.target.displayName}
                  </span>
                  <div className="min-w-2 flex-1" />
                  {detailLoading ? <Loader2 className="size-3.5 shrink-0 animate-spin text-fg-subtle" /> : null}
                </div>
                <KryptonIDE
                  mode="readonly"
                  teamReadOnlyView
                  langs={[]}
                  defaultLang={detail.language}
                  value={detail.code}
                  minHeight={0}
                  className="min-h-0 flex-1 rounded-none border-0"
                />
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-fg-muted">
                {detailLoading ? '正在读取快照…' : '从左侧选择一个代码快照。'}
              </div>
            )}
            {error ? <Alert tone="danger" className="shrink-0 rounded-none border-x-0 border-b-0">{error}</Alert> : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
