/**
 * Shared helpers for Vigil-side timestamps.
 *
 * Vigil server's SQLite columns are stored as naive UTC ISO strings
 * (no `Z` suffix, no `+08:00` offset). The browser's `new Date(s)`
 * parses those as *local time*, which on a +08:00 host means it
 * silently shows the data 8 hours into the future. Normalising to
 * `YYYY-MM-DDTHH:MM:SSZ` before handing to <DateTime/> tells the
 * browser it's UTC and lets DateTime's local-time renderer do the
 * +08:00 conversion correctly.
 */
import { DateTime, type DateTimeProps } from '@/components/ui/datetime';

const VIGIL_TZ_RE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;
const VIGIL_ISO_WITH_TIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;

export function normalizeVigilTimestamp(value: DateTimeProps['value']): DateTimeProps['value'] {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (VIGIL_ISO_WITH_TIME_RE.test(trimmed) && !VIGIL_TZ_RE.test(trimmed)) {
    return `${trimmed.replace(' ', 'T')}Z`;
  }
  return trimmed;
}

export function parseVigilTimestamp(value: DateTimeProps['value']): Date | null {
  const normalized = normalizeVigilTimestamp(value);
  const d = normalized instanceof Date ? normalized : new Date(normalized as any);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function VigilDateTime(props: DateTimeProps) {
  return <DateTime {...props} value={normalizeVigilTimestamp(props.value)} />;
}
