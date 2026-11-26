import { homeworkKindRevealsVerdict, PROBLEM_KINDS, SET_CODE_POLICIES } from '@hydrooj/common';
import type { ProblemKind, SetCodePolicy } from '@hydrooj/common';
import type { ObjectiveClientQuestion } from '@/components/objective-answer-panel';
import { formatMoment } from '@/pages/problem-sets/model';

export type WsKind = 'homework' | 'paper' | 'contest';
export type WsFlavor = 'homework' | 'paper' | 'acm' | 'ioi' | 'oi';
export type WsPhase = 'upcoming' | 'ready' | 'answering' | 'submitted' | 'ended';
export type WsMode = 'browser' | 'client' | 'preview';
export type WsNumbering = 'pta' | 'letter';
export type WsLockReason = 'not_started' | 'not_open' | 'need_start' | 'need_attend' | 'client_only' | 'view_closed';
export type CellState = 'empty' | 'draft' | 'submitted' | 'correct' | 'wrong' | 'partial';

export function objectiveVerdictPending(ws: { kind: WsKind; objectiveVerdictVisible: boolean }, kind: ProblemKind): boolean {
  return ws.kind === 'homework' && !ws.objectiveVerdictVisible && !homeworkKindRevealsVerdict(kind);
}
export type SectionName = 'overview' | 'problems' | 'records' | 'ranking' | 'notice' | 'clar' | 'print';
export type ProgramKind = 'program_fill' | 'function' | 'programming';
export type TeamRole = 'captain' | 'member';
export type TimerLabel = '剩余' | '个人剩余' | '距开始' | '距开考' | '截止';
export type TimerTone = 'fg' | 'warning' | 'danger';

export interface WsItem {
  excluded?: boolean;
  rawMax?: number;
  pid: number;
  label: string;
  title: string;
  kind: ProblemKind;
  score: number;
  state: CellState;
  submits: number;
  lastScore: number | null;
  feedback?: { score: boolean; verdict: boolean; details: boolean };
}

export interface WsGroup {
  kind: ProblemKind;
  no: number | null;
  name: string;
  scoreEach: number | null;
  items: WsItem[];
}

export interface WsInfoRow {
  label: string;
  text?: string;
  at?: string;
  range?: [string, string];
}

export interface WsAnnouncement {
  id: string;
  subject: string;
  content: string;
  createdAt: string;
}

export interface WsReply {
  content: string;
  createdAt: string;
}

export interface WsClarification {
  id: string;
  subject: string;
  content: string;
  createdAt: string;
  replies: WsReply[];
}

export interface WsWindow {
  beginAt: string;
  endAt: string;
  dueAt: string | null;
  durationMinutes: number | null;
  startAt: string | null;
  personalEndAt: string | null;
  lockAt: string | null;
}

export interface WsTotals {
  problemCount: number;
  maxScore: number | null;
  answered: number;
  score: number | null;
  accepted: number | null;
  showScore: boolean;
}

export interface WsPaper {
  score: number | null;
  passed: boolean | null;
  judging: boolean;
  passScore: number | null;
  attemptLimit: number | null;
  attemptsUsed: number;
  canRetake: boolean;
  submitByKind: boolean;
  lockedKinds: string[];
}

export interface WsAction {
  canStart: boolean;
  canFinalize: boolean;
  canAttend: boolean;
  canUnrank: boolean;
  canSubmit: boolean;
  attended: boolean;
  canRetake: boolean;
  invitationRequired?: boolean;
}

export interface WsUrls {
  back: string | null;
  manage: string | null;
  overview: string;
  problem: string | null;
  submit: string | null;
  /** Problem submit endpoint used only for 自测. Formal paper submit stays on submitCode. */
  pretest: string | null;
  submitCode: string | null;
  recordDetail: string;
  records: string;
  ranking: string | null;
  clarify: string | null;
  print: string | null;
  start: string | null;
  attend: string | null;
  draftList: string | null;
  saveAnswers?: string | null;
  draftUpsert: string | null;
  submitKind: string | null;
  lockKind: string | null;
  finalize: string | null;
  virtual: string | null;
  practice: string | null;
  teamProblem: string | null;
  discussion?: string | null;
  /** Optional so handwritten workspace fixtures stay valid; a missing payload field parses as null. */
  verifyObjective?: string | null;
  verifySubmit?: string | null;
}

export interface WsStudent {
  name: string;
  studentId: string | null;
}

export interface WsTeam {
  teamName: string;
  role: TeamRole;
}

export interface SetWorkspace {
  rules?: { autoSaveBeforeEnd: boolean; prohibitCodePaste: boolean; showDifficulty: boolean; discussion: boolean };
  kind: WsKind;
  flavor: WsFlavor;
  codePolicy?: SetCodePolicy;
  tid: string;
  title: string;
  description: string;
  mode: WsMode;
  phase: WsPhase;
  locked: { reason: WsLockReason } | null;
  numbering: WsNumbering;
  window: WsWindow;
  groups: WsGroup[];
  totals: WsTotals;
  verdictVisible: boolean;
  /** False only for a student homework whose teacher hid objective right/wrong. */
  objectiveVerdictVisible: boolean;
  team: WsTeam | null;
  paper: WsPaper | null;
  announcements: WsAnnouncement[];
  clarifications: WsClarification[];
  info: WsInfoRow[];
  student: WsStudent;
  action: WsAction;
  urls: WsUrls;
  officialRound?: { id: string; roundNo: number; startedAt: string; closedAt: string | null } | null;
}

export interface WorkspaceProblem {
  title: string;
  content: string;
  questions: ObjectiveClientQuestion[] | null;
  programKind: ProgramKind | null;
  raw: Record<string, unknown>;
}

export interface SectionQuery {
  section: SectionName;
  kind: ProblemKind | null;
  q: number | null;
}

export interface SectionExtra {
  kind?: ProblemKind;
  q?: number;
}

export interface RailItem {
  section: SectionName;
  label: string;
  icon: string;
}

export interface WsDraft {
  version?: number;
  judgeResult?: Record<string, 'correct' | 'wrong' | 'partial'> | null;
  score?: number | null;
  answers: Record<string, string | string[]> | null;
  submittedAnswers: Record<string, string | string[]> | null;
}

export type DraftMap = ReadonlyMap<number, WsDraft>;

export interface TimerView {
  label: TimerLabel;
  endAt: number | null;
  text: string | null;
  tone: TimerTone;
}

export interface OpenTarget {
  kind: ProblemKind;
  q: number | null;
}

const WORKSPACE_KINDS = ['homework', 'paper', 'contest'] as const;
const FLAVORS = ['homework', 'paper', 'acm', 'ioi', 'oi'] as const;
const PHASES = ['upcoming', 'ready', 'answering', 'submitted', 'ended'] as const;
const MODES = ['browser', 'client', 'preview'] as const;
const NUMBERINGS = ['pta', 'letter'] as const;
const LOCK_REASONS = ['not_started', 'not_open', 'need_start', 'need_attend', 'client_only', 'view_closed'] as const;
const CELL_STATES = ['empty', 'draft', 'submitted', 'correct', 'wrong', 'partial'] as const;
const SECTIONS = ['overview', 'problems', 'records', 'ranking', 'notice', 'clar', 'print'] as const;
const TEAM_ROLES = ['captain', 'member'] as const;
const PROGRAM_KINDS = ['program_fill', 'function', 'programming'] as const;
const ONE_PER_PAGE: ReadonlySet<ProblemKind> = new Set(PROGRAM_KINDS);
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

const RAIL: Record<SectionName, RailItem> = {
  overview: { section: 'overview', label: '概览', icon: 'Gauge' },
  problems: { section: 'problems', label: '题目列表', icon: 'PenLine' },
  records: { section: 'records', label: '提交列表', icon: 'Rows3' },
  ranking: { section: 'ranking', label: '排名', icon: 'ChartColumn' },
  notice: { section: 'notice', label: '公告', icon: 'Bell' },
  clar: { section: 'clar', label: '答疑', icon: 'MessageSquare' },
  print: { section: 'print', label: '打印', icon: 'Printer' },
};

const STATE_CLASS: Record<CellState, string> = {
  empty: 'border border-dashed border-line-strong',
  draft: 'border border-solid bg-brand-soft border-brand-line text-brand-fg',
  submitted: 'border border-solid bg-surface-active border-line-strong',
  correct: 'border border-solid bg-success-soft border-success-line text-success-fg',
  wrong: 'border border-solid bg-danger-soft border-danger-line text-danger-fg',
  partial: 'border border-solid bg-info-soft border-info-line text-info-fg',
};

// ds-allow DS004: 标记圆点是 D8 规定的 6px，偏移 3px，间距档没有这一档
const FLAG_CLASS = "relative after:pointer-events-none after:absolute after:top-[3px] after:right-[3px] after:size-1.5 after:rounded-full after:bg-warning after:content-['']";

function invalid(message: string): never {
  throw new TypeError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function read(record: Record<string, unknown>, key: string, label = key): unknown {
  if (!Object.hasOwn(record, key)) invalid(`missing ${label}`);
  return record[key];
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) invalid(`${label} must be an object`);
  return value;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') invalid(`${label} must be a string`);
  return value;
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requireString(value, label);
}

function optionalNullableString(record: Record<string, unknown>, key: string, label: string): string | null {
  if (!Object.hasOwn(record, key)) return null;
  return requireNullableString(record[key], label);
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') invalid(`${label} must be a boolean`);
  return value;
}

function requireNullableBoolean(value: unknown, label: string): boolean | null {
  if (value === null) return null;
  return requireBoolean(value, label);
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${label} must be a finite number`);
  return value;
}

function requireNullableNumber(value: unknown, label: string): number | null {
  if (value === null) return null;
  return requireNumber(value, label);
}

function requireInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid(`${label} must be an integer`);
  return value;
}

function requireIso(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (!Number.isFinite(Date.parse(text))) invalid(`${label} must be an ISO timestamp`);
  return text;
}

function requireNullableIso(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requireIso(value, label);
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  return invalid(`${label} is unknown`);
}

function requireKind(value: unknown, label: string): ProblemKind {
  return requireEnum(value, PROBLEM_KINDS, label);
}

function requireStringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((item, index) => requireString(item, `${label}.${index}`));
}

function parseInstant(iso: string): number {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) invalid(`invalid timestamp ${iso}`);
  return parsed;
}

function parseLocked(value: unknown): SetWorkspace['locked'] {
  if (value === null) return null;
  const record = requireRecord(value, 'locked');
  return { reason: requireEnum(read(record, 'reason', 'locked.reason'), LOCK_REASONS, 'locked.reason') };
}

function parseWindow(value: unknown): WsWindow {
  const record = requireRecord(value, 'window');
  return {
    beginAt: requireIso(read(record, 'beginAt', 'window.beginAt'), 'window.beginAt'),
    endAt: requireIso(read(record, 'endAt', 'window.endAt'), 'window.endAt'),
    dueAt: requireNullableIso(read(record, 'dueAt', 'window.dueAt'), 'window.dueAt'),
    durationMinutes: requireNullableNumber(read(record, 'durationMinutes', 'window.durationMinutes'), 'window.durationMinutes'),
    startAt: requireNullableIso(read(record, 'startAt', 'window.startAt'), 'window.startAt'),
    personalEndAt: requireNullableIso(read(record, 'personalEndAt', 'window.personalEndAt'), 'window.personalEndAt'),
    lockAt: requireNullableIso(read(record, 'lockAt', 'window.lockAt'), 'window.lockAt'),
  };
}

function parseFeedback(value: unknown, path: string): WsItem['feedback'] {
  if (value === undefined) return undefined;
  const record = requireRecord(value, path);
  return { score: requireBoolean(record.score, `${path}.score`), verdict: requireBoolean(record.verdict, `${path}.verdict`), details: requireBoolean(record.details, `${path}.details`) };
}

function parseItem(value: unknown, path: string): WsItem {
  const record = requireRecord(value, path);
  return {
    ...(record.feedback === undefined ? {} : { feedback: parseFeedback(record.feedback, `${path}.feedback`) }),
    pid: requireInteger(read(record, 'pid', `${path}.pid`), `${path}.pid`),
    label: requireString(read(record, 'label', `${path}.label`), `${path}.label`),
    title: requireString(read(record, 'title', `${path}.title`), `${path}.title`),
    kind: requireKind(read(record, 'kind', `${path}.kind`), `${path}.kind`),
    score: requireNumber(read(record, 'score', `${path}.score`), `${path}.score`),
    state: requireEnum(read(record, 'state', `${path}.state`), CELL_STATES, `${path}.state`),
    submits: requireNumber(read(record, 'submits', `${path}.submits`), `${path}.submits`),
    ...(record.rawMax === undefined ? {} : { rawMax: requireNumber(record.rawMax, `${path}.rawMax`) }),
    ...(record.excluded === undefined ? {} : { excluded: requireBoolean(record.excluded, `${path}.excluded`) }),
    lastScore: requireNullableNumber(read(record, 'lastScore', `${path}.lastScore`), `${path}.lastScore`),
  };
}

function parseGroup(value: unknown, path: string): WsGroup {
  const record = requireRecord(value, path);
  const items = requireArray(read(record, 'items', `${path}.items`), `${path}.items`);
  return {
    kind: requireKind(read(record, 'kind', `${path}.kind`), `${path}.kind`),
    no: requireNullableNumber(read(record, 'no', `${path}.no`), `${path}.no`),
    name: requireString(read(record, 'name', `${path}.name`), `${path}.name`),
    scoreEach: requireNullableNumber(read(record, 'scoreEach', `${path}.scoreEach`), `${path}.scoreEach`),
    items: items.map((item, index) => parseItem(item, `${path}.items.${index}`)),
  };
}

function parseTotals(value: unknown): WsTotals {
  const record = requireRecord(value, 'totals');
  return {
    problemCount: requireNumber(read(record, 'problemCount', 'totals.problemCount'), 'totals.problemCount'),
    maxScore: requireNullableNumber(read(record, 'maxScore', 'totals.maxScore'), 'totals.maxScore'),
    answered: requireNumber(read(record, 'answered', 'totals.answered'), 'totals.answered'),
    score: requireNullableNumber(read(record, 'score', 'totals.score'), 'totals.score'),
    accepted: requireNullableNumber(read(record, 'accepted', 'totals.accepted'), 'totals.accepted'),
    showScore: requireBoolean(read(record, 'showScore', 'totals.showScore'), 'totals.showScore'),
  };
}

function parsePaper(value: unknown): WsPaper | null {
  if (value === null) return null;
  const record = requireRecord(value, 'paper');
  return {
    score: requireNullableNumber(read(record, 'score', 'paper.score'), 'paper.score'),
    passed: requireNullableBoolean(read(record, 'passed', 'paper.passed'), 'paper.passed'),
    judging: requireBoolean(read(record, 'judging', 'paper.judging'), 'paper.judging'),
    passScore: requireNullableNumber(read(record, 'passScore', 'paper.passScore'), 'paper.passScore'),
    attemptLimit: requireNullableNumber(read(record, 'attemptLimit', 'paper.attemptLimit'), 'paper.attemptLimit'),
    attemptsUsed: requireNumber(read(record, 'attemptsUsed', 'paper.attemptsUsed'), 'paper.attemptsUsed'),
    canRetake: requireBoolean(read(record, 'canRetake', 'paper.canRetake'), 'paper.canRetake'),
    submitByKind: requireBoolean(read(record, 'submitByKind', 'paper.submitByKind'), 'paper.submitByKind'),
    lockedKinds: requireStringArray(read(record, 'lockedKinds', 'paper.lockedKinds'), 'paper.lockedKinds'),
  };
}

function parseAction(value: unknown): WsAction {
  const record = requireRecord(value, 'action');
  return {
    canStart: requireBoolean(read(record, 'canStart', 'action.canStart'), 'action.canStart'),
    canFinalize: requireBoolean(read(record, 'canFinalize', 'action.canFinalize'), 'action.canFinalize'),
    canAttend: requireBoolean(read(record, 'canAttend', 'action.canAttend'), 'action.canAttend'),
    canUnrank: requireBoolean(read(record, 'canUnrank', 'action.canUnrank'), 'action.canUnrank'),
    canSubmit: requireBoolean(read(record, 'canSubmit', 'action.canSubmit'), 'action.canSubmit'),
    attended: requireBoolean(read(record, 'attended', 'action.attended'), 'action.attended'),
    canRetake: requireBoolean(read(record, 'canRetake', 'action.canRetake'), 'action.canRetake'),
    ...('invitationRequired' in record ? { invitationRequired: requireBoolean(record.invitationRequired, 'action.invitationRequired') } : {}),
  };
}

function parseUrls(value: unknown): WsUrls {
  const record = requireRecord(value, 'urls');
  return {
    back: requireNullableString(read(record, 'back', 'urls.back'), 'urls.back'),
    manage: requireNullableString(read(record, 'manage', 'urls.manage'), 'urls.manage'),
    overview: requireString(read(record, 'overview', 'urls.overview'), 'urls.overview'),
    problem: requireNullableString(read(record, 'problem', 'urls.problem'), 'urls.problem'),
    submit: requireNullableString(read(record, 'submit', 'urls.submit'), 'urls.submit'),
    pretest: requireNullableString(read(record, 'pretest', 'urls.pretest'), 'urls.pretest'),
    submitCode: requireNullableString(read(record, 'submitCode', 'urls.submitCode'), 'urls.submitCode'),
    recordDetail: requireString(read(record, 'recordDetail', 'urls.recordDetail'), 'urls.recordDetail'),
    records: requireString(read(record, 'records', 'urls.records'), 'urls.records'),
    ranking: requireNullableString(read(record, 'ranking', 'urls.ranking'), 'urls.ranking'),
    clarify: requireNullableString(read(record, 'clarify', 'urls.clarify'), 'urls.clarify'),
    print: requireNullableString(read(record, 'print', 'urls.print'), 'urls.print'),
    start: requireNullableString(read(record, 'start', 'urls.start'), 'urls.start'),
    attend: requireNullableString(read(record, 'attend', 'urls.attend'), 'urls.attend'),
    draftList: requireNullableString(read(record, 'draftList', 'urls.draftList'), 'urls.draftList'),
    draftUpsert: requireNullableString(read(record, 'draftUpsert', 'urls.draftUpsert'), 'urls.draftUpsert'),
    submitKind: requireNullableString(read(record, 'submitKind', 'urls.submitKind'), 'urls.submitKind'),
    lockKind: requireNullableString(read(record, 'lockKind', 'urls.lockKind'), 'urls.lockKind'),
    finalize: requireNullableString(read(record, 'finalize', 'urls.finalize'), 'urls.finalize'),
    virtual: requireNullableString(read(record, 'virtual', 'urls.virtual'), 'urls.virtual'),
    practice: requireNullableString(read(record, 'practice', 'urls.practice'), 'urls.practice'),
    teamProblem: requireNullableString(read(record, 'teamProblem', 'urls.teamProblem'), 'urls.teamProblem'),
    ...(record.saveAnswers === undefined ? {} : { saveAnswers: optionalNullableString(record, 'saveAnswers', 'urls.saveAnswers') }),
    ...(record.discussion === undefined ? {} : { discussion: optionalNullableString(record, 'discussion', 'urls.discussion') }),
    verifyObjective: optionalNullableString(record, 'verifyObjective', 'urls.verifyObjective'),
    verifySubmit: optionalNullableString(record, 'verifySubmit', 'urls.verifySubmit'),
  };
}

function parseStudent(value: unknown): WsStudent {
  const record = requireRecord(value, 'student');
  return {
    name: requireString(read(record, 'name', 'student.name'), 'student.name'),
    studentId: requireNullableString(read(record, 'studentId', 'student.studentId'), 'student.studentId'),
  };
}

function parseTeam(value: unknown): WsTeam | null {
  if (value === null) return null;
  const record = requireRecord(value, 'team');
  return {
    teamName: requireString(read(record, 'teamName', 'team.teamName'), 'team.teamName'),
    role: requireEnum(read(record, 'role', 'team.role'), TEAM_ROLES, 'team.role'),
  };
}

function parseAnnouncement(value: unknown, path: string): WsAnnouncement {
  const record = requireRecord(value, path);
  return {
    id: requireString(read(record, 'id', `${path}.id`), `${path}.id`),
    subject: requireString(read(record, 'subject', `${path}.subject`), `${path}.subject`),
    content: requireString(read(record, 'content', `${path}.content`), `${path}.content`),
    createdAt: requireIso(read(record, 'createdAt', `${path}.createdAt`), `${path}.createdAt`),
  };
}

function parseReply(value: unknown, path: string): WsReply {
  const record = requireRecord(value, path);
  return {
    content: requireString(read(record, 'content', `${path}.content`), `${path}.content`),
    createdAt: requireIso(read(record, 'createdAt', `${path}.createdAt`), `${path}.createdAt`),
  };
}

function parseClarification(value: unknown, path: string): WsClarification {
  const record = requireRecord(value, path);
  const replies = requireArray(read(record, 'replies', `${path}.replies`), `${path}.replies`);
  return {
    id: requireString(read(record, 'id', `${path}.id`), `${path}.id`),
    subject: requireString(read(record, 'subject', `${path}.subject`), `${path}.subject`),
    content: requireString(read(record, 'content', `${path}.content`), `${path}.content`),
    createdAt: requireIso(read(record, 'createdAt', `${path}.createdAt`), `${path}.createdAt`),
    replies: replies.map((reply, index) => parseReply(reply, `${path}.replies.${index}`)),
  };
}

function parseInfoRow(value: unknown, path: string): WsInfoRow {
  const record = requireRecord(value, path);
  const label = requireString(read(record, 'label', `${path}.label`), `${path}.label`);
  const modes = ['text', 'at', 'range'].filter((key) => Object.hasOwn(record, key));
  if (modes.length !== 1) invalid(`${path} must contain exactly one of text, at, or range`);
  const mode = modes[0];
  if (mode === 'text') return { label, text: requireString(record.text, `${path}.text`) };
  if (mode === 'at') return { label, at: requireIso(record.at, `${path}.at`) };
  if (mode !== 'range') invalid(`${path} must contain exactly one of text, at, or range`);
  const range = requireArray(record.range, `${path}.range`);
  if (range.length !== 2) invalid(`${path}.range must contain two timestamps`);
  const start = range[0];
  const end = range[1];
  return { label, range: [requireIso(start, `${path}.range.0`), requireIso(end, `${path}.range.1`)] };
}

function parseQuestion(value: unknown, path: string): ObjectiveClientQuestion {
  const record = requireRecord(value, path);
  const question: ObjectiveClientQuestion = {
    key: requireString(read(record, 'key', `${path}.key`), `${path}.key`),
    kind: requireString(read(record, 'kind', `${path}.kind`), `${path}.kind`),
    score: requireNumber(read(record, 'score', `${path}.score`), `${path}.score`),
  };
  if (Object.hasOwn(record, 'prompt')) question.prompt = requireString(record.prompt, `${path}.prompt`);
  if (Object.hasOwn(record, 'choices')) {
    question.choices = requireStringArray(record.choices, `${path}.choices`);
  }
  if (Object.hasOwn(record, 'presentation')) question.presentation = requireString(record.presentation, `${path}.presentation`);
  return question;
}

function parseProblemConfig(config: unknown, path: string): Pick<WorkspaceProblem, 'questions' | 'programKind'> {
  if (config === undefined) return { questions: null, programKind: null };
  const record = requireRecord(config, path);
  const type = Object.hasOwn(record, 'type') ? record.type : undefined;
  const programKind = typeof type === 'string' && (PROGRAM_KINDS as readonly string[]).includes(type) ? (type as ProgramKind) : null;
  if (type !== 'objective') return { questions: null, programKind };
  const questions = requireArray(read(record, 'questions', `${path}.questions`), `${path}.questions`);
  return {
    questions: questions.map((question, index) => parseQuestion(question, `${path}.questions.${index}`)),
    programKind: null,
  };
}

function parseProblem(value: unknown, path: string): WorkspaceProblem {
  const record = requireRecord(value, path);
  const config = Object.hasOwn(record, 'config') ? record.config : undefined;
  const view = parseProblemConfig(config, `${path}.config`);
  return {
    title: requireString(read(record, 'title', `${path}.title`), `${path}.title`),
    content: requireString(read(record, 'content', `${path}.content`), `${path}.content`),
    questions: view.questions,
    programKind: view.programKind,
    raw: record,
  };
}

function parsePidKey(key: string): number {
  if (!/^(?:0|[1-9]\d*)$/.test(key)) invalid(`workspaceProblems key ${key} is not a pid`);
  const pid = Number(key);
  if (!Number.isSafeInteger(pid)) invalid(`workspaceProblems key ${key} is not a safe integer`);
  return pid;
}

function isSection(value: string): value is SectionName {
  return (SECTIONS as readonly string[]).includes(value);
}

function isProblemKind(value: string): value is ProblemKind {
  return (PROBLEM_KINDS as readonly string[]).includes(value);
}

function readQueryPid(value: string | null): number | null {
  if (value === null || !/^[1-9]\d*$/.test(value)) return null;
  const pid = Number(value);
  if (!Number.isSafeInteger(pid)) return null;
  return pid;
}

function compareCanonical(left: unknown, right: unknown): number {
  const a = JSON.stringify(left);
  const b = JSON.stringify(right);
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return a < b ? -1 : 1;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item)).sort(compareCanonical);
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
  return sorted;
}

function canonicalJson(value: unknown): string {
  const json = JSON.stringify(canonicalize(value));
  if (typeof json !== 'string') invalid('canonical JSON is undefined');
  return json;
}

function answersNonEmpty(answers: WsDraft['answers']): boolean {
  return answers !== null && Object.keys(answers).length > 0;
}

function draftPending(draft: WsDraft | undefined): boolean {
  if (!draft || !answersNonEmpty(draft.answers)) return false;
  return canonicalJson(draft.answers) !== canonicalJson(draft.submittedAnswers ?? null);
}

function timerTone(remainingMs: number): TimerTone {
  if (remainingMs > FIVE_MINUTES_MS) return 'fg';
  if (remainingMs > ONE_MINUTE_MS) return 'warning';
  return 'danger';
}

function countdown(label: TimerLabel, iso: string, now: number): TimerView {
  const endAt = parseInstant(iso);
  return {
    label, endAt, text: null, tone: timerTone(endAt - now),
  };
}

function personallyTimed(ws: SetWorkspace): boolean {
  const minutes = ws.window.durationMinutes;
  return minutes !== null && minutes > 0;
}

function deadlineView(iso: string, now: number): TimerView {
  return {
    label: '截止',
    endAt: null,
    text: formatMoment(iso, now),
    tone: timerTone(parseInstant(iso) - now),
  };
}

function parseOfficialRound(value: unknown): SetWorkspace['officialRound'] {
  if (value === undefined || value === null) return value;
  const record = requireRecord(value, 'officialRound');
  return {
    id: requireString(record.id, 'officialRound.id'),
    roundNo: requireInteger(record.roundNo, 'officialRound.roundNo'),
    startedAt: requireIso(record.startedAt, 'officialRound.startedAt'),
    closedAt: requireNullableIso(record.closedAt, 'officialRound.closedAt'),
  };
}

export function parseSetWorkspace(raw: unknown): SetWorkspace {
  const record = requireRecord(raw, 'workspace');
  const groups = requireArray(read(record, 'groups', 'groups'), 'groups');
  const announcements = requireArray(read(record, 'announcements', 'announcements'), 'announcements');
  const clarifications = requireArray(read(record, 'clarifications', 'clarifications'), 'clarifications');
  const info = requireArray(read(record, 'info', 'info'), 'info');
  return {
    ...(record.rules === undefined ? {} : { rules: parseWorkspaceRules(record.rules) }),
    ...(record.officialRound === undefined ? {} : {
      officialRound: parseOfficialRound(record.officialRound),
      codePolicy: requireEnum(record.codePolicy, SET_CODE_POLICIES, 'codePolicy'),
    }),
    kind: requireEnum(read(record, 'kind', 'kind'), WORKSPACE_KINDS, 'kind'),
    flavor: requireEnum(read(record, 'flavor', 'flavor'), FLAVORS, 'flavor'),
    tid: requireString(read(record, 'tid', 'tid'), 'tid'),
    title: requireString(read(record, 'title', 'title'), 'title'),
    description: requireString(read(record, 'description', 'description'), 'description'),
    mode: requireEnum(read(record, 'mode', 'mode'), MODES, 'mode'),
    phase: requireEnum(read(record, 'phase', 'phase'), PHASES, 'phase'),
    locked: parseLocked(read(record, 'locked', 'locked')),
    numbering: requireEnum(read(record, 'numbering', 'numbering'), NUMBERINGS, 'numbering'),
    window: parseWindow(read(record, 'window', 'window')),
    groups: groups.map((group, index) => parseGroup(group, `groups.${index}`)),
    totals: parseTotals(read(record, 'totals', 'totals')),
    verdictVisible: requireBoolean(read(record, 'verdictVisible', 'verdictVisible'), 'verdictVisible'),
    objectiveVerdictVisible: record.objectiveVerdictVisible === undefined
      ? true
      : requireBoolean(record.objectiveVerdictVisible, 'objectiveVerdictVisible'),
    team: parseTeam(read(record, 'team', 'team')),
    paper: parsePaper(read(record, 'paper', 'paper')),
    announcements: announcements.map((item, index) => parseAnnouncement(item, `announcements.${index}`)),
    clarifications: clarifications.map((item, index) => parseClarification(item, `clarifications.${index}`)),
    info: info.map((item, index) => parseInfoRow(item, `info.${index}`)),
    student: parseStudent(read(record, 'student', 'student')),
    action: parseAction(read(record, 'action', 'action')),
    urls: parseUrls(read(record, 'urls', 'urls')),
  };
}

function parseWorkspaceRules(value: unknown): NonNullable<SetWorkspace['rules']> {
  const rules = requireRecord(value, 'rules');
  return {
    autoSaveBeforeEnd: requireBoolean(rules.autoSaveBeforeEnd, 'rules.autoSaveBeforeEnd'),
    prohibitCodePaste: requireBoolean(rules.prohibitCodePaste, 'rules.prohibitCodePaste'),
    showDifficulty: requireBoolean(rules.showDifficulty, 'rules.showDifficulty'),
    discussion: requireBoolean(rules.discussion, 'rules.discussion'),
  };
}

export function parseWorkspaceProblems(raw: unknown): Map<number, WorkspaceProblem> {
  if (raw === undefined) return new Map();
  const record = requireRecord(raw, 'workspaceProblems');
  const problems = new Map<number, WorkspaceProblem>();
  for (const [key, value] of Object.entries(record)) {
    problems.set(parsePidKey(key), parseProblem(value, `workspaceProblems.${key}`));
  }
  return problems;
}

export function readSection(search: string): SectionQuery {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const sectionValue = params.get('section');
  const kindValue = params.get('kind');
  return {
    section: sectionValue !== null && isSection(sectionValue) ? sectionValue : 'overview',
    kind: kindValue !== null && isProblemKind(kindValue) ? kindValue : null,
    q: readQueryPid(params.get('q')),
  };
}

export function sectionHref(ws: SetWorkspace, section: SectionName, extra?: SectionExtra): string {
  const params = new URLSearchParams();
  params.set('section', section);
  if (extra?.kind !== undefined) params.set('kind', extra.kind);
  if (extra?.q !== undefined) params.set('q', String(extra.q));
  return `${ws.urls.overview}?${params.toString()}`;
}

export function isAcmWorkspace(ws: SetWorkspace): boolean {
  return ws.codePolicy === undefined ? ws.flavor === 'acm' : ws.codePolicy === 'acm';
}

export function railItems(ws: SetWorkspace): RailItem[] {
  const items: RailItem[] = [RAIL.overview, RAIL.problems, RAIL.records];
  if (ws.urls.ranking) items.push(RAIL.ranking);
  if (ws.kind !== 'homework' || ws.announcements.length > 0) items.push(RAIL.notice);
  if (ws.kind !== 'homework' && (ws.urls.clarify || ws.clarifications.length > 0)) items.push(RAIL.clar);
  if (ws.urls.print) items.push(RAIL.print);
  return items;
}

export function cellClass(state: CellState, flagged: boolean, current: boolean): string {
  const base = STATE_CLASS[state];
  if (!base) invalid(`unknown cell state ${String(state)}`);
  const tokens = [base];
  if (flagged) tokens.push(FLAG_CLASS);
  if (current) tokens.push('ring-2 ring-brand');
  return tokens.join(' ');
}

export function pendingCount(group: WsGroup, drafts: DraftMap): number {
  let count = 0;
  for (const item of group.items) {
    if (draftPending(drafts.get(item.pid))) count += 1;
  }
  return count;
}

export function pendingKinds(ws: SetWorkspace, drafts: DraftMap): ProblemKind[] {
  const kinds: ProblemKind[] = [];
  for (const group of ws.groups) {
    if (pendingCount(group, drafts) > 0) kinds.push(group.kind);
  }
  return kinds;
}

export function timerView(ws: SetWorkspace, now: number): TimerView | null {
  if (!Number.isFinite(now)) invalid('timer now must be a finite timestamp');
  if (ws.phase === 'upcoming') return countdown(ws.kind === 'paper' ? '距开考' : '距开始', ws.window.beginAt, now);
  if (ws.phase !== 'answering') return null;
  if (ws.kind === 'contest') return countdown('剩余', ws.window.personalEndAt ?? ws.window.endAt, now);
  if (ws.kind === 'paper') return countdown('个人剩余', ws.window.personalEndAt ?? ws.window.endAt, now);
  if (ws.kind === 'homework' && personallyTimed(ws)) {
    if (ws.window.personalEndAt === null) invalid('answering workspace is missing personalEndAt');
    return countdown('个人剩余', ws.window.personalEndAt, now);
  }
  if (ws.kind === 'homework') return deadlineView(ws.window.dueAt ?? ws.window.endAt, now);
  return invalid(`unknown workspace kind ${String(ws.kind)}`);
}

export function firstOpenTarget(ws: SetWorkspace): OpenTarget | null {
  for (const group of ws.groups) {
    const open = group.items.find((item) => item.state === 'empty' || item.state === 'draft');
    if (!open) continue;
    return { kind: group.kind, q: ONE_PER_PAGE.has(group.kind) ? open.pid : null };
  }
  return null;
}
