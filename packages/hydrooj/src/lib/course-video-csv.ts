// eslint-disable-next-line no-control-regex
const CSV_INVISIBLE_PREFIX = /[\u0000-\u001F\u007F\u200B-\u200D\uFEFF\u00AD\u2060\u2800]/g;

export function csvCell(value: string | number): string {
    const raw = String(value);
    const stripped = raw.replace(CSV_INVISIBLE_PREFIX, '').replace(/^\s+/, '');
    const neutralized = typeof value === 'string' && (/^[\t\r]/.test(raw) || /^[=+\-@]/.test(stripped)) ? `'${raw}` : raw;
    return /[",\r\n\t]/.test(neutralized) ? `"${neutralized.replaceAll('"', '""')}"` : neutralized;
}

export function csvTable(headers: string[], rows: Array<Array<string | number>>): string {
    const lines = [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))];
    return `\uFEFF${lines.join('\r\n')}\r\n`;
}
