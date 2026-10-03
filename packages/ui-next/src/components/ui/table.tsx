/**
 * Table primitives. Density is a data attribute plus context so body cells
 * can pick a row height without threading props through every row.
 * `flush` only drops the outer inset; row height stays comfortable.
 */
import {
  createContext,
  forwardRef,
  useContext,
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';
import { ScrollArea } from '@/components/ui/scroll-area';

export type TableDensity = 'comfortable' | 'compact' | 'flush';

const TableDensityContext = createContext<TableDensity>('comfortable');

interface TableProps extends HTMLAttributes<HTMLTableElement> {
  density?: TableDensity;
  /** Horizontal overflow only by default; pass `both` when the body must also scroll vertically. */
  orientation?: 'horizontal' | 'both';
}

const Table = forwardRef<HTMLTableElement, TableProps>(({ className, density = 'comfortable', orientation = 'horizontal', ...props }, ref) => (
  <TableDensityContext.Provider value={density}>
    <ScrollArea
      orientation={orientation}
      className={cn(
        'krypton-table-shell relative w-full',
        density !== 'flush' && 'py-1',
      )}
    >
      <table
        ref={ref}
        data-table-density={density}
        className={cn(
          'krypton-table w-full caption-bottom text-sm',
          density !== 'flush' && '[&_tr>*:first-child]:pl-5 [&_tr>*:last-child]:pr-5',
          className,
        )}
        {...props}
      />
    </ScrollArea>
  </TableDensityContext.Provider>
));
Table.displayName = 'Table';

const TableHeader = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn(className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

const TableBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

const TableFooter = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <tfoot ref={ref} className={cn('border-t border-line bg-surface-sunken font-medium [&>tr]:last:border-b-0', className)} {...props} />
));
TableFooter.displayName = 'TableFooter';

const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      'border-b border-line-subtle transition-colors duration-(--dur-1) ease-(--ease-standard) hover:bg-surface-hover data-[state=selected]:bg-brand-soft/60',
      className,
    )}
    {...props}
  />
));
TableRow.displayName = 'TableRow';

const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-9 border-b border-line bg-surface-sunken px-3 text-left align-middle text-xs font-medium text-fg-subtle',
      '[&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
      className,
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(({ className, ...props }, ref) => {
  const density = useContext(TableDensityContext);
  return (
    <td
      ref={ref}
      className={cn(
        'px-3 align-middle text-sm text-fg',
        density === 'compact' ? 'h-[32px]' : 'h-(--row-h)',
        '[&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    />
  );
});
TableCell.displayName = 'TableCell';

const TableCaption = forwardRef<HTMLTableCaptionElement, HTMLAttributes<HTMLTableCaptionElement>>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-3 text-xs text-fg-subtle', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };
