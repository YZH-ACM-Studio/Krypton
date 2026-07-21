import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleDot, Clock3, Code2, Loader2, Send, Users } from 'lucide-react';
import { KryptonIDE } from '@/components/krypton-ide';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
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

function responseMessage(payload: any, status: number): string {
  const message = payload?.message || payload?.error?.message || payload?.error || payload?.detail;
  return typeof message === 'string' && message.trim() ? message.trim() : `HTTP ${status}`;
}

async function requestJson(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(init?.headers || {}) },
  });
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    throw new Error('服务器返回了无法解析的响应。');
  }
  if (response.status === 409) {
    window.location.reload();
    throw new Error('队伍状态已变化，正在刷新。');
  }
  if (!response.ok) throw new Error(responseMessage(payload, response.status));
  return payload?.page?.data || payload;
}

function snapshotUrl(endpoint: string, snapshotId: string): string {
  const separator = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${separator}snapshotId=${encodeURIComponent(snapshotId)}`;
}

function stateLabel(state: TeamCodeSnapshotSummary['state']) {
  if (state === 'opened') return { label: '已查看', icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-300' };
  if (state === 'saved') return { label: '已送达', icon: CircleDot, className: 'text-sky-600 dark:text-sky-300' };
  return { label: '已保存 · 待取', icon: Clock3, className: 'text-amber-600 dark:text-amber-300' };
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
    void requestJson(endpoint, { signal: controller.signal })
      .then((payload: TeamCodeListPayload) => {
        setTargets(Array.isArray(payload.targets) ? payload.targets : []);
        setPresenceError(payload.presenceError || null);
      })
      .catch((caught: any) => {
        if (caught?.name !== 'AbortError') setError(caught?.message || '无法读取当前队员。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [endpoint, open]);

  const codeBytes = useMemo(() => new TextEncoder().encode(buffer?.code || '').byteLength, [buffer?.code]);
  const submit = async () => {
    if (!buffer || !buffer.code || !buffer.language || selected.size < 1 || selected.size > 2 || sending) return;
    setSending(true);
    setError(null);
    const form = new FormData();
    form.append('operation', 'send');
    form.append('problemId', String(problemId));
    form.append('targetUids', [...selected].sort((a, b) => a - b).join(','));
    form.append('language', buffer.language);
    form.append('code', buffer.code);
    try {
      const payload = await requestJson(endpoint, { method: 'POST', body: form });
      const failures = Array.isArray(payload.notificationFailures) ? payload.notificationFailures.length : 0;
      toast.success('代码快照已保存', {
        description: failures
          ? `${failures} 个网页唤醒通知发送失败；快照仍可由队员稍后读取。`
          : `已保存给 ${selected.size} 名队员；在线页面会自动打开，离线时可稍后读取。`,
      });
      onOpenChange(false);
    } catch (caught: any) {
      setError(caught?.message || '代码快照发送失败。');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(34rem,calc(100vw-1.5rem))]" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="size-4 text-primary" />
            发送当前代码给队友
          </DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">发送的是编辑器此刻的未提交内容；一次可选择一名或两名当前队员。</p>
        </DialogHeader>
        <DialogBody className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/20 p-3 text-xs">
            <div>
              <p className="text-muted-foreground">语言</p>
              <p className="mt-1 font-mono font-medium">{buffer?.language || '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">快照大小</p>
              <p className="mt-1 font-mono font-medium">{codeBytes.toLocaleString()} bytes</p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Users className="size-4" />
              选择接收者
            </p>
            {loading ? (
              <div className="flex items-center justify-center gap-2 rounded-xl border py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />读取当前队伍
              </div>
            ) : targets.length ? (
              <div className="space-y-2">
                {targets.map((target) => {
                  const checked = selected.has(target.uid);
                  return (
                    <label
                      key={target.uid}
                      className={cn(
                        'group flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors',
                        checked ? 'border-primary/50 bg-primary/5' : 'hover:bg-muted/40',
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
                        <span className="block truncate text-xs text-muted-foreground">{target.uname} · UID {target.uid}</span>
                      </span>
                      <Badge variant="outline" className={cn('gap-1', target.online === true && 'border-emerald-500/40 text-emerald-600')}>
                        <span className={cn('size-1.5 rounded-full bg-muted-foreground', target.online === true && 'bg-emerald-500')} />
                        {target.online === true ? '在线' : target.online === false ? '离线' : '未知'}
                      </Badge>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">当前没有可接收代码的队员。</div>
            )}
            {presenceError ? <p className="text-xs text-amber-600 dark:text-amber-300">在线状态暂不可用，但不会阻止保存离线快照。</p> : null}
          </div>

          {error ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}
        </DialogBody>
        <div className="flex shrink-0 justify-end gap-2 border-t px-5 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>取消</Button>
          <Button type="button" onClick={() => void submit()} disabled={sending || loading || selected.size < 1 || !buffer?.code}>
            {sending ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Send className="mr-1 size-4" />}
            保存并发送
          </Button>
        </div>
      </DialogContent>
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
        const payload = await requestJson(snapshotUrl(endpoint, snapshotId), { signal: controller.signal });
        if (!detailRequestGate.current.isCurrent(generation)) return;
        const next = payload.snapshot as TeamCodeSnapshotDetail;
        setDetail(next);
        setSnapshots((current) =>
          current.map((snapshot) =>
            snapshot.snapshotId === snapshotId ? { ...snapshot, state: next.state, openedAt: next.openedAt } : snapshot,
          ),
        );
      } catch (caught: any) {
        if (caught?.name !== 'AbortError' && detailRequestGate.current.isCurrent(generation)) {
          setError(caught?.message || '无法读取代码快照。');
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
    void requestJson(endpoint, { signal: controller.signal })
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
      .catch((caught: any) => {
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
      <SheetContent side="right" className="w-[min(60rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] p-0 sm:max-w-[min(60rem,calc(100vw-2rem))]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Code2 className="size-4 text-primary" />
            队伍代码快照
          </SheetTitle>
          <p className="mt-1 text-xs text-muted-foreground">最近的定向代码版本保存在 OJ；这里只读展示，不提供运行、提交或下载。</p>
        </SheetHeader>
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[19rem_minmax(0,1fr)]">
          <div className="min-h-0 overflow-y-auto border-b bg-muted/15 p-3 md:border-b-0 md:border-r">
            {loading && snapshots.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />加载快照</div>
            ) : snapshots.length ? (
              <div className="space-y-2">
                {snapshots.map((snapshot) => {
                  const state = stateLabel(snapshot.state);
                  const StateIcon = state.icon;
                  return (
                    <button
                      key={snapshot.snapshotId}
                      type="button"
                      onClick={() => void loadDetail(snapshot.snapshotId)}
                      className={cn(
                        'w-full rounded-xl border p-3 text-left transition-colors',
                        selectedId === snapshot.snapshotId ? 'border-primary/50 bg-primary/5' : 'bg-background hover:bg-muted/40',
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{snapshot.pid} · {snapshot.title}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            #{snapshot.sequence} · {snapshot.sender.displayName} → {snapshot.target.displayName}
                          </span>
                        </span>
                        <span className={cn('flex shrink-0 items-center gap-1 text-[11px]', state.className)}>
                          <StateIcon className="size-3" />{state.label}
                        </span>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">{formatDateTime(snapshot.createdAt, locale)} · {snapshot.language}</p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">还没有代码快照。</div>
            )}
          </div>

          <div className="flex min-h-[18rem] min-w-0 flex-col overflow-hidden">
            {detail ? (
              <>
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3 text-xs">
                  <span className="font-medium">{detail.pid} · {detail.title}</span>
                  <Badge variant="outline">版本 #{detail.sequence}</Badge>
                  <span className="text-muted-foreground">{detail.sender.displayName} → {detail.target.displayName}</span>
                  <div className="flex-1" />
                  {detailLoading ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
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
              <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                {detailLoading ? '正在读取快照…' : '从左侧选择一个代码快照。'}
              </div>
            )}
            {error ? <div role="alert" className="shrink-0 border-t border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div> : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
