/**
 * /admin/dropbox — system-admin temporary file cabinet.
 *
 * Template → export:
 *   - admin_dropbox.html → AdminDropboxPage
 *
 * Uses dropbox routes only. Do not call collect APIs or write collect/ blobs.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, Download, Inbox, Trash2 } from 'lucide-react';
import { AdminPage } from '@/components/admin/admin-page';
import { FileUploader } from '@/components/uploader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateTime } from '@/components/ui/datetime';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableAction, TableActions } from '@/components/ui/table-actions';
import { registerAdminNavSection } from '@/lib/admin-nav-registry';
import { useBootstrap } from '@/lib/bootstrap';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { isSystemAdmin, PRIV } from '@/lib/perms';

const DROPBOX_ENDPOINT = '/admin/dropbox';
const DEFAULT_EXPIRE_DAYS = 7;
const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024 * 1024;
const HARD_MAX_FILE_BYTES = 10 * 1024 * 1024 * 1024;
const EXPIRE_DAY_OPTIONS = [1, 3, 7, 14, 30] as const;
const MIB = 1024 * 1024;
const GIB = 1024 * 1024 * 1024;

registerAdminNavSection({
  key: 'dropbox',
  label: '临时文件柜',
  order: 32,
  requiredPriv: PRIV.PRIV_EDIT_SYSTEM,
  items: [
    {
      key: 'files',
      label: '临时文件柜',
      href: DROPBOX_ENDPOINT,
      icon: Inbox,
      templateNames: ['admin_dropbox.html'],
      requiredPriv: PRIV.PRIV_EDIT_SYSTEM,
    },
  ],
});

interface DropboxFileView {
  _id: string;
  originalName: string;
  size: number;
  createdAt: string;
  expireAt: string;
  downloadUrl: string;
}

interface DropboxPageData {
  files: DropboxFileView[];
  canManage: boolean;
  maxFileBytes: number;
  defaultExpireDays: number;
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式不正确`);
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}格式不正确`);
  return value;
}

function asId(value: unknown, label: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    if (typeof rec.$oid === 'string' && rec.$oid.trim()) return rec.$oid.trim();
  }
  throw new Error(`${label}格式不正确`);
}

function asNonNegativeInt(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }
  throw new Error(`${label}格式不正确`);
}

function asPositiveInt(value: unknown, label: string): number {
  const parsed = asNonNegativeInt(value, label);
  if (parsed < 1) throw new Error(`${label}格式不正确`);
  return parsed;
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value === 'boolean') return value;
  throw new Error(`${label}格式不正确`);
}

function asIso(value: unknown, label: string): string {
  if (typeof value === 'string' && value && !Number.isNaN(Date.parse(value))) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    if (rec.$date !== undefined) return asIso(rec.$date, label);
  }
  throw new Error(`${label}格式不正确`);
}

function parseFile(value: unknown): DropboxFileView {
  const rec = asRecord(value, '文件');
  const originalName = asString(rec.originalName, '文件名').trim();
  if (!originalName) throw new Error('文件名格式不正确');
  const downloadUrl = asString(rec.downloadUrl, '下载地址').trim();
  if (!downloadUrl) throw new Error('下载地址格式不正确');
  return {
    _id: asId(rec._id, '文件'),
    originalName,
    size: asNonNegativeInt(rec.size, '文件大小'),
    createdAt: asIso(rec.createdAt, '上传时间'),
    expireAt: asIso(rec.expireAt, '过期时间'),
    downloadUrl,
  };
}

async function deleteDropboxFile(id: string): Promise<void> {
  const response = await fetchHydroResponse(
    DROPBOX_ENDPOINT,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: new URLSearchParams({ operation: 'delete', id }),
    },
    '删除失败',
  );
  if (!response.ok) throw new Error(await readHydroResponseError(response, '删除失败'));
}

function parseExpireDays(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const days = asPositiveInt(value, '默认过期天数');
  if (days > 365) throw new Error('默认过期天数格式不正确');
  return days;
}

function parseMaxFileBytes(value: unknown): number {
  if (value === undefined || value === null || value === '') return DEFAULT_MAX_FILE_BYTES;
  const bytes = asPositiveInt(value, '文件大小上限');
  if (bytes > HARD_MAX_FILE_BYTES) throw new Error('文件大小上限格式不正确');
  return bytes;
}

function parsePageData(value: unknown): ParseResult<DropboxPageData> {
  try {
    const rec = asRecord(value, '临时文件柜');
    if (!Array.isArray(rec.files)) throw new Error('文件列表格式不正确');
    return {
      ok: true,
      value: {
        files: rec.files.map(parseFile),
        canManage: rec.canManage === undefined ? true : asBoolean(rec.canManage, '管理权限'),
        maxFileBytes: parseMaxFileBytes(rec.maxFileBytes),
        defaultExpireDays: parseExpireDays(rec.defaultExpireDays, DEFAULT_EXPIRE_DAYS),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '页面数据无效' };
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function expireOptions(defaultExpireDays: number): Array<{ value: string; label: string }> {
  const days = new Set<number>(EXPIRE_DAY_OPTIONS);
  days.add(defaultExpireDays);
  return [...days]
    .sort((a, b) => a - b)
    .map((day) => ({
      value: String(day),
      label: day === DEFAULT_EXPIRE_DAYS ? `${day} 天（默认）` : `${day} 天`,
    }));
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

function DeleteDialog({ target, onClose }: { target: DropboxFileView | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };
  const submit = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await deleteDropboxFile(target._id);
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除失败');
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="w-full sm:w-[440px]" onClose={close}>
        <DialogHeader>
          <DialogTitle>删除确认</DialogTitle>
        </DialogHeader>
        <DialogBody>
        <p className="text-sm text-muted-foreground">确定删除「{target?.originalName}」？删除后不可恢复。</p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        </DialogBody>
        <DialogFooter className="mt-4 flex justify-end gap-2 flex-row border-0 p-0">
          <Button type="button" variant="outline" onClick={close} disabled={busy}>
            取消
          </Button>
          <Button type="button" variant="destructive" onClick={() => void submit()} disabled={busy}>
            <Trash2 />
            {busy ? '删除中…' : '删除'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExpireBadge({ expireAt }: { expireAt: string }) {
  const ms = Date.parse(expireAt);
  if (Number.isNaN(ms)) return null;
  if (ms <= Date.now()) {
    return (
      <Badge variant="destructive" className="text-[10px]">
        已过期
      </Badge>
    );
  }
  if (ms - Date.now() <= 24 * 60 * 60 * 1000) {
    return (
      <Badge variant="secondary" className="text-[10px]">
        即将过期
      </Badge>
    );
  }
  return null;
}

export function AdminDropboxPage() {
  const bs = useBootstrap();
  const parsed = useMemo(() => parsePageData(bs.page.data), [bs.page.data]);
  const systemAdmin = isSystemAdmin(bs.user.priv);
  const [expireDays, setExpireDays] = useState(() => (parsed.ok ? String(parsed.value.defaultExpireDays) : String(DEFAULT_EXPIRE_DAYS)));
  const [pendingDelete, setPendingDelete] = useState<DropboxFileView | null>(null);

  if (!parsed.ok) {
    return (
      <AdminPage
        title="临时文件柜"
        description="系统管理员临时搬运文件。不进入题目评测数据，也不进入学生文件收集。"
        requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
      >
        <PayloadError message={parsed.error} />
      </AdminPage>
    );
  }

  const data = parsed.value;
  const canManage = systemAdmin && data.canManage;
  const maxFileSizeLabel = data.maxFileBytes >= GIB
    ? `${Math.round(data.maxFileBytes / GIB)} GiB`
    : `${Math.round(data.maxFileBytes / MIB)} MiB`;

  return (
    <AdminPage
      title="临时文件柜"
      description="系统管理员临时搬运文件。不进入题目评测数据，也不进入学生文件收集。到期后删除文件和元数据。"
      requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
    >
      <div className="space-y-5">
        {canManage ? (
          <Card>
            <CardHeader className="space-y-4">
              <CardTitle className="text-base">上传</CardTitle>
              <FormField label="过期时间" htmlFor="dropbox-expire-days" hint="上传时选定。默认 7 天，到期后删除文件和记录。">
                <SimpleSelect
                  id="dropbox-expire-days"
                  value={expireDays}
                  onValueChange={setExpireDays}
                  options={expireOptions(data.defaultExpireDays)}
                  className="w-full sm:w-56"
                />
              </FormField>
            </CardHeader>
            <CardContent>
              <FileUploader
                endpoint={DROPBOX_ENDPOINT}
                fieldName="file"
                meta={{ operation: 'upload_file', expireDays }}
                maxFileSize={data.maxFileBytes}
                maxFiles={1}
                uploadConcurrency={1}
                retryOnFailure={false}
                onBatchComplete={() => window.location.reload()}
              />
              <p className="mt-2 text-xs text-muted-foreground">单文件上限 {maxFileSizeLabel}。可执行文件会被拒绝。</p>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">文件（{data.files.length}）</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>文件名</TableHead>
                  <TableHead className="w-28">大小</TableHead>
                  <TableHead className="w-44">上传时间</TableHead>
                  <TableHead className="w-52">过期时间</TableHead>
                  {canManage ? <TableHead className="w-40">操作</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.files.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canManage ? 5 : 4} className="py-12 text-center text-sm text-muted-foreground">
                      还没有临时文件{canManage ? '，在上方上传后会出现在此列表' : ''}
                    </TableCell>
                  </TableRow>
                ) : (
                  data.files.map((file) => (
                    <TableRow key={file._id}>
                      <TableCell className="font-mono text-sm">{file.originalName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatSize(file.size)}</TableCell>
                      <TableCell className="text-xs">
                        <DateTime value={file.createdAt} mode="datetime" />
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <DateTime value={file.expireAt} mode="datetime" />
                          <ExpireBadge expireAt={file.expireAt} />
                        </div>
                      </TableCell>
                      {canManage ? (
                        <TableCell>
                          <TableActions>
                            <TableAction href={file.downloadUrl} icon={Download}>
                              下载
                            </TableAction>
                            <TableAction icon={Trash2} variant="destructive" onClick={() => setPendingDelete(file)}>
                              删除
                            </TableAction>
                          </TableActions>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      {canManage ? <DeleteDialog key={pendingDelete?._id || 'idle'} target={pendingDelete} onClose={() => setPendingDelete(null)} /> : null}
    </AdminPage>
  );
}
