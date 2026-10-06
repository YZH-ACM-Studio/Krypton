import type { ReactNode } from 'react';
import { StatusDot } from '@/components/ui/display';
import { cn } from '@/lib/cn';

export type ActionBarTone = 'neutral' | 'warning' | 'success';

const STATUS_TONE_CLASS: Record<ActionBarTone, string> = {
  neutral: 'text-fg-subtle',
  warning: 'text-warning-fg',
  success: 'text-success-fg',
};

function slotPresent(node: ReactNode): boolean {
  return node != null && node !== false && node !== '';
}

export function ActionBar({
  status,
  statusTone = 'neutral',
  start,
  end,
  className,
}: {
  status?: ReactNode;
  statusTone?: ActionBarTone;
  start?: ReactNode;
  end?: ReactNode;
  className?: string;
}) {
  const toneClass = STATUS_TONE_CLASS[statusTone];
  return (
    <div
      data-slot="action-bar"
      data-tone={statusTone}
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      {slotPresent(status) ? (
        <p
          data-slot="action-bar-status"
          className={cn('inline-flex min-w-0 items-center gap-1.5 text-xs', toneClass)}
        >
          {statusTone === 'warning' || statusTone === 'success' ? <StatusDot tone={statusTone} /> : null}
          {status}
        </p>
      ) : null}
      {slotPresent(start) ? <div className="flex flex-wrap items-center gap-2">{start}</div> : null}
      <span aria-hidden="true" className="flex-1" />
      {slotPresent(end) ? <div className="flex flex-wrap items-center justify-end gap-2">{end}</div> : null}
    </div>
  );
}
