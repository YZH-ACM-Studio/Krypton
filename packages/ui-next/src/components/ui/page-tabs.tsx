/**
 * Page-level tabs. The underline sits inside the active tab (`bottom-0`)
 * so the horizontal scroller never grows a vertical scrollbar.
 */
import { type ReactNode, useId } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { MOTION } from './motion';

const interactive = 'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-(--dur-1) ease-(--ease-standard)';

export interface PageTabItem<T extends string = string> {
  value: T;
  label: ReactNode;
  count?: number;
  icon?: ReactNode;
  href?: string;
}

export interface PageTabsProps<T extends string = string> {
  value: T;
  onValueChange?: (value: T) => void;
  items: PageTabItem<T>[];
  className?: string;
  'aria-label'?: string;
}

export function PageTabs<T extends string = string>({
  value,
  onValueChange,
  items,
  className,
  'aria-label': ariaLabel,
}: PageTabsProps<T>) {
  const id = useId();

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        '-mb-px flex gap-5 overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-none',
        className,
      )}
    >
      {items.map((item) => {
        const on = item.value === value;
        const sharedClass = cn(
          interactive,
          'relative flex h-10 shrink-0 items-center gap-1.5 text-sm font-medium [&_svg]:size-4',
          on ? 'text-fg' : 'text-fg-muted hover:text-fg',
        );
        const inner = (
          <>
            {item.icon}
            {item.label}
            {item.count !== undefined ? (
              <span
                className={cn(
                  'rounded-sm px-1.5 text-2xs tabular leading-4',
                  on ? 'bg-brand-soft text-brand-fg' : 'bg-surface-active text-fg-subtle',
                )}
              >
                {item.count}
              </span>
            ) : null}
            {on ? (
              <motion.span
                layoutId={`tab-${id}`}
                transition={MOTION.spring}
                className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-fg"
              />
            ) : null}
          </>
        );

        if (item.href) {
          return (
            <a
              key={item.value}
              href={item.href}
              role="tab"
              aria-selected={on}
              onClick={() => {
                onValueChange?.(item.value);
              }}
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
            aria-selected={on}
            onClick={() => {
              onValueChange?.(item.value);
            }}
            className={sharedClass}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
