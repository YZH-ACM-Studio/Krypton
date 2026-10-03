// @vitest-environment jsdom
import { type ComponentType, type ReactNode, type Ref } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Dialog, DialogContent, DialogTitle } from '../../src/components/ui/dialog';
import * as tooltipModule from '../../src/components/ui/tooltip';
import * as tooltipPositionModule from '../../src/components/ui/tooltip-position';

const MENU_MODULE = '../../src/components/ui/menu';

type Placement = 'bottom-start' | 'bottom-end' | 'bottom' | 'top';

interface MenuTriggerState {
  ref: Ref<HTMLButtonElement>;
  onClick: () => void;
  'aria-expanded': boolean;
}

interface MenuItemSpec {
  label: ReactNode;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  href?: string;
}

type MenuEntry = MenuItemSpec | 'separator' | { group: string };

interface MenuProps {
  trigger: (state: MenuTriggerState) => ReactNode;
  items: readonly MenuEntry[];
  placement?: Placement;
  label?: string;
}

interface SimpleTooltipProps {
  content: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}

interface TooltipProviderProps {
  children: ReactNode;
  delayDuration?: number;
}

interface TooltipProps {
  children: ReactNode;
}

interface TooltipTriggerProps {
  asChild?: boolean;
  children: ReactNode;
}

interface TooltipContentProps {
  children: ReactNode;
  side?: SimpleTooltipProps['side'];
}

type AlignAnchoredBox = (
  box: { left: number },
  anchorRect: { left: number; right: number },
  floatingWidth: number,
  placement: Placement,
  viewportWidth: number,
) => unknown;

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) {
    return undefined;
  }
  return Reflect.get(record, key);
}

function isComponent<Props extends object>(value: unknown): value is ComponentType<Props> {
  return typeof value === 'function';
}

function isAlign(value: unknown): value is AlignAnchoredBox {
  return typeof value === 'function';
}

/** `import()` stays indirect so a missing `menu.tsx` fails the test instead of the file load. */
async function loadComponent<Props extends object>(specifier: string, name: string): Promise<ComponentType<Props>> {
  const loaded: unknown = await import(specifier);
  if (typeof loaded !== 'object' || loaded === null) {
    throw new TypeError(`${name} module is not an object`);
  }
  const component = readField(loaded, name);
  expect(typeof component, name).toBe('function');
  if (!isComponent<Props>(component)) {
    throw new TypeError(`${name} is not a function`);
  }
  return component;
}

function loadSimpleTooltip(): ComponentType<SimpleTooltipProps> {
  const component = readField(tooltipModule, 'SimpleTooltip');
  expect(typeof component, 'SimpleTooltip').toBe('function');
  if (!isComponent<SimpleTooltipProps>(component)) {
    throw new TypeError('SimpleTooltip is not a function');
  }
  return component;
}

function loadTooltip<Props extends object>(name: string): ComponentType<Props> {
  const component = readField(tooltipModule, name);
  expect(typeof component, name).toBe('function');
  if (!isComponent<Props>(component)) {
    throw new TypeError(`${name} is not a function`);
  }
  return component;
}

/** Trigger sits in the middle of a 1024×768 viewport so the requested side is not flipped. */
function installCenteredGeometry(): () => void {
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(400, 400, 40, 30));
  return () => {
    spy.mockRestore();
  };
}

function withHoverClock(run: () => void): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    run();
  } finally {
    vi.useRealTimers();
  }
}

/** Hover uses the 450ms delay; focus still opens immediately and is covered separately. */
function expectHoverOpensAfterDelay(buttonName: string, text: string): void {
  fireEvent.mouseEnter(screen.getByRole('button', { name: buttonName }));
  expect(screen.queryByRole('tooltip')).toBeNull();
  act(() => {
    vi.advanceTimersByTime(449);
  });
  expect(screen.queryByRole('tooltip')).toBeNull();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.getByRole('tooltip').textContent).toBe(text);
}

const FLOATING_SURFACE = [
  'fixed',
  'z-50',
  'rounded-lg',
  'border',
  'border-line',
  'bg-surface-raised',
  'text-fg',
  'shadow-pop',
] as const;

function loadAlign(): AlignAnchoredBox {
  const align = readField(tooltipPositionModule, 'alignAnchoredBox');
  expect(typeof align, 'alignAnchoredBox').toBe('function');
  if (!isAlign(align)) {
    throw new TypeError('alignAnchoredBox is not a function');
  }
  return align;
}

function alignedLeft(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('alignAnchoredBox did not return a left coordinate');
  }
  const left = Object.entries(value).find(([key]) => key === 'left')?.[1];
  if (typeof left !== 'number' || !Number.isFinite(left)) {
    throw new TypeError('alignAnchoredBox did not return a left coordinate');
  }
  return left;
}

function renderTrigger(label: string): (state: MenuTriggerState) => ReactNode {
  return function Trigger(state: MenuTriggerState) {
    return (
      <button
        ref={state.ref}
        type="button"
        aria-expanded={state['aria-expanded']}
        onClick={state.onClick}
      >
        {label}
      </button>
    );
  };
}

function asMenu(element: HTMLElement): HTMLElement {
  if (element.getAttribute('role') !== 'menu') {
    throw new TypeError('expected a menu');
  }
  return element;
}

async function renderMenu(items: readonly MenuEntry[], triggerName = '更多'): Promise<HTMLElement> {
  const Menu = await loadComponent<MenuProps>(MENU_MODULE, 'Menu');
  render(
    <Menu
      label="操作"
      trigger={renderTrigger(triggerName)}
      items={items}
    />,
  );
  return screen.getByRole('button', { name: triggerName });
}

async function openRenderedMenu(user: UserEvent, trigger: HTMLElement): Promise<HTMLElement> {
  await user.click(trigger);
  return asMenu(await screen.findByRole('menu'));
}

async function renderOpenMenu(
  user: UserEvent,
  items: readonly MenuEntry[],
  triggerName = '更多',
): Promise<{ trigger: HTMLElement; menu: HTMLElement }> {
  const trigger = await renderMenu(items, triggerName);
  const menu = await openRenderedMenu(user, trigger);
  return { trigger, menu };
}

function itemNamed(menu: HTMLElement, name: string): HTMLElement {
  const found = within(menu).getByRole('menuitem', { name });
  if (!(found instanceof HTMLElement)) {
    throw new TypeError(`expected menuitem ${name}`);
  }
  return found;
}

/** The group label may be a text node or wrapped; the leaf is the one that is not a control. */
function groupLabel(): HTMLElement {
  const matches = screen.getAllByText('危险操作').filter((element) => element instanceof HTMLElement);
  const leaf = matches.find((element) => {
    return ![...element.children].some((child) => (child.textContent ?? '').trim() === '危险操作');
  });
  const found = leaf ?? matches[0];
  if (!(found instanceof HTMLElement)) {
    throw new TypeError('expected the group label');
  }
  return found;
}

const ANCHOR_LEFT = 900;
const ANCHOR_TOP = 120;
const ANCHOR_WIDTH = 100;
const ANCHOR_HEIGHT = 32;
const FLOAT_LAYOUT_WIDTH = 200;
const FLOAT_LAYOUT_HEIGHT = 80;
/** Playground `useFloating` gap. `calculateAnchoredPopoverBox` subtracts it before `maxHeight`. */
const FLOAT_GAP = 6;
/** Entrance pose is `scale: 0.96`; transformed client rects must not be the alignment width. */
const ENTRANCE_SCALE = 0.96;
const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;
/** `bottom-end`: anchor.right - layout width. 1000 - 200, inside the 8px inset. */
const BOTTOM_END_LEFT = ANCHOR_LEFT + ANCHOR_WIDTH - FLOAT_LAYOUT_WIDTH;
/** Bottom wins: space below the anchor is larger, so the layer starts one gap under it. */
const BOTTOM_END_TOP = ANCHOR_TOP + ANCHOR_HEIGHT + FLOAT_GAP;
/** Short viewport, anchor near the top, content taller than the screen. */
const TALL_VIEWPORT_HEIGHT = 220;
const TALL_ANCHOR_TOP = 40;
const TALL_ANCHOR_HEIGHT = 32;
const TALL_ANCHOR_LEFT = 100;
const TALL_ANCHOR_WIDTH = 80;
const TALL_CONTENT_HEIGHT = 900;
const TALL_SPACE_BELOW = TALL_VIEWPORT_HEIGHT - (TALL_ANCHOR_TOP + TALL_ANCHOR_HEIGHT) - FLOAT_GAP;
const TALL_SPACE_ABOVE = TALL_ANCHOR_TOP - FLOAT_GAP;
const TALL_MAX_HEIGHT = TALL_SPACE_BELOW >= TALL_SPACE_ABOVE ? TALL_SPACE_BELOW : TALL_SPACE_ABOVE;

function fixedLayer(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current) {
    if (classTokens(current).includes('fixed')) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * jsdom does not scroll a focused control into view (`scrollIntoView` is a no-op
 * and `window.scrollY` stays 0). The placeholder that would scroll the page is the
 * floating layer's inline left at the moment the first item is focused.
 */
function installFirstItemFocusProbe(bucket: { left: number | null }): () => void {
  const original = HTMLElement.prototype.focus;
  const spy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function probe(this: HTMLElement, options?: FocusOptions) {
    if (bucket.left === null && this.getAttribute('role') === 'menuitem') {
      const layer = fixedLayer(this);
      bucket.left = layer ? Number.parseFloat(layer.style.left) : Number.NaN;
    }
    original.call(this, options);
  });
  return () => {
    spy.mockRestore();
  };
}

/** Client rects include the entrance scale; `offsetWidth` stays the layout width. */
function installEntranceGeometry(trigger: HTMLElement): () => void {
  const previousWidth = window.innerWidth;
  const previousHeight = window.innerHeight;
  window.innerWidth = VIEWPORT_WIDTH;
  window.innerHeight = VIEWPORT_HEIGHT;
  const inTrigger = (element: HTMLElement) => element === trigger || trigger.contains(element);
  const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
    if (inTrigger(this)) {
      return new DOMRect(ANCHOR_LEFT, ANCHOR_TOP, ANCHOR_WIDTH, ANCHOR_HEIGHT);
    }
    return new DOMRect(0, 0, FLOAT_LAYOUT_WIDTH * ENTRANCE_SCALE, FLOAT_LAYOUT_HEIGHT * ENTRANCE_SCALE);
  });
  const widthSpy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function width(this: HTMLElement) {
    return inTrigger(this) ? ANCHOR_WIDTH : FLOAT_LAYOUT_WIDTH;
  });
  const heightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function height(this: HTMLElement) {
    return inTrigger(this) ? ANCHOR_HEIGHT : FLOAT_LAYOUT_HEIGHT;
  });
  return () => {
    rectSpy.mockRestore();
    widthSpy.mockRestore();
    heightSpy.mockRestore();
    window.innerWidth = previousWidth;
    window.innerHeight = previousHeight;
  };
}

/** Content is taller than the viewport, so the layer must take `maxHeight` from the anchored box. */
function installTallMenuGeometry(trigger: HTMLElement): () => void {
  const previousWidth = window.innerWidth;
  const previousHeight = window.innerHeight;
  window.innerWidth = VIEWPORT_WIDTH;
  window.innerHeight = TALL_VIEWPORT_HEIGHT;
  const inTrigger = (element: HTMLElement) => element === trigger || trigger.contains(element);
  const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
    if (inTrigger(this)) {
      return new DOMRect(TALL_ANCHOR_LEFT, TALL_ANCHOR_TOP, TALL_ANCHOR_WIDTH, TALL_ANCHOR_HEIGHT);
    }
    return new DOMRect(0, 0, FLOAT_LAYOUT_WIDTH, TALL_CONTENT_HEIGHT);
  });
  const widthSpy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function width(this: HTMLElement) {
    return inTrigger(this) ? TALL_ANCHOR_WIDTH : FLOAT_LAYOUT_WIDTH;
  });
  const heightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function height(this: HTMLElement) {
    return inTrigger(this) ? TALL_ANCHOR_HEIGHT : TALL_CONTENT_HEIGHT;
  });
  return () => {
    rectSpy.mockRestore();
    widthSpy.mockRestore();
    heightSpy.mockRestore();
    window.innerWidth = previousWidth;
    window.innerHeight = previousHeight;
  };
}

function scrollsVertically(element: HTMLElement): boolean {
  const tokens = classTokens(element);
  if (tokens.includes('overflow-y-auto') || tokens.includes('overflow-auto') || tokens.includes('overflow-y-scroll')) {
    return true;
  }
  const overflow = element.style.overflowY || element.style.overflow;
  return overflow === 'auto' || overflow === 'scroll';
}

/** `tabIndex={-1}` is still focusable. A group label must ignore `focus()`. */
function takesFocus(element: HTMLElement): boolean {
  const previous = document.activeElement;
  element.focus();
  const took = document.activeElement === element;
  if (took && previous instanceof HTMLElement && previous !== element) {
    previous.focus();
  }
  return took;
}

function divider(scope: ParentNode): Element | undefined {
  const byRole = scope.querySelector('[role="separator"]');
  if (byRole) {
    return byRole;
  }
  return [...scope.querySelectorAll('*')].find((element) => {
    if (element.getAttribute('role') === 'menuitem') {
      return false;
    }
    return classTokens(element).includes('h-px');
  });
}

describe('simple tooltip', () => {
  it('shows the tooltip text after the trigger is focused', async () => {
    const SimpleTooltip = loadSimpleTooltip();
    const user = userEvent.setup();
    render(
      <SimpleTooltip content="复制">
        <button type="button">c</button>
      </SimpleTooltip>,
    );
    const button = screen.getByRole('button', { name: 'c' });

    expect(screen.queryByRole('tooltip')).toBeNull();

    await user.tab();

    expect(document.activeElement).toBe(button);
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toBe('复制');
    expect(classTokens(tip)).toContain('z-60');
    expect(classTokens(tip)).toContain('bg-fg');
    expect(classTokens(tip)).toContain('text-bg');
    expect(classTokens(tip)).toContain('rounded-md');
    expect(classTokens(tip)).toContain('px-2');
    expect(classTokens(tip)).toContain('py-1');
    expect(classTokens(tip)).toContain('text-xs');
    expect(classTokens(tip)).toContain('font-medium');
    expect(classTokens(tip)).toContain('shadow-sm');
    expect(classTokens(tip)).toContain('max-w-64');
  });

  it('waits 450ms after hover before showing the tooltip', () => {
    const SimpleTooltip = loadSimpleTooltip();
    withHoverClock(() => {
      render(
        <SimpleTooltip content="复制">
          <button type="button">c</button>
        </SimpleTooltip>,
      );
      expectHoverOpensAfterDelay('c', '复制');
    });
  });

  it('uses a 450ms hover delay when TooltipProvider omits delayDuration', () => {
    const TooltipProvider = loadTooltip<TooltipProviderProps>('TooltipProvider');
    const Tooltip = loadTooltip<TooltipProps>('Tooltip');
    const TooltipTrigger = loadTooltip<TooltipTriggerProps>('TooltipTrigger');
    const TooltipContent = loadTooltip<TooltipContentProps>('TooltipContent');
    withHoverClock(() => {
      render(
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button">悬停</button>
            </TooltipTrigger>
            <TooltipContent>
              稍后出现
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>,
      );
      expectHoverOpensAfterDelay('悬停', '稍后出现');
    });
  });

  it('puts the tooltip on the side it was given', async () => {
    const restoreGeometry = installCenteredGeometry();
    try {
      const SimpleTooltip = loadSimpleTooltip();
      const user = userEvent.setup();
      render(
        <SimpleTooltip content="复制" side="left">
          <button type="button">c</button>
        </SimpleTooltip>,
      );
      await user.tab();
      await waitFor(() => {
        expect(screen.getByRole('tooltip')).toHaveAttribute('data-side', 'left');
      });
    } finally {
      restoreGeometry();
    }
  });
});

describe('menu', () => {
  it('moves focus through enabled items and wraps past a disabled item', async () => {
    const user = userEvent.setup();
    const trigger = await renderMenu([
      { label: '复制' },
      { label: '重命名' },
      { label: '停用', disabled: true },
      { label: '归档' },
    ]);
    const focusedLayer: { left: number | null } = { left: null };
    const restoreGeometry = installEntranceGeometry(trigger);
    const restoreFocusProbe = installFirstItemFocusProbe(focusedLayer);
    const scrollBefore = window.scrollY;
    try {
      const menu = await openRenderedMenu(user, trigger);
      const first = itemNamed(menu, '复制');
      const second = itemNamed(menu, '重命名');
      const disabled = itemNamed(menu, '停用');
      const last = itemNamed(menu, '归档');

      expect(menu.contains(disabled)).toBe(true);
      expect(menu).toHaveAttribute('aria-label', '操作');
      expect(classTokens(first)).toContain('h-(--control-md)');
      const surface = menu.parentElement;
      if (!(surface instanceof HTMLElement)) {
        throw new TypeError('expected the floating surface');
      }
      for (const token of FLOATING_SURFACE) {
        expect(classTokens(surface)).toContain(token);
      }
      await waitFor(() => {
        expect(document.activeElement).toBe(first);
      });

      await user.keyboard('{ArrowDown}');
      expect(document.activeElement).toBe(second);

      await user.keyboard('{ArrowDown}');
      expect(document.activeElement).toBe(last);
      expect(document.activeElement).not.toBe(disabled);

      await user.keyboard('{ArrowDown}');
      expect(document.activeElement).toBe(first);

      await user.keyboard('{ArrowUp}');
      expect(document.activeElement).toBe(last);
      expect(document.activeElement).not.toBe(disabled);

      // jsdom never moves scrollY on focus. The off-screen placeholder is the layer
      // left at that instant; the settled left must use layout width, not the scaled client rect.
      expect({
        scrollY: window.scrollY,
        leftWhenFocused: focusedLayer.left,
        left: Number.parseFloat(surface.style.left),
      }).toEqual({
        scrollY: scrollBefore,
        leftWhenFocused: BOTTOM_END_LEFT,
        left: BOTTOM_END_LEFT,
      });
    } finally {
      restoreFocusProbe();
      restoreGeometry();
    }
  });

  it('calls onSelect once and closes the menu', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { menu } = await renderOpenMenu(user, [
      { label: '保存', onSelect },
    ]);

    await user.click(itemNamed(menu, '保存'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const { trigger, menu } = await renderOpenMenu(user, [
      { label: '复制' },
      { label: '重命名' },
    ]);

    await waitFor(() => {
      expect(document.activeElement).toBe(itemNamed(menu, '复制'));
    });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('closes on Escape without dismissing an already open dialog', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const Menu = await loadComponent<MenuProps>(MENU_MODULE, 'Menu');
    render(
      <Dialog
        open
        onOpenChange={onOpenChange}
      >
        <DialogContent>
          <DialogTitle>标题</DialogTitle>
          <Menu
            label="操作"
            trigger={renderTrigger('更多')}
            items={[
              { label: '复制' },
              { label: '重命名' },
            ]}
          />
        </DialogContent>
      </Dialog>,
    );
    const trigger = screen.getByRole('button', { name: '更多' });
    await user.click(trigger);
    const menu = asMenu(await screen.findByRole('menu'));
    await waitFor(() => {
      expect(document.activeElement).toBe(itemNamed(menu, '复制'));
    });
    onOpenChange.mockClear();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '标题' })).toBeTruthy();
  });

  it('scrolls a menu taller than the viewport inside the anchored max height', async () => {
    const user = userEvent.setup();
    const trigger = await renderMenu([
      { label: '复制' },
      { label: '重命名' },
      { label: '归档' },
    ]);
    const restoreGeometry = installTallMenuGeometry(trigger);
    try {
      const menu = await openRenderedMenu(user, trigger);
      const surface = fixedLayer(menu);
      if (!(surface instanceof HTMLElement)) {
        throw new TypeError('expected the floating surface');
      }
      expect(TALL_CONTENT_HEIGHT).toBeGreaterThan(TALL_VIEWPORT_HEIGHT);
      expect(TALL_MAX_HEIGHT).toBeLessThan(TALL_CONTENT_HEIGHT);
      await waitFor(() => {
        expect(Number.parseFloat(surface.style.maxHeight)).toBe(TALL_MAX_HEIGHT);
      });
      expect(scrollsVertically(surface) || [...surface.querySelectorAll<HTMLElement>('*')].some(scrollsVertically)).toBe(true);
    } finally {
      restoreGeometry();
    }
  });

  it('keeps the anchored coordinates while the menu is leaving', async () => {
    const user = userEvent.setup();
    const trigger = await renderMenu([
      { label: '复制' },
    ]);
    const restoreGeometry = installEntranceGeometry(trigger);
    try {
      const menu = await openRenderedMenu(user, trigger);
      const surface = fixedLayer(menu);
      if (!(surface instanceof HTMLElement)) {
        throw new TypeError('expected the floating surface');
      }
      await waitFor(() => {
        expect(surface.style.left).toBe(`${BOTTOM_END_LEFT}px`);
        expect(surface.style.top).toBe(`${BOTTOM_END_TOP}px`);
      });

      await user.keyboard('{Escape}');

      expect(surface.isConnected).toBe(true);
      expect(surface.style.left).toBe(`${BOTTOM_END_LEFT}px`);
      expect(surface.style.top).toBe(`${BOTTOM_END_TOP}px`);
      expect(Number.parseFloat(surface.style.left)).not.toBe(-9999);
      expect(Number.parseFloat(surface.style.top)).not.toBe(-9999);
    } finally {
      restoreGeometry();
    }
  });

  it('closes when pointerdown hits document.body', async () => {
    const user = userEvent.setup();
    await renderOpenMenu(user, [
      { label: '复制' },
    ]);

    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  it('paints danger items and renders href items as links', async () => {
    const user = userEvent.setup();
    const { menu } = await renderOpenMenu(user, [
      { label: '删除', danger: true },
      { label: '详情', href: '/x' },
    ]);
    const danger = itemNamed(menu, '删除');
    const link = itemNamed(menu, '详情');

    expect(classTokens(danger)).toContain('text-danger-fg');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/x');
    expect(link).toHaveAttribute('role', 'menuitem');
  });

  it('renders a group as non-focusable text and a separator', async () => {
    const user = userEvent.setup();
    const { menu } = await renderOpenMenu(user, [
      { label: '复制' },
      'separator',
      { group: '危险操作' },
      { label: '删除', danger: true },
    ]);
    const group = groupLabel();
    const scope = menu.parentElement ?? menu;

    expect(group.closest('[role="menuitem"]')).toBeNull();
    expect(group.closest('a, button, input, select, textarea')).toBeNull();
    let current: HTMLElement | null = group;
    while (current && current !== menu) {
      expect(takesFocus(current)).toBe(false);
      current = current.parentElement;
    }
    expect(divider(scope)).toBeInstanceOf(Element);
  });

  it('closes when the trigger is activated again', async () => {
    const user = userEvent.setup();
    const { trigger } = await renderOpenMenu(user, [
      { label: '复制' },
    ]);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  it('shows a shortcut on the menu item', async () => {
    const user = userEvent.setup();
    const { menu } = await renderOpenMenu(user, [
      { label: '复制', shortcut: 'Ctrl+C' },
    ]);
    expect(within(menu).getByText('Ctrl+C')).toBeTruthy();
  });

  it('skips a disabled link and does not select it', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { menu } = await renderOpenMenu(user, [
      { label: '复制' },
      { label: '跳过', href: '/skip', disabled: true, onSelect },
      { label: '归档' },
    ]);
    const first = itemNamed(menu, '复制');
    const skipped = itemNamed(menu, '跳过');
    const last = itemNamed(menu, '归档');

    await waitFor(() => {
      expect(document.activeElement).toBe(first);
    });
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(last);
    expect(document.activeElement).not.toBe(skipped);

    fireEvent.click(skipped);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('enters at the first item on ArrowDown and the last item on ArrowUp when nothing inside is focused', async () => {
    const user = userEvent.setup();
    const { menu } = await renderOpenMenu(user, [
      { label: '复制' },
      { label: '重命名' },
    ]);
    const first = itemNamed(menu, '复制');
    const last = itemNamed(menu, '重命名');
    await waitFor(() => {
      expect(document.activeElement).toBe(first);
    });

    if (!(document.activeElement instanceof HTMLElement)) {
      throw new TypeError('expected an active element');
    }
    document.activeElement.blur();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(first);

    first.blur();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(last);
  });
});

describe('align anchored box', () => {
  it('aligns a bottom-end box and clips a bottom-start box into the viewport', () => {
    const align = loadAlign();

    expect(alignedLeft(align(
      { left: 900 },
      { left: 900, right: 1000 },
      200,
      'bottom-end',
      1024,
    ))).toBe(800);
    // 1024 - 8 - 200
    expect(alignedLeft(align(
      { left: 980 },
      { left: 980, right: 1020 },
      200,
      'bottom-start',
      1024,
    ))).toBe(816);
    // 10 - 200 is left of the viewport, so the 8px inset wins.
    expect(alignedLeft(align(
      { left: 0 },
      { left: 0, right: 10 },
      200,
      'bottom-end',
      1024,
    ))).toBe(8);
    expect(alignedLeft(align(
      { left: 120 },
      { left: 120, right: 900 },
      200,
      'bottom',
      2000,
    ))).toBe(120);
    expect(alignedLeft(align(
      { left: 120 },
      { left: 120, right: 900 },
      200,
      'top',
      2000,
    ))).toBe(120);
  });
});
