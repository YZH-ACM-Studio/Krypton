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
 *
 * Chrome: opaque scrim, raised panel, z-50. SheetContent owns overflow-hidden;
 * SheetBody is the single scroll owner (ScrollArea). Enter and leave are
 * declarative `motion` poses so the first frame is off-screen.
 */
import { createContext, useContext, useEffect, useId, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea, type ScrollAreaProps } from '@/components/ui/scroll-area';
import { cn } from '@/lib/cn';
import { MOTION } from './motion';

type SheetSide = 'left' | 'right' | 'top' | 'bottom';

const HIDDEN_POSE: Record<SheetSide, { x: string } | { y: string }> = {
  right: { x: '100%' },
  left: { x: '-100%' },
  top: { y: '-100%' },
  bottom: { y: '100%' },
};

interface SheetContextValue {
  onOpenChange: (open: boolean) => void;
  titleId: string;
}
const SheetContext = createContext<SheetContextValue | null>(null);

function useSheetContext(): SheetContextValue {
  const v = useContext(SheetContext);
  if (!v) throw new Error('SheetContent / SheetHeader / SheetBody must be rendered inside <Sheet>.');
  return v;
}

function sheetTransition(token: typeof MOTION.enter, duration = token.duration) {
  const [x1, y1, x2, y2] = token.ease;
  if (token.ease.length !== 4 || x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    throw new TypeError('Sheet motion ease must be a four-number bezier');
  }
  return { duration, ease: [x1, y1, x2, y2] as const };
}

/** Caller width includes `w-` / `max-w-` and variants such as `sm:max-w-[640px]`. */
function callerSetsWidth(className: string | undefined): boolean {
  return /(?:^|\s)(?:[\w-]+:)*(?:max-w|w)-/.test(className ?? '');
}

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

function SheetSurface({
  titleId,
  onOpenChange,
  children,
}: {
  titleId: string;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <SheetContext.Provider value={{ onOpenChange, titleId }}>
      <div className="pointer-events-none fixed inset-0 z-50">
        <motion.div
          className="pointer-events-auto fixed inset-0 bg-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: sheetTransition(MOTION.enter) }}
          exit={{ opacity: 0, transition: sheetTransition(MOTION.exit) }}
          onClick={() => onOpenChange(false)}
        />
        <div className="pointer-events-none relative h-full w-full">
          {children}
        </div>
      </div>
    </SheetContext.Provider>
  );
}

export function Sheet({ open, onOpenChange, children }: SheetProps) {
  const titleId = useId();
  const openRef = useRef(open);
  openRef.current = open;
  const lockedOverflow = useRef<string | null>(null);
  const aliveRef = useRef(true);
  // Keep the portal through the exit. Dropping it when open becomes false
  // unmounts AnimatePresence before the leave can finish.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) {
    setMounted(true);
  }

  const releaseScrollLock = () => {
    if (lockedOverflow.current === null) return;
    document.body.style.overflow = lockedOverflow.current;
    lockedOverflow.current = null;
  };

  useEffect(() => {
    if (!open) return;
    if (lockedOverflow.current === null) {
      lockedOverflow.current = document.body.style.overflow;
    }
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onOpenChange]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      releaseScrollLock();
    };
  }, []);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence
      onExitComplete={() => {
        if (!aliveRef.current || openRef.current) return;
        releaseScrollLock();
        setMounted(false);
      }}
    >
      {open ? (
        <SheetSurface
          key="krypton-sheet"
          titleId={titleId}
          onOpenChange={onOpenChange}
        >
          {children}
        </SheetSurface>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

interface SheetContentProps extends HTMLAttributes<HTMLDivElement> {
  side?: SheetSide;
}

export function SheetContent({ side = 'right', className, children, ...props }: SheetContentProps) {
  const ctx = useSheetContext();
  const shown = useIsPresent();
  const hidden = HIDDEN_POSE[side];
  const horizontal = side === 'right' || side === 'left';
  const sideClasses: Record<SheetSide, string> = {
    right: 'right-0 top-0 h-full border-l',
    left: 'left-0 top-0 h-full border-r',
    top: 'left-0 top-0 w-full border-b',
    bottom: 'left-0 bottom-0 w-full border-t',
  };
  // motion.div treats these names as gestures, so they cannot be spread through.
  const {
    onDrag: _onDrag,
    onDragStart: _onDragStart,
    onDragEnd: _onDragEnd,
    onAnimationStart: _onAnimationStart,
    onAnimationEnd: _onAnimationEnd,
    onAnimationIteration: _onAnimationIteration,
    ...panelProps
  } = props;
  return (
    <motion.div
      {...panelProps}
      role="dialog"
      aria-modal="true"
      // Exit keeps the node mounted. Drop the dialog role until the leave
      // finishes so it is not still exposed as open. Keep the literals above.
      {...(shown ? {} : { role: undefined, 'aria-modal': undefined })}
      aria-labelledby={ctx.titleId}
      // Same render that starts the leave: the node stays mounted for the
      // exit pose, but it must not take clicks or focus.
      inert={shown ? undefined : true}
      data-krypton-sheet=""
      data-side={side}
      initial={hidden}
      animate={{ x: 0, y: 0, transition: sheetTransition(MOTION.enter, MOTION.enter.duration * 1.25) }}
      exit={{ ...hidden, transition: sheetTransition(MOTION.exit) }}
      className={cn(
        'pointer-events-auto fixed flex flex-col overflow-hidden overscroll-contain border-line bg-surface-raised pb-[env(safe-area-inset-bottom)] shadow-pop',
        sideClasses[side],
        horizontal ? 'w-full max-w-[calc(100dvw-2rem)]' : 'h-[400px] max-h-[calc(100dvh-2rem)]',
        horizontal && !callerSetsWidth(className) && 'md:max-w-md',
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        className="absolute top-3 right-3 z-10"
        aria-label="关闭"
        title="关闭"
        onClick={() => ctx.onOpenChange(false)}
      >
        <X aria-hidden="true" />
      </Button>
      {children}
    </motion.div>
  );
}

export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  // Block flow, not a flex row: title, description, and tags stack. shrink-0
  // keeps a multi-line header from collapsing to min-h-14 under the body.
  return (
    <div
      className={cn('relative min-h-14 shrink-0 border-b border-line-subtle px-5 py-3 pr-12', className)}
      {...props}
    />
  );
}

export function SheetTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  const ctx = useSheetContext();
  return <h2 id={ctx.titleId} className={cn('text-md font-semibold', className)} {...props} />;
}

/**
 * Single scroll owner for drawer body. SheetContent stays overflow-hidden so
 * headers and footers do not compete with a second native scrollbar.
 */
export function SheetBody({ className, viewportClassName, children, ...props }: ScrollAreaProps) {
  return (
    <ScrollArea
      {...props}
      data-scroll-owner="sheet"
      className={cn('min-h-0 flex-1', className)}
      viewportClassName={cn('overscroll-contain', viewportClassName)}
    >
      {children}
    </ScrollArea>
  );
}
