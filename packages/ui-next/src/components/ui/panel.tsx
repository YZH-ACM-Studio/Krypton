import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Bordered surface with an optional header row. Cards never nest;
 * inside a panel, group with `divide-y` or a sunken well instead.
 */
export function Panel({
  title,
  description,
  actions,
  children,
  footer,
  flush,
  className,
  as = 'section',
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Body has no padding — for tables and lists that run edge to edge. */
  flush?: boolean;
  className?: string;
  as?: 'section' | 'div';
}) {
  const Root = as;
  return (
    <Root data-slot="panel" className={cn('min-w-0 overflow-hidden rounded-lg border border-line bg-surface shadow-xs', className)}>
      {title || actions ? (
        <header className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-subtle px-4 py-2.5">
          <div className="min-w-0 flex-1">
            {title ? <h3 className="text-sm font-semibold text-fg">{title}</h3> : null}
            {description ? <p className="text-xs text-fg-subtle">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn(!flush && 'p-4')}>{children}</div>
      {footer ? <footer className="border-t border-line-subtle bg-surface-sunken/50 px-4 py-2.5">{footer}</footer> : null}
    </Root>
  );
}

export function DescriptionList({
  items,
  columns = 1,
}: {
  items: { term: ReactNode; detail: ReactNode }[];
  columns?: 1 | 2;
}) {
  return (
    <dl className={cn('grid gap-x-8 gap-y-3 text-sm', columns === 2 && 'sm:grid-cols-2')}>
      {items.map((item, index) => (
        <div key={index} className="grid grid-cols-[7rem_1fr] gap-3">
          <dt className="text-fg-subtle">{item.term}</dt>
          <dd className="min-w-0 text-fg tabular">{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}
