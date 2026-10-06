import { Fragment, type JSX, type ReactNode } from 'react';

export interface FactItem {
  label: string;
  value: ReactNode;
}

const COLUMN_CLASSES = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
} as const;

export function FactGrid({
  facts,
  columns = 3,
}: {
  facts: FactItem[];
  columns?: 2 | 3 | 4;
}): JSX.Element {
  const padCount = (columns - (facts.length % columns)) % columns;
  return (
    <dl
      data-slot="fact-grid"
      className={`grid gap-px overflow-hidden rounded-md bg-line-subtle ${COLUMN_CLASSES[columns]}`}
    >
      {facts.map((fact, index) => (
        <div key={`${index}:${fact.label}`} className="min-w-0 bg-surface px-3 py-2.5">
          <dt className="text-xs text-fg-subtle">{fact.label}</dt>
          <dd className="mt-0.5 min-w-0 break-words text-sm font-medium text-fg">{fact.value}</dd>
        </div>
      ))}
      {Array.from({ length: padCount }, (_, index) => (
        <div key={`pad:${index}`} aria-hidden="true" className="bg-surface" />
      ))}
    </dl>
  );
}

export function TechDetails({
  items,
  summary,
}: {
  items: FactItem[];
  summary?: string;
}): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <details data-slot="tech-details" className="border-t border-line-subtle pt-3">
      <summary className="cursor-pointer text-xs text-fg-subtle hover:text-fg rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {summary ?? '技术细节'}
      </summary>
      <dl className="mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        {items.map((item, index) => (
          <Fragment key={`${index}:${item.label}`}>
            <dt className="text-fg-subtle">{item.label}</dt>
            <dd className="min-w-0 break-all font-mono text-fg">{item.value}</dd>
          </Fragment>
        ))}
      </dl>
    </details>
  );
}
