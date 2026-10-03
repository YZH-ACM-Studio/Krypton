import type { ReactNode } from 'react';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';

export function NavButton({
  icon,
  label,
  active = false,
  collapsed = false,
  badge,
  badgeText,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  badge?: ReactNode;
  badgeText?: string;
  onClick?: () => void;
}) {
  const button = (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      onClick={onClick}
      className={cn(
        'relative flex h-8 w-full items-center rounded-md text-sm outline-none',
        'transition-colors duration-(--dur-1) ease-(--ease-standard)',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        collapsed ? 'justify-center px-0' : 'gap-2.5 px-2',
        active ? 'bg-surface-active font-medium text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      <span className={cn('inline-flex shrink-0 [&_svg]:size-4', active ? 'text-fg' : 'text-fg-subtle')} aria-hidden="true">
        {icon}
      </span>
      {collapsed ? null : <span className="truncate">{label}</span>}
      {badge === undefined ? null : (
        <span className={cn(collapsed ? 'absolute -top-0.5 -right-0.5' : 'ml-auto')}>{badge}</span>
      )}
    </button>
  );

  if (!collapsed) {
    return button;
  }

  const tip = badgeText === undefined ? label : `${label} ${badgeText}`;
  return (
    <SimpleTooltip content={tip} side="right">
      {button}
    </SimpleTooltip>
  );
}
