import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

type AlertTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const interactive =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-(--dur-1) ease-(--ease-standard)';

const ALERT: Record<AlertTone, { box: string; icon: ReactNode }> = {
  info: { box: 'border-info-line bg-info-soft [&_[data-icon]]:text-info-fg', icon: <Info /> },
  success: { box: 'border-success-line bg-success-soft [&_[data-icon]]:text-success-fg', icon: <CheckCircle2 /> },
  warning: { box: 'border-warning-line bg-warning-soft [&_[data-icon]]:text-warning-fg', icon: <AlertTriangle /> },
  danger: { box: 'border-danger-line bg-danger-soft [&_[data-icon]]:text-danger-fg', icon: <XCircle /> },
  neutral: { box: 'border-line bg-surface-sunken [&_[data-icon]]:text-fg-subtle', icon: <Info /> },
};

/** Inline, in-flow message. Body text stays `fg`; only the icon carries tone. */
export function Alert({
  tone = 'info',
  title,
  children,
  action,
  onDismiss,
  className,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const toneStyle = ALERT[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-lg border px-3.5 py-3 text-sm', toneStyle.box, className)}>
      <span data-icon className="mt-px shrink-0 [&_svg]:size-4">
        {toneStyle.icon}
      </span>
      <div className="min-w-0 flex-1">
        {title ? <div className="font-medium text-fg">{title}</div> : null}
        {children ? <div className={cn('text-fg-muted', title && 'mt-0.5')}>{children}</div> : null}
        {action ? <div className="mt-2.5 flex flex-wrap gap-2">{action}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          aria-label="关闭"
          onClick={onDismiss}
          className={cn(interactive, '-mt-0.5 -mr-1 grid size-6 shrink-0 place-items-center rounded-sm text-fg-subtle hover:text-fg')}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
