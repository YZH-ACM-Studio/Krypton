/**
 * Legacy contest, homework, and practice edit snapshots and full-form bodies.
 * Contest dates use the old editor's local split. Homework dates use the handler's pre-split texts.
 */
import { TEACH_SCORED_CONTEST_RULES, TEACH_TYPES, type ProblemKind, type TeachType } from '@hydrooj/common';

export interface LegacyCatalogs {
  groups: Array<{ id: string; name: string; archived: boolean }>;
  schools: Array<{ id: string; name: string }>;
}

export interface ContestVigilFields {
  vigilEnabled: boolean;
  entryMode: 'open' | 'client_required';
  approvalMode: 'strict' | 'auto';
  lockdownMode: boolean;
  networkLockdownMode: boolean;
  networkLockdownFailurePolicy: string;
  networkWhitelistHosts: string;
  networkWhitelistIps: string;
  networkWhitelistPorts: string;
  pauseOnDisconnect: boolean;
  screenshotIntervalMs: number;
  exclusive: boolean;
  clientLoginBlockBeforeMinutes: number;
  clientLoginBlockAfterMinutes: number;
  liveEnabled: boolean;
  recordEnabled: boolean;
  cameraEnabled: boolean;
  screenshotJitterMs: number;
  vigilProcessWhitelist: string;
}

export interface ContestFormState {
  rule: string;
  title: string;
  content: string;
  beginDate: string;
  beginTime: string;
  windowHours: number;
  personalHours: number | null;
  pids: number[];
  scores: Record<number, number> | null;
  examPaperQuotas: Partial<Record<ProblemKind, number>> | null;
  rated: boolean;
  code: string;
  autoHide: boolean;
  assign: string[];
  hidden: boolean;
  lockMinutes: number | null;
  maintainer: number[];
  allowViewCode: boolean;
  allowPrint: boolean;
  keepScoreboardHidden: boolean;
  allowVirtual: boolean | null;
  allowPostContestPractice: boolean | null;
  allowPostContestView: boolean | null;
  allowPostContestSubmit: boolean | null;
  langs: string[];
  vigil: ContestVigilFields;
  participantScopeMode: 'none' | 'schools' | 'groups';
  participantSchoolIds: string[];
  participantGroupIds: string[];
  participationMode: 'individual' | 'team';
  participationRevision: number;
  teamModeClearConfirmation: string;
  plannedTeamBatchId: string | null;
  examShowVerdict: boolean | null;
  examPassScore: number | null;
  examAttemptLimit: number | null;
}

export interface HomeworkFormState {
  title: string;
  content: string;
  beginDate: string;
  beginTime: string;
  deadlineDate: string;
  deadlineTime: string;
  extensionDays: number;
  penaltyRules: Array<{ hours: number; coefficient: number }>;
  personalMinutes: number | null;
  pids: number[];
  scores: Record<number, number> | null;
  rated: boolean;
  maintainer: number[];
  assign: string[];
  langs: string[];
  participantScopeMode: 'none' | 'groups';
  participantGroupIds: string[];
  fromCourse: { courseId: string; chapterId: number } | null;
}

export interface PracticeStage {
  id: number;
  title: string;
  requireIds: number[];
  pids: number[];
}

export interface PracticeFormState {
  title: string;
  content: string;
  description: string;
  pin: boolean;
  stages: PracticeStage[];
  audiencePublic: boolean;
  audienceGroupIds: string[];
}

export interface ContestSnapshot {
  tid: string | null;
  state: ContestFormState;
  catalogs: LegacyCatalogs;
  extras: {
    activeTeamCount: number;
    recordCount: number;
    canAutoHideProblems: boolean;
    teamModeClearToken: string;
    canManageTeamBatches: boolean;
    canUpdatePlannedTeamBatch: boolean;
    teamBatchId: string | null;
    teamBatches: Array<{ batchId: string; name: string; status: string; teamCount: number; memberCount: number }>;
  };
}

export interface HomeworkSnapshot {
  tid: string | null;
  state: HomeworkFormState;
  catalogs: LegacyCatalogs;
  courseContext: { courseTitle: string; chapterTitle: string } | null;
}

export interface PracticeSnapshot {
  tid: string | null;
  state: PracticeFormState;
  catalogs: LegacyCatalogs;
}

type CreateContestRule = 'exam' | 'acm' | 'oi' | 'ioi' | 'strictioi';
interface PenaltyRule {
  hours: number;
  coefficient: number;
}

const CREATE_CONTEST_RULES: readonly CreateContestRule[] = ['exam', 'acm', 'oi', 'ioi', 'strictioi'];
const PENALTY_LINE = /^\s*['"]?([0-9]+(?:\.[0-9]+)?)['"]?\s*:\s*['"]?([0-9]+(?:\.[0-9]+)?)['"]?\s*(?:#.*)?$/;

export const DEFAULT_PENALTY_RULES: ReadonlyArray<PenaltyRule> = Object.freeze([
  Object.freeze({ hours: 1, coefficient: 0.9 }),
  Object.freeze({ hours: 3, coefficient: 0.8 }),
  Object.freeze({ hours: 12, coefficient: 0.75 }),
  Object.freeze({ hours: 9999, coefficient: 0.5 }),
]);

const VIGIL_DEFAULTS: ContestVigilFields = {
  vigilEnabled: false,
  entryMode: 'open',
  approvalMode: 'strict',
  lockdownMode: false,
  networkLockdownMode: false,
  networkLockdownFailurePolicy: 'strict',
  networkWhitelistHosts: '',
  networkWhitelistIps: '',
  networkWhitelistPorts: '',
  pauseOnDisconnect: false,
  screenshotIntervalMs: 60000,
  exclusive: false,
  clientLoginBlockBeforeMinutes: 60,
  clientLoginBlockAfterMinutes: 30,
  liveEnabled: true,
  recordEnabled: false,
  cameraEnabled: true,
  screenshotJitterMs: 30000,
  vigilProcessWhitelist: '',
};

function invalid(path: string): TypeError {
  return new TypeError(`teach_legacy_invalid:${path}`);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(path);
  return value as Record<string, unknown>;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(record, key);
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw invalid(path);
  return value;
}

function readBoolean(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  if (!hasOwn(record, key) || record[key] == null) return fallback;
  return requireBoolean(record[key], key);
}

function readOptionalBoolean(record: Record<string, unknown>, key: string): boolean | null {
  if (!hasOwn(record, key) || record[key] == null) return null;
  return requireBoolean(record[key], key);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw invalid(path);
  return value;
}

function readString(record: Record<string, unknown>, key: string, fallback = ''): string {
  if (!hasOwn(record, key) || record[key] == null) return fallback;
  return requireString(record[key], key);
}

function requireNonNegativeInt(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalid(path);
  return value;
}

function requireNonNegativeFinite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw invalid(path);
  return value;
}

function readInstant(value: unknown, path: string): Date {
  if (value instanceof Date || typeof value === 'string' || typeof value === 'number') {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  throw invalid(path);
}

function firstInstant(values: unknown[], path: string): Date {
  for (const value of values) {
    if (value == null || value === '') continue;
    return readInstant(value, path);
  }
  throw invalid(path);
}

function localDateAndTime(date: Date): { date: string; time: string } {
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function padDateText(value: string, path: string): string {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  if (!match?.[1] || !match[2] || !match[3]) throw invalid(path);
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function padTimeText(value: string, path: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match?.[1] || !match[2]) throw invalid(path);
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function readPositiveInts(value: unknown, path: string): number[] {
  if (typeof value === 'string') {
    if (!value.trim()) return [];
    return value.split(',').map((part) => readDocIdNumber(part.trim(), path));
  }
  if (!Array.isArray(value)) throw invalid(path);
  return value.map((item) => {
    if (typeof item === 'number') return readDocIdNumber(item, path);
    if (typeof item === 'string') return readDocIdNumber(item.trim(), path);
    throw invalid(path);
  });
}

function readDocIdNumber(value: unknown, path: string): number {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
  if (!/^[1-9]\d*$/.test(text)) throw invalid(path);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) throw invalid(path);
  return parsed;
}

function readStringList(value: unknown, path: string): string[] {
  if (value == null) return [];
  const source = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(source)) throw invalid(path);
  return source.map((item) => {
    if (typeof item !== 'string' && typeof item !== 'number') throw invalid(path);
    const text = String(item).trim();
    if (!text) throw invalid(path);
    return text;
  });
}

function readMaintainers(value: unknown): number[] {
  if (value == null) return [];
  const source = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(source)) throw invalid('maintainer');
  return source.map((item) => {
    const parsed = typeof item === 'number' ? item : typeof item === 'string' && item.trim() ? Number(item.trim()) : Number.NaN;
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw invalid('maintainer');
    return parsed;
  });
}

function readScoreMap(value: unknown): Record<number, number> | null {
  if (value == null) return null;
  const record = asRecord(value, 'score');
  const out: Record<number, number> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (!/^[1-9]\d*$/.test(key)) throw invalid('score');
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw invalid('score');
    out[Number(key)] = raw;
  }
  return Object.keys(out).length ? out : null;
}

function readQuotas(value: unknown): Partial<Record<ProblemKind, number>> | null {
  if (value == null) return null;
  const record = asRecord(value, 'examPaperQuotas');
  const out: Partial<Record<ProblemKind, number>> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1) throw invalid('examPaperQuotas');
    out[key as ProblemKind] = raw;
  }
  return Object.keys(out).length ? out : null;
}

function readPassScore(value: unknown): number | null {
  if (value == null || value === '' || value === 0) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw invalid('examPassScore');
  return parsed;
}

function readAttemptLimit(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw invalid('examAttemptLimit');
  return parsed;
}

function readOptionalObjectId(record: Record<string, unknown>, key: string): string | null {
  if (!hasOwn(record, key) || record[key] == null || record[key] === '') return null;
  const value = requireString(record[key], key);
  if (!value) return null;
  return value;
}

function readListText(value: unknown, path: string): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) throw invalid(path);
  const parts: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') throw invalid(path);
    const trimmed = item.trim();
    if (trimmed) parts.push(trimmed);
  }
  return parts.join('\n');
}

function readEntryMode(value: unknown): ContestVigilFields['entryMode'] {
  if (value == null) return 'open';
  if (value === 'open' || value === 'client_required') return value;
  throw invalid('entryMode');
}

function readApprovalMode(value: unknown): ContestVigilFields['approvalMode'] {
  if (value == null) return 'strict';
  if (value === 'strict' || value === 'auto') return value;
  throw invalid('approvalMode');
}

function readFailurePolicy(value: unknown): string {
  if (value == null) return 'strict';
  if (value === 'strict' || value === 'report_only' || value === 'off') return value;
  throw invalid('networkLockdownFailurePolicy');
}

function readCountDefault(value: unknown, fallback: number, path: string): number {
  if (value == null) return fallback;
  return requireNonNegativeInt(value, path);
}

function readVigil(tdoc: Record<string, unknown> | null): ContestVigilFields {
  if (!tdoc) return { ...VIGIL_DEFAULTS };
  const lockdownMode = readBoolean(tdoc, 'lockdownMode', false);
  const networkLockdownMode =
    hasOwn(tdoc, 'networkLockdownMode') && tdoc.networkLockdownMode != null
      ? requireBoolean(tdoc.networkLockdownMode, 'networkLockdownMode')
      : lockdownMode;
  return {
    vigilEnabled: readBoolean(tdoc, 'vigilEnabled', false),
    entryMode: readEntryMode(tdoc.entryMode),
    approvalMode: readApprovalMode(tdoc.approvalMode),
    lockdownMode,
    networkLockdownMode,
    networkLockdownFailurePolicy: readFailurePolicy(tdoc.networkLockdownFailurePolicy),
    networkWhitelistHosts: readListText(tdoc.networkWhitelistHosts, 'networkWhitelistHosts'),
    networkWhitelistIps: readListText(tdoc.networkWhitelistIps, 'networkWhitelistIps'),
    networkWhitelistPorts: readListText(tdoc.networkWhitelistPorts, 'networkWhitelistPorts'),
    pauseOnDisconnect: readBoolean(tdoc, 'pauseOnDisconnect', false),
    screenshotIntervalMs: readCountDefault(tdoc.screenshotIntervalMs, VIGIL_DEFAULTS.screenshotIntervalMs, 'screenshotIntervalMs'),
    exclusive: readBoolean(tdoc, 'exclusive', false),
    clientLoginBlockBeforeMinutes: readCountDefault(
      tdoc.clientLoginBlockBeforeMinutes,
      VIGIL_DEFAULTS.clientLoginBlockBeforeMinutes,
      'clientLoginBlockBeforeMinutes',
    ),
    clientLoginBlockAfterMinutes: readCountDefault(
      tdoc.clientLoginBlockAfterMinutes,
      VIGIL_DEFAULTS.clientLoginBlockAfterMinutes,
      'clientLoginBlockAfterMinutes',
    ),
    liveEnabled: readBoolean(tdoc, 'liveEnabled', true),
    recordEnabled: readBoolean(tdoc, 'recordEnabled', false),
    cameraEnabled: readBoolean(tdoc, 'cameraEnabled', true),
    screenshotJitterMs: readCountDefault(tdoc.screenshotJitterMs, VIGIL_DEFAULTS.screenshotJitterMs, 'screenshotJitterMs'),
    vigilProcessWhitelist: readListText(tdoc.vigilProcessWhitelist, 'vigilProcessWhitelist'),
  };
}

function readScopeMode(value: unknown): ContestFormState['participantScopeMode'] {
  if (value == null) return 'none';
  if (value === 'none' || value === 'schools' || value === 'groups') return value;
  throw invalid('participantScopeMode');
}

function readHomeworkScopeMode(value: unknown): HomeworkFormState['participantScopeMode'] {
  if (value == null) return 'none';
  if (value === 'none' || value === 'groups') return value;
  throw invalid('participantScopeMode');
}

function readParticipationMode(value: unknown): ContestFormState['participationMode'] {
  if (value == null) return 'individual';
  if (value === 'individual' || value === 'team') return value;
  throw invalid('participationMode');
}

/** Edit snapshots must carry the top-level invite code. Document `_code` / `code` are not in the JSON. */
function readInviteCode(record: Record<string, unknown>, editing: boolean): string {
  if (!hasOwn(record, 'inviteCode')) {
    if (editing) throw new TypeError('teach_payload_invalid:inviteCode');
    return '';
  }
  const value = record.inviteCode;
  if (typeof value !== 'string') throw new TypeError('teach_payload_invalid:inviteCode');
  return value;
}

function readPersonalHours(tdoc: Record<string, unknown>): number | null {
  if (!hasOwn(tdoc, 'duration') || tdoc.duration == null || tdoc.duration === 0) return null;
  const value = requireNonNegativeFinite(tdoc.duration, 'personalHours');
  if (value <= 0) return null;
  return value;
}

function readLockMinutes(tdoc: Record<string, unknown>): number | null {
  if (!hasOwn(tdoc, 'lockAt') || tdoc.lockAt == null) return null;
  const end = firstInstant([tdoc.endAt], 'endAt');
  const lock = readInstant(tdoc.lockAt, 'lockAt');
  return Math.max(0, Math.round((end.getTime() - lock.getTime()) / 60000));
}

function readSchools(value: unknown, path: string): LegacyCatalogs['schools'] {
  if (!Array.isArray(value)) throw invalid(path);
  return value.map((item, index) => {
    const row = asRecord(item, `${path}[${index}]`);
    const id = requireString(row._id, path);
    const name = requireString(row.name, path);
    if (!id) throw invalid(path);
    return { id, name };
  });
}

function readGroups(value: unknown, path: string): LegacyCatalogs['groups'] {
  if (!Array.isArray(value)) throw invalid(path);
  return value.map((item, index) => {
    const row = asRecord(item, `${path}[${index}]`);
    const id = requireString(row._id, path);
    const name = requireString(row.name, path);
    if (!id) throw invalid(path);
    const archived = hasOwn(row, 'archivedAt') && row.archivedAt != null && row.archivedAt !== '';
    return { id, name, archived };
  });
}

function readTeamBatches(value: unknown): ContestSnapshot['extras']['teamBatches'] {
  if (!Array.isArray(value)) throw invalid('teamBatches');
  return value.map((item, index) => {
    const row = asRecord(item, `teamBatches[${index}]`);
    const batchId = requireString(row.batchId, 'teamBatches.batchId');
    const name = requireString(row.name, 'teamBatches.name');
    const status = requireString(row.status, 'teamBatches.status');
    if (!batchId || !status) throw invalid('teamBatches');
    return {
      batchId,
      name,
      status,
      teamCount: requireNonNegativeInt(row.teamCount, 'teamBatches.teamCount'),
      memberCount: requireNonNegativeInt(row.memberCount, 'teamBatches.memberCount'),
    };
  });
}

function readDocumentId(tdoc: Record<string, unknown>): string {
  const docId = hasOwn(tdoc, 'docId') ? tdoc.docId : undefined;
  const id = hasOwn(tdoc, '_id') ? tdoc._id : undefined;
  if (typeof docId === 'string' && docId) return docId;
  if (typeof id === 'string' && id) return id;
  throw invalid('tid');
}

function isCreateContestRule(value: unknown): value is CreateContestRule {
  return typeof value === 'string' && (CREATE_CONTEST_RULES as readonly string[]).includes(value);
}

function copyPenaltyDefaults(): PenaltyRule[] {
  return DEFAULT_PENALTY_RULES.map((row) => ({ hours: row.hours, coefficient: row.coefficient }));
}

function penaltyFromObject(record: Record<string, unknown>): PenaltyRule[] {
  const rows: PenaltyRule[] = [];
  for (const [key, raw] of Object.entries(record)) {
    if (!/^[0-9]+(?:\.[0-9]+)?$/.test(key)) throw invalid('penaltyRules');
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw invalid('penaltyRules');
    rows.push({ hours: Number(key), coefficient: raw });
  }
  return rows.length ? rows : copyPenaltyDefaults();
}

function parsePenaltyRules(value: unknown): PenaltyRule[] {
  if (value == null) return copyPenaltyDefaults();
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '{}' || trimmed === '---' || trimmed === 'null') return copyPenaltyDefaults();
    const rows: PenaltyRule[] = [];
    for (const line of trimmed.split('\n')) {
      if (!line.trim()) continue;
      const match = PENALTY_LINE.exec(line);
      if (!match?.[1] || !match[2]) throw invalid('penaltyRules');
      rows.push({ hours: Number(match[1]), coefficient: Number(match[2]) });
    }
    if (!rows.length) throw invalid('penaltyRules');
    return rows;
  }
  return penaltyFromObject(asRecord(value, 'penaltyRules'));
}

function readPersonalMinutes(tdoc: Record<string, unknown> | null): number | null {
  if (!tdoc) return null;
  const hours = readPersonalHours(tdoc);
  if (hours === null) return null;
  const minutes = hours * 60;
  const nearest = Math.round(minutes);
  // Six-decimal hours drift by about 3e-5 minutes; 1e-3 still snaps those back to an integer minute.
  return Math.abs(minutes - nearest) < 1e-3 ? nearest : minutes;
}

function emptyStage(): PracticeStage {
  return { id: 1, title: '阶段 1', requireIds: [], pids: [] };
}

function readStage(value: unknown, index: number): PracticeStage {
  const row = asRecord(value, `dag[${index}]`);
  if (hasOwn(row, 'sections')) throw invalid('dag');
  const idSource = hasOwn(row, '_id') ? row._id : row.id;
  const id = readDocIdNumber(idSource, 'dag');
  if (!hasOwn(row, 'title')) throw invalid('dag');
  const title = requireString(row.title, 'dag');
  const requireSource = hasOwn(row, 'requireNids') ? row.requireNids : row.requireIds;
  const requireIds = requireSource == null ? [] : readPositiveInts(requireSource, 'dag');
  const pids = hasOwn(row, 'pids') ? readPositiveInts(row.pids, 'dag') : [];
  return { id, title, requireIds, pids };
}

function readStages(value: unknown): PracticeStage[] {
  let source: unknown = value;
  if (typeof value === 'string') {
    if (!value.trim()) throw invalid('dag');
    try {
      source = JSON.parse(value) as unknown;
    } catch {
      throw invalid('dag');
    }
  }
  if (!Array.isArray(source) || source.length === 0) throw invalid('dag');
  return source.map((node, index) => readStage(node, index));
}

function readAudience(value: unknown): { public: boolean; groupIds: string[] } {
  if (value == null) return { public: true, groupIds: [] };
  const record = asRecord(value, 'audience');
  const isPublic = hasOwn(record, 'public') ? requireBoolean(record.public, 'audiencePublic') : true;
  const groupIds = hasOwn(record, 'groupIds') ? readStringList(record.groupIds, 'audienceGroupIds') : [];
  return { public: isPublic, groupIds };
}

function readPin(tdoc: Record<string, unknown> | null): boolean {
  if (!tdoc || !hasOwn(tdoc, 'pin') || tdoc.pin == null) return false;
  const value = tdoc.pin;
  if (value === 1 || value === '1' || value === true) return true;
  if (value === 0 || value === '0' || value === false) return false;
  throw invalid('pin');
}

function readCourseContext(value: unknown): HomeworkSnapshot['courseContext'] {
  if (value == null) return null;
  const record = asRecord(value, 'courseContext');
  return {
    courseTitle: requireString(record.courseTitle, 'courseContext'),
    chapterTitle: requireString(record.chapterTitle, 'courseContext'),
  };
}

function readFromCourse(record: Record<string, unknown>): HomeworkFormState['fromCourse'] {
  const courseId = readString(record, 'fromCourse');
  if (!courseId) return null;
  const chapter = record.chapter;
  const chapterId = typeof chapter === 'number' ? chapter : typeof chapter === 'string' && chapter.trim() ? Number(chapter) : Number.NaN;
  if (!Number.isSafeInteger(chapterId) || chapterId < 1) throw invalid('chapter');
  return { courseId, chapterId };
}

function flag(value: boolean): string {
  return value ? 'true' : 'false';
}

function joinCsv(values: readonly (string | number)[]): string {
  return values.join(',');
}

function jsonNumbers(value: Record<number, number> | Partial<Record<string, number>>, path: string): string {
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw invalid(path);
    out[key] = raw;
  }
  return JSON.stringify(out);
}

/** Integers ≥1 that are still in the paper. Anything else is omitted; the server fills 100. */
function postedPoolScores(pids: readonly number[], scores: Record<number, number>): string {
  const allowed = new Set(pids);
  const out: Record<string, number> = {};
  for (const pid of pids) {
    if (!allowed.has(pid)) continue;
    const raw = scores[pid];
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1) continue;
    out[String(pid)] = raw;
    allowed.delete(pid);
  }
  return JSON.stringify(out);
}

function formatDecimal(value: number, path: string): string {
  if (!Number.isFinite(value)) throw invalid(path);
  return String(Math.round(value * 1e6) / 1e6);
}

function contestDurationFromMinutes(minutes: number | null): string {
  if (minutes === null) return '';
  return formatDecimal(minutes / 60, 'personalMinutes');
}

function penaltyPayload(state: HomeworkFormState): string {
  if (state.extensionDays === 0) return '{}';
  if (!state.penaltyRules.length) throw invalid('penaltyRules');
  return state.penaltyRules
    .map((row) => `${formatDecimal(row.hours, 'penaltyRules')}: ${formatDecimal(row.coefficient, 'penaltyRules')}`)
    .join('\n');
}

function isContestCreate(record: Record<string, unknown>): boolean {
  const page = record.page_name;
  if (page === 'contest_create') return true;
  if (page === 'contest_edit') return false;
  if (page != null) throw invalid('page_name');
  if (record.tdoc && typeof record.tdoc === 'object') return false;
  throw invalid('page_name');
}

function contestExtras(record: Record<string, unknown>, teamBatchId: string | null): ContestSnapshot['extras'] {
  if (!hasOwn(record, 'participationRevision')) throw invalid('participationRevision');
  return {
    activeTeamCount: requireNonNegativeInt(record.activeTeamCount, 'activeTeamCount'),
    recordCount: requireNonNegativeInt(record.recordCount, 'recordCount'),
    canAutoHideProblems: requireBoolean(record.canAutoHideProblems, 'canAutoHideProblems'),
    teamModeClearToken: readString(record, 'teamModeClearConfirmation'),
    canManageTeamBatches: requireBoolean(record.canManageTeamBatches, 'canManageTeamBatches'),
    canUpdatePlannedTeamBatch: requireBoolean(record.canUpdatePlannedTeamBatch, 'canUpdatePlannedTeamBatch'),
    teamBatchId,
    teamBatches: readTeamBatches(record.teamBatches),
  };
}

function createContestState(record: Record<string, unknown>, createRule: CreateContestRule): ContestFormState {
  const exam = createRule === 'exam';
  const begin = localDateAndTime(firstInstant([record.beginAt], 'beginAt'));
  const canAutoHideProblems = requireBoolean(record.canAutoHideProblems, 'canAutoHideProblems');
  return {
    rule: createRule,
    title: '',
    content: '',
    beginDate: begin.date,
    beginTime: begin.time,
    windowHours: requireNonNegativeFinite(record.duration, 'windowHours'),
    personalHours: null,
    pids: [],
    scores: null,
    examPaperQuotas: null,
    rated: !exam,
    code: readInviteCode(record, false),
    autoHide: exam ? false : canAutoHideProblems,
    assign: [],
    hidden: false,
    lockMinutes: null,
    maintainer: [],
    allowViewCode: !exam,
    allowPrint: false,
    keepScoreboardHidden: false,
    allowVirtual: !exam,
    allowPostContestPractice: true,
    allowPostContestView: true,
    allowPostContestSubmit: true,
    langs: [],
    vigil: readVigil(null),
    participantScopeMode: 'none',
    participantSchoolIds: [],
    participantGroupIds: [],
    participationMode: 'individual',
    participationRevision: requireNonNegativeInt(record.participationRevision, 'participationRevision'),
    teamModeClearConfirmation: '',
    plannedTeamBatchId: null,
    examShowVerdict: exam ? true : null,
    examPassScore: null,
    examAttemptLimit: null,
  };
}

function editContestState(record: Record<string, unknown>, tdoc: Record<string, unknown>): ContestFormState {
  const rule = readString(tdoc, 'rule');
  if (!rule) throw invalid('rule');
  const exam = rule === 'exam';
  const begin = localDateAndTime(firstInstant([record.beginAt, tdoc.beginAt], 'beginAt'));
  const pids = hasOwn(tdoc, 'pids') ? readPositiveInts(tdoc.pids, 'pids') : readPositiveInts(record.pids, 'pids');
  return {
    rule,
    title: readString(tdoc, 'title'),
    content: readString(tdoc, 'content'),
    beginDate: begin.date,
    beginTime: begin.time,
    windowHours: requireNonNegativeFinite(record.duration, 'windowHours'),
    personalHours: readPersonalHours(tdoc),
    pids,
    scores: readScoreMap(tdoc.score),
    examPaperQuotas: exam ? readQuotas(tdoc.examPaperQuotas) : null,
    rated: readBoolean(tdoc, 'rated', false),
    code: readInviteCode(record, true),
    autoHide: readBoolean(tdoc, 'autoHide', false),
    assign: readStringList(tdoc.assign, 'assign'),
    hidden: readBoolean(tdoc, 'hidden', false),
    lockMinutes: readLockMinutes(tdoc),
    maintainer: readMaintainers(tdoc.maintainer),
    allowViewCode: readBoolean(tdoc, 'allowViewCode', false),
    allowPrint: readBoolean(tdoc, 'allowPrint', false),
    keepScoreboardHidden: readBoolean(tdoc, 'keepScoreboardHidden', false),
    allowVirtual: readOptionalBoolean(tdoc, 'allowVirtual'),
    allowPostContestPractice: readOptionalBoolean(tdoc, 'allowPostContestPractice'),
    allowPostContestView: readOptionalBoolean(tdoc, 'allowPostContestView'),
    allowPostContestSubmit: readOptionalBoolean(tdoc, 'allowPostContestSubmit'),
    langs: readStringList(tdoc.langs, 'langs'),
    vigil: readVigil(tdoc),
    participantScopeMode: readScopeMode(tdoc.participantScopeMode),
    participantSchoolIds: readStringList(tdoc.participantSchoolIds, 'participantSchoolIds'),
    participantGroupIds: readStringList(tdoc.participantGroupIds, 'participantGroupIds'),
    participationMode: readParticipationMode(tdoc.participationMode),
    participationRevision: requireNonNegativeInt(record.participationRevision, 'participationRevision'),
    teamModeClearConfirmation: '',
    plannedTeamBatchId: readOptionalObjectId(tdoc, 'plannedTeamBatchId'),
    examShowVerdict: exam ? readBoolean(tdoc, 'examShowVerdict', true) : null,
    examPassScore: exam ? readPassScore(tdoc.examPassScore) : null,
    examAttemptLimit: exam ? readAttemptLimit(tdoc.examAttemptLimit) : null,
  };
}

function contestCatalogs(record: Record<string, unknown>): LegacyCatalogs {
  return {
    schools: readSchools(record.scopeSchools, 'scopeSchools'),
    groups: readGroups(record.scopeGroups, 'scopeGroups'),
  };
}

export function parseContestSnapshot(raw: unknown, createRule?: CreateContestRule): ContestSnapshot {
  const record = asRecord(raw, 'contest');
  if (isContestCreate(record)) {
    if (!isCreateContestRule(createRule)) throw invalid('rule');
    return {
      tid: null,
      state: createContestState(record, createRule),
      catalogs: contestCatalogs(record),
      extras: contestExtras(record, null),
    };
  }
  const tdoc = asRecord(record.tdoc, 'tdoc');
  return {
    tid: readDocumentId(tdoc),
    state: editContestState(record, tdoc),
    catalogs: contestCatalogs(record),
    extras: contestExtras(record, readOptionalObjectId(tdoc, 'teamBatchId')),
  };
}

function homeworkDocument(record: Record<string, unknown>, editing: boolean): Record<string, unknown> | null {
  if (!hasOwn(record, 'tdoc') || record.tdoc == null) {
    if (editing) throw invalid('tdoc');
    return null;
  }
  return asRecord(record.tdoc, 'tdoc');
}

export function parseHomeworkSnapshot(raw: unknown): HomeworkSnapshot {
  const record = asRecord(raw, 'homework');
  const page = record.page_name;
  if (page !== 'homework_edit' && page !== 'homework_create') throw invalid('page_name');
  const editing = page === 'homework_edit';
  const tdoc = homeworkDocument(record, editing);
  const extensionDays = requireNonNegativeFinite(record.extensionDays, 'extensionDays');
  return {
    tid: editing && tdoc ? readDocumentId(tdoc) : null,
    state: {
      title: tdoc ? readString(tdoc, 'title') : '',
      content: tdoc ? readString(tdoc, 'content') : '',
      beginDate: padDateText(requireString(record.dateBeginText, 'beginAtDate'), 'beginAtDate'),
      beginTime: padTimeText(requireString(record.timeBeginText, 'beginAtTime'), 'beginAtTime'),
      deadlineDate: padDateText(requireString(record.datePenaltyText, 'penaltySinceDate'), 'penaltySinceDate'),
      deadlineTime: padTimeText(requireString(record.timePenaltyText, 'penaltySinceTime'), 'penaltySinceTime'),
      extensionDays,
      penaltyRules: parsePenaltyRules(record.penaltyRules),
      personalMinutes: readPersonalMinutes(tdoc),
      pids: tdoc && hasOwn(tdoc, 'pids') ? readPositiveInts(tdoc.pids, 'pids') : readPositiveInts(record.pids ?? '', 'pids'),
      scores: tdoc ? readScoreMap(tdoc.score) : null,
      rated: tdoc ? readBoolean(tdoc, 'rated', false) : false,
      maintainer: readMaintainers(tdoc?.maintainer),
      assign: readStringList(tdoc?.assign, 'assign'),
      langs: readStringList(tdoc?.langs, 'langs'),
      participantScopeMode: readHomeworkScopeMode(record.participantScopeMode ?? tdoc?.participantScopeMode),
      participantGroupIds: readStringList(record.participantGroupIds ?? tdoc?.participantGroupIds, 'participantGroupIds'),
      fromCourse: editing ? null : readFromCourse(record),
    },
    catalogs: {
      schools: [],
      groups: readGroups(record.scopeGroups, 'scopeGroups'),
    },
    courseContext: readCourseContext(record.courseContext),
  };
}

export function parsePracticeSnapshot(raw: unknown): PracticeSnapshot {
  const record = asRecord(raw, 'practice');
  const page = record.page_name;
  if (page !== 'problem_set_edit' && page !== 'problem_set_create') throw invalid('page_name');
  const editing = page === 'problem_set_edit';
  const tdoc = hasOwn(record, 'tdoc') && record.tdoc != null ? asRecord(record.tdoc, 'tdoc') : null;
  if (editing && !tdoc) throw invalid('tdoc');
  const audience = readAudience(record.audience);
  const dag = hasOwn(record, 'dag') ? record.dag : tdoc?.dag;
  return {
    tid: editing && tdoc ? readDocumentId(tdoc) : null,
    state: {
      title: tdoc ? readString(tdoc, 'title') : '',
      content: tdoc ? readString(tdoc, 'content') : '',
      description: tdoc ? readString(tdoc, 'description') : '',
      pin: readPin(tdoc),
      stages: editing ? readStages(dag) : [emptyStage()],
      audiencePublic: audience.public,
      audienceGroupIds: audience.groupIds,
    },
    catalogs: {
      schools: [],
      groups: readGroups(record.groups, 'groups'),
    },
  };
}

export function contestFormBody(state: ContestFormState): URLSearchParams {
  const body = new URLSearchParams();
  const vigil = state.vigil;
  body.set('operation', 'update');
  body.set('beginAtDate', state.beginDate);
  body.set('beginAtTime', state.beginTime);
  body.set('duration', String(state.windowHours));
  body.set('title', state.title);
  body.set('content', state.content);
  body.set('rule', state.rule);
  body.set('pids', joinCsv(state.pids));
  body.set('rated', flag(state.rated));
  body.set('code', state.code);
  body.set('autoHide', flag(state.autoHide));
  body.set('assign', joinCsv(state.assign));
  body.set('hidden', flag(state.hidden));
  body.set('lock', state.lockMinutes === null ? '' : String(state.lockMinutes));
  body.set('contestDuration', state.personalHours === null ? '' : formatDecimal(state.personalHours, 'personalHours'));
  body.set('maintainer', joinCsv(state.maintainer));
  body.set('allowViewCode', flag(state.allowViewCode));
  body.set('allowPrint', flag(state.allowPrint));
  body.set('keepScoreboardHidden', flag(state.keepScoreboardHidden));
  if (state.allowVirtual !== null) body.set('allowVirtual', flag(state.allowVirtual));
  if (state.allowPostContestPractice !== null) body.set('allowPostContestPractice', flag(state.allowPostContestPractice));
  if (state.allowPostContestView !== null) body.set('allowPostContestView', flag(state.allowPostContestView));
  if (state.allowPostContestSubmit !== null) body.set('allowPostContestSubmit', flag(state.allowPostContestSubmit));
  body.set('langs', joinCsv(state.langs));
  body.set('vigilEnabled', flag(vigil.vigilEnabled));
  body.set('entryMode', vigil.entryMode);
  body.set('approvalMode', vigil.approvalMode);
  body.set('lockdownMode', flag(vigil.lockdownMode));
  body.set('networkLockdownMode', flag(vigil.networkLockdownMode));
  body.set('networkLockdownFailurePolicy', vigil.networkLockdownFailurePolicy);
  body.set('networkWhitelistHosts', vigil.networkWhitelistHosts);
  body.set('networkWhitelistIps', vigil.networkWhitelistIps);
  body.set('networkWhitelistPorts', vigil.networkWhitelistPorts);
  body.set('pauseOnDisconnect', flag(vigil.pauseOnDisconnect));
  body.set('screenshotIntervalMs', String(vigil.screenshotIntervalMs));
  body.set('exclusive', flag(vigil.exclusive));
  body.set('clientLoginBlockBeforeMinutes', String(vigil.clientLoginBlockBeforeMinutes));
  body.set('clientLoginBlockAfterMinutes', String(vigil.clientLoginBlockAfterMinutes));
  body.set('liveEnabled', flag(vigil.liveEnabled));
  body.set('recordEnabled', flag(vigil.recordEnabled));
  body.set('cameraEnabled', flag(vigil.cameraEnabled));
  body.set('screenshotJitterMs', String(vigil.screenshotJitterMs));
  body.set('vigilProcessWhitelist', vigil.vigilProcessWhitelist);
  body.set('participantScopeMode', state.participantScopeMode);
  body.set('participantSchoolIds', joinCsv(state.participantSchoolIds));
  body.set('participantGroupIds', joinCsv(state.participantGroupIds));
  body.set('participationMode', state.participationMode);
  body.set('participationRevision', String(state.participationRevision));
  body.set('teamModeClearConfirmation', state.teamModeClearConfirmation);
  // A non-empty planned batch is rejected for individual contests, including a leftover team id.
  if (state.participationMode === 'individual') body.set('plannedTeamBatchId', '');
  else if (state.plannedTeamBatchId !== null) body.set('plannedTeamBatchId', state.plannedTeamBatchId);
  if (state.rule === 'exam') {
    body.set('examShowVerdict', flag(state.examShowVerdict !== false));
    body.set('examPassScore', state.examPassScore === null ? '' : String(state.examPassScore));
    body.set('examAttemptLimit', state.examAttemptLimit === null || state.examAttemptLimit === 1 ? '' : String(state.examAttemptLimit));
    body.set('examPaperQuotas', state.examPaperQuotas === null ? '' : jsonNumbers(state.examPaperQuotas, 'examPaperQuotas'));
  }
  if (state.scores !== null && TEACH_SCORED_CONTEST_RULES.includes(state.rule)) {
    body.set('examScores', postedPoolScores(state.pids, state.scores));
  }
  return body;
}

export function homeworkFormBody(state: HomeworkFormState): URLSearchParams {
  const body = new URLSearchParams();
  body.set('operation', 'update');
  body.set('beginAtDate', state.beginDate);
  body.set('beginAtTime', state.beginTime);
  body.set('penaltySinceDate', state.deadlineDate);
  body.set('penaltySinceTime', state.deadlineTime);
  body.set('extensionDays', formatDecimal(state.extensionDays, 'extensionDays'));
  body.set('penaltyRules', penaltyPayload(state));
  body.set('title', state.title);
  body.set('content', state.content);
  body.set('pids', joinCsv(state.pids));
  body.set('rated', flag(state.rated));
  body.set('maintainer', joinCsv(state.maintainer));
  body.set('assign', joinCsv(state.assign));
  body.set('langs', joinCsv(state.langs));
  body.set('participantScopeMode', state.participantScopeMode);
  body.set('participantGroupIds', joinCsv(state.participantGroupIds));
  body.set('contestDuration', contestDurationFromMinutes(state.personalMinutes));
  if (state.scores !== null) body.set('problemScores', postedPoolScores(state.pids, state.scores));
  if (state.fromCourse) {
    body.set('fromCourse', state.fromCourse.courseId);
    body.set('chapter', String(state.fromCourse.chapterId));
  }
  return body;
}

export function practiceFormBody(state: PracticeFormState): URLSearchParams {
  const body = new URLSearchParams();
  const dag = state.stages.map((stage) => ({
    _id: stage.id,
    title: stage.title,
    requireNids: stage.requireIds,
    pids: stage.pids,
  }));
  body.set('title', state.title);
  body.set('content', state.content);
  body.set('description', state.description);
  body.set('dag', JSON.stringify(dag));
  body.set('pin', state.pin ? '1' : '0');
  body.set('audiencePublic', state.audiencePublic ? '1' : '0');
  body.set('audienceGroupIds', joinCsv(state.audienceGroupIds));
  return body;
}

export function legacyEditPath(type: TeachType, id: string | null, query?: URLSearchParams): string {
  if (!(TEACH_TYPES as readonly string[]).includes(type)) throw invalid('type');
  if (id !== null && !id) throw invalid('id');
  const base =
    type === 'homework'
      ? id
        ? `/homework/${id}/edit`
        : '/homework/create'
      : type === 'practice'
        ? id
          ? `/problem-sets/${id}/edit`
          : '/problem-sets/create'
        : id
          ? `/contest/${id}/edit`
          : '/contest/create';
  const text = query?.toString() ?? '';
  return text ? `${base}?${text}` : base;
}
