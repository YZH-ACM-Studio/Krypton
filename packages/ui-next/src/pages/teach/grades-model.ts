import { parseTeachType, TEACH_KIND_ORDER } from '@hydrooj/common';
import type { ProblemKind, TeachType } from '@hydrooj/common';
import { TEACH_KIND_LABEL } from './model';
import type { TeachParticipant, TeachParticipantsPayload } from './model';
import { paperFullScore, paperNumbering } from './paper';
import type { PaperItem, PaperState } from './paper';

export interface ScoreCell {
  value: string;
  score: number | null;
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
  columns: Array<{ docId: number; header: string }>;
  rows: ScoreboardRow[];
}

export interface GradeColumn {
  key: string;
  header: string;
  align: 'left' | 'right' | 'center';
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
  return { value: cellText(cell, '排行榜题目分数无效'), score: cellScore(cell) };
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
  return {
    columns: header.columns,
    rows: raw.rows.slice(1).map((row) => parseDataRow(header.cells, row)),
  };
}

export function parsePracticeRoster(raw: unknown): {
  members: PracticeRosterMember[];
  membersTruncated: boolean;
  rosterProblemIds: number[];
} {
  if (!isRecord(raw) || !Array.isArray(raw.members)) invalid('花名册格式无效');
  if (raw.membersTruncated !== undefined && typeof raw.membersTruncated !== 'boolean') invalid('花名册截断标记无效');
  if (raw.rosterProblems !== undefined && !Array.isArray(raw.rosterProblems)) invalid('花名册题目无效');
  return {
    membersTruncated: raw.membersTruncated === true,
    rosterProblemIds: Array.isArray(raw.rosterProblems)
      ? raw.rosterProblems.map((pid) => requireSafeInt(pid, '花名册题目无效'))
      : [],
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
    full += item.score;
  }
  return full;
}

function docIdsOfKind(items: readonly PaperItem[], kind: ProblemKind): number[] {
  return items.filter((item) => item.kind === kind).map((item) => item.docId);
}

function kindsInPaper(items: readonly PaperItem[]): ProblemKind[] {
  const present = new Set(items.map((item) => item.kind));
  return TEACH_KIND_ORDER.filter((kind) => present.has(kind));
}

function attemptStatus(person: TeachParticipant | null): string {
  if (person?.finalizedAt) return '已交卷';
  if (person?.startAt) return '作答中';
  return '未开考';
}

function submitPresentation(person: TeachParticipant | null): { text: string; tone: Tone } {
  if (!person?.lastSubmitAt) return { text: '未提交', tone: null };
  const formatted = formatSubmitAt(person.lastSubmitAt);
  if (person.late) return { text: `${formatted} 迟交`, tone: 'danger' };
  return { text: formatted, tone: null };
}

function totalPresentation(row: ScoreboardRow | null, full: number | null): { text: string; tone: Tone } {
  if (!row || row.total.trim() === '') return { text: DASH, tone: null };
  const numeric = plainScore(row.total);
  if (numeric === null) return { text: row.total, tone: null };
  return { text: formatScore(numeric), tone: scoreTone(numeric, full) };
}

function penaltyText(row: ScoreboardRow | null): string {
  if (!row || row.solved === null || row.penalty === null) return DASH;
  return `${row.solved} ${DOT} ${row.penalty}`;
}

function currentStage(paper: PaperState, completed: ReadonlySet<number>, liveIds: ReadonlySet<number>): string {
  const stages = paper.stages ?? [];
  if (stages.length === 0) return DASH;
  for (const stage of stages) {
    const ids = paper.items
      .filter((item) => item.stageId === stage.id && liveIds.has(item.docId))
      .map((item) => item.docId);
    if (ids.some((id) => !completed.has(id))) return stage.title;
  }
  return stages[stages.length - 1]?.title ?? DASH;
}

function progressText(done: number, total: number): string {
  if (total === 0) return '0';
  return formatScore((done / total) * 100);
}

function finishRow(draft: GradeDraft, entries: Array<{ key: string; text: string; tone: Tone }>): GradeRow {
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
  };
}

function identityEntries(draft: GradeDraft): Array<{ key: string; text: string; tone: Tone }> {
  return [
    { key: 'studentId', text: draft.studentId, tone: null },
    { key: 'name', text: draft.name, tone: null },
    { key: 'group', text: draft.groupNames, tone: null },
  ];
}

function contestColumns(type: TeachType, paper: PaperState): GradeColumn[] {
  const columns = IDENTITY.slice();
  const numbers = paperNumbering(paper);
  const problemColumns = paper.items.map((item): GradeColumn => {
    const header = numbers.get(item.docId);
    if (header === undefined) invalid(`试卷题号缺失：${item.docId}`);
    return { key: `problem:${item.docId}`, header, align: 'center' };
  });
  if (type === 'exam' && paper.draw) {
    columns.push({ key: 'total', header: '总分', align: 'center' }, { key: 'status', header: '状态', align: 'left' });
    return columns;
  }
  if (type === 'exam') {
    for (const kind of kindsInPaper(paper.items)) {
      columns.push({ key: `kind:${kind}`, header: TEACH_KIND_LABEL[kind], align: 'center' });
    }
    columns.push({ key: 'total', header: '总分', align: 'center' }, { key: 'status', header: '状态', align: 'left' });
    return columns;
  }
  if (type === 'homework') {
    columns.push(...problemColumns, { key: 'total', header: '总分', align: 'center' }, { key: 'submit', header: '提交时间', align: 'left' });
    return columns;
  }
  if (type === 'acm') {
    columns.push({ key: 'rank', header: '#', align: 'center' }, ...problemColumns, { key: 'penalty', header: `通过 ${DOT} 罚时`, align: 'center' });
    return columns;
  }
  columns.push({ key: 'rank', header: '#', align: 'center' }, ...problemColumns, { key: 'total', header: '总分', align: 'center' });
  return columns;
}

function contestEntries(type: TeachType, paper: PaperState, draft: GradeDraft): Array<{ key: string; text: string; tone: Tone }> {
  const entries = identityEntries(draft);
  const full = paperFullScore(paper);
  if (type === 'exam' && paper.draw) {
    const total = totalPresentation(draft.board, full);
    entries.push({ key: 'total', text: total.text, tone: total.tone }, { key: 'status', text: attemptStatus(draft.participant), tone: null });
    return entries;
  }
  if (type === 'exam') {
    for (const kind of kindsInPaper(paper.items)) {
      const ids = docIdsOfKind(paper.items, kind);
      const summed = sumKind(draft.board, ids, kindFull(ids.map((docId) => {
        const item = paper.items.find((candidate) => candidate.docId === docId);
        if (!item) invalid(`试卷题目缺失：${docId}`);
        return item;
      })));
      entries.push({ key: `kind:${kind}`, text: summed.text, tone: summed.tone });
    }
    const total = totalPresentation(draft.board, full);
    entries.push({ key: 'total', text: total.text, tone: total.tone }, { key: 'status', text: attemptStatus(draft.participant), tone: null });
    return entries;
  }
  if (type === 'homework') {
    for (const item of paper.items) {
      const presented = presentedScore(draft.board?.cells.get(item.docId), item.score);
      entries.push({ key: `problem:${item.docId}`, text: presented.text, tone: presented.tone });
    }
    const total = totalPresentation(draft.board, full);
    const submit = submitPresentation(draft.participant);
    entries.push(
      { key: 'total', text: total.text, tone: total.tone },
      { key: 'submit', text: submit.text, tone: submit.tone },
    );
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
    .map(({ draft }) => finishRow(draft, contestEntries(input.type, input.paper, draft)));
  return { columns: contestColumns(input.type, input.paper), rows };
}

function buildPractice(input: {
  paper: PaperState;
  roster: unknown;
  groupsById: Map<string, string>;
}): { columns: GradeColumn[]; rows: GradeRow[] } {
  const roster = parsePracticeRoster(input.roster);
  const liveIds = new Set(roster.rosterProblemIds);
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
    .map(({ draft }) => finishRow(draft, [
      ...identityEntries(draft),
      { key: 'stage', text: currentStage(input.paper, new Set(draft.completed), liveIds), tone: null },
      { key: 'done', text: `${draft.done} / ${draft.total}`, tone: null },
      { key: 'progress', text: progressText(draft.done, draft.total), tone: null },
    ]));
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
  assertPaper(input.paper);
  const type = parseTeachType(input.type);
  if (type === 'practice') {
    if (input.roster == null) invalid('练习成绩缺少花名册');
    return buildPractice({ paper: input.paper, roster: input.roster, groupsById: input.groupsById });
  }
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
