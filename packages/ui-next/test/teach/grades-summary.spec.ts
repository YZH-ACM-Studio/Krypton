// @vitest-environment node
// grades-summary.ts is the new module and may be absent until the export lands.
import { describe, expect, it } from 'vitest';
import { gradesSheet, type ReadyGrades } from '../../src/pages/teach/grades-load.ts';
import type { GradeColumn, GradeRow } from '../../src/pages/teach/grades-model.ts';

const summaryLoaders = import.meta.glob('../../src/pages/teach/grades-summary.ts');
const SUMMARY_SOURCE = 'src/pages/teach/grades-summary.ts';
const DASH = '\u2014';

type SheetCell = string | number | null;

interface BuiltSheet {
  name: string;
  rows: SheetCell[][];
}

interface SummaryItem {
  title: string;
  grades: ReadyGrades;
}

type SummarySheets = (items: SummaryItem[]) => unknown;

const COLUMNS: GradeColumn[] = [
  { key: 'studentId', header: '学号', align: 'left' },
  { key: 'name', header: '姓名', align: 'left' },
  { key: 'group', header: '用户组', align: 'left' },
  { key: 'total', header: '总分', align: 'right' },
];

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key);
}

function moduleLoader(loaders: object, source: string): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(loaders)) {
    if (!key.endsWith(source)) continue;
    if (typeof load !== 'function') return undefined;
    return load as () => Promise<unknown>;
  }
  return undefined;
}

async function loadSummarySheets(): Promise<SummarySheets> {
  const load = moduleLoader(summaryLoaders, SUMMARY_SOURCE);
  expect(typeof load, `${SUMMARY_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${SUMMARY_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${SUMMARY_SOURCE} must be a module`);
  const summarySheets = readField(imported, 'summarySheets');
  expect(typeof summarySheets, 'summarySheets').toBe('function');
  if (typeof summarySheets !== 'function') throw new TypeError('summarySheets must be a function');
  return summarySheets as SummarySheets;
}

function cellValue(value: unknown, where: string): SheetCell {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  throw new TypeError(`${where} must be text, a number, or null`);
}

function readSheet(value: unknown): BuiltSheet {
  if (typeof value !== 'object' || value === null) throw new TypeError('summary sheet is missing');
  const name = Reflect.get(value, 'name');
  const rows = Reflect.get(value, 'rows');
  if (typeof name !== 'string') throw new TypeError('summary sheet name is missing');
  if (!Array.isArray(rows)) throw new TypeError('summary sheet rows are missing');
  return {
    name,
    rows: rows.map((row, rowIndex) => {
      if (!Array.isArray(row)) throw new TypeError(`summary sheet row ${rowIndex + 1} is not an array`);
      return row.map((cell, columnIndex) => cellValue(cell, `summary sheet row ${rowIndex + 1} column ${columnIndex + 1}`));
    }),
  };
}

function readSheets(value: unknown): BuiltSheet[] {
  if (!Array.isArray(value)) throw new TypeError('summarySheets must return a list of sheets');
  return value.map((sheet) => readSheet(sheet));
}

function gradeRow(studentId: string, name: string, total: string, group = ''): GradeRow {
  return {
    key: `${studentId}:${name}:${total}`,
    studentId,
    name,
    groupNames: group,
    groupIds: [],
    searchText: `${studentId}\n${name}`,
    cells: {
      studentId, name, group, total,
    },
    tones: {},
    attempts: {},
  };
}

function ready(rows: GradeRow[], columns: GradeColumn[] = COLUMNS): ReadyGrades {
  return {
    columns,
    rows,
    groups: [],
    truncated: false,
    practice: null,
  };
}

describe('teach grades summary sheets', () => {
  it('builds the union summary in student-id order and one sheet per set', async () => {
    const summarySheets = await loadSummarySheets();
    const titleA = 'A';
    const titleB = 'B';
    const rowsA = [gradeRow('S2024003', '张三', '90', '计科 2401'), gradeRow('S2024001', '李四', '80', '计科 2401')];
    const rowsB = [gradeRow('S2024002', '王五', '60', '软工 2501'), gradeRow('S2024003', '张三', '70', '计科 2401')];

    const sheets = readSheets(summarySheets([
      { title: titleA, grades: ready(rowsA) },
      { title: titleB, grades: ready(rowsB) },
    ]));

    expect(sheets).toEqual([
      {
        name: '总表',
        rows: [
          ['学号', '姓名', titleA, titleB, '合计'],
          ['S2024001', '李四', 80, null, 80],
          ['S2024002', '王五', null, 60, 60],
          ['S2024003', '张三', 90, 70, 160],
        ],
      },
      readSheet(gradesSheet(titleA, COLUMNS, rowsA)),
      readSheet(gradesSheet(titleB, COLUMNS, rowsB)),
    ]);
  });

  it('sorts people by student id even when names would sort the other way', async () => {
    const summarySheets = await loadSummarySheets();
    const rows = [gradeRow('S2', '李四', '20'), gradeRow('S1', '张三', '10')];
    const sheets = readSheets(summarySheets([{ title: 'A', grades: ready(rows) }]));
    expect(sheets[0]?.rows).toEqual([
      ['学号', '姓名', 'A', '合计'],
      ['S1', '张三', 10, 10],
      ['S2', '李四', 20, 20],
    ]);
  });

  it('merges people with no student id by name and sorts those names in zh-CN order', async () => {
    const summarySheets = await loadSummarySheets();
    // 陈一 / 李一 share a pinyin order that is the reverse of their code points.
    const rowsA = [
      gradeRow('', '王五', '5'),
      gradeRow('', '张三', '7'),
      gradeRow('', '李四', '6'),
      gradeRow('', '李一', '3'),
      gradeRow('', '陈一', '2'),
    ];
    const rowsB = [gradeRow('', '李四', '4'), gradeRow('', '王五', '1')];
    const sheets = readSheets(summarySheets([
      { title: 'A', grades: ready(rowsA) },
      { title: 'B', grades: ready(rowsB) },
    ]));
    expect(sheets[0]?.rows).toEqual([
      ['学号', '姓名', 'A', 'B', '合计'],
      ['', '陈一', 2, null, 2],
      ['', '李四', 6, 4, 10],
      ['', '李一', 3, null, 3],
      ['', '王五', 5, 1, 6],
      ['', '张三', 7, null, 7],
    ]);
  });

  it('leaves a non-numeric total blank and counts it as zero', async () => {
    const summarySheets = await loadSummarySheets();
    const rowsA = [
      gradeRow('S1', '甲', '87.5'),
      gradeRow('S2', '乙', '未提交'),
      gradeRow('S3', '丙', DASH),
    ];
    const rowsB = [
      gradeRow('S2', '乙', '40'),
      gradeRow('S3', '丙', ''),
    ];
    const sheets = readSheets(summarySheets([
      { title: 'A', grades: ready(rowsA) },
      { title: 'B', grades: ready(rowsB) },
    ]));
    expect(sheets[0]?.rows).toEqual([
      ['学号', '姓名', 'A', 'B', '合计'],
      ['S1', '甲', 87.5, null, 87.5],
      ['S2', '乙', null, 40, 40],
      ['S3', '丙', null, null, 0],
    ]);
  });

  it('adds decimal totals as exact tenths instead of a binary residue', async () => {
    const summarySheets = await loadSummarySheets();
    const sheets = readSheets(summarySheets([
      { title: 'A', grades: ready([gradeRow('S1', '甲', '0.1')]) },
      { title: 'B', grades: ready([gradeRow('S1', '甲', '0.2')]) },
    ]));
    const total = sheets[0]?.rows[1]?.[4];
    expect(total).toBe(0.3);
    expect(total).not.toBe(0.30000000000000004);
  });

  it('keeps the raw title on the summary header and the grades sheet name on the detail sheet', async () => {
    const summarySheets = await loadSummarySheets();
    const title = '第一章：循环/数组[期中]';
    const rows = [gradeRow('S1', '张三', '95', '计科 2401')];
    const sheets = readSheets(summarySheets([{ title, grades: ready(rows) }]));
    expect(sheets[0]?.rows[0]?.[2]).toBe(title);
    expect(sheets[1]).toEqual(readSheet(gradesSheet(title, COLUMNS, rows)));
    expect(sheets[1]?.name).toBe('第一章循环数组期中');
  });

  it('lists people with a student id before people who only have a name', async () => {
    const summarySheets = await loadSummarySheets();
    const rows = [
      gradeRow('', '王五', '5'),
      gradeRow('S2', '张三', '20'),
      gradeRow('', '李四', '6'),
      gradeRow('S1', '赵六', '10'),
    ];
    const sheets = readSheets(summarySheets([{ title: 'A', grades: ready(rows) }]));
    expect(sheets[0]?.rows).toEqual([
      ['学号', '姓名', 'A', '合计'],
      ['S1', '赵六', 10, 10],
      ['S2', '张三', 20, 20],
      ['', '李四', 6, 6],
      ['', '王五', 5, 5],
    ]);
  });

  it('keeps students who share a name but not a student id on separate rows', async () => {
    const summarySheets = await loadSummarySheets();
    const sheets = readSheets(summarySheets([
      { title: 'A', grades: ready([gradeRow('S1', '张三', '90')]) },
      { title: 'B', grades: ready([gradeRow('S2', '张三', '80')]) },
    ]));
    expect(sheets[0]?.rows).toEqual([
      ['学号', '姓名', 'A', 'B', '合计'],
      ['S1', '张三', 90, null, 90],
      ['S2', '张三', null, 80, 80],
    ]);
  });

  it('suffixes detail sheet names that repeat a title or the summary name', async () => {
    const summarySheets = await loadSummarySheets();
    const rows = [gradeRow('S1', '张三', '90')];
    const duplicated = readSheets(summarySheets([
      { title: '期中作业', grades: ready(rows) },
      { title: '期中作业', grades: ready(rows) },
    ]));
    expect(duplicated.map((sheet) => sheet.name)).toEqual(['总表', '期中作业', '期中作业 (2)']);
    expect(new Set(duplicated.map((sheet) => sheet.name)).size).toBe(duplicated.length);

    const clashes = readSheets(summarySheets([
      { title: '总表', grades: ready(rows) },
    ]));
    expect(clashes.map((sheet) => sheet.name)).toEqual(['总表', '总表 (2)']);
    expect(new Set(clashes.map((sheet) => sheet.name)).size).toBe(clashes.length);
  });

  it('rejects one set that lists the same student twice instead of keeping a single score', async () => {
    const summarySheets = await loadSummarySheets();
    const rows = [gradeRow('S1', '张三', '90'), gradeRow('S1', '张三', '10')];
    expect(() => summarySheets([{ title: 'A', grades: ready(rows) }])).toThrow(TypeError);
  });
});
