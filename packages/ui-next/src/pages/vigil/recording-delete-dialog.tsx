import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  executeRecordingDelete,
  previewRecordingDelete,
  type RecordingDeletePreview,
  type RecordingDeleteScope,
} from '@/lib/vigil-api';

interface RecordingDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: RecordingDeleteScope;
  onDeleted: () => void;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function RecordingDeleteDialog({ open, onOpenChange, scope, onDeleted }: RecordingDeleteDialogProps) {
  const [preview, setPreview] = useState<RecordingDeletePreview | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setPreview(null);
    setConfirmation('');
    setError(null);
    setLoading(true);
    previewRecordingDelete(scope)
      .then((value) => {
        if (cancelled) return;
        setPreview(value);
        setLoading(false);
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : '录像删除预检失败');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, scope.cid, scope.ojUserId, scope.examSessionId, scope.recordingId]);

  const contestLevel = preview?.scope === 'contest';
  const confirmed = !contestLevel || confirmation === preview?.contestTitle;
  const submit = async () => {
    if (!preview || !confirmed) return;
    setLoading(true);
    setError(null);
    try {
      const result = await executeRecordingDelete(scope, preview.intent, contestLevel ? confirmation : undefined);
      onDeleted();
      if (result.failures.length) {
        setError(`部分删除失败：${result.failures.map((item) => `${item.recordingId}: ${item.error}`).join('；')}`);
        setLoading(false);
        return;
      }
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '录像删除失败');
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>删除录像证据</DialogTitle></DialogHeader>
        {loading && !preview ? <p className="py-8 text-center text-sm text-muted-foreground">正在预检…</p> : null}
        {preview ? (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
              <p>将永久删除 {preview.count} 个文件（{formatBytes(preview.totalBytes)}）。此操作不可恢复。</p>
            </div>
            {contestLevel ? (
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground" htmlFor="recording-delete-title">
                  输入比赛名“{preview.contestTitle}”确认
                </label>
                <Input id="recording-delete-title" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
              </div>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="destructive" disabled={!preview || !confirmed || loading || preview.count === 0} onClick={() => void submit()}>
            确认永久删除
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
