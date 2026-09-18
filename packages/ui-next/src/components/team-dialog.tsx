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

export const TEAM_DIALOG_CONTROL_CLASS =
  'h-12 rounded-[14px] border-border/70 bg-muted/30 px-4 text-base shadow-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-primary/10 sm:text-sm dark:bg-white/[0.035]';

export const TEAM_DIALOG_TEXTAREA_CLASS =
  'min-h-28 resize-none rounded-2xl border-border/70 bg-muted/30 px-4 py-3 text-base leading-6 shadow-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-primary/10 sm:text-sm dark:bg-white/[0.035]';

export const TEAM_DIALOG_MULTI_SELECT_CLASS =
  '[&>div:first-child]:min-h-12 [&>div:first-child]:rounded-[14px] [&>div:first-child]:border-border/70 [&>div:first-child]:bg-muted/30 [&>div:first-child]:px-3 [&>div:first-child]:py-2.5 [&>div:first-child]:transition-[border-color,box-shadow,background-color]';

export const TEAM_DIALOG_BUTTON_CLASS =
  'h-11 rounded-[14px] transition-[scale,background-color,color,box-shadow] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none';

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
      onClose={onClose}
      closeLabel="关闭弹窗"
      closeClassName="right-5 top-5 size-10 rounded-full bg-muted/65 p-0 ring-1 ring-foreground/10 hover:bg-muted hover:text-foreground"
      className={cn(
        'animate-in fade-in-0 zoom-in-95 overflow-hidden rounded-[28px] border-0 bg-background/95 shadow-[0_32px_90px_-34px_rgba(0,0,0,0.72),0_14px_36px_-22px_rgba(0,0,0,0.52)] ring-1 ring-foreground/10 backdrop-blur-xl duration-200 motion-reduce:animate-none sm:w-[32rem]',
        className,
      )}
    >
      <DialogHeader className="flex flex-row items-start gap-4 border-b-0 px-6 pb-5 pt-6 sm:px-7 sm:pt-7">
        <div
          className={cn(
            'grid size-12 shrink-0 place-items-center rounded-2xl shadow-sm ring-1',
            destructive ? 'bg-destructive/10 text-destructive ring-destructive/15' : 'bg-primary/10 text-primary ring-primary/15',
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <DialogTitle id={titleId} className="text-balance text-xl font-semibold leading-tight tracking-tight">
            {title}
          </DialogTitle>
          <DialogDescription id={descriptionId} className="mt-1.5 text-pretty leading-6">
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
    <DialogBody className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-5 px-6 pb-6 pt-1 sm:px-7', className)}>{children}</DialogBody>
  );
}
markDialogSlot(TeamDialogBody, 'body');

export function TeamDialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <DialogFooter className={cn('mt-1 grid grid-cols-2 gap-2.5 border-foreground/10 bg-muted/20 px-6 py-5 sm:px-7 sm:justify-stretch', className)}>
      {children}
    </DialogFooter>
  );
}
markDialogSlot(TeamDialogFooter, 'footer');

export function TeamDialogField({ htmlFor, label, hint, children }: { htmlFor?: string; label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-sm font-semibold">
          {label}
        </label>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
