import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { cn } from '@/lib/cn';
import type { MonthCell, MonthEvent } from './calendar-layout';
import { schoolWeekStart } from './model';

/** Month cells are Beijing midnights. The day numeral must not follow the browser zone. */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;
const VISIBLE_EVENT_LIMIT = 3;

export function CalendarMonth({ cells, onPickWeek }: { cells: readonly MonthCell[]; onPickWeek: (weekStartMs: number) => void }) {
  const weeks = weeksOf(cells);
  return (
    <Panel flush>
      <div role="grid" aria-label="月历" className="min-w-0">
        <div role="row" className="grid grid-cols-7 bg-surface-sunken">
          {WEEKDAYS.map((label) => (
            <div key={label} role="columnheader" className="px-2.5 py-2 text-xs font-medium text-fg-subtle">
              {label}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0].dayMs} role="row" className="grid grid-cols-7">
            {week.map((cell, column) => (
              <MonthDay key={cell.dayMs} cell={cell} column={column} onPickWeek={onPickWeek} />
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function weeksOf(cells: readonly MonthCell[]): MonthCell[][] {
  if (cells.length !== 35 && cells.length !== 42) {
    throw new TypeError(`month grid must have 35 or 42 cells, received ${cells.length}`);
  }
  const weeks: MonthCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

function beijingDay(dayMs: number): number {
  if (!Number.isFinite(dayMs)) throw new TypeError('dayMs must be a finite timestamp');
  return new Date(dayMs + SHANGHAI_OFFSET_MS).getUTCDate();
}

function weekStartOfBegin(event: MonthEvent): number {
  const beginAt = event.row.beginAt;
  if (typeof beginAt !== 'string') throw new TypeError('month event is missing beginAt');
  const begin = Date.parse(beginAt);
  if (!Number.isFinite(begin)) throw new TypeError(`month event beginAt is invalid: ${beginAt}`);
  return schoolWeekStart(begin);
}

function eventChipClass(event: MonthEvent): string {
  if (event.done) return 'text-fg-subtle';
  if (event.kind === 'due' && event.soon) return 'bg-warning-soft text-warning-fg';
  if (event.kind === 'point' && event.soon) return 'bg-success-soft text-success-fg';
  return 'bg-surface-active text-fg';
}

function MonthDay({ cell, column, onPickWeek }: { cell: MonthCell; column: number; onPickWeek: (weekStartMs: number) => void }) {
  const shown = cell.events.slice(0, VISIBLE_EVENT_LIMIT);
  const hidden = cell.events.length - shown.length;
  const moreLabel = `还有 ${hidden} 项`;
  return (
    <div
      role="gridcell"
      {...(cell.today ? { 'aria-current': 'date' as const } : {})}
      className={cn(
        'flex min-h-24 min-w-0 flex-col items-stretch gap-1 border-t border-line-subtle p-1.5',
        column > 0 && 'border-l',
        !cell.inMonth && 'bg-surface-sunken',
      )}
    >
      <span
        className={cn(
          'grid size-6 place-items-center rounded-full text-xs font-semibold tabular',
          cell.today ? 'bg-brand text-on-brand' : cell.inMonth ? 'text-fg' : 'text-fg-subtle',
        )}
      >
        {beijingDay(cell.dayMs)}
      </span>
      {shown.map((event) => (
        <Button
          key={`${event.kind}:${event.row.id}:${event.label}`}
          type="button"
          variant="ghost"
          size="sm"
          aria-label={event.label}
          title={event.label}
          className="w-full min-w-0 shrink justify-start"
          onClick={() => onPickWeek(weekStartOfBegin(event))}
        >
          <span className={cn('flex min-w-0 flex-1 items-center gap-1 rounded-sm px-1.5', eventChipClass(event))}>
            {event.done ? <Check aria-hidden className="text-success-fg" /> : null}
            <span className="min-w-0 truncate">{event.label}</span>
          </span>
        </Button>
      ))}
      {hidden > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={moreLabel}
          className="w-full min-w-0 shrink justify-start"
          onClick={() => onPickWeek(schoolWeekStart(cell.dayMs))}
        >
          {moreLabel}
        </Button>
      ) : null}
    </div>
  );
}
