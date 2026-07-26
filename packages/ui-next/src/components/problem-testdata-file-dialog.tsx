import { Download, FileCode, Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { KryptonIDE } from '@/components/krypton-ide';
import { type ProblemDataWriteConfirmationResult, type ProblemDataWriteOperation } from '@/components/problem-data-write-guard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { readHydroResponseError } from '@/lib/problem-save-response';

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
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [readonly, setReadonly] = useState(tooBig);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setContent(null);
    if (tooBig) {
      setLoadError(`文件过大 (${bytesLabel(size)})，请下载后用本地编辑器修改。`);
      return;
    }
    fetch(previewUrl, {
      headers: { Accept: 'text/plain' },
      credentials: 'same-origin',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
    setSaveMessage(null);
    try {
      const form = new FormData();
      form.append('operation', 'upload_file');
      form.append('type', 'testdata');
      form.append('filename', filename);
      if (typeof confirmation === 'string') form.append('activeContainerConfirmation', confirmation);
      form.append('file', new Blob([content], { type: 'text/plain' }), filename);
      const response = await fetch(`${problemUrl}/files`, {
        method: 'POST',
        body: form,
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!response.ok && !response.redirected) {
        throw new Error(await readHydroResponseError(response, '保存失败'));
      }
      setOriginalContent(content);
      setSaveMessage('已保存');
      window.setTimeout(() => setSaveMessage(null), 1500);
    } catch (error) {
      console.error('Problem testdata file save failed', { filename, error });
      setSaveMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [confirmWrite, content, filename, problemUrl]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="h-[88vh] max-h-[92vh] w-[92vw] max-w-none" onClose={onClose}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCode className="size-4" />
            <span className="font-mono">{filename}</span>
            <Badge variant="outline" className="text-[10px]">
              {bytesLabel(size)}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              {language.toUpperCase()}
            </Badge>
            {dirty ? (
              <Badge variant="default" className="text-[10px]">
                未保存
              </Badge>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
          {loadError ? (
            <div className="rounded border border-amber-300 bg-amber-50/40 p-3 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
              {loadError}
              <div className="mt-2">
                <Button asChild variant="outline" size="sm">
                  <a href={downloadUrl} download={filename}>
                    <Download className="mr-1 size-3.5" />
                    下载文件
                  </a>
                </Button>
              </div>
            </div>
          ) : content == null ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">加载中…</div>
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
              <KryptonIDE
                mode={readonly ? 'readonly' : 'simple'}
                langs={[]}
                defaultLang={language}
                value={content}
                onValueChange={setContent}
                minHeight={420}
                className="h-full"
              />
            </div>
          )}

          <div className="flex shrink-0 items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {!tooBig && content != null ? (
                <label className="flex cursor-pointer items-center gap-1">
                  <Checkbox checked={readonly} onChange={() => setReadonly(!readonly)} />
                  只读
                </label>
              ) : null}
              {saveMessage ? <span className="text-foreground">{saveMessage}</span> : null}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onClose}>
                关闭
              </Button>
              <Button onClick={handleSave} disabled={!dirty || saving || readonly || tooBig}>
                <Save className="mr-1 size-3.5" />
                {saving ? '保存中…' : '保存'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
