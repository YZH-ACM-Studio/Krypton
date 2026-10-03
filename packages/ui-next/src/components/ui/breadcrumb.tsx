import { Fragment, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

const interactive = 'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-(--dur-1) ease-(--ease-standard)';

export function Breadcrumb({ items }: { items: { label: ReactNode; href?: string }[] }) {
  return (
    // p-1.5 leaves room for the 2px focus ring plus 2px offset inside overflow-hidden.
    <nav
      aria-label="breadcrumb"
      className="flex min-w-0 items-center gap-1 overflow-hidden p-1.5 text-sm text-fg-subtle"
    >
      {items.map((item, index) => {
        const last = index === items.length - 1;
        return (
          <Fragment key={index}>
            {index > 0 ? <ChevronRight className="size-3.5 shrink-0 text-fg-disabled" /> : null}
            {last || !item.href ? (
              <span className={cn('min-w-0 truncate', last && 'text-fg-muted')} aria-current={last ? 'page' : undefined}>
                {item.label}
              </span>
            ) : (
              <a href={item.href} className={cn(interactive, 'min-w-0 truncate rounded-sm hover:text-fg')}>
                {item.label}
              </a>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
