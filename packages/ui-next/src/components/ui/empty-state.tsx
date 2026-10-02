import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The only empty state. `icon` is a lucide glyph, never an illustration.
 * Copy says what is missing and what to do next, in that order.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-16', className)}>
      {icon ? (
        <div className="grid size-10 place-items-center rounded-lg border border-line bg-surface text-fg-subtle shadow-xs [&_svg]:size-5">{icon}</div>
      ) : null}
      <div className="max-w-sm">
        <div className="text-md font-medium text-fg">{title}</div>
        {description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
