/**
 * `<MiniTabs>` — segmented control for one view, not page navigation.
 *
 * Track: `rounded-md bg-surface-active p-0.5`. The active pill slides with
 * `layoutId` and `MOTION.spring`. `useId()` keeps each instance's layout
 * id unique. `href` renders an anchor; other items stay buttons.
 * `label: null` is icon-only and requires `ariaLabel`.
 */
import {
  isValidElement,
  useId,
  type ComponentType,
  type ReactNode,
} from 'react';
import { type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { MOTION } from './motion';

const interactive = 'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-(--dur-1) ease-(--ease-standard)';

/** One warning per item value, even if the control re-renders. */
const warnedIconOnlyValues = new Set<string>();

export interface MiniTabItem<T extends string = string> {
  value: T;
  /** Visible label. `null` skips the text span and requires `ariaLabel`. */
  label: ReactNode;
  count?: number;
  /** Component (Lucide icon) or an already-created node. */
  icon?: LucideIcon | ComponentType<{ className?: string }> | ReactNode;
  href?: string;
  disabled?: boolean;
  /** Accessible name. Required when `label` is `null`. */
  ariaLabel?: string;
}

export interface MiniTabsProps<T extends string = string> {
  value: T;
  onValueChange?: (next: T) => void;
  items: MiniTabItem<T>[];
  /** Visual density. `sm` follows `--control-sm`; `md` follows `--control-md`. */
  size?: 'sm' | 'md';
  /** Take the full available width and distribute items evenly. */
  fullWidth?: boolean;
  className?: string;
  /** Aria label for the tablist. */
  'aria-label'?: string;
}

/** Lucide icons are `forwardRef` objects: `$$typeof` plus `render`, not elements. */
function isComponentIcon(icon: object): icon is ComponentType<{ className?: string }> {
  if (isValidElement(icon) || Array.isArray(icon)) {
    return false;
  }
  return '$$typeof' in icon;
}

function renderTabIcon(icon: MiniTabItem['icon'], className: string): ReactNode {
  if (typeof icon === 'function') {
    const Icon = icon;
    return <Icon className={className} />;
  }
  if (typeof icon === 'object' && icon !== null && isComponentIcon(icon)) {
    const Icon = icon;
    return <Icon className={className} />;
  }
  if (icon == null || typeof icon === 'boolean') {
    return null;
  }
  if (typeof icon === 'string' || typeof icon === 'number' || typeof icon === 'bigint' || isValidElement(icon) || Array.isArray(icon)) {
    return icon;
  }
  throw new TypeError('MiniTabs icon must be a component or a React node');
}

function warnIconOnlyWithoutName(items: readonly MiniTabItem[]): void {
  if (!import.meta.env.DEV) {
    return;
  }
  for (const item of items) {
    if (item.label !== null || item.ariaLabel !== undefined || warnedIconOnlyValues.has(item.value)) {
      continue;
    }
    warnedIconOnlyValues.add(item.value);
    console.warn(`MiniTabs item "${item.value}" has label null and no ariaLabel.`);
  }
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
  const iconClass = size === 'md' ? 'size-3.5' : 'size-3';
  const sizeClass = size === 'md'
    ? 'h-[calc(var(--control-md)-4px)] text-sm [&_svg]:size-3.5'
    : 'h-[calc(var(--control-sm)-4px)] text-xs [&_svg]:size-3';
  warnIconOnlyWithoutName(items);

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'relative inline-flex max-w-full items-center overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-none rounded-md bg-surface-active p-0.5',
        fullWidth && 'w-full min-w-0',
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        const inner = (
          <>
            {active ? (
              <motion.span
                layoutId={`mini-tabs-indicator-${layoutId}`}
                transition={MOTION.spring}
                className="absolute inset-0 rounded-sm bg-surface shadow-sm dark:bg-surface-raised"
              />
            ) : null}
            <span className="relative inline-flex items-center gap-1.5">
              {renderTabIcon(item.icon, iconClass)}
              {item.label === null ? null : <span>{item.label}</span>}
              {typeof item.count === 'number' ? (
                <span
                  className={cn(
                    'rounded-sm px-1.5 text-2xs tabular leading-4',
                    active ? 'bg-brand-soft text-brand-fg' : 'bg-surface-active text-fg-subtle',
                  )}
                >
                  {item.count}
                </span>
              ) : null}
            </span>
          </>
        );

        const sharedClass = cn(
          interactive,
          'relative inline-flex items-center justify-center whitespace-nowrap rounded-sm px-2.5 font-medium',
          sizeClass,
          fullWidth ? 'flex-1' : 'shrink-0',
          active ? 'text-fg' : 'text-fg-muted hover:text-fg',
        );

        if (item.href) {
          if (item.disabled) {
            return (
              <a
                key={item.value}
                role="tab"
                aria-selected={active}
                aria-disabled="true"
                aria-label={item.ariaLabel}
                tabIndex={-1}
                className={cn(sharedClass, 'pointer-events-none opacity-45')}
              >
                {inner}
              </a>
            );
          }
          return (
            <a
              key={item.value}
              href={item.href}
              role="tab"
              aria-selected={active}
              aria-label={item.ariaLabel}
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
            aria-label={item.ariaLabel}
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) {
                onValueChange?.(item.value);
              }
            }}
            className={cn(sharedClass, item.disabled && 'pointer-events-none opacity-50')}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
