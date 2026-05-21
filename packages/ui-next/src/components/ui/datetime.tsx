/**
 * `<DateTime>` — single React component for every timestamp in the UI.
 *
 * All formatting is locked to **UTC+8** via `@hydrooj/common/datetime`.
 * The component renders a semantic `<time>` element so we still get
 * machine-readable `datetime` for screen readers / copy-paste, while
 * the visible text is the formatted CST string.
 *
 *   <DateTime value={tdoc.beginAt} />                    // 2026-05-21 18:30
 *   <DateTime value={tdoc.beginAt} mode="date" />        // 2026-05-21
 *   <DateTime value={tdoc.beginAt} mode="relative" />    // 3 天后
 *   <DateTime value={tdoc.beginAt} mode="both" />        // 2026-05-21 18:30 · 3 天后
 *   <DateTime value={x} fallback="—" />
 *
 * Hovering shows the **other** format as a tooltip (absolute when the
 * visible text is relative, and vice-versa). This is the cheapest way
 * to give callers full info without crowding the layout.
 */
import { type HTMLAttributes, useEffect, useState } from 'react';
import {
  type DateInput,
  formatDateTime,
  formatDateTimeWithRelative,
  formatRelative,
  parseDate,
} from '@hydrooj/common';
import { cn } from '@/lib/cn';

export type DateTimeMode =
  | 'datetime'      // 2026-05-21 18:30 (default)
  | 'datetime-sec'  // 2026-05-21 18:30:45
  | 'date'          // 2026-05-21
  | 'date-cn'       // 2026年5月21日
  | 'datetime-cn'   // 2026年5月21日 18:30
  | 'relative'      // 3 天后
  | 'both';         // 2026-05-21 18:30 · 3 天后

export interface DateTimeProps extends Omit<HTMLAttributes<HTMLTimeElement>, 'children'> {
  value: DateInput;
  mode?: DateTimeMode;
  /** Shown when value is null / invalid. Default `'—'`. */
  fallback?: string;
  /** Re-render every N ms to keep the relative time fresh. Default `60_000`. Set `0` to disable. */
  refreshInterval?: number;
}

export function DateTime({
  value,
  mode = 'datetime',
  fallback = '—',
  refreshInterval = 60_000,
  className,
  ...rest
}: DateTimeProps) {
  const [tick, setTick] = useState(0);
  const wantsLive = mode === 'relative' || mode === 'both';
  useEffect(() => {
    if (!wantsLive || !refreshInterval) return;
    const t = setInterval(() => setTick((x) => x + 1), refreshInterval);
    return () => clearInterval(t);
  }, [wantsLive, refreshInterval]);
  void tick; // keep the effect's tick referenced

  const parsed = parseDate(value);
  if (!parsed) {
    return <time className={cn('text-muted-foreground', className)} {...rest}>{fallback}</time>;
  }

  const iso = parsed.toISOString();
  let display: string;
  let title: string;

  if (mode === 'relative') {
    display = formatRelative(parsed);
    title = formatDateTime(parsed);
  } else if (mode === 'both') {
    const { absolute, relative } = formatDateTimeWithRelative(parsed);
    display = `${absolute} · ${relative}`;
    title = formatDateTime(parsed, { precision: 'second' });
  } else {
    const precisionMap: Record<Exclude<DateTimeMode, 'relative' | 'both'>, any> = {
      datetime: 'minute',
      'datetime-sec': 'second',
      date: 'date',
      'date-cn': 'date-cn',
      'datetime-cn': 'datetime-cn',
    };
    display = formatDateTime(parsed, { precision: precisionMap[mode] });
    title = `${formatDateTime(parsed, { precision: 'second' })} · ${formatRelative(parsed)}`;
  }

  return (
    <time dateTime={iso} title={title} className={className} {...rest}>
      {display}
    </time>
  );
}

/**
 * Convenience: same as `<DateTime />` but assumes you want the absolute date.
 * Re-exported because callers often grep for `<Date>` rather than `<DateTime>`.
 */
export function DateDisplay(props: Omit<DateTimeProps, 'mode'>) {
  return <DateTime {...props} mode="date" />;
}

/** Range like "2026-05-21 18:30 → 20:30" (collapses identical date part). */
export function DateTimeRange({
  from, to, separator = ' → ', fallback = '—', className, mode = 'datetime',
}: {
  from: DateInput;
  to: DateInput;
  separator?: string;
  fallback?: string;
  className?: string;
  mode?: 'datetime' | 'datetime-sec' | 'date';
}) {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) {
    return <span className={cn('text-muted-foreground', className)}>{fallback}</span>;
  }
  const precision = mode === 'date' ? 'date' : mode === 'datetime-sec' ? 'second' : 'minute';
  const aStr = formatDateTime(a, { precision });
  const bStr = formatDateTime(b, { precision });
  // Same date → show date once, then time-of-day for the second.
  if (mode !== 'date') {
    const aDate = formatDateTime(a, { precision: 'date' });
    const bDate = formatDateTime(b, { precision: 'date' });
    if (aDate === bDate) {
      const bTimeOnly = bStr.slice(aDate.length).trim();
      return (
        <time className={className} title={`${aStr} → ${bStr}`}>
          {aStr}{separator}{bTimeOnly}
        </time>
      );
    }
  }
  return (
    <time className={className} title={`${aStr} → ${bStr}`}>
      {aStr}{separator}{bStr}
    </time>
  );
}
