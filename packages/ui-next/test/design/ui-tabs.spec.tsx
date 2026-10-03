// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ComponentType, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Moon } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

const packageRoot = resolve(import.meta.dirname, '../..');

interface PageTabItem {
  value: string;
  label: ReactNode;
  count?: number;
  icon?: ReactNode;
  href?: string;
}

interface PageTabsProps {
  value: string;
  onValueChange?: (value: string) => void;
  items: readonly PageTabItem[];
  className?: string;
  'aria-label'?: string;
}

interface MiniTabItem {
  value: string;
  label: ReactNode;
  count?: number;
  icon?: ReactNode | ComponentType<{ className?: string }>;
  href?: string;
  disabled?: boolean;
  ariaLabel?: string;
}

interface MiniTabsProps {
  value: string;
  onValueChange?: (value: string) => void;
  items: readonly MiniTabItem[];
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  className?: string;
  'aria-label'?: string;
}

interface BreadcrumbProps {
  items: ReadonlyArray<{ label: ReactNode; href?: string }>;
}

function sourceOf(relativePath: string): string {
  return readFileSync(resolve(packageRoot, relativePath), 'utf8');
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

/** Underline specified for the active page tab: inside the tab, flush to its bottom edge. */
function indicatorInside(tab: Element): Element | undefined {
  return [...tab.querySelectorAll('*')].find((element) => {
    const tokens = classTokens(element);
    return tokens.includes('absolute')
      && tokens.includes('inset-x-0')
      && tokens.includes('bottom-0')
      && tokens.includes('h-0.5')
      && tokens.includes('bg-fg');
  });
}

/** Selected MiniTabs pill: the sliding surface sits on the active item only. */
function selectedPill(tab: Element): Element | undefined {
  return [...tab.querySelectorAll('*')].find((element) => {
    const tokens = classTokens(element);
    return tokens.includes('absolute')
      && tokens.includes('inset-0')
      && tokens.includes('rounded-sm')
      && tokens.includes('bg-surface')
      && tokens.includes('shadow-sm')
      && tokens.includes('dark:bg-surface-raised');
  });
}

/** `sm` is `size-3`, `md` is `size-3.5`, on the svg or as `[&_svg]:size-*`. */
function iconHasSize(tab: Element, sizeToken: string): boolean {
  const svg = tab.querySelector('svg');
  if (svg && classTokens(svg).includes(sizeToken)) {
    return true;
  }
  const scoped = `[&_svg]:${sizeToken}`;
  return [tab, ...tab.querySelectorAll('*')].some((element) => classTokens(element).includes(scoped));
}

function spanText(tab: Element, text: string): Element | undefined {
  return [...tab.querySelectorAll('span')].find((element) => element.textContent === text);
}

/** A label span contains only text. The absolute sliding pill is not one. */
function labelTextSpans(root: Element): Element[] {
  return [...root.querySelectorAll('span')].filter((span) => {
    if (classTokens(span).includes('absolute')) {
      return false;
    }
    return [...span.childNodes].every((node) => node.nodeType === Node.TEXT_NODE);
  });
}

function crumbItem(label: string): HTMLElement {
  const text = screen.getByText(label);
  const item = text.closest('a') ?? text.closest('[aria-current="page"]') ?? text.closest('span');
  if (!(item instanceof HTMLElement)) {
    throw new TypeError(`expected a crumb for ${label}`);
  }
  return item;
}

function expectTruncatedCrumb(label: string): HTMLElement {
  const item = crumbItem(label);
  expect(classTokens(item)).toEqual(expect.arrayContaining(['min-w-0', 'truncate']));
  return item;
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

async function loadComponent<Props extends object>(specifier: string, name: string): Promise<ComponentType<Props>> {
  const loaded: unknown = await import(specifier);
  if (typeof loaded !== 'object' || loaded === null) {
    throw new TypeError(`${name} module is not an object`);
  }
  const component = readField(loaded, name);
  if (!isComponent<Props>(component)) {
    throw new TypeError(`${name} is not a function`);
  }
  return component;
}

function IconOnly(props: { className?: string }): ReactNode {
  return createElement('svg', { className: props.className, 'aria-hidden': true });
}

describe('page tabs', () => {
  it('selects only the second tab and reports the third value', async () => {
    const PageTabs = await loadComponent<PageTabsProps>('../../src/components/ui/page-tabs', 'PageTabs');
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(createElement(PageTabs, {
      value: 'b',
      onValueChange,
      items: [
        { value: 'a', label: '甲' },
        { value: 'b', label: '乙' },
        { value: 'c', label: '丙' },
      ],
    }));
    const tabs = screen.getAllByRole('tab');

    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'false');
    expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1);
    expect(screen.getAllByRole('tab', { selected: true })[0]).toBe(tabs[1]);
    expect(indicatorInside(tabs[1])).toBeInstanceOf(Element);

    await user.click(tabs[2]);

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('c');
  });

  it('lets the tablist scroll horizontally without a visible scrollbar', async () => {
    const PageTabs = await loadComponent<PageTabsProps>('../../src/components/ui/page-tabs', 'PageTabs');
    render(createElement(PageTabs, {
      value: 'b',
      items: [
        { value: 'a', label: '甲' },
        { value: 'b', label: '乙' },
        { value: 'c', label: '丙' },
      ],
    }));

    expect(classTokens(screen.getByRole('tablist'))).toEqual(expect.arrayContaining([
      'overflow-x-auto',
      'overflow-y-hidden',
      'scrollbar-none',
    ]));
  });

  it('does not pull the indicator out with a negative bottom offset', () => {
    expect(sourceOf('src/components/ui/page-tabs.tsx').includes('-bottom-px')).toBe(false);
  });

  it('shows a count and renders an href tab as a link', async () => {
    const PageTabs = await loadComponent<PageTabsProps>('../../src/components/ui/page-tabs', 'PageTabs');
    render(createElement(PageTabs, {
      value: 'a',
      items: [
        { value: 'a', label: '全部', count: 12 },
        { value: 'b', label: '题集', href: '/sets' },
      ],
    }));
    const link = screen.getByRole('tab', { name: '题集' });

    expect(screen.getByRole('tab', { name: /全部/ })).toHaveTextContent('12');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/sets');
    expect(link).toHaveAttribute('role', 'tab');
    expect(link.hasAttribute('aria-selected')).toBe(true);
  });

  it('keeps a count of zero visible', async () => {
    const PageTabs = await loadComponent<PageTabsProps>('../../src/components/ui/page-tabs', 'PageTabs');
    render(createElement(PageTabs, {
      value: 'a',
      items: [
        { value: 'a', label: '全部', count: 0 },
        { value: 'b', label: '题集' },
      ],
    }));
    const tab = screen.getByRole('tab', { name: /全部/ });

    expect(spanText(tab, '0')).toBeInstanceOf(Element);
  });

  it('names the tablist and keeps the caller layout class', async () => {
    const PageTabs = await loadComponent<PageTabsProps>('../../src/components/ui/page-tabs', 'PageTabs');
    render(createElement(PageTabs, {
      value: 'a',
      className: 'mt-4',
      'aria-label': '题目范围',
      items: [{ value: 'a', label: '全部' }],
    }));
    const tablist = screen.getByRole('tablist');

    expect(tablist).toHaveAttribute('aria-label', '题目范围');
    expect(classTokens(tablist)).toContain('mt-4');
  });

  it('renders the tab icon inside that tab', async () => {
    const PageTabs = await loadComponent<PageTabsProps>('../../src/components/ui/page-tabs', 'PageTabs');
    render(createElement(PageTabs, {
      value: 'a',
      items: [{
        value: 'a',
        label: '全部',
        icon: createElement('span', { 'data-testid': 'tab-icon' }, '星'),
      }],
    }));
    const icon = screen.getByTestId('tab-icon');

    expect(icon.closest('[role="tab"]')).toBe(screen.getByRole('tab'));
  });

  it('reports the link tab value when it is chosen', async () => {
    const PageTabs = await loadComponent<PageTabsProps>('../../src/components/ui/page-tabs', 'PageTabs');
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(createElement(PageTabs, {
      value: 'a',
      onValueChange,
      items: [
        { value: 'a', label: '甲' },
        { value: 'b', label: '题集', href: '/sets' },
      ],
    }));
    const link = screen.getByRole('tab', { name: '题集' });

    expect(link.tagName).toBe('A');
    await user.click(link);

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('b');
  });

  it('tones only the selected count with the brand classes', async () => {
    const PageTabs = await loadComponent<PageTabsProps>('../../src/components/ui/page-tabs', 'PageTabs');
    render(createElement(PageTabs, {
      value: 'b',
      items: [
        { value: 'a', label: '全部', count: 0 },
        { value: 'b', label: '进行中', count: 4 },
      ],
    }));
    const selectedCount = spanText(screen.getByRole('tab', { name: /进行中/ }), '4');
    const idleCount = spanText(screen.getByRole('tab', { name: /全部/ }), '0');
    if (!(selectedCount instanceof Element) || !(idleCount instanceof Element)) {
      throw new TypeError('expected both page counts');
    }

    expect(classTokens(selectedCount)).toEqual(expect.arrayContaining(['bg-brand-soft', 'text-brand-fg']));
    expect(classTokens(idleCount)).not.toContain('bg-brand-soft');
  });

  it('draws the underline only inside the selected tab', async () => {
    const PageTabs = await loadComponent<PageTabsProps>('../../src/components/ui/page-tabs', 'PageTabs');
    render(createElement(PageTabs, {
      value: 'b',
      items: [
        { value: 'a', label: '甲' },
        { value: 'b', label: '乙' },
        { value: 'c', label: '丙' },
      ],
    }));
    const tabs = screen.getAllByRole('tab');

    expect(indicatorInside(tabs[0])).toBeUndefined();
    expect(indicatorInside(tabs[1])).toBeInstanceOf(Element);
    expect(indicatorInside(tabs[2])).toBeUndefined();
  });

  it('accepts a choice when no change handler was given', async () => {
    const PageTabs = await loadComponent<PageTabsProps>('../../src/components/ui/page-tabs', 'PageTabs');
    const user = userEvent.setup();
    render(createElement(PageTabs, {
      value: 'a',
      items: [
        { value: 'a', label: '甲' },
        { value: 'b', label: '乙' },
      ],
    }));

    await user.click(screen.getByRole('tab', { name: '乙' }));

    expect(screen.getByRole('tab', { name: '乙' })).toHaveAttribute('aria-selected', 'false');
  });

  it('reflects selection on addressed tabs', async () => {
    const PageTabs = await loadComponent<PageTabsProps>('../../src/components/ui/page-tabs', 'PageTabs');
    render(createElement(PageTabs, {
      value: 'b',
      items: [
        { value: 'a', label: '甲', href: '/a' },
        { value: 'b', label: '乙', href: '/b' },
      ],
    }));
    const tabs = screen.getAllByRole('tab');

    expect(tabs[0].tagName).toBe('A');
    expect(tabs[1].tagName).toBe('A');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
  });
});

describe('mini tabs', () => {
  it('marks the selected item with aria-selected on a button', async () => {
    const MiniTabs = await loadComponent<MiniTabsProps>('../../src/components/ui/mini-tabs', 'MiniTabs');
    render(createElement(MiniTabs, {
      value: 'b',
      items: [
        { value: 'a', label: '甲' },
        { value: 'b', label: '乙' },
      ],
    }));
    const selected = screen.getByRole('tab', { name: '乙' });

    expect(selected.tagName).toBe('BUTTON');
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '甲' })).toHaveAttribute('aria-selected', 'false');
  });

  it('does not keep the old indicator spring or fixed height rungs', () => {
    const source = sourceOf('src/components/ui/mini-tabs.tsx');

    expect(source.includes('stiffness: 500')).toBe(false);
    expect(source).toMatch(/transition=\{MOTION\.spring\}/);
    expect(source).not.toMatch(/\bh-(8|9)\b/);
  });

  it('sizes segment buttons from the control tokens', async () => {
    const MiniTabs = await loadComponent<MiniTabsProps>('../../src/components/ui/mini-tabs', 'MiniTabs');
    const small = render(createElement(MiniTabs, {
      value: 'a',
      size: 'sm',
      items: [
        { value: 'a', label: '甲' },
        { value: 'b', label: '乙' },
      ],
    }));

    for (const tab of screen.getAllByRole('tab')) {
      expect(classTokens(tab)).toContain('h-[calc(var(--control-sm)-4px)]');
      expect(classTokens(tab)).not.toContain('h-[calc(var(--control-md)-4px)]');
    }
    small.unmount();

    render(createElement(MiniTabs, {
      value: 'a',
      size: 'md',
      items: [
        { value: 'a', label: '甲' },
        { value: 'b', label: '乙' },
      ],
    }));

    for (const tab of screen.getAllByRole('tab')) {
      expect(classTokens(tab)).toContain('h-[calc(var(--control-md)-4px)]');
      expect(classTokens(tab)).not.toContain('h-[calc(var(--control-sm)-4px)]');
    }
  });

  it('names an icon-only segment from ariaLabel and skips the text span', async () => {
    const MiniTabs = await loadComponent<MiniTabsProps>('../../src/components/ui/mini-tabs', 'MiniTabs');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const small = render(createElement(MiniTabs, {
      value: 'dark',
      items: [{
        value: 'dark',
        label: null,
        icon: createElement(Moon),
        ariaLabel: '暗色',
      }],
    }));
    const control = screen.getByRole('tab', { name: '暗色' });

    expect(control).toHaveAttribute('aria-label', '暗色');
    expect(labelTextSpans(control)).toHaveLength(0);
    expect(iconHasSize(control, 'size-3')).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    small.unmount();

    render(createElement(MiniTabs, {
      value: 'dark',
      size: 'md',
      items: [{
        value: 'dark',
        label: null,
        icon: createElement(Moon),
        ariaLabel: '暗色',
      }],
    }));
    const medium = screen.getByRole('tab', { name: '暗色' });

    expect(labelTextSpans(medium)).toHaveLength(0);
    expect(iconHasSize(medium, 'size-3.5')).toBe(true);
  });

  it('warns once in development when an icon-only item omits ariaLabel', async () => {
    const MiniTabs = await loadComponent<MiniTabsProps>('../../src/components/ui/mini-tabs', 'MiniTabs');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(createElement(MiniTabs, {
      value: 'dark',
      items: [{ value: 'dark', label: null, icon: IconOnly }],
    }));

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('renders an addressed segment as a link', async () => {
    const MiniTabs = await loadComponent<MiniTabsProps>('../../src/components/ui/mini-tabs', 'MiniTabs');
    render(createElement(MiniTabs, {
      value: 'sets',
      items: [{ value: 'sets', label: '题集', href: '/sets' }],
    }));
    const link = screen.getByRole('tab', { name: '题集' });

    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/sets');
  });

  it('renders a disabled addressed segment as an anchor without an href', async () => {
    const MiniTabs = await loadComponent<MiniTabsProps>('../../src/components/ui/mini-tabs', 'MiniTabs');
    render(createElement(MiniTabs, {
      value: 'other',
      items: [{ value: 'k', label: '打印亭', href: '/print', disabled: true }],
    }));
    const anchor = screen.getByText('打印亭').closest('a');
    if (!(anchor instanceof HTMLAnchorElement)) {
      throw new TypeError('expected a disabled anchor');
    }

    expect(anchor.getAttribute('href')).toBeNull();
    expect(anchor).toHaveAttribute('aria-disabled', 'true');
    expect(anchor.getAttribute('tabindex')).toBe('-1');
    expect(anchor.tabIndex).toBe(-1);
    expect(classTokens(anchor)).toEqual(expect.arrayContaining(['pointer-events-none', 'opacity-45']));
  });

  it('hides the horizontal scrollbar on the segment track', async () => {
    const MiniTabs = await loadComponent<MiniTabsProps>('../../src/components/ui/mini-tabs', 'MiniTabs');
    render(createElement(MiniTabs, {
      value: 'a',
      items: [{ value: 'a', label: '甲' }],
    }));

    expect(classTokens(screen.getByRole('tablist'))).toEqual(expect.arrayContaining([
      'overflow-y-hidden',
      'scrollbar-none',
      'rounded-md',
      'bg-surface-active',
      'p-0.5',
    ]));
  });

  it('places the sliding pill only on the selected item', async () => {
    const MiniTabs = await loadComponent<MiniTabsProps>('../../src/components/ui/mini-tabs', 'MiniTabs');
    render(createElement(MiniTabs, {
      value: 'b',
      items: [
        { value: 'a', label: '甲' },
        { value: 'b', label: '乙' },
      ],
    }));
    const selected = screen.getByRole('tab', { name: '乙' });
    const idle = screen.getByRole('tab', { name: '甲' });

    expect(selectedPill(selected)).toBeInstanceOf(Element);
    expect(selectedPill(idle)).toBeUndefined();
  });

  it('shows numeric counts, including zero, and tones the selected count with brand', async () => {
    const MiniTabs = await loadComponent<MiniTabsProps>('../../src/components/ui/mini-tabs', 'MiniTabs');
    render(createElement(MiniTabs, {
      value: 'b',
      items: [
        { value: 'a', label: '甲', count: 0 },
        { value: 'b', label: '乙', count: 4 },
      ],
    }));
    const selectedCount = spanText(screen.getByRole('tab', { name: /乙/ }), '4');
    const idleCount = spanText(screen.getByRole('tab', { name: /甲/ }), '0');
    if (!(selectedCount instanceof Element) || !(idleCount instanceof Element)) {
      throw new TypeError('expected both count badges');
    }

    expect(classTokens(selectedCount)).toEqual(expect.arrayContaining(['bg-brand-soft', 'text-brand-fg']));
    expect(classTokens(idleCount)).not.toContain('bg-brand-soft');
  });

  it('reports the clicked segment value', async () => {
    const MiniTabs = await loadComponent<MiniTabsProps>('../../src/components/ui/mini-tabs', 'MiniTabs');
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(createElement(MiniTabs, {
      value: 'a',
      onValueChange,
      items: [
        { value: 'a', label: '甲' },
        { value: 'b', label: '乙' },
      ],
    }));

    await user.click(screen.getByRole('tab', { name: '乙' }));

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('b');
  });

  it('stretches each segment across the track only when fullWidth is set', async () => {
    const MiniTabs = await loadComponent<MiniTabsProps>('../../src/components/ui/mini-tabs', 'MiniTabs');
    const compact = render(createElement(MiniTabs, {
      value: 'a',
      items: [
        { value: 'a', label: '甲' },
        { value: 'b', label: '乙' },
      ],
    }));

    for (const tab of screen.getAllByRole('tab')) {
      expect(classTokens(tab)).toContain('shrink-0');
      expect(classTokens(tab)).not.toContain('flex-1');
    }
    compact.unmount();

    render(createElement(MiniTabs, {
      value: 'a',
      fullWidth: true,
      items: [
        { value: 'a', label: '甲' },
        { value: 'b', label: '乙' },
      ],
    }));

    for (const tab of screen.getAllByRole('tab')) {
      expect(classTokens(tab)).toContain('flex-1');
      expect(classTokens(tab)).not.toContain('shrink-0');
    }
  });

  it('renders a lucide icon component, not only an element', async () => {
    const MiniTabs = await loadComponent<MiniTabsProps>('../../src/components/ui/mini-tabs', 'MiniTabs');
    const small = render(createElement(MiniTabs, {
      value: 'dark',
      items: [{ value: 'dark', label: '暗色', icon: Moon }],
    }));
    const smallTab = screen.getByRole('tab', { name: '暗色' });

    expect(iconHasSize(smallTab, 'size-3')).toBe(true);
    expect(iconHasSize(smallTab, 'size-3.5')).toBe(false);
    small.unmount();

    render(createElement(MiniTabs, {
      value: 'dark',
      size: 'md',
      items: [{ value: 'dark', label: '暗色', icon: Moon }],
    }));
    const mediumTab = screen.getByRole('tab', { name: '暗色' });

    expect(iconHasSize(mediumTab, 'size-3.5')).toBe(true);
    expect(iconHasSize(mediumTab, 'size-3')).toBe(false);
  });

  it('warns once when an unnamed icon-only item renders again', async () => {
    const MiniTabs = await loadComponent<MiniTabsProps>('../../src/components/ui/mini-tabs', 'MiniTabs');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const view = render(createElement(MiniTabs, {
      value: 'compact',
      items: [{ value: 'compact', label: null, icon: IconOnly }],
    }));

    view.rerender(createElement(MiniTabs, {
      value: 'compact',
      items: [{ value: 'compact', label: null, icon: IconOnly }],
    }));

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('sets ariaLabel on an addressed segment', async () => {
    const MiniTabs = await loadComponent<MiniTabsProps>('../../src/components/ui/mini-tabs', 'MiniTabs');
    render(createElement(MiniTabs, {
      value: 'sets',
      items: [{
        value: 'sets',
        label: '题集',
        href: '/sets',
        ariaLabel: '打开题集',
      }],
    }));
    const link = screen.getByRole('tab', { name: '打开题集' });

    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/sets');
    expect(link).toHaveAttribute('aria-label', '打开题集');
  });

  it('keeps a non-null numeric label in a text span', async () => {
    const MiniTabs = await loadComponent<MiniTabsProps>('../../src/components/ui/mini-tabs', 'MiniTabs');
    render(createElement(MiniTabs, {
      value: 'n',
      items: [{ value: 'n', label: 0 }],
    }));
    const spans = labelTextSpans(screen.getByRole('tab', { name: '0' }));

    expect(spans.map((span) => span.textContent)).toEqual(['0']);
  });

  it('keeps a disabled segment button inert', async () => {
    const MiniTabs = await loadComponent<MiniTabsProps>('../../src/components/ui/mini-tabs', 'MiniTabs');
    render(createElement(MiniTabs, {
      value: 'b',
      items: [
        { value: 'a', label: '甲', disabled: true },
        { value: 'b', label: '乙' },
      ],
    }));
    const disabled = screen.getByRole('tab', { name: '甲' });

    expect(disabled.tagName).toBe('BUTTON');
    expect(disabled).toBeDisabled();
    expect(classTokens(disabled)).toEqual(expect.arrayContaining(['pointer-events-none', 'opacity-50']));
  });
});

describe('breadcrumb', () => {
  it('marks the last crumb as the current page and links only the earlier hrefs', async () => {
    const Breadcrumb = await loadComponent<BreadcrumbProps>('../../src/components/ui/breadcrumb', 'Breadcrumb');
    render(createElement(Breadcrumb, {
      items: [
        { label: '首页', href: '/' },
        { label: '题库', href: '/p' },
        { label: '当前题', href: '/p/1' },
      ],
    }));
    const current = crumbItem('当前题');
    const nav = current.closest('nav');
    if (!(nav instanceof HTMLElement)) {
      throw new TypeError('expected the breadcrumb nav');
    }

    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.tagName).not.toBe('A');
    expect(current.closest('a')).toBeNull();
    expect(screen.getByRole('link', { name: '首页' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: '题库' })).toHaveAttribute('href', '/p');
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(classTokens(nav)).toEqual(expect.arrayContaining(['min-w-0', 'overflow-hidden']));
    expectTruncatedCrumb('首页');
    expectTruncatedCrumb('题库');
    expectTruncatedCrumb('当前题');
    const separators = [...nav.querySelectorAll('svg')];
    expect(separators.length).toBeGreaterThan(0);
    for (const separator of separators) {
      expect(classTokens(separator)).toContain('shrink-0');
    }
  });

  it('renders a crumb without an address as text and does not mark it current', async () => {
    const Breadcrumb = await loadComponent<BreadcrumbProps>('../../src/components/ui/breadcrumb', 'Breadcrumb');
    render(createElement(Breadcrumb, {
      items: [
        { label: '首页', href: '/' },
        { label: '目录' },
        { label: '当前页' },
      ],
    }));
    const middle = crumbItem('目录');
    const current = crumbItem('当前页');

    expect(middle.tagName).not.toBe('A');
    expect(middle.closest('a')).toBeNull();
    expect(middle).not.toHaveAttribute('aria-current', 'page');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.tagName).not.toBe('A');
    expect(screen.getByRole('link', { name: '首页' })).toHaveAttribute('href', '/');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expectTruncatedCrumb('首页');
    expectTruncatedCrumb('目录');
    expectTruncatedCrumb('当前页');
  });

  it('names the navigation breadcrumb', async () => {
    const Breadcrumb = await loadComponent<BreadcrumbProps>('../../src/components/ui/breadcrumb', 'Breadcrumb');
    render(createElement(Breadcrumb, {
      items: [
        { label: '首页', href: '/' },
        { label: '当前页' },
      ],
    }));

    expect(screen.getByRole('navigation', { name: 'breadcrumb' }).tagName).toBe('NAV');
  });

  it('separates every crumb after the first', async () => {
    const Breadcrumb = await loadComponent<BreadcrumbProps>('../../src/components/ui/breadcrumb', 'Breadcrumb');
    render(createElement(Breadcrumb, {
      items: [
        { label: '首页', href: '/' },
        { label: '当前页' },
      ],
    }));
    const nav = crumbItem('当前页').closest('nav');
    if (!(nav instanceof HTMLElement)) {
      throw new TypeError('expected the breadcrumb nav');
    }

    const separators = [...nav.querySelectorAll('svg')];
    expect(separators).toHaveLength(1);
    const separator = separators[0];
    if (!(separator instanceof Element)) {
      throw new TypeError('expected a separator');
    }
    expect(classTokens(separator)).toContain('shrink-0');
  });

  it('paints only the current crumb as muted text', async () => {
    const Breadcrumb = await loadComponent<BreadcrumbProps>('../../src/components/ui/breadcrumb', 'Breadcrumb');
    render(createElement(Breadcrumb, {
      items: [
        { label: '首页', href: '/' },
        { label: '当前题', href: '/p/1' },
      ],
    }));
    const current = crumbItem('当前题');

    expect(current.tagName).not.toBe('A');
    expect(classTokens(current)).toContain('text-fg-muted');
    expect(classTokens(screen.getByRole('link', { name: '首页' }))).not.toContain('text-fg-muted');
  });
});

describe('legacy tabs module', () => {
  it('is removed', () => {
    expect(existsSync(resolve(packageRoot, 'src/components/ui/tabs.tsx'))).toBe(false);
  });
});
