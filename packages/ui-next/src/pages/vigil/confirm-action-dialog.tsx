/**
 * ConfirmActionDialog — generic confirm-with-reason prompt used before any
 * high-risk proctor command (lock_screen primarily).
 *
 * Pattern: caller passes the target + label + verb; on confirm it returns
 * the reason string (which then flows into useProctorCommands.sendCommand).
 */
import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form';
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
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmVariant = 'default',
  requireReason = true,
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
      <DialogContent onClose={() => !busy && onOpenChange(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className={confirmVariant === 'destructive' ? 'size-4 shrink-0 text-danger-fg' : 'size-4 shrink-0 text-warning-fg'} />
              <span className="min-w-0">{title}</span>
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {requireReason ? (
            <DialogBody>
              <FormField label="原因（可选）">
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={reasonPlaceholder} rows={3} />
              </FormField>
            </DialogBody>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              取消
            </Button>
            <Button type="submit" variant={confirmVariant === 'destructive' ? 'danger' : 'primary'} disabled={busy}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
