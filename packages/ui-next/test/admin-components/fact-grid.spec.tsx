import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { type ComponentType, type ReactNode } from 'react';
import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// A static import fails collection while fact-grid.tsx is absent.
const factGridLoaders = import.meta.glob('../../src/components/admin/fact-grid.tsx');

const FACT_GRID_SOURCE = 'src/components/admin/fact-grid.tsx';

const GRID_BASE = ['grid', 'gap-px', 'overflow-hidden', 'rounded-md', 'bg-line-subtle'] as const;
const COLUMN_CLASSES = {
  2: ['grid-cols-1', 'sm:grid-cols-2'],
  3: ['grid-cols-1', 'sm:grid-cols-2', 'lg:grid-cols-3'],
  4: ['grid-cols-1', 'sm:grid-cols-2', 'lg:grid-cols-4'],
} as const;
const FACT_CELL = ['min-w-0', 'bg-surface', 'px-3', 'py-2.5'] as const;
const FACT_TERM = ['text-xs', 'text-fg-subtle'] as const;
const FACT_DETAIL = ['mt-0.5', 'min-w-0', 'break-words', 'text-sm', 'font-medium', 'text-fg'] as const;
const DETAILS_CLASS = ['border-t', 'border-line-subtle', 'pt-3'] as const;
const SUMMARY_CLASS = [
  'cursor-pointer',
  'text-xs',
  'text-fg-subtle',
  'hover:text-fg',
  'rounded-sm',
  'focus-visible:outline-2',
  'focus-visible:outline-offset-2',
  'focus-visible:outline-ring',
] as const;
const TECH_LIST = [
  'mt-2',
  'grid',
  'grid-cols-[max-content_minmax(0,1fr)]',
  'gap-x-4',
  'gap-y-1',
  'text-xs',
] as const;
const TECH_DETAIL = ['min-w-0', 'break-all', 'font-mono', 'text-fg'] as const;

interface FactItem {
  label: string;
  value: ReactNode;
}

interface FactGridProps {
  facts: FactItem[];
  columns?: 2 | 3 | 4;
}

interface TechDetailsProps {
  items: FactItem[];
  summary?: string;
}

interface FactGridApi {
  FactGrid: ComponentType<FactGridProps>;
  TechDetails: ComponentType<TechDetailsProps>;
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function expectTokens(element: Element, expected: readonly string[]): void {
  const tokens = classTokens(element);
  for (const token of expected) {
    expect(tokens).toContain(token);
  }
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

function factGridLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(factGridLoaders)) {
    if (key.endsWith(FACT_GRID_SOURCE)) {
      return load;
    }
  }
  return undefined;
}

async function loadApi(): Promise<FactGridApi> {
  const load = factGridLoader();
  expect(typeof load, FACT_GRID_SOURCE).toBe('function');
  if (typeof load !== 'function') {
    throw new TypeError(`${FACT_GRID_SOURCE} must exist`);
  }
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) {
    throw new TypeError('fact-grid module must be an object');
  }
  return {
    FactGrid: asComponent<FactGridProps>(readField(imported, 'FactGrid'), 'FactGrid'),
    TechDetails: asComponent<TechDetailsProps>(readField(imported, 'TechDetails'), 'TechDetails'),
  };
}

function textFacts(labels: readonly string[]): FactItem[] {
  return labels.map((label) => ({ label, value: `${label}值` }));
}

function childElements(parent: HTMLElement): HTMLElement[] {
  return [...parent.children].filter((element): element is HTMLElement => element instanceof HTMLElement);
}

function isPad(element: HTMLElement): boolean {
  return element.getAttribute('aria-hidden') === 'true';
}

function renderedGrid(container: HTMLElement): HTMLElement {
  const grid = container.querySelector('[data-slot="fact-grid"]');
  expect(grid).not.toBeNull();
  if (!(grid instanceof HTMLElement)) {
    throw new TypeError('expected fact-grid');
  }
  expect(grid.tagName.toLowerCase()).toBe('dl');
  return grid;
}

function expectColumns(grid: HTMLElement, columns: 2 | 3 | 4): void {
  const tokens = classTokens(grid);
  expectTokens(grid, [...GRID_BASE, ...COLUMN_CLASSES[columns]]);
  const absent = columns === 2
    ? ['lg:grid-cols-3', 'lg:grid-cols-4']
    : columns === 3
      ? ['lg:grid-cols-4']
      : ['lg:grid-cols-3'];
  for (const token of absent) {
    expect(tokens).not.toContain(token);
  }
}

function expectFacts(grid: HTMLElement, facts: readonly FactItem[]): void {
  const cells = childElements(grid).filter((element) => !isPad(element));
  expect(cells).toHaveLength(facts.length);
  expect(grid.querySelectorAll('dt')).toHaveLength(facts.length);
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    const fact = facts[index];
    if (cell === undefined || fact === undefined) {
      throw new TypeError('expected a fact cell');
    }
    expect(cell.tagName.toLowerCase()).toBe('div');
    expectTokens(cell, FACT_CELL);
    const term = cell.querySelector('dt');
    const detail = cell.querySelector('dd');
    if (!(term instanceof HTMLElement) || !(detail instanceof HTMLElement)) {
      throw new TypeError('expected dt and dd');
    }
    expectTokens(term, FACT_TERM);
    expectTokens(detail, FACT_DETAIL);
    expect(term.textContent).toBe(fact.label);
    if (typeof fact.value === 'string') {
      expect(detail.textContent).toBe(fact.value);
    }
  }
}

function expectPads(grid: HTMLElement, count: number): void {
  const children = childElements(grid);
  const pads = children.filter(isPad);
  expect(pads).toHaveLength(count);
  expect(children.slice(0, children.length - count).some(isPad)).toBe(false);
  if (count > 0) {
    expect(children.slice(children.length - count).every(isPad)).toBe(true);
  }
  for (const pad of pads) {
    expect(pad.tagName.toLowerCase()).toBe('div');
    expect(classTokens(pad)).toContain('bg-surface');
    expect(pad.childElementCount).toBe(0);
    expect(pad.textContent).toBe('');
  }
}

function renderedDetails(container: HTMLElement): HTMLElement {
  const details = container.querySelector('[data-slot="tech-details"]');
  expect(details).not.toBeNull();
  if (!(details instanceof HTMLElement)) {
    throw new TypeError('expected tech-details');
  }
  expect(details.tagName.toLowerCase()).toBe('details');
  expect(details.hasAttribute('open')).toBe(false);
  expectTokens(details, DETAILS_CLASS);
  return details;
}

function expectTechItems(details: HTMLElement, items: readonly FactItem[], summaryText: string): void {
  const summary = details.querySelector('summary');
  if (!(summary instanceof HTMLElement)) {
    throw new TypeError('expected summary');
  }
  expect(summary.textContent).toBe(summaryText);
  expectTokens(summary, SUMMARY_CLASS);
  const lists = details.querySelectorAll('dl');
  expect(lists).toHaveLength(1);
  const list = lists[0];
  if (!(list instanceof HTMLElement)) {
    throw new TypeError('expected the tech list');
  }
  expectTokens(list, TECH_LIST);
  const terms = list.querySelectorAll('dt');
  const detailsValues = list.querySelectorAll('dd');
  expect(terms).toHaveLength(items.length);
  expect(detailsValues).toHaveLength(items.length);
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const term = terms[index];
    const detail = detailsValues[index];
    if (item === undefined || !(term instanceof HTMLElement) || !(detail instanceof HTMLElement)) {
      throw new TypeError('expected a tech row');
    }
    expect(classTokens(term)).toContain('text-fg-subtle');
    expectTokens(detail, TECH_DETAIL);
    expect(term.textContent).toBe(item.label);
    if (typeof item.value === 'string') {
      expect(detail.textContent).toBe(item.value);
    }
  }
}

describe('fact grid', () => {
  it('默认 3 列，5 项补 1 个空格子', async () => {
    const { FactGrid } = await loadApi();
    const facts = textFacts(['学校', '类型', '状态', '开始', '硬截止']);
    const view = render(<FactGrid facts={facts} />);
    const grid = renderedGrid(view.container);

    expectColumns(grid, 3);
    expect(classTokens(grid)).toContain('lg:grid-cols-3');
    expect(grid.querySelectorAll('dt')).toHaveLength(5);
    expectFacts(grid, facts);
    expectPads(grid, 1);
  });

  it('columns 为 4 且正好 4 项时不补格子', async () => {
    const { FactGrid } = await loadApi();
    const facts = textFacts(['派发', '策略', '硬截止', '请求']);
    const view = render(<FactGrid columns={4} facts={facts} />);
    const grid = renderedGrid(view.container);

    expectColumns(grid, 4);
    expect(classTokens(grid)).toContain('lg:grid-cols-4');
    expectFacts(grid, facts);
    expectPads(grid, 0);
    expect(grid.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
  });

  it('columns 为 2 时按两列补格子', async () => {
    const { FactGrid } = await loadApi();
    const facts = textFacts(['改前', '改后', '差异']);
    const view = render(<FactGrid columns={2} facts={facts} />);
    const grid = renderedGrid(view.container);

    expectColumns(grid, 2);
    expect(classTokens(grid)).toContain('sm:grid-cols-2');
    expectFacts(grid, facts);
    expectPads(grid, 1);
  });

  it('facts 为空时返回没有子节点的 dl', async () => {
    const { FactGrid } = await loadApi();
    const view = render(<FactGrid facts={[]} />);
    const grid = renderedGrid(view.container);

    expectColumns(grid, 3);
    expect(grid.childElementCount).toBe(0);
    expect(grid.querySelectorAll('dt')).toHaveLength(0);
    expect(grid.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
  });

  it('原样渲染 ReactNode 值', async () => {
    const { FactGrid } = await loadApi();
    const facts: FactItem[] = [{ label: '关联比赛', value: <a href="/x">链接</a> }];
    const view = render(<FactGrid facts={facts} />);
    const link = within(view.container).getByRole('link', { name: '链接' });

    expect(link).toHaveAttribute('href', '/x');
    expect(link.closest('dd')).not.toBeNull();
    expectFacts(renderedGrid(view.container), facts);
  });
});

describe('tech details', () => {
  it('items 为空时不渲染', async () => {
    const { TechDetails } = await loadApi();
    const { container } = render(<TechDetails items={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it('默认收起，摘要为技术细节，值为等宽', async () => {
    const { TechDetails } = await loadApi();
    const items: FactItem[] = [
      { label: '活动 ID', value: 'evt-1' },
      { label: '活动版本', value: '3' },
    ];
    const view = render(<TechDetails items={items} />);
    const details = renderedDetails(view.container);

    expectTechItems(details, items, '技术细节');
    expect(view.container.querySelectorAll('dd')).toHaveLength(2);
    for (const detail of view.container.querySelectorAll('dd')) {
      expect(classTokens(detail)).toContain('font-mono');
    }
  });

  it('使用传入的 summary', async () => {
    const { TechDetails } = await loadApi();
    const items: FactItem[] = [{ label: '名单', value: 'r1' }];
    const view = render(<TechDetails items={items} summary="修订" />);
    const details = renderedDetails(view.container);

    expectTechItems(details, items, '修订');
    expect(details.querySelector('summary')?.textContent).toBe('修订');
  });
});

function expectDesignGateClean(file: string): void {
  // helpers.ts loads design-gate.mjs through the jsdom transform, where import.meta.url is not a file URL.
  // This is the same gate: node scripts/design-gate.mjs --file <path>, exit 0.
  const packageRoot = resolve(import.meta.dirname, '../..');
  const script = resolve(packageRoot, 'scripts/design-gate.mjs');
  const result = spawnSync(process.execPath, [script, '--file', file], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  expect(result.status, output).toBe(0);
}

describe('fact-grid 门禁', () => {
  it('门禁零违规', () => {
    expectDesignGateClean(FACT_GRID_SOURCE);
  });
});
