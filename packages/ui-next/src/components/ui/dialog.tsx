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
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { cn } from '../../lib/cn';
import { Button } from './button';
import { Input } from './input';
import { useBreakpoint } from './media';
import { MOTION } from './motion';

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

function dialogTransition(token: typeof MOTION.enter) {
  const [x1, y1, x2, y2] = token.ease;
  if (token.ease.length !== 4 || x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    throw new TypeError('Dialog motion ease must be a four-number bezier');
  }
  return { duration: token.duration, ease: [x1, y1, x2, y2] as const };
}

function DialogViewport({
  rootRef,
  closeOnOverlayClick,
  onOverlayClose,
  children,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  closeOnOverlayClick: boolean;
  onOverlayClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      ref={rootRef}
      data-krypton-dialog-root="true"
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
    >
      <motion.div
        className="absolute inset-0 bg-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: dialogTransition(MOTION.enter) }}
        exit={{ opacity: 0, transition: dialogTransition(MOTION.exit) }}
        onClick={() => {
          if (closeOnOverlayClick) onOverlayClose();
        }}
      />
      <div
        className="relative w-full min-w-0 max-w-full sm:w-auto sm:max-w-[calc(100dvw-3rem)]"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function Dialog({ open, onOpenChange, children, closeOnOverlayClick = true }: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const [hasDescription, setHasDescription] = useState(false);
  // Keep the portal through the exit. Dropping it on the same render as open=false
  // unmounts AnimatePresence before the leave can finish, and a closed dialog must
  // not call createPortal once that leave is done (static markup has no container).
  const [present, setPresent] = useState(open);
  if (open && !present) {
    setPresent(true);
  }
  const rootRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
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
        // Focusing <body> does not take focus from a control. Drop it here, in the
        // same cleanup as unregister, so a leaving dialog cannot keep the key trap.
        const active = document.activeElement;
        if (active instanceof HTMLElement && root.contains(active)) {
          active.blur();
        }
      }
      restoreFocusRef.current = null;
    };
  }, [open]);

  if (!present) {
    return null;
  }

  return createPortal(
    <AnimatePresence
      onExitComplete={() => {
        if (!openRef.current) {
          setPresent(false);
        }
      }}
    >
      {open ? (
        <DialogViewport
          key="krypton-dialog"
          rootRef={rootRef}
          closeOnOverlayClick={closeOnOverlayClick}
          onOverlayClose={() => requestCloseRef.current()}
        >
          <DialogContext.Provider value={{ titleId, descriptionId, onOpenChange, hasDescription, setHasDescription, requestClose: () => requestCloseRef.current(), closeHandlerRef: requestCloseRef }}>
            {children}
          </DialogContext.Provider>
        </DialogViewport>
      ) : null}
    </AnimatePresence>,
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
  const present = useIsPresent();
  const wide = useBreakpoint('sm');
  const hidden = wide ? { opacity: 0, scale: 0.97, y: 8 } : { y: '100%' };
  const handleClose = () => {
    if (onClose) onClose();
    else context.onOpenChange(false);
  };
  context.closeHandlerRef.current = handleClose;
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
      // Exit keeps the node mounted. inert is not hidden from Testing Library,
      // so drop the dialog role until the leave finishes. Keep the literals above.
      {...(present ? {} : { role: undefined, 'aria-modal': undefined })}
      inert={present ? undefined : true}
      aria-labelledby={context.titleId}
      aria-describedby={context.hasDescription ? context.descriptionId : undefined}
      tabIndex={-1}
      data-slot="dialog-content"
      initial={hidden}
      animate={{ opacity: 1, scale: 1, y: 0, transition: dialogTransition(MOTION.enter) }}
      exit={{ ...hidden, transition: dialogTransition(MOTION.exit) }}
      className={cn(
        'relative flex w-full flex-col overflow-hidden border border-line bg-surface-raised shadow-pop',
        'max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)))]',
        'rounded-t-xl pb-[max(.75rem,env(safe-area-inset-bottom))] sm:max-h-[85vh] sm:rounded-xl sm:pb-0',
        SIZE_CLASS[size],
        className,
      )}
    >
      <div aria-hidden="true" className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong sm:hidden" />
      {renderDialogChildren(children)}
      {showCloseButton ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={closeLabel}
          title={closeLabel}
          onClick={handleClose}
          className={cn('absolute top-3 right-3 z-10', closeClassName)}
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </motion.div>
  );
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="dialog-header" className={cn('shrink-0 px-5 pt-4 pb-3', className)} {...props} />;
}
markDialogSlot(DialogHeader, 'header');

export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  const context = useDialogContext('DialogTitle');
  return <h2 {...props} id={context.titleId} data-slot="dialog-title" className={cn('pr-8 text-lg font-semibold tracking-tight text-fg', className)} />;
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
      className={cn('mt-1 text-sm text-fg-muted', className)}
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
      className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 krypton-scrollbar', className)}
    />
  );
}
markDialogSlot(DialogBody, 'body');

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex shrink-0 flex-col-reverse gap-2 border-t border-line-subtle bg-surface-sunken/60 px-5 py-3 sm:flex-row sm:justify-end [&>*]:w-full sm:[&>*]:w-auto', className)}
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
  // Dropping Dialog while open is still true unmounts AnimatePresence before it can play the exit.
  const retainedRef = useRef<DialogCommand | null>(null);
  if (current) retainedRef.current = current;
  const shown = current ?? retainedRef.current;
  const [promptDraft, setPromptDraft] = useState({ id: 0, value: '' });
  const promptValue = shown?.kind === 'prompt'
    ? (promptDraft.id === shown.id ? promptDraft.value : shown.defaultValue)
    : '';

  if (!shown) return null;

  const dismiss = () => {
    if (shown.kind === 'alert') finishDialogCommand(shown.id, () => shown.resolve());
    else if (shown.kind === 'confirm') finishDialogCommand(shown.id, () => shown.resolve(false));
    else finishDialogCommand(shown.id, () => shown.resolve(null));
  };

  return (
    <Dialog key={shown.id} open={current !== null} onOpenChange={(open) => !open && dismiss()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{shown.title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogDescription className="whitespace-pre-wrap">{shown.message}</DialogDescription>
          {shown.kind === 'prompt' ? (
            <Input
              autoFocus
              value={promptValue}
              placeholder={shown.placeholder}
              onChange={(event) => setPromptDraft({ id: shown.id, value: event.target.value })}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                finishDialogCommand(shown.id, () => shown.resolve(promptValue));
              }}
            />
          ) : null}
        </DialogBody>
        <DialogFooter>
          {shown.kind === 'alert' ? (
            <Button type="button" variant="primary" onClick={() => finishDialogCommand(shown.id, () => shown.resolve())}>
              {shown.confirmLabel}
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={dismiss}>
                {shown.cancelLabel}
              </Button>
              <Button
                type="button"
                variant={shown.kind === 'confirm' && shown.destructive ? 'danger' : 'primary'}
                onClick={() => {
                  if (shown.kind === 'confirm') finishDialogCommand(shown.id, () => shown.resolve(true));
                  else finishDialogCommand(shown.id, () => shown.resolve(promptValue));
                }}
              >
                {shown.confirmLabel}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
