// @vitest-environment node
// A static import fails collection while src/pages/teach/grades-model.ts is absent.
import type { ProblemKind, TeachType } from '@hydrooj/common';
import { describe, expect, it } from 'vitest';
import type { TeachPaper, TeachParticipant, TeachParticipantsPayload } from '../../src/pages/teach/model.ts';
import { paperFromPayload, type PaperState } from '../../src/pages/teach/paper.ts';

const modelLoaders = import.meta.glob('../../src/pages/teach/grades-model.ts');
const MODEL_SOURCE = 'src/pages/teach/grades-model.ts';

const DASH = '\u2014';
const DOT = '\u00B7';
const CHECK = '<span class="icon icon-check"></span>\n00:01:02';

/** lockAt pending markup written by contest scoreboard rows. */
function pendingMarkup(count: number): string {
  return `<span style="color:orange">+${count}</span>`;
}

interface BoardCell {
  type: string;
  value?: string | number;
  raw?: unknown;
  score?: number;
  hover?: string;
  team?: { name: string; captainUid: number; memberUids: number[] };
}

interface GradeColumn {
  key: string;
  header: string;
  align: 'left' | 'right' | 'center';
}

interface GradeRow {
  key: string;
  studentId: string;
  name: string;
  groupNames: string;
  groupIds: string[];
  cells: Record<string, string>;
  tones: Record<string, 'success' | 'danger' | null>;
}

interface ScoreCell {
  value: string;
  score: number | null;
}

interface ScoreRow {
  uid: number | null;
  teamName: string | null;
  teamMemberUids: number[];
  rank: string;
  cells: Map<number, ScoreCell>;
  total: string;
  solved: string | null;
  penalty: string | null;
}

interface ScoreboardTable {
  columns: Array<{ docId: number; header: string }>;
  rows: ScoreRow[];
}

interface GradesApi {
  parseScoreboard: (raw: unknown) => ScoreboardTable;
  buildGrades: (input: {
    type: TeachType;
    rule: string;
    paper: PaperState;
    participants: TeachParticipantsPayload | null;
    board: ScoreboardTable | null;
    roster: unknown | null;
    groupsById: Map<string, string>;
  }) => { columns: GradeColumn[]; rows: GradeRow[] };
  gradesCsv: (columns: GradeColumn[], rows: GradeRow[]) => string;
}

interface RosterMember {
  uid: number;
  uname: string;
  realName: string;
  studentId: string;
  groups: string[];
  groupIds: string[];
  done: number;
  total: number;
  completedPids: number[];
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asFunction<Fn extends (...args: never[]) => unknown>(value: unknown, key: string): Fn {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as Fn;
}

function moduleLoader(loaders: object, source: string): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(loaders)) {
    if (!key.endsWith(source)) continue;
    if (typeof load !== 'function') return undefined;
    return load as () => Promise<unknown>;
  }
  return undefined;
}

async function loadModule(loaders: object, source: string): Promise<object> {
  const load = moduleLoader(loaders, source);
  expect(typeof load, `${source} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${source} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${source} must be a module`);
  return imported;
}

async function loadGrades(): Promise<GradesApi> {
  const model = await loadModule(modelLoaders, MODEL_SOURCE);
  return {
    parseScoreboard: asFunction<GradesApi['parseScoreboard']>(readField(model, 'parseScoreboard'), 'parseScoreboard'),
    buildGrades: asFunction<GradesApi['buildGrades']>(readField(model, 'buildGrades'), 'buildGrades'),
    gradesCsv: asFunction<GradesApi['gradesCsv']>(readField(model, 'gradesCsv'), 'gradesCsv'),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readColumn(value: unknown, index: number): GradeColumn {
  if (!isRecord(value)) throw new TypeError(`column ${index} is missing`);
  const { key, header, align } = value;
  if (typeof key !== 'string' || typeof header !== 'string') throw new TypeError(`column ${index} is missing a header`);
  if (align !== 'left' && align !== 'right' && align !== 'center') throw new TypeError(`column ${index} align`);
  return { key, header, align };
}

function readCells(value: unknown): Record<string, string> {
  if (!isRecord(value)) throw new TypeError('grade cells must be a record');
  const cells: Record<string, string> = {};
  for (const [key, cell] of Object.entries(value)) {
    if (typeof cell !== 'string') throw new TypeError(`grade cell ${key} must be a string`);
    cells[key] = cell;
  }
  return cells;
}

function readTones(value: unknown): GradeRow['tones'] {
  if (!isRecord(value)) throw new TypeError('grade tones must be a record');
  const tones: GradeRow['tones'] = {};
  for (const [key, tone] of Object.entries(value)) {
    if (tone !== 'success' && tone !== 'danger' && tone !== null) throw new TypeError(`grade tone ${key}`);
    tones[key] = tone;
  }
  return tones;
}

function readStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new TypeError(label);
  return value.slice();
}

function readRow(value: unknown, index: number): GradeRow {
  if (!isRecord(value)) throw new TypeError(`grade row ${index} is missing`);
  const { key, studentId, name, groupNames } = value;
  if (typeof key !== 'string' || key === '') throw new TypeError(`grade row ${index} key`);
  if (typeof studentId !== 'string' || typeof name !== 'string' || typeof groupNames !== 'string') {
    throw new TypeError(`grade row ${index} identity`);
  }
  return {
    key,
    studentId,
    name,
    groupNames,
    groupIds: readStringList(value.groupIds, `grade row ${index} groups`),
    cells: readCells(value.cells),
    tones: readTones(value.tones),
  };
}

function readTable(value: unknown): { columns: GradeColumn[]; rows: GradeRow[] } {
  if (!isRecord(value) || !Array.isArray(value.columns) || !Array.isArray(value.rows)) {
    throw new TypeError('buildGrades must return columns and rows');
  }
  return {
    columns: value.columns.map((column, index) => readColumn(column, index)),
    rows: value.rows.map((row, index) => readRow(row, index)),
  };
}

function problem(docId: number, kind: ProblemKind, score: number | null): TeachPaper['problems'][number] {
  return {
    docId,
    pid: `P${docId}`,
    title: `题目 ${docId}`,
    kind,
    score,
    hidden: false,
    mine: false,
    difficulty: null,
  };
}

function stage(id: number, title: string, pids: number[]): NonNullable<TeachPaper['stages']>[number] {
  return { id, title, requireIds: [], pids };
}

function paperOf(
  type: TeachType,
  rule: string,
  problems: TeachPaper['problems'],
  stages: TeachPaper['stages'] = null,
  quotas: TeachPaper['examPaperQuotas'] = null,
): PaperState {
  return paperFromPayload({ problems, stages, examPaperQuotas: quotas }, { type, rule });
}

function person(partial: Pick<TeachParticipant, 'uid' | 'studentId' | 'realName'> & Partial<TeachParticipant>): TeachParticipant {
  return {
    uname: `user${partial.uid}`,
    groupIds: [],
    attended: true,
    startAt: null,
    finalizedAt: null,
    lastSubmitAt: null,
    late: false,
    ...partial,
  };
}

function people(list: TeachParticipant[], groups: TeachParticipantsPayload['groups'] = []): TeachParticipantsPayload {
  return { participants: list, groups };
}

function scoreCell(value: string, score?: number): BoardCell {
  // Real scoreboard record cells also carry hover. A parser must tolerate it.
  const cell: BoardCell = { type: 'record', value, hover: '' };
  if (score !== undefined) cell.score = score;
  return cell;
}

function scoreboard(rows: BoardCell[][]): { rows: BoardCell[][] } {
  return { rows };
}

function requireColumn(columns: GradeColumn[], header: string): GradeColumn {
  const column = columns.find((item) => item.header === header);
  expect(column, header).toBeTruthy();
  if (!column) throw new TypeError(`missing column ${header}`);
  return column;
}

function cellText(row: GradeRow, columns: GradeColumn[], header: string): string {
  const column = requireColumn(columns, header);
  expect(Object.hasOwn(row.cells, column.key), header).toBe(true);
  return row.cells[column.key] ?? '';
}

function toneAt(row: GradeRow, columns: GradeColumn[], header: string): 'success' | 'danger' | null {
  const column = requireColumn(columns, header);
  return row.tones[column.key] ?? null;
}

function rowNamed(rows: GradeRow[], name: string): GradeRow {
  const row = rows.find((item) => item.name === name);
  expect(row, name).toBeTruthy();
  if (!row) throw new TypeError(`missing row ${name}`);
  return row;
}

function headers(columns: GradeColumn[]): string[] {
  return columns.map((column) => column.header);
}

function penalty(solved: string, time: string): string {
  return `${solved} ${DOT} ${time}`;
}

async function gradesFor(input: {
  type: TeachType;
  rule: string;
  paper: PaperState;
  participants: TeachParticipantsPayload | null;
  board: { rows: BoardCell[][] } | null;
  roster: unknown | null;
  groupsById: Map<string, string>;
}): Promise<{ columns: GradeColumn[]; rows: GradeRow[] }> {
  const api = await loadGrades();
  const board = input.board === null ? null : api.parseScoreboard(input.board);
  return readTable(api.buildGrades({
    type: input.type,
    rule: input.rule,
    paper: input.paper,
    participants: input.participants,
    board,
    roster: input.roster,
    groupsById: input.groupsById,
  }));
}

function csvBody(csv: string): string {
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  return csv.slice(1).replaceAll('\r\n', '\n');
}

function csvLines(csv: string): string[] {
  const lines = csvBody(csv).split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function sheetColumn(key: string, header: string): GradeColumn {
  return { key, header, align: 'left' };
}

function sheetRow(cells: Record<string, string>): GradeRow {
  return {
    key: 'row-1',
    studentId: '',
    name: '',
    groupNames: '',
    groupIds: [],
    cells,
    tones: {},
  };
}

describe('teach grades model', () => {
  it('orders oi columns and rows by numeric rank', async () => {
    const groupsById = new Map([['g1', '计科 2401']]);
    const table = await gradesFor({
      type: 'oi',
      rule: 'oi',
      paper: paperOf('oi', 'oi', [
        problem(101, 'programming', 100),
        problem(102, 'programming', 100),
        problem(103, 'programming', 100),
      ]),
      participants: people([
        person({ uid: 20, uname: 'wanghao', studentId: '240200', realName: '王浩然', groupIds: ['g1'] }),
        person({ uid: 30, studentId: '240100', realName: '李明' }),
        person({ uid: 40, studentId: '240050', realName: '赵一鸣' }),
        person({ uid: 41, studentId: '240080', realName: '周子涵' }),
      ]),
      board: scoreboard([
        [
          { type: 'rank', value: '#' },
          { type: 'user', value: 'User' },
          { type: 'total_score', value: 'Total Score' },
          { type: 'problem', value: 'A', raw: 101 },
          { type: 'problem', value: 'B', raw: 102 },
          { type: 'problem', value: 'C', raw: 103 },
        ],
        [
          { type: 'rank', value: '2' },
          { type: 'user', value: 'wanghao', raw: 20 },
          { type: 'total_score', value: 100 },
          scoreCell(`100${pendingMarkup(1)}`, 40),
          scoreCell('0', 0),
          scoreCell(`-${pendingMarkup(2)}`),
        ],
        [
          { type: 'rank', value: '10' },
          { type: 'user', value: 'liming', raw: 30 },
          { type: 'total_score', value: 80 },
          scoreCell('40', 40),
          scoreCell('40', 40),
          scoreCell('0', 0),
        ],
        [
          { type: 'rank', value: '1' },
          { type: 'user', value: 'root', raw: 99 },
          { type: 'total_score', value: 100 },
          scoreCell('50', 50),
          scoreCell('50', 50),
          scoreCell('0', 0),
        ],
      ]),
      roster: null,
      groupsById,
    });

    expect(headers(table.columns)).toEqual(['学号', '姓名', '用户组', '#', 'A', 'B', 'C', '总分']);
    expect(table.rows.map((row) => row.name)).toEqual(['root', '王浩然', '李明', '赵一鸣', '周子涵']);
    expect(new Set(table.rows.map((row) => row.key)).size).toBe(table.rows.length);

    const root = rowNamed(table.rows, 'root');
    expect(root.studentId).toBe('');
    expect(root.groupNames).toBe('');
    expect(root.groupIds).toEqual([]);
    expect(cellText(root, table.columns, '#')).toBe('1');

    const wang = rowNamed(table.rows, '王浩然');
    expect(wang.studentId).toBe('240200');
    expect(wang.groupNames).toBe('计科 2401');
    expect(wang.groupIds).toEqual(['g1']);
    expect(cellText(wang, table.columns, '#')).toBe('2');
    expect(cellText(wang, table.columns, 'A')).toBe('100');
    expect(toneAt(wang, table.columns, 'A')).toBe('success');
    expect(cellText(wang, table.columns, 'B')).toBe('0');
    expect(toneAt(wang, table.columns, 'B')).toBe('danger');
    expect(cellText(wang, table.columns, 'C')).toBe(DASH);
    expect(toneAt(wang, table.columns, 'C')).toBeNull();

    expect(cellText(rowNamed(table.rows, '李明'), table.columns, '#')).toBe('10');
    const absent = rowNamed(table.rows, '赵一鸣');
    expect(absent.studentId).toBe('240050');
    expect(cellText(absent, table.columns, 'A')).toBe(DASH);
    expect(cellText(absent, table.columns, 'B')).toBe(DASH);
    expect(cellText(absent, table.columns, '总分')).toBe(DASH);
    expect(toneAt(absent, table.columns, 'A')).toBeNull();
  });

  it('sums undrawn exam kinds and keeps attempt status', async () => {
    const started = '2026-10-24T06:10:00.000Z';
    const table = await gradesFor({
      type: 'exam',
      rule: 'exam',
      paper: paperOf('exam', 'exam', [
        problem(202, 'single', 5),
        problem(203, 'single', 3),
        problem(201, 'true_false', 2),
        problem(204, 'true_false', 2),
        problem(205, 'multi', 4),
      ]),
      participants: people([
        person({
          uid: 12,
          studentId: '240199',
          realName: '赵一鸣',
          groupIds: ['g1'],
          startAt: started,
          finalizedAt: '2026-10-24T07:00:00.000Z',
        }),
        person({ uid: 10, studentId: '240101', realName: '陈思远', groupIds: ['g1'], startAt: started }),
        person({ uid: 11, studentId: '240050', realName: '林雨桐', groupIds: ['g2'] }),
        person({ uid: 8, studentId: '240080', realName: '周子涵', groupIds: ['g2'] }),
      ], [
        { id: 'g1', name: '计科 2401' },
        { id: 'g2', name: '计科 2402' },
      ]),
      board: scoreboard([
        [
          { type: 'rank', value: '#' },
          { type: 'user', value: 'User' },
          { type: 'total_score', value: 'Total Score' },
          { type: 'problem', value: 'A', raw: 202 },
          { type: 'problem', value: 'B', raw: 203 },
          { type: 'problem', value: 'C', raw: 201 },
          { type: 'problem', value: 'D', raw: 204 },
          { type: 'problem', value: 'E', raw: 205 },
        ],
        [
          { type: 'rank', value: '2' },
          { type: 'user', value: 'chen', raw: 10 },
          { type: 'total_score', value: 5 },
          scoreCell(`5${pendingMarkup(1)}`, 100),
          scoreCell('3', 3),
          scoreCell('2', 2),
          scoreCell(`-${pendingMarkup(1)}`),
          scoreCell(`-${pendingMarkup(3)}`),
        ],
        [
          { type: 'rank', value: '1' },
          { type: 'user', value: 'zhao', raw: 12 },
          { type: 'total_score', value: 16 },
          scoreCell('5', 5),
          scoreCell('3', 3),
          scoreCell('2', 2),
          scoreCell('2', 2),
          scoreCell('4', 4),
        ],
        [
          { type: 'rank', value: '10' },
          { type: 'user', value: 'root', raw: 99 },
          { type: 'total_score', value: 0 },
          scoreCell('0', 0),
          scoreCell('0', 0),
          scoreCell('0', 0),
          scoreCell('0', 0),
          scoreCell('0', 0),
        ],
      ]),
      roster: null,
      groupsById: new Map([['g1', '计科 2401'], ['g2', '计科 2402']]),
    });

    expect(headers(table.columns)).toEqual(['学号', '姓名', '用户组', '判断题', '单选题', '多选题', '总分', '状态']);
    expect(table.rows.map((row) => row.name)).toEqual(['赵一鸣', '陈思远', 'root', '林雨桐', '周子涵']);

    const full = rowNamed(table.rows, '赵一鸣');
    expect(full.groupNames).toBe('计科 2401');
    expect(cellText(full, table.columns, '单选题')).toBe('8');
    expect(toneAt(full, table.columns, '单选题')).toBe('success');
    expect(cellText(full, table.columns, '判断题')).toBe('4');
    expect(toneAt(full, table.columns, '判断题')).toBe('success');
    expect(cellText(full, table.columns, '多选题')).toBe('4');
    expect(toneAt(full, table.columns, '多选题')).toBe('success');
    expect(cellText(full, table.columns, '总分')).toBe('16');
    expect(toneAt(full, table.columns, '总分')).toBe('success');
    expect(cellText(full, table.columns, '状态')).toBe('已交卷');

    const partial = rowNamed(table.rows, '陈思远');
    expect(cellText(partial, table.columns, '单选题')).toBe('8');
    expect(toneAt(partial, table.columns, '单选题')).toBe('success');
    expect(cellText(partial, table.columns, '判断题')).toBe('2');
    expect(toneAt(partial, table.columns, '判断题')).toBeNull();
    expect(cellText(partial, table.columns, '多选题')).toBe(DASH);
    expect(toneAt(partial, table.columns, '多选题')).toBeNull();
    expect(cellText(partial, table.columns, '状态')).toBe('作答中');

    const admin = rowNamed(table.rows, 'root');
    expect(admin.studentId).toBe('');
    expect(cellText(admin, table.columns, '单选题')).toBe('0');
    expect(toneAt(admin, table.columns, '单选题')).toBe('danger');
    expect(cellText(admin, table.columns, '状态')).toBe('未开考');

    const missing = rowNamed(table.rows, '林雨桐');
    expect(cellText(missing, table.columns, '单选题')).toBe(DASH);
    expect(cellText(missing, table.columns, '判断题')).toBe(DASH);
    expect(cellText(missing, table.columns, '多选题')).toBe(DASH);
    expect(cellText(missing, table.columns, '总分')).toBe(DASH);
    expect(toneAt(missing, table.columns, '总分')).toBeNull();
    expect(cellText(missing, table.columns, '状态')).toBe('未开考');
  });

  it('hides kind columns when the exam draws questions', async () => {
    const table = await gradesFor({
      type: 'exam',
      rule: 'exam',
      paper: paperOf('exam', 'exam', [problem(202, 'single', 5), problem(203, 'single', 5)], null, { single: 1 }),
      participants: people([
        person({ uid: 2, studentId: '240001', realName: '陈思远', startAt: '2026-10-24T06:10:00.000Z' }),
        person({
          uid: 1,
          studentId: '240002',
          realName: '王浩然',
          startAt: '2026-10-24T06:10:00.000Z',
          finalizedAt: '2026-10-24T07:00:00.000Z',
        }),
        person({ uid: 3, studentId: '240003', realName: '赵一鸣' }),
      ]),
      board: scoreboard([
        [
          { type: 'rank', value: '#' },
          { type: 'user', value: 'User' },
          { type: 'total_score', value: 'Total Score' },
        ],
        [
          { type: 'rank', value: '2' },
          { type: 'user', value: 'wang', raw: 1 },
          { type: 'total_score', value: 80 },
        ],
        [
          { type: 'rank', value: '1' },
          { type: 'user', value: 'chen', raw: 2 },
          { type: 'total_score', value: 90 },
        ],
      ]),
      roster: null,
      groupsById: new Map(),
    });

    expect(headers(table.columns)).toEqual(['学号', '姓名', '用户组', '总分', '状态']);
    expect(headers(table.columns)).not.toContain('单选题');
    expect(table.rows.map((row) => row.name)).toEqual(['陈思远', '王浩然', '赵一鸣']);
    expect(cellText(rowNamed(table.rows, '陈思远'), table.columns, '总分')).toBe('90');
    expect(cellText(rowNamed(table.rows, '陈思远'), table.columns, '状态')).toBe('作答中');
    expect(cellText(rowNamed(table.rows, '王浩然'), table.columns, '状态')).toBe('已交卷');
    expect(cellText(rowNamed(table.rows, '赵一鸣'), table.columns, '总分')).toBe(DASH);
    expect(cellText(rowNamed(table.rows, '赵一鸣'), table.columns, '状态')).toBe('未开考');
  });

  it('appends late to a homework submit time', async () => {
    const table = await gradesFor({
      type: 'homework',
      rule: 'homework',
      paper: paperOf('homework', 'homework', [problem(302, 'programming', 10), problem(301, 'blank', 5)]),
      participants: people([
        person({
          uid: 1,
          studentId: '240002',
          realName: '陈思远',
          lastSubmitAt: '2026-10-18T13:03:00.000Z',
        }),
        person({
          uid: 2,
          studentId: '240003',
          realName: '赵一鸣',
          lastSubmitAt: '2026-10-21T02:00:00.000Z',
          late: true,
        }),
        person({ uid: 3, studentId: '240001', realName: '林雨桐' }),
      ]),
      // The penalty total is a string cell under the total_score header; the time column is not a problem.
      board: scoreboard([
        [
          { type: 'rank', value: 'Rank' },
          { type: 'user', value: 'User' },
          { type: 'total_score', value: 'Score' },
          { type: 'time', value: 'Total Time' },
          { type: 'problem', value: 'A', raw: 302 },
          { type: 'problem', value: 'B', raw: 301 },
        ],
        [
          { type: 'rank', value: '10' },
          { type: 'user', value: 'chen', raw: 1 },
          { type: 'string', value: 10 },
          { type: 'time', value: '00:10' },
          scoreCell('10', 10),
          scoreCell('0', 0),
        ],
        [
          { type: 'rank', value: '1' },
          { type: 'user', value: 'zhao', raw: 2 },
          { type: 'string', value: 13 },
          { type: 'time', value: '00:20' },
          scoreCell('8', 8),
          scoreCell('5', 5),
        ],
      ]),
      roster: null,
      groupsById: new Map(),
    });

    expect(headers(table.columns)).toEqual(['学号', '姓名', '用户组', '1', '2', '总分', '提交时间']);
    expect(table.rows.map((row) => row.name)).toEqual(['赵一鸣', '陈思远', '林雨桐']);

    const early = rowNamed(table.rows, '陈思远');
    expect(cellText(early, table.columns, '1')).toBe('10');
    expect(toneAt(early, table.columns, '1')).toBe('success');
    expect(cellText(early, table.columns, '2')).toBe('0');
    expect(toneAt(early, table.columns, '2')).toBe('danger');
    const earlySubmit = cellText(early, table.columns, '提交时间');
    expect(earlySubmit).not.toBe('未提交');
    expect(earlySubmit).not.toContain('迟交');

    const late = cellText(rowNamed(table.rows, '赵一鸣'), table.columns, '提交时间');
    expect(late).toContain(' 迟交');
    expect(late.startsWith(' ')).toBe(false);
    expect(late).not.toBe(' 迟交');

    const none = rowNamed(table.rows, '林雨桐');
    expect(cellText(none, table.columns, '1')).toBe(DASH);
    expect(cellText(none, table.columns, '总分')).toBe(DASH);
    expect(cellText(none, table.columns, '提交时间')).toBe('未提交');
  });

  it('shows acm markers and the penalty column', async () => {
    const problems = [101, 102, 103, 104, 105].map((docId) => problem(docId, 'programming', null));
    const table = await gradesFor({
      type: 'acm',
      rule: 'acm',
      paper: paperOf('acm', 'acm', problems),
      participants: people([
        person({ uid: 10, uname: 'chen', studentId: '2401010112', realName: '陈思远', groupIds: ['g1'] }),
      ]),
      // A clean accept is the check icon. The solved header's data cell is type time.
      board: scoreboard([
        [
          { type: 'rank', value: '#' },
          { type: 'user', value: 'User' },
          { type: 'solved', value: 'Solved\nTotal Time' },
          { type: 'problem', value: 'A', raw: 101 },
          { type: 'problem', value: 'B', raw: 102 },
          { type: 'problem', value: 'C', raw: 103 },
          { type: 'problem', value: 'D', raw: 104 },
          { type: 'problem', value: 'E', raw: 105 },
        ],
        [
          { type: 'rank', value: '1' },
          { type: 'user', value: 'chen', raw: 10 },
          { type: 'time', value: '4\n90' },
          scoreCell(CHECK, 100),
          scoreCell('+1\n00:12:03', 100),
          scoreCell('-3', 0),
          scoreCell('\u22122', 0),
          scoreCell('', 0),
        ],
      ]),
      roster: null,
      groupsById: new Map([['g1', '计科 2401']]),
    });

    expect(headers(table.columns)).toEqual(['学号', '姓名', '用户组', '#', 'A', 'B', 'C', 'D', 'E', `通过 ${DOT} 罚时`]);
    const row = rowNamed(table.rows, '陈思远');
    expect(row.studentId).toBe('2401010112');
    expect(cellText(row, table.columns, '#')).toBe('1');
    expect(cellText(row, table.columns, 'A')).toBe('+');
    expect(toneAt(row, table.columns, 'A')).toBe('success');
    expect(cellText(row, table.columns, 'B')).toBe('+1');
    expect(toneAt(row, table.columns, 'B')).toBe('success');
    expect(cellText(row, table.columns, 'C')).toBe('-3');
    expect(toneAt(row, table.columns, 'C')).toBe('danger');
    expect(cellText(row, table.columns, 'D')).toBe('\u22122');
    expect(toneAt(row, table.columns, 'D')).toBe('danger');
    expect(cellText(row, table.columns, 'E')).toBe(DOT);
    expect(toneAt(row, table.columns, 'E')).toBeNull();
    expect(cellText(row, table.columns, `通过 ${DOT} 罚时`)).toBe(penalty('4', '90'));
  });

  it('keeps one row per team and leaves the student columns blank', async () => {
    const table = await gradesFor({
      type: 'acm',
      rule: 'acm',
      paper: paperOf('acm', 'acm', [problem(101, 'programming', null)]),
      participants: people([
        person({ uid: 10, studentId: '240101', realName: '陈思远', groupIds: ['g1'] }),
        person({ uid: 11, studentId: '240102', realName: '王浩然', groupIds: ['g2'] }),
      ]),
      board: scoreboard([
        [
          { type: 'rank', value: '#' },
          { type: 'string', value: 'Team' },
          { type: 'solved', value: 'Solved\nTotal Time' },
          { type: 'problem', value: 'A', raw: 101 },
        ],
        [
          { type: 'rank', value: '1' },
          {
            type: 'string',
            value: '红队\nCaptain: chen\nMembers: chen / wang',
            raw: '507f1f77bcf86cd799439011',
            team: { name: '红队', captainUid: 10, memberUids: [10, 11] },
          },
          { type: 'time', value: '1\n12' },
          scoreCell('+1\n00:01', 100),
        ],
      ]),
      roster: null,
      groupsById: new Map([['g1', '计科 2401'], ['g2', '计科 2402']]),
    });

    expect(table.rows).toHaveLength(1);
    const row = table.rows[0];
    if (!row) throw new TypeError('missing team row');
    expect(row.name).toBe('红队');
    expect(row.studentId).toBe('');
    expect(row.groupNames).toBe('');
    expect(row.groupIds).toEqual([]);
    expect(table.rows.map((item) => item.name)).not.toContain('陈思远');
    expect(table.rows.map((item) => item.name)).not.toContain('王浩然');
    expect(cellText(row, table.columns, 'A')).toBe('+1');
    expect(toneAt(row, table.columns, 'A')).toBe('success');
    expect(cellText(row, table.columns, `通过 ${DOT} 罚时`)).toBe(penalty('1', '12'));
  });

  it('projects the practice roster without a recent submit column', async () => {
    const members: RosterMember[] = [
      {
        uid: 3,
        uname: 'lin',
        realName: '林雨桐',
        studentId: '240003',
        groups: ['计科 2401'],
        groupIds: ['g1'],
        done: 0,
        total: 4,
        completedPids: [],
      },
      {
        uid: 2,
        uname: 'wang',
        realName: '王浩然',
        studentId: '240002',
        groups: ['计科 2402'],
        groupIds: ['g2'],
        done: 4,
        total: 4,
        completedPids: [101, 102, 103, 104],
      },
      {
        uid: 1,
        uname: 'chen',
        realName: '陈思远',
        studentId: '240001',
        groups: ['计科 2401'],
        groupIds: ['g1'],
        done: 2,
        total: 4,
        completedPids: [101, 102],
      },
    ];
    const table = await gradesFor({
      type: 'practice',
      rule: 'problem_set',
      paper: paperOf('practice', 'problem_set', [101, 102, 103, 104].map((docId) => problem(docId, 'programming', null)), [
        stage(1, '链表基础', [101, 102]),
        stage(2, '链表进阶', [103]),
        stage(3, '综合', [104]),
      ]),
      participants: null,
      board: null,
      roster: { members, membersTruncated: false, canViewRoster: true, rosterProblems: [] },
      groupsById: new Map([['g1', '计科 2401'], ['g2', '计科 2402']]),
    });

    expect(headers(table.columns)).toEqual(['学号', '姓名', '用户组', '当前阶段', '完成', '进度']);
    expect(headers(table.columns)).not.toContain('最近提交');
    expect(table.rows.map((row) => row.name)).toEqual(['陈思远', '王浩然', '林雨桐']);

    const started = rowNamed(table.rows, '陈思远');
    expect(started.studentId).toBe('240001');
    expect(started.groupNames).toBe('计科 2401');
    expect(started.groupIds).toEqual(['g1']);
    expect(cellText(started, table.columns, '当前阶段')).toBe('链表进阶');
    expect(cellText(started, table.columns, '完成')).toBe('2 / 4');
    expect(Number(cellText(started, table.columns, '进度'))).toBe(50);

    const done = rowNamed(table.rows, '王浩然');
    expect(cellText(done, table.columns, '当前阶段')).toBe('综合');
    expect(cellText(done, table.columns, '完成')).toBe('4 / 4');
    expect(Number(cellText(done, table.columns, '进度'))).toBe(100);

    const fresh = rowNamed(table.rows, '林雨桐');
    expect(cellText(fresh, table.columns, '当前阶段')).toBe('链表基础');
    expect(cellText(fresh, table.columns, '完成')).toBe('0 / 4');
    expect(Number(cellText(fresh, table.columns, '进度'))).toBe(0);
  });

  it('reads scoreboard rows and rejects a bad shape', async () => {
    const api = await loadGrades();
    const parsed = api.parseScoreboard(scoreboard([
      [
        { type: 'rank', value: '#' },
        { type: 'user', value: 'User' },
        { type: 'total_score', value: 'Total Score' },
        { type: 'problem', value: 'A', raw: 101 },
        { type: 'problem', value: 'B', raw: 102 },
      ],
      [
        { type: 'rank', value: '1' },
        { type: 'user', value: 'chen', raw: 10 },
        { type: 'total_score', value: 80 },
        scoreCell('30', 30),
        scoreCell('5'),
      ],
    ]));
    expect(parsed.columns.map((column) => ({ docId: column.docId, header: column.header }))).toEqual([
      { docId: 101, header: 'A' },
      { docId: 102, header: 'B' },
    ]);
    const row = parsed.rows[0];
    if (!row) throw new TypeError('missing parsed row');
    expect(row.cells).toBeInstanceOf(Map);
    expect(row.uid).toBe(10);
    expect(row.rank).toBe('1');
    expect(row.total).toBe('80');
    expect(row.teamName).toBeNull();
    expect(row.teamMemberUids).toEqual([]);
    expect(row.solved).toBeNull();
    expect(row.penalty).toBeNull();
    expect(row.cells.get(101)).toEqual({ value: '30', score: 30 });
    expect(row.cells.get(102)).toEqual({ value: '5', score: null });

    const team = api.parseScoreboard(scoreboard([
      [
        { type: 'rank', value: '#' },
        { type: 'string', value: 'Team' },
        { type: 'solved', value: 'Solved\nTotal Time' },
        { type: 'problem', value: 'A', raw: 101 },
      ],
      [
        { type: 'rank', value: '1' },
        {
          type: 'string',
          value: '红队\nCaptain: chen',
          raw: '507f1f77bcf86cd799439011',
          team: { name: '红队', captainUid: 10, memberUids: [10, 11] },
        },
        { type: 'time', value: '1\n12' },
        scoreCell('+', 100),
      ],
    ]));
    const teamRow = team.rows[0];
    if (!teamRow) throw new TypeError('missing parsed team');
    expect(teamRow.uid).toBeNull();
    expect(teamRow.teamName).toBe('红队');
    expect(teamRow.teamMemberUids).toEqual([10, 11]);
    expect(teamRow.solved).toBe('1');
    expect(teamRow.penalty).toBe('12');

    const bad: unknown[] = [
      null,
      1,
      'rows',
      [],
      { rows: null },
      { rows: {} },
      { rows: [] },
      { rows: [null] },
      { rows: [[{ type: 'problem', value: 'A', raw: '101' }]] },
      {
        rows: [
          [{ type: 'rank', value: '#' }, { type: 'user', value: 'User' }],
          [{ type: 'rank', value: '1' }, { type: 'user', value: 'chen', raw: 'nope' }],
        ],
      },
    ];
    for (const value of bad) {
      expect(() => api.parseScoreboard(value)).toThrow(TypeError);
    }
    expect(() => api.parseScoreboard({ members: {} })).toThrow(TypeError);
  });

  it('prefixes formula csv cells and quotes special characters', async () => {
    const api = await loadGrades();
    const formula = api.gradesCsv([sheetColumn('total', '总分')], [sheetRow({ total: '=1+1' })]);
    expect(csvLines(formula)).toEqual(['总分', '\u0027=1+1']);
    expect(csvLines(api.gradesCsv([sheetColumn('mark', '记号')], [sheetRow({ mark: '+1' })]))).toEqual(['记号', '\u0027+1']);
    expect(csvLines(api.gradesCsv([sheetColumn('mark', '记号')], [sheetRow({ mark: '-3' })]))).toEqual(['记号', '\u0027-3']);
    expect(csvLines(api.gradesCsv([sheetColumn('mark', '记号')], [sheetRow({ mark: '@cmd' })]))).toEqual(['记号', '\u0027@cmd']);
    expect(csvLines(api.gradesCsv([sheetColumn('note', '备注')], [sheetRow({ note: 'a,b' })]))).toEqual(['备注', '"a,b"']);
    expect(csvLines(api.gradesCsv([sheetColumn('note', '备注')], [sheetRow({ note: 'say "hi"' })]))).toEqual(['备注', '"say ""hi"""']);
    expect(csvBody(api.gradesCsv([sheetColumn('note', '备注')], [sheetRow({ note: 'a\nb' })])).startsWith('备注\n"a\nb"')).toBe(true);
  });
});
