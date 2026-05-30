/**
 * Table primitives.
 *
 * Visual decisions:
 *   - Header row gets a subtle `bg-muted/40` stripe to separate it from
 *     the body without needing an extra border.
 *   - First/last cell on each row gets `pl-5 / pr-5` so the table content
 *     never sits flush against the outer container's edge. Combined with
 *     `<CardContent className="p-0">` this gives 20px insets without
 *     introducing double padding.
 *   - Rows use full-width borders for the table-like separator look.
 *   - Body cells default to `py-2.5 px-3` — readable but not chunky.
 *
 * If you actually *want* an edge-to-edge table (e.g. inside a borderless
 * wrapper), pass `density="flush"` to drop the edge padding.
 */
import { type HTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { ScrollArea } from '@/components/ui/scroll-area';

export type TableDensity = 'comfortable' | 'compact' | 'flush';

interface TableProps extends HTMLAttributes<HTMLTableElement> {
  density?: TableDensity;
}

/**
 * Density is passed via a data attribute so descendant Head/Cell components
 * can adapt their padding without us threading props through every level.
 */
const Table = forwardRef<HTMLTableElement, TableProps>(
  ({ className, density = 'comfortable', ...props }, ref) => (
    <ScrollArea
      orientation="horizontal"
      className={cn(
        'krypton-table-shell relative w-full',
        // Tiny vertical breathing room so first/last row aren't flush against
        // a tight container; horizontal inset is handled per-cell below.
        density !== 'flush' && 'py-1',
      )}
    >
      <table
        ref={ref}
        data-table-density={density}
        className={cn(
          'krypton-table w-full caption-bottom text-sm',
          // Edge cell padding so content doesn't touch the outer container.
          density !== 'flush' && '[&_tr>*:first-child]:pl-5 [&_tr>*:last-child]:pr-5',
          className,
        )}
        {...props}
      />
    </ScrollArea>
  ),
);
Table.displayName = 'Table';

const TableHeader = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead
      ref={ref}
      className={cn(
        'bg-muted/40 [&_tr]:border-b [&_tr]:border-border/60',
        className,
      )}
      {...props}
    />
  ),
);
TableHeader.displayName = 'TableHeader';

const TableBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
  ),
);
TableBody.displayName = 'TableBody';

const TableFooter = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot
      ref={ref}
      className={cn(
        'border-t border-border/60 bg-muted/30 font-medium [&>tr]:last:border-b-0',
        className,
      )}
      {...props}
    />
  ),
);
TableFooter.displayName = 'TableFooter';

const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b border-border/60 transition-colors hover:bg-muted/30 data-[state=selected]:bg-muted',
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = 'TableRow';

const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        'h-10 px-3 text-left align-middle text-xs font-semibold uppercase tracking-wider text-muted-foreground',
        '[&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = 'TableHead';

const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        'px-3 py-2.5 align-middle',
        '[&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    />
  ),
);
TableCell.displayName = 'TableCell';

const TableCaption = forwardRef<HTMLTableCaptionElement, HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption
      ref={ref}
      className={cn('mt-3 text-xs text-muted-foreground', className)}
      {...props}
    />
  ),
);
TableCaption.displayName = 'TableCaption';

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
};
