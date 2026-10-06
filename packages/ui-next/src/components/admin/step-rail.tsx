import { useId, type JSX, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export type StepState = 'done' | 'attention' | 'active' | 'todo';

export interface StepRailItem<T extends string> {
  id: T;
  /** Accessible name of the step button. Summary is not part of the name. */
  label: string;
  /** Secondary line, exposed only through aria-describedby. */
  summary: ReactNode;
  state: StepState;
}

const MARKER_CLASS: Record<StepState, string> = {
  done: 'bg-success text-on-success',
  attention: 'border border-warning-line bg-warning-soft text-warning-fg',
  active: 'bg-brand text-on-brand',
  todo: 'border border-line-strong bg-surface text-fg-muted',
};

/**
 * Vertical step navigation. It only switches the visible step and shows state.
 */
export function StepRail<T extends string>({
  items,
  value,
  onValueChange,
  'aria-label': ariaLabel,
}: {
  items: StepRailItem<T>[];
  value: T;
  onValueChange: (id: T) => void;
  'aria-label': string;
}): JSX.Element {
  const idPrefix = useId();

  return (
    <nav aria-label={ariaLabel} data-slot="step-rail">
      <ol className="m-0 flex list-none flex-col gap-0.5 p-1.5">
        {items.map((item, index) => {
          const labelId = `${idPrefix}-${item.id}-label`;
          const summaryId = `${idPrefix}-${item.id}-summary`;
          const selected = value === item.id;
          return (
            <li key={item.id}>
              {/* ds-allow DS005: 步骤行同时放序号、标题和摘要，固定高度的 Button 会裁掉摘要并把整行居中 */}
              <button
                type="button"
                data-state={item.state}
                aria-current={selected ? 'step' : undefined}
                aria-labelledby={labelId}
                aria-describedby={summaryId}
                onClick={() => {
                  onValueChange(item.id);
                }}
                className={cn(
                  'relative grid w-full grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-2.5 rounded-md px-2.5 py-2 text-left',
                  'cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  selected ? 'bg-brand-soft' : 'hover:bg-surface-hover',
                )}
              >
                <span className="relative">
                  {index > 0 ? (
                    // Shift 6px up so the stub crosses the button edge and the list gap.
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute bottom-full left-1/2 h-2 -translate-x-1/2 -translate-y-1.5 border-l border-line"
                    />
                  ) : null}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium tabular leading-none',
                      MARKER_CLASS[item.state],
                    )}
                  >
                    {item.state === 'done' ? <Check className="size-3.5" /> : index + 1}
                  </span>
                </span>
                <span className="min-w-0">
                  <span id={labelId} className="block text-sm font-medium text-fg">
                    {item.label}
                  </span>
                  <span
                    id={summaryId}
                    className={cn(
                      'block min-w-0 truncate text-xs',
                      item.state === 'attention' ? 'text-warning-fg' : 'text-fg-subtle',
                    )}
                  >
                    {item.summary}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
