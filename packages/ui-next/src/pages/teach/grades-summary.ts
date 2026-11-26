import { gradeCellValue, xlsxSheetName } from '@/lib/xlsx';
import type { XlsxCell, XlsxSheet } from '@/lib/xlsx';
import { gradesSheet } from '@/pages/teach/grades-load';
import type { ReadyGrades } from '@/pages/teach/grades-load';
import type { GradeRow } from '@/pages/teach/grades-model';

export interface SummaryItem {
  title: string;
  grades: ReadyGrades;
}

interface SummaryPerson {
  studentId: string;
  name: string;
  scores: Array<number | null>;
}

function invalid(message: string): never {
  throw new TypeError(message);
}

function numericTotal(text: string): number | null {
  const cell = gradeCellValue(text);
  return typeof cell === 'number' ? cell : null;
}

/** Three decimal places, same as formatScore, so 0.1 + 0.2 stays 0.3. */
function summedTotal(scores: readonly (number | null)[]): number {
  const sum = scores.reduce<number>((total, score) => total + (score ?? 0), 0);
  if (!Number.isFinite(sum)) invalid('总表合计无效');
  const scaled = Math.round(sum * 1000) / 1000;
  return Object.is(scaled, -0) ? 0 : scaled;
}

function personKey(studentId: string, name: string): string {
  if (studentId !== '') return `id\u0000${studentId}`;
  return `name\u0000${name}`;
}

/** Ids sort as text. People without an id follow, ordered by zh-CN name. */
function comparePeople(left: SummaryPerson, right: SummaryPerson): number {
  const leftId = left.studentId !== '';
  const rightId = right.studentId !== '';
  if (leftId && rightId) {
    if (left.studentId < right.studentId) return -1;
    if (left.studentId > right.studentId) return 1;
    return 0;
  }
  if (!leftId && !rightId) return left.name.localeCompare(right.name, 'zh-CN');
  return leftId ? -1 : 1;
}

function rowTotal(row: GradeRow, where: string): { studentId: string; name: string; total: number | null } {
  if (typeof row !== 'object' || row === null) invalid(`总表学生无效：${where}`);
  if (typeof row.studentId !== 'string' || typeof row.name !== 'string') invalid(`总表学生无效：${where}`);
  if (typeof row.cells !== 'object' || row.cells === null) invalid(`总表总分缺失：${where}`);
  const total = row.cells.total;
  if (typeof total !== 'string') invalid(`总表总分缺失：${where}`);
  return { studentId: row.studentId, name: row.name, total: numericTotal(total) };
}

function summarySheet(items: readonly SummaryItem[]): XlsxSheet {
  const titles = items.map((item, index) => {
    if (typeof item !== 'object' || item === null || typeof item.title !== 'string') invalid(`总表标题无效：${index + 1}`);
    return item.title;
  });
  const people = new Map<string, SummaryPerson>();
  items.forEach((item, itemIndex) => {
    const where = titles[itemIndex] ?? String(itemIndex + 1);
    if (typeof item.grades !== 'object' || item.grades === null || !Array.isArray(item.grades.rows)) {
      invalid(`总表成绩无效：${where}`);
    }
    const seen = new Set<string>();
    for (const row of item.grades.rows) {
      const read = rowTotal(row, where);
      const key = personKey(read.studentId, read.name);
      if (seen.has(key)) invalid(`总表出现重复的学生：${where}`);
      seen.add(key);
      let person = people.get(key);
      if (person === undefined) {
        person = {
          studentId: read.studentId,
          name: read.name,
          scores: items.map(() => null),
        };
        people.set(key, person);
      }
      const scores = person.scores;
      scores[itemIndex] = read.total;
    }
  });
  const header: XlsxCell[] = ['学号', '姓名', ...titles, '合计'];
  const rows = [...people.values()].sort(comparePeople).map((person): XlsxCell[] => (
    [person.studentId, person.name, ...person.scores, summedTotal(person.scores)]
  ));
  return { name: '总表', rows: [header, ...rows] };
}

function detailSheet(item: SummaryItem, index: number, taken: Set<string>): XlsxSheet {
  if (typeof item !== 'object' || item === null) invalid(`总表标题无效：${index + 1}`);
  if (typeof item.grades !== 'object' || item.grades === null) invalid(`总表成绩无效：${index + 1}`);
  const sheet = gradesSheet(item.title, item.grades.columns, item.grades.rows);
  const name = xlsxSheetName(item.title, taken);
  taken.add(name);
  return { name, rows: sheet.rows };
}

/** First sheet is the union summary. Later sheets match one grades export, with unique names. */
export function summarySheets(items: readonly SummaryItem[]): XlsxSheet[] {
  if (!Array.isArray(items)) invalid('总表项目无效');
  const summary = summarySheet(items);
  const taken = new Set<string>([summary.name]);
  return [summary, ...items.map((item, index) => detailSheet(item, index, taken))];
}
