import type { ReactNode } from 'react';
import {
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  markDialogSlot,
} from '@/components/ui/dialog';
import { cn } from '@/lib/cn';

type TeamDialogTone = 'primary' | 'destructive';

// Callers still append these. Color, radius, and motion stay on Input, Textarea, and Button.
export const TEAM_DIALOG_CONTROL_CLASS = 'w-full';
export const TEAM_DIALOG_TEXTAREA_CLASS = 'min-h-20 w-full resize-y';
export const TEAM_DIALOG_MULTI_SELECT_CLASS = 'min-w-0';
export const TEAM_DIALOG_BUTTON_CLASS = 'min-w-0';

export function TeamDialogContent({
  titleId,
  descriptionId,
  title,
  description,
  icon,
  tone = 'primary',
  onClose,
  className,
  children,
}: {
  titleId: string;
  descriptionId: string;
  title: ReactNode;
  description: ReactNode;
  icon: ReactNode;
  tone?: TeamDialogTone;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const destructive = tone === 'destructive';
  return (
    <DialogContent
      role="dialog"
      aria-modal="true"
      onClose={onClose}
      closeLabel="关闭弹窗"
      className={className}
    >
      <DialogHeader className="flex flex-row items-start gap-3">
        <div
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-lg bg-surface-sunken',
            destructive ? 'text-danger-fg' : 'text-brand-fg',
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <DialogTitle id={titleId} className="text-balance">
            {title}
          </DialogTitle>
          <DialogDescription id={descriptionId} className="text-pretty">
            {description}
          </DialogDescription>
        </div>
      </DialogHeader>
      {children}
    </DialogContent>
  );
}

export function TeamDialogBody({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <DialogBody className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-5', className)}>{children}</DialogBody>
  );
}
markDialogSlot(TeamDialogBody, 'body');

export function TeamDialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <DialogFooter className={className}>{children}</DialogFooter>;
}
markDialogSlot(TeamDialogFooter, 'footer');

export function TeamDialogField({ htmlFor, label, hint, children }: { htmlFor?: string; label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
          {label}
        </label>
        {hint ? <span className="text-xs text-fg-subtle">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
