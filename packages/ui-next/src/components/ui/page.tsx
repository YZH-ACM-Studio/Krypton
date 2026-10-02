import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * One per page. The title is the only h1. Actions drop under the title below
 * `sm`. Tabs sit flush on the bottom border, so the header drops `pb-5`.
 */
export function PageHeader({
  title,
  description,
  breadcrumb,
  meta,
  actions,
  tabs,
}: {
  title: ReactNode;
  description?: ReactNode;
  breadcrumb?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <header className={cn('border-b border-line', !tabs && 'pb-5')} data-slot="page-header">
      {breadcrumb ? <div className="mb-3">{breadcrumb}</div> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-fg text-balance sm:text-2xl">{title}</h1>
          {description ? <p className="mt-1.5 max-w-prose text-sm text-fg-muted text-pretty">{description}</p> : null}
          {meta ? <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-subtle">{meta}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {tabs ? <div className="mt-4">{tabs}</div> : null}
    </header>
  );
}

/** Filter row above a list. Wraps on small screens; the end slot stays on the right. */
export function Toolbar({ children, end, className }: { children: ReactNode; end?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {children}
      {end ? <div className="ml-auto flex items-center gap-2">{end}</div> : null}
    </div>
  );
}

/**
 * Width follows what the page is, not an ad hoc cap:
 * prose ~46rem, form ~56rem, wide ~80rem, full uncapped.
 */
export const CONTENT_WIDTH = {
  prose: 'max-w-[46rem]',
  form: 'max-w-[56rem]',
  wide: 'max-w-[80rem]',
  full: 'max-w-none',
} as const;

export function Page({
  width = 'wide',
  children,
  className,
}: {
  width?: keyof typeof CONTENT_WIDTH;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="page"
      data-width={width}
      className={cn('mx-auto w-full px-4 pt-5 pb-16 sm:px-6 sm:pt-8 lg:px-8 short:pt-4', CONTENT_WIDTH[width], className)}
    >
      <div className="flex flex-col gap-6 short:gap-4">{children}</div>
    </div>
  );
}

/** Fills the shell remainder. `--workspace-h` is set by AppShell from the measured top bar. */
export function Workspace({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-slot="workspace" className={cn('flex h-(--workspace-h,calc(100dvh-3rem)) min-h-0 flex-col', className)}>
      {children}
    </div>
  );
}
