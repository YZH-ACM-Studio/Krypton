import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { type ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// A static import fails collection while step-rail.tsx is absent.
const stepRailLoaders = import.meta.glob('../../src/components/admin/step-rail.tsx');

const STEP_RAIL_FILE = 'src/components/admin/step-rail.tsx';
const packageRoot = resolve(import.meta.dirname, '../..');
const RAIL_LABEL = '考试活动步骤';

type StepId = 'basics' | 'policy' | 'targets' | 'run';
type StepState = 'done' | 'attention' | 'active' | 'todo';

interface StepRailItem {
  id: StepId;
  label: string;
  summary: ReactNode;
  state: StepState;
}

interface StepRailProps {
  items: StepRailItem[];
  value: StepId;
  onValueChange: (id: StepId) => void;
  'aria-label': string;
}

const ITEMS: readonly StepRailItem[] = [
  { id: 'basics', label: '基本信息', summary: '已计划', state: 'done' },
  { id: 'policy', label: '网络策略', summary: 'v3 已生效', state: 'active' },
  { id: 'targets', label: '目标终端', summary: '草稿有改动', state: 'attention' },
  { id: 'run', label: '预检与执行', summary: '未启动', state: 'todo' },
];

const BUTTON_CLASS = [
  'focus-visible:outline-2',
  'focus-visible:outline-offset-2',
  'focus-visible:outline-ring',
  'rounded-md',
  'w-full',
  'text-left',
  'grid',
  'grid-cols-[1.5rem_minmax(0,1fr)]',
  'gap-2.5',
  'px-2.5',
  'py-2',
] as const;

const MARKER_CLASS: Record<StepState, readonly string[]> = {
  // `bg-success` is the solid fill (`--color-success` → `--success-solid`).
  // `bg-success-solid` is not a theme color and paints nothing.
  done: ['bg-success', 'text-on-success'],
  attention: ['border', 'border-warning-line', 'bg-warning-soft', 'text-warning-fg'],
  active: ['bg-brand', 'text-on-brand'],
  todo: ['border', 'border-line-strong', 'bg-surface', 'text-fg-muted'],
};

const LIST_CLASS = ['flex', 'flex-col', 'gap-0.5', 'p-1.5'] as const;

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key);
}

function stepRailLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(stepRailLoaders)) {
    if (key.endsWith(STEP_RAIL_FILE)) return load;
  }
  return undefined;
}

async function loadStepRail(): Promise<(props: StepRailProps) => ReactNode> {
  const load = stepRailLoader();
  expect(typeof load, STEP_RAIL_FILE).toBe('function');
  if (typeof load !== 'function') {
    throw new TypeError(`${STEP_RAIL_FILE} must exist`);
  }
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) {
    throw new TypeError('step-rail module must be an object');
  }
  const value = readField(imported, 'StepRail');
  expect(typeof value, 'StepRail').toBe('function');
  if (typeof value !== 'function') {
    throw new TypeError('StepRail must be a function');
  }
  return value as (props: StepRailProps) => ReactNode;
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function expectTokens(element: Element, tokens: readonly string[]): void {
  const actual = classTokens(element);
  for (const token of tokens) {
    expect(actual, token).toContain(token);
  }
}

function navigation(): HTMLElement {
  return screen.getByRole('navigation', { name: RAIL_LABEL });
}

function stepList(nav: HTMLElement): HTMLOListElement {
  const list = nav.querySelector(':scope > ol');
  if (!(list instanceof HTMLOListElement)) {
    throw new TypeError('expected an ordered list in the step rail');
  }
  expectTokens(list, LIST_CLASS);
  return list;
}

function stepItems(nav: HTMLElement): HTMLLIElement[] {
  return [...stepList(nav).children].map((child) => {
    if (!(child instanceof HTMLLIElement)) {
      throw new TypeError('expected each step to be an li');
    }
    return child;
  });
}

function buttonNamed(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

function referenced(button: HTMLElement, attribute: 'aria-labelledby' | 'aria-describedby'): HTMLElement {
  const raw = button.getAttribute(attribute);
  expect(typeof raw, attribute).toBe('string');
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new TypeError(`expected ${attribute}`);
  }
  const id = raw.split(/\s+/)[0] ?? '';
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new TypeError(`expected ${attribute} target`);
  }
  expect(element.tagName.toLowerCase()).toBe('span');
  return element;
}

function marker(button: HTMLElement): HTMLElement {
  const found = [...button.querySelectorAll('[aria-hidden="true"]')].filter((element) => {
    const tokens = classTokens(element);
    return tokens.includes('size-6') && tokens.includes('rounded-full');
  });
  expect(found).toHaveLength(1);
  const element = found[0];
  if (!(element instanceof HTMLElement)) {
    throw new TypeError('expected a step marker');
  }
  return element;
}

function connectors(item: HTMLElement): HTMLElement[] {
  return [...item.querySelectorAll('[aria-hidden="true"]')].filter((element): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) return false;
    const tokens = classTokens(element);
    return tokens.includes('h-2') && tokens.includes('border-l') && tokens.includes('border-line');
  });
}

const SPACING_REM: Readonly<Record<string, number>> = {
  0: 0,
  px: 1 / 16,
  0.5: 0.125,
  1: 0.25,
  1.5: 0.375,
  2: 0.5,
  2.5: 0.625,
  3: 0.75,
  3.5: 0.875,
  4: 1,
  5: 1.25,
  6: 1.5,
  8: 2,
  10: 2.5,
  12: 3,
};

function parseLength(raw: string): number | undefined {
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).replaceAll('_', '');
    if (inner.endsWith('rem')) {
      const value = Number(inner.slice(0, -3));
      return Number.isFinite(value) ? value : undefined;
    }
    if (inner.endsWith('px')) {
      const value = Number(inner.slice(0, -2));
      return Number.isFinite(value) ? value / 16 : undefined;
    }
    return undefined;
  }
  return SPACING_REM[raw];
}

function namedLength(tokens: readonly string[], name: string): number | undefined {
  for (const token of tokens) {
    if (!token.startsWith(`-${name}-`)) continue;
    const value = parseLength(token.slice(name.length + 2));
    if (value === undefined) {
      throw new TypeError(`unsupported length ${token}`);
    }
    return -value;
  }
  for (const token of tokens) {
    if (!token.startsWith(`${name}-`)) continue;
    const raw = token.slice(name.length + 1);
    if (raw === 'full') return undefined;
    const value = parseLength(raw);
    if (value === undefined) {
      throw new TypeError(`unsupported length ${token}`);
    }
    return value;
  }
  return undefined;
}

function paddingTopRem(element: Element): number {
  const tokens = classTokens(element);
  return namedLength(tokens, 'pt') ?? namedLength(tokens, 'py') ?? namedLength(tokens, 'p') ?? 0;
}

function marginTopRem(element: Element): number {
  const tokens = classTokens(element);
  return namedLength(tokens, 'mt') ?? namedLength(tokens, 'my') ?? namedLength(tokens, 'm') ?? 0;
}

function borderTopRem(element: Element): number {
  const tokens = classTokens(element);
  if (tokens.includes('border-t-0') || tokens.includes('border-y-0') || tokens.includes('border-0')) return 0;
  if (tokens.includes('border-t') || tokens.includes('border-y') || tokens.includes('border')) return 1 / 16;
  return 0;
}

function positionOf(element: Element): 'absolute' | 'relative' | 'fixed' | 'sticky' | 'static' {
  const tokens = classTokens(element);
  if (tokens.includes('absolute')) return 'absolute';
  if (tokens.includes('relative')) return 'relative';
  if (tokens.includes('fixed')) return 'fixed';
  if (tokens.includes('sticky')) return 'sticky';
  return 'static';
}

function listGapRem(list: Element): number {
  const tokens = classTokens(list);
  const token = tokens.find((item) => item.startsWith('gap-y-'))
    ?? tokens.find((item) => item.startsWith('gap-') && !item.startsWith('gap-x-'));
  if (token === undefined) {
    throw new TypeError('step list must declare a column gap');
  }
  const raw = token.startsWith('gap-y-') ? token.slice('gap-y-'.length) : token.slice('gap-'.length);
  const gap = parseLength(raw);
  if (gap === undefined || gap <= 0) {
    throw new TypeError(`unsupported list gap ${token}`);
  }
  return gap;
}

function translateYRem(tokens: readonly string[]): number {
  const token = tokens.find((item) => item.startsWith('translate-y-') || item.startsWith('-translate-y-'));
  if (token === undefined) return 0;
  const negative = token.startsWith('-');
  const raw = token.slice(token.indexOf('translate-y-') + 'translate-y-'.length);
  const value = parseLength(raw);
  if (value === undefined) {
    throw new TypeError(`unsupported translate ${token}`);
  }
  return negative ? -value : value;
}

/** jsdom does not lay out. Derive the line's reach from the classes that place it. */
function connectorReach(line: HTMLElement, item: HTMLElement): { top: number; bottom: number } {
  if (positionOf(line) !== 'absolute') {
    throw new TypeError('connector must be absolute so it can leave the step padding');
  }
  let anchor: HTMLElement | null = line.parentElement;
  while (anchor !== null && anchor !== item.parentElement) {
    const position = positionOf(anchor);
    if (position === 'relative' || position === 'absolute' || position === 'fixed' || position === 'sticky') break;
    anchor = anchor.parentElement;
  }
  if (!(anchor instanceof HTMLElement) || anchor === item.parentElement) {
    throw new TypeError('connector has no positioned anchor inside the step item');
  }
  const tokens = classTokens(line);
  const height = namedLength(tokens, 'h');
  if (height === undefined || height <= 0) {
    throw new TypeError('connector height must be a positive length');
  }
  const shift = translateYRem(tokens);
  const origin = paddingEdgeTop(anchor, item);
  if (tokens.includes('bottom-full')) {
    return { top: origin - height + shift, bottom: origin + shift };
  }
  const top = namedLength(tokens, 'top');
  if (top === undefined) {
    throw new TypeError('connector must set top or bottom-full');
  }
  return { top: origin + top + shift, bottom: origin + top + height + shift };
}

function paddingEdgeTop(element: HTMLElement, item: HTMLElement): number {
  return borderTopOf(element, item) + borderTopRem(element);
}

function borderTopOf(element: HTMLElement, item: HTMLElement): number {
  if (element === item) return 0;
  const parent = element.parentElement;
  if (!(parent instanceof HTMLElement) || element.parentElement === item.parentElement) {
    throw new TypeError('connector anchor is outside the step item');
  }
  if (positionOf(element) === 'absolute' || positionOf(element) === 'fixed') {
    throw new TypeError('nested absolute connector anchor is not supported');
  }
  return borderTopOf(parent, item) + borderTopRem(parent) + paddingTopRem(parent) + marginTopRem(element);
}

function expectRelativeContext(line: Element, item: Element): void {
  let current: Element | null = line;
  while (current !== null) {
    if (classTokens(current).includes('relative')) return;
    if (current === item) break;
    current = current.parentElement;
  }
  expect(classTokens(item), 'relative').toContain('relative');
}

// Vitest rewrites design-gate.mjs so import.meta.url is not a file URL.
// Run expectGateClean in a plain Node process, where that URL stays intact.
function runExpectGateClean(files: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const script = [
    "import { expectGateClean } from './test/design/helpers.ts';",
    'const files = JSON.parse(process.env.STEP_RAIL_GATE_FILES ?? "[]");',
    'if (!Array.isArray(files) || files.some((file) => typeof file !== "string")) {',
    '  throw new TypeError("gate files must be a string array");',
    '}',
    'expectGateClean(files);',
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '--eval', script],
    {
      cwd: packageRoot,
      encoding: 'utf8',
      env: { ...process.env, STEP_RAIL_GATE_FILES: JSON.stringify(files) },
    },
  );
  if (result.error) {
    throw new TypeError(`expectGateClean failed to start: ${result.error.message}`);
  }
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function renderRail(overrides: Partial<Omit<StepRailProps, 'onValueChange'>> = {}): Promise<ReturnType<typeof vi.fn>> {
  const StepRail = await loadStepRail();
  const onValueChange = vi.fn();
  render(
    <StepRail
      aria-label={overrides['aria-label'] ?? RAIL_LABEL}
      items={overrides.items ?? [...ITEMS]}
      value={overrides.value ?? 'policy'}
      onValueChange={onValueChange}
    />,
  );
  return onValueChange;
}

describe('step rail', () => {
  it('names the navigation and marks only the selected step as current', async () => {
    await renderRail();
    const nav = navigation();
    expect(nav.tagName.toLowerCase()).toBe('nav');
    expect(nav).toHaveAttribute('data-slot', 'step-rail');
    expect(nav).toHaveAttribute('aria-label', RAIL_LABEL);

    const items = stepItems(nav);
    expect(items).toHaveLength(4);
    for (const item of items) {
      const buttons = within(item).getAllByRole('button');
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toHaveAttribute('type', 'button');
    }

    expect(buttonNamed('网络策略')).toHaveAttribute('aria-current', 'step');
    for (const name of ['基本信息', '目标终端', '预检与执行']) {
      expect(buttonNamed(name)).not.toHaveAttribute('aria-current');
    }
  });

  it('exposes only the label as the accessible name and describes the summary', async () => {
    await renderRail();
    const button = buttonNamed('基本信息');
    expect(button).toHaveAccessibleName('基本信息');

    const label = referenced(button, 'aria-labelledby');
    const summary = referenced(button, 'aria-describedby');
    expect(label.textContent).toBe('基本信息');
    expect(summary.textContent ?? '').toContain('已计划');
    expect(label.id).toContain('basics');
    expect(summary.id).toContain('basics');
    expect(label.id).not.toBe(summary.id);

    const StepRail = await loadStepRail();
    const second = render(
      <StepRail
        aria-label={RAIL_LABEL}
        items={[...ITEMS]}
        value="policy"
        onValueChange={vi.fn()}
      />,
    );
    const firstLabelId = label.id;
    const secondButton = within(second.container).getByRole('button', { name: '基本信息' });
    const secondLabelId = referenced(secondButton, 'aria-labelledby').id;
    expect(secondLabelId).toContain('basics');
    expect(secondLabelId).not.toBe(firstLabelId);
  });

  it('calls onValueChange with the clicked step id, including the current step', async () => {
    const user = userEvent.setup();
    const onValueChange = await renderRail();

    await user.click(buttonNamed('目标终端'));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('targets');

    await user.click(buttonNamed('网络策略'));
    expect(onValueChange).toHaveBeenCalledTimes(2);
    expect(onValueChange).toHaveBeenLastCalledWith('policy');
  });

  it('renders a check for done and a warning summary for attention', async () => {
    await renderRail();
    const done = buttonNamed('基本信息');
    expect(done).toHaveAttribute('data-state', 'done');
    const doneMarker = marker(done);
    expect(classTokens(doneMarker)).toContain('bg-success');
    const icon = doneMarker.querySelector('svg');
    expect(icon).not.toBeNull();
    if (icon === null) {
      throw new TypeError('expected a check icon');
    }
    expect(icon.tagName.toLowerCase()).toBe('svg');

    const attention = buttonNamed('目标终端');
    expect(attention).toHaveAttribute('data-state', 'attention');
    const summary = referenced(attention, 'aria-describedby');
    expect(summary.getAttribute('class') ?? '').toContain('text-warning-fg');
  });

  it('paints marker, label, summary, and button classes for every state', async () => {
    await renderRail();

    for (const [index, item] of ITEMS.entries()) {
      const button = buttonNamed(item.label);
      expect(button).toHaveAttribute('data-state', item.state);
      expectTokens(button, BUTTON_CLASS);
      if (item.id === 'policy') {
        expect(classTokens(button)).toContain('bg-brand-soft');
      } else {
        expect(classTokens(button)).not.toContain('bg-brand-soft');
        expect(classTokens(button)).toContain('hover:bg-surface-hover');
      }

      const stepMarker = marker(button);
      expect(stepMarker).toHaveAttribute('aria-hidden', 'true');
      expectTokens(stepMarker, ['size-6', 'rounded-full', ...MARKER_CLASS[item.state]]);
      if (item.state === 'done') {
        const icon = stepMarker.querySelector('svg');
        expect(icon).not.toBeNull();
        if (icon === null) {
          throw new TypeError('expected a check icon');
        }
        expect(icon.tagName.toLowerCase()).toBe('svg');
        expect(classTokens(icon)).toContain('size-3.5');
        expect(stepMarker.textContent?.trim() ?? '').toBe('');
      } else {
        expect(stepMarker.textContent?.trim()).toBe(String(index + 1));
        expect(stepMarker.querySelector('svg')).toBeNull();
      }

      const label = referenced(button, 'aria-labelledby');
      const summary = referenced(button, 'aria-describedby');
      expect(label.textContent).toBe(item.label);
      expectTokens(label, ['text-sm', 'font-medium', 'text-fg']);
      expectTokens(summary, ['text-xs', 'block', 'min-w-0', 'truncate']);
      if (item.state === 'attention') {
        expect(classTokens(summary)).toContain('text-warning-fg');
        expect(classTokens(summary)).not.toContain('text-fg-subtle');
      } else {
        expect(classTokens(summary)).toContain('text-fg-subtle');
        expect(classTokens(summary)).not.toContain('text-warning-fg');
      }
    }
  });

  it('draws a non-interactive connector on every step except the first', async () => {
    await renderRail();
    const nav = navigation();
    const gap = listGapRem(stepList(nav));
    const items = stepItems(nav);
    const first = items[0];
    if (first === undefined) {
      throw new TypeError('expected the first step');
    }
    expect(connectors(first)).toHaveLength(0);

    for (const item of items.slice(1)) {
      const lines = connectors(item);
      expect(lines).toHaveLength(1);
      const line = lines[0];
      if (line === undefined) {
        throw new TypeError('expected a step connector');
      }
      expect(line).toHaveAttribute('aria-hidden', 'true');
      expect(line.tagName.toLowerCase()).not.toBe('button');
      expect(line.getAttribute('tabindex')).toBeNull();
      expect(marker(within(item).getByRole('button')).contains(line)).toBe(false);
      expectRelativeContext(line, item);
      const reach = connectorReach(line, item);
      expect(reach.top, 'connector must cover the gap above this step').toBeLessThanOrEqual(-gap);
      expect(reach.bottom, 'connector must still meet this step').toBeGreaterThanOrEqual(0);
    }
  });

  it('renders an empty navigation without buttons', async () => {
    await renderRail({ items: [] });
    const nav = navigation();
    expect(nav).toHaveAttribute('data-slot', 'step-rail');
    expect(nav.querySelector('button')).toBeNull();
    expect(nav.querySelector('li')).toBeNull();
  });

  it('passes design-gate for step-rail.tsx', () => {
    const result = runExpectGateClean([STEP_RAIL_FILE]);
    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
  });
});
