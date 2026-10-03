// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ComponentType, type ReactNode } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as badgeModule from '../../src/components/ui/badge';

// Resolved when the test runs. A static import fails collection while display.tsx is absent.
const displayLoaders = import.meta.glob('../../src/components/ui/display.tsx');

const DISPLAY_SOURCE = 'src/components/ui/display.tsx';
const PULSE_CLASS = 'animate-[kr-pulse-dot_1.6s_ease-in-out_infinite]';
const CODE_SIZE_ALLOW = 'ds-allow DS009: 行内代码相对父级字号缩小 10%，阶梯字号无法表达';

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'orange';
type BadgeVariant = 'soft' | 'outline' | 'solid' | 'default' | 'secondary' | 'destructive';

interface BadgeProps {
  tone?: BadgeTone;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  dot?: boolean;
  className?: string;
  children?: ReactNode;
  id?: string;
  title?: string;
}

interface StatusDotProps {
  tone?: BadgeTone;
  pulse?: boolean;
  className?: string;
}

interface ProgressProps {
  value: number;
  tone?: 'brand' | 'success' | 'warning' | 'danger';
  size?: 'sm' | 'md';
  className?: string;
}

interface StatProps {
  label: string;
  value: ReactNode;
  unit?: string;
  delta?: number;
  hint?: string;
}

interface ClassNameProps {
  className?: string;
  children?: ReactNode;
}

interface DisplayApi {
  Spinner: ComponentType<ClassNameProps>;
  StatusDot: ComponentType<StatusDotProps>;
  Kbd: ComponentType<ClassNameProps>;
  Progress: ComponentType<ProgressProps>;
  Skeleton: ComponentType<ClassNameProps>;
  Stat: ComponentType<StatProps>;
  Code: ComponentType<ClassNameProps>;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) {
    return undefined;
  }
  return Reflect.get(record, key) as unknown;
}

function asComponent<Props>(value: unknown, key: string): ComponentType<Props> {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') {
    throw new TypeError(`${key} must be a function`);
  }
  return value as ComponentType<Props>;
}

function loadBadge(): ComponentType<BadgeProps> {
  const record: unknown = badgeModule;
  if (typeof record !== 'object' || record === null) {
    throw new TypeError('badge module must be an object');
  }
  const value = readField(record, 'Badge');
  if (typeof value !== 'function') {
    throw new TypeError('Badge must be a function');
  }
  return value as ComponentType<BadgeProps>;
}

const Badge = loadBadge();

function displayLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(displayLoaders)) {
    if (key.endsWith(DISPLAY_SOURCE)) {
      return load;
    }
  }
  return undefined;
}

async function loadDisplay(): Promise<DisplayApi> {
  const load = displayLoader();
  expect(typeof load, DISPLAY_SOURCE).toBe('function');
  if (typeof load !== 'function') {
    throw new TypeError(`${DISPLAY_SOURCE} must exist`);
  }
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) {
    throw new TypeError('display module must be an object');
  }
  return {
    Spinner: asComponent<ClassNameProps>(readField(imported, 'Spinner'), 'Spinner'),
    StatusDot: asComponent<StatusDotProps>(readField(imported, 'StatusDot'), 'StatusDot'),
    Kbd: asComponent<ClassNameProps>(readField(imported, 'Kbd'), 'Kbd'),
    Progress: asComponent<ProgressProps>(readField(imported, 'Progress'), 'Progress'),
    Skeleton: asComponent<ClassNameProps>(readField(imported, 'Skeleton'), 'Skeleton'),
    Stat: asComponent<StatProps>(readField(imported, 'Stat'), 'Stat'),
    Code: asComponent<ClassNameProps>(readField(imported, 'Code'), 'Code'),
  };
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function renderedRoot(container: HTMLElement): HTMLElement {
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    throw new TypeError('expected a rendered element');
  }
  return root;
}

function expectBadge(element: HTMLElement, tone: string, variant: string): void {
  expect(element.tagName.toLowerCase()).toBe('span');
  expect(element).toHaveAttribute('data-slot', 'badge');
  expect(element).toHaveAttribute('data-tone', tone);
  expect(element).toHaveAttribute('data-variant', variant);
}

function roundedDots(container: ParentNode): HTMLElement[] {
  return [...container.querySelectorAll('span')].filter((element): element is HTMLElement => (
    element instanceof HTMLElement && classTokens(element).includes('rounded-full')
  ));
}

function inlineWidth(root: ParentNode): string | undefined {
  for (const element of root.querySelectorAll('*')) {
    if (element instanceof HTMLElement && element.style.width !== '') {
      return element.style.width;
    }
  }
  return undefined;
}

function elementWithExactText(root: ParentNode, text: string): HTMLElement {
  const found = [...root.querySelectorAll('*')].filter((element) => (element.textContent ?? '').trim() === text);
  const leaves = found.filter((element) => !found.some((other) => other !== element && element.contains(other)));
  expect(leaves, text).toHaveLength(1);
  const leaf = leaves[0];
  if (!(leaf instanceof HTMLElement)) {
    throw new TypeError(`expected ${text}`);
  }
  return leaf;
}

function displaySource(): string {
  const file = resolve(import.meta.dirname, `../../${DISPLAY_SOURCE}`);
  expect(existsSync(file), DISPLAY_SOURCE).toBe(true);
  if (!existsSync(file)) {
    throw new TypeError(`${DISPLAY_SOURCE} must exist`);
  }
  return readFileSync(file, 'utf8');
}

describe('badge', () => {
  it('renders an omitted variant as a neutral soft span', () => {
    const view = render(<Badge>x</Badge>);
    const badge = renderedRoot(view.container);

    expectBadge(badge, 'neutral', 'soft');
    expect(badge.textContent).toBe('x');
    expect(classTokens(badge)).toContain('bg-surface-active');
  });

  it('maps variant="destructive" to danger soft', () => {
    const view = render(<Badge variant="destructive">删除</Badge>);
    const badge = renderedRoot(view.container);

    expectBadge(badge, 'danger', 'soft');
    expect(classTokens(badge)).toContain('bg-danger-soft');
    expect(classTokens(badge)).toContain('text-danger-fg');
  });

  it('maps variant="default" to brand soft', () => {
    const view = render(<Badge variant="default">默认</Badge>);
    const badge = renderedRoot(view.container);

    expectBadge(badge, 'brand', 'soft');
  });

  it('maps variant="secondary" to neutral soft', () => {
    const view = render(<Badge variant="secondary">次要</Badge>);
    const badge = renderedRoot(view.container);

    expectBadge(badge, 'neutral', 'soft');
    expect(classTokens(badge)).toContain('bg-surface-active');
  });

  it('keeps an explicit tone on outline and lets a legacy variant override tone', () => {
    const outlined = render(
      <Badge
        tone="success"
        variant="outline"
      >
        分类
      </Badge>,
    );
    const outline = renderedRoot(outlined.container);

    expectBadge(outline, 'success', 'outline');
    expect(classTokens(outline)).toContain('border-success-line');
    outlined.unmount();

    const conflicted = render(
      <Badge
        tone="success"
        variant="destructive"
      >
        冲突
      </Badge>,
    );
    const conflict = renderedRoot(conflicted.container);

    expectBadge(conflict, 'danger', 'soft');
  });

  it('uses neutral when outline is passed without a tone', () => {
    const view = render(<Badge variant="outline">分类</Badge>);
    const badge = renderedRoot(view.container);

    expectBadge(badge, 'neutral', 'outline');
    expect(classTokens(badge)).toContain('border-line-strong');
  });

  it('paints a solid warning badge with on-warning text', () => {
    const view = render(
      <Badge
        tone="warning"
        variant="solid"
      >
        3
      </Badge>,
    );
    const badge = renderedRoot(view.container);

    expectBadge(badge, 'warning', 'solid');
    expect(classTokens(badge)).toContain('bg-warning');
    expect(classTokens(badge)).toContain('text-on-warning');
  });

  it('puts an info dot in the first child span', () => {
    const view = render(
      <Badge
        dot
        tone="info"
      >
        已封榜
      </Badge>,
    );
    const badge = renderedRoot(view.container);
    const dot = badge.firstElementChild;

    expectBadge(badge, 'info', 'soft');
    expect(dot?.tagName.toLowerCase()).toBe('span');
    if (!(dot instanceof HTMLElement)) {
      throw new TypeError('expected the badge dot');
    }
    expect(classTokens(dot)).toContain('bg-info');
    expect(classTokens(dot)).toContain('size-1.5');
  });

  it('uses the md height by default and the sm height when asked', () => {
    const medium = render(<Badge>中</Badge>);
    const mediumBadge = renderedRoot(medium.container);

    expect(classTokens(mediumBadge)).toContain('h-5.5');
    expect(classTokens(mediumBadge)).toContain('text-xs');
    medium.unmount();

    const small = render(
      <Badge size="sm">
        小
      </Badge>,
    );
    const smallBadge = renderedRoot(small.container);

    expect(classTokens(smallBadge)).toContain('h-4.5');
    expect(classTokens(smallBadge)).toContain('text-2xs');
  });

  it('keeps a caller layout class', () => {
    const view = render(<Badge className="ml-auto">x</Badge>);

    expect(classTokens(renderedRoot(view.container))).toContain('ml-auto');
  });

  it('renders no status dot unless dot is set', () => {
    const omitted = render(<Badge tone="info">已封榜</Badge>);

    expect(renderedRoot(omitted.container).querySelector('span')).toBeNull();
    omitted.unmount();

    const disabled = render(
      <Badge
        dot={false}
        tone="info"
      >
        已封榜
      </Badge>,
    );

    expect(renderedRoot(disabled.container).querySelector('span')).toBeNull();
  });

  it('paints a solid badge dot with currentColor', () => {
    const view = render(
      <Badge
        dot
        tone="danger"
        variant="solid"
      >
        2
      </Badge>,
    );
    const dot = renderedRoot(view.container).firstElementChild;

    expect(dot?.tagName.toLowerCase()).toBe('span');
    if (!(dot instanceof HTMLElement)) {
      throw new TypeError('expected the solid badge dot');
    }
    expect(classTokens(dot)).toContain('bg-current');
    expect(classTokens(dot)).not.toContain('bg-danger');
  });

  it('forwards native span props', () => {
    const view = render(
      <Badge
        id="badge-1"
        title="标签"
      >
        x
      </Badge>,
    );
    const badge = renderedRoot(view.container);

    expect(badge).toHaveAttribute('id', 'badge-1');
    expect(badge).toHaveAttribute('title', '标签');
  });

  it('gives an outline badge a border', () => {
    const view = render(
      <Badge
        tone="success"
        variant="outline"
      >
        分类
      </Badge>,
    );

    expect(classTokens(renderedRoot(view.container))).toContain('border');
  });
});

describe('display primitives', () => {
  it('clamps progress into the aria value and the inner width', async () => {
    const { Progress } = await loadDisplay();
    const over = render(<Progress value={140} />);
    const overBar = over.getByRole('progressbar');

    expect(overBar).toHaveAttribute('aria-valuenow', '100');
    expect(inlineWidth(overBar)).toBe('100%');
    over.unmount();

    const under = render(<Progress value={-5} />);
    const underBar = under.getByRole('progressbar');

    expect(underBar).toHaveAttribute('aria-valuenow', '0');
    expect(inlineWidth(underBar)).toBe('0%');
  });

  it('colors a negative stat delta as danger and a positive one as success', async () => {
    const { Stat } = await loadDisplay();
    const down = render(
      <Stat
        label="通过率"
        value="38.4"
        unit="%"
        delta={-3}
      />,
    );
    const negative = elementWithExactText(down.container, '3%');

    expect(classTokens(negative)).toContain('text-danger-fg');
    expect(classTokens(negative)).not.toContain('text-success-fg');
    down.unmount();

    const up = render(
      <Stat
        label="通过率"
        value="38.4"
        unit="%"
        delta={12}
      />,
    );
    const positive = elementWithExactText(up.container, '12%');

    expect(classTokens(positive)).toContain('text-success-fg');
    expect(classTokens(positive)).not.toContain('text-danger-fg');
  });

  it('adds the pulse halo only when pulse is set', async () => {
    const { StatusDot } = await loadDisplay();
    const pulsing = render(
      <StatusDot
        tone="success"
        pulse
      />,
    );
    const dots = roundedDots(pulsing.container);
    const halo = dots.find((dot) => classTokens(dot).includes(PULSE_CLASS));

    expect(dots).toHaveLength(2);
    expect(halo).toBeInstanceOf(HTMLElement);
    if (!(halo instanceof HTMLElement)) {
      throw new TypeError('expected the pulse halo');
    }
    expect(classTokens(halo)).toContain(PULSE_CLASS);
    pulsing.unmount();

    const still = render(<StatusDot tone="success" />);
    const quiet = roundedDots(still.container);

    expect(quiet).toHaveLength(1);
    expect(quiet.some((dot) => classTokens(dot).some((token) => token.includes('kr-pulse-dot')))).toBe(false);
  });

  it('renders Kbd as a kbd element', async () => {
    const { Kbd } = await loadDisplay();
    const view = render(<Kbd>K</Kbd>);
    const kbd = renderedRoot(view.container);

    expect(kbd.tagName.toLowerCase()).toBe('kbd');
    expect(kbd.textContent).toBe('K');
  });

  it('renders Spinner as an svg at the default size', async () => {
    const { Spinner } = await loadDisplay();
    const view = render(<Spinner />);
    const svg = view.container.querySelector('svg');

    expect(svg?.tagName.toLowerCase()).toBe('svg');
    if (!(svg instanceof Element)) {
      throw new TypeError('expected the spinner');
    }
    expect(classTokens(svg)).toContain('size-4');
  });

  it('renders Skeleton with the skeleton class and the caller size', async () => {
    const { Skeleton } = await loadDisplay();
    const view = render(<Skeleton className="h-3 w-2/5" />);
    const skeleton = renderedRoot(view.container);

    expect(classTokens(skeleton)).toContain('skeleton');
    expect(classTokens(skeleton)).toContain('h-3');
    expect(classTokens(skeleton)).toContain('w-2/5');
  });

  it('renders Code as code and exempts the relative size on the previous line', async () => {
    const { Code } = await loadDisplay();
    const view = render(<Code>pid</Code>);
    const code = renderedRoot(view.container);

    expect(code.tagName.toLowerCase()).toBe('code');
    expect(code.textContent).toBe('pid');
    expect(classTokens(code)).toContain('text-[.9em]');

    const lines = displaySource().split('\n');
    const sizeLines = lines.flatMap((line, index) => (line.includes('text-[.9em]') ? [index] : []));

    expect(sizeLines.length).toBeGreaterThan(0);
    for (const index of sizeLines) {
      expect(index).toBeGreaterThan(0);
      expect(lines[index - 1]).toContain(CODE_SIZE_ALLOW);
    }
  });

  it('keeps an in-range progress value', async () => {
    const { Progress } = await loadDisplay();
    const view = render(<Progress value={40} />);
    const bar = view.getByRole('progressbar');

    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(inlineWidth(bar)).toBe('40%');
  });

  it('uses the md track by default and the sm track when asked', async () => {
    const { Progress } = await loadDisplay();
    const medium = render(<Progress value={10} />);
    const mediumBar = medium.getByRole('progressbar');

    expect(classTokens(mediumBar)).toContain('h-1.5');
    expect(classTokens(mediumBar)).not.toContain('h-1');
    medium.unmount();

    const small = render(
      <Progress
        size="sm"
        value={10}
      />,
    );
    const smallBar = small.getByRole('progressbar');

    expect(classTokens(smallBar)).toContain('h-1');
    expect(classTokens(smallBar)).not.toContain('h-1.5');
  });

  it('fills progress with brand when tone is omitted', async () => {
    const { Progress } = await loadDisplay();
    const view = render(<Progress value={10} />);
    const fill = view.getByRole('progressbar').firstElementChild;

    if (!(fill instanceof HTMLElement)) {
      throw new TypeError('expected the progress fill');
    }
    expect(classTokens(fill)).toContain('bg-brand');
    expect(classTokens(fill)).not.toContain('bg-danger');
  });

  it('exposes progress bounds of 0 and 100', async () => {
    const { Progress } = await loadDisplay();
    const bar = render(<Progress value={10} />).getByRole('progressbar');

    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('treats a zero stat delta as non-negative', async () => {
    const { Stat } = await loadDisplay();
    const view = render(
      <Stat
        delta={0}
        label="通过率"
        value="1"
      />,
    );
    const delta = elementWithExactText(view.container, '0%');

    expect(classTokens(delta)).toContain('text-success-fg');
    expect(classTokens(delta)).not.toContain('text-danger-fg');
  });

  it('omits the delta when a stat has none', async () => {
    const { Stat } = await loadDisplay();
    const view = render(
      <Stat
        label="通过率"
        value="38.4"
      />,
    );

    expect(view.container.textContent ?? '').not.toContain('%');
  });

  it('renders a stat hint when one is given', async () => {
    const { Stat } = await loadDisplay();
    const view = render(
      <Stat
        hint="较上周"
        label="通过率"
        value="1"
      />,
    );

    expect(view.container.textContent ?? '').toContain('较上周');
  });

  it('uses a neutral status dot when tone is omitted', async () => {
    const { StatusDot } = await loadDisplay();
    const view = render(<StatusDot />);
    const dots = roundedDots(view.container);
    const dot = dots[0];

    expect(dots).toHaveLength(1);
    if (!(dot instanceof HTMLElement)) {
      throw new TypeError('expected the status dot');
    }
    expect(classTokens(dot)).toContain('bg-fg-subtle');
    expect(classTokens(dot)).not.toContain('bg-brand');
  });

  it('colors the pulse halo with the status tone', async () => {
    const { StatusDot } = await loadDisplay();
    const view = render(
      <StatusDot
        pulse
        tone="success"
      />,
    );
    const halo = roundedDots(view.container).find((dot) => classTokens(dot).includes(PULSE_CLASS));

    expect(halo).toBeInstanceOf(HTMLElement);
    if (!(halo instanceof HTMLElement)) {
      throw new TypeError('expected the pulse halo');
    }
    expect(classTokens(halo)).toContain('bg-success');
  });
});
