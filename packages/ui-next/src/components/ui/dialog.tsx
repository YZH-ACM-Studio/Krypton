import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button } from './button';
import { Input } from './input';

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  closeOnOverlayClick?: boolean;
}

type DialogSlot = 'header' | 'title' | 'description' | 'body' | 'footer';

const DIALOG_SLOT: unique symbol = Symbol('krypton.dialogSlot');

interface DialogSlotted {
  [DIALOG_SLOT]?: DialogSlot;
}

export function markDialogSlot<T extends object>(component: T, slot: DialogSlot): T {
  Object.defineProperty(component, DIALOG_SLOT, { value: slot });
  return component;
}

interface DialogContextValue {
  titleId: string;
  descriptionId: string;
  onOpenChange: (open: boolean) => void;
  hasDescription: boolean;
  setHasDescription: (value: boolean) => void;
  requestClose: () => void;
  closeHandlerRef: { current: () => void };
}

const DialogContext = createContext<DialogContextValue | null>(null);

function useDialogContext(name: string): DialogContextValue {
  const context = useContext(DialogContext);
  if (!context) throw new Error(`${name} must be used inside Dialog`);
  return context;
}

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

const SIZE_CLASS: Record<DialogSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
  full: 'sm:max-w-[min(96rem,calc(100vw-3rem))] sm:h-[min(85vh,56rem)]',
};

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

function dialogSlotOf(child: ReactNode): DialogSlot | null {
  if (!isValidElement(child)) return null;
  const type = child.type;
  if (typeof type !== 'function' && (typeof type !== 'object' || type === null)) return null;
  const slot = (type as DialogSlotted)[DIALOG_SLOT];
  return slot === 'header' || slot === 'title' || slot === 'description' || slot === 'body' || slot === 'footer' ? slot : null;
}

function partitionDialogChildren(children: ReactNode) {
  const headers: ReactNode[] = [];
  const bodies: ReactNode[] = [];
  const footers: ReactNode[] = [];
  let explicitBody = false;

  Children.forEach(children, (child) => {
    const slot = dialogSlotOf(child);
    if (slot === 'header' || slot === 'title' || slot === 'description') {
      headers.push(child);
      return;
    }
    if (slot === 'footer') {
      footers.push(child);
      return;
    }
    if (slot === 'body') {
      explicitBody = true;
      bodies.push(child);
      return;
    }
    bodies.push(child);
  });

  return { headers, bodies, footers, explicitBody };
}

function renderPartitionedParts(parts: ReturnType<typeof partitionDialogChildren>) {
  const body = parts.explicitBody ? (
    parts.bodies
  ) : parts.bodies.length ? (
    <DialogBody>{parts.bodies}</DialogBody>
  ) : null;
  return (
    <>
      {parts.headers}
      {body}
      {parts.footers}
    </>
  );
}

function isDialogChrome(child: ReactNode): boolean {
  const slot = dialogSlotOf(child);
  return slot === 'header' || slot === 'title' || slot === 'description' || slot === 'footer';
}

function renderDialogChildren(children: ReactNode) {
  const counted = Children.toArray(children);
  const formIndex = counted.findIndex((child) => isValidElement(child) && child.type === 'form');
  if (formIndex !== -1) {
    const form = counted[formIndex] as ReactElement<HTMLAttributes<HTMLFormElement>>;
    const siblings = counted.filter((_, index) => index !== formIndex);
    if (siblings.every((sibling) => isDialogChrome(sibling))) {
      return (
        <form {...form.props} className={cn('flex min-h-0 flex-1 flex-col', form.props.className)}>
          {renderPartitionedParts(partitionDialogChildren([...siblings, ...Children.toArray(form.props.children)]))}
        </form>
      );
    }
  }
  return renderPartitionedParts(partitionDialogChildren(children));
}

export function Dialog({ open, onOpenChange, children, closeOnOverlayClick = true }: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const [hasDescription, setHasDescription] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  const requestCloseRef = useRef(() => {
    onOpenChangeRef.current(false);
  });
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
        requestCloseRef.current();
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
    <div
      ref={rootRef}
      data-krypton-dialog-root="true"
      className="fixed inset-0 z-200 flex items-end justify-center p-0 sm:items-center sm:p-6"
    >
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => {
          if (closeOnOverlayClick) requestCloseRef.current();
        }}
      />
      <div
        className="relative w-full min-w-0 max-w-full sm:w-auto sm:max-w-[calc(100dvw-3rem)]"
        onClick={(event) => event.stopPropagation()}
      >
        <DialogContext.Provider value={{ titleId, descriptionId, onOpenChange, hasDescription, setHasDescription, requestClose: () => requestCloseRef.current(), closeHandlerRef: requestCloseRef }}>
          {children}
        </DialogContext.Provider>
      </div>
    </div>,
    document.body,
  );
}

export function DialogContent({
  className,
  onClose,
  children,
  size = 'md',
  showCloseButton = true,
  closeLabel = '关闭',
  closeClassName,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  onClose?: () => void;
  size?: DialogSize;
  showCloseButton?: boolean;
  closeLabel?: string;
  closeClassName?: string;
}) {
  const context = useDialogContext('DialogContent');
  const handleClose = () => {
    if (onClose) onClose();
    else context.onOpenChange(false);
  };
  context.closeHandlerRef.current = handleClose;
  return (
    <div
      {...props}
      role="dialog"
      aria-modal="true"
      aria-labelledby={context.titleId}
      aria-describedby={context.hasDescription ? context.descriptionId : undefined}
      tabIndex={-1}
      data-slot="dialog-content"
      className={cn(
        'relative flex w-full flex-col overflow-hidden border bg-background shadow-2xl',
        'max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)))]',
        'rounded-t-xl pb-[env(safe-area-inset-bottom)] sm:rounded-xl sm:max-h-[85vh] sm:pb-0',
        SIZE_CLASS[size],
        className,
      )}
    >
      {renderDialogChildren(children)}
      {showCloseButton ? (
        <button
          type="button"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={handleClose}
          className={cn(
            'absolute right-3 top-3 z-10 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
            closeClassName,
          )}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="dialog-header" className={cn('shrink-0 border-b px-6 py-4', className)} {...props} />;
}
markDialogSlot(DialogHeader, 'header');

export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  const context = useDialogContext('DialogTitle');
  return <h2 {...props} id={context.titleId} data-slot="dialog-title" className={cn('pr-8 text-base font-semibold', className)} />;
}
markDialogSlot(DialogTitle, 'title');

export function DialogDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  const context = useDialogContext('DialogDescription');
  const setHasDescription = context.setHasDescription;
  useEffect(() => {
    setHasDescription(true);
    return () => setHasDescription(false);
  }, [setHasDescription]);
  return (
    <p
      {...props}
      id={context.descriptionId}
      data-slot="dialog-description"
      className={cn('mt-1 text-sm text-muted-foreground', className)}
    />
  );
}
markDialogSlot(DialogDescription, 'description');

export function DialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      data-slot="dialog-body"
      data-scroll-owner="dialog"
      className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain krypton-scrollbar', className)}
    />
  );
}
markDialogSlot(DialogBody, 'body');

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex shrink-0 flex-col-reverse gap-2 border-t px-6 py-4 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}
markDialogSlot(DialogFooter, 'footer');

export function DialogClose({ className, children, ...props }: HTMLAttributes<HTMLButtonElement>) {
  const context = useDialogContext('DialogClose');
  return (
    <button type="button" className={className} onClick={() => context.onOpenChange(false)} {...props}>
      {children}
    </button>
  );
}

export interface AlertDialogOptions {
  title?: string;
  confirmLabel?: string;
}

export interface ConfirmDialogOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface PromptDialogOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  defaultValue?: string;
  placeholder?: string;
}

type DialogCommand =
  | { id: number; kind: 'alert'; message: string; title: string; confirmLabel: string; resolve: () => void }
  | {
      id: number;
      kind: 'confirm';
      message: string;
      title: string;
      confirmLabel: string;
      cancelLabel: string;
      destructive: boolean;
      resolve: (value: boolean) => void;
    }
  | {
      id: number;
      kind: 'prompt';
      message: string;
      title: string;
      confirmLabel: string;
      cancelLabel: string;
      defaultValue: string;
      placeholder?: string;
      resolve: (value: string | null) => void;
    };

const commandQueue: DialogCommand[] = [];
const commandListeners = new Set<() => void>();
let nextCommandId = 1;
let dialogHostMounted = 0;

function emitDialogCommands() {
  commandListeners.forEach((listener) => listener());
}

function subscribeDialogCommands(listener: () => void) {
  commandListeners.add(listener);
  return () => {
    commandListeners.delete(listener);
  };
}

function getDialogCommandSnapshot() {
  return commandQueue[0] || null;
}

type DialogCommandResult<T> = T extends { kind: 'alert' }
  ? void
  : T extends { kind: 'confirm' }
    ? boolean
    : T extends { kind: 'prompt' }
      ? string | null
      : never;

function enqueueDialogCommand<T extends Omit<DialogCommand, 'id'>>(command: T): Promise<DialogCommandResult<T>> {
  if (dialogHostMounted === 0) throw new Error('DialogHost is not mounted');
  return new Promise<DialogCommandResult<T>>((resolve) => {
    commandQueue.push({ ...command, id: nextCommandId++, resolve } as DialogCommand);
    emitDialogCommands();
  });
}

function finishDialogCommand(id: number, apply: () => void) {
  if (commandQueue[0]?.id !== id) return;
  commandQueue.shift();
  apply();
  emitDialogCommands();
}

export function alertDialog(message: string, options: AlertDialogOptions = {}): Promise<void> {
  return enqueueDialogCommand({
    kind: 'alert',
    message,
    title: options.title || '提示',
    confirmLabel: options.confirmLabel || '知道了',
    resolve: () => undefined,
  });
}

export function confirmDialog(message: string, options: ConfirmDialogOptions = {}): Promise<boolean> {
  return enqueueDialogCommand({
    kind: 'confirm',
    message,
    title: options.title || '确认',
    confirmLabel: options.confirmLabel || '确认',
    cancelLabel: options.cancelLabel || '取消',
    destructive: options.destructive === true,
    resolve: (value: boolean) => value,
  });
}

export function promptDialog(message: string, options: PromptDialogOptions = {}): Promise<string | null> {
  return enqueueDialogCommand({
    kind: 'prompt',
    message,
    title: options.title || '输入',
    confirmLabel: options.confirmLabel || '确定',
    cancelLabel: options.cancelLabel || '取消',
    defaultValue: options.defaultValue || '',
    placeholder: options.placeholder,
    resolve: (value: string | null) => value,
  });
}

export async function confirmFormSubmit(
  event: FormEvent<HTMLFormElement>,
  message: string,
  options?: ConfirmDialogOptions,
): Promise<boolean> {
  event.preventDefault();
  const form = event.currentTarget;
  const confirmed = await confirmDialog(message, options);
  if (confirmed) form.submit();
  return confirmed;
}

export function DialogHost() {
  useEffect(() => {
    if (dialogHostMounted !== 0) throw new Error('DialogHost can only be mounted once');
    dialogHostMounted = 1;
    return () => {
      dialogHostMounted = 0;
      while (commandQueue.length) {
        const command = commandQueue.shift();
        if (!command) break;
        if (command.kind === 'alert') command.resolve();
        else if (command.kind === 'confirm') command.resolve(false);
        else command.resolve(null);
      }
      emitDialogCommands();
    };
  }, []);
  const current = useSyncExternalStore(subscribeDialogCommands, getDialogCommandSnapshot, getDialogCommandSnapshot);
  const [promptDraft, setPromptDraft] = useState({ id: 0, value: '' });
  const promptValue = current?.kind === 'prompt'
    ? (promptDraft.id === current.id ? promptDraft.value : current.defaultValue)
    : '';

  if (!current) return null;

  const dismiss = () => {
    if (current.kind === 'alert') finishDialogCommand(current.id, () => current.resolve());
    else if (current.kind === 'confirm') finishDialogCommand(current.id, () => current.resolve(false));
    else finishDialogCommand(current.id, () => current.resolve(null));
  };

  return (
    <Dialog key={current.id} open onOpenChange={(open) => !open && dismiss()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{current.title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3 px-6 py-4">
          <DialogDescription className="whitespace-pre-wrap">{current.message}</DialogDescription>
          {current.kind === 'prompt' ? (
            <Input
              autoFocus
              value={promptValue}
              placeholder={current.placeholder}
              onChange={(event) => setPromptDraft({ id: current.id, value: event.target.value })}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                finishDialogCommand(current.id, () => current.resolve(promptValue));
              }}
            />
          ) : null}
        </DialogBody>
        <DialogFooter>
          {current.kind === 'alert' ? (
            <Button type="button" onClick={() => finishDialogCommand(current.id, () => current.resolve())}>
              {current.confirmLabel}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={dismiss}>
                {current.cancelLabel}
              </Button>
              <Button
                type="button"
                variant={current.kind === 'confirm' && current.destructive ? 'destructive' : 'default'}
                onClick={() => {
                  if (current.kind === 'confirm') finishDialogCommand(current.id, () => current.resolve(true));
                  else finishDialogCommand(current.id, () => current.resolve(promptValue));
                }}
              >
                {current.confirmLabel}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
