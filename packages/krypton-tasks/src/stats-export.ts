export interface TaskStatsCsvRow {
    userId: number;
    username: string;
    studentId: string;
    realName: string;
    status: string;
    completedNodes: number;
    totalNodes: number;
    completedAt: string;
    note: string;
}

const CSV_HEADERS = ['uid', 'uname', 'studentId', 'realName', 'status', 'completedNodes', 'totalNodes', 'completedAt', 'note'];

function csvCell(value: string | number): string {
    const raw = String(value).replace(/\r\n|\r|\n/g, '\r\n');
    const protectedValue = /^[\t \r\n]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${protectedValue.replace(/"/g, '""')}"`;
}

export function buildTaskStatsCsv(rows: TaskStatsCsvRow[]): string {
    const lines = [CSV_HEADERS.map(csvCell).join(',')];
    for (const row of rows) {
        lines.push(
            [row.userId, row.username, row.studentId, row.realName, row.status, row.completedNodes, row.totalNodes, row.completedAt, row.note]
                .map(csvCell)
                .join(','),
        );
    }
    return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function shanghaiNaturalDate(value = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(value);
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
}

export function defaultTaskGroupName(title: string, value = new Date()): string {
    return `${title.trim()} ${shanghaiNaturalDate(value)}`.trim();
}
