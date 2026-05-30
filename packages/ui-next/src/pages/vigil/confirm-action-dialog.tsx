/**
 * ConfirmActionDialog — generic confirm-with-reason prompt used before any
 * high-risk proctor command (lock_screen primarily).
 *
 * Pattern: caller passes the target + label + verb; on confirm it returns
 * the reason string (which then flows into useProctorCommands.sendCommand).
 */
import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  confirmVariant?: 'default' | 'destructive';
  /** Required reason; pass false to omit the textarea entirely. */
  requireReason?: boolean;
  reasonPlaceholder?: string;
  /** Called when the user confirms. Receives the entered reason (or empty). */
  onConfirm: (reason: string) => void | Promise<void>;
}

export function ConfirmActionDialog({
  open, onOpenChange, title, description, confirmLabel,
  confirmVariant = 'default', requireReason = true,
  reasonPlaceholder = '（可选）写入审计日志',
  onConfirm,
}: ConfirmActionDialogProps) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      onOpenChange(false);
    } catch {
      // Caller's toast already covers errors.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={busy ? () => {} : onOpenChange}>
      <DialogContent
        className="w-[90vw] max-w-[480px]"
        onClose={() => !busy && onOpenChange(false)}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className={confirmVariant === 'destructive' ? 'size-4 text-destructive' : 'size-4 text-amber-500'} />
            {title}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => { e.preventDefault(); submit(); }}
        >
          <div className="text-sm text-muted-foreground">{description}</div>
          {requireReason && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                原因（可选）
              </label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={reasonPlaceholder}
                rows={3}
              />
            </div>
          )}
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              取消
            </Button>
            <Button type="submit" variant={confirmVariant} disabled={busy}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
