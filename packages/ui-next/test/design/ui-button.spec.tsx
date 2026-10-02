// @vitest-environment jsdom
import type { ComponentProps, ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import * as buttonModule from '../../src/components/ui/button';

const { Button, buttonVariants } = buttonModule;

const SVG_SIZE = {
  sm: '[&_svg]:size-3.5',
  md: '[&_svg]:size-4',
  lg: '[&_svg]:size-4.5',
} as const;

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function buttonNamed(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

/**
 * Loading must not look disabled. The shared disabled fade may stay in the
 * class list only when an important full-opacity class overrides it.
 */
function loadingUsesDisabledFade(element: Element): boolean {
  const tokens = classTokens(element);
  if (tokens.includes('opacity-45')) {
    return true;
  }
  if (!tokens.includes('disabled:opacity-45')) {
    return false;
  }
  return !tokens.includes('opacity-100!') && !tokens.includes('!opacity-100');
}

function layoutGap(element: Element): string | undefined {
  return classTokens(element).find((token) => token.startsWith('gap-'));
}

function keepsFlexGap(element: Element): boolean {
  const tokens = classTokens(element);
  return tokens.includes('flex') || tokens.includes('inline-flex');
}

/** Absolute positioning, on the node or a wrapper, keeps the spinner out of the flex line. */
function takenOutOfFlow(element: Element, boundary: Element): boolean {
  let current: Element | null = element;
  while (current && current !== boundary) {
    if (classTokens(current).includes('absolute')) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function readButtonGroup(): unknown {
  const record: unknown = buttonModule;
  if (typeof record !== 'object' || record === null) {
    throw new TypeError('expected the button module');
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === 'ButtonGroup' && typeof value === 'function') {
      return value;
    }
  }
  return undefined;
}

function isButtonGroup(
  value: unknown,
): value is (props: ComponentProps<'div'>) => ReactElement {
  return typeof value === 'function';
}

describe('button', () => {
  it('renders an omitted variant as primary', () => {
    render(<Button>x</Button>);
    const button = buttonNamed('x');

    expect(button).toHaveAttribute('data-slot', 'button');
    expect(button).toHaveAttribute('data-variant', 'primary');
    expect(button).toHaveAttribute('data-size', 'md');
    expect(classTokens(button)).toContain('bg-brand');
  });

  it('maps variant="outline" to secondary with a line border', () => {
    render(<Button variant="outline">取消</Button>);
    const button = buttonNamed('取消');

    expect(button).toHaveAttribute('data-variant', 'secondary');
    expect(classTokens(button)).toContain('border-line');
  });

  it('maps variant="destructive" to danger', () => {
    render(<Button variant="destructive">删除</Button>);
    const button = buttonNamed('删除');

    expect(button).toHaveAttribute('data-variant', 'danger');
    expect(classTokens(button)).toContain('bg-danger');
  });

  it('maps variant="default" to primary', () => {
    render(<Button variant="default">保存</Button>);
    const button = buttonNamed('保存');

    expect(button).toHaveAttribute('data-variant', 'primary');
    expect(classTokens(button)).toContain('bg-brand');
  });

  it('maps size="icon" to a square md control', () => {
    render(<Button size="icon">x</Button>);
    const button = buttonNamed('x');

    expect(button).toHaveAttribute('data-size', 'md');
    expect(classTokens(button)).toContain('w-(--control-md)');
  });

  it('maps size="default" to md', () => {
    render(<Button size="default">默认</Button>);

    expect(buttonNamed('默认')).toHaveAttribute('data-size', 'md');
  });

  it('paints ghost as a hover surface without a brand fill', () => {
    render(<Button variant="ghost">工具</Button>);
    const button = buttonNamed('工具');

    expect(button).toHaveAttribute('data-variant', 'ghost');
    expect(classTokens(button)).toContain('hover:bg-surface-hover');
    expect(button.getAttribute('class') ?? '').not.toContain('bg-brand');
  });

  it('shows a spinner, blocks the click, and does not fade while loading', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button
        loading
        onClick={onClick}
      >
        <svg
          aria-hidden="true"
          data-testid="leading-icon"
          viewBox="0 0 16 16"
        />
        保存
      </Button>,
    );
    const button = buttonNamed('保存');

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('svg')?.tagName.toLowerCase()).toBe('svg');
    expect(button).toHaveTextContent('保存');
    expect(loadingUsesDisabledFade(button)).toBe(false);

    const icon = button.querySelector('[data-testid="leading-icon"]');
    const slot = icon?.parentElement;
    expect(icon?.tagName.toLowerCase()).toBe('svg');
    expect(slot?.tagName.toLowerCase()).toBe('span');
    if (!(icon instanceof Element) || !(slot instanceof HTMLElement)) {
      throw new TypeError('expected the loading content slot');
    }
    expect(slot.textContent ?? '').toContain('保存');
    expect(keepsFlexGap(slot)).toBe(true);
    const buttonGap = layoutGap(button);
    expect(buttonGap).toBeDefined();
    if (buttonGap === undefined) {
      throw new TypeError('expected the button gap');
    }
    expect(classTokens(slot)).toContain(buttonGap);
    expect(classTokens(slot)).not.toContain('hidden');
    const spinner = [...button.querySelectorAll('svg')].find((svg) => svg !== icon);
    expect(spinner?.tagName.toLowerCase()).toBe('svg');
    if (!(spinner instanceof Element)) {
      throw new TypeError('expected the spinner');
    }
    expect(slot.contains(spinner)).toBe(false);
    expect(takenOutOfFlow(spinner, button)).toBe(true);

    await user.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders the child anchor when asChild is set', () => {
    render(
      <Button asChild>
        <a href="/x">打开</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: '打开' });

    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/x');
    expect(link).toHaveAttribute('data-slot', 'button');
  });

  it('ignores loading when asChild is set', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn((event: { preventDefault(): void }) => {
      event.preventDefault();
    });
    render(
      <Button
        asChild
        loading
        onClick={onClick}
      >
        <a href="/x">打开</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: '打开' });

    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/x');
    expect(link).not.toHaveAttribute('aria-busy', 'true');
    expect(link).not.toHaveAttribute('disabled');
    expect(link.querySelector('svg')).toBeNull();

    await user.click(link);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders ButtonGroup as role=group around its buttons', () => {
    const ButtonGroup = readButtonGroup();

    expect(typeof ButtonGroup).toBe('function');
    if (!isButtonGroup(ButtonGroup)) {
      throw new TypeError('expected ButtonGroup');
    }

    render(
      <ButtonGroup>
        <Button />
        <Button />
      </ButtonGroup>,
    );
    const group = screen.getByRole('group');

    expect(group.querySelectorAll('button')).toHaveLength(2);
  });

  it('returns soft and sm classes from buttonVariants', () => {
    const classes = buttonVariants({ variant: 'soft', size: 'sm' });

    expect(classes).toContain('bg-brand-soft');
    expect(classes).toContain('h-(--control-sm)');
  });

  it('sets the svg size from the canonical control size', () => {
    const cases = [
      { size: 'sm', label: '小', token: SVG_SIZE.sm, height: 'h-(--control-sm)' },
      { size: 'md', label: '中', token: SVG_SIZE.md, height: 'h-(--control-md)' },
      { size: 'lg', label: '大', token: SVG_SIZE.lg, height: 'h-(--control-lg)' },
    ] as const;

    for (const { size, label, token, height } of cases) {
      const view = render(<Button size={size}>{label}</Button>);
      const button = buttonNamed(label);

      expect(button).toHaveAttribute('data-size', size);
      expect(classTokens(button)).toContain(token);
      expect(classTokens(button)).toContain(height);
      for (const other of Object.values(SVG_SIZE)) {
        if (other !== token) {
          expect(classTokens(button)).not.toContain(other);
        }
      }
      view.unmount();
    }
  });

  it('does not square a button when iconOnly is omitted', () => {
    const omitted = render(<Button>文字</Button>);

    expect(classTokens(buttonNamed('文字'))).not.toContain('w-(--control-md)');
    omitted.unmount();

    render(<Button size="default">默认尺寸</Button>);
    const sized = buttonNamed('默认尺寸');

    expect(sized).toHaveAttribute('data-size', 'md');
    expect(classTokens(sized)).not.toContain('w-(--control-md)');
    expect(buttonVariants({ size: 'default' })).not.toContain('w-(--control-md)');
  });

  it('uses the matching control width for an icon-only button', () => {
    const cases = [
      { size: 'sm', label: '小图标', width: 'w-(--control-sm)' },
      { size: 'md', label: '中图标', width: 'w-(--control-md)' },
      { size: 'lg', label: '大图标', width: 'w-(--control-lg)' },
    ] as const;

    for (const { size, label, width } of cases) {
      const view = render(
        <Button
          size={size}
          iconOnly
          aria-label={label}
        />,
      );
      const button = screen.getByRole('button', { name: label });

      expect(button).toHaveAttribute('data-size', size);
      expect(classTokens(button)).toContain(width);
      expect(classTokens(button)).toContain('px-0');
      view.unmount();
    }
  });

  it('forwards aria-busy when the button is not loading', () => {
    render(<Button aria-busy="true">忙</Button>);
    const button = buttonNamed('忙');

    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).not.toBeDisabled();
  });

  it('keeps an explicit disabled button from firing clicks', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button
        disabled
        onClick={onClick}
      >
        停用
      </Button>,
    );
    const button = buttonNamed('停用');

    expect(button).toBeDisabled();

    await user.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });

  it('canonicalizes legacy values inside buttonVariants', () => {
    expect(buttonVariants({ variant: 'outline' })).toContain('border-line');
    expect(buttonVariants({ variant: 'destructive' })).toContain('bg-danger');
    expect(buttonVariants({ variant: 'default' })).toContain('bg-brand');
    expect(buttonVariants({ size: 'icon' })).toContain('w-(--control-md)');
  });

  it('paints danger-soft with the danger soft tokens', () => {
    render(<Button variant="danger-soft">撤回</Button>);
    const button = buttonNamed('撤回');

    expect(button).toHaveAttribute('data-variant', 'danger-soft');
    expect(classTokens(button)).toContain('bg-danger-soft');
    expect(classTokens(button)).toContain('text-danger-fg');
  });

  it('paints link as brand text with an underline on hover', () => {
    render(<Button variant="link">查看全部</Button>);
    const button = buttonNamed('查看全部');

    expect(button).toHaveAttribute('data-variant', 'link');
    expect(classTokens(button)).toContain('text-brand-fg');
    expect(classTokens(button)).toContain('hover:underline');
  });

  it('keeps a caller layout class', () => {
    render(<Button className="w-full">全宽</Button>);

    expect(classTokens(buttonNamed('全宽'))).toContain('w-full');
  });
});
