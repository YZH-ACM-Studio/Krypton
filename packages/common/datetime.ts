/**
 * Shared datetime helpers — locked to **UTC+8 (China Standard Time)**.
 *
 * The OJ runs on Chinese campuses and all admin tooling already assumes
 * Beijing time; we render every timestamp in CST regardless of the
 * viewer's browser locale to avoid the "did the user submit before or
 * after the deadline?" ambiguity.
 *
 * This module is **dependency-free** so both the Node backend and the
 * React frontend can import it. Date inputs accept any of:
 *   - `Date`
 *   - ISO 8601 / RFC-3339 string
 *   - millisecond epoch number
 *   - `null` / `undefined` (returns the `fallback`)
 */

export const CST_OFFSET_MINUTES = 8 * 60;
export const CST_OFFSET_MS = CST_OFFSET_MINUTES * 60 * 1000;

export type DateInput = Date | string | number | null | undefined;

export interface FormatOptions {
    /** What to fall back to when input is null/undefined/invalid. Default: `'—'`. */
    fallback?: string;
    /**
     * Granularity.
     *   - `'date'`        → 2026-05-21
     *   - `'minute'`      → 2026-05-21 18:30
     *   - `'second'`      → 2026-05-21 18:30:45
     *   - `'date-cn'`     → 2026年5月21日
     *   - `'datetime-cn'` → 2026年5月21日 18:30
     */
    precision?: 'date' | 'minute' | 'second' | 'date-cn' | 'datetime-cn';
}

/**
 * Parse any reasonable input into a `Date` (or `null` on failure). Does NOT
 * shift to CST — that's done at format time.
 */
export function parseDate(input: DateInput): Date | null {
    if (input == null) return null;
    if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
    if (typeof input === 'number') {
        const d = new Date(input);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof input === 'string') {
        const trimmed = input.trim();
        if (!trimmed) return null;
        const d = new Date(trimmed);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
}

/** Shift a UTC `Date` so that `.getUTCFullYear()` etc. return CST values. */
function shiftToCst(d: Date): Date {
    return new Date(d.getTime() + CST_OFFSET_MS);
}

function pad2(n: number): string {
    return n < 10 ? `0${n}` : String(n);
}

/**
 * Format a date as a Beijing-time absolute string.
 *
 * @example
 *   formatDateTime('2026-05-21T10:30:45Z')              // '2026-05-21 18:30'
 *   formatDateTime('2026-05-21T10:30:45Z', { precision: 'second' })  // '2026-05-21 18:30:45'
 *   formatDateTime(null)                                // '—'
 */
export function formatDateTime(input: DateInput, opts: FormatOptions = {}): string {
    const d = parseDate(input);
    if (!d) return opts.fallback ?? '—';
    const c = shiftToCst(d);
    const y = c.getUTCFullYear();
    const mo = c.getUTCMonth() + 1;
    const da = c.getUTCDate();
    const h = c.getUTCHours();
    const mi = c.getUTCMinutes();
    const s = c.getUTCSeconds();
    switch (opts.precision || 'minute') {
        case 'date':
            return `${y}-${pad2(mo)}-${pad2(da)}`;
        case 'minute':
            return `${y}-${pad2(mo)}-${pad2(da)} ${pad2(h)}:${pad2(mi)}`;
        case 'second':
            return `${y}-${pad2(mo)}-${pad2(da)} ${pad2(h)}:${pad2(mi)}:${pad2(s)}`;
        case 'date-cn':
            return `${y}年${mo}月${da}日`;
        case 'datetime-cn':
            return `${y}年${mo}月${da}日 ${pad2(h)}:${pad2(mi)}`;
        default:
            return `${y}-${pad2(mo)}-${pad2(da)} ${pad2(h)}:${pad2(mi)}`;
    }
}

/**
 * Shortcut for the date-only form. Use when seconds/minutes would add noise
 * (e.g. "joined 2024-09-13").
 */
export function formatDate(input: DateInput, opts: Omit<FormatOptions, 'precision'> = {}): string {
    return formatDateTime(input, { ...opts, precision: 'date' });
}

/**
 * Relative-time formatter (Chinese), CST-anchored.
 *
 * @example
 *   formatRelative(new Date(Date.now() - 30_000))      // '刚刚'
 *   formatRelative(new Date(Date.now() - 5*60_000))    // '5 分钟前'
 *   formatRelative(new Date(Date.now() + 3*86400_000)) // '3 天后'
 */
export function formatRelative(
    input: DateInput,
    now: DateInput = new Date(),
    opts: { fallback?: string } = {},
): string {
    const d = parseDate(input);
    if (!d) return opts.fallback ?? '—';
    const n = parseDate(now) || new Date();
    const diff = d.getTime() - n.getTime();
    const absMs = Math.abs(diff);
    const future = diff > 0;
    const seconds = Math.floor(absMs / 1000);
    if (seconds < 30) return '刚刚';
    if (seconds < 60) return future ? `${seconds} 秒后` : `${seconds} 秒前`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return future ? `${minutes} 分钟后` : `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return future ? `${hours} 小时后` : `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 30) return future ? `${days} 天后` : `${days} 天前`;
    const months = Math.floor(days / 30);
    if (months < 12) return future ? `${months} 个月后` : `${months} 个月前`;
    const years = Math.floor(days / 365);
    return future ? `${years} 年后` : `${years} 年前`;
}

/**
 * Convenience: "2026-05-21 18:30 · 3 天前" combo. Returns parts so callers
 * can decide how to lay them out (badge, tooltip, etc).
 */
export function formatDateTimeWithRelative(
    input: DateInput,
    now: DateInput = new Date(),
    opts: FormatOptions = {},
): { absolute: string; relative: string; valid: boolean } {
    const d = parseDate(input);
    if (!d) {
        const fb = opts.fallback ?? '—';
        return { absolute: fb, relative: fb, valid: false };
    }
    return {
        absolute: formatDateTime(d, opts),
        relative: formatRelative(d, now),
        valid: true,
    };
}

/**
 * Format a duration in human-friendly Chinese. Accepts milliseconds OR a
 * `{ from, to }` pair.
 *
 * @example
 *   formatDuration(90_000)                          // '1 分 30 秒'
 *   formatDuration({ from: tStart, to: tEnd })      // '2 小时 5 分'
 */
export function formatDuration(
    spec: number | { from: DateInput; to: DateInput },
    opts: { fallback?: string } = {},
): string {
    let ms: number;
    if (typeof spec === 'number') ms = spec;
    else {
        const a = parseDate(spec.from);
        const b = parseDate(spec.to);
        if (!a || !b) return opts.fallback ?? '—';
        ms = Math.abs(b.getTime() - a.getTime());
    }
    if (ms < 1000) return `${ms} 毫秒`;
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts: string[] = [];
    if (days > 0) parts.push(`${days} 天`);
    if (hours > 0) parts.push(`${hours} 小时`);
    if (minutes > 0 && days === 0) parts.push(`${minutes} 分`);
    if (seconds > 0 && days === 0 && hours === 0) parts.push(`${seconds} 秒`);
    return parts.join(' ') || '0 秒';
}

/**
 * Test whether `target` is "today" in Beijing time. Useful for "今日截止"
 * style highlight badges.
 */
export function isToday(target: DateInput, now: DateInput = new Date()): boolean {
    const a = parseDate(target);
    const b = parseDate(now);
    if (!a || !b) return false;
    const aCst = shiftToCst(a);
    const bCst = shiftToCst(b);
    return aCst.getUTCFullYear() === bCst.getUTCFullYear()
        && aCst.getUTCMonth() === bCst.getUTCMonth()
        && aCst.getUTCDate() === bCst.getUTCDate();
}

/**
 * Days until `target`, anchored on Beijing day boundaries. Negative if past.
 */
export function daysUntil(target: DateInput, now: DateInput = new Date()): number {
    const a = parseDate(target);
    const b = parseDate(now);
    if (!a || !b) return 0;
    const aCst = shiftToCst(a);
    const bCst = shiftToCst(b);
    const aDayUtc = Date.UTC(aCst.getUTCFullYear(), aCst.getUTCMonth(), aCst.getUTCDate());
    const bDayUtc = Date.UTC(bCst.getUTCFullYear(), bCst.getUTCMonth(), bCst.getUTCDate());
    return Math.round((aDayUtc - bDayUtc) / (1000 * 60 * 60 * 24));
}
