import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ComponentType, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(import.meta.dirname, '../..');

// A static import fails collection while action-bar.tsx is absent.
const actionBarLoaders = import.meta.glob('../../src/components/admin/action-bar.tsx');

const ACTION_BAR_SOURCE = 'src/components/admin/action-bar.tsx';
const ROOT_CLASS = ['flex', 'flex-wrap', 'items-center', 'gap-2'] as const;
const STATUS_CLASS = ['inline-flex', 'min-w-0', 'items-center', 'gap-1.5', 'text-xs'] as const;
const START_CLASS = ['flex', 'flex-wrap', 'items-center', 'gap-2'] as const;
const END_CLASS = ['flex', 'flex-wrap', 'items-center', 'justify-end', 'gap-2'] as const;

type ActionBarTone = 'neutral' | 'warning' | 'success';

interface ActionBarProps {
  status?: ReactNode;
  statusTone?: ActionBarTone;
  start?: ReactNode;
  end?: ReactNode;
  className?: string;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) {
    return undefined;
  }
  return Reflect.get(record, key) as unknown;
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function expectTokens(element: Element | undefined, tokens: readonly string[]): void {
  if (!(element instanceof Element)) {
    throw new TypeError('expected an element');
  }
  const present = classTokens(element);
  for (const token of tokens) {
    expect(present, token).toContain(token);
  }
}

function elementChildren(element: Element): HTMLElement[] {
  const children: HTMLElement[] = [];
  for (const child of element.children) {
    if (!(child instanceof HTMLElement)) {
      throw new TypeError('expected an HTML element child');
    }
    children.push(child);
  }
  return children;
}

function childAt(children: readonly HTMLElement[], index: number): HTMLElement {
  const child = children[index];
  if (!(child instanceof HTMLElement)) {
    throw new TypeError(`missing child ${index}`);
  }
  return child;
}

function barRoot(container: HTMLElement): HTMLElement {
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    throw new TypeError('expected an action bar root');
  }
  expect(root.tagName.toLowerCase()).toBe('div');
  expect(root).toHaveAttribute('data-slot', 'action-bar');
  expectTokens(root, ROOT_CLASS);
  return root;
}

function expectSpacer(element: HTMLElement | undefined): void {
  if (!(element instanceof HTMLElement)) {
    throw new TypeError('spacer missing');
  }
  expect(element.tagName.toLowerCase()).toBe('span');
  expect(element).toHaveAttribute('aria-hidden', 'true');
  expect(classTokens(element)).toContain('flex-1');
}

function roundedDots(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll('span')].filter((element): element is HTMLElement => (
    element instanceof HTMLElement && classTokens(element).includes('rounded-full')
  ));
}

function textNodeWith(root: Node, text: string): Text | undefined {
  for (const node of root.childNodes) {
    if (node instanceof Text && (node.textContent ?? '').includes(text)) {
      return node;
    }
    const nested = textNodeWith(node, text);
    if (nested instanceof Text) {
      return nested;
    }
  }
  return undefined;
}

function expectStatus(root: ParentNode, text: string, toneClass: string): HTMLElement {
  const status = root.querySelector('[data-slot="action-bar-status"]');
  if (!(status instanceof HTMLElement)) {
    throw new TypeError('action-bar status missing');
  }
  expect(status.tagName.toLowerCase()).toBe('p');
  expect(status.textContent ?? '').toContain(text);
  expectTokens(status, STATUS_CLASS);
  expect(classTokens(status)).toContain(toneClass);
  return status;
}

function expectDotBeforeText(status: HTMLElement, text: string, toneClass: string): void {
  const dots = roundedDots(status);
  expect(dots).toHaveLength(1);
  const dot = dots[0];
  if (!(dot instanceof HTMLElement)) {
    throw new TypeError('status dot missing');
  }
  expect(classTokens(dot)).toContain(toneClass);
  const node = textNodeWith(status, text);
  if (!(node instanceof Text)) {
    throw new TypeError(`missing text ${text}`);
  }
  const position = dot.compareDocumentPosition(node);
  expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
}

function actionBarLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(actionBarLoaders)) {
    if (key.endsWith(ACTION_BAR_SOURCE)) {
      return load;
    }
  }
  return undefined;
}

async function loadActionBar(): Promise<ComponentType<ActionBarProps>> {
  const load = actionBarLoader();
  expect(typeof load, ACTION_BAR_SOURCE).toBe('function');
  if (typeof load !== 'function') {
    throw new TypeError(`${ACTION_BAR_SOURCE} must exist`);
  }
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) {
    throw new TypeError('action bar module must be an object');
  }
  const value = readField(imported, 'ActionBar');
  expect(typeof value, 'ActionBar').toBe('function');
  if (typeof value !== 'function') {
    throw new TypeError('ActionBar must be a function');
  }
  return value as ComponentType<ActionBarProps>;
}

async function renderBar(props: ActionBarProps) {
  const ActionBar = await loadActionBar();
  return render(<ActionBar {...props} />);
}

describe('action bar', () => {
  it('shows warning status text, warning color, and a status dot', async () => {
    const view = await renderBar({ status: '有未保存修改', statusTone: 'warning' });
    const root = barRoot(view.container);

    expect(root).toHaveAttribute('data-tone', 'warning');
    const status = expectStatus(root, '有未保存修改', 'text-warning-fg');
    expectDotBeforeText(status, '有未保存修改', 'bg-warning');
  });

  it('places the spacer before the end container when only end is set', async () => {
    const view = await renderBar({ end: <button>保存</button> });
    const root = barRoot(view.container);
    const children = elementChildren(root);

    expect(root.querySelector('[data-slot="action-bar-status"]')).toBeNull();
    expect(children).toHaveLength(2);
    expectSpacer(childAt(children, 0));
    const end = childAt(children, 1);
    expect(end.tagName.toLowerCase()).toBe('div');
    expectTokens(end, END_CLASS);
    expect(end.contains(screen.getByRole('button', { name: '保存' }))).toBe(true);
  });

  it('renders the start button before the end button', async () => {
    const view = await renderBar({
      start: <button>启动</button>,
      end: <button>停止</button>,
    });
    const root = barRoot(view.container);
    const startButton = screen.getByRole('button', { name: '启动' });
    const endButton = screen.getByRole('button', { name: '停止' });
    const position = startButton.compareDocumentPosition(endButton);

    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const children = elementChildren(root);
    expect(children).toHaveLength(3);
    const start = childAt(children, 0);
    expect(start.tagName.toLowerCase()).toBe('div');
    expectTokens(start, START_CLASS);
    expect(classTokens(start)).not.toContain('justify-end');
    expect(start.contains(startButton)).toBe(true);
    expectSpacer(childAt(children, 1));
    const end = childAt(children, 2);
    expectTokens(end, END_CLASS);
    expect(end.contains(endButton)).toBe(true);
  });

  it('defaults an omitted tone to neutral subtle text without a dot', async () => {
    const view = await renderBar({ status: '尚未发布' });
    const root = barRoot(view.container);

    expect(root).toHaveAttribute('data-tone', 'neutral');
    const status = expectStatus(root, '尚未发布', 'text-fg-subtle');
    expect(roundedDots(status)).toHaveLength(0);
    const children = elementChildren(root);
    expect(children).toHaveLength(2);
    expect(childAt(children, 0)).toBe(status);
    expectSpacer(childAt(children, 1));
    expect(root.querySelector('div')).toBeNull();
  });

  it('passes design-gate with zero violations', () => {
    const file = resolve(packageRoot, ACTION_BAR_SOURCE);
    expect(existsSync(file), ACTION_BAR_SOURCE).toBe(true);
    const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', ACTION_BAR_SOURCE], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    if (typeof result.status !== 'number' || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') {
      throw new TypeError('design-gate did not return a status and string output');
    }
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it('still renders the root and spacer when every prop is empty', async () => {
    const view = await renderBar({});
    const root = barRoot(view.container);
    const children = elementChildren(root);

    expect(root).toHaveAttribute('data-tone', 'neutral');
    expect(root.querySelector('[data-slot="action-bar-status"]')).toBeNull();
    expect(root.querySelector('button')).toBeNull();
    expect(children).toHaveLength(1);
    expectSpacer(childAt(children, 0));
  });

  it('uses success color and a success dot ahead of the status text', async () => {
    const view = await renderBar({ status: '已保存', statusTone: 'success' });
    const root = barRoot(view.container);

    expect(root).toHaveAttribute('data-tone', 'success');
    const status = expectStatus(root, '已保存', 'text-success-fg');
    expectDotBeforeText(status, '已保存', 'bg-success');
  });

  it('omits the end container when end is empty', async () => {
    const view = await renderBar({ start: <button>启动</button> });
    const root = barRoot(view.container);
    const children = elementChildren(root);
    const start = childAt(children, 0);

    expect(root.querySelector('[data-slot="action-bar-status"]')).toBeNull();
    expect(children).toHaveLength(2);
    expect(start.tagName.toLowerCase()).toBe('div');
    expectTokens(start, START_CLASS);
    expect(start.contains(screen.getByRole('button', { name: '启动' }))).toBe(true);
    expectSpacer(childAt(children, 1));
    expect(classTokens(start)).not.toContain('justify-end');
  });

  it('orders status, then start, then the spacer, then end', async () => {
    const view = await renderBar({
      status: '有未保存修改',
      statusTone: 'warning',
      start: <button>预检</button>,
      end: <button>保存</button>,
    });
    const root = barRoot(view.container);
    const children = elementChildren(root);
    const status = expectStatus(root, '有未保存修改', 'text-warning-fg');

    expect(children).toHaveLength(4);
    expect(childAt(children, 0)).toBe(status);
    expect(childAt(children, 1).contains(screen.getByRole('button', { name: '预检' }))).toBe(true);
    expectSpacer(childAt(children, 2));
    expect(childAt(children, 3).contains(screen.getByRole('button', { name: '保存' }))).toBe(true);
    expectDotBeforeText(status, '有未保存修改', 'bg-warning');
  });

  it('keeps the root layout classes when a layout className is passed', async () => {
    const view = await renderBar({ className: 'w-full' });
    const root = barRoot(view.container);

    expect(classTokens(root)).toContain('w-full');
    expect(root).toHaveAttribute('data-tone', 'neutral');
  });
});
