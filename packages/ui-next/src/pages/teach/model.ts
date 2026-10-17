import { parseProblemKind, parseTeachType } from '@hydrooj/common';
import type { ProblemKind, TeachStatus, TeachType } from '@hydrooj/common';

export interface TeachListPayload {
  scope: 'mine' | 'shared' | 'all';
  canSeeAll: boolean;
  filter: { type: 'all' | 'practice' | 'quiz' | 'acm' | 'oi'; status: 'all' | TeachStatus; q: string };
  typeCounts: Record<'all' | 'practice' | 'quiz' | 'acm' | 'oi', number>;
  page: number;
  pageCount: number;
  total: number;
  rows: TeachListRow[];
  sharedRows: TeachSharedRow[];
  canCreate: Record<TeachType, boolean>;
}

export interface TeachListRow {
  type: TeachType;
  id: string;
  rule: string;
  title: string;
  status: TeachStatus;
  beginAt: string | null;
  endAt: string | null;
  durationMinutes: number | null;
  audience: string;
  problemCount: number;
  drawCount: number | null;
  stageCount: number | null;
  participantCount: number;
  role: 'owner' | 'maintainer' | 'admin';
  shared: boolean;
  createdAt: string;
}

export interface TeachSharedRow {
  type: TeachType;
  id: string;
  rule: string;
  title: string;
  ownerUid: number;
  ownerName: string;
  problemCount: number;
  drawCount: number | null;
  beginAt: string | null;
  endAt: string | null;
  durationMinutes: number | null;
  sharedAt: string;
}

export interface TeachNewPayload {
  canCreate: Record<TeachType, boolean>;
  initialType: TeachType | null;
  fromCourse: { courseId: string; chapterId: number } | null;
  copy: TeachCopySource | null;
}

export interface TeachCopySource {
  type: TeachType;
  id: string;
  title: string;
  content: string;
  description: string;
  ownerUid: number;
  ownerName: string;
  mine: boolean;
  rule: string;
  beginAt: string | null;
  endAt: string | null;
  durationMinutes: number | null;
  pids: number[];
  problems: Array<{ docId: number; pid: string; title: string; kind: ProblemKind }>;
  scores: Record<string, number>;
  examPaperQuotas: Partial<Record<ProblemKind, number>> | null;
  stages: TeachStage[] | null;
  settings: TeachCopySettings;
  unusablePids: number[];
}

export type TeachCopySettings =
  | {
      kind: 'contest';
      rated: boolean;
      autoHide: boolean;
      hidden: boolean;
      lockMinutes: number | null;
      allowViewCode: boolean;
      allowPrint: boolean;
      keepScoreboardHidden: boolean;
      allowVirtual: boolean | null;
      allowPostContestPractice: boolean | null;
      allowPostContestView: boolean | null;
      allowPostContestSubmit: boolean | null;
      langs: string[];
      examShowVerdict: boolean | null;
      examPassScore: number | null;
      examAttemptLimit: number | null;
    }
  | { kind: 'homework'; rated: boolean; langs: string[]; extensionDays: number; penaltyRules: Record<string, number> }
  | { kind: 'practice' };

export interface TeachWorkbenchPayload {
  container: TeachContainerSummary;
  paper: TeachPaper;
  stats: TeachStats;
  capabilities: TeachCapabilities;
}

export interface TeachContainerSummary {
  type: TeachType;
  id: string;
  rule: string;
  title: string;
  status: TeachStatus;
  beginAt: string | null;
  endAt: string | null;
  durationMinutes: number | null;
  penaltySince: string | null;
  lockAt: string | null;
  audience: TeachAudienceSummary;
  owner: TeachNamedUser;
  maintainers: TeachNamedUser[];
  createdAt: string;
  schoolShared: TeachShareStamp | null;
  copiedFrom: { type: TeachType; id: string; title: string; ownerName: string } | null;
  examPassScore: number | null;
  examAttemptLimit: number | null;
  participationMode: 'individual' | 'team';
  vigilEnabled: boolean;
  entryMode: 'open' | 'client_required';
  links: TeachLinks;
}

export interface TeachAudienceSummary {
  mode: 'all' | 'groups' | 'schools' | 'redeem_only';
  groupNames: string[];
  schoolNames: string[];
  boundStudentCount: number | null;
}

export interface TeachLinks {
  studentView: string;
  scoreboard: string | null;
  manage: string | null;
  users: string | null;
  clarification: string | null;
  grading: string | null;
  teams: string | null;
  balloon: string | null;
  print: string | null;
  code: string | null;
  files: string;
  redemption: string | null;
}

export interface TeachPaper {
  problems: TeachPaperProblem[];
  stages: TeachStage[] | null;
  examPaperQuotas: Partial<Record<ProblemKind, number>> | null;
}

export interface TeachPaperProblem {
  docId: number;
  pid: string;
  title: string;
  kind: ProblemKind;
  score: number | null;
  hidden: boolean;
  mine: boolean;
  difficulty: number | null;
}

export interface TeachStats {
  participantCount: number;
  startedCount: number | null;
  finalizedCount: number | null;
  submittedCount: number | null;
  recordCount: number | null;
  audienceCount: number | null;
  problemStats: Array<{ docId: number; accepted: number; attempted: number }> | null;
}

export interface TeachCapabilities {
  canDelete: boolean;
  canShare: boolean;
  canGrade: boolean;
  canManageTeamBatches: boolean;
  isSystemAdmin: boolean;
  canPin: boolean;
}

export interface TeachComposePayload {
  container: TeachContainerSummary;
  paper: TeachPaper;
  examStartedCount: number;
  knowledgeOptions: Array<{ id: string; mapId: string; label: string }>;
  canCreateObjective: boolean;
}

export interface TeachShareState {
  shared: TeachShareStamp | null;
  canShare: boolean;
  ownHiddenUnshared: TeachHiddenProblem[];
  othersHiddenUnshared: Array<TeachHiddenProblem & { ownerName: string }>;
}

export interface TeachKnowledgeTree {
  courses: TeachKnowledgeCourse[];
}

export interface TeachKnowledgeCourse {
  id: string;
  title: string;
  hidden: boolean;
  total: number;
  nodes: TeachKnowledgeNode[];
}

export interface TeachKnowledgeNode {
  id: string;
  title: string;
  count: number;
  children: TeachKnowledgeNode[];
}

export interface TeachBankPage {
  items: TeachBankItem[];
  page: number;
  pageCount: number;
  total: number;
}

export interface TeachBankItem {
  docId: number;
  pid: string;
  title: string;
  kind: ProblemKind;
  difficulty: number | null;
  tags: string[];
  nSubmit: number;
  nAccept: number;
  hidden: boolean;
  mine: boolean;
  schoolShared: boolean;
  ownerName: string;
  courseId: string | null;
  nodePath: string[];
}

export interface TeachBankPreview {
  item: TeachBankItem;
  content: string;
  objective: TeachObjectivePreview | null;
  limits: { timeMs: number | null; memoryMb: number | null };
}

export type TeachObjectivePreview =
  | { kind: 'single'; options: string[]; answerIndex: number }
  | { kind: 'multi'; options: string[]; answerIndexes: number[] }
  | { kind: 'true_false'; answer: boolean }
  | { kind: 'blank'; answer: string };

export interface TeachParticipantsPayload {
  participants: TeachParticipant[];
  groups: Array<{ id: string; name: string }>;
}

export interface TeachParticipant {
  uid: number;
  uname: string;
  studentId: string;
  realName: string;
  groupIds: string[];
  attended: boolean;
  startAt: string | null;
  finalizedAt: string | null;
  lastSubmitAt: string | null;
  late: boolean;
}

export interface HomeworkStartView {
  required: boolean;
  durationMinutes: number | null;
  startAt: string | null;
  personalEndAt: string | null;
}

interface TeachStage {
  id: number;
  title: string;
  requireIds: number[];
  pids: number[];
}

interface TeachNamedUser {
  uid: number;
  name: string;
}

interface TeachShareStamp {
  sharedAt: string;
  sharedByName: string;
}

interface TeachHiddenProblem {
  docId: number;
  pid: string;
  title: string;
}

type JsonRecord = Record<string, unknown>;

const TEACH_STATUSES = ['upcoming', 'running', 'ended', 'open'] as const;
const LIST_TYPES = ['all', 'practice', 'quiz', 'acm', 'oi'] as const;
const LIST_STATUSES = ['all', 'upcoming', 'running', 'ended', 'open'] as const;
const AUDIENCE_MODES = ['all', 'groups', 'schools', 'redeem_only'] as const;
const LIST_ROLES = ['owner', 'maintainer', 'admin'] as const;
const PARTICIPATION_MODES = ['individual', 'team'] as const;
const ENTRY_MODES = ['open', 'client_required'] as const;
const COPY_KINDS = ['contest', 'homework', 'practice'] as const;
const OBJECTIVE_KINDS = ['single', 'multi', 'true_false', 'blank'] as const;
const OBJECT_ID = /^[a-fA-F0-9]{24}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const TEACH_TYPE_LABEL: Record<TeachType, string> = {
  practice: '练习',
  homework: '作业与考试 · 逐题',
  exam: '作业与考试 · 整卷',
  acm: 'ACM 比赛',
  oi: 'OI·IOI 比赛',
};

export const TEACH_TYPE_NOUN: Record<TeachType, string> = {
  practice: '练习',
  homework: '作业',
  exam: '考试',
  acm: '比赛',
  oi: '比赛',
};

export const TEACH_KIND_LABEL: Record<ProblemKind, string> = {
  true_false: '判断题',
  single: '单选题',
  multi: '多选题',
  blank: '填空题',
  program_fill: '程序填空题',
  function: '函数题',
  programming: '编程题',
  subjective: '主观题',
};

export const TEACH_STATUS_LABEL: Record<TeachStatus, string> = {
  upcoming: '即将开始',
  running: '进行中',
  ended: '已结束',
  open: '不限时',
};

export const OI_RULE_LABEL: Record<string, string> = {
  oi: 'OI',
  ioi: 'IOI',
  strictioi: '严格 IOI',
  ledo: 'Ledo',
};

function invalid(path: string): never {
  throw new TypeError(`teach_payload_invalid:${path}`);
}

function join(parent: string, key: string): string {
  return parent ? `${parent}.${key}` : key;
}

function asRecord(value: unknown, path: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(path);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(path);
  return value as JsonRecord;
}

function readRequired(record: JsonRecord, key: string, parent: string): unknown {
  const path = join(parent, key);
  if (!Object.hasOwn(record, key)) invalid(path);
  return record[key];
}

function readRecord(record: JsonRecord, key: string, parent: string): JsonRecord {
  const path = join(parent, key);
  return asRecord(readRequired(record, key, parent), path);
}

function parseString(value: unknown, path: string): string {
  if (typeof value !== 'string') invalid(path);
  return value;
}

function parseInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid(path);
  return value;
}

function parseFinite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(path);
  return value;
}

function parseBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path);
  return value;
}

function parseIso(value: unknown, path: string): string {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value) || !Number.isFinite(Date.parse(value))) invalid(path);
  return value;
}

function parseObjectId(value: unknown, path: string): string {
  if (typeof value !== 'string' || !OBJECT_ID.test(value)) invalid(path);
  return value;
}

function readString(record: JsonRecord, key: string, parent: string): string {
  const path = join(parent, key);
  return parseString(readRequired(record, key, parent), path);
}

function readStringOrNull(record: JsonRecord, key: string, parent: string): string | null {
  const path = join(parent, key);
  const value = readRequired(record, key, parent);
  if (value === null) return null;
  return parseString(value, path);
}

function readInteger(record: JsonRecord, key: string, parent: string): number {
  const path = join(parent, key);
  return parseInteger(readRequired(record, key, parent), path);
}

function readIntegerOrNull(record: JsonRecord, key: string, parent: string): number | null {
  const path = join(parent, key);
  const value = readRequired(record, key, parent);
  if (value === null) return null;
  return parseInteger(value, path);
}

function readFiniteOrNull(record: JsonRecord, key: string, parent: string): number | null {
  const path = join(parent, key);
  const value = readRequired(record, key, parent);
  if (value === null) return null;
  return parseFinite(value, path);
}

function readBoolean(record: JsonRecord, key: string, parent: string): boolean {
  const path = join(parent, key);
  return parseBoolean(readRequired(record, key, parent), path);
}

function readBooleanOrNull(record: JsonRecord, key: string, parent: string): boolean | null {
  const path = join(parent, key);
  const value = readRequired(record, key, parent);
  if (value === null) return null;
  return parseBoolean(value, path);
}

function readIso(record: JsonRecord, key: string, parent: string): string {
  const path = join(parent, key);
  return parseIso(readRequired(record, key, parent), path);
}

function readIsoOrNull(record: JsonRecord, key: string, parent: string): string | null {
  const path = join(parent, key);
  const value = readRequired(record, key, parent);
  if (value === null) return null;
  return parseIso(value, path);
}

function readObjectId(record: JsonRecord, key: string, parent: string): string {
  const path = join(parent, key);
  return parseObjectId(readRequired(record, key, parent), path);
}

function readUnion<T extends string>(record: JsonRecord, key: string, parent: string, allowed: readonly T[]): T {
  const path = join(parent, key);
  const value = readRequired(record, key, parent);
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) invalid(path);
  return value as T;
}

function readArray(record: JsonRecord, key: string, parent: string): unknown[] {
  const path = join(parent, key);
  const value = readRequired(record, key, parent);
  if (!Array.isArray(value)) invalid(path);
  return value;
}

function readItems<T>(record: JsonRecord, key: string, parent: string, readItem: (value: unknown, path: string) => T): T[] {
  const path = join(parent, key);
  return readArray(record, key, parent).map((item, index) => readItem(item, `${path}[${index}]`));
}

function readItemsOrNull<T>(record: JsonRecord, key: string, parent: string, readItem: (value: unknown, path: string) => T): T[] | null {
  const path = join(parent, key);
  const value = readRequired(record, key, parent);
  if (value === null) return null;
  if (!Array.isArray(value)) invalid(path);
  return value.map((item, index) => readItem(item, `${path}[${index}]`));
}

function readStrings(record: JsonRecord, key: string, parent: string): string[] {
  return readItems(record, key, parent, parseString);
}

function readIntegers(record: JsonRecord, key: string, parent: string): number[] {
  return readItems(record, key, parent, parseInteger);
}

function readNumberMap(record: JsonRecord, key: string, parent: string): Record<string, number> {
  const path = join(parent, key);
  const source = readRecord(record, key, parent);
  const result: Record<string, number> = {};
  for (const [mapKey, item] of Object.entries(source)) {
    const itemPath = `${path}.${mapKey}`;
    if (typeof item !== 'number' || !Number.isFinite(item)) invalid(itemPath);
    Object.defineProperty(result, mapKey, { value: item, enumerable: true, writable: true, configurable: true });
  }
  return result;
}

function readTeachType(record: JsonRecord, key: string, parent: string): TeachType {
  const path = join(parent, key);
  try {
    return parseTeachType(readRequired(record, key, parent));
  } catch (error) {
    if (error instanceof TypeError) invalid(path);
    throw error;
  }
}

function readTeachTypeOrNull(record: JsonRecord, key: string, parent: string): TeachType | null {
  const path = join(parent, key);
  const value = readRequired(record, key, parent);
  if (value === null) return null;
  try {
    return parseTeachType(value);
  } catch (error) {
    if (error instanceof TypeError) invalid(path);
    throw error;
  }
}

function readProblemKind(record: JsonRecord, key: string, parent: string): ProblemKind {
  const path = join(parent, key);
  try {
    return parseProblemKind(readRequired(record, key, parent));
  } catch (error) {
    if (error instanceof TypeError) invalid(path);
    throw error;
  }
}

function readQuotas(record: JsonRecord, key: string, parent: string): Partial<Record<ProblemKind, number>> | null {
  const path = join(parent, key);
  const value = readRequired(record, key, parent);
  if (value === null) return null;
  const source = asRecord(value, path);
  const result: Partial<Record<ProblemKind, number>> = {};
  for (const [mapKey, item] of Object.entries(source)) {
    const itemPath = `${path}.${mapKey}`;
    let kind: ProblemKind;
    try {
      kind = parseProblemKind(mapKey);
    } catch (error) {
      if (error instanceof TypeError) invalid(itemPath);
      throw error;
    }
    result[kind] = parseInteger(item, itemPath);
  }
  return result;
}

function readCanCreate(record: JsonRecord, key: string, parent: string): Record<TeachType, boolean> {
  const path = join(parent, key);
  const source = readRecord(record, key, parent);
  return {
    practice: readBoolean(source, 'practice', path),
    homework: readBoolean(source, 'homework', path),
    exam: readBoolean(source, 'exam', path),
    acm: readBoolean(source, 'acm', path),
    oi: readBoolean(source, 'oi', path),
  };
}

function readTypeCounts(record: JsonRecord, key: string, parent: string): TeachListPayload['typeCounts'] {
  const path = join(parent, key);
  const source = readRecord(record, key, parent);
  return {
    all: readInteger(source, 'all', path),
    practice: readInteger(source, 'practice', path),
    quiz: readInteger(source, 'quiz', path),
    acm: readInteger(source, 'acm', path),
    oi: readInteger(source, 'oi', path),
  };
}

function readFilter(record: JsonRecord, key: string, parent: string): TeachListPayload['filter'] {
  const path = join(parent, key);
  const source = readRecord(record, key, parent);
  return {
    type: readUnion(source, 'type', path, LIST_TYPES),
    status: readUnion(source, 'status', path, LIST_STATUSES),
    q: readString(source, 'q', path),
  };
}

function readNamedUser(value: unknown, path: string): TeachNamedUser {
  const record = asRecord(value, path);
  return {
    uid: readInteger(record, 'uid', path),
    name: readString(record, 'name', path),
  };
}

function readStage(value: unknown, path: string): TeachStage {
  const record = asRecord(value, path);
  return {
    id: readInteger(record, 'id', path),
    title: readString(record, 'title', path),
    requireIds: readIntegers(record, 'requireIds', path),
    pids: readIntegers(record, 'pids', path),
  };
}

function readCopyProblem(value: unknown, path: string): TeachCopySource['problems'][number] {
  const record = asRecord(value, path);
  return {
    docId: readInteger(record, 'docId', path),
    pid: readString(record, 'pid', path),
    title: readString(record, 'title', path),
    kind: readProblemKind(record, 'kind', path),
  };
}

function readCopySettings(record: JsonRecord, key: string, parent: string): TeachCopySettings {
  const path = join(parent, key);
  const source = readRecord(record, key, parent);
  const kind = readUnion(source, 'kind', path, COPY_KINDS);
  if (kind === 'practice') return { kind };
  if (kind === 'homework') {
    return {
      kind,
      rated: readBoolean(source, 'rated', path),
      langs: readStrings(source, 'langs', path),
      extensionDays: readInteger(source, 'extensionDays', path),
      penaltyRules: readNumberMap(source, 'penaltyRules', path),
    };
  }
  return {
    kind,
    rated: readBoolean(source, 'rated', path),
    autoHide: readBoolean(source, 'autoHide', path),
    hidden: readBoolean(source, 'hidden', path),
    lockMinutes: readIntegerOrNull(source, 'lockMinutes', path),
    allowViewCode: readBoolean(source, 'allowViewCode', path),
    allowPrint: readBoolean(source, 'allowPrint', path),
    keepScoreboardHidden: readBoolean(source, 'keepScoreboardHidden', path),
    allowVirtual: readBooleanOrNull(source, 'allowVirtual', path),
    allowPostContestPractice: readBooleanOrNull(source, 'allowPostContestPractice', path),
    allowPostContestView: readBooleanOrNull(source, 'allowPostContestView', path),
    allowPostContestSubmit: readBooleanOrNull(source, 'allowPostContestSubmit', path),
    langs: readStrings(source, 'langs', path),
    examShowVerdict: readBooleanOrNull(source, 'examShowVerdict', path),
    examPassScore: readIntegerOrNull(source, 'examPassScore', path),
    examAttemptLimit: readIntegerOrNull(source, 'examAttemptLimit', path),
  };
}

function readCopySource(value: unknown, path: string): TeachCopySource {
  const record = asRecord(value, path);
  return {
    type: readTeachType(record, 'type', path),
    id: readObjectId(record, 'id', path),
    title: readString(record, 'title', path),
    content: readString(record, 'content', path),
    description: readString(record, 'description', path),
    ownerUid: readInteger(record, 'ownerUid', path),
    ownerName: readString(record, 'ownerName', path),
    mine: readBoolean(record, 'mine', path),
    rule: readString(record, 'rule', path),
    beginAt: readIsoOrNull(record, 'beginAt', path),
    endAt: readIsoOrNull(record, 'endAt', path),
    durationMinutes: readIntegerOrNull(record, 'durationMinutes', path),
    pids: readIntegers(record, 'pids', path),
    problems: readItems(record, 'problems', path, readCopyProblem),
    scores: readNumberMap(record, 'scores', path),
    examPaperQuotas: readQuotas(record, 'examPaperQuotas', path),
    stages: readItemsOrNull(record, 'stages', path, readStage),
    settings: readCopySettings(record, 'settings', path),
    unusablePids: readIntegers(record, 'unusablePids', path),
  };
}

function readListRow(value: unknown, path: string): TeachListRow {
  const record = asRecord(value, path);
  return {
    type: readTeachType(record, 'type', path),
    id: readObjectId(record, 'id', path),
    rule: readString(record, 'rule', path),
    title: readString(record, 'title', path),
    status: readUnion(record, 'status', path, TEACH_STATUSES),
    beginAt: readIsoOrNull(record, 'beginAt', path),
    endAt: readIsoOrNull(record, 'endAt', path),
    durationMinutes: readIntegerOrNull(record, 'durationMinutes', path),
    audience: readString(record, 'audience', path),
    problemCount: readInteger(record, 'problemCount', path),
    drawCount: readIntegerOrNull(record, 'drawCount', path),
    stageCount: readIntegerOrNull(record, 'stageCount', path),
    participantCount: readInteger(record, 'participantCount', path),
    role: readUnion(record, 'role', path, LIST_ROLES),
    shared: readBoolean(record, 'shared', path),
    createdAt: readIso(record, 'createdAt', path),
  };
}

function readSharedRow(value: unknown, path: string): TeachSharedRow {
  const record = asRecord(value, path);
  return {
    type: readTeachType(record, 'type', path),
    id: readObjectId(record, 'id', path),
    rule: readString(record, 'rule', path),
    title: readString(record, 'title', path),
    ownerUid: readInteger(record, 'ownerUid', path),
    ownerName: readString(record, 'ownerName', path),
    problemCount: readInteger(record, 'problemCount', path),
    drawCount: readIntegerOrNull(record, 'drawCount', path),
    beginAt: readIsoOrNull(record, 'beginAt', path),
    endAt: readIsoOrNull(record, 'endAt', path),
    durationMinutes: readIntegerOrNull(record, 'durationMinutes', path),
    sharedAt: readIso(record, 'sharedAt', path),
  };
}

function readFromCourse(value: unknown, path: string): NonNullable<TeachNewPayload['fromCourse']> {
  const record = asRecord(value, path);
  return {
    courseId: readObjectId(record, 'courseId', path),
    chapterId: readInteger(record, 'chapterId', path),
  };
}

function readAudience(record: JsonRecord, key: string, parent: string): TeachAudienceSummary {
  const path = join(parent, key);
  const source = readRecord(record, key, parent);
  return {
    mode: readUnion(source, 'mode', path, AUDIENCE_MODES),
    groupNames: readStrings(source, 'groupNames', path),
    schoolNames: readStrings(source, 'schoolNames', path),
    boundStudentCount: readIntegerOrNull(source, 'boundStudentCount', path),
  };
}

function readShareStamp(value: unknown, path: string): TeachShareStamp {
  const record = asRecord(value, path);
  return {
    sharedAt: readIso(record, 'sharedAt', path),
    sharedByName: readString(record, 'sharedByName', path),
  };
}

function readShareStampOrNull(record: JsonRecord, key: string, parent: string): TeachShareStamp | null {
  const path = join(parent, key);
  const value = readRequired(record, key, parent);
  if (value === null) return null;
  return readShareStamp(value, path);
}

function readCopiedFrom(value: unknown, path: string): NonNullable<TeachContainerSummary['copiedFrom']> {
  const record = asRecord(value, path);
  return {
    type: readTeachType(record, 'type', path),
    id: readObjectId(record, 'id', path),
    title: readString(record, 'title', path),
    ownerName: readString(record, 'ownerName', path),
  };
}

function readCopiedFromOrNull(record: JsonRecord, key: string, parent: string): TeachContainerSummary['copiedFrom'] {
  const path = join(parent, key);
  const value = readRequired(record, key, parent);
  if (value === null) return null;
  return readCopiedFrom(value, path);
}

function readLinks(record: JsonRecord, key: string, parent: string): TeachLinks {
  const path = join(parent, key);
  const source = readRecord(record, key, parent);
  return {
    studentView: readString(source, 'studentView', path),
    scoreboard: readStringOrNull(source, 'scoreboard', path),
    manage: readStringOrNull(source, 'manage', path),
    users: readStringOrNull(source, 'users', path),
    clarification: readStringOrNull(source, 'clarification', path),
    grading: readStringOrNull(source, 'grading', path),
    teams: readStringOrNull(source, 'teams', path),
    balloon: readStringOrNull(source, 'balloon', path),
    print: readStringOrNull(source, 'print', path),
    code: readStringOrNull(source, 'code', path),
    files: readString(source, 'files', path),
    redemption: readStringOrNull(source, 'redemption', path),
  };
}

function readContainer(value: unknown, path: string): TeachContainerSummary {
  const record = asRecord(value, path);
  return {
    type: readTeachType(record, 'type', path),
    id: readObjectId(record, 'id', path),
    rule: readString(record, 'rule', path),
    title: readString(record, 'title', path),
    status: readUnion(record, 'status', path, TEACH_STATUSES),
    beginAt: readIsoOrNull(record, 'beginAt', path),
    endAt: readIsoOrNull(record, 'endAt', path),
    durationMinutes: readIntegerOrNull(record, 'durationMinutes', path),
    penaltySince: readIsoOrNull(record, 'penaltySince', path),
    lockAt: readIsoOrNull(record, 'lockAt', path),
    audience: readAudience(record, 'audience', path),
    owner: readNamedUser(readRequired(record, 'owner', path), join(path, 'owner')),
    maintainers: readItems(record, 'maintainers', path, readNamedUser),
    createdAt: readIso(record, 'createdAt', path),
    schoolShared: readShareStampOrNull(record, 'schoolShared', path),
    copiedFrom: readCopiedFromOrNull(record, 'copiedFrom', path),
    examPassScore: readIntegerOrNull(record, 'examPassScore', path),
    examAttemptLimit: readIntegerOrNull(record, 'examAttemptLimit', path),
    participationMode: readUnion(record, 'participationMode', path, PARTICIPATION_MODES),
    vigilEnabled: readBoolean(record, 'vigilEnabled', path),
    entryMode: readUnion(record, 'entryMode', path, ENTRY_MODES),
    links: readLinks(record, 'links', path),
  };
}

function readPaperProblem(value: unknown, path: string): TeachPaperProblem {
  const record = asRecord(value, path);
  return {
    docId: readInteger(record, 'docId', path),
    pid: readString(record, 'pid', path),
    title: readString(record, 'title', path),
    kind: readProblemKind(record, 'kind', path),
    score: readFiniteOrNull(record, 'score', path),
    hidden: readBoolean(record, 'hidden', path),
    mine: readBoolean(record, 'mine', path),
    difficulty: readFiniteOrNull(record, 'difficulty', path),
  };
}

function readPaper(record: JsonRecord, key: string, parent: string): TeachPaper {
  const path = join(parent, key);
  const source = readRecord(record, key, parent);
  return {
    problems: readItems(source, 'problems', path, readPaperProblem),
    stages: readItemsOrNull(source, 'stages', path, readStage),
    examPaperQuotas: readQuotas(source, 'examPaperQuotas', path),
  };
}

function readProblemStat(value: unknown, path: string): NonNullable<TeachStats['problemStats']>[number] {
  const record = asRecord(value, path);
  return {
    docId: readInteger(record, 'docId', path),
    accepted: readInteger(record, 'accepted', path),
    attempted: readInteger(record, 'attempted', path),
  };
}

function readStats(record: JsonRecord, key: string, parent: string): TeachStats {
  const path = join(parent, key);
  const source = readRecord(record, key, parent);
  return {
    participantCount: readInteger(source, 'participantCount', path),
    startedCount: readIntegerOrNull(source, 'startedCount', path),
    finalizedCount: readIntegerOrNull(source, 'finalizedCount', path),
    submittedCount: readIntegerOrNull(source, 'submittedCount', path),
    recordCount: readIntegerOrNull(source, 'recordCount', path),
    audienceCount: readIntegerOrNull(source, 'audienceCount', path),
    problemStats: readItemsOrNull(source, 'problemStats', path, readProblemStat),
  };
}

function readCapabilities(record: JsonRecord, key: string, parent: string): TeachCapabilities {
  const path = join(parent, key);
  const source = readRecord(record, key, parent);
  return {
    canDelete: readBoolean(source, 'canDelete', path),
    canShare: readBoolean(source, 'canShare', path),
    canGrade: readBoolean(source, 'canGrade', path),
    canManageTeamBatches: readBoolean(source, 'canManageTeamBatches', path),
    isSystemAdmin: readBoolean(source, 'isSystemAdmin', path),
    canPin: readBoolean(source, 'canPin', path),
  };
}

function readKnowledgeOption(value: unknown, path: string): TeachComposePayload['knowledgeOptions'][number] {
  const record = asRecord(value, path);
  return {
    id: readString(record, 'id', path),
    mapId: readString(record, 'mapId', path),
    label: readString(record, 'label', path),
  };
}

function readHiddenProblem(value: unknown, path: string): TeachHiddenProblem {
  const record = asRecord(value, path);
  return {
    docId: readInteger(record, 'docId', path),
    pid: readString(record, 'pid', path),
    title: readString(record, 'title', path),
  };
}

function readOthersHidden(value: unknown, path: string): TeachShareState['othersHiddenUnshared'][number] {
  const record = asRecord(value, path);
  return {
    ...readHiddenProblem(value, path),
    ownerName: readString(record, 'ownerName', path),
  };
}

function readKnowledgeNode(value: unknown, path: string): TeachKnowledgeNode {
  const record = asRecord(value, path);
  return {
    id: readString(record, 'id', path),
    title: readString(record, 'title', path),
    count: readInteger(record, 'count', path),
    children: readItems(record, 'children', path, readKnowledgeNode),
  };
}

function readKnowledgeCourse(value: unknown, path: string): TeachKnowledgeCourse {
  const record = asRecord(value, path);
  return {
    id: readString(record, 'id', path),
    title: readString(record, 'title', path),
    hidden: readBoolean(record, 'hidden', path),
    total: readInteger(record, 'total', path),
    nodes: readItems(record, 'nodes', path, readKnowledgeNode),
  };
}

function readBankItem(value: unknown, path: string): TeachBankItem {
  const record = asRecord(value, path);
  return {
    docId: readInteger(record, 'docId', path),
    pid: readString(record, 'pid', path),
    title: readString(record, 'title', path),
    kind: readProblemKind(record, 'kind', path),
    difficulty: readFiniteOrNull(record, 'difficulty', path),
    tags: readStrings(record, 'tags', path),
    nSubmit: readInteger(record, 'nSubmit', path),
    nAccept: readInteger(record, 'nAccept', path),
    hidden: readBoolean(record, 'hidden', path),
    mine: readBoolean(record, 'mine', path),
    schoolShared: readBoolean(record, 'schoolShared', path),
    ownerName: readString(record, 'ownerName', path),
    courseId: readStringOrNull(record, 'courseId', path),
    nodePath: readStrings(record, 'nodePath', path),
  };
}

function readObjective(value: unknown, path: string): TeachObjectivePreview {
  const record = asRecord(value, path);
  const kind = readUnion(record, 'kind', path, OBJECTIVE_KINDS);
  if (kind === 'single') {
    return {
      kind,
      options: readStrings(record, 'options', path),
      answerIndex: readInteger(record, 'answerIndex', path),
    };
  }
  if (kind === 'multi') {
    return {
      kind,
      options: readStrings(record, 'options', path),
      answerIndexes: readIntegers(record, 'answerIndexes', path),
    };
  }
  if (kind === 'true_false') return { kind, answer: readBoolean(record, 'answer', path) };
  return { kind, answer: readString(record, 'answer', path) };
}

function readObjectiveOrNull(record: JsonRecord, key: string, parent: string): TeachObjectivePreview | null {
  const path = join(parent, key);
  const value = readRequired(record, key, parent);
  if (value === null) return null;
  return readObjective(value, path);
}

function readLimits(record: JsonRecord, key: string, parent: string): TeachBankPreview['limits'] {
  const path = join(parent, key);
  const source = readRecord(record, key, parent);
  return {
    timeMs: readFiniteOrNull(source, 'timeMs', path),
    memoryMb: readFiniteOrNull(source, 'memoryMb', path),
  };
}

function readParticipant(value: unknown, path: string): TeachParticipant {
  const record = asRecord(value, path);
  return {
    uid: readInteger(record, 'uid', path),
    uname: readString(record, 'uname', path),
    studentId: readString(record, 'studentId', path),
    realName: readString(record, 'realName', path),
    groupIds: readStrings(record, 'groupIds', path),
    attended: readBoolean(record, 'attended', path),
    startAt: readIsoOrNull(record, 'startAt', path),
    finalizedAt: readIsoOrNull(record, 'finalizedAt', path),
    lastSubmitAt: readIsoOrNull(record, 'lastSubmitAt', path),
    late: readBoolean(record, 'late', path),
  };
}

function readNamedGroup(value: unknown, path: string): TeachParticipantsPayload['groups'][number] {
  const record = asRecord(value, path);
  return {
    id: readString(record, 'id', path),
    name: readString(record, 'name', path),
  };
}

function readRoot(raw: unknown): JsonRecord {
  return asRecord(raw, '');
}

export function parseTeachListPayload(raw: unknown): TeachListPayload {
  const record = readRoot(raw);
  return {
    scope: readUnion(record, 'scope', '', ['mine', 'shared', 'all']),
    canSeeAll: readBoolean(record, 'canSeeAll', ''),
    filter: readFilter(record, 'filter', ''),
    typeCounts: readTypeCounts(record, 'typeCounts', ''),
    page: readInteger(record, 'page', ''),
    pageCount: readInteger(record, 'pageCount', ''),
    total: readInteger(record, 'total', ''),
    rows: readItems(record, 'rows', '', readListRow),
    sharedRows: readItems(record, 'sharedRows', '', readSharedRow),
    canCreate: readCanCreate(record, 'canCreate', ''),
  };
}

export function parseTeachNewPayload(raw: unknown): TeachNewPayload {
  const record = readRoot(raw);
  const fromCourse = readRequired(record, 'fromCourse', '');
  const copy = readRequired(record, 'copy', '');
  return {
    canCreate: readCanCreate(record, 'canCreate', ''),
    initialType: readTeachTypeOrNull(record, 'initialType', ''),
    fromCourse: fromCourse === null ? null : readFromCourse(fromCourse, 'fromCourse'),
    copy: copy === null ? null : readCopySource(copy, 'copy'),
  };
}

export function parseTeachCopySource(raw: unknown): TeachCopySource {
  return readCopySource(raw, '');
}

export function parseTeachWorkbenchPayload(raw: unknown): TeachWorkbenchPayload {
  const record = readRoot(raw);
  return {
    container: readContainer(readRequired(record, 'container', ''), 'container'),
    paper: readPaper(record, 'paper', ''),
    stats: readStats(record, 'stats', ''),
    capabilities: readCapabilities(record, 'capabilities', ''),
  };
}

export function parseTeachComposePayload(raw: unknown): TeachComposePayload {
  const record = readRoot(raw);
  return {
    container: readContainer(readRequired(record, 'container', ''), 'container'),
    paper: readPaper(record, 'paper', ''),
    examStartedCount: readInteger(record, 'examStartedCount', ''),
    knowledgeOptions: readItems(record, 'knowledgeOptions', '', readKnowledgeOption),
    canCreateObjective: readBoolean(record, 'canCreateObjective', ''),
  };
}

export function parseTeachShareState(raw: unknown): TeachShareState {
  const record = readRoot(raw);
  return {
    shared: readShareStampOrNull(record, 'shared', ''),
    canShare: readBoolean(record, 'canShare', ''),
    ownHiddenUnshared: readItems(record, 'ownHiddenUnshared', '', readHiddenProblem),
    othersHiddenUnshared: readItems(record, 'othersHiddenUnshared', '', readOthersHidden),
  };
}

export function parseTeachKnowledgeTree(raw: unknown): TeachKnowledgeTree {
  const record = readRoot(raw);
  return {
    courses: readItems(record, 'courses', '', readKnowledgeCourse),
  };
}

export function parseTeachBankPage(raw: unknown): TeachBankPage {
  const record = readRoot(raw);
  return {
    items: readItems(record, 'items', '', readBankItem),
    page: readInteger(record, 'page', ''),
    pageCount: readInteger(record, 'pageCount', ''),
    total: readInteger(record, 'total', ''),
  };
}

export function parseTeachBankPreview(raw: unknown): TeachBankPreview {
  const record = readRoot(raw);
  return {
    item: readBankItem(readRequired(record, 'item', ''), 'item'),
    content: readString(record, 'content', ''),
    objective: readObjectiveOrNull(record, 'objective', ''),
    limits: readLimits(record, 'limits', ''),
  };
}

export function parseTeachParticipants(raw: unknown): TeachParticipantsPayload {
  const record = readRoot(raw);
  return {
    participants: readItems(record, 'participants', '', readParticipant),
    groups: readItems(record, 'groups', '', readNamedGroup),
  };
}

function parseWindowDate(value: string | null): Date {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new TypeError('teach_window_invalid');
  return new Date(value);
}

function formatDay(date: Date, withYear: boolean): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const monthDay = `${month}-${day}`;
  return withYear ? `${date.getFullYear()}-${monthDay}` : monthDay;
}

function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatTeachWindow(
  input: { type: TeachType; beginAt: string | null; endAt: string | null; durationMinutes: number | null },
  now: Date,
): string {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TypeError('teach_window_invalid');
  if (parseTeachType(input.type) === 'practice') return '不限时';
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('teach_window_invalid');
  const begin = parseWindowDate(input.beginAt);
  const end = parseWindowDate(input.endAt);
  const withYear = begin.getFullYear() !== now.getFullYear() || end.getFullYear() !== now.getFullYear();
  const sameDay = begin.getFullYear() === end.getFullYear() && begin.getMonth() === end.getMonth() && begin.getDate() === end.getDate();
  const windowText = `${formatDay(begin, withYear)} ${formatClock(begin)} → ${sameDay ? formatClock(end) : `${formatDay(end, withYear)} ${formatClock(end)}`}`;
  if (input.durationMinutes === null) return windowText;
  if (typeof input.durationMinutes !== 'number' || !Number.isSafeInteger(input.durationMinutes)) throw new TypeError('teach_window_invalid');
  return `${windowText} · 限时 ${input.durationMinutes} 分钟`;
}
