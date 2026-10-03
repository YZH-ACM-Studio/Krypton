/**
 * ScrollArea — branded scroll container built on Radix.
 *
 * The track stays transparent. The thumb uses `--scroll-thumb` /
 * `--scroll-thumb-hover`, is 10px on the cross axis, and inset by 3px.
 * Scrollbars appear only when content overflows. Pass no orientation for
 * the default vertical case; `both` mounts the horizontal bar too.
 *
 * `viewportLayout` overrides Radix's `display: table` content wrapper.
 * The viewport's `max-height: inherit` lets a `max-h-*` root actually scroll.
 */
import * as React from 'react';
import * as RScrollArea from '@radix-ui/react-scroll-area';
import { cn } from '@/lib/cn';

export interface ScrollAreaProps extends React.ComponentPropsWithoutRef<typeof RScrollArea.Root> {
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
   * trigger scrolling — so the default is `table`.
   *
   * Opt out only when the children need a real block or flex layout.
   * For a horizontal toolbar, pass `viewportLayout="flex"` and set direction
   * through `viewportClassName`.
   */
  viewportLayout?: 'table' | 'block' | 'flex';
}

const viewportLayoutClass = (layout: 'table' | 'block' | 'flex') => {
  if (layout === 'block') return '[&>div]:!block';
  if (layout === 'flex') return '[&>div]:!flex';
  return '';
};

export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, viewportClassName, orientation = 'vertical', type = 'auto', children, viewportRef, viewportLayout = 'table', ...props }, ref) => {
    return (
      <RScrollArea.Root ref={ref} type={type} className={cn('relative overflow-hidden', className)} {...props}>
        <RScrollArea.Viewport
          ref={viewportRef}
          className={cn(
            'size-full rounded-[inherit]',
            viewportLayoutClass(viewportLayout),
            viewportClassName,
          )}
          style={{ maxHeight: 'inherit' }}
        >
          {children}
        </RScrollArea.Viewport>
        {orientation === 'vertical' || orientation === 'both' ? <ScrollBar orientation="vertical" /> : null}
        {orientation === 'horizontal' || orientation === 'both' ? <ScrollBar orientation="horizontal" /> : null}
        <RScrollArea.Corner className="bg-transparent" />
      </RScrollArea.Root>
    );
  },
);

export const ScrollBar = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof RScrollArea.ScrollAreaScrollbar>>(
  ({ className, orientation = 'vertical', ...props }, ref) => {
    return (
      <RScrollArea.ScrollAreaScrollbar
        ref={ref}
        orientation={orientation}
        className={cn(
          'flex touch-none select-none bg-transparent transition-colors motion-reduce:transition-none',
          orientation === 'vertical' ? 'h-full w-[10px] p-[3px]' : 'h-[10px] w-full flex-col p-[3px]',
          className,
        )}
        {...props}
      >
        <RScrollArea.ScrollAreaThumb
          className="relative flex-1 rounded-full bg-[var(--scroll-thumb)] transition-colors hover:bg-[var(--scroll-thumb-hover)] motion-reduce:transition-none"
        />
      </RScrollArea.ScrollAreaScrollbar>
    );
  },
);
