/**
 * /collect (student) — file collection list + submit detail.
 *
 * Pages register in PAGE_MAP (see ../resolver.tsx) via:
 *   - collect_main.html    → CollectListPage
 *   - collect_detail.html  → CollectDetailPage
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  Clock,
  Download,
  FolderUp,
  Lock,
  Trash2,
} from 'lucide-react';
import { FileUploader } from '@/components/uploader';
import { MarkdownView } from '@/components/markdown-renderer';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateTime } from '@/components/ui/datetime';
import { EmptyState } from '@/components/ui/empty-state';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
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
    <Page width="wide">
      <Alert tone="danger">页面数据无效：{message}</Alert>
    </Page>
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
  const tone = notice.tone === 'muted' ? 'neutral' : notice.tone;
  return (
    <Alert tone={tone}>
      <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <span className="min-w-0">{notice.label}</span>
        {notice.target ? <span className="ml-auto font-mono tabular">{formatCountdown(notice.target - now)}</span> : null}
      </span>
    </Alert>
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
    <Page width="wide">
      <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="w-full min-w-0 flex-1">
          <PageHeader
            title={<span className="min-w-0 break-words">文件收集</span>}
            description="按槽位上传文件，截止前可替换，确认后才算已交。"
            actions={bs.user.canManageCollect ? (
              <Button asChild variant="secondary" size="sm">
                <a href="/admin/collect">
                  <FolderUp />
                  管理收集
                </a>
              </Button>
            ) : undefined}
            tabs={(
              <MiniTabs
                value={tab}
                onValueChange={setTab}
                aria-label="文件收集分类"
                className="max-w-full overflow-x-auto overflow-y-hidden scrollbar-none"
                items={[
                  { value: 'pending', label: '未交文件', count: counts.pending },
                  { value: 'submitted', label: '已交文件', count: counts.submitted },
                  { value: 'closed', label: '已截止', count: counts.closed },
                ]}
              />
            )}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Panel as="div">
          <EmptyState compact icon={<FolderUp />} title="当前没有文件收集" />
        </Panel>
      ) : (
        <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => {
            const dueAtMs = collectDueMs(item.dueAt);
            const closed = dueAtMs === null || isCollectWindowClosed(item.status, dueAtMs, now);
            return (
              <Panel key={item._id} as="div" className="h-full">
                <div className="flex h-full flex-col gap-3">
                  <div className="flex min-h-10 min-w-0 items-start justify-between gap-2">
                    <h3 className="min-w-0 flex-1 break-words text-sm font-semibold text-fg line-clamp-2">{item.title}</h3>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {item.submitted ? (
                        <Badge tone="success" dot>已交文件</Badge>
                      ) : (
                        <Badge tone="neutral" dot>未交文件</Badge>
                      )}
                      {item.examLocked && !item.submitted ? (
                        <Badge tone="warning">
                          <Lock className="size-3" />
                          须先考试
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 rounded-md bg-surface-sunken p-2.5 text-xs">
                    <div className="flex min-w-0 items-start gap-1.5 text-fg-subtle">
                      <Clock className="mt-0.5 size-3 shrink-0" />
                      <span className="shrink-0">截止</span>
                      <span className="min-w-0 flex-1 break-words text-fg">
                        <DateTime value={item.dueAt} mode="datetime" />
                      </span>
                    </div>
                    {dueAtMs !== null ? <CollectCountdownNotice dueAtMs={dueAtMs} now={now} closed={closed} /> : null}
                  </div>
                  <div className="mt-auto pt-1">
                    <Button
                      asChild
                      className="w-full"
                      variant={item.submitted || closed ? 'secondary' : 'soft'}
                      size="md"
                    >
                      <a href={`/collect/${encodeURIComponent(item._id)}`}>
                        {item.submitted || closed ? '查看' : '去交文件'}
                        <ChevronRight />
                      </a>
                    </Button>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </Page>
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
    return <p className="text-xs text-fg-subtle">还没有文件</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {files.map((file) => {
        const assignedName = file.assignedName || file.originalName;
        return (
          <li key={file.fileId} className="min-w-0 rounded-md bg-surface-sunken px-2.5 py-2 text-xs">
            <div className="flex min-w-0 flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <span className="block break-all font-medium">{assignedName}</span>
                {file.originalName !== assignedName ? (
                  <span className="block break-all text-fg-subtle">{file.originalName}</span>
                ) : null}
                <span className="mt-0.5 block text-fg-subtle tabular">{formatSize(file.size)}</span>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" iconOnly asChild>
                  <a
                    href={collectFileHref(requestId, file)}
                    aria-label={`下载${assignedName}`}
                  >
                    <Download />
                  </a>
                </Button>
                {open ? (
                  <>
                    <Button type="button" variant="ghost" size="sm" onClick={() => onReplace(file.fileId)}>
                      替换
                    </Button>
                    <Button
                      type="button"
                      variant="danger-soft"
                      size="sm"
                      iconOnly
                      loading={busyFileId === file.fileId}
                      disabled={busyFileId === file.fileId}
                      onClick={() => onDelete(file)}
                      aria-label={`删除${file.originalName}`}
                    >
                      <Trash2 />
                    </Button>
                  </>
                ) : null}
              </div>
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
        );
      })}
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
    <Panel title="历史版本">
      <div className="flex flex-col gap-4">
        {historyBySlot(history).map((group) => (
          <div key={group.slotId} className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-fg-subtle">{slotTitle.get(group.slotId) || group.slotId}</p>
            <ul className="divide-y divide-line-subtle">
              {group.files.map((file) => (
                <li key={`${file.fileId}:${file.version}`} className="flex min-w-0 flex-wrap items-center gap-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 break-all">{file.originalName}</span>
                  <span className="shrink-0 text-fg-subtle tabular">v{file.version}</span>
                  <span className="shrink-0 text-fg-subtle tabular">{formatSize(file.size)}</span>
                  <DateTime value={file.createdAt} mode="datetime" className="shrink-0 text-fg-subtle" />
                  {file.current ? <Badge size="sm">当前</Badge> : null}
                  <Button variant="ghost" size="sm" iconOnly asChild>
                    <a
                      href={collectFileHref(requestId, file)}
                      aria-label={`下载${file.originalName} 第 ${file.version} 版`}
                    >
                      <Download />
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
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
  const examLocked = data.examGate.locked;
  const writable = open && !examLocked;

  const confirm = async () => {
    if (confirming || !writable || data.submitted || !data.filled) return;
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
    if (!writable || busyFileId) return;
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
    <Page width="wide">
      <div className="flex min-w-0 flex-col gap-3">
        <PageHeader
          breadcrumb={(
            <Button variant="ghost" size="sm" asChild>
              <a href="/collect">返回文件收集</a>
            </Button>
          )}
          title={<span className="min-w-0 break-words">{data.title}</span>}
          meta={(
            <>
              {data.submitted ? (
                <Badge tone="success" dot>已交文件</Badge>
              ) : (
                <Badge tone="neutral" dot>未交文件</Badge>
              )}
              {closed ? <Badge tone="warning" dot>已截止</Badge> : null}
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-3" />
                截止 <DateTime value={data.dueAt} mode="datetime" />
              </span>
            </>
          )}
          actions={(
            <>
              {bs.user.canManageCollect ? (
                <Button asChild variant="secondary" size="sm">
                  <a href={`/admin/collect/${encodeURIComponent(data._id)}`}>进度</a>
                </Button>
              ) : null}
              {writable && !data.submitted ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="min-h-11"
                  disabled={!data.filled || confirming}
                  loading={confirming}
                  onClick={() => void confirm()}
                >
                  确认提交
                </Button>
              ) : null}
            </>
          )}
        />
        {dueAtMs !== null ? <CollectCountdownNotice dueAtMs={dueAtMs} now={now} closed={closed} alwaysShowRemaining /> : null}
        {closed ? <Alert tone="neutral">收集已截止</Alert> : null}
        {examLocked ? (
          <Alert tone="warning">
            {/* 考试已结束且未参加，无法提交 is shown via examGate.message when the server sends it. */}
            {data.examGate.message || '须先完成课程结业考试才能提交'}
            {data.examGate.examHref ? (
              <>
                {' '}
                <a href={data.examGate.examHref} className="font-medium text-brand-fg underline underline-offset-2">
                  去考试
                </a>
              </>
            ) : null}
          </Alert>
        ) : null}
        {writable && !data.submitted && !data.filled ? (
          <Alert tone="warning">请先为每个必填槽上传文件，再点确认提交。</Alert>
        ) : null}
      </div>

      {actionError ? <Alert tone="danger">{actionError}</Alert> : null}

      {data.description.trim() ? (
        <Panel title="说明">
          <MarkdownView content={data.description} />
        </Panel>
      ) : null}

      {data.slots.map((slot) => {
        const files = filesForSlot(data.currentFiles, slot.id);
        return (
          <Panel
            key={slot.id}
            title={<span className="min-w-0 break-words">{slot.title}</span>}
            description={(
              <span className="flex min-w-0 flex-wrap gap-1.5">
                {slot.required ? <Badge tone="warning">必填</Badge> : <Badge tone="neutral">选填</Badge>}
                <Badge variant="outline" tone="neutral" size="sm">
                  {slot.allowedExt.map((ext) => `.${ext}`).join(' / ')}
                </Badge>
                <Badge tone="neutral" size="sm">
                  {files.length}/{slot.maxFiles} 个文件
                </Badge>
              </span>
            )}
          >
            <div className="flex flex-col gap-3">
              <SlotFiles
                requestId={data._id}
                slot={slot}
                files={files}
                open={writable}
                replacingFileId={replacingFileId}
                busyFileId={busyFileId}
                onReplace={(fileId) => setReplacingFileId((current) => (current === fileId ? null : fileId))}
                onDelete={(file) => void deleteFile(file)}
              />
              {writable && files.length < slot.maxFiles ? (
                <div className="flex flex-col gap-2">
                  <p className="break-all text-xs text-fg-subtle">将保存为 {slot.nextAssignedName}</p>
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
                </div>
              ) : null}
            </div>
          </Panel>
        );
      })}

      {writable && !data.submitted ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            disabled={!data.filled || confirming}
            loading={confirming}
            onClick={() => void confirm()}
          >
            确认提交
          </Button>
        </div>
      ) : null}

      {data.history && data.history.length > 0 ? <CollectHistory requestId={data._id} slots={data.slots} history={data.history} /> : null}
    </Page>
  );
}
