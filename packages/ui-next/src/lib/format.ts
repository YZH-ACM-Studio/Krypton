export function toDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function formatDateTime(value: unknown, locale: string) {
  const date = toDate(value);
  if (!date) return 'TBD';
  return new Intl.DateTimeFormat(locale || 'zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatShortDate(value: unknown, locale: string) {
  const date = toDate(value);
  if (!date) return 'TBD';
  return new Intl.DateTimeFormat(locale || 'zh-CN', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatRelativeTime(value: unknown, locale: string) {
  const date = toDate(value);
  if (!date) return 'Just now';

  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 1000 / 60);
  const relative = new Intl.RelativeTimeFormat(locale || 'zh-CN', {
    numeric: 'auto',
  });

  if (Math.abs(diffMinutes) < 60) return relative.format(diffMinutes, 'minute');

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return relative.format(diffHours, 'hour');

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) return relative.format(diffDays, 'day');

  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) return relative.format(diffMonths, 'month');

  const diffYears = Math.round(diffMonths / 12);
  return relative.format(diffYears, 'year');
}

export function makeInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'K';
}

export function replaceRouteTokens(template: string, replacements: Record<string, string | number>) {
  let result = template;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(`__${key}__`, 'g'), encodeURIComponent(String(value)));
  }
  return result;
}
