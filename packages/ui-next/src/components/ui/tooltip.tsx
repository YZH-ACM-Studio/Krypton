import { Slot } from '@radix-ui/react-slot';
import {
  createContext,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { calculateTooltipPosition, type TooltipPosition, type TooltipSide } from './tooltip-position';

interface TooltipProviderCtx {
  delayDuration: number;
}

const ProviderCtx = createContext<TooltipProviderCtx>({ delayDuration: 300 });

export function TooltipProvider({ children, delayDuration = 300 }: { children: ReactNode; delayDuration?: number }) {
  return <ProviderCtx.Provider value={{ delayDuration }}>{children}</ProviderCtx.Provider>;
}

interface TooltipState {
  open: boolean;
  setOpen: (value: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  delay: number;
  contentId: string;
}

const TooltipCtx = createContext<TooltipState | null>(null);

function useTooltipContext(component: string): TooltipState {
  const ctx = useContext(TooltipCtx);
  if (!ctx) throw new Error(`${component} must be used inside Tooltip`);
  return ctx;
}

export function Tooltip({ children }: { children: ReactNode }) {
  const { delayDuration } = useContext(ProviderCtx);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const contentId = useId();

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return <TooltipCtx.Provider value={{ open, setOpen, triggerRef, delay: delayDuration, contentId }}>{children}</TooltipCtx.Provider>;
}

export function TooltipTrigger({ asChild = false, children }: { asChild?: boolean; children: ReactNode }) {
  const ctx = useTooltipContext('TooltipTrigger');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovered = useRef(false);
  const focused = useRef(false);

  const clearTimer = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const openWithDelay = useCallback(() => {
    clearTimer();
    if (ctx.delay <= 0) {
      ctx.setOpen(true);
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = undefined;
      ctx.setOpen(true);
    }, ctx.delay);
  }, [clearTimer, ctx]);

  const openNow = useCallback(() => {
    clearTimer();
    ctx.setOpen(true);
  }, [clearTimer, ctx]);

  const closeIfInactive = useCallback(() => {
    clearTimer();
    if (!hovered.current && !focused.current) ctx.setOpen(false);
  }, [clearTimer, ctx]);

  const handleMouseEnter = useCallback(() => {
    hovered.current = true;
    openWithDelay();
  }, [openWithDelay]);

  const handleMouseLeave = useCallback(() => {
    hovered.current = false;
    closeIfInactive();
  }, [closeIfInactive]);

  const handleFocus = useCallback(() => {
    focused.current = true;
    openNow();
  }, [openNow]);

  const handleBlur = useCallback(() => {
    focused.current = false;
    closeIfInactive();
  }, [closeIfInactive]);

  const Comp = asChild ? Slot : 'span';

  return (
    <Comp
      ref={ctx.triggerRef as Ref<HTMLElement>}
      className={asChild ? undefined : 'inline-flex'}
      aria-describedby={ctx.open ? ctx.contentId : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      {children}
    </Comp>
  );
}

export function TooltipContent({
  children,
  side = 'top',
  sideOffset = 4,
  className,
}: {
  children: ReactNode;
  side?: TooltipSide;
  sideOffset?: number;
  className?: string;
}) {
  const ctx = useTooltipContext('TooltipContent');
  const contentRef = useRef<HTMLSpanElement | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = ctx.triggerRef.current;
    const content = contentRef.current;
    if (!trigger || !content) return;

    const next = calculateTooltipPosition(trigger.getBoundingClientRect(), content.getBoundingClientRect(), side, sideOffset, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    setPosition((current) =>
      current && current.left === next.left && current.top === next.top && current.side === next.side ? current : next,
    );
  }, [ctx.triggerRef, side, sideOffset]);

  useLayoutEffect(() => {
    if (!ctx.open) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    document.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('scroll', updatePosition, true);
    };
  }, [ctx.open, updatePosition]);

  useEffect(() => {
    if (!ctx.open) setPosition(null);
  }, [ctx.open]);

  if (!ctx.open || typeof document === 'undefined') return null;

  return createPortal(
    <span
      ref={contentRef}
      id={ctx.contentId}
      role="tooltip"
      data-side={position?.side || side}
      className={cn(
        'pointer-events-none fixed z-200 whitespace-nowrap rounded-[10px] bg-popover/95 px-3 py-2 text-sm font-medium text-popover-foreground shadow-[0_8px_24px_oklch(0_0_0_/_0.16),0_0_0_1px_oklch(0_0_0_/_0.07)] backdrop-blur-md animate-in fade-in-0 zoom-in-95 duration-150 dark:shadow-[0_8px_24px_oklch(0_0_0_/_0.45),0_0_0_1px_oklch(1_0_0_/_0.10)]',
        className,
      )}
      style={{
        position: 'fixed',
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {children}
    </span>,
    document.body,
  );
}
