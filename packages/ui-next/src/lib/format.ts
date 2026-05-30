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

/**
 * Build a single-line preview of a markdown blob — strip syntax noise
 * (code fences, link wrappers, raw HTML) but keep the visible text,
 * including emoji and CJK punctuation. Used by list cells where a full
 * Markdown render would be too tall.
 *
 * Compared to the old version, we no longer wipe `# * _ ~ > | -` blindly,
 * because that nuked emoji-like patterns and decorative punctuation. We
 * only remove them when they appear as line-leading markdown markers.
 */
export function formatPlainTextSummary(value: unknown) {
  return String(value || '')
    // 1. Drop fenced code blocks entirely
    .replace(/```[\s\S]*?```/g, ' ')
    // 2. Unwrap inline code
    .replace(/`([^`]+)`/g, '$1')
    // 3. Drop image references
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    // 4. Unwrap links to just the label
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // 5. Drop raw HTML tags but keep their text
    .replace(/<[^>]+>/g, ' ')
    // 6. Remove leading list / heading / quote markers at the *start of a line*
    .replace(/(^|\n)\s*(?:[#>|*\-+]\s+|\d+\.\s+)/g, '$1')
    // 7. Drop pure emphasis markers but leave their content
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    // 8. Collapse runs of whitespace
    .replace(/\s+/g, ' ')
    .trim();
}
