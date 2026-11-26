import { groupByPta, isOnePerPageKind, parseTeachType, ptaKindName } from '@hydrooj/common';
import type { TeachType } from '@hydrooj/common';
import { readProblemCounts, type ScoreboardProblemCounts } from '@/lib/scoreboard-problem-counts';
import type { TeachParticipant, TeachParticipantsPayload } from './model';
import { paperFullScore, paperNumbering } from './paper';
import type { PaperItem, PaperState } from './paper';

export interface ScoreCell {
  value: string;
  score: number | null;
  counts?: ScoreboardProblemCounts;
}

/** `uname` is the scoreboard user cell. The row contract has no other place to keep an admin's username. */
export interface ScoreboardRow {
  uid: number | null;
  uname: string | null;
  teamName: string | null;
  teamMemberUids: number[];
  rank: string;
  cells: Map<number, ScoreCell>;
  total: string;
  solved: string | null;
  penalty: string | null;
}

export interface ScoreboardTable {
  columns: Array<{ docId: number; header: string; counts?: ScoreboardProblemCounts }>;
  rows: ScoreboardRow[];
}

/** Visual lines for one matrix column. `header` stays the CSV label. */
export interface GradeMatrix {
  title: string;
  subtitle: string;
  full: number | null;
}

export interface GradeColumn {
  key: string;
  header: string;
  align: 'left' | 'right' | 'center';
  matrix?: GradeMatrix;
  counts?: ScoreboardProblemCounts;
}

/** Submit count and lateness for one matrix cell that has a score. */
export interface GradeAttempt {
  submits: number;
  late: boolean;
}

export interface GradeRow {
  key: string;
  studentId: string;
  name: string;
  groupNames: string;
  groupIds: string[];
  searchText: string;
  cells: Record<string, string>;
  tones: Record<string, 'success' | 'danger' | null>;
  attempts: Record<string, GradeAttempt>;
}

export interface PracticeRosterMember {
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

/** Normalized practice problem. Object payloads use `pidLabel` as `label`. */
export interface PracticePassProblem {
  pid: number;
  label: string;
  title: string;
}

export interface PracticePassCount extends PracticePassProblem {
  count: number;
}

interface HeaderCell {
  kind: 'rank' | 'user' | 'total' | 'solved' | 'problem' | 'ignore';
  docId: number | null;
}

interface GradeDraft {
  key: string;
  studentId: string;
  name: string;
  groupNames: string;
  groupIds: string[];
  searchText: string;
  rank: string;
  board: ScoreboardRow | null;
  participant: TeachParticipant | null;
}

type Tone = 'success' | 'danger' | null;

const DASH = '\u2014';
const DOT = '\u00B7';
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const IDENTITY: GradeColumn[] = [
  { key: 'studentId', header: '学号', align: 'left' },
  { key: 'name', header: '姓名', align: 'left' },
  { key: 'group', header: '用户组', align: 'left' },
];

function invalid(message: string): never {
  throw new TypeError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string') invalid(message);
  return value;
}

function requireSafeInt(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid(message);
  return value;
}

function stringList(value: unknown, message: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) invalid(message);
  return value.slice();
}

function cellText(cell: Record<string, unknown>, message: string): string {
  const value = cell.value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? '0' : String(value);
  invalid(message);
}

function cellScore(cell: Record<string, unknown>): number | null {
  if (!Object.hasOwn(cell, 'score') || cell.score == null) return null;
  if (typeof cell.score !== 'number' || !Number.isFinite(cell.score)) invalid('排行榜分数无效');
  return cell.score;
}

/** A post-contest `records` cell keeps the contest attempt in `raw[0]` and practice in `raw[1]`. */
function problemScoreCell(cell: Record<string, unknown>): ScoreCell {
  if (Array.isArray(cell.raw) && cell.raw.length > 0) {
    const first: unknown = cell.raw[0];
    if (!isRecord(first)) invalid('排行榜题目分数无效');
    return { value: cellText(first, '排行榜题目分数无效'), score: cellScore(first) };
  }
  const counts = readProblemCounts(cell.problemCounts);
  return { value: cellText(cell, '排行榜题目分数无效'), score: cellScore(cell), ...(counts && { counts }) };
}

function readTeam(cell: Record<string, unknown>): { name: string; memberUids: number[] } | null {
  if (!Object.hasOwn(cell, 'team') || cell.team == null) return null;
  if (!isRecord(cell.team)) invalid('排行榜队伍无效');
  const name = requireString(cell.team.name, '排行榜队伍无效');
  if (name === '') invalid('排行榜队伍无效');
  if (!Array.isArray(cell.team.memberUids)) invalid('排行榜队伍无效');
  return {
    name,
    memberUids: cell.team.memberUids.map((uid) => requireSafeInt(uid, '排行榜队伍无效')),
  };
}

function headerKind(type: string): HeaderCell['kind'] | null {
  if (type === 'rank' || type === 'user' || type === 'solved') return type;
  if (type === 'total_score') return 'total';
  if (type === 'problem') return 'problem';
  return null;
}

function parseHeader(raw: unknown): { cells: HeaderCell[]; columns: ScoreboardTable['columns'] } {
  if (!Array.isArray(raw)) invalid('排行榜表头无效');
  const seenKinds = new Set<HeaderCell['kind']>();
  const seenDocIds = new Set<number>();
  const columns: ScoreboardTable['columns'] = [];
  const cells = raw.map((item): HeaderCell => {
    if (!isRecord(item) || typeof item.type !== 'string' || item.type === '') invalid('排行榜表头无效');
    const kind = headerKind(item.type);
    if (kind === null) return { kind: 'ignore', docId: null };
    if (kind === 'problem') {
      const docId = requireSafeInt(item.raw, '排行榜题目无效');
      const header = requireString(item.value, '排行榜题目无效');
      if (header === '' || seenDocIds.has(docId)) invalid('排行榜题目无效');
      seenDocIds.add(docId);
      columns.push({ docId, header });
      return { kind, docId };
    }
    if (seenKinds.has(kind)) invalid('排行榜表头无效');
    seenKinds.add(kind);
    return { kind, docId: null };
  });
  return { cells, columns };
}

function parseDataRow(header: HeaderCell[], raw: unknown): ScoreboardRow {
  if (!Array.isArray(raw) || raw.length !== header.length) invalid('排行榜行无效');
  let uid: number | null = null;
  let uname: string | null = null;
  let sawUser = false;
  let team: { name: string; memberUids: number[] } | null = null;
  let rank = '';
  let total = '';
  let solved: string | null = null;
  let penalty: string | null = null;
  const cells = new Map<number, ScoreCell>();
  for (let index = 0; index < header.length; index += 1) {
    const column = header[index];
    const cell: unknown = raw[index];
    if (!column || !isRecord(cell)) invalid('排行榜行无效');
    const foundTeam = readTeam(cell);
    if (foundTeam) {
      if (team) invalid('排行榜行无效');
      team = foundTeam;
    }
    if (column.kind === 'rank') rank = cellText(cell, '排行榜名次无效');
    if (column.kind === 'user') {
      sawUser = true;
      uname = cellText(cell, '排行榜用户无效');
      uid = requireSafeInt(cell.raw, '排行榜用户无效');
    }
    if (column.kind === 'total') total = cellText(cell, '排行榜总分无效');
    if (column.kind === 'solved') {
      const text = cellText(cell, '排行榜罚时无效');
      const split = text.indexOf('\n');
      solved = split === -1 ? text : text.slice(0, split);
      penalty = split === -1 ? '' : text.slice(split + 1);
    }
    if (column.kind === 'problem' && column.docId !== null) {
      cells.set(column.docId, problemScoreCell(cell));
    }
  }
  if (team) {
    return {
      uid: null,
      uname: null,
      teamName: team.name,
      teamMemberUids: team.memberUids,
      rank,
      cells,
      total,
      solved,
      penalty,
    };
  }
  if (!sawUser || uid === null) invalid('排行榜行缺少用户');
  return {
    uid,
    uname,
    teamName: null,
    teamMemberUids: [],
    rank,
    cells,
    total,
    solved,
    penalty,
  };
}

export function parseScoreboard(raw: unknown): ScoreboardTable {
  if (!isRecord(raw) || !Object.hasOwn(raw, 'rows') || !Array.isArray(raw.rows) || raw.rows.length === 0) {
    invalid('排行榜格式无效');
  }
  const header = parseHeader(raw.rows[0]);
  if (raw.pdict !== undefined) {
    if (!isRecord(raw.pdict)) invalid('排行榜题目统计无效');
    for (const column of header.columns) {
      const counts = readProblemCounts(raw.pdict[column.docId]);
      if (counts) column.counts = counts;
    }
  }
  return {
    columns: header.columns,
    rows: raw.rows.slice(1).map((row) => parseDataRow(header.cells, row)),
  };
}

function parseRosterProblem(value: unknown): PracticePassProblem {
  if (typeof value === 'number') {
    const pid = requireSafeInt(value, '花名册题目无效');
    return { pid, label: String(pid), title: '' };
  }
  if (!isRecord(value)) invalid('花名册题目无效');
  return {
    pid: requireSafeInt(value.pid, '花名册题目无效'),
    label: requireString(value.pidLabel, '花名册题目无效'),
    title: requireString(value.title, '花名册题目无效'),
  };
}

function rosterProblemList(raw: Record<string, unknown>): unknown[] {
  if (Array.isArray(raw.rosterProblems)) return raw.rosterProblems;
  if (raw.rosterProblems !== undefined) invalid('花名册题目无效');
  if (Array.isArray(raw.rosterProblemIds)) return raw.rosterProblemIds;
  if (raw.rosterProblemIds !== undefined) invalid('花名册题目无效');
  return [];
}

export function parsePracticeRoster(raw: unknown): {
  members: PracticeRosterMember[];
  membersTruncated: boolean;
  rosterProblemIds: number[];
  rosterProblems: PracticePassProblem[];
} {
  if (!isRecord(raw) || !Array.isArray(raw.members)) invalid('花名册格式无效');
  if (raw.membersTruncated !== undefined && typeof raw.membersTruncated !== 'boolean') invalid('花名册截断标记无效');
  const rosterProblems = rosterProblemList(raw).map((item) => parseRosterProblem(item));
  return {
    membersTruncated: raw.membersTruncated === true,
    rosterProblemIds: rosterProblems.map((problem) => problem.pid),
    rosterProblems,
    members: raw.members.map((item) => {
      if (!isRecord(item)) invalid('花名册格式无效');
      const groups = stringList(item.groups, '花名册用户组无效');
      const groupIds = stringList(item.groupIds, '花名册用户组无效');
      if (groups.length !== groupIds.length) invalid('花名册用户组无效');
      const done = requireSafeInt(item.done, '花名册完成数无效');
      const total = requireSafeInt(item.total, '花名册完成数无效');
      if (done < 0 || total < 0) invalid('花名册完成数无效');
      if (!Array.isArray(item.completedPids)) invalid('花名册完成题目无效');
      return {
        uid: requireSafeInt(item.uid, '花名册用户无效'),
        uname: requireString(item.uname, '花名册用户名无效'),
        realName: requireString(item.realName, '花名册姓名无效'),
        studentId: requireString(item.studentId, '花名册学号无效'),
        groups,
        groupIds,
        done,
        total,
        completedPids: item.completedPids.map((pid) => requireSafeInt(pid, '花名册完成题目无效')),
      };
    }),
  };
}

export function practicePassCounts(
  members: readonly PracticeRosterMember[],
  problems: readonly PracticePassProblem[],
): PracticePassCount[] {
  const counts = new Map<number, number>();
  for (const member of members) {
    for (const pid of new Set(member.completedPids)) counts.set(pid, (counts.get(pid) ?? 0) + 1);
  }
  return problems.map(({ pid, label, title }) => ({ pid, label, title, count: counts.get(pid) ?? 0 }));
}

function formatScore(value: number): string {
  if (!Number.isFinite(value)) invalid('成绩分数无效');
  const scaled = Math.round(value * 1000) / 1000;
  const normal = Object.is(scaled, -0) ? 0 : scaled;
  return Number.isInteger(normal) ? String(normal) : String(normal);
}

function plainScore(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function leadingNumber(text: string): number | null {
  const match = /^[+-]?\d+(?:\.\d+)?/.exec(text.trim());
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

const PENDING_MARKUP = /<span\s+style="color:\s*orange"[^>]*>[\s\S]*?<\/span>/gi;

function visibleScoreLine(value: string): string {
  const line = (value.split('\n')[0] ?? '').replace(PENDING_MARKUP, '');
  return line.replace(/<[^>]*>/g, '').trim();
}

function scoreNumber(cell: ScoreCell): number | null {
  const line = visibleScoreLine(cell.value);
  const plain = plainScore(line);
  if (plain !== null) return plain;
  // cell.score is the raw 0–100 percentage, not the paper score in `value`.
  if (line === '' || line === '-' || line === '\u2212') return null;
  return leadingNumber(line);
}

function scoreTone(value: number, full: number | null): Tone {
  if (full !== null && value === full) return 'success';
  if (value === 0) return 'danger';
  return null;
}

function presentedScore(cell: ScoreCell | undefined, full: number | null): { text: string; tone: Tone } {
  if (!cell) return { text: DASH, tone: null };
  const numeric = scoreNumber(cell);
  if (numeric === null) {
    const line = visibleScoreLine(cell.value);
    return { text: line === '' || line === '-' ? DASH : line, tone: null };
  }
  const line = visibleScoreLine(cell.value);
  const text = plainScore(line) !== null || line === '' || line === '-' ? formatScore(numeric) : line;
  return { text, tone: scoreTone(numeric, full) };
}

function kindContribution(cell: ScoreCell): number {
  return scoreNumber(cell) ?? 0;
}

function sumKind(row: ScoreboardRow | null, docIds: readonly number[], full: number | null): { text: string; tone: Tone } {
  if (!row) return { text: DASH, tone: null };
  let sum = 0;
  let sawNumber = false;
  for (const docId of docIds) {
    const cell = row.cells.get(docId);
    if (!cell) return { text: DASH, tone: null };
    if (scoreNumber(cell) !== null) sawNumber = true;
    sum += kindContribution(cell);
  }
  if (!sawNumber) return { text: DASH, tone: null };
  return { text: formatScore(sum), tone: scoreTone(sum, full) };
}

function acmMarker(value: string): string {
  const line = value.split('\n')[0] ?? '';
  if (line.includes('icon-check')) return '+';
  if (/color:\s*orange/i.test(line)) {
    const text = line.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    return text === '' ? '?' : text;
  }
  const text = line.replace(/<[^>]*>/g, '').trim();
  return text === '' ? DOT : text;
}

function acmTone(marker: string): Tone {
  if (marker.includes('?')) {
    if (marker.startsWith('-') || marker.startsWith('\u2212')) return 'danger';
    return null;
  }
  if (marker.startsWith('+')) return 'success';
  if (marker.startsWith('-') || marker.startsWith('\u2212')) return 'danger';
  return null;
}

function formatSubmitAt(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) invalid('提交时间无效');
  const shifted = new Date(parsed + SHANGHAI_OFFSET_MS);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  const hour = String(shifted.getUTCHours()).padStart(2, '0');
  const minute = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

function numericRank(rank: string): number | null {
  if (!/^[1-9]\d*$/.test(rank)) return null;
  const value = Number(rank);
  return Number.isSafeInteger(value) ? value : null;
}

function compareDrafts(left: GradeDraft, right: GradeDraft): number {
  const leftRank = numericRank(left.rank);
  const rightRank = numericRank(right.rank);
  if (leftRank !== null && rightRank !== null && leftRank !== rightRank) return leftRank - rightRank;
  if (leftRank !== null && rightRank === null) return -1;
  if (leftRank === null && rightRank !== null) return 1;
  const byId = left.studentId.localeCompare(right.studentId, 'zh-CN', { numeric: true });
  if (byId !== 0) return byId;
  return left.name.localeCompare(right.name, 'zh-CN');
}

function groupLabel(groupIds: readonly string[], groupsById: Map<string, string>): string {
  return groupIds.map((id) => {
    const name = groupsById.get(id);
    if (name === undefined) invalid(`未知用户组：${id}`);
    return name;
  }).join('、');
}

function kindFull(items: readonly PaperItem[]): number | null {
  let full = 0;
  for (const item of items) {
    if (typeof item.score !== 'number' || !Number.isFinite(item.score)) return null;
    if (!item.excluded) full += item.score;
  }
  return full;
}

interface ProblemFact {
  submits: number;
  late: boolean;
}

interface MatrixColumn {
  key: string;
  header: string;
  title: string;
  subtitle: string;
  docIds: number[];
  full: number | null;
}

function usesGradeMatrix(type: TeachType, paper: PaperState): boolean {
  if (type === 'homework') return true;
  return type === 'exam' && !paper.draw;
}

function problemFacts(person: TeachParticipant | null): Record<string, ProblemFact> {
  if (!person || !Object.hasOwn(person, 'problems')) return {};
  const raw: unknown = Reflect.get(person, 'problems');
  if (!isRecord(raw)) invalid('题目提交记录无效');
  const facts: Record<string, ProblemFact> = {};
  for (const [pid, value] of Object.entries(raw)) {
    if (pid === '' || !isRecord(value)) invalid('题目提交记录无效');
    const submits = value.submits;
    if (typeof submits !== 'number' || !Number.isSafeInteger(submits) || submits < 0) invalid('题目提交次数无效');
    if (typeof value.late !== 'boolean') invalid('题目迟交标记无效');
    facts[pid] = { submits, late: value.late };
  }
  return facts;
}

function matrixColumns(paper: PaperState): MatrixColumn[] {
  const labels = paperNumbering(paper);
  const grouped = groupByPta(paper.items.map((item) => ({ item, pid: item.docId, kind: item.kind })));
  const columns: MatrixColumn[] = [];
  for (const group of grouped) {
    if (isOnePerPageKind(group.kind)) {
      for (const entry of group.items) {
        const item = entry.item;
        const label = labels.get(item.docId);
        if (label === undefined) invalid(`试卷题号缺失：${item.docId}`);
        const title = item.title.trim();
        columns.push({
          key: `problem:${item.docId}`,
          header: title === '' ? label : `${label}(${title})`,
          title: label,
          subtitle: title,
          docIds: [item.docId],
          full: kindFull([item]),
        });
      }
      continue;
    }
    const items = group.items.map((entry) => entry.item);
    const range = `${group.no}-1~${group.no}-${items.length}`;
    const name = ptaKindName(group.kind);
    columns.push({
      key: `kind:${group.kind}`,
      header: `${name}(${range})`,
      title: name,
      subtitle: range,
      docIds: items.map((item) => item.docId),
      full: kindFull(items),
    });
  }
  return columns;
}

function summarizeAttempts(docIds: readonly number[], facts: Record<string, ProblemFact>, board: ScoreboardRow | null): GradeAttempt {
  let submits = 0;
  let late = false;
  for (const docId of docIds) {
    const fact = facts[String(docId)];
    submits += board?.cells.get(docId)?.counts?.nSubmit ?? fact?.submits ?? 0;
    if (fact?.late) late = true;
  }
  return { submits, late };
}

function lateProblemCount(items: readonly PaperItem[], facts: Record<string, ProblemFact>): number {
  let count = 0;
  for (const item of items) {
    if (facts[String(item.docId)]?.late) count += 1;
  }
  return count;
}

function studentLabel(name: string, studentId: string): string {
  const trimmedName = name.trim();
  const trimmedId = studentId.trim();
  if (trimmedName === '') return trimmedId;
  if (trimmedId === '') return trimmedName;
  return `${trimmedName} ${trimmedId}`;
}

function handInText(person: TeachParticipant | null): string {
  if (!person?.finalizedAt) return DASH;
  return formatSubmitAt(person.finalizedAt);
}

function attemptStatus(person: TeachParticipant | null): string {
  if (person?.finalizedAt) return '已交卷';
  if (person?.startAt) return '作答中';
  return '未开考';
}

function totalPresentation(row: ScoreboardRow | null, full: number | null): { text: string; tone: Tone } {
  if (!row || row.total.trim() === '') return { text: DASH, tone: null };
  const fraction = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(row.total);
  if (fraction) return { text: row.total, tone: scoreTone(Number(fraction[1]), Number(fraction[2])) };
  const numeric = plainScore(row.total);
  if (numeric === null) return { text: row.total, tone: null };
  return { text: formatScore(numeric), tone: scoreTone(numeric, full) };
}

function penaltyText(row: ScoreboardRow | null): string {
  if (!row || row.solved === null || row.penalty === null) return DASH;
  return `${row.solved} ${DOT} ${row.penalty}`;
}

function progressText(done: number, total: number): string {
  if (total === 0) return '0';
  return formatScore((done / total) * 100);
}

function finishRow(
  draft: GradeDraft,
  entries: Array<{ key: string; text: string; tone: Tone }>,
  attempts: Record<string, GradeAttempt> = {},
): GradeRow {
  const cells: Record<string, string> = {};
  const tones: Record<string, Tone> = {};
  for (const entry of entries) {
    cells[entry.key] = entry.text;
    tones[entry.key] = entry.tone;
  }
  return {
    key: draft.key,
    studentId: draft.studentId,
    name: draft.name,
    groupNames: draft.groupNames,
    groupIds: draft.groupIds.slice(),
    searchText: draft.searchText,
    cells,
    tones,
    attempts,
  };
}

function identityEntries(draft: GradeDraft): Array<{ key: string; text: string; tone: Tone }> {
  return [
    { key: 'studentId', text: draft.studentId, tone: null },
    { key: 'name', text: draft.name, tone: null },
    { key: 'group', text: draft.groupNames, tone: null },
  ];
}

function columnCounts(ids: readonly number[], counts: ReadonlyMap<number, ScoreboardProblemCounts>) {
  const total = { nAccept: 0, nSubmit: 0 };
  for (const id of ids) {
    const problem = counts.get(id);
    if (!problem) return {};
    total.nAccept += problem.nAccept;
    total.nSubmit += problem.nSubmit;
  }
  return { counts: total };
}

function matrixGradeColumns(type: TeachType, paper: PaperState, counts: ReadonlyMap<number, ScoreboardProblemCounts>): GradeColumn[] {
  const scoreColumns = matrixColumns(paper).map((column): GradeColumn => ({
    key: column.key,
    header: column.header,
    align: 'center',
    matrix: { title: column.title, subtitle: column.subtitle, full: column.full },
    ...columnCounts(column.docIds, counts),
  }));
  const tail: GradeColumn = type === 'homework'
    ? { key: 'late', header: '迟交', align: 'center' }
    : { key: 'handedIn', header: '交卷时间', align: 'left' };
  return [
    { key: 'student', header: '学生', align: 'left' },
    ...scoreColumns,
    { key: 'total', header: '总分', align: 'center' },
    tail,
  ];
}

function contestColumns(type: TeachType, paper: PaperState, board: ScoreboardTable | null): GradeColumn[] {
  const counts = new Map(board?.columns.flatMap((column) => column.counts ? [[column.docId, column.counts] as const] : []));
  if (usesGradeMatrix(type, paper)) return matrixGradeColumns(type, paper, counts);
  const columns = IDENTITY.slice();
  const numbers = paperNumbering(paper);
  const problemColumns = paper.items.map((item): GradeColumn => {
    const header = numbers.get(item.docId);
    if (header === undefined) invalid(`试卷题号缺失：${item.docId}`);
    return { key: `problem:${item.docId}`, header, align: 'center', ...columnCounts([item.docId], counts) };
  });
  if (type === 'exam' && paper.draw) {
    columns.push({ key: 'total', header: '总分', align: 'center' }, { key: 'status', header: '状态', align: 'left' });
    return columns;
  }
  if (type === 'acm') {
    columns.push({ key: 'rank', header: '#', align: 'center' }, ...problemColumns, { key: 'penalty', header: `通过 ${DOT} 罚时`, align: 'center' });
    return columns;
  }
  columns.push({ key: 'rank', header: '#', align: 'center' }, ...problemColumns, { key: 'total', header: '总分', align: 'center' });
  return columns;
}

function matrixRecord(type: TeachType, paper: PaperState, draft: GradeDraft): {
  entries: Array<{ key: string; text: string; tone: Tone }>;
  attempts: Record<string, GradeAttempt>;
} {
  const facts = problemFacts(draft.participant);
  const attempts: Record<string, GradeAttempt> = {};
  const entries: Array<{ key: string; text: string; tone: Tone }> = [
    { key: 'student', text: studentLabel(draft.name, draft.studentId), tone: null },
  ];
  for (const column of matrixColumns(paper)) {
    const presented = sumKind(draft.board, column.docIds, column.full);
    entries.push({ key: column.key, text: presented.text, tone: presented.tone });
    if (presented.text !== DASH) attempts[column.key] = summarizeAttempts(column.docIds, facts, draft.board);
  }
  const total = totalPresentation(draft.board, paperFullScore(paper));
  entries.push({ key: 'total', text: total.text, tone: total.tone });
  if (type === 'homework') {
    entries.push({ key: 'late', text: String(lateProblemCount(paper.items, facts)), tone: null });
  } else {
    entries.push({ key: 'handedIn', text: handInText(draft.participant), tone: null });
  }
  return { entries, attempts };
}

function contestEntries(type: TeachType, paper: PaperState, draft: GradeDraft): Array<{ key: string; text: string; tone: Tone }> {
  const entries = identityEntries(draft);
  const full = paperFullScore(paper);
  if (type === 'exam' && paper.draw) {
    const total = totalPresentation(draft.board, full);
    entries.push({ key: 'total', text: total.text, tone: total.tone }, { key: 'status', text: attemptStatus(draft.participant), tone: null });
    return entries;
  }
  if (type === 'acm') {
    entries.push({ key: 'rank', text: draft.board ? draft.rank || DASH : DASH, tone: null });
    for (const item of paper.items) {
      const cell = draft.board?.cells.get(item.docId);
      if (!draft.board || !cell) {
        entries.push({ key: `problem:${item.docId}`, text: DASH, tone: null });
        continue;
      }
      const marker = acmMarker(cell.value);
      const pending = /color:\s*orange/i.test(cell.value);
      const tone = pending
        ? (marker.startsWith('-') || marker.startsWith('\u2212') ? 'danger' as const : null)
        : acmTone(marker);
      entries.push({ key: `problem:${item.docId}`, text: marker, tone });
    }
    entries.push({ key: 'penalty', text: penaltyText(draft.board), tone: null });
    return entries;
  }
  entries.push({ key: 'rank', text: draft.board ? draft.rank || DASH : DASH, tone: null });
  for (const item of paper.items) {
    const presented = presentedScore(draft.board?.cells.get(item.docId), item.score);
    entries.push({ key: `problem:${item.docId}`, text: presented.text, tone: presented.tone });
  }
  const total = totalPresentation(draft.board, full);
  entries.push({ key: 'total', text: total.text, tone: total.tone });
  return entries;
}

function assertPaper(paper: PaperState): void {
  if (!isRecord(paper) || !Array.isArray(paper.items)) invalid('试卷无效');
}

function buildContest(input: {
  type: TeachType;
  paper: PaperState;
  participants: TeachParticipantsPayload | null;
  board: ScoreboardTable | null;
  groupsById: Map<string, string>;
}): { columns: GradeColumn[]; rows: GradeRow[] } {
  const participants = input.participants?.participants ?? [];
  const seenParticipants = new Set<number>();
  for (const person of participants) {
    if (seenParticipants.has(person.uid)) invalid(`参与者重复：${person.uid}`);
    seenParticipants.add(person.uid);
  }
  const boardRows = input.board?.rows ?? [];
  const teamRows = boardRows.filter((row): row is ScoreboardRow & { teamName: string } => row.teamName !== null);
  const memberUids = new Set(teamRows.flatMap((row) => row.teamMemberUids));
  const byUid = new Map<number, ScoreboardRow>();
  for (const row of boardRows) {
    if (row.teamName !== null || row.uid === null) continue;
    if (byUid.has(row.uid)) invalid(`排行榜用户重复：${row.uid}`);
    byUid.set(row.uid, row);
  }
  const drafts: GradeDraft[] = [];
  const peopleByUid = new Map(participants.map((person) => [person.uid, person]));
  teamRows.forEach((row, index) => {
    const groupIds = [...new Set(row.teamMemberUids.flatMap((uid) => peopleByUid.get(uid)?.groupIds ?? []))].sort();
    drafts.push({
      key: `team:${index}:${row.teamMemberUids.join(',')}`,
      studentId: '',
      name: row.teamName,
      groupNames: '',
      groupIds,
      searchText: row.teamMemberUids.flatMap((uid) => {
        const person = peopleByUid.get(uid);
        return person ? [person.studentId, person.realName] : [];
      }).join('\n'),
      rank: row.rank,
      board: row,
      participant: null,
    });
  });
  const consumed = new Set<number>();
  for (const person of participants) {
    if (teamRows.length > 0 && memberUids.has(person.uid)) continue;
    consumed.add(person.uid);
    const board = byUid.get(person.uid) ?? null;
    drafts.push({
      key: `user:${person.uid}`,
      studentId: person.studentId,
      name: person.realName,
      groupNames: groupLabel(person.groupIds, input.groupsById),
      groupIds: person.groupIds.slice(),
      searchText: `${person.studentId}\n${person.realName}`,
      rank: board?.rank ?? '',
      board,
      participant: person,
    });
  }
  for (const [uid, row] of byUid) {
    if (consumed.has(uid) || memberUids.has(uid)) continue;
    drafts.push({
      key: `user:${uid}`,
      studentId: '',
      name: row.uname ?? '',
      groupNames: '',
      groupIds: [],
      searchText: row.uname ?? '',
      rank: row.rank,
      board: row,
      participant: null,
    });
  }
  const rows = drafts
    .map((draft, index) => ({ draft, index }))
    .sort((left, right) => compareDrafts(left.draft, right.draft) || left.index - right.index)
    .map(({ draft }) => {
      if (usesGradeMatrix(input.type, input.paper)) {
        const matrix = matrixRecord(input.type, input.paper, draft);
        return finishRow(draft, matrix.entries, matrix.attempts);
      }
      return finishRow(draft, contestEntries(input.type, input.paper, draft));
    });
  return { columns: contestColumns(input.type, input.paper, input.board), rows };
}

export function buildPracticeGrades(input: {
  paper: PaperState;
  roster: ReturnType<typeof parsePracticeRoster>;
  groupsById: Map<string, string>;
}): { columns: GradeColumn[]; rows: GradeRow[]; truncated: boolean } {
  assertPaper(input.paper);
  const { roster } = input;
  const liveIds = new Set(roster.rosterProblemIds);
  const stages = (input.paper.stages ?? []).map((stage) => ({
    title: stage.title,
    pids: input.paper.items.filter((item) => item.stageId === stage.id && liveIds.has(item.docId)).map((item) => item.docId),
  }));
  const seen = new Set<number>();
  const drafts = roster.members.map((member): GradeDraft & { done: number; total: number; completed: number[] } => {
    if (seen.has(member.uid)) invalid(`花名册用户重复：${member.uid}`);
    seen.add(member.uid);
    return {
      key: `user:${member.uid}`,
      studentId: member.studentId,
      name: member.realName,
      groupNames: groupLabel(member.groupIds, input.groupsById),
      groupIds: member.groupIds.slice(),
      searchText: `${member.studentId}\n${member.realName}`,
      rank: '',
      board: null,
      participant: null,
      done: member.done,
      total: member.total,
      completed: member.completedPids,
    };
  });
  const rows = drafts
    .map((draft, index) => ({ draft, index }))
    .sort((left, right) => compareDrafts(left.draft, right.draft) || left.index - right.index)
    .map(({ draft }) => {
      const completed = new Set(draft.completed);
      const stage = stages.find(({ pids }) => pids.some((pid) => !completed.has(pid))) ?? stages.at(-1);
      return finishRow(draft, [
        ...identityEntries(draft),
        { key: 'stage', text: stage?.title ?? DASH, tone: null },
        { key: 'done', text: `${draft.done} / ${draft.total}`, tone: null },
        { key: 'progress', text: progressText(draft.done, draft.total), tone: null },
      ]);
    });
  return {
    columns: [
      ...IDENTITY,
      { key: 'stage', header: '当前阶段', align: 'left' },
      { key: 'done', header: '完成', align: 'left' },
      { key: 'progress', header: '进度', align: 'center' },
    ],
    rows,
    truncated: roster.membersTruncated,
  };
}

export function buildGrades(input: {
  type: TeachType;
  rule: string;
  paper: PaperState;
  participants: TeachParticipantsPayload | null;
  board: ScoreboardTable | null;
  roster: unknown | null;
  groupsById: Map<string, string>;
}): { columns: GradeColumn[]; rows: GradeRow[]; truncated: boolean } {
  if (!isRecord(input) || !(input.groupsById instanceof Map)) invalid('成绩参数无效');
  if (typeof input.rule !== 'string') invalid('成绩赛制无效');
  const type = parseTeachType(input.type);
  if (type === 'practice') {
    if (input.roster == null) invalid('练习成绩缺少花名册');
    return buildPracticeGrades({ paper: input.paper, roster: parsePracticeRoster(input.roster), groupsById: input.groupsById });
  }
  assertPaper(input.paper);
  return {
    ...buildContest({
      type,
      paper: input.paper,
      participants: input.participants,
      board: input.board,
      groupsById: input.groupsById,
    }),
    truncated: false,
  };
}

function csvCell(value: string): string {
  let text = value;
  const first = text[0];
  if (first !== undefined && '=+-@'.includes(first)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function gradesCsv(columns: GradeColumn[], rows: GradeRow[]): string {
  if (!Array.isArray(columns) || !Array.isArray(rows)) invalid('成绩导出无效');
  const lines = [
    columns.map((column) => csvCell(requireString(column.header, '成绩列表头无效'))).join(','),
    ...rows.map((row) => columns.map((column) => {
      const value = row.cells[column.key];
      if (typeof value !== 'string') invalid(`成绩单元格缺失：${column.key}`);
      return csvCell(value);
    }).join(',')),
  ];
  return `\uFEFF${lines.join('\n')}`;
}
