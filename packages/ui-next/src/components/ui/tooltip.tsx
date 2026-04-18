import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

interface TooltipProviderCtx {
  delayDuration: number;
}

const Ctx = createContext<TooltipProviderCtx>({ delayDuration: 300 });

export function TooltipProvider({
  children,
  delayDuration = 300,
}: {
  children: ReactNode;
  delayDuration?: number;
}) {
  return <Ctx.Provider value={{ delayDuration }}>{children}</Ctx.Provider>;
}

/* ------------------------------------------------------------------ */
/*  Tooltip                                                            */
/* ------------------------------------------------------------------ */

interface TooltipState {
  open: boolean;
  setOpen: (v: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  delay: number;
}

const TooltipCtx = createContext<TooltipState | null>(null);

export function Tooltip({ children }: { children: ReactNode }) {
  const { delayDuration } = useContext(Ctx);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  return (
    <TooltipCtx.Provider value={{ open, setOpen, triggerRef, delay: delayDuration }}>
      <span className="relative inline-flex">{children}</span>
    </TooltipCtx.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  Trigger                                                            */
/* ------------------------------------------------------------------ */

export function TooltipTrigger({
  asChild,
  children,
}: {
  asChild?: boolean;
  children: ReactNode;
}) {
  const ctx = useContext(TooltipCtx)!;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const onEnter = useCallback(() => {
    timer.current = setTimeout(() => ctx.setOpen(true), ctx.delay);
  }, [ctx]);

  const onLeave = useCallback(() => {
    clearTimeout(timer.current);
    ctx.setOpen(false);
  }, [ctx]);

  return (
    <span
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      ref={ctx.triggerRef as any}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Content                                                            */
/* ------------------------------------------------------------------ */

export function TooltipContent({
  children,
  side = 'top',
  sideOffset = 4,
  className,
}: {
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  sideOffset?: number;
  className?: string;
}) {
  const ctx = useContext(TooltipCtx)!;
  if (!ctx.open) return null;

  const posClasses: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1',
  };

  return (
    <span
      role="tooltip"
      className={cn(
        'absolute z-50 whitespace-nowrap rounded-md bg-popover px-2.5 py-1 text-xs text-popover-foreground shadow-md border animate-in fade-in-0 zoom-in-95',
        posClasses[side],
        className,
      )}
      style={{ [side === 'top' || side === 'bottom' ? 'marginBlockStart' : 'marginInlineStart']: sideOffset }}
    >
      {children}
    </span>
  );
}
