import type * as React from 'react';
import { cn } from '@/lib/cn';

export function Avatar({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="avatar"
      className={cn('relative flex size-10 shrink-0 overflow-hidden rounded-full', className)}
      {...props}
    />
  );
}

export function AvatarFallback({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="avatar-fallback"
      className={cn('flex size-full items-center justify-center rounded-full bg-muted text-sm font-medium', className)}
      {...props}
    />
  );
}

/** Render an <img> filling the parent Avatar slot. Falls back to the
 *  sibling AvatarFallback if the image errors or has no src. */
export function AvatarImage({ className, alt = '', ...props }: React.ComponentProps<'img'>) {
  return (
    <img
      data-slot="avatar-image"
      alt={alt}
      className={cn('absolute inset-0 h-full w-full object-cover', className)}
      onError={(e) => {
        // Hide on error — the AvatarFallback (z-stacked behind) becomes visible.
        (e.currentTarget as HTMLImageElement).style.display = 'none';
      }}
      {...props}
    />
  );
}
