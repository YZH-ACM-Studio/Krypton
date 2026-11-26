import { scoreboardParticipantColumn, scoreboardRowMatches } from '@/lib/contest-exam-display';
import { readProblemCounts, type ScoreboardProblemCounts } from '@/lib/scoreboard-problem-counts';

export interface BoardTeam {
  memberUids: number[];
}

export interface BoardCell {
  type: string;
  value: string | number;
  raw: unknown;
  team: BoardTeam | null;
}

export interface BoardStudent {
  studentId: string;
  realName: string;
}

export interface Board {
  header: BoardCell[];
  body: BoardCell[][];
  currentUserId: unknown;
  locked: boolean;
  names: Map<string, string>;
  students: Map<string, BoardStudent>;
  problems: Map<string, ScoreboardProblemCounts>;
}

export interface RankingSummary {
  rowIndex: number | null;
  rank: string | null;
  total: number;
  solved: string | null;
  penalty: string | null;
  score: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseTeam(value: unknown, path: string): BoardTeam | null {
  if (value === undefined) return null;
  if (!isRecord(value) || !Array.isArray(value.memberUids)) throw new TypeError(`${path}.team.memberUids 必须是数组`);
  return {
    memberUids: value.memberUids.map((item, index) => {
      if (typeof item !== 'number' || !Number.isInteger(item)) throw new TypeError(`${path}.team.memberUids[${index}] 必须是整数`);
      return item;
    }),
  };
}

export function parseCell(value: unknown, path: string): BoardCell {
  if (!isRecord(value)) throw new TypeError(`${path} 必须是格子`);
  if (typeof value.type !== 'string' || value.type.length === 0) throw new TypeError(`${path}.type 必须是字符串`);
  if (typeof value.value !== 'string' && typeof value.value !== 'number') throw new TypeError(`${path}.value 必须是文字或数字`);
  return {
    type: value.type, value: value.value, raw: value.raw, team: parseTeam(value.team, path),
  };
}

export function parseNames(raw: unknown): Map<string, string> {
  const names = new Map<string, string>();
  if (raw === undefined) return names;
  if (!isRecord(raw)) throw new TypeError('排名 udict 必须是对象');
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value) || typeof value.uname !== 'string' || value.uname.length === 0) continue;
    names.set(key, typeof value.displayName === 'string' && value.displayName ? value.displayName : value.uname);
  }
  return names;
}

export function parseStudents(raw: unknown): Map<string, BoardStudent> {
  const students = new Map<string, BoardStudent>();
  if (raw === undefined) return students;
  if (!isRecord(raw)) throw new TypeError('学号姓名必须是对象');
  for (const [uid, value] of Object.entries(raw)) {
    if (!isRecord(value) || typeof value.studentId !== 'string' || typeof value.realName !== 'string') {
      throw new TypeError(`学号姓名 ${uid} 无效`);
    }
    students.set(uid, { studentId: value.studentId, realName: value.realName });
  }
  return students;
}

export function parseProblems(raw: unknown): Map<string, ScoreboardProblemCounts> {
  const problems = new Map<string, ScoreboardProblemCounts>();
  if (raw === undefined) return problems;
  if (!isRecord(raw)) throw new TypeError('排名题目必须是对象');
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value)) throw new TypeError(`排名题目 ${id} 无效`);
    const counts = readProblemCounts(value);
    if (counts) problems.set(id, counts);
  }
  return problems;
}

export function parseBoard(raw: unknown): Board {
  if (!isRecord(raw) || !Array.isArray(raw.rows)) throw new TypeError('排名缺少 rows');
  const rows = raw.rows.map((row, index) => {
    if (!Array.isArray(row)) throw new TypeError(`排名第 ${index} 行必须是数组`);
    return row.map((cell, column) => parseCell(cell, `rows[${index}][${column}]`));
  });
  let locked = false;
  if ('scoreboardLocked' in raw) {
    if (typeof raw.scoreboardLocked !== 'boolean') throw new TypeError('scoreboardLocked 必须是布尔值');
    locked = raw.scoreboardLocked;
  }
  return {
    header: rows[0] ?? [],
    body: rows.slice(1),
    currentUserId: raw.currentUserId,
    locked,
    names: parseNames(raw.udict),
    students: parseStudents(raw.studentDict),
    problems: parseProblems(raw.pdict),
  };
}

function plainPiece(value: string | number): string {
  return String(value)
    .replace(/<span style="color:orange">[^<]*<\/span>/g, '?')
    .replace(/<span class="icon icon-check"><\/span>/g, '✓')
    .replace(/<[^>]*>/g, '')
    .replace(/\u00A0/g, ' ')
    .trim();
}

function plainBoardText(value: string | number): string {
  const text = plainPiece(value);
  return text.length > 0 ? text : '—';
}

function boardCellText(cell: BoardCell, names: ReadonlyMap<string, string>): string {
  if (cell.type === 'rank' && (cell.value === 0 || cell.value === '0' || cell.value === '*')) return '*';
  if (cell.type === 'user' && (typeof cell.raw === 'string' || typeof cell.raw === 'number')) {
    const name = names.get(String(cell.raw));
    if (name) return name;
  }
  return plainBoardText(cell.value);
}

function teamMemberRow(row: readonly BoardCell[], column: number, userId: number): boolean {
  if (column < 0) return false;
  const members = row[column]?.team?.memberUids;
  return members !== undefined && members.includes(userId);
}

function columnText(board: Board, row: readonly BoardCell[], type: string): string | null {
  const index = board.header.findIndex((cell) => cell.type === type);
  if (index < 0) return null;
  const cell = row[index];
  if (!cell) return null;
  return boardCellText(cell, board.names);
}

/** Default ACM packs accept and penalty into the solved column as "n\\nH:MM". A real time column is not split. */
function solvedAndPenalty(board: Board, row: readonly BoardCell[]): { solved: string | null; penalty: string | null } {
  const solved = columnText(board, row, 'solved');
  if (board.header.some((cell) => cell.type === 'time')) {
    return { solved, penalty: columnText(board, row, 'time') };
  }
  if (solved === null || !solved.includes('\n')) return { solved, penalty: null };
  const breakAt = solved.indexOf('\n');
  return {
    solved: solved.slice(0, breakAt).trim(),
    penalty: solved.slice(breakAt + 1).trim(),
  };
}

export function rankingSummary(board: Board, viewerId: number, teamMode: boolean): RankingSummary {
  const column = scoreboardParticipantColumn(board.header, teamMode);
  let rowIndex: number | null = null;
  for (let index = 0; index < board.body.length; index += 1) {
    const row = board.body[index];
    const mine = teamMode
      ? teamMemberRow(row, column, viewerId)
      : scoreboardRowMatches(row, column, viewerId);
    if (mine) {
      rowIndex = index;
      break;
    }
  }
  const row = rowIndex === null ? null : board.body[rowIndex];
  const totals = row ? solvedAndPenalty(board, row) : { solved: null, penalty: null };
  return {
    rowIndex,
    rank: row ? columnText(board, row, 'rank') : null,
    total: board.body.length,
    solved: totals.solved,
    penalty: totals.penalty,
    score: row ? columnText(board, row, 'total_score') : null,
  };
}

function identityMatches(board: Board, uid: string, needle: string): boolean {
  const student = board.students.get(uid);
  if (student) {
    if (student.studentId.toLowerCase().includes(needle)) return true;
    if (student.realName.toLowerCase().includes(needle)) return true;
  }
  const uname = board.names.get(uid);
  return uname !== undefined && uname.toLowerCase().includes(needle);
}

function rowMatches(board: Board, row: readonly BoardCell[], needle: string): boolean {
  for (const cell of row) {
    if (cell.type === 'user' && (typeof cell.raw === 'string' || typeof cell.raw === 'number')) {
      if (identityMatches(board, String(cell.raw), needle)) return true;
    }
    if (!cell.team) continue;
    for (const uid of cell.team.memberUids) {
      if (identityMatches(board, String(uid), needle)) return true;
    }
  }
  return false;
}

export function filterRankingRows(board: Board, query: string): number[] {
  const needle = query.trim().toLowerCase();
  const matched: number[] = [];
  for (let index = 0; index < board.body.length; index += 1) {
    if (needle.length === 0 || rowMatches(board, board.body[index], needle)) matched.push(index);
  }
  return matched;
}
