/**
 * /collect (student) — file collection list + submit detail.
 *
 * Pages register in PAGE_MAP (see ../resolver.tsx) via:
 *   - collect_main.html    → CollectListPage
 *   - collect_detail.html  → CollectDetailPage
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  FolderUp,
  Hourglass,
  Loader2,
  Trash2,
} from 'lucide-react';
import { FileUploader } from '@/components/uploader';
import { MarkdownView } from '@/components/markdown-renderer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateTime } from '@/components/ui/datetime';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { cn } from '@/lib/cn';
import { useBootstrap } from '@/lib/bootstrap';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import {
  acceptFromSlot,
  COLLECT_MAX_FILE_BYTES,
  collectDueMs,
  collectFileHref,
  isCollectWindowClosed,
  parseCollectDetailPayload,
  parseCollectListPayload,
  type CollectCurrentFileView,
  type CollectHistoryFileView,
  type CollectListItem,
  type CollectSlotView,
} from './types';

type CollectListTab = 'pending' | 'submitted' | 'closed';
type CountdownTone = 'info' | 'warning' | 'danger' | 'muted';

function useLiveNow(enabled = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}

function formatCountdown(totalMs: number): string {
  const ms = Math.max(0, totalMs);
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) return `${days}天 ${pad(hours)}:${pad(minutes)}`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function actionErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function PayloadError({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <AlertTriangle className="mx-auto size-12 text-destructive/50" />
        <p role="alert" className="mt-3 text-sm text-destructive">
          页面数据无效：{message}
        </p>
      </CardContent>
    </Card>
  );
}

function SubmitStatusBadge({ submitted }: { submitted: boolean }) {
  if (submitted) {
    return (
      <Badge variant="default" className="gap-1 bg-emerald-500 text-white hover:bg-emerald-500/90">
        <CheckCircle2 className="size-3" />
        已交文件
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      <Hourglass className="size-3" />
      未交文件
    </Badge>
  );
}

function collectCountdownNotice(
  dueAtMs: number,
  now: number,
  closed: boolean,
  alwaysShowRemaining: boolean,
): { label: string; target?: number; tone: CountdownTone } | null {
  if (closed || now >= dueAtMs) return { label: '收集已截止', tone: 'muted' };
  const remaining = dueAtMs - now;
  const day = 24 * 60 * 60 * 1000;
  if (remaining <= day) return { label: '即将截止', target: dueAtMs, tone: 'danger' };
  if (remaining <= 3 * day) return { label: '截止倒计时', target: dueAtMs, tone: 'warning' };
  if (alwaysShowRemaining || remaining <= 7 * day) return { label: '截止倒计时', target: dueAtMs, tone: 'info' };
  return null;
}

function CollectCountdownNotice({
  dueAtMs,
  now,
  closed,
  alwaysShowRemaining = false,
}: {
  dueAtMs: number;
  now: number;
  closed: boolean;
  alwaysShowRemaining?: boolean;
}) {
  const notice = collectCountdownNotice(dueAtMs, now, closed, alwaysShowRemaining);
  if (!notice) return null;
  const toneClass: Record<CountdownTone, string> = {
    info: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
    danger: 'border-destructive/30 bg-destructive/10 text-destructive',
    muted: 'border-border bg-muted/60 text-muted-foreground',
  };
  return (
    <div className={cn('mt-2 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium', toneClass[notice.tone])}>
      {notice.tone === 'danger' || notice.tone === 'warning' ? (
        <AlertTriangle className="size-3.5 shrink-0" />
      ) : (
        <Clock className="size-3.5 shrink-0" />
      )}
      <span>{notice.label}</span>
      {notice.target ? <span className="ml-auto font-mono tabular-nums">{formatCountdown(notice.target - now)}</span> : null}
    </div>
  );
}

function classifyListItem(item: CollectListItem, now: number): CollectListTab {
  const dueAtMs = collectDueMs(item.dueAt);
  if (item.submitted) return 'submitted';
  if (dueAtMs === null || isCollectWindowClosed(item.status, dueAtMs, now)) return 'closed';
  return 'pending';
}

function filesForSlot(files: CollectCurrentFileView[], slotId: string): CollectCurrentFileView[] {
  return files.filter((file) => file.slotId === slotId);
}

async function postCollectOperation(requestId: string, fields: Record<string, string>, fallback: string): Promise<void> {
  const body = new URLSearchParams(fields);
  const response = await fetchHydroResponse(`/collect/${encodeURIComponent(requestId)}`, {
    method: 'POST',
    body,
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
  });
  if (!response.ok) throw new Error(await readHydroResponseError(response, fallback));
}

function historyBySlot(history: CollectHistoryFileView[]): Array<{ slotId: string; files: CollectHistoryFileView[] }> {
  const order: string[] = [];
  const grouped = new Map<string, CollectHistoryFileView[]>();
  const sorted = [...history].sort((a, b) => {
    if (b.version !== a.version) return b.version - a.version;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  for (const file of sorted) {
    const existing = grouped.get(file.slotId);
    if (!existing) {
      order.push(file.slotId);
      grouped.set(file.slotId, [file]);
    } else {
      existing.push(file);
    }
  }
  return order.map((slotId) => {
    const files = grouped.get(slotId);
    return { slotId, files: files || [] };
  });
}

export function CollectListPage() {
  const bs = useBootstrap();
  const parsed = parseCollectListPayload(bs.page.data);
  const now = useLiveNow(parsed.ok && parsed.value.requests.length > 0);
  const [tab, setTab] = useState<CollectListTab>('pending');

  const counts = useMemo(() => {
    const empty = { pending: 0, submitted: 0, closed: 0 };
    if (!parsed.ok) return empty;
    return parsed.value.requests.reduce((acc, item) => {
      acc[classifyListItem(item, now)] += 1;
      return acc;
    }, empty);
  }, [parsed, now]);

  if (!parsed.ok) return <PayloadError message={parsed.error} />;

  const filtered = parsed.value.requests.filter((item) => classifyListItem(item, now) === tab);

  return (
    <div className="space-y-6">
      <motion.header
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="flex items-center justify-between rounded-xl border bg-card p-6 shadow-sm"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FolderUp className="size-5 text-primary" />
            <h1 className="text-xl font-semibold">文件收集</h1>
          </div>
          <p className="text-sm text-muted-foreground">按槽位上传文件，截止前可替换，确认后才算已交。</p>
        </div>
        {bs.user.canManageCollect ? (
          <Button asChild variant="default" size="sm">
            <a href="/admin/collect">
              <FolderUp className="mr-1 size-4" />
              管理收集
            </a>
          </Button>
        ) : null}
      </motion.header>

      <MiniTabs
        value={tab}
        onValueChange={setTab}
        aria-label="文件收集分类"
        items={[
          { value: 'pending', label: '未交文件', count: counts.pending },
          { value: 'submitted', label: '已交文件', count: counts.submitted },
          { value: 'closed', label: '已截止', count: counts.closed },
        ]}
      />

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FolderUp className="mx-auto size-12 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">当前没有文件收集</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => {
            const dueAtMs = collectDueMs(item.dueAt);
            const closed = dueAtMs === null || isCollectWindowClosed(item.status, dueAtMs, now);
            return (
              <Card key={item._id} className="h-full transition-[box-shadow,opacity] duration-200 ease-out hover:shadow-md motion-reduce:transition-none">
                <CardContent className="flex h-full flex-col gap-3">
                  <div className="flex min-h-10 items-start justify-between gap-2">
                    <h3 className="line-clamp-2 font-semibold">{item.title}</h3>
                    <SubmitStatusBadge submitted={item.submitted} />
                  </div>
                  <div className="space-y-1.5 rounded-md border bg-muted/20 p-2.5 text-xs">
                    <div className="flex min-w-0 items-start gap-1.5 text-muted-foreground">
                      <Clock className="mt-0.5 size-3 shrink-0" />
                      <span className="shrink-0 text-foreground/70">截止</span>
                      <span className="min-w-0 flex-1 break-words">
                        <DateTime value={item.dueAt} mode="datetime" />
                      </span>
                    </div>
                    {dueAtMs !== null ? <CollectCountdownNotice dueAtMs={dueAtMs} now={now} closed={closed} /> : null}
                  </div>
                  <div className="mt-auto pt-1">
                    <Button asChild className="min-h-10 w-full" variant={item.submitted || closed ? 'outline' : 'default'} size="sm">
                      <a href={`/collect/${encodeURIComponent(item._id)}`}>
                        {item.submitted || closed ? '查看' : '去交文件'}
                        <ChevronRight className="size-4" />
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SlotFiles({
  requestId,
  slot,
  files,
  open,
  replacingFileId,
  busyFileId,
  onReplace,
  onDelete,
}: {
  requestId: string;
  slot: CollectSlotView;
  files: CollectCurrentFileView[];
  open: boolean;
  replacingFileId: string | null;
  busyFileId: string | null;
  onReplace: (fileId: string) => void;
  onDelete: (file: CollectCurrentFileView) => void;
}) {
  if (files.length === 0) {
    return <p className="text-xs text-muted-foreground">还没有文件</p>;
  }
  return (
    <ul className="space-y-1.5">
      {files.map((file) => (
        <li key={file.fileId} className="rounded-md border bg-card px-2.5 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">{file.originalName}</span>
            <span className="shrink-0 text-muted-foreground">{formatSize(file.size)}</span>
            <a
              href={collectFileHref(requestId, file)}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={`下载${file.originalName}`}
            >
              <Download className="size-3.5" />
            </a>
            {open ? (
              <>
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => onReplace(file.fileId)}>
                  替换
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:bg-destructive/10"
                  disabled={busyFileId === file.fileId}
                  onClick={() => onDelete(file)}
                  aria-label={`删除${file.originalName}`}
                >
                  {busyFileId === file.fileId ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                </Button>
              </>
            ) : null}
          </div>
          {open && replacingFileId === file.fileId ? (
            <div className="mt-2">
              <FileUploader
                endpoint={`/collect/${encodeURIComponent(requestId)}`}
                meta={{ operation: 'replace_file', slotId: slot.id, fileId: file.fileId }}
                maxFileSize={COLLECT_MAX_FILE_BYTES}
                maxFiles={1}
                uploadConcurrency={1}
                retryOnFailure={false}
                accept={acceptFromSlot(slot)}
                onBatchComplete={() => window.location.reload()}
              />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function CollectHistory({
  requestId,
  slots,
  history,
}: {
  requestId: string;
  slots: CollectSlotView[];
  history: CollectHistoryFileView[];
}) {
  const slotTitle = new Map(slots.map((slot) => [slot.id, slot.title]));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">历史版本</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {historyBySlot(history).map((group) => (
          <div key={group.slotId} className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{slotTitle.get(group.slotId) || group.slotId}</p>
            <ul className="space-y-1">
              {group.files.map((file) => (
                <li key={`${file.fileId}:${file.version}`} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate">{file.originalName}</span>
                  <span className="text-muted-foreground">v{file.version}</span>
                  <span className="text-muted-foreground">{formatSize(file.size)}</span>
                  <DateTime value={file.createdAt} mode="datetime" className="text-muted-foreground" />
                  {file.current ? (
                    <Badge variant="secondary" className="text-[10px]">
                      当前
                    </Badge>
                  ) : null}
                  <a
                    href={collectFileHref(requestId, file)}
                    className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={`下载${file.originalName} 第 ${file.version} 版`}
                  >
                    <Download className="size-3.5" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function CollectDetailPage() {
  const bs = useBootstrap();
  const parsed = parseCollectDetailPayload(bs.page.data);
  const now = useLiveNow(parsed.ok);
  const [actionError, setActionError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [replacingFileId, setReplacingFileId] = useState<string | null>(null);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);

  if (!parsed.ok) return <PayloadError message={parsed.error} />;

  const data = parsed.value;
  const dueAtMs = collectDueMs(data.dueAt);
  const closed = dueAtMs === null || isCollectWindowClosed(data.status, dueAtMs, now);
  const open = !closed && data.member;

  const confirm = async () => {
    if (confirming || !open || data.submitted || !data.filled) return;
    setConfirming(true);
    setActionError('');
    try {
      await postCollectOperation(data._id, { operation: 'confirm' }, '确认提交失败');
      window.location.reload();
    } catch (error) {
      setActionError(actionErrorMessage(error, '确认提交失败'));
      setConfirming(false);
    }
  };

  const deleteFile = async (file: CollectCurrentFileView) => {
    if (!open || busyFileId) return;
    setBusyFileId(file.fileId);
    setActionError('');
    try {
      await postCollectOperation(
        data._id,
        { operation: 'delete_file', slotId: file.slotId, fileId: file.fileId },
        '删除文件失败',
      );
      window.location.reload();
    } catch (error) {
      setActionError(actionErrorMessage(error, '删除文件失败'));
      setBusyFileId(null);
    }
  };

  return (
    <div className="space-y-6">
      <motion.header initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <Button variant="ghost" size="sm" asChild className="-ml-2 mb-1">
              <a href="/collect">返回文件收集</a>
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{data.title}</h1>
              <SubmitStatusBadge submitted={data.submitted} />
              {closed ? (
                <Badge variant="outline" className="gap-1 text-muted-foreground">
                  已截止
                </Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                截止 <DateTime value={data.dueAt} mode="datetime" />
              </span>
            </div>
            {dueAtMs !== null ? <CollectCountdownNotice dueAtMs={dueAtMs} now={now} closed={closed} alwaysShowRemaining /> : null}
          </div>
          <div className="flex items-center gap-2">
            {bs.user.canManageCollect ? (
              <Button asChild variant="outline" size="sm">
                <a href={`/admin/collect/${encodeURIComponent(data._id)}`}>进度</a>
              </Button>
            ) : null}
            {open && !data.submitted ? (
              <Button type="button" size="sm" disabled={!data.filled || confirming} onClick={() => void confirm()}>
                {confirming ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                确认提交
              </Button>
            ) : null}
          </div>
        </div>
        {closed ? (
          <p className="mt-3 rounded-md border border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">收集已截止</p>
        ) : null}
        {open && !data.submitted && !data.filled ? (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            请先为每个必填槽上传文件，再点确认提交。
          </p>
        ) : null}
      </motion.header>

      {actionError ? (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      {data.description.trim() ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">说明</CardTitle>
          </CardHeader>
          <CardContent>
            <MarkdownView content={data.description} className="prose prose-sm dark:prose-invert max-w-none" />
          </CardContent>
        </Card>
      ) : null}

      {data.slots.map((slot) => {
        const files = filesForSlot(data.currentFiles, slot.id);
        return (
          <Card key={slot.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
              <div className="space-y-1.5">
                <CardTitle className="text-base">{slot.title}</CardTitle>
                <div className="flex flex-wrap gap-1.5">
                  {slot.required ? (
                    <Badge>必填</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      选填
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px]">
                    {slot.allowedExt.map((ext) => `.${ext}`).join(' / ')}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {files.length}/{slot.maxFiles} 个文件
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <SlotFiles
                requestId={data._id}
                slot={slot}
                files={files}
                open={open}
                replacingFileId={replacingFileId}
                busyFileId={busyFileId}
                onReplace={(fileId) => setReplacingFileId((current) => (current === fileId ? null : fileId))}
                onDelete={(file) => void deleteFile(file)}
              />
              {open && files.length < slot.maxFiles ? (
                <FileUploader
                  endpoint={`/collect/${encodeURIComponent(data._id)}`}
                  meta={{ operation: 'upload_file', slotId: slot.id }}
                  maxFileSize={COLLECT_MAX_FILE_BYTES}
                  maxFiles={slot.maxFiles - files.length}
                  uploadConcurrency={1}
                  retryOnFailure={false}
                  accept={acceptFromSlot(slot)}
                  onBatchComplete={() => window.location.reload()}
                />
              ) : null}
            </CardContent>
          </Card>
        );
      })}

      {open && !data.submitted ? (
        <div className="flex justify-end">
          <Button type="button" disabled={!data.filled || confirming} onClick={() => void confirm()}>
            {confirming ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
            确认提交
          </Button>
        </div>
      ) : null}

      {data.history && data.history.length > 0 ? <CollectHistory requestId={data._id} slots={data.slots} history={data.history} /> : null}
    </div>
  );
}
