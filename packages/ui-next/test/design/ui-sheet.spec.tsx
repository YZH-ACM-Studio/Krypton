// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MOTION } from '../../src/components/ui/motion';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '../../src/components/ui/sheet';

type SheetSide = 'left' | 'right' | 'top' | 'bottom';

const PANEL_SURFACE = ['bg-surface-raised', 'border-line', 'shadow-pop'] as const;
const HEADER_CHROME = ['relative', 'min-h-14', 'border-b', 'border-line-subtle', 'px-5', 'py-3', 'pr-12'] as const;

const motionCapture = vi.hoisted(() => ({
  entries: [] as Array<{ initial: unknown; animate: unknown; exit: unknown }>,
}));

vi.mock('motion/react', async () => {
  const actual = await vi.importActual<typeof import('motion/react')>('motion/react');
  return {
    ...actual,
    motion: {
      ...actual.motion,
      div: (props: Parameters<typeof actual.motion.div>[0]) => {
        motionCapture.entries.push({
          initial: props.initial,
          animate: props.animate,
          exit: props.exit,
        });
        const Div = actual.motion.div;
        return <Div {...props} />;
      },
    },
  };
});

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function ignoreOpenChange(): void {
  return undefined;
}

function sheetTree(open: boolean, side: SheetSide, title: string, className?: string) {
  return (
    <Sheet
      open={open}
      onOpenChange={ignoreOpenChange}
    >
      <SheetContent
        side={side}
        className={className}
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <SheetBody>正文</SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function openSheet(side: SheetSide, title: string, className?: string): HTMLElement {
  render(sheetTree(true, side, title, className));
  return screen.getByRole('dialog', { name: title });
}

/** Portal root is the outermost fixed inset-0 ancestor, not the overlay sibling. */
function sheetRoot(dialog: HTMLElement): HTMLElement {
  let current: HTMLElement | null = dialog;
  let root: HTMLElement | null = null;
  while (current !== null && current !== document.body) {
    const tokens = classTokens(current);
    if (tokens.includes('fixed') && tokens.includes('inset-0')) {
      root = current;
    }
    current = current.parentElement;
  }
  if (root === null) {
    throw new TypeError('expected the sheet root');
  }
  return root;
}

/** Same overlay sheet-chrome clicks: previous sibling of the panel wrapper. */
function sheetScrim(dialog: HTMLElement): HTMLElement {
  const overlay = dialog.parentElement?.previousElementSibling;
  if (!(overlay instanceof HTMLElement)) {
    throw new TypeError('expected the sheet scrim');
  }
  return overlay;
}

function lowestCommonAncestor(left: HTMLElement, right: HTMLElement): HTMLElement {
  const ancestors = new Set<HTMLElement>();
  let current: HTMLElement | null = left;
  while (current !== null) {
    ancestors.add(current);
    current = current.parentElement;
  }
  current = right;
  while (current !== null) {
    if (ancestors.has(current)) {
      return current;
    }
    current = current.parentElement;
  }
  throw new TypeError('expected a shared parent for the scrim and panel');
}

function sheetHeader(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title });
  const header = heading.parentElement;
  if (!(header instanceof HTMLElement)) {
    throw new TypeError('expected the sheet header');
  }
  return header;
}

function sheetSource(): string {
  return readFileSync(resolve(import.meta.dirname, '../../src/components/ui/sheet.tsx'), 'utf8');
}

function objectField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`expected an object with ${key}`);
  }
  const found = Object.entries(value).find(([entry]) => entry === key);
  if (!found) {
    throw new TypeError(`missing ${key}`);
  }
  return found[1];
}

function bezierTransition(value: unknown): { duration: number; ease: number[] } {
  const duration = objectField(value, 'duration');
  const ease = objectField(value, 'ease');
  if (typeof duration !== 'number' || !Array.isArray(ease)) {
    throw new TypeError('expected a bezier transition');
  }
  const numbers = ease.filter((part): part is number => typeof part === 'number');
  if (numbers.length !== ease.length) {
    throw new TypeError('expected a numeric bezier');
  }
  return { duration, ease: numbers };
}

function recordEntries(value: unknown): [string, unknown][] | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  return Object.entries(value);
}

function panelMotion(axis: 'x' | 'y', hidden: string) {
  const found = [...motionCapture.entries].reverse().find((entry) => {
    const initial = recordEntries(entry.initial);
    if (initial === null) {
      return false;
    }
    return initial.some(([key, field]) => key === axis && field === hidden);
  });
  return found ?? null;
}

function scrimMotion() {
  const found = [...motionCapture.entries].reverse().find((entry) => {
    const initial = recordEntries(entry.initial);
    if (initial === null) {
      return false;
    }
    const opacity = initial.find(([key]) => key === 'opacity');
    const hasAxis = initial.some(([key]) => key === 'x' || key === 'y');
    return opacity?.[1] === 0 && !hasAxis;
  });
  return found ?? null;
}

beforeEach(() => {
  motionCapture.entries.length = 0;
  document.body.style.overflow = '';
});

describe('sheet', () => {
  it('paints a right sheet as a full-width raised panel without a fixed 400px width', () => {
    const dialog = openSheet('right', '右侧');
    const tokens = classTokens(dialog);

    expect(tokens).toContain('md:max-w-md');
    expect(tokens).toContain('w-full');
    expect(tokens).toContain('bg-surface-raised');
    expect(tokens).toContain('border-line');
    expect(tokens).toContain('shadow-pop');
    expect(tokens).not.toContain('w-[400px]');
    expect(tokens).toContain('max-w-[calc(100dvw-2rem)]');
    expect(tokens).toContain('pb-[env(safe-area-inset-bottom)]');
    expect(tokens).not.toContain('overflow-y-auto');
    expect(dialog).toHaveAttribute('data-side', 'right');
    expect(dialog).toHaveAttribute('data-krypton-sheet');
    expect(dialog).not.toHaveAttribute('data-scroll-owner');
    expect(dialog.querySelector('[data-scroll-owner="sheet"]')).not.toBeNull();
  });

  it('paints a left sheet with the same width cap', () => {
    const dialog = openSheet('left', '左侧');
    const tokens = classTokens(dialog);

    expect(tokens).toContain('md:max-w-md');
    expect(tokens).toContain('w-full');
    expect(tokens).not.toContain('w-[400px]');
    expect(tokens).toContain('max-w-[calc(100dvw-2rem)]');
    expect(tokens).toEqual(expect.arrayContaining([...PANEL_SURFACE]));
    expect(dialog).toHaveAttribute('data-side', 'left');
  });

  it('keeps the 400px height and raised surface on top and bottom sheets', () => {
    for (const side of ['top', 'bottom'] as const) {
      const dialog = openSheet(side, side === 'top' ? '顶栏' : '底栏');
      const tokens = classTokens(dialog);

      expect(tokens).toContain('h-[400px]');
      expect(tokens).toContain('max-h-[calc(100dvh-2rem)]');
      expect(tokens).toContain('pb-[env(safe-area-inset-bottom)]');
      expect(tokens).not.toContain('w-[400px]');
      expect(tokens).toEqual(expect.arrayContaining([...PANEL_SURFACE]));
      expect(dialog).toHaveAttribute('data-side', side);
      expect(dialog).not.toHaveClass('overflow-y-auto');
      cleanup();
    }
  });

  it('anchors each side to its own viewport edge', () => {
    const edges = {
      right: { present: ['right-0', 'top-0', 'h-full', 'border-l'], absent: ['left-0', 'border-r'] },
      left: { present: ['left-0', 'top-0', 'h-full', 'border-r'], absent: ['right-0', 'border-l'] },
      top: { present: ['left-0', 'top-0', 'w-full', 'border-b'], absent: ['bottom-0', 'border-t'] },
      bottom: { present: ['left-0', 'bottom-0', 'w-full', 'border-t'], absent: ['top-0', 'border-b'] },
    } as const;

    for (const side of ['right', 'left', 'top', 'bottom'] as const) {
      const dialog = openSheet(side, side);
      const tokens = classTokens(dialog);

      expect(dialog).toHaveAttribute('data-side', side);
      for (const token of edges[side].present) {
        expect(tokens).toContain(token);
      }
      for (const token of edges[side].absent) {
        expect(tokens).not.toContain(token);
      }
      cleanup();
    }
  });

  it('leaves a caller max-w class in place and does not add md:max-w-md', () => {
    const capped = openSheet('right', '自带宽', 'sm:max-w-[640px]');
    const cappedTokens = classTokens(capped);

    expect(cappedTokens).toContain('sm:max-w-[640px]');
    expect(cappedTokens).toContain('max-w-[calc(100dvw-2rem)]');
    expect(cappedTokens).not.toContain('md:max-w-md');
    expect(cappedTokens).not.toContain('w-[400px]');
    cleanup();

    const custom = openSheet('right', '自定义宽', 'max-w-[min(60rem,calc(100vw-2rem))]');
    const customTokens = classTokens(custom);

    expect(customTokens).toContain('max-w-[min(60rem,calc(100vw-2rem))]');
    expect(customTokens).not.toContain('md:max-w-md');
    cleanup();

    const plain = openSheet('right', '默认宽');
    expect(classTokens(plain)).toContain('md:max-w-md');
    cleanup();

    const callerWidth = openSheet('right', '仅宽度', 'w-[min(620px,calc(100vw-2rem))]');
    const callerWidthTokens = classTokens(callerWidth);

    expect(callerWidthTokens).toContain('w-[min(620px,calc(100vw-2rem))]');
    expect(callerWidthTokens).toContain('max-w-[calc(100dvw-2rem)]');
    expect(callerWidthTokens).not.toContain('md:max-w-md');
    expect(callerWidthTokens).not.toContain('w-[400px]');
  });

  it('puts the sheet root on z-50 instead of z-200', () => {
    const root = sheetRoot(openSheet('right', '层级'));

    expect(classTokens(root)).toContain('z-50');
    expect(classTokens(root)).not.toContain('z-200');
  });

  it('sizes the header and title with the sheet chrome tokens', () => {
    const dialog = openSheet('right', '标题');
    const header = sheetHeader('标题');
    const tokens = classTokens(header);
    const title = screen.getByRole('heading', { name: '标题' });

    expect(dialog.contains(header)).toBe(true);
    expect(tokens).toEqual(expect.arrayContaining([...HEADER_CHROME]));
    expect(tokens).toContain('min-h-14');
    expect(tokens).not.toContain('h-14');
    expect(tokens).not.toContain('flex');
    expect(tokens).not.toContain('items-center');
    expect(classTokens(title)).toContain('text-md');
    expect(classTokens(title)).toContain('font-semibold');
    expect(classTokens(title)).not.toContain('text-base');
  });

  it('keeps a caller flex row on the header', () => {
    render(
      <Sheet
        open
        onOpenChange={ignoreOpenChange}
      >
        <SheetContent side="right">
          <SheetHeader className="flex items-center justify-between">
            <SheetTitle>并排</SheetTitle>
          </SheetHeader>
          <SheetBody>正文</SheetBody>
        </SheetContent>
      </Sheet>,
    );
    const tokens = classTokens(sheetHeader('并排'));

    expect(tokens).toContain('flex');
    expect(tokens).toContain('items-center');
    expect(tokens).toContain('justify-between');
    expect(tokens).toContain('min-h-14');
  });

  it('renders the close control as a small ghost icon button', () => {
    const dialog = openSheet('right', '关闭钮');
    const close = screen.getByRole('button', { name: '关闭' });

    expect(dialog.contains(close)).toBe(true);
    expect(close).toHaveAttribute('data-slot', 'button');
    expect(close).toHaveAttribute('data-variant', 'ghost');
    expect(close).toHaveAttribute('data-size', 'sm');
    expect(classTokens(close)).toContain('w-(--control-sm)');
    expect(classTokens(close)).toContain('absolute');
    expect(classTokens(close)).toContain('right-3');
    expect(classTokens(close)).toContain('top-3');
  });

  it('paints an opaque scrim and does not blur the page behind it', () => {
    const dialog = openSheet('right', '遮罩');
    const overlay = sheetScrim(dialog);
    const tokens = classTokens(overlay);

    expect(tokens).toContain('bg-scrim');
    expect(tokens).not.toContain('backdrop-blur-sm');
    expect(tokens).not.toContain('bg-black/60');
  });

  it('lets the scrim receive the outside click and ignores hits on the positioning layer', () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet
        open
        onOpenChange={onOpenChange}
      >
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>点击层</SheetTitle>
          </SheetHeader>
          <SheetBody>正文</SheetBody>
        </SheetContent>
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog', { name: '点击层' });
    const scrim = sheetScrim(dialog);
    const layer = lowestCommonAncestor(scrim, dialog);

    expect(classTokens(layer)).toContain('pointer-events-none');
    expect(classTokens(scrim)).toContain('pointer-events-auto');
    expect(classTokens(dialog)).toContain('pointer-events-auto');

    fireEvent.click(scrim);

    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('paints the off-screen pose on the first open frame', () => {
    const hidden: Record<SheetSide, string> = {
      right: 'translateX(100%)',
      left: 'translateX(-100%)',
      top: 'translateY(-100%)',
      bottom: 'translateY(100%)',
    };

    for (const side of ['right', 'left', 'bottom', 'top'] as const) {
      const view = render(sheetTree(false, side, side));
      view.rerender(sheetTree(true, side, side));
      const panel = screen.getByRole('dialog', { name: side });

      expect(panel.style.transform).toContain(hidden[side]);
      cleanup();
    }
  });

  it('marks the panel inert in the same render that starts the leave', () => {
    const view = render(sheetTree(true, 'right', '离场'));
    const openPanel = screen.getByRole('dialog', { name: '离场' });

    expect(openPanel).not.toHaveAttribute('inert');

    view.rerender(sheetTree(false, 'right', '离场'));
    const panel = document.querySelector('[data-krypton-sheet]');

    expect(panel).toBeInstanceOf(HTMLElement);
    if (!(panel instanceof HTMLElement)) {
      throw new TypeError('expected the leaving sheet panel');
    }
    expect(panel).toHaveAttribute('inert');
    expect(panel).toHaveAttribute('data-krypton-sheet', '');
  });

  it('slides with declarative motion at enter × 1.25 and leaves on the exit token', () => {
    const poses = [
      ['right', 'x', '100%'],
      ['left', 'x', '-100%'],
      ['bottom', 'y', '100%'],
      ['top', 'y', '-100%'],
    ] as const;

    for (const [side, axis, hidden] of poses) {
      motionCapture.entries.length = 0;
      render(sheetTree(true, side, side));
      const panel = panelMotion(axis, hidden);

      expect(motionCapture.entries.length).toBeGreaterThan(0);
      expect(panel).not.toBeNull();
      if (panel === null) {
        throw new TypeError('expected the sheet panel motion');
      }

      expect(objectField(panel.initial, axis)).toBe(hidden);
      expect(objectField(panel.exit, axis)).toBe(hidden);
      expect(objectField(panel.animate, 'x')).toBe(0);
      expect(objectField(panel.animate, 'y')).toBe(0);

      const entering = bezierTransition(objectField(panel.animate, 'transition'));
      const leaving = bezierTransition(objectField(panel.exit, 'transition'));

      expect(entering.duration).toBe(MOTION.enter.duration * 1.25);
      expect(entering.ease).toEqual([...MOTION.enter.ease]);
      expect(leaving.duration).toBe(MOTION.exit.duration);
      expect(leaving.ease).toEqual([...MOTION.exit.ease]);

      if (side === 'right') {
        const scrim = scrimMotion();
        expect(scrim).not.toBeNull();
        if (scrim === null) {
          throw new TypeError('expected the sheet scrim motion');
        }
        expect(objectField(scrim.initial, 'opacity')).toBe(0);
        expect(objectField(scrim.animate, 'opacity')).toBe(1);
        expect(objectField(scrim.exit, 'opacity')).toBe(0);
        const scrimEnter = bezierTransition(objectField(scrim.animate, 'transition'));
        const scrimExit = bezierTransition(objectField(scrim.exit, 'transition'));
        expect(scrimEnter.duration).toBe(MOTION.enter.duration);
        expect(scrimEnter.ease).toEqual([...MOTION.enter.ease]);
        expect(scrimExit.duration).toBe(MOTION.exit.duration);
        expect(scrimExit.ease).toEqual([...MOTION.exit.ease]);
      }
      cleanup();
    }
  });

  it('keeps the literal aria-modal="true" in the sheet source', () => {
    const source = sheetSource();
    const dialog = openSheet('right', '模态');

    expect(source).toContain('aria-modal="true"');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('data-krypton-sheet', '');
  });

  it('adds the default md width only when the caller class has no max-w utility', () => {
    const embedded = openSheet('right', '伪宽', 'xmax-w-md');
    expect(classTokens(embedded)).toContain('xmax-w-md');
    expect(classTokens(embedded)).toContain('md:max-w-md');
    cleanup();

    const heightOnly = openSheet('right', '限高', 'max-h-96');
    expect(classTokens(heightOnly)).toContain('max-h-96');
    expect(classTokens(heightOnly)).toContain('md:max-w-md');
    cleanup();

    const variant = openSheet('left', '悬停宽', 'hover:max-w-lg');
    expect(classTokens(variant)).toContain('hover:max-w-lg');
    expect(classTokens(variant)).not.toContain('md:max-w-md');
  });

  it('keeps the panel wrapper from intercepting clicks outside the panel', () => {
    const dialog = openSheet('right', '定位层');
    const scrim = sheetScrim(dialog);
    const wrapper = dialog.parentElement;

    expect(wrapper).toBeInstanceOf(HTMLElement);
    if (!(wrapper instanceof HTMLElement)) {
      throw new TypeError('expected the sheet panel wrapper');
    }
    expect(wrapper).toBe(scrim.nextElementSibling);
    expect(classTokens(wrapper)).toContain('pointer-events-none');
    expect(classTokens(wrapper)).not.toContain('pointer-events-auto');
  });

  it('holds the document scroll lock until the leave animation ends', async () => {
    document.body.style.overflow = 'clip';
    const view = render(sheetTree(true, 'right', '滚动锁'));

    expect(document.body.style.overflow).toBe('hidden');

    view.rerender(sheetTree(false, 'right', '滚动锁'));

    expect(document.body.style.overflow).toBe('hidden');
    await waitFor(() => {
      expect(document.body.style.overflow).toBe('clip');
    });
  });

  it('restores the overflow from before the lock when the open handler changes', async () => {
    document.body.style.overflow = 'clip';
    function LockHarness({
      open,
      onOpenChange,
    }: {
      open: boolean;
      onOpenChange: (next: boolean) => void;
    }) {
      return (
        <Sheet
          open={open}
          onOpenChange={onOpenChange}
        >
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>回调</SheetTitle>
            </SheetHeader>
            <SheetBody>正文</SheetBody>
          </SheetContent>
        </Sheet>
      );
    }
    const first = vi.fn();
    const view = render(
      <LockHarness
        open
        onOpenChange={first}
      />,
    );

    expect(document.body.style.overflow).toBe('hidden');

    const second = vi.fn();
    view.rerender(
      <LockHarness
        open
        onOpenChange={second}
      />,
    );

    expect(document.body.style.overflow).toBe('hidden');

    view.rerender(
      <LockHarness
        open={false}
        onOpenChange={second}
      />,
    );

    expect(document.body.style.overflow).toBe('hidden');
    await waitFor(() => {
      expect(document.body.style.overflow).toBe('clip');
    });
  });

  it('releases the scroll lock when an open sheet unmounts', () => {
    document.body.style.overflow = 'clip';
    const view = render(sheetTree(true, 'right', '卸载'));

    expect(document.body.style.overflow).toBe('hidden');
    view.unmount();
    expect(document.body.style.overflow).toBe('clip');
  });

  it('does not clear overflow when a closed sheet unmounts without locking', () => {
    document.body.style.overflow = 'clip';
    const view = render(sheetTree(false, 'right', '未开'));

    expect(document.body.style.overflow).toBe('clip');
    view.unmount();
    expect(document.body.style.overflow).toBe('clip');
  });

  it('treats a later width utility as the caller width', () => {
    const afterPadding = openSheet('right', '前置类', 'px-4 max-w-lg');
    const afterPaddingTokens = classTokens(afterPadding);

    expect(afterPaddingTokens).toContain('px-4');
    expect(afterPaddingTokens).toContain('max-w-lg');
    expect(afterPaddingTokens).not.toContain('md:max-w-md');
    cleanup();

    const afterGap = openSheet('left', '间隙后宽度', 'gap-2 w-96');
    const afterGapTokens = classTokens(afterGap);

    expect(afterGapTokens).toContain('gap-2');
    expect(afterGapTokens).toContain('w-96');
    expect(afterGapTokens).not.toContain('md:max-w-md');
  });

  it('does not treat min-w as an explicit sheet width', () => {
    const dialog = openSheet('right', '最小宽', 'min-w-0');
    const tokens = classTokens(dialog);

    expect(tokens).toContain('min-w-0');
    expect(tokens).toContain('md:max-w-md');
    expect(tokens).toContain('w-full');
  });

  it('honors breakpoint width utilities that contain digits or hyphens', () => {
    const wide = openSheet('right', '二倍宽', '2xl:max-w-lg');
    const wideTokens = classTokens(wide);

    expect(wideTokens).toContain('2xl:max-w-lg');
    expect(wideTokens).not.toContain('md:max-w-md');
    cleanup();

    const capped = openSheet('left', '中屏宽', 'max-md:w-[40rem]');
    const cappedTokens = classTokens(capped);

    expect(cappedTokens).toContain('max-md:w-[40rem]');
    expect(cappedTokens).not.toContain('md:max-w-md');
  });

  it('defaults an omitted side to the right edge', () => {
    render(
      <Sheet
        open
        onOpenChange={ignoreOpenChange}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>默认侧</SheetTitle>
          </SheetHeader>
          <SheetBody>正文</SheetBody>
        </SheetContent>
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog', { name: '默认侧' });
    const tokens = classTokens(dialog);

    expect(dialog).toHaveAttribute('data-side', 'right');
    expect(tokens).toContain('right-0');
    expect(tokens).toContain('border-l');
    expect(tokens).toContain('md:max-w-md');
    expect(tokens).not.toContain('left-0');
    expect(tokens).not.toContain('border-r');
  });

  it('does not submit a parent form when the close button is clicked', () => {
    const onSubmit = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <Sheet
          open
          onOpenChange={onOpenChange}
        >
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>表单</SheetTitle>
            </SheetHeader>
            <SheetBody>正文</SheetBody>
          </SheetContent>
        </Sheet>
      </form>,
    );
    const close = screen.getByRole('button', { name: '关闭' });

    expect(close).toHaveAttribute('type', 'button');
    close.click();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls only the current onOpenChange when Escape is pressed', () => {
    const first = vi.fn();
    const second = vi.fn();
    function EscapeHarness({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
      return (
        <Sheet
          open
          onOpenChange={onOpenChange}
        >
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>换回调</SheetTitle>
            </SheetHeader>
            <SheetBody>正文</SheetBody>
          </SheetContent>
        </Sheet>
      );
    }
    const view = render(
      <EscapeHarness onOpenChange={first} />,
    );

    view.rerender(
      <EscapeHarness onOpenChange={second} />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(false);
  });

  it('keeps the scroll lock when the sheet reopens before leave finishes', async () => {
    document.body.style.overflow = 'clip';
    const view = render(sheetTree(true, 'right', '重开'));

    expect(document.body.style.overflow).toBe('hidden');
    view.rerender(sheetTree(false, 'right', '重开'));
    view.rerender(sheetTree(true, 'right', '重开'));

    expect(document.body.style.overflow).toBe('hidden');
    await new Promise((done) => {
      setTimeout(done, 500);
    });
    expect(screen.getByRole('dialog', { name: '重开' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
  });
});
