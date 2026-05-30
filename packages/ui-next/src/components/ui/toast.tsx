/**
 * Toast — lightweight top-right notification bus.
 *
 * No external library; the API mirrors what we'd want from `sonner` so
 * future migration is trivial. Imperative call sites use the `toast` object:
 *
 *   const id = toast.loading('正在发送命令...');
 *   toast.success('已发送', { id });   // replaces the loading toast in place
 *   toast.error('客户端离线', { id, duration: 6000 });
 *
 * Mount `<ToastProvider />` once near the root of the app (or any consumer
 * page) and it portals its container to <body>. Subsequent `toast.*` calls
 * flow through the global EventTarget bus regardless of where the provider
 * lives.
 *
 * Used by hooks/use-proctor-commands to surface InfoBar-style command receipts.
 */
import {
  useCallback, useEffect, useState, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

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

/* ─── Provider ─────────────────────────────────────────────────────────── */

const DEFAULT_DURATION: Record<ToastKind, number> = {
  info: 4000,
  success: 3000,
  error: 6000,
  loading: Infinity,
};

export function ToastProvider() {
  const [items, setItems] = useState<InternalToast[]>([]);

  useEffect(() => {
    const onPush = (ev: Event) => {
      const { toast: t } = (ev as CustomEvent<ToastEventDetail>).detail;
      setItems((prev) => {
        const existing = prev.findIndex((p) => p.id === t.id);
        if (existing >= 0) {
          // Swap-in-place: a `loading` toast often becomes `success` or `error`.
          const next = [...prev];
          next[existing] = t;
          return next;
        }
        return [...prev, t];
      });
    };
    const onDismiss = (ev: Event) => {
      const id = (ev as CustomEvent<{ id: string }>).detail.id;
      setItems((prev) => prev.filter((p) => p.id !== id));
    };
    window.addEventListener(TOAST_EVENT, onPush);
    window.addEventListener(TOAST_DISMISS_EVENT, onDismiss);
    return () => {
      window.removeEventListener(TOAST_EVENT, onPush);
      window.removeEventListener(TOAST_DISMISS_EVENT, onDismiss);
    };
  }, []);

  return createPortal(
    <div className="pointer-events-none fixed right-4 top-4 z-[300] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {items.map((t) => (
        <ToastCard key={t.id} t={t} onDismiss={(id) => dismissEmit(id)} />
      ))}
    </div>,
    document.body,
  );
}

function ToastCard({
  t, onDismiss,
}: { t: InternalToast; onDismiss: (id: string) => void }) {
  const dismiss = useCallback(() => onDismiss(t.id), [onDismiss, t.id]);

  useEffect(() => {
    const dur = t.duration ?? DEFAULT_DURATION[t.kind];
    if (!Number.isFinite(dur)) return undefined;
    const timer = setTimeout(dismiss, dur);
    return () => clearTimeout(timer);
  }, [dismiss, t.duration, t.kind]);

  const styles: Record<ToastKind, { ring: string; iconColor: string; Icon: any }> = {
    info: {
      ring: 'border-border bg-background',
      iconColor: 'text-primary',
      Icon: Info,
    },
    success: {
      ring: 'border-emerald-500/40 bg-emerald-500/5',
      iconColor: 'text-emerald-600',
      Icon: CheckCircle2,
    },
    error: {
      ring: 'border-destructive/40 bg-destructive/5',
      iconColor: 'text-destructive',
      Icon: XCircle,
    },
    loading: {
      ring: 'border-border bg-background',
      iconColor: 'text-primary',
      Icon: Loader2,
    },
  };
  const { ring, iconColor, Icon } = styles[t.kind];

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg',
        'animate-in fade-in slide-in-from-top-2 duration-200',
        ring,
      )}
    >
      <Icon
        className={cn(
          'size-4 shrink-0 translate-y-0.5',
          iconColor,
          t.kind === 'loading' && 'animate-spin',
        )}
      />
      <div className="flex-1 space-y-1">
        <p className="text-sm font-medium text-foreground">{t.title}</p>
        {t.description && (
          <p className="text-xs text-muted-foreground">{t.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        title="关闭"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
