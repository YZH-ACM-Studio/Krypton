import { type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

const interactive = 'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-(--dur-1) ease-(--ease-standard)';

const controlClass = cn(
  interactive,
  'inline-grid h-(--control-sm) min-w-(--control-sm) place-items-center rounded-md px-1.5 text-sm tabular',
);

/** `total ≤ 7` lists every page. Wider ranges keep the ends and the current neighborhood, with an ellipsis only where the gap is greater than 1. */
function pageWindow(current: number, total: number): (number | '…')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }
  const kept = [1, total, current - 1, current, current + 1].filter((page) => page >= 1 && page <= total);
  const sorted = [...new Set(kept)].sort((left, right) => left - right);
  const tokens: (number | '…')[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const page = sorted[index];
    const previous = sorted[index - 1];
    if (page === undefined) {
      throw new TypeError('pagination window is missing a page');
    }
    if (previous !== undefined && page - previous > 1) {
      tokens.push('…');
    }
    tokens.push(page);
  }
  return tokens;
}

function pageHref(baseUrl: string, page: number): string {
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}page=${page}`;
}

function StepControl({
  label,
  href,
  icon,
}: {
  label: string;
  href?: string;
  icon: ReactNode;
}) {
  if (href === undefined) {
    return (
      <span aria-disabled="true" aria-label={label} className={cn(controlClass, 'text-fg-muted opacity-40')}>
        {icon}
      </span>
    );
  }
  return (
    <a href={href} aria-label={label} className={cn(controlClass, 'text-fg-muted hover:bg-surface-hover')}>
      {icon}
    </a>
  );
}

export function Pagination({
  current,
  total,
  baseUrl,
  summary,
}: {
  current: number;
  total: number;
  baseUrl: string;
  summary?: ReactNode;
}) {
  if (total <= 1) {
    return null;
  }

  return (
    <nav aria-label="pagination" className="flex items-center justify-between gap-4">
      <div className="hidden text-sm text-fg-subtle sm:block">{summary}</div>
      <div className="flex w-full items-center justify-between gap-1 sm:w-auto sm:justify-end">
        <StepControl
          label="上一页"
          href={current > 1 ? pageHref(baseUrl, current - 1) : undefined}
          icon={<ChevronLeft className="size-4" />}
        />
        <span className="text-sm tabular text-fg-muted sm:hidden">{`${current} / ${total}`}</span>
        <div className="hidden items-center gap-1 sm:flex">
          {pageWindow(current, total).map((token, index) => {
            if (token === '…') {
              return (
                <span key={`ellipsis-${index}`} className="px-1 text-fg-disabled">
                  …
                </span>
              );
            }
            const active = token === current;
            return (
              <a
                key={token}
                href={pageHref(baseUrl, token)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  controlClass,
                  active ? 'bg-fg font-medium text-bg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                )}
              >
                {token}
              </a>
            );
          })}
        </div>
        <StepControl
          label="下一页"
          href={current < total ? pageHref(baseUrl, current + 1) : undefined}
          icon={<ChevronRight className="size-4" />}
        />
      </div>
    </nav>
  );
}
