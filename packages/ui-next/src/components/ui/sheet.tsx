/**
 * Side-anchored drawer (Sheet) component.
 *
 * Same Portal+overlay+ESC pattern as `<Dialog>` but anchors the inner content
 * to one edge of the viewport (right by default — the most common drawer
 * direction). Used by admin-tasks editor's node-detail panel and the
 * candidates page drill-in.
 *
 * Wraps `onOpenChange` in a React context so the internal X-button on
 * SheetContent and any consumer-rendered close affordances can dismiss
 * without an explicit prop. API mirrors shadcn's Sheet.
 */
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

type SheetSide = 'left' | 'right' | 'top' | 'bottom';

interface SheetContextValue {
  onOpenChange: (open: boolean) => void;
}
const SheetContext = createContext<SheetContextValue | null>(null);

function useSheetContext(): SheetContextValue {
  const v = useContext(SheetContext);
  if (!v) throw new Error('SheetContent / SheetHeader must be rendered inside <Sheet>.');
  return v;
}

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function Sheet({ open, onOpenChange, children }: SheetProps) {
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
    <SheetContext.Provider value={{ onOpenChange }}>
      <div className="fixed inset-0 z-200">
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => onOpenChange(false)}
        />
        <div className="relative h-full w-full" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      </div>
    </SheetContext.Provider>,
    document.body,
  );
}

interface SheetContentProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: SheetSide;
}

export function SheetContent({
  side = 'right', className, children, ...props
}: SheetContentProps) {
  const ctx = useSheetContext();
  const sideClasses: Record<SheetSide, string> = {
    right: 'right-0 top-0 h-full border-l',
    left: 'left-0 top-0 h-full border-r',
    top: 'left-0 top-0 w-full border-b',
    bottom: 'left-0 bottom-0 w-full border-t',
  };
  return (
    <div
      className={cn(
        'fixed bg-background shadow-2xl flex flex-col overflow-hidden',
        sideClasses[side],
        // Default sizing — consumers can override via className.
        side === 'right' || side === 'left' ? 'w-[400px] max-w-[calc(100vw-2rem)]' : 'h-[400px] max-h-[calc(100vh-2rem)]',
        className,
      )}
      {...props}
    >
      <button
        type="button"
        onClick={() => ctx.onOpenChange(false)}
        className="absolute right-3 top-3 z-10 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        title="关闭"
      >
        <X className="size-4" />
      </button>
      {children}
    </div>
  );
}

export function SheetHeader({
  className, ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('shrink-0 border-b px-6 py-4', className)} {...props} />;
}

export function SheetTitle({
  className, ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-base font-semibold pr-8', className)} {...props} />;
}
