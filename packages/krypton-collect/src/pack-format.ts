/** Zip entry names and teacher CSV/manifest for collect pack download. */
import { renderPackEntryName, sanitizeZipPart } from './name-format';

export { sanitizeZipPart };

export function zipStudentFolder(student: { studentId?: string; realName?: string; uid: number }): string {
    if (student.studentId) return `${student.studentId}-${sanitizeZipPart(student.realName ?? '')}`;
    return `unbound-UID${student.uid}`;
}

export function zipEntryName(folder: string, slotTitle: string, originalName: string): string {
    return renderPackEntryName('nested', folder, slotTitle, sanitizeZipPart(originalName));
}

const CSV_INVISIBLE_PREFIX = /[\u0000-\u001F\u007F\u200B-\u200D\uFEFF\u00AD\u2060\u2800]/g;

export function csvCell(value: string | number): string {
    const raw = String(value);
    const stripped = raw.replace(CSV_INVISIBLE_PREFIX, '').replace(/^\s+/, '');
    const neutralized = typeof value === 'string' && (/^[\t\r]/.test(raw) || /^[=+\-@]/.test(stripped)) ? `'${raw}` : raw;
    return /[",\r\n\t]/.test(neutralized) ? `"${neutralized.replaceAll('"', '""')}"` : neutralized;
}

function csvTable(headers: string[], rows: Array<Array<string | number>>): string {
    const lines = [
        headers.map(csvCell).join(','),
        ...rows.map((row) => row.map(csvCell).join(',')),
    ];
    return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function buildMissingCsv(rows: { studentId: string; realName: string; uid: number; slotTitle: string; assignedName: string }[]): string {
    return csvTable(
        ['学号', '姓名', 'UID', '槽位', '预期文件名'],
        rows.map((row) => [row.studentId, row.realName, row.uid, row.slotTitle, row.assignedName]),
    );
}

export function buildSubmittedCsv(rows: {
    studentId: string;
    realName: string;
    uid: number;
    slotTitle: string;
    assignedName: string;
    originalName: string;
    sha256: string;
    size: number;
}[]): string {
    return csvTable(
        ['学号', '姓名', 'UID', '槽位', '文件名', '原文件名', 'sha256', 'size'],
        rows.map((row) => [row.studentId, row.realName, row.uid, row.slotTitle, row.assignedName, row.originalName, row.sha256, row.size]),
    );
}

export function buildManifest(entries: { name: string; sha256: string; size: number }[]): string {
    const lines = [
        ['name', 'sha256', 'size'].map(csvCell).join(','),
        ...entries.map((entry) => [entry.name, entry.sha256, entry.size].map(csvCell).join(',')),
    ];
    return `${lines.join('\r\n')}\r\n`;
}
