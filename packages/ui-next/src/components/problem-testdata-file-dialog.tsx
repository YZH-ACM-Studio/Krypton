import { Download, FileCode, Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { KryptonIDE } from '@/components/krypton-ide';
import { type ProblemDataWriteConfirmationResult, type ProblemDataWriteOperation } from '@/components/problem-data-write-guard';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';

interface ProblemFile {
  name?: string;
  size?: number;
}

function detectLanguage(filename: string): string {
  const match = filename.toLowerCase().match(/\.([^.]+)$/);
  if (!match) return 'txt';
  const extension = match[1];
  if (extension === 'yaml' || extension === 'yml') return 'yaml';
  if (extension === 'json') return 'json';
  if (['cpp', 'cc', 'cxx', 'h', 'hpp', 'c'].includes(extension)) return 'cc.cc17';
  if (extension === 'py') return 'py';
  if (extension === 'java') return 'java';
  if (extension === 'go') return 'go';
  if (extension === 'rs') return 'rs';
  if (['js', 'mjs', 'ts'].includes(extension)) return 'js';
  return 'txt';
}

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const MAX_FILE_PREVIEW_BYTES = 1 * 1024 * 1024;

export function ProblemTestdataFileDialog({
  file,
  problemUrl,
  onClose,
  confirmWrite,
}: {
  file: ProblemFile;
  problemUrl: string;
  onClose: () => void;
  confirmWrite?: (action: string, operation: ProblemDataWriteOperation) => Promise<ProblemDataWriteConfirmationResult>;
}) {
  const filename = String(file.name || '');
  const size = Number(file.size) || 0;
  const tooBig = size > MAX_FILE_PREVIEW_BYTES;
  const language = useMemo(() => detectLanguage(filename), [filename]);
  const downloadUrl = useMemo(() => `${problemUrl}/file/${encodeURIComponent(filename)}?type=testdata`, [problemUrl, filename]);
  const previewUrl = useMemo(() => `${downloadUrl}&noDisposition=1`, [downloadUrl]);
  const [content, setContent] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null);
  const [readonly, setReadonly] = useState(tooBig);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setContent(null);
    if (tooBig) {
      setLoadError(`文件过大 (${bytesLabel(size)})，请下载后用本地编辑器修改。`);
      return;
    }
    fetchHydroResponse(
      previewUrl,
      {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      },
      '测试数据文件加载失败',
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(await readHydroResponseError(response, '测试数据文件加载失败'));
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== 'object' || !('url' in payload) || typeof payload.url !== 'string' || !payload.url) {
          throw new Error('获取文件下载链接失败');
        }
        return fetchHydroResponse(
          payload.url,
          {
            headers: { Accept: 'text/plain' },
            credentials: 'same-origin',
          },
          '测试数据文件加载失败',
        );
      })
      .then(async (response) => {
        if (!response.ok) {
          console.error('Signed testdata file request failed', { filename, status: response.status });
          throw new Error('测试数据文件加载失败');
        }
        return response.text();
      })
      .then((text) => {
        if (cancelled) return;
        setContent(text);
        setOriginalContent(text);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Problem testdata file preview failed', { filename, error });
        setLoadError(error instanceof Error ? error.message : '加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [filename, previewUrl, size, tooBig]);

  const dirty = content != null && content !== originalContent;

  const handleSave = useCallback(async () => {
    if (content == null) return;
    const confirmation = confirmWrite ? await confirmWrite(`保存测试数据文件 ${filename}`, 'files-upload') : true;
    if (!confirmation) return;
    setSaving(true);
    setSaveNotice(null);
    try {
      const form = new FormData();
      form.append('operation', 'upload_file');
      form.append('type', 'testdata');
      form.append('filename', filename);
      if (typeof confirmation === 'string') form.append('activeContainerConfirmation', confirmation);
      form.append('file', new Blob([content], { type: 'text/plain' }), filename);
      const response = await fetchHydroResponse(
        `${problemUrl}/files`,
        {
          method: 'POST',
          body: form,
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
        },
        '保存失败',
      );
      if (!response.ok && !response.redirected) {
        throw new Error(await readHydroResponseError(response, '保存失败'));
      }
      setOriginalContent(content);
      setSaveNotice({ text: '已保存', tone: 'success' });
      window.setTimeout(() => setSaveNotice(null), 1500);
    } catch (error) {
      console.error('Problem testdata file save failed', { filename, error });
      setSaveNotice({ text: error instanceof Error ? error.message : '保存失败', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  }, [confirmWrite, content, filename, problemUrl]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="full" className="max-sm:h-dvh min-h-0" onClose={onClose}>
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex w-full min-w-0 items-center gap-2 overflow-hidden">
            <FileCode className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate font-mono" title={filename}>
              {filename}
            </span>
            <Badge tone="neutral" variant="outline" size="sm" className="shrink-0">
              {bytesLabel(size)}
            </Badge>
            <Badge tone="neutral" variant="soft" size="sm" className="shrink-0">
              {language.toUpperCase()}
            </Badge>
            {dirty ? (
              <Badge tone="warning" variant="soft" size="sm" className="shrink-0">
                未保存
              </Badge>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          {loadError ? (
            <Alert
              tone="warning"
              action={
                <Button asChild variant="secondary" size="sm">
                  <a href={downloadUrl} download={filename}>
                    <Download />
                    下载文件
                  </a>
                </Button>
              }
            >
              {loadError}
            </Alert>
          ) : content == null ? (
            <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-fg-muted">加载中…</div>
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-line">
              <KryptonIDE
                mode={readonly ? 'readonly' : 'simple'}
                langs={[]}
                defaultLang={language}
                value={content}
                onValueChange={setContent}
                minHeight={0}
                className="h-full min-h-0"
              />
            </div>
          )}
        </DialogBody>
        <DialogFooter className="sm:justify-between">
          <div className="flex min-w-0 flex-col items-start gap-1">
            {!tooBig && content != null ? (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-fg-subtle">
                <Checkbox checked={readonly} onChange={() => setReadonly(!readonly)} />
                只读
              </label>
            ) : null}
            {saveNotice ? (
              <p role={saveNotice.tone === 'danger' ? 'alert' : 'status'} className={saveNotice.tone === 'danger' ? 'text-xs text-danger-fg' : 'text-xs text-success-fg'}>
                {saveNotice.text}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              关闭
            </Button>
            <Button type="button" variant="primary" onClick={handleSave} disabled={!dirty || saving || readonly || tooBig}>
              <Save />
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
