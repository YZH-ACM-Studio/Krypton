import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { X } from 'lucide-react';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', handler);
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-200 flex items-center justify-center p-3 sm:p-6">
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative w-full max-w-[calc(100vw-1.5rem)] sm:w-auto sm:max-w-[calc(100vw-3rem)]" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function DialogContent({
  className,
  onClose,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { onClose?: () => void }) {
  return (
    <div
      className={cn(
        // flex column so ScrollArea children can be flex-1 + min-h-0 to fill
        // remaining space. Without this, ScrollArea inside dialogs falls back
        // to `height: auto` and the viewport has no scroll context.
        'relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl border bg-background shadow-2xl',
        className,
      )}
      {...props}
    >
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-sm p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="关闭"
        >
          <X className="size-4" />
        </button>
      )}
      {children}
    </div>
  );
}

export function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('shrink-0 border-b px-6 py-4', className)} {...props} />;
}

export function DialogTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-base font-semibold', className)} {...props} />;
}
