/** Zip entry names and teacher CSV/manifest for collect pack download. */

// Zip parts cannot contain separators, reserved filename chars, or C0 controls.
// eslint-disable-next-line no-control-regex
const INVALID_ZIP_PART_CHARS = /[\\/:*?"<>|\x00-\x1F]/g;

export function sanitizeZipPart(value: string): string {
    const sanitized = value.replace(INVALID_ZIP_PART_CHARS, '_').replace(/\s+/g, ' ').trim();
    if (!sanitized || sanitized === '.' || sanitized === '..') return '_';
    return sanitized;
}

export function zipStudentFolder(student: { studentId?: string; realName?: string; uid: number }): string {
    if (student.studentId) return `${student.studentId}-${sanitizeZipPart(student.realName ?? '')}`;
    return `unbound-UID${student.uid}`;
}

export function zipEntryName(folder: string, slotTitle: string, originalName: string): string {
    return `${sanitizeZipPart(folder)}/${sanitizeZipPart(slotTitle)}/${sanitizeZipPart(originalName)}`;
}

export function csvCell(value: string | number): string {
    const raw = String(value);
    const neutralized = typeof value === 'string' && (/^[\t\r]/.test(raw) || /^\s*[=+\-@]/.test(raw)) ? `'${raw}` : raw;
    return /[",\r\n\t]/.test(neutralized) ? `"${neutralized.replaceAll('"', '""')}"` : neutralized;
}

export function buildMissingCsv(rows: { studentId: string; realName: string; uid: number }[]): string {
    const lines = [
        ['学号', '姓名', 'UID'].map(csvCell).join(','),
        ...rows.map((row) => [row.studentId, row.realName, row.uid].map(csvCell).join(',')),
    ];
    return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function buildManifest(entries: { name: string; sha256: string; size: number }[]): string {
    const lines = [
        ['name', 'sha256', 'size'].map(csvCell).join(','),
        ...entries.map((entry) => [entry.name, entry.sha256, entry.size].map(csvCell).join(',')),
    ];
    return `${lines.join('\r\n')}\r\n`;
}
