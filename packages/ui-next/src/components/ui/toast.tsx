/**
 * Toast — bottom-center (phone) / bottom-right (sm+) notification bus.
 *
 * No external library. Imperative call sites use the `toast` object:
 *
 *   const id = toast.loading('正在发送命令...');
 *   toast.success('已发送', { id });   // replaces the loading toast in place
 *   toast.error('客户端离线', { id, duration: 6000 });
 *
 * Mount `<ToastProvider>` near the root. The first mounted provider owns the
 * portal and the event bus; nested providers only render children. After that
 * host unmounts, the next provider to mount becomes the host. Already-mounted
 * providers do not take over.
 */
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { useMotionTokens, type MotionTokens } from './motion';

type ToastKind = 'info' | 'success' | 'error' | 'loading';

interface ToastInput {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  kind: ToastKind;
  /** ms; default depends on kind. Pass `Infinity` to keep until dismissed. */
  duration?: number;
}

interface InternalToast extends ToastInput {
  id: string;
}

interface ToastEventDetail {
  toast: InternalToast;
}

const TOAST_EVENT = 'krypton:toast';
const TOAST_DISMISS_EVENT = 'krypton:toast-dismiss';

/**
 * Live host count, 0 or 1. Guests do not take a slot: after the host unmounts,
 * the next provider to mount becomes host even if a guest is still mounted.
 * A guest that is already mounted does not re-elect itself.
 */
let activeHosts = 0;

const interactive =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-(--dur-1) ease-(--ease-standard)';

export const TOAST_DURATIONS: Record<ToastKind, number> = {
  info: 4000,
  success: 3000,
  error: 6000,
  loading: Infinity,
};

function emit(detail: ToastEventDetail) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail }));
}

function dismissEmit(id: string) {
  window.dispatchEvent(new CustomEvent(TOAST_DISMISS_EVENT, { detail: { id } }));
}

function genId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function publish(kind: ToastKind, title: ReactNode, opts: Partial<ToastInput> = {}): string {
  const id = opts.id || genId();
  emit({
    toast: {
      id,
      kind,
      title,
      description: opts.description,
      duration: opts.duration,
    },
  });
  return id;
}

export const toast = {
  info: (title: ReactNode, opts?: Partial<ToastInput>) => publish('info', title, opts),
  success: (title: ReactNode, opts?: Partial<ToastInput>) => publish('success', title, opts),
  error: (title: ReactNode, opts?: Partial<ToastInput>) => publish('error', title, opts),
  /** Returns the toast id; pass it to a follow-up call to swap in place. */
  loading: (title: ReactNode, opts?: Partial<ToastInput>) => publish('loading', title, opts),
  dismiss: (id: string) => dismissEmit(id),
};

function toastTransition(token: MotionTokens['enter']) {
  const [x1, y1, x2, y2] = token.ease;
  if (token.ease.length !== 4 || x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    throw new TypeError('Toast motion ease must be a four-number bezier');
  }
  return { duration: token.duration, ease: [x1, y1, x2, y2] as const };
}

function Spinner({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden className={cn('size-4 animate-[kr-spin_.7s_linear_infinite]', className)} {...props}>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity=".22" strokeWidth="1.5" />
      <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ToastGlyph({ kind }: { kind: ToastKind }) {
  if (kind === 'success') {
    return <CheckCircle2 className="size-4 text-success-fg" aria-hidden="true" />;
  }
  if (kind === 'error') {
    return <XCircle className="size-4 text-danger-fg" aria-hidden="true" />;
  }
  if (kind === 'loading') {
    return <Spinner className="text-fg-subtle" />;
  }
  return <Info className="size-4 text-info-fg" aria-hidden="true" />;
}

/* ─── Provider ─────────────────────────────────────────────────────────── */

export function ToastProvider({ children }: { children?: ReactNode }) {
  const [isHost, setIsHost] = useState(false);
  const [items, setItems] = useState<InternalToast[]>([]);
  // StrictMode replays the effect on the same fiber. The first setup freezes
  // the decision so a guest cannot grab the slot during the host's cleanup gap,
  // and the original host keeps it when that setup runs again.
  const electedHost = useRef<boolean | null>(null);

  useEffect(() => {
    if (electedHost.current === null) {
      electedHost.current = activeHosts === 0;
    }
    if (electedHost.current !== true) {
      setIsHost(false);
      return undefined;
    }
    activeHosts += 1;
    const onPush = (ev: Event) => {
      const { toast: next } = (ev as CustomEvent<ToastEventDetail>).detail;
      setItems((prev) => {
        const existing = prev.findIndex((item) => item.id === next.id);
        if (existing >= 0) {
          // Swap-in-place: a `loading` toast often becomes `success` or `error`.
          const updated = [...prev];
          updated[existing] = next;
          return updated;
        }
        return [...prev, next];
      });
    };
    const onDismiss = (ev: Event) => {
      const id = (ev as CustomEvent<{ id: string }>).detail.id;
      setItems((prev) => prev.filter((item) => item.id !== id));
    };
    window.addEventListener(TOAST_EVENT, onPush);
    window.addEventListener(TOAST_DISMISS_EVENT, onDismiss);
    setIsHost(true);
    return () => {
      window.removeEventListener(TOAST_EVENT, onPush);
      window.removeEventListener(TOAST_DISMISS_EVENT, onDismiss);
      activeHosts -= 1;
    };
  }, []);

  return (
    <>
      {children}
      {isHost
        ? createPortal(
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-70 flex flex-col items-center gap-2 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:items-end sm:p-5">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <ToastCard key={item.id} t={item} />
              ))}
            </AnimatePresence>
          </div>,
          document.body,
        )
        : null}
    </>
  );
}

function ToastCard({ t }: { t: InternalToast }) {
  const motionTokens = useMotionTokens();

  useEffect(() => {
    const dur = t.duration ?? TOAST_DURATIONS[t.kind];
    if (!Number.isFinite(dur)) {
      return undefined;
    }
    const timer = setTimeout(() => dismissEmit(t.id), dur);
    return () => clearTimeout(timer);
  }, [t.duration, t.id, t.kind]);

  return (
    <motion.div
      layout
      role={t.kind === 'error' ? 'alert' : 'status'}
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: toastTransition(motionTokens.enter) }}
      exit={{ opacity: 0, scale: 0.98, transition: toastTransition(motionTokens.exit) }}
      transition={motionTokens.spring}
      className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-line bg-surface-raised p-3 pr-2 shadow-pop"
    >
      <span className="mt-0.5">
        <ToastGlyph kind={t.kind} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-fg">{t.title}</div>
        {t.description ? <div className="mt-0.5 text-xs text-fg-muted">{t.description}</div> : null}
      </div>
      <button
        type="button"
        aria-label="关闭"
        onClick={() => dismissEmit(t.id)}
        className={cn(interactive, 'grid size-6 shrink-0 place-items-center rounded-sm text-fg-subtle hover:bg-surface-hover hover:text-fg')}
      >
        <X className="size-3.5" />
      </button>
    </motion.div>
  );
}
