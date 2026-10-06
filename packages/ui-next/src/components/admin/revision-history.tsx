import type { JSX, ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

export interface RevisionHistoryRow {
  key: string;
  title: ReactNode;
  meta?: ReactNode;
  current?: boolean;
  action?: ReactNode;
  detail?: { summary: string; content: ReactNode };
}

const SUMMARY_CHROME = 'cursor-pointer list-none rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden';

export function RevisionHistory({
  title,
  summary,
  rows,
  currentLabel,
  defaultOpen,
}: {
  title: string;
  summary?: ReactNode;
  rows: RevisionHistoryRow[];
  currentLabel?: string;
  defaultOpen?: boolean;
}): JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <details
      data-slot="revision-history"
      className="rounded-md border border-line-subtle"
      // open={false} is controlled: React writes it back on every render and the disclosure cannot stay open.
      open={defaultOpen ? true : undefined}
    >
      <summary className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 ${SUMMARY_CHROME}`}>
        <span className="text-sm font-medium text-fg">{title}</span>
        {summary != null ? <span className="text-xs text-fg-subtle">{summary}</span> : null}
      </summary>
      <ol className="m-0 list-none divide-y divide-line-subtle border-t border-line-subtle p-0">
        {rows.map((row) => (
          <li
            key={row.key}
            data-current={row.current ? 'true' : undefined}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium">
              {row.title}
              {row.current ? <Badge tone="success">{currentLabel ?? '使用中'}</Badge> : null}
            </div>
            {row.action}
            {row.meta != null ? <div className="col-start-1 text-xs text-fg-subtle">{row.meta}</div> : null}
            {row.detail ? (
              <details className="col-span-2">
                <summary className={`text-xs text-brand-fg ${SUMMARY_CHROME}`}>
                  {row.detail.summary}
                </summary>
                <div className="mt-2 text-xs">{row.detail.content}</div>
              </details>
            ) : null}
          </li>
        ))}
      </ol>
    </details>
  );
}
