import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { MOTION } from './motion';
import {
  alignAnchoredBox,
  calculateAnchoredPopoverBox,
  type AnchoredPlacement,
  type AnchoredPopoverBox,
} from './tooltip-position';

type Placement = AnchoredPlacement;

const FLOAT_SURFACE = 'fixed z-50 overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface-raised text-fg shadow-pop';
const VIEWPORT_PADDING = 8;
const FLOAT_GAP = 6;

interface FloatingPosition {
  top: number;
  left: number;
  origin: string;
  maxHeight: number;
}

function floatingTransition(token: typeof MOTION.enter) {
  const [x1, y1, x2, y2] = token.ease;
  if (token.ease.length !== 4 || x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    throw new TypeError('Floating motion ease must be a four-number bezier');
  }
  return { duration: token.duration, ease: [x1, y1, x2, y2] as const };
}

function anchoredTop(box: AnchoredPopoverBox, floatingHeight: number, viewportHeight: number): number {
  if (typeof box.top === 'number') {
    return box.top;
  }
  if (typeof box.bottom === 'number') {
    return viewportHeight - box.bottom - floatingHeight;
  }
  throw new TypeError('Anchored popover box is missing top and bottom');
}

/** True only after this open has measured a real top/left, not the off-screen placeholder. */
const FloatingPositionedContext = createContext(false);

function focusWithoutScroll(node: HTMLElement | undefined) {
  node?.focus({ preventScroll: true });
}

function menuScroller(node: HTMLElement): HTMLElement | null {
  let current = node.parentElement;
  while (current) {
    if (
      current.classList.contains('overflow-y-auto')
      || current.classList.contains('overflow-auto')
      || current.classList.contains('overflow-y-scroll')
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Page scroll stays put (`preventScroll`), but an item past the anchored max
 * height still has to move inside the menu's own scroller or it cannot be seen.
 */
function focusMenuItem(node: HTMLElement | undefined) {
  if (!node) return;
  focusWithoutScroll(node);
  const scroller = menuScroller(node);
  if (!scroller) return;
  const itemRect = node.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  if (itemRect.top < scrollerRect.top) {
    scroller.scrollTop -= scrollerRect.top - itemRect.top;
  } else if (itemRect.bottom > scrollerRect.bottom) {
    scroller.scrollTop += itemRect.bottom - scrollerRect.bottom;
  }
}

function createsFixedContainingBlock(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  if (style.transform && style.transform !== 'none') return true;
  if (style.filter && style.filter !== 'none') return true;
  const backdrop = style.backdropFilter;
  if (backdrop && backdrop !== 'none') return true;
  if (style.perspective && style.perspective !== 'none') return true;
  const willChange = style.willChange;
  if (willChange.includes('transform') || willChange.includes('filter') || willChange.includes('perspective')) return true;
  return style.contain.split(/\s+/).some((token) => {
    return token === 'paint' || token === 'layout' || token === 'strict' || token === 'content';
  });
}

/** Viewport origin of the box that `position: fixed` is resolved against. */
function fixedLayerOrigin(container: HTMLElement): { top: number; left: number } {
  let current: HTMLElement | null = container;
  while (current && current !== document.documentElement) {
    if (current !== document.body && createsFixedContainingBlock(current)) {
      const rect = current.getBoundingClientRect();
      const style = getComputedStyle(current);
      const borderTop = Number.parseFloat(style.borderTopWidth);
      const borderLeft = Number.parseFloat(style.borderLeftWidth);
      return {
        top: rect.top + (Number.isFinite(borderTop) ? borderTop : 0),
        left: rect.left + (Number.isFinite(borderLeft) ? borderLeft : 0),
      };
    }
    current = current.parentElement;
  }
  return { top: 0, left: 0 };
}

/**
 * An open dialog's Tab guard and aria-modal tree only see descendants of
 * `[role="dialog"]`. Portaling to `document.body` leaves the menu outside both.
 */
function menuPortalTarget(anchor: HTMLElement | null): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const dialog = anchor?.closest('[role="dialog"]');
  if (dialog instanceof HTMLElement) return dialog;
  return document.body;
}

function useFloating(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  placement: Placement,
  container: HTMLElement | null,
  gap = FLOAT_GAP,
) {
  const floating = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  const [placed, setPlaced] = useState(false);

  useLayoutEffect(() => {
    if (!open) {
      // Keep the last top/left/maxHeight so the exit plays where the menu was,
      // instead of jumping to the off-screen placeholder.
      setPlaced(false);
      return;
    }
    const update = () => {
      const anchorElement = anchor.current;
      const floatingElement = floating.current;
      if (!anchorElement || !floatingElement || !container) return;
      const anchorRect = anchorElement.getBoundingClientRect();
      // Entrance scale is on this node, so the client rect is smaller than the layout
      // box. The effect does not remeasure when the scale returns to 1.
      const floatingWidth = floatingElement.offsetWidth;
      const floatingHeight = floatingElement.offsetHeight;
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const box = calculateAnchoredPopoverBox(anchorRect, viewport, { gap, padding: VIEWPORT_PADDING });
      const aligned = alignAnchoredBox(box, anchorRect, floatingWidth, placement, viewport.width);
      const top = anchoredTop(aligned, floatingHeight, viewport.height);
      const left = aligned.left;
      const originShift = fixedLayerOrigin(container);
      const next = {
        top: top - originShift.top,
        left: left - originShift.left,
        maxHeight: aligned.maxHeight,
        origin: `${anchorRect.left + anchorRect.width / 2 - left}px ${top > anchorRect.top ? '0' : '100%'}`,
      };
      setPosition((current) => {
        if (
          current
          && current.top === next.top
          && current.left === next.left
          && current.origin === next.origin
          && current.maxHeight === next.maxHeight
        ) {
          return current;
        }
        return next;
      });
      setPlaced(true);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchor, placement, gap, container]);

  return { floating, position, placed };
}

function useDismiss(
  open: boolean,
  refs: ReadonlyArray<RefObject<HTMLElement | null>>,
  onClose: () => void,
  restoreFocus: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && refs.some((ref) => ref.current?.contains(target))) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Capture runs before the dialog's bubble listener. stopPropagation there
      // does not, because that listener is already registered and runs first.
      event.preventDefault();
      event.stopPropagation();
      onClose();
      focusWithoutScroll(restoreFocus.current ?? undefined);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, refs, onClose, restoreFocus]);
}

export function Popover({
  trigger,
  children,
  placement = 'bottom-start',
  className,
}: {
  trigger: (props: { ref: Ref<HTMLButtonElement>; onClick: () => void; 'aria-expanded': boolean }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  placement?: Placement;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const portal = menuPortalTarget(anchor.current);
  const { floating, position, placed } = useFloating(open, anchor, placement, portal);
  const close = useCallback(() => setOpen(false), []);
  const dismissRefs = useMemo(() => [anchor, floating], [floating]);
  useDismiss(open, dismissRefs, close, anchor);

  return (
    <>
      {trigger({
        ref: anchor,
        onClick: () => setOpen((value) => !value),
        'aria-expanded': open,
      })}
      {portal ? createPortal(
        <AnimatePresence>
          {open ? (
            <motion.div
              ref={floating}
              className={cn(FLOAT_SURFACE, className)}
              style={{
                top: position?.top ?? -9999,
                left: position?.left ?? -9999,
                transformOrigin: position?.origin,
                maxHeight: position?.maxHeight,
              }}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1, transition: floatingTransition(MOTION.enter) }}
              exit={{ opacity: 0, scale: 0.98, transition: floatingTransition(MOTION.exit) }}
            >
              <FloatingPositionedContext.Provider value={placed}>
                {typeof children === 'function' ? children(close) : children}
              </FloatingPositionedContext.Provider>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        portal,
      ) : null}
    </>
  );
}

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  href?: string;
}

type MenuEntry = MenuItem | 'separator' | { group: string };

const ITEM_CLASS = [
  'flex h-(--control-md) w-full items-center gap-2 rounded-sm px-2 text-left text-sm outline-none',
  'hover:bg-surface-hover focus-visible:bg-surface-hover disabled:pointer-events-none disabled:text-fg-disabled',
  '[&_svg]:size-4',
].join(' ');

function isMenuGroup(entry: MenuEntry): entry is { group: string } {
  return typeof entry !== 'string' && 'group' in entry;
}

function enabledMenuItems(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter((node) => {
    return !node.hasAttribute('disabled') && node.getAttribute('aria-disabled') !== 'true';
  });
}

function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const nodes = enabledMenuItems(event.currentTarget);
  if (nodes.length === 0) return;
  const current = document.activeElement;
  const index = current instanceof HTMLElement ? nodes.indexOf(current) : -1;
  const nextIndex = index === -1
    ? (event.key === 'ArrowDown' ? 0 : nodes.length - 1)
    : (index + (event.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length;
  event.preventDefault();
  focusMenuItem(nodes[nextIndex]);
}

function MenuAction({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  let toneClass = 'text-fg [&_svg]:text-fg-subtle';
  if (item.danger) {
    toneClass = 'text-danger-fg [&_svg]:text-danger-fg';
  }
  // `disabled:` only matches a real disabled control, so a disabled link needs the color class itself.
  if (item.disabled) {
    toneClass = 'pointer-events-none text-fg-disabled [&_svg]:text-fg-disabled';
  }
  const className = cn(ITEM_CLASS, toneClass);
  const content = (
    <>
      {item.icon}
      <span className="flex-1 truncate">
        {item.label}
      </span>
      {item.shortcut ? (
        <span className="text-xs tracking-wide text-fg-subtle">
          {item.shortcut}
        </span>
      ) : null}
    </>
  );
  if (item.href !== undefined) {
    return (
      <a
        href={item.href}
        role="menuitem"
        aria-disabled={item.disabled ? true : undefined}
        tabIndex={item.disabled ? -1 : undefined}
        className={className}
        onClick={(event) => {
          if (item.disabled) {
            event.preventDefault();
            return;
          }
          item.onSelect?.();
          onClose();
        }}
      >
        {content}
      </a>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      className={className}
      onClick={() => {
        if (item.disabled) return;
        item.onSelect?.();
        onClose();
      }}
    >
      {content}
    </button>
  );
}

function MenuPanel({
  label,
  items,
  onClose,
}: {
  label?: string;
  items: readonly MenuEntry[];
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const positioned = useContext(FloatingPositionedContext);

  useLayoutEffect(() => {
    if (!positioned) return;
    const first = menuRef.current ? enabledMenuItems(menuRef.current)[0] : undefined;
    focusMenuItem(first);
  }, [positioned]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      onKeyDown={onMenuKeyDown}
    >
      {items.map((entry, index) => {
        if (entry === 'separator') {
          return (
            <div
              key={index}
              role="separator"
              className="-mx-1 my-1 h-px bg-line-subtle"
            />
          );
        }
        if (isMenuGroup(entry)) {
          return (
            <div
              key={index}
              className="px-2 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-fg-subtle"
            >
              {entry.group}
            </div>
          );
        }
        return (
          <MenuAction
            key={index}
            item={entry}
            onClose={onClose}
          />
        );
      })}
    </div>
  );
}

export function Menu({
  trigger,
  items,
  placement = 'bottom-end',
  label,
}: {
  trigger: (props: { ref: Ref<HTMLButtonElement>; onClick: () => void; 'aria-expanded': boolean }) => ReactNode;
  items: readonly (MenuItem | 'separator' | { group: string })[];
  placement?: Placement;
  label?: string;
}) {
  return (
    <Popover
      trigger={trigger}
      placement={placement}
      className="min-w-48 p-1"
    >
      {(close) => (
        <MenuPanel
          label={label}
          items={items}
          onClose={close}
        />
      )}
    </Popover>
  );
}
