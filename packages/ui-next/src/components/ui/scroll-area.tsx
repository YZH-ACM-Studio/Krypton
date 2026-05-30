/**
 * ScrollArea — branded scroll container built on Radix.
 *
 * Wraps `@radix-ui/react-scroll-area` with our visual style:
 *   - Track stays transparent; thumb is muted-foreground at 30/55% alpha.
 *   - Scrollbars are 10 px wide and only appear when content overflows.
 *   - Works for vertical, horizontal, and both axes automatically — pass
 *     no extra props for the default vertical case.
 *
 * The CSS variable `--radix-scroll-area-corner-width` etc. are exposed by
 * Radix so the two scrollbars don't overlap when both are visible.
 *
 * Layout note: Radix's `Viewport` becomes the actual scroll node. If a
 * parent uses `flex` + `flex-1`, set the ScrollArea root to those same
 * classes (so it fills the column) — the Viewport always fills the root.
 *
 * `type="hover"` only shows the bar on hover; `type="auto"` (default) keeps
 * it visible whenever content overflows.
 */
import * as React from 'react';
import * as RScrollArea from '@radix-ui/react-scroll-area';
import { cn } from '@/lib/cn';

export interface ScrollAreaProps
  extends React.ComponentPropsWithoutRef<typeof RScrollArea.Root> {
  /** Class applied to the inner viewport (the actual scroll node). */
  viewportClassName?: string;
  /** Show both bars (`'both'`), only vertical (default), or only horizontal. */
  orientation?: 'vertical' | 'horizontal' | 'both';
  /** Ref forwarded to the viewport (the scroll node) rather than the root. */
  viewportRef?: React.Ref<HTMLDivElement>;
  /**
   * Layout of the viewport's immediate child wrapper.
   *
   * Radix's Viewport wraps content in a `display: table` element. Tables size
   * to content height, which is what lets the parent's `max-h-*` actually
   * trigger scrolling — so the default is `table` and that's what works for
   * popovers, dialogs, lists, and plain block content.
   *
   * Opt out only when the children need a real flex row/column layout —
   * e.g. a horizontally-scrolling toolbar where children must lay out side by
   * side. For those, pass `viewportLayout="flex"` and use `viewportClassName`
   * to set the flex direction / spacing.
   */
  viewportLayout?: 'table' | 'block' | 'flex';
}

const viewportLayoutClass = (layout: 'table' | 'block' | 'flex') => {
  if (layout === 'block') return '[&>div]:!block';
  if (layout === 'flex') return '[&>div]:!flex';
  return ''; // 'table' = Radix default, no override
};

export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  function ScrollArea(
    {
      className, viewportClassName, orientation = 'vertical',
      type = 'auto', children, viewportRef, viewportLayout = 'table', ...props
    },
    ref,
  ) {
    return (
      <RScrollArea.Root
        ref={ref}
        type={type}
        className={cn('relative overflow-hidden', className)}
        {...props}
      >
        <RScrollArea.Viewport
          ref={viewportRef}
          className={cn(
            // `size-full` works when Root has explicit `h-*`; the inline
            // `max-height: inherit` makes it also work when Root only has
            // `max-h-*` (the classic CSS percent-height-on-auto-parent trap —
            // 100% of auto doesn't resolve, but max-h-inherit caps content
            // at the right height so the viewport's overflow:scroll triggers).
            'size-full rounded-[inherit]',
            viewportLayoutClass(viewportLayout),
            viewportClassName,
          )}
          style={{ maxHeight: 'inherit' }}
        >
          {children}
        </RScrollArea.Viewport>
        {(orientation === 'vertical' || orientation === 'both') ? (
          <ScrollBar orientation="vertical" />
        ) : null}
        {(orientation === 'horizontal' || orientation === 'both') ? (
          <ScrollBar orientation="horizontal" />
        ) : null}
        <RScrollArea.Corner className="bg-transparent" />
      </RScrollArea.Root>
    );
  },
);

export const ScrollBar = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof RScrollArea.ScrollAreaScrollbar>
>(function ScrollBar({ className, orientation = 'vertical', ...props }, ref) {
  return (
    <RScrollArea.ScrollAreaScrollbar
      ref={ref}
      orientation={orientation}
      className={cn(
        'flex touch-none select-none transition-colors',
        orientation === 'vertical'
          ? 'h-full w-2.5 border-l border-l-transparent p-px'
          : 'h-2.5 w-full flex-col border-t border-t-transparent p-px',
        className,
      )}
      {...props}
    >
      <RScrollArea.ScrollAreaThumb
        className={cn(
          'relative flex-1 rounded-full bg-muted-foreground/30 transition-colors',
          'hover:bg-muted-foreground/55',
        )}
      />
    </RScrollArea.ScrollAreaScrollbar>
  );
});
