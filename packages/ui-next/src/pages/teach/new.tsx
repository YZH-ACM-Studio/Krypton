import { TEACH_KIND_ORDER, examDefinitePaperMax, teachPath } from '@hydrooj/common';
import type { ProblemKind, TeachType } from '@hydrooj/common';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import {
  BarChart3, Check, ClipboardList, GraduationCap, Trophy,
} from 'lucide-react';
import { AudienceField, audienceErrors, type AudienceValue } from '@/components/teach/audience-field';
import {
  TimeWindowField,
  timeWindowErrors,
  timeWindowFromIso,
  timeWindowHours,
  type TimeWindowValue,
} from '@/components/teach/time-window-field';
import { useUnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { confirmDialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/display';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { useExamNow } from '@/lib/exam-server-clock';
import { getJson, postForm, postJson, teachApi } from './api';
import { CopyDialog } from './copy-dialog';
import {
  contestFormBody,
  DEFAULT_PENALTY_RULES,
  homeworkFormBody,
  legacyEditPath,
  parseContestSnapshot,
  parseHomeworkSnapshot,
  parsePracticeSnapshot,
  practiceFormBody,
  type ContestFormState,
  type ContestSnapshot,
  type HomeworkFormState,
  type HomeworkSnapshot,
  type LegacyCatalogs,
  type PracticeFormState,
  type PracticeSnapshot,
  type PracticeStage,
} from './legacy-forms';
import {
  TEACH_KIND_LABEL,
  formatTeachWindow,
  parseTeachNewPayload,
  type TeachCopySource,
  type TeachNewPayload,
} from './model';

const TITLE_LIMIT = 64;
const LOAD_FAILED = '创建表单加载失败';
const CREATE_FAILED = '创建失败';
const PROVENANCE_FAILED = '记录复制来源失败';
const MODE_ERROR = '请选择作答方式。';
const TITLE_ERROR = '请填写标题。';
const TITLE_LIMIT_ERROR = '标题不能超过 64 个字。';
const AUDIENCE_REQUIRED = '请选择给谁做';
const MISSING_TID = '服务器没有返回题目集编号。';
const NOT_READY = '创建表单还没加载完。';
const COURSE_LOCK = '跟随课程班级';
const PRACTICE_COURSE_BLOCKED = '这一章已经引用了题集，不能再挂。';
const ATTACH_FAILED = '挂到课程失败';
const LOCK_PERSONAL_REASON = '原题目集开了封榜，不能同时设个人限时。';
const SAME_TIME_TITLE = '时间和原题目集一模一样，确定吗？';
const SAME_TIME_CONFIRM = '确定，用这个时间';
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const LEDO_RULE_HINT = '原题目集是 Ledo，请重新选择赛制。';

const MODE_COPY = {
  homework: {
    label: '逐题作答',
    description: '学生在题目页逐题提交，可以反复改、马上看到对错。截止后可以允许迟交、按时间扣分。学生在「作业」里看到它。',
  },
  exam: {
    label: '整卷作答',
    description: '学生在一页里答完整张卷子再交卷。可以随机抽题、设及格线和补考、接机房监考。学生在考试入口看到它。',
  },
} as const;

const OI_RULES = [
  { value: 'oi', label: 'OI', description: '比赛期间看不到结果，结束后统一出分。' },
  { value: 'ioi', label: 'IOI', description: '提交后立刻看到本题得分，取最高分。' },
  { value: 'strictioi', label: '严格 IOI', description: '实时出分，但以最后一次提交为准。' },
] as const;

type OiRule = (typeof OI_RULES)[number]['value'];
type ChosenOiRule = OiRule | 'ledo';
type NewCard = 'practice' | 'quiz' | 'acm' | 'oi';
type AnswerMode = 'homework' | 'exam';
type Step = 1 | 2;
type CreateRule = 'exam' | 'acm' | 'oi' | 'ioi' | 'strictioi';

interface CardCopy {
  key: NewCard;
  label: string;
  description: string;
  example: string;
  icon: typeof GraduationCap;
}

const CARDS: readonly CardCopy[] = [
  {
    key: 'practice',
    label: '练习',
    description: '不限时，学生按自己的节奏做。可以分阶段、设先修。',
    example: '专项刷题、课后巩固、寒假集训',
    icon: GraduationCap,
  },
  {
    key: 'quiz',
    label: '作业与考试',
    description: '选好题、定时间和学生。学生可以逐题作答（像作业），也可以一页答完再交卷（像考试）。',
    example: '每周作业、小测、期中期末',
    icon: ClipboardList,
  },
  {
    key: 'acm',
    label: 'ACM 比赛',
    description: '按通过题数和罚时排名，实时榜单，可封榜，支持组队。',
    example: '校赛、ICPC 训练赛',
    icon: Trophy,
  },
  {
    key: 'oi',
    label: 'OI·IOI 比赛',
    description: '按得分排名。OI 赛后出分，IOI 赛中实时出分。',
    example: 'CSP 模拟、天梯赛选拔',
    icon: BarChart3,
  },
];

const EMPTY_CATALOGS: LegacyCatalogs = { groups: [], schools: [] };
const EMPTY_TIME: TimeWindowValue = {
  beginDate: '',
  beginTime: '',
  endDate: '',
  endTime: '',
  personalMinutes: '',
};
const EMPTY_AUDIENCE: AudienceValue = { mode: null, groupIds: [], schoolIds: [] };
const EMPTY_STAGE: PracticeStage = { id: 1, title: '', requireIds: [], pids: [] };

type LoadedSnapshot =
  | { kind: 'contest'; value: ContestSnapshot }
  | { kind: 'homework'; value: HomeworkSnapshot }
  | { kind: 'practice'; value: PracticeSnapshot };

type LoadState =
  | { status: 'idle' | 'loading'; snapshot: null; error: null }
  | { status: 'ready'; snapshot: LoadedSnapshot; error: null }
  | { status: 'error'; snapshot: null; error: string };

interface FieldErrors {
  mode?: string;
  rule?: string;
  title?: string;
  time?: Partial<Record<'begin' | 'end' | 'personal', string>>;
  audience?: string;
}

interface PracticeCourseAttach {
  courseId: string;
  chapterId: number;
  courseTitle: string;
  chapterTitle: string;
  chapterHasProblemSet: boolean;
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  return value as Record<string, unknown>;
}

function requireCourseText(record: Record<string, unknown>, key: 'courseTitle' | 'chapterTitle'): string {
  const value = record[key];
  if (typeof value !== 'string') throw new TypeError(`teach_new_course_practice_invalid:${key}`);
  return value;
}

function readPracticeCourseAttach(pageData: unknown, payload: TeachNewPayload): PracticeCourseAttach | null {
  if (!isCoursePractice(payload) || !payload.fromCourse) return null;
  const page = plainRecord(pageData);
  const fromCourse = plainRecord(page?.fromCourse);
  if (!fromCourse) throw new TypeError('teach_new_course_practice_invalid:fromCourse');
  const chapterHasProblemSet = fromCourse.chapterHasProblemSet;
  if (typeof chapterHasProblemSet !== 'boolean') {
    throw new TypeError('teach_new_course_practice_invalid:chapterHasProblemSet');
  }
  return {
    courseId: payload.fromCourse.courseId,
    chapterId: payload.fromCourse.chapterId,
    courseTitle: requireCourseText(fromCourse, 'courseTitle'),
    chapterTitle: requireCourseText(fromCourse, 'chapterTitle'),
    chapterHasProblemSet,
  };
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof TypeError) return fallback;
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}

function isOiRule(value: string): value is OiRule {
  return value === 'oi' || value === 'ioi' || value === 'strictioi';
}

function cardOf(type: TeachType | null): NewCard | null {
  if (type === 'homework' || type === 'exam') return 'quiz';
  if (type === 'practice' || type === 'acm' || type === 'oi') return type;
  return null;
}

function chosenType(payload: TeachNewPayload): TeachType | null {
  return payload.copy?.type ?? payload.initialType;
}

function isCoursePractice(payload: TeachNewPayload): boolean {
  return payload.fromCourse !== null && chosenType(payload) === 'practice';
}

function initialCard(payload: TeachNewPayload): NewCard | null {
  if (payload.fromCourse && !isCoursePractice(payload)) return 'quiz';
  return cardOf(chosenType(payload));
}

function initialMode(payload: TeachNewPayload): AnswerMode | null {
  if (payload.fromCourse && !isCoursePractice(payload)) return 'homework';
  const type = chosenType(payload);
  if (type === 'homework' || type === 'exam') return type;
  return null;
}

function initialOiRule(copy: TeachCopySource | null): ChosenOiRule {
  if (copy?.type === 'oi' && copy.rule === 'ledo') return 'ledo';
  if (copy && isOiRule(copy.rule)) return copy.rule;
  return 'oi';
}

function snapshotOiRule(rule: ChosenOiRule): OiRule {
  return rule === 'ledo' ? 'oi' : rule;
}

function initialStatement(copy: TeachCopySource | null): string {
  if (!copy) return '';
  return copy.content;
}

function effectiveType(card: NewCard | null, mode: AnswerMode | null): TeachType | null {
  if (card === 'practice' || card === 'acm' || card === 'oi') return card;
  if (card === 'quiz') return mode;
  return null;
}

function cardCopy(card: NewCard): CardCopy {
  const found = CARDS.find((item) => item.key === card);
  if (!found) throw new TypeError(`teach_new_card_invalid:${card}`);
  return found;
}

function cardEnabled(card: NewCard, canCreate: TeachNewPayload['canCreate']): boolean {
  if (card === 'quiz') return canCreate.homework || canCreate.exam;
  return canCreate[card];
}

function allowsSchools(type: TeachType | null): boolean {
  return type === 'exam' || type === 'acm' || type === 'oi';
}

function timeMode(type: TeachType): 'contest' | 'exam' | 'homework' {
  if (type === 'exam') return 'exam';
  if (type === 'homework') return 'homework';
  return 'contest';
}

function titlePlaceholder(card: NewCard): string {
  if (card === 'quiz') return '例如：数据结构 小测 4';
  if (card === 'practice') return '例如：二叉树专项练习';
  return '例如：第十三届程序设计校赛';
}

function snapshotQuery(
  type: TeachType,
  oiRule: OiRule,
  fromCourse: TeachNewPayload['fromCourse'],
): URLSearchParams | undefined {
  if (type === 'exam' || type === 'acm' || type === 'oi') {
    const query = new URLSearchParams();
    query.set('rule', type === 'oi' ? oiRule : type);
    return query;
  }
  if (type === 'homework' && fromCourse) {
    const query = new URLSearchParams();
    query.set('fromCourse', fromCourse.courseId);
    query.set('chapter', String(fromCourse.chapterId));
    return query;
  }
  return undefined;
}

function submittedRule(type: TeachType, oiRule: ChosenOiRule): string {
  if (type === 'exam' || type === 'acm') return type;
  if (type === 'oi') {
    if (oiRule === 'ledo') throw new TypeError('teach_new_rule_undecided');
    return oiRule;
  }
  throw new TypeError(`teach_new_rule_invalid:${type}`);
}

function parseSnapshot(type: TeachType, raw: unknown, oiRule: OiRule): LoadedSnapshot {
  if (type === 'homework') return { kind: 'homework', value: parseHomeworkSnapshot(raw) };
  if (type === 'practice') return { kind: 'practice', value: parsePracticeSnapshot(raw) };
  const rule: CreateRule = type === 'oi' ? oiRule : type === 'exam' ? 'exam' : 'acm';
  return { kind: 'contest', value: parseContestSnapshot(raw, rule) };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function addHours(date: string, time: string, hours: number): { date: string; time: string } | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch?.[1] || !dateMatch[2] || !dateMatch[3] || !timeMatch?.[1] || !timeMatch[2]) return null;
  const start = new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    0,
    0,
  );
  if (Number.isNaN(start.getTime()) || !Number.isFinite(hours)) return null;
  const end = new Date(start.getTime() + hours * HOUR_MS);
  return {
    date: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`,
    time: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
  };
}

function windowFromSnapshot(snapshot: LoadedSnapshot): TimeWindowValue | null {
  if (snapshot.kind === 'practice') return null;
  if (snapshot.kind === 'homework') {
    const state = snapshot.value.state;
    return {
      beginDate: state.beginDate,
      beginTime: state.beginTime,
      endDate: state.deadlineDate,
      endTime: state.deadlineTime,
      personalMinutes: state.personalMinutes === null ? '' : String(state.personalMinutes),
    };
  }
  const state = snapshot.value.state;
  const end = addHours(state.beginDate, state.beginTime, state.windowHours);
  if (!end) return null;
  const minutes = state.personalHours === null ? null : Math.round(state.personalHours * 60);
  return {
    beginDate: state.beginDate,
    beginTime: state.beginTime,
    endDate: end.date,
    endTime: end.time,
    personalMinutes: minutes === null ? '' : String(minutes),
  };
}

function sameTimeValue(left: TimeWindowValue, right: TimeWindowValue): boolean {
  return left.beginDate === right.beginDate
    && left.beginTime === right.beginTime
    && left.endDate === right.endDate
    && left.endTime === right.endTime
    && left.personalMinutes === right.personalMinutes;
}

function sourceWindow(source: TeachCopySource): { beginAt: string; endAt: string } | null {
  if (!source.beginAt || !source.endAt) return null;
  let endAt = source.endAt;
  if (source.type === 'homework' && source.settings.kind === 'homework' && source.settings.extensionDays > 0) {
    const end = new Date(source.endAt);
    if (Number.isNaN(end.getTime())) return null;
    endAt = new Date(end.getTime() - source.settings.extensionDays * DAY_MS).toISOString();
  }
  return { beginAt: source.beginAt, endAt };
}

function sameClock(value: TimeWindowValue, source: TeachCopySource): boolean {
  const windowSource = sourceWindow(source);
  if (!windowSource) return false;
  const window = timeWindowFromIso(windowSource.beginAt, windowSource.endAt, null);
  return value.beginDate === window.beginDate
    && value.beginTime === window.beginTime
    && value.endDate === window.endDate
    && value.endTime === window.endTime;
}

function copyTimeHint(copy: TeachCopySource | null, now: Date): string | null {
  if (!copy || copy.type === 'practice') return null;
  const windowSource = sourceWindow(copy);
  if (!windowSource) return null;
  const text = formatTeachWindow({
    type: copy.type,
    beginAt: windowSource.beginAt,
    endAt: windowSource.endAt,
    durationMinutes: copy.durationMinutes,
  }, now);
  return `原题目集：${text}。必须重新填。`;
}

function personalMinutesOf(raw: string): number | null {
  if (raw.trim() === '') return null;
  return Number(raw);
}

function usableIds(ids: readonly number[], unusable: readonly number[]): number[] {
  const blocked = new Set(unusable);
  return ids.filter((id) => !blocked.has(id));
}

function scoresFor(copy: TeachCopySource, pids: readonly number[]): Record<number, number> | null {
  const allowed = new Set(pids);
  const scores: Record<number, number> = {};
  for (const [key, value] of Object.entries(copy.scores)) {
    if (!/^[1-9]\d*$/.test(key) || typeof value !== 'number' || !Number.isFinite(value)) continue;
    const id = Number(key);
    if (!allowed.has(id)) continue;
    scores[id] = value;
  }
  return Object.keys(scores).length === 0 ? null : scores;
}

function penaltyFromCopy(rules: Record<string, number>): Array<{ hours: number; coefficient: number }> {
  const rows: Array<{ hours: number; coefficient: number }> = [];
  for (const [key, coefficient] of Object.entries(rules)) {
    if (!/^[0-9]+(?:\.[0-9]+)?$/.test(key) || typeof coefficient !== 'number' || !Number.isFinite(coefficient)) {
      throw new TypeError('teach_legacy_invalid:penaltyRules');
    }
    rows.push({ hours: Number(key), coefficient });
  }
  rows.sort((left, right) => left.hours - right.hours);
  if (rows.length > 0) return rows;
  // An empty copy table is the legacy create default, not "no rules". homeworkFormBody rejects [].
  return DEFAULT_PENALTY_RULES.map((row) => ({ hours: row.hours, coefficient: row.coefficient }));
}

function copiedLockMinutes(copy: TeachCopySource | null): number | null {
  if (!copy || copy.settings.kind !== 'contest') return null;
  const minutes = copy.settings.lockMinutes;
  // 0 does not create lockAt; the server only rejects a positive lock together with a personal limit.
  if (minutes === null || minutes <= 0) return null;
  return minutes;
}

function usableProblems(copy: TeachCopySource, pids: readonly number[]): TeachCopySource['problems'] {
  const allowed = new Set(pids);
  return copy.problems.filter((problem) => allowed.has(problem.docId));
}

function clampExamQuotas(
  quotas: Partial<Record<ProblemKind, number>> | null,
  problems: TeachCopySource['problems'],
): Partial<Record<ProblemKind, number>> | null {
  if (!quotas) return null;
  const counts = new Map<ProblemKind, number>();
  for (const problem of problems) counts.set(problem.kind, (counts.get(problem.kind) ?? 0) + 1);
  const next: Partial<Record<ProblemKind, number>> = {};
  for (const [kind, quota] of Object.entries(quotas) as Array<[ProblemKind, number]>) {
    if (typeof quota !== 'number' || !Number.isInteger(quota) || quota < 1) continue;
    const remaining = counts.get(kind) ?? 0;
    if (remaining < 1) continue;
    next[kind] = Math.min(quota, remaining);
  }
  return Object.keys(next).length === 0 ? null : next;
}

function definiteFullScore(
  pids: readonly number[],
  scores: Record<number, number> | null,
  quotas: Partial<Record<ProblemKind, number>> | null,
  problems: TeachCopySource['problems'],
): number | null | undefined {
  const kinds = new Map<number, ProblemKind>();
  for (const problem of problems) kinds.set(problem.docId, problem.kind);
  if (quotas && pids.some((pid) => !kinds.has(pid))) return undefined;
  return examDefinitePaperMax({ score: scores ?? {}, examPaperQuotas: quotas }, pids, kinds);
}

function fitExamPassScore(passScore: number | null, full: number | null | undefined): number | null {
  if (passScore === null || typeof full !== 'number') return passScore;
  return passScore > full ? null : passScore;
}

function contestAudience(value: AudienceValue): Pick<ContestFormState, 'participantScopeMode' | 'participantGroupIds' | 'participantSchoolIds'> {
  if (value.mode === 'groups') {
    return { participantScopeMode: 'groups', participantGroupIds: [...value.groupIds], participantSchoolIds: [] };
  }
  if (value.mode === 'schools') {
    return { participantScopeMode: 'schools', participantGroupIds: [], participantSchoolIds: [...value.schoolIds] };
  }
  return { participantScopeMode: 'none', participantGroupIds: [], participantSchoolIds: [] };
}

function requireHours(value: TimeWindowValue): number {
  const hours = timeWindowHours(value);
  if (hours === null) throw new TypeError('teach_new_window_invalid');
  return hours;
}

function applyContest(args: {
  snapshot: ContestSnapshot;
  type: TeachType;
  oiRule: ChosenOiRule;
  title: string;
  statement: string;
  time: TimeWindowValue;
  audience: AudienceValue;
  copy: TeachCopySource | null;
}): ContestFormState {
  const base = args.snapshot.state;
  const rule = submittedRule(args.type, args.oiRule);
  const minutes = copiedLockMinutes(args.copy) === null ? personalMinutesOf(args.time.personalMinutes) : null;
  let next: ContestFormState = {
    ...base,
    pids: [...base.pids],
    assign: [...base.assign],
    maintainer: [...base.maintainer],
    langs: [...base.langs],
    vigil: { ...base.vigil },
    scores: base.scores ? { ...base.scores } : null,
    examPaperQuotas: base.examPaperQuotas ? { ...base.examPaperQuotas } : null,
    rule,
    title: args.title,
    content: args.statement,
    beginDate: args.time.beginDate,
    beginTime: args.time.beginTime,
    windowHours: requireHours(args.time),
    personalHours: minutes === null ? null : minutes / 60,
    ...contestAudience(args.audience),
  };
  const copy = args.copy;
  if (!copy) return next;
  if (copy.settings.kind !== 'contest') throw new TypeError('teach_new_copy_kind_mismatch');
  const settings = copy.settings;
  const pids = usableIds(copy.pids, copy.unusablePids);
  const kept = usableProblems(copy, pids);
  const scores = scoresFor(copy, pids);
  const quotas = rule === 'exam' ? clampExamQuotas(copy.examPaperQuotas, kept) : null;
  next = {
    ...next,
    rated: settings.rated,
    autoHide: settings.autoHide,
    hidden: settings.hidden,
    lockMinutes: settings.lockMinutes,
    allowViewCode: settings.allowViewCode,
    allowPrint: settings.allowPrint,
    keepScoreboardHidden: settings.keepScoreboardHidden,
    allowVirtual: settings.allowVirtual,
    allowPostContestPractice: settings.allowPostContestPractice,
    allowPostContestView: settings.allowPostContestView,
    allowPostContestSubmit: settings.allowPostContestSubmit,
    langs: [...settings.langs],
    examShowVerdict: rule === 'exam' ? settings.examShowVerdict : null,
    examPassScore: rule === 'exam' ? fitExamPassScore(settings.examPassScore, definiteFullScore(pids, scores, quotas, kept)) : null,
    examAttemptLimit: rule === 'exam' && fitExamPassScore(settings.examPassScore, definiteFullScore(pids, scores, quotas, kept)) !== null
      ? settings.examAttemptLimit
      : null,
    pids,
    scores,
    examPaperQuotas: quotas,
  };
  return next;
}

function applyHomework(args: {
  snapshot: HomeworkSnapshot;
  title: string;
  statement: string;
  time: TimeWindowValue;
  audience: AudienceValue;
  copy: TeachCopySource | null;
  fromCourse: TeachNewPayload['fromCourse'];
  courseLocked: boolean;
}): HomeworkFormState {
  const base = args.snapshot.state;
  const minutes = personalMinutesOf(args.time.personalMinutes);
  let next: HomeworkFormState = {
    ...base,
    pids: [...base.pids],
    maintainer: [...base.maintainer],
    assign: [...base.assign],
    langs: [...base.langs],
    penaltyRules: base.penaltyRules.map((row) => ({ ...row })),
    participantGroupIds: [...base.participantGroupIds],
    title: args.title,
    content: args.statement,
    beginDate: args.time.beginDate,
    beginTime: args.time.beginTime,
    deadlineDate: args.time.endDate,
    deadlineTime: args.time.endTime,
    personalMinutes: minutes,
    fromCourse: args.fromCourse ?? base.fromCourse,
  };
  if (!args.courseLocked) {
    next = {
      ...next,
      participantScopeMode: args.audience.mode === 'groups' ? 'groups' : 'none',
      participantGroupIds: args.audience.mode === 'groups' ? [...args.audience.groupIds] : [],
    };
  }
  const copy = args.copy;
  if (copy) {
    if (copy.settings.kind !== 'homework') throw new TypeError('teach_new_copy_kind_mismatch');
    const settings = copy.settings;
    const pids = usableIds(copy.pids, copy.unusablePids);
    next = {
      ...next,
      rated: settings.rated,
      langs: [...settings.langs],
      extensionDays: settings.extensionDays,
      penaltyRules: penaltyFromCopy(settings.penaltyRules),
      pids,
      scores: scoresFor(copy, pids),
    };
  }
  if (minutes !== null) next = { ...next, extensionDays: 0 };
  return next;
}

function practiceStages(copy: TeachCopySource | null): PracticeStage[] {
  if (!copy) {
    // Legacy create snapshots name this shell 「阶段 1」. A new practice posts a blank title.
    return [{ ...EMPTY_STAGE }];
  }
  if (copy.stages === null || copy.stages.length === 0) throw new TypeError('teach_legacy_invalid:stages');
  const blocked = new Set(copy.unusablePids);
  return copy.stages.map((stage) => ({
    id: stage.id,
    title: stage.title,
    requireIds: [...stage.requireIds],
    pids: stage.pids.filter((pid) => !blocked.has(pid)),
  }));
}

function applyPractice(args: {
  snapshot: PracticeSnapshot;
  title: string;
  statement: string;
  audience: AudienceValue;
  copy: TeachCopySource | null;
}): PracticeFormState {
  const base = args.snapshot.state;
  const groups = args.audience.mode === 'groups';
  return {
    ...base,
    title: args.title,
    content: args.copy ? args.statement : base.content,
    description: args.copy ? args.copy.description : base.description,
    stages: practiceStages(args.copy),
    audiencePublic: !groups,
    audienceGroupIds: groups ? [...args.audience.groupIds] : [],
  };
}

function copyAdjustmentNote(copy: TeachCopySource): string {
  if (copy.type !== 'exam' || copy.settings.kind !== 'contest') return '';
  const pids = usableIds(copy.pids, copy.unusablePids);
  const kept = usableProblems(copy, pids);
  const scores = scoresFor(copy, pids);
  const quotas = clampExamQuotas(copy.examPaperQuotas, kept);
  const parts: string[] = [];
  for (const kind of TEACH_KIND_ORDER) {
    const before = copy.examPaperQuotas?.[kind];
    if (typeof before !== 'number') continue;
    const after = quotas?.[kind];
    if (after === before) continue;
    parts.push(typeof after === 'number'
      ? `${TEACH_KIND_LABEL[kind]}每人抽题数从 ${before} 改为 ${after}`
      : `${TEACH_KIND_LABEL[kind]}每人抽题数 ${before} 已去掉`);
  }
  const full = definiteFullScore(pids, scores, quotas, kept);
  const pass = copy.settings.examPassScore;
  if (pass !== null && typeof full === 'number' && pass > full) {
    parts.push(`及格线 ${pass} 分高于剩下的满分 ${full} 分，不会带上`);
  }
  return parts.length === 0 ? '' : `去掉不能使用的题以后，${parts.join('；')}。`;
}

function unusableLabels(copy: TeachCopySource): string[] {
  const pids = new Map(copy.problems.map((problem) => [problem.docId, problem.pid]));
  return copy.unusablePids.map((id) => {
    const pid = pids.get(id)?.trim() ?? '';
    return pid === '' ? String(id) : pid;
  });
}

function firstError(errors: FieldErrors): 'mode' | 'rule' | 'title' | 'time' | 'audience' | null {
  if (errors.mode) return 'mode';
  if (errors.rule) return 'rule';
  if (errors.title) return 'title';
  if (errors.time && Object.keys(errors.time).length > 0) return 'time';
  if (errors.audience) return 'audience';
  return null;
}

function focusField(kind: 'mode' | 'rule' | 'title' | 'time' | 'audience', time: FieldErrors['time']) {
  if (kind === 'rule') {
    document.querySelector<HTMLInputElement>('input[name="teach-new-oi-rule"]')?.focus();
    return;
  }
  if (kind === 'mode') {
    const modeInput = ['teach-new-mode-homework', 'teach-new-mode-exam']
      .map((id) => document.getElementById(id))
      .find((node): node is HTMLInputElement => node instanceof HTMLInputElement && !node.disabled);
    modeInput?.focus();
    return;
  }
  if (kind === 'title') {
    document.getElementById('teach-new-title')?.focus();
    return;
  }
  if (kind === 'time') {
    const id = time?.begin
      ? 'teach-new-time-begin-date'
      : time?.end
        ? 'teach-new-time-end-date'
        : 'teach-new-time-personal';
    document.getElementById(id)?.focus();
    return;
  }
  document.querySelector<HTMLInputElement>('input[name="teach-new-audience"]')?.focus();
}

function NewStepper({ step }: { step: Step }) {
  return (
    <ol aria-label="新建步骤" className="flex list-none items-center gap-3 p-0 text-sm">
      <StepperItem index={1} label="选择类型" state={step === 1 ? 'current' : 'done'} />
      <li aria-hidden="true" className="h-px w-8 shrink-0 bg-line" />
      <StepperItem index={2} label="基本信息" state={step === 2 ? 'current' : 'future'} />
    </ol>
  );
}

function StepperItem({
  index,
  label,
  state,
}: {
  index: number;
  label: string;
  state: 'current' | 'done' | 'future';
}) {
  return (
    <li className="flex min-w-0 items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
      <span
        className={cn(
          'grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium',
          state === 'current' && 'border border-brand bg-brand text-on-brand',
          state === 'done' && 'bg-surface-active text-fg-muted',
          state === 'future' && 'border border-line text-fg-subtle',
        )}
      >
        {state === 'done' ? <Check className="size-3.5" aria-hidden="true" /> : index}
      </span>
      <span className={cn('min-w-0', state === 'future' ? 'text-fg-subtle' : 'text-fg')}>{label}</span>
    </li>
  );
}

function CardChoice({
  card,
  selected,
  disabled,
  onSelect,
}: {
  card: CardCopy;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const Icon = card.icon;
  return (
    <RadioGroupItem
      name="teach-new-type"
      value={card.key}
      checked={selected}
      disabled={disabled}
      wrapperClassName="w-full"
      label={(
        <span className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
          <span className="min-w-0 font-medium">{card.label}</span>
        </span>
      )}
      description={(
        <>
          {card.description}
          <span className="mt-1 block text-xs text-fg-subtle">适合：{card.example}</span>
        </>
      )}
      onChange={onSelect}
    />
  );
}

export function TeachNewPage() {
  const bootstrap = useBootstrap();
  const pageData = bootstrap.page.data;
  const payload = useMemo(() => parseTeachNewPayload(pageData), [pageData]);
  const practiceAttach = useMemo(() => readPracticeCourseAttach(pageData, payload), [pageData, payload]);
  const nowMs = useExamNow(bootstrap.generatedAt);
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const courseLocked = payload.fromCourse !== null;

  const [step, setStep] = useState<Step>(() => (initialCard(payload) ? 2 : 1));
  const [card, setCard] = useState<NewCard | null>(() => initialCard(payload));
  const [mode, setMode] = useState<AnswerMode | null>(() => initialMode(payload));
  const [oiRule, setOiRule] = useState<ChosenOiRule>(() => initialOiRule(payload.copy));
  const [copy, setCopy] = useState<TeachCopySource | null>(() => payload.copy);
  const [title, setTitle] = useState(() => payload.copy?.title ?? '');
  const [statement, setStatement] = useState(() => initialStatement(payload.copy));
  const [time, setTime] = useState<TimeWindowValue>(EMPTY_TIME);
  const [audience, setAudience] = useState<AudienceValue>(EMPTY_AUDIENCE);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [load, setLoad] = useState<LoadState>({ status: 'idle', snapshot: null, error: null });
  const timeTouched = useRef(false);
  const submittingRef = useRef(false);

  const type = effectiveType(card, mode);
  const loadedOiRule = snapshotOiRule(oiRule);
  const showBack = step === 2 && copy === null && !courseLocked;
  const personalLocked = type !== 'homework' && type !== 'practice' && copiedLockMinutes(copy) !== null;
  const schoolsAllowed = allowsSchools(type);
  useUnsavedChangesGuard(dirty);

  useEffect(() => {
    if (step !== 2 || type === null) {
      setLoad({ status: 'idle', snapshot: null, error: null });
      return undefined;
    }
    let cancelled = false;
    setLoad({ status: 'loading', snapshot: null, error: null });
    const path = legacyEditPath(type, null, snapshotQuery(type, loadedOiRule, payload.fromCourse));
    getJson(path, LOAD_FAILED).then((raw) => {
      if (cancelled) return;
      try {
        setLoad({ status: 'ready', snapshot: parseSnapshot(type, raw, loadedOiRule), error: null });
      } catch (error) {
        console.error('teach new snapshot failed', { type, error });
        if (!cancelled) setLoad({ status: 'error', snapshot: null, error: messageOf(error, LOAD_FAILED) });
      }
    }).catch((error: unknown) => {
      console.error('teach new snapshot failed', { type, error });
      if (!cancelled) setLoad({ status: 'error', snapshot: null, error: messageOf(error, LOAD_FAILED) });
    });
    return () => {
      cancelled = true;
    };
  }, [step, type, loadedOiRule, payload.fromCourse, retry]);

  useEffect(() => {
    if (timeTouched.current || copy || load.status !== 'ready') return;
    const next = windowFromSnapshot(load.snapshot);
    if (!next) return;
    setTime((current) => (sameTimeValue(current, next) ? current : next));
  }, [copy, load]);

  useEffect(() => {
    if (schoolsAllowed || audience.mode !== 'schools') return;
    setAudience((current) => (current.mode === 'schools' ? { ...current, mode: null } : current));
  }, [schoolsAllowed, audience.mode]);

  function markDirty() {
    setDirty(true);
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (card === 'quiz' && mode === null) {
      errors.mode = MODE_ERROR;
      return errors;
    }
    if (type === 'oi' && !isOiRule(oiRule)) errors.rule = '请选择赛制。';
    if (load.status !== 'ready' || type === null) return errors;
    const trimmed = title.trim();
    if (trimmed === '') errors.title = TITLE_ERROR;
    else if ([...trimmed].length > TITLE_LIMIT) errors.title = TITLE_LIMIT_ERROR;
    if (type !== 'practice') {
      const timeErrors = timeWindowErrors(time);
      if (personalLocked) delete timeErrors.personal;
      if (Object.keys(timeErrors).length > 0) errors.time = timeErrors;
    }
    if (!courseLocked || type !== 'homework') {
      if (!schoolsAllowed && audience.mode === 'schools') errors.audience = AUDIENCE_REQUIRED;
      else {
        const audienceError = audienceErrors(audience);
        if (audienceError) errors.audience = audienceError;
      }
    }
    return errors;
  }

  function clearCopy() {
    const url = new URL(window.location.href);
    url.searchParams.delete('copy');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    timeTouched.current = false;
    setCopy(null);
    setTitle('');
    setStatement('');
    setTime(EMPTY_TIME);
    setAudience(EMPTY_AUDIENCE);
    setOiRule('oi');
    setDirty(false);
    setFieldErrors({});
    setSubmitError(null);
  }

  async function createSet() {
    if (submittingRef.current || practiceAttach?.chapterHasProblemSet) return;
    const errors = validate();
    setFieldErrors(errors);
    const earliest = firstError(errors);
    if (earliest) {
      focusField(earliest, errors.time);
      return;
    }
    if (load.status === 'error') {
      setSubmitError(load.error.trim() !== '' ? load.error : LOAD_FAILED);
      return;
    }
    if (type === null || load.status !== 'ready') {
      setSubmitError(NOT_READY);
      return;
    }
    const snapshot = load.snapshot;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const copiedWindow = copy && type !== 'practice' ? sourceWindow(copy) : null;
      if (copy && copiedWindow && sameClock(time, copy)) {
        const when = formatTeachWindow({
          type: copy.type,
          beginAt: copiedWindow.beginAt,
          endAt: copiedWindow.endAt,
          durationMinutes: copy.durationMinutes,
        }, now);
        const confirmed = await confirmDialog(
          `原题目集是 ${when}。如果是给另一批学生在同一时间考，可以继续。`,
          { title: SAME_TIME_TITLE, confirmLabel: SAME_TIME_CONFIRM },
        );
        if (!confirmed) {
          submittingRef.current = false;
          setSubmitting(false);
          return;
        }
      }
      const trimmed = title.trim();
      const body = formBody({
        type,
        oiRule,
        title: trimmed,
        statement: statement.trim(),
        time,
        audience,
        copy,
        snapshot,
        fromCourse: payload.fromCourse,
        courseLocked: courseLocked && type === 'homework',
      });
      const created = await postForm(legacyEditPath(type, null), body, CREATE_FAILED);
      const tid = created.tid;
      if (typeof tid !== 'string' || tid === '') throw new Error(MISSING_TID);
      if (copy) {
        try {
          await postJson(
            teachApi.provenance(type, tid),
            { sourceType: copy.type, sourceId: copy.id },
            PROVENANCE_FAILED,
          );
        } catch (error) {
          console.error('teach provenance failed', { type, id: tid, error });
          toast.error(`题目集已创建，但没能记录复制来源：${messageOf(error, PROVENANCE_FAILED)}`);
        }
      }
      if (practiceAttach && !practiceAttach.chapterHasProblemSet) {
        try {
          const attach = new URLSearchParams();
          attach.set('operation', 'attach_problem_set');
          attach.set('problemSetId', tid);
          attach.set('chapter', String(practiceAttach.chapterId));
          await postForm(`/course/${practiceAttach.courseId}/edit`, attach, ATTACH_FAILED);
        } catch (error) {
          console.error('teach course attach failed', { courseId: practiceAttach.courseId, id: tid, error });
          toast.error(`练习已创建，但没能挂到课程：${messageOf(error, ATTACH_FAILED)}`);
        }
      }
      flushSync(() => setDirty(false));
      window.location.assign(teachPath(type, tid, 'problems'));
    } catch (error) {
      console.error('teach create failed', { type, error });
      setSubmitError(messageOf(error, CREATE_FAILED));
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void createSet();
  }

  const selected = card ? cardCopy(card) : null;
  const catalogs = load.status === 'ready' ? load.snapshot.value.catalogs : EMPTY_CATALOGS;
  const courseContext = load.status === 'ready' && load.snapshot.kind === 'homework' ? load.snapshot.value.courseContext : null;

  return (
    <Page width="form">
      <PageHeader
        title={step === 1 || !selected ? '新建题目集' : selected.key === 'quiz' ? '新建作业与考试' : `新建${selected.label}`}
        description={step === 1 || !selected ? '先选类型。建好以后在工作台里加题目、调设置。' : selected.description}
      />
      <NewStepper step={step} />
      {step === 1 ? (
        <Panel
          flush
          footer={(
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button variant="ghost" type="button" onClick={() => setCopyOpen(true)}>从已有题目集复制…</Button>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="secondary" asChild>
                  <a href="/teach">取消</a>
                </Button>
                <Button variant="primary" type="button" disabled={card === null} onClick={() => setStep(2)}>下一步</Button>
              </div>
            </div>
          )}
        >
          <RadioGroup aria-label="类型" className="gap-0 divide-y divide-line-subtle">
            {CARDS.map((item) => (
              <CardChoice
                key={item.key}
                card={item}
                selected={card === item.key}
                disabled={!cardEnabled(item.key, payload.canCreate)}
                onSelect={() => setCard(item.key)}
              />
            ))}
          </RadioGroup>
        </Panel>
      ) : (
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
          {copy ? (
            <Alert
              tone="neutral"
              action={(
                <Button variant="ghost" size="sm" type="button" onClick={clearCopy}>不复制</Button>
              )}
            >
              {`复制自 ${copy.ownerName}《${copy.title}》：题目、分值和设置都会带过来。时间和给谁做必须重新填；协作者、机房监考、座位、队伍不复制；学生的提交和成绩不复制。`}
            </Alert>
          ) : null}
          {copy && copy.unusablePids.length > 0 ? (
            <Alert tone="warning">
              {`这个题目集里有 ${copy.unusablePids.length} 道题你不能使用：${unusableLabels(copy).join('、')}。创建时会去掉它们。${copyAdjustmentNote(copy)}`}
            </Alert>
          ) : null}
          {courseLocked && type === 'homework' && courseContext ? (
            <Alert tone="info">
              {`这是课程《${courseContext.courseTitle}》${courseContext.chapterTitle} 的测验：学生范围跟随课程班级，创建后自动挂到这一章。`}
            </Alert>
          ) : null}
          {practiceAttach ? (
            <Alert tone={practiceAttach.chapterHasProblemSet ? 'warning' : 'info'}>
              {practiceAttach.chapterHasProblemSet
                ? PRACTICE_COURSE_BLOCKED
                : `这是课程《${practiceAttach.courseTitle}》${practiceAttach.chapterTitle} 的练习：创建后自动挂到这一章。`}
            </Alert>
          ) : null}
          <Panel
            footer={(
              <div className="flex flex-wrap items-center justify-between gap-3">
                {showBack ? (
                  <Button variant="ghost" type="button" onClick={() => setStep(1)}>上一步</Button>
                ) : <span />}
                <Button variant="primary" type="submit" loading={submitting} disabled={submitting || practiceAttach?.chapterHasProblemSet === true}>创建并进入工作台</Button>
              </div>
            )}
          >
            <div className="flex flex-col gap-5">
              {card === 'quiz' ? (
                copy ? (
                  <FormField label="作答方式">
                    <p className="rounded-md bg-surface-sunken px-3 py-2 text-sm text-fg">
                      {`${MODE_COPY[mode ?? 'homework'].label} · 和原题目集一样，不能改`}
                    </p>
                  </FormField>
                ) : (
                  <FormField label="作答方式" required hint="创建后不能再改作答方式。" error={fieldErrors.mode}>
                    <RadioGroup aria-label="作答方式">
                      <RadioGroupItem
                        id="teach-new-mode-homework"
                        name="teach-new-mode"
                        value="homework"
                        checked={mode === 'homework'}
                        disabled={courseLocked || !payload.canCreate.homework}
                        label={MODE_COPY.homework.label}
                        description={MODE_COPY.homework.description}
                        onChange={() => {
                          setMode('homework');
                          setFieldErrors((current) => ({ ...current, mode: undefined }));
                          markDirty();
                        }}
                      />
                      <RadioGroupItem
                        id="teach-new-mode-exam"
                        name="teach-new-mode"
                        value="exam"
                        checked={mode === 'exam'}
                        disabled={courseLocked || !payload.canCreate.exam}
                        label={MODE_COPY.exam.label}
                        description={MODE_COPY.exam.description}
                        onChange={() => {
                          setMode('exam');
                          setFieldErrors((current) => ({ ...current, mode: undefined }));
                          markDirty();
                        }}
                      />
                    </RadioGroup>
                  </FormField>
                )
              ) : null}
              {type === null ? null : (
                <>
                  {load.status === 'loading' ? <Skeleton className="h-8" /> : null}
                  {load.status === 'error' ? (
                    <Alert
                      tone="danger"
                      action={(
                        <Button variant="secondary" type="button" onClick={() => setRetry((current) => current + 1)}>重试</Button>
                      )}
                    >
                      {load.error}
                    </Alert>
                  ) : null}
                  <FormField
                    label="标题"
                    htmlFor="teach-new-title"
                    required
                    hint={copy ? '可以不改。' : undefined}
                    error={fieldErrors.title}
                  >
                    <Input
                      id="teach-new-title"
                      value={title}
                      maxLength={TITLE_LIMIT}
                      placeholder={card ? titlePlaceholder(card) : ''}
                      invalid={Boolean(fieldErrors.title)}
                      onChange={(event) => {
                        setTitle(event.target.value);
                        markDirty();
                      }}
                    />
                  </FormField>
                  {copy ? (
                    <FormField label="说明" htmlFor="teach-new-statement" optional hint="原题目集的说明会带过来，可以不改。">
                      <Textarea
                        id="teach-new-statement"
                        value={statement}
                        onChange={(event) => {
                          setStatement(event.target.value);
                          markDirty();
                        }}
                      />
                    </FormField>
                  ) : null}
                  {type === 'oi' ? (
                    <FormField label="赛制" required hint={oiRule === 'ledo' ? LEDO_RULE_HINT : undefined} error={fieldErrors.rule}>
                      <RadioGroup aria-label="赛制">
                        {OI_RULES.map((rule) => (
                          <RadioGroupItem
                            key={rule.value}
                            name="teach-new-oi-rule"
                            value={rule.value}
                            checked={oiRule === rule.value}
                            label={rule.label}
                            description={rule.description}
                            onChange={() => {
                              setOiRule(rule.value);
                              markDirty();
                            }}
                          />
                        ))}
                      </RadioGroup>
                    </FormField>
                  ) : null}
                  {type !== 'practice' ? (
                    <TimeWindowField
                      idPrefix="teach-new-time"
                      mode={timeMode(type)}
                      value={time}
                      endLabel={type === 'homework' ? '截止' : undefined}
                      sourceHint={copyTimeHint(copy, now)}
                      personalDisabledReason={personalLocked ? LOCK_PERSONAL_REASON : null}
                      errors={fieldErrors.time}
                      onChange={(next) => {
                        timeTouched.current = true;
                        setTime(next);
                        markDirty();
                      }}
                    />
                  ) : null}
                  <AudienceField
                    name="teach-new-audience"
                    value={audience}
                    allowSchools={schoolsAllowed}
                    groups={catalogs.groups}
                    schools={catalogs.schools}
                    allDescription={type === 'practice' || type === 'homework' ? '登录即可看到' : '登录即可报名参加'}
                    error={fieldErrors.audience}
                    lockedReason={courseLocked && type === 'homework' ? COURSE_LOCK : null}
                    onChange={(next) => {
                      setAudience(next);
                      markDirty();
                    }}
                  />
                  {submitError ? <Alert tone="danger">{submitError}</Alert> : null}
                </>
              )}
            </div>
          </Panel>
        </form>
      )}
      <CopyDialog open={copyOpen} onOpenChange={setCopyOpen} />
    </Page>
  );
}

function formBody(args: {
  type: TeachType;
  oiRule: ChosenOiRule;
  title: string;
  statement: string;
  time: TimeWindowValue;
  audience: AudienceValue;
  copy: TeachCopySource | null;
  snapshot: LoadedSnapshot;
  fromCourse: TeachNewPayload['fromCourse'];
  courseLocked: boolean;
}): URLSearchParams {
  if (args.type === 'homework') {
    if (args.snapshot.kind !== 'homework') throw new TypeError('teach_new_snapshot_mismatch');
    return homeworkFormBody(applyHomework({
      snapshot: args.snapshot.value,
      title: args.title,
      statement: args.statement,
      time: args.time,
      audience: args.audience,
      copy: args.copy,
      fromCourse: args.fromCourse,
      courseLocked: args.courseLocked,
    }));
  }
  if (args.type === 'practice') {
    if (args.snapshot.kind !== 'practice') throw new TypeError('teach_new_snapshot_mismatch');
    return practiceFormBody(applyPractice({
      snapshot: args.snapshot.value,
      title: args.title,
      statement: args.statement,
      audience: args.audience,
      copy: args.copy,
    }));
  }
  if (args.snapshot.kind !== 'contest') throw new TypeError('teach_new_snapshot_mismatch');
  return contestFormBody(applyContest({
    snapshot: args.snapshot.value,
    type: args.type,
    oiRule: args.oiRule,
    title: args.title,
    statement: args.statement,
    time: args.time,
    audience: args.audience,
    copy: args.copy,
  }));
}
