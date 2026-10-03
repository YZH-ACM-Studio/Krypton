// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  alertDialog,
  confirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHost,
  DialogTitle,
} from '../../src/components/ui/dialog';
import { MOTION } from '../../src/components/ui/motion';

const motionCapture = vi.hoisted(() => ({
  scrims: [] as Array<{ initial: unknown; animate: unknown; exit: unknown }>,
}));

const portalCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    createPortal: (...args: Parameters<typeof actual.createPortal>) => {
      portalCalls.count += 1;
      return actual.createPortal(...args);
    },
  };
});

vi.mock('motion/react', async () => {
  const actual = await vi.importActual<typeof import('motion/react')>('motion/react');
  return {
    ...actual,
    motion: {
      ...actual.motion,
      div: (props: Parameters<typeof actual.motion.div>[0]) => {
        motionCapture.scrims.push({
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

const packageRoot = resolve(import.meta.dirname, '../..');

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function panelMotion(): { initial: unknown; animate: unknown; exit: unknown } {
  const found = [...motionCapture.scrims].reverse().find((entry) => {
    if (!isRecord(entry.initial)) {
      return false;
    }
    return 'y' in entry.initial;
  });
  if (!found) {
    throw new TypeError('expected the panel motion props');
  }
  return found;
}

function scrimMotion(): { initial: unknown; animate: unknown; exit: unknown } {
  const found = motionCapture.scrims.find((entry) => {
    if (!isRecord(entry.initial)) {
      return false;
    }
    return entry.initial.opacity === 0 && !('y' in entry.initial) && !('scale' in entry.initial);
  });
  if (!found) {
    throw new TypeError('expected the scrim motion props');
  }
  return found;
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

function installMatchMedia(matchesQuery: (query: string) => boolean) {
  window.matchMedia = ((query: string) => ({
    matches: matchesQuery(query),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function installLiveMatchMedia(matchesQuery: (query: string) => boolean) {
  let current = matchesQuery;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return current(query);
    },
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') {
        listeners.add(listener as (event: MediaQueryListEvent) => void);
      }
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') {
        listeners.delete(listener as (event: MediaQueryListEvent) => void);
      }
    },
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return {
    setMatches(next: (query: string) => boolean) {
      current = next;
      const event = { matches: next('(min-width: 640px)') } as MediaQueryListEvent;
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}

function scrimElement(): HTMLElement {
  const root = document.querySelector('[data-krypton-dialog-root]');
  const scrim = root?.firstElementChild;
  if (!(scrim instanceof HTMLElement)) {
    throw new TypeError('expected the dialog scrim');
  }
  return scrim;
}

function renderStyledDialog(onOpenChange: (open: boolean) => void = vi.fn(), closeOnOverlayClick?: boolean) {
  return render(
    <Dialog
      open
      closeOnOverlayClick={closeOnOverlayClick}
      onOpenChange={onOpenChange}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>换皮</DialogTitle>
          <DialogDescription>说明</DialogDescription>
        </DialogHeader>
        <p>正文</p>
        <DialogFooter>
          <button type="button">底部</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>,
  );
}

function requireHtml(element: Element | null, message: string): HTMLElement {
  if (!(element instanceof HTMLElement)) {
    throw new TypeError(message);
  }
  return element;
}

function dialogTree(open: boolean, closeLabel?: string) {
  return (
    <Dialog
      open={open}
      onOpenChange={vi.fn()}
    >
      <DialogContent closeLabel={closeLabel}>
        <DialogTitle>换皮</DialogTitle>
        <p>正文</p>
        <DialogFooter>
          <button type="button">底部</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function renderOpenDialog(closeLabel?: string) {
  render(dialogTree(true, closeLabel));
}

async function mountHost() {
  render(<DialogHost />);
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  motionCapture.scrims.length = 0;
});

describe('dialog surface', () => {
  it('puts z-50 on the dialog root and drops z-200', () => {
    renderOpenDialog();
    const root = requireHtml(
      document.querySelector('[data-krypton-dialog-root]'),
      'expected the dialog root',
    );

    expect(classTokens(root)).toContain('z-50');
    expect(classTokens(root)).not.toContain('z-200');
  });

  it('paints the panel as a raised sheet with a pop shadow', () => {
    renderOpenDialog();
    const panel = screen.getByRole('dialog', { name: '换皮' });

    expect(classTokens(panel)).toEqual(expect.arrayContaining([
      'bg-surface-raised',
      'shadow-pop',
      'rounded-t-xl',
      'sm:rounded-xl',
    ]));
  });

  it('draws the footer with a subtle line and stacks actions in reverse', () => {
    renderOpenDialog();
    const panel = screen.getByRole('dialog', { name: '换皮' });
    const footer = requireHtml(
      panel.querySelector('[data-slot="dialog-footer"]'),
      'expected the dialog footer',
    );

    expect(classTokens(footer)).toEqual(expect.arrayContaining([
      'border-line-subtle',
      'flex-col-reverse',
    ]));
  });

  it('renders the close control as a small ghost icon button', () => {
    renderOpenDialog();
    const close = screen.getByRole('button', { name: '关闭' });

    expect(close).toHaveAttribute('data-slot', 'button');
    expect(close).toHaveAttribute('data-variant', 'ghost');
    expect(close).toHaveAttribute('data-size', 'sm');
    expect(classTokens(close)).toContain('w-(--control-sm)');
  });

  it('sets the close button accessible name from closeLabel', () => {
    renderOpenDialog('关掉');
    const close = screen.getByRole('button', { name: '关掉' });

    expect(close).toHaveAttribute('aria-label', '关掉');
    expect(close).toHaveAttribute('data-variant', 'ghost');
  });

  it('does not use numeric duration values or the imperative animate function', () => {
    const source = readFileSync(resolve(packageRoot, 'src/components/ui/dialog.tsx'), 'utf8');

    expect(source).not.toMatch(/duration-\d|duration:\s*\d/);
    expect(source).not.toMatch(/\banimate\(/);
  });
});

describe('dialog command buttons', () => {
  it('resolves a destructive confirm through a danger button', async () => {
    const user = userEvent.setup();
    await mountHost();

    const confirmed = confirmDialog('删除？', { destructive: true, confirmLabel: '删除' });
    const confirm = await screen.findByRole('button', { name: '删除' });
    const cancel = screen.getByRole('button', { name: '取消' });

    expect(confirm).toHaveAttribute('data-variant', 'danger');
    expect(cancel).toHaveAttribute('data-variant', 'secondary');

    await user.click(confirm);

    expect(await confirmed).toBe(true);
  });

  it('uses a primary confirm button when the confirm is not destructive', async () => {
    const user = userEvent.setup();
    await mountHost();

    const confirmed = confirmDialog('保留？');
    const confirm = await screen.findByRole('button', { name: '确认' });
    const cancel = screen.getByRole('button', { name: '取消' });

    expect(confirm).toHaveAttribute('data-variant', 'primary');
    expect(cancel).toHaveAttribute('data-variant', 'secondary');

    await user.click(confirm);

    expect(await confirmed).toBe(true);
  });

  it('uses a primary button for alertDialog', async () => {
    const user = userEvent.setup();
    await mountHost();

    const alerted = alertDialog('已保存');
    const confirm = await screen.findByRole('button', { name: '知道了' });

    expect(confirm).toHaveAttribute('data-variant', 'primary');

    await user.click(confirm);
    await alerted;
  });

  it('keeps the spec body padding when DialogHost opens a command', async () => {
    const user = userEvent.setup();
    await mountHost();

    const confirmed = confirmDialog('删除？', { confirmLabel: '删除' });
    const dialog = await screen.findByRole('dialog', { name: '确认' });
    const body = requireHtml(
      dialog.querySelector('[data-scroll-owner="dialog"]'),
      'expected the dialog body',
    );
    const className = body.getAttribute('class') ?? '';

    expect(className).toContain('px-5');
    expect(className).toContain('pb-4');
    expect(className).not.toContain('px-6');
    expect(className).not.toContain('py-4');

    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(await confirmed).toBe(false);
  });

  it('keeps cancel before the primary action in the footer DOM', async () => {
    const user = userEvent.setup();
    await mountHost();

    const confirmed = confirmDialog('删除？', { destructive: true, confirmLabel: '删除' });
    const dialog = await screen.findByRole('dialog', { name: '确认' });
    const footer = requireHtml(
      dialog.querySelector('[data-slot="dialog-footer"]'),
      'expected the dialog footer',
    );
    const labels = Array.from(footer.querySelectorAll('button'), (button) => button.textContent);

    expect(labels).toEqual(['取消', '删除']);
    expect(classTokens(footer)).toContain('flex-col-reverse');

    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(await confirmed).toBe(false);
  });

  it('removes the hosted confirm dialog after it resolves', async () => {
    const user = userEvent.setup();
    await mountHost();

    const confirmed = confirmDialog('删除？', { confirmLabel: '删除' });
    await user.click(await screen.findByRole('button', { name: '删除' }));
    expect(await confirmed).toBe(true);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});

describe('dialog spec surface', () => {
  it('uses an opaque scrim and docks the sheet to the bottom below sm', () => {
    renderStyledDialog();
    const root = requireHtml(
      document.querySelector('[data-krypton-dialog-root]'),
      'expected the dialog root',
    );
    const scrim = scrimElement();

    expect(classTokens(root)).toEqual(expect.arrayContaining(['items-end', 'sm:items-center', 'z-50']));
    expect(classTokens(scrim)).toContain('bg-scrim');
    expect(classTokens(scrim).some((token) => token.includes('backdrop-blur'))).toBe(false);
    expect(classTokens(scrim)).not.toContain('bg-black/60');
  });

  it('draws the panel with a line border, safe-area padding, and a decorative handle', () => {
    renderStyledDialog();
    const panel = screen.getByRole('dialog', { name: '换皮' });
    const handle = panel.querySelector('div[aria-hidden="true"]');
    if (!(handle instanceof HTMLElement)) {
      throw new TypeError('expected the decorative sheet handle');
    }

    expect(classTokens(panel)).toEqual(expect.arrayContaining([
      'border-line',
      'bg-surface-raised',
      'shadow-pop',
      'pb-[max(.75rem,env(safe-area-inset-bottom))]',
    ]));
    expect(classTokens(handle)).toEqual(expect.arrayContaining([
      'h-1',
      'w-9',
      'rounded-full',
      'bg-line-strong',
      'sm:hidden',
    ]));
  });

  it('spaces the header, title, description, body, and footer from the spec', () => {
    renderStyledDialog();
    const panel = screen.getByRole('dialog', { name: '换皮' });
    const header = requireHtml(panel.querySelector('[data-slot="dialog-header"]'), 'expected the dialog header');
    const title = requireHtml(panel.querySelector('[data-slot="dialog-title"]'), 'expected the dialog title');
    const description = requireHtml(
      panel.querySelector('[data-slot="dialog-description"]'),
      'expected the dialog description',
    );
    const body = requireHtml(panel.querySelector('[data-scroll-owner="dialog"]'), 'expected the dialog body');
    const footer = requireHtml(panel.querySelector('[data-slot="dialog-footer"]'), 'expected the dialog footer');

    expect(classTokens(header)).toEqual(expect.arrayContaining(['px-5', 'pt-4', 'pb-3']));
    expect(classTokens(title)).toEqual(expect.arrayContaining(['text-lg', 'font-semibold', 'tracking-tight', 'text-fg']));
    expect(classTokens(description)).toEqual(expect.arrayContaining(['text-sm', 'text-fg-muted']));
    expect(classTokens(body)).toEqual(expect.arrayContaining(['px-5', 'pb-4', 'overflow-y-auto']));
    expect(classTokens(footer)).toEqual(expect.arrayContaining([
      'border-t',
      'border-line-subtle',
      'bg-surface-sunken/60',
      'px-5',
      'py-3',
      'flex-col-reverse',
      'sm:flex-row',
      'sm:justify-end',
      '[&>*]:w-full',
      'sm:[&>*]:w-auto',
    ]));
  });

  it('closes from the scrim only when overlay clicks are allowed', () => {
    const blocked = vi.fn();
    const blockedView = renderStyledDialog(blocked, false);
    fireEvent.click(scrimElement());
    expect(blocked).not.toHaveBeenCalled();
    blockedView.unmount();

    const allowed = vi.fn();
    renderStyledDialog(allowed, true);
    fireEvent.click(scrimElement());
    expect(allowed).toHaveBeenCalledTimes(1);
    expect(allowed).toHaveBeenCalledWith(false);
  });

  it('paints the hidden desktop pose on the first frame', () => {
    const previous = window.matchMedia;
    installMatchMedia((query) => query === '(min-width: 640px)');
    try {
      const view = render(dialogTree(false));
      view.rerender(dialogTree(true));
      const panel = screen.getByRole('dialog', { name: '换皮' });

      expect(panel.style.opacity).toBe('0');
      expect(panel.style.transform).toContain('scale(0.97)');
      expect(panel.style.transform).toContain('translateY(8px)');
      const motionProps = panelMotion();
      expect(objectField(motionProps.initial, 'y')).toBe(8);
      expect(objectField(motionProps.exit, 'y')).toBe(8);
    } finally {
      window.matchMedia = previous;
    }
  });

  it('paints the hidden narrow pose on the first frame', () => {
    const previous = window.matchMedia;
    installMatchMedia(() => false);
    try {
      const view = render(dialogTree(false));
      view.rerender(dialogTree(true));
      const panel = screen.getByRole('dialog', { name: '换皮' });

      expect(panel.style.transform).toContain('translateY(100%)');
      expect(panel.style.opacity).not.toBe('0');
      const motionProps = panelMotion();
      expect(objectField(motionProps.initial, 'y')).toBe('100%');
      expect(isRecord(motionProps.initial) && !('opacity' in motionProps.initial)).toBe(true);
      expect(objectField(motionProps.exit, 'y')).toBe('100%');
      expect(isRecord(motionProps.exit) && !('opacity' in motionProps.exit)).toBe(true);
    } finally {
      window.matchMedia = previous;
    }
  });

  it('renders an empty string for a closed dialog during static markup', () => {
    const markup = renderToStaticMarkup(
      <Dialog
        open={false}
        onOpenChange={() => undefined}
      >
        <DialogContent>x</DialogContent>
      </Dialog>,
    );

    expect(markup).toBe('');
  });

  it('fades the scrim in on enter and out on exit', () => {
    renderOpenDialog();
    const scrim = scrimMotion();
    const entering = bezierTransition(objectField(scrim.animate, 'transition'));
    const leaving = bezierTransition(objectField(scrim.exit, 'transition'));

    expect(objectField(scrim?.initial, 'opacity')).toBe(0);
    expect(objectField(scrim?.animate, 'opacity')).toBe(1);
    expect(entering.duration).toBe(MOTION.enter.duration);
    expect(entering.ease).toEqual([...MOTION.enter.ease]);
    expect(objectField(scrim?.exit, 'opacity')).toBe(0);
    expect(leaving.duration).toBe(MOTION.exit.duration);
    expect(leaving.ease).toEqual([...MOTION.exit.ease]);
  });

  it('drives the panel with the enter and exit motion tokens', () => {
    const previous = window.matchMedia;
    installMatchMedia(() => false);
    try {
      renderOpenDialog();
      const panel = panelMotion();
      const entering = bezierTransition(objectField(panel.animate, 'transition'));
      const leaving = bezierTransition(objectField(panel.exit, 'transition'));

      expect(objectField(panel.animate, 'opacity')).toBe(1);
      expect(objectField(panel.animate, 'scale')).toBe(1);
      expect(objectField(panel.animate, 'y')).toBe(0);
      expect(entering.duration).toBe(MOTION.enter.duration);
      expect(entering.ease).toEqual([...MOTION.enter.ease]);
      expect(leaving.duration).toBe(MOTION.exit.duration);
      expect(leaving.ease).toEqual([...MOTION.exit.ease]);
    } finally {
      window.matchMedia = previous;
    }
  });

  it('keeps the dialog mounted until the leave animation ends', async () => {
    const view = render(dialogTree(true));
    view.rerender(dialogTree(false));
    expect(document.querySelector('[data-krypton-dialog-root]')).not.toBeNull();
    await waitFor(() => {
      expect(document.querySelector('[data-krypton-dialog-root]')).toBeNull();
    });
  });

  it('releases Tab and Escape while the leaving dialog is still mounted', () => {
    const onOpenChange = vi.fn();
    const tree = (open: boolean) => (
      <>
        <button type="button">背景</button>
        <Dialog
          open={open}
          onOpenChange={onOpenChange}
        >
          <DialogContent>
            <DialogTitle>离场</DialogTitle>
            <button type="button">第一项</button>
            <button type="button">最后一项</button>
          </DialogContent>
        </Dialog>
      </>
    );
    const view = render(tree(true));
    view.rerender(tree(false));
    const root = document.querySelector('[data-krypton-dialog-root]');

    expect(root).not.toBeNull();
    onOpenChange.mockClear();
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(true);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(document.body, { key: 'Tab' })).toBe(true);
    expect(screen.getByRole('button', { name: '第一项' })).not.toHaveFocus();
  });

  it('follows a breakpoint change while open into the exit pose', () => {
    const previous = window.matchMedia;
    const media = installLiveMatchMedia(() => false);
    try {
      renderOpenDialog();
      const before = panelMotion();

      expect(objectField(before.exit, 'y')).toBe('100%');
      expect(isRecord(before.exit) && !('opacity' in before.exit)).toBe(true);

      act(() => {
        media.setMatches((query) => query === '(min-width: 640px)');
      });
      const after = panelMotion();

      expect(objectField(after.exit, 'opacity')).toBe(0);
      expect(objectField(after.exit, 'scale')).toBe(0.97);
      expect(objectField(after.exit, 'y')).toBe(8);
    } finally {
      window.matchMedia = previous;
    }
  });

  it('does not call createPortal again after the same dialog finishes leaving', async () => {
    portalCalls.count = 0;
    const view = render(dialogTree(true));
    expect(portalCalls.count).toBeGreaterThan(0);

    view.rerender(dialogTree(false));
    await waitFor(() => {
      expect(document.querySelector('[data-krypton-dialog-root]')).toBeNull();
    });
    await act(async () => {
      await Promise.resolve();
    });

    portalCalls.count = 0;
    view.rerender(dialogTree(false));

    expect(portalCalls.count).toBe(0);
    expect(document.querySelector('[data-krypton-dialog-root]')).toBeNull();
  });
});
