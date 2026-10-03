import type * as React from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { BadgeTone } from './badge';

export function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden className={cn('size-4 animate-[kr-spin_.7s_linear_infinite]', className)} {...props}>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity=".22" strokeWidth="1.5" />
      <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const dotTone: Record<BadgeTone, string> = {
  neutral: 'bg-fg-subtle',
  brand: 'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  violet: 'bg-violet',
  orange: 'bg-orange',
};

export function StatusDot({ tone = 'neutral', pulse, className }: { tone?: BadgeTone; pulse?: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)}>
      {pulse ? <span className={cn('absolute inset-0 rounded-full opacity-60 animate-[kr-pulse-dot_1.6s_ease-in-out_infinite]', dotTone[tone])} /> : null}
      <span className={cn('relative size-2 rounded-full', dotTone[tone])} />
    </span>
  );
}

export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line border-b-2 bg-surface px-1 font-sans text-2xs font-medium text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}

const progressFill = {
  brand: 'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
} as const;

export function Progress({
  value, tone = 'brand', size = 'md', className,
}: {
  value: number;
  tone?: 'brand' | 'success' | 'warning' | 'danger';
  size?: 'sm' | 'md';
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('w-full overflow-hidden rounded-full bg-surface-active', size === 'sm' ? 'h-1' : 'h-1.5', className)}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-(--dur-4) ease-(--ease-out)', progressFill[tone])} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton rounded-md', className)} />;
}

export function Stat({
  label, value, unit, delta, hint,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  delta?: number;
  hint?: string;
}) {
  const rising = delta !== undefined && delta >= 0;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="text-xs font-medium text-fg-subtle">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="tabular text-2xl font-semibold tracking-tight text-fg">{value}</span>
        {unit ? <span className="text-sm text-fg-subtle">{unit}</span> : null}
        {delta !== undefined ? (
          <span className={cn('ml-1 inline-flex items-center gap-0.5 text-xs font-medium tabular', rising ? 'text-success-fg' : 'text-danger-fg')}>
            {rising ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {Math.abs(delta)}%
          </span>
        ) : null}
      </div>
      {hint ? <div className="text-xs text-fg-subtle">{hint}</div> : null}
    </div>
  );
}

export function Code({ className, ...props }: React.ComponentProps<'code'>) {
  return (
    <code
      className={cn(
        'rounded-sm bg-surface-active px-1 py-px font-mono text-fg',
        // ds-allow DS009: 行内代码相对父级字号缩小 10%，阶梯字号无法表达
        'text-[.9em]',
        className,
      )}
      {...props}
    />
  );
}
