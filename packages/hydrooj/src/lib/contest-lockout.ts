import type { Tdoc } from '../interface';

function validDate(value: unknown, field: string): Date {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError(`Contest ${field} must be a valid Date.`);
    return value;
}

function lockoutMinutes(value: unknown, fallback: number, field: string): number {
    if (value === null || value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new TypeError(`Contest ${field} must be a nonnegative safe integer.`);
    }
    return value as number;
}

/**
 * Canonical wall-clock lockout window for client-required contests.
 * Both Vigil and post-contest practice must use this exact calculation.
 */
export function effectiveLockoutWindow(tdoc: Tdoc): { blockStart: Date; blockEnd: Date } | null {
    if (tdoc.entryMode !== 'client_required') return null;
    const beginAt = validDate(tdoc.beginAt, 'beginAt');
    const endAt = validDate(tdoc.endAt, 'endAt');
    if (beginAt >= endAt) throw new TypeError('Contest beginAt must be before endAt.');
    const beforeMin = lockoutMinutes(tdoc.clientLoginBlockBeforeMinutes, 60, 'clientLoginBlockBeforeMinutes');
    const afterMin = lockoutMinutes(tdoc.clientLoginBlockAfterMinutes, 30, 'clientLoginBlockAfterMinutes');
    const blockStart = new Date(beginAt.getTime() - beforeMin * 60_000);
    const blockEnd = new Date(endAt.getTime() + afterMin * 60_000);
    if (Number.isNaN(blockStart.getTime()) || Number.isNaN(blockEnd.getTime()) || blockEnd < endAt) {
        throw new TypeError('Contest lockout window is outside the supported Date range.');
    }
    return { blockStart, blockEnd };
}
