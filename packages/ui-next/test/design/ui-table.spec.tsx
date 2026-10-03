// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ComponentType, type ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScrollArea } from '../../src/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../src/components/ui/table';
import { TableAction } from '../../src/components/ui/table-actions';

const packageRoot = resolve(import.meta.dirname, '../..');

interface Row {
  id: string;
  name: string;
}

interface Column {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string;
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
  sortable?: boolean;
  stackRole?: 'title' | 'meta' | 'row' | 'hidden';
}

interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

interface DataTableProps {
  columns: Column[];
  rows: Row[];
  rowKey: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  rowHref?: (row: Row) => string;
  sort?: SortState;
  onSort?: (sort: SortState) => void;
  selected?: Set<string>;
  onSelectedChange?: (selected: Set<string>) => void;
  mobile?: 'stack' | 'scroll';
  loading?: boolean;
  empty?: ReactNode;
  stickyHeader?: boolean;
  rowProps?: (row: Row) => Record<`data-${string}`, string>;
}

const ROWS: readonly Row[] = [
  { id: '1', name: '甲' },
  { id: '2', name: '乙' },
  { id: '3', name: '丙' },
];

function rowKey(row: Row): string {
  return row.id;
}

function textColumns(extra?: Partial<Pick<Column, 'hideBelow' | 'sortable' | 'cell'>>): Column[] {
  return [
    { key: 'id', header: '编号', cell: (row) => row.id },
    {
      key: 'name',
      header: '名称',
      cell: extra?.cell ?? ((row) => row.name),
      hideBelow: extra?.hideBelow,
      sortable: extra?.sortable,
    },
  ];
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function expectTokens(element: Element, tokens: readonly string[]): void {
  const actual = classTokens(element);
  for (const token of tokens) {
    expect(actual).toContain(token);
  }
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

async function loadDataTable(): Promise<ComponentType<DataTableProps>> {
  const relativePath = 'src/components/ui/data-table.tsx';
  if (!existsSync(resolve(packageRoot, relativePath))) {
    throw new TypeError('DataTable is not exported from src/components/ui/data-table.tsx');
  }
  const fileName = 'data-table';
  const loaded: unknown = await import(`../../src/components/ui/${fileName}.tsx`);
  if (typeof loaded !== 'object' || loaded === null) {
    throw new TypeError('DataTable module is not an object');
  }
  const component = readField(loaded, 'DataTable');
  if (!isComponent<DataTableProps>(component)) {
    throw new TypeError('DataTable is not a function');
  }
  return component;
}

function dataTableRoot(container: HTMLElement): HTMLElement {
  const roots = [...container.querySelectorAll('[data-slot="data-table"]')];
  expect(roots).toHaveLength(1);
  const root = roots[0];
  if (!(root instanceof HTMLElement)) {
    throw new TypeError('expected [data-slot="data-table"]');
  }
  return root;
}

function tableOf(root: ParentNode): HTMLTableElement {
  const table = root.querySelector('table');
  if (!(table instanceof HTMLTableElement)) {
    throw new TypeError('expected a table');
  }
  return table;
}

function bodyRows(root: ParentNode): HTMLTableRowElement[] {
  return [...root.querySelectorAll('tbody tr')].filter((row): row is HTMLTableRowElement => row instanceof HTMLTableRowElement);
}

function rowCells(row: HTMLTableRowElement): HTMLTableCellElement[] {
  return [...row.children].filter((cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement && cell.tagName === 'TD');
}

function headerCells(table: HTMLTableElement): HTMLTableCellElement[] {
  return [...table.querySelectorAll('thead th')].filter((cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement);
}

function tableFrame(root: ParentNode): HTMLElement {
  let current = tableOf(root).parentElement;
  while (current) {
    const tokens = classTokens(current);
    if (tokens.includes('hidden') && tokens.includes('md:block')) {
      return current;
    }
    current = current.parentElement;
  }
  throw new TypeError('expected the table container to include hidden and md:block');
}

function headerCheckbox(root: ParentNode): HTMLInputElement {
  const input = root.querySelector('thead input[type="checkbox"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new TypeError('expected the header checkbox');
  }
  return input;
}

function keyList(value: unknown): string[] {
  expect(value).toBeInstanceOf(Set);
  if (!(value instanceof Set)) {
    throw new TypeError('expected a Set of row keys');
  }
  const keys: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new TypeError('expected string row keys');
    }
    keys.push(item);
  }
  keys.sort();
  return keys;
}

function firstDataCell(row: HTMLTableRowElement): HTMLTableCellElement {
  const cell = rowCells(row).find((item) => item.querySelector('input[type="checkbox"]') === null);
  if (!cell) {
    throw new TypeError('expected the first data cell');
  }
  return cell;
}

function raisedHost(element: Element): HTMLElement | null {
  let current: Element | null = element;
  while (current) {
    const tokens = classTokens(current);
    if (current instanceof HTMLElement && tokens.includes('relative') && tokens.includes('z-10')) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function skeletonRowCount(root: ParentNode): number {
  return bodyRows(root).filter((row) => classTokens(row).includes('skeleton') || row.querySelector('.skeleton') !== null).length;
}

function hasSkeleton(element: Element): boolean {
  return classTokens(element).includes('skeleton') || element.querySelector('.skeleton') !== null;
}

/** jsdom does not apply `hidden`, so stack loading must put skeleton rows on the mobile list itself. */
function mobileSkeletonRows(root: ParentNode): HTMLElement[] {
  const list = [...root.querySelectorAll('ul')].find((candidate) => {
    if (!classTokens(candidate).includes('md:hidden')) {
      return false;
    }
    let current: Element | null = candidate;
    while (current) {
      const tokens = classTokens(current);
      if (tokens.includes('hidden') && tokens.includes('md:block')) {
        return false;
      }
      current = current.parentElement;
    }
    return true;
  });
  if (!(list instanceof HTMLElement)) {
    throw new TypeError('expected the mobile card list');
  }
  return [...list.children].filter((item): item is HTMLElement => item instanceof HTMLElement && item.tagName === 'LI' && hasSkeleton(item));
}

function hasCompactHeight(className: string): boolean {
  return className.includes('32px');
}

function plainTextValues(root: Element, overlay: Element): string[] {
  const values: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node.textContent ?? '').trim();
      const parent = node.parentElement;
      if (value.length === 0 || !parent) {
        return;
      }
      const interactive = parent.closest('button, a, input, label, select, textarea');
      if (!interactive || interactive === overlay) {
        values.push(value);
      }
      return;
    }
    for (const child of node.childNodes) {
      visit(child);
    }
  };
  visit(root);
  return values;
}

/** Plain text inside `relative z-10` sits above the row overlay and cannot be clicked. */
function textRaisedAboveOverlay(root: Element, overlay: Element): string[] {
  const blocked: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node.textContent ?? '').trim();
      const parent = node.parentElement;
      if (value.length === 0 || !parent) {
        return;
      }
      const interactive = parent.closest('button, a, input, label, select, textarea');
      if (interactive && interactive !== overlay) {
        return;
      }
      const host = raisedHost(parent);
      if (host && !host.contains(overlay)) {
        blocked.push(value);
      }
      return;
    }
    for (const child of node.childNodes) {
      visit(child);
    }
  };
  visit(root);
  return blocked;
}

describe('data table', () => {
  it('stacks into cards below md and keeps a two-column table for three rows', async () => {
    const DataTable = await loadDataTable();
    const view = render(
      <DataTable
        columns={textColumns({ hideBelow: 'lg' })}
        rows={[...ROWS]}
        rowKey={rowKey}
        mobile="stack"
      />,
    );
    const root = dataTableRoot(view.container);
    const table = tableOf(root);
    const frame = tableFrame(root);
    const list = root.querySelector('ul');

    expect(root).toHaveAttribute('data-mobile', 'stack');
    expect(bodyRows(table)).toHaveLength(3);
    expect(headerCells(table)).toHaveLength(2);
    for (const row of bodyRows(table)) {
      expect(rowCells(row)).toHaveLength(2);
    }
    expectTokens(frame, ['hidden', 'md:block']);
    if (!(list instanceof HTMLElement)) {
      throw new TypeError('expected a stacked list');
    }
    expectTokens(list, ['md:hidden']);
    expect(frame.contains(list)).toBe(false);
    const hiddenHeader = headerCells(table).find((cell) => (cell.textContent ?? '').includes('名称'));
    if (!hiddenHeader) {
      throw new TypeError('expected the lg column header');
    }
    expectTokens(hiddenHeader, ['hidden', 'lg:table-cell']);
  });

  it('defaults mobile to stack', async () => {
    const DataTable = await loadDataTable();
    const view = render(
      <DataTable
        columns={textColumns()}
        rows={[...ROWS]}
        rowKey={rowKey}
      />,
    );
    const root = dataTableRoot(view.container);

    expect(root).toHaveAttribute('data-mobile', 'stack');
    expect(root.querySelector('ul')).not.toBeNull();
    expect(root.querySelector('table')).not.toBeNull();
  });

  it('does not render a card list when mobile is scroll', async () => {
    const DataTable = await loadDataTable();
    const view = render(
      <DataTable
        columns={textColumns()}
        rows={[...ROWS]}
        rowKey={rowKey}
        mobile="scroll"
      />,
    );
    const root = dataTableRoot(view.container);
    const table = tableOf(root);

    expect(root).toHaveAttribute('data-mobile', 'scroll');
    expect(view.container.querySelector('ul')).toBeNull();
    expect(bodyRows(table)).toHaveLength(3);
    expect(headerCells(table)).toHaveLength(2);
  });

  it('sorts a column descending, then ascending, and sets aria-sort', async () => {
    const DataTable = await loadDataTable();
    const onSort = vi.fn();
    const view = render(
      <DataTable
        columns={textColumns({ sortable: true })}
        rows={[...ROWS]}
        rowKey={rowKey}
        mobile="scroll"
        onSort={onSort}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '名称' }));
    expect(onSort).toHaveBeenCalledWith({ key: 'name', dir: 'desc' });

    view.rerender(
      <DataTable
        columns={textColumns({ sortable: true })}
        rows={[...ROWS]}
        rowKey={rowKey}
        mobile="scroll"
        sort={{ key: 'name', dir: 'desc' }}
        onSort={onSort}
      />,
    );
    const header = screen.getByRole('columnheader', { name: '名称' });
    expect(header.tagName).toBe('TH');
    expect(header).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(screen.getByRole('button', { name: '名称' }));
    expect(onSort).toHaveBeenLastCalledWith({ key: 'name', dir: 'asc' });
  });

  it('selects every row from the header, clears that selection, and marks a partial header indeterminate', async () => {
    const DataTable = await loadDataTable();
    let received: unknown;
    const onSelectedChange = (selected: Set<string>) => {
      received = selected;
    };
    const shared = {
      columns: textColumns(),
      rows: [...ROWS],
      rowKey,
      mobile: 'scroll' as const,
      onSelectedChange,
    };
    const view = render(
      <DataTable
        {...shared}
        selected={new Set()}
      />,
    );

    fireEvent.click(headerCheckbox(view.container));
    expect(keyList(received)).toEqual(['1', '2', '3']);

    received = undefined;
    view.rerender(
      <DataTable
        {...shared}
        selected={new Set(['1', '2', '3'])}
      />,
    );
    fireEvent.click(headerCheckbox(view.container));
    expect(keyList(received)).toEqual([]);

    view.rerender(
      <DataTable
        {...shared}
        selected={new Set(['2'])}
      />,
    );
    expect(headerCheckbox(view.container).indeterminate).toBe(true);
  });

  it('renders five skeleton rows and no data while loading', async () => {
    const DataTable = await loadDataTable();
    const view = render(
      <DataTable
        columns={textColumns()}
        rows={[...ROWS]}
        rowKey={rowKey}
        mobile="stack"
        loading
      />,
    );

    const root = dataTableRoot(view.container);
    const frame = tableFrame(root);
    expect(skeletonRowCount(frame)).toBe(5);
    const mobileRows = mobileSkeletonRows(root);
    expect(mobileRows).toHaveLength(5);
    for (const row of mobileRows) {
      expect(frame.contains(row)).toBe(false);
    }
    expect(screen.queryByText('甲')).toBeNull();
    expect(screen.queryByText('乙')).toBeNull();
    expect(screen.queryByText('丙')).toBeNull();
  });

  it('renders the empty slot when there are no rows', async () => {
    const DataTable = await loadDataTable();
    render(
      <DataTable
        columns={textColumns()}
        rows={[]}
        rowKey={rowKey}
        empty={<p>空</p>}
      />,
    );

    expect(screen.getAllByText('空').length).toBeGreaterThan(0);
  });

  it('makes the row a link, keeps controls above the overlay, and ignores onRowClick', async () => {
    const DataTable = await loadDataTable();
    const onRowClick = vi.fn();
    const view = render(
      <DataTable
        columns={textColumns({
          cell: (row) => (
            <>
              <a href={`/x/${row.id}`}>外链</a>
              <button type="button">改</button>
            </>
          ),
        })}
        rows={[...ROWS]}
        rowKey={rowKey}
        mobile="stack"
        selected={new Set()}
        onSelectedChange={() => undefined}
        rowHref={(row) => `/p/${row.id}`}
        onRowClick={onRowClick}
      />,
    );
    const root = dataTableRoot(view.container);
    const row = bodyRows(root).find((item) => firstDataCell(item).textContent?.includes('1'));
    if (!row) {
      throw new TypeError('expected the first data row');
    }
    expectTokens(row, ['relative']);
    const cell = firstDataCell(row);
    const overlay = cell.querySelector('a[href="/p/1"]');
    if (!(overlay instanceof HTMLAnchorElement)) {
      throw new TypeError('expected the row overlay link');
    }
    expect(cell.lastElementChild).toBe(overlay);
    expect(overlay).toHaveAttribute('tabindex', '-1');
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
    expectTokens(overlay, ['absolute', 'inset-0']);
    expect(classTokens(overlay)).not.toContain('z-10');
    expect(plainTextValues(row, overlay)).toContain('1');
    expect(textRaisedAboveOverlay(row, overlay)).toEqual([]);

    const contentLink = mustAnchor(row.querySelector('a[href="/x/1"]'));
    const editButton = [...row.querySelectorAll('button')].find((button) => (button.textContent ?? '').trim() === '改');
    if (!(editButton instanceof HTMLButtonElement)) {
      throw new TypeError('expected the row edit button');
    }
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (!(checkbox instanceof HTMLInputElement)) {
      throw new TypeError('expected the row checkbox');
    }
    for (const control of [contentLink, editButton, checkbox]) {
      const host = raisedHost(control);
      if (!(host instanceof HTMLElement)) {
        throw new TypeError('expected a relative z-10 container');
      }
      expect(host.contains(overlay)).toBe(false);
    }

    const card = root.querySelector('ul > li > a[href="/p/1"]');
    if (!(card instanceof HTMLAnchorElement)) {
      throw new TypeError('expected the card to be an anchor');
    }
    expect(root.querySelector('ul button')).toBeNull();
    fireEvent.click(row);
    fireEvent.click(card);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('puts the row overlay only in the first data cell', async () => {
    const DataTable = await loadDataTable();
    const view = render(
      <DataTable
        columns={textColumns()}
        rows={[...ROWS]}
        rowKey={rowKey}
        mobile="scroll"
        rowHref={(row) => `/p/${row.id}`}
      />,
    );
    const row = bodyRows(view.container)[0];
    if (!row) {
      throw new TypeError('expected the first data row');
    }
    const cells = rowCells(row);
    expect(cells).toHaveLength(2);
    expect(cells[0]?.querySelector('a[href="/p/1"]')).not.toBeNull();
    expect(cells[1]?.querySelector('a[href="/p/1"]')).toBeNull();
  });

  it('keeps the header checkbox determinate when every row is selected', async () => {
    const DataTable = await loadDataTable();
    const view = render(
      <DataTable
        columns={textColumns()}
        rows={[...ROWS]}
        rowKey={rowKey}
        mobile="scroll"
        selected={new Set(['1', '2', '3'])}
        onSelectedChange={() => undefined}
      />,
    );
    const box = headerCheckbox(view.container);
    expect(box.checked).toBe(true);
    expect(box.indeterminate).toBe(false);
  });

  it('adds and removes one row key from the row checkbox', async () => {
    const DataTable = await loadDataTable();
    let received: unknown;
    const view = render(
      <DataTable
        columns={textColumns()}
        rows={[...ROWS]}
        rowKey={rowKey}
        mobile="scroll"
        selected={new Set(['2'])}
        onSelectedChange={(selected) => {
          received = selected;
        }}
      />,
    );
    const first = view.container.querySelector('tbody input[type="checkbox"]');
    if (!(first instanceof HTMLInputElement)) {
      throw new TypeError('expected a row checkbox');
    }
    fireEvent.click(first);
    expect(keyList(received)).toEqual(['1', '2']);

    received = undefined;
    view.rerender(
      <DataTable
        columns={textColumns()}
        rows={[...ROWS]}
        rowKey={rowKey}
        mobile="scroll"
        selected={new Set(['1', '2'])}
        onSelectedChange={(selected) => {
          received = selected;
        }}
      />,
    );
    const again = view.container.querySelector('tbody input[type="checkbox"]');
    if (!(again instanceof HTMLInputElement)) {
      throw new TypeError('expected a row checkbox');
    }
    fireEvent.click(again);
    expect(keyList(received)).toEqual(['2']);
  });

  it('calls onRowClick from the table row and the stacked card when there is no row link', async () => {
    const DataTable = await loadDataTable();
    const onRowClick = vi.fn();
    const view = render(
      <DataTable
        columns={textColumns()}
        rows={[...ROWS]}
        rowKey={rowKey}
        mobile="stack"
        onRowClick={onRowClick}
      />,
    );
    const row = bodyRows(view.container)[0];
    if (!row) {
      throw new TypeError('expected the first data row');
    }
    fireEvent.click(row);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);

    const card = view.container.querySelector('ul > li > button');
    if (!(card instanceof HTMLButtonElement)) {
      throw new TypeError('expected a card button');
    }
    fireEvent.click(card);
    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[0]);
  });

  it('copies rowProps onto each body row and the card root', async () => {
    const DataTable = await loadDataTable();
    const view = render(
      <DataTable
        columns={textColumns()}
        rows={[...ROWS]}
        rowKey={rowKey}
        mobile="stack"
        rowProps={() => ({ 'data-pid': 'P1' })}
      />,
    );
    const root = dataTableRoot(view.container);
    const taggedRows = [...root.querySelectorAll('tbody tr[data-pid="P1"]')];
    expect(taggedRows).toHaveLength(ROWS.length);
    const cards = [...root.querySelectorAll('ul > li > button, ul > li > a')];
    expect(cards).toHaveLength(ROWS.length);
    for (const card of cards) {
      expect(card).toHaveAttribute('data-pid', 'P1');
    }
  });
});

function mustAnchor(element: Element | null): HTMLAnchorElement {
  if (!(element instanceof HTMLAnchorElement)) {
    throw new TypeError('expected an anchor');
  }
  return element;
}

describe('table', () => {
  it('renders TableHead without uppercase and with the sunken header classes', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>状态</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    );
    const header = screen.getByRole('columnheader', { name: '状态' });

    expect(header.tagName).toBe('TH');
    expect(classTokens(header)).not.toContain('uppercase');
    expectTokens(header, ['h-9', 'bg-surface-sunken', 'text-xs', 'font-medium', 'text-fg-subtle', 'border-b', 'border-line']);
  });

  it('renders TableRow with the line and selected-surface classes', () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>已通过</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const row = screen.getByRole('row');

    expectTokens(row, ['border-b', 'border-line-subtle', 'hover:bg-surface-hover', 'data-[state=selected]:bg-brand-soft/60']);
  });

  it('sizes comfortable cells with the row token and compact cells at 32px', () => {
    const comfortable = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>舒适</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const comfortableCell = screen.getByRole('cell', { name: '舒适' });
    expect(comfortableCell.className).toContain('text-sm');
    expect(comfortableCell.className).toContain('text-fg');
    expect(comfortableCell.className).toContain('--row-h');
    comfortable.unmount();

    render(
      <Table density="compact">
        <TableBody>
          <TableRow>
            <TableCell>紧凑</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const compactCell = screen.getByRole('cell', { name: '紧凑' });
    expect(hasCompactHeight(compactCell.className)).toBe(true);
    expect(compactCell.className).not.toMatch(/(?:^|\s)h-8(?:\s|$)/);
  });

  it('keeps the outer inset unless density is flush, without shrinking flush rows', () => {
    const comfortable = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>舒适边距</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const shell = comfortable.container.querySelector('.krypton-table-shell');
    const table = comfortable.container.querySelector('table');
    if (!(shell instanceof HTMLElement) || !(table instanceof HTMLTableElement)) {
      throw new TypeError('expected the table shell');
    }
    expect(classTokens(shell)).toContain('py-1');
    expect(classTokens(table)).toContain('[&_tr>*:first-child]:pl-5');
    expect(classTokens(table)).toContain('[&_tr>*:last-child]:pr-5');
    comfortable.unmount();

    render(
      <Table density="flush">
        <TableBody>
          <TableRow>
            <TableCell>贴边</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const flushShell = document.querySelector('.krypton-table-shell');
    const flushTable = document.querySelector('table');
    if (!(flushShell instanceof HTMLElement) || !(flushTable instanceof HTMLTableElement)) {
      throw new TypeError('expected the flush table shell');
    }
    expect(classTokens(flushShell)).not.toContain('py-1');
    expect(classTokens(flushTable)).not.toContain('[&_tr>*:first-child]:pl-5');
    expect(classTokens(flushTable)).not.toContain('[&_tr>*:last-child]:pr-5');
    const cell = screen.getByRole('cell', { name: '贴边' });
    expect(cell.className).toContain('--row-h');
    expect(cell.className).not.toContain('32px');
  });
});

describe('scroll area', () => {
  it('keeps the inherited max height and the viewport layout switch', () => {
    const block = render(
      <ScrollArea
        viewportLayout="block"
        orientation="both"
      >
        <div>内容</div>
      </ScrollArea>,
    );
    const viewport = block.container.querySelector('[data-radix-scroll-area-viewport]');
    if (!(viewport instanceof HTMLElement)) {
      throw new TypeError('expected a scroll viewport');
    }
    expect(viewport.style.maxHeight).toBe('inherit');
    expect(classTokens(viewport)).toContain('[&>div]:!block');
    block.unmount();

    const flex = render(
      <ScrollArea viewportLayout="flex">
        <div>内容</div>
      </ScrollArea>,
    );
    const flexViewport = flex.container.querySelector('[data-radix-scroll-area-viewport]');
    if (!(flexViewport instanceof HTMLElement)) {
      throw new TypeError('expected a scroll viewport');
    }
    expect(classTokens(flexViewport)).toContain('[&>div]:!flex');
  });

  it('uses a 10px transparent track and the token thumb', () => {
    // jsdom never overflows, so Radix does not mount the thumb. The classes are the contract.
    const source = readFileSync(resolve(packageRoot, 'src/components/ui/scroll-area.tsx'), 'utf8');

    expect(source).toContain('bg-[var(--scroll-thumb)]');
    expect(source).toContain('hover:bg-[var(--scroll-thumb-hover)]');
    expect(source).toContain('rounded-full');
    expect(source).toContain('p-[3px]');
    expect(source).toContain('w-[10px]');
    expect(source).toContain('h-[10px]');
    expect(source).not.toContain('w-2.5');
    expect(source).not.toContain('h-2.5');
    expect(source.includes('bg-transparent') || source.includes('border-l-transparent')).toBe(true);
    expect(source).not.toContain('krypton-scrollbar');
    expect(source).not.toContain('bg-muted-foreground/30');
    expect(source).not.toContain('p-px');
  });

  it('sizes each scrollbar on its cross axis and keeps that track transparent', () => {
    const vertical = render(
      <ScrollArea type="always">
        <div>内容</div>
      </ScrollArea>,
    );
    const verticalBar = vertical.container.querySelector('[data-orientation="vertical"]');
    if (!(verticalBar instanceof HTMLElement)) {
      throw new TypeError('expected a vertical scrollbar');
    }
    expectTokens(verticalBar, ['h-full', 'w-[10px]', 'p-[3px]', 'bg-transparent']);
    expect(classTokens(verticalBar)).not.toContain('w-2.5');
    expect(classTokens(verticalBar)).not.toContain('h-2.5');
    vertical.unmount();

    const horizontal = render(
      <ScrollArea
        type="always"
        orientation="horizontal"
      >
        <div>内容</div>
      </ScrollArea>,
    );
    const horizontalBar = horizontal.container.querySelector('[data-orientation="horizontal"]');
    if (!(horizontalBar instanceof HTMLElement)) {
      throw new TypeError('expected a horizontal scrollbar');
    }
    expectTokens(horizontalBar, ['h-[10px]', 'w-full', 'flex-col', 'p-[3px]', 'bg-transparent']);
    expect(classTokens(horizontalBar)).not.toContain('h-2.5');
    expect(classTokens(horizontalBar)).not.toContain('w-2.5');
  });
});

describe('table action', () => {
  it('renders link and button actions as small ghost buttons', () => {
    const clicked = render(
      <TableAction onClick={() => undefined}>保存</TableAction>,
    );
    const button = screen.getByRole('button', { name: '保存' });
    expect(button).toHaveAttribute('data-slot', 'button');
    expect(button).toHaveAttribute('data-variant', 'ghost');
    expect(button).toHaveAttribute('data-size', 'sm');
    clicked.unmount();

    render(<TableAction href="/edit">编辑</TableAction>);
    const link = screen.getByRole('link', { name: '编辑' });
    expect(link).toHaveAttribute('href', '/edit');
    expect(link).toHaveAttribute('data-slot', 'button');
    expect(link).toHaveAttribute('data-variant', 'ghost');
    expect(link).toHaveAttribute('data-size', 'sm');
  });

  it('colors destructive and primary actions with the tone text', () => {
    const danger = render(
      <TableAction
        variant="destructive"
        onClick={() => undefined}
      >
        删除
      </TableAction>,
    );
    const dangerButton = screen.getByRole('button', { name: '删除' });
    expect(dangerButton).toHaveAttribute('data-variant', 'ghost');
    expect(dangerButton).toHaveAttribute('data-size', 'sm');
    expect(classTokens(dangerButton)).toContain('text-danger-fg');
    danger.unmount();

    render(
      <TableAction
        variant="primary"
        onClick={() => undefined}
      >
        发布
      </TableAction>,
    );
    const primary = screen.getByRole('button', { name: '发布' });
    expect(primary).toHaveAttribute('data-variant', 'ghost');
    expect(primary).toHaveAttribute('data-size', 'sm');
    expect(classTokens(primary)).toContain('text-brand-fg');
  });

  it('still opens the confirm dialog before submitting a confirmed action', async () => {
    const user = userEvent.setup();
    render(
      <TableAction
        formAction="/remove"
        confirm="确定删除？"
      >
        删除
      </TableAction>,
    );

    expect(screen.queryByText('确定删除？')).toBeNull();
    await user.click(screen.getByRole('button', { name: '删除' }));
    expect(screen.getByText('确定删除？')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
  });

  it('blocks the post until confirm, then submits the form with its hidden fields', async () => {
    const user = userEvent.setup();
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    let blocked = false;
    const onDocumentSubmit = (event: Event) => {
      blocked = event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener('submit', onDocumentSubmit);
    try {
      render(
        <TableAction
          formAction="/remove"
          confirm="确定删除？"
          hidden={{ op: 'delete' }}
        >
          删除
        </TableAction>,
      );
      const form = document.querySelector('form');
      if (!(form instanceof HTMLFormElement)) {
        throw new TypeError('expected a post form');
      }
      expect(form).toHaveAttribute('method', 'post');
      const hidden = form.querySelector('input[type="hidden"][name="op"]');
      if (!(hidden instanceof HTMLInputElement)) {
        throw new TypeError('expected the hidden field');
      }
      expect(hidden.value).toBe('delete');

      await user.click(screen.getByRole('button', { name: '删除' }));
      expect(screen.getByText('确定删除？')).toBeInTheDocument();
      expect(blocked).toBe(true);
      expect(submit).not.toHaveBeenCalled();

      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除' }));
      expect(submit).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('submit', onDocumentSubmit);
      submit.mockRestore();
    }
  });
});
