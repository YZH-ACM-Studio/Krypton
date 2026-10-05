import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

export type Breakpoint = 'sm' | 'md' | 'lg' | 'xl';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** CSS width, e.g. '6rem'. Omit for flexible. */
  width?: string;
  /** Hidden in the table layout below this breakpoint. */
  hideBelow?: Breakpoint;
  sortable?: boolean;
  /** In stacked cards: 'title' is the heading, 'meta' a trailing chip, 'hidden' is omitted. */
  stackRole?: 'title' | 'meta' | 'row' | 'hidden';
}

const HIDE: Record<Breakpoint, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
};

const BREAKPOINT_RANK: Record<Breakpoint, number> = { sm: 0, md: 1, lg: 2, xl: 3 };

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

const interactive = 'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-(--dur-1) ease-(--ease-standard)';

function alignClass(align: 'left' | 'right' | 'center' | undefined): string {
  if (align === 'right') {
    return 'text-right';
  }
  if (align === 'center') {
    return 'text-center';
  }
  return 'text-left';
}

function asReactNode(value: unknown): ReactNode {
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => asReactNode(item));
  }
  if (isValidElement(value)) {
    return value;
  }
  throw new TypeError('DataTable card cell returned a node that is not renderable');
}

function nodeChildren(element: ReactElement): ReactNode {
  const props: unknown = element.props;
  if (typeof props !== 'object' || props === null || !('children' in props)) {
    return undefined;
  }
  return asReactNode(props.children);
}

function withKey(node: ReactNode, index: number): ReactNode {
  if (!isValidElement(node) || node.key != null) {
    return node;
  }
  return cloneElement(node, { key: index });
}

function isControl(type: ReactElement['type']): boolean {
  if (type === 'a' || type === 'button' || type === 'input' || type === 'select' || type === 'textarea' || type === 'label') {
    return true;
  }
  return type === Button || type === Checkbox;
}

/** The row link must stay in a column that is not `display: none`, or the whole row stops being clickable. */
function overlayColumnIndex<T>(columns: readonly Column<T>[]): number {
  const alwaysVisible = columns.findIndex((column) => column.hideBelow === undefined);
  if (alwaysVisible !== -1) {
    return alwaysVisible;
  }
  let best = 0;
  let bestRank = Number.POSITIVE_INFINITY;
  columns.forEach((column, index) => {
    const rank = column.hideBelow === undefined ? -1 : BREAKPOINT_RANK[column.hideBelow];
    if (rank < bestRank) {
      bestRank = rank;
      best = index;
    }
  });
  return best;
}

/** A card anchor is one link. Nested anchors, buttons, and Button/Checkbox components keep their text only. */
function unwrapCardControls(node: ReactNode): ReactNode {
  if (Array.isArray(node)) {
    return node.map((child, index) => withKey(unwrapCardControls(child), index));
  }
  if (!isValidElement(node)) {
    return node;
  }
  const children = unwrapCardControls(nodeChildren(node));
  if (isControl(node.type)) {
    return children;
  }
  return cloneElement(node, undefined, children);
}

/** Only checkboxes, buttons, and links float above the row overlay. Plain text stays underneath it. */
function raiseControls(node: ReactNode): ReactNode {
  if (Array.isArray(node)) {
    return node.map((child, index) => withKey(raiseControls(child), index));
  }
  if (!isValidElement(node)) {
    return node;
  }
  const children = raiseControls(nodeChildren(node));
  const next = cloneElement(node, undefined, children);
  if (!isControl(node.type)) {
    return next;
  }
  return <span className="relative z-10">{next}</span>;
}

/**
 * Lists of records stack into cards below `md`. Genuinely tabular data
 * (`mobile="scroll"`) keeps one horizontally scrolling table.
 * `rowHref` makes the row a link (middle-click still works) and wins over `onRowClick`.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowHref,
  sort,
  onSort,
  selected,
  onSelectedChange,
  mobile = 'stack',
  loading = false,
  empty,
  stickyHeader = false,
  rowProps,
}: {
  columns: Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowHref?: (row: T) => string;
  sort?: SortState;
  onSort?: (sort: SortState) => void;
  selected?: Set<string>;
  onSelectedChange?: (selected: Set<string>) => void;
  mobile?: 'stack' | 'scroll';
  loading?: boolean;
  empty?: ReactNode;
  stickyHeader?: boolean;
  rowProps?: (row: T) => Record<`data-${string}`, string>;
}) {
  const selectable = selected !== undefined && onSelectedChange !== undefined;
  const allOn = selectable && rows.length > 0 && rows.every((row) => selected.has(rowKey(row)));
  const someOn = selectable && !allOn && rows.some((row) => selected.has(rowKey(row)));
  const linked = rowHref !== undefined;
  const toggleAll = () => {
    if (!onSelectedChange) {
      return;
    }
    onSelectedChange(allOn ? new Set() : new Set(rows.map(rowKey)));
  };
  const toggle = (key: string) => {
    if (!onSelectedChange || !selected) {
      return;
    }
    const next = new Set(selected);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    onSelectedChange(next);
  };

  const linkColumn = overlayColumnIndex(columns);
  const table = (
    <div className={cn('overflow-x-auto', mobile === 'stack' && 'hidden md:block')}>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className={cn(stickyHeader && 'sticky top-0 z-20')}>
          <tr>
            {selectable ? (
              <th className={cn('w-10 border-b border-line bg-surface-sunken pl-4', stickyHeader && 'sticky top-0 z-20')}>
                <Checkbox checked={allOn} indeterminate={someOn} onCheckedChange={toggleAll} />
              </th>
            ) : null}
            {columns.map((column) => {
              const active = sort?.key === column.key;
              return (
                <th
                  key={column.key}
                  style={column.width ? { width: column.width } : undefined}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn(
                    'h-9 border-b border-line bg-surface-sunken px-4 text-xs font-medium whitespace-nowrap text-fg-subtle',
                    stickyHeader && 'sticky top-0 z-20',
                    alignClass(column.align),
                    column.hideBelow && HIDE[column.hideBelow],
                  )}
                >
                  {column.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort({ key: column.key, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
                      className={cn(
                        interactive,
                        'inline-flex items-center gap-1 rounded-sm hover:text-fg',
                        active && 'text-fg',
                        column.align === 'right' && 'flex-row-reverse',
                      )}
                    >
                      {column.header}
                      {active
                        ? sort.dir === 'asc'
                          ? <ArrowUp className="size-3" aria-hidden="true" />
                          : <ArrowDown className="size-3" aria-hidden="true" />
                        : <ChevronsUpDown className="size-3 opacity-50" aria-hidden="true" />}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 5 }, (_, index) => (
              <tr key={index}>
                {selectable ? <td className="h-(--row-h) border-b border-line-subtle pl-4" /> : null}
                {columns.map((column) => (
                  <td key={column.key} className={cn('h-(--row-h) border-b border-line-subtle px-4', column.hideBelow && HIDE[column.hideBelow])}>
                    <div className="skeleton h-3 rounded-sm" style={{ width: `${40 + ((index * 17 + column.key.length * 13) % 50)}%` }} />
                  </td>
                ))}
              </tr>
            ))
            : rows.map((row) => {
              const key = rowKey(row);
              const on = selected?.has(key) === true;
              const href = rowHref?.(row);
              return (
                <tr
                  key={key}
                  onClick={!linked && onRowClick ? () => onRowClick(row) : undefined}
                  data-selected={on ? 'true' : undefined}
                  // Safari through 26 ignores position:relative on table-row, so the
                  // overlay would share one containing block and later rows would cover
                  // earlier ones. translate and clip-path still make this row the box.
                  style={linked ? { transform: 'translate(0)', clipPath: 'inset(0)' } : undefined}
                  className={cn(
                    'group transition-colors duration-(--dur-1) ease-(--ease-standard)',
                    !linked && onRowClick && 'cursor-pointer',
                    linked && 'relative',
                    'hover:bg-surface-hover data-selected:bg-brand-soft/60',
                  )}
                  {...rowProps?.(row)}
                >
                  {selectable ? (
                    <td
                      className={cn('h-(--row-h) border-b border-line-subtle pl-4', linked && 'relative z-10')}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Checkbox checked={on} onCheckedChange={() => toggle(key)} />
                    </td>
                  ) : null}
                  {columns.map((column, index) => (
                    <td
                      key={column.key}
                      className={cn(
                        'h-(--row-h) border-b border-line-subtle px-4 text-fg group-last:border-b-0',
                        alignClass(column.align),
                        column.hideBelow && HIDE[column.hideBelow],
                      )}
                    >
                      {linked ? raiseControls(column.cell(row)) : column.cell(row)}
                      {linked && index === linkColumn ? (
                        <a href={href} className="absolute inset-0" tabIndex={-1} aria-hidden="true" />
                      ) : null}
                    </td>
                  ))}
                </tr>
              );
            })}
        </tbody>
      </table>
      {!loading && rows.length === 0 ? empty : null}
    </div>
  );

  if (mobile === 'scroll') {
    return (
      <div data-slot="data-table" data-mobile={mobile}>
        {table}
      </div>
    );
  }

  const title = columns.find((column) => column.stackRole === 'title') ?? columns[0];
  const meta = columns.find((column) => column.stackRole === 'meta');
  const rest = columns.filter((column) => column !== title && column !== meta && column.stackRole !== 'hidden');
  if (!loading && rows.length > 0 && !title) {
    throw new TypeError('DataTable stack layout needs at least one column');
  }

  return (
    <div data-slot="data-table" data-mobile={mobile}>
      {table}
      <ul className="divide-y divide-line-subtle md:hidden">
        {loading
          ? Array.from({ length: 5 }, (_, index) => (
            <li key={index} className="px-4 py-3">
              <div className="skeleton h-3 rounded-sm" style={{ width: `${46 + ((index * 11) % 40)}%` }} />
            </li>
          ))
          : !title
            ? null
            : rows.map((row) => {
            const key = rowKey(row);
            const href = rowHref?.(row);
            const cardClass = 'flex w-full flex-col gap-2 px-4 py-3 text-left active:bg-surface-hover';
            const plainCardClass = 'flex w-full flex-col gap-2 px-4 py-3 text-left';
            const rawBody = (
              <>
                <div className="flex w-full items-start justify-between gap-3">
                  <div className="min-w-0 font-medium text-fg">{title.cell(row)}</div>
                  {meta ? <div className="shrink-0">{meta.cell(row)}</div> : null}
                </div>
                {rest.length > 0 ? (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-subtle">
                    {rest.map((column) => (
                      <span key={column.key} className="inline-flex items-center gap-1.5">
                        <span>{column.header}</span>
                        <span className="text-fg-muted">{column.cell(row)}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </>
            );
            const body = linked ? unwrapCardControls(rawBody) : rawBody;
            if (linked && href !== undefined) {
              return (
                <li key={key}>
                  <a href={href} className={cardClass} {...rowProps?.(row)}>
                    {body}
                  </a>
                </li>
              );
            }
            if (onRowClick) {
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => onRowClick(row)}
                    className={cardClass}
                    {...rowProps?.(row)}
                  >
                    {body}
                  </button>
                </li>
              );
            }
            return (
              <li key={key}>
                <div className={plainCardClass} {...rowProps?.(row)}>
                  {body}
                </div>
              </li>
            );
          })}
        {!loading && rows.length === 0 ? <li>{empty}</li> : null}
      </ul>
    </div>
  );
}
