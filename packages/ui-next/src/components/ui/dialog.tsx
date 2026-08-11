import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { X } from 'lucide-react';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

interface DialogContextValue {
  titleId: string;
}

const DialogContext = createContext<DialogContextValue | null>(null);
interface OpenDialogEntry {
  root: HTMLElement;
  restoreTarget: HTMLElement | null;
}

const openDialogs: OpenDialogEntry[] = [];
const originalInert = new Map<Element, boolean>();
let originalBodyOverflow: string | null = null;
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(scope: HTMLElement) {
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
  );
}

function restoreElementInert(element: Element) {
  if (originalInert.get(element)) element.setAttribute('inert', '');
  else element.removeAttribute('inert');
}

function syncDialogEnvironment() {
  const topmost = openDialogs[openDialogs.length - 1]?.root || null;
  if (!topmost) {
    document.body.style.overflow = originalBodyOverflow || '';
    originalBodyOverflow = null;
    originalInert.forEach((_value, element) => restoreElementInert(element));
    originalInert.clear();
    return;
  }
  document.body.style.overflow = 'hidden';
  Array.from(document.body.children).forEach((element) => {
    if (!originalInert.has(element)) originalInert.set(element, element.hasAttribute('inert'));
    if (element === topmost) restoreElementInert(element);
    else element.setAttribute('inert', '');
  });
}

function registerDialogRoot(root: HTMLElement, restoreTarget: HTMLElement | null) {
  if (openDialogs.some((entry) => entry.root === root)) throw new Error('Dialog root is already registered');
  if (!openDialogs.length) originalBodyOverflow = document.body.style.overflow;
  openDialogs.push({ root, restoreTarget });
  syncDialogEnvironment();
}

function unregisterDialogRoot(root: HTMLElement) {
  const index = openDialogs.findIndex((entry) => entry.root === root);
  if (index === -1) throw new Error('Dialog root is not registered');
  const wasTopmost = index === openDialogs.length - 1;
  const [removed] = openDialogs.splice(index, 1);
  const nextDialog = openDialogs[index];
  if (!wasTopmost && nextDialog?.restoreTarget && root.contains(nextDialog.restoreTarget)) {
    nextDialog.restoreTarget = removed.restoreTarget;
  }
  syncDialogEnvironment();
  return { removed, wasTopmost, remainingTopmost: openDialogs[openDialogs.length - 1]?.root || null };
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);
  useEffect(() => {
    if (open) return;
    const rememberOutsideFocus = (event?: FocusEvent) => {
      const target = event?.target || document.activeElement;
      if (!(target instanceof HTMLElement) || target.closest('[data-krypton-dialog-root="true"]')) return;
      restoreFocusRef.current = target;
    };
    rememberOutsideFocus();
    document.addEventListener('focusin', rememberOutsideFocus);
    return () => document.removeEventListener('focusin', rememberOutsideFocus);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (!root) throw new Error('Dialog root is unavailable');
    const dialog = root.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) throw new Error('DialogContent is required inside Dialog');

    if (document.activeElement instanceof HTMLElement && !root.contains(document.activeElement)) {
      restoreFocusRef.current = document.activeElement;
    }
    registerDialogRoot(root, restoreFocusRef.current);

    if (!dialog.contains(document.activeElement)) {
      (focusableElements(dialog)[0] || dialog).focus();
    }

    const handler = (e: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1]?.root !== root) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChangeRef.current(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = focusableElements(dialog);
      if (!focusable.length) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      const { removed, wasTopmost, remainingTopmost } = unregisterDialogRoot(root);
      if (wasTopmost) {
        const restoreTarget = removed.restoreTarget;
        if (restoreTarget?.isConnected && (!remainingTopmost || remainingTopmost.contains(restoreTarget))) {
          restoreTarget.focus();
        } else if (remainingTopmost) {
          const remainingDialog = remainingTopmost.querySelector<HTMLElement>('[role="dialog"]');
          if (remainingDialog) (focusableElements(remainingDialog)[0] || remainingDialog).focus();
        }
      }
      restoreFocusRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div ref={rootRef} data-krypton-dialog-root="true" className="fixed inset-0 z-200 flex items-center justify-center p-3 sm:p-6">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => onOpenChange(false)} />
      <div className="relative w-full max-w-[calc(100vw-1.5rem)] sm:w-auto sm:max-w-[calc(100vw-3rem)]" onClick={(e) => e.stopPropagation()}>
        <DialogContext.Provider value={{ titleId }}>{children}</DialogContext.Provider>
      </div>
    </div>,
    document.body,
  );
}

export function DialogContent({ className, onClose, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { onClose?: () => void }) {
  const context = useContext(DialogContext);
  if (!context) throw new Error('DialogContent must be used inside Dialog');
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={context.titleId}
      tabIndex={-1}
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
          aria-label="关闭"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-sm p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="关闭"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
      {children}
    </div>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('shrink-0 border-b px-6 py-4', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const context = useContext(DialogContext);
  if (!context) throw new Error('DialogTitle must be used inside Dialog');
  return <h2 id={context.titleId} className={cn('text-base font-semibold', className)} {...props} />;
}

/**
 * Scrollable dialog body for long forms. DialogContent owns the viewport
 * bound; this flex child shrinks within it while headers and action bars stay
 * visible. Native overflow is intentional here: it remains reliable when the
 * dialog has a max-height rather than a fixed height.
 */
export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', className)} {...props} />;
}
