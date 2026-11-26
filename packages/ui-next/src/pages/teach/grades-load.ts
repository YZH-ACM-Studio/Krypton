import { gradeCellValue, xlsxSheetName } from '@/lib/xlsx';
import type { XlsxSheet } from '@/lib/xlsx';
import { getJson, teachApi } from '@/pages/teach/api';
import {
  buildGrades,
  buildPracticeGrades,
  parsePracticeRoster,
  parseScoreboard,
} from '@/pages/teach/grades-model';
import type { GradeColumn, GradeRow, PracticePassProblem, PracticeRosterMember } from '@/pages/teach/grades-model';
import { parseTeachParticipants } from '@/pages/teach/model';
import type { TeachParticipant, TeachParticipantsPayload, TeachWorkbenchPayload } from '@/pages/teach/model';
import { paperFromPayload } from '@/pages/teach/paper';

const LOAD_FAILED = '读取成绩失败';

export interface NamedGroup {
  id: string;
  name: string;
}

export interface PracticeGradeFacts {
  membersByUid: Map<number, PracticeRosterMember>;
  problems: PracticePassProblem[];
}

export interface ReadyGrades {
  columns: GradeColumn[];
  rows: GradeRow[];
  groups: NamedGroup[];
  truncated: boolean;
  practice: PracticeGradeFacts | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `parseTeachParticipants` drops P15 `problems`. Grades still need those facts. */
function attachProblemFacts(raw: unknown, parsed: TeachParticipantsPayload): TeachParticipantsPayload {
  if (!isRecord(raw) || !Array.isArray(raw.participants)) return parsed;
  const byUid = new Map<number, unknown>();
  for (const item of raw.participants) {
    if (!isRecord(item) || typeof item.uid !== 'number' || !Number.isSafeInteger(item.uid)) continue;
    if (Object.hasOwn(item, 'problems')) byUid.set(item.uid, item.problems);
  }
  if (byUid.size === 0) return parsed;
  const participants = parsed.participants.map((person): TeachParticipant => {
    if (!byUid.has(person.uid)) return person;
    const copy = { ...person };
    Reflect.set(copy, 'problems', byUid.get(person.uid));
    return copy;
  });
  return { ...parsed, participants };
}

function uniqueGroups(groups: readonly NamedGroup[]): NamedGroup[] {
  const known = new Map<string, string>();
  const ordered: NamedGroup[] = [];
  for (const group of groups) {
    const existing = known.get(group.id);
    if (existing === undefined) {
      known.set(group.id, group.name);
      ordered.push(group);
      continue;
    }
    if (existing !== group.name) throw new TypeError(`用户组 ${group.id} 的名称不一致`);
  }
  return ordered;
}

function rosterGroups(members: readonly PracticeRosterMember[]): NamedGroup[] {
  const pairs: NamedGroup[] = [];
  for (const member of members) {
    member.groupIds.forEach((id, index) => {
      const name = member.groups[index];
      if (name === undefined || name === '') throw new TypeError(`花名册用户组 ${id} 没有名称`);
      pairs.push({ id, name });
    });
  }
  return uniqueGroups(pairs);
}

export async function loadGrades(payload: TeachWorkbenchPayload): Promise<ReadyGrades> {
  const paper = paperFromPayload(payload.paper, payload.container);
  if (payload.container.type === 'practice') {
    const raw = await getJson(`/problem-sets/${encodeURIComponent(payload.container.id)}/roster`, LOAD_FAILED);
    const roster = parsePracticeRoster(raw);
    const groups = rosterGroups(roster.members);
    const built = buildPracticeGrades({
      paper,
      roster,
      groupsById: new Map(groups.map((group) => [group.id, group.name])),
    });
    return {
      ...built,
      groups,
      practice: {
        membersByUid: new Map(roster.members.map((member) => [member.uid, member])),
        problems: roster.rosterProblems,
      },
    };
  }
  const scoreboard = payload.container.links.scoreboard;
  if (scoreboard === null || scoreboard === '') throw new TypeError('成绩页缺少排行榜链接');
  const [participantsRaw, boardRaw] = await Promise.all([
    getJson(teachApi.participants(payload.container.type, payload.container.id), LOAD_FAILED),
    getJson(scoreboard, LOAD_FAILED),
  ]);
  const participants = attachProblemFacts(participantsRaw, parseTeachParticipants(participantsRaw));
  const groups = uniqueGroups(participants.groups);
  const built = buildGrades({
    type: payload.container.type,
    rule: payload.container.rule,
    paper,
    participants,
    board: parseScoreboard(boardRaw),
    roster: null,
    groupsById: new Map(groups.map((group) => [group.id, group.name])),
  });
  return { ...built, groups, practice: null };
}

function columnSpec(column: GradeColumn, index: number): { key: string; header: string } {
  if (typeof column !== 'object' || column === null) throw new TypeError(`成绩列无效：${index + 1}`);
  if (typeof column.key !== 'string' || column.key === '') throw new TypeError(`成绩列无效：${index + 1}`);
  if (typeof column.header !== 'string') throw new TypeError('成绩列表头无效');
  return { key: column.key, header: column.header };
}

function sheetCell(row: GradeRow, key: string): ReturnType<typeof gradeCellValue> {
  if (typeof row !== 'object' || row === null || typeof row.cells !== 'object' || row.cells === null) {
    throw new TypeError(`成绩单元格缺失：${key}`);
  }
  const text = row.cells[key];
  if (typeof text !== 'string') throw new TypeError(`成绩单元格缺失：${key}`);
  return gradeCellValue(text);
}

/** One sheet matching the grades table. Headers stay text; cells go through `gradeCellValue`. */
export function gradesSheet(title: string, columns: GradeColumn[], rows: GradeRow[]): XlsxSheet {
  if (typeof title !== 'string') throw new TypeError('成绩表名无效');
  if (!Array.isArray(columns) || !Array.isArray(rows)) throw new TypeError('成绩导出无效');
  const specs = columns.map((column, index) => columnSpec(column, index));
  return {
    name: xlsxSheetName(title, new Set<string>()),
    rows: [
      specs.map((column) => column.header),
      ...rows.map((row) => specs.map((column) => sheetCell(row, column.key))),
    ],
  };
}
