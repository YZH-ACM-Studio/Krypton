/**
 * `<MiniTabs>` — segmented-control style tab switcher.
 *
 * Visual:
 *   - A muted pill background contains all options.
 *   - The active option gets a white "card" with a subtle shadow on top.
 *   - The active card **slides** between options via Framer Motion's
 *     `layoutId` (shared layout animation).
 *   - Inactive items get a `hover:bg-background/50` hint so the user
 *     knows they're clickable.
 *
 * Usage:
 *
 *   const [tab, setTab] = useState<'all' | 'pending' | 'done'>('all');
 *   <MiniTabs
 *     value={tab}
 *     onValueChange={setTab}
 *     items={[
 *       { value: 'all',     label: '全部',   count: total },
 *       { value: 'pending', label: '进行中', count: pendingCount, icon: Loader2 },
 *       { value: 'done',    label: '已完成', count: doneCount },
 *     ]}
 *   />
 *
 * Each item can carry:
 *   - `count`  — small badge appended after the label
 *   - `icon`   — Lucide icon component shown before the label
 *   - `href`   — render as `<a>` instead of `<button>` (useful for SSR tabs)
 *
 * The component generates a unique `layoutId` per instance via `useId()` so
 * multiple MiniTabs on the same page don't share the animated indicator.
 */
import { type ComponentType, type ReactNode, useId } from 'react';
import { motion } from 'motion/react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface MiniTabItem<T extends string = string> {
  value: T;
  label: ReactNode;
  count?: number;
  icon?: LucideIcon | ComponentType<{ className?: string }>;
  href?: string;
  disabled?: boolean;
}

export interface MiniTabsProps<T extends string = string> {
  value: T;
  onValueChange?: (next: T) => void;
  items: MiniTabItem<T>[];
  /** Visual density — `sm` (default, h-8) or `md` (h-9 with more padding). */
  size?: 'sm' | 'md';
  /** Take the full available width and distribute items evenly. */
  fullWidth?: boolean;
  className?: string;
  /** Aria label for the tablist. */
  'aria-label'?: string;
}

export function MiniTabs<T extends string = string>({
  value,
  onValueChange,
  items,
  size = 'sm',
  fullWidth = false,
  className,
  'aria-label': ariaLabel,
}: MiniTabsProps<T>) {
  const layoutId = useId();

  const sizeClass = size === 'md' ? 'h-9 p-1 text-sm' : 'h-8 p-0.5 text-xs';
  const itemPadding = size === 'md' ? 'px-3.5' : 'px-3';

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'relative inline-flex items-center gap-0.5 rounded-lg bg-muted/70 backdrop-blur-sm',
        sizeClass,
        fullWidth && 'w-full',
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        const Icon = item.icon;
        const inner = (
          <>
            {active && (
              <motion.span
                layoutId={`mini-tabs-indicator-${layoutId}`}
                className="absolute inset-0 -z-0 rounded-md bg-background shadow-sm ring-1 ring-border/40"
                transition={{ type: 'spring', stiffness: 500, damping: 36 }}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {Icon && <Icon className={cn(size === 'md' ? 'size-3.5' : 'size-3')} />}
              <span>{item.label}</span>
              {typeof item.count === 'number' && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0 text-[10px] font-medium leading-4 transition-colors',
                    active ? 'bg-primary/10 text-primary' : 'bg-muted-foreground/15 text-muted-foreground',
                  )}
                >
                  {item.count}
                </span>
              )}
            </span>
          </>
        );

        const sharedClass = cn(
          'relative inline-flex items-center justify-center rounded-md font-medium transition-colors',
          itemPadding,
          'h-full',
          fullWidth && 'flex-1',
          active
            ? 'text-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-background/60',
          item.disabled && 'pointer-events-none opacity-50',
        );

        if (item.href) {
          return (
            <a
              key={item.value}
              href={item.href}
              role="tab"
              aria-selected={active}
              className={sharedClass}
            >
              {inner}
            </a>
          );
        }

        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => !item.disabled && onValueChange?.(item.value)}
            className={sharedClass}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
